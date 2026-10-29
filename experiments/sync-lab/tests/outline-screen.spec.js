import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ownerFixture } from './support/owner-fixture.mjs';
import { seedOutlineDocument } from '../src/outline-model.js';
import { LoroDoc } from 'loro-crdt';

test('本体画面：既存textareaの入力・Undo・再読込を新同期へ渡し、旧保存へ書き戻さない', async ({ browser }) => {
  const id = randomUUID(), fixture = await ownerFixture(id, { ownerId: randomUUID() }), context = await browser.newContext();
  const doc = seedOutlineDocument([{ id: 'memo', text: '本体画面のメモ', children: [] }]), initial = Buffer.from(doc.export({ mode: 'snapshot' })).toString('base64'), entries = [];
  try {
    const page = await context.newPage();
    await page.addInitScript((config) => { window.labAuthConfig = config; }, { docId: id, key: fixture.apiKey }); await fixture.routeAuth(page);
    await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
    await page.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
      const body = route.request().postDataJSON();
      for (const entry of body.p_updates) if (!entries.some((old) => old.id === entry.id)) entries.push(entry);
      await route.fulfill({ json: { cursor: entries.length, head: entries.length, snapshot: body.p_cursor === -1 ? initial : null,
        updates: entries.slice(Math.max(0, body.p_cursor)).map((entry, index) => ({ sequence: Math.max(0, body.p_cursor) + index + 1, bytes: entry.bytes })),
        acknowledged: body.p_updates.map((entry) => entry.id) } });
    });
    await page.goto('/outline.html');
    await page.getByPlaceholder('メールアドレス').fill(fixture.credentials.email); await page.getByPlaceholder('パスワード').fill(fixture.credentials.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(page.locator('[data-row="memo"]')).toBeVisible(); expect(entries.length).toBe(0);
    await page.locator('[data-row="memo"] [data-row-text]').click(); await page.locator('[data-row="memo"] textarea').fill('本体画面で編集');
    await expect.poll(() => page.evaluate(() => window.lab.queued())).toBe(false);
    await page.evaluate(() => window.lab.undo()); await expect(page.locator('[data-row="memo"] textarea')).toHaveValue('本体画面のメモ');
    await page.evaluate(() => window.lab.redo()); await expect(page.locator('[data-row="memo"] textarea')).toHaveValue('本体画面で編集');
    await expect.poll(() => page.evaluate(() => window.lab.queued())).toBe(false);
    await page.reload(); await expect(page.locator('[data-row="memo"] [data-row-text]')).toHaveText('本体画面で編集');
    expect(await page.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBeNull();
    const check = new LoroDoc();
    try { check.import(Buffer.from(initial, 'base64')); for (const entry of entries) check.import(Buffer.from(entry.bytes, 'base64')); expect(check.getTree('outline').getNodes()[0].data.get('text').toString()).toBe('本体画面で編集'); }
    finally { check.free(); }
    await expect(page.locator('[data-error]')).toBeEmpty(); await expect(page.locator('[data-outline-sync-conflict]')).toHaveCount(0);
  } finally { doc.free(); await context.close(); await fixture.close(); }
});

test('端末の取得位置：受信保存に失敗した取引ではACKも取得位置も進めず、再送と再取得を残す', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (id) => {
    const { openLoroStorage } = await import('/src/loro-storage.js');
    const storage = await openLoroStorage(id), entry = { id: crypto.randomUUID(), bytes: new Uint8Array([1, 2, 3]) };
    try {
      await storage.append({ updates: [entry.bytes], outgoing: [entry] });
      let failed = false;
      try {
        // 同じIDの再追加で取引を中止し、同じ取引内の受信・ACK・cursorをすべて巻き戻す。
        await storage.append({ updates: [new Uint8Array([4])], outgoing: [entry], acknowledged: [entry.id], cursor: 7 });
      } catch { failed = true; }
      const before = await storage.read();
      await storage.append({ updates: [new Uint8Array([4])], acknowledged: [entry.id], cursor: 7 });
      const after = await storage.read();
      return { failed, before: { cursor: before.cursor, pending: before.outbox.length, received: before.updates.length },
        after: { cursor: after.cursor, pending: after.outbox.length, received: after.updates.length } };
    } finally { storage.close(); }
  }, `atomic-cursor-${randomUUID()}`);
  expect(result).toEqual({ failed: true, before: { cursor: -1, pending: 1, received: 1 }, after: { cursor: 7, pending: 0, received: 2 } });
});
