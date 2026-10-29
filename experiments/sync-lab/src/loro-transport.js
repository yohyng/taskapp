// 通信部品を替えても、認証の再取得で本文や送信待ちを初期化しない。
export function loroTransport({ endpoint = '/lab/loro', getAccessToken, fetchRequest = fetch } = {}) {
  async function send(path, options) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = new Headers(options.headers);
      if (getAccessToken) {
        const token = await getAccessToken({ refresh: attempt > 0 });
        if (!token) { const error = new Error('認証の再開待ち'); error.status = 401; throw error; }
        headers.set('Authorization', `Bearer ${token}`);
      }
      const timeout = AbortSignal.timeout(10000);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      const response = await fetchRequest(`${endpoint}${path}`, { ...options, headers, signal });
      if (response.status === 401 && getAccessToken && attempt === 0) continue;
      if (!response.ok) { const error = new Error('通信の再開待ち'); error.status = response.status; throw error; }
      return response.json();
    }
  }
  return {
    sync: (docId, value, signal) => send(`/sync?doc=${encodeURIComponent(docId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(value) }),
    serverState: (docId) => send(`/server-state?doc=${encodeURIComponent(docId)}`, { cache: 'no-store' }),
  };
}
