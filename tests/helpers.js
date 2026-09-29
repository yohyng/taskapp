import { test as base, expect } from "@playwright/test";

export const STORAGE_KEY = "notion-like-taskdb-prototype-v4";
export const STOCK_VIEWS_KEY = "taskspace-stock-views";
export const THEME_KEY = "taskspace-app-theme";

// 画面に出る曜日カラム。日付に依存しないよう、テストは「今日」を基準に組む。
export const DAY_COLUMN = 'div[class*="min-h-[420px]"]';

function task(over) {
  return {
    id: over.id,
    title: over.title,
    category: "",
    project: "",
    status: "未着手",
    today: false,
    todayOrder: null,
    thisWeek: false,
    weeklyOrder: null,
    parentId: null,
    memo: "",
    dueDate: "",
    recurrence: "none",
    recurrenceDay: null,
    recurrenceEnd: "",
    plain: false,
    sortOrder: null,
    archived: false,
    scheduledDate: "",
    stock: false,
    stockViewId: null,
    style: null,
    ...over,
  };
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 最小限で意味のある固定データ。
// - ALPHA に親子（a-parent > a-child1/2）があるので階層まわりを検証できる
// - 今日に3件置いてあるので 7days の操作が日付に依存しない
export function seedData() {
  const t = todayKey();
  return {
    tasks: [
      task({ id: "a-parent", title: "親タスク", category: "WORK", project: "ALPHA" }),
      task({ id: "a-child1", title: "子タスク1", category: "WORK", project: "ALPHA", parentId: "a-parent" }),
      task({ id: "a-child2", title: "子タスク2", category: "WORK", project: "ALPHA", parentId: "a-parent" }),
      task({ id: "a-solo", title: "単独タスク", category: "WORK", project: "ALPHA" }),
      task({ id: "b-1", title: "ベータ1", category: "WORK", project: "BETA" }),
      task({ id: "d-1", title: "今日その1", plain: true, scheduledDate: t }),
      task({ id: "d-2", title: "今日その2", plain: true, scheduledDate: t }),
      task({ id: "d-3", title: "今日その3", plain: true, scheduledDate: t }),
      task({ id: "tray-1", title: "トレイのタスク", plain: true }),
    ],
    categories: [{ key: "WORK", label: "WORK", tone: "sky" }],
    projectRules: {},
    projectOrder: { WORK: ["ALPHA", "BETA"] },
    inboxItems: [{ id: "inbox-1", title: "インボックス行", source: "test", createdAt: t }],
  };
}

// 各テストは同じ初期状態から始める
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ([key, data, viewsKey, themeKey]) => {
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.removeItem(viewsKey);
        localStorage.removeItem(themeKey);
      },
      [STORAGE_KEY, seedData(), STOCK_VIEWS_KEY, THEME_KEY]
    );
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/");
    await page.waitForSelector("[data-task-id]");
    await use(page);
    // どのテストでも未捕捉の例外は失敗扱いにする
    expect(errors, "コンソールに未捕捉の例外").toEqual([]);
  },
});

export { expect };

// --- 共通の問い合わせ ---

export function storedTasks(page) {
  return page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    return raw.tasks || [];
  }, STORAGE_KEY);
}

export function storedTask(page, id) {
  return page.evaluate(
    ([key, tid]) => {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      return (raw.tasks || []).find((t) => t.id === tid) || null;
    },
    [STORAGE_KEY, id]
  );
}

// 同じタスクが複数のビューに出ることがある（例: 日付つきのプレーンタスクは
// 7days と TRAY の両方に出る）。既定では最初の1つを指し、
// 場所を特定したいときは dayBlock / panelBlock を使う。
export function block(page, id) {
  return page.locator(`[data-task-id="${id}"]`).first();
}

// 7days カラム内のブロック
export function dayBlock(page, id) {
  return page.locator(`[data-daytask][data-task-id="${id}"]`);
}

// 見出し名で絞ったパネル内のブロック
export function panelBlock(page, heading, id) {
  return page
    .locator("div")
    .filter({ has: page.getByText(heading, { exact: true }) })
    .last()
    .locator(`[data-task-id="${id}"]`)
    .first();
}

// パネル（TRAY / STOCK / PJ など）の見出し文字から、その中のタスク行を数える
export function countInPanel(page, heading) {
  return page.evaluate((h) => {
    const el = [...document.querySelectorAll("span,button,div")].find(
      (e) => e.children.length === 0 && e.textContent.trim() === h
    );
    if (!el) return -1;
    const panel = el.closest("div")?.parentElement;
    return panel ? panel.querySelectorAll("[data-task-id]").length : -1;
  }, heading);
}

// 実操作のドラッグ（dnd-kit は pointer イベントの移動距離で発火する）
export async function dragTo(page, from, to, steps = 18) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export async function centerOf(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("要素が画面上に見つからない");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
