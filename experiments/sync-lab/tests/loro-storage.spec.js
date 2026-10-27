import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  await page.goto(`/?engine=loro&offline=1&doc=storage-probe-${randomUUID()}`);
  await page.waitForFunction(() => !!window.lab);
  await page.evaluate(async () => {
    const storage = await import('/src/loro-storage.js'), journal = await import('/src/loro-journal.js'), model = await import('/src/loro-model.js');
    window.storageProbe = {
      ...storage, ...journal, ...model,
      edit(doc, text) {
        let bytes; const stop = doc.subscribeLocalUpdates((update) => { bytes = update.slice(); });
        try { model.loroNode(doc, 'row-0').data.get('text').insert(0, text); doc.commit(); return bytes; } finally { stop(); }
      },
      async legacy(id, value) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(`taskspace-lab-loro-${id}`, 1);
          request.onupgradeneeded = () => request.result.createObjectStore('state');
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'document');
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        }); db.close();
      },
      rows(saved) {
        const doc = journal.restoreLoroJournal(saved);
        try { return model.loroViewRows(doc); } finally { doc.free(); }
      },
    };
  });
});

test('Loro差分保存：更新・送信待ち・ACKの取引を途中で中止しても以前の記録を保つ', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.storageProbe, s = await p.openLoroStorage(id), doc = p.fixtureLoroDocument();
    try {
      await s.append({ updates: [doc.export({ mode: 'update' })] });
      const a = p.edit(doc, '先：'); await s.append({ updates: [a], outgoing: [{ id: 'a', bytes: a }] });
      const before = await s.read(), b = p.edit(doc, '後：'), original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        const request = original.apply(this, args); if (this.name === 'outbox') this.transaction.abort(); return request;
      };
      let failed = false;
      try { await s.append({ updates: [b], outgoing: [{ id: 'b', bytes: b }], acknowledged: ['a'] }); }
      catch { failed = true; } finally { IDBObjectStore.prototype.add = original; }
      const after = await s.read();
      return { failed, unchanged: JSON.stringify(before) === JSON.stringify(after), text: p.rows(after).find((row) => row.id === 'row-0').text, ids: after.outbox.map((entry) => entry.id) };
    } finally { s.close(); doc.free(); }
  }, randomUUID());
  expect(result).toEqual({ failed: true, unchanged: true, text: '先：最初のメモ', ids: ['a'] });
});

test('Loro差分保存：まとめ直し中の次の編集と受信、ACKを残して圏外で読み直す', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.storageProbe, s = await p.openLoroStorage(id), other = await p.openLoroStorage(id), doc = p.fixtureLoroDocument();
    try {
      await s.append({ updates: [doc.export({ mode: 'update' })] });
      const a = p.edit(doc, 'A：'); await s.append({ updates: [a], outgoing: [{ id: 'a', bytes: a }] });
      let release, captured;
      const gate = new Promise((resolve) => { release = resolve; }), started = new Promise((resolve) => { captured = resolve; });
      const compact = s.compact(async (saved) => { const value = p.checkpointLoroJournal(saved); captured(); await gate; return value; });
      await started;
      const b = p.edit(doc, 'B：'), received = p.edit(doc, '受信：');
      await other.append({ updates: [b, received], outgoing: [{ id: 'b', bytes: b }], acknowledged: ['a'] });
      release(); const compacted = await compact;
      s.close(); other.close();
      const reopened = await p.openLoroStorage(id);
      try {
        const saved = await reopened.read();
        return { compacted: compacted.compacted, remaining: saved.updates.length, ids: saved.outbox.map((entry) => entry.id), match: JSON.stringify(p.rows(saved)) === JSON.stringify(p.loroViewRows(doc)) };
      } finally { reopened.close(); }
    } finally { s.close(); other.close(); doc.free(); }
  }, randomUUID());
  expect(result).toEqual({ compacted: true, remaining: 2, ids: ['b'], match: true });
});

test('Loro差分保存：古いまとめ直しは新しい世代へ戻さず、その後の入力も消さない', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.storageProbe, s = await p.openLoroStorage(id), other = await p.openLoroStorage(id), doc = p.fixtureLoroDocument();
    try {
      await s.append({ updates: [doc.export({ mode: 'update' })] });
      let release, captured;
      const gate = new Promise((resolve) => { release = resolve; }), started = new Promise((resolve) => { captured = resolve; });
      const stale = s.compact(async (saved) => { const value = p.checkpointLoroJournal(saved); captured(); await gate; return value; });
      await started;
      const b = p.edit(doc, '新しい世代：'); await other.append({ updates: [b], outgoing: [{ id: 'b', bytes: b }] });
      const winner = await other.compact(p.checkpointLoroJournal);
      const c = p.edit(doc, 'さらに追記：'); await other.append({ updates: [c], outgoing: [{ id: 'c', bytes: c }], acknowledged: ['b'] });
      release(); const loser = await stale, saved = await s.read();
      return { winner: winner.compacted, loser: loser.compacted, generation: saved.base.generation, remaining: saved.updates.length, ids: saved.outbox.map((entry) => entry.id), match: JSON.stringify(p.rows(saved)) === JSON.stringify(p.loroViewRows(doc)) };
    } finally { s.close(); other.close(); doc.free(); }
  }, randomUUID());
  expect(result).toEqual({ winner: true, loser: false, generation: 1, remaining: 1, ids: ['c'], match: true });
});

