// scheduling.js
// 「今週どの日に置いたか (scheduledDate)」を唯一の源とし、
// today / thisWeek は派生値として算出する。
// 後方互換: scheduledDate が無い既存データは legacy フラグ(today/thisWeek)を尊重する。

export function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// 月曜始まり〜日曜終わりの7日間の Date 配列を返す
export function getWeekDays(base = new Date()) {
  const dow = base.getDay(); // 0=Sun
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(base);
  mon.setDate(base.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

// その週の7日分の dateKey 配列
export function weekDateKeys(base = new Date()) {
  return getWeekDays(base).map(toDateKey);
}

// このタスクは「今日」に置かれているか
export function isToday(task, todayKey) {
  if (!task) return false;
  if (task.scheduledDate) return task.scheduledDate === todayKey;
  return !!task.today; // legacy compat
}

// このタスクは「今週」に置かれているか（今日も今週に含む）
export function isThisWeek(task, weekKeys) {
  if (!task) return false;
  if (task.scheduledDate) return weekKeys.includes(task.scheduledDate);
  return !!task.thisWeek || !!task.today; // legacy compat
}

// 「今週だが特定の曜日未割当」(Weeklyカラム用)
// = scheduledDate を持たず（特定日に未配置）、thisWeek フラグが立っていて、今日でもない
// 特定日に配置済み(scheduledDate あり)のタスクは 7Days 側に出すので Weekly バケットには出さない
export function isThisWeekUnscheduled(task) {
  if (!task) return false;
  if (task.scheduledDate) return false;
  return !!task.thisWeek && !task.today;
}

// 指定日付(date)にプロジェクト繰り返しルールがマッチするか
export function ruleMatchesWeekday(rule, date, dateKey) {
  if (!rule || !rule.recurrence || rule.recurrence === "none") return false;
  const dow = date.getDay();
  const dayMatch = rule.recurrence === "weekly" && Number(rule.recurrenceDay) === dow;
  if (!dayMatch) return false;
  if (rule.recurrenceEnd && dateKey > rule.recurrenceEnd) return false;
  if (rule.recurrenceStart && dateKey < rule.recurrenceStart) return false;
  return true;
}

// 7Days の各日に表示する「ルートタスク」を集める純粋関数。
// 明示配置(scheduledDate / 今日) + プロジェクト繰り返しゴーストを統合し、重複排除。
export function rootTasksForDay({ tasks, projectRules, dateKey, date, todayKey }) {
  const seen = new Set();
  const roots = [];
  function addRoot(t) {
    if (!t.parentId && !seen.has(t.id)) { seen.add(t.id); roots.push(t); }
  }

  // 1) 明示的に配置されたタスク（rootのみ）
  tasks.filter((t) => !t.archived && !t.parentId && (
    t.scheduledDate === dateKey ||
    (!t.scheduledDate && dateKey === todayKey && (t.today || (t.thisWeek && !t.today)))
  )).forEach(addRoot);

  // 2) プロジェクト繰り返しルール由来のゴースト（rootのみ）
  // 既に特定日へ明示配置済み(scheduledDate あり)のタスクはゴースト表示しない
  // （配置先の曜日と元の曜日の両方に出て複製されるのを防ぐ）
  if (projectRules && date) {
    Object.entries(projectRules).forEach(([ruleKey, rule]) => {
      if (!ruleMatchesWeekday(rule, date, dateKey)) return;
      const [cat, ...rest] = ruleKey.split("::");
      const proj = rest.join("::");
      tasks
        .filter((t) => !t.archived && !t.scheduledDate && t.category === cat && t.project === proj && !t.parentId)
        .forEach(addRoot);
    });
  }

  return roots;
}
