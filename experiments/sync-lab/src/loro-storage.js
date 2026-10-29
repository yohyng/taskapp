// 差分と送信待ちは一取引で追記する。まとめ直しは保存済みの世代だけを対象にし、
// 後から増えた差分や送信確認を巻き戻さない。読み取り失敗で空へ初期化しない。
const emptyBase = () => ({ format: 2, generation: 0, cutoff: 0, snapshot: null, pending: null });
const binary = (value) => value instanceof Uint8Array && value.length > 0;
function checkCheckpoint(value, allowEmpty = false) {
  if (!value || !(binary(value.snapshot) || (allowEmpty && value.snapshot === null)) ||
    !(value.pending === null || binary(value.pending))) throw new Error('端末の保存内容が不正です');
}
function checkBase(value) {
  checkCheckpoint(value, true);
  if (value.format !== 2 || !Number.isSafeInteger(value.generation) || value.generation < 0 ||
    !Number.isSafeInteger(value.cutoff) || value.cutoff < 0) throw new Error('端末の保存世代が不正です');
  if (value.snapshot === null && (value.generation !== 0 || value.cutoff !== 0 || value.pending !== null)) throw new Error('端末の基準文書が欠けています');
}
function checkOutgoing(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id || !binary(entry.bytes)) throw new Error('端末の送信待ちが不正です');
}

export async function openLoroStorage(docId) {
  const db = await new Promise((resolve, reject) => {
    let migrationError;
    const request = indexedDB.open(`taskspace-lab-loro-${docId}`, 2);
    request.onupgradeneeded = (event) => {
      const tx = request.transaction;
      if (event.oldVersion === 0) request.result.createObjectStore('state');
      request.result.createObjectStore('updates', { keyPath: 'sequence', autoIncrement: true });
      const outgoing = request.result.createObjectStore('outbox', { keyPath: 'id' });
      const state = tx.objectStore('state'), old = state.get('document');
      old.onsuccess = () => {
        try {
          if (event.oldVersion === 0) state.put(emptyBase(), 'document');
          else {
            checkCheckpoint(old.result);
            if (!Array.isArray(old.result.outbox)) throw new Error('旧版の送信待ちが不正です');
            old.result.outbox.forEach((bytes, index) => {
              const entry = { id: `legacy:${index}`, bytes }; checkOutgoing(entry); outgoing.add(entry);
            });
            // 旧版のsnapshotには送信待ちの編集も含まれる。履歴を作り直さず、待ちだけ分離する。
            state.put({ ...emptyBase(), generation: 1, snapshot: old.result.snapshot, pending: old.result.pending }, 'document');
          }
        } catch (error) { migrationError = error; try { tx.abort(); } catch { /* 移行取引が先に中止されても元の版を残す。 */ } }
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(migrationError || request.error);
    request.onblocked = () => reject(new Error('検証用の保存領域が開けません'));
  });
  db.onversionchange = () => db.close();
  const counts = { appendTransactions: 0, appendedUpdates: 0, appendedBytes: 0, compactions: 0, checkpointExports: 0 };
  function transaction(stores, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result, failure;
      const fail = (error) => { failure = error; try { tx.abort(); } catch { /* すでに中止された取引も同じ失敗として返す。 */ } };
      tx.onabort = () => reject(failure || tx.error || new Error('端末保存を確定できません'));
      tx.onerror = () => {};
      try { action(tx, (value) => { result = value; }, fail); } catch (error) { fail(error); }
      tx.oncomplete = () => { try { resolve(typeof result === 'function' ? result() : result); } catch (error) { reject(error); } };
    });
  }
  async function read() {
    const saved = await transaction(['state', 'updates', 'outbox'], 'readonly', (tx, done) => {
      const base = tx.objectStore('state').get('document');
      const updates = tx.objectStore('updates').getAll(), outbox = tx.objectStore('outbox').getAll();
      const cursor = tx.objectStore('state').get('remote-cursor');
      done(() => ({ base: base.result, updates: updates.result, outbox: outbox.result, cursor: cursor.result ?? -1 }));
    });
    checkBase(saved.base);
    let previous = saved.base.cutoff;
    for (const entry of saved.updates) {
      if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= previous || !binary(entry.bytes)) throw new Error('端末の更新記録が不正です');
      previous = entry.sequence;
    }
    saved.outbox.forEach(checkOutgoing);
    if (!Number.isSafeInteger(saved.cursor) || saved.cursor < -1) throw new Error('端末の取得位置が不正です');
    return saved;
  }
  async function append({ updates = [], outgoing = [], acknowledged = [], cursor }) {
    if (!updates.every(binary) || !acknowledged.every((id) => typeof id === 'string' && id)) throw new Error('保存する差分が不正です');
    outgoing.forEach(checkOutgoing);
    await transaction(['state', 'updates', 'outbox'], 'readwrite', (tx, _done, fail) => {
      const base = tx.objectStore('state').get('document');
      base.onsuccess = () => { try { checkBase(base.result); } catch (error) { fail(error); } };
      for (const bytes of updates) tx.objectStore('updates').add({ bytes });
      // 同じIDの上書きは認めない。ACKは番号の範囲でなく、実際に送った操作だけを除く。
      for (const entry of outgoing) tx.objectStore('outbox').add(entry);
      for (const id of acknowledged) tx.objectStore('outbox').delete(id);
      if (cursor !== undefined) {
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('取得位置が不正です');
        const state = tx.objectStore('state'), previous = state.get('remote-cursor');
        previous.onsuccess = () => {
          if ((previous.result ?? -1) > cursor) { fail(new Error('取得位置を巻き戻せません')); return; }
          state.put(cursor, 'remote-cursor');
        };
      }
    });
    counts.appendTransactions++; counts.appendedUpdates += updates.length;
    counts.appendedBytes += updates.reduce((total, bytes) => total + bytes.length, 0);
  }
  async function compact(makeCheckpoint) {
    const saved = await read();
    if (!saved.updates.length) return { compacted: false, count: 0, bytes: 0 };
    const cutoff = saved.updates.at(-1).sequence;
    // 生きている編集文書ではなく、保存済みの一貫した読み取りから作る。
    counts.checkpointExports++;
    const checkpoint = await makeCheckpoint(saved); checkCheckpoint(checkpoint);
    const compacted = await transaction(['state', 'updates'], 'readwrite', (tx, done, fail) => {
      const state = tx.objectStore('state'), current = state.get('document');
      current.onsuccess = () => {
        try {
          checkBase(current.result);
          if (current.result.generation !== saved.base.generation) { done(false); return; }
          state.put({ ...checkpoint, format: 2, generation: saved.base.generation + 1, cutoff }, 'document');
          tx.objectStore('updates').delete(IDBKeyRange.upperBound(cutoff));
          done(true);
        } catch (error) { fail(error); }
      };
    });
    if (compacted) counts.compactions++;
    return { compacted, count: compacted ? saved.updates.length : 0,
      bytes: compacted ? saved.updates.reduce((total, entry) => total + entry.bytes.length, 0) : 0 };
  }
  return { read, append, compact, stats: () => ({ ...counts }), close: () => db.close() };
}
