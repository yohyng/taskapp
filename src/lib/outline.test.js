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

import {
  insertChild, moveSibling, deleteNodeSafe, deleteNodeKeepChildren, mergeNext,
  countChars, hasStoredBody, collectFavorites, extractTags, collectAllTags, truncateTitle,
} from './outline.js'

describe('子の先頭に入れる', () => {
  it('ズームの題で改行したら、いちばん上の子になる', () => {
    const tree = [n('親', [n('先客')])]
    const got = insertChild(tree, idOf(tree, '親'), makeNode('新入り'))
    expect(texts(got)).toEqual(['親', '  新入り', '  先客'])
  })

  it('畳んでいても開いて入れる', () => {
    let tree = [n('親', [n('子')])]
    tree = toggleCollapse(tree, idOf(tree, '親'))
    const got = insertChild(tree, idOf(tree, '親'), makeNode('新'))
    expect(texts(got)).toEqual(['親', '  新', '  子'])
  })
})

describe('兄弟のあいだで動かす', () => {
  it('上の兄弟と入れ替わる（木ごと）', () => {
    const tree = [n('A'), n('B', [n('B1')])]
    expect(texts(moveSibling(tree, idOf(tree, 'B'), -1))).toEqual(['B', '  B1', 'A'])
  })

  it('端では動かない', () => {
    const tree = [n('A'), n('B')]
    expect(moveSibling(tree, idOf(tree, 'A'), -1)).toBe(tree)
    expect(moveSibling(tree, idOf(tree, 'B'), 1)).toBe(tree)
  })

  it('親をまたいでは動かない', () => {
    const tree = [n('A', [n('A1')]), n('B')]
    expect(moveSibling(tree, idOf(tree, 'A1'), 1)).toBe(tree)
  })
})

describe('消したあとの行き先', () => {
  it('前の行に移る', () => {
    const tree = [n('A'), n('B'), n('C')]
    const got = deleteNodeSafe(tree, idOf(tree, 'B'))
    expect(texts(got.nodes)).toEqual(['A', 'C'])
    expect(got.focusId).toBe(idOf(tree, 'A'))
  })

  it('いちばん上を消したら、次の行に移る', () => {
    const tree = [n('A'), n('B')]
    const got = deleteNodeSafe(tree, idOf(tree, 'A'))
    expect(got.focusId).toBe(idOf(tree, 'B'))
  })

  it('最後の1行を消しても、空の行が残る', () => {
    const tree = [n('ひとつだけ')]
    const got = deleteNodeSafe(tree, idOf(tree, 'ひとつだけ'))
    expect(got.nodes).toHaveLength(1)
    expect(got.nodes[0].text).toBe('')
    expect(got.focusId).toBe(got.nodes[0].id)
  })

  it('子を残して消すと、子が自分の場所に繰り上がる', () => {
    const tree = [n('A'), n('B', [n('B1'), n('B2')]), n('C')]
    const got = deleteNodeKeepChildren(tree, idOf(tree, 'B'))
    expect(texts(got.nodes)).toEqual(['A', 'B1', 'B2', 'C'])
  })
})

describe('行末の Delete', () => {
  it('次の行を引き上げてくっつける', () => {
    const tree = [n('あい'), n('うえ')]
    const got = mergeNext(tree, idOf(tree, 'あい'))
    expect(texts(got.nodes)).toEqual(['あいうえ'])
    expect(got.caret).toBe(2)
  })

  it('次の行が子を持っているときは、何もしない', () => {
    const tree = [n('A'), n('B', [n('B1')])]
    expect(mergeNext(tree, idOf(tree, 'A')).nodes).toBe(tree)
  })

  it('いちばん下では何もしない', () => {
    const tree = [n('A')]
    expect(mergeNext(tree, idOf(tree, 'A')).nodes).toBe(tree)
  })
})

