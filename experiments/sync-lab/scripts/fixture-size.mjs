// 大量データは専用プロセスで一文書だけ使う。PowerSyncの全体配信へ過去の試験を混ぜない。
export function fixtureSize(id, benchmark = process.env.LAB_BENCHMARK === '1') {
  if (benchmark) {
    if (id !== 'benchmark-10000') throw new Error('負荷測定では専用の一文書だけを使います');
    return 10000;
  }
  if (id.startsWith('benchmark-')) throw new Error('負荷測定は専用プロセスで起動してください');
  return 30;
}
