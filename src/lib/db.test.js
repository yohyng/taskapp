import { describe, it, expect } from 'vitest'
import { optionalColumnsSql, missingOptionalColumn } from './db.js'

describe('任意列の作り方を知らせる', () => {
  const sql = optionalColumnsSql()

  it('段組み・ブロック種別の置き場が全部そろっている', () => {
    for (const name of ['block_type', 'row_key', 'col_index', 'col_width', 'code_lang', 'day_date', 'page_id', 'style', 'stock', 'stock_view_id', 'canvas_x', 'canvas_y']) {
      expect(sql).toContain(`add column if not exists ${name} `)
    }
  })

  it('既にある列を壊さない（if not exists 付き・1行1文）', () => {
    const lines = sql.split('\n')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).toMatch(/^alter table tasks add column if not exists \w+ .+;$/)
    }
  })

  it('数と真偽の列に text を当てていない', () => {
    expect(sql).toContain('col_index integer')
    expect(sql).toContain('col_width real')
    expect(sql).toContain('stock boolean')
  })

  it('PostgREST の列なしエラーから列名を拾える', () => {
    expect(missingOptionalColumn({ code: 'PGRST204', message: "Could not find the 'col_width' column of 'tasks'" })).toBe('col_width')
    // 短い名前に引っぱられない
    expect(missingOptionalColumn({ code: 'PGRST204', message: "Could not find the 'stock_view_id' column" })).toBe('stock_view_id')
    expect(missingOptionalColumn(null)).toBe(null)
  })
})

describe('列がまだ無いことを、行の形から見分ける', () => {
  it('列が無い行では、そのキーごと返ってこない', async () => {
    const { absentTaskColumns, fieldsForColumns } = await import('./db.js')
    const row = { id: '1', title: 'a', stock: false, style: null } // 段組みの列が無い
    const absent = absentTaskColumns([row])
    expect(absent).toContain('row_key')
    expect(absent).toContain('col_index')
    expect(absent).not.toContain('stock')
    // null は「列はあるが空」なので、無い扱いにしない
    expect(absent).not.toContain('style')
    expect(fieldsForColumns(['row_key', 'col_index'])).toEqual(['rowKey', 'col'])
  })

  it('1行も無いときは判断しない', async () => {
    const { absentTaskColumns } = await import('./db.js')
    expect(absentTaskColumns([])).toEqual([])
    expect(absentTaskColumns(null)).toEqual([])
  })
})

describe('アウトラインの置き場', () => {
  it('作るための SQL を出せる', async () => {
    const { outlineTableSql } = await import('./db.js')
    const sql = outlineTableSql()
    expect(sql).toContain('create table if not exists outline_nodes')
    // 行に戻すのに要るもの
    for (const col of ['parent_id', 'sort_order', 'text', 'collapsed', 'completed', 'favorite',
                       'heading_level', 'text_color', 'bg_color', 'updated_at']) {
      expect(sql).toContain(col)
    }
    // すでにあっても壊さない
    expect(sql).toContain('if not exists')
  })

  it('置き場が無ければ、同期せず手元だけで動く', async () => {
    const { loadOutlineRows, isOutlineTableMissing } = await import('./db.js')
    // Supabase を使わない設定のときは null（＝手元のまま）
    expect(await loadOutlineRows()).toBe(null)
    expect(typeof isOutlineTableMissing()).toBe('boolean')
  })
})
