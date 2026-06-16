import { describe, it, expect } from "vitest";
import {
  toDateKey,
  getWeekDays,
  weekDateKeys,
  isToday,
  isThisWeek,
  isThisWeekUnscheduled,
  ruleMatchesWeekday,
  rootTasksForDay,
} from "./scheduling.js";

describe("toDateKey", () => {
  it("formats with zero padding", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("getWeekDays", () => {
  it("returns Monday..Sunday for a mid-week date", () => {
    // 2026-06-16 is a Tuesday
    const days = getWeekDays(new Date(2026, 5, 16));
    expect(days.map(toDateKey)).toEqual([
      "2026-06-15", // Mon
      "2026-06-16", // Tue
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21", // Sun
    ]);
  });

  it("treats Sunday as the end of the week (not start)", () => {
    // 2026-06-21 is a Sunday
    const days = getWeekDays(new Date(2026, 5, 21));
    expect(toDateKey(days[0])).toBe("2026-06-15"); // Mon
    expect(toDateKey(days[6])).toBe("2026-06-21"); // Sun
  });
});

describe("weekDateKeys", () => {
  it("returns 7 keys", () => {
    expect(weekDateKeys(new Date(2026, 5, 16))).toHaveLength(7);
  });
});

const TODAY = "2026-06-16";
const WEEK = weekDateKeys(new Date(2026, 5, 16));

describe("isToday", () => {
  it("uses scheduledDate when present", () => {
    expect(isToday({ scheduledDate: TODAY }, TODAY)).toBe(true);
    expect(isToday({ scheduledDate: "2026-06-17" }, TODAY)).toBe(false);
  });
  it("falls back to legacy today flag when no scheduledDate", () => {
    expect(isToday({ today: true }, TODAY)).toBe(true);
    expect(isToday({ today: false }, TODAY)).toBe(false);
  });
  it("scheduledDate wins over legacy flag", () => {
    expect(isToday({ today: true, scheduledDate: "2026-06-18" }, TODAY)).toBe(false);
  });
  it("handles null", () => {
    expect(isToday(null, TODAY)).toBe(false);
  });
});

describe("isThisWeek", () => {
  it("true when scheduledDate is in the week", () => {
    expect(isThisWeek({ scheduledDate: "2026-06-18" }, WEEK)).toBe(true);
  });
  it("false when scheduledDate is outside the week", () => {
    expect(isThisWeek({ scheduledDate: "2026-06-30" }, WEEK)).toBe(false);
  });
  it("today counts as this week (legacy)", () => {
    expect(isThisWeek({ today: true }, WEEK)).toBe(true);
  });
  it("legacy thisWeek flag honored when no scheduledDate", () => {
    expect(isThisWeek({ thisWeek: true }, WEEK)).toBe(true);
  });
});

describe("isThisWeekUnscheduled", () => {
  it("scheduledDate on a specific day => false (belongs to 7Days, not Weekly bucket)", () => {
    expect(isThisWeekUnscheduled({ scheduledDate: "2026-06-18" })).toBe(false);
  });
  it("scheduledDate today => false", () => {
    expect(isThisWeekUnscheduled({ scheduledDate: TODAY })).toBe(false);
  });
  it("thisWeek flag with no date => true (this week, no specific day)", () => {
    expect(isThisWeekUnscheduled({ thisWeek: true })).toBe(true);
  });
  it("today flag => false (today bucket)", () => {
    expect(isThisWeekUnscheduled({ today: true })).toBe(false);
  });
  it("thisWeek + today => false (today wins)", () => {
    expect(isThisWeekUnscheduled({ thisWeek: true, today: true })).toBe(false);
  });
  it("null => false", () => {
    expect(isThisWeekUnscheduled(null)).toBe(false);
  });
});

describe("ruleMatchesWeekday", () => {
  const tue = new Date(2026, 5, 16); // Tuesday, dow=2
  it("matches weekly rule on the same weekday", () => {
    expect(ruleMatchesWeekday({ recurrence: "weekly", recurrenceDay: 2 }, tue, TODAY)).toBe(true);
  });
  it("does not match a different weekday", () => {
    expect(ruleMatchesWeekday({ recurrence: "weekly", recurrenceDay: 3 }, tue, TODAY)).toBe(false);
  });
  it("respects recurrenceEnd", () => {
    expect(ruleMatchesWeekday({ recurrence: "weekly", recurrenceDay: 2, recurrenceEnd: "2026-06-01" }, tue, TODAY)).toBe(false);
  });
  it("respects recurrenceStart", () => {
    expect(ruleMatchesWeekday({ recurrence: "weekly", recurrenceDay: 2, recurrenceStart: "2026-07-01" }, tue, TODAY)).toBe(false);
  });
  it("none / missing => false", () => {
    expect(ruleMatchesWeekday({ recurrence: "none" }, tue, TODAY)).toBe(false);
    expect(ruleMatchesWeekday(null, tue, TODAY)).toBe(false);
  });
});

describe("rootTasksForDay", () => {
  const tasks = [
    { id: "a", parentId: null, category: "NOMLAB", project: "P", scheduledDate: TODAY },
    { id: "b", parentId: null, category: "NOMLAB", project: "P", scheduledDate: "2026-06-18" },
    { id: "c", parentId: "a", category: "NOMLAB", project: "P", scheduledDate: TODAY }, // child, excluded
    { id: "d", parentId: null, category: "NOMURA", project: "Q", today: true }, // legacy today
    { id: "e", parentId: null, category: "NOMLAB", project: "R" }, // unscheduled
    { id: "f", parentId: null, category: "NOMLAB", project: "R", archived: true, scheduledDate: TODAY }, // archived
  ];

  it("includes scheduled-today roots and legacy-today roots on today, excludes children/archived", () => {
    const got = rootTasksForDay({ tasks, projectRules: {}, dateKey: TODAY, date: new Date(2026, 5, 16), todayKey: TODAY });
    const ids = got.map((t) => t.id).sort();
    expect(ids).toEqual(["a", "d"]);
  });

  it("includes only that day's scheduled tasks on a non-today day", () => {
    const got = rootTasksForDay({ tasks, projectRules: {}, dateKey: "2026-06-18", date: new Date(2026, 5, 18), todayKey: TODAY });
    expect(got.map((t) => t.id)).toEqual(["b"]);
  });

  it("adds recurring project ghosts for unscheduled project roots on matching weekday", () => {
    const projectRules = { "NOMLAB::P": { recurrence: "weekly", recurrenceDay: 2 } }; // Tuesday
    // e2: project P root with NO scheduledDate -> should ghost onto Tuesday
    const withGhost = [...tasks, { id: "g", parentId: null, category: "NOMLAB", project: "P" }];
    const got = rootTasksForDay({ tasks: withGhost, projectRules, dateKey: TODAY, date: new Date(2026, 5, 16), todayKey: TODAY });
    const ids = got.map((t) => t.id).sort();
    // a (scheduled today), d (legacy today), g (ghost). b is EXCLUDED from ghost (it has scheduledDate=Thu)
    expect(ids).toEqual(["a", "d", "g"]);
  });

  it("does NOT ghost a task that has been explicitly placed on another day (no duplication)", () => {
    const projectRules = { "NOMLAB::P": { recurrence: "weekly", recurrenceDay: 2 } }; // Tuesday
    // b is in project P and scheduled for Thursday; it must appear ONLY on Thursday, never as a Tuesday ghost
    const tue = rootTasksForDay({ tasks, projectRules, dateKey: TODAY, date: new Date(2026, 5, 16), todayKey: TODAY });
    const thu = rootTasksForDay({ tasks, projectRules, dateKey: "2026-06-18", date: new Date(2026, 5, 18), todayKey: TODAY });
    expect(tue.map((t) => t.id)).not.toContain("b");
    expect(thu.map((t) => t.id)).toContain("b");
  });
});

// ユーザーのコアモデルを固定するワークフローテスト:
// 「プロジェクト=マスター。そこから7Daysの特定曜日に置く。置いたものは
//  その曜日にだけ出て、Today/Weekly(曜日未指定)には重複しない。プロジェクトには残る」
describe("core workflow: place a project task on a specific day", () => {
  const WED = "2026-06-17"; // Wednesday in the test week
  // プロジェクトに属するタスクを水曜に配置した状態
  const task = { id: "x", parentId: null, category: "NOMLAB", project: "P", scheduledDate: WED };

  it("appears in Wednesday's 7Days column", () => {
    const got = rootTasksForDay({ tasks: [task], projectRules: {}, dateKey: WED, date: new Date(2026, 5, 17), todayKey: TODAY });
    expect(got.map((t) => t.id)).toEqual(["x"]);
  });

  it("does NOT appear in today's column", () => {
    const got = rootTasksForDay({ tasks: [task], projectRules: {}, dateKey: TODAY, date: new Date(2026, 5, 16), todayKey: TODAY });
    expect(got).toHaveLength(0);
    expect(isToday(task, TODAY)).toBe(false);
  });

  it("does NOT appear in the Weekly (unscheduled) bucket", () => {
    expect(isThisWeekUnscheduled(task)).toBe(false);
  });

  it("is still considered part of this week (so it counts as planned)", () => {
    expect(isThisWeek(task, WEEK)).toBe(true);
  });
});
