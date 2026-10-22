import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const KEY = "taskspace-outline-v1";
const REMOTE_KEY = "test-outline-remote";

// サーバーの応答だけを差し替える。空配列は取得成功、nullは取得失敗。
// 画面・Provider・木の操作・IndexedDBは本物を動かす。
const dbModule = `
export async function loadOutlineRows() {
  const state = window.__outlineSync;
  state.reads += 1;
  if (state.holdReadsRemaining > 0) {
    state.holdReadsRemaining -= 1;
    await new Promise((resolve) => state.readPending.push(resolve));
  }
  return JSON.parse(sessionStorage.getItem("test-outline-remote"));
}
export async function loadOutlineRevisions() {
  const state = window.__outlineSync;
  if (state.holdReadsRemaining > 0) {
    state.holdReadsRemaining -= 1;
    await new Promise((resolve) => state.readPending.push(resolve));
  }
  return state.cas ? new Map(Object.entries(state.revisions)) : undefined;
}
export async function saveOutlineRowsCas(rows, gone, operationId, expected) {
  const state = window.__outlineSync;
  if (!state.cas) return undefined;
  state.casWrites.push(structuredClone({ rows, gone, operationId, expected: [...expected] }));
  const conflicts = [...expected].filter(([id, revision]) => Number(state.revisions[id] || 0) !== revision)
    .map(([id, revision]) => ({ id, expected_revision: revision, actual_revision: Number(state.revisions[id] || 0) }));
  if (conflicts.length || state.conflict) return { conflicts: conflicts.length ? conflicts : [{ id: rows[0]?.id || gone[0], actual_revision: 99 }] };
  const error = await saveOutlineRows(rows, gone);
  if (error) return { error };
  const accepted = new Map();
  for (const id of [...rows.map((row) => row.id), ...gone]) {
    state.revisions[id] = Number(state.revisions[id] || 0) + 1;
    accepted.set(id, state.revisions[id]);
  }
  return { revisions: accepted };
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
    const echo = state.echoTimes ? sent.rows.map((row) => ({
      ...row,
      createdAt: row.createdAt?.replace("Z", "+00:00"),
      updatedAt: row.updatedAt?.replace("Z", "+00:00"),
    })) : sent.rows;
    for (const row of echo) byId.set(row.id, row);
    if (state.echoTimes) setTimeout(() => state.onRows?.({ rows: echo, gone: sent.gone }), 10);
    sessionStorage.setItem("test-outline-remote", JSON.stringify([...byId.values()]));
    return null;
  } finally {
    state.active -= 1;
  }
}
export function subscribeOutline(onRows, onStatus) {
  const state = window.__outlineSync;
  state.onRows = onRows;
  onStatus("live");
  return () => { if (state.onRows === onRows) state.onRows = null; };
}
export const supabaseReady = () => true;
export const absentOutlineColumns = () => window.__outlineSync.columns || [];
export const isOutlineTableMissing = () => false;
export const outlineTableSql = () => "";
export const outlineColumnsSql = () => "";
export const clearOutlineRows = async () => null;
`;

// 保存の返事を制御する試験だけ、実際の保存ヘルパーの前で待つ・失敗を返す。
const storageModule = `
import { bigGet as get, bigPut as put } from "/src/lib/localstore.js?test-local-real";
export async function bigGet(key, options) {
  if (key === "taskspace-outline-v1" && window.__outlineStorage.holdRead) {
    await new Promise((resolve) => window.__outlineStorage.readPending.push(resolve));
  }
  if (key === "taskspace-outline-v1" && window.__outlineStorage.readFail && options?.throwOnError) {
    throw new Error("試験用の読み出し失敗");
  }
  return get(key, options);
}
export async function bigPut(key, value) {
  if (key !== "taskspace-outline-v1") return put(key, value);
  const state = window.__outlineStorage;
  const attempt = structuredClone(value);
  state.writes.push(attempt);
  state.active += 1;
  state.maxActive = Math.max(state.maxActive, state.active);
  try {
    const ok = state.hold
      ? await new Promise((resolve) => state.pending.push(resolve))
      : !state.fail;
    const result = ok ? await put(key, value) : false;
    state.completed.push({ value: attempt, ok: result });
    return result;
  } finally {
    state.active -= 1;
  }
}
`;

const node = (id, text) => ({
  id, text, children: [],
  favorite: false, collapsed: false, completed: false,
  date: null, headingLevel: null, textColor: null, bgColor: null, imageWidth: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
});
const saved = () => [node("a", "前に同期した行"), node("b", "もうひとつの行")];
// db.jsが受信時に返す行と、項目の並びも揃える（同じ行の通知判定に使う）。
const asRows = (nodes, parentId = null) => nodes.flatMap((node, sortOrder) => [{
  id: node.id, parentId, sortOrder, text: node.text,
  collapsed: node.collapsed, completed: node.completed, favorite: node.favorite,
  date: node.date, headingLevel: node.headingLevel,
  textColor: node.textColor, bgColor: node.bgColor, imageWidth: node.imageWidth,
  createdAt: node.createdAt, updatedAt: node.updatedAt,
}, ...asRows(node.children || [], node.id)]);

async function open(page, { local = saved(), remote = asRows(local), known = asRows(local).map((row) => row.id), storage = {}, localRecord, waitForRemote = true, seedLocal = true, cas = false, conflict = false } = {}) {
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://127.0.0.1:4174/")
      ? route.continue() : route.abort());
  await page.route(/\/src\/lib\/db\.js(?:\?.*)?$/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: dbModule }));
  await page.route(/\/src\/lib\/localstore\.js$/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: storageModule }));
  await page.addInitScript(({ key, remoteKey, local, remote, known, storage, seedLocal, cas, conflict }) => {
    // リロードで初期値を入れ直すと、保存・読み直しの不具合を隠してしまう。
    if (!sessionStorage.getItem("test-outline-seeded")) {
      if (seedLocal) {
        localStorage.setItem(key, JSON.stringify(local));
        localStorage.setItem("taskspace-outline-known", JSON.stringify(known));
      }
      sessionStorage.setItem(remoteKey, JSON.stringify(remote));
      sessionStorage.setItem("test-outline-seeded", "1");
    }
    window.__outlineSync = {
      reads: 0, writes: [], casWrites: [], pending: [], hold: false, active: 0, maxActive: 0,
      holdReadsRemaining: 0, readPending: [],
      cas, conflict, revisions: Object.fromEntries((remote || []).map((row) => [row.id, 1])),
    };
    window.__outlineStorage = {
      writes: [], completed: [], pending: [], active: 0, maxActive: 0,
      localFail: false, fail: false, hold: false, holdRead: false, readPending: [],
      readFail: sessionStorage.getItem("test-outline-read-fail") === "1", ...storage,
    };
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key && window.__outlineStorage.localFail) {
        throw new DOMException("試験用の容量不足", "QuotaExceededError");
      }
      return nativeSet.call(this, name, value);
    };
  }, { key: KEY, remoteKey: REMOTE_KEY, local: localRecord ?? local, remote, known, storage, seedLocal, cas, conflict });
  await page.clock.install();
  await page.goto("/sync-tests/fixture.html");
  if (waitForRemote) await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  else await expect(page.locator("[data-outliner]")).toBeVisible();
}

