import { test, expect } from "@playwright/test";

const operations = [
  { method: "put", api: "bigPut", label: "書き込み", result: true, after: { text: "新しい内容" } },
  { method: "get", api: "bigGet", label: "読み出し", result: { text: "元の内容" }, after: { text: "元の内容" } },
  { method: "delete", api: "bigDelete", label: "削除", result: true, after: undefined },
];

test.beforeEach(async ({ page }) => {
  // アプリを起動せず、保存ヘルパーとブラウザの実際のIndexedDBだけを使う。
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === "http://127.0.0.1:4174" ? route.continue() : route.abort();
  });
  await page.goto("/sync-tests/localstore-fixture.html");
});

// complete／abortが来る前に結果を返さないことを、実際のイベント順で確かめる。
async function exercise(page, operation, failure = null) {
  return page.evaluate(async ({ method, api, failure }) => {
    const { bigPut, bigGet, ...rest } = await import("/src/lib/localstore.js");
    const store = { bigPut, bigGet, ...rest };
    const key = "確定を待つ試験";
    const original = { text: "元の内容" };
    if (!await bigPut(key, original)) throw new Error("試験の準備に失敗した");

    const nativeTransaction = IDBDatabase.prototype.transaction;
    const nativeClose = IDBDatabase.prototype.close;
    const nativeMethod = IDBObjectStore.prototype[method];
    let ended = false;
    let terminalEvent = null;
    let closedBeforeEnd = false;
    let requestSucceeded = false;
    let requestFailed = false;

    IDBDatabase.prototype.transaction = function (...args) {
      const tx = nativeTransaction.apply(this, args);
      for (const event of ["complete", "abort"]) {
        tx.addEventListener(event, () => { ended = true; terminalEvent = event; });
      }
      return tx;
    };
    IDBDatabase.prototype.close = function () {
      if (!ended) closedBeforeEnd = true;
      return nativeClose.call(this);
    };
    IDBObjectStore.prototype[method] = function (...args) {
      // 既存キーへaddすると実際のConstraintErrorが起き、要求全体がabortになる。
      const req = failure === "request"
        ? this.add(...args)
        : nativeMethod.apply(this, args);
      req.addEventListener("success", () => {
        requestSucceeded = true;
        if (failure === "abort") this.transaction.abort();
      });
      req.addEventListener("error", () => { requestFailed = true; });
      return req;
    };

    let result;
    let endedWhenReturned;
    try {
      // 関数は複製できないので、要求を作る段階でDataCloneErrorになる。
      const value = failure === "clone" ? () => {} : { text: "新しい内容" };
      result = await store[api](key, value);
      endedWhenReturned = ended;
    } finally {
      IDBDatabase.prototype.transaction = nativeTransaction;
      IDBDatabase.prototype.close = nativeClose;
      IDBObjectStore.prototype[method] = nativeMethod;
    }

    const after = await bigGet(key);
    // 失敗後も、次の保存を妨げないことまで確認する。
    const recovered = await bigPut(key, { text: "次の保存" });
    const recovery = await bigGet(key);
    return {
      result, after, endedWhenReturned, terminalEvent, closedBeforeEnd,
      requestSucceeded, requestFailed, recovered, recovery,
    };
  }, { ...operation, failure });
}

for (const operation of operations) {
  test(`${operation.label}は取引の完了を待って返す`, async ({ page }) => {
    const got = await exercise(page, operation);
    expect(got).toEqual({
      result: operation.result,
      after: operation.after,
      endedWhenReturned: true,
      terminalEvent: "complete",
      closedBeforeEnd: false,
      requestSucceeded: true,
      requestFailed: false,
      recovered: true,
      recovery: { text: "次の保存" },
    });
  });

  test(`${operation.label}の要求が成功しても、取引が中断されたら失敗を返す`, async ({ page }) => {
    const got = await exercise(page, operation, "abort");
    expect(got).toEqual({
      result: operation.api === "bigGet" ? undefined : false,
      after: { text: "元の内容" },
      endedWhenReturned: true,
      terminalEvent: "abort",
      closedBeforeEnd: false,
      requestSucceeded: true,
      requestFailed: false,
      recovered: true,
      recovery: { text: "次の保存" },
    });
  });
}

test("要求でエラーが起きたら中断を待ち、元の内容を残す", async ({ page }) => {
  const got = await exercise(page, operations[0], "request");
  expect(got).toEqual({
    result: false,
    after: { text: "元の内容" },
    endedWhenReturned: true,
    terminalEvent: "abort",
    closedBeforeEnd: false,
    requestSucceeded: false,
    requestFailed: true,
    recovered: true,
    recovery: { text: "次の保存" },
  });
});

test("複製できない値を渡しても取引を残さず、次の保存を続けられる", async ({ page }) => {
  const got = await exercise(page, operations[0], "clone");
  expect(got).toEqual({
    result: false,
    after: { text: "元の内容" },
    endedWhenReturned: true,
    terminalEvent: "abort",
    closedBeforeEnd: false,
    requestSucceeded: false,
    requestFailed: false,
    recovered: true,
    recovery: { text: "次の保存" },
  });
});

