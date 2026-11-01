# Justice v5 — Research & Evidence Ledger R0.1 (V5-03)

**Status:** `DOCUMENT_ONLY / ANALYST_STATIC_RECONCILIATION / REVIEW_NOT_RUN / NO_OWNER_V6_ADOPTION / NO_IMPLEMENTATION_AUTHORITY`  
**基準日:** 2026-11-01 JST  
**Repository:** [yohi/justice](https://github.com/yohi/justice)  
**Fixed reference master:** [`08e9dbe3bee87c1e7f16307f302760f1f7161b19`](https://github.com/yohi/justice/commit/08e9dbe3bee87c1e7f16307f302760f1f7161b19)  
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
