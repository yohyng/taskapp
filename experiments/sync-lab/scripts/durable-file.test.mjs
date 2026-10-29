import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { durableFile } from './durable-file.mjs';

test('保存確定前にfsyncが失敗したら以前の文書を保ち、再試行で置き換えられる', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-durable-')), file = join(directory, 'document.json');
  await writeFile(file, '以前の保存');
  await assert.rejects(durableFile(file, '新しい本文', { openFile: async (...args) => {
    const handle = await open(...args);
    return { writeFile: (...values) => handle.writeFile(...values), sync: async () => { throw new Error('保存装置の失敗'); }, close: () => handle.close() };
  } }), /保存装置/);
  assert.equal(await readFile(file, 'utf8'), '以前の保存');
  assert.deepEqual(await readdir(directory), ['document.json']);
  await durableFile(file, '新しい本文'); assert.equal(await readFile(file, 'utf8'), '新しい本文');
});

test('ファイル置換が失敗しても以前の保存を先に消さない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-replace-')), file = join(directory, 'document.json');
  await writeFile(file, '以前の保存');
  await assert.rejects(durableFile(file, '新しい本文', { replace: async () => { throw new Error('置換を拒否'); } }), /置換を拒否/);
  assert.equal(await readFile(file, 'utf8'), '以前の保存'); assert.deepEqual(await readdir(directory), ['document.json']);
});
