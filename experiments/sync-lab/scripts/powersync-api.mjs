import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import pg from 'pg';
import { mergeObservedFields } from './field-merge.mjs';
import { mergeTreeCommand } from '../src/tree-model.js';

const validDoc = (value) => /^[a-zA-Z0-9_-]{1,120}$/.test(value);
export async function powerSyncApi() {
  if (process.env.LAB_POWERSYNC !== '1') return null;
  const uri = process.env.LAB_SOURCE_URI || 'postgresql://lab:lab-only-password@127.0.0.1:5434/lab_source';
  const url = new URL(uri);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/lab_source') throw new Error('実験用のローカルDBだけを接続できます');
  const pool = new pg.Pool({ connectionString: uri });
  await pool.query('select 1');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'lab', alg: 'RS256', use: 'sig' };
  function token() {
    const encode = (item) => Buffer.from(JSON.stringify(item)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const message = `${encode({ alg: 'RS256', kid: 'lab' })}.${encode({ sub: 'lab-user', aud: 'taskspace-lab', iat: now, exp: now + 3600 })}`;
    return `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}`;
  }
  async function seed(doc) {
    if (!validDoc(doc)) throw new Error('文書IDが不正です');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [doc]);
      const inserted = await client.query('insert into lab_documents(id) values($1) on conflict do nothing returning id', [doc]);
      if (inserted.rowCount) {
        for (let i = 0; i < 30; i++) await client.query(
          'insert into lab_rows(id,doc_id,node_id,text,parent_id,sort_order,favorite,completed) values($1,$2,$3,$4,$5,$6,0,0)',
          [`${doc}:row-${i}`, doc, `row-${i}`, i === 0 ? '最初のメモ' : `検証用の行 ${i}`, i > 2 && i < 10 ? 'row-1' : null, i],
        );
      }
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async function upload(body) {
    const { clientId, entries } = body;
    if (typeof clientId !== 'string' || !Array.isArray(entries) || !entries.length || entries.length > 100) throw new Error('送信内容が不正です');
    const operationId = `${clientId}:${entries[0].clientId}`;
    const hash = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(731001,hashtext($1))', [operationId]);
      const old = (await client.query('select request_hash,result from lab_operations where id=$1', [operationId])).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw new Error('同じ操作IDの内容が違います');
        await client.query('commit'); return old.result;
      }
      const first = (await client.query('select doc_id from lab_rows where id=$1', [entries[0].id])).rows[0];
      if (!first) throw new Error('行がありません');
      // 別々の行を動かす要求も同じ木として直列化し、循環の検査と反映を同じ取引に置く。
      await client.query('select pg_advisory_xact_lock(731002,hashtext($1))', [first.doc_id]);
      let conflictCount = 0, operationDoc = first.doc_id;
      for (const [index, entry] of entries.entries()) {
        if (entry.table !== 'lab_rows' || entry.op !== 'PATCH' || !entry.opData || !entry.previousValues) throw new Error('実験では既存行の列更新だけを受け付けます');
        const current = (await client.query('select * from lab_rows where id=$1 for update', [entry.id])).rows[0];
        if (!current) throw new Error('行がありません');
        if (operationDoc !== null && operationDoc !== current.doc_id) throw new Error('実験では複数文書を一括更新できません');
        operationDoc = current.doc_id;
        const command = entry.metadata == null ? null : JSON.parse(entry.metadata);
        let result;
        if (command?.kind === 'tree-move' || command?.kind === 'tree-delete') {
          const treeRows = (await client.query('select node_id,parent_id,sort_order,deleted from lab_rows where doc_id=$1', [operationDoc])).rows.map((row) => ({ id: row.node_id, parentId: row.parent_id, order: row.sort_order, deleted: !!row.deleted }));
          result = mergeTreeCommand(treeRows, current.node_id, command, entry.opData);
        } else result = mergeObservedFields(current, entry.opData, entry.previousValues, entry.metadata);
        const { changes, conflicts } = result;
        const keys = Object.keys(changes);
        if (keys.length) await client.query(`update lab_rows set ${keys.map((key, i) => `${key}=$${i + 2}`).join(',')} where id=$1`, [entry.id, ...keys.map((key) => changes[key])]);
        for (const conflict of conflicts) {
          await client.query('insert into lab_conflicts(id,doc_id,node_id,field,mine,theirs,operation_id) values($1,$2,$3,$4,$5,$6,$7)',
            [`${operationId}:${index}:${conflict.field}`, current.doc_id, current.node_id, conflict.field, JSON.stringify(conflict.mine), JSON.stringify(conflict.theirs), operationId]);
          conflictCount++;
        }
      }
      const result = { ok: true, conflicts: conflictCount };
      await client.query('insert into lab_operations(id,doc_id,request_hash,result) values($1,$2,$3,$4)', [operationId, operationDoc, hash, result]);
      await client.query('commit'); return result;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  return {
    close: () => pool.end(),
    async middleware(request, response, next) {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/lab/powersync/')) return next();
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      try {
        let result;
        const doc = url.searchParams.get('doc') || 'demo';
        if (url.pathname.endsWith('/jwks')) result = { keys: [jwk] };
        else if (url.pathname.endsWith('/token')) {
          await seed(doc); result = { token: token(), endpoint: 'http://127.0.0.1:4182' };
        } else if (url.pathname.endsWith('/server-state')) {
          if (!validDoc(doc)) throw new Error('文書IDが不正です');
          const data = (await pool.query('select * from lab_rows where doc_id=$1 order by sort_order,node_id', [doc])).rows;
          const conflicts = (await pool.query('select * from lab_conflicts where doc_id=$1 order by id', [doc])).rows;
          const changes = Number((await pool.query('select count(*) as n from lab_operations where doc_id=$1', [doc])).rows[0].n);
          result = { rows: data.map((row) => ({ id: row.node_id, text: row.text, parentId: row.parent_id, order: row.sort_order, favorite: !!row.favorite, completed: !!row.completed, deleted: !!row.deleted })), conflicts, changes, bytes: Buffer.byteLength(JSON.stringify(data)) };
        } else if (url.pathname.endsWith('/upload') && request.method === 'POST') {
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw new Error('送信量が大きすぎます'); chunks.push(chunk); }
          result = await upload(JSON.parse(Buffer.concat(chunks).toString()));
        } else { response.statusCode = 404; result = { error: '検証APIがありません' }; }
        response.end(JSON.stringify(result));
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
    },
  };
}
