import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { driveRehearsalSetting, checkDriveRehearsalCapability } from './drive-rehearsal-config.mjs';
import { driveRehearsalBackup, rehearsalPng } from './drive-rehearsal-fixture.mjs';
import { readLoroBackup } from '../src/loro-backup.js';

const hash = (data) => createHash('sha256').update(data).digest('hex');
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('検証が時間内に完了しませんでした')), 30000); })]); }
  finally { clearTimeout(timer); }
}
async function restoreAndAppend(page, source, scope) {
  return page.evaluate(async ({ source, scope }) => {
    const { restoreOutlineBackup } = await import('/src/restore-outline-backup.js');
    const { createEngine } = await import('/src/loro-engine.js');
    const { base64 } = await import('/src/loro-log-transfer.js');
    const { readLoroBackup } = await import('/src/loro-backup.js');
    const check = (value) => { if (!value) throw new Error('復元した端末保存の照合が一致しません'); };
    const input = readLoroBackup(source, scope), storageId = `owner:${scope.ownerId}:${scope.docId}`;
    try {
      return await navigator.locks.request(`taskspace-loro:${storageId}`, async () => {
        const options = { source, ...scope, storageId, activeOwner: () => scope.ownerId };
        const first = await restoreOutlineBackup(options); check(first.applied);
        const transport = { watch: () => () => {}, sync: async () => { throw new Error('この復元検証では同期先へ送信しません'); } };
        const open = () => createEngine({ docId: scope.docId, storageId, offline: true, transport });
        let engine = await open();
        try {
          check(JSON.stringify(engine.outline()) === JSON.stringify(input.nodes));
          const saved = await engine.recoveryState();
          check(JSON.stringify(saved.outbox.map((entry) => ({ id: entry.id, bytes: base64(entry.bytes) }))) === JSON.stringify(input.payload.outlineSync.outbox));
          check(saved.archives.length === input.archives.length);
          engine.insertText('memo', 0, '復元したあとも追記：'); await engine.localBarrier();
        } finally { await engine.dispose(); }
        const replay = await restoreOutlineBackup(options); check(replay.applied === false);
        engine = await open();
        try {
          check(engine.outline().find((node) => node.id === 'memo').text === '復元したあとも追記：' + input.nodes.find((node) => node.id === 'memo').text);
          check(engine.outline().find((node) => node.id === 'image').imageWidth === 321);
          const saved = await engine.recoveryState();
          check(saved.outbox.length === input.outbox.length + 1);
          check(input.outbox.every((entry) => saved.outbox.some((pending) => pending.id === entry.id && base64(pending.bytes) === base64(entry.bytes))));
          return { restoredRows: engine.outline().length, retainedPending: input.outbox.length,
            archives: saved.archives.length, restoreIdempotent: true, appendDurable: true };
        } finally { await engine.dispose(); }
      });
    } finally { input.doc.free(); }
  }, { source, scope });
}

