import { test, expect, storedTasks } from "./helpers.js";

// ボードの中身を、頭の行とその子で1列ずつに分ける。
// 画像でいう DESIGNART / WORK / 結婚式関連 の分かれ方。
const BOARD = "board-7days";

const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", viewId: "", ...over,
});

const THREE = {
  tasks: [
    t("g1", "DESIGNART"),
    t("a1", "バナー出力", { parentId: "g1" }),
    t("a2", "DM入稿15日", { parentId: "g1" }),
    t("g2", "WORK"),
    t("b1", "芝浦工大", { parentId: "g2" }),
    t("g3", "結婚式関連"),
    t("c1", "会社の結婚のやつ", { parentId: "g3" }),
  ],
};
const tops = async (page) =>
  (await storedTasks(page)).filter((x) => x.pageId === BOARD && !x.parentId);
const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);

test.describe("ボードを列に分ける", () => {
  test("頭の行ごとに1列ずつになる", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();

    await expect.poll(async () => (await byTitle(page, "DESIGNART")).col).toBe(0);
    expect((await byTitle(page, "WORK")).col).toBe(1);
    expect((await byTitle(page, "結婚式関連")).col).toBe(2);

    const all = await tops(page);
    expect(new Set(all.map((x) => x.rowKey)).size).toBe(1); // ひとつの行にまとまる
  });

  test("子はその列の中に残る（列に散らばらない）", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).col).toBe(1);

    // 子は親の下にぶら下がったまま＝列を持たない
    const kid = await byTitle(page, "芝浦工大");
    expect(kid.parentId).toBe("g2");
    expect(kid.rowKey).toBeFalsy();
  });

  test("画面でも横に並び、子は頭の行の下に付く", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).col).toBe(1);

    const box = async (s) =>
      page.locator("[data-board] [data-task-id]").filter({ hasText: s }).first().boundingBox();
    const [d, w, k] = [await box("DESIGNART"), await box("WORK"), await box("バナー出力")];
    expect(Math.abs(d.y - w.y)).toBeLessThan(12);  // 頭の行は横並び
    expect(d.x).toBeLessThan(w.x);
    expect(k.y).toBeGreaterThan(d.y);              // 子は下に
    expect(k.x).toBeLessThan(w.x);                 // 1列目の中
  });

  test("空行は新しい列を起こさず、直前の列の末尾に残る", async ({ page, seed }) => {
    await seed({ tasks: [...THREE.tasks, t("e1", "")] });
    await page.getByRole("button", { name: "並べ直す" }).click();

    await expect.poll(async () => (await byTitle(page, "結婚式関連")).col).toBe(2);
    const empty = (await tops(page)).find((x) => !x.title);
    expect(empty.col).toBe(2); // 3列目のまま（4列目を作らない）
  });

  test("縦列をやめると1本に戻る", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).col).toBe(1);

    await page.getByRole("button", { name: "縦列" }).click();   // 縦列をやめる
    await expect.poll(async () => (await tops(page)).every((x) => !x.rowKey)).toBe(true);
  });

  test("1つしかなくても、1列として並ぶ", async ({ page, seed }) => {
    await seed({ tasks: [t("g1", "ひとつだけ"), t("e1", "")] });
    await page.getByRole("button", { name: "並べ直す" }).click();

    await expect.poll(async () => (await byTitle(page, "ひとつだけ")).col).toBe(0);
    expect((await byTitle(page, "ひとつだけ")).rowKey).toBeTruthy();
  });

  test("日付や STOCK のブロックも1列として数える", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("d1", "", { blockType: "day", dayDate: "2026-10-13" }),
        t("g1", "DESIGNART"),
        t("a1", "バナー出力", { parentId: "g1" }),
      ],
    });
    await page.getByRole("button", { name: "並べ直す" }).click();

    await expect.poll(async () => (await byTitle(page, "DESIGNART")).col).toBe(1);
    const day = (await tops(page)).find((x) => x.blockType === "day");
    expect(day.col).toBe(0); // 題名が空でも、中身のあるブロックとして数える
  });
});

