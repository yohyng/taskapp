import { describe, it, expect } from "vitest";
import { ensureNode, updateNode, indent, prepareOutlineChange, flattenTree, mergeOutline } from "./outline.js";
import {
  OUTLINE_FORMAT, outlineCheckpoint, readOutlineSnapshot, chooseOutlineSnapshot,
  changedOutlineRows, queueOutlineRows, acknowledgeOutlineRows, pendingOutlineIds, replayOutlineRows,
} from "./outline-checkpoint.js";

const n = (id, children = []) => ensureNode({ id, text: id, children });
const queue = () => ({ sequence: 0, pending: new Map() });
const change = (id, kind = "put") => ({ id, kind });
const checkpoint = (nodes = [n("a")], q = queue(), revision = 1) =>
  outlineCheckpoint(nodes, q, new Set([...q.pending.values()].filter((op) => op.kind === "delete").map((op) => op.id)),
    new Set(["a"]), revision, "2035-01-01T00:00:00.000Z");

describe("本文と未送信記録を一緒に復元する", () => {
  it("旧配列とIndexedDBの旧形式も空の木を含めて読める", () => {
    expect(readOutlineSnapshot([])).toEqual({ nodes: [], legacy: true });
    expect(readOutlineSnapshot({ at: "以前", nodes: [] })).toEqual({ nodes: [], legacy: true });
    expect(readOutlineSnapshot(null)).toBeNull();
  });
  it("本文・未送信の世代・削除・覚えをひとつの保存結果から読む", () => {
    const q = queueOutlineRows(queue(), [change("a"), change("b", "delete")]);
    const saved = JSON.parse(JSON.stringify(checkpoint([n("a")], q)));
    expect(readOutlineSnapshot(saved)).toEqual(saved);
    expect(saved.sync.pending).toEqual([
      { id: "a", kind: "put", version: 1 }, { id: "b", kind: "delete", version: 1 },
    ]);
  });
  it("新しい空のキューを、件数の多い古いキューで置き換えない", () => {
    const old = checkpoint([n("a")], queueOutlineRows(queue(), [change("a")]), 3);
    const recent = checkpoint([n("a")], queue(), 4);
    expect(chooseOutlineSnapshot(old, recent)).toBe(recent);
    expect(chooseOutlineSnapshot(recent, old)).toBe(recent);
  });
  it("世代が同じならlocalStorageを採り、旧配列の控えも従来どおり読める", () => {
    const saved = checkpoint();
    expect(chooseOutlineSnapshot(saved, checkpoint())).toBe(saved);
    expect(chooseOutlineSnapshot([], saved)).toEqual({ nodes: [], legacy: true });
  });
  it.each([
    ["将来の形式", (saved) => { saved.format = "taskspace-outline/2"; }],
    ["未送信行の本文が無い", (saved) => { saved.nodes = []; }],
    ["世代が不正", (saved) => { saved.sync.pending[0].version = 20; }],
    ["同じ行の重複", (saved) => { saved.sync.pending.push(saved.sync.pending[0]); }],
    ["削除の印が無い", (saved) => { saved.sync.pending[0].kind = "delete"; saved.nodes = []; }],
  ])("%sは空として読み飛ばさずに止める", (_label, corrupt) => {
    const saved = checkpoint([n("a")], queueOutlineRows(queue(), [change("a")]));
    corrupt(saved);
    expect(() => readOutlineSnapshot(saved)).toThrow();
  });
  it("保存用に切り出した世代は、その後のキューの変更と共有しない", () => {
    const first = queueOutlineRows(queue(), [change("a")]);
    const saved = checkpoint([n("a")], first);
    const second = queueOutlineRows(first, [change("a", "delete")]);
    expect(saved.sync.pending[0].kind).toBe("put");
    expect(first.pending.get("a").version).toBe(1);
    expect(second.pending.get("a").version).toBe(2);
    expect(saved.format).toBe(OUTLINE_FORMAT);
  });
});

