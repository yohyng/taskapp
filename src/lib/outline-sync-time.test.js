import { describe, it, expect } from 'vitest'
import { ensureNode, flattenTree, buildTree, applyRemoteRows, mergeOutline, outlineRowSignature } from './outline.js'

const at = '2026-10-22T03:00:00.123Z'
const row = () => flattenTree([ensureNode({ id: 'a', text: '本文', createdAt: at, updatedAt: at })])[0]

describe('アウトラインの時刻と再送判定', () => {
  it('同じ瞬間のUTC表記・桁数・時差だけでは送り直さない', () => {
    const mine = row()
    for (const time of ['2026-10-22T03:00:00.123000+00:00', '2026-10-22T12:00:00.123+09:00']) {
      expect(outlineRowSignature({ ...mine, createdAt: time, updatedAt: time })).toBe(outlineRowSignature(mine))
    }
    expect(mine.updatedAt).toBe(at)
  })
  it('本文やミリ秒未満の違いは同一視しない', () => {
    const mine = row()
    expect(outlineRowSignature({ ...mine, text: '別の本文' })).not.toBe(outlineRowSignature(mine))
    expect(outlineRowSignature({ ...mine, updatedAt: '2026-10-22T03:00:00.123001Z' })).not.toBe(outlineRowSignature(mine))
  })
  it('空や不明な時刻に現在時刻を付けて更新扱いしない', () => {
    for (const time of [null, '', '不明']) {
      const mine = { ...row(), createdAt: time, updatedAt: time }
      expect(JSON.parse(outlineRowSignature(mine)).updatedAt).toBe(time)
    }
  })
  it('自分の受信通知が届いても次の差分を作らない', () => {
    const mine = row()
    const echo = { ...mine, createdAt: '2026-10-22T03:00:00.123+00:00', updatedAt: '2026-10-22T03:00:00.123+00:00' }
    const next = flattenTree(applyRemoteRows(buildTree([mine]), [echo]))[0]
    expect(outlineRowSignature(next)).toBe(outlineRowSignature(echo))
  })
  it('読み直しでも時差表記に引きずられず新しい本文を採る', () => {
    const local = { ...row(), updatedAt: '2026-10-22T12:00:00+09:00' }
    const remote = { ...row(), text: '新しい本文', updatedAt: '2026-10-22T03:00:01Z' }
    expect(mergeOutline(buildTree([local]), buildTree([remote]))[0].text).toBe('新しい本文')
  })
  it('受信が古ければ時差表記が大きく見えても手元を残す', () => {
    const local = { ...row(), text: '手元の新しい本文', updatedAt: '2026-10-22T03:00:01Z' }
    const remote = { ...row(), updatedAt: '2026-10-22T12:00:00+09:00' }
    expect(applyRemoteRows(buildTree([local]), [remote])[0].text).toBe('手元の新しい本文')
  })
  it('マイクロ秒単位の前後関係も守る', () => {
    const local = { ...row(), updatedAt: '2026-10-22T03:00:00.123002Z' }
    const remote = { ...row(), updatedAt: '2026-10-22T03:00:00.123001+00:00', text: '古い本文' }
    expect(applyRemoteRows(buildTree([local]), [remote])[0].text).toBe(local.text)
  })
})
