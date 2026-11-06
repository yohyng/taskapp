import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { seedOutlineDocument } from '../src/outline-model.js';
import { loroCheckpoint, loroNode } from '../src/loro-model.js';
import { collectLoroBackup } from '../src/loro-backup.js';
import { ownerFixture } from './support/owner-fixture.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { rollbackRef } from '../scripts/build-rollback-preview.mjs';

async function fixture(browser, { cutover = false } = {}) {
  const scope = { ownerId: randomUUID(), docId: randomUUID() }, auth = await ownerFixture(scope.docId, { ownerId: scope.ownerId });
  const context = await browser.newContext(), page = await context.newPage();
  const original = [{ id: 'a', text: '端末側の行', children: [] }, { id: 'b', text: '控え側の行', imageWidth: 300, children: [] }];
  const doc = seedOutlineDocument(original), migrationId = randomUUID();
  const initial = Buffer.from(doc.export({ mode: 'snapshot' })).toString('base64'); let entry;
  const stop = doc.subscribeLocalUpdates((bytes) => { entry = { id: randomUUID(), bytes }; });
  loroNode(doc, 'b').data.get('text').insert(0, '控えからの追記：'); doc.commit(); stop();
  const source = JSON.stringify(collectLoroBackup({ length: 0 }, { base: { ...loroCheckpoint(doc), format: 2, generation: 1, cutoff: 0 }, updates: [], outbox: [entry], cursor: 0, archives: [] }, scope));
  const state = { offline: false, entries: [], calls: 0, sends: 0, routeCalls: 0 };
  await page.addInitScript(({ docId, key, cutover, original }) => {
    window.labAuthConfig = { docId, key, cutover };
    if (!sessionStorage.getItem('recovery-seeded')) {
      localStorage.setItem('taskspace-outline-v1', cutover ? JSON.stringify({ format: 'taskspace-outline/1', nodes: original, revision: 1, at: '2026-11-05', complete: true,
        sync: { sequence: 0, pending: [], known: ['a', 'b'], deleted: [] } }) : '旧保存は触らない'); localStorage.setItem('taskspace-font', '現在の設定');
      localStorage.setItem('notion-like-taskdb-prototype-v4', '{"tasks":[{"id":"current-task"}]}'); sessionStorage.setItem('recovery-seeded', '1');
    }
  }, { docId: scope.docId, key: auth.apiKey, cutover, original });
  await auth.routeAuth(page); await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
  await page.route('**/rest/v1/rpc/taskspace_loro_cutover_route', (route) => {
    state.routeCalls++; return route.fulfill({ json: { format: 1, migrationId, ...scope, legacyWritesBlocked: true } });
  });
  await page.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
    state.calls++; if (state.offline) { await route.abort('failed'); return; }
    const body = route.request().postDataJSON();
    state.sends += body.p_updates.length;
    for (const entry of body.p_updates) {
      const old = state.entries.find((other) => other.id === entry.id);
      if (old) expect(old.bytes).toBe(entry.bytes); else state.entries.push(entry);
    }
    const start = Math.max(0, body.p_cursor), batch = state.entries.slice(start, start + 32);
    await route.fulfill({ json: { cursor: start + batch.length, head: state.entries.length, snapshot: body.p_cursor === -1 ? initial : null,
      updates: batch.map((entry, at) => ({ sequence: start + at + 1, bytes: entry.bytes })), acknowledged: body.p_updates.map((entry) => entry.id) } });
  });
  async function login() {
    await page.goto('/outline.html'); await page.getByPlaceholder('メールアドレス').fill(auth.credentials.email);
    await page.getByPlaceholder('パスワード').fill(auth.credentials.password); await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(page.locator('[data-row="a"]')).toBeVisible();
  }
  async function restore(text = source) {
    await page.locator('[data-outline-recovery] summary').click();
    await page.locator('[data-outline-recovery-file]').setInputFiles({ name: '検証の控え.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  }
  return { page, scope, source, state, entry, login, restore,
    async close() { doc.free(); await context.close(); await auth.close(); } };
}

test('控えの実画面復元：保存中の入力と控えの未送信を合流し、再読込・ACK後の同じ控えも二度送らない', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    await f.login(); f.state.offline = true; await f.page.evaluate(() => window.lab.disconnect());
    await f.page.locator('[data-row="a"] [data-row-text]').click(); await f.page.locator('[data-row="a"] textarea').fill('この端末に残った入力🌿');
    await f.restore();
    await expect(f.page.locator('[data-outline-recovery-state]')).toHaveText('控えとこの端末の内容を合わせました');
    await expect(f.page.locator('[data-row="a"] [data-row-text]')).toHaveText('この端末に残った入力🌿');
    await expect(f.page.locator('[data-row="b"] [data-row-text]')).toHaveText('控えからの追記：控え側の行');
    const before = await f.page.evaluate(async (scope) => {
      const { openLoroStorage } = await import('/src/loro-storage.js'), storage = await openLoroStorage(`owner:${scope.ownerId}:${scope.docId}`);
      try { const saved = await storage.read(); return { ids: saved.outbox.map((entry) => entry.id), updates: saved.updates.length }; } finally { storage.close(); }
    }, f.scope);
    expect(before.ids).toContain(f.entry.id); expect(before.ids).toHaveLength(2);
    await f.page.reload(); await expect(f.page.locator('[data-row="a"] [data-row-text]')).toHaveText('この端末に残った入力🌿');
    await expect(f.page.locator('[data-row="b"] [data-row-text]')).toHaveText('控えからの追記：控え側の行');
    f.state.offline = false; await f.page.evaluate(() => window.lab.connect()); await expect.poll(() => f.page.evaluate(() => window.lab.queued())).toBe(false);
    expect(f.state.entries).toHaveLength(2);
    const sends = f.state.sends;
    await f.restore(); await expect(f.page.locator('[data-outline-recovery-state]')).toHaveText('この控えは復元済みです');
    await expect.poll(() => f.page.evaluate(() => window.lab.queued())).toBe(false); expect(f.state.entries).toHaveLength(2);
    expect(f.state.sends).toBe(sends);
    const kept = await f.page.evaluate(() => ({ outline: localStorage.getItem('taskspace-outline-v1'), font: localStorage.getItem('taskspace-font'), tasks: localStorage.getItem('notion-like-taskdb-prototype-v4') }));
    expect(kept).toEqual({ outline: '旧保存は触らない', font: '現在の設定', tasks: '{"tasks":[{"id":"current-task"}]}' });
    await expect(f.page.locator('[data-error]')).toBeEmpty(); await expect(f.page.locator('[data-outline-sync-conflict]')).toHaveCount(0);
  } finally { await f.close(); }
});

