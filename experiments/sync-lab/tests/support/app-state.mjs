import { Buffer } from 'node:buffer';
import { seedOutlineDocument } from '../../src/outline-model.js';

// ブラウザーの通信差し替えと、Service Workerを通る実HTTPの両方で同じ合成DBを使う。
export function appState({ cutoverRoute } = {}) {
  const source = seedOutlineDocument([{ id: 'memo', text: '端末を持ち替えて書くメモ', children: [] }]);
  const snapshot = Buffer.from(source.export({ mode: 'snapshot' })).toString('base64'); source.free();
  const entries = [], legacy = [], date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const tasks = [{ id: 'task-probe', title: 'タスクも同じ画面で使える', status: '未着手', plain: true, scheduled_date: today,
    stock: false, stock_view_id: null, style: null, block_type: 'task', canvas_x: null, canvas_y: null, page_id: null,
    row_key: null, col_index: 0, col_width: null, code_lang: '', day_date: '' }];
  const startup = { routeCalls: 0, exchanges: 0, allowed: true };
  return { entries, legacy, startup, respond(path, method, body) {
    if (path.endsWith('/rpc/taskspace_loro_cutover_route') && cutoverRoute) {
      startup.routeCalls++;
      return { status: 200, json: { ...cutoverRoute, legacyWritesBlocked: startup.allowed } };
    }
    if (path.endsWith('/rpc/taskspace_loro_exchange')) {
      startup.exchanges++;
      for (const entry of body.p_updates) {
        const old = entries.find((value) => value.id === entry.id);
        if (old && old.bytes !== entry.bytes) throw new Error('同じ送信IDの内容が変わった');
        if (!old) entries.push(entry);
      }
      const start = Math.max(0, body.p_cursor), batch = entries.slice(start, start + 32);
      return { status: 200, json: { cursor: start + batch.length, head: entries.length,
        snapshot: body.p_cursor === -1 ? snapshot : null, acknowledged: body.p_updates.map((entry) => entry.id),
        updates: batch.map((entry, i) => ({ sequence: start + i + 1, bytes: entry.bytes })) } };
    }
    if (/outline/.test(path)) { legacy.push(path); return { status: 403, json: { message: '旧同期は検査対象外' } }; }
    if (path.endsWith('/tasks') && ['POST', 'PATCH'].includes(method)) for (const row of Array.isArray(body) ? body : [body]) {
      const index = tasks.findIndex((task) => task.id === row.id);
      if (index < 0) tasks.push(row); else tasks[index] = { ...tasks[index], ...row };
    }
    return { status: 200, json: path.endsWith('/tasks') && method === 'GET' ? tasks : [] };
  } };
}
