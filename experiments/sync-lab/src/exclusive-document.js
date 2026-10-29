import { createEngine } from './loro-engine.js';

// 同じ端末保存へ二つの編集文書を開かない。前の窓の保存・終了までロックを保つ。
export function exclusiveDocument(options) {
  if (!navigator.locks?.request) return Promise.reject(new Error('このブラウザーではタブ間保護を使えません'));
  let release;
  const closed = new Promise((resolve) => { release = resolve; });
  return new Promise((resolve, reject) => {
    navigator.locks.request(`taskspace-loro:${options.storageId}`, { signal: options.signal }, async () => {
      try {
        const engine = await createEngine(options);
        resolve({ ...engine, async dispose() { try { await engine.dispose(); } finally { release(); } } });
        await closed;
      } catch (error) { reject(error); }
    }).catch(reject);
  });
}
