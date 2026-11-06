import { test, expect } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { ownerFixture } from './support/owner-fixture.mjs';
import { seedOutlineDocument } from '../src/outline-model.js';
import { readLoroBackup } from '../src/loro-backup.js';

async function fixture(browser) {
  const docId = randomUUID(), ownerId = randomUUID(), auth = await ownerFixture(docId, { ownerId }), context = await browser.newContext();
  const page = await context.newPage(), doc = seedOutlineDocument([{ id: 'memo', text: '保存済みのメモ', children: [] }]);
  const initial = Buffer.from(doc.export({ mode: 'snapshot' })).toString('base64'), entries = [];
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=';
  const state = { offline: false, wrongHash: false, backups: [], images: [] };
  await page.addInitScript(({ docId, key }) => {
    window.labAuthConfig = { docId, key };
    localStorage.setItem('taskspace-drive-url', 'https://drive.example.test/exec'); localStorage.setItem('taskspace-drive-token', '合成の合言葉');
    localStorage.setItem('notion-like-taskdb-prototype-v4', '{"tasks":[{"id":"task","title":"タスクも控える"}]}');
    localStorage.setItem('taskspace-font', 'mincho');
    localStorage.setItem('taskspace-outline-v1', '[{"id":"old","text":"古い端末の保存","children":[]}]');
  }, { docId, key: auth.apiKey });
  await auth.routeAuth(page); await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
  await page.route('https://drive.google.com/thumbnail?**', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
  await page.route('**/rest/v1/rpc/taskspace_loro_exchange', async (route) => {
    if (state.offline) { await route.abort('failed'); return; }
    const body = route.request().postDataJSON();
    for (const entry of body.p_updates) if (!entries.some((other) => other.id === entry.id)) entries.push(entry);
    const start = Math.max(0, body.p_cursor), batch = entries.slice(start, start + 32);
    await route.fulfill({ json: { cursor: start + batch.length, head: entries.length, snapshot: body.p_cursor === -1 ? initial : null,
      updates: batch.map((entry, at) => ({ sequence: start + at + 1, bytes: entry.bytes })), acknowledged: body.p_updates.map((entry) => entry.id) } });
  });
  await page.route('https://drive.example.test/**', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { ok: true, backupProtocol: 2 } }); return; }
    const body = route.request().postDataJSON();
    if (body.kind !== 'backup') {
      state.images.push(body); await route.fulfill({ json: { url: 'https://drive.google.com/thumbnail?id=synthetic-image&sz=w1600' } }); return;
    }
    const text = body.gzipBase64 ? gunzipSync(Buffer.from(body.gzipBase64, 'base64')).toString('utf8') : body.json;
    const hash = createHash('sha256').update(text).digest('hex');
    expect(body.expectedBytes).toBe(text.length); expect(body.expectedSha256).toBe(hash);
    state.backups.push(JSON.parse(text));
    await route.fulfill({ json: { ok: true, id: 'synthetic-backup', name: '検証の控え.json', bytes: text.length, sha256: state.wrongHash ? '内容不一致' : hash } });
  });
  async function login() {
    await page.goto('/outline.html'); await page.getByPlaceholder('メールアドレス').fill(auth.credentials.email);
    await page.getByPlaceholder('パスワード').fill(auth.credentials.password); await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  }
  async function settings() { await page.locator('[data-outline-view]').click(); await expect(page.locator('[data-drive-backup]')).toBeVisible(); }
  return { page, state, entries, scope: { ownerId, docId }, login, settings,
    async close() { doc.free(); await context.close(); await auth.close(); } };
}

