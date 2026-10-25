import { buildTree, flattenTree, outlineRowSignature, imageUrlOf } from "./outline.js";

const fields = ["text", "collapsed", "completed", "favorite", "date", "headingLevel", "textColor", "bgColor", "imageWidth", "createdAt"];
const canonical = (row) => JSON.parse(outlineRowSignature(row));
const equal = (a, b) => a === b || (a == null && b == null);
const attributes = (row) => Object.fromEntries([...fields, "updatedAt"].map((key) => [key, row[key]]));
const sameContent = (a, b) => fields.every((key) => equal(a[key], b[key]));

// 呼び出してよいのは、元の要求の不適用が確定したあとか、まだ送信していない操作だけ。
// 返事を失った要求をここへ渡すと、同じ操作IDのまま本文を変えることになる。
export function rebaseOutlineRows(queue, desiredRows, serverRows, revisions, ids, conflicts = []) {
  const selected = new Set(ids);
  if (queue.flight?.sent.some((op) => !selected.has(op.id))) throw new Error("返事待ちの要求を一部だけ解消できません");
  const desiredRaw = new Map(desiredRows.map((row) => [row.id, row]));
  const desired = new Map(desiredRows.map((row) => [row.id, canonical(row)]));
  const raw = new Map(serverRows.map((row) => [row.id, row]));
  const normalizedRaw = new Map(flattenTree(buildTree(serverRows)).map((row) => [row.id, row]));
  const normalized = new Map([...normalizedRaw].map(([id, row]) => [id, canonical(row)]));
  const minimum = new Map(conflicts.map((item) => [item.id, item.actual_revision]));
  const pending = new Map(queue.pending), patches = new Map(), settled = new Set(), candidates = new Set();
  const reject = (id) => {
    const op = pending.get(id);
    pending.set(id, { ...op, operationId: undefined, blocked: true,
      rejectedOperationId: op.operationId || op.rejectedOperationId || queue.flight?.operationId });
    candidates.delete(id);
    patches.delete(id);
  };
  const retry = (op, revision, there, patch) => {
    pending.set(op.id, { ...op, operationId: undefined, blocked: undefined, expectedRevision: revision,
      baseSignature: there ? outlineRowSignature(there) : op.baseSignature, rebased: true });
    candidates.add(op.id);
    if (patch) patches.set(op.id, patch);
  };
  for (const id of selected) {
    const op = pending.get(id);
    if (!op) continue;
    const mine = desired.get(id), there = normalized.get(id), revision = revisions.get(id) ?? 0;
    // 拒否された時点より古い読み出しを、新しい保存の根拠にしない。
    if (revision < (minimum.get(id) ?? 0)) { reject(id); continue; }
    if (op.kind === "delete") {
      if (!there) { pending.delete(id); settled.add(id); }
      else if (op.expectedRevision === revision) retry(op, revision, there);
      else reject(id);
      continue;
    }
    if (!mine) { reject(id); continue; }
    if (!there) {
      // 削除履歴のある行は復活させない。端末だけに作った新規行とは区別する。
      if (!revisions.has(id) && op.expectedRevision === 0) retry(op, 0);
      else reject(id);
      continue;
    }
    const samePosition = mine.parentId === there.parentId && mine.sortOrder === there.sortOrder;
    if (sameContent(mine, there) && (op.positionChanged === false || samePosition)) {
      pending.delete(id);
      settled.add(id);
      patches.set(id, attributes(normalizedRaw.get(id)));
      continue;
    }
    let base;
    try { base = JSON.parse(op.baseSignature); } catch { /* 比較基準を推測して上書きしない */ }
    const knownBase = base?.id === id && fields.every((key) => Object.hasOwn(base, key));
    if (op.expectedRevision === revision && (!op.blocked || (knownBase && op.positionChanged !== undefined))) {
      retry(op, revision, there); continue;
    }
    // 移動・削除の自動マージは別の判断が要る。今回は位置を変えない属性の編集だけ。
    if (op.positionChanged !== false || !knownBase) {
      reject(id); continue;
    }
    // 幅は画像の持ち物。別の画像への差し替えと、元の画像の幅変更は重ねない。
    const mineImage = imageUrlOf(mine.text), theirImage = imageUrlOf(there.text), baseImage = imageUrlOf(base.text);
    if (mineImage !== theirImage && ((mineImage !== baseImage && !equal(there.imageWidth, base.imageWidth))
      || (theirImage !== baseImage && !equal(mine.imageWidth, base.imageWidth)))) {
      reject(id); continue;
    }
    const merged = { ...normalizedRaw.get(id) };
    let blocked = false;
    for (const key of fields) {
      if (equal(mine[key], base[key])) continue;
      if (equal(there[key], base[key]) || equal(mine[key], there[key])) merged[key] = desiredRaw.get(id)[key];
      else { blocked = true; break; }
    }
    if (blocked) { reject(id); continue; }
    if (sameContent(canonical(merged), there)) {
      // 自分の変更を取り消した場合も、最新の本文が既に目的を満たすなら送り返さない。
      pending.delete(id);
      settled.add(id);
      patches.set(id, attributes(normalizedRaw.get(id)));
      continue;
    }
    // 端末時刻で本文の勝敗は決めない。更新時刻だけは受信の逆行判定で古くしない。
    merged.updatedAt = (mine.updatedAt || "") > (there.updatedAt || "")
      ? desiredRaw.get(id).updatedAt : normalizedRaw.get(id).updatedAt;
    retry(op, revision, there, attributes(merged));
  }

  // 拒否された一団から安全な行だけを送り直すときも、親の削除や輪を作らない。
  // 先に子の削除を保留した結果、その親の削除も保留する場合があるため繰り返す。
  let changed = true;
  while (changed) {
    changed = false;
    // 兄弟の番号変更や親子の移動を一部だけ送ると、元の操作とは違う並びになる。
    // 構造の一団に保留があれば、その一団の構造だけはまとめて残す。
    const structuralBlocked = [...selected].some((id) => {
      const op = pending.get(id);
      return op?.blocked && (op.kind === "delete" || op.positionChanged !== false);
    });
    if (structuralBlocked) for (const id of [...candidates]) {
      const op = pending.get(id);
      if (op.kind === "delete" || op.positionChanged !== false) { reject(id); changed = true; }
    }
    const layout = new Map([...raw].map(([id, row]) => [id, row.parentId ?? null]));
    for (const id of candidates) {
      const op = pending.get(id);
      if (op.kind === "delete") layout.delete(id);
      else layout.set(id, op.positionChanged === false && raw.has(id) ? raw.get(id).parentId ?? null : desired.get(id).parentId ?? null);
    }
    const parents = new Set(layout.values());
    for (const id of [...candidates]) {
      const op = pending.get(id);
      if (op.kind === "delete") {
        if (parents.has(id)) { reject(id); changed = true; }
        continue;
      }
      const seen = new Set([id]);
      let parent = layout.get(id);
      while (parent !== null) {
        if (!layout.has(parent) || seen.has(parent)) { reject(id); changed = true; break; }
        seen.add(parent);
        parent = layout.get(parent);
      }
    }
  }
  return { queue: { ...queue, pending, flight: undefined }, patches, settled,
    blocked: [...pending.values()].filter((op) => op.blocked).map((op) => op.id), retry: [...candidates] };
}

// 受信した属性だけを重ねる。子や位置は現在の木に残し、通常の受信経路で揃える。
export function applyOutlineRebase(nodes, patches) {
  let changed = false;
  const result = nodes.map((node) => {
    const children = applyOutlineRebase(node.children || [], patches);
    const patch = patches.get(node.id);
    if (children === node.children && (!patch || Object.entries(patch).every(([key, value]) => equal(node[key], value)))) return node;
    changed = true;
    return { ...node, ...patch, children };
  });
  return changed ? result : nodes;
}
