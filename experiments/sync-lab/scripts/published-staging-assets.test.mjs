import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedStagingAssets, stagingOrigin } from './published-staging-assets.mjs';
import { fileHash } from './pwa-artifacts.mjs';
import { vercelBuildPlan, stagingBranch } from '../../../scripts/vercel-build.mjs';

const ref = 'a'.repeat(40);
function fixture() {
  const config = { ...vercelBuildPlan({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: stagingBranch,
    VERCEL_GIT_REPO_OWNER: 'yohyng', VERCEL_GIT_REPO_SLUG: 'taskapp', VERCEL_GIT_COMMIT_SHA: ref }).config };
  const files = { 'index.html': '<h1>合成検証</h1>', 'sw.js': '/* 合成Worker */',
    'manifest.webmanifest': JSON.stringify({ name: 'Task Space 検証', start_url: '/', display: 'standalone' }), 'assets/engine.wasm': '合成WASM' };
  const manifest = { format: 1, kind: 'published-staging-app', synthetic: true, branch: stagingBranch, ref, config,
    files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, fileHash(value)])) };
  let requests = 0;
  const fetcher = async (url, options) => {
    requests++; assert.equal(options.redirect, 'error');
    const path = new URL(url).pathname.slice(1), body = path === 'sync-staging.json' ? JSON.stringify(manifest) : files[path];
    return new Response(body, { status: body === undefined ? 404 : 200 });
  };
  return { files, manifest, fetcher, requests: () => requests };
}
test('公開検証：指定コミット・接続先・全バイトとPWA識別を確認する', async () => {
  const f = fixture(), result = await publishedStagingAssets(stagingOrigin, ref, f);
  assert.equal(result.files.size, 4); assert.equal(f.requests(), 5);
});
test('公開検証：別URLや不正コミットでは要求せず、別ソース・本番接続・欠損WASMは拒む', async () => {
  const f = fixture();
  await assert.rejects(publishedStagingAssets('https://taskapp-delta-neon.vercel.app', ref, f));
  await assert.rejects(publishedStagingAssets(stagingOrigin, 'bad', f)); assert.equal(f.requests(), 0);
  for (const change of [x => x.ref = 'b'.repeat(40), x => x.config.url = 'https://eiyzlawmcyybchxzyozr.supabase.co', x => delete x.files['assets/engine.wasm']]) {
    const next = fixture(); change(next.manifest); await assert.rejects(publishedStagingAssets(stagingOrigin, ref, next)); assert.equal(next.requests(), 1);
  }
});
test('公開検証：配信後の改変・外へのパス・ログインHTMLを成功にしない', async () => {
  const changed = fixture(); changed.files['sw.js'] = '改変'; await assert.rejects(publishedStagingAssets(stagingOrigin, ref, changed), /一致/);
  const traversal = fixture(); traversal.manifest.files['../outside'] = 'a'.repeat(64); await assert.rejects(publishedStagingAssets(stagingOrigin, ref, traversal), /パス/);
  await assert.rejects(publishedStagingAssets(stagingOrigin, ref, { fetcher: async () => new Response('<html>ログイン</html>') }));
  await assert.rejects(publishedStagingAssets(stagingOrigin, ref, { fetcher: async () => new Response('', { status: 401 }) }));
});