describe("送信する世代と、あとから直した世代を分ける", () => {
  it("連続編集は同じ行の最新世代だけを残す", () => {
    const first = queueOutlineRows(queue(), [change("a")]);
    const second = queueOutlineRows(first, [change("a"), change("b")]);
    expect(second.pending.size).toBe(2);
    expect(second.pending.get("a").version).toBe(2);
    expect(pendingOutlineIds(second)).toEqual(new Set(["a", "b"]));
  });
  it("古い送信完了は、新しい編集や削除を取り除かない", () => {
    const first = queueOutlineRows(queue(), [change("a"), change("b")]);
    const sent = [...first.pending.values()];
    const newer = queueOutlineRows(first, [change("a", "delete")]);
    const got = acknowledgeOutlineRows(newer, sent);
    expect([...got.pending.keys()]).toEqual(["a"]);
    expect(got.pending.get("a").kind).toBe("delete");
    expect(first.pending.size).toBe(2);
  });
  it("削除を取り消したあと、前の削除の返事で復元の送信を消さない", () => {
    const removed = queueOutlineRows(queue(), [change("a", "delete")]);
    const restored = queueOutlineRows(removed, [change("a")]);
    const got = acknowledgeOutlineRows(restored, [...removed.pending.values()]);
    expect(got.pending.get("a").kind).toBe("put");
    expect(pendingOutlineIds(got)).toEqual(new Set(["a"]));
  });
  it("同じ世代が完了した場合だけ空にし、世代番号は巻き戻さない", () => {
    const q = queueOutlineRows(queue(), [change("a")]);
    const got = acknowledgeOutlineRows(q, [...q.pending.values()]);
    expect(got.pending.size).toBe(0);
    expect(got.sequence).toBe(1);
    expect(queueOutlineRows(got, [change("a")]).pending.get("a").version).toBe(2);
  });
});

describe("未送信にする行を必要な枝から拾う", () => {
  it("文字編集では親や兄弟を未送信にしない", () => {
    const before = [n("a", [n("b"), n("c")]), n("d")];
    const edited = updateNode(before, "b", { text: "変更" });
    expect(changedOutlineRows(before, edited)).toEqual([change("b")]);
    expect(changedOutlineRows(before, before)).toEqual([]);
  });
  it("移動では親や並びが変わった行も含める", () => {
    const before = [n("a"), n("b"), n("c")];
    const moved = prepareOutlineChange(before, indent(before, "b")).nodes;
    expect(changedOutlineRows(before, moved).map((op) => op.id).sort()).toEqual(["b", "c"]);
  });
  it("親ごとの削除は子孫も記録し、復元したら書き込みへ変える", () => {
    const before = [n("a", [n("b")]), n("c")];
    const after = [before[1]];
    const removed = changedOutlineRows(before, after);
    expect(removed).toContainEqual(change("a", "delete"));
    expect(removed).toContainEqual(change("b", "delete"));
    const q = queueOutlineRows(queueOutlineRows(queue(), removed), changedOutlineRows(after, before));
    expect(q.pending.get("a").kind).toBe("put");
    expect(q.pending.get("b").kind).toBe("put");
  });
  it("読み込み中の編集・追加・削除を、古い控えへ重ねる", () => {
    const base = [n("a"), n("b"), n("c")];
    const current = [n("a"), { ...n("b"), text: "読み込み中の編集", updatedAt: "2000-01-01" }, n("d")];
    const q = queueOutlineRows(queue(), [change("b"), change("c", "delete"), change("d")]);
    const got = replayOutlineRows(base, current, q.pending);
    expect(got.map((node) => node.id)).toEqual(["a", "b", "d"]);
    expect(got.find((node) => node.id === "b").text).toBe("読み込み中の編集");
    expect(flattenTree(base).map((row) => row.text)).toEqual(["a", "b", "c"]);
  });
});

describe("未送信の本文を読み直しから守る", () => {
  it("既知の行が向こうから消えていても、送信待ちの編集は残す", () => {
    const mine = [n("a")];
    const got = mergeOutline(mine, [], new Set(), new Set(["a"]), new Set(["a"]));
    expect(got.map((node) => node.id)).toEqual(["a"]);
    expect(mergeOutline(mine, [], new Set(), new Set(["a"]))).toEqual([]);
  });
  it("送信待ちの行は時刻だけで捨てず、別の行の受信は採る", () => {
    const mine = [{ ...n("a"), text: "未送信", updatedAt: "2000-01-01" }];
    const remote = [{ ...n("a"), text: "向こう", updatedAt: "2050-01-01" }, n("b")];
    const got = mergeOutline(mine, remote, new Set(), new Set(["a"]), new Set(["a"]));
    expect(got.find((node) => node.id === "a").text).toBe("未送信");
    expect(got.find((node) => node.id === "b").text).toBe("b");
    expect(mergeOutline(mine, remote).find((node) => node.id === "a").text).toBe("向こう");
  });
});

describe("移行途中の古い写しを見分ける", () => {
  it("新形式の確定後に残った移行元の写しでは、確定済みの本文を巻き戻さない", () => {
    const old = [n("a")];
    const recent = checkpoint([{ ...n("a"), text: "確定済みの変更" }]);
    expect(chooseOutlineSnapshot(old, recent, { nodes: old })).toBe(recent);
  });
  it("移行元とは異なる旧形式の控えは、従来の復元として読む", () => {
    const restored = [{ ...n("a"), text: "別の控えからの復元" }];
    expect(chooseOutlineSnapshot(restored, checkpoint(), { nodes: [n("a")] }))
      .toEqual({ nodes: restored, legacy: true });
  });
});
