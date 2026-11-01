# Justice v5 — Architecture Validity & v6 Knowledge Candidate Mapping R0.1 (V5-04 / V5-05)

**Status:** `DOCUMENT_ONLY / ANALYST_STATIC_RECONCILIATION / REVIEW_NOT_RUN / NO_OWNER_V6_ADOPTION / NO_IMPLEMENTATION_AUTHORITY`  
**基準日:** 2026-11-01 JST  
**Repository:** [yohi/justice](https://github.com/yohi/justice)  
**Fixed reference master:** [`08e9dbe3bee87c1e7f16307f302760f1f7161b19`](https://github.com/yohi/justice/commit/08e9dbe3bee87c1e7f16307f302760f1f7161b19)  
**Knowledge Hub:** [Issue #348](https://github.com/yohi/justice/issues/348)  

> This archive is a historically scoped reference and an analyst assessment. It is neither normative v6 Requirements nor an authorization for implementation, host tests, gates, CI, PR or merges.

## 1. What v4 already adopted (limited historical knowledge)

The Owner decision [#345](https://github.com/yohi/justice/issues/345#issuecomment-6554658221) accepted JV4-K-001–015 **where defined**, and JV4-K-019–023 as **historical knowledge with original evidence limitations**. It did not accept 016–018 or 024–026, select v6 A/B/C, or authorize implementation. Unresolved R1-F-04/05/06/07 (finding fields, Loop/Pivot ownership, V2 TaskFeedback real-host correlation and source inventory coverage) remain open. The adopted history is an input, not a self-executing specification.

## 2. Architecture-validity candidate register

| JV5 Knowledge ID | Claim / v5 purpose | v4 knowledge anchor | v6 classification (analyst) | Proof obligation |
|---|---|---|---|---|
| JV5-K-001 | Superpowers workflow owner, Justice bridge | JV4-K-001, JV4-K-014 | 継承支持 | Double-dispatch and task progression negative Host evidence |
| JV5-K-002 | Lossless Plan and Caller Intent | JV4-K-002, JV4-K-003 | 継承支持 | Exact parent→worker payload diff and caller-owned route tests |
| JV5-K-003 | ApprovedArtifactChain and human authorization | JV4-K-005, JV4-K-010 | 継承支持 | Exact digest/version/Owner event binding with stale negative cases |
| JV5-K-004 | Semantic vs runtime identity split | JV4-K-004, JV4-K-019 | 継承支持（方式適応） | Observed parent/tool call/runtime task/child/result join per host |
| JV5-K-005 | Authenticated provenance and trust boundary | JV4-K-004, JV4-K-007 | 未証明／再検討 | Exact capability affiliation failure controls and adversarial trust review |
| JV5-K-006 | Review evidence without scheduling ownership | JV4-K-014, JV4-K-021 | 方式適応 | Authenticated review kind, exact child delivery, no reviewer duplication |
| JV5-K-007 | Normative clause coverage and acceptance | JV4-K-005, JV4-K-007 | 継承支持 | Missing/contradictory/stale clause negative controls |
| JV5-K-008 | Fail-open ordinary execution / fail-closed authority | JV4-K-006 | 方式適応 | Per-operation failure table, unsafe transformation fail-closed |
| JV5-K-009 | State recovery and semantic replay | JV4-K-008, JV4-K-009, JV4-K-023 | 方式再検討 | Lossless core projection, crash windows, compaction evidence |
| JV5-K-010 | Review Gate event sourcing and lineage | JV4-K-008–012, JV4-K-014 | 再検討 | Signed authority, semantic reducer replay, counterexample-driven alternatives |
| JV5-K-011 | Version/config compatibility | JV4-K-003, JV4-K-015 | 方式適応 | Native OpenCode V2 / OmO effective capability-based comparisons |
| JV5-K-012 | Optional feedback/wisdom/telemetry | JV4-K-020–023 | 任意・価値未証明 | Utility, privacy, latency, context cost, behavior bounds |

Interpretation: `継承支持` applies to an **invariant**, not automatically to v5's concrete Native capability, Senpi hooks, event store or OmO categories. `未証明` does not mean impossible. `任意` is not a removal authorization.

## 3. Review Gate vs Superpowers execution

- **Pre-implementation control:** Requirements→Design Gate→Design CLEAR→Plan Gate→Plan CLEAR, artifact fingerprint/lineage, finding validation, bounded reconciliation and human approval. Proposed Justice assurance responsibility, with implementation strategy still needing proof.
- **Implementation SDD:** implementer selection, task reviewer/fix/re-review/final-review scheduling, progress and next-task dispatch remain Superpowers' responsibility. Justice observes/verifies and does not schedule duplicate workers.
- **Boundary condition:** A CLEAR result is neither approval of the exact artifact chain nor authority to implement. Review Gate R11/R9 static evidence is not host-executable permission. Issue #298 is a design proposal and V2 semantic replay is not established.

## 4. Runtime options (UNSELECTED)

| Option | Hypothesis | Potential merit | Unproven / cost |
|---|---|---|---|
| A — Superpowers + Justice + OpenCode V2 native | Native delegates work and exposes sufficient observable identity | Thin integration, fewer wrappers | Subagent invocation, provenance, child/result correlation, lifecycle and acceptance must be proven |
| B — Superpowers + Justice + OmO on OpenCode V2 | OmO retains advanced execution beneath Justice | Reuse model selection and delegation features | Additional dispatch/identity layers, provenance, category/host drift, failure modes |
| C — Justice assumes part/all of OmO-like runtime | Justice supplies missing execution features | Direct custom control | Likely conflicts with non-invasive nervous-system principle, risk of duplicate runtime, security/test burden |

No option is adopted. Compare equivalent capability contracts (exact Task brief, caller route, parent/child/tool-call evidence, review identity, compaction/restart/cancel, provider fallback ownership, security limits) before selecting.

## 5. Candidate knowledge → v6 potential requirement crosswalk (NOT ratified)

| Candidate ID | Potential v6 property | Evidence IDs | Verification need |
|---|---|---|---|
| JV6-CAND-01 | No Justice SDD scheduling authority | JV5-K-001 | Responsibility call/ownership table and no-double-dispatch proof |
| JV6-CAND-02 | Preserve approved Plan/Task semantic bytes | JV5-K-002 | Exact source-to-child transport including negative cases |
| JV6-CAND-03 | Correlate semantic and runtime identity without rewriting runtime IDs | JV5-K-004 | Real-host task/session/call/child/result correlation |
| JV6-CAND-04 | Evidence-based acceptance only | JV5-K-007 | Missing, stale, inconsistent evidence and clause projection negatives |
| JV6-CAND-05 | Separate Gate CLEAR, Human Approval, implementation execution authority | JV5-K-003 | Exact artifact fingerprint / Human event / change invalidation |
| JV6-CAND-06 | Recovery never silently promotes unproven authority | JV5-K-009 | Crash/compaction/replay/unknown-schema deterministic proofs |
| JV6-CAND-07 | Choose runtime from verified capabilities, not legacy names | JV5-K-011 | Comparable V2-native vs OmO vs Justice-runtime matrix |
| JV6-CAND-08 | Separate pre-implementation review authority from implementation SDD review | JV5-K-006, JV5-K-010 | Review-control vs workflow progression trace |

Formal future traceability should become `JV5 Knowledge ID → JV6 Requirement Candidate → Design Decision Candidate → Task Candidate → Verification/Evidence`, each with separate Owner adoption and review status. These IDs are **analyst-local knowledge** only and do not create JUS6/JV6 normative MUST clauses.

## 6. Review priorities

1. **P0:** Reconcile Task 1 9/15, 27/32, interim 32/32, final 31/32 with independent Case A and R11 historical 31/32. Compare evaluator, fixed blob, host mode, assurance boundary and what was dropped.
2. **P1:** Compare #297/#298 with R11, DP-R3.2, R9 and v4 semantic replay counterevidence; separate pre-implementation approval and runtime SDD authority.
3. **P2:** Produce side-by-side OpenCode V2-native vs OmO-on-V2 capability matrix under the same criteria, without implementing probes under this archive's authority.

## 7. Limitations and review outcome

- These classifications are `ANALYST_STATIC_CANDIDATES`, not `APPROVED_BY_OWNER` for v6.
- Neither full source-to-implementation mapping nor raw ZIP integrity across all unmerged PRs is proven.
- Real Host E2E (v4 G3, OpenCode V2 semantics, Native all-mode behavior) is not newly tested or claimed.
- Archive or Issue publication is not permission to run tests, dispatch CI/CodeRabbit, merge, change Gate/HOLD or begin v6 implementation.

**Outcome:** `V6_CANDIDATE_KNOWLEDGE_MAPPED / NO_ARCHITECTURE_SELECTED / INDEPENDENT_REVIEW_REQUIRED`.
