import { test, expect } from "./helpers.js";

// 枠（ペイン）の中身を切り替えて、アウトラインを出す
const setMode = (page, key, i = 0) => page.locator("[data-pane-mode]").nth(i).selectOption(key);
const outline = (page) => page.locator("[data-outliner]");
// 画面に出ている行を「深さぶんの字下げ＋文字」で読む
const shape = (page) => page.evaluate(() =>
  [...document.querySelectorAll("[data-row]")].map((e) => {
    const t = e.querySelector("[data-row-text]");
    const text = t?.tagName === "TEXTAREA" ? t.value : (t?.textContent || "").trim();
    return "  ".repeat(Number(e.getAttribute("data-depth"))) + text;
  }));
const open = async (page) => { await setMode(page, "outline"); await expect(outline(page)).toBeVisible(); };
const write = async (page, text) => { await page.keyboard.type(text); };

test.describe("枠の中身の切り替え", () => {
  test("枠の中身をアウトラインにできる", async ({ page }) => {
    await expect(outline(page)).toHaveCount(0);
    await open(page);
    // タスク側は出ていない
    await expect(page.locator("[data-task-id]")).toHaveCount(0);
  });

  test("戻すとタスクがそのまま出ている", async ({ page }) => {
    await open(page);
    await setMode(page, "tasks");
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
    // この窓では毎回ここから始める（読み直しの試験は別の窓で見る）
    await page.addInitScript(() =>
      localStorage.setItem("taskspace-outline-v1", JSON.stringify([{ id: "one", text: "" }])));
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

test.describe("探す", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "買いもの", children: [{ id: "a1", text: "牛乳" }, { id: "a2", text: "パン" }] },
      { id: "b", text: "仕事", children: [{ id: "b1", text: "資料づくり", children: [{ id: "b2", text: "牛乳の件 #memo" }] }] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const search = (page) => page.locator("[data-outline-search]");

  test("当たった行と、その親だけが残る", async ({ page }) => {
    await search(page).fill("牛乳");
    expect(await shape(page)).toEqual(["買いもの", "  牛乳", "仕事", "  資料づくり", "    牛乳の件 #memo"]);
    await expect(page.locator("[data-search-count]")).toHaveText("5件");
  });

  test("当たったところに印がつく", async ({ page }) => {
    await search(page).fill("牛乳");
    await expect(page.locator("mark", { hasText: "牛乳" }).first()).toBeVisible();
  });

  test("#タグでも絞れる", async ({ page }) => {
    await search(page).fill("#memo");
    expect(await shape(page)).toEqual(["仕事", "  資料づくり", "    牛乳の件 #memo"]);
  });

  test("見つからないときは、そう言う", async ({ page }) => {
    await search(page).fill("ありません");
    await expect(page.locator("[data-search-count]")).toHaveText("見つかりませんでした");
  });

  test("消せば元に戻る", async ({ page }) => {
    await search(page).fill("牛乳");
    await page.locator("[data-search-clear]").click();
    expect(await shape(page)).toEqual(["買いもの", "  牛乳", "  パン", "仕事", "  資料づくり", "    牛乳の件 #memo"]);
  });

  test("⌘K で探す欄に移る", async ({ page }) => {
    await page.locator("[data-row] [data-row-text]").first().click();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(search(page)).toBeFocused();
  });

  test("Escape でやめる", async ({ page }) => {
    await search(page).fill("牛乳");
    await search(page).press("Escape");
    await expect(search(page)).toHaveValue("");
  });
});

test.describe("持ち込み・持ち出し", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "もとからある" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  const upload = (page, payload, name = "quietliner.json") =>
    page.locator("[data-outline-file]").setInputFiles({
      name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)),
    });

  test("Quietliner の書き出しを取り込める", async ({ page }) => {
    await upload(page, {
      schema: "quietliner.v1", appVersion: "5.11.2", version: 7696,
      items: [{ id: "u1", text: "もってきた", children: [{ id: "u2", text: "その子" }] }],
      settings: { rootTitle: "Notes" },
    });
    await expect.poll(() => shape(page)).toEqual(["もとからある", "もってきた", "  その子"]);
    await expect(page.locator("[data-outline-note]")).toContainText("2件を足した");
  });

  test("同じものを2回読んでも、増えない", async ({ page }) => {
    const payload = { items: [{ id: "u1", text: "もってきた", children: [{ id: "u2", text: "その子" }] }] };
    await upload(page, payload);
    await expect.poll(() => shape(page)).toEqual(["もとからある", "もってきた", "  その子"]);

    await upload(page, payload);
    await expect(page.locator("[data-outline-note]")).toContainText("2件を更新");
    expect(await shape(page)).toEqual(["もとからある", "もってきた", "  その子"]);
  });

  test("向こうで消した行は、取り込まない", async ({ page }) => {
    await upload(page, {
      items: [
        { id: "live", text: "いきてる" },
        { id: "gone", text: "けした", deletedAt: "2026-01-01T00:00:00Z" },
      ],
      deletedIds: [],
    });
    await expect.poll(() => shape(page)).toEqual(["もとからある", "いきてる"]);
    await expect(page.locator("[data-outline-note]")).toContainText("飛ばした");
  });

  test("取り込んだぶんも、元に戻せる", async ({ page }) => {
    await upload(page, { items: [{ id: "u1", text: "もってきた" }] });
    await expect.poll(() => shape(page)).toEqual(["もとからある", "もってきた"]);
    await page.locator("[data-outline-undo]").click();
    expect(await shape(page)).toEqual(["もとからある"]);
  });

  test("読めないものは、そう言って何も壊さない", async ({ page }) => {
    await page.locator("[data-outline-file]").setInputFiles({
      name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{ちがう"),
    });
    await expect(page.locator("[data-outline-note]")).toContainText("読めませんでした");
    expect(await shape(page)).toEqual(["もとからある"]);
  });

  test("アウトラインが入っていない JSON も、断る", async ({ page }) => {
    await page.locator("[data-outline-file]").setInputFiles({
      name: "other.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ hello: 1 })),
    });
    await expect(page.locator("[data-outline-note]")).toContainText("アウトラインが見つかりません");
  });

  test("書き出すと、JSON が落ちてくる", async ({ page }) => {
    const wait = page.waitForEvent("download");
    await page.locator("[data-outline-export]").click();
    const dl = await wait;
    expect(dl.suggestedFilename()).toMatch(/^outline-\d{4}-\d{2}-\d{2}\.json$/);

    const stream = await dl.createReadStream();
    const text = await new Promise((r) => { let s = ""; stream.on("data", (c) => (s += c)); stream.on("end", () => r(s)); });
    const parsed = JSON.parse(text);
    expect(parsed.items[0].text).toBe("もとからある");
  });
});

test.describe("ドラッグで動かす", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "A", children: [{ id: "a1", text: "A1" }, { id: "a2", text: "A2" }] },
      { id: "b", text: "B" },
      { id: "c", text: "C", children: [{ id: "c1", text: "C1" }] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  // ● を掴んで、相手の行の下側まで運ぶ
  const dragDot = async (page, id, targetId, dx = 0) => {
    const dot = await page.locator(`[data-zoom="${id}"]`).boundingBox();
    const to = await page.locator(`[data-row="${targetId}"]`).boundingBox();
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.mouse.down();
    await page.mouse.move(dot.x + dot.width / 2 + dx, to.y + to.height - 2, { steps: 8 });
    await page.mouse.up();
  };

  test("別の行の下へ運べる", async ({ page }) => {
    await dragDot(page, "b", "c1");
    expect(await shape(page)).toEqual(["A", "  A1", "  A2", "C", "  C1", "B"]);
  });

  test("右にずらしながら落とすと、その行の子になる", async ({ page }) => {
    await dragDot(page, "b", "c", 24);
    expect(await shape(page)).toEqual(["A", "  A1", "  A2", "C", "  B", "  C1"]);
  });

  test("子も一緒に動く", async ({ page }) => {
    await dragDot(page, "c", "a1");
    expect(await shape(page)).toEqual(["A", "  A1", "  C", "    C1", "  A2", "B"]);
  });

  test("運んでいるあいだ、落ちる場所に線が出る", async ({ page }) => {
    const dot = await page.locator('[data-zoom="b"]').boundingBox();
    const to = await page.locator('[data-row="c1"]').boundingBox();
    await page.mouse.move(dot.x + 3, dot.y + 3);
    await page.mouse.down();
    await page.mouse.move(dot.x + 3, to.y + to.height - 2, { steps: 6 });
    await expect(page.locator("[data-drop-line]")).toBeVisible();
    await expect(page.locator('[data-row="b"]')).toHaveAttribute("data-dragging", "true");
    await page.mouse.up();
    await expect(page.locator("[data-drop-line]")).toHaveCount(0);
  });

  test("動かさずに離せば、これまで通りズームする", async ({ page }) => {
    await page.locator('[data-zoom="a"]').click();
    await expect(page.locator("[data-zoom-title]")).toHaveValue("A");
  });

  test("自分の中には落とせない", async ({ page }) => {
    await dragDot(page, "a", "a1", 24);
    expect(await shape(page)).toEqual(["A", "  A1", "  A2", "B", "C", "  C1"]);
  });
});

