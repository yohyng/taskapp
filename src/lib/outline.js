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
    // いつのことか。日付ビューで並べ替えるのに使う。
    date: input?.date || null,
    // 見た目も持ち物。ここで落とすと、読み直しで色と見出しが消える。
    headingLevel: input?.headingLevel ? Number(input.headingLevel) : null,
    textColor: input?.textColor || null,
    bgColor: input?.bgColor || null,
    // 画像の行の幅（px）。掴んで変えたぶんを覚えておく。
    imageWidth: Number.isFinite(Number(input?.imageWidth)) && Number(input?.imageWidth) > 0
      ? Math.round(Number(input.imageWidth)) : null,
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
  // 全行を複製すると、1文字の入力でも木と履歴が膨らむ。
  // 変わった行から根までだけ作り直し、それ以外の枝はそのまま使う。
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    let changed;
    if (node.id === id) {
      changed = { ...node, children: node.children || [], ...patch, updatedAt: new Date().toISOString() };
    } else {
      if (!node.children?.length) continue;
      const children = updateNode(node.children, id, patch);
      if (children === node.children) continue;
      changed = { ...node, children };
    }
    const next = nodes.slice();
    next[i] = changed;
    return next;
  }
  return nodes;
}

// 手元で親や並びを変えた行は、古い受信で元へ戻らないよう時刻を進める。
// 文字だけの編集は共有された枝をたどるだけにして、毎打鍵の全件走査を避ける。
export function prepareOutlineChange(before, after, at = Date.now()) {
  const changedLayout = (left, right) => {
    if (left === right) return false;
    if (left.length !== right.length) return true;
    for (let i = 0; i < left.length; i++) {
      if (left[i].id !== right[i].id) return true;
      if (left[i] !== right[i] && changedLayout(left[i].children || [], right[i].children || [])) return true;
    }
    return false;
  };
  if (!changedLayout(before, after)) return { nodes: after, added: [], removed: [] };

  const index = (nodes, parentId = null, out = new Map()) => {
    nodes.forEach((node, sortOrder) => {
      out.set(node.id, { node, parentId, sortOrder });
      index(node.children || [], node.id, out);
    });
    return out;
  };
  const previous = index(before);
  const current = index(after);
  const added = [...current.keys()].filter((id) => !previous.has(id));
  const removed = [...previous.keys()].filter((id) => !current.has(id));
  const times = new Map();
  for (const [id, entry] of current) {
    const old = previous.get(id);
    if (!old) continue;
    if (old.parentId === entry.parentId && old.sortOrder === entry.sortOrder
      && old.node.collapsed === entry.node.collapsed) continue;
    const oldTime = Date.parse(old.node.updatedAt);
    const currentTime = Date.parse(entry.node.updatedAt);
    // 同じミリ秒で続けて動かした場合も、移動前の行より必ず新しくする。
    const time = new Date(Math.max(at, Number.isFinite(oldTime) ? oldTime + 1 : at,
      Number.isFinite(currentTime) ? currentTime : at)).toISOString();
    if (entry.node.updatedAt !== time) times.set(id, time);
  }
  const stamp = (nodes) => {
    let next = nodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const children = node.children?.length ? stamp(node.children) : node.children;
      if (!times.has(node.id) && children === node.children) continue;
      if (next === nodes) next = nodes.slice();
      next[i] = { ...node, children, ...(times.has(node.id) ? { updatedAt: times.get(node.id) } : {}) };
    }
    return next;
  };
  return { nodes: times.size ? stamp(after) : after, added, removed };
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
  // 消したものの中にいた行は、もう無い。残っている行から選び直す。
  const alive = new Set(visibleRows(next).map((r) => r.node.id));
  if (!focusId || !alive.has(focusId)) focusId = visibleRows(next)[0]?.node.id || null;
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

// 向こうで消した印が付いているものを、取り込みの前に落とす。
//   deletedAt … 行そのものに付いている印
//   deletedIds … 書き出しに付いてくる、消した行の一覧
function pruneDeleted(rawItems, deadIds) {
  const out = [];
  for (const raw of rawItems || []) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.deletedAt || deadIds.has(String(raw.id))) continue;
    out.push({ ...raw, children: pruneDeleted(raw.children, deadIds) });
  }
  return out;
}

