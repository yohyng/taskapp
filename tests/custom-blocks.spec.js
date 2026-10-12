import { test, expect, storedTasks } from "./helpers.js";

const toPages = (page) => page.locator('button[title="ページ表示"]').click();
const emptyArea = (page) => page.getByText("クリックして書き始める", { exact: false });
const pageBlocks = async (page) => (await storedTasks(page)).filter((t) => t.pageId);

// 自作のブロック種別をひとつ作る
async function makeType(page, { label = "メモ帳", marker = "", md = "", size = "", color = false } = {}) {
  await toPages(page);
  await page.getByRole("button", { name: "ブロックを作る" }).click();
  // ヘッダーの「タスクを追加」と紛れるのでダイアログ内に限定する
  const dialog = page.locator("div.fixed.inset-0").filter({ hasText: "ブロックを作る" });
  await dialog.getByRole("button", { name: "追加", exact: true }).click();

  const card = dialog.locator("div.rounded-lg.border").filter({ has: page.getByPlaceholder("名前") }).last();
  await card.getByPlaceholder("名前").fill(label);
  if (marker) await card.getByPlaceholder("例: ▸").fill(marker);
  if (md) await card.getByPlaceholder("例: !! ").fill(md);
  if (size) await card.locator("select").first().selectOption(size);
  if (color) await card.locator('button[title="青"]').click();

  await dialog.getByRole("button", { name: "保存" }).click();
}

test.describe("自分で作るブロック種別", () => {
  test("作ると / メニューに並び、適用できる", async ({ page }) => {
    await makeType(page, { label: "メモ帳", marker: "✎" });

    await emptyArea(page).click();
    await page.keyboard.type("なにか /メモ帳");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toMatch(/^custom:/);
    await expect(page.locator("[data-task-id]").first().getByText("✎")).toBeVisible();
  });

  test("決めた記法で変換できる", async ({ page }) => {
    await makeType(page, { label: "強調メモ", md: "!! " });

    await emptyArea(page).click();
    await page.keyboard.type("!! ");

    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toMatch(/^custom:/);
  });

  test("決めた見た目が反映される", async ({ page }) => {
    await makeType(page, { label: "おおきい", size: "20", color: true });

    await emptyArea(page).click();
    // 作っただけでは効かない。/ で種別を当ててから見る。
    await page.keyboard.type("おおきく見える /おおきい");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toMatch(/^custom:/);
    await page.keyboard.press("Escape");

    // 本文の見出し要素（装飾が inline style で当たっている行）を探す
    const css = await page.locator("[data-task-id]").first().evaluate((row) => {
      // textContent 一致だと外側の入れ物を拾うので、装飾が当たっている要素を選ぶ
      const el = row.querySelector('div[style*="font-size"]');
      const s = getComputedStyle(el);
      return { size: s.fontSize, color: s.color };
    });
    expect(css.size).toBe("20px");
    expect(css.color).toBe("rgb(96, 165, 250)");
  });

  test("⠿ のメニューにも並ぶ", async ({ page }) => {
    await makeType(page, { label: "とくべつ" });

    await emptyArea(page).click();
    await page.keyboard.type("ふつう");
    await page.keyboard.press("Escape");

    const row = page.locator("[data-task-id]").first();
    await row.hover();
    await row.locator('span[title="ドラッグで移動／クリックでメニュー"]').click();
    await expect(row.getByRole("button", { name: "とくべつ" })).toBeVisible();
  });

  test("保存されて、消すと組み込みだけに戻る", async ({ page }) => {
    await makeType(page, { label: "けすよてい" });
    await expect
      .poll(async () => page.evaluate(() =>
        JSON.parse(localStorage.getItem("taskspace-custom-block-types") || "[]").length))
      .toBe(1);

    await page.getByRole("button", { name: "ブロックを作る" }).click();
    const dialog = page.locator("div.fixed.inset-0").filter({ hasText: "ブロックを作る" });
    await dialog.locator('button[title="この種別を消す"]').first().click();
    await dialog.getByRole("button", { name: "保存" }).click();

    await expect
      .poll(async () => page.evaluate(() =>
        JSON.parse(localStorage.getItem("taskspace-custom-block-types") || "[]").length))
      .toBe(0);
  });
});
