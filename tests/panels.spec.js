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

test.describe("PJボードをやめたあと", () => {
  const byTitle = async (page, s) => (await storedTasks(page)).find((x) => x.title === s);
  const PJ = {
    tasks: [
      t("p", "もと PJ の親", { category: "WORK", project: "ALPHA", plain: false }),
      t("c", "もと PJ の子", { category: "WORK", project: "ALPHA", plain: false, parentId: "p" }),
    ],
    categories: [{ key: "WORK", label: "WORK", tone: "sky" }],
    projectOrder: { WORK: ["ALPHA"] },
  };

  test("PJ の列はもう画面に出ない", async ({ page, seed }) => {
    await seed(PJ);
    await expect(page.getByText("ALPHA", { exact: true })).toHaveCount(0);
    await expect(page.getByText("WORK", { exact: true })).toHaveCount(0);
  });

  test("しまう／出すから PJボードの行が消えている", async ({ page, seed }) => {
    await seed(PJ);
    await openSettings(page);
    await expect(page.getByRole("button", { name: /PJボード/ })).toHaveCount(0);
  });

  test("PJ に入っていたタスクも TRAY から見える", async ({ page, seed }) => {
    await seed(PJ);
    // 行き先（ボード）がなくなったので、所属が残っていても TRAY に出す
    await expect(page.getByText("もと PJ の親", { exact: true })).toBeVisible();
  });

  test("残った所属は設定から外せる", async ({ page, seed }) => {
    await seed(PJ);
    await openSettings(page);
    await page.getByRole("button", { name: "残っている Category / Project を消す" }).click();
    await page.getByRole("button", { name: /もう一度押すと実行/ }).click();

    await expect.poll(async () => (await byTitle(page, "もと PJ の親")).project).toBe("");
    expect((await byTitle(page, "もと PJ の親")).category).toBe("");
    // 親子も中身もそのまま
    expect((await byTitle(page, "もと PJ の子")).parentId).toBe("p");
    expect(await storedTasks(page)).toHaveLength(2);
  });

  test("一度押しただけでは動かない", async ({ page, seed }) => {
    await seed(PJ);
    await openSettings(page);
    await page.getByRole("button", { name: "残っている Category / Project を消す" }).click();
    await expect(page.getByRole("button", { name: /もう一度押すと実行/ })).toBeVisible();
    expect((await byTitle(page, "もと PJ の親")).project).toBe("ALPHA");
  });

  test("取り消しで元に戻る", async ({ page, seed }) => {
    await seed(PJ);
    await openSettings(page);
    await page.getByRole("button", { name: "残っている Category / Project を消す" }).click();
    await page.getByRole("button", { name: /もう一度押すと実行/ }).click();
    await expect.poll(async () => (await byTitle(page, "もと PJ の親")).project).toBe("");

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await byTitle(page, "もと PJ の親")).project).toBe("ALPHA");
  });
});
