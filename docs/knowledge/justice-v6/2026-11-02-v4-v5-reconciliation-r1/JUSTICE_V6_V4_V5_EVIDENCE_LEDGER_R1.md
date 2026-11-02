# D3 — Justice v6 Evidence and Provenance Ledger R1

> **Authority:** `READ_ONLY / DOCUMENT_ONLY / ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`. 2026-11-02 JST。v4 STOP、Gate/HOLD、v6要件・方式選定・実装許可を一切変更しない。資料の歴史的Owner採択と、本R1の未採択分析は別。

## 証拠階層
- `FRESH_FETCH_SHA256_AND_GIT_BLOB_SHA1_RECOMPUTED_MATCH`: 今回取得したUTF-8の実バイトから、SHA-256と`SHA-1("blob <length>\0" + bytes)`を再計算しGitHub返却SHAと一致（v5採択7ファイルのみ）。
- `DIRECT_GITHUB_FILE_FETCH_BLOB_ID_CONFIRMED`: 固定Commitから本文とAPIのBlob SHAを取得した。今次の独立SHA-256再計算を主張しない。
- `GIT_TREE_IDENTITY_ONLY`: 固定CommitのGit Treeに存在・path/size/blobを直接確認、本文全行監査なし。
- `PRIOR_TEST_REPORTED`は原本PRの当時の報告。`REAL_HOST_PASS`ではない。
- Ownerの採択権限と独立レビューの静的判断、元のRuntime実証は種類が異なり上書き不可。

## Fixed Git objects

- v4 implementation fixed HEAD: `e988a34dd112985832ed15744d74f275abf853b0`。v4 SPEC returned blob `4c535b5dc9b171dedabf54299d34ba13eca83896`を確認。
- v4 archive fixed commit `08e9dbe3bee87c1e7f16307f302760f1f7161b19` — repository tree取得、`truncated=false`、R0.1〜R0.4パスを確認。
- v5 fixed commit `abf95e45dc5b90728a29506234902ce585986f9a`、parent `adbb397a6c73da22fafb1a656f16832bf961168d`。11 additions/0 modifications/0 deletions、R0.2採択7+採択証拠4。
- v5の保存BranchはOwner記録で`docs/justice-v5-knowledge-r01-20261101`。履歴上のmasterへの未マージは2026-11-02のIssueコメント時点の確認として扱い、以後のLive branch stateには拡張しない。

## Git Blob / SHA-256 ledger

