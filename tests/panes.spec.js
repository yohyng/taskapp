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

test.describe("枠の幅を変える", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  const handle = (page) => page.locator("[data-pane-handle]").first();
  // つまみは枠と同じ高さ（画面より長い）ので、掴む高さは画面の中に取る
  const drag = async (page, dx) => {
    const h = await handle(page).boundingBox();
    const y = h.y + 200;
    await page.mouse.move(h.x + h.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + dx, y, { steps: 10 });
    await page.mouse.up();
  };

  test("つまみは、枠が2つ以上のときだけ出る", async ({ page }) => {
    await expect(page.locator("[data-pane-handle]")).toHaveCount(0);
    await addPane(page);
    await expect(page.locator("[data-pane-handle]")).toHaveCount(1);
    await addPane(page);
    await expect(page.locator("[data-pane-handle]")).toHaveCount(2);
  });

  test("右に引くと、左の枠が広がる", async ({ page }) => {
    await addPane(page);
    const [before] = await boxes(page);
    await drag(page, 250);
    const [after, right] = await boxes(page);
    expect(after.w).toBeGreaterThan(before.w + 200);
    expect(right.w).toBeLessThan(before.w - 200);
  });

  test("引きすぎても、枠が潰れない", async ({ page }) => {
    await addPane(page);
    await drag(page, -5000);
    const [left] = await boxes(page);
    expect(left.w).toBeGreaterThan(80);
  });

  test("変えた幅は、読み直しても残る", async ({ page }) => {
    await addPane(page);
    await drag(page, 250);
    const [wide] = await boxes(page);

    await page.reload();
    await page.waitForSelector("header");
    const [again] = await boxes(page);
    expect(Math.abs(again.w - wide.w)).toBeLessThan(8);
  });

  test("ダブルクリックで均等に戻る", async ({ page }) => {
    await addPane(page);
    await drag(page, 250);
    await handle(page).dblclick();
    const [a, b] = await boxes(page);
    expect(Math.abs(a.w - b.w)).toBeLessThan(6);
  });
});

test.describe("枠の幅に合わせて中身も変わる", () => {
  test.use({ viewport: { width: 1500, height: 900 } });
  const weekCols = (page) => page.locator("[data-week-cols]").getAttribute("data-week-cols");

  test("広い枠では7日を横一列に並べる", async ({ page }) => {
    expect(await weekCols(page)).toBe("6");
  });

  test("枠を半分にすると、曜日を折り返す", async ({ page }) => {
    await addPane(page);
    // 画面は広いままでも、枠が狭ければ列を減らす
    await expect.poll(() => weekCols(page)).not.toBe("6");
  });

  test("つまみで広げ直すと、また横一列に戻る", async ({ page }) => {
    await addPane(page);
    await expect.poll(() => weekCols(page)).not.toBe("6");

    const h = await page.locator("[data-pane-handle]").first().boundingBox();
    const y = h.y + 200;
    await page.mouse.move(h.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(h.x + 420, y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => weekCols(page)).toBe("6");
  });
});
