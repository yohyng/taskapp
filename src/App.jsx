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
import { supabase, isSupabaseEnabled } from "./lib/supabase";
import { toDateKey, getWeekDays, weekDateKeys, isToday as schedIsToday, isThisWeek as schedIsThisWeek, isThisWeekUnscheduled, rootTasksForDay, ruleMatchesWeekday } from "./lib/scheduling";
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
  Pin,
  Pencil,
  Focus,
  Airplay,
  LayoutGrid,
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

// STOCK ビュー: 日付を決めずに寝かせるタスクの置き場。任意に増やせて色を変えられる。
// タスク個別の見た目
const TASK_TEXT_COLORS = [
  { key: "", label: "既定" },
  { key: "#f87171", label: "赤" },
  { key: "#fb923c", label: "橙" },
  { key: "#fbbf24", label: "黄" },
  { key: "#34d399", label: "緑" },
  { key: "#60a5fa", label: "青" },
  { key: "#a78bfa", label: "紫" },
  { key: "#f472b6", label: "桃" },
];

// ブロック種別。task 以外は「やること」ではなく、リストを構造化するための行。
// ブロック種別。Notion の基本ブロックのうち、タスク管理で意味のあるものを揃える。
//   checkbox … 完了トグルを持つ（ToDo だけ）
//   marker   … 行頭に出す記号
//   size/weight … 見出しの強さ
// 既定は task（＝ToDo）。既存データは全部これなので、見え方は変わらない。
const BLOCK_TYPES = {
  task:      { label: "ToDo", checkbox: true,  md: ["[] "] },
  text:      { label: "テキスト" },
  heading1:  { label: "見出し1", size: 17, weight: 700, md: ["# "] },
  heading2:  { label: "見出し2", size: 15, weight: 700, md: ["## "] },
  heading3:  { label: "見出し3", size: 13.5, weight: 600, md: ["### "] },
  bulleted:  { label: "箇条書きリスト", marker: "•", md: ["- ", "* "] },
  numbered:  { label: "番号付きリスト", numbered: true, md: ["1. "] },
  toggle:    { label: "トグルリスト", toggle: true, md: ["> "] },
  quote:     { label: "引用", quote: true, md: ['" '] },
  callout:   { label: "コールアウト", marker: "💡", callout: true },
  code:      { label: "コード", code: true, md: ["```"] },
  divider:   { label: "区切り線", text: false, md: ["--- "] },
};

function blockTypeOf(task) {
  return BLOCK_TYPES[task?.blockType] ? task.blockType : "task";
}
function isTaskBlockType(task) {
  return blockTypeOf(task) === "task";
}

// 行頭のマークダウン記法を種別に変換する（"# " で見出し1 など）
const MARKDOWN_PREFIXES = Object.entries(BLOCK_TYPES)
  .filter(([, cfg]) => cfg.md)
  .flatMap(([key, cfg]) => cfg.md.map((prefix) => [prefix, key]))
  .sort((a, b) => b[0].length - a[0].length); // "## " を "# " より先に見る

// 同じ並びの中で、直前まで連続している numbered ブロックの数から番号を出す。
// 別種が挟まると 1 に戻る（Notion と同じ）。CSS カウンタだと行のラッパーで
// スコープが切れて全部 1 になるため、ここで数える。
function numberedIndex(list, idx) {
  if (blockTypeOf(list[idx]) !== "numbered") return undefined;
  let n = 1;
  for (let i = idx - 1; i >= 0 && blockTypeOf(list[i]) === "numbered"; i--) n++;
  return n;
}

function matchMarkdownPrefix(value) {
  for (const [prefix, key] of MARKDOWN_PREFIXES) {
    if (value === prefix) return { key, rest: "" };
  }
  return null;
}

// スラッシュコマンド。編集中に "/" で開き、キーワードで絞って Enter で実行する。
// run は { task, ctx } を受け取り、ctx からアプリ側の操作を呼ぶ。
const SLASH_COMMANDS = [
  {
    key: "today", group: "予定", label: "今日", hint: "今日に置く", keywords: "today kyou きょう 今日",
    run: ({ task, ctx }) => ctx.upsertTask({ id: task.id, scheduledDate: toDateKey(new Date()), today: false, thisWeek: false }),
  },
  {
    key: "tomorrow", group: "予定", label: "明日", hint: "明日に置く", keywords: "tomorrow ashita あした 明日",
    run: ({ task, ctx }) => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      ctx.upsertTask({ id: task.id, scheduledDate: toDateKey(d), today: false, thisWeek: false });
    },
  },
  {
    key: "stock", group: "予定", label: "STOCK", hint: "日付を外して寝かせる", keywords: "stock すとっく あとで later",
    run: ({ task, ctx }) => ctx.upsertTask({ id: task.id, stock: true, stockViewId: ctx.defaultStockViewId, scheduledDate: "", today: false, thisWeek: false }),
  },
  {
    key: "unschedule", group: "予定", label: "日付を外す", hint: "予定なしに戻す", keywords: "clear unschedule hizuke 日付",
    run: ({ task, ctx }) => ctx.upsertTask({ id: task.id, scheduledDate: "", today: false, thisWeek: false }),
  },
  {
    key: "to-canvas", group: "予定", label: "キャンバスへ", hint: "自由配置に置く", keywords: "canvas キャンバス 配置",
    run: ({ task, ctx }) => ctx.placeOnCanvas(task),
  },
  {
    key: "off-canvas", group: "予定", label: "キャンバスから外す", hint: "自由配置をやめる", keywords: "canvas キャンバス 外す",
    run: ({ task, ctx }) => ctx.upsertTask({ id: task.id, canvasX: null, canvasY: null }),
  },
  {
    key: "done", group: "操作", label: "完了", hint: "完了にする", keywords: "done complete kanryou 完了",
    run: ({ task, ctx }) => ctx.toggleDone(task),
  },
  {
    key: "bold", group: "書式", label: "太字", hint: "太字にする", keywords: "bold futoji 太字",
    run: ({ task, ctx }) => ctx.setStyle(task, { bold: !task.style?.bold }),
  },
  ...TASK_TEXT_COLORS.filter((c) => c.key).map((c) => ({
    key: `color-${c.key}`, group: "書式", label: `色: ${c.label}`, hint: "文字色を変える", keywords: `color iro 色 ${c.label}`,
    swatch: c.key,
    run: ({ task, ctx }) => ctx.setStyle(task, { color: c.key }),
  })),
  {
    key: "color-reset", group: "書式", label: "色: 既定", hint: "文字色を戻す", keywords: "color reset iro 色 既定",
    run: ({ task, ctx }) => ctx.setStyle(task, { color: "" }),
  },
  // --- ブロックの種類（Notion の基本ブロック） ---
  ...Object.entries(BLOCK_TYPES).map(([key, cfg]) => ({
    key: `type-${key}`,
    label: cfg.label,
    hint: cfg.md ? cfg.md[0].trim() : "種類を変える",
    keywords: `${cfg.label} ${key} block type`,
    group: "種類",
    run: ({ task, ctx }) => ctx.setBlockType(task, key),
  })),
  {
    key: "delete", group: "操作", label: "削除", hint: "このブロックを消す", keywords: "delete remove sakujo 削除",
    danger: true,
    run: ({ task, ctx }) => ctx.removeTask(task.id),
  },
];

// "/" 以降の文字でコマンドを絞る
function matchSlashCommands(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q)
  );
}

const STOCK_VIEW_COLORS = [
  "#a78bfa", // violet
  "#60a5fa", // blue
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f472b6", // pink
  "#f87171", // red
  "#22d3ee", // cyan
  "#a3a3a3", // neutral
];
const DEFAULT_STOCK_VIEWS = [{ id: "stock", name: "STOCK", color: STOCK_VIEW_COLORS[0] }];
const STOCK_VIEWS_SETTING_KEY = "stock_views";

// ドキュメント型の「ページ」。タスク管理とは別に、Notion のように
// ブロックを縦に並べて書く場所。中身は同じタスク（blockType 付き）で、
// pageId でどのページに属するかを持たせる。
const PAGES_SETTING_KEY = "pages";
const DEFAULT_PAGES = [{ id: "page-1", title: "はじめてのページ", icon: "📄" }];
const PAGE_ICONS = ["📄", "📝", "📌", "💡", "🗂", "🎯", "🌱", "🔧", "📚", "✏️"];

// アプリ全体の配色。--ts-bg / --ts-text に流し込むと、面や枠は
// alpha 指定なので自動で追従する。
const APP_THEME_SETTING_KEY = "app_theme";
const DEFAULT_APP_THEME = { bg: "#0a0a0a", text: "#f5f5f5" };
const APP_THEME_PRESETS = [
  { name: "既定", bg: "#0a0a0a", text: "#f5f5f5" },
  { name: "炭", bg: "#18181b", text: "#e4e4e7" },
  { name: "紺", bg: "#0b1220", text: "#dbeafe" },
  { name: "深緑", bg: "#0a1410", text: "#d1fae5" },
  { name: "葡萄", bg: "#140f1c", text: "#ede9fe" },
  { name: "セピア", bg: "#1c1710", text: "#f5e9d7" },
  { name: "紙", bg: "#faf9f7", text: "#1c1917" },
  { name: "薄灰", bg: "#e8e8ea", text: "#18181b" },
];

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

// ページ本文は Shift+Enter の改行を残す。
// 行内の連続空白だけ詰めて、改行はそのまま。
function normalizeBlockText(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
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
  if (rule.recurrence === "monthlyDate") {
    const d = date.getDate();
    const from = Number(rule.recurrenceDate ?? 1);
    if (rule.recurrenceDateTo != null) {
      const to = Number(rule.recurrenceDateTo);
      return from <= to ? d >= from && d <= to : d >= from || d <= to;
    }
    return d === from;
  }
  if (rule.recurrence === "monthlyDateRange") {
    const d = date.getDate();
    const from = Number(rule.recurrenceDateFrom ?? 1);
    const to = Number(rule.recurrenceDateTo ?? 1);
    return from <= to ? d >= from && d <= to : d >= from || d <= to;
  }
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
    pinnedDate: "",
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
    stock: false,
    stockViewId: null,
    style: null,
    blockType: "task",
    canvasX: null,
    canvasY: null,
    pageId: null,
    ...task,
  };
}

// フォーカスモード: propsのバケツリレーを避けてContextで配る
const FocusModeContext = React.createContext({ focusPickMode: false, pickTask: null, pickTrayItem: null });
function useFocusMode() {
  return React.useContext(FocusModeContext);
}

// 選択状態。7days は SevenDayView→DayColumn→DayProjectGroup→DayTask と深いので
// props ではなく Context で配る。
const SelectionContext = React.createContext({ selectedIds: null, toggleTask: null });
function useSelection() {
  return React.useContext(SelectionContext);
}

// Notion 風のブロック入力。Enter で下に新規ブロック、その直後に編集状態へ入る。
const BlockEditContext = React.createContext({ addBlockBelow: null, markForEdit: null, pendingEditId: null, claimPendingEdit: null });
function useBlockEdit() {
  return React.useContext(BlockEditContext);
}

// コマンドの呼び出し文字。日本語入力のままでも打てるよう全角も受ける。
const SLASH_TRIGGERS = ["/", "／", "；", ";"];
function isSlashTrigger(ch) {
  return SLASH_TRIGGERS.includes(ch);
}

// コマンドの検出とメニュー操作。ブロックのエディタでも、列の「追加…」欄でも使う。
// onPick には選ばれたコマンドと、"/query" を取り除いた残りの文字列を渡す。
function useSlashQuery({ enabled = true, onPick }) {
  const [slash, setSlash] = useState(null); // { from, query, index }
  const matches = slash ? matchSlashCommands(slash.query) : [];

  // 入力のたびに開始位置と絞り込み語を追う
  function detect(value, caret) {
    if (!enabled) return;
    const at = caret ?? value.length;
    if (slash) {
      // トリガー文字が消えた、または空白が入ったら閉じる
      if (!isSlashTrigger(value[slash.from]) || at <= slash.from) { setSlash(null); return; }
      const q = value.slice(slash.from + 1, at);
      if (/\s/.test(q)) { setSlash(null); return; }
      setSlash({ ...slash, query: q, index: 0 });
      return;
    }
    if (!isSlashTrigger(value[at - 1])) return;
    // 行頭か空白の直後だけをコマンド開始とみなす
    const prev = value[at - 2];
    if (prev === undefined || /\s/.test(prev)) setSlash({ from: at - 1, query: "", index: 0 });
  }

  function pick(cmd, value) {
    const rest = (value.slice(0, slash.from) + value.slice(slash.from + 1 + slash.query.length)).trim();
    setSlash(null);
    onPick(cmd, rest);
  }

  // メニューが開いている間のキー操作。処理したら true を返す。
  function handleKeyDown(e, value) {
    if (!slash) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length) setSlash({ ...slash, index: (slash.index + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length });
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = matches[slash.index];
      if (cmd) pick(cmd, value); else setSlash(null);
      return true;
    }
    if (e.key === "Escape") { e.preventDefault(); setSlash(null); return true; }
    return false;
  }

  return { slash, setSlash, matches, detect, pick, handleKeyDown };
}

// スラッシュコマンドの実行に必要なアプリ側の操作をブロックへ配る
const SlashContext = React.createContext(null);
function useSlash() {
  return React.useContext(SlashContext);
}

