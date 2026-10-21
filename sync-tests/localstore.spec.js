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