// 同じものを2回読んでも増えないように、id をそのまま使う。
// 既にある行は中身を更新し、無い行だけ足す。
export function importOutline(current, parsed) {
  const deadIds = new Set((parsed?.deletedIds || []).map(String));
  const rawItems = Array.isArray(parsed) ? parsed : (() => {
    // 置き場所の判定は extractImportItems と同じにしたいので、一度通す
    extractImportItems(parsed);
    const candidates = [
      parsed.items, parsed.nodes, parsed.outline,
      parsed.data?.items, parsed.data?.nodes,
      parsed.payload?.items, parsed.payload?.nodes,
      parsed.root?.children,
    ];
    return candidates.find((v) => Array.isArray(v));
  })();

  const before = countNodes(rawItems);
  const incoming = pruneDeleted(rawItems, deadIds).map(ensureNode);
  if (!incoming.length) throw new Error("取り込める行がありませんでした");

  const curRows = flattenTree(current);
  const rootCount = current.length;
  const known = new Set(curRows.map((r) => r.id));
  const rows = new Map(curRows.map((r) => [r.id, r]));

  // id が分からない相手でも二重にならないよう、同じ名前の根は中身を寄せる
  const rootByText = new Map(
    current.map((x) => [String(x.text || "").trim().toLowerCase(), x.id]).filter(([t]) => t),
  );
  const mergedRoot = new Map();   // 取り込んだ根の id → 寄せ先の根の id
  for (const root of incoming) {
    if (known.has(root.id)) continue;
    const same = rootByText.get(String(root.text || "").trim().toLowerCase());
    if (same) mergedRoot.set(root.id, same);
  }

  let added = 0;
  let updated = 0;
  let merged = 0;
  for (const row of flattenTree(incoming)) {
    if (deadIds.has(row.id)) continue;
    if (mergedRoot.has(row.id)) { merged += 1; continue; }   // 根そのものは置き換えない
    const parentId = mergedRoot.get(row.parentId) ?? row.parentId;
    if (known.has(row.id)) updated += 1;
    else added += 1;
    rows.set(row.id, {
      ...row,
      parentId,
      // 新しく来た根は、いまある根の後ろに並べる。
      // 寄せ先に入れる子は、その中の後ろに付ける。
      sortOrder: row.parentId === null && parentId === null
        ? rootCount + row.sortOrder
        : (parentId !== row.parentId ? 1000 + row.sortOrder : row.sortOrder),
    });
  }

  return {
    nodes: buildTree([...rows.values()]),
    added,
    updated,
    merged,
    skipped: before - countNodes(incoming),
  };
}

function countNodes(list) {
  return (list || []).reduce((n, x) => n + 1 + countNodes(x?.children), 0);
}

// id を持たない書き出し（.md や Notion）は、同じ文字の行を手がかりに重ねる。
// 同じ親の下に同じ文字の行があれば、それを使い回して中だけ足す。
// こうしないと、同じ書き出しを2回読むたびに丸ごと増える。
// 中に行を持つところを、ぜんぶ畳む。
// 取り込んだ直後に何千行も開いていると、どこに入ったか分からなくなる。
export function collapseDeep(node) {
  const children = (node.children || []).map(collapseDeep);
  return { ...node, children, collapsed: children.length ? true : !!node.collapsed };
}

export function mergeByText(current, incoming, { collapseNew = false } = {}) {
  let added = 0;
  let matched = 0;

  const walk = (here, list) => {
    const out = here.map((x) => ({ ...x, children: [...(x.children || [])] }));
    // 同じ文字の兄弟がいくつもある書き出しがあるので、出てきた順に取る。
    // 先頭だけを見ると、2回目以降が毎回ぜんぶ増えてしまう。
    const queue = new Map();
    out.forEach((x, i) => {
      const key = String(x.text || "").trim();
      if (!queue.has(key)) queue.set(key, []);
      queue.get(key).push(i);
    });
    const takeSame = (key) => {
      const q = queue.get(key);
      if (!q || !q.length) return null;
      return out[q.shift()];
    };

    for (const raw of list) {
      const node = ensureNode(raw);
      const same = takeSame(String(node.text || "").trim());
      if (same) {
        matched += 1;
        same.children = walk(same.children || [], raw.children || []);
        if (raw.completed !== undefined) same.completed = !!raw.completed;
      } else {
        added += 1 + countAll(raw.children);
        out.push(collapseNew ? collapseDeep(node) : node);
      }
    }
    return out;
  };

  const nodes = walk(current, incoming);
  return { nodes, added, matched };
}