test.describe("元に戻す・やり直す", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "A", children: [{ id: "a1", text: "A1" }] },
      { id: "b", text: "B" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const undo = (page) => page.locator("[data-outline-undo]");
  const redo = (page) => page.locator("[data-outline-redo]");

  test("はじめは押せない", async ({ page }) => {
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
  });

  test("消した行が戻る", async ({ page }) => {
    await page.locator('[data-row="b"]').hover();
    await page.locator('[data-row-menu="b"]').click();
    await page.locator("[data-row-delete]").click();
    expect(await shape(page)).toEqual(["A", "  A1"]);

    await undo(page).click();
    expect(await shape(page)).toEqual(["A", "  A1", "B"]);
  });

  test("字下げが戻る", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.press("Tab");
    expect(await shape(page)).toEqual(["A", "  A1", "  B"]);

    await page.keyboard.press("ControlOrMeta+z");
    expect(await shape(page)).toEqual(["A", "  A1", "B"]);
  });

  test("打った文字は、ひとまとめで戻る", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.press("End");
    await page.keyboard.type("ぶんしょう");
    expect(await shape(page)).toEqual(["A", "  A1", "Bぶんしょう"]);

    // 1文字ずつではなく、打ったぶんがまとめて戻る
    await page.keyboard.press("ControlOrMeta+z");
    expect(await shape(page)).toEqual(["A", "  A1", "B"]);
  });

  test("やり直せる", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await shape(page)).toEqual(["A", "  A1", "B"]);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(await shape(page)).toEqual(["A", "  A1", "  B"]);
  });

  test("タスク側の取り消しを巻き添えにしない", async ({ page }) => {
    const before = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("notion-like-taskdb-prototype-v4")).tasks.length);

    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+z");

    const after = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("notion-like-taskdb-prototype-v4")).tasks.length);
    expect(after).toBe(before);
  });

  test("ドラッグした移動も戻る", async ({ page }) => {
    const dot = await page.locator('[data-zoom="b"]').boundingBox();
    const to = await page.locator('[data-row="a1"]').boundingBox();
    // 右にずらしながら落として、A の子にする
    await page.mouse.move(dot.x + 3, dot.y + 3);
    await page.mouse.down();
    await page.mouse.move(dot.x + 27, to.y + to.height - 2, { steps: 8 });
    await page.mouse.up();
    expect(await shape(page)).toEqual(["A", "  A1", "  B"]);

    await undo(page).click();
    expect(await shape(page)).toEqual(["A", "  A1", "B"]);
  });
});

test.describe("畳むつまみ", () => {
  test("ホバーしなくても見えている", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "おや", children: [{ id: "a1", text: "こ" }] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    const fold = page.locator('[data-fold="a"]');
    await expect(fold).toBeVisible();
    const op = await fold.evaluate((e) => parseFloat(getComputedStyle(e).opacity));
    expect(op).toBeGreaterThan(0.2);

    await fold.click();
    expect(await shape(page)).toEqual(["おや"]);
  });
});

test.describe("まとめて選ぶ", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }, { id: "d", text: "D" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const text = (page, id) => page.locator(`[data-row="${id}"] [data-row-text]`);
  const pickedIds = (page) => page.evaluate(() =>
    [...document.querySelectorAll("[data-picked]")].map((e) => e.getAttribute("data-row")));

  test("Shift+クリックで、あいだをまとめて選ぶ", async ({ page }) => {
    await text(page, "a").click();
    await text(page, "c").click({ modifiers: ["Shift"] });
    expect(await pickedIds(page)).toEqual(["a", "b", "c"]);
    await expect(page.locator("[data-pick-bar]")).toContainText("3件");
  });

  test("⌘クリックで、飛び飛びに選ぶ", async ({ page }) => {
    await text(page, "a").click({ modifiers: ["ControlOrMeta"] });
    await text(page, "c").click({ modifiers: ["ControlOrMeta"] });
    expect(await pickedIds(page)).toEqual(["a", "c"]);
  });

  test("Shift+↓ でも広がる", async ({ page }) => {
    await text(page, "a").click();
    await page.keyboard.press("Shift+ArrowDown");
    expect(await pickedIds(page)).toEqual(["a", "b"]);
  });

  test("まとめて字下げ・戻しができる", async ({ page }) => {
    await text(page, "b").click();
    await text(page, "c").click({ modifiers: ["Shift"] });
    await page.locator("[data-pick-indent]").click();
    expect(await shape(page)).toEqual(["A", "  B", "  C", "D"]);

    await page.locator("[data-pick-outdent]").click();
    expect(await shape(page)).toEqual(["A", "B", "C", "D"]);
  });

  test("Tab でもまとめて字下げできる", async ({ page }) => {
    await text(page, "b").click();
    await text(page, "c").click({ modifiers: ["Shift"] });
    await page.keyboard.press("Tab");
    expect(await shape(page)).toEqual(["A", "  B", "  C", "D"]);
  });

  test("まとめて完了にできる", async ({ page }) => {
    await text(page, "a").click();
    await text(page, "b").click({ modifiers: ["Shift"] });
    await page.locator("[data-pick-complete]").click();
    await expect(page.locator('[data-row="a"]')).toHaveAttribute("data-completed", "true");
    await expect(page.locator('[data-row="b"]')).toHaveAttribute("data-completed", "true");
    await expect(page.locator('[data-row="c"]')).toHaveAttribute("data-completed", "false");
  });

  test("まとめて消せる", async ({ page }) => {
    await text(page, "b").click();
    await text(page, "c").click({ modifiers: ["Shift"] });
    await page.locator("[data-pick-delete]").click();
    expect(await shape(page)).toEqual(["A", "D"]);
    await expect(page.locator("[data-pick-bar]")).toHaveCount(0);
  });

  test("Esc でやめられる", async ({ page }) => {
    await text(page, "a").click();
    await text(page, "c").click({ modifiers: ["Shift"] });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-pick-bar]")).toHaveCount(0);
    expect(await pickedIds(page)).toEqual([]);
  });

  test("ふつうのクリックで、選ぶのをやめて編集に入る", async ({ page }) => {
    await text(page, "a").click();
    await text(page, "c").click({ modifiers: ["Shift"] });
    await text(page, "d").click();
    expect(await pickedIds(page)).toEqual([]);
    await expect(page.locator('[data-row="d"] textarea')).toBeVisible();
  });

  test("まとめて消したのも、元に戻せる", async ({ page }) => {
    await text(page, "b").click();
    await text(page, "c").click({ modifiers: ["Shift"] });
    await page.locator("[data-pick-delete]").click();
    expect(await shape(page)).toEqual(["A", "D"]);
    await page.locator("[data-outline-undo]").click();
    expect(await shape(page)).toEqual(["A", "B", "C", "D"]);
  });
});

