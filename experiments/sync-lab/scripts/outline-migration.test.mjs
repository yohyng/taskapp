import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoroDoc } from 'loro-crdt';
import { prepareMigration } from './prepare-outline-migration.mjs';
import { loroViewRows } from '../src/loro-model.js';
test('移行候補：原本JSONを変更せず控え・同じIDのsnapshot・戻し用JSONを作り、再初期化を拒む', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-migration-')), source = JSON.stringify({ items: [{ id: 'kept', text: '画像 ![](https://example.test/image)', imageWidth: 321, children: [] }] });
  const input = join(directory, 'original.json'), output = join(directory, 'candidate');
  await writeFile(input, source); const manifest = await prepareMigration(input, output);
  assert.equal(manifest.rows, 1); assert.equal(await readFile(input, 'utf8'), source); assert.equal(await readFile(join(output, 'source.json'), 'utf8'), source);
  const doc = new LoroDoc();
  try { doc.import(await readFile(join(output, 'snapshot.bin'))); assert.equal(loroViewRows(doc)[0].id, 'kept'); }
  finally { doc.free(); }
  assert.equal(JSON.parse(await readFile(join(output, 'outline.json'), 'utf8')).items[0].imageWidth, 321);
  await assert.rejects(prepareMigration(input, output), /EEXIST/);
});
