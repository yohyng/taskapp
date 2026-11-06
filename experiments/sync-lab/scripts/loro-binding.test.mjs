import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoroDoc } from 'loro-crdt';
import { EditorState } from '@codemirror/state';
import { LoroSyncPlugin } from 'loro-codemirror';
import { finishLoroInitialization, scopedLoroSource } from '../src/loro-binding.js';

// DOMの代わりに実EditorStateの取引を使い、公式接続自身の入力・受信処理を動かす。
function editor(doc, text, adapted) {
  const source = adapted ? scopedLoroSource(doc, text, '入力') : doc;
  let plugin;
  const view = { state: EditorState.create({ doc: text.toString() }), dispatch(spec) {
    const transaction = this.state.update(spec); this.state = transaction.state;
    plugin.update({ docChanged: transaction.docChanged, transactions: [transaction], changes: transaction.changes });
  } };
  plugin = LoroSyncPlugin(source, () => text).create(view);
  if (adapted) finishLoroInitialization(view);
  return { view, close: () => plugin.destroy() };
}

test('公式接続0.3.3の初期化直後の直接更新の取りこぼしを再現し、空更新で初期化した場合は保存する', async () => {
  for (const adapted of [false, true]) {
    const doc = new LoroDoc(), text = doc.getText('text'); text.insert(0, '元'); doc.commit();
    const instance = editor(doc, text, adapted);
    try {
      await Promise.resolve();
      instance.view.dispatch({ changes: { from: 1, insert: '・追記' } });
      assert.equal(instance.view.state.doc.toString(), '元・追記');
      assert.equal(text.toString(), adapted ? '元・追記' : '元');
    } finally { instance.close(); doc.free(); }
  }
});

test('別行・属性を含む実際の受信は素の接続で取りこぼし、対象行に絞った接続では二行とも反映する', async () => {
  for (const adapted of [false, true]) {
    const doc = new LoroDoc(); doc.getText('a').insert(0, 'A'); doc.getText('b').insert(0, 'B'); doc.commit();
    const a = editor(doc, doc.getText('a'), adapted), b = editor(doc, doc.getText('b'), adapted), other = doc.fork();
    try {
      await Promise.resolve();
      // 初期化の問題と分け、全く別のイベントに出会った時の早期returnを確認する。
      a.view.dispatch({}); b.view.dispatch({});
      other.getMap('attrs').set('favorite', true); other.getText('a').insert(1, '追記'); other.getText('b').insert(1, '追記'); other.commit();
      doc.import(other.export({ mode: 'update' }));
      const actual = [a.view.state.doc.toString(), b.view.state.doc.toString()];
      if (adapted) assert.deepEqual(actual, ['A追記', 'B追記']);
      else assert.notDeepEqual(actual, ['A追記', 'B追記']);
    } finally { a.close(); b.close(); other.free(); doc.free(); }
  }
});
