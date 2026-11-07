import { test, expect } from '@playwright/test';
import { appFixture } from './support/app-fixture.mjs';

test('タブ追加：既存の分割と入力を保ち、独立したタブと分割を切り替えて再起動できる', async ({ browser }) => {
  const f = await appFixture(browser);
  try {
    const page = await f.open();
    const tabs = page.locator('[data-pane-tab]');
    await expect(tabs).toHaveText(['task', 'outliner']);
    const visible = page.locator('[data-pane-id]:visible');
    await expect(visible).toHaveCount(2);
    const handle = await page.locator('[data-pane-handle]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + 100, { steps: 5 });
    await page.mouse.up();
    const weights = () => page.evaluate(() => JSON.parse(localStorage.getItem('taskspace-panes-v1')).slice(0, 2).map((p) => p.weight));
    const originalWeights = await weights();
    expect(originalWeights[0]).toBeGreaterThan(originalWeights[1]);
    await page.locator('[data-pane-add]').click();
    await page.locator('[data-pane-add-tab]').click();
    await expect(tabs).toHaveCount(3);
    await expect(visible).toHaveCount(1);
    const thirdId = await visible.getAttribute('data-pane-id');
    await visible.locator('[data-row="memo"] [data-row-text]').click();
    await visible.locator('[data-row="memo"] textarea').fill('タブを移っても残る入力');
    await tabs.first().click();
    await expect(visible).toHaveCount(2);
    await tabs.nth(2).click();
    await expect(visible.locator('[data-row="memo"] [data-row-text]')).toHaveText('タブを移っても残る入力');
    expect(await weights()).toEqual(originalWeights);
    await page.locator('[data-pane-add]').click();
    await page.locator('[data-pane-add-split]').click();
    await expect(visible).toHaveCount(2);
    await expect(visible.first()).toHaveAttribute('data-pane-id', thirdId);
    await expect(page.locator('[data-pane-handle]')).toHaveCount(1);
    await page.evaluate(() => window.lab.localBarrier());
    await page.reload();
    await expect(visible).toHaveCount(2);
    await expect(visible.first()).toHaveAttribute('data-pane-id', thirdId);
    await tabs.first().click();
    await expect(visible).toHaveCount(2);
    await expect(visible.first()).toHaveAttribute('data-pane-id', 'tasks');
    expect(await weights()).toEqual(originalWeights);
    await tabs.nth(2).click();
    await page.locator('[data-pane-close]').nth(3).click();
    await expect(visible).toHaveCount(1);
    await expect(visible).toHaveAttribute('data-pane-id', thirdId);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('スマホのタブ：追加メニューが画面内に収まり、取り消しと種類変更ができる', async ({ browser }) => {
  const f = await appFixture({ newContext: (options) => browser.newContext({ ...options, viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true }) });
  try {
    const page = await f.open();
    await page.locator('[data-pane-close]').last().tap();
    await page.locator('[data-pane-add]').tap();
    const menu = page.locator('[data-pane-add-menu]');
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.locator('[data-pane-add]').tap();
    await page.locator('[data-pane-add-tab]').tap();
    await expect(page.locator('[data-pane-id]:visible')).toHaveCount(1);
    await page.locator('[data-pane-tab]').first().tap();
    await page.locator('[data-pane-mode]').first().selectOption('outline');
    await expect(page.locator('[data-pane-tab]').first()).toHaveText('outliner');
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
