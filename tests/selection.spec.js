import { test, expect, block, dayBlock, storedTask, centerOf } from "./helpers.js";

test.describe("選択", () => {
  test("クリックで選択、Escで解除", async ({ page }) => {
    await block(page, "a-solo").click();
    await expect(page.getByText(/件選択中/)).toBeVisible();
    // クリックだけでは編集に入らない
    await expect(page.locator("textarea")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByText(/件選択中/)).toHaveCount(0);
  });

  test("タイトルのダブルクリックで編集に入る", async ({ page }) => {
    await block(page, "a-solo").locator("div.cursor-pointer").first().dblclick();
    await expect(page.locator("textarea")).toHaveCount(1);
    await expect(page.locator("textarea")).toHaveValue("単独タスク");
  });

  test("余白からのドラッグで範囲選択できる", async ({ page }) => {
    const box = await page.evaluate(() => {
      const els = [...document.querySelectorAll("[data-daytask]")].slice(0, 3);
      const rs = els.map((e) => e.getBoundingClientRect());
      return {
        left: Math.min(...rs.map((r) => r.left)),
        right: Math.max(...rs.map((r) => r.right)),
        top: Math.min(...rs.map((r) => r.top)),
        bottom: Math.max(...rs.map((r) => r.bottom)),
      };
    });

    await page.mouse.move(Math.max(box.left - 14, 4), box.top - 10);
    await page.mouse.down();
    await page.mouse.move(box.right + 12, box.bottom + 6, { steps: 12 });

    // ドラッグ中は矩形が出て、ブラウザ標準の文字選択は起きない
    await expect(page.locator(".border-sky-400\\/70")).toHaveCount(1);
    expect(await page.evaluate(() => window.getSelection().toString())).toBe("");

    await page.mouse.up();
    await expect(page.locator(".border-sky-400\\/70")).toHaveCount(0);
    await expect(page.getByText("3件選択中")).toBeVisible();
  });

  test("カードの上から始めたドラッグは範囲選択にならない（移動が生きる）", async ({ page }) => {
    const from = await centerOf(dayBlock(page, "d-1"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 90, from.y + 90, { steps: 8 });
    await expect(page.locator(".border-sky-400\\/70")).toHaveCount(0);
    await page.mouse.up();
  });

  test("選択したタスクに色と太さを設定できる", async ({ page }) => {
    await block(page, "a-solo").click();
    await page.locator('button[title="太字"]').click();
    await page.locator('button[title="青"]').click();

    await expect
      .poll(async () => (await storedTask(page, "a-solo")).style)
      .toEqual({ bold: true, color: "#60a5fa" });

    const style = await block(page, "a-solo").locator("div[style]").first().getAttribute("style");
    expect(style).toContain("font-weight: 700");
    expect(style).toContain("rgb(96, 165, 250)");
  });
});
