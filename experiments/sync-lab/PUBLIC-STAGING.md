# 三端末から開く検証版

0.27.0 / 本体1.15.35。通常Appを新同期と検証用Supabaseへ接続し、既存VercelのGit連携でPreviewへ配る。
本番のドメイン・DB・通常のDrive設定は変更しない。新しい認証情報や管理鍵も追加しない。

## 配信する版

GitHubのVercel botで確認したブランチURL：
https://taskapp-git-codex-compare-syn-366be3-willowyana3-2255s-projects.vercel.app

`vercel.json`は`node scripts/vercel-build.mjs`を呼ぶ。
`codex/compare-sync-engines`・`preview`・`yohyng/taskapp`・40桁のコミットが揃った時だけ`sync-staging`を生成する。
そのブランチをProductionへ指定した場合は停止する。他ブランチの通常ビルドは従来Providerを使う。
Previewだけ、既存CIと同じpnpm 11.25.0で検証室のlockに従って依存を取得する。アプリの依存追加はない。
接続設定は検証先`wtshrgsmqavcytjmqjft`と切替済みの合成文書に固定する。
公開鍵はブラウザーへ配る値で、ログイン・RLSを省略するものではない。メール・パスワード・GASの合言葉は含めない。

Vercelの[ブランチ別ビルド](https://vercel.com/kb/guide/dynamic-build-commands)と
[System Environment Variables](https://vercel.com/docs/environment-variables/system-environment-variables)に従う。
Vercelアカウントの全体設定やProductionの環境変数は変更しない。

## 公開後、ログインする前の照合

ビルド後に`sync-staging.json`へコミット・接続先・全ファイルのSHA-256を記録する。
Service Worker生成後に書くので、識別用manifest自体は圏外起動の必須ファイルにしない。

```sh
node scripts/published-staging-assets.mjs <上記ブランチURL> <配信した40桁のコミット>
```

既知のURL以外、ログイン画面への転送、別コミット・別接続先・欠損WASM・配信後のバイト列の不一致を拒む。
PWA名`Task Space 検証`・`start_url: /`・standaloneも照合する。認証値はこのコマンドに入力しない。

最初に既存Previewを未ログインで取得すると、Vercelのログイン画面へ転送された。
管理画面もこの環境では未ログインで、CLIの既存ログインもなかった。
実装`d4f31b5`の[Vercelデプロイ](https://vercel.com/willowyana3-2255s-projects/taskapp/CkNH83B2aS3VGiXCPWuCRBs4XmyJ)はGitHubのコミットstatusで成功を確認した。
配信後の成果物照合コマンドは、ログイン制限による転送を拒んで未完了となった。
管理画面へのログイン後、この検証版へアクセスできることと配信バイト列を確認してから実機を依頼する。
その後ユーザーからこの検証版の共有リンクを受領し、`02b2b98`の公開確認が成功した。Vercel全体の保護設定は変更していない。
リンクの値は`.data/published-access.private.json`だけに保存し、Git・ログ・資料へ載せない。

## 共有リンクでの公開版の確認結果

```sh
node scripts/verify-staging-app.mjs .data/staging-app-0231/manifest.json --chromium --published .data/published-access.private.json --ref <40桁の配信コミット>
node scripts/verify-staging-app.mjs .data/staging-app-0231/manifest.json --webkit-live --published .data/published-access.private.json --ref <同じコミット>
```

二つを並行させず、実行中はソース・資料も編集しない。
既知の検証URL・一つの共有値だけを受け付け、外部への転送を拒む。
アプリのログインを行う前に、コミット・接続先・PWA識別と15ファイルのSHA-256を照合する。
共有Cookieは検証用ブラウザーのメモリー内で使い、アプリの認証値と一緒に記録しない。

初回のHTML照合はVercelの既知のfeedback.js追加で停止した。
アプリ本体の照合は、[公式のリクエスト単位のツールバー省略](https://vercel.com/docs/vercel-toolbar/managing-toolbar#disable-toolbar-for-automation)を使用し、15ファイル全てが元のSHA-256と一致した。
HTMLを正規表現で削って成功にする処理は追加しない。実画面は通常の公開URLを開き、HTMLやAPI応答を差し替えない。

11月6日、公開コミット`02b2b98b9424fdbc53b7566586dcd19f46ba4d27`で以下が成功した。

- Chromiumの永続profile：タスク表示と旧未送信の自動引き継ぎ・通常入力の同期・圏外プロセス再起動と合流・古い未編集端末の非書込み起動の4シナリオ。
- WebKitの通常context：引き継ぎ・通常入力の同期・三接続での古い未編集端末の非書込み起動の3シナリオ。
- 共有アクセス・公開照合・実Auth・RPC・Realtime・実Service Workerを使い、旧同期への要求・確認バナー・未処理JS例外はなかった。

WebKitの3件を永続PWAの再起動やiPad実機の成功には数えない。次は下記の三端末実機を確認する。

## 実機での短い確認

三台とも同じブランチURL・同じ検証ユーザーAを使う。
普段の本番ログインではなく、既に手元の非公開設定へ入力した検証用アカウントでログインする。
実データのJSONや本番のDrive設定をこの検証版へ取り込む必要はない。

1. PCで「PCからの追記」を入力し、iPad・Androidで自動反映を確認する。
2. iPadで日本語変換を確定し、Androidでも続きを入力する。PCで両方が残ることを確認する。
3. 一台を機内モードにし、追記してPWAを終了・再起動する。追記が残り、通信復帰後に他の二台へ反映することを確認する。
4. しばらく触っていなかった一台を開く。最新の続きを表示し、他端末の新しい内容が古い状態へ戻らないことを確認する。

通常操作でJSON退避や「向こうに合わせる」を求めない。大きな確認バナーが出た場合は実機の合格にしない。
Windows WebKitの通常contextでの実接続成功を、このiPad PWAの確認には置き換えない。
完了後は三端末の直前の控え・停止後の最新原本を揃え、本番SQLと配信へ進む。
