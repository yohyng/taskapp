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

  test("Cmd+Opt+1〜3 で見出しに、0 でテキストに戻る", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "みだし")] });
    await toPages(page);
    await edit(page, "みだし");
    await page.keyboard.press("ControlOrMeta+Alt+2");
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("heading2");
    await page.keyboard.press("ControlOrMeta+Alt+0");
    await expect.poll(async () => (await pageBlocks(page))[0].blockType).toBe("text");
    expect((await pageBlocks(page))[0].title).toBe("みだし");
  });
});

test.describe("カーソルのところで割れる", () => {
  test("行の途中で Enter → そこで2つに割れる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "ぜんはんこうはん")] });
    await toPages(page);
    await edit(page, "ぜんはんこうはん");
    await page.keyboard.press("Home");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(() => pageBlocks(page).then((x) => x.map((t) => t.title)))
      .toEqual(["ぜんはん", "こうはん"]);
  });

  test("割ったあとは、後ろ半分のほうを続けて書ける", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "ぜんはんこうはん")] });
    await toPages(page);
    await edit(page, "ぜんはんこうはん");
    await page.keyboard.press("Home");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedValue(page)).toBe("こうはん");
  });

  test("行頭で Enter → 上に空行ができ、自分は下へ", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "もとの行")] });
    await toPages(page);
    await edit(page, "もとの行");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(() => pageBlocks(page).then((x) => x.map((t) => t.title)))
      .toEqual(["", "もとの行"]);
  });

  test("行末 Enter は、これまで通り空のブロックが増えるだけ", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち")] });
    await toPages(page);
    await edit(page, "いち");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(() => pageBlocks(page).then((x) => x.map((t) => t.title))).toEqual(["いち", ""]);
  });

  test("行末 Delete → 次のブロックを引き上げて繋げる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "うえ"), b("c", "した")] });
    await toPages(page);
    await edit(page, "うえ");
    await page.keyboard.press("End");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Escape");
    await expect.poll(() => pageBlocks(page).then((x) => x.map((t) => t.title))).toEqual(["うえした"]);
  });
});

test.describe("ブロックの切り貼り", () => {
  test("Cmd+C → Cmd+V で、選んだブロックが複製される", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "コピーもと", "heading2")] });
    await toPages(page);
    await edit(page, "コピーもと");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");

    await expect.poll(() => pageBlocks(page).then((x) => x.map((t) => t.title)))
      .toEqual(["コピーもと", "コピーもと"]);
    // 種別まで連れていく（文字だけの貼り付けではない）
    expect((await pageBlocks(page)).every((t) => t.blockType === "heading2")).toBe(true);
  });

  test("Cmd+X で切り取れて、貼り直せる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "のこる"), b("c", "きりとる")] });
    await toPages(page);
    await edit(page, "きりとる");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+x");
    await expect.poll(() => pageBlocks(page).then((x) => x.map((t) => t.title))).toEqual(["のこる"]);

    await row(page, "のこる").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+v");
    await expect.poll(() => pageBlocks(page).then((x) => x.map((t) => t.title))).toEqual(["のこる", "きりとる"]);
  });

  test("段組みの列に貼ると、その列に入る", async ({ page, seed }) => {
    await seed({
      tasks: [
        { ...b("a", "そとの行") },
        { ...b("c", "列のブロック"), rowKey: "r1", col: 2 },
      ],
    });
    await toPages(page);
    await edit(page, "そとの行");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+c");
    await row(page, "列のブロック").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+v");

    await expect.poll(() => pageBlocks(page).then((x) => x.length)).toBe(3);
    const pasted = (await pageBlocks(page)).filter((t) => t.title === "そとの行");
    expect(pasted.some((t) => t.rowKey === "r1" && t.col === 2)).toBe(true);
  });
});

test.describe("親子", () => {
  test("本文の親を消すと、中の子も消える", async ({ page, seed }) => {
    await seed({
      tasks: [
        { ...b("a", "おや", "toggle") },
        { ...b("c", "こ"), parentId: "a" },
      ],
    });
    await toPages(page);
    await edit(page, "おや");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await expect.poll(() => pageBlocks(page).then((x) => x.length)).toBe(0);
  });

  test("トグルの中で Enter を押すと、中に増える", async ({ page, seed }) => {
    await seed({
      tasks: [
        { ...b("a", "おや", "toggle") },
        { ...b("c", "こ"), parentId: "a" },
      ],
    });
    await toPages(page);
    await edit(page, "こ");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    const made = (await pageBlocks(page)).find((t) => t.id !== "a" && t.id !== "c");
    expect(made.parentId).toBe("a");
  });
});

