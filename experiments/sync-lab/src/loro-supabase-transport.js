import { base64, decodeLogTransfer, logBatch } from './loro-log-transfer.js';
import { prepareLogEntry } from './loro-update-parts.js';

// Realtimeは再取得のきっかけ。通知を失っても定期取得と画面復帰で保存済みログへ追い付く。
export function loroSupabaseTransport(client, { refreshSession } = {}) {
  return {
    interval: 3000, batch: logBatch, decode: decodeLogTransfer, prepareEntry: prepareLogEntry,
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
    watch(docId, changed, { onReady } = {}) {
      let active = true;
      const wake = (event) => { if (active) changed(event); };
      const channel = client.channel(`outline-log:${docId}:${crypto.randomUUID()}`)
        // WebSocketの購読成立からDB配信の準備完了までの変更は、通知されないことがある。
        // 配信準備の通知でもDBを取り直し、その間の確定済み変更を拾う。
        .on('system', {}, (event) => {
          if (active && event.extension === 'postgres_changes' && event.status === 'ok') { wake(); onReady?.(); }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'taskspace_loro_documents', filter: `id=eq.${docId}` }, wake)
        .subscribe((status) => { if (status === 'SUBSCRIBED') wake(); });
      return () => { active = false; return client.removeChannel(channel); };
    },
  };
}
