# Justice v4 — Knowledge & Evidence Reconciliation R0.1

**Status:** `DOCUMENT_ONLY / ANALYST_DRAFT / OWNER_ADOPTION_NOT_CLAIMED / NO_EXECUTION_AUTHORITY`

**基準日:** 2026-11-01 JST  
**Repository:** [`yohi/justice`](https://github.com/yohi/justice)  
**固定v4 HEAD:** `e988a34dd112985832ed15744d74f275abf853b0`  
**対象:** v4の開発停止に伴い、v4の設計思想・実装成果・失敗事例・未マージ差分を証跡に紐付けて評価し、v6再定義の入力とする。

## 0. Authority / Boundaries

- Human Ownerの今回の方向: **v4の開発は現時点で停止**。v4が目指した方向性は否定せず、知見の更新と妥当性の整理を進める。
- 本文は **記録・評価の初版** であり、v6要件、設計、実装計画の正式採択でも、v4への修正指示でもない。
- 今回の調査はGitHubの読み取りと静的確認のみ。テスト、ビルド、Host E2E、GitHub書込、CI起動、CodeRabbit起動は実施していない。
- GitHub上の文書／PRは現状のまま保持。ローカル未Pushコミット、未コミット変更、全404コミットの個別精査は未確認。
- 証跡の **ソース実バイトを同梱した完全アーカイブではない**。Commit/Blob SHA・URL・調査結果を固定した *証跡参照台帳* である。

## 1. 固定した比較結果

| 対象 | Git比較・現状 | 評価 |
|---|---|---|
| [`v4.3.1...v4`](https://github.com/yohi/justice/compare/v4.3.1...e988a34dd112985832ed15744d74f275abf853b0) | Ahead 404 / Behind 0、差分195ファイル | v4.3.1のみをv6の根拠としない |
| `feature/v4-review-gate-incremental-20261030` | `v4`と同一：Ahead 0 / Behind 0 | 名前から未実装差分を推測しない |
| [`PR #343`](https://github.com/yohi/justice/pull/343) | Open、`v4`からAhead 3、Behind 0、文書1ファイル | 設計候補・静的Findingを収集。実装完了ではない |
| [`fix/review-findings-hardening`](https://github.com/yohi/justice/commit/bbf58cf98b0b26c0c0a7ae460ceb88afb11156cd) | Diverged、Ahead 1 / Behind 569、現行v4と異なる歴史 | 変更案と失敗知見を抽出。無条件にCherry-pickしない |
| [`PR #341`](https://github.com/yohi/justice/pull/341) | v4へマージ済み | 実装・テスト報告は存在、G3等の完全証明ではない |
| [`PR #295`](https://github.com/yohi/justice/pull/295) | Draft / Open | Native探索はv6実行基盤の採択を意味しない |

## 2. Evidence strength / 主張レベル

| レベル | 定義 | 禁止する読み替え |
|---|---|---|
| `CODE_OBSERVED` | 固定コミットの実ソース／差分を照合 | 実ホスト動作をPROVENとする |
| `TEST_REPORTED` | PRや監査文書にテスト記録がある | 独立実行済み、または全受入条件PASSとする |
| `STATIC_GAP_IDENTIFIED` | 型・契約・差分から不整合を特定 | 対応設計の実現可能性が証明済みとする |
| `DESIGN_CANDIDATE` | 未マージ文書／未承認の設計案 | 現行仕様・Ownerの正式採択とする |
| `NOT_ESTABLISHED` | 証拠がなく、肯定も否定もできない | 便宜的な空値・推測で条件を充足する |

各Knowledge-IDは**主張／根拠／反証・留保／v6影響／レビュー質問**を1組とする。評価は今回の分析者見解であり、Ownerの採否とは別。

## 3. Knowledge Register

### JV4-K-001 — 「頭脳・神経・手脚」の責務分離

- **主張:** Superpowersは開発方法論を所有し、Justiceは文脈・意味の橋渡しと受理証拠を扱い、実行基盤の主導権を奪わない。
- **根拠:** [`SPEC.md` §§1–2,4.1d/e](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)、[PR #277](https://github.com/yohi/justice/pull/277)。
- **評価:** `PRINCIPLE_SUPPORTED`。v4の原則としては明確だが、全コード経路で一切の重複がないという証明ではない。
- **v6候補:** 原則を維持。接続先がOmOであることだけを抽象化して再評価。
- **レビュー質問:** JusticeがSDDのタスク進行・モデル選択・実行スケジュールを重複所有していないか。

### JV4-K-002 — Plan原文・明示委譲意図の忠実性

- **主張:** 元タスク本文`rawBody`、caller指定、文脈、継続identityを勝手に縮退・再構成しない。
- **根拠:** [v4仕様 §4.1d](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md)、[10/9実装監査](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/docs/reports/2026-10-09-documentation-contract-audit.md)。
- **評価:** `IMPLEMENTATION_AND_TEST_REPORTED_WITH_LIMITS`。関連ソース/テスト経路の報告があるが、OpenCode V2のHostで未検証。
- **v6候補:** 不変条件を継承、wire形式は採択Hostで再定義。
- **レビュー質問:** Parent→Justice→Childの経路で原文・明示指定・identityが保持されるか。

### JV4-K-003 — Routing ownership と実行系のSingle Source of Truth

- **主張:** Caller-owned named subagentとJustice-managed semantic routeを分離し、model/provider/fallbackは実行基盤側へ委ねる。
- **根拠:** [PR #277](https://github.com/yohi/justice/pull/277)、[PR #335](https://github.com/yohi/justice/pull/335)、v4仕様 §3.2。
- **評価:** `CONDITIONAL_CARRY_FORWARD`。OmOカテゴリとOpenCode V1 `general`例外は実行基盤固有。
- **v6候補:** ルーティングの**所有権原則**のみ継承、固定カテゴリの機械的移植はしない。
- **レビュー質問:** 明示caller指定がJusticeの推測によって上書きされないか。

### JV4-K-004 — 正しいExecutor選択はモデルの推測に任せられない

- **主張:** Skill起動、ネイティブSubtask、OmO plugin `task`、実Review Workerは同じ契約ではない。
- **根拠:** [PR #287](https://github.com/yohi/justice/pull/287)の実ホスト失敗報告と専用Controller案。
- **評価:** `REAL_HOST_FAILURE_REPORTED`。失敗の記録は重要だが、今回独立に再現していない。
- **v6候補:** Subagent APIの存在だけで満足せず、実行されたTool・Call ID・Parent/Child・Review IDを実証する。
- **レビュー質問:** 実際に選ばれたExecutorと証拠を誰が認証できるか。

### JV4-K-005 — CLEAR / Human Approval / Implementation Authorizationの分離

- **主張:** レビューがCLEARでも、Human承認やImplementation実行権限を獲得したことにならない。
- **根拠:** v4仕様 §4.1c/e、[Issue #310](https://github.com/yohi/justice/issues/310)。
- **評価:** `PRINCIPLE_SUPPORTED`、Production全経路のEnforcementは別途証拠を要する。
- **v6候補:** 独立した受理境界として維持。
- **レビュー質問:** 文書レビュー、Gate CLEAR、Owner採択、書き込み許可を混同していないか。

### JV4-K-006 — Fail-open execution / Fail-closed acceptanceの境界

- **主張:** 通常I/O障害は無関係な開発フロー全体を阻害しない。ただし不明な証拠は受理せず、保護されたReview Gateでは適切に実行拒否する。
- **根拠:** v4仕様 §1.2、および[PR #343](https://github.com/yohi/justice/pull/343) `NEG-V4-20261027-001`。
- **評価:** `BOUNDARY_REQUIRES_REDEFINITION`。Recognized Commandの初期化失敗時にexpanded partsが残る問題が示される。
- **v6候補:** 失敗種類／対象操作ごとの明確な境界として再定義。
- **レビュー質問:** 利便性のためのfail-openが承認・実行バイパスにならないか。

### JV4-K-007 — Self-reportとEvidence-based Acceptanceの分離

- **主張:** Workerの「完了した」という出力だけでProgressやReview acceptanceを確定しない。
- **根拠:** [10/9実装監査](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/docs/reports/2026-10-09-documentation-contract-audit.md)、v4仕様 §4.1e。
- **評価:** `IMPLEMENTATION_AND_TEST_REPORTED_WITH_LIMITS`。証拠の収集・結果投影は実装されているが全Host経路の完全性は未証明。
- **v6候補:** 強く継承。Observed executionとaccepted evidenceを分離する。
- **レビュー質問:** 誰が何をいつ実行したか、再起動後も厳密に結合できるか。

### JV4-K-008 — Event Store保存とSemantic Replayは異なる

- **主張:** V2のverified tipにある集約ラウンド数などだけでは、既存Core Plannerが必要とする`RemediationRound[]`、`FindingState`、review candidateの完全状態を復元できない。
- **根拠:** [PR #343のR2追加 §RG-343-R1-001](https://github.com/yohi/justice/blob/8203d5b77c8f3226acbb52a6f2eeb08b1a8a4335/docs/superpowers/plans/2026-10-27-justice-v4-review-gate-drift-remediation.md)。
- **評価:** `STATIC_GAP_IDENTIFIED / DESIGN_REVIEW_REQUIRED`。空MapやダミーRoundで埋める案は採用できない。
- **v6候補:** Native Core projectionか非損失な変換契約の**証明義務**を定義する。v4の代替実装は未採択。
- **レビュー質問:** verified durable eventだけで全authoritative stateを再投影できるか。

### JV4-K-009 — RESULT_COMMITTED / OUTCOME_APPLIEDの意味的不足

- **主張:** `resultEventId`と`outcomeAppliedEventId`が存在しても、その指す意味的Finding/State遷移の永続型が証明されなければ再生できない。
- **根拠:** [PR #343 R2 §RG-343-R1-002](https://github.com/yohi/justice/blob/8203d5b77c8f3226acbb52a6f2eeb08b1a8a4335/docs/superpowers/plans/2026-10-27-justice-v4-review-gate-drift-remediation.md)。
- **評価:** `STATIC_GAP_IDENTIFIED / NOT_ESTABLISHED`。その是正方式の正しさは未決。
- **v6候補:** Result→Core Decision→Applied Transitionの厳密な因果鎖と再実行不変性を検証。
- **レビュー質問:** Private raw responseが破棄されても同じSemantic Stateへ復元できるか。

### JV4-K-010 — Approved D0 と Dirty/Staged D1の分離

- **主張:** Plan reviewerは承認済みimmutable D0を参照すべきで、現在のdirty/staged D1は診断データに留める。
- **根拠:** [PR #341](https://github.com/yohi/justice/pull/341)、[PR #343 §R1-003](https://github.com/yohi/justice/blob/8203d5b77c8f3226acbb52a6f2eeb08b1a8a4335/docs/superpowers/plans/2026-10-27-justice-v4-review-gate-drift-remediation.md)。
- **評価:** `DESIGN_SUPPORTED / HOST_NOT_PROVEN`。Read/Search/Show/Attachmentsなどの全経路適用は未証明。
- **v6候補:** 根本要件を継承し、ホストのArtifact Authority機構に合わせる。
- **レビュー質問:** 所属Operationが変わった後も古いcached bindingで読めてしまわないか。

### JV4-K-011 — Protected Witness / Admissionは一部実装、全面成立は別

- **主張:** v4ではGenesis、Witness CAS、Admitted operation等の機構と関連テストが進められた。
- **根拠:** [PR #341](https://github.com/yohi/justice/pull/341)、[v4 Evidence Checklist](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/docs/review-gate-v4-evidence-checklist.md)。
- **評価:** `IMPLEMENTED_PARTIAL / FULL_HOST_EVIDENCE_NOT_CLAIMED`。#341の3,586 passed/2 expected fail/7 skippedはPR報告でありG1/G2/G3承認ではない。
- **v6候補:** 安全要求は維持。Witness方式そのものの継承可否は責務・実行基盤に照らして判断。
- **レビュー質問:** 同じ保証をもっと軽量なHost契約で得られるか。

### JV4-K-012 — Mock/Integration/Real Hostは別の証拠強度

- **主張:** テスト成功と実ホスト受入を同一視してはならず、skipはPASSではない。
- **根拠:** [v4 Evidence Checklist](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/docs/review-gate-v4-evidence-checklist.md) のTask 18–20・G3=`NOT CLAIMED`、[PR #338](https://github.com/yohi/justice/pull/338)。
- **評価:** `VERIFIED_EVIDENCE_LIMITATION`。現行v4 HEADのLive E2Eを今回実行していない。
- **v6候補:** Verification Matrixを構成要素別に採用。
- **レビュー質問:** static、unit、integration、real-host、providerを別々に記載したか。

### JV4-K-013 — Worker入力はschema検証だけでなく許可フィールドに再構築

- **主張:** `parseReviewWorkerResult()`の`{...finding}`とredaction側の`{...finding}`は、元入力に追加キーがある場合、それを残し得る。
- **根拠:** [v4 review-artifact.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/review-artifact.ts)、[v4 persistence-redaction.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/v2/persistence-redaction.ts)、[未マージCommit bbf58cf](https://github.com/yohi/justice/commit/bbf58cf98b0b26c0c0a7ae460ceb88afb11156cd)。
- **評価:** `CODE_OBSERVED / UNMERGED_PATCH_CANDIDATE`。実際の情報流出を立証したわけではない。未マージブランチは現行v4とdiverged。
- **v6候補:** 未知のフィールドのdropとログ境界での再正規化を安全原則候補に。
- **レビュー質問:** 型検証だけで未知キーが残っていないか。

### JV4-K-014 — Pre-implementation Review GateとSDD Orchestrationの分離

- **主張:** Design/Plan承認は独立の関門になり得るが、実装タスクの進行・修正・再レビューのスケジュールはSuperpowersの方法論と重複させない。
- **根拠:** [Issue #298](https://github.com/yohi/justice/issues/298)、v4仕様 §4.1c/e、[PR #291](https://github.com/yohi/justice/pull/291) のAuto Retry。
- **評価:** `OWNERSHIP_REDEFINITION_REQUIRED`。v6のReview Gate所有者は未決。
- **v6候補:** 「前段の承認保証」と「SDD実行の進行」を別契約にする。
- **レビュー質問:** Justiceが第三のワークフロー司令塔になっていないか。

### JV4-K-015 — v5 Native探索はv6の既定基盤ではない

- **主張:** PR #295は実行基盤の成立性探索で、開発・移行のGO判断ではない。
- **根拠:** [PR #295](https://github.com/yohi/justice/pull/295)（Draft、Task 1 Evidence Spike）。
- **評価:** `CANDIDATE_EVIDENCE_ONLY`。Native/OpenCode V2とも現時点でv6の正式選定を主張できない。
- **v6候補:** 比較証拠として残す。OpenCode V2直接接続の成立性も別途実証。
- **レビュー質問:** 何の能力が証明され、何が未証明かHostごとに分けられているか。

## 4. Unmerged / Existing work — provenance treatment

| 対象 | 固定参照 | 保持すべき知見 | 採択状態 |
|---|---|---|---|
| PR #343 | HEAD `8203d5b77c8f3226acbb52a6f2eeb08b1a8a4335` / [Plan](https://github.com/yohi/justice/blob/8203d5b77c8f3226acbb52a6f2eeb08b1a8a4335/docs/superpowers/plans/2026-10-27-justice-v4-review-gate-drift-remediation.md) | R1/R2静的指摘、V2 planner incompatibility、D0 operation binding、command fail-closed | `OPEN / UNMERGED / IMPLEMENTATION_HOLD` |
| `fix/review-findings-hardening` | [`bbf58cf`](https://github.com/yohi/justice/commit/bbf58cf98b0b26c0c0a7ae460ceb88afb11156cd) | allowlist parser、persistence redaction、write boundary候補 | `DIVERGED / NOT_ADOPTED` |
| `feature/v4-review-gate-incremental-20261030` | v4とidentical | GitHub上は追加コミットなし | `NO_REMOTE_DELTA` |
| PR #341 | [Merged](https://github.com/yohi/justice/pull/341) | Witness/admission部分実装、テスト資産 | `IN_V4 / ACCEPTANCE_SCOPE_LIMITED` |
| PR #326 | [Merged](https://github.com/yohi/justice/pull/326) | Protocol Releaseの文書候補・OwnerとExecution Gateの分離 | `DOC_MERGED / EXECUTION_BLOCKED` |
| Issue #310 | [Open](https://github.com/yohi/justice/issues/310) | 10/9時点のGap一覧。後続マージとの差分照合が必要 | `HISTORICAL_AUDIT / NOT_CURRENT_GAP_LIST` |

## 5. 重要な未証明・非採択事項

1. V2イベントからCoreの全意味状態を再生可能にする設計・実装は未採択。
2. Reviewerの結果の意味的Event、Commit/Apply因果鎖は未採択。
3. 全Approved D0経路の実ホスト保証は未証明。
4. v4 Review Gate全体のG3 PASSは主張不可。テストのskip/実ホスト条件未充足を保持。
5. OmO Native / OpenCode V2のどちらをv6に採用するか未決。
6. PRや文書のレビュー結果を実装開始・GitHubマージ・Production操作の承認と読み替えない。

## 6. v6用Crosswalk schema（提案／未採択）

### Requirements

```yaml
requirement_id: J6-REQ-XXX
origin_knowledge_ids: [JV4-K-004, JV4-K-007]
evidence_refs: [PR-287, SPEC]
owner_of_responsibility: justice | superpowers | host
statement: <what must hold>
acceptance_criteria: [<observable conditions>]
status: PROPOSED
```

### Design decisions

```yaml
design_decision_id: J6-DD-XXX
fulfills_requirements: [J6-REQ-XXX]
origin_knowledge_ids: [JV4-K-008, JV4-K-009]
alternatives_and_rejection_reasons: []
proof_obligations: []
independent_review_status: NOT_RUN
status: PROPOSED
```

### Implementation plan

```yaml
task_id: J6-IMP-XXX
fulfills_design_decisions: [J6-DD-XXX]
verification_case_ids: []
evidence_artifact_ids: []
execution_authority: NOT_AUTHORIZED
```

**双方向追跡:** `Knowledge ID → Requirement ID → Design Decision ID → Implementation Task ID → Test/Evidence ID`。新しい証拠で評価が変わっても旧Revを保存し、変更理由を記す。

## 7. 引き継ぎ時のEvidence Register必須カラム

| 属性 | 内容 |
|---|---|
| Identity | Evidence ID / source type / repo / ref / commit SHA / applicable blob SHA |
| Claim | 主張の完全な文章、範囲、前提条件 |
| Proof | どのソース・テスト・Host・イベントから得られたか |
| Counterevidence | 反例、未証明、除外したケース |
| Interpretation | 事実・推論・候補の明示的な区別 |
| Review | Reviewer / 日付 / 対象HEAD / 審査範囲 / 判定 |
| Authority | Owner採択・Gateと実装許可の独立した状態 |
| Change control | Revision / supersedes / 変更理由 / 再レビュー要否 |

## 8. 推奨する次の文書作業（v4を動かさない）

1. Issue #310の旧Gapを最新のマージ済みPRと対照し、`RESOLVED_IN_CODE` / `PARTIAL` / `NOT_PROVEN` / `SUPERSEDED`に分類。
2. `v4.3.1 → v4` の404コミットを責務群に分けて索引化。各コミットの個別監査がまだないことは注記。
3. 未マージブランチの差分から、現行v4に未反映の設計上の学びのみを追加（必要に応じてR0.2）。
4. v6の要件ドラフトにKnowledge-IDを紐付け、独立レビュー可能なTraceability Matrixを作成。

## 9. Frozen evidence locators

| Source | 固定Commit/Blob SHA | URL |
|---|---|---|
| v4 SPEC | Commit `e988a34dd112985832ed15744d74f275abf853b0` / Blob `4c535b5dc9b171dedabf54299d34ba13eca83896` | [SPEC.md](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md) |
| v4 Evidence Checklist | same commit / Blob `77c4f1f6fdbafdf0055cb2ba53aedabd5c8fb872` | [Checklist](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/docs/review-gate-v4-evidence-checklist.md) |
| 10/9 Audit | same commit / Blob `51b55461965d118db4289f53caf36646363ad30e` | [Audit](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/docs/reports/2026-10-09-documentation-contract-audit.md) |
| PR #343 R2 Plan | Commit `8203d5b77c8f3226acbb52a6f2eeb08b1a8a4335` / Blob `694d852e02c4952ab823949b11b4e1ab107e1438` | [Plan](https://github.com/yohi/justice/blob/8203d5b77c8f3226acbb52a6f2eeb08b1a8a4335/docs/superpowers/plans/2026-10-27-justice-v4-review-gate-drift-remediation.md) |
| Review Artifact Parser | v4 fixed commit / Blob `83db19d4631602e3898322b5c14ccf98291a65d4` | [Parser](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/review-artifact.ts) |
| Persistence Redaction | v4 fixed commit / Blob `68b20d6828e23a7cd0b60f7a79793d45576e1990` | [Redaction](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/v2/persistence-redaction.ts) |
| Hardening unmerged | Commit `bbf58cf98b0b26c0c0a7ae460ceb88afb11156cd` | [Commit](https://github.com/yohi/justice/commit/bbf58cf98b0b26c0c0a7ae460ceb88afb11156cd) |

## 10. Revision history

| Rev | 日付 | 内容 |
|---|---|---|
| R0.1 | 2026-11-01 JST | 初版。v4開発停止方針に従い静的知見を保存。証拠の完全コピーや全コミット独立レビューではなく参照台帳。 |

**End of R0.1 — No implementation / No GitHub mutation / No Owner adoption claimed.**
