# D1 — Justice v6 v4 + v5 Knowledge Reconciliation R1

**Task:** `JUSTICE_V6_V4_V5_KNOWLEDGE_RECONCILIATION_R1`  
**JST:** 2026-11-02  
**Repository:** `yohi/justice`  
**Analyst verdict:** `RECONCILIATION_CANDIDATE_READY_WITH_LIMITATIONS`  
**Authority:** `READ_ONLY / ONE_BOUNDED_V4_V5_KNOWLEDGE_RECONCILIATION_R1 / STATIC_SOURCE_AND_DOCUMENT_ONLY / NO_GITHUB_WRITE / NO_RUNTIME / NO_OWNER_ADOPTION`

> **Authority:** `READ_ONLY / DOCUMENT_ONLY / ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`. 2026-11-02 JST。v4 STOP、Gate/HOLD、v6要件・方式選定・実装許可を一切変更しない。資料の歴史的Owner採択と、本R1の未採択分析は別。


## 1. Executive Summary

Justice v6の設計に継承を検討できるのは、**Superpowersの方法論/進行権限を侵食せず、承認済みTask/Artifactの意味とCaller Intentを実行へ伝達し、実ExecutorとReviewの証拠を正しいSemantic Taskに結合し、証拠不足を受理・承認・実装許可に昇格させないこと**である。これは歴史的原則と静的文書に支持される候補であって、v6 MUSTやHost実証ではない。

