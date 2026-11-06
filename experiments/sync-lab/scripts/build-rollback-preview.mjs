import { mkdir, writeFile, symlink, readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const rollbackRef = '3ef9a0d1aedde4491b22b236ecaf36ba714291e2';
const lab = fileURLToPath(new URL('../', import.meta.url)), repository = resolve(lab, '../..');
export async function buildRollbackPreview(directory = join(lab, '.data/rollback-0.18.0')) {
  const target = resolve(directory), inside = relative(join(lab, '.data'), target);
  if (!inside || inside.startsWith('..') || isAbsolute(inside) || resolve(lab, '.data', inside) !== target) throw new Error('検証室の.data内の新規フォルダーを指定してください');
  if (execFileSync('git', ['rev-parse', `${rollbackRef}^{commit}`], { cwd: repository, encoding: 'utf8' }).trim() !== rollbackRef) throw new Error('切り戻し候補のコミットを確認できません');
  await mkdir(join(lab, '.data'), { recursive: true });
  await mkdir(target);
  const source = join(target, 'source'), preview = join(target, 'preview'), archive = join(target, 'source.tar');
  await mkdir(source);
  await writeFile(archive, execFileSync('git', ['archive', '--format=tar', rollbackRef], { cwd: repository, maxBuffer: 100 * 1024 * 1024 }));
  execFileSync('tar', ['-xf', archive, '-C', source]);
  // 固定コミットのコードを使い、既存の同じlockfileの依存を参照する。インストールや公開はしない。
  await symlink(join(repository, 'node_modules'), join(source, 'node_modules'), 'junction');
  const oldLab = join(source, 'experiments/sync-lab');
  await symlink(join(lab, 'node_modules'), join(oldLab, 'node_modules'), 'junction');
  execFileSync(process.execPath, [join(lab, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', preview], { cwd: oldLab, stdio: 'inherit' });
  const files = {};
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else files[relative(preview, path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await inspect(preview);
  const manifest = { format: 1, ref: rollbackRef, mode: 'fixture', files };
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildRollbackPreview(process.argv[2]); console.log('0.18.0の互換性検証用ビルドを作成しました（公開はしていません）');
}
