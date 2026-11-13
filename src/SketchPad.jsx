import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { paintSketch, appendSketch, SKETCH_WIDTH, SKETCH_HEIGHT, fitSketchToPaper } from "./lib/sketch";

import { createPortal } from "react-dom";
import { Hand, Settings2, Undo2, Trash2 } from "lucide-react";
import { createLiveSketch } from "./lib/live-sketch";

// よく使う4色は出したまま。残りは押して開く見本から選ぶ（Goodnotes の鉛筆まわりに近い形）。
const COLORS = [{ name: "黒", color: "#202020" }, { name: "青", color: "#2563eb" }, { name: "赤", color: "#dc2626" }, { name: "緑", color: "#15803d" }];
const PALETTE = [
  "#202020", "#5b5b5b", "#9b9b9b", "#ffffff",
  "#dc2626", "#ea580c", "#d97706", "#ca8a04",
  "#15803d", "#059669", "#0891b2", "#2563eb",
  "#4f46e5", "#7c3aed", "#c026d3", "#db2777",
];
// 太さも、よく使う3つをすぐ押せるようにする
const WIDTHS = [{ label: "細", value: 2 }, { label: "中", value: 6 }, { label: "太", value: 12 }];
const COLOR_KEY = "taskspace-sketch-colors";
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

