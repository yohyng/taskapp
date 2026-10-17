import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown, MoreHorizontal, Star, Check, Trash2, Search, X, Download, Upload, Undo2, Redo2, Settings2 } from "lucide-react";
import {
  makeNode, ensureNode, pathTo, visibleRows, filterByQuery, splitByQuery,
  importOutline, mergeByText, buildExport, moveSubtreeTo,
  insertAfter, insertChild, indent, outdent, toggleCollapse, mergeIntoPrevious, mergeNext,
  moveSibling, deleteNodeSafe, deleteNodeKeepChildren, updateNode,
  countChars, hasStoredBody, truncateTitle,
  flattenTree, buildTree, mergeOutline,
  indentMany, outdentMany, removeMany, patchMany, textOf, rangeBetween, collectFavorites,
  collectAllTags, hashtagAtCursor, tagSuggestions, applyTag, splitTags, addMemoUnderDate,
} from "./lib/outline";
import { loadOutlineRows, saveOutlineRows, isOutlineTableMissing, outlineTableSql } from "./lib/db";
import { parseByFormat, parseZip } from "./lib/import-formats";

const OUTLINE_KEY = "taskspace-outline-v1";

// 木はひとつ。枠（ペイン）をいくつ開いても、同じものを見ている。
// 枠ごとに違うのは「どこにズームしているか」だけ。
const OutlineContext = React.createContext(null);
// 木そのものを要らない側（App のメモ追加など）のための口。
// ここは中身が変わらないので、木を書き換えても描き直しを誘わない。
const OutlineApiContext = React.createContext(null);

const OUTLINE_VIEW_KEY = "taskspace-outline-view";
const DEFAULT_VIEW = { fontSize: 14, align: "left", typewriter: false, anchor: 0.6 };
const readView = () => {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(OUTLINE_VIEW_KEY) || "{}") }; }
  catch { return { ...DEFAULT_VIEW }; }
};

const OUTLINE_TOMB_KEY = "taskspace-outline-deleted";
const readTomb = () => {
  try { return new Set(JSON.parse(localStorage.getItem(OUTLINE_TOMB_KEY) || "[]")); } catch { return new Set(); }
};
const writeTomb = (set) => {
  // まとめて消したときは万単位になる。ここで切ると、切られたぶんが
  // 次の読み込みで戻ってくるので、多めに持つ。
  try { localStorage.setItem(OUTLINE_TOMB_KEY, JSON.stringify([...set].slice(-20000))); } catch { /* noop */ }
};

