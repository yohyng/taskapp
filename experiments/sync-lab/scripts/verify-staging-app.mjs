import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium, webkit } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { LoroDoc } from 'loro-crdt';
import { loadStagingApp } from './staging-app-artifacts.mjs';
import { verifyStagingCutover } from './verify-staging-cutover.mjs';
import { decodeLogTransfer } from '../src/loro-log-transfer.js';
import { outlineNodes } from '../src/outline-model.js';
import { loroViewRows } from '../src/loro-model.js';
import { outlineCheckpoint } from '../../../src/lib/outline-checkpoint.js';
import { flattenTree, outlineRowSignature } from '../../../src/lib/outline.js';
import { pwaState } from '../tests/support/pwa-state.mjs';

const timeout = { timeout: 30000 }, origin = 'http://127.0.0.1:4184';
function checkpoint(nodes, value) {
  const before = flattenTree(nodes).find((row) => row.id === 'probe'), copy = structuredClone(nodes);
  if (value !== undefined) copy.find((node) => node.id === 'probe').text = value;
  return outlineCheckpoint(copy, { sequence: value === undefined ? 0 : 1, pending: new Map(value === undefined ? [] : [['probe', {
    id: 'probe', kind: 'put', version: 1, positionChanged: false, baseSignature: outlineRowSignature(before),
  }]]) }, new Set(), new Set(flattenTree(nodes).map((row) => row.id)), 1, '2026-11-06');
}

