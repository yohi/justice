# Justice v5 — Research & Evidence Ledger R0.2 (V5-03)

**Status:** `DOCUMENT_ONLY / LIMITED_CORRECTION_CANDIDATE / INDEPENDENT_R2_NOT_RUN / NO_OWNER_V6_ADOPTION / NO_IMPLEMENTATION_AUTHORITY`  
**基準日:** 2026-11-01 JST  
**Repository:** [yohi/justice](https://github.com/yohi/justice)  
**Fixed reference master:** [`08e9dbe3bee87c1e7f16307f302760f1f7161b19`](https://github.com/yohi/justice/commit/08e9dbe3bee87c1e7f16307f302760f1f7161b19)  
**R0.1 correction source:** [`adbb397a6c73da22fafb1a656f16832bf961168d`](https://github.com/yohi/justice/commit/adbb397a6c73da22fafb1a656f16832bf961168d)  
**Knowledge Hub:** [Issue #348](https://github.com/yohi/justice/issues/348)  

> This archive is a historically scoped reference and an analyst assessment. It is neither normative v6 Requirements nor an authorization for implementation, host tests, gates, CI, PR or merges.

## 1. Fixed provenance sources

| Source | Commit / revision | Git blob SHA-1 | Evidence status |
|---|---|---|---|
| [Requirements](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md) | `08e9dbe3bee87c1e7f16307f302760f1f7161b19` | `d335c34b747cafd6ac3b2e81d710fdcc61fb777e` | VERIFIED_DOCUMENT |
| [Design](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md) | `08e9dbe3bee87c1e7f16307f302760f1f7161b19` | `8e833fb17c1b27470e0a62c2d6a39627fe2d460d` | VERIFIED_DOCUMENT |
| [Implementation Plan](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md) | `08e9dbe3bee87c1e7f16307f302760f1f7161b19` | `e431460453577ae1c7fe6ee36ec5b76319f61582` | VERIFIED_DOCUMENT |
| [PR #295 Task 1 report](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/docs/reports/omo-native-v5.1.17-senpi-2026.10.8-contract-evidence.md) | `c428041dfb5779b6b6dc8db7bf14928225a00373` | `7df0887402d1d4eaf34a09e44213cf75b630b813` | PRIOR_REVIEW_REPORTED |
| [v4 R0.4](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/knowledge/justice-v4/2026-11-01-r0.4/JUSTICE_V4_R0_4_VISION_VALIDITY_CANDIDATE.md) | `08e9dbe3bee87c1e7f16307f302760f1f7161b19` | `d2c6c5123671ba0ea6f7702b9357af99ae22b75e` | VERIFIED_DOCUMENT |

## 2. Evidence register

| Claim ID | Source | Claim / content | Strength | Limitation |
|---|---|---|---|---|
| JV5-E-001 | [Issue #273](https://github.com/yohi/justice/issues/273) | Original OpenCode-first / SDD ownership | `VERIFIED_DOCUMENT` | Document intent; no runtime claim |
| JV5-E-002 | [PR #294](https://github.com/yohi/justice/pull/294) | Native-first switch, merged docs only | `VERIFIED_DOCUMENT` | No Native adapter implementation |
| JV5-E-003 | [PR #296](https://github.com/yohi/justice/pull/296) | Capability affiliation replaces independent origin requirement | `VERIFIED_DOCUMENT` | Token-holder semantic honesty assumed |
| JV5-E-004 | [PR #295](https://github.com/yohi/justice/pull/295) | Revisioned Task 1 report, final BLOCKED | `PRIOR_REVIEW_REPORTED` | Test logs and host not rerun here |
| JV5-E-005 | [Issue #297](https://github.com/yohi/justice/issues/297) | Review Gate convergence/validation/traceability requirements | `VERIFIED_DOCUMENT` | Requirements do not establish implementation |
| JV5-E-006 | [Issue #298](https://github.com/yohi/justice/issues/298) | Event-sourced deterministic review architecture proposal | `PROPOSED` | V2 semantic replay completeness unproven |
| JV5-E-007 | [PR #325](https://github.com/yohi/justice/pull/325) | R11 static candidate / historical Task1 31/32 | `PROPOSED_BLOCKED` | Static acceptability != Host/Owner approval |
| JV5-E-008 | [PR #342](https://github.com/yohi/justice/pull/342) | DP-R3.2 document readiness | `DOCUMENT_ONLY_LIMITED` | Binary ZIP provenance requires byte read |
| JV5-E-009 | [PR #344](https://github.com/yohi/justice/pull/344) | R9 candidate; 31 findings OPEN; B0+B1, implementation HOLD | `PROPOSED_BLOCKED` | R9 not v5 Plan's 14 tasks; no feasibility |
| JV5-E-010 | [Issue #345 adoption](https://github.com/yohi/justice/issues/345#issuecomment-6554658221) | v4 historical knowledge limited Owner adoption | `APPROVED_BY_OWNER_HISTORICAL_ONLY` | No v6 design or runtime selection |
| JV5-E-011 | [PR #346](https://github.com/yohi/justice/pull/346) | v4 R0.1 knowledge archive merged on 2026-11-01 | `VERIFIED_PR_STATE` | Historical documents and current decision separate |
| JV5-E-012 | [PR #347](https://github.com/yohi/justice/pull/347) | v4 R0.2-R0.4 reconciled archive merged on 2026-11-01 | `VERIFIED_PR_STATE` | Unresolved R1-F-04..07 remain |

## 3. Revisioned Task 1 evidence — DO NOT CONFLATE

| Revision / source | Reported outcome | What it proves and what it does not |
|---|---|---|
| pre-#296 Task 1 evidence, fixed historical baseline reported in v5 Requirements | 15 contracts / 9 PROVEN / 6 BLOCKED | Pinned host primitives observed (tool_call/tool_result, task ID, child storage, successful read); independent workflow-origin and precise review delivery not proved |
| Capability-protocol intermediate PR #295 report | 32 contracts / 27 PROVEN / 5 BLOCKED | Several provenance/sanitation/history observations missing; does not supersede original failure automatically |
| Subsequent focused run in PR #295 report | 32/32 PROVEN reported, 49/49 focused tests | **SUPERSEDED** by later stricter evaluator: missing exact unknown-tool message identity was previously over-promoted |
| Final Task 1 Evidence Gate repair, 2026-10-12 (same PR #295 report) | 31/32 canonical PROVEN, 1 BLOCKED; Case A BLOCKED; Case B PROVEN; overall TASK1_RESULT BLOCKED | Exact unknown-tool `messageId` callback/append join absent; Case A five post-provider-stream-error observations missing; Tasks 2–14 NOT_AUTHORIZED |
| PR #325 R11 preservation narrative | Historical 31/32 with Case A BLOCKED / Case B PROVEN, R11 static candidate | Related historical claim, **not** independently established identical byte-level test/evaluator provenance; R11 Architecture NOT_ADOPTED |

The 32 canonical runtime contracts and the independent provider error Case A have different denominators. The absence of an independently host-observed hidden Superpowers semantic-origin field is not solved by calling authenticated protocol affiliation causal proof. This protocol explicitly assumes an authorized token-holder does not deliberately mislabel a call.

## 4. Review Gate evidence and unresolved problems

- [Issue #297](https://github.com/yohi/justice/issues/297): Design Gate and Plan Gate separation; explicit finding validation, immutable approved Design, commit-bound remediation, deterministic validation and bounded convergence.
- [Issue #298](https://github.com/yohi/justice/issues/298): proposed event-sourced state source, durable generation/attempt/lineage identity, context invalidation and capability-scoped mutations; no automatic adoption of this mechanism.
- [Issue #310](https://github.com/yohi/justice/issues/310): v4 implementation gaps, including semantic replay, lineage, commit authority and actual production coordinator integration. Historical DEP-01 RATIFIED supersedes earlier reuse behavior; this is not Formal Design Gate CLEAR.
- [PR #325](https://github.com/yohi/justice/pull/325): R11 static candidate ACCEPTABLE_AS_STATIC_CANDIDATE; actor-external monitor, atomic ACCEPT+PUBLISH, provider/Host effects NOT_PROVEN; PR contains further archival change history not fully audited here.
- [PR #342](https://github.com/yohi/justice/pull/342): limited DOCUMENT_READINESS_PASS; PR narrative says original ZIPs not published, while the latest changed-filename list contains two archive ZIP paths. **Byte contents vs original archive NOT_VERIFIED**; do not resolve this discrepancy by inference.
- [PR #344](https://github.com/yohi/justice/pull/344): R9 Design/Plan candidates, 31/31 Findings OPEN (12 High, 17 Moderate, 2 Low), FEASIBILITY_NOT_ESTABLISHED, G-ARCH BLOCKED, STOP/HOLD active. The R9 conditional plan's 8 tasks are not the normative v5 implementation plan's Tasks 1–14.

## 5. Merge / authority distinctions

- [PR #294](https://github.com/yohi/justice/pull/294): merged **document revision**; not Native runtime acceptance.
- [PR #295](https://github.com/yohi/justice/pull/295), [#325](https://github.com/yohi/justice/pull/325), [#342](https://github.com/yohi/justice/pull/342), [#344](https://github.com/yohi/justice/pull/344): OPEN DRAFT / UNMERGED at R0.1 source check.
- [PR #346](https://github.com/yohi/justice/pull/346) / [PR #347](https://github.com/yohi/justice/pull/347): merged on 2026-11-01; post-merge present state differs from older PR-body addenda claiming unmerged.
- [v4 Owner decision](https://github.com/yohi/justice/issues/345#issuecomment-6554658221): JV4-K-001–015 where defined and 019–023 are APPROVED_BY_OWNER for **historical knowledge only**; JV4-K-016–018 and 024–026 are NOT_ADOPTED; R1-F-04..07 remain unresolved. v6 A/B/C NOT_SELECTED.

## 6. Status vocabulary and required future proof

`VERIFIED_DOCUMENT` = authoritative GitHub text/state fetched; `PRIOR_REVIEW_REPORTED` = report's claim, not independently rerun; `APPROVED_BY_OWNER_HISTORICAL_ONLY` = limited historical knowledge acceptance; `PROPOSED` = candidate design not adopted; `BLOCKED` = unmet required condition; `NOT_VERIFIED` = current independent evidence absent; `SUPERSEDED` = prior evaluator/result displaced by later revision.

Future evidence reviewers must capture Claim ID, Git URL, fixed commit/blob, normative authority, production implementation existence, unit/integration/real-host evidence, disconfirming evidence, Owner decision, review scope and reviewed revision. This R0.1 does not contain every underlying ZIP or full-source static audit.

**Outcome:** `HISTORICAL_EVIDENCE_REFERENCED_WITH_LIMITATIONS / NOT_RUNTIME_CERTIFIED`.

## 7. R0.2 documentary corrections and evidence provenance

### 7.1 Task 1 finality — CORR-01 (`R1-F-03`, `R1-F-04`)

The fixed PR #295 Evidence Report was re-read at commit `c428041dfb5779b6b6dc8db7bf14928225a00373`, blob `7df0887402d1d4eaf34a09e44213cf75b630b813`. The report's opening `32/32 PROVEN` status is an earlier focused snapshot and is **SUPERSEDED**; it is not the final effective result. The independent R2 report (`JUSTICE_V5_KNOWLEDGE_R0_2_FRESH_INDEPENDENT_R2_REVIEW_REPORT.md`, SHA-256 `ee7a6592d04f4cc50f5f7b70ecd9344c445e668b319bcaad39874a56208351d0`) returned `CORRECTION_REQUIRED` and identified the following distinct historical evidence boundaries.

| Revision | Historical outcome | Evidence class / qualification |
|---|---|---|
| Pre-#296 | 9/15 PROVEN | `PRIOR_TEST_REPORTED`; original authority model, not comparable as the final 32-contract gate |
| Intermediate | 27/32 PROVEN | `PRIOR_TEST_REPORTED`; five contracts blocked |
| Interim focused | 32/32 PROVEN | `PRIOR_TEST_REPORTED / SUPERSEDED`; later stricter evaluator removed this promotion |
| Final corrected | 31/32 PROVEN | `PRIOR_TEST_REPORTED`; final corrected 32-contract accounting |
| Independent Case A | BLOCKED | Provider stream error: five required post-error observations were not established |
| Independent Case B | PROVEN | Separate post-capture sanitizer-failure control; cannot substitute for Case A |
| Overall Task 1 | **BLOCKED** | Historical final outcome; not a current test run or acceptance |

#### R2-F-01 — distinct Task 1 evidence findings

The fixed PR #295 report separates Case A from two findings in the 32-contract unknown-tool control. These findings must not be combined under one “remaining Case A gap.”

| Finding / contract | Distinct evidence gap in fixed report | Status |
|---|---|---|
| `RG-310-A-001` — Case A (`provider_stream_error`), outside the 32-contract denominator | Five Case A-only post-error observations are missing: `cachedActivationReissueRejected`, `preFailureReadResultRejected`, `freshReadReauthorized`, `lateAssistantSanitized`, and `lateToolResultSanitized`. The report states the driver did not observe those follow-up calls/results in that session (fixed report §“Case A — independent `provider_stream_error` control,” lines 429–483; Remaining findings, lines 594–600). | `BLOCKED` |
| `RG-310-B-001` — unknown-tool synthetic result, within the 32-contract denominator | The pre-append callback `message.id` and post-append result `messageId` are both `null`; the same-session/call observations therefore cannot be joined by a strict `messageId` identity. The synthetic result was observed, but the required exact identity join is absent (fixed report §“Unknown-tool synthetic result,” lines 484–510; Remaining findings, lines 601–605). | `BLOCKED` |
| `RG-310-B-002` — positive token removal | The result entered sanitation with no token (`token present before sanitation: false`), callback execution was observed, and `sanitizationChanged: false`. Token absence is not positive evidence that sanitation removed a token; no token-bearing result was fabricated (fixed report lines 496–504 and Remaining findings, lines 606–610). | `NOT_PROVEN` |

Case A and Case B remain separate controls: Case A is `BLOCKED`; Case B remains `PROVEN` as a distinct post-capture sanitizer-failure control. The three findings above do not change the final 32-contract accounting: 31/32 PROVEN and 1/32 BLOCKED; Overall Task 1 remains `BLOCKED`, not READY/PASS. Tasks 2–14 remain `NOT_AUTHORIZED`. No runtime or test was rerun for this correction.

#### R2-F-02 — revision table scope and omitted snapshots

The table above is a **major-milestone excerpt**, not a complete chronology. The fixed PR #295 report states that earlier `29/32`, `30/32`, and `31/32` snapshots remain historical records (report lines 385–387). Those omitted snapshots are recorded here as `HISTORICAL_SNAPSHOT_REPORTED / EXACT_CHRONOLOGY_NOT_ESTABLISHED`: the report does not provide distinct revision names or establish a more detailed ordering for each snapshot in that passage. The earlier `31/32` snapshot does not replace or promote the final corrected `31/32 PROVEN / 1 BLOCKED`; the interim `32/32 PROVEN` remains `SUPERSEDED`.

### 7.2 PR #342 binary archive provenance — CORR-03 (`R1-F-05`)

The earlier PR #342 receipt describes two different points in time. The initial transfer attempt recorded originals as not transferred to GitHub; its later follow-up receipt records their subsequent archival. These statements are sequential, not contradictory.

| Evidence item | `DP_R3_2_Handoff.zip` | `DP_R3_2_Closure.zip` |
|---|---|---|
| GitHub path at fixed PR HEAD | `docs/decisions/rg310-a-001/dp-r3.2/20261025/archives/DP_R3_2_Handoff.zip` | `docs/decisions/rg310-a-001/dp-r3.2/20261025/archives/DP_R3_2_Closure.zip` |
| GitHub file presence | `DOCUMENT_OBSERVED` in fetched fixed tree | `DOCUMENT_OBSERVED` in fetched fixed tree |
| Expected Git blob | `e90a88063f074c9d3bad210739e7fc7bb46fd8b0` | `8071798a0600239f2cb50ca2ff3a6b9f1d3a8cea` |
| Blob observed in R0.2 local object database | exact match | exact match |
| Blob size | 1,310,442 bytes | 1,319,031 bytes |
| Receipt SHA-256 / ZIP CRC | `PRIOR_VERIFICATION_REPORTED`: `27169796ffbe0304853f9ba822ebdbd7959be68c37fb2033eff186a7d85a859a`; CRC PASS, 47 members | `PRIOR_VERIFICATION_REPORTED`: `d8927d47bfdeadcec09968b36b0066a8453af311ec8be107e638125c7e002b0d`; CRC PASS, 6 members |
| R0.2 independent byte SHA-256 / ZIP CRC | independently read from fixed Git blob: exact receipt SHA-256; CRC PASS (47 members) | independently read from fixed Git blob: exact receipt SHA-256; CRC PASS (6 members) |

Fixed PR HEAD: `f5f4e85cfe7b84f7d56533fe15c42f418ff70a39`. The GitHub tree was read, the expected Git blob IDs and byte counts were checked in the isolated local object database, and the blob bytes were piped to SHA-256 and ZIP CRC readers without extraction or execution. This verifies the bytes stored at those Git paths against the values reported in the receipt; it does not independently inspect the original operator-side pre-upload files. The older pending-transfer status remains preserved as historical state.

### 7.3 Review Gate / SDD ownership source boundary — CORR-05 (`R1-F-06`)

Issue #297 is the staged Review Gate requirements source; Issue #298 is a v5 event-sourced architecture proposal; Issue #310 records implementation gaps and a ratified DEP-01 contract revision. Their authority classes differ. The Requirements → Design → Plan pre-implementation control plane is not Superpowers implementation SDD scheduling. `DESIGN_CLEAR` and `PLAN_CLEAR` are historical contract terms only; this reconciliation does not issue either result. Issue #310 explicitly records DEP-01 as `RATIFIED` while Formal Design Gate remained `BLOCKED` and implementation remained `NOT_AUTHORIZED` at that snapshot. No current Gate state is inferred from this archive.

### 7.4 Evidence strength vocabulary — CORR-07

R0.2 adds provenance-specific evidence records in `evidence-index.json`. `DOCUMENT_OBSERVED` means a fixed source artifact or Git object was directly read; `PRIOR_TEST_REPORTED` means a historical report states an outcome but this work did not rerun it; `STATIC_INFERENCE` is a bounded reading-based relationship; `NOT_VERIFIED` means required evidence is absent; `BLOCKED` preserves an unmet historical condition; `OWNER_ADOPTED` is restricted to the explicit historical v4 knowledge decision. These labels are not interchangeable verdicts. Observation, historical test report, independent verification, and Owner decision are recorded separately.
