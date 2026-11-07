import { useEffect, useRef, useState } from "react";
import { paintSketch, SKETCH_WIDTH, SKETCH_HEIGHT } from "./lib/sketch";

const COLORS = [{ name: "黒", color: "#202020" }, { name: "青", color: "#2563eb" }, { name: "赤", color: "#dc2626" }, { name: "緑", color: "#15803d" }];

export default function SketchPad({ strokes, onChange, disabled }) {
  const canvasRef = useRef(null), drawingRef = useRef(null);
  const [color, setColor] = useState(COLORS[0].color);
  const [width, setWidth] = useState(3);
  const [cleared, setCleared] = useState(null);
  useEffect(() => { paintSketch(canvasRef.current, strokes); }, [strokes]);
  function point(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height].map((n) => Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000);
  }
  function finish(event) {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
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
    <canvas ref={canvasRef} data-sketch-canvas aria-label="指やペンで描く手書き欄" width={SKETCH_WIDTH * 2} height={SKETCH_HEIGHT * 2} className="block w-full rounded-lg border border-white/20" style={{ touchAction: "none", aspectRatio: "5 / 3" }}
      onPointerDown={(event) => {
        if (disabled || drawingRef.current || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const stroke = { color, width, points: [point(event)] };
        drawingRef.current = { pointerId: event.pointerId, stroke };
        paintSketch(canvasRef.current, [...strokes, stroke]);
      }}
      onPointerMove={(event) => {
        const drawing = drawingRef.current;
        if (!drawing || drawing.pointerId !== event.pointerId) return;
        event.preventDefault();
        drawing.stroke.points.push(point(event));
        paintSketch(canvasRef.current, [...strokes, drawing.stroke]);
      }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    />
    <div className="mt-1 text-[11px] text-neutral-500">手書きは画像としてメモに追加されます</div>
  </div>;
}
