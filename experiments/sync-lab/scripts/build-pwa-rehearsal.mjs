import { build } from 'vite';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { productionProject } from '../src/staging-config.js';
import { artifactHashes, loadPwaArtifacts, compatibleLocks } from './pwa-artifacts.mjs';

// 本番向け入口を初めて備えた版。古いfixture専用クライアントをPWAの切り戻し先にしない。
const compatibleRef = 'c9da85005ec7a85663b6d99ba55b54e75d97b355';
const repository = fileURLToPath(new URL('../../../', import.meta.url)), lab = fileURLToPath(new URL('../', import.meta.url));
const data = join(lab, '.data'); await mkdir(data, { recursive: true });
const directory = await mkdtemp(join(data, 'pwa-rehearsal-')), source = join(directory, 'source'); await mkdir(source);
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
if (git('rev-parse', `${compatibleRef}^{commit}`) !== compatibleRef) throw new Error('互換版の固定コミットがありません');
const archive = join(directory, 'source.tar');
await writeFile(archive, execFileSync('git', ['archive', '--format=tar', compatibleRef], { cwd: repository, maxBuffer: 100 * 1024 * 1024 }));
execFileSync('tar', ['-xf', archive, '-C', source]);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
if (!await compatibleLocks(repository, source)) throw new Error('互換版と最新版の固定依存が違うため、別々の準備が必要です');
await symlink(join(repository, 'node_modules'), join(source, 'node_modules'), 'junction');
await symlink(join(lab, 'node_modules'), join(source, 'experiments/sync-lab/node_modules'), 'junction');
const config = { mode: 'production', url: 'http://127.0.0.1:4183', key: randomUUID(), docId: randomUUID(), cutover: true };
const manifest = { format: 1, synthetic: true, directory, config, ownerId: randomUUID(), versions: {} };
const names = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_OUTLINE_DOCUMENT_ID', 'VITE_OUTLINE_CUTOVER'];
const before = names.map((key) => process.env[key]);
try {
  process.env.VITE_SUPABASE_URL = `https://${productionProject}.supabase.co`;
  process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_fixture';
  process.env.VITE_OUTLINE_DOCUMENT_ID = config.docId; process.env.VITE_OUTLINE_CUTOVER = '1';
  for (const [name, root, ref] of [['compatible', source, compatibleRef], ['latest', repository, git('rev-parse', 'HEAD')]]) {
    const output = join(directory, name);
    await build({ root, configFile: join(root, 'vite.config.js'), mode: 'sync-release',
      define: { __LAB_STAGING__: JSON.stringify(config) }, build: { outDir: output, emptyOutDir: false } });
    manifest.versions[name] = { ref, version: (await json(join(root, 'package.json'))).version, directory: output,
      dirty: name === 'latest' && !!git('status', '--porcelain', '--untracked-files=no'), files: await artifactHashes(output) };
  }
  await loadPwaArtifacts(manifest, data);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  await writeFile(join(data, 'pwa-rehearsal.json'), JSON.stringify(manifest, null, 2));
  console.log('固定互換版と最新版の合成PWAを生成しました（公開不可・外部接続なし）');
} finally { names.forEach((name, index) => { if (before[index] === undefined) delete process.env[name]; else process.env[name] = before[index]; }); }
