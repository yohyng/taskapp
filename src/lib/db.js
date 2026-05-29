import { supabase, isSupabaseEnabled } from './supabase'

const STORAGE_KEY = 'notion-like-taskdb-prototype-v4'

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  } catch {
    return null
  }
}

function saveLocal(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export async function loadData() {
  if (isSupabaseEnabled) {
    // TODO: implement Supabase load
    // const { data } = await supabase.from('tasks').select('*')
    console.log('[db] Supabase enabled but load not yet implemented, falling back to localStorage')
  }
  return loadLocal()
}

export async function saveData(data) {
  saveLocal(data)
  if (isSupabaseEnabled) {
    // TODO: implement Supabase sync
    console.log('[db] Supabase enabled but sync not yet implemented')
  }
}
