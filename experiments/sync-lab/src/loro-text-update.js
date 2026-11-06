const insideSurrogate = (text, index) => index > 0 && index < text.length
  && text.charCodeAt(index - 1) >= 0xd800 && text.charCodeAt(index - 1) <= 0xdbff
  && text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;

// textareaの長い置換を全文Myers diffへ渡すと、入力だけで長時間止まり得る。
// 前後の同じ範囲を保ち、変更した連続範囲だけを既存のTextへ直接適用する。
export function updateOutlineText(text, next) {
  const before = text.toString();
  if (before === next) return;
  if (!before.length) { text.insert(0, next); return; }
  if (!next.length) { text.delete(0, before.length); return; }
  if (before.length + next.length <= 8192) { text.update(next); return; }
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < next.length && before.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (insideSurrogate(before, prefix) || insideSurrogate(next, prefix)) prefix--;
  while (suffix < before.length - prefix && suffix < next.length - prefix
    && before.charCodeAt(before.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)) suffix++;
  if (insideSurrogate(before, before.length - suffix) || insideSurrogate(next, next.length - suffix)) suffix--;
  const removed = before.length - prefix - suffix, inserted = next.slice(prefix, next.length - suffix), delta = [];
  if (prefix) delta.push({ retain: prefix });
  if (removed) delta.push({ delete: removed });
  if (inserted) delta.push({ insert: inserted });
  text.applyDelta(delta);
}
