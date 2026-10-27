import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoroDoc, VersionVector } from 'loro-crdt';
import { fixtureLoroDocument, loroNode, loroViewRows } from '../src/loro-model.js';
import { restoreLoroJournal } from '../src/loro-journal.js';
import { decodeLoroTransfer, exportLoroTransfer, loroSyncRequest } from '../src/loro-transfer.js';

function edit(doc, text) {
  let bytes; const stop = doc.subscribeLocalUpdates((data) => { bytes = data.slice(); });
  try { loroNode(doc, 'row-0').data.get('text').insert(0, text); doc.commit(); return bytes; } finally { stop(); }
}
function response(doc, request) {
  const from = VersionVector.decode(Uint8Array.from(request.version));
  try { return exportLoroTransfer(doc, from, request.bootstrap); } finally { from.free(); }
}
function apply(doc, payload, bootstrap) { for (const bytes of decodeLoroTransfer(payload, bootstrap).updates) doc.import(bytes); }

test('空の端末は一万行のsnapshotを受け、全行とネイティブIDをそのまま復元する', () => {
  const source = fixtureLoroDocument(10000), client = new LoroDoc();
  try {
    const request = loroSyncRequest(client, []); assert.equal(request.bootstrap, true);
    const payload = response(source, request); assert.equal(payload.mode, 'snapshot'); assert.equal(payload.pending, null);
    apply(client, payload, request.bootstrap);
    assert.deepEqual(loroViewRows(client), loroViewRows(source));
    assert.deepEqual(client.getTree('outline').getNodes().map((node) => node.id), source.getTree('outline').getNodes().map((node) => node.id));
    assert.equal(loroSyncRequest(client, []).bootstrap, false);
  } finally { source.free(); client.free(); }
});

test('送信待ちや前提待ちの受信だけがある端末は初回文書を要求しない', () => {
  const source = fixtureLoroDocument(), client = new LoroDoc();
  try {
    const first = edit(source, '前提：'), second = edit(source, '後続：');
    assert.equal(loroSyncRequest(client, [{ id: '未送信', bytes: first }]).bootstrap, false);
    client.import(second); assert.ok(client.exportPendingUpdates()?.length);
    assert.equal(loroSyncRequest(client, []).bootstrap, false);
  } finally { source.free(); client.free(); }
});

test('古い端末の追記は差分で渡し、別端末の属性と合流して次も差分だけ受け取る', () => {
  const source = fixtureLoroDocument(), client = source.fork();
  try {
    const local = edit(client, '圏外：');
    loroNode(source, 'row-3').data.set('favorite', true); source.commit();
    const request = loroSyncRequest(client, [{ id: '未送信', bytes: local }]); assert.equal(request.bootstrap, false);
    for (const bytes of request.updates) source.import(Uint8Array.from(bytes));
    const payload = response(source, request); assert.equal(payload.mode, 'update');
    apply(client, payload, false); assert.deepEqual(loroViewRows(client), loroViewRows(source));
    assert.ok(loroNode(client, 'row-0').data.get('text').toString().startsWith('圏外：'));
    assert.equal(loroNode(client, 'row-3').data.get('favorite'), true);
    // 旧応答はmodeがない。新しい端末も旧APIの差分を読み続けられる。
    apply(client, { update: response(source, loroSyncRequest(client, [])).update }, false);
  } finally { source.free(); client.free(); }
});

test('初回文書の到着前に内容が増えても、snapshotの取り込みで手元の編集を置き換えない', () => {
  const source = fixtureLoroDocument(), client = new LoroDoc();
  try {
    const request = loroSyncRequest(client, []), payload = response(source, request);
    client.import(source.export({ mode: 'snapshot' })); const local = edit(client, '返事を待つ間：');
    apply(client, payload, request.bootstrap); source.import(local);
    assert.deepEqual(loroViewRows(client), loroViewRows(source));
  } finally { source.free(); client.free(); }
});

test('初回snapshotの未適用受信も同じ応答から保存し、再起動後の前提到着で全文を戻す', () => {
  const source = fixtureLoroDocument(), remote = source.fork(), client = new LoroDoc();
  try {
    const first = edit(remote, '前提：'), second = edit(remote, '後続：'); source.import(second);
    const request = loroSyncRequest(client, []), payload = response(source, request);
    assert.ok(payload.pending?.length);
    const { updates } = decodeLoroTransfer(payload, true);
    const restored = restoreLoroJournal({ base: { snapshot: null, pending: null }, updates: updates.map((bytes, i) => ({ sequence: i + 1, bytes })), outbox: [] });
    try {
      assert.ok(restored.exportPendingUpdates()?.length); restored.import(first);
      assert.deepEqual(loroViewRows(restored), loroViewRows(remote));
    } finally { restored.free(); }
  } finally { source.free(); remote.free(); client.free(); }
});

test('壊れた後半・不正なバイト・種類違い・要求していないsnapshotを原本へ適用しない', () => {
  const source = fixtureLoroDocument(), client = new LoroDoc();
  try {
    const payload = response(source, loroSyncRequest(client, []));
    const before = [...client.oplogVersion().encode()];
    const bad = [
      { ...payload, pending: [1, 2, 3] }, { ...payload, update: [-1, 2] },
      { ...payload, update: [1.5, 2] }, { ...payload, update: [256] },
      { ...payload, mode: 'update' }, { ...payload, mode: null },
    ];
    for (const value of bad) { assert.throws(() => apply(client, value, true)); assert.deepEqual([...client.oplogVersion().encode()], before); }
    assert.throws(() => apply(client, payload, false));
    const version = source.oplogVersion();
    try { assert.throws(() => exportLoroTransfer(source, version, true)); } finally { version.free(); }
  } finally { source.free(); client.free(); }
});
