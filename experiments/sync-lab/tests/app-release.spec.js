import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { appFixture } from './support/app-fixture.mjs';
import { outlineCheckpoint } from '../../../src/lib/outline-checkpoint.js';
import { flattenTree, outlineRowSignature } from '../../../src/lib/outline.js';

async function fixture(browser) {
  const manifest = JSON.parse(await readFile(new URL('../.data/app-preview.json', import.meta.url), 'utf8'));
  expect(manifest.synthetic).toBe(true); expect(manifest.config.mode).toBe('production'); expect(manifest.config.cutover).toBe(true);
  await fetch(`${manifest.config.url}/__app-fixture/reset`, { method: 'POST' });
  const f = await appFixture(browser, manifest), original = [{ id: 'memo', text: '端末を持ち替えて書くメモ', children: [] }];
  const text = `${original[0].text}・旧版の未送信${randomUUID()}`;
  const checkpoint = outlineCheckpoint([{ ...original[0], text }], { sequence: 1, pending: new Map([['memo', {
    id: 'memo', kind: 'put', version: 1, positionChanged: false, baseSignature: outlineRowSignature(flattenTree(original)[0]),
  }]]) }, new Set(), new Set(['memo']), 1, '2026-11-05');
  return { f, manifest, text, initialOutline: JSON.stringify(checkpoint),
    allow: async (allowed) => fetch(`${manifest.config.url}/__app-fixture/cutover`, { method: 'POST', body: JSON.stringify({ allowed }) }) };
}

async function saved(page, manifest) {
  return page.evaluate(({ ownerId, config }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(`taskspace-lab-loro-owner:${ownerId}:${config.docId}`, 2);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['state', 'outbox'], 'readonly');
      const record = tx.objectStore('state').get('cutover'), pending = tx.objectStore('outbox').count();
      tx.oncomplete = () => { db.close(); resolve({ record: record.result ?? null, pending: pending.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), manifest);
}

test('本番用の通常入口：既存ログインと未送信を引き継ぎ、PWAを終了しても同じ文書で続きを書ける', async ({ browser }) => {
  const { f, manifest, text, initialOutline, allow } = await fixture(browser);
  try {
    await allow(true);
    let page = await f.open({ pwa: true, existingLogin: true, initialOutline });
    await expect(page.locator('[data-row="memo"] [data-row-text]')).toHaveText(text);
    await expect(page.locator('[data-pane="tasks"] [data-task-id="task-probe"]')).toBeVisible();
    await expect.poll(async () => (await saved(page, manifest)).pending).toBe(0);
    const before = await saved(page, manifest), remoteBefore = await f.remoteState(), routeCalls = remoteBefore.startup.routeCalls;
    expect(before.record.phase).toBe('complete'); expect(before.record.originals.localRaw).toBe(initialOutline);
    expect(await page.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBe(initialOutline);
    expect(await page.evaluate(() => typeof window.labAuth)).toBe('undefined');
    expect(await page.evaluate(() => typeof window.lab)).toBe('undefined');
    const authKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('auth-token') || key.startsWith('taskspace-lab-auth-')));
    expect(authKeys).toEqual(['sb-127-auth-token']);
    const latest = `${text}・新しい編集${randomUUID()}`;
    await page.locator('[data-row="memo"] [data-row-text]').click();
    await page.locator('[data-row="memo"] textarea').fill(latest);
    await expect.poll(async () => (await f.remoteState()).entries).toBeGreaterThan(remoteBefore.entries);
    await expect.poll(async () => (await saved(page, manifest)).pending).toBe(0);
    await page.locator('[data-row="memo"] textarea').blur();
    await expect(page.locator('[data-row="memo"] [data-row-text]')).toHaveText(latest);
    await expect.poll(async () => (await saved(page, manifest)).pending).toBe(0);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const entriesBeforeRestart = (await f.remoteState()).entries;
    page = await f.restart(page);
    await expect(page.locator('[data-row="memo"] [data-row-text]')).toHaveText(latest);
    const after = await saved(page, manifest);
    expect(after.record).toEqual(before.record); expect(after.pending).toBe(0);
    const remoteAfter = await f.remoteState();
    expect(remoteAfter.startup.routeCalls).toBe(routeCalls); expect(remoteAfter.entries).toBe(entriesBeforeRestart);
    expect(await page.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBe(initialOutline);
    expect(f.authRequests).toEqual([]); expect(await f.legacyRequests()).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await allow(true); await f.close(); }
});

test('本番用の通常入口：旧書き込み停止の未確認では原本を引き継がず、新旧どちらへも送らない', async ({ browser }) => {
  const { f, manifest, initialOutline, allow } = await fixture(browser);
  try {
    await allow(false); const baseline = (await f.remoteState()).startup;
    const page = await f.open({ pwa: true, existingLogin: true, initialOutline, waitForOutline: false });
    await expect(page.locator('[data-outline-connecting] [data-error]')).not.toBeEmpty();
    await expect(page.locator('[data-row]')).toHaveCount(0);
    expect((await saved(page, manifest)).record).toBeNull();
    const after = (await f.remoteState()).startup;
    expect(after.routeCalls).toBeGreaterThan(baseline.routeCalls); expect(after.exchanges).toBe(baseline.exchanges);
    expect(await page.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBe(initialOutline);
    expect(f.authRequests).toEqual([]); expect(await f.legacyRequests()).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await allow(true); await f.close(); }
});