test('新同期のDrive控え：画像の貼り付けと未送信の本文を同じ履歴で残し、JSONから独立して読み戻す', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    await f.login(); await expect(f.page.locator('[data-row="memo"]')).toBeVisible();
    f.state.offline = true; await f.page.evaluate(() => window.lab.disconnect());
    await f.page.evaluate(async (scope) => {
      const { openLoroStorage } = await import('/src/loro-storage.js'), { commitOutlineHandoff } = await import('/src/commit-outline-handoff.js');
      const storage = await openLoroStorage(`owner:${scope.ownerId}:${scope.docId}`);
      try {
        const checkpoint = { format: 'taskspace-outline/1', nodes: window.lab.outline(), revision: 1, at: '2026-11-05', complete: true,
          sync: { sequence: 0, pending: [], deleted: [], known: ['memo'] } };
        const record = await storage.captureCutover({ format: 1, ...scope, phase: 'captured', migrationId: crypto.randomUUID(), checkpoint,
          originals: { localRaw: localStorage.getItem('taskspace-outline-v1') } });
        const { receipt } = await commitOutlineHandoff({ storage, checkpoint, ...scope, legacyOwnerId: scope.ownerId,
          activeOwner: () => scope.ownerId, remoteHead: (await storage.read()).cursor });
        await storage.finishCutover(record, receipt.key);
      } finally { storage.close(); }
    }, f.scope);
    await f.page.locator('[data-row="memo"] [data-row-text]').click();
    await f.page.locator('[data-row="memo"] textarea').fill('未送信の追記🌿');
    await f.page.locator('[data-row="memo"] textarea').evaluate((el) => {
      const image = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='), (value) => value.charCodeAt(0));
      const data = new DataTransfer(); data.items.add(new File([image], '検証.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(f.page.locator('[data-row-image]')).toHaveCount(1); expect(f.state.images).toHaveLength(1);
    await expect.poll(() => f.page.locator('[data-row-image]').evaluate((image) => image.naturalWidth)).toBe(1);
    await f.page.evaluate(async () => { window.lab.changeOutline((nodes) => nodes.map((node) => node.id === 'memo' ? node : { ...node, imageWidth: 321 })); await window.lab.localBarrier(); });
    const pending = await f.page.evaluate(async () => (await window.lab.recoveryState()).outbox.map((entry) => entry.id));
    expect(pending.length).toBeGreaterThan(0);
    await f.settings(); await f.page.locator('[data-drive-backup]').click();
    await expect(f.page.locator('[data-drive-backup-state]')).toHaveText('前回の控えを確認済みです');
    expect(f.state.backups).toHaveLength(1);
    const payload = f.state.backups[0], restored = readLoroBackup(payload, f.scope);
    try {
      expect(restored.nodes[0].text).toBe('未送信の追記🌿'); expect(restored.nodes[1].imageWidth).toBe(321);
      expect(restored.nodes[1].text).toContain('synthetic-image'); expect(restored.outbox.map((entry) => entry.id)).toEqual(pending);
      expect(restored.archives).toHaveLength(2);
      expect(restored.archives.find((entry) => entry.key === 'cutover').value.originals.localRaw).toContain('古い端末の保存');
      expect(restored.archives.find((entry) => entry.key.startsWith('handoff:')).value.archive.nodes[0].text).toBe('保存済みのメモ');
      expect(JSON.parse(payload.store['notion-like-taskdb-prototype-v4']).tasks[0].id).toBe('task');
      expect(payload.store['taskspace-font']).toBe('mincho'); expect(payload.store['taskspace-drive-token']).toBeUndefined();
      expect(Object.keys(payload.store).some((key) => key.startsWith('taskspace-lab-auth-'))).toBe(false);
    } finally { restored.doc.free(); }
    expect(await f.page.evaluate(() => JSON.parse(localStorage.getItem('taskspace-outline-v1'))[0].id)).toBe('old');
    expect(await f.page.evaluate(() => window.lab.queued())).toBe(true);
    await expect(f.page.locator('[data-outline-sync-conflict]')).toHaveCount(0); await expect(f.page.locator('[data-error]')).toBeEmpty();
  } finally { await f.close(); }
});

test('新同期の自動控え：保存内容の確認失敗は設定内へ残し、入力を止めずに裏で再試行する', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    await f.page.clock.install(); f.state.wrongHash = true;
    await f.login(); await expect(f.page.locator('[data-row="memo"]')).toBeVisible(); await f.settings();
    await f.page.clock.fastForward(31000);
    await expect(f.page.locator('[data-drive-backup-state]')).toContainText('内容を確認できません');
    expect(await f.page.evaluate(() => localStorage.getItem('taskspace-drive-last-backup'))).toBeNull();
    await expect(f.page.locator('[data-outline-sync-conflict]')).toHaveCount(0); await expect(f.page.locator('[data-error]')).toBeEmpty();
    await f.page.locator('[data-outline-view]').click();
    await f.page.locator('[data-row="memo"] [data-row-text]').click(); await f.page.locator('[data-row="memo"] textarea').fill('控えの再試行中にも書ける');
    await f.page.evaluate(() => window.lab.localBarrier()); f.state.wrongHash = false;
    await f.page.clock.fastForward(61000);
    await expect.poll(() => f.state.backups.length).toBe(2);
    await expect.poll(() => f.page.evaluate(() => localStorage.getItem('taskspace-drive-last-backup'))).not.toBeNull();
    const read = readLoroBackup(f.state.backups[1], f.scope);
    try { expect(read.nodes[0].text).toBe('控えの再試行中にも書ける'); } finally { read.doc.free(); }
    await f.page.clock.fastForward(31000); expect(f.state.backups).toHaveLength(2);
  } finally { await f.close(); }
});

test('新同期の控え：初回取得失敗の空表示では控えを送らず、保存読み出しの失敗後も成功扱いにしない', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    f.state.offline = true; await f.login(); await expect(f.page.locator('[data-product-outline]')).toBeVisible(); await f.settings();
    await expect(f.page.locator('[data-drive-backup]')).toBeDisabled();
    expect(await f.page.evaluate(() => window.lab.recoveryState().then(() => false, () => true))).toBe(true); expect(f.state.backups).toHaveLength(0);
    f.state.offline = false; await f.page.evaluate(() => window.lab.connect()); await expect(f.page.locator('[data-row="memo"]')).toBeVisible();
    await f.page.evaluate(async () => {
      await window.lab.disconnect();
      const original = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) { const result = original.apply(this, args); if (this.name === 'outbox') this.transaction.abort(); return result; };
    });
    await f.page.locator('[data-drive-backup]').click();
    await expect(f.page.locator('[data-drive-backup-state]')).toContainText('再試行を待っています');
    expect(f.state.backups).toHaveLength(0); expect(await f.page.evaluate(() => localStorage.getItem('taskspace-drive-last-backup'))).toBeNull();
    await expect(f.page.locator('[data-row="memo"]')).toBeVisible();
  } finally { await f.close(); }
});
