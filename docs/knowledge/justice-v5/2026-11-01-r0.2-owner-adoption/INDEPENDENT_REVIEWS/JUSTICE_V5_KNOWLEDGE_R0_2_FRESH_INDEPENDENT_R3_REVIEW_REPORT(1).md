# Justice v5 Knowledge R0.2 — Fresh Independent R3 Limited Correction Delta Review

- **レビュー実施日**: 2026-11-01（JST）
- **Repository**: `yohi/justice`
- **Task**: `FRESH_INDEPENDENT_JUSTICE_V5_KNOWLEDGE_R0_2_R2_FINDINGS_LIMITED_DELTA_REVIEW_R3`
- **Authority**: `READ_ONLY / ONE_BOUNDED_FRESH_INDEPENDENT_R3_STATIC_DELTA_REVIEW / ARCHIVE_AND_DOCUMENT_ONLY`
- **Review対象**: R2-F-01（Major）、R2-F-02（Minor）の限定是正のみ

## 1. Overall Outcome

**Verdict: `PASS_WITH_LIMITATIONS`**。新規にHandoff ZIP実バイトを読み出し、作成者自己検証から独立したCRC、SHA-256、Manifest、Git Blob、BEFORE/AFTERの実バイト差分、固定PR #295およびR2の証拠照合を行った。両Findingの文書訂正は独立に支持され、3ファイル境界、必須Invariant、非昇格境界は維持された。R2当時の`CORRECTION_REQUIRED`は歴史的判断として維持する。

本判定は限定文書訂正の静的整合性に関するものであり、Runtime Proof、正式Gate、Owner採択、v6採択を意味しない。

## 2. R3 ZIP Integrity

- **ファイル**: `JUSTICE_V5_KNOWLEDGE_R0_2_R2_FINDINGS_FRESH_INDEPENDENT_R3_HANDOFF.zip`
- **実測サイズ**: **3,378,113 bytes**（指定値と一致）
- **実測SHA-256**: `3c4a3a364507d85196be6ecd54968edd34a5953136d71e59d93440fd1c2c8b12`（指定値と一致）
- **ZIPメンバー**: 34/34、全CRC照合 PASS（`ZipFile.testzip()`は不一致なし）
- **`ARCHIVE_SHA256SUMS`**: 33/33 PASS、重複・欠落・誤ハッシュなし、同ファイル自身を除く全Entryを網羅
- **`MANIFEST.json`**: 32/32 PASS、サイズ・SHA-256を個別再計算、`MANIFEST.json`と`ARCHIVE_SHA256SUMS`を除く全Entryを網羅
- **安全性**: 重複Entry 0、path traversal 0、絶対パス 0、異常なパス正規化 0、symlink 0、暗号化Entry 0
- **分離**: `BEFORE/R0.2/`と`AFTER/R0.2/`はそれぞれ7ファイルを保持し、互いに上書き・交差しない

## 3. Fixed Input / R2 Report / PR #295 Provenance

| 対象 | 独立検証結果 |
|---|---|
| 旧R2 Handoff | 3,255,354 bytes、SHA-256 `3e417ddb7b56c9f6b0941fc975bc18e0411b46d7d0b467debb959149f8e287ff`、CRC PASS（45件） |
| R2原本 | 14,989 bytes、SHA-256 `ee7a6592d04f4cc50f5f7b70ecd9344c445e668b319bcaad39874a56208351d0`、Verdict `CORRECTION_REQUIRED` |
| PR #295固定原本 | Commit `c428041dfb5779b6b6dc8db7bf14928225a00373`、Git Blob `7df0887402d1d4eaf34a09e44213cf75b630b813`に一致 |
| 旧Handoff対応 | BEFORE 7/7、R0.1 7/7、PR #295 1/1が旧R2 ZIP内原本とバイト一致 |
| 固定POST | `adbb397a6c73da22fafb1a656f16832bf961168d`：R0.1 7件の再計算Git Blob SHA-1とGitHub固定Commit側の返却SHAが7/7一致 |
| 固定PRE | `08e9dbe3bee87c1e7f16307f302760f1f7161b19`：Normative Requirements／Design／PlanのGit Blob SHAがそれぞれ`d335c34b747cafd6ac3b2e81d710fdcc61fb777e`／`8e833fb17c1b27470e0a62c2d6a39627fe2d460d`／`e431460453577ae1c7fe6ee36ec5b76319f61582` |

