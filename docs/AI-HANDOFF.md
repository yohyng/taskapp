# fragments 開発の引き継ぎ

更新：2026-11-09。作業前に `AGENTS.md`、この資料、`docs/pen-feel-preview.md` を読む。

## リポジトリと現在の作業

- GitHub: https://github.com/yohyng/taskapp
- ローカル: C:/Users/054646/Documents/Codex/2026-10-18/prior-conversation-with-codex-conversation-role/taskapp-sync-comparison
- 作業ブランチ: `codex/pen-feel-preview`。ドラフトPR: https://github.com/yohyng/taskapp/pull/41
- このブランチは手書きの独立した検証版。まだ本番へ統合しない。切替やSQL実行は今回の作業範囲ではない。
- 最新の検証入口: https://taskapp-git-codex-pen-feel-preview-willowyana3-2255s-projects.vercel.app/ink-lab.html
- 以前の独自ペンの比較は `/pen-lab.html` に保持する。
- 版1.25.1。ユーザーはGalaxy Z Fold5のChrome PWAとSペンを使用。Goodnotes鉛筆の好みはiPadとApple Pencilでの体験。

## ここまで分かったこと

- 独自に端だけ膨らませる補正は丸い粒となり不評。新ページはperfect-freehand 1.2.3による連続輪郭へ変更。
- 「Concepts風・速度ペン」はユーザーからかなり良いという評価を得た。速度は座標差/時刻差で求める。速く細く、遅く太くなる。
- 「Goodnotes風・鉛筆」は筆圧による濃淡と決定的な紙目の独自近似。傾きの陰影は未対応。各アプリの内部実装と同一だと説明しない。
- 強弱の大きさ、太さ、軌跡の補正、太さの応答を調整できる。基準は太さ10、強弱60%、軌跡15%、応答16ms。
- 1.25.1では加速時と減速時の応答を分離。従来の16/16を初期値に維持し、12/28の別案も用意した。
- ユーザーのConcepts動画では400%表示の直線に中央約4〜5px、端近傍約7〜9pxの例がある。録画からの概算であり、実際の筆圧や入力遅延は測れていない。
- これ以上の調整は良かった基準と比較して進める。画面録画のフレームレートを表示Hzや入力遅延と混同しない。

## ファイルと保存経路

- `src/InkLab.jsx`: 4種類のペン、スライダー、直前入力の再描画、2枚のCanvas、下書き/PNG/JSON出力。
- `src/lib/ink-comparison.js`: 入力→太さ→連続輪郭、鉛筆、下書き検証。
- `ink-lab.html`: 検証入口。Viteのpen-previewモードだけで専用ビルドする。
- `vite.config.js` / `scripts/vercel-build.mjs`: 検証ブランチだけpen-previewを配信。本番の同期経路には接続しない。
- 下書き: `fragments-ink-comparison-v1`。設定: `fragments-ink-controls-v1`。いずれもlocalStorage。
- ストロークに描画時の設定を保存。スライダー操作で過去の線を変えない。見本だけ現在の設定で再描画。
- 生の入力点を保存し、完成線のCanvasは確定時のみ更新。描画中の線だけ別CanvasをrequestAnimationFrameで描き直す。
- 本番のLoro同期、Supabase、GAS、既存データ移行を手書き調整のために変更しない。

## 検証

- 単体: `node node_modules/vitest/vitest.mjs run src/lib/ink-comparison.test.js`
- lint: `node node_modules/eslint/bin/eslint.js src/InkLab.jsx src/lib/ink-comparison.js tests/ink-lab.spec.js`
- UI: `node node_modules/@playwright/test/cli.js test --config playwright.pen.config.js --workers=1 tests/ink-lab.spec.js`
- Windowsの利用可能Node: C:/Users/054646/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe
- Chromiumは環境変数 `PLAYWRIGHT_CHROMIUM_PATH=C:/Users/054646/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe` を使用。
- Playwrightは同時に走らせず、実行中はファイルを編集しない。ChromiumとWebKitで確認する。
- 復元とPNGの一致、設定の保持、実ポインター、鉛筆の濃淡、入力頻度によらない速度計算が重要。テスト通過は実機の書き心地や120Hzの保証ではない。

## 引き継ぎ時の注意

チャットの履歴、ツールのログイン状態、ローカルの接続設定は、コードと一緒には自動移行しない。秘密値をこの資料やGitへ追加しない。別のAIで同時に同じブランチを編集する場合は変更が衝突するので、作業を分けるなら別ブランチ/別worktreeを使用する。本番状態は移行時に改めて確認する。
