import { test, expect } from "./helpers.js";

// 並びが入れ替わっても、列の見出しは「列ブロック」であること。
// Supabase は並び順を持っていないので、読み直すと配列の順は変わりうる。
const BOARD = "board-7days";
const b = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: "r1", col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});

// 列の枠の中で、いちばん上に描かれている文字
const headText = (page, colIndex) => page.evaluate((ci) => {
  const frames = [...document.querySelectorAll("[data-block-area] .rounded-lg.border")];
  const frame = frames[ci];
  return frame?.firstElementChild?.textContent?.trim() || null;
}, colIndex);

test.describe("列の見出し", () => {
  test("列ブロックが先頭になくても、見出しの帯になる", async ({ page, seed }) => {
    await seed({
      tasks: [
        // 読み直しで順番が崩れ、中身が列ブロックより前に来てしまった状態
        b("x1", "中身がさきに来た", { col: 0 }),
        b("head", "NOMLAB", { col: 0, blockType: "column" }),
        b("x2", "もうひとつ", { col: 0 }),
        b("h2", "NOMURA", { col: 1, blockType: "column" }),
        b("y1", "むこうの中身", { col: 1 }),
      ],
    });
    await expect.poll(() => headText(page, 0)).toBe("NOMLAB");
    expect(await headText(page, 1)).toBe("NOMURA");
  });

  test("見出しの下の並びは、もとのまま保たれる", async ({ page, seed }) => {
    await seed({
      tasks: [
        b("x1", "いちばん", { col: 0 }),
        b("head", "NOMLAB", { col: 0, blockType: "column" }),
        b("x2", "にばん", { col: 0 }),
      ],
    });
    await expect.poll(() => headText(page, 0)).toBe("NOMLAB");
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("[data-block-area] [data-task-id]")]
        .map((e) => e.getAttribute("data-task-id")));
    expect(order).toEqual(["head", "x1", "x2"]);
  });
});

test.describe("列は動かさない", () => {
  const cols = {
    tasks: [
      b("h0", "ひだりの列", { col: 0, blockType: "column" }),
      b("a", "ひだりの中身", { col: 0 }),
      b("h1", "みぎの列", { col: 1, blockType: "column" }),
    ],
  };
  const stored = async (page) => (await (await import("./helpers.js")).storedTasks(page));
  const row = (page, title) => page.locator("[data-task-id]").filter({ hasText: title }).first();

  test("列の頭はドラッグで掴めない", async ({ page, seed }) => {
    await seed(cols);
    const head = row(page, "ひだりの列");
    await expect(head).toBeVisible();
    // 掴めるブロックには dnd-kit が触り口を付ける。列の頭には付かない。
    expect(await head.getAttribute("role")).toBeNull();
    const content = row(page, "ひだりの中身");
    expect(await content.getAttribute("role")).toBe("button");
  });

  test("⠿ はメニュー専用になる", async ({ page, seed }) => {
    await seed(cols);
    const head = row(page, "ひだりの列");
    await head.hover();
    const grip = head.locator("span[data-block-grip]");
    await expect(grip).toBeVisible();
    await expect(grip).toHaveAttribute("title", "クリックでメニュー（列は動かせません）");
    await grip.click();
    await expect(head.getByRole("button", { name: "複製" })).toBeVisible();
  });

  test("列の名前のところで改行しても、列が増えない", async ({ page, seed }) => {
    await seed(cols);
    await row(page, "ひだりの列").locator("div.cursor-text, div.cursor-pointer").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("あたらしい中身");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await stored(page)).filter((t) => t.blockType === "column").length).toBe(2);
    const made = (await stored(page)).find((t) => t.title === "あたらしい中身");
    expect(made.blockType).toBe("text");
    expect(made.col).toBe(0); // 同じ列に入る
  });

  test("空にして改行しても、列のままでいる", async ({ page, seed }) => {
    await seed(cols);
    await row(page, "ひだりの列").locator("div.cursor-text, div.cursor-pointer").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await stored(page)).find((t) => t.id === "h0")?.blockType).toBe("column");
  });
});

test.describe("PJ の箱", () => {
  test("入りきらない PJ は下の段に回る", async ({ page, seed }) => {
    // 細い画面に 4本。横一列には収まらないので折り返す。
    await page.setViewportSize({ width: 760, height: 900 });
    await seed({
      tasks: [0, 1, 2, 3].map((c) => b(`h${c}`, `PJ${c}`, { col: c, blockType: "column" })),
    });
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll("[data-col-index]")]
        .map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops.length).toBe(4);
    expect(new Set(tops).size).toBeGreaterThan(1); // 一列に並びきっていない
  });

  test("広い画面なら横一列のまま", async ({ page, seed }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await seed({
      tasks: [0, 1, 2, 3].map((c) => b(`h${c}`, `PJ${c}`, { col: c, blockType: "column" })),
    });
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll("[data-col-index]")]
        .map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  });

  test("帯のつまみをドラッグすると、PJ ごと入れ替わる", async ({ page, seed }) => {
    const { storedTasks, dragTo, centerOf } = await import("./helpers.js");
    await page.setViewportSize({ width: 1400, height: 900 });
    await seed({
      tasks: [
        b("h0", "ひだりPJ", { col: 0, blockType: "column" }),
        b("a", "ひだりの中身", { col: 0 }),
        b("h1", "みぎPJ", { col: 1, blockType: "column" }),
      ],
    });
    const first = page.locator('[data-col-index="0"]');
    await first.hover();
    const grab = first.locator("[data-pj-grab]").first();
    await dragTo(page, await centerOf(grab), await centerOf(page.locator('[data-col-index="1"]')));

    await expect.poll(async () =>
      (await storedTasks(page)).find((t) => t.id === "h0")?.col).toBe(1);
    const all = await storedTasks(page);
    expect(all.find((t) => t.id === "h1").col).toBe(0);
    expect(all.find((t) => t.id === "a").col).toBe(1); // 中身も一緒に動く
  });
});
