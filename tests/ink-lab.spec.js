import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ viewport: { width: 393, height: 850 } });

async function draw(page, mode = 'speed') {
  await page.locator(`[data-ink-mode="${mode}"]`).click();
  await page.locator('[data-ink-canvas]').evaluate((canvas) => {
    canvas.setPointerCapture = () => {}; canvas.hasPointerCapture = () => false;
    const rect = canvas.getBoundingClientRect();
    let time = 0;
    const emit = (type, x, y, pressure) => {
      const event = new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y, pressure });
      Object.defineProperty(event, 'timeStamp', { value: time += 8 }); canvas.dispatchEvent(event);
    };
    emit('pointerdown', 0.2, 0.3, 0.1);
    for (let i = 1; i <= 30; i++) emit('pointermove', 0.2 + i / 60, 0.3 + Math.sin(i / 5) * 0.15, 0.1 + i / 40);
    emit('pointerup', 0.7, 0.3 + Math.sin(6) * 0.15, 0);
  });
}

test('四つの方式で同じ入力を比較し、下書きと画像の形を保つ', async ({ page }) => {
  const requests = [], errors = [];
  page.on('request', (r) => { if (/supabase|script.google/.test(r.url())) requests.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/ink-lab.html');
  await expect(page.locator('[data-ink-mode="speed"]')).toHaveAttribute('aria-pressed', 'true');
  await draw(page);
  await expect(page.locator('[data-ink-replay]')).toHaveCount(4);
  const replays = await page.locator('[data-ink-replay]').evaluateAll((canvases) => canvases.map((c) => c.toDataURL()));
  expect(new Set(replays).size).toBe(4);
  const pixels = await page.locator('[data-ink-base]').evaluate((c) => c.toDataURL());
  await page.locator('[data-ink-save]').click();
  await page.reload(); await page.locator('[data-ink-restore]').click();
  await expect.poll(() => page.locator('[data-ink-base]').evaluate((c) => c.toDataURL())).toBe(pixels);
  const pending = page.waitForEvent('download'); await page.locator('[data-ink-export]').click();
  expect(`data:image/png;base64,${(await readFile(await (await pending).path())).toString('base64')}`).toBe(pixels);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: `test-results/ink-comparison-${test.info().project.name}.png`, fullPage: true });
});

test('方式は線ごとに保持し、戻すと消去が働き入力も取り出せる', async ({ page }) => {
  await page.goto('/ink-lab.html');
  await draw(page, 'speed'); await draw(page, 'pressure'); await draw(page, 'fixed');
  await page.locator('[data-ink-save]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fragments-ink-comparison-v1')));
  expect(saved.map((s) => s.mode)).toEqual(['speed', 'pressure', 'fixed']);
  const pending = page.waitForEvent('download'); await page.locator('[data-ink-input]').click();
  const input = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  expect(input.stroke).toEqual(saved[2]);
  await page.locator('[data-ink-undo]').click(); await page.locator('[data-ink-save]').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fragments-ink-comparison-v1')).length)).toBe(2);
  await page.locator('[data-ink-clear]').click(); await expect(page.locator('[data-ink-replay]')).toHaveCount(0);
  await expect(page.locator('[data-ink-save]')).toBeDisabled();
});


test('実際のポインターを紙の外まで動かしても線を確定できる', async ({ page }) => {
  await page.goto('/ink-lab.html');
  const rect = await page.locator('[data-ink-canvas]').boundingBox();
  await page.mouse.move(rect.x + 30, rect.y + 30); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width + 10, rect.y + 80, { steps: 15 }); await page.mouse.up();
  await expect(page.locator('[data-ink-save]')).toBeEnabled();
  await page.locator('[data-ink-save]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fragments-ink-comparison-v1')));
  expect(saved).toHaveLength(1); expect(saved[0].samples.at(-1).x).toBe(600);
});


