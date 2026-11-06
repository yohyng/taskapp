import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { prepareDriveRehearsal } from './prepare-drive-rehearsal.mjs';
import { driveRehearsalSetting, checkDriveRehearsalCapability } from './drive-rehearsal-config.mjs';
import { driveRehearsalBackup, rehearsalPng } from './drive-rehearsal-fixture.mjs';
import { readLoroBackup } from '../src/loro-backup.js';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const iterator = (items) => { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; };
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'taskspace-drive-rehearsal-')), directory = join(parent, 'generated');
  const manifest = await prepareDriveRehearsal(directory, 'synthetic-new-folder-1234567890');
  const settings = JSON.parse(await readFile(join(directory, 'settings.private.json'), 'utf8'));
  return { directory, manifest, settings, source: await readFile(join(directory, '検証用GAS.gs'), 'utf8') };
}
function gas(f) {
  const files = new Map(), trashed = [], lookups = [], folders = new Map();
  function folder(id, parent) {
    const children = new Map(), value = { getId: () => id, getName: () => id, getParents: () => iterator(parent ? [parent] : []),
      getFoldersByName: (name) => iterator(children.has(name) ? [children.get(name)] : []),
      createFolder: (name) => { const child = folder(id + '/' + name, value); children.set(name, child); return child; },
      getFiles: () => iterator(Array.from({ length: 35 }, (_, i) => ({ getName: () => String(i), setTrashed: () => trashed.push('old') }))),
      createFile: (first, text, mime) => {
        const blob = typeof first === 'string' ? { bytes: Buffer.from(text), mime, name: first } : first;
        const id = `new-${files.size}`, file = { getId: () => id, getName: () => blob.name, getMimeType: () => blob.mime,
          getParents: () => iterator([value]), getBlob: () => ({ getDataAsString: () => blob.bytes.toString('utf8'), getBytes: () => [...blob.bytes] }),
          setTrashed: () => trashed.push(id), setDescription() {}, setSharing() {} };
        files.set(id, file); return file;
      } };
    folders.set(id, value); return value;
  }
  folder(f.manifest.folderId); const foreign = folder('outside');
  const outside = foreign.createFile('private.json', '{"秘密":"読ませない"}', 'application/json');
  const context = { DriveApp: { getFolderById: (id) => { lookups.push(id); if (!folders.has(id)) throw new Error('未知の保存先'); return folders.get(id); },
    getFileById: (id) => files.get(id), Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }) },
  Utilities: { base64Decode: (text) => Buffer.from(text, 'base64'), base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    newBlob: (bytes, mime, name) => ({ bytes: Buffer.from(bytes), mime, name }), ungzip: (blob) => ({ getDataAsString: () => gunzipSync(blob.bytes).toString('utf8') }),
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 }, computeDigest: (_algorithm, text) => [...createHash('sha256').update(typeof text === 'string' ? text : Buffer.from(text)).digest()] } };
  runInNewContext(f.source, context);
  return { files, trashed, lookups, outside,
    get: (parameters = {}) => context.doGet({ parameter: { token: f.settings.token, ...parameters } }),
    post: (body) => context.doPost({ postData: { contents: JSON.stringify({ token: f.settings.token, ...body }) } }) };
}

test('Drive隔離準備：通常GASを変えず、専用設定・整理なしの版を作り、再初期化を拒む', async () => {
  const f = await fixture();
  assert.equal(hash(f.source), f.manifest.gasSha256);
  assert.equal(hash(await readFile(new URL('../../../docs/gas-image-upload.gs', import.meta.url))), f.manifest.sourceSha256);
  assert.equal(f.settings.url, ''); assert.match(f.settings.token, /^[a-f0-9]{64}$/);
  await assert.rejects(prepareDriveRehearsal(f.directory, f.manifest.folderId), /EEXIST/);
  await assert.rejects(prepareDriveRehearsal(f.directory + '-invalid', 'root'), /検証フォルダー/);
});

