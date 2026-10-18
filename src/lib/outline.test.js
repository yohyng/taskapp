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

import { extractImportItems, importOutline, buildExport, filterByQuery, splitByQuery } from './outline.js'

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

  it('同じものを2回読んでも、増えずに更新される', () => {
    const payload = { items: [{ id: 'u1', text: 'もってきた', children: [{ id: 'u2', text: 'その子' }] }] }
    const once = importOutline([n('いまのこる')], payload)
    expect(texts(once.nodes)).toEqual(['いまのこる', 'もってきた', '  その子'])
    expect(once).toMatchObject({ added: 2, updated: 0 })

    const twice = importOutline(once.nodes, payload)
    expect(texts(twice.nodes)).toEqual(['いまのこる', 'もってきた', '  その子'])
    expect(twice).toMatchObject({ added: 0, updated: 2 })
  })

  it('向こうで直した文字が、こちらにも入る', () => {
    const first = importOutline([], { items: [{ id: 'u1', text: 'まえ' }] })
    const second = importOutline(first.nodes, { items: [{ id: 'u1', text: 'あと' }] })
    expect(texts(second.nodes)).toEqual(['あと'])
  })

  it('消した印のある行は、取り込まない', () => {
    const got = importOutline([], {
      items: [
        { id: 'a', text: 'いきてる' },
        { id: 'b', text: 'けした', deletedAt: '2026-01-01T00:00:00Z' },
        { id: 'c', text: 'これも', children: [{ id: 'c1', text: '中身' }] },
      ],
      deletedIds: ['c'],
    })
    expect(texts(got.nodes)).toEqual(['いきてる'])
    expect(got.skipped).toBe(3)   // けした1件 + これも（子ごと）2件
  })

  it('後ろに足す（いまあるものは消さない）', () => {
    const now = [n('いまのこる')]
    const got = importOutline(now, { items: [{ id: 'z', text: 'もってきた' }] })
    expect(texts(got.nodes)).toEqual(['いまのこる', 'もってきた'])
  })

  it('id が違っても、同じ名前の根なら中にまとめる', () => {
    const now = [n('Diary', [n('10/1')])]
    const got = importOutline(now, { items: [{ id: 'other', text: 'Diary', children: [{ id: 'd2', text: '10/2' }] }] })
    expect(texts(got.nodes)).toEqual(['Diary', '  10/1', '  10/2'])
    expect(got.merged).toBe(1)
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

import { hashtagAtCursor, tagSuggestions, applyTag, splitTags } from './outline.js'

describe('#タグの補完', () => {
  it('カーソルが # の途中にいるのを見つける', () => {
    const got = hashtagAtCursor('これは #me', 7 + 3)
    expect(got).toEqual({ start: 4, query: 'me' })
  })

  it('# を打った直後も、候補を出す', () => {
    expect(hashtagAtCursor('あと #', 4)).toEqual({ start: 3, query: '' })
  })

  it('空白のあとや、タグの外では出さない', () => {
    expect(hashtagAtCursor('#memo のあと', 9)).toBe(null)
    expect(hashtagAtCursor('ふつうの文', 5)).toBe(null)
  })

  it('打ちかけで始まる候補を返す（自分自身は出さない）', () => {
    expect(tagSuggestions(['memo', 'media', 'work'], 'me')).toEqual(['memo', 'media'])
    expect(tagSuggestions(['memo'], 'memo')).toEqual([])
  })

  it('候補は多すぎないようにする', () => {
    const many = Array.from({ length: 20 }, (_, i) => `tag${i}`)
    expect(tagSuggestions(many, 'tag')).toHaveLength(8)
  })

  it('選ぶと、打ちかけが置き換わって空白が付く', () => {
    const got = applyTag('これは #me', 10, 'memo')
    expect(got.text).toBe('これは #memo ')
    expect(got.caret).toBe(10)
  })

  it('後ろに文字があっても壊さない', () => {
    const got = applyTag('#me のこり', 3, 'memo')
    expect(got.text).toBe('#memo  のこり')
  })

  it('タグのところを切り分けられる', () => {
    expect(splitTags('これは #memo です')).toEqual([
      { text: 'これは ', tag: false },
      { text: '#memo', tag: true },
      { text: ' です', tag: false },
    ])
  })

  it('タグが無ければ、そのまま1つ', () => {
    expect(splitTags('ふつう')).toEqual([{ text: 'ふつう', tag: false }])
  })
})

describe('直したところ（回帰）', () => {
  it('見た目は、読み直しても落ちない', () => {
    const got = ensureNode({ text: 'みだし', headingLevel: 2, textColor: '#e03535', bgColor: 'rgba(0,0,0,.1)' })
    expect(got).toMatchObject({ headingLevel: 2, textColor: '#e03535', bgColor: 'rgba(0,0,0,.1)' })
    // 入れ子も同じ
    expect(ensureNode({ text: 'おや', children: [{ text: 'こ', headingLevel: 1 }] }).children[0].headingLevel).toBe(1)
  })

  it('まとめて字下げしても、選んだ行どうしが親子にならない', () => {
    const t = [n('A'), n('B'), n('C')]
    const got = indentMany(t, [idOf(t, 'B'), idOf(t, 'C')])
    expect(texts(got)).toEqual(['A', '  B', '  C'])
  })

  it('先頭の行に上の兄弟がいなければ、何も動かさない', () => {
    const t = [n('A'), n('B')]
    expect(indentMany(t, [idOf(t, 'A'), idOf(t, 'B')])).toBe(t)
  })

  it('親も子も選んでいるときは、親だけ動かす（二重に動かさない）', () => {
    const t = [n('A'), n('B', [n('B1')])]
    const got = indentMany(t, [idOf(t, 'B'), idOf(t, 'B1')])
    expect(texts(got)).toEqual(['A', '  B', '    B1'])
  })

  it('探す印つけは、空でも落ちない', () => {
    expect(splitByQuery(null, 'あ')).toEqual([{ text: '', hit: false }])
    expect(splitByQuery(undefined, '')).toEqual([{ text: '', hit: false }])
  })

  it('親が輪になっていても、行を捨てない', () => {
    const rows = [
      { id: 'x', parentId: 'y', sortOrder: 0, text: 'X' },
      { id: 'y', parentId: 'x', sortOrder: 0, text: 'Y' },
    ]
    expect(texts(buildTree(rows)).sort()).toEqual(['X', 'Y'])
  })

  it('消したあとの行き先は、必ず残っている行', () => {
    const t = [n('A', [n('A1')]), n('B')]
    const got = deleteNodeSafe(t, idOf(t, 'A'))   // A を消すと A1 も消える
    const alive = texts(got.nodes)
    expect(alive).toEqual(['B'])
    expect(findNode(got.nodes, got.focusId)).toBeTruthy()
  })
})

import { mergeByText } from './outline.js'

describe('id の無い書き出しを重ねる', () => {
  const incoming = [{ text: '2025', children: [{ text: 'TRAY', children: [{ text: 'メモ1' }] }] }]

  it('いちど目は、まるごと入る', () => {
    const got = mergeByText([], incoming)
    expect(texts(got.nodes)).toEqual(['2025', '  TRAY', '    メモ1'])
    expect(got.added).toBe(3)
  })

  it('二度目は増えない（同じ文字の行に重ねる）', () => {
    const once = mergeByText([], incoming).nodes
    const twice = mergeByText(once, incoming)
    expect(texts(twice.nodes)).toEqual(['2025', '  TRAY', '    メモ1'])
    expect(twice.added).toBe(0)
    expect(twice.matched).toBe(3)
  })

  it('増えたぶんだけが足される', () => {
    const once = mergeByText([], incoming).nodes
    const more = mergeByText(once, [{ text: '2025', children: [{ text: 'TRAY', children: [{ text: 'メモ2' }] }] }])
    expect(texts(more.nodes)).toEqual(['2025', '  TRAY', '    メモ1', '    メモ2'])
    expect(more.added).toBe(1)
  })

  it('同じ文字でも、親が違えば別の行', () => {
    const got = mergeByText(
      [{ ...makeNode('A'), children: [makeNode('おなじ')] }],
      [{ text: 'B', children: [{ text: 'おなじ' }] }],
    )
    expect(texts(got.nodes)).toEqual(['A', '  おなじ', 'B', '  おなじ'])
  })

  it('完了の印は、取り込んだほうに合わせる', () => {
    const once = mergeByText([], [{ text: 'やること' }]).nodes
    const done = mergeByText(once, [{ text: 'やること', completed: true }])
    expect(done.nodes[0].completed).toBe(true)
  })
})

describe('消した印の使いどころ（戻り止め）', () => {
  it('手元にある行は、印が残っていても消さない', () => {
    // 消す → 取り消す → 読み直す、の流れ。印は残っているが行は生きている。
    const node = makeNode('戻した行')
    const got = mergeOutline([node], [], new Set([node.id]))
    expect(texts(got)).toEqual(['戻した行'])
  })

  it('向こうにだけ残っている行は、印のとおり戻さない', () => {
    const node = makeNode('消した行')
    expect(mergeOutline([], [node], new Set([node.id]))).toEqual([])
  })

  it('印のない行は、どちらにあっても残る', () => {
    const a = makeNode('てもと')
    const b = makeNode('むこう')
    expect(texts(mergeOutline([a], [b], new Set())).sort()).toEqual(['てもと', 'むこう'])
  })
})

describe('取り込んだものは畳んでおく', () => {
  const incoming = [{ text: '2025', children: [{ text: 'TRAY', children: [{ text: 'メモ' }] }] }]

  it('中に行があるところは、畳んだ状態で入る', () => {
    const got = mergeByText([], incoming, { collapseNew: true })
    expect(texts(got.nodes)).toEqual(['2025'])              // 畳んであるので中は出ない
    const all = flattenTree(got.nodes)
    expect(all.map((r) => r.text)).toEqual(['2025', 'TRAY', 'メモ'])   // 中身は入っている
    expect(all.find((r) => r.text === 'TRAY').collapsed).toBe(true)
    expect(all.find((r) => r.text === 'メモ').collapsed).toBe(false)   // 子が無い行は畳まない
  })

  it('いまある行の開き具合は、変えない', () => {
    const now = [n('2025', [n('TRAY')])]                     // 開いている
    const got = mergeByText(now, incoming, { collapseNew: true })
    expect(findNode(got.nodes, idOf(now, '2025')).collapsed).toBe(false)
  })

  it('畳まない指定なら、これまで通り開いたまま', () => {
    const got = mergeByText([], incoming)
    expect(texts(got.nodes)).toEqual(['2025', '  TRAY', '    メモ'])
  })
})

import { dateHintOf, dateKeyOf, fillDates } from './outline.js'

describe('日付を読む', () => {
  it('よくある書き方を読める', () => {
    expect(dateHintOf('2026/01/02')).toEqual({ y: 2026, m: 1, d: 2 })
    expect(dateHintOf('2026-01-02 のこと')).toEqual({ y: 2026, m: 1, d: 2 })
    expect(dateHintOf('20260107NOL感動学イベントトーク')).toEqual({ y: 2026, m: 1, d: 7 })
    expect(dateHintOf('2026/01')).toEqual({ y: 2026, m: 1, d: null })
    expect(dateHintOf('2026')).toEqual({ y: 2026, m: null, d: null })
  })

  it('日付でないものは読まない', () => {
    expect(dateHintOf('ふつうの行')).toBe(null)
    expect(dateHintOf('')).toBe(null)
    // 文の途中の数字は拾わない（誤爆を避ける）
    expect(dateHintOf('めも 2026/01/02 について')).toBe(null)
    // ありえない月日は、8桁として読まない
    expect(dateHintOf('20269999')).toBe(null)   // 月日としてありえないので読まない
  })

  it('そろっていなければ日付にしない', () => {
    expect(dateKeyOf({ y: 2026, m: 1, d: 2 })).toBe('2026-01-02')
    expect(dateKeyOf({ y: 2026, m: 1, d: null })).toBe(null)
    expect(dateKeyOf(null)).toBe(null)
  })
})

describe('木から日付を入れる', () => {
  it('年＞年月＞年月日 の並びから決まる', () => {
    const tree = [{ text: '2026', children: [
      { text: '2026/01', children: [
        { text: '2026/01/02', children: [{ text: '正月である' }] },
      ] },
    ] }]
    const got = flattenTree(fillDates(tree))
    const by = (t) => got.find((r) => r.text === t)
    expect(by('2026/01/02').date).toBe('2026-01-02')
    expect(by('正月である').date).toBe('2026-01-02')   // 子は受け継ぐ
    expect(by('2026/01').date).toBe(null)              // 日が無いので入れない
    expect(by('2026').date).toBe(null)
  })

  it('日付の無い枝には入れない', () => {
    const got = fillDates([{ text: 'TRAY', children: [{ text: 'メモ' }] }])
    expect(flattenTree(got).every((r) => !r.date)).toBe(true)
  })

  it('途中の行が日を持っていれば、そちらが勝つ', () => {
    const tree = [{ text: '2026/01', children: [
      { text: '2026/01/05', children: [{ text: '中身' }] },
      { text: '2026/01/09', children: [{ text: 'べつの中身' }] },
    ] }]
    const got = flattenTree(fillDates(tree))
    expect(got.find((r) => r.text === '中身').date).toBe('2026-01-05')
    expect(got.find((r) => r.text === 'べつの中身').date).toBe('2026-01-09')
  })

  it('手で入れた日付は、上書きしない', () => {
    const tree = [{ text: '2026/01/02', date: '2020-05-05', children: [] }]
    expect(fillDates(tree)[0].date).toBe('2020-05-05')
  })
})

import { groupByDate } from './outline.js'

describe('日付ビュー', () => {
  const tree = () => fillDates([
    { text: '2026', children: [
      { text: '2026/01', children: [
        { text: '2026/01/02', children: [{ text: '正月のこと' }] },
        { text: '2026/01/07', children: [{ text: 'トークイベント' }] },
      ] },
      { text: '2026/03', children: [{ text: '2026/03/01', children: [{ text: '三月' }] }] },
    ] },
    { text: '2025', children: [{ text: '2025/12', children: [{ text: '2025/12/24', children: [{ text: 'クリスマス' }] }] }] },
    { text: 'TRAY', children: [{ text: '日付のないメモ' }] },
  ])

  const shapeOf = (ns, d = 0, out = []) => {
    for (const n of ns) { out.push('  '.repeat(d) + n.text); shapeOf(n.children || [], d + 1, out); }
    return out
  }

  it('年＞年/月＞年/月/日 に並べ替わる', () => {
    expect(shapeOf(groupByDate(tree()))).toEqual([
      '2026', '  2026/01', '    2026/01/02', '      正月のこと',
      '    2026/01/07', '      トークイベント',
      '  2026/03', '    2026/03/01', '      三月',
      '2025', '  2025/12', '    2025/12/24', '      クリスマス',
      '日付なし', '  TRAY', '    日付のないメモ',
    ])
  })

  it('年は新しい順、月日は古い順', () => {
    const got = groupByDate(tree())
    expect(got.map((n) => n.text)).toEqual(['2026', '2025', '日付なし'])
    expect(got[0].children.map((n) => n.text)).toEqual(['2026/01', '2026/03'])
  })

  it('古い順にもできる', () => {
    const got = groupByDate(tree(), { newestYearFirst: false })
    expect(got.map((n) => n.text)).toEqual(['2025', '2026', '日付なし'])
  })

  it('日付の見出しそのものは、二重に出さない', () => {
    // 元の木にある「2026」「2026/01」は、組み直した見出しに置き換わる
    const flat = shapeOf(groupByDate(tree()))
    expect(flat.filter((t) => t.trim() === '2026')).toHaveLength(1)
    expect(flat.filter((t) => t.trim() === '2026/01')).toHaveLength(1)
  })

  it('見出しは仮の行として印がつく（元の木は触らない）', () => {
    const base = tree()
    const got = groupByDate(base)
    expect(got[0].virtual).toBe(true)
    expect(got[0].id).toBe('date:2026')
    expect(base.length).toBe(3)   // 元はそのまま
  })

  it('書き出しの表題で一度くるまれていても、中の日付を拾う', () => {
    // MD の書き出しは「# 表題」がひとつの親になることが多い。
    // ここでほどけないと、ぜんぶが「日付なし」のかたまりになってしまう。
    const wrapped = fillDates([
      { text: '統合アウトライナー｜ISO日付統一版', children: [
        { text: '2026', children: [{ text: '2026-01-02', children: [{ text: '正月のこと' }] }] },
        { text: 'TRAY', children: [{ text: '日付のないメモ' }] },
      ] },
    ])
    const got = groupByDate(wrapped)
    expect(got.map((n) => n.text)).toEqual(['2026', '日付なし'])
    expect(shapeOf(got)).toEqual([
      '2026', '  2026/01', '    2026/01/02', '      正月のこと',
      '日付なし', '  TRAY', '    日付のないメモ',
    ])
  })

  it('日付が無いものは、まとめて最後に置く', () => {
    const got = groupByDate(tree())
    expect(got.at(-1).text).toBe('日付なし')
    expect(got.at(-1).children.map((n) => n.text)).toEqual(['TRAY'])
  })
})

import { imageUrlOf, driveIdOf } from './outline.js'

describe('画像の行', () => {
  it('画像の URL は、絵として扱う', () => {
    expect(imageUrlOf('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(imageUrlOf('https://example.com/a.JPG?v=2')).toBe('https://example.com/a.JPG?v=2')
  })

  it('![](…) の書き方も読む', () => {
    expect(imageUrlOf('![ずかい](https://example.com/x)')).toBe('https://example.com/x')
  })

  it('ふつうの文や、ほかの文字が混ざる行は、絵にしない', () => {
    expect(imageUrlOf('ふつうのメモ')).toBe(null)
    expect(imageUrlOf('この図 https://example.com/a.png を見て')).toBe(null)
    expect(imageUrlOf('https://example.com/page')).toBe(null)
  })

  it('ドライブの共有リンクから id を取り出す', () => {
    const id = '1AbC-dEfGhIjKlMnOpQrStUvWxYz'
    for (const url of [
      `https://drive.google.com/file/d/${id}/view?usp=sharing`,
      `https://drive.google.com/open?id=${id}`,
      `https://drive.google.com/uc?export=view&id=${id}`,
      `https://lh3.googleusercontent.com/d/${id}`,
    ]) expect(driveIdOf(url)).toBe(id)
    expect(driveIdOf('https://example.com/a.png')).toBe(null)
  })

  it('ドライブのリンクは、絵が出る形に直す', () => {
    const got = imageUrlOf('https://drive.google.com/file/d/1AbC-dEf/view?usp=sharing')
    expect(got).toBe('https://drive.google.com/thumbnail?id=1AbC-dEf&sz=w1600')
  })
})

describe('ほかの端末で消えた行', () => {
  const local = [{ id: 'a', text: 'のこる', children: [] }, { id: 'b', text: '消された', children: [] }]
  const remote = [{ id: 'a', text: 'のこる', children: [] }]

  it('前に確かめた行が向こうから消えていたら、手元からも消す', () => {
    const got = mergeOutline(local, remote, new Set(), new Set(['a', 'b']))
    expect(got.map((n) => n.id)).toEqual(['a'])
  })

  it('まだ送っていない行（この端末で書いたばかり）は残す', () => {
    const got = mergeOutline(local, remote, new Set(), new Set(['a']))
    expect(got.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('確かめた覚えが無いとき（これまで通り）は、残す', () => {
    const got = mergeOutline(local, remote, new Set())
    expect(got.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })
})