test("起動時の読み出しは、中身が無い場合と取引に失敗した場合を区別できる", async ({ page }) => {
  const got = await page.evaluate(async () => {
    const { bigGet, bigPut } = await import("/src/lib/localstore.js");
    const key = "読み出し失敗を区別する試験";
    await bigPut(key, { text: "保存済みの内容" });
    const missing = await bigGet("まだ無いキー", { throwOnError: true });
    const nativeGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      const req = nativeGet.apply(this, args);
      req.addEventListener("success", () => this.transaction.abort());
      return req;
    };
    let threw = false;
    let quiet;
    try {
      try { await bigGet(key, { throwOnError: true }); }
      catch { threw = true; }
      quiet = await bigGet(key);
    } finally {
      IDBObjectStore.prototype.get = nativeGet;
    }
    return { missing, threw, quiet, intact: await bigGet(key) };
  });
  expect(got).toEqual({
    missing: undefined, threw: true, quiet: undefined, intact: { text: "保存済みの内容" },
  });
});

test("本文と未送信記録の保存が中断したら、両方とも前の控えを残す", async ({ page }) => {
  const got = await page.evaluate(async () => {
    const { bigPut, bigGet } = await import("/src/lib/localstore.js");
    const key = "本文と未送信の一括保存";
    const before = { nodes: [{ id: "a", text: "元の本文" }], sync: { pending: [] } };
    const next = { nodes: [{ id: "a", text: "新しい本文" }], sync: { pending: [{ id: "a", version: 1, kind: "put" }] } };
    await bigPut(key, before);
    const native = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const req = native.apply(this, args);
      if (args[1] === key) req.addEventListener("success", () => this.transaction.abort());
      return req;
    };
    let result;
    try { result = await bigPut(key, next); }
    finally { IDBObjectStore.prototype.put = native; }
    const after = await bigGet(key);
    const recovered = await bigPut(key, next);
    return { result, after, recovered, saved: await bigGet(key) };
  });
  expect(got.result).toBe(false);
  expect(got.after).toEqual({ nodes: [{ id: "a", text: "元の本文" }], sync: { pending: [] } });
  expect(got.recovered).toBe(true);
  expect(got.saved.nodes[0].text).toBe("新しい本文");
  expect(got.saved.sync.pending).toEqual([{ id: "a", version: 1, kind: "put" }]);
});


async function rowScenario(page, scenario) {
  return page.evaluate(async (scenario) => {
    const { bigGet, bigPut, bigDelete } = await import("/src/lib/localstore.js");
    const { ensureNode, updateNode } = await import("/src/lib/outline.js");
    const key = "taskspace-outline-v1";
    const make = (nodes, revision, pending = [], deleted = []) => ({
      format: "taskspace-outline/1", revision, at: "2035-01-01", nodes,
      sync: { sequence: revision, pending, deleted, known: [] },
    });
    const node = (id, children = []) => ensureNode({ id, text: id, children });
    const original = make([node("a"), node("b")], 1);
    const nativePut = IDBObjectStore.prototype.put;
    if (scenario === "migration") {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("taskspace", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("big");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("big", "readwrite");
        tx.objectStore("big").put(original, key);
        tx.oncomplete = resolve;
        tx.onabort = reject;
      });
      db.close();
    } else if (scenario === "large") {
      original.nodes = Array.from({ length: 25 }, (_, r) => node("r"+r,
        Array.from({ length: 19 }, (_, g) => node("g"+r+"-"+g,
          Array.from({ length: 20 }, (_, c) => node("n"+r+"-"+g+"-"+c))))));
      if (!await bigPut(key, original)) throw new Error("大量行の準備に失敗");
    } else if (!await bigPut(key, original)) throw new Error("準備の保存に失敗");

    if (scenario === "clear") {
      const removed = await bigDelete(key);
      return { removed, after: await bigGet(key) };
    }
    const nextNodes = scenario === "large"
      ? updateNode(original.nodes, "n24-18-19", { text: "1行だけ編集" })
      : [{ ...original.nodes[0], text: "新しい本文" }];
    const next = make(nextNodes, 2,
      [{ id: scenario === "large" ? "n24-18-19" : "a", kind: "put", version: 2 }]);
    if (scenario !== "large") {
      next.sync.pending.push({ id: "b", kind: "delete", version: 2 });
      next.sync.deleted = ["b"];
    }
    let rows = 0, headers = 0, wholeBody = false;
    const stringify = JSON.stringify;
    JSON.stringify = function (value, ...rest) {
      if (value === next.nodes || value?.nodes === next.nodes) wholeBody = true;
      return stringify.call(this, value, ...rest);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (Array.isArray(args[1])) {
        if (args[1][1] === "row") rows++;
        if (args[1][1] === "meta") headers++;
        if (args[0]?.nodes) wholeBody = true;
      }
      const req = nativePut.apply(this, args);
      if (scenario === "abort" || scenario === "migration") {
        if (Array.isArray(args[1]) && args[1][1] === "meta") req.addEventListener("success", () => this.transaction.abort());
      }
      return req;
    };
    let ok;
    try { ok = await bigPut(key, next); }
    finally { IDBObjectStore.prototype.put = nativePut; JSON.stringify = stringify; }
    const after = await bigGet(key);
    const recovered = (scenario === "abort" || scenario === "migration") ? await bigPut(key, next) : null;
    const recovery = recovered ? await bigGet(key) : null;
    return { ok, rows, headers, wholeBody, after, recovered, recovery };
  }, scenario);
}

