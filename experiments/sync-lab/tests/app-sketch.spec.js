import { test, expect } from '@playwright/test';
import { appFixture } from './support/app-fixture.mjs';
import { Buffer } from 'node:buffer';

test('手書きメモ：スマホでPNGを追加し、説明と画像を別端末へ一緒に届ける', async ({ browser }) => {
  const f = await appFixture({ newContext: (options) => browser.newContext({ ...options, viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }) });
  try {
    const a = await f.open(), b = await f.open();
    await a.evaluate(() => localStorage.setItem('taskspace-drive-url', 'https://sketch.invalid/upload'));
    let uploads = 0, image;
    await a.route('https://sketch.invalid/upload', async (route) => {
      uploads++;
      const payload = route.request().postDataJSON();
      expect(payload.mimeType).toBe('image/png');
      image = Buffer.from(payload.dataBase64, 'base64');
      await route.fulfill({ json: { url: 'https://sketch.invalid/image.png' } });
    });
    for (const page of [a, b]) await page.route('https://sketch.invalid/image.png', (route) => route.fulfill({ contentType: 'image/png', body: image }));
    await a.locator('[data-quick-add]').tap();
    await a.locator('[data-quick-add-dialog] textarea').fill('手で描いたアイデア');
    await a.locator('[data-quick-add-sketch]').tap();
    const canvas = a.locator('[data-sketch-canvas]');
    const resize = a.locator('[data-sketch-resize]');
    await resize.focus();
    await resize.press('ArrowDown');
    await resize.press('ArrowDown');
    const paperHeight = Number(await canvas.getAttribute('height'));
    expect(paperHeight).toBeGreaterThan(720);
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await a.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.8);
    await a.locator('[data-add-memo]').tap();
    await expect.poll(() => b.evaluate(() => {
      const rows = window.lab.snapshot(), note = rows.find((row) => row.text === '手で描いたアイデア');
      return note && rows.some((row) => row.parentId === note.id && row.text === 'https://sketch.invalid/image.png');
    })).toBe(true);
    await expect(b.locator('[data-row-image]')).toBeVisible();
    await expect.poll(() => b.locator('[data-row-image]').evaluate((img) => img.naturalWidth)).toBe(1200);
    await expect.poll(() => b.locator('[data-row-image]').evaluate((img) => img.naturalHeight)).toBe(paperHeight);
    expect(uploads).toBe(1);
    expect(await a.evaluate(() => localStorage.getItem('taskspace-quick-sketch-v1'))).toBeNull();
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
