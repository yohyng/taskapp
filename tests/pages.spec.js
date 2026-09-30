import { test, expect, storedTasks } from "./helpers.js";

const toPages = (page) => page.locator('button[title="ページ表示"]').click();
const body = (page) => page.locator("input[placeholder='無題']").locator("xpath=ancestor::div[2]");
const pageTitle = (page) => page.locator("input[placeholder='無題']");
const emptyArea = (page) => page.getByText("クリックして書き始める", { exact: false });

test.describe("ページ", () => {
  test("開くと既定のページが1つある", async ({ page }) => {
    await toPages(page);
    await expect(pageTitle(page)).toHaveValue("はじめてのページ");
    await expect(emptyArea(page)).toBeVisible();
  });

  test("タイトルを変えると一覧にも反映される", async ({ page }) => {
    await toPages(page);
    await pageTitle(page).fill("設計メモ");
    await expect(page.locator("aside").getByText("設計メモ")).toBeVisible();
    // 端末に残る
    await expect
      .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-pages"))[0].title))
      .toBe("設計メモ");
  });

  test("空き領域のクリックでブロックが増え、書ける", async ({ page }) => {
    await toPages(page);
    const before = (await storedTasks(page)).length;

    await emptyArea(page).click();
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);

    const created = (await storedTasks(page)).find((t) => t.pageId);
    expect(created).toBeTruthy();
  });

  test("ページのブロックは TRAY に出ない", async ({ page }) => {
    await toPages(page);
    await emptyArea(page).click();
    await expect.poll(async () => (await storedTasks(page)).filter((t) => t.pageId).length).toBe(1);

    const pageBlockId = (await storedTasks(page)).find((t) => t.pageId).id;
    await page.locator('button[title="リスト表示に戻す"]').click();
    // TRAY には種データのぶんだけ出ていて、ページのブロックは混ざらない
    await expect(page.locator(`[data-task-id="${pageBlockId}"]`)).toHaveCount(0);
    await expect(page.locator('[data-task-id="tray-1"]')).toBeVisible();
  });

  test("本文でもコマンドとブロック種別が使える", async ({ page }) => {
    await toPages(page);
    await emptyArea(page).click();
    await expect(page.locator("textarea")).toHaveCount(1);

    const id = await page.evaluate(() =>
      document.querySelector("textarea").closest("[data-task-id]").getAttribute("data-task-id"));
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("# ");

    await expect
      .poll(async () => (await storedTasks(page)).find((t) => t.id === id).blockType)
      .toBe("heading1");
  });

  test("ページを増やすと本文が切り替わる", async ({ page }) => {
    await toPages(page);
    await emptyArea(page).click();
    await expect.poll(async () => (await storedTasks(page)).filter((t) => t.pageId).length).toBe(1);
    const firstPageId = (await storedTasks(page)).find((t) => t.pageId).pageId;

    await page.getByRole("button", { name: "新規ページ" }).click();
    await expect(pageTitle(page)).toHaveValue("無題のページ");
    // 新しいページは空
    await expect(emptyArea(page)).toBeVisible();

    // 元のページに戻すと中身が残っている
    await page.locator("aside button").first().click();
    await expect
      .poll(async () => (await storedTasks(page)).filter((t) => t.pageId === firstPageId).length)
      .toBe(1);
  });

  test("ページを消すと中のブロックも消える", async ({ page }) => {
    await toPages(page);
    await emptyArea(page).click();
    await expect.poll(async () => (await storedTasks(page)).filter((t) => t.pageId).length).toBe(1);

    await page.getByRole("button", { name: "新規ページ" }).click();
    await page.locator("aside > div").first().hover();
    await page.locator('aside button[title="このページを削除（中身も消えます）"]').first().click();

    await expect.poll(async () => (await storedTasks(page)).filter((t) => t.pageId).length).toBe(0);
    await expect.poll(async () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-pages")).length)).toBe(1);
  });
});