export function OutlineProvider({ children }) {
  const [nodes, setNodes] = useState(load);
  // いまの木を、更新の外からも読めるようにしておく（履歴を積むため）
  const nodesRef = useRef(nodes);
  // 履歴そのものは ref に持ち、画面には「戻せるか」だけを伝える。
  // 更新関数の中で木を動かすと、二度呼ばれたときにずれるため。
  const histRef = useRef({ past: [], future: [] });
  const [histCount, setHistCount] = useState({ past: 0, future: 0 });
  const syncHist = (next) => {
    histRef.current = next;
    setHistCount({ past: next.past.length, future: next.future.length });
  };
  const coalesceRef = useRef({ key: null, at: 0 });
  const [syncNote, setSyncNote] = useState("");  // 置き場が無いときの知らせ
  const [view, setViewState] = useState(readView);
  const setView = useCallback((patch) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(OUTLINE_VIEW_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);
  const readyRef = useRef(false);                 // 読み込み前は送らない
  const syncedRef = useRef(new Map());            // 向こうと同じだと分かっている行
  const tombRef = useRef(readTomb());
  const timerRef = useRef(null);

  // 手元には必ず残す。向こうが無くても使えるように。
  // 入りきらないこともある（大きな書き出しを取り込んだとき）。
  // 黙って落とすと、閉じた瞬間に消えるので知らせる。
  const tooBigRef = useRef(false);
  useEffect(() => {
    let failed = false;
    try {
      localStorage.setItem(OUTLINE_KEY, JSON.stringify(nodes));
    } catch {
      failed = true;
    }
    // 知らせは、変わったときだけ出す（毎回 setState すると描き直しが続く）
    if (failed !== tooBigRef.current) {
      tooBigRef.current = failed;
      setSyncNote((cur) => (failed ? "too-big" : (cur === "too-big" ? "" : cur)));
    }
  }, [nodes]);

  // 書き換えはここを通す。前の姿を履歴に積む。
  // 字を打っているあいだは1手にまとめる（1文字ずつ戻るのは使いにくい）。
  const apply = useCallback((updater, opts = {}) => {
    const prev = nodesRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    if (next === prev) return;
    nodesRef.current = next;
    setNodes(next);
    const now = Date.now();
    const c = coalesceRef.current;
    const same = opts.coalesce && c.key === opts.coalesce && now - c.at < 900;
    coalesceRef.current = { key: opts.coalesce || null, at: now };
    if (same) return;
    const h = histRef.current;
    syncHist({ past: [...h.past, prev].slice(-100), future: [] });
  }, []);

  // 同期で入ってきたぶんは、履歴に積まない（自分の操作ではないので）
  const applyRaw = useCallback((updater) => {
    const prev = nodesRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    nodesRef.current = next;
    setNodes(next);
  }, []);

  const undo = useCallback(() => {
    const h = histRef.current;
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    const now = nodesRef.current;
    nodesRef.current = prev;
    setNodes(prev);
    coalesceRef.current = { key: null, at: 0 };
    syncHist({ past: h.past.slice(0, -1), future: [...h.future, now].slice(-100) });
  }, []);

  const redo = useCallback(() => {
    const h = histRef.current;
    if (!h.future.length) return;
    const node = h.future[h.future.length - 1];
    const now = nodesRef.current;
    nodesRef.current = node;
    setNodes(node);
    coalesceRef.current = { key: null, at: 0 };
    syncHist({ past: [...h.past, now].slice(-100), future: h.future.slice(0, -1) });
  }, []);

  // 読み込み：向こうと突き合わせる。消した印のものは戻さない。
  useEffect(() => {
    let alive = true;
    loadOutlineRows().then((rows) => {
      if (!alive) return;
      if (!rows) {
        // 読めていないのに送り始めると、向こうの新しい行を手元の古い木で
        // 上書きしてしまう。置き場が無いときだけ、知らせて黙る。
        if (isOutlineTableMissing()) setSyncNote("missing-table");
        return;
      }
      readyRef.current = true;
      const remote = buildTree(rows);
      applyRaw((mine) => {
        const merged = mergeOutline(mine, remote, tombRef.current);
        // 向こうの姿を覚えておく。食い違うぶんは、このあとの保存で送られる。
        syncedRef.current = new Map(flattenTree(remote).map((r) => [r.id, JSON.stringify(r)]));
        return merged.length ? merged : mine;
      });
    });
    return () => { alive = false; };
  }, []);

  // 書き込み：変わった行だけ、少し待ってから送る
  useEffect(() => {
    if (!readyRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rows = flattenTree(nodes);
      const here = new Set(rows.map((r) => r.id));
      const changed = rows.filter((r) => syncedRef.current.get(r.id) !== JSON.stringify(r));
      const gone = [...syncedRef.current.keys()].filter((id) => !here.has(id));
      // いま手元にある行は、もう「消したもの」ではない。
      // 印を残したままだと、次に読み込んだときにまた消される。
      let revived = false;
      for (const id of here) if (tombRef.current.delete(id)) revived = true;
      if (revived) writeTomb(tombRef.current);
      if (!changed.length && !gone.length) return;
      if (gone.length) {
        gone.forEach((id) => tombRef.current.add(id));
        writeTomb(tombRef.current);
      }
      saveOutlineRows(changed, gone).then((err) => {
        if (isOutlineTableMissing()) { setSyncNote("missing-table"); return; }
        if (err) {
          // 断られたときに黙っていると、同期しているつもりで消える。
          // いちばん多いのは、新しい表に RLS がかかっていて書けない場合。
          setSyncNote(`error:${err}`);
          return;
        }
        setSyncNote((cur) => (cur.startsWith("error:") ? "" : cur));
        // 向こうから本当に消えたなら、もう印は要らない。
        // 万単位の印を抱えると、こんどは置き場のほうが溢れる。
        if (gone.length) {
          gone.forEach((id) => tombRef.current.delete(id));
          writeTomb(tombRef.current);
        }
        const next = new Map(syncedRef.current);
        gone.forEach((id) => next.delete(id));
        changed.forEach((r) => next.set(r.id, JSON.stringify(r)));
        syncedRef.current = next;
      });
    }, 800);
    return () => clearTimeout(timerRef.current);
  }, [nodes]);

  // アウトラインを触っていたときの Ctrl+Z は、こちらで受ける。
  // タスク側の取り消しと取り合いにならないよう、先に捕まえて止める。
  const inOutlineRef = useRef(false);
  useEffect(() => {
    const mark = (e) => { inOutlineRef.current = !!e.target?.closest?.("[data-outliner]"); };
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !inOutlineRef.current) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (key === "y" || e.shiftKey) redo(); else undo();
    };
    window.addEventListener("pointerdown", mark, true);
    window.addEventListener("focusin", mark, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", mark, true);
      window.removeEventListener("focusin", mark, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [undo, redo]);

  const value = useMemo(() => ({
    nodes, setNodes: apply, setNodesRaw: applyRaw, view, setView,
    undo, redo, canUndo: histCount.past > 0, canRedo: histCount.future > 0,
    syncNote, dismissSync: () => setSyncNote(""),
  }), [nodes, apply, applyRaw, undo, redo, histCount, syncNote, view, setView]);
  // 「いまの木」はしまっておき、使うときに読む
  const api = useMemo(() => ({
    addMemo: (dateLabel, text) => {
      const got = addMemoUnderDate(nodesRef.current, dateLabel, text);
      apply(() => got.nodes);
      return got;
    },
  }), [apply]);

  return (
    <OutlineApiContext.Provider value={api}>
      <OutlineContext.Provider value={value}>{children}</OutlineContext.Provider>
    </OutlineApiContext.Provider>
  );
}

// 木を使わず、書き足すだけの側はこちら（描き直しに巻き込まれない）
export function useOutlineApi() {
  const ctx = React.useContext(OutlineApiContext);
  if (!ctx) throw new Error("OutlineProvider の中で使ってください");
  return ctx;
}

export function useOutline() {
  const ctx = React.useContext(OutlineContext);
  if (ctx) return ctx;
  throw new Error("OutlineProvider の中で使ってください");
}

// Quietliner と同じ見本（色の値もそのまま）
const TEXT_COLORS = [
  { label: "そのまま", value: null },
  { label: "赤", value: "#e03535" },
  { label: "橙", value: "#d97322" },
  { label: "黄", value: "#b88b0f" },
  { label: "緑", value: "#1a8c40" },
  { label: "青", value: "#2355a8" },
  { label: "紫", value: "#7b3fbf" },
  { label: "灰", value: "#767676" },
];
const BG_COLORS = [
  { label: "なし", value: null },
  { label: "赤", value: "rgba(255,80,80,0.10)" },
  { label: "橙", value: "rgba(255,160,50,0.12)" },
  { label: "黄", value: "rgba(255,220,50,0.13)" },
  { label: "緑", value: "rgba(50,200,100,0.10)" },
  { label: "青", value: "rgba(50,130,255,0.10)" },
  { label: "紫", value: "rgba(180,80,255,0.10)" },
  { label: "灰", value: "rgba(120,120,120,0.09)" },
];
// 見出しの大きさ。Quietliner の倍率に合わせてある。
const HEADING = {
  1: { fontSize: "1.55em", fontWeight: 650, lineHeight: 1.28 },
  2: { fontSize: "1.28em", fontWeight: 610, lineHeight: 1.32 },
  3: { fontSize: "1.1em", fontWeight: 560 },
};

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

function defaultOutline() {
  return [
    ensureNode({ text: "Quietliner", children: [
      { text: "Enter で次の行、Shift+Enter で行の中の改行" },
      { text: "Tab で字下げ、Shift+Tab で戻す" },
      { text: "Alt+↑↓ で行ごと入れ替え、Ctrl/⌘+Enter で完了" },
      { text: "行頭の ● を押すと、その行の中に入る（ズーム）" },
    ] }),
  ];
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTLINE_KEY) || "null");
    if (Array.isArray(raw) && raw.length) return raw.map(ensureNode);
  } catch { /* 壊れていたら作り直す */ }
  return defaultOutline();
}


// 行の文字。探しているときは当たったところに印、ふだんは #タグ を色づけ。
function Marked({ text, query }) {
  if (String(query || "").trim()) {
    const parts = splitByQuery(text, query);
    if (parts.length === 1 && !parts[0].hit) return text;
    return parts.map((p, i) => (p.hit
      ? <mark key={i} className="rounded bg-amber-300/30 px-px text-inherit">{p.text}</mark>
      : <span key={i}>{p.text}</span>));
  }
  const parts = splitTags(text);
  if (parts.length === 1 && !parts[0].tag) return text;
  return parts.map((p, i) => (p.tag
    ? <span key={i} data-tag className="text-sky-300/80">{p.text}</span>
    : <span key={i}>{p.text}</span>));
}

