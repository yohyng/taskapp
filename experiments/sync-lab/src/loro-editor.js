import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { LoroSyncPlugin } from 'loro-codemirror';
import { finishLoroInitialization } from './loro-binding.js';

export function createLoroEditor({ parent, id, engine, onError }) {
  const binding = engine.loroBinding(id), raw = new URLSearchParams(location.search).get('binding') === 'raw';
  let view;
  const report = (action) => { try { action(); } catch (error) { onError(error); } return true; };
  const plugin = LoroSyncPlugin(raw ? binding.rawSource : binding.source, () => binding.text);
  view = new EditorView({ parent, doc: binding.text.toString(), extensions: [
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'data-editor-input': id, 'aria-label': `${id}の本文` }),
    EditorView.theme({ '&': { flex: '1', minWidth: '0', color: 'inherit' }, '.cm-content': { fontFamily: 'inherit', minHeight: '2.5em' } }),
    EditorState.transactionExtender.of((transaction) => {
      if (transaction.docChanged && !binding.receiving()) binding.remember(transaction.startState.selection.main.anchor, transaction.startState.selection.main.head);
      return null;
    }),
    plugin,
    keymap.of([
      { key: 'Mod-z', run: () => report(() => engine.undo()) },
      { key: 'Mod-Shift-z', run: () => report(() => engine.redo()) },
    ]),
  ] });
  const remove = binding.selection({
    focused: () => view.hasFocus,
    capture: () => binding.capture(view.state.selection.main.anchor, view.state.selection.main.head),
    restore(cursors) {
      requestAnimationFrame(() => {
        const anchor = binding.cursorPosition(cursors[0]), head = binding.cursorPosition(cursors[1]);
        if (anchor === undefined || head === undefined) return;
        view.dispatch({ selection: { anchor: Math.min(anchor, view.state.doc.length), head: Math.min(head, view.state.doc.length) } });
        view.focus();
      });
    },
  });
  // 0.3.3は初期値が同じ場合も初期化フラグを残す。最初の実入力を読み飛ばさないよう空の更新で完了する。
  if (!raw) finishLoroInitialization(view);
  return { update() {}, text: () => view.state.doc.toString(), destroy() { remove(); view.destroy(); } };
}
