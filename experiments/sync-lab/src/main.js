const params = new URLSearchParams(location.search);
const engineName = ['powersync', 'loro'].includes(params.get('engine')) ? params.get('engine') : 'yjs';
const { createEngine } = await import(`./${engineName}-engine.js`);
const bound = params.get('input') === 'bound';
const { createBoundEditor } = bound ? await import('./bound-editor.js') : {};
const { createLoroEditor } = bound && engineName === 'loro' ? await import('./loro-editor.js') : {};
const tree = params.get('tree') === '1';
const { createTreeUI } = tree ? await import('./tree-view.js') : {};
const id = params.get('doc') || 'demo';
const elements = new Map();
const editors = new Map();
let engine, initial, treeUI;
function render(state) {
  if (!engine) { initial = state; return; }
  const { rows, connected, queued, conflicts = [] } = state;
  document.querySelector('[data-status]').textContent = `${connected ? '接続中' : '圏外・再接続待ち'} / ${rows.length}行 / ${queued ? '送信確認待ち' : '通信上の未確認なし'}（文書：${id}）`;
  document.querySelector('[data-conflicts]').textContent = conflicts.length ? `両方を保全した変更：${JSON.stringify(conflicts.map(({ node_id, field, mine, theirs }) => ({ node_id, field, mine, theirs })))}` : '';
  for (const row of rows) {
    let el = elements.get(row.id);
    if (!el) {
      el = document.createElement('article');
      el.dataset.row = row.id;
      if (bound) editors.set(row.id, (createLoroEditor || createBoundEditor)({ parent: el, id: row.id, engine, onError: (error) => { document.querySelector('#error').textContent = error.message; } }));
      else {
      const text = document.createElement('textarea');
      text.setAttribute('aria-label', `${row.id}の本文`);
      text.rows = 2;
      // IME中の受信で編集中のDOMを壊さない。文字の意図までの統合は次の検証段階。
      text.addEventListener('compositionstart', () => { text.dataset.composing = 'true'; });
      text.addEventListener('compositionend', () => { delete text.dataset.composing; engine.replaceText(row.id, text.value); });
      text.addEventListener('input', () => { if (!text.dataset.composing) engine.replaceText(row.id, text.value); });
      el.append(text);
      }
      for (const [key, title] of [['favorite', '★'], ['completed', '完了']]) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox'; input.dataset.attribute = key;
        input.addEventListener('change', () => engine.setAttribute(row.id, key, input.checked));
        label.append(input, title); el.append(label);
      }
      elements.set(row.id, el);
      document.querySelector('#rows').append(el);
      treeUI?.mount(el, row);
    }
    const input = el.querySelector('textarea');
    if (bound) editors.get(row.id).update();
    else if (!input.dataset.composing && input.value !== row.text) {
      const start = input.selectionStart, end = input.selectionEnd;
      input.value = row.text;
      if (document.activeElement === input) input.setSelectionRange(Math.min(start, row.text.length), Math.min(end, row.text.length));
    }
    for (const key of ['favorite', 'completed']) el.querySelector(`[data-attribute="${key}"]`).checked = row[key];
  }
  treeUI?.update(rows);
}
try {
  // 認証経路の合成試験だけで使う。トークンをURLや保存文書へ混ぜず、利用者ごとに端末保存も分ける。
  const connection = engineName === 'loro' && window.labConnection;
  const transport = connection ? (await import('./loro-transport.js')).loroTransport(connection) : undefined;
  engine = await createEngine({ docId: id, offline: params.get('offline') === '1', onChange: render, transport,
    storageId: connection ? `owner:${connection.ownerId}:${id}` : undefined });
  window.lab = engine;
  window.labInput = { text: (id) => editors.get(id)?.text() };
  if (tree) treeUI = createTreeUI({ container: document.querySelector('#rows'), engine, onError: (error) => { document.querySelector('#error').textContent = error.message; } });
  render(initial);
  document.querySelector('[data-disconnect]').onclick = () => engine.disconnect();
  document.querySelector('[data-connect]').onclick = () => engine.connect();
  document.querySelector('[data-undo]').onclick = () => engine.undo();
  document.querySelector('[data-redo]').onclick = () => engine.redo();
  document.querySelector('[data-check]').onclick = async () => {
    try {
      const state = await engine.serverState();
      const matches = JSON.stringify(state.rows) === JSON.stringify(engine.snapshot());
      document.querySelector('#receipt').textContent = `${matches ? 'サーバーの保存内容と表示内容が一致' : 'サーバー保存の反映待ち'} / ${state.bytes}バイト`;
    } catch (error) { document.querySelector('#receipt').textContent = error.message; }
  };
} catch (error) { document.querySelector('#error').textContent = `検証を開始できません：${error.message}`; }
