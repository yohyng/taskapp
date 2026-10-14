import { describe, it, expect } from 'vitest'
import { mergeKeepingLocal } from './App.jsx'

// Supabase から戻ってきた行で、手元の段組みがほどけないこと
const remote = { id: 'a', title: 'みだし', blockType: 'task', rowKey: null, col: 0, colWidth: null }
const local = { id: 'a', title: 'みだし', blockType: 'column', rowKey: 'r1', col: 2, colWidth: 1.5 }

describe('向こうが知らない項目は、手元を残す', () => {
  it('列そのものが無いときは、手元の値をそのまま残す', () => {
    const out = mergeKeepingLocal(remote, local, ['blockType', 'rowKey', 'col', 'colWidth'], [])
    expect(out).toMatchObject({ blockType: 'column', rowKey: 'r1', col: 2, colWidth: 1.5 })
  })

  it('列ができた直後は、向こうが空のときだけ手元を残す', () => {
    const out = mergeKeepingLocal(remote, local, [], ['blockType', 'rowKey', 'col'])
    expect(out).toMatchObject({ blockType: 'column', rowKey: 'r1', col: 2 })
  })

  it('向こうに値があるときは、向こうを採る（ほかの端末の変更を消さない）', () => {
    const edited = { ...remote, rowKey: 'r9', col: 1, blockType: 'heading1' }
    const out = mergeKeepingLocal(edited, local, [], ['blockType', 'rowKey', 'col'])
    expect(out).toMatchObject({ blockType: 'heading1', rowKey: 'r9', col: 1 })
  })

  it('手元に無い行は、そのまま受け取る', () => {
    expect(mergeKeepingLocal(remote, undefined, ['rowKey'], [])).toBe(remote)
  })

  it('タイトルなど、ふだんの項目には手を出さない', () => {
    const out = mergeKeepingLocal({ ...remote, title: 'あたらしい名前' }, local, ['rowKey'], [])
    expect(out.title).toBe('あたらしい名前')
  })
})