test.describe("お気に入り", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "ふつうの行" },
      { id: "b", text: "よく使う", favorite: true, children: [{ id: "b1", text: "中身" }] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  test("星をつけた行が、上に並ぶ", async ({ page }) => {
    await expect(page.locator("[data-favorites]")).toBeVisible();
    await expect(page.locator('[data-favorite="b"]')).toHaveText("よく使う");
  });

  test("押すと、その中に入る", async ({ page }) => {
    await page.locator('[data-favorite="b"]').click();
    await expect(page.locator("[data-zoom-title]")).toHaveValue("よく使う");
    expect(await shape(page)).toEqual(["中身"]);
  });

  test("星が無いときは、何も出さない", async ({ page }) => {
    await page.locator('[data-row="b"]').hover();
    await page.locator('[data-row-menu="b"]').click();
    await page.getByRole("button", { name: "お気に入り解除" }).click();
    await expect(page.locator("[data-favorites]")).toHaveCount(0);
  });
});

test.describe("#タグ", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "さきに #memo と #media" },
      { id: "b", text: "" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const hint = (page) => page.locator("[data-tag-hint]");

  test("タグに色が付く", async ({ page }) => {
    await expect(page.locator('[data-row="a"] [data-tag]').first()).toHaveText("#memo");
  });

  test("# を打つと、使ったことのあるタグが出る", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.type("これは #me");
    await expect(hint(page)).toBeVisible();
    await expect(page.locator("[data-tag-option]")).toHaveText(["#media", "#memo"]);
  });

  test("Tab で選べる", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.type("これは #me");
    await page.keyboard.press("Tab");
    await expect(hint(page)).toHaveCount(0);
    await expect(page.locator('[data-row="b"] textarea')).toHaveValue("これは #media ");
  });

  test("↓ で選び直して Enter", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.type("これは #me");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-row="b"] textarea')).toHaveValue("これは #memo ");
  });

  test("Escape で候補だけ閉じる（行は閉じない）", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.type("これは #me");
    await page.keyboard.press("Escape");
    await expect(hint(page)).toHaveCount(0);
    await expect(page.locator('[data-row="b"] textarea')).toBeVisible();
  });

  test("候補が無ければ出さない", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.type("これは #xyz");
    await expect(hint(page)).toHaveCount(0);
  });

  test("Enter は、候補が無ければこれまで通り改行", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.type("ふつうの行");
    await page.keyboard.press("Enter");
    await page.keyboard.type("つぎ");
    await page.keyboard.press("Escape");
    expect(await shape(page)).toEqual(["さきに #memo と #media", "ふつうの行", "つぎ"]);
  });

  test("押しても選べる", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.type("これは #me");
    await page.locator('[data-tag-option="memo"]').click();
    await expect(page.locator('[data-row="b"] textarea')).toHaveValue("これは #memo ");
  });

  test("#タグで絞り込める（探すと同じ）", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await page.keyboard.type("あたらしい #memo");
    await page.keyboard.press("Escape");
    await page.locator("[data-outline-search]").fill("#memo");
    expect(await shape(page)).toEqual(["さきに #memo と #media", "あたらしい #memo"]);
  });
});

test.describe("見た目の設定", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("taskspace-outline-v1", JSON.stringify(
        Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, text: `行${i}` }))));
    });
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const panel = (page) => page.locator("[data-view-panel]");
  const openPanel = (page) => page.locator("[data-outline-view]").click();
  const fontOf = (page) => page.locator('[data-row="n0"] [data-row-text]')
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));

  test("字を大きくできて、覚えている", async ({ page }) => {
    const before = await fontOf(page);
    await openPanel(page);
    await page.locator("[data-font-larger]").click();
    await page.locator("[data-font-larger]").click();
    expect(await fontOf(page)).toBeGreaterThan(before);

    await page.reload();
    await page.waitForSelector("[data-outliner]");
    expect(await fontOf(page)).toBeGreaterThan(before);
  });

  test("小さくもできる。行き過ぎない", async ({ page }) => {
    await openPanel(page);
    for (let i = 0; i < 10; i++) await page.locator("[data-font-smaller]").click();
    await expect(page.locator("[data-font-size]")).toHaveText("11px");
  });

  test("行揃えを変えられる", async ({ page }) => {
    await openPanel(page);
    await page.locator('[data-align="center"]').click();
    await expect(page.locator('[data-row="n0"] [data-row-text]')).toHaveCSS("text-align", "center");
  });

  test("タイプライターを入れると、書いている行が同じ高さに来る", async ({ page }) => {
    await openPanel(page);
    await page.locator("[data-typewriter]").click();
    await expect(page.locator("[data-typewriter]")).toContainText("ON");
    await page.keyboard.press("Escape");

    const whereIsEditing = async () => page.evaluate(() => {
      const row = document.querySelector("[data-row] textarea")?.closest("[data-row]");
      const pane = document.querySelector("[data-pane-id]");
      if (!row || !pane) return null;
      const r = row.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      return (r.top + r.height / 2 - p.top) / p.height;
    });

    // 真ん中あたりの行をいくつか。どれも同じ高さに来る
    // （いちばん上の数行は、それより上に送れないので対象にしない）
    // 移動は次の描画で行うので、クリック直後ではなく配置が整ってから測る。
    await page.locator('[data-row="n15"] [data-row-text]').click();
    await expect.poll(async () => {
      const position = await whereIsEditing(page);
      return position === null ? Infinity : Math.abs(position - 0.6);
    }).toBeLessThan(0.12);
    const a = await whereIsEditing(page);
    await page.locator('[data-row="n30"] [data-row-text]').click();
    await expect.poll(async () => {
      const position = await whereIsEditing(page);
      return position === null ? Infinity : Math.abs(position - a);
    }).toBeLessThan(0.1);
    const b = await whereIsEditing(page);

    expect(a).not.toBeNull();
    expect(Math.abs(a - 0.6)).toBeLessThan(0.12);
    expect(Math.abs(b - a)).toBeLessThan(0.1);
  });

  test("切っておけば、勝手に送らない", async ({ page }) => {
    const pane = page.locator("[data-pane-id]").first();
    await pane.evaluate((e) => { e.scrollTop = 0; });
    await page.locator('[data-row="n2"] [data-row-text]').click();
    expect(await pane.evaluate((e) => e.scrollTop)).toBe(0);
  });
});