const empty = (page) => page.locator("[data-outline-empty]");
const storedRecord = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
const stored = async (page) => { const value = await storedRecord(page); return Array.isArray(value) ? value : value?.nodes ?? null; };
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
  await expect.poll(() => storedBig(page)).toEqual([]);
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

// 古い通知だけを届ける場合と、実際の他端末の更新を分ける。
async function emitRemote(page, rows, { gone = [], persist = false } = {}) {
  await page.evaluate(({ rows, gone, persist }) => {
    const state = window.__outlineSync;
    if (!state.onRows) throw new Error("受信の準備ができていません");
    if (persist) {
      const remote = JSON.parse(sessionStorage.getItem("test-outline-remote")) || [];
      const byId = new Map(remote.map((row) => [row.id, row]));
      for (const id of gone) byId.delete(id);
      for (const row of rows) byId.set(row.id, row);
      sessionStorage.setItem("test-outline-remote", JSON.stringify([...byId.values()]));
    }
    state.onRows({ rows, gone });
  }, { rows, gone, persist });
}
const pauseClock = async (page) => page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
const tombs = async (page) => (await storedRecord(page))?.sync?.deleted || [];
async function deleteRow(page, id) {
  await page.locator(`[data-row-menu="${id}"]`).click();
  await page.locator("[data-row-delete]").click();
  await expect(page.locator(`[data-row="${id}"]`)).toHaveCount(0);
}

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
  const echo = (await writes(page))[0].rows.find((row) => row.id === id);
  await emitRemote(page, [echo]);
  await page.clock.runFor(300);
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

const localError = (page) => page.locator("[data-outline-local-error]");
const localRetryButton = (page) => page.locator("[data-outline-local-retry]");
const storageState = (page) => page.evaluate(() => ({
  writes: window.__outlineStorage.writes,
  completed: window.__outlineStorage.completed,
  active: window.__outlineStorage.active,
  maxActive: window.__outlineStorage.maxActive,
  pending: window.__outlineStorage.pending.length,
}));
const configureStorage = (page, patch) => page.evaluate((patch) => { Object.assign(window.__outlineStorage, patch); }, patch);
const storedBig = (page) => page.evaluate(async () => {
  const { bigGet } = await import("/src/lib/localstore.js?test-local-real");
  return (await bigGet("taskspace-outline-v1"))?.nodes;
});
async function openStorage(page, storage = {}) {
  // 向こうを読めなくても、手元の保存と再試行だけで守れることを確認する。
  await open(page, { remote: null, storage });
  await expect.poll(async () => (await storageState(page)).active).toBe(0);
}
async function expectLocalResult(page, text, ok) {
  await expect.poll(async () => (await storageState(page)).completed.some(
    (attempt) => attempt.value.nodes.some((n) => n.id === "a" && n.text === text) && attempt.ok === ok,
  )).toBe(true);
}
async function releaseLocal(page, ok) {
  await page.evaluate((ok) => {
    const resolve = window.__outlineStorage.pending.shift();
    if (!resolve) throw new Error("止めている端末保存がありません");
    resolve(ok);
  }, ok);
}

test("小さい置き場が一杯でも、大きい置き場へ確定してから保存の案内を出す", async ({ page }) => {
  await openStorage(page);
  await configureStorage(page, { localFail: true, hold: true });
  await editRow(page, "a", "大きい置き場で守る内容");
  await expect.poll(async () => (await storageState(page)).pending).toBe(1);
  await expect(page.locator("[data-outline-local-saving]")).toBeVisible();
  await expect(page.locator("[data-outline-toobig]")).toHaveCount(0);
  await expect(localError(page)).toHaveCount(0);

  await releaseLocal(page, true);
  await expect(page.locator("[data-outline-toobig]")).toContainText("この端末の大きな置き場に保存しました");
  await expect.poll(async () => (await storedBig(page))?.find((n) => n.id === "a")?.text).toBe("大きい置き場で守る内容");
  expect(await stored(page)).toBeNull();
  await page.reload();
  await expect(page.locator('[data-row="a"]')).toContainText("大きい置き場で守る内容");
});

test("大きい置き場が使えなくても、小さい置き場に残せた内容は失敗扱いしない", async ({ page }) => {
  await openStorage(page);
  await configureStorage(page, { fail: true });
  await editRow(page, "a", "小さい置き場で守る内容");
  await expectLocalResult(page, "小さい置き場で守る内容", false);
  await expect(localError(page)).toHaveCount(0);
  expect((await stored(page)).find((n) => n.id === "a").text).toBe("小さい置き場で守る内容");
  await page.reload();
  await expect(page.locator('[data-row="a"]')).toContainText("小さい置き場で守る内容");
});

test("どちらにも保存できないときは知らせ、書き出しと手動の再保存で最新の内容を守る", async ({ page }) => {
  await openStorage(page);
  await configureStorage(page, { localFail: true, fail: true });
  await editRow(page, "a", "まだ保存できていない内容");
  await expect(localError(page)).toBeVisible();
  await expect(page.locator("[data-outline-toobig]")).toHaveCount(0);
  await editRow(page, "a", "再試行までの書きかけ");
  await expectLocalResult(page, "再試行までの書きかけ", false);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-outline-local-export]").click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), "utf8");
  expect(() => JSON.parse(exported)).not.toThrow();
  expect(exported).toContain("再試行までの書きかけ");

  await configureStorage(page, { fail: false, hold: true });
  await localRetryButton(page).click();
  await expect(localRetryButton(page)).toBeDisabled();
  await expect(localError(page)).toBeVisible();
  await expect.poll(async () => (await storageState(page)).pending).toBe(1);
  await releaseLocal(page, true);
  await expect(localError(page)).toHaveCount(0);
  expect((await storedBig(page)).find((n) => n.id === "a").text).toBe("再試行までの書きかけ");
  await page.reload();
  await expect(page.locator('[data-row="a"]')).toContainText("再試行までの書きかけ");
});

test("保存失敗のあとは、操作しなくても15秒後にもう一度保存する", async ({ page }) => {
  await openStorage(page);
  await configureStorage(page, { localFail: true, fail: true });
  await editRow(page, "a", "自動でも保存し直す内容");
  await expect(localError(page)).toBeVisible();
  const count = (await storageState(page)).writes.length;
  await configureStorage(page, { fail: false });
  await page.clock.fastForward(14_000);
  expect((await storageState(page)).writes).toHaveLength(count);
  await page.clock.runFor(2_000);
  await expect(localError(page)).toHaveCount(0);
  await expectLocalResult(page, "自動でも保存し直す内容", true);
  expect((await storedBig(page)).find((n) => n.id === "a").text).toBe("自動でも保存し直す内容");
  await page.clock.fastForward(16_000);
  expect((await storageState(page)).writes).toHaveLength(count + 1);
});

