import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stagingBranch, previewEnvironment, vercelBuildPlan } from './vercel-build.mjs';

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
    assert.throws(() => vercelBuildPlan({ ...preview, ...change }), /Preview/);
  }
});
test('検証配信：通常ブランチとローカルの既定ビルドは従来モードを維持する', async () => {
  for (const env of [{}, { ...preview, VERCEL_GIT_COMMIT_REF: 'claude/kind-fermi-sNjwi', VERCEL_ENV: 'production' },
    { ...preview, VERCEL_GIT_COMMIT_REF: 'other' }]) assert.deepEqual(vercelBuildPlan(env), { staging: false, viteArgs: ['build'] });
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.buildCommand, 'node scripts/vercel-build.mjs');
  assert.equal(config.installCommand, undefined); assert.equal(config.env, undefined); assert.equal(config.rewrites, undefined);
});
