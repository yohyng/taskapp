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
