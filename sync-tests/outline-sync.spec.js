import { test, expect } from "@playwright/test";

const KEY = "taskspace-outline-v1";
const REMOTE_KEY = "test-outline-remote";

// サーバーの応答だけを差し替える。空配列は取得成功、nullは取得失敗。
// 画面・Provider・木の操作・IndexedDBは本物を動かす。
const dbModule = `
export async function loadOutlineRows() {
  window.__outlineSync.reads += 1;
  return JSON.parse(sessionStorage.getItem("test-outline-remote"));
}
export async function saveOutlineRows(rows, gone) {
  window.__outlineSync.writes.push(structuredClone({ rows, gone }));
  return null;
}
export function subscribeOutline(_onRows, onStatus) {
  onStatus("live");
  return () => {};
}
export const supabaseReady = () => true;
export const absentOutlineColumns = () => [];
export const isOutlineTableMissing = () => false;
export const outlineTableSql = () => "";
export const outlineColumnsSql = () => "";
export const clearOutlineRows = async () => null;
`;

const node = (id, text) => ({
  id, text, children: [],
  favorite: false, collapsed: false, completed: false,
  date: null, headingLevel: null, textColor: null, bgColor: null, imageWidth: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
});
const saved = () => [node("a", "前に同期した行"), node("b", "もうひとつの行")];
const asRows = (nodes) => nodes.map((node, sortOrder) => ({
  ...node, parentId: null, sortOrder,
}));

async function open(page, { local = saved(), remote = asRows(local), known = local.map((n) => n.id) } = {}) {
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://127.0.0.1:4174/")
      ? route.continue() : route.abort());
  await page.route(/\/src\/lib\/db\.js(?:\?.*)?$/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: dbModule }));
  await page.addInitScript(({ key, remoteKey, local, remote, known }) => {
    // リロードで初期値を入れ直すと、保存・読み直しの不具合を隠してしまう。
    if (!sessionStorage.getItem("test-outline-seeded")) {
      localStorage.setItem(key, JSON.stringify(local));
      localStorage.setItem("taskspace-outline-known", JSON.stringify(known));
      sessionStorage.setItem(remoteKey, JSON.stringify(remote));
      sessionStorage.setItem("test-outline-seeded", "1");
    }
    window.__outlineSync = { reads: 0, writes: [] };
  }, { key: KEY, remoteKey: REMOTE_KEY, local, remote, known });
  await page.clock.install();
  await page.goto("/sync-tests/fixture.html");
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
}

const empty = (page) => page.locator("[data-outline-empty]");
const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
const writes = (page) => page.evaluate(() => window.__outlineSync.writes);

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // 未捕捉の例外も、テストの操作後に確認する。
  page.__outlineErrors = errors;
});
test.afterEach(async ({ page }) => {
  expect(page.__outlineErrors, "コンソールに未捕捉の例外").toEqual([]);
});

test("他端末で全件削除したあと読み直しても、古い行を送り返さない", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-row]")).toHaveCount(2);
  await page.evaluate((key) => sessionStorage.setItem(key, "[]"), REMOTE_KEY);
  await page.locator("[data-outline-link]").click();
  await expect(empty(page)).toBeVisible();
  await expect(page.locator("[data-row]")).toHaveCount(0);
  await expect.poll(() => stored(page)).toEqual([]);
  await page.clock.fastForward(2_000);
  expect(await writes(page)).toEqual([]);
});

test("起動時に全件削除を受け取ったあと、リロードしても空のまま", async ({ page }) => {
  await open(page, { remote: [] });
  await expect(empty(page)).toBeVisible();
  await expect.poll(() => stored(page)).toEqual([]);
  await page.reload();
  await expect(empty(page)).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(page.locator("[data-row]")).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
});

test("空の木がIndexedDBだけに残っていても、勝手に空行を同期しない", async ({ page }) => {
  await open(page, { local: [], remote: [], known: [] });
  await expect(empty(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("taskspace", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("big", "readonly");
      const get = tx.objectStore("big").get("taskspace-outline-v1");
      get.onsuccess = () => resolve(get.result?.nodes);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    };
  }))).toEqual([]);
  await page.evaluate((key) => localStorage.removeItem(key), KEY);
  await page.reload();
  await expect(empty(page)).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(page.locator("[data-row]")).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
});

test("全件削除されていても、この端末だけの未送信行は残す", async ({ page }) => {
  const draft = node("draft", "まだ送っていない行");
  await open(page, { local: [...saved(), draft], remote: [], known: ["a", "b"] });
  await expect(page.locator("[data-row]")).toHaveCount(1);
  await expect(page.locator('[data-row="draft"]')).toContainText(draft.text);
  await expect(empty(page)).toHaveCount(0);
  await page.clock.fastForward(2_000);
  expect((await writes(page)).flatMap((write) => write.rows.map((row) => row.id))).toEqual(["draft"]);
});

test("向こうを読めなかったときは、手元の行を消さず送り始めない", async ({ page }) => {
  await open(page, { remote: null });
  await expect(page.locator("[data-row]")).toHaveCount(2);
  await page.clock.fastForward(2_000);
  expect(await writes(page)).toEqual([]);
});

test("全件削除のあとも書き始められ、新しい行だけを送る", async ({ page }) => {
  await open(page, { remote: [] });
  await empty(page).click();
  const input = page.locator("[data-outline-input]");
  await expect(input).toBeFocused();
  await input.fill("ここから続きを書く");
  await expect.poll(async () => (await stored(page))?.[0]?.text).toBe("ここから続きを書く");
  await page.clock.fastForward(2_000);
  const sent = (await writes(page)).flatMap((write) => write.rows);
  expect(sent).toHaveLength(1);
  expect(sent[0].text).toBe("ここから続きを書く");
  expect(["a", "b"]).not.toContain(sent[0].id);
});