| Source ID | Fixed path | Commit | Git Blob SHA-1 | SHA-256 | 今回の取得・独立照合 | 採択/留保 |
|---|---|---|---|---|---|---|
| `V4-SPEC` | [SPEC.md](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md) | `e988a34dd112` | `4c535b5dc9b171dedabf54299d34ba13eca83896` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH` | HISTORICAL_SOURCE; Host runtime status not inferred from specification |
| `V4-R01` | [JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md) | `08e9dbe3bee8` | `4456efe172b95eebfde5a86b01c26c8038fc7ccc` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH` | OWNER_BOUNDED_HISTORICAL_KNOWLEDGE_ONLY; Static document/source; not Host proof |
| `V4-R02` | [JUSTICE_V4_R0_2_ISSUE310_CROSSWALK.md](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.2/JUSTICE_V4_R0_2_ISSUE310_CROSSWALK.md) | `08e9dbe3bee8` | `936c60eb0365efd10123eadd243cf558cf952ab4` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH` | OWNER_BOUNDED_HISTORICAL_INPUT; Static document/source; not Host proof |
| `V4-R03` | [JUSTICE_V4_R0_3_SOURCE_INVENTORY.md](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md) | `08e9dbe3bee8` | `e877068f1e1865516474adc356cc3c23fa0b4c05` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH` | OWNER_BOUNDED_HISTORICAL_INPUT; 12 sources only; non-exhaustive, host V2 unproven |
| `V4-R04` | [JUSTICE_V4_R0_4_VISION_VALIDITY_CANDIDATE.md](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.4/JUSTICE_V4_R0_4_VISION_VALIDITY_CANDIDATE.md) | `08e9dbe3bee8` | `d2c6c5123671ba0ea6f7702b9357af99ae22b75e` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH` | OWNER_BOUNDED_HISTORICAL_INPUT; Analyst candidate, not v6 design |
| `V4-R02-J` | [EVIDENCE_INDEX_R0_2.json](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.2/EVIDENCE_INDEX_R0_2.json) | `08e9dbe3bee8` | `c31a7c7ff3a9de24d83f840de53f8b777eff0677` | 未独立計算 | `GIT_TREE_IDENTITY_ONLY` | HISTORICAL_SOURCE; Index file content not independently parsed in this run |
| `V4-R01-J` | [evidence-index.json](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/evidence-index.json) | `08e9dbe3bee8` | `08fc922f476565586d5a7337d4e438d85bfd0466` | 未独立計算 | `GIT_TREE_IDENTITY_ONLY` | HISTORICAL_SOURCE; Static document/source; not Host proof |
| `V5-README` | [README.md](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/README.md) | `abf95e45dc5b` | `abbe586a483ca24073a169eceb25f2c41fd06d25` | `d22c8cafb1ab73c05e0cffd77b8e9df8bbcfdfb6aacb2d2c5a5898b9da48f5e1` | `FRESH_FETCH_SHA256_AND_GIT_BLOB_SHA1_RECOMPUTED_MATCH` | OWNER_ADOPTED_AS_LIMITED_HISTORICAL_KNOWLEDGE; Adopted historical text only, not v6 norm or runtime verification |
| `V5-PURPOSE` | [JUSTICE_V5_PURPOSE_AND_GOALS_R0_2_20261101.md](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_PURPOSE_AND_GOALS_R0_2_20261101.md) | `abf95e45dc5b` | `04505f0796d3e5785d5459831384c9361ae54ffe` | `89f4f7256e201a9e7b3f573489f6173015c34532e2700b6f3c6126e4a809b042` | `FRESH_FETCH_SHA256_AND_GIT_BLOB_SHA1_RECOMPUTED_MATCH` | OWNER_ADOPTED_AS_LIMITED_HISTORICAL_KNOWLEDGE; Adopted historical text only, not v6 norm or runtime verification |
| `V5-CROSSWALK` | [JUSTICE_V5_REQUIREMENT_DESIGN_TASK_CROSSWALK_R0_2_20261101.md](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_REQUIREMENT_DESIGN_TASK_CROSSWALK_R0_2_20261101.md) | `abf95e45dc5b` | `e7a37f80ac54953521a145a30cb32a8674dd15e2` | `9b2dcf57428ccf9a21cd2b32ad2211f66e077ae394e527f226230c88718ea098` | `FRESH_FETCH_SHA256_AND_GIT_BLOB_SHA1_RECOMPUTED_MATCH` | OWNER_ADOPTED_AS_LIMITED_HISTORICAL_KNOWLEDGE; Adopted historical text only, not v6 norm or runtime verification |
| `V5-LEDGER` | [JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md) | `abf95e45dc5b` | `0994aae8a2c3250ef821142b695a9a34f85d184a` | `632016127f685211c2fac8f32b6b11db55c8cb0b6a97aaf51feb67bc6ce8f3a6` | `FRESH_FETCH_SHA256_AND_GIT_BLOB_SHA1_RECOMPUTED_MATCH` | OWNER_ADOPTED_AS_LIMITED_HISTORICAL_KNOWLEDGE; Adopted historical text only, not v6 norm or runtime verification |
| `V5-ARCH` | [JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md) | `abf95e45dc5b` | `834750402710341412131d7ee3131c2d64bc8915` | `337bce2e04771d0355746a1bed5965a427fd3723cdc5243dab3aa0cf09cab53d` | `FRESH_FETCH_SHA256_AND_GIT_BLOB_SHA1_RECOMPUTED_MATCH` | OWNER_ADOPTED_AS_LIMITED_HISTORICAL_KNOWLEDGE; Adopted historical text only, not v6 norm or runtime verification |
| `V5-INDEX` | [evidence-index.json](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/evidence-index.json) | `abf95e45dc5b` | `f1cd023fd0d6f9ffcf8f2dbd37a74bd873d8d4ed` | `9aec13496ee73ae70b624ed05d1277c01ed288ba2d59603bffb5d67eec8224ca` | `FRESH_FETCH_SHA256_AND_GIT_BLOB_SHA1_RECOMPUTED_MATCH` | OWNER_ADOPTED_AS_LIMITED_HISTORICAL_KNOWLEDGE; Adopted historical text only, not v6 norm or runtime verification |
| `V5-SUMS` | [SHA256SUMS](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/SHA256SUMS) | `abf95e45dc5b` | `86b326c8876d700f069e597798d937b5c23279e4` | `de83eff1d49e10e5b8269fcf4cd3e628ac7805bb5dd84c1d425eceb2e6f28de9` | `FRESH_FETCH_SHA256_AND_GIT_BLOB_SHA1_RECOMPUTED_MATCH` | OWNER_ADOPTED_AS_LIMITED_HISTORICAL_KNOWLEDGE; Adopted historical text only, not v6 norm or runtime verification |
| `V5-OWNER` | [JUSTICE_V5_KNOWLEDGE_R0_2_OWNER_LIMITED_ADOPTION_DECISION_20261101.md](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/JUSTICE_V5_KNOWLEDGE_R0_2_OWNER_LIMITED_ADOPTION_DECISION_20261101.md) | `abf95e45dc5b` | `1ab9e81f5142788607385cba5e1f0bc15b788474` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH_BLOB_ID_CONFIRMED` | ARCHIVAL_EVIDENCE_NOT_ADDITIONAL_V6_REQUIREMENTS; Historical R2 and R3 bounded static review; creation-time Owner Decision said Git write pending, later commit verifies archival |
| `V5-R2` | [JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R2_REVIEW_REPORT (1).md](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/INDEPENDENT_REVIEWS/JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R2_REVIEW_REPORT (1).md) | `abf95e45dc5b` | `c95db18caa5fac19290c61f8e3feebcfaa24b001` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH_BLOB_ID_CONFIRMED` | ARCHIVAL_EVIDENCE_NOT_ADDITIONAL_V6_REQUIREMENTS; Historical R2 and R3 bounded static review; creation-time Owner Decision said Git write pending, later commit verifies archival |
| `V5-R3` | [JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R3_REVIEW_REPORT(1).md](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/INDEPENDENT_REVIEWS/JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R3_REVIEW_REPORT(1).md) | `abf95e45dc5b` | `5e4106f6f6299aaa785e68c17008a91549dc6c12` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH_BLOB_ID_CONFIRMED` | ARCHIVAL_EVIDENCE_NOT_ADDITIONAL_V6_REQUIREMENTS; Historical R2 and R3 bounded static review; creation-time Owner Decision said Git write pending, later commit verifies archival |
| `V5-PROVENANCE` | [PROVENANCE.json](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/PROVENANCE.json) | `abf95e45dc5b` | `4654f402a6baf58071e1716186390846de980222` | 未独立計算 | `DIRECT_GITHUB_FILE_FETCH_BLOB_ID_CONFIRMED` | ARCHIVAL_EVIDENCE_NOT_ADDITIONAL_V6_REQUIREMENTS; Historical R2 and R3 bounded static review; creation-time Owner Decision said Git write pending, later commit verifies archival |

