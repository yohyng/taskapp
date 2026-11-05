# Task Space 同期の検証室

本番とは独立したYjs / PowerSync / Loro案の小さい試作。
比較の範囲、合格条件、次の工程は [EXPERIMENT.md](EXPERIMENT.md) にまとめる。
日本語入力の比較画面は `/?doc=demo&input=bound`。接続方法と試験の限界は [INPUT.md](INPUT.md) を参照。
枝の操作は `&tree=1` を加える。木としての未解決点も含めて [TREE.md](TREE.md) に記録する。
0.5.0からLoroの木・Undo・保存バイナリの意味も単体で比較する（[LORO.md](LORO.md)）。
0.6.0では `/?engine=loro&doc=demo&input=bound&tree=1` で入力・端末保存・通信も比較する。
経路と限界は [LORO-INTEGRATION.md](LORO-INTEGRATION.md) を参照。
1万行の独立した測定は [PERFORMANCE.md](PERFORMANCE.md)、保守の分担は [OPERATIONS.md](OPERATIONS.md)、
次の実装を絞る判断は [DIRECTION.md](DIRECTION.md) にまとめる。
0.8.0ではLoroの本文・属性の変更行だけを読む表示データを追加する。境界と確認方法は [PROJECTION.md](PROJECTION.md) を参照。
0.9.0では編集差分と送信待ちを一体で追記し、保存済みの世代を安全にsnapshotへまとめる（[PERSISTENCE.md](PERSISTENCE.md)）。
0.10.1では空の端末へsnapshotと未適用受信を配り、保存後に表示とUndoを接続する。既存端末は差分交換を続ける（[BOOTSTRAP.md](BOOTSTRAP.md)）。
0.12.1では本体の既存ログイン・SDKを検証へつなぎ、保存済み本文は通信を待たずに開く（[SESSION-INTEGRATION.md](SESSION-INTEGRATION.md)）。
0.13.0では実際のOutlinerと、Supabase用の追記ログRPCを接続する（[DATABASE-INTEGRATION.md](DATABASE-INTEGRATION.md)）。
本番の切替は行わず、`outline.html`の合成Auth・使い捨てDBで試験する。
0.13.1では大きな本文差分を同じ履歴のまま分割し、送信待ちを一取引で置換してから再送する。
旧版で残った大きな未送信、分割後の再読込、応答喪失とUndoも検査する。
0.13.3では本文入力時の大きな全文差分計算も避け、変更範囲を直接適用する。
分割受信の途中で作成された行は、行ID・本文・親の準備が揃ってから表示する。
0.14.0では独立した実Supabaseへ接続する専用モード、合成原本のSQL生成、実Auth・RPC・Realtimeの試験コマンドを追加する。
実サービスの試験には別プロジェクトが必要で、未指定・未実行の間は成功としない（[接続手順](SUPABASE-STAGING.md)）。
0.14.1では実Supabaseの認証・保存・変更通知・権限拒否の試験が成功した。
WebSocketの接続からDB配信準備までの間の変更も、配信準備完了時の再取得で拾う（[結果](RESULTS.md)）。
0.15.0では旧端末のキューと編集前署名から、本文・属性の変更列だけを引き継ぎ候補にする。
原本保全とローカルの照合までを実装し、端末での一度限りの適用や本番切替はまだ行わない（[移行候補](MIGRATION-HANDOFF.md)）。
0.16.0では新規親子・削除・移動と、原本・差分・処理済み印の一体保存まで検証する。
旧同期を止めて新エンジンへ引き継ぐ製品の起動経路と、本番切替はまだ接続しない。
0.17.0では明示的な切替モードで、旧保存の捕捉から引き継ぎを終えて実Outlinerを開く（[自動切替](STARTUP-CUTOVER.md)）。
通常の本番起動は切り替えず、旧サーバーを止めるSQLも別に検証する。
0.18.0では新同期の実画面から画像貼り付けとDrive控えをつなぎ、本文・未送信・履歴・移行原本を一緒に残す。
別文書への読み戻しと復元候補の展開までを扱い、稼働中の端末置換・旧同期の再開は次へ残す（[控えと復元候補](BACKUP-RECOVERY.md)）。
0.19.0では[控えの端末復元](BACKUP-RECOVERY.md)を排他起動へ接続し、今ある編集を保ちながら同じ履歴へ合流する。
新同期と最新データを維持する[互換版への切り戻し](ROLLBACK.md)も固定コミットからのビルドで往復を確認する。
0.19.2では実Outlinerの11,438行・12ルート・深さ12で、開くだけの非書込み・未送信の再読込・別端末との合流を全行照合する。
全体CIも開発ブランチへのコードpushで実行し、PRイベントだけに依存しない。
0.20.1では本体の通常入口・タスク・分割ペイン・メモ追加を新同期へ接続する検証ビルドを追加した。
実際のService Workerで、全HTTP停止中の再読込と未送信の保持・復帰も両ブラウザーで確認する（[通常画面とPWA](APP-INTEGRATION.md)）。
従来の通常配信は切り替えず、本番の接続・PWA更新と切り戻し・実機確認は導入前に残す。
0.20.2ではLinux WebKitの送信完了待ちの停止位置を本文なしで記録し、通常画面/PWAの専用CIで反復検証する。
失敗後の再試験が成功しても、原因解消と全体合格は別に記録する（[結果](RESULTS.md)）。
0.20.4ではACKを端末保存へ確定する際の接続断を調べる。開始前に限った接続再取得と、空の保存を作らない回帰を追加した。
ローカル78件は成功したが、Linuxの通常PWAに残る停止条件を確認中で、本番導入はまだ行わない。
0.20.5では保存接続の最終実装が全体CI264件を通り、圏外の通信診断と未処理JavaScript例外を試験から区別する。
実際の未処理例外を見逃さない回帰も追加した。固定環境での反復結果と導入までの残りは[結果](RESULTS.md)を参照。
0.20.6では実PWAに合わせてディスク保存のprofileを使い、ブラウザー終了後の圏外起動も検査する。
一時contextで保存領域を再取得できない条件と分け、空のDBを作らない保護は維持する。
0.20.6の専用CIは通常範囲40件・WebKit復帰20件の計60件が成功。本体CI・切替専用CI・全体CI266件と独立比較6件も成功した。
0.21.0では`sync-release`の本番向け接続を追加し、既存ログインを直接使う通常Appで停止確認・未送信引き継ぎ・PWA再起動を検査する。
通常の配信は切り替えず、合成接続で4件成功した。次はPWA配信更新と互換成果物の往復・実サービス・実機確認。
0.22.0では固定した0.21.0と最新版の通常PWAを同じURLで配り、更新・切り戻し・圏外再起動・配信失敗中の編集4件を両ブラウザーで確認した。
未送信のID/バイト列と移行完了記録を維持し、最後に別端末へ届ける。実サービスと三端末の実機が残る（[配信の検証](ROLLBACK.md)）。
0.22.1ではGit所有者違いのCI取得を再現・修正し、通信診断と実際のJS例外を独立して検査する。配信反復12件と既存8件がローカルで成功した。

