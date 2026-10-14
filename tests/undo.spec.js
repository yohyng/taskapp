import { test, expect, storedTasks, todayKey } from "./helpers.js";

// Ctrl+Z / Cmd+Z で戻せること。
const BOARD = "board-7days";
const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);
const boardTasks = async (page) => (await storedTasks(page)).filter((x) => x.pageId === BOARD);
const row = (page, s) => page.locator("[data-board] [data-task-id]").filter({ hasText: s }).first();
const undo = async (page) => {
  await page.keyboard.press("Escape");          // 編集から出る
  await page.locator("header").click();          // 文字入力から外す
  await page.keyboard.press("ControlOrMeta+z");
};

test.describe("Ctrl+Z で戻せる", () => {
  test("消したブロックが戻る", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "消される行"), t("b", "のこる行")] });

    await row(page, "消される行").hover();
    await row(page, "消される行").locator('span[data-block-grip]').click();
    await page.locator("[data-block-menu]").getByText("削除", { exact: true }).click();
    await expect.poll(async () => await byTitle(page, "消される行")).toBeUndefined();

    await undo(page);
    await expect.poll(async () => (await byTitle(page, "消される行"))?.title).toBe("消される行");
  });

  test("消した列が戻る", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("c1", "NOMLAB", { blockType: "column", rowKey: "r1", col: 0 }),
        t("k", "中の行", { rowKey: "r1", col: 0 }),
      ],
    });
    await row(page, "NOMLAB").hover();
    await row(page, "NOMLAB").locator('span[data-block-grip]').click();
    await page.locator("[data-block-menu]").getByText("この列を消す", { exact: false }).click();
    await expect.poll(async () => await byTitle(page, "NOMLAB")).toBeUndefined();

    await undo(page);
    await expect.poll(async () => (await byTitle(page, "NOMLAB"))?.blockType).toBe("column");
    expect((await byTitle(page, "中の行")).rowKey).toBe("r1");
  });

  test("字の大きさを変えたのが戻る", async ({ page, seed }) => {
    await seed({ tasks: [t("c1", "NOMLAB", { blockType: "column", rowKey: "r1", col: 0 })] });

    await row(page, "NOMLAB").hover();
    await row(page, "NOMLAB").locator('span[data-block-grip]').click();
    await page.locator("[data-block-menu]").getByTitle("大きく").click();
    await expect.poll(async () => (await byTitle(page, "NOMLAB")).style?.size).toBeTruthy();

    await undo(page);
    await expect.poll(async () => (await byTitle(page, "NOMLAB")).style?.size).toBeFalsy();
  });

  test("足した列が戻る", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "もとの行")] });
    await page.getByRole("button", { name: "＋PJ" }).click();
    await page.keyboard.press("Escape");
    await expect.poll(async () =>
      (await boardTasks(page)).filter((x) => x.blockType === "column").length).toBe(1);

    await undo(page);
    await expect.poll(async () =>
      (await boardTasks(page)).filter((x) => x.blockType === "column").length).toBe(0);
  });

  test("7days に置いたのが戻る", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "予定にする", { pageId: null })] });

    const r = page.locator('[data-task-id="a"]').first();
    await r.locator("div.cursor-text, div.cursor-pointer").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /今日");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await byTitle(page, "予定にする")).scheduledDate).toBe(todayKey());

    await undo(page);
    await expect.poll(async () => (await byTitle(page, "予定にする")).scheduledDate).toBe("");
  });
});
