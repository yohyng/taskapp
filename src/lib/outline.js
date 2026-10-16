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

// --- ここから、Quietliner の作法に合わせた操作 ---

// その行の下、子の先頭に入れる（ズームの題で Enter したときなど）
export function insertChild(nodes, id, node) {
  const next = clone(nodes);
  const spot = locate(next, id);
  if (!spot) return nodes;
  const target = spot.siblings[spot.index];
  target.collapsed = false;
  target.children = [node, ...(target.children || [])];
  return next;
}

// 兄弟のあいだで入れ替える（Alt+↑ / ↓）。木ごと動く。
export function moveSibling(nodes, id, dir) {
  const next = clone(nodes);
  const spot = locate(next, id);
  if (!spot) return nodes;
  const to = spot.index + (dir < 0 ? -1 : 1);
  if (to < 0 || to >= spot.siblings.length) return nodes;
  const tmp = spot.siblings[spot.index];
  spot.siblings[spot.index] = spot.siblings[to];
  spot.siblings[to] = tmp;
  return next;
}

// 消したあと、どこに行くか。最後の1行を消したら空の行を1つ残す。
export function deleteNodeSafe(nodes, id) {
  const before = visibleRows(nodes).map((r) => r.node.id);
  const at = before.indexOf(id);
  const next = removeNode(nodes, id);
  if (next === nodes) return { nodes, focusId: before[0] || null };
  let focusId = before[at - 1] || before[at + 1] || null;
  if (!next.length) {
    const fresh = makeNode("");
    return { nodes: [fresh], focusId: fresh.id };
  }
  if (focusId === id) focusId = visibleRows(next)[0]?.node.id || null;
  return { nodes: next, focusId };
}

// 消すが、子は残す（自分のいた場所に繰り上げる）
export function deleteNodeKeepChildren(nodes, id) {
  const before = visibleRows(nodes).map((r) => r.node.id);
  const at = before.indexOf(id);
  const next = clone(nodes);
  const spot = locate(next, id);
  if (!spot) return { nodes, focusId: before[0] || null };
  const kids = spot.siblings[spot.index].children || [];
  spot.siblings.splice(spot.index, 1, ...kids);
  let focusId = before[at - 1] || kids[0]?.id || before[at + 1] || null;
  if (!next.length) {
    const fresh = makeNode("");
    return { nodes: [fresh], focusId: fresh.id };
  }
  return { nodes: next, focusId };
}

// 行末の Delete で、次の行を引き上げてくっつける（Backspace の逆）
export function mergeNext(nodes, id) {
  const rows = visibleRows(nodes);
  const at = rows.findIndex((r) => r.node.id === id);
  const me = rows[at]?.node;
  const after = rows[at + 1]?.node;
  if (!me || !after || after.children?.length) return { nodes, caret: null };
  const caret = me.text.length;
  let next = updateNode(nodes, id, { text: me.text + after.text });
  next = removeNode(next, after.id);
  return { nodes: next, caret };
}

// その行より下にある文字の数（自分も含む）。行の右に小さく出す。
export function countChars(node) {
  const own = node?.text?.length || 0;
  return own + (node?.children || []).reduce((sum, c) => sum + countChars(c), 0);
}

// 中身を持っている行か（ズームの点に輪を出すかどうか）
export function hasStoredBody(node) {
  const own = String(node?.text || "");
  const childLen = (node?.children || []).reduce((sum, c) => sum + countChars(c), 0);
  return Boolean(own.includes("\n") || own.length > 80 || childLen > 40);
}

// 星をつけた行を、上から順に集める
export function collectFavorites(nodes, out = []) {
  for (const node of nodes) {
    if (node.favorite) out.push(node);
    collectFavorites(node.children || [], out);
  }
  return out;
}

