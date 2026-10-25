import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { outlineRowSignature } from "../src/lib/outline.js";
import { readTaskspaceBackup } from "../src/lib/backup.js";
import { createGas } from "../tests/fixtures/gas-backup.js";

const KEY = "taskspace-outline-v1";
const REMOTE_KEY = "test-outline-remote";

// サーバーの応答だけを差し替える。空配列は取得成功、nullは取得失敗。
// 画面・Provider・木の操作・IndexedDBは本物を動かす。
const dbModule = `
export async function loadOutlineRows() {
  const state = window.__outlineSync;
  const snapshot = state.snapshotReads ? JSON.parse(sessionStorage.getItem("test-outline-remote")) : undefined;
  state.reads += 1;
  if (state.holdReadsRemaining > 0) {
    state.holdReadsRemaining -= 1;
    await new Promise((resolve) => state.readPending.push(resolve));
  }
  return snapshot === undefined ? JSON.parse(sessionStorage.getItem("test-outline-remote")) : snapshot;
}
export async function loadOutlineRevisions() {
  const state = window.__outlineSync;
  if (state.failRevisions) return null;
  const snapshot = state.snapshotReads ? { ...state.revisions } : undefined;
  if (state.holdReadsRemaining > 0) {
    state.holdReadsRemaining -= 1;
    await new Promise((resolve) => state.readPending.push(resolve));
  }
  return state.cas ? new Map(Object.entries(snapshot || state.revisions)) : undefined;
}
export function outlineCasChanges(rows, gone, expected) {
  return [...rows.map((row) => ({ id: row.id, kind: 'put', expected_revision: expected.get(row.id), row })),
    ...gone.map((id) => ({ id, kind: 'delete', expected_revision: expected.get(id) }))];
}
export async function recoverOutlineOperationResults(operationIds) {
  const state = window.__outlineSync;
  state.recoveries.push(operationIds);
  if (state.holdRecovery) await new Promise((resolve) => state.recoveryPending.push(resolve));
  if (!state.recoveryAvailable) return undefined;
  const results = new Map();
  for (const id of operationIds) {
    const previous = state.operations[id] ||= { hash: 'retired', retired: true };
    results.set(id, previous.revisions ? { ok: true, revisions: Object.fromEntries(previous.revisions) }
      : previous.conflicts ? { ok: false, conflicts: previous.conflicts } : { ok: false, retired: true });
  }
  sessionStorage.setItem('test-outline-operations', JSON.stringify(state.operations));
  return { results };
}
export async function saveOutlineRowsCas(rows, gone, operationId, expected, frozenChanges) {
  const state = window.__outlineSync;
  if (!state.cas) return undefined;
  state.casWrites.push(structuredClone({ rows, gone, operationId, expected: [...expected] }));
  const hash = JSON.stringify(frozenChanges || outlineCasChanges(rows, gone, expected));
  const previous = state.operations[operationId];
  if (previous) {
    if (previous.hash !== hash) return { error: '操作IDが別の内容ですでに使われています' };
    return previous.conflicts ? { conflicts: previous.conflicts } : { revisions: new Map(previous.revisions) };
  }
  const conflicts = [...expected].filter(([id, revision]) => Number(state.revisions[id] || 0) !== revision)
    .map(([id, revision]) => ({ id, expected_revision: revision, actual_revision: Number(state.revisions[id] || 0) }));
  if (conflicts.length || state.conflict) {
    const result = { conflicts: conflicts.length ? conflicts : [{ id: rows[0]?.id || gone[0], actual_revision: 99 }] };
    state.operations[operationId] = { hash, ...result };
    sessionStorage.setItem('test-outline-operations', JSON.stringify(state.operations));
    return result;
  }
  const error = await saveOutlineRows(rows, gone);
  if (error) return { error };
  const accepted = new Map();
  for (const id of [...rows.map((row) => row.id), ...gone]) {
    state.revisions[id] = Number(state.revisions[id] || 0) + 1;
    accepted.set(id, state.revisions[id]);
  }
  state.operations[operationId] = { hash, revisions: [...accepted] };
  sessionStorage.setItem('test-outline-operations', JSON.stringify(state.operations));
  sessionStorage.setItem('test-outline-revisions', JSON.stringify(state.revisions));
  if (state.loseReply) { state.loseReply = false; return { error: '送信成功後の返事を失った' }; }
  return { revisions: accepted };
}
export async function saveOutlineRows(rows, gone) {
  const state = window.__outlineSync;
  const sent = structuredClone({ rows, gone });
  state.writes.push(sent);
  state.active += 1;
  state.maxActive = Math.max(state.maxActive, state.active);
  try {
    const error = state.writeError || (state.hold
      ? await new Promise((resolve, reject) => state.pending.push({ resolve, reject }))
      : null);
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

async function open(page, { local = saved(), remote = asRows(local), known = asRows(local).map((row) => row.id), storage = {}, localRecord, waitForRemote = true, seedLocal = true, cas = false, conflict = false, operations = {}, revisions, recoveryAvailable = true, holdRecovery = false, holdRemote = false, drive = false, panes = 1 } = {}) {
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://127.0.0.1:4174/")
      ? route.continue() : route.abort());
  await page.route(/\/src\/lib\/db\.js(?:\?.*)?$/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: dbModule }));
  await page.route(/\/src\/lib\/localstore\.js$/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: storageModule }));
  await page.addInitScript(({ key, remoteKey, local, remote, known, storage, seedLocal, cas, conflict, operations, revisions, recoveryAvailable, holdRecovery, holdRemote, drive, panes }) => {
    // リロードで初期値を入れ直すと、保存・読み直しの不具合を隠してしまう。
    if (!sessionStorage.getItem("test-outline-seeded")) {
      if (seedLocal) {
        localStorage.setItem(key, JSON.stringify(local));
        localStorage.setItem("taskspace-outline-known", JSON.stringify(known));
      }
      sessionStorage.setItem(remoteKey, JSON.stringify(remote));
      sessionStorage.setItem("test-outline-seeded", "1");
      sessionStorage.setItem('test-outline-operations', JSON.stringify(operations));
      if (revisions) sessionStorage.setItem('test-outline-revisions', JSON.stringify(revisions));
    }
    window.__outlineSync = {
      reads: 0, writes: [], casWrites: [], pending: [], hold: false, active: 0, maxActive: 0,
      holdReadsRemaining: holdRemote ? 2 : 0, readPending: [],
      recoveries: [], recoveryAvailable, holdRecovery, recoveryPending: [],
      cas, conflict, operations: JSON.parse(sessionStorage.getItem('test-outline-operations') || '{}'),
      revisions: JSON.parse(sessionStorage.getItem('test-outline-revisions') || 'null')
        || Object.fromEntries((remote || []).map((row) => [row.id, 1])),
    };
    window.__outlineStorage = {
      writes: [], completed: [], pending: [], active: 0, maxActive: 0,
      localFail: false, fail: false, hold: false, holdRead: false, readPending: [],
      readFail: sessionStorage.getItem("test-outline-read-fail") === "1", ...storage,
    };
    window.__outlinePanes = panes;
    if (drive) {
      localStorage.setItem('taskspace-drive-url', 'https://backup.test/exec');
      localStorage.setItem('taskspace-drive-token', 'ここに合言葉');
    }
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key && window.__outlineStorage.localFail) {
        throw new DOMException("試験用の容量不足", "QuotaExceededError");
      }
      return nativeSet.call(this, name, value);
    };
  }, { key: KEY, remoteKey: REMOTE_KEY, local: localRecord ?? local, remote, known, storage, seedLocal, cas, conflict, operations, revisions, recoveryAvailable, holdRecovery, holdRemote, drive, panes });
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
const pauseClock = async (page) => {
  try { await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100)); }
  catch (error) {
    if (!String(error?.message).includes("Cannot fast-forward to the past")) throw error;
    // 混雑時は時刻を取得してから停止するまでに100msを超える。
    // pauseAtは停止してから過去判定するため、停止後の現在時刻なら競走しない。
    await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  }
};
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
    await expect(syncChip(page)).toHaveAttribute("data-sync", "retrying");
    await expect(page.locator("[data-outline-sync-error]")).toHaveCount(0);
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

test("起動時に本体を読めず手元の写しも無いときは、空の編集画面を出さず本物を守る", async ({ page }) => {
  await openStorage(page);
  await editRow(page, "a", "読み出せなくても守る本物");
  await expectLocalResult(page, "読み出せなくても守る本物", true);
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    sessionStorage.setItem("test-outline-read-fail", "1");
  }, KEY);
  await page.reload();
  await expect(page.locator("[data-outline-local-read-error]")).toBeVisible();
  await expect(page.locator('[data-row="start"]')).toHaveCount(0);
  await expect(page.locator("[data-outline-add]")).toBeDisabled();
  await page.clock.fastForward(16_000);
  expect((await storageState(page)).writes).toEqual([]);
  expect(await stored(page)).toBeNull();
  expect((await storedBig(page)).find((n) => n.id === "a").text).toBe("読み出せなくても守る本物");

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

test("Undoで受信した別の行を巻き戻さず、自分の行だけを送る", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await editRow(page, "a", "この端末の編集");
  await settleSync(page);
  await emitRemote(page, [{ ...asRows(saved())[1], text: "別端末から届いた本文", updatedAt: "2040-01-01T00:00:00.000Z" }], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toContainText("別端末から届いた本文");
  const count = (await writes(page)).length;
  await page.locator("[data-outline-undo]").click();
  await settleSync(page);
  await expect(page.locator('[data-row="a"]')).toContainText(saved()[0].text);
  await expect(page.locator('[data-row="b"]')).toContainText("別端末から届いた本文");
  expect((await writes(page)).slice(count).flatMap((write) => write.rows.map((row) => row.id))).toEqual(["a"]);
  await emitRemote(page, [{ ...asRows(saved())[1], text: "別端末の続き", updatedAt: "2041-01-01T00:00:00.000Z" }], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toContainText("別端末の続き");
  await page.locator("[data-outline-redo]").click();
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("この端末の編集");
  expect((await remoteRows(page)).find((row) => row.id === "b").text).toBe("別端末の続き");
  await page.reload();
  await expect(page.locator('[data-row="b"]')).toContainText("別端末の続き");
});

test("Undoで連続入力を戻しても、途中で受信した別の行を自分の操作に含めない", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await editRow(page, "a", "入力1");
  await emitRemote(page, [{ ...asRows(saved())[1], text: "入力の途中で受信", updatedAt: "2040-01-01T00:00:00.000Z" }], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="b"]')).toContainText("入力の途中で受信");
  await editRow(page, "a", "入力2");
  await page.locator("[data-outline-undo]").click();
  await expect(page.locator('[data-row="a"]')).toContainText("入力1");
  await page.locator("[data-outline-undo]").click();
  await expect(page.locator('[data-row="a"]')).toContainText(saved()[0].text);
  await expect(page.locator('[data-row="b"]')).toContainText("入力の途中で受信");
  await settleSync(page);
  expect((await writes(page)).flatMap((write) => write.rows).every((row) => row.id === "a")).toBe(true);
});

test("Undoで字下げを戻しても、受信した本文と追加された子を残す", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await page.locator('[data-row="b"] [data-row-text]').click();
  await inputFor(page, "b").press("Tab");
  await settleSync(page);
  const b = (await remoteRows(page)).find((row) => row.id === "b");
  // 本番では受信した追加行にも世代がある。本文だけ存在する不整合な置き場にしない。
  await page.evaluate(() => {
    window.__outlineSync.revisions.b += 1;
    window.__outlineSync.revisions['new-child'] = 1;
  });
  await emitRemote(page, [{ ...b, text: "別端末で更新した子", updatedAt: "2040-01-01T00:00:00.000Z" },
    { ...asRows([node("new-child", "別端末で追加した子")], "a")[0], sortOrder: 1 }], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="new-child"]')).toBeVisible();
  await page.locator("[data-outline-undo]").click();
  await settleSync(page);
  const rows = await remoteRows(page);
  expect(rows.find((row) => row.id === "b")).toMatchObject({parentId:null,text:"別端末で更新した子"});
  expect(rows.find((row) => row.id === "new-child")).toMatchObject({parentId:"a",text:"別端末で追加した子"});
});

test("Undoで戻した削除を受信が変えていなければ、Redoで再び削除できる", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await deleteRow(page, "b");
  await settleSync(page);
  await page.locator("[data-outline-undo]").click();
  await settleSync(page);
  await expect(page.locator('[data-row="b"]')).toBeVisible();
  expect(await tombs(page)).not.toContain("b");
  await page.locator("[data-outline-redo]").click();
  expect(await tombs(page)).toContain("b");
  await settleSync(page);
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  expect((await remoteRows(page)).some((row) => row.id === "b")).toBe(false);
});

test("Undoは同じ行で受信した色を保ち、本文だけを取り消す", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await editRow(page, "a", "この端末の編集");
  await settleSync(page);
  const row = (await remoteRows(page)).find((row) => row.id === "a");
  await page.evaluate(() => { window.__outlineSync.revisions.a += 1; });
  await emitRemote(page, [{ ...row, bgColor: "#123456", updatedAt: "2040-01-01T00:00:00.000Z" }], { persist: true });
  await page.clock.runFor(300);
  await expect.poll(async () => (await stored(page))[0].bgColor).toBe("#123456");
  await page.locator("[data-outline-undo]").click();
  await settleSync(page);
  const undone = (await remoteRows(page)).find((row) => row.id === "a");
  expect(undone.text).toBe(saved()[0].text);
  expect(undone.bgColor).toBe("#123456");
  expect((await page.evaluate(() => window.__outlineSync.casWrites)).at(-1).expected).toContainEqual(["a", 3]);
});

test("Undoの対象本文が他端末で変わっていたら、現在の本文と履歴を残す", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await editRow(page, "a", "この端末の編集");
  await settleSync(page);
  const row = (await remoteRows(page)).find((row) => row.id === "a");
  await emitRemote(page, [{ ...row, text: "別端末で続けた本文", updatedAt: "2040-01-01T00:00:00.000Z" }], { persist: true });
  await page.clock.runFor(300);
  await expect(page.locator('[data-row="a"]')).toContainText("別端末で続けた本文");
  const count = (await writes(page)).length;
  await page.locator("[data-outline-undo]").click();
  await expect(page.locator("[data-outline-history-note]")).toContainText("取り消していません");
  await page.clock.runFor(1500);
  await expect(page.locator('[data-row="a"]')).toContainText("別端末で続けた本文");
  expect(await writes(page)).toHaveLength(count);
  await expect(page.locator("[data-outline-undo]")).toBeEnabled();
  await expect(page.locator("[data-outline-redo]")).toBeDisabled();
});

test("削除を取り消したあと受信した内容を、Redoで再び削除しない", async ({ page }) => {
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
  await expect(page.locator("[data-outline-history-note]")).toContainText("やり直していません");
  expect(await tombs(page)).not.toContain("b");
  await expect(page.locator('[data-row="b"]')).toContainText("取り消し後に届いた内容");
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

async function captureBackup(page, api, legacy = false) {
  const requests = [];
  await page.route("https://backup.test/exec*", async (route) => {
    const request = route.request();
    requests.push(request.method());
    const response = request.method() === "POST" ? api.post(JSON.parse(request.postData()))
      : legacy ? { ok: true, folder: "旧GAS" } : api.ping();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  return requests;
}

async function configureBackup(page, api, legacy = false) {
  const requests = await captureBackup(page, api, legacy);
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-drive-url]").fill("https://backup.test/exec");
  await page.locator("[data-drive-token]").fill("ここに合言葉");
  return requests;
}

test("初回の通信が遅くても仮の空行を保存・自動で控えず、読み終えてから本文を控える", async ({ page }) => {
  await open(page, { seedLocal: false, holdRemote: true, drive: true, cas: true, waitForRemote: false });
  await pauseClock(page);
  const api = createGas();
  const requests = await captureBackup(page, api);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.readPending.length)).toBe(2);
  await page.clock.runFor(31000);
  expect.soft(api.created).toHaveLength(0);
  expect.soft(await storedRecord(page)).toBeNull();
  expect.soft((await storageState(page)).writes).toEqual([]);
  await expect.soft(page.locator("[data-outline-loading]")).toBeVisible();
  await expect.soft(page.locator('[data-row="start"]')).toHaveCount(0);
  await page.locator("[data-outline-view]").click();
  await expect(page.locator("[data-drive-backup]")).toBeDisabled();
  await page.evaluate(() => window.__outlineSync.readPending.splice(0).forEach((resolve) => resolve()));
  await expect(page.locator('[data-row="a"]')).toContainText("前に同期した行");
  await settleSync(page);
  await page.clock.runFor(31000);
  await expect.poll(() => api.created.length).toBe(1);
  expect(readTaskspaceBackup(api.created[0].text).outline.nodes.map((row) => row.id)).toEqual(["a", "b"]);
  expect(requests).toEqual(["GET", "POST"]);
  await expect(page.locator("[data-outline-note]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toEqual([]);
});

test("空行だけの古い控えがあっても読み込み失敗を空の確定とせず、自動で読み直す", async ({ page }) => {
  const placeholder = checkpointSeed([node("start", "")], { known: [] });
  await open(page, { localRecord: placeholder, remote: null, cas: true, drive: true });
  await pauseClock(page);
  const api = createGas();
  await captureBackup(page, api);
  await page.clock.runFor(31000);
  expect.soft(api.created).toHaveLength(0);
  expect.soft(await storedRecord(page)).toEqual(placeholder);
  await expect.soft(page.locator("[data-outline-loading]")).toBeVisible();
  await page.evaluate(({ key, rows }) => {
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.revisions = { a: 1, b: 1 };
  }, { key: REMOTE_KEY, rows: asRows(saved()) });
  await page.clock.runFor(16000);
  await expect(page.locator('[data-row="a"]')).toContainText("前に同期した行");
  await settleSync(page);
  await page.clock.runFor(31000);
  await expect.poll(() => api.created.length).toBe(1);
  expect(readTaskspaceBackup(api.created[0].text).outline.nodes).toHaveLength(2);
});

test("複数枠でも自動の控えは一度だけで、成功通知は作業中に出さない", async ({ page }) => {
  await open(page, { drive: true, panes: 2, cas: true });
  await pauseClock(page);
  const api = createGas();
  const requests = await captureBackup(page, api);
  await page.clock.runFor(31000);
  await expect.poll(() => api.created.length).toBe(1);
  expect(requests).toEqual(["GET", "POST"]);
  await expect(page.locator("[data-outline-note]")).toHaveCount(0);
});

test("サーバーで全件削除を確認した空は、読み込み途中と区別して控えられる", async ({ page }) => {
  await open(page, { seedLocal: false, remote: [], cas: true });
  await pauseClock(page);
  const api = createGas();
  await configureBackup(page, api);
  await page.locator("[data-drive-backup]").click();
  await expect(page.locator("[data-outline-note]")).toContainText("控えました");
  expect(readTaskspaceBackup(api.created[0].text).outline.nodes).toEqual([]);
  expect((await storedRecord(page)).complete).toBe(true);
  await page.evaluate((key) => sessionStorage.setItem(key, "null"), REMOTE_KEY);
  await page.reload();
  await pauseClock(page);
  await expect(empty(page)).toBeVisible();
  await expect(page.locator("[data-outline-loading]")).toHaveCount(0);
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-drive-backup]").click();
  await expect(page.locator("[data-outline-note]")).toContainText("控えました");
  expect(api.created).toHaveLength(2);
  expect(readTaskspaceBackup(api.created[1].text).outline.nodes).toEqual([]);
});

test("自動の控えが一時的に失敗しても作業画面へ通知せず、裏で再試行する", async ({ page }) => {
  await open(page, { drive: true, cas: true });
  await pauseClock(page);
  await settleSync(page);
  const api = createGas();
  let unavailable = true;
  const requests = await captureBackup(page, { ...api, ping: () => unavailable ? { error: "試験用の一時停止" } : api.ping() });
  await page.clock.runFor(31000);
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.locator("[data-outline-note]")).toHaveCount(0);
  await page.locator("[data-outline-view]").click();
  await expect(page.locator("[data-drive-backup-state]")).toContainText("再試行を待っています");
  expect(api.created).toEqual([]);
  unavailable = false;
  await page.clock.runFor(61000);
  await expect.poll(() => api.created.length).toBe(1);
  expect(requests).toEqual(["GET", "GET", "POST"]);
  await expect(page.locator("[data-outline-note]")).toHaveCount(0);
  await expect(page.locator("[data-drive-backup-state]")).toContainText("前回の控えを確認済み");
});

test("控えを圧縮してGASへ保存し、別の環境で本文・未送信・削除・タスクを読み戻せる", async ({ page, browser }) => {
  await open(page, { remote: null });
  await pauseClock(page);
  await editRow(page, "a", "控えに残す日本語🌿");
  await deleteRow(page, "b");
  await page.evaluate(() => {
    localStorage.setItem("notion-like-taskdb-prototype-v4", JSON.stringify({ tasks: [{ id: "task-a", title: "控えのタスク" }] }));
    localStorage.setItem("taskspace-font", "mincho");
  });
  const api = createGas();
  const requests = await configureBackup(page, api);
  await page.locator("[data-drive-backup]").click();
  await expect(page.locator("[data-outline-note]")).toContainText("控えました");
  expect(requests).toEqual(["GET", "POST"]);
  expect(api.readbacks).toHaveLength(1);
  const got = readTaskspaceBackup(api.created[0].text);
  expect(got.outline.nodes[0].text).toBe("控えに残す日本語🌿");
  expect(got.outline.sync.pending.map((op) => [op.id, op.kind]).sort()).toEqual([["a", "put"], ["b", "delete"]]);
  expect(got.payload.store["taskspace-drive-token"]).toBeUndefined();
  const context = await browser.newContext();
  try {
    const restored = await context.newPage();
    await restored.addInitScript((store) => { for (const [key, value] of Object.entries(store)) localStorage.setItem(key, value); }, got.payload.store);
    await open(restored, { seedLocal: false, remote: null });
    await expect(restored.locator('[data-row="a"]')).toContainText("控えに残す日本語🌿");
    await expect(restored.locator('[data-row="b"]')).toHaveCount(0);
    expect((await storedRecord(restored)).sync.pending).toEqual(got.outline.sync.pending);
    expect(await restored.evaluate(() => JSON.parse(localStorage.getItem("notion-like-taskdb-prototype-v4")).tasks[0].title)).toBe("控えのタスク");
    expect(await restored.evaluate(() => localStorage.getItem("taskspace-font"))).toBe("mincho");
  } finally { await context.close(); }
});

test("控え先が旧GASなら本文を送らず、空の控えを作らせない", async ({ page }) => {
  await open(page, { remote: null });
  await pauseClock(page);
  const api = createGas();
  const requests = await configureBackup(page, api, true);
  await page.locator("[data-drive-backup]").click();
  await expect(page.locator("[data-outline-note]")).toContainText("GASを最新版");
  expect(requests).toEqual(["GET"]);
  expect(api.created).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("taskspace-drive-last-backup"))).toBeNull();
});

test("保存した控えを読み直して一致しなければ、成功にせず以前の控えを整理しない", async ({ page }) => {
  await open(page, { remote: null });
  await pauseClock(page);
  await editRow(page, "a", "日本語の控えを照合する");
  const api = createGas({ corruptReadback: true });
  await configureBackup(page, api);
  await page.locator("[data-drive-backup]").click();
  await expect(page.locator("[data-outline-note]")).toContainText("読み直しが一致しません");
  expect(api.trashed.filter((id) => typeof id === "number")).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("taskspace-drive-last-backup"))).toBeNull();
});

test("端末のタスクを読めないときは部分的な控えを送らない", async ({ page }) => {
  await open(page, { remote: null });
  await pauseClock(page);
  await page.evaluate(() => localStorage.setItem("notion-like-taskdb-prototype-v4", "{}"));
  const api = createGas();
  const requests = await configureBackup(page, api);
  await page.evaluate(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === "notion-like-taskdb-prototype-v4") throw new Error("試験用の読み出し失敗");
      return read.call(this, key);
    };
  });
  await page.locator("[data-drive-backup]").click();
  await expect(page.locator("[data-outline-note]")).toContainText("控えを中止");
  expect(requests).toEqual([]);
  expect(api.created).toEqual([]);
});
async function settleSync(page) {
  await expect.poll(async () => {
    await page.clock.runFor(1000);
    return syncChip(page).getAttribute("data-sync");
  }).toBe("synced");
}

const oldOperationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function changeRemoteRow(page, id, patch, revision) {
  await page.evaluate(({ key, id, patch, revision }) => {
    const rows = JSON.parse(sessionStorage.getItem(key));
    if (patch === null) sessionStorage.setItem(key, JSON.stringify(rows.filter((row) => row.id !== id)));
    else {
      Object.assign(rows.find((row) => row.id === id), patch);
      sessionStorage.setItem(key, JSON.stringify(rows));
    }
    window.__outlineSync.revisions[id] = revision;
  }, { key: REMOTE_KEY, id, patch, revision });
}

test("同じ行の本文と折りたたみを別々に変えても、両方を自動で残して同期する", async ({ page }) => {
  const local = saved();
  local[0].children = [node("child", "子の本文")];
  await open(page, { local, cas: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "この端末で書いた本文");
  await page.evaluate((key) => {
    const rows = JSON.parse(sessionStorage.getItem(key));
    rows.find((row) => row.id === "a").collapsed = true;
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.revisions.a = 2;
  }, REMOTE_KEY);
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a")).toMatchObject({ text: "この端末で書いた本文", collapsed: true });
  expect((await storedRecord(page)).nodes[0]).toMatchObject({ text: "この端末で書いた本文", collapsed: true });
  expect((await storedRecord(page)).sync.pending).toEqual([]);
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
  const attempts = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(attempts).toHaveLength(2);
  expect(attempts[0].operationId).not.toBe(attempts[1].operationId);
  expect(attempts[1].expected).toEqual([["a", 2]]);
});

test("同じ本文の競合だけを保留し、他の行の編集は送り続ける", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "この端末に保全する本文");
  await editRow(page, "b", "こちらの行は送れる本文");
  await page.evaluate((key) => {
    const rows = JSON.parse(sessionStorage.getItem(key));
    rows[0].text = "別端末で変更した本文";
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.revisions.a = 2;
  }, REMOTE_KEY);
  await page.clock.runFor(3000);
  await expect.poll(async () => {
    await page.clock.runFor(1000);
    return (await remoteRows(page)).find((row) => row.id === "b").text;
  }).toBe("こちらの行は送れる本文");
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("別端末で変更した本文");
  const record = await storedRecord(page);
  expect(record.nodes[0].text).toBe("この端末に保全する本文");
  expect(record.sync.pending).toHaveLength(1);
  expect(record.sync.pending[0]).toMatchObject({ id: "a", blocked: true });
  await expect(page.locator("[data-outline-sync-conflict]")).toBeVisible();
  await page.locator("[data-outline-conflict-dismiss]").click();
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
  await editRow(page, "b", "保留中でも続きを書ける");
  await page.clock.runFor(2000);
  await expect.poll(async () => (await remoteRows(page)).find((row) => row.id === "b").text).toBe("保留中でも続きを書ける");
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "conflict");
  await page.locator("[data-outline-show-conflict]").click();
  await expect(page.locator("[data-outline-sync-conflict]")).toBeVisible();
  await page.reload();
  await pauseClock(page);
  await expect(page.locator("[data-outline-sync-conflict]")).toBeVisible();
  await page.clock.runFor(2000);
  expect((await storedRecord(page)).sync.pending[0]).toMatchObject({ id: "a", blocked: true });
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toEqual([]);
  await page.evaluate(() => { window.__outlineSync.revisions.a = 3; });
  const resolved = { ...asRows(saved())[0], text: "この端末に保全する本文", updatedAt: "2031-01-01T00:00:00Z" };
  await emitRemote(page, [resolved], { persist: true });
  await settleSync(page);
  expect((await storedRecord(page)).sync.pending).toEqual([]);
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toEqual([]);
});

test("この端末の折りたたみと別端末の本文も、自動で両方を残す", async ({ page }) => {
  const local = saved();
  local[0].children = [node("child", "子の本文")];
  await open(page, { local, cas: true });
  await pauseClock(page);
  await settleSync(page);
  await page.locator('[data-row="a"]').getByTitle("折りたたむ", { exact: true }).click();
  await changeRemoteRow(page, "a", { text: "別端末で書いた本文" }, 2);
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a")).toMatchObject({ text: "別端末で書いた本文", collapsed: true });
  expect((await storedRecord(page)).sync.pending).toEqual([]);
});

test("自動マージの確認中に書き続けても、最新の入力を古い要求の結果で消さない", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "確認前の本文");
  await changeRemoteRow(page, "a", { favorite: true }, 2);
  await page.evaluate(() => { window.__outlineSync.holdReadsRemaining = 1; });
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.readPending.length)).toBe(1);
  await editRow(page, "a", "確認中にも書き足した本文");
  await page.evaluate(() => window.__outlineSync.readPending.splice(0).forEach((resolve) => resolve()));
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a")).toMatchObject({ text: "確認中にも書き足した本文", favorite: true });
  const attempts = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(attempts[0].operationId).toBe(attempts[1].operationId);
  expect(attempts[0].rows).toEqual(attempts[1].rows);
  expect(attempts.at(-1).operationId).not.toBe(attempts[0].operationId);
  expect((await storedRecord(page)).sync.pending).toEqual([]);
});

test("圏外の未送信記録を読み戻し、送信前の比較でも両立する変更を合わせる", async ({ page }) => {
  const local = saved();
  local[0].text = "圏外で書いた本文";
  const remote = asRows(saved());
  remote[0].favorite = true;
  await open(page, { cas: true, localRecord: checkpointSeed(local, { pending: [{ id: "a", kind: "put", version: 1,
    baseSignature: outlineRowSignature(asRows(saved())[0]), positionChanged: false }] }), remote, revisions: { a: 2, b: 1 } });
  await pauseClock(page);
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a")).toMatchObject({ text: "圏外で書いた本文", favorite: true });
  const attempts = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(attempts).toHaveLength(1);
  expect(attempts[0].expected).toEqual([["a", 2]]);
});

test("別端末で削除された行は復活させず、他の編集だけを送る", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "端末に残す本文");
  await editRow(page, "b", "ほかの編集");
  await changeRemoteRow(page, "a", null, 2);
  await expect.poll(async () => {
    await page.clock.runFor(1000);
    return (await remoteRows(page)).find((row) => row.id === "b").text;
  }).toBe("ほかの編集");
  expect((await remoteRows(page)).some((row) => row.id === "a")).toBe(false);
  expect((await storedRecord(page)).nodes.find((row) => row.id === "a").text).toBe("端末に残す本文");
  expect((await storedRecord(page)).sync.pending).toHaveLength(1);
});

test("保留した自分の編集を取り消せば、サーバーの最新を採って保留を解消する", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "この端末で書いた本文");
  await changeRemoteRow(page, "a", { text: "サーバーの最新本文" }, 2);
  await page.clock.runFor(2000);
  await expect(page.locator("[data-outline-sync-conflict]")).toBeVisible();
  const attempts = await page.evaluate(() => window.__outlineSync.casWrites.length);
  await page.locator("[data-outline-undo]").click();
  await settleSync(page);
  await expect(page.locator('[data-row="a"]')).toContainText("サーバーの最新本文");
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("サーバーの最新本文");
  expect((await storedRecord(page)).sync.pending).toEqual([]);
  expect(await page.evaluate(() => window.__outlineSync.casWrites.length)).toBe(attempts);
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
});

test("送信中の追加入力を、受理済みの自分の本文との競合と誤認しない", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await startHeldWrite(page);
  await editRow(page, "a", "送信中にも書き足した本文");
  await releaseWrite(page);
  await expect.poll(async () => (await storedRecord(page)).sync.pending[0]?.expectedRevision).toBe(2);
  await changeRemoteRow(page, "a", { favorite: true }, 3);
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a")).toMatchObject({ text: "送信中にも書き足した本文", favorite: true });
  expect((await storedRecord(page)).sync.pending).toEqual([]);
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
});

const oldPending = (overrides = {}) => ({ id: "a", kind: "put", version: 1, expectedRevision: 0,
  baseSignature: outlineRowSignature(asRows(saved())[0]), operationId: oldOperationId, ...overrides });

test("旧版で拒否された世代0の編集は、操作を引き継いで自動で続きを送る", async ({ page }) => {
  const local = [node("a", "旧版で止まっていた本文"), saved()[1]];
  await open(page, { localRecord: checkpointSeed(local, { pending: [oldPending()] }), remote: asRows(saved()).map((row) => ({ ...row, sortOrder: row.sortOrder * 10 + 5 })), cas: true,
    operations: { [oldOperationId]: { hash: "旧版の要求", conflicts: [{ id: "a", expected_revision: 0, actual_revision: 1 }] } } });
  await pauseClock(page);
  await settleSync(page);
  const state = await page.evaluate(() => ({ recoveries: window.__outlineSync.recoveries, writes: window.__outlineSync.casWrites }));
  expect(state.recoveries).toEqual([[oldOperationId]]);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].operationId).not.toBe(oldOperationId);
  expect(state.writes[0].expected).toEqual([["a", 1]]);
  expect(state.writes[0].rows[0].sortOrder).toBe(5);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe(local[0].text);
  await page.reload();
  await pauseClock(page);
  await settleSync(page);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toEqual([]);
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
});

test("旧版の未着要求は失効してから新しいIDで送り、未送信の本文を残す", async ({ page }) => {
  const local = [node("a", "まだ届いていなかった本文"), saved()[1]];
  await open(page, { localRecord: checkpointSeed(local, { pending: [oldPending({ expectedRevision: 1 })] }), remote: asRows(saved()), cas: true });
  await pauseClock(page);
  await settleSync(page);
  expect(await page.evaluate((id) => window.__outlineSync.operations[id].retired, oldOperationId)).toBe(true);
  const attempts = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(attempts).toHaveLength(1);
  expect(attempts[0].operationId).not.toBe(oldOperationId);
  expect((await remoteRows(page))[0].text).toBe(local[0].text);
});

test("旧版の送信が既に成功していた場合は、同じ本文を送り直さない", async ({ page }) => {
  const local = [node("a", "既に届いていた本文"), saved()[1]];
  await open(page, { localRecord: checkpointSeed(local, { pending: [oldPending({ expectedRevision: 1 })] }), remote: asRows(local), cas: true,
    revisions: { a: 2, b: 1 }, operations: { [oldOperationId]: { hash: "旧版の要求", revisions: [["a", 2]] } } });
  await pauseClock(page);
  await settleSync(page);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toEqual([]);
  expect((await storedRecord(page)).sync.pending).toEqual([]);
});

test("旧操作の確認中に書き続けても、古い確認結果で追加入力を消さない", async ({ page }) => {
  await open(page, { localRecord: checkpointSeed(saved(), { pending: [oldPending({ expectedRevision: 1 })] }), remote: asRows(saved()), cas: true, holdRecovery: true });
  await pauseClock(page);
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.recoveryPending.length)).toBe(1);
  await editRow(page, "a", "確認中にも書いた本文");
  await page.evaluate(() => { const state = window.__outlineSync; state.holdRecovery = false; for (const resolve of state.recoveryPending.splice(0)) resolve(); });
  await settleSync(page);
  expect((await remoteRows(page))[0].text).toBe("確認中にも書いた本文");
  expect((await storedRecord(page)).nodes[0].text).toBe("確認中にも書いた本文");
});

test("旧操作の確認中に別端末で消した行は、引き継ぎ後に復活させない", async ({ page }) => {
  await open(page, { localRecord: checkpointSeed(saved(), { pending: [oldPending({ expectedRevision: 1 })] }), remote: asRows(saved()), cas: true, holdRecovery: true });
  await pauseClock(page);
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.recoveryPending.length)).toBe(1);
  await page.evaluate(({ key, remote }) => {
    const state = window.__outlineSync;
    sessionStorage.setItem(key, JSON.stringify(remote));
    state.revisions.b = 2;
    state.holdRecovery = false;
    for (const resolve of state.recoveryPending.splice(0)) resolve();
  }, { key: REMOTE_KEY, remote: [asRows(saved())[0]] });
  await settleSync(page);
  await expect(page.locator('[data-row="b"]')).toHaveCount(0);
  expect((await storedRecord(page)).nodes.map((node) => node.id)).toEqual(["a"]);
  expect(await writes(page)).toEqual([]);
});

test("旧操作の引き継ぎが未導入なら、手元を残し直接保存へ抜けない", async ({ page }) => {
  const local = [node("a", "準備が整うまで残す本文"), saved()[1]];
  await open(page, { localRecord: checkpointSeed(local, { pending: [oldPending()] }), remote: asRows(saved()), cas: true, recoveryAvailable: false });
  await pauseClock(page);
  await page.clock.runFor(1000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "retrying");
  expect(await writes(page)).toEqual([]);
  expect((await storedRecord(page)).nodes[0].text).toBe(local[0].text);
  expect((await storedRecord(page)).sync.pending[0].operationId).toBe(oldOperationId);
  await page.evaluate(() => { window.__outlineSync.recoveryAvailable = true; });
  await page.clock.runFor(15000);
  await settleSync(page);
  expect((await remoteRows(page))[0].text).toBe(local[0].text);
});

test("旧操作でも別端末の両立できない本文は上書きせず、両方を保つ", async ({ page }) => {
  const local = [node("a", "手元に保つ本文"), saved()[1]];
  const remote = [node("a", "別端末に保つ本文"), saved()[1]];
  await open(page, { localRecord: checkpointSeed(local, { pending: [oldPending({ expectedRevision: 1 })] }), remote: asRows(remote), revisions: { a: 2, b: 1 }, cas: true });
  await pauseClock(page);
  await page.clock.runFor(1000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "conflict");
  expect(await writes(page)).toEqual([]);
  expect((await storedRecord(page)).nodes[0].text).toBe(local[0].text);
  expect((await remoteRows(page))[0].text).toBe(remote[0].text);
  const recoveries = await page.evaluate(() => window.__outlineSync.recoveries.length);
  await page.clock.runFor(10000);
  expect(await page.evaluate(() => window.__outlineSync.recoveries.length)).toBe(recoveries);
});

test("旧操作の比較基準が無い場合は、別端末の更新と決めつけず内容を保つ", async ({ page }) => {
  const local = [node("a", "比較基準が残っていない本文"), saved()[1]];
  await open(page, { localRecord: checkpointSeed(local, { pending: [oldPending({ baseSignature: undefined })] }), remote: asRows(saved()), cas: true });
  await pauseClock(page);
  await page.clock.runFor(1000);
  const banner = page.locator("[data-outline-sync-conflict]");
  await expect(banner).toContainText("自動でまとめられない変更があります");
  await expect(banner).not.toContainText("別の端末に新しい変更");
  expect(await writes(page)).toEqual([]);
  expect((await storedRecord(page)).nodes[0].text).toBe(local[0].text);
});

test("送信成功の返事を失って再編集・再起動しても、先の結果を確かめてから続きを送る", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await page.evaluate(() => { window.__outlineSync.loseReply = true; });
  await editRow(page, "a", "返事を失った最初の本文");
  await page.clock.runFor(1000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "retrying");
  const first = await page.evaluate(() => window.__outlineSync.casWrites[0]);
  await editRow(page, "a", "その後も書き続けた本文");
  await expect.poll(async () => (await storedRecord(page)).nodes[0].text).toBe("その後も書き続けた本文");
  await page.reload();
  await pauseClock(page);
  await settleSync(page);
  const attempts = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(first);
  expect(attempts[1].operationId).not.toBe(first.operationId);
  expect(attempts[1].expected).toEqual([["a", 2]]);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("その後も書き続けた本文");
  expect(await page.evaluate(() => window.__outlineSync.revisions.a)).toBe(3);
  expect((await storedRecord(page)).sync.pending).toEqual([]);
});

test("送信前の通信失敗後に削除しても、開き直して先の本文と削除を順に確定する", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await holdWrites(page);
  await editRow(page, "b", "送信中に削除する本文");
  await advanceToWrites(page, 1);
  const first = await page.evaluate(() => window.__outlineSync.casWrites[0]);
  await releaseWrite(page, { error: "送信前の通信失敗" });
  await deleteRow(page, "b");
  await expect.poll(async () => (await storedRecord(page)).sync.pending.find((op) => op.id === "b")?.kind).toBe("delete");
  await page.reload();
  await pauseClock(page);
  await settleSync(page);
  const attempts = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(attempts[0]).toEqual(first);
  expect(attempts[1].gone).toEqual(["b"]);
  expect(attempts[1].expected).toEqual([["b", 2]]);
  expect((await remoteRows(page)).some((row) => row.id === "b")).toBe(false);
});

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

test("短い送信失敗は大きな通知を出さず再試行し、成功するまで同期済みにしない", async ({ page }) => {
  await open(page);
  await pauseClock(page);
  await settleSync(page);
  await startHeldWrite(page);
  await releaseWrite(page, { error: "試験用の接続失敗" });
  await expect(syncChip(page)).toHaveAttribute("data-sync", "retrying");
  await expect(page.locator("[data-outline-sync-error]")).toHaveCount(0);
  await page.clock.runFor(16000);
  await settleSync(page);
  expect(await writes(page)).toHaveLength(2);
  await expect(page.locator("[data-outline-sync-error]")).toHaveCount(0);
});

test("同期の失敗が長引けば知らせ、再接続で本文を送れたら知らせを消す", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await page.evaluate(() => { window.__outlineSync.writeError = "試験用の接続失敗"; });
  await editRow(page, "a", "通信が止まっても端末に残る本文");
  await page.clock.runFor(1000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "retrying");
  await expect(page.locator("[data-outline-sync-error]")).toHaveCount(0);
  expect((await storedRecord(page)).nodes[0].text).toBe("通信が止まっても端末に残る本文");
  await page.clock.runFor(31000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "error");
  await expect(page.locator("[data-outline-sync-error]")).toContainText("試験用の接続失敗");
  await page.evaluate(() => { window.__outlineSync.writeError = null; });
  await page.clock.runFor(16000);
  await settleSync(page);
  await expect(page.locator("[data-outline-sync-error]")).toHaveCount(0);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("通信が止まっても端末に残る本文");
});

test("最新版へ合わせたあと、遅れた全体読み込みで本文と世代を巻き戻さない", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await page.evaluate(() => { Object.assign(window.__outlineSync, { snapshotReads: true, holdReadsRemaining: 2 }); });
  await page.locator("[data-outline-link]").click();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.readPending.length)).toBe(2);
  await page.evaluate((key) => {
    const rows = JSON.parse(sessionStorage.getItem(key));
    rows[0].text = "サーバーの最新本文";
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.revisions.a = 2;
  }, REMOTE_KEY);
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-outline-pull]").click();
  await expect(page.locator('[data-row="a"]')).toContainText("サーバーの最新本文");
  await page.evaluate(() => window.__outlineSync.readPending.splice(0).forEach((resolve) => resolve()));
  await page.clock.runFor(1000);
  await expect(page.locator('[data-row="a"]')).toContainText("サーバーの最新本文");
  await editRow(page, "a", "最新版の続き");
  await settleSync(page);
  expect((await page.evaluate(() => window.__outlineSync.casWrites))[0].expected).toEqual([["a", 2]]);
});

test("最新版へ合わせたあと、遅れた受信の世代照会で次の保存を競合にしない", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await page.evaluate(() => { Object.assign(window.__outlineSync, { snapshotReads: true, holdReadsRemaining: 1, revisions: { a: 2, b: 1 } }); });
  const incoming = { ...asRows(saved())[0], text: "途中の本文", updatedAt: "2030-01-01T00:00:00Z" };
  await emitRemote(page, [incoming]);
  await page.clock.runFor(300);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.readPending.length)).toBe(1);
  await page.evaluate((key) => {
    const rows = JSON.parse(sessionStorage.getItem(key));
    Object.assign(rows[0], { text: "もっと新しい本文", updatedAt: "2031-01-01T00:00:00Z" });
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.revisions.a = 3;
  }, REMOTE_KEY);
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-outline-pull]").click();
  await expect(page.locator('[data-row="a"]')).toContainText("もっと新しい本文");
  await page.evaluate(() => window.__outlineSync.readPending.splice(0).forEach((resolve) => resolve()));
  await page.clock.runFor(1000);
  await editRow(page, "a", "最新の本文から続ける");
  await settleSync(page);
  expect((await page.evaluate(() => window.__outlineSync.casWrites))[0].expected).toEqual([["a", 3]]);
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
});

test("初回取得中の手動取り込みに失敗しても、世代未確認のまま送信を始めない", async ({ page }) => {
  await open(page, { cas: true, remote: null });
  await pauseClock(page);
  await editRow(page, "a", "接続待ちの間に書いた本文");
  await page.evaluate(({ key, rows }) => {
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.failRevisions = true;
    window.__outlineSync.revisions = { a: 1, b: 1 };
  }, { key: REMOTE_KEY, rows: asRows(saved()) });
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-outline-pull]").click();
  await expect(page.locator("[data-outline-note]")).toContainText("世代を確認できませんでした");
  await page.clock.runFor(1000);
  expect(await writes(page)).toEqual([]);
  expect((await storedRecord(page)).sync.pending).toHaveLength(1);
  await page.evaluate(() => { window.__outlineSync.failRevisions = false; });
  await page.clock.runFor(16000);
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("接続待ちの間に書いた本文");
  expect((await page.evaluate(() => window.__outlineSync.casWrites))[0].expected).toEqual([["a", 1]]);
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

test("古い端末を開くだけで書き戻さず、時計が未来でも最新の続きを表示する", async ({ page }) => {
  const local = saved();
  local[0].text = "古い端末に見えていた本文";
  local[0].updatedAt = "2099-01-01T00:00:00.000Z";
  await open(page, { local, remote: asRows(saved()), cas: true });
  await pauseClock(page);
  await settleSync(page);
  await expect(page.locator('[data-row="a"]')).toContainText("前に同期した行");
  await page.clock.runFor(10000);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toHaveLength(0);
});

test("旧版にしか無い本文は消さず勝手に送らず、同期済みとも表示しない", async ({ page }) => {
  const local = [...saved(), node("draft", "旧端末にしか無い本文")];
  await open(page, { local, remote: asRows(saved()), known: ["a", "b"], cas: true });
  await pauseClock(page);
  await page.clock.runFor(3000);
  await expect(page.locator('[data-row="draft"]')).toContainText("旧端末にしか無い本文");
  await expect(syncChip(page)).toHaveAttribute("data-sync", "local-only");
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toHaveLength(0);
  await editRow(page, "draft", "旧端末の本文を引き継いで編集");
  await settleSync(page);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
  expect((await remoteRows(page)).find((row) => row.id === "draft").text).toBe("旧端末の本文を引き継いで編集");
});

test("11432行と疎な並び番号を受信しても、起動と手動取り込みで送信しない", async ({ page }) => {
  test.setTimeout(90000);
  const local = [{ ...node("a", "大きい文書"), collapsed: true,
    children: Array.from({ length: 11431 }, (_, i) => node(`child-${i}`, `行${i}`)) }];
  // 試験用のサーバー写しをsessionStorageへ置くため、空の任意列は省く。
  // 本文の本物の置き場はIndexedDBで、WebKitの小さいStorage枠に依存させない。
  const remote = asRows(local).map(({ id, parentId, sortOrder, text, collapsed, createdAt, updatedAt }) => ({
    id, parentId, sortOrder: sortOrder * 10 + 5, text, collapsed, createdAt, updatedAt,
  }));
  await open(page, { local: [], remote, cas: true });
  await pauseClock(page);
  await page.clock.runFor(3000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced", { timeout: 60000 });
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-outline-pull]").click();
  await page.clock.runFor(10000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced", { timeout: 60000 });
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toHaveLength(0);
  await expect.poll(async () => (await bigRecord(page))?.nodes[0]?.children?.length, { timeout: 60000 }).toBe(11431);
});

test("本文だけの編集は対象行だけを送り、疎な並び番号の兄弟を移動させない", async ({ page }) => {
  const remote = asRows(saved()).map((row, i) => ({ ...row, sortOrder: (i + 1) * 10 }));
  await open(page, { remote, cas: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "b", "書いたのはこの一行だけ");
  await settleSync(page);
  const sent = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(sent).toHaveLength(1);
  expect(sent[0].rows.map((row) => row.id)).toEqual(["b"]);
  expect(sent[0].rows[0].sortOrder).toBe(20);
  expect((await remoteRows(page)).find((row) => row.id === "a").sortOrder).toBe(10);
});

test("圏外の編集を残して再接続し、ほかの行の新しい本文と両立する", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await page.evaluate((key) => sessionStorage.setItem(key, "null"), REMOTE_KEY);
  await holdWrites(page);
  await editRow(page, "a", "圏外で書いた続き");
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.pending.length)).toBe(1);
  await releaseWrite(page, { error: "圏外" });
  const remote = asRows(saved());
  remote[1].text = "持ち替え先で更新した別の行";
  await page.evaluate(({ key, rows }) => {
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.revisions.b = 2;
  }, { key: REMOTE_KEY, rows: remote });
  await page.locator("[data-outline-link]").click();
  await expect(page.locator('[data-row="a"]')).toContainText("圏外で書いた続き");
  await expect(page.locator('[data-row="b"]')).toContainText("持ち替え先で更新した別の行");
  await page.clock.runFor(16000);
  await settleSync(page);
  const server = await remoteRows(page);
  expect(server.find((row) => row.id === "a").text).toBe("圏外で書いた続き");
  expect(server.find((row) => row.id === "b").text).toBe("持ち替え先で更新した別の行");
});

test("持ち替え先で更新を取り込むだけでは送らず、その続きの編集だけを送る", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  const remote = asRows(saved());
  remote[0].text = "別端末で書いた続き";
  await page.evaluate(({ key, rows }) => {
    sessionStorage.setItem(key, JSON.stringify(rows));
    window.__outlineSync.revisions.a = 2;
  }, { key: REMOTE_KEY, rows: remote });
  await page.locator("[data-outline-link]").click();
  await expect(page.locator('[data-row="a"]')).toContainText("別端末で書いた続き");
  await settleSync(page);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toHaveLength(0);
  await editRow(page, "a", "持ち替えて続きを書いた");
  await settleSync(page);
  const sent = await page.evaluate(() => window.__outlineSync.casWrites);
  expect(sent).toHaveLength(1);
  expect(sent[0].expected).toEqual([["a", 2]]);
});

test("同じ行の本文が両立できない場合だけ止め、両端末の本文を保全する", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  await editRow(page, "a", "この端末で書いた本文");
  await page.evaluate((key) => {
    const remote = JSON.parse(sessionStorage.getItem(key));
    remote.find((row) => row.id === "a").text = "別端末で書いた本文";
    sessionStorage.setItem(key, JSON.stringify(remote));
    window.__outlineSync.revisions.a = 2;
  }, REMOTE_KEY);
  await page.clock.runFor(1000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "conflict");
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("別端末で書いた本文");
  expect((await storedRecord(page)).nodes[0].text).toBe("この端末で書いた本文");
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
  expect(record.sync.pending[0]).toMatchObject({ blocked: true });
  expect(record.sync.pending[0].rejectedOperationId).toMatch(/^[0-9a-f-]{36}$/);
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
  await expect(page.locator("[data-outline-undo]")).toBeDisabled();
  await expect(page.locator("[data-outline-redo]")).toBeDisabled();
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
    window.__outlineSync.holdReadsRemaining = 1;
    window.__outlineSync.revisions = { a: 2, b: 1 };
  });
  await editRow(page, "a", "取り込み前の未送信本文");
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.readPending.length)).toBe(1);
  await page.locator("[data-outline-view]").click();
  await page.locator("[data-outline-pull]").click();
  await expect(page.locator('[data-row="a"]')).toContainText("前に同期した行");
  await page.evaluate(() => window.__outlineSync.readPending.splice(0).forEach((resolve) => resolve()));
  await page.clock.runFor(10000);
  await expect(syncChip(page)).toHaveAttribute("data-sync", "synced");
  await expect(page.locator("[data-outline-sync-conflict]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__outlineSync.casWrites)).toHaveLength(0);
});

test("世代確認中の追加入力を古い本文の送信完了として消さない", async ({ page }) => {
  await open(page, { cas: true });
  await pauseClock(page);
  await settleSync(page);
  const reads = await page.evaluate(() => window.__outlineSync.reads);
  await page.evaluate(() => { window.__outlineSync.revisions = {}; });
  await page.locator("[data-outline-link]").click();
  await expect.poll(() => page.evaluate(() => window.__outlineSync.reads)).toBeGreaterThan(reads);
  await page.evaluate(() => {
    window.__outlineSync.holdReadsRemaining = 1;
    window.__outlineSync.revisions = { a: 1, b: 1 };
  });
  await editRow(page, "a", "確認を始めた時点の本文");
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => window.__outlineSync.readPending.length)).toBe(1);
  await editRow(page, "a", "確認中にも書き足した最新の本文");
  await page.evaluate(() => window.__outlineSync.readPending.splice(0).forEach((resolve) => resolve()));
  await settleSync(page);
  expect((await remoteRows(page)).find((row) => row.id === "a").text).toBe("確認中にも書き足した最新の本文");
  expect((await storedRecord(page)).sync.pending).toEqual([]);
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