test('控えの実画面復元：取引を途中で中止すると元の本文を開き直し、再試行で一回だけ合流する', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    await f.login(); f.state.offline = true; await f.page.evaluate(() => window.lab.disconnect());
    await f.page.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value, key) {
        const result = add.apply(this, [value, key]);
        if (this.name === 'state' && String(key).startsWith('recovery:')) { this.transaction.abort(); IDBObjectStore.prototype.add = add; }
        return result;
      };
    });
    await f.restore(); await expect(f.page.locator('[data-outline-recovery-state]')).toContainText('復元できませんでした');
    await expect(f.page.locator('[data-row="b"] [data-row-text]')).toHaveText('控え側の行');
    expect(await f.page.evaluate(async () => (await window.lab.recoveryState()).outbox.length)).toBe(0);
    await f.restore(); await expect(f.page.locator('[data-outline-recovery-state]')).toHaveText('控えとこの端末の内容を合わせました');
    await expect(f.page.locator('[data-row="b"] [data-row-text]')).toHaveText('控えからの追記：控え側の行');
    expect(await f.page.evaluate(async () => (await window.lab.recoveryState()).outbox.map((entry) => entry.id))).toEqual([f.entry.id]);
  } finally { await f.close(); }
});

test('控えの実画面復元：他人の控えでは元の画面を保持し、その後の入力も保存できる', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    await f.login(); const payload = JSON.parse(f.source); payload.outlineSync.ownerId = randomUUID();
    await f.restore(JSON.stringify(payload)); await expect(f.page.locator('[data-outline-recovery-state]')).toContainText('復元できませんでした');
    await expect(f.page.locator('[data-row="b"] [data-row-text]')).toHaveText('控え側の行'); expect(f.state.entries).toHaveLength(0);
    await f.page.locator('[data-row="a"] [data-row-text]').click(); await f.page.locator('[data-row="a"] textarea').fill('元の画面の続きを書ける');
    await expect.poll(() => f.page.evaluate(() => window.lab.queued())).toBe(false); expect(f.state.entries).toHaveLength(1);
  } finally { await f.close(); }
});

