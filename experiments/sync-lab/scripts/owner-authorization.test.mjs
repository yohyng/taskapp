import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerAuthorization } from './owner-authorization.mjs';

const config = { authUrl: 'https://auth.example.test/auth/v1', apiKey: '公開鍵', ownerId: 'owner', documents: ['outline'] };
const request = (token = 'Bearer token') => ({ headers: { authorization: token } });

test('本人の権限は固定したAuthの応答と文書許可の両方で判定し、端末の本人申告を信じない', async () => {
  const calls = [];
  const authorize = ownerAuthorization({ ...config, fetchUser: async (url, options) => {
    calls.push({ url, options }); return Response.json({ id: options.headers.Authorization === 'Bearer owner-token' ? 'owner' : 'other' });
  } });
  assert.equal(await authorize(request('Bearer owner-token'), 'outline'), 200);
  assert.equal(await authorize(request('Bearer owner-token'), 'other'), 403);
  assert.equal(await authorize(request('Bearer forged-owner'), 'outline'), 403);
  assert.ok(calls.every(({ url, options }) => url === 'https://auth.example.test/auth/v1/user' && options.redirect === 'error' && options.headers.apikey === config.apiKey));
});

test('Authの拒否と障害を区別し、欠けた認証や壊れた応答を許可しない', async () => {
  let reply = Response.json({ id: 'owner' });
  const authorize = ownerAuthorization({ ...config, fetchUser: async () => { if (reply instanceof Error) throw reply; return reply; } });
  for (const value of ['', 'token', 'Bearer a b', `Bearer ${'a'.repeat(8193)}`, ['Bearer token']]) assert.equal(await authorize(request(value), 'outline'), 401);
  assert.equal(await authorize({ headers: {} }, 'outline'), 401);
  for (const status of [401, 403]) { reply = new Response('{}', { status }); assert.equal(await authorize(request(), 'outline'), 401); }
  for (const value of [new Response('{}', { status: 500 }), Response.json({}), new Response('壊れたJSON'), new Error('ネットワーク停止')]) {
    reply = value; assert.equal(await authorize(request(), 'outline'), 503);
  }
});

test('Authの所有者を変更・失効した直後は、前の許可を使い回さない', async () => {
  let status = 200;
  const authorize = ownerAuthorization({ ...config, fetchUser: async () => Response.json({ id: 'owner' }, { status }) });
  assert.equal(await authorize(request(), 'outline'), 200); status = 401;
  assert.equal(await authorize(request(), 'outline'), 401);
});

test('認証先はHTTPSの固定URLに限り、ローカルの代役は明示した試験だけ許可する', () => {
  for (const authUrl of ['http://auth.example.test/auth/v1', 'https://user:password@example.test/auth/v1', 'https://example.test/auth/v1?next=x', 'http://127.0.0.1:1234/auth/v1']) assert.throws(() => ownerAuthorization({ ...config, authUrl }));
  assert.doesNotThrow(() => ownerAuthorization({ ...config, authUrl: 'http://127.0.0.1:1234/auth/v1', allowLocalTestIssuer: true }));
  assert.throws(() => ownerAuthorization({ ...config, documents: [] }));
});
