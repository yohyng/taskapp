import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LoroDoc } from 'loro-crdt';
import { seedOutlineDocument, outlineNodes } from '../src/outline-model.js';
import { loroCheckpoint, loroNode, loroViewRows } from '../src/loro-model.js';
import { collectLoroBackup, readLoroBackup } from '../src/loro-backup.js';
import { outlineBackup } from '../src/outline-backup.js';
import { base64 } from '../src/loro-log-transfer.js';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareLoroRecovery } from './prepare-loro-recovery.mjs';

const emptyStore = { length: 0 };
function fixture() {
  const scope = { ownerId: randomUUID(), docId: randomUUID() };
  const doc = seedOutlineDocument([{ id: 'memo', text: '本文🌿', imageWidth: 321, children: [] }, { id: 'hidden', text: '削除前の内容', children: [] }]);
  const base = { ...loroCheckpoint(doc), format: 2, generation: 1, cutoff: 0 }, updates = [], outbox = [];
  const stop = doc.subscribeLocalUpdates((bytes) => { updates.push({ sequence: updates.length + 1, bytes }); outbox.push({ id: randomUUID(), bytes }); });
  loroNode(doc, 'memo').data.get('text').insert(0, '圏外で追記：'); doc.commit();
  loroNode(doc, 'hidden').data.set('deleted', true); doc.commit(); stop();
  const saved = { base, updates, outbox, cursor: 12, archives: [] };
  return { doc, scope, saved };
}

test('新同期の控え：保存済みの本文・画像幅・削除履歴・同じ送信ID・タスクと設定を往復し、秘密は含めない', () => {
  const { doc, scope, saved } = fixture();
  try {
    const values = { 'taskspace-drive-token': '含めない', 'taskspace-font': 'mincho', 'notion-like-taskdb-prototype-v4': '{"tasks":[{"id":"task"}]}', 'taskspace-lab-auth-fixture': 'セッションも含めない' };
    const storage = { length: 4, key: (i) => Object.keys(values)[i], getItem: (key) => { assert.notEqual(key, 'taskspace-lab-auth-fixture'); return values[key]; } };
    const payload = collectLoroBackup(storage, saved, scope), read = readLoroBackup(JSON.stringify(payload), scope);
    try {
      assert.deepEqual(read.nodes, outlineNodes(loroViewRows(doc)));
      assert.deepEqual(read.doc.getTree('outline').getNodes({ withDeleted: true }).map((node) => node.id), doc.getTree('outline').getNodes({ withDeleted: true }).map((node) => node.id));
      assert.equal(loroNode(read.doc, 'hidden').data.get('text').toString(), '削除前の内容');
      assert.equal(loroNode(read.doc, 'hidden').data.get('deleted'), true);
      assert.deepEqual(read.outbox, saved.outbox); assert.equal(read.cursor, 12);
      assert.equal(payload.store['taskspace-font'], 'mincho'); assert.equal(payload.store['taskspace-drive-token'], undefined);
      assert.equal(payload.store['taskspace-lab-auth-fixture'], undefined);
      assert.equal(payload.store['notion-like-taskdb-prototype-v4'], values['notion-like-taskdb-prototype-v4']);
      assert.equal(read.nodes[0].imageWidth, 321);
    } finally { read.doc.free(); }
  } finally { doc.free(); }
});

test('新同期の控え：未到着の先行差分を待つバイナリも残し、後から前提が届くと復元する', () => {
  const { doc, scope, saved } = fixture(), waiting = new LoroDoc(), changes = [];
  const stop = doc.subscribeLocalUpdates((bytes) => changes.push(bytes));
  try {
    loroNode(doc, 'memo').data.get('text').insert(0, '先行'); doc.commit();
    loroNode(doc, 'memo').data.get('text').insert(0, '後続'); doc.commit();
    waiting.import(saved.base.snapshot); waiting.import(changes[1]);
    const payload = collectLoroBackup(emptyStore, { base: { ...saved.base, ...loroCheckpoint(waiting) }, updates: [], outbox: [], cursor: 5, archives: [] }, scope);
    assert.ok(payload.outlineSync.pending);
    const read = readLoroBackup(payload, scope);
    try {
      for (const entry of saved.updates) read.doc.import(entry.bytes);
      read.doc.import(changes[0]);
      assert.deepEqual(outlineNodes(loroViewRows(read.doc)), outlineNodes(loroViewRows(doc)));
    } finally { read.doc.free(); }
  } finally { stop(); waiting.free(); doc.free(); }
});

test('新同期の控え：未読・別所有者・本文不一致・送信待ちの欠落や重複を復元成功にしない', () => {
  const { doc, scope, saved } = fixture();
  try {
    assert.throws(() => collectLoroBackup(emptyStore, { ...saved, cursor: -1 }, scope), /初回取得/);
    const payload = collectLoroBackup(emptyStore, saved, scope);
    assert.throws(() => readLoroBackup(payload, { ...scope, ownerId: randomUUID() }), /同期履歴付き/);
    for (const edit of [
      (p) => { p.store['taskspace-outline-v1'] = '[]'; },
      (p) => { p.outlineSync.snapshot = null; },
      (p) => { p.outlineSync.outbox.push(p.outlineSync.outbox[0]); },
      (p) => { p.outlineSync.outbox[0].bytes = p.outlineSync.snapshot; },
      (p) => { delete p.outlineSync.archives; },
    ]) { const changed = structuredClone(payload); edit(changed); assert.throws(() => readLoroBackup(changed, scope)); }
    const foreign = seedOutlineDocument([{ id: 'foreign', text: '別の文書', children: [] }]);
    try {
      let update; const stop = foreign.subscribeLocalUpdates((value) => { update = value; });
      loroNode(foreign, 'foreign').data.get('text').insert(0, '未収録'); foreign.commit(); stop();
      const changed = structuredClone(payload); changed.outlineSync.outbox[0].bytes = base64(update);
      assert.throws(() => readLoroBackup(changed, scope), /一致しません/);
    } finally { foreign.free(); }
  } finally { doc.free(); }
});

