import { useState } from "react";
import { X, Check, LoaderCircle } from "lucide-react";
import SketchPad from "./SketchPad";

// 文字入力を置かず、開いた直後からペンで紙に触れられる専用の入口。
export default function SketchBoard({ strokes, onChange, onClose, onSave, saving, message }) {
  const [toolbarTarget, setToolbarTarget] = useState(null);
  return <section data-sketch-board className="flex h-dvh w-full min-w-0 flex-col overflow-hidden ts-surface">
    <header data-sketch-header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 py-2">
      <h2 className="hidden shrink-0 text-sm font-semibold ts-text sm:block">sketch</h2>
      <div ref={setToolbarTarget} data-sketch-toolbar-slot className="min-w-0 flex-1 overflow-x-auto" />
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" data-sketch-save disabled={saving || !strokes.length} onClick={onSave} className="flex min-h-11 items-center gap-2 rounded-lg border border-accent-400/40 bg-accent-500/15 px-4 text-xs font-medium text-accent-200 transition hover:bg-accent-500/25 disabled:opacity-30">
          {saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />} {saving ? "保存中…" : "add memo"}
        </button>
        <button autoFocus type="button" data-sketch-close aria-label="閉じる" title="下書きを残して閉じる" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 text-neutral-400 hover:bg-white/10"><X aria-hidden="true" className="h-4 w-4" /></button>
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
      <SketchPad standalone strokes={strokes} onChange={onChange} disabled={saving} toolbarTarget={toolbarTarget} />
    </div>
    {message && <div data-sketch-status role="status" className="shrink-0 border-t border-white/10 px-4 py-2 text-[11px] text-neutral-400">{message}</div>}
  </section>;
}
