import { test, expect, storedTasks } from "./helpers.js";

// PJ の箱は、横だけでなく上下にも置ける。
// 段は rowKey で束ね、画面の上下の並びは配列の順で決まる。

const BOARD = "board-7days";
const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
const pj = (id, title, col, rowKey = "r1") => t(id, title, { blockType: "column", rowKey, col });
const board = async (page) => (await storedTasks(page)).filter((x) => x.pageId === BOARD);
const byTitle = async (page, title) => (await board(page)).find((x) => x.title === title);

// ⠿ を掴んで、落とし先まで運ぶ
const dragPj = async (page, title, to) => {
  // 箱ごとに ⠿ がある。積んであるときは、掴みたい箱のものを選ぶ。
  const box = page.locator("[data-col-box]").filter({ hasText: title }).first();
  await box.hover();
  const grip = box.locator("[data-pj-grab]").first();
  const from = await grip.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up();
};

const under = (id, title, col, n) => Array.from({ length: n }, (_, i) =>
  t(`${id}-${i}`, `${title} の ${i + 1}`, { rowKey: "r1", col }));

test.beforeEach(async ({ seed }) => {
  // 実際の板と同じく、箱には中身がある（背が低いと落とし分けが窮屈になる）
  await seed({ tasks: [
    pj("c1", "ALPHA", 0), ...under("a", "ALPHA", 0, 6),
    pj("c2", "BETA", 1), ...under("b", "BETA", 1, 6),
    pj("c3", "GAMMA", 2), ...under("g", "GAMMA", 2, 2),
  ] });
});

test("段の下の端へ落とすと、下に新しい段ができる", async ({ page }) => {
  const rowBox = await page.locator("[data-row-key]").first().boundingBox();
  await dragPj(page, "GAMMA", { x: rowBox.x + rowBox.width / 2, y: rowBox.y + rowBox.height - 4 });

  await expect.poll(async () => {
    const list = await board(page);
    const gamma = list.find((x) => x.title === "GAMMA");
    const alpha = list.find((x) => x.title === "ALPHA");
    return gamma && alpha && gamma.rowKey !== alpha.rowKey;
  }).toBe(true);
  // 残った段は、列番号が詰まる
  expect((await byTitle(page, "ALPHA")).col).toBe(0);
  expect((await byTitle(page, "BETA")).col).toBe(1);
  expect((await byTitle(page, "GAMMA")).col).toBe(0);
  // 画面でも、下の段に出る
  const rows = page.locator("[data-row-key]");
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).boundingBox(), second = await rows.nth(1).boundingBox();
  expect(second.y).toBeGreaterThan(first.y);
  await expect(rows.nth(1)).toContainText("GAMMA");
});

test("段の上の端へ落とすと、上に新しい段ができる", async ({ page }) => {
  const rowBox = await page.locator("[data-row-key]").first().boundingBox();
  await dragPj(page, "GAMMA", { x: rowBox.x + rowBox.width / 2, y: rowBox.y + 4 });

  const rows = page.locator("[data-row-key]");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("GAMMA");
  await expect(rows.nth(1)).toContainText("ALPHA");
});

test("下の段から、上の段の列のあいだへ戻せる", async ({ page }) => {
  const rowBox = await page.locator("[data-row-key]").first().boundingBox();
  await dragPj(page, "GAMMA", { x: rowBox.x + rowBox.width / 2, y: rowBox.y + rowBox.height - 4 });
  await expect(page.locator("[data-row-key]")).toHaveCount(2);

  // ALPHA の左半分へ落とす＝その前に入る
  const alpha = page.locator('[data-row-key] [data-col-index="0"]').first();
  const box = await alpha.boundingBox();
  await dragPj(page, "GAMMA", { x: box.x + 10, y: box.y + box.height / 2 });

  await expect(page.locator("[data-row-key]")).toHaveCount(1);
  await expect.poll(async () => (await byTitle(page, "GAMMA"))?.col).toBe(0);
  expect((await byTitle(page, "ALPHA")).col).toBe(1);
  expect((await byTitle(page, "BETA")).col).toBe(2);
});

test("横の並べ替えは、これまで通り", async ({ page }) => {
  const beta = page.locator('[data-row-key] [data-col-index="1"]').first();
  const box = await beta.boundingBox();
  await dragPj(page, "ALPHA", { x: box.x + box.width - 8, y: box.y + box.height / 2 });

  await expect.poll(async () => (await byTitle(page, "ALPHA"))?.col).toBe(1);
  expect((await byTitle(page, "BETA")).col).toBe(0);
  // 段は増えない
  await expect(page.locator("[data-row-key]")).toHaveCount(1);
});

