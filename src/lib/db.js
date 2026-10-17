import { supabase, isSupabaseEnabled } from './supabase'

const STORAGE_KEY = 'notion-like-taskdb-prototype-v4'

// あとから足した tasks の列。まだ ALTER TABLE していない環境でも同期全体が
// 落ちないよう、列が無いと分かった時点でその列を送るのをやめる。
const OPTIONAL_TASK_COLUMNS = {
  stock: { note: 'STOCK の在／不在', type: 'boolean not null default false' },
  stock_view_id: { note: 'どの STOCK ビューに入れたか', type: 'text' },
  style: { note: 'タスクごとの色・太さ', type: 'jsonb' },
  block_type: { note: '見出し・区切り線などのブロック種別', type: 'text' },
  canvas_x: { note: 'キャンバス上の位置', type: 'real' },
  canvas_y: { note: 'キャンバス上の位置', type: 'real' },
  page_id: { note: 'どのページに書かれたブロックか', type: 'text' },
  row_key: { note: '段組みの行', type: 'text' },
  col_index: { note: '段組みの列位置', type: 'integer not null default 0' },
  col_width: { note: '段組みの列幅（取り分）', type: 'real' },
  code_lang: { note: 'コードブロックの言語', type: 'text' },
  day_date: { note: '日付ブロックが見ている日', type: 'text' },
}

// 足りないと分かった列だけを足すと、次に別の機能を使ったときにまた出る。
// 一度で済むように、任意列はまとめて作る文を出す。
export function optionalColumnsSql() {
  return Object.entries(OPTIONAL_TASK_COLUMNS)
    .map(([name, { type }]) => `alter table tasks add column if not exists ${name} ${type};`)
    .join('\n')
}
const optionalColumnSupported = Object.fromEntries(
  Object.keys(OPTIONAL_TASK_COLUMNS).map((c) => [c, true])
)

