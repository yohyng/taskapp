export const compareRows = (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const placement = (row) => ({ parentId: row.parentId, order: row.order });

// 診断は読み取りだけで行う。端末を開いたことを、木の修復を書き戻す操作にしない。
export function analyzeTree(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const kinds = new Map(), cycles = [], missingParents = [];
  for (const row of rows) {
    if (kinds.has(row.id)) continue;
    const path = [], seen = new Map();
    let cursor = row.id, kind = 'visible';
    while (cursor !== null) {
      if (kinds.has(cursor)) { kind = kinds.get(cursor); break; }
      if (seen.has(cursor)) { cycles.push(path.slice(seen.get(cursor)).sort()); kind = 'detached'; break; }
      const current = byId.get(cursor);
      if (!current) { missingParents.push({ id: path.at(-1), parentId: cursor }); kind = 'detached'; break; }
      seen.set(cursor, path.length); path.push(cursor);
      if (current.deleted) { kind = 'trash'; break; }
      cursor = current.parentId;
    }
    for (const id of path) kinds.set(id, kind);
  }
  const children = new Map();
  for (const row of rows) if (kinds.get(row.id) === 'visible') {
    if (!children.has(row.parentId)) children.set(row.parentId, []);
    children.get(row.parentId).push(row);
  }
  for (const group of children.values()) group.sort(compareRows);
  const visible = [], stack = (children.get(null) || []).toReversed().map((row) => ({ ...row, depth: 0 }));
  while (stack.length) {
    const row = stack.pop(); visible.push(row);
    const nested = children.get(row.id) || [];
    for (let i = nested.length - 1; i >= 0; i--) stack.push({ ...nested[i], depth: row.depth + 1 });
  }
  return {
    visible,
    trash: rows.filter((row) => kinds.get(row.id) === 'trash').toSorted(compareRows),
    detached: rows.filter((row) => kinds.get(row.id) === 'detached').toSorted(compareRows),
    issues: { cycles: cycles.sort((a, b) => a[0] < b[0] ? -1 : 1), missingParents },
  };
}
function invalid(message, code) { throw Object.assign(new Error(message), { treeCode: code }); }
export function movePlacement(rows, id, parentId, order) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const current = byId.get(id);
  if (!current) invalid('移す枝がありません', 'missing-node');
  if (current.deleted) invalid('削除済みの枝は先に戻してください', 'deleted-node');
  if (parentId !== null && typeof parentId !== 'string') invalid('移動先が不正です', 'invalid-parent');
  const visited = new Set();
  for (let cursor = parentId; cursor !== null;) {
    if (cursor === id || visited.has(cursor)) invalid('親子が循環する移動です', 'cycle');
    visited.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) invalid('移動先がありません', 'missing-parent');
    if (parent.deleted) invalid('削除済みの枝には移せません', 'deleted-parent');
    cursor = parent.parentId;
  }
  if (order === undefined) order = Math.max(-1, ...rows.filter((row) => row.parentId === parentId && row.id !== id).map((row) => row.order)) + 1;
  if (!Number.isInteger(order) || order < -2147483648 || order > 2147483647) invalid('並び順が範囲外です', 'invalid-order');
  return { parentId, order };
}

// DB中心の案では、同じ文書の取引を直列化した後に使う。これ単体で並行実行を安全にはしない。
export function mergeTreeCommand(rows, id, command, data) {
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error('枝がありません');
  if (command.kind === 'tree-move') {
    const { before, after } = command;
    if (!before || !after || !Object.keys(data).length || Object.entries(data).some(([key, value]) => !['parent_id', 'sort_order'].includes(key) || value !== (key === 'parent_id' ? after.parentId : after.order))) throw new Error('枝の移動要求が不正です');
    const same = (a, b) => a.parentId === b.parentId && a.order === b.order;
    const now = placement(row);
    const conflict = (reason) => ({ changes: {}, conflicts: [{ field: 'placement', mine: after, theirs: { value: now, reason } }] });
    if (same(now, after)) return { changes: {}, conflicts: [] };
    if (!same(now, before)) return conflict('stale-placement');
    try { movePlacement(rows, id, after.parentId, after.order); }
    catch (error) { if (!error.treeCode) throw error; return conflict(error.treeCode); }
    return { changes: { parent_id: after.parentId, sort_order: after.order }, conflicts: [] };
  }
  if (command.kind === 'tree-delete') {
    if (typeof command.before !== 'boolean' || typeof command.after !== 'boolean' || Object.keys(data).length !== 1 || data.deleted !== Number(command.after)) throw new Error('枝の削除要求が不正です');
    if (!!row.deleted === command.after) return { changes: {}, conflicts: [] };
    if (!!row.deleted !== command.before) return { changes: {}, conflicts: [{ field: 'deleted', mine: command.after, theirs: { value: !!row.deleted, reason: 'stale-delete' } }] };
    return { changes: { deleted: Number(command.after) }, conflicts: [] };
  }
  throw new Error('対象外の木の操作です');
}
