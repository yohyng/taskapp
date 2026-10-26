import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { VersionVector } from 'loro-crdt';
import { fixtureLoroDocument, loroCheckpoint, restoreLoroCheckpoint, loroViewRows } from '../src/loro-model.js';
import { replaceFile } from './replace-file.mjs';

// 30行の比較用HTTP交換。製品の認証・配信・障害対応を備えた同期サービスではない。
export async function loroApi(directory) {
  await mkdir(directory, { recursive: true });
  const queues = new Map(), metrics = new Map();
  const fileFor = (id) => `${directory}/${createHash('sha256').update(id).digest('hex')}.json`;
  const encode = (saved) => JSON.stringify({ snapshot: [...saved.snapshot], pending: saved.pending && [...saved.pending] });
  const decode = (raw) => { const saved = JSON.parse(raw); return { snapshot: Uint8Array.from(saved.snapshot), pending: saved.pending === null ? null : Uint8Array.from(saved.pending) }; };
  function exclusive(id, operation) {
    const task = (queues.get(id) || Promise.resolve()).then(operation);
    const done = task.catch(() => {}); queues.set(id, done);
    done.finally(() => { if (queues.get(id) === done) queues.delete(id); });
    return task;
  }
  async function store(id, doc) {
    const file = fileFor(id), temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, encode(loroCheckpoint(doc)));
    await replaceFile(temporary, file);
  }
  async function load(id) {
    try { return restoreLoroCheckpoint(decode(await readFile(fileFor(id), 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const doc = fixtureLoroDocument();
      try { await store(id, doc); return doc; } catch (error) { doc.free(); throw error; }
    }
  }
  const version = (doc) => Buffer.from(doc.oplogVersion().encode()).toString('base64');
  const pending = (doc) => Buffer.from(doc.exportPendingUpdates() || []).toString('base64');
  return {
    async middleware(request, response, next) {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/lab/loro/')) return next();
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
      try {
        const id = url.searchParams.get('doc');
        if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id || '')) throw new Error('検証文書IDが不正です');
        let body;
        if (url.pathname.endsWith('/sync') && request.method === 'POST') {
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw new Error('検証の送信上限を超えました'); chunks.push(chunk); }
          body = JSON.parse(Buffer.concat(chunks).toString());
          if (!Array.isArray(body.version) || !Array.isArray(body.updates) || body.updates.length > 1000) throw new Error('更新が不正です');
        } else if (!url.pathname.endsWith('/server-state') || request.method !== 'GET') { response.statusCode = 404; response.end('{}'); return; }
        const result = await exclusive(id, async () => {
          // 毎回永続ストアから候補を作る。保存失敗後のメモリーを、再送時に保存済みと誤認しない。
          const doc = await load(id);
          try {
            const count = metrics.get(id) || { changes: 0 }; metrics.set(id, count);
            if (body) {
              const from = VersionVector.decode(Uint8Array.from(body.version));
              try {
                const before = version(doc), waiting = pending(doc);
                for (const bytes of body.updates) doc.import(Uint8Array.from(bytes));
                const update = [...doc.export({ mode: 'update', from })];
                if (version(doc) !== before || pending(doc) !== waiting) { await store(id, doc); count.changes++; }
                return { update };
              } finally { from.free(); }
            }
            const saved = loroCheckpoint(doc);
            return { rows: loroViewRows(doc), ...count, bytes: saved.snapshot.length + (saved.pending?.length || 0), pending: saved.pending?.length || 0 };
          } finally { doc.free(); }
        });
        response.end(JSON.stringify(result));
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: String(error.message || error) })); }
    },
    close: async () => { await Promise.all([...queues.values()]); },
  };
}
