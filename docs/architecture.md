# Task Space のつくり

はじめて触るときの地図。手順の約束は `AGENTS.md`、細かい事情は各ファイルの
冒頭コメントにあります。ここは「どこに何があるか」と「なぜその形か」。

## 1. 何をするアプリか

ひとつの画面を枠（ペイン）に分け、枠ごとに **タスク** か **アウトライン** を出す。

- タスク側 … Notion 風のブロック編集、7days（曜日ボード）、TRAY、STOCK ビュー、カレンダー
- アウトライン側 … WorkFlowy / Quietliner 風の木。日付ビュー、タグ、お気に入り、取り込み

使う人はひとり（PC と iPad）。だから「ログインしなくても手元だけで完全に動く」ことを
前提にしてあり、Supabase は後ろで揃えるためのもの。落ちていても使えること。

## 2. ファイルの地図

```
src/
  main.jsx            入口
  AuthGate.jsx        Supabase のログイン（鍵が無ければ素通し）
  App.jsx             タスク側ぜんぶ＋枠（ペイン）の分割       約9,200行
  Outliner.jsx        アウトライナー＋その同期・設定           約2,000行
  lib/
    outline.js        木の操作（純粋関数）。ここが心臓          約900行
    import-formats.js WorkFlowy / Notion の書き出しを読む
    db.js             Supabase の出し入れ、行 ↔ 木の変換
    drive.js          Google ドライブ（画像・控え）
    localstore.js     IndexedDB（localStorage に入らない大物）
    scheduling.js     繰り返し・日付まわりの計算
    supabase.js       クライアント生成（環境変数が無ければ null）
tests/                Playwright（505件）
src/lib/*.test.js     vitest（218件）
docs/gas-image-upload.gs  ドライブ側の Apps Script
api/notion-sync.js    Notion 取り込み（サーバレス関数）
```

`App.jsx` が大きいのは、タスクのドラッグがビューをまたぐため。同じタスクが
7days・TRAY・ボードに同時に描かれるので、分割すると落ちる先の判定が壊れます。
分けるなら、まず「描画だけの部品」から切り出すこと。

## 3. データの形

### タスク（1枚の配列で全部を持つ）

```js
{
  id, title, status, category, project, parentId,   // 親子は parentId だけで表す
  today, todayOrder, thisWeek, weeklyOrder,
  scheduledDate: "2026-10-18",   // 7days に出る日
  dueDate, recurrence, recurrenceDay, recurrenceEnd,
  plain, archived, stock, stockViewId, memo, sortOrder, style,
  // ブロック編集のぶん（Supabase では「あとから足した列」）
  blockType,            // "task" | "text" | "heading" | "column" | "toggle" ...
  pageId, rowKey, col, colWidth, canvasX, canvasY, codeLang, dayDate,
}
```

ビューは「この配列をどう絞って並べるか」でしかない。7days は `scheduledDate`、
TRAY は「どこにも置いていないもの」、ボードは `pageId` で絞る。

### アウトライン（木）

```js
{
  id, text, children: [],
  collapsed, completed, favorite,
  date: "2026-10-18" | null,   // 日付ビューの並べ替えに使う
  headingLevel, textColor, bgColor, imageWidth,
  createdAt, updatedAt,
}
```

`ensureNode()` を通さずに木へ入れないこと。ここで持ち物を落とすと、
読み直したときに色や日付が消えます（実際に1度やらかした）。

Supabase には木のまま置けないので、`flattenTree()` で
`{ id, parentId, sortOrder, ... }` の行にして `outline_nodes` に入れ、
`buildTree()` で戻す。親が見つからない行は捨てずに根へ出す（迷子を作らない）。

## 4. 置き場と同期

### どこに何が残るか

| 置き場 | 中身 | 限界 |
|---|---|---|
| localStorage | タスク一式、設定、小さいアウトライン | 5MB。iPad では溢れる |
| IndexedDB | 大きいアウトライン、消した印、確かめた覚え | 実質ほぼ無制限 |
| Supabase | 端末どうしを揃えるための本体 | 無くても動く |
| Google ドライブ | 画像の実体と、中身まるごとの控え | GAS 経由 |

### アウトラインの同期（いちばん壊しやすい）

起き抜けはこの順番で、**順番に意味がある**。

1. 手元を読む … localStorage に写しがあればそれが本物。無ければ IndexedDB。
   （入りきらなかったときは写しを消すので、「無い」が合図になる）
2. 消した印（tombstone）と、確かめた覚え（known）を読む
3. Supabase と突き合わせる（`mergeOutline`）
   - 消した印にある行は、向こうにあっても戻さない
   - 向こうに無く、かつ前に確かめた覚えがある行は、**ほかの端末で消された**ので手元からも外す
   - 同じ id は `updatedAt` が新しいほうを採る
4. Realtime を聞く（`subscribeOutline`）。届いた行は 250ms ためて `applyRemoteRows`

保存は「変わった行」だけを 800ms 待ってから。消えた行は印を付けてから消し、
通ったら印を外す。断られたら 15 秒後にやり直す。

**やってはいけないこと**

- 読み終える前に保存する（空の木が本物を押しのける）
- 一度に全部送る（1万行で URL と本文が溢れる。upsert 500 / delete 200 で小分け）
- 列が無い置き場に、新しい列を含めて送る（upsert がまるごと断られ、同期が止まる）

### v1.15.8の本文と未送信の一括保存

