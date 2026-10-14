import { test, expect, storedTasks } from "./helpers.js";

// 列は独立した持ち物。中身を消しても列は残り、
// 消せるのは列自身のメニューからだけ。
const BOARD = "board-7days";
const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
const colHead = (id, title, col) => t(id, title, { blockType: "column", rowKey: "r1", col });
const boardTasks = async (page) => (await storedTasks(page)).filter((x) => x.pageId === BOARD);
const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);
const row = (page, s) => page.locator("[data-board] [data-task-id]").filter({ hasText: s }).first();
const openMenu = async (page, s) => {
  await row(page, s).hover();
  await row(page, s).locator('span[data-block-grip]').click();
};

test.describe("列は独立した持ち物", () => {
  test("「+ 列」で作れて、すぐ名前を書ける", async ({ page, seed }) => {
    await seed({ tasks: [] });
    await page.getByRole("button", { name: "+ 列" }).click();

    await expect(page.locator("textarea")).toHaveCount(1);
    await page.keyboard.type("NOMLAB");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await byTitle(page, "NOMLAB"))?.blockType).toBe("column");
    expect((await byTitle(page, "NOMLAB")).rowKey).toBeTruthy();
  });

  test("押すたびに右へ増える", async ({ page, seed }) => {
    await seed({ tasks: [] });
    for (const name of ["A", "B"]) {
      await page.getByRole("button", { name: "+ 列" }).click();
      await page.keyboard.type(name);
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await byTitle(page, name))?.title).toBe(name);
    }
    expect((await byTitle(page, "A")).col).toBe(0);
    expect((await byTitle(page, "B")).col).toBe(1);
    expect((await byTitle(page, "A")).rowKey).toBe((await byTitle(page, "B")).rowKey);
  });

  test("中身を消しても、列は残る", async ({ page, seed }) => {
    await seed({
      tasks: [colHead("c1", "NOMLAB", 0), t("k", "中の行", { rowKey: "r1", col: 0 })],
    });
    // 中の行を消す
    await row(page, "中の行").locator("div.cursor-text").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");

    await expect.poll(async () => (await byTitle(page, "中の行"))).toBeUndefined();
    // 列の頭は残っている
    expect((await byTitle(page, "NOMLAB")).blockType).toBe("column");
  });

  test("列の頭は、空にしても消えない", async ({ page, seed }) => {
    await seed({ tasks: [colHead("c1", "NOMLAB", 0)] });

    await row(page, "NOMLAB").locator("div.cursor-text").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");

    await expect.poll(async () =>
      (await boardTasks(page)).filter((x) => x.blockType === "column").length).toBe(1);
  });

  test("消せるのは、列のメニューから", async ({ page, seed }) => {
    await seed({
      tasks: [colHead("c1", "NOMLAB", 0), t("k", "中の行", { rowKey: "r1", col: 0 })],
    });
    await openMenu(page, "NOMLAB");
    await expect(page.locator("[data-block-menu]").getByText("この列を消す", { exact: false })).toBeVisible();
    await page.locator("[data-block-menu]").getByText("この列を消す", { exact: false }).click();

    // 列は消え、中身は残って縦に戻る
    await expect.poll(async () => (await byTitle(page, "NOMLAB"))).toBeUndefined();
    const kid = await byTitle(page, "中の行");
    expect(kid).toBeTruthy();
    expect(kid.rowKey).toBeFalsy();
  });

  test("ふつうの行のメニューには「この列を消す」が出ない", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "ふつうの行")] });
    await openMenu(page, "ふつうの行");
    await expect(page.locator("[data-block-menu]").getByText("この列を消す", { exact: false })).toHaveCount(0);
  });
});

