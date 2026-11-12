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

test.describe("手書き中は、アウトラインの重い仕事を持ち越す", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // 端末への書き戻しが、いつ起きたかを数える
      window.__idbPuts = 0;
      const open = indexedDB.open;
      indexedDB.open = function patched(...args) {
        const request = open.apply(this, args);
        request.addEventListener("success", () => {
          const db = request.result;
          const transaction = db.transaction;
          db.transaction = function patchedTx(...txArgs) {
            const tx = transaction.apply(this, txArgs);
            const store = tx.objectStore;
            tx.objectStore = function patchedStore(...storeArgs) {
              const object = store.apply(this, storeArgs);
              const put = object.put;
              object.put = function patchedPut(...putArgs) { window.__idbPuts += 1; return put.apply(this, putArgs); };
              return object;
            };
            return tx;
          };
        });
        return request;
      };
      localStorage.setItem("taskspace-outline-v1", JSON.stringify([{ id: "a", text: "ひとつ", children: [] }]));
    });
    await page.goto("/");
    await page.waitForSelector("header");
  });

  test("手書きを開いている間は書き戻さない", async ({ page }) => {
    await page.locator("[data-pane-mode]").first().selectOption("outline");
    await page.waitForSelector("[data-outliner]");
    await page.locator("[data-header-sketch]").click();
    await page.waitForSelector("[data-sketch-canvas]");
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => window.__idbPuts);

    const box = await page.locator("[data-sketch-canvas]").boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(box.x + 40 + i * 6, box.y + 40 + Math.sin(i / 4) * 10);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.__idbPuts), "書いている間は書き戻さない").toBe(before);
  });

  test("閉じれば、また書き戻すようになる", async ({ page }) => {
    await page.locator("[data-pane-mode]").first().selectOption("outline");
    await page.waitForSelector("[data-outliner]");
    await page.locator("[data-header-sketch]").click();
    await page.waitForSelector("[data-sketch-canvas]");
    await page.locator("[data-sketch-close]").click();
    await expect(page.locator("[data-sketch-canvas]")).toHaveCount(0);
    const before = await page.evaluate(() => window.__idbPuts);
    // 閉じたあとのアウトラインの書き換えは、これまで通り端末へ残る
    await page.locator("[data-row] [data-row-text]").first().click();
    await page.keyboard.type("あ");
    await page.keyboard.press("Escape");
    await expect.poll(async () => page.evaluate(() => window.__idbPuts), { timeout: 8000 }).toBeGreaterThan(before);
  });
});
