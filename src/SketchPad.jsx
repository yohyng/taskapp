import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { paintSketch, appendSketch, SKETCH_WIDTH, SKETCH_HEIGHT, expandSketchPaper, fitSketchToPaper } from "./lib/sketch";

import { Hand } from "lucide-react";
import { createLiveSketch } from "./lib/live-sketch";

const COLORS = [{ name: "黒", color: "#202020" }, { name: "青", color: "#2563eb" }, { name: "赤", color: "#dc2626" }, { name: "緑", color: "#15803d" }];
const HEIGHT_KEY = "taskspace-sketch-ratio";
function savedRatio() {
  try { const value = Number(localStorage.getItem(HEIGHT_KEY)); return value >= 0.35 && value <= 2 ? value : SKETCH_HEIGHT / SKETCH_WIDTH; } catch { return SKETCH_HEIGHT / SKETCH_WIDTH; }
}
function preference(key) {
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}

function sketchPoint(event, rect, withPressure, finalPressure) {
  const p = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height].map(n => Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000);
  if (withPressure) p.push(finalPressure ?? Math.max(0, Math.min(1, Number.isFinite(event.pressure) ? event.pressure : 0.5)));
  return p;
}

export default function SketchPad({ strokes, onChange, disabled }) {
  const canvasRef = useRef(null), drawingRef = useRef(null), liveRef = useRef(null);
  const [brush, setBrush] = useState("speed-extreme-v1");
  const resizeRef = useRef(null), panRef = useRef(null);
  const [panMode, setPanMode] = useState(false);
  const [paper, setPaper] = useState(() => {
    let saved;
    try { saved = JSON.parse(localStorage.getItem("taskspace-sketch-paper-v1")); } catch { /* 古い高さ設定を引き継ぐ */ }
    return { width: Math.max(600, ...strokes.map(stroke => stroke.paperWidth || 600), Number.isFinite(saved?.width) ? Math.min(1200, Math.max(600, saved.width)) : 600),
      height: Math.max(210, ...strokes.map(stroke => stroke.height || 360), Number.isFinite(saved?.height) ? Math.min(1200, Math.max(210, saved.height)) : Math.round(savedRatio() * 600)) };
  });
  const shownStrokes = useMemo(() => fitSketchToPaper(strokes, paper), [strokes, paper]);
  const pixelHeight = paper.height * 2;
  const [color, setColor] = useState(COLORS[0].color);
  const [width, setWidth] = useState(10);
  const [cleared, setCleared] = useState(null);
  const [penOnly, setPenOnly] = useState(() => preference("taskspace-sketch-pen-only"));
  const [pressure, setPressure] = useState(() => preference("taskspace-sketch-pressure"));
  useLayoutEffect(() => { paintSketch(canvasRef.current, shownStrokes, paper.width); }, [shownStrokes, paper.width, pixelHeight]);
  useEffect(() => () => { liveRef.current?.dispose(); liveRef.current = null; }, []);
  function finishResize(event) {
    const resize = resizeRef.current;
    if (!resize || resize.id !== event.pointerId) return;
    const next = resize.next || resize.paper;
    resizeRef.current = null;
    if (next.width !== resize.paper.width || next.height !== resize.paper.height) onChange(fitSketchToPaper(strokes, next));
    setPaper({ width: next.width, height: next.height });
    try { localStorage.setItem("taskspace-sketch-paper-v1", JSON.stringify({ width: next.width, height: next.height })); localStorage.setItem(HEIGHT_KEY, String(next.height / 600)); } catch { /* 紙はこの画面では広げられる */ }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const addPoints = useCallback((event, final = false) => {
    const drawing = drawingRef.current;
    const stroke = drawing.stroke, from = stroke.points.length;
    const rect = drawing.rect;
    const native = event.nativeEvent || event;
    let samples = [];
    if (drawing.pen && !final) {
      try { samples = native.getCoalescedEvents?.() || []; } catch { /* 未対応なら通常の座標を使う */ }
    }
    for (const sample of [...samples, native]) {
      const p = sketchPoint(sample, rect, stroke.pressure, final ? stroke.points.at(-1)[2] : undefined), last = stroke.points.at(-1);
      if (p[0] !== last[0] || p[1] !== last[1]) {
        stroke.points.push(p);
        if (stroke.times) stroke.times.push(Math.max(stroke.times.at(-1), sample.timeStamp - drawing.started));
      }
    }
    if (stroke.brush) liveRef.current.update();
    else appendSketch(canvasRef.current, stroke, from, true, stroke.paperWidth);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    const move = (event) => {
      const pan = panRef.current;
      if (pan && pan.id === event.pointerId) {
        event.preventDefault(); event.stopPropagation();
        pan.viewport.scrollLeft = pan.left + pan.x - event.clientX;
        pan.viewport.scrollTop = pan.top + pan.y - event.clientY;
        return;
      }
      if (!drawingRef.current || drawingRef.current.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation(); addPoints(event);
    };
    // Safariの長押し選択と、背面へ届く互換タッチイベントを紙の中だけ止める。
    const block = event => { event.preventDefault(); event.stopPropagation(); };
    canvas.addEventListener("pointermove", move, { passive: false });
    for (const type of ["selectstart", "contextmenu", "touchstart", "touchmove"]) canvas.addEventListener(type, block, { passive: false });
    return () => {
      canvas.removeEventListener("pointermove", move);
      for (const type of ["selectstart", "contextmenu", "touchstart", "touchmove"]) canvas.removeEventListener(type, block);
    };
  }, [addPoints]);
  function finish(event) {
    if (panRef.current?.id === event.pointerId) {
      panRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") addPoints(event, true);
    drawingRef.current = null;
    if (drawing.stroke.brush) liveRef.current.finish();
    onChange([...strokes, drawing.stroke]);
    setCleared(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div data-sketch-pad className="mt-2" style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {COLORS.map((item) => <button key={item.color} type="button" aria-label={`ペンの色：${item.name}`} aria-pressed={color === item.color} disabled={disabled} onClick={() => setColor(item.color)} className="flex h-9 w-9 items-center justify-center rounded border border-white/15 aria-pressed:ring-1 aria-pressed:ring-white/70"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: item.color }} /></button>)}
      <select data-sketch-brush aria-label="ペンの種類" value={brush} disabled={disabled} onChange={(event) => setBrush(event.target.value)} className="h-9 rounded border border-white/15 ts-surface px-2 text-xs"><option value="speed-extreme-v1">速度ペン・強弱最大</option><option value="legacy">従来のペン</option></select>
      <label className="flex items-center gap-2 text-xs">太さ <input data-sketch-width aria-label="ペンの太さ" type="range" min="1" max="20" step="0.5" value={width} disabled={disabled} onChange={event => setWidth(Number(event.target.value))} className="w-24" /><output>{width}</output></label>
      <button type="button" data-sketch-pan aria-label="紙を移動" title="紙を移動：オンの間は指やマウスで紙をドラッグできます" aria-pressed={panMode} disabled={disabled} onClick={() => setPanMode(value => !value)} className="flex h-9 w-9 items-center justify-center rounded border border-white/15 aria-pressed:bg-accent-400/20 aria-pressed:text-accent-200"><Hand aria-hidden="true" className="h-4 w-4" /></button>
      <button type="button" data-sketch-undo disabled={disabled || (!strokes.length && !cleared)} onClick={() => { onChange(strokes.length ? strokes.slice(0, -1) : cleared); setCleared(null); }} className="rounded border border-white/15 px-2 py-2 text-xs text-neutral-300 disabled:opacity-30">戻す</button>
      <button type="button" data-sketch-clear disabled={disabled || !strokes.length} onClick={() => { setCleared(strokes); onChange([]); }} className="rounded border border-white/15 px-2 py-2 text-xs text-neutral-400 disabled:opacity-30">全消去</button>
    </div>
    <div className="mb-2 flex flex-wrap gap-3 text-xs text-neutral-300">
      <label className="flex min-h-9 items-center gap-2"><input data-sketch-pen-only type="checkbox" checked={penOnly} disabled={disabled} onChange={(event) => { setPenOnly(event.target.checked); try { localStorage.setItem("taskspace-sketch-pen-only", String(event.target.checked)); } catch { /* この画面では使える */ } }} />ペン専用（手の接触を無視）</label>
      <label className="flex min-h-9 items-center gap-2" style={{ display: brush === "legacy" ? undefined : "none" }}><input data-sketch-pressure type="checkbox" checked={pressure} disabled={disabled} onChange={(event) => { setPressure(event.target.checked); try { localStorage.setItem("taskspace-sketch-pressure", String(event.target.checked)); } catch { /* この画面では使える */ } }} />筆圧を使う</label>
    </div>
    <div className="mb-1 text-[11px] text-neutral-500">ペンを使うとペン専用がオンになります。紙の端を引くと余白が増え、手のアイコンで紙を移動できます。</div>
    <div data-sketch-viewport className="max-h-[60dvh] overflow-auto overscroll-contain rounded-lg border border-white/15">
    <div className="relative p-4" style={{ width: `calc((100% - 32px) * ${paper.width / 600} + 32px)`, contain: "layout paint" }}>
    <canvas ref={canvasRef} data-sketch-canvas aria-label="指やペンで描く手書き欄" width={paper.width * 2} height={pixelHeight} className="block w-full rounded-lg border border-white/20" style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", cursor: panMode ? "grab" : undefined, aspectRatio: `${paper.width * 2} / ${pixelHeight}` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!disabled && !drawingRef.current && !resizeRef.current && !panRef.current && panMode && event.pointerType !== "pen" && event.isPrimary && event.button === 0) {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          const viewport = event.currentTarget.closest("[data-sketch-viewport]");
          panRef.current = { id: event.pointerId, viewport, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
          return;
        }
        // 手が先に触れても、ペンが来たら未確定の接触を捨てて描き始める。
        if (!disabled && event.pointerType === "pen" && drawingRef.current && !drawingRef.current.pen) {
          drawingRef.current = null; liveRef.current?.dispose(); liveRef.current = null;
          paintSketch(canvasRef.current, shownStrokes, paper.width);
        }
        if (disabled || drawingRef.current || resizeRef.current || panRef.current || !event.isPrimary || event.button !== 0 || (penOnly && event.pointerType !== "pen")) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const pen = event.pointerType === "pen";
        if (pen && !penOnly) {
          setPenOnly(true);
          try { localStorage.setItem("taskspace-sketch-pen-only", "true"); } catch { /* 次の手の接触はこの画面で止める */ }
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const stroke = { color, width, height: paper.height, paperWidth: paper.width, pressure: brush === "legacy" && pen && pressure, ...(brush === "speed-extreme-v1" ? { brush, times: [0] } : {}), points: [sketchPoint(event, rect, brush === "legacy" && pen && pressure)] };
        drawingRef.current = { pointerId: event.pointerId, stroke, pen, started: event.timeStamp, rect };
        if (stroke.brush) {
          if (!liveRef.current) liveRef.current = createLiveSketch(canvasRef.current);
          liveRef.current.begin(stroke);
        } else appendSketch(canvasRef.current, stroke, 0, true, paper.width);
      }}
      onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onMouseMove={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}
      onPointerUp={event => { event.stopPropagation(); finish(event); }} onPointerCancel={event => { event.stopPropagation(); finish(event); }} onLostPointerCapture={finish}
    />
    {[["top", "上", "absolute left-1/2 top-0 h-4 w-20 -translate-x-1/2 cursor-ns-resize"], ["bottom", "下", "absolute bottom-0 left-1/2 h-4 w-20 -translate-x-1/2 cursor-ns-resize"], ["left", "左", "absolute left-0 top-1/2 h-20 w-4 -translate-y-1/2 cursor-ew-resize"], ["right", "右", "absolute right-0 top-1/2 h-20 w-4 -translate-y-1/2 cursor-ew-resize"]].map(([edge, name, classes]) => <div key={edge}
      data-sketch-edge={edge} data-sketch-resize={edge === "bottom" ? "" : undefined} role="separator" aria-label={`紙を${name}へ広げる`} aria-valuemin={edge === "left" || edge === "right" ? 600 : 210} aria-valuemax={1200} aria-valuenow={edge === "left" || edge === "right" ? paper.width : paper.height} aria-orientation={edge === "left" || edge === "right" ? "vertical" : "horizontal"} tabIndex={disabled ? -1 : 0}
      className={`${classes} flex touch-none items-center justify-center rounded focus-visible:outline focus-visible:outline-accent-400`}
      onPointerDown={event => {
        event.preventDefault(); event.stopPropagation();
        if (disabled || drawingRef.current || resizeRef.current || panRef.current || !event.isPrimary || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = { id: event.pointerId, edge, x: event.clientX, y: event.clientY, paper, scale: canvasRef.current.getBoundingClientRect().width / paper.width };
      }}
      onPointerMove={event => {
        const start = resizeRef.current;
        if (!start || start.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const horizontal = edge === "left" || edge === "right";
        const distance = ((horizontal ? event.clientX - start.x : event.clientY - start.y) * (edge === "left" || edge === "top" ? -1 : 1)) / start.scale;
        start.next = expandSketchPaper(start.paper, edge, distance);
        setPaper(start.next);
      }}
      onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize}
      onKeyDown={event => {
        const key = { top: "ArrowUp", bottom: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[edge];
        if (disabled || drawingRef.current || event.key !== key) return;
        event.preventDefault(); event.stopPropagation();
        const next = expandSketchPaper(paper, edge, 30);
        onChange(fitSketchToPaper(strokes, next)); setPaper({ width: next.width, height: next.height });
        try { localStorage.setItem("taskspace-sketch-paper-v1", JSON.stringify({ width: next.width, height: next.height })); } catch { /* この画面では広げられる */ }
      }}
    ><span className={edge === "left" || edge === "right" ? "h-10 w-1 rounded-full bg-white/30" : "h-1 w-10 rounded-full bg-white/30"} /></div>)}
    </div>
    </div>
    <div className="mt-1 text-[11px] text-neutral-500">手書きは画像としてメモに追加されます</div>
  </div>;
}
