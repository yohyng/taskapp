import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createLiveSketch } from "./lib/live-sketch";
import { paintSketch, SKETCH_DRAFT_KEY } from "./lib/sketch";
import { ring, summarize, overCount, deviceSummary } from "./lib/ink-metrics";
import "./index.css";

// 手書きが詰まる場所を切り分けるための計測ページ。
// 本番の描画・保存と同じ道を通し、入力・描画・保存を別々に止められるようにする。
// 認証も同期もノートへの追加もしない。ここで測った数だけを持ち出す。

const PAPER = { width: 600, height: 900 };
const STEPS = [
  "ゆっくり直線を1本",
  "速い直線を5本",
  "続けて波線（手首を速く）",
  "文字を1行",
  "長いストローク（端から端まで、止めずに）",
];

const box = "rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2";

export function Row({ label, value }) {
  return <div className="flex items-baseline justify-between gap-3 text-[12px]">
    <span className="text-neutral-400">{label}</span>
    <span className="tabular-nums ts-text">{value}</span>
  </div>;
}

export function Stat({ title, data, unit = "ms", over }) {
  return <div className={box}>
    <div className="mb-1 text-[11px] font-semibold text-neutral-300">{title}</div>
    {data ? <>
      <Row label="回数" value={data.count} />
      <Row label="中央" value={`${data.p50} ${unit}`} />
      <Row label="上位5%" value={`${data.p95} ${unit}`} />
      <Row label="最大" value={`${data.max} ${unit}`} />
      {over !== undefined && <Row label={over.label} value={over.value} />}
    </> : <div className="text-[11px] text-neutral-600">まだ記録がありません</div>}
  </div>;
}

