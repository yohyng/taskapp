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

// Quietliner の操作に合わせた分
test.describe("Quietliner と同じ操作", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "いち" },
      { id: "b", text: "に", children: [{ id: "b1", text: "にの子" }] },
      { id: "c", text: "さん" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const row = (page, id) => page.locator(`[data-row="${id}"]`);
  const clickText = (page, id) => row(page, id).locator("[data-row-text]").click();

  test("Ctrl+Enter で完了になり、取り消せる", async ({ page }) => {
    await clickText(page, "a");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(row(page, "a")).toHaveAttribute("data-completed", "true");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(row(page, "a")).toHaveAttribute("data-completed", "false");
  });

  test("Ctrl+. で畳める", async ({ page }) => {
    await clickText(page, "b");
    await page.keyboard.press("ControlOrMeta+.");
    expect(await shape(page)).toEqual(["いち", "に", "さん"]);
  });

  test("Alt+↑ で行ごと入れ替わる（子も連れていく）", async ({ page }) => {
    await clickText(page, "b");
    await page.keyboard.press("Alt+ArrowUp");
    expect(await shape(page)).toEqual(["に", "  にの子", "いち", "さん"]);
  });

  test("空の行で Backspace すると消え、前の行に移る", async ({ page }) => {
    await clickText(page, "c");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace"); // 文字を消す
    await page.keyboard.press("Backspace"); // 行を消す
    expect(await shape(page)).toEqual(["いち", "に", "  にの子"]);
  });

  test("子のいる行を空にして消すと、子は残る", async ({ page }) => {
    await clickText(page, "b");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    expect(await shape(page)).toEqual(["いち", "にの子", "さん"]);
  });

  test("行末の Delete で、次の行が繋がる", async ({ page }) => {
    await clickText(page, "b1");
    await page.keyboard.press("End");
    await page.keyboard.press("Delete");
    expect(await shape(page)).toEqual(["いち", "に", "  にの子さん"]);
  });

  test("次の行が子を持っているときは、Delete で繋げない", async ({ page }) => {
    // 中身の行き場が無くなるので、Quietliner と同じく何もしない
    await clickText(page, "a");
    await page.keyboard.press("End");
    await page.keyboard.press("Delete");
    expect(await shape(page)).toEqual(["いち", "に", "  にの子", "さん"]);
  });

  test("← → でも行をまたげる", async ({ page }) => {
    await clickText(page, "a");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("X");
    expect(await shape(page)).toEqual(["いち", "Xに", "  にの子", "さん"]);
  });

  test("メニューから完了・お気に入り・削除ができる", async ({ page }) => {
    await row(page, "a").hover();
    await page.locator('[data-row-menu="a"]').click();
    await page.getByRole("button", { name: "完了にする" }).click();
    await expect(row(page, "a")).toHaveAttribute("data-completed", "true");

    await page.locator('[data-row-menu="a"]').click();
    await page.getByRole("button", { name: "お気に入り" }).click();
    await expect(row(page, "a").locator("svg.fill-amber-300")).toBeVisible();

    await page.locator('[data-row-menu="a"]').click();
    await page.locator("[data-row-delete]").click();
    expect(await shape(page)).toEqual(["に", "  にの子", "さん"]);
  });

  test("見出しにすると大きくなる", async ({ page }) => {
    const size = async () => row(page, "a").locator("[data-row-text]")
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    const before = await size();
    await row(page, "a").hover();
    await page.locator('[data-row-menu="a"]').click();
    await page.locator('[data-heading-chip="1"]').click();
    await expect(row(page, "a")).toHaveAttribute("data-heading", "1");
    expect(await size()).toBeGreaterThan(before * 1.4);
  });

  test("文字色と背景色を選べる", async ({ page }) => {
    await row(page, "a").hover();
    await page.locator('[data-row-menu="a"]').click();
    await page.locator('[data-text-color="#e03535"]').click();
    await expect(row(page, "a").locator("[data-row-text]"))
      .toHaveCSS("color", "rgb(224, 53, 53)");

    await page.locator('[data-bg-color="rgba(50,130,255,0.10)"]').click();
    await expect(row(page, "a")).toHaveCSS("background-color", "rgba(50, 130, 255, 0.1)");
  });

  test("ズームの題で Enter すると、いちばん上の子ができる", async ({ page }) => {
    await page.locator('[data-zoom="b"]').click();
    await page.locator("[data-zoom-title]").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("あたま");
    await page.keyboard.press("Escape");
    expect(await shape(page)).toEqual(["あたま", "にの子"]);
  });

  test("ズームの題から ↓ で中に降りる", async ({ page }) => {
    await page.locator('[data-zoom="b"]').click();
    await page.locator("[data-zoom-title]").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("！");
    expect(await shape(page)).toEqual(["！にの子"]);
  });

  test("文字数が出る", async ({ page }) => {
    await row(page, "b").hover();
    await expect(row(page, "b").locator("[data-chars]")).toHaveText("4"); // に + にの子
  });
});