// 未作成の列名を error から拾う。PostgREST は PGRST204 で列名を message に含める。
export function missingOptionalColumn(error) {
  if (!error) return null
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`
  if (error.code !== 'PGRST204' && !/column/i.test(text)) return null
  // 長い名前から先に判定する（stock より stock_view_id を優先）
  const names = Object.keys(OPTIONAL_TASK_COLUMNS).sort((a, b) => b.length - a.length)
  return names.find((c) => optionalColumnSupported[c] && text.includes(c)) ?? null
}

// 列が足りないと分かったら落とす。落とせたら true（＝再試行する価値がある）。
// 無かった列を覚えておく。黙って落とすと、他の端末に伝わっていないことに
// 気づけないので、アプリ側から知らせられるようにする。
const missingColumns = new Set()
export function getMissingOptionalColumns() {
  return [...missingColumns].map((name) => ({ name, note: OPTIONAL_TASK_COLUMNS[name]?.note || '' }))
}

function disableOptionalColumn(name) {
  if (!name || !optionalColumnSupported[name]) return false
  optionalColumnSupported[name] = false
  missingColumns.add(name)
  console.warn(`[db] tasks.${name} 列が無いため「${OPTIONAL_TASK_COLUMNS[name].note}」はこの端末内のみで保持されます`)
  return true
}

// --- camelCase <-> snake_case mappers ---

function taskToRow(t) {
  const row = {}
  if (optionalColumnSupported.stock) row.stock = t.stock ?? false
  if (optionalColumnSupported.stock_view_id) row.stock_view_id = t.stockViewId ?? null
  if (optionalColumnSupported.style) {
    row.style = t.style && Object.keys(t.style).length ? JSON.stringify(t.style) : null
  }
  if (optionalColumnSupported.block_type) row.block_type = t.blockType ?? 'task'
  if (optionalColumnSupported.canvas_x) row.canvas_x = t.canvasX ?? null
  if (optionalColumnSupported.canvas_y) row.canvas_y = t.canvasY ?? null
  if (optionalColumnSupported.page_id) row.page_id = t.pageId ?? null
  if (optionalColumnSupported.row_key) row.row_key = t.rowKey ?? null
  if (optionalColumnSupported.col_index) row.col_index = t.col ?? 0
  if (optionalColumnSupported.col_width) row.col_width = t.colWidth ?? null
  if (optionalColumnSupported.code_lang) row.code_lang = t.codeLang ?? ''
  if (optionalColumnSupported.day_date) row.day_date = t.dayDate ?? ''
  return {
    ...row,
    id: t.id,
    title: t.title ?? '',
    category: t.category ?? '',
    project: t.project ?? '',
    status: t.status ?? '未着手',
    today: t.today ?? false,
    today_order: t.todayOrder ?? null,
    this_week: t.thisWeek ?? false,
    weekly_order: t.weeklyOrder ?? null,
    parent_id: t.parentId ?? null,
    memo: t.memo ?? '',
    due_date: t.dueDate ?? '',
    recurrence: t.recurrence ?? 'none',
    recurrence_day: t.recurrenceDay ?? null,
    recurrence_end: t.recurrenceEnd ?? '',
    plain: t.plain ?? false,
    sort_order: t.sortOrder ?? null,
    archived: t.archived ?? false,
    scheduled_date: t.scheduledDate ?? '',
  }
}

export function rowToTask(r) {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    project: r.project,
    status: r.status,
    today: r.today,
    todayOrder: r.today_order,
    thisWeek: r.this_week,
    weeklyOrder: r.weekly_order,
    parentId: r.parent_id,
    memo: r.memo,
    dueDate: r.due_date,
    recurrence: r.recurrence,
    recurrenceDay: r.recurrence_day,
    recurrenceEnd: r.recurrence_end,
    plain: r.plain,
    sortOrder: r.sort_order ?? null,
    archived: r.archived ?? false,
    scheduledDate: r.scheduled_date ?? '',
    stock: r.stock ?? false,
    stockViewId: r.stock_view_id ?? null,
    style: parseStyle(r.style),
    blockType: r.block_type ?? 'task',
    canvasX: r.canvas_x ?? null,
    canvasY: r.canvas_y ?? null,
    pageId: r.page_id ?? null,
    rowKey: r.row_key ?? null,
    col: r.col_index ?? 0,
    colWidth: r.col_width ?? null,
    codeLang: r.code_lang ?? '',
    dayDate: r.day_date ?? '',
  }
}

function parseStyle(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return null }
}

function categoryToRow(c, index) {
  return {
    id: c.key,
    key: c.key,
    label: c.label,
    tone: c.tone,
    sort_order: index,
  }
}

function rowToCategory(r) {
  return { key: r.key, label: r.label, tone: r.tone }
}

function projectRulesToRows(rules) {
  return Object.entries(rules).map(([k, v]) => {
    const [category, ...rest] = k.split('::')
    return {
      id: k,
      category,
      project: rest.join('::'),
      recurrence: v.recurrence ?? 'none',
      recurrence_day: v.recurrenceDay ?? null,
      recurrence_date: v.recurrenceDate ?? null,
      recurrence_week: v.recurrenceWeek ?? null,
      recurrence_start: v.recurrenceStart ?? '',
      recurrence_end: v.recurrenceEnd ?? '',
      recurrence_time: v.recurrenceTime ?? '',
      description: v.description ?? '',
      color: v.color ?? '',
      emoji: v.emoji ?? '',
    }
  })
}

function rowsToProjectRules(rows) {
  const rules = {}
  for (const r of rows) {
    const key = `${r.category}::${r.project}`
    rules[key] = {
      recurrence: r.recurrence,
      recurrenceDay: r.recurrence_day,
      recurrenceDate: r.recurrence_date,
      recurrenceWeek: r.recurrence_week,
      recurrenceStart: r.recurrence_start,
      recurrenceEnd: r.recurrence_end,
      recurrenceTime: r.recurrence_time ?? '',
      description: r.description ?? '',
      color: r.color ?? '',
      emoji: r.emoji ?? '',
    }
  }
  return rules
}

function trayToRow(item, index) {
  return {
    id: item.id,
    title: item.title,
    source: item.source ?? '',
    sort_order: item.sortOrder ?? index,
    created_at: item.createdAt ?? '',
  }
}

export function rowToTray(r) {
  return { id: r.id, title: r.title, source: r.source, createdAt: r.created_at, sortOrder: r.sort_order ?? null }
}

// --- localStorage helpers ---

export function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  } catch {
    return null
  }
}

export function saveLocal(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

// tasks の任意列 → アプリ側の名前。読み込んだ行に列そのものが無いときの
// 見分けに使う（列が無ければキーごと返ってこない。null とは意味が違う）。
const OPTIONAL_FIELD_BY_COLUMN = {
  stock: 'stock',
  stock_view_id: 'stockViewId',
  style: 'style',
  block_type: 'blockType',
  canvas_x: 'canvasX',
  canvas_y: 'canvasY',
  page_id: 'pageId',
  row_key: 'rowKey',
  col_index: 'col',
  col_width: 'colWidth',
  code_lang: 'codeLang',
  day_date: 'dayDate',
}

// Supabase にまだ無い列を、行の形から見つける。
// 1行も無いときは判断できないので「分からない」= 空を返す。
export function absentTaskColumns(rows) {
  const sample = rows?.[0]
  if (!sample) return []
  return Object.keys(OPTIONAL_FIELD_BY_COLUMN).filter((col) => !(col in sample))
}

export function fieldsForColumns(cols) {
  return cols.map((c) => OPTIONAL_FIELD_BY_COLUMN[c]).filter(Boolean)
}

// --- Supabase load (all tables at once) ---

export async function loadFromSupabase() {
  if (!isSupabaseEnabled) return null
  try {
    const [
      { data: taskRows, error: e1 },
      { data: catRows, error: e2 },
      { data: ruleRows, error: e3 },
      { data: orderRows, error: e4 },
      { data: trayRows, error: e5 },
    ] = await Promise.all([
      // 並び順を指定しないと、Postgres は更新のたびに違う順で返す。
      // ブロックの並びは配列の順そのものなので、毎回並びが変わってしまう。
      // id で並べれば、少なくとも読むたびに変わることはない。
      supabase.from('tasks').select('*').order('id'),
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('project_rules').select('*'),
      supabase.from('project_order').select('*'),
      supabase.from('tray_items').select('*').order('sort_order'),
    ])

    if (e1 || e2 || e3 || e4 || e5) {
      console.error('[db] Supabase load error', e1 || e2 || e3 || e4 || e5)
      return null
    }

    const projectOrder = {}
    for (const row of orderRows) {
      projectOrder[row.category] = row.projects
    }

    // 列が無いと分かったら、送るのをやめて画面にも知らせる。
    // 保存でエラーになるまで待たずに、読み込んだ時点で気づける。
    const absentColumns = absentTaskColumns(taskRows)
    absentColumns.forEach(disableOptionalColumn)

    return {
      absentColumns,
      tasks: taskRows.map(rowToTask),
      categories: catRows.map(rowToCategory),
      projectRules: rowsToProjectRules(ruleRows),
      projectOrder,
      inboxItems: trayRows.map(rowToTray),
    }
  } catch (err) {
    console.error('[db] Supabase load exception', err)
    return null
  }
}

// --- Supabase save (upsert everything) ---

export async function saveToSupabase({ tasks, categories, projectRules, projectOrder, inboxItems, deletedTaskIds = [], deletedTrayIds = [] }) {
  if (!isSupabaseEnabled) return
  try {
    const orderRows = Object.entries(projectOrder).map(([category, projects]) => ({
      category,
      projects,
    }))

    const tasksResult = await upsertTasksTolerantly(() => tasks.map(taskToRow))

    const results = await Promise.all([
      Promise.resolve(tasksResult),
      supabase.from('categories').upsert(categories.map(categoryToRow), { onConflict: 'id' }),
      supabase.from('project_rules').upsert(projectRulesToRows(projectRules), { onConflict: 'id' }),
      supabase.from('project_order').upsert(orderRows, { onConflict: 'category' }),
      supabase.from('tray_items').upsert(inboxItems.map(trayToRow), { onConflict: 'id' }),
    ])
    const labels = ['tasks', 'categories', 'project_rules', 'project_order', 'tray_items']
    const errors = []
    results.forEach((r, i) => { if (r.error) { console.error(`[db] save error (${labels[i]})`, r.error); errors.push(`${labels[i]}: ${r.error.message}`) } })
    if (deletedTaskIds.length) {
      console.log('[db] deleting tombstoned tasks', deletedTaskIds)
      await supabase.from('tasks').delete().in('id', deletedTaskIds)
    }
    if (deletedTrayIds.length) {
      console.log('[db] deleting tombstoned tray items', deletedTrayIds)
      await supabase.from('tray_items').delete().in('id', deletedTrayIds)
    }
    return errors.length ? errors.join(' / ') : null
  } catch (err) {
    console.error('[db] Supabase save exception', err)
    return String(err)
  }
}

// --- Delete helpers (for task/tray deletions) ---

export async function deleteTask(id) {
  if (!isSupabaseEnabled) return
  await supabase.from('tasks').delete().eq('id', id)
}

export async function deleteTrayItem(id) {
  if (!isSupabaseEnabled) return
  await supabase.from('tray_items').delete().eq('id', id)
}

export async function deleteProjectRule(key) {
  if (!isSupabaseEnabled) return
  await supabase.from('project_rules').delete().eq('id', key)
}

// --- App settings (key/value) ---

export async function loadSettings() {
  if (!isSupabaseEnabled) return {}
  const { data, error } = await supabase.from('app_settings').select('*')
  if (error) { console.error('[db] loadSettings error', error); return {} }
  const out = {}
  for (const r of data || []) out[r.key] = r.value
  return out
}

export async function saveSetting(key, value) {
  if (!isSupabaseEnabled) return null
  const { error } = await supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
  if (error) console.error('[db] saveSetting error', error)
  return error
}

// 未作成の任意列を1つずつ落としながら upsert を通す
async function upsertTasksTolerantly(rowsOf) {
  let result = await supabase.from('tasks').upsert(rowsOf(), { onConflict: 'id' })
  // 足りない列が複数あることもあるので、落とせなくなるまで繰り返す
  while (disableOptionalColumn(missingOptionalColumn(result.error))) {
    result = await supabase.from('tasks').upsert(rowsOf(), { onConflict: 'id' })
  }
  return result
}

export async function upsertTaskRow(task) {
  if (!isSupabaseEnabled) return null
  const { error } = await upsertTasksTolerantly(() => taskToRow(task))
  if (error) console.error('[db] upsertTaskRow error', error, taskToRow(task))
  return error
}

export async function upsertTrayRow(item, index = 0) {
  if (!isSupabaseEnabled) return null
  const { error } = await supabase.from('tray_items').upsert(trayToRow(item, index), { onConflict: 'id' })
  if (error) console.error('[db] upsertTrayRow error', error, trayToRow(item, index))
  return error
}

// --- Realtime subscription ---

export function subscribeRealtime({ onTaskChange, onTrayChange, onCategoryChange, onProjectRuleChange, onProjectOrderChange, onStatusChange }) {
  if (!isSupabaseEnabled) { onStatusChange?.('disabled'); return () => {} }

  const channel = supabase
    .channel('taskspace-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
      onTaskChange?.(payload)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tray_items' }, (payload) => {
      onTrayChange?.(payload)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, (payload) => {
      onCategoryChange?.(payload)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_rules' }, (payload) => {
      onProjectRuleChange?.(payload)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_order' }, (payload) => {
      onProjectOrderChange?.(payload)
    })
    .subscribe((status) => {
      onStatusChange?.(status) // 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'
    })

  return () => supabase.removeChannel(channel)
}

// --- アウトライン（Quietliner 側）---
// 木を行ごとに置く。丸ごと1件にすると、2台で触ったときに片方が消える。
const OUTLINE_TABLE = 'outline_nodes'
let outlineTableMissing = false

export function isOutlineTableMissing() {
  return outlineTableMissing
}

export function outlineTableSql() {
  return `create table if not exists outline_nodes (
  id            text primary key,
  parent_id     text,
  sort_order    integer not null default 0,
  text          text    not null default '',
  collapsed     boolean not null default false,
  completed     boolean not null default false,
  favorite      boolean not null default false,
  heading_level integer,
  text_color    text,
  bg_color      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists outline_nodes_parent_idx on outline_nodes (parent_id, sort_order);`
}

// 置き場が無いときのエラーを見分ける（テーブル未作成）
function looksLikeMissingTable(error) {
  if (!error) return false
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''} ${error.code ?? ''}`
  return /42P01|PGRST205|PGRST106/.test(text) || /relation .*outline_nodes.* does not exist/i.test(text)
     || (/could not find the table/i.test(text) && /outline_nodes/i.test(text))
}

function outlineRowToNode(r) {
  return {
    id: r.id,
    parentId: r.parent_id ?? null,
    sortOrder: r.sort_order ?? 0,
    text: r.text ?? '',
    collapsed: !!r.collapsed,
    completed: !!r.completed,
    favorite: !!r.favorite,
    headingLevel: r.heading_level ?? null,
    textColor: r.text_color ?? null,
    bgColor: r.bg_color ?? null,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
  }
}

function outlineNodeToRow(n) {
  return {
    id: n.id,
    parent_id: n.parentId ?? null,
    sort_order: n.sortOrder ?? 0,
    text: n.text ?? '',
    collapsed: !!n.collapsed,
    completed: !!n.completed,
    favorite: !!n.favorite,
    heading_level: n.headingLevel ?? null,
    text_color: n.textColor ?? null,
    bg_color: n.bgColor ?? null,
    created_at: n.createdAt || new Date().toISOString(),
    updated_at: n.updatedAt || new Date().toISOString(),
  }
}

// 読む。置き場が無ければ null を返し、手元のものだけで動かす。
export async function loadOutlineRows() {
  if (!isSupabaseEnabled) return null
  const { data, error } = await supabase.from(OUTLINE_TABLE).select('*').order('sort_order')
  if (error) {
    if (looksLikeMissingTable(error)) { outlineTableMissing = true; return null }
    console.error('[db] outline load error', error)
    return null
  }
  outlineTableMissing = false
  return (data || []).map(outlineRowToNode)
}

// 変わった行だけ送り、消した行は向こうからも消す
// 一度に送る量。取り込みや一括削除では万単位になるので、必ず小分けにする。
//   送る側（upsert）は中身が大きいので 500
//   消す側（delete）は id が URL に並ぶので、もっと細かく 200
export function chunk(list, size) {
  const out = []
  for (let at = 0; at < list.length; at += size) out.push(list.slice(at, at + size))
  return out
}

export async function saveOutlineRows(rows, deletedIds = []) {
  if (!isSupabaseEnabled || outlineTableMissing) return null

  // 消すほうも小分けにする。まとめて投げると URL が長すぎて届かず、
  // 消したはずの行が次の読み込みで戻ってくる。
  for (const part of chunk(deletedIds, 200)) {
    const { error } = await supabase.from(OUTLINE_TABLE).delete().in('id', part)
    if (error) {
      if (looksLikeMissingTable(error)) { outlineTableMissing = true; return null }
      console.error('[db] outline delete error', error)
      return error.message || String(error)
    }
  }

  for (const part of chunk(rows, 500)) {
    const { error } = await supabase.from(OUTLINE_TABLE).upsert(part.map(outlineNodeToRow), { onConflict: 'id' })
    if (error) {
      if (looksLikeMissingTable(error)) { outlineTableMissing = true; return null }
      console.error('[db] outline save error', error)
      return error.message || String(error)
    }
  }
  return null
}
