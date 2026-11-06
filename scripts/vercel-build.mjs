import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { stagingConfig } from '../experiments/sync-lab/src/staging-config.js';
import { artifactHashes } from '../experiments/sync-lab/scripts/pwa-artifacts.mjs';
import { releaseConfig } from '../experiments/sync-lab/src/release-config.js';
import { documentId, productionProject } from '../experiments/sync-lab/src/staging-config.js';

export const stagingBranch = 'codex/compare-sync-engines';
export const productionBranch = 'claude/kind-fermi-sNjwi';
const productionRelease = JSON.parse(await readFile(new URL('./production-release.json', import.meta.url), 'utf8'));
// ブラウザーへ配る公開設定だけを固定する。ログイン情報・GASの合言葉は配信物に含めない。
export const previewEnvironment = Object.freeze({
  LAB_SUPABASE_PROJECT_REF: 'wtshrgsmqavcytjmqjft',
  LAB_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_9pgz0AiHIkGEjtzsIkvjFQ_ki9XhWc5',
  LAB_SUPABASE_DOCUMENT_ID: 'd04e4493-4311-442c-b9fb-b3ee52b3ecf2',
  LAB_SUPABASE_CUTOVER: '1',
});
export function vercelBuildPlan(env, release = productionRelease) {
  if (release.enabled === true && env.VERCEL_ENV === 'production') {
    if (env.VERCEL !== '1' || env.VERCEL_GIT_COMMIT_REF !== productionBranch || env.VERCEL_GIT_REPO_OWNER !== 'yohyng'
      || env.VERCEL_GIT_REPO_SLUG !== 'taskapp' || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '')
      || release.format !== 1 || release.reference !== productionProject || !/^[a-f0-9]{64}$/.test(release.snapshotSha256 || '')
      || !Number.isSafeInteger(release.rows) || release.rows < 1) throw new Error('本番への切替結果と配信元を確認できません');
    documentId(release.ownerId); documentId(release.migrationId); documentId(release.documentId);
    const config = releaseConfig({ ...env, VITE_OUTLINE_DOCUMENT_ID: release.documentId, VITE_OUTLINE_CUTOVER: '1' });
    return { staging: false, release: true, viteArgs: ['build', '--mode', 'sync-release'], config };
  }
  if (env.VERCEL_GIT_COMMIT_REF !== stagingBranch) return { staging: false, viteArgs: ['build'] };
  // ブランチ名だけでは本番への誤配信を防げない。環境とリポジトリも揃わなければ停止する。
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_REPO_OWNER !== 'yohyng'
    || env.VERCEL_GIT_REPO_SLUG !== 'taskapp' || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '')) {
    throw new Error('新同期の検証版は指定リポジトリのVercel Previewだけで生成できます');
  }
  return { staging: true, viteArgs: ['build', '--mode', 'sync-staging'], config: stagingConfig(previewEnvironment) };
}
export async function buildVercel(env = process.env) {
  const plan = vercelBuildPlan(env), root = fileURLToPath(new URL('../', import.meta.url));
  const run = (command, args, childEnv) => {
    const result = spawnSync(command, args, { cwd: root, env: childEnv, stdio: 'inherit',
      shell: process.platform === 'win32' && command === 'npx' });
    if (result.error || result.status !== 0) throw new Error('配信ビルドの処理が完了しませんでした');
  };
  if (plan.staging || plan.release) {
    // CIと同じ既存のpackage manager・lockを使い、Vercelの既定npmだけでは入らない同期側の依存を取得する。
    run('npx', ['--yes', '--package=pnpm@11.25.0', '--', 'pnpm', '--dir', 'experiments/sync-lab', 'install', '--frozen-lockfile'], env);
  }
  run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), ...plan.viteArgs],
    plan.staging ? { ...env, ...previewEnvironment } : plan.release ? { ...env, VITE_OUTLINE_DOCUMENT_ID: plan.config.docId, VITE_OUTLINE_CUTOVER: '1' } : env);
  if (plan.staging || plan.release) {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const manifest = { format: 1, kind: plan.release ? 'published-release-app' : 'published-staging-app', synthetic: !plan.release, version: pkg.version,
      ref: env.VERCEL_GIT_COMMIT_SHA, branch: plan.release ? productionBranch : stagingBranch, config: plan.config,
      ...(plan.release ? { snapshotSha256: productionRelease.snapshotSha256, rows: productionRelease.rows } : {}),
      files: await artifactHashes(resolve(root, 'dist')) };
    await writeFile(resolve(root, plan.release ? 'dist/sync-release.json' : 'dist/sync-staging.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log('指定した同期先の通常App/PWAと配信照合用manifestを生成しました');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await buildVercel(); } catch { console.error('検証版の配信設定またはビルドを確認してください'); process.exitCode = 1; }
}
