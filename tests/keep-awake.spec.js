import { test, expect } from "./helpers.js";

const openSettings = (page) =>
  page.locator('button[title="Columns / Category Settings"], button[title*="Settings"]').first().click();
const toggle = (page) => page.locator("[data-keep-awake]");

test.describe("画面を自動でスリープさせない", () => {
  test("設定の中にあり、上の帯には出ていない", async ({ page }) => {
    await expect(page.locator("header [data-keep-awake]")).toHaveCount(0);
    await openSettings(page);
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toContainText("画面を自動でスリープさせない");
    await expect(toggle(page)).toContainText("OFF");
  });

  test("押すと ON になり、もう一度押すと OFF に戻る", async ({ page }) => {
    // Wake Lock のふりをする（実機の許可待ちに左右されないように）
    await page.addInitScript(() => {
      const listeners = [];
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: { request: async () => ({ release: async () => {}, addEventListener: (_, f) => listeners.push(f) }) },
      });
    });
    await page.reload();
    await page.waitForSelector("header");

    await openSettings(page);
    await toggle(page).click();
    await expect(toggle(page)).toContainText("ON");

    await toggle(page).click();
    await expect(toggle(page)).toContainText("OFF");
  });

  test("取れなかったときは、できなかったと出す", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: { request: async () => { throw new Error("denied"); } },
      });
      // PiP も使えない機械のふり
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: false });
      HTMLVideoElement.prototype.webkitSetPresentationMode = undefined;
    });
    await page.reload();
    await page.waitForSelector("header");

    await openSettings(page);
    await toggle(page).click();
    await expect(toggle(page)).toContainText("できなかった");
  });
});
