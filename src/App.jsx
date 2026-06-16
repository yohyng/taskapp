import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCenter,
  rectIntersection,
  pointerWithin,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { loadLocal, saveLocal, loadFromSupabase, saveToSupabase, deleteTask as dbDeleteTask, deleteTrayItem as dbDeleteTrayItem, upsertTaskRow as dbUpsertTaskRow, upsertTrayRow as dbUpsertTrayRow, deleteProjectRule as dbDeleteProjectRule, loadSettings as dbLoadSettings, saveSetting as dbSaveSetting, rowToTask, rowToTray, subscribeRealtime } from "./lib/db";
import { toDateKey, getWeekDays, weekDateKeys, isToday as schedIsToday, isThisWeek as schedIsThisWeek, isThisWeekUnscheduled, rootTasksForDay } from "./lib/scheduling";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
  Circle,
  CheckCircle2,
  CalendarDays,
  Plus,
  Search,
  Columns3,
  ListTree,
  GripVertical,
  X,
  RotateCcw,
  RefreshCw,
  Undo2,
  Redo2,
  Settings2,
  Trash2,
  CheckSquare,
  FileText,
  Info,
} from "lucide-react";

// 削除済みIDをlocalStorageに保存し、Supabaseからのリロードで復活するのを防ぐ
const TOMBSTONE_TASKS_KEY = 'ts-tombstone-tasks'
const TOMBSTONE_TRAY_KEY = 'ts-tombstone-tray'

function addTombstone(key, id) {
  try {
    const s = new Set(JSON.parse(localStorage.getItem(key) || '[]'))
    s.add(id)
    localStorage.setItem(key, JSON.stringify([...s]))
  } catch {}
}

function getTombstoneSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}

// Supabaseから削除が完了したIDはtombstoneから除去
function pruneTombstones(key, remoteIdSet) {
  try {
    const remaining = [...getTombstoneSet(key)].filter(id => remoteIdSet.has(id))
    localStorage.setItem(key, JSON.stringify(remaining))
  } catch {}
}

// ポインタ位置ベースでドロップ先を判定し、カードレベルを枠より優先する衝突検知
function collisionType(hit) {
  return hit?.data?.droppableContainer?.data?.current?.type;
}
function taskFirstCollision(args) {
  // ポインタが重なっている全コンテナを取得（カラム跨ぎでも正確）
  let hits = pointerWithin(args);
  if (hits.length === 0) hits = rectIntersection(args);
  if (hits.length === 0) hits = closestCenter(args);

  const activeType = args.active?.data?.current?.type;
  const pick = (types) => hits.filter((h) => types.includes(collisionType(h)));

  // ドラッグ中の種類に応じてドロップ先の優先順位を変える
  if (activeType === "column") {
    return pick(["column"]).length ? pick(["column"]) : hits;
  }
  if (activeType === "project") {
    const p = pick(["project"]);
    return p.length ? p : (pick(["column"]).length ? pick(["column"]) : hits);
  }

  // タスク/TRAYアイテム: カード → 枠 の順で優先（カラム跨ぎ対応）
  const cardHits = pick(["task-in-day", "task-in-today", "task-in-weekly", "task", "tray"]);
  if (cardHits.length > 0) return cardHits;
  const zoneHits = pick(["project", "today", "weekly", "day-column", "tray-zone"]);
  if (zoneHits.length > 0) return zoneHits;
  return hits;
}

const DEFAULT_CATEGORIES = [
  { key: "NOMLAB", label: "NOMLAB PJ", tone: "rose" },
  { key: "NOMURA", label: "NOMURA PJ", tone: "purple" },
  { key: "PRIVATE", label: "PRIVATE PJ", tone: "blue" },
];

const DEFAULT_PROJECT_RULES = {
  "NOMLAB::空間デザイン試論": {
    recurrence: "weekly",
    recurrenceDay: 3,
    recurrenceStart: "",
    recurrenceEnd: "",
  },
};

const DEFAULT_PROJECT_ORDER = {};
const NO_CATEGORY_LABEL = "---";

const TONES = ["rose", "purple", "blue", "amber", "green", "cyan", "orange", "neutral"];

const TONE_MAP = {
  rose: {
    tag: "bg-rose-500/20 text-rose-200 border-rose-400/25",
    panel: "bg-rose-500/7 border-rose-400/15",
    accent: "text-rose-300",
    add: "border-rose-300/25 text-rose-200 hover:bg-rose-400/10",
  },
  purple: {
    tag: "bg-purple-500/20 text-purple-200 border-purple-400/25",
    panel: "bg-purple-500/7 border-purple-400/15",
    accent: "text-purple-300",
    add: "border-purple-300/25 text-purple-200 hover:bg-purple-400/10",
  },
  blue: {
    tag: "bg-sky-500/20 text-sky-200 border-sky-400/25",
    panel: "bg-sky-500/7 border-sky-400/15",
    accent: "text-sky-300",
    add: "border-sky-300/25 text-sky-200 hover:bg-sky-400/10",
  },
  amber: {
    tag: "bg-amber-500/20 text-amber-200 border-amber-400/25",
    panel: "bg-amber-500/7 border-amber-400/15",
    accent: "text-amber-300",
    add: "border-amber-300/25 text-amber-200 hover:bg-amber-400/10",
  },
  green: {
    tag: "bg-emerald-500/20 text-emerald-200 border-emerald-400/25",
    panel: "bg-emerald-500/7 border-emerald-400/15",
    accent: "text-emerald-300",
    add: "border-emerald-300/25 text-emerald-200 hover:bg-emerald-400/10",
  },
  cyan: {
    tag: "bg-cyan-500/20 text-cyan-200 border-cyan-400/25",
    panel: "bg-cyan-500/7 border-cyan-400/15",
    accent: "text-cyan-300",
    add: "border-cyan-300/25 text-cyan-200 hover:bg-cyan-400/10",
  },
  orange: {
    tag: "bg-orange-500/20 text-orange-200 border-orange-400/25",
    panel: "bg-orange-500/7 border-orange-400/15",
    accent: "text-orange-300",
    add: "border-orange-300/25 text-orange-200 hover:bg-orange-400/10",
  },
  neutral: {
    tag: "bg-neutral-500/20 text-neutral-200 border-neutral-400/25",
    panel: "bg-neutral-500/7 border-neutral-400/15",
    accent: "text-neutral-300",
    add: "border-neutral-300/25 text-neutral-200 hover:bg-neutral-400/10",
  },
};

const SAMPLE_TASKS = [
  // NOMLAB PJ
  { id: "n1", title: "全体スケジュール", category: "NOMLAB", project: "空間デザイン試論", status: "未着手", thisWeek: false, parentId: null, memo: "スクショのトグル名をProjectとして登録。プロジェクト単位で毎週水曜に作業日", dueDate: "2026-05-29" },
  { id: "n2", title: "植物アプローチ資料作成", category: "NOMLAB", project: "現象", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n3", title: "新しいプリンターでテスト", category: "NOMLAB", project: "Shiki", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n4", title: "複雑な形状テストで作ってみる", category: "NOMLAB", project: "Shiki", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n5", title: "HPを空間系に変更", category: "NOMLAB", project: "torinome", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n6", title: "AND対応→", category: "NOMLAB", project: "torinome", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n7", title: "DSAのSHOPリスト作成", category: "NOMLAB", project: "空間シンクタンク", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n8", title: "DSAの画像全部ダウンロード", category: "NOMLAB", project: "空間ゆらぎ/AI", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "2026-05-31" },
  { id: "n9", title: "空間の動画解析可能かやってみる", category: "NOMLAB", project: "空間ゆらぎ/AI", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n10", title: "ラジオ企画", category: "NOMLAB", project: "選書企画・コラム", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n11", title: "年内テーマ検討", category: "NOMLAB", project: "選書企画・コラム", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "n12", title: "鍋コラム清書", category: "NOMLAB", project: "選書企画・コラム", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },

  // NOMURA PJ
  { id: "m1", title: "次回定例に向けてプロト作成", category: "NOMURA", project: "DESIGNART2026", status: "未着手", thisWeek: false, parentId: null, memo: "親タスク。下に実制作タスクを配置", dueDate: "2026-05-30" },
  { id: "m2", title: "スタッフとワイヤーと下地", category: "NOMURA", project: "DESIGNART2026", status: "未着手", thisWeek: false, parentId: "m1", memo: "", dueDate: "" },
  { id: "m3", title: "3Dプリントでオスメス作っておく", category: "NOMURA", project: "DESIGNART2026", status: "未着手", thisWeek: false, parentId: "m1", memo: "", dueDate: "" },
  { id: "m4", title: "会場選定", category: "NOMURA", project: "DESIGNART2026", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "m5", title: "芝浦工大トーク関連", category: "NOMURA", project: "歓びと感動学", status: "未着手", thisWeek: false, parentId: null, memo: "親タスク", dueDate: "" },
  { id: "m6", title: "かずさん人事連絡待ち", category: "NOMURA", project: "歓びと感動学", status: "未着手", thisWeek: false, parentId: "m5", memo: "", dueDate: "" },
  { id: "m7", title: "人事と連携したノムラのプレゼンにもなるような立て付けにする", category: "NOMURA", project: "歓びと感動学", status: "未着手", thisWeek: false, parentId: "m5", memo: "", dueDate: "" },
  { id: "m8", title: "感動学資料まとめ", category: "NOMURA", project: "歓びと感動学", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "m9", title: "訂正シール確認→確認後酒井さん連絡", category: "NOMURA", project: "歓びと感動学", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "m10", title: "なんとなくひきこもりと空間フォロー", category: "NOMURA", project: "学校空間リサーチ", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "m11", title: "ノムラの空間、竣工実績ベースに読み解いて、それを教育空間にパラフレーズするなら、のシステムというか資料作成しておくといいかも", category: "NOMURA", project: "学校空間リサーチ", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "m12", title: "記憶と脳の書籍読んでおく", category: "NOMURA", project: "記憶と空間リサーチ", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "m13", title: "Akariyaサンプル待ち", category: "NOMURA", project: "Other", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "m14", title: "8月伊藤亜紗さん？連絡", category: "NOMURA", project: "Other", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },

  // PRIVATE PJ
  { id: "p1", title: "婚姻届は7月19日提出に向けて調整", category: "PRIVATE", project: "結婚回り", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "2026-07-19" },
  { id: "p2", title: "結婚指輪刻印をティファニーに送る", category: "PRIVATE", project: "結婚回り", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "p3", title: "ゲンロン9月に提出", category: "PRIVATE", project: "結婚回り", status: "未着手", thisWeek: false, parentId: null, memo: "親タスク", dueDate: "" },
  { id: "p4", title: "社外活動申請", category: "PRIVATE", project: "結婚回り", status: "未着手", thisWeek: false, parentId: "p3", memo: "", dueDate: "" },
  { id: "p5", title: "6月6日の落款前とあと予定検討する", category: "PRIVATE", project: "京都西陣関連", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "2026-06-06" },
  { id: "p6", title: "6月4日定例に向けて資料作る", category: "PRIVATE", project: "GEA", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "2026-06-04" },
  { id: "p7", title: "SCOOP受け取りしたい", category: "PRIVATE", project: "GEA", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "p8", title: "ラグジュアリーとはなにか？", category: "PRIVATE", project: "被蜜空間研究", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },
  { id: "p9", title: "ムードボードについて調べておく", category: "PRIVATE", project: "被蜜空間研究", status: "未着手", thisWeek: false, parentId: null, memo: "", dueDate: "" },

  // Weekly Task column
  { id: "w1", title: "クリーニング受け取り", category: "PRIVATE", project: "Other", status: "未着手", thisWeek: true, parentId: null, memo: "Weekly Taskから取り込み", dueDate: "" },
  { id: "w2", title: "経費精算", category: "PRIVATE", project: "経費精算", status: "未着手", thisWeek: true, parentId: null, memo: "親タスク。Weekly Taskに表示", dueDate: "" },
  { id: "w3", title: "会議交際費申請", category: "PRIVATE", project: "経費精算", status: "未着手", thisWeek: true, parentId: "w2", memo: "", dueDate: "" },
  { id: "w4", title: "風HDMI無線登録", category: "PRIVATE", project: "経費精算", status: "未着手", thisWeek: true, parentId: "w2", memo: "", dueDate: "" },
  { id: "w5", title: "タクシー登録", category: "PRIVATE", project: "経費精算", status: "未着手", thisWeek: true, parentId: "w2", memo: "", dueDate: "" },
  { id: "w6", title: "AVPレンズ登録", category: "PRIVATE", project: "経費精算", status: "未着手", thisWeek: true, parentId: "w2", memo: "", dueDate: "" },
  { id: "w7", title: "ニンジャマスク買うといいかも", category: "PRIVATE", project: "Other", status: "未着手", thisWeek: true, parentId: null, memo: "", dueDate: "" },
  { id: "w8", title: "SIC訪問の件→いったん未来創研メンバーとミラノメンバーに聞く。先着10名でスケジューリングする→それ次第候補日作成で、須藤さん連絡", category: "NOMURA", project: "Other", status: "未着手", thisWeek: true, parentId: null, memo: "", dueDate: "" },
  { id: "w9", title: "ゲンロン編集部配本？", category: "PRIVATE", project: "Other", status: "未着手", thisWeek: true, parentId: null, memo: "", dueDate: "" },
  { id: "w10", title: "ToDo", category: "PRIVATE", project: "Other", status: "未着手", thisWeek: true, parentId: null, memo: "", dueDate: "" },
];

const SAMPLE_INBOX = [
  {
    id: "in1",
    title: "Notionから来た未分類メモ：展示会場の候補を確認",
    source: "Notion Inbox DB",
    createdAt: "2026-05-28",
  },
  {
    id: "in2",
    title: "Notionから来た未分類メモ：ラフスケッチを整理",
    source: "Notion Inbox DB",
    createdAt: "2026-05-28",
  },
];

const STORAGE_KEY = "notion-like-taskdb-prototype-v4";

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

function toneClasses(tone) {
  return TONE_MAP[tone] || TONE_MAP.neutral;
}

function normalizeTitle(title) {
  return title.trim().replace(/\s+/g, " ");
}

function projectKey(category, project) {
  return `${category}::${project}`;
}

