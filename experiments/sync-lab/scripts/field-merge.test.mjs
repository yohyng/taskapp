import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFields } from './field-merge.mjs';

test('古い本文の編集で、別端末のお気に入りを巻き戻さない', () => {
  assert.deepEqual(mergeFields({ text: '元', favorite: 1 }, { text: '追記' }, { text: '元' }), {
    changes: { text: '追記' }, conflicts: [],
  });
});
test('同じ本文の相容れない変更は両方を残し、別の列は反映できる', () => {
  assert.deepEqual(mergeFields({ text: '別端末', favorite: 0 }, { text: '手元', favorite: 1 }, { text: '元', favorite: 0 }), {
    changes: { favorite: 1 }, conflicts: [{ field: 'text', mine: '手元', theirs: '別端末' }],
  });
});
test('同じ結果への再適用は変更を作らない', () => {
  assert.deepEqual(mergeFields({ text: '追記' }, { text: '追記' }, { text: '元' }), { changes: {}, conflicts: [] });
});
test('変更前の値を欠く書き込みや対象外の列を受け付けない', () => {
  assert.throws(() => mergeFields({ text: '最新' }, { text: '古い' }, {}));
  assert.throws(() => mergeFields({}, { revision: 0 }, { revision: 1 }));
});
