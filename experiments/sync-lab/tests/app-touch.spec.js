import { test, expect } from '@playwright/test';
import { appFixture } from './support/app-fixture.mjs';

test('スマホのアクセント：色を選びoutlinerの操作色へ反映し、再起動後も保つ', async ({ browser }) => {
  const f = await appFixture({ newContext: (options) => browser.newContext({ ...options, viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true }) });
  try {
    const page = await f.open();
    const note = page.locator('[data-quick-add]');
    const initial = await note.evaluate((el) => getComputedStyle(el).color);
    const settings = page.getByTitle('Settings', { exact: true });
    await settings.tap();
    await page.locator('[data-app-accent="#a78bfa"]').tap();
    await expect.poll(() => note.evaluate((el) => getComputedStyle(el).color)).not.toBe(initial);
    await expect(page.locator('[data-app-accent="#a78bfa"]')).toHaveAttribute('aria-pressed', 'true');
    await settings.tap();
    const date = page.locator('[data-date-view]');
    await date.tap();
    await expect.poll(() => date.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ts-accent').trim())).toBe('#a78bfa');
    await page.reload();
    await settings.tap();
    await expect(page.locator('[data-app-accent-custom]')).toHaveValue('#a78bfa');
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('スマホの上端：ノートと設定を指で開閉し、狭い画面でもボタンを覆わない', async ({ browser }) => {
  const f = await appFixture({ newContext: (options) => browser.newContext({ ...options, viewport: { width: 393, height: 780 }, isMobile: true, hasTouch: true }) });
  try {
    const page = await f.open(), actions = page.locator('[data-header-actions]');
    for (const size of [{ width: 393, height: 780 }, { width: 320, height: 568 }, { width: 780, height: 393 }]) {
      await page.setViewportSize(size);
      const note = actions.locator('[data-quick-add]'), settings = actions.getByTitle('Settings', { exact: true });
      await note.tap(); await expect(page.locator('[data-quick-add-dialog]')).toBeVisible();
      await page.locator('[data-quick-add-dialog] button[type="button"]').first().tap();
      await expect(page.locator('[data-quick-add-dialog]')).toHaveCount(0);
      await settings.tap(); await expect(page.locator('[data-header-settings]')).toBeVisible();
      const panel = await page.locator('[data-header-settings]').boundingBox();
      expect(panel.y).toBeGreaterThanOrEqual((await actions.boundingBox()).y + (await actions.boundingBox()).height);
      expect(panel.y + panel.height).toBeLessThanOrEqual(size.height);
      for (const button of await actions.locator('button:enabled').all()) {
        if (await button.evaluate((el) => !!el.closest('[data-header-settings]'))) continue;
        expect(await button.evaluate((el) => {
          const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }), `設定パネルがボタンを覆わない ${size.width}`).toBe(true);
      }
      expect(await settings.evaluate((button) => {
        const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), `設定を開いた後も上端を押せる ${size.width}`).toBe(true);
      await settings.tap(); await expect(page.locator('[data-header-settings]')).toHaveCount(0);
    }
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});


test('スマホの設定：映像取得がない端末でも開き、その後もノートをタップできる', async ({ browser }) => {
  const f = await appFixture({ newContext: async (options) => {
    const context = await browser.newContext({ ...options, viewport: { width: 393, height: 780 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => { Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { value: undefined, configurable: true }); });
    return context;
  } });
  try {
    const page = await f.open(), actions = page.locator('[data-header-actions]');
    await actions.getByTitle('Settings', { exact: true }).tap();
    await expect(page.locator('[data-header-settings]')).toBeVisible();
    await actions.locator('[data-quick-add]').tap();
    await expect(page.locator('[data-quick-add-dialog]')).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
