import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ownerFixture } from './support/owner-fixture.mjs';
import { seedOutlineDocument } from '../src/outline-model.js';
import { outlineCheckpoint } from '../../../src/lib/outline-checkpoint.js';
import { flattenTree, outlineRowSignature } from '../../../src/lib/outline.js';
import { fileURLToPath } from 'node:url';

const localStore = fileURLToPath(new URL('../../../src/lib/localstore.js', import.meta.url)).replaceAll('\\', '/');

async function fixture(browser) {
  const id = randomUUID(), ownerId = randomUUID(), migrationId = randomUUID(), auth = await ownerFixture(id, { ownerId });
  const context = await browser.newContext(), original = [{ id: 'memo', text: '基準の本文', children: [] }];
  const doc = seedOutlineDocument(original), initial = Buffer.from(doc.export({ mode: 'snapshot' })).toString('base64');
  let color; const stop = doc.subscribeLocalUpdates((bytes) => { color = Buffer.from(bytes).toString('base64'); });
  doc.getTree('outline').getNodes()[0].data.set('textColor', '#00ff00'); doc.commit(); stop();
  const entries = [{ id: randomUUID(), bytes: color }], state = { routeCalls: 0, exchanges: 0, startupReads: 0, sending: [], offline: false, failBudget: 0, pageSize: 32, allow: true, gate: null };
  const checkpoint = (text = '基準の本文・手元の追記') => outlineCheckpoint([{ ...original[0], text }],
    { sequence: 1, pending: new Map([['memo', { id: 'memo', kind: 'put', version: 1, positionChanged: false, baseSignature: outlineRowSignature(flattenTree(original)[0]) }]]) },
    new Set(), new Set(['memo']), 1, '2026-11-05');
  const first = checkpoint(), page = await context.newPage();
  await page.addInitScript(({ id, key, first }) => {
    window.labAuthConfig = { docId: id, key, cutover: true };
    if (!sessionStorage.getItem('cutover-seeded')) { localStorage.setItem('taskspace-outline-v1', JSON.stringify(first)); sessionStorage.setItem('cutover-seeded', '1'); }
  }, { id, key: auth.apiKey, first });
  await auth.routeAuth(page); await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
  await page.route('**/rest/v1/rpc/taskspace_loro_cutover_route', async (route) => {
    state.routeCalls++; if (state.gate) await state.gate;
    await route.fulfill({ json: { format: 1, migrationId, ownerId, docId: id, legacyWritesBlocked: state.allow } }).catch(() => {});
  });
  await page.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
    state.exchanges++;
    if (state.offline || state.failBudget-- > 0) { await route.abort('failed'); return; }
    const body = route.request().postDataJSON();
    const phase = await page.evaluate(async (storageId) => {
      const { openLoroStorage } = await import('/src/loro-storage.js'), s = await openLoroStorage(storageId);
      try { return (await s.readCutover())?.phase; } finally { s.close(); }
    }, `owner:${ownerId}:${id}`);
    if (body.p_updates.length) expect(phase).toBe('complete'); else expect(['captured', 'complete']).toContain(phase);
    if (phase === 'captured') state.startupReads++;
    for (const entry of body.p_updates) {
      state.sending.push({ id: entry.id, bytes: entry.bytes });
      const old = entries.find((other) => other.id === entry.id);
      if (old) expect(old.bytes).toBe(entry.bytes); else entries.push(entry);
    }
    const start = Math.max(0, body.p_cursor), batch = entries.slice(start, start + state.pageSize);
    await route.fulfill({ json: { cursor: start + batch.length, head: entries.length, snapshot: body.p_cursor === -1 ? initial : null,
      updates: batch.map((entry, at) => ({ sequence: start + at + 1, bytes: entry.bytes })), acknowledged: body.p_updates.map((entry) => entry.id) } });
  });
  async function login() {
    await page.goto('/outline.html'); await page.getByPlaceholder('メールアドレス').fill(auth.credentials.email);
    await page.getByPlaceholder('パスワード').fill(auth.credentials.password); await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  }
  async function saved() {
    return page.evaluate(async (storageId) => {
      const { openLoroStorage } = await import('/src/loro-storage.js'), s = await openLoroStorage(storageId);
      try {
        const record = await s.readCutover(), value = await s.read();
        return { record, outbox: value.outbox.map((entry) => ({ id: entry.id, bytes: btoa(String.fromCharCode(...entry.bytes)) })), cursor: value.cursor };
      } finally { s.close(); }
    }, `owner:${ownerId}:${id}`);
  }
  return { page, context, auth, state, entries, checkpoint, first, login, saved,
    async close() { doc.free(); await context.close(); await auth.close(); } };
}

