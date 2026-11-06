import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { LoroDoc } from 'loro-crdt';
import { stagingConfig, fixtureConfig, productionProject } from '../src/staging-config.js';
import { prepareStaging } from './prepare-supabase-staging.mjs';
import { verificationConfig } from './verify-supabase-staging.mjs';
import { loroViewRows } from '../src/loro-model.js';
import { postgresLog } from '../tests/support/loro-postgres.mjs';

const reference = 'abcdefghijklmnopqrst', docId = randomUUID();
const env = { LAB_SUPABASE_PROJECT_REF: reference, LAB_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', LAB_SUPABASE_DOCUMENT_ID: docId };
const jwt = (value) => `e30.${Buffer.from(JSON.stringify(value)).toString('base64url')}.synthetic`;

test('実接続設定：検証専用の公開鍵・文書IDだけを採り、本番と別プロジェクトへ固定する', () => {
  const config = stagingConfig({ ...env, LAB_OWNER_PASSWORD: 'not-for-browser', VITE_SUPABASE_URL: `https://${productionProject}.supabase.co`, VITE_SUPABASE_ANON_KEY: 'wrong' });
  assert.equal(config.url, `https://${reference}.supabase.co`); assert.equal(config.docId, docId);
  assert.equal(JSON.stringify(config).includes('not-for-browser'), false);
  assert.equal(stagingConfig({ ...env, LAB_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon', ref: reference }) }).reference, reference);
  assert.throws(() => stagingConfig({ ...env, LAB_SUPABASE_PROJECT_REF: productionProject }), /本番とは別/);
  assert.throws(() => stagingConfig({ ...env, LAB_SUPABASE_PROJECT_REF: `${reference}.evil.test` }), /本番とは別/);
});

test('実接続設定：管理鍵・他プロジェクトのJWT・欠損設定を拒み、製品やwindowの設定へ逃げない', () => {
  for (const key of ['sb_secret_sensitive', jwt({ role: 'service_role', ref: reference }), jwt({ role: 'anon', ref: '別のプロジェクト' }), 'broken', undefined]) {
    assert.throws(() => stagingConfig({ ...env, LAB_SUPABASE_PUBLISHABLE_KEY: key }), (error) => /公開|publishable/.test(error.message) && !error.message.includes('sensitive'));
  }
  assert.throws(() => stagingConfig({ VITE_SUPABASE_URL: 'https://example.test', VITE_SUPABASE_ANON_KEY: 'key' }), /本番とは別/);
  assert.throws(() => stagingConfig({ ...env, LAB_SUPABASE_DOCUMENT_ID: 'x);delete' }), /UUID/);
  assert.deepEqual(fixtureConfig({ key: 'fixture', docId: 'synthetic' }, 'http://127.0.0.1:4180'), { mode: 'fixture', url: 'http://127.0.0.1:4180', key: 'fixture', docId: 'synthetic', cutover: false });
  assert.equal(fixtureConfig({ key: 'fixture', docId: 'synthetic', cutover: 'true' }, 'http://127.0.0.1:4180').cutover, false);
  assert.equal(fixtureConfig({ key: 'fixture', docId: 'synthetic', cutover: true }, 'http://127.0.0.1:4180').cutover, true);
  assert.throws(() => fixtureConfig(null, 'http://127.0.0.1:4180'), /設定が必要/);
});

test('初期投入：二人の合成原本と一括SQLを作り、同一ユーザー・本番・再初期化を拒む', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'taskspace-staging-')), output = join(parent, 'new'), owner = randomUUID(), other = randomUUID();
  await assert.rejects(prepareStaging(output, productionProject, owner, other), /本番とは別/);
  await assert.rejects(prepareStaging(output, reference, owner, owner), /別々/);
  const manifest = await prepareStaging(output, reference, owner, other);
  const sql = await readFile(join(output, 'setup.sql'), 'utf8');
  assert.equal(manifest.synthetic, true); assert.equal(manifest.documents.length, 2);
  assert.match(sql, /begin;[\s\S]+create table[\s\S]+commit;/); assert.match(sql, /auth.users/);
  assert.doesNotMatch(sql, /on conflict|truncate|delete from|(?:insert into|update|delete from) (?:public\.)?outline_nodes/i);
  const snapshots = [...sql.matchAll(/decode\('([a-f0-9]+)', 'hex'\)/g)]; assert.equal(snapshots.length, 2);
  for (let i = 0; i < snapshots.length; i++) {
    const bytes = Buffer.from(snapshots[i][1], 'hex'), doc = new LoroDoc();
    try {
      assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.documents[i].sha256);
      doc.import(bytes); assert.equal(loroViewRows(doc).find((row) => row.id === 'probe').text, '検証用メモ');
    } finally { doc.free(); }
  }
  await assert.rejects(prepareStaging(output, reference, owner, other), /EEXIST/);
});

