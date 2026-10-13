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
    await page.getByRole("button", { name: "列に分ける" }).click();

    await expect.poll(async () => (await byTitle(page, "DESIGNART")).col).toBe(0);
    expect((await byTitle(page, "WORK")).col).toBe(1);
    expect((await byTitle(page, "結婚式関連")).col).toBe(2);

    const all = await tops(page);
    expect(new Set(all.map((x) => x.rowKey)).size).toBe(1); // ひとつの行にまとまる
  });

  test("子はその列の中に残る（列に散らばらない）", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "列に分ける" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).col).toBe(1);

    // 子は親の下にぶら下がったまま＝列を持たない
    const kid = await byTitle(page, "芝浦工大");
    expect(kid.parentId).toBe("g2");
    expect(kid.rowKey).toBeFalsy();
  });

  test("画面でも横に並び、子は頭の行の下に付く", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "列に分ける" }).click();
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
    await page.getByRole("button", { name: "列に分ける" }).click();

    await expect.poll(async () => (await byTitle(page, "結婚式関連")).col).toBe(2);
    const empty = (await tops(page)).find((x) => !x.title);
    expect(empty.col).toBe(2); // 3列目のまま（4列目を作らない）
  });

  test("「まとめる」で1本に戻る", async ({ page, seed }) => {
    await seed(THREE);
    await page.getByRole("button", { name: "列に分ける" }).click();
    await expect.poll(async () => (await byTitle(page, "WORK")).col).toBe(1);

    await page.getByRole("button", { name: "まとめる" }).click();
    await expect.poll(async () => (await tops(page)).every((x) => !x.rowKey)).toBe(true);
  });

  test("中身のある行が1つしかないときは分けない", async ({ page, seed }) => {
    await seed({ tasks: [t("g1", "ひとつだけ"), t("e1", "")] });
    await page.getByRole("button", { name: "列に分ける" }).click();

    await expect(page.getByText("中身のある行が2つ以上", { exact: false })).toBeVisible();
    expect((await tops(page)).every((x) => !x.rowKey)).toBe(true);
  });

  test("日付や STOCK のブロックも1列として数える", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("d1", "", { blockType: "day", dayDate: "2026-10-13" }),
        t("g1", "DESIGNART"),
        t("a1", "バナー出力", { parentId: "g1" }),
      ],
    });
    await page.getByRole("button", { name: "列に分ける" }).click();

    await expect.poll(async () => (await byTitle(page, "DESIGNART")).col).toBe(1);
    const day = (await tops(page)).find((x) => x.blockType === "day");
    expect(day.col).toBe(0); // 題名が空でも、中身のあるブロックとして数える
  });
});
