# 実Supabaseへの接続と試験

## 通常App/PWAの実接続確認（0.24.0）

切り替え用SQLの適用後、前回生成した通常App/PWAのmanifestを指定する。
既存の`.env.verify.local`を読み、接続先・所有者・切り替え先・全ファイルのハッシュを照合してからログインする。
検証先以外・変更された成果物は実行せず、公開設定以外をアプリへ渡さない。
`4184`番で検証済みの静的バイト列だけを配り、Auth・RPC・Realtimeは実サービスを利用する。

```sh
node scripts/verify-staging-app.mjs <実接続Appのmanifest.json> --chromium
node scripts/verify-staging-app.mjs <実接続Appのmanifest.json> --webkit
```

同時に走らせない。実行中はソース・成果物・資料を編集せず、通常Playwrightや開発サーバーとも並行しない。
合成文書へ実際の追記を行い、通常の利用者profileやDrive設定は使わない。
Chromiumは旧未送信の移行・通常入力の同期・圏外プロセス再起動と自動統合・古い未編集端末の非書込み起動の4件が成功した。

このWindowsでは永続WebKitの外向きHTTPSが、単独の公開設定GETでも停止した。
通常contextの接続は成功するため、実接続の同期だけを別に検査する明示モードも用意した。

```sh
node scripts/verify-staging-app.mjs <実接続Appのmanifest.json> --webkit-live
```

これは通常Appの引き継ぎ・通常入力・古い端末の3件で、永続profileの圏外再起動を含めない。
自動でこのモードへ切り替えて合格を作らない。既定の全ブラウザー実行は永続profileを使う。
結果に`persistentPwaRestart: false`を記録し、iPad PWAの確認は別に残す。
現時点の成果物はローカルのみで、実機から開ける検証URLへの配信は未実施。

## 通常アプリへ進むための合成切り替え（0.23.0）

前回の二文書をそのまま残し、別の文書を作って旧同期の停止・凍結原本・新同期の開始を検証する。
11月6日の読取りでは、検証先に`outline_nodes`とタスク用の六表はなく（GETが404/PGRST205）、
切り替えRPCも未作成だった（404/PGRST202）。HEADの204だけを存在確認に使わない。

```sh
node scripts/prepare-staging-cutover.mjs <前回のmanifest.json> <新規出力フォルダー>
```

生成する`setup.sql`を**検証用**プロジェクトのSQL Editorで実行する。
本番向けSQLではなく、既存の旧表を移行するための手順にも流用しない。
先に二人の検証ユーザー・二原本の所有者とSHA-256が一致することをDBで照合する。
七表や切り替え設定が既にあれば拒否し、既存表・既存原本・過去の編集ログへ上書きしない。
作った七表はユーザーAだけが利用でき、Bや未認証へ開放しない。

一取引内で、合成の旧行を投入→旧書き込みを停止→凍結した全行の一致確認→
別文書の一つのsnapshotを登録→切り替えを有効化する。
不一致や途中の失敗は表作成も含めて戻す。再投入は既存表の確認で停止する。
実データでは停止後に原本を取得する工程が別に必要であり、この合成一括SQLで代用しない。
`supabase_realtime`があるときはタスク用六表の通知も有効にする。

SQL適用後は既存の非公開設定を使って確認する。メール・パスワードを再入力したり、チャットへ送ったりする必要はない。

```sh
node --env-file=.env.verify.local scripts/verify-staging-cutover.mjs <新しく生成したmanifest.json>
```

所有者の切り替え先・原本ハッシュ・七表の読取り・他人の非表示・旧書き込みの55000拒否を確認する。
旧表への検査は存在しない行のUPDATEで、万一停止が欠けていても本文を変更しない。
新文書へは追記せず、headが増えないことも確認する。生のSDK例外や認証値は出力しない。
生成した`browser.env.example`は次の通常App/PWA検証の公開設定。SQLの適用確認前に既存設定を切り替えない。
通常App/PWAの実接続による入力・持ち替え・圏外再起動は、このSQLの生成・確認とは別に実行する。

0.19.2でも設定済みの同じ検証先でSDK試験と実Outlinerの4シナリオを再実行し成功した。
最新の結果と範囲は[RESULTS.md](RESULTS.md)、通常入口・切替・PWAの残りは[RELEASE-GATES.md](RELEASE-GATES.md)を参照。

本体Outliner・AuthGate・SDK・Loroの経路を、独立したSupabaseプロジェクトへ接続する。
本番へ切り替える工程ではない。0.14.0の実装時点では検証先が未指定だったが、0.14.1では以下の実サービス試験まで成功した。
合成Auth・PostgREST・通知を止めた試験の成功を、実サービスの成功と読み替えない。