test('控えの実画面復元：端末保存に失敗した入力がある間は画面を閉じず、本文を保持する', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    await f.login(); f.state.offline = true; await f.page.evaluate(() => window.lab.disconnect());
    await f.page.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        const result = add.apply(this, args); if (this.name === 'outbox') this.transaction.abort(); return result;
      };
    });
    await f.page.locator('[data-row="a"] [data-row-text]').click(); await f.page.locator('[data-row="a"] textarea').fill('保存失敗中でもこの入力を失わない');
    await expect(f.page.locator('[data-error]')).not.toBeEmpty();
    await f.restore(); await expect(f.page.locator('[data-outline-recovery-state]')).toContainText('復元を始められませんでした');
    expect(await f.page.evaluate(() => window.lab.outline()[0].text)).toBe('保存失敗中でもこの入力を失わない');
    await expect(f.page.locator('[data-row="b"] [data-row-text]')).toHaveText('控え側の行');
    await expect(f.page.locator('[data-outline-connecting]')).toHaveCount(0); expect(f.state.entries).toHaveLength(0);
  } finally { await f.close(); }
});

test('控えの復元保存：復元前の全記録を保全し、ACKだけが動いた古い候補を拒否する', async ({ page }) => {
  await page.route('**/recovery-storage.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>復元保存の検査</title>' }));
  await page.goto('/recovery-storage.html');
  const result = await page.evaluate(async (scope) => {
    const { openLoroStorage } = await import('/src/loro-storage.js');
    const { seedOutlineDocument } = await import('/src/outline-model.js');
    const { loroCheckpoint, loroNode } = await import('/src/loro-model.js');
    const { collectLoroBackup } = await import('/src/loro-backup.js');
    const { restoreOutlineBackup } = await import('/src/restore-outline-backup.js');
    const { restoreLoroJournal } = await import('/src/loro-journal.js');
    const { checkpointLoroJournal } = await import('/src/loro-journal.js');
    const id = `owner:${scope.ownerId}:${scope.docId}`, s = await openLoroStorage(id), doc = seedOutlineDocument([{ id: 'memo', text: '元の本文', children: [] }]);
    let entry; const stop = doc.subscribeLocalUpdates((bytes) => { entry = { id: crypto.randomUUID(), bytes }; });
    const initial = loroCheckpoint(doc).snapshot;
    loroNode(doc, 'memo').data.get('text').insert(0, '控え：'); doc.commit(); stop();
    try {
      await s.append({ updates: [initial], cursor: 0 });
      const saved = await s.read({ includeArchives: true }), source = JSON.stringify(collectLoroBackup({ length: 0 }, { ...saved,
        base: { ...saved.base, ...loroCheckpoint(doc) }, updates: [], outbox: [entry] }, scope));
      const options = { ...scope, source, storageId: id, activeOwner: () => scope.ownerId };
      const first = await navigator.locks.request(`taskspace-loro:${id}`, () => restoreOutlineBackup(options));
      const receipt = await s.readRecovery(first.key), after = await s.read();
      const original = restoreLoroJournal(receipt.before);
      let beforeText; try { beforeText = loroNode(original, 'memo').data.get('text').toString(); } finally { original.free(); }
      const stale = await s.read({ includeArchives: true });
      await s.append({ acknowledged: [entry.id] });
      let refused = false;
      try { await s.commitRecovery({ receipt: { ...receipt, key: 'f'.repeat(64) }, expected: stale,
        updates: [], outgoing: [entry], archives: [], cursor: stale.cursor, active: () => true }); } catch { refused = true; }
      await s.compact(checkpointLoroJournal);
      const second = await navigator.locks.request(`taskspace-loro:${id}`, () => restoreOutlineBackup(options));
      const afterReplay = await s.read(), controller = new AbortController(), add = IDBObjectStore.prototype.add;
      let interrupted = false;
      IDBObjectStore.prototype.add = function (value, key) {
        const result = add.apply(this, [value, key]);
        if (this.name === 'state' && String(key).startsWith('recovery:')) controller.abort();
        return result;
      };
      try { await navigator.locks.request(`taskspace-loro:${id}`, () => restoreOutlineBackup({ ...options, source: `${source}\n`, signal: controller.signal })); }
      catch { interrupted = true; }
      finally { IDBObjectStore.prototype.add = add; }
      const afterInterrupted = await s.read();
      return { beforeText, originalKept: receipt.source === source, beforeUpdates: receipt.before.updates.length,
        afterUpdates: after.updates.length, afterIds: after.outbox.map((entry) => entry.id), entryId: entry.id, refused,
        replayApplied: second.applied, afterReplayIds: afterReplay.outbox.map((entry) => entry.id), interrupted,
        interruptKept: afterInterrupted.base.generation === afterReplay.base.generation && afterInterrupted.updates.length === afterReplay.updates.length && afterInterrupted.outbox.length === 0 };
    } finally { s.close(); doc.free(); }
  }, { ownerId: randomUUID(), docId: randomUUID() });
  expect(result.beforeText).toBe('元の本文'); expect(result.originalKept).toBe(true); expect(result.beforeUpdates).toBe(1);
  expect(result.afterUpdates).toBe(2); expect(result.afterIds).toEqual([result.entryId]); expect(result.refused).toBe(true);
  expect(result.replayApplied).toBe(false); expect(result.afterReplayIds).toEqual([]);
  expect(result.interrupted).toBe(true); expect(result.interruptKept).toBe(true);
});

