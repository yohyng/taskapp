import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verificationConfig } from './verify-supabase-staging.mjs';
import { stagingConfig, documentId } from '../src/staging-config.js';
import { stagingTables } from './prepare-staging-cutover.mjs';

export function cutoverVerificationConfig(env, manifest, source) {
  const previous = verificationConfig(env, source);
  if (manifest?.format !== 1 || manifest.kind !== 'staging-cutover' || manifest.synthetic !== true
    || manifest.projectRef !== previous.reference || manifest.ownerId !== previous.documents[0].ownerId
    || JSON.stringify(manifest.sourceDocuments) !== JSON.stringify(previous.documents)
    || !/^[a-f0-9]{64}$/.test(manifest.snapshotSha256 || '') || !/^[a-f0-9]{64}$/.test(manifest.sqlSha256 || '')
    || previous.documents.some((entry) => entry.documentId === manifest.documentId)) throw new Error('同じ検証先の切り替えmanifestが必要です');
  documentId(manifest.ownerId); documentId(manifest.migrationId);
  return stagingConfig({ ...env, LAB_SUPABASE_DOCUMENT_ID: manifest.documentId, LAB_SUPABASE_CUTOVER: '1' });
}

// SQL適用後の確認。新文書へは追記せず、旧表へのゼロ行UPDATEで停止を確かめる。
export async function verifyStagingCutover(env, manifest, source) {
  const config = cutoverVerificationConfig(env, manifest, source);
  const clients = Array.from({ length: 2 }, () => createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: randomUUID() },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) },
  }));
  try {
    for (const [index, prefix] of ['OWNER', 'OTHER'].entries()) {
      const signed = await clients[index].auth.signInWithPassword({ email: env[`LAB_${prefix}_EMAIL`], password: env[`LAB_${prefix}_PASSWORD`] });
      assert.equal(signed.error, null, '検証ユーザーでログインできません');
      assert.equal(signed.data.user.id, source.documents[index].ownerId);
    }
    const [owner, other] = clients, route = await owner.rpc('taskspace_loro_cutover_route');
    assert.equal(route.error, null, '切り替えSQLを確認できません');
    assert.deepEqual(route.data, { format: 1, migrationId: manifest.migrationId, ownerId: manifest.ownerId, docId: config.docId, legacyWritesBlocked: true });
    const foreignRoute = await other.rpc('taskspace_loro_cutover_route');
    assert.equal(foreignRoute.error?.code, '42501');
    const native = await owner.rpc('taskspace_loro_exchange', { p_doc: config.docId, p_cursor: -1, p_updates: [] });
    assert.equal(native.error, null);
    assert.equal(createHash('sha256').update(Buffer.from(native.data.snapshot, 'base64')).digest('hex'), manifest.snapshotSha256);
    for (const table of stagingTables) {
      const result = await owner.from(table).select('*').limit(1);
      assert.equal(result.error, null, '通常アプリ用の表を確認できません');
      const hidden = await other.from(table).select('*').limit(1);
      assert.equal(hidden.error, null); assert.deepEqual(hidden.data, []);
    }
    const frozen = await owner.from('outline_nodes').update({ text: '' }).eq('id', `存在しない行-${randomUUID()}`);
    assert.equal(frozen.error?.code, '55000', '旧同期の書き込み停止を確認できません');
    const head = await owner.from('taskspace_loro_documents').select('head').eq('id', config.docId).single();
    assert.equal(head.error, null); assert.equal(head.data.head, native.data.head, '確認だけで新文書が変更されています');
    return { complete: true, projectRef: config.reference, head: head.data.head, legacyWritesBlocked: true, appTables: stagingTables.length };
  } finally {
    await Promise.allSettled(clients.map(async (client) => { await client.removeAllChannels(); await client.auth.stopAutoRefresh(); }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const source = JSON.parse(await readFile(process.env.LAB_STAGING_MANIFEST, 'utf8'));
    console.log(JSON.stringify(await verifyStagingCutover(process.env, manifest, source)));
  } catch {
    // SDKの例外や応答に認証値が含まれる可能性があるため、元のオブジェクトは出力しない。
    console.error('検証用の切り替え確認は未完了です。設定・SQLの適用状態を確認してください'); process.exitCode = 1;
  }
}
