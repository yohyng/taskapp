import { test, expect, storedTasks, todayKey } from "./helpers.js";

const open = (page) => page.getByRole("button", { name: "タスクを追加" }).click();
const dialog = (page) => page.locator("[data-quick-add-dialog]");
const titled = async (page, t) => (await storedTasks(page)).find((x) => x.title === t);

test.describe("タスク追加のポップアップ", () => {
  test("＋ を押すと、画面の真ん中に大きく出る", async ({ page }) => {
    await open(page);
    await expect(dialog(page)).toBeVisible();
    const box = await dialog(page).locator("textarea").boundingBox();
    expect(box.width).toBeGreaterThan(250);
    // iOS が勝手に拡大しない大きさ
    const size = await dialog(page).locator("textarea").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test("Enter で追加でき、続けて打てる", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await open(page);
    await page.keyboard.type("ひとつめ");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    // 入力は空になり、ポップアップは開いたまま
    await expect(dialog(page).locator("textarea")).toHaveValue("");
    await expect(dialog(page)).toBeVisible();

    await page.keyboard.type("ふたつめ");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 2);
  });

  test("既定では今日に置かれる", async ({ page }) => {
    await open(page);
    await page.keyboard.type("きょうのこと");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await titled(page, "きょうのこと"))?.scheduledDate).toBe(todayKey());
  });

  test("「日付なし」を選ぶと TRAY に入る", async ({ page }) => {
    await open(page);
    await dialog(page).getByRole("button", { name: "日付なし" }).click();
    await dialog(page).locator("textarea").fill("いつかやる");
    await dialog(page).getByRole("button", { name: "追加" }).click();
    await expect.poll(async () => (await titled(page, "いつかやる"))?.scheduledDate).toBe("");
  });

  test("Shift+Enter では追加されない（改行になる）", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await open(page);
    await page.keyboard.type("いちぎょうめ");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("にぎょうめ");
    expect((await storedTasks(page)).length).toBe(before);
    await expect(dialog(page).locator("textarea")).toHaveValue("いちぎょうめ\nにぎょうめ");
  });

  test("Escape と背景クリックで閉じる", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();

    await open(page);
    await dialog(page).click({ position: { x: 5, y: 5 } });
    await expect(dialog(page)).toBeHidden();
  });

  test("空のままでは追加できない", async ({ page }) => {
    await open(page);
    await expect(dialog(page).getByRole("button", { name: "追加" })).toBeDisabled();
  });
});

test.describe("スマホの上の帯", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ボタンが1段に収まり、＋だけ横に広い", async ({ page }) => {
    const add = await page.getByRole("button", { name: "タスクを追加" }).boundingBox();
    const others = await page.locator("header button").evaluateAll((els) =>
      els.filter((e) => !e.hasAttribute("data-quick-add"))
        .map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) }; }));
    // ＋ はほかのボタンより目に見えて広い
    expect(add.width).toBeGreaterThan(Math.max(...others.map((o) => o.w)) * 2);
    // 上下がぴったり揃う（高さ違いで段差に見えない）
    const tops = [...others.map((o) => o.top), Math.round(add.y)];
    const bottoms = [...others.map((o) => o.bottom), Math.round(add.y + add.height)];
    expect(new Set(tops).size).toBe(1);
    expect(new Set(bottoms).size).toBe(1);
  });
});
