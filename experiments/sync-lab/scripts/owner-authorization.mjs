// JWTの復号結果や端末申告の利用者IDは信じない。署名・失効の判断は既存のAuthサービスに任せる。
// この検証では本番Authへ接続しない。接続先と所有者はサーバーの設定からだけ渡す。
export function ownerAuthorization({ authUrl, apiKey, ownerId, documents, allowLocalTestIssuer = false, fetchUser = fetch }) {
  const url = new URL(authUrl);
  const local = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLocalTestIssuer && local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error('認証先の設定が不正です');
  if (!apiKey || !ownerId || !Array.isArray(documents) || documents.length === 0) throw new Error('所有者と文書の設定が必要です');
  const allowed = new Set(documents);
  const endpoint = `${url.href.replace(/\/$/, '')}/user`;
  // キャッシュしない。失効・利用者切替を次の要求で検査する。定期ポーリングは製品へ持ち込まない。
  return async (request, docId) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(authorization)) return 401;
    let response;
    try {
      response = await fetchUser(endpoint, { headers: { Authorization: authorization, apikey: apiKey }, redirect: 'error', signal: AbortSignal.timeout(3000) });
      if ([401, 403].includes(response.status)) return 401;
      if (!response.ok) return 503;
      const user = await response.json();
      if (typeof user.id !== 'string') return 503;
      return user.id === ownerId && allowed.has(docId) ? 200 : 403;
    } catch { return 503; }
  };
}
