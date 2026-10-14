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
