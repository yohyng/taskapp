import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { LoroDoc } from 'loro-crdt';
import { stagingConfig, documentId } from '../src/staging-config.js';
import { loroSupabaseTransport } from '../src/loro-supabase-transport.js';
import { loroNode } from '../src/loro-model.js';
import { decodeLogTransfer } from '../src/loro-log-transfer.js';

function latch() {
  let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve };
}
async function within(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}が時間内に届きませんでした`)), 15000); })]); }
  finally { clearTimeout(timer); }
}
function checkResponse(result, label) {
  if (result.error) throw new Error(`${label}に失敗しました（HTTP ${result.status || result.error.status || '不明'}）`);
  return result.data;
}
export function verificationConfig(env, manifest) {
  const config = stagingConfig(env), otherDocId = documentId(env.LAB_SUPABASE_OTHER_DOCUMENT_ID);
  if (config.docId === otherDocId) throw new Error('二人の別々の検証文書が必要です');
  for (const name of ['LAB_OWNER_EMAIL', 'LAB_OWNER_PASSWORD', 'LAB_OTHER_EMAIL', 'LAB_OTHER_PASSWORD']) {
    if (!env[name]) throw new Error('検証用二アカウントのメールとパスワードを非公開の環境変数へ設定してください');
  }
  if (env.LAB_OWNER_EMAIL === env.LAB_OTHER_EMAIL) throw new Error('検証用アカウントは二人を指定してください');
  if (manifest?.format !== 1 || manifest.synthetic !== true || manifest.projectRef !== config.reference
    || !Array.isArray(manifest.documents) || manifest.documents.length !== 2
    || manifest.documents[0].documentId !== config.docId || manifest.documents[1].documentId !== otherDocId
    || manifest.documents[0].ownerId === manifest.documents[1].ownerId
    || manifest.documents.some((entry) => !/^[a-f0-9]{64}$/.test(entry.sha256))) throw new Error('同じ検証プロジェクト用に生成した合成文書のmanifestが必要です');
  for (const entry of manifest.documents) documentId(entry.ownerId);
  return { ...config, otherDocId, documents: manifest.documents };
}
// このコマンドは合成文書に編集を追記する。成功判定を通知喪失時のpollへ逃がさず、実配信を直接待つ。
export async function verifyStaging(env, report = console.log) {
  let manifest;
  try { manifest = JSON.parse(await readFile(env.LAB_STAGING_MANIFEST, 'utf8')); }
  catch { throw new Error('生成した合成文書のmanifest.jsonをLAB_STAGING_MANIFESTへ指定してください'); }
  const config = verificationConfig(env, manifest), controller = new AbortController();
  const clients = Array.from({ length: 4 }, () => createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `staging-probe-${randomUUID()}` },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }) },
  }));
  const [a, b, other, anonymous] = clients, cleanups = [], documents = [];
  const rpc = (client, docId, cursor = -1, updates = []) => client.rpc('taskspace_loro_exchange', { p_doc: docId, p_cursor: cursor, p_updates: updates }).abortSignal(AbortSignal.timeout(10000));
  async function denied(client, id, updates = []) {
    const result = await rpc(client, id, -1, updates);
    // SQL/PostgRESTの権限拒否だけを採る。404・ネット障害や構文エラーを成功扱いにしない。
    assert.ok(result.error && result.error.code === '42501', '他人・未認証のRPCが権限拒否されていません');
  }
  async function load(client, id) {
    const doc = new LoroDoc(); documents.push(doc); let cursor = -1, result, snapshotHash;
    do {
      result = checkResponse(await rpc(client, id, cursor), '文書の取得');
      if (cursor === -1) snapshotHash = createHash('sha256').update(Buffer.from(result.snapshot, 'base64')).digest('hex');
      const decoded = decodeLogTransfer(result, false, { cursor, batch: [] });
      for (const bytes of decoded.updates) doc.import(bytes);
      cursor = decoded.cursor;
    } while (cursor < result.head);
    return { doc, cursor, snapshotHash };
  }
  try {
    const credentials = [
      { email: env.LAB_OWNER_EMAIL, password: env.LAB_OWNER_PASSWORD },
      { email: env.LAB_OWNER_EMAIL, password: env.LAB_OWNER_PASSWORD },
      { email: env.LAB_OTHER_EMAIL, password: env.LAB_OTHER_PASSWORD },
    ];
    const identities = [];
    for (let i = 0; i < credentials.length; i++) {
      checkResponse(await clients[i].auth.signInWithPassword(credentials[i]), '検証ログイン');
      identities.push(checkResponse(await clients[i].auth.getUser(), 'サーバーでの本人確認').user.id);
    }
    assert.equal(identities[0], identities[1]); assert.notEqual(identities[0], identities[2]);
    assert.equal(identities[0], config.documents[0].ownerId); assert.equal(identities[2], config.documents[1].ownerId);
    checkResponse(await a.auth.refreshSession(), 'セッションの更新');
    assert.equal(checkResponse(await a.auth.getUser(), '更新後の本人確認').user.id, identities[0]);
    report('認証：同一ユーザーの二接続・別ユーザー・セッション更新をサーバーで確認');
    const heads = checkResponse(await a.from('taskspace_loro_documents').select('id,head').eq('id', config.docId).abortSignal(AbortSignal.timeout(10000)), '所有文書の確認');
    assert.equal(heads.length, 1, '自分の検証文書が見つかりません');
    const state = await load(a, config.docId), receiver = await load(b, config.docId), foreign = await load(other, config.otherDocId);
    assert.equal(state.snapshotHash, config.documents[0].sha256, '合成原本が違う文書です');
    assert.equal(foreign.snapshotHash, config.documents[1].sha256, '別ユーザーの合成原本が違う文書です');
    assert.equal(state.cursor, heads[0].head); assert.equal(receiver.cursor, state.cursor);
    const unchanged = checkResponse(await rpc(a, config.docId), '開いた後の確認');
    assert.equal(unchanged.head, state.cursor, '開いただけで追記されています');
    // 別ユーザーの拒否を読取と正しい形式の書込の両方で確認する。
    const unchangedVersion = state.doc.version(); let blockedUpdate;
    try { blockedUpdate = [{ id: randomUUID(), bytes: Buffer.from(state.doc.export({ mode: 'update', from: unchangedVersion })).toString('base64') }]; }
    finally { unchangedVersion.free(); }
    await denied(anonymous, config.docId); await denied(other, config.docId); await denied(other, config.docId, blockedUpdate);
    await denied(a, config.otherDocId);
    const hidden = checkResponse(await other.from('taskspace_loro_documents').select('id').eq('id', config.docId).abortSignal(AbortSignal.timeout(10000)), 'RLSの確認');
    assert.deepEqual(hidden, []);
    const forbidden = await a.from('taskspace_loro_documents').update({ head: state.cursor + 99 }).eq('id', config.docId).abortSignal(AbortSignal.timeout(10000));
    assert.equal(forbidden.error?.code, '42501', '通知表への直接更新が拒否されていません');
    const token = (await a.auth.getSession()).data.session.access_token, parts = token.split('.');
    assert.equal(parts.length, 3, '実ユーザーのJWTを取得できません');
    // 実JWTの所有者だけを改ざんし、元の署名を残す。単なる不正形式の拒否とは分ける。
    parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()), sub: identities[2] })).toString('base64url');
    const invalidJwt = await fetch(`${config.url}/rest/v1/rpc/taskspace_loro_exchange`, { method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { apikey: config.key, Authorization: `Bearer ${parts.join('.')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_doc: config.docId, p_cursor: -1, p_updates: [] }),
    });
    assert.equal(invalidJwt.status, 401, '署名に合わないJWTが認証層で拒否されていません');
    report('権限：未認証・不正JWT・他人の読書き・直接更新を拒否、RLSで他人の文書を非表示');

    const ready = [latch(), latch(), latch()], received = [latch(), latch()]; let foreignLeaks = 0;
    const watch = (client, id, index, callback) => {
      cleanups.push(loroSupabaseTransport(client).watch(id, (event) => {
        if (event) callback(event);
      }, { onReady: () => ready[index].resolve() }));
    };
    watch(b, config.docId, 0, (event) => received[0].resolve(event));
    watch(other, config.otherDocId, 1, (event) => received[1].resolve(event));
    watch(other, config.docId, 2, () => { foreignLeaks++; });
    await within(Promise.all(ready.map((value) => value.promise)), 'RealtimeのDB変更配信準備');
    const marker = `・実サービス検証${randomUUID()}`;
    async function append(client, id, current) {
      const version = current.doc.version();
      try {
        const text = loroNode(current.doc, 'probe').data.get('text'); text.insert(text.length, marker); current.doc.commit();
        const batch = [{ id: randomUUID(), bytes: current.doc.export({ mode: 'update', from: version }) }];
        const transport = loroSupabaseTransport(client);
        const result = await transport.sync(id, null, controller.signal, { cursor: current.cursor, batch });
        const decoded = decodeLogTransfer(result, false, { cursor: current.cursor, batch });
        assert.equal(decoded.cursor, current.cursor + 1); assert.equal(result.head, decoded.cursor);
        const replay = await transport.sync(id, null, controller.signal, { cursor: current.cursor, batch });
        assert.equal(replay.head, result.head, '同じ編集の再送で二重追記されています');
        return result.head;
      } finally { version.free(); }
    }
    const expectedHead = await append(a, config.docId, state);
    await append(other, config.otherDocId, foreign);
    const events = await within(Promise.all(received.map((value) => value.promise)), 'Realtimeの実変更通知');
    assert.equal(events[0].new.id, config.docId); assert.equal(events[0].new.head, expectedHead);
    assert.equal(events[1].new.id, config.otherDocId);
    report('通知：SDKの購読から二人それぞれの確定済み変更を受信（pollによる代替なし）');
    const after = await load(b, config.docId);
    assert.equal(loroNode(after.doc, 'probe').data.get('text').toString(), loroNode(state.doc, 'probe').data.get('text').toString());
    assert.equal(after.cursor, expectedHead);
    // 他人の通知が後から届く可能性も短い観測窓で確認する。RLS/RPCの拒否試験と併せて扱う。
    await new Promise((resolve) => setTimeout(resolve, 1500)); assert.equal(foreignLeaks, 0, '他人の文書の変更通知が漏れています');
    report('保存：通知後にRPCの全ログから再構築して本文一致、再送の重複なし、他人の通知なし');
    return { projectRef: config.reference, documentId: config.docId, head: expectedHead, realtime: true };
  } finally {
    controller.abort(); for (const stop of cleanups) stop();
    await Promise.allSettled(clients.map((client) => client.removeAllChannels()));
    // signOutは同じユーザーの他接続を失効させ得るので、この一時クライアントの自動更新だけ止める。
    await Promise.allSettled(clients.map((client) => client.auth.stopAutoRefresh()));
    for (const doc of documents) doc.free();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await verifyStaging(process.env))); }
  catch (error) { console.error(`実サービス検証は未完了：${error.message}`); process.exitCode = 1; }
}
