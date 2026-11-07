export const SKETCH_WIDTH = 600;
export const SKETCH_HEIGHT = 360;
export const SKETCH_DRAFT_KEY = "taskspace-quick-sketch-v1";

export function readSketchDraft() {
  try {
    const strokes = JSON.parse(localStorage.getItem(SKETCH_DRAFT_KEY) || "[]");
    if (!Array.isArray(strokes)) return [];
    return strokes.filter((stroke) => /^#[0-9a-f]{6}$/i.test(stroke?.color) && Number.isFinite(stroke.width) && stroke.width > 0 && stroke.width <= 20 && Array.isArray(stroke.points) && stroke.points.length && stroke.points.every((point) => Array.isArray(point) && point.length === 2 && point.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)));
  } catch { return []; }
}

export function paintSketch(canvas, strokes) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = canvas.width / SKETCH_WIDTH;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.strokeStyle = ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width * scale;
    ctx.beginPath();
    stroke.points.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * canvas.width, y * canvas.height);
      else ctx.lineTo(x * canvas.width, y * canvas.height);
    });
    if (stroke.points.length > 1) ctx.stroke();
    else {
      const [x, y] = stroke.points[0];
      ctx.arc(x * canvas.width, y * canvas.height, ctx.lineWidth / 2, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

export async function sketchFile(strokes) {
  const canvas = document.createElement("canvas");
  canvas.width = SKETCH_WIDTH * 2;
  canvas.height = SKETCH_HEIGHT * 2;
  paintSketch(canvas, strokes);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("画像を作れませんでした");
  return new File([blob], "手書き.png", { type: "image/png" });
}
