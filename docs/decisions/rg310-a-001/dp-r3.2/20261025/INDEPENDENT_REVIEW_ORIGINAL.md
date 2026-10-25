# Justice RG-310-A-001 — DP-R3.2 新規独立限定静的再レビュー

- 審査日: 2026-10-25 JST
- 権限: `READ_ONLY / STATIC_ONLY / DOCUMENT_QUALITY_ONLY / NO_EXECUTION_GRANT`
- 対象: `Justice_RG310_C1_FULL_DP_R3_2_Limited_Independent_Static_Review_Handoff_20261025(1).zip`
- 総合判定: **`DOCUMENT_READINESS_PASS / LIMITED_STATIC_DOCUMENT_QUALITY_ONLY / NO_EXECUTION_GO`**
- `FND-DPR31-NEW-001`: **YES (document-only)**
- `FND-DPR0-004`: **YES (document-only, R3 A–D + editorial + receipt metadata, subject to unadopted status)**
- 他11項目: **historical YES retained; no regression detected**
- 未解消の軽微な編集事項: 2件（下記）。対象外の契約詳細上の留意事項: 1件。いずれも本限定審査の文書準備判定には非ブロッキング。

## 1. バイト受領・検証

| チェック | 独立計算値・結果 |
|---|---|
| ZIPサイズ | 1,310,442 bytes |
| 外側SHA-256 | `27169796ffbe0304853f9ba822ebdbd7959be68c37fb2033eff186a7d85a859a` |
| 別経路の独立期待ダイジェスト | `EXPECTED_DIGEST_NOT_PROVIDED` |
| ZIP CRC | 47/47 PASS |
| 重複、絶対・遡及・不正パス | なし |
| SHA256SUMS | 45/45一致 |
| MANIFESTの対象・サイズ・SHA-256 | 45/45一致 |
| DP-R3.1原本ZIP | 639,608 bytes、SHA-256 `ffe69da3ad14ca926ad19197a0d3e6368d7a34275a702c142c5c6501c899ef6b`、内側CRC PASS |
| DP-R3.1独立レビュアー原本 | 15,332 bytes、SHA-256 `56313c09ef79fb8ba363b818c30f2005ad0de25b490a1ccfb9ee300be2758d92` |
| R3.1→R3.2改訂ファイル | 内容更新7件、加えてSHA256SUMS/MANIFESTを更新 |
| R3.1→R3.2差分 | `25_R3_1_TO_R3_2_TEXT_DIFF.patch` 65,726 bytes、独立再生成と完全一致 |
| JSON重複キー | 04、04A、15、MANIFESTで検出なし |

ZIP内部のハッシュ整合性は署名、外部原本提供者の真正性、Owner認証、Provider権限、監査ログの正しさを意味しない。

## 2. R3.1原本の判定を継承する範囲

内包 `reference/DP_R3_1_INDEPENDENT_REVIEW_ORIGINAL.md` を全文確認。原本では11件の文書品質YES、`FND-DPR0-004`のPARTIAL、新規 `FND-DPR31-NEW-001` が指摘されていた。既存11 YESは歴史的文書審査判定として扱い、実装済み・承認済み・Gate解除済みには昇格させない。

## 3. 新規精度Findingの独立再審査

`04A_TYPED_ENVELOPE_CANDIDATE_SCHEMA.json` のR3.1およびR3.2 JSON木を再帰的に比較した結果、`type: integer` → `type: string` 変更は**19箇所**。

- 外側クレーム・legacy evidence/receipt: **8箇所**。root `issuer_epoch` / `db_term` / `db_sequence` / `policy_epoch` / `proof_issuer_key_epoch`、`verified_evidence.verifier_key_epoch` / `verified_policy_epoch`、`verification_receipt.verified_issuer_key_epoch`。
- 署名済み `verified_subject` またはそのsource/policy分岐: **11箇所**。`verifier_key_epoch`、`proof_source_key_epoch`、`denial_before_effect_proof.denied_policy_epoch`、`verified_issuer_epoch`、`verified_db_term`、`verified_db_sequence`、`verification_checked_at_epoch`、`verified_binding_source.source_authority_key_epoch`（二分岐）、`verified_policy_binding.verified_provider_policy_epoch`、`verified_policy_binding.internal_policy_epoch`。

19箇所とも文字列型、`pattern: ^(0|[1-9][0-9]*)$`、`minLength: 1`、`maxLength: 128`。現在の04A schema木に残存JSON `type: integer` / `type: number` は**0箇所**。旧型データの暗黙アップキャストは禁止、R3.2の独立Verifier契約 `04B...R3_2.md:47-54` は生バイト確認、重複キー拒否、誤った数値トークンのJCS前拒否、任意精度解析、Source / Subject / Claimの独立認証済み結合を明記する。JSON Schema自身に認証能力や完全な意味検証能力があるとは主張していない。

`"9007199254740992"` および `"9007199254740993"` は両方正しい、相異なる**JSON文字列値**であり、署名subjectを変更すればJCS UTF-8バイトおよび計算されるハッシュも異なる。引用符のない数字JSONトークンはどちらも19対象フィールドでは禁止。`04E` の12紙上反例は全件 `SPEC_ONLY_NOT_EXECUTED / NOT_EXECUTED`。正規表現と意味的拒否規則で負数、`-0`、`+`、先頭ゼロ、指数形式、空白、非ASCII数字、128桁超えの拒否が定義されている。**この性質の実行テストは行っていない**。

`FND-DPR31-NEW-001 = YES`、当該理由での `FND-DPR0-004` PARTIAL は文書上解消。

