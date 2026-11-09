import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { drawInk, INK_MODES, INK_WIDTH, INK_HEIGHT, readInkDraft } from './lib/ink-comparison';
import './index.css';

const KEY = 'fragments-ink-comparison-v1';
const button = 'rounded-lg border border-white/20 px-3 py-2 disabled:opacity-30';

function reset(canvas, white = false) {
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (white) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.setTransform(canvas.width / INK_WIDTH, 0, 0, canvas.height / INK_HEIGHT, 0, 0);
  return ctx;
}

export default function InkLab() {
  const [mode, setMode] = useState('speed'), [width, setWidth] = useState(10);
  const [count, setCount] = useState(0), [last, setLast] = useState(null), [message, setMessage] = useState('');
  const base = useRef(null), overlay = useRef(null), drawing = useRef(null), strokes = useRef([]), frame = useRef(null);
  useEffect(() => {
    reset(base.current, true);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  function repaint() {
    const ctx = reset(base.current, true);
    for (const stroke of strokes.current) drawInk(ctx, stroke);
    reset(overlay.current); setCount(strokes.current.length);
  }
  function sample(event, canvas, previous) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(INK_WIDTH, (event.clientX - rect.left) / rect.width * INK_WIDTH)), y: Math.max(0, Math.min(INK_HEIGHT, (event.clientY - rect.top) / rect.height * INK_HEIGHT)), p: event.type === 'pointerup' ? previous.p : event.pointerType === 'pen' ? Math.max(0, Math.min(1, event.pressure)) : 0.5, t: event.timeStamp };
  }
  function add(event) {
    const current = drawing.current;
    if (!current || current.id !== event.pointerId) return;
    const native = event.nativeEvent || event;
    const coalesced = native.getCoalescedEvents?.() || [];
    // 親イベントは集約済みの要約なので、実測点があれば二重に追加しない。
    for (const item of coalesced.length ? coalesced : [native]) {
      const previous = current.stroke.samples.at(-1), next = sample(item, overlay.current, previous);
      if (next.t < previous.t || (next.x === previous.x && next.y === previous.y && next.p === previous.p)) continue;
      if (current.stroke.samples.length < 12000) current.stroke.samples.push(next);
    }
    if (frame.current === null) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (drawing.current) drawInk(reset(overlay.current), drawing.current.stroke, false);
    });
  }
  function finish(event) {
    const current = drawing.current;
    if (!current || current.id !== event.pointerId) return;
    if (event.type === 'pointerup') add(event);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; drawing.current = null;
    // 確定した線は下のキャンバスに一度だけ描き、入力中は現在の線だけを描く。
    const ctx = base.current.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0); drawInk(ctx, current.stroke);
    reset(overlay.current); strokes.current.push(current.stroke);
    setLast(current.stroke); setCount(strokes.current.length);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function download(blob, name) {
    if (!blob) { setMessage('保存できませんでした'); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return <main className="mx-auto max-w-3xl p-4 ts-text">
    <h1 className="text-lg font-semibold">fragments ペンの比較 <span className="text-xs text-neutral-400">v1.24.0</span></h1>
    <p className="my-3 text-sm text-neutral-300">速度で太さが変わるペンと、筆圧で濃淡が変わる鉛筆を選べます。本番のノートには追加されません。</p>
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="ペンの方式">
      {Object.entries(INK_MODES).map(([value, label]) => <button key={value} data-ink-mode={value} aria-pressed={mode === value} className={`${button} aria-pressed:bg-white/20`} onClick={() => setMode(value)}>{label}</button>)}
    </div>
    <p data-ink-description className="mb-3 text-sm text-neutral-300">{mode === 'speed' ? 'Concepts風：ゆっくり太く、速く細く。' : mode === 'pencil' ? 'Goodnotes風：軽い力で淡く、押すと濃く。太さの変化は控えめです。' : mode === 'fixed' ? '力や速さによらず、同じ幅で描きます。' : '実際の筆圧で線幅が変わります。'}</p>
    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <label>太さ <select data-ink-width value={width} onChange={(e) => setWidth(Number(e.target.value))} className="rounded border border-white/20 bg-neutral-800 p-2"><option value={6}>細め</option><option value={10}>標準</option><option value={16}>太め</option></select></label>
      <button data-ink-undo className={button} disabled={!count} onClick={() => { if (drawing.current) return; strokes.current.pop(); setLast(strokes.current.at(-1) || null); repaint(); }}>戻す</button>
      <button data-ink-clear className={button} disabled={!count} onClick={() => { if (drawing.current) return; strokes.current = []; setLast(null); repaint(); }}>全消去</button>
    </div>
    <div className="relative overflow-hidden rounded-xl bg-white" style={{ aspectRatio: '3 / 2' }}>
      <canvas ref={base} data-ink-base width={1200} height={800} className="absolute inset-0 h-full w-full" />
      <canvas ref={overlay} data-ink-canvas aria-label="ペンを書き比べる紙" width={1200} height={800} className="absolute inset-0 h-full w-full" style={{ touchAction: 'none' }}
        onPointerDown={(event) => {
          if (drawing.current || !event.isPrimary || event.button !== 0) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = { id: event.pointerId, stroke: { mode, width, samples: [sample(event, event.currentTarget)] } };
          drawInk(reset(overlay.current), drawing.current.stroke, false);
        }} onPointerMove={add} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
    </div>
    <p className="my-2 text-xs text-neutral-400">方式と太さの変更は、次に書く線へ適用されます。筆圧ペンと鉛筆は、SペンやApple Pencilで比較してください。</p>
    <div className="my-3 flex flex-wrap gap-2 text-sm">
      <button data-ink-save className={button} disabled={!count} onClick={() => { try { localStorage.setItem(KEY, JSON.stringify(strokes.current)); setMessage('この端末に下書きを保存しました'); } catch { setMessage('下書きを保存できませんでした'); } }}>下書きを残す</button>
      <button data-ink-restore className={button} onClick={() => { if (drawing.current) return; try { strokes.current = readInkDraft(localStorage.getItem(KEY)); setLast(strokes.current.at(-1) || null); repaint(); setMessage('下書きを戻しました'); } catch { setMessage('下書きを戻せませんでした'); } }}>下書きを戻す</button>
      <button data-ink-export className={button} disabled={!count} onClick={() => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; const ctx = reset(canvas, true); strokes.current.forEach((stroke) => drawInk(ctx, stroke)); canvas.toBlob((blob) => download(blob, 'ペンの比較.png')); }}>画像を保存</button>
      <button data-ink-input className={button} disabled={!last} onClick={() => download(new Blob([JSON.stringify({ format: 1, version: '1.24.0', stroke: last })], { type: 'application/json' }), 'ペンの入力.json')}>直前の入力を保存</button>
    </div>
    <p role="status" className="text-xs">{message}</p>
    {last && <section className="mt-5"><h2 className="text-sm">同じ入力を4種類で比較</h2><p className="my-2 text-xs text-neutral-400">直前の線の軌跡・時刻・筆圧を使い、ペンの表現を変えています。</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {Object.entries(INK_MODES).map(([value, label]) => <div key={value}><p className="mb-1 text-xs">{label}</p><canvas data-ink-replay={value} width={600} height={400} className="w-full rounded-lg bg-white" ref={(canvas) => { if (canvas) drawInk(reset(canvas, true), last, true, value); }} /></div>)}
    </div></section>}
    <p className="mt-5 text-xs text-neutral-400">独自の近似ブラシです。各アプリと同一の描画方式ではありません。鉛筆は筆圧による濃淡と紙目を試せます（傾きの陰影は未対応）。<a href="/pen-lab.html" className="underline">以前の検証ページ</a></p>
  </main>;
}
createRoot(document.getElementById('root')).render(<InkLab />);