test('鉛筆の濃淡と紙目を保ち、復元とPNGで同じ表示になる', async ({ page }) => {
  await page.goto('/ink-lab.html'); await draw(page, 'pencil');
  await expect(page.locator('[data-ink-description]')).toContainText('押すと濃く');
  const pixels = await page.locator('[data-ink-base]').evaluate((c) => c.toDataURL());
  const tones = await page.locator('[data-ink-base]').evaluate((c) => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const tones = new Set(); for (let i = 0; i < data.length; i += 4) if (data[i] < 240) tones.add(data[i]); return [...tones];
  });
  expect(tones.length).toBeGreaterThan(20);
  expect(Math.min(...tones)).toBeGreaterThan(32);
  await page.locator('[data-ink-save]').click(); await page.reload(); await page.locator('[data-ink-restore]').click();
  await expect.poll(() => page.locator('[data-ink-base]').evaluate((c) => c.toDataURL())).toBe(pixels);
  const pending = page.waitForEvent('download'); await page.locator('[data-ink-export]').click();
  expect(`data:image/png;base64,${(await readFile(await (await pending).path())).toString('base64')}`).toBe(pixels);
  await page.screenshot({ path: `test-results/ink-pencil-${test.info().project.name}.png`, fullPage: true });
  const masses = [];
  for (const pressure of [0.1, 0.8]) {
    await page.evaluate((pressure) => {
      const strokes = JSON.parse(localStorage.getItem('fragments-ink-comparison-v1'));
      for (const stroke of strokes) for (const sample of stroke.samples) sample.p = pressure;
      localStorage.setItem('fragments-ink-comparison-v1', JSON.stringify(strokes));
    }, pressure);
    await page.locator('[data-ink-restore]').click();
    masses.push(await page.locator('[data-ink-base]').evaluate((c) => {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let mass = 0; for (let i = 0; i < data.length; i += 4) mass += 255 - data[i]; return mass;
    }));
  }
  expect(masses[1]).toBeGreaterThan(masses[0] * 1.2);

});


test('スライダーは見本と次の線へ適用し、基準と端末の設定を保存する', async ({ page }) => {
  await page.goto('/ink-lab.html'); await draw(page);
  const base = await page.locator('[data-ink-base]').evaluate((c) => c.toDataURL());
  const preview = await page.locator('[data-ink-tuning]').evaluate((c) => c.toDataURL());
  await page.locator('[data-ink-width]').focus(); await page.locator('[data-ink-width]').press('End');
  await expect(page.locator('[data-ink-width-value]')).toHaveText('40.0');
  expect(await page.locator('[data-ink-tuning]').evaluate((c) => c.toDataURL())).not.toBe(preview);
  expect(await page.locator('[data-ink-base]').evaluate((c) => c.toDataURL())).toBe(base);
  await page.locator('[data-ink-controls] summary').click();
  for (const name of ['thinning', 'response-thin', 'response-thick', 'streamline']) {
    await page.locator(`[data-ink-${name}]`).focus(); await page.locator(`[data-ink-${name}]`).press('End');
  }
  await draw(page); await page.locator('[data-ink-save]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fragments-ink-comparison-v1')));
  expect(saved[0].width).toBe(10); expect(saved[1].width).toBe(40);
  expect(saved[1].settings).toEqual({ thinning: 0.9, response: 16, responseThin: 64, responseThick: 64, streamline: 0.6, curveReturn: 0, widthResponse: 0, localReturn: 0, smoothing: 0.45, minPressure: 0.2 });
  await page.reload(); await expect(page.locator('[data-ink-width]')).toHaveValue('40');
  await page.locator('[data-ink-controls] summary').click();
  await expect(page.locator('[data-ink-response-thin]')).toHaveValue('64');
  await page.locator('[data-ink-reset]').click();
  await expect(page.locator('[data-ink-width]')).toHaveValue('10');
  await expect(page.locator('[data-ink-thinning]')).toHaveValue('60');
  await expect(page.locator('[data-ink-response-thin]')).toHaveValue('16');
  await expect(page.locator('[data-ink-streamline]')).toHaveValue('15');
  await page.locator('[data-ink-gentle-return]').click();
  await expect(page.locator('[data-ink-response-thin]')).toHaveValue('12');
  await expect(page.locator('[data-ink-response-thick]')).toHaveValue('28');
});

