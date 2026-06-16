import { supabase, isSupabaseEnabled } from './supabase'

const STORAGE_KEY = 'notion-like-taskdb-prototype-v4'

// --- camelCase <-> snake_case mappers ---

function taskToRow(t) {
  return {
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
  }
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
      supabase.from('tasks').select('*'),
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

    return {
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

    const results = await Promise.all([
      supabase.from('tasks').upsert(tasks.map(taskToRow), { onConflict: 'id' }),
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

export async function upsertTaskRow(task) {
  if (!isSupabaseEnabled) return null
  const { error } = await supabase.from('tasks').upsert(taskToRow(task), { onConflict: 'id' })
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
