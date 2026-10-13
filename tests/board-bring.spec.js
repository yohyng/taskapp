import { test, expect, storedTasks, dragTo, centerOf } from "./helpers.js";

// STOCK や TRAY から、ブロック本文へ親子ごと持ってくる。
const BOARD = "board-7days";
const VIEWS = [{ id: "stock", name: "STOCK", color: "#a78bfa" }];

const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: null,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", viewId: "", ...over,
});
const board = (page) => page.locator("[data-board]");
const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);
const withViews = (page) => page.addInitScript(
  ([v]) => localStorage.setItem("taskspace-stock-views", JSON.stringify(v)), [VIEWS]);

// STOCK に親子で寝ているタスク
const PARKED = {
  tasks: [
    t("p", "親の案件", { stock: true, stockViewId: "stock" }),
    t("c1", "子その1", { stock: true, stockViewId: "stock", parentId: "p" }),
    t("c2", "子その2", { stock: true, stockViewId: "stock", parentId: "p" }),
    t("g", "孫", { stock: true, stockViewId: "stock", parentId: "c1" }),
    t("q", "もうひとつの案件", { stock: true, stockViewId: "stock" }),
    t("anchor", "ボードの行", { pageId: BOARD }),
  ],
};

const dropOnBoardRow = async (page, fromId) => {
  const from = page.locator(`[data-task-id="${fromId}"]`).first();
  await from.hover();
  const target = board(page).locator("[data-task-id]").filter({ hasText: "ボードの行" }).first();
  await dragTo(page, await centerOf(from), await centerOf(target));
};

test.describe("ブロック本文へ親子ごと持ってくる", () => {
  test("親を持ってくると、子も孫も一緒に来る", async ({ page, seed }) => {
    await withViews(page);
    await seed(PARKED);
    await dropOnBoardRow(page, "p");

    await expect.poll(async () => (await byTitle(page, "親の案件")).pageId).toBe(BOARD);
    for (const name of ["子その1", "子その2", "孫"]) {
      expect((await byTitle(page, name)).pageId).toBe(BOARD);
    }
  });

  test("親子の繋がりが保たれる", async ({ page, seed }) => {
    await withViews(page);
    await seed(PARKED);
    await dropOnBoardRow(page, "p");
    await expect.poll(async () => (await byTitle(page, "親の案件")).pageId).toBe(BOARD);

    const parent = await byTitle(page, "親の案件");
    expect(parent.parentId).toBeFalsy();               // 親は根になる
    expect((await byTitle(page, "子その1")).parentId).toBe("p");
    expect((await byTitle(page, "孫")).parentId).toBe("c1");
  });

  test("連れてきたものは STOCK から外れる（二重に出ない）", async ({ page, seed }) => {
    await withViews(page);
    await seed(PARKED);
    await dropOnBoardRow(page, "p");
    await expect.poll(async () => (await byTitle(page, "親の案件")).pageId).toBe(BOARD);

    for (const name of ["親の案件", "子その1", "孫"]) {
      expect((await byTitle(page, name)).stock).toBe(false);
    }
    // 画面にも1か所だけ
    await expect(page.locator('[data-task-id="c1"]')).toHaveCount(1);
  });

  test("複数まとめて選んで持ってくると、それぞれの子も来る", async ({ page, seed }) => {
    await withViews(page);
    await seed(PARKED);

    // 2件を選ぶ
    await page.locator('[data-task-id="p"]').first().click();
    await page.locator('[data-task-id="q"]').first().click({ modifiers: ["ControlOrMeta"] });
    await dropOnBoardRow(page, "p");

    await expect.poll(async () => (await byTitle(page, "もうひとつの案件")).pageId).toBe(BOARD);
    for (const name of ["親の案件", "子その1", "子その2", "孫"]) {
      expect((await byTitle(page, name)).pageId).toBe(BOARD);
    }
    expect((await byTitle(page, "孫")).parentId).toBe("c1");
  });

  test("段組みの列に落とすと、一族ごとその列に入る", async ({ page, seed }) => {
    await withViews(page);
    await seed({
      tasks: [
        ...PARKED.tasks.filter((x) => x.id !== "anchor"),
        t("anchor", "列のブロック", { pageId: BOARD, rowKey: "r1", col: 2 }),
      ],
    });
    const from = page.locator('[data-task-id="p"]').first();
    await from.hover();
    const target = board(page).locator("[data-task-id]").filter({ hasText: "列のブロック" }).first();
    await dragTo(page, await centerOf(from), await centerOf(target));

    await expect.poll(async () => (await byTitle(page, "親の案件")).rowKey).toBe("r1");
    expect((await byTitle(page, "親の案件")).col).toBe(2);
  });
});
