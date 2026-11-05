import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { appFixture } from './support/app-fixture.mjs';
import { pwaState, controlledPwa, updatePwa } from './support/pwa-state.mjs';
import { outlineCheckpoint } from '../../../src/lib/outline-checkpoint.js';

async function fixture(browser) {
  const manifest = JSON.parse(await readFile(new URL('../.data/pwa-rehearsal.json', import.meta.url), 'utf8'));
  const control = (name, value) => fetch(`${manifest.config.url}/__app-fixture/${name}`, { method: 'POST', body: JSON.stringify(value) });
  await control('reset', {}); await control('version', { version: 'compatible' }); await control('delivery', { offline: false });
  const f = await appFixture(browser, manifest), initialOutline = JSON.stringify(outlineCheckpoint(
    [{ id: 'memo', text: '端末を持ち替えて書くメモ', children: [] }], { sequence: 0, pending: new Map() }, new Set(), new Set(['memo']), 0, '2026-11-05'));
  const open = () => f.open({ pwa: true, existingLogin: true, initialOutline });
  const version = (page, name) => expect(page.getByText(`v${manifest.versions[name].version}`, { exact: true })).toBeVisible();
  const saved = (page) => pwaState(page, manifest);
  return { manifest, f, initialOutline, open, version, saved, control };
}

async function write(page, text) {
  await page.locator('[data-row="memo"] [data-row-text]').click();
  await page.locator('[data-row="memo"] textarea').fill(text);
  await page.locator('[data-row="memo"] textarea').blur();
  await expect(page.locator('[data-row="memo"] [data-row-text]')).toHaveText(text);
}

test('通常PWAの配信：未送信を保って更新・互換版へ戻し、圏外再起動後も同じ履歴で二端末へ届ける', async ({ browser }) => {
  const { f, open, version, saved, control, initialOutline } = await fixture(browser);
  try {
    let a = await open(); const b = await open();
    await controlledPwa(a); await controlledPwa(b); await version(a, 'compatible');
    await expect.poll(async () => (await saved(a)).pending.length).toBe(0);
    const receipt = (await saved(a)).record, routeCalls = (await f.remoteState()).startup.routeCalls;
    expect((await f.remoteState()).entries).toBe(0);
    const first = `更新前の未送信🌿${randomUUID()}`;
    await control('delivery', { offline: true }); await write(a, first);
    await expect.poll(async () => (await saved(a)).pending.length).toBeGreaterThan(0);
    const beforeUpdate = await saved(a);
    await control('version', { version: 'latest' }); expect(await updatePwa(a)).toBe('activated');
    await a.reload({ waitUntil: 'domcontentloaded' }); await version(a, 'latest');
    await expect(a.locator('[data-row="memo"] [data-row-text]')).toHaveText(first);
    expect(await saved(a)).toEqual(beforeUpdate);
    await control('delivery', { offline: false });
    await expect(b.locator('[data-row="memo"] [data-row-text]')).toHaveText(first);
    await expect.poll(async () => (await saved(a)).pending.length).toBe(0);
    const second = `${first}・更新後の未送信🪴${randomUUID()}`;
    await control('delivery', { offline: true }); await write(a, second);
    await expect.poll(async () => (await saved(a)).pending.length).toBeGreaterThan(0);
    const beforeRollback = await saved(a);
    await control('version', { version: 'compatible' }); expect(await updatePwa(a)).toBe('activated');
    await a.reload({ waitUntil: 'domcontentloaded' }); await version(a, 'compatible');
    await expect(a.locator('[data-row="memo"] [data-row-text]')).toHaveText(second);
    expect(await saved(a)).toEqual(beforeRollback);
    const third = `${second}・互換版での追記🌱${randomUUID()}`;
    await write(a, third);
    await expect.poll(async () => (await saved(a)).pending.length).toBeGreaterThan(beforeRollback.pending.length);
    const beforeRestart = await saved(a);
    for (const entry of beforeRollback.pending) expect(beforeRestart.pending.find((value) => value.id === entry.id)).toEqual(entry);
    await f.stopHttp(true); a = await f.restart(a); await version(a, 'compatible');
    await expect(a.locator('[data-row="memo"] [data-row-text]')).toHaveText(third);
    expect(await saved(a)).toEqual(beforeRestart);
    await f.stopHttp(false);
    await control('version', { version: 'latest' }); expect(await updatePwa(a)).toBe('activated');
    await a.reload({ waitUntil: 'domcontentloaded' }); await version(a, 'latest');
    expect(await saved(a)).toEqual(beforeRestart);
    await control('delivery', { offline: false });
    await expect(b.locator('[data-row="memo"] [data-row-text]')).toHaveText(third);
    await expect.poll(async () => (await saved(a)).pending.length).toBe(0);
    expect((await saved(a)).record).toEqual(receipt);
    const remote = await f.remoteState();
    expect(remote.entries).toBe(beforeUpdate.pending.length + beforeRestart.pending.length);
    expect(remote.startup.routeCalls).toBe(routeCalls);
    expect(await a.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBe(initialOutline);
    await expect(a.locator('[data-pane="tasks"] [data-task-id="task-probe"]')).toBeVisible();
    await expect(a.locator('[data-outline-sync-conflict],[data-outline-recovery]')).toHaveCount(0);
    expect(f.authRequests).toEqual([]); expect(await f.legacyRequests()).toEqual([]); expect(f.errors).toEqual([]);
    expect(remote.served.some((entry) => entry.version === 'latest' && entry.path.endsWith('.js') && entry.path !== '/sw.js')).toBe(true);
    expect(await a.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) =>
      (await (await caches.open(key)).keys()).map((request) => request.url)))).flat().some((url) => url.endsWith('.wasm')))).toBe(true);
  } finally { await f.stopHttp(false); await control('delivery', { offline: false }); await f.close(); }
});

test('通常PWAの配信：更新ファイルを取得できないときも元の版で編集を保存し、再試行後に引き継ぐ', async ({ browser }) => {
  const { f, open, version, saved, control } = await fixture(browser);
  try {
    const page = await open(); await controlledPwa(page); await version(page, 'compatible');
    await control('delivery', { offline: true });
    const value = `配信の途中でも保持する🌿${randomUUID()}`; await write(page, value);
    await expect.poll(async () => (await saved(page)).pending.length).toBeGreaterThan(0);
    const before = await saved(page);
    await control('version', { version: 'latest', brokenAssets: true }); expect(await updatePwa(page)).toBe('rejected');
    expect((await f.remoteState()).served.some((entry) => entry.version === 'latest' && entry.status === 503)).toBe(true);
    await version(page, 'compatible'); expect(await saved(page)).toEqual(before);
    const next = `${value}・更新待ちの間にも追記${randomUUID()}`; await write(page, next);
    await expect.poll(async () => (await saved(page)).pending.length).toBeGreaterThan(before.pending.length);
    const pending = await saved(page);
    await control('version', { version: 'latest' }); expect(await updatePwa(page)).toBe('activated');
    await page.reload({ waitUntil: 'domcontentloaded' }); await version(page, 'latest');
    await expect(page.locator('[data-row="memo"] [data-row-text]')).toHaveText(next);
    expect(await saved(page)).toEqual(pending);
    await control('delivery', { offline: false });
    await expect.poll(async () => (await saved(page)).pending.length).toBe(0);
    expect((await f.remoteState()).entries).toBe(pending.pending.length);
    expect(f.authRequests).toEqual([]); expect(await f.legacyRequests()).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await control('delivery', { offline: false }); await f.close(); }
});