test("起動時に保存できなかった場合も、編集を待たずに失敗を知らせる", async ({ page }) => {
  await openStorage(page, { localFail: true, fail: true });
  await expect(localError(page)).toBeVisible();
  await expect(page.locator('[data-row="a"]')).toContainText("前に同期した行");
  await configureStorage(page, { fail: false });
  await localRetryButton(page).click();
  await expect(localError(page)).toHaveCount(0);
  expect((await storedBig(page)).find((n) => n.id === "a").text).toBe("前に同期した行");
});

test("古い保存が成功しても、待っている最新の内容まで保存済みにしない", async ({ page }) => {
  await openStorage(page);
  await configureStorage(page, { localFail: true, hold: true });
  await editRow(page, "a", "先に保存した内容");
  await expect.poll(async () => (await storageState(page)).pending).toBe(1);
  await editRow(page, "a", "まだ保存されていない最新の内容");
  await editRow(page, "a", "最後に保存したい内容");

  await releaseLocal(page, true);
  await expectLocalResult(page, "先に保存した内容", true);
  await expect.poll(async () => (await storageState(page)).pending).toBe(1);
  await expect(page.locator("[data-outline-toobig]")).toHaveCount(0);
  await expect(page.locator("[data-outline-local-saving]")).toBeVisible();
  await releaseLocal(page, false);
  await expect(localError(page)).toBeVisible();
  await expectLocalResult(page, "最後に保存したい内容", false);
  const state = await storageState(page);
  expect(state.writes.filter((attempt) => attempt.nodes.some((n) => n.text === "まだ保存されていない最新の内容"))).toHaveLength(0);
  expect(state.maxActive).toBe(1);
  await configureStorage(page, { hold: false, fail: false });
  await localRetryButton(page).click();
  await expect(localError(page)).toHaveCount(0);
  expect((await storedBig(page)).find((n) => n.id === "a").text).toBe("最後に保存したい内容");
});

test("古い保存が失敗しても、あとから小さい置き場に残せた内容へ失敗を出さない", async ({ page }) => {
  await openStorage(page);
  await configureStorage(page, { localFail: true, hold: true });
  await editRow(page, "a", "先の保存は失敗する内容");
  await expect.poll(async () => (await storageState(page)).pending).toBe(1);
  await configureStorage(page, { localFail: false });
  await editRow(page, "a", "あとから残せた内容");
  await releaseLocal(page, false);
  await expect.poll(async () => (await storageState(page)).pending).toBe(1);
  await expect(localError(page)).toHaveCount(0);
  await releaseLocal(page, false);
  await expect.poll(async () => (await storageState(page)).active).toBe(0);
  await expect(localError(page)).toHaveCount(0);
  expect((await stored(page)).find((n) => n.id === "a").text).toBe("あとから残せた内容");
  expect((await storageState(page)).maxActive).toBe(1);
});

test("端末保存とSupabaseの両方で失敗しても、互いの知らせを消さない", async ({ page }) => {
  await open(page);
  await expect.poll(async () => (await storageState(page)).active).toBe(0);
  // 先に端末へ確定した送信を待たせ、その間の次の編集だけ保存に失敗させる。
  await startHeldWrite(page);
  await configureStorage(page, { localFail: true, fail: true });
  await editRow(page, "b", "送信を待つあいだの書きかけ");
  await expect(localError(page)).toBeVisible();
  await releaseWrite(page, { error: "同期の試験失敗" });
  const remoteError = page.locator("[data-outline-sync-error]");
  await expect(remoteError).toContainText("同期の試験失敗");
  await expect(localError(page)).toBeVisible();
  await expect(page.getByText("この端末にしか残っていません", { exact: true })).toHaveCount(0);
  await configureStorage(page, { fail: false });
  await localRetryButton(page).click();
  await expect(localError(page)).toHaveCount(0);
  await expect(remoteError).toContainText("同期の試験失敗");
});

test("起動時に本体を読めず手元の写しも無いときは、本物を書き換えず書きかけを退避できる", async ({ page }) => {
  await openStorage(page);
  await editRow(page, "a", "読み出せなくても守る本物");
  await expectLocalResult(page, "読み出せなくても守る本物", true);
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    sessionStorage.setItem("test-outline-read-fail", "1");
  }, KEY);
  await page.reload();
  await expect(page.locator("[data-outline-local-read-error]")).toBeVisible();
  await editRow(page, "start", "読み出し待ちの書きかけ");
  await page.clock.fastForward(16_000);
  expect((await storageState(page)).writes).toEqual([]);
  expect(await stored(page)).toBeNull();
  expect((await storedBig(page)).find((n) => n.id === "a").text).toBe("読み出せなくても守る本物");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-outline-local-export]").click();
  const download = await downloadPromise;
  expect(await readFile(await download.path(), "utf8")).toContain("読み出し待ちの書きかけ");
  await page.evaluate(() => sessionStorage.removeItem("test-outline-read-fail"));
  await page.reload();
  await expect(page.locator('[data-row="a"]')).toContainText("読み出せなくても守る本物");
});

for (const format of ["旧形式", "新形式"]) {
  test(`${format}の小さい控えがあっても、大きい控えを読めなければ保存と同期を止める`, async ({ page }) => {
    if (format === "新形式") {
      await open(page);
      await page.evaluate(() => sessionStorage.setItem("test-outline-read-fail", "1"));
      await page.reload();
    } else {
      await open(page, { storage: { readFail: true }, waitForRemote: false });
    }
    await expect(page.locator("[data-outline-local-read-error]")).toBeVisible();
    const before = await storedRecord(page);
    await editRow(page, "a", "確認待ちの書きかけ");
    expect(await storedRecord(page)).toEqual(before);
    expect((await storageState(page)).writes).toEqual([]);
    expect(await writes(page)).toEqual([]);
    expect(await page.evaluate(() => window.__outlineSync.reads)).toBe(0);
    if (format === "新形式") {
      await page.evaluate(() => sessionStorage.removeItem("test-outline-read-fail"));
      await page.reload();
      await expect(page.locator('[data-row="a"]')).toContainText(saved()[0].text);
    }
  });
}

test("字下げした行と並びが変わった行を送り、古い受信で移動を巻き戻さない", async ({ page }) => {
  const local = [...saved(), node("c", "順番が変わる行")];
  await open(page, { local });
  await pauseClock(page);
  await page.locator('[data-row="b"] [data-row-text]').click();
  await inputFor(page, "b").press("Tab");
  await expect.poll(async () => (await stored(page))[0].children.map((n) => n.id)).toEqual(["b"]);
  // 同期済みの行と同じ通知として省かれない、移動前の内容を届ける。
  await emitRemote(page, asRows(local).filter((row) => ["b", "c"].includes(row.id))
    .map((row) => ({ ...row, text: row.text + "（古い通知）" })));
  await page.clock.runFor(300);
  await expect.poll(async () => (await stored(page))[0].children.map((n) => n.id)).toEqual(["b"]);
  // 受信の反映後に始まる800msの送信待ちも進める。
  await page.clock.runFor(1_000);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  const sent = (await writes(page))[0].rows;
  expect(sent.find((row) => row.id === "b").text).toBe(local[1].text);
  expect(sent.find((row) => row.id === "c").text).toBe(local[2].text);
  expect(sent.map((row) => row.id).sort()).toEqual(["b", "c"]);
  expect(sent.find((row) => row.id === "b").parentId).toBe("a");
  expect(sent.every((row) => row.updatedAt > local[1].updatedAt)).toBe(true);

  await emitRemote(page, [{ ...asRows(local)[0], text: "別の行の受信", updatedAt: "2040-01-01T00:00:00.000Z" }], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="a"]')).toContainText("別の行の受信");
  expect((await stored(page))[0].children[0].id).toBe("b");
});

