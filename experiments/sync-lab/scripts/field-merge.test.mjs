import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFields, mergeObservedFields } from './field-merge.mjs';

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
test('DBの更新後も画面が古ければ、最新を見た編集として受け付けない', () => {
  assert.deepEqual(mergeObservedFields({ text: '受信済みの最新' }, { text: '古い画面から追記' }, { text: '受信済みの最新' }, JSON.stringify({ kind: 'text-input', base: '古い画面' })), {
    changes: {}, conflicts: [{ field: 'text', mine: '古い画面から追記', theirs: '受信済みの最新' }],
  });
});
test('画面が見ていた基準と一致する通常入力は反映できる', () => {
  assert.deepEqual(mergeObservedFields({ text: '元' }, { text: '元から追記' }, { text: '元' }, JSON.stringify({ kind: 'text-input', base: '元' })), { changes: { text: '元から追記' }, conflicts: [] });
});
test('壊れた本文基準を無視して、最新扱いへフォールバックしない', () => {
  assert.throws(() => mergeObservedFields({ text: '最新' }, { text: '手元' }, { text: '最新' }, '{'));
  assert.throws(() => mergeObservedFields({ text: '最新' }, { text: '手元' }, { text: '最新' }, JSON.stringify({ kind: 'text-input' })));
});
