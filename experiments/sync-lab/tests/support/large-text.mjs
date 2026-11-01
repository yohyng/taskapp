// 圧縮しやすい同じ文字の繰り返しを避け、実際に送信上限を超える日本語と絵文字を作る。
export function largeText(count = 90000) {
  return Array.from({ length: count }, (_, i) => String.fromCodePoint(0x4e00 + i * 7639 % 20000) + (i % 29 === 0 ? '📝か\u3099' : '')).join('');
}