## 起動

Node.js 24とpnpmを使用する。

```sh
# 本体の既存AuthGate・SDKを使うため、ルートのlockfileからも取得する
npm ci --prefix ../.. --ignore-scripts --no-audit --no-fund
pnpm install --frozen-lockfile
pnpm prepare:assets
pnpm dev
```

検証画面は `http://127.0.0.1:4180/?doc=demo`。
同じURLを別のブラウザープロファイルで開くと、保存領域を分けて同じ文書を編集できる。
同じブラウザーのタブはIndexedDBを共有するので、別端末の代替にはしない。
合成データは30行で、サーバーが文書ごとに一度だけ用意する。

## PowerSyncを実サーバーで起動する

LinuxとDocker Composeが必要。Windowsのこの作業環境にはDocker/WSLがないので、
同じ手順をGitHub Actionsの使い捨て環境で実行する。

```sh
docker compose -f infra/compose.yaml up -d --wait
LAB_POWERSYNC=1 pnpm dev
```

画面は `http://127.0.0.1:4180/?engine=powersync&doc=demo`。
実際のPostgresの論理レプリケーション→PowerSync Service→Web SDK→端末SQLiteを使う。
書き込みはAPIが変更列と変更前の値を照合し、同じ本文の競合は別テーブルへ両方を保全する。
再送には操作IDを使い、DB取引の中で重複排除と更新をまとめる。

