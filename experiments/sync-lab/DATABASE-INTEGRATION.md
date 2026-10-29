# 本体のアウトラインとDB追記ログ（0.13.0）

## 接続する範囲

`outline.html`で既存AuthGate・Supabase SDK・製品のOutlinerを使う。
旧OutlineProviderを起動せず、公開した表示用の入口OutlineDataProviderへ新しい文書を渡す。
既存のtextarea・枝操作・JSON書き出しを同じ画面で検査する。本体の通常起動は従来の経路を保つ。
ルート1.15.30はこの入口の追加だけで、新同期を本番で有効にする変更ではない。

画面の更新関数は現在の木に適用し、変わった本文・属性・親子・順序だけをLoroへ記録する。
ID、画像URL、画像幅、折りたたみ、日付、色、見出し、作成・更新時刻を保持する。
受信や単なる表示から更新関数を呼ばない。枝の削除は印として残し、遠隔編集とUndoの履歴を保つ。
同じブラウザーの同じ所有者・文書はWeb Locksで一つだけ開き、前の窓の保存と終了を待つ。

## DBの保存確定

`infra/loro-log.sql`は検証用の新テーブル・RPC。旧outline_nodesやその履歴には触れない。
[SECURITY DEFINER関数](https://supabase.com/docs/guides/database/functions)のsearch_pathを空に固定し、
公開実行を取り消してauthenticatedだけに許可する。auth.uid()で所有者を検査し、ブラウザーからの所有者指定は採らない。
公開する変更通知用の表にはID・所有者・headだけを置き、原本と差分は非公開schemaへ分ける。
表の直接更新とprivate schemaへの接続は許可しない。通知用表のSELECTにもRLSをかける。

同じ文書の[行ロック](https://www.postgresql.org/docs/17/explicit-locking.html)を取得してから、
更新IDとバイナリが一致する再送を除き、差分を追記する。採番・追記・head更新は同じ取引で確定する。
同じIDで内容が違えば取引全体を中止する。RPCの成功応答で実際に送ったIDだけを確認する。
端末はCRC・連番・応答IDを検査し、受信差分・取得位置・送信待ち解除を同じIndexedDB取引へ残す。
途中で終了しても再送でき、取得位置だけ進めて本文を欠かさない。

一回の送信は32件・合計256KiB、一差分64KiBまで。取得も32件まで。
64KiBを超える単一編集は自動分割しておらず、そのまま本番導入する条件を満たさない。
DBはサイズ・重複・権限を検査し、Loro形式・CRCは受信端末で検査する。サーバーでLoroを再実行してはいない。

snapshotは移行時の一つを固定し、cutoff=0からログを取得する。
DBの履歴削除・snapshot圧縮はまだ行わないため、snapshot取得と削除の競争は起こさない。
一方、長期運用前には履歴の増加・保存容量の扱いが必要となる。

## 通知と再取得

既存SDKの[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)でheadの更新を購読する。
通知では完了扱いにせず、RPCから確定済みの続きを読む。起動・購読成立・画面復帰・接続復帰でも再取得する。
通常は3秒ごとの再確認を残し、端末の入力時・通知時には待たずに再取得する。
401では既存のセッション管理へ一回だけ更新を依頼し、更新や通信待ちで編集画面を作り直さない。
空の初回に取得失敗した場合は読み込み状態を保ち、取得済みの空文書と同じ扱いにしない。

## 移行候補と戻し方

`node scripts/prepare-outline-migration.mjs <outlineのJSON> <新規フォルダー>`はオフラインで次を作る。

- 元のJSONをそのまま保持する`source.json`
- 同じ行IDから一度だけ生成した`snapshot.bin`
- JSON形式に戻した`outline.json`
- 文書ID、行数、原本とsnapshotのSHA-256、cutoffを持つ`manifest.json`

出力フォルダーが既にあれば拒む。同じ文書を端末ごとに生成して履歴を分岐させないため、
全端末で同じsnapshotを使う。今回のSQLは端末に初期投入やsnapshotの置換を許可しない。
原本と候補は別に保存し、既存端末のローカル保存・旧DBへ上書きしない。
生成しただけで本番の移行完了とはしない。新経路で編集した後は、旧画面へ戻す前にその最新JSONも必要となる。

各端末の未送信を自動で取り込む本番の移行手順、運用先での初期投入・切替スイッチ、
Googleドライブの自動控えと旧同期の置換操作は、この検証画面では未接続。
圏外PWA再起動・日本語IME・カーソル維持・一万行の実Outliner描画は実機/製品側の確認を残す。

## 試験の境界

SQLは使い捨てPostgres17のlab_sourceだけに接続して検査する。
ブラウザーは本物のAuthGate・SDK・Outlinerを使うが、AuthとPostgRESTのHTTP境界は試験用の代役。
RPCの中身は同じSQLを実Postgresへ実行する。実際のSupabaseサービスへの疎通・JWT署名検査ではない。
RealtimeはSDKの購読配線の単体試験と、通知をすべて失わせた状態での追いつきを検査する。
本物のSupabase Realtime配信はまだ検証していない。成功範囲はRESULTS.mdに記録する。
