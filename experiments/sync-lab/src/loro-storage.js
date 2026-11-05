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
  let closed = false, closedReason = null, reopening;
  const stopped = (cause) => Object.assign(new Error('端末の保存接続は終了しました', { cause }), { storageStage: closedReason || 'closed-during-open' });
  const open = (allowCreate) => new Promise((resolve, reject) => {
    let migrationError, abandoned = false;
    const request = indexedDB.open(`taskspace-lab-loro-${docId}`, 2);
    request.onupgradeneeded = (event) => {
      const tx = request.transaction;
      // 切れた接続の取り直しで保存領域まで消えていたら、空の原本を作らない。
      if (!allowCreate) { migrationError = Object.assign(new Error('端末の保存領域を再取得できません'), { storageStage: 'missing' }); tx.abort(); return; }
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
    request.onsuccess = () => {
      const connection = request.result;
      if (closed || abandoned) { connection.close(); reject(stopped()); return; }
      connection.onversionchange = () => { closed = true; closedReason = 'versionchange'; connection.close(); };
      resolve(connection);
    };
    request.onerror = () => reject(migrationError || request.error);
    request.onblocked = () => { abandoned = true; reject(Object.assign(new Error('検証用の保存領域が開けません'), { storageStage: 'blocked' })); };
  });
  let db = await open(true);
  const counts = { appendTransactions: 0, appendedUpdates: 0, appendedBytes: 0, compactions: 0, checkpointExports: 0, reopens: 0, reopenAttempts: 0 };
  function transact(connection, stores, mode, action) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = connection.transaction(stores, mode); }
      catch (cause) {
        reject(Object.assign(new Error('端末保存の取引を開始できません', { cause }), { name: cause.name, storageStage: 'begin' })); return;
      }
      let result, failure;
      const fail = (error) => { failure = error; try { tx.abort(); } catch { /* すでに中止された取引も同じ失敗として返す。 */ } };
      tx.onabort = () => reject(failure || tx.error || new Error('端末保存を確定できません'));
      tx.onerror = () => {};
      try { action(tx, (value) => { result = value; }, fail); } catch (error) { fail(error); }
      tx.oncomplete = () => { try { resolve(typeof result === 'function' ? result() : result); } catch (error) { reject(error); } };
    });
  }
  async function transaction(stores, mode, action) {
    if (closed) throw stopped();
    const previous = db;
    try { return await transact(previous, stores, mode, action); }
    catch (error) {
      // WebKitの通信復帰・再起動後に接続だけ閉じる場合がある。取引を始める前の
      // InvalidStateErrorだけ取り直す。途中の中止・容量不足・明示終了は再実行しない。
      if (closed || error.name !== 'InvalidStateError' || error.storageStage !== 'begin') throw error;
      if (db === previous) {
        if (!reopening) {
          previous.close(); counts.reopenAttempts++;
          reopening = open(false).then((connection) => { db = connection; counts.reopens++; }).finally(() => { reopening = null; });
        }
        await reopening;
      }
      if (closed) throw stopped(error);
      return transact(db, stores, mode, action);
    }
  }
  async function read({ includeArchives = false } = {}) {
    const saved = await transaction(['state', 'updates', 'outbox'], 'readonly', (tx, done) => {
      const base = tx.objectStore('state').get('document');
      const updates = tx.objectStore('updates').getAll(), outbox = tx.objectStore('outbox').getAll();
      const cursor = tx.objectStore('state').get('remote-cursor');
      const keys = includeArchives ? tx.objectStore('state').getAllKeys() : null;
      const values = includeArchives ? tx.objectStore('state').getAll() : null;
      done(() => ({ base: base.result, updates: updates.result, outbox: outbox.result, cursor: cursor.result ?? -1,
        ...(includeArchives ? { archives: keys.result.flatMap((key, index) => key === 'cutover' || String(key).startsWith('handoff:') ? [{ key, value: values.result[index] }] : []) } : {}) }));
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
  const readHandoff = (key) => transaction(['state'], 'readonly', (tx, done) => {
    const request = tx.objectStore('state').get(`handoff:${key}`);
    done(() => request.result ?? null);
  });
  async function commitHandoff({ receipt, expected, updates, outgoing }) {
    if (!receipt || receipt.format !== 1 || !/^[a-f0-9]{64}$/.test(receipt.key)
      || !expected || !Array.isArray(updates) || !updates.every(binary) || !Array.isArray(outgoing)) throw new Error('引き継ぎの保存形式が不正です');
    outgoing.forEach(checkOutgoing);
    if (updates.length !== outgoing.length || updates.some((bytes, index) => bytes.length !== outgoing[index].bytes.length
      || bytes.some((value, at) => value !== outgoing[index].bytes[at]))) throw new Error('引き継ぐ編集と送信待ちが一致しません');
    const applied = await transaction(['state', 'updates', 'outbox'], 'readwrite', (tx, done, fail) => {
      const state = tx.objectStore('state'), old = state.get(`handoff:${receipt.key}`), base = state.get('document');
      const cursor = state.get('remote-cursor'), tail = tx.objectStore('updates').openCursor(null, 'prev');
      let ready = 0;
      const check = () => {
        if (++ready !== 4) return;
        try {
          if (old.result) { done(false); return; }
          checkBase(base.result);
          if (base.result.generation !== expected.generation || base.result.cutoff !== expected.cutoff
            || (cursor.result ?? -1) !== expected.cursor || (tail.result?.key ?? base.result.cutoff) !== expected.tail) {
            throw new Error('引き継ぎ候補の作成中に文書が変わりました');
          }
          for (const bytes of updates) tx.objectStore('updates').add({ bytes });
          for (const entry of outgoing) tx.objectStore('outbox').add(entry);
          // 控えだけ・編集だけ・処理済み印だけが残る中間状態を作らない。
          state.add(receipt, `handoff:${receipt.key}`); done(true);
        } catch (error) { fail(error); }
      };
      for (const request of [old, base, cursor, tail]) request.onsuccess = check;
    });
    if (applied) {
      counts.appendTransactions++; counts.appendedUpdates += updates.length;
      counts.appendedBytes += updates.reduce((total, bytes) => total + bytes.length, 0);
    }
    return applied;
  }
  const readCutover = () => transaction(['state'], 'readonly', (tx, done) => {
    const request = tx.objectStore('state').get('cutover'); done(() => request.result ?? null);
  });
  async function captureCutover(record) {
    return transaction(['state'], 'readwrite', (tx, done) => {
      const state = tx.objectStore('state'), old = state.get('cutover');
      old.onsuccess = () => {
        if (old.result) { done(old.result); return; }
        state.add(record, 'cutover'); done(record);
      };
    });
  }
  async function finishCutover(record, key) {
    await transaction(['state'], 'readwrite', (tx, _done, fail) => {
      const state = tx.objectStore('state'), current = state.get('cutover'), handoff = state.get(`handoff:${key}`);
      let ready = 0;
      const check = () => {
        if (++ready !== 2) return;
        if (!current.result || current.result.migrationId !== record.migrationId || handoff.result?.ownerId !== record.ownerId
          || handoff.result?.docId !== record.docId || JSON.stringify(handoff.result?.archive) !== JSON.stringify(current.result.checkpoint)) {
          fail(new Error('引き継ぎの確定記録が揃っていません')); return;
        }
        state.put({ ...current.result, phase: 'complete', handoffKey: key }, 'cutover');
      };
      current.onsuccess = check; handoff.onsuccess = check;
    });
  }
  const readRecovery = (key) => transaction(['state'], 'readonly', (tx, done) => {
    const request = tx.objectStore('state').get(`recovery:${key}`); done(() => request.result ?? null);
  });
  async function commitRecovery({ receipt, expected, updates, outgoing, archives, cursor, active, signal }) {
    if (!receipt || receipt.format !== 1 || !/^[a-f0-9]{64}$/.test(receipt.key) || !expected || !updates.every(binary)
      || !Array.isArray(archives) || !Number.isSafeInteger(cursor) || cursor < 0) throw new Error('復元の保存形式が不正です');
    outgoing.forEach(checkOutgoing);
    const sameOutbox = (left, right) => left.length === right.length && left.every((entry, index) => entry.id === right[index].id
      && entry.bytes.length === right[index].bytes.length && entry.bytes.every((byte, at) => byte === right[index].bytes[at]));
    const applied = await transaction(['state', 'updates', 'outbox'], 'readwrite', (tx, done, fail) => {
      const cancel = () => fail(new Error('復元中に画面が切り替わりました'));
      const clean = () => signal?.removeEventListener('abort', cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      tx.addEventListener('complete', clean, { once: true }); tx.addEventListener('abort', clean, { once: true });
      if (signal?.aborted) { cancel(); return; }
      const state = tx.objectStore('state'), old = state.get(`recovery:${receipt.key}`), base = state.get('document');
      const remote = state.get('remote-cursor'), tail = tx.objectStore('updates').openCursor(null, 'prev'), pending = tx.objectStore('outbox').getAll();
      const keys = state.getAllKeys(), values = state.getAll();
      let ready = 0;
      const check = () => {
        if (++ready !== 7) return;
        try {
          if (!active()) throw new Error('復元中に利用者が変わりました');
          if (old.result) { done(false); return; }
          checkBase(base.result);
          const currentArchives = keys.result.flatMap((key, index) => key === 'cutover' || String(key).startsWith('handoff:') ? [{ key, value: values.result[index] }] : []);
          if (base.result.generation !== expected.base.generation || base.result.cutoff !== expected.base.cutoff
            || (tail.result?.key ?? base.result.cutoff) !== (expected.updates.at(-1)?.sequence ?? expected.base.cutoff)
            || (remote.result ?? -1) !== expected.cursor || !sameOutbox(pending.result, expected.outbox)
            || JSON.stringify(currentArchives) !== JSON.stringify(expected.archives)
            || expected.cursor >= 0 && cursor !== expected.cursor) throw new Error('復元候補の作成中に端末の保存が変わりました');
          for (const bytes of updates) tx.objectStore('updates').add({ bytes });
          for (const entry of outgoing) tx.objectStore('outbox').add(entry);
          for (const entry of archives) state.add(entry.value, entry.key);
          // 元の基準・追記は消さない。合流する履歴・未送信・復元前の姿・処理済み印を一体で残す。
          state.put(cursor, 'remote-cursor'); state.add(receipt, `recovery:${receipt.key}`); done(true);
        } catch (error) { fail(error); }
      };
      for (const request of [old, base, remote, tail, pending, keys, values]) request.onsuccess = check;
    });
    if (applied) { counts.appendTransactions++; counts.appendedUpdates += updates.length; counts.appendedBytes += updates.reduce((total, bytes) => total + bytes.length, 0); }
    return applied;
  }
  return { id: docId, read, append, compact, readHandoff, commitHandoff, readCutover, captureCutover, finishCutover,
    readRecovery, commitRecovery, stats: () => ({ ...counts }), close: () => { closed = true; closedReason = 'disposed'; db.close(); } };
}