test.describe("文字の装飾", () => {
  const one = (text) => ({ tasks: [b("a", text)] });
  const selectAll = async (page, title) => {
    await edit(page, title);
    await page.keyboard.press("ControlOrMeta+a");
  };

  for (const [name, combo, want] of [
    ["Cmd+B で太字", "ControlOrMeta+b", "**もじ**"],
    ["Cmd+I で斜体", "ControlOrMeta+i", "*もじ*"],
    ["Cmd+U で下線", "ControlOrMeta+u", "__もじ__"],
    ["Cmd+Shift+S で打ち消し線", "ControlOrMeta+Shift+s", "~~もじ~~"],
    ["Cmd+E でコード", "ControlOrMeta+e", "`もじ`"],
  ]) {
    test(name, async ({ page, seed }) => {
      await seed(one("もじ"));
      await toPages(page);
      await selectAll(page, "もじ");
      await page.keyboard.press(combo);
      await page.keyboard.press("Escape");
      expect((await pageBlocks(page))[0].title).toBe(want);
    });
  }

  test("同じキーをもう一度押すと外れる", async ({ page, seed }) => {
    await seed(one("もじ"));
    await toPages(page);
    await selectAll(page, "もじ");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("Escape");
    expect((await pageBlocks(page))[0].title).toBe("もじ");
  });

  test("文字を選ぶと、浮く装飾バーが出る", async ({ page, seed }) => {
    await seed(one("えらぶ"));
    await toPages(page);
    await edit(page, "えらぶ");
    await expect(page.locator("[data-format-bar]")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.locator("[data-format-bar]")).toHaveCount(1);
  });

  test("装飾バーのボタンでも掛かる", async ({ page, seed }) => {
    await seed(one("もじ"));
    await toPages(page);
    await edit(page, "もじ");
    await page.keyboard.press("ControlOrMeta+a");
    await page.locator("[data-format-bar]").getByLabel("打ち消し線").click();
    await page.keyboard.press("Escape");
    expect((await pageBlocks(page))[0].title).toBe("~~もじ~~");
  });

  test("Cmd+K で URL を聞かれ、リンクになる", async ({ page, seed }) => {
    await seed(one("れいのサイト"));
    await toPages(page);
    await edit(page, "れいのサイト");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+k");

    const url = page.getByLabel("リンク先のURL");
    await expect(url).toBeVisible();
    await url.fill("https://example.com");
    await url.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await pageBlocks(page))[0].title)
      .toBe("[れいのサイト](https://example.com)");
  });

  for (const [name, text, tag] of [
    ["~~…~~ は打ち消し線で描かれる", "~~けす~~ のこり", "s"],
    ["__…__ は下線で描かれる", "__ひく__ のこり", "u"],
    ["**…** は太字で描かれる", "**ふとい** のこり", "strong"],
  ]) {
    test(name, async ({ page, seed }) => {
      await seed({ tasks: [b("a", text)] });
      await toPages(page);
      const html = await row(page, "のこり").innerHTML();
      expect(new RegExp(`<${tag}[ >]`).test(html)).toBe(true);
    });
  }

  test("[文字](URL) はリンクになり、文字だけが見える", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "[れいのサイト](https://example.com) のこり")] });
    await toPages(page);
    const link = row(page, "のこり").locator("a");
    await expect(link).toHaveAttribute("href", "https://example.com");
    await expect(link).toHaveText("れいのサイト");
  });

  test("むき出しの URL もリンクになる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "みて https://example.com のこり")] });
    await toPages(page);
    await expect(row(page, "のこり").locator("a")).toHaveAttribute("href", "https://example.com");
  });
});

test.describe("ドラッグの手がかり", () => {
  const grip = (page, title) => row(page, title).locator('span[title="ドラッグで移動／クリックでメニュー"]');

  async function dragOver(page, fromTitle, toTitle, xRatio) {
    await row(page, fromTitle).hover();
    const g = await grip(page, fromTitle).boundingBox();
    const to = await row(page, toTitle).boundingBox();
    await page.mouse.move(g.x + 4, g.y + 6);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width * xRatio, to.y + 3, { steps: 14 });
  }

  test("真ん中あたりに重ねると、入る位置に線が出る", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち"), b("c", "に")] });
    await toPages(page);
    await dragOver(page, "に", "いち", 0.5);
    await expect(page.locator("[data-drop-line]")).toHaveCount(1);
    await page.mouse.up();
  });

  test("端に重ねたときは線ではなく、列になる印が出る", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち"), b("c", "に")] });
    await toPages(page);
    await dragOver(page, "に", "いち", 0.02);
    await expect(page.locator("[data-drop-line]")).toHaveCount(0);
    await page.mouse.up();
  });

  test("線の出た場所に、そのとおり入る", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち"), b("c", "に")] });
    await toPages(page);
    await dragOver(page, "に", "いち", 0.5); // 上半分 = いち の前
    await page.mouse.up();
    await expect.poll(() => pageBlocks(page).then((x) => x.map((t) => t.title))).toEqual(["に", "いち"]);
  });
});

test.describe("選んでまとめて字下げ", () => {
  test("上に受け皿があれば、選んだぶんがまとめて子になる", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "おや"), b("c", "いち"), b("d", "に")] });
    await toPages(page);
    await edit(page, "いち");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Tab");

    await expect.poll(async () =>
      (await pageBlocks(page)).filter((t) => t.parentId === "a").map((t) => t.title))
      .toEqual(["いち", "に"]);
  });

  test("Shift+Tab で元に戻る", async ({ page, seed }) => {
    await seed({
      tasks: [b("a", "おや"), { ...b("c", "こ"), parentId: "a" }],
    });
    await toPages(page);
    await edit(page, "こ");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(async () => (await pageBlocks(page)).find((t) => t.title === "こ").parentId).toBeFalsy();
  });

  test("いちばん上のブロックは、字下げしても動かない", async ({ page, seed }) => {
    await seed({ tasks: [b("a", "いち"), b("c", "に")] });
    await toPages(page);
    await edit(page, "いち");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    expect((await pageBlocks(page)).every((t) => !t.parentId)).toBe(true);
  });
});

test.describe("まだ寄せきれていないもの", () => {
  test.fixme("選んだ状態で文字を打つと、まとめて置き換わる", async () => {});
  test.fixme("Alt+ドラッグで複製できる", async () => {});
  test.fixme("ブロックの左の余白クリックで選択できる", async () => {});
});
