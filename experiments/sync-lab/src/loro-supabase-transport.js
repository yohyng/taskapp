import { base64, decodeLogTransfer, logBatch } from './loro-log-transfer.js';

// Realtimeは再取得のきっかけ。通知を失っても定期取得と画面復帰で保存済みログへ追い付く。
export function loroSupabaseTransport(client, { refreshSession } = {}) {
  return {
    interval: 3000, batch: logBatch, decode: decodeLogTransfer,
    async sync(docId, _request, signal, { cursor, batch }) {
      for (let attempt = 0; attempt < 2; attempt++) {
        signal.throwIfAborted();
        const { data, error, status } = await client.rpc('taskspace_loro_exchange', {
          p_doc: docId, p_cursor: cursor,
          p_updates: batch.map((entry) => ({ id: entry.id, bytes: base64(entry.bytes) })),
        }).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(10000)]));
        if (!error) return data;
        // 通常の自動更新に加え、401を受けた一回だけ既存セッション管理へ更新を依頼する。
        if (status === 401 && attempt === 0 && refreshSession && await refreshSession()) continue;
        throw Object.assign(new Error('通信の再開待ち'), { status, cause: error });
      }
    },
    watch(docId, changed) {
      const channel = client.channel(`outline-log:${docId}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'taskspace_loro_documents', filter: `id=eq.${docId}` }, changed)
        .subscribe((status) => { if (status === 'SUBSCRIBED') changed(); });
      return () => { client.removeChannel(channel); };
    },
  };
}
