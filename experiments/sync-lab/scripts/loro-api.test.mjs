import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LoroDoc } from 'loro-crdt';
import { loroApi } from './loro-api.mjs';
import { durableFile } from './durable-file.mjs';
import { loroNode, loroViewRows } from '../src/loro-model.js';
import { loroSyncRequest } from '../src/loro-transfer.js';

test('置換後の保存確定に失敗した場合、同じ操作の再送も保存成功まで完了を返さない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-api-'));
  let fail = false, stores = 0;
  const api = await loroApi(directory, { async save(file, contents) {
    stores++; await durableFile(file, contents);
    if (fail) throw new Error('置換後の保存確定に失敗');
  } });
  const server = createServer((request, response) => api.middleware(request, response, () => response.end('{}')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/lab/loro/sync?doc=retry`, doc = new LoroDoc();
  const send = (body) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const initial = await send(loroSyncRequest(doc, [])); doc.import(Uint8Array.from((await initial.json()).update));
    const outbox = [], stop = doc.subscribeLocalUpdates((bytes) => outbox.push({ id: '操作', bytes: bytes.slice() }));
    loroNode(doc, 'row-0').data.get('text').insert(0, '確定待ち：'); doc.commit(); stop();
    const request = loroSyncRequest(doc, outbox); fail = true;
    assert.equal((await send(request)).status, 500); assert.equal(stores, 2);
    assert.equal((await send(request)).status, 500); assert.equal(stores, 3);
    fail = false; assert.equal((await send(request)).status, 200); assert.equal(stores, 4);
    const saved = await (await fetch(endpoint.replace('/sync?', '/server-state?'))).json();
    assert.deepEqual(saved.rows, loroViewRows(doc)); assert.equal(saved.rows[0].text, '確定待ち：最初のメモ');
  } finally { doc.free(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await api.close(); }
});

test('認証経路を権限関数なしで起動できない', async () => {
  await assert.rejects(loroApi('使用しない', { prefix: '/lab/owner-loro' }), /権限検査/);
});
