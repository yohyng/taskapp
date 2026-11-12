import { drawInk, INK_EXTREME_RETURN } from "./ink-comparison";
export const SKETCH_WIDTH = 600;
export const SKETCH_HEIGHT = 360;
export const SKETCH_DRAFT_KEY = "taskspace-quick-sketch-v1";

export function readSketchDraft() {
  try {
    const strokes = JSON.parse(localStorage.getItem(SKETCH_DRAFT_KEY) || "[]");
    if (!Array.isArray(strokes)) return [];
    return strokes.filter((stroke) => (stroke?.brush === undefined || (stroke.brush === "speed-extreme-v1" && Array.isArray(stroke.times) && stroke.times.length === stroke.points?.length && stroke.times.every((t, i) => Number.isFinite(t) && t >= 0 && (!i || t >= stroke.times[i - 1])))) && (stroke?.paperWidth === undefined || (Number.isFinite(stroke.paperWidth) && stroke.paperWidth >= 600 && stroke.paperWidth <= 1200)) && /^#[0-9a-f]{6}$/i.test(stroke?.color) && (stroke.height === undefined || (Number.isFinite(stroke.height) && stroke.height >= 1 && stroke.height <= SKETCH_WIDTH * 2)) && Number.isFinite(stroke.width) && stroke.width > 0 && stroke.width <= 20 && Array.isArray(stroke.points) && stroke.points.length && stroke.points.every((point) => Array.isArray(point) && (point.length === 2 || point.length === 3) && point.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)));
  } catch { return []; }
}

// 入力の全点は保存し、長い線の表示用だけを制限する。末尾は密に残してペン先を追う。
export function sketchPreviewStroke(stroke, limit = 512) {
  if (!stroke.brush || stroke.points.length <= limit) return stroke;
  const tail = Math.min(128, Math.floor(limit / 2)), head = limit - tail;
  const end = stroke.points.length - tail;
  const indexes = Array.from({ length: head }, (_, i) => Math.floor(i * end / head));
  for (let i = end; i < stroke.points.length; i++) indexes.push(i);
  return { ...stroke, points: indexes.map(i => stroke.points[i]), times: indexes.map(i => stroke.times[i]) };
}

// 移動中は新しく届いた線だけを描き、過去の全ストロークを走査しない。
export function appendSketch(canvas, stroke, from = 0, complete = true, surfaceWidth = SKETCH_WIDTH) {
  const ctx = canvas.getContext("2d");
  if (stroke.brush === "speed-extreme-v1") {
    ctx.save();
    const scale = canvas.width / surfaceWidth;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawInk(ctx, { mode: "speed", width: stroke.width, color: stroke.color, settings: INK_EXTREME_RETURN, samples: stroke.points.map((point, i) => ({ x: point[0] * (stroke.paperWidth || SKETCH_WIDTH), y: point[1] * (stroke.height || SKETCH_HEIGHT), p: 0.5, t: stroke.times[i] })) }, complete);
    ctx.restore(); return;
  }
  const scale = canvas.width / surfaceWidth;
  // 縦に紙を足しても、それまでの線を引き伸ばさない。
  const height = (stroke.height || SKETCH_HEIGHT) * scale;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  const size = (a, b = a) => stroke.width * scale * (stroke.pressure ? 0.55 + 0.9 * (((a[2] ?? 0.5) + (b[2] ?? 0.5)) / 2) : 1);
  if (from === 0 && stroke.points.length) {
    const a = stroke.points[0];
    ctx.beginPath();
    ctx.arc(a[0] * (stroke.paperWidth || SKETCH_WIDTH) * scale, a[1] * height, size(a) / 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i];
    ctx.lineWidth = size(a, b);
    ctx.beginPath();
    ctx.moveTo(a[0] * (stroke.paperWidth || SKETCH_WIDTH) * scale, a[1] * height);
    ctx.lineTo(b[0] * (stroke.paperWidth || SKETCH_WIDTH) * scale, b[1] * height);
    ctx.stroke();
  }
}

export function paintSketch(canvas, strokes, surfaceWidth = SKETCH_WIDTH) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) appendSketch(canvas, stroke, 0, true, surfaceWidth);
}

export async function sketchFile(strokes) {
  const canvas = document.createElement("canvas");
  const paperWidth = strokes.reduce((maximum, stroke) => Math.max(maximum, stroke.paperWidth || SKETCH_WIDTH), SKETCH_WIDTH);
  canvas.width = paperWidth * 2;
  canvas.height = Math.ceil(strokes.reduce((height, stroke) => Math.max(height, stroke.height || SKETCH_HEIGHT), SKETCH_HEIGHT) * 2);
  paintSketch(canvas, strokes, paperWidth);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("画像を作れませんでした");
  return new File([blob], "手書き.png", { type: "image/png" });
}

// 紙の端だけを動かし、線の座標・太さ・入力時刻は同じ実寸で残す。
export function expandSketchPaper(paper, edge, distance) {
  const horizontal = edge === "left" || edge === "right";
  const key = horizontal ? "width" : "height";
  const amount = Math.round(Math.min(1200 - paper[key], Math.max(0, distance)));
  return { ...paper, [key]: paper[key] + amount, shiftX: edge === "left" ? amount : 0, shiftY: edge === "top" ? amount : 0 };
}
export function fitSketchToPaper(strokes, paper) {
  return strokes.map(stroke => ({ ...stroke, paperWidth: paper.width, height: paper.height,
    points: stroke.points.map(point => [(point[0] * (stroke.paperWidth || SKETCH_WIDTH) + (paper.shiftX || 0)) / paper.width,
      (point[1] * (stroke.height || SKETCH_HEIGHT) + (paper.shiftY || 0)) / paper.height, ...point.slice(2)]) }));
}