test.describe("列の枠（STOCKビューのような囲み）", () => {
  const framedBox = (page, head) =>
    page.locator("[data-board] div.rounded-lg.border").filter({ hasText: head });

  test("分けると、各列が囲みになる", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).col).toBe(1);

    // 先頭の行に「枠つき」の印が付く
    for (const name of ["DESIGNART", "WORK", "結婚式関連"]) {
      expect((await byTitle(page, name)).style?.framed).toBe(true);
    }
    // 子の行には付かない（囲みは列ごとに1つ）
    expect((await byTitle(page, "バナー出力")).style?.framed).toBeFalsy();
  });

  test("囲みの中に、その列の中身がぜんぶ入る", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).col).toBe(1);

    const box = framedBox(page, "DESIGNART").first();
    await expect(box).toContainText("バナー出力");
    await expect(box).toContainText("DM入稿15日");
    await expect(box).not.toContainText("WORK");
  });

  test("日付ブロックには枠を付けない（二重にならない）", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("d1", "", { blockType: "day", dayDate: "2026-10-13" }),
        t("g1", "DESIGNART"),
        t("a1", "バナー出力", { parentId: "g1" }),
      ],
    });
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "DESIGNART")).col).toBe(1);

    const day = (await tops(page)).find((x) => x.blockType === "day");
    expect(day.style?.framed).toBeFalsy();
    expect((await byTitle(page, "DESIGNART")).style?.framed).toBe(true);
  });

  test("縦列をやめると枠も外れる", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).style?.framed).toBe(true);

    await page.getByRole("button", { name: "縦列" }).click();   // 縦列をやめる
    await expect.poll(async () => (await tops(page)).every((x) => !x.style?.framed)).toBe(true);
  });

  test("/枠 で、あとから付け外しできる", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).style?.framed).toBe(true);

    const row = page.locator("[data-board] [data-task-id]").filter({ hasText: "WORK" }).first();
    await row.locator("div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /枠");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await byTitle(page, "WORK")).style?.framed).toBeFalsy();
    // 囲みも消える
    await expect(framedBox(page, "WORK")).toHaveCount(0);
  });
});

test.describe("縦列は保存される", () => {
  test("読み直しても、列の分かれ方と枠が残る", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "並べ直す" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).col).toBe(1);

    // フィクスチャは読み直すたびに種を蒔き直すので、それが走らない
    // 新しいタブを同じブラウザで開いて、保存されたものだけを見る。
    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("[data-board]");

    expect((await byTitle(page, "DESIGNART")).col).toBe(0);
    expect((await byTitle(page, "WORK")).col).toBe(1);
    expect((await byTitle(page, "結婚式関連")).col).toBe(2);
    expect((await byTitle(page, "WORK")).style?.framed).toBe(true);
    expect(new Set((await tops(page)).map((x) => x.rowKey)).size).toBe(1);

    // 開き直した画面でも横並びのまま
    const box = async (s) =>
      fresh.locator("[data-board] [data-task-id]").filter({ hasText: s }).first().boundingBox();
    const [d, w] = [await box("DESIGNART"), await box("WORK")];
    expect(Math.abs(d.y - w.y)).toBeLessThan(12);
    expect(d.x).toBeLessThan(w.x);
    await fresh.close();
  });

  test("列の幅も読み直しで残る", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("g1", "ひろい", { rowKey: "r1", col: 0, colWidth: 3, style: { framed: true } }),
        t("g2", "せまい", { rowKey: "r1", col: 1 }),
      ],
    });
    await page.reload();
    await page.waitForSelector("[data-board]");

    expect((await byTitle(page, "ひろい")).colWidth).toBe(3);
    const w = async (s) =>
      (await page.locator("[data-board] [data-task-id]").filter({ hasText: s }).first()
        .locator("xpath=..").boundingBox()).width;
    expect(await w("ひろい")).toBeGreaterThan((await w("せまい")) * 2);
  });
});

