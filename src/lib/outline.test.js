import { describe, it, expect } from 'vitest'
import {
  makeNode, ensureNode, pathTo, findNode, visibleRows,
  insertAfter, removeNode, indent, outdent, toggleCollapse, mergeIntoPrevious, updateNode,
} from './outline.js'

// 読みやすいよう、木を [text, [子…]] で組み立てる
const n = (text, children = []) => ({ ...makeNode(text), children })
const texts = (nodes) => visibleRows(nodes).map((r) => `${"  ".repeat(r.depth)}${r.node.text}`)
const idOf = (nodes, text) => visibleRows(nodes).find((r) => r.node.text === text).node.id

describe('形をそろえる', () => {
  it('足りない項目は埋める', () => {
    const got = ensureNode({ text: 'あ', children: [{ text: 'い' }] })
    expect(got).toMatchObject({ text: 'あ', collapsed: false, completed: false, favorite: false })
    expect(got.children[0].text).toBe('い')
    expect(got.id).toBeTruthy()
  })

  it('壊れていても落ちない', () => {
    expect(ensureNode(null).text).toBe('')
    expect(ensureNode({ children: 'ちがう' }).children).toEqual([])
  })
})

describe('画面に出る順', () => {
  const tree = [n('A', [n('A1'), n('A2', [n('A2a')])]), n('B')]

  it('深さつきで、上から順に出る', () => {
    expect(texts(tree)).toEqual(['A', '  A1', '  A2', '    A2a', 'B'])
  })

  it('畳んだ中は出ない', () => {
    const folded = toggleCollapse(tree, idOf(tree, 'A2'))
    expect(texts(folded)).toEqual(['A', '  A1', '  A2', 'B'])
  })
})

describe('字下げ', () => {
  it('ひとつ上の兄弟の子になる', () => {
    const tree = [n('A'), n('B')]
    expect(texts(indent(tree, idOf(tree, 'B')))).toEqual(['A', '  B'])
  })

  it('いちばん上は字下げできない', () => {
    const tree = [n('A'), n('B')]
    expect(indent(tree, idOf(tree, 'A'))).toBe(tree)
  })

  it('畳んである親に入れるときは、開く', () => {
    let tree = [n('A', [n('A1')]), n('B')]
    tree = toggleCollapse(tree, idOf(tree, 'A'))
    const got = indent(tree, idOf(tree, 'B'))
    expect(findNode(got, idOf(got, 'A')).collapsed).toBe(false)
    expect(texts(got)).toEqual(['A', '  A1', '  B'])
  })
})

describe('字下げを戻す', () => {
  it('親の次の兄弟になる', () => {
    const tree = [n('A', [n('A1')])]
    expect(texts(outdent(tree, idOf(tree, 'A1')))).toEqual(['A', 'A1'])
  })

  it('いちばん浅いところでは何もしない', () => {
    const tree = [n('A')]
    expect(outdent(tree, idOf(tree, 'A'))).toBe(tree)
  })

  it('自分より下にいた兄弟は、連れていく', () => {
    const tree = [n('A', [n('A1'), n('A2'), n('A3')])]
    expect(texts(outdent(tree, idOf(tree, 'A1'))))
      .toEqual(['A', 'A1', '  A2', '  A3'])
  })
})

describe('足す・消す', () => {
  it('子を持って開いているなら、その先頭に入る', () => {
    const tree = [n('A', [n('A1')])]
    const got = insertAfter(tree, idOf(tree, 'A'), makeNode('新'))
    expect(texts(got)).toEqual(['A', '  新', '  A1'])
  })

  it('畳んでいるときは、下の兄弟になる', () => {
    let tree = [n('A', [n('A1')]), n('B')]
    tree = toggleCollapse(tree, idOf(tree, 'A'))
    const got = insertAfter(tree, idOf(tree, 'A'), makeNode('新'))
    expect(texts(got)).toEqual(['A', '新', 'B'])
  })

  it('子の無い行の下には、兄弟として入る', () => {
    const tree = [n('A'), n('B')]
    expect(texts(insertAfter(tree, idOf(tree, 'A'), makeNode('新')))).toEqual(['A', '新', 'B'])
  })

  it('消すと、その行だけ消える', () => {
    const tree = [n('A', [n('A1')]), n('B')]
    expect(texts(removeNode(tree, idOf(tree, 'A1')))).toEqual(['A', 'B'])
  })
})

describe('行頭で前にくっつける', () => {
  it('前の行の末尾に足して、自分は消える', () => {
    const tree = [n('あい'), n('うえ')]
    const got = mergeIntoPrevious(tree, idOf(tree, 'うえ'))
    expect(texts(got.nodes)).toEqual(['あいうえ'])
    expect(got.caret).toBe(2) // くっつけた境目にカーソルが残る
  })

  it('いちばん上では何もしない', () => {
    const tree = [n('A'), n('B')]
    expect(mergeIntoPrevious(tree, idOf(tree, 'A')).nodes).toBe(tree)
  })

  it('子を持っている行は、消さない（中身の行き場が無くなるので）', () => {
    const tree = [n('A'), n('B', [n('B1')])]
    expect(mergeIntoPrevious(tree, idOf(tree, 'B')).nodes).toBe(tree)
  })
})

describe('道をたどる', () => {
  it('ルートからその行までの親が並ぶ', () => {
    const tree = [n('A', [n('A1', [n('A1a')])])]
    expect(pathTo(tree, idOf(tree, 'A1a')).map((x) => x.text)).toEqual(['A', 'A1', 'A1a'])
  })

  it('無いものは null', () => {
    expect(pathTo([n('A')], 'xxx')).toBe(null)
  })
})

describe('書き換え', () => {
  it('元の木は変えない', () => {
    const tree = [n('A')]
    const got = updateNode(tree, idOf(tree, 'A'), { text: 'B' })
    expect(tree[0].text).toBe('A')
    expect(got[0].text).toBe('B')
  })
})
