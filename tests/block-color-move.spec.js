import { test, expect, storedTasks, storedTask, dragTo, centerOf, todayKey } from "./helpers.js";

const BOARD = "board-7days";
const toPages = (page) => page.locator('button[title="ページ表示"]').click();
const row = (page, title) => page.locator("[data-task-id]").filter({ hasText: title }).first();
const openMenu = async (page, title) => {
  await row(page, title).hover();
  await row(page, title).locator('span[title="ドラッグで移動／クリックでメニュー"]').click();
};

const b = (id, title, over) => ({
  id, title, category: "", project: "", blockType: "text", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: null,
  rowKey: null, col: 0, colWidth: null, ...over,
});

test.describe("見出しの色を選ぶ", () => {
  test("⠿ のメニューに色の見本が並び、押すと見出しに色がつく", async ({ page, seed }) => {
    await seed({ tasks: [b("h", "みだし", { pageId: "page-1", blockType: "heading2" })] });
    await toPages(page);
    await openMenu(page, "みだし");

    await expect(row(page, "みだし").getByTitle("色: 青")).toBeVisible();
    await row(page, "みだし").getByTitle("色: 青").click();

    await expect.poll(async () => (await storedTask(page, "h")).style?.color).toBe("#60a5fa");
    const color = await row(page, "みだし").evaluate((r) =>
      getComputedStyle(r.querySelector('div[style*="font-size"]')).color);
    expect(color).toBe("rgb(96, 165, 250)");
  });

  test("選んでいる色に印がつき、既定に戻せる", async ({ page, seed }) => {
    await seed({ tasks: [b("h", "みだし", { pageId: "page-1", blockType: "heading2", style: { color: "#60a5fa" } })] });
    await toPages(page);
    await openMenu(page, "みだし");

    await expect(row(page, "みだし").getByTitle("色: 青")).toHaveClass(/border-white\/70/);
    await row(page, "みだし").getByTitle("色: 既定").click();
    await expect.poll(async () => (await storedTask(page, "h")).style?.color).toBeFalsy();
  });
});

test.describe("7days と下のブロックを行き来する", () => {
  test("7days のタスクを下のブロックに落とすと、本文に移る", async ({ page, seed }) => {
    await seed({ tasks: [b("d", "きょうの用事", { scheduledDate: todayKey() })] });

    const grip = row(page, "きょうの用事").locator('span[title="ドラッグで移動／クリックでメニュー"]');
    await row(page, "きょうの用事").hover();
    const zone = page.getByText("ここは自由。クリックして書き始める", { exact: false });
    await dragTo(page, await centerOf(grip), await centerOf(zone));

    await expect.poll(async () => (await storedTask(page, "d")).pageId).toBe(BOARD);
    // 日付が残ると 7days にも出て二重に見えるので、外れていること
    expect((await storedTask(page, "d")).scheduledDate).toBe("");
  });

  test("下のブロックを曜日に落とすと、7days に戻る", async ({ page, seed }) => {
    await seed({
      tasks: [
        b("x", "ほかの用事", { scheduledDate: todayKey() }),
        b("p", "本文のブロック", { pageId: BOARD, rowKey: "r1", col: 1, colWidth: 2 }),
      ],
    });

    const grip = row(page, "本文のブロック").locator('span[title="ドラッグで移動／クリックでメニュー"]');
    await row(page, "本文のブロック").hover();
    const day = page.locator('div[class*="min-h-[420px]"]').first();
    await dragTo(page, await centerOf(grip), await centerOf(day));

    const moved = await storedTask(page, "p");
    expect(moved.scheduledDate).toBeTruthy();
    // 本文の持ち物が残っていると、ブロック側にも出たままになる
    expect(moved.pageId).toBeFalsy();
    expect(moved.rowKey).toBeFalsy();
    expect(moved.col).toBe(0);
  });

  test("本文のブロックの上に落とすと、その列に入る", async ({ page, seed }) => {
    await seed({
      tasks: [
        b("d", "きょうの用事", { scheduledDate: todayKey() }),
        b("p", "列のブロック", { pageId: BOARD, rowKey: "r1", col: 2 }),
      ],
    });

    const grip = row(page, "きょうの用事").locator('span[title="ドラッグで移動／クリックでメニュー"]');
    await row(page, "きょうの用事").hover();
    await dragTo(page, await centerOf(grip), await centerOf(row(page, "列のブロック")));

    await expect.poll(async () => (await storedTask(page, "d")).pageId).toBe(BOARD);
    const moved = await storedTask(page, "d");
    expect(moved.rowKey).toBe("r1");
    expect(moved.col).toBe(2);
    expect(moved.scheduledDate).toBe("");
  });

  test("同じ本文の中で動かすだけなら、何も外れない", async ({ page, seed }) => {
    await seed({
      tasks: [
        b("x", "ほかの用事", { scheduledDate: todayKey() }),
        b("a", "ひとつめ", { pageId: BOARD }),
        b("c", "ふたつめ", { pageId: BOARD }),
      ],
    });
    const grip = row(page, "ふたつめ").locator('span[title="ドラッグで移動／クリックでメニュー"]');
    await row(page, "ふたつめ").hover();
    await dragTo(page, await centerOf(grip), await centerOf(row(page, "ひとつめ")));

    const all = await storedTasks(page);
    expect(all.filter((t) => t.pageId === BOARD)).toHaveLength(2);
  });
});
