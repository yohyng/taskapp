import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loroTransport } from '../src/loro-transport.js';

test('401の一度だけ新しい認証を取得し、同じ差分を再送する。トークンはURLと本文へ入れない', async () => {
  const refreshes = [], calls = [], value = { version: [1], updates: [[2]], bootstrap: false };
  const transport = loroTransport({ endpoint: '/owner', getAccessToken: async ({ refresh }) => { refreshes.push(refresh); return refresh ? 'new' : 'old'; },
    fetchRequest: async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? new Response('{}', { status: 401 }) : Response.json({ mode: 'update' }); },
  });
  assert.deepEqual(await transport.sync('文書', value), { mode: 'update' }); assert.deepEqual(refreshes, [false, true]);
  assert.equal(calls[0].url, calls[1].url); assert.equal(calls[0].options.body, JSON.stringify(value)); assert.equal(calls[1].options.body, JSON.stringify(value));
  assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer old'); assert.equal(calls[1].options.headers.get('Authorization'), 'Bearer new');
});

test('再認証の失敗・権限拒否・Auth障害で成功を返さず、無制限に再認証しない', async () => {
  for (const status of [401, 403, 503]) {
    let calls = 0;
    const transport = loroTransport({ getAccessToken: async () => 'token', fetchRequest: async () => { calls++; return new Response('{}', { status }); } });
    await assert.rejects(transport.sync('outline', {}), (error) => error.status === status);
    assert.equal(calls, status === 401 ? 2 : 1);
  }
  const transport = loroTransport({ getAccessToken: async () => null, fetchRequest: async () => assert.fail('未認証の送信は禁止') });
  await assert.rejects(transport.serverState('outline'), (error) => error.status === 401);
});
