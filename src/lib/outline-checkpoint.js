import { flattenTree, buildTree, outlineRow } from "./outline.js";

export const OUTLINE_FORMAT = "taskspace-outline/1";

// 本文だけを復元すると、送信待ちだったことを忘れて受信で消してしまう。
// 本文・削除・未送信の世代は、1回の保存で同じ姿を残す。
export function outlineCheckpoint(nodes, queue, deleted, known, revision, at) {
  return {
    format: OUTLINE_FORMAT, revision, at, nodes,
    sync: { sequence: queue.sequence, pending: [...queue.pending.values()], deleted: [...deleted], known: [...known] },
  };
}

export function readOutlineSnapshot(value) {
  if (Array.isArray(value)) return { nodes: value, legacy: true };
  if (!value || typeof value !== "object") return null;
  if (value.format === undefined) return Array.isArray(value.nodes) ? { nodes: value.nodes, legacy: true } : null;
  const sync = value.sync;
  const ids = (list) => Array.isArray(list) && list.every((id) => typeof id === "string");
  if (value.format !== OUTLINE_FORMAT || !Array.isArray(value.nodes)
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !sync || !Number.isSafeInteger(sync.sequence) || sync.sequence < 0
    || !ids(sync.deleted) || !ids(sync.known) || !Array.isArray(sync.pending)) {
    throw new Error("このアウトラインの保存形式を読めません");
  }
  const rows = new Set(flattenTree(value.nodes).map((row) => row.id));
  const seen = new Set();
  const deleted = new Set(sync.deleted);
  for (const op of sync.pending) {
    if (!op || typeof op.id !== "string" || seen.has(op.id)
      || !Number.isSafeInteger(op.version) || op.version < 1 || op.version > sync.sequence
      || !["put", "delete"].includes(op.kind)
      || (op.kind === "put" ? !rows.has(op.id) : rows.has(op.id) || !deleted.has(op.id))) {
      throw new Error("未送信の記録を読めません");
    }
    seen.add(op.id);
  }
  return value;
}

// 件数や端末の時計では選ばない。空になった新しいキューも古いキューより優先する。
// 移行元と同じ旧形式の写しが残っていても、新形式の確定を巻き戻さない。
export function chooseOutlineSnapshot(local, big, legacySource = null) {
  const here = readOutlineSnapshot(local);
  const there = readOutlineSnapshot(big);
  if (here?.legacy) {
    if (there && !there.legacy && legacySource && JSON.stringify(here.nodes) === JSON.stringify(legacySource.nodes)) return there;
    return here;
  }
  if (here && there && !there.legacy) return there.revision > here.revision ? there : here;
  return here || there;
}

const fields = ["text", "collapsed", "completed", "favorite", "date", "headingLevel",
  "textColor", "bgColor", "imageWidth", "createdAt", "updatedAt"];

// 文字編集では共有されていない枝だけを見る。構造が変わったときは、
// sortOrderがずれた兄弟も含めて行を比較する。
export function changedOutlineRows(before, after) {
  const touched = [];
  const walk = (left, right) => {
    if (left === right) return true;
    if (left.length !== right.length || left.some((node, i) => node.id !== right[i].id)) return false;
    for (let i = 0; i < left.length; i++) {
      const old = left[i], node = right[i];
      if (old === node) continue;
      if (fields.some((key) => old[key] !== node[key])) touched.push({ id: node.id, kind: "put" });
      if (!walk(old.children || [], node.children || [])) return false;
    }
    return true;
  };
  if (walk(before, after)) return touched;
  const old = new Map(flattenTree(before).map((row) => [row.id, JSON.stringify(row)]));
  const next = flattenTree(after);
  const present = new Set(next.map((row) => row.id));
  return [
    ...next.filter((row) => old.get(row.id) !== JSON.stringify(row)).map((row) => ({ id: row.id, kind: "put" })),
    ...[...old.keys()].filter((id) => !present.has(id)).map((id) => ({ id, kind: "delete" })),
  ];
}

export function queueOutlineRows(queue, changes) {
  if (!changes.length) return queue;
  const version = queue.sequence + 1;
  const pending = new Map(queue.pending);
  for (const change of changes) pending.set(change.id, { id: change.id, kind: change.kind, version });
  return { sequence: version, pending };
}

// 返ってきたのは送った世代の返事。待っている間に同じ行を直したぶんは残す。
export function acknowledgeOutlineRows(queue, sent) {
  const pending = new Map(queue.pending);
  for (const op of sent) if (pending.get(op.id)?.version === op.version) pending.delete(op.id);
  return { ...queue, pending };
}

export function pendingOutlineIds(queue) {
  return new Set([...queue.pending.values()].filter((op) => op.kind === "put").map((op) => op.id));
}

// IndexedDBを待つあいだの操作も、読み込んだ控えへ重ねる。古い時刻の行でも
// この端末でいま行った操作なので、時刻の勝敗では捨てない。
export function replayOutlineRows(base, current, pending) {
  if (!pending.size) return base;
  const rows = new Map(flattenTree(base).map((row) => [row.id, row]));
  const edits = new Map(flattenTree(current).map((row) => [row.id, row]));
  for (const op of pending.values()) {
    if (op.kind === "delete") rows.delete(op.id);
    else if (edits.has(op.id)) rows.set(op.id, edits.get(op.id));
  }
  return buildTree([...rows.values()]);
}

// 保存済みの枝と同じ参照なら、その先は見ない。文字編集では対象の行だけ、
// 構造変更では並び順が変わった行も取り引きへ渡す。
export function outlineRowDelta(before, after) {
  if (!before) { const rows = flattenTree(after); return { rows, gone: [], count: rows.length }; }
  const rows = [];
  const walk = (left, right, parentId = null) => {
    if (left === right) return true;
    if (left.length !== right.length || left.some((node, i) => node.id !== right[i].id)) return false;
    for (let i = 0; i < left.length; i++) {
      const old = left[i], node = right[i];
      if (old === node) continue;
      if (fields.some((key) => old[key] !== node[key])) rows.push(outlineRow(node, parentId, i));
      if (!walk(old.children || [], node.children || [], node.id)) return false;
    }
    return true;
  };
  if (walk(before, after)) return { rows, gone: [], count: null };
  const old = new Map(flattenTree(before).map((row) => [row.id, JSON.stringify(row)]));
  const all = flattenTree(after);
  const present = new Set(all.map((row) => row.id));
  return {
    rows: all.filter((row) => old.get(row.id) !== JSON.stringify(row)),
    gone: [...old.keys()].filter((id) => !present.has(id)), count: all.length,
  };
}
