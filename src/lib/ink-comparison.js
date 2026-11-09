import { getStroke } from 'perfect-freehand';

export const INK_MODES = { speed: '速度で強弱', pressure: '実筆圧で強弱', fixed: '一定幅' };
export const INK_WIDTH = 600;
export const INK_HEIGHT = 400;

// 時刻を使って速度を求め、イベントの届く頻度だけで太さが変わるのを避ける。
export function inkPoints(samples, mode) {
  let speed = 0.5;
  return samples.map((sample, index) => {
    if (index) {
      const previous = samples[index - 1];
      const elapsed = sample.t - previous.t;
      if (elapsed > 0) {
        const measured = Math.min(4, Math.hypot(sample.x - previous.x, sample.y - previous.y) / elapsed);
        speed += (measured - speed) * (1 - Math.exp(-elapsed / 16));
      }
    }
    const pressure = mode === 'speed' ? 0.2 + 0.65 / (1 + speed / 0.45) : sample.p;
    return [sample.x, sample.y, pressure];
  });
}

export function inkOutline(stroke, complete = true, mode = stroke.mode) {
  return getStroke(inkPoints(stroke.samples, mode), {
    size: stroke.width, thinning: mode === 'fixed' ? 0 : 0.6,
    smoothing: 0.45, streamline: 0.15, simulatePressure: false,
    start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last: complete,
  });
}

export function drawInk(ctx, stroke, complete = true, mode = stroke.mode) {
  const outline = inkOutline(stroke, complete, mode);
  if (!outline.length) return;
  // 輪郭の隣接点を曲線でつなぎ、端だけ別の大きな円を重ねない。
  ctx.fillStyle = '#202020'; ctx.beginPath();
  ctx.moveTo((outline[0][0] + outline.at(-1)[0]) / 2, (outline[0][1] + outline.at(-1)[1]) / 2);
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index], b = outline[(index + 1) % outline.length];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.closePath(); ctx.fill();
}

export function readInkDraft(value) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 2000) return [];
    return parsed.filter((stroke) => Object.hasOwn(INK_MODES, stroke?.mode) && Number.isFinite(stroke.width) && stroke.width >= 1 && stroke.width <= 40 && Array.isArray(stroke.samples) && stroke.samples.length > 0 && stroke.samples.length <= 12000 && stroke.samples.every((s, index) => Number.isFinite(s.x) && s.x >= 0 && s.x <= INK_WIDTH && Number.isFinite(s.y) && s.y >= 0 && s.y <= INK_HEIGHT && Number.isFinite(s.p) && s.p >= 0 && s.p <= 1 && Number.isFinite(s.t) && (index === 0 || s.t >= stroke.samples[index - 1].t)));
  } catch { return []; }
}
