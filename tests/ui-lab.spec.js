import { test, expect } from "@playwright/test";

// 試し場そのものが動くか。ここで触って、入れるかを決める。
test.beforeEach(async ({ page }) => {
  await page.goto("/ui-lab.html");
  await expect(page.getByRole("heading", { name: "UI の試し場" })).toBeVisible();
});

test("Sonner：知らせが出て、重ねられる", async ({ page }) => {
  await page.locator("[data-lab-toast]").click();
  await expect(page.getByText("メモに書きとめました")).toBeVisible();
  await page.locator("[data-lab-toast-undo]").click();
  await expect(page.getByRole("button", { name: "取り消す" })).toBeVisible();
});

test("Vaul：下からシートが出て、閉じられる", async ({ page }) => {
  await page.locator("[data-lab-sheet]").click();
  const panel = page.locator("[data-lab-sheet-panel]");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox(), screen = page.viewportSize();
  // 画面の下に貼り付いている（下へはみ出す余白を持つので、底より下まで伸びる）
  expect(box.y).toBeGreaterThan(screen.height / 2);
  expect(box.y + box.height).toBeGreaterThanOrEqual(screen.height - 1);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("cmdk：打ち込むと絞り込まれ、選ぶと閉じる", async ({ page }) => {
  await page.locator("[data-lab-palette]").click();
  await expect(page.locator("[data-lab-palette-panel]")).toBeVisible();
  await page.keyboard.type("てがき");
  await page.keyboard.type("");
  await page.locator("[data-lab-palette-panel] input").fill("手書き");
  await expect(page.getByText("手書きを開く")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-lab-palette-panel]")).toHaveCount(0);
});

test("NumberFlow：数が変わる", async ({ page }) => {
  // 桁ごとに 0〜9 を並べて送るので、見えている数は各桁の「いまの数字」を繋いで読む
  const value = () => page.locator("number-flow-react").evaluate((el) =>
    [...el.shadowRoot.querySelectorAll('[part~="integer-digit"]')]
      .map((digit) => digit.style.getPropertyValue("--current").trim()).join(""));
  await expect.poll(value).toBe("12");
  await page.locator("[data-lab-number-up]").click();
  await expect.poll(value).toBe("19");
});

test("本番の画面には混ざっていない", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("header");
  // 試し場の部品は、本体のどこにも出ない
  await expect(page.locator("[data-lab-toast]")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toaster]")).toHaveCount(0);
});
