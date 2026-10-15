import { test, expect } from "./helpers.js";

const openSettings = (page) =>
  page.locator('button[title="Columns / Category Settings"], button[title*="Settings"]').first().click();
const wake = (page) => page.locator('[data-keep-awake="wake"]');
const pip = (page) => page.locator('[data-keep-awake="pip"]');

// Wake Lock と PiP の有無は機械によって違うので、テストでは作って差し替える。
// addInitScript は関数を文字列にして送るので、外の値は引数で渡す。
const fakeWakeLock = (ok) => window.navigator && Object.defineProperty(navigator, "wakeLock", {
  configurable: true,
  value: { request: async () => {
    if (!ok) throw new Error("denied");
    return { release: async () => {}, addEventListener: () => {} };
  } },
});
// hasWakeLock は "wakeLock" in navigator で見るので、鍵ごと外す
const noWakeLock = () => { delete Navigator.prototype.wakeLock; };
const fakePip = (ok) => {
  Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
  HTMLVideoElement.prototype.play = async function () {};
  HTMLVideoElement.prototype.requestPictureInPicture = ok
    ? async function () { Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: this }); }
    : async function () { throw new Error("denied"); };
  document.exitPictureInPicture = async () => {};
};

// scripts は [関数, 引数] の組
const boot = async (page, ...scripts) => {
  for (const [fn, arg] of scripts) await page.addInitScript(fn, arg);
  await page.reload();
  await page.waitForSelector("header");
  await openSettings(page);
};

test.describe("画面を保たせる設定", () => {
  test("設定の中にあり、上の帯には出ていない", async ({ page }) => {
    await expect(page.locator("header [data-keep-awake]")).toHaveCount(0);
    await boot(page, [fakeWakeLock, true], [fakePip, true]);
    await expect(wake(page)).toContainText("画面を自動でスリープさせない");
    await expect(pip(page)).toContainText("小窓");
  });

  test("小窓は、スリープ防止と別に出せる", async ({ page }) => {
    await boot(page, [fakeWakeLock, true], [fakePip, true]);
    await pip(page).click();
    await expect(pip(page)).toContainText("ON");
    // もう片方は触らない
    await expect(wake(page)).toContainText("OFF");

    await pip(page).click();
    await expect(pip(page)).toContainText("OFF");
  });

  test("スリープ防止だけでも入れられる", async ({ page }) => {
    await boot(page, [fakeWakeLock, true], [fakePip, true]);
    await wake(page).click();
    await expect(wake(page)).toContainText("ON");
    await expect(pip(page)).toContainText("OFF");
  });

  test("小窓しか使えない機械では、小窓だけ出す", async ({ page }) => {
    // wakeLock を持たない機械のふり
    await boot(page, [noWakeLock, null], [fakePip, true]);
    await expect(wake(page)).toHaveCount(0);
    await expect(pip(page)).toBeVisible();
  });

  test("出せなかったときは、できなかったと出す", async ({ page }) => {
    await boot(page, [fakeWakeLock, false], [fakePip, false]);
    await wake(page).click();
    await expect(wake(page)).toContainText("できなかった");
    await pip(page).click();
    await expect(pip(page)).toContainText("できなかった");
  });
});
