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

test.describe("ペンの色と太さ", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sketch.html");
    await page.waitForSelector("[data-sketch-canvas]");
  });

  test("見本から色を選べて、最近つかった色が残る", async ({ page }) => {
    await page.locator("[data-sketch-palette]").click();
    await expect(page.locator("[data-sketch-palette-panel]")).toBeVisible();
    await page.locator('[data-sketch-swatch="#7c3aed"]').click();
    // 選んだら閉じる
    await expect(page.locator("[data-sketch-palette-panel]")).toHaveCount(0);
    // 描くと、その色で残る
    const r = await page.locator("[data-sketch-canvas]").boundingBox();
    await page.mouse.move(r.x + 40, r.y + 40);
    await page.mouse.down();
    await page.mouse.move(r.x + 200, r.y + 90, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-quick-sketch-v1") || "[]")[0]?.color)).toBe("#7c3aed");
    // 最近つかった色に入る
    await page.locator("[data-sketch-palette]").click();
    await expect(page.locator('[data-sketch-recent="#7c3aed"]')).toBeVisible();
  });

  test("最近つかった色は、開き直しても残る", async ({ page }) => {
    await page.locator("[data-sketch-palette]").click();
    await page.locator('[data-sketch-swatch="#0891b2"]').click();
    await page.reload();
    await page.waitForSelector("[data-sketch-canvas]");
    await page.locator("[data-sketch-palette]").click();
    await expect(page.locator('[data-sketch-recent="#0891b2"]')).toBeVisible();
  });

  test("太さは、細・中・太をすぐ押せる", async ({ page }) => {
    await page.locator('[data-sketch-width-preset="12"]').click();
    await expect(page.locator('[data-sketch-width-preset="12"]')).toHaveAttribute("aria-pressed", "true");
    const r = await page.locator("[data-sketch-canvas]").boundingBox();
    await page.mouse.move(r.x + 40, r.y + 150);
    await page.mouse.down();
    await page.mouse.move(r.x + 200, r.y + 160, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-quick-sketch-v1") || "[]")[0]?.width)).toBe(12);
  });

  test("紙は端末の細かさで描く（引き伸ばさない）", async ({ page }) => {
    const got = await page.locator("[data-sketch-canvas]").evaluate((el) => ({
      width: el.width, shown: el.getBoundingClientRect().width, dpr: window.devicePixelRatio,
    }));
    // 見えている幅 × 端末の細かさで描いている（引き伸ばさない）
    expect(got.width).toBeGreaterThanOrEqual(got.shown * Math.min(3, Math.max(1, got.dpr)) * 0.95);
  });
});

test("暗い帯の中でも、色の丸と太さの丸が見える", async ({ page }) => {
  await page.goto("/sketch.html");
  await page.waitForSelector("[data-sketch-canvas]");
  // 黒いペンの丸にも、白い縁が付いている（付いていないと帯に溶けて見えない）
  const ring = await page.locator('[data-sketch-palette] span').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { shadow: s.boxShadow, bg: s.backgroundColor };
  });
  expect(ring.shadow).not.toBe("none");
  // 太さの丸は、暗くない色で描く
  const dot = await page.locator('[data-sketch-width-preset="2"] span').evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = dot.match(/\d+/g).map(Number);
  expect((r + g + b) / 3, "太さの丸が暗すぎない").toBeGreaterThan(120);
});