describe('見た目のための数え方', () => {
  it('下にある文字も数える', () => {
    expect(countChars(n('あい', [n('うえお')]))).toBe(5)
  })

  it('中身の多い行は、点に輪をつける', () => {
    expect(hasStoredBody(n('みじかい'))).toBe(false)
    expect(hasStoredBody(n('ある\n改行'))).toBe(true)
    expect(hasStoredBody(n('親', [n('あ'.repeat(41))]))).toBe(true)
  })

  it('星つきを上から集める', () => {
    const tree = [{ ...n('A', [{ ...n('A1'), favorite: true }]) }, { ...n('B'), favorite: true }]
    expect(collectFavorites(tree).map((x) => x.text)).toEqual(['A1', 'B'])
  })
})

describe('タグ', () => {
  it('#のあとを拾い、小文字にそろえる', () => {
    expect(extractTags('これは #Memo と #仕事 のはなし')).toEqual(['memo', '仕事'])
  })

  it('句読点では切る', () => {
    expect(extractTags('#メモ、あと')).toEqual(['メモ'])
  })

  it('木ぜんたいから集めて並べる', () => {
    const tree = [n('#b のこと', [n('#a と #b')])]
    expect(collectAllTags(tree)).toEqual(['a', 'b'])
  })
})

describe('パンくずの文字', () => {
  it('長いものは切って … を足す', () => {
    expect(truncateTitle('あ'.repeat(30))).toBe('あ'.repeat(18) + '…')
  })

  it('空なら無題', () => {
    expect(truncateTitle('   ')).toBe('無題')
  })
})

import { extractImportItems, rekey, appendImported, buildExport, filterByQuery, splitByQuery } from './outline.js'

describe('持ち込み', () => {
  it('Quietliner の書き出し（items）を読める', () => {
    const got = extractImportItems({ version: 4, items: [{ text: 'あ', children: [{ text: 'い' }] }] })
    expect(got).toHaveLength(1)
    expect(got[0].children[0].text).toBe('い')
  })

  it('置き場所の名前が違っても拾う', () => {
    for (const key of ['nodes', 'outline']) {
      expect(extractImportItems({ [key]: [{ text: 'x' }] })[0].text).toBe('x')
    }
    expect(extractImportItems({ data: { nodes: [{ text: 'y' }] } })[0].text).toBe('y')
    expect(extractImportItems({ root: { children: [{ text: 'z' }] } })[0].text).toBe('z')
  })

  it('素の配列も読める', () => {
    expect(extractImportItems([{ text: 'なま' }])[0].text).toBe('なま')
  })

  it('読めないものは、理由を言って断る', () => {
    expect(() => extractImportItems({ hello: 1 })).toThrow(/アウトライン/)
    expect(() => extractImportItems({ items: [] })).toThrow(/空/)
    expect(() => extractImportItems("ちがう")).toThrow()
  })

  it('id を振り直すので、元とぶつからない', () => {
    const src = { ...makeNode('おや'), children: [makeNode('こ')] }
    const got = rekey(src)
    expect(got.id).not.toBe(src.id)
    expect(got.children[0].id).not.toBe(src.children[0].id)
    expect(got.children[0].text).toBe('こ')
  })

  it('後ろに足す（いまあるものは消さない）', () => {
    const now = [n('いまのこる')]
    const got = appendImported(now, [{ ...makeNode('もってきた') }])
    expect(texts(got)).toEqual(['いまのこる', 'もってきた'])
  })

  it('同じ名前の親があれば、その中にまとめる', () => {
    const now = [n('Diary', [n('10/1')])]
    const got = appendImported(now, [{ ...makeNode('Diary'), children: [makeNode('10/2')] }])
    expect(texts(got)).toEqual(['Diary', '  10/1', '  10/2'])
  })

  it('持ち出したものを、そのまま読み戻せる', () => {
    const tree = [n('あ', [n('い')])]
    const back = extractImportItems(JSON.parse(JSON.stringify(buildExport(tree))))
    expect(texts(back)).toEqual(['あ', '  い'])
  })
})

