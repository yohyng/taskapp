import { test, expect, storedTasks, storedTask, dragTo, centerOf } from "./helpers.js";

// STOCK をブロックとして置く。列にすると、STOCK が1本ずつ縦のブロックに分かれる。
const BOARD = "board-7days";
const VIEWS = [
  { id: "stock", name: "STOCK", color: "#a78bfa" },
  { id: "v2", name: "あとで", color: "#34d399" },
];

const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: null,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", viewId: "", ...over,
});
const stockBlockFor = (id, viewId, over = {}) =>
  t(id, "", { pageId: BOARD, blockType: "stock", viewId, ...over });

const board = (page) => page.locator("[data-board]");
const stockBlocks = async (page) => (await storedTasks(page)).filter((x) => x.blockType === "stock");
const withViews = (page) => page.addInitScript(
  ([v]) => localStorage.setItem("taskspace-stock-views", JSON.stringify(v)), [VIEWS]);

test.describe("STOCKブロック", () => {
  test("そのビューの中身だけが出る", async ({ page, seed }) => {
    await withViews(page);
    await seed({
      tasks: [
        t("a", "STOCKのやつ", { stock: true, stockViewId: "stock" }),
        t("b", "あとでのやつ", { stock: true, stockViewId: "v2" }),
        stockBlockFor("sb", "stock"),
      ],
    });
    await expect(board(page).getByText("STOCKのやつ")).toHaveCount(1);
    await expect(board(page).getByText("あとでのやつ")).toHaveCount(0);
  });

  test("「+ STOCK」で、STOCK が1本ずつ縦のブロックに分かれて横に並ぶ", async ({ page, seed }) => {
    await withViews(page);
    await seed({ tasks: [t("a", "なにか")] });
    await page.getByRole("button", { name: "+ STOCK" }).click();

    await expect.poll(async () => (await stockBlocks(page)).length).toBe(2);
    const made = await stockBlocks(page);
    expect(new Set(made.map((x) => x.rowKey)).size).toBe(1);   // ひとつの行
    expect(made.map((x) => x.col)).toEqual([0, 1]);            // 左から順に
    expect(made.map((x) => x.viewId)).toEqual(["stock", "v2"]); // 1本ずつ別のビュー

    // 画面でも横に並ぶ
    const boxes = await board(page).locator("[data-task-id]").evaluateAll(
      (els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y })));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(12);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
  });

  test("見るビューを切り替えられる", async ({ page, seed }) => {
    await withViews(page);
    await seed({
      tasks: [
        t("b", "あとでのやつ", { stock: true, stockViewId: "v2" }),
        stockBlockFor("sb", "stock"),
      ],
    });
    await expect(board(page).getByText("あとでのやつ")).toHaveCount(0);
    await board(page).getByRole("button", { name: "あとで", exact: true }).first().click();
    await expect(board(page).getByText("あとでのやつ")).toHaveCount(1);
  });

  test("落としたタスクが、そのビューの STOCK に入る", async ({ page, seed }) => {
    await withViews(page);
    await seed({ tasks: [t("x", "よていなし"), stockBlockFor("sb", "v2")] });

    const from = page.locator('[data-task-id="x"]').first();
    await from.hover();
    const zone = board(page).getByText("寝かせるタスクをここへ", { exact: false }).first();
    await dragTo(page, await centerOf(from), await centerOf(zone));

    await expect.poll(async () => (await storedTask(page, "x")).stock).toBe(true);
    expect((await storedTask(page, "x")).stockViewId).toBe("v2");
  });

  test("下の STOCK パネルと同じ実体を見ている", async ({ page, seed }) => {
    await withViews(page);
    await seed({
      tasks: [t("a", "りょうほうに出る", { stock: true, stockViewId: "stock" }), stockBlockFor("sb", "stock")],
    });
    // ブロック側とパネル側の2か所に出る
    await expect(page.locator('[data-task-id="a"]')).toHaveCount(2);

    await page.locator('[data-task-id="a"]').first().getByLabel("完了にする").click();
    await expect.poll(async () => (await storedTask(page, "a")).status).toBe("完了");
  });

  test("名前を変えると、パネル側の名前も変わる", async ({ page, seed }) => {
    await withViews(page);
    await seed({ tasks: [stockBlockFor("sb", "stock")] });

    await board(page).getByTitle("クリックで名前を変更").first().click();
    const input = board(page).locator('input:not([aria-label="この場所の名前"])').first();
    await input.fill("あたためる");
    await input.press("Enter");

    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("taskspace-stock-views"))[0].name)).toBe("あたためる");
  });

  test("/STOCK でブロックにできる", async ({ page, seed }) => {
    await withViews(page);
    await seed({ tasks: [t("a", "もと", { pageId: BOARD, blockType: "text" })] });
    const row = board(page).locator("[data-task-id]").filter({ hasText: "もと" }).first();
    await row.locator("div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /すとっく");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await stockBlocks(page)).length).toBe(1);
  });
});
