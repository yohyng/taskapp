import { LoroText } from 'loro-crdt';
import { compareRows } from './tree-model.js';
import { loroViewRows } from './loro-model.js';
import { outlineFields } from './outline-model.js';

// 本文と属性の変更では木の位置は変わらない。未変更の行をWASMから読み直さず、
// 構造の更新は位置を一括取得し、更新元が不明なイベントは全体読出しへ戻して欠落を防ぐ。
export function createLoroProjection(doc) {
  const nodes = new Map(), targets = new Map(), positions = new Map(), containers = new Map();
  const counters = { fullRebuilds: 0, fullRowReads: 0, incrementalRowReads: 0, cachedRowReads: 0 };
  let rows, ambiguous;
  function rebuild(batch) {
    if (batch && !ambiguous && rebuildStructure(batch)) return;
    nodes.clear(); targets.clear(); positions.clear(); containers.clear(); ambiguous = false;
    for (const node of doc.getTree('outline').getNodes({ withDeleted: false })) {
      const data = node.data, id = data.get('id'), text = data.get('text');
      if (nodes.has(id)) ambiguous = true;
      nodes.set(id, node); targets.set(data.id, { id, type: 'map' });
      if (text?.id) targets.set(text.id, { id, type: 'text' });
      containers.set(node.id, { node, id, map: data.id, text: text?.id });
    }
    rows = Object.freeze(loroViewRows(doc).map((row, index) => {
      positions.set(row.id, index); return Object.freeze(row);
    }));
    counters.fullRebuilds++; counters.fullRowReads += rows.length;
  }
  function rebuildStructure(batch) {
    const dirty = new Set();
    // 更新元の行を特定できない通知では全体読出しへ戻し、古い本文を再利用しない。
    if (!batch.events.every((event) => {
      const path = event.path;
      if (path?.length === 1 && path[0] === 'outline' && event.diff.type === 'tree') return true;
      if (path?.[0] !== 'outline' || typeof path[1] !== 'string' || !['map', 'text'].includes(event.diff.type)) return false;
      dirty.add(path[1]); return true;
    })) return false;
    const tree = doc.getTree('outline'), next = [], indexed = [], values = new Map();
    // 木の順序は一括で取得する。本文コンテナーはそのまま使い、JSONから履歴を作り直さない。
    const stack = tree.getShallowValue().slice().reverse();
    while (stack.length) {
      const shape = stack.pop(), old = containers.get(shape.id);
      let entry = old, value = old && !dirty.has(shape.id) ? rows[positions.get(old.id)] : null;
      if (!value) {
        const node = old?.node || tree.getNodeByID(shape.id), data = node.data, text = data.get('text'), id = data.get('id');
        entry = { node, id, map: data.id, text: text?.id };
        value = typeof id === 'string' && id && text instanceof LoroText ? {
          id, text: text.toString(), favorite: !!data.get('favorite'), completed: !!data.get('completed'), deleted: !!data.get('deleted'),
          ...Object.fromEntries(outlineFields.filter((field) => data.get(field) !== undefined).map((field) => [field, data.get(field)])),
        } : null;
        counters.fullRowReads++;
      } else counters.cachedRowReads++;
      indexed.push([shape.id, entry]);
      // 作成途中の親や子は表示しない。次の受信で揃ったときに、同じIDのまま読み直す。
      const parent = shape.parent === null ? null : values.get(shape.parent);
      if (value && (shape.parent === null || parent)) {
        const row = Object.freeze({ ...value, parentId: parent?.id ?? null, order: shape.index });
        values.set(shape.id, row); next.push(row);
      }
      for (let i = shape.children.length - 1; i >= 0; i--) stack.push(shape.children[i]);
    }
    nodes.clear(); targets.clear(); positions.clear(); containers.clear(); ambiguous = false;
    for (const [nativeId, entry] of indexed) {
      const { id, node, map, text } = entry;
      if (nodes.has(id)) ambiguous = true;
      nodes.set(id, node); targets.set(map, { id, type: 'map' });
      if (text) targets.set(text, { id, type: 'text' });
      containers.set(nativeId, entry);
    }
    rows = Object.freeze(next.sort(compareRows));
    rows.forEach((row, index) => positions.set(row.id, index));
    counters.fullRebuilds++; return true;
  }
  rebuild();
  function apply(batch) {
    if (!batch.events.length) return;
    const changed = new Set();
    for (const event of batch.events) {
      const target = targets.get(event.target);
      const supported = target && (target.type === 'text' && event.diff.type === 'text'
        || target.type === 'map' && event.diff.type === 'map'
          && Object.keys(event.diff.updated).every((key) => ['favorite', 'completed', 'deleted', ...outlineFields].includes(key)));
      if (ambiguous || !supported) { rebuild(batch); return; }
      changed.add(target.id);
    }
    let next;
    for (const id of changed) {
      const index = positions.get(id), before = rows[index], data = nodes.get(id)?.data;
      if (!before || !data) { rebuild(); return; }
      counters.incrementalRowReads++;
      const values = { text: data.get('text')?.toString() ?? '', favorite: !!data.get('favorite'), completed: !!data.get('completed'), deleted: !!data.get('deleted'),
        ...Object.fromEntries(outlineFields.filter((field) => data.get(field) !== undefined).map((field) => [field, data.get(field)])) };
      if (Object.keys(values).every((key) => before[key] === values[key])) continue;
      // 通知を受けた側が以前の世代を保持していても、後の編集でその内容を書き換えない。
      next ||= rows.slice(); next[index] = Object.freeze({ ...before, ...values });
    }
    if (next) rows = Object.freeze(next);
  }
  return {
    apply, snapshot: () => rows,
    node(id) { const node = nodes.get(id); if (!node) throw new Error('行がありません'); return node; },
    nativeIds: () => [...nodes].map(([id, node]) => [id, node.id]).sort(),
    stats: () => ({ ...counters }),
  };
}