describe('探す', () => {
  const tree = [
    n('買いもの', [n('牛乳'), n('パン')]),
    n('仕事', [n('資料づくり', [n('牛乳の件')])]),
  ]

  it('当たった行と、その親だけが残る', () => {
    expect(texts(filterByQuery(tree, '牛乳')))
      .toEqual(['買いもの', '  牛乳', '仕事', '  資料づくり', '    牛乳の件'])
  })

  it('大文字小文字は区別しない', () => {
    expect(texts(filterByQuery([n('Memo'), n('ほか')], 'memo'))).toEqual(['Memo'])
  })

  it('当たった親の子は、そのまま見せる', () => {
    expect(texts(filterByQuery(tree, '買いもの'))).toEqual(['買いもの', '  牛乳', '  パン'])
  })

  it('畳んであっても、探しているあいだは開く', () => {
    let t = [n('おや', [n('さがしもの')])]
    t = toggleCollapse(t, idOf(t, 'おや'))
    expect(texts(filterByQuery(t, 'さがしもの'))).toEqual(['おや', '  さがしもの'])
  })

  it('#タグでも絞れる', () => {
    const t = [n('これは #memo です'), n('ちがう')]
    expect(texts(filterByQuery(t, '#memo'))).toEqual(['これは #memo です'])
  })

  it('空なら、そのまま全部', () => {
    expect(filterByQuery(tree, '   ')).toBe(tree)
  })

  it('当たりが無ければ、空になる', () => {
    expect(filterByQuery(tree, 'ありません')).toEqual([])
  })
})

describe('当たったところに印をつける', () => {
  it('前後に分けて返す', () => {
    expect(splitByQuery('あいうえお', 'うえ')).toEqual([
      { text: 'あい', hit: false }, { text: 'うえ', hit: true }, { text: 'お', hit: false },
    ])
  })

  it('いくつあっても分ける', () => {
    expect(splitByQuery('aXaXa', 'x').filter((p) => p.hit)).toHaveLength(2)
  })

  it('探していないときは、そのまま', () => {
    expect(splitByQuery('あい', '')).toEqual([{ text: 'あい', hit: false }])
  })
})

import { moveSubtreeTo } from './outline.js'

describe('ドラッグで動かす', () => {
  const tree = () => [
    n('A', [n('A1'), n('A2')]),
    n('B'),
    n('C', [n('C1')]),
  ]

  it('いちばん上に落とす', () => {
    const t = tree()
    expect(texts(moveSubtreeTo(t, idOf(t, 'B'), null, 0)))
      .toEqual(['B', 'A', '  A1', '  A2', 'C', '  C1'])
  })

  it('ある行の下に、並びとして入れる', () => {
    const t = tree()
    // A1 の下・深さ1 ＝ A の子のまま、A1 の次
    expect(texts(moveSubtreeTo(t, idOf(t, 'B'), idOf(t, 'A1'), 1)))
      .toEqual(['A', '  A1', '  B', '  A2', 'C', '  C1'])
  })

  it('直前の行より深ければ、その中に入る', () => {
    const t = tree()
    // C の下・深さ1 ＝ C の子の先頭
    expect(texts(moveSubtreeTo(t, idOf(t, 'B'), idOf(t, 'C'), 1)))
      .toEqual(['A', '  A1', '  A2', 'C', '  B', '  C1'])
  })

  it('浅い段を指せば、親の外に出る', () => {
    const t = tree()
    // A2 の下・深さ0 ＝ A の次（根の並び）
    expect(texts(moveSubtreeTo(t, idOf(t, 'B'), idOf(t, 'A2'), 0)))
      .toEqual(['A', '  A1', '  A2', 'B', 'C', '  C1'])
  })

  it('子も一緒に動く', () => {
    const t = tree()
    expect(texts(moveSubtreeTo(t, idOf(t, 'C'), null, 0)))
      .toEqual(['C', '  C1', 'A', '  A1', '  A2', 'B'])
  })

  it('自分の中には入れない', () => {
    const t = tree()
    expect(moveSubtreeTo(t, idOf(t, 'A'), idOf(t, 'A1'), 2)).toBe(t)
  })

  it('畳んである行の中に入れるときは、開く', () => {
    let t = [n('A', [n('A1')]), n('B')]
    t = toggleCollapse(t, idOf(t, 'A'))
    const got = moveSubtreeTo(t, idOf(t, 'B'), idOf(t, 'A'), 1)
    expect(findNode(got, idOf(got, 'A')).collapsed).toBe(false)
    expect(texts(got)).toEqual(['A', '  B', '  A1'])
  })
})

