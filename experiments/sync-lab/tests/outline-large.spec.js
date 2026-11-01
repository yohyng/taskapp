import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ownerFixture } from './support/owner-fixture.mjs';
import { seedOutlineDocument } from '../src/outline-model.js';
import { largeText } from './support/large-text.mjs';
import { LoroText } from 'loro-crdt';
import { loroNode } from '../src/loro-model.js';
import { splitLoroUpdate } from '../src/loro-update-parts.js';

const rowText = (page) => page.evaluate(() => window.lab.snapshot().find((row) => row.id === 'memo')?.text);
async function pending(page, owner, id) {
  return page.evaluate(async ({ owner, id }) => {
    const { openLoroStorage } = await import('/src/loro-storage.js');
    const storage = await openLoroStorage(`owner:${owner}:${id}`);
    try { return (await storage.read()).outbox.map((entry) => ({ id: entry.id, size: entry.bytes.length })); }
    finally { storage.close(); }
  }, { owner, id });
}

test('長文の本体画面：旧版の大きな未送信を分割し、二度の再読込と返事喪失を経ても全文と一回のUndoを保つ', async ({ browser }) => {
  const id = randomUUID(), owner = randomUUID(), fixture = await ownerFixture(id, { ownerId: owner });
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]), entries = [], attempts = [];
  const seed = seedOutlineDocument([{ id: 'memo', text: '基準メモ', children: [] }]);
  const snapshot = Buffer.from(seed.export({ mode: 'snapshot' })).toString('base64'), text = largeText(110000);
  let lose = true;
  async function open(context) {
    const page = await context.newPage();
    await page.addInitScript((config) => { window.labAuthConfig = config; }, { docId: id, key: fixture.apiKey });
    await fixture.routeAuth(page); await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
    await page.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
      const body = route.request().postDataJSON(), sizes = body.p_updates.map((entry) => Buffer.from(entry.bytes, 'base64').length);
      expect(body.p_updates.length).toBeLessThanOrEqual(32); expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(262144);
      expect(sizes.every((size) => size <= 65536)).toBe(true);
      for (const entry of body.p_updates) {
        const old = entries.find((value) => value.id === entry.id);
        if (old) expect(old.bytes).toBe(entry.bytes); else entries.push(entry);
      }
      if (body.p_updates.length) attempts.push(body.p_updates.map((entry) => entry.id));
      if (lose && body.p_updates.length) { lose = false; await route.abort('failed'); return; }
      const first = Math.max(0, body.p_cursor), pageEntries = entries.slice(first, first + 32);
      await route.fulfill({ json: { cursor: first + pageEntries.length, head: entries.length,
        snapshot: body.p_cursor === -1 ? snapshot : null, acknowledged: body.p_updates.map((entry) => entry.id),
        updates: pageEntries.map((entry, index) => ({ sequence: first + index + 1, bytes: entry.bytes })) } });
    });
    await page.goto('/outline.html');
    await page.getByPlaceholder('メールアドレス').fill(fixture.credentials.email); await page.getByPlaceholder('パスワード').fill(fixture.credentials.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click(); await expect(page.locator('[data-row="memo"]')).toBeVisible();
    return page;
  }
  try {
    const a = await open(contexts[0]), b = await open(contexts[1]);
    await a.evaluate(() => window.lab.disconnect());
    await a.locator('[data-row="memo"] [data-row-text]').click(); await a.locator('[data-row="memo"] textarea').fill(text);
    await a.evaluate(() => window.lab.localBarrier());
    const original = await pending(a, owner, id); expect(original.length).toBe(1); expect(original[0].size).toBeGreaterThan(65536);
    const blocked = (route) => route.abort('failed'); await a.route('**/rest/v1/rpc/taskspace_loro_exchange', blocked);
    await a.reload(); await expect(a.locator('[data-row="memo"]')).toBeVisible();
    await expect.poll(async () => (await pending(a, owner, id)).every((entry) => entry.size <= 65536)).toBe(true);
    const parts = await pending(a, owner, id); expect(parts.length).toBeGreaterThan(1); expect(parts.some((entry) => entry.id === original[0].id)).toBe(false);
    await a.reload(); await expect(a.locator('[data-row="memo"]')).toBeVisible(); expect(await rowText(a)).toBe(text);
    expect(await pending(a, owner, id)).toEqual(parts);
    await a.unroute('**/rest/v1/rpc/taskspace_loro_exchange', blocked);
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => a.evaluate(() => window.lab.queued())).toBe(false);
    await expect.poll(() => rowText(b)).toBe(text); expect(lose).toBe(false); expect(attempts[1]).toEqual(attempts[0]);
    // 再読込前のUndoは保存されない。戻った端末でも次の一回の貼り付けは一手で戻せる。
    await a.locator('[data-row="memo"] [data-row-text]').click(); await a.locator('[data-row="memo"] textarea').fill('短いメモ');
    await a.evaluate(() => window.lab.undo()); expect(await rowText(a)).toBe(text);
    await a.evaluate(() => window.lab.redo()); expect(await rowText(a)).toBe('短いメモ');
    await expect.poll(() => a.evaluate(() => window.lab.queued())).toBe(false); await expect.poll(() => rowText(b)).toBe('短いメモ');
    await expect(a.locator('[data-error]')).toBeEmpty(); await expect(a.locator('[data-outline-sync-conflict]')).toHaveCount(0);
  } finally { seed.free(); await Promise.all(contexts.map((context) => context.close())); await fixture.close(); }
});

