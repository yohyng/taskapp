import { test, expect, block, storedTask, storedTasks } from "./helpers.js";

const toCanvas = (page) => page.locator('button[title="キャンバス表示"]').click();
const canvas = (page) => page.locator("[data-canvas]");

// 既存タスクをコマンドでキャンバスに置く
async function place(page, id) {
  await block(page, id).locator("div.cursor-pointer").first().dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" /キャンバスへ");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await storedTask(page, id)).canvasX).not.toBeNull();
}

test.describe("キャンバス", () => {
  test("コマンドで置いたブロックがキャンバスに出る", async ({ page }) => {
    await place(page, "a-solo");
    await toCanvas(page);

    await expect(canvas(page)).toBeVisible();
    await expect(canvas(page).locator('[data-task-id="a-solo"]')).toBeVisible();
    // 置いていないものは出ない
    await expect(canvas(page).locator('[data-task-id="b-1"]')).toHaveCount(0);
  });

  test("ドラッグで位置が変わる", async ({ page }) => {
    await place(page, "a-solo");
    await toCanvas(page);

    const before = await storedTask(page, "a-solo");
    const el = canvas(page).locator('[data-task-id="a-solo"]');
    const b = await el.boundingBox();

    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 80, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => (await storedTask(page, "a-solo")).canvasX).toBe(before.canvasX + 120);
    expect((await storedTask(page, "a-solo")).canvasY).toBe(before.canvasY + 80);
  });

  test("ドラッグで動かしただけでは選択されない", async ({ page }) => {
    await place(page, "a-solo");
    await toCanvas(page);

    const b = await canvas(page).locator('[data-task-id="a-solo"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByText(/件選択中/)).toHaveCount(0);
  });

  test("背景のダブルクリックでその場に新しいブロックができる", async ({ page }) => {
    await place(page, "a-solo");
    await toCanvas(page);
    const before = (await storedTasks(page)).length;

    const b = await canvas(page).boundingBox();
    await page.mouse.dblclick(b.x + b.width * 0.6, b.y + b.height * 0.6);

    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    const created = (await storedTasks(page)).find((t) => t.title === "新規ブロック");
    expect(created.canvasX).not.toBeNull();
    expect(created.canvasY).not.toBeNull();
  });

  test("背景ドラッグで表示位置が動く", async ({ page }) => {
    await place(page, "a-solo");
    await toCanvas(page);

    const el = canvas(page).locator('[data-task-id="a-solo"]');
    const before = await el.boundingBox();

    const c = await canvas(page).boundingBox();
    await page.mouse.move(c.x + c.width * 0.8, c.y + c.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width * 0.8 - 100, c.y + c.height * 0.8, { steps: 10 });
    await page.mouse.up();

    // ブロック自体の座標は変えずに、見えている位置だけ動く
    await expect.poll(async () => (await el.boundingBox()).x).toBeLessThan(before.x - 50);
    expect((await storedTask(page, "a-solo")).canvasX).toBe(40);
  });

  test("キャンバス上でもコマンドとブロック種別が使える", async ({ page }) => {
    await place(page, "a-solo");
    await toCanvas(page);

    await canvas(page).locator('[data-task-id="a-solo"] div.cursor-pointer').first().dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type(" /見出し1");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("heading1");
  });

  test("リスト表示に戻せる", async ({ page }) => {
    await place(page, "a-solo");
    await toCanvas(page);
    await expect(canvas(page)).toBeVisible();

    await page.locator('button[title="リスト表示に戻す"]').click();
    await expect(canvas(page)).toHaveCount(0);
    await expect(block(page, "b-1")).toBeVisible();
  });
});
