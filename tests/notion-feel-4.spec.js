import { test, expect, storedTasks } from "./helpers.js";

// 第4回: スラッシュメニュー・ページまわり・ブロックの細部
const toPages = (page) => page.locator('button[title="ページ表示"]').click();
const pageBlocks = async (page) => (await storedTasks(page)).filter((t) => t.pageId);
const row = (page, s) => page.locator("[data-task-id]").filter({ hasText: s }).first();
const menu = (page) => page.locator("[data-slash-menu]");
const items = (page) => menu(page).locator("button");

const b = (id, title, blockType = "text", over = {}) => ({
  id, title, category: "", project: "", blockType, status: "未着手", parentId: null,
  archived: false, scheduledDate: "", plain: true, stock: false, stockViewId: null,
  style: null, canvasX: null, canvasY: null, pageId: "page-1",
  rowKey: null, col: 0, colWidth: null, codeLang: "", ...over,
});

async function edit(page, s) {
  await row(page, s).locator("div.cursor-text").first().click();
  await page.waitForSelector("textarea");
}
async function openSlash(page, s, q = "") {
  await edit(page, s);
  await page.keyboard.press("End");
  await page.keyboard.type(" /" + q);
}

test.describe("スラッシュメニューの絞り込み", () => {
  const one = { tasks: [b("a", "もと")] };

  test("日本語（かな）で絞れる", async ({ page, seed }) => {
    await seed(one);
    await toPages(page);
    await openSlash(page, "もと", "みだし");
    await expect(items(page)).not.toHaveCount(0);
    for (const txt of await items(page).allInnerTexts()) {
      expect(txt).toMatch(/見出し|目次/);
    }
  });

  test("カタカナで打ってもひらがなと同じに扱う", async ({ page, seed }) => {
    await seed(one);
    await toPages(page);
    await openSlash(page, "もと", "ミダシ");
    await expect(items(page).filter({ hasText: "見出し1" })).toHaveCount(1);
  });

  test("英語でも記法の綴りでも絞れる", async ({ page, seed }) => {
    await seed(one);
    await toPages(page);
    await openSlash(page, "もと", "h1");
    await expect(items(page).filter({ hasText: "見出し1" })).toHaveCount(1);
  });

  test("かなで選んで、コマンド文字列が残らない", async ({ page, seed }) => {
    await seed(one);
    await toPages(page);
    await openSlash(page, "もと", "みだし1");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await pageBlocks(page))[0].title).toBe("もと");
    expect((await pageBlocks(page))[0].blockType).toBe("heading1");
  });

  test("候補が無いときは、無いと分かる", async ({ page, seed }) => {
    await seed(one);
    await toPages(page);
    await openSlash(page, "もと", "ぜったいにないことば");
    await expect(menu(page)).toHaveText("該当なし");
  });

  test("マウスを乗せた項目が選ばれ、Enter の行き先と一致する", async ({ page, seed }) => {
    await seed(one);
    await toPages(page);
    await openSlash(page, "もと", "みだし");
    const third = items(page).filter({ hasText: "見出し3" }).first();
    await third.hover();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("heading3");
  });
});

test.describe("目次", () => {
  const withHeads = {
    tasks: [
      b("h1", "おおみだし", "heading1"),
      b("h2", "なかみだし", "heading2"),
      b("x", "ほんぶん"),
      b("toc", "", "toc"),
    ],
  };

  test("本文の見出しが並ぶ", async ({ page, seed }) => {
    await seed(withHeads);
    await toPages(page);
    const toc = page.locator("[data-toc]");
    await expect(toc.getByText("おおみだし")).toBeVisible();
    await expect(toc.getByText("なかみだし")).toBeVisible();
    await expect(toc.getByText("ほんぶん")).toHaveCount(0); // 見出しだけ
  });

  test("深さに応じて下げて並ぶ", async ({ page, seed }) => {
    await seed(withHeads);
    await toPages(page);
    const toc = page.locator("[data-toc]");
    // 項目は横いっぱいの帯なので、字の位置は内側の余白で見る
    const pad = (name) => toc.getByText(name).evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(await pad("なかみだし")).toBeGreaterThan(await pad("おおみだし"));
  });

  test("見出しが無いときは、そう書いてある", async ({ page, seed }) => {
    await seed({ tasks: [b("toc", "", "toc")] });
    await toPages(page);
    await expect(page.getByText("見出しを作るとここに並ぶ")).toBeVisible();
  });
});

