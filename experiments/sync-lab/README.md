# Task Space 同期の検証室

本番とは独立したYjs / PowerSync / Loro案の小さい試作。
比較の範囲、合格条件、次の工程は [EXPERIMENT.md](EXPERIMENT.md) にまとめる。
日本語入力の比較画面は `/?doc=demo&input=bound`。接続方法と試験の限界は [INPUT.md](INPUT.md) を参照。
枝の操作は `&tree=1` を加える。木としての未解決点も含めて [TREE.md](TREE.md) に記録する。
0.5.0からLoroの木・Undo・保存バイナリの意味も単体で比較する（[LORO.md](LORO.md)）。
0.6.0では `/?engine=loro&doc=demo&input=bound&tree=1` で入力・端末保存・通信も比較する。
経路と限界は [LORO-INTEGRATION.md](LORO-INTEGRATION.md) を参照。

## 起動

Node.js 24とpnpmを使用する。

```sh
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
- Loroのブラウザー：`taskspace-lab-loro-<文書ID>` の専用IndexedDB。一取引にsnapshot・待機中の受信・送信待ちを保存する。
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
