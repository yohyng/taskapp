import { build } from 'vite';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { productionProject } from '../src/staging-config.js';

// 合成Auth専用のローカルPWA。実サービス用の配信成果物と混同しないよう、成果物と接続先を記録する。
const root = fileURLToPath(new URL('../../../', import.meta.url));
const data = fileURLToPath(new URL('../.data/', import.meta.url));
await mkdir(data, { recursive: true });
const directory = await mkdtemp(join(data, 'app-pwa-fixture-'));
const release = process.argv.includes('--release');
const config = { mode: release ? 'production' : 'fixture', url: 'http://127.0.0.1:4183', key: randomUUID(), docId: randomUUID(), cutover: release };
const ownerId = randomUUID();
const names = ['LAB_SUPABASE_PROJECT_REF', 'LAB_SUPABASE_PUBLISHABLE_KEY', 'LAB_SUPABASE_DOCUMENT_ID',
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_OUTLINE_DOCUMENT_ID', 'VITE_OUTLINE_CUTOVER'];
const before = names.map((name) => process.env[name]);
try {
  // 検証モードの設定検査を通す仮値。接続はdefineでlocalhostの合成APIへ固定する。
  process.env.LAB_SUPABASE_PROJECT_REF = 's'.repeat(20);
  process.env.LAB_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fixture';
  process.env.LAB_SUPABASE_DOCUMENT_ID = config.docId;
  process.env.VITE_SUPABASE_URL = `https://${productionProject}.supabase.co`;
  process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_fixture';
  process.env.VITE_OUTLINE_DOCUMENT_ID = config.docId;
  process.env.VITE_OUTLINE_CUTOVER = '1';
  await build({ root, configFile: join(root, 'vite.config.js'), mode: release ? 'sync-release' : 'sync-staging',
    define: { __LAB_STAGING__: JSON.stringify(config) }, build: { outDir: join(directory, 'dist'), emptyOutDir: false } });
  const manifest = { format: 1, synthetic: true, directory, config, ownerId,
    indexSha256: createHash('sha256').update(await readFile(join(directory, 'dist/index.html'))).digest('hex') };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  await writeFile(join(data, 'app-preview.json'), JSON.stringify(manifest, null, 2));
  console.log('通常入口の合成PWAを.data内へ生成しました（本番配信不可・外部接続なし）');
} finally {
  names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; });
}
