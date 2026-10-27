import { loroViewRows } from './loro-model.js';

// 本文と属性の変更では木の位置は変わらない。未変更の行をWASMから読み直さず、
// 木・ID・コンテナーの変更や未知のイベントは正規の全体読出しへ戻して欠落を防ぐ。
export function createLoroProjection(doc) {
  const nodes = new Map(), targets = new Map(), positions = new Map();
  const counters = { fullRebuilds: 0, fullRowReads: 0, incrementalRowReads: 0 };
  let rows, ambiguous;
  function rebuild() {
    nodes.clear(); targets.clear(); positions.clear(); ambiguous = false;
    for (const node of doc.getTree('outline').getNodes({ withDeleted: false })) {
      const data = node.data, id = data.get('id'), text = data.get('text');
      if (nodes.has(id)) ambiguous = true;
      nodes.set(id, node); targets.set(data.id, { id, type: 'map' });
      if (text?.id) targets.set(text.id, { id, type: 'text' });
    }
    rows = Object.freeze(loroViewRows(doc).map((row, index) => {
      positions.set(row.id, index); return Object.freeze(row);
    }));
    counters.fullRebuilds++; counters.fullRowReads += rows.length;
  }
  rebuild();
  function apply(batch) {
    if (!batch.events.length) return;
    const changed = new Set();
    for (const event of batch.events) {
      const target = targets.get(event.target);
      const supported = target && (target.type === 'text' && event.diff.type === 'text'
        || target.type === 'map' && event.diff.type === 'map'
          && Object.keys(event.diff.updated).every((key) => ['favorite', 'completed', 'deleted'].includes(key)));
      if (ambiguous || !supported) { rebuild(); return; }
      changed.add(target.id);
    }
    let next;
    for (const id of changed) {
      const index = positions.get(id), before = rows[index], data = nodes.get(id)?.data;
      if (!before || !data) { rebuild(); return; }
      counters.incrementalRowReads++;
      const values = { text: data.get('text')?.toString() ?? '', favorite: !!data.get('favorite'), completed: !!data.get('completed'), deleted: !!data.get('deleted') };
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
