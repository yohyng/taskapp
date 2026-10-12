import { test, expect, storedTasks, todayKey, dragTo, centerOf } from "./helpers.js";

// 7days と下のブロックを繋ぐ「日付ブロック」。
// 中身は 7days と同じ実体なので、どちらで触っても同じところが変わる。
const BOARD = "board-7days";

const t = (id, title, over = {}) => ({
  // 7days に出るタスクは ToDo（チェックを持つ種別）が既定
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: null,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
const dayBlockFor = (id, date, over = {}) =>
  t(id, "", { pageId: BOARD, blockType: "day", dayDate: date, ...over });

const board = (page) => page.locator("[data-board]");
const dayBlocks = async (page) => (await storedTasks(page)).filter((x) => x.blockType === "day");
const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);

test.describe("日付ブロック", () => {
  test("その日の予定が中に出る", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("a", "きょうの用事", { scheduledDate: todayKey() }),
        t("b", "よていなし"),
        dayBlockFor("day1", todayKey()),
      ],
    });
    const inBoard = board(page);
    await expect(inBoard.getByText("きょうの用事").first()).toBeVisible();
    await expect(inBoard.getByText("よていなし")).toHaveCount(0);
  });

  test("別の日のブロックには出ない", async ({ page, seed }) => {
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return todayKey(d); })();
    await seed({
      tasks: [t("a", "きょうの用事", { scheduledDate: todayKey() }), dayBlockFor("day1", tomorrow)],
    });
    await expect(board(page).getByText("きょうの用事")).toHaveCount(0);
  });

  test("ブロックの中で足すと、7days にも出る", async ({ page, seed }) => {
    await seed({ tasks: [dayBlockFor("day1", todayKey())] });
    const add = board(page).getByPlaceholder("追加…").first();
    await add.fill("ブロックから足した");
    await add.press("Enter");

    await expect.poll(async () => (await byTitle(page, "ブロックから足した"))?.scheduledDate).toBe(todayKey());
    // 7days 側にも同じものが出る（同じ実体なので2か所に見える）
    await expect(page.locator("[data-task-id]").filter({ hasText: "ブロックから足した" })).not.toHaveCount(0);
  });

  test("7days で完了にすると、ブロック側も完了になる", async ({ page, seed }) => {
    await seed({
      tasks: [t("a", "りょうほうに出る", { scheduledDate: todayKey() }), dayBlockFor("day1", todayKey())],
    });
    const rows = page.locator('[data-daytask][data-task-id="a"]');
    await expect(rows).toHaveCount(2); // 7days と日付ブロックの2か所

    await rows.first().getByLabel("完了にする").click();
    await expect.poll(async () => (await byTitle(page, "りょうほうに出る")).status).toBe("完了");
    // 同じ実体なので、もう一方も完了の見た目になる
    const deco = await rows.nth(1).evaluate((r) => {
      const ds = [...r.querySelectorAll("div")].filter((d) => d.textContent.trim() === "りょうほうに出る");
      return ds.length ? getComputedStyle(ds[ds.length - 1]).textDecorationLine : "none";
    });
    expect(deco).toMatch(/line-through/);
  });

  test("見ている日を前後に動かせる", async ({ page, seed }) => {
    await seed({ tasks: [dayBlockFor("day1", todayKey())] });
    await board(page).getByTitle("次の日").first().click();

    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return todayKey(d); })();
    await expect.poll(async () => (await dayBlocks(page))[0].dayDate).toBe(tomorrow);

    await board(page).getByTitle("今日にする").first().click();
    await expect.poll(async () => (await dayBlocks(page))[0].dayDate).toBe(todayKey());
  });

  test("TRAY から日付ブロックに落とすと、その日の予定になる", async ({ page, seed }) => {
    await seed({ tasks: [t("x", "よていなし"), dayBlockFor("day1", todayKey())] });

    const from = page.locator('[data-task-id="x"]').first();
    await from.hover();
    const target = board(page).getByText(todayKey().slice(5).replace("-", "/")).first();
    await dragTo(page, await centerOf(from), await centerOf(target));

    await expect.poll(async () => (await byTitle(page, "よていなし")).scheduledDate).toBe(todayKey());
  });
});

test.describe("ボードの名前と一週間", () => {
  test("名前をつけると覚えている", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "なにか")] });
    const name = page.getByLabel("この場所の名前");
    await expect(name).toHaveValue("ボード");
    await name.fill("デスク");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("taskspace-board-name"))).toBe("デスク");
  });

  test("「+ 一週間」で月〜日が横一列に並ぶ", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "なにか")] });
    await page.getByRole("button", { name: "+ 一週間" }).click();

    await expect.poll(async () => (await dayBlocks(page)).length).toBe(7);
    const made = await dayBlocks(page);
    expect(new Set(made.map((x) => x.rowKey)).size).toBe(1);        // ひとつの行
    expect(made.map((x) => x.col)).toEqual([0, 1, 2, 3, 4, 5, 6]);  // 左から順に
    expect(new Set(made.map((x) => x.dayDate)).size).toBe(7);       // 7日ぶん別々
  });
});

test.describe("スラッシュからの呼び出し", () => {
  test("/よてい で日付ブロックになり、既定は今日", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "もと", { pageId: "board-7days", blockType: "text" })] });
    const row = page.locator("[data-board] [data-task-id]").filter({ hasText: "もと" }).first();
    await row.locator("div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /よてい");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await dayBlocks(page)).length).toBe(1);
    await expect(board(page).getByText("TODAY")).toBeVisible();
  });

  test("/日付 は「日付を外す」のまま（名前がぶつからない）", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "きょうの用事", { scheduledDate: todayKey() })] });
    const row = page.locator('[data-daytask][data-task-id="a"]').first();
    await row.locator("div.cursor-pointer").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /日付");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await byTitle(page, "きょうの用事")).scheduledDate).toBe("");
  });
});
