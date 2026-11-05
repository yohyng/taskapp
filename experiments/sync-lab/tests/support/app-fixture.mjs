import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownerFixture } from './owner-fixture.mjs';
import { appState } from './app-state.mjs';

export async function appFixture(browser, manifest) {
  const docId = manifest?.config.docId || randomUUID(), ownerId = manifest?.ownerId || randomUUID();
  const auth = manifest ? { ...(await (await fetch(`${manifest.config.url}/__app-fixture/config`)).json()),
    apiKey: manifest.config.key, close: async () => {} } : await ownerFixture(docId, { ownerId });
  const state = appState(), { entries, legacy } = state;
  const contexts = [], profiles = new Map(), errors = [], nativeNetwork = [], offline = new Set();
  async function open({ pwa = false, profile } = {}) {
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
    context.on('requestfailed', (request) => failedRequests.add(request.url()));
    page.on('pageerror', (error) => {
      // WebKitは、catch済みfetchの通信診断もpageerrorへ載せる。実際に失敗した合成APIと
      // native fetchだけのスタックに限って分け、下のwindow側でも未処理例外を独立して拾う。
      const match = /^Fetch API cannot load (http:\/\/127\.0\.0\.1:4183\/rest\/v1\/\S+) due to access control checks\.\n\s+at fetch \(\[native code\]:0:0\)$/.exec(error.stack || '');
      if (pwa && match && error.name === 'Fetch API cannot load http') nativeNetwork.push({ url: match[1], message: error.message, failedRequests });
      else errors.push(error.message);
    });
    await page.exposeFunction('__labScriptFailure', (message) => errors.push(message));
    await page.addInitScript(() => {
      const report = (value) => window.__labScriptFailure(String(value?.message || value)).catch(() => {});
      window.addEventListener('error', (event) => { if (event.error) report(event.error); });
      window.addEventListener('unhandledrejection', (event) => report(event.reason));
    });
    await page.addInitScript(({ docId, key }) => {
      window.labAuthConfig = { docId, key };
      if (!localStorage.getItem('taskspace-panes-v1')) localStorage.setItem('taskspace-panes-v1', JSON.stringify([
        { id: 'tasks', mode: 'tasks', weight: 1 }, { id: 'outline', mode: 'outline', weight: 1 }]));
      if (!localStorage.getItem('taskspace-outline-v1')) localStorage.setItem('taskspace-outline-v1', '[{"id":"legacy","text":"旧保存は残す","children":[]}]');
      if (!localStorage.getItem('taskspace-outline-view')) localStorage.setItem('taskspace-outline-view', '{"fontSize":22,"align":"left"}');
    }, { docId, key: auth.apiKey });
    if (!pwa) await auth.routeAuth(page);
    await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
    if (!pwa) await page.route('**/rest/v1/**', async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (offline.has(page)) { await route.abort('failed'); return; }
      await route.fulfill(state.respond(path, request.method(), request.postData() ? request.postDataJSON() : null));
    });
    await page.goto(pwa ? 'http://127.0.0.1:4183/' : '/app.html');
    await page.locator('[data-row="memo"], input[type="email"]').first().waitFor({ timeout: 20000 });
    if (await page.getByPlaceholder('メールアドレス').isVisible()) {
      await page.getByPlaceholder('メールアドレス').fill(auth.credentials.email);
      await page.getByPlaceholder('パスワード').fill(auth.credentials.password);
      await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    }
    await page.locator('[data-row="memo"]').waitFor({ timeout: 20000 });
    return page;
  }
  return { open, entries, get errors() { return [...errors, ...nativeNetwork.filter((entry) => !entry.failedRequests.has(entry.url)).map((entry) => entry.message)]; }, legacy, offline,
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