test('自動切替：旧タブの最後の保存を待ち、最新の色を残して引き継ぎ、以後は旧保存を読まずに開く', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    const oldPage = await f.context.newPage();
    await oldPage.route('**/old-writer.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>旧保存の検査</title>' }));
    await oldPage.goto('http://127.0.0.1:4180/old-writer.html');
    await oldPage.evaluate(() => new Promise((ready) => {
      navigator.locks.request('taskspace-outline-owner-v1', async () => { ready(); await new Promise((resolve) => { window.releaseOld = resolve; }); });
    }));
    await f.login(); await expect(f.page.locator('[data-outline-connecting]')).toBeVisible(); expect(f.state.routeCalls).toBe(0);
    const last = f.checkpoint('旧タブの最後の保存');
    await oldPage.evaluate((record) => { localStorage.setItem('taskspace-outline-v1', JSON.stringify(record)); window.releaseOld(); }, last);
    await expect(f.page.locator('[data-row="memo"] [data-row-text]')).toHaveText('旧タブの最後の保存');
    await expect.poll(() => f.page.evaluate(() => window.lab.queued())).toBe(false);
    expect(await f.page.evaluate(() => window.lab.snapshot().find((row) => row.id === 'memo').textColor)).toBe('#00ff00');
    const saved = await f.saved(); expect(saved.record.phase).toBe('complete'); expect(saved.record.checkpoint).toEqual(last);
    expect(await oldPage.evaluate(() => navigator.locks.request('taskspace-outline-owner-v1', { ifAvailable: true }, (lock) => !!lock))).toBe(false);
    const calls = f.state.routeCalls;
    await f.page.evaluate(() => localStorage.setItem('taskspace-outline-v1', '{古い保存は以後読まない'));
    await f.page.reload(); await expect(f.page.locator('[data-row="memo"] [data-row-text]')).toHaveText('旧タブの最後の保存');
    expect(f.state.routeCalls).toBe(calls); await expect(f.page.locator('[data-error]')).toBeEmpty();
    await expect(f.page.locator('[data-outline-sync-conflict]')).toHaveCount(0);
  } finally { await f.close(); }
});

test('自動切替：原本保存後に通信が止まっても、再読込では保存済み原本から続ける', async ({ browser }) => {
  const f = await fixture(browser); f.state.offline = true;
  try {
    await f.login(); await expect.poll(async () => (await f.saved()).record?.phase).toBe('captured');
    await expect(f.page.locator('[data-row]')).toHaveCount(0); await expect(f.page.locator('[data-error]')).toBeEmpty();
    await f.page.evaluate(() => localStorage.setItem('taskspace-outline-v1', '{再開時に取り直さない'));
    f.state.offline = false; await f.page.reload();
    await expect(f.page.locator('[data-row="memo"] [data-row-text]')).toHaveText('基準の本文・手元の追記');
    const saved = await f.saved(); expect(saved.record.phase).toBe('complete'); expect(saved.record.checkpoint).toEqual(f.first);
    expect(saved.record.originals.localRaw).toBe(JSON.stringify(f.first));
  } finally { await f.close(); }
});

