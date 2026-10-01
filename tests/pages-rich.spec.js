import { test, expect, storedTasks } from "./helpers.js";

const toPages = (page) => page.locator('button[title="ページ表示"]').click();
const emptyArea = (page) => page.getByText("クリックして書き始める", { exact: false });
const pageBlocks = async (page) => (await storedTasks(page)).filter((t) => t.pageId);

async function startWriting(page, text = "") {
  await toPages(page);
  await emptyArea(page).click();
  await expect(page.locator("textarea")).toHaveCount(1);
  if (text) await page.keyboard.type(text);
}

test.describe("Notion の記法（公式の一覧に合わせる）", () => {
  // Notion 公式いわく > はトグル、引用は "
  const CASES = [
    ["> ", "toggle"],
    ['" ', "quote"],
    ["* ", "bulleted"],
    ["```", "code"],
  ];

  for (const [prefix, expected] of CASES) {
    test(`「${prefix.trim()}」で ${expected} になる`, async ({ page }) => {
      await startWriting(page);
      await page.keyboard.type(prefix);
      await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe(expected);
    });
  }
});

test.describe("インライン装飾", () => {
  test("**太字** が太字で表示される", async ({ page }) => {
    await startWriting(page, "これは **ふとじ** です");
    await page.keyboard.press("Escape");

    const strong = page.locator("[data-task-id] strong");
    await expect(strong).toHaveText("ふとじ");
    // 記法そのものは表示に出ない
    await expect(page.locator("[data-task-id]").first()).not.toContainText("**");
  });

  test("*斜体* と `コード` と ~打ち消し~ が効く", async ({ page }) => {
    await startWriting(page, "*しゃたい* と `こーど` と ~けし~");
    await page.keyboard.press("Escape");

    const row = page.locator("[data-task-id]").first();
    await expect(row.locator("em")).toHaveText("しゃたい");
    await expect(row.locator("code")).toHaveText("こーど");
    await expect(row.locator("s")).toHaveText("けし");
  });

  test("URL は自動でリンクになる", async ({ page }) => {
    await startWriting(page, "参考 https://example.com/x を見る");
    await page.keyboard.press("Escape");

    const link = page.locator("[data-task-id] a");
    await expect(link).toHaveAttribute("href", "https://example.com/x");
  });

  test("編集に戻ると記法がそのまま見える", async ({ page }) => {
    await startWriting(page, "**ふとじ**");
    await page.keyboard.press("Escape");
    await page.locator("[data-task-id] div.cursor-text").first().click();

    await expect(page.locator("textarea")).toHaveValue("**ふとじ**");
  });

  test("Cmd+B で選択範囲が太字の記法になる", async ({ page }) => {
    await startWriting(page, "ふとくする");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");

    await expect(page.locator("textarea")).toHaveValue("**ふとくする**");
  });
});

test.describe("トグルリスト", () => {
  test("閉じると子が隠れ、開くと戻る", async ({ page }) => {
    await startWriting(page, "");
    await page.keyboard.type("> ");
    await page.keyboard.type("おやトグル");
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("toggle");

    // 子を作る（Enter → Tab でネスト）
    await page.keyboard.press("Enter");
    await page.keyboard.type("こども");
    await page.keyboard.press("Tab");
    await expect.poll(async () => (await pageBlocks(page)).filter((t) => t.parentId).length).toBe(1);

    const childVisible = () => page.getByText("こども").count();
    await expect.poll(childVisible).toBeGreaterThan(0);

    // Enter でトグルが続くので子もトグルになる。親のボタンだけを押す。
    const parentRow = page.locator("[data-task-id]").first();
    await parentRow.locator('button[title="閉じる"]').click();
    await expect.poll(childVisible).toBe(0);

    await parentRow.locator('button[title="開く"]').click();
    await expect.poll(childVisible).toBeGreaterThan(0);
  });
});

test.describe("その他の拡充", () => {
  test("Shift+Enter は同じブロック内で改行する", async ({ page }) => {
    await startWriting(page, "いちぎょうめ");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("にぎょうめ");

    // ブロックは増えない
    await expect.poll(async () => (await pageBlocks(page)).length).toBe(1);
    await expect(page.locator("textarea")).toHaveValue("いちぎょうめ\nにぎょうめ");

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-task-id] br")).toHaveCount(1);
  });

  test("Cmd+D で同じ内容のブロックが直下にできる", async ({ page }) => {
    await startWriting(page, "ふくせいもと");
    await page.keyboard.press("ControlOrMeta+d");

    await expect.poll(async () => (await pageBlocks(page)).length).toBe(2);
    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title))
      .toEqual(["ふくせいもと", "ふくせいもと"]);
  });

  test("コードブロックは等幅で表示される", async ({ page }) => {
    await startWriting(page);
    await page.keyboard.type("```");
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("code");

    await page.keyboard.type("const x = 1");
    await page.keyboard.press("Escape");

    const family = await page.locator("[data-task-id]").first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family.toLowerCase()).toMatch(/mono/);
  });
});

test.describe("ブロックメニューと並べ替え", () => {
  // 3つのブロックを書いた状態にする
  async function threeBlocks(page) {
    await startWriting(page, "いち");
    await page.keyboard.press("Enter");
    await page.keyboard.type("に");
    await page.keyboard.press("Enter");
    await page.keyboard.type("さん");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title))
      .toEqual(["いち", "に", "さん"]);
  }

  test("⠿ のメニューから種類を変えられる", async ({ page }) => {
    await startWriting(page, "みだしにする");
    await page.keyboard.press("Escape");

    const row = page.locator("[data-task-id]").first();
    await row.hover();
    await row.locator('span[title="ドラッグで移動／クリックでメニュー"]').click();
    await row.getByRole("button", { name: "見出し1" }).click();

    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("heading1");
  });

  test("⠿ のメニューから複製できる", async ({ page }) => {
    await startWriting(page, "ふくせい");
    await page.keyboard.press("Escape");

    const row = page.locator("[data-task-id]").first();
    await row.hover();
    await row.locator('span[title="ドラッグで移動／クリックでメニュー"]').click();
    await row.getByRole("button", { name: "複製" }).click();

    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title))
      .toEqual(["ふくせい", "ふくせい"]);
  });

  test("ドラッグで並べ替えられる", async ({ page }) => {
    await threeBlocks(page);

    // 3番目を1番目の上へ運ぶ
    const rows = page.locator("[data-task-id]");
    const from = await rows.nth(2).boundingBox();
    const to = await rows.nth(0).boundingBox();

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 3, { steps: 14 });
    await page.mouse.up();

    await expect.poll(async () => (await pageBlocks(page)).map((t) => t.title))
      .toEqual(["さん", "いち", "に"]);
  });

  test("ドラッグしたときはメニューが出ない", async ({ page }) => {
    await threeBlocks(page);
    const row = page.locator("[data-task-id]").first();
    await row.hover();
    const handle = row.locator('span[title="ドラッグで移動／クリックでメニュー"]');
    const h = await handle.boundingBox();

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + 40, { steps: 8 });
    await page.mouse.up();

    await expect(row.getByRole("button", { name: "複製" })).toHaveCount(0);
  });
});
