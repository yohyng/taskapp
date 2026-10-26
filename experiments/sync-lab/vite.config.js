import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// 既存接続も同じ初期化済みのWASMを使う。Nodeのサーバーと単体試験は通常のNode版を使う。
export default defineConfig({ resolve: { alias: [{ find: /^loro-crdt$/, replacement: fileURLToPath(new URL('./src/loro-runtime.js', import.meta.url)) }] } });
