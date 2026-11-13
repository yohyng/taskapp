// 手書きの遅れを、推測ではなく数で見るための記録係。
// 線の座標も本文も持たない。持つのは「いつ・どれだけかかったか」だけ。

// 直近だけを残す輪。長く測っても、ここが膨らんで遅くならないようにする。
export function ring(limit = 4000) {
  const items = [];
  return {
    push(value) { items.push(value); if (items.length > limit) items.shift(); },
    get list() { return items; },
    get length() { return items.length; },
    clear() { items.length = 0; },
  };
}

// 数の束を、見て分かる形にまとめる（平均・中央・上位・最大）。
export function summarize(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    mean: Math.round((sum / sorted.length) * 100) / 100,
    p50: Math.round(at(0.5) * 100) / 100,
    p95: Math.round(at(0.95) * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

// 「何ミリ秒より遅い回が何回あったか」。詰まりは平均に出ないので、ここで数える。
export function overCount(values, limit) {
  return values.reduce((count, value) => (value > limit ? count + 1 : count), 0);
}

// 端末の素性。名前を当てにいかず、見えている事実だけを書く。
export function deviceSummary() {
  return {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    screen: `${window.screen?.width ?? "?"}x${window.screen?.height ?? "?"}`,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: window.matchMedia?.("(display-mode: standalone)")?.matches ?? false,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    userAgent: navigator.userAgent,
  };
}
