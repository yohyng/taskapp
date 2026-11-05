import { productionProject, documentId, publicBrowserKey } from './staging-config.js';

// 通常ビルドを暗黙に切り替えない。切替を選んだビルドは、設定不足でも旧同期へ逃げない。
export function releaseConfig(env) {
  const url = `https://${productionProject}.supabase.co`;
  if (![url, `${url}/`].includes(env.VITE_SUPABASE_URL)) throw new Error('本番のSupabase接続先が必要です');
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!publicBrowserKey(key, productionProject)) throw new Error('本番の公開鍵が必要です（管理鍵は使用不可）');
  const docId = documentId(env.VITE_OUTLINE_DOCUMENT_ID);
  if (env.VITE_OUTLINE_CUTOVER !== '1') throw new Error('新同期の初回起動には旧書き込み停止の確認が必要です');
  return Object.freeze({ mode: 'production', reference: productionProject, url, key, docId, cutover: true });
}

export function sessionClientOptions(connection) {
  // 本体SDKと同じ既定値で、既存のログイン保存を直接読む。コピーやログアウトで移し替えない。
  if (connection.mode === 'production') return {};
  return { auth: { storageKey: `taskspace-lab-auth-${connection.reference || 'fixture'}-${connection.docId}`, detectSessionInUrl: false } };
}
