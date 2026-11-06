# 普段の画面とPWAへの接続

lab 0.20.6 / 本体 1.15.31。新同期を`src/main.jsx`の通常入口へ接続する、明示的な検証ビルドを追加した。
本番へ公開する工程ではない。DB・Drive・既存端末の保存を変更していない。

## 起動するProviderは一つ

`StrictMode → AuthGate → OutlineProvider → App`の構成を共用する。
`#outline-provider`はビルド時に一方へ解決し、画面上の操作で新旧を切り替えない。

| モード | Providerと接続 |
|---|---|
| 従来のdev / production | 従来のProvider。通常配信を自動で切り替えない |
| `sync-staging` | 新Providerと検証先のSDK。設定済みの`experiments/sync-lab/.env.staging.local`だけを使い、本番参照IDと管理鍵を拒否する |
| `sync-release` | 新Providerと本番向けSDK。従来のログイン保存を読み、公開鍵・文書UUID・旧書き込み停止の設定を必須にする。まだ配信しない |
| labの`app.html` | 通常入口を使う合成試験。windowの設定は試験側が用意する。公開しない |

`sync-staging`は本体側の`VITE_SUPABASE_*`へフォールバックしない。
旧書き込み停止からの引き継ぎは、別途`LAB_SUPABASE_CUTOVER=1`が必要。
本番向け接続と既存ログインの引き継ぎは0.21.0で実装した。0.22.0では合成接続で通常PWAの配信更新・互換成果物の往復も確認する。

## 実画面の接続

タスク・分割ペイン・アウトライン・タスク側からのメモ追加を、同じ本体Appで使う。
メモ追加APIは木を購読せず、追加する時点の文書へ一度だけ編集を渡す。
アウトラインの表示設定を読み戻し、旧アウトラインの保存名には書き戻さない。
新同期の通常画面には検証用のログアウト・復元欄を追加しない。
旧同期用の全件置換・削除操作も表示しない。通常の編集とUndoは新履歴へ渡す。

AuthGateの通知が同期側より先に届く場合、未確定の所有者を「復元対象と一致した」と判断しない。
所有者が確定するまでは待機し、その後に排他起動する。StrictModeでも二つの文書を稼働させない。

## PWAの確認方法

通常入口の検証PWAは、HTML/JS/CSSに加えて約3.6MBのWASMもprecacheする。
エンジンを端末保存へ含めないと、履歴が残っていても圏外で起動できないため。
実際のService WorkerとIndexedDBを使う合成試験を、Chromium/WebKitで行う。

```powershell
# experiments/sync-labから。固定した旧版の往復試験は従来のprepare:rollbackを使う。
pnpm prepare:app
$env:LAB_VERIFY_APP_PWA = '1'
pnpm test tests/app-screen.spec.js tests/app-pwa.spec.js
```

`prepare:app`は新規の`.data/app-pwa-fixture-*/`へ生成し、接続先をlocalhost:4183の合成HTTPへ固定する。
実サービスの鍵・個人データは使わない。生成物は公開・本番配信しない。
manifestと`.data/app-preview.json`で対象を記録し、試験中はファイルを作り替えない。
全体CIは生成を終えてから通常の試験とpreviewの二サーバーを起動する。
一万行の性能比較は従来の比較サーバーだけを起動し、previewを混ぜない。

PWAの試験では、ページの通信差し替えでService Workerの通信を素通りさせない。
ローカルHTTPサーバーから、HTML・JS・WASM・Auth・同期APIを含む全応答を停止する。
制御用の試験URLだけをNodeから使って復帰させる。WASMのprecacheも確認する。
停止中に入力し、端末保存後にブラウザープロセスを終了し、同じディスク保存profileで起動して本文と未送信を確認する。
その間のサーバーへの追記は増えず、復帰後は別端末へ反映される。
profileはtmpdirへ新規作成する検証専用のもの。ログイン保存・SW・WASM・IndexedDBを持ち越し、利用者の保存名を初期化しない。
一時contextで元のDBを再取得できない条件が記録されたため、実PWAの通し試験はこのディスク保存へ揃える。
保存消失時は空を作らず停止する保護を維持し、専用の保存回帰で確認する。

0.20.1のLinux全体CIでは、本文反映後も送信元の待ちが残る失敗が1件あった。
0.20.2では`deliveryState()`で通信前・応答受領・ACKの端末保存・停止状態を区別する。
本文・差分・認証値は記録しない。失敗時の試験添付だけに残し、通常画面に診断表示を足さない。
専用の`sync-app.yml`でも通常画面とPWAを検査する。一回の再試験成功を原因解消の証明にしない。

反復と全体CIの双方で、正常ACKをIndexedDBへ確定する際の`InvalidStateError`を確認した。
0.20.3では取引開始前の接続断に限り、既存の同じDBを一回だけ開き直す。
並行した読み取りも同じ開き直しを待つ。途中の取引中止・容量不足・明示終了は再実行しない。
保存領域自体がなくなっていたら再取得を中止し、空のDBを作らない。
回帰試験は修正前の失敗も確認し、PWAでもACK保存後の再起動まで検査する。
0.20.3のLinux反復では通常ケースの失敗が残ったため、0.20.4で終了理由と再取得の開始回数を区別した。
本番導入を許可する完了記録ではなく、最新の結果はRESULTS.mdへ残す。
専用CIは同じPlaywright版の公式イメージをダイジェストで固定し、aptミラーの待ち時間を試験から除く。
保存接続の再取得を含む最終の全体CIは264件成功した。
0.20.5では、意図した圏外で失敗した合成APIのnative通信診断だけを試験から分ける。
windowのerror/unhandledrejectionも別に拾い、同じ形の未処理Promiseを見逃さない回帰を通す。
失敗要求は同じcontextで追い、SW経由でpageへ通知されない通信も照合する。
最終の0.20.6では、ディスク保存の通常範囲40件とWebKitの通常復帰20件がLinuxの専用CIでも成功した。
一時contextでの過去の失敗と、その区別はRESULTS.mdに残す。