test('新同期の控え：移行時に保留した原本も失わず、読めないタスクで部分的な控えを作らない', () => {
  const { doc, scope, saved } = fixture();
  try {
    saved.archives = [{ key: 'cutover', value: { ...scope, originals: { localRaw: '旧原本' } } }];
    const payload = collectLoroBackup(emptyStore, saved, scope);
    const read = readLoroBackup(payload, scope);
    try { assert.deepEqual(read.archives, saved.archives); } finally { read.doc.free(); }
    assert.throws(() => collectLoroBackup({ length: 1, key: () => 'notion-like-taskdb-prototype-v4', getItem: () => '{' }, saved, scope));
    saved.archives[0].value.ownerId = randomUUID();
    assert.throws(() => collectLoroBackup(emptyStore, saved, scope), /引き継ぎ原本/);
  } finally { doc.free(); }
});

test('新同期の控え：同時の依頼は一つにまとめ、端末保存を待ってから送る', async () => {
  const { doc, scope, saved } = fixture(); let release, sent = 0;
  const barrier = new Promise((resolve) => { release = resolve; }), states = [];
  const backup = outlineBackup({ ...scope, storage: emptyStore, activeOwner: () => scope.ownerId,
    engine: { recoveryState: async () => { await barrier; return saved; } }, onState: (state) => states.push(state.status),
    send: async (payload) => { sent++; const read = readLoroBackup(payload, scope); read.doc.free(); return { ok: true }; } });
  try {
    const first = backup.run(); assert.equal(first, backup.run()); await Promise.resolve(); assert.equal(sent, 0);
    release(); assert.deepEqual(await first, { ok: true }); assert.equal(sent, 1); assert.deepEqual(states, ['saving', 'saved']);
  } finally { backup.dispose(); doc.free(); }
});

test('新同期の控え：保存失敗やログアウト後の遅い読み出しではGASへ送らず、次の手動実行は再試行できる', async () => {
  const { doc, scope, saved } = fixture(); let owner = scope.ownerId, broken = true, sent = 0, release;
  const states = [], barrier = new Promise((resolve) => { release = resolve; });
  const backup = outlineBackup({ ...scope, storage: emptyStore, activeOwner: () => owner,
    engine: { recoveryState: async () => { if (broken) throw new Error('端末保存失敗'); await barrier; return saved; } },
    onState: (state) => states.push(state.status), send: async () => { sent++; return { ok: true }; } });
  try {
    await assert.rejects(backup.run(), /端末保存失敗/); assert.equal(sent, 0); assert.deepEqual(states, ['saving', 'error']);
    broken = false; const pending = backup.run(); await Promise.resolve(); owner = randomUUID(); release();
    await assert.rejects(pending, /切り替わった/); assert.equal(sent, 0);
    owner = scope.ownerId; await backup.run(); assert.equal(sent, 1);
    backup.dispose(); await assert.rejects(backup.run(), /切り替わった/); assert.equal(sent, 1);
  } finally { backup.dispose(); doc.free(); }
});

test('新同期の復元候補：切替後の本文と削除履歴・未送信を展開し、原本と既存フォルダーを上書きしない', async () => {
  const { doc, scope, saved } = fixture(), directory = await mkdtemp(join(tmpdir(), 'taskspace-loro-recovery-'));
  try {
    const source = `\n${JSON.stringify(collectLoroBackup(emptyStore, saved, scope), null, 2)}\n`, input = join(directory, 'backup.json'), output = join(directory, 'candidate');
    await writeFile(input, source);
    const manifest = await prepareLoroRecovery(input, output, scope), recovered = new LoroDoc();
    try {
      recovered.import(await readFile(join(output, 'snapshot.bin')));
      const outgoing = JSON.parse(await readFile(join(output, 'outbox.json'), 'utf8'));
      assert.deepEqual(outgoing.map((entry) => entry.id), saved.outbox.map((entry) => entry.id));
      assert.deepEqual(loroViewRows(recovered), loroViewRows(doc));
      assert.equal(manifest.applied, false); assert.equal(manifest.queued, 2);
      assert.equal(await readFile(join(output, 'source.json'), 'utf8'), source); assert.equal(await readFile(input, 'utf8'), source);
      assert.equal(JSON.parse(await readFile(join(output, 'outline.json'), 'utf8')).items[0].text, '圏外で追記：本文🌿');
    } finally { recovered.free(); }
    await assert.rejects(prepareLoroRecovery(input, output, scope), /EEXIST/);
    const wrong = join(directory, 'wrong-owner');
    await assert.rejects(prepareLoroRecovery(input, wrong, { ...scope, ownerId: randomUUID() }), /同期履歴付き/);
    await assert.rejects(access(wrong), /ENOENT/);
  } finally { doc.free(); }
});