function countAll(list) {
  return (list || []).reduce((n, x) => n + 1 + countAll(x?.children), 0);
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
export function splitByQuery(rawText, query) {
  const text = String(rawText ?? "");
  const q = String(query || "").trim();
  if (!q || q.startsWith("#")) return [{ text, hit: false }];
  const lower = text.toLowerCase();
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
  return out.length ? out : [{ text, hit: false }];
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

// --- 木 ⇄ 行（Supabase に置くときの形） ---

// 木を平らにする。親と並び順を持たせれば、行の集まりから元に戻せる。
// 行の保存と送信で、属性を落とさず同じ形にする。
export function outlineRow(node, parentId = null, sortOrder = 0) {
  return {
      id: node.id,
      parentId,
      sortOrder,
      text: node.text || "",
      collapsed: !!node.collapsed,
      completed: !!node.completed,
      favorite: !!node.favorite,
      date: node.date ?? null,
      headingLevel: node.headingLevel ?? null,
      textColor: node.textColor ?? null,
      bgColor: node.bgColor ?? null,
      imageWidth: node.imageWidth ?? null,
      createdAt: node.createdAt || null,
      updatedAt: node.updatedAt || null,
  };
}

export function flattenTree(nodes, parentId = null, out = []) {
  nodes.forEach((node, i) => {
    out.push(outlineRow(node, parentId, i));
    flattenTree(node.children || [], node.id, out);
  });
  return out;
}

// 行の集まりから木に戻す。親が見つからない行は、根に置いて迷子にしない。
export function buildTree(rows) {
  const byId = new Map();
  for (const r of rows) {
    byId.set(r.id, {
      ...ensureNode({ ...r, children: [] }),
      date: r.date ?? null,
      headingLevel: r.headingLevel ?? null,
      textColor: r.textColor ?? null,
      bgColor: r.bgColor ?? null,
      imageWidth: r.imageWidth ?? null,
      __parentId: r.parentId ?? null,
      __sortOrder: Number.isFinite(r.sortOrder) ? r.sortOrder : 0,
    });
  }
  // 親をたどって根に着くか見る。輪になっている行は、捨てずに根へ出す。
  const reachesRoot = (node) => {
    const seen = new Set([node.id]);
    let cur = node.__parentId ? byId.get(node.__parentId) : null;
    while (cur) {
      if (seen.has(cur.id)) return false;
      seen.add(cur.id);
      cur = cur.__parentId ? byId.get(cur.__parentId) : null;
    }
    return true;
  };
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.__parentId ? byId.get(node.__parentId) : null;
    if (parent && parent !== node && reachesRoot(node)) parent.children.push(node);
    else roots.push(node);
  }
  const sortDeep = (list) => {
    list.sort((a, b) => a.__sortOrder - b.__sortOrder);
    for (const node of list) {
      sortDeep(node.children);
      delete node.__parentId;
      delete node.__sortOrder;
    }
    return list;
  };
  return sortDeep(roots);
}

// 手元と向こうを突き合わせる。同じ行は新しいほうを採り、
// 片方にしかない行は残す（消したものは、消した印で外す）。
// knownIds … 前に「向こうにもある」と確かめた行の id。
// 向こうから消えていて、しかも前に確かめていた行は、ほかの端末で
// 消されたということ。手元にも残さない（残すと送り返して復活する）。
export function mergeOutline(localNodes, remoteNodes, deletedIds = new Set(), knownIds = null, pendingIds = new Set()) {
  const localRows = flattenTree(localNodes);
  const remoteRows = flattenTree(remoteNodes);
  const remoteIds = new Set(remoteRows.map((r) => r.id));
  const byId = new Map();
  // 消した印は「向こうから戻ってこないため」のもの。
  // 手元にある行には使わない。使うと、消したあとに取り消した行や、
  // 取り込み直した行まで、読み直すたびに消えてしまう。
  for (const row of remoteRows) {
    if (deletedIds.has(row.id)) continue;
    byId.set(row.id, row);
  }
  for (const row of localRows) {
    const there = byId.get(row.id);
    if (!there) {
      // 向こうに無い行。前に確かめたことがあるなら、向こうで消された。
      if (knownIds && knownIds.has(row.id) && !remoteIds.has(row.id) && !pendingIds.has(row.id)) continue;
      byId.set(row.id, row);
      continue;
    }
    const mine = row.updatedAt || "";
    const theirs = there.updatedAt || "";
    byId.set(row.id, pendingIds.has(row.id) || mine >= theirs ? row : there);
  }
  return buildTree([...byId.values()]);
}

// その日のメモを足す。日付の行が無ければ作って、いちばん上に置く
// （新しい日が手元に来るように）。中では後ろに足していく。
export function addMemoUnderDate(nodes, dateLabel, text) {
  const made = makeNode(text);
  const at = nodes.findIndex((n) => String(n.text || "").trim() === dateLabel);
  if (at >= 0) {
    const next = clone(nodes);
    next[at].collapsed = false;
    next[at].children = [...(next[at].children || []), made];
    return { nodes: next, id: made.id, dayId: next[at].id };
  }
  const day = { ...makeNode(dateLabel), children: [made] };
  return { nodes: [day, ...nodes], id: made.id, dayId: day.id };
}

// --- まとめて操作する ---

// 選んだ行をまとめて字下げする。
// 1行ずつ indent すると、2行目が1行目の子になって選択が割れる。
// WorkFlowy と同じく、先頭の行の「ひとつ上の兄弟」の下にまとめて入れる。
export function indentMany(nodes, ids) {
  if (!ids.length) return nodes;
  // 選んだ中で、親も選ばれているものは一緒に動くので外す
  const tops = ids.filter((id) => {
    const path = pathTo(nodes, id) || [];
    return !path.slice(0, -1).some((p) => ids.includes(p.id));
  });
  if (!tops.length) return nodes;
  const first = locate(nodes, tops[0]);
  if (!first || first.index === 0) return nodes;      // 上に兄弟がいない
  const parentId = first.siblings[first.index - 1].id;

  let out = nodes;
  for (const id of tops) {
    const spot = locate(out, id);
    const parent = locate(out, parentId);
    if (!spot || !parent) continue;
    // 入れ先が自分の中にあるなら動かさない
    if (pathTo(spot.siblings[spot.index].children || [], parentId)) continue;
    const cloned = clone(out);
    const from = locate(cloned, id);
    const to = locate(cloned, parentId);
    if (!from || !to) continue;
    const [moved] = from.siblings.splice(from.index, 1);
    const target = to.siblings[to.index];
    target.collapsed = false;
    target.children = [...(target.children || []), moved];
    out = cloned;
  }
  return out;
}

// 戻すほうは下から。上から戻すと、下の兄弟を連れていってしまう。
export function outdentMany(nodes, ids) {
  let out = nodes;
  for (const id of [...ids].reverse()) out = outdent(out, id);
  return out;
}

export function removeMany(nodes, ids) {
  let out = nodes;
  for (const id of ids) out = removeNode(out, id);
  return out.length ? out : [makeNode("")];
}

export function patchMany(nodes, ids, patch) {
  let out = nodes;
  for (const id of ids) out = updateNode(out, id, patch);
  return out;
}

// 選んだぶんを、字下げつきの文章にする（持ち出し・コピー用）
export function textOf(nodes, ids = null) {
  const lines = [];
  const walk = (list, depth) => {
    for (const node of list) {
      const take = !ids || ids.includes(node.id);
      if (take) lines.push("  ".repeat(depth) + (node.text || ""));
      walk(node.children || [], take ? depth + 1 : depth);
    }
  };
  walk(nodes, 0);
  return lines.join("\n");
}

// 画面に出ている順で、2つの行のあいだを選ぶ（Shift+クリック）
export function rangeBetween(nodes, fromId, toId) {
  const order = visibleRows(nodes).map((r) => r.node.id);
  const a = order.indexOf(fromId);
  const b = order.indexOf(toId);
  if (a < 0 || b < 0) return [toId];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

// --- #タグの補完 ---

// カーソルが #… の途中にいるか。いるなら、その始まりと打ちかけの文字。
export function hashtagAtCursor(text, cursorPos) {
  const before = String(text || "").slice(0, cursorPos);
  const m = before.match(/#([^\s#.,!?。、！？]*)$/);
  if (!m) return null;
  return { start: m.index, query: m[1].toLowerCase() };
}

// 候補。打ちかけの文字で始まるものを、使われている順に。
export function tagSuggestions(allTags, query, limit = 8) {
  const q = String(query || "").toLowerCase();
  return allTags.filter((t) => t.startsWith(q) && t !== q).slice(0, limit);
}

// 打ちかけの #… を、選んだタグで置き換える。後ろに空白を足して次を打てるように。
export function applyTag(text, cursorPos, tag) {
  const at = hashtagAtCursor(text, cursorPos);
  if (!at) return { text, caret: cursorPos };
  const next = `${text.slice(0, at.start)}#${tag} ${text.slice(cursorPos)}`;
  return { text: next, caret: at.start + tag.length + 2 };
}

// 文字を、ふつうの部分と #タグ に切り分ける（色を付けて描くため）
export function splitTags(text) {
  const s = String(text || "");
  const out = [];
  const re = /#([^\s#.,!?。、！？]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), tag: false });
    out.push({ text: m[0], tag: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), tag: false });
  return out.length ? out : [{ text: s, tag: false }];
}

// --- 日付のプロパティ ---

// 文字から日付らしきものを読む。年だけ・年月だけのこともある。
//   2026/01/02 ・ 2026-01-02 ・ 20260102 ・ 2026/01 ・ 2026
// 返すのは { y, m, d }（分からないところは null）。
export function dateHintOf(text) {
  const s = String(text || "").trim();
  if (!s) return null;

  // 区切りのある形（先頭にあるものだけを見る。文中の数字は拾わない）
  let m = s.match(/^(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(20\d{2})[/-](\d{1,2})(?![/-]?\d)/);
  if (m) return { y: +m[1], m: +m[2], d: null };
  // くっついた8桁（20260107NOL… のような書き方）
  m = s.match(/^(20\d{2})(\d{2})(\d{2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
    return { y: +m[1], m: +m[2], d: +m[3] };
  }
  m = s.match(/^(20\d{2})(?!\d)/);
  if (m) return { y: +m[1], m: null, d: null };
  return null;
}

const pad = (n) => String(n).padStart(2, "0");

export function dateKeyOf(hint) {
  if (!hint?.y || !hint.m || !hint.d) return null;
  return `${hint.y}-${pad(hint.m)}-${pad(hint.d)}`;
}

// 木をたどって、日付が分かる行に date を入れる。
// 見出しが「2026 > 2026/01 > 2026/01/02」のように並ぶ書き方が多いので、
// 上から受け継いだ年・月と、その行自身の書き方を合わせて決める。
export function fillDates(nodes, inherited = { y: null, m: null, d: null }) {
  return nodes.map((node) => {
    const own = dateHintOf(node.text);
    const here = {
      y: own?.y ?? inherited.y,
      m: own?.m ?? (own?.y ? null : inherited.m),
      d: own?.d ?? (own ? null : inherited.d),
    };
    const key = dateKeyOf(here);
    return {
      ...node,
      // 既に入っているものは触らない（手で直したぶんを消さない）
      date: node.date || key || null,
      children: fillDates(node.children || [], here),
    };
  });
}

// 日付ビュー。年＞年/月＞年/月/日 に並べ替えて見せる。
// 元の木は触らない。見出しは、その場で作る仮の行（id は date: で始まる）。
//   newestYearFirst … 年は新しい順（月日は古い順）。書いたものを見返す向き。
export function groupByDate(nodes, { newestYearFirst = true } = {}) {
  const rows = [];
  // その下のどこかに日付があるか（包みの中を見にいくかの判断に使う）
  const datedInside = (node) =>
    (node.children || []).some((kid) => kid.date || datedInside(kid));
  const walk = (list) => {
    for (const node of list) {
      // 日付の見出しそのもの（2026 / 2026/01 / 2026/01/02）は、並べ替えると
      // 二重になるので置いていき、その中身だけを拾う。
      const own = dateHintOf(node.text);
      const isHeading = !!own && String(node.text || "").trim().length <= 10;
      if (isHeading) { walk(node.children || []); continue; }
      // 日付そのものは持っていないが、下に日付のある行をかかえている包み
      // （書き出しの表題など）は、中をほどいて拾う。
      // これをしないと、ぜんぶが「日付なし」のひとかたまりになってしまう。
      if (!node.date && datedInside(node)) { walk(node.children || []); continue; }
      // 見出しでない行は、中身ごとそのまま持っていく（下へは降りない）
      rows.push(node);
    }
  };
  walk(nodes);

  const years = new Map();
  const undated = [];
  for (const node of rows) {
    if (!node.date) { undated.push(node); continue; }
    const [y, m, d] = node.date.split("-");
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y);
    if (!months.has(m)) months.set(m, new Map());
    const days = months.get(m);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(node);
  }

  const sortKeys = (map, desc = false) =>
    [...map.keys()].sort((a, b) => (desc ? b.localeCompare(a) : a.localeCompare(b)));

  const out = sortKeys(years, newestYearFirst).map((y) => ({
    id: `date:${y}`, text: y, virtual: true, collapsed: true, children:
      sortKeys(years.get(y)).map((m) => ({
        id: `date:${y}-${m}`, text: `${y}/${m}`, virtual: true, collapsed: true, children:
          sortKeys(years.get(y).get(m)).map((d) => ({
            id: `date:${y}-${m}-${d}`, text: `${y}/${m}/${d}`, virtual: true, defaultOpen: true, collapsed: false,
            children: years.get(y).get(m).get(d),
          })),
      })),
  }));

  if (undated.length) {
    out.push({ id: "date:none", text: "日付なし", virtual: true, collapsed: true, children: undated });
  }
  return out;
}

// --- 画像 ---

// 行が「画像ひとつ」なら、その URL を返す。
// Google ドライブの共有リンクは、そのままでは絵として出ないので直す。
//   https://drive.google.com/file/d/<id>/view?usp=sharing
//   https://drive.google.com/open?id=<id>
//   https://drive.google.com/uc?id=<id>
//   https://lh3.googleusercontent.com/d/<id>
export function driveIdOf(url) {
  const s = String(url || "");
  const m = s.match(/drive\.google\.com\/file\/d\/([\w-]+)/)
    || s.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([\w-]+)/)
    || s.match(/lh3\.googleusercontent\.com\/d\/([\w-]+)/);
  return m ? m[1] : null;
}

export function imageUrlOf(text) {
  const s = String(text || "").trim();
  if (!s) return null;

  // ![説明](URL) の形
  const md = s.match(/^!\[[^\]]*\]\((\S+?)\)$/);
  const raw = md ? md[1] : s;
  if (/\s/.test(raw)) return null;        // ほかの文字が混ざっていたら、絵にしない
  if (!/^https?:\/\//i.test(raw)) return null;

  const drive = driveIdOf(raw);
  // ドライブは「中身を見せる」口に差し替える。大きさは幅で指定できる。
  if (drive) return `https://drive.google.com/thumbnail?id=${drive}&sz=w1600`;

  if (/\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(raw)) return raw;
  if (md) return raw;                     // ![](…) と書いてあるなら、拡張子が無くても絵として扱う
  return null;
}

// --- すぐ伝える（ほかの端末から届いた行を、木に入れる） ---

// rows … 入れ替える行（flattenTree と同じ形）、goneIds … 消えた行
// 木は作り直すが、届いていない行はそのまま残す。
export function applyRemoteRows(nodes, rows = [], goneIds = []) {
  const flat = flattenTree(nodes);
  const byId = new Map(flat.map((r) => [r.id, r]));
  for (const row of rows) {
    const here = byId.get(row.id);
    // 手元のほうが新しければ、そのままにする（打っている途中を消さない）
    if (here && (here.updatedAt || "") > (row.updatedAt || "")) continue;
    byId.set(row.id, row);
  }
  for (const id of goneIds) byId.delete(id);
  return buildTree([...byId.values()]);
}