2026-11-04に検証先URL `https://wtshrgsmqavcytjmqjft.supabase.co` をユーザーから受領した。
本番の参照IDと異なることを確認し、受領した公開鍵はgit対象外の`.env.staging.local`へ保存した。
同日にAuth設定のGETが200、既存SDKによる同期表のSELECTが404/PGRST205で応答することを確認した。
後者は未投入の表がschema cacheにないという内容で、SQL適用後の同期成功を意味しない。
Data APIルートのOpenAPI取得は401/Secret API key requiredだが、SDKの表読取りは別の経路で応答するため、
この確認のために管理鍵を要求しない。

同日に二人のUIDを受領し、`.data/supabase-staging-wtshrgsmqavcytjmqjft/`へ合成原本とSQLを一度だけ生成した。
文書Aは`6ee091b1-cd09-41fc-8bb8-8e4359ae2582`（所有者`8644901a-816b-4edf-83dc-20bea1d22f17`）、
文書Bは`ce2dc379-7655-4590-8a40-1b3c84b8c905`（所有者`1679c2af-074b-43c6-b7af-9cc7653b9908`）。
生成SQLの二つのバイナリを読み戻してmanifestのSHA-256・行IDと一致することを検査した。
SQL Editorでユーザーが実行した後、SDKの空のRPC要求と表SELECTがそれぞれ401/42501で拒否された。
以前の未作成表404と異なり、関数・表が存在し未認証から利用できないことを確認した。
この段階では原本の取得・実ユーザーのログイン・追記・Realtime配信の成功は未確認だった。
ローカルの`.env.staging.local`には公開設定と文書AのID、`.env.verify.local`には二文書とmanifestのパスを設定済み。
検証用二アカウントのメールとパスワードは後者へユーザーが手元で入力する。空欄の間は実ログイン試験を開始しない。
これらのローカル設定はgit対象外。公開鍵・パスワードはこの資料に記載しない。

0.14.1の試験ではユーザー指定の保存ファイルから4項目だけを取り込み、実Authの二接続・別ユーザー・
refreshSession・改ざんJWTの401拒否・RLS・他人の読書きと通知表の直接更新の拒否が成功した。
最初はSUBSCRIBED直後の書込みで実変更通知を失い、試験が時間切れになった。
診断で接続完了の約0.35秒後にpostgres_changesのsystem/okを受け、準備後に保存すると通知が届くことを確認した。
試験はこの配信準備を待つようにし、アプリの受信経路も準備通知でDBを取り直す。
修正後は二人それぞれの実変更通知をpollの代替なしで受信し、確定済み全ログから本文を再構築して一致した。
同じ操作の再送でheadは増えず、他人の通知も観測窓に届かなかった。成功実行の文書Aのheadは3。
これはNode上のSDK接続による試験で、実機PWA・実OutlinerでのIMEや端末保存を含む試験ではない。
その後、同じ実Supabaseへ製品Outlinerを接続するブラウザー試験も行った。
Chromium/WebKitの各二接続で、開くだけでは書かないこと、本文同期・再読込、
Supabase APIを止めた側の未送信保存と再読込、もう一方の別行編集との再接続時の自動統合が計4シナリオで成功した。
これはヘッドレスブラウザーの試験で、PWAの完全な圏外起動・実機のIMEを確認したものではない。

## 接続先を用意する

