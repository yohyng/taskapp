import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replaceFile } from './replace-file.mjs';

test('一時的なロック中は古い保存を保ち、解消してから置き換える', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'taskspace-lab-store-'));
  const source = join(folder, 'new.tmp'), target = join(folder, 'current.bin');
  await writeFile(source, '新しい内容'); await writeFile(target, '古い内容');
  let attempts = 0;
  try {
    await replaceFile(source, target, { wait: async () => {}, replace: async (...paths) => {
      if (++attempts < 3) { assert.equal(await readFile(target, 'utf8'), '古い内容'); throw Object.assign(new Error('一時的なロック'), { code: 'EPERM' }); }
      await rename(...paths);
    } });
    assert.equal(await readFile(target, 'utf8'), '新しい内容');
    assert.equal(attempts, 3);
  } finally { await unlink(source).catch(() => {}); await unlink(target); await rmdir(folder); }
});
test('ディスク障害を成功扱いせず、そのまま失敗を返す', async () => {
  let attempts = 0;
  await assert.rejects(replaceFile('新しい写し', '古い保存', { wait: async () => {}, replace: async () => { attempts++; throw Object.assign(new Error('ディスク障害'), { code: 'EIO' }); } }), { code: 'EIO' });
  assert.equal(attempts, 1);
});
test('ロックが解消しなければ上限で失敗を返す', async () => {
  let attempts = 0;
  await assert.rejects(replaceFile('新しい写し', '古い保存', { wait: async () => {}, replace: async () => { attempts++; throw Object.assign(new Error('ロック継続'), { code: 'EPERM' }); } }), { code: 'EPERM' });
  assert.equal(attempts, 6);
});
