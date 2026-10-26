import { analyzeTree, placement } from './tree-model.js';

export function createTreeUI({ container, engine, onError }) {
  const elements = new Map(), panels = document.createElement('section');
  const trash = document.createElement('section'), detached = document.createElement('section');
  trash.dataset.treeTrash = ''; detached.dataset.treeDetached = '';
  panels.append(trash, detached); container.after(panels);
  let latest = [];
  const run = (operation) => { Promise.resolve().then(operation).catch(onError); };
  function button(title, attribute, operation) {
    const element = document.createElement('button'); element.textContent = title;
    element.setAttribute(attribute, ''); element.onclick = () => run(operation); return element;
  }
  function mount(element, row) {
    const controls = document.createElement('span'), select = document.createElement('select');
    select.dataset.treeParent = ''; select.setAttribute('aria-label', `${row.id}の移動先`);
    controls.append(select, button('移す', 'data-tree-move', () => engine.moveBranch(row.id, select.value || null, undefined, JSON.parse(element.dataset.seenPlacement))),
      button('先頭へ', 'data-tree-first', () => {
        const current = latest.find((item) => item.id === row.id);
        const order = Math.min(0, ...latest.filter((item) => item.parentId === current.parentId).map((item) => item.order)) - 1;
        return engine.moveBranch(row.id, current.parentId, order, JSON.parse(element.dataset.seenPlacement));
      }),
      button('枝を削除', 'data-tree-delete', () => engine.setBranchDeleted(row.id, true)));
    element.append(controls); elements.set(row.id, { element, select });
  }
  function update(rows) {
    latest = rows;
    const state = analyzeTree(rows), visible = new Map(state.visible.map((row) => [row.id, row]));
    for (const row of rows) {
      const { element, select } = elements.get(row.id), active = visible.get(row.id);
      element.hidden = !active; element.dataset.treeVisible = String(!!active);
      element.style.display = active ? 'flex' : 'none';
      element.dataset.seenPlacement = JSON.stringify(placement(row));
      element.dataset.treeDepth = String(active?.depth ?? -1);
      element.style.marginInlineStart = `${Math.min(active?.depth || 0, 12) * 16}px`;
      // 受信のたびに選択肢を作り直して、選びかけの移動先を初期化しない。
      if (select.options.length !== rows.length + 1) {
        select.replaceChildren(new Option('ホーム', ''), ...rows.map((item) => new Option(item.id, item.id)));
      }
      if (select.dataset.currentParent !== (row.parentId || '')) { select.value = row.parentId || ''; select.dataset.currentParent = row.parentId || ''; }
    }
    let anchor = container.firstElementChild;
    const ordered = [...state.visible, ...rows.filter((row) => !visible.has(row.id))];
    for (const row of ordered) {
      const element = elements.get(row.id).element;
      if (element !== anchor) container.insertBefore(element, anchor);
      else anchor = anchor.nextElementSibling;
    }
    trash.replaceChildren(); trash.hidden = !state.trash.length;
    if (state.trash.length) {
      const heading = document.createElement('h2'); heading.textContent = '削除した枝（本文は保持）'; trash.append(heading);
      for (const row of state.trash) {
        const item = document.createElement('article'), text = document.createElement('span'); item.dataset.trashRow = row.id;
        text.textContent = `${row.id}：${row.text}`;
        item.append(text, row.deleted ? button('枝を戻す', 'data-trash-restore', () => engine.setBranchDeleted(row.id, false)) : button('ホームへ移す', 'data-trash-rehome', () => engine.moveBranch(row.id, null)));
        trash.append(item);
      }
    }
    detached.replaceChildren(); detached.hidden = !state.detached.length;
    if (state.detached.length) {
      const heading = document.createElement('h2'); heading.textContent = '配置を確認する枝（自動修復は未実装）'; detached.append(heading);
      for (const row of state.detached) {
        const item = document.createElement('article'), text = document.createElement('span'); item.dataset.unplacedRow = row.id;
        text.textContent = `${row.id}：${row.text}`;
        item.append(text, button('ホームへ移す', 'data-recover-root', () => engine.moveBranch(row.id, null))); detached.append(item);
      }
    }
  }
  return { mount, update };
}
