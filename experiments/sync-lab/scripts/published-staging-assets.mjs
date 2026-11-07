import { pathToFileURL } from 'node:url';
import { fileHash } from './pwa-artifacts.mjs';
import { previewEnvironment, stagingBranch } from '../../../scripts/vercel-build.mjs';
import { stagingConfig } from '../src/staging-config.js';

export const stagingOrigin = 'https://taskapp-git-codex-compare-syn-366be3-willowyana3-2255s-projects.vercel.app';
// ログインを行う前に、既知の公開先・コミット・接続設定と全ファイルを照合する。
export async function publishedStagingAssets(origin, ref, { fetcher = fetch } = {}) {
  if (origin !== stagingOrigin || !/^[a-f0-9]{40}$/.test(ref || '')) throw new Error('確認済みの検証URLとコミットが必要です');
  const get = async (path) => {
    const response = await fetcher(origin + '/' + path, { redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!response.ok) throw new Error('公開検証版のファイルを取得できません');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error('検証成果物のファイルが大きすぎます');
    return bytes;
  };
  const manifest = JSON.parse(new TextDecoder().decode(await get('sync-staging.json')));
  const expected = stagingConfig(previewEnvironment);
  if (manifest?.format !== 1 || manifest.kind !== 'published-staging-app' || manifest.synthetic !== true
    || manifest.ref !== ref || manifest.branch !== stagingBranch
    || JSON.stringify(manifest.config) !== JSON.stringify(expected)) throw new Error('公開版のソースまたは接続先が一致しません');
  const entries = Object.entries(manifest.files || {}), paths = entries.map(([path]) => path);
  if (entries.length > 40 || !['index.html', 'sw.js', 'manifest.webmanifest'].every((path) => paths.includes(path))
    || !paths.some((path) => path.endsWith('.wasm'))) throw new Error('公開版の通常App・SW・WASMが揃っていません');
  const files = new Map();
  for (const [path, hash] of entries) {
    if (!path || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')
      || /[?#%:]/.test(path) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('公開成果物のパスまたはハッシュが不正です');
    const bytes = await get(path);
    if (fileHash(bytes) !== hash) throw new Error('公開版のファイルがmanifestと一致しません');
    files.set('/' + path, bytes);
  }
  const pwa = JSON.parse(new TextDecoder().decode(files.get('/manifest.webmanifest')));
  if (pwa.name !== 'fragments 検証' || pwa.start_url !== '/' || pwa.display !== 'standalone') throw new Error('検証用PWAの識別が一致しません');
  return { manifest, files };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { manifest, files } = await publishedStagingAssets(process.argv[2], process.argv[3]);
    console.log(JSON.stringify({ complete: true, published: true, ref: manifest.ref, version: manifest.version,
      projectRef: manifest.config.reference, files: files.size, productionChanged: false }));
  } catch (error) { console.log(JSON.stringify({ complete: false, phase: '公開成果物の取得と照合', errorType: error.name })); process.exitCode = 1; }
}
