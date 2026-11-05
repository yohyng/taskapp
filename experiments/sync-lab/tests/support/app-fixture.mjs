import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownerFixture } from './owner-fixture.mjs';
import { appState } from './app-state.mjs';
import { createClient } from '@supabase/supabase-js';

export async function appFixture(browser, manifest, { browserFailureEvents = true } = {}) {
  const docId = manifest?.config.docId || randomUUID(), ownerId = manifest?.ownerId || randomUUID();
  const auth = manifest ? { ...(await (await fetch(`${manifest.config.url}/__app-fixture/config`)).json()),
    apiKey: manifest.config.key, close: async () => {} } : await ownerFixture(docId, { ownerId });
  const state = appState(), { entries, legacy } = state;
  const contexts = [], profiles = new Map(), errors = [], nativeNetwork = [], offline = new Set(), authRequests = [], fetchFailures = [];
  async function open({ pwa = false, profile, existingLogin = false, initialOutline, waitForOutline = true } = {}) {
    // PWAは端末のディスク保存が前提。一時contextの保存サービス消失と区別し、
    // ブラウザープロセスを終了しても同じ保存・SWから起動する。利用者のprofileは使わない。
    const directory = pwa ? profile || await mkdtemp(join(tmpdir(), 'taskspace-pwa-')) : null;
    const context = pwa
      ? await browser.browserType().launchPersistentContext(directory, { headless: true, serviceWorkers: 'allow', viewport: { width: 1280, height: 720 } })
      : await browser.newContext({ serviceWorkers: 'block' });
    contexts.push(context);
    const page = context.pages()[0] || await context.newPage(), failedRequests = new Set();
    if (pwa) profiles.set(page, directory);
    // SW経由のfetchはpageの要求イベントへ出ない場合がある。同じ端末contextで追う。
    if (browserFailureEvents) context.on('requestfailed', (request) => failedRequests.add(request.url()));
    context.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/auth/v1/token') authRequests.push(url.searchParams.get('grant_type'));
    });
    page.on('pageerror', (error) => {
      // WebKitは、catch済みfetchの通信診断もpageerrorへ載せる。実際に失敗した合成APIと
      // native fetchだけのスタックに限って分け、下のwindow側でも未処理例外を独立して拾う。
      const match = /^Fetch API cannot load (http:\/\/127\.0\.0\.1:4183\/rest\/v1\/\S+) due to access control checks\.\n\s+at fetch \(\[native code\]:0:0\)$/.exec(error.stack || '');
      if (pwa && match && error.name === 'Fetch API cannot load http') nativeNetwork.push({ url: match[1], message: error.message, failedRequests });
      else errors.push(error.message);
    });
    await page.exposeFunction('__labScriptFailure', (message) => errors.push(message));
    await page.exposeFunction('__labFetchFailure', (url) => { failedRequests.add(url); fetchFailures.push(url); });
    await page.addInitScript(() => {
      const report = (value) => window.__labScriptFailure(String(value?.message || value)).catch(() => {});
      window.addEventListener('error', (event) => { if (event.error) report(event.error); });
      window.addEventListener('unhandledrejection', (event) => report(event.reason));
      // SWの交代で中止されたfetchはrequestfailedへ出ないことがある。実際のPromiseの
      // 失敗も記録するが、例外はそのまま投げ直し、未処理なら上の独立した検査で失敗させる。
      const fetch = window.fetch;
      window.fetch = async (...args) => {
        try { return await fetch.apply(window, args); }
        catch (error) {
          const input = args[0], url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href).href;
          await window.__labFetchFailure(url).catch(() => {}); throw error;
        }
      };
    });
    let savedLogin = [];
    if (existingLogin) {
      // 従来のcreateClientと同じ既定の保存名を使う。新実装側の保存名を試験から教えない。
      const values = new Map(), storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
      const previous = createClient(manifest.config.url, auth.apiKey, { auth: { storage, autoRefreshToken: false } });
      try {
        const { error } = await previous.auth.signInWithPassword(auth.credentials);
        if (error) throw new Error('既存SDKの合成ログインに失敗');
        savedLogin = [...values];
      } finally { previous.auth.stopAutoRefresh(); await previous.realtime.disconnect(); }
    }
    await page.addInitScript(({ docId, key, savedLogin, initialOutline }) => {
      window.labAuthConfig = { docId, key };
      if (savedLogin.length && !localStorage.getItem(`taskspace-fixture-auth-seeded-${docId}`)) {
        for (const [key, value] of savedLogin) if (!localStorage.getItem(key)) localStorage.setItem(key, value);
        localStorage.setItem(`taskspace-fixture-auth-seeded-${docId}`, '1');
      }
      if (!localStorage.getItem('taskspace-panes-v1')) localStorage.setItem('taskspace-panes-v1', JSON.stringify([
        { id: 'tasks', mode: 'tasks', weight: 1 }, { id: 'outline', mode: 'outline', weight: 1 }]));
      if (!localStorage.getItem('taskspace-outline-v1')) localStorage.setItem('taskspace-outline-v1', initialOutline || '[{"id":"legacy","text":"旧保存は残す","children":[]}]');
      if (!localStorage.getItem('taskspace-outline-view')) localStorage.setItem('taskspace-outline-view', '{"fontSize":22,"align":"left"}');
    }, { docId, key: auth.apiKey, savedLogin, initialOutline });
    if (!pwa) await auth.routeAuth(page);
    await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
    if (!pwa) await page.route('**/rest/v1/**', async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (offline.has(page)) { await route.abort('failed'); return; }
      await route.fulfill(state.respond(path, request.method(), request.postData() ? request.postDataJSON() : null));
    });
    await page.goto(pwa ? 'http://127.0.0.1:4183/' : '/app.html');
    if (!waitForOutline) return page;
    await page.locator('[data-row="memo"], input[type="email"]').first().waitFor({ timeout: 20000 });
    if (await page.getByPlaceholder('メールアドレス').isVisible()) {
      if (existingLogin) throw new Error('既存ログインを引き継がず再認証を求めた');
      await page.getByPlaceholder('メールアドレス').fill(auth.credentials.email);
      await page.getByPlaceholder('パスワード').fill(auth.credentials.password);
      await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    }
    await page.locator('[data-row="memo"]').waitFor({ timeout: 20000 });
    return page;
  }
  return { open, entries, authRequests, fetchFailures, get errors() { return [...errors, ...nativeNetwork.filter((entry) => !entry.failedRequests.has(entry.url)).map((entry) => entry.message)]; }, legacy, offline,
    async restart(page) {
      const profile = profiles.get(page);
      if (!profile) throw new Error('PWAのディスク保存profileが必要です');
      await page.context().close();
      return open({ pwa: true, profile });
    },
    async legacyRequests() { return manifest ? (await (await fetch(`${manifest.config.url}/__app-fixture/state`)).json()).legacy : legacy; },
    async remoteState() { return (await (await fetch(`${manifest.config.url}/__app-fixture/state`)).json()); },
    async stopHttp(offline) { await fetch(`${manifest.config.url}/__app-fixture/offline`, { method: 'POST', body: JSON.stringify({ offline }) }); },
    async close() { await Promise.allSettled(contexts.map((context) => context.close())); await auth.close(); } };
}
