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
  const column = page.locator("[data-row-key] [data-col-index]").filter({ hasText: title }).first();
  await column.hover();
  const grip = column.locator("[data-pj-grab]").first();
  const from = await grip.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up();
};

test.beforeEach(async ({ seed }) => {
  await seed({ tasks: [pj("c1", "ALPHA", 0), pj("c2", "BETA", 1), pj("c3", "GAMMA", 2)] });
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
