# 三端末から開く検証版

0.26.0 / 本体1.15.35。通常Appを新同期と検証用Supabaseへ接続し、既存VercelのGit連携でPreviewへ配る。
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
新ビルドの配信後、この検証版へアクセスできることを確認してから実機を依頼する。
Vercelの全Previewの保護をまとめて解除する対応は行わない。

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
