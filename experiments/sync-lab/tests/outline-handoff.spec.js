import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const rootFiles = ['outline.js', 'outline-checkpoint.js'].map((name) => fileURLToPath(new URL(`../../../src/lib/${name}`, import.meta.url)).replaceAll('\\', '/'));

async function probe(page) {
  await page.evaluate(async (rootFiles) => {
    const storage = await import('/src/loro-storage.js'), handoff = await import('/src/commit-outline-handoff.js');
    const model = await import('/src/outline-model.js'), journal = await import('/src/loro-journal.js');
    const legacy = await import('/@fs/' + rootFiles[0]), oldStorage = await import('/@fs/' + rootFiles[1]);
    const loro = await import('/src/loro-model.js');
    window.handoffProbe = { ...storage, ...handoff, ...model, ...journal, ...legacy,
      outline: (doc) => model.outlineNodes(loro.loroViewRows(doc)),
      readOutline(saved) { const doc = journal.restoreLoroJournal(saved); try { return model.outlineNodes(loro.loroViewRows(doc)); } finally { doc.free(); } },
      checkpoint(nodes, operations) { return oldStorage.outlineCheckpoint(nodes,
        { sequence: operations.length ? 1 : 0, pending: new Map(operations.map((operation) => [operation.id, { version: 1, ...operation }])) },
        new Set(operations.filter((operation) => operation.kind === 'delete').map((operation) => operation.id)), new Set(['a', 'b', 'gone']), 1, '2026-11-05'); },
    };
  }, rootFiles);
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/?engine=loro&offline=1&doc=handoff-probe-${randomUUID()}`);
  await page.waitForFunction(() => !!window.lab);
  await probe(page);
});

test('旧端末の移行：本文・追加・削除・移動を一体保存し、再起動・再送・まとめ直しで二重適用しない', async ({ page }) => {
  const id = randomUUID();
  const first = await page.evaluate(async (id) => {
    const p = window.handoffProbe, storage = await p.openLoroStorage(`owner:alice:${id}`);
    const original = [{ id: 'a', text: '元', children: [] }, { id: 'b', text: '別', children: [] }, { id: 'gone', text: '削除する行', children: [] }];
    const initial = p.seedOutlineDocument(original), local = [{ ...original[1] }, { ...original[0], text: '元・手元' },
      { id: 'new', text: '親', imageWidth: 320, children: [{ id: 'child', text: '子', children: [] }] }];
    const rows = p.flattenTree(original);
    const operations = [
      { id: 'a', kind: 'put', positionChanged: true, baseSignature: p.outlineRowSignature(rows[0]) },
      { id: 'gone', kind: 'delete', baseSignature: p.outlineRowSignature(rows[2]) },
      { id: 'new', kind: 'put', expectedRevision: 0 }, { id: 'child', kind: 'put', expectedRevision: 0 },
    ];
    const checkpoint = p.checkpoint(local, operations), before = JSON.stringify(checkpoint);
    try {
      await storage.append({ updates: [initial.export({ mode: 'snapshot' })], cursor: 0 });
      const result = await p.commitOutlineHandoff({ storage, checkpoint, ownerId: 'alice', legacyOwnerId: 'alice', docId: id, activeOwner: () => 'alice', remoteHead: 0 });
      const saved = await storage.read(), other = p.restoreLoroJournal({ ...saved, updates: [saved.updates[0]] });
      try {
        saved.outbox.forEach((entry) => other.import(entry.bytes));
        const view = p.outline(other);
        window.handoffRepeat = { id, checkpoint, key: result.receipt.key, outbox: saved.outbox.map((entry) => ({ id: entry.id, bytes: [...entry.bytes] })) };
        return { applied: result.applied, ids: view.map((node) => node.id), text: view.find((node) => node.id === 'a').text,
          child: view.find((node) => node.id === 'new').children[0].id, width: view.find((node) => node.id === 'new').imageWidth,
          archiveExact: JSON.stringify(result.receipt.archive) === before, inputExact: JSON.stringify(checkpoint) === before,
          outbox: saved.outbox.length, retained: result.receipt.retained.length };
      } finally { other.free(); }
    } finally { initial.free(); storage.close(); }
  }, id);
  expect(first).toEqual({ applied: true, ids: ['b', 'a', 'new'], text: '元・手元', child: 'child', width: 320, archiveExact: true, inputExact: true, outbox: 1, retained: 0 });
  const previous = await page.evaluate(() => window.handoffRepeat);
  await page.reload(); await page.waitForFunction(() => !!window.lab); await probe(page);
  const repeat = await page.evaluate(async (previous) => {
    const p = window.handoffProbe, storage = await p.openLoroStorage(`owner:alice:${previous.id}`);
    try {
      const options = { storage, checkpoint: previous.checkpoint, ownerId: 'alice', legacyOwnerId: 'alice', docId: previous.id, activeOwner: () => 'alice', remoteHead: 0 };
      const before = await storage.read();
      const again = await p.commitOutlineHandoff(options), after = await storage.read();
      const sameIdsAndBytes = JSON.stringify(after.outbox.map((entry) => ({ id: entry.id, bytes: [...entry.bytes] }))) === JSON.stringify(previous.outbox);
      await storage.append({ acknowledged: after.outbox.map((entry) => entry.id) });
      await storage.compact(p.checkpointLoroJournal);
      const acknowledged = await p.commitOutlineHandoff(options), final = await storage.read();
      return { repeated: again.applied, unchanged: JSON.stringify(before) === JSON.stringify(after), sameIdsAndBytes,
        afterAck: acknowledged.applied, outbox: final.outbox.length, archive: !!await storage.readHandoff(previous.key), ids: p.readOutline(final).map((node) => node.id) };
    } finally { storage.close(); }
  }, previous);
  expect(repeat).toEqual({ repeated: false, unchanged: true, sameIdsAndBytes: true, afterAck: false, outbox: 0, archive: true, ids: ['b', 'a', 'new'] });
});

test('旧端末の移行：原本・差分・送信待ちのどの保存で中止しても全体が戻り、再試行できる', async ({ page }) => {
  const result = await page.evaluate(async (prefix) => {
    const p = window.handoffProbe, outcomes = [];
    for (const storeName of ['updates', 'outbox', 'state']) {
      const id = `${prefix}-${storeName}`, storage = await p.openLoroStorage(`owner:alice:${id}`);
      const original = [{ id: 'a', text: '元', children: [] }], initial = p.seedOutlineDocument(original);
      const checkpoint = p.checkpoint([{ ...original[0], text: '手元' }], [{ id: 'a', kind: 'put', baseSignature: p.outlineRowSignature(p.flattenTree(original)[0]) }]);
      try {
        await storage.append({ updates: [initial.export({ mode: 'snapshot' })], cursor: 0 });
        const before = await storage.read(), add = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) {
          const request = add.apply(this, args);
          if (this.name === storeName && (storeName !== 'state' || String(args[1]).startsWith('handoff:'))) this.transaction.abort();
          return request;
        };
        const options = { storage, checkpoint, ownerId: 'alice', legacyOwnerId: 'alice', docId: id, activeOwner: () => 'alice', remoteHead: 0 };
        let failed = false;
        try { await p.commitOutlineHandoff(options); } catch { failed = true; }
        finally { IDBObjectStore.prototype.add = add; }
        const after = await storage.read(), success = await p.commitOutlineHandoff(options), saved = await storage.read();
        outcomes.push({ failed, unchanged: JSON.stringify(before) === JSON.stringify(after), retry: success.applied, text: p.readOutline(saved)[0].text, outbox: saved.outbox.length });
      } finally { storage.close(); initial.free(); }
    }
    return outcomes;
  }, randomUUID());
  expect(result).toEqual(Array.from({ length: 3 }, () => ({ failed: true, unchanged: true, retry: true, text: '手元', outbox: 1 })));
});

test('旧端末の移行：同時に同じ控えを処理しても一つだけ保存する', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.handoffProbe, storage = await p.openLoroStorage(`owner:alice:${id}`), second = await p.openLoroStorage(`owner:alice:${id}`);
    const original = [{ id: 'a', text: '元', children: [] }], doc = p.seedOutlineDocument(original);
    const checkpoint = p.checkpoint([{ ...original[0], text: '手元' }], [{ id: 'a', kind: 'put', baseSignature: p.outlineRowSignature(p.flattenTree(original)[0]) }]);
    try {
      await storage.append({ updates: [doc.export({ mode: 'snapshot' })], cursor: 0 });
      const options = { checkpoint, ownerId: 'alice', legacyOwnerId: 'alice', docId: id, activeOwner: () => 'alice', remoteHead: 0 };
      const results = await Promise.all([p.commitOutlineHandoff({ ...options, storage }), p.commitOutlineHandoff({ ...options, storage: second })]);
      const saved = await storage.read();
      return { applied: results.filter((entry) => entry.applied).length, text: p.readOutline(saved)[0].text, updates: saved.updates.length, outbox: saved.outbox.length };
    } finally { doc.free(); storage.close(); second.close(); }
  }, randomUUID());
  expect(result).toEqual({ applied: 1, text: '手元', updates: 2, outbox: 1 });
});

test('旧端末の移行：候補作成中に届いた最新編集を古い候補で上書きしない', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.handoffProbe, storage = await p.openLoroStorage(`owner:alice:${id}`), initial = p.seedOutlineDocument([{ id: 'a', text: '元', children: [] }]);
    const checkpoint = p.checkpoint([{ id: 'a', text: '手元', children: [] }], [{ id: 'a', kind: 'put', baseSignature: p.outlineRowSignature(p.flattenTree([{ id: 'a', text: '元', children: [] }])[0]) }]);
    try {
      await storage.append({ updates: [initial.export({ mode: 'snapshot' })], cursor: 0 });
      let bytes; const stop = initial.subscribeLocalUpdates((update) => { bytes = update.slice(); });
      initial.getTree('outline').getNodes()[0].data.get('text').insert(0, '別端末・'); initial.commit(); stop();
      const wrapped = { ...storage, async commitHandoff(args) { await storage.append({ updates: [bytes] }); return storage.commitHandoff(args); } };
      let failed = false;
      try { await p.commitOutlineHandoff({ storage: wrapped, checkpoint, ownerId: 'alice', legacyOwnerId: 'alice', docId: id, activeOwner: () => 'alice', remoteHead: 0 }); } catch { failed = true; }
      const saved = await storage.read();
      return { failed, text: p.readOutline(saved)[0].text, outbox: saved.outbox.length, updates: saved.updates.length };
    } finally { storage.close(); initial.free(); }
  }, randomUUID());
  expect(result).toEqual({ failed: true, text: '別端末・元', outbox: 0, updates: 2 });
});

test('旧端末の移行：所有者違い・初回未取得・途中のログアウトでは保存しない', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const p = window.handoffProbe, storage = await p.openLoroStorage(`owner:alice:${id}`);
    const original = [{ id: 'a', text: '元', children: [] }], checkpoint = p.checkpoint(original, []), initial = p.seedOutlineDocument(original);
    const options = { storage, checkpoint, ownerId: 'alice', legacyOwnerId: 'alice', docId: id, activeOwner: () => 'alice', remoteHead: 0 };
    const fails = async (options) => { try { await p.commitOutlineHandoff(options); return false; } catch { return true; } };
    try {
      const foreign = await fails({ ...options, legacyOwnerId: 'bob' }), empty = await fails(options);
      await storage.append({ updates: [initial.export({ mode: 'snapshot' })], cursor: 0 });
      const incomplete = await fails({ ...options, remoteHead: 1 }), unspecified = await fails({ ...options, remoteHead: undefined });
      let owner = 'alice';
      const wrapped = { ...storage, async read() { const saved = await storage.read(); owner = 'bob'; return saved; } };
      const logout = await fails({ ...options, storage: wrapped, activeOwner: () => owner });
      return { foreign, empty, incomplete, unspecified, logout, outbox: (await storage.read()).outbox.length };
    } finally { initial.free(); storage.close(); }
  }, randomUUID());
  expect(result).toEqual({ foreign: true, empty: true, incomplete: true, unspecified: true, logout: true, outbox: 0 });
});

test('旧端末の移行：未編集の古い表示や別端末が追記した削除対象は送らず、原本だけを保全する', async ({ page }) => {
  const result = await page.evaluate(async (prefix) => {
    const p = window.handoffProbe, outcomes = [];
    for (const deleting of [false, true]) {
      const id = `${prefix}-${deleting}`, storage = await p.openLoroStorage(`owner:alice:${id}`);
      const old = [{ id: 'a', text: '元', children: [] }], latest = [{ id: 'a', text: '別端末の最新', children: [{ id: 'remote', text: '追記', children: [] }] }];
      const checkpoint = p.checkpoint(deleting ? [] : old, deleting ? [{ id: 'a', kind: 'delete', baseSignature: p.outlineRowSignature(p.flattenTree(old)[0]) }] : []);
      const doc = p.seedOutlineDocument(latest);
      try {
        await storage.append({ updates: [doc.export({ mode: 'snapshot' })], cursor: 0 });
        const value = await p.commitOutlineHandoff({ storage, checkpoint, ownerId: 'alice', legacyOwnerId: 'alice', docId: id, activeOwner: () => 'alice', remoteHead: 0 });
        const saved = await storage.read();
        outcomes.push({ outbox: saved.outbox.length, updates: saved.updates.length, text: p.readOutline(saved)[0].text,
          child: p.readOutline(saved)[0].children[0].id, retained: value.receipt.retained.length, archive: !!await storage.readHandoff(value.receipt.key) });
      } finally { storage.close(); doc.free(); }
    }
    return outcomes;
  }, randomUUID());
  expect(result).toEqual([0, 1].map((retained) => ({ outbox: 0, updates: 1, text: '別端末の最新', child: 'remote', retained, archive: true })));
});
