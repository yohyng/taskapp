import { useState } from "react";
import { X, Check, LoaderCircle } from "lucide-react";
import SketchPad from "./SketchPad";

// 文字入力を置かず、開いた直後からペンで紙に触れられる専用の入口。
export default function SketchBoard({ strokes, onChange, onClose, onSave, saving, message }) {
  const [paperSize, setPaperSize] = useState(null);
  return <section data-sketch-board className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/20 ts-surface shadow-2xl"
    style={{ maxWidth: paperSize ? `calc(56rem + ${Math.max(0, paperSize.width - 600) * paperSize.scale}px)` : undefined }}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <h2 className="text-sm font-semibold ts-text">sketch</h2>
      <div className="flex items-center gap-2">
        <button type="button" data-sketch-save disabled={saving || !strokes.length} onClick={onSave} className="flex min-h-11 items-center gap-2 rounded-lg border border-accent-400/40 bg-accent-500/15 px-4 text-xs font-medium text-accent-200 transition hover:bg-accent-500/25 disabled:opacity-30">
          {saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />} {saving ? "保存中…" : "add memo"}
        </button>
        <button autoFocus type="button" data-sketch-close aria-label="閉じる" title="下書きを残して閉じる" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 text-neutral-400 hover:bg-white/10"><X aria-hidden="true" className="h-4 w-4" /></button>
      </div>
    </header>
    <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
      <SketchPad standalone strokes={strokes} onChange={onChange} disabled={saving} onPaperSize={setPaperSize} />
    </div>
    <footer className="shrink-0 border-t border-white/10 px-4 py-2 text-[11px] text-neutral-500">
      {message ? <div data-sketch-status role="status">{message}</div> : "閉じても下書きは残ります。add memoでアウトラインへ追加。"}
    </footer>
  </section>;
}
