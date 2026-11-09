export const SKETCH_WIDTH = 600;
export const SKETCH_HEIGHT = 360;
export const SKETCH_DRAFT_KEY = "taskspace-quick-sketch-v1";

export function readSketchDraft(key = SKETCH_DRAFT_KEY) {
  try {
    const strokes = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(strokes)) return [];
    return strokes.filter((stroke) => /^#[0-9a-f]{6}$/i.test(stroke?.color) && (stroke.height === undefined || (Number.isFinite(stroke.height) && stroke.height >= 1 && stroke.height <= SKETCH_WIDTH * 2)) && (stroke.pressureStyle === undefined || ["light", "core", "flow"].includes(stroke.pressureStyle)) && Number.isFinite(stroke.width) && stroke.width > 0 && stroke.width <= 20 && Array.isArray(stroke.points) && stroke.points.length && stroke.points.every((point) => Array.isArray(point) && (point.length === 2 || point.length === 3) && point.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)));
  } catch { return []; }
}

// 移動中は新しく届いた線だけを描き、過去の全ストロークを走査しない。
export function appendSketch(canvas, stroke, from = 0) {
  const ctx = canvas.getContext("2d");
  const scale = canvas.width / SKETCH_WIDTH;
  // 縦に紙を足しても、それまでの線を引き伸ばさない。
  const height = (stroke.height || SKETCH_HEIGHT) * scale;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  const size = (a, b = a) => {
    const pressure = ((a[2] ?? 0.5) + (b[2] ?? 0.5)) / 2;
    // 軽い筆圧を拾いつつ、弱く入れた線と強く入れた線の差を広げる。線ごとに設定を残す。
    if (!stroke.pressure) return stroke.width * scale;
    const response = ["core", "flow"].includes(stroke.pressureStyle)
      ? 1.1 + 0.25 * (1 - Math.exp(-pressure / 0.06)) + 0.35 * Math.pow(Math.max(0, (pressure - 0.55) / 0.45), 1.2)
      : stroke.pressureStyle === "light" ? 0.32 + 1.8 * Math.sqrt(pressure) : 0.55 + 0.9 * pressure;
    return stroke.width * scale * response;
  };
  if (from === 0 && stroke.points.length) {
    const a = stroke.points[0];
    ctx.beginPath();
    ctx.arc(a[0] * canvas.width, a[1] * height, size(a) / 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i];
    if (stroke.pressureStyle === "flow") {
      // 線分ごとの一定幅を重ねず、両端の太さを連続して結んで段差をなくす。
      const ax = a[0] * canvas.width, ay = a[1] * height;
      const bx = b[0] * canvas.width, by = b[1] * height;
      const distance = Math.hypot(bx - ax, by - ay);
      if (!distance) continue;
      const nx = -(by - ay) / distance, ny = (bx - ax) / distance;
      const ra = size(a) / 2, rb = size(b) / 2;
      ctx.beginPath();
      ctx.moveTo(ax + nx * ra, ay + ny * ra);
      ctx.lineTo(bx + nx * rb, by + ny * rb);
      ctx.lineTo(bx - nx * rb, by - ny * rb);
      ctx.lineTo(ax - nx * ra, ay - ny * ra);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(bx, by, rb, 0, 2 * Math.PI); ctx.fill();
      continue;
    }
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
