import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUTLINE_FORMAT } from '../../../src/lib/outline-checkpoint.js';
import { planLegacyOutlineHandoff } from '../src/legacy-outline-handoff.js';

// 旧端末のJSONと新側のJSONを読むだけ。所有者確認や新文書への適用を代行せず、
// 検証済みの候補も本番切替や旧キュー削除の根拠にはしない。
export async function prepareHandoff(input, latestInput, directory) {
  const source = await readFile(input), latestSource = await readFile(latestInput);
  const exported = JSON.parse(source), latest = JSON.parse(latestSource), diagnostic = exported.syncDiagnostic;
  if (exported.app !== 'taskspace-outline' || exported.version !== 1 || !diagnostic) {
    throw new Error('未送信の記録を含むアウトラインの書き出しが必要です');
  }
  const checkpoint = { format: OUTLINE_FORMAT, nodes: exported.items, revision: diagnostic.revision, at: diagnostic.at, sync: diagnostic.sync };
  const plan = planLegacyOutlineHandoff(checkpoint, Array.isArray(latest) ? latest : latest.items);
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const manifest = { format: 1, sourceSha256: hash(source), latestSha256: hash(latestSource),
    pending: checkpoint.sync.pending.length, changes: plan.changes.length, settled: plan.settled.length,
    retained: new Set(plan.retained.map((entry) => entry.id)).size, applied: false };
  await mkdir(directory);
  await writeFile(join(directory, 'source.json'), source, { flag: 'wx' });
  await writeFile(join(directory, 'latest.json'), latestSource, { flag: 'wx' });
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan), { flag: 'wx' });
  // manifestが最後まで書けたフォルダーだけを、候補作成が完了したものと扱う。
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, latest, directory] = process.argv;
  if (!input || !latest || !directory) throw new Error('旧端末JSON・最新JSON・新規出力フォルダーを指定してください');
  console.log(JSON.stringify(await prepareHandoff(input, latest, directory)));
}