## Historical Issues / PRs / approvals

| Source ID | URL | 原主張 | 証拠強度 | Authority/Limit |
|---|---|---|---|---|
| `V4-OWNER-ISSUE` | [原本](https://github.com/yohi/justice/issues/345#issuecomment-6554658221) | Owner bounded adoption, exceptions, unresolved four findings | `DIRECT_GITHUB_ISSUE_COMMENT_READ` | `HUMAN_OWNER_HISTORICAL_ADOPTION` |
| `V5-ARCHIVE-ISSUE` | [原本](https://github.com/yohi/justice/issues/348#issuecomment-6567050806) | Commit/Push verified, 11 Git blobs, R2/R3 snapshots and 7 R0.2 adopted files | `DIRECT_GITHUB_ISSUE_COMMENT_READ` | `ARCHIVAL_RECEIPT` |
| `ISSUE-297` | [原本](https://github.com/yohi/justice/issues/297) | staged Requirements/Design/Plan Review Gate contracts | `DIRECT_GITHUB_ISSUE_BODY_READ` | `HISTORICAL_REQUIREMENT_SOURCE_NOT_V6_ADOPTED` |
| `ISSUE-298` | [原本](https://github.com/yohi/justice/issues/298) | v5 event-sourced Review Gate proposal, separated from Superpowers SDD | `DIRECT_GITHUB_ISSUE_BODY_READ` | `ARCHITECTURE_PROPOSAL` |
| `ISSUE-310` | [原本](https://github.com/yohi/justice/issues/310) | 9 findings and DEP-01 ratified/superseded contract; Gate blocked in historical snapshot | `DIRECT_GITHUB_ISSUE_BODY_READ` | `PARTIAL_HISTORICAL_CONTRACT_RATIFICATION` |
| `PR-295` | [原本](https://github.com/yohi/justice/pull/295) | historical Native Task1 evidence spike; fixed report blob in Owner record | `PR_METADATA_READ_AND_FIXED_R3_REPORT_RECONCILED` | `PRIOR_TEST_REPORTED_ONLY` |
| `PR-341` | [原本](https://github.com/yohi/justice/pull/341) | v4 Review Gate partial wiring merged and 3586 passed/2 expected fail/7 skipped reported | `PR_METADATA_AND_TEST_REPORT_READ` | `PRIOR_TEST_REPORTED_NOT_G3` |
| `PR-343` | [原本](https://github.com/yohi/justice/pull/343) | unmerged documentation on drift, D0, replay, fail-closed handling | `PR_METADATA_READ_V4_R01_AND_R02_REFS` | `UNMERGED_CANDIDATE` |
| `PR-325` | [原本](https://github.com/yohi/justice/pull/325) | R11 static candidate, not runtime proof | `PR_METADATA_READ` | `PROPOSED_BLOCKED` |
| `PR-342` | [原本](https://github.com/yohi/justice/pull/342) | DP-R3.2 documentary readiness and provenance limitation | `PR_METADATA_READ` | `DOCUMENT_ONLY_LIMITED` |
| `PR-344` | [原本](https://github.com/yohi/justice/pull/344) | R9 proposal, 31/31 findings OPEN | `PR_METADATA_READ` | `PROPOSED_BLOCKED` |

## 採択・訂正・保存の時系列
1. v4 R0.1の`OWNER_ADOPTION_NOT_CLAIMED`は作成時スナップショット。2026-11-01のIssue #345 Owner commentは、その後の限定歴史的採択イベント。変更前の原文を上書きしない。
2. v5 R0.2文書の`INDEPENDENT_R2_NOT_RUN`は作成時の状態。後続R2は`CORRECTION_REQUIRED`（R2-F-01 Major・R2-F-02 Minor）。R3はR2の2件に限った訂正について`PASS_WITH_LIMITATIONS`。R2判定は歴史として保存。
3. v5 Owner Decision記録の「GitHub保存未実施」は決裁文書作成時点の記述。2026-11-02の固定CommitとIssue #348保存確認は後続イベントであり、矛盾ではなく時系列差。
4. 最終採択対象はR3 AFTER 7ファイルのみ。Owner Decision、R2/R3報告、PROVENANCEは判断のアーカイブ証拠であり、独立のv6 Requirementsではない。
5. R3独立レビューは元のHandoff ZIP 34件、BEFORE/AFTER限定差分、R0.1 preservation等を検証したと報告。本R1は当該ZIPの原本を別途取得しておらず、そのZIPを再検証したとは主張しない。

## v5 R2-F-01：証拠帰属を混ぜない
- `RG-310-A-001`: Case A `provider_stream_error` の5 post-error observations欠落。**32 canonical contractsの分母外**。`BLOCKED`。
- `RG-310-B-001`: unknown-tool synthetic result、pre-append callback `message.id` / post-append `messageId`双方`null`。32契約の**未証明1件**。`BLOCKED`。
- `RG-310-B-002`: positive token removal未立証（元データにtoken不在・`sanitizationChanged:false`）。`NOT_PROVEN`。
- Case Bは別のsanitizer-failure controlで`PROVEN`。31/32 PROVEN・Task 1 overall BLOCKED。

## 未直接確認の材料（主張の強度を上げない）
- v4独立R1/R2全文および採択候補決裁文書原本は本作業では未同梱・未直接取得。Owner commentで文書名とSHA-256、判定を参照した。
- v4 404 commitsの全個別監査、全source completeness、PR #343未マージ原本ZIP、v5 #295全歴史的probe原本ZIP、DP-R3.2 original upload-pre-bytes、Host telemetryの独立採取は対象外。
- v5採択7ファイルについてSHA256SUMS自身のSHA-256も今次再計算した。manifestの記載対象6/6は一致。manifest自身はmanifest内チェック対象外。
- GitHub実ファイルとOwner決裁、R3報告の参照は整合。ただし v4の別添候補原本、実Host適用、strict JSON Schema互換性は未証明。
