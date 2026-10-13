import { test, expect, storedTasks } from "./helpers.js";

// ボードは一覧の中に出ているので、表示の切り替えはいらない
const toPages = async () => {};
const emptyArea = (page) => page.getByText("クリックして書き始める", { exact: false });
const pageBlocks = async (page) => (await storedTasks(page)).filter((t) => t.pageId);

async function write(page, text) {
  await toPages(page);
  await emptyArea(page).click();
  await expect(page.locator("textarea")).toHaveCount(1);
  await page.keyboard.type(text);
}

// 同じ行に横並びになっているか、画面上の位置で見る
async function sideBySide(page, titleA, titleB) {
  return page.evaluate(([a, b]) => {
    const find = (t) => [...document.querySelectorAll("[data-task-id]")]
      .find((e) => e.textContent.includes(t))?.getBoundingClientRect();
    const ra = find(a), rb = find(b);
    if (!ra || !rb) return null;
    return { sameRow: Math.abs(ra.top - rb.top) < 10, aLeftOfB: ra.left < rb.left };
  }, [titleA, titleB]);
}

test.describe("段組み", () => {
  test("列を追加すると横に並ぶ", async ({ page }) => {
    await write(page, "ひだり /列を追加");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await pageBlocks(page)).length).toBe(2);
    const [a, b] = await pageBlocks(page);
    // 同じ行に属し、列番号が左右に分かれる
    expect(a.rowKey).toBeTruthy();
    expect(a.rowKey).toBe(b.rowKey);
    expect(b.col).toBe(a.col + 1);

    // 右の列に書く
    await page.keyboard.type("みぎ");
    await page.keyboard.press("Escape");
    await expect.poll(() => sideBySide(page, "ひだり", "みぎ"))
      .toEqual({ sameRow: true, aLeftOfB: true });
  });

  test("左に列を追加すると自分が右になる", async ({ page }) => {
    await write(page, "もとのブロック /左に列を追加");
    await page.keyboard.press("Enter");

    const [a, b] = await pageBlocks(page);
    expect(b.col).toBe(a.col - 1);
  });

  test("段組みをやめると縦に戻る", async ({ page }) => {
    await write(page, "いち /列を追加");
    await page.keyboard.press("Enter");
    await page.keyboard.type("に");
    await page.keyboard.press("Escape");
    await expect.poll(() => sideBySide(page, "いち", "に")).toEqual({ sameRow: true, aLeftOfB: true });

    // 左の列で解除する
    await page.locator("[data-task-id] div.cursor-text").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /段組みをやめる");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await pageBlocks(page)).every((t) => !t.rowKey)).toBe(true);
    await expect.poll(() => sideBySide(page, "いち", "に"))
      .toEqual({ sameRow: false, aLeftOfB: false });
  });

  test("3列まで増やせる", async ({ page }) => {
    await write(page, "A /列を追加");
    await page.keyboard.press("Enter");
    await page.keyboard.type("B /列を追加");
    await page.keyboard.press("Enter");
    await page.keyboard.type("C");
    await page.keyboard.press("Escape");

    const b = await pageBlocks(page);
    expect(b).toHaveLength(3);
    expect(new Set(b.map((t) => t.rowKey)).size).toBe(1);
    expect(b.map((t) => t.col).sort((x, y) => x - y)).toEqual([0, 1, 2]);
  });

  test("狭い画面では縦に積む", async ({ page }) => {
    await write(page, "ひだり /列を追加");
    await page.keyboard.press("Enter");
    await page.keyboard.type("みぎ");
    await page.keyboard.press("Escape");
    await expect.poll(() => sideBySide(page, "ひだり", "みぎ")).toEqual({ sameRow: true, aLeftOfB: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => sideBySide(page, "ひだり", "みぎ"))
      .toEqual({ sameRow: false, aLeftOfB: false });
  });
});