PR #295原本: https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/docs/reports/omo-native-v5.1.17-senpi-2026.10.8-contract-evidence.md

R2原本の証拠帰属（R2-F-01：報告書行114–120、R2-F-02：行122–127）を直接確認。R3レビューではR2のPASSを仮定していない。

## 4. BEFORE / AFTER Byte-Level Delta

`BEFORE`と`AFTER`の全7ファイルについて、差分提供物を信用せず実バイトからSHA-256、Byte equality、Unified Diffを再計算した。

| ファイル | BEFORE bytes | BEFORE SHA-256 | AFTER bytes | AFTER SHA-256 | Byte一致 |
|---|---:|---|---:|---|---|
| `JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md` | 15,710 | `337bce2e04771d0355746a1bed5965a427fd3723cdc5243dab3aa0cf09cab53d` | 15,710 | `337bce2e04771d0355746a1bed5965a427fd3723cdc5243dab3aa0cf09cab53d` | YES |
| `JUSTICE_V5_PURPOSE_AND_GOALS_R0_2_20261101.md` | 7,776 | `89f4f7256e201a9e7b3f573489f6173015c34532e2700b6f3c6126e4a809b042` | 7,776 | `89f4f7256e201a9e7b3f573489f6173015c34532e2700b6f3c6126e4a809b042` | YES |
| `JUSTICE_V5_REQUIREMENT_DESIGN_TASK_CROSSWALK_R0_2_20261101.md` | 36,659 | `9b2dcf57428ccf9a21cd2b32ad2211f66e077ae394e527f226230c88718ea098` | 36,659 | `9b2dcf57428ccf9a21cd2b32ad2211f66e077ae394e527f226230c88718ea098` | YES |
| `JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md` | 15,099 | `119c12d8f3d867632c99063618b9e0308deceeedcd14d6b373d79553e4bf097b` | 17,703 | `632016127f685211c2fac8f32b6b11db55c8cb0b6a97aaf51feb67bc6ce8f3a6` | NO（許可変更） |
| `README.md` | 7,791 | `d22c8cafb1ab73c05e0cffd77b8e9df8bbcfdfb6aacb2d2c5a5898b9da48f5e1` | 7,791 | `d22c8cafb1ab73c05e0cffd77b8e9df8bbcfdfb6aacb2d2c5a5898b9da48f5e1` | YES |
| `SHA256SUMS` | 643 | `8bc996b519f2076b6962a6cc5203372225025b3d1c0d363503c49aa464be136c` | 643 | `de83eff1d49e10e5b8269fcf4cd3e628ac7805bb5dd84c1d425eceb2e6f28de9` | NO（許可変更） |
| `evidence-index.json` | 13,593 | `722846f769516697e282966c774f4d26b3f485fcfd5983a89e770759634d3388` | 13,841 | `9aec13496ee73ae70b624ed05d1277c01ed288ba2d59603bffb5d67eec8224ca` | NO（許可変更） |

変更は`JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md`、`evidence-index.json`、`SHA256SUMS`の**3件のみ**。変更外4件は完全バイト一致。Ledgerの変更箇所は§7.1のR2-F-01／02是正、JSONは既存`JV5-E-013`の`limitation`のみ、SHA256SUMSはLedger／JSONの2ハッシュ行のみ。Handoff同梱差分に依存せず同じ変更範囲を再構成した。

