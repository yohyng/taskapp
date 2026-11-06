import { createEngine } from './loro-engine.js';
import { loroTransport } from './loro-transport.js';

const retiring = new Map();

// 一つの編集画面を一人の所有者へ固定する。トークン更新だけで本文・Undo・選択位置を作り直さない。
export function sessionDocument({ sessions, ownerId, docId, endpoint, transport, onChange, onError, createDocument = createEngine, events = window, visibility = document }) {
  if (!ownerId || sessions.snapshot()?.user?.id !== ownerId) throw new Error('ログインした利用者が必要です');
  const lifetime = new AbortController();
  const storageId = `owner:${ownerId}:${docId}`;
  let engine, timer, disposal, online = globalThis.navigator?.onLine !== false;
  const active = () => !lifetime.signal.aborted && sessions.snapshot()?.user?.id === ownerId;
  function resume() {
    clearTimeout(timer);
    if (!active() || !online) return;
    // onAuthStateChange内でSDKを呼ばない。microtaskではSDKのロック解放より先になる場合がある。
    timer = setTimeout(() => ready.then((value) => { if (active() && online) return value.connect(); }).catch((error) => { if (active()) onError?.(error); }), 0);
  }
  const unsubscribe = sessions.subscribe((session, event) => {
    if (session?.user?.id !== ownerId) { dispose().catch(() => {}); return; }
    if (['SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) resume();
  });
  const offline = () => { online = false; clearTimeout(timer); engine?.disconnect().catch(() => {}); };
  const connected = () => { online = true; resume(); };
  const visible = () => { if (visibility.visibilityState === 'visible') resume(); };
  events.addEventListener('offline', offline); events.addEventListener('online', connected);
  visibility.addEventListener('visibilitychange', visible);
  // 同じ利用者がすぐ戻っても、前の画面の保存・終了より先に古い写しを読まない。
  const ready = Promise.resolve(retiring.get(storageId)).then(() => createDocument({ docId, offline: !online, background: true, storageId, signal: lifetime.signal,
    transport: transport || loroTransport({ endpoint, getAccessToken: (options) => sessions.token(ownerId, options) }),
    onChange: (state) => { if (active()) onChange?.(state); },
    onError: (error) => { if (active()) onError?.(error); },
  })).then(async (value) => {
    engine = value;
    if (!active()) await value.disconnect();
    else if (!online) await value.disconnect();
    return value;
  });
  ready.catch(() => {});
  function dispose() {
    if (disposal) return disposal;
    lifetime.abort(); clearTimeout(timer); unsubscribe();
    events.removeEventListener('offline', offline); events.removeEventListener('online', connected);
    visibility.removeEventListener('visibilitychange', visible);
    disposal = ready.then((value) => value.dispose());
    const settled = disposal.catch(() => {}); retiring.set(storageId, settled);
    settled.then(() => { if (retiring.get(storageId) === settled) retiring.delete(storageId); });
    return disposal;
  }
  return { ready, dispose };
}
