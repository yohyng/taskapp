import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { ownerFixture } from './support/owner-fixture.mjs';

const path = (id, offline = false) => `/?engine=loro&doc=${id}&input=bound${offline ? '&offline=1' : ''}`;
const input = (page) => page.getByRole('textbox', { name: 'row-0の本文', exact: true });
async function ready(page) { await page.waitForFunction(() => !!window.lab); await expect(page.locator('[data-row]')).toHaveCount(30); }
async function settled(page) {
  await page.evaluate(() => window.lab.localBarrier());
  await expect.poll(() => page.evaluate(() => window.lab.queued())).toBe(false);
  await expect.poll(() => page.evaluate(async () => JSON.stringify(window.lab.snapshot()) === JSON.stringify((await window.lab.serverState()).rows))).toBe(true);
  await expect(page.locator('[data-error]')).toBeEmpty();
}
async function device(context, fixture, token, refreshed = token, ownerId = fixture.ownerId) {
  const page = await context.newPage();
  await page.addInitScript(({ token, refreshed, ownerId }) => {
    window.testSession = { token, refreshed, refreshes: 0 };
    window.labConnection = { endpoint: '/lab/owner-loro', ownerId,
      async getAccessToken({ refresh }) {
        if (refresh) { window.testSession.refreshes++; window.testSession.token = window.testSession.refreshed; }
        return window.testSession.token;
      },
    };
  }, { token, refreshed, ownerId });
  await fixture.route(page); return page;
}

test('Loro本人認証：未認証・偽の本人申告・別利用者・許可外文書を拒否し、本人の二端末は変更だけを合流する', async ({ browser }) => {
  const id = `owner-${randomUUID()}`, fixture = await ownerFixture(id), token = fixture.issue();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    expect((await fixture.state()).status).toBe(401);
    expect((await fixture.state('forged-owner-token')).status).toBe(401);
    expect((await fixture.state(fixture.issue('別の利用者'))).status).toBe(403);
    expect((await fixture.state(token, 'other-document')).status).toBe(403);
    expect((await fixture.sync()).status).toBe(401);
    expect((await fixture.sync(fixture.issue('別の利用者'))).status).toBe(403);
    expect((await fixture.sync(token, {}, 'other-document')).status).toBe(403);
    expect(await readdir(fixture.directory)).toEqual([]);
    const [a, b] = await Promise.all(contexts.map((context) => device(context, fixture, token)));
    await a.goto(path(id)); await ready(a); await settled(a);
    await b.goto(path(id)); await ready(b); await settled(b);
    expect((await (await fixture.state(token)).json()).changes).toBe(0);
    await a.evaluate(() => window.lab.disconnect());
    await input(a).press('ControlOrMeta+End'); await a.keyboard.insertText('・端末A'); await a.evaluate(() => window.lab.localBarrier());
    await b.evaluate(() => window.lab.setAttribute('row-3', 'favorite', true)); await settled(b);
    await a.evaluate(() => window.lab.connect());
    await expect(input(b)).toHaveText('最初のメモ・端末A'); await settled(a); await settled(b);
    expect(await a.evaluate(() => window.lab.snapshot())).toEqual(await b.evaluate(() => window.lab.snapshot()));
  } finally { await Promise.all(contexts.map((context) => context.close())); await fixture.close(); }
});

test('Loro本人認証：失効後の再認証とAuth障害の間も入力を保存し、圏外再起動から確認操作なしで再送する', async ({ browser }) => {
  const id = `renew-${randomUUID()}`, fixture = await ownerFixture(id), old = fixture.issue(), fresh = fixture.issue();
  const context = await browser.newContext();
  try {
    const page = await device(context, fixture, old, fresh);
    await page.goto(path(id)); await ready(page); await settled(page); fixture.revoke(old);
    await input(page).fill('再認証の間の本文'); await settled(page);
    expect(await page.evaluate(() => window.testSession.refreshes)).toBe(1);
    fixture.unavailable(true);
    await input(page).press('ControlOrMeta+End'); await page.keyboard.insertText('・Auth停止中');
    await page.evaluate(() => window.lab.localBarrier());
    await expect.poll(() => page.evaluate(() => window.lab.queued())).toBe(true);
    await page.goto(path(id, true)); await ready(page); await expect(input(page)).toHaveText('再認証の間の本文・Auth停止中');
    expect(await page.evaluate(() => window.lab.queued())).toBe(true);
    fixture.unavailable(false); await page.evaluate(() => window.lab.connect()); await settled(page);
    await expect(input(page)).toHaveText('再認証の間の本文・Auth停止中');
    expect((await (await fixture.state(fresh)).json()).rows[0].text).toBe('再認証の間の本文・Auth停止中');
  } finally { await context.close(); await fixture.close(); }
});