BEFORE/AFTER双方のR0.2 6-entry `SHA256SUMS`照合も各6/6 PASS。

## 5. R2-F-01 Independent Review

**Disposition: `CORRECTED / INDEPENDENTLY_SUPPORTED`。**

固定PR #295 Evidence Report原本の見出し・本文・Finding定義を突き合わせた結果：

| Finding | 固定原本の場所 | 固有問題 | 歴史的状態 | AFTER Ledger §7.1 |
|---|---|---|---|---|
| `RG-310-A-001`（Major） | 行429–483、594–600 | Case A `provider_stream_error`、`cachedActivationReissueRejected`、`preFailureReadResultRejected`、`freshReadReauthorized`、`lateAssistantSanitized`、`lateToolResultSanitized`の5件未観測 | `BLOCKED`、32契約分母外 | 別行として正しく帰属 |
| `RG-310-B-001`（Major） | 行484–528、601–605 | unknown-tool synthetic resultのpre-append callback `message.id`とpost-append `messageId`が両方`null`、厳密結合できない | `BLOCKED`、32契約内未証明1件 | 別行として正しく帰属 |
| `RG-310-B-002`（Minor） | 行496–516、606–610 | sanitizer前tokenなし、`sanitizationChanged: false`、positive removalが観測されていない | `NOT_PROVEN` | 別行として正しく帰属 |

Case BはCase Aと別のpost-capture sanitizer-failure controlであり`PROVEN`のまま。token不在とtokenを実際に除去した証明を同一視せず、synthetic resultの観測だけで厳密messageId結合を成立としない。3分類の相互混同、分母へのCase A加算、Status昇格なし。

最終32契約は31 PROVEN / 1 BLOCKED。Task 1 Overallは`BLOCKED`。Tasks 2–14は`NOT_AUTHORIZED`。

## 6. R2-F-02 Independent Review

**Disposition: `CORRECTED / INDEPENDENTLY_SUPPORTED`。**

PR #295固定原本行384–387に、`29/32`、`30/32`、`31/32`が従前Snapshotとして明記されている。AFTER Ledger §7.1行103–105はRevision表を**major-milestone excerpt（主要節目の抜粋）**と限定し、3つのSnapshotを`HISTORICAL_SNAPSHOT_REPORTED / EXACT_CHRONOLOGY_NOT_ESTABLISHED`と出典付きで補記した。

この記録は中間Snapshotを最終Verdictへ昇格させず、出典のない個別Revision名や詳細な時刻順を創作しない。先行`32/32 PROVEN`は`SUPERSEDED`、**最終有効値は31/32 PROVEN / 1 BLOCKED**、Overall Task 1は`BLOCKED`。

## 7. JSON Claim and Schema Boundary

`BEFORE/R0.2/evidence-index.json`と`AFTER/R0.2/evidence-index.json`をJSONパースし、全プリミティブ・全Array要素・Objectキーを再帰比較した結果、相違は**1フィールドのみ**：

`/r0_2_addendum/new_claim_refs/0/limitation`（Claim ID `JV5-E-013`）。

- 既存Claim ID `JV5-E-013`は不変。Claim、source、URL、Evidence、その他のJSON値、全Objectキー、要素数、型、構造は完全一致。
- 新limitationは`RG-310-A-001` Case Aの5件`BLOCKED`、`RG-310-B-001` unknown-tool exact join `BLOCKED`、`RG-310-B-002` positive removal `NOT_PROVEN`と、3履歴Snapshot・不明時系列を明記。Ledgerと一致。
- 既存top-level `schema_version`およびR0.2 addendumの`schema_version`は不変。今回のJSON Shape Driftは0。
- **Limit**: 提示されていない厳密JSON Schema定義、unknown-key拒否Consumer、後方互換性のRuntime確認は独立証明されていない。R2の当該Limitationを維持。
- 既存Candidate Metadataに`INDEPENDENT_R2_NOT_RUN`等、R2実施前時点の文言が残る。これは既存値から変更されておらず、歴史的候補メタデータであり**本R3のレビュー実施状況として解釈しない**。今回の3ファイル限定是正の外側にある。

