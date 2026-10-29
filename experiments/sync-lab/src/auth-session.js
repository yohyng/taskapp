// AuthGateと同じSDKのセッションを使う。ここで持つIDは保存領域を分けるためで、権限はサーバーが検査する。
export function authSession(auth) {
  let session = null, revision = 0, identity = 0, initialized = false, closed = false, refreshing;
  const listeners = new Set();
  const owner = () => session?.user?.id || null;
  function receive(event, next) {
    if (closed) return;
    if (initialized && event === 'INITIAL_SESSION') return;
    // 遅れた更新結果からログアウト済みのアカウントを復活させない。
    if (initialized && event === 'TOKEN_REFRESHED' && (next?.user?.id || null) !== owner()) return;
    revision++;
    if ((next?.user?.id || null) !== owner()) identity++;
    initialized = true; session = next;
    // この通知中はSDKのロック内。購読側もSDKへ再入せず、通信の再開は次のタスクで行う。
    for (const listener of listeners) listener(session, event);
  }
  const { data: { subscription } } = auth.onAuthStateChange(receive);
  const initialRevision = revision;
  const ready = Promise.resolve().then(() => auth.getSession()).then(({ data, error }) => {
    if (error) throw error;
    if (!closed && revision === initialRevision) receive('INITIAL_SESSION', data.session);
  });
  ready.catch(() => {});
  return {
    ready, snapshot: () => session,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async token(ownerId, { refresh = false } = {}) {
      await ready;
      if (closed || owner() !== ownerId) return null;
      const beforeIdentity = identity, beforeRevision = revision;
      if (refresh) {
        if (!refreshing || refreshing.identity !== identity) {
          const entry = { identity, promise: auth.refreshSession() }; refreshing = entry;
          entry.promise.finally(() => { if (refreshing === entry) refreshing = undefined; }).catch(() => {});
        }
        const { data, error } = await refreshing.promise;
        if (closed || identity !== beforeIdentity || owner() !== ownerId) return null;
        if (error) {
          if ([400, 401, 403].includes(error.status)) return null;
          throw error;
        }
        if (revision === beforeRevision) receive('TOKEN_REFRESHED', data.session);
      }
      return !closed && identity === beforeIdentity && owner() === ownerId ? session?.access_token || null : null;
    },
    close() { closed = true; subscription.unsubscribe(); listeners.clear(); session = null; },
  };
}
