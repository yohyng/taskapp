import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedOutlineDocument } from '../src/outline-model.js';
import { loroViewRows } from '../src/loro-model.js';
import { outlineNodes } from '../src/outline-model.js';

// 書き出しから移行候補を作るだけ。本番DB・既存端末保存には接続せず、元ファイルを残す。
export async function prepareMigration(input, directory) {
  const source = await readFile(input), raw = JSON.parse(source);
  const nodes = Array.isArray(raw) ? raw : raw.items || raw.outline?.nodes;
  if (!Array.isArray(nodes) || !nodes.length) throw new Error('空でないアウトラインの書き出しが必要です');
  const doc = seedOutlineDocument(nodes);
  try {
    const snapshot = doc.export({ mode: 'snapshot' }), restored = outlineNodes(loroViewRows(doc));
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const manifest = { format: 1, documentId: randomUUID(), rows: loroViewRows(doc).length, sourceSha256: hash(source), snapshotSha256: hash(snapshot), cutoff: 0 };
    // 既存フォルダーの再利用を拒み、別の履歴で同じ文書をうっかり再初期化しない。
    await mkdir(directory);
    await writeFile(join(directory, 'source.json'), source, { flag: 'wx' });
    await writeFile(join(directory, 'snapshot.bin'), snapshot, { flag: 'wx' });
    await writeFile(join(directory, 'outline.json'), JSON.stringify({ items: restored }), { flag: 'wx' });
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    return manifest;
  } finally { doc.free(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, directory] = process.argv;
  if (!input || !directory) throw new Error('入力JSONと新規出力フォルダーを指定してください');
  console.log(JSON.stringify(await prepareMigration(input, directory)));
}
