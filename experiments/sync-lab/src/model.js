import * as Y from 'yjs';

// 初期データはサーバーで一度だけ作る。各端末で別々に作ると同じ内容が重複する。
export function fixtureDocument(count = 30) {
  const doc = new Y.Doc();
  doc.transact(() => {
    const rows = doc.getMap('rows');
    for (let i = 0; i < count; i++) {
      const row = new Y.Map();
      rows.set(`row-${i}`, row);
      row.set('text', new Y.Text(i === 0 ? '最初のメモ' : `検証用の行 ${i}`));
      row.set('parentId', i > 2 && i < 10 ? 'row-1' : null);
      row.set('order', i);
      row.set('favorite', false);
      row.set('completed', false);
    }
  });
  return doc;
}

export function snapshot(doc) {
  return [...doc.getMap('rows')].map(([id, row]) => ({
    id, text: row.get('text').toString(), parentId: row.get('parentId'), order: row.get('order'),
    favorite: row.get('favorite'), completed: row.get('completed'),
  })).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// 全文を削除・再挿入すると文字の意図を失うので、変わった一続きの範囲だけを操作する。
// IME中の他端末編集や複数範囲の置換は、この入口だけで完成したとは扱わない。
export function replaceText(doc, id, value, origin) {
  const text = doc.getMap('rows').get(id)?.get('text');
  if (!text) throw new Error('編集対象の行がありません');
  const before = text.toString();
  let start = 0, end = 0;
  while (start < before.length && start < value.length && before[start] === value[start]) start++;
  while (end < before.length - start && end < value.length - start
    && before[before.length - end - 1] === value[value.length - end - 1]) end++;
  doc.transact(() => {
    const removed = before.length - start - end;
    if (removed) text.delete(start, removed);
    const added = value.slice(start, value.length - end);
    if (added) text.insert(start, added);
  }, origin);
}
