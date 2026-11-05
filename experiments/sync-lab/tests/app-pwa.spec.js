import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { appFixture } from './support/app-fixture.mjs';

for (const interruptedStorage of [false, true]) test(`通常入口のPWA：圏外再起動から${interruptedStorage ? '保存接続も開き直して' : '未送信の追記を保って'}復帰する`, async ({ browser }, info) => {
  test.skip(process.env.LAB_VERIFY_APP_PWA !== '1', '先にprepare:appでローカル専用の成果物を作る');
  const manifest = JSON.parse(await readFile(new URL('../.data/app-preview.json', import.meta.url), 'utf8'));
  const f = await appFixture(browser, manifest);
  const value = `圏外から再起動しても残す🌿${randomUUID()}`;
  try {
    let a = await f.open({ pwa: true }); const b = await f.open({ pwa: true });
    await expect(a.locator('[data-pane="tasks"] [data-task-id="task-probe"]')).toBeVisible();
    for (const page of [a, b]) await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const cached = await a.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) =>
      (await (await caches.open(key)).keys()).map((request) => request.url)))).flat());
    expect(cached.some((url) => url.endsWith('.wasm'))).toBe(true);
    const before = await f.remoteState();
    // ページだけの通信差し替えではSWのfetchを止められない。実サーバーから全HTTP応答を停止する。
    await f.stopHttp(true); await a.evaluate(() => window.dispatchEvent(new Event('offline')));
    await a.locator('[data-row="memo"] [data-row-text]').click();
    await a.locator('[data-row="memo"] textarea').fill(value);
    await a.evaluate(() => window.lab.localBarrier());
    expect(await a.evaluate(() => window.lab.queued())).toBe(true);
    a = await f.restart(a);
    await expect(a.locator('[data-row="memo"] [data-row-text]')).toHaveText(value);
    expect(await a.evaluate(() => window.lab.queued())).toBe(true);
    expect((await f.remoteState()).entries).toBe(before.entries);
    if (interruptedStorage) await a.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (this.name.startsWith('taskspace-lab-loro-owner:') && args[1] === 'readwrite') {
          IDBDatabase.prototype.transaction = original; this.close();
        }
        return original.apply(this, args);
      };
    });
    await f.stopHttp(false);
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(b.locator('[data-row="memo"] [data-row-text]')).toHaveText(value);
    try { await expect.poll(() => a.evaluate(() => window.lab.queued())).toBe(false); }
    catch (error) {
      const state = await a.evaluate(() => ({ delivery: window.lab.deliveryState(), persistence: window.lab.persistenceStats(),
        online: navigator.onLine, visibility: document.visibilityState, focused: document.hasFocus() }));
      await info.attach('本文を含まない送信確認の停止状態', { body: JSON.stringify(state), contentType: 'application/json' });
      console.log('PWA_DELIVERY_STATE', JSON.stringify(state)); throw error;
    }
    if (interruptedStorage) expect(await a.evaluate(() => window.lab.persistenceStats().reopens)).toBe(1);
    // 見た目だけ待ちを消したのではなく、ACKを保存した原本から再び起動できることを確認する。
    await a.reload({ waitUntil: 'domcontentloaded' });
    await expect(a.locator('[data-row="memo"] [data-row-text]')).toHaveText(value);
    await expect.poll(() => a.evaluate(() => window.lab.queued())).toBe(false);
    await expect(a.locator('[data-outline-sync-conflict],[data-outline-recovery]')).toHaveCount(0);
    expect(await f.legacyRequests()).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.stopHttp(false); await f.close(); }
});

test('PWAの例外検出：通信診断と同じ形でもJavaScriptの未処理Promiseを見逃さない', async ({ browser }) => {
  test.skip(process.env.LAB_VERIFY_APP_PWA !== '1', '先にprepare:appでローカル専用の成果物を作る');
  const manifest = JSON.parse(await readFile(new URL('../.data/app-preview.json', import.meta.url), 'utf8'));
  const f = await appFixture(browser, manifest);
  try {
    const a = await f.open({ pwa: true });
    await f.stopHttp(true);
    await a.evaluate(async () => { try { await fetch('/rest/v1/errors-probe'); } catch { /* 意図した圏外応答は処理済み。 */ } });
    await f.stopHttp(false);
    await a.evaluate(() => {
      const error = new Error('この未処理例外を見逃さない');
      error.name = 'Fetch API cannot load http';
      error.stack = `Fetch API cannot load ${location.origin}/rest/v1/errors-probe due to access control checks.\n    at fetch ([native code]:0:0)`;
      Promise.reject(error);
    });
    await expect.poll(() => f.errors.includes('この未処理例外を見逃さない')).toBe(true);
  } finally { await f.stopHttp(false); await f.close(); }
});
