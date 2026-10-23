import { describe, it, expect } from "vitest";
import { ensureNode, flattenTree, outlineRowSignature } from "./outline.js";
import { readOutlineBaseline, recoverOutlineOperations } from "./outline-recovery.js";

const operationId = "11111111-1111-4111-8111-111111111111";
const row = (text = "編集前の本文") => flattenTree([ensureNode({ id: "a", text, createdAt: "2026-01-01", updatedAt: "2026-01-01" })])[0];
const queue = (op = {}) => ({ sequence: 1, pending: new Map([["a", {
  id: "a", kind: "put", version: 1, operationId, expectedRevision: 0, baseSignature: outlineRowSignature(row()), ...op,
}]]) });
const results = (result = { ok: false, conflicts: [{ id: "a" }] }) => new Map([[operationId, result]]);

describe("旧版の送信結果から安全な続きを決める", () => {
  it("拒否済みの世代0は、編集前の本文と一致するときだけ新しい送信へ移す", () => {
    const q = queue();
    const got = recoverOutlineOperations(q, results(), [row("手元の編集")], [row()], new Map([["a", 1]]));
    expect(got.conflicts).toEqual([]);
    expect(got.queue.pending.get("a")).toMatchObject({ expectedRevision: 1, baseSignature: outlineRowSignature(row()) });
    expect(got.queue.pending.get("a").operationId).toBeUndefined();
    expect(q.pending.get("a").operationId).toBe(operationId);
  });
  it("既に同じ本文が届いていれば、追加保存せず送信待ちを解消する", () => {
    const desired = row("届いていた本文");
    const got = recoverOutlineOperations(queue(), results({ ok: true, revisions: { a: 2 } }), [desired], [desired], new Map([["a", 2]]));
    expect(got.queue.pending.size).toBe(0);
    expect([...got.settled]).toEqual(["a"]);
  });
  it("削除済みの行は再び消さず、新規のIDは世代0から再開する", () => {
    const removed = recoverOutlineOperations(queue({ kind: "delete" }), results(), [], [], new Map([["a", 2]]));
    expect(removed.queue.pending.size).toBe(0);
    const created = recoverOutlineOperations(queue({ baseSignature: undefined }), results({ ok: false, retired: true }), [row("新規")], [], new Map());
    expect(created.conflicts).toEqual([]);
    expect(created.queue.pending.get("a").expectedRevision).toBe(0);
  });
  it("本文の基準が無くても、世代が一致する拒否済みの行は安全に送り直せる", () => {
    const got = recoverOutlineOperations(queue({ baseSignature: undefined, expectedRevision: 3, positionChanged: false }), results(), [row("手元")], [row("現在")], new Map([["a", 3]]));
    expect(got.conflicts).toEqual([]);
    expect(got.queue.pending.get("a").operationId).toBeUndefined();
  });
  it.each([false, true])("確定結果ok=%sでも、別の本文を無条件に上書きしない", (ok) => {
    const q = queue();
    const got = recoverOutlineOperations(q, results({ ok, revisions: { a: 2 } }), [row("手元の本文")], [row("別端末の本文")], new Map([["a", 2]]));
    expect(got.conflicts).toEqual(["a"]);
    expect(got.queue.pending.get("a")).toEqual(q.pending.get("a"));
  });
  it("削除履歴のあるIDを新規作成として復活させない", () => {
    const got = recoverOutlineOperations(queue(), results(), [row("手元")], [], new Map([["a", 2]]));
    expect(got.conflicts).toEqual(["a"]);
  });
  it("更新時刻だけが異なる同じ本文は送り直さない", () => {
    const desired = { ...row("同じ本文"), updatedAt: "2030-01-01" };
    const got = recoverOutlineOperations(queue(), results(), [desired], [row("同じ本文")], new Map([["a", 2]]));
    expect(got.queue.pending.size).toBe(0);
  });
  it("旧版の本文編集から位置を推定できるときは、疎なサーバー位置を保つ", () => {
    const got = recoverOutlineOperations(queue(), results(), [row("本文の変更")], [{ ...row(), sortOrder: 100 }], new Map([["a", 1]]));
    expect(got.conflicts).toEqual([]);
    expect(got.queue.pending.get("a").positionChanged).toBe(false);
  });
  it("基準も位置変更の記録も無い既存行を自動で並び替えない", () => {
    const got = recoverOutlineOperations(queue({ baseSignature: undefined, expectedRevision: 1 }), results(), [row("本文の変更")], [{ ...row(), sortOrder: 100 }], new Map([["a", 1]]));
    expect(got.conflicts).toEqual(["a"]);
  });
  it("結果が欠けている場合は要求を作り直さず止める", () => {
    expect(() => recoverOutlineOperations(queue(), new Map(), [row()], [row()], new Map([["a", 1]]))).toThrow();
  });
});

describe("本文と世代を同じ状態として使えることを確認する", () => {
  it("本文の前後で世代が一致した場合だけ比較に使う", async () => {
    const got = await readOutlineBaseline(async () => [row()], async () => new Map([["a", 1]]));
    expect(got.rows).toEqual([row()]);
    expect(got.revisions.get("a")).toBe(1);
  });
  it("本文取得中の更新・削除・追加を検出したら、混在した基準を使わない", async () => {
    for (const after of [new Map([["a", 2]]), new Map([["a", 1], ["b", 1]]), new Map()]) {
      let call = 0;
      const got = await readOutlineBaseline(async () => [row()], async () => ++call === 1 ? new Map([["a", 1]]) : after);
      expect(got).toBeNull();
    }
  });
  it("取得失敗を空の本文や世代0として扱わない", async () => {
    expect(await readOutlineBaseline(async () => null, async () => new Map())).toBeNull();
    expect(await readOutlineBaseline(async () => [], async () => undefined)).toBeNull();
  });
});
