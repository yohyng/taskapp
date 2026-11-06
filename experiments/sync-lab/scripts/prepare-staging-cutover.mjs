import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stagingProject, documentId } from '../src/staging-config.js';
import { seedOutlineDocument } from '../src/outline-model.js';

export const stagingTables = ['tasks', 'categories', 'project_rules', 'project_order', 'tray_items', 'app_settings', 'outline_nodes'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

// 入力は既存の合成manifestだけ。利用者のJSONや本番のデータから試験原本を作らない。
export async function prepareStagingCutover(directory, source) {
  stagingProject(source?.projectRef);
  if (source.format !== 1 || source.synthetic !== true || source.documents?.length !== 2) throw new Error('既存の合成二文書のmanifestが必要です');
  const documents = source.documents.map((entry) => ({ documentId: documentId(entry.documentId), ownerId: documentId(entry.ownerId), sha256: entry.sha256 }));
  if (documents[0].ownerId === documents[1].ownerId || documents[0].documentId === documents[1].documentId
    || documents.some((entry) => !/^[a-f0-9]{64}$/.test(entry.sha256))) throw new Error('合成二文書の所有者と原本を確認できません');
  const ownerId = documents[0].ownerId, docId = randomUUID(), migrationId = randomUUID();
  const at = '2026-01-01T00:00:00.000Z';
  const nodes = [
    { id: 'probe', text: '切り替え検証のメモ', createdAt: at, updatedAt: at,
      children: [{ id: 'child', text: '親子と並びも引き継ぐ', createdAt: at, updatedAt: at, children: [] }] },
    { id: 'other', text: '別の端末で続きを書く', createdAt: at, updatedAt: at, children: [] },
  ];
  const rows = [];
  function flatten(items, parentId = null) {
    items.forEach((node, order) => {
      rows.push({ id: node.id, parent_id: parentId, sort_order: order, text: node.text, collapsed: false,
        completed: false, favorite: false, date: null, heading_level: null, text_color: null,
        bg_color: null, image_width: null, created_at: node.createdAt, updated_at: node.updatedAt });
      flatten(node.children, node.id);
    });
  }
  flatten(nodes);
  const doc = seedOutlineDocument(nodes);
  let bytes;
  try { bytes = Buffer.from(doc.export({ mode: 'snapshot' })); } finally { doc.free(); }
  const schema = await readFile(new URL('../infra/staging-app.sql', import.meta.url), 'utf8');
  const fence = await readFile(new URL('../infra/loro-cutover.sql', import.meta.url), 'utf8');
  const rowJson = JSON.stringify(rows), sortedJson = JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
  const sql = `-- 検証専用：${source.projectRef}。本番には実行しない。合成表を新規作成し、一取引で切り替える。
begin;
select pg_advisory_xact_lock(731003);
select pg_advisory_xact_lock(1414745932, 1);
-- 前回の実サービス検証に使った二ユーザー・二原本が一致する場所だけを許す。
do $$ begin
${documents.map((entry) => `  if not exists (select 1 from auth.users u join public.taskspace_loro_documents d on d.owner_id = u.id
    join taskspace_loro.snapshots s on s.doc_id = d.id
    where u.id = '${entry.ownerId}' and d.id = '${entry.documentId}' and encode(sha256(s.bytes), 'hex') = '${entry.sha256}') then
    raise exception '既存の検証ユーザー・合成原本が一致しません';
  end if;`).join('\n')}
  if ${stagingTables.map((table) => `to_regclass('public.${table}') is not null`).join('\n    or ')}
    or to_regclass('taskspace_loro.legacy_cutover') is not null then
    raise exception '既存の表・切り替え設定には触れません。検証専用の新規環境を確認してください';
  end if;
end $$;
${schema}
${stagingTables.map((table) => `alter table public.${table} add column owner_id uuid not null default '${ownerId}';
revoke all on public.${table} from public, anon, authenticated;
grant select, insert, update, delete on public.${table} to authenticated;
alter table public.${table} enable row level security;
create policy staging_owner on public.${table} to authenticated
  using (owner_id = '${ownerId}'::uuid and (select auth.uid()) = '${ownerId}'::uuid)
  with check (owner_id = '${ownerId}'::uuid and (select auth.uid()) = '${ownerId}'::uuid);`).join('\n')}
${fence}
insert into public.outline_nodes (${Object.keys(rows[0]).join(', ')})
  select ${Object.keys(rows[0]).join(', ')} from jsonb_populate_recordset(null::public.outline_nodes, ${literal(rowJson)}::jsonb);
insert into public.tasks(id, title, plain, scheduled_date) values ('task-probe', 'タスクも同じ画面で使える', true, current_date::text);
insert into public.categories(id, key, label, tone, sort_order) values ('STAGING', 'STAGING', '検証用', 'blue', 0);
-- idle中の最後の書き込みが確定した後に停止し、同じ取引の中で凍結済みの全行を照合する。
update taskspace_loro.legacy_cutover set phase = 'preparing', migration_id = '${migrationId}', owner_id = '${ownerId}', doc_id = '${docId}' where singleton;
do $$ begin
  if (select jsonb_agg(to_jsonb(n) - 'owner_id' order by id) from public.outline_nodes n) is distinct from ${literal(sortedJson)}::jsonb then
    raise exception '凍結した旧データと合成原本が一致しません';
  end if;
end $$;
insert into public.taskspace_loro_documents(id, owner_id) values ('${docId}', '${ownerId}');
insert into taskspace_loro.snapshots(doc_id, bytes) values ('${docId}', decode('${bytes.toString('hex')}', 'hex'));
update taskspace_loro.legacy_cutover set phase = 'active' where singleton;
-- タスク側も実サービスで通知する。旧表は停止済みなので通知対象に足さない。
do $$ declare tab text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tab in array array['tasks','categories','project_rules','project_order','tray_items','app_settings'] loop
      execute format('alter table public.%I replica identity full', tab);
      execute format('alter publication supabase_realtime add table public.%I', tab);
    end loop;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
select '検証用の切り替え準備が完了しました' as result;
`;
  const manifest = { format: 1, kind: 'staging-cutover', synthetic: true, projectRef: source.projectRef,
    ownerId, documentId: docId, migrationId, sourceDocuments: documents, snapshotSha256: hash(bytes), sqlSha256: hash(sql), nodes, rows };
  await mkdir(directory);
  for (const [name, value] of [['setup.sql', sql], ['manifest.json', JSON.stringify(manifest, null, 2)], ['snapshot.bin', bytes]]) {
    await writeFile(join(directory, name), value, { flag: 'wx' });
  }
  await writeFile(join(directory, 'browser.env.example'), `LAB_SUPABASE_PROJECT_REF=${source.projectRef}\nLAB_SUPABASE_PUBLISHABLE_KEY=sb_publishable_既存の検証用公開鍵\nLAB_SUPABASE_DOCUMENT_ID=${docId}\nLAB_SUPABASE_CUTOVER=1\n`, { flag: 'wx' });
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , source, directory] = process.argv;
  if (!source || !directory) throw new Error('既存の合成manifestと新規出力フォルダーを指定してください');
  const manifest = await prepareStagingCutover(directory, JSON.parse(await readFile(source, 'utf8')));
  console.log(JSON.stringify({ projectRef: manifest.projectRef, documentId: manifest.documentId, synthetic: true }));
}