test("受信してから削除した行も、反映待ちの通知から復活させない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await emitRemote(page, [{ ...asRows(saved())[1], text: "反映待ちの古い内容" }]);
  await deleteRow(page, "b");
  expect(await tombs(page)).toContain("b");
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
  await page.clock.runFor(600);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect((await writes(page))[0].gone).toEqual(["b"]);
});

test("削除の送信が失敗しても、再試行を待つ間の受信で行を戻さない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await holdWrites(page);
  await deleteRow(page, "b");
  await page.clock.runFor(1_000);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  await emitRemote(page, [{ ...asRows(saved())[1], text: "送信中の古い通知" }]);
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  await releaseWrite(page, { error: "削除の試験失敗" });
  expect(await tombs(page)).toContain("b");
  await emitRemote(page, [{ ...asRows(saved())[1], text: "再試行中の古い通知" }]);
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  await page.clock.fastForward(15_000);
  // 再試行の描画のあとに登録される送信タイマーも、止めた時計で進める。
  await expect.poll(async () => {
    await page.clock.runFor(1_000);
    return (await writes(page)).length;
  }).toBe(2);
  expect((await writes(page))[1].gone).toEqual(["b"]);
  expect((await remoteRows(page)).some((row) => row.id === "b")).toBe(false);
});

test("削除を取り消すと印をすぐ外し、やり直すと受信による復活を再び止める", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await deleteRow(page, "b");
  expect(await tombs(page)).toContain("b");
  await page.locator("[data-outline-undo]").click();
  await expect(page.locator('[data-row="b"]')).toBeVisible();
  expect(await tombs(page)).not.toContain("b");
  await page.clock.runFor(1_000);
  await expect.poll(async () => (await storedRecord(page)).sync.pending).toEqual([]);
  await emitRemote(page, [{ ...asRows(saved())[1], text: "取り消し後に届いた内容", updatedAt: "2040-01-01T00:00:00.000Z" }], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toContainText("取り消し後に届いた内容");
  await page.locator("[data-outline-redo]").click();
  expect(await tombs(page)).toContain("b");
  await emitRemote(page, [asRows(saved())[1]]);
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
});

test("送信の待機時間中に開き直しても、削除の印を読み戻して削除を送る", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await deleteRow(page, "b");
  expect(await tombs(page)).toContain("b");
  expect(await writes(page)).toEqual([]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  await page.clock.runFor(1_000);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect((await writes(page))[0].gone).toEqual(["b"]);
  expect((await remoteRows(page)).some((row) => row.id === "b")).toBe(false);
});

test("親ごと消した子孫も、個別の受信から復活させない", async ({ page }) => {
  const parent = { ...node("b", "消す親"), children: [node("child", "消す子")] };
  const local = [node("a", "残す行"), parent];
  await open(page, { local });
  await pauseClock(page);
  await deleteRow(page, "b");
  expect((await tombs(page)).sort()).toEqual(["b", "child"]);
  await emitRemote(page, asRows([parent]));
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  await expect(page.locator('[data-row="child"]')).toHaveCount(0);
  await page.clock.runFor(600);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect((await writes(page))[0].gone.sort()).toEqual(["b", "child"]);
});

test("送信基準にまだ無い行の削除も、受信で戻さず削除要求を送る", async ({ page }) => {
  const draft = node("draft", "まだ送っていない行");
  await open(page, { local: [node("a", "残す行"), draft], remote: asRows([node("a", "残す行")]), known: ["a"] });
  await pauseClock(page);
  await deleteRow(page, "draft");
  expect(await tombs(page)).toContain("draft");
  await emitRemote(page, asRows([draft]), { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="draft"]')).toHaveCount(0);
  await page.clock.runFor(600);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect((await writes(page))[0].gone).toEqual(["draft"]);
  expect((await remoteRows(page)).some((row) => row.id === "draft")).toBe(false);
});

// 一括保存された本文と送信待ちの世代を、再起動・古い返事・保存失敗で確かめる。
const bigRecord = (page, key = KEY) => page.evaluate(async (key) => {
  const { bigGet } = await import("/src/lib/localstore.js?test-local-real");
  return bigGet(key);
}, key);
const advanceToWrites = async (page, count) => expect.poll(async () => {
  await page.clock.runFor(1_000);
  return (await writes(page)).length;
}).toBe(count);
const checkpointSeed = (nodes, { pending = [], deleted = [], known = asRows(nodes).map((row) => row.id), revision = 1, sequence = Math.max(0, ...pending.map((op) => op.version)) } = {}) => ({
  format: "taskspace-outline/1", revision, at: "2026-10-21T00:00:00.000Z", nodes,
  sync: { pending, deleted, known, sequence },
});

test("旧形式の控えを残してから、本文と未送信記録の一括保存へ切り替える", async ({ page }) => {
  await open(page, { remote: null });
  await expect.poll(async () => (await storedRecord(page))?.format).toBe("taskspace-outline/1");
  const old = await bigRecord(page, KEY + "-legacy-copy");
  expect(old.nodes).toEqual(saved());
  expect(old.known).toEqual(["a", "b"]);
  expect(old.deleted).toEqual([]);
  await editRow(page, "a", "本文と一緒に残す変更");
  const record = await storedRecord(page);
  expect(record.nodes.find((n) => n.id === "a").text).toBe("本文と一緒に残す変更");
  expect(record.sync.pending).toEqual([expect.objectContaining({ id: "a", kind: "put" })]);
  expect((await bigRecord(page, KEY + "-legacy-copy")).nodes).toEqual(saved());
});

test("圏外で確定した編集は、開き直したとき向こうに行が無くても残して送る", async ({ page }) => {
  await open(page, { remote: null });
  await editRow(page, "a", "圏外から続ける内容");
  expect((await storedRecord(page)).sync.pending.map((op) => op.id)).toEqual(["a"]);
  await page.evaluate((key) => sessionStorage.setItem(key, "[]"), REMOTE_KEY);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(page.locator('[data-row="a"]')).toContainText("圏外から続ける内容");
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  await pauseClock(page);
  await advanceToWrites(page, 1);
  expect((await writes(page))[0].rows.map((row) => row.id)).toEqual(["a"]);
  await expect.poll(async () => (await storedRecord(page)).sync.pending).toEqual([]);
  expect((await remoteRows(page))[0].text).toBe("圏外から続ける内容");
});

test("未送信の編集は起動時の新しい受信で消さず、送信後は次の受信を採れる", async ({ page }) => {
  await open(page, { remote: null });
  await editRow(page, "a", "まず送りたい草稿");
  await page.evaluate(({ key, rows }) => sessionStorage.setItem(key, JSON.stringify(rows)),
    { key: REMOTE_KEY, rows: asRows(saved()).map((row) => row.id === "a" ? { ...row, text: "向こうの内容", updatedAt: "2040-01-01" } : row) });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(page.locator('[data-row="a"]')).toContainText("まず送りたい草稿");
  await pauseClock(page);
  await advanceToWrites(page, 1);
  await expect.poll(async () => (await storedRecord(page)).sync.pending).toEqual([]);
  await emitRemote(page, [{ ...asRows(saved())[0], text: "送信後の受信", updatedAt: "2050-01-01" }], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="a"]')).toContainText("送信後の受信");
});

test("送信中に閉じても、返事を待っていた編集を同じ行へ送り直す", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await holdWrites(page);
  await editRow(page, "a", "返事を失っても残す内容");
  await advanceToWrites(page, 1);
  // サーバーには届いたが、返事を受け取る前に画面を閉じた場合。
  const sent = (await writes(page))[0].rows;
  await emitRemote(page, sent, { persist: true });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  expect((await storedRecord(page)).sync.pending.map((op) => op.id)).toEqual(["a"]);
  await pauseClock(page);
  await advanceToWrites(page, 1);
  await expect.poll(async () => (await storedRecord(page)).sync.pending).toEqual([]);
  const remote = await remoteRows(page);
  expect(remote.filter((row) => row.id === "a")).toHaveLength(1);
  expect(remote.find((row) => row.id === "a").text).toBe("返事を失っても残す内容");
});