export default function SketchPad({ strokes, onChange, disabled, onPaperSize, standalone = false, toolbarTarget }) {
  const canvasRef = useRef(null), drawingRef = useRef(null), liveRef = useRef(null);
  const viewportRef = useRef(null), scaleReferenceRef = useRef(null);
  const [paperScale, setPaperScale] = useState(null);
  const [brush, setBrush] = useState("speed-extreme-v1");
  const panRef = useRef(null), committedRef = useRef(null), scrollIntentRef = useRef(false), lastExpansionRef = useRef(null);
  const [panMode, setPanMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paper, setPaper] = useState(() => {
    let saved;
    try { saved = JSON.parse(localStorage.getItem("taskspace-sketch-paper-v1")); } catch { /* 古い高さ設定を引き継ぐ */ }
    return { width: Math.max(600, ...strokes.map(stroke => stroke.paperWidth || 600), Number.isFinite(saved?.width) ? Math.min(1200, Math.max(600, saved.width)) : 600),
      height: Math.max(210, ...strokes.map(stroke => stroke.height || 360), Number.isFinite(saved?.height) ? Math.min(1200, Math.max(210, saved.height)) : Math.round(savedRatio() * 600)) };
  });
  // 専用画面は紙全体を横幅へ収める。note内では従来の実寸表示を保つ。
  useLayoutEffect(() => {
    const measure = () => setPaperScale((scaleReferenceRef.current.clientWidth - 32) / (standalone ? paper.width : 600));
    measure();
    if (!standalone) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scaleReferenceRef.current);
    return () => observer.disconnect();
  }, [standalone, paper.width]);
  useLayoutEffect(() => {
    if (!standalone) return;
    const scale = (scaleReferenceRef.current.clientWidth - 32) / paper.width;
    setPaper(value => ({ ...value, height: Math.max(value.height, Math.min(1200, Math.round(Math.max(1, viewportRef.current.clientHeight - 32) / scale))) }));
  }, [standalone, paper.width, toolbarTarget, paperScale]);
  useLayoutEffect(() => {
    if (paperScale !== null) onPaperSize?.({ width: paper.width, height: paper.height, scale: paperScale });
  }, [paper.width, paper.height, paperScale, onPaperSize]);
  const shownStrokes = useMemo(() => paper.shiftX || paper.shiftY ? fitSketchToPaper(strokes, paper) : strokes, [strokes, paper]);
  // 画面に出ている大きさ × 端末の細かさで描く。
  // 紙の寸法の2倍で固定していると、広い画面や iPad では引き伸ばされ、
  // 線の縁がぎざつく（「がびがび」に見えるのがこれ）。
  const density = Math.min(3, Math.max(1, typeof window === "undefined" ? 2 : window.devicePixelRatio || 2));
  const shownScale = paperScale || 2;
  // 大きすぎる紙は端末が持てないので、上限で頭打ちにする
  const pixelWidth = Math.min(4096, Math.round(paper.width * shownScale * density));
  const pixelHeight = Math.round(pixelWidth * (paper.height / paper.width));
  const [color, setColor] = useState(COLORS[0].color);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recent, setRecent] = useState(() => {
    try { const list = JSON.parse(localStorage.getItem(COLOR_KEY) || "[]"); return Array.isArray(list) ? list.filter((v) => /^#[0-9a-f]{6}$/i.test(v)).slice(0, 8) : []; }
    catch { return []; }
  });
  // 選んだ色は、最近つかった色として覚えておく（選び直しが速い）
  const pickColor = (value) => {
    setColor(value);
    setPaletteOpen(false);
    setRecent((prev) => {
      const next = [value, ...prev.filter((item) => item !== value)].slice(0, 8);
      try { localStorage.setItem(COLOR_KEY, JSON.stringify(next)); } catch { /* 覚えられなくても使える */ }
      return next;
    });
  };
  const [width, setWidth] = useState(10);
  const [cleared, setCleared] = useState(null);
  const [penOnly, setPenOnly] = useState(() => preference("taskspace-sketch-pen-only"));
  const [pressure, setPressure] = useState(() => preference("taskspace-sketch-pressure"));
  useLayoutEffect(() => {
    const canvas = canvasRef.current, committed = committedRef.current;
    committedRef.current = null;
    // 確定した線は既に同じ紙へ描いてある。過去の全線を再計算して次の入力を止めない。
    if (committed?.strokes === strokes && committed.width === canvas.width && committed.height === canvas.height && shownStrokes === strokes) return;
    paintSketch(canvas, shownStrokes, paper.width);
  }, [shownStrokes, strokes, paper.width, paper.height, pixelWidth, pixelHeight]);
  useEffect(() => () => { liveRef.current?.dispose(); liveRef.current = null; }, []);
  const extendDown = useCallback(() => {
    if (!standalone || disabled || drawingRef.current || paper.height >= 1200 || lastExpansionRef.current === paper.height) return;
    lastExpansionRef.current = paper.height; scrollIntentRef.current = false;
    const next = { width: paper.width, height: Math.min(1200, paper.height + 180) };
    setPaper(next);
    try { localStorage.setItem("taskspace-sketch-paper-v1", JSON.stringify(next)); } catch { /* この画面では広げられる */ }
  }, [standalone, disabled, paper.width, paper.height]);
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
        scrollIntentRef.current = true;
        if (event.clientY < pan.y && pan.viewport.scrollTop + pan.viewport.clientHeight >= pan.viewport.scrollHeight - 8) extendDown();
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
  }, [addPoints, extendDown]);
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
    const next = [...strokes, drawing.stroke];
    committedRef.current = { strokes: next, width: canvasRef.current.width, height: canvasRef.current.height };
    onChange(next);
    setCleared(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const tools = (
    <div data-sketch-tools className={standalone ? "flex w-max shrink-0 flex-nowrap items-center gap-1.5" : "mb-2 flex shrink-0 flex-wrap items-center gap-1.5"}>
      {COLORS.map((item) => <button key={item.color} type="button" aria-label={`ペンの色：${item.name}`} aria-pressed={color === item.color} disabled={disabled} onClick={() => pickColor(item.color)} className="flex h-9 w-9 items-center justify-center rounded border border-white/15 aria-pressed:ring-1 aria-pressed:ring-white/70"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: item.color }} /></button>)}
      <div className="relative shrink-0">
        <button
          type="button"
          data-sketch-palette
          aria-label="ペンの色を選ぶ"
          aria-expanded={paletteOpen}
          disabled={disabled}
          onClick={() => setPaletteOpen((value) => !value)}
          className="flex h-9 w-9 items-center justify-center rounded border border-white/15 aria-expanded:bg-white/10"
        >
          <span className="h-4 w-4 rounded-full border border-white/30" style={{ backgroundColor: color }} />
        </button>
        {paletteOpen && (
          <div data-sketch-palette-panel className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/15 ts-surface p-2 shadow-2xl">
            {recent.length > 0 && <>
              <div className="mb-1 text-[10px] text-neutral-500">最近つかった色</div>
              <div className="mb-2 flex flex-wrap gap-1">
                {recent.map((value) => <button key={`recent-${value}`} type="button" data-sketch-recent={value} aria-label={`最近の色 ${value}`} onClick={() => pickColor(value)} className="h-7 w-7 rounded-full border border-white/20" style={{ backgroundColor: value }} />)}
              </div>
            </>}
            <div className="mb-1 text-[10px] text-neutral-500">色</div>
            <div className="mb-2 grid grid-cols-8 gap-1">
              {PALETTE.map((value) => <button key={value} type="button" data-sketch-swatch={value} aria-label={`色 ${value}`} aria-pressed={color === value} onClick={() => pickColor(value)} className="h-6 w-6 rounded-full border border-white/20 aria-pressed:ring-2 aria-pressed:ring-white/70" style={{ backgroundColor: value }} />)}
            </div>
            <label className="flex items-center gap-2 text-[10px] text-neutral-400">
              そのほかの色
              <input data-sketch-color-input type="color" value={color} onChange={(event) => pickColor(event.target.value)} className="h-7 w-10 rounded border border-white/15 bg-transparent" />
            </label>
          </div>
        )}
      </div>
      <div data-sketch-widths className="flex shrink-0 items-center gap-1">
        {WIDTHS.map((item) => <button
          key={item.value}
          type="button"
          data-sketch-width-preset={item.value}
          aria-label={`太さ：${item.label}`}
          aria-pressed={width === item.value}
          disabled={disabled}
          onClick={() => setWidth(item.value)}
          className="flex h-9 w-9 items-center justify-center rounded border border-white/15 aria-pressed:bg-white/10 aria-pressed:ring-1 aria-pressed:ring-white/60"
        >
          <span className="rounded-full bg-current" style={{ width: `${4 + item.value * 0.8}px`, height: `${4 + item.value * 0.8}px` }} />
        </button>)}
      </div>
      <select hidden={standalone && !settingsOpen} data-sketch-brush aria-label="ペンの種類" value={brush} disabled={disabled} onChange={(event) => setBrush(event.target.value)} className="h-9 rounded border border-white/15 ts-surface px-2 text-xs"><option value="speed-extreme-v1">速度ペン・強弱最大</option><option value="legacy">従来のペン</option></select>
      <label hidden={standalone && !settingsOpen} className="flex items-center gap-2 text-xs">太さ <input data-sketch-width aria-label="ペンの太さ" type="range" min="1" max="20" step="0.5" value={width} disabled={disabled} onChange={event => setWidth(Number(event.target.value))} className="w-24" /><output>{width}</output></label>
      <button type="button" data-sketch-pan aria-label="紙を移動" title="紙を移動：オンの間は指やマウスで紙をドラッグできます" aria-pressed={panMode} disabled={disabled} onClick={() => setPanMode(value => !value)} className="flex h-9 w-9 items-center justify-center rounded border border-white/15 aria-pressed:bg-accent-400/20 aria-pressed:text-accent-200"><Hand aria-hidden="true" className="h-4 w-4" /></button>
      <button type="button" data-sketch-undo disabled={disabled || (!strokes.length && !cleared)} onClick={() => { onChange(strokes.length ? strokes.slice(0, -1) : cleared); setCleared(null); }} className="rounded border border-white/15 px-2 py-2 text-xs text-neutral-300 disabled:opacity-30" aria-label="戻す" title="戻す">{standalone ? <Undo2 aria-hidden="true" className="h-4 w-4" /> : "戻す"}</button>
      <button type="button" data-sketch-clear disabled={disabled || !strokes.length} onClick={() => { setCleared(strokes); onChange([]); }} className="rounded border border-white/15 px-2 py-2 text-xs text-neutral-400 disabled:opacity-30" aria-label="全消去" title="全消去">{standalone ? <Trash2 aria-hidden="true" className="h-4 w-4" /> : "全消去"}</button>
    {standalone && <button type="button" data-sketch-settings aria-label="ペンの設定" aria-expanded={settingsOpen} disabled={disabled} onClick={() => setSettingsOpen(value => !value)} className="flex h-10 w-10 items-center justify-center rounded border border-white/15 text-neutral-400 hover:bg-white/10"><Settings2 aria-hidden="true" className="h-4 w-4" /></button>}
    </div>
  );
  return <div data-sketch-pad className={standalone ? "flex h-full min-h-0 flex-col" : "mt-2"} style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
    {toolbarTarget ? createPortal(tools, toolbarTarget) : tools}
    <div hidden={standalone && !settingsOpen} className={standalone && !settingsOpen ? "hidden" : "mb-2 flex flex-wrap gap-3 text-xs text-neutral-300"}>
      <label className="flex min-h-9 items-center gap-2"><input data-sketch-pen-only type="checkbox" checked={penOnly} disabled={disabled} onChange={(event) => { setPenOnly(event.target.checked); try { localStorage.setItem("taskspace-sketch-pen-only", String(event.target.checked)); } catch { /* この画面では使える */ } }} />ペン専用（手の接触を無視）</label>
      <label className="flex min-h-9 items-center gap-2" style={{ display: brush === "legacy" ? undefined : "none" }}><input data-sketch-pressure type="checkbox" checked={pressure} disabled={disabled} onChange={(event) => { setPressure(event.target.checked); try { localStorage.setItem("taskspace-sketch-pressure", String(event.target.checked)); } catch { /* この画面では使える */ } }} />筆圧を使う</label>
    </div>
    <div hidden={standalone && !settingsOpen} className="mb-1 text-[11px] text-neutral-500">ペンを使うとペン専用がオンになります。紙の端を引くと余白が増え、手のアイコンで紙を移動できます。</div>
    <div ref={scaleReferenceRef} aria-hidden="true" className="h-0 overflow-hidden border-x border-transparent" style={{ width: standalone ? "100%" : "min(100%, calc(28rem - 2rem - 2px))" }} />
    <div ref={viewportRef} data-sketch-viewport onWheel={event => {
      if (event.deltaY <= 0) return;
      scrollIntentRef.current = true;
      const viewport = event.currentTarget;
      if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 8) extendDown();
    }} onScroll={event => {
      const viewport = event.currentTarget;
      if (scrollIntentRef.current && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 8) extendDown();
    }} className={standalone ? "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-white/15" : "max-h-[60dvh] overflow-auto overscroll-contain rounded-lg border border-white/15"}>
    <div className="relative p-4" style={{ width: standalone || paperScale === null ? "100%" : `${paper.width * paperScale + 32}px`, contain: "layout paint" }}>
    <canvas ref={canvasRef} data-sketch-canvas aria-label="指やペンで描く手書き欄" width={pixelWidth} height={pixelHeight} className="block w-full rounded-lg border border-white/20" style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", cursor: panMode ? "grab" : undefined, aspectRatio: `${pixelWidth} / ${pixelHeight}` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!disabled && !drawingRef.current && !panRef.current && panMode && event.pointerType !== "pen" && event.isPrimary && event.button === 0) {
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
        if (disabled || drawingRef.current || panRef.current || !event.isPrimary || event.button !== 0 || (penOnly && event.pointerType !== "pen")) return;
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
    </div>
    </div>
  </div>;
}
