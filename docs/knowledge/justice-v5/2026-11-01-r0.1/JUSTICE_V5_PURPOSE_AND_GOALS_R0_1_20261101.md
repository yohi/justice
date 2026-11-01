# Justice v5 — Purpose & Technical Knowledge R0.1 (V5-01)

**Status:** `DOCUMENT_ONLY / ANALYST_STATIC_RECONCILIATION / REVIEW_NOT_RUN / NO_OWNER_V6_ADOPTION / NO_IMPLEMENTATION_AUTHORITY`  
**基準日:** 2026-11-01 JST  
**Repository:** [yohi/justice](https://github.com/yohi/justice)  
**Fixed reference master:** [`08e9dbe3bee87c1e7f16307f302760f1f7161b19`](https://github.com/yohi/justice/commit/08e9dbe3bee87c1e7f16307f302760f1f7161b19)  
**Knowledge Hub:** [Issue #348](https://github.com/yohi/justice/issues/348)  

> This archive is a historically scoped reference and an analyst assessment. It is neither normative v6 Requirements nor an authorization for implementation, host tests, gates, CI, PR or merges.

## 1. Historical objective

Justice v5 sought a **Semantic Control Plane** connecting **Superpowers = development methodology/workflow progression**, **Justice = semantic transmission, observation, correlation, conformance and evidence-based acceptance**, and **execution harness = task/agent/runtime/model/provider/retry ownership**. The goal was not simply an OmO release upgrade or replacement for Superpowers.

Primary preservation invariant from the [v5 Design](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md):

```text
unresolved semantic drift == 0
unauthorized semantic drift == 0
missing required evidence == 0
blocking quality findings == 0
```

This is the **target completion condition**, not a proven implementation outcome.

## 2. Pain points v5 aimed to correct

1. OmO v4 agent/category/config/provider behavior hard-coding and OpenCode patch-version coupling.
2. Duplication of Superpowers SDD task/review/fix/final-review scheduling in Justice.
3. Plan/task briefs reduced to checkbox text or a Justice-generated replacement, losing source semantics.
4. Confusion among desired routing, configured routing, observed executor and actual child task identities.
5. Completion decisions based on model reports, passed tests or unbound reviewer outputs rather than provenance-bound evidence.
6. Authorization staleness after substantive Requirements/Design/Plan changes; unsafe v4-to-v5 authority migration.
7. Review findings drifting across remediation/reviews and incomplete crash/compaction recovery.

Source: [#273](https://github.com/yohi/justice/issues/273), [Requirements](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md), [Design](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md), [Plan](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md).

## 3. Twelve functional goals (analyst inventory; not adopted v6 requirements)

| Goal ID | Intended v5 value | Requirement / Design anchors | v6 treatment candidate |
|---|---|---|---|
| V5-G-01 | Methodology / SDD scheduling ownership remains Superpowers | JUS5-OWN, JUS5-SDD; J5D-OWN/REVIEW | PRINCIPLE_SUPPORTED |
| V5-G-02 | Preserve original Plan, controller brief and caller intent | JUS5-PLAN, JUS5-TASK; J5D-TASK | PRINCIPLE_SUPPORTED |
| V5-G-03 | Exact approved Requirements→Design→Plan artifact chain | JUS5-AUTH; J5D-CHAIN | PRINCIPLE_SUPPORTED |
| V5-G-04 | Semantic role classification with runtime-owned concrete route | JUS5-CAT, JUS5-CTRL; J5D-ROUTE/CAT | ADAPT_TO_HOST |
| V5-G-05 | Durable correlation of semantic task and observed runtime identities | JUS5-CORR; J5D-CORR | PRINCIPLE_SUPPORTED; HOST_PROOF_REQUIRED |
| V5-G-06 | Trustworthy method activation, provenance and exact-call capability | JUS5-ACT, JUS5-CAT-05; J5D-ACT/CAP | NOT_PROVEN_AS_GENERAL_MECHANISM |
| V5-G-07 | Review recognition and conformance delivery without new reviewer dispatch | JUS5-REV; J5D-REVIEW | ADAPT_TO_HOST |
| V5-G-08 | Complete canonical normative clause projection | JUS5-CONFORM/PROJ; J5D-PROJ | PRINCIPLE_SUPPORTED |
| V5-G-09 | Evidence-based conformance/quality/final acceptance | JUS5-GATE/ACC/COMPLETE; J5D-GATE | PRINCIPLE_SUPPORTED |
| V5-G-10 | Safe recovery, compaction, migration and state distinction | JUS5-REC/PERSIST/STATE; J5D-REC | ADAPT_TO_HOST |
| V5-G-11 | Capability-first compatibility and effective-config Doctor | JUS5-COMP/CONFIG/DOC; J5D-CONFIG | ADAPT_TO_HOST |
| V5-G-12 | Deterministic pre-implementation Review Gate/history/lineage | Issues #297/#298, RG-310 | ARCHITECTURE_REVIEW_REQUIRED |

## 4. Historical evolution and contract revision

| Period / source | Architecture orientation | Technical interpretation |
|---|---|---|
| 2026-09-27 / [#273](https://github.com/yohi/justice/issues/273) | OpenCode plugin + OmO OpenCode edition first | Superpowers owns SDD; Justice shall not shrink Plan semantics; OmO resolves model/provider |
| 2026-10-06 / [merged PR #294](https://github.com/yohi/justice/pull/294) | OmO Native v5.1.17 + Senpi v2026.10.8 first | OpenCode adapter becomes secondary, existing model-issued `task` must not be replaced by Justice dispatch; documentation-only |
| 2026-10-06 / [PR #296](https://github.com/yohi/justice/pull/296) | Authenticated protocol-affiliation design | No independently observed hidden Superpowers-origin field in pinned host; capability assertion has explicit token-holder trust boundary |
| 2026-10-12 / [PR #295 evidence](https://github.com/yohi/justice/pull/295) | Evidence spike and failure investigations | Proof has revisioned denominators, scoped host modes, and persistent unresolved cases; no general Native adapter acceptance |
| 2026-11-01 / [#345 Owner decision](https://github.com/yohi/justice/issues/345#issuecomment-6554658221) | v4 lessons boundedly adopted as history | v6 A/B/C unselected; v5 Native evidence is historical input, not default v6 runtime |

## 5. Deliberate non-goals of v5

Justice was not to own task scheduling, implementation task reviewer dispatch, final review scheduling, model/provider choice, provider fallback, runtime retry or the Superpowers SDD progress ledger. `dependency-analyzer` could be advisory/diagnostic but not progression authority. A Review Gate for **pre-implementation** Requirements→Design→Plan approval was separately contemplated and must not be conflated with the Superpowers implementation review loop.

## 6. Evidence limits

The 14 planned tasks and 56 required scenarios are **design intentions**, not 14 completed implementations or 56 executed proofs. Task 1 historical fixture evidence is reported and partially positive, but its final corrected overall result is BLOCKED. Tasks 2–14 are NOT_AUTHORIZED. The full Requirements/Design-to-code audit, all historical ZIP bytes, and current independent Host E2E were not performed for this R0.1.

**Outcome:** `PURPOSE_AND_GOALS_INVENTORY_SUPPORTED_WITH_LIMITATIONS`.
