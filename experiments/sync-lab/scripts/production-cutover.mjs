import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { documentId, productionProject } from '../src/staging-config.js';
import { seedOutlineDocument, outlineNodes } from '../src/outline-model.js';
import { loroViewRows } from '../src/loro-model.js';
import { flattenTree } from '../../../src/lib/outline.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const literal = (value) => "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const columns = ['id', 'parent_id', 'sort_order', 'text', 'collapsed', 'completed', 'favorite', 'date',
  'heading_level', 'text_color', 'bg_color', 'image_width', 'created_at', 'updated_at'];

export function productionIdHash(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('空でない本番の行IDが必要です');
  const ids = rows.map((row) => row?.id);
  if (ids.some((id) => typeof id !== 'string' || !id || id.includes('\0')) || new Set(ids).size !== ids.length) throw new Error('本番の行IDが不正または重複しています');
  return digest(ids.sort(compare).map((id) => Buffer.byteLength(id) + ':' + id).join(''));
}
export function productionOutline(rows) {
  productionIdHash(rows);
  const mapped = new Map(), roots = [];
  for (const row of rows) {
    if (Object.keys(row).some((key) => !columns.includes(key)) || typeof row.text !== 'string'
      || !Number.isFinite(row.sort_order) || ![null, 'string'].includes(row.parent_id === null ? null : typeof row.parent_id)
      || ['collapsed', 'completed', 'favorite'].some((field) => row[field] != null && typeof row[field] !== 'boolean')) throw new Error('本番の列または値の形式を確認してください');
    mapped.set(row.id, { id: row.id, text: row.text, collapsed: !!row.collapsed, completed: !!row.completed, favorite: !!row.favorite,
      date: row.date ?? null, headingLevel: row.heading_level ?? null, textColor: row.text_color ?? null, bgColor: row.bg_color ?? null,
      imageWidth: row.image_width ?? null, createdAt: row.created_at ?? null, updatedAt: row.updated_at ?? null, children: [] });
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    const seen = new Set([row.id]); let parent = row.parent_id;
    while (parent !== null) {
      if (!byId.has(parent) || seen.has(parent)) throw new Error('親不在または循環する行があるため、原本を変更せず停止しました');
      seen.add(parent); parent = byId.get(parent).parent_id;
    }
  }
  for (const row of [...rows].sort((a, b) => a.sort_order - b.sort_order || compare(a.id, b.id))) {
    (row.parent_id === null ? roots : mapped.get(row.parent_id).children).push(mapped.get(row.id));
  }
  return roots;
}
function checkRoute(manifest) {
  if (manifest?.format !== 1 || manifest.kind !== 'production-cutover' || manifest.projectRef !== productionProject
    || !/^[a-f0-9]{64}$/.test(manifest.sourceIdSha256 || '') || !Number.isSafeInteger(manifest.rows) || manifest.rows < 1) throw new Error('本番専用の切替manifestが必要です');
  documentId(manifest.documentId); documentId(manifest.migrationId);
}
export async function productionFreezeSql(manifest) {
  checkRoute(manifest);
  const schema = await readFile(new URL('../infra/loro-log.sql', import.meta.url), 'utf8');
  const fence = await readFile(new URL('../infra/loro-cutover.sql', import.meta.url), 'utf8');
  return `-- 本番専用：${productionProject}。三端末の最新の控えを取って編集を止めた後に実行する。
-- 旧本文は削除しない。停止後の全行もDB内の非公開原本へ残す。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(1414745932, 1);
lock table public.outline_nodes in share row exclusive mode;
do $$ begin
  if (select count(*) from public.outline_nodes) <> ${manifest.rows}
    or (select encode(sha256(convert_to(string_agg(octet_length(id)::text || ':' || id, '' order by id collate "C"), 'UTF8')), 'hex') from public.outline_nodes) <> '${manifest.sourceIdSha256}' then
    raise exception '本番の行IDと件数が一致しません。検証先や古い原本には適用しません';
  end if;
  if (select count(*) from auth.users) <> 1 then raise exception '本番のログイン所有者を一人に確定できません。変更せず停止します'; end if;
  if to_regclass('public.taskspace_loro_documents') is not null or to_regnamespace('taskspace_loro') is not null then
    raise exception '新同期の既存状態には上書きしません。適用済みか確認してください';
  end if;
end $$;
${schema}
${fence}
create table taskspace_loro.production_original (
  migration_id uuid primary key, owner_id uuid not null, doc_id uuid not null,
  rows jsonb not null check (jsonb_typeof(rows) = 'array'), captured_at timestamptz not null default clock_timestamp()
);
revoke all on taskspace_loro.production_original from public, anon, authenticated;
update taskspace_loro.legacy_cutover set phase = 'preparing', migration_id = '${manifest.migrationId}',
  owner_id = (select id from auth.users), doc_id = '${manifest.documentId}' where singleton;
insert into taskspace_loro.production_original(migration_id, owner_id, doc_id, rows)
  select c.migration_id, c.owner_id, c.doc_id, (select jsonb_agg(to_jsonb(n) order by id collate "C") from public.outline_nodes n)
  from taskspace_loro.legacy_cutover c where singleton;
notify pgrst, 'reload schema';
commit;
select c.phase, c.migration_id, c.owner_id, c.doc_id, jsonb_array_length(o.rows) as row_count
  from taskspace_loro.legacy_cutover c join taskspace_loro.production_original o using (migration_id) where singleton;
`;
}
export async function prepareProductionFreeze(directory, rows) {
  const manifest = { format: 1, kind: 'production-cutover', projectRef: productionProject,
    documentId: randomUUID(), migrationId: randomUUID(), rows: rows.length, sourceIdSha256: productionIdHash(rows) };
  const sql = await productionFreezeSql(manifest);
  await mkdir(directory);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(directory, '01-本番の原本保全と旧同期停止.sql'), sql, { flag: 'wx' });
  return manifest;
}
export function productionActivation(manifest, receipt, rows) {
  checkRoute(manifest);
  if (receipt?.phase !== 'preparing' || receipt.migration_id !== manifest.migrationId || receipt.doc_id !== manifest.documentId
    || receipt.row_count !== manifest.rows || productionIdHash(rows) !== manifest.sourceIdSha256) throw new Error('停止済み本番の結果と全行が一致しません');
  const ownerId = documentId(receipt.owner_id), nodes = productionOutline(rows), doc = seedOutlineDocument(nodes);
  let snapshot;
  try {
    snapshot = Buffer.from(doc.export({ mode: 'snapshot' }));
    const restored = flattenTree(outlineNodes(loroViewRows(doc))), expected = flattenTree(nodes);
    const sorted = (value) => value.sort((a, b) => compare(a.id, b.id));
    assert.deepEqual(sorted(restored), sorted(expected), 'snapshotの全行・本文・属性・親子・並びが一致しません');
  } finally { doc.free(); }
  const original = JSON.stringify([...rows].sort((a, b) => compare(a.id, b.id)));
  const sql = `-- 本番専用：${productionProject}。停止後に読み戻した最新の原本から一度だけ登録する。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(1414745932, 1);
lock table public.outline_nodes in share row exclusive mode;
-- 本文に$$があっても手続き本体の区切りと衝突しないよう、照合値は外側で一時表へ入れる。
create temporary table taskspace_production_expected(rows jsonb) on commit drop;
insert into taskspace_production_expected values (${literal(original)}::jsonb);
do $$ begin
  if not exists (select 1 from taskspace_loro.legacy_cutover where singleton and phase = 'preparing'
    and migration_id = '${manifest.migrationId}' and owner_id = '${ownerId}' and doc_id = '${manifest.documentId}') then
    raise exception '停止済み本番の所有者と移行先が一致しません';
  end if;
  if (select jsonb_agg(to_jsonb(n) order by id collate "C") from public.outline_nodes n) is distinct from (select rows from pg_temp.taskspace_production_expected)
    or (select rows from taskspace_loro.production_original where migration_id = '${manifest.migrationId}') is distinct from (select rows from pg_temp.taskspace_production_expected) then
    raise exception '停止後の全行と保全した原本が一致しません。空や古いデータへ置き換えません';
  end if;
end $$;
insert into public.taskspace_loro_documents(id, owner_id) values ('${manifest.documentId}', '${ownerId}');
insert into taskspace_loro.snapshots(doc_id, bytes) values ('${manifest.documentId}', decode('${snapshot.toString('hex')}', 'hex'));
update taskspace_loro.legacy_cutover set phase = 'active' where singleton;
notify pgrst, 'reload schema';
commit;
select c.phase, c.owner_id, c.doc_id, d.head, encode(sha256(s.bytes), 'hex') as snapshot_sha256
  from taskspace_loro.legacy_cutover c join public.taskspace_loro_documents d on d.id = c.doc_id
  join taskspace_loro.snapshots s on s.doc_id = d.id where singleton;
`;
  return { sql, snapshot, nodes, manifest: { ...manifest, ownerId, snapshotSha256: digest(snapshot), sourceSha256: digest(original) } };
}
