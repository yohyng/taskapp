import { test, expect, storedTasks } from "./helpers.js";

// 消したものは、読み込み直しても戻ってこないこと。
// Supabase と同期している端末では、消した印（tombstone）が無い行は
// 向こうに残り続け、次の読み込みで復活してしまう。
const BOARD = "board-7days";
const b = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  style: null, canvasX: null, canvasY: null, pageId: BOARD,
  rowKey: "r1", col: 0, colWidth: null, codeLang: "", dayDate: "", ...over,
});
const tomb = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem("ts-tombstone-tasks") || "[]"));
const row = (page, title) => page.locator("[data-task-id]").filter({ hasText: title }).first();

test.describe("消したものが戻ってこない", () => {
  test("PJ を消したら、消した印が残る", async ({ page, seed }) => {
    await seed({
      tasks: [
        b("h0", "消されるPJ", { blockType: "column" }),
        b("a", "中身", {}),
      ],
    });
    const head = row(page, "消されるPJ");
    await head.hover();
    await head.locator("span[data-block-grip]").click();
    await head.getByRole("button", { name: /列を消す|PJ を消す|消す/ }).first().click();

    await expect.poll(async () => (await storedTasks(page)).some((t) => t.id === "h0")).toBe(false);
    expect(await tomb(page)).toContain("h0");
    // 中身は残る（列から外れるだけ）
    const rest = (await storedTasks(page)).find((t) => t.id === "a");
    expect(rest).toBeTruthy();
    expect(rest.rowKey).toBe(null);
  });

  test("前のブロックに繋げて消したときも、消した印が残る", async ({ page, seed }) => {
    await seed({ tasks: [b("x1", "まえ", { rowKey: null }), b("x2", "うしろ", { rowKey: null })] });
    await row(page, "うしろ").locator("div.cursor-text, div.cursor-pointer").first().click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");

    await expect.poll(async () => (await storedTasks(page)).some((t) => t.id === "x2")).toBe(false);
    expect(await tomb(page)).toContain("x2");
  });

  test("ふつうに消したときも、消した印が残る", async ({ page, seed }) => {
    await seed({ tasks: [b("x1", "消すやつ", { rowKey: null })] });
    const r = row(page, "消すやつ");
    await r.hover();
    await r.locator("span[data-block-grip]").click();
    await r.getByRole("button", { name: "削除" }).click();
    await expect.poll(async () => (await tomb(page)).includes("x1")).toBe(true);
  });
});