test.describe("ページの操作", () => {
  const twoPages = [
    { id: "page-1", title: "さいしょ", icon: "📄" },
    { id: "page-2", title: "つぎ", icon: "📝" },
  ];
  const seedPages = (page) => page.addInitScript(
    ([v]) => localStorage.setItem("taskspace-pages", JSON.stringify(v)), [twoPages]);
  const storedPages = (page) => page.evaluate(() =>
    JSON.parse(localStorage.getItem("taskspace-pages") || "[]").map((p) => p.title));

  test("並びを上下で変えられる", async ({ page, seed }) => {
    await seedPages(page);
    await seed({ tasks: [b("a", "ほんぶん")] });
    await toPages(page);
    await page.locator("aside").getByText("さいしょ").hover();
    await page.locator("aside").getByTitle("下へ").first().click();
    await expect.poll(() => storedPages(page)).toEqual(["つぎ", "さいしょ"]);
  });

  test("複製すると、中身も段組みも連れていく", async ({ page, seed }) => {
    await seedPages(page);
    await seed({
      tasks: [
        b("a", "みだし", "heading2", { rowKey: "r1", col: 0 }),
        b("c", "こ", "text", { parentId: "a" }),
      ],
    });
    await toPages(page);
    await page.locator("aside").getByText("さいしょ").hover();
    await page.locator("aside").getByTitle("このページを複製").first().click();

    await expect.poll(() => storedPages(page)).toEqual(["さいしょ", "つぎ", "さいしょ のコピー"]);
    const all = await pageBlocks(page);
    const copyPage = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("taskspace-pages")).at(-1).id);
    const copied = all.filter((t) => t.pageId === copyPage);
    expect(copied).toHaveLength(2);

    const head = copied.find((t) => t.title === "みだし");
    const kid = copied.find((t) => t.title === "こ");
    expect(kid.parentId).toBe(head.id);           // 親子が保たれる
    expect(head.rowKey).toBeTruthy();
    expect(head.rowKey).not.toBe("r1");           // 元のページと行が混ざらない
  });

  test("Cmd+P でページと行を探して飛べる", async ({ page, seed }) => {
    await seedPages(page);
    await seed({ tasks: [b("a", "さがしもの"), { ...b("z", "べつのページの行"), pageId: "page-2" }] });
    await toPages(page);

    await page.keyboard.press("ControlOrMeta+p");
    const find = page.locator("[data-quick-find]");
    await expect(find).toBeVisible();

    await find.getByLabel("さがす").fill("さがしもの");
    await expect(find.locator("button")).toHaveCount(1);
    await find.getByLabel("さがす").press("Enter");
    await expect(find).toHaveCount(0);
  });

  test("Cmd+P はかなでも絞れて、Esc で閉じる", async ({ page, seed }) => {
    await seedPages(page);
    await seed({ tasks: [b("a", "ホンブン")] });
    await toPages(page);
    await page.keyboard.press("ControlOrMeta+p");
    const find = page.locator("[data-quick-find]");
    await find.getByLabel("さがす").fill("ほんぶん");
    await expect(find.locator("button")).toHaveCount(1);
    await find.getByLabel("さがす").press("Escape");
    await expect(find).toHaveCount(0);
  });
});

test.describe("ブロックの細部", () => {
  test("番号付きは 1. 2. 3. と続く", async ({ page, seed }) => {
    await seed({
      tasks: [b("a", "いち", "numbered"), b("c", "に", "numbered"), b("d", "さん", "numbered")],
    });
    await toPages(page);
    const nums = await page.evaluate(() =>
      [...document.querySelectorAll("[data-task-id] span")]
        .map((s) => s.textContent).filter((x) => /^\d+\.$/.test(x)));
    expect(nums).toEqual(["1.", "2.", "3."]);
  });

  test("間に別の行が入ると、番号は振り直される", async ({ page, seed }) => {
    await seed({
      tasks: [b("a", "いち", "numbered"), b("c", "あいだ"), b("d", "に", "numbered")],
    });
    await toPages(page);
    const nums = await page.evaluate(() =>
      [...document.querySelectorAll("[data-task-id] span")]
        .map((s) => s.textContent).filter((x) => /^\d+\.$/.test(x)));
    expect(nums).toEqual(["1.", "1."]);
  });

  test("空のトグルは、空だと分かる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "からっぽ", "toggle")] });
    await toPages(page);
    await expect(page.getByText("空のトグル", { exact: false })).toBeVisible();
  });

  test("コードの言語を選ぶと覚える", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "const x = 1", "code")] });
    await toPages(page);
    await page.locator("[data-code-lang]").selectOption("ts");
    await expect.poll(async () => (await pageBlocks(page))[0].codeLang).toBe("ts");
  });

  test("画像ブロックは URL を貼ると絵が出る", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "https://example.com/a.png", "image")] });
    await toPages(page);
    await expect(page.locator("[data-task-id] img")).toHaveAttribute("src", "https://example.com/a.png");
  });

  test("画像ブロックが空なら、貼れと分かる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "", "image")] });
    await toPages(page);
    await expect(page.getByText("画像のURLを貼る", { exact: false })).toBeVisible();
  });

  test("区切り線は線として描かれる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "———", "divider")] });
    await toPages(page);
    await expect(page.locator('[data-task-id] [role="separator"]')).toHaveCount(1);
  });
});

test.describe("ブロックメニュー", () => {
  test("Esc で閉じる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "もと")] });
    await toPages(page);
    await row(page, "もと").hover();
    await row(page, "もと").locator('span[title="ドラッグで移動／クリックでメニュー"]').click();
    await expect(page.locator("[data-block-menu]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-block-menu]")).toHaveCount(0);
  });

  test("「リンクをコピー」がある", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "もと")] });
    await toPages(page);
    await row(page, "もと").hover();
    await row(page, "もと").locator('span[title="ドラッグで移動／クリックでメニュー"]').click();
    await expect(page.locator("[data-block-menu]").getByText("リンクをコピー")).toBeVisible();
  });
});
