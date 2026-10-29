import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Authサービスの応答だけを代役にする。本物のSupabaseへのログインやJWT署名の試験とは区別する。
export async function ownerFixture(docId, { ownerId = '検証の所有者' } = {}) {
  const tokens = new Map(), apiKey = randomUUID(), refreshTokens = new Map(), accounts = new Map();
  let refreshes = 0, refreshGate, releaseRefresh, refreshStarted;
  const account = (userId) => {
    const value = { email: `${randomUUID()}@example.test`, password: randomUUID(), userId };
    accounts.set(value.email, value); return value;
  };
  const credentials = account(ownerId);
  function issueSession(userId) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    // SDKが読む形式だけを満たす合成値。JWTの署名検証はこの代役では試験していない。
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp: now + 3600, iat: now, jti: randomUUID() })}.${encode(randomUUID())}`;
    const refresh = randomUUID(); tokens.set(`Bearer ${token}`, userId); refreshTokens.set(refresh, userId);
    return { access_token: token, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email: [...accounts.values()].find((value) => value.userId === userId)?.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
  }
  let unavailable = false, child, url, failures = [];
  const issuer = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (unavailable) { response.statusCode = 503; response.end('{}'); return; }
    if (request.headers.apikey !== apiKey) { response.statusCode = 401; response.end('{}'); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      let userId;
      if (url.searchParams.get('grant_type') === 'password') {
        const found = accounts.get(body.email); if (found?.password === body.password) userId = found.userId;
      } else if (url.searchParams.get('grant_type') === 'refresh_token') {
        refreshes++; refreshStarted?.(); await refreshGate;
        userId = refreshTokens.get(body.refresh_token);
      }
      if (!userId) { response.statusCode = 400; response.end(JSON.stringify({ code: 'invalid_credentials', msg: '試験用の認証情報が違います' })); return; }
      response.end(JSON.stringify(issueSession(userId))); return;
    }
    const user = tokens.get(request.headers.authorization);
    if (url.pathname === '/auth/v1/logout' && request.method === 'POST' && user) { tokens.delete(request.headers.authorization); response.statusCode = 204; response.end(); return; }
    if (url.pathname !== '/auth/v1/user' || !user) { response.statusCode = 401; response.end('{}'); return; }
    response.end(JSON.stringify({ id: user }));
  });
  await new Promise((resolve) => issuer.listen(0, '127.0.0.1', resolve));
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-owner-'));
  function wait(type) {
    return new Promise((resolve, reject) => {
      const current = child;
      const timer = setTimeout(() => done(new Error(`子プロセスの応答待ち：${type} ${failures.join('')}`)), 15000);
      function done(error, value) { clearTimeout(timer); current.off('message', message); current.off('exit', exit); error ? reject(error) : resolve(value); }
      function message(value) { if (value.type === type) done(null, value); }
      function exit(code) { done(new Error(`子プロセスが停止：${code} ${failures.join('')}`)); }
      current.on('message', message); current.once('exit', exit);
    });
  }
  async function start() {
    child = fork(new URL('./owner-child.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr.on('data', (data) => failures.push(String(data)));
    const ready = wait('ready');
    child.send({ type: 'start', options: { directory, port: url ? Number(new URL(url).port) : 0, authUrl: `http://127.0.0.1:${issuer.address().port}/auth/v1`, apiKey, ownerId, documents: [docId] } });
    url = (await ready).url;
  }
  const issue = (user = ownerId) => { const token = randomUUID(); tokens.set(`Bearer ${token}`, user); return token; };
  await start();
  return {
    ownerId, directory, issue, credentials, account, apiKey,
    identify: (authorization) => tokens.get(authorization),
    refreshes: () => refreshes,
    holdRefresh() {
      refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
      return new Promise((resolve) => { refreshStarted = resolve; });
    },
    releaseRefresh() { releaseRefresh?.(); refreshGate = undefined; refreshStarted = undefined; },
    revoke: (token) => tokens.delete(`Bearer ${token}`),
    unavailable: (value) => { unavailable = value; },
    async hold() { const held = wait('held'); child.send({ type: 'hold' }); await held; },
    saving: () => wait('saving'),
    release: () => child.send({ type: 'release' }),
    async kill() { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; },
    restart: start,
    async route(page, { afterResponse } = {}) {
      // Viteと分離した実HTTPサーバーへ同一オリジンのAPIだけを転送する。
      await page.route('**/lab/owner-loro/**', async (route) => {
        try {
          const response = await route.fetch({ url: `${url}${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}`, maxRetries: 0 });
          if (await afterResponse?.(route, response)) return;
          await route.fulfill({ response });
        }
        catch { await route.abort('failed').catch(() => {}); }
      });
    },
    async routeAuth(page) {
      await page.route('**/auth/v1/**', async (route) => {
        const target = new URL(route.request().url());
        try { await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${issuer.address().port}${target.pathname}${target.search}`, maxRetries: 0 }) }); }
        catch { await route.abort('failed').catch(() => {}); }
      });
    },
    async state(token, id = docId) { return fetch(`${url}/lab/owner-loro/server-state?doc=${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); },
    async sync(token, body = {}, id = docId) { return fetch(`${url}/lab/owner-loro/sync?doc=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); },
    async close() {
      if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; }
      issuer.closeAllConnections(); await new Promise((resolve) => issuer.close(resolve));
    },
  };
}
