import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { LoroDoc } from 'loro-crdt';
import { prepareStaging } from './prepare-supabase-staging.mjs';
import { prepareStagingCutover, stagingTables } from './prepare-staging-cutover.mjs';
import { productionProject } from '../src/staging-config.js';
import { loroViewRows } from '../src/loro-model.js';
import { postgresLog } from '../tests/support/loro-postgres.mjs';
import { cutoverVerificationConfig } from './verify-staging-cutover.mjs';

const reference = 'abcdefghijklmnopqrst';
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'taskspace-cutover-setup-'));
  const source = await prepareStaging(join(parent, 'source'), reference, randomUUID(), randomUUID());
  const directory = join(parent, 'cutover'), manifest = await prepareStagingCutover(directory, source);
  return { parent, directory, source, manifest, sql: await readFile(join(directory, 'setup.sql'), 'utf8') };
}

test('切替用の準備：元の二原本とは別の合成原本を生成し、親子・順序・全行を保存する', async () => {
  const f = await fixture(), bytes = await readFile(join(f.directory, 'snapshot.bin')), doc = new LoroDoc();
  try {
    assert.equal(f.manifest.synthetic, true); assert.equal(f.manifest.kind, 'staging-cutover');
    assert.equal(hash(bytes), f.manifest.snapshotSha256); assert.equal(hash(f.sql), f.manifest.sqlSha256);
    assert.ok(f.source.documents.every((entry) => entry.documentId !== f.manifest.documentId));
    doc.import(bytes);
    const rows = loroViewRows(doc);
    assert.deepEqual(rows.map(({ id, parentId, order, text }) => ({ id, parentId, order, text })).sort((a, b) => a.id.localeCompare(b.id)),
      f.manifest.rows.map(({ id, parent_id, sort_order, text }) => ({ id, parentId: parent_id, order: sort_order, text })).sort((a, b) => a.id.localeCompare(b.id)));
    const embedded = Buffer.from(/decode\('([a-f0-9]+)', 'hex'\)/.exec(f.sql)[1], 'hex');
    assert.deepEqual(embedded, bytes);
    assert.ok(f.sql.indexOf("phase = 'preparing'") < f.sql.indexOf('凍結した旧データ'));
    assert.ok(f.sql.indexOf('凍結した旧データ') < f.sql.indexOf('insert into taskspace_loro.snapshots'));
    assert.ok(f.sql.indexOf('insert into taskspace_loro.snapshots') < f.sql.indexOf("phase = 'active' where"));
    await assert.rejects(prepareStagingCutover(f.directory, f.source), /EEXIST/);
  } finally { doc.free(); }
});

test('切替用の準備：本番・実データ・所有者不一致・壊れた原本を入力に採らない', async () => {
  const f = await fixture(), output = join(f.parent, 'denied');
  for (const source of [undefined, { ...f.source, projectRef: productionProject }, { ...f.source, synthetic: false },
    { ...f.source, documents: [f.source.documents[0], f.source.documents[0]] },
    { ...f.source, documents: [{ ...f.source.documents[0], sha256: 'broken' }, f.source.documents[1]] }]) {
    await assert.rejects(prepareStagingCutover(output, source));
  }
});

test('切替の実接続設定：既存検証と同じ原本・所有者・プロジェクトだけを採る', async () => {
  const f = await fixture(), env = { LAB_SUPABASE_PROJECT_REF: reference, LAB_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
    LAB_SUPABASE_DOCUMENT_ID: f.source.documents[0].documentId, LAB_SUPABASE_OTHER_DOCUMENT_ID: f.source.documents[1].documentId,
    LAB_OWNER_EMAIL: 'owner@example.test', LAB_OWNER_PASSWORD: 'private-owner', LAB_OTHER_EMAIL: 'other@example.test', LAB_OTHER_PASSWORD: 'private-other' };
  const config = cutoverVerificationConfig(env, f.manifest, f.source);
  assert.equal(config.cutover, true); assert.equal(config.docId, f.manifest.documentId);
  assert.doesNotMatch(JSON.stringify(config), /private-/);
  for (const replacement of [{ ...f.manifest, projectRef: productionProject }, { ...f.manifest, synthetic: false },
    { ...f.manifest, ownerId: f.source.documents[1].ownerId }, { ...f.manifest, documentId: f.source.documents[0].documentId },
    { ...f.manifest, sourceDocuments: [] }]) assert.throws(() => cutoverVerificationConfig(env, replacement, f.source));
});

