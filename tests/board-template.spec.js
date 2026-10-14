import { test, expect, storedTasks } from "./helpers.js";

const BOARD = "board-7days";
const openSettings = (page) =>
  page.locator('button[title="Columns / Category Settings"], button[title*="Settings"]').first().click();
const insert = async (page) => {
  await openSettings(page);
  await page.getByRole("button", { name: "ボードにいつもの4列を入れる" }).click();
};
const boardTasks = async (page) => (await storedTasks(page)).filter((t) => t.pageId === BOARD);
const byTitle = async (page, title) => (await boardTasks(page)).find((t) => t.title === title);

test.describe("ボードのひな形", () => {
  test("4つの列が、左から順に入る", async ({ page }) => {
    await insert(page);
    await expect.poll(async () =>
      (await boardTasks(page)).filter((t) => t.blockType === "column").map((t) => t.title)
    ).toEqual(["NOMLAB", "NOMURA", "DESIGNART", "PRIVATE"]);

    const cols = (await boardTasks(page)).filter((t) => t.blockType === "column");
    expect(cols.map((t) => t.col)).toEqual([0, 1, 2, 3]);
    expect(new Set(cols.map((t) => t.rowKey)).size).toBe(1); // 同じ行＝横に並ぶ
  });

  test("列の中身が、親子のまま入る", async ({ page }) => {
    await insert(page);
    await expect.poll(async () => !!(await byTitle(page, "経費精算"))).toBe(true);

    const keihi = await byTitle(page, "経費精算");
    const ai = await byTitle(page, "AI経費");
    const gem = await byTitle(page, "Gemini/OpenAI/Claude");
    expect(ai.parentId).toBe(keihi.id);
    expect(gem.parentId).toBe(ai.id);
    // 子も同じ列に属する
    expect(gem.col).toBe(keihi.col);
    expect(gem.rowKey).toBe(keihi.rowKey);
  });

  test("トグルと色が付いている", async ({ page }) => {
    await insert(page);
    await expect.poll(async () => (await byTitle(page, "現象風"))?.blockType).toBe("toggle");
    expect((await byTitle(page, "現象風")).style?.color).toBeTruthy();
    expect((await byTitle(page, "NOMLAB")).style).toMatchObject({ weight: 700 });
  });

  test("済みのものは完了で入る", async ({ page }) => {
    await insert(page);
    await expect.poll(async () => (await byTitle(page, "芝浦工大レクチャー資料修正"))?.status).toBe("完了");
  });

  test("画面にも4列が横に並ぶ", async ({ page }) => {
    await insert(page);
    await expect(page.getByText("DESIGNART", { exact: true })).toBeVisible();
    const tops = await page.evaluate(() =>
      ["NOMLAB", "NOMURA", "DESIGNART", "PRIVATE"].map((t) => {
        const el = [...document.querySelectorAll("[data-task-id]")]
          .find((e) => e.textContent.trim().startsWith(t));
        return el ? Math.round(el.getBoundingClientRect().top) : null;
      }));
    expect(tops.every((t) => t !== null)).toBe(true);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(12);
  });

  test("いまあるブロックは消えない／取り消せる", async ({ page, seed }) => {
    await seed({
      tasks: [{
        id: "keep", title: "さきにあった行", category: "", project: "", blockType: "text",
        status: "未着手", parentId: null, archived: false, scheduledDate: "", plain: true,
        stock: false, style: null, canvasX: null, canvasY: null, pageId: BOARD,
        rowKey: null, col: 0, colWidth: null,
      }],
    });
    const before = (await storedTasks(page)).length;
    await insert(page);
    await expect.poll(async () => (await boardTasks(page)).length).toBeGreaterThan(20);
    expect(await byTitle(page, "さきにあった行")).toBeTruthy();

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before);
    expect(await byTitle(page, "さきにあった行")).toBeTruthy();
  });
});
