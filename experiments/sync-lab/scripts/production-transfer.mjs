import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { LoroDoc } from 'loro-crdt';
import { productionIdHash, productionOutline } from './production-cutover.mjs';
import { documentId, productionProject } from '../src/staging-config.js';
import { outlineNodes } from '../src/outline-model.js';
import { loroViewRows } from '../src/loro-model.js';
import { flattenTree } from '../../../src/lib/outline.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id));

// 大きい本文・バイナリをSQL Editorへ貼らない。初期原本は作り直さず、
// 確認済みの同じバイト列だけを一時領域へ小分けし、最後の管理SQLで有効化する。
export function productionTransfer(manifest, rows, snapshot, { token = randomBytes(32).toString('hex') } = {}) {
  if (manifest?.format !== 1 || manifest.kind !== 'production-cutover' || manifest.projectRef !== productionProject
    || manifest.rows !== rows.length || productionIdHash(rows) !== manifest.sourceIdSha256
    || !/^[a-f0-9]{64}$/.test(token)) throw new Error('本番の停止原本と転送設定が必要です');
  const migration = documentId(manifest.migrationId), owner = documentId(manifest.ownerId), docId = documentId(manifest.documentId);
  const source = Buffer.from(JSON.stringify([...rows].sort(compare)));
  if (hash(source) !== manifest.sourceSha256 || hash(snapshot) !== manifest.snapshotSha256) throw new Error('確認済みの原本とバイナリが一致しません');
  const doc = new LoroDoc();
  try {
    doc.import(snapshot);
    assert.deepEqual(flattenTree(outlineNodes(loroViewRows(doc))).sort(compare), flattenTree(productionOutline(rows)).sort(compare));
  } finally { doc.free(); }
  const parts = [];
  for (const [kind, bytes] of [['source', source], ['snapshot', Buffer.from(snapshot)]]) {
    for (let at = 0, part = 0; at < bytes.length; at += 49152, part++) {
      const body = bytes.subarray(at, at + 49152);
      parts.push({ kind, part, bytes: body, sha256: hash(body) });
    }
  }
  const route = `singleton and phase = 'preparing' and migration_id = '${migration}' and owner_id = '${owner}' and doc_id = '${docId}'`;
  const setupSql = `-- 本番専用：小分け転送の一時領域だけを用意する。新同期はまだ有効化しない。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(1414745932, 1);
do $$ begin
  if not exists (select 1 from taskspace_loro.legacy_cutover where ${route})
    or exists (select 1 from public.taskspace_loro_documents where id = '${docId}') then
    raise exception '停止済みの本番と移行先が一致しません';
  end if;
end $$;
create table taskspace_loro.production_transfer (
  kind text not null check (kind in ('source', 'snapshot')), part integer not null check (part >= 0),
  expected_bytes integer not null check (expected_bytes between 1 and 49152), expected_sha256 text not null,
  bytes bytea, deadline timestamptz not null default now() + interval '24 hours', primary key(kind, part)
);
revoke all on taskspace_loro.production_transfer from public, anon, authenticated;
insert into taskspace_loro.production_transfer(kind, part, expected_bytes, expected_sha256) values
${parts.map((p) => `('${p.kind}', ${p.part}, ${p.bytes.length}, '${p.sha256}')`).join(',\n')};
create function public.taskspace_loro_upload_production(p_kind text, p_part integer, p_bytes text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare expected taskspace_loro.production_transfer%rowtype; body bytea;
begin
  -- 管理鍵やログイン情報はブラウザーへ渡さない。一度限りの転送鍵と、
  -- 予め固定した全片の長さ・SHA-256の両方が一致したバイト列だけを受け付ける。
  if p_token is null or length(p_token) <> 64
    or encode(sha256(convert_to(p_token, 'UTF8')), 'hex') <> '${hash(token)}' then
    raise insufficient_privilege using message = '転送を許可できません';
  end if;
  if p_bytes is null or length(p_bytes) > 65536 then raise exception '転送片の大きさが不正です'; end if;
  perform pg_catalog.pg_advisory_xact_lock(1414745932, 1);
  if not exists (select 1 from taskspace_loro.legacy_cutover where ${route}) then
    raise exception '本番は転送の準備中ではありません';
  end if;
  select * into expected from taskspace_loro.production_transfer where kind = p_kind and part = p_part for update;
  if not found or expected.deadline < clock_timestamp() then raise exception '転送片が未登録または期限切れです'; end if;
  body := decode(p_bytes, 'base64');
  if octet_length(body) <> expected.expected_bytes or encode(sha256(body), 'hex') <> expected.expected_sha256 then
    raise exception '転送片の内容が一致しません';
  end if;
  if expected.bytes is null then
    update taskspace_loro.production_transfer set bytes = body where kind = p_kind and part = p_part;
  elsif expected.bytes <> body then raise exception '受領済みの転送片は置き換えません'; end if;
  return jsonb_build_object('kind', p_kind, 'part', p_part, 'sha256', expected.expected_sha256);
end $$;
revoke all on function public.taskspace_loro_upload_production(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.taskspace_loro_upload_production(text, integer, text, text) to anon;
notify pgrst, 'reload schema';
commit;
select '転送の準備ができました' as result, count(*) as parts from taskspace_loro.production_transfer;
`;
  const activateSql = `-- 本番専用：全片と保全原本を照合し、同じsnapshotを一度だけ有効化する。
-- 一時表を別の文で用意する手順に依存しない。照合から削除まで、このDO一文が一つの取引になる。
do $$
declare source_body bytea; snapshot_body bytea; expected_rows jsonb;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('statement_timeout', '60s', true);
  perform pg_catalog.pg_advisory_xact_lock(1414745932, 1);
  lock table public.outline_nodes in share row exclusive mode;
  -- 結果の受信に失敗した後の再実行でも、同じ有効化済み原本を再登録しない。
  if exists (select 1 from taskspace_loro.legacy_cutover where singleton and phase = 'active'
    and migration_id = '${migration}' and owner_id = '${owner}' and doc_id = '${docId}') then
    if not exists (select 1 from public.taskspace_loro_documents d join taskspace_loro.snapshots s on s.doc_id = d.id
      where d.id = '${docId}' and d.owner_id = '${owner}' and encode(sha256(s.bytes), 'hex') = '${manifest.snapshotSha256}') then
      raise exception '有効化済みの原本が一致しません'; end if;
    drop function if exists public.taskspace_loro_upload_production(text, integer, text, text);
    drop table if exists taskspace_loro.production_transfer;
    notify pgrst, 'reload schema';
    return;
  end if;
  if not exists (select 1 from taskspace_loro.legacy_cutover where ${route}) then raise exception '停止済み本番が一致しません'; end if;
  if (select count(*) from taskspace_loro.production_transfer) <> ${parts.length}
    or exists (select 1 from taskspace_loro.production_transfer where bytes is null or octet_length(bytes) <> expected_bytes
      or encode(sha256(bytes), 'hex') <> expected_sha256) then raise exception '転送が完了していません'; end if;
  select string_agg(bytes, ''::bytea order by part) into source_body from taskspace_loro.production_transfer where kind = 'source';
  select string_agg(bytes, ''::bytea order by part) into snapshot_body from taskspace_loro.production_transfer where kind = 'snapshot';
  if encode(sha256(source_body), 'hex') is distinct from '${manifest.sourceSha256}'
    or encode(sha256(snapshot_body), 'hex') is distinct from '${manifest.snapshotSha256}' then
    raise exception '転送全体の内容が一致しません'; end if;
  expected_rows := convert_from(source_body, 'UTF8')::jsonb;
  if (select jsonb_agg(to_jsonb(n) order by id collate "C") from public.outline_nodes n) is distinct from expected_rows
    or (select rows from taskspace_loro.production_original where migration_id = '${migration}') is distinct from expected_rows then
    raise exception '停止後の全行と保全した原本が一致しません'; end if;
  insert into public.taskspace_loro_documents(id, owner_id) values ('${docId}', '${owner}');
  insert into taskspace_loro.snapshots(doc_id, bytes) values ('${docId}', snapshot_body);
  update taskspace_loro.legacy_cutover set phase = 'active' where singleton;
  drop function public.taskspace_loro_upload_production(text, integer, text, text);
  drop table taskspace_loro.production_transfer;
  notify pgrst, 'reload schema';
end $$;
select c.phase, c.owner_id, c.doc_id, d.head, encode(sha256(s.bytes), 'hex') as snapshot_sha256
  from taskspace_loro.legacy_cutover c join public.taskspace_loro_documents d on d.id = c.doc_id
  join taskspace_loro.snapshots s on s.doc_id = d.id where singleton;
`;
  return { setupSql, activateSql, token, parts };
}

// 通信切断時も同じ片を再送する。内容の異なる置換や、ログへの本文・転送鍵の出力は行わない。
export async function uploadProductionParts(client, transfer, onProgress = () => {}) {
  for (const [index, part] of transfer.parts.entries()) {
    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await client.rpc('taskspace_loro_upload_production', {
        p_kind: part.kind, p_part: part.part, p_bytes: part.bytes.toString('base64'), p_token: transfer.token,
      });
      if (!response.error) {
        assert.deepEqual(response.data, { kind: part.kind, part: part.part, sha256: part.sha256 }); success = true; break;
      }
      if (response.status !== 0 && response.status < 500 && response.status !== 429) break;
    }
    if (!success) throw new Error('本番の小分け転送を完了できませんでした');
    onProgress(index + 1, transfer.parts.length);
  }
}
