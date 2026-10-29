import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const path = (id, offline = false) => `/?engine=loro&doc=${id}&input=bound${offline ? '&offline=1' : ''}`;
const sync = (id) => `/lab/loro/sync?doc=${id}`;
const input = (page, id = 'row-0') => page.getByRole('textbox', { name: `${id}の本文`, exact: true });
async function ready(page) { await page.waitForFunction(() => !!window.lab); await expect(page.locator('[data-row]')).toHaveCount(30); }
async function settled(page) {
  await page.evaluate(() => window.lab.localBarrier());
  await expect.poll(() => page.evaluate(() => window.lab.queued())).toBe(false);
  await expect.poll(() => page.evaluate(async () => JSON.stringify(window.lab.snapshot()) === JSON.stringify((await window.lab.serverState()).rows))).toBe(true);
  await expect(page.locator('[data-error]')).toBeEmpty();
}

test('Loro初回配信：開くだけでは書き戻さず、snapshotをまとめ直す前の圏外再起動でも全文を保つ', async ({ page, request }) => {
  const id = `bootstrap-${randomUUID()}`, before = await (await request.get(`/lab/loro/server-state?doc=${id}`)).json();
  const first = page.waitForResponse((response) => response.url().includes(sync(id)) && response.status() === 200);
  await page.goto(path(id)); await ready(page); await settled(page);
  const reply = await first, payload = await reply.json();
  expect(reply.request().postDataJSON()).toMatchObject({ bootstrap: true, updates: [] }); expect(payload.mode).toBe('snapshot');
  const expected = await page.evaluate(() => window.lab.snapshot()), native = await page.evaluate(() => window.lab.nativeIds());
  expect(await page.evaluate(() => window.lab.transferStats().snapshots)).toBe(1);
  expect(await page.evaluate(() => window.lab.persistenceStats().checkpointExports)).toBe(0);
  expect(await page.evaluate(() => window.lab.projectionStats().fullRebuilds)).toBe(1);
  await page.evaluate(() => window.lab.disconnect()); await page.goto(path(id, true)); await ready(page);
  expect(await page.evaluate(() => window.lab.snapshot())).toEqual(expected); expect(await page.evaluate(() => window.lab.nativeIds())).toEqual(native);
  expect(await page.evaluate(() => window.lab.queued())).toBe(false);
  const next = page.waitForRequest((request) => request.url().includes(sync(id)));
  await page.evaluate(() => window.lab.connect()); expect((await next).postDataJSON()).toMatchObject({ bootstrap: false, updates: [] });
  await settled(page); expect((await page.evaluate(() => window.lab.serverState())).changes).toBe(before.changes);
});

