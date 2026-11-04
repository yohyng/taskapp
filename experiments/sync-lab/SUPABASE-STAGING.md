# 実Supabaseへの接続準備（0.14.0）

本体Outliner・AuthGate・SDK・Loroの経路を、独立したSupabaseプロジェクトへ接続する。
本番へ切り替える工程ではない。0.14.0の実装時点では検証先が未指定で、実サービスの試験は未実施。
合成Auth・PostgREST・通知を止めた試験の成功を、実サービスの成功と読み替えない。

2026-11-04に検証先URL `https://wtshrgsmqavcytjmqjft.supabase.co` をユーザーから受領した。
本番の参照IDと異なることを確認し、受領した公開鍵はgit対象外の`.env.staging.local`へ保存した。
同日にAuth設定のGETが200、既存SDKによる同期表のSELECTが404/PGRST205で応答することを確認した。
後者は未投入の表がschema cacheにないという内容で、SQL適用後の同期成功を意味しない。
Data APIルートのOpenAPI取得は401/Secret API key requiredだが、SDKの表読取りは別の経路で応答するため、
この確認のために管理鍵を要求しない。実ログイン・SQL適用・Realtime配信はまだ未検証。
次は確認済みテストユーザー二人のUUID・非公開の認証設定を用意して合成原本を生成する。

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
4. 二人それぞれのSDK購読が成立し、RPCによる追記の実変更通知が届く。pollでの成功代替はしない。
5. 通知後にRPCの確定済み原本と全ログから文書を再構築し、本文一致。同じ差分の再送でheadは増えない。
6. 他人の文書を購読した接続へは観測中に変更通知が届かない。これは権限試験と併せた短い観測で、永久の非配信を証明するものではない。

通知の購読・配信は15秒、HTTPは10秒で未完了とする。
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

## この区切りの残り

実サービス試験を実行したら、日付・実装コミット・プロジェクト参照ID・結果をRESULTS.mdへ記録する。
検証先未指定・未実行の間は成功扱いにしない。
その後、各端末の未送信を含む本番の移行・Driveの自動控え・実機PWAとIMEへ進む。
通常起動の製品へ新同期を接続する切替や本番のSQL実行は、ここには含めない。
