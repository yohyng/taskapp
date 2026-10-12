import { test, expect, storedTasks } from "./helpers.js";

const toPages = (page) => page.locator('button[title="ページ表示"]').click();
const makeDashboard = async (page) => {
  await toPages(page);
  await page.getByRole("button", { name: "ダッシュボード" }).click();
  await expect.poll(async () => (await storedTasks(page)).filter((t) => t.pageId).length).toBeGreaterThan(40);
};
const pageBlocks = async (page) => (await storedTasks(page)).filter((t) => t.pageId);

test.describe("ダッシュボードのひな形", () => {
  test("曜日の段とプロジェクトの段が、それぞれ1行の段組みになる", async ({ page }) => {
    await makeDashboard(page);
    const blocks = await pageBlocks(page);

    // rowKey ごとに、見出しが何列に散っているかを数える
    const byRow = new Map();
    for (const b of blocks.filter((t) => t.rowKey && !t.parentId && t.blockType === "heading3")) {
      if (!byRow.has(b.rowKey)) byRow.set(b.rowKey, new Set());
      byRow.get(b.rowKey).add(b.col);
    }
    const widths = [...byRow.values()].map((s) => s.size).sort((a, b) => a - b);
    expect(widths).toEqual([4, 6]); // 下段4列（PJ）と上段6列（Mon.〜Sat./Sun.）
  });

  test("子ブロックが書いた順に並ぶ（題名順にならない）", async ({ page }) => {
    await makeDashboard(page);
    const blocks = await pageBlocks(page);
    const parent = blocks.find((t) => t.title === "torinome");
    const kids = blocks.filter((t) => t.parentId === parent.id).map((t) => t.title);
    expect(kids).toEqual(["HPを空間系に変更", "AND対応→"]);

    // 画面の並びも同じ（以前はここが題名順に化けていた）
    const row = page.locator("[data-task-id]").filter({ hasText: "HPを空間系に変更" }).first();
    const other = page.locator("[data-task-id]").filter({ hasText: "AND対応→" }).first();
    const [a, b] = [await row.boundingBox(), await other.boundingBox()];
    expect(a.y).toBeLessThan(b.y);
  });

  test("孫までぶら下がる", async ({ page }) => {
    await makeDashboard(page);
    const blocks = await pageBlocks(page);
    const proto = blocks.find((t) => t.title === "次回定例に向けてプロト作成");
    const parent = blocks.find((t) => t.id === proto.parentId);
    expect(parent.title).toBe("DESIGNART2026");
    expect(blocks.filter((t) => t.parentId === proto.id).map((t) => t.title))
      .toEqual(["スタッコとワイヤーと下地", "３Dプリントでオスメス作っておく"]);
  });

  test("見出しに色が付く", async ({ page }) => {
    await makeDashboard(page);
    const blocks = await pageBlocks(page);
    expect(blocks.find((t) => t.title === "NOMLAB PJ").style.color).toBe("#60a5fa");
    expect(blocks.find((t) => t.title === "Sun.").style.color).toBe("#f87171");
  });

  test("幅いっぱいで開き、切り替えると元の幅に戻る", async ({ page }) => {
    await makeDashboard(page);
    const body = page.locator("input[placeholder='無題']").locator("xpath=../..");
    const wide = (await body.boundingBox()).width;

    await page.locator('button[title="幅を元に戻す"]').click();
    await expect(page.locator('button[title="幅いっぱいに広げる"]')).toBeVisible();
    expect((await body.boundingBox()).width).toBeLessThan(wide);
  });
});
