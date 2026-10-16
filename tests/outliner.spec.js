import { test, expect } from "./helpers.js";

const tab = (page, key) => page.locator(`[data-app-tab="${key}"]`);
const outline = (page) => page.locator("[data-outliner]");
const rows = (page) => page.locator("[data-row]");
// 画面に出ている行を「深さぶんの字下げ＋文字」で読む
const shape = (page) => page.evaluate(() =>
  [...document.querySelectorAll("[data-row]")].map((e) => {
    const t = e.querySelector("[data-row-text]");
    const text = t?.tagName === "TEXTAREA" ? t.value : (t?.textContent || "").trim();
    return "  ".repeat(Number(e.getAttribute("data-depth"))) + text;
  }));
const open = async (page) => { await tab(page, "outline").click(); await expect(outline(page)).toBeVisible(); };
const write = async (page, text) => { await page.keyboard.type(text); };

test.describe("ページの切り替え", () => {
  test("タブでアウトラインに移れる", async ({ page }) => {
    await expect(outline(page)).toHaveCount(0);
    await open(page);
    // タスク側は隠れている
    await expect(page.locator("[data-task-id]").first()).toBeHidden();
  });

  test("戻るとタスクがそのまま出ている", async ({ page }) => {
    await open(page);
    await tab(page, "tasks").click();
    await expect(outline(page)).toHaveCount(0);
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("どちらを見ていたか覚えている", async ({ page }) => {
    await open(page);
    await page.reload();
    await page.waitForSelector("header");
    await expect(outline(page)).toBeVisible();
  });
});

test.describe("アウトラインを書く", () => {
  // 空の1行だけから始める（初回の案内文に邪魔されないように）
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("taskspace-outline-v1")) {
        localStorage.setItem("taskspace-outline-v1", JSON.stringify([{ id: "one", text: "" }]));
      }
    });
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  const first = (page) => page.locator("[data-row] [data-row-text]").first();

  test("クリックで書き始められる", async ({ page }) => {
    await first(page).click();
    await write(page, "あたらしい行");
    await page.keyboard.press("Escape");
    await expect(page.getByText("あたらしい行")).toBeVisible();
  });

  test("Enter で次の行、Tab で字下げ", async ({ page }) => {
    await first(page).click();
    await write(page, "おや");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await write(page, "こ");
    await page.keyboard.press("Enter");
    await write(page, "こ2");
    await page.keyboard.press("Escape");

    expect(await shape(page)).toEqual(expect.arrayContaining(["おや", "  こ", "  こ2"]));
  });

  test("Shift+Tab で戻せる", async ({ page }) => {
    await first(page).click();
    await write(page, "おや");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await write(page, "こ");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Escape");
    expect(await shape(page)).toEqual(expect.arrayContaining(["おや", "こ"]));
  });

  test("行の途中で Enter すると、後ろ半分が次の行になる", async ({ page }) => {
    await first(page).click();
    await write(page, "まえうしろ");
    await page.keyboard.press("Home");
    for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(await shape(page)).toEqual(["まえ", "うしろ"]);
  });

  test("行頭の Backspace で、前の行とくっつく", async ({ page }) => {
    await first(page).click();
    await write(page, "あい");
    await page.keyboard.press("Enter");
    await write(page, "うえ");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    expect(await shape(page)).toEqual(["あいうえ"]);
  });

  test("書いたものは読み直しても残る", async ({ page }) => {
    await first(page).click();
    await write(page, "のこるはず");
    await page.keyboard.press("Escape");

    // フィクスチャの仕込みが入らない、まっさらな窓で開き直す
    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("[data-outliner]");
    await expect(fresh.getByText("のこるはず")).toBeVisible();
    await fresh.close();
  });
});

test.describe("畳む・中に入る", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "親", children: [
        { id: "a1", text: "子1", children: [{ id: "a1a", text: "孫" }] },
        { id: "a2", text: "子2" },
      ] },
      { id: "b", text: "となり" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  test("▼ で畳むと、中が隠れる", async ({ page }) => {
    expect(await shape(page)).toEqual(["親", "  子1", "    孫", "  子2", "となり"]);
    await page.locator('[data-fold="a"]').click();
    expect(await shape(page)).toEqual(["親", "となり"]);
  });

  test("● を押すと、その中に入る", async ({ page }) => {
    await page.locator('[data-zoom="a1"]').click();
    await expect(page.locator("[data-zoom-title]")).toHaveText("子1");
    expect(await shape(page)).toEqual(["孫"]);
  });

  test("パンくずで戻れる", async ({ page }) => {
    await page.locator('[data-zoom="a1"]').click();
    await page.locator("[data-crumb]", { hasText: "親" }).click();
    await expect(page.locator("[data-zoom-title]")).toHaveText("親");

    await page.getByRole("button", { name: "ホーム" }).click();
    await expect(page.locator("[data-zoom-title]")).toHaveCount(0);
    expect(await shape(page)).toContain("となり");
  });

  test("中に入ったまま書き足せる", async ({ page }) => {
    await page.locator('[data-zoom="a1"]').click();
    await page.locator("[data-outline-add]").click();
    await page.keyboard.type("中で足す");
    await page.keyboard.press("Escape");
    expect(await shape(page)).toEqual(["孫", "中で足す"]);

    // ホームに戻ると、子1 の中に入っている
    await page.getByRole("button", { name: "ホーム" }).click();
    expect(await shape(page)).toEqual(["親", "  子1", "    孫", "    中で足す", "  子2", "となり"]);
  });
});