test("古い送信の完了後に開き直しても、送信中に直した次の世代を失わない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await holdWrites(page);
  await editRow(page, "a", "先に送る世代");
  await advanceToWrites(page, 1);
  const old = (await storedRecord(page)).sync.pending.find((op) => op.id === "a");
  await editRow(page, "a", "次に送る新しい世代");
  await releaseWrite(page);
  await expect.poll(async () => (await storedRecord(page)).sync.pending.find((op) => op.id === "a")?.version).toBeGreaterThan(old.version);
  expect((await storedRecord(page)).nodes.find((n) => n.id === "a").text).toBe("次に送る新しい世代");
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await pauseClock(page);
  await advanceToWrites(page, 1);
  expect((await writes(page))[0].rows.find((row) => row.id === "a").text).toBe("次に送る新しい世代");
  await expect.poll(async () => (await storedRecord(page)).sync.pending).toEqual([]);
});

test("削除の送信中に取り消すと、前の削除の完了後も復元の世代を残す", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await holdWrites(page);
  await deleteRow(page, "b");
  await advanceToWrites(page, 1);
  await page.locator("[data-outline-undo]").click();
  await releaseWrite(page);
  const restored = (await storedRecord(page)).sync.pending.find((op) => op.id === "b");
  expect(restored.kind).toBe("put");
  expect(await tombs(page)).not.toContain("b");
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(page.locator('[data-row="b"]')).toContainText(saved()[1].text);
  await pauseClock(page);
  await advanceToWrites(page, 1);
  expect((await writes(page))[0].rows.map((row) => row.id)).toContain("b");
  expect((await remoteRows(page)).some((row) => row.id === "b")).toBe(true);
});

test("IndexedDBだけに残した本文・編集・削除も、同じ控えから復元して送る", async ({ page }) => {
  await open(page, { remote: null });
  await configureStorage(page, { localFail: true });
  await editRow(page, "a", "大きい置き場から送る内容");
  await deleteRow(page, "b");
  await expect.poll(async () => (await bigRecord(page))?.sync?.pending.map((op) => [op.id, op.kind]).sort())
    .toEqual([["a", "put"], ["b", "delete"]]);
  expect(await stored(page)).toBeNull();
  await page.evaluate(({ key, rows }) => sessionStorage.setItem(key, JSON.stringify(rows)), { key: REMOTE_KEY, rows: asRows(saved()) });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(page.locator('[data-row="a"]')).toContainText("大きい置き場から送る内容");
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  await pauseClock(page);
  await advanceToWrites(page, 1);
  expect((await writes(page))[0].gone).toEqual(["b"]);
  expect((await writes(page))[0].rows.find((row) => row.id === "a").text).toBe("大きい置き場から送る内容");
});

test("本文と未送信記録が端末に確定するまでは、ネットワークへ送らない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await configureStorage(page, { localFail: true, hold: true });
  await editRow(page, "a", "確定してから送る内容");
  await expect.poll(async () => (await storageState(page)).pending).toBe(1);
  await page.clock.runFor(1_000);
  expect(await writes(page)).toEqual([]);
  await releaseLocal(page, true);
  await expect.poll(async () => (await storageState(page)).pending).toBe(1);
  expect(await writes(page)).toEqual([]);
  await releaseLocal(page, true);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect((await writes(page))[0].rows.find((row) => row.id === "a").text).toBe("確定してから送る内容");
});

test("両方の端末保存に失敗した未送信記録は送らず、再保存後に送信する", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await configureStorage(page, { localFail: true, fail: true });
  await editRow(page, "a", "保存し直してから送る内容");
  await expect(localError(page)).toBeVisible();
  await page.clock.runFor(1_000);
  expect(await writes(page)).toEqual([]);
  await configureStorage(page, { fail: false });
  await localRetryButton(page).click();
  await advanceToWrites(page, 1);
  expect((await writes(page))[0].rows.find((row) => row.id === "a").text).toBe("保存し直してから送る内容");
});

test("起動中の編集を、あとから読み出した新しい控えで消さない", async ({ page }) => {
  const here = checkpointSeed(saved());
  await open(page, { localRecord: here, storage: { holdRead: true }, waitForRemote: false });
  await expect.poll(() => page.evaluate(() => window.__outlineStorage.readPending.length)).toBeGreaterThan(0);
  const there = checkpointSeed([node("a", "保存済みのa"), node("b", "新しい控えのb")], { revision: 5, sequence: 10 });
  await page.evaluate(async ({ key, record }) => {
    const { bigPut } = await import("/src/lib/localstore.js?test-local-real");
    if (!await bigPut(key, record)) throw new Error("試験の控えを保存できません");
  }, { key: KEY, record: there });
  await editRow(page, "a", "読み込み待ちに打った内容");
  await page.evaluate(() => {
    window.__outlineStorage.holdRead = false;
    for (const resolve of window.__outlineStorage.readPending.splice(0)) resolve();
  });
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(page.locator('[data-row="a"]')).toContainText("読み込み待ちに打った内容");
  await expect(page.locator('[data-row="b"]')).toContainText("新しい控えのb");
  expect((await storedRecord(page)).sync.pending.find((op) => op.id === "a").version).toBeGreaterThan(10);
});

