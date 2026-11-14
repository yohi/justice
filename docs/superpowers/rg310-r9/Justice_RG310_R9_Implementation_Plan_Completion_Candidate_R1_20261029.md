# Justice RG-310-A-001 — WT1 Contract B R9
# Conditional Implementation Plan — Documentation Completion Candidate R1

**基準日:** 2026-10-29（JST）  
**状態:** `PLAN_DOCUMENT_CANDIDATE / BLOCKED_FOR_EXECUTION / NOT_OWNER_RATIFIED`  
**Authority:** `DOCUMENT_ONLY / NO_IMPLEMENTATION / NO_TEST / NO_BUILD / NO_RUNTIME / NO_GIT_OR_GITHUB_WRITE / NO_GATE_AUTHORITY`  
**依存設計:** `Justice_RG310_R9_Design_Spec_Completion_Candidate_R1_20261029.md`（未採択）＋R0.8原本（Draft）  

## P-01. Goal, plan hierarchy and evidence boundary

**文書作業のゴール**は、(1) Contract B R9の実装可否・実装順・受入・STOPを、人手と独立レビュアーが判断可能な状態に記述すること、(2)実装可能性未証明の項目を隠さず依存ゲートに置くこと。**今回実装することではない**。

- 既存の親計画は `yohi/justice` `v4` branch の `docs/superpowers/plans/2026-10-09-review-gate-v4-contract-conformance.md`（Git blob `56474cc1441b45e265ed4a31ca5bb93e1e9321d1`）。20 Tasksの計画であり、今回のR9専用計画に置き換えない。
- 親設計は `docs/superpowers/specs/2026-10-09-review-gate-v4-contract-conformance-design.md`（Git blob `482bd8fc6c344aa5f462be3cd77677dff838f584`）。こちらも今回変更しない。
- R9元のR0.8§13は84定義のitemized migration matrixを含むが、実行可能なOwner承認済み実装計画ではない。したがって本書を**新規R9専用の条件付き計画案**として分離する。
- 設計補遺R1・元R0.8は文書レビュー対象。既存親文書の設計レビュー・実装進捗をR9の承認に読み替えない。

## P-02. Hard Gate and Dependencies

**実装開始のゲートは現在一切満たされていない**。将来検討する順序は以下のとおり（番号は作業提案であり、今回の承認ではない）。

| Gate | 必須証拠・判断 | 現在の状態 |
|---|---|---|
| G-DOC | 設計と計画の整合性・原本同一性・OPEN Findingの明記に対する独立文書レビュー | 本候補は未レビュー |
| G-ARCH | B0+B1下の非循環Root、正規Caller、全入口仲介、Receiver結合、正規PASSを証明した設計採択 | **BLOCKED / NOT_PROVEN** |
| G-OWNER | OD-R9-01..06と3ファイル制約の再検討が必要なら個別Owner Decision | **PENDING** |
| G-SCOPE | 対象ファイル、変更境界、Runner依存、固定API/テストの明示承認 | **NOT_AUTHORIZED** |
| G-EXEC | 実装、テスト、build、runtimeを対象ごとに別途Owner許可 | **NOT_AUTHORIZED** |
| G-ACCEPT | 84基準試験、CT-R9-001..028、CF/EF、CLI/Remote byte identity、TOCTOU、Gate独立判定 | **EXECUTED_PASS=0 / BLOCKED** |

`G-DOC`がPASSでも`G-ARCH/G-EXEC`を自動解除しない。失敗・未確認はfail-closed。

## P-03. Document-only tasks — current authorized scope

| Task | 作業内容 | 今回の成果物 | 状態 |
|---|---|---|---|
| DOC-01 | R0.8/R0.7/Phase A/固定R8証拠と親v4文書の版を整理 | 本計画§P-01、設計案D-01 | **DRAFT_PREPARED** |
| DOC-02 | 31件を独立Finding IDごとに追跡 | Finding Matrix | **DRAFT_PREPARED / OPEN_UNCHANGED** |
| DOC-03 | R0.8の旧断定を訂正し、未証明事項と設計未採択を明示 | 設計補遺案D-02..09 | **DRAFT_PREPARED** |
| DOC-04 | 実装タスク順序・停止条件・受入条件をPlanとして記述 | 本計画§P-04..08 | **DRAFT_PREPARED** |
| DOC-05 | 設計/計画/証拠の文書内部整合を確認し独立レビュー用に梱包 | HandoffとSHA256SUMS | **SELF_CHECK_ONLY / NO_INDEPENDENT_PASS** |

`DRAFT_PREPARED`は文書作業の実施状況であり、設計採択・Finding closureではない。

## P-04. Future implementation work breakdown — all NOT_AUTHORIZED