test('Loro初回配信：古い端末の未送信追記を差分で送り、別端末の属性と合流する', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [a, b] = await Promise.all(contexts.map((context) => context.newPage())), id = `stale-${randomUUID()}`;
  try {
    await a.goto(path(id)); await ready(a); await settled(a); await a.evaluate(() => window.lab.disconnect());
    await input(a).press('ControlOrMeta+End'); await a.keyboard.insertText('・圏外の続き'); await a.evaluate(() => window.lab.localBarrier());
    await a.goto(path(id, true)); await ready(a);
    await b.goto(path(id)); await ready(b);
    await b.evaluate(() => window.lab.setAttribute('row-3', 'favorite', true)); await settled(b);
    const sending = a.waitForRequest((request) => request.url().includes(sync(id)) && request.postDataJSON().updates.length > 0);
    await a.evaluate(() => window.lab.connect()); expect((await sending).postDataJSON().bootstrap).toBe(false);
    await expect(input(b)).toHaveText('最初のメモ・圏外の続き'); await settled(a); await settled(b);
    expect(await a.evaluate(() => window.lab.transferStats().snapshots)).toBe(0);
    expect(await a.evaluate(() => window.lab.snapshot())).toEqual(await b.evaluate(() => window.lab.snapshot()));
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test('Loro初回配信：サーバーの前提待ち受信も同時保存し、圏外再起動後に前提を受け取って復元する', async ({ page, browser, request }) => {
  const id = `pending-bootstrap-${randomUUID()}`;
  await page.goto(path(`probe-${randomUUID()}`, true)); await page.waitForFunction(() => !!window.lab);
  const parts = await page.evaluate(async (id) => {
    const { LoroDoc } = await import('/src/loro-runtime.js'), { loroNode } = await import('/src/loro-model.js');
    const doc = new LoroDoc(), version = [...doc.oplogVersion().encode()];
    try {
      const response = await fetch(`/lab/loro/sync?doc=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, updates: [], bootstrap: true }) });
      const payload = await response.json(); doc.import(Uint8Array.from(payload.update));
      const base = [...doc.oplogVersion().encode()], updates = [];
      const stop = doc.subscribeLocalUpdates((bytes) => updates.push([...bytes]));
      loroNode(doc, 'row-0').data.get('text').insert(0, '前提：'); doc.commit();
      loroNode(doc, 'row-0').data.get('text').insert(0, '後続：'); doc.commit(); stop();
      return { base, updates, expected: loroNode(doc, 'row-0').data.get('text').toString() };
    } finally { doc.free(); }
  }, id);
  expect((await request.post(sync(id), { data: { version: parts.base, updates: [parts.updates[1]] } })).ok()).toBe(true);
  const context = await browser.newContext(), b = await context.newPage();
  try {
    const first = b.waitForResponse((response) => response.url().includes(sync(id)) && response.status() === 200);
    await b.goto(path(id)); await ready(b); expect((await (await first).json()).pending.length).toBeGreaterThan(0);
    await b.evaluate(() => window.lab.disconnect()); await b.goto(path(id, true)); await ready(b);
    expect(await b.evaluate(() => !!window.lab.loroBinding('row-0').rawSource.exportPendingUpdates()?.length)).toBe(true);
    expect((await request.post(sync(id), { data: { version: parts.base, updates: [parts.updates[0]] } })).ok()).toBe(true);
    await b.evaluate(() => window.lab.connect()); await expect(input(b)).toHaveText(parts.expected); await settled(b);
    expect(await b.evaluate(() => !!window.lab.loroBinding('row-0').rawSource.exportPendingUpdates()?.length)).toBe(false);
  } finally { await context.close(); }
});

test('Loro初回配信：壊れた後半を受けても前半だけ保存せず、再取得で元の文書を開ける', async ({ page }) => {
  const id = `bad-bootstrap-${randomUUID()}`; let damaged = false;
  await page.route('**/lab/loro/sync?*', async (route) => {
    if (damaged) return route.abort('failed');
    const response = await route.fetch(), payload = await response.json(); damaged = true;
    await route.fulfill({ response, json: { ...payload, pending: [1, 2, 3] } });
  });
  await page.goto(path(id)); await page.waitForFunction(() => !!window.lab);
  expect(await page.evaluate(() => window.lab.snapshot())).toEqual([]);
  expect(await page.evaluate(() => window.lab.transferStats().snapshots)).toBe(0);
  const stored = await page.evaluate(async (id) => {
    const { openLoroStorage } = await import('/src/loro-storage.js'), storage = await openLoroStorage(id);
    try { const saved = await storage.read(); return { base: saved.base.snapshot, updates: saved.updates.length, outgoing: saved.outbox.length }; } finally { storage.close(); }
  }, id);
  expect(stored).toEqual({ base: null, updates: 0, outgoing: 0 });
  await page.unroute('**/lab/loro/sync?*'); await page.evaluate(() => window.lab.connect()); await ready(page); await settled(page);
  expect(await page.evaluate(() => window.lab.projectionStats().fullRebuilds)).toBe(1);
  await input(page).fill('再取得後も入力できる'); await settled(page);
  await page.evaluate(() => window.lab.undo()); await expect(input(page)).toHaveText('最初のメモ'); await settled(page);
});

test('Loro初回配信：既存履歴や送信を混ぜた初回要求を部分適用せず、旧要求には差分を返す', async ({ page, request }) => {
  const id = `invalid-bootstrap-${randomUUID()}`;
  await page.goto(path(id)); await ready(page); await settled(page); await page.evaluate(() => window.lab.disconnect());
  const before = await page.evaluate(() => window.lab.serverState());
  const payload = await page.evaluate(() => {
    const source = window.lab.loroBinding('row-0').rawSource, doc = source.fork(), version = [...source.oplogVersion().encode()];
    try {
      let update; const stop = doc.subscribeLocalUpdates((bytes) => { update = [...bytes]; });
      doc.getTree('outline').getNodes().find((node) => node.data.get('id') === 'row-0').data.get('text').insert(0, '拒否する：'); doc.commit(); stop();
      return { version, update };
    } finally { doc.free(); }
  });
  for (const updates of [[], [payload.update]]) expect((await request.post(sync(id), { data: { version: payload.version, updates, bootstrap: true } })).status()).toBe(500);
  expect(await page.evaluate(() => window.lab.serverState())).toEqual(before);
  const legacy = await request.post(sync(id), { data: { version: payload.version, updates: [] } });
  expect(legacy.ok()).toBe(true); expect((await legacy.json()).mode).toBe('update');
});
