import { test, expect, storedTasks, dragTo, centerOf } from "./helpers.js";

// ボードは一覧の中に出ているので、表示の切り替えはいらない
const toPages = async () => {};
const emptyArea = (page) => page.getByText("クリックして書き始める", { exact: false });
const pageBlocks = async (page) => (await storedTasks(page)).filter((t) => t.pageId);
const byTitle = async (page, t) => (await pageBlocks(page)).find((b) => b.title === t);
const row = (page, title) => page.locator("[data-task-id]").filter({ hasText: title }).first();

// 「左 ／ 右」の2列を作って、左の列にカーソルがある状態で返す
async function twoColumns(page) {
  await toPages(page);
  await emptyArea(page).click();
  await expect(page.locator("textarea")).toHaveCount(1);
  await page.keyboard.type("ひだり /PJを追加");
  await page.keyboard.press("Enter");
  await page.keyboard.type("みぎ");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await pageBlocks(page)).length).toBe(2);
}

// 画面上で横に並んでいるか
function sideBySide(page, a, b) {
  return page.evaluate(([x, y]) => {
    const find = (t) => [...document.querySelectorAll("[data-task-id]")]
      .find((e) => e.textContent.includes(t))?.getBoundingClientRect();
    const ra = find(x), rb = find(y);
    if (!ra || !rb) return null;
    return { sameRow: Math.abs(ra.top - rb.top) < 12, aLeftOfB: ra.left < rb.left };
  }, [a, b]);
}

test.describe("段組みの中で編集しても崩れない", () => {
  test("列の中で改行しても、同じ列に残る", async ({ page }) => {
    await twoColumns(page);

    // 左の列の末尾で改行して書き足す
    await row(page, "ひだり").locator("div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("ひだり2");
    await page.keyboard.press("Escape");

    const [a, b, c] = [await byTitle(page, "ひだり"), await byTitle(page, "みぎ"), await byTitle(page, "ひだり2")];
    expect(c.rowKey).toBe(a.rowKey);   // 行から外れない
    expect(c.col).toBe(a.col);          // 同じ列に積まれる
    expect(b.rowKey).toBe(a.rowKey);

    // 段組みが割れていない
    await expect.poll(() => sideBySide(page, "ひだり", "みぎ")).toEqual({ sameRow: true, aLeftOfB: true });
    await expect.poll(() => sideBySide(page, "ひだり2", "みぎ")).toEqual({ sameRow: false, aLeftOfB: true });
  });

  test("列の中で複製しても、同じ列に残る", async ({ page }) => {
    await twoColumns(page);
    const target = row(page, "ひだり");
    await target.hover();
    await target.locator('span[title="ドラッグで移動／クリックでメニュー"]').click();
    await target.getByRole("button", { name: "複製" }).click();

    await expect.poll(async () => (await pageBlocks(page)).filter((t) => t.title === "ひだり").length).toBe(2);
    const copies = (await pageBlocks(page)).filter((t) => t.title === "ひだり");
    expect(new Set(copies.map((t) => t.rowKey)).size).toBe(1);
    expect(new Set(copies.map((t) => t.col)).size).toBe(1);
  });

  test("間に別のブロックが挟まっても、行はひとつに束ねられる", async ({ page, seed }) => {
    // 同じ rowKey の2列のあいだに、段組みに属さないブロックが割り込んでいる状態
    const b = (id, title, over) => ({
      id, title, category: "", project: "", blockType: "text", status: "未着手",
      parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
      style: null, canvasX: null, canvasY: null, pageId: "board-7days",
      rowKey: null, col: 0, colWidth: null, ...over,
    });
    await seed({
      tasks: [
        // ページ以外のタスクが1件ないと、一覧側に何も描かれず読み込みを待てない
        b("plain", "ふつうのタスク", { pageId: null }),
        b("l", "ひだり", { rowKey: "r1", col: 0 }),
        b("x", "よそもの"),
        b("r", "みぎ", { rowKey: "r1", col: 1 }),
      ],
    });
    await toPages(page);

    // 「ひだり」と「みぎ」は配列の上で離れているが、同じ行として横に並ぶ
    await expect.poll(() => sideBySide(page, "ひだり", "みぎ")).toEqual({ sameRow: true, aLeftOfB: true });
  });
});

test.describe("ドラッグで列を作る", () => {
  test("ブロックを相手の右端に落とすと、右に列ができる", async ({ page }) => {
    await toPages(page);
    await emptyArea(page).click();
    await expect(page.locator("textarea")).toHaveCount(1);
    await page.keyboard.type("うえ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("した");
    await page.keyboard.press("Escape");

    const target = row(page, "うえ");
    const grip = row(page, "した").locator('span[title="ドラッグで移動／クリックでメニュー"]');
    await row(page, "した").hover();

    const box = await target.boundingBox();
    await dragTo(page, await centerOf(grip), { x: box.x + box.width - 12, y: box.y + box.height / 2 });

    await expect.poll(async () => (await byTitle(page, "した"))?.rowKey).toBeTruthy();
    const [up, down] = [await byTitle(page, "うえ"), await byTitle(page, "した")];
    expect(down.rowKey).toBe(up.rowKey);
    expect(down.col).toBe(up.col + 1);
    await expect.poll(() => sideBySide(page, "うえ", "した")).toEqual({ sameRow: true, aLeftOfB: true });
  });

  test("真ん中に落としたときは、これまで通りの並べ替えのまま", async ({ page }) => {
    await toPages(page);
    await emptyArea(page).click();
    await expect(page.locator("textarea")).toHaveCount(1);
    await page.keyboard.type("うえ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("した");
    await page.keyboard.press("Escape");

    const grip = row(page, "した").locator('span[title="ドラッグで移動／クリックでメニュー"]');
    await row(page, "した").hover();
    await dragTo(page, await centerOf(grip), await centerOf(row(page, "うえ")));

    // 真ん中に落としたときは列を増やさない（同じ列のまま並べ替わる）
    await expect.poll(async () => (await byTitle(page, "した")).col)
      .toBe((await byTitle(page, "うえ")).col);
    const cols = new Set((await pageBlocks(page)).map((t) => t.col));
    expect(cols.size).toBe(1);
  });
});
