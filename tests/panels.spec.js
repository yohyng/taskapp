import { test, expect, storedTasks, STORAGE_KEY } from "./helpers.js";

// 下の段は「しまう」だけで、中身は消さない。
const VIEWS = [{ id: "stock", name: "STOCK", color: "#a78bfa" }];
const t = (id, title, over = {}) => ({
  id, title, category: "", project: "", blockType: "task", status: "未着手",
  parentId: null, archived: false, scheduledDate: "", plain: true, stock: false,
  stockViewId: null, style: null, canvasX: null, canvasY: null, pageId: null,
  rowKey: null, col: 0, colWidth: null, codeLang: "", dayDate: "", viewId: "", ...over,
});
const withViews = (page) => page.addInitScript(
  ([v]) => localStorage.setItem("taskspace-stock-views", JSON.stringify(v)), [VIEWS]);
const openSettings = (page) => page.locator('button[title="Columns / Category Settings"], button[title*="Settings"]').first().click();

test.describe("下の段をしまう", () => {
  test("STOCK は既定でしまってある", async ({ page, seed }) => {
    await withViews(page);
    // 既定の挙動を見るので、フィクスチャが入れた指定を外す
    await page.addInitScript(() => localStorage.removeItem("taskspace-hidden-panels"));
    await seed({ tasks: [t("a", "ねかせたやつ", { stock: true, stockViewId: "stock" })] });
    await expect(page.getByText("STOCKビューを追加")).toHaveCount(0);
  });

  test("しまっても、中のタスクは消えない", async ({ page, seed }) => {
    await withViews(page);
    await page.addInitScript(() => localStorage.removeItem("taskspace-hidden-panels"));
    await seed({ tasks: [t("a", "ねかせたやつ", { stock: true, stockViewId: "stock" })] });

    const task = (await storedTasks(page)).find((x) => x.id === "a");
    expect(task.stock).toBe(true);
    expect(task.title).toBe("ねかせたやつ");
    // STOCK ビューの設定も残っている
    expect(await page.evaluate(() =>
      JSON.parse(localStorage.getItem("taskspace-stock-views")).length)).toBe(1);
  });

  test("ボードの STOCK ブロックからは、しまっていても触れる", async ({ page, seed }) => {
    await withViews(page);
    await seed({
      tasks: [
        t("a", "ねかせたやつ", { stock: true, stockViewId: "stock" }),
        t("sb", "", { pageId: "board-7days", blockType: "stock", viewId: "stock" }),
      ],
    });
    await expect(page.locator("[data-board]").getByText("ねかせたやつ")).toHaveCount(1);
  });

  test("設定から出し直せる", async ({ page, seed }) => {
    await withViews(page);
    await page.addInitScript(() => localStorage.removeItem("taskspace-hidden-panels"));
    await seed({ tasks: [t("a", "ねかせたやつ", { stock: true, stockViewId: "stock" })] });
    await openSettings(page);

    await page.getByRole("button", { name: /STOCK.*しまってある/ }).click();
    await expect(page.getByText("STOCKビューを追加")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /STOCK.*出ている/ })).toBeVisible();
  });

  test("しまった状態は読み直しても残る", async ({ page, seed }) => {
    await withViews(page);
    await seed({ tasks: [t("a", "なにか")] });
    await openSettings(page);
    await page.getByRole("button", { name: /TRAY.*出ている/ }).click();

    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("taskspace-hidden-panels") || "[]"))).toContain("tray");

    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForSelector("header");
    await expect(fresh.getByText("TRAY", { exact: true })).toHaveCount(0);
    await fresh.close();
  });
});

test.describe("PJ のタスクを TRAY に移す", () => {
  const PJ = {
    tasks: [
      t("p", "PJの親", { category: "WORK", project: "ALPHA", plain: false }),
      t("c", "PJの子", { category: "WORK", project: "ALPHA", plain: false, parentId: "p" }),
      t("x", "もともとTRAY"),
    ],
    categories: [{ key: "WORK", label: "WORK", tone: "sky" }],
    projectOrder: { WORK: ["ALPHA"] },
  };
  const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);
  const press = async (page) => {
    await openSettings(page);
    const btn = page.getByRole("button", { name: "PJ を消して、タスクを TRAY に移す" });
    await btn.click();
    await page.getByRole("button", { name: /もう一度押すと実行/ }).click();
  };

  test("Category と Project が外れて、TRAY のタスクになる", async ({ page, seed }) => {
    await seed(PJ);
    await press(page);

    await expect.poll(async () => (await byTitle(page, "PJの親")).project).toBe("");
    expect((await byTitle(page, "PJの親")).category).toBe("");
    expect((await byTitle(page, "PJの子")).project).toBe("");
  });

  test("タスクも親子も消えない", async ({ page, seed }) => {
    await seed(PJ);
    await press(page);
    await expect.poll(async () => (await byTitle(page, "PJの親")).project).toBe("");

    const all = await storedTasks(page);
    expect(all).toHaveLength(3);                       // 1件も消えていない
    expect((await byTitle(page, "PJの子")).parentId).toBe("p"); // 親子もそのまま
    expect((await byTitle(page, "PJの子")).title).toBe("PJの子");
  });

  test("一度押しただけでは動かない（確認がいる）", async ({ page, seed }) => {
    await seed(PJ);
    await openSettings(page);
    await page.getByRole("button", { name: "PJ を消して、タスクを TRAY に移す" }).click();

    await expect(page.getByRole("button", { name: /もう一度押すと実行/ })).toBeVisible();
    expect((await byTitle(page, "PJの親")).project).toBe("ALPHA"); // まだ動いていない
  });

  test("プロジェクトの箱も空になる", async ({ page, seed }) => {
    await seed(PJ);
    await press(page);
    await expect.poll(async () => (await byTitle(page, "PJの親")).project).toBe("");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("notion-like-taskdb-prototype-v4")));
    expect(stored.projectOrder).toEqual({});
    expect(stored.projectRules).toEqual({});
  });

  test("取り消しで元に戻る", async ({ page, seed }) => {
    await seed(PJ);
    await press(page);
    await expect.poll(async () => (await byTitle(page, "PJの親")).project).toBe("");

    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await byTitle(page, "PJの親")).project).toBe("ALPHA");
  });
});