本番とは別の検証用プロジェクトと、メール・パスワードでログインできる二つの確認済みテストユーザーを使う。
プロジェクト参照ID（URLの`https://<参照ID>.supabase.co`の部分）・公開鍵・二人のユーザーUUIDを確認する。
公開鍵は`sb_publishable_...`、または同じプロジェクトの旧anon JWT。
管理用の`sb_secret_...`・service_role鍵は不要で、ブラウザーの設定にも受け付けない。
[公開鍵と管理鍵の違い](https://supabase.com/docs/guides/getting-started/api-keys)に従う。

本番参照ID`eiyzlawmcyybchxzyozr`は接続設定・生成コマンドの両方で拒否する。
通常起動は従来の試験用経路のままで、本体の`VITE_SUPABASE_*`設定へはフォールバックしない。
検証用モードでは`window.labAuthConfig`を使って接続先を差し替えることもできない。

## 合成原本とSQLを生成する

検証室のフォルダーで実行する。追加のパッケージ・CLIは必要ない。

```sh
node scripts/prepare-supabase-staging.mjs .data/supabase-staging <検証プロジェクト参照ID> <ユーザーAのUUID> <ユーザーBのUUID>
```

新規フォルダーへ次を生成する。

- `setup.sql`：権限付きRPC・原本・ログ・通知の表と、二人の合成原本の初期投入。
- `manifest.json`：接続先、文書と所有者のID、合成原本のSHA-256。
- `browser.env.example`：ブラウザー用の公開設定。
- `verify.env.example`：実サービス試験用の設定ひな形。

入力に実データのJSONは受け取らず、二行の合成文書だけを作る。
元フォルダーの再利用・同じ所有者二人の指定を拒む。
SQLは一つのトランザクションで実行し、ユーザー欠損や再投入の一意制約違反で全体を戻す。
既存の原本へ上書きする`ON CONFLICT`や旧アウトラインへの書込みはない。

生成したSQLの先頭に記された参照IDと、開いたSQL Editorのプロジェクトを照合してから実行する。
SQL Editor自体にはクライアントの接続先ガードは及ばないので、この照合は必要。
`supabase_realtime` publicationが存在すれば変更通知用の表を追加する。
[Postgres Changesの配信設定](https://supabase.com/docs/guides/realtime/postgres-changes)も確認する。
SQL・manifestの生成だけでは、リモートへ接続したり初期投入したりしない。

## 実サービスを機械的に確認する

`verify.env.example`を検証室の`.env.verify.local`へコピーして値を埋める。
`LAB_STAGING_MANIFEST`には生成したmanifest.jsonの絶対パスを指定する。
メール・パスワードはこの非公開ファイルだけへ置き、チャット・コミット・コマンドの引数へ書かない。
`.local`はgit対象外で、Viteの検証用ビルドもこのファイルを読まない。

Node.js 24で実行する。試験中は同じ合成文書を他の画面で編集しない。

```sh
node --env-file=.env.verify.local scripts/verify-supabase-staging.mjs
```

この試験は合成文書へ検証用の文字を追記する。成功には以下がすべて必要。

1. 実Authへ同じユーザーの二接続と別ユーザーがログインし、getUserで本人を確認。refreshSession後も同一人物。
2. manifestの所有者・文書ID・原本SHA-256が一致。開いただけの読取りでheadが増えない。
3. 未認証・他人の読書き・通知表の直接更新は権限拒否。不正JWTは401。RLSで他人の文書が見えない。
4. 二人それぞれのSDK購読とDB変更配信準備が成立し、RPCによる追記の実変更通知が届く。pollでの成功代替はしない。
5. 通知後にRPCの確定済み原本と全ログから文書を再構築し、本文一致。同じ差分の再送でheadは増えない。
6. 他人の文書を購読した接続へは観測中に変更通知が届かない。これは権限試験と併せた短い観測で、永久の非配信を証明するものではない。

DB変更配信の準備と実変更通知はそれぞれ15秒、HTTPは10秒で未完了とする。
SUBSCRIBEDだけで書かず、system/okのpostgres_changes準備通知を待つ。固定の待ち時間で成功を作らない。
ネット障害や404・構文エラーを「他人を拒否できた」として数えない。
管理鍵・管理SDKは使わず、公開鍵＋実ユーザーのJWTだけで試す。
合成原本のハッシュが合わなければ編集前に停止する。通常の既存データの試験には流用しない。
ログに認証情報は出さず、成功した段階と最終の参照ID・文書ID・headを表示する。

## 実際のOutlinerで開く

`browser.env.example`を検証室の`.env.staging.local`へコピーして公開鍵を埋める。
文書IDは同じmanifestのユーザーAのものを使う。

```sh
pnpm dev:staging
```

`http://127.0.0.1:4180/outline.html`を開いてユーザーAでログインする。
この専用サーバーは合成Auth・ローカル同期サーバーを起動しない。
通常の試験と4180番を共有するため、Playwrightや通常の`pnpm dev`と同時起動しない。
二つの独立したブラウザープロファイルで、持ち替え・未編集の再読込・圏外入力と再接続を確認する。
ローカル保存・ログインは検証用の文書・所有者に分け、旧製品の保存名は使わない。
このローカルHTTP起動は実機PWAの圏外起動・iPadのIME試験を置き換えるものではない。

同じ内容を自動で検査する場合は、導入済みのPlaywrightブラウザーを使って次を明示実行する。

```sh
node scripts/verify-staging-outline.mjs
```

このコマンドは`.env.verify.local`を読み、Chromium/WebKitを順に実行する。
合成文書へ実際の編集を追記する。trace・画像・ログイン情報は出力しない。
試験サーバーも4180番を使うため、通常のPlaywright・開発サーバー・別の検証コマンドと同時に走らせない。

## この区切りの残り

実サービス試験の結果はRESULTS.mdへ記録する。
次は各端末の未送信を含む本番の移行・Driveの自動控え・実機PWAとIMEへ進む。
通常起動の製品へ新同期を接続する切替や本番のSQL実行は、ここには含めない。
