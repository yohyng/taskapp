import { test, expect, block, dayBlock, storedTask, storedTasks, todayKey } from "./helpers.js";

// 編集中に "/" でコマンドメニューを開く（Notion 風）
async function openSlash(page, id, locate = block) {
  await locate(page, id).locator("div.cursor-pointer").first().dblclick();
  await expect(page.locator("textarea")).toHaveCount(1);
  await page.keyboard.press("End");
  await page.keyboard.type(" /");
}

// メニューは編集中の textarea の直下に出る
const menuPanel = (page) => page.locator("div.absolute.top-full");
const menuItem = (page, text) => menuPanel(page).locator("button", { hasText: text });
const menu = (page) => menuItem(page, "日付を外す");

test.describe("スラッシュコマンド", () => {
  test('"/" でメニューが開き、入力で絞り込める', async ({ page }) => {
    await openSlash(page, "a-solo");
    await expect(menu(page)).toBeVisible();

    await page.keyboard.type("stock");
    await expect(menuItem(page, "STOCK")).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
  });

  test("Escapeで閉じ、通常の編集に戻る", async ({ page }) => {
    await openSlash(page, "a-solo");
    await expect(menu(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(1);
  });

  test("行の途中の / ではなく、空白の直後だけで開く", async ({ page }) => {
    await block(page, "a-solo").locator("div.cursor-pointer").first().dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type("a/b");
    await expect(menu(page)).toHaveCount(0);
  });

  test("今日: 選ぶと今日に配置され、コマンド文字列は残らない", async ({ page }) => {
    await openSlash(page, "b-1");
    await page.keyboard.type("今日");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "b-1")).scheduledDate).toBe(todayKey());
    expect((await storedTask(page, "b-1")).title).toBe("ベータ1");
  });

  test("STOCK: プロジェクトは保ったまま日付が外れる", async ({ page }) => {
    await openSlash(page, "a-solo");
    await page.keyboard.type("stock");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "a-solo")).stock).toBe(true);
    expect(await storedTask(page, "a-solo")).toMatchObject({ project: "ALPHA", scheduledDate: "" });
  });

  test("色: 文字色が付く", async ({ page }) => {
    await openSlash(page, "a-solo");
    await page.keyboard.type("色");
    await menuItem(page, "色: 青").click();

    await expect.poll(async () => (await storedTask(page, "a-solo")).style?.color).toBe("#60a5fa");
  });

  test("削除: ブロックが消える", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await openSlash(page, "b-1");
    await page.keyboard.type("削除");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTasks(page)).length).toBe(before - 1);
    expect(await storedTask(page, "b-1")).toBeNull();
  });

  test("7daysでも使える", async ({ page }) => {
    await openSlash(page, "d-1", dayBlock);
    await page.keyboard.type("日付");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "d-1")).scheduledDate).toBe("");
  });
});
