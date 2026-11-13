import { test, expect } from "./helpers.js";

// 手書きは別ページ。アプリ本体（タスク・アウトライン・同期）を載せない。
// 実機で画面を止めていたのは、同じタブで動いていたアウトラインの
// 読み直しと書き戻しだった。載せなければ、止まりようがない。

const draw = async (page) => {
  const canvas = page.locator("[data-sketch-canvas]");
  const r = await canvas.boundingBox();
  await page.mouse.move(r.x + r.width * 0.2, r.y + 50);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.7, r.y + 120, { steps: 12 });
  await page.mouse.up();
};

test("ヘッダーの sketch は、手書きだけのページへ移る", async ({ page }) => {
  await page.locator("[data-header-sketch]").click();
  await page.waitForURL(/sketch\.html$/);
  await expect(page.locator("[data-sketch-board]")).toBeVisible();
  // 本体のものは何も載っていない
  await expect(page.locator("[data-app-root]")).toHaveCount(0);
  await expect(page.locator("[data-outliner]")).toHaveCount(0);
  await expect(page.locator("[data-task-id]")).toHaveCount(0);
  await expect(page.locator("[data-panes]")).toHaveCount(0);
});

test("ページを移っても、下書きはそのまま残る", async ({ page }) => {
  await page.locator("[data-header-sketch]").click();
  await page.waitForURL(/sketch\.html$/);
  await draw(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-quick-sketch-v1") || "[]").length)).toBe(1);
  await page.locator("[data-sketch-close]").click();
  await page.waitForSelector("header");
  await page.locator("[data-header-sketch]").click();
  await page.waitForURL(/sketch\.html$/);
  await expect(page.locator("[data-sketch-undo]")).toBeEnabled();
});

test("置き場が無ければ、下書きを残したまま知らせる", async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem("taskspace-drive-url"));
  await page.locator("[data-header-sketch]").click();
  await page.waitForURL(/sketch\.html$/);
  await draw(page);
  await page.locator("[data-sketch-save]").click();
  await expect(page.locator("[data-sketch-status]")).toContainText("画像の置き場");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-quick-sketch-v1") || "[]").length)).toBe(1);
});

test("アプリを開くまで預かり、開いたら木へ入れて預かりを空にする", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("taskspace-memo-queue-v1", JSON.stringify([
    { id: "q1", image: "https://drive.example/one.png", text: "", date: "2026-11-13", at: "2026-11-13T00:00:00.000Z" },
    { id: "q2", image: "https://drive.example/two.png", text: "", date: "2026-11-13", at: "2026-11-13T00:01:00.000Z" },
  ])));
  await page.reload();
  await page.waitForSelector("header");
  await expect.poll(() => page.evaluate(() => (localStorage.getItem("taskspace-outline-v1") || "").split("drive.example").length - 1)).toBe(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("taskspace-memo-queue-v1"))).toBeNull();
});

test("壊れた預かりは捨てずに無視する", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("taskspace-memo-queue-v1", "こわれています"));
  await page.reload();
  await page.waitForSelector("header");
  await expect(page.locator("[data-app-root]")).toBeVisible();
});

test("手書きから戻ったとき、黄色い帯が一瞬出ない", async ({ page }) => {
  await page.locator("[data-header-sketch]").click();
  await page.waitForURL(/sketch\.html$/);
  // 戻る途中から、帯が出ないかを見張る
  const seen = [];
  const watch = setInterval(async () => {
    try { seen.push(await page.locator("[data-outline-owner]").count()); } catch { /* 移動中 */ }
  }, 60);
  await page.locator("[data-sketch-close]").click();
  await page.waitForSelector("header");
  await page.waitForTimeout(900);
  clearInterval(watch);
  expect(Math.max(0, ...seen), "鍵を取るまでの一瞬で札を出さない").toBe(0);
  await expect(page.locator("[data-outline-owner]")).toHaveCount(0);
});
