import { test, expect, storedTasks, dragTo, centerOf } from "./helpers.js";

// トグルの中へブロックを落として入れられる。
const BOARD = "board-7days";
const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);
const row = (page, s) => page.locator("[data-board] [data-task-id]").filter({ hasText: s }).first();

const BASE = {
  tasks: [
    t("tg", "まとめ", { blockType: "toggle" }),
    t("in", "もとから中", { parentId: "tg" }),
    t("x", "入れたい行"),
  ],
};

test.describe("トグルの中に落とす", () => {
  test("真ん中に落とすと、トグルの中に入る", async ({ page, seed }) => {
    await seed(BASE);
    const from = row(page, "入れたい行");
    await from.hover();
    await dragTo(page, await centerOf(from), await centerOf(row(page, "まとめ")));

    await expect.poll(async () => (await byTitle(page, "入れたい行")).parentId).toBe("tg");
    // 段組みの持ち物は外れる（中の行は列を持たない）
    expect((await byTitle(page, "入れたい行")).rowKey).toBeFalsy();
  });

  test("上の端に落としたときは、これまで通り前に並ぶ", async ({ page, seed }) => {
    await seed(BASE);
    const from = row(page, "入れたい行");
    await from.hover();
    const box = await row(page, "まとめ").boundingBox();
    await dragTo(page, await centerOf(from), { x: box.x + box.width / 2, y: box.y + 1 });

    await expect.poll(async () => (await byTitle(page, "入れたい行")).parentId).toBeFalsy();
  });

  test("トグルでない行は、真ん中でも中に入らない", async ({ page, seed }) => {
    await seed({
      tasks: [t("a", "ふつうの行"), t("x", "入れたい行")],
    });
    const from = row(page, "入れたい行");
    await from.hover();
    await dragTo(page, await centerOf(from), await centerOf(row(page, "ふつうの行")));

    await expect.poll(async () => (await byTitle(page, "入れたい行")).parentId).toBeFalsy();
  });

  test("自分の中には入れられない", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("tg", "まとめ", { blockType: "toggle" }),
        t("kid", "その子", { parentId: "tg" }),
      ],
    });
    const from = row(page, "まとめ");
    await from.hover();
    await dragTo(page, await centerOf(from), await centerOf(row(page, "その子")));

    await expect.poll(async () => (await byTitle(page, "まとめ")).parentId).toBeFalsy();
    expect((await byTitle(page, "その子")).parentId).toBe("tg");
  });
});
