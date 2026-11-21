// 配信の記録を、git からそのまま書き出す。
// 手で書き足さない（書き足すと、必ず実際とずれていく）。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BRANCH = process.argv[2] || 'claude/kind-fermi-sNjwi';
const ref = (() => {
  for (const name of [`origin/${BRANCH}`, BRANCH]) {
    try { execFileSync('git', ['rev-parse', '--verify', name], { stdio: 'ignore' }); return name; } catch { /* 次を試す */ }
  }
  throw new Error('配信の枝が見つかりません');
})();

const lines = execFileSync('git', ['log', '--format=%ad\t%h\t%s', '--date=short', ref], { encoding: 'utf8' })
  .trim().split('\n');

const byDay = new Map();
for (const line of lines) {
  const [day, sha, subject] = line.split('\t');
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(`- ${subject} … \`${sha}\``);
}

const out = ['# 変わってきたこと（配信の記録）', '',
  '本番（`claude/kind-fermi-sNjwi`）に出したもの。新しい順。',
  '`npm run changelog` で作り直せる（git の記録から書き出している）。', '',
  '版（v1.x.y）は `package.json` の値。カッコの (#数字) は PR の番号。'];
for (const [day, items] of byDay) out.push('', `## ${day}`, '', ...items);
writeFileSync(new URL('../docs/changelog.md', import.meta.url), `${out.join('\n')}\n`);
console.log(`${lines.length} 件を docs/changelog.md に書き出しました`);
