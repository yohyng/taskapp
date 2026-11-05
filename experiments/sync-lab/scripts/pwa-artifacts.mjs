import { readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

export const fileHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function artifactGit(repository, args, { encoding = 'utf8', env = process.env } = {}) {
  // CIのcheckoutとコンテナーでは所有者が違う。この呼出しの対象だけを許可し、
  // ユーザーのglobal設定や、他のリポジトリへの信頼を変更しない。
  return execFileSync('git', ['-c', `safe.directory=${resolve(repository).replaceAll('\\', '/')}`, ...args],
    { cwd: repository, encoding, env, maxBuffer: 100 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
export async function compatibleLocks(current, fixed) {
  const npm = async (root) => Object.entries(JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8')).packages).filter(([key]) => key !== '');
  const pnpm = async (root) => (await readFile(resolve(root, 'experiments/sync-lab/pnpm-lock.yaml'), 'utf8')).replaceAll('\r\n', '\n');
  // Gitの展開とWindowsのcheckoutでは改行だけが違う。配信物のハッシュ比較とは分ける。
  return JSON.stringify(await npm(current)) === JSON.stringify(await npm(fixed)) && await pnpm(current) === await pnpm(fixed);
}
export async function artifactHashes(directory) {
  const files = {};
  async function inspect(at) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = resolve(at, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if (entry.isFile()) files[relative(directory, path).replaceAll('\\', '/')] = fileHash(await readFile(path));
      else throw new Error('配信成果物には通常のファイルだけを使います');
    }
  }
  await inspect(directory); return files;
}

// 試験中の再ビルドや違う成果物の混入を防ぐ。ハッシュを確認したバイト列だけを配信する。
export async function loadPwaArtifacts(manifest, dataRoot) {
  if (manifest?.format !== 1 || manifest.synthetic !== true || manifest.config?.mode !== 'production'
    || manifest.config.url !== 'http://127.0.0.1:4183' || manifest.config.cutover !== true) throw new Error('合成PWAの配信切替manifestが必要です');
  const root = await realpath(dataRoot), result = {};
  for (const name of ['compatible', 'latest']) {
    const entry = manifest.versions?.[name];
    if (!entry?.files || !/^[a-f0-9]{40}$/.test(entry.ref || '')) throw new Error('配信成果物のソースとハッシュが必要です');
    const directory = await realpath(entry.directory);
    if (!directory.startsWith(root + sep)) throw new Error('検証室の保存先にある配信成果物が必要です');
    const files = new Map();
    for (const [path, hash] of Object.entries(entry.files)) {
      if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('配信成果物のファイル名かハッシュが不正です');
      const file = await realpath(resolve(directory, path));
      if (!file.startsWith(directory + sep)) throw new Error('配信成果物の外のファイルは使えません');
      const bytes = await readFile(file);
      if (fileHash(bytes) !== hash) throw new Error('配信成果物のハッシュが一致しません');
      files.set('/' + path, bytes);
    }
    if (!['/index.html', '/sw.js', '/manifest.webmanifest'].every((path) => files.has(path)) || ![...files.keys()].some((path) => path.endsWith('.wasm'))) throw new Error('通常入口・Service Worker・WASMを含む成果物が必要です');
    result[name] = files;
  }
  if (result.compatible.get('/sw.js').equals(result.latest.get('/sw.js'))) throw new Error('配信切替には異なる二つのService Workerが必要です');
  return result;
}