test("列の下へ落とすと、その列に積まれる", async ({ page }) => {
  // GAMMA を ALPHA の下へ（画像の「PRIVATE の下に DESIGNART」と同じ形）
  const alpha = page.locator('[data-row-key] [data-col-index="0"]').first();
  const box = await alpha.boundingBox();
  await dragPj(page, "GAMMA", { x: box.x + box.width / 2, y: box.y + box.height * 0.9 });

  await expect.poll(async () => (await byTitle(page, "GAMMA"))?.col).toBe(0);
  expect((await byTitle(page, "GAMMA")).rowKey).toBe((await byTitle(page, "ALPHA")).rowKey);
  // 段は増えない。列は2本になる（ALPHA+GAMMA / BETA）
  await expect(page.locator("[data-row-key]")).toHaveCount(1);
  await expect(page.locator("[data-row-key] [data-col-index]")).toHaveCount(2);
  // 同じ列の中で、箱が2つ縦に並ぶ
  const stacked = page.locator('[data-col-index="0"] [data-col-box]');
  await expect(stacked).toHaveCount(2);
  const first = await stacked.nth(0).boundingBox(), second = await stacked.nth(1).boundingBox();
  expect(second.y).toBeGreaterThan(first.y);
  await expect(stacked.nth(0)).toContainText("ALPHA");
  await expect(stacked.nth(1)).toContainText("GAMMA");
});

test("積んだ箱も、それぞれ枠と数を持つ", async ({ page }) => {
  const alpha = page.locator('[data-row-key] [data-col-index="0"]').first();
  const box = await alpha.boundingBox();
  await dragPj(page, "GAMMA", { x: box.x + box.width / 2, y: box.y + box.height * 0.9 });
  await expect(page.locator('[data-col-index="0"] [data-col-box]')).toHaveCount(2);
  await expect(page.locator('[data-col-index="0"] [data-col-count]')).toHaveCount(2);
});

test("積んだ箱を、また別の段へ出せる", async ({ page }) => {
  const alpha = page.locator('[data-row-key] [data-col-index="0"]').first();
  const box = await alpha.boundingBox();
  await dragPj(page, "GAMMA", { x: box.x + box.width / 2, y: box.y + box.height * 0.9 });
  await expect(page.locator('[data-col-index="0"] [data-col-box]')).toHaveCount(2);

  const rowBox = await page.locator("[data-row-key]").first().boundingBox();
  await dragPj(page, "GAMMA", { x: rowBox.x + rowBox.width / 2, y: rowBox.y + rowBox.height - 4 });
  const rows = page.locator("[data-row-key]");
  await expect(rows).toHaveCount(2);
  // 上の段には ALPHA が残り、GAMMA だけが下の段へ出る
  await expect(rows.nth(0)).toContainText("ALPHA");
  await expect(rows.nth(1)).toContainText("GAMMA");
  await expect(rows.nth(1)).not.toContainText("ALPHA");
});

test("見出しの帯をそのまま掴んで動かせる", async ({ page }) => {
  // ⠿ を探さなくても、箱の見出しから動かせる
  const gammaBand = page.locator('[data-col-box="c3"]').locator("> *").first();
  const from = await gammaBand.boundingBox();
  const alpha = page.locator('[data-row-key] [data-col-index="0"]').first();
  const to = await alpha.boundingBox();

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.85, { steps: 14 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.85, { steps: 2 });
  await page.mouse.up();

  await expect.poll(async () => (await byTitle(page, "GAMMA"))?.col).toBe(0);
  await expect(page.locator('[data-col-index="0"] [data-col-box]')).toHaveCount(2);
});

test("見出しを押しただけなら、これまで通り名前を直せる", async ({ page }) => {
  const band = page.locator('[data-col-box="c1"]').locator("> *").first();
  await band.click();
  await expect(page.locator('[data-col-box="c1"] textarea')).toBeVisible();
  // 段も列も動いていない
  await expect(page.locator("[data-row-key]")).toHaveCount(1);
  expect((await byTitle(page, "ALPHA")).col).toBe(0);
});

test("⠿ は、ふだんから見えている", async ({ page }) => {
  const grip = page.locator('[data-col-box="c1"] [data-pj-grab]').first();
  await expect(grip).toBeVisible();
  const look = await grip.evaluate((el) => {
    const bar = el.closest("[data-col]");
    return { opacity: Number(getComputedStyle(bar).opacity), w: el.getBoundingClientRect().width };
  });
  expect(look.opacity).toBeGreaterThan(0.3);
  expect(look.w).toBeGreaterThanOrEqual(16);
});

test("箱を掴んでいるあいだ、ブロックのドラッグや範囲選択は走らない", async ({ page }) => {
  const band = page.locator('[data-col-box="c3"]').locator("> *").first();
  const from = await band.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 120, from.y + 160, { steps: 10 });

  // ブロックを運んでいる印も、範囲選択の枠も出ない
  await expect(page.locator("[data-drop-line]")).toHaveCount(0);
  await expect(page.locator("[data-marquee]")).toHaveCount(0);
  // 掴んでいる箱の印だけが出ている
  await expect(page.locator('[data-col-index]').filter({ hasText: "GAMMA" }).first()).toHaveClass(/opacity-50/);
  await page.mouse.up();
});
