import { test, expect, storedTasks } from "./helpers.js";

// 7days の下の自由ブロック領域を、段組み済みの状態で用意する
const BOARD = "board-7days";
const col = (id, title, c, width) => ({
  id, title, category: "", project: "", blockType: "heading3", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: "r1", col: c, colWidth: width ?? null,
});
const THREE = { tasks: [col("c0", "左の列", 0), col("c1", "真ん中の列", 1), col("c2", "右の列", 2)] };

const boardTasks = async (page) => (await storedTasks(page)).filter((t) => t.pageId === BOARD);
const byTitle = async (page, title) => (await boardTasks(page)).find((t) => t.title === title);
// 列の操作帯は左から順に並ぶので、位置で指せる
const bar = (page, i) => page.locator("[data-col]").nth(i);
const colBox = (page, i) => page.locator("[data-col]").nth(i).locator("xpath=..").boundingBox();

test.describe("7daysの下の自由ブロック", () => {
  test("7days と一緒に出ていて、書き始められる", async ({ page }) => {
    const empty = page.getByText("ここは自由。クリックして書き始める", { exact: false });
    await expect(empty).toBeVisible();
    await empty.click();
    await page.keyboard.type("ためしに書く");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await boardTasks(page)).map((t) => t.title)).toContain("ためしに書く");
  });

  test("列を右へ送ると、隣の列と入れ替わる", async ({ page, seed }) => {
    await seed(THREE);
    await bar(page, 0).getByTitle("この列を右へ").click();

    await expect.poll(async () => (await byTitle(page, "左の列")).col).toBe(1);
    expect((await byTitle(page, "真ん中の列")).col).toBe(0);
    expect((await byTitle(page, "右の列")).col).toBe(2); // 巻き込まれない
  });

  test("送ったあと、画面の並びも入れ替わる", async ({ page, seed }) => {
    await seed(THREE);
    await bar(page, 0).getByTitle("この列を右へ").click();
    const first = page.locator("[data-col]").nth(0).locator("xpath=..");
    await expect(first).toContainText("真ん中の列");
  });

  test("両端の列は、外側へは送れない", async ({ page, seed }) => {
    await seed(THREE);
    await expect(bar(page, 0).getByTitle("この列を左へ")).toBeHidden();
    await expect(bar(page, 0).getByTitle("この列を右へ")).toBeVisible();
    await expect(bar(page, 2).getByTitle("この列を右へ")).toBeHidden();
  });

  test("幅を変えると、その列だけ広くなる", async ({ page, seed }) => {
    await seed({ tasks: [col("c0", "広い列", 0, 3), col("c1", "狭い列", 1)] });
    const [wide, narrow] = [await colBox(page, 0), await colBox(page, 1)];
    expect(wide.width).toBeGreaterThan(narrow.width * 2);
  });

  test("幅のつまみをダブルクリックすると既定に戻る", async ({ page, seed }) => {
    await seed({ tasks: [col("c0", "広い列", 0, 3), col("c1", "狭い列", 1)] });
    await bar(page, 0).getByTitle("ドラッグで幅を変える／ダブルクリックで戻す").dblclick();
    await expect.poll(async () => (await byTitle(page, "広い列")).colWidth).toBe(1);

    const [a, b] = [await colBox(page, 0), await colBox(page, 1)];
    expect(Math.abs(a.width - b.width)).toBeLessThan(8);
  });

  test("ページ本文とは別の持ち物で、混ざらない", async ({ page, seed }) => {
    await seed(THREE);
    await page.locator('button[title="ページ表示"]').click();
    await expect(page.getByText("クリックして書き始める。/ でコマンド。", { exact: false })).toBeVisible();
    await expect(page.locator("[data-task-id]").filter({ hasText: "真ん中の列" })).toHaveCount(0);
  });
});
