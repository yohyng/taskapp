import { backupToDrive, hasDrive, hoursSinceBackup } from '../../../src/lib/drive.js';
import { collectLoroBackup } from './loro-backup.js';

// 自動控えの失敗は設定内に残して再試行する。編集・同期の画面へ復旧作業を持ち込まない。
export function outlineBackup({ engine, ownerId, docId, activeOwner, onState = () => {}, storage = globalThis.localStorage,
  send = backupToDrive, configured = hasDrive, age = hoursSinceBackup }) {
  let flight, timer, stopped = false, failed = false;
  const active = () => !stopped && activeOwner() === ownerId;
  const check = () => { if (!active()) throw new Error('画面が切り替わったため、控えを見送りました'); };
  function schedule() {
    clearTimeout(timer);
    if (!active()) return;
    timer = setTimeout(() => {
      if (configured() && age() >= 24) run().catch(() => {});
      else schedule();
    }, failed ? 60000 : 30000);
  }
  function run() {
    if (flight) return flight;
    flight = Promise.resolve().then(async () => {
      check(); onState({ status: 'saving', error: '' });
      const saved = await engine.recoveryState(); check();
      const payload = collectLoroBackup(storage, saved, { ownerId, docId }); check();
      const result = await send(payload);
      failed = false; if (active()) onState({ status: 'saved', error: '' });
      return result;
    }).catch((error) => {
      failed = true; if (active()) onState({ status: 'error', error: error?.message || String(error) });
      throw error;
    }).finally(() => { flight = null; schedule(); });
    return flight;
  }
  return { run, start: schedule, dispose() { stopped = true; clearTimeout(timer); } };
}
