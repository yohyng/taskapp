import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

// 比較用HTTP代役やローカル同期サーバーを起動せず、本物のSDK接続だけを動かす。
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), mode: 'staging',
  server: { host: '127.0.0.1', port: 4180, strictPort: true, open: '/outline.html' },
});
await server.listen();
console.log('検証用Supabaseのアウトライン http://127.0.0.1:4180/outline.html （本番未接続）');
process.once('SIGINT', () => server.close().finally(() => process.exit()));
process.once('SIGTERM', () => server.close().finally(() => process.exit()));