`src/lib/outline-checkpoint.js` が保存形式と行ごとの未送信世代を扱う。
`taskspace-outline-v1` の値は旧配列から、次の1件の記録へ移る。

```js
{
  format: "taskspace-outline/1", revision, at, nodes: [],
  sync: { sequence, pending: [{ id, kind: "put" | "delete", version }], deleted: [], known: [] },
}
```

- 本文と記録を、localStorageの1回のsetItem／IndexedDBの1回の取引で一緒に残す。
- 新形式同士はrevisionで新しい控えを選ぶ。旧形式のlocalStorageの配列は引き続き読む。移行元と同じ古い写しが残っている場合は、新形式へ確定した記録を優先する。
- IndexedDBの読み出しに失敗した起動では、localStorageが読めても保存・同期を止める。より新しい世代の有無を確認せずに上書きしない。
- 旧形式から切り替える前に `taskspace-outline-v1-legacy-copy` へ控えを残す。旧形式の印・knownも移行時だけ読み、その後は同じ記録のsyncを使う。
- 送る行は端末への確定を待つ。古い送信完了で新しい未送信世代を除かず、再起動後も送信待ちを復元する。
- 起動中の入力も読み出し後に重ねる。読めない形式や控えを残せない状態なら、保存・同期を止める。
- ドライブの控えは画面の本文と未送信記録を一緒に取得する。

保存はまだ本文全体のスナップショット。行ごとの差分保存、複数タブの排他、サーバーの版管理、
競合した相手の文章の退避は後続の段階。旧版のタブを閉じてから新しい版へ切り替える。

### v1.15.9の行ごとの差分保存

IndexedDBのbigストア内で本文を行別の配列キーへ移す。メタキーに保存世代・行数と同期記録を残し、
行の変更・削除と同じ取引で確定する。読み出しも同じ取引から行とメタを取得する。
旧スナップショットのキーは移行後も控えとして残し、公開APIのbigGetは本文の木へ戻して返す。
bigDeleteで本文を削除する場合は行とメタも一括で除く。

1000行以上の文書ではlocalStorageの全体コピーを止め、IndexedDBが失敗したときだけ退避を試す。
小さい文書は即時復元用のコピーを保つ。同期メタデータは今回も一括保存。
保存基準の世代が変わっていれば書き込みを拒否するが、複数タブの統合はまだ行わない。

### Supabase の SQL（1回だけ）

```sql
alter table outline_nodes add column if not exists date text;
alter table outline_nodes add column if not exists image_width integer;
alter table outline_nodes replica identity full;
alter publication supabase_realtime add table outline_nodes;
```

表そのものが無いときは、アプリが画面に SQL を出します（`outlineTableSql()`）。

## 5. 取り込み（2回読んでも増えない）

| 形 | 読み方 | 重ね方 |
|---|---|---|
| Quietliner の .json | `importOutline` | id で重ねる |
| WorkFlowy の .md | `parseIndentedMarkdown` | 文字で重ねる（`mergeByText`） |
| WorkFlowy の .html | `parseWorkflowyHtml` | `data-chid` があるので id で |
| Notion の .zip | `parseZip` | 文字で重ねる |

字下げの読み取りには落とし穴があって、**段落のあいだの空行**と
**字下げの中の `##` 見出し**で、以前そこから下の親子関係が全部ずれました。
`src/lib/import-formats.test.js` がその番人です。

取り込んだぶんは畳んだ状態で入れる（1万行が全開だと見失う）。
見出しの並び（`2026 > 2026-01 > 2026-01-02`）から各行に `date` を入れるのが `fillDates`。

## 6. 枠（ペイン）

`PANES_KEY` に `[{ id, mode, weight }]` で持つ。広い画面では横に、
狭い画面（lg 未満）では縦に積む。あいだのつまみは並びに合わせて向きを変える。
枠ごとに `overflow-y-auto overscroll-contain` を持たせ、転がすのは枠の中だけ。

タスクは1つの枠にしか出せない（同じものを2枚描くと、ドラッグの行き先が重なる）。

## 7. テスト

```bash
npm run test:unit    # vitest 218件、数秒
npm test             # Playwright 505件、6〜9分
```

- Playwright は preview（4173）を共有するので、**同時に2つ走らせない**
- `playwright.config.js` が `VITE_SUPABASE_*` を空にするので、本番に触れない
- 要素は `data-*` で指す。クラス名で指すとレイアウト変更のたびに壊れる
- ドラッグは実操作で（down → 小さく動かす → 目標 → up）
- iPhone 13 相当の端末での見え方は `tests/mobile.spec.js`

## 8. 外とのつなぎ

- **Google ドライブ**（`docs/gas-image-upload.gs`）… 画像を
  `images/<年>/<月>/<日付_時刻_手がかり_しるし>.png` に置き、リンクを行に書く。
  控えは `backups/` に1日1回、30本まで。合言葉（TOKEN）は控えに入れない。
  GAS には Content-Type を付けずに POST する（付けると先に OPTIONS が飛んで答えられない）。
- **Notion**（`api/notion-sync.js`）… データベースを読んでタスクに流し込む。

## 9. いま分かっている弱いところ

- 同じ行を2端末で同時に打つと後勝ち（文字単位の共同編集ではない）
- `App.jsx` が大きい
- eslint に既存の警告が多い（新しいエラーを足さないこと）
- `npm test` が6〜9分かかる
