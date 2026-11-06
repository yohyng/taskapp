import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = (text) => createHash('sha256').update(text).digest('hex');
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('通常GASの構造が変わったため、検証版の生成を中止しました');
  return source.replace(before, after);
}
// 本番の設定や合言葉を受け取らず、新しい検証フォルダーと専用の合言葉だけを使う。
export async function prepareDriveRehearsal(directory, folderId) {
  if (typeof folderId !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(folderId)) throw new Error('新しく作った検証フォルダーのIDが必要です');
  const original = await readFile(new URL('../../../docs/gas-image-upload.gs', import.meta.url), 'utf8');
  const extra = await readFile(new URL('../infra/drive-rehearsal-readback.gs', import.meta.url), 'utf8');
  const token = randomBytes(32).toString('hex'), rehearsalId = randomUUID();
  let gas = replaceOnce(original, 'const FOLDER_ID = "ここにフォルダの ID";', `const FOLDER_ID = ${JSON.stringify(folderId)};`);
  gas = replaceOnce(gas, 'const TOKEN = "ここに合言葉";', `const TOKEN = ${JSON.stringify(token)};\nconst REHEARSAL_ID = ${JSON.stringify(rehearsalId)};`);
  gas = replaceOnce(gas, 'const KEEP_BACKUPS = 30;', 'const KEEP_BACKUPS = Number.MAX_SAFE_INTEGER;');
  gas = replaceOnce(gas, 'prune(box, KEEP_BACKUPS);', '// 検証先では既存の控えを整理しない。');
  gas = replaceOnce(gas, 'function doGet(e) {', 'function legacyDoGet(e) {');
  gas = '// Task Spaceの隔離検証専用。新しいGASプロジェクトへ貼る。既存のGASは置き換えない。\n' + gas + '\n' + extra;
  const manifest = { format: 1, kind: 'drive-rehearsal', synthetic: true, folderId, rehearsalId,
    retentionEnabled: false, sourceSha256: digest(original), gasSha256: digest(gas) };
  await mkdir(directory);
  await writeFile(join(directory, '検証用GAS.gs'), gas, { flag: 'wx' });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  await writeFile(join(directory, 'settings.private.json'), JSON.stringify({ url: '', token, folderId, rehearsalId }, null, 2), { flag: 'wx' });
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , directory, folderId] = process.argv;
  const manifest = await prepareDriveRehearsal(directory, folderId);
  console.log(JSON.stringify({ folderId: manifest.folderId, rehearsalId: manifest.rehearsalId, retentionEnabled: false }));
}
