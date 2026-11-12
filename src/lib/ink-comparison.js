import { getStroke } from 'perfect-freehand';

export const INK_MODES = { speed: 'Concepts風・速度ペン', pencil: 'Goodnotes風・鉛筆', pressure: '実筆圧ペン', fixed: '一定幅ペン' };
export const INK_DEFAULTS = { thinning: 0.6, response: 16, responseThin: 16, responseThick: 16, streamline: 0.15 };
export const INK_ORGANIC = { ...INK_DEFAULTS, streamline: 0.03, smoothing: 0.35, thinning: 0.5, responseThin: 24, responseThick: 12, minPressure: 0.3 };
export const INK_LOCAL_RETURN = { ...INK_DEFAULTS, streamline: 0.04, smoothing: 0.45, responseThin: 12, responseThick: 24, minPressure: 0.2, localReturn: 0.14 };
export const INK_CURVE_RETURN = { ...INK_LOCAL_RETURN, localReturn: 0.12, curveReturn: 0.055, widthResponse: 10 };
export function inkSettings(settings = {}) {
  const limit = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const response = limit(settings?.response, 4, 64, 16);
  return { curveReturn: limit(settings?.curveReturn, 0, 0.15, 0), widthResponse: limit(settings?.widthResponse, 0, 32, 0), localReturn: limit(settings?.localReturn, 0, 0.25, 0), smoothing: limit(settings?.smoothing, 0, 1, 0.45), minPressure: limit(settings?.minPressure, 0.1, 0.5, 0.2), responseThin: limit(settings?.responseThin, 4, 64, response), responseThick: limit(settings?.responseThick, 4, 64, response), thinning: limit(settings?.thinning, 0, 0.9, 0.6), response: limit(settings?.response, 4, 64, 16), streamline: limit(settings?.streamline, 0, 0.6, 0.15) };
}
export const INK_WIDTH = 600;
export const INK_HEIGHT = 400;

// 時刻を使って速度を求め、イベントの届く頻度だけで太さが変わるのを避ける。
export function inkPoints(samples, mode, settings) {
  const { responseThin, responseThick, minPressure, localReturn, curveReturn, widthResponse } = inkSettings(settings);
  let speed = 0.5, returnPressure = 0, filteredPressure = null;
  return samples.map((sample, index) => {
    if (index) {
      const previous = samples[index - 1];
      const elapsed = sample.t - previous.t;
      if (elapsed > 0) {
        const measured = Math.min(4, Math.hypot(sample.x - previous.x, sample.y - previous.y) / elapsed);
        // 加速で細くなる側と減速で太くなる側を分ける。旧設定は両方へ同じ値を使う。
        // 減速中だけ短い余韻を付け、速い区間の最低幅は上げない。静止点へ追加の丸は描かない。
        const moving = sample.x !== previous.x || sample.y !== previous.y;
        let bend = 0;
        if (curveReturn && index > 1) {
          const before = samples[index - 2], ax = previous.x - before.x, ay = previous.y - before.y;
          const bx = sample.x - previous.x, by = sample.y - previous.y;
          const lengthA = Math.hypot(ax, ay), lengthB = Math.hypot(bx, by);
          // 小さな入力の揺れを過大評価せず、曲がりの周辺だけ厚みへ反映する。座標は補正しない。
          if (lengthA > 0.5 && lengthB > 0.5) {
            const angle = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (lengthA * lengthB))));
            bend = curveReturn * Math.min(1, angle / elapsed * 40) * Math.min(1, measured / 0.15);
          }
        }
        const target = moving ? bend + localReturn * Math.max(0, (speed - measured) / Math.max(0.3, speed)) : 0;
        returnPressure += (target - returnPressure) * (1 - Math.exp(-elapsed / (target > returnPressure ? 12 : 32)));
        const response = measured > speed ? responseThin : responseThick;
        speed += (measured - speed) * (1 - Math.exp(-elapsed / response));
      }
    }
    let pressure = mode === 'speed' ? Math.min(0.9, minPressure + (0.85 - minPressure) / (1 + speed / 0.45) + returnPressure) : sample.p;
    if (mode === 'speed' && widthResponse > 0) {
      const elapsed = index ? Math.max(0, sample.t - samples[index - 1].t) : 0;
      filteredPressure = filteredPressure === null ? pressure : filteredPressure + (pressure - filteredPressure) * (1 - Math.exp(-elapsed / widthResponse));
      pressure = filteredPressure;
    }
    return [sample.x, sample.y, pressure];
  });
}

export function inkOutline(stroke, complete = true, mode = stroke.mode) {
  const settings = inkSettings(stroke.settings);
  return getStroke(inkPoints(stroke.samples, mode, settings), {
    size: stroke.width * (mode === 'pencil' ? 0.55 : 1), thinning: mode === 'fixed' ? 0 : mode === 'pencil' ? 0.15 : settings.thinning,
    smoothing: settings.smoothing, streamline: settings.streamline, simulatePressure: false,
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
