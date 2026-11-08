// 補正は待ち時間を足さず、届いた座標ごとに進める。距離は表示上のpxで扱う。
export function createSketchFilter(point, time, width, height) {
  return { point: [...point], raw: [...point], time, width, height };
}
export function filterSketchPoint(state, raw, time) {
  const elapsed = Math.max(1, Math.min(32, Number.isFinite(time - state.time) ? time - state.time : 8));
  const distance = Math.hypot((raw[0] - state.raw[0]) * state.width, (raw[1] - state.raw[1]) * state.height);
  const speed = distance / elapsed;
  const response = 14 / (1 + speed / 0.3);
  const amount = 1 - Math.exp(-elapsed / response);
  const next = raw.map((value, index) => index < 2 ? state.point[index] + (value - state.point[index]) * amount : value);
  // 大きい折り返しでもペン先との距離を広げすぎず、文字の角を残す。
  const lag = Math.hypot((raw[0] - next[0]) * state.width, (raw[1] - next[1]) * state.height);
  if (lag > 3) for (let index = 0; index < 2; index++) next[index] = raw[index] + (next[index] - raw[index]) * 3 / lag;
  state.point = next; state.raw = [...raw]; state.time = time;
  return next;
}
