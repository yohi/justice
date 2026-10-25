# Justice RG-310-A-001 — DP-R3.2非ブロッキングErrataと将来条件

**適用先:** 独立レビューPASS済みDP-R3.2原本 ZIP SHA-256 `27169796ffbe0304853f9ba822ebdbd7959be68c37fb2033eff186a7d85a859a`。原本ファイルを変更しない独立の注記である。2026-10-25 JST。

## EDITORIAL-01 — 日本語サマリーの件数誤記

- 参照箇所: `24_JAPANESE_DP_R3_2_LIMITED_CORRECTION_SUMMARY.md` line 9。
- 受領原文の問題: 「外側・申告者由来9、署名対象・証拠元11」だと総数19と不一致。
- **正しい読み替え:** **外側・申告者由来8件、署名対象・証拠元11件、合計19件**。
- 適用: 非規範の説明文のみ。Schemaに対する修正を行わない。独立レビュー判定を変更しない。

## EDITORIAL-02 — Verifier契約の名称継承説明

- 参照箇所: `04B_INDEPENDENT_PROOF_VERIFIER_CANDIDATE_R3_2.md` line 19。
- 問題: 「retains the old field name only in the R3.1 shape」はR3.2にも同じフィールド名が現存する点を曖昧にする。
- **正しい読み替え:** `request_attempt_binding_sha256` はR3.1から継承されたフィールド名をR3.2のsigned subjectにおいても維持し、その意味は選択された`verified_binding_source.canonical_binding_document`のJCS UTF-8バイト列のSHA-256である。
- 適用: 原本を改訂せず、同一仕様の説明を明確化する注記。変更版を作る場合は別revisionで審査が必要。

## FUTURE-PROFILE-01 — 実装時の数値入力の検証留保（本レビューの対象外）

- 参照箇所: `04A_TYPED_ENVELOPE_CANDIDATE_SCHEMA.json` `interface_input.observed_issuer_epoch`, `interface_input.proposed_parent_sequence`, `interface_input.restore_sequence`。
- 現状: `type:string, minLength:1` だが、19件の署名／照合用フィールドと同一の字句制約はschemaに直接書かれていない。
- 将来のVerifier ProfileとP'採択検討時、これらの値を数値として使うなら、外部で認証済みのsource/subjectとの**lossless一致**、正規表記、任意精度比較、raw tokenの不正変換拒否とfail-closedを明文化すること。
- 状態: **DEFERRED / NOT_VERIFIED / NO_EXECUTION_GO**。この注意は文書品質PASSの取消しではなく、将来実装時に別途評価すべき未解決条件。

このErrataは署名済みOwner決裁でも改訂版の独立PASSでもない。DP-R3.2原本のバイト列は不変。