test("1万行の本文を直しても、対象の1行と同期記録だけを保存する", async ({ page }) => {
  const got = await rowScenario(page, "large");
  expect(got.ok).toBe(true);
  expect(got.rows).toBe(1);
  expect(got.headers).toBe(1);
  expect(got.wholeBody).toBe(false);
  expect(got.after.nodes[24].children[18].children[19].text).toBe("1行だけ編集");
  expect(got.after.sync.pending).toEqual([{ id: "n24-18-19", kind: "put", version: 2 }]);
});

test("差分の保存が中断したら、行・削除・未送信の記録も一緒に戻す", async ({ page }) => {
  const got = await rowScenario(page, "abort");
  expect(got.ok).toBe(false);
  expect(got.after.nodes.map((n) => n.text)).toEqual(["a", "b"]);
  expect(got.after.sync.pending).toEqual([]);
  expect(got.recovered).toBe(true);
  expect(got.recovery.nodes.map((n) => n.text)).toEqual(["新しい本文"]);
  expect(got.recovery.sync.deleted).toEqual(["b"]);
});

test("旧スナップショットからの移行を中断しても、旧本文を残して再実行できる", async ({ page }) => {
  const got = await rowScenario(page, "migration");
  expect(got.ok).toBe(false);
  expect(got.after.nodes.map((n) => n.text)).toEqual(["a", "b"]);
  expect(got.recovered).toBe(true);
  expect(got.recovery.nodes[0].text).toBe("新しい本文");
  expect(got.recovery.sync.pending).toHaveLength(2);
});

test("本文を消すときは、差分の行と同期記録も同じ取引で消す", async ({ page }) => {
  expect(await rowScenario(page, "clear")).toEqual({ removed: true, after: undefined });
});

test("古い保存基準では、先に進んだ行の記録を上書きしない", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { bigPut, bigGet } = await import("/src/lib/localstore.js");
    const key = "taskspace-outline-v1";
    const record = { format: "taskspace-outline/1", revision: 1, at: "", nodes: [],
      sync: { sequence: 0, pending: [], deleted: [], known: [] } };
    if (!await bigPut(key, record)) throw new Error("準備に失敗");
    const db = await new Promise((resolve) => {
      const req = indexedDB.open("taskspace", 1); req.onsuccess = () => resolve(req.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction("big", "readwrite"), store = tx.objectStore("big");
      const req = store.get([key, "meta"]);
      req.onsuccess = () => store.put({ ...req.result, revision: 5 }, [key, "meta"]);
      tx.oncomplete = resolve;
    });
    db.close();
    const ok = await bigPut(key, { ...record, revision: 2 });
    return { ok, revision: (await bigGet(key)).revision };
  });
  expect(result).toEqual({ ok: false, revision: 5 });
});

for (const field of ["format", "count"]) {
  test(`行の${field === "format" ? "形式" : "件数"}が壊れていたら、旧形式や空の本文として読み飛ばさない`, async ({ page }) => {
    const got = await page.evaluate(async (field) => {
      const { bigPut, bigGet } = await import("/src/lib/localstore.js");
      const key = "taskspace-outline-v1";
      const record = { format: "taskspace-outline/1", revision: 1, at: "", nodes: [],
        sync: { sequence: 0, pending: [], deleted: [], known: [] } };
      if (!await bigPut(key, record)) throw new Error("準備の保存に失敗");
      const db = await new Promise((resolve) => {
        const req = indexedDB.open("taskspace", 1); req.onsuccess = () => resolve(req.result);
      });
      await new Promise((resolve) => {
        const tx = db.transaction("big", "readwrite"), store = tx.objectStore("big");
        const req = store.get([key, "meta"]);
        req.onsuccess = () => {
          const corrupt = { ...req.result };
          if (field === "format") delete corrupt.format;
          else corrupt.count = 1;
          store.put(corrupt, [key, "meta"]);
        };
        tx.oncomplete = resolve;
      });
      db.close();
      let threw = false;
      try { await bigGet(key, { throwOnError: true }); } catch { threw = true; }
      const quiet = await bigGet(key);
      const replaced = await bigPut(key, { ...record, revision: 2 });
      return { threw, quiet, replaced };
    }, field);
    expect(got).toEqual({ threw: true, quiet: undefined, replaced: false });
  });
}
