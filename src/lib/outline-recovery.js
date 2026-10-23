import { buildTree, flattenTree, outlineRowSignature } from "./outline.js";

// 別々に取得した本文と世代が混ざると、古い本文へ新しい世代を付けて上書きしてしまう。
// 変更履歴は削除後も残るので、前後の全世代が同じ場合だけ比較の基準にできる。
export async function readOutlineBaseline(readRows, readRevisions) {
  const before = await readRevisions();
  if (!(before instanceof Map)) return null;
  const rows = await readRows();
  if (!rows) return null;
  const after = await readRevisions();
  if (!(after instanceof Map) || before.size !== after.size
    || [...before].some(([id, revision]) => after.get(id) !== revision)) return null;
  return { rows, revisions: after };
}

// 元の要求が無い旧操作は再現しない。確定結果の確認と未着要求の失効後に、
// 目的が既に満たされた行だけを完了し、編集の基準が同じ行だけを新しい操作へ移す。
export function recoverOutlineOperations(queue, results, desiredRows, serverRows, revisions) {
  const normalized = (rows) => new Map(flattenTree(buildTree(rows)).map((row) => [row.id, row]));
  const remote = normalized(serverRows), desired = normalized(desiredRows);
  // 最終編集時刻だけが違っても、同じ内容が届いていれば追加保存は要らない。
  const content = (row) => outlineRowSignature({ ...row, updatedAt: null });
  const pending = new Map(queue.pending);
  const conflicts = [], settled = new Set();
  for (const op of queue.pending.values()) {
    if (!op.operationId) continue;
    if (!results.has(op.operationId)) throw new Error("旧版の送信結果を確認できませんでした");
    const satisfied = op.kind === "delete" ? !remote.has(op.id)
      : desired.has(op.id) && remote.has(op.id) && content(desired.get(op.id)) === content(remote.get(op.id));
    if (satisfied) {
      pending.delete(op.id);
      settled.add(op.id);
      continue;
    }
    const revision = revisions.get(op.id) ?? 0;
    const sameBase = op.baseSignature !== undefined && remote.has(op.id) && op.baseSignature === outlineRowSignature(remote.get(op.id));
    const sameRevision = op.expectedRevision !== undefined && op.expectedRevision === revision
      && (revisions.has(op.id) || !remote.has(op.id));
    let positionChanged = op.positionChanged;
    if (op.kind === "put" && positionChanged === undefined && op.baseSignature !== undefined) {
      let base;
      try { base = JSON.parse(op.baseSignature); } catch { /* 不明な位置を移動意図へ変えない */ }
      const row = desired.get(op.id);
      if (base && row && Object.hasOwn(base, "parentId") && Object.hasOwn(base, "sortOrder")) {
        if (base.parentId === row.parentId && base.sortOrder === row.sortOrder) positionChanged = false;
        else if (sameBase) positionChanged = true;
      }
    }
    // 旧版の疎な位置を0始まりで書き戻さない。位置変更が不明な既存行は自動再送しない。
    const positionKnown = op.kind === "delete" || !remote.has(op.id) || positionChanged !== undefined;
    if ((sameBase || sameRevision) && positionKnown) {
      pending.set(op.id, { ...op, operationId: undefined, expectedRevision: revision,
        ...(positionChanged !== undefined ? { positionChanged } : {}) });
    } else {
      conflicts.push(op.id);
    }
  }
  return { queue: { ...queue, pending }, conflicts, settled };
}
