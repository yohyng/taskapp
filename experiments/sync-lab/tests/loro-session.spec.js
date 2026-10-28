import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ownerFixture } from './support/owner-fixture.mjs';

const input = (page) => page.getByRole('textbox', { name: 'row-0の本文', exact: true });
async function device(context, fixture, docId) {
  const page = await context.newPage();
  await page.addInitScript((config) => { window.labAuthConfig = config; }, { docId, key: fixture.apiKey });
  await fixture.route(page); await fixture.routeAuth(page); await page.goto('/session.html'); return page;
}
async function login(page, credentials) {
  await page.getByPlaceholder('メールアドレス').fill(credentials.email); await page.getByPlaceholder('パスワード').fill(credentials.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(input(page)).toBeVisible(); await page.waitForFunction(() => !!window.lab);
}
async function settled(page) {
  await page.evaluate(() => window.lab.localBarrier());
  await expect.poll(() => page.evaluate(() => window.lab.queued())).toBe(false);
  await expect.poll(() => page.evaluate(async () => JSON.stringify(window.lab.snapshot()) === JSON.stringify((await window.lab.serverState()).rows))).toBe(true);
  await expect(page.locator('[data-error]')).toBeEmpty();
}

test('既存ログイン：本体のAuthGateとSDKで二端末が入り、開いただけでは書かずに追記を受け取る', async ({ browser }) => {
  const id = `session-${randomUUID()}`, fixture = await ownerFixture(id, { ownerId: randomUUID() });
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const a = await device(contexts[0], fixture, id), b = await device(contexts[1], fixture, id);
    await login(a, fixture.credentials); await login(b, fixture.credentials); await settled(a); await settled(b);
    const token = await a.evaluate(async () => (await window.labAuth.auth.getSession()).data.session.access_token);
    expect((await (await fixture.state(token)).json()).changes).toBe(0);
    await input(a).press('ControlOrMeta+End'); await a.keyboard.insertText('・ログイン連携');
    await expect(input(b)).toHaveText('最初のメモ・ログイン連携'); await settled(a); await settled(b);
    await a.reload(); await expect(input(a)).toHaveText('最初のメモ・ログイン連携'); await settled(a);
  } finally { await Promise.all(contexts.map((context) => context.close())); await fixture.close(); }
});

test('既存ログイン：401からSDKを更新しても画面とUndoを作り直さず、更新待ちの追加入力も残す', async ({ browser }) => {
  const id = `refresh-${randomUUID()}`, fixture = await ownerFixture(id, { ownerId: randomUUID() }), context = await browser.newContext();
  try {
    const page = await device(context, fixture, id); await login(page, fixture.credentials); await settled(page);
    const generation = await page.evaluate(() => window.labGeneration);
    const token = await page.evaluate(async () => (await window.labAuth.auth.getSession()).data.session.access_token);
    const waiting = fixture.holdRefresh(); fixture.revoke(token);
    await input(page).press('ControlOrMeta+End'); await page.keyboard.insertText('・更新前'); await waiting;
    await page.keyboard.insertText('・更新待ち'); await page.evaluate(() => window.lab.localBarrier());
    fixture.releaseRefresh(); await settled(page); expect(fixture.refreshes()).toBe(1);
    expect(await page.evaluate(() => window.labGeneration)).toBe(generation);
    await expect(input(page)).toBeFocused(); await expect(input(page)).toHaveText('最初のメモ・更新前・更新待ち');
    await page.evaluate(() => window.lab.undo()); await settled(page);
    await expect(input(page)).toHaveText('最初のメモ・更新前');
  } finally { fixture.releaseRefresh(); await context.close(); await fixture.close(); }
});

