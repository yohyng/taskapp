import { useEffect, useState, useSyncExternalStore } from 'react';
import Outliner, { OutlineDataProvider } from '../../../src/Outliner.jsx';
import { sessions, supabase, connection } from './session-client.js';
import { sessionDocument } from './session-document.js';
import { loroSupabaseTransport } from './loro-supabase-transport.js';
import { exclusiveDocument } from './exclusive-document.js';
import { prepareCutover, fetchCutoverRoute, retryCutover } from './cutover-startup.js';
import { outlineBackup } from './outline-backup.js';
import { restoreOutlineBackup } from './restore-outline-backup.js';

// 製品の編集画面は再利用し、旧同期Providerを同時に起動しない。旧ローカル保存名にも書かない。
export function ProductOutline() {
  const session = useSyncExternalStore(sessions.subscribe, sessions.snapshot), ownerId = session?.user?.id;
  const [current, setCurrent] = useState(null), [error, setError] = useState('');
  const [backupState, setBackupState] = useState(null);
  const [recovery, setRecovery] = useState(null), [recoveryNote, setRecoveryNote] = useState(null);
  const generation = recovery?.ownerId === ownerId ? recovery.id : null;
  const [view, setView] = useState({ fontSize: 14, align: 'left', typewriter: false, immersive: false, anchor: 0.6 });
  useEffect(() => {
    if (!ownerId) return;
    let live = true, engine, backup, recovered;
    const publish = () => { if (live && engine) setCurrent({ ownerId, generation, engine, backup, nodes: engine.outline(), queued: engine.queued(), ...engine.connectionState() }); };
    const refreshSession = () => sessions.token(ownerId, { refresh: true });
    const transport = loroSupabaseTransport(supabase, { refreshSession });
    const record = sessionDocument({ sessions, ownerId, docId: connection.docId, transport,
      createDocument: (options) => exclusiveDocument({ ...options, legacyLease: connection.cutover,
        beforeOpen: async () => {
          const activeOwner = () => options.signal.aborted ? null : sessions.snapshot()?.user?.id;
          if (connection.cutover) await retryCutover(() => prepareCutover({ ...options, ownerId, activeOwner,
            route: (signal) => fetchCutoverRoute(supabase, signal, refreshSession) }), options.signal);
          if (recovery?.ownerId === ownerId) {
            try { recovered = await restoreOutlineBackup({ ...options, ownerId, activeOwner, source: recovery.source }); }
            catch (value) {
              // 復元取引の中止で元の保存は残る。元の文書を開き直し、結果は復元操作の中へだけ出す。
              if (live) setRecoveryNote({ ownerId, text: `復元できませんでした：${value.message}` });
            }
          }
        } }),
      onChange: publish, onError: (value) => { if (live) setError(value.message); },
    });
    record.ready.then((value) => {
      engine = value;
      if (live) {
        backup = outlineBackup({ engine, ownerId, docId: connection.docId, activeOwner: () => live ? sessions.snapshot()?.user?.id : null,
          onState: (state) => { if (live) setBackupState({ ...state, engine }); } });
        backup.start(); window.lab = engine; publish();
        if (recovered) setRecoveryNote({ ownerId, text: recovered.applied ? '控えとこの端末の内容を合わせました' : 'この控えは復元済みです' });
      }
    }).catch((value) => { if (live) setError(value.message); });
    return () => { live = false; backup?.dispose(); delete window.lab; record.dispose().catch(() => {}); };
  }, [ownerId, recovery, generation]);
  const active = current?.ownerId === ownerId && current.generation === generation ? current : null;
  if (!active) return <p data-outline-connecting>保存済みのアウトラインを開いています…<span data-error>{error}</span></p>;
  const engine = active.engine;
  async function recover(file) {
    if (!file) return;
    try {
      const source = await file.text();
      if (sessions.snapshot()?.user?.id !== ownerId) return;
      // 保存できていない入力がある画面は閉じない。復元前の控えをDBだけから採ると、その入力を失う。
      await engine.localBarrier();
      if (sessions.snapshot()?.user?.id !== ownerId) return;
      setRecoveryNote({ ownerId, text: '控えを確認しています…' }); setRecovery({ ownerId, source, id: crypto.randomUUID() });
    } catch (value) { if (sessions.snapshot()?.user?.id === ownerId) setRecoveryNote({ ownerId, text: `復元を始められませんでした：${value.message}` }); }
  }
  const unsupported = async () => ({ ok: false, why: 'この検証画面では旧同期の置換操作は使いません' });
  const value = { nodes: active.nodes, setNodes: (makeNext) => engine.changeOutline(makeNext), view, setView: (patch) => setView((before) => ({ ...before, ...patch })),
    owner: 'active', link: 'on', contentReady: active.ready, syncStatus: active.queued ? 'waiting' : active.connected ? 'synced' : 'checking', syncedAt: null,
    localSave: { status: error ? 'error' : 'saved', busy: false, large: false, hidden: true },
    syncNote: '', historyNote: '', dismissHistoryNote() {}, dismissSync() {}, dismissLocalInfo() {},
    undo: () => engine.undo(), redo: () => engine.redo(), canUndo: engine.canUndo(), canRedo: engine.canRedo(),
    retryLocalSave: () => engine.localBarrier(), refresh: () => engine.connect(),
    resetSync: unsupported, pullRemote: unsupported, clearRemote: unsupported,
    backupState: backupState?.engine === engine ? backupState : { status: 'idle' }, createBackup: () => active.backup.run(), getLocalCheckpoint: () => null,
  };
  return <main data-product-outline style={{ background: '#181818', color: '#ddd', minHeight: '100vh', padding: 16 }}>
    <button data-session-signout onClick={() => supabase.auth.signOut({ scope: 'local' })}>ログアウト</button>
    <details data-outline-recovery>
      <summary>控えからアウトラインを復元</summary>
      <p>いまある内容も残して、選んだ控えと合わせます。</p>
      <input data-outline-recovery-file type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; recover(file); }} />
      <p data-outline-recovery-state role="status">{recoveryNote?.ownerId === ownerId ? recoveryNote.text : ''}</p>
    </details>
    <p data-error>{error}</p><OutlineDataProvider value={value}><Outliner /></OutlineDataProvider>
  </main>;
}
