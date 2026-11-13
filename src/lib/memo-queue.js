// 手書きだけのページから、アプリ本体へメモを渡すための受け渡し台。
// 手書きのページにはアウトラインを載せない（載せると、またそれが画面を止める）。
// 置き場へ上げ終えた画像の URL だけをここへ積み、アプリが開いたときに木へ入れる。

export const MEMO_QUEUE_KEY = "taskspace-memo-queue-v1";

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(MEMO_QUEUE_KEY) || "[]");
    return Array.isArray(list) ? list.filter((item) => item && typeof item.image === "string" && item.image) : [];
  } catch { return []; }
}

function write(list) {
  try {
    if (list.length) localStorage.setItem(MEMO_QUEUE_KEY, JSON.stringify(list));
    else localStorage.removeItem(MEMO_QUEUE_KEY);
    return true;
  } catch { return false; }
}

export function queuedMemos() { return read(); }

// 追加待ちに積む。画像は置き場へ上げ終えたものだけを入れる。
export function queueMemo({ image, text = "", date }) {
  if (!image) return false;
  const at = new Date();
  const label = date || `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return write([...read(), { id: `memo-${at.getTime()}-${Math.random().toString(36).slice(2, 8)}`, image, text, date: label, at: at.toISOString() }].slice(-200));
}

// アプリ側が木へ入れるときに呼ぶ。
// 入れられたものだけを取り除き、残りは次の機会まで預かる（取りこぼさない）。
export function drainMemos(put) {
  const list = read();
  if (!list.length) return 0;
  const left = [];
  let done = 0;
  for (const item of list) {
    let ok;
    try { ok = put(item) !== false; } catch { ok = false; }
    if (ok) done += 1; else left.push(item);
  }
  write(left);
  return done;
}