// アウトライン（Quietliner）。
export default function Outliner() {
  const { nodes, setNodes, undo, redo, canUndo, canRedo, syncNote, dismissSync, view, setView } = useOutline();
  const [viewOpen, setViewOpen] = useState(false);
  const [zoomId, setZoomId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]);     // まとめて選んだ行
  const [tagHint, setTagHint] = useState(null); // { id, items, at }  #タグの候補
  const [band, setBand] = useState(null);       // なぞって選ぶときの枠
  const anchorRef = useRef(null);                // Shift+クリックの起点
  const [note, setNote] = useState("");       // 持ち込みの結果を知らせる
  const searchRef = useRef(null);
  const fileRef = useRef(null);
  const listRef = useRef(null);
  // 掴んでいるあいだの様子。落ちる場所は線で見せる。
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);   // { id, top, depth }
  const INDENT = 20;
  // 編集に入ったときのカーソル位置。-1 は末尾。
  const caretRef = useRef(null);
  const menuRef = useRef(null);

  // まとめて選んでいるときのキー操作
  useEffect(() => {
    if (!picked.length) return;
    function onKey(e) {
      const inText = ["input", "textarea"].includes(document.activeElement?.tagName?.toLowerCase());
      if (e.key === "Escape") { clearPick(); return; }
      if (inText) return;
      if (e.key === "Tab") { e.preventDefault(); bulkIndent(e.shiftKey); return; }
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); bulkDelete(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); bulkComplete(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") { e.preventDefault(); bulkCopy(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // タイプライター：書いている行を、枠の決まった高さに保つ。
  // 画面ではなく「この枠」の中で合わせる（枠ごとに転がすため）。
  const keepAtAnchor = useCallback(() => {
    if (!view.typewriter || !editingId) return;
    const row = listRef.current?.querySelector(`[data-row="${editingId}"]`);
    const box = row?.closest("[data-pane-id]") || listRef.current?.parentElement;
    if (!row || !box) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const want = b.top + b.height * (view.anchor ?? 0.6);
    const delta = r.top + r.height / 2 - want;
    if (Math.abs(delta) > 2) box.scrollTop += delta;
  }, [view.typewriter, view.anchor, editingId]);

  // 行が編集欄に変わると高さが少し動くので、整ってから合わせる
  useEffect(() => {
    const id = requestAnimationFrame(keepAtAnchor);
    return () => cancelAnimationFrame(id);
  }, [keepAtAnchor, nodes]);

  // ⌘/Ctrl+K で探す欄に移る（Quietliner と同じ）
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // メニューの外を押したら閉じる
  useEffect(() => {
    if (!menuId) return;
    function onDown(e) {
      if (!menuRef.current?.contains(e.target)) setMenuId(null);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuId]);

  // 星をつけた行。押すとそこへ飛ぶ（Quietliner のサイドバーに当たるもの）
  const favorites = useMemo(() => collectFavorites(nodes), [nodes]);
  const zoomPath = useMemo(() => (zoomId ? pathTo(nodes, zoomId) : null), [nodes, zoomId]);
  const zoomNode = zoomPath?.at(-1) || null;
  const shown = zoomNode ? zoomNode.children : nodes;
  // 探しているあいだは、当たった行とその親だけを出す
  const searching = query.trim().length > 0;
  const listed = useMemo(() => (searching ? filterByQuery(shown, query) : shown), [shown, query, searching]);
  const rows = useMemo(() => visibleRows(listed), [listed]);

  const edit = useCallback((id, caret = -1) => {
    caretRef.current = caret;
    setEditingId(id);
    // いま触っている行が、まとめて選ぶときの起点になる
    anchorRef.current = id;
  }, []);

  // ズームしているときは、その子の並びだけを差し替える
  const applyShown = useCallback((makeNext) => {
    setNodes((prev) => {
      if (!zoomNode) return makeNext(prev);
      const here = pathTo(prev, zoomNode.id)?.at(-1);
      if (!here) return prev;
      return updateNode(prev, zoomNode.id, { children: makeNext(here.children) });
    });
  }, [zoomNode]);

  function patch(id, p, opts) {
    setNodes((prev) => updateNode(prev, id, p), opts);
  }

  // 連続して打っているあいだは、取り消しの1手にまとめる
  const typeText = (id, text) => patch(id, { text }, { coalesce: `text:${id}` });

  // #… を打っているあいだ、使ったことのあるタグを出す
  function refreshTagHint(id, el) {
    const at = hashtagAtCursor(el.value, el.selectionStart);
    if (!at) { setTagHint(null); return; }
    const items = tagSuggestions(allTags, at.query);
    setTagHint(items.length ? { id, items, sel: 0 } : null);
  }

  // 候補を選んだとき。打ちかけの #… を置き換えて、続きを打てるようにする。
  function takeTag(node, el, tag) {
    const got = applyTag(el.value, el.selectionStart, tag);
    typeText(node.id, got.text);
    setTagHint(null);
    requestAnimationFrame(() => {
      const live = document.querySelector(`[data-row="${node.id}"] textarea`);
      if (live) { live.focus(); live.setSelectionRange(got.caret, got.caret); }
    });
  }

  function exportJson() {
    const text = JSON.stringify(buildExport(nodes), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outline-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote("書き出しました");
  }

  // ほかのアプリの書き出しを取り込む。
  //   .json … Quietliner（行に id があるので、2回読んでも増えない）
  //   .md / .html / .zip … WorkFlowy や Notion（id が無いので、同じ文字の行に重ねる）
  async function importFile(file) {
    if (!file) return;
    setNote("読み込んでいます…");
    try {
      const name = file.name || "";
      let result = null;

      if (/\.zip$/i.test(name)) {
        const got = await parseZip(await file.arrayBuffer());
        result = { ...mergeByText(nodes, got.items), how: `zip の中の ${got.files} ファイル` };
      } else {
        const text = await file.text();
        const looksJson = /\.json$/i.test(name) || /^\s*[[{]/.test(text);
        if (looksJson) {
          result = { ...importOutline(nodes, JSON.parse(text)), how: "Quietliner の書き出し" };
        } else {
          const got = parseByFormat(name, text);
          result = {
            ...mergeByText(nodes, got.items),
            how: got.format === "workflowy-html" ? "WorkFlowy の HTML" : "箇条書きの書き出し",
          };
        }
      }

      setNodes(() => result.nodes);
      const parts = [];
      if (result.added) parts.push(`${result.added}件を足した`);
      if (result.updated) parts.push(`${result.updated}件を更新`);
      if (result.matched) parts.push(`${result.matched}件は既にあった`);
      if (result.merged) parts.push(`${result.merged}件は同じ名前の行にまとめた`);
      if (result.skipped) parts.push(`${result.skipped}件は向こうで消えていたので飛ばした`);
      setNote(`${result.how}：${parts.length ? parts.join("、") : "変わりはありませんでした"}`);
    } catch (e) {
      setNote(`読めませんでした：${e?.message || e}`);
    }
  }

  // ● を掴んで木ごと動かす。落ちる場所は、すぐ上の行と横の動きで決める。
  function startDrag(e, node) {
    if (e.button !== undefined && e.button !== 0) return;
    if (searching) return; // 探している最中は並べ替えない（見えている形が違うため）
    e.preventDefault();
    const list = listRef.current;
    if (!list) return;
    const listTop = list.getBoundingClientRect().top;
    const startDepth = rows.find((r) => r.node.id === node.id)?.depth ?? 0;
    const measured = rows.flatMap((r) => {
      const el = list.querySelector(`[data-row="${r.node.id}"]`);
      if (!el) return [];   // 描き替えの隙に消えていることがある
      const box = el.getBoundingClientRect();
      return [{ id: r.node.id, depth: r.depth, top: box.top - listTop, height: box.height }];
    });
    if (!measured.length) return;
    dragRef.current = { id: node.id, startX: e.clientX, startDepth, rows: measured, moved: false, drop: null };

    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.abs(ev.clientX - d.startX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      d.moved = true;
      const y = ev.clientY - listTop;
      let i = 0;
      while (i < d.rows.length && y > d.rows[i].top + d.rows[i].height / 2) i += 1;
      const prev = d.rows[i - 1] || null;
      const next = d.rows[i] || null;
      const maxDepth = prev ? prev.depth + 1 : 0;
      const minDepth = next ? next.depth : 0;
      const raw = d.startDepth + Math.round((ev.clientX - d.startX) / INDENT);
      const depth = Math.max(Math.min(minDepth, maxDepth), Math.min(maxDepth, Math.max(minDepth, raw)));
      d.drop = { prevId: prev?.id ?? null, depth };
      setDrag({ id: d.id, top: prev ? prev.top + prev.height : 0, depth });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d?.moved || !d.drop) return;
      applyShown((listNodes) => moveSubtreeTo(listNodes, d.id, d.drop.prevId, d.drop.depth));
      // 動かした直後のクリックで、ズームに入らないようにする
      setTimeout(() => { skipZoomRef.current = false; }, 0);
      skipZoomRef.current = true;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // 指が画面の外へ出たときにも、掴んだままにならないようにする
    window.addEventListener("pointercancel", up);
  }
  const skipZoomRef = useRef(false);

  const allTags = useMemo(() => collectAllTags(nodes), [nodes]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  function clearPick() { setPicked([]); anchorRef.current = null; }

  // Shift+クリックで、起点からここまでをまとめて選ぶ
  function pickTo(id) {
    const from = anchorRef.current || id;
    setPicked(rangeBetween(listed, from, id));
    anchorRef.current = from;
    setEditingId(null);
  }
  // Ctrl/⌘+クリックで、1行ずつ足し引きする
  function togglePick(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    anchorRef.current = id;
    setEditingId(null);
  }
  // 余白をなぞって、通った行をまとめて選ぶ。
  // 文字の上から始めたときは、ほかの行にまたいだ時点で切り替える
  //（同じ行の中では、ふつうの文字選択のままにする）。
  function startBand(e, fromId = null) {
    if (e.button !== 0) return;
    const list = listRef.current;
    if (!list) return;
    // 転がす入れ物（枠）。この中での位置で数えると、送っても選びが続く。
    const box = list.closest("[data-pane-id]") || list.parentElement;
    const boxRect = () => box.getBoundingClientRect();
    const toContentY = (clientY) => clientY - boxRect().top + box.scrollTop;

    const start = { x: e.clientX, y: e.clientY, contentY: toContentY(e.clientY) };
    let acting = !fromId;      // 余白からなら、すぐ選び始める
    if (acting) e.preventDefault();
    let last = { x: e.clientX, y: e.clientY };
    let raf = 0;

    const rowAt = (x, y) => document.elementFromPoint(x, y)?.closest("[data-row]")?.getAttribute("data-row") || null;

    // いまの枠に重なっている行を拾う。位置は「枠の中」で見るので、
    // 送って画面から出ていった行も選ばれたまま残る。
    const paint = () => {
      const r = boxRect();
      const curContentY = toContentY(last.y);
      const top = Math.min(start.contentY, curContentY);
      const bottom = Math.max(start.contentY, curContentY);

      const hit = [...list.querySelectorAll("[data-row]")].filter((el) => {
        const b = el.getBoundingClientRect();
        const elTop = b.top - r.top + box.scrollTop;
        return elTop + b.height > top && elTop < bottom;
      }).map((el) => el.getAttribute("data-row"));
      if (fromId && !hit.includes(fromId)) hit.unshift(fromId);
      setPicked(hit);

      // 枠は画面の座標で描く（枠の外にはみ出さないように切る）
      const viewTop = Math.max(r.top, top - box.scrollTop + r.top);
      const viewBottom = Math.min(r.bottom, bottom - box.scrollTop + r.top);
      setBand({
        left: Math.min(start.x, last.x),
        top: viewTop,
        width: Math.abs(last.x - start.x),
        height: Math.max(0, viewBottom - viewTop),
      });
    };

    // 端に近づいたら、枠の中を送る（押さえたまま下まで選べるように）
    const tick = () => {
      const r = boxRect();
      const edge = 48;
      let by = 0;
      if (last.y > r.bottom - edge) by = Math.min(24, (last.y - (r.bottom - edge)) / 2);
      else if (last.y < r.top + edge) by = -Math.min(24, ((r.top + edge) - last.y) / 2);
      if (by) {
        box.scrollTop += by;
        paint();
      }
      raf = requestAnimationFrame(tick);
    };

    const move = (ev) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!acting) {
        const far = Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 8;
        // 文字から始めたときは、別の行に入ったら選択に切り替える
        const over = rowAt(ev.clientX, ev.clientY);
        if (!far || !over || over === fromId) return;
        acting = true;
        window.getSelection()?.removeAllRanges();
        setEditingId(null);
        anchorRef.current = fromId;
        raf = requestAnimationFrame(tick);
      }
      ev.preventDefault();
      paint();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setBand(null);
    };
    if (acting) raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // 画面の順にそろえる（まとめて動かすときに順番が要る）
  const orderedPick = () => visibleRows(listed).map((r) => r.node.id).filter((id) => pickedSet.has(id));

  function bulkIndent(back) {
    const ids = orderedPick();
    if (!ids.length) return;
    applyShown((list) => (back ? outdentMany(list, ids) : indentMany(list, ids)));
  }
  function bulkDelete() {
    const ids = orderedPick();
    if (!ids.length) return;
    applyShown((list) => removeMany(list, ids));
    clearPick();
  }
  function bulkComplete() {
    const ids = orderedPick();
    if (!ids.length) return;
    const allDone = ids.every((id) => pathTo(listed, id)?.at(-1)?.completed);
    applyShown((list) => patchMany(list, ids, { completed: !allDone }));
  }
  async function bulkCopy() {
    const ids = orderedPick();
    if (!ids.length) return;
    try {
      await navigator.clipboard.writeText(textOf(listed, ids));
      setNote(`${ids.length}件をコピーしました`);
    } catch { setNote("コピーできませんでした"); }
  }

  // いまだけの口：中身をぜんぶ空にする。
  // ふつうの書き換えと同じ道を通すので、⌘Z で戻せるし、
  // 向こう（Supabase）の行も、このあとの保存で消える。
  const [confirmClear, setConfirmClear] = useState(false);
  function clearAll() {
    setNodes(() => [makeNode("")]);
    setZoomId(null);
    clearPick();
    setConfirmClear(false);
    setNote("ぜんぶ消しました（⌘Z で戻せます）");
  }

  function addAtEnd() {
    const made = makeNode("");
    applyShown((list) => [...list, made]);
    edit(made.id, 0);
  }

  function moveFocus(id, dir) {
    const at = rows.findIndex((r) => r.node.id === id);
    const next = rows[at + dir];
    if (next) edit(next.node.id, dir > 0 ? 0 : -1);
  }

  function onKeyDown(e, node) {
    const el = e.currentTarget;
    const value = el.value;
    const selStart = el.selectionStart;
    const selEnd = el.selectionEnd;
    const collapsed = selStart === selEnd;
    const meta = e.ctrlKey || e.metaKey;
    if (e.nativeEvent.isComposing) return; // かな漢字変換の途中は触らない

    // タグの候補が出ているあいだは、そちらを先に操る
    const hint = tagHint?.id === node.id ? tagHint : null;
    if (hint) {
      if (e.key === "ArrowDown") { e.preventDefault(); setTagHint({ ...hint, sel: Math.min(hint.sel + 1, hint.items.length - 1) }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setTagHint({ ...hint, sel: Math.max(hint.sel - 1, 0) }); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); takeTag(node, el, hint.items[hint.sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); setTagHint(null); return; }
    }

    // Ctrl/⌘+Enter で完了を切り替える
    if (meta && e.key === "Enter") {
      e.preventDefault();
      patch(node.id, { completed: !node.completed });
      return;
    }
    // Ctrl/⌘+. で畳む／開く
    if (meta && e.key === ".") {
      if (!node.children?.length) return;
      e.preventDefault();
      patch(node.id, { collapsed: !node.collapsed });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const before = value.slice(0, selStart);
      const after = value.slice(selEnd);
      const made = makeNode(after);
      applyShown((list) => insertAfter(updateNode(list, node.id, { text: before }), node.id, made));
      edit(made.id, 0);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      applyShown((list) => (e.shiftKey ? outdent(list, node.id) : indent(list, node.id)));
      edit(node.id, selStart);
      return;
    }
    // Alt+↑↓ で、兄弟のあいだを行ごと動かす
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      applyShown((list) => moveSibling(list, node.id, e.key === "ArrowUp" ? -1 : 1));
      edit(node.id, selStart);
      return;
    }
    // 探しているあいだは、見えていない行が隣にいる。くっつけると
    // 画面に無いものに文字が混ざるので、つなぎ合わせはやらない。
    if (searching && (e.key === "Backspace" || e.key === "Delete")) {
      if (e.key === "Backspace" && collapsed && selStart === 0 && value.length === 0) {
        e.preventDefault();
        const got = deleteNodeSafe(shown, node.id);
        applyShown(() => got.nodes);
        if (got.focusId) edit(got.focusId, -1);
      }
      return;
    }
    if (e.key === "Backspace" && collapsed && selStart === 0) {
      // 空の行は消す。子がいれば、その場所に繰り上げる。
      if (value.length === 0) {
        e.preventDefault();
        const got = node.children?.length
          ? deleteNodeKeepChildren(shown, node.id)
          : deleteNodeSafe(shown, node.id);
        applyShown(() => got.nodes);
        if (got.focusId) edit(got.focusId, -1);
        return;
      }
      const got = mergeIntoPrevious(shown, node.id);
      if (!got.focusId) return;
      e.preventDefault();
      applyShown(() => got.nodes);
      edit(got.focusId, got.caret);
      return;
    }
    // 行末の Delete で、次の行を引き上げる
    if (e.key === "Delete" && collapsed && selStart === value.length) {
      const got = mergeNext(shown, node.id);
      if (got.caret == null) return;
      e.preventDefault();
      applyShown(() => got.nodes);
      edit(node.id, got.caret);
      return;
    }
    // Shift+↑↓：行の端から、まとめて選ぶほうへ移る
    if (e.shiftKey && !e.altKey && !meta && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const up = e.key === "ArrowUp";
      const atEdge = up ? selStart === 0 : selEnd === value.length;
      if (!atEdge) return;
      const order = rows.map((r) => r.node.id);
      const at = order.indexOf(node.id);
      const to = order[at + (up ? -1 : 1)];
      if (!to) return;
      e.preventDefault();
      const from = anchorRef.current || node.id;
      anchorRef.current = from;
      setPicked(rangeBetween(listed, from, to));
      setEditingId(null);
      return;
    }
    if (e.key === "ArrowUp" && collapsed && selStart === 0) { e.preventDefault(); moveFocus(node.id, -1); return; }
    if (e.key === "ArrowDown" && collapsed && selEnd === value.length) { e.preventDefault(); moveFocus(node.id, 1); return; }
    if (e.key === "ArrowLeft" && collapsed && selStart === 0) { e.preventDefault(); moveFocus(node.id, -1); return; }
    if (e.key === "ArrowRight" && collapsed && selEnd === value.length) { e.preventDefault(); moveFocus(node.id, 1); return; }
    if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
  }

  // ズームの題。Enter でいちばん上の子を作り、↓ で中に降りる。
  function onTitleKeyDown(e) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const made = makeNode("");
      setNodes((prev) => insertChild(prev, zoomNode.id, made));
      edit(made.id, 0);
      return;
    }
    if (e.key === "ArrowDown" && rows[0]) { e.preventDefault(); edit(rows[0].node.id, 0); }
  }

  function textareaRef(el, node) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (el.dataset.placed === node.id) return;
    el.dataset.placed = node.id;
    const caret = caretRef.current;
    const at = caret == null || caret < 0 ? el.value.length : Math.min(caret, el.value.length);
    el.setSelectionRange(at, at);
  }

  return (
    <div data-outliner className="mx-auto w-full max-w-3xl px-1 py-2">
      <div className="mb-2 flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-600" />
          <input
            ref={searchRef}
            data-outline-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }}
            placeholder="探す（⌘K・#タグでも）"
            className="w-full rounded-md border border-white/10 bg-white/[0.03] py-1 pl-7 pr-7 text-[11px] ts-text outline-none placeholder:text-neutral-700 focus:border-white/25"
          />
          {query && (
            <button
              data-search-clear
              onClick={() => setQuery("")}
              title="やめる"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-600 hover:text-neutral-200"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="relative shrink-0">
          <button
            data-outline-view
            onClick={() => setViewOpen((v) => !v)}
            title="見た目"
            className="rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <Settings2 className="h-3 w-3" />
          </button>
          {viewOpen && (
            <div data-view-panel className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-white/15 ts-surface p-2 shadow-2xl">
              <div className="mb-1 text-[10px] text-neutral-500">字の大きさ</div>
              <div className="mb-2 flex items-center gap-1">
                <button data-font-smaller onClick={() => setView({ fontSize: Math.max(11, view.fontSize - 1) })} className="flex-1 rounded border border-white/10 py-1 text-[11px] text-neutral-300 hover:bg-white/[0.07]">−</button>
                <span data-font-size className="w-10 text-center text-[11px] tabular-nums ts-text">{view.fontSize}px</span>
                <button data-font-larger onClick={() => setView({ fontSize: Math.min(24, view.fontSize + 1) })} className="flex-1 rounded border border-white/10 py-1 text-[11px] text-neutral-300 hover:bg-white/[0.07]">＋</button>
              </div>

              <div className="mb-1 text-[10px] text-neutral-500">行揃え</div>
              <div className="mb-2 flex gap-1">
                {[["left", "左"], ["center", "中央"], ["right", "右"], ["justify", "均等"]].map(([key, label]) => (
                  <button
                    key={key}
                    data-align={key}
                    onClick={() => setView({ align: key })}
                    className={classNames(
                      "flex-1 rounded border py-1 text-[10px] transition",
                      view.align === key ? "border-white/30 bg-white/15 ts-text" : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mb-2 border-t border-white/10 pt-2">
                <div className="mb-1 text-[10px] text-neutral-500">片付け（いまだけ）</div>
                <button
                  data-outline-clear
                  onClick={() => (confirmClear ? clearAll() : setConfirmClear(true))}
                  onBlur={() => setConfirmClear(false)}
                  className={classNames(
                    "mb-1 w-full rounded border px-2 py-1.5 text-left text-[11px] transition",
                    confirmClear
                      ? "border-red-400/50 bg-red-400/15 text-red-100"
                      : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                  )}
                >
                  {confirmClear ? "もう一度押すと、ぜんぶ消す" : "アウトラインをぜんぶ消す"}
                </button>
                <div className="text-[10px] leading-relaxed text-neutral-600">
                  この端末からも Supabase からも消えます。⌘Z で戻せますが、
                  念のため先に ↓ で書き出しておくと安心です。
                </div>
              </div>

              <button
                data-typewriter
                onClick={() => setView({ typewriter: !view.typewriter })}
                className={classNames(
                  "flex w-full items-center justify-between rounded border px-2 py-1.5 text-[11px] transition",
                  view.typewriter ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                )}
              >
                <span>タイプライター</span>
                <span className="text-[10px]">{view.typewriter ? "ON" : "OFF"}</span>
              </button>
              <div className="mt-1 text-[10px] leading-relaxed text-neutral-600">
                書いている行が、いつも同じ高さに来るように送ります。
              </div>
            </div>
          )}
        </div>

        <button
          data-outline-undo
          onClick={undo}
          disabled={!canUndo}
          title="元に戻す（⌘Z）"
          className="shrink-0 rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200 disabled:opacity-25"
        >
          <Undo2 className="h-3 w-3" />
        </button>
        <button
          data-outline-redo
          onClick={redo}
          disabled={!canRedo}
          title="やり直す（⌘⇧Z）"
          className="shrink-0 rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200 disabled:opacity-25"
        >
          <Redo2 className="h-3 w-3" />
        </button>
        <button
          data-outline-import
          onClick={() => fileRef.current?.click()}
          title="取り込む（Quietliner の .json / WorkFlowy の .md・.html / Notion の .zip）。2回読んでも増えません"
          className="shrink-0 rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200"
        >
          <Upload className="h-3 w-3" />
        </button>
        <button
          data-outline-export
          onClick={exportJson}
          title="JSON に書き出す"
          className="shrink-0 rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200"
        >
          <Download className="h-3 w-3" />
        </button>
        <input
          ref={fileRef}
          data-outline-file
          type="file"
          accept=".json,.md,.markdown,.txt,.html,.htm,.zip,application/json,text/markdown,text/html,application/zip"
          className="hidden"
          onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>

      {syncNote === "too-big" && (
        <div data-outline-toobig className="mb-2 rounded border border-red-400/30 bg-red-400/[0.08] p-2 text-[10px] leading-relaxed text-red-100">
          <div className="mb-1 font-semibold">この端末に置ききれませんでした</div>
          <div>
            中身が大きすぎて、ブラウザの保管場所に入りません。閉じると戻ってしまいます。
            いらない行を消すか、書き出して分けてください。
            {!isOutlineTableMissing() && " Supabase には送っているので、そちらには残ります。"}
          </div>
        </div>
      )}

      {syncNote.startsWith("error:") && (
        <div data-outline-sync-error className="mb-2 rounded border border-red-400/30 bg-red-400/[0.08] p-2 text-[10px] leading-relaxed text-red-100">
          <div className="mb-1 font-semibold">この端末にしか残っていません</div>
          <div className="mb-1 text-red-100/80">Supabase に送れませんでした：{syncNote.slice(6)}</div>
          <div className="mb-1 text-red-100/70">
            新しい表に RLS（行レベルセキュリティ）がかかっていると、書き込みが断られます。
            タスクの表と同じ扱いにするなら、SQL Editor で次を実行してください。
          </div>
          <pre className="mb-1 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] text-red-50/90">
alter table outline_nodes disable row level security;
          </pre>
          <button onClick={dismissSync} className="rounded border border-red-300/30 px-2 py-1 text-[10px] text-red-100 transition hover:bg-red-400/15">
            閉じる
          </button>
        </div>
      )}

      {syncNote === "missing-table" && (
        <div data-outline-sql className="mb-2 rounded border border-amber-400/30 bg-amber-400/[0.08] p-2 text-[10px] leading-relaxed text-amber-100">
          <div className="mb-1 font-semibold">この端末にしか残りません</div>
          <div className="mb-1 text-amber-100/80">
            Supabase にアウトラインの置き場が無いので、ほかの端末には伝わりません。
            SQL Editor に貼って実行すると、以後は同期します。
          </div>
          <pre className="mb-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] text-amber-50/90">
{outlineTableSql()}
          </pre>
          <div className="flex gap-1.5">
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(outlineTableSql()); setNote("SQL をコピーしました"); }
                catch { setNote("コピーできませんでした。手で選んでください"); }
              }}
              className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 transition hover:bg-amber-400/15"
            >
              SQL をコピー
            </button>
            <button onClick={dismissSync} className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 transition hover:bg-amber-400/15">
              閉じる
            </button>
          </div>
        </div>
      )}

      {note && (
        <div data-outline-note className="mb-2 flex items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-neutral-400">
          <span>{note}</span>
          <button onClick={() => setNote("")} className="rounded px-1 text-neutral-600 hover:text-neutral-200">閉じる</button>
        </div>
      )}

      {searching && (
        <div data-search-count className="mb-1 px-1 text-[10px] text-neutral-500">
          {rows.length ? `${rows.length}件` : "見つかりませんでした"}
        </div>
      )}

      {favorites.length > 0 && (
        <div data-favorites className="mb-2 flex flex-wrap items-center gap-1">
          <Star className="h-3 w-3 shrink-0 fill-amber-300/70 text-amber-300/70" />
          {favorites.map((fav) => (
            <button
              key={fav.id}
              data-favorite={fav.id}
              onClick={() => { setZoomId(fav.id); setEditingId(null); clearPick(); }}
              title={fav.text}
              className="max-w-[12rem] truncate rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-neutral-400 transition hover:bg-white/[0.08] hover:text-neutral-200"
            >
              {truncateTitle(fav.text, 14)}
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-neutral-500">
        <button
          data-crumb
          onClick={() => setZoomId(null)}
          className={classNames("rounded px-1.5 py-0.5 transition hover:bg-white/[0.07]", !zoomId && "ts-text")}
        >
          ホーム
        </button>
        {(zoomPath || []).map((node, i) => (
          <React.Fragment key={node.id}>
            <span className="opacity-40">/</span>
            <button
              data-crumb
              title={node.text}
              onClick={() => setZoomId(node.id)}
              className={classNames(
                "rounded px-1.5 py-0.5 transition hover:bg-white/[0.07]",
                i === zoomPath.length - 1 && "ts-text",
              )}
            >
              {truncateTitle(node.text)}
            </button>
          </React.Fragment>
        ))}
      </div>

      {zoomNode && (
        <textarea
          key={zoomNode.id}
          data-zoom-title
          rows={1}
          value={zoomNode.text}
          onChange={(e) => typeText(zoomNode.id, e.target.value)}
          onKeyDown={onTitleKeyDown}
          placeholder="無題"
          className="mb-2 w-full resize-none bg-transparent px-1 text-xl font-semibold ts-text outline-none placeholder:text-neutral-700"
        />
      )}

      {band && (
        <div
          data-select-band
          className="pointer-events-none fixed z-[60] rounded border border-sky-400/60 bg-sky-400/10"
          style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
        />
      )}

      <div
        ref={listRef}
        data-outline-list
        onPointerDown={(e) => {
          // 行の中身（文字・つまみ・ボタン）の上は、それぞれの操作にまかせる
          if (e.target.closest("[data-row-text], button, textarea, [data-tag-hint]")) return;
          clearPick();
          startBand(e);
        }}
        style={{
          fontSize: `${view.fontSize}px`,
          textAlign: view.align,
          // 上の行も下の行も決まった高さに来られるよう、前後に余白を置く
          // （これが無いと、最初の数行は押し下げられない）
          paddingTop: view.typewriter ? "45vh" : undefined,
          paddingBottom: view.typewriter ? "45vh" : undefined,
        }}
        className="relative flex flex-col"
      >
        {drag && (
          <div
            data-drop-line
            className="pointer-events-none absolute right-0 z-20 h-[2px] rounded bg-sky-400"
            style={{ top: drag.top - 1, left: drag.depth * INDENT + 24 }}
          />
        )}
        {rows.map(({ node, depth }) => {
          const hasKids = !!node.children?.length;
          const chars = countChars(node);
          const heading = HEADING[node.headingLevel] || null;
          const textStyle = {
            ...(heading || {}),
            ...(node.textColor ? { color: node.textColor } : {}),
          };
          return (
            <div
              key={node.id}
              data-row={node.id}
              data-depth={depth}
              data-completed={node.completed ? "true" : "false"}
              data-dragging={drag?.id === node.id ? "true" : undefined}
              data-picked={pickedSet.has(node.id) ? "true" : undefined}
              data-heading={node.headingLevel || ""}
              style={{ marginLeft: depth * INDENT, background: node.bgColor || undefined }}
              className={classNames(
                "group/row relative flex items-start gap-1 rounded px-1 py-[3px] hover:bg-white/[0.03]",
                drag?.id === node.id && "opacity-40",
                pickedSet.has(node.id) && "bg-sky-400/15 ring-1 ring-sky-400/30",
              )}
            >
              <button
                data-fold={node.id}
                onClick={() => setNodes((prev) => toggleCollapse(prev, node.id))}
                title={hasKids ? (node.collapsed ? "展開" : "折りたたむ") : ""}
                disabled={!hasKids}
                className={classNames(
                  "mt-[5px] shrink-0 rounded p-px text-neutral-500 transition hover:text-neutral-200",
                  !hasKids && "invisible",
                  // 畳むつまみは、薄くても出しておく。ホバーで出すだけだと
                  // 触る機械では一生見えず、閉じられないままになる。
                  hasKids && !node.collapsed && "opacity-30 group-hover/row:opacity-100 focus:opacity-100",
                )}
              >
                {node.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>

              <button
                data-zoom={node.id}
                onPointerDown={(e) => startDrag(e, node)}
                onClick={() => {
                  if (skipZoomRef.current) return;
                  setZoomId(node.id);
                  setEditingId(null);
                }}
                title="クリックでズーム／ドラッグで移動"
                className={classNames(
                  "mt-[8px] grid h-[7px] w-[7px] shrink-0 place-items-center rounded-full transition",
                  node.collapsed ? "bg-white/70 ring-[5px] ring-white/15" : "bg-white/55 hover:ring-[5px] hover:ring-white/15",
                  hasStoredBody(node) && !node.collapsed && "ring-[3px] ring-white/10",
                )}
              >
                <span className="sr-only">ズーム</span>
              </button>

              {editingId === node.id ? (
                <textarea
                  autoFocus
                  data-outline-input
                  data-row-text
                  ref={(el) => textareaRef(el, node)}
                  rows={1}
                  value={node.text}
                  style={textStyle}
                  onChange={(e) => {
                    typeText(node.id, e.target.value);
                    refreshTagHint(node.id, e.target);
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => onKeyDown(e, node)}
                  onBlur={() => { setEditingId((cur) => (cur === node.id ? null : cur)); setTagHint(null); }}
                  className={classNames(
                    "min-w-0 flex-1 resize-none bg-transparent px-1 py-0 text-[1em] leading-relaxed ts-text outline-none",
                    node.completed && "line-through opacity-50",
                  )}
                />
              ) : (
                <div
                  data-row-text
                  onPointerDown={(e) => { if (!e.shiftKey && !e.metaKey && !e.ctrlKey) startBand(e, node.id); }}
                  onClick={(e) => {
                    // Shift / ⌘ クリックはまとめて選ぶ（Quietliner と同じ）
                    if (e.shiftKey) { e.preventDefault(); pickTo(node.id); return; }
                    if (e.metaKey || e.ctrlKey) { e.preventDefault(); togglePick(node.id); return; }
                    clearPick();
                    edit(node.id, -1);
                  }}
                  style={textStyle}
                  className={classNames(
                    "min-w-0 flex-1 cursor-text whitespace-pre-wrap break-words px-1 py-0 text-[1em] leading-relaxed",
                    node.text ? "ts-text" : "text-neutral-600",
                    node.completed && "line-through opacity-50",
                  )}
                >
                  {node.text ? <Marked text={node.text} query={query} /> : "空の行"}
                </div>
              )}

              {tagHint?.id === node.id && (
                <div
                  data-tag-hint
                  className="absolute left-10 top-full z-40 mt-0.5 w-44 overflow-hidden rounded-lg border border-white/15 ts-surface py-1 shadow-2xl"
                >
                  {tagHint.items.map((tag, i) => (
                    <button
                      key={tag}
                      data-tag-option={tag}
                      onMouseDown={(e) => { e.preventDefault(); takeTag(node, document.querySelector(`[data-row="${node.id}"] textarea`), tag); }}
                      className={classNames(
                        "block w-full px-2 py-1 text-left text-[11px] transition",
                        i === tagHint.sel ? "bg-white/15 ts-text" : "text-neutral-400 hover:bg-white/[0.07]",
                      )}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex shrink-0 items-center gap-0.5 self-start pt-0.5">
                {node.favorite && <Star className="h-3 w-3 shrink-0 fill-amber-300 text-amber-300" />}
                <span
                  data-chars
                  title="この中にある文字の数"
                  className="min-w-[1.5rem] text-right text-[10px] tabular-nums text-neutral-700 opacity-0 transition group-hover/row:opacity-100"
                >
                  {chars > 0 ? chars : ""}
                </span>
                <button
                  data-row-menu={node.id}
                  onClick={() => setMenuId((v) => (v === node.id ? null : node.id))}
                  title="この行の設定"
                  className="rounded p-0.5 text-neutral-600 opacity-0 transition hover:bg-white/10 hover:text-neutral-200 group-hover/row:opacity-100"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>

              {menuId === node.id && (
                <div
                  ref={menuRef}
                  data-row-menu-panel
                  className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-white/15 ts-surface p-1 shadow-2xl"
                >
                  <button onClick={() => { setMenuId(null); setZoomId(node.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]">⊙ ズームイン</button>
                  <button onClick={() => { setMenuId(null); patch(node.id, { completed: !node.completed }); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]">
                    <Check className="h-3 w-3" /> {node.completed ? "完了を解除" : "完了にする"}
                  </button>
                  <button onClick={() => { setMenuId(null); patch(node.id, { favorite: !node.favorite }); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]">
                    <Star className="h-3 w-3" /> {node.favorite ? "お気に入り解除" : "お気に入り"}
                  </button>
                  {hasKids && (
                    <button onClick={() => { setMenuId(null); setNodes((prev) => toggleCollapse(prev, node.id)); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]">
                      {node.collapsed ? "▶ 展開" : "▼ 折りたたむ"}
                    </button>
                  )}

                  <div className="my-1 border-t border-white/10" />
                  <div className="px-2 py-0.5 text-[10px] text-neutral-600">見出し</div>
                  <div className="flex gap-1 px-1.5 pb-1">
                    {[null, 1, 2, 3].map((level) => (
                      <button
                        key={level ?? "body"}
                        data-heading-chip={level ?? "body"}
                        onClick={() => patch(node.id, { headingLevel: level })}
                        className={classNames(
                          "flex-1 rounded border px-1 py-1 text-[10px] transition",
                          (node.headingLevel || null) === level
                            ? "border-white/30 bg-white/15 ts-text"
                            : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                        )}
                      >
                        {level === null ? "本文" : `H${level}`}
                      </button>
                    ))}
                  </div>

                  <div className="px-2 py-0.5 text-[10px] text-neutral-600">文字色</div>
                  <div className="flex flex-wrap gap-1 px-1.5 pb-1">
                    {TEXT_COLORS.map(({ label, value }) => (
                      <button
                        key={label}
                        title={label}
                        data-text-color={value || "none"}
                        onClick={() => patch(node.id, { textColor: value })}
                        style={value ? { background: value } : undefined}
                        className={classNames(
                          "h-5 w-5 rounded border text-[9px] text-neutral-400",
                          (node.textColor || null) === value ? "border-white/60" : "border-white/15",
                        )}
                      >
                        {!value && "✕"}
                      </button>
                    ))}
                  </div>

                  <div className="px-2 py-0.5 text-[10px] text-neutral-600">背景色</div>
                  <div className="flex flex-wrap gap-1 px-1.5 pb-1">
                    {BG_COLORS.map(({ label, value }) => (
                      <button
                        key={label}
                        title={label}
                        data-bg-color={value || "none"}
                        onClick={() => patch(node.id, { bgColor: value })}
                        style={value ? { background: value } : undefined}
                        className={classNames(
                          "h-5 w-5 rounded border text-[9px] text-neutral-400",
                          (node.bgColor || null) === value ? "border-white/60" : "border-white/15",
                        )}
                      >
                        {!value && "✕"}
                      </button>
                    ))}
                  </div>

                  <div className="my-1 border-t border-white/10" />
                  <button
                    data-row-delete
                    onClick={() => {
                      setMenuId(null);
                      const got = deleteNodeSafe(shown, node.id);
                      applyShown(() => got.nodes);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-red-300/80 hover:bg-red-400/10"
                  >
                    <Trash2 className="h-3 w-3" /> 削除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {picked.length > 0 && (
        <div
          data-pick-bar
          className="sticky bottom-2 z-30 mt-2 flex flex-wrap items-center gap-1 rounded-xl border border-white/15 ts-surface px-2 py-1.5 shadow-2xl"
        >
          <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-100">
            {picked.length}件
          </span>
          <button data-pick-outdent onClick={() => bulkIndent(true)} title="字下げを戻す（Shift+Tab）" className="rounded px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/[0.07]">←</button>
          <button data-pick-indent onClick={() => bulkIndent(false)} title="字下げ（Tab）" className="rounded px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/[0.07]">→</button>
          <button data-pick-complete onClick={bulkComplete} title="完了（⌘Enter）" className="rounded px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/[0.07]">完了</button>
          <button data-pick-copy onClick={bulkCopy} title="コピー（⌘C）" className="rounded px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/[0.07]">コピー</button>
          <button data-pick-delete onClick={bulkDelete} title="削除" className="rounded px-2 py-1 text-[11px] text-red-300/80 transition hover:bg-red-400/10">削除</button>
          <button data-pick-clear onClick={clearPick} title="選ぶのをやめる（Esc）" className="ml-auto rounded px-2 py-1 text-[11px] text-neutral-500 transition hover:bg-white/[0.07]">✕</button>
        </div>
      )}

      <button
        data-outline-add
        onClick={addAtEnd}
        className="mt-1 w-full rounded px-2 py-2 text-left text-[12px] text-neutral-600 transition hover:bg-white/[0.03] hover:text-neutral-400"
      >
        クリックして書き足す
      </button>
    </div>
  );
}
