import { readFile } from 'node:fs/promises';
import { request } from '@playwright/test';
import { publishedStagingAssets, stagingOrigin } from './published-staging-assets.mjs';

export function publishedAccessUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('検証版の共有リンクが必要です'); }
  if (url.origin !== stagingOrigin || url.pathname !== '/' || url.hash || url.username || url.password
    || [...url.searchParams.keys()].join(',') !== '_vercel_share'
    || !/^[A-Za-z0-9_-]{32}$/.test(url.searchParams.get('_vercel_share') || '')) throw new Error('確認済みの検証版だけの共有リンクが必要です');
  return url.href;
}
// 共有値は非公開ファイルからだけ読み、同じorigin以外へ転送しない。返すCookieもメモリー内だけで使う。
export async function openPublishedStaging(path, ref, { newContext = (options) => request.newContext(options) } = {}) {
  const access = JSON.parse(await readFile(path, 'utf8')), url = publishedAccessUrl(access.url);
  if (!/^[a-f0-9]{40}$/.test(ref || '')) throw new Error('配信するコミットの照合が必要です');
  const context = await newContext({ extraHTTPHeaders: { 'x-vercel-skip-toolbar': '1' } });
  try {
    let at = url;
    for (let count = 0; ; count++) {
      const response = await context.get(at, { maxRedirects: 0, timeout: 20000 });
      if (response.status() === 200) break;
      const location = response.headers().location;
      if (count >= 3 || ![301, 302, 303, 307, 308].includes(response.status()) || !location) throw new Error('検証版の共有アクセスを確認できません');
      const next = new URL(location, at);
      if (next.origin !== stagingOrigin || next.username || next.password) throw new Error('共有リンクの外部転送は許可しません');
      at = next.href;
    }
    const result = await publishedStagingAssets(stagingOrigin, ref, { fetcher: async (target) => {
      const response = await context.get(target, { maxRedirects: 0, timeout: 15000 });
      return new Response(await response.body(), { status: response.status(), headers: response.headers() });
    } });
    const state = await context.storageState();
    return { ...result, accessCookies: state.cookies };
  } finally { await context.dispose(); }
}