test.describe("縦列モード", () => {
  const mode = (page) => page.evaluate(() => localStorage.getItem("taskspace-board-columns"));

  test("既定で縦列になっている", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "なにか")] });
    await expect(page.getByRole("button", { name: "縦列" })).toHaveClass(/emerald/);
  });

  test("縦列のときは、末尾に書くと右に列が増える", async ({ page, seed }) => {
    await seed({ tasks: [t("g1", "ひとつめ", { rowKey: "r1", col: 0, style: { framed: true } })] });

    await page.locator("[data-board] [data-block-tail]").click();
    await page.keyboard.type("ふたつめ");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await byTitle(page, "ふたつめ"))?.col).toBe(1);
    expect((await byTitle(page, "ふたつめ")).rowKey).toBe("r1");   // 同じ行に並ぶ
    expect((await byTitle(page, "ふたつめ")).style?.framed).toBe(true); // 囲みも付く
  });

  test("縦列をやめると、末尾に書いたものは下に積まれる", async ({ page, seed }) => {
    await seed({ tasks: [t("g1", "ひとつめ")] });
    await page.getByRole("button", { name: "縦列" }).click();      // やめる
    await expect.poll(() => mode(page)).toBe("false");

    await page.locator("[data-board] [data-block-tail]").click();
    await page.keyboard.type("ふたつめ");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await byTitle(page, "ふたつめ"))?.title).toBe("ふたつめ");
    expect((await byTitle(page, "ふたつめ")).rowKey).toBeFalsy();
  });

  test("縦列の設定は読み直しても残る", async ({ page, seed }) => {
    await seed({ tasks: [t("g1", "ひとつめ")] });
    await page.getByRole("button", { name: "縦列" }).click();
    await expect.poll(() => mode(page)).toBe("false");

    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("[data-board]");
    await expect(fresh.getByRole("button", { name: "縦列" })).not.toHaveClass(/emerald/);
    await fresh.close();
  });

  test("列の中は本文と同じ操作感のまま", async ({ page, seed }) => {
    await seed({ tasks: [t("g1", "みだし", { rowKey: "r1", col: 0, style: { framed: true } })] });

    const row = page.locator("[data-board] [data-task-id]").filter({ hasText: "みだし" }).first();
    await row.locator("div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");          // 列の中で改行
    await page.keyboard.type("なかみ");
    await page.keyboard.press("Escape");

    // 同じ列に積まれる（新しい列にならない）
    await expect.poll(async () => (await byTitle(page, "なかみ"))?.col).toBe(0);
    expect((await byTitle(page, "なかみ")).rowKey).toBe("r1");
  });
});

test.describe("縦のカテゴリを足す", () => {
  test("「+ 列」で、右に空の列ができてすぐ書ける", async ({ page, seed }) => {
    await seed({ tasks: [t("g1", "ひとつめ", { rowKey: "r1", col: 0, style: { framed: true } })] });
    await page.getByRole("button", { name: "+ 列" }).click();

    await expect(page.locator("textarea")).toHaveCount(1);
    await page.keyboard.type("ふたつめ");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await byTitle(page, "ふたつめ"))?.col).toBe(1);
    expect((await byTitle(page, "ふたつめ")).rowKey).toBe("r1");      // 同じ行に並ぶ
    expect((await byTitle(page, "ふたつめ")).style?.framed).toBe(true); // 囲みも付く
  });

  test("何も無いところからでも1本目を作れる", async ({ page, seed }) => {
    await seed({ tasks: [] });
    await page.getByRole("button", { name: "+ 列" }).click();
    await page.keyboard.type("さいしょの列");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await byTitle(page, "さいしょの列"))?.col).toBe(0);
    expect((await byTitle(page, "さいしょの列")).rowKey).toBeTruthy();
  });

  test("押すたびに右へ増える", async ({ page, seed }) => {
    await seed({ tasks: [] });
    for (const name of ["A", "B", "C"]) {
      await page.getByRole("button", { name: "+ 列" }).click();
      await page.keyboard.type(name);
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await byTitle(page, name))?.title).toBe(name);
    }
    expect([
      (await byTitle(page, "A")).col,
      (await byTitle(page, "B")).col,
      (await byTitle(page, "C")).col,
    ]).toEqual([0, 1, 2]);
  });
});
