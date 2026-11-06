import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { stagingConfig } from './src/staging-config.js';

const authGate = fileURLToPath(new URL('../../src/AuthGate.jsx', import.meta.url));
const sessionClient = fileURLToPath(new URL('./src/session-client.js', import.meta.url));
const productSource = fileURLToPath(new URL('../../src/', import.meta.url)).replaceAll('\\', '/');

// 既存接続も同じ初期化済みのWASMを使う。Nodeのサーバーと単体試験は通常のNode版を使う。
export default defineConfig(({ mode }) => ({
  // 独立した検証用.envだけを読む。通常の合成試験と製品の設定を混ぜない。
  envPrefix: 'LAB_BROWSER_UNUSED_',
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version),
    __LAB_STAGING__: JSON.stringify(mode === 'staging' ? stagingConfig(loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'LAB_SUPABASE_')) : null) },
  plugins: [react(), tailwindcss(), { name: '既存ログインの合成試験', enforce: 'pre', resolveId(source, importer) {
    if (['./lib/supabase', './supabase', './lib/supabase.js', './supabase.js'].includes(source) && importer?.replaceAll('\\', '/').startsWith(productSource)) return sessionClient;
  } }],
  resolve: { alias: [
    { find: '#outline-provider', replacement: fileURLToPath(new URL('./src/app-outline-provider.jsx', import.meta.url)) },
    { find: /^loro-crdt$/, replacement: fileURLToPath(new URL('./src/loro-runtime.js', import.meta.url)) },
    { find: 'taskspace-existing-auth-gate', replacement: authGate },
  ] },
  build: { rollupOptions: { input: mode === 'staging' ? { outline: fileURLToPath(new URL('./outline.html', import.meta.url)), app: fileURLToPath(new URL('./app.html', import.meta.url)) }
    : { main: fileURLToPath(new URL('./index.html', import.meta.url)), session: fileURLToPath(new URL('./session.html', import.meta.url)), outline: fileURLToPath(new URL('./outline.html', import.meta.url)), app: fileURLToPath(new URL('./app.html', import.meta.url)) } } },
}));