test('Loro差分保存：まとめ直しの確定が中止されても旧snapshotとログと未適用受信を残す', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.storageProbe, s = await p.openLoroStorage(id), doc = p.fixtureLoroDocument();
    try {
      await s.append({ updates: [doc.export({ mode: 'update' })] }); await s.compact(p.checkpointLoroJournal);
      const first = p.edit(doc, '前提：'), second = p.edit(doc, '待機：');
      await s.append({ updates: [second], outgoing: [{ id: '待ち', bytes: second }] });
      const before = await s.read(), original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { const request = original.apply(this, args); if (this.name === 'state') this.transaction.abort(); return request; };
      let failed = false;
      try { await s.compact(p.checkpointLoroJournal); } catch { failed = true; } finally { IDBObjectStore.prototype.put = original; }
      const after = await s.read();
      await s.compact(p.checkpointLoroJournal); const pending = !!(await s.read()).base.pending?.length;
      await s.append({ updates: [first] });
      return { failed, unchanged: JSON.stringify(before) === JSON.stringify(after), pending, match: JSON.stringify(p.rows(await s.read())) === JSON.stringify(p.loroViewRows(doc)), ids: (await s.read()).outbox.map((entry) => entry.id) };
    } finally { s.close(); doc.free(); }
  }, randomUUID());
  expect(result).toEqual({ failed: true, unchanged: true, pending: true, match: true, ids: ['待ち'] });
});

test('Loro差分保存：旧版の移行を中止したら旧領域を保ち、成功時は未適用受信と送信待ちを引き継ぐ', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.storageProbe, doc = p.fixtureLoroDocument(), remote = doc.fork();
    try {
      const first = p.edit(remote, '前提：'), second = p.edit(remote, '後続：'); doc.import(second);
      const local = p.edit(doc, '未送信：'), old = { ...p.loroCheckpoint(doc), outbox: [local] };
      await p.legacy(id, old);
      const original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) { const request = original.apply(this, args); if (this.name === 'outbox') this.transaction.abort(); return request; };
      let failed = false;
      try { const bad = await p.openLoroStorage(id); bad.close(); } catch { failed = true; } finally { IDBObjectStore.prototype.add = original; }
      const preserved = await new Promise((resolve, reject) => {
        const request = indexedDB.open(`taskspace-lab-loro-${id}`, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('state'), get = tx.objectStore('state').get('document');
          tx.oncomplete = () => { resolve({ version: db.version, match: JSON.stringify(get.result) === JSON.stringify(old) }); db.close(); };
        };
      });
      const s = await p.openLoroStorage(id);
      try {
        const saved = await s.read(), pending = !!saved.base.pending?.length;
        doc.import(first); await s.append({ updates: [first] });
        return { failed, preserved, pending, outgoing: saved.outbox.length, match: JSON.stringify(p.rows(await s.read())) === JSON.stringify(p.loroViewRows(doc)) };
      } finally { s.close(); }
    } finally { doc.free(); remote.free(); }
  }, randomUUID());
  expect(result).toEqual({ failed: true, preserved: { version: 1, match: true }, pending: true, outgoing: 1, match: true });
});

test('Loro差分保存：壊れた差分の読出しやまとめ直しを空の文書で成功扱いしない', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.storageProbe, s = await p.openLoroStorage(id), doc = p.fixtureLoroDocument();
    try {
      await s.append({ updates: [doc.export({ mode: 'update' })] }); await s.compact(p.checkpointLoroJournal);
      await s.append({ updates: [new Uint8Array([1, 2, 3])] }); const before = await s.read();
      let failedRead = false, failedCompact = false;
      try { p.rows(before); } catch { failedRead = true; }
      try { await s.compact(p.checkpointLoroJournal); } catch { failedCompact = true; }
      return { failedRead, failedCompact, unchanged: JSON.stringify(before) === JSON.stringify(await s.read()) };
    } finally { s.close(); doc.free(); }
  }, randomUUID());
  expect(result).toEqual({ failedRead: true, failedCompact: true, unchanged: true });
});
