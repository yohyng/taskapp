import { Annotation } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';

const remote = Annotation.define();
export function createBoundEditor({ parent, id, engine, onError }) {
  const binding = engine.textBinding?.(id);
  const restored = engine.inputState(id);
  let view, busy = 0, composing = false, finishRequested = false, base = restored.draft ? restored.base : null;
  const report = (promise) => {
    busy++;
    Promise.resolve(promise).catch(onError).finally(() => {
      busy--;
      if (!busy) update();
    });
  };
  function commit(before, value) {
    base = null; finishRequested = false;
    report(before === value ? engine.clearInputDraft(id) : engine.replaceObservedText(id, before, value));
  }
  const extensions = [
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'data-editor-input': id, 'aria-label': `${id}の本文` }),
    EditorView.theme({ '&': { flex: '1', minWidth: '0', background: 'transparent', color: 'inherit' }, '.cm-content': { fontFamily: 'inherit', padding: '0', minHeight: '2.5em' }, '&.cm-focused': { outline: '1px solid #34d399' } }),
  ];
  if (binding) extensions.push(yCollab(binding.text, null, { undoManager: binding.undoManager }), keymap.of(yUndoManagerKeymap));
  else extensions.push(
    keymap.of([
      { key: 'Mod-z', run: () => { report(engine.undo()); return true; } },
      { key: 'Mod-Shift-z', run: () => { report(engine.redo()); return true; } },
    ]),
    EditorView.domEventHandlers({
      compositionstart() { composing = true; if (base === null) base = view.state.doc.toString(); return false; },
      compositionend() {
        composing = false; finishRequested = true;
        // CodeMirrorのDOM変更取り込み後に空の更新を渡し、確定値を一度だけ保存する。
        requestAnimationFrame(() => view.dispatch({}));
        return false;
      },
    }),
    EditorView.updateListener.of((change) => {
      const local = change.docChanged && !change.transactions.every((transaction) => transaction.annotation(remote));
      if (local) {
        const value = change.state.doc.toString();
        const before = base ?? change.startState.doc.toString();
        if (composing || change.view.compositionStarted) {
          if (base === null) base = before;
          report(engine.saveInputDraft(id, base, value));
        } else {
          commit(before, value);
        }
      } else if (finishRequested && !composing && !change.view.compositionStarted && base !== null) {
        commit(base, change.state.doc.toString());
      }
    }),
  );
  view = new EditorView({ parent, doc: restored.text, extensions });
  function update() {
    if (binding || busy || composing || view.compositionStarted || base !== null) return;
    const value = engine.inputState(id).text;
    if (value !== undefined && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: remote.of(true) });
    }
  }
  return { update, text: () => view.state.doc.toString(), destroy: () => view.destroy() };
}
