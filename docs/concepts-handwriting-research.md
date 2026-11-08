# Conceptsの書き心地とfragmentsへの適用

調査日：2026-11-09。対象端末：Galaxy Z Fold5、ChromeのPWA。公開された公式仕様を調べたもので、実機の遅延測定や非公開エンジンの解析は行っていない。

## 公開仕様から分かったこと

| 要素 | Conceptsの公式仕様 | fragmentsの現状と適用案 |
| --- | --- | --- |
| ペンへの追従 | 対応環境で120Hz描画。Androidには低遅延モードの設定がある | ペンの中間座標を拾い、新しい線分だけ描画済み。次は実機で遅れを測り、ブラウザーが使える入力・描画方式を比較する |
| 線の補正 | Live Smoothing。0%は元の入力、100%は始点と終点を結ぶ直線。一般的な描画では0〜30%という公式案内がある | 現在は補正なし。原座標を保持し、軽い補正を任意に選べる設計が候補。強い補正を標準にすると文字の角や小さな払いを失う可能性がある |
| ペンの表情 | 筆圧・傾き・速度・方位をサポート。ブラシによって反応が異なる | 現在は一定幅と任意の筆圧。筆圧カーブの調整を先に検討し、速度・傾きは使うブラシが分かってから優先度を決める |
| 手とペン | ペンで描画、指で移動／何もしない設定。OS・端末側のパームリジェクションも関わる | 現在はペン専用モード。ペン入力中の複数指・手のひらの扱いを実機検証し、ページのスクロールと描画操作を混ぜない |
| 描画の空間 | ベクターの線、無限キャンバス、パン・ズーム・回転 | 下書きは点列、メモ追加時はPNG。今回の変更は紙を下へ増やす方式。無限キャンバス化は別機能として設計する |

## 解釈と優先順位

「書き心地が良い理由」は上の公開仕様をもとにした推論であり、ユーザーがどのブラシ・補正設定を使っているかで重みが変わる。低遅延モードの存在から、特定のAndroid描画APIや予測アルゴリズムをConceptsが使っていると断定はできない。

1. 今回：下へ広げるつまみを追加し、既存の線を伸ばさず、追加部分も下書き・PNGに残す。
2. 次候補：好みのブラシ設定を確認し、実機で現在のペン追従を比較する。
3. 次候補：弱い補正と筆圧カーブを任意設定として試す。現状の書き心地へ戻せる状態を保つ。
4. その後：ペンと指の操作分離、パン・ズーム。無限キャンバス、傾きブラシ、ストローク編集は別の設計判断。

Androidの公式資料は、低遅延の前面描画と、予測点を一時表示する方式を解説している。ただしネイティブAndroid向けAPIをChrome PWAへそのまま移植はできない。Conceptsと同じ体感を保証せず、PWAで使える範囲を実機測定して判断する。

## 一次資料

- [Concepts 機能一覧](https://concepts.app/en/features)
- [Concepts ブラシとツール](https://concepts.app/en/manual/brushes-and-tools)
- [Concepts 設定・低遅延モード](https://concepts.app/en/manual/settings)
- [Concepts キャンバスとペン設定](https://concepts.app/en/manual/infinite-canvas)
- [Concepts 線の補正について](https://tophatch.helpshift.com/hc/en/3-concepts/faq/96-why-do-my-strokes-straighten-or-vanish-when-i-m-done-drawing-them/)
- [Concepts パームリジェクション](https://tophatch.helpshift.com/hc/en/3-concepts/faq/209-do-you-support-palm-rejection-1674603270/?p=android)
- [Android 高度なスタイラス機能](https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/advanced-stylus-features)
