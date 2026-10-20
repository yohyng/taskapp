import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readDriveSetting, writeDriveSetting, hasDrive, uploadToDrive, pingDrive, backupToDrive, hoursSinceBackup } from './drive.js'

// localStorage と fetch を、この試験のあいだだけ置き換える
const store = new Map()
beforeEach(() => {
  store.clear()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
})
const reply = (obj, ok = true) => vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => obj })
const fakeFile = (name = 'a.png', type = 'image/png') => ({
  name, type,
  // FileReader の代わり（toBase64 が使う）
})

describe('置き場の設定', () => {
  it('入れたものを読み出せる', () => {
    writeDriveSetting({ url: 'https://script.google.com/x/exec', token: 'ひみつ' })
    expect(readDriveSetting()).toEqual({ url: 'https://script.google.com/x/exec', token: 'ひみつ' })
    expect(hasDrive()).toBe(true)
  })

  it('URL が無ければ、置き場なしとして扱う', () => {
    expect(hasDrive()).toBe(false)
  })
})

describe('画像を置く', () => {
  it('置き場が無ければ、理由を言って断る', async () => {
    await expect(uploadToDrive(fakeFile())).rejects.toThrow(/置き場/)
  })

  it('返ってきた URL を渡す', async () => {
    writeDriveSetting({ url: 'https://x/exec', token: 't' })
    globalThis.fetch = reply({ id: 'abc', url: 'https://drive.google.com/thumbnail?id=abc&sz=w1600' })
    // FileReader を使わずに済むよう、base64 済みのものを渡す
    globalThis.FileReader = class {
      readAsDataURL() { this.onload({ }); }
      get result() { return 'data:image/png;base64,QUJD' }
    }
    const got = await uploadToDrive(fakeFile())
    expect(got.url).toContain('thumbnail?id=abc')

    const sent = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    expect(sent).toMatchObject({ token: 't', mimeType: 'image/png', dataBase64: 'QUJD' })
    // 先に OPTIONS を飛ばさないよう、Content-Type は付けない
    expect(globalThis.fetch.mock.calls[0][1].headers).toBeUndefined()
  })

  it('置き場が断ってきたら、その理由を出す', async () => {
    writeDriveSetting({ url: 'https://x/exec', token: 'ちがう' })
    globalThis.fetch = reply({ error: '合言葉が違います' })
    globalThis.FileReader = class {
      readAsDataURL() { this.onload({}); }
      get result() { return 'data:image/png;base64,QUJD' }
    }
    await expect(uploadToDrive(fakeFile())).rejects.toThrow('合言葉が違います')
  })
})

describe('つながるか試す', () => {
  it('合言葉を付けて聞きにいく', async () => {
    writeDriveSetting({ url: 'https://x/exec', token: 'ひみつ' })
    globalThis.fetch = reply({ ok: true, folder: '画像' })
    const got = await pingDrive()
    expect(got.folder).toBe('画像')
    expect(globalThis.fetch.mock.calls[0][0]).toContain('token=%E3%81%B2%E3%81%BF%E3%81%A4')
  })

  it('つながらなければ、そう言う', async () => {
    writeDriveSetting({ url: 'https://x/exec', token: '' })
    globalThis.fetch = reply({}, false)
    await expect(pingDrive()).rejects.toThrow(/つながりません/)
  })
})

// 縮めて送られたぶんを、もとに戻す
async function ungzip(b64) {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const out = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(out).text()
}

describe('控え', () => {
  it('控えると、いつ控えたか覚える', async () => {
    writeDriveSetting({ url: 'https://x/exec', token: 't' })
    globalThis.fetch = reply({ ok: true, name: 'taskspace-2026-10-17-10-00.json' })
    expect(hoursSinceBackup()).toBe(Infinity)

    const got = await backupToDrive({ hello: 1 })
    expect(got.name).toContain('taskspace-')
    expect(hoursSinceBackup()).toBeLessThan(1)

    const sent = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    expect(sent.kind).toBe('backup')
    // 大きさ対策で縮めて送る。縮められない環境では、そのまま。
    const text = sent.json ?? await ungzip(sent.gzipBase64)
    expect(JSON.parse(text)).toEqual({ hello: 1 })
  })

  it('断られたときは、覚えない', async () => {
    writeDriveSetting({ url: 'https://x/exec', token: 't' })
    globalThis.fetch = reply({ error: 'だめ' })
    await expect(backupToDrive({})).rejects.toThrow('だめ')
    expect(hoursSinceBackup()).toBe(Infinity)
  })
})

import { tidyName } from './drive.js'

describe('ドライブに並ぶ名前', () => {
  const at = new Date('2026-10-17T21:31:00')
  const file = (name, type) => ({ name, type })

  it('日付と時刻、行の文字、拡張子で作る', () => {
    const got = tidyName(file('image.png', 'image/png'), '打ち合わせのメモ', at)
    expect(got).toMatch(/^2026-10-17_2131_打ち合わせのメモ_[a-z0-9]{6}\.png$/)
  })

  it('貼り付けの image.png は、行の文字のほうを使う', () => {
    expect(tidyName(file('image.png', 'image/png'), '', at)).toMatch(/^2026-10-17_2131_[a-z0-9]{6}\.png$/)
  })

  it('もとの名前が意味を持つときは、それを使う', () => {
    expect(tidyName(file('ねこ.jpg', 'image/jpeg'), '', at)).toMatch(/^2026-10-17_2131_ねこ_[a-z0-9]{6}\.jpg$/)
  })

  it('名前に使えない字と URL は落とす', () => {
    const got = tidyName(file('a.png', 'image/png'), 'これ/を:みて https://example.com/x', at)
    expect(got).not.toMatch(/[/:*?"<>|]/)
    expect(got).toContain('これ-を-みて')
  })

  it('長い行は切り詰める', () => {
    const got = tidyName(file('a.png', 'image/png'), 'あ'.repeat(200), at)
    expect(got.length).toBeLessThan(80)
  })
})