// レビューで見つかった不具合の、戻り止め
test.describe("直したところ", () => {
  test("色と見出しは、読み直しても残る", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "みだし", headingLevel: 1, textColor: "#e03535", bgColor: "rgba(50,130,255,0.10)" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    await expect(page.locator('[data-row="a"]')).toHaveAttribute("data-heading", "1");
    await expect(page.locator('[data-row="a"] [data-row-text]')).toHaveCSS("color", "rgb(224, 53, 53)");
    await expect(page.locator('[data-row="a"]')).toHaveCSS("background-color", "rgba(50, 130, 255, 0.1)");

    // 書き込みで壊れないこと（保存したものを読み直す）
    await page.locator('[data-row="a"] [data-row-text]').click();
    await page.keyboard.type("！");
    await page.keyboard.press("Escape");
    const saved = await page.evaluate(() => ((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1")))[0]);
    expect(saved).toMatchObject({ headingLevel: 1, textColor: "#e03535" });
  });

  test("タグだけの行にも色が付く", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "#memo" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await expect(page.locator('[data-row="a"] [data-tag]')).toHaveText("#memo");
  });

  test("探している最中は、見えていない行とくっつけない", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "あたり1" },
      { id: "b", text: "よそもの" },
      { id: "c", text: "あたり2" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    await page.locator("[data-outline-search]").fill("あたり");
    expect(await shape(page)).toEqual(["あたり1", "あたり2"]);

    await page.locator('[data-row="c"] [data-row-text]').click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");

    // 画面に無い「よそもの」に混ざっていないこと
    const all = await page.evaluate(() => ((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1"))).map((x) => x.text));
    expect(all).toEqual(["あたり1", "よそもの", "あたり2"]);
  });
});

test.describe("ほかのアプリから取り込む", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "keep", text: "もとからある" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const put = (page, name, body, mimeType = "text/plain") =>
    page.locator("[data-outline-file]").setInputFiles({ name, mimeType, buffer: Buffer.from(body) });
  // 取り込んだぶんは畳んで入るので、置いてある中身のほうを見る
  const tree = (page) => page.evaluate(() => {
    const walk = (ns, d = 0) => ns.flatMap((n) => ["  ".repeat(d) + n.text, ...walk(n.children || [], d + 1)]);
    return walk(((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1"))));
  });

  test("WorkFlowy の .md（字下げの箇条書き）を読める", async ({ page }) => {
    await put(page, "WF.md", [
      "Home", "",
      "- 2025",
      "  - TRAY",
      "    - メモひとつ",
      "  - TASK LIST",
      "    - [ ] やること",
      "    - [x] おわったこと",
    ].join("\n"), "text/markdown");

    await expect.poll(() => tree(page)).toEqual([
      "もとからある", "2025", "  TRAY", "    メモひとつ", "  TASK LIST", "    やること", "    おわったこと",
    ]);
    // 画面には、畳まれた根だけが出る
    expect(await shape(page)).toEqual(["もとからある", "2025"]);
    // 題（Home）は入れ物にしない。チェック済みは完了として入る。
    const done = await page.evaluate(() => {
      const find = (ns) => ns.flatMap((n) => [n, ...find(n.children || [])]);
      return find(((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1")))).filter((n) => n.completed).map((n) => n.text);
    });
    expect(done).toEqual(["おわったこと"]);
  });

  test("同じ .md を2回読んでも増えない", async ({ page }) => {
    const md = ["Home", "", "- 2025", "  - メモ", "  - メモ"].join("\n");
    await put(page, "WF.md", md, "text/markdown");
    await expect.poll(() => tree(page)).toEqual(["もとからある", "2025", "  メモ", "  メモ"]);

    await put(page, "WF.md", md, "text/markdown");
    await expect(page.locator("[data-outline-note]")).toContainText("既にあった");
    expect(await tree(page)).toEqual(["もとからある", "2025", "  メモ", "  メモ"]);
  });

  test("WorkFlowy の .html を読める", async ({ page }) => {
    await put(page, "WF.html", `
      <span class="name"><span class="innerContentContainer">Home</span></span>
      <ul>
        <li><div class="name" data-chid="aa"><span class="innerContentContainer">2025</span></div>
          <ul><li><div class="name" data-chid="bb"><span class="innerContentContainer"><b>TRAY</b></span></div></li></ul>
        </li>
      </ul>`, "text/html");

    await expect.poll(() => tree(page)).toEqual(["もとからある", "2025", "  TRAY"]);
  });

  test("Notion の .md は、見出しの下に入れ子になる", async ({ page }) => {
    await put(page, "Note.md", [
      "# Note", "",
      "## NOMLAB NOTE", "",
      "- 打ち合わせ",
      "    - 決まったこと",
      "", "## Work", "",
      "- べつの話",
    ].join("\n"), "text/markdown");

    await expect.poll(() => tree(page)).toEqual([
      "もとからある", "Note", "  NOMLAB NOTE", "    打ち合わせ", "      決まったこと", "  Work", "    べつの話",
    ]);
  });

  test("Notion の .zip（中の .md）を読める", async ({ page }) => {
    // ほどかずに入れた zip（method 0）。中身は Notion の書き出しと同じ形。
    const zip = await page.evaluate(async () => {
      const body = new TextEncoder().encode("# Note\n\n## 章\n\n- 中身\n");
      const name = new TextEncoder().encode("Note.md");
      const crcTable = [...Array(256)].map((_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
      });
      let crc = 0xffffffff;
      for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
      crc = (crc ^ 0xffffffff) >>> 0;

      const parts = [];
      const u32 = (v) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v, true); return a; };
      const u16 = (v) => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, v, true); return a; };
      // ローカルヘッダ
      parts.push(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(body.length), u32(body.length), u16(name.length), u16(0), name, body);
      const localSize = parts.reduce((n, p) => n + p.length, 0);
      // 中央ディレクトリ
      const cd = [u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(body.length), u32(body.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name];
      const cdSize = cd.reduce((n, p) => n + p.length, 0);
      const eocd = [u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cdSize), u32(localSize), u16(0)];
      const all = [...parts, ...cd, ...eocd];
      const total = all.reduce((n, p) => n + p.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const p of all) { out.set(p, at); at += p.length; }
      return [...out];
    });

    await page.locator("[data-outline-file]").setInputFiles({
      name: "notion.zip", mimeType: "application/zip", buffer: Buffer.from(zip),
    });
    await expect.poll(() => tree(page)).toEqual(["もとからある", "Note", "  章", "    中身"]);
    await expect(page.locator("[data-outline-note]")).toContainText("zip の中の 1 ファイル");
  });

  test("読めないものは、理由を出して何も壊さない", async ({ page }) => {
    await put(page, "bad.zip", "これは zip ではない", "application/zip");
    await expect(page.locator("[data-outline-note]")).toContainText("読めませんでした");
    expect(await shape(page)).toEqual(["もとからある"]);
  });
});

test.describe("なぞって選ぶ", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }, { id: "d", text: "D" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const pickedIds = (page) => page.evaluate(() =>
    [...document.querySelectorAll("[data-picked]")].map((e) => e.getAttribute("data-row")));
  const rowBox = (page, id) => page.locator(`[data-row="${id}"]`).boundingBox();

  test("余白から下へなぞると、通った行が選ばれる", async ({ page }) => {
    const a = await rowBox(page, "a");
    const c = await rowBox(page, "c");
    // 行の右側の余白から始める
    await page.mouse.move(a.x + a.width - 8, a.y + 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width - 8, c.y + c.height - 2, { steps: 8 });
    await expect(page.locator("[data-select-band]")).toBeVisible();
    await page.mouse.up();

    expect(await pickedIds(page)).toEqual(["a", "b", "c"]);
    await expect(page.locator("[data-pick-bar]")).toContainText("3件");
  });

  test("離すと枠は消え、選んだままになる", async ({ page }) => {
    const a = await rowBox(page, "a");
    const b = await rowBox(page, "b");
    await page.mouse.move(a.x + a.width - 8, a.y + 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width - 8, b.y + b.height - 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator("[data-select-band]")).toHaveCount(0);
    expect(await pickedIds(page)).toEqual(["a", "b"]);
  });

  test("文字の上から始めても、ほかの行にまたげば選択になる", async ({ page }) => {
    const a = await page.locator('[data-row="a"] [data-row-text]').boundingBox();
    const c = await rowBox(page, "c");
    await page.mouse.move(a.x + 4, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 4, c.y + c.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(await pickedIds(page)).toEqual(["a", "b", "c"]);
  });

  test("同じ行の中で動かすだけなら、選択にならない（文字を選べる）", async ({ page }) => {
    // 文字そのものの上から始める（行の左端は、なぞり始めの余白）
    const t = await page.locator('[data-row="a"] [data-row-text]').boundingBox();
    await page.mouse.move(t.x + 4, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 40, t.y + t.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await pickedIds(page)).toEqual([]);
  });

  test("なぞったあと、まとめて字下げできる", async ({ page }) => {
    const b = await rowBox(page, "b");
    const c = await rowBox(page, "c");
    await page.mouse.move(b.x + b.width - 8, b.y + 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 8, c.y + c.height - 2, { steps: 6 });
    await page.mouse.up();
    await page.locator("[data-pick-indent]").click();
    expect(await shape(page)).toEqual(["A", "  B", "  C", "D"]);
  });
});

// 保存まわりの戻り止め。「リロードしたら一部消えていた」への手当て。
test.describe("保存して読み直す", () => {
  const seed = (page, items) => page.addInitScript((data) =>
    localStorage.setItem("taskspace-outline-v1", JSON.stringify(data)), items);
  const reopen = async (page) => {
    // フィクスチャの仕込みが効かない、まっさらな窓で開き直す
    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("header");
    await fresh.locator("[data-pane-mode]").first().selectOption("outline");
    await fresh.waitForSelector("[data-outliner]");
    return fresh;
  };
  const shapeOf = (p) => p.evaluate(() =>
    [...document.querySelectorAll("[data-row]")].map((e) => {
      const t = e.querySelector("[data-row-text]");
      return "  ".repeat(Number(e.getAttribute("data-depth"))) + (t?.textContent || "").trim();
    }));

  test("消して取り消した行は、読み直しても残る", async ({ page }) => {
    await seed(page, [{ id: "a", text: "のこす" }, { id: "b", text: "いちど消す" }]);
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    await page.locator('[data-row="b"]').hover();
    await page.locator('[data-row-menu="b"]').click();
    await page.locator("[data-row-delete]").click();
    expect(await shape(page)).toEqual(["のこす"]);

    await page.locator("[data-outline-undo]").click();
    expect(await shape(page)).toEqual(["のこす", "いちど消す"]);

    const fresh = await reopen(page);
    expect(await shapeOf(fresh)).toEqual(["のこす", "いちど消す"]);
    await fresh.close();
  });

  test("消した行は、読み直しても戻ってこない", async ({ page }) => {
    await seed(page, [{ id: "a", text: "のこす" }, { id: "b", text: "消す" }]);
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    await page.locator('[data-row="b"]').hover();
    await page.locator('[data-row-menu="b"]').click();
    await page.locator("[data-row-delete]").click();

    const fresh = await reopen(page);
    expect(await shapeOf(fresh)).toEqual(["のこす"]);
    await fresh.close();
  });

  test("取り込んだ行は、読み直しても残る", async ({ page }) => {
    await seed(page, [{ id: "a", text: "もとからある" }]);
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    await page.locator("[data-outline-file]").setInputFiles({
      name: "q.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ items: [{ id: "u1", text: "取り込んだ行" }] })),
    });
    await expect.poll(() => shape(page)).toEqual(["もとからある", "取り込んだ行"]);

    const fresh = await reopen(page);
    expect(await shapeOf(fresh)).toEqual(["もとからある", "取り込んだ行"]);
    await fresh.close();
  });

  test("消した行と同じ内容を取り込み直しても、残る", async ({ page }) => {
    await seed(page, [{ id: "a", text: "のこす" }, { id: "u1", text: "消してから取り込み直す" }]);
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    await page.locator('[data-row="u1"]').hover();
    await page.locator('[data-row-menu="u1"]').click();
    await page.locator("[data-row-delete]").click();
    expect(await shape(page)).toEqual(["のこす"]);

    await page.locator("[data-outline-file]").setInputFiles({
      name: "q.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ items: [{ id: "u1", text: "消してから取り込み直す" }] })),
    });
    await expect.poll(() => shape(page)).toEqual(["のこす", "消してから取り込み直す"]);

    const fresh = await reopen(page);
    expect(await shapeOf(fresh)).toEqual(["のこす", "消してから取り込み直す"]);
    await fresh.close();
  });

  test("書いた文字は、読み直しても残る", async ({ page }) => {
    await seed(page, [{ id: "a", text: "" }]);
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    await page.locator('[data-row="a"] [data-row-text]').click();
    await page.keyboard.type("ちゃんと保存される");
    await page.keyboard.press("Enter");
    await page.keyboard.type("つぎの行も");
    await page.keyboard.press("Escape");

    const fresh = await reopen(page);
    expect(await shapeOf(fresh)).toEqual(["ちゃんと保存される", "つぎの行も"]);
    await fresh.close();
  });
});

test.describe("なぞり選択が、送っても続く", () => {
  test.use({ viewport: { width: 1200, height: 600 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify(
      Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, text: `行${i}` })))));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const pickedCount = (page) => page.evaluate(() => document.querySelectorAll("[data-picked]").length);

  test("下の端で押さえていると、送りながら選び続ける", async ({ page }) => {
    const first = await page.locator('[data-row="n0"]').boundingBox();
    const pane = await page.locator("[data-pane-id]").first().boundingBox();

    await page.mouse.move(first.x + first.width - 8, first.y + 2);
    await page.mouse.down();
    // 枠の下の端まで引いて、そのまま押さえておく
    await page.mouse.move(first.x + first.width - 8, pane.y + pane.height - 10, { steps: 10 });
    const before = await pickedCount(page);
    await page.waitForTimeout(900);          // 送られるのを待つ
    const after = await pickedCount(page);
    await page.mouse.up();

    expect(before).toBeGreaterThan(5);
    expect(after).toBeGreaterThan(before + 5);   // 送ったぶん増えている
  });

  test("送って画面から出た行も、選ばれたまま", async ({ page }) => {
    const first = await page.locator('[data-row="n0"]').boundingBox();
    const pane = await page.locator("[data-pane-id]").first().boundingBox();

    await page.mouse.move(first.x + first.width - 8, first.y + 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width - 8, pane.y + pane.height - 10, { steps: 10 });
    await page.waitForTimeout(900);
    await page.mouse.up();

    // いちばん上の行は、もう画面の外に出ているかもしれないが選ばれている
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll("[data-picked]")].map((e) => e.getAttribute("data-row")));
    expect(ids).toContain("n0");
    expect(ids.length).toBeGreaterThan(12);
    await expect(page.locator("[data-pick-bar]")).toContainText(`${ids.length}件`);
  });

  test("選んだあと、まとめて消せる", async ({ page }) => {
    const first = await page.locator('[data-row="n0"]').boundingBox();
    const pane = await page.locator("[data-pane-id]").first().boundingBox();
    await page.mouse.move(first.x + first.width - 8, first.y + 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width - 8, pane.y + pane.height - 10, { steps: 10 });
    await page.waitForTimeout(700);
    await page.mouse.up();

    const picked = await pickedCount(page);
    await page.locator("[data-pick-delete]").click();
    await expect.poll(async () => (await page.locator("[data-row]").count())).toBe(60 - picked);
  });
});

