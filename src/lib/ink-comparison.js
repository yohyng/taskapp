import { getStroke } from 'perfect-freehand';

export const INK_MODES = { speed: 'Concepts風・速度ペン', pencil: 'Goodnotes風・鉛筆', pressure: '実筆圧ペン', fixed: '一定幅ペン' };
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
    size: stroke.width * (mode === 'pencil' ? 0.55 : 1), thinning: mode === 'fixed' ? 0 : mode === 'pencil' ? 0.15 : 0.6,
    smoothing: 0.45, streamline: 0.15, simulatePressure: false,
    start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last: complete,
  });
}

function outlinePath(ctx, outline) {
  // 輪郭の隣接点を曲線でつなぎ、端だけ別の大きな円を重ねない。
  ctx.beginPath();
  ctx.moveTo((outline[0][0] + outline.at(-1)[0]) / 2, (outline[0][1] + outline.at(-1)[1]) / 2);
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index], b = outline[(index + 1) % outline.length];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.closePath();
}

const textures = new WeakMap();
function pencilTexture(document) {
  if (textures.has(document)) return textures.get(document);
  const tile = document.createElement('canvas'); tile.width = tile.height = 64;
  const ctx = tile.getContext('2d'), pixels = ctx.createImageData(64, 64);
  // 紙目は毎回同じ位置に固定し、描画中・復元・PNGで模様が変わらないようにする。
  for (let i = 0; i < 64 * 64; i++) {
    let hash = Math.imul(i + 19, 1597334677); hash ^= hash >>> 16;
    pixels.data[i * 4 + 3] = 90 + (hash >>> 0) % 166;
  }
  ctx.putImageData(pixels, 0, 0); textures.set(document, tile); return tile;
}

function drawPencil(ctx, stroke, outline) {
  const left = Math.floor(Math.min(...outline.map((p) => p[0])) - 2), top = Math.floor(Math.min(...outline.map((p) => p[1])) - 2);
  const width = Math.ceil(Math.max(...outline.map((p) => p[0])) - left + 2), height = Math.ceil(Math.max(...outline.map((p) => p[1])) - top + 2);
  const paper = ctx.canvas.ownerDocument;
  const layer = paper.createElement('canvas'); layer.width = width * 2; layer.height = height * 2;
  const ink = layer.getContext('2d'); ink.setTransform(2, 0, 0, 2, -left * 2, -top * 2);
  ink.save(); outlinePath(ink, outline); ink.clip();
  ink.fillStyle = 'rgba(38,38,38,0.16)'; ink.fillRect(left, top, width, height);
  ink.lineCap = ink.lineJoin = 'round'; ink.lineWidth = stroke.width * 0.8;
  const points = stroke.samples;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.x === b.x && a.y === b.y) continue;
    const opacity = (p) => 0.1 + 0.45 * Math.pow(p, 0.65);
    const gradient = ink.createLinearGradient(a.x, a.y, b.x, b.y);
    gradient.addColorStop(0, `rgba(38,38,38,${opacity(a.p)})`);
    gradient.addColorStop(1, `rgba(38,38,38,${opacity(b.p)})`);
    ink.strokeStyle = gradient; ink.beginPath(); ink.moveTo(a.x, a.y); ink.lineTo(b.x, b.y); ink.stroke();
  }
  if (points.length === 1) { ink.fillStyle = `rgba(38,38,38,${0.1 + points[0].p * 0.5})`; ink.fillRect(left, top, width, height); }
  ink.restore(); ink.globalCompositeOperation = 'destination-in';
  ink.fillStyle = ink.createPattern(pencilTexture(paper), 'repeat'); ink.fillRect(left, top, width, height);
  ctx.drawImage(layer, left, top, width, height);
}

export function drawInk(ctx, stroke, complete = true, mode = stroke.mode) {
  const outline = inkOutline(stroke, complete, mode);
  if (!outline.length) return;
  if (mode === 'pencil') { drawPencil(ctx, stroke, outline); return; }
  ctx.fillStyle = '#202020'; outlinePath(ctx, outline); ctx.fill();
}

export function readInkDraft(value) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 2000) return [];
    return parsed.filter((stroke) => Object.hasOwn(INK_MODES, stroke?.mode) && Number.isFinite(stroke.width) && stroke.width >= 1 && stroke.width <= 40 && Array.isArray(stroke.samples) && stroke.samples.length > 0 && stroke.samples.length <= 12000 && stroke.samples.every((s, index) => Number.isFinite(s.x) && s.x >= 0 && s.x <= INK_WIDTH && Number.isFinite(s.y) && s.y >= 0 && s.y <= INK_HEIGHT && Number.isFinite(s.p) && s.p >= 0 && s.p <= 1 && Number.isFinite(s.t) && (index === 0 || s.t >= stroke.samples[index - 1].t)));
  } catch { return []; }
}
