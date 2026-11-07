import { test, expect } from './helpers.js';
import { Buffer } from 'node:buffer';

async function draw(page) {
  const canvas = page.locator('[data-sketch-canvas]');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.locator('[data-quick-add]').click();
  await page.locator('[data-quick-add-sketch]').click();
});

test('手書き：描画・全消去の取り消し・再起動からの復元ができる', async ({ page }) => {
  await draw(page);
  await expect(page.locator('[data-sketch-undo]')).toBeEnabled();
  await page.locator('[data-sketch-clear]').click();
  await expect(page.locator('[data-add-memo]')).toBeDisabled();
  await page.locator('[data-sketch-undo]').click();
  await expect(page.locator('[data-add-memo]')).toBeEnabled();
  await page.reload();
  await page.locator('[data-quick-add]').click();
  await expect(page.locator('[data-sketch-canvas]')).toBeVisible();
  expect(await page.locator('[data-sketch-canvas]').evaluate((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, i) => i % 4 < 3 && value < 200);
  })).toBe(true);
});

test('手書き：転送に失敗しても文字と絵を残し、再試行で一度だけ追加する', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('taskspace-drive-url', 'https://sketch.invalid/upload'));
  let fail = true, image;
  await page.route('https://sketch.invalid/upload', async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.mimeType).toBe('image/png');
    image = Buffer.from(payload.dataBase64, 'base64');
    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : { url: 'https://sketch.invalid/image.png' } });
  });
  await page.route('https://sketch.invalid/image.png', (route) => route.fulfill({ contentType: 'image/png', body: image }));
  await page.locator('[data-quick-add-dialog] textarea').fill('図の説明');
  await draw(page);
  await page.locator('[data-add-memo]').click();
  await expect(page.locator('[data-sketch-status]')).toContainText('下書きに残っています');
  await expect(page.locator('[data-quick-add-dialog] textarea')).toHaveValue('図の説明');
  await expect(page.locator('[data-sketch-undo]')).toBeEnabled();
  fail = false;
  await page.locator('[data-add-memo]').click();
  await expect(page.locator('[data-quick-add-dialog] textarea')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('taskspace-quick-sketch-v1'))).toBeNull();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('taskspace-outline-v1') || '[]');
    return (Array.isArray(saved) ? saved : saved.nodes).flatMap((day) => day.children || []).find((row) => row.text === '図の説明')?.children?.[0]?.text;
  })).toBe('https://sketch.invalid/image.png');
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('taskspace-outline-v1')));
  const rows = (Array.isArray(snapshot) ? snapshot : snapshot.nodes).flatMap((day) => day.children || []);
  expect(rows.filter((row) => row.text === '図の説明')).toHaveLength(1);
  expect(rows.find((row) => row.text === '図の説明').children[0].text).toBe('https://sketch.invalid/image.png');
});

test('手書き：転送中に閉じたら追加せず、描いた下書きを残す', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('taskspace-drive-url', 'https://sketch.invalid/upload'));
  let finish;
  const hold = new Promise((resolve) => { finish = resolve; });
  await page.route('https://sketch.invalid/upload', async (route) => {
    await hold;
    await route.fulfill({ json: { url: 'https://sketch.invalid/canceled.png' } }).catch(() => {});
  });
  await draw(page);
  const sent = page.waitForRequest('https://sketch.invalid/upload');
  await page.locator('[data-add-memo]').click();
  await sent;
  await page.locator('[data-quick-add-dialog] button[type="button"]').first().click();
  finish();
  await page.locator('[data-quick-add]').click();
  await expect(page.locator('[data-sketch-undo]')).toBeEnabled();
  await expect(page.locator('[data-sketch-status]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).not.toContain('canceled.png');
});
