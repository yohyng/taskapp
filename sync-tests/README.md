# アウトライン同期の回帰テスト

`npm run test:sync` でChromiumとWebKitの両方を確認する。
初回は `npx playwright install chromium webkit` でブラウザを用意する。

通常のUI回帰テストとは別の4174番ポートでViteを動かす。
実際のOutlineProvider・Outliner・IndexedDBを使い、db.jsの通信境界だけを
Playwrightのrouteで差し替える。本番Supabaseの鍵は使わず、外部HTTPも遮断する。
このfixtureはテスト用HTMLで、本番の入口やビルド設定には追加しない。

全件削除、再起動、IndexedDBだけに残った空の木、未送信行の保護、
取得失敗、削除後の書き始めを確認する。
SupabaseのRLS・Realtime・実機の休止復帰まで確認するテストではない。

通常の `npm test` とは分けて、順番に実行する。
GitHub Actionsは単体テスト→同期テスト→既存アウトラインUIテストの順に動く。
