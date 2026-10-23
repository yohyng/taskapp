// 履歴の木を丸ごと戻すと、あとから受信した本文まで送り返してしまう。
// 自分の操作の前後だけを比較し、現在もその操作の結果が残る箇所へ逆の変更を重ねる。
const fields = ['text', 'collapsed', 'completed', 'favorite', 'date', 'headingLevel', 'textColor', 'bgColor', 'imageWidth'];
const equal = (a, b) => a === b || (a == null && b == null);
const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const stamp = (node, at) => new Date(Math.max(at, (Date.parse(node.updatedAt) || 0) + 1)).toISOString();

function indexTree(nodes) {
  const entries = new Map(), groups = new Map();
  const walk = (list, parentId = null) => {
    groups.set(parentId, list.map((node) => node.id));
    for (const node of list) {
      entries.set(node.id, { node, parentId });
      walk(node.children || [], node.id);
    }
  };
  walk(nodes);
  return { entries, groups };
}

// 挿入や削除で番号がずれただけの兄弟を「移動した行」に含めない。
// 同じ親に残る行の最長増加部分列を使い、大きい並べ替えでも二乗の比較を避ける。
function stationaryIds(from, to) {
  const stable = new Set();
  for (const [parentId, ids] of from.groups) {
    const positions = new Map((to.groups.get(parentId) || []).map((id, i) => [id, i]));
    const common = ids.filter((id) => positions.has(id));
    const tails = [], previous = [];
    common.forEach((id, i) => {
      let low = 0, high = tails.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (positions.get(common[tails[mid]]) < positions.get(id)) low = mid + 1;
        else high = mid;
      }
      previous[i] = low ? tails[low - 1] : -1;
      tails[low] = i;
    });
    for (let i = tails.at(-1); i !== undefined && i >= 0; i = previous[i]) stable.add(common[i]);
  }
  return stable;
}

function neighbors(index, anchors) {
  const result = new Map();
  for (const ids of index.groups.values()) {
    let previous = null;
    for (const id of ids) {
      result.set(id, { previous, next: null });
      if (anchors.has(id)) previous = id;
    }
    let next = null;
    for (let i = ids.length - 1; i >= 0; i--) {
      result.get(ids[i]).next = next;
      if (anchors.has(ids[i])) next = ids[i];
    }
  }
  return result;
}

export function applyOutlineHistory(nodes, fromNodes, toNodes, at = Date.now()) {
  const from = indexTree(fromNodes), to = indexTree(toNodes), current = indexTree(nodes);
  const blocked = () => ({ nodes, blocked: true });
  const stable = stationaryIds(from, to);
  const removed = new Set([...from.entries.keys()].filter((id) => !to.entries.has(id)));
  const inserted = new Set([...to.entries.keys()].filter((id) => !from.entries.has(id)));
  const moved = new Set([...to.entries.keys()].filter((id) => from.entries.has(id) && !stable.has(id)));
  const anchors = new Set([...stable].filter((id) => current.entries.get(id)?.parentId === from.entries.get(id).parentId));
  const beforePosition = neighbors(from, anchors), currentPosition = neighbors(current, anchors);
  const nextNodes = new Map([...current.entries].map(([id, entry]) => [id, entry.node]));
  let changed = false;

  for (const [id, expected] of from.entries) {
    const here = current.entries.get(id), target = to.entries.get(id);
    if (removed.has(id)) {
      if (!here) continue;
      if (fields.some((field) => !equal(here.node[field], expected.node[field]))) return blocked();
      const children = (expected.node.children || []).map((node) => node.id).filter((child) => current.entries.has(child));
      if (!sameIds(here.node.children?.map((node) => node.id) || [], children)) return blocked();
    } else {
      const changes = fields.filter((field) => !equal(expected.node[field], target.node[field]));
      if (changes.length && !here) return blocked();
      const patch = {};
      for (const field of changes) {
        if (equal(here.node[field], target.node[field])) continue;
        if (!equal(here.node[field], expected.node[field])) return blocked();
        patch[field] = target.node[field];
      }
      if (Object.keys(patch).length) {
        nextNodes.set(id, { ...here.node, ...patch, updatedAt: stamp(here.node, at) });
        changed = true;
      }
    }
    if ((removed.has(id) || moved.has(id)) && here) {
      const was = beforePosition.get(id), now = currentPosition.get(id);
      if (here.parentId !== expected.parentId || was.previous !== now.previous || was.next !== now.next) return blocked();
    } else if (moved.has(id) && !here) return blocked();
  }
  for (const id of inserted) {
    // 同じIDで届いた別の行を、昔の控えで置き換えない。
    if (current.entries.has(id)) return blocked();
    const node = to.entries.get(id).node;
    nextNodes.set(id, { ...node, updatedAt: stamp(node, at) });
    changed = true;
  }
  for (const id of removed) {
    if (nextNodes.delete(id)) changed = true;
  }
  const placed = new Set([...inserted, ...moved]);
  const groups = new Map([...current.groups].map(([parent, ids]) => [parent, ids.filter((id) => !removed.has(id) && !placed.has(id))]));
  for (const id of inserted) groups.set(id, []);
  for (const [parentId, ids] of to.groups) {
    if (!ids.some((id) => placed.has(id))) continue;
    if (parentId !== null && !nextNodes.has(parentId)) return blocked();
    const list = groups.get(parentId) || [], present = new Set(list), before = new Map();
    let waiting = [];
    for (const id of ids) {
      if (placed.has(id)) waiting.push(id);
      else if (present.has(id) && waiting.length) {
        before.set(id, waiting);
        waiting = [];
      }
    }
    groups.set(parentId, [...list.flatMap((id) => [...(before.get(id) || []), id]), ...waiting]);
    changed = true;
  }
  if (!changed) return { nodes, blocked: false };

  // 別端末で親が移動していると、逆操作だけを重ねた結果に輪が生じることがある。
  // 全体を作り替える前に検査し、不可能な操作は本文も履歴もそのまま残す。
  const visiting = new Set(), visited = new Set();
  const valid = (id) => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const child of groups.get(id) || []) if (!valid(child)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const id of nextNodes.keys()) if (!valid(id)) return blocked();
  const build = (ids) => ids.map((id) => {
    const node = nextNodes.get(id);
    const children = build(groups.get(id) || []);
    return children.length === (node.children || []).length && children.every((child, i) => child === node.children[i])
      ? node : { ...node, children };
  });
  return { nodes: build(groups.get(null) || []), blocked: false };
}
