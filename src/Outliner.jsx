import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  makeNode, ensureNode, pathTo, visibleRows,
  insertAfter, indent, outdent, toggleCollapse, mergeIntoPrevious, updateNode,
} from "./lib/outline";

const OUTLINE_KEY = "taskspace-outline-v1";

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

function defaultOutline() {
  return [
    ensureNode({ text: "Quietliner", children: [
      { text: "Enter で次の行、Shift+Enter で行の中の改行" },
      { text: "Tab で字下げ、Shift+Tab で戻す" },
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

// アウトライン。Quietliner の操作感を、まずこの範囲で。
export default function Outliner() {
  const [nodes, setNodes] = useState(load);
  const [zoomId, setZoomId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  // 編集に入った直後に、カーソルをどこへ置くか
  const caretRef = useRef(null);
  const areaRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(OUTLINE_KEY, JSON.stringify(nodes)); } catch { /* 入らなくても動く */ }
  }, [nodes]);

  // ズームしている行の中だけを出す
  const zoomPath = useMemo(() => (zoomId ? pathTo(nodes, zoomId) : null), [nodes, zoomId]);
  // ズーム先が消えていたら、ホームとして描く（戻すのは描画の外で）
  const zoomNode = zoomPath?.at(-1) || null;
  const shown = zoomNode ? zoomNode.children : nodes;
  const rows = useMemo(() => visibleRows(shown), [shown]);

  const edit = useCallback((id, caret = null) => {
    caretRef.current = caret;
    setEditingId(id);
  }, []);

  function addAtEnd() {
    const made = makeNode("");
    setNodes((prev) => {
      if (!zoomNode) return [...prev, made];
      return updateNode(prev, zoomNode.id, { children: [...zoomNode.children, made] });
    });
    edit(made.id, 0);
  }

  // 上下の行へ移る
  function moveFocus(id, dir) {
    const at = rows.findIndex((r) => r.node.id === id);
    const next = rows[at + dir];
    if (next) edit(next.node.id, dir > 0 ? 0 : next.node.text.length);
  }

  function onKeyDown(e, node) {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // カーソルのところで割る。後ろ半分は新しい行へ。
      const before = el.value.slice(0, el.selectionStart);
      const after = el.value.slice(el.selectionEnd);
      const made = { ...makeNode(after) };
      setNodes((prev) => insertAfter(updateNode(prev, node.id, { text: before }), node.id, made));
      edit(made.id, 0);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const caret = el.selectionStart;
      setNodes((prev) => (e.shiftKey ? outdent(prev, node.id) : indent(prev, node.id)));
      edit(node.id, caret);
      return;
    }
    if (e.key === "Backspace" && atStart && el.selectionStart === el.selectionEnd) {
      const got = mergeIntoPrevious(zoomNode ? shown : nodes, node.id);
      if (!got.focusId) return; // いちばん上、または子を持っている行
      e.preventDefault();
      setNodes((prev) => {
        if (!zoomNode) return got.nodes;
        return updateNode(prev, zoomNode.id, { children: got.nodes });
      });
      edit(got.focusId, got.caret);
      return;
    }
    if (e.key === "ArrowUp" && atStart) { e.preventDefault(); moveFocus(node.id, -1); return; }
    if (e.key === "ArrowDown" && atEnd) { e.preventDefault(); moveFocus(node.id, 1); return; }
    if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
  }

  function setText(id, text) {
    setNodes((prev) => updateNode(prev, id, { text }));
  }

  return (
    <div data-outliner className="mx-auto w-full max-w-3xl px-1 py-2">
      {/* いまどこにいるか。押すとその高さまで戻る。 */}
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
              onClick={() => setZoomId(node.id)}
              className={classNames(
                "max-w-[12rem] truncate rounded px-1.5 py-0.5 transition hover:bg-white/[0.07]",
                i === zoomPath.length - 1 && "ts-text",
              )}
            >
              {node.text || "（無題）"}
            </button>
          </React.Fragment>
        ))}
      </div>

      {zoomNode && (
        <h2 data-zoom-title className="mb-2 px-1 text-xl font-semibold ts-text">
          {zoomNode.text || "（無題）"}
        </h2>
      )}

      <div className="flex flex-col">
        {rows.map(({ node, depth }) => {
          const hasKids = !!node.children?.length;
          return (
            <div
              key={node.id}
              data-row={node.id}
              data-depth={depth}
              className="group/row flex items-start gap-1 rounded px-1 py-[3px] hover:bg-white/[0.03]"
              style={{ marginLeft: depth * 18 }}
            >
              <button
                data-fold={node.id}
                onClick={() => setNodes((prev) => toggleCollapse(prev, node.id))}
                title={hasKids ? (node.collapsed ? "開く" : "畳む") : ""}
                className={classNames(
                  "mt-[3px] shrink-0 rounded p-px text-neutral-500 transition hover:text-neutral-200",
                  !hasKids && "invisible",
                )}
              >
                {node.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>

              <button
                data-zoom={node.id}
                onClick={() => { setZoomId(node.id); setEditingId(null); }}
                title="この中に入る"
                className={classNames(
                  "mt-[7px] grid h-3 w-3 shrink-0 place-items-center rounded-full transition",
                  node.collapsed ? "bg-white/25 ring-4 ring-white/10" : "bg-white/40 hover:ring-4 hover:ring-white/10",
                )}
              >
                <span className="sr-only">ズーム</span>
              </button>

              {editingId === node.id ? (
                <textarea
                  autoFocus
                  data-outline-input
                  data-row-text
                  ref={(el) => {
                    if (!el || areaRef.current === el) return;
                    areaRef.current = el;
                    const caret = caretRef.current;
                    if (caret != null) el.setSelectionRange(caret, caret);
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  rows={1}
                  value={node.text}
                  onChange={(e) => {
                    setText(node.id, e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => onKeyDown(e, node)}
                  onBlur={() => setEditingId((cur) => (cur === node.id ? null : cur))}
                  className="min-w-0 flex-1 resize-none bg-transparent px-1 py-0 text-[14px] leading-relaxed ts-text outline-none"
                />
              ) : (
                <div
                  data-row-text
                  onClick={() => edit(node.id, node.text.length)}
                  className={classNames(
                    "min-w-0 flex-1 cursor-text whitespace-pre-wrap break-words px-1 text-[14px] leading-relaxed",
                    node.text ? "ts-text" : "text-neutral-600",
                    node.completed && "line-through opacity-50",
                  )}
                >
                  {node.text || "空の行"}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