test.describe("プロジェクトを1つ消す", () => {
  const PJ2 = {
    tasks: [
      t("p", "親タスク", { category: "WORK", project: "ALPHA", plain: false }),
      t("c", "子タスク", { category: "WORK", project: "ALPHA", plain: false, parentId: "p" }),
      t("o", "別PJのタスク", { category: "WORK", project: "BETA", plain: false }),
    ],
    categories: [{ key: "WORK", label: "WORK", tone: "sky" }],
    projectOrder: { WORK: ["ALPHA", "BETA"] },
  };
  const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);

  test("中のタスクは消えず、親子のまま TRAY に残る", async ({ page, seed }) => {
    await seed(PJ2);
    page.on("dialog", (d) => d.accept());

    await page.getByText("ALPHA", { exact: true }).first().click();
    await page.getByRole("button", { name: /削除/ }).first().click();

    await expect.poll(async () => (await byTitle(page, "親タスク")).project).toBe("");
    const all = await storedTasks(page);
    expect(all).toHaveLength(3);                                  // 1件も消えていない
    expect((await byTitle(page, "子タスク")).parentId).toBe("p");  // 子も残り、親子も保たれる
    expect((await byTitle(page, "子タスク")).project).toBe("");
    expect((await byTitle(page, "別PJのタスク")).project).toBe("BETA"); // 他のPJは無事
  });

  test("プロジェクトの箱だけが消える", async ({ page, seed }) => {
    await seed(PJ2);
    page.on("dialog", (d) => d.accept());
    await page.getByText("ALPHA", { exact: true }).first().click();
    await page.getByRole("button", { name: /削除/ }).first().click();

    await expect.poll(async () => page.evaluate(() =>
      JSON.parse(localStorage.getItem("notion-like-taskdb-prototype-v4")).projectOrder.WORK))
      .toEqual(["BETA"]);
  });
});

test.describe("空になったPJの箱を消す", () => {
  // タスクはもう外してあり、空の箱だけが残っている状態
  const EMPTY_BOXES = {
    tasks: [t("x", "TRAYのタスク")],
    categories: [{ key: "WORK", label: "WORK", tone: "sky" }],
    projectOrder: { WORK: ["ALPHA", "BETA"] },
  };
  const boxes = (page) => page.evaluate(() =>
    JSON.parse(localStorage.getItem("notion-like-taskdb-prototype-v4")).projectOrder);

  test("中身が空でも、箱を消せる", async ({ page, seed }) => {
    await seed(EMPTY_BOXES);
    await expect.poll(() => boxes(page)).toEqual({ WORK: ["ALPHA", "BETA"] });

    await openSettings(page);
    await page.getByRole("button", { name: "PJ を消して、タスクを TRAY に移す" }).click();
    await page.getByRole("button", { name: /もう一度押すと実行：空のPJを消す/ }).click();

    await expect.poll(() => boxes(page)).toEqual({});
    await expect(page.getByText("空のプロジェクトを消しました", { exact: false })).toBeVisible();
  });

  test("箱を消しても、TRAY のタスクは残る", async ({ page, seed }) => {
    await seed(EMPTY_BOXES);
    await openSettings(page);
    await page.getByRole("button", { name: "PJ を消して、タスクを TRAY に移す" }).click();
    await page.getByRole("button", { name: /もう一度押すと実行/ }).click();

    await expect.poll(() => boxes(page)).toEqual({});
    expect((await storedTasks(page)).find((x) => x.id === "x").title).toBe("TRAYのタスク");
  });

  test("ほんとうに何も無ければ、何も言わずには済ませない", async ({ page, seed }) => {
    await seed({ tasks: [t("x", "ただのタスク")], categories: [{ key: "WORK", label: "WORK", tone: "sky" }], projectOrder: {} });
    await openSettings(page);
    await page.getByRole("button", { name: "PJ を消して、タスクを TRAY に移す" }).click();
    await page.getByRole("button", { name: /もう一度押すと実行/ }).click();

    await expect(page.getByText("片付けるものがありません", { exact: false })).toBeVisible();
  });
});