test("読めない将来の形式は、空の木や新しい未送信記録で上書きしない", async ({ page }) => {
  const future = { ...checkpointSeed(saved()), format: "taskspace-outline/99" };
  await open(page, { localRecord: future, waitForRemote: false });
  await expect(page.locator("[data-outline-local-read-error]")).toBeVisible();
  await page.clock.fastForward(20_000);
  expect(await storedRecord(page)).toEqual(future);
  expect(await writes(page)).toEqual([]);
  expect((await storageState(page)).writes).toEqual([]);
});

test("新形式の空になった削除記録より、古い別保存の印を優先しない", async ({ page }) => {
  await open(page, { local: [saved()[0]], remote: [asRows(saved())[0]], localRecord: checkpointSeed([saved()[0]]) });
  await page.evaluate(({ key, rows }) => {
    localStorage.setItem("taskspace-outline-deleted", '["b"]');
    sessionStorage.setItem(key, JSON.stringify(rows));
  }, { key: REMOTE_KEY, rows: asRows(saved()) });
  await page.reload();
  await expect(page.locator('[data-row="b"]')).toContainText(saved()[1].text);
  await pauseClock(page);
  await page.clock.runFor(1_000);
  expect(await writes(page)).toEqual([]);
  expect((await storedRecord(page)).sync.deleted).toEqual([]);
});

test("移行元の古い写しが残っても、IndexedDBに確定した未送信の本文を巻き戻さない", async ({ page }) => {
  await open(page, { remote: null });
  await editRow(page, "a", "移行の確定後に残した内容");
  await expect.poll(async () => (await bigRecord(page))?.nodes.find((n) => n.id === "a").text).toBe("移行の確定後に残した内容");
  await page.evaluate(({ key, original }) => localStorage.setItem(key, JSON.stringify(original)), { key: KEY, original: saved() });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(page.locator('[data-row="a"]')).toContainText("移行の確定後に残した内容");
  expect((await storedRecord(page)).sync.pending.map((op) => op.id)).toEqual(["a"]);
});

test("両方への保存が失敗しても、前に確定した小さい控えは消さない", async ({ page }) => {
  await openStorage(page);
  const before = await storedRecord(page);
  await configureStorage(page, { localFail: true, fail: true });
  await editRow(page, "a", "保存できていない書きかけ");
  await expect(localError(page)).toBeVisible();
  expect(await storedRecord(page)).toEqual(before);
  await page.reload();
  await expect(page.locator('[data-row="a"]')).toContainText(saved()[0].text);
});

test("大きい本文は全体の小さい写しを作らず、編集と送信待ちを開き直して復元する", async ({ page }) => {
  const local = [{ ...node("a", "大きい本文の親"), collapsed: true,
    children: Array.from({ length: 999 }, (_, i) => node("child-" + i, "子の行" + i)) }];
  await open(page, { local, remote: null });
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await editRow(page, "a", "差分で残した親");
  await expect.poll(async () => (await bigRecord(page))?.nodes[0].text).toBe("差分で残した親");
  const record = await bigRecord(page);
  expect(record.large).toBe(true);
  expect(record.sync.pending.map((op) => op.id)).toEqual(["a"]);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await page.reload();
  await expect(page.locator('[data-row="a"]')).toContainText("差分で残した親");
  expect((await bigRecord(page)).nodes[0].children).toHaveLength(999);
});

test("大きい本文の差分保存に失敗したときだけ、全体の写しへ退避して復旧する", async ({ page }) => {
  const local = [{ ...node("a", "大きい本文の親"), collapsed: true,
    children: Array.from({ length: 999 }, (_, i) => node("child-" + i, "子の行" + i)) }];
  await open(page, { local, remote: null });
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await configureStorage(page, { fail: true });
  await editRow(page, "a", "退避して守る内容");
  await expect.poll(async () => (await storedRecord(page))?.nodes[0].text).toBe("退避して守る内容");
  expect((await storedRecord(page)).sync.pending.map((op) => op.id)).toEqual(["a"]);
  await expect(localError(page)).toHaveCount(0);
  await configureStorage(page, { fail: false });
  // 保存失敗からの退避後も、同じ手元の変更で差分保存をやり直せる。
  await editRow(page, "a", "差分保存へ戻した内容");
  await expect.poll(async () => (await bigRecord(page))?.nodes[0].text).toBe("差分保存へ戻した内容");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await page.reload();
  await expect(page.locator('[data-row="a"]')).toContainText("差分保存へ戻した内容");
});

test("大きい文書を小さくしたあと開き直しても、毎回の全体コピーへ戻さない", async ({ page }) => {
  const local = [{ ...node("a", "消す親"), collapsed: true,
    children: Array.from({ length: 998 }, (_, i) => node("child-" + i, "子")) }, node("b", "残す行")];
  await open(page, { local, remote: null });
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await deleteRow(page, "a");
  await expect.poll(async () => (await bigRecord(page))?.nodes.map((n) => n.id)).toEqual(["b"]);
  expect((await bigRecord(page)).large).toBe(true);
  await page.reload();
  await expect(page.locator('[data-row="b"]')).toContainText("残す行");
  await editRow(page, "b", "小さくしてからの編集");
  await expect.poll(async () => (await bigRecord(page))?.nodes[0].text).toBe("小さくしてからの編集");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});


const syncChip = (page) => page.locator("[data-outline-sync]");
async function settleSync(page) {
  await expect.poll(async () => {
    await page.clock.runFor(1000);
    return syncChip(page).getAttribute("data-sync");
  }).toBe("synced");
}

test("接続中でも向こうを読めなければ同期済みと表示しない", async ({ page }) => {
  await open(page, { remote: null });
  await expect(page.locator("[data-outline-link]")).toHaveAttribute("data-link", "live");
  await expect(syncChip(page)).toHaveAttribute("data-sync", "checking");
  await editRow(page, "a", "読み込みを待つ編集");
  await page.clock.runFor(3000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "waiting");
  expect(await writes(page)).toEqual([]);
});

test("接続表示とは別に送信待ち・送信中・同期済みを表示する", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await holdWrites(page);
  await editRow(page, "a", "送信状態を確認する");
  await expect(syncChip(page)).toHaveAttribute("data-sync", "waiting");
  await page.clock.runFor(300);
  expect(await writes(page)).toEqual([]);
  await page.clock.runFor(600);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "sending");
  await expect(page.locator("[data-outline-link]")).toHaveAttribute("data-link", "live");
  await releaseWrite(page);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
});

test("古い送信が完了しても追加編集が残る間は同期済みにしない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await startHeldWrite(page);
  await editRow(page, "a", "返事を待つ間の編集");
  await expect(syncChip(page)).toHaveAttribute("data-sync", "sending");
  await releaseWrite(page);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "waiting");
  await holdWrites(page);
  await advanceToWrites(page, 2);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "sending");
  await releaseWrite(page);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("返事を待つ間の編集");
});