**認証・権限の製品実装ではない。** ローカル専用の固定利用者と合成データに限定する。
公開してはいけない。全実験文書を配る設定なので、Supabase Auth/RLSの検証にもならない。
DBのパスワードは使い捨て環境専用。環境変数で本番の接続先を渡さない。

## 試験

```sh
pnpm exec playwright install chromium webkit
pnpm test:unit
pnpm test
# Dockerを起動したLinuxでは、両方式を続けて実行
LAB_POWERSYNC=1 pnpm test
```

3つの独立したブラウザー保存領域から、本物の同期サーバーへ接続する。
Chromium/WebKitで、持ち替え、本文と属性の合流、通信切断後の保存・再読み込み、
自分だけのUndoを共通で確認する。同じ本文への同時追加はYjsでは文字の統合、
PowerSyncでは競合を別々に保全する試験に分ける。後者は返事を失った再送も確認する。

今回は同期通信だけを切断する。HTTPとService Workerを含む実機PWAの圏外再起動や、
OSの日本語候補選択、1万行の全体負荷、サーバー障害はまだ確認していない。
木の移動・削除は別の画面で比較する。単純な親IDの統合が循環する再現も含むため、
試験が通ったことと目指すUXを満たすことは区別する。
別途、入力プロトコル／DOMイベントを使う変換中の受信試験を追加した。

## 保存領域と境界

- ブラウザー：`taskspace-lab-yjs-<文書ID>` という専用IndexedDB。
- PowerSyncのブラウザー：専用名のSQLite（IDBBatchAtomicVFS、今回は複数タブ無効）。
- Loroのブラウザー：`taskspace-lab-loro-<文書ID>` の専用IndexedDB。差分と送信待ちを一取引で追記し、snapshotと未適用受信を世代付きでまとめ直す。
- Loroのサーバー：`.data/loro/` のバイナリを含む専用ファイル。30行のHTTP交換用で製品の同期サービスではない。
- PowerSyncのサーバー：ローカルDocker内の `lab_source` / `lab_storage`。
- サーバー：このフォルダーの `.data/` にYjsバイナリ。
- 本番のSupabase・Drive・taskappの保存キーは使わない。
- 本体リポジトリの依存・コード・版番号を変更しない。
- 画面・保存API・Hocuspocusは127.0.0.1限定。PowerSyncのDocker構成はLinuxのhostネットワークを使う。
  製品用の認証や公開ホスティングは未実装。
- バイナリを毎回JSONから作り直さず、保存したYjsの履歴ごと読み戻す。
- 「接続中」は保存完了を意味しない。画面のボタンでサーバー保存ファイルとの一致を別に確認する。

実行結果は [RESULTS.md](RESULTS.md) に記録する。

認証とサーバー強制終了の独立試験は`pnpm test tests/loro-owner.spec.js`。
本番の認証・データには接続せず、使い捨てのAuth応答サービスと実HTTP子プロセスを使う。
保存確定の条件と公式Protocol調査は[AUTH-DURABILITY.md](AUTH-DURABILITY.md)を参照。

0.12.0から既存AuthGateと本体のSDKを使うため、最初にリポジトリのルートで
`npm ci --ignore-scripts --no-audit --no-fund`も実行する（既存package-lockを使用、依存追加なし）。
ログインからの連携試験は`pnpm test tests/loro-session.spec.js`。
試験用の`session.html`は本番接続設定を読まない。[接続範囲と次の通信案](SESSION-INTEGRATION.md)を参照。
