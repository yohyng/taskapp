import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { LoroDoc } from 'loro-crdt';
import { updateOutlineText } from '../src/loro-text-update.js';

test('長文の入力：1MiB超の置換を5秒以内に確定し、Undo・Redoも元の本文へ戻る', async () => {
  // 同期WASMの停滞も止められるよう別スレッドで検査し、単体試験全体を巻き込まない。
  const worker = new Worker(new URL('../tests/support/large-outline-worker.mjs', import.meta.url));
  let timer, stage = '初期化';
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`長文の入力が5秒以内に完了しません：${stage}`)), 5000);
      worker.on('message', (message) => {
        if (!message.stage) { resolve(message); return; }
        stage = message.stage;
        // 巨大な履歴のUndo/RedoはLoro側にも数秒の負荷が残る。入力の5秒制限と
        // 同一視せず、こちらは処理が終了して元へ戻ることを有限の待機で検査する。
        if (['Undo', 'Redo'].includes(stage)) {
          clearTimeout(timer); timer = setTimeout(() => reject(new Error(`長文の履歴操作が15秒以内に完了しません：${stage}`)), 15000);
        }
      }); worker.once('error', reject);
    });
    assert.deepEqual(result, { pasted: true, undone: true, redone: true });
  } finally { clearTimeout(timer); await worker.terminate(); }
});

test('長文の入力：絵文字の途中で分割せず、変わらない前後のカーソルと本文を保つ', () => {
  const doc = new LoroDoc(), text = doc.getText('text'), prefix = '同じ前半'.repeat(2000), suffix = '同じ後半'.repeat(2000);
  try {
    const before = prefix + '🙂前の文章' + suffix, next = prefix + '📝新しい文章' + suffix;
    text.insert(0, before); doc.commit(); const cursor = text.getCursor(5);
    updateOutlineText(text, next); doc.commit(); assert.equal(text.toString(), next); assert.equal(doc.getCursorPos(cursor).offset, 5);
    updateOutlineText(text, next.slice(0, -4)); doc.commit(); assert.equal(text.toString(), next.slice(0, -4));
    updateOutlineText(text, ''); doc.commit(); assert.equal(text.toString(), '');
    updateOutlineText(text, next); doc.commit(); assert.equal(text.toString(), next);
  } finally { doc.free(); }
});
