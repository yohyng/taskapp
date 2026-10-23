import { flattenTree, buildTree, outlineRow } from "./outline.js";

export const OUTLINE_FORMAT = "taskspace-outline/1";
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 本文だけを復元すると、送信待ちだったことを忘れて受信で消してしまう。
// 本文・削除・未送信の世代は、1回の保存で同じ姿を残す。
export function outlineCheckpoint(nodes, queue, deleted, known, revision, at) {
  return {
    format: OUTLINE_FORMAT, revision, at, nodes,
    sync: { sequence: queue.sequence, pending: [...queue.pending.values()], deleted: [...deleted], known: [...known],
      ...(queue.flight ? { flight: queue.flight } : {}) },
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
      || (op.expectedRevision !== undefined && (!Number.isSafeInteger(op.expectedRevision) || op.expectedRevision < 0))
      || (op.baseSignature !== undefined && typeof op.baseSignature !== "string")
      || (op.positionChanged !== undefined && typeof op.positionChanged !== "boolean")
      || (op.operationId !== undefined && !operationIdPattern.test(op.operationId))
      || !["put", "delete"].includes(op.kind)
      || (op.kind === "put" ? !rows.has(op.id) : rows.has(op.id) || !deleted.has(op.id))) {
      throw new Error("未送信の記録を読めません");
    }
    seen.add(op.id);
  }
  // 返事待ちの本文は現在の木と違ってよい。削除・再編集後も元の要求を再現する。
  if (sync.flight !== undefined) {
    const flight = sync.flight;
    if (!flight || !operationIdPattern.test(flight.operationId) || !Array.isArray(flight.sent)
      || !flight.sent.length || flight.sent.length > 500 || !Array.isArray(flight.rows)
      || !ids(flight.gone) || !Array.isArray(flight.changes)
      || flight.changes.length !== flight.sent.length) throw new Error("送信中の記録を読めません");
    const sentIds = new Set();
    for (const op of flight.sent) {
      if (!op || typeof op.id !== "string") throw new Error("送信中の記録を読めません");
      const change = flight.changes.find((item) => item.id === op.id);
      if (sentIds.has(op.id) || !seen.has(op.id) || op.operationId !== flight.operationId
        || !Number.isSafeInteger(op.version) || op.version < 1 || op.version > sync.sequence
        || !Number.isSafeInteger(op.expectedRevision) || op.expectedRevision < 0
        || !change || change.kind !== op.kind || change.expected_revision !== op.expectedRevision
        || (op.kind === "put" ? !flight.rows.some((row) => row?.id === op.id) || change.row?.id !== op.id
          : op.kind !== "delete" || !flight.gone.includes(op.id))) throw new Error("送信中の記録を読めません");
      sentIds.add(op.id);
    }
    if (flight.rows.length + flight.gone.length !== sentIds.size
      || flight.rows.some((row) => !sentIds.has(row?.id)) || flight.gone.some((id) => !sentIds.has(id))) {
      throw new Error("送信中の記録を読めません");
    }
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

export function queueOutlineRows(queue, changes, revisions = new Map()) {
  if (!changes.length) return queue;
  const version = queue.sequence + 1;
  const pending = new Map(queue.pending);
  for (const change of changes) {
    const previous = pending.get(change.id);
    const baseSignature = previous?.baseSignature ?? change.baseSignature;
    const operation = {
      id: change.id, kind: change.kind, version,
      expectedRevision: previous?.expectedRevision ?? change.expectedRevision
        ?? revisions.get(change.id) ?? (baseSignature === undefined ? 0 : undefined),
    };
    // 元の要求が無い旧操作は、追加入力しても引き継ぎ対象だと分かるようにする。
    // 新経路の送信中はflight側に元のIDが残るので、次の編集へは引き継がない。
    if (!queue.flight && previous?.operationId) operation.operationId = previous.operationId;
    if (baseSignature !== undefined) operation.baseSignature = baseSignature;
    if (change.positionChanged !== undefined || previous?.positionChanged !== undefined) {
      operation.positionChanged = previous?.positionChanged === true || change.positionChanged === true;
    }
    pending.set(change.id, operation);
  }
  return { ...queue, sequence: version, pending };
}

// 編集時に世代一覧を取得できていなかった行は、送信直前にもう一度読む。
// 編集前に見ていた本文と現在のサーバー本文が同じ場合だけ、現在世代を採用する。
export function resolveOutlineRevisions(queue, ids, revisions, signatures) {
  const pending = new Map(queue.pending);
  const conflicts = [];
  for (const id of ids) {
    const op = pending.get(id);
    // v1.15.14〜16が既存行を新規行と誤認して残した世代0も、比較基準が
    // ある場合は確定値として扱わず、送信直前の本文と照合して修復する。
    const repairLegacyZero = op?.expectedRevision === 0 && op.baseSignature !== undefined;
    if (!op || op.operationId || (op.expectedRevision !== undefined && !repairLegacyZero)) continue;
    const currentSignature = signatures.get(id);
    if (op.baseSignature !== undefined) {
      // 旧端末にしか無かった下書きを実際に編集した場合は新規作成になる。
      // 削除履歴のあるIDはrevisionsに残るので、消された行の復活とは区別できる。
      if (op.kind === "put" && currentSignature === undefined && !revisions.has(id)) {
        pending.set(id, { ...op, expectedRevision: 0 });
        continue;
      }
      if (currentSignature !== op.baseSignature || !revisions.has(id)) {
        conflicts.push(id);
        continue;
      }
      pending.set(id, { ...op, expectedRevision: revisions.get(id) });
    } else if (currentSignature !== undefined || revisions.has(id)) {
      conflicts.push(id);
    } else {
      pending.set(id, { ...op, expectedRevision: 0 });
    }
  }
  return { queue: { ...queue, pending }, conflicts };
}

// 返事を失って再起動しても同じ操作IDで再送できるよう、通信前にキューへ付ける。
// すでにIDのある操作があれば、その一団だけを先に送り、別の再送と混ぜない。
export function prepareOutlineOperation(queue, ids, operationId) {
  const candidates = ids.map((id) => queue.pending.get(id)).filter(Boolean);
  const existing = candidates.find((op) => op.operationId)?.operationId;
  const chosen = existing || operationId;
  const pending = new Map(queue.pending);
  const sent = [];
  for (const op of candidates) {
    if (op.operationId && op.operationId !== chosen) continue;
    if (existing && !op.operationId) continue;
    if (!existing && sent.length === 500) break;
    const prepared = op.operationId ? op : { ...op, operationId: chosen };
    pending.set(op.id, prepared);
    sent.push(prepared);
  }
  return { queue: { ...queue, pending }, sent, operationId: chosen };
}

// 操作IDだけでは再送できない。行・順序・世代・省略列まで通信時のまま確定する。
export function freezeOutlineOperation(queue, prepared, rows, gone, changes) {
  const flight = structuredClone({ operationId: prepared.operationId, sent: prepared.sent, rows, gone, changes });
  return { ...queue, flight };
}

// 返ってきたのは送った世代の返事。待っている間に同じ行を直したぶんは残す。
export function acknowledgeOutlineRows(queue, sent, revisions = new Map()) {
  const pending = new Map(queue.pending);
  for (const op of sent) {
    const current = pending.get(op.id);
    if (current?.version === op.version) pending.delete(op.id);
    else if (current && revisions.has(op.id)) {
      pending.set(op.id, { ...current, expectedRevision: revisions.get(op.id), operationId: undefined });
    }
  }
  return { ...queue, pending, flight: undefined };
}

export function pendingOutlineIds(queue) {
  return new Set([...queue.pending.values()].filter((op) => op.kind === "put").map((op) => op.id));
}

// 受信で木の並び番号や既定値が整っても、それは編集ではない。
// 新しい同期経路は、ユーザー操作で確定したキューだけを送信の根拠にする。
export function queuedOutlineChanges(rows, queue, serverRows = new Map()) {
  const present = new Set(rows.map((row) => row.id));
  return {
    rows: rows.filter((row) => queue.pending.get(row.id)?.kind === "put").map((row) => {
      const op = queue.pending.get(row.id);
      const base = serverRows.get(row.id);
      // 画面で0始まりに詰めた番号を、本文編集のついでに書くと行が移動する。
      // 移動していない行にはサーバーの位置を使う。旧操作は位置変更が不明なので触らない。
      return base && op.positionChanged === false
        ? { ...row, parentId: base.parentId, sortOrder: base.sortOrder } : row;
    }),
    gone: [...queue.pending.values()]
      .filter((op) => op.kind === "delete" && !present.has(op.id)).map((op) => op.id),
  };
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