function getNthWeekdayDate(year, month, weekday, nth) {
  if (nth === -1) {
    const last = new Date(year, month + 1, 0);
    const diff = (last.getDay() - weekday + 7) % 7;
    return last.getDate() - diff;
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

function dayDiff(aKey, bKey) {
  const a = new Date(`${aKey}T00:00:00`);
  const b = new Date(`${bKey}T00:00:00`);
  return Math.floor((b - a) / 86400000);
}

function matchesProjectRule(rule, date) {
  if (!rule || !rule.recurrence || rule.recurrence === "none") return false;
  const key = toDateKey(date);
  if (rule.recurrenceStart && key < rule.recurrenceStart) return false;
  if (rule.recurrenceEnd && key > rule.recurrenceEnd) return false;

  const day = date.getDay();
  if (rule.recurrence === "daily") return true;
  if (rule.recurrence === "weekdays") return day >= 1 && day <= 5;
  if (rule.recurrence === "weekly") return Number(rule.recurrenceDay ?? 1) === day;
  if (rule.recurrence === "biweekly") {
    const start = rule.recurrenceStart || toDateKey(new Date());
    return Number(rule.recurrenceDay ?? 1) === day && dayDiff(start, key) >= 0 && Math.floor(dayDiff(start, key) / 7) % 2 === 0;
  }
  if (rule.recurrence === "monthlyDate") return date.getDate() === Number(rule.recurrenceDate ?? 1);
  if (rule.recurrence === "monthlyNthWeekday") {
    const targetDate = getNthWeekdayDate(date.getFullYear(), date.getMonth(), Number(rule.recurrenceDay ?? 1), Number(rule.recurrenceWeek ?? 1));
    return date.getDate() === targetDate;
  }
  return false;
}

function projectLabelFromKey(key) {
  const [category, ...rest] = key.split("::");
  return { category, project: rest.join("::") };
}

const FONT_OPTIONS = [
  { key: "sans", label: "ゴシック（標準）", css: 'system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif' },
  { key: "mincho", label: "明朝", css: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif' },
  { key: "rounded", label: "丸ゴシック", css: '"Hiragino Maru Gothic ProN", "Quicksand", "Noto Sans JP", system-ui, sans-serif' },
  { key: "yugothic", label: "游ゴシック", css: '"Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", sans-serif' },
  { key: "mono", label: "等幅", css: 'ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace' },
];

function normalizeTask(task) {
  return {
    dueDate: "",
    today: false,
    todayOrder: null,
    weeklyOrder: null,
    recurrence: "none",
    recurrenceDay: null,
    recurrenceEnd: "",
    memo: "",
    status: "未着手",
    thisWeek: false,
    parentId: null,
    archived: false,
    scheduledDate: "",
    ...task,
  };
}

function App() {
  const [boot] = useState(() => {
    try {
      const raw = loadLocal();
      if (!raw) return { tasks: SAMPLE_TASKS, categories: DEFAULT_CATEGORIES, projectRules: DEFAULT_PROJECT_RULES, projectOrder: DEFAULT_PROJECT_ORDER, inboxItems: SAMPLE_INBOX };
      return {
        tasks: (raw.tasks || SAMPLE_TASKS).map(normalizeTask),
        categories: raw.categories || DEFAULT_CATEGORIES,
        projectRules: raw.projectRules || DEFAULT_PROJECT_RULES,
        projectOrder: raw.projectOrder || DEFAULT_PROJECT_ORDER,
        inboxItems: raw.inboxItems || SAMPLE_INBOX,
      };
    } catch {
      return { tasks: SAMPLE_TASKS, categories: DEFAULT_CATEGORIES, projectRules: DEFAULT_PROJECT_RULES, projectOrder: DEFAULT_PROJECT_ORDER, inboxItems: SAMPLE_INBOX };
    }
  });

  const [tasks, setTasks] = useState(boot.tasks);
  const [categories, setCategories] = useState(boot.categories);
  const [projectRules, setProjectRules] = useState(boot.projectRules || DEFAULT_PROJECT_RULES);
  const [projectOrder, setProjectOrder] = useState(boot.projectOrder || DEFAULT_PROJECT_ORDER);
  const [inboxItems, setInboxItems] = useState(boot.inboxItems || SAMPLE_INBOX);
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(true);
  const [weeklyFlat, setWeeklyFlat] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [quickMemo, setQuickMemo] = useState("");
  const [quickCategory, setQuickCategory] = useState(boot.categories[0]?.key || "NOMLAB");
  const [quickProject, setQuickProject] = useState("空間シンクタンク");
  const [collapsed, setCollapsed] = useState({});
  const [toast, setToastRaw] = useState("");
  const toastTimer = useRef(null);
  function setToast(msg) {
    setToastRaw(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastRaw(""), 3000);
  }
  const [history, setHistory] = useState({ past: [], future: [] });
  const [showColumnsPanel, setShowColumnsPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [showMovePanel, setShowMovePanel] = useState(false);
  const [zoom, setZoom] = useState(() => parseFloat(localStorage.getItem("taskspace-zoom") || "1"));
  const [fontSize, setFontSize] = useState(() => parseFloat(localStorage.getItem("taskspace-fontsize") || "1.2"));
  const [notionToken, setNotionToken] = useState(() => localStorage.getItem("taskspace-notion-token") || "");
  const [notionDbId, setNotionDbId] = useState(() => localStorage.getItem("taskspace-notion-dbid") || "");
  const [notionSyncing, setNotionSyncing] = useState(false);
  const [notionLastSync, setNotionLastSync] = useState(() => localStorage.getItem("taskspace-notion-last-sync") || "");
  const [notionError, setNotionError] = useState(null);
  const [notionAutoSync, setNotionAutoSync] = useState(() => localStorage.getItem("taskspace-notion-auto") !== "off");
  const [leftPanelHorizontal, setLeftPanelHorizontal] = useState(() => localStorage.getItem("taskspace-left-horizontal") === "true");
  const [panelOrder, setPanelOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem("taskspace-panel-order") || "null") || ["7days", "tray", "today", "board", "weekly", "calendar"]; } catch { return ["7days", "tray", "today", "board", "weekly", "calendar"]; }
  });
  const DEFAULT_SECTION_LABELS = { tray: "TRAY", today: "Today", weekly: "Weekly", "7days": "Weekly", board: "Board", calendar: "Calendar" };
  const [sectionLabels, setSectionLabels] = useState(() => {
    try { return { ...DEFAULT_SECTION_LABELS, ...JSON.parse(localStorage.getItem("taskspace-section-labels") || "{}") }; } catch { return DEFAULT_SECTION_LABELS; }
  });
  function updateSectionLabel(key, label) {
    setSectionLabels((prev) => {
      const next = { ...prev, [key]: label };
      localStorage.setItem("taskspace-section-labels", JSON.stringify(next));
      return next;
    });
  }
  function movePanelSection(key, dir) {
    setPanelOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      localStorage.setItem("taskspace-panel-order", JSON.stringify(next));
      return next;
    });
  }
  const [newColumn, setNewColumn] = useState({ key: "NEW", label: "NEW PJ", tone: "green" });
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(2026, 4, 1));
  const [mobileView, setMobileView] = useState("board");
  const [show7Days, setShow7Days] = useState(() => localStorage.getItem("taskspace-show7days") !== "false");
  const [show5col, setShow5col] = useState(() => localStorage.getItem("taskspace-show5col") !== "false");
  const [appFont, setAppFont] = useState(() => localStorage.getItem("taskspace-font") || "sans");
  const appFontCss = (FONT_OPTIONS.find((f) => f.key === appFont) || FONT_OPTIONS[0]).css;
  // md(768px)以上か。5列ビューと通常ビューを排他マウントし、ドラッグID重複を防ぐ
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const use5col = true; // 7days上 + Board下 固定レイアウト
  const [activeDrag, setActiveDrag] = useState(null); // { type, id, data }
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedTrayIds, setSelectedTrayIds] = useState(new Set());

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 6 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } });
  const sensors = useSensors(mouseSensor, ...(selectMode ? [touchSensor] : []));

  function handleDragStart({ active }) {
    setActiveDrag(active.data.current || null);
    // long-press context menu timer をキャンセル（ドラッグ開始と競合するため）
    if (typeof window.__taskspaceLongPressCancel === "function") {
      window.__taskspaceLongPressCancel();
    }
  }

  // セレクトモード時はbodyにクラスを付与してCSS側でtouch-action: noneを適用
  useEffect(() => {
    document.body.classList.toggle('ts-drag-mode', selectMode);
  }, [selectMode]);

  function handleDragEnd({ active, over }) {
    setActiveDrag(null);
    if (!over) return;
    const src = active.data.current;
    const dst = over.data.current;
    if (!src || !dst) return;

    // ドラッグアイテムの中心Y とドロップ先要素の中央Y を比較して上/下半分を判定
    function isBottomHalf() {
      if (!over.rect) return false;
      const midY = over.rect.top + over.rect.height / 2;
      const draggedRect = active.rect?.current?.translated;
      const pointerY = draggedRect
        ? draggedRect.top + draggedRect.height / 2
        : midY;
      return pointerY > midY;
    }

    // Column header reorder
    if (src.type === "column" && dst.type === "column" && src.key !== dst.key) {
      moveColumn(src.key, dst.key);
      return;
    }

    // Project header reorder
    if (src.type === "project" && dst.type === "project" && src.category === dst.category && src.project !== dst.project) {
      moveProject(src.category, src.project, dst.project);
      return;
    }

    // Tray item reorder within tray
    if (src.type === "tray" && dst.type === "tray" && src.id !== dst.id) {
      moveInboxItem(src.id, dst.id);
      return;
    }

    // Tray → Today (列全体 or Today内のタスクカード上にドロップした場合も同様に処理)
    if (src.type === "tray" && (dst.type === "today" || dst.type === "task-in-today")) {
      acceptInboxItem(src.id, "", "", { today: true, plain: true });
      setToast("TRAYからTodayにカテゴリなしタスクとして追加しました");
      return;
    }

    // Tray → Weekly (列全体 or Weekly内のタスクカード上にドロップした場合も同様に処理)
    if (src.type === "tray" && (dst.type === "weekly" || dst.type === "task-in-weekly")) {
      acceptInboxItem(src.id, "", "", { thisWeek: true, plain: true });
      setToast("TRAYからWeeklyにカテゴリなしタスクとして追加しました");
      return;
    }

    // Tray → Project (プロジェクト枠 or その中のタスク上にドロップした場合も処理)
    if (src.type === "tray" && dst.type === "project") {
      acceptInboxItem(src.id, dst.category, dst.project);
      return;
    }
    if (src.type === "tray" && dst.type === "task") {
      const target = taskMap.get(dst.id);
      if (target) acceptInboxItem(src.id, target.category, target.project);
      return;
    }

    // Task → Today (scheduledDate=今日 に集約)
    if (src.type === "task" && dst.type === "today") {
      const tKey = toDateKey(new Date());
      upsertTask({ id: src.id, scheduledDate: tKey, today: false, thisWeek: false });
      setToast("Todayに追加しました");
      return;
    }

    // Task → Weekly (今週・曜日未指定 = scheduledDateクリア + thisWeek)
    if (src.type === "task" && dst.type === "weekly") {
      const relatedIds = [src.id, ...collectAncestorIds(src.id), ...collectDescendantIds(src.id)];
      commitTasks((prev) => prev.map((t) => relatedIds.includes(t.id) ? { ...t, thisWeek: true, today: false, scheduledDate: "" } : t));
      setToast("Weekly Taskに追加しました");
      return;
    }

    // Task reorder / parent-child within Today
    if (src.type === "task" && dst.type === "task-in-today" && src.id !== dst.id) {
      const dragged = taskMap.get(src.id);
      const tKey = toDateKey(new Date());
      // 今日でないタスクを Today タスクにドロップ → Today(今日)に配置（排他）
      if (!schedIsToday(dragged, tKey)) {
        upsertTask({ id: src.id, scheduledDate: tKey, today: false, thisWeek: false });
        setToast("Todayに移動しました");
        return;
      }
      // 自分の親にドロップ → 並列化（親子解除）
      if (dragged?.parentId === dst.id) {
        const parent = taskMap.get(dst.id);
        upsertTask({ id: src.id, parentId: parent?.parentId ?? null });
        setToast("並列化：親子を解除しました");
        return;
      }
      if (isBottomHalf()) {
        const target = taskMap.get(dst.id);
        if (target && dragged && target.parentId !== src.id) {
          if (taskDepth(dst.id) >= MAX_DEPTH) { setToast("これ以上深い階層は作れません"); return; }
          // Today内では category/project は変えず parentId のみ変更
          upsertTask({ id: src.id, parentId: dst.id });
          setToast(`親子化：「${target.title}」の子タスクにしました`);
          return;
        }
      }
      moveTodayTask(src.id, dst.id);
      return;
    }

    // Task reorder / parent-child within Weekly
    if (src.type === "task" && dst.type === "task-in-weekly" && src.id !== dst.id) {
      const dragged = taskMap.get(src.id);
      const tKey = toDateKey(new Date());
      // 今日タスクを Weekly タスクにドロップ → Weekly(曜日未指定)に移動（排他）
      if (schedIsToday(dragged, tKey)) {
        upsertTask({ id: src.id, thisWeek: true, today: false, scheduledDate: "" });
        setToast("Weeklyに移動しました");
        return;
      }
      // 自分の親にドロップ → 並列化（親子解除）
      if (dragged?.parentId === dst.id) {
        const parent = taskMap.get(dst.id);
        upsertTask({ id: src.id, parentId: parent?.parentId ?? null });
        setToast("並列化：親子を解除しました");
        return;
      }
      if (isBottomHalf()) {
        const target = taskMap.get(dst.id);
        if (target && dragged && target.parentId !== src.id) {
          if (taskDepth(dst.id) >= MAX_DEPTH) { setToast("これ以上深い階層は作れません"); return; }
          // Weekly内では category/project は変えず parentId のみ変更
          upsertTask({ id: src.id, parentId: dst.id });
          setToast(`親子化：「${target.title}」の子タスクにしました`);
          return;
        }
      }
      moveWeeklyTask(src.id, dst.id);
      return;
    }

    // Task → Project (drop on project zone or on another task in a project)
    if (src.type === "task" && dst.type === "project") {
      const task = taskMap.get(src.id);
      if (!task) return;
      upsertTask({ id: src.id, category: dst.category, project: dst.project, parentId: null });
      setToast(task.parentId ? `親子解除：${dst.category} / ${dst.project} の並列タスクにしました` : `移動：${dst.category} / ${dst.project} に変更しました`);
      return;
    }

    // Task dropped on another task (parent-child or cross-project move)
    if (src.type === "task" && dst.type === "task" && src.id !== dst.id) {
      const droppedOn = taskMap.get(dst.id);
      const dragged = taskMap.get(src.id);
      if (!droppedOn || !dragged) return;
      if (droppedOn.parentId === src.id) return; // avoid cycle
      // 自分の親にドロップ → 並列化（親子解除）
      if (dragged.parentId === dst.id) {
        upsertTask({ id: src.id, parentId: droppedOn.parentId ?? null });
        setToast("並列化：親子を解除しました");
        return;
      }
      const movedAcrossProject = dragged.category !== droppedOn.category || dragged.project !== droppedOn.project;
      if (movedAcrossProject) {
        upsertTask({ id: src.id, parentId: null, category: droppedOn.category, project: droppedOn.project });
        setToast(`移動：${droppedOn.category} / ${droppedOn.project} の並列タスクにしました`);
      } else {
        if (isBottomHalf()) {
          if (taskDepth(dst.id) >= MAX_DEPTH) { setToast("これ以上深い階層は作れません"); return; }
          upsertTask({ id: src.id, parentId: dst.id, category: droppedOn.category, project: droppedOn.project });
          setToast(`親子化：「${droppedOn.title}」の子タスクにしました`);
        } else {
          moveProjectTask(src.id, dst.id, true);
        }
      }
      return;
    }

    // Task → 別タスク(7Days内) : 親子化（プロジェクトにも反映）
    if (src.type === "task" && dst.type === "task-in-day" && src.id !== dst.id) {
      const target = taskMap.get(dst.id);
      const dragged = taskMap.get(src.id);
      if (!target || !dragged) return;
      // 循環防止：対象が自分の子孫なら無視
      if (collectDescendantIds(src.id).includes(dst.id)) return;
      if (taskDepth(dst.id) >= MAX_DEPTH) { setToast("これ以上深い階層は作れません"); return; }
      // 親の category/project を継承し、子として紐付け。scheduledDate はクリア（親配下に表示）
      upsertTask({ id: src.id, parentId: dst.id, category: target.category, project: target.project, scheduledDate: "", today: false, thisWeek: false });
      setToast(`親子化：「${target.title}」の子タスクにしました`);
      return;
    }

    // Task → 7-day column
    // scheduledDate を唯一の源として配置。legacy フラグ(today/thisWeek)はクリア。
    // 曜日カラムにドロップ → プロジェクトから外してプレーンタスクとして配置。
    if (src.type === "task" && dst.type === "day-column") {
      const tKey = toDateKey(new Date());
      upsertTask({ id: src.id, scheduledDate: dst.date, today: false, thisWeek: false, parentId: null, category: "", project: "" });
      setToast(dst.date === tKey ? "今日に配置しました" : `${dst.label}に配置しました`);
      return;
    }

    // Tray item dropped into tray drop zone
    if (src.type === "tray" && dst.type === "tray-zone") {
      return; // nothing to do
    }
  }

  // Supabase load が完了するまで保存を抑制するフラグ
  const supabaseReadyRef = useRef(false);
  // サーバーと同期済みの状態（id -> JSON署名）。変更行だけをupsertするために使う
  const syncedTasksRef = useRef(new Map());
  const syncedTrayRef = useRef(new Map());

  function sig(obj) { return JSON.stringify(obj); }
  function rememberSynced(tasksArr, trayArr) {
    if (tasksArr) { const m = new Map(); tasksArr.forEach((t) => m.set(t.id, sig(t))); syncedTasksRef.current = m; }
    if (trayArr) { const m = new Map(); trayArr.forEach((i, idx) => m.set(i.id, sig({ ...i, _idx: idx }))); syncedTrayRef.current = m; }
  }

  const [syncLog, setSyncLog] = useState([]);
  function addSyncLog(msg) {
    const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setSyncLog((prev) => [`${time} ${msg}`, ...prev].slice(0, 20));
  }

  // Save to localStorage immediately, Supabase debounced (load完了後のみ)
  const supabaseSaveTimer = useRef(null);
  useEffect(() => {
    const data = { tasks, categories, projectRules, projectOrder, inboxItems };
    saveLocal(data);
    if (supabaseReadyRef.current) {
      clearTimeout(supabaseSaveTimer.current);
      supabaseSaveTimer.current = setTimeout(() => {
        const deletedTaskIds = [...getTombstoneSet(TOMBSTONE_TASKS_KEY)]
        const deletedTrayIds = [...getTombstoneSet(TOMBSTONE_TRAY_KEY)]
        // 変更/新規の行だけを抽出（他デバイスで削除された未変更行を復活させないため）
        const changedTasks = tasks.filter((t) => syncedTasksRef.current.get(t.id) !== sig(t));
        const changedInbox = inboxItems
          .map((i, idx) => ({ item: i, idx }))
          .filter(({ item, idx }) => syncedTrayRef.current.get(item.id) !== sig({ ...item, _idx: idx }))
          .map(({ item, idx }) => ({ ...item, sortOrder: idx }));
        if (deletedTaskIds.length || deletedTrayIds.length) addSyncLog(`💾 保存時削除 task:${deletedTaskIds.length}件 tray:${deletedTrayIds.length}件`)
        saveToSupabase({ ...data, tasks: changedTasks, inboxItems: changedInbox, deletedTaskIds, deletedTrayIds }).then((err) => {
          if (err) addSyncLog(`❌ 保存エラー: ${err}`);
          else rememberSynced(tasks, inboxItems);
        })
      }, 1500);
    }
  }, [tasks, categories, projectRules, projectOrder, inboxItems]);

  // On mount: load from Supabase and override local state
  useEffect(() => {
    loadFromSupabase().then((remote) => {
      supabaseReadyRef.current = true;
      if (!remote) { addSyncLog('⚠ Supabase読込失敗（local使用）'); return; }
      addSyncLog(`✅ Supabase読込完了 task:${(remote.tasks||[]).length}件 tray:${(remote.inboxItems||[]).length}件`);
      if (remote.tasks !== undefined) {
        const deletedTasks = getTombstoneSet(TOMBSTONE_TASKS_KEY)
        const remoteTaskIds = new Set((remote.tasks || []).map(t => t.id))
        if (deletedTasks.size) addSyncLog(`🔍 tombstone ${[...deletedTasks].length}件 remote残存:${[...deletedTasks].filter(id => remoteTaskIds.has(id)).length}件`)
        pruneTombstones(TOMBSTONE_TASKS_KEY, remoteTaskIds)
        const applied = (remote.tasks || []).filter(t => !deletedTasks.has(t.id)).map(normalizeTask);
        setTasks(applied);
        rememberSynced(applied, null);
      }
      if (remote.categories?.length) setCategories(remote.categories);
      if (Object.keys(remote.projectRules || {}).length) setProjectRules(remote.projectRules);
      if (Object.keys(remote.projectOrder || {}).length) setProjectOrder(remote.projectOrder);
      if (remote.inboxItems !== undefined) {
        const deletedTray = getTombstoneSet(TOMBSTONE_TRAY_KEY)
        const remoteTrayIds = new Set((remote.inboxItems || []).map(i => i.id))
        pruneTombstones(TOMBSTONE_TRAY_KEY, remoteTrayIds)
        const appliedTray = (remote.inboxItems || []).filter(i => !deletedTray.has(i.id));
        setInboxItems(appliedTray);
        rememberSynced(null, appliedTray);
      }
    });
    // Notion DB ID を Supabase から復元（全端末で共有）
    dbLoadSettings().then((settings) => {
      const remoteDbId = settings?.notion_db_id;
      if (remoteDbId && remoteDbId !== notionDbId) {
        setNotionDbId(remoteDbId);
        localStorage.setItem("taskspace-notion-dbid", remoteDbId);
        addSyncLog("🔗 Notion DB ID を同期しました");
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [realtimeStatus, setRealtimeStatus] = useState("connecting");

  // Realtime: 他デバイスの変更を即時反映
  useEffect(() => {
    const unsubscribe = subscribeRealtime({
      // 変更のあった「その行だけ」を画面に反映（全件読み直しせずチラつきを防ぐ）
      onTaskChange: (payload) => {
        if (!supabaseReadyRef.current) return;
        if (payload?.eventType === 'DELETE') {
          const id = payload.old?.id;
          if (!id) return;
          addSyncLog('📡 Realtime: タスク削除受信');
          setTasks((prev) => prev.filter((t) => t.id !== id));
          syncedTasksRef.current.delete(id);
          return;
        }
        const row = payload?.new;
        if (!row) return;
        if (getTombstoneSet(TOMBSTONE_TASKS_KEY).has(row.id)) return; // 自分が削除済みなら無視
        const incoming = normalizeTask(rowToTask(row));
        addSyncLog('📡 Realtime: タスク更新受信');
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === incoming.id);
          if (idx === -1) return [incoming, ...prev];
          const next = [...prev]; next[idx] = incoming; return next;
        });
        syncedTasksRef.current.set(incoming.id, sig(incoming));
      },
      onTrayChange: (payload) => {
        if (!supabaseReadyRef.current) return;
        if (payload?.eventType === 'DELETE') {
          const id = payload.old?.id;
          if (!id) return;
          addSyncLog('📡 Realtime: TRAY削除受信');
          setInboxItems((prev) => prev.filter((i) => i.id !== id));
          syncedTrayRef.current.delete(id);
          return;
        }
        const row = payload?.new;
        if (!row) return;
        if (getTombstoneSet(TOMBSTONE_TRAY_KEY).has(row.id)) return;
        const incoming = rowToTray(row);
        addSyncLog('📡 Realtime: TRAY更新受信');
        setInboxItems((prev) => {
          const idx = prev.findIndex((i) => i.id === incoming.id);
          let next;
          if (idx === -1) next = [...prev, incoming];
          else { next = [...prev]; next[idx] = incoming; }
          // sortOrderがあれば並べ替え
          return next.slice().sort((a, b) => {
            const ao = typeof a.sortOrder === "number" ? a.sortOrder : 999999;
            const bo = typeof b.sortOrder === "number" ? b.sortOrder : 999999;
            return ao - bo;
          });
        });
      },
      onCategoryChange: () => {
        if (!supabaseReadyRef.current) return;
        loadFromSupabase().then((remote) => {
          if (remote?.categories?.length) setCategories(remote.categories);
        });
      },
      onProjectRuleChange: () => {
        if (!supabaseReadyRef.current) return;
        loadFromSupabase().then((remote) => {
          if (Object.keys(remote?.projectRules || {}).length) setProjectRules(remote.projectRules);
        });
      },
      onProjectOrderChange: () => {
        if (!supabaseReadyRef.current) return;
        loadFromSupabase().then((remote) => {
          if (Object.keys(remote?.projectOrder || {}).length) setProjectOrder(remote.projectOrder);
        });
      },
      onStatusChange: (status) => {
        setRealtimeStatus(status);
      },
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const categoryMap = useMemo(() => new Map(categories.map((cat) => [cat.key, cat])), [categories]);

  function categoryTone(categoryKey) {
    return toneClasses(categoryMap.get(categoryKey)?.tone || "neutral");
  }

  const projectsByCategory = useMemo(() => {
    const result = {};
    categories.forEach((cat) => {
      const projects = tasks.filter((task) => task.category === cat.key && task.project).map((task) => task.project);
      const uniqueProjects = Array.from(new Set(projects));
      const order = projectOrder[cat.key] || [];
      result[cat.key] = uniqueProjects.sort((a, b) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
        return a.localeCompare(b, "ja");
      });
    });
    return result;
  }, [tasks, categories, projectOrder]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (task.archived) return false;
      if (!showDone && task.status === "完了") return false;
      if (!q) return true;
      const parent = task.parentId ? taskMap.get(task.parentId)?.title : "";
      return [task.title, task.category, task.project, task.status, task.memo, task.dueDate, parent]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [tasks, search, showDone, taskMap]);

  const selectedTask = selectedTaskId ? taskMap.get(selectedTaskId) : null;

  function collectDescendantIds(parentId, sourceTasks = tasks) {
    const directChildren = sourceTasks.filter((task) => task.parentId === parentId);
    return directChildren.flatMap((child) => [child.id, ...collectDescendantIds(child.id, sourceTasks)]);
  }

  function collectAncestorIds(taskId, sourceTasks = tasks) {
    const current = sourceTasks.find((task) => task.id === taskId);
    if (!current?.parentId) return [];
    return [current.parentId, ...collectAncestorIds(current.parentId, sourceTasks)];
  }

  function snapshot() {
    return { tasks, categories, projectRules, projectOrder, inboxItems };
  }

  function commitState(updater) {
    const current = snapshot();
    const next = typeof updater === "function" ? updater(current) : updater;
    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    setHistory((prev) => ({ past: [...prev.past.slice(-49), current], future: [] }));
    setTasks(next.tasks);
    setCategories(next.categories);
    setProjectRules(next.projectRules || {});
    setProjectOrder(next.projectOrder || {});
    setInboxItems(next.inboxItems || []);
    return true;
  }

  function commitTasks(updater) {
    commitState((current) => ({ ...current, tasks: typeof updater === "function" ? updater(current.tasks) : updater }));
  }

  function undo() {
    if (!history.past.length) return;
    const previous = history.past[history.past.length - 1];
    setHistory((prev) => ({ past: prev.past.slice(0, -1), future: [snapshot(), ...prev.future].slice(0, 50) }));
    setTasks(previous.tasks);
    setCategories(previous.categories);
    setProjectRules(previous.projectRules || {});
    setProjectOrder(previous.projectOrder || {});
    setInboxItems(previous.inboxItems || []);
    setToast("Undoしました");
  }

  function redo() {
    if (!history.future.length) return;
    const next = history.future[0];
    setHistory((prev) => ({ past: [...prev.past.slice(-49), snapshot()], future: prev.future.slice(1) }));
    setTasks(next.tasks);
    setCategories(next.categories);
    setProjectRules(next.projectRules || {});
    setProjectOrder(next.projectOrder || {});
    setInboxItems(next.inboxItems || []);
    setToast("Redoしました");
  }

  useEffect(() => {
    function handleKeyDown(event) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const inInput = ["input", "textarea", "select"].includes(tag);

      // Delete/Backspace で選択中アイテムを削除（input内では無効）
      if (!inInput && (event.key === "Delete" || event.key === "Backspace")) {
        if (selectedIds.size > 0 || selectedTrayIds.size > 0) {
          event.preventDefault();
          if (selectedIds.size > 0) bulkDelete();
          else bulkTrayDelete();
          return;
        }
      }

      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) return;
      if (inInput) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
      if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [history, tasks, categories, selectedIds, selectedTrayIds]);

  function upsertTask(patch) {
    // categoryとprojectが設定されたらplainを自動でfalseに
    const resolved = (patch.category || patch.project) ? { plain: false, ...patch } : patch;
    commitTasks((prev) => prev.map((task) => (task.id === resolved.id ? normalizeTask({ ...task, ...resolved }) : task)));
  }

  function addTask({ title, category, project, parentId = null, thisWeek = false, today = false, dueDate = "", plain = false, select = false, scheduledDate = "" }) {
    const clean = normalizeTitle(title);
    if (!clean) return null;
    const parent = parentId ? taskMap.get(parentId) : null;
    const inheritedCategory = plain ? (category || "") : (parent?.category || category || categories[0]?.key || "NOMLAB");
    const inheritedProject = plain ? (project || "") : (parent?.project || project || "未分類");
    const newTask = normalizeTask({
      id: uid(),
      title: clean,
      category: inheritedCategory,
      project: inheritedProject,
      status: "未着手",
      thisWeek,
      today,
      parentId,
      plain,
      memo: parent ? `「${parent.title}」の子タスクとして追加` : "",
      dueDate,
      scheduledDate,
    });
    commitTasks((prev) => [newTask, ...prev]);
    if (select) setSelectedTaskId(newTask.id);
    setToast(parent ? "子タスクを追加：親のCategory / Projectを継承しました" : "タスクを追加しました");
    return newTask;
  }

  function addQuickMemo() {
    const task = addTask({ title: quickMemo, category: quickCategory, project: quickProject });
    if (task) setQuickMemo("");
  }

  function addInboxItem(title) {
    const clean = normalizeTitle(title);
    if (!clean) return;
    commitState((current) => ({
      ...current,
      inboxItems: [
        {
          id: uid(),
          title: clean,
          source: "Local Tray",
          createdAt: toDateKey(new Date()),
        },
        ...(current.inboxItems || []),
      ],
    }));
    setToast("未決定トレイに追加しました");
  }

  function acceptInboxItem(id, category = "", project = "", patch = {}, options = {}) {
    const item = inboxItems.find((entry) => entry.id === id);
    if (!item) return;
    const isPlain = !category && !project;
    const newTask = normalizeTask({
      id: uid(),
      title: item.title,
      category,
      project,
      status: "未着手",
      thisWeek: false,
      parentId: null,
      memo: "",
      dueDate: "",
      plain: isPlain,
      ...patch,
    });
    addTombstone(TOMBSTONE_TRAY_KEY, id);
    commitState((current) => ({
      ...current,
      tasks: [newTask, ...current.tasks],
      inboxItems: (current.inboxItems || []).filter((entry) => entry.id !== id),
    }));
    // Supabaseに即時反映（debounce待ちで消えないよう）
    dbDeleteTrayItem(id);
    dbUpsertTaskRow(newTask).then((err) => {
      if (err) addSyncLog(`❌ タスク保存失敗: ${err.message || JSON.stringify(err)}`);
      else addSyncLog(`💾 タスク即時保存 id=${newTask.id.slice(0,8)}`);
    });
    if (options.selectAfter) setSelectedTaskId(newTask.id);
    setToast(isPlain ? "カテゴリなしタスクとして追加しました" : `${category} / ${project} に受け入れました`);
    return newTask;
  }

  function updateInboxItem(id, patch) {
    commitState((current) => ({
      ...current,
      inboxItems: (current.inboxItems || []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
  }

  function removeInboxItem(id) {
    addTombstone(TOMBSTONE_TRAY_KEY, id);
    addSyncLog(`🗑 TRAY削除 id=${id.slice(0,8)}`);
    commitState((current) => ({
      ...current,
      inboxItems: (current.inboxItems || []).filter((entry) => entry.id !== id),
    }));
    dbDeleteTrayItem(id).then(() => addSyncLog(`✓ TRAY Supabase DELETE完了 id=${id.slice(0,8)}`)).catch((e) => addSyncLog(`✗ TRAY DELETE失敗: ${e?.message}`));
    setToast("TRAYから削除しました");
  }

  function moveInboxItem(dragId, targetId) {
    if (!dragId || !targetId || dragId === targetId) return;
    commitState((current) => {
      const list = [...(current.inboxItems || [])];
      const from = list.findIndex((entry) => entry.id === dragId);
      const to = list.findIndex((entry) => entry.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return { ...current, inboxItems: list };
    });
    setToast("TRAY内で並び替えました");
  }

  function toggleDone(task) {
    upsertTask({ id: task.id, status: task.status === "完了" ? "未着手" : "完了" });
  }

  // plainタスクをTRAYに戻す（Supabase即時反映）
  function returnTaskToTray(task) {
    const newItem = { id: uid(), title: task.title, source: "Local Tray", createdAt: toDateKey(new Date()) };
    addTombstone(TOMBSTONE_TASKS_KEY, task.id);
    commitState((current) => ({
      ...current,
      tasks: (current.tasks || []).filter((t) => t.id !== task.id),
      inboxItems: [newItem, ...(current.inboxItems || [])],
    }));
    dbDeleteTask(task.id);
    dbUpsertTrayRow(newItem);
    setToast("TRAYに戻しました");
  }

  function toggleWeek(task) {
    const wk = weekDateKeys(new Date());
    const nextValue = !schedIsThisWeek(task, wk);
    if (!nextValue && (task.plain || !task.category)) {
      returnTaskToTray(task);
      return;
    }
    const relatedIds = nextValue
      ? [task.id, ...collectAncestorIds(task.id), ...collectDescendantIds(task.id)]
      : [task.id, ...collectDescendantIds(task.id)];
    // 今週入り = thisWeek フラグ(曜日未指定)。今週外し = scheduledDate もクリア
    commitTasks((prev) => prev.map((item) => (relatedIds.includes(item.id)
      ? { ...item, thisWeek: nextValue, today: false, ...(nextValue ? {} : { scheduledDate: "" }) }
      : item)));
    setToast(nextValue ? "Weekly Taskに追加しました" : "Weekly Taskから外しました");
  }

  function toggleToday(task) {
    const tKey = toDateKey(new Date());
    const nextValue = !schedIsToday(task, tKey);
    if (!nextValue && (task.plain || !task.category)) {
      returnTaskToTray(task);
      return;
    }
    const relatedIds = nextValue
      ? [task.id, ...collectAncestorIds(task.id), ...collectDescendantIds(task.id)]
      : [task.id, ...collectDescendantIds(task.id)];
    // 今日入り = scheduledDate を今日に。今日外し = scheduledDate クリア
    commitTasks((prev) => prev.map((item) => (relatedIds.includes(item.id)
      ? { ...item, today: false, thisWeek: false, scheduledDate: nextValue ? tKey : "" }
      : item)));
    setToast(nextValue ? "Todayに追加しました" : "Todayから外しました");
  }

  function removeTask(id) {
    addTombstone(TOMBSTONE_TASKS_KEY, id);
    addSyncLog(`🗑 タスク削除 id=${id.slice(0,8)}`);
    commitTasks((prev) => prev.map((task) => (task.parentId === id ? { ...task, parentId: null } : task)).filter((task) => task.id !== id));
    dbDeleteTask(id).then(() => addSyncLog(`✓ タスク Supabase DELETE完了 id=${id.slice(0,8)}`)).catch((e) => addSyncLog(`✗ タスク DELETE失敗: ${e?.message}`));
    if (selectedTaskId === id) setSelectedTaskId(null);
    setToast("タスクを削除しました");
  }

  function archiveAll() {
    const doneIds = new Set(tasks.filter((t) => t.status === "完了" && !t.archived).map((t) => t.id));
    if (!doneIds.size) { setToast("完了タスクがありません"); return; }
    commitState((current) => ({ ...current, tasks: current.tasks.map((t) => doneIds.has(t.id) ? { ...t, archived: true, today: false, thisWeek: false } : t) }));
    setToast(`${doneIds.size}件をアーカイブしました`);
  }

  function resetDemo() {
    commitState({ tasks: SAMPLE_TASKS, categories: DEFAULT_CATEGORIES, projectRules: DEFAULT_PROJECT_RULES, projectOrder: DEFAULT_PROJECT_ORDER, inboxItems: SAMPLE_INBOX });
    setSelectedTaskId(null);
    setSelectedProject(null);
    setToast("サンプルデータに戻しました");
  }

  function addColumn() {
    const key = normalizeTitle(newColumn.key).toUpperCase().replace(/\s+/g, "_");
    if (!key || categories.some((cat) => cat.key === key)) {
      setToast("列キーが空、または重複しています");
      return;
    }
    commitState((current) => ({
      ...current,
      categories: [...current.categories, { key, label: newColumn.label || `${key} PJ`, tone: newColumn.tone }],
    }));
    setQuickCategory(key);
    setNewColumn({ key: "NEW", label: "NEW PJ", tone: "green" });
    setToast("列を追加しました");
  }

  function updateColumn(key, patch) {
    commitState((current) => ({
      ...current,
      categories: current.categories.map((cat) => (cat.key === key ? { ...cat, ...patch } : cat)),
    }));
  }

  function updateProjectRule(category, project, patch) {
    const key = projectKey(category, project);
    commitState((current) => ({
      ...current,
      projectRules: {
        ...(current.projectRules || {}),
        [key]: {
          recurrence: "none",
          recurrenceDay: null,
          recurrenceStart: "",
          recurrenceEnd: "",
          recurrenceDate: 1,
          recurrenceWeek: 1,
          ...((current.projectRules || {})[key] || {}),
          ...patch,
        },
      },
    }));
  }

  function deleteProject(category, project) {
    const key = projectKey(category, project);
    const targetTasks = tasks.filter((t) => t.category === category && t.project === project);
    const removeIds = targetTasks.map((t) => t.id);
    const newItems = targetTasks
      .filter((t) => !t.parentId)
      .map((t) => ({ id: uid(), title: t.title, source: "Local Tray", createdAt: toDateKey(new Date()) }));
    removeIds.forEach((id) => addTombstone(TOMBSTONE_TASKS_KEY, id));
    commitState((current) => {
      const nextRules = { ...(current.projectRules || {}) };
      delete nextRules[key];
      const nextOrder = { ...(current.projectOrder || {}) };
      if (nextOrder[category]) nextOrder[category] = nextOrder[category].filter((p) => p !== project);
      return {
        ...current,
        tasks: (current.tasks || []).filter((t) => !removeIds.includes(t.id)),
        inboxItems: [...newItems, ...(current.inboxItems || [])],
        projectRules: nextRules,
        projectOrder: nextOrder,
      };
    });
    removeIds.forEach((id) => dbDeleteTask(id));
    newItems.forEach((item) => dbUpsertTrayRow(item));
    dbDeleteProjectRule(key);
    setSelectedProject(null);
    setToast(`プロジェクトを削除し、${newItems.length}件をTRAYに戻しました`);
  }

  function removeColumn(key) {
    if (categories.length <= 1) {
      setToast("列は最低1つ必要です");
      return;
    }
    const fallback = categories.find((cat) => cat.key !== key)?.key;
    commitState((current) => {
      const nextProjectRules = {};
      Object.entries(current.projectRules || {}).forEach(([ruleKey, rule]) => {
        const info = projectLabelFromKey(ruleKey);
        if (info.category !== key) nextProjectRules[ruleKey] = rule;
      });
      return {
        categories: current.categories.filter((cat) => cat.key !== key),
        tasks: current.tasks.map((task) => (task.category === key ? { ...task, category: fallback } : task)),
        projectRules: nextProjectRules,
        projectOrder: Object.fromEntries(Object.entries(current.projectOrder || {}).filter(([categoryKey]) => categoryKey !== key)),
        inboxItems: current.inboxItems || [],
      };
    });
    if (quickCategory === key) setQuickCategory(fallback);
    setToast(`列を削除しました。属していたタスクは ${fallback} に移動しました`);
  }

  function moveColumn(dragKey, targetKey) {
    if (!dragKey || !targetKey || dragKey === targetKey) return;
    commitState((current) => {
      const from = current.categories.findIndex((cat) => cat.key === dragKey);
      const to = current.categories.findIndex((cat) => cat.key === targetKey);
      if (from < 0 || to < 0) return current;
      const nextCategories = [...current.categories];
      const [moved] = nextCategories.splice(from, 1);
      nextCategories.splice(to, 0, moved);
      return { ...current, categories: nextCategories };
    });
    setToast(`${dragKey} を ${targetKey} の位置へ移動しました`);
  }

  function moveProject(category, dragProject, targetProject) {
    if (!category || !dragProject || !targetProject || dragProject === targetProject) return;
    const currentProjects = projectsByCategory[category] || [];
    const from = currentProjects.indexOf(dragProject);
    const to = currentProjects.indexOf(targetProject);
    if (from < 0 || to < 0) return;

    const nextProjects = [...currentProjects];
    const [moved] = nextProjects.splice(from, 1);
    nextProjects.splice(to, 0, moved);

    commitState((current) => ({
      ...current,
      projectOrder: {
        ...(current.projectOrder || {}),
        [category]: nextProjects,
      },
    }));
    setToast(`${dragProject} を移動しました`);
  }

  function renameProject(category, oldName, newName) {
    const clean = newName.trim();
    if (!clean || clean === oldName) return false;
    const oldKey = projectKey(category, oldName);
    const newKey = projectKey(category, clean);
    commitState((current) => {
      const nextRules = { ...(current.projectRules || {}) };
      if (nextRules[oldKey]) { nextRules[newKey] = nextRules[oldKey]; delete nextRules[oldKey]; }
      const nextOrder = { ...(current.projectOrder || {}) };
      if (nextOrder[category]) nextOrder[category] = nextOrder[category].map((p) => p === oldName ? clean : p);
      return {
        ...current,
        tasks: current.tasks.map((t) => t.category === category && t.project === oldName ? { ...t, project: clean } : t),
        projectRules: nextRules,
        projectOrder: nextOrder,
      };
    });
    setSelectedProject({ category, project: clean });
    setToast(`プロジェクト名を変更しました`);
    return true;
  }

  function moveWeeklyTask(dragId, targetId) {
    if (!dragId || !targetId || dragId === targetId) return;
    // ルートのみ並び替え（子タスクの weeklyOrder は触らない）
    const rootList = weeklyRoots.map((task) => task.id);
    const from = rootList.indexOf(dragId);
    const to = rootList.indexOf(targetId);
    if (from < 0 || to < 0) {
      // どちらかが子タスク → フラットリスト全体で並び替え
      const weeklyList = weeklyTasks.map((task) => task.id);
      const fi = weeklyList.indexOf(dragId);
      const ti = weeklyList.indexOf(targetId);
      if (fi < 0 || ti < 0) return;
      const nextIds = [...weeklyList];
      const [moved] = nextIds.splice(fi, 1);
      nextIds.splice(ti, 0, moved);
      commitTasks((prev) => prev.map((task) => {
        const index = nextIds.indexOf(task.id);
        return index === -1 ? task : { ...task, weeklyOrder: index + 1 };
      }));
    } else {
      const nextIds = [...rootList];
      const [moved] = nextIds.splice(from, 1);
      nextIds.splice(to, 0, moved);
      // ルートだけ weeklyOrder を振り直す（子タスクは変えない）
      commitTasks((prev) => prev.map((task) => {
        const index = nextIds.indexOf(task.id);
        return index === -1 ? task : { ...task, weeklyOrder: index + 1 };
      }));
    }
    setToast("Weekly内で上下に並び替えました");
  }

  function moveTodayTask(dragId, targetId) {
    if (!dragId || !targetId || dragId === targetId) return;
    const todayList = todayTasks.map((task) => task.id);
    const from = todayList.indexOf(dragId);
    const to = todayList.indexOf(targetId);
    if (from < 0 || to < 0) return;

    const nextIds = [...todayList];
    const [moved] = nextIds.splice(from, 1);
    nextIds.splice(to, 0, moved);

    commitTasks((prev) =>
      prev.map((task) => {
        const index = nextIds.indexOf(task.id);
        return index === -1 ? task : { ...task, todayOrder: index + 1 };
      })
    );
    setToast("Today内で上下に並び替えました");
  }

  function moveProjectTask(dragId, targetId, insertBefore) {
    if (!dragId || !targetId || dragId === targetId) return;
    const draggedTask = taskMap.get(dragId);
    const targetTask = taskMap.get(targetId);
    if (!draggedTask || !targetTask) return;
    // Get all root tasks in the same project, sorted by current sortOrder
    const projectRoots = tasks
      .filter((t) => t.category === targetTask.category && t.project === targetTask.project && !t.parentId && !t.archived)
      .sort((a, b) => {
        const ao = typeof a.sortOrder === "number" ? a.sortOrder : 999999;
        const bo = typeof b.sortOrder === "number" ? b.sortOrder : 999999;
        if (ao !== bo) return ao - bo;
        return a.title.localeCompare(b.title, "ja");
      });
    const ids = projectRoots.map((t) => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const nextIds = [...ids];
    const [movedId] = nextIds.splice(from, 1);
    const insertAt = insertBefore ? nextIds.indexOf(targetId) : nextIds.indexOf(targetId) + 1;
    nextIds.splice(insertAt, 0, movedId);
    commitTasks((prev) =>
      prev.map((task) => {
        const index = nextIds.indexOf(task.id);
        return index === -1 ? task : { ...task, sortOrder: index + 1 };
      })
    );
    setToast("プロジェクト内で並び替えました");
  }

  function handleDropOnProject(event, category, project) {
    event.preventDefault();
    const inboxId = event.dataTransfer.getData("inbox/id") || event.dataTransfer.getData("application/x-tray-item");
    if (inboxId) {
      acceptInboxItem(inboxId, category, project);
      return;
    }

    const id = event.dataTransfer.getData("task/id");
    if (!id) return;
    const task = taskMap.get(id);
    if (!task) return;
    upsertTask({ id, category, project, parentId: null });
    setToast(task.parentId ? `親子解除：${category} / ${project} の並列タスクにしました` : `移動：${category} / ${project} に変更しました`);
  }

  function handleDropOnWeekly(event) {
    event.preventDefault();
    const inboxId = event.dataTransfer.getData("inbox/id") || event.dataTransfer.getData("application/x-tray-item");
    if (inboxId) {
      acceptInboxItem(inboxId, "", "", { thisWeek: true, plain: true });
      setToast("TRAYからWeeklyにカテゴリなしタスクとして追加しました");
      return;
    }

    const id = event.dataTransfer.getData("task/id");
    if (!id) return;
    const relatedIds = [id, ...collectAncestorIds(id), ...collectDescendantIds(id)];
    commitTasks((prev) => prev.map((task) => (relatedIds.includes(task.id) ? { ...task, thisWeek: true, today: false, scheduledDate: "" } : task)));
    setToast("親子構造ごとWeekly Taskに追加しました");
  }

  function handleDropOnToday(event) {
    event.preventDefault();
    event.stopPropagation();
    const inboxId = event.dataTransfer.getData("inbox/id") || event.dataTransfer.getData("application/x-tray-item");
    if (inboxId) {
      acceptInboxItem(inboxId, "", "", { today: true, plain: true });
      setToast("TRAYからTodayにカテゴリなしタスクとして追加しました。今日のカレンダーにも表示されます");
      return;
    }

    const id = event.dataTransfer.getData("task/id");
    if (!id) return;
    upsertTask({ id, scheduledDate: toDateKey(new Date()), today: false, thisWeek: false });
    setToast("Todayに追加しました。今日のカレンダーにも表示されます");
  }

  function handleDropOnTask(event, parent) {
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData("task/id");
    if (!id || id === parent.id) return;
    const target = taskMap.get(id);
    if (!target || parent.parentId === id) return;

    const movedAcrossProject = target.category !== parent.category || target.project !== parent.project;
    if (movedAcrossProject) {
      upsertTask({ id, parentId: null, category: parent.category, project: parent.project });
      setToast(`移動：${parent.category} / ${parent.project} の並列タスクにしました`);
      return;
    }

    if (taskDepth(parent.id) >= MAX_DEPTH) { setToast("これ以上深い階層は作れません"); return; }
    upsertTask({ id, parentId: parent.id, category: parent.category, project: parent.project });
    setToast(`親子化：「${parent.title}」の子タスクにしました`);
  }

  function tasksForCategory(category) {
    return filteredTasks.filter((task) => task.category === category);
  }

  function taskDepth(id) {
    let depth = 0;
    let current = taskMap.get(id);
    while (current?.parentId && depth < 10) {
      depth++;
      current = taskMap.get(current.parentId);
    }
    return depth;
  }

  const MAX_DEPTH = 3;

  function rootTasksForProject(category, project) {
    return tasksForCategory(category)
      .filter((task) => task.project === project && !task.parentId && !task.plain)
      .sort((a, b) => {
        const ao = typeof a.sortOrder === "number" ? a.sortOrder : 999999;
        const bo = typeof b.sortOrder === "number" ? b.sortOrder : 999999;
        if (ao !== bo) return ao - bo;
        return a.title.localeCompare(b.title, "ja");
      });
  }

  function childrenOf(parentId) {
    return filteredTasks
      .filter((task) => task.parentId === parentId)
      .sort((a, b) => {
        const ao = typeof a.sortOrder === "number" ? a.sortOrder : 999999;
        const bo = typeof b.sortOrder === "number" ? b.sortOrder : 999999;
        if (ao !== bo) return ao - bo;
        return a.title.localeCompare(b.title, "ja");
      });
  }

  const todayKey = toDateKey(new Date());

  const weeklyTasks = useMemo(() => {
    return filteredTasks
      .filter((task) => isThisWeekUnscheduled(task))
      .sort((a, b) => {
        const ao = typeof a.weeklyOrder === "number" ? a.weeklyOrder : 999999;
        const bo = typeof b.weeklyOrder === "number" ? b.weeklyOrder : 999999;
        if (ao !== bo) return ao - bo;
        return (a.category || "").localeCompare(b.category || "", "ja") || (a.project || "").localeCompare(b.project || "", "ja") || a.title.localeCompare(b.title, "ja");
      });
  }, [filteredTasks]);

  const todayTasks = useMemo(() => {
    return filteredTasks
      .filter((task) => schedIsToday(task, todayKey))
      .sort((a, b) => {
        const ao = typeof a.todayOrder === "number" ? a.todayOrder : 999999;
        const bo = typeof b.todayOrder === "number" ? b.todayOrder : 999999;
        if (ao !== bo) return ao - bo;
        return (a.category || "").localeCompare(b.category || "", "ja") || (a.project || "").localeCompare(b.project || "", "ja") || a.title.localeCompare(b.title, "ja");
      });
  }, [filteredTasks, todayKey]);

  const weeklyRoots = weeklyFlat
    ? weeklyTasks
    : weeklyTasks.filter((task) => !task.parentId || !isThisWeekUnscheduled(taskMap.get(task.parentId)));

  async function syncNotion({ silent = false } = {}) {
    if (!notionToken || !notionDbId) {
      if (!silent) setToast("Notion Token と DB ID を設定してください");
      return;
    }
    setNotionSyncing(true);
    setNotionError(null);
    const cleanDbId = notionDbId.replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0] || notionDbId.replace(/-/g, "");
    addSyncLog(`📤 Notion同期開始${silent ? "（自動）" : ""} db=${cleanDbId.slice(0, 8)}…`);
    try {
      const res = await fetch("/api/notion-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: notionToken, dbId: cleanDbId }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = {
          stage: data.stage || "unknown",
          status: data.status || res.status,
          code: data.code || "",
          message: data.error || "sync failed",
          hint: data.hint || "",
        };
        setNotionError(detail);
        addSyncLog(`❌ Notion失敗 [${detail.stage}] ${detail.status} ${detail.code}: ${detail.message}`);
        if (detail.hint) addSyncLog(`💡 ${detail.hint}`);
        if (!silent) setToast(`Notion同期エラー (${detail.status})`);
        return;
      }

      // 一度取り込んだNotionページIDを永続記録してスキップ
      const seenKey = "taskspace-notion-seen";
      const seenIds = new Set(JSON.parse(localStorage.getItem(seenKey) || "[]"));

      setInboxItems((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const newItems = data.pages
          .filter((p) => !existingIds.has(`notion-${p.id}`) && !seenIds.has(p.id))
          .map((p) => ({
            id: `notion-${p.id}`,
            title: p.title,
            source: "Notion",
            createdAt: p.createdAt,
          }));

        // 新規分のIDを seen に追加して保存
        data.pages.forEach((p) => seenIds.add(p.id));
        localStorage.setItem(seenKey, JSON.stringify([...seenIds]));

        if (newItems.length === 0) {
          addSyncLog(`✅ Notion取得 ${data.count ?? 0}件（新規なし）`);
          if (!silent) setToast("新しいNotionページはありませんでした");
          return prev;
        }
        addSyncLog(`✅ Notion取得 ${data.count ?? 0}件 → 新規${newItems.length}件をTRAYへ`);
        setToast(`${newItems.length}件をTRAYに追加しました`);
        return [...newItems, ...prev];
      });

      const now = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      setNotionLastSync(now);
      localStorage.setItem("taskspace-notion-last-sync", now);
    } catch (err) {
      setNotionError({ stage: "network", status: 0, code: "", message: err.message, hint: "アプリからAPIへの通信に失敗しました" });
      addSyncLog(`❌ Notion通信エラー: ${err.message}`);
      if (!silent) setToast(`Notion同期エラー: ${err.message}`);
    } finally {
      setNotionSyncing(false);
    }
  }

  // 最新の syncNotion を ref に保持（interval のクロージャ陳腐化を防ぐ）
  const syncNotionRef = useRef(syncNotion);
  syncNotionRef.current = syncNotion;

  // 自動同期: 起動時に1回 ＋ 5分ごと（トークン/DB設定済み かつ ONのとき）
  useEffect(() => {
    if (!notionAutoSync || !notionToken || !notionDbId) return;
    const run = () => syncNotionRef.current?.({ silent: true });
    run();
    const interval = setInterval(run, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [notionAutoSync, notionToken, notionDbId]);

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSelectedTrayIds(new Set());
    setShowMovePanel(false);
  }

  function onToggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onToggleTraySelect(id) {
    setSelectedTrayIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkTrayToday() {
    const ids = [...selectedTrayIds];
    ids.forEach((id) => acceptInboxItem(id, "", "", { today: true, plain: true }));
    setToast(`${ids.length}件をTodayに追加しました`);
    exitSelectMode();
  }

  function bulkTrayWeekly() {
    const ids = [...selectedTrayIds];
    ids.forEach((id) => acceptInboxItem(id, "", "", { thisWeek: true, plain: true }));
    setToast(`${ids.length}件をWeeklyに追加しました`);
    exitSelectMode();
  }

  function bulkTrayDelete() {
    const ids = [...selectedTrayIds];
    addSyncLog(`🗑 TRAY一括削除 ${ids.length}件`);
    ids.forEach((id) => {
      addTombstone(TOMBSTONE_TRAY_KEY, id);
      dbDeleteTrayItem(id).then(() => addSyncLog(`✓ TRAY DELETE完了 id=${id.slice(0,8)}`)).catch((e) => addSyncLog(`✗ TRAY DELETE失敗: ${e?.message}`));
    });
    commitState((current) => ({
      ...current,
      inboxItems: (current.inboxItems || []).filter((i) => !selectedTrayIds.has(i.id)),
    }));
    setToast(`${ids.length}件を削除しました`);
    exitSelectMode();
  }

  function bulkToday() {
    const tKey = toDateKey(new Date());
    commitTasks((prev) => prev.map((t) => selectedIds.has(t.id) ? { ...t, scheduledDate: tKey, today: false, thisWeek: false } : t));
    setToast(`${selectedIds.size}件をTodayに追加しました`);
    exitSelectMode();
  }

  function bulkWeekly() {
    commitTasks((prev) => prev.map((t) => selectedIds.has(t.id) ? { ...t, thisWeek: true, today: false, scheduledDate: "" } : t));
    setToast(`${selectedIds.size}件をWeeklyに追加しました`);
    exitSelectMode();
  }

  function bulkArchive() {
    commitTasks((prev) => prev.map((t) => selectedIds.has(t.id) ? { ...t, archived: true, today: false, thisWeek: false } : t));
    setToast(`${selectedIds.size}件をアーカイブしました`);
    exitSelectMode();
  }

  function bulkDelete() {
    const ids = [...selectedIds];
    // プロジェクト所属タスクは Today/Weekly から外すだけ（プロジェクト側は保持）
    // plain タスク（カテゴリなし）のみ完全削除
    const toRemoveFromView = ids.filter((id) => taskMap.get(id)?.category);
    const toDelete = ids.filter((id) => !taskMap.get(id)?.category);

    if (toRemoveFromView.length > 0) {
      commitTasks((prev) => prev.map((t) => toRemoveFromView.includes(t.id) ? { ...t, today: false, thisWeek: false } : t));
    }
    if (toDelete.length > 0) {
      // plain タスク（今日/今週/特定日に配置済み）は TRAY に戻す、それ以外は完全削除
      const toTray = toDelete.filter((id) => { const t = taskMap.get(id); return t && (t.today || t.thisWeek || t.scheduledDate); });
      const toReallyDelete = toDelete.filter((id) => !toTray.includes(id));
      toTray.forEach((id) => {
        const t = taskMap.get(id);
        if (t) addInboxItem(t.title);
      });
      const allToRemove = [...toDelete]; // tray + delete 両方タスクから消す
      addSyncLog(`🗑 タスク一括削除 ${toReallyDelete.length}件`);
      toReallyDelete.forEach((id) => {
        addTombstone(TOMBSTONE_TASKS_KEY, id);
        dbDeleteTask(id).then(() => addSyncLog(`✓ タスク DELETE完了 id=${id.slice(0,8)}`)).catch((e) => addSyncLog(`✗ タスク DELETE失敗: ${e?.message}`));
      });
      commitTasks((prev) => prev.filter((t) => !allToRemove.includes(t.id)));
    }
    const removedCount = toRemoveFromView.length;
    const deletedCount = toDelete.length;
    setToast(removedCount > 0 && deletedCount > 0
      ? `${removedCount}件をビューから除外、${deletedCount}件をTRAYに戻しました`
      : removedCount > 0 ? `${removedCount}件をTodayとWeeklyから外しました`
      : `${deletedCount}件をTRAYに戻しました`);
    exitSelectMode();
  }

  function bulkMoveProject(category, project) {
    commitTasks((prev) => prev.map((t) => selectedIds.has(t.id) ? { ...t, category, project, parentId: null, plain: false } : t));
    setToast(`${selectedIds.size}件を ${category} / ${project} に移動しました`);
    exitSelectMode();
  }

  function bulkMoveTo(category, project) {
    const trayIds = [...selectedTrayIds];
    const taskCount = selectedIds.size;
    const trayCount = trayIds.length;
    if (taskCount > 0) commitTasks((prev) => prev.map((t) => selectedIds.has(t.id) ? { ...t, category, project, parentId: null, plain: false } : t));
    if (trayCount > 0) {
      trayIds.forEach((id) => {
        const item = inboxItems.find((i) => i.id === id);
        if (!item) return;
        const newTask = normalizeTask({ id: uid(), title: item.title, category, project, status: "未着手", parentId: null, memo: `Imported from Inbox`, dueDate: "", plain: false });
        commitState((current) => ({
          ...current,
          tasks: [newTask, ...current.tasks],
          inboxItems: (current.inboxItems || []).filter((i) => i.id !== id),
        }));
        addTombstone(TOMBSTONE_TRAY_KEY, id);
        dbDeleteTrayItem(id);
      });
    }
    setToast(`${taskCount + trayCount}件を ${category} / ${project} に移動しました`);
    setShowMovePanel(false);
    exitSelectMode();
  }

  function changeZoom(val) {
    const v = Math.min(2.0, Math.max(0.5, val));
    setZoom(v);
    localStorage.setItem("taskspace-zoom", String(v));
    document.documentElement.style.zoom = String(v);
  }

  function applyFontSize(v) {
    let el = document.getElementById('ts-fontsize-style');
    if (!el) { el = document.createElement('style'); el.id = 'ts-fontsize-style'; document.head.appendChild(el); }
    el.textContent = [
      `.text-\\[9px\\]  { font-size: ${9  * v}px !important; }`,
      `.text-\\[10px\\] { font-size: ${10 * v}px !important; }`,
      `.text-\\[11px\\] { font-size: ${11 * v}px !important; }`,
      `.text-\\[12\\.5px\\] { font-size: ${12.5 * v}px !important; }`,
      `.text-xs   { font-size: ${Math.round(12 * v)}px !important; }`,
      `.text-sm   { font-size: ${Math.round(14 * v)}px !important; }`,
      `.text-base { font-size: ${Math.round(16 * v)}px !important; }`,
      `.text-xl   { font-size: ${Math.round(20 * v)}px !important; }`,
      `.text-2xl  { font-size: ${Math.round(24 * v)}px !important; }`,
    ].join('\n');
  }

  function changeFontSize(val) {
    const v = Math.min(1.5, Math.max(0.7, val));
    setFontSize(v);
    localStorage.setItem("taskspace-fontsize", String(v));
    applyFontSize(v);
  }

  // 初期zoom・fontsize適用
  useEffect(() => {
    document.documentElement.style.zoom = String(zoom);
    applyFontSize(fontSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DndContext sensors={sensors} collisionDetection={taskFirstCollision} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="min-h-screen bg-neutral-950 text-neutral-100" style={{ fontFamily: appFontCss }}>
      <div className="mx-auto flex max-w-[2400px] flex-col gap-2 px-3 py-2">
        <header className="sticky top-0 z-30 -mx-2 flex flex-wrap items-center gap-2 border-b border-white/10 bg-neutral-950/90 px-2 py-2 backdrop-blur">
          <div className="mr-3 flex items-baseline gap-2">
            <h1 className="text-xl font-semibold tracking-tight">⚡ Task Space</h1>
            <span className="text-[11px] text-neutral-500">v{__APP_VERSION__}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {quickAddOpen ? (
              <form onSubmit={(e) => {
                e.preventDefault();
                const title = quickAddTitle.trim();
                if (title) {
                  const tKey = toDateKey(new Date());
                  addTask({ title, scheduledDate: tKey, category: "", project: "" });
                  setToast(`「${title}」をTodayに追加しました`);
                }
                setQuickAddTitle("");
                setQuickAddOpen(false);
              }} className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={quickAddTitle}
                  onChange={(e) => setQuickAddTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { setQuickAddOpen(false); setQuickAddTitle(""); } }}
                  placeholder="タスク名を入力…"
                  className="w-44 rounded-md border border-white/20 bg-white/[0.07] px-2 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/20 sm:w-56"
                />
                <button type="submit" className="rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-500/25">追加</button>
                <button type="button" onClick={() => { setQuickAddOpen(false); setQuickAddTitle(""); }} className="rounded-md border border-white/10 bg-white/[0.03] p-1.5 text-neutral-400 transition hover:bg-white/[0.07]"><X className="h-3.5 w-3.5" /></button>
              </form>
            ) : (
              <button onClick={() => setQuickAddOpen(true)} title="タスクを追加" className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.07]"><Plus className="h-3.5 w-3.5" /></button>
            )}
            <button onClick={() => window.location.reload()} title="再読み込み" className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.07]"><RefreshCw className="h-3.5 w-3.5" /></button>
            <button onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)" className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-30"><Undo2 className="h-3.5 w-3.5" /></button>
            <button onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Shift+Z)" className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-30"><Redo2 className="h-3.5 w-3.5" /></button>
            <button
              onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
              title="Select mode"
              className={classNames("rounded-md border px-2 py-1.5 text-xs transition flex items-center gap-1", selectMode ? "border-white/30 bg-white/20 text-neutral-100" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Select</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowSettingsPanel((v) => !v)}
                className={classNames("rounded-md border px-2 py-1.5 text-xs transition", showSettingsPanel ? "border-white/25 bg-white/10 text-neutral-100" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}
                title="Settings"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              {showSettingsPanel && (
                <div className="fixed right-2 top-14 z-50 w-72 rounded-lg border border-white/15 bg-neutral-900 p-3 shadow-2xl max-h-[calc(100vh-4rem)] overflow-y-auto md:absolute md:right-0 md:top-full md:mt-1 md:w-64 md:max-h-[80vh]">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-200">Settings</span>
                    <button onClick={() => setShowSettingsPanel(false)} className="text-neutral-500 hover:text-neutral-200"><X className="h-3.5 w-3.5" /></button>
                  </div>

                  {/* Zoom */}
                  <div className="mb-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">表示サイズ</div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => changeZoom(zoom - 0.1)} className="rounded border border-white/10 px-2 py-1 text-xs text-neutral-400 hover:bg-white/[0.07]">−</button>
                      <div className="flex-1 text-center text-xs text-neutral-300">{Math.round(zoom * 100)}%</div>
                      <button onClick={() => changeZoom(zoom + 0.1)} className="rounded border border-white/10 px-2 py-1 text-xs text-neutral-400 hover:bg-white/[0.07]">＋</button>
                      <button onClick={() => changeZoom(1)} className="rounded border border-white/10 px-2 py-1 text-[10px] text-neutral-500 hover:bg-white/[0.07]">reset</button>
                    </div>
                  </div>
                  {/* Font Size */}
                  <div className="mb-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">文字サイズ</div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => changeFontSize(fontSize - 0.1)} className="rounded border border-white/10 px-2 py-1 text-xs text-neutral-400 hover:bg-white/[0.07]">−</button>
                      <div className="flex-1 text-center text-xs text-neutral-300">{Math.round(fontSize * 100)}%</div>
                      <button onClick={() => changeFontSize(fontSize + 0.1)} className="rounded border border-white/10 px-2 py-1 text-xs text-neutral-400 hover:bg-white/[0.07]">＋</button>
                      <button onClick={() => changeFontSize(1.2)} className="rounded border border-white/10 px-2 py-1 text-[10px] text-neutral-500 hover:bg-white/[0.07]">reset</button>
                    </div>
                  </div>

                  <div className="mb-3 border-t border-white/10 pt-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">表示</div>
                    <button onClick={() => setShowDone((v) => !v)} className={classNames("mb-1.5 w-full rounded border px-2 py-1.5 text-left text-xs transition", showDone ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}>
                      {showDone ? "✓ 完了タスクを表示中" : "完了タスクを非表示中"}
                    </button>
                    <button onClick={() => { const v = !leftPanelHorizontal; setLeftPanelHorizontal(v); localStorage.setItem("taskspace-left-horizontal", String(v)); }} className={classNames("w-full rounded border px-2 py-1.5 text-left text-xs transition", leftPanelHorizontal ? "border-sky-400/30 bg-sky-400/10 text-sky-200" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}>
                      {leftPanelHorizontal ? "✓ TRAY/Today/Weekly 横並び" : "TRAY/Today/Weekly 横並び"}
                    </button>
                  </div>

                  <div className="mb-3 border-t border-white/10 pt-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">フォント</div>
                    <select
                      value={appFont}
                      onChange={(e) => { setAppFont(e.target.value); localStorage.setItem("taskspace-font", e.target.value); }}
                      className="w-full rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none"
                    >
                      {FONT_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>

                  <div className="mb-3 border-t border-white/10 pt-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">セクション順序</div>
                    <div className="flex flex-col gap-1">
                      {panelOrder.map((key, idx) => (
                        <div key={key} className="flex items-center gap-1 rounded border border-white/5 bg-black/15 px-2 py-1">
                          <input
                            value={sectionLabels[key] ?? DEFAULT_SECTION_LABELS[key] ?? key}
                            onChange={(e) => updateSectionLabel(key, e.target.value)}
                            className="flex-1 min-w-0 bg-transparent text-[11px] text-neutral-300 outline-none placeholder:text-neutral-600"
                            placeholder={DEFAULT_SECTION_LABELS[key] || key}
                          />
                          <button onClick={() => movePanelSection(key, -1)} disabled={idx === 0} className="rounded p-0.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-20"><ChevronUp className="h-3 w-3" /></button>
                          <button onClick={() => movePanelSection(key, 1)} disabled={idx === panelOrder.length - 1} className="rounded p-0.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-20"><ChevronDown className="h-3 w-3" /></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mb-3 border-t border-white/10 pt-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">カラム設定</div>
                    <button onClick={() => { setShowColumnsPanel((v) => !v); setShowSettingsPanel(false); }} className="w-full rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-left text-xs text-neutral-300 transition hover:bg-white/[0.07]">
                      Columns を編集…
                    </button>
                  </div>

                  <div className="border-t border-white/10 pt-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">アーカイブ</div>
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => { archiveAll(); setShowSettingsPanel(false); }} className="w-full rounded border border-violet-400/25 bg-violet-500/10 px-2 py-1.5 text-left text-xs text-violet-200 transition hover:bg-violet-500/20">
                        完了タスクをすべてアーカイブ
                      </button>
                      {selectedIds.size > 0 && (
                        <button onClick={() => { bulkArchive(); setShowSettingsPanel(false); }} className="w-full rounded border border-violet-400/25 bg-violet-500/10 px-2 py-1.5 text-left text-xs text-violet-200 transition hover:bg-violet-500/20">
                          選択中の{selectedIds.size}件をアーカイブ
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="mb-2 text-[11px] text-neutral-500">同期ステータス</div>
                    <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
                      <div className={classNames("h-2 w-2 rounded-full shrink-0", realtimeStatus === "SUBSCRIBED" ? "bg-emerald-400" : realtimeStatus === "disabled" ? "bg-neutral-600" : realtimeStatus === "TIMED_OUT" || realtimeStatus === "CHANNEL_ERROR" ? "bg-red-400" : "bg-amber-400 animate-pulse")} />
                      <span className="text-[11px] text-neutral-400">
                        {realtimeStatus === "SUBSCRIBED" ? "リアルタイム同期中" : realtimeStatus === "disabled" ? "Supabase 未設定" : realtimeStatus === "TIMED_OUT" ? "タイムアウト" : realtimeStatus === "CHANNEL_ERROR" ? "接続エラー" : "接続中…"}
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10px] text-neutral-600">同期ログ（最新5件）</span>
                        {syncLog.length > 0 && <button onClick={() => setSyncLog([])} className="text-[10px] text-neutral-600 hover:text-neutral-400">クリア</button>}
                      </div>
                      <div className="rounded border border-white/[0.07] bg-black/30 p-1.5 font-mono">
                        {syncLog.length === 0
                          ? <div className="text-[10px] leading-5 text-neutral-700">（まだログなし）</div>
                          : syncLog.slice(0, 5).map((line, i) => (
                            <div key={i} className="text-[10px] leading-5 text-neutral-500">{line}</div>
                          ))
                        }
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] text-neutral-500">Notion 連携</span>
                      {notionLastSync && <span className="text-[10px] text-neutral-600">最終: {notionLastSync}</span>}
                    </div>
                    <input
                      type="password"
                      value={notionToken}
                      onChange={(e) => { setNotionToken(e.target.value); localStorage.setItem("taskspace-notion-token", e.target.value); }}
                      placeholder="Integration Token (secret_...)"
                      className="mb-1.5 w-full rounded border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] outline-none placeholder:text-neutral-600"
                    />
                    <input
                      value={notionDbId}
                      onChange={(e) => { setNotionDbId(e.target.value); localStorage.setItem("taskspace-notion-dbid", e.target.value); }}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v) dbSaveSetting("notion_db_id", v).then((err) => addSyncLog(err ? `❌ DB ID保存失敗: ${err.message || err}` : "💾 Notion DB ID を全端末に保存")); }}
                      placeholder="DB ID (32文字 or URL)"
                      className="mb-1.5 w-full rounded border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] outline-none placeholder:text-neutral-600"
                    />
                    <button
                      onClick={() => syncNotion()}
                      disabled={notionSyncing}
                      className="w-full rounded border border-neutral-400/20 bg-neutral-500/10 px-2 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-500/20 disabled:opacity-50"
                    >
                      {notionSyncing ? "同期中…" : "今すぐTRAYに同期"}
                    </button>

                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-neutral-500">
                        <input
                          type="checkbox"
                          checked={notionAutoSync}
                          onChange={(e) => { setNotionAutoSync(e.target.checked); localStorage.setItem("taskspace-notion-auto", e.target.checked ? "on" : "off"); }}
                          className="h-3 w-3 accent-neutral-400"
                        />
                        自動同期（起動時＋5分ごと）
                      </label>
                      <button
                        onClick={() => { localStorage.removeItem("taskspace-notion-seen"); setToast("取り込み済みIDをリセットしました"); }}
                        className="text-[10px] text-neutral-600 underline-offset-2 hover:text-neutral-400 hover:underline"
                        title="一度取り込んだページを再取得できるようにリセット"
                      >
                        履歴リセット
                      </button>
                    </div>

                    {notionError && (
                      <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-[10px] leading-relaxed text-red-200">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-semibold">Notionエラー詳細</span>
                          <button onClick={() => setNotionError(null)} className="text-red-300/60 hover:text-red-200">×</button>
                        </div>
                        <div className="space-y-0.5 text-red-200/90">
                          <div>段階: <span className="font-mono">{notionError.stage}</span></div>
                          <div>HTTP: <span className="font-mono">{notionError.status}</span>{notionError.code ? <> / <span className="font-mono">{notionError.code}</span></> : null}</div>
                          <div className="break-words">内容: {notionError.message}</div>
                          {notionError.hint && <div className="mt-1 rounded bg-black/20 p-1.5 text-amber-200/90">💡 {notionError.hint}</div>}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 border-t border-white/10 pt-3">
                    <button onClick={() => { resetDemo(); setShowSettingsPanel(false); }} className="flex w-full items-center gap-1.5 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-500 transition hover:bg-white/[0.07]">
                      <RotateCcw className="h-3 w-3" />サンプルデータに戻す
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>


        {showColumnsPanel && (
          <section className="rounded-lg border border-white/10 bg-white/[0.025] p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-neutral-300">Columns / Category Settings</div>
              <button onClick={() => setShowColumnsPanel(false)} className="text-neutral-500 hover:text-neutral-200"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-1 md:grid-cols-2 xl:grid-cols-4">
              {categories.map((cat) => (
                <div key={cat.key} className="grid grid-cols-[1fr_1.1fr_88px_24px] gap-1 rounded-md border border-white/5 bg-black/15 p-1">
                  <input value={cat.key} disabled className="rounded border border-white/5 bg-black/25 px-2 py-1 text-[11px] text-neutral-500 outline-none" />
                  <input value={cat.label} onChange={(event) => updateColumn(cat.key, { label: event.target.value })} className="rounded border border-white/5 bg-black/25 px-2 py-1 text-[11px] outline-none" />
                  <select value={cat.tone} onChange={(event) => updateColumn(cat.key, { tone: event.target.value })} className="rounded border border-white/5 bg-black/25 px-1 py-1 text-[11px] outline-none">
                    {TONES.map((tone) => <option key={tone}>{tone}</option>)}
                  </select>
                  <button onClick={() => removeColumn(cat.key)} className="rounded border border-red-300/10 text-red-200/50 hover:bg-red-400/10"><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="mt-2 grid gap-1 md:grid-cols-[120px_1fr_100px_60px]">
              <input value={newColumn.key} onChange={(event) => setNewColumn((prev) => ({ ...prev, key: event.target.value }))} placeholder="KEY" className="rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none" />
              <input value={newColumn.label} onChange={(event) => setNewColumn((prev) => ({ ...prev, label: event.target.value }))} placeholder="Label" className="rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none" />
              <select value={newColumn.tone} onChange={(event) => setNewColumn((prev) => ({ ...prev, tone: event.target.value }))} className="rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none">
                {TONES.map((tone) => <option key={tone}>{tone}</option>)}
              </select>
              <button onClick={addColumn} className="rounded bg-white px-2 py-1.5 text-xs font-medium text-neutral-950">Add</button>
            </div>
          </section>
        )}

        {use5col && (
          <>
          {(
            <div className={classNames("block ", (selectedTask || selectedProject) && "md:pr-[384px]")}>
              <SevenDayView tasks={filteredTasks} projectRules={projectRules} taskMap={taskMap} childrenOf={childrenOf} upsertTask={upsertTask} removeTask={removeTask} addTask={addTask} toggleDone={toggleDone} categoryTone={categoryTone} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} />
            </div>
          )}
          <div
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
            className={classNames("grid gap-2 items-start pb-2", (selectedTask || selectedProject) && "md:pr-[384px]")}
          >
            {/* TRAY column */}
            <div className="min-w-0">
              <div className="rounded-lg border border-white/10 bg-white/[0.02]">
                <div className="sticky top-0 flex items-baseline justify-between gap-2 border-b border-white/10 bg-neutral-950/80 px-2 py-1.5 backdrop-blur">
                  <span className="text-sm font-bold text-neutral-200">TRAY</span>
                  <span className="text-[10px] text-neutral-500">{tasks.filter(t => !t.category && !t.project && !t.archived).length + inboxItems.length}</span>
                </div>
                <div className="flex flex-col gap-0.5 px-2 py-2">
                  {(() => {
                    const rootTrayTasks = tasks.filter(t => !t.category && !t.project && !t.archived && !t.parentId);
                    return rootTrayTasks.map((task, idx) => (
                      <TrayTask
                        key={task.id}
                        task={task}
                        depth={0}
                        toggleDone={toggleDone}
                        upsertTask={upsertTask}
                        removeTask={removeTask}
                        setSelectedTaskId={setSelectedTaskId}
                        selectedTaskId={selectedTaskId}
                        childrenOf={childrenOf}
                        selectMode={selectMode}
                        selectedIds={selectedIds}
                        onToggleSelect={onToggleSelect}
                        onIndent={() => {
                          if (idx === 0) return;
                          const prev = rootTrayTasks[idx - 1];
                          upsertTask({ id: task.id, parentId: prev.id });
                        }}
                        onOutdent={() => {
                          if (!task.parentId) return;
                          upsertTask({ id: task.id, parentId: null });
                        }}
                      />
                    ));
                  })()}
                  {inboxItems.map((item) => (
                    <div key={item.id} className="rounded-md border border-neutral-700/40 bg-neutral-800/30 px-1.5 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800/50 transition cursor-pointer">
                      <div className="break-words">{item.title}</div>
                      <div className="mt-0.5 text-[9px] text-neutral-600">{item.source}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Board category columns */}
            {categories.map((cat) => (
              <div key={cat.key} className="min-w-0">
                <CategoryColumn category={cat} projects={projectsByCategory[cat.key] || []} rootTasksForProject={rootTasksForProject} childrenOf={childrenOf} taskMap={taskMap} collapsed={collapsed} setCollapsed={setCollapsed} addTask={addTask} upsertTask={upsertTask} removeTask={removeTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} handleDropOnProject={handleDropOnProject} handleDropOnTask={handleDropOnTask} moveColumn={moveColumn} moveProject={moveProject} categoryTone={categoryTone} projectRules={projectRules} selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
              </div>
            ))}
          </div>
          {/* 5列モードでもカレンダーは下に残す */}
          <div className={classNames("block ", (selectedTask || selectedProject) && "md:pr-[384px]")}>
            <CalendarView month={calendarMonth} setMonth={setCalendarMonth} tasks={filteredTasks} projectRules={projectRules} categoryTone={categoryTone} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} />
          </div>
          </>
        )}

        {!use5col && (
        <div className={classNames("flex flex-col gap-2 ", (selectedTask || selectedProject) && "md:pr-[384px]")}>
          {(() => {
            // Group consecutive board-type sections into a shared auto-fit grid
            const BOARD_KEYS = new Set(["tray", "today", "weekly", "board"]);
            const chunks = [];
            for (const key of panelOrder) {
              if (BOARD_KEYS.has(key)) {
                if (chunks.length && chunks[chunks.length - 1].type === "board-group") {
                  chunks[chunks.length - 1].keys.push(key);
                } else {
                  chunks.push({ type: "board-group", keys: [key] });
                }
              } else {
                chunks.push({ type: "standalone", key });
              }
            }

            const trayEl = (
              <InboxTray
                label={sectionLabels.tray}
                items={inboxItems}
                updateInboxItem={updateInboxItem}
                removeInboxItem={removeInboxItem}
                moveInboxItem={moveInboxItem}
                addInboxItem={addInboxItem}
                acceptInboxItem={acceptInboxItem}
                selectMode={selectMode}
                selectedTrayIds={selectedTrayIds}
                onToggleTraySelect={onToggleTraySelect}
              />
            );
            const todayEl = (
              <TodayColumn
                label={sectionLabels.today}
                wrapClass=""
                todayTasks={todayTasks}
                collapsed={collapsed}
                setCollapsed={setCollapsed}
                taskMap={taskMap}
                categoryTone={categoryTone}
                upsertTask={upsertTask}
                removeTask={removeTask}
                toggleDone={toggleDone}
                toggleWeek={toggleWeek} toggleToday={toggleToday}
                selectedTaskId={selectedTaskId}
                setSelectedTaskId={setSelectedTaskId}
                handleDropOnTask={handleDropOnTask}
                handleDropOnToday={handleDropOnToday}
                moveTodayTask={moveTodayTask}
                acceptInboxItem={acceptInboxItem}
                returnTaskToTray={returnTaskToTray}
                defaultCategory={quickCategory}
                defaultProject={quickProject}
                addTask={addTask}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
              />
            );
            const weeklyEl = (extraClass = "") => (
              <WeeklyColumn
                label={sectionLabels.weekly}
                className={classNames("flex", extraClass)}
                collapsed={collapsed}
                setCollapsed={setCollapsed}
                weeklyRoots={weeklyRoots}
                weeklyFlat={weeklyFlat}
                setWeeklyFlat={setWeeklyFlat}
                childrenOf={childrenOf}
                taskMap={taskMap}
                categoryTone={categoryTone}
                upsertTask={upsertTask}
                removeTask={removeTask}
                toggleDone={toggleDone}
                toggleWeek={toggleWeek} toggleToday={toggleToday}
                selectedTaskId={selectedTaskId}
                setSelectedTaskId={setSelectedTaskId}
                handleDropOnTask={handleDropOnTask}
                handleDropOnWeekly={handleDropOnWeekly}
                moveWeeklyTask={moveWeeklyTask}
                addTask={addTask}
                addInboxItem={addInboxItem}
                returnTaskToTray={returnTaskToTray}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
              />
            );
            const boardCols = categories.map((cat) => (
              <CategoryColumn key={cat.key} category={cat} projects={projectsByCategory[cat.key] || []} rootTasksForProject={rootTasksForProject} childrenOf={childrenOf} taskMap={taskMap} collapsed={collapsed} setCollapsed={setCollapsed} addTask={addTask} upsertTask={upsertTask} removeTask={removeTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} handleDropOnProject={handleDropOnProject} handleDropOnTask={handleDropOnTask} moveColumn={moveColumn} moveProject={moveProject} categoryTone={categoryTone} projectRules={projectRules} selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
            ));

            function renderBoardSection(key) {
              if (key === "tray") return <div key="tray" className="min-w-[200px] flex-1">{trayEl}</div>;
              if (key === "today") return <div key="today" className="min-w-[200px] flex-1">{todayEl}</div>;
              if (key === "weekly") return <div key="weekly" className="min-w-[200px] flex-1">{weeklyEl()}</div>;
              if (key === "board") return boardCols;
              return null;
            }

            return chunks.map((chunk, ci) => {
              if (chunk.type === "board-group") {
                const isVisibleMobile = mobileView === "board";
                const hasWeekly = chunk.keys.includes("weekly");
                // Stack tray+today in one column if adjacent
                const colItems = [];
                const keys = chunk.keys;
                let ki = 0;
                while (ki < keys.length) {
                  if (keys[ki] === "tray" && keys[ki + 1] === "today") {
                    colItems.push({ type: "stack", first: "tray", second: "today" });
                    ki += 2;
                  } else if (keys[ki] === "today" && keys[ki + 1] === "tray") {
                    colItems.push({ type: "stack", first: "today", second: "tray" });
                    ki += 2;
                  } else {
                    colItems.push({ type: "single", key: keys[ki] });
                    ki++;
                  }
                }

                return (
                  <div key={`group-${ci}`} className={classNames(isVisibleMobile ? "flex" : "hidden md:flex", "flex-wrap gap-2 md:flex-nowrap md:items-start")}>
                    {colItems.map((col, j) => {
                      if (col.type === "stack") {
                        const firstEl = col.first === "tray" ? trayEl : todayEl;
                        const secondEl = col.second === "tray" ? trayEl : todayEl;
                        return (
                          <div key={`stack-${j}`} className="flex min-w-[200px] flex-1 flex-col gap-2">
                            {firstEl}
                            {secondEl}
                          </div>
                        );
                      }
                      return renderBoardSection(col.key);
                    })}
                    {/* mobile weekly タブでも weekly を表示 */}
                    {!isVisibleMobile && hasWeekly && mobileView === "weekly" && (
                      <div className="flex-1 md:hidden">{weeklyEl()}</div>
                    )}
                  </div>
                );
              }
              // standalone section
              const { key } = chunk;
              if (key === "7days") return (
                <div key="7days" className={mobileView === "7days" ? "block" : show7Days ? "hidden md:block" : "hidden"}>
                  <SevenDayView tasks={filteredTasks} projectRules={projectRules} taskMap={taskMap} childrenOf={childrenOf} upsertTask={upsertTask} removeTask={removeTask} addTask={addTask} toggleDone={toggleDone} categoryTone={categoryTone} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} />
                </div>
              );
              if (key === "calendar") return (
                <div key="calendar" className={mobileView === "calendar" ? "block" : "hidden md:block"}>
                  <CalendarView month={calendarMonth} setMonth={setCalendarMonth} tasks={filteredTasks} projectRules={projectRules} categoryTone={categoryTone} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} />
                </div>
              );
              return null;
            });
          })()}
        </div>
        )}

        <div className={classNames("", (selectedTask || selectedProject) && "md:pr-[384px]")}>
          <ArchiveSection tasks={tasks} upsertTask={upsertTask} removeTask={removeTask} categoryTone={categoryTone} />
        </div>

        <ProjectInspector selectedProject={selectedTask ? null : selectedProject} projectRules={projectRules} updateProjectRule={updateProjectRule} deleteProject={deleteProject} moveProject={moveProject} renameProject={renameProject} projectsByCategory={projectsByCategory} onClose={() => setSelectedProject(null)} />

        <TaskInspector task={selectedTask} taskMap={taskMap} categories={categories} projectsByCategory={projectsByCategory} upsertTask={upsertTask} removeTask={removeTask} addTask={addTask} onClose={() => setSelectedTaskId(null)} />

        {selectMode && (selectedIds.size > 0 || selectedTrayIds.size > 0) && (
          <>
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-white/20 bg-neutral-900 px-3 py-2.5 shadow-2xl max-w-[calc(100vw-1.5rem)] overflow-x-auto scrollbar-none">
            <span className="flex-shrink-0 whitespace-nowrap rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-100">
              {selectedIds.size + selectedTrayIds.size}件選択中{selectedTrayIds.size > 0 && selectedIds.size > 0 && <span className="ml-1 text-neutral-400">({selectedTrayIds.size})</span>}
            </span>
            {getWeekDays().map((date, i) => {
              const dKey = toDateKey(date);
              const isToday = dKey === toDateKey(new Date());
              return (
                <button key={dKey} onClick={() => {
                  if (selectedIds.size > 0) commitTasks((prev) => prev.map((t) => selectedIds.has(t.id) ? { ...t, scheduledDate: dKey, today: false, thisWeek: false } : t));
                  if (selectedTrayIds.size > 0) { const ids = [...selectedTrayIds]; ids.forEach((id) => acceptInboxItem(id, "", "", { scheduledDate: dKey, plain: true })); }
                  setToast(`${selectedIds.size + selectedTrayIds.size}件を${DAY_LABELS[i]}に追加しました`);
                  exitSelectMode();
                }} className={classNames("flex-shrink-0 rounded-md border px-2 py-1.5 text-xs transition", isToday ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25" : "border-white/10 bg-white/[0.05] text-neutral-200 hover:bg-white/[0.12]")}>{DAY_LABELS[i]}</button>
              );
            })}
            <div className="relative flex-shrink-0">
              <button onClick={() => setShowMovePanel((v) => !v)} className={classNames("rounded-md border px-2.5 py-1.5 text-xs transition", showMovePanel ? "border-sky-400/40 bg-sky-500/15 text-sky-200" : "border-white/10 bg-white/[0.05] text-neutral-200 hover:bg-white/[0.12]")}>Move…</button>
            </div>
            <button onClick={() => {
              if (selectedIds.size > 0) bulkDelete();
              if (selectedTrayIds.size > 0) bulkTrayDelete();
            }} className="flex-shrink-0 rounded-md border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200 transition hover:bg-red-500/20">Delete</button>
            <button onClick={exitSelectMode} className="flex-shrink-0 ml-1 rounded-full border border-white/10 p-1 text-neutral-400 transition hover:bg-white/[0.07] hover:text-neutral-100"><X className="h-3.5 w-3.5" /></button>
          </div>
          {showMovePanel && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-64 max-h-[60vh] overflow-y-auto rounded-xl border border-white/15 bg-neutral-900 p-1.5 shadow-2xl">
              <div className="mb-1 px-2 text-[10px] text-neutral-600">移動先を選択</div>
              <div className="my-1 border-t border-white/10" />
              {categories.map((cat) => (
                <div key={cat.key}>
                  <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-neutral-500">{cat.label}</div>
                  {(projectsByCategory[cat.key] || []).map((proj) => (
                    <button key={proj} onClick={() => bulkMoveTo(cat.key, proj)} className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-white/[0.07]">{proj}</button>
                  ))}
                </div>
              ))}
            </div>
          )}
          </>
        )}
        {toast && <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-neutral-900/90 px-3 py-1.5 text-[11px] text-neutral-400 shadow-2xl backdrop-blur">{toast}</div>}
      </div>
    </div>
    <DragOverlay dropAnimation={null}>
      {activeDrag?.type === "task" && <div className="max-w-xs whitespace-pre-wrap rounded-md border border-white/30 bg-neutral-800/95 px-2 py-1.5 text-[12.5px] font-medium text-neutral-100 shadow-2xl opacity-95">{taskMap.get(activeDrag.id)?.title || "…"}</div>}
      {activeDrag?.type === "tray" && <div className="max-w-xs whitespace-pre-wrap rounded-md border border-white/30 bg-neutral-800/95 px-2 py-1.5 text-[12.5px] font-medium text-neutral-100 shadow-2xl opacity-95">{activeDrag.title || "…"}</div>}
      {activeDrag?.type === "column" && <div className="whitespace-nowrap rounded-md border border-white/30 bg-neutral-800/95 px-2 py-1.5 text-xs font-semibold text-neutral-100 shadow-2xl opacity-95">{activeDrag.label || activeDrag.key}</div>}
      {activeDrag?.type === "project" && <div className="whitespace-nowrap rounded-md border border-white/30 bg-neutral-800/95 px-2 py-1.5 text-xs font-semibold text-neutral-100 shadow-2xl opacity-95">{activeDrag.project}</div>}
    </DragOverlay>
    </DndContext>
  );
}

function TodayColumn({
  label = "Today",
  todayTasks,
  collapsed,
  setCollapsed,
  taskMap,
  categoryTone,
  upsertTask,
  removeTask,
  toggleDone,
  toggleWeek,
  toggleToday,
  selectedTaskId,
  setSelectedTaskId,
  handleDropOnTask,
  handleDropOnToday,
  moveTodayTask,
  acceptInboxItem,
  returnTaskToTray,
  defaultCategory,
  defaultProject,
  addTask,
  wrapClass = "",
  selectMode,
  selectedIds,
  onToggleSelect,
}) {
  const [draft, setDraft] = useState("");
  const { setNodeRef: todayDropRef, isOver: isTodayOver } = useDroppable({ id: "today-column", data: { type: "today" } });
  // プロジェクト側にもあるタスクはTodayから外すだけ。plainタスクはTRAYに戻す
  function removeTodayTask(id) {
    const t = taskMap.get(id);
    if (t && !t.plain && t.category) { upsertTask({ id, today: false, scheduledDate: "" }); }
    else if (t) { returnTaskToTray(t); }
  }

  function submitDraft() {
    const title = draft.trim();
    if (!title) return;
    addTask({ title, category: "", project: "", today: true, plain: true, select: false });
    setDraft("");
  }

  return (
    <aside ref={todayDropRef} className={classNames("flex min-h-[180px] flex-col rounded-lg border border-cyan-400/20 bg-cyan-500/[0.035] p-2 transition", isTodayOver && "border-cyan-300/50 bg-cyan-500/[0.07]", collapsed["column:today"] && "min-h-0", wrapClass)}>
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-cyan-200/10 pb-1.5">
        <button
          onClick={() => setCollapsed((prev) => ({ ...prev, ["column:today"]: !prev["column:today"] }))}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-cyan-200"
        >
          {collapsed["column:today"] ? <ChevronRight className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
          <CalendarDays className="h-3.5 w-3.5" />
          <h2 className="text-sm font-semibold">{label}</h2>
          <span className="rounded-full border border-cyan-200/15 px-1.5 py-0.5 text-[10px] text-cyan-100/45">{todayTasks.length}</span>
        </button>
      </div>
      {!collapsed["column:today"] && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitDraft()}
              placeholder="Add to Today"
              className="min-w-0 flex-1 rounded border border-cyan-300/15 bg-black/25 px-2 py-1.5 text-xs outline-none placeholder:text-cyan-100/30"
            />
            <button onClick={submitDraft} className="rounded border border-cyan-300/25 bg-cyan-500/10 px-2 py-1.5 text-xs text-cyan-200">Add</button>
          </div>
          <div className="flex flex-col gap-0.5">
            <AnimatePresence initial={false}>
              {todayTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  taskMap={taskMap}
                  categoryTone={categoryTone}
                  depth={0}
                  children={[]}
                  collapsed={collapsed}
                  setCollapsed={setCollapsed}
                  upsertTask={upsertTask}
                  removeTask={removeTodayTask}
                  toggleDone={toggleDone}
                  toggleWeek={toggleWeek} toggleToday={toggleToday}
                  selectedTaskId={selectedTaskId}
                  setSelectedTaskId={setSelectedTaskId}
                  handleDropOnTask={handleDropOnTask}
                  compact
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </AnimatePresence>
            {todayTasks.length === 0 && <div className="rounded-md border border-dashed border-cyan-200/20 p-3 text-center text-xs text-cyan-100/50">今日のタスクはまだありません。</div>}
          </div>
        </div>
      )}
    </aside>
  );
}

function WeeklyColumn({
  label = "Weekly",
  className = "",
  collapsed,
  setCollapsed,
  weeklyRoots,
  weeklyFlat,
  setWeeklyFlat,
  childrenOf,
  taskMap,
  categoryTone,
  upsertTask,
  removeTask,
  toggleDone,
  toggleWeek,
  toggleToday,
  selectedTaskId,
  setSelectedTaskId,
  handleDropOnTask,
  handleDropOnWeekly,
  moveWeeklyTask,
  addTask,
  addInboxItem,
  returnTaskToTray,
  selectMode,
  selectedIds,
  onToggleSelect,
}) {
  const [draft, setDraft] = useState("");
  const { setNodeRef: weeklyDropRef, isOver: isWeeklyOver } = useDroppable({ id: `weekly-column-${className || "main"}`, data: { type: "weekly" } });

  function removeWeeklyTask(id) {
    const t = taskMap.get(id);
    if (t && !t.plain && t.category) { upsertTask({ id, thisWeek: false, scheduledDate: "" }); }
    else if (t) { returnTaskToTray(t); }
  }

  function submitDraft() {
    const title = draft.trim();
    if (!title) return;
    addTask({ title, category: "", project: "", thisWeek: true, plain: true, select: false });
    setDraft("");
  }

  return (
    <aside ref={weeklyDropRef} className={classNames("flex-col rounded-lg border border-amber-400/20 bg-amber-500/[0.035] p-2 transition", isWeeklyOver && "border-amber-300/50 bg-amber-500/[0.07]", collapsed["column:weekly"] ? "min-h-0" : "min-h-[260px] md:min-h-[360px] xl:min-h-[430px]", className)}>
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-amber-200/10 pb-1.5">
        <button
          onClick={() => setCollapsed((prev) => ({ ...prev, ["column:weekly"]: !prev["column:weekly"] }))}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-amber-200"
        >
          {collapsed["column:weekly"] ? <ChevronRight className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
          <CalendarDays className="h-3.5 w-3.5" />
          <h2 className="text-sm font-semibold">{label}</h2>
          <span className="rounded-full border border-amber-200/15 px-1.5 py-0.5 text-[10px] text-amber-100/45">{weeklyRoots.length}</span>
        </button>
        {!collapsed["column:weekly"] && (
          <button onClick={() => setWeeklyFlat((value) => !value)} className="rounded border border-amber-200/15 bg-black/20 px-1.5 py-1 text-[10px] text-amber-100/70 transition hover:bg-amber-100/10" title="子タスク表示切替">{weeklyFlat ? <Columns3 className="h-3.5 w-3.5" /> : <ListTree className="h-3.5 w-3.5" />}</button>
        )}
      </div>
      {!collapsed["column:weekly"] && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitDraft()}
              placeholder="Add to Weekly"
              className="min-w-0 flex-1 rounded border border-amber-300/15 bg-black/25 px-2 py-1.5 text-xs outline-none placeholder:text-amber-100/30"
            />
            <button onClick={submitDraft} className="rounded border border-amber-300/25 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">Add</button>
          </div>
          <div className="flex flex-col gap-0.5">
            <AnimatePresence initial={false}>{weeklyRoots.map((task) => <TaskCard key={task.id} task={task} taskMap={taskMap} categoryTone={categoryTone} depth={0} children={weeklyFlat ? [] : childrenOf(task.id).filter((child) => isThisWeekUnscheduled(child))} childrenOf={childrenOf} collapsed={collapsed} setCollapsed={setCollapsed} upsertTask={upsertTask} removeTask={removeWeeklyTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} handleDropOnTask={handleDropOnTask} moveWeeklyTask={moveWeeklyTask} compact selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />)}</AnimatePresence>
            {weeklyRoots.length === 0 && <div className="rounded-md border border-dashed border-amber-200/20 p-4 text-center text-xs text-amber-100/50">今週タスクはまだありません。</div>}
          </div>
        </div>
      )}
    </aside>
  );
}

function InboxTray({ label = "TRAY", items, updateInboxItem, removeInboxItem, moveInboxItem, addInboxItem, acceptInboxItem, selectMode, selectedTrayIds, onToggleTraySelect }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");

  function submitDraft() {
    addInboxItem(draft);
    setDraft("");
  }

  return (
    <div className="w-full rounded-lg border border-neutral-400/15 bg-neutral-500/[0.055] p-2">
      <button onClick={() => setOpen((value) => !value)} className="mb-2 flex w-full items-center justify-between gap-2 border-b border-white/10 pb-1.5 text-left">
        <div className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
          <span className="truncate text-sm font-semibold text-neutral-300">{label}</span>
          <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-500">{items.length}</span>
        </div>
        <span className="text-[10px] text-neutral-600">Notion</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && submitDraft()}
              placeholder="Add to TRAY"
              className="min-w-0 flex-1 rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none placeholder:text-neutral-600"
            />
            <button onClick={submitDraft} className="rounded bg-white px-2 py-1.5 text-xs font-medium text-neutral-950">Add</button>
          </div>
          <div className="flex flex-col gap-1 pr-1">
            {items.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 p-3 text-center text-xs text-neutral-600">TRAY is empty</div>
            ) : (
              items.map((item) => (
                <TrayItem
                  key={item.id}
                  item={item}
                  updateInboxItem={updateInboxItem}
                  removeInboxItem={removeInboxItem}
                  moveInboxItem={moveInboxItem}
                  acceptInboxItem={acceptInboxItem}
                  selectMode={selectMode}
                  isSelected={selectedTrayIds && selectedTrayIds.has(item.id)}
                  onToggleSelect={onToggleTraySelect}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TrayItem({ item, updateInboxItem, removeInboxItem, moveInboxItem, acceptInboxItem, selectMode = false, isSelected = false, onToggleSelect }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);

  useEffect(() => {
    setDraft(item.title);
  }, [item.id, item.title]);

  const { attributes: trayDragAttrs, listeners: trayDragListeners, setNodeRef: trayDragRef, isDragging: isTrayDragging } = useDraggable({
    id: `tray-${item.id}`,
    data: { type: "tray", id: item.id, title: item.title },
    disabled: editing || selectMode,
  });
  const { setNodeRef: trayDropRef, isOver } = useDroppable({ id: `tray-drop-${item.id}`, data: { type: "tray", id: item.id } });

  function commitTitle() {
    const clean = normalizeTitle(draft);
    if (!clean) {
      setDraft(item.title);
      setEditing(false);
      return;
    }
    if (clean !== item.title) updateInboxItem(item.id, { title: clean });
    setEditing(false);
  }

  function cancelTitle() {
    setDraft(item.title);
    setEditing(false);
  }

  // Merge refs
  function setRefs(el) {
    trayDragRef(el);
    trayDropRef(el);
  }

  return (
    <div
      ref={setRefs}
      {...(!selectMode ? trayDragListeners : {})}
      {...(!selectMode ? trayDragAttrs : {})}
      onContextMenu={e => e.preventDefault()}
      onClick={() => { if (selectMode && onToggleSelect) onToggleSelect(item.id); }}
      data-draggable
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
      className={classNames(
        "group rounded-md border bg-black/20 p-2 transition hover:border-white/20 hover:bg-white/[0.045]",
        isOver ? "border-white/30 bg-white/[0.06]" : "border-white/10",
        isTrayDragging && "opacity-40",
        selectMode && isSelected && "border-sky-500/50 bg-sky-500/10",
        selectMode && "cursor-pointer"
      )}
    >
      <div className="flex items-start gap-2">
        {selectMode ? (
          <div className={classNames("mt-0.5 h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center transition", isSelected ? "border-sky-400 bg-sky-500/30" : "border-neutral-600")}>
            {isSelected && <div className="h-2 w-2 rounded-sm bg-sky-400" />}
          </div>
        ) : (
          <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-neutral-600 opacity-50 transition group-hover:opacity-100" />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              value={draft}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTitle();
                  event.currentTarget.blur();
                }
                if ((event.key === "Backspace" || event.key === "Delete") && event.currentTarget.value.length === 0) {
                  event.preventDefault();
                  removeInboxItem(item.id);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelTitle();
                  event.currentTarget.blur();
                }
              }}
              className="w-full rounded border border-white/15 bg-black/30 px-1 py-0.5 text-[12.5px] font-medium leading-[1.35] text-neutral-200 outline-none focus:border-white/35"
            />
          ) : (
            <div
              onClick={(e) => { if (selectMode) { e.stopPropagation(); return; } setEditing(true); }}
              className="block w-full break-words text-left text-[12.5px] font-medium leading-[1.35] text-neutral-200"
            >
              {item.title}
            </div>
          )}
        </div>
        {!selectMode && (
          <div className="flex shrink-0 gap-1">
            <button onClick={(e) => { e.stopPropagation(); acceptInboxItem(item.id, "", "", { scheduledDate: toDateKey(new Date()), plain: true }); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-neutral-500 transition hover:border-cyan-300/30 hover:bg-cyan-300/15 hover:text-cyan-100">今日</button>
            <button onClick={(e) => { e.stopPropagation(); acceptInboxItem(item.id, "", "", { thisWeek: true, plain: true }); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-neutral-500 transition hover:border-amber-300/30 hover:bg-amber-300/15 hover:text-amber-100">週</button>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryColumn({ category, projects, rootTasksForProject, childrenOf, taskMap, collapsed, setCollapsed, addTask, upsertTask, removeTask, toggleDone, toggleWeek, toggleToday, selectedTaskId, setSelectedTaskId, setSelectedProject, handleDropOnProject, handleDropOnTask, moveColumn, moveProject, categoryTone, projectRules, selectMode, selectedIds, onToggleSelect }) {
  const tone = toneClasses(category.tone);
  const [newProject, setNewProject] = useState("");
  const [showProjectInput, setShowProjectInput] = useState(false);
  const columnKey = `column:${category.key}`;
  const isColumnCollapsed = collapsed[columnKey];
  const effectiveProjects = projects.length ? projects : ["未分類"];

  const { setNodeRef: colDropRef, isOver: isColOver } = useDroppable({ id: `col-drop-${category.key}`, data: { type: "column", key: category.key } });
  const { attributes: colDragAttrs, listeners: colDragListeners, setNodeRef: colDragRef, isDragging: isColDragging } = useDraggable({ id: `col-drag-${category.key}`, data: { type: "column", key: category.key, label: category.label } });

  function createProject() {
    const clean = normalizeTitle(newProject);
    if (!clean) return;
    addTask({ title: "新規タスク", category: category.key, project: clean });
    setNewProject("");
    setShowProjectInput(false);
  }

  return (
    <div
      ref={colDropRef}
      className={classNames("w-full rounded-lg border p-2 transition", isColumnCollapsed ? "min-h-0" : "min-h-[420px] md:min-h-[560px] xl:min-h-[660px]", tone.panel, isColOver && "border-white/30")}
    >
      <div
        ref={colDragRef}
        {...colDragListeners}
        {...colDragAttrs}
        className={classNames("mb-2 flex cursor-grab items-center justify-between gap-2 border-b border-white/10 pb-1.5 active:cursor-grabbing", isColDragging && "opacity-40")}
      >
        <button
          onClick={() => setCollapsed((prev) => ({ ...prev, [columnKey]: !prev[columnKey] }))}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-neutral-600 hover:text-neutral-300" />
          {isColumnCollapsed ? <ChevronRight className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
          <span className={classNames("truncate text-sm font-semibold", tone.accent)}>{category.label}</span>
          <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-500">{projects.length}</span>
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            if (isColumnCollapsed) setCollapsed((prev) => ({ ...prev, [columnKey]: false }));
            setShowProjectInput((value) => !value);
          }}
          className={classNames("rounded border px-1.5 py-1 text-[10px] transition", tone.add)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {!isColumnCollapsed && showProjectInput && (
        <div className="mb-2 flex gap-1">
          <input value={newProject} onChange={(event) => setNewProject(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createProject()} placeholder="新しいProject" className="min-w-0 flex-1 rounded border border-white/10 bg-black/25 px-2 py-1 text-xs outline-none placeholder:text-neutral-600" />
          <button onClick={createProject} className="rounded bg-white px-2 py-1 text-xs font-medium text-neutral-950">作成</button>
        </div>
      )}
      {!isColumnCollapsed && (
        <div className="flex flex-col gap-2">
          {effectiveProjects.map((project) => <ProjectGroup key={`${category.key}-${project}`} category={category.key} project={project} roots={rootTasksForProject(category.key, project)} childrenOf={childrenOf} taskMap={taskMap} collapsed={collapsed} setCollapsed={setCollapsed} addTask={addTask} upsertTask={upsertTask} removeTask={removeTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} handleDropOnProject={handleDropOnProject} handleDropOnTask={handleDropOnTask} moveProject={moveProject} categoryTone={categoryTone} projectRules={projectRules} selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />)}
        </div>
      )}
    </div>
  );
}

function ProjectGroup({ category, project, roots, childrenOf, taskMap, collapsed, setCollapsed, addTask, upsertTask, removeTask, toggleDone, toggleWeek, toggleToday, selectedTaskId, setSelectedTaskId, setSelectedProject, handleDropOnProject, handleDropOnTask, moveProject, categoryTone, projectRules, selectMode, selectedIds, onToggleSelect }) {
  const [newTitle, setNewTitle] = useState("");
  const key = `${category}:${project}`;
  const isCollapsed = collapsed[key];
  const tone = categoryTone(category);
  const rule = projectRules?.[projectKey(category, project)];

  const { setNodeRef: projDropRef, isOver } = useDroppable({ id: `proj-drop-${category}-${project}`, data: { type: "project", category, project } });
  const { attributes: projDragAttrs, listeners: projDragListeners, setNodeRef: projDragRef, isDragging: isProjDragging } = useDraggable({ id: `proj-drag-${category}-${project}`, data: { type: "project", category, project } });

  function create() {
    const task = addTask({ title: newTitle || "新規タスク", category, project });
    if (task) setNewTitle("");
  }

  return (
    <div
      ref={(node) => { projDropRef(node); projDragRef(node); }}
      {...projDragAttrs}
      className={classNames(
        "rounded-md border px-1.5 py-1 transition",
        isOver ? "border-white/25 bg-white/[0.06]" : "border-white/5 bg-black/10",
        isProjDragging && "opacity-40"
      )}
    >
      <div className="mb-1 flex w-full items-center justify-between gap-1 text-left">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span
            {...projDragListeners}
            className="cursor-grab touch-none text-neutral-700 hover:text-neutral-400 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <button
            onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
            className="shrink-0"
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-neutral-500" /> : <ChevronDown className="h-3.5 w-3.5 text-neutral-500" />}
          </button>
          <span
            onClick={(event) => {
              event.stopPropagation();
              setSelectedTaskId(null);
              setSelectedProject({ category, project });
            }}
            className={classNames("truncate text-xs font-semibold underline-offset-2 hover:underline cursor-pointer", !rule?.color && tone.accent)}
            style={rule?.color ? { color: rule.color } : undefined}
            title={rule?.description || "Project settings"}
          >
            {rule?.emoji ? `${rule.emoji} ` : ""}{rule?.recurrence && rule.recurrence !== "none" ? "↺ " : ""}{project}
          </span>
        </div>
        <span className="text-xs text-neutral-500">{isOver ? "並列化" : roots.length}</span>
      </div>
      {!isCollapsed && (
        <div className="flex flex-col gap-0.5">
          <AnimatePresence initial={false}>{roots.map((task) => <TaskCard key={task.id} task={task} taskMap={taskMap} children={childrenOf(task.id)} childrenOf={childrenOf} categoryTone={categoryTone} depth={0} collapsed={collapsed} setCollapsed={setCollapsed} upsertTask={upsertTask} removeTask={removeTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} handleDropOnTask={handleDropOnTask} selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />)}</AnimatePresence>
          <div className="mt-1 flex gap-1">
            <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && create()} placeholder="このProjectに追加" className="min-w-0 flex-1 rounded border border-white/5 bg-white/[0.025] px-2 py-1 text-xs outline-none placeholder:text-neutral-700 focus:border-white/20" />
            <button onClick={create} className="rounded border border-white/5 px-1.5 py-1 text-neutral-500 transition hover:bg-white/10 hover:text-neutral-200"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// Long-press context menu component
function LongPressMenu({ x, y, task, upsertTask, projectsByCategory, categories, onClose }) {
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  useEffect(() => {
    function handleClick() { onClose(); }
    window.addEventListener("pointerdown", handleClick, { capture: true });
    return () => window.removeEventListener("pointerdown", handleClick, { capture: true });
  }, [onClose]);

  return (
    <div
      className="fixed z-[200] min-w-[180px] rounded-xl border border-white/15 bg-neutral-900/97 p-1.5 shadow-2xl backdrop-blur"
      style={{ left: Math.min(x, window.innerWidth - 196), top: Math.min(y, window.innerHeight - 300) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {(() => {
        const tKey = toDateKey(new Date());
        const wk = weekDateKeys(new Date());
        const taskIsToday = schedIsToday(task, tKey);
        const taskIsWeek = schedIsThisWeek(task, wk);
        return (
          <>
            {!taskIsToday && (
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10"
                onClick={() => { upsertTask({ id: task.id, scheduledDate: tKey, today: false, thisWeek: false }); onClose(); }}
              >Move to Today</button>
            )}
            {taskIsToday && (
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-neutral-400 hover:bg-white/10"
                onClick={() => { upsertTask({ id: task.id, scheduledDate: "", today: false, thisWeek: false }); onClose(); }}
              >Remove from Today</button>
            )}
            {!taskIsWeek && (
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10"
                onClick={() => { upsertTask({ id: task.id, thisWeek: true, today: false, scheduledDate: "" }); onClose(); }}
              >Move to Weekly</button>
            )}
            {taskIsWeek && (
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-neutral-400 hover:bg-white/10"
                onClick={() => { upsertTask({ id: task.id, thisWeek: false, today: false, scheduledDate: "" }); onClose(); }}
              >Remove from Weekly</button>
            )}
          </>
        );
      })()}
      <button
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10"
        onClick={() => setShowProjectPicker((v) => !v)}
      >Move to Project…</button>
      {showProjectPicker && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-1">
          {categories.map((cat) =>
            (projectsByCategory[cat.key] || []).map((proj) => (
              <button
                key={`${cat.key}::${proj}`}
                className="flex w-full flex-col rounded px-2 py-1.5 text-left text-[11px] hover:bg-white/10"
                onClick={() => { upsertTask({ id: task.id, category: cat.key, project: proj, parentId: null }); onClose(); }}
              >
                <span className="text-neutral-400">{cat.key}</span>
                <span className="text-neutral-200">{proj}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function TaskCard({ task, taskMap, categoryTone, children = [], childrenOf, depth, collapsed, setCollapsed, upsertTask, removeTask, toggleDone, toggleWeek, toggleToday, selectedTaskId, setSelectedTaskId, handleDropOnTask, moveWeeklyTask, compact = false, projectsByCategory, categories, selectMode = false, selectedIds, onToggleSelect }) {
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed[task.id];
  const selected = selectedTaskId === task.id;
  const [editing, setEditing] = useState(false);
  const parent = task.parentId && taskMap ? taskMap.get(task.parentId) : null;
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const longPressTimer = useRef(null);
  const longPressActive = useRef(false);

  useEffect(() => {
    setTitleDraft(task.title);
  }, [task.id, task.title]);

  function commitTitle() {
    const clean = normalizeTitle(titleDraft);
    if (!clean) {
      setTitleDraft(task.title);
      return;
    }
    if (clean !== task.title) upsertTask({ id: task.id, title: clean });
  }

  function cancelTitle() {
    setTitleDraft(task.title);
  }

  function handlePointerDown(e) {
    if (e.pointerType !== "touch") return;
    const x = e.clientX;
    const y = e.clientY;
    longPressActive.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressActive.current = true;
      setContextMenu({ x, y });
    }, 600);
    // dnd-kit の dragStart からキャンセルできるよう登録
    window.__taskspaceLongPressCancel = () => {
      clearTimeout(longPressTimer.current);
      longPressActive.current = false;
    };
  }

  function handlePointerUp() {
    clearTimeout(longPressTimer.current);
    window.__taskspaceLongPressCancel = null;
  }

  function handlePointerMove(e) {
    // 指が少し動いたらlong-pressキャンセル（ドラッグ優先）
    clearTimeout(longPressTimer.current);
    window.__taskspaceLongPressCancel = null;
  }

  const isSelected = selectMode && selectedIds && selectedIds.has(task.id);

  // dnd-kit hooks
  const { attributes: taskDragAttrs, listeners: taskDragListeners, setNodeRef: taskDragRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { type: "task", id: task.id, category: task.category, project: task.project, parentId: task.parentId },
    disabled: selectMode,
  });

  // Drop target type: compact cards in Today/Weekly get special types for routing.
  // scheduledDate ベースで判定（今日に配置=task-in-today、それ以外のWeekly=task-in-weekly）
  const dropType = compact
    ? (schedIsToday(task, toDateKey(new Date())) ? "task-in-today" : "task-in-weekly")
    : "task";
  const { setNodeRef: taskDropRef, isOver: isTaskOver } = useDroppable({
    id: `task-drop-${task.id}`,
    data: { type: dropType, id: task.id, category: task.category, project: task.project },
  });

  function setRefs(el) {
    taskDragRef(el);
    taskDropRef(el);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} className="flex flex-col gap-0.5" style={{ marginLeft: depth ? Math.min(depth * 14, 32) : 0 }}>
      {contextMenu && projectsByCategory && categories && (
        <LongPressMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={task}
          upsertTask={upsertTask}
          projectsByCategory={projectsByCategory}
          categories={categories}
          onClose={() => setContextMenu(null)}
        />
      )}
      <div
        ref={setRefs}
        {...(!selectMode ? taskDragListeners : {})}
        {...(!selectMode ? taskDragAttrs : {})}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onContextMenu={e => e.preventDefault()}
        onClick={() => { if (longPressActive.current) return; if (selectMode && onToggleSelect) { onToggleSelect(task.id); } }}
        data-draggable
        style={{ userSelect: "none", WebkitUserSelect: "none" }}
        className={classNames(
          "group rounded-md border px-1.5 py-1 transition",
          isSelected ? "border-sky-400/40 bg-sky-500/[0.08]" : selected ? "border-white/35 bg-white/[0.07]" : isTaskOver ? "border-white/25 bg-white/[0.06]" : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.045]",
          task.status === "完了" && "mt-1 border-t border-t-white/25 pt-2 opacity-45",
          isDragging && "opacity-40"
        )}
      >
        <div className="flex items-start gap-1.5">
          {selectMode && (
            <button
              onClick={(e) => { e.stopPropagation(); if (onToggleSelect) onToggleSelect(task.id); }}
              className="mt-0.5 shrink-0 text-neutral-500 transition hover:text-sky-300"
            >
              {isSelected ? <CheckSquare className="h-3.5 w-3.5 text-sky-400" /> : <CheckSquare className="h-3.5 w-3.5 opacity-30" />}
            </button>
          )}
          <button onClick={(event) => { event.stopPropagation(); toggleDone(task); }} className="mt-0.5 shrink-0 text-neutral-500 transition hover:text-emerald-300">{task.status === "完了" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}</button>
          {hasChildren ? <button onClick={(event) => { event.stopPropagation(); setCollapsed((prev) => ({ ...prev, [task.id]: !prev[task.id] })); }} className="mt-0.5 shrink-0 text-neutral-500">{isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button> : <span className="w-3.5 shrink-0" />}
          <div className="min-w-0 flex-1">
            {editing ? (
              <textarea
                value={titleDraft}
                autoFocus
                rows={1}
                ref={autoResize}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => { setTitleDraft(event.target.value); autoResize(event.target); }}
                onBlur={() => { commitTitle(); setEditing(false); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    commitTitle();
                    setEditing(false);
                    event.currentTarget.blur();
                  }
                  if ((event.key === "Backspace" || event.key === "Delete") && event.currentTarget.value.length === 0) {
                    event.preventDefault();
                    removeTask(task.id);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelTitle();
                    setEditing(false);
                    event.currentTarget.blur();
                  }
                  if (event.key === "Tab") {
                    event.preventDefault();
                    event.stopPropagation();
                    const titleClean = normalizeTitle(titleDraft);
                    const titlePatch = titleClean && titleClean !== task.title ? { title: titleClean } : {};
                    if (event.shiftKey) {
                      if (task.parentId) {
                        const parent = taskMap.get(task.parentId);
                        upsertTask({ id: task.id, ...titlePatch, parentId: parent?.parentId ?? null });
                      } else {
                        if (Object.keys(titlePatch).length) upsertTask({ id: task.id, ...titlePatch });
                      }
                    } else {
                      if (depth < 3) {
                        const siblings = [...taskMap.values()]
                          .filter((t) => !t.archived && t.parentId === (task.parentId ?? null) && t.category === task.category && t.project === task.project)
                          .sort((a, b) => {
                            const ao = typeof a.sortOrder === "number" ? a.sortOrder : 999999;
                            const bo = typeof b.sortOrder === "number" ? b.sortOrder : 999999;
                            if (ao !== bo) return ao - bo;
                            return a.title.localeCompare(b.title, "ja");
                          });
                        const idx = siblings.findIndex((t) => t.id === task.id);
                        const prevSibling = siblings[idx - 1];
                        if (prevSibling) upsertTask({ id: task.id, ...titlePatch, parentId: prevSibling.id });
                        else if (Object.keys(titlePatch).length) upsertTask({ id: task.id, ...titlePatch });
                      } else {
                        if (Object.keys(titlePatch).length) upsertTask({ id: task.id, ...titlePatch });
                      }
                    }
                    setEditing(false);
                  }
                }}
                className={classNames(
                  "w-full resize-none overflow-hidden rounded border border-white/15 bg-black/30 px-1 py-0.5 text-[12.5px] font-medium leading-[1.35] outline-none focus:border-white/35",
                  task.status === "完了" && "line-through"
                )}
              />
            ) : (
              <div className="flex items-start gap-1 group/title">
                <div
                  onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                  className={classNames("flex-1 break-words cursor-text text-[12.5px] font-medium leading-[1.35]", task.status === "完了" && "line-through")}
                >
                  {task.title}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }}
                  title="詳細を開く"
                  className="shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-100 transition text-neutral-500 hover:text-neutral-300"
                >
                  <Info className="h-3 w-3" />
                </button>
              </div>
            )}
            {compact && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] text-neutral-500">
                {task.category || task.project ? (
                  <>
                    <span>{task.category || NO_CATEGORY_LABEL}</span>
                    {task.project && <><span>/</span><span>{task.project}</span></>}
                  </>
                ) : (
                  <span>{NO_CATEGORY_LABEL}</span>
                )}
                {task.dueDate && <span>・{task.dueDate}</span>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {task.memo?.trim() && <FileText className="h-3 w-3 text-neutral-500" title="メモあり" />}
          </div>
        </div>
      </div>
      {hasChildren && !isCollapsed && (
        <div className={classNames("flex flex-col gap-0.5", compact && "ml-2 border-l border-amber-200/10 pl-2")}>
          {children.map((child) => (
            <TaskCard
              key={child.id}
              task={child}
              taskMap={taskMap}
              children={childrenOf ? childrenOf(child.id) : []}
              childrenOf={childrenOf}
              categoryTone={categoryTone}
              depth={depth + 1}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              upsertTask={upsertTask}
              removeTask={removeTask}
              toggleDone={toggleDone}
              toggleWeek={toggleWeek} toggleToday={toggleToday}
              selectedTaskId={selectedTaskId}
              setSelectedTaskId={setSelectedTaskId}
              handleDropOnTask={handleDropOnTask}
              compact={compact}
              moveWeeklyTask={moveWeeklyTask}
              projectsByCategory={projectsByCategory}
              categories={categories}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function ArchiveSection({ tasks, upsertTask, removeTask, categoryTone }) {
  const [open, setOpen] = useState(false);
  const archivedTasks = tasks.filter((t) => t.archived);

  function unarchive(id) {
    upsertTask(id, { archived: false, status: "未着手" });
  }

  return (
    <div className="mt-2 rounded-lg border border-violet-400/15 bg-violet-500/[0.03] p-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-violet-200/10 pb-1.5 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
        <span className="text-sm font-semibold text-violet-200">Archive</span>
        <span className="rounded-full border border-violet-200/15 px-1.5 py-0.5 text-[10px] text-violet-100/45">{archivedTasks.length}</span>
        <span className="ml-auto text-[10px] text-violet-100/30">完了タスクの保管庫</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-0.5">
          {archivedTasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-violet-200/15 p-4 text-center text-xs text-violet-100/40">アーカイブは空です</div>
          ) : (
            archivedTasks.map((task) => {
              const tone = categoryTone(task.category);
              return (
                <div key={task.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-neutral-400 hover:bg-white/[0.03]">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/50" />
                  <span className="min-w-0 flex-1 truncate line-through opacity-50">{task.title}</span>
                  {task.category && (
                    <span className={classNames("shrink-0 rounded border px-1.5 py-0.5 text-[10px]", tone.tag)}>{task.category}</span>
                  )}
                  {task.project && <span className="shrink-0 text-[10px] text-neutral-600">{task.project}</span>}
                  <button
                    onClick={() => unarchive(task.id)}
                    className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-white/[0.07] hover:text-neutral-300"
                  >
                    戻す
                  </button>
                  <button
                    onClick={() => removeTask(task.id)}
                    className="shrink-0 text-neutral-700 hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const DAY_LABELS = ["🌙月", "🔥火", "🌊水", "🌳木", "🪙金", "🪐土", "☀️日"];

function SevenDayView({ tasks, projectRules, taskMap, childrenOf, upsertTask, removeTask, addTask, toggleDone, categoryTone, setSelectedTaskId, selectedTaskId }) {
  const todayKey = toDateKey(new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [newTitles, setNewTitles] = useState({});

  const weekDays = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    return getWeekDays(base);
  }, [weekOffset]);

  function tasksForDay(dateKey, date) {
    return rootTasksForDay({ tasks, projectRules, dateKey, date, todayKey });
  }

  function handleAdd(dateKey) {
    const title = (newTitles[dateKey] || "").trim();
    if (!title) return;
    // addTask は App 側の commitTasks を内包しているので、scheduledDate を含むタスクを渡す
    addTask({ title, category: "", project: "", scheduledDate: dateKey, plain: true, today: false, thisWeek: false });
    setNewTitles((prev) => ({ ...prev, [dateKey]: "" }));
  }

  const [forceHorizontal, setForceHorizontal] = useState(false);

  const firstDay = weekDays[0];
  const lastDay = weekDays[6];
  const monthLabel = `${firstDay.getMonth() + 1}/${firstDay.getDate()} - ${lastDay.getMonth() + 1}/${lastDay.getDate()}`;

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.025] p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset((v) => v - 1)}
            className="rounded border border-white/10 p-1.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-neutral-300 min-w-[120px] text-center">{monthLabel}</span>
          <button
            onClick={() => setWeekOffset((v) => v + 1)}
            className="rounded border border-white/10 p-1.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              今週に戻す
            </button>
          )}
          <button
            onClick={() => setForceHorizontal((v) => !v)}
            title="7日横並び表示"
            className={classNames(
              "rounded border px-2 py-1 text-[11px] font-medium transition",
              forceHorizontal
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                : "border-white/10 text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
            )}
          >
            6days
          </button>
        </div>
      </div>

      <div className="pb-2">
        {forceHorizontal ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[480px] gap-1" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
              {[0, 1, 2, 3, 4].map((i) => {
                const date = weekDays[i];
                const dateKey = toDateKey(date);
                return (
                  <DayColumn
                    key={dateKey}
                    dateKey={dateKey}
                    label={DAY_LABELS[i]}
                    date={date}
                    isToday={dateKey === todayKey}
                    isSat={false}
                    isSun={false}
                    stacked
                    tasks={tasksForDay(dateKey, date)}
                    childrenOf={childrenOf}
                    newTitle={newTitles[dateKey] || ""}
                    setNewTitle={(v) => setNewTitles((prev) => ({ ...prev, [dateKey]: v }))}
                    onAdd={() => handleAdd(dateKey)}
                    toggleDone={toggleDone}
                    upsertTask={upsertTask}
                    removeTask={removeTask}
                    categoryTone={categoryTone}
                    setSelectedTaskId={setSelectedTaskId}
                    selectedTaskId={selectedTaskId}
                    projectRules={projectRules}
                  />
                );
              })}
              <div className="flex flex-col gap-1">
                {[5, 6].map((i) => {
                  const date = weekDays[i];
                  const dateKey = toDateKey(date);
                  return (
                    <DayColumn
                      key={dateKey}
                      dateKey={dateKey}
                      label={DAY_LABELS[i]}
                      date={date}
                      isToday={dateKey === todayKey}
                      isSat={i === 5}
                      isSun={i === 6}
                      stacked
                      tasks={tasksForDay(dateKey, date)}
                      childrenOf={childrenOf}
                      newTitle={newTitles[dateKey] || ""}
                      setNewTitle={(v) => setNewTitles((prev) => ({ ...prev, [dateKey]: v }))}
                      onAdd={() => handleAdd(dateKey)}
                      toggleDone={toggleDone}
                      upsertTask={upsertTask}
                      removeTask={removeTask}
                      categoryTone={categoryTone}
                      setSelectedTaskId={setSelectedTaskId}
                      selectedTaskId={selectedTaskId}
                      projectRules={projectRules}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {(() => {
            const renderDay = (i, stacked = false) => {
              const date = weekDays[i];
              const dateKey = toDateKey(date);
              return (
                <DayColumn
                  key={dateKey}
                  dateKey={dateKey}
                  label={DAY_LABELS[i]}
                  date={date}
                  isToday={dateKey === todayKey}
                  isSat={i === 5}
                  isSun={i === 6}
                  stacked={stacked}
                  tasks={tasksForDay(dateKey, date)}
                  childrenOf={childrenOf}
                  newTitle={newTitles[dateKey] || ""}
                  setNewTitle={(v) => setNewTitles((prev) => ({ ...prev, [dateKey]: v }))}
                  onAdd={() => handleAdd(dateKey)}
                  toggleDone={toggleDone}
                  upsertTask={upsertTask}
                  removeTask={removeTask}
                  categoryTone={categoryTone}
                  setSelectedTaskId={setSelectedTaskId}
                  selectedTaskId={selectedTaskId}
                  projectRules={projectRules}
                />
              );
            };
            return (
              <>
                {[0, 1, 2, 3, 4].map((i) => renderDay(i))}
                {/* 土日は1列にまとめて縦積み（土が上・日が下）。広い幅では1列に収める */}
                <div className="flex flex-col gap-2">
                  {renderDay(5, true)}
                  {renderDay(6, true)}
                </div>
              </>
            );
          })()}
        </div>
        )}
      </div>
    </section>
  );
}

function TrayTask({ task, depth = 0, toggleDone, upsertTask, removeTask, setSelectedTaskId, selectedTaskId, onIndent, onOutdent, childrenOf, selectMode = false, selectedIds, onToggleSelect }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const isDone = task.status === "完了";
  const isSelected = selectMode && selectedIds && selectedIds.has(task.id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `traytask-${task.id}`,
    data: { type: "task", id: task.id },
    disabled: editing || selectMode,
  });

  useEffect(() => { setDraft(task.title); }, [task.title]);

  const children = childrenOf?.(task.id) || [];

  return (
    <div style={depth > 0 ? { marginLeft: depth * 12 } : undefined}>
      <div
        ref={setNodeRef}
        {...(!editing && !selectMode ? attributes : {})}
        {...(!editing && !selectMode ? listeners : {})}
        onClick={() => { if (selectMode && onToggleSelect) onToggleSelect(task.id); }}
        className={classNames(
          "flex items-start gap-1 rounded px-1.5 py-1 text-[12.5px] transition",
          selectMode ? "cursor-pointer" : editing ? "cursor-text" : "cursor-grab",
          isSelected ? "bg-sky-500/[0.12] ring-1 ring-inset ring-sky-400/30" : selectedTaskId === task.id && "bg-white/[0.09]",
          editing && "bg-white/[0.07]",
          isDragging && "opacity-30",
        )}
      >
        {selectMode ? (
          <button onClick={(e) => { e.stopPropagation(); onToggleSelect?.(task.id); }} className="mt-0.5 shrink-0 text-neutral-500 transition hover:text-sky-300">
            <CheckSquare className={classNames("h-3 w-3", isSelected && "text-sky-400")} />
          </button>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); toggleDone(task); }} className={classNames("mt-0.5 shrink-0 transition", isDone ? "text-emerald-400" : "text-neutral-600 hover:text-neutral-300")}>{isDone ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}</button>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              autoFocus
              rows={1}
              ref={autoResize}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); autoResize(e.target); }}
              onBlur={() => { if (draft.trim() && draft !== task.title) upsertTask({ id: task.id, title: draft.trim() }); setEditing(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!draft.trim()) { removeTask(task.id); } else { if (draft.trim() !== task.title) upsertTask({ id: task.id, title: draft.trim() }); setEditing(false); } }
                if (e.key === "Escape") { e.preventDefault(); setDraft(task.title); setEditing(false); }
                if ((e.key === "Backspace" || e.key === "Delete") && !draft) { e.preventDefault(); removeTask(task.id); }
                if (e.key === "Tab") {
                  e.preventDefault();
                  const isShift = e.shiftKey;
                  const clean = draft.trim();
                  if (clean && clean !== task.title) upsertTask({ id: task.id, title: clean });
                  setEditing(false);
                  setTimeout(() => { if (isShift) onOutdent?.(); else onIndent?.(); }, 0);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full resize-none overflow-hidden rounded border-b border-white/25 bg-transparent text-[12.5px] font-medium text-neutral-100 outline-none"
            />
          ) : (
            <div className="flex items-start gap-1 group/title">
              <div onClick={(e) => { e.stopPropagation(); setEditing(true); }} className={classNames("flex-1 break-words cursor-text text-[12.5px] text-neutral-100", isDone && "line-through opacity-40")}>{task.title}</div>
              <button onClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }} className="shrink-0 opacity-0 group-hover/title:opacity-100 transition text-neutral-500 hover:text-neutral-300"><Info className="h-3 w-3" /></button>
            </div>
          )}
        </div>
      </div>
      {children.map((child, idx) => (
        <TrayTask
          key={child.id}
          task={child}
          depth={depth + 1}
          toggleDone={toggleDone}
          upsertTask={upsertTask}
          removeTask={removeTask}
          setSelectedTaskId={setSelectedTaskId}
          selectedTaskId={selectedTaskId}
          childrenOf={childrenOf}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onIndent={() => {
            if (idx === 0) return;
            const prevSibling = children[idx - 1];
            upsertTask({ id: child.id, parentId: prevSibling.id });
          }}
          onOutdent={() => {
            upsertTask({ id: child.id, parentId: task.parentId || null });
          }}
        />
      ))}
    </div>
  );
}

function DayTask({ task, depth = 0, hideProject = false, childrenOf, categoryTone, toggleDone, upsertTask, removeTask, setSelectedTaskId, selectedTaskId, onIndent, onOutdent, dayDateKey }) {
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({
    id: `daytask-${task.id}`,
    data: { type: "task", id: task.id },
  });
  // 別タスクをこのタスクに重ねると親子化する（プロジェクトにも反映）
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `daytask-drop-${task.id}`,
    data: { type: "task-in-day", id: task.id },
  });
  const setNodeRef = (el) => { dragRef(el); dropRef(el); };
  const tone = categoryTone(task.category);
  const isDone = task.status === "完了";
  const children = childrenOf?.(task.id) || [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  useEffect(() => { setDraft(task.title); }, [task.title]);
  function commitTitle() {
    const clean = (draft || "").trim();
    if (clean && clean !== task.title) upsertTask?.({ id: task.id, title: clean });
    else setDraft(task.title);
    setEditing(false);
  }
  return (
    <div style={depth > 0 ? { marginLeft: depth * 12 } : undefined}>
      <div
        ref={setNodeRef}
        {...(!editing ? attributes : {})}
        {...(!editing ? listeners : {})}
        className={classNames(
          "flex items-start gap-1 rounded px-1.5 py-1 text-[11px] transition hover:bg-white/[0.07]",
          editing ? "cursor-text" : "cursor-grab",
          selectedTaskId === task.id && "bg-white/[0.09]",
          isOver && "ring-1 ring-inset ring-cyan-300/40 bg-cyan-300/[0.06]",
          isDragging && "opacity-30",
        )}
      >
        <button
          onClick={(e) => { e.stopPropagation(); toggleDone(task); }}
          className={classNames("mt-0.5 shrink-0 transition", isDone ? "text-emerald-400" : "text-neutral-600 hover:text-neutral-300")}
        >
          {isDone ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              autoFocus
              value={draft}
              rows={1}
              ref={autoResize}
              onChange={(e) => { setDraft(e.target.value); autoResize(e.target); }}
              onBlur={(e) => {
                // Tab キーによる blur は onKeyDown で処理するのでスキップ
                if (e.relatedTarget === null && e.nativeEvent?.relatedTarget === null) {
                  commitTitle();
                } else {
                  commitTitle();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitTitle(); }
                if (e.key === "Escape") { e.preventDefault(); setDraft(task.title); setEditing(false); }
                if ((e.key === "Backspace" || e.key === "Delete") && !draft) { e.preventDefault(); removeTask?.(task.id); }
                if (e.key === "Tab") {
                  e.preventDefault();
                  e.stopPropagation();
                  const isShift = e.shiftKey; // shiftKey をローカル変数にキャプチャ
                  const clean = (draft || "").trim();
                  if (clean && clean !== task.title) upsertTask?.({ id: task.id, title: clean });
                  setEditing(false);
                  // setTimeout で re-render 後に実行
                  setTimeout(() => {
                    if (isShift) { onOutdent?.(); }
                    else { onIndent?.(); }
                  }, 0);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full resize-none overflow-hidden rounded border-b border-white/25 bg-transparent text-[12.5px] font-medium leading-[1.35] text-neutral-100 outline-none"
            />
          ) : (
            <div className="flex items-start gap-1 group/title">
              <div
                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                title="クリックで名前を編集"
                className={classNames("flex-1 break-words text-[12.5px] font-medium leading-[1.35] text-neutral-100 cursor-text", isDone && "line-through opacity-40")}
              >
                {task.title}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }}
                title="詳細を開く"
                className="shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-100 transition text-neutral-500 hover:text-neutral-300"
              >
                <Info className="h-3 w-3" />
              </button>
            </div>
          )}
          {task.project && depth === 0 && !hideProject && (
            <div className={classNames("mt-0.5 truncate text-[9px]", task.category ? tone.accent : "text-neutral-500")}>{task.project}</div>
          )}
        </div>
      </div>
      {children.map((child) => (
        <DayTask
          key={child.id}
          task={child}
          depth={depth + 1}
          childrenOf={childrenOf}
          categoryTone={categoryTone}
          toggleDone={toggleDone}
          upsertTask={upsertTask}
          removeTask={removeTask}
          setSelectedTaskId={setSelectedTaskId}
          selectedTaskId={selectedTaskId}
          dayDateKey={dayDateKey}
          onIndent={() => {
            const idx = children.findIndex((t) => t.id === child.id);
            if (idx <= 0) return;
            const prevSibling = children[idx - 1];
            upsertTask({ id: child.id, parentId: prevSibling.id });
          }}
          onOutdent={() => {
            upsertTask({ id: child.id, parentId: task.parentId || null, scheduledDate: dayDateKey || dateKey });
          }}
        />
      ))}
    </div>
  );
}

function DayColumn({ dateKey, label, date, isToday, isSat, isSun, stacked = false, tasks, childrenOf, newTitle, setNewTitle, onAdd, toggleDone, upsertTask, removeTask, categoryTone, setSelectedTaskId, selectedTaskId, projectRules }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-col-${dateKey}`, data: { type: "day-column", date: dateKey, label } });
  const [collapsedProj, setCollapsedProj] = useState({});

  // プロジェクト所属タスクはプロジェクトごとにまとめ、それ以外(plain)はフラット表示
  const pgMap = new Map();
  const plainTasks = [];
  for (const t of tasks) {
    if (t.category && t.project) {
      const key = `${t.category}::${t.project}`;
      if (!pgMap.has(key)) {
        pgMap.set(key, { key, category: t.category, project: t.project, items: [] });
      }
      pgMap.get(key).items.push(t);
    } else {
      plainTasks.push(t);
    }
  }
  // 並び順: 時刻未設定プロジェクト → 時刻設定プロジェクト（時刻昇順）
  const projectGroups = [...pgMap.values()].sort((a, b) => {
    const ta = projectRules?.[a.key]?.recurrenceTime || "";
    const tb = projectRules?.[b.key]?.recurrenceTime || "";
    // 未設定("")は先頭、設定ありは後ろに（時刻昇順）
    if (!ta && !tb) return 0;
    if (!ta) return -1;
    if (!tb) return 1;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  // Tab/Shift+Tab 用: 表示順のルートタスク一覧（plain → projectGroups の順）
  const flatRoots = [...plainTasks, ...projectGroups.flatMap((g) => g.items)];

  function makeIndent(taskId) {
    const idx = flatRoots.findIndex((t) => t.id === taskId);
    if (idx <= 0) return; // 先頭は親にできない
    const prev = flatRoots[idx - 1];
    upsertTask({ id: taskId, parentId: prev.id });
  }

  function makeOutdent(taskId) {
    upsertTask({ id: taskId, parentId: null, scheduledDate: dateKey });
  }

  const headColor = isToday
    ? "text-emerald-300 border-emerald-400/50"
    : isSun ? "text-rose-300 border-white/10"
    : isSat ? "text-sky-300 border-white/10"
    : "text-neutral-300 border-white/10";

  return (
    <div
      ref={setNodeRef}
      className={classNames(
        "flex flex-col rounded-md p-1 transition",
        stacked ? "min-h-[120px] md:min-h-[200px]" : "min-h-[160px] md:min-h-[420px]",
        isOver ? "bg-white/[0.06]" : "bg-transparent",
      )}
    >
      {/* 日付ヘッダー（シンプルな下線のみ） */}
      <div className={classNames("mb-1 flex items-baseline gap-1.5 border-b px-1 pb-1", headColor)}>
        <span className="text-sm font-bold">{label}</span>
        <span className="text-[10px] opacity-60">{date.getMonth() + 1}/{date.getDate()}</span>
        {isToday && <span className="ml-auto text-[9px] opacity-80">TODAY</span>}
      </div>

      {/* タスク一覧：plain が上、プロジェクトグループが下（recurrenceTime順） */}
      <div className="flex flex-col gap-1">
        {plainTasks.map((task) => (
          <DayTask key={task.id} task={task} childrenOf={childrenOf} categoryTone={categoryTone} toggleDone={toggleDone} upsertTask={upsertTask} removeTask={removeTask} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} dayDateKey={dateKey} onIndent={() => makeIndent(task.id)} onOutdent={() => makeOutdent(task.id)} />
        ))}
        {projectGroups.map((g) => {
          const tone = categoryTone(g.category);
          const isCol = collapsedProj[g.key];
          return (
            <div key={g.key} className={classNames("rounded-md border px-1 py-0.5", tone.panel)}>
              <button
                onClick={() => setCollapsedProj((p) => ({ ...p, [g.key]: !p[g.key] }))}
                className="flex w-full items-center gap-1 px-0.5 py-0.5 text-left"
              >
                {isCol ? <ChevronRight className="h-3 w-3 shrink-0 text-neutral-500" /> : <ChevronDown className="h-3 w-3 shrink-0 text-neutral-500" />}
                <span className={classNames("min-w-0 flex-1 truncate text-[10px] font-semibold", tone.accent)}>{g.project}</span>
                {g.items.some((t) => t.__ghost) && <span className="shrink-0 text-[9px] text-neutral-400">↺</span>}
                <span className="shrink-0 text-[9px] text-neutral-500">{g.items.length}</span>
              </button>
              {!isCol && (
                <div className="flex flex-col gap-0.5">
                  {g.items.map((task) => (
                    <DayTask key={task.id} task={task} hideProject childrenOf={childrenOf} categoryTone={categoryTone} toggleDone={toggleDone} upsertTask={upsertTask} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} dayDateKey={dateKey} onIndent={() => makeIndent(task.id)} onOutdent={() => makeOutdent(task.id)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 追加入力（最後のタスクのすぐ下） */}
      <div className="mt-0.5 flex gap-1">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
          placeholder="追加…"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-[10px] outline-none placeholder:text-neutral-700 focus:border-white/20 focus:bg-white/[0.025]"
        />
        <button onClick={onAdd} className="rounded border border-white/5 px-1.5 py-1 text-neutral-500 hover:bg-white/10 hover:text-neutral-200">
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function CalendarView({ month, setMonth, tasks, projectRules, categoryTone, setSelectedTaskId, setSelectedProject }) {
  const [open, setOpen] = useState(true);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const tasksByDate = useMemo(() => {
    const map = {};
    days.forEach((date) => {
      const key = toDateKey(date);
      map[key] = [];
      tasks.forEach((task) => {
        const exactDate = task.dueDate === key;
        // scheduledDate で配置された日に表示。legacy today は当日扱い
        const scheduledMatch = task.scheduledDate
          ? task.scheduledDate === key
          : (task.today && key === toDateKey(new Date()));
        const weeklyMatch = task.recurrence === "weekly" && Number(task.recurrenceDay) === date.getDay();
        const beforeEnd = !task.recurrenceEnd || key <= task.recurrenceEnd;
        if ((exactDate || scheduledMatch || (weeklyMatch && beforeEnd)) && !map[key].some((item) => item.id === task.id)) {
          map[key].push({ type: "task", ...task, calendarFromToday: scheduledMatch });
        }
      });
      Object.entries(projectRules || {}).forEach(([ruleKey, rule]) => {
        const info = projectLabelFromKey(ruleKey);
        const ruleMatch = matchesProjectRule(rule, date);
        if (ruleMatch) {
          const projectTasks = tasks
            .filter((task) => task.category === info.category && task.project === info.project)
            .sort((a, b) => {
              if (!a.parentId && b.parentId) return -1;
              if (a.parentId && !b.parentId) return 1;
              return a.title.localeCompare(b.title, "ja");
            });
          map[key].push({
            type: "project",
            id: `project-${ruleKey}-${key}`,
            category: info.category,
            project: info.project,
            title: info.project,
            tasks: projectTasks,
          });
        }
      });
    });
    return map;
  }, [tasks, projectRules, month]);
  const monthLabel = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const todayKey = toDateKey(new Date());

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.025] p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-1.5">
        <button onClick={() => setOpen((value) => !value)} className="flex items-center gap-2 text-left text-sm font-semibold text-neutral-300">
          {open ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
          <CalendarDays className="h-4 w-4" />
          Calendar
          <span className="text-[11px] text-neutral-500">{monthLabel}</span>
        </button>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded border border-white/10 px-1.5 py-1 text-neutral-400 hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => setMonth(new Date())} className="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-400 hover:bg-white/10">Today</button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded border border-white/10 px-1.5 py-1 text-neutral-400 hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      {open && (
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 text-[10px] md:text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="bg-neutral-950 px-2 py-1 text-[10px] font-medium text-neutral-500">{day}</div>)}
        {days.map((d) => {
          const key = toDateKey(d);
          const list = tasksByDate[key] || [];
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={classNames(
                "min-h-[96px] bg-neutral-950 p-1 align-top md:min-h-[140px] md:p-1.5",
                !inMonth && "opacity-35",
                isToday && "relative ring-2 ring-cyan-300/60 ring-inset bg-cyan-300/[0.055]"
              )}
            >
              <div className={classNames("mb-1 flex items-center justify-between gap-1 text-[10px]", isToday ? "text-cyan-100" : "text-neutral-500")}>
                <span className={classNames(isToday && "rounded-full bg-cyan-300/20 px-1.5 py-0.5 font-semibold text-cyan-100")}>{d.getDate()}</span>
                {isToday && <span className="rounded-full border border-cyan-200/25 px-1.5 py-0.5 text-[9px] font-medium text-cyan-100">Today</span>}
              </div>
              <div className="flex flex-col gap-1">
                {list.map((item) => (
                  item.type === "project" ? (
                    <div key={item.id} className={classNames("rounded border p-1 text-[10px]", categoryTone(item.category).tag)}>
                      <button
                        onClick={() => {
                          setSelectedTaskId(null);
                          setSelectedProject({ category: item.category, project: item.project });
                        }}
                        className="block w-full whitespace-normal break-words text-left font-semibold leading-snug"
                      >
                        ↺ {item.title}
                      </button>
                      <div className="mt-1 flex flex-col gap-0.5 border-l border-current/25 pl-1.5">
                        {(item.tasks || []).map((task) => (
                          <button
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                            className="whitespace-normal break-words rounded bg-black/15 px-1 py-0.5 text-left leading-snug opacity-90 hover:bg-black/25"
                          >
                            {task.parentId ? "↳ " : "・"}{task.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button
                      key={item.id}
                      onClick={() => setSelectedTaskId(item.id)}
                      className={classNames("whitespace-normal break-words rounded border px-1.5 py-0.5 text-left text-[10px] leading-snug", categoryTone(item.category || "").tag)}
                    >
                      {item.calendarFromToday ? "Today / " : item.recurrence === "weekly" ? "↺ " : ""}{item.title}
                    </button>
                  )
                ))}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

const PROJECT_COLORS = ["", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

function ProjectInspector({ selectedProject, projectRules, updateProjectRule, deleteProject, moveProject, renameProject, projectsByCategory, onClose }) {
  if (!selectedProject) return null;
  const { category, project } = selectedProject;
  const key = projectKey(category, project);
  const rule = projectRules?.[key] || { recurrence: "none", recurrenceDay: null, recurrenceEnd: "" };
  const [nameInput, setNameInput] = React.useState(project);

  // プロジェクトが切り替わったら入力欄をリセット
  React.useEffect(() => { setNameInput(project); }, [project]);

  const projects = projectsByCategory?.[category] || [];
  const idx = projects.indexOf(project);
  const canUp = idx > 0;
  const canDown = idx !== -1 && idx < projects.length - 1;

  function handleDelete() {
    if (window.confirm(`プロジェクト「${project}」を削除しますか？\n中のタスクはTRAYに戻ります。`)) {
      deleteProject(category, project);
    }
  }

  return (
    <aside className="fixed bottom-0 right-0 z-40 max-h-[78vh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 bg-neutral-950/95 p-4 shadow-2xl backdrop-blur md:top-[56px] md:max-h-[calc(100vh-56px)] md:w-[380px] md:max-w-[380px] md:rounded-none md:border-l md:border-t-0">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-neutral-500">Project</div>
          <div className="flex items-baseline gap-2">
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => renameProject(category, project, nameInput)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.target.blur(); } if (e.key === "Escape") { setNameInput(project); e.target.blur(); } }}
              className="flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none focus:border-b focus:border-white/20"
            />
            {rule?.recurrence && rule.recurrence !== "none" && <span className="shrink-0 text-sm">↺</span>}
          </div>
          <p className="mt-1 text-xs text-neutral-500">{category}</p>
        </div>
        <button onClick={onClose} className="rounded-full border border-white/10 p-2 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"><X className="h-4 w-4" /></button>
      </div>

      <div className="space-y-3">
        <PropertyRow label="Emoji">
          <input
            value={rule.emoji || ""}
            onChange={(event) => updateProjectRule(category, project, { emoji: event.target.value.slice(0, 4) })}
            placeholder="🗂"
            className="w-20 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-center text-lg outline-none"
          />
        </PropertyRow>

        <PropertyRow label="Color">
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c || "none"}
                onClick={() => updateProjectRule(category, project, { color: c })}
                title={c || "なし"}
                className={classNames(
                  "h-6 w-6 rounded-full border transition",
                  (rule.color || "") === c ? "border-white ring-2 ring-white/40" : "border-white/20 hover:border-white/50"
                )}
                style={c ? { backgroundColor: c } : undefined}
              >
                {!c && <span className="text-[10px] text-neutral-500">×</span>}
              </button>
            ))}
          </div>
        </PropertyRow>

        <PropertyRow label="Description">
          <textarea
            value={rule.description || ""}
            onChange={(event) => updateProjectRule(category, project, { description: event.target.value })}
            placeholder="このプロジェクトの説明・メモ"
            rows={3}
            className="min-w-0 w-full resize-y rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none placeholder:text-neutral-600"
          />
        </PropertyRow>

        <PropertyRow label="Repeat">
          <div className="grid min-w-0 gap-2">
            <select
              value={rule.recurrence || "none"}
              onChange={(event) => {
                const recurrence = event.target.value;
                const defaults = {
                  recurrence,
                  recurrenceDay: ["weekly", "biweekly", "monthlyNthWeekday"].includes(recurrence) ? Number(rule.recurrenceDay ?? 3) : null,
                  recurrenceStart: recurrence === "biweekly" ? (rule.recurrenceStart || toDateKey(new Date())) : (rule.recurrenceStart || ""),
                  recurrenceDate: recurrence === "monthlyDate" ? Number(rule.recurrenceDate ?? 1) : (rule.recurrenceDate ?? 1),
                  recurrenceWeek: recurrence === "monthlyNthWeekday" ? Number(rule.recurrenceWeek ?? 1) : (rule.recurrenceWeek ?? 1),
                };
                updateProjectRule(category, project, defaults);
              }}
              className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
            >
              <option value="none">なし</option>
              <option value="daily">毎日</option>
              <option value="weekdays">平日</option>
              <option value="weekly">毎週</option>
              <option value="biweekly">隔週</option>
              <option value="monthlyDate">毎月・日付指定</option>
              <option value="monthlyNthWeekday">毎月・第n曜日</option>
            </select>

            {["weekly", "biweekly", "monthlyNthWeekday"].includes(rule.recurrence) && (
              <select
                value={Number(rule.recurrenceDay ?? 3)}
                onChange={(event) => updateProjectRule(category, project, { recurrenceDay: Number(event.target.value) })}
                className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
              >
                <option value={0}>日曜</option>
                <option value={1}>月曜</option>
                <option value={2}>火曜</option>
                <option value={3}>水曜</option>
                <option value={4}>木曜</option>
                <option value={5}>金曜</option>
                <option value={6}>土曜</option>
              </select>
            )}

            {rule.recurrence === "biweekly" && (
              <input
                type="date"
                value={rule.recurrenceStart || ""}
                onChange={(event) => updateProjectRule(category, project, { recurrenceStart: event.target.value })}
                className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
                title="隔週の起点日"
              />
            )}

            {rule.recurrence === "monthlyDate" && (
              <input
                type="number"
                min="1"
                max="31"
                value={Number(rule.recurrenceDate ?? 1)}
                onChange={(event) => updateProjectRule(category, project, { recurrenceDate: Number(event.target.value) })}
                className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
                placeholder="毎月の日付"
              />
            )}

            {rule.recurrence === "monthlyNthWeekday" && (
              <select
                value={Number(rule.recurrenceWeek ?? 1)}
                onChange={(event) => updateProjectRule(category, project, { recurrenceWeek: Number(event.target.value) })}
                className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
              >
                <option value={1}>第1</option>
                <option value={2}>第2</option>
                <option value={3}>第3</option>
                <option value={4}>第4</option>
                <option value={-1}>最終</option>
              </select>
            )}

            {rule.recurrence !== "none" && (
              <>
                <input
                  type="time"
                  value={rule.recurrenceTime || ""}
                  onChange={(event) => updateProjectRule(category, project, { recurrenceTime: event.target.value })}
                  className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
                  title="表示時刻（7Daysでの並び順に使用）"
                />
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="date"
                    value={rule.recurrenceStart || ""}
                    onChange={(event) => updateProjectRule(category, project, { recurrenceStart: event.target.value })}
                    className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
                    title="開始日"
                  />
                  <input
                    type="date"
                    value={rule.recurrenceEnd || ""}
                    onChange={(event) => updateProjectRule(category, project, { recurrenceEnd: event.target.value })}
                    className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
                    title="終了日"
                  />
                </div>
              </>
            )}
          </div>
        </PropertyRow>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-5 text-neutral-400">
        Project単位のRepeatは、タスクとは別にカレンダーへ表示されます。タスク単位のRepeatもそのまま使えます。
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => canUp && moveProject(category, project, projects[idx - 1])}
          disabled={!canUp}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/[0.08] disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronUp className="h-4 w-4" /> 上へ
        </button>
        <button
          onClick={() => canDown && moveProject(category, project, projects[idx + 1])}
          disabled={!canDown}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/[0.08] disabled:opacity-25 disabled:cursor-not-allowed"
        >
          下へ <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <button
        onClick={handleDelete}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-500/20"
      >
        <Trash2 className="h-4 w-4" /> プロジェクトを削除
      </button>
    </aside>
  );
}

function TaskInspector({ task, taskMap, categories, projectsByCategory, upsertTask, removeTask, addTask, onClose }) {
  const [subTitle, setSubTitle] = useState("");
  if (!task) return null;
  const parent = task.parentId ? taskMap.get(task.parentId) : null;
  const siblingProjects = projectsByCategory[task.category] || [];
  function createSubTask() {
    const created = addTask({ title: subTitle, parentId: task.id });
    if (created) setSubTitle("");
  }
  return (
    <aside className="fixed bottom-0 right-0 z-40 max-h-[78vh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur md:top-[56px] md:max-h-[calc(100vh-56px)] md:w-[360px] md:max-w-[360px] md:rounded-none md:border-l md:border-t-0">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <textarea
            value={task.title}
            onChange={(event) => upsertTask({ id: task.id, title: event.target.value })}
            onInput={(event) => { event.target.style.height = "auto"; event.target.style.height = event.target.scrollHeight + "px"; }}
            ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
            rows={1}
            className="w-full resize-none overflow-hidden bg-transparent text-base font-semibold tracking-tight outline-none leading-snug"
          />
        </div>
        <button onClick={onClose} className="rounded-full border border-white/10 p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-2">
        <PropertyRow label="Category"><select value={task.category || ""} onChange={(event) => { const category = event.target.value; upsertTask({ id: task.id, category, project: category ? (projectsByCategory[category]?.[0] || task.project) : "", plain: !category }); }} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none"><option value="">{NO_CATEGORY_LABEL}</option>{categories.map((cat) => <option key={cat.key} value={cat.key}>{cat.key}</option>)}</select></PropertyRow>
        <PropertyRow label="Project"><select value={task.project || ""} onChange={(event) => upsertTask({ id: task.id, project: event.target.value, plain: !task.category && !event.target.value })} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none"><option value="">{task.category ? "（未選択）" : NO_CATEGORY_LABEL}</option>{siblingProjects.map((project) => <option key={project} value={project}>{project}</option>)}{task.project && !siblingProjects.includes(task.project) && <option value={task.project}>{task.project}</option>}</select></PropertyRow>
        <PropertyRow label="Status"><select value={task.status} onChange={(event) => upsertTask({ id: task.id, status: event.target.value })} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none"><option>未着手</option><option>進行中</option><option>完了</option></select></PropertyRow>
        <PropertyRow label="Due"><input type="date" value={task.dueDate || ""} onChange={(event) => upsertTask({ id: task.id, dueDate: event.target.value })} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none" /></PropertyRow>
        <PropertyRow label="Repeat">
          <div className="grid min-w-0 gap-1.5">
            <select value={task.recurrence || "none"} onChange={(event) => upsertTask({ id: task.id, recurrence: event.target.value, recurrenceDay: event.target.value === "weekly" ? Number(task.recurrenceDay ?? 3) : null })} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none">
              <option value="none">なし</option>
              <option value="weekly">毎週</option>
            </select>
            {task.recurrence === "weekly" && (
              <div className="grid min-w-0 grid-cols-2 gap-1.5">
                <select value={Number(task.recurrenceDay ?? 3)} onChange={(event) => upsertTask({ id: task.id, recurrenceDay: Number(event.target.value) })} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none">
                  <option value={0}>日曜</option>
                  <option value={1}>月曜</option>
                  <option value={2}>火曜</option>
                  <option value={3}>水曜</option>
                  <option value={4}>木曜</option>
                  <option value={5}>金曜</option>
                  <option value={6}>土曜</option>
                </select>
                <input type="date" value={task.recurrenceEnd || ""} onChange={(event) => upsertTask({ id: task.id, recurrenceEnd: event.target.value })} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none" title="繰り返し終了日" />
              </div>
            )}
          </div>
        </PropertyRow>
        {(() => {
          const tdk = toDateKey(new Date());
          const wk = weekDateKeys(new Date());
          const tIsToday = schedIsToday(task, tdk);
          const tIsWeek = schedIsThisWeek(task, wk);
          return (
            <>
              <PropertyRow label="Today"><button onClick={() => upsertTask({ id: task.id, scheduledDate: tIsToday ? "" : tdk, today: false, thisWeek: false })} className={classNames("w-full rounded-lg border px-2 py-1.5 text-left text-xs transition", tIsToday ? "border-cyan-300/30 bg-cyan-300/15 text-cyan-100" : "border-white/10 bg-black/25 text-neutral-400")}>{tIsToday ? "今日やる" : "今日ではない"}</button></PropertyRow>
              <PropertyRow label="This Week"><button onClick={() => upsertTask({ id: task.id, thisWeek: !tIsWeek, today: false, scheduledDate: "" })} className={classNames("w-full rounded-lg border px-2 py-1.5 text-left text-xs transition", tIsWeek ? "border-amber-300/30 bg-amber-300/15 text-amber-100" : "border-white/10 bg-black/25 text-neutral-400")}>{tIsWeek ? "今週やる" : "今週ではない"}</button></PropertyRow>
            </>
          );
        })()}
        <PropertyRow label="Parent"><div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-neutral-300">{parent ? parent.title : "親なし"}</div></PropertyRow>
        <PropertyRow label="Memo"><textarea value={task.memo || ""} onChange={(event) => upsertTask({ id: task.id, memo: event.target.value })} placeholder="メモ" rows={6} className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs leading-5 outline-none placeholder:text-neutral-600" /></PropertyRow>
      </div>
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="mb-2 text-xs font-medium text-neutral-400">子タスクを追加</div>
        <div className="flex gap-1.5">
          <input value={subTitle} onChange={(event) => setSubTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createSubTask()} placeholder="子タスク名" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none placeholder:text-neutral-600" />
          <button onClick={createSubTask} className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-neutral-950">追加</button>
        </div>
      </div>
      <button onClick={() => removeTask(task.id)} className="mt-3 w-full rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100 transition hover:bg-red-400/15">Delete Task</button>
    </aside>
  );
}

function PropertyRow({ label, children }) {
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-1 sm:grid-cols-[76px_minmax(0,1fr)] sm:gap-2">
      <div className="pt-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600 sm:pt-2">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default App;
