import { drawInk, INK_EXTREME_RETURN } from "./ink-comparison";
export const SKETCH_WIDTH = 600;
export const SKETCH_HEIGHT = 360;
export const SKETCH_DRAFT_KEY = "taskspace-quick-sketch-v1";

export function readSketchDraft() {
  try {
    const strokes = JSON.parse(localStorage.getItem(SKETCH_DRAFT_KEY) || "[]");
    if (!Array.isArray(strokes)) return [];
    return strokes.filter((stroke) => (stroke?.brush === undefined || (stroke.brush === "speed-extreme-v1" && Array.isArray(stroke.times) && stroke.times.length === stroke.points?.length && stroke.times.every((t, i) => Number.isFinite(t) && t >= 0 && (!i || t >= stroke.times[i - 1])))) && /^#[0-9a-f]{6}$/i.test(stroke?.color) && (stroke.height === undefined || (Number.isFinite(stroke.height) && stroke.height >= 1 && stroke.height <= SKETCH_WIDTH * 2)) && Number.isFinite(stroke.width) && stroke.width > 0 && stroke.width <= 20 && Array.isArray(stroke.points) && stroke.points.length && stroke.points.every((point) => Array.isArray(point) && (point.length === 2 || point.length === 3) && point.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)));
  } catch { return []; }
}

// 移動中は新しく届いた線だけを描き、過去の全ストロークを走査しない。
export function appendSketch(canvas, stroke, from = 0, complete = true) {
  const ctx = canvas.getContext("2d");
  if (stroke.brush === "speed-extreme-v1") {
    ctx.save();
    const scale = canvas.width / SKETCH_WIDTH;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawInk(ctx, { mode: "speed", width: stroke.width, color: stroke.color, settings: INK_EXTREME_RETURN, samples: stroke.points.map((point, i) => ({ x: point[0] * SKETCH_WIDTH, y: point[1] * (stroke.height || SKETCH_HEIGHT), p: 0.5, t: stroke.times[i] })) }, complete);
    ctx.restore(); return;
  }
  const scale = canvas.width / SKETCH_WIDTH;
  // 縦に紙を足しても、それまでの線を引き伸ばさない。
  const height = (stroke.height || SKETCH_HEIGHT) * scale;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  const size = (a, b = a) => stroke.width * scale * (stroke.pressure ? 0.55 + 0.9 * (((a[2] ?? 0.5) + (b[2] ?? 0.5)) / 2) : 1);
  if (from === 0 && stroke.points.length) {
    const a = stroke.points[0];
    ctx.beginPath();
    ctx.arc(a[0] * canvas.width, a[1] * height, size(a) / 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i];
    ctx.lineWidth = size(a, b);
    ctx.beginPath();
    ctx.moveTo(a[0] * canvas.width, a[1] * height);
    ctx.lineTo(b[0] * canvas.width, b[1] * height);
    ctx.stroke();
  }
}

export function paintSketch(canvas, strokes) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) appendSketch(canvas, stroke);
}

export async function sketchFile(strokes) {
  const canvas = document.createElement("canvas");
  canvas.width = SKETCH_WIDTH * 2;
  canvas.height = Math.ceil(strokes.reduce((height, stroke) => Math.max(height, stroke.height || SKETCH_HEIGHT), SKETCH_HEIGHT) * 2);
  paintSketch(canvas, strokes);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("画像を作れませんでした");
  return new File([blob], "手書き.png", { type: "image/png" });
}
