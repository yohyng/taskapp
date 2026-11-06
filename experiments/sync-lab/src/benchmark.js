// 全行分の検証操作メニューとCodeMirrorを作る費用を、同期エンジンの費用へ混ぜない。
const params = new URLSearchParams(location.search), kind = params.get('engine');
const start = performance.now(), metrics = { moduleStartMs: start, input: [] };
const module = await (kind === 'powersync' ? import('./powersync-engine.js') : kind === 'loro' ? import('./loro-engine.js') : import('./yjs-engine.js'));
metrics.moduleReadyMs = performance.now();
const editor = document.querySelector('[data-editor]'), visible = document.querySelector('[data-visible]');
let rows = [], engine, currentText, lastVisible, ready = false, editing = false;
function render(state) {
  rows = state.rows;
  const text = rows.find((row) => row.id === 'row-0')?.text;
  if (text !== undefined && !editing) { editor.value = text; currentText = text; }
  const rendered = JSON.stringify(rows.slice(0, 60).map((row) => row.text));
  if (rendered !== lastVisible) {
    lastVisible = rendered;
    visible.replaceChildren(...rows.slice(0, 60).map((row) => { const li = document.createElement('li'); li.textContent = row.text; return li; }));
  }
  if (!ready && rows.length === 10000) {
    ready = true; metrics.rowsReadyMs = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      metrics.rowsFrameMs = performance.now(); document.querySelector('[data-ready]').textContent = '10000行';
    }));
  }
}
engine = await module.createEngine({ docId: 'benchmark-10000', offline: params.get('offline') === '1', onChange: render });
render({ rows: engine.snapshot() });
editor.addEventListener('input', () => {
  const sample = { startMs: performance.now() }, value = editor.value, base = currentText;
  currentText = value; metrics.input.push(sample); editing = true;
  requestAnimationFrame(() => requestAnimationFrame(() => { sample.frameMs = performance.now() - sample.startMs; }));
  Promise.resolve().then(async () => {
    if (engine.replaceObservedText) await engine.replaceObservedText('row-0', base, value);
    else engine.replaceText('row-0', value);
    await engine.localBarrier(); sample.localMs = performance.now() - sample.startMs;
  }).catch((error) => { document.querySelector('[data-error]').textContent = error.message; })
    .finally(() => { editing = false; });
});
window.bench = { engine, metrics, rows: () => rows };
