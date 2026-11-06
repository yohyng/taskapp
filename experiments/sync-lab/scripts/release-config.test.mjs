import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { releaseConfig, sessionClientOptions } from '../src/release-config.js';
import { productionProject } from '../src/staging-config.js';
import { authSession } from '../src/auth-session.js';

const url = `https://${productionProject}.supabase.co`, docId = randomUUID();
const env = { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_publishable_synthetic', VITE_OUTLINE_DOCUMENT_ID: docId, VITE_OUTLINE_CUTOVER: '1' };
const jwt = (payload) => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c3ludGhldGlj`;

test('本番用接続：明示した本番・公開鍵・文書と停止確認を必須にし、秘密の設定をブラウザーへ渡さない', () => {
  const config = releaseConfig({ ...env, LAB_OWNER_PASSWORD: '秘密の合成値', VITE_UNUSED_SECRET: '公開しない合成値' });
  assert.deepEqual(config, { mode: 'production', reference: productionProject, url, key: env.VITE_SUPABASE_ANON_KEY, docId, cutover: true });
  assert.equal(releaseConfig({ ...env, VITE_SUPABASE_URL: `${url}/` }).url, url);
  assert.equal(releaseConfig({ ...env, VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: productionProject }) }).docId, docId);
});

test('本番用接続：欠損・検証先・不正URL・管理鍵・不正文書・停止未確認では旧同期へ逃げず拒む', () => {
  for (const value of [undefined, 'http://' + productionProject + '.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co', `${url}.evil.test`, `${url}/rest/v1`, `${url}?key=secret`]) {
    assert.throws(() => releaseConfig({ ...env, VITE_SUPABASE_URL: value }), /本番のSupabase/);
  }
  for (const key of [undefined, 'sb_secret_sensitive', jwt({ role: 'service_role', ref: productionProject }), jwt({ role: 'anon', ref: 'abcdefghijklmnopqrst' }), '壊れた鍵']) {
    assert.throws(() => releaseConfig({ ...env, VITE_SUPABASE_ANON_KEY: key }), (error) => /公開鍵/.test(error.message) && !error.message.includes('sensitive'));
  }
  for (const value of [undefined, 'not-a-document']) assert.throws(() => releaseConfig({ ...env, VITE_OUTLINE_DOCUMENT_ID: value }), /UUID/);
  for (const value of [undefined, '0', 'true']) assert.throws(() => releaseConfig({ ...env, VITE_OUTLINE_CUTOVER: value }), /旧書き込み停止/);
});

test('本番用認証：従来SDKが保存したログインを新SDKが直接読み、ログインの複製や削除をしない', async () => {
  const values = new Map(), removed = [], writes = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); }, removeItem: (key) => { removed.push(key); values.delete(key); } };
  const ownerId = randomUUID(), now = Math.floor(Date.now() / 1000);
  const session = { access_token: jwt({ sub: ownerId, iat: now, exp: now + 3600 }), refresh_token: randomUUID(), expires_at: now + 3600, token_type: 'bearer', user: { id: ownerId } };
  const fetch = async () => { throw new Error('ログインの引き継ぎに再認証や通信を使わない'); };
  const options = { auth: { storage, autoRefreshToken: false }, global: { fetch } };
  const old = createClient(url, env.VITE_SUPABASE_ANON_KEY, { ...options, global: { fetch: async (request) => {
    assert.equal(new URL(request).pathname, '/auth/v1/user'); return Response.json(session.user);
  } } });
  assert.equal((await old.auth.setSession(session)).error, null);
  const key = old.auth.storageKey;
  writes.length = 0; removed.length = 0;
  const next = createClient(url, env.VITE_SUPABASE_ANON_KEY, { ...sessionClientOptions(releaseConfig(env)), ...options });
  const sessions = authSession(next.auth);
  try {
    await sessions.ready;
    assert.equal(sessions.snapshot()?.user.id, ownerId);
    assert.equal(await sessions.token(ownerId), session.access_token);
    assert.equal(next.auth.storageKey, key);
    assert.deepEqual([...values.keys()], [key]); assert.deepEqual(removed, []);
    assert.ok(writes.every((written) => written === key));
    assert.deepEqual(sessionClientOptions(releaseConfig(env)), {});
    assert.notEqual(sessionClientOptions({ mode: 'staging', reference: productionProject, docId }).auth.storageKey, key);
  } finally { sessions.close(); old.auth.stopAutoRefresh(); next.auth.stopAutoRefresh(); await old.realtime.disconnect(); await next.realtime.disconnect(); }
});
