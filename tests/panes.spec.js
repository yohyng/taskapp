import { test, expect } from "./helpers.js";

// 画面の枠（ペイン）。1つなら全画面、増やすと横に並べて分け合う。
const panes = (page) => page.locator("[data-pane-id]");
const addPane = (page) => page.locator("[data-pane-add]").click();
const modeOf = (page, i) => page.locator("[data-pane-mode]").nth(i);
const boxes = (page) => page.evaluate(() =>
  [...document.querySelectorAll("[data-pane-id]")].map((e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), top: Math.round(r.top) };
  }));

test.describe("枠を増やして分ける", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test("はじめは1つで、全部の幅を使う", async ({ page }) => {
    await expect(panes(page)).toHaveCount(1);
    const [only] = await boxes(page);
    const width = await page.evaluate(() => document.querySelector("[data-panes]").clientWidth);
    expect(only.w).toBe(width);
  });

  test("2つにすると、横に並んで半分ずつになる", async ({ page }) => {
    await addPane(page);
    await expect(panes(page)).toHaveCount(2);
    const [a, b] = await boxes(page);
    expect(a.top).toBe(b.top);              // 横並び
    expect(Math.abs(a.w - b.w)).toBeLessThan(4); // 半分ずつ
    expect(b.x).toBeGreaterThan(a.x);
  });

  test("3つなら3分割", async ({ page }) => {
    await addPane(page);
    await addPane(page);
    const got = await boxes(page);
    expect(got).toHaveLength(3);
    expect(new Set(got.map((g) => g.top)).size).toBe(1);
    const widths = got.map((g) => g.w);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(4);
  });

  test("増やしすぎない", async ({ page }) => {
    for (let i = 0; i < 6; i++) await page.locator("[data-pane-add]").click({ force: true });
    await expect(panes(page)).toHaveCount(4);
    await expect(page.locator("[data-pane-add]")).toBeDisabled();
  });

  test("閉じると元に戻る。1つのときは閉じる口が出ない", async ({ page }) => {
    await expect(page.locator("[data-pane-close]")).toHaveCount(0);
    await addPane(page);
    await page.locator("[data-pane-close]").first().click();
    await expect(panes(page)).toHaveCount(1);
  });
});

test.describe("枠の中身を選ぶ", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test("2つめはアウトラインで開く", async ({ page }) => {
    await addPane(page);
    await expect(page.locator('[data-pane="outline"]')).toHaveCount(1);
    await expect(page.locator('[data-pane="tasks"]')).toHaveCount(1);
    await expect(page.locator("[data-outliner]")).toBeVisible();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("枠ごとに切り替えられる", async ({ page }) => {
    await addPane(page);
    await modeOf(page, 1).selectOption("tasks");
    // タスクは1枠だけ。2枚目は案内を出す。
    await expect(page.locator("[data-pane-dup]")).toBeVisible();

    await modeOf(page, 1).selectOption("outline");
    await expect(page.locator("[data-pane-dup]")).toHaveCount(0);
    await expect(page.locator("[data-outliner]")).toBeVisible();
  });

  test("1つの枠をアウトラインにすれば、全画面で使える", async ({ page }) => {
    await modeOf(page, 0).selectOption("outline");
    await expect(page.locator("[data-outliner]")).toBeVisible();
    await expect(page.locator("[data-task-id]")).toHaveCount(0);
  });

  test("枠の数と中身は、読み直しても残る", async ({ page }) => {
    await addPane(page);
    await modeOf(page, 0).selectOption("outline");
    await page.reload();
    await page.waitForSelector("header");
    await expect(panes(page)).toHaveCount(2);
    await expect(modeOf(page, 0)).toHaveValue("outline");
    await expect(modeOf(page, 1)).toHaveValue("outline");
  });

  test("2つのアウトラインは、同じ中身を見ている", async ({ page }) => {
    await modeOf(page, 0).selectOption("outline");
    await addPane(page);
    await expect(page.locator("[data-outliner]")).toHaveCount(2);

    const left = page.locator("[data-outliner]").first();
    await left.locator("[data-outline-add]").click();
    await page.keyboard.type("両方に出る");
    await page.keyboard.press("Escape");

    await expect(page.locator("[data-outliner]").nth(1).getByText("両方に出る")).toBeVisible();
  });

  test("枠ごとに、別のところへズームできる", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "あ", children: [{ id: "a1", text: "あの子" }] },
      { id: "b", text: "い", children: [{ id: "b1", text: "いの子" }] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await modeOf(page, 0).selectOption("outline");
    await addPane(page);

    await page.locator("[data-outliner]").first().locator('[data-zoom="a"]').click();
    await page.locator("[data-outliner]").nth(1).locator('[data-zoom="b"]').click();

    await expect(page.locator("[data-outliner]").first().locator("[data-zoom-title]")).toHaveValue("あ");
    await expect(page.locator("[data-outliner]").nth(1).locator("[data-zoom-title]")).toHaveValue("い");
  });
});

test.describe("狭い画面", () => {
  test.use({ viewport: { width: 420, height: 900 } });

  test("横に割らず、縦に積む", async ({ page }) => {
    await page.locator("[data-pane-add]").click();
    const got = await boxes(page);
    expect(got).toHaveLength(2);
    expect(got[1].top).toBeGreaterThan(got[0].top); // 縦に積む
    expect(got[0].x).toBe(got[1].x);
  });
});