test('ゆらぎと厚みの設定を選び、従来の速度ペンへ戻せる', async ({ page }) => {
  await page.goto('/ink-lab.html');
  await page.locator('[data-ink-organic]').click();
  await page.locator('[data-ink-controls] summary').click();
  await expect(page.locator('[data-ink-streamline]')).toHaveValue('3');
  await expect(page.locator('[data-ink-response-thick]')).toHaveValue('12');
  await page.locator('[data-ink-baseline]').click();
  await expect(page.locator('[data-ink-streamline]')).toHaveValue('15');
});

test('スマホのタップで選択中の設定と次の線への適用を表示する', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto('/ink-lab.html');
    await page.locator('[data-ink-organic]').tap();
    await expect(page.locator('[data-ink-organic]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-ink-preset]')).toHaveText('選択中：ゆらぎと厚みを残す');
    await expect(page.locator('p[role=status]')).toContainText('次に書く線に適用');
    await page.reload();
    await expect(page.locator('[data-ink-organic]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-ink-baseline]').tap();
    await expect(page.locator('[data-ink-organic]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-ink-baseline]')).toHaveAttribute('aria-pressed', 'true');
  } finally { await context.close(); }
});

test('局所的なたまりをタップで選び、旧設定へ戻せる', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto('/ink-lab.html');
    await page.locator('[data-ink-local-return]').tap();
    await expect(page.locator('[data-ink-preset]')).toHaveText('選択中：細さと局所的なたまり');
    await page.reload();
    await expect(page.locator('[data-ink-local-return]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-ink-organic]').tap();
    await expect(page.locator('[data-ink-local-return]')).toHaveAttribute('aria-pressed', 'false');
  } finally { await context.close(); }
});

test('曲がりの設定をタップで選び、前の好感触な設定へ戻せる', async ({ page }) => {
  await page.goto('/ink-lab.html');
  await page.locator('[data-ink-curve-return]').click();
  await expect(page.locator('[data-ink-preset]')).toHaveText('選択中：曲がりとなめらかなたまり');
  await page.reload();
  await expect(page.locator('[data-ink-curve-return]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-ink-local-return]').click();
  await expect(page.locator('[data-ink-preset]')).toHaveText('選択中：細さと局所的なたまり');
});

test('局所的なたまりの強弱大を選び、基準へ戻せる', async ({ page }) => {
  await page.goto('/ink-lab.html');
  await page.locator('[data-ink-strong-return]').click();
  await expect(page.locator('[data-ink-preset]')).toHaveText('選択中：細さと局所的なたまり・強弱大');
  await page.locator('[data-ink-controls] summary').click();
  await expect(page.locator('[data-ink-thinning]')).toHaveValue('82');
  await page.reload();
  await expect(page.locator('[data-ink-strong-return]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-ink-local-return]').click();
  await expect(page.locator('[data-ink-strong-return]')).toHaveAttribute('aria-pressed', 'false');
});

test('強弱最大を選んで保存し、強弱大へ戻せる', async ({ page }) => {
  await page.goto('/ink-lab.html');
  await page.locator('[data-ink-extreme-return]').click();
  await expect(page.locator('[data-ink-preset]')).toHaveText('選択中：細さと局所的なたまり・強弱最大');
  await page.locator('[data-ink-controls] summary').click();
  await expect(page.locator('[data-ink-thinning]')).toHaveValue('90');
  await page.reload();
  await expect(page.locator('[data-ink-extreme-return]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-ink-strong-return]').click();
  await expect(page.locator('[data-ink-extreme-return]')).toHaveAttribute('aria-pressed', 'false');
});
