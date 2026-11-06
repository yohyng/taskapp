import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifactHashes } from './pwa-artifacts.mjs';
import { stagingConfig } from '../src/staging-config.js';
import { loadStagingApp } from './staging-app-artifacts.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'taskspace-real-app-artifacts-')), directory = join(root, 'app');
  const dist = join(directory, 'dist'); await mkdir(dist, { recursive: true });
  for (const [name, body] of [['index.html', '通常App'], ['sw.js', 'Worker'], ['manifest.webmanifest', '{}'], ['engine.wasm', '合成WASM']]) await writeFile(join(dist, name), body);
  const source = { format: 1, synthetic: true, projectRef: 'abcdefghijklmnopqrst', documents: Array.from({ length: 2 }, () => ({ documentId: randomUUID(), ownerId: randomUUID(), sha256: 'a'.repeat(64) })) };
  const cutover = { format: 1, kind: 'staging-cutover', synthetic: true, projectRef: source.projectRef, ownerId: source.documents[0].ownerId,
    sourceDocuments: source.documents, documentId: randomUUID(), migrationId: randomUUID(), snapshotSha256: 'b'.repeat(64), sqlSha256: 'c'.repeat(64) };
  const env = { LAB_SUPABASE_PROJECT_REF: source.projectRef, LAB_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
    LAB_SUPABASE_DOCUMENT_ID: source.documents[0].documentId, LAB_SUPABASE_OTHER_DOCUMENT_ID: source.documents[1].documentId,
    LAB_OWNER_EMAIL: 'a@example.test', LAB_OTHER_EMAIL: 'b@example.test', LAB_OWNER_PASSWORD: 'private-a', LAB_OTHER_PASSWORD: 'private-b' };
  const config = stagingConfig({ ...env, LAB_SUPABASE_DOCUMENT_ID: cutover.documentId, LAB_SUPABASE_CUTOVER: '1' });
  const manifest = { format: 1, kind: 'staging-app', synthetic: true, ownerId: cutover.ownerId, directory, config, ref: 'd'.repeat(40), files: await artifactHashes(dist) };
  return { root, dist, env, source, cutover, manifest };
}

test('実接続PWAの検証：同じ合成切替・所有者・公開設定と全ファイルのハッシュを照合する', async () => {
  const f = await fixture(), loaded = await loadStagingApp(f.manifest, f.env, f.cutover, f.source, f.root);
  assert.equal(loaded.config.cutover, true); assert.equal(loaded.files.get('/index.html').toString(), '通常App');
  assert.doesNotMatch(JSON.stringify(loaded.config), /private-/);
  await writeFile(join(f.dist, 'sw.js'), '差し替わった版');
  assert.equal(loaded.files.get('/sw.js').toString(), 'Worker');
  await assert.rejects(loadStagingApp(f.manifest, f.env, f.cutover, f.source, f.root), /ハッシュが一致/);
});

test('実接続PWAの検証：別の接続先・所有者・外部成果物・WASM欠損を実行前に拒む', async () => {
  const f = await fixture();
  for (const manifest of [{ ...f.manifest, synthetic: false }, { ...f.manifest, ownerId: f.source.documents[1].ownerId },
    { ...f.manifest, config: { ...f.manifest.config, url: 'https://eiyzlawmcyybchxzyozr.supabase.co' } },
    { ...f.manifest, config: { ...f.manifest.config, key: 'sb_publishable_other' } },
    { ...f.manifest, directory: f.root }, { ...f.manifest, files: { ...f.manifest.files, 'outside.js': 'a'.repeat(64) } }]) {
    await assert.rejects(loadStagingApp(manifest, f.env, f.cutover, f.source, f.root));
  }
  delete f.manifest.files['engine.wasm'];
  await assert.rejects(loadStagingApp(f.manifest, f.env, f.cutover, f.source, f.root), /ハッシュが一致/);
});
