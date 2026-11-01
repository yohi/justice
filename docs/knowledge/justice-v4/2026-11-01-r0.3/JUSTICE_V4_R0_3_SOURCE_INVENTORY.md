# Justice v4 R0.3 — Original-Intent Source Inventory (Preliminary)

**DOCUMENT ONLY / STATIC SOURCE INVENTORY / NOT INDEPENDENTLY REVIEWED / NO V4 EXECUTION AUTHORITY**

Date: 2026-11-01 JST. Frozen v4 HEAD: e988a34dd112985832ed15744d74f275abf853b0. Parent Issue #345, companion R0.2 Draft PR #347.

## Source snapshot

| Component | Immutable source | Git blob SHA-1 | Observation and evidence limit |
|---|---|---|---|
| plan-parser | [src/core/plan-parser.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/plan-parser.ts) | `871661b21e04e2330553a021e49b1657a9f089f6` | Markdown task parsing; helper exists, grammar/Host equivalence unproven |
| task-packager | [src/core/task-packager.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/task-packager.ts) | `d2ad98ba071631be5b86a322f4480d54b6909ba3` | Logical task ID and OmO wire normalization; re-adapt to V2 |
| dependency-analyzer | [src/core/dependency-analyzer.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/dependency-analyzer.ts) | `99bf26a26b5ae7247b0e5ee6cc9607840877a802` | Conservative dependency selection; fence grammar gap |
| plan-authorization | [src/core/plan-authorization.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/plan-authorization.ts) | `291a2b84f86a4e287ea35d6e95988bb738dcf2be` | Explicit plan scope authorization; live authority evidence distinct |
| plan-bridge | [src/hooks/plan-bridge.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/hooks/plan-bridge.ts) | `83cbe152fd03934a2cfa689fece34dd475cc767e` | Instruction bridge; OpenCode V1/OmO Host-specific |
| task-feedback | [src/hooks/task-feedback.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/hooks/task-feedback.ts) | `f98bc8fb1cd1f415285c390f6e3e1035649dd658` | PostToolUse task result, learning and telemetry; assumes tool=task |
| compaction-protector | [src/hooks/compaction-protector.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/hooks/compaction-protector.ts) | `c16a57e562d8f2587f6988510331f349ac798c41` | Context snapshot/injection; new Host lifecycle unverified |
| loop-handler | [src/hooks/loop-handler.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/hooks/loop-handler.ts) | `f3b2ea7ef2da29fe0d14f3d6b6e08a267cb52aff` | Review rejection count/pivot guidance; possible Superpowers overlap |
| wisdom-store | [src/core/wisdom-store.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/wisdom-store.ts) | `da48bad221ab95bed1479120a7b96b4bcf75d78e` | Local wisdom/persona retrieval; benefits unmeasured |
| tiered-wisdom-store | [src/core/tiered-wisdom-store.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/tiered-wisdom-store.ts) | `9d65e73bd9e260a3145a771a93ac360e6e725d98` | Local/global wisdom + secret pattern scan; no comprehensive leak proof |
| agent-router | [src/core/agent-router.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/agent-router.ts) | `b042741b8b287fa0ac0124d2c2050dff924336a1` | Tiny WorkflowRouter wrapper; not a complete OmO executor |
| telemetry-store | [src/core/telemetry-store.ts](https://github.com/yohi/justice/blob/e988a34dd112985832ed15744d74f275abf853b0/src/core/telemetry-store.ts) | `e147c0c5f5c603c4744886429dcfe69d9cc3761c` | Plan-level telemetry; value and overhead unmeasured |

## v4 design-direction assessment (preliminary)

- **Plan Bridge / Pure Core:** v4 has decomposed PlanParser, TaskPackager and PlanBridge. The direction remains sensible; OmO wire formatting, OpenCode V1 hooks and current supported task operation must not be assumed portable to OpenCode V2.
- **Non-intervention principle vs practical guidance:** SPEC section 4.1 describes Atlas workflow guidance and Hephaestus pivot after rejections. This can overlap upstream Superpowers methodology. The v6 requirement must separate advice/context from Justice taking ownership of scheduling.
- **Execution subsystem:** frozen AgentRouter is only a WorkflowRouter wrapper. Its existence does not prove Justice already implements OmO's execution engine. No default decision to replicate OmO in Justice is supported.
- **Feedback and Wisdom:** TaskFeedbackHandler acts on PostToolUse tool named task. WisdomStore and TieredWisdomStore exist with local/global policy and secret-pattern checking. This is software presence, not measured quality benefit or complete confidentiality proof.
- **Compaction:** CompactionProtector builds a plan snapshot with escaped markdown fence and prior learnings; whether OpenCode V2 reliably invokes/replays it is unproven.
- **Loop/Pivot:** LoopDetectionHandler tracks rejection and recommendations. Responsibility for actual fix/re-review progression must be reconsidered against Superpowers, not inherited mechanically.
- **Quality/Authority:** Review Gate is a valid quality-boundary concept but R0.2 shows incomplete V2 semantic replay/Host acceptance. CLEAR and Owner execution approval must remain distinct.

## Newly identified knowledge candidates (not adopted)

- JV4-K-019: A feedback hook coupled to OmO task name needs new Host event/correlation proof.
- JV4-K-020: Controller-only AgentRouter is not evidence of an independent Justice execution engine.
- JV4-K-021: Guidance/pivot/retry can cross the non-intervention boundary; distinguish advisory vs executive actions.
- JV4-K-022: Wisdom/Tiered retention and auto-injection should be optional until value/confidentiality proofs exist.
- JV4-K-023: Compaction re-injection mechanics need capability-first host validation.

## Unresolved proof obligations

- Not an exhaustive inspection of all 404 commits, all source files, tests, or legacy unmerged branch byte diffs.
- Source existence/public signatures and selected logic were inspected at fixed v4 HEAD. Test/build/host E2E were not run.
- No measured performance/quality benefit for Wisdom, Telemetry, retry, compaction.
- v6 requirements must record mandatory Bridge/Assurance invariants separately from optional enhancements and Host-dependent implementation.
- Next: R0.4 whole-system validity comparison; independent R1.0 evidence review remains separately authorized.

**R0.3_PRELIMINARY / NOT_OWNER_ADOPTED / V4_DEVELOPMENT_STOP_INTACT**
