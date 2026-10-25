import { PowerSyncDatabase, Schema, Table, column, WASQLiteVFS } from '@powersync/web';

const schema = new Schema({
  lab_rows: new Table({
    doc_id: column.text, node_id: column.text, text: column.text, parent_id: column.text,
    sort_order: column.integer, favorite: column.integer, completed: column.integer,
  }, { trackPrevious: { onlyWhenChanged: true }, ignoreEmptyUpdates: true }),
  lab_conflicts: new Table({
    doc_id: column.text, node_id: column.text, field: column.text,
    mine: column.text, theirs: column.text, operation_id: column.text,
  }),
});

export async function createEngine({ docId, offline, onChange }) {
  const db = new PowerSyncDatabase({ schema, database: {
    dbFilename: `taskspace-lab-powersync-${docId}.db`,
    vfs: WASQLiteVFS.IDBBatchAtomicVFS, enableMultiTabs: false,
  } });
  await db.init();
  let cache = [], conflicts = [], pending = Promise.resolve();
  const undoStack = [], redoStack = [], abort = new AbortController();
  async function refresh() {
    const data = await db.getAll('select * from lab_rows where doc_id=? order by sort_order,node_id', [docId]);
    cache = data.map((row) => ({ id: row.node_id, text: row.text, parentId: row.parent_id, order: row.sort_order, favorite: !!row.favorite, completed: !!row.completed }));
    conflicts = await db.getAll('select * from lab_conflicts where doc_id=? order by id', [docId]);
    const queue = await db.getUploadQueueStats();
    onChange?.({ rows: cache, conflicts, connected: db.currentStatus.connected, queued: queue.count > 0 });
  }
  const connector = {
    async fetchCredentials() {
      const response = await fetch(`/lab/powersync/token?doc=${encodeURIComponent(docId)}`);
      if (!response.ok) throw new Error('検証用の接続情報を取得できません');
      return response.json();
    },
    async uploadData(database) {
      const transaction = await database.getNextCrudTransaction();
      if (!transaction) return;
      const entries = transaction.crud.map((entry) => ({
        id: entry.id, clientId: entry.clientId, table: entry.table, op: entry.op,
        opData: entry.opData, previousValues: entry.previousValues,
      }));
      const response = await fetch('/lab/powersync/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: await database.getClientId(), entries }),
      });
      if (!response.ok) throw new Error(`検証用の保存APIが失敗しました：${await response.text()}`);
      // 競合分も同じDB取引で別テーブルへ保全した後に、端末の送信待ちを完了する。
      await transaction.complete();
      await refresh();
    },
  };
  const listener = db.registerListener({ statusChanged: () => { refresh().catch(showError); } });
  function showError(error) { document.querySelector('#error').textContent = `検証エラー：${error.message}`; }
  for (const table of ['lab_rows', 'lab_conflicts']) {
    db.watch(`select * from ${table} where doc_id=?`, [docId], { onResult: () => { refresh().catch(showError); }, onError: showError }, { signal: abort.signal });
  }
  function enqueue(operation) {
    const task = pending.then(operation);
    pending = task.catch(showError);
    return task;
  }
  async function change(id, key, value, record = true) {
    if (!['text', 'favorite', 'completed'].includes(key)) throw new Error('検証対象外の属性です');
    const stored = key === 'text' ? value : Number(value);
    let entry;
    await db.writeTransaction(async (tx) => {
      const row = await tx.get('select * from lab_rows where id=?', [`${docId}:${id}`]);
      if (row[key] === stored) return;
      entry = { id, key, before: row[key], after: stored };
      await tx.execute(`update lab_rows set ${key}=? where id=?`, [stored, `${docId}:${id}`]);
    });
    if (entry && record) { undoStack.push(entry); redoStack.length = 0; }
    await refresh();
  }
  async function undoOrRedo(from, to, undo) {
    const entry = from.at(-1);
    if (!entry) return;
    const row = await db.get('select * from lab_rows where id=?', [`${docId}:${entry.id}`]);
    if (row[entry.key] !== (undo ? entry.after : entry.before)) throw new Error('別端末が変更した本文のUndoには独自の統合処理が必要です');
    await change(entry.id, entry.key, undo ? entry.before : entry.after, false);
    from.pop(); to.push(entry);
  }
  await refresh();
  if (!offline) await db.connect(connector);
  return {
    snapshot: () => cache,
    queued: async () => (await db.getUploadQueueStats()).count > 0,
    conflicts: () => conflicts,
    replaceText: (id, value) => enqueue(() => change(id, 'text', value)),
    insertText: (id, index, value) => enqueue(async () => {
      const row = await db.get('select text from lab_rows where id=?', [`${docId}:${id}`]);
      await change(id, 'text', row.text.slice(0, index) + value + row.text.slice(index));
    }),
    setAttribute: (id, key, value) => enqueue(() => change(id, key, value)),
    undo: () => enqueue(() => undoOrRedo(undoStack, redoStack, true)),
    redo: () => enqueue(() => undoOrRedo(redoStack, undoStack, false)),
    async localBarrier() { await pending; await db.get('select count(*) as n from lab_rows'); await refresh(); },
    disconnect: () => db.disconnect(), connect: () => db.connect(connector),
    async serverState() {
      const response = await fetch(`/lab/powersync/server-state?doc=${encodeURIComponent(docId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('サーバーの保存を確認できません');
      return response.json();
    },
    async dispose() { await pending; abort.abort(); listener(); await db.close(); },
  };
}
