import { test, expect, block, dayBlock, storedTask, storedTasks, countInPanel, dragTo, centerOf, DAY_COLUMN } from "./helpers.js";

test.describe("ドラッグ移動", () => {
  test("タスクを空の曜日カラムに落とすとその日に配置される", async ({ page }) => {
    const empty = await page.evaluate((sel) => {
      const cols = [...document.querySelectorAll(sel)];
      const i = cols.findIndex((c) => c.querySelectorAll("[data-daytask]").length === 0);
      const r = cols[i].getBoundingClientRect();
      return { i, x: r.left + r.width / 2, y: r.top + r.height * 0.6 };
    }, DAY_COLUMN);

    await dragTo(page, await centerOf(block(page, "b-1")), empty);

    await expect.poll(async () => (await storedTask(page, "b-1")).scheduledDate).not.toBe("");
    // 曜日カラムに落とすとプロジェクトから外れてプレーンになる（既存仕様）
    expect(await storedTask(page, "b-1")).toMatchObject({ project: "", parentId: null });
  });

  test("複数選択したまま1つを掴むと選択分すべてが動く", async ({ page }) => {
    // 7days の3件をマーキーで選ぶ
    const box = await page.evaluate(() => {
      const rs = [...document.querySelectorAll("[data-daytask]")].map((e) => e.getBoundingClientRect());
      return {
        left: Math.min(...rs.map((r) => r.left)),
        right: Math.max(...rs.map((r) => r.right)),
        top: Math.min(...rs.map((r) => r.top)),
        bottom: Math.max(...rs.map((r) => r.bottom)),
      };
    });
    await page.mouse.move(Math.max(box.left - 14, 4), box.top - 10);
    await page.mouse.down();
    await page.mouse.move(box.right + 12, box.bottom + 6, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByText("3件選択中")).toBeVisible();

    const empty = await page.evaluate((sel) => {
      const cols = [...document.querySelectorAll(sel)];
      const i = cols.findIndex((c) => c.querySelectorAll("[data-daytask]").length === 0);
      const r = cols[i].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.6 };
    }, DAY_COLUMN);

    // 掴んでいる間は件数バッジが出る
    const from = await centerOf(dayBlock(page, "d-1"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 14, from.y + 14, { steps: 4 });
    await expect(page.getByText("ほか2件")).toBeVisible();
    await page.mouse.move(empty.x, empty.y, { steps: 16 });
    await page.mouse.up();

    // 3件とも同じ日に移り、それ以外は動かない
    await expect.poll(async () => {
      const ts = await storedTasks(page);
      const dates = ["d-1", "d-2", "d-3"].map((id) => ts.find((t) => t.id === id).scheduledDate);
      return new Set(dates).size === 1 ? dates[0] : null;
    }).not.toBeNull();
    expect((await storedTask(page, "b-1")).scheduledDate).toBe("");
  });

  test("タスクをSTOCKに落とすとプロジェクトを保ったまま日付が外れる", async ({ page }) => {
    const stock = await page.evaluate(() => {
      const h = [...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("STOCK"));
      const r = h.closest("div").parentElement.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
    });

    await dragTo(page, await centerOf(block(page, "a-solo")), stock);

    await expect.poll(async () => (await storedTask(page, "a-solo")).stock).toBe(true);
    expect(await storedTask(page, "a-solo")).toMatchObject({
      project: "ALPHA",
      category: "WORK",
      scheduledDate: "",
    });
    // 同期ブロック的に、PJボードにも残り続ける
    expect(await countInPanel(page, "ALPHA")).toBeGreaterThan(0);
  });

  test("STOCKから曜日カラムに戻すとストックが外れる", async ({ page }) => {
    const stockBox = await page.evaluate(() => {
      const h = [...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("STOCK"));
      const r = h.closest("div").parentElement.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
    });
    await dragTo(page, await centerOf(block(page, "a-solo")), stockBox);
    await expect.poll(async () => (await storedTask(page, "a-solo")).stock).toBe(true);

    // ストック内の行と移動先の座標を同じタイミングで取る
    const coords = await page.evaluate((sel) => {
      const h = [...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("STOCK"));
      const row = h.closest("div").parentElement.querySelector("[data-task-id]");
      const a = row.getBoundingClientRect();
      const cols = [...document.querySelectorAll(sel)];
      const empty = cols.find((c) => c.querySelectorAll("[data-daytask]").length === 0);
      const c = empty.getBoundingClientRect();
      return {
        from: { x: a.left + a.width / 2, y: a.top + a.height / 2 },
        to: { x: c.left + c.width / 2, y: c.top + c.height * 0.6 },
      };
    }, DAY_COLUMN);

    await dragTo(page, coords.from, coords.to);

    await expect.poll(async () => (await storedTask(page, "a-solo")).stock).toBe(false);
    expect((await storedTask(page, "a-solo")).scheduledDate).not.toBe("");
  });
});