test('長文の本体画面：作成途中の行を空行として表示せず、受信途中の再読込から残りを取り込む', async ({ browser }) => {
  const id = randomUUID(), owner = randomUUID(), fixture = await ownerFixture(id, { ownerId: owner }), context = await browser.newContext();
  const source = seedOutlineDocument([{ id: 'memo', text: '基準', children: [] }]), snapshot = Buffer.from(source.export({ mode: 'snapshot' })).toString('base64');
  let bytes; const stop = source.subscribeLocalUpdates((value) => { bytes = value; });
  loroNode(source, 'memo').data.get('text').insert(0, '文'.repeat(16383));
  const made = source.getTree('outline').createNode(); made.data.set('id', 'pasted-row');
  made.data.setContainer('text', new LoroText()).insert(0, '字'.repeat(30000)); source.commit(); stop();
  const parts = splitLoroUpdate(source, bytes).map((part) => Buffer.from(part).toString('base64')); let available = 1;
  try {
    const page = await context.newPage();
    await page.addInitScript((config) => { window.labAuthConfig = config; }, { docId: id, key: fixture.apiKey });
    await fixture.routeAuth(page); await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
    await page.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
      const body = route.request().postDataJSON(), first = Math.max(0, body.p_cursor);
      expect(body.p_updates).toEqual([]);
      await route.fulfill({ json: { cursor: available, head: available, snapshot: body.p_cursor === -1 ? snapshot : null,
        updates: parts.slice(first, available).map((part, index) => ({ sequence: first + index + 1, bytes: part })), acknowledged: [] } });
    });
    await page.goto('/outline.html');
    await page.getByPlaceholder('メールアドレス').fill(fixture.credentials.email); await page.getByPlaceholder('パスワード').fill(fixture.credentials.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click(); await expect(page.locator('[data-row="memo"]')).toBeVisible();
    expect(await page.evaluate(() => window.lab.snapshot().map((row) => row.id))).toEqual(['memo']);
    await page.evaluate(() => window.lab.localBarrier()); await page.reload(); await expect(page.locator('[data-row="memo"]')).toBeVisible();
    await expect(page.locator('[data-row]')).toHaveCount(1);
    available = parts.length; await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('[data-row="pasted-row"] [data-row-text]')).toHaveText('字'.repeat(30000));
    await expect(page.locator('[data-row]')).toHaveCount(2); await expect(page.locator('[data-error]')).toBeEmpty();
  } finally { source.free(); await context.close(); await fixture.close(); }
});
