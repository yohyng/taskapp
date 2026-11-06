import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLoroBackup } from '../src/loro-backup.js';
import { loroViewRows } from '../src/loro-model.js';

// 控えを検証し、新しいフォルダーへ復元候補を展開する。生きた端末やDBの置換は行わない。
export async function prepareLoroRecovery(input, directory, scope) {
  const source = await readFile(input), read = readLoroBackup(source.toString('utf8'), scope);
  try {
    const json = (value) => JSON.stringify(value, null, 2);
    const files = { 'source.json': source, 'snapshot.bin': read.snapshot,
      'outbox.json': json(read.payload.outlineSync.outbox), 'archives.json': json(read.archives),
      'store.json': json(read.payload.store),
      'outline.json': json({ app: 'taskspace-outline', version: 1, items: read.nodes }) };
    if (read.pending !== null) files['pending.bin'] = read.pending;
    const manifest = { format: 1, ownerId: scope.ownerId, docId: scope.docId, cursor: read.cursor,
      rows: loroViewRows(read.doc).length, queued: read.outbox.length, archives: read.archives.length, applied: false,
      files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])) };
    // 同じ場所へ作り直さない。manifestを最後に残せた場合だけ候補の展開完了と扱う。
    await mkdir(directory);
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(directory, name), bytes, { flag: 'wx' });
    await writeFile(join(directory, 'manifest.json'), json(manifest), { flag: 'wx' });
    return manifest;
  } finally { read.doc.free(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, directory, ownerId, docId] = process.argv;
  if (!input || !directory || !ownerId || !docId) throw new Error('控えJSON・新規出力フォルダー・所有者UUID・文書UUIDを指定してください');
  console.log(JSON.stringify(await prepareLoroRecovery(input, directory, { ownerId, docId })));
}
