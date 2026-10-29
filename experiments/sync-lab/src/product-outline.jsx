import { useEffect, useState, useSyncExternalStore } from 'react';
import Outliner, { OutlineDataProvider } from '../../../src/Outliner.jsx';
import { sessions, supabase } from './session-client.js';
import { sessionDocument } from './session-document.js';
import { loroSupabaseTransport } from './loro-supabase-transport.js';
import { exclusiveDocument } from './exclusive-document.js';

// 製品の編集画面は再利用し、旧同期Providerを同時に起動しない。旧ローカル保存名にも書かない。
export function ProductOutline() {
  const session = useSyncExternalStore(sessions.subscribe, sessions.snapshot), ownerId = session?.user?.id;
  const [current, setCurrent] = useState(null), [error, setError] = useState('');
  const [view, setView] = useState({ fontSize: 14, align: 'left', typewriter: false, immersive: false, anchor: 0.6 });
  useEffect(() => {
    if (!ownerId) return;
    let live = true, engine;
    const publish = () => { if (live && engine) setCurrent({ ownerId, engine, nodes: engine.outline(), queued: engine.queued(), ...engine.connectionState() }); };
    const record = sessionDocument({ sessions, ownerId, docId: window.labAuthConfig.docId,
      transport: loroSupabaseTransport(supabase, { refreshSession: () => sessions.token(ownerId, { refresh: true }) }),
      createDocument: exclusiveDocument,
      onChange: publish, onError: (value) => { if (live) setError(value.message); },
    });
    record.ready.then((value) => { engine = value; if (live) { window.lab = engine; publish(); } }).catch((value) => { if (live) setError(value.message); });
    return () => { live = false; delete window.lab; record.dispose().catch(() => {}); };
  }, [ownerId]);
  const active = current?.ownerId === ownerId ? current : null;
  if (!active) return <p data-outline-connecting>保存済みのアウトラインを開いています…<span data-error>{error}</span></p>;
  const engine = active.engine;
  const unsupported = async () => ({ ok: false, why: 'この検証画面では旧同期の置換操作は使いません' });
  const value = { nodes: active.nodes, setNodes: (makeNext) => engine.changeOutline(makeNext), view, setView: (patch) => setView((before) => ({ ...before, ...patch })),
    owner: 'active', link: 'on', contentReady: active.ready, syncStatus: active.queued ? 'waiting' : active.connected ? 'synced' : 'checking', syncedAt: null,
    localSave: { status: error ? 'error' : 'saved', busy: false, large: false, hidden: true },
    syncNote: '', historyNote: '', dismissHistoryNote() {}, dismissSync() {}, dismissLocalInfo() {},
    undo: () => engine.undo(), redo: () => engine.redo(), canUndo: engine.canUndo(), canRedo: engine.canRedo(),
    retryLocalSave: () => engine.localBarrier(), refresh: () => engine.connect(),
    resetSync: unsupported, pullRemote: unsupported, clearRemote: unsupported,
    backupState: { status: 'idle' }, createBackup: unsupported, getLocalCheckpoint: () => null,
  };
  return <main data-product-outline style={{ background: '#181818', color: '#ddd', minHeight: '100vh', padding: 16 }}>
    <button data-session-signout onClick={() => supabase.auth.signOut({ scope: 'local' })}>ログアウト</button>
    <p data-error>{error}</p><OutlineDataProvider value={value}><Outliner /></OutlineDataProvider>
  </main>;
}