import { flattenTree, buildTree, mergeOutline } from './outline.js'

describe('木と行の行き来', () => {
  const tree = [n('A', [n('A1'), n('A2', [n('A2a')])]), n('B')]

  it('平らにすると、親と並び順を持つ', () => {
    const rows = flattenTree(tree)
    expect(rows.map((r) => r.text)).toEqual(['A', 'A1', 'A2', 'A2a', 'B'])
    const a2a = rows.find((r) => r.text === 'A2a')
    expect(a2a.parentId).toBe(rows.find((r) => r.text === 'A2').id)
    expect(rows.find((r) => r.text === 'B').sortOrder).toBe(1)
  })

  it('行から元の木に戻る', () => {
    expect(texts(buildTree(flattenTree(tree)))).toEqual(texts(tree))
  })

  it('並び順が入れ替わっていても、順に戻す', () => {
    const rows = flattenTree(tree).reverse()
    expect(texts(buildTree(rows))).toEqual(texts(tree))
  })

  it('親が見つからない行は、根に置いて捨てない', () => {
    const rows = [{ id: 'x', parentId: 'いない', sortOrder: 0, text: 'まいご' }]
    expect(texts(buildTree(rows))).toEqual(['まいご'])
  })

  it('色や見出しも行き来で消えない', () => {
    const fancy = [{ ...makeNode('見出し'), headingLevel: 2, textColor: '#e03535', bgColor: 'rgba(0,0,0,0.1)' }]
    const back = buildTree(flattenTree(fancy))[0]
    expect(back).toMatchObject({ headingLevel: 2, textColor: '#e03535', bgColor: 'rgba(0,0,0,0.1)' })
  })
})

describe('手元と向こうを突き合わせる', () => {
  const stamp = (node, t) => ({ ...node, updatedAt: t })

  it('向こうにしかない行は、持ってくる', () => {
    const local = [n('てもと')]
    const remote = [n('むこう')]
    expect(texts(mergeOutline(local, remote)).sort()).toEqual(['てもと', 'むこう'])
  })

  it('同じ行は、新しいほうを採る', () => {
    const base = makeNode('ふるい')
    const local = [stamp({ ...base, text: 'てもとで直した' }, '2026-01-02T00:00:00Z')]
    const remote = [stamp({ ...base, text: 'むこうで直した' }, '2026-01-01T00:00:00Z')]
    expect(texts(mergeOutline(local, remote))).toEqual(['てもとで直した'])
    expect(texts(mergeOutline(remote, local))).toEqual(['てもとで直した'])
  })

  it('消した行は、向こうに残っていても戻ってこない', () => {
    const gone = makeNode('消したやつ')
    expect(mergeOutline([], [gone], new Set([gone.id]))).toEqual([])
  })

  it('親子の形は保たれる', () => {
    const tree = [n('おや', [n('こ')])]
    expect(texts(mergeOutline(tree, tree))).toEqual(['おや', '  こ'])
  })
})

import { addMemoUnderDate } from './outline.js'