test('Drive隔離設定：通常URL・別の保存先・古いGAS・整理ありでは送信を許可しない', async () => {
  const f = await fixture(), setting = { ...f.settings, url: 'https://script.google.com/macros/s/synthetic-deployment/exec' };
  assert.equal(driveRehearsalSetting(setting, f.manifest).url, setting.url);
  for (const url of ['https://script.google.com/macros/s/AKfycbw96279gNABhd3XrZVxzRg5jt05HpUKnbVW3h-flqdmxtSo4Hl9jS6wxkvkoZEBuvld/exec',
    'https://example.test/macros/s/synthetic/exec', setting.url + '?token=private', setting.url.replace('/exec', '/dev')]) {
    assert.throws(() => driveRehearsalSetting({ ...setting, url }, f.manifest));
  }
  assert.throws(() => driveRehearsalSetting({ ...setting, folderId: 'different-folder-123456789' }, f.manifest));
  const capability = gas(f).get(); checkDriveRehearsalCapability(capability, f.manifest);
  for (const value of [{ ok: true, backupProtocol: 2 }, { ...capability, retentionEnabled: true }, { ...capability, rehearsalId: 'other' }]) {
    assert.throws(() => checkDriveRehearsalCapability(value, f.manifest));
  }
});

for (const compressed of [false, true]) test(`Drive隔離GAS：${compressed ? 'gzip' : 'JSON'}の新履歴を保存・読み戻しても、35件の古い控えを整理しない`, async () => {
  const f = await fixture(), api = gas(f), { payload, scope } = await driveRehearsalBackup('https://example.test/synthetic.png');
  const text = JSON.stringify(payload), got = api.post({ kind: 'backup', expectedBytes: text.length, expectedSha256: hash(text),
    ...(compressed ? { gzipBase64: gzipSync(text).toString('base64') } : { json: text }) });
  assert.equal(got.ok, true); assert.equal(got.sha256, hash(text)); assert.deepEqual(api.trashed, []);
  const readback = api.get({ action: 'readBackup', id: got.id }); assert.equal(readback.text, text); assert.equal(readback.sha256, hash(text));
  const read = readLoroBackup(readback.text, scope);
  try { assert.equal(read.outbox.length, 1); assert.equal(read.archives.length, 2); assert.equal(read.nodes[1].imageWidth, 321); }
  finally { read.doc.free(); }
  assert.equal(payload.store['taskspace-drive-token'], undefined); assert.equal(payload.store['taskspace-lab-auth-synthetic'], undefined);
});

test('Drive隔離GAS：画像の実体とハッシュを読み戻し、検証外ファイルと合言葉なしの要求を拒む', async () => {
  const f = await fixture(), api = gas(f);
  const got = api.post({ name: 'synthetic.png', mimeType: 'image/png', folder: '2026/11', dataBase64: rehearsalPng });
  const image = api.get({ action: 'readImage', id: got.id });
  assert.equal(image.dataBase64, rehearsalPng); assert.equal(image.sha256, hash(Buffer.from(rehearsalPng, 'base64')));
  assert.ok(api.get({ action: 'readBackup', id: api.outside.getId() }).error);
  const count = api.lookups.length;
  assert.ok(api.get({ token: 'wrong' }).error); assert.ok(api.post({ token: 'wrong', kind: 'backup', json: '{}' }).error);
  assert.equal(api.lookups.length, count); assert.deepEqual(api.trashed, []);
});

test('Drive隔離GAS：壊れた控えや内容不一致では新規保存・古い控えの整理を行わない', async () => {
  const f = await fixture(), api = gas(f), initial = api.files.size;
  const { payload } = await driveRehearsalBackup('https://example.test/synthetic.png');
  for (const body of [{}, { json: '{}' }, { gzipBase64: 'broken' }, { json: JSON.stringify(payload), expectedSha256: '0'.repeat(64) }]) assert.ok(api.post({ kind: 'backup', ...body }).error);
  assert.equal(api.files.size, initial); assert.deepEqual(api.trashed, []);
});
