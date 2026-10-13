import { test as base, expect, storedTasks, todayKey, STORAGE_KEY } from "./helpers.js";
import { devices } from "@playwright/test";

// スマホで見たときの読みやすさと、指での操作。
// 既定のフィクスチャはデスクトップなので、ここだけ端末を差し替える。
const test = base.extend({
  page: async ({ browser }, use) => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"], isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
});

const t = (id, title, blockType = "text", over = {}) => ({
  id, title, category: "", project: "", blockType, status: "未着手", parentId: null,
  archived: false, scheduledDate: "", plain: true, stock: false, stockViewId: null,
  style: null, canvasX: null, canvasY: null, pageId: "page-1",
  rowKey: null, col: 0, colWidth: null, codeLang: "", ...over,
});

async function open(page, tasks, mode = "pages") {
  await page.addInitScript(
    ([key, data, m]) => {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem("taskspace-view-mode", m);
    },
    [STORAGE_KEY, {
      tasks, categories: [{ key: "W", label: "W", tone: "sky" }],
      projectRules: {}, projectOrder: {}, inboxItems: [],
    }, mode]
  );
  await page.goto("/");
  await page.waitForTimeout(500);
}

const row = (page, s) => page.locator("[data-task-id]").filter({ hasText: s }).first();
const pageBlocks = async (page) => (await storedTasks(page)).filter((x) => x.pageId);

test.describe("スマホでの見え方", () => {
  for (const [mode, label] of [["pages", "ページ"], ["list", "7days"]]) {
    test(`${label}: 横にはみ出さない`, async ({ page }) => {
      await open(page, [t("a", "ながい行のテキストをここに置いて折り返しを見る")], mode);
      const { doc, win } = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: document.documentElement.clientWidth,
      }));
      expect(doc).toBeLessThanOrEqual(win + 1);
    });
  }

  test("空の曜日が画面を埋め尽くさない", async ({ page }) => {
    await open(page, [t("d", "きょうの用事", "task", { pageId: null, scheduledDate: todayKey() })], "list");
    const tall = await page.evaluate(() => {
      const col = document.querySelector('div[class*="min-h-[420px]"], div[class*="min-h-0"]');
      return col ? col.getBoundingClientRect().height : 0;
    });
    // 1日あたり140pxを超えると、何も無い日を延々とスクロールすることになる
    expect(tall).toBeGreaterThan(0);
    expect(tall).toBeLessThan(140);
  });

  test("1週間ぶんが2画面に収まる", async ({ page }) => {
    await open(page, [t("d", "きょうの用事", "task", { pageId: null, scheduledDate: todayKey() })], "list");
    const ratio = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('div[class*="min-h-0"]')];
      if (!cols.length) return 99;
      const top = Math.min(...cols.map((c) => c.getBoundingClientRect().top));
      const bottom = Math.max(...cols.map((c) => c.getBoundingClientRect().bottom));
      return (bottom - top) / window.innerHeight;
    });
    // 直す前は1日あたり160pxあり、1週間で5画面ぶんスクロールしていた
    expect(ratio).toBeLessThan(2);
  });

  test("ページ一覧が本文の前に画面を埋めない", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("taskspace-pages", JSON.stringify([
      { id: "page-1", title: "いち", icon: "📄" }, { id: "page-2", title: "に", icon: "📝" },
      { id: "page-3", title: "さん", icon: "📌" }, { id: "page-4", title: "よん", icon: "💡" },
    ])));
    await open(page, [t("a", "ほんぶん")]);
    const h = await page.locator("aside").evaluate((a) => a.getBoundingClientRect().height);
    expect(h).toBeLessThan(140);
  });
});

test.describe("指での操作", () => {
  test("タップで書き始められる", async ({ page }) => {
    await open(page, [t("a", "たっぷ")]);
    await row(page, "たっぷ").locator("div.cursor-text").first().tap();
    await expect(page.locator("textarea")).toHaveCount(1);
  });

  test("編集欄は16px以上（iOSが勝手に拡大しない）", async ({ page }) => {
    await open(page, [t("a", "もじ")]);
    await row(page, "もじ").locator("div.cursor-text").first().tap();
    const size = await page.locator("textarea").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test("タスクの字が、スマホでも読める大きさ", async ({ page }) => {
    await open(page, [t("a", "きょうの用事", "task", { pageId: null, scheduledDate: todayKey() })], "list");
    const size = await page.locator(".ts-row-text").first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    // 手元の画面では 12.5px。スマホだと小さすぎる。
    expect(size).toBeGreaterThanOrEqual(15);
  });

  test("本文のブロックも、スマホでは一段大きい", async ({ page }) => {
    await open(page, [t("a", "ほんぶん")]);
    const size = await page.locator(".ts-block-text").first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test("書いているときと読んでいるときで、字の大きさが変わらない", async ({ page }) => {
    await open(page, [t("a", "もじ")]);
    const read = await page.locator(".ts-block-text").first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await row(page, "もじ").locator("div.cursor-text").first().tap();
    const write = await page.locator("textarea").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(write).toBe(read);
  });

  test("⠿ がホバー無しでも見えている", async ({ page }) => {
    await open(page, [t("a", "ぎょう")]);
    const op = await page.evaluate(() => {
      const g = document.querySelector('span[title="ドラッグで移動／クリックでメニュー"]');
      return g ? getComputedStyle(g.parentElement).opacity : "0";
    });
    expect(parseFloat(op)).toBeGreaterThan(0);
  });

  test("指でブロックを動かせる", async ({ page }) => {
    await open(page, [t("a", "いち"), t("c", "に")]);
    const from = await row(page, "に").boundingBox();
    const to = await row(page, "いち").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });

    await touch("touchStart", [{ x: from.x + 14, y: from.y + from.height / 2 }]);
    await page.waitForTimeout(350);  // 長押ししてから動かす（scroll と取り合わない）
    await touch("touchMove", [{ x: to.x + 60, y: to.y + 2 }]);
    await page.waitForTimeout(250);
    await touch("touchEnd", []);

    await expect.poll(async () => (await pageBlocks(page)).map((x) => x.title)).toEqual(["に", "いち"]);
  });

  test("上の帯のボタンが指で押せる大きさ", async ({ page }) => {
    await open(page, [t("a", "もじ")]);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("header button")]
        .filter((b) => b.getBoundingClientRect().height > 0)
        .filter((b) => b.getBoundingClientRect().height < 36)
        .map((b) => b.getAttribute("title") || ""));
    expect(small).toEqual([]);
  });
});

test.describe("浮くものが画面に収まる", () => {
  const fits = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.right <= window.innerWidth + 1;
  }, sel);

  test("装飾バー", async ({ page }) => {
    await open(page, [t("a", "そうしょく")]);
    await row(page, "そうしょく").locator("div.cursor-text").first().tap();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.locator("[data-format-bar]")).toHaveCount(1);
    expect(await fits(page, "[data-format-bar]")).toBe(true);
  });

  test("スラッシュメニュー", async ({ page }) => {
    await open(page, [t("a", "すらっしゅ")]);
    await row(page, "すらっしゅ").locator("div.cursor-text").first().tap();
    await page.keyboard.press("End");
    await page.keyboard.type(" /");
    await expect(page.locator("[data-slash-menu]")).toHaveCount(1);
    expect(await fits(page, "[data-slash-menu]")).toBe(true);
  });

  test("早見（Cmd+P）", async ({ page }) => {
    await open(page, [t("a", "さがす")]);
    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.locator("[data-quick-find]")).toHaveCount(1);
    expect(await fits(page, "[data-quick-find]")).toBe(true);
  });
});
