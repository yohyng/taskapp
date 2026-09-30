import { test, expect, storedTasks } from "./helpers.js";

// Notion の仕様に合わせた、ページ本文だけの挙動を確かめる。
// タスク側のビュー（クリック＝選択 / Enter 2回）は変えていないので、
// そちらは selection.spec.js と block-input.spec.js が守っている。

const toPages = (page) => page.locator('button[title="ページ表示"]').click();
const emptyArea = (page) => page.getByText("クリックして書き始める", { exact: false });
const pageBlocks = async (page) => {
  const all = await storedTasks(page);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("[data-task-id]")].map((e) => e.getAttribute("data-task-id")));
  return ids.map((id) => all.find((t) => t.id === id)).filter((t) => t?.pageId);
};

// 本文に1行書いた状態から始める
async function startWriting(page, text = "さいしょの行") {
  await toPages(page);
  await emptyArea(page).click();
  await expect(page.locator("textarea")).toHaveCount(1);
  await page.keyboard.type(text);
  return page.locator("textarea");
}

test.describe("ページ本文（Notion準拠）", () => {
  test("Enter 一回で下に新しいブロックができ、そのまま書き続けられる", async ({ page }) => {
    await startWriting(page);
    await page.keyboard.press("Enter");

    // 二回押す必要はない
    await expect(page.locator("textarea")).toHaveCount(1);
    await expect(page.locator("textarea")).toHaveValue("");

    await page.keyboard.type("つぎの行");
    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title))
      .toEqual(["さいしょの行", "つぎの行"]);
  });

  test("リストは Enter で続き、空のまま Enter でリストを抜ける", async ({ page }) => {
    await startWriting(page, "");
    await page.keyboard.type("- ");
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("bulleted");

    await page.keyboard.type("ひとつめ");
    await page.keyboard.press("Enter");
    // 続きも箇条書きになる
    await expect.poll(async () => (await pageBlocks(page))[1]?.blockType).toBe("bulleted");

    // 空のまま Enter → テキストに戻ってリストを抜ける
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await pageBlocks(page))[1].blockType).toBe("text");
  });

  test("クリックでその場に書き始められる（選択ではなく編集）", async ({ page }) => {
    await startWriting(page, "ここに書く");
    await page.keyboard.press("Escape");
    await expect(page.locator("textarea")).toHaveCount(0);

    // 文字をクリックすると編集に入る。選択バーは出ない。
    await page.locator("[data-task-id] div.cursor-text").first().click();
    await expect(page.locator("textarea")).toHaveCount(1);
  });

  test("Escape で編集を抜けてブロック選択になる", async ({ page }) => {
    await startWriting(page, "えすけーぷ");
    await page.keyboard.press("Escape");

    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.getByText(/件選択中/)).toBeVisible();
    // 書いた内容は失われない
    await expect.poll(async () => (await pageBlocks(page))[0].title).toBe("えすけーぷ");
  });

  test("行頭の Backspace で前のブロックに繋がる", async ({ page }) => {
    await startWriting(page, "まえ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("あと");

    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");

    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title)).toEqual(["まえあと"]);
  });

  test("行頭の Backspace は、まずリストをテキストに戻す", async ({ page }) => {
    await startWriting(page, "");
    await page.keyboard.type("- ");
    await page.keyboard.type("こうもく");
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("bulleted");

    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    // 1回目は種類が戻るだけで、文字は消えない
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("text");
    expect((await pageBlocks(page))[0].title).toBe("こうもく");
  });

  test("Alt+Shift+↑ でブロックの並びが入れ替わる", async ({ page }) => {
    await startWriting(page, "いちばん");
    await page.keyboard.press("Enter");
    await page.keyboard.type("にばん");
    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title)).toEqual(["いちばん", "にばん"]);

    await page.keyboard.press("Alt+Shift+ArrowUp");
    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title)).toEqual(["にばん", "いちばん"]);
  });

  test("空のブロックは、離れても消えずに残る", async ({ page }) => {
    await startWriting(page, "のこる");
    await page.keyboard.press("Enter");
    // 空のまま外へ
    await page.locator("input[placeholder='無題']").click();

    await expect.poll(async () => (await pageBlocks(page)).length).toBe(2);
    expect((await pageBlocks(page))[1].title).toBe("");
  });

  test("ヒントは書いている空ブロックにだけ出る", async ({ page }) => {
    await startWriting(page, "なにか");
    await page.keyboard.press("Enter");
    // 空になった新しいブロックにだけヒント
    await expect(page.locator("textarea")).toHaveAttribute("placeholder", /コマンド/);

    await page.keyboard.type("も");
    await expect(page.locator("textarea")).toHaveAttribute("placeholder", "");
  });
});
