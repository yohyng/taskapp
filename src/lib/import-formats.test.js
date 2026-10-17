import { describe, it, expect } from 'vitest'
import { parseIndentedMarkdown } from './import-formats.js'

// 深さぶんの字下げで形を見る
const shapeOf = (nodes, d = 0, out = []) => {
  for (const n of nodes) {
    out.push('  '.repeat(d) + n.text.replace(/\n/g, '⏎'))
    shapeOf(n.children || [], d + 1, out)
  }
  return out
}

describe('字下げの箇条書きを読む', () => {
  it('親子の深さをそのまま読む', () => {
    expect(shapeOf(parseIndentedMarkdown([
      '- 2026',
      '  - 2026-01',
      '    - 正月のこと',
      '- 2025',
    ].join('\n')))).toEqual(['2026', '  2026-01', '    正月のこと', '2025'])
  })

  it('段落のあいだに空行があっても、親子が崩れない', () => {
    // 空行で続きが切れたぶんを根に落とすと、そこから下がぜんぶずれてしまう
    const got = parseIndentedMarkdown([
      '- 01｜ARCHIVE',
      '  - 2026',
      '    - 2026-03-25',
      '      - 今日のこと',
      '        ',
      '        二段落目',
      '- 02｜THINKING',
      '  - 論考',
    ].join('\n'))
    expect(got.map((n) => n.text)).toEqual(['01｜ARCHIVE', '02｜THINKING'])
    expect(shapeOf(got)).toEqual([
      '01｜ARCHIVE', '  2026', '    2026-03-25', '      今日のこと⏎二段落目',
      '02｜THINKING', '  論考',
    ])
  })

  it('字下げの中にある見出しは、そこの行として読む', () => {
    // 行頭でない ## は、箇条書きの中身。ここで深さを入れ替えると以降がずれる
    const got = parseIndentedMarkdown([
      '- 本',
      '  - 章',
      '    ## 1. 本物の木',
      '    - つづき',
      '- 次の本',
    ].join('\n'))
    expect(got.map((n) => n.text)).toEqual(['本', '次の本'])
    expect(shapeOf(got)).toEqual(['本', '  章', '    1. 本物の木', '    つづき', '次の本'])
  })

  it('行頭の見出しは、その下のまとまりの親になる', () => {
    expect(shapeOf(parseIndentedMarkdown([
      '# まとめ',
      '- ひとつ',
      '- ふたつ',
    ].join('\n')))).toEqual(['まとめ', '  ひとつ', '  ふたつ'])
  })

  it('チェックの印を読む', () => {
    const got = parseIndentedMarkdown('- [x] すんだ\n- [ ] まだ')
    expect(got.map((n) => n.completed)).toEqual([true, false])
  })
})
