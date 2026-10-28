import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const authGate = fileURLToPath(new URL('../../src/AuthGate.jsx', import.meta.url));
const sessionClient = fileURLToPath(new URL('./src/session-client.js', import.meta.url));

// 既存接続も同じ初期化済みのWASMを使う。Nodeのサーバーと単体試験は通常のNode版を使う。
export default defineConfig({
  plugins: [react(), { name: '既存ログインの合成試験', enforce: 'pre', resolveId(source, importer) {
    if (source === './lib/supabase' && importer?.replaceAll('\\', '/') === authGate.replaceAll('\\', '/')) return sessionClient;
  } }],
  resolve: { alias: [
    { find: /^loro-crdt$/, replacement: fileURLToPath(new URL('./src/loro-runtime.js', import.meta.url)) },
    { find: 'taskspace-existing-auth-gate', replacement: authGate },
  ] },
  build: { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), session: fileURLToPath(new URL('./session.html', import.meta.url)) } } },
});