## 4. 版本・証跡識別・既存契約の非退行

- `04.common_envelope_proposal.protocol_version` と `04A.properties.protocol_version.const` は `CANDIDATE_DP_R3_2`。R2、R3、R3.1の暗黙移行を禁止する。
- Receipt version `RG310-C1-FULL-DP-R3_2-CANONICAL-VERIFICATION-RECEIPT-CANDIDATE-v1`、Subject version `RG310-C1-FULL-DP-R3_2-VERIFIER-SUBJECT-CANDIDATE-v1`。Receiptと署名subjectのcanonicalizationは `RFC8785_JCS_I_JSON_UTF8_WITH_DECIMAL_NS_AND_UNSIGNED_EPOCH_STRINGS_R3_2`。
- 8 interfaceの `result_receipt_schema_ref` は全件 `04A_TYPED_ENVELOPE_CANDIDATE_SCHEMA.json#/$defs/canonical_verification_receipt, verification semantics in 04B_INDEPENDENT_PROOF_VERIFIER_CANDIDATE_R3_2.md` と一致。`04.semantic_verifier_contract_id` も一致。
- `EXTERNAL_FIRST_EFFECT_ATTEMPT` と `NO_EXTERNAL_FIRST_EFFECT_ATTEMPT` の別個のsource-bindingと識別、provider policyとinternal signed policy / typed not-applicableの分岐を維持。no-attemptに架空の `immutable_attempt_id` を作らず、provider DENIEDにはProvider Policyを要求。
- signed receipt ID・algorithm ID・canonicalization profileと外側不信頼metadataの照合、および外部固定（未採択）のプロファイル照合とリプレイ拒否を維持。署名入力の具体的separatorおよび許容署名アルゴリズムは未採択。
- v5署名付きnsの範囲・clock domain・因果時刻の未来意味検証義務も維持。すべて文書設計で実行結果は存在しない。

## 5. その他の非退行・STOP

- E01〜E27、**27/27**未採択。E24に対する承認済みv5の `JUS5-GATE-02/INV-04` mandatory fail-closed floorを維持。固定Git blob（要求 `d335c34b747cafd6ac3b2e81d710fdcc61fb777e`、設計 `64acdf177d2fd207861eb477af7c8a265eed71e8`）をGitHub GET-onlyで読取確認。Task1 release workflow blob `4f984a012f3fa9421a32531a00394f4d654d5284` に公開処理があることも読取確認。現行effective rightsは検証していない。
- 8 interface IDs維持、`is_normative=false` / `frozen=false` / `adopted=false`。
- WP00〜15＋WP06a/bの18件すべて `NOT_AUTHORIZED_NOT_EXECUTED`。
- 34試験設計、34fixtures、34fixture audit rowsは未実行。R3.0オラクル8、R3.1オラクル10、R3.2オラクル12はいずれも紙上のみ。
- P5原本59 ID（22 OPEN findings、37 NOT_EXECUTED counterexamples）が07 traceabilityに59/59保持。P5 register総行数251は59原本に限定されない。
- DS-01..06 / O-01..07の13選択は全件 `NONE`。D0→D13はfuture-onlyの非循環DAGを維持。
- R11 UNAPPROVED、R′/D′/P′ NOT_ADOPTED、Task1 31/32 BLOCKED、H0..H3 NOT_PROVEN、provider first-effect・Host・custody実効権限 NOT_ESTABLISHED、P2..P4 INTERFACE_FREEZE_STOP、Tasks2..14 NOT_AUTHORIZEDを変更しない。

## 6. 軽微な是正推奨と対象外の留意事項

1. **EDITORIAL-01** `24_JAPANESE_DP_R3_2_LIMITED_CORRECTION_SUMMARY.md:9` の「外側・申告者由来9、署名対象・証拠元11」は誤り。実際は**8＋11＝19**（正しく述べる `04B...R3_2.md:49` およびManifestと一致）。影響: 非規範的サマリーの数値誤記。非ブロッキング。
2. **EDITORIAL-02** `04B_INDEPENDENT_PROOF_VERIFIER_CANDIDATE_R3_2.md:19` の「retains the old field name only in the R3.1 shape」は曖昧。R3.2のsubjectにも `request_attempt_binding_sha256` があり、意図する「R3.1由来のフィールド名をR3.2でも継続使用」と明確化するとよい。非ブロッキング。
3. **FUTURE-PROFILE-01 (対象外・継続留意)** `04A` の`interface_input.observed_issuer_epoch`（約526–537行）、`proposed_parent_sequence`（約603–611行）、`restore_sequence`（約768–773行）は`type:string,minLength:1`で、19変更対象とは異なり独立した字句制約はschema内にない。これらを数値として使用する将来実装では、比較前の正規化・型変換に依存せず、独立検証器のsource/subject照合とfail-closedを厳守すること。本限定レビューがこれらの入力に対する十分な完全性保証を与えるものではない。

## 7. 最終判定と権限

**`DOCUMENT_READINESS_PASS / LIMITED_STATIC_DOCUMENT_QUALITY_ONLY`**。本限定審査では19件の精度是正、R3 A–D・receipt等の非退行、11歴史的YESの維持を文書の静的整合性として確認した。軽微な編集修正は推奨するが、同限定の文書品質判定を妨げない。**`NO_EXECUTION_GO`**。

この判定は**署名済みOwner決裁、R′/D′/P′採択、正式Gate、Interface Freeze、作業開始許可、署名検証実装、Source/Provider/Hostの実運用保証、First-Effect Complete Mediation証明、プロダクション公開の承認ではない**。将来の各ステージで別個の審査と人間の明示的承認を要する。
