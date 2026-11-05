import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { appFixture } from './support/app-fixture.mjs';

test('通常入口のPWA：エンジン本体も圏外で読み、未送信の追記を再起動後も残して復帰する', async ({ browser }, info) => {
  test.skip(process.env.LAB_VERIFY_APP_PWA !== '1', '先にprepare:appでローカル専用の成果物を作る');
  const manifest = JSON.parse(await readFile(new URL('../.data/app-preview.json', import.meta.url), 'utf8'));
  const f = await appFixture(browser, manifest);
  const value = `圏外から再起動しても残す🌿${randomUUID()}`;
  try {
    const a = await f.open({ pwa: true }), b = await f.open({ pwa: true });
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
    await a.reload({ waitUntil: 'domcontentloaded' });
    await expect(a.locator('[data-row="memo"] [data-row-text]')).toHaveText(value);
    expect(await a.evaluate(() => window.lab.queued())).toBe(true);
    expect((await f.remoteState()).entries).toBe(before.entries);
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
    await expect(a.locator('[data-outline-sync-conflict],[data-outline-recovery]')).toHaveCount(0);
    expect(await f.legacyRequests()).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.stopHttp(false); await f.close(); }
});