## 8. R0.1 Preservation

`SOURCE/R0.1/`全7ファイルを旧R2 ZIP内の`R0.1/`とバイト比較し、SHA-256を再計算した。Git Blob SHA-1も各ファイルの`blob <size>\0<bytes>`から独立生成し、固定POSTのGitHub上のBlob SHAと照合した。

| R0.1 File | SHA-256 | Git Blob SHA-1 |
|---|---|---|
| `JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_1_20261101.md` | `1ac4e6b4a63c306e34f5ad0f4973775be8bc2d2104e56a3178a6629379ec6200` | `6fa75bca70e5a5508f350d6391d836144159b872` |
| `JUSTICE_V5_PURPOSE_AND_GOALS_R0_1_20261101.md` | `ca7ff98d5cac630d25d991b126779168bc9839bbcba416ca0b32cf3f0a884e36` | `c532fa2c6645deb02ebf4a0992a35cc0c824dd17` |
| `JUSTICE_V5_REQUIREMENT_DESIGN_TASK_CROSSWALK_R0_1_20261101.md` | `76b9646ff59c0c0f9022cd61a780e6a370d6415c4381b985622c21c1e362203f` | `e27d696563f765e4329ff14c1ecb43a63529bc22` |
| `JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_1_20261101.md` | `c49670676474a405aba037039c9a45b11f6e75a0782dde996ca6fc79215938d4` | `b2d7302b02f2a8ef52c68a364b885d8fc4fd6d9c` |
| `README.md` | `e7b8a76d43352e6430faefc6b86acaf265e214d021e488c7112cc09c707c9444` | `8cbed297bbe22c562f1e05bace8eaef6ba84a3e1` |
| `SHA256SUMS` | `6c2df95975737c0e273fb4d4b44473b8fa91cd95fb7a70c731d56b1f77e73789` | `b9a314a61dec69cbf0662844363e1aa5dbf95687` |
| `evidence-index.json` | `2563214525c4a88eb60149d32f95e496f6f8d5ed14ce2da937c7fecebd358d42` | `0889dd6c9a2be93a65b9148faefcb641fb1f8877` |

R0.1 checksum manifestは6/6 PASS。R0.1の訂正や差し替えの証拠はなく、Handoff内のR0.1は固定POSTと一致する。

## 9. Mandatory Invariants

| Contract | 独立R3結果 | 基礎 |
|---|---|---|
| Task 1 Final `31/32 PROVEN / 1 BLOCKED` | PRESERVED | PR #295行539–569、Ledger §7.1 |
| Task 1 Overall `BLOCKED` | PRESERVED | PR #295行530–569 |
| Case A `BLOCKED` | PRESERVED | PR #295行429–483 |
| Case B `PROVEN` | PRESERVED | PR #295行338–342、539–569 |
| Tasks 2–14 `NOT_AUTHORIZED` | PRESERVED | PR #295行580–583、Ledger／README |
| Requirements 118 IDs | PRESERVED | 変更なしCrosswalkのRequirements registryで118一意IDを再計数 |
| Design 38 IDs | PRESERVED | 変更なしCrosswalkのDesign registryで32 J5D + 6 INV = 38一意IDを再計数 |
| Tasks 14 | PRESERVED | 変更なしCrosswalkのTask表1–14を再計数 |
| Scenarios 56 | PRESERVED | 変更なしCrosswalkのScenario表1–56を再計数 |
| E2E Closure `NOT_ESTABLISHED` | PRESERVED | 56/56行で`E2E_CLOSURE_NOT_ESTABLISHED`かつ`NOT_VERIFIED` |
| v4限定歴史採択 | PRESERVED | 他の原本／Claimを変更しておらず、追加の採択なし |
| v4未解決Finding | PRESERVED | 未解決Statusの書換えなし |
| v6 Candidate `NOT_ADOPTED` | PRESERVED | 他の原本／Claimを変更しておらず、新規採択なし |
| Option A/B/C `UNSELECTED` | PRESERVED | JSON/文書の既存値を変更していない |
| Gate/HOLD | PRESERVED（文書上） | 本R3はGate操作なし、現在の動的Gate状態は監査対象外 |