// 実サービスへの追記は、この明示コマンドと合成manifestに限定する。trace・画像・生の例外は出さない。
export async function verifyStagingApp(manifestPath, browser = 'all') {
  let phase = '設定', step = '', completed = 0, server, client, blockedStatic = 0, offlineStatic = false;
  const contexts = new Set(), processes = new Set(), errors = [], legacyRequests = [], responses = [], failedRequests = [];
  try {
    const env = parseEnv(await readFile(new URL('../.env.verify.local', import.meta.url), 'utf8'));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const cutover = JSON.parse(await readFile(manifest.cutoverManifest, 'utf8'));
    const source = JSON.parse(await readFile(env.LAB_STAGING_MANIFEST, 'utf8'));
    const { config, files } = await loadStagingApp(manifest, env, cutover, source, fileURLToPath(new URL('../.data/', import.meta.url)));
    phase = '旧停止と原本の確認'; await verifyStagingCutover(env, cutover, source);
    client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) } });
    const signed = await client.auth.signInWithPassword({ email: env.LAB_OWNER_EMAIL, password: env.LAB_OWNER_PASSWORD });
    assert.equal(signed.error, null); assert.equal(signed.data.user.id, manifest.ownerId);
    const head = async () => {
      const r = await client.from('taskspace_loro_documents').select('head').eq('id', config.docId).single();
      assert.equal(r.error, null); return r.data.head;
    };
    async function latest() {
      const doc = new LoroDoc(); let cursor = -1;
      try {
        for (;;) {
          const r = await client.rpc('taskspace_loro_exchange', { p_doc: config.docId, p_cursor: cursor, p_updates: [] });
          assert.equal(r.error, null);
          const decoded = decodeLogTransfer(r.data, cursor === -1, { cursor, batch: [] });
          for (const bytes of decoded.updates) doc.import(bytes);
          cursor = decoded.cursor;
          if (!decoded.more) return outlineNodes(loroViewRows(doc));
        }
      } finally { doc.free(); }
    }
    // 検証済みの静的ファイルだけを配る。Auth・RPC・Realtimeを代役へ差し替えない。
    server = createServer((request, response) => {
      if (offlineStatic) { blockedStatic++; response.destroy(); return; }
      const path = new URL(request.url, origin).pathname, bytes = files.get(path === '/' ? '/index.html' : path);
      response.setHeader('Cache-Control', 'no-store');
      if (!bytes) { response.statusCode = 404; response.end(); return; }
      const type = path === '/' ? 'html' : path.split('.').pop();
      response.setHeader('Content-Type', ({ html: 'text/html', js: 'text/javascript', css: 'text/css', wasm: 'application/wasm', webmanifest: 'application/manifest+json', png: 'image/png', ico: 'image/x-icon' })[type] || 'application/octet-stream');
      response.end(bytes);
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(4184, '127.0.0.1', done); });
    const text = (page, id) => page.evaluate((id) => window.lab.snapshot().find((row) => row.id === id)?.text, id);
    const equals = (page, id, value) => page.waitForFunction(({ id, value }) => window.lab.snapshot().find((row) => row.id === id)?.text === value, { id, value }, timeout);
    const saved = async (page) => {
      // 再読込のDOM取得と、認証・端末保存を開く処理の完了は別のタイミング。
      await page.waitForFunction(() => !!window.lab, null, timeout);
      await page.evaluate(() => window.lab.localBarrier());
      await page.waitForFunction(() => !window.lab.queued() && window.lab.connectionState().connected, null, timeout);
    };
    const edit = async (page, id, value) => {
      await page.locator(`[data-row="${id}"] [data-row-text]`).click(timeout);
      await page.locator(`[data-row="${id}"] textarea`).fill(value, timeout);
      await page.evaluate(() => window.lab.localBarrier());
    };
    if (!['all', 'chromium', 'webkit', 'webkit-live'].includes(browser)) throw new Error('検証ブラウザーの指定が不正です');
    const selected = browser.startsWith('webkit') ? [['WebKit', webkit]] : browser === 'chromium' ? [['Chromium', chromium]] : [['Chromium', chromium], ['WebKit', webkit]];
    for (const [name, browserType] of selected) {
      const latestNodes = await latest(), initialHead = await head();
      const initial = latestNodes.find((node) => node.id === 'probe').text + `・旧端末の未送信${randomUUID()}`;
      const old = checkpoint(latestNodes, initial), original = JSON.stringify(old);
      async function open({ record, profile, offline = false } = {}) {
        const directory = profile || await mkdtemp(join(tmpdir(), 'taskspace-real-pwa-'));
        const options = { serviceWorkers: 'allow', viewport: { width: 1440, height: 900 } };
        let context;
        if (browser === 'webkit-live') {
          // Windowsの永続WebKitの外向きHTTPS停止と、通常ブラウザーの実接続検証を区別する。
          // この明示モードはプロセス再起動の成功に数えず、PWA版の代替にも使わない。
          const instance = await browserType.launch({ headless: true }); processes.add(instance);
          context = await instance.newContext(options);
        } else context = await browserType.launchPersistentContext(directory, { ...options, headless: true });
        contexts.add(context); if (offline) await context.setOffline(true);
        context.on('request', (request) => {
          const url = new URL(request.url());
          if (url.origin === config.url && (/\/outline_nodes$/.test(url.pathname) || /\/rpc\/taskspace_outline_/.test(url.pathname))) legacyRequests.push(url.pathname);
        });
        context.on('response', (response) => {
          const url = new URL(response.url());
          if (url.origin === config.url) responses.push({ path: url.pathname, status: response.status() });
        });
        context.on('requestfailed', (request) => {
          const url = new URL(request.url());
          if (url.origin === config.url) failedRequests.push({ path: url.pathname, error: request.failure()?.errorText });
        });
        const page = context.pages()[0] || await context.newPage();
        await page.exposeFunction('__stagingScriptError', () => errors.push(name));
        await page.addInitScript(({ record, docId }) => {
          const report = () => window.__stagingScriptError().catch(() => {});
          window.addEventListener('error', (event) => { if (event.error) report(); });
          window.addEventListener('unhandledrejection', report);
          if (!localStorage.getItem(`staging-seeded-${docId}`)) {
            if (record) localStorage.setItem('taskspace-outline-v1', JSON.stringify(record));
            localStorage.setItem('taskspace-panes-v1', JSON.stringify([{ id: 'tasks', mode: 'tasks', weight: 1 }, { id: 'outline', mode: 'outline', weight: 1 }]));
            localStorage.setItem(`staging-seeded-${docId}`, '1');
          }
        }, { record, docId: config.docId });
        step = 'ページ取得'; await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('[data-row="probe"], input[type="email"]').first().waitFor(timeout);
        if (await page.getByPlaceholder('メールアドレス').isVisible()) {
          step = 'ログイン';
          assert.equal(offline, false, '圏外の再起動で再ログインを求めました');
          await page.getByPlaceholder('メールアドレス').fill(env.LAB_OWNER_EMAIL, timeout);
          await page.getByPlaceholder('パスワード').fill(env.LAB_OWNER_PASSWORD, timeout);
          await page.getByRole('button', { name: 'ログイン', exact: true }).click(timeout);
        }
        step = 'エンジン起動'; await page.waitForFunction(() => !!window.lab, null, timeout);
        await page.locator('[data-row="probe"]').waitFor(timeout);
        step = 'Service Worker'; await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, timeout);
        return { page, context, profile: directory };
      }
      phase = `${name}・編集しない端末の起動`;
      const b = await open({ record: checkpoint(cutover.nodes) }); await saved(b.page);
      assert.equal(await head(), initialHead);
      phase = `${name}・旧未送信の一度限りの引き継ぎ`;
      let a = await open({ record: old });
      phase = `${name}・引き継いだ旧未送信の送信完了`; await saved(a.page);
      phase = `${name}・別端末への引き継ぎ反映`; await equals(b.page, 'probe', initial);
      phase = `${name}・引き継ぎ原本の照合`;
      const first = await pwaState(a.page, manifest);
      assert.equal(first.record.phase, 'complete'); assert.deepEqual(first.record.checkpoint, old);
      assert.equal(first.record.originals.localRaw, original); assert.equal(first.pending.length, 0);
      const afterHandoff = await head();
      phase = `${name}・引き継ぎ後の再読込`;
      await a.page.reload({ waitUntil: 'domcontentloaded' }); await saved(a.page); await equals(a.page, 'probe', initial);
      assert.equal(await head(), afterHandoff);
      assert.equal(await a.page.evaluate(() => localStorage.getItem('taskspace-outline-v1')), original);
      phase = `${name}・タスク表示`;
      await a.page.locator('[data-pane="tasks"]').waitFor(timeout);
      await a.page.locator('[data-task-id="task-probe"]').first().waitFor(timeout);
      completed++; console.log(`${name}：通常App${browser === 'webkit-live' ? '' : '/PWA'}・タスク表示・旧未送信の自動引き継ぎ・未編集起動が成功`);

      phase = `${name}・通常入力の端末間同期`;
      const onlineValue = initial + `・通常入力${randomUUID()}`;
      await edit(a.page, 'probe', onlineValue); await saved(a.page); await equals(b.page, 'probe', onlineValue);
      completed++; console.log(`${name}：通常の入力から実Supabaseを経由した別端末への反映が成功`);

      if (browser === 'webkit-live') {
        phase = `${name}・通常ブラウザーで古い未編集端末を開く`;
        const beforeStale = await head(), c = await open({ record: checkpoint(cutover.nodes) });
        await saved(c.page); await equals(c.page, 'probe', onlineValue); assert.equal(await head(), beforeStale);
        for (const device of [a, b, c]) {
          assert.equal(await device.page.locator('[data-outline-sync-conflict],[data-outline-recovery]').count(), 0);
          assert.equal((await pwaState(device.page, manifest)).record.phase, 'complete');
          contexts.delete(device.context); await device.context.close();
        }
        assert.deepEqual(legacyRequests, []); assert.deepEqual(errors, []);
        completed++; console.log('WebKit：通常ブラウザーの三接続で、古い未編集端末の起動が書き戻しを起こさない');
        continue;
      }

      phase = `${name}・圏外編集とプロセス再起動`;
      await a.context.setOffline(true); offlineStatic = true;
      const offlineValue = onlineValue + `・圏外入力${randomUUID()}`;
      await edit(a.page, 'probe', offlineValue);
      const queued = await pwaState(a.page, manifest); assert.ok(queued.pending.length > 0);
      const beforeOffline = await head();
      const profile = a.profile; contexts.delete(a.context); await a.context.close();
      a = await open({ profile, offline: true });
      await equals(a.page, 'probe', offlineValue);
      assert.deepEqual((await pwaState(a.page, manifest)).pending, queued.pending);
      assert.equal(await head(), beforeOffline);
      const remoteValue = await text(b.page, 'other') + `・接続端末から追記${randomUUID()}`;
      await edit(b.page, 'other', remoteValue); await saved(b.page);
      phase = `${name}・再接続の自動統合`;
      offlineStatic = false; await a.context.setOffline(false); await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
      await saved(a.page); await equals(a.page, 'other', remoteValue); await equals(b.page, 'probe', offlineValue);
      assert.equal((await pwaState(a.page, manifest)).pending.length, 0);
      await a.page.reload({ waitUntil: 'domcontentloaded' }); await saved(a.page); await equals(a.page, 'probe', offlineValue);
      completed++; console.log(`${name}：圏外の完全再起動・未送信ID/バイト列の保持・別行との自動統合が成功`);

      phase = `${name}・古い未編集端末を初めて開く`;
      const beforeStale = await head(), c = await open({ record: checkpoint(cutover.nodes) });
      await saved(c.page); await equals(c.page, 'probe', offlineValue); await equals(c.page, 'other', remoteValue);
      assert.equal(await head(), beforeStale);
      for (const device of [a, b, c]) {
        assert.equal(await device.page.locator('[data-outline-sync-conflict],[data-outline-recovery]').count(), 0);
        assert.equal((await pwaState(device.page, manifest)).record.phase, 'complete');
        contexts.delete(device.context); await device.context.close();
      }
      assert.deepEqual(legacyRequests, []); assert.deepEqual(errors, []);
      completed++; console.log(`${name}：古い未編集端末も最新を表示し、書き戻し・確認バナー・旧同期への通信がない`);
    }
    return { complete: true, projectRef: config.reference, browserScenarios: completed, browser,
      realSupabase: true, normalApp: true, persistentPwaRestart: browser !== 'webkit-live', blockedStatic, productionChanged: false };
  } catch (error) {
    // Playwrightの例外には入力した認証情報が含まれ得る。段階と型だけを残す。
    const states = [];
    for (const context of contexts) for (const page of context.pages()) {
      try { states.push(await page.evaluate(() => {
        const d = window.lab?.deliveryState();
        const startup = document.querySelector('[data-outline-connecting] [data-error]')?.textContent || '';
        const email = document.querySelector('input[type="email"]'), password = document.querySelector('input[type="password"]');
        return { engine: !!window.lab, connecting: !!document.querySelector('[data-outline-connecting]'),
          webLocks: !!navigator.locks?.request, authenticated: !!window.labAuth?.sessions.snapshot(),
          loginForm: !!email, emailValid: email?.validity.valid, passwordPresent: !!password?.value, loginDisabled: document.querySelector('button[type="submit"]')?.disabled,
          startupErrorLength: startup.length, startupErrors: ['タブ間保護', '切り替え', '旧保存', 'IndexedDB', '端末', 'Abort', '失敗'].filter((part) => startup.includes(part)),
          rows: document.querySelectorAll('[data-row]').length, taskPanes: document.querySelectorAll('[data-pane="tasks"]').length,
          taskProbe: document.querySelectorAll('[data-task-id="task-probe"]').length,
          delivery: d ? { phase: d.phase, pending: d.pending, cursor: d.cursor, failures: d.failures, fatal: d.fatal } : null };
      })); } catch { states.push({ unavailable: true }); }
    }
    return { complete: false, phase, step, errorType: error.name, browserScenarios: completed, scriptErrors: errors.length, states, responses: responses.slice(-16), failedRequests: failedRequests.slice(-8) };
  } finally {
    offlineStatic = false; await Promise.allSettled([...contexts].map((context) => context.close()));
    await Promise.allSettled([...processes].map((instance) => instance.close()));
    if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    if (client) { await client.removeAllChannels(); await client.auth.stopAutoRefresh(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const selected = process.argv.includes('--webkit-live') ? 'webkit-live' : process.argv.includes('--webkit') ? 'webkit' : process.argv.includes('--chromium') ? 'chromium' : 'all';
  const result = await verifyStagingApp(resolve(process.argv[2] || '.data/staging-app-0231/manifest.json'), selected);
  console.log(JSON.stringify(result)); if (!result.complete) process.exitCode = 1;
}
