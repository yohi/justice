# Justice RG-310-A-001 — DP-R3.2 限定是正サマリー（著者案）

**状態:** `AUTHOR_DRAFT_COMPLETE_FOR_REVIEW / INDEPENDENT_REVIEW_REQUIRED / DESIGN_PLAN_ONLY`。DP-R3.1独立審査は `REVISION_REQUIRED / 11 YES / 1 PARTIAL`。このR3.2は独立合格ではありません。

## 新規1件の是正

`FND-DPR31-NEW-001`: 署名対象の鍵epoch、発行元epoch、DB term/sequence、Provider/Internal Policy epochなど、上限のない19個の `integer` フィールドがJCS前の浮動小数点変換で数値の区別を失う設計上の危険に対応しました。

**R3.2案:** 該当する全19フィールド（外側・申告者由来9、署名対象・証拠元11）を `JSON string` に統一し、`0` または `0以外の先頭が0でないASCII10進数` のみ許容。上限128桁で、計算／照合には任意精度整数と正規文字列を使います。署名検証前の桁落ち、勝手な数値変換、R3.1形式の黙示的移行は禁止です。

差異例：`"9007199254740992"` と `"9007199254740993"` は異なる正規文字列で、認証済み証拠の署名対象バイトが区別される必要があります。これらの**引用符なしJSON数字**は対象フィールドでは不正です。紙上反例12件はすべて `NOT_EXECUTED` です。

## 非退行とSTOP

既承認v5の `JUS5-GATE-02/INV-04` のfail-closed acceptanceを維持。R3.1独立審査の11件YESは文書上の歴史的判定のみ。8 interfaces、27効果、16WP＋06a/b、34件試験仕様、22 Finding OPEN、NC37 NOT_EXECUTED、DS/O13項目未選択を維持しています。実効的Provider First-Effect拒否、Host実使用、原子性、Owner署名は今回実証されていません。

対象は**設計と実装計画の文書**の完成度のみ。実装・試験・GitHub変更・権限設定・CI・Host・Owner決裁・正式Gate解除なし。別セッションの新規独立文書再レビューに渡してください。
