import { useEffect, useState, useSyncExternalStore } from 'react';
import { supabase, sessions } from './session-client.js';
import { sessionDocument } from './session-document.js';
import { createLoroEditor } from './loro-editor.js';

let generation = 0;
export function SessionOutline() {
  const session = useSyncExternalStore(sessions.subscribe, sessions.snapshot);
  const ownerId = session?.user?.id;
  const [view, setView] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    if (!ownerId) return;
    let live = true, latest;
    const record = sessionDocument({ sessions, ownerId, docId: window.labAuthConfig.docId, endpoint: '/lab/owner-loro',
      onChange: (state) => { latest = state; if (live) setView((before) => before?.ownerId === ownerId ? { ...before, state } : before); },
      onError: (error) => { if (live) setError(error.message); },
    });
    record.ready.then((engine) => {
      if (!live || sessions.snapshot()?.user?.id !== ownerId) return;
      window.lab = engine; window.labGeneration = ++generation;
      setView({ ownerId, engine, state: latest });
    }).catch((error) => { if (live) setError(error.message); });
    return () => { live = false; delete window.lab; record.dispose().catch(() => {}); };
  }, [ownerId]);
  const current = view?.ownerId === ownerId ? view : null;
  return <main data-session-owner={ownerId || ''}>
    <button data-session-signout onClick={() => supabase.auth.signOut({ scope: 'local' })}>ログアウト</button>
    <p data-error>{error}</p>
    <p data-session-status>{current?.state?.queued ? '端末に保存・送信待ち' : '未送信なし'}</p>
    {current && <Editor key={ownerId} engine={current.engine} />}
  </main>;
}
function Editor({ engine }) {
  useEffect(() => {
    const parent = document.querySelector('[data-session-editor]');
    if (!engine.snapshot().some((row) => row.id === 'row-0')) return;
    const editor = createLoroEditor({ parent, id: 'row-0', engine, onError: () => {} });
    return () => editor.destroy();
  }, [engine]);
  return <section data-session-editor />;
}