以上は**候補の静的差分内での不変性**であり、現在の動的GitHub/Gate状態を刷新して証明するものではない。

## 10. Findings（Severity・Evidence・Required Correction）

| ID | Severity | 今回の証拠と独立Disposition | Required Correction |
|---|---|---|---|
| R2-F-01 | Major | 原本PR #295行429–528、594–610対AFTER Ledger行91–101／JSON JV5-E-013。正確な3帰属を確認：`CORRECTED / SUPPORTED` | **なし（本限定R3範囲）** |
| R2-F-02 | Minor | 原本PR #295行384–387対AFTER Ledger行103–105。中間Snapshot出典と時系列不確定を確認：`CORRECTED / SUPPORTED` | **なし（本限定R3範囲）** |
| 新規の限定訂正Finding | — | **0件** | — |

Findingの消滅は歴史的Runtime Findingの解消を意味しない。`RG-310-A-001`、`RG-310-B-001`、`RG-310-B-002`の未証明状態は引き続き存続する。

## 11. Remaining Limitations

1. PR #295は固定歴史的Evidence Reportであり、R3ではそのRuntime試験、Host Runtime、CI、E2Eの再実行・観測をしていない。
2. PR #342のGit保存ZIPとアップロード**前**のOperator原本とのバイト同一性は証明されない。前回R2の留保を維持。
3. JSON Schemaの厳密適合性、追加属性に対するstrict consumer互換性、後方互換の実行検証は未証明。
4. R0.1独立R1原本全文とR0.2既存Crosswalkの再承認権限は、本限定R3の判定対象外。既存のR2 Limitationを維持。
5. `INDEPENDENT_R2_NOT_RUN`等の旧MetadataはR0.2作成時点の値であり、現在の独立R3 Verdictを表さない。
6. 現在のGitHub Issue/PR/Gateの動的状態、Owner Decision、v6 Requirements、v4未解決Findingの外部変化は検査していない。
7. 構造と固定原本の一致は独立検証したが、将来の設計・製品動作や正式採択の成立は推認しない。

## 12. Final Verdict

**`PASS_WITH_LIMITATIONS`**

評価根拠：固定ZIP完全性34/34、`ARCHIVE_SHA256SUMS`33/33、Manifest32/32、R0.1原本7/7とGitHub固定Blob7/7、前R2 HandoffとR2報告書のハッシュ一致、PR #295固定Blob一致、R0.2変更3件のみ／変更外4件バイト一致、`JV5-E-013`変更1フィールドのみ、R2-F-01／R2-F-02文書是正と不変条件を確認。

権限：このレビューは**R3を実際に独立実施した記録**であり、Handoff作成者自己検証の再掲ではない。R2の歴史的判定`CORRECTION_REQUIRED`を上書きせず、R3限定差分の判断のみPASSする。

## 13. Recommended Next Action

本R3報告書を**Owner採択判断用の証拠**として提示する。Human Ownerが別イベントで限定R0.2文書候補の採択可否を決定するまで、Owner adoption、正式Gate、HOLD、GitHub書込み、設計実装を行わない。採択後の文書保存・記録作業が必要な場合も、対象ファイル・固定HEAD・書込権限を別途明示する。

---

`NO_SOURCE_CHANGE / NO_GITHUB_WRITE / NO_OWNER_ADOPTION / NO_GATE_CHANGE / NO_IMPLEMENTATION / NO_TEST / NO_BUILD / NO_RUNTIME`
