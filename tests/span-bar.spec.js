import { test, expect, storedTask, storedTasks, block, dragTo, centerOf, todayKey } from "./helpers.js";

// 日をまたぐ帯（終日）。日付のところに落として作り、端をつまんで伸ばす。
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const bar = (page) => page.locator("[data-span-bar]").first();

test.describe("終日の帯", () => {
  test("日付のところに落とすと、終日の帯になる", async ({ page }) => {
    const card = block(page, "tray-1");
    const head = page.locator("[data-day-head]").first();
    const key = await head.getAttribute("data-day-head");

    // dnd-kit は動いた距離で発火する。混んでいても取りこぼさないよう細かく動かす
    await card.hover();
    await dragTo(page, await centerOf(card), await centerOf(head), 30);
    await expect.poll(async () => (await storedTask(page, "tray-1")).dueDate).toBe(key);
    expect((await storedTask(page, "tray-1")).scheduledDate).toBe(key);
    await expect(bar(page)).toBeVisible();
  });

  test("帯は、前より大きく読める", async ({ page, seed }) => {
    await seed({
      tasks: [{
        id: "s1", title: "ずっとやるやつ", category: "", project: "", status: "未着手",
        parentId: null, archived: false, plain: true, scheduledDate: day(0), dueDate: day(2),
        stock: false, style: null, pageId: null, rowKey: null, col: 0, colWidth: null,
      }],
    });
    const box = await bar(page).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(22);
    const size = await bar(page).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(size).toBeGreaterThanOrEqual(11);
  });

  test("右の端をドラッグすると、先の日までまたぐ", async ({ page, seed }) => {
    await seed({
      tasks: [{
        id: "s1", title: "のばすやつ", category: "", project: "", status: "未着手",
        parentId: null, archived: false, plain: true, scheduledDate: todayKey(), dueDate: todayKey(),
        stock: false, style: null, pageId: null, rowKey: null, col: 0, colWidth: null,
      }],
    });
    const before = await bar(page).boundingBox();
    const grab = bar(page).locator('[data-span-grab="end"]');
    await dragTo(page, await centerOf(grab), { x: before.x + before.width + 300, y: before.y + before.height / 2 });

    // 締め切りが後ろへ動き、帯も長くなる
    await expect.poll(async () => (await storedTask(page, "s1")).dueDate).not.toBe(todayKey());
    expect((await storedTask(page, "s1")).dueDate > todayKey()).toBe(true);
    const after = await bar(page).boundingBox();
    expect(after.width).toBeGreaterThan(before.width);
  });

  test("終わりを始まりより前に引っぱっても、逆さまにならない", async ({ page, seed }) => {
    await seed({
      tasks: [{
        id: "s1", title: "ちぢめるやつ", category: "", project: "", status: "未着手",
        parentId: null, archived: false, plain: true, scheduledDate: day(2), dueDate: day(4),
        stock: false, style: null, pageId: null, rowKey: null, col: 0, colWidth: null,
      }],
    });
    const box = await bar(page).boundingBox();
    const grab = bar(page).locator('[data-span-grab="end"]');
    await dragTo(page, await centerOf(grab), { x: box.x - 400, y: box.y + box.height / 2 });

    const t = await storedTask(page, "s1");
    expect(t.dueDate >= t.scheduledDate).toBe(true);
  });

  test("ほかのタスクは巻き込まない", async ({ page, seed }) => {
    await seed({
      tasks: [
        { id: "s1", title: "のばすやつ", category: "", project: "", status: "未着手", parentId: null, archived: false, plain: true, scheduledDate: todayKey(), dueDate: todayKey(), stock: false, style: null, pageId: null, rowKey: null, col: 0, colWidth: null },
        { id: "s2", title: "となり", category: "", project: "", status: "未着手", parentId: null, archived: false, plain: true, scheduledDate: todayKey(), dueDate: "", stock: false, style: null, pageId: null, rowKey: null, col: 0, colWidth: null },
      ],
    });
    const box = await bar(page).boundingBox();
    await dragTo(page, await centerOf(bar(page).locator('[data-span-grab="end"]')), { x: box.x + box.width + 250, y: box.y + box.height / 2 });
    await expect.poll(async () => (await storedTask(page, "s1")).dueDate).not.toBe(todayKey());
    expect((await storedTask(page, "s2")).dueDate).toBe("");
    expect((await storedTasks(page)).length).toBe(2);
  });
});

test.describe("帯と曜日のいったりきたり", () => {
  const spanTask = (over = {}) => ({
    id: "s1", title: "またぐやつ", category: "", project: "", status: "未着手",
    parentId: null, archived: false, plain: true, scheduledDate: todayKey(), dueDate: day(2),
    stock: false, style: null, pageId: null, rowKey: null, col: 0, colWidth: null, ...over,
  });

  test("帯になったら、曜日の中からは消える", async ({ page, seed }) => {
    await seed({ tasks: [spanTask()] });
    await expect(bar(page)).toBeVisible();
    // 曜日の列の中には出ていない（上の帯にだけある）
    await expect(page.locator("[data-day-col] [data-task-id]")).toHaveCount(0);
  });

  test("7days から日付の上に動かすと、帯に移る", async ({ page }) => {
    const card = block(page, "d-1"); // 今日に置いてあるタスク
    const head = page.locator("[data-day-head]").first();
    const key = await head.getAttribute("data-day-head");
    await dragTo(page, await centerOf(card), await centerOf(head));

    await expect.poll(async () => (await storedTask(page, "d-1")).dueDate).toBe(key);
    // 曜日の中からは消えている
    await expect(page.locator(`[data-day-col] [data-task-id="d-1"]`)).toHaveCount(0);
    await expect(page.locator(`[data-span-bar="d-1"]`)).toBeVisible();
  });

  test("帯を曜日の中に落とすと、その日のタスクに戻る", async ({ page, seed }) => {
    await seed({ tasks: [spanTask()] });
    const target = page.locator(`[data-day-col]`).nth(3);
    const key = await target.getAttribute("data-day-col");
    await dragTo(page, await centerOf(bar(page)), await centerOf(target));

    await expect.poll(async () => (await storedTask(page, "s1")).dueDate).toBe("");
    expect((await storedTask(page, "s1")).scheduledDate).toBe(key);
    await expect(page.locator(`[data-day-col="${key}"] [data-task-id="s1"]`)).toBeVisible();
  });

  test("◯ を押すと完了になる", async ({ page, seed }) => {
    await seed({ tasks: [spanTask()] });
    await bar(page).locator("[data-span-done]").click();
    await expect.poll(async () => (await storedTask(page, "s1")).status).toBe("完了");
  });

  test("端をつまんだだけでは、曜日に移らない", async ({ page, seed }) => {
    await seed({ tasks: [spanTask()] });
    const box = await bar(page).boundingBox();
    await dragTo(page, await centerOf(bar(page).locator('[data-span-grab="end"]')), { x: box.x + box.width + 200, y: box.y + box.height / 2 });
    expect((await storedTask(page, "s1")).dueDate).not.toBe("");
  });
});