test('実サービス検証：合成文書のmanifestと二アカウントが揃うまで接続・編集しない', () => {
  const credentials = { LAB_OWNER_EMAIL: 'owner@example.test', LAB_OWNER_PASSWORD: 'a', LAB_OTHER_EMAIL: 'other@example.test', LAB_OTHER_PASSWORD: 'b' };
  const otherDocId = randomUUID(), supplied = { ...env, ...credentials, LAB_SUPABASE_OTHER_DOCUMENT_ID: otherDocId };
  const manifest = { format: 1, synthetic: true, projectRef: reference, documents: [
    { documentId: docId, ownerId: randomUUID(), sha256: 'a'.repeat(64) }, { documentId: otherDocId, ownerId: randomUUID(), sha256: 'b'.repeat(64) },
  ] };
  assert.equal(verificationConfig(supplied, manifest).docId, docId);
  for (const replacement of [undefined, { ...manifest, synthetic: false }, { ...manifest, projectRef: productionProject }]) {
    assert.throws(() => verificationConfig(supplied, replacement), /manifest/);
  }
  assert.throws(() => verificationConfig({ ...supplied, LAB_OTHER_PASSWORD: '' }, manifest), /アカウント/);
  assert.throws(() => verificationConfig({ ...supplied, LAB_OTHER_EMAIL: credentials.LAB_OWNER_EMAIL }, manifest), /二人/);
});

test('初期投入の実DB：生成したSQLが二文書を保存し、再投入・ユーザー欠損は全体を戻す', { skip: process.env.LAB_POWERSYNC !== '1' }, async () => {
  const db = await postgresLog(), client = await db.pool.connect(), owner = randomUUID(), other = randomUUID();
  const parent = await mkdtemp(join(tmpdir(), 'taskspace-staging-sql-'));
  try {
    // Authサービスの代役となる表は使い捨てlab_source内だけに置く。実JWTの検査には使わない。
    await client.query('create table if not exists auth.users(id uuid primary key)');
    await client.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    const output = join(parent, 'valid'), manifest = await prepareStaging(output, reference, owner, other);
    const sql = await readFile(join(output, 'setup.sql'), 'utf8'); await client.query(sql);
    for (const entry of manifest.documents) {
      const result = await db.exchange(entry.ownerId, entry.documentId);
      assert.equal(result.head, 0); assert.equal(createHash('sha256').update(Buffer.from(result.snapshot, 'base64')).digest('hex'), entry.sha256);
    }
    await assert.rejects(client.query(sql), /duplicate key/); await client.query('rollback');
    assert.equal((await db.exchange(owner, manifest.documents[0].documentId)).head, 0);
    const missingDir = join(parent, 'missing'), missing = await prepareStaging(missingDir, reference, owner, randomUUID());
    await assert.rejects(client.query(await readFile(join(missingDir, 'setup.sql'), 'utf8')), /ユーザーが見つかりません/);
    await client.query('rollback');
    const partial = await client.query('select id from public.taskspace_loro_documents where id = any($1::uuid[])', [missing.documents.map((entry) => entry.documentId)]);
    assert.equal(partial.rowCount, 0);
  } finally { await client.query('rollback'); client.release(); await db.close(); }
});
