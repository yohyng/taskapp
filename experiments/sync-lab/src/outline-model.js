import { LoroText, LoroDoc } from 'loro-crdt';

export const outlineFields = ['collapsed', 'date', 'headingLevel', 'textColor', 'bgColor', 'imageWidth', 'createdAt', 'updatedAt'];
function flatten(nodes, parentId = null, out = new Map()) {
  if (!Array.isArray(nodes)) throw new Error('アウトラインの形式が不正です');
  nodes.forEach((node, order) => {
    if (!node || typeof node.id !== 'string' || !node.id || out.has(node.id) || typeof node.text !== 'string') throw new Error('行IDか本文が不正です');
    out.set(node.id, { ...node, parentId, order }); flatten(node.children || [], node.id, out);
  });
  return out;
}
// UIが変更した列だけをCRDT操作にする。受信や画面を開いたことからこの関数を呼ばない。
export function applyOutlineIntent(doc, before, after) {
  const previous = flatten(before), desired = flatten(after), tree = doc.getTree('outline');
  const nodes = new Map(tree.getNodes({ withDeleted: false }).map((node) => [node.data.get('id'), node]));
  const layoutChanged = previous.size !== desired.size || [...desired].some(([id, row]) => {
    const old = previous.get(id); return !old || old.parentId !== row.parentId || old.order !== row.order;
  });
  for (const [id, row] of desired) {
    let node = nodes.get(id), old = previous.get(id);
    if (!node) {
      node = tree.createNode(); nodes.set(id, node); node.data.set('id', id);
      node.data.setContainer('text', new LoroText());
    }
    if (!old || old.text !== row.text) node.data.get('text').update(row.text);
    for (const field of ['favorite', 'completed', ...outlineFields]) {
      const value = row[field] ?? null;
      if (!old || (old[field] ?? null) !== value) node.data.set(field, value);
    }
    if (!old) node.data.set('deleted', false);
  }
  for (const [id, row] of desired) {
    const node = nodes.get(id);
    if (layoutChanged) {
      // 削除印の行もLoroTreeの位置を占める。表示上の変更行だけ動かすと、
      // 隠れた兄弟のある枝で追加位置がずれるため、構造変更時は表示順全体を揃える。
      const parent = row.parentId === null ? undefined : nodes.get(row.parentId);
      if (node.parent()?.id !== parent?.id || node.index() !== row.order) node.move(parent, row.order);
    }
  }
  for (const [id, row] of previous) {
    // 枝を消す操作は根の印だけ。子の受信編集は同じ履歴に残り、Undoでも取り戻せる。
    if (!desired.has(id) && (!row.parentId || desired.has(row.parentId))) nodes.get(id).data.set('deleted', true);
  }
}
export function outlineNodes(rows) {
  const mapped = new Map(), roots = [];
  for (const row of rows) mapped.set(row.id, { id: row.id, text: row.text, favorite: row.favorite, completed: row.completed,
    ...Object.fromEntries(outlineFields.map((field) => [field, row[field] ?? (field === 'collapsed' ? false : null)])), children: [] });
  const hidden = new Set(rows.filter((row) => row.deleted).map((row) => row.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  function visible(row) {
    let current = row;
    while (current) { if (hidden.has(current.id)) return false; current = byId.get(current.parentId); }
    return true;
  }
  for (const row of [...rows].sort((a, b) => a.order - b.order)) {
    if (!visible(row)) continue;
    const node = mapped.get(row.id);
    if (row.parentId === null) roots.push(node); else mapped.get(row.parentId)?.children.push(node);
  }
  return roots;
}
// 管理側で一回だけ生成する移行原本。端末ごとにJSONから別の履歴を作る入口には使わない。
export function seedOutlineDocument(nodes) {
  const doc = new LoroDoc();
  try {
    doc.getTree('outline').enableFractionalIndex(0);
    applyOutlineIntent(doc, [], nodes); doc.commit({ origin: '旧アウトラインの一度限りの移行' });
    return doc;
  } catch (error) { doc.free(); throw error; }
}
