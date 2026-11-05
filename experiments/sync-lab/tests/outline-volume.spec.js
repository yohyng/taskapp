import { test, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { ownerFixture } from './support/owner-fixture.mjs';
import { seedOutlineDocument } from '../src/outline-model.js';
import { loroViewRows } from '../src/loro-model.js';

// 私物の本文をサーバーや失敗時traceへ流さず、実データと同じ行数・根数・最大深さで実画面を検査する。
function volumeOutline() {
  const roots = Array.from({ length: 12 }, (_, i) => ({ id: `root-${i}`, text: `検証用の分類 ${i}`, collapsed: true, children: [] }));
  let parent = roots[0];
  for (let depth = 1; depth < 12; depth++) {
    const node = { id: `depth-${depth}`, text: `深い階層 ${depth}`, collapsed: true, children: [] };
    parent.children.push(node); parent = node;
  }
  for (let i = 0; i < 11438 - 23; i++) roots[i % 12].children.push({ id: `memo-${i}`,
    text: `検証用のメモ ${i}：端末を持ち替えても本文と親子と順番を保つ。`, children: [] });
  return roots;
}
const rows = (page) => page.evaluate(() => window.lab.snapshot());
const digest = (values) => createHash('sha256').update(JSON.stringify([...values].sort((a, b) => a.id.localeCompare(b.id))
  .map((row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))))).digest('hex');

test('本体の一万一千行：開くだけでは送らず、未送信の再読込と別端末の追記を全行一致で確かめる', async ({ browser }, info) => {
  test.setTimeout(180000);
  const docId = randomUUID(), auth = await ownerFixture(docId, { ownerId: randomUUID() });
  const doc = seedOutlineDocument(volumeOutline()), initialRows = loroViewRows(doc);
  const snapshot = Buffer.from(doc.export({ mode: 'snapshot' })).toString('base64'), entries = [], contexts = [];
  const metrics = { rows: initialRows.length, roots: 12, maxDepth: 12, browser: info.project.name };
  async function confirmed(page) {
    await page.evaluate(() => window.lab.localBarrier());
    await expect.poll(() => page.evaluate(() => window.lab.queued()), { timeout: 30000 }).toBe(false);
  }
  async function open() {
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage();
    await page.addInitScript((config) => { window.labAuthConfig = config; }, { docId, key: auth.apiKey });
    await auth.routeAuth(page); await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
    await page.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
      const body = route.request().postDataJSON();
      for (const entry of body.p_updates) {
        const old = entries.find((value) => value.id === entry.id);
        if (old) expect(old.bytes).toBe(entry.bytes); else entries.push(entry);
      }
      const start = Math.max(0, body.p_cursor), batch = entries.slice(start, start + 32);
      await route.fulfill({ json: { cursor: start + batch.length, head: entries.length,
        snapshot: body.p_cursor === -1 ? snapshot : null, acknowledged: body.p_updates.map((entry) => entry.id),
        updates: batch.map((entry, i) => ({ sequence: start + i + 1, bytes: entry.bytes })) } });
    });
    await page.goto('/outline.html');
    await page.getByPlaceholder('メールアドレス').fill(auth.credentials.email);
    await page.getByPlaceholder('パスワード').fill(auth.credentials.password);
    const started = performance.now();
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(page.locator('[data-row="root-0"]')).toBeVisible({ timeout: 30000 }); await confirmed(page);
    metrics[`open${contexts.length}Ms`] = performance.now() - started;
    expect(digest(await rows(page))).toBe(digest(initialRows));
    return page;
  }
  async function edit(page, id, text) {
    await page.locator(`[data-row="${id}"] [data-row-text]`).click();
    await page.locator(`[data-row="${id}"] textarea`).fill(text);
    await page.evaluate(() => window.lab.localBarrier());
  }
  try {
    expect(initialRows).toHaveLength(11438);
    const a = await open(), b = await open(); expect(entries).toHaveLength(0);
    const blocked = (route) => route.abort('failed'); await a.route('**/rest/v1/rpc/taskspace_loro_exchange', blocked);
    const started = performance.now(); await edit(a, 'root-0', '通信が止まっていても入力を残す🌿');
    metrics.localEditMs = performance.now() - started;
    expect(await a.evaluate(() => window.lab.queued())).toBe(true);
    const editedA = (await rows(a)).find((row) => row.id === 'root-0');
    await a.reload(); await expect(a.locator('[data-row="root-0"] [data-row-text]')).toHaveText(editedA.text, { timeout: 30000 });
    expect(await a.evaluate(() => window.lab.queued())).toBe(true);
    await edit(b, 'root-1', '別端末で続きから記入'); await confirmed(b);
    const editedB = (await rows(b)).find((row) => row.id === 'root-1');
    const expected = digest(initialRows.map((row) => row.id === editedA.id ? editedA : row.id === editedB.id ? editedB : row));
    await a.unroute('**/rest/v1/rpc/taskspace_loro_exchange', blocked);
    const resumed = performance.now(); await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await confirmed(a);
    for (const page of [a, b]) {
      await expect.poll(async () => digest(await rows(page)), { timeout: 30000 }).toBe(expected);
      await expect(page.locator('[data-error]')).toBeEmpty();
      await expect(page.locator('[data-outline-sync-conflict]')).toHaveCount(0);
    }
    metrics.reconnectMs = performance.now() - resumed;
    const sent = entries.length;
    await a.reload(); await expect(a.locator('[data-row="root-0"]')).toBeVisible(); await confirmed(a);
    expect(digest(await rows(a))).toBe(expected); expect(entries).toHaveLength(sent);
    await info.attach('実画面の一万行測定', { body: JSON.stringify(metrics), contentType: 'application/json' });
  } finally { doc.free(); await Promise.all(contexts.map((context) => context.close())); await auth.close(); }
});
