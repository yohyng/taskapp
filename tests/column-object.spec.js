import { test, expect, storedTasks } from "./helpers.js";

// 列は独立した持ち物。中身を消しても列は残り、
// 消せるのは列自身のメニューからだけ。
const BOARD = "board-7days";
const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
const colHead = (id, title, col) => t(id, title, { blockType: "column", rowKey: "r1", col });
const boardTasks = async (page) => (await storedTasks(page)).filter((x) => x.pageId === BOARD);
const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);
const row = (page, s) => page.locator("[data-board] [data-task-id]").filter({ hasText: s }).first();
const openMenu = async (page, s) => {
  await row(page, s).hover();
  await row(page, s).locator('span[title="ドラッグで移動／クリックでメニュー"]').click();
};

test.describe("列は独立した持ち物", () => {
  test("「+ 列」で作れて、すぐ名前を書ける", async ({ page, seed }) => {
    await seed({ tasks: [] });
    await page.getByRole("button", { name: "+ 列" }).click();

    await expect(page.locator("textarea")).toHaveCount(1);
    await page.keyboard.type("NOMLAB");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await byTitle(page, "NOMLAB"))?.blockType).toBe("column");
    expect((await byTitle(page, "NOMLAB")).rowKey).toBeTruthy();
  });

  test("押すたびに右へ増える", async ({ page, seed }) => {
    await seed({ tasks: [] });
    for (const name of ["A", "B"]) {
      await page.getByRole("button", { name: "+ 列" }).click();
      await page.keyboard.type(name);
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await byTitle(page, name))?.title).toBe(name);
    }
    expect((await byTitle(page, "A")).col).toBe(0);
    expect((await byTitle(page, "B")).col).toBe(1);
    expect((await byTitle(page, "A")).rowKey).toBe((await byTitle(page, "B")).rowKey);
  });

  test("中身を消しても、列は残る", async ({ page, seed }) => {
    await seed({
      tasks: [colHead("c1", "NOMLAB", 0), t("k", "中の行", { rowKey: "r1", col: 0 })],
    });
    // 中の行を消す
    await row(page, "中の行").locator("div.cursor-text").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");

    await expect.poll(async () => (await byTitle(page, "中の行"))).toBeUndefined();
    // 列の頭は残っている
    expect((await byTitle(page, "NOMLAB")).blockType).toBe("column");
  });

  test("列の頭は、空にしても消えない", async ({ page, seed }) => {
    await seed({ tasks: [colHead("c1", "NOMLAB", 0)] });

    await row(page, "NOMLAB").locator("div.cursor-text").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");

    await expect.poll(async () =>
      (await boardTasks(page)).filter((x) => x.blockType === "column").length).toBe(1);
  });

  test("消せるのは、列のメニューから", async ({ page, seed }) => {
    await seed({
      tasks: [colHead("c1", "NOMLAB", 0), t("k", "中の行", { rowKey: "r1", col: 0 })],
    });
    await openMenu(page, "NOMLAB");
    await expect(page.locator("[data-block-menu]").getByText("この列を消す", { exact: false })).toBeVisible();
    await page.locator("[data-block-menu]").getByText("この列を消す", { exact: false }).click();

    // 列は消え、中身は残って縦に戻る
    await expect.poll(async () => (await byTitle(page, "NOMLAB"))).toBeUndefined();
    const kid = await byTitle(page, "中の行");
    expect(kid).toBeTruthy();
    expect(kid.rowKey).toBeFalsy();
  });

  test("ふつうの行のメニューには「この列を消す」が出ない", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "ふつうの行")] });
    await openMenu(page, "ふつうの行");
    await expect(page.locator("[data-block-menu]").getByText("この列を消す", { exact: false })).toHaveCount(0);
  });
});