// DOM 順で前後のブロックへフォーカスを移す（全ビュー共通で data-task-id を持つ）
function focusAdjacentBlock(fromEl, dir) {
  const all = Array.from(document.querySelectorAll("[data-task-id][tabindex]"));
  const i = all.indexOf(fromEl);
  if (i === -1) return null;
  const next = all[i + dir];
  next?.focus();
  return next || null;
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
  const [appTheme, setAppTheme] = useState(() => {
    try {
      const raw = localStorage.getItem("taskspace-app-theme");
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.bg && parsed?.text) return parsed;
    } catch { /* 壊れていたら既定 */ }
    return DEFAULT_APP_THEME;
  });

  // DragOverlay などルート div の外に出る要素にも効かせるため html 要素に置く
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty("--ts-bg", appTheme.bg);
    el.style.setProperty("--ts-text", appTheme.text);
    // 明るい背景では補助文字が沈むので濃度を上げる
    const lightBg = relativeLuminance(appTheme.bg) > 0.4;
    const ink = lightBg
      ? { 200: "92%", 300: "84%", 400: "72%", 500: "60%", 600: "48%", 700: "36%" }
      : { 200: "88%", 300: "76%", 400: "62%", 500: "48%", 600: "36%", 700: "26%" };
    Object.entries(ink).forEach(([k, v]) => el.style.setProperty(`--ts-ink-${k}`, v));
  }, [appTheme]);

  const persistAppTheme = useCallback((next) => {
    setAppTheme(next);
    try { localStorage.setItem("taskspace-app-theme", JSON.stringify(next)); } catch { /* quota */ }
    dbSaveSetting(APP_THEME_SETTING_KEY, JSON.stringify(next));
  }, []);

  const [pages, setPages] = useState(() => {
    try {
      const raw = localStorage.getItem("taskspace-pages");
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* 壊れていたら既定 */ }
    return DEFAULT_PAGES;
  });
  const persistPages = useCallback((next) => {
    setPages(next);
    try { localStorage.setItem("taskspace-pages", JSON.stringify(next)); } catch { /* quota */ }
    dbSaveSetting(PAGES_SETTING_KEY, JSON.stringify(next));
  }, []);

  const [stockViews, setStockViews] = useState(() => {
    try {
      const raw = localStorage.getItem("taskspace-stock-views");
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* 壊れていたら既定に戻す */ }
    return DEFAULT_STOCK_VIEWS;
  });

  // ビュー定義は app_settings に載せて全端末で共有する
  const persistStockViews = useCallback((next) => {
    setStockViews(next);
    try { localStorage.setItem("taskspace-stock-views", JSON.stringify(next)); } catch { /* quota */ }
    dbSaveSetting(STOCK_VIEWS_SETTING_KEY, JSON.stringify(next));
  }, []);
  const [inboxItems, setInboxItems] = useState(boot.inboxItems || SAMPLE_INBOX);
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(true);
  const [weeklyFlat, setWeeklyFlat] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [focusTaskId, setFocusTaskId] = useState(null);
  const [focusPickMode, setFocusPickMode] = useState(false);
  const [focusTrayItem, setFocusTrayItem] = useState(null);
  const [pendingEditId, setPendingEditId] = useState(null);
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
    try { return JSON.parse(localStorage.getItem("taskspace-panel-order") || "null") || ["7days", "tray", "board", "calendar"]; } catch { return ["7days", "tray", "board", "calendar"]; }
  });
  const DEFAULT_SECTION_LABELS = { tray: "TRAY", today: "Today", weekly: "Weekly List", "7days": "7Days", board: "Project", calendar: "Calendar" };
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
  const [calendarMonth, setCalendarMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
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
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("taskspace-view-mode") || "list");
  useEffect(() => { localStorage.setItem("taskspace-view-mode", viewMode); }, [viewMode]);
  const canvasMode = viewMode === "canvas";
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

  // 複数選択したまま、その中の1件を掴んだときは選択分をまとめて移動する。
  // 行き先が一意に決まるドロップ先だけを対象にし、決められない場合は false を返して
  // 従来の単体処理（並べ替え・親子化など）にそのまま任せる。
  function applyBulkDrop(ids, dst) {
    const tKey = toDateKey(new Date());
    let patch = null;
    let label = "";

    if (dst.type === "day-column") {
      patch = { scheduledDate: dst.date, today: false, thisWeek: false, parentId: null, category: "", project: "" };
      label = dst.date === tKey ? "今日" : dst.label;
    } else if (dst.type === "today") {
      patch = { scheduledDate: tKey, today: false, thisWeek: false };
      label = "Today";
    } else if (dst.type === "weekly") {
      patch = { thisWeek: true, today: false, scheduledDate: "" };
      label = "Weekly";
    } else if (dst.type === "stock-zone") {
      patch = { stock: true, stockViewId: dst.viewId, scheduledDate: "", today: false, thisWeek: false };
      label = stockViews.find((v) => v.id === dst.viewId)?.name || "STOCK";
    } else if (dst.type === "project") {
      patch = { category: dst.category, project: dst.project, parentId: null, stock: false };
      label = `${dst.category} / ${dst.project}`;
    } else if (dst.type === "task" || dst.type === "task-in-day" || dst.type === "task-in-today" || dst.type === "task-in-weekly") {
      // タスクの上に落とした場合は「そのタスクと同じ場所」へ揃える（親子化はしない）
      const target = taskMap.get(dst.id);
      if (!target || ids.includes(dst.id)) return false;
      if (dst.type === "task-in-day") {
        patch = { scheduledDate: target.scheduledDate || "", today: false, thisWeek: false, parentId: null, category: "", project: "" };
        label = "同じ日";
      } else if (dst.type === "task-in-today") {
        patch = { scheduledDate: tKey, today: false, thisWeek: false };
        label = "Today";
      } else if (dst.type === "task-in-weekly") {
        patch = { thisWeek: true, today: false, scheduledDate: "" };
        label = "Weekly";
      } else {
        patch = { category: target.category, project: target.project, parentId: null };
        label = `${target.category} / ${target.project}`;
      }
    }

    if (!patch) return false;
    const idSet = new Set(ids);
    commitTasks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, ...patch } : t)));
    setToast(`${ids.length}件を${label}に移動しました`);
    return true;
  }

  function handleDragEnd({ active, over }) {
    setActiveDrag(null);
    if (!over) return;
    const src = active.data.current;
    const dst = over.data.current;
    if (!src || !dst) return;

    if (src.type === "task" && selectedIds.size > 1 && selectedIds.has(src.id)) {
      if (applyBulkDrop([...selectedIds], dst)) return;
    }

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
      upsertTask({ id: src.id, category: dst.category, project: dst.project, parentId: null, stock: false });
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
    // Task → STOCK (日付を外して寝かせる。category/project は維持)
    if (src.type === "task" && dst.type === "stock-zone") {
      const name = stockViews.find((v) => v.id === dst.viewId)?.name || "STOCK";
      upsertTask({ id: src.id, stock: true, stockViewId: dst.viewId, scheduledDate: "", today: false, thisWeek: false });
      setToast(`${name}に入れました`);
      return;
    }

    // Tray item → STOCK (タスク化してストックへ)
    if (src.type === "tray" && dst.type === "stock-zone") {
      const name = stockViews.find((v) => v.id === dst.viewId)?.name || "STOCK";
      acceptInboxItem(src.id, "", "", { plain: true, stock: true, stockViewId: dst.viewId });
      setToast(`TRAYから${name}に移しました`);
      return;
    }

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
      const remoteTheme = settings?.[APP_THEME_SETTING_KEY];
      if (remoteTheme) {
        try {
          const parsed = typeof remoteTheme === "string" ? JSON.parse(remoteTheme) : remoteTheme;
          if (parsed?.bg && parsed?.text) {
            setAppTheme(parsed);
            localStorage.setItem("taskspace-app-theme", JSON.stringify(parsed));
          }
        } catch { /* 壊れていたらローカルのまま */ }
      }
      const remotePages = settings?.[PAGES_SETTING_KEY];
      if (remotePages) {
        try {
          const parsed = typeof remotePages === "string" ? JSON.parse(remotePages) : remotePages;
          if (Array.isArray(parsed) && parsed.length) {
            setPages(parsed);
            localStorage.setItem("taskspace-pages", JSON.stringify(parsed));
          }
        } catch { /* 壊れていたらローカルのまま */ }
      }
      const remoteViews = settings?.[STOCK_VIEWS_SETTING_KEY];
      if (remoteViews) {
        try {
          const parsed = typeof remoteViews === "string" ? JSON.parse(remoteViews) : remoteViews;
          if (Array.isArray(parsed) && parsed.length) {
            setStockViews(parsed);
            localStorage.setItem("taskspace-stock-views", JSON.stringify(parsed));
          }
        } catch { /* 壊れていたらローカルのまま */ }
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

  // STOCK: 明示的に置かれた、日付を持たないタスク（プロジェクト所属は維持）。
  // ビューごとに分け、そのビュー内に親がいないものをルートとして出すことで
  // 親子階層をそのまま持ち込む。既定ビューは stockViewId 未設定のものも拾う。
  const stockRootsByView = useMemo(() => {
    const defaultViewId = stockViews[0]?.id;
    const viewOf = (t) => t.stockViewId || defaultViewId;
    const parked = tasks.filter((t) => t.stock && !t.archived);
    const byView = new Map(stockViews.map((v) => [v.id, []]));
    const inView = new Map();
    parked.forEach((t) => {
      const v = viewOf(t);
      if (!byView.has(v)) return; // 削除済みビューに残った参照は無視
      if (!inView.has(v)) inView.set(v, new Set());
      inView.get(v).add(t.id);
    });
    parked.forEach((t) => {
      const v = viewOf(t);
      if (!byView.has(v)) return;
      // 同じビューに親がいるなら、その親の下にぶら下げて描くのでルートにしない
      if (t.parentId && inView.get(v)?.has(t.parentId)) return;
      byView.get(v).push(t);
    });
    return byView;
  }, [tasks, stockViews]);

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

  // 起動時に1回だけ: タスクが存在しない孤立 projectRules を永続削除
  useEffect(() => {
    const existingKeys = new Set(
      tasks.filter((t) => t.category && t.project).map((t) => `${t.category}::${t.project}`)
    );
    const orphaned = Object.keys(projectRules).filter((k) => !existingKeys.has(k));
    if (orphaned.length === 0) return;
    commitState((current) => ({
      ...current,
      projectRules: Object.fromEntries(Object.entries(current.projectRules || {}).filter(([k]) => existingKeys.has(k))),
    }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    let resolved = (patch.category || patch.project) ? { plain: false, ...patch } : patch;
    // 不変条件: 予定が入ったタスクはストックに残さない
    if (resolved.stock === undefined) {
      const scheduled = !!resolved.scheduledDate || resolved.today === true || resolved.thisWeek === true;
      if (scheduled) resolved = { ...resolved, stock: false };
    }
    commitTasks((prev) => prev.map((task) => (task.id === resolved.id ? normalizeTask({ ...task, ...resolved }) : task)));
  }

  function addTask({ title, category, project, parentId = null, thisWeek = false, today = false, dueDate = "", plain = false, select = false, scheduledDate = "", afterId = null, silent = false, canvasX = null, canvasY = null, pageId = null, blockType = "task", allowEmpty = false }) {
    const clean = normalizeTitle(title);
    // ページ本文は空のブロックも成立する（Notion と同じ）
    if (!clean && !allowEmpty) return null;
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
      canvasX,
      canvasY,
      pageId,
      blockType,
    });
    commitTasks((prev) => {
      if (afterId) {
        const idx = prev.findIndex((t) => t.id === afterId);
        if (idx >= 0) {
          const next = [...prev];
          next.splice(idx + 1, 0, newTask);
          return next;
        }
      }
      return [newTask, ...prev];
    });
    if (select) setSelectedTaskId(newTask.id);
    if (!silent) setToast(parent ? "子タスクを追加：親のCategory / Projectを継承しました" : "タスクを追加しました");
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
    // sortOrder を持たないものは配列順（＝入れた順）に並べる。
    // タイトル順にすると見出しや区切り線が勝手に動いて、区切りとして機能しない。
    const order = new Map(tasks.map((t, i) => [t.id, i]));
    return tasksForCategory(category)
      .filter((task) => task.project === project && !task.parentId && !task.plain)
      .sort((a, b) => {
        const ao = typeof a.sortOrder === "number" ? a.sortOrder : 999999;
        const bo = typeof b.sortOrder === "number" ? b.sortOrder : 999999;
        if (ao !== bo) return ao - bo;
        return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
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

      const existingNotionIds = new Set(
        tasks.filter((t) => t.notionId).map((t) => t.notionId)
      );
      const newPages = data.pages.filter(
        (p) => !existingNotionIds.has(p.id) && !seenIds.has(p.id)
      );

      // 新規分のIDを seen に追加して保存
      data.pages.forEach((p) => seenIds.add(p.id));
      localStorage.setItem(seenKey, JSON.stringify([...seenIds]));

      if (newPages.length === 0) {
        addSyncLog(`✅ Notion取得 ${data.count ?? 0}件（新規なし）`);
        if (!silent) setToast("新しいNotionページはありませんでした");
      } else {
        const newTasks = newPages.map((p) => normalizeTask({
          id: uid(),
          notionId: p.id,
          title: `n_${p.title}`,
          category: "",
          project: "",
          plain: true,
          scheduledDate: "",
          status: "未着手",
          parentId: null,
        }));
        commitTasks((prev) => [...newTasks, ...prev]);
        addSyncLog(`✅ Notion取得 ${data.count ?? 0}件 → 新規${newPages.length}件をTRAYへ`);
        setToast(`${newPages.length}件をTRAYに追加しました`);
      }

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

  function addStockView() {
    const used = new Set(stockViews.map((v) => v.color));
    const color = STOCK_VIEW_COLORS.find((c) => !used.has(c)) || STOCK_VIEW_COLORS[stockViews.length % STOCK_VIEW_COLORS.length];
    const view = { id: `sv-${uid()}`, name: `STOCK ${stockViews.length + 1}`, color };
    persistStockViews([...stockViews, view]);
    setToast(`${view.name} を追加しました`);
  }

  function updateStockView(id, patch) {
    persistStockViews(stockViews.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  // ビューを消しても中のタスクは消さない。行き場を失うので STOCK から出す。
  function removeStockView(id) {
    if (stockViews.length <= 1) { setToast("最後のSTOCKビューは削除できません"); return; }
    const view = stockViews.find((v) => v.id === id);
    const isDefault = stockViews[0]?.id === id;
    commitTasks((prev) => prev.map((t) => {
      const belongs = t.stock && (t.stockViewId === id || (isDefault && !t.stockViewId));
      return belongs ? { ...t, stock: false, stockViewId: null } : t;
    }));
    persistStockViews(stockViews.filter((v) => v.id !== id));
    setToast(`${view?.name || "ビュー"} を削除し、中のタスクはSTOCKから出しました`);
  }

  // 選択分をまとめて STOCK へ。プロジェクト所属はそのまま、日付だけ外す。
  // TRAY 行はタスク化してから入れる（カテゴリなしのまま）。
  // 前のブロックに文字を足して自分を消す。1回の更新でやらないと、
  // 後の書き込みが更新前の状態を元にして前の書き込みを消してしまう。
  function mergeBlockInto(prevId, taskId, mergedTitle) {
    commitTasks((prev) => prev
      .map((t) => (t.id === prevId ? { ...t, title: mergedTitle } : t))
      .filter((t) => t.id !== taskId));
  }

  // 配列順がそのまま表示順なので、2件の位置を入れ替える
  function swapTaskOrder(id, targetId, title) {
    commitTasks((prev) => {
      const a = prev.findIndex((t) => t.id === id);
      const b = prev.findIndex((t) => t.id === targetId);
      if (a < 0 || b < 0) return prev;
      // タイトルの確定も同じ更新に含める（別々に書くと巻き戻る）
      const next = prev.map((t) => (t.id === id && title != null ? { ...t, title } : t));
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  function bulkMoveToStock(viewId) {
    const trayIds = [...selectedTrayIds];
    const taskCount = selectedIds.size;
    const trayCount = trayIds.length;
    const target = viewId || stockViews[0]?.id;
    if (taskCount > 0) {
      commitTasks((prev) => prev.map((t) => selectedIds.has(t.id)
        ? { ...t, stock: true, stockViewId: target, scheduledDate: "", today: false, thisWeek: false }
        : t));
    }
    trayIds.forEach((id) => {
      const item = inboxItems.find((i) => i.id === id);
      if (!item) return;
      const newTask = normalizeTask({ id: uid(), title: item.title, status: "未着手", parentId: null, memo: "", dueDate: "", plain: true, stock: true, stockViewId: target });
      commitState((current) => ({
        ...current,
        tasks: [newTask, ...current.tasks],
        inboxItems: (current.inboxItems || []).filter((i) => i.id !== id),
      }));
      addTombstone(TOMBSTONE_TRAY_KEY, id);
      dbDeleteTrayItem(id);
      dbUpsertTaskRow(newTask);
    });
    const name = stockViews.find((v) => v.id === target)?.name || "STOCK";
    setToast(`${taskCount + trayCount}件を${name}に入れました`);
    setShowMovePanel(false);
    exitSelectMode();
  }

  // ツールバーの現在値表示用。選択分で揃っているときだけその値を返す。
  const selectedTasksList = useMemo(
    () => tasks.filter((t) => selectedIds.has(t.id)),
    [tasks, selectedIds]
  );
  const selectionAllBold = selectedTasksList.length > 0 && selectedTasksList.every((t) => t.style?.bold);
  const selectionColor = useMemo(() => {
    if (selectedTasksList.length === 0) return null;
    const first = selectedTasksList[0].style?.color || "";
    return selectedTasksList.every((t) => (t.style?.color || "") === first) ? first : null;
  }, [selectedTasksList]);

  // 選択分の見た目（色・太さ）を変更する
  function bulkSetStyle(patch) {
    if (selectedIds.size === 0) return;
    commitTasks((prev) => prev.map((t) => {
      if (!selectedIds.has(t.id)) return t;
      const next = { ...(t.style || {}), ...patch };
      // 既定値だけになったら style ごと落として行を軽くする
      Object.keys(next).forEach((k) => { if (!next[k]) delete next[k]; });
      return { ...t, style: Object.keys(next).length ? next : null };
    }));
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

  const focusModeValue = useMemo(() => ({
    focusPickMode,
    pickTask: (id) => { setFocusTaskId(id); setFocusPickMode(false); },
    pickTrayItem: (item) => { setFocusTrayItem(item); setFocusPickMode(false); },
  }), [focusPickMode]);

  // Enter で「同じ場所の直下」に空ブロックを作り、そのまま編集に入る
  const addBlockBelow = useCallback((task) => {
    // addTask は空タイトルを弾くので、いったん placeholder を入れて
    // すぐ編集状態にし、ドラフトは空で見せる（未入力のまま確定したら削除される）
    const created = addTask({
      title: "新規タスク",
      category: task.category || "",
      project: task.project || "",
      parentId: task.parentId || null,
      plain: !!task.plain,
      scheduledDate: task.scheduledDate || "",
      thisWeek: !!task.thisWeek,
      today: !!task.today,
      afterId: task.id,
      silent: true,
    });
    if (created) setPendingEditId(created.id);
    return created;
  }, [addTask]);

  // 同じタスクが複数のビューに描画されるため（例: 日付つきのプレーンタスクは
  // 7days と TRAY の両方に出る）、新規ブロックの編集は先に名乗った1つだけに渡す。
  // 2つ開くと、片方が blur したときに「空なので削除」が走ってブロックごと消える。
  const pendingClaimRef = useRef(null);
  const blockEditValue = useMemo(() => ({
    addBlockBelow,
    // 自分で作ったブロックを編集状態で開きたいとき（ページの末尾追加など）
    markForEdit: (id) => { pendingClaimRef.current = null; setPendingEditId(id); },
    pendingEditId,
    claimPendingEdit: (id) => {
      if (pendingEditId !== id || pendingClaimRef.current === id) return false;
      pendingClaimRef.current = id;
      setPendingEditId(null);
      return true;
    },
  }), [addBlockBelow, pendingEditId]);

  const handleMarqueeSelect = useCallback((taskIds, trayIds) => {
    setSelectedIds(new Set(taskIds));
    setSelectedTrayIds(new Set(trayIds));
  }, []);

  // Esc で選択解除
  useEffect(() => {
    if (selectedIds.size === 0 && selectedTrayIds.size === 0) return;
    function onKey(e) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      if (e.key === "Escape") { setSelectedIds(new Set()); setSelectedTrayIds(new Set()); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, selectedTrayIds]);

  // コマンドは非同期に走ることがある（追加欄では作成の次フレーム）。
  // useMemo で固めると古い tasks を掴んだ upsertTask が残り、
  // 直前に作ったタスクが「見つからない」扱いになって patch が捨てられる。
  // 参照は毎レンダー差し替え、外向きの関数だけ同一にしておく。
  const slashHandlers = useRef(null);
  slashHandlers.current = {
    upsertTask,
    removeTask,
    toggleDone,
    defaultStockViewId: stockViews[0]?.id,
    // キャンバスに置く。重ならないよう、既にある分だけ少しずらす。
    placeOnCanvas: (task) => {
      const n = tasks.filter((t) => t.canvasX != null).length;
      upsertTask({ id: task.id, canvasX: 40 + (n % 4) * 280, canvasY: 40 + Math.floor(n / 4) * 90 });
    },
    setBlockType: (task, blockType) => {
      // 区切り線は本文を持たないので、タイトルは種別名で置いておく
      const patch = { id: task.id, blockType };
      if (blockType === "divider") patch.title = "———";
      upsertTask(patch);
    },
    setStyle: (task, patch) => {
      const next = { ...(task.style || {}), ...patch };
      Object.keys(next).forEach((k) => { if (!next[k]) delete next[k]; });
      upsertTask({ id: task.id, style: Object.keys(next).length ? next : null });
    },
  };
  const slashValue = useMemo(() => ({
    upsertTask: (...a) => slashHandlers.current.upsertTask(...a),
    removeTask: (...a) => slashHandlers.current.removeTask(...a),
    toggleDone: (...a) => slashHandlers.current.toggleDone(...a),
    setBlockType: (...a) => slashHandlers.current.setBlockType(...a),
    placeOnCanvas: (...a) => slashHandlers.current.placeOnCanvas(...a),
    setStyle: (...a) => slashHandlers.current.setStyle(...a),
    get defaultStockViewId() { return slashHandlers.current.defaultStockViewId; },
  }), []);

  const selectionValue = useMemo(() => ({
    selectedIds,
    toggleTask: onToggleSelect,
  }), [selectedIds]);

  return (
    <SelectionContext.Provider value={selectionValue}>
    <SlashContext.Provider value={slashValue}>
    <BlockEditContext.Provider value={blockEditValue}>
    <FocusModeContext.Provider value={focusModeValue}>
    <DndContext sensors={sensors} collisionDetection={taskFirstCollision} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="min-h-screen ts-bg ts-text" style={{ fontFamily: appFontCss }}>
      <div className="mx-auto flex max-w-[2400px] flex-col gap-2 px-3 py-2">
        <header className="sticky top-0 z-30 -mx-2 flex flex-wrap items-center gap-2 border-b border-white/10 ts-bg-veil px-2 py-2 backdrop-blur">
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
                  addTask({ title, category: "", project: "", plain: true, scheduledDate: toDateKey(new Date()) });
                  setToast(`「${title}」をTRAYに追加しました`);
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
                  className="w-44 rounded-md border border-white/20 bg-white/[0.07] px-2 py-1.5 text-xs ts-text placeholder-neutral-500 outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/20 sm:w-56"
                />
                <button type="submit" className="rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-500/25">追加</button>
                <button type="button" onClick={() => { setQuickAddOpen(false); setQuickAddTitle(""); }} className="rounded-md border border-white/10 bg-white/[0.03] p-1.5 text-neutral-400 transition hover:bg-white/[0.07]"><X className="h-3.5 w-3.5" /></button>
              </form>
            ) : (
              <button onClick={() => setQuickAddOpen(true)} title="タスクを追加" className="rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-500/25"><Plus className="h-3.5 w-3.5" /></button>
            )}
            <button onClick={() => window.location.reload()} title="再読み込み" className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.07]"><RefreshCw className="h-3.5 w-3.5" /></button>
            <button onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)" className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-30"><Undo2 className="h-3.5 w-3.5" /></button>
            <button onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Shift+Z)" className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-30"><Redo2 className="h-3.5 w-3.5" /></button>
            <button
              onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
              title="Select mode"
              className={classNames("rounded-md border px-2 py-1.5 text-xs transition flex items-center gap-1", selectMode ? "border-white/30 bg-white/20 ts-text" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}
            >
              <CheckSquare className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setFocusPickMode((v) => !v); setFocusTaskId(null); }}
              title="フォーカスモード"
              className={classNames("rounded-md border px-2 py-1.5 text-xs transition flex items-center gap-1", focusPickMode ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}
            >
              <Focus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode((v) => (v === "canvas" ? "list" : "canvas"))}
              title={viewMode === "canvas" ? "リスト表示に戻す" : "キャンバス表示"}
              className={classNames("rounded-md border px-2 py-1.5 text-xs transition flex items-center gap-1", viewMode === "canvas" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode((v) => (v === "pages" ? "list" : "pages"))}
              title={viewMode === "pages" ? "リスト表示に戻す" : "ページ表示"}
              className={classNames("rounded-md border px-2 py-1.5 text-xs transition flex items-center gap-1", viewMode === "pages" ? "border-sky-400/40 bg-sky-400/10 text-sky-300" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
            <KeepAwakeButton />
            <div className="relative">
              <button
                onClick={() => setShowSettingsPanel((v) => !v)}
                className={classNames("rounded-md border px-2 py-1.5 text-xs transition", showSettingsPanel ? "border-white/25 bg-white/10 ts-text" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]")}
                title="Settings"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              {showSettingsPanel && (
                <div className="fixed right-2 top-14 z-50 w-72 rounded-lg border border-white/15 ts-surface p-3 shadow-2xl max-h-[calc(100vh-4rem)] overflow-y-auto md:absolute md:right-0 md:top-full md:mt-1 md:w-64 md:max-h-[80vh]">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-200">Settings</span>
                    <button onClick={() => setShowSettingsPanel(false)} className="text-neutral-500 hover:text-neutral-200"><X className="h-3.5 w-3.5" /></button>
                  </div>

                  {/* 配色 */}
                  <div className="mb-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">配色</div>
                    <div className="mb-2 grid grid-cols-4 gap-1.5">
                      {APP_THEME_PRESETS.map((preset) => {
                        const active = appTheme.bg === preset.bg && appTheme.text === preset.text;
                        return (
                          <button
                            key={preset.name}
                            onClick={() => persistAppTheme({ bg: preset.bg, text: preset.text })}
                            title={preset.name}
                            className={classNames(
                              "flex h-9 flex-col items-center justify-center rounded border text-[9px] transition",
                              active ? "border-white ring-1 ring-white/50" : "border-white/15 hover:border-white/40"
                            )}
                            style={{ backgroundColor: preset.bg, color: preset.text }}
                          >
                            {preset.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-1.5 text-[10px] text-neutral-500">
                        背景
                        <input
                          type="color"
                          value={appTheme.bg}
                          onChange={(e) => persistAppTheme({ ...appTheme, bg: e.target.value })}
                          className="h-6 w-full cursor-pointer rounded border border-white/10 bg-transparent"
                        />
                      </label>
                      <label className="flex flex-1 items-center gap-1.5 text-[10px] text-neutral-500">
                        文字
                        <input
                          type="color"
                          value={appTheme.text}
                          onChange={(e) => persistAppTheme({ ...appTheme, text: e.target.value })}
                          className="h-6 w-full cursor-pointer rounded border border-white/10 bg-transparent"
                        />
                      </label>
                    </div>
                    {(appTheme.bg !== DEFAULT_APP_THEME.bg || appTheme.text !== DEFAULT_APP_THEME.text) && (
                      <button
                        onClick={() => persistAppTheme(DEFAULT_APP_THEME)}
                        className="mt-1.5 w-full rounded border border-white/10 py-1 text-[10px] text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-300"
                      >
                        既定に戻す
                      </button>
                    )}
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
                      {panelOrder.map((key, idx) => {
                        const hints = { "7days": "横7曜日", tray: "受信トレイ", today: "今日のタスク", weekly: "週次リスト", board: "プロジェクト", calendar: "カレンダー" };
                        return (
                          <div key={key} className="flex items-center gap-1 rounded border border-white/5 bg-black/15 px-2 py-1">
                            <input
                              value={sectionLabels[key] ?? DEFAULT_SECTION_LABELS[key] ?? key}
                              onChange={(e) => updateSectionLabel(key, e.target.value)}
                              className="flex-1 min-w-0 bg-transparent text-[11px] text-neutral-300 outline-none placeholder:text-neutral-600"
                              placeholder={DEFAULT_SECTION_LABELS[key] || key}
                            />
                            <span className="shrink-0 text-[9px] text-neutral-600">{hints[key]}</span>
                            <button onClick={() => movePanelSection(key, -1)} disabled={idx === 0} className="rounded p-0.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-20"><ChevronUp className="h-3 w-3" /></button>
                            <button onClick={() => movePanelSection(key, 1)} disabled={idx === panelOrder.length - 1} className="rounded p-0.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-20"><ChevronDown className="h-3 w-3" /></button>
                          </div>
                        );
                      })}
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

                  {isSupabaseEnabled && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <button
                        onClick={async () => { await supabase.auth.signOut(); setShowSettingsPanel(false); }}
                        className="flex w-full items-center gap-1.5 rounded border border-red-500/20 bg-red-500/[0.06] px-2 py-1.5 text-xs text-red-400 transition hover:bg-red-500/[0.12]"
                      >
                        ログアウト
                      </button>
                    </div>
                  )}
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

        {viewMode === "pages" && (
          <PagesView
            pages={pages}
            onPagesChange={persistPages}
            tasks={tasks}
            upsertTask={upsertTask}
            removeTask={removeTask}
            toggleDone={toggleDone}
            setSelectedTaskId={setSelectedTaskId}
            childrenOf={childrenOf}
            addTask={addTask}
            onReorder={swapTaskOrder}
            onMergeBlocks={mergeBlockInto}
          />
        )}
        {canvasMode && (
          <CanvasView
            tasks={tasks}
            upsertTask={upsertTask}
            removeTask={removeTask}
            toggleDone={toggleDone}
            setSelectedTaskId={setSelectedTaskId}
            selectedTaskId={selectedTaskId}
            childrenOf={childrenOf}
            addTask={addTask}
          />
        )}
        {viewMode === "list" && use5col && (
          <>
          {(
            <div className={classNames("block ", (selectedTask || selectedProject) && "md:pr-[384px]")}>
              <SevenDayView tasks={filteredTasks} projectRules={projectRules} taskMap={taskMap} childrenOf={childrenOf} upsertTask={upsertTask} removeTask={removeTask} addTask={addTask} toggleDone={toggleDone} categoryTone={categoryTone} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} setSelectedProject={setSelectedProject} />
            </div>
          )}
          <div
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
            className={classNames("grid gap-2 items-start pb-2", (selectedTask || selectedProject) && "md:pr-[384px]")}
          >
            {/* TRAY column */}
            <div className="min-w-0">
              <div className="rounded-lg border border-white/10 bg-white/[0.02]">
                <div className="sticky top-0 flex items-baseline justify-between gap-2 border-b border-white/10 ts-bg-veil px-2 py-1.5 backdrop-blur">
                  <span className="text-sm font-bold text-neutral-200">TRAY</span>
                  <span className="text-[10px] text-neutral-500">{tasks.filter(t => !t.category && !t.project && !t.archived && !t.stock && !t.pageId).length + inboxItems.length}</span>
                </div>
                <div className="flex flex-col gap-0.5 px-2 py-2">
                  {(() => {
                    const rootTrayTasks = tasks.filter(t => !t.category && !t.project && !t.archived && !t.stock && !t.pageId && !t.parentId);
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
                    <div
                      key={item.id}
                      data-tray-id={item.id}
                      onClick={() => { if (focusPickMode) { setFocusTrayItem(item); setFocusPickMode(false); return; } onToggleTraySelect(item.id); }}
                      onDoubleClick={() => acceptInboxItem(item.id, "", "", { plain: true }, {})}
                      className={classNames(
                        "flex items-start gap-1 rounded px-1.5 py-1 text-[12.5px] transition cursor-pointer hover:bg-white/[0.06]",
                        focusPickMode && "cursor-crosshair ring-1 ring-amber-400/25 hover:ring-2 hover:ring-amber-400/70"
                      )}
                    >
                      <span className="mt-0.5 shrink-0 text-[9px] text-neutral-600 font-bold">n</span>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-neutral-300">{item.title}</div>
                        <div className="text-[9px] text-neutral-600">{item.source}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* STOCK views */}
            {stockViews.map((view) => (
              <div key={view.id} className="min-w-0">
                <StockColumn
                  view={view}
                  tasks={stockRootsByView.get(view.id) || []}
                  childrenOf={childrenOf}
                  categoryTone={categoryTone}
                  toggleDone={toggleDone}
                  upsertTask={upsertTask}
                  removeTask={removeTask}
                  selectedTaskId={selectedTaskId}
                  setSelectedTaskId={setSelectedTaskId}
                  selectMode={selectMode}
                  onUnstock={(id) => upsertTask({ id, stock: false, stockViewId: null })}
                  onUpdateView={(patch) => updateStockView(view.id, patch)}
                  onRemoveView={() => removeStockView(view.id)}
                  canRemove={stockViews.length > 1}
                />
              </div>
            ))}
            <div className="min-w-0">
              <button
                onClick={addStockView}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-3 text-xs text-neutral-500 transition hover:border-white/30 hover:bg-white/[0.04] hover:text-neutral-300"
              >
                <Plus className="h-3.5 w-3.5" />
                STOCKビューを追加
              </button>
            </div>
            {/* Board category columns */}
            {categories.map((cat) => (
              <div key={cat.key} className="min-w-0">
                <CategoryColumn category={cat} projects={projectsByCategory[cat.key] || []} rootTasksForProject={rootTasksForProject} childrenOf={childrenOf} taskMap={taskMap} collapsed={collapsed} setCollapsed={setCollapsed} addTask={addTask} upsertTask={upsertTask} removeTask={removeTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} handleDropOnProject={handleDropOnProject} handleDropOnTask={handleDropOnTask} moveColumn={moveColumn} moveProject={moveProject} categoryTone={categoryTone} projectRules={projectRules} selectMode={selectMode} />
              </div>
            ))}
          </div>
          {/* 5列モードでもカレンダーは下に残す */}
          <div className={classNames("block ", (selectedTask || selectedProject) && "md:pr-[384px]")}>
            <CalendarView month={calendarMonth} setMonth={setCalendarMonth} tasks={filteredTasks} projectRules={projectRules} categoryTone={categoryTone} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} />
          </div>
          </>
        )}

        {viewMode === "list" && !use5col && (
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
              />
            );
            const boardCols = categories.map((cat) => (
              <CategoryColumn key={cat.key} category={cat} projects={projectsByCategory[cat.key] || []} rootTasksForProject={rootTasksForProject} childrenOf={childrenOf} taskMap={taskMap} collapsed={collapsed} setCollapsed={setCollapsed} addTask={addTask} upsertTask={upsertTask} removeTask={removeTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} handleDropOnProject={handleDropOnProject} handleDropOnTask={handleDropOnTask} moveColumn={moveColumn} moveProject={moveProject} categoryTone={categoryTone} projectRules={projectRules} selectMode={selectMode} />
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
                  <SevenDayView tasks={filteredTasks} projectRules={projectRules} taskMap={taskMap} childrenOf={childrenOf} upsertTask={upsertTask} removeTask={removeTask} addTask={addTask} toggleDone={toggleDone} categoryTone={categoryTone} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} setSelectedProject={setSelectedProject} />
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

        {focusTaskId && (
          <FocusOverlay
            taskId={focusTaskId}
            taskMap={taskMap}
            childrenOf={childrenOf}
            categoryTone={categoryTone}
            upsertTask={upsertTask}
            toggleDone={toggleDone}
            onClose={() => setFocusTaskId(null)}
          />
        )}

        {focusTrayItem && (
          <FocusOverlay
            trayItem={focusTrayItem}
            categoryTone={categoryTone}
            onClose={() => setFocusTrayItem(null)}
          />
        )}

        <MarqueeSelect onSelect={handleMarqueeSelect} />

        {(selectedIds.size > 0 || selectedTrayIds.size > 0) && (
          <>
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-white/20 ts-surface px-3 py-2.5 shadow-2xl max-w-[calc(100vw-1.5rem)] overflow-x-auto scrollbar-none">
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
            {selectedIds.size > 0 && (
              <div className="flex flex-shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-1">
                <button
                  onClick={() => bulkSetStyle({ bold: !selectionAllBold })}
                  title="太字"
                  className={classNames(
                    "rounded px-1.5 py-0.5 text-xs font-bold transition",
                    selectionAllBold ? "bg-white/20 text-neutral-50" : "text-neutral-300 hover:bg-white/10"
                  )}
                >B</button>
                <span className="h-3.5 w-px bg-white/15" />
                {TASK_TEXT_COLORS.map((c) => (
                  <button
                    key={c.key || "default"}
                    onClick={() => bulkSetStyle({ color: c.key })}
                    title={c.label}
                    className={classNames(
                      "h-4 w-4 rounded-full border transition",
                      selectionColor === c.key ? "border-white ring-1 ring-white/60" : "border-white/20 hover:border-white/50"
                    )}
                    style={c.key ? { backgroundColor: c.key } : undefined}
                  >
                    {!c.key && <span className="text-[8px] leading-none text-neutral-400">×</span>}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => {
              if (selectedIds.size > 0) bulkDelete();
              if (selectedTrayIds.size > 0) bulkTrayDelete();
            }} className="flex-shrink-0 rounded-md border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200 transition hover:bg-red-500/20">Delete</button>
            <button onClick={exitSelectMode} className="flex-shrink-0 ml-1 rounded-full border border-white/10 p-1 text-neutral-400 transition hover:bg-white/[0.07] hover:ts-text"><X className="h-3.5 w-3.5" /></button>
          </div>
          {showMovePanel && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-64 max-h-[60vh] overflow-y-auto rounded-xl border border-white/15 ts-surface p-1.5 shadow-2xl">
              <div className="mb-1 px-2 text-[10px] text-neutral-600">移動先を選択</div>
              <div className="my-1 border-t border-white/10" />
              <div className="px-2 pt-0.5 pb-1 text-[10px] font-semibold text-neutral-500">STOCK</div>
              {stockViews.map((view) => (
                <button
                  key={view.id}
                  onClick={() => bulkMoveToStock(view.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs font-medium transition hover:bg-white/[0.07]"
                  style={{ color: view.color }}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: view.color }} />
                  <span className="min-w-0 flex-1 truncate">{view.name}</span>
                </button>
              ))}
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
        {toast && <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/10 ts-surface px-3 py-1.5 text-[11px] text-neutral-400 shadow-2xl backdrop-blur">{toast}</div>}
      </div>
    </div>
    <DragOverlay dropAnimation={null}>
      {activeDrag?.type === "task" && (
        selectedIds.size > 1 && selectedIds.has(activeDrag.id) ? (
          <div className="flex items-center gap-2 rounded-md border border-sky-400/50 bg-neutral-800/95 px-2 py-1.5 text-[12.5px] font-medium ts-text shadow-2xl opacity-95">
            <span className="rounded-full border border-sky-400/40 bg-sky-500/20 px-1.5 text-[10px] text-sky-100">{selectedIds.size}</span>
            <span className="max-w-xs truncate">{taskMap.get(activeDrag.id)?.title || "…"}</span>
            <span className="text-[10px] text-neutral-400">ほか{selectedIds.size - 1}件</span>
          </div>
        ) : (
          <div className="max-w-xs whitespace-pre-wrap rounded-md border border-white/30 bg-neutral-800/95 px-2 py-1.5 text-[12.5px] font-medium ts-text shadow-2xl opacity-95">{taskMap.get(activeDrag.id)?.title || "…"}</div>
        )
      )}
      {activeDrag?.type === "tray" && <div className="max-w-xs whitespace-pre-wrap rounded-md border border-white/30 bg-neutral-800/95 px-2 py-1.5 text-[12.5px] font-medium ts-text shadow-2xl opacity-95">{activeDrag.title || "…"}</div>}
      {activeDrag?.type === "column" && <div className="whitespace-nowrap rounded-md border border-white/30 bg-neutral-800/95 px-2 py-1.5 text-xs font-semibold ts-text shadow-2xl opacity-95">{activeDrag.label || activeDrag.key}</div>}
      {activeDrag?.type === "project" && <div className="whitespace-nowrap rounded-md border border-white/30 bg-neutral-800/95 px-2 py-1.5 text-xs font-semibold ts-text shadow-2xl opacity-95">{activeDrag.project}</div>}
    </DragOverlay>
    </DndContext>
    </FocusModeContext.Provider>
    </BlockEditContext.Provider>
    </SlashContext.Provider>
    </SelectionContext.Provider>
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
            <AnimatePresence initial={false}>{weeklyRoots.map((task) => <TaskCard key={task.id} task={task} taskMap={taskMap} categoryTone={categoryTone} depth={0} children={weeklyFlat ? [] : childrenOf(task.id).filter((child) => isThisWeekUnscheduled(child))} childrenOf={childrenOf} collapsed={collapsed} setCollapsed={setCollapsed} upsertTask={upsertTask} removeTask={removeWeeklyTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} handleDropOnTask={handleDropOnTask} moveWeeklyTask={moveWeeklyTask} compact selectMode={selectMode} />)}</AnimatePresence>
            {weeklyRoots.length === 0 && <div className="rounded-md border border-dashed border-amber-200/20 p-4 text-center text-xs text-amber-100/50">今週タスクはまだありません。</div>}
          </div>
        </div>
      )}
    </aside>
  );
}

// STOCK ビュー: 日付を決めずに寝かせておくタスクの置き場。
// プロジェクト所属は保ったままなので PJ ボードにも出続ける（Notion の同期ブロック的な見え方）。
// ビュー内に親がいる場合はその下にぶら下がるので、親子階層もそのまま持ち込める。
function StockColumn({ view, tasks, childrenOf, categoryTone, toggleDone, upsertTask, removeTask, selectedTaskId, setSelectedTaskId, selectMode, selectedIds, onToggleSelect, onUnstock, onUpdateView, onRemoveView, canRemove }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `stock-zone-${view.id}`,
    data: { type: "stock-zone", viewId: view.id },
  });
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(view.name);
  const [showColors, setShowColors] = useState(false);

  useEffect(() => { setNameDraft(view.name); }, [view.name]);

  function commitName() {
    const clean = nameDraft.trim();
    if (clean && clean !== view.name) onUpdateView({ name: clean });
    else setNameDraft(view.name);
    setEditingName(false);
  }

  return (
    <div
      ref={setNodeRef}
      className={classNames("rounded-lg border bg-white/[0.02] transition", isOver && "brightness-125")}
      style={{ borderColor: isOver ? view.color : "rgba(255,255,255,0.1)", backgroundColor: isOver ? `${view.color}14` : undefined }}
    >
      <div className="sticky top-0 flex items-center gap-1.5 border-b border-white/10 ts-bg-veil px-2 py-1.5 backdrop-blur">
        <button
          onClick={() => setShowColors((v) => !v)}
          title="色を変える"
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20 transition hover:ring-white/60"
          style={{ backgroundColor: view.color }}
        />
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitName(); }
              if (e.key === "Escape") { setNameDraft(view.name); setEditingName(false); }
            }}
            className="min-w-0 flex-1 rounded border-b border-white/25 bg-transparent text-sm font-bold outline-none"
            style={{ color: view.color }}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            title="クリックで名前を変更"
            className="group/name flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-bold"
            style={{ color: view.color }}
          >
            <span className="min-w-0 truncate">{view.name}</span>
            <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 transition group-hover/name:opacity-60" />
          </button>
        )}
        <span className="shrink-0 text-[10px] text-neutral-500">{tasks.length}</span>
        {canRemove && (
          <button
            onClick={onRemoveView}
            title="このビューを削除（中のタスクは消えません）"
            className="shrink-0 rounded p-0.5 text-neutral-600 transition hover:bg-white/10 hover:text-red-300"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {showColors && (
        <div className="flex flex-wrap gap-1.5 border-b border-white/10 px-2 py-1.5">
          {STOCK_VIEW_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { onUpdateView({ color: c }); setShowColors(false); }}
              className={classNames(
                "h-4 w-4 rounded-full transition",
                view.color === c ? "ring-2 ring-white/70" : "ring-1 ring-white/20 hover:ring-white/50"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}

      <div className="flex min-h-[80px] flex-col gap-0.5 px-2 py-2">
        {tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/10 p-3 text-center text-[11px] leading-relaxed text-neutral-600">
            日付を決めずに
            <br />
            寝かせるタスクをここへ
          </div>
        ) : (
          tasks.map((task, idx) => (
            <div key={task.id} className="group/stock relative">
              <TrayTask
                listNumber={numberedIndex(tasks, idx)}
                task={task}
                depth={0}
                toggleDone={toggleDone}
                upsertTask={upsertTask}
                removeTask={removeTask}
                setSelectedTaskId={setSelectedTaskId}
                selectedTaskId={selectedTaskId}
                childrenOf={childrenOf}
                selectMode={selectMode}
                onIndent={() => {
                  if (idx === 0) return;
                  upsertTask({ id: task.id, parentId: tasks[idx - 1].id });
                }}
                onOutdent={() => {
                  if (!task.parentId) return;
                  upsertTask({ id: task.id, parentId: null });
                }}
              />
              {task.project && (
                <span className={classNames(
                  "pointer-events-none absolute right-6 top-1 rounded border px-1 py-px text-[9px] leading-none",
                  categoryTone(task.category).panel,
                  categoryTone(task.category).accent
                )}>
                  {task.project}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onUnstock(task.id); }}
                title="ストックから戻す"
                className="absolute right-1 top-1 rounded p-0.5 text-neutral-600 opacity-0 transition hover:bg-white/10 hover:text-neutral-200 group-hover/stock:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
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
  const { focusPickMode, pickTrayItem } = useFocusMode();
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
      {...(!selectMode && !focusPickMode ? trayDragListeners : {})}
      {...(!selectMode && !focusPickMode ? trayDragAttrs : {})}
      onContextMenu={e => e.preventDefault()}
      onClick={() => { if (focusPickMode) { pickTrayItem?.(item); return; } onToggleSelect?.(item.id); }}
      data-draggable
      data-tray-id={item.id}
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
      className={classNames(
        "group rounded-md border bg-black/20 p-2 transition hover:border-white/20 hover:bg-white/[0.045]",
        isOver ? "border-white/30 bg-white/[0.06]" : "border-white/10",
        isTrayDragging && "opacity-40",
        isSelected && "border-sky-500/50 bg-sky-500/10",
        selectMode && "cursor-pointer",
        focusPickMode && "cursor-crosshair ring-1 ring-amber-400/25 hover:ring-2 hover:ring-amber-400/70"
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
              onDoubleClick={(e) => { if (focusPickMode) return; e.stopPropagation(); setEditing(true); }}
              className="block w-full break-words [overflow-wrap:anywhere] text-left text-[12.5px] font-medium leading-[1.35] text-neutral-200"
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

function CategoryColumn({ category, projects, rootTasksForProject, childrenOf, taskMap, collapsed, setCollapsed, addTask, upsertTask, removeTask, toggleDone, toggleWeek, toggleToday, selectedTaskId, setSelectedTaskId, setSelectedProject, handleDropOnProject, handleDropOnTask, moveColumn, moveProject, categoryTone, projectRules, selectMode }) {
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
          {effectiveProjects.map((project) => <ProjectGroup key={`${category.key}-${project}`} category={category.key} project={project} roots={rootTasksForProject(category.key, project)} childrenOf={childrenOf} taskMap={taskMap} collapsed={collapsed} setCollapsed={setCollapsed} addTask={addTask} upsertTask={upsertTask} removeTask={removeTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} setSelectedProject={setSelectedProject} handleDropOnProject={handleDropOnProject} handleDropOnTask={handleDropOnTask} moveProject={moveProject} categoryTone={categoryTone} projectRules={projectRules} selectMode={selectMode} />)}
        </div>
      )}
    </div>
  );
}

function ProjectGroup({ category, project, roots, childrenOf, taskMap, collapsed, setCollapsed, addTask, upsertTask, removeTask, toggleDone, toggleWeek, toggleToday, selectedTaskId, setSelectedTaskId, setSelectedProject, handleDropOnProject, handleDropOnTask, moveProject, categoryTone, projectRules, selectMode }) {
  const [newTitle, setNewTitle] = useState("");
  const key = `${category}:${project}`;
  const isCollapsed = collapsed[key];
  const tone = categoryTone(category);
  const rule = projectRules?.[projectKey(category, project)];

  const { setNodeRef: projDropRef, isOver } = useDroppable({ id: `proj-drop-${category}-${project}`, data: { type: "project", category, project } });
  const { attributes: projDragAttrs, listeners: projDragListeners, setNodeRef: projDragRef, isDragging: isProjDragging } = useDraggable({ id: `proj-drag-${category}-${project}`, data: { type: "project", category, project } });

  function create(titleArg) {
    const task = addTask({ title: (titleArg ?? newTitle) || "新規タスク", category, project });
    if (task) setNewTitle("");
    return task;
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
          <AnimatePresence initial={false}>{roots.map((task, i) => <TaskCard key={task.id} listNumber={numberedIndex(roots, i)} task={task} taskMap={taskMap} children={childrenOf(task.id)} childrenOf={childrenOf} categoryTone={categoryTone} depth={0} collapsed={collapsed} setCollapsed={setCollapsed} upsertTask={upsertTask} removeTask={removeTask} toggleDone={toggleDone} toggleWeek={toggleWeek} toggleToday={toggleToday} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} handleDropOnTask={handleDropOnTask} selectMode={selectMode} />)}</AnimatePresence>
          <div className="mt-1 flex gap-1">
            <AddBlockInput
              value={newTitle}
              onChange={setNewTitle}
              onSubmit={(title) => create(title)}
              placeholder="このProjectに追加"
              className="w-full rounded border border-white/5 bg-white/[0.025] px-2 py-1 text-xs outline-none placeholder:text-neutral-700 focus:border-white/20"
            />
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
      className="fixed z-[200] min-w-[180px] rounded-xl border border-white/15 ts-surface p-1.5 shadow-2xl backdrop-blur"
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

// 編集終了と同じフレームでカードへフォーカスを戻すためのフック。
// setTimeout(0) では Enter を素早く 2 回押したとき、2 回目がフォーカス移動前に
// 届いて取りこぼされる。
// タスク1行ぶんの振る舞いをまとめたフック。
//
// PJボード・TRAY/STOCK・7days で「1行」の見た目は違うが、中身の振る舞い
// （選択・フォーカスモード・ドラッグ・インライン編集・キーボード操作）は同じ。
// ここに1つだけ持たせて、各ビューは返ってきた props を撒いて自分の装飾を足す。
//
// ビューごとに事情が違う3点だけ差し込めるようにしてある:
//   onTab           インデント/アウトデントの解決方法（兄弟の求め方が違う）
//   onDeleteEmpty   空ブロックを消したあとの行き先（7days だけ前の行を編集状態で開く）
//   dragDisabled    ドラッグを止める条件
function useTaskBlock({
  task,
  dragId,
  dragData,
  dropId,
  dropData,
  dragDisabled = false,
  upsertTask,
  removeTask,
  onTab,
  onDeleteEmpty,
  clickGuard,
  initialEditing = false,
  // 前の行から送られてきたとき、編集状態にして末尾にカーソルを置く
  autoFocusEnd = false,
  onFocusEndDone,
  // ページ本文だけ Notion と同じキー操作・クリック操作にする。
  // タスク側のビューは「クリック＝選択」「Enter 2回でブロック追加」のままにしたいので、
  // 全体を切り替えず、この旗を立てたビューだけ挙動を変える。
  notionMode = false,
  onEnterBlock,   // Enter: 直下に同じ種類のブロックを作る
  onMergeBack,    // 行頭 Backspace: 前のブロックに繋げる
  onMoveBlock,    // Alt+Shift+↑↓: 並びを入れ替える
  onDuplicate,    // Cmd+D: ブロックを複製する
}) {
  const { focusPickMode, pickTask } = useFocusMode();
  const { addBlockBelow, pendingEditId, claimPendingEdit } = useBlockEdit();
  const { selectedIds, toggleTask } = useSelection();
  const slashCtx = useSlash();

  // "/" で開くコマンドメニュー
  const sq = useSlashQuery({
    enabled: !!slashCtx,
    onPick: (cmd, rest) => {
      setEditing(false);
      // タイトルが残っていれば先に確定してからコマンドを走らせる
      if (rest && rest !== task.title) upsertTask?.({ id: task.id, title: rest });
      else if (!rest && !task.title) { removeTask?.(task.id); return; }
      cmd.run({ task, ctx: slashCtx });
    },
  });

  const cardRef = useRef(null);
  const textareaRef = useRef(null);
  const [editing, setEditing] = useState(initialEditing);
  const [draft, setDraft] = useState(initialEditing ? "" : task.title);
  const refocusCard = useRefocusAfterEdit(editing, cardRef);

  const isSelected = !!selectedIds?.has(task.id);
  const dragOff = dragDisabled || focusPickMode;

  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
    disabled: dragOff,
  });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: dropId, data: dropData });

  const setRefs = (el) => {
    dragRef(el);
    dropRef(el);
    cardRef.current = el;
  };

  // 編集していない間だけ外からの変更（他端末の同期など）を取り込む。
  // これから編集に入るブロック（pendingEditId）も対象外。さもないと
  // マウント直後のこの effect が、空にしたドラフトを placeholder で上書きしてしまう。
  useEffect(() => {
    if (editing || pendingEditId === task.id) return;
    setDraft(task.title);
  }, [task.id, task.title, editing, pendingEditId]);

  // Enter で作られた直後の空ブロックは、そのまま編集状態で開く。
  // useEffect（描画後）だと textarea が載るまでに1フレーム空き、
  // 続けて打った文字を取りこぼすので layout 相で入る。
  React.useLayoutEffect(() => {
    if (pendingEditId !== task.id) return;
    if (!claimPendingEdit?.(task.id)) return;
    setEditing(true);
    setDraft("");
  }, [pendingEditId, task.id]);

  useEffect(() => {
    if (!autoFocusEnd) return;
    setEditing(true);
    setDraft(task.title);
    onFocusEndDone?.();
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) { el.focus(); focusEnd(el); }
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocusEnd]);

  // ページ本文は打っている最中も保存する。確定が離脱時だけだと、
  // 書いている途中でリロードすると消えてしまい Notion と違う。
  // 毎打鍵だと履歴が細かくなりすぎるので、少し止まってから書く。
  useEffect(() => {
    if (!notionMode || !editing) return;
    if (normalizeBlockText(draft) === task.title) return;
    const id = setTimeout(() => {
      const clean = normalizeBlockText(draft);
      if (clean !== task.title) upsertTask?.({ id: task.id, title: clean });
    }, 400);
    return () => clearTimeout(id);
  }, [draft, editing, notionMode, task.id, task.title]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit() {
    const clean = notionMode ? normalizeBlockText(draft) : normalizeTitle(draft);
    if (!clean) return false; // 空 → 呼び出し側が削除を決める
    if (clean !== task.title) upsertTask?.({ id: task.id, title: clean });
    return true;
  }

  function removeAndLeave() {
    const cur = cardRef.current;
    setEditing(false);
    // onDeleteEmpty は「前の行」を一覧から引くので、消す前に呼ぶ
    if (onDeleteEmpty) {
      onDeleteEmpty(task.id, cur);
      removeTask?.(task.id);
    } else {
      removeTask?.(task.id);
      setTimeout(() => focusAdjacentBlock(cur, -1), 0);
    }
  }

  // カードにフォーカスがある状態でのキー操作（Notion のブロック選択に相当）
  function onCardKeyDown(e) {
    if (editing || focusPickMode) return;
    if (e.key === "Enter") {
      e.preventDefault();
      addBlockBelow?.(task);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      focusAdjacentBlock(e.currentTarget, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    // 印字可能文字でそのまま編集開始。
    // preventDefault しないと、直後に開く textarea にも同じ文字が入って重複する。
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setDraft(e.key);
      setEditing(true);
    }
  }

  function onTextareaKeyDown(e) {
    // メニューが開いている間はそちらの操作を優先する
    if (sq.handleKeyDown(e, draft)) return;

    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

    // Alt+Shift+↑↓ でブロックの並びを入れ替える（Notion と同じ）
    if (notionMode && e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      // 確定と並べ替えを別々に書くと、後の書き込みが確定前の状態を元にして
      // タイトルを巻き戻すので、まとめて渡す
      onMoveBlock?.(task, e.key === "ArrowUp" ? -1 : 1, normalizeBlockText(draft));
      return;
    }
    // Cmd/Ctrl+B / I / E で選択範囲を装飾する（Notion と同じ割り当て）
    if (notionMode && (e.metaKey || e.ctrlKey) && ["b", "i", "e"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const mark = { b: "**", i: "*", e: "`" }[e.key.toLowerCase()];
      const el2 = e.currentTarget;
      const [a, z] = [el2.selectionStart, el2.selectionEnd];
      if (a === z) return;
      const next = draft.slice(0, a) + mark + draft.slice(a, z) + mark + draft.slice(z);
      setDraft(next);
      setTimeout(() => { el2.setSelectionRange(a + mark.length, z + mark.length); }, 0);
      return;
    }
    // Cmd/Ctrl+D でブロックを複製する
    if (notionMode && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      onDuplicate?.(task, normalizeBlockText(draft));
      return;
    }
    // Cmd/Ctrl+Enter で完了を切り替える
    if (notionMode && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      slashCtx?.toggleDone?.(task);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (notionMode) {
        // 空のリスト項目で Enter → リストを抜けてテキストに戻る
        const kind = blockTypeOf(task);
        if (!normalizeBlockText(draft) && kind !== "text" && kind !== "task") {
          slashCtx?.setBlockType?.(task, "text");
          return;
        }
        commit();
        onEnterBlock?.(task, draft);
        return;
      }
      // 空のまま確定したブロックは残さない
      if (!normalizeTitle(draft)) { removeAndLeave(); return; }
      commit();
      // カードにフォーカスを戻す → もう一度 Enter で下にブロック追加
      refocusCard.current = true;
      setEditing(false);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (notionMode) {
        // Notion は Escape で「ブロックを選択した状態」に抜ける。
        // ここで止めないと、同じネイティブイベントが window まで届いて
        // 「Esc で選択解除」が直後に走り、選択が消えてしまう。
        e.stopPropagation();
        e.nativeEvent?.stopImmediatePropagation?.();
        commit();
        refocusCard.current = true;
        setEditing(false);
        toggleTask?.(task.id);
        return;
      }
      setDraft(task.title);
      setEditing(false);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (notionMode && e.key === "Backspace" && atStart) {
        const kind = blockTypeOf(task);
        // まず種類をテキストに戻し、それから前のブロックに繋げる
        if (kind !== "text" && kind !== "task") {
          e.preventDefault();
          // 種類とタイトルを1回で書く。別々だと、まだ保存していない
          // 打ちかけの文字が種類変更の書き込みに巻き込まれて消える。
          upsertTask?.({ id: task.id, blockType: "text", title: normalizeBlockText(draft) });
          return;
        }
        e.preventDefault();
        onMergeBack?.(task, draft);
        return;
      }
      if (!el.value) {
        e.preventDefault();
        removeAndLeave();
        return;
      }
    }
    // 端で上下キーを押したら隣のブロックへ移る（編集したまま）
    if (notionMode && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const leaving = e.key === "ArrowUp" ? atStart : atEnd;
      if (leaving) {
        e.preventDefault();
        commit();
        const cur = cardRef.current;
        setEditing(false);
        setTimeout(() => {
          const next = focusAdjacentBlock(cur, e.key === "ArrowUp" ? -1 : 1);
          next?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }, 0);
        return;
      }
    }
    if (e.key === "Tab" && onTab) {
      e.preventDefault();
      e.stopPropagation();
      onTab(e, { draft, setEditing });
    }
  }

  const blockProps = {
    ref: setRefs,
    "data-task-id": task.id,
    tabIndex: editing ? -1 : 0,
    onKeyDown: onCardKeyDown,
    onClick: () => {
      if (clickGuard?.()) return;
      if (focusPickMode) { pickTask?.(task.id); return; }
      if (editing) return;
      // ページ本文はクリックでそのまま書き始められる（選択ではなく編集）
      if (notionMode) { setEditing(true); return; }
      toggleTask?.(task.id);
    },
    ...(dragOff ? {} : attributes),
    ...(dragOff ? {} : listeners),
  };

  const textareaProps = {
    autoFocus: true,
    rows: 1,
    value: draft,
    ref: (el) => { textareaRef.current = el; autoResize(el); },
    onFocus: (e) => focusEnd(e.target),
    onChange: (e) => {
      const v = e.target.value;
      // 行頭の "# " や "- " はその場で種別に変える（Notion と同じ）
      const md = slashCtx && matchMarkdownPrefix(v);
      if (md) {
        setDraft("");
        slashCtx.setBlockType(task, md.key);
        return;
      }
      setDraft(v);
      autoResize(e.target);
      sq.detect(v, e.target.selectionStart);
    },
    onKeyDown: onTextareaKeyDown,
    onClick: (e) => e.stopPropagation(),
    onPointerDown: (e) => e.stopPropagation(),
    onMouseDown: (e) => e.stopPropagation(),
  };

  // メニューを開いたまま外れたら閉じる
  useEffect(() => { if (!editing && sq.slash) sq.setSlash(null); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const titleProps = {
    onDoubleClick: (e) => { if (focusPickMode) return; e.stopPropagation(); setEditing(true); },
    style: taskTextStyle(task),
  };
  // Notion では Enter でも編集に入れる（選択状態からの復帰）
  const notionEditable = notionMode;

  // フォーカスモード中に付ける目印（全ビュー共通）
  const focusRingClass = focusPickMode && "cursor-crosshair ring-1 ring-amber-400/25 hover:ring-2 hover:ring-amber-400/70";

  return {
    editing, setEditing, draft, setDraft,
    isSelected, isDragging, isOver, focusPickMode,
    cardRef, textareaRef,
    blockProps, textareaProps, titleProps, focusRingClass,
    commit, removeAndLeave,
    addBelow: () => addBlockBelow?.(task),
    notionMode,
    slash: sq.slash, slashMatches: sq.matches,
    runSlash: (cmd) => sq.pick(cmd, draft),
  };
}

// "/" で開くコマンドメニュー。編集中の textarea の直下に出す。
function SlashMenu({ slash, matches, onPick }) {
  const slashMatches = matches;
  const runSlash = onPick;
  if (!slashMatches.length) {
    return (
      <div className="absolute left-0 top-full z-[120] mt-1 w-56 rounded-lg border border-white/15 ts-surface p-2 text-[11px] text-neutral-500 shadow-2xl">
        該当なし
      </div>
    );
  }
  return (
    <div className="absolute left-0 top-full z-[120] mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-white/15 ts-surface p-1 shadow-2xl">
      {slashMatches.map((cmd, i) => (
        <button
          key={cmd.key}
          // blur より先に拾わないとメニューが閉じてしまう
          onMouseDown={(e) => { e.preventDefault(); runSlash(cmd); }}
          className={classNames(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition",
            i === slash.index ? "bg-white/15 ts-text" : "text-neutral-300 hover:bg-white/[0.07]",
            cmd.danger && "text-red-300",
          )}
        >
          {cmd.swatch
            ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cmd.swatch }} />
            : <span className="h-2.5 w-2.5 shrink-0" />}
          <span className="min-w-0 flex-1 truncate font-medium">{cmd.label}</span>
          <span className="shrink-0 text-[9px] text-neutral-600">{cmd.hint}</span>
        </button>
      ))}
    </div>
  );
}

// 列末尾の「追加…」欄。ここでも "/" でコマンドを出せるようにして、
// 「書きながら仕分ける」流れをブロックの中と揃える。
function AddBlockInput({ value, onChange, onSubmit, placeholder, className, inputRef }) {
  const slashCtx = useSlash();
  const sq = useSlashQuery({
    enabled: !!slashCtx,
    onPick: (cmd, rest) => {
      // 残りの文字列でタスクを作ってから、そのタスクにコマンドを当てる。
      // 作成とコマンドを同じ tick で書くと、後の書き込みが作成前の状態を
      // 元にしてしまい無視されるので、1フレーム空ける。
      const created = onSubmit(rest || "新規タスク");
      onChange("");
      if (created) setTimeout(() => cmd.run({ task: created, ctx: slashCtx }), 0);
    },
  });

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); sq.detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (sq.handleKeyDown(e, value)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            if (value.trim()) { onSubmit(value.trim()); onChange(""); }
          }
        }}
        onBlur={() => { if (!sq.slash) sq.setSlash(null); }}
        placeholder={placeholder}
        className={className}
      />
      {sq.slash && <SlashMenu slash={sq.slash} matches={sq.matches} onPick={(cmd) => sq.pick(cmd, value)} />}
    </div>
  );
}

// ページ本文の1ブロック。Notion の本文行に合わせて、列ビューより少し大きめ。
function PageBlock({ task, depth, childrenOf, listNumber, upsertTask, removeTask, toggleDone, setSelectedTaskId, siblings, idx, ops, collapsedSet, onToggleCollapse }) {
  const children = childrenOf?.(task.id) || [];
  // トグルは閉じている間、子を隠す
  const isCollapsed = blockTypeOf(task) === "toggle" && collapsedSet?.has(task.id);
  return (
    <div style={depth > 0 ? { marginLeft: depth * 24 } : undefined}>
      <TaskBlock
        task={task}
        listNumber={listNumber}
        dragId={`page-${task.id}`}
        dragData={{ type: "task", id: task.id }}
        dropId={`page-drop-${task.id}`}
        dropData={{ type: "task", id: task.id }}
        upsertTask={upsertTask}
        removeTask={removeTask}
        setSelectedTaskId={setSelectedTaskId}
        notionMode
        collapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        onEnterBlock={(t, draft) => ops.enterBlock(t, draft, siblings, idx)}
        onMergeBack={(t, draft) => ops.mergeBack(t, draft, siblings, idx)}
        onMoveBlock={(t, dir, title) => ops.moveBlock(t, dir, siblings, idx, title)}
        onDuplicate={(t, title) => ops.duplicate(t, title)}
        onTab={(e, { draft }) => {
          // 確定と親子変更を1回で書く。別々だと、後の書き込みが確定前の
          // 状態を元にしてタイトルを巻き戻す。
          const title = normalizeBlockText(draft);
          if (e.shiftKey) upsertTask({ id: task.id, title, parentId: null });
          else if (idx > 0) upsertTask({ id: task.id, title, parentId: siblings[idx - 1].id });
          else upsertTask({ id: task.id, title });
        }}
        rowClassName={(b) => classNames(
          "rounded px-1 py-[3px] transition hover:bg-white/[0.035]",
          b.focusRingClass,
          b.isSelected && "bg-sky-500/[0.12] ring-1 ring-inset ring-sky-400/40",
          b.isDragging && "opacity-30",
          b.isOver && "ring-1 ring-inset ring-white/20",
        )}
        textareaClassName={() => "w-full resize-none overflow-hidden bg-transparent text-[14px] leading-relaxed ts-text outline-none"}
        titleClassName={(b) => classNames(
          "min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-[14px] leading-relaxed ts-text",
          b.focusPickMode ? "cursor-crosshair" : "cursor-text",
          task.status === "完了" && "line-through opacity-40",
        )}
        leading={() => (
          <button
            onClick={(e) => { e.stopPropagation(); toggleDone(task); }}
            className={classNames("mt-1 shrink-0 transition", task.status === "完了" ? "text-emerald-400" : "text-neutral-600 hover:text-neutral-300")}
          >
            {task.status === "完了" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          </button>
        )}
      />
      {!isCollapsed && children.map((child, i) => (
        <PageBlock
          key={child.id}
          task={child}
          depth={depth + 1}
          idx={i}
          siblings={children}
          listNumber={numberedIndex(children, i)}
          childrenOf={childrenOf}
          upsertTask={upsertTask}
          removeTask={removeTask}
          toggleDone={toggleDone}
          setSelectedTaskId={setSelectedTaskId}
          ops={ops}
          collapsedSet={collapsedSet}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </div>
  );
}

// ドキュメント型のページ。左にページ一覧、右に本文。
// 本文は同じ TaskBlock なので、種別もコマンドもそのまま使える。
function PagesView({ pages, onPagesChange, tasks, upsertTask, removeTask, toggleDone, setSelectedTaskId, childrenOf, addTask, onReorder, onMergeBlocks }) {
  const { markForEdit } = useBlockEdit();
  // トグルの開閉は見た目の設定なので端末内だけに持つ
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("taskspace-page-collapsed") || "[]")); }
    catch { return new Set(); }
  });
  const toggleCollapse = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("taskspace-page-collapsed", JSON.stringify([...next])); } catch { /* quota */ }
      return next;
    });
  }, []);
  const [activeId, setActiveId] = useState(() => localStorage.getItem("taskspace-active-page") || pages[0]?.id);
  const active = pages.find((p) => p.id === activeId) || pages[0];
  const [iconOpen, setIconOpen] = useState(false);

  useEffect(() => {
    if (active) localStorage.setItem("taskspace-active-page", active.id);
  }, [active]);

  const blocks = useMemo(() => {
    if (!active) return [];
    const order = new Map(tasks.map((t, i) => [t.id, i]));
    return tasks
      .filter((t) => t.pageId === active.id && !t.archived && !t.parentId)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [tasks, active]);

  // Notion のブロック操作。並びは tasks の配列順なので、入れ替えもそこを動かす。
  const ops = useMemo(() => ({
    // Enter: 直下に同じ種類のブロックを作って、そのまま書き続けられるようにする
    enterBlock: (task) => {
      const kind = blockTypeOf(task);
      const created = addTask({
        title: "",
        allowEmpty: true,
        plain: true,
        pageId: task.pageId,
        parentId: task.parentId || null,
        blockType: kind === "heading1" || kind === "heading2" || kind === "heading3" || kind === "callout" || kind === "quote" ? "text" : kind,
        afterId: task.id,
        silent: true,
      });
      if (created) markForEdit?.(created.id);
    },
    // 行頭 Backspace: 前のブロックの末尾に文字を足して、自分は消える
    mergeBack: (task, draft, siblings, idx) => {
      const prev = siblings[idx - 1];
      if (!prev) return;
      onMergeBlocks(prev.id, task.id, (prev.title || "") + (draft || ""));
    },
    // Cmd+D: 同じ内容のブロックを直下に作る
    duplicate: (task, title) => {
      const created = addTask({
        title: title || task.title || "",
        allowEmpty: true,
        plain: true,
        pageId: task.pageId,
        parentId: task.parentId || null,
        blockType: blockTypeOf(task),
        afterId: task.id,
        silent: true,
      });
      if (created) markForEdit?.(created.id);
    },
    // Alt+Shift+↑↓: 並びを入れ替える
    moveBlock: (task, dir, siblings, idx, title) => {
      const target = siblings[idx + dir];
      if (!target) return;
      onReorder(task.id, target.id, title);
    },
  }), [addTask, upsertTask, removeTask, markForEdit, onReorder, onMergeBlocks]);

  function addPage() {
    const page = { id: `page-${uid()}`, title: "無題のページ", icon: PAGE_ICONS[pages.length % PAGE_ICONS.length] };
    onPagesChange([...pages, page]);
    setActiveId(page.id);
  }

  function removePage(id) {
    if (pages.length <= 1) return;
    // 中のブロックも一緒に消える。ページ＝本文なので残しても行き場がない。
    tasks.filter((t) => t.pageId === id).forEach((t) => removeTask(t.id));
    onPagesChange(pages.filter((p) => p.id !== id));
    if (activeId === id) setActiveId(pages.find((p) => p.id !== id).id);
  }

  function addBlockAtEnd() {
    const last = blocks[blocks.length - 1];
    if (last && !last.title.trim()) return; // 末尾が空なら増やさない
    const created = addTask({ title: "", allowEmpty: true, plain: true, pageId: active.id, silent: true, afterId: last?.id });
    if (created) markForEdit?.(created.id);
  }

  if (!active) return null;

  return (
    <div className="flex gap-3" style={{ minHeight: "calc(100vh - 150px)" }}>
      {/* ページ一覧 */}
      <aside className="w-48 shrink-0 rounded-lg border border-white/10 bg-white/[0.02] p-2">
        <div className="mb-1 px-1 text-[10px] font-semibold text-neutral-500">ページ</div>
        {pages.map((p) => (
          <div key={p.id} className="group/pg flex items-center gap-1">
            <button
              onClick={() => setActiveId(p.id)}
              className={classNames(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition",
                p.id === active.id ? "bg-white/10 ts-text" : "text-neutral-400 hover:bg-white/[0.06]",
              )}
            >
              <span className="shrink-0">{p.icon}</span>
              <span className="min-w-0 truncate">{p.title}</span>
            </button>
            {pages.length > 1 && (
              <button
                onClick={() => removePage(p.id)}
                title="このページを削除（中身も消えます）"
                className="shrink-0 rounded p-0.5 text-neutral-600 opacity-0 transition hover:text-red-300 group-hover/pg:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addPage}
          className="mt-1 flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-neutral-500 transition hover:bg-white/[0.06] hover:text-neutral-300"
        >
          <Plus className="h-3 w-3" /> 新規ページ
        </button>
      </aside>

      {/* 本文 */}
      <div className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.02] px-6 py-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-start gap-2">
            <div className="relative">
              <button onClick={() => setIconOpen((v) => !v)} title="アイコンを変える" className="text-3xl leading-none transition hover:opacity-70">
                {active.icon}
              </button>
              {iconOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 flex w-44 flex-wrap gap-1 rounded-lg border border-white/15 ts-surface p-2 shadow-2xl">
                  {PAGE_ICONS.map((ic) => (
                    <button
                      key={ic}
                      onClick={() => { onPagesChange(pages.map((p) => p.id === active.id ? { ...p, icon: ic } : p)); setIconOpen(false); }}
                      className="rounded p-1 text-lg transition hover:bg-white/10"
                    >{ic}</button>
                  ))}
                </div>
              )}
            </div>
            <input
              value={active.title}
              onChange={(e) => onPagesChange(pages.map((p) => p.id === active.id ? { ...p, title: e.target.value } : p))}
              placeholder="無題"
              className="min-w-0 flex-1 bg-transparent text-3xl font-bold tracking-tight ts-text outline-none placeholder:text-neutral-700"
            />
          </div>

          <div className="flex flex-col">
            {blocks.map((task, i) => (
              <PageBlock
                key={task.id}
                task={task}
                depth={0}
                idx={i}
                siblings={blocks}
                listNumber={numberedIndex(blocks, i)}
                childrenOf={childrenOf}
                upsertTask={upsertTask}
                removeTask={removeTask}
                toggleDone={toggleDone}
                setSelectedTaskId={setSelectedTaskId}
                ops={ops}
                collapsedSet={collapsed}
                onToggleCollapse={toggleCollapse}
              />
            ))}
          </div>

          {/* 本文の下の空き。クリックで末尾にブロックを足す（Notion と同じ） */}
          <div
            onClick={addBlockAtEnd}
            className="mt-1 min-h-[40vh] cursor-text pt-2 text-[13px] text-neutral-700"
          >
            {blocks.length === 0 && "クリックして書き始める。/ でコマンド。"}
          </div>
        </div>
      </div>
    </div>
  );
}

// キャンバス上の1ブロック。位置は task に持たせ、移動は素の pointer で行う。
// 列ビューの dnd-kit は「どこに落としたか」で意味が決まるが、ここは座標そのものが
// 意味なので、同じ仕組みに載せないほうが素直。
function CanvasBlock({ task, scale, onMove, ...rest }) {
  const dragging = useRef(null);

  function onPointerDown(e) {
    // 左ボタンのみ。テキスト編集やボタンの操作は邪魔しない。
    if (e.button !== 0) return;
    if (e.target.closest("textarea,button,input,a")) return;
    dragging.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: task.canvasX, oy: task.canvasY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation(); // 背景のパンを開始させない
  }
  function onPointerMove(e) {
    const d = dragging.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;
    onMove(task.id, Math.round(d.ox + dx), Math.round(d.oy + dy));
  }
  function onPointerUp(e) {
    const d = dragging.current;
    dragging.current = null;
    if (d?.moved) {
      // 移動だったらクリック扱いにしない（選択が走らないように）
      e.stopPropagation();
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      e.currentTarget.addEventListener("click", stop, { capture: true, once: true });
    }
  }

  return (
    <div
      className="absolute w-[260px]"
      style={{ left: task.canvasX, top: task.canvasY }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="rounded-md border border-white/10 ts-bg-veil px-1 py-0.5 shadow-lg backdrop-blur">
        <TaskBlock task={task} {...rest} />
      </div>
    </div>
  );
}

// 自由配置のキャンバス。列に縛られずブロックを置ける。
// 背景ドラッグでパン、Ctrl+ホイールで拡大縮小、空き場所のダブルクリックで新規ブロック。
function CanvasView({ tasks, upsertTask, removeTask, toggleDone, setSelectedTaskId, selectedTaskId, childrenOf, addTask }) {
  const [view, setView] = useState(() => {
    try {
      const raw = localStorage.getItem("taskspace-canvas-view");
      return raw ? JSON.parse(raw) : { x: 0, y: 0, scale: 1 };
    } catch { return { x: 0, y: 0, scale: 1 }; }
  });
  const panRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("taskspace-canvas-view", JSON.stringify(view)); } catch { /* quota */ }
  }, [view]);

  const placed = tasks.filter((t) => !t.archived && t.canvasX != null && t.canvasY != null);

  // 画面座標 → キャンバス座標
  function toCanvas(clientX, clientY) {
    const r = wrapRef.current.getBoundingClientRect();
    return {
      x: Math.round((clientX - r.left - view.x) / view.scale),
      y: Math.round((clientY - r.top - view.y) / view.scale),
    };
  }

  function onPointerDown(e) {
    if (e.button !== 0 || e.target.closest("[data-task-id]")) return;
    panRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const p = panRef.current;
    if (!p || p.id !== e.pointerId) return;
    setView((v) => ({ ...v, x: p.vx + (e.clientX - p.x), y: p.vy + (e.clientY - p.y) }));
  }
  function onPointerUp() { panRef.current = null; }

  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const next = Math.min(2.5, Math.max(0.3, v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      // ポインタ位置を固定したまま拡大縮小する
      return { scale: next, x: mx - (mx - v.x) * (next / v.scale), y: my - (my - v.y) * (next / v.scale) };
    });
  }

  function onDoubleClick(e) {
    if (e.target.closest("[data-task-id]")) return;
    const at = toCanvas(e.clientX, e.clientY);
    addTask({ title: "新規ブロック", plain: true, canvasX: at.x, canvasY: at.y, silent: true });
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10" style={{ height: "calc(100vh - 150px)" }}>
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-2 text-[10px] text-neutral-500">
        <span>{placed.length} ブロック</span>
        <span>·</span>
        <span>{Math.round(view.scale * 100)}%</span>
        <span>·</span>
        <span>背景ドラッグで移動 / Ctrl+ホイールで拡大 / ダブルクリックで追加</span>
      </div>
      <button
        onClick={() => setView({ x: 0, y: 0, scale: 1 })}
        className="absolute right-2 top-2 z-10 rounded border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] text-neutral-400 hover:bg-white/10"
      >位置をリセット</button>

      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        data-canvas
        className="h-full w-full cursor-grab active:cursor-grabbing"
        style={{
          backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--ts-text) 12%, transparent) 1px, transparent 1px)",
          backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {placed.map((task, i) => (
            <CanvasBlock
              key={task.id}
              task={task}
              listNumber={numberedIndex(placed, i)}
              scale={view.scale}
              onMove={(id, x, y) => upsertTask({ id, canvasX: x, canvasY: y })}
              upsertTask={upsertTask}
              removeTask={removeTask}
              setSelectedTaskId={setSelectedTaskId}
              dragDisabled
              dragId={`canvas-${task.id}`}
              dragData={{ type: "task", id: task.id }}
              dropId={`canvas-drop-${task.id}`}
              dropData={{ type: "task", id: task.id }}
              rowClassName={(b) => classNames(
                "rounded px-1 py-0.5 transition",
                b.focusRingClass,
                b.isSelected && "bg-sky-500/[0.12] ring-1 ring-inset ring-sky-400/40",
              )}
              textareaClassName={() => "w-full resize-none overflow-hidden rounded border-b border-white/25 bg-transparent text-[12.5px] font-medium ts-text outline-none"}
              titleClassName={(b) => classNames(
                "min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-[12.5px] ts-text",
                b.focusPickMode ? "cursor-crosshair" : "cursor-pointer",
                task.status === "完了" && "line-through opacity-40",
              )}
              leading={() => (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleDone(task); }}
                  className={classNames("mt-0.5 shrink-0 transition", task.status === "完了" ? "text-emerald-400" : "text-neutral-600 hover:text-neutral-300")}
                >
                  {task.status === "完了" ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                </button>
              )}

            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ブロック左端の操作列（Notion の + と ⠿）。ホバーで出る。
// 場所は常に確保しておく。出入りで幅が変わると行がガタつくため。
function BlockGutter({ block, compact }) {
  return (
    <div
      className={classNames(
        "flex shrink-0 items-center self-start pt-0.5 opacity-0 transition group-hover/block:opacity-60 focus-within:opacity-60",
        compact ? "w-[14px]" : "w-[26px]",
      )}
    >
      {!compact && (
        <button
          onClick={(e) => { e.stopPropagation(); block.addBelow(); }}
          title="下にブロックを追加"
          className="rounded p-px text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {/* 行全体がドラッグできるので、ここは掴む位置の目印。
          クリックは止めて選択が走らないようにする。 */}
      <span
        onClick={(e) => e.stopPropagation()}
        title="ドラッグで移動"
        className="cursor-grab rounded p-px text-neutral-500 hover:text-neutral-200"
      >
        <GripVertical className="h-3 w-3" />
      </span>
    </div>
  );
}

// タスク1行。ビューごとに違うのは飾り（左のボタン類・チップ・下の補助行）だけなので、
// それだけをスロットで受け取り、行そのもの（枠・タイトル・インライン編集）はここが持つ。
// スロットは useTaskBlock の戻り値 b を受け取る関数で、選択状態などに応じて描き分けられる。
function TaskBlock({
  rowClassName,
  titleClassName,
  textareaClassName,
  titleWrapperClassName,
  leading,
  meta,
  trailing,
  titleExtra,
  extraProps,
  titleAttrs,
  setSelectedTaskId,
  onEmptyBlur,
  compactGutter = false,
  listNumber,
  collapsed = false,
  onToggleCollapse,
  ...blockOptions
}) {
  const b = useTaskBlock(blockOptions);
  const task = blockOptions.task;
  const kind = blockTypeOf(task);
  // Notion はフォーカス中の空ブロックにだけヒントを出す
  const draftPlaceholder = b.draft ? "" : (b.notionMode ? "「/」でコマンド" : "コマンドは / または ；");
  const cfg = BLOCK_TYPES[kind];

  // 区切り線は本文を持たない。選択とドラッグはできるので行そのものは残す。
  if (kind === "divider") {
    return (
      <div
        {...b.blockProps}
        {...extraProps}
        className={classNames(
          "group/block flex items-center gap-1 px-1.5 py-1.5 outline-none",
          b.focusRingClass,
          b.isSelected && "rounded bg-sky-500/[0.12] ring-1 ring-inset ring-sky-400/40",
          b.isDragging && "opacity-30",
        )}
      >
        <BlockGutter block={b} compact={compactGutter} />
        <span className="h-px w-full shrink-0 bg-current opacity-40" />
      </div>
    );
  }

  return (
    <div
      {...b.blockProps}
      {...extraProps}
      className={classNames(
        "group/block",
        rowClassName?.(b),
        cfg.callout && "border-l-2 border-l-amber-300/50 bg-amber-300/[0.05]",
        cfg.quote && "border-l-2 border-l-current/30 pl-2 opacity-80",
        cfg.code && "rounded border border-white/10 bg-black/30 font-mono",
      )}
    >
      <div className="flex w-full min-w-0 items-start gap-1.5">
        <BlockGutter block={b} compact={compactGutter} />
        {cfg.toggle && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(task.id); }}
            title={collapsed ? "開く" : "閉じる"}
            className="mt-0.5 shrink-0 text-neutral-500 transition hover:text-neutral-200"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
        {cfg.marker && <span className="mt-0.5 shrink-0 text-[11px] leading-none">{cfg.marker}</span>}
        {cfg.numbered && <span className="mt-0.5 shrink-0 text-[11px] leading-none tabular-nums opacity-60">{listNumber ?? 1}.</span>}
        {cfg.checkbox && leading?.(b)}
        <div className="min-w-0 flex-1">
          {b.editing ? (
            <div className="relative">
              <textarea
                {...b.textareaProps}
                placeholder={draftPlaceholder}
                onBlur={() => {
                  // メニュー操作でフォーカスが外れただけのときは閉じない
                  if (b.slash) return;
                  // 空のまま離れたブロックの扱いはビュー次第。
                  // ページ本文は Notion と同じく空行を残す。
                  if (!b.commit() && !b.notionMode && onEmptyBlur) onEmptyBlur();
                  b.setEditing(false);
                }}
                className={textareaClassName?.(b)}
                style={cfg.size ? { fontSize: cfg.size, fontWeight: cfg.weight } : undefined}
              />
              {b.slash && <SlashMenu slash={b.slash} matches={b.slashMatches} onPick={b.runSlash} />}
            </div>
          ) : (
            <div className="flex min-w-0 items-start gap-1 group/title">
              <div className={titleWrapperClassName || "min-w-0 flex-1"}>
                <div
                  {...b.titleProps}
                  {...titleAttrs?.(b)}
                  className={titleClassName?.(b)}
                  style={{ ...b.titleProps.style, ...(cfg.size ? { fontSize: cfg.size, fontWeight: cfg.weight, letterSpacing: "0.01em" } : null) }}
                >
                  {task.title
                    ? (b.notionMode ? renderBlockText(task.title) : task.title)
                    : <span className="opacity-25">&nbsp;</span>}
                </div>
                {titleExtra?.(b)}
              </div>
              {setSelectedTaskId && (
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }}
                  title="詳細を開く"
                  className="shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-100 transition text-neutral-500 hover:text-neutral-300"
                >
                  <Info className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {meta?.(b)}
        </div>
        {trailing?.(b)}
      </div>
    </div>
  );
}

function useRefocusAfterEdit(editing, cardRef) {
  const pending = useRef(false);
  React.useLayoutEffect(() => {
    if (!editing && pending.current) {
      pending.current = false;
      cardRef.current?.focus();
    }
  }, [editing, cardRef]);
  return pending;
}

// 本文のインライン装飾。**太字** *斜体* `コード` ~打ち消し~ と、URL の自動リンク。
// 編集中は記法のまま見せて、確定表示のときだけ組む（軽量なマークダウン表示）。
const INLINE_RULES = [
  { re: /\*\*([^*]+)\*\*/g, render: (t, k) => <strong key={k}>{t}</strong> },
  { re: /(?<!\*)\*([^*\n]+)\*(?!\*)/g, render: (t, k) => <em key={k}>{t}</em> },
  { re: /`([^`\n]+)`/g, render: (t, k) => <code key={k} className="rounded bg-white/10 px-1 py-px text-[0.9em]">{t}</code> },
  { re: /~([^~\n]+)~/g, render: (t, k) => <s key={k} className="opacity-60">{t}</s> },
  { re: /(https?:\/\/[^\s]+)/g, render: (t, k) => (
      <a key={k} href={t} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:opacity-80" onClick={(e) => e.stopPropagation()}>{t}</a>
    ) },
];

function renderInline(text) {
  if (!text) return text;
  // 一番早く現れた記法から順に切り出していく
  let rest = text;
  const out = [];
  let key = 0;
  let guard = 0;
  while (rest && guard++ < 200) {
    let best = null;
    for (const rule of INLINE_RULES) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { rule, m };
    }
    if (!best) break;
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m[1], key++));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  if (rest) out.push(rest);
  return out.length ? out : text;
}

// Shift+Enter の改行を保った表示
function renderBlockText(text) {
  const lines = String(text ?? "").split("\n");
  return lines.map((line, i) => (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      {renderInline(line)}
    </React.Fragment>
  ));
}

// #rrggbb の相対輝度（0=黒, 1=白）
function relativeLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// タスク個別の見た目（色・太さ）を style 属性に落とす
function taskTextStyle(task) {
  const st = task?.style;
  if (!st) return undefined;
  const out = {};
  if (st.color) out.color = st.color;
  if (st.bold) out.fontWeight = 700;
  return Object.keys(out).length ? out : undefined;
}

function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}
function focusEnd(el) {
  if (!el) return;
  const len = el.value.length;
  el.setSelectionRange(len, len);
}

function TaskCard({ task, listNumber, taskMap, categoryTone, children = [], childrenOf, depth, collapsed, setCollapsed, upsertTask, removeTask, toggleDone, toggleWeek, toggleToday, selectedTaskId, setSelectedTaskId, handleDropOnTask, moveWeeklyTask, compact = false, projectsByCategory, categories, selectMode = false }) {
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed[task.id];
  const selected = selectedTaskId === task.id;
  const parent = task.parentId && taskMap ? taskMap.get(task.parentId) : null;
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const longPressTimer = useRef(null);
  const longPressActive = useRef(false);

  // Today/Weekly の縮小カードは並べ替え先を区別する必要があるので drop type を変える
  const dropType = compact
    ? (schedIsToday(task, toDateKey(new Date())) ? "task-in-today" : "task-in-weekly")
    : "task";


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

  function cancelLongPress() {
    clearTimeout(longPressTimer.current);
    window.__taskspaceLongPressCancel = null;
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
      <TaskBlock
        task={task}
        listNumber={listNumber}
        dragId={`task-${task.id}`}
        dragData={{ type: "task", id: task.id, category: task.category, project: task.project, parentId: task.parentId }}
        dropId={`task-drop-${task.id}`}
        dropData={{ type: dropType, id: task.id, category: task.category, project: task.project }}
        dragDisabled={selectMode}
        upsertTask={upsertTask}
        removeTask={removeTask}
        setSelectedTaskId={setSelectedTaskId}
        // 長押しメニューを出したときはクリック扱いにしない
        clickGuard={() => longPressActive.current}
        // このビューだけ、兄弟を並び順から引いて親子を決める
        onTab={(e, { draft, setEditing }) => {
          const titleClean = normalizeTitle(draft);
          const titlePatch = titleClean && titleClean !== task.title ? { title: titleClean } : {};
          const patchOnly = () => { if (Object.keys(titlePatch).length) upsertTask({ id: task.id, ...titlePatch }); };
          if (e.shiftKey) {
            if (task.parentId) upsertTask({ id: task.id, ...titlePatch, parentId: taskMap.get(task.parentId)?.parentId ?? null });
            else patchOnly();
          } else if (depth < 3) {
            const siblings = [...taskMap.values()]
              .filter((t) => !t.archived && t.parentId === (task.parentId ?? null) && t.category === task.category && t.project === task.project)
              .sort((x, y) => {
                const xo = typeof x.sortOrder === "number" ? x.sortOrder : 999999;
                const yo = typeof y.sortOrder === "number" ? y.sortOrder : 999999;
                return xo !== yo ? xo - yo : x.title.localeCompare(y.title, "ja");
              });
            const prevSibling = siblings[siblings.findIndex((t) => t.id === task.id) - 1];
            if (prevSibling) upsertTask({ id: task.id, ...titlePatch, parentId: prevSibling.id });
            else patchOnly();
          } else {
            patchOnly();
          }
          setEditing(false);
        }}
        extraProps={{
          onPointerDown: handlePointerDown,
          onPointerUp: cancelLongPress,
          onPointerMove: cancelLongPress,
          onContextMenu: (e) => e.preventDefault(),
          "data-draggable": true,
          style: { userSelect: "none", WebkitUserSelect: "none" },
        }}
        rowClassName={(b) => classNames(
          "group rounded-md border px-1.5 py-1 transition",
          b.isSelected ? "border-sky-400/40 bg-sky-500/[0.08]" : selected ? "border-white/35 bg-white/[0.07]" : b.isOver ? "border-white/25 bg-white/[0.06]" : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.045]",
          b.focusRingClass,
          task.status === "完了" && "mt-1 border-t border-t-white/25 pt-2 opacity-45",
          b.isDragging && "opacity-40",
        )}
        textareaClassName={() => classNames(
          "w-full resize-none overflow-hidden rounded border border-white/15 bg-black/30 px-1 py-0.5 text-[12.5px] font-medium leading-[1.35] outline-none focus:border-white/35",
          task.status === "完了" && "line-through",
        )}
        titleClassName={(b) => classNames(
          "min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-[12.5px] font-medium leading-[1.35]",
          b.focusPickMode ? "cursor-crosshair" : "cursor-pointer",
          task.status === "完了" && "line-through",
        )}
        leading={(b) => (
          <>
            {selectMode && (
              <button
                onClick={(e) => { e.stopPropagation(); b.blockProps.onClick(); }}
                className="mt-0.5 shrink-0 text-neutral-500 transition hover:text-sky-300"
              >
                <CheckSquare className={classNames("h-3.5 w-3.5", b.isSelected ? "text-sky-400" : "opacity-30")} />
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); toggleDone(task); }} className="mt-0.5 shrink-0 text-neutral-500 transition hover:text-emerald-300">
              {task.status === "完了" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            </button>
            {hasChildren ? (
              <button onClick={(e) => { e.stopPropagation(); setCollapsed((prev) => ({ ...prev, [task.id]: !prev[task.id] })); }} className="mt-0.5 shrink-0 text-neutral-500">
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            ) : <span className="w-3.5 shrink-0" />}
          </>
        )}
        meta={() => (
          <>
            {task.pinnedDate && (
              <div className="mt-0.5 flex items-center gap-0.5 text-[9px] text-amber-300/80">
                <Pin className="h-2.5 w-2.5" />
                <span>{task.pinnedDate.slice(5).replace("-", "/")}</span>
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
                {task.dueDate && <span>・〆{task.dueDate.slice(5).replace("-", "/")}</span>}
              </div>
            )}
          </>
        )}
        trailing={() => task.memo?.trim() && <FileText className="h-3 w-3 text-neutral-500" title="メモあり" />}
      />
      {hasChildren && !isCollapsed && (
        <div className={classNames("flex flex-col gap-0.5", compact && "ml-2 border-l border-amber-200/10 pl-2")}>
          {children.map((child, i) => (
            <TaskCard
              key={child.id}
              listNumber={numberedIndex(children, i)}
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

function SevenDayView({ tasks, projectRules, taskMap, childrenOf, upsertTask, removeTask, addTask, toggleDone, categoryTone, setSelectedTaskId, selectedTaskId, setSelectedProject }) {
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

  function handleAdd(dateKey, titleArg) {
    const title = (titleArg ?? newTitles[dateKey] ?? "").trim();
    if (!title) return null;
    // addTask は App 側の commitTasks を内包しているので、scheduledDate を含むタスクを渡す
    const created = addTask({ title, category: "", project: "", scheduledDate: dateKey, plain: true, today: false, thisWeek: false });
    setNewTitles((prev) => ({ ...prev, [dateKey]: "" }));
    return created;
  }

  const [forceHorizontal, setForceHorizontal] = useState(false);
  const [flatView, setFlatView] = useState(false);
  const [colsPerRow, setColsPerRow] = useState(() => window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 3 : window.innerWidth >= 640 ? 2 : 1);
  useEffect(() => {
    const update = () => setColsPerRow(window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 3 : window.innerWidth >= 640 ? 2 : 1);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const [forceMonth, setForceMonth] = useState(false);

  const monthWeeks = useMemo(() => {
    if (!forceMonth) return null;
    // 今日を含む週を起点に4週分（約1か月）
    const startMon = weekDays[0];
    const weeks = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(startMon);
      d.setDate(startMon.getDate() + i * 7);
      weeks.push(getWeekDays(d));
    }
    return weeks;
  }, [forceMonth, weekOffset]);

  const navigateMonth = (dir) => setWeekOffset((v) => v + dir);

  // Builds allBars for any given weekDays array (reused for each week in month view)
  const computeWeekBars = (wDays) => {
    const wKeys = wDays.map(toDateKey);
    const wStart = wKeys[0];
    const wEnd = wKeys[6];
    const toCol = (key) => { const idx = wKeys.indexOf(key); if (idx < 0) return key < wStart ? 0 : 5; return Math.min(idx, 5); };
    const dueBars = tasks
      .filter((t) => t.dueDate && !t.archived && t.status !== "完了" && t.dueDate >= wStart)
      .map((t) => {
        const rawStart = t.scheduledDate && t.scheduledDate >= wStart ? t.scheduledDate : wStart;
        const rawEnd = t.dueDate <= wEnd ? t.dueDate : wEnd;
        const startCol = toCol(rawStart);
        const endCol = toCol(rawEnd);
        const isOverdue = t.dueDate < todayKey;
        const extendsLeft = !!(t.scheduledDate && t.scheduledDate < wStart);
        const extendsRight = t.dueDate > wEnd;
        return { kind: "due", id: `${t.id}-${wStart}`, label: t.title, category: t.category || "", startCol, endCol, isOverdue, extendsLeft, extendsRight, dueDate: t.dueDate };
      })
      .filter((b) => b.endCol >= b.startCol);
    const ruleBars = [];
    if (projectRules) {
      Object.entries(projectRules).forEach(([ruleKey, rule]) => {
        if (!rule || rule.recurrence === "none" || !rule.showRepeatBar) return;
        if (rule.recurrenceEnd && wStart > rule.recurrenceEnd) return;
        if (rule.recurrenceStart && wEnd < rule.recurrenceStart) return;
        const { category, project } = (() => { const [cat, ...rest] = ruleKey.split("::"); return { category: cat, project: rest.join("::") }; })();
        const isRangeBar = rule.recurrence === "monthlyDateRange" || (rule.recurrence === "monthlyDate" && rule.recurrenceDateTo != null);
        if (isRangeBar) {
          const from = rule.recurrence === "monthlyDateRange" ? Number(rule.recurrenceDateFrom ?? 1) : Number(rule.recurrenceDate ?? 1);
          const to = Number(rule.recurrenceDateTo ?? 1);
          const matchingKeys = wDays.filter((d) => {
            const dd = d.getDate();
            const match = from <= to ? dd >= from && dd <= to : dd >= from || dd <= to;
            const key = toDateKey(d);
            if (rule.recurrenceStart && key < rule.recurrenceStart) return false;
            if (rule.recurrenceEnd && key > rule.recurrenceEnd) return false;
            return match;
          }).map(toDateKey);
          if (matchingKeys.length === 0) return;
          const startCol = toCol(matchingKeys[0]);
          const endCol = toCol(matchingKeys[matchingKeys.length - 1]);
          ruleBars.push({ kind: "repeat", id: `rule-${ruleKey}-${wStart}`, label: project, category, startCol, endCol, rangeEndDay: to, extendsLeft: startCol === 0 && matchingKeys[0] === wKeys[0], extendsRight: endCol === 5 && matchingKeys[matchingKeys.length - 1] === wKeys[5] && to !== wDays[Math.min(5, wDays.length - 1)].getDate() });
        } else {
          wDays.forEach((d, i) => {
            const key = toDateKey(d);
            if (!ruleMatchesWeekday(rule, d, key)) return;
            const col = Math.min(i, 5);
            ruleBars.push({ kind: "repeat", id: `rule-${ruleKey}-${key}`, label: project, category, startCol: col, endCol: col, extendsLeft: false, extendsRight: false });
          });
        }
      });
    }
    return [...dueBars, ...ruleBars];
  };

  const renderBarRow = (bars) => {
    if (bars.length === 0) return null;
    return (
      <div className="mb-1.5 grid gap-x-1 gap-y-0.5" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
        {bars.map((bar) => {
          const span = bar.endCol - bar.startCol + 1;
          return (
            <div
              key={bar.id}
              style={{ gridColumn: `${bar.startCol + 1} / span ${span}` }}
              title={bar.kind === "due" ? `${bar.label}（締め切り: ${bar.dueDate}）` : `${bar.label}（リピート）`}
              className={classNames(
                "flex h-4 items-center overflow-hidden px-1.5 text-[9px] font-medium leading-none",
                bar.extendsLeft ? "rounded-l-none" : "rounded-l",
                bar.extendsRight ? "rounded-r-none" : "rounded-r",
                bar.isOverdue ? "bg-red-500/25 text-red-200" : categoryTone(bar.category).tag
              )}
            >
              <span className="truncate">{bar.label}</span>
              {bar.kind === "due" && <span className="ml-auto shrink-0 pl-1 opacity-70">{bar.extendsRight ? `〜${bar.dueDate.slice(5).replace("-","/")}→` : `〆${bar.dueDate.slice(5).replace("-","/")}`}</span>}
              {bar.kind === "repeat" && bar.rangeEndDay != null && <span className="ml-auto shrink-0 pl-1 opacity-60">{bar.extendsRight ? `〜${bar.rangeEndDay}日→` : `〜${bar.rangeEndDay}日`}</span>}
              {bar.kind === "repeat" && bar.rangeEndDay == null && bar.extendsRight && <span className="ml-auto shrink-0 pl-1 opacity-50">→</span>}
            </div>
          );
        })}
      </div>
    );
  };

  const dayColPropsFor = (wDays, i, stacked = false) => {
    const date = wDays[i];
    const dateKey = toDateKey(date);
    return {
      key: dateKey, dateKey, label: DAY_LABELS[i], date,
      isToday: dateKey === todayKey, isSat: i === 5, isSun: i === 6, stacked,
      tasks: rootTasksForDay({ tasks, projectRules, dateKey, date, todayKey }),
      allTasks: tasks,
      childrenOf,
      newTitle: newTitles[dateKey] || "",
      setNewTitle: (v) => setNewTitles((prev) => ({ ...prev, [dateKey]: v })),
      onAdd: (title) => handleAdd(dateKey, title),
      toggleDone, upsertTask, removeTask, categoryTone, setSelectedTaskId, selectedTaskId, projectRules, flatView, setSelectedProject,
    };
  };

  const firstDay = weekDays[0];
  const lastDay = weekDays[6];
  const headerLabel = forceMonth
    ? (() => { const end = new Date(weekDays[0]); end.setDate(end.getDate() + 27); return `${firstDay.getMonth()+1}/${firstDay.getDate()} - ${end.getMonth()+1}/${end.getDate()}`; })()
    : `${firstDay.getMonth() + 1}/${firstDay.getDate()} - ${lastDay.getMonth() + 1}/${lastDay.getDate()}`;

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.025] p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => forceMonth ? navigateMonth(-1) : setWeekOffset((v) => v - 1)}
            className="rounded border border-white/10 p-1.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-neutral-300 min-w-[120px] text-center">{headerLabel}</span>
          <button
            onClick={() => forceMonth ? navigateMonth(1) : setWeekOffset((v) => v + 1)}
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
              {forceMonth ? "今日に戻す" : "今週に戻す"}
            </button>
          )}
          <button
            onClick={() => { setForceHorizontal((v) => !v); setForceMonth(false); }}
            title="7日横並び表示"
            className={classNames(
              "rounded border px-2 py-1 text-[11px] font-medium transition",
              forceHorizontal
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                : "border-white/10 text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
            )}
          >
            6d
          </button>
          <button
            onClick={() => { setForceMonth((v) => !v); setForceHorizontal(false); }}
            title="1か月表示"
            className={classNames(
              "rounded border px-2 py-1 text-[11px] font-medium transition",
              forceMonth
                ? "border-violet-400/40 bg-violet-400/10 text-violet-300"
                : "border-white/10 text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
            )}
          >
            1m
          </button>
          <button
            onClick={() => setFlatView((v) => !v)}
            title="フラット表示（タスク名＋プロジェクトチップ）"
            className={classNames(
              "rounded border px-2 py-1 text-[11px] font-medium transition",
              flatView
                ? "border-rose-400/40 bg-rose-400/10 text-rose-300"
                : "border-white/10 text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
            )}
          >
            flat
          </button>
        </div>
      </div>

      {/* 締め切り & リピートバー + 曜日カラム */}
      {forceMonth ? (
        /* 月ビュー: 各週をブロックとして縦積み */
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[480px] flex flex-col gap-3">
            {(monthWeeks || []).map((wDays) => {
              const wBars = computeWeekBars(wDays);
              const wStart = toDateKey(wDays[0]);
              const wLabel = `${wDays[0].getMonth() + 1}/${wDays[0].getDate()}（${["日","月","火","水","木","金","土"][wDays[0].getDay()]}）〜`;
              return (
                <div key={wStart} className="border-t border-white/[0.06] pt-1.5">
                  <div className="mb-1 text-[10px] text-neutral-600">{wLabel}</div>
                  {renderBarRow(wBars)}
                  <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
                    {[0, 1, 2, 3, 4].map((i) => <DayColumn key={i} {...dayColPropsFor(wDays, i, true)} />)}
                    <div className="flex flex-col gap-1">
                      {[5, 6].map((i) => <DayColumn key={i} {...dayColPropsFor(wDays, i, true)} />)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (() => {
        const allBars = computeWeekBars(weekDays);
        const barRow = renderBarRow(allBars);

        // 列グループ [groupStart, groupEnd] に対応するバーをスライスして描画
        const renderBarSlice = (groupStart, groupEnd) => {
          const groupSize = groupEnd - groupStart + 1;
          const sliceBars = allBars
            .filter((b) => b.endCol >= groupStart && b.startCol <= groupEnd)
            .map((b) => ({
              ...b,
              adjStart: Math.max(b.startCol, groupStart) - groupStart,
              adjEnd: Math.min(b.endCol, groupEnd) - groupStart,
              sliceExtendsLeft: b.startCol < groupStart,
              sliceExtendsRight: b.endCol > groupEnd,
            }));
          if (sliceBars.length === 0) return null;
          return (
            <div className="mb-1 grid gap-x-1 gap-y-0.5" style={{ gridTemplateColumns: `repeat(${groupSize}, minmax(0, 1fr))` }}>
              {sliceBars.map((bar) => {
                const span = bar.adjEnd - bar.adjStart + 1;
                const leftRound = bar.extendsLeft || bar.sliceExtendsLeft;
                const rightRound = bar.extendsRight || bar.sliceExtendsRight;
                return (
                  <div
                    key={bar.id}
                    style={{ gridColumn: `${bar.adjStart + 1} / span ${span}` }}
                    title={bar.kind === "due" ? `${bar.label}（締め切り: ${bar.dueDate}）` : `${bar.label}（リピート）`}
                    className={classNames(
                      "flex h-4 items-center overflow-hidden px-1.5 text-[9px] font-medium leading-none",
                      leftRound ? "rounded-l-none" : "rounded-l",
                      rightRound ? "rounded-r-none" : "rounded-r",
                      bar.isOverdue ? "bg-red-500/25 text-red-200" : categoryTone(bar.category).tag
                    )}
                  >
                    <span className="truncate">{bar.label}</span>
                    {bar.kind === "due" && !bar.sliceExtendsRight && <span className="ml-auto shrink-0 pl-1 opacity-70">{bar.extendsRight ? `〜${bar.dueDate.slice(5).replace("-","/")}→` : `〆${bar.dueDate.slice(5).replace("-","/")}`}</span>}
                    {bar.kind === "repeat" && bar.rangeEndDay != null && !bar.sliceExtendsRight && <span className="ml-auto shrink-0 pl-1 opacity-60">{bar.extendsRight ? `〜${bar.rangeEndDay}日→` : `〜${bar.rangeEndDay}日`}</span>}
                    {bar.kind === "repeat" && bar.rangeEndDay == null && (bar.extendsRight && !bar.sliceExtendsRight) && <span className="ml-auto shrink-0 pl-1 opacity-50">→</span>}
                    {bar.sliceExtendsRight && <span className="ml-auto shrink-0 pl-1 opacity-50">→</span>}
                  </div>
                );
              })}
            </div>
          );
        };

        const numGroups = Math.ceil(6 / colsPerRow);
        const responsiveGroups = Array.from({ length: numGroups }, (_, g) => {
          const groupStart = g * colsPerRow;
          const groupEnd = Math.min(groupStart + colsPerRow - 1, 5);
          return { groupStart, groupEnd };
        });

        return (
          <div className="pb-2">
            {forceHorizontal ? (
              <div className="overflow-x-auto">
                <div className="min-w-[480px]">
                  {barRow}
                  <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
                    {[0, 1, 2, 3, 4].map((i) => <DayColumn key={i} {...dayColPropsFor(weekDays, i, true)} />)}
                    <div className="flex flex-col gap-1">
                      {[5, 6].map((i) => <DayColumn key={i} {...dayColPropsFor(weekDays, i, true)} />)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {barRow}
                <div className="flex flex-col gap-2">
                  {responsiveGroups.map(({ groupStart, groupEnd }) => {
                    const groupSize = groupEnd - groupStart + 1;
                    return (
                      <div key={groupStart} className="grid gap-1 min-w-0" style={{ gridTemplateColumns: `repeat(${groupSize}, minmax(0, 1fr))` }}>
                        {Array.from({ length: groupSize }, (_, j) => {
                          const dayIdx = groupStart + j;
                          if (dayIdx === 5) {
                            return (
                              <div key="satsu" className="flex flex-col gap-1">
                                <DayColumn {...dayColPropsFor(weekDays, 5, true)} />
                                <DayColumn {...dayColPropsFor(weekDays, 6, true)} />
                              </div>
                            );
                          }
                          return <DayColumn key={dayIdx} {...dayColPropsFor(weekDays, dayIdx)} />;
                        })}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })()}
    </section>
  );
}

function TrayTask({ task, listNumber, depth = 0, toggleDone, upsertTask, removeTask, setSelectedTaskId, selectedTaskId, onIndent, onOutdent, childrenOf, selectMode = false }) {
  const isDone = task.status === "完了";
  const children = childrenOf?.(task.id) || [];

  return (
    <div style={depth > 0 ? { marginLeft: depth * 12 } : undefined}>
      <TaskBlock
        task={task}
        listNumber={listNumber}
        dragId={`traytask-${task.id}`}
        dragData={{ type: "task", id: task.id }}
        dropId={`traytask-drop-${task.id}`}
        dropData={{ type: "task", id: task.id }}
        dragDisabled={selectMode}
        upsertTask={upsertTask}
        removeTask={removeTask}
        setSelectedTaskId={setSelectedTaskId}
        // タイトルを確定してから親子を変える。同じ tick で2回書くと
        // 後の書き込みが前を消すので、間に1フレーム挟む。
        onTab={(e, { draft, setEditing }) => {
          const isShift = e.shiftKey;
          const clean = draft.trim();
          if (clean && clean !== task.title) upsertTask({ id: task.id, title: clean });
          setEditing(false);
          setTimeout(() => { if (isShift) onOutdent?.(); else onIndent?.(); }, 0);
        }}
        rowClassName={(b) => classNames(
          "flex items-start gap-1 rounded px-1.5 py-1 text-[12.5px] transition",
          b.focusRingClass,
          selectMode ? "cursor-pointer" : b.editing ? "cursor-text" : "cursor-grab",
          b.isSelected ? "bg-sky-500/[0.12] ring-1 ring-inset ring-sky-400/30" : selectedTaskId === task.id && "bg-white/[0.09]",
          b.editing && "bg-white/[0.07]",
          b.isDragging && "opacity-30",
          b.isOver && !b.isDragging && "ring-1 ring-inset ring-white/20 bg-white/[0.05]",
        )}
        textareaClassName={() => "w-full resize-none overflow-hidden rounded border-b border-white/25 bg-transparent text-[12.5px] font-medium ts-text outline-none"}
        titleClassName={(b) => classNames(
          "min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-[12.5px] ts-text",
          b.focusPickMode ? "cursor-crosshair" : "cursor-pointer",
          isDone && "line-through opacity-40",
        )}
        leading={(b) => selectMode ? (
          <button onClick={(e) => { e.stopPropagation(); b.blockProps.onClick(); }} className="mt-0.5 shrink-0 text-neutral-500 transition hover:text-sky-300">
            <CheckSquare className={classNames("h-3 w-3", b.isSelected && "text-sky-400")} />
          </button>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); toggleDone(task); }} className={classNames("mt-0.5 shrink-0 transition", isDone ? "text-emerald-400" : "text-neutral-600 hover:text-neutral-300")}>
            {isDone ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
          </button>
        )}
        meta={() => task.pinnedDate && (
          <div className="flex items-center gap-0.5 text-[9px] text-amber-300/80">
            <Pin className="h-2.5 w-2.5" />
            <span>{task.pinnedDate.slice(5).replace("-", "/")}</span>
          </div>
        )}
      />
      {children.map((child, idx) => (
        <TrayTask
          key={child.id}
          listNumber={numberedIndex(children, idx)}
          task={child}
          depth={depth + 1}
          toggleDone={toggleDone}
          upsertTask={upsertTask}
          removeTask={removeTask}
          setSelectedTaskId={setSelectedTaskId}
          selectedTaskId={selectedTaskId}
          childrenOf={childrenOf}
          selectMode={selectMode}
          onIndent={() => {
            if (idx === 0) return;
            upsertTask({ id: child.id, parentId: children[idx - 1].id });
          }}
          onOutdent={() => {
            upsertTask({ id: child.id, parentId: task.parentId || null });
          }}
        />
      ))}
    </div>
  );
}

function DayTask({ task, listNumber, depth = 0, hideProject = false, childrenOf, categoryTone, toggleDone, upsertTask, removeTask, setSelectedTaskId, selectedTaskId, onIndent, onOutdent, dayDateKey, autoFocusEnd, onFocusEndDone, onDeleteFocusPrev, showProjectChip }) {
  const tone = categoryTone(task.category);
  const isDone = task.status === "完了";
  const children = childrenOf?.(task.id) || [];

  return (
    <div style={depth > 0 ? { marginLeft: depth * 12 } : undefined}>
      <TaskBlock
        task={task}
        listNumber={listNumber}
        dragId={`daytask-${task.id}`}
        dragData={{ type: "task", id: task.id }}
        dropId={`daytask-drop-${task.id}`}
        // 別タスクをこのタスクに重ねると親子化する（プロジェクトにも反映）
        dropData={{ type: "task-in-day", id: task.id }}
        upsertTask={upsertTask}
        removeTask={removeTask}
        autoFocusEnd={autoFocusEnd}
        onFocusEndDone={onFocusEndDone}
        // 7days だけは、空ブロックを消したら前の行を編集状態で末尾にカーソルを置いて開く
        onDeleteEmpty={(id) => onDeleteFocusPrev?.(id)}
        onEmptyBlur={() => removeTask?.(task.id)}
        onTab={(e, { draft, setEditing }) => {
          const isShift = e.shiftKey;
          const clean = (draft || "").trim();
          if (clean && clean !== task.title) upsertTask?.({ id: task.id, title: clean });
          setEditing(false);
          // 同じ tick で2回書くと後の書き込みが前を消すので1フレーム空ける
          setTimeout(() => { if (isShift) onOutdent?.(); else onIndent?.(); }, 0);
        }}
        setSelectedTaskId={setSelectedTaskId}
        extraProps={{ "data-daytask": "true" }}
        compactGutter
        rowClassName={(b) => classNames(
          "flex items-start gap-1 rounded px-1.5 py-1 text-[11px] transition hover:bg-white/[0.07] outline-none",
          b.focusRingClass,
          b.editing ? "cursor-text" : "cursor-grab",
          b.isSelected && "bg-sky-500/[0.12] ring-1 ring-inset ring-sky-400/40",
          selectedTaskId === task.id && "bg-white/[0.09]",
          b.isOver && "ring-1 ring-inset ring-cyan-300/40 bg-cyan-300/[0.06]",
          b.isDragging && "opacity-30",
        )}
        textareaClassName={() => "w-full resize-none overflow-hidden rounded border-b border-white/25 bg-transparent text-[12.5px] font-medium leading-[1.35] ts-text outline-none"}
        titleClassName={(b) => classNames(
          "break-words [overflow-wrap:anywhere] text-[12.5px] font-medium leading-[1.35] ts-text",
          b.focusPickMode ? "cursor-crosshair" : "cursor-pointer",
          isDone && "line-through opacity-40",
        )}
        titleAttrs={(b) => ({ title: b.focusPickMode ? "クリックでフォーカス" : "ダブルクリックで名前を編集" })}
        leading={() => (
          <button
            onClick={(e) => { e.stopPropagation(); toggleDone(task); }}
            className={classNames("mt-0.5 shrink-0 transition", isDone ? "text-emerald-400" : "text-neutral-600 hover:text-neutral-300")}
          >
            {isDone ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
          </button>
        )}
        titleExtra={() => showProjectChip && task.project && (
          <span className={classNames("mt-0.5 inline-block rounded border px-1 py-px text-[9px] leading-none", tone.panel, tone.accent)}>
            {task.project}
          </span>
        )}
        meta={() => !showProjectChip && task.project && depth === 0 && !hideProject && (
          <div className={classNames("mt-0.5 truncate text-[9px]", task.category ? tone.accent : "text-neutral-500")}>{task.project}</div>
        )}
      />
      {children.map((child, i) => (
        <DayTask
          key={child.id}
          listNumber={numberedIndex(children, i)}
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
            upsertTask({ id: child.id, parentId: children[idx - 1].id });
          }}
          onOutdent={() => {
            upsertTask({ id: child.id, parentId: task.parentId || null, scheduledDate: dayDateKey || "" });
          }}
        />
      ))}
    </div>
  );
}

function DayProjectGroup({ g, tone, collapsed, onToggle, childrenOf, categoryTone, toggleDone, upsertTask, setSelectedTaskId, selectedTaskId, dateKey, onIndent, onOutdent, focusEndId, onFocusEndDone, onDeleteFocusPrev, onOpenInspector }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-proj-drop-${dateKey}-${g.key}`,
    data: { type: "project", category: g.category, project: g.project },
  });
  return (
    <div ref={setNodeRef} className={classNames("rounded-md border px-1 py-0.5 transition", tone.panel, isOver && "ring-1 ring-inset ring-white/30 brightness-110")}>
      <div className="flex w-full items-center gap-1 px-0.5 py-0.5">
        <button onClick={onToggle} className="shrink-0 text-neutral-500 hover:text-neutral-300">
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <button onClick={onOpenInspector} className={classNames("min-w-0 flex-1 truncate text-left text-[10px] font-semibold hover:underline", tone.accent)}>
          {g.project || g.category}
        </button>
        {g.items.some((t) => t.__ghost) && <span className="shrink-0 text-[9px] text-neutral-400">↺</span>}
        <span className="shrink-0 text-[9px] text-neutral-500">{g.items.length}</span>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-0.5">
          {g.items.map((task, i) => (
            <DayTask key={task.id} listNumber={numberedIndex(g.items, i)} task={task} hideProject childrenOf={childrenOf} categoryTone={categoryTone} toggleDone={toggleDone} upsertTask={upsertTask} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} dayDateKey={dateKey} onIndent={() => onIndent(task.id)} onOutdent={() => onOutdent(task.id)} autoFocusEnd={focusEndId === task.id} onFocusEndDone={onFocusEndDone} onDeleteFocusPrev={onDeleteFocusPrev} />
          ))}
        </div>
      )}
    </div>
  );
}

function DayColumn({ dateKey, label, date, isToday, isSat, isSun, stacked = false, tasks, allTasks, childrenOf, newTitle, setNewTitle, onAdd, toggleDone, upsertTask, removeTask, categoryTone, setSelectedTaskId, selectedTaskId, projectRules, flatView, setSelectedProject }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-col-${dateKey}`, data: { type: "day-column", date: dateKey, label } });
  const [collapsedProj, setCollapsedProj] = useState({});
  const [focusEndId, setFocusEndId] = useState(null);
  const addInputRef = useRef(null);


  // プロジェクト所属タスクはプロジェクトごとにまとめ、それ以外(plain)はフラット表示
  const pgMap = new Map();
  const plainTasks = [];
  for (const t of tasks) {
    const key = `${t.category}::${t.project}`;
    // 繰り返しルールに登録されているプロジェクトのみグループ化
    if (t.category && t.project && projectRules?.[key]) {
      if (!pgMap.has(key)) {
        pgMap.set(key, { key, category: t.category, project: t.project, items: [] });
      }
    } else {
      plainTasks.push(t);
    }
  }
  // 繰り返しルールがマッチする日に、実タスクがあるプロジェクトのグループを確保
  const src = allTasks || tasks;
  if (projectRules && date) {
    Object.entries(projectRules).forEach(([ruleKey, rule]) => {
      if (pgMap.has(ruleKey)) return;
      if (!ruleMatchesWeekday(rule, date, dateKey)) return;
      const [cat, ...rest] = ruleKey.split("::");
      const proj = rest.join("::");
      pgMap.set(ruleKey, { key: ruleKey, category: cat, project: proj, items: [] });
    });
  }
  // プロジェクトグループのタスク一覧はallTasksから全件引く（PJボードと同じ表示）
  pgMap.forEach((g) => {
    g.items = src.filter((t) => !t.archived && !t.plain && !t.parentId && t.category === g.category && t.project === g.project);
  });
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
  const allProjectTasks = (allTasks || []).filter((t) => !t.archived && !t.plain && !t.parentId);
  const flatRoots = flatView
    ? [...plainTasks, ...allProjectTasks]
    : [...plainTasks, ...projectGroups.flatMap((g) => g.items)];

  const handleDeleteFocusPrev = (taskId) => {
    const idx = flatRoots.findIndex((t) => t.id === taskId);
    if (idx > 0) setFocusEndId(flatRoots[idx - 1].id);
  };

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

      {/* タスク一覧 */}
      <div className="flex flex-col gap-1">
        {flatView ? (
          // Bモード: フラット表示（全タスク＋プロジェクトチップ）
          flatRoots.map((task, i) => (
            <DayTask key={task.id} listNumber={numberedIndex(flatRoots, i)} task={task} childrenOf={childrenOf} categoryTone={categoryTone} toggleDone={toggleDone} upsertTask={upsertTask} removeTask={removeTask} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} dayDateKey={dateKey} onIndent={() => makeIndent(task.id)} onOutdent={() => makeOutdent(task.id)} autoFocusEnd={focusEndId === task.id} onFocusEndDone={() => setFocusEndId(null)} onDeleteFocusPrev={handleDeleteFocusPrev} showProjectChip />
          ))
        ) : (
          // Aモード: プロジェクトグループヘッダーあり（現状）
          <>
            {plainTasks.map((task, i) => (
              <DayTask key={task.id} listNumber={numberedIndex(plainTasks, i)} task={task} childrenOf={childrenOf} categoryTone={categoryTone} toggleDone={toggleDone} upsertTask={upsertTask} removeTask={removeTask} setSelectedTaskId={setSelectedTaskId} selectedTaskId={selectedTaskId} dayDateKey={dateKey} onIndent={() => makeIndent(task.id)} onOutdent={() => makeOutdent(task.id)} autoFocusEnd={focusEndId === task.id} onFocusEndDone={() => setFocusEndId(null)} onDeleteFocusPrev={handleDeleteFocusPrev} />
            ))}
            {projectGroups.map((g) => (
              <DayProjectGroup
                key={g.key}
                g={g}
                tone={categoryTone(g.category)}
                collapsed={!!collapsedProj[g.key]}
                onToggle={() => setCollapsedProj((p) => ({ ...p, [g.key]: !p[g.key] }))}
                childrenOf={childrenOf}
                categoryTone={categoryTone}
                toggleDone={toggleDone}
                upsertTask={upsertTask}
                setSelectedTaskId={setSelectedTaskId}
                selectedTaskId={selectedTaskId}
                dateKey={dateKey}
                onIndent={makeIndent}
                onOutdent={makeOutdent}
                focusEndId={focusEndId}
                onFocusEndDone={() => setFocusEndId(null)}
                onDeleteFocusPrev={handleDeleteFocusPrev}
                onOpenInspector={setSelectedProject ? () => setSelectedProject({ category: g.category, project: g.project }) : undefined}
              />
            ))}
          </>
        )}
      </div>

      {/* 追加入力（最後のタスクのすぐ下） */}
      <div className="mt-0.5 flex gap-1">
        <AddBlockInput
          inputRef={addInputRef}
          value={newTitle}
          onChange={setNewTitle}
          onSubmit={(title) => { const t = onAdd(title); setTimeout(() => addInputRef.current?.focus(), 0); return t; }}
          placeholder="追加…"
          className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-[10px] outline-none placeholder:text-neutral-700 focus:border-white/20 focus:bg-white/[0.025]"
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
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="ts-bg px-2 py-1 text-[10px] font-medium text-neutral-500">{day}</div>)}
        {days.map((d) => {
          const key = toDateKey(d);
          const list = tasksByDate[key] || [];
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={classNames(
                "min-h-[96px] ts-bg p-1 align-top md:min-h-[140px] md:p-1.5",
                !inMonth && "opacity-35",
                isToday && "relative ring-2 ring-emerald-300/60 ring-inset bg-emerald-300/[0.055]"
              )}
            >
              <div className={classNames("mb-1 flex items-center justify-between gap-1 text-[10px]", isToday ? "text-emerald-100" : "text-neutral-500")}>
                <span className={classNames(isToday && "rounded-full bg-emerald-300/20 px-1.5 py-0.5 font-semibold text-emerald-100")}>{d.getDate()}</span>
                {isToday && <span className="rounded-full border border-emerald-200/25 px-1.5 py-0.5 text-[9px] font-medium text-emerald-100">Today</span>}
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
    <aside className="fixed bottom-0 right-0 z-40 max-h-[78vh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 ts-bg-veil p-4 shadow-2xl backdrop-blur md:top-[56px] md:max-h-[calc(100vh-56px)] md:w-[380px] md:max-w-[380px] md:rounded-none md:border-l md:border-t-0">
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
        <button onClick={onClose} className="rounded-full border border-white/10 p-2 text-neutral-400 transition hover:bg-white/10 hover:ts-text"><X className="h-4 w-4" /></button>
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
              <div>
                <div className="mb-1 text-[10px] text-neutral-600">起点日</div>
                <DueDatePicker value={rule.recurrenceStart || ""} onChange={(v) => updateProjectRule(category, project, { recurrenceStart: v })} />
              </div>
            )}

            {rule.recurrence === "monthlyDate" && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={Number(rule.recurrenceDate ?? 1)}
                  onChange={(e) => updateProjectRule(category, project, { recurrenceDate: Number(e.target.value) })}
                  className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
                  placeholder="日付"
                />
                <span className="shrink-0 text-xs text-neutral-500">〜</span>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={rule.recurrenceDateTo != null ? Number(rule.recurrenceDateTo) : ""}
                  onChange={(e) => updateProjectRule(category, project, { recurrenceDateTo: e.target.value === "" ? null : Number(e.target.value) })}
                  className="min-w-0 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none"
                  placeholder="終了日（省略可）"
                />
                <span className="shrink-0 text-xs text-neutral-500">日</span>
              </div>
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
                  <div>
                    <div className="mb-1 text-[10px] text-neutral-600">開始日</div>
                    <DueDatePicker value={rule.recurrenceStart || ""} onChange={(v) => updateProjectRule(category, project, { recurrenceStart: v })} />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] text-neutral-600">終了日</div>
                    <DueDatePicker value={rule.recurrenceEnd || ""} onChange={(v) => updateProjectRule(category, project, { recurrenceEnd: v })} />
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 transition hover:bg-black/30">
                  <input
                    type="checkbox"
                    checked={!!rule.showRepeatBar}
                    onChange={(e) => updateProjectRule(category, project, { showRepeatBar: e.target.checked })}
                    className="accent-violet-400"
                  />
                  <span className="text-xs text-neutral-300">7Daysのバーに表示</span>
                </label>
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
    <aside className="fixed bottom-0 right-0 z-40 max-h-[78vh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 ts-bg-veil p-3 shadow-2xl backdrop-blur md:top-[56px] md:max-h-[calc(100vh-56px)] md:w-[360px] md:max-w-[360px] md:rounded-none md:border-l md:border-t-0">
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
        <button onClick={onClose} className="rounded-full border border-white/10 p-1.5 text-neutral-400 transition hover:bg-white/10 hover:ts-text"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-2">
        <PropertyRow label="Category"><select value={task.category || ""} onChange={(event) => { const category = event.target.value; upsertTask({ id: task.id, category, project: category ? (projectsByCategory[category]?.[0] || task.project) : "", plain: !category }); }} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none"><option value="">{NO_CATEGORY_LABEL}</option>{categories.map((cat) => <option key={cat.key} value={cat.key}>{cat.key}</option>)}</select></PropertyRow>
        <PropertyRow label="Project"><select value={task.project || ""} onChange={(event) => upsertTask({ id: task.id, project: event.target.value, plain: !task.category && !event.target.value })} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none"><option value="">{task.category ? "（未選択）" : NO_CATEGORY_LABEL}</option>{siblingProjects.map((project) => <option key={project} value={project}>{project}</option>)}{task.project && !siblingProjects.includes(task.project) && <option value={task.project}>{task.project}</option>}</select></PropertyRow>
        <PropertyRow label="Status"><select value={task.status} onChange={(event) => upsertTask({ id: task.id, status: event.target.value })} className="min-w-0 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none"><option>未着手</option><option>進行中</option><option>完了</option></select></PropertyRow>
        <PropertyRow label="Due"><DueDatePicker value={task.dueDate || ""} onChange={(v) => upsertTask({ id: task.id, dueDate: v })} /></PropertyRow>
        <PropertyRow label="Pin日"><DueDatePicker value={task.pinnedDate || ""} onChange={(v) => upsertTask({ id: task.id, pinnedDate: v })} /></PropertyRow>
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

function DueDatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const todayKey = toDateKey(new Date());

  // 表示用の月（開いた時点のvalueまたは今月）
  const initMonth = () => {
    if (value) { const [y, m] = value.split("-"); return new Date(Number(y), Number(m) - 1, 1); }
    const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1);
  };
  const [month, setMonth] = useState(initMonth);

  // 開くたびに月をリセット
  useEffect(() => { if (open) setMonth(initMonth()); }, [open]);

  // 外クリックで閉じる
  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const year = month.getFullYear();
  const mon = month.getMonth();
  const first = new Date(year, mon, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((startDow + daysInMonth) / 7) * 7 }, (_, i) => {
    const d = i - startDow + 1;
    return d >= 1 && d <= daysInMonth ? d : null;
  });

  const displayLabel = value
    ? (() => { const [y, m, d] = value.split("-"); return `${y}/${m}/${d}`; })()
    : "日付を選択";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={classNames(
          "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition",
          value ? "border-white/10 bg-black/25 text-neutral-200 hover:bg-black/40" : "border-white/10 bg-black/25 text-neutral-500 hover:bg-black/40"
        )}
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
        <span className="flex-1 text-left">{displayLabel}</span>
        {value && (
          <span onClick={(e) => { e.stopPropagation(); onChange(""); }} className="shrink-0 text-neutral-600 hover:text-red-400 transition">
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-white/15 ts-surface p-3 shadow-2xl">
          {/* 月ナビ */}
          <div className="mb-2 flex items-center justify-between">
            <button onClick={() => setMonth(new Date(year, mon - 1, 1))} className="rounded p-1 text-neutral-400 hover:bg-white/10"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="text-xs font-semibold text-neutral-300">{year}年{mon + 1}月</span>
            <button onClick={() => setMonth(new Date(year, mon + 1, 1))} className="rounded p-1 text-neutral-400 hover:bg-white/10"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          {/* 曜日ヘッダ */}
          <div className="mb-1 grid grid-cols-7 text-center">
            {["日","月","火","水","木","金","土"].map((d, i) => (
              <div key={d} className={classNames("text-[10px] font-medium", i === 0 ? "text-rose-400" : i === 6 ? "text-sky-400" : "text-neutral-600")}>{d}</div>
            ))}
          </div>
          {/* 日付グリッド */}
          <div className="grid grid-cols-7 gap-px">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const key = `${year}-${String(mon + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const isToday = key === todayKey;
              const isSelected = key === value;
              const dow = i % 7;
              return (
                <button
                  key={key}
                  onClick={() => { onChange(key); setOpen(false); }}
                  className={classNames(
                    "rounded py-1 text-[11px] transition",
                    isSelected ? "bg-emerald-500 font-semibold text-white" :
                    isToday ? "bg-emerald-500/20 font-semibold text-emerald-300 hover:bg-emerald-500/30" :
                    dow === 0 ? "text-rose-300 hover:bg-white/10" :
                    dow === 6 ? "text-sky-300 hover:bg-white/10" :
                    "text-neutral-300 hover:bg-white/10"
                  )}
                >{d}</button>
              );
            })}
          </div>
          {/* Today shortcut */}
          <button
            onClick={() => { onChange(todayKey); setOpen(false); }}
            className="mt-2 w-full rounded-lg border border-emerald-400/25 bg-emerald-500/10 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-500/20"
          >今日</button>
        </div>
      )}
    </div>
  );
}

function FocusOverlay({ taskId, taskMap, childrenOf, categoryTone, upsertTask, toggleDone, onClose, trayItem }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // TRAYアイテムモード
  if (trayItem) {
    return (
      <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.95)" }} onClick={onClose}>
        <div className="w-full max-w-xl px-4" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-xl border border-white/10 ts-surface p-4">
            <p className="text-xs text-neutral-500 mb-2">TRAY</p>
            <p className="text-base font-medium ts-text leading-snug">{trayItem.title}</p>
          </div>
          <button onClick={onClose} className="mt-4 w-full text-center text-xs text-neutral-600 hover:text-neutral-400 transition">Esc で閉じる</button>
        </div>
      </div>
    );
  }

  if (!taskId || !taskMap) return null;
  const task = taskMap.get(taskId);
  if (!task) return null;

  // 親チェーンを収集
  const ancestors = [];
  let cur = task.parentId ? taskMap.get(task.parentId) : null;
  while (cur) {
    ancestors.unshift(cur);
    cur = cur.parentId ? taskMap.get(cur.parentId) : null;
  }

  const children = childrenOf ? childrenOf(taskId) : [];
  const tone = categoryTone(task.category);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.95)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 親チェーン */}
        {ancestors.length > 0 && (
          <div className="mb-3 flex flex-col gap-1">
            {ancestors.map((a) => (
              <div key={a.id} className="text-xs text-neutral-600 truncate">
                ↳ {a.title}
              </div>
            ))}
          </div>
        )}

        {/* フォーカスタスク本体 */}
        <div className={classNames("rounded-xl border p-4", tone.panel)}>
          <div className="flex items-start gap-3">
            <button
              onClick={() => toggleDone(task.id)}
              className={classNames(
                "mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 transition",
                task.archived ? "border-transparent bg-neutral-600" : "border-neutral-500 hover:border-neutral-300"
              )}
            >
              {task.archived && <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-400">✓</span>}
            </button>
            <div className="min-w-0 flex-1">
              <p className={classNames("text-base font-medium leading-snug", task.archived ? "line-through text-neutral-500" : "ts-text")}>
                {task.title}
              </p>
              {task.project && (
                <p className={classNames("mt-1 text-xs", tone.accent)}>{task.category} / {task.project}</p>
              )}
              {task.memo?.trim() && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-neutral-500">{task.memo}</p>
              )}
            </div>
          </div>

          {/* 子タスク */}
          {children.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-3">
              {children.map((child) => (
                <div key={child.id} className="flex items-center gap-2">
                  <button
                    onClick={() => toggleDone(child.id)}
                    className={classNames(
                      "h-4 w-4 shrink-0 rounded-full border-2 transition",
                      child.archived ? "border-transparent bg-neutral-600" : "border-neutral-600 hover:border-neutral-400"
                    )}
                  >
                    {child.archived && <span className="flex h-full w-full items-center justify-center text-[8px] text-neutral-400">✓</span>}
                  </button>
                  <span className={classNames("text-sm", child.archived ? "line-through text-neutral-600" : "text-neutral-300")}>
                    {child.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={onClose} className="mt-4 w-full text-center text-xs text-neutral-600 hover:text-neutral-400 transition">
          Esc で閉じる
        </button>
      </div>
    </div>
  );
}

// Notion 風のドラッグ範囲選択（マーキー）。
// 余白から左ドラッグを始めたときだけ矩形を出し、重なったタスク／TRAY行を選択する。
// タスクカード上から始まったドラッグは dnd-kit の移動なので手を出さない。
function MarqueeSelect({ onSelect }) {
  const [rect, setRect] = useState(null);
  const startRef = useRef(null);

  useEffect(() => {
    function isInteractive(el) {
      return !!el.closest(
        "[data-draggable],[data-daytask],[data-task-id],[data-tray-id]," +
        "button,input,textarea,select,a,[contenteditable='true']"
      );
    }

    function onPointerDown(e) {
      // 左ボタンのマウス操作のみ。タッチはスクロールを潰すので対象外。
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (isInteractive(e.target)) return;
      startRef.current = { x: e.clientX, y: e.clientY };
    }

    function onPointerMove(e) {
      const s = startRef.current;
      if (!s) return;
      const dx = Math.abs(e.clientX - s.x);
      const dy = Math.abs(e.clientY - s.y);
      // 誤爆防止：一定距離動いてから矩形を出す
      if (!rect && dx < 5 && dy < 5) return;
      // ブラウザ標準の文字選択が走らないようにする
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      window.getSelection()?.removeAllRanges();
      const r = {
        left: Math.min(s.x, e.clientX),
        top: Math.min(s.y, e.clientY),
        width: Math.abs(e.clientX - s.x),
        height: Math.abs(e.clientY - s.y),
      };
      setRect(r);

      const taskIds = [];
      const trayIds = [];
      document.querySelectorAll("[data-task-id],[data-tray-id]").forEach((el) => {
        const b = el.getBoundingClientRect();
        const hit = b.left < r.left + r.width && b.right > r.left &&
                    b.top < r.top + r.height && b.bottom > r.top;
        if (!hit) return;
        const tid = el.getAttribute("data-task-id");
        if (tid) taskIds.push(tid); else trayIds.push(el.getAttribute("data-tray-id"));
      });
      onSelect(taskIds, trayIds);
    }

    function onPointerUp() {
      startRef.current = null;
      setRect(null);
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };
  }, [rect, onSelect]);

  if (!rect) return null;
  return (
    <div
      className="pointer-events-none fixed z-[250] rounded-sm border border-sky-400/70 bg-sky-400/10"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    />
  );
}

// 画面スリープ防止。
// 本命は Screen Wake Lock API（iPadOS 16.4+ / Chrome / Edge）。
// iOS Safari は標準の PiP API を持たず webkitSetPresentationMode のみなので、
// Wake Lock が無い環境向けに PiP をフォールバックとして残す。
const hasWakeLock = typeof navigator !== "undefined" && "wakeLock" in navigator;
function pipFlavor() {
  if (typeof document === "undefined") return null;
  if (document.pictureInPictureEnabled) return "standard";
  const v = document.createElement("video");
  if (typeof v.webkitSetPresentationMode === "function") return "webkit";
  return null;
}

function KeepAwakeButton() {
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef(null);
  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const flavor = useMemo(pipFlavor, []);
  const supported = hasWakeLock || !!flavor;

  const releasePip = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const v = videoRef.current;
    if (v) {
      try {
        if (flavor === "webkit" && v.webkitPresentationMode === "picture-in-picture") {
          v.webkitSetPresentationMode("inline");
        } else if (document.pictureInPictureElement === v) {
          document.exitPictureInPicture();
        }
      } catch { /* すでに閉じている */ }
      v.pause();
      v.remove();
      videoRef.current = null;
    }
  }, [flavor]);

  // Wake Lock はタブが背面に回ると自動解放されるので、復帰時に取り直す
  useEffect(() => {
    if (!active || !hasWakeLock) return;
    async function reacquire() {
      if (document.visibilityState !== "visible" || sentinelRef.current) return;
      try {
        sentinelRef.current = await navigator.wakeLock.request("screen");
        sentinelRef.current.addEventListener("release", () => { sentinelRef.current = null; });
      } catch { /* 取得できなければ諦める */ }
    }
    document.addEventListener("visibilitychange", reacquire);
    return () => document.removeEventListener("visibilitychange", reacquire);
  }, [active]);

  useEffect(() => () => {
    sentinelRef.current?.release().catch(() => {});
    releasePip();
  }, [releasePip]);

  async function startPipFallback() {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    function draw() {
      const now = new Date();
      const t = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((n) => String(n).padStart(2, "0")).join(":");
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = "#e5e5e5";
      ctx.font = "bold 56px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t, 160, 80);
      ctx.fillStyle = "#525252";
      ctx.font = "14px sans-serif";
      ctx.fillText("Task Space", 160, 148);
      rafRef.current = requestAnimationFrame(draw);
    }
    draw();

    const video = document.createElement("video");
    video.srcObject = canvas.captureStream(1);
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    // iOS は DOM に載っていない video を PiP に上げられない
    video.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;";
    document.body.appendChild(video);
    videoRef.current = video;

    await video.play();
    if (flavor === "webkit") {
      video.webkitSetPresentationMode("picture-in-picture");
      video.addEventListener("webkitpresentationmodechanged", () => {
        if (video.webkitPresentationMode !== "picture-in-picture") { releasePip(); setActive(false); }
      });
    } else {
      await video.requestPictureInPicture();
      video.addEventListener("leavepictureinpicture", () => { releasePip(); setActive(false); }, { once: true });
    }
  }

  async function start() {
    setFailed(false);
    if (hasWakeLock) {
      try {
        sentinelRef.current = await navigator.wakeLock.request("screen");
        sentinelRef.current.addEventListener("release", () => { sentinelRef.current = null; });
        setActive(true);
        return;
      } catch { /* Wake Lock が拒否されたら PiP を試す */ }
    }
    if (!flavor) { setFailed(true); return; }
    try {
      await startPipFallback();
      setActive(true);
    } catch {
      releasePip();
      setFailed(true);
    }
  }

  async function stop() {
    try { await sentinelRef.current?.release(); } catch { /* noop */ }
    sentinelRef.current = null;
    releasePip();
    setActive(false);
  }

  if (!supported) return null;

  return (
    <button
      onClick={active ? stop : start}
      title={
        failed ? "スリープ防止を開始できませんでした"
        : active ? "スリープ防止：ON（クリックで解除）"
        : "スリープ防止：OFF（クリックで開始）"
      }
      className={classNames(
        "rounded-md border px-2 py-1.5 text-xs transition flex items-center gap-1",
        failed ? "border-red-400/40 bg-red-400/10 text-red-300"
        : active ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
        : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.07]"
      )}
    >
      <Airplay className="h-3.5 w-3.5" />
    </button>
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
