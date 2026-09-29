import { test, expect, block, storedTask, storedTasks, todayKey } from "./helpers.js";

const menuPanel = (page) => page.locator("div.absolute.top-full");
const menuItem = (page, text) => menuPanel(page).locator("button", { hasText: text });

async function slashOnBlock(page, id, query) {
  await block(page, id).locator("div.cursor-pointer").first().dblclick();
  await expect(page.locator("textarea")).toHaveCount(1);
  await page.keyboard.press("End");
  await page.keyboard.type(" /" + query);
}

test.describe("ブロック種別", () => {
  test("見出しにすると、チェックボックスが消えて強調される", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "見出し");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("heading");
    // クラス名ではなく実際の描画結果で見る
    const weight = await block(page, "a-solo")
      .locator("div[style]").first()
      .evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(weight)).toBeGreaterThanOrEqual(700);
    // 完了トグルは持たない
    await expect(block(page, "a-solo").locator("svg.lucide-circle")).toHaveCount(0);
  });

  test("区切り線にすると本文がなくなり、線だけになる", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "区切り");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("divider");
    const row = block(page, "a-solo");
    await expect(row.locator("span.h-px")).toBeVisible();
    await expect(row.getByText("単独タスク")).toHaveCount(0);
    // 行としては残るので選択できる
    await row.click();
    await expect(page.getByText(/件選択中/)).toBeVisible();
  });

  test("コールアウトは目印つきの枠になる", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "コールアウト");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("callout");
    await expect(block(page, "a-solo").getByText("💡")).toBeVisible();
  });

  test("タスクに戻せる", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "見出し");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("heading");

    await slashOnBlock(page, "a-solo", "タスクに戻す");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("task");
  });
});

test.describe("追加欄のスラッシュ", () => {
  test("追加欄で / を打つとメニューが出る", async ({ page }) => {
    await page.getByPlaceholder("このProjectに追加").first().click();
    await page.keyboard.type("/");
    await expect(menuItem(page, "見出し")).toBeVisible();
  });

  test("文字を書いてからコマンドを選ぶと、その文字でタスクが作られる", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await page.getByPlaceholder("このProjectに追加").first().click();
    await page.keyboard.type("あたらしい見出し /見出し");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    const created = (await storedTasks(page)).find((t) => t.title === "あたらしい見出し");
    expect(created).toMatchObject({ blockType: "heading" });
  });

  test("7daysの追加欄でも使える", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await page.getByPlaceholder("追加…").first().click();
    await page.keyboard.type("きょうやる /今日");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    const created = (await storedTasks(page)).find((t) => t.title === "きょうやる");
    expect(created.scheduledDate).toBe(todayKey());
  });
});