Windows WebKitの`setOffline(true)`ではナビゲーション時に内部エラーとなったため、
最終試験は上記の全HTTP停止を両ブラウザーで共用する。
通信の復旧イベントも明示的に送る。OSの機内モード・実機PWAのプロセス終了・IMEの確認とは区別する。

設定済みの実検証先へ接続する通常入口も、リポジトリルートから生成できる。
新規の出力先を指定し、既存の控え・成果物は上書きしない。

```powershell
npm run dev -- --mode sync-staging
npm run build -- --mode sync-staging --outDir experiments/sync-lab/.data/新規の生成先
```

このビルド成功は、実サービスで通常App全体を通した結果ではない。
実検証先には従来のタスク用の表も必要になるため、通常Appの実サービス通し確認は切替リハーサルへ残す。
実GASの画像・控えの往復も別の確認条件とする。

## 次の区切り

0.21.0の`sync-release`では、検証専用の認証保存名を本番へ流用しない。
本体SDKと同じ既定値で既存の認証保存を直接読み、AuthGate・タスク・新Providerを同じSDK・利用者へ固定する。
ログインのコピー・削除・再ログインによる移し替えはしない。windowの検証設定と診断APIも使わない。
同じ所有者・文書UUID・`owner:${ownerId}:${docId}`の保存名を最新版と互換版で維持する。
実接続のビルドはwindowの合成設定へフォールバックせず、公開鍵と文書を検査する。
起動時はサーバーの旧書き込み停止・本人・移行先を確認し、原本を確定してから引き継ぐ。
設定不足で従来Providerへ逃がすと停止済みの旧同期を再開しかねないため、新経路のビルドはその場で失敗させる。

設定は従来の本体`.env.production*`またはビルド環境から読む。公開する値は次の4項目だけ。
`VITE_SUPABASE_URL`は既存の本番プロジェクトへ固定し、管理鍵と他プロジェクトのanon JWTを拒否する。
publishable鍵の所属や本人の権限は、実際のAuth/RLSと切替APIで確認する。鍵の形式検査を署名検証と呼ばない。

```text
VITE_SUPABASE_URL=既存の本番Supabase URL
VITE_SUPABASE_ANON_KEY=既存の公開鍵
VITE_OUTLINE_DOCUMENT_ID=切替SQLで用意する固定の文書UUID
VITE_OUTLINE_CUTOVER=1
```

`VITE_OUTLINE_CUTOVER=1`は停止済みであるという自己申告ではない。初回起動で停止確認APIを必ず通す設定。
未準備のSQL・別所有者・別文書・未停止の応答では、新旧どちらへの書き込みも始めない。
本番切替前の三端末の新しい控え・共通原本・切替SQLに合わせて文書を固定し、端末ごとにUUIDを作らない。

依存は追加せず、本体の`npm ci`と検証室の`pnpm install --frozen-lockfile`を先に行う。
その後、ルートの`npm run build -- --mode sync-release --outDir experiments/sync-lab/.data/新規の生成先`で通常Appの成果物を作る。
専用CIも両lockfileから取得してからこのモードをビルドする。通常の`npm run build`の配信先は変えていない。

接続先だけをlocalhostの合成Auth/RPCへ置換した検証成果物は、検証室から
`node scripts/build-app-preview.mjs --release`で作る。実サービスの鍵や本文は入らない。
`LAB_VERIFY_APP_PWA=1`と`LAB_VERIFY_APP_RELEASE=1`を指定し、`pnpm test tests/app-release.spec.js`で検査する。
既存SDKが保存したログイン、旧版の未送信、原本保持、通常Appのタスク、再起動後の本文、
開いただけの非書込みと停止未確認時の拒否をChromium/WebKitで確認する。これは本番での移行成功の記録ではない。

通常PWAの更新・互換版への往復は[配信切替試験](ROLLBACK.md)へ接続した。
未送信のIDとバイト列・移行完了記録・旧原本を維持し、Workerの実更新と全HTTP停止中のプロセス再起動を通す。
配信ファイルが欠けたときの旧版での編集継続も確認し、ローカルの4件は両ブラウザーで成功した。
合成成果物を実サービス用の配信物として扱わない。残りは次の二群に固定する。

1. 実Supabaseの旧書き込み停止からの自動切替と、隔離した実GASの画像・控えを、実接続の通常App/PWA成果物で通す。
2. PC・iPad・Androidの実機PWAで持ち替え・日本語変換・終了再開・圏外からの復帰を確認する。

その後、直前の控えを確保して本番のSQL・配信を行う。
合成試験・ビルドの成功を本番切替の成功に読み替えない。[導入条件](RELEASE-GATES.md)も参照。
