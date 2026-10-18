# Task Space — 開発の手引き（人間・エージェント共通）

Codex / Claude Code / 人間、どれが触るときもこの約束で進めます。
全体の地図は `docs/architecture.md`、細かい事情は各ファイル冒頭のコメントに書いてあります。

## これは何か

タスク管理（Notion 風のブロック編集 + 7days ボード）と、アウトライナー
（WorkFlowy / Quietliner 風）を、ひとつの画面で分割して使うための個人用アプリ。

- React 19 + Vite 8 + Tailwind v4、状態は React のみ（Redux などは入れない）
- 置き場は localStorage / IndexedDB（手元）と Supabase（端末どうしの同期）
- 画像と控えは Google ドライブ（Apps Script 経由、`docs/gas-image-upload.gs`）
- 端末は PC と iPad（PWA）。iPad Safari / WebKit で動くことが条件

## すぐ使うコマンド

```bash
npm run dev          # 開発サーバ
npm run build        # 本番ビルド（型も CSS もここで落ちる）
npm run lint         # eslint（既存の警告は多いが、新しいエラーを足さない）
npm run test:unit    # vitest（src/lib/*.test.js、数秒で終わる）
npm test             # Playwright 全部（ビルド → preview → 実行。6〜9分）
npm test -- tests/outliner.spec.js
npm test -- -g "範囲選択"
```

**Playwright を二重に走らせないこと。** preview サーバ（4173）を共有するので、
同時に2つ走らせると無関係なテストが落ちて原因を見失います。

## 守ってほしい約束

1. **版を上げる。** 直したら `package.json` の patch を上げて、同じコミットに含める
   （`CLAUDE.md` の決まり。機能追加なら minor）。
2. **日本語で書く。** コメント・コミットメッセージ・画面の文言・テスト名、ぜんぶ日本語。
   コメントは「何をしているか」ではなく「なぜそうしたか／そうしないと何が起きるか」を書く。
   既存の文体（です・ます抜きの素の説明文）に合わせる。
3. **テストを足す。** 直したバグには、それが再発したら落ちるテストを必ず1つ。
   UI は Playwright、純粋な関数は vitest。
4. **掴まりどころは `data-*` 属性で。** テストから要素を指すのに CSS クラスを使わない
   （レイアウトを変えるたびに壊れる）。`data-row`, `data-pane-id`, `data-drive-test` のように
   意味のある名前を付ける。
5. **壊れやすい順番を変えない。** 同期の読み書き順（下記）と、ドラッグまわりは
   触る前に既存コメントを読む。
6. **勝手に依存を増やさない。** 入っているのは dnd-kit / framer-motion / lucide-react /
   supabase-js だけ。追加は相談してから。

## 置き場（どこに何が残るか）

| どこ | 何 | 気をつけること |
|---|---|---|
| localStorage | タスク一式 `notion-like-taskdb-prototype-v4`、設定 `taskspace-*` | 5MB で頭打ち。iPad では溢れる |
| IndexedDB (`taskspace` / `big`) | 大きいアウトライン、消した印、確かめた覚え | `src/lib/localstore.js` |
| Supabase | `tasks` / `categories` / `project_rules` / `project_order` / `tray_items` / `outline_nodes` | 無くても動く（手元だけで完結する） |
| Google ドライブ | 画像 `images/<年>/<月>/`、控え `backups/` | `src/lib/drive.js` と GAS |

Supabase の列をあとから足したときは、**古い置き場でも動くこと**。
`absentOutlineColumns()` のように、無い列を外して送る作りを壊さない。

## 同期の決まりごと（いちばん壊しやすいところ）

`src/Outliner.jsx` の `OutlineProvider`。順番に意味があります。

1. 手元を読む（localStorage に写しがあればそれが本物、無ければ IndexedDB）
2. 消した印（tombstone）と、向こうで確かめた覚え（known）を読む
3. Supabase と突き合わせる（`mergeOutline`）
4. Realtime を聞き始める（`subscribeOutline` → `applyRemoteRows`）

- **読み終えるまで保存しない。** 起き抜けの空の木を保存すると、本物を押しのける。
- 送るのは「変わった行」だけ。消えた行は印を付けてから消し、通ったら印を外す。
- 届いた行は、手元のほうが新しければ採らない（打っている最中を消さないため）。
- 行単位の後勝ち。文字単位の共同編集はしていない（やるなら CRDT が要る）。

## 画面の作り（ざっくり）

- `src/App.jsx`（約9,200行）… タスク側ぜんぶ。枠（ペイン）の分割もここ。
  大きいが、切り分けは慎重に（ドラッグの行き先が重なると動かなくなる）。
- `src/Outliner.jsx`（約2,000行）… アウトライナーと、その同期・設定。
- `src/lib/outline.js` … 木の操作はぜんぶここ（純粋関数、テストしやすい）。
- `src/lib/import-formats.js` … WorkFlowy / Notion の書き出しを読む。
- `src/lib/db.js` … Supabase の出し入れ。行 ↔ 木の変換もここ。

## つまずきやすいところ

- **iPad Safari には Wake Lock も PiP も揃っていない。** 画面を保つ仕掛けは
  `KeepAwakeSetting` に事情が書いてある。触る前に読む。
- **同じタスクが複数の場所に描かれる。** 7days と TRAY の両方に出るので、
  テストでは `dayBlock()` / `panelBlock()` で場所を特定する。
- **dnd-kit は移動距離で発火する。** テストのドラッグは down → 小さく動かす → 目標 → up。
- **取り込みは2回読んでも増えない作り。** id があるものは id で、無いものは文字で重ねる。
  ここを雑にすると、ユーザーの1万行が倍になる。
- **大きい取り込み（1万行超）がある。** 一度に送らず、必ず小分け（upsert 500 / delete 200）。

## 困ったときに読む順

1. `docs/architecture.md` … 全体の地図とデータの形
2. 触るファイルの冒頭コメント
3. `tests/README.md` … テストの前提と書き方
4. `docs/gas-image-upload.gs` … ドライブ側の仕組み
