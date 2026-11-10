# 分割方向と配置の切替

2026-11-10。ユーザーの希望は、Fold端末のように左右・上下の分割を選び、中央をタップして配置を一巡させること。

- 分割追加メニューに左右／上下を追加。従来の自動分割も残す。
- 分割中の方向セレクトで自動・左右・上下を指定できる。
- 普段は短いバーだけを表示。44pxの操作領域を短くタップすると、分割方向と並び順の2つを選ぶメニューを表示する。星や回転マークは常設しない。
- 中央からドラッグすると取り分だけを変え、メニューは開かない。キーボードのEnter/Spaceにも対応。
- 方向と順番は `taskspace-pane-layouts-v1` にグループ別で保存。枠そのものは並べ直さずCSSのorderを使い、編集欄やスクロールのDOMを維持する。
- 本番の同期やデータモデルは変更しない。`codex/rotate-pane-layout` のVercel PreviewはSupabase環境変数を空にしたローカルモードでビルドする。
- ブランチは本番の29ef7d8を起点にし、手書きの検証ブランチとは分ける。Antigravity側の未確認の変更は含めない。

検証コマンド：`node node_modules/@playwright/test/cli.js test --config playwright.panes.config.js --workers=1`。ChromiumとWebKitでタップ、ドラッグ、並び順、復元、別タブ、三分割、および従来の枠操作を確認する。

本番反映前の確認：Chromium・WebKitで75件通過。WebKit未対応のscrollbar-color外観検査1件のみスキップ。開いたメニューへの合成click誤入力を防止。マウスのダブルクリック均等化も維持。
