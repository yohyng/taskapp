import { test, expect, storedTasks } from "./helpers.js";

// Notion の操作感を1項目ずつ固定する。ここが「どこまで寄せたか」の台帳。
// 足りないものは test.fixme で残してあるので、埋まった順に外していく。

const toPages = (page) => page.locator('button[title="ページ表示"]').click();
const pageBlocks = async (page) => (await storedTasks(page)).filter((t) => t.pageId);
const row = (page, title) => page.locator("[data-task-id]").filter({ hasText: title }).first();

const b = (id, title, blockType = "text") => ({
  id, title, category: "", project: "", blockType, status: "未着手", parentId: null,
  archived: false, scheduledDate: "", plain: true, stock: false, stockViewId: null,
  style: null, canvasX: null, canvasY: null, pageId: "page-1",
  rowKey: null, col: 0, colWidth: null,
});

async function edit(page, title) {
  await row(page, title).locator("div.cursor-text").first().click();
  await page.waitForSelector("textarea");
}
const focusedValue = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el?.tagName === "TEXTAREA" ? el.value : `<${el?.tagName}>`;
});
const selectedTitles = (page) => page.evaluate(() =>
  [...document.querySelectorAll("[data-task-id]")]
    .filter((e) => e.className.includes("ring-sky"))
    .map((e) => e.textContent.trim()));

test.describe("カーソルがブロックをまたぐ", () => {
  test("末尾で↓を押すと、次のブロックを書ける状態で開く", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "うえ"), b("c", "した")] });
    await toPages(page);
    await edit(page, "うえ");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");

    await expect.poll(() => focusedValue(page)).toBe("した");
  });

  test("先頭で↑を押すと、前のブロックに戻る", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "うえ"), b("c", "した")] });
    await toPages(page);
    await edit(page, "した");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");

    await expect.poll(() => focusedValue(page)).toBe("うえ");
  });

  test("移った先の中身が消えない", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "うえ"), b("c", "したの長い文")] });
    await toPages(page);
    await edit(page, "うえ");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedValue(page)).toBe("したの長い文");

    // 開いただけで自動保存が空を書き戻さないこと
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title))
      .toEqual(["うえ", "したの長い文"]);
  });

  test("途中では隣に移らず、ふつうに行内を動く", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "ながいぎょう"), b("c", "した")] });
    await toPages(page);
    await edit(page, "ながいぎょう");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedValue(page)).toBe("ながいぎょう");
  });
});

test.describe("ブロックの選択", () => {
  test("Esc で選び、↓で選択が移る", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "うえ"), b("c", "した")] });
    await toPages(page);
    await edit(page, "うえ");
    await page.keyboard.press("Escape");
    await expect.poll(() => selectedTitles(page)).toEqual(["うえ"]);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => selectedTitles(page)).toEqual(["した"]);
  });

  test("Shift+↓ で通ったところを足していく", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち"), b("c", "に"), b("d", "さん")] });
    await toPages(page);
    await edit(page, "いち");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => selectedTitles(page)).toEqual(["いち", "に", "さん"]);
  });

  test("Shift+クリックで、書いていたところからまとめて選ぶ", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち"), b("c", "に"), b("d", "さん")] });
    await toPages(page);
    await edit(page, "いち");
    await page.keyboard.press("Escape");
    await row(page, "さん").click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedTitles(page)).toEqual(["いち", "に", "さん"]);
  });

  test("Cmd+A は、本文 → ブロック全体 の順に広がる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち"), b("c", "に")] });
    await toPages(page);
    await edit(page, "いち");

    await page.keyboard.press("ControlOrMeta+a");
    const picked = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName === "TEXTAREA" ? el.selectionEnd - el.selectionStart : -1;
    });
    expect(picked).toBe(2); // まず本文だけ（「いち」の2文字）

    await page.keyboard.press("ControlOrMeta+a");
    await expect.poll(() => selectedTitles(page)).toEqual(["いち", "に"]);
  });

  test("選んだブロックは Backspace で消える", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "のこる"), b("c", "きえる")] });
    await toPages(page);
    await edit(page, "きえる");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title)).toEqual(["のこる"]);
  });
});

test.describe("Notion と同じキー操作", () => {
  test("Shift+Enter は同じブロックの中で改行する", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち")] });
    await toPages(page);
    await edit(page, "いち");
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("に");
    await page.keyboard.press("Escape");

    const all = await pageBlocks(page);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("いち\nに");
  });

  test("リストの行頭 Backspace は、まず種別だけ外す", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "もくじ", "bulleted")] });
    await toPages(page);
    await edit(page, "もくじ");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");

    const all = await pageBlocks(page);
    expect(all).toHaveLength(1);
    expect(all[0].blockType).toBe("text");
    expect(all[0].title).toBe("もくじ");
  });

  test("Cmd+B は選んだところだけ太字にする", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "ふとじ")] });
    await toPages(page);
    await edit(page, "ふとじ");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("Escape");
    expect((await pageBlocks(page))[0].title).toBe("**ふとじ**");
  });

  // まだ寄せきれていないもの
  test.fixme("選んだブロックを Cmd+C → Cmd+V で複製できる", async () => {});
  test.fixme("選んだブロックを他のアプリに貼ると Markdown になる", async () => {});
});