// 既存切替テストの表と混ぜないため、CIの専用Postgresジョブで一回だけ実行する。
test('切替用SQLの実DB：誤接続・既存表・凍結原本の不一致を戻し、正しい合成切替だけ許す', { skip: process.env.LAB_STAGING_SETUP !== '1' }, async () => {
  const f = await fixture(), db = await postgresLog(), client = await db.pool.connect();
  const [owner, other] = f.source.documents.map((entry) => entry.ownerId);
  async function rejected(sql, pattern) {
    try { await assert.rejects(client.query(sql), pattern); } finally { await client.query('rollback'); }
  }
  async function as(id, sql, values = []) {
    return db.transaction(id, (connection) => connection.query(sql, values));
  }
  async function absent() {
    for (const table of [...stagingTables.map((name) => `public.${name}`), 'taskspace_loro.legacy_cutover']) {
      assert.equal((await client.query('select to_regclass($1) value', [table])).rows[0].value, null);
    }
    assert.equal((await client.query('select id from public.taskspace_loro_documents where id=$1', [f.manifest.documentId])).rowCount, 0);
  }
  try {
    await client.query('create table auth.users(id uuid primary key)');
    await client.query('insert into auth.users values($1),($2)', [owner, other]);
    await client.query(await readFile(join(f.parent, 'source/setup.sql'), 'utf8'));
    const wrongSource = f.sql.replace(f.source.documents[0].sha256, '0'.repeat(64));
    await rejected(wrongSource, /合成原本が一致/); await absent();
    await client.query('delete from auth.users where id=$1', [other]);
    await rejected(f.sql, /合成原本が一致/); await absent();
    await client.query('insert into auth.users values($1)', [other]);
    await client.query('create table public.tasks(id text primary key)');
    await client.query("insert into public.tasks values('残す')");
    await rejected(f.sql, /既存の表/);
    assert.deepEqual((await client.query('select * from public.tasks')).rows, [{ id: '残す' }]);
    await client.query('drop table public.tasks');
    // 凍結後の比較だけを崩し、表の作成・旧行投入・停止設定もすべて巻き戻ることを確認する。
    const compareAt = f.sql.indexOf('is distinct from ');
    const mismatch = f.sql.slice(0, compareAt) + f.sql.slice(compareAt).replace('切り替え検証のメモ', '別の本文');
    await rejected(mismatch, /凍結した旧データ/); await absent();
    await client.query(f.sql);
    const route = (await as(owner, 'select public.taskspace_loro_cutover_route() value')).rows[0].value;
    assert.deepEqual(route, { format: 1, ownerId: owner, docId: f.manifest.documentId, migrationId: f.manifest.migrationId, legacyWritesBlocked: true });
    const native = await db.exchange(owner, f.manifest.documentId);
    assert.equal(native.head, 0); assert.equal(hash(Buffer.from(native.snapshot, 'base64')), f.manifest.snapshotSha256);
    await assert.rejects(as(owner, "update public.outline_nodes set text='古い書き戻し' where id='存在しない行'"), { code: '55000' });
    await assert.rejects(as(other, 'select public.taskspace_loro_cutover_route()'), { code: '42501' });
    await assert.rejects(db.transaction(null, (connection) => connection.query('select public.taskspace_loro_cutover_route()'), 'anon'), { code: '42501' });
    for (const table of stagingTables) {
      assert.equal((await as(other, `select * from public.${table}`)).rowCount, 0);
      if (table !== 'outline_nodes') {
        const key = table === 'project_order' ? 'category' : table === 'app_settings' ? 'key' : 'id';
        await as(owner, `insert into public.${table}(${key}) values('権限検証')`);
        await as(owner, `update public.${table} set ${key}='更新済み' where ${key}='権限検証'`);
        assert.equal((await as(other, `delete from public.${table} where ${key}='更新済み'`)).rowCount, 0);
        await assert.rejects(as(other, `insert into public.${table}(${key}) values('他人')`), { code: '42501' });
        await as(owner, `delete from public.${table} where ${key}='更新済み'`);
      }
    }
    await rejected(f.sql, /既存の表/);
    assert.equal((await db.exchange(owner, f.manifest.documentId)).head, 0);
    for (const entry of f.source.documents) {
      const old = await db.exchange(entry.ownerId, entry.documentId);
      assert.equal(old.head, 0); assert.equal(hash(Buffer.from(old.snapshot, 'base64')), entry.sha256);
    }
  } finally { await client.query('rollback'); client.release(); await db.close(); }
});