describe('その日のメモ', () => {
  it('日付の行が無ければ作って、いちばん上に置く', () => {
    const got = addMemoUnderDate([n('さきにあった')], '2026-10-16', 'おもいつき')
    expect(texts(got.nodes)).toEqual(['2026-10-16', '  おもいつき', 'さきにあった'])
  })

  it('同じ日が既にあれば、その中の後ろに足す', () => {
    const base = addMemoUnderDate([], '2026-10-16', 'ひとつめ').nodes
    const got = addMemoUnderDate(base, '2026-10-16', 'ふたつめ')
    expect(texts(got.nodes)).toEqual(['2026-10-16', '  ひとつめ', '  ふたつめ'])
  })

  it('畳んであっても開いて入れる', () => {
    let base = addMemoUnderDate([], '2026-10-16', 'ひとつめ').nodes
    base = toggleCollapse(base, base[0].id)
    const got = addMemoUnderDate(base, '2026-10-16', 'ふたつめ')
    expect(findNode(got.nodes, got.dayId).collapsed).toBe(false)
  })

  it('別の日は、別の行になる', () => {
    const base = addMemoUnderDate([], '2026-10-15', 'きのう').nodes
    const got = addMemoUnderDate(base, '2026-10-16', 'きょう')
    expect(texts(got.nodes)).toEqual(['2026-10-16', '  きょう', '2026-10-15', '  きのう'])
  })

  it('足した行の id を返す', () => {
    const got = addMemoUnderDate([], '2026-10-16', 'めも')
    expect(findNode(got.nodes, got.id).text).toBe('めも')
  })
})

import { indentMany, outdentMany, removeMany, patchMany, textOf, rangeBetween } from './outline.js'

describe('まとめて操作する', () => {
  it('続いた行を、まとめて字下げできる', () => {
    const t = [n('A'), n('B'), n('C')]
    const got = indentMany(t, [idOf(t, 'B'), idOf(t, 'C')])
    expect(texts(got)).toEqual(['A', '  B', '  C'])
  })

  it('まとめて戻すと、並びのまま浅くなる', () => {
    const t = [n('A', [n('B'), n('C')])]
    const got = outdentMany(t, [idOf(t, 'B'), idOf(t, 'C')])
    expect(texts(got)).toEqual(['A', 'B', 'C'])
  })

  it('まとめて消せる。全部消したら空の行が残る', () => {
    const t = [n('A'), n('B')]
    expect(texts(removeMany(t, [idOf(t, 'A')]))).toEqual(['B'])
    const all = removeMany(t, [idOf(t, 'A'), idOf(t, 'B')])
    expect(all).toHaveLength(1)
    expect(all[0].text).toBe('')
  })

  it('まとめて印をつけられる', () => {
    const t = [n('A'), n('B')]
    const got = patchMany(t, [idOf(t, 'A'), idOf(t, 'B')], { completed: true })
    expect(got.every((x) => x.completed)).toBe(true)
  })

  it('字下げつきの文章にできる', () => {
    const t = [n('A', [n('A1')]), n('B')]
    expect(textOf(t)).toBe('A\n  A1\nB')
  })

  it('選んだぶんだけ文章にする', () => {
    const t = [n('A', [n('A1')]), n('B')]
    expect(textOf(t, [idOf(t, 'A'), idOf(t, 'A1')])).toBe('A\n  A1')
  })

  it('2つの行のあいだを、画面の順で選ぶ', () => {
    const t = [n('A', [n('A1')]), n('B')]
    expect(rangeBetween(t, idOf(t, 'A'), idOf(t, 'B')))
      .toEqual([idOf(t, 'A'), idOf(t, 'A1'), idOf(t, 'B')])
  })

  it('逆向きに選んでも同じ', () => {
    const t = [n('A'), n('B')]
    expect(rangeBetween(t, idOf(t, 'B'), idOf(t, 'A'))).toEqual([idOf(t, 'A'), idOf(t, 'B')])
  })
})
