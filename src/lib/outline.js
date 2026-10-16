// アウトライン（Quietliner 側のデータ）を扱う。
// 形は Quietliner の node に合わせてある。あとで持ち込み・持ち出しが
// できるよう、余計な付け足しはしない。
//   { id, text, collapsed, completed, favorite, children: [...] }

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function makeNode(text = "") {
  const time = new Date().toISOString();
  return {
    id: uid(),
    text,
    favorite: false,
    collapsed: false,
    completed: false,
    children: [],
    createdAt: time,
    updatedAt: time,
  };
}

// 外から来たものを、こちらの形に揃える（壊れていても落ちない）
export function ensureNode(input) {
  const time = new Date().toISOString();
  const kids = Array.isArray(input?.children) ? input.children : [];
  return {
    id: String(input?.id || uid()),
    text: typeof input?.text === "string" ? input.text : String(input?.text ?? ""),
    favorite: Boolean(input?.favorite),
    collapsed: Boolean(input?.collapsed),
    completed: Boolean(input?.completed),
    children: kids.map(ensureNode),
    createdAt: input?.createdAt || time,
    updatedAt: input?.updatedAt || time,
  };
}

// --- 探す ---

// ルートからその節までの道（親の列）。見つからなければ null。
export function pathTo(nodes, id, trail = []) {
  for (const node of nodes) {
    if (node.id === id) return [...trail, node];
    const found = pathTo(node.children || [], id, [...trail, node]);
    if (found) return found;
  }
  return null;
}

export function findNode(nodes, id) {
  return pathTo(nodes, id)?.at(-1) || null;
}

// その節が入っている配列と、その中の位置
export function locate(nodes, id, parent = null) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { siblings: nodes, index: i, parent };
    const found = locate(nodes[i].children || [], id, nodes[i]);
    if (found) return found;
  }
  return null;
}

// 画面に出ている順（畳んである中は数えない）
export function visibleRows(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    out.push({ node, depth });
    if (!node.collapsed && node.children?.length) visibleRows(node.children, depth + 1, out);
  }
  return out;
}

// --- 変える（どれも新しい配列を返す） ---

function clone(nodes) {
  return nodes.map((n) => ({ ...n, children: clone(n.children || []) }));
}

export function updateNode(nodes, id, patch) {
  const next = clone(nodes);
  const spot = locate(next, id);
  if (!spot) return nodes;
  spot.siblings[spot.index] = {
    ...spot.siblings[spot.index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return next;
}

// id の下に新しい節を入れる。子を持って開いているなら、その先頭に入れる
// （Workflowy と同じ。畳んでいるときは下の兄弟になる）。
export function insertAfter(nodes, id, node) {
  if (!id) return [...clone(nodes), node];
  const next = clone(nodes);
  const spot = locate(next, id);
  if (!spot) return [...next, node];
  const target = spot.siblings[spot.index];
  if (target.children?.length && !target.collapsed) {
    target.children = [node, ...target.children];
  } else {
    spot.siblings.splice(spot.index + 1, 0, node);
  }
  return next;
}

export function removeNode(nodes, id) {
  const next = clone(nodes);
  const spot = locate(next, id);
  if (!spot) return nodes;
  spot.siblings.splice(spot.index, 1);
  return next;
}

// ひとつ上の兄弟の子にする。上に兄弟が無ければ何もしない。
export function indent(nodes, id) {
  const next = clone(nodes);
  const spot = locate(next, id);
  if (!spot || spot.index === 0) return nodes;
  const [moved] = spot.siblings.splice(spot.index, 1);
  const prev = spot.siblings[spot.index - 1];
  prev.collapsed = false;
  prev.children = [...(prev.children || []), moved];
  return next;
}

// 親の次の兄弟にする。親が無ければ何もしない。
// 自分より下にあった兄弟は、連れていく（Workflowy と同じ）。
export function outdent(nodes, id) {
  const next = clone(nodes);
  const spot = locate(next, id);
  if (!spot || !spot.parent) return nodes;
  const parentSpot = locate(next, spot.parent.id);
  if (!parentSpot) return nodes;
  const [moved] = spot.siblings.splice(spot.index, 1);
  const following = spot.siblings.splice(spot.index);
  moved.children = [...(moved.children || []), ...following];
  parentSpot.siblings.splice(parentSpot.index + 1, 0, moved);
  return next;
}

export function toggleCollapse(nodes, id) {
  const node = findNode(nodes, id);
  if (!node) return nodes;
  return updateNode(nodes, id, { collapsed: !node.collapsed });
}

// 前の行の末尾にくっつけて、自分は消える（行頭 Backspace）。
// 子を持っているときは、消すと行き場が無くなるのでそのままにする。
export function mergeIntoPrevious(nodes, id) {
  const rows = visibleRows(nodes);
  const at = rows.findIndex((r) => r.node.id === id);
  if (at <= 0) return { nodes, focusId: null, caret: null };
  const me = rows[at].node;
  if (me.children?.length) return { nodes, focusId: null, caret: null };
  const prev = rows[at - 1].node;
  const caret = prev.text.length;
  let next = updateNode(nodes, prev.id, { text: prev.text + me.text });
  next = removeNode(next, id);
  return { nodes: next, focusId: prev.id, caret };
}
