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
  const state = window.__outlineSync;
  const sent = structuredClone({ rows, gone });
  state.writes.push(sent);
  state.active += 1;
  state.maxActive = Math.max(state.maxActive, state.active);
  try {
    const error = state.hold
      ? await new Promise((resolve, reject) => state.pending.push({ resolve, reject }))
      : null;
    if (error) return error;
    const remote = JSON.parse(sessionStorage.getItem("test-outline-remote")) || [];
    const byId = new Map(remote.map((row) => [row.id, row]));
    for (const id of sent.gone) byId.delete(id);
    for (const row of sent.rows) byId.set(row.id, row);
    sessionStorage.setItem("test-outline-remote", JSON.stringify([...byId.values()]));
    return null;
  } finally {
    state.active -= 1;
  }
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
    window.__outlineSync = { reads: 0, writes: [], pending: [], hold: false, active: 0, maxActive: 0 };
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

// 送信の返事を止め、入力の待機時間より長く通信がかかった場合を再現する。
const holdWrites = (page) => page.evaluate(() => { window.__outlineSync.hold = true; });
async function releaseWrite(page, { error = null, reject = false } = {}) {
  await page.evaluate(({ error, reject }) => {
    const state = window.__outlineSync;
    state.hold = false;
    const pending = state.pending.shift();
    if (!pending) throw new Error("止めている送信がありません");
    if (reject) pending.reject(new Error(error));
    else pending.resolve(error);
  }, { error, reject });
  await expect.poll(() => page.evaluate(() => window.__outlineSync.active)).toBe(0);
}
const remoteRows = (page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), REMOTE_KEY);
const inputFor = (page, id) => page.locator(`[data-row="${id}"] [data-outline-input]`);
async function editRow(page, id, text) {
  const input = inputFor(page, id);
  if (!await input.count()) await page.locator(`[data-row="${id}"] [data-row-text]`).click();
  await input.fill(text);
}
async function startHeldWrite(page) {
  await holdWrites(page);
  await editRow(page, "a", "先に送る内容");
  await page.clock.fastForward(1_000);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
}

test("送信中に同じ行を続けて編集しても、重ねて送らず最新の内容を続けて送る", async ({ page }) => {
  await open(page);
  await startHeldWrite(page);
  await editRow(page, "a", "待っている間の編集");
  await page.clock.fastForward(1_000);
  expect(await writes(page)).toHaveLength(1);
  await editRow(page, "a", "最後に残したい内容");
  await page.clock.fastForward(1_000);
  expect(await writes(page)).toHaveLength(1);

  await releaseWrite(page);
  await page.clock.fastForward(1_000);
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  const sent = await writes(page);
  expect(sent[0].rows.find((row) => row.id === "a").text).toBe("先に送る内容");
  expect(sent[1].rows.find((row) => row.id === "a").text).toBe("最後に残したい内容");
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("最後に残したい内容");
  expect(await page.evaluate(() => window.__outlineSync.maxActive)).toBe(1);
  await page.clock.fastForward(2_000);
  expect(await writes(page)).toHaveLength(2);
});

test("送信中に別の行を編集したときも、その差分だけを続けて送る", async ({ page }) => {
  await open(page);
  await startHeldWrite(page);
  await editRow(page, "b", "あとで編集した別の行");
  await page.clock.fastForward(1_000);
  expect(await writes(page)).toHaveLength(1);
  await releaseWrite(page);
  await page.clock.fastForward(1_000);
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  const sent = await writes(page);
  expect(sent[1].rows.map((row) => row.id)).toEqual(["b"]);
  const remote = await remoteRows(page);
  expect(remote.find((row) => row.id === "a").text).toBe("先に送る内容");
  expect(remote.find((row) => row.id === "b").text).toBe("あとで編集した別の行");
  expect(await page.evaluate(() => window.__outlineSync.maxActive)).toBe(1);
});

test("新しい行の送信中にその行を削除しても、完了後に削除を送って向こうへ残さない", async ({ page }) => {
  await open(page);
  await holdWrites(page);
  await editRow(page, "a", "前に同期した行");
  await inputFor(page, "a").press("End");
  await inputFor(page, "a").press("Enter");
  const input = page.locator("[data-outline-input]");
  await input.fill("送っている間に消す行");
  const id = await input.evaluate((el) => el.closest("[data-row]").dataset.row);
  await page.clock.fastForward(1_000);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  await input.fill("");
  await input.press("Backspace");
  await expect(page.locator(`[data-row="${id}"]`)).toHaveCount(0);
  await page.clock.fastForward(1_000);
  expect(await writes(page)).toHaveLength(1);

  await releaseWrite(page);
  await page.clock.fastForward(1_000);
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  expect((await writes(page))[1].gone).toContain(id);
  expect((await remoteRows(page)).some((row) => row.id === id)).toBe(false);
  expect(await page.evaluate(() => window.__outlineSync.maxActive)).toBe(1);
});

for (const reject of [false, true]) {
  test(`送信が${reject ? "例外" : "エラーの返事"}で失敗しても、最新の編集を再試行する`, async ({ page }) => {
    await open(page);
    await startHeldWrite(page);
    await editRow(page, "a", "失敗後に送り直す最新の内容");
    await page.clock.fastForward(1_000);
    expect(await writes(page)).toHaveLength(1);
    await releaseWrite(page, { error: "一時的な通信失敗", reject });
    await expect(page.getByText("Supabase に送れませんでした：一時的な通信失敗")).toBeVisible();
    await page.clock.fastForward(14_000);
    expect(await writes(page)).toHaveLength(1);
    await page.clock.runFor(2_000);
    await expect.poll(async () => (await writes(page)).length).toBe(2);
    expect((await writes(page))[1].rows.find((row) => row.id === "a").text).toBe("失敗後に送り直す最新の内容");
    expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("失敗後に送り直す最新の内容");
    await expect(page.getByText("Supabase に送れませんでした：一時的な通信失敗")).toHaveCount(0);
    expect(await page.evaluate(() => window.__outlineSync.maxActive)).toBe(1);
    await page.clock.fastForward(16_000);
    expect(await writes(page)).toHaveLength(2);
  });
}
