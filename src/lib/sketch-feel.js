// 補正は待ち時間を足さず、届いた座標ごとに進める。距離は表示上のpxで扱う。
export function createSketchFilter(point, time, width, height, feel = "soft") {
  return { point: [...point], raw: [...point], time, width, height, feel };
}
export function filterSketchPoint(state, raw, time) {
  const elapsed = Math.max(1, Math.min(32, Number.isFinite(time - state.time) ? time - state.time : 8));
  const distance = Math.hypot((raw[0] - state.raw[0]) * state.width, (raw[1] - state.raw[1]) * state.height);
  const speed = distance / elapsed;
  const light = ["light", "core", "flow"].includes(state.feel);
  const response = (light ? 4 : 14) / (1 + speed / (light ? 0.15 : 0.3));
  const amount = 1 - Math.exp(-elapsed / response);
  const next = raw.map((value, index) => index < 2 ? state.point[index] + (value - state.point[index]) * amount : value);
  if (state.feel === "flow" && raw.length > 2) next[2] = (state.point[2] ?? raw[2]) + (raw[2] - (state.point[2] ?? raw[2])) * (1 - Math.exp(-elapsed / 12));
  // 大きい折り返しでもペン先との距離を広げすぎず、文字の角を残す。
  const lag = Math.hypot((raw[0] - next[0]) * state.width, (raw[1] - next[1]) * state.height);
  const limit = light ? 1 : 3;
  if (lag > limit) for (let index = 0; index < 2; index++) next[index] = raw[index] + (next[index] - raw[index]) * limit / lag;
  state.point = next; state.raw = [...raw]; state.time = time;
  return next;
}
