# Justice v4 R0.4 — Original Vision Validity and v6 Redefinition Candidates

**STATIC ARCHITECTURE ASSESSMENT CANDIDATE / DOCUMENT ONLY / NOT R1 / NOT OWNER ADOPTED**

- Date: 2026-11-01 JST; frozen v4 baseline `e988a34dd112985832ed15744d74f275abf853b0`.
- Inputs: R0.1 Knowledge Register (Draft PR #346), R0.2 Issue #310 Crosswalk, R0.3 static source inventory, original SPEC, PR #287/#341/#343 and issue #298. No new code or Host execution.

## 1. Question

Was v4's original direction technically wrong, or are its responsibilities and Host contracts in need of redefinition after OpenCode/OmO changes?

**Preliminary answer:** The original non-invasive bridge + evidence/acceptance philosophy is still defensible. Existing evidence does not prove that Justice must become an OmO replacement. But the breadth of v4 Review Gate coordination, feedback-based task/pivot guidance, and incomplete V2 semantic-replay wiring shows that the responsibilities and assurance methods need explicit narrowing or re-justification. This is a bounded analyst conclusion, not a fresh independent architecture acceptance.

## 2. Invariants worth preserving (proposed)

| Candidate invariant | Existing v4 support | Open question |
|---|---|---|
| Superpowers owns methodology | SPEC §§1,4.1 and PR #277 | Some Justice retry/pivot guidance may take over progression |
| Justice faithfully transports exact intent | SPEC §4.1d, PlanParser/Packager, October 9 audit | Proven exact Host delegation under new OpenCode V2? |
| Actual runner owns execution/model/provider | OmO task categorization and caller-owned routing rules | V2 native vs OmO edition capability/cost/observability comparison |
| Accepted evidence not self-declaration controls progress | SPEC §4.1e, core acceptance, Issue #310 | Exact parent-child-callID/evidence attribution in actual host |
| CLEAR is not human approval or implementation authority | SPEC §4.1c/e and Review Gate contract | Can this be enforced with less invasive persistent machinery? |
| Distinguish historical immutable Design from mutable workspace | #341 binding path; #343 D0/D1 findings | Prove every content path preserves owned D0 |
| Replay state without inventing events | #343 R2 negative feasibility evidence | V2-native reducer or nonlossy projection proof required |

## 3. Areas requiring reinterpretation instead of blind port

- **OmO task() and `sp-*` categories:** adapter wire contracts are implementation details, not the purpose of Justice. Caller intent and semantic role ownership matter more than specific tool field names.
- **AgentRouter and role heuristics:** the fixed AgentRouter is a minimal WorkflowRouter wrapper. This is not evidence of a general replacement executor.
- **Review Gate as assurance vs orchestrator:** approval/provenance must remain explicit, but whether Justice launches/schedules repeated worker cycles must be tested against Superpowers SDD responsibilities.
- **Event sourcing/Witness:** durable witnessed state is a candidate implementation of strong assurance, not an invariant requiring every host to carry an identical stack. #343 shows that persistence without replayable semantic events is insufficient.
- **Feedback, Wisdom, Telemetry, auto retry:** useful candidate capabilities, not demonstrated mandatory features. Their value, privacy and context-cost effects should be evaluated; avoid promoting a convenience feature into a security requirement.
- **Compaction protection:** the need to preserve approved context may be portable; exact event/hook and snapshot delivery are Host-specific.
- **Fail-open vs fail-closed:** ordinary telemetry/I/O may degrade without stopping execution, while authorization, accepted evidence and unsafe command expansion must fail closed. Define boundary per operation.

## 4. Architecture options for v6 (NOT SELECTED)

| Candidate | Working hypothesis | Main advantage | Main risk / proof obligation |
|---|---|---|---|
| A — Superpowers ⇄ Justice ⇄ OpenCode V2 native | Justice bridges methodology and native execution. OmO not mandatory. | Matches thin-glue principle; fewer layered dispatch wrappers. | Native subagent semantics, event provenance, session binding and evidence callback support not proven. |
| B — Superpowers ⇄ Justice ⇄ OmO on OpenCode V2 | Keep OmO execution features with updated interface. | May retain advanced routing and task parallelism without new Justice engine. | Host and adapter complexity; dependency on OmO task categories; possible dual-tool identity confusion. |
| C — Justice absorbs OmO-like execution | Justice implements selection, routing, retry and lifecycle itself. | Full custom behavior possible. | Strong non-intervention conflict, duplicate native features, complexity and test burden. Requires specific missing capabilities to justify. |

**Decision rule:** Do not select by fashion or names. Compare against exact capabilities: accepted task payload delivery, explicit caller route, observed executor/child identity, trusted result, independent review, bounded restart, contextual compaction, cancellation, provenance and safety behavior. A missing ability is NOT_PROVEN, not tacitly implemented.

## 5. Evidence-bounded validity judgement by subsystem

| Subsystem | Preliminary verdict | What must be independently reviewed |
|---|---|---|
| Plan/Context Bridge | DIRECTION_SUPPORTED; PORTABILITY_NOT_PROVEN | RawBody semantics, V2 task API, normalization, negative inputs |
| Authorization/Acceptance | DIRECTION_SUPPORTED; HOST_GAPS | CLEAR/approval split, exact binding, fail-closed coverage |
| Review Gate | PURPOSE_SUPPORTED; MECHANISM_PARTIAL | Core-to-V2 replay, host side effects, scope authority, Gate proof |
| Observation/Feedback | CONDITIONAL | Production parent/child/callID, accepted decision binding |
| Wisdom/Telemetry | OPTIONAL_VALUE_NOT_ESTABLISHED | Empirical usefulness, privacy, persistence cost |
| Compaction/Loop | CONTRACT_CANDIDATE; HOST_SPECIFIC | Lifecycle, SDD ownership and duplicated guidance |
| OmO Routing | SEMANTIC_ROLE_VALID; WIRE_LEGACY | Native V2 vs OmO execution proof |

## 6. Concrete knowledge for requirements reviewers

- Never convert a historical failure report into a new v6 normative requirement before checking subsequent merged changes and superseding authority.
- Never treat R0.2 component implementation evidence as full current production conformance or G3 PASS.
- Require positive and negative observations for the actual runtime; source API possibility alone cannot prove event order or correct session affinity.
- Each v6 requirement references source IDs / JV4-K IDs and labels **portable invariant**, **Host-dependent behavior**, or **optional capability**. Design decisions record alternatives and rejected reasons.
- Track design, tests and implementation steps separately; no acceptance without the corresponding execution evidence. Document-only READY does not authorize source work.

## 7. Remaining blockers to the final v4 knowledge assessment

1. Broader unmerged branch-only content has not received exhaustive independent byte-level scrutiny.
2. Full source/call-path comparison for non-Review-Gate domains is not complete; R0.3 is a deliberately bounded inventory.
3. Host E2E for the historical v4 stack and for new OpenCode V2 is not newly run or established.
4. Evidence of actual quality gains from Wisdom/Telemetry and authority tradeoff is not available.
5. This authored R0.4 must receive independent R1 document and evidence review before Owner can adopt it.

## 8. R1 independent reviewer contract proposal

Independent reviewer should inspect fixed PRs/source and documentary evidence, challenge the classification of every original v4 subsystem and R0.2 finding, check version/branch provenance, identify false PASS/READY claims, and return: CONFIRMED / PARTIAL / NOT_ESTABLISHED / CONTRADICTED for each candidate. Do not run code, open PR, dispatch CI or change Gates. Record explicit outstanding evidence and source-linked corrections, separate from Owner adoption.

## 9. Outcome

**ANALYST_REDEFINITION_CANDIDATE_WITH_LIMITATIONS — NOT_INDEPENDENTLY_VALIDATED, NO_V6_ARCHITECTURE_SELECTED.**

V4 remains frozen and its historical work untouched. This document is offered to improve v6 requirement/design/implementation reviews, not to authorize v6 implementation.

References: [SPEC](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/SPEC.md) · [Issue #310](https://github.com/yohi/justice/issues/310) · [PR #287](https://github.com/yohi/justice/pull/287) · [PR #341](https://github.com/yohi/justice/pull/341) · [PR #343](https://github.com/yohi/justice/pull/343) · [Issue #345](https://github.com/yohi/justice/issues/345).
