import { test, expect, storedTasks, todayKey, dragTo, centerOf } from "./helpers.js";

// TRAY は「まだどこにも置いていないもの」だけを持つ。
const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: null,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
const trayRows = (page) => page.evaluate(() => {
  const head = [...document.querySelectorAll("span")].find((e) => e.textContent.trim() === "TRAY");
  const panel = head?.closest("div")?.parentElement;
  return panel ? [...panel.querySelectorAll("[data-task-id]")].map((e) => e.textContent.trim()) : [];
});

test.describe("TRAY に出るもの", () => {
  test("どこにも置いていないものだけが出る", async ({ page, seed }) => {
    await seed({
      tasks: [
        t("free", "どこにも無い"),
        t("day", "7daysにある", { scheduledDate: todayKey() }),
        t("board", "ボードにある", { pageId: "board-7days" }),
      ],
    });
    const rows = await trayRows(page);
    expect(rows.some((r) => r.includes("どこにも無い"))).toBe(true);
    expect(rows.some((r) => r.includes("7daysにある"))).toBe(false);
    expect(rows.some((r) => r.includes("ボードにある"))).toBe(false);
  });

  test("日付を外すと TRAY に戻ってくる", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "予定ありだった", { scheduledDate: todayKey() })] });
    expect((await trayRows(page)).some((r) => r.includes("予定ありだった"))).toBe(false);

    // 7days の行で /日付を外す
    const row = page.locator('[data-daytask][data-task-id="a"]').first();
    await row.locator("div.cursor-pointer").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /日付を外す");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTasks(page)).find((x) => x.id === "a").scheduledDate).toBe("");
    await expect.poll(async () => (await trayRows(page)).some((r) => r.includes("予定ありだった"))).toBe(true);
  });

  test("ボードへ持っていくと TRAY から消える（二重に出ない）", async ({ page, seed }) => {
    await seed({ tasks: [t("a", "移すやつ")] });
    expect((await trayRows(page)).some((r) => r.includes("移すやつ"))).toBe(true);

    // ボードの受け皿へ落とす
    const from = page.locator('[data-task-id="a"]').first();
    await from.hover();
    const tail = page.locator("[data-board] [data-block-tail]");
    await dragTo(page, await centerOf(from), await centerOf(tail));

    await expect.poll(async () => (await storedTasks(page)).find((x) => x.id === "a").pageId).toBe("board-7days");
    await expect.poll(async () => (await trayRows(page)).some((r) => r.includes("移すやつ"))).toBe(false);
  });
});