test('Loro本人認証：同じブラウザーの別利用者へ前の本文と未送信を渡さず、再ログイン後は元の編集を再開する', async ({ browser }) => {
  const id = `identity-${randomUUID()}`, fixture = await ownerFixture(id), token = fixture.issue(), context = await browser.newContext();
  try {
    const a = await device(context, fixture, token); await a.goto(path(id)); await ready(a); await settled(a);
    await a.evaluate(() => window.lab.disconnect()); await input(a).fill('本人だけの未送信内容'); await a.evaluate(() => window.lab.localBarrier());
    const other = await device(context, fixture, fixture.issue('別利用者'), null, '別利用者');
    await other.goto(path(id)); await other.waitForFunction(() => !!window.lab);
    expect(await other.evaluate(() => window.lab.snapshot())).toEqual([]);
    expect(await other.evaluate(() => window.lab.queued())).toBe(false);
    expect((await (await fixture.state(token)).json()).rows[0].text).toBe('最初のメモ');
    const refreshes = await other.evaluate(() => window.testSession.refreshes);
    await other.waitForTimeout(600);
    expect(await other.evaluate(() => window.testSession.refreshes)).toBe(refreshes);
    await other.close(); await a.goto(path(id, true)); await ready(a); await expect(input(a)).toHaveText('本人だけの未送信内容');
    expect(await a.evaluate(() => window.lab.queued())).toBe(true);
    await a.evaluate(() => window.lab.connect()); await settled(a);
    expect((await (await fixture.state(token)).json()).rows[0].text).toBe('本人だけの未送信内容');
  } finally { await context.close(); await fixture.close(); }
});

test('Loro保存確定：保存途中のサーバーを強制終了しても送信待ちを消さず、再起動後に一度だけ反映する', async ({ browser }) => {
  const id = `crash-before-${randomUUID()}`, fixture = await ownerFixture(id), token = fixture.issue(), context = await browser.newContext();
  try {
    const page = await device(context, fixture, token); await page.goto(path(id)); await ready(page); await settled(page);
    await fixture.hold(); const saving = fixture.saving();
    await input(page).fill('保存途中でも残す本文'); await saving;
    await page.evaluate(() => window.lab.localBarrier()); expect(await page.evaluate(() => window.lab.queued())).toBe(true);
    await fixture.kill(); await page.goto(path(id, true)); await ready(page);
    await expect(input(page)).toHaveText('保存途中でも残す本文'); expect(await page.evaluate(() => window.lab.queued())).toBe(true);
    await fixture.restart();
    expect((await (await fixture.state(token)).json()).rows[0].text).toBe('最初のメモ');
    await page.evaluate(() => window.lab.connect()); await settled(page);
    await page.evaluate(() => window.lab.disconnect()); await fixture.kill(); await fixture.restart();
    const saved = (await (await fixture.state(token)).json()).rows;
    expect(saved).toEqual(await page.evaluate(() => window.lab.snapshot()));
    await page.goto(path(id)); await ready(page); await settled(page); expect(await page.evaluate(() => window.lab.snapshot())).toEqual(saved);
  } finally { await context.close(); await fixture.close(); }
});

test('Loro保存確定：保存後の返事を失いサーバーも再起動しても、再送で重複せず本人の別端末へ届く', async ({ browser }) => {
  const id = `crash-after-${randomUUID()}`, fixture = await ownerFixture(id), token = fixture.issue();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const a = await device(contexts[0], fixture, token); await a.goto(path(id)); await ready(a); await settled(a);
    await a.unroute('**/lab/owner-loro/**');
    let lost = false, committed;
    const saved = new Promise((resolve) => { committed = resolve; });
    // サーバーの200を取得した後、端末には返事を渡さない。次のポーリングも止めて再起動する。
    // fixtureの転送口が200を受けた時点を使い、実サーバーへの保存と端末への返事を切り分ける。
    await fixture.route(a, { async afterResponse(route, response) {
      if (lost) { await route.abort('failed'); return true; }
      if (route.request().url().includes('/sync?') && route.request().postDataJSON().updates.length) {
        expect(response.status()).toBe(200); lost = true; committed(); await route.abort('failed'); return true;
      }
      return false;
    } });
    await input(a).press('ControlOrMeta+End'); await a.keyboard.insertText('・返事だけ喪失'); await saved;
    expect(await a.evaluate(() => window.lab.queued())).toBe(true); await fixture.kill();
    await a.goto(path(id, true)); await ready(a); await expect(input(a)).toHaveText('最初のメモ・返事だけ喪失');
    await fixture.restart(); expect((await (await fixture.state(token)).json()).rows[0].text).toBe('最初のメモ・返事だけ喪失');
    await a.unroute('**/lab/owner-loro/**'); await fixture.route(a); await a.evaluate(() => window.lab.connect()); await settled(a);
    const b = await device(contexts[1], fixture, token); await b.goto(path(id)); await ready(b); await settled(b);
    await expect(input(b)).toHaveText('最初のメモ・返事だけ喪失');
    expect(await a.evaluate(() => window.lab.snapshot())).toEqual(await b.evaluate(() => window.lab.snapshot()));
  } finally { await Promise.all(contexts.map((context) => context.close())); await fixture.close(); }
});