// #タグ。小文字でそろえる。
export function extractTags(text) {
  const found = String(text || "").match(/#([^\s#.,!?。、！？]+)/g) || [];
  return found.map((m) => m.slice(1).toLowerCase());
}

export function collectAllTags(nodes, out = new Set()) {
  for (const node of nodes) {
    extractTags(node.text).forEach((t) => out.add(t));
    collectAllTags(node.children || [], out);
  }
  return [...out].sort();
}

// 長い見出しは、パンくずでは短くする
export function truncateTitle(text, max = 18) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim() || "無題";
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

// --- 持ち込み・持ち出し ---

// Quietliner の書き出しも、素の配列も受ける。
// 置き場所の名前が版によって違うので、ありそうなところを順に見る。
export function extractImportItems(parsed) {
  if (Array.isArray(parsed)) return parsed.map(ensureNode);
  if (!parsed || typeof parsed !== "object") throw new Error("JSON が読めません");
  const candidates = [
    parsed.items, parsed.nodes, parsed.outline,
    parsed.data?.items, parsed.data?.nodes,
    parsed.payload?.items, parsed.payload?.nodes,
    parsed.root?.children,
  ];
  const source = candidates.find((v) => Array.isArray(v));
  if (!source) throw new Error("アウトラインが見つかりません（items / nodes / outline などの配列）");
  const normalized = source.map(ensureNode);
  if (!normalized.length) throw new Error("中身が空でした");
  return normalized;
}

// 同じ id がぶつからないよう、持ち込んだものには新しい id を振る
export function rekey(node) {
  return { ...node, id: uid(), children: (node.children || []).map(rekey) };
}

// 後ろに足す。同じ名前の親（Diary など）があれば、その中にまとめる。
export function appendImported(existing, imported) {
  const root = existing.map((n) => ensureNode(n));
  for (const raw of imported.map(rekey)) {
    const title = String(raw.text || "").trim().toLowerCase();
    const sameName = title && root.find((x) => String(x.text || "").trim().toLowerCase() === title);
    if (sameName && raw.children?.length) {
      sameName.children = [...(sameName.children || []), ...raw.children];
      sameName.collapsed = false;
      continue;
    }
    root.push(raw);
  }
  return root.length ? root : [makeNode("")];
}

export function buildExport(nodes) {
  return {
    app: "taskspace-outline",
    version: 1,
    exportedAt: new Date().toISOString(),
    items: nodes,
  };
}

// --- 探す ---

// 文字を含む行だけを、親の道ごと残す。
// 親は、子が見つかったときの手がかりとして残す（Workflowy と同じ）。
export function filterByQuery(nodes, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return nodes;
  const byTag = q.startsWith("#") && q.length > 1;
  const tag = byTag ? q.slice(1) : null;
  const hit = (node) => (byTag
    ? extractTags(node.text).includes(tag)
    : String(node.text || "").toLowerCase().includes(q));

  const walk = (list) => {
    const out = [];
    for (const node of list) {
      const kids = walk(node.children || []);
      if (hit(node) || kids.length) {
        // 探しているあいだは、畳んであっても中を見せる
        out.push({ ...node, collapsed: false, children: kids.length ? kids : (hit(node) ? node.children || [] : []) });
      }
    }
    return out;
  };
  return walk(nodes);
}

// 文字の中で、当たったところを切り分ける（印をつけて描くため）
export function splitByQuery(text, query) {
  const q = String(query || "").trim();
  if (!q || q.startsWith("#")) return [{ text: String(text || ""), hit: false }];
  const lower = String(text || "").toLowerCase();
  const needle = q.toLowerCase();
  const out = [];
  let at = 0;
  for (;;) {
    const found = lower.indexOf(needle, at);
    if (found < 0) break;
    if (found > at) out.push({ text: text.slice(at, found), hit: false });
    out.push({ text: text.slice(found, found + q.length), hit: true });
    at = found + q.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out.length ? out : [{ text: String(text || ""), hit: false }];
}

// --- ドラッグで動かす ---

// 木ごと、別の場所へ移す。
//   prevVisibleId … 落とした先の、すぐ上にある行（null なら先頭）
//   targetDepth   … 横に動かした量から決めた深さ
// 直前の行より深ければその中に入り、同じか浅ければ並びに入る。
export function moveSubtreeTo(nodes, dragId, prevVisibleId, targetDepth) {
  const node = findNode(nodes, dragId);
  if (!node) return nodes;
  // 自分の中には入れない
  if (prevVisibleId && pathTo(node.children || [], prevVisibleId)) return nodes;
  if (prevVisibleId === dragId) return nodes;

  const moved = { ...node, children: (node.children || []).map((c) => ({ ...c })) };
  const without = removeNode(nodes, dragId);
  if (!prevVisibleId) return [moved, ...without];

  const path = pathTo(without, prevVisibleId);
  if (!path) return [...without, moved];
  const prevDepth = path.length - 1;

  if (targetDepth > prevDepth) {
    // 直前の行の、いちばん上の子として入れる
    const next = clone(without);
    const spot = locate(next, prevVisibleId);
    const parent = spot.siblings[spot.index];
    parent.collapsed = false;
    parent.children = [moved, ...(parent.children || [])];
    return next;
  }

  // 直前の行の祖先を targetDepth まで上がって、その次に置く
  const anchor = path[Math.max(0, Math.min(targetDepth, path.length - 1))];
  const next = clone(without);
  const spot = locate(next, anchor.id);
  spot.siblings.splice(spot.index + 1, 0, moved);
  return next;
}
