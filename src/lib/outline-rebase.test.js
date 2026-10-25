import { describe, it, expect } from "vitest";
import { ensureNode, flattenTree, outlineRowSignature } from "./outline.js";
import { rebaseOutlineRows, applyOutlineRebase } from "./outline-rebase.js";

const row = (id, patch = {}) => ({ ...flattenTree([ensureNode({ id, text: id,
  createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z" })])[0], ...patch });
const operation = (base, patch = {}) => ({ id: base.id, kind: "put", version: 1, expectedRevision: 1,
  baseSignature: outlineRowSignature(base), positionChanged: false, ...patch });
const queue = (...ops) => ({ sequence: 1, pending: new Map(ops.map((op) => [op.id, op])) });
const rebase = (op, mine, remote, revision = 2) => rebaseOutlineRows(queue(op), [mine], remote ? [remote] : [],
  new Map([[op.id, revision]]), [op.id]);

describe("拒否された保存を項目ごとに比較する", () => {
  it.each([
    [{ text: "手元の本文" }, { collapsed: true }, { text: "手元の本文", collapsed: true }],
    [{ collapsed: true }, { text: "別端末の本文" }, { text: "別端末の本文", collapsed: true }],
    [{ favorite: true, textColor: "red" }, { imageWidth: 320 }, { favorite: true, textColor: "red", imageWidth: 320 }],
  ])("別の項目への編集を両方残す: %j / %j", (localPatch, remotePatch, expected) => {
    const base = row("a");
    const result = rebase(operation(base), { ...base, ...localPatch }, { ...base, ...remotePatch });
    expect(result.blocked).toEqual([]);
    expect(result.patches.get("a")).toMatchObject(expected);
    expect(result.queue.pending.get("a")).toMatchObject({ expectedRevision: 2, rebased: true });
  });
  it("同じ本文を異なる値へ変えた場合は、手元とサーバーのどちらも変更しない", () => {
    const base = row("a"), mine = { ...base, text: "手元" }, remote = { ...base, text: "向こう" };
    const result = rebase(operation(base), mine, remote);
    expect(result.blocked).toEqual(["a"]);
    expect(result.patches.size).toBe(0);
    expect(mine.text).toBe("手元");
    expect(remote.text).toBe("向こう");
  });
  it("同じ内容が届いている場合は、時刻の差だけで追加保存しない", () => {
    const base = row("a"), mine = { ...base, text: "同じ本文" }, remote = { ...mine, updatedAt: "2030-01-01T00:00:00Z" };
    const result = rebase(operation(base), mine, remote);
    expect([...result.settled]).toEqual(["a"]);
    expect(result.queue.pending.size).toBe(0);
  });
  it("他端末で動いた行の本文を編集しても、疎な位置番号を変更意図へ変えない", () => {
    const base = row("a"), remote = { ...base, parentId: "parent", sortOrder: 900 };
    const result = rebaseOutlineRows(queue(operation(base)), [{ ...base, text: "続きを書く" }],
      [row("parent"), remote], new Map([["a", 2], ["parent", 1]]), ["a"]);
    expect(result.blocked).toEqual([]);
    expect(result.queue.pending.get("a").positionChanged).toBe(false);
    expect(result.patches.get("a")).not.toHaveProperty("parentId");
    expect(result.patches.get("a")).not.toHaveProperty("sortOrder");
  });
  it("削除された行は属性の編集で復活させない", () => {
    const base = row("a");
    expect(rebase(operation(base), { ...base, collapsed: true }, null).blocked).toEqual(["a"]);
  });
  it("比較基準が無い既存行を推測でマージしない", () => {
    const base = row("a");
    const result = rebase(operation(base, { baseSignature: undefined }), { ...base, text: "手元" }, { ...base, favorite: true });
    expect(result.blocked).toEqual(["a"]);
  });
  it("サーバー拒否時より古い世代では再送を作らない", () => {
    const base = row("a");
    const result = rebaseOutlineRows(queue(operation(base)), [{ ...base, text: "手元" }], [base],
      new Map([["a", 1]]), ["a"], [{ id: "a", actual_revision: 2 }]);
    expect(result.blocked).toEqual(["a"]);
  });
  it("競合した行だけ保留し、同じ一団の別の行は新しい要求へ移す", () => {
    const a = row("a"), b = row("b", { sortOrder: 1 });
    const opA = operation(a), opB = operation(b);
    const original = { ...queue(opA, opB), flight: { operationId: "元の要求", sent: [opA, opB] } };
    const result = rebaseOutlineRows(original, [{ ...a, text: "手元" }, { ...b, text: "こちらも編集" }],
      [{ ...a, text: "別端末" }, b], new Map([["a", 2], ["b", 1]]), ["a", "b"]);
    expect(result.blocked).toEqual(["a"]);
    expect(result.retry).toEqual(["b"]);
    expect(result.queue.flight).toBeUndefined();
    expect(original.flight).toBeDefined();
    expect(result.queue.pending.get("a").rejectedOperationId).toBe("元の要求");
  });
  it("返事待ちの要求の一部だけを捨てない", () => {
    const a = operation(row("a")), b = operation(row("b"));
    expect(() => rebaseOutlineRows({ ...queue(a, b), flight: { sent: [a, b] } }, [], [], new Map(), ["a"])).toThrow("一部だけ");
  });
  it("移動の基準が古い場合は本文のマージと同じ扱いにしない", () => {
    const base = row("a");
    expect(rebase(operation(base, { positionChanged: true }), { ...base, sortOrder: 3 }, { ...base, favorite: true }).blocked).toEqual(["a"]);
  });
  it("削除する親に新しい子が届いていれば、親の削除だけを保留する", () => {
    const a = row("a"), b = row("b", { parentId: "a" });
    const result = rebaseOutlineRows(queue(operation(a, { kind: "delete" })), [], [a, b], new Map([["a", 1], ["b", 1]]), ["a"]);
    expect(result.blocked).toEqual(["a"]);
    expect(result.retry).toEqual([]);
  });
  it("新しい親が消えていたり輪になる移動は、他の保存に混ぜない", () => {
    const a = row("a"), b = row("b", { parentId: "a" });
    const moved = { ...a, parentId: "b" };
    const result = rebaseOutlineRows(queue(operation(a, { positionChanged: true })), [moved, b], [a, b],
      new Map([["a", 1], ["b", 1]]), ["a"]);
    expect(result.blocked).toEqual(["a"]);
  });
  it("受信した属性だけを現在の木へ重ね、未選択の行や子を保つ", () => {
    const child = ensureNode({ id: "child", text: "書き足した子" });
    const nodes = [ensureNode({ id: "a", text: "手元", children: [child] }), ensureNode({ id: "b", text: "別の行" })];
    const result = applyOutlineRebase(nodes, new Map([["a", { favorite: true }]]));
    expect(result[0]).toMatchObject({ text: "手元", favorite: true });
    expect(result[0].children).toBe(nodes[0].children);
    expect(result[1]).toBe(nodes[1]);
    expect(applyOutlineRebase(result, new Map([["a", { favorite: true }]]))).toBe(result);
  });
  it("比較に使う時刻の正規化を、保存する時刻の表記へ持ち込まない", () => {
    const base = row("a"), mine = { ...base, text: "手元", updatedAt: "2026-10-22T00:00:00.123Z" };
    const remote = { ...base, favorite: true, updatedAt: "2026-10-22T00:00:00.000+00:00" };
    const result = rebase(operation(base), mine, remote);
    expect(result.patches.get("a")).toMatchObject({ createdAt: remote.createdAt, updatedAt: mine.updatedAt });
  });
  it("削除済みの親へ移す要求を送り直さない", () => {
    const base = row("a");
    const result = rebaseOutlineRows(queue(operation(base, { positionChanged: true })), [{ ...base, parentId: "gone" }],
      [base], new Map([["a", 1], ["gone", 2]]), ["a"]);
    expect(result.blocked).toEqual(["a"]);
  });
  it("画像の差し替えに、前の画像の幅変更を重ねない", () => {
    const base = row("a", { text: "https://example.test/old.png", imageWidth: 200 });
    expect(rebase(operation(base), { ...base, text: "https://example.test/new.png", imageWidth: null },
      { ...base, imageWidth: 320 }).blocked).toEqual(["a"]);
    expect(rebase(operation(base), { ...base, imageWidth: 320 },
      { ...base, text: "https://example.test/new.png", imageWidth: null }).blocked).toEqual(["a"]);
  });
  it("親子の削除の片方が競合したら、構造はまとめて保留し別の本文だけ送る", () => {
    const a = row("a"), child = row("child", { parentId: "a" }), other = row("other", { sortOrder: 1 });
    const result = rebaseOutlineRows(queue(operation(a, { kind: "delete", positionChanged: true }),
      operation(child, { kind: "delete", positionChanged: true }), operation(other)), [{ ...other, text: "別の本文" }],
      [a, { ...child, text: "別端末の追記" }, other], new Map([["a", 1], ["child", 2], ["other", 1]]), ["a", "child", "other"]);
    expect(result.blocked.sort()).toEqual(["a", "child"]);
    expect(result.retry).toEqual(["other"]);
  });
  it("保留していた自分の変更を取り消した場合は、最新を採って送信待ちを消す", () => {
    const base = row("a"), remote = { ...base, text: "サーバーの最新" };
    const result = rebase(operation(base, { blocked: true }), { ...base, updatedAt: "2030-01-01T00:00:00Z" }, remote);
    expect(result.blocked).toEqual([]);
    expect(result.retry).toEqual([]);
    expect([...result.settled]).toEqual(["a"]);
    expect(result.patches.get("a").text).toBe("サーバーの最新");
  });
  it("旧操作の比較基準と位置が無い保留を、世代一致だけで再開しない", () => {
    const base = row("a");
    const result = rebase(operation(base, { blocked: true, baseSignature: undefined, positionChanged: undefined }),
      { ...base, text: "比較できない本文" }, base, 1);
    expect(result.blocked).toEqual(["a"]);
  });
});