test("入力を止めなくても最初の変更から2秒以内に最新の本文を送り始める", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await holdWrites(page);
  for (let i = 0; i < 7; i += 1) {
    await editRow(page, "a", `連続入力${i}`);
    await expect.poll(async () => (await stored(page))[0].text).toBe(`連続入力${i}`);
    await page.clock.runFor(300);
  }
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect((await writes(page))[0].rows.find((row) => row.id === "a").text).toBe("連続入力6");
  await expect(syncChip(page)).toHaveAttribute("data-sync", "sending");
  for (let i = 7; i < 15; i += 1) {
    await editRow(page, "a", `連続入力${i}`);
    await page.clock.runFor(300);
  }
  expect(await writes(page)).toHaveLength(1);
  await releaseWrite(page);
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("連続入力14");
  expect(await page.evaluate(() => window.__outlineSync.maxActive)).toBe(1);
});

test("保存失敗中は接続していても同期済みと表示しない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await page.evaluate(() => {
    window.__outlineStorage.localFail = true;
    window.__outlineStorage.fail = true;
  });
  await editRow(page, "a", "まだ保存できない");
  await expect(syncChip(page)).toHaveAttribute("data-sync", "local-error");
  await page.clock.runFor(3000);
  expect(await writes(page)).toHaveLength(0);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "local-error");
  await page.evaluate(() => {
    window.__outlineStorage.localFail = false;
    window.__outlineStorage.fail = false;
  });
  await page.clock.runFor(16000);
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("まだ保存できない");
});

test("他端末の受信でこの端末の未送信編集を同期済みにしない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await holdWrites(page);
  await editRow(page, "a", "この端末の編集中");
  const row = { ...asRows(saved())[1], text: "別端末の行", updatedAt: "2026-10-22T00:00:00.000Z" };
  await emitRemote(page, [row], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toContainText("別端末の行");
  await expect(syncChip(page)).toHaveAttribute("data-sync", "waiting");
  await advanceToWrites(page, 1);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "sending");
  await releaseWrite(page);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
});

test("送信失敗を表示し再試行が成功するまで同期済みにしない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await startHeldWrite(page);
  await releaseWrite(page, { error: "試験用の接続失敗" });
  await expect(syncChip(page)).toHaveAttribute("data-sync", "error");
  await page.clock.runFor(16000);
  await settleSync(page);
  expect(await writes(page)).toHaveLength(2);
});

test("サーバー世代を添えて保存し、次の編集は返された世代から続ける", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "CASで送る本文");
  await settleSync(page);
  await editRow(page, "a", "次の世代で送る本文");
  await settleSync(page);
  const writes = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(writes).toHaveLength(2);
  expect(writes[0].expected).toEqual([["a", 1]]);
  expect(writes[1].expected).toEqual([["a", 2]]);
  expect(writes[0].operationId).toMatch(/^[0-9a-f-]{36}$/);
  expect((await storedRecord(page)).sync.pending).toEqual([]);
});

test("世代一覧が一時的に空でも編集前の本文が同じなら現在世代で保存する", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  const reads = await page.evaluate(() => window.__outlineSync.reads);
  await page.evaluate(() => { window.__outlineSync.revisions = {}; });
  await page.locator("[data-outline-link]").click();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(reads);
  await page.evaluate(() => { window.__outlineSync.revisions = { a: 1, b: 1 }; });
  await editRow(page, "a", "世代を読み直して送る本文");
  await settleSync(page);
  const writes = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(writes).toHaveLength(1);
  expect(writes[0].expected).toEqual([["a", 1]]);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
});

test("世代を読み直す間に別端末の本文が変われば保存を止める", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  const reads = await page.evaluate(() => window.__outlineSync.reads);
  await page.evaluate(() => { window.__outlineSync.revisions = {}; });
  await page.locator("[data-outline-link]").click();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(reads);
  await editRow(page, "a", "この端末の本文");
  await page.evaluate((key) => {
    const rows = JSON.parse(sessionStorage.getItem(key));
    rows.find((row) => row.id === "a").text = "別端末の本文";
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.revisions = { a: 2, b: 1 };
  }, REMOTE_KEY);
  await page.clock.runFor(1000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "conflict");
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toHaveLength(0);
});

test("古い端末の保存を止め、本文と操作IDを未送信のまま端末へ残す", async ({ page }) => {
  await open(page, { cas: true, conflict: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "古い端末に残す本文");
  await page.clock.runFor(1000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "conflict");
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("前に同期した行");
  const record = await storedRecord(page);
  expect(record.nodes[0].text).toBe("古い端末に残す本文");
  expect(record.sync.pending[0]).toMatchObject({ id: "a", expectedRevision: 1 });
  expect(record.sync.pending[0].operationId).toMatch(/^[0-9a-f-]{36}$/);
});

test("競合後に向こうへ合わせると未送信記録を再送せず同期済みを保つ", async ({ page }) => {
  await open(page, { cas: true, conflict: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "競合して端末に残る本文");
  await page.clock.runFor(1000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "conflict");
  await page.evaluate(() => { window.__outlineSync.conflict = false; });
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-outline-pull]").click();
  await expect(page.locator('[data-row="a"]')).toContainText("前に同期した行");
  await expect.poll(async () => (await storedRecord(page)).sync.pending).toEqual([]);
  await page.clock.runFor(10000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toHaveLength(1);
});

test("送信前の世代確認中に向こうへ合わせても古い確認結果で競合表示を戻さない", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  const reads = await page.evaluate(() => window.__outlineSync.reads);
  await page.evaluate(() => { window.__outlineSync.revisions = {}; });
  await page.locator("[data-outline-link]").click();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(reads);
  await page.evaluate(() => {
    window.__outlineSync.holdReadsRemaining = 2;
    window.__outlineSync.revisions = { a: 2, b: 1 };
  });
  await editRow(page, "a", "取り込み前の未送信本文");
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.readPending.length)).toBe(2);
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-outline-pull]").click();
  await expect(page.locator('[data-row="a"]')).toContainText("前に同期した行");
  await page.evaluate(() => window.__outlineSync.readPending.splice(0).forEach((resolve) => resolve()));
  await page.clock.runFor(10000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toHaveLength(0);
});

test("保存済み本文を読めない場合は同期表示でも読み出しエラーを知らせる", async ({ page }) => {
  await open(page, { storage: { readFail: true }, waitForRemote: false });
  await expect(syncChip(page)).toHaveAttribute("data-sync", "read-error");
  await page.clock.runFor(3000);
  expect(await writes(page)).toEqual([]);
});


test("再起動で未送信の記録を戻した場合も、未接続の間は送信待ちを表示する", async ({ page }) => {
  const local = saved();
  local[0].text = "再起動しても残る未送信";
  await open(page, {
    remote: null,
    localRecord: checkpointSeed(local, { pending: [{ id: "a", kind: "put", version: 1 }] }),
  });
  await expect(syncChip(page)).toHaveAttribute("data-sync", "waiting");
  await page.clock.runFor(3000);
  expect(await writes(page)).toEqual([]);
  await page.evaluate((key) => sessionStorage.setItem(key, JSON.stringify([])), REMOTE_KEY);
  await page.locator("[data-outline-link]").click();
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("再起動しても残る未送信");
});


