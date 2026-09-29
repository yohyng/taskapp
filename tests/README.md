# 回帰テスト

`TaskBlock` への集約リファクタに入る前に、いまの操作感を固定するためのテスト。
リファクタ中はこれを回しながら進める。

```bash
npm test              # 全部（ビルド → preview → Playwright）
npm test -- --ui      # ブラウザで見ながら
npm test -- tests/block-input.spec.js
npm test -- -g "範囲選択"
```

## 前提

- `playwright.config.js` が `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を空にして
  preview を起動するので、`.env` があってもテストが本番 Supabase に触れることはない。
  localStorage のみのモードで動く。
- 各テストは `tests/helpers.js` の `seedData()` を localStorage に流し込んでから開始する。
  サンプルデータには依存しない。
- ブラウザはコンテナ同梱の `/opt/pw-browsers/chromium`。
  別の場所にあるときは `PLAYWRIGHT_CHROMIUM_PATH` で指定する。

## 何を守っているか

| ファイル | 内容 |
|---|---|
| `selection.spec.js` | クリック選択 / ダブルクリック編集 / マーキー範囲選択 / 色・太さ |
| `block-input.spec.js` | Enter 2回で下にブロック追加、↑↓移動、Backspace 削除（3ビュー分） |
| `drag.spec.js` | 曜日カラムへの移動、複数選択の一括移動、STOCK の出し入れ |
| `focus-stock.spec.js` | フォーカスモード、STOCK ビューの追加・改名・色・削除 |
| `theme.spec.js` | 配色の切り替えと保存、明るい配色でのコントラスト |

## 書くときの注意

- **同じタスクが複数の場所に描画される。** 日付つきのプレーンタスクは 7days と TRAY の
  両方に出る。`block()` は先頭を返すので、場所を特定したいときは `dayBlock()` /
  `panelBlock()` を使う。
- **ドラッグは実操作で書く。** dnd-kit はポインタの移動距離で発火するので、
  `dragTo()` のように down → 小さく動かす → 目標へ → up の順で書く。
- **座標は使う直前にまとめて取る。** 途中でスクロールが起きると古い座標がずれる。
- **待機を入れる前に疑う。** 「待てば通る」テストは、たいてい実際のユーザーも
  踏むタイミング問題を指している。このスイートを書く過程で見つかった3件は
  いずれもそれだった（下記）。

## このスイートが見つけた不具合

1. **カードで文字キーを押すと2文字入る** — `preventDefault` が無く、直後に開く
   textarea にも同じ文字が届いていた。
2. **Enter を素早く2回押すと2回目が効かない** — `setTimeout(0)` でフォーカスを
   戻していたため。`useLayoutEffect` に変更。
3. **新規ブロックに placeholder「新規タスク」が残る** — マウント直後の同期 effect が
   空ドラフトを上書きしていた。`pendingEditId` を見て抑止。