- **v4の実現範囲:** 固定v4実装にはPlan Parser/Packager/Bridge、Feedback、Compaction、Wisdom、Router、Telemetry等のソースと部分的Review Gate機構が存在。PR #341は3,586 tests passed、2 expected fail、7 skipped等を*報告*。しかしv4 G3 Real Host E2E、V2 Semantic Replay、Approved D0全経路は未成立。[V4-R01](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.1/JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md), [V4-R03](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.3/JUSTICE_V4_R0_3_SOURCE_INVENTORY.md), [PR #341](https://github.com/yohi/justice/pull/341)。
- **v4の限定採択:** 原本定義済み`JV4-K-001`〜`015`と`019`〜`023`のみ歴史的知見としてOwner採択。`016`〜`018`は未定義、`024`〜`026`は追加提案・未採択。`V4-R1-F-04`〜`07`の4件は継続。実装STOP継続。[Issue #345 Owner Decision](https://github.com/yohi/justice/issues/345#issuecomment-6554658221)。
- **v5の狙い:** v4のOmO/Host密結合・二重スケジューラ・Task意味縮退・Executor identity混線・自己申告の受理・stale authorizationを是正するSemantic Control Plane。v5のNative-firstへの文書設計変更は実装実証ではない。[V5-PURPOSE](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_PURPOSE_AND_GOALS_R0_2_20261101.md)。
- **v5の証明済み境界:** 採択R0.2の7ファイルの実バイト・SHA256・Git Blobは今次取得して一致（7/7）。文書内118 Requirements、38 Design IDs、14 Tasks、56 planned scenariosは歴史的仕様記録。Task 1は最終31/32 PROVEN・1 BLOCKED、Case A BLOCKED（分母外）、Case B PROVEN、**Overall BLOCKED**。Tasks 2–14 NOT_AUTHORIZED、56全件E2E Closure NOT_ESTABLISHED。これはHost全般のPASSではない。[V5-CROSSWALK](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_REQUIREMENT_DESIGN_TASK_CROSSWALK_R0_2_20261101.md), [V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md)。
- **継承方式を固定しない:** Event Sourcing、Witness、CAS、native task hooks、OmO category、compaction hook、full orchestrationは「保証したい性質」と分離して再検討する。Option A/B/Cの選択・ランキングなし。

## 2. Authority / Fixed Inputs

| Scope | Fixed reference | 本R1で確認したこと | 不可な昇格 |
|---|---|---|---|
| v4 implementation | `e988a34dd112985832ed15744d74f275abf853b0` | `SPEC.md` fixed blob `4c535b5dc9b171dedabf54299d34ba13eca83896` | 現行G3 PASSと推定しない |
| v4 archive | `08e9dbe3bee87c1e7f16307f302760f1f7161b19` | Git Tree `truncated=false`; R0.1=4 files、R0.2=2、R0.3=1、R0.4=2（計9） | 未定義IDを補完しない |
| v4 Owner | [Issue #345 comment 6554658221](https://github.com/yohi/justice/issues/345#issuecomment-6554658221) | 限定採択、継続Finding、STOP確認 | v6正式承認ではない |
| v5 archive | `abf95e45dc5b90728a29506234902ce585986f9a` | Parent `adbb397a6c73da22fafb1a656f16832bf961168d`、11 new files/0 modifications/deletions | master merge・Runtime PASSではない |
| v5 adopted R0.2 | `docs/knowledge/justice-v5/2026-11-01-r0.2/` | 7/7実取得＋SHA-256及びBlob SHA1独立再計算一致、manifest対象6/6一致 | 正規v6 Requirementsではない |
| v5 Owner/R2/R3 | [V5-OWNER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/JUSTICE_V5_KNOWLEDGE_R0_2_OWNER_LIMITED_ADOPTION_DECISION_20261101.md); [V5-R2](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/INDEPENDENT_REVIEWS/JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R2_REVIEW_REPORT (1).md); [V5-R3](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/INDEPENDENT_REVIEWS/JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R3_REVIEW_REPORT(1).md) | Owner LIMITED歴史採択、R2 Correction Required、R3 Pass With Limitations | レビュー結果の相互上書き禁止 |

**実在確認済みv4 paths:** `2026-11-01-r0.1/`には`JUSTICE_V4_KNOWLEDGE_EVIDENCE_R0_1_20261101.md`、`README.md`、`SHA256SUMS`、`evidence-index.json`。`r0.2`は`JUSTICE_V4_R0_2_ISSUE310_CROSSWALK.md`と`EVIDENCE_INDEX_R0_2.json`、`r0.3`は`JUSTICE_V4_R0_3_SOURCE_INVENTORY.md`、`r0.4`は`JUSTICE_V4_R0_4_VISION_VALIDITY_CANDIDATE.md`と`FRESH_INDEPENDENT_R1_REVIEW_HANDOFF.md`。固定Treeにない番号・名前を創作していない。

**優先する証拠の種類:** (1) 固定Blob/本文の観測、(2) Ownerの採択権限と範囲、(3) 独立レビューの対象と判定、(4) 当時のIssue/PR報告、(5) 今回の推論。それぞれ作用範囲が違い、一方で他方を書き換えない。D3にBlob/shaと読み取り強度を記録。GitHub書込、テスト、ビルド、Host/Runtime、CI/CodeRabbit起動は行っていない。

## 3. v4 Owner-Adopted Historical Knowledge

| Knowledge IDs | 当時の意味（簡約） | 証拠強度と残余 |
|---|---|---|
| `JV4-K-001–003` | Superpowers/Justice/Runtimeの分業、rawBody/Caller、routing ownership | 原則・ソース/旧Host報告、V2 Host fidelity未証明 |
| `JV4-K-004–007` | 正しいExecutorの検証、CLEAR/Ownerの区別、fail-open/fail-closed、Worker自己申告≠証拠 | #287失敗報告、全Host enforcementは未証明 |
| `JV4-K-008–012` | Replayの意味状態、結果→適用因果、D0/D1、Witness/Admission部分実装、テスト証拠の階層 | v4 G3 NOT_CLAIMED、PR #341は報告証拠 |
| `JV4-K-013–015` | Finding追加フィールドの静的リスク、Loop/Pivot責務境界、v5 Native探索は選定根拠ではない | exploit未観測・修正未成立・R1-F-04/05継続 |
| `JV4-K-019–023` | TaskFeedback tool coupling、Router wrapper、advisory/executive、Wisdom/Telemetry未計測、Compaction Host gap | R0.3の12-source bounded inventoryに依拠 |

`JV4-K-016–018`: 原本で定義を確認できず非採択。`JV4-K-024–026`: レビュー起因の新規提案で非採択。**それらの内容を本R1で代入・採択・既存IDとして再利用していない。**

**未解決継続Finding（Owner記録のsource label `R1-F-0*`に`V4-`を付けた文脈表記）:**

- `V4-R1-F-04`: Finding field propagation `STATIC_RISK / NOT_OBSERVED_EXPLOIT / NOT_REMEDIATED`。
- `V4-R1-F-05`: Loop/Pivot vs Superpowers `OWNERSHIP_PROOF_REQUIRED`。
- `V4-R1-F-06`: OpenCode V2 TaskFeedback Parent/Child/ToolCall correlation `HOST_PROOF_NOT_ESTABLISHED`。
- `V4-R1-F-07`: 12-source inventoryは`SOURCE_INVENTORY_BOUNDED`。

Issue #310の9領域は、R0.2台帳上8領域`PARTIAL`、RG310-08は`NORMATIVE_SUPERSEDED; IMPLEMENTATION_PARTIAL`。DEP-01で旧「Plan-only変更ならDesign CLEAR継承」は`SUPERSEDED`、新completed successorのfresh Design re-reviewが`RATIFIED`。これはIssue当時のFormal Gate `BLOCKED`、Implementation `NOT_AUTHORIZED`を消すものではない。[V4-R02](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.2/JUSTICE_V4_R0_2_ISSUE310_CROSSWALK.md)、[Issue #310](https://github.com/yohi/justice/issues/310)。

## 4. v5 Owner-Adopted Historical Knowledge

v5のOwner Decisionは、R3が限定訂正を確認した**R0.2の7ファイルだけ**を`OWNER_ADOPTED_AS_LIMITED_HISTORICAL_KNOWLEDGE`とした。R2-F-01は「Case Aの5未観測」と「32契約内unknown-tool exact join」「positive sanitizer removal」を混ぜた証拠帰属の誤り、R2-F-02は29/32・30/32・31/32等の中間Snapshotを不十分に記述した履歴網羅性の問題である。R3はこの2点の文書訂正を`PASS_WITH_LIMITATIONS`としたが、**Runtime/Hostの新証明はゼロ**。[V5-LEDGER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2/JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md), [V5-R2](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/INDEPENDENT_REVIEWS/JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R2_REVIEW_REPORT (1).md), [V5-R3](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/INDEPENDENT_REVIEWS/JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R3_REVIEW_REPORT(1).md)。

| Dimension | Historical fixed state |
|---|---|
| Normative v5 traceability | 118 Requirements IDs、38 Design IDs、14 implementation Tasks、56 planned scenarios |
| Scenario category (R2確認) | Unit 30 / Integration 15 / E2E 10 / Runtime Spike 1 |
| E2E closure | 56/56 `E2E_CLOSURE_NOT_ESTABLISHED` |
| Task 1 canonical | 31/32 PROVEN、1 BLOCKED |
| Case A / Case B | Case A `BLOCKED`（32分母外）、Case B `PROVEN` |
| Task 1 overall | `BLOCKED` |
| Tasks 2–14 | `NOT_AUTHORIZED` |
| A/B/C & v6 | `UNSELECTED` / `NOT_ADOPTED` |

時間軸: v5 R0.2本文の`INDEPENDENT_R2_NOT_RUN`は執筆当時のメタデータ、次にR2 `CORRECTION_REQUIRED`、続いてR3 `PASS_WITH_LIMITATIONS`、Owner限定採択、2026-11-02 GitHub branch archivalが発生した。Owner Decisionの「Git Write未実施」も作成時点のスナップショット。原本を修正せずイベント列に併記する。[V5-OWNER](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/JUSTICE_V5_KNOWLEDGE_R0_2_OWNER_LIMITED_ADOPTION_DECISION_20261101.md); [Issue #348 receipt](https://github.com/yohi/justice/issues/348#issuecomment-6567050806)。

## 5. Original Vision and Responsibility Ownership

### 5.1 頭脳・神経系・手脚を4軸に分ける

| Actor | Responsibility（候補） | Authority | Observable facts | Assurance obligation |
|---|---|---|---|---|
| Superpowers（頭脳） | SDD方法論、task progression、review/fix/re-review、final reviewの方法論上の流れ | Methodology内の進行判断、ただしOwnerの実装承認を代替しない | plan/task/reviewer instruction | 正しい方法論指示と重複しない起動規則 |
| Justice（神経系） | Artifact/Task semantic bridge、実行相関、証拠・conformance・受理評価、Pre-implementation Gate（候補） | **限定された保証・受理境界のみ**。Host execution/model selectionやHuman採択を奪わない | origin→call→child→result→evidence lineage | 未結合/不明/stale証拠からAcceptanceを出さない |
| Runtime（手脚） | task/subagent execution、model/provider選定、retry/fallback、Host session/lifecycle | 実行環境に許された処理。Owner Gateを越えない | effective executor、call ID、session IDs、provider outcome | 実観測可能なID/終了/エラー/再開証拠 |
| Human Owner | Requirements/Design/Plan採択、実装許可、HOLD/Gate権限の決裁 | 最終承認。レビューPASSだけでは自動移転不可 | signed scoped decision、effective date、artifact binding | 監査可能な承認対象・範囲・失効事由 |

### 5.2 10責務の歴史的所有者とv6検討境界（移管決定ではない）

| Responsibility | v4の状態 / Owner | v5設計上のOwner | Evidence-based problem | v6責務境界候補 | Verification |
|---|---|---|---|---|---|
| Task Scheduling | PlanBridge/SDDへの誘導で介入余地 | Superpowers | v4介入と進行重複 | Justiceは観測に限定する案 | PO-01/09 |
| Dependency Scheduling | `dependency-analyzer`補助 | Superpowers SDD; Justiceはadvisory | 依存推測が権限化し得る | DAG診断のみ候補 | PO-10 |
| Review Worker Dispatch | v4 Gate/controller とmandatory review | Pre-GateはJustice候補、実装Task reviewはSuperpowers | native outer≠inner OmO worker | 相異なる命名・ライフサイクルを要求 | PO-08/32 |
| Fix / Re-review Loop | `loop-handler`とReview Gate再評価 | SDDはSuperpowers、Pre-Gateは別契約 | 二重Loop/再審査 | Gate phaseのみJustice候補 | PO-09/10 |
| Final Review Scheduling | v4 mandatory review/`sp-final-review` | Superpowers | v4のcategory再使用で混同 | Justiceは証拠検証に徹する案 | PO-32 |
| Loop / Pivot Guidance | v4 Hephaestus pivot等 guidance | Superpowers method owner | V4-R1-F-05 OPEN | advisory/executive厳格分離 | PO-10 |
| Retry / Fallback | v4 error classification/補助案 | Runtime/Provider | セッション連鎖/二重実行 | Hostへの委譲・acceptance別制御 | PO-07/30 |
| Model / Provider Selection | v4 OmO routing、caller-owned指定 | Runtime/Provider | OmO固定カテゴリ依存 | Justiceは明示Intentのみ保持 | PO-03/20 |
| Gate Coordination | v4 Review Gate Controller/Witness、部分実装 | JusticeのPre-implementation Gate保証構想 | Review Gate stateとSDD task review混同 | 変更範囲・phase・review identityの保証候補 | PO-08/11/12 |
| Evidence Acceptance | v4 Evidence projection/self-report検証、部分実装 | Justiceのcorrelation/conformance受理構想 | 相関欠落・stale evidence・独立Reviewer差異 | Task結合後のみ受理、Owner承認と独立 | PO-06/15/29 |
| Recovery | v4 V2 event/replay、compaction-protector | Host lifecycle + Justice evidence continuity | Eventからsemantic state復元不可 | 冪等・非昇格・証拠保持 | PO-19/26 |

## 6. v4 → v5 Historical Changes

| Theme | v4の歴史 | v5で是正したかったこと | v5で成立した証拠 | 継続Gap |
|---|---|---|---|---|
| Plan fidelity | `rawBody`、TaskPackagerとOmO wire | complete brief / caller semantics | 規範文書・12 goals | 新Host lossless pathは未実証 |
| Workflow overlap | Loop/Guidance/Reviewer dispatch | SuperpowersへSDD進行を帰属 | 設計文書の所有者境界 | 二重dispatch Host反例未実施 |
| Routing/runtime | v4 OmO category/Hook-first | effective runtimeをHost所有、semantic role別管理 | v5 Native-first文書転換、Task1 spike報告 | 1 canonical BLOCKED + Case A BLOCKED |
| Provenance | v4 Feedback/Controller・Worker self-report | parent/session/toolCall/child/result joinとprotocol affiliation | 部分的試験報告/設計 | exact unknown result ID join・positive removal未証明 |
| Authority | v4 Review Gate D0/Witness/CAS | ApprovedArtifactChain、clause acceptance、stale防止 | 118/38/14/56の静的契約 | Host全経路の強制・E2E closure未成立 |
| Recovery | v4 V2 eventsとSemantic replay欠落 | deterministic recovery・compaction | 検討候補・歴史的ソース | crash/compaction再投影未証明 |

**「v5が実際に解決した」ことの範囲:** v5の設計意図・規範IDs・予定シナリオ・歴史的失敗の所在を*文書として整理し、R2の誤帰属をR3で限定訂正し、Owner採択知見をバイト固定でアーカイブ*した。Runtimeやv4 Host問題の解消はこれからの証明義務。`31/32`を完了判定としない。

## 7. Reconciled Knowledge Register

本R1は`JV6-KR-R1-001`〜`JV6-KR-R1-032`の32件を新設。各行にv4/v5既存ID・証拠・Evidence Strength・Counterevidence・Proof・Authorityを収録。**既存IDを書き換えたり1対1に固定しない。** 完全な台帳は[D2 Knowledge Crosswalk](JUSTICE_V6_V4_V5_KNOWLEDGE_CROSSWALK_R1.md)。

| Candidate class | 典型的主張 | 代表KR |
|---|---|---|
| `CARRY_FORWARD_PRINCIPLE_CANDIDATE` | 非侵襲境界、rawBody、承認/受理分離、evidence fidelity | 001、002、005、006、008、028 |
| `ADAPT_IMPLEMENTATION_CANDIDATE` | runtime route、fail handling、compaction、recovery、review transport | 003、007、019、026、032 |
| `CONFLICT_REQUIRES_DECISION` | SDD/Gate重複、Loop/Pivot、Design inheritance、Runtime内包 | 009、010、025、031 |
| `PROOF_REQUIRED` | Host execution/provenance、Replay、Task1残余、D0、E2E | 004、011、013、015、020–024 |
| `OPTIONAL_VALUE_UNPROVEN` | Wisdom、Telemetry、Adaptive routing | 017、018、030 |
| `DO_NOT_PORT_AS_IS_CANDIDATE` | CAS/Event Storeの無条件移植、Router wrapperのRuntime扱い | 012、016 |

分類は今回の`ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`。とくに`CARRY_FORWARD`から正式v6 MUSTを発行しない。`INSUFFICIENT_EVIDENCE`は原本欠落を記す際にも使用し、欠落を安全PASS扱いしない。

## 8. Conflicts and Unresolved Findings

1. **v4 DEP-01 vs v5 #298:** v4の新completed successorはPlan-only変更でもfresh Design Gate（ratified）。#298にはprotocol-sensitive inheritanceという別世代の候補がある。後者をv4歴史上の仕様に遡及適用しない。検討するならv6で個別Owner採択が必要。
2. **Review Gate control plane vs SDD:** [Issue #297](https://github.com/yohi/justice/issues/297)は段階的Pre-implementation審査、[#298](https://github.com/yohi/justice/issues/298)はevent-sourced方式候補、[#310](https://github.com/yohi/justice/issues/310)は実装GapとDEP-01履歴。R11はstatic candidate、DP-R3.2はdocument readiness、R9は31/31 OPENのconditional candidate。いずれも自動的にGate CLEARではない。実装中のSuperpowers Task Review Loopと混同しない。
3. **v4 Semantic Replay:** event tip/state identifiersのみの復元で`RemediationRound[]`、`FindingState`、candidate/result application等が失われる。v4 G3は未成立。
4. **v4 Findings:** `V4-R1-F-04/05/06/07`を継続（§3）。Issue #310の全9領域を一括RESOLVEDとしない。
5. **v5 Task 1:** 三つの独立項目を分離: Case A post-error 5観測 `BLOCKED`（分母外）; unknown-tool exact message ID join `BLOCKED`（分母内1/32）; positive removal `NOT_PROVEN`。Case B `PROVEN`は別制御。[V5-R3](https://github.com/yohi/justice/blob/abf95e45dc5b90728a29506234902ce585986f9a/docs/knowledge/justice-v5/2026-11-01-r0.2-owner-adoption/INDEPENDENT_REVIEWS/JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R3_REVIEW_REPORT(1).md)。
6. **証拠・権限の型混同:** code present、CI pass、Worker done、evidence saved、evidence joined、finding resolved、Gate CLEAR、Owner approved、implementation authorizedは9種類の異なる主張。後段へ進むには対応する独立したbindingと権限が必要。

## 9. Evidence Strength and Proof Obligations

### 9.1 Evidenceの段階（非自動昇格）

| Claim | 最低限必要な証拠 | それだけでは満たさないもの |
|---|---|---|
| Executed | Host/Task event and effective executor | Worker成功、Gate CLEAR |
| Worker-reported success | output/source report and signed/credible provenance | 実Host正規Taskでの完了 |
| Test passed | exact test, environment, revision, skipped cases | Host E2E/全要件受理 |
| Evidence persisted | immutable verifiable record, digest | 正しいsemantic taskとの結合 |
| Evidence correlated | Parent/ToolCall/Child/Task/Reviewer exact join | Finding closureの妥当性 |
| Finding resolved | criteria、revalidation、stale/contradiction処理 | Gate CLEAR |
| Gate CLEAR | exact phase、artifact digest、scope、protocol、relevant authority | Human Approval |
| Owner adoption | explicit scoped Human event, effective date | Implementation許可（明示しない限り） |
| Implementation authorized | separately scoped permit after prerequisite checks | 追加未承認操作の自由な実施 |

### 9.2 Semantic Fidelity: Host固有APIより優先して検討する意味上の契約

| Semantic field | 想定する不変の意味 | negative test |
|---|---|---|
| Requirements→Design→Plan | approved chain / revision / digest / authorization | D0→D1 drift・stale protocol |
| Exact Task Body / `rawBody` | original task textの不正な縮退禁止 | checkbox-onlyに変更 |
| Caller Intent | 明示subagent・roleを勝手に推測変更しない | caller route silently overwritten |
| Semantic Role | 目的上のreview/implementation等の分類 | `sp-final-review` categoryとGate controller混線 |
| Runtime Category / Subagent | effective Host executorをsemanticから区別 | 実際にnative wrapperだけ起動 |
| Parent Session | delegation origin | detached orphan child |
| Tool Call Identity | exact initiating invocation | unrelated `messageId`をjoin |
| Child Session / Runtime Task | observed host-created identity | semantic IDとhost IDの型混在 |
| Reviewer Identity | exact designated reviewer and scope | forged marker／different reviewer |
| Completion Evidence | terminal result + authenticated provenance + accepted clause | self-report-only / delayed stale output |

### 9.3 状態変化・復旧の操作別保証

- **Ordinary nonprotected execution:** 一時I/O障害で関係ない仕事全体を不必要に停止させない余地。ただし不確実性を明示し、semantic payloadを危険な変換で流用しない。
- **Protected review/approval/implementation:** 証拠不明、scope/digest stale、Host authority欠落時はfail closed。操作種別の例外を後続Designで定義。
- **Approval invalidation:** Requirements/Design/Plan/protocolが変更されたとき、変更種類に応じた再レビューとOwner approval再確認。旧承認の黙示継承禁止。
- **Provider stream error:** 処理中止・late assistant/toolを隔離・cached capability再使用拒否・fresh approvalの監査。Case A未証明を維持。
- **Compaction/session restart:** exact semantic identityと有効認可範囲を保持するか、未知としてBLOCK。無制限の再注入や記憶からの権限復元は不可。
- **Crash recovery/replay:** durable operation-intent、outcome、semantic state、external side effectの冪等性を区別。Event存在のみでReplay成功にしない。

詳しい32件の検証課題と12反例は[D4](JUSTICE_V6_OPEN_QUESTIONS_AND_PROOF_OBLIGATIONS_R1.md)。

### 9.4 Optional Complexity：保証と実装方式を区別する候補

| Function | 安全上の必要な保証・目的 | その機能自体の状態 | 値・危険・費用の必要証拠 |
|---|---|---|---|
| Wisdom | 承認範囲を超える記憶汚染や秘密漏えいを防ぐ | `OPTIONAL_VALUE_UNPROVEN` | 実測品質差分、local/globalスコープ、保持期間、secret反例 (PO-17) |
| Telemetry | 観測・証拠の必要最小限の保持と監査 | `OPTIONAL_VALUE_UNPROVEN` | 診断有用性、遅延、保存コスト、機微情報 (PO-18) |
| TaskFeedback | 完了証拠の正しい親Taskへの紐付けは重要。ただし独立Feedback Hookは一方式 | `ADAPT_IMPLEMENTATION_CANDIDATE` | V2 event bindingと欠落時の閉鎖性 (PO-15) |
| Loop / Pivot Suggestion | 非収束の可観測性と安全な助言は有益候補。起動権限は別 | `CONFLICT_REQUIRES_DECISION` | Superpowersによる進行と二重指示しない反例 (PO-10) |
| Adaptive Routing | explicit caller intentの保護。自動最適化は必須と未証明 | `OPTIONAL_VALUE_UNPROVEN` | 手動・Host routing対照の品質と費用 (PO-30) |
| Model Fallback | 受理・権限がfallbackで変化しない保証 | `OPTIONAL_VALUE_UNPROVEN` | Host既存fallbackと二重化、正確な実Executor観測 (PO-30) |
| Automatic Retry | 冪等・反復予算・承認の非昇格 | `OPTIONAL_VALUE_UNPROVEN` | double dispatch、provider error、無限loop反例 (PO-07/30) |
| Full Event-Sourced Review Orchestration | authoritative semantic stateの復元、因果追跡、再入可能性は必要候補 | `DO_NOT_PORT_AS_IS_CANDIDATE` | 軽量journal/state machine/Host機構との同等安全保証 (PO-11/12/26) |

`OPTIONAL_VALUE_UNPROVEN`は無条件削除という結論ではない。機能の無効化・Host委譲・既存実装移植を、同じ受理/安全Invariantとコストの条件で比較する。

## 10. Runtime Options A/B/C — UNSELECTED Comparison

| Criteria | A: OpenCode V2 Native | B: OmO on OpenCode V2 | C: Justice owns OmO-like runtime |
|---|---|---|---|
| v4/v5知見との関係 | v4 Hook密結合を縮小、v5 Native Task1の欠落へ直面 | v4 OmO前提を再利用しつつv5の責務分離に合わせる | v4 AgentRouterはengineではなく、v5非侵襲方針との緊張 |
| 必須Host能力 | native subtask, semantic brief, parent/call/child/result, effective model, recovery | 上記+OmO task wrapper/translation/authenticated cross-layer join | 独自dispatch・agent lifecycle・provider abstraction・recovery・security controls |
| Proven / Reported / Unproven | 文書上のAPI設計・PR #295試験報告のみ。一部31/32 reported。Case A BLOCKED、Host generality unproven | OmO経路の歴史的報告はあるが、V2上の同じ能力は未証明 | 独自runtimeの存在/品質は未証明。v4 AgentRouter wrapperで代替証明不可 |
| 責務重複 | Host native schedulingとJustice dispatchに注意 | Superpowers/OmO/Justiceで多重オーケストレーションリスク | 最大範囲の責務境界衝突候補。定量比較前に優劣不明 |
| Evidence取得 | Native event/Tool-callの原本確認が条件 | OmO task + V2 native 両層のcorrelation | Justiceは証拠生成側にもなり独立性が課題 |
| 複雑性 | Thin adapterの可能性、Host API制約 | 統合・変換・version driftの維持 | 実行/運用/安全/Provider対応の新規負担 |
| Security / Resume | capability binding, late output, crash/restartを要証明 | cross-layer capability/credential trust、二重retryを要証明 | sandbox/credential isolation、lease、idempotencyを自前設計する負担 |
| 反例検証 | native controllerだけ成功・実workerなし | wrapperは成功だがinner OmO task不明 | local stateで成功扱い、Host側cancelを見逃す |

**共通停止条件:** exact task identity、caller intent、Host-correlated evidence、review/Owner authority、stale invalidation、provider error、replay、double-dispatchの反例を同じ基準で検証するまでOption選定不可。点数・ランキング・推奨Optionは付けない。

## 11. v6 Requirement Candidate Inputs (NOT ADOPTED)

以下は保証したい性質の**問い**であり、正式MUSTでない。実装方式は後続Designで独立比較する。

| Candidate question | Source KR | Proof | Boundary |
|---|---|---|---|
| v6はどの操作でrawBody/caller semanticsの完全性を保証する必要があるか | 002, 003 | PO-02/03 | Runtime固有wire未決 |
| 誰がSDDの単独スケジューラでありJusticeがどこまで観測するか | 001, 008–010, 032 | PO-01/08/09 | pre-Gateと実装中を別扱い |
| Semantic IDとRuntime IDの結合をどの証拠で認証するか | 004, 015, 022 | PO-04/15/22 | `messageId=null`未証明 |
| Artifact/Owner/approvalの失効・再レビュー境界は何か | 005, 013, 025, 029 | PO-05/13/25/29 | v4 DEP-01を無断更新しない |
| Event Storeに依存せずRecoveryの意味状態を定義できるか | 011, 012, 026 | PO-11/12/26 | replay未証明 |
| Case Aと正のsanitization証明をどのHostで実施するか | 021, 023 | PO-21/23 | Case Bを代理にしない |
| optional機能の価値をどの対照で測るか | 017, 018, 030 | PO-17/18/30 | 未測定で必須/不要を決めない |

## 12. Limitations and Recommended Next Review

**今次実施できたもの:** 固定Git Treeで全対象パス・Blob Identity確認、v4 SPEC/主要文書・v5採択原本/Owner/R2/R3取得、v5採択7ファイルについて独立SHA-256/Git blob SHA-1照合、Issues #297/#298/#310、PR #295/#341/#343/#325/#342/#344の歴史的内容READ_ONLY確認。D2全32件とD4全12反例の証拠照合候補を作成。

**未実施:** v4独立R1/R2原本の今回の独立バイト検証、全404 commits/source exhaustive audit、historical binary handoff ZIP再検査、v4 source 12モジュール全行を再監査、Host機能・テスト・ビルド/CI、v5 Normative 118/38本文の今次独立再カウント、過去PR #295生ログの今次独立実験再現、v6 requirements採択。これらの代わりに以前のレビュー記録を`PRIOR_REVIEW_REPORTED`として扱う。

**Review提出判定:** `RECONCILIATION_CANDIDATE_READY_WITH_LIMITATIONS`。主要な採択範囲・未証明・反例・責務衝突・v5固定7バイト証明が揃ったが、上記未取得/未再監査範囲をD3/D5で明記。独立レビューが本R1の採択やGate PASSを意味することはない。

次の別セッション独立ReviewerにはD5 HandoffとD1〜D4/D6、固定Git参照・出典リンクを渡す。ReviewerのCorrectionが必要なら別R2を作り、R1原本は残す。Human Ownerの知見採択とGitHub保存は別個に承認を得る。

`DOCUMENT_ONLY / ANALYST_CANDIDATE / INDEPENDENT_REVIEW_NOT_RUN / NO_V6_REQUIREMENTS_ADOPTION / NO_RUNTIME_SELECTION / NO_GATE_CHANGE / NO_IMPLEMENTATION_AUTHORIZATION`
