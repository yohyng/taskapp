import { test, expect, storedTasks, dragTo, centerOf } from "./helpers.js";

// ボードの縦の列。列そのものはデータ（rowKey / col / 枠）として持ち、
// 作るのは「/列を追加する」。ここでは、持っている列が正しく描かれ、
// 触っても壊れないことを見る。
const BOARD = "board-7days";

const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
// 枠つきの列の頭
const head = (id, title, col, over = {}) =>
  t(id, title, { rowKey: "r1", col, style: { framed: true }, ...over });

const tops = async (page) =>
  (await storedTasks(page)).filter((x) => x.pageId === BOARD && !x.parentId);
const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);
const row = (page, s) => page.locator("[data-board] [data-task-id]").filter({ hasText: s }).first();

// DESIGNART / WORK / 結婚式関連 の3列
const THREE = {
  tasks: [
    head("g1", "DESIGNART", 0),
    t("a1", "バナー出力", { rowKey: "r1", col: 0, parentId: "g1" }),
    t("a2", "DM入稿15日", { rowKey: "r1", col: 0, parentId: "g1" }),
    head("g2", "WORK", 1),
    t("b1", "芝浦工大", { rowKey: "r1", col: 1, parentId: "g2" }),
    head("g3", "結婚式関連", 2),
    t("c1", "会社の結婚のやつ", { rowKey: "r1", col: 2, parentId: "g3" }),
  ],
};

test.describe("列の見え方", () => {
  test("頭の行が横に並び、子はその下に付く", async ({ page, seed }) => {
    await seed(THREE);
    const box = async (s) => (await row(page, s).boundingBox());
    const [d, w, k] = [await box("DESIGNART"), await box("WORK"), await box("バナー出力")];
    expect(Math.abs(d.y - w.y)).toBeLessThan(12);  // 頭の行は横並び
    expect(d.x).toBeLessThan(w.x);
    expect(k.y).toBeGreaterThan(d.y);              // 子は下に
    expect(k.x).toBeLessThan(w.x);                 // 1列目の中
  });

  test("各列が囲みになり、中身がその中に入る", async ({ page, seed }) => {
    await seed(THREE);
    const box = page.locator("[data-board] div.rounded-lg.border").filter({ hasText: "DESIGNART" }).first();
    await expect(box).toContainText("バナー出力");
    await expect(box).toContainText("DM入稿15日");
    await expect(box).not.toContainText("WORK");
  });

  test("列の右上に、中にある数が出る", async ({ page, seed }) => {
    await seed(THREE);
    const counts = await page.locator("[data-board] [data-col-count]").allInnerTexts();
    expect(counts).toEqual(["2", "1", "1"]);
  });

  test("/枠 で、あとから付け外しできる", async ({ page, seed }) => {
    await seed(THREE);
    const framedBox = () =>
      page.locator("[data-board] div.rounded-lg.border").filter({ hasText: "WORK" });

    await row(page, "WORK").locator("div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /枠");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await byTitle(page, "WORK")).style?.framed).toBeFalsy();
    await expect(framedBox()).toHaveCount(0);
  });

  test("日付ブロックには枠が付かない（二重にならない）", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("d1", "", { blockType: "day", dayDate: "2026-10-13", rowKey: "r1", col: 0 }),
        head("g1", "DESIGNART", 1),
      ],
    });
    const day = (await tops(page)).find((x) => x.blockType === "day");
    expect(day.style?.framed).toBeFalsy();
    expect((await byTitle(page, "DESIGNART")).style?.framed).toBe(true);
  });
});

test.describe("列は保存される", () => {
  test("開き直しても、列の分かれ方と枠が残る", async ({ page, seed }) => {
    await seed(THREE);

    // フィクスチャは読み直すたびに種を蒔き直すので、それが走らない
    // 新しいタブを同じブラウザで開いて、保存されたものだけを見る。
    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("[data-board]");

    expect((await byTitle(page, "DESIGNART")).col).toBe(0);
    expect((await byTitle(page, "WORK")).col).toBe(1);
    expect((await byTitle(page, "WORK")).style?.framed).toBe(true);

    const box = async (s) =>
      fresh.locator("[data-board] [data-task-id]").filter({ hasText: s }).first().boundingBox();
    const [d, w] = [await box("DESIGNART"), await box("WORK")];
    expect(Math.abs(d.y - w.y)).toBeLessThan(12);
    expect(d.x).toBeLessThan(w.x);
    await fresh.close();
  });

  test("列の幅も残る", async ({ page, seed }) => {
    await seed({
      tasks: [head("g1", "ひろい", 0, { colWidth: 3 }), head("g2", "せまい", 1)],
    });
    expect((await byTitle(page, "ひろい")).colWidth).toBe(3);
    const w = async (s) => (await row(page, s).locator("xpath=..").boundingBox()).width;
    expect(await w("ひろい")).toBeGreaterThan((await w("せまい")) * 2);
  });
});

test.describe("列を足す", () => {
  test("/列を追加する で、右に空の列ができてすぐ書ける", async ({ page, seed }) => {
    await seed({ tasks: [head("g1", "ひとつめ", 0)] });

    await row(page, "ひとつめ").locator("div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /列を追加する");
    await page.keyboard.press("Enter");

    await expect(page.locator("textarea")).toHaveCount(1);
    await page.keyboard.type("ふたつめ");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await byTitle(page, "ふたつめ"))?.col).toBe(1);
    expect((await byTitle(page, "ふたつめ")).rowKey).toBe("r1");
  });

  test("列を持っていない行からでも、列にできる", async ({ page, seed }) => {
    await seed({ tasks: [t("g1", "さいしょ")] });

    await row(page, "さいしょ").locator("div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /列を追加する");
    await page.keyboard.press("Enter");
    await page.keyboard.type("つぎ");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await byTitle(page, "つぎ"))?.col).toBe(1);
    expect((await byTitle(page, "さいしょ")).col).toBe(0);
    expect((await byTitle(page, "さいしょ")).rowKey).toBeTruthy();
  });
});

test.describe("列に落としても列が壊れない", () => {
  const WITH_OUTSIDER = {
    tasks: [
      head("h", "NOMLAB", 0),
      t("k", "中の行", { rowKey: "r1", col: 0 }),
      t("x", "よそから来る行"),
    ],
  };
  const framedBox = (page) =>
    page.locator("[data-board] div.rounded-lg.border").filter({ hasText: "NOMLAB" });

  test("列に落としても、枠が消えない", async ({ page, seed }) => {
    await seed(WITH_OUTSIDER);
    await expect(framedBox(page)).toHaveCount(1);

    const from = row(page, "よそから来る行");
    await from.hover();
    await dragTo(page, await centerOf(from), await centerOf(row(page, "NOMLAB")));

    await expect.poll(async () => (await byTitle(page, "よそから来る行")).rowKey).toBe("r1");
    await expect(framedBox(page)).toHaveCount(1);
  });

  test("列の頭は見出しのまま、落としたものは下に入る", async ({ page, seed }) => {
    await seed(WITH_OUTSIDER);
    const from = row(page, "よそから来る行");
    await from.hover();
    const box = await row(page, "NOMLAB").boundingBox();
    // 頭の上半分に落としても、頭より上には入らない
    await dragTo(page, await centerOf(from), { x: box.x + box.width / 2, y: box.y + 3 });

    await expect.poll(async () => (await byTitle(page, "よそから来る行")).rowKey).toBe("r1");
    const order = (await tops(page)).filter((b) => b.col === 0).map((b) => b.title);
    expect(order[0]).toBe("NOMLAB");
  });
});