// いまだけの口。使い終わったら、この describe ごと外す。
test.describe("ぜんぶ消す", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "A", children: [{ id: "a1", text: "A1" }] },
      { id: "b", text: "B" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const openPanel = (page) => page.locator("[data-outline-view]").click();
  const clear = (page) => page.locator("[data-outline-clear]");
  // 空の行は「空の行」という案内を出すので、置いてある中身のほうを見る
  const stored = (page) => page.evaluate(() =>
    ((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1"))).map((x) => x.text));

  test("一度押しただけでは消えない", async ({ page }) => {
    await openPanel(page);
    await clear(page).click();
    await expect(clear(page)).toContainText("もう一度押すと");
    expect(await shape(page)).toEqual(["A", "  A1", "B"]);
  });

  test("二度押すと、空になる", async ({ page }) => {
    await openPanel(page);
    await clear(page).click();
    await clear(page).click();
    await expect.poll(() => stored(page)).toEqual([""]);
    await expect(page.locator("[data-outline-note]")).toContainText("ぜんぶ消しました");
  });

  test("⌘Z で戻せる", async ({ page }) => {
    await openPanel(page);
    await clear(page).click();
    await clear(page).click();
    await expect.poll(() => stored(page)).toEqual([""]);

    await page.locator("[data-outline-undo]").click();
    expect(await shape(page)).toEqual(["A", "  A1", "B"]);
  });

  test("消したあと、読み直しても戻ってこない", async ({ page }) => {
    await openPanel(page);
    await clear(page).click();
    await clear(page).click();
    await expect.poll(() => stored(page)).toEqual([""]);

    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("header");
    await fresh.locator("[data-pane-mode]").first().selectOption("outline");
    await fresh.waitForSelector("[data-outliner]");
    expect(await fresh.evaluate(() =>
      ((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1"))).map((x) => x.text))).toEqual([""]);
    await fresh.close();
  });
});

test.describe("取り込んだ中身は畳んで入る", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "keep", text: "もとからある" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  test(".md は、畳んだ状態で入る", async ({ page }) => {
    await page.locator("[data-outline-file]").setInputFiles({
      name: "WF.md", mimeType: "text/markdown",
      buffer: Buffer.from(["Home", "", "- 2025", "  - TRAY", "    - メモ", "- 2024"].join("\n")),
    });

    // 見えているのは根だけ
    await expect.poll(() => shape(page)).toEqual(["もとからある", "2025", "2024"]);
    // 中身はちゃんと入っている
    const all = await page.evaluate(() => {
      const walk = (ns) => ns.flatMap((n) => [n.text, ...walk(n.children || [])]);
      return walk(((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1"))));
    });
    expect(all).toEqual(["もとからある", "2025", "TRAY", "メモ", "2024"]);
  });

  test("開けば中が出てくる", async ({ page }) => {
    await page.locator("[data-outline-file]").setInputFiles({
      name: "WF.md", mimeType: "text/markdown",
      buffer: Buffer.from(["Home", "", "- 2025", "  - TRAY"].join("\n")),
    });
    await expect.poll(() => shape(page)).toEqual(["もとからある", "2025"]);

    const id = await page.locator("[data-row]").last().getAttribute("data-row");
    await page.locator(`[data-fold="${id}"]`).click();
    expect(await shape(page)).toEqual(["もとからある", "2025", "  TRAY"]);
  });

  test("もとからある行の開き具合は、変わらない", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "2025", children: [{ id: "a1", text: "さきにあった" }] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    expect(await shape(page)).toEqual(["2025", "  さきにあった"]);

    await page.locator("[data-outline-file]").setInputFiles({
      name: "WF.md", mimeType: "text/markdown",
      buffer: Buffer.from(["Home", "", "- 2025", "  - あとから"].join("\n")),
    });
    // 開いたまま、中に足される
    await expect.poll(() => shape(page)).toEqual(["2025", "  さきにあった", "  あとから"]);
  });
});

test.describe("日付ビュー", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "y26", text: "2026", children: [
        { id: "m1", text: "2026/01", children: [
          { id: "d2", text: "2026/01/02", children: [{ id: "e1", text: "正月のこと" }] },
          { id: "d7", text: "2026/01/07", children: [{ id: "e2", text: "トークイベント" }] },
        ] },
      ] },
      { id: "y25", text: "2025", children: [
        { id: "m12", text: "2025/12", children: [{ id: "d24", text: "2025/12/24", children: [{ id: "e3", text: "クリスマス" }] }] },
      ] },
      { id: "tray", text: "TRAY", children: [{ id: "t1", text: "日付のないメモ" }] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const toggle = (page) => page.locator("[data-date-view]");

  test("押すと、年ごとに畳まれた形で並ぶ", async ({ page }) => {
    await toggle(page).click();
    expect(await shape(page)).toEqual(["2026", "2025", "日付なし"]);
  });

  test("年を開くと 月、月を開くと 日 が出る", async ({ page }) => {
    await toggle(page).click();
    await page.locator('[data-fold="date:2026"]').click();
    expect(await shape(page)).toEqual(["2026", "  2026/01", "2025", "日付なし"]);

    await page.locator('[data-fold="date:2026-01"]').click();
    expect(await shape(page)).toEqual([
      "2026", "  2026/01", "    2026/01/02", "      正月のこと",
      "    2026/01/07", "      トークイベント", "2025", "日付なし",
    ]);
  });

  test("年は新しい順、日付なしは最後", async ({ page }) => {
    await toggle(page).click();
    const rows = await shape(page);
    expect(rows.indexOf("2026")).toBeLessThan(rows.indexOf("2025"));
    expect(rows.at(-1)).toBe("日付なし");
  });

  test("元の並びは変わらない（戻せば元どおり）", async ({ page }) => {
    const before = await shape(page);
    await toggle(page).click();
    await toggle(page).click();
    expect(await shape(page)).toEqual(before);
    // 置いてある中身も、そのまま
    const stored = await page.evaluate(() =>
      ((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1"))).map((x) => x.text));
    expect(stored).toEqual(["2026", "2025", "TRAY"]);
  });

  test("日付ビューの中でも、文字は直せる", async ({ page }) => {
    await toggle(page).click();
    await page.locator('[data-fold="date:2026"]').click();
    await page.locator('[data-fold="date:2026-01"]').click();

    await page.locator('[data-row="e1"] [data-row-text]').click();
    await page.keyboard.press("End");
    await page.keyboard.type("！");
    await page.keyboard.press("Escape");

    const stored = await page.evaluate(() => {
      const walk = (ns) => ns.flatMap((n) => [n.text, ...walk(n.children || [])]);
      return walk(((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1"))));
    });
    expect(stored).toContain("正月のこと！");
  });

  test("日付の見出しは、動かしたり消したりできない", async ({ page }) => {
    await toggle(page).click();
    const head = page.locator('[data-row="date:2026"]');
    await head.hover();
    await expect(head.locator("[data-row-menu]")).toHaveCount(0);
  });
});

test.describe("入れ子の縦線", () => {
  test("深さのぶんだけ縦線が引かれる", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "おや", children: [{ id: "b", text: "こ", children: [{ id: "c", text: "まご" }] }] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);

    const widthOf = (id) => page.locator(`[data-row="${id}"]`)
      .evaluate((e) => getComputedStyle(e).backgroundSize);
    // 根は線なし、深くなるほど線の帯が広がる
    expect(await widthOf("a")).toBe("auto");
    expect(await widthOf("b")).toBe("20px 100%");
    expect(await widthOf("c")).toBe("40px 100%");
  });
});

test.describe("行ごとの日付（メタデータ）", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "日付つき", date: "2026-01-02" },
      { id: "b", text: "日付なし" },
      { id: "y", text: "2026", children: [
        { id: "m", text: "2026/03", children: [
          { id: "d", text: "2026/03/01", children: [{ id: "e", text: "その日のメモ" }] },
        ] },
      ] },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });
  const stored = (page, id) => page.evaluate((x) => {
    const walk = (ns) => ns.flatMap((n) => [n, ...walk(n.children || [])]);
    return walk(((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1")))).find((n) => n.id === x);
  }, id);

  test("持っている行には、日付が出る", async ({ page }) => {
    await expect(page.locator('[data-row="a"] [data-row-date]')).toHaveText("01/02");
    await expect(page.locator('[data-row="b"] [data-row-date]')).toHaveCount(0);
  });

  test("メニューから日付を付けられる", async ({ page }) => {
    await page.locator('[data-row="b"]').hover();
    await page.locator('[data-row-menu="b"]').click();
    await page.locator("[data-row-date-input]").fill("2026-05-05");
    await expect.poll(async () => (await stored(page, "b")).date).toBe("2026-05-05");
    await expect(page.locator('[data-row="b"] [data-row-date]')).toHaveText("05/05");
  });

  test("「今日」と「✕」も効く", async ({ page }) => {
    await page.locator('[data-row="b"]').hover();
    await page.locator('[data-row-menu="b"]').click();
    await page.locator("[data-row-date-today]").click();
    const today = new Date().toISOString().slice(0, 10);
    await expect.poll(async () => (await stored(page, "b")).date).toBe(today);

    await page.locator("[data-row-date-clear]").click();
    await expect.poll(async () => (await stored(page, "b")).date).toBe(null);
  });

  test("読み直しても、日付は残る", async ({ page }) => {
    await page.locator('[data-row="b"]').hover();
    await page.locator('[data-row-menu="b"]').click();
    await page.locator("[data-row-date-input]").fill("2026-07-07");
    await expect.poll(async () => (await stored(page, "b")).date).toBe("2026-07-07");

    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("header");
    await fresh.locator("[data-pane-mode]").first().selectOption("outline");
    await expect(fresh.locator('[data-row="b"] [data-row-date]')).toHaveText("07/07");
    await fresh.close();
  });

  test("見出しから、まとめて日付を割り当てられる", async ({ page }) => {
    expect((await stored(page, "e")).date).toBeFalsy();

    await page.locator("[data-outline-view]").click();
    await page.locator("[data-fill-dates]").click();

    await expect.poll(async () => (await stored(page, "e")).date).toBe("2026-03-01");
    // 手で入れてあったものは変えない
    expect((await stored(page, "a")).date).toBe("2026-01-02");
    await expect(page.locator("[data-outline-note]")).toContainText("日付を入れました");
  });

  test("まとめて割り当てたのも、元に戻せる", async ({ page }) => {
    await page.locator("[data-outline-view]").click();
    await page.locator("[data-fill-dates]").click();
    await expect.poll(async () => (await stored(page, "e")).date).toBe("2026-03-01");

    await page.keyboard.press("Escape");
    await page.locator("[data-outline-undo]").click();
    await expect.poll(async () => (await stored(page, "e")).date).toBeFalsy();
  });
});

test.describe("画像の行", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "ふつうのメモ" },
      { id: "b", text: `${location.origin}/icon-512.png` },
      { id: "c", text: "https://drive.google.com/file/d/1AbC-dEf/view?usp=sharing" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  test("画像の URL は、絵として出る", async ({ page }) => {
    await expect(page.locator('[data-row="b"] [data-row-image]'))
      .toHaveAttribute("src", new RegExp("/icon-512\\.png$"));
    await expect(page.locator('[data-row="a"] [data-row-image]')).toHaveCount(0);
  });

  test("ドライブの共有リンクも、そのまま貼れる", async ({ page }) => {
    await expect(page.locator('[data-row="c"] [data-row-image]'))
      .toHaveAttribute("src", "https://drive.google.com/thumbnail?id=1AbC-dEf&sz=w1600");
  });

  test("押しても絵のまま（文字に化けない）", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-text]').click();
    await expect(page.locator('[data-row="b"] textarea')).toHaveCount(0);
    await expect(page.locator('[data-row="b"] [data-row-image]')).toBeVisible();
  });

  test("URL は ⋯ から直せる", async ({ page }) => {
    await page.locator('[data-row="b"] [data-row-menu]').click();
    await page.locator('[data-row="b"] [data-row-edit-url]').click();
    await expect(page.locator('[data-row="b"] textarea')).toHaveValue(/icon-512\.png$/);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-row="b"] [data-row-image]')).toBeVisible();
  });

  test("ふつうの行には、URL を直す口は出ない", async ({ page }) => {
    await page.locator('[data-row="a"] [data-row-menu]').click();
    await expect(page.locator('[data-row="a"] [data-row-edit-url]')).toHaveCount(0);
  });

  // 絵が届くまで測らない（届く前は幅がほぼ 0 になる）
  const loaded = async (page) => {
    const img = page.locator('[data-row="b"] [data-row-image]');
    await expect.poll(async () => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
    return img;
  };

  test("右下を掴むと、大きさを変えられる", async ({ page }) => {
    const img = await loaded(page);
    const before = (await img.boundingBox()).width;
    const grip = page.locator('[data-row="b"] [data-image-resize]');
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const after = (await img.boundingBox()).width;
    expect(after).toBeLessThan(before - 40);
    // 幅は行の持ち物として残る（読み直しても、ほかの端末でも同じ大きさ）
    const kept = await page.evaluate(() =>
      ((saved) => Array.isArray(saved) ? saved : saved.nodes)(JSON.parse(localStorage.getItem("taskspace-outline-v1"))).find((n) => n.id === "b").imageWidth);
    expect(kept).toBeCloseTo(after, 0);
  });

  test("つまみを両押しすると、もとの大きさに戻る", async ({ page }) => {
    await loaded(page);
    const grip = page.locator('[data-row="b"] [data-image-resize]');
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + 1, box.y + 1);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + 1, { steps: 6 });
    await page.mouse.up();
    const small = (await page.locator('[data-row="b"] [data-row-image]').boundingBox()).width;
    await page.locator('[data-row="b"] [data-image-resize]').dblclick();
    expect((await page.locator('[data-row="b"] [data-row-image]').boundingBox()).width)
      .toBeGreaterThan(small);
  });

  test("貼り付けた直後から、絵になる", async ({ page }) => {
    await page.locator('[data-row="a"] [data-row-text]').click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("https://example.com/new.webp");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-row="a"] [data-row-image]')).toHaveAttribute("src", "https://example.com/new.webp");
  });
});

test.describe("何も無いときの始まり", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("taskspace-outline-v1"));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  test("案内の行は作らない（空の行がひとつだけ）", async ({ page }) => {
    await expect(page.locator("[data-row]")).toHaveCount(1);
    await expect(page.getByText("Quietliner", { exact: true })).toHaveCount(0);
  });

  test("入れ直しても、同じ1行のまま（増えない）", async ({ page }) => {
    const idOf = () => page.locator("[data-row]").first().getAttribute("data-row");
    const first = await idOf();
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await expect(page.locator("[data-row]")).toHaveCount(1);
    expect(await idOf()).toBe(first);
  });
});

test.describe("書くことに集中（イマーシブ）", () => {
  const gear = async (page) => {
    await page.locator("[data-outline-view]").click();
    await expect(page.locator("[data-view-panel]")).toBeVisible();
  };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify([
      { id: "a", text: "ひとつめ" },
      { id: "b", text: "ふたつめ" },
    ])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  test("はじめは OFF で、打っても何も消えない", async ({ page }) => {
    await page.locator('[data-row="a"] [data-row-text]').click();
    await page.keyboard.type("あ");
    await expect(page.locator("[data-outline-top]")).toBeVisible();
    await expect(page.locator("[data-outliner]")).not.toHaveAttribute("data-calm", "");
  });

  test("ON にして打つと、まわりが引っ込む", async ({ page }) => {
    await gear(page);
    await page.locator("[data-immersive]").click();
    await page.keyboard.press("Escape");
    await page.locator('[data-row="a"] [data-row-text]').click();
    await page.keyboard.type("しずかに");
    await expect(page.locator("[data-outliner]")).toHaveAttribute("data-calm", "");
    await expect(page.locator("[data-outline-top]")).toHaveCSS("opacity", "0");
    await expect(page.locator('[data-row="b"] [data-row-actions]')).toHaveCSS("opacity", "0");
  });

  test("打っている行は、はっきり出たまま", async ({ page }) => {
    await gear(page);
    await page.locator("[data-immersive]").click();
    await page.keyboard.press("Escape");
    await page.locator('[data-row="a"] [data-row-text]').click();
    await page.keyboard.type("ここ");
    await expect(page.locator('[data-row="a"]')).toHaveCSS("opacity", "1");
    await expect(page.locator('[data-row="b"]')).not.toHaveCSS("opacity", "1");
  });

  test("マウスを動かせば、すぐ戻る", async ({ page }) => {
    await gear(page);
    await page.locator("[data-immersive]").click();
    await page.keyboard.press("Escape");
    await page.locator('[data-row="a"] [data-row-text]').click();
    await page.keyboard.type("しずかに");
    await expect(page.locator("[data-outliner]")).toHaveAttribute("data-calm", "");
    await page.mouse.move(300, 300);
    await expect(page.locator("[data-outliner]")).not.toHaveAttribute("data-calm", "");
  });

  test("設定は覚えている", async ({ page }) => {
    await gear(page);
    await page.locator("[data-immersive]").click();
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await gear(page);
    await expect(page.locator("[data-immersive]")).toContainText("ON");
  });
});

test.describe("大きくて localStorage に入らないとき", () => {
  // 置ききれない状況を作る（setItem を断る）
  const refuseLocal = (page) => page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === "taskspace-outline-v1" && String(value).length > 200) {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      return real.call(this, key, value);
    };
  });

  test("IndexedDB に残り、開き直しても消えない", async ({ page }) => {
    await refuseLocal(page);
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await page.locator("[data-row] [data-row-text]").first().click();
    await page.keyboard.type("あ".repeat(300));
    await page.keyboard.press("Escape");
    // localStorage には入っていない
    expect(await page.evaluate(() => localStorage.getItem("taskspace-outline-v1"))).toBeNull();
    // IndexedDB には入っている
    await expect.poll(async () => page.evaluate(() => new Promise((done) => {
      const req = indexedDB.open("taskspace", 1);
      req.onsuccess = () => {
        const get = req.result.transaction("big", "readonly").objectStore("big").getAll(IDBKeyRange.bound(["taskspace-outline-v1", "row"], ["taskspace-outline-v1", "row", []]));
        get.onsuccess = () => done(JSON.stringify(get.result || []).includes("ああ"));
        get.onerror = () => done(false);
      };
      req.onerror = () => done(false);
    })), { timeout: 10000 }).toBe(true);

    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await expect(page.getByText("あああ", { exact: false }).first()).toBeVisible();
  });

  test("端末に保存できたあとで知らせる", async ({ page }) => {
    await refuseLocal(page);
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await page.locator("[data-row] [data-row-text]").first().click();
    await page.keyboard.type("い".repeat(300));
    const note = page.locator("[data-outline-toobig]");
    await expect(note).toBeVisible();
    await expect(note).toContainText("この端末の大きな置き場に保存しました");
  });
});

test.describe("つながりの様子", () => {
  test.beforeEach(async ({ page }) => {
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
  });

  test("置き場が無いときは「この端末だけ」と出る", async ({ page }) => {
    // テストでは Supabase の鍵を空にしてあるので、こちらになる
    const chip = page.locator("[data-outline-link]");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-link", "off");
    await expect(chip).toHaveAttribute("title", /この端末だけ/);
  });

  test("押しても壊れない（読み直しを試みるだけ）", async ({ page }) => {
    await page.locator("[data-outline-link]").click();
    await expect(page.locator("[data-outliner]")).toBeVisible();
  });
});
