import { flattenTree, outlineRowSignature } from '../../../src/lib/outline.js';
import { readOutlineSnapshot } from '../../../src/lib/outline-checkpoint.js';

const fields = ['text', 'collapsed', 'completed', 'favorite', 'date', 'headingLevel', 'textColor', 'bgColor', 'imageWidth'];
const knownKeys = new Set(['id', 'children', 'createdAt', 'updatedAt', ...fields]);

function index(nodes) {
  const ids = new Set();
  function check(list) {
    if (!Array.isArray(list)) throw new Error('引き継ぐアウトラインの形式が不正です');
    for (const node of list) {
      if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.text !== 'string') {
        throw new Error('引き継ぐ行IDか本文が不正です');
      }
      ids.add(node.id); check(node.children ?? []);
    }
  }
  check(nodes);
  return new Map(flattenTree(nodes).map((row) => [row.id, row]));
}

function baseline(operation) {
  try {
    const row = JSON.parse(operation.baseSignature);
    if (!row || row.id !== operation.id || !fields.every((field) => Object.hasOwn(row, field))
      || !(row.parentId === null || typeof row.parentId === 'string') || !Number.isFinite(row.sortOrder)) return null;
    if (typeof row.text !== 'string' || ['collapsed', 'completed', 'favorite'].some((field) => typeof row[field] !== 'boolean')) return null;
    return row;
  } catch { return null; }
}