| ID | 前提Gate | 想定責任（仮） | 予定対象（変更可能範囲の承認は別） | 受入条件 | 現在 |
|---|---|---|---|---|---|
| R9-IMP-01 | G-ARCH/G-OWNER | Security Architect + Owner | 認可RootとCaller契約の版凍結 | B0 genuine E_T / B1 preinit / 正規PASSの非循環証明 | **BLOCKED** |
| R9-IMP-02 | G-SCOPE/G-EXEC | Implementer（別割当） | A: StageEligibility / Session / ownership | 公開発行経路の全てが正規Callerに帰属、独立H_BはH_T侵害不可 | **BLOCKED** |
| R9-IMP-03 | G-SCOPE/G-EXEC | Implementer | M: Lease / Attempt / Publisher/Receiver identity | mixed Session、replay、setReceiver、直接receive/reset/emitの完全仲介 | **BLOCKED** |
| R9-IMP-04 | G-SCOPE/G-EXEC | Implementer | T: 正規Harness経路・必要なAPI互換 | 既存84静的定義への影響を個別追跡、正規PASSが可能 | **BLOCKED** |
| R9-IMP-05 | G-SCOPE/G-EXEC | Implementer | staging/fs/resource cleanup境界 | 不明所有のunlink禁止、quarantine不変、TOCTOU拒否 | **BLOCKED** |
| R9-IMP-06 | G-EXEC | Test Engineer | CF-R9-001..019、EF-R9-020..026、CT-R9-001..028 | 必須ネガティブ反例・失敗時0の意味を区別し、実行証拠を作成 | **BLOCKED** |
| R9-IMP-07 | G-EXEC | Test Engineer | R8 84件基準 + 正規結果整合 | 比較可能な固定基準、退行テスト結果、mock/worker/R8 pairing | **BLOCKED** |
| R9-IMP-08 | G-ACCEPT | Independent Reviewer + Owner | 実行証拠監査・Gate判断 | 受入条件が独立に満たされ、Ownerが個別に採択 | **BLOCKED** |

上表は将来の作業内容の**分類**であり、実装順序・ファイル編集・試験実行を指示する承認ではない。`R9-IMP-01` も新規成立可能性探索を現時点で許可しない。

## P-05. Inter-task dependency constraints

- `IMP-01 → IMP-02/03/04`：Caller Attribution未成立の状態でAPIやLeaseの改造をしない。
- `IMP-02 + IMP-03 → IMP-04`：実装予定の一体セッション契約なしにTの認可経路を確定しない。
- `IMP-02 + IMP-03 + IMP-04 + IMP-05 → IMP-06/07`：事前証明のない試験によってセキュリティ成立を既成事実化しない。
- `IMP-06 + IMP-07 + 独立の同一バイト証拠 → IMP-08`：テスト合格と正式Gate採択は別。
- 仕様上の「一意のStageEligibility」「正規Session」などはR0.8にある**未実装概念**。M:917/M:962はCaller認可点ではない。

## P-06. Acceptance and evidence matrix

| 検証セット | 元仕様の参照 | 必須の将来証拠（現時点はすべて未実行） |
|---|---|---|
| Foundation | R0.8§05 / §08 / §09 | Root/Caller/Session/Lease/Attempt発行・消費・失効の正規/悪意トレース |
| Public surface | A:653–669, A:678–1018, M:52–90, 134–137, 355–357, 684–826, 879–1022 | 全公開経路ごとの副作用前拒絶とResult真正性 |
| Artifact bytes | R0.8§06–07 | FD/パス/内容同一性、stagingとCLI/remote bytes等の証拠 |
| Failure contract | R0.8§10 | `CF-R9-001..019`, `EF-R9-020..026` の各判定と失敗時の観測可能な副作用 |
| Counter evidence | R0.8§11–12 | `CT-R9-001..028`の個別実行証拠と不変前提 |
| Migration | R0.8§13 | 84テスト定義単位の分類・実行対応・既存負荷 |
| Owner and gates | R0.8§14–16 | OD決定記録、STOP個別解除の根拠、独立レビュー、Owner採択 |

`CT-R9 EXECUTED_PASS = 0` のまま維持する。長さ・Digest・EventID等の一致と、認可済みCallerの証明は別の受入軸である。

## P-07. Blockers, Owner Decisions, and Risk Register

**Critical blocker:** B0+B1下の正規Harness Caller Attributionと完全仲介が未証明（31 Finding OPEN）。`R0.8`はDraft、C2/C3/C4とT-root候補は未採択。

**Owner pending:** `OD-R9-01` trustedParentDir、`02` quarantine保持期間、`03`容量上限、`04`削除責任者、`05`アクセス権限、`06`変更境界の運用ポリシー（R0.8§14）。現行変更境界の維持とOD-06の正式値決定は区別。

**V4 dependency:** 親20 Task計画（文書blob固定）にR9の受入証拠を無断反映せず、親Task/Stepの完了を主張しない。R9の完了が親のG1/G2/G3を自動PASSにしない（逆も同じ）。

## P-08. Exit / STOP contract

```text
OWNER_ADVERSARY_BOUNDARY = B0_PLUS_B1 / ACCEPTED
THREE_FILE_CONSTRAINT = MAINTAINED
CONSTRAINT_RELAXATION = NOT_ADOPTED
FEASIBILITY_NOT_ESTABLISHED
R9_IMPLEMENTATION_HOLD = ACTIVE
STOP-01..10 = ACTIVE
OD-R9-01..06 = OWNER_DECISION_PENDING
CT-R9 EXECUTED_PASS = 0
R0.8 = DRAFT
PATH-2 = NOT_ADOPTED
FOUR_FILE_APPROACH = NOT_ADOPTED
R1-REV-001..010 = OPEN
CCOMP-R1-001..011 = OPEN
CA-R1-REV-001..010 = OPEN
IMPLEMENTATION = NOT_AUTHORIZED
TEST_EXECUTION = NOT_AUTHORIZED
BUILD_EXECUTION = NOT_AUTHORIZED
PROJECT_RUNTIME_EXECUTION = NOT_AUTHORIZED
GIT_OR_GITHUB_WRITE = NOT_AUTHORIZED
GATE_CHANGE = NOT_AUTHORIZED
```

この計画は**独立レビューを依頼できる文書候補**。構成案の採択・エンジニアへの着手指示・正式Gate判定ではない。
