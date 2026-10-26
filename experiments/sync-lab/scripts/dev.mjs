import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import * as Y from 'yjs';
import { fixtureDocument, snapshot } from '../src/model.js';
import { powerSyncApi } from './powersync-api.mjs';
import { replaceFile } from './replace-file.mjs';
import { loroApi } from './loro-api.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataPath = fileURLToPath(new URL('../.data/', import.meta.url));
await mkdir(dataPath, { recursive: true });
const names = new Map();
function storageFile(name) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(name)) throw new Error('検証文書のIDが不正です');
  return `${dataPath}/${createHash('sha256').update(name).digest('hex')}.bin`;
}
async function store(name, data) {
  const file = storageFile(name), temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await replaceFile(temporary, file);
}
const metrics = (name) => {
  if (!names.has(name)) names.set(name, { changes: 0, stores: 0 });
  return names.get(name);
};
const sync = new Server({
  port: 4181, address: '127.0.0.1', quiet: true, debounce: 50, maxDebounce: 200,
  extensions: [new Database({
    async fetch({ documentName }) {
      try { return await readFile(storageFile(documentName)); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const doc = fixtureDocument(), update = Y.encodeStateAsUpdate(doc);
        await store(documentName, update);
        doc.destroy();
        return update;
      }
    },
    async store({ documentName, state }) {
      await store(documentName, state);
      metrics(documentName).stores++;
    },
  })],
  async onChange({ documentName }) { metrics(documentName).changes++; },
});
await sync.listen();
const serverState = async (request, response) => {
  const name = new URL(request.url, 'http://127.0.0.1').searchParams.get('doc') || 'demo';
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  try {
    const update = await readFile(storageFile(name));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    response.end(JSON.stringify({ rows: snapshot(doc), ...metrics(name), bytes: update.byteLength }));
    doc.destroy();
  } catch (error) { response.statusCode = error.code === 'ENOENT' ? 404 : 500; response.end(JSON.stringify({ error: '検証文書を読めません' })); }
};
const powersync = await powerSyncApi();
const loro = await loroApi(`${dataPath}/loro`);
const app = await createServer({
  root, server: { host: '127.0.0.1', port: 4180, strictPort: true },
  plugins: [{ name: 'lab-state', configureServer(server) {
    server.middlewares.use('/lab/server-state', serverState);
    if (powersync) server.middlewares.use(powersync.middleware);
    server.middlewares.use(loro.middleware);
  } }],
});
await app.listen();
console.log('同期検証 http://127.0.0.1:4180 （ローカル限定・合成データ）');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await sync.destroy();
  await app.close();
  await powersync?.close();
  await loro.close();
}
process.once('SIGINT', () => close().finally(() => process.exit()));
process.once('SIGTERM', () => close().finally(() => process.exit()));