test('互換版への切り戻し：0.18.0で復元後の保存を開き、そこでの追記も最新版へ持ち帰る', async ({ browser }) => {
  test.skip(process.env.LAB_VERIFY_ROLLBACK !== '1', '固定コミットからの互換ビルドを作成してから実行する');
  const root = new URL('../.data/rollback-0.18.0/', import.meta.url), manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  expect(manifest.ref).toBe(rollbackRef); expect(manifest.mode).toBe('fixture');
  for (const [name, hash] of Object.entries(manifest.files)) expect(createHash('sha256').update(await readFile(new URL(`preview/${name}`, root))).digest('hex')).toBe(hash);
  const f = await fixture(browser, { cutover: true });
  try {
    await f.login(); await f.restore(); await expect(f.page.locator('[data-outline-recovery-state]')).toHaveText('控えとこの端末の内容を合わせました');
    await expect.poll(() => f.page.evaluate(() => window.lab.queued())).toBe(false);
    await f.page.route('**/rollback.html', (route) => route.fulfill({ path: fileURLToPath(new URL('preview/outline.html', root)) }));
    await f.page.route('**/assets/**', (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      return manifest.files[name] ? route.fulfill({ path: fileURLToPath(new URL(`preview/${name}`, root)) }) : route.abort('failed');
    });
    await f.page.goto('/rollback.html');
    await expect(f.page.locator('[data-row="b"] [data-row-text]')).toHaveText('控えからの追記：控え側の行');
    await expect(f.page.locator('[data-outline-recovery]')).toHaveCount(0);
    expect(await f.page.evaluate(() => navigator.locks.request('taskspace-outline-owner-v1', { ifAvailable: true }, (lock) => !!lock))).toBe(false);
    await f.page.locator('[data-row="a"] [data-row-text]').click(); await f.page.locator('[data-row="a"] textarea').fill('互換版で書いた続きを残す');
    await expect.poll(() => f.page.evaluate(() => window.lab.queued())).toBe(false);
    await f.page.goto('/outline.html'); await expect(f.page.locator('[data-row="a"] [data-row-text]')).toHaveText('互換版で書いた続きを残す');
    await expect(f.page.locator('[data-row="b"] [data-row-text]')).toHaveText('控えからの追記：控え側の行');
    const count = f.state.sends; await f.restore(); await expect(f.page.locator('[data-outline-recovery-state]')).toHaveText('この控えは復元済みです');
    await expect.poll(() => f.page.evaluate(() => window.lab.queued())).toBe(false); expect(f.state.sends).toBe(count);
    expect(f.state.routeCalls).toBe(1); await expect(f.page.locator('[data-error]')).toBeEmpty();
  } finally { await f.close(); }
});