// 旧JSONにはCRDTの操作履歴がない。移行時だけ旧キューの基準値を使って編集列を取り出し、
// 古い端末の全文や位置を「最新に対する操作」として作り直さない。日常の同期には使わない。
// これは副作用のない候補作成。実適用には所有者確認・expectedの再検査・原本と処理済み印の
// 一体保存が必要で、候補を作っただけで旧キューを消したり、通信したりしない。
export function planLegacyOutlineHandoff(checkpoint, latest, { reservedIds = new Set() } = {}) {
  const local = index(checkpoint?.nodes), current = index(latest);
  const saved = readOutlineSnapshot(checkpoint);
  if (!saved || saved.legacy) throw new Error('未送信の記録を含む旧保存が必要です');
  const plan = { format: 'taskspace-outline-handoff/1', archive: structuredClone(checkpoint), changes: [], structures: [], settled: [], retained: [] };
  const unsupported = new Map();
  function inspect(nodes) {
    for (const node of nodes) {
      const unknown = Object.keys(node).filter((key) => !knownKeys.has(key));
      if (unknown.length) unsupported.set(node.id, unknown);
      inspect(node.children ?? []);
    }
  }
  inspect(saved.nodes);
  const operations = new Map(saved.sync.pending.map((op) => [op.id, op]));
  const ranks = new Map([...local.keys()].map((id, at) => [id, at]));
  const movingIds = new Set(saved.sync.pending.filter((op) => {
    const row = local.get(op.id), base = baseline(op);
    return op.kind === 'put' && op.positionChanged !== false && row && base
      && (row.parentId !== base.parentId || row.sortOrder !== base.sortOrder);
  }).map((op) => op.id));
  const known = new Set(saved.sync.known), handled = new Set(), working = new Map(current);
  const keep = (id, reason) => { plan.retained.push({ id, reason }); handled.add(id); };
  function placement(row, availableIds = null, moving = null) {
    const siblings = [...local.values()].filter((other) => other.parentId === row.parentId);
    const at = siblings.findIndex((other) => other.id === row.id);
    const available = (other) => other.id !== row.id && (!availableIds || availableIds.has(other.id)) && working.get(other.id)?.parentId === row.parentId;
    return { parentId: row.parentId,
      beforeId: siblings.slice(at + 1).find((other) => available(other) && !moving?.has(other.id))?.id ?? null,
      afterId: siblings.slice(0, at).reverse().find(available)?.id ?? null };
  }
  function validParent(id, parentId) {
    const seen = new Set([id]);
    for (let next = parentId; next !== null; next = working.get(next)?.parentId) {
      if (!working.has(next) || seen.has(next)) return false;
      seen.add(next);
    }
    return true;
  }
  // 新規親を先に作る。絶対的な並び番号で既存の兄弟を書き戻さず、観測した兄弟を目印にする。
  for (const row of local.values()) {
    const op = operations.get(row.id);
    if (current.has(row.id) || !op || op.kind !== 'put') continue;
    if (unsupported.has(row.id)) continue;
    if (known.has(row.id) || reservedIds.has(row.id) || op.baseSignature !== undefined || op.expectedRevision !== 0) {
      keep(row.id, 'missing-target'); continue;
    }
    if (!validParent(row.id, row.parentId)) { keep(row.id, 'missing-parent'); continue; }
    plan.structures.push({ kind: 'create', id: row.id, row: { ...row }, placement: placement(row) });
    working.set(row.id, row); handled.add(row.id);
  }
  const children = new Map();
  for (const row of current.values()) {
    if (!children.has(row.parentId)) children.set(row.parentId, []);
    children.get(row.parentId).push(row);
  }
  const subtree = (row) => [row, ...(children.get(row.id) ?? []).flatMap(subtree)];
  for (const op of saved.sync.pending.filter((entry) => entry.kind === 'delete')) {
    if (handled.has(op.id)) continue;
    const row = current.get(op.id);
    if (!row) { plan.settled.push(op.id); handled.add(op.id); continue; }
    if (operations.get(row.parentId)?.kind === 'delete') continue;
    const branch = subtree(row);
    // 削除時点を知らない子や、別端末で編集された子を枝ごと隠さない。
    const unchanged = branch.every((child) => {
      const childOp = operations.get(child.id), base = childOp && baseline(childOp);
      return childOp?.kind === 'delete' && base && outlineRowSignature(base) === outlineRowSignature(child);
    });
    if (unchanged) {
      plan.structures.push({ kind: 'delete', id: row.id, expected: branch.map((child) => ({ ...child })) });
      branch.forEach((child) => handled.add(child.id));
    } else {
      branch.filter((child) => operations.get(child.id)?.kind === 'delete').forEach((child) => keep(child.id, 'delete-conflict'));
    }
  }
  for (const operation of [...saved.sync.pending].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity))) {
    if (handled.has(operation.id)) continue;
    const here = local.get(operation.id), there = current.get(operation.id);
    if (unsupported.has(operation.id)) {
      plan.retained.push({ id: operation.id, reason: 'unsupported-fields', fields: unsupported.get(operation.id) });
      continue;
    }
    if (operation.kind === 'delete') {
      if (!there) plan.settled.push(operation.id);
      else plan.retained.push({ id: operation.id, reason: 'structure' });
      continue;
    }
    if (!there) {
      plan.retained.push({ id: operation.id, reason: 'missing-target' });
      continue;
    }
    const base = baseline(operation);
    if (!base) {
      // 返事喪失後に結果だけ一致している場合も、列と位置の一致以外を推測しない。
      if (fields.every((field) => here[field] === there[field])
        && here.parentId === there.parentId && here.sortOrder === there.sortOrder) plan.settled.push(operation.id);
      else plan.retained.push({ id: operation.id, reason: 'missing-base' });
      continue;
    }
    const set = {}, expected = {}, conflicts = [];
    for (const field of fields) {
      if (here[field] === base[field] || here[field] === there[field]) continue;
      if (there[field] === base[field]) { set[field] = here[field]; expected[field] = there[field]; }
      else conflicts.push(field);
    }
    const target = placement(here, new Set(current.keys()), movingIds), before = current.get(target.beforeId), after = current.get(target.afterId);
    const inPlace = here.parentId === there.parentId && here.sortOrder === there.sortOrder
      && (!before || there.sortOrder < before.sortOrder) && (!after || there.sortOrder > after.sortOrder)
      && (before || after || here.sortOrder === there.sortOrder);
    const moved = operation.positionChanged !== false
      && (here.parentId !== base.parentId || here.sortOrder !== base.sortOrder) && !inPlace;
    if (moved) {
      if (there.parentId !== base.parentId || there.sortOrder !== base.sortOrder) plan.retained.push({ id: operation.id, reason: 'stale-placement' });
      else if (!validParent(operation.id, here.parentId)) plan.retained.push({ id: operation.id, reason: 'invalid-parent' });
      else {
        plan.structures.push({ kind: 'move', id: operation.id, expected: { parentId: there.parentId, sortOrder: there.sortOrder }, placement: { ...target, start: true } });
        working.set(operation.id, { ...there, parentId: here.parentId });
      }
    }
    if (conflicts.length) plan.retained.push({ id: operation.id, reason: 'field-conflict', fields: conflicts });
    if (Object.keys(set).length) {
      // 遠隔の別項目が更新した時刻を巻き戻さず、時刻だけの差で確認を要求しない。
      const beforeTime = JSON.parse(outlineRowSignature(base)).updatedAt;
      const latestTime = JSON.parse(outlineRowSignature(there)).updatedAt;
      if (beforeTime === latestTime && typeof here.updatedAt === 'string' && Number.isFinite(Date.parse(here.updatedAt)) && here.updatedAt !== there.updatedAt) {
        set.updatedAt = here.updatedAt; expected.updatedAt = there.updatedAt;
      }
      plan.changes.push({ id: operation.id, set, expected });
    } else if (!moved && !conflicts.length) plan.settled.push(operation.id);
  }
  // 先に新規行を移動の目印にすると、その新規行がまだ古い位置の枝に付いて回る。
  // 既存行の移動後に、新規親子を表示順で配置するための目印を求め直す。
  const available = new Set(current.keys());
  for (const command of plan.structures.filter((entry) => entry.kind === 'create')) {
    command.placement = placement(local.get(command.id), available); available.add(command.id);
  }
  return plan;
}