test('自動切替：引き継ぎ後の完了印が保存できなくても、再開で同じ送信IDを保ち二度取り込まない', async ({ browser }) => {
  const f = await fixture(browser);
  await f.page.addInitScript(() => {
    if (sessionStorage.getItem('cutover-failed-once')) return;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.apply(this, [value, key]);
      if (this.name === 'state' && key === 'cutover' && value.phase === 'complete') { sessionStorage.setItem('cutover-failed-once', '1'); this.transaction.abort(); }
      return request;
    };
  });
  try {
    await f.login(); await expect(f.page.locator('[data-outline-connecting] [data-error]')).not.toBeEmpty();
    const before = await f.saved(); expect(before.record.phase).toBe('captured'); expect(before.outbox).toHaveLength(1); expect(f.state.sending).toHaveLength(0);
    await f.page.reload(); await expect(f.page.locator('[data-row="memo"] [data-row-text]')).toHaveText('基準の本文・手元の追記');
    await expect.poll(() => f.page.evaluate(() => window.lab.queued())).toBe(false);
    expect(f.state.sending).toEqual(before.outbox); expect((await f.saved()).record.phase).toBe('complete');
  } finally { await f.close(); }
});

test('自動切替：旧同期の停止が確認できないときは旧保存を捕捉せず空の画面にも進まない', async ({ browser }) => {
  const f = await fixture(browser); f.state.allow = false;
  try {
    await f.login(); await expect(f.page.locator('[data-outline-connecting] [data-error]')).not.toBeEmpty();
    expect((await f.saved()).record).toBeNull(); expect(f.state.exchanges).toBe(0);
    expect(await f.page.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBe(JSON.stringify(f.first));
  } finally { await f.close(); }
});

test('自動切替：停止確認中のログアウトは原本捕捉・最新取得・画面表示を中止する', async ({ browser }) => {
  const f = await fixture(browser); let release; f.state.gate = new Promise((resolve) => { release = resolve; });
  try {
    await f.login(); await expect.poll(() => f.state.routeCalls).toBe(1);
    await f.page.evaluate(() => window.labAuth.auth.signOut({ scope: 'local' })); release();
    await expect(f.page.getByPlaceholder('メールアドレス')).toBeVisible();
    expect((await f.saved()).record).toBeNull(); expect(f.state.exchanges).toBe(0);
  } finally { release(); await f.close(); }
});

test('自動切替：通信を自動再試行し、最新の全ページを保存してから未送信を引き継ぐ', async ({ browser }) => {
  const f = await fixture(browser); f.state.failBudget = 1; f.state.pageSize = 1;
  f.entries.push(...Array.from({ length: 2 }, () => ({ ...f.entries[0], id: randomUUID() })));
  try {
    await f.login(); await expect(f.page.locator('[data-row="memo"] [data-row-text]')).toHaveText('基準の本文・手元の追記');
    expect(f.state.startupReads).toBe(3); expect(f.state.routeCalls).toBe(2);
    await expect(f.page.locator('[data-error]')).toBeEmpty(); expect((await f.saved()).record.checkpoint).toEqual(f.first);
  } finally { await f.close(); }
});

test('自動切替：IndexedDBの新しい保存を選び、小さい旧写しも原本として保全する', async ({ browser }) => {
  const f = await fixture(browser), newer = { ...f.checkpoint('IndexedDBの最後の保存'), revision: 3 };
  try {
    const prep = await f.context.newPage();
    await prep.route('**/prepare-storage.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>保存準備</title>' }));
    await prep.goto('http://127.0.0.1:4180/prepare-storage.html');
    expect(await prep.evaluate(async ({ path, value }) => (await import('/@fs/' + path)).bigPut('taskspace-outline-v1', value), { path: localStore, value: newer })).toBe(true);
    await f.login(); await expect(f.page.locator('[data-row="memo"] [data-row-text]')).toHaveText('IndexedDBの最後の保存');
    const saved = await f.saved(); expect(saved.record.checkpoint.revision).toBe(3); expect(saved.record.originals.localRaw).toBe(JSON.stringify(f.first));
  } finally { await f.close(); }
});

test('自動切替：読めない旧保存を空として移行せず、原本と新文書を変更しない', async ({ browser }) => {
  const f = await fixture(browser);
  await f.page.addInitScript(() => { localStorage.setItem('taskspace-outline-v1', '{}'); });
  try {
    await f.login(); await expect(f.page.locator('[data-outline-connecting] [data-error]')).not.toBeEmpty();
    expect((await f.saved()).record).toBeNull(); expect(f.state.exchanges).toBe(0);
    expect(await f.page.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBe('{}');
  } finally { await f.close(); }
});
