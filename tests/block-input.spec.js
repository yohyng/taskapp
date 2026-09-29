import { test, expect, block, dayBlock, storedTasks, storedTask } from "./helpers.js";

// Notion 風のブロック入力。3つのビュー（PJボード・TRAY・7days）で
// 同じキーボード操作が効くことを確かめる。
const VIEWS = [
  { name: "PJボード", id: "a-solo", locate: (page, id) => block(page, id) },
  { name: "TRAY", id: "tray-1", locate: (page, id) => block(page, id) },
  { name: "7days", id: "d-1", locate: (page, id) => dayBlock(page, id) },
];

test.describe("ブロック入力", () => {
  for (const view of VIEWS) {
    test(`${view.name}: Enterで確定 → もう一度Enterで下に新規ブロック`, async ({ page }) => {
      const before = (await storedTasks(page)).length;
      const target = view.locate(page, view.id);

      await target.locator("div.cursor-pointer").first().dblclick();
      await expect(page.locator("textarea")).toHaveCount(1);

      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("へんこう");
      await page.keyboard.press("Enter");

      // 1回目: 確定してカードにフォーカスが戻る（ブロックは増えない）
      await expect(page.locator("textarea")).toHaveCount(0);
      await expect.poll(async () => (await storedTask(page, view.id)).title).toBe("へんこう");
      expect(await storedTasks(page)).toHaveLength(before);
      expect(
        await page.evaluate(() => document.activeElement?.hasAttribute("data-task-id"))
      ).toBe(true);

      // 2回目: 下に空ブロックができ、そのまま編集状態になる
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
      await expect(page.locator("textarea")).toHaveCount(1);
      await expect(page.locator("textarea")).toHaveValue("");
    });
  }

  test("空のまま確定したブロックは残らない", async ({ page }) => {
    const before = (await storedTasks(page)).length;

    await block(page, "a-solo").locator("div.cursor-pointer").first().dblclick();
    // 連打しても取りこぼさないこと（間に待機を入れない）
    await page.keyboard.press("Enter"); // 確定
    await page.keyboard.press("Enter"); // 新規ブロック
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);

    await page.keyboard.press("Enter"); // 空のまま確定 → 消える
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before);
  });

  test("新規ブロックは同じプロジェクトに入る", async ({ page }) => {
    const before = await storedTasks(page);
    await block(page, "a-solo").locator("div.cursor-pointer").first().dblclick();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("あたらしい");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTasks(page)).length).toBe(before.length + 1);
    const created = (await storedTasks(page)).find((t) => t.title === "あたらしい");
    expect(created).toMatchObject({ category: "WORK", project: "ALPHA" });
  });

  test("カード選択中に文字を打つとその文字で編集が始まる", async ({ page }) => {
    await block(page, "a-solo").focus();
    await page.keyboard.press("k");
    await expect(page.locator("textarea")).toHaveValue("k");
  });

  test("上下キーでブロック間を移動できる", async ({ page }) => {
    const first = await page.evaluate(() => {
      const el = document.querySelector("[data-task-id][tabindex]");
      el.focus();
      return el.getAttribute("data-task-id");
    });

    await page.keyboard.press("ArrowDown");
    const second = await page.evaluate(() => document.activeElement?.getAttribute("data-task-id"));
    expect(second).not.toBe(first);

    await page.keyboard.press("ArrowUp");
    const back = await page.evaluate(() => document.activeElement?.getAttribute("data-task-id"));
    expect(back).toBe(first);
  });

  test("空ブロックでBackspaceを押すと削除され前のブロックに移る", async ({ page }) => {
    const before = (await storedTasks(page)).length;

    await block(page, "a-solo").locator("div.cursor-pointer").first().dblclick();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // 空ブロックを作る
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);

    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before);
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-task-id"))
    ).toBe(true);
  });

  // 日付つきのプレーンタスクは 7days と TRAY の両方に描画される。
  // 両方が新規ブロックの編集を開くと、片方の blur が「空なので削除」を走らせて
  // ブロックごと消えてしまう。開くのは1つだけであること。
  test("複数ビューに出るタスクでも、新規ブロックのエディタは1つだけ開く", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await page.evaluate(() => document.querySelector("[data-daytask]").focus());
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    await expect(page.locator("textarea")).toHaveCount(1);
  });
});