// 生成済みの隔離先だけへ合成ファイルを作る。通常のGASや利用者の保存データは入力にしない。
export async function verifyDriveRehearsal(directory, { url, localRecoveryOnly = false } = {}) {
  let phase = '設定', server, browser;
  try {
    let manifest, setting;
    if (!localRecoveryOnly) {
      manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
      const privateSetting = JSON.parse(await readFile(resolve(directory, 'settings.private.json'), 'utf8'));
      setting = driveRehearsalSetting({ ...privateSetting, url: url || privateSetting.url }, manifest);
    }
    const root = fileURLToPath(new URL('..', import.meta.url));
    const driveModule = '/@fs/' + fileURLToPath(new URL('../../../src/lib/drive.js', import.meta.url)).replaceAll('\\', '/');
    server = await createServer({ root, mode: 'drive-rehearsal', logLevel: 'error',
      plugins: [{ name: '隔離したDrive検証の入口', configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (request.url !== '/drive-rehearsal.html') return next();
        response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><title>Drive隔離検証</title><p data-error></p>');
      }); } }], server: { host: '127.0.0.1', port: 4185, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } } });
    await server.listen(); browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ serviceWorkers: 'block' }); await page.goto('http://127.0.0.1:4185/drive-rehearsal.html');
    let imageUrl = 'https://example.test/isolated-recovery.png', uploadedImage, backup, source;
    async function readback(action, id) {
      return within(page.evaluate(async ({ setting, action, id }) => {
        const query = new URLSearchParams({ token: setting.token, action, id });
        const response = await fetch(setting.url + '?' + query, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('検証先の保存ファイルを読み戻せません');
        return response.json();
      }, { setting, action, id }));
    }
    if (!localRecoveryOnly) {
      phase = '隔離先と整理なしの確認';
      const capability = await within(page.evaluate(async ({ setting, driveModule }) => (await import(driveModule)).pingDrive(setting), { setting, driveModule }));
      checkDriveRehearsalCapability(capability, manifest);
      phase = '画像の保存';
      uploadedImage = await within(page.evaluate(async ({ setting, driveModule, png }) => {
        const bytes = Uint8Array.from(atob(png), (byte) => byte.charCodeAt(0));
        return (await import(driveModule)).uploadToDrive(new File([bytes], '検証用.png', { type: 'image/png' }), setting, { hint: '同期検証だけの画像', where: '隔離検証' });
      }, { setting, driveModule, png: rehearsalPng }));
      assert.equal(typeof uploadedImage.id, 'string'); imageUrl = uploadedImage.url;
      const imageAddress = new URL(imageUrl);
      assert.equal(imageAddress.origin, 'https://drive.google.com'); assert.equal(imageAddress.searchParams.get('id'), uploadedImage.id);
      phase = '画像実体の読戻し';
      const image = await readback('readImage', uploadedImage.id);
      assert.equal(image.ok, true); assert.equal(image.dataBase64, rehearsalPng); assert.equal(image.sha256, hash(Buffer.from(rehearsalPng, 'base64')));
      phase = '画像の表示';
      await page.evaluate((url) => { const image = document.createElement('img'); image.setAttribute('data-drive-rehearsal-image', ''); image.src = url; document.body.appendChild(image); }, imageUrl);
      await page.waitForFunction(() => document.querySelector('[data-drive-rehearsal-image]')?.naturalWidth > 0, null, { timeout: 20000 });
    }
    const fixture = await driveRehearsalBackup(imageUrl), { payload, scope } = fixture;
    source = JSON.stringify(payload);
    if (!localRecoveryOnly) {
      phase = '新履歴入り控えの保存';
      backup = await within(page.evaluate(async ({ payload, setting, driveModule }) => (await import(driveModule)).backupToDrive(payload, setting), { payload, setting, driveModule }));
      phase = '控えの読戻しと内容照合';
      const recovered = await readback('readBackup', backup.id);
      assert.equal(recovered.ok, true); assert.equal(recovered.text, source); assert.equal(recovered.sha256, hash(source)); assert.equal(recovered.bytes, source.length);
      source = recovered.text;
    }
    const read = readLoroBackup(source, scope);
    try { assert.equal(read.outbox.length, 1); assert.equal(read.archives.length, 2); } finally { read.doc.free(); }
    phase = '端末復元と再開後の追記'; const restored = await within(restoreAndAppend(page, source, scope));
    return { complete: true, localRecoveryOnly, realDrive: !localRecoveryOnly, folderId: manifest?.folderId,
      imageId: uploadedImage?.id, backupId: backup?.id, backupSha256: hash(source), ...restored, productionChanged: false };
  } catch (error) { return { complete: false, phase, errorType: error.name, localRecoveryOnly }; }
  finally { await browser?.close(); await server?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const localRecoveryOnly = process.argv.includes('--local-recovery');
  const result = await verifyDriveRehearsal(resolve(process.argv[2] || '.data/drive-rehearsal-2026-11-06'), { url: process.argv.find((value) => value.startsWith('https://')), localRecoveryOnly });
  console.log(JSON.stringify(result)); if (!result.complete) process.exitCode = 1;
}
