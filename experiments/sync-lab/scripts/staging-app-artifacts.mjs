import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { artifactHashes } from './pwa-artifacts.mjs';
import { cutoverVerificationConfig } from './verify-staging-cutover.mjs';

// 公開設定もmanifestと照合し、別プロジェクトの画面へ検証パスワードを入力しない。
export async function loadStagingApp(manifest, env, cutover, source, dataRoot) {
  const config = cutoverVerificationConfig(env, cutover, source);
  if (manifest?.format !== 1 || manifest.kind !== 'staging-app' || manifest.synthetic !== true
    || manifest.ownerId !== cutover.ownerId || !/^[a-f0-9]{40}$/.test(manifest.ref || '')
    || Object.keys(config).some((key) => manifest.config?.[key] !== config[key])) throw new Error('同じ検証先へ固定した通常Appの成果物が必要です');
  const root = await realpath(dataRoot), directory = await realpath(manifest.directory);
  const dist = await realpath(resolve(directory, 'dist'));
  if (!directory.startsWith(root + sep) || !dist.startsWith(directory + sep)) throw new Error('検証室内の成果物だけを使えます');
  const hashes = await artifactHashes(dist), paths = Object.keys(hashes);
  if (!manifest.files || paths.length !== Object.keys(manifest.files).length || paths.some((path) => hashes[path] !== manifest.files[path])
    || !['index.html', 'sw.js', 'manifest.webmanifest'].every((path) => hashes[path])
    || !paths.some((path) => path.endsWith('.wasm'))) throw new Error('通常App・SW・WASMの成果物ハッシュが一致しません');
  const files = new Map();
  for (const path of paths) files.set('/' + path, await readFile(resolve(dist, path)));
  return { config, files };
}