export default function InkDiag() {
  const canvasRef = useRef(null), liveRef = useRef(null), drawingRef = useRef(null);
  const recordingRef = useRef(false);
  const dataRef = useRef({
    moveGap: ring(), coalesced: ring(), frameGap: ring(), paint: ring(),
    stringify: ring(), storage: ring(), react: ring(), longtask: ring(), strokePoints: ring(),
  });
  const lastMoveRef = useRef(0), lastFrameRef = useRef(0), rafRef = useRef(null), obsRef = useRef(null);
  const strokesRef = useRef([]);
  // 画面の数は、書いている最中には触らない（描画と競合させない）
  const [recording, setRecording] = useState(false);
  const [shown, setShown] = useState(null);
  const [drawMode, setDrawMode] = useState("live");     // live / none
  const [saveMode, setSaveMode] = useState("off");      // off / draft
  const [note, setNote] = useState("");
  const [device] = useState(deviceSummary);
  const [strokeCount, setStrokeCount] = useState(0);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    canvas.width = PAPER.width * 2;
    canvas.height = PAPER.height * 2;
    paintSketch(canvas, strokesRef.current, PAPER.width);
  }, []);
  useEffect(() => { sizeCanvas(); }, [sizeCanvas]);

  // 画面の更新そのものが止まっていないか。描かない設定でも回しておく。
  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      if (recordingRef.current && lastFrameRef.current) dataRef.current.frameGap.push(now - lastFrameRef.current);
      lastFrameRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // 長く main thread を塞いだ仕事（対応している端末だけ）
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => {
        if (!recordingRef.current) return;
        for (const entry of list.getEntries()) dataRef.current.longtask.push(entry.duration);
      });
      observer.observe({ entryTypes: ["longtask"] });
      obsRef.current = observer;
      return () => observer.disconnect();
    } catch { /* 対応していない端末では、ほかの数で見る */ }
  }, []);

  const point = (event, rect) => [
    Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 10000) / 10000,
    Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 10000) / 10000,
  ];

  const addPoints = useCallback((event, final = false) => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    const native = event.nativeEvent || event;
    const now = performance.now();
    if (recordingRef.current) {
      if (lastMoveRef.current) dataRef.current.moveGap.push(now - lastMoveRef.current);
      lastMoveRef.current = now;
    }
    let samples = [];
    if (drawing.pen && !final) {
      try { samples = native.getCoalescedEvents?.() || []; } catch { /* 未対応なら1点だけ */ }
    }
    if (recordingRef.current) dataRef.current.coalesced.push(samples.length);
    const stroke = drawing.stroke;
    for (const sample of [...samples, native]) {
      const p = point(sample, drawing.rect), last = stroke.points.at(-1);
      if (p[0] !== last[0] || p[1] !== last[1]) {
        stroke.points.push(p);
        stroke.times.push(Math.max(stroke.times.at(-1), sample.timeStamp - drawing.started));
      }
    }
    if (drawMode === "live") liveRef.current?.update();
  }, [drawMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const move = (event) => {
      if (!drawingRef.current || drawingRef.current.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      addPoints(event);
    };
    const block = (event) => { event.preventDefault(); event.stopPropagation(); };
    canvas.addEventListener("pointermove", move, { passive: false });
    for (const type of ["selectstart", "contextmenu", "touchstart", "touchmove"]) canvas.addEventListener(type, block, { passive: false });
    return () => {
      canvas.removeEventListener("pointermove", move);
      for (const type of ["selectstart", "contextmenu", "touchstart", "touchmove"]) canvas.removeEventListener(type, block);
    };
  }, [addPoints]);

  function begin(event) {
    if (!event.isPrimary || event.button !== 0 || drawingRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const stroke = {
      color: "#202020", width: 10, height: PAPER.height, paperWidth: PAPER.width,
      brush: "speed-extreme-v1", times: [0], points: [point(event, rect)],
    };
    drawingRef.current = { pointerId: event.pointerId, stroke, pen: event.pointerType === "pen", started: event.timeStamp, rect };
    lastMoveRef.current = 0;
    if (drawMode === "live") {
      // 本番と同じ道。1フレームぶんの描き直しにかかった時間を受け取る。
      if (!liveRef.current) liveRef.current = createLiveSketch(canvasRef.current, ({ ms }) => {
        if (recordingRef.current) dataRef.current.paint.push(ms);
      });
      liveRef.current.begin(stroke);
    }
  }

  function finish(event) {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") addPoints(event, true);
    drawingRef.current = null;
    if (drawMode === "live") liveRef.current?.finish();
    const next = [...strokesRef.current, drawing.stroke];
    strokesRef.current = next;
    if (recordingRef.current) dataRef.current.strokePoints.push(drawing.stroke.points.length);

    // 本番は、ここで「文字列にする」「端末へ書く」「React を更新する」を続けてやる。
    // どれが重いのかを分けて測る。
    if (saveMode === "draft") {
      const a = performance.now();
      const text = JSON.stringify(next);
      const b = performance.now();
      try { localStorage.setItem(SKETCH_DRAFT_KEY, text); } catch { /* 入らなくても計測は続ける */ }
      const c = performance.now();
      // React の更新は、まとめられると測れない。ここだけ同期で流して時間を見る。
      flushSync(() => setStrokeCount(next.length));
      const d = performance.now();
      if (recordingRef.current) {
        dataRef.current.stringify.push(b - a);
        dataRef.current.storage.push(c - b);
        dataRef.current.react.push(d - c);
      }
    } else {
      setStrokeCount(next.length);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function start() {
    for (const value of Object.values(dataRef.current)) value.clear();
    lastMoveRef.current = 0; lastFrameRef.current = 0;
    recordingRef.current = true;
    setShown(null); setRecording(true); setNote("");
  }
  function stop() {
    recordingRef.current = false;
    setRecording(false);
    setShown(report());
  }
  function report() {
    const d = dataRef.current;
    const moves = d.moveGap.list, frames = d.frameGap.list;
    return {
      at: new Date().toISOString(),
      device,
      settings: { draw: drawMode, save: saveMode, paper: PAPER },
      strokes: { count: d.strokePoints.length, points: summarize(d.strokePoints.list) },
      pointermove: { ...summarize(moves), over50: overCount(moves, 50), over100: overCount(moves, 100) },
      coalesced: summarize(d.coalesced.list),
      frame: { ...summarize(frames), over50: overCount(frames, 50), over100: overCount(frames, 100) },
      paint: { ...summarize(d.paint.list), over8: overCount(d.paint.list, 8), over16: overCount(d.paint.list, 16) },
      save: {
        stringify: summarize(d.stringify.list),
        localStorage: summarize(d.storage.list),
        react: summarize(d.react.list),
      },
      longtask: { ...summarize(d.longtask.list), count: d.longtask.length },
    };
  }
  async function copy() {
    const text = JSON.stringify(shown ?? report(), null, 2);
    try { await navigator.clipboard.writeText(text); setNote("計測結果を写しました"); }
    catch { setNote("写せませんでした。↓ で保存してください"); }
  }
  function download() {
    const text = JSON.stringify(shown ?? report(), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `ink-diag-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote("計測結果を保存しました");
  }
  function clearPaper() {
    strokesRef.current = [];
    setStrokeCount(0);
    paintSketch(canvasRef.current, [], PAPER.width);
    try { localStorage.removeItem(SKETCH_DRAFT_KEY); } catch { /* 無ければそのまま */ }
  }

  return <div className="min-h-dvh bg-neutral-900 text-neutral-200">
    <div className="mx-auto flex max-w-5xl flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-sm font-semibold ts-text">手書きの計測</h1>
        <label className="flex items-center gap-1 text-[11px]">描画
          <select data-diag-draw value={drawMode} disabled={recording} onChange={(e) => setDrawMode(e.target.value)} className="h-9 rounded border border-white/15 bg-neutral-800 px-2 text-[11px]">
            <option value="live">本番と同じ</option>
            <option value="none">入力だけ（描かない）</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px]">保存
          <select data-diag-save value={saveMode} disabled={recording} onChange={(e) => setSaveMode(e.target.value)} className="h-9 rounded border border-white/15 bg-neutral-800 px-2 text-[11px]">
            <option value="off">しない</option>
            <option value="draft">本番と同じ</option>
          </select>
        </label>
        <button type="button" data-diag-toggle onClick={recording ? stop : start}
          className={`h-9 rounded-lg border px-4 text-[12px] ${recording ? "border-red-400/50 bg-red-400/15 text-red-100" : "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"}`}>
          {recording ? "記録をとめる" : "記録をはじめる"}
        </button>
        <button type="button" data-diag-clear onClick={clearPaper} disabled={recording} className="h-9 rounded-lg border border-white/15 px-3 text-[12px] text-neutral-300 disabled:opacity-30">紙を消す</button>
      </header>

      <ol className="flex flex-wrap gap-2 text-[11px] text-neutral-400">
        {STEPS.map((step, i) => <li key={step} className="rounded-full border border-white/10 px-2 py-1">{i + 1}. {step}</li>)}
      </ol>

      <canvas ref={canvasRef} data-diag-canvas aria-label="指やペンで描く計測用の紙"
        className="block w-full rounded-lg border border-white/20 bg-white"
        style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", aspectRatio: `${PAPER.width} / ${PAPER.height}` }}
        onPointerDown={begin} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat title="入力の間隔（pointermove）" data={shown && summarize(dataRef.current.moveGap.list)}
          over={{ label: "50ms超", value: shown?.pointermove?.over50 ?? 0 }} />
        <Stat title="画面の更新間隔（フレーム）" data={shown && summarize(dataRef.current.frameGap.list)}
          over={{ label: "50ms超", value: shown?.frame?.over50 ?? 0 }} />
        <Stat title="1回の描き直し" data={shown && summarize(dataRef.current.paint.list)}
          over={{ label: "16ms超", value: shown?.paint?.over16 ?? 0 }} />
        <Stat title="確定：文字列にする" data={shown && summarize(dataRef.current.stringify.list)} />
        <Stat title="確定：端末へ書く" data={shown && summarize(dataRef.current.storage.list)} />
        <Stat title="確定：画面の更新" data={shown && summarize(dataRef.current.react.list)} />
      </div>

      <div className={box}>
        <Row label="いまの線の数" value={strokeCount} />
        <Row label="1本あたりの点数（中央）" value={shown?.strokes?.points?.p50 ?? "—"} />
        <Row label="まとめ届き（coalesced・中央）" value={shown?.coalesced?.p50 ?? "—"} />
        <Row label="長く塞いだ仕事（longtask）" value={shown ? `${shown.longtask.count} 回 / 最大 ${shown.longtask.max ?? 0} ms` : "—"} />
        <Row label="画面" value={`${device.viewport} / DPR ${device.dpr} / 指 ${device.maxTouchPoints}`} />
        <div className="mt-1 break-all text-[10px] text-neutral-600">{device.userAgent}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-diag-copy onClick={copy} disabled={!shown} className="h-9 rounded-lg border border-white/15 px-3 text-[12px] text-neutral-300 disabled:opacity-30">結果を写す</button>
        <button type="button" data-diag-download onClick={download} disabled={!shown} className="h-9 rounded-lg border border-white/15 px-3 text-[12px] text-neutral-300 disabled:opacity-30">結果を保存（JSON）</button>
        {note && <span data-diag-note className="text-[11px] text-neutral-400">{note}</span>}
      </div>

      <p className="text-[11px] leading-relaxed text-neutral-500">
        線の座標も本文も記録しません。残るのは時間の数だけです。
        「描画：入力だけ」で遅れが消えれば描き直しが重く、「保存：しない」で消えれば確定時の保存が重い、という見分けになります。
      </p>
    </div>
  </div>;
}

createRoot(document.getElementById("root")).render(<InkDiag />);
