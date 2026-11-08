import { useEffect, useMemo, useRef, useState } from "react";
import { paintSketch, appendSketch, SKETCH_WIDTH, SKETCH_HEIGHT } from "./lib/sketch";

const COLORS = [{ name: "黒", color: "#202020" }, { name: "青", color: "#2563eb" }, { name: "赤", color: "#dc2626" }, { name: "緑", color: "#15803d" }];
const HEIGHT_KEY = "taskspace-sketch-ratio";
function savedRatio() {
  try { const value = Number(localStorage.getItem(HEIGHT_KEY)); return value >= 0.35 && value <= 2 ? value : SKETCH_HEIGHT / SKETCH_WIDTH; } catch { return SKETCH_HEIGHT / SKETCH_WIDTH; }
}
function preference(key) {
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}

export default function SketchPad({ strokes, onChange, disabled }) {
  const canvasRef = useRef(null), drawingRef = useRef(null);
  const resizeRef = useRef(null);
  const [ratio, setRatio] = useState(() => strokes.reduce((maximum, stroke) => Math.max(maximum, (stroke.height || SKETCH_HEIGHT) / SKETCH_WIDTH), savedRatio()));
  const minRatio = useMemo(() => strokes.reduce((maximum, stroke) => stroke.points.reduce((height, point) => Math.max(height, point[1] * (stroke.height || SKETCH_HEIGHT) / SKETCH_WIDTH + 0.02), maximum), 0.35), [strokes]);
  const pixelHeight = Math.round(SKETCH_WIDTH * 2 * ratio);
  const [color, setColor] = useState(COLORS[0].color);
  const [width, setWidth] = useState(3);
  const [cleared, setCleared] = useState(null);
  const [penOnly, setPenOnly] = useState(() => preference("taskspace-sketch-pen-only"));
  const [pressure, setPressure] = useState(() => preference("taskspace-sketch-pressure"));
  useEffect(() => { paintSketch(canvasRef.current, strokes); }, [strokes, pixelHeight]);
  function finishResize(event) {
    const resize = resizeRef.current;
    if (!resize || resize.id !== event.pointerId) return;
    resizeRef.current = null;
    try { localStorage.setItem(HEIGHT_KEY, String(resize.next ?? resize.ratio)); } catch { /* この画面では広げられる */ }
  }
  function point(event, rect, withPressure, final = false) {
    const p = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height].map((n) => Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000);
    // ペンを離すイベントの0は筆圧ではないので、線の端を急に細くしない。
    if (withPressure) p.push(final ? drawingRef.current.stroke.points.at(-1)[2] : Math.max(0, Math.min(1, Number.isFinite(event.pressure) ? event.pressure : 0.5)));
    return p;
  }
  function addPoints(event, final = false) {
    const drawing = drawingRef.current;
    const stroke = drawing.stroke, from = stroke.points.length;
    const rect = canvasRef.current.getBoundingClientRect();
    const native = event.nativeEvent || event;
    let samples = [];
    if (drawing.pen && !final) {
      try { samples = native.getCoalescedEvents?.() || []; } catch { /* 未対応なら通常の座標を使う */ }
    }
    for (const sample of [...samples, native]) {
      const p = point(sample, rect, stroke.pressure, final), last = stroke.points.at(-1);
      if (p[0] !== last[0] || p[1] !== last[1]) stroke.points.push(p);
    }
    appendSketch(canvasRef.current, stroke, from);
  }
  function finish(event) {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") addPoints(event, true);
    drawingRef.current = null;
    onChange([...strokes, drawing.stroke]);
    setCleared(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div data-sketch-pad className="mt-2">
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {COLORS.map((item) => <button key={item.color} type="button" aria-label={`ペンの色：${item.name}`} aria-pressed={color === item.color} disabled={disabled} onClick={() => setColor(item.color)} className="flex h-9 w-9 items-center justify-center rounded border border-white/15 aria-pressed:ring-1 aria-pressed:ring-white/70"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: item.color }} /></button>)}
      <select aria-label="ペンの太さ" value={width} disabled={disabled} onChange={(event) => setWidth(Number(event.target.value))} className="h-9 rounded border border-white/15 ts-surface px-2 text-xs"><option value={3}>細め</option><option value={6}>太め</option></select>
      <button type="button" data-sketch-undo disabled={disabled || (!strokes.length && !cleared)} onClick={() => { onChange(strokes.length ? strokes.slice(0, -1) : cleared); setCleared(null); }} className="rounded border border-white/15 px-2 py-2 text-xs text-neutral-300 disabled:opacity-30">戻す</button>
      <button type="button" data-sketch-clear disabled={disabled || !strokes.length} onClick={() => { setCleared(strokes); onChange([]); }} className="rounded border border-white/15 px-2 py-2 text-xs text-neutral-400 disabled:opacity-30">全消去</button>
    </div>
    <div className="mb-2 flex flex-wrap gap-3 text-xs text-neutral-300">
      <label className="flex min-h-9 items-center gap-2"><input data-sketch-pen-only type="checkbox" checked={penOnly} disabled={disabled} onChange={(event) => { setPenOnly(event.target.checked); try { localStorage.setItem("taskspace-sketch-pen-only", String(event.target.checked)); } catch { /* この画面では使える */ } }} />ペン専用</label>
      <label className="flex min-h-9 items-center gap-2"><input data-sketch-pressure type="checkbox" checked={pressure} disabled={disabled} onChange={(event) => { setPressure(event.target.checked); try { localStorage.setItem("taskspace-sketch-pressure", String(event.target.checked)); } catch { /* この画面では使える */ } }} />筆圧を使う</label>
    </div>
    <canvas ref={canvasRef} data-sketch-canvas aria-label="指やペンで描く手書き欄" width={SKETCH_WIDTH * 2} height={pixelHeight} className="block w-full rounded-lg border border-white/20" style={{ touchAction: "none", aspectRatio: `${SKETCH_WIDTH * 2} / ${pixelHeight}` }}
      onPointerDown={(event) => {
        if (disabled || drawingRef.current || resizeRef.current || !event.isPrimary || event.button !== 0 || (penOnly && event.pointerType !== "pen")) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const pen = event.pointerType === "pen";
        const stroke = { color, width, height: pixelHeight / 2, pressure: pen && pressure, points: [point(event, event.currentTarget.getBoundingClientRect(), pen && pressure)] };
        drawingRef.current = { pointerId: event.pointerId, stroke, pen };
        appendSketch(canvasRef.current, stroke);
      }}
      onPointerMove={(event) => {
        const drawing = drawingRef.current;
        if (!drawing || drawing.pointerId !== event.pointerId) return;
        event.preventDefault();
        addPoints(event);
      }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    />
    <div data-sketch-resize role="separator" aria-label="手書き欄の高さ" aria-orientation="horizontal" aria-valuemin={35} aria-valuemax={200} aria-valuenow={Math.round(ratio * 100)} tabIndex={disabled ? -1 : 0}
      className="mx-auto flex h-7 w-24 cursor-ns-resize touch-none items-center justify-center rounded focus-visible:outline focus-visible:outline-accent-400"
      onPointerDown={(event) => {
        if (disabled || drawingRef.current || !event.isPrimary || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = { id: event.pointerId, y: event.clientY, ratio, width: canvasRef.current.getBoundingClientRect().width };
      }}
      onPointerMove={(event) => {
        const start = resizeRef.current;
        if (!start || start.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const next = Math.min(2, Math.max(minRatio, start.ratio + (event.clientY - start.y) / start.width));
        start.next = next;
        setRatio(next);
      }}
      onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize}
      onKeyDown={(event) => {
        if (disabled || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const next = Math.min(2, Math.max(minRatio, ratio + (event.key === "ArrowDown" ? 0.1 : -0.1)));
        setRatio(next); try { localStorage.setItem(HEIGHT_KEY, String(next)); } catch { /* この画面では広げられる */ }
      }}
    ><span className="h-1 w-10 rounded-full bg-white/20" /></div>
    <div className="mt-1 text-[11px] text-neutral-500">手書きは画像としてメモに追加されます</div>
  </div>;
}
