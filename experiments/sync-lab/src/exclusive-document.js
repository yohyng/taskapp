import { createEngine } from './loro-engine.js';

// 同じ端末保存へ二つの編集文書を開かない。前の窓の保存・終了までロックを保つ。
export function exclusiveDocument(options) {
  if (!navigator.locks?.request) return Promise.reject(new Error('このブラウザーではタブ間保護を使えません'));
  let release;
  const closed = new Promise((resolve) => { release = resolve; });
  return new Promise((resolve, reject) => {
    navigator.locks.request(`taskspace-loro:${options.storageId}`, { signal: options.signal }, async () => {
      try {
        const open = async () => {
          await options.beforeOpen?.(options); options.signal?.throwIfAborted();
          const engine = await createEngine(options);
          resolve({ ...engine, async dispose() { try { await engine.dispose(); } finally { release(); } } });
          await closed;
        };
        // 旧タブの保存と終了を待ち、新画面の間も旧ローカルの書き手を再開させない。
        if (options.legacyLease) await navigator.locks.request('taskspace-outline-owner-v1', { signal: options.signal }, open);
        else await open();
      } catch (error) { reject(error); }
    }).catch(reject);
  });
}
