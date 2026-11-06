export const fields = ['text', 'favorite', 'completed'];

// 行全体の古い写しを採用せず、端末が実際に変えた列だけを比較する。
export function mergeFields(current, data, previous) {
  const changes = {}, conflicts = [];
  for (const [field, mine] of Object.entries(data)) {
    if (!fields.includes(field) || !Object.hasOwn(previous, field)) throw new Error('変更前の値がない更新です');
    if (field === 'text' ? typeof mine !== 'string' : ![0, 1].includes(mine)) throw new Error('値の型が不正です');
    const theirs = current[field];
    if (theirs === mine) continue;
    if (theirs === previous[field]) changes[field] = mine;
    else conflicts.push({ field, mine, theirs });
  }
  return { changes, conflicts };
}

// SQLiteが先に受信していても、編集画面が見ていた基準へ勝手に進めない。
export function mergeObservedFields(current, data, previous, metadata) {
  if (metadata == null) return mergeFields(current, data, previous);
  const observed = JSON.parse(metadata);
  if (observed.kind !== 'text-input' || typeof observed.base !== 'string' || !Object.hasOwn(data, 'text')) throw new Error('本文入力の基準が不正です');
  return mergeFields(current, data, { ...previous, text: observed.base });
}
