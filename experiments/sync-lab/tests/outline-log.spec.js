import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { postgresLog } from './support/loro-postgres.mjs';
import { ownerFixture } from './support/owner-fixture.mjs';
import { seedOutlineDocument } from '../src/outline-model.js';
import { LoroDoc } from 'loro-crdt';
import { loroViewRows } from '../src/loro-model.js';

test.skip(process.env.LAB_POWERSYNC !== '1', '使い捨ての実PostgresがあるCIで実行する');
const editor = (page, id) => page.locator(`[data-row="${id}"] textarea`);
async function open(context, fixture, id, db) {
  const page = await context.newPage();
  await page.addInitScript((config) => { window.labAuthConfig = config; }, { docId: id, key: fixture.apiKey });
  await fixture.routeAuth(page);
  await page.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
    const request = route.request(), user = fixture.identify(request.headers().authorization);
    try {
      const body = request.postDataJSON();
      const result = await db.exchange(user, body.p_doc, body.p_cursor, body.p_updates);
      await route.fulfill({ json: result });
    } catch (error) { await route.fulfill({ status: user ? 403 : 401, json: { message: error.message } }).catch(() => {}); }
  });
  // 通知は意図的に届かせない。実SDKの購読に頼れない場合でもDBから追い付けることを試す。
  await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
  await page.goto('/outline.html');
  await page.getByPlaceholder('メールアドレス').fill(fixture.credentials.email); await page.getByPlaceholder('パスワード').fill(fixture.credentials.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.locator('[data-row="memo"]')).toBeVisible();
  await page.waitForFunction(() => !!window.lab); return page;
}
async function saved(page) {
  await page.evaluate(() => window.lab.localBarrier());
  await expect.poll(() => page.evaluate(() => window.lab.queued())).toBe(false);
  await expect(page.locator('[data-error]')).toBeEmpty();
  await expect(page.locator('[data-outline-sync-conflict]')).toHaveCount(0);
}
async function text(page, id) { return page.evaluate((id) => window.lab.snapshot().find((row) => row.id === id)?.text, id); }

test('本体画面と実DB：開くだけでは書かず、通知を失っても二端末で本文と属性を引き継ぐ', async ({ browser }) => {
  const db = await postgresLog(), owner = randomUUID(), seed = seedOutlineDocument([
    { id: 'memo', text: '持ち替えるメモ', collapsed: false, date: '2026-10-28', headingLevel: 2, textColor: '#ff0000', bgColor: null, imageWidth: 320,
      children: [{ id: 'child', text: '画像 https://example.test/image.png', children: [] }] },
    { id: 'other', text: '別のメモ', children: [] },
  ]);
  const id = await db.seed(owner, seed.export({ mode: 'snapshot' })); seed.free();
  const fixture = await ownerFixture(id, { ownerId: owner }), contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const a = await open(contexts[0], fixture, id, db), b = await open(contexts[1], fixture, id, db);
    await saved(a); await saved(b); expect((await db.exchange(owner, id)).head).toBe(0);
    await a.locator('[data-row="memo"] [data-row-text]').click(); await editor(a, 'memo').fill('持ち替えるメモ・PCで追記');
    await saved(a); await expect.poll(() => text(b, 'memo')).toBe('持ち替えるメモ・PCで追記');
    await b.locator('[data-fold="memo"]').click(); await saved(b);
    await expect.poll(() => a.evaluate(() => window.lab.outline()[0].collapsed)).toBe(true);
    const metadata = await a.evaluate(() => window.lab.outline()[0]);
    expect(metadata.date).toBe('2026-10-28'); expect(metadata.headingLevel).toBe(2); expect(metadata.imageWidth).toBe(320);
    const head = (await db.exchange(owner, id)).head;
    await a.reload(); await expect(a.locator('[data-row="memo"]')).toBeVisible(); await saved(a);
    expect((await db.exchange(owner, id)).head).toBe(head);
    const document = new LoroDoc();
    try {
      const result = await db.exchange(owner, id); document.import(Buffer.from(result.snapshot, 'base64'));
      for (const update of result.updates) document.import(Buffer.from(update.bytes, 'base64'));
      expect(loroViewRows(document)).toEqual(await a.evaluate(() => window.lab.snapshot()));
    } finally { document.free(); }
  } finally { await Promise.all(contexts.map((context) => context.close())); await fixture.close(); await db.close(); }
});

test('本体画面と実DB：圏外の入力と別端末の編集を、応答喪失・再起動をまたいで自動統合する', async ({ browser }) => {
  const db = await postgresLog(), owner = randomUUID(), seed = seedOutlineDocument([{ id: 'memo', text: 'メモ', children: [] }, { id: 'other', text: '別行', children: [] }]);
  const id = await db.seed(owner, seed.export({ mode: 'snapshot' })); seed.free();
  const fixture = await ownerFixture(id, { ownerId: owner }), contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const a = await open(contexts[0], fixture, id, db), b = await open(contexts[1], fixture, id, db);
    await saved(a); await saved(b);
    await a.locator('[data-row="memo"] [data-row-text]').click(); await editor(a, 'memo').fill('メモ・圏外');
    await saved(a);
    // 以降の通信だけ止め、手元の編集と取得位置を残したまま画面を開き直す。
    await a.route('**/rest/v1/rpc/taskspace_loro_exchange', (route) => route.abort('failed'));
    await editor(a, 'memo').fill('メモ・圏外・未送信'); await a.evaluate(() => window.lab.localBarrier());
    await b.locator('[data-row="other"] [data-row-text]').click(); await editor(b, 'other').fill('別行・スマホ'); await saved(b);
    await a.reload(); await expect(a.locator('[data-row="memo"]')).toBeVisible({ timeout: 2500 });
    expect(await text(a, 'memo')).toBe('メモ・圏外・未送信');
    let lost = false;
    await a.unroute('**/rest/v1/rpc/taskspace_loro_exchange');
    // unrouteは同じURLの全ハンドラーを外すので、実DBへの経路をもう一度登録する。
    await a.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
      const request = route.request(), body = request.postDataJSON();
      const result = await db.exchange(fixture.identify(request.headers().authorization), body.p_doc, body.p_cursor, body.p_updates);
      if (!lost && body.p_updates.length) { lost = true; await route.abort('failed'); }
      else await route.fulfill({ json: result });
    });
    await a.evaluate(() => window.lab.connect()); await saved(a); expect(lost).toBe(true);
    await expect.poll(() => text(a, 'other')).toBe('別行・スマホ'); await expect.poll(() => text(b, 'memo')).toBe('メモ・圏外・未送信');
    expect(await a.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBeNull();
    const rows = await db.pool.query('select count(*)::int as total, count(distinct update_id)::int as distinct_total from taskspace_loro.updates where doc_id=$1', [id]);
    expect(rows.rows[0].total).toBe(rows.rows[0].distinct_total);
  } finally { await Promise.all(contexts.map((context) => context.close())); await fixture.close(); await db.close(); }
});
