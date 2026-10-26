import { readdir, readFile } from 'node:fs/promises';

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const range = (values) => `${median(values).toFixed(1)} [${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}]`;
console.log('方式 | ブラウザー | 新規起動ms(6回) | 圏外再起動ms(3回) | 端末保存ms(9回) | 次画面更新ms(9回) | 別端末確認ms(9回) | サーバー確認ms(9回)');
let files = [];
try { files = await readdir('.bench-results'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const file of files.filter((file) => file.endsWith('.json')).sort()) {
  const result = JSON.parse(await readFile(`.bench-results/${file}`, 'utf8'));
  const samples = result.samples, edits = samples.flatMap((sample) => sample.edits);
  console.log(`BENCH_SUMMARY ${result.engine} | ${result.browser} | ${range(samples.flatMap((s) => [s.coldA.rowsFrameMs, s.coldB.rowsFrameMs]))} | ${range(samples.map((s) => s.warmOffline.rowsFrameMs))} | ${range(edits.map((e) => e.localMs))} | ${range(edits.map((e) => e.frameMs))} | ${range(edits.map((e) => e.remoteObservedMs))} | ${range(edits.map((e) => e.serverConfirmedMs))}`);
}
