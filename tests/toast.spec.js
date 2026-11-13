import { test, expect } from "./helpers.js";

// 知らせ（トースト）は Sonner に任せている。
// 重ねて出せること・押して閉じられること・勝手に消えることを押さえる。

test("メモを足すと、知らせが出る", async ({ page }) => {
  await page.locator("[data-quick-add]").click();
  await page.locator("[data-quick-add-dialog] textarea").fill("知らせの試し");
  await page.locator("[data-add-memo]").click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "書きとめました" })).toBeVisible();
});

test("続けて出すと、重なって残る", async ({ page }) => {
  for (const title of ["ひとつめ", "ふたつめ"]) {
    await page.locator("[data-quick-add]").click();
    await page.locator("[data-quick-add-dialog] textarea").fill(title);
    await page.locator("[data-add-memo]").click();
    // 追加しても窓は開いたまま。外側を押して閉じる。
    await page.locator("[data-quick-add-dialog]").click({ position: { x: 5, y: 5 } });
    await expect(page.locator("[data-quick-add-dialog]")).toHaveCount(0);
  }
  // 前のが消されず、2つ並ぶ
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(2);
});

test("押せば閉じられる", async ({ page }) => {
  await page.locator("[data-quick-add]").click();
  await page.locator("[data-quick-add-dialog] textarea").fill("閉じる試し");
  await page.locator("[data-add-memo]").click();
  const shown = page.locator("[data-sonner-toast]").first();
  await expect(shown).toBeVisible();
  await shown.hover();
  await shown.locator("[data-close-button]").click();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
});
