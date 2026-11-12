import { test, expect } from "@playwright/test";

// 計測ページそのものが、ちゃんと数を取れているか。
// 実機の遅れを見るための道具なので、道具が黙って壊れていると気づけない。

const draw = async (page, { steps = 20, from = { x: 120, y: 160 }, step = 8 } = {}) => {
  const canvas = page.locator("[data-diag-canvas]");
  const box = await canvas.boundingBox();
  const x = box.x + from.x, y = box.y + from.y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + i * step, y + Math.sin(i / 3) * 20, { steps: 2 });
  await page.mouse.up();
};

test.beforeEach(async ({ page }) => {
  await page.goto("/ink-diag.html");
  await expect(page.locator("[data-diag-canvas]")).toBeVisible();
});

test("記録をはじめて、とめると結果が出る", async ({ page }) => {
  await page.locator("[data-diag-toggle]").click();
  await expect(page.locator("[data-diag-toggle]")).toHaveText("記録をとめる");
  await draw(page);
  await page.locator("[data-diag-toggle]").click();
  await expect(page.locator("[data-diag-toggle]")).toHaveText("記録をはじめる");
  // 入力の間隔と、1回の描き直しの時間が入っている
  const cards = page.locator("text=まだ記録がありません");
  expect(await cards.count()).toBeLessThan(6);
});

test("結果の JSON に、座標も本文も入っていない", async ({ page }) => {
  await page.locator("[data-diag-toggle]").click();
  await draw(page);
  await page.locator("[data-diag-toggle]").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-diag-download]").click(),
  ]);
  const stream = await download.createReadStream();
  const text = await new Promise((done) => {
    let out = ""; stream.on("data", (c) => { out += c; }); stream.on("end", () => done(out));
  });
  const got = JSON.parse(text);
  expect(got.pointermove.count).toBeGreaterThan(0);
  expect(got.frame.count).toBeGreaterThan(0);
  expect(got.device.userAgent).toContain("Mozilla");
  // 線そのものは持ち出さない
  expect(text).not.toContain("points\":[[");
  expect(JSON.stringify(got.strokes)).not.toContain("color");
});

test("保存をしない設定では、確定の時間を測らない", async ({ page }) => {
  await page.locator("[data-diag-toggle]").click();
  await draw(page);
  await page.locator("[data-diag-toggle]").click();
  await page.locator("[data-diag-download]").click().catch(() => {});
  const text = await page.evaluate(() => localStorage.getItem("taskspace-quick-sketch-v1"));
  expect(text, "保存しない設定では下書きに書かない").toBeNull();
});

test("保存を本番と同じにすると、確定の時間が出る", async ({ page }) => {
  await page.locator("[data-diag-save]").selectOption("draft");
  await page.locator("[data-diag-toggle]").click();
  await draw(page);
  await page.locator("[data-diag-toggle]").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-diag-download]").click(),
  ]);
  const stream = await download.createReadStream();
  const text = await new Promise((done) => {
    let out = ""; stream.on("data", (c) => { out += c; }); stream.on("end", () => done(out));
  });
  const got = JSON.parse(text);
  expect(got.save.stringify.count).toBeGreaterThan(0);
  expect(got.save.localStorage.count).toBeGreaterThan(0);
  expect(got.save.react.count).toBeGreaterThan(0);
});

test("描かない設定でも、入力の数は取れる", async ({ page }) => {
  await page.locator("[data-diag-draw]").selectOption("none");
  await page.locator("[data-diag-toggle]").click();
  await draw(page);
  await page.locator("[data-diag-toggle]").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-diag-download]").click(),
  ]);
  const stream = await download.createReadStream();
  const text = await new Promise((done) => {
    let out = ""; stream.on("data", (c) => { out += c; }); stream.on("end", () => done(out));
  });
  const got = JSON.parse(text);
  expect(got.pointermove.count).toBeGreaterThan(0);
  expect(got.paint.count ?? 0).toBe(0);
});

test.describe("止まりの計測（本番と同じ画面で）", () => {
  test("?probe=1 のときだけ小窓が出る", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("header");
    await expect(page.locator("[data-stall-probe]")).toHaveCount(0);
    await page.goto("/?probe=1");
    await page.waitForSelector("header");
    await expect(page.locator("[data-stall-probe]")).toBeVisible();
  });

  test("記録をとめると、結果が出て写せる", async ({ page }) => {
    await page.goto("/?probe=1");
    await page.waitForSelector("header");
    await page.locator("[data-probe-toggle]").click();
    await expect(page.locator("[data-probe-toggle]")).toHaveText("とめる");
    // わざと止める（この仕掛けが、止まりを拾えることの確認）
    await page.evaluate(() => { const end = performance.now() + 220; while (performance.now() < end) { /* 塞ぐ */ } });
    await page.waitForTimeout(300);
    await page.locator("[data-probe-toggle]").click();
    const report = page.locator("[data-probe-report]");
    await expect(report).toBeVisible();
    await expect(report).toContainText("50ms超のフレーム");
    await expect(page.locator("[data-probe-copy]")).toBeEnabled();
  });
});
