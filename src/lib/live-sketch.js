import { appendSketch, sketchPreviewStroke, SKETCH_HEIGHT } from "./sketch";

// 表示は一枚に限定する。別レイヤーの合成やReactの再描画を待たず、同じ紙へ線を出す。
// onPaint … 1回の描き直しにかかった時間を知らせる口（計測ページだけが使う）。
// 渡さなければ、これまでと同じ動きのまま何も測らない。
export function createLiveSketch(canvas, onPaint) {
  const backing = canvas.ownerDocument.createElement("canvas");
  let active = null, frame = null, counted = 0, bounds = null;
  function extend() {
    const scaleY = (active.height || SKETCH_HEIGHT) * canvas.width / (active.paperWidth || 600);
    for (; counted < active.points.length; counted++) {
      const p = active.points[counted], x = p[0] * canvas.width, y = p[1] * scaleY;
      if (!bounds) bounds = { left: x, right: x, top: y, bottom: y };
      else { bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x); bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y); }
    }
  }
  function restore() {
    const pad = active.width * canvas.width / (active.paperWidth || 600) * 2 + 4;
    const left = Math.max(0, Math.floor(bounds.left - pad)), top = Math.max(0, Math.floor(bounds.top - pad));
    const right = Math.min(canvas.width, Math.ceil(bounds.right + pad)), bottom = Math.min(canvas.height, Math.ceil(bounds.bottom + pad));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(backing, left, top, right - left, bottom - top, left, top, right - left, bottom - top);
  }
  function paint(complete = false) {
    if (!active) return;
    const started = onPaint ? performance.now() : 0;
    extend(); restore();
    appendSketch(canvas, complete ? active : sketchPreviewStroke(active), 0, complete, active.paperWidth || 600);
    if (onPaint) onPaint({ ms: performance.now() - started, points: active.points.length, complete });
  }
  function cancelFrame() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
  return {
    begin(stroke) {
      cancelFrame(); backing.width = canvas.width; backing.height = canvas.height;
      backing.getContext("2d").drawImage(canvas, 0, 0);
      active = stroke; counted = 0; bounds = null; paint();
    },
    update() {
      if (!active) return;
      // 最初の移動はイベント内で即座に描き、それ以降は一画面更新に一度へまとめる。
      if (counted <= 1) paint();
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; paint(); });
    },
    finish() { cancelFrame(); paint(true); active = null; bounds = null; },
    dispose() { cancelFrame(); active = null; backing.width = backing.height = 0; },
  };
}