test.describe("列の見出しの字を変える", () => {
  // 題名そのものを測る。親の入れ物を拾うと別の値になる。
  const sizeOf = (page, s) => row(page, s).locator(".ts-block-text").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: parseFloat(cs.fontSize), weight: cs.fontWeight };
  });

  test("大きくできて、保存される", async ({ page, seed }) => {
    await seed({ tasks: [colHead("c1", "NOMLAB", 0)] });
    const before = await sizeOf(page, "NOMLAB");

    await openMenu(page, "NOMLAB");
    await page.locator("[data-block-menu]").getByTitle("大きく").click();

    await expect.poll(async () => (await byTitle(page, "NOMLAB")).style?.size).toBeTruthy();
    const after = await sizeOf(page, "NOMLAB");
    expect(after.size).toBeGreaterThan(before.size);
  });

  test("小さくもできる", async ({ page, seed }) => {
    await seed({ tasks: [colHead("c1", "NOMLAB", 0)] });
    const before = await sizeOf(page, "NOMLAB");

    await openMenu(page, "NOMLAB");
    await page.locator("[data-block-menu]").getByTitle("小さく").click();

    await expect.poll(async () => (await sizeOf(page, "NOMLAB")).size).toBeLessThan(before.size);
  });

  test("太さを選べる", async ({ page, seed }) => {
    await seed({ tasks: [colHead("c1", "NOMLAB", 0)] });

    await openMenu(page, "NOMLAB");
    await page.locator("[data-block-menu]").getByTitle("太さ：ほそ").click();

    await expect.poll(async () => (await byTitle(page, "NOMLAB")).style?.weight).toBe(400);
    expect((await sizeOf(page, "NOMLAB")).weight).toBe("400");
  });

  test("「戻す」で既定に返る", async ({ page, seed }) => {
    await seed({
      tasks: [{ ...colHead("c1", "NOMLAB", 0), style: { size: 28, weight: 400 } }],
    });
    const changed = await sizeOf(page, "NOMLAB");
    expect(changed.size).toBe(28);

    await openMenu(page, "NOMLAB");
    await page.locator("[data-block-menu]").getByTitle("字の設定を戻す").click();

    await expect.poll(async () => (await byTitle(page, "NOMLAB")).style?.size).toBeFalsy();
    // 種別の既定（列は太め）に戻る
    await expect.poll(async () => (await sizeOf(page, "NOMLAB")).weight).toBe("700");
  });

  test("ふつうの行でも字を変えられる", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "ふつうの行")] });
    await openMenu(page, "ふつうの行");
    await page.locator("[data-block-menu]").getByTitle("大きく").click();
    await expect.poll(async () => (await byTitle(page, "ふつうの行")).style?.size).toBeTruthy();
  });
});

test.describe("列の設定が保存される", () => {
  test("名前・位置・幅・枠・字が、開き直しても残る", async ({ page, seed }) => {
    await seed({
      tasks: [
        { ...colHead("c1", "NOMLAB", 0), colWidth: 2.5, style: { size: 18, weight: 400, color: "#f87171" } },
        t("k", "中の行", { rowKey: "r1", col: 0 }),
        colHead("c2", "NOMURA", 1),
      ],
    });

    // フィクスチャは読み直すたびに種を蒔き直すので、新しいタブで
    // 「保存されたものだけ」を見る
    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("[data-board]");

    const head = await byTitle(page, "NOMLAB");
    expect(head.blockType).toBe("column");
    expect(head.col).toBe(0);
    expect(head.colWidth).toBe(2.5);
    expect(head.style).toEqual({ size: 18, weight: 400, color: "#f87171" });
    expect((await byTitle(page, "NOMURA")).col).toBe(1);

    // 画面でも、幅と字がそのまま出ている
    const title = fresh.locator("[data-board] [data-task-id]").filter({ hasText: "NOMLAB" })
      .first().locator(".ts-block-text").first();
    const css = await title.evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: parseFloat(s.fontSize), weight: s.fontWeight, color: s.color };
    });
    expect(css.size).toBe(18);
    expect(css.weight).toBe("400");
    expect(css.color).toBe("rgb(248, 113, 113)");

    const w = async (name) => (await fresh.locator("[data-board] [data-task-id]")
      .filter({ hasText: name }).first().locator("xpath=..").boundingBox()).width;
    expect(await w("NOMLAB")).toBeGreaterThan((await w("NOMURA")) * 2);
    await fresh.close();
  });

  test("作ってから変えた設定も、そのまま残る", async ({ page, seed }) => {
    await seed({ tasks: [] });
    await page.getByRole("button", { name: "+ 列" }).click();
    await page.keyboard.type("あたらしい列");
    await page.keyboard.press("Escape");

    await openMenu(page, "あたらしい列");
    await page.locator("[data-block-menu]").getByTitle("大きく").click();
    await page.locator("[data-block-menu]").getByTitle("太さ：ほそ").click();
    await expect.poll(async () => (await byTitle(page, "あたらしい列")).style?.weight).toBe(400);

    const saved = await byTitle(page, "あたらしい列");
    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("[data-board]");

    const again = await byTitle(page, "あたらしい列");
    expect(again.blockType).toBe("column");
    expect(again.style?.size).toBe(saved.style.size);
    expect(again.style?.weight).toBe(400);
    expect(again.rowKey).toBeTruthy();
    await fresh.close();
  });
});
