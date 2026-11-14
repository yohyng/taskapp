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

test.describe("紙は下へ伸びる（iOS のメモのように）", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.addInitScript(() => localStorage.setItem("taskspace-sketch-paper-v1", JSON.stringify({ width: 600, height: 400 })));
    await page.goto("/sketch.html");
    await page.waitForSelector("[data-sketch-canvas]");
  });

  const paperHeight = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-sketch-paper-v1")).height);

  test("下の端まで描くと、書いている途中で紙が足される", async ({ page }) => {
    const before = await paperHeight(page);
    const box = await page.locator("[data-sketch-canvas]").boundingBox();
    // 上から下の端へ向かって引く
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 24; i += 1) {
      await page.mouse.move(box.x + box.width * 0.3 + i * 4, box.y + box.height * (0.5 + 0.48 * (i / 24)));
    }
    // 離す前に、もう紙が伸びている
    await expect.poll(() => paperHeight(page)).toBeGreaterThan(before);
    await page.mouse.up();
  });

  test("伸びても、描いた線は同じ場所に残る", async ({ page }) => {
    const box = await page.locator("[data-sketch-canvas]").boundingBox();
    const startY = box.y + box.height * 0.5;
    await page.mouse.move(box.x + 60, startY);
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) await page.mouse.move(box.x + 60 + i * 6, startY + i * (box.height * 0.45 / 20));
    await page.mouse.up();

    const stroke = await page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-quick-sketch-v1"))[0]);
    // 線は「書き始めの紙の高さ」で覚える。伸びたあとも、その中に収まっている。
    expect(stroke.height).toBeGreaterThan(0);
    expect(Math.max(...stroke.points.map((p) => p[1]))).toBeLessThanOrEqual(1);
    // 画面でも、線が紙の中ほどから下へ伸びている（上端に貼り付いていない）
    const ink = await page.locator("[data-sketch-canvas]").evaluate((el) => {
      const { data, width, height } = el.getContext("2d").getImageData(0, 0, el.width, el.height);
      let top = -1, bottom = -1;
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          if (data[(y * width + x) * 4] < 150) { if (top < 0) top = y; bottom = y; break; }
        }
      }
      return { top: top / height, bottom: bottom / height };
    });
    expect(ink.top).toBeGreaterThan(0.2);
    expect(ink.bottom).toBeGreaterThan(ink.top);
  });

  test("長い紙でも、持てる大きさに収める", async ({ page }) => {
    // 読み込みのたびに入れ直す（前の指定を上書きする）
    await page.addInitScript(() => localStorage.setItem("taskspace-sketch-paper-v1", JSON.stringify({ width: 600, height: 4000 })));
    await page.reload();
    await page.waitForSelector("[data-sketch-canvas]");
    const size = await page.locator("[data-sketch-canvas]").evaluate((el) => ({ w: el.width, h: el.height }));
    expect(size.w * size.h).toBeLessThanOrEqual(12_000_000 * 1.05);
    expect(size.h).toBeGreaterThan(size.w);
  });
});

test("スクロールでは紙を伸ばさない（伸びるのは書いたときだけ）", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.addInitScript(() => localStorage.setItem("taskspace-sketch-paper-v1", JSON.stringify({ width: 600, height: 900 })));
  await page.goto("/sketch.html");
  await page.waitForSelector("[data-sketch-canvas]");
  const height = () => page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-sketch-paper-v1")).height);
  const before = await height();
  const viewport = page.locator("[data-sketch-viewport]");
  await viewport.hover();
  for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);
  expect(await height()).toBe(before);
});