test('既存ログイン：ログアウトと別利用者への切替で前の本文を隠し、本人へ戻ると未送信を自動再開する', async ({ browser }) => {
  const id = `signout-${randomUUID()}`, fixture = await ownerFixture(id, { ownerId: randomUUID() }), context = await browser.newContext();
  try {
    const page = await device(context, fixture, id); await login(page, fixture.credentials); await settled(page);
    await page.route('**/lab/owner-loro/sync?*', (route) => route.abort('failed'));
    await input(page).fill('本人の未送信メモ'); await page.evaluate(() => window.lab.localBarrier());
    await page.locator('[data-session-signout]').click(); await expect(page.getByPlaceholder('メールアドレス')).toBeVisible();
    await expect(input(page)).toHaveCount(0);
    const other = fixture.account(randomUUID());
    await page.evaluate(async (other) => { await window.labAuth.auth.signInWithPassword(other); }, other);
    await page.waitForFunction(() => !!window.lab); expect(await page.evaluate(() => window.lab.snapshot())).toEqual([]);
    await expect(input(page)).toHaveCount(0);
    await page.locator('[data-session-signout]').click(); await expect(page.getByPlaceholder('メールアドレス')).toBeVisible();
    await page.unroute('**/lab/owner-loro/sync?*');
    await login(page, fixture.credentials); await expect(input(page)).toHaveText('本人の未送信メモ'); await settled(page);
  } finally { await context.close(); await fixture.close(); }
});

test('既存ログイン：通信停止中の入力を保存し、onlineの通知で確認操作なしに送信を再開する', async ({ browser }) => {
  const id = `online-${randomUUID()}`, fixture = await ownerFixture(id, { ownerId: randomUUID() }), context = await browser.newContext();
  try {
    const page = await device(context, fixture, id); await login(page, fixture.credentials); await settled(page);
    await context.setOffline(true); await input(page).fill('通信復帰を待つ本文'); await page.evaluate(() => window.lab.localBarrier());
    expect(await page.evaluate(() => window.lab.queued())).toBe(true);
    await context.setOffline(false); await settled(page); await expect(input(page)).toHaveText('通信復帰を待つ本文');
  } finally { await context.close(); await fixture.close(); }
});

test('既存ログイン：最初の文書取得中にログアウトしても、遅い返事から前の本文を表示しない', async ({ browser }) => {
  const id = `initial-${randomUUID()}`, fixture = await ownerFixture(id, { ownerId: randomUUID() }), context = await browser.newContext();
  try {
    const page = await device(context, fixture, id); await fixture.hold(); const saving = fixture.saving();
    await page.getByPlaceholder('メールアドレス').fill(fixture.credentials.email);
    await page.getByPlaceholder('パスワード').fill(fixture.credentials.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click(); await saving;
    await page.locator('[data-session-signout]').click(); await expect(page.getByPlaceholder('メールアドレス')).toBeVisible();
    fixture.release();
    await expect(input(page)).toHaveCount(0);
    await login(page, fixture.credentials); await expect(input(page)).toHaveText('最初のメモ'); await settled(page);
  } finally { await context.close(); await fixture.close(); }
});

test('既存ログイン：保存済みの文書は通信の返事を待たずに開き、その間の追記も後で同期する', async ({ browser }) => {
  const id = `cached-${randomUUID()}`, fixture = await ownerFixture(id, { ownerId: randomUUID() }), context = await browser.newContext();
  let release; const delayed = new Promise((resolve) => { release = resolve; });
  try {
    const page = await device(context, fixture, id); await login(page, fixture.credentials); await settled(page);
    await page.route('**/lab/owner-loro/sync?*', async (route) => { await delayed; await route.fallback().catch(() => {}); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(input(page)).toBeVisible({ timeout: 2000 });
    await expect(input(page)).toHaveText('最初のメモ'); await input(page).press('ControlOrMeta+End'); await page.keyboard.insertText('・返事を待たずに書く');
    await page.evaluate(() => window.lab.localBarrier()); expect(await page.evaluate(() => window.lab.queued())).toBe(true);
    release(); await settled(page); await expect(input(page)).toHaveText('最初のメモ・返事を待たずに書く');
  } finally { release(); await context.close(); await fixture.close(); }
});
