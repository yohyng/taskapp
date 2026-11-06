import { preview } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { ownerFixture } from '../tests/support/owner-fixture.mjs';
import { appState } from '../tests/support/app-state.mjs';
import { randomUUID } from 'node:crypto';
import { loadPwaArtifacts } from './pwa-artifacts.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const data = resolve(fileURLToPath(new URL('../.data/', import.meta.url)));
const updating = process.env.LAB_VERIFY_PWA_UPDATE === '1';
const manifest = JSON.parse(await readFile(new URL(updating ? '../.data/pwa-rehearsal.json' : '../.data/app-preview.json', import.meta.url), 'utf8'));
const directory = resolve(manifest.directory);
if (!manifest.synthetic || !directory.startsWith(`${data}${sep}`) || manifest.config.url !== 'http://127.0.0.1:4183') throw new Error('ローカル検証PWAの成果物が必要です');
const artifacts = updating ? await loadPwaArtifacts(manifest, data) : null;
const auth = await ownerFixture(manifest.config.docId, { ownerId: manifest.ownerId, apiKey: manifest.config.key });
let version = 'compatible', syncUnavailable = false, brokenAssets = false;
const served = [];
const makeState = () => appState({ cutoverRoute: manifest.config.cutover ? { format: 1, migrationId: randomUUID(), ownerId: manifest.ownerId, docId: manifest.config.docId } : null });
let state = makeState();
let unavailable = false, blocked = 0;
const server = await preview({ root, configFile: resolve(root, 'vite.config.js'), mode: 'production',
  plugins: [{ name: 'PWAの合成HTTP接続', configurePreviewServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const path = new URL(request.url, manifest.config.url).pathname;
      // WebKitのドライバーによる圏外フラグではなく、全アセットとAPIの実HTTP応答を止める。
      // 制御用URLだけはNode側から復帰させられる。画面から本番へつながる経路はない。
      if (unavailable && !path.startsWith('/__app-fixture/')) { blocked++; response.destroy(); return; }
      if (artifacts && !/^\/(auth\/v1\/|rest\/v1\/|__app-fixture\/)/.test(path)) {
        const target = path === '/' ? '/index.html' : decodeURIComponent(path), bytes = artifacts[version].get(target);
        response.setHeader('Cache-Control', 'no-store');
        // Worker自体の評価失敗ではなく、インストール中にアプリ本体の取得が失敗する条件を固定する。
        if (brokenAssets && target.startsWith('/assets/') && target.endsWith('.js')) {
          served.push({ version, path: target, status: 503 }); response.statusCode = 503; response.end(''); return;
        }
        if (!bytes) { response.statusCode = 404; response.end(''); return; }
        const type = target.split('.').pop();
        response.setHeader('Content-Type', ({ js: 'text/javascript', css: 'text/css', html: 'text/html', wasm: 'application/wasm', webmanifest: 'application/manifest+json', png: 'image/png', ico: 'image/x-icon' })[type] || 'application/octet-stream');
        served.push({ version, path: target }); response.end(bytes); return;
      }
      if (!/^\/(auth\/v1\/|rest\/v1\/|__app-fixture\/)/.test(path)) return next();
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
      try {
        if (path === '/__app-fixture/config') { response.end(JSON.stringify({ credentials: auth.credentials })); return; }
        if (path === '/__app-fixture/state') { response.end(JSON.stringify({ legacy: state.legacy, entries: state.entries.length, blocked, startup: state.startup, version, served })); return; }
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('utf8');
        if (path === '/__app-fixture/offline' && request.method === 'POST') { unavailable = JSON.parse(body).offline === true; response.end('{}'); return; }
        if (path === '/__app-fixture/reset' && request.method === 'POST') { state = makeState(); response.end('{}'); return; }
        if (path === '/__app-fixture/cutover' && request.method === 'POST') { state.startup.allowed = JSON.parse(body).allowed === true; response.end('{}'); return; }
        if (path === '/__app-fixture/delivery' && request.method === 'POST') { syncUnavailable = JSON.parse(body).offline === true; response.end('{}'); return; }
        if (path === '/__app-fixture/version' && request.method === 'POST' && artifacts) {
          const value = JSON.parse(body);
          if (!['compatible', 'latest'].includes(value.version)) { response.statusCode = 400; response.end('{}'); return; }
          version = value.version; brokenAssets = value.brokenAssets === true; response.end('{}'); return;
        }
        if (path.startsWith('/auth/')) {
          const result = await fetch(`${auth.authUrl}${request.url}`, { method: request.method,
            headers: { apikey: request.headers.apikey || '', authorization: request.headers.authorization || '', 'Content-Type': 'application/json' },
            ...(body ? { body } : {}) });
          response.statusCode = result.status; response.end(await result.text()); return;
        }
        if (auth.identify(request.headers.authorization) !== manifest.ownerId) { response.statusCode = 401; response.end('{}'); return; }
        if (syncUnavailable && path.endsWith('/rpc/taskspace_loro_exchange')) { response.statusCode = 503; response.end('{"message":"検証用の同期停止"}'); return; }
        const result = state.respond(path, request.method, body ? JSON.parse(body) : null);
        response.statusCode = result.status; response.end(JSON.stringify(result.json));
      } catch { response.statusCode = 500; response.end('{"message":"合成HTTPの試験に失敗"}'); }
    });
  } }],
  build: { outDir: updating ? manifest.versions.latest.directory : resolve(directory, 'dist') }, preview: { host: '127.0.0.1', port: 4183, strictPort: true, open: false } });
const close = () => server.httpServer.close(() => auth.close());
process.once('SIGINT', close); process.once('SIGTERM', close);
