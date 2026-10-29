import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authSession } from '../src/auth-session.js';

const session = (id, access_token = '初回') => ({ user: { id }, access_token });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture(initial = session('本人')) {
  let listener, value = initial, refreshes = 0, refresh;
  const auth = {
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() { listener = () => assert.fail('解除後の呼出し'); } } } }; },
    getSession: async () => ({ data: { session: value } }),
    refreshSession: () => { refreshes++; return refresh.promise; },
  };
  return { auth, emit(event, next) { value = next; listener(event, next); }, refresh(gate) { refresh = gate; }, refreshes: () => refreshes };
}

test('セッション初期読込の返事より新しいログアウトを優先し、古い利用者へ戻さない', async () => {
  const gate = deferred(), f = fixture(); f.auth.getSession = () => gate.promise;
  const store = authSession(f.auth); await Promise.resolve();
  f.emit('SIGNED_OUT', null); gate.resolve({ data: { session: session('本人') } }); await store.ready;
  assert.equal(store.snapshot(), null); assert.equal(await store.token('本人'), null); store.close();
});

test('同じ所有者の更新要求を一つにまとめ、別利用者への切替後の遅い返事を採らない', async () => {
  const f = fixture(), store = authSession(f.auth); await store.ready;
  const gate = deferred(); f.refresh(gate);
  const a = store.token('本人', { refresh: true }), b = store.token('本人', { refresh: true });
  await Promise.resolve(); assert.equal(f.refreshes(), 1);
  f.emit('SIGNED_IN', session('別人', '別人の鍵'));
  gate.resolve({ data: { session: session('本人', '古い更新') } });
  assert.deepEqual(await Promise.all([a, b]), [null, null]); assert.equal(await store.token('別人'), '別人の鍵'); store.close();
});

test('トークン更新の通知を読み、ログアウト後の遅い更新通知から本人を復活させない', async () => {
  const f = fixture(), store = authSession(f.auth); await store.ready;
  f.emit('TOKEN_REFRESHED', session('本人', '新しい鍵')); assert.equal(await store.token('本人'), '新しい鍵');
  f.emit('SIGNED_OUT', null); f.emit('TOKEN_REFRESHED', session('本人', '遅れた鍵'));
  assert.equal(store.snapshot(), null); assert.equal(await store.token('本人'), null); store.close();
});

test('認証障害では本文用の所有者を消さず、閉じたセッションからトークンを渡さない', async () => {
  const f = fixture(), store = authSession(f.auth); await store.ready;
  const gate = deferred(); f.refresh(gate);
  const receiving = store.token('本人', { refresh: true });
  gate.resolve({ data: { session: null }, error: Object.assign(new Error('Auth停止'), { status: 503 }) });
  await assert.rejects(receiving, /Auth停止/); assert.equal(store.snapshot().user.id, '本人');
  store.close(); assert.equal(await store.token('本人'), null);
});

test('初期通知がログインやログアウトより遅れても、最新の利用者を上書きしない', async () => {
  const f = fixture(), store = authSession(f.auth); await store.ready;
  f.emit('SIGNED_IN', session('別人', '新しいログイン'));
  f.emit('INITIAL_SESSION', session('本人', '遅い初期値'));
  assert.equal(await store.token('別人'), '新しいログイン');
  f.emit('SIGNED_OUT', null); f.emit('INITIAL_SESSION', session('本人'));
  assert.equal(store.snapshot(), null); store.close();
});