test("古いサーバーに列が足りない場合は全項目を同期済みと表示しない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await page.evaluate(() => { window.__outlineSync.columns = ["text_color"]; });
  await page.locator("[data-outline-link]").click();
  await expect(syncChip(page)).toHaveAttribute("data-sync", "partial");
  await page.clock.runFor(2000);
  await expect(syncChip(page)).toHaveText("一部未同期");
  await page.locator("[data-outline-missing-col]").getByRole("button", { name: "閉じる" }).click();
  await expect(syncChip(page)).toHaveAttribute("data-sync", "partial");
});


async function waitingTab(page) {
  const next = await page.context().newPage();
  await open(next, { remote: null, waitForRemote: false, seedLocal: false });
  await expect(next.locator('[data-outline-owner="waiting"]')).toBeVisible();
  await expect.poll(() => next.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThan(0);
  return next;
}

test("別のタブが編集中なら、待機タブは保存も通信もメモ追加も始めない", async ({ page }) => {
  await open(page, { remote: null });
  const next = await waitingTab(page);
  try {
    await next.clock.runFor(3000);
    expect(await next.evaluate(() => window.__outlineSync.reads)).toBe(0);
    expect(await next.evaluate(() => window.__outlineStorage.writes.length)).toBe(0);
    expect(await writes(next)).toEqual([]);
    await expect(next.locator("[data-outliner]")).toHaveAttribute("inert", "");
    expect(await next.evaluate(() => window.__outlineApi.addMemo("2026-10-22", "待機中のメモ"))).toBeNull();
    expect(JSON.stringify(await stored(next))).not.toContain("待機中のメモ");
  } finally { await next.close(); }
});

test("編集タブを閉じたら、待機後の新しい本文と未送信記録を読み直す", async ({ page }) => {
  await open(page, { remote: null });
  const next = await waitingTab(page);
  await editRow(page, "a", "待機を始めたあとに保存した本文");
  await expect.poll(async () => (await bigRecord(page))?.nodes[0].text).toBe("待機を始めたあとに保存した本文");
  await page.close();
  await expect.poll(() => next.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(next.locator("[data-outline-owner]")).toHaveCount(0);
  await expect(next.locator('[data-row="a"]')).toContainText("待機を始めたあとに保存した本文");
  await expect.poll(async () => (await bigRecord(next))?.sync.pending.map((op) => op.id)).toContain("a");
  await editRow(next, "a", "引き継いだタブで続ける");
  await expect.poll(async () => (await bigRecord(next))?.nodes[0].text).toBe("引き継いだタブで続ける");
  await next.close();
});

test("差分保存だけの大きい文書も、引き継ぎ時にIndexedDBから読み直す", async ({ page }) => {
  const local = [{ ...node("root", "大きい親"), collapsed: true,
    children: Array.from({ length: 1000 }, (_, i) => node(`child-${i}`, `子${i}`)) }];
  await open(page, { local, remote: null });
  await expect.poll(async () => (await bigRecord(page))?.nodes[0].children.length).toBe(1000);
  const next = await waitingTab(page);
  await editRow(page, "root", "大きい文書の最新本文");
  await expect.poll(async () => (await bigRecord(page))?.nodes[0].text).toBe("大きい文書の最新本文");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await page.close();
  await expect.poll(() => next.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(next.locator('[data-row="root"]')).toContainText("大きい文書の最新本文");
  expect((await bigRecord(next)).nodes[0].children).toHaveLength(1000);
  await next.close();
});

test("待機タブを先に閉じても、その次のタブが引き継げる", async ({ page }) => {
  await open(page, { remote: null });
  const second = await waitingTab(page);
  const third = await waitingTab(page);
  await second.close();
  await page.close();
  await expect.poll(() => third.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(third.locator("[data-outline-owner]")).toHaveCount(0);
  await editRow(third, "a", "三つめのタブから編集");
  await expect.poll(async () => (await stored(third))[0].text).toBe("三つめのタブから編集");
  await third.close();
});

test("ロックの無いブラウザーでは保護なしで保存を始めない", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }));
  await open(page, { waitForRemote: false });
  await expect(page.locator('[data-outline-owner="unavailable"]')).toBeVisible();
  await expect(syncChip(page)).toHaveText("編集を保留");
  await page.clock.runFor(3000);
  expect(await page.evaluate(() => window.__outlineStorage.writes)).toEqual([]);
  expect(await page.evaluate(() => window.__outlineSync.reads)).toBe(0);
});

test("画面を破棄しても進行中の保存が確定するまでは次のタブに渡さない", async ({ page }) => {
  await open(page, { remote: null });
  await expect.poll(async () => (await bigRecord(page))?.nodes.length).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__outlineStorage.active)).toBe(0);
  const next = await waitingTab(page);
  await page.evaluate(() => { window.__outlineStorage.localFail = true; window.__outlineStorage.hold = true; });
  await editRow(page, "a", "保存の返事を待つ本文");
  await expect.poll(() => page.evaluate(() => window.__outlineStorage.pending.length)).toBe(1);
  await page.evaluate(() => window.__outlineUnmount());
  await next.clock.runFor(3000);
  expect(await next.evaluate(() => window.__outlineSync.reads)).toBe(0);
  await page.evaluate(() => { window.__outlineStorage.hold = false; window.__outlineStorage.pending.shift()(true); });
  await expect.poll(() => next.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(0);
  await expect(next.locator('[data-row="a"]')).toContainText("保存の返事を待つ本文");
  await next.close();
});

test("起動時のサーバー時刻の表記が違っても未変更の行を送らない", async ({ page }) => {
  const local = saved();
  const remote = asRows(local).map((row) => ({
    ...row, createdAt: row.createdAt.replace("Z", "+00:00"), updatedAt: row.updatedAt.replace("Z", "+00:00"),
  }));
  await open(page, { local, remote });
  await pauseClock(page);
  await settleSync(page);
  await page.clock.runFor(10000);
  expect(await writes(page)).toEqual([]);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
});

test("自分の送信通知で時刻表記が変わっても待機中に送信を繰り返さない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await page.evaluate(() => { window.__outlineSync.echoTimes = true; });
  await editRow(page, "a", "一度だけ送る本文");
  await page.clock.runFor(1000);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  await page.clock.runFor(10000);
  expect(await writes(page)).toHaveLength(1);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
  await expect(page.locator('[data-row="a"]')).toContainText("一度だけ送る本文");
  await page.locator("[data-outline-link]").click();
  await page.clock.runFor(3000);
  expect(await writes(page)).toHaveLength(1);
});

test("時刻表記の違う通知を受けても送信中の追加編集は落とさない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await startHeldWrite(page);
  const sent = (await writes(page))[0].rows;
  await editRow(page, "a", "送信中にさらに書いた本文");
  await emitRemote(page, sent.map((row) => ({
    ...row, createdAt: row.createdAt.replace("Z", "+00:00"), updatedAt: row.updatedAt.replace("Z", "+00:00"),
  })));
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="a"]')).toContainText("送信中にさらに書いた本文");
  await releaseWrite(page);
  await settleSync(page);
  expect((await writes(page)).at(-1).rows.find((row) => row.id === "a").text).toBe("送信中にさらに書いた本文");
  await page.clock.runFor(3000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
});
