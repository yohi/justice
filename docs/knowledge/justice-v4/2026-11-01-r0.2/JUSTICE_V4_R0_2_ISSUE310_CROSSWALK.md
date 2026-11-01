# Justice v4 Knowledge Reconciliation R0.2 — Issue #310 Crosswalk

**DOCUMENT ONLY / STATIC EVIDENCE RECONCILIATION / ANALYST DRAFT / NO IMPLEMENTATION AUTHORITY**

## 1. Scope and fixed evidence

- Date: 2026-11-01 JST. Repository: yohi/justice.
- Frozen v4 HEAD: `e988a34dd112985832ed15744d74f275abf853b0`. v4 development remains STOP.
- Parent: [Issue #345](https://github.com/yohi/justice/issues/345). Predecessor R0.1: [PR #346](https://github.com/yohi/justice/pull/346) (Draft/unmerged).
- Purpose: Reconcile nine historic findings in Issue #310 (v4.3.1 baseline) with subsequent merged PRs and the unmerged R2-amended PR #343.
- Method: GitHub issue text, PR metadata and descriptions, fixed SPEC, evidence checklist, PR #343 R2 plan, targeted source/branch comparison. No code/test/build/CI/Host execution.
- This is not an exhaustive independent inspection of all 404 post-v4.3.1 commits. PR-reported test results are not newly executed PASS.

## 2. Evidence hierarchy

Normative ratification ≠ implementation; merged PR ≠ runtime acceptance; core/unit test ≠ live Host proof; written proposal ≠ adoption. A BLOCKED/SKIPPED/NOT_RUN state remains explicit. All dispositions are review candidates.

## 3. Issue #310 nine-findings crosswalk

| Finding | Domain | R0.2 assessment | Evidence and remaining limitations |
|---|---|---|---|
| RG310-01 | Generation/予算/Admission | `PARTIAL` | 後続#322/#332/#341はV2 admission・投影・NC1配線を実装報告。#343は全履歴からのCore再投影を未証明とする。 [PR #322](https://github.com/yohi/justice/pull/322), [PR #332](https://github.com/yohi/justice/pull/332), [PR #341](https://github.com/yohi/justice/pull/341), [PR #343](https://github.com/yohi/justice/pull/343) |
| RG310-02 | Self-review新規Finding | `PARTIAL` | 後続#322のself-review reconciliationはCore成果。ただし#343のV2 semantic result永続化・実Host適用は未確立。 [PR #322](https://github.com/yohi/justice/pull/322), [PR #343](https://github.com/yohi/justice/pull/343) |
| RG310-03 | Commit拘束のResolution | `PARTIAL` | 後続#322のcommit-bound lineage・Git recoveryは実装報告。Task10d native guard/seal延期および#343の結果適用未証明が残る。 [PR #322](https://github.com/yohi/justice/pull/322), [PR #343](https://github.com/yohi/justice/pull/343) |
| RG310-04 | Lineage/Regression/NC1 | `PARTIAL` | 後続#322/#330/#332でcycle・stage-aware判定・Two-Key reentry前進。FindingMap/ラウンド履歴のV2再生は未証明。 [PR #322](https://github.com/yohi/justice/pull/322), [PR #330](https://github.com/yohi/justice/pull/330), [PR #332](https://github.com/yohi/justice/pull/332), [PR #343](https://github.com/yohi/justice/pull/343) |
| RG310-05 | Strict Event/Causal history | `PARTIAL` | 後続#313/#327/#341でV2 schema、recovery cursor、protected publicationの部分実装。#343はRESULT_COMMITTEDとOUTCOME_APPLIEDの意味イベント未確立を指摘。 [PR #313](https://github.com/yohi/justice/pull/313), [PR #327](https://github.com/yohi/justice/pull/327), [PR #341](https://github.com/yohi/justice/pull/341), [PR #343](https://github.com/yohi/justice/pull/343) |
| RG310-06 | Deterministic validation | `PARTIAL` | 後続#322/#330にstage-aware validation、#341にAdmission接続の記録。全stageのproduction証拠とG3は未確立。 [PR #322](https://github.com/yohi/justice/pull/322), [PR #330](https://github.com/yohi/justice/pull/330), [PR #338](https://github.com/yohi/justice/pull/338), [PR #341](https://github.com/yohi/justice/pull/341) |
| RG310-07 | NC1復帰と連続性 | `PARTIAL` | 後続#332/#341でreentry/phase reopen接続。Hostと永続semantic stateの全面受理は未成立。 [PR #332](https://github.com/yohi/justice/pull/332), [PR #341](https://github.com/yohi/justice/pull/341), [PR #343](https://github.com/yohi/justice/pull/343) |
| RG310-08 | Completed Successor/Design CLEAR | `NORMATIVE_SUPERSEDED; IMPLEMENTATION_PARTIAL` | Issue #310のDEP-01 RATIFIEDにより旧Design CLEAR継承要件をSUPERSEDE。Plan-only変更でもfresh Design reviewが必要。後続#334/#335のsuccessor lookupは全受理の証拠ではない。 [PR #334](https://github.com/yohi/justice/pull/334), [PR #335](https://github.com/yohi/justice/pull/335), [PR #341](https://github.com/yohi/justice/pull/341) |
| RG310-09 | Caller routingとInterfaces fence | `PARTIAL` | 後続#335はcaller-owned routing実装を報告。一方SPEC §4.1dにはgeneral例外・fence grammar同等性の未証明が残る。 [PR #335](https://github.com/yohi/justice/pull/335), [PR #338](https://github.com/yohi/justice/pull/338) |

### Critical normative change

- **RG310-08 must not be treated as an ordinary unimplemented inherited Design CLEAR feature.** Issue #310 DEP-01 says the old conditional inheritance contract is SUPERSEDED, and conservative fresh Design re-review was RATIFIED. That normative event does not prove the replacement implementation or determine v6 design.
- Other findings have source/test progress, but the latest V2 evidence model still contains missing semantic result and replay contracts. Do not label RG310-01 through RG310-09 globally RESOLVED.

## 4. Additional 2026-10-27 evidence

- [PR #343](https://github.com/yohi/justice/pull/343) includes `NEG-V4-20261027-001`: recognized slash-command init failure could leave host-expanded input; command fail-closed is an unimplemented remediation candidate.
- [PR #343](https://github.com/yohi/justice/pull/343) includes `TARGET-V4-001`: V2 read-only review continuation, semantic result persistence, crash recovery. R2: DESIGN_REVIEW_REQUIRED / IMPLEMENTATION_HOLD for Tasks 3/4 and dependent Task 5.
- [PR #343](https://github.com/yohi/justice/pull/343) includes `TARGET-V4-002`: approved immutable D0 versus dirty/staged D1; read/search/show/prompt/attachment must bind to the current witnessed Plan operation, not a stale cache.
- R2 gap: V2 verified tip has aggregate counters, but Legacy planner needs per-round histories, FindingState map and review observations. Neither invented empty arrays nor legacy event fabrication may supply missing authority.
- R2 gap: opaque RESULT_COMMITTED/OUTCOME_APPLIED event IDs do not establish an independently witnessed semantic finding/result event, nor replayable Core transition.

## 5. Unmerged branch-delta triage (selected branches)

| Ref | Compare to frozen v4 | Meaning |
|---|---|---|
| `feature/review-gate-v4-drift-remediation-plan-20261027` | ahead 3, behind 0; 1 Markdown | PR #343の未マージ計画。コード修正・実装許可ではない |
| `fix/review-findings-hardening` | diverged; ahead 1, behind 569; 6 files | 追加Findingキーの混入を避けるallowlist再構築候補。未採択 |
| `feature/justice-review-gate-command` | diverged; ahead 7, behind 439 | 古いcommand実装。後続#285/#287のHost失敗と合わせて解釈 |
| `feature/multi-agent-review-design` | diverged; ahead 1, behind 1678 | 旧設計候補でありv4正本ではない |
| `feature/v4-review-gate-incremental-20261030` | identical; ahead 0, behind 0 | ブランチ名と進行中の実差分は同義ではない |
| `feature/phase2-task1-shard-layout 等3系統` | each diverged, ahead 1; diff files 0 | 独自コミットの存在だけで未取り込みの実装差分とは言えない |
| `feature/task-9-*、feature/task-13-*、feature/task-20-real-host-e2e 等` | behind only, ahead 0 | 現行v4の祖先に含まれる。旧PR個別のマージ可否と区別 |
| `docs/rg310-* / docs/v5-* / spike/justice-v5-native-evidence-294` | v4とdiverged | 主にv5/Native設計証拠として別枠。v4実装負債に計上しない |

**Branch scope limits:** The comparisons distinguish representative unique v4 deltas, inherited branches and v5 divergent work. A closed stacked PR is not automatically a discarded change; an unmerged branch is not automatically a new current-v4 regression. Exhaustive per-commit content reconciliation remains for R0.3.

## 6. Original v4 mission beyond Review Gate — initial review candidates

| Domain | Preserve as a design question | Unproven or host-specific aspect |
|---|---|---|
| Plan Bridge | Preserve rawBody, caller intent, explicit authorization and conservative dependencies. | OmO task wire format and OpenCode V1 hook semantics cannot be assumed valid on V2. |
| Feedback/Observation | Accepted and observed evidence, not Worker self-report, controls status updates. | Parent-child/task-call/session binding and real-Host provenance require new proof. |
| Review Gate/Assurance | Separate CLEAR from Human approval; enforce scope identity where justified. | Current Witness/ledger machinery is a candidate method, not necessarily required v6 implementation. |
| Wisdom/Tiered Stores | Retain lessons about local/global scopes, redact secrets, avoid uncontrolled context pollution. | Benefit, ownership and runtime necessity remain unmeasured; not automatically a v6 MUST. |
| Compaction/Loop | Preserve approved task context and avoid ineffective loops. | Cross-host compaction behavior, host API and intervention ownership require reassessment. |
| Routing | Caller-owned routes and provider/model SSOT belong to their owners. | Fixed OmO categories/personas and internal execution controller mechanics are not v6 invariants. |

## 7. Frozen proof locators

- [Issue #310](https://github.com/yohi/justice/issues/310): original deficiencies and ratified DEP-01 contract change.
- [SPEC.md](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md): §§1–2, 4.1c–e, 5.
- [Evidence checklist](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/docs/review-gate-v4-evidence-checklist.md): Task18 PARTIAL, G3 NOT CLAIMED; skip≠PASS.
- [PR #313](https://github.com/yohi/justice/pull/313), [PR #322](https://github.com/yohi/justice/pull/322), [PR #327](https://github.com/yohi/justice/pull/327), [PR #330](https://github.com/yohi/justice/pull/330), [PR #332](https://github.com/yohi/justice/pull/332), [PR #335](https://github.com/yohi/justice/pull/335), [PR #338](https://github.com/yohi/justice/pull/338), [PR #340](https://github.com/yohi/justice/pull/340), [PR #341](https://github.com/yohi/justice/pull/341), [PR #343](https://github.com/yohi/justice/pull/343): merged implementation/evidence vs unmerged proposal.
- [Current review-artifact.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/review-artifact.ts) and [persistence-redaction.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/v2/persistence-redaction.ts): extra Finding properties can survive object spreads.
- [Unmerged hardening commit](https://github.com/yohi/justice/commit/bbf58cf98b0b26c0c0a7ae460ceb88afb11156cd): explicit allowed-field rebuilding proposal; no exfiltration incident or safe merge claimed.

## 8. Exit status and next revision

- **R0.2 DOC CANDIDATE**: Issue #310's nine historical areas mapped to later evidence and limitations; DEP-01 supersession preserved. R0.2 is **not** a full v4 architecture acceptance.
- **R0.3**: independent-looking static source/branch-only delta inventory; include all non-Review-Gate original v4 functions and what was/was not implemented.
- **R0.4**: system-level v4 original-intent validity analysis and v6 portable contract candidates, with alternatives and anti-overreach checks.
- **R1.0**: fresh independent evidence/document review; Human Owner adoption separately. No self-issued PASS/READY or automatic v6 adoption.

**STOP remains in effect: v4 source, tests, build, legacy PR merge, CI dispatch, CodeRabbit triggers and v6 implementation are not authorized.**
