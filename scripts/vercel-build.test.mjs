import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { stagingBranch, productionBranch, inkDiagBranch, previewEnvironment, vercelBuildPlan } from './vercel-build.mjs';

const preview = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: stagingBranch,
  VERCEL_GIT_REPO_OWNER: 'yohyng', VERCEL_GIT_REPO_SLUG: 'taskapp', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) };
test('検証配信：指定ブランチのPreviewだけが検証先へ固定され、本番設定や秘密値を採らない', () => {
  const plan = vercelBuildPlan({ ...preview, LAB_SUPABASE_PROJECT_REF: 'eiyzlawmcyybchxzyozr', LAB_OWNER_PASSWORD: '秘密', VITE_SUPABASE_ANON_KEY: 'sb_secret_wrong' });
  assert.equal(plan.staging, true); assert.deepEqual(plan.viteArgs, ['build', '--mode', 'sync-staging']);
  assert.equal(plan.config.reference, 'wtshrgsmqavcytjmqjft'); assert.equal(plan.config.cutover, true);
  assert.equal(plan.config.docId, 'd04e4493-4311-442c-b9fb-b3ee52b3ecf2');
  assert.equal(JSON.stringify(plan).includes('秘密'), false); assert.equal(JSON.stringify(plan).includes('sb_secret_wrong'), false);
  assert.deepEqual(Object.keys(previewEnvironment).sort(), ['LAB_SUPABASE_CUTOVER', 'LAB_SUPABASE_DOCUMENT_ID', 'LAB_SUPABASE_PROJECT_REF', 'LAB_SUPABASE_PUBLISHABLE_KEY']);
});
test('検証配信：同じブランチでもProduction・環境欠損・別リポジトリ・不正コミットではビルドしない', () => {
  for (const change of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: undefined }, { VERCEL: undefined },
    { VERCEL_GIT_REPO_OWNER: 'other' }, { VERCEL_GIT_REPO_SLUG: 'other' }, { VERCEL_GIT_COMMIT_SHA: 'bad' }]) {
    assert.throws(() => vercelBuildPlan({ ...preview, ...change }), /Preview|本番/);
  }
});
test('検証配信：通常ブランチとローカルの既定ビルドは従来モードを維持する', async () => {
  for (const env of [{}, { ...preview, VERCEL_GIT_COMMIT_REF: 'claude/kind-fermi-sNjwi', VERCEL_ENV: 'production' },
    { ...preview, VERCEL_GIT_COMMIT_REF: 'other' }]) assert.deepEqual(vercelBuildPlan(env, { enabled: false }), { staging: false, viteArgs: ['build'] });
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.buildCommand, 'node scripts/vercel-build.mjs');
  assert.equal(config.installCommand, undefined); assert.equal(config.env, undefined); assert.equal(config.rewrites, undefined);
});
test('本番配信：有効化した共通原本と本番ブランチ・公開接続設定が揃う場合だけ新同期を選ぶ', () => {
  const release = { format: 1, enabled: true, reference: 'eiyzlawmcyybchxzyozr', rows: 11438,
    documentId: randomUUID(), migrationId: randomUUID(), ownerId: randomUUID(), snapshotSha256: 'a'.repeat(64) };
  const env = { ...preview, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: productionBranch,
    VITE_SUPABASE_URL: 'https://eiyzlawmcyybchxzyozr.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_synthetic' };
  const plan = vercelBuildPlan(env, release); assert.equal(plan.release, true); assert.deepEqual(plan.viteArgs, ['build', '--mode', 'sync-release']);
  assert.equal(plan.config.docId, release.documentId); assert.equal(plan.config.mode, 'production'); assert.equal(plan.config.cutover, true);
  for (const change of [{ VERCEL_GIT_COMMIT_REF: stagingBranch }, { VERCEL_GIT_REPO_OWNER: 'other' }, { VITE_SUPABASE_ANON_KEY: 'sb_secret_wrong' },
    { VITE_SUPABASE_URL: 'https://wtshrgsmqavcytjmqjft.supabase.co' }, { VERCEL_GIT_COMMIT_SHA: undefined }]) assert.throws(() => vercelBuildPlan({ ...env, ...change }, release));
  for (const change of [{ snapshotSha256: null }, { rows: 0 }, { ownerId: null }, { migrationId: 'bad' }, { reference: 'wtshrgsmqavcytjmqjft' }]) {
    assert.throws(() => vercelBuildPlan(env, { ...release, ...change }));
  }
  assert.equal(vercelBuildPlan(preview, release).staging, true);
});

test('計測配信：手書きの計測ページはPreviewだけに出し、本番ビルドには混ぜない', () => {
  const diag = { ...preview, VERCEL_GIT_COMMIT_REF: inkDiagBranch };
  assert.deepEqual(vercelBuildPlan(diag, { enabled: false }), { staging: false, isolated: true, viteArgs: ['build', '--mode', 'ink-diag'] });
  // 同じブランチでもProductionでは通常ビルド。ログイン情報は配信物へ渡さない（isolatedで空にする）。
  assert.deepEqual(vercelBuildPlan({ ...diag, VERCEL_ENV: 'production' }, { enabled: false }), { staging: false, viteArgs: ['build'] });
  assert.deepEqual(vercelBuildPlan({ ...preview, VERCEL_GIT_COMMIT_REF: productionBranch }, { enabled: false }), { staging: false, viteArgs: ['build'] });
});
