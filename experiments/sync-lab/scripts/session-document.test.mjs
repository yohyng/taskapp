import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { sessionDocument } from '../src/session-document.js';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function sessions() {
  let owner = '本人', listener;
  return {
    snapshot: () => owner ? { user: { id: owner } } : null,
    token: async () => '鍵',
    subscribe(callback) { listener = callback; return () => { listener = null; }; },
    emit(event, id = owner) { owner = id; listener?.(owner ? { user: { id: owner } } : null, event); },
  };
}
function fixture(id) {
  const store = sessions(), events = new EventTarget(), visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const calls = [], engine = {
    connect: async () => { calls.push('接続'); }, disconnect: async () => { calls.push('切断'); }, dispose: async () => { calls.push('終了'); },
  };
  const options = { sessions: store, ownerId: '本人', docId: id, endpoint: '/owner', events, visibility, createDocument: async () => engine };
  return { store, events, calls, engine, options };
}

test('トークン更新の通知中は再接続せず、繰り返す通知は次のタスクで一回だけ接続する', async () => {
  const f = fixture('更新通知'), document = sessionDocument(f.options); await document.ready;
  f.store.emit('TOKEN_REFRESHED'); f.store.emit('SIGNED_IN'); f.store.emit('SIGNED_IN');
  assert.deepEqual(f.calls, []); await setTimeout(0); assert.deepEqual(f.calls, ['接続']);
  await document.dispose();
});

test('初回取得中にログアウトしたらその場で中止し、遅い表示や新しい送信を出さない', async () => {
  const f = fixture('遅い初回'), gate = deferred(), states = []; let creating;
  const document = sessionDocument({ ...f.options, onChange: (state) => states.push(state), createDocument: (options) => { creating = options; return gate.promise; } });
  await Promise.resolve(); f.store.emit('SIGNED_OUT', null);
  assert.equal(creating.signal.aborted, true); creating.onChange({ rows: ['前の利用者'] }); assert.deepEqual(states, []);
  gate.resolve(f.engine); await document.dispose(); assert.deepEqual(f.calls, ['切断', '終了']);
});

test('同じ利用者がすぐ戻っても、前の画面の保存と終了より先に文書を読み直さない', async () => {
  const f = fixture('再ログイン'), gate = deferred(); let starts = 0;
  f.engine.dispose = async () => { await gate.promise; };
  const first = sessionDocument({ ...f.options, createDocument: async () => { starts++; return f.engine; } }); await first.ready;
  const stopping = first.dispose();
  const second = sessionDocument({ ...f.options, createDocument: async () => { starts++; return { ...f.engine, dispose: async () => {} }; } });
  await Promise.resolve(); assert.equal(starts, 1);
  gate.resolve(); await stopping; await second.ready; assert.equal(starts, 2); await second.dispose();
});

test('offlineで止めた通信だけをonlineで再開し、終了後の通知から接続を復活させない', async () => {
  const f = fixture('通信復帰'), document = sessionDocument(f.options); await document.ready;
  f.events.dispatchEvent(new Event('offline')); assert.deepEqual(f.calls, ['切断']);
  f.events.dispatchEvent(new Event('online')); await setTimeout(0); assert.deepEqual(f.calls, ['切断', '接続']);
  await document.dispose(); f.events.dispatchEvent(new Event('online')); await setTimeout(0);
  assert.deepEqual(f.calls, ['切断', '接続', '終了']);
});
