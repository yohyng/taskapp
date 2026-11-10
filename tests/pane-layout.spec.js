import { test, expect } from './helpers.js';

test.use({ viewport: { width: 700, height: 900 }, hasTouch: true });
const panes = (page) => page.locator('[data-pane-id]:visible');
async function split(page, direction) {
  await page.locator('[data-pane-add]').tap();
  await page.locator(`[data-pane-add-${direction}]`).tap();
}
async function rects(page) {
  return panes(page).evaluateAll((items) => items.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.paneId, x: r.x, y: r.y, width: r.width, height: r.height }; }));
}

test('中央をタップすると四つの配置を一巡し、枠を作り直さない', async ({ page }) => {
  await split(page, 'row');
  await page.evaluate(() => { window.paneNodes = [...document.querySelectorAll('[data-pane-id]')]; window.paneNodes[0].scrollTop = 120; });
  for (let index = 0; index < 4; index++) {
    const [a, b] = await rects(page);
    if (index % 2 === 0) expect(a.x < b.x).toBe(index === 0);
    else expect(a.y < b.y).toBe(index === 1);
    await expect(page.locator('[data-panes]')).toHaveAttribute('data-pane-axis', index % 2 === 0 ? 'row' : 'column');
    expect(await page.evaluate(() => window.paneNodes.every((node) => node === document.querySelector(`[data-pane-id="${node.dataset.paneId}"]`)))).toBe(true);
    await page.locator('[data-pane-rotate]').tap();
  }
  const [a, b] = await rects(page); expect(a.x).toBeLessThan(b.x);
  expect(await page.evaluate(() => window.paneNodes[0].scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: `test-results/pane-layout-${test.info().project.name}.png` });
});

test('上下と左右を明示して選び、回転した順番も再読込で保つ', async ({ page }) => {
  await split(page, 'column');
  await expect(page.locator('[data-panes]')).toHaveAttribute('data-pane-axis', 'column');
  await page.locator('[data-pane-rotate]').tap();
  await page.reload();
  await expect(page.locator('[data-pane-direction]')).toHaveValue('row');
  const [a, b] = await rects(page); expect(a.x).toBeGreaterThan(b.x);
  await page.locator('[data-pane-direction]').selectOption('column');
  const [c, d] = await rects(page); expect(c.y).toBeGreaterThan(d.y);
  await page.screenshot({ path: `test-results/pane-layout-column-${test.info().project.name}.png` });
});

test('回転ボタンをドラッグしたときは回転せず、取り分だけを変える', async ({ page }) => {
  await split(page, 'column');
  const before = await rects(page), box = await page.locator('[data-pane-rotate]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('[data-panes]')).toHaveAttribute('data-pane-axis', 'column');
  expect((await rects(page))[0].height).toBeGreaterThan(before[0].height + 50);
  await page.locator('[data-pane-rotate]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-panes]')).toHaveAttribute('data-pane-axis', 'row');
});

test('方向は分割グループごとに保持し、他のタブへ持ち込まない', async ({ page }) => {
  await split(page, 'row');
  await page.locator('[data-pane-add]').tap(); await page.locator('[data-pane-add-tab]').tap();
  await split(page, 'column');
  await page.locator('[data-pane-tab]').first().tap();
  await expect(page.locator('[data-pane-direction]')).toHaveValue('row');
  await page.locator('[data-pane-tab]').last().tap();
  await expect(page.locator('[data-pane-direction]')).toHaveValue('column');
});

test('三分割でも全ての枠を保って向きと順番を切り替える', async ({ page }) => {
  await split(page, 'row'); await split(page, 'row');
  const original = await rects(page);
  await page.locator('[data-pane-rotate]').first().tap();
  await page.locator('[data-pane-rotate]').first().tap();
  const current = await rects(page);
  expect(current.map((p) => p.id)).toEqual(original.map((p) => p.id));
  expect(current[0].x).toBeGreaterThan(current[1].x); expect(current[1].x).toBeGreaterThan(current[2].x);
});


test('分割線に沿って外れたドラッグをしてもタップとして回転しない', async ({ page }) => {
  await split(page, 'column');
  const box = await page.locator('[data-pane-rotate]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('[data-panes]')).toHaveAttribute('data-pane-axis', 'column');
  await page.locator('[data-pane-rotate]').tap();
  await expect(page.locator('[data-panes]')).toHaveAttribute('data-pane-axis', 'row');
});
