export const productionProject = 'eiyzlawmcyybchxzyozr';
export function stagingProject(reference) {
  if (typeof reference !== 'string' || !/^[a-z0-9]{20}$/.test(reference) || reference === productionProject) {
    throw new Error('本番とは別の検証用Supabaseプロジェクト参照IDが必要です');
  }
  return `https://${reference}.supabase.co`;
}
export function documentId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('検証文書のUUIDが必要です');
  return value.toLowerCase();
}
export function stagingConfig(env) {
  const reference = env.LAB_SUPABASE_PROJECT_REF, url = stagingProject(reference), key = env.LAB_SUPABASE_PUBLISHABLE_KEY;
  // 管理鍵はブラウザーへ渡さない。JWTは公開anon鍵の形式確認だけで、署名を検証した扱いにはしない。
  let allowed = typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!allowed && typeof key === 'string') {
    try {
      const parts = key.split('.');
      const payload = JSON.parse(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/')));
      allowed = parts.length === 3 && payload.role === 'anon' && payload.ref === reference;
    } catch { /* 設定値を含む例外を画面・ログへ出さない。 */ }
  }
  if (!allowed) throw new Error('検証用のpublishable鍵または同じプロジェクトのanon鍵が必要です（管理鍵は使用不可）');
  return Object.freeze({ mode: 'staging', reference, url, key, docId: documentId(env.LAB_SUPABASE_DOCUMENT_ID) });
}
export function fixtureConfig(config, origin) {
  if (!config?.key || !config?.docId) throw new Error('認証検証の設定が必要です。実接続には検証用モードを使ってください');
  return { mode: 'fixture', url: origin, key: config.key, docId: config.docId };
}
