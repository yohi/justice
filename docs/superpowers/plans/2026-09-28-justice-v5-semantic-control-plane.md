# Justice v5 Semantic Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Justice as the fail-closed semantic nervous system between Superpowers v6.4.2 and OmO v5 OpenCode edition, with zero unresolved semantic drift at PlanComplete.

**Architecture:** Superpowers remains the workflow/review scheduler, OmO remains the runtime/model/provider authority, and Justice owns durable authorization, semantic correlation, normative projection, evidence, conformance, quality, and acceptance. v5 introduces an exact Requirements→Design→Plan artifact chain, sidecar execution correlation keyed by OpenCode parent session/call, deterministic Conformance Contracts, and review interop that enriches the existing Superpowers reviewer call instead of dispatching another reviewer.

**Tech Stack:** TypeScript 6.x, Bun, Vitest 4.x, Effect, Zod, YAML, OpenCode plugin hooks, existing AtomicPersistence and Observation Log infrastructure.

**Requirements:** `docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md`

**Spec:** `docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md`

## Global Constraints

- Superpowers owns task selection, review scheduling, fix/re-review progression, ledger progression, and final whole-branch review. Justice MUST NOT duplicate that orchestration.
- OmO owns agent runtime, model/provider selection, retry, fallback, and continuation `task_id=ses_...`. Justice MUST NOT seize those responsibilities.
- Justice semantic `TaskIdentity` MUST NOT be encoded into OmO `task_id`.
- Runtime execution may fail open where safe; Authorization / Accepted / Verified / Complete MUST fail closed when required proof is missing.
- Human implementation approval binds one exact Requirements→Design→Plan `ApprovedArtifactChain`.
- Required Conformance Contract clauses resolve only to `SATISFIED | VIOLATED | NOT_PROVEN`; `VIOLATED` and `NOT_PROVEN` both block acceptance.
- Only `projectionStatus=COMPLETE` is acceptance-eligible.
- A substantive Requirements/Design/Plan change invalidates downstream authority and requires artifact reconciliation plus required human re-approval.
- Superpowers `Ruling:` may continue workflow execution but MUST NOT rewrite Justice semantic authority.
- Justice never dispatches a duplicate task reviewer, scoped re-reviewer, or final reviewer.
- Canonical v5 review severity is `critical | important | minor`; legacy `major` is migration-only and normalizes to `important`.
- Open Critical/Important findings block Justice acceptance; parked/Ruling is not resolution.
- OmO configured state means the effective user/project + harness/profile view, not one arbitrary `omo.jsonc`.
- v4 durable authority is never silently promoted to v5 authority.
- Final completion requires:
  - `unresolved semantic drift == 0`
  - `unauthorized semantic drift == 0`
  - `missing required evidence == 0`
  - `blocking quality findings == 0`
- Do not manually set the package release version; the repository's release automation remains responsible for release versioning.
- Every production-code task follows RED → GREEN → focused verification → full task test → commit.
- Task 1 is a regression gate for the already-established OpenCode 1.18.31 / Superpowers v6.4.2 review-interop contract. A failure is upstream compatibility drift: STOP the supported-stack implementation and report the drift; do not invent a Justice-owned review fallback.

## Review Focus

- **Post-review mutation:** a reviewer approves commit A, then HEAD changes to B; Task 9 must prove B cannot reuse A's review/conformance evidence.
- **Projection omission:** a malformed or unsupported Plan section disappears from projection; Task 4 must prove projection becomes INCOMPLETE/INVALID rather than silently complete.
- **Continuation collision:** an OmO `ses_...` continuation is unrelated to the current Justice task; Task 5/6 must prove it cannot rebind semantic identity without a trusted child relation.
- **Config precedence:** user, ancestor project, nearest project, harness, and profile layers disagree; Task 11 must prove doctor reports the exact effective value and its sources.
- **Upgrade recovery:** v4 state and unknown/newer state coexist with v5 files; Task 13 must prove neither can silently satisfy v5 acceptance.

---

## File Structure Locked by This Plan

New focused modules:

- `src/core/artifact-chain.ts` — v5 Requirements/Design/Plan revision identity and chain types.
- `src/core/conformance-contract.ts` — normative clauses, projection status, contract/result types.
- `src/core/superpowers-plan-parser.ts` — deterministic parser for the v6.4.2 plan structures Justice treats as normative.
- `src/core/conformance-projector.ts` — Requirements/Design/Plan projection and completeness validation.
- `src/core/execution-correlation.ts` — durable parent-session/call ↔ semantic task ↔ child-session sidecar state.
- `src/core/superpowers-dispatch-resolver.ts` — resolve implementation TaskIdentity from Superpowers task-brief artifacts.
- `src/core/review-interop.ts` — versioned Superpowers reviewer recognition and prompt appendix construction.
- `src/core/review-result.ts` — strict JusticeReviewResult parsing and stale/scope validation.
- `src/core/review-evidence-store.ts` — durable v5 structured review/conformance evidence.
- `src/core/conformance-gate.ts` — task/final conformance and quality acceptance decisions.
- `src/core/omo-effective-config.ts` — OmO v5 file-layer + harness/profile effective config resolver.
- `src/core/v5-persistence.ts` — recognized v4 schema classification and v5 migration diagnostics.

Existing files retain their existing responsibility unless a task below explicitly changes it.

## Verified Review-Interop Baseline

The architecture-critical extension point is established before implementation:

- Justice's existing runtime spike proved the task before/after + child-session correlation path on OpenCode 1.18.29.
- The relevant OpenCode runtime/plugin blobs are byte-identical in v1.18.29 and v1.18.31:
  - `packages/opencode/src/session/tools.ts`: `99f7aec4fdfdfc857702b50b0ca3ce7c8651af4c`
  - `packages/opencode/src/tool/task.ts`: `d8ca640cfba9a52d97e5180fda0ffa719910592b`
  - `packages/plugin/src/index.ts`: `edfa0139dfcaf0e877ab906fabe8e0527afc3915`
- v1.18.31 source verification confirms:
  - `tool.execute.before` receives `sessionID`, `callID`, and mutable `args`;
  - the same `args` object is passed to the native tool executor;
  - TaskTool consumes the mutated `params.prompt`;
  - `tool.execute.after` is tied to the same parent call and TaskTool publishes child-session metadata.
- Superpowers v6.4.2 task review, scoped re-review, and final review all use `Subagent (general-purpose)`; its OpenCode V1 mapping resolves this to native `task` with `subagent_type: "general"`.

Task 1 therefore locks this known contract as regression evidence. It does not decide whether the architecture is viable.

## Canonical Cross-Task Interface Registry

These definitions are binding for every producer/consumer task. A later task may not redefine them.

### Task 2 owns shared semantic identity and quality vocabulary

```ts
type TaskIdentity = {
  readonly schemaVersion: "justice-task-v1";
  readonly artifactChainId: string;
  readonly planFingerprint: PlanFingerprint;
  readonly taskOrdinal: number; // 1-based ordinal in the approved Plan revision
  readonly normalizedHeading: string;
  readonly semanticDigest: string;
};

type ReviewFindingV5 = {
  readonly findingId: string;
  readonly severity: "critical" | "important" | "minor";
  readonly summary: string;
  readonly location?: string;
  readonly disposition: "open" | "resolved" | "parked" | "human_adjudicated";
  readonly evidenceRefs: readonly string[];
};
```

`TaskIdentity` equality uses all six fields. `semanticDigest` is computed from the canonical full task section with progress-only checkbox state normalized away. Checkbox-only progress therefore preserves identity; a substantive task-body change changes `semanticDigest`. A new approved artifact chain intentionally changes `artifactChainId` and therefore creates a new authority-scoped identity.

### Task 4 owns projection and clause-result vocabulary

```ts
type ProjectionDiagnosticCode =
  | "DUPLICATE_CLAUSE_ID"
  | "MISSING_REQUIRED_SOURCE"
  | "AMBIGUOUS_SOURCE_ANCHOR"
  | "UNSUPPORTED_PLAN_STRUCTURE"
  | "PARSER_FAILURE"
  | "SOURCE_REVISION_MISMATCH"
  | "UNMAPPABLE_NORMATIVE_UNIT";

type ProjectionDiagnostic = {
  readonly code: ProjectionDiagnosticCode;
  readonly sourceArtifact?: "requirements" | "design" | "plan";
  readonly sourceAnchor?: string;
  readonly message: string;
};

type ProjectionResult<T> =
  | { readonly status: "COMPLETE"; readonly value: T; readonly diagnostics: readonly ProjectionDiagnostic[] }
  | { readonly status: "INCOMPLETE" | "INVALID"; readonly value?: T; readonly diagnostics: readonly [ProjectionDiagnostic, ...ProjectionDiagnostic[]] };

type ClauseResult =
  | { readonly clauseId: string; readonly status: "SATISFIED"; readonly evidenceRefs: readonly [string, ...string[]] }
  | { readonly clauseId: string; readonly status: "VIOLATED"; readonly reason: string; readonly evidenceRefs: readonly string[] }
  | { readonly clauseId: string; readonly status: "NOT_PROVEN"; readonly reason: string; readonly evidenceRefs: readonly string[] };
```

Only `ProjectionResult.status === "COMPLETE"` is acceptance-eligible.

### Task 5 owns dispatch resolution and correlation mutation results

```ts
type TaskIdentityResolution =
  | { readonly kind: "resolved"; readonly taskIdentity: TaskIdentity; readonly briefPath: string; readonly briefDigest: string }
  | {
      readonly kind: "untrusted";
      readonly reason:
        | "missing_brief_reference"
        | "multiple_brief_references"
        | "brief_unreadable"
        | "brief_from_other_plan"
        | "brief_digest_mismatch"
        | "ambiguous_task_match";
      readonly details: readonly string[];
    };

type CorrelationMutationResult =
  | { readonly kind: "updated" | "idempotent"; readonly correlation: ExecutionCorrelation }
  | { readonly kind: "not_found"; readonly reason: string }
  | { readonly kind: "untrusted"; readonly reason: string; readonly correlation?: ExecutionCorrelation }
  | { readonly kind: "persistence_failed"; readonly reason: string };
```

Only `resolved`, `updated`, and `idempotent` can contribute trusted evidence. All other results are runtime-fail-open where safe but acceptance-fail-closed.

### Task 7 owns review recognition and parsing results

```ts
type RecognizedReviewDispatch =
  | {
      readonly kind: "recognized";
      readonly profile: "superpowers-6.4.2";
      readonly reviewKind: "task-review" | "scoped-re-review" | "final-review";
      readonly parentSessionId: string;
      readonly parentCallId: string;
      readonly artifactChainId: string;
      readonly taskIdentity?: TaskIdentity;
      readonly reviewedRange: { readonly base: string; readonly head: string };
      readonly contractId: string;
      readonly contractDigest: string;
    }
  | { readonly kind: "not_review" }
  | { readonly kind: "ambiguous"; readonly reasons: readonly [string, ...string[]] };

type ReviewResultInvalidReason =
  | "missing_result"
  | "multiple_results"
  | "malformed_json"
  | "schema_mismatch"
  | "correlation_mismatch"
  | "scope_mismatch"
  | "stale_revision"
  | "contract_mismatch"
  | "missing_required_clause";

type ParseReviewResult =
  | { readonly kind: "valid"; readonly result: JusticeReviewResult }
  | { readonly kind: "invalid"; readonly reason: ReviewResultInvalidReason; readonly details: readonly string[] };
```

`RecognizedReviewDispatch.kind === "ambiguous"` and every invalid parse result are untrusted and acceptance-fail-closed.

### Existing task-local definitions remain canonical at their producer

- Task 3: `ApprovedArtifactChain` / `ApprovedPlanBinding.artifactChain`
- Task 4: `ConformanceContract`
- Task 5: `ExecutionCorrelation` / `ExecutionCorrelationKey`
- Task 7: `JusticeReviewResult`
- Task 9: `ConformanceGateVerdict`
- Task 11: `OmoEffectiveConfigResult`
- Task 13: `JusticeReviewV5View`

---

### Task 1: Lock the Verified Review-Interop Baseline as a Regression Gate

**Requirements / Design:** JUS5-COMP-01..03, JUS5-REV-06..09, J5D-REVIEW-01..04.

**Files:**
- Create: `tests/integration/justice-v5-review-interop-host.test.ts`
- Create: `tests/fixtures/superpowers-v6.4.2-review-prompts.ts`
- Production source: **none**

**Interfaces:**
- Consumes the verified baseline documented above and in Design §14.2.
- Produces regression evidence for the already-established OpenCode task-hook contract.
- Does not select or discover an alternative architecture.

- [ ] **Step 1: Add regression fixtures for all three Superpowers v6.4.2 review kinds**

The fixture must preserve the actual distinguishing inputs for:
- task review: brief/report/base/head/diff;
- scoped re-review: findings/fix-base/head/diff;
- final review: plan-or-requirements/base/head;
- OpenCode V1 routing: `subagent_type: "general"`.

- [ ] **Step 2: Add the baseline regression tests**

Exact tests in `tests/integration/justice-v5-review-interop-host.test.ts`:

- `observes_and_mutates_superpowers_task_review_call`
- `observes_and_mutates_superpowers_scoped_re_review_call`
- `observes_and_mutates_superpowers_final_review_call`
- `preserves_subagent_type_general_when_appending_prompt_context`

Each test asserts one existing reviewer dispatch, stable `sessionID + callID`, mutable prompt delivery to the same task execution, unchanged routing fields, and same-call result attribution.

- [ ] **Step 3: Run the regression gate**

Run: `bun run vitest run tests/integration/justice-v5-review-interop-host.test.ts`

Expected on the supported baseline: PASS.

A failure means **upstream compatibility drift**. STOP the supported-stack implementation and report the drift; do not choose a new architecture or introduce Justice-owned review scheduling inside this Plan.

- [ ] **Step 4: Commit the regression evidence**

```bash
git add tests/integration/justice-v5-review-interop-host.test.ts tests/fixtures/superpowers-v6.4.2-review-prompts.ts
git commit -m "test: lock Justice v5 review interop baseline"
```

---

### Task 2: Establish v5 Domain Types, Current OmO Categories, and Wire-Payload Ownership

**Requirements / Design:** JUS5-CAT-01..04, JUS5-CORR-01, JUS5-CORR-05..06, J5D-CORR-01, J5D-ROUTE-01, J5D-CAT-01.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/task-packager.ts`
- Modify: `src/core/omo-category-mapper.ts`
- Test: `tests/core/v5-task-routing-contract.test.ts`
- Test: `tests/core/omo-category-mapper-v5.test.ts`

**Interfaces:**
- Produces the registry-defined `TaskIdentity` and `ReviewFindingV5` in `src/core/types.ts`.
- Produces:
  ```ts
  type TaskCategory =
    | "visual-engineering"
    | "ultrabrain"
    | "deep-low"
    | "deep-high"
    | "artistry"
    | "quick"
    | "unspecified-low"
    | "unspecified-high"
    | "writing";

  type TaskRoutingTarget =
    | { readonly kind: "category"; readonly category: SpCategory | TaskCategory }
    | { readonly kind: "subagent"; readonly subagentType: string }
    | { readonly kind: "continuation"; readonly taskId: string }
    | { readonly kind: "unrouted" }
    | { readonly kind: "invalid_both"; readonly category: string; readonly subagentType: string };

  function inspectTaskRoutingTarget(
    input: Readonly<Record<string, unknown>>,
  ): TaskRoutingTarget;
  ```
- `normalizeTaskToolInput(InPlace)` preserves a legitimate OmO `task_id=ses_...`.
- `enrichTaskToolInput` never serializes `TaskIdentity` into `task_id`.
- Consumes: none.

- [ ] **Step 1: Write RED routing/domain tests**

Exact tests:

In `tests/core/v5-task-routing-contract.test.ts`:
- `preserves_omo_continuation_task_id`
- `never_serializes_justice_task_identity_as_task_id`
- `reports_category_subagent_type_as_invalid_both`
- `preserves_explicit_subagent_type_without_category_injection`
- `preserves_explicit_category_without_subagent_type_injection`
- `does_not_inject_category_into_continuation`
- `justice_does_not_select_model_or_provider`

In `tests/core/omo-category-mapper-v5.test.ts`:
- `does_not_emit_legacy_deep`
- `recognizes_deep_low_deep_high_artistry`
- `custom_sp_categories_coexist_with_omo_v5_categories`

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts`

Expected: FAIL on legacy `deep`, semantic `task_id` enrichment, and missing target inspection/domain types.

- [ ] **Step 3: Implement the exact registry types and normalization boundary**

Do not select model/provider/reasoning/fallback. Do not normalize an invalid both-target call into a trusted routing decision.

- [ ] **Step 4: Run GREEN tests and typecheck**

Run:
- `bun run vitest run tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts`
- `bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/task-packager.ts src/core/omo-category-mapper.ts \
  tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts
git commit -m "refactor: separate Justice identity from OmO task routing"
```

---

### Task 3: Implement ApprovedArtifactChain Authorization and Non-Promoting v4 Authorization Migration

**Requirements / Design:** JUS5-AUTH-01..09, JUS5-PERSIST-01..05, J5D-CHAIN-01..02, J5D-RULING-01, J5D-PERSIST-01.

**Baseline direct-consumer scan:** At master `080bcdb25b192962789ff5d67139e56487381de4`, the old `binding.planPath / binding.planFingerprint / binding.canonicalSnapshot` authority fields are directly consumed outside `plan-authorization.ts` by exactly the production files listed below. Task 3 changes those consumers only mechanically; semantic behavior belongs to later tasks.

**Files:**
- Create: `src/core/artifact-chain.ts`
- Create: `src/core/v5-persistence.ts`
- Modify: `src/core/plan-authorization.ts`
- Modify mechanically: `src/core/acceptance-decision.ts`
- Modify mechanically: `src/core/review-dispatch-state.ts`
- Modify mechanically: `src/core/justice-plugin.ts`
- Modify mechanically: `src/hooks/plan-bridge.ts`
- Test: `tests/core/artifact-chain.test.ts`
- Test: `tests/core/v5-persistence.test.ts`
- Test: `tests/core/plan-authorization.test.ts`
- Test fixture migration: `tests/core/acceptance-decision.test.ts`
- Test fixture migration: `tests/core/review-dispatch-state.test.ts`
- Test fixture migration: `tests/core/review-dispatch-state-behavior.test.ts`
- Test fixture migration: `tests/core/justice-plugin.test.ts`
- Test fixture migration: `tests/hooks/plan-bridge-authorization.test.ts`
- Test fixture migration: `tests/hooks/plan-bridge-implement.test.ts`
- Test fixture migration: `tests/hooks/plan-bridge-posttooluse.test.ts`
- Test fixture migration: `tests/hooks/plan-bridge.test.ts`
- Test fixture migration: `tests/integration/plan-authorization-handoff.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ArtifactRevisionRef = {
    readonly path: string;
    readonly fingerprint: PlanFingerprint;
    readonly sourceRevision?: string;
  };

  type PlanArtifactRevisionRef = ArtifactRevisionRef & {
    readonly canonicalSnapshot: CanonicalPlanSnapshot;
  };

  type ApprovedArtifactChain = {
    readonly chainId: string;
    readonly requirements: ArtifactRevisionRef;
    readonly design: ArtifactRevisionRef;
    readonly plan: PlanArtifactRevisionRef;
    readonly fingerprintSchema: "justice-plan-v1";
    readonly projectionSchema: "justice-conformance-v1";
    readonly approvedAt: string;
  };

  type ApprovePlanInput = {
    readonly sessionId: string;
    readonly artifactChain: ApprovedArtifactChain;
  };
  ```
- `ApprovedPlanBinding` contains one `artifactChain: ApprovedArtifactChain`; the removed top-level plan-only fields are not duplicated as compatibility state.
- v5 authoritative authorization file: `.justice/v5/authorizations.json`.
- v4 `.justice/authorizations.json` remains untouched/historical.
- Produces `classifyPriorJusticeState(raw) -> PriorStateClassification` for `justice-plan-v1`, PersistedEnvelope v1, ReviewSnapshot v1, and legacy human review resolutions.

- [ ] **Step 1: Write RED artifact-chain and migration tests**

Exact required tests:
- `preserves_authorization_for_checkbox_only_plan_progress`
- `invalidates_chain_when_plan_contract_changes`
- `design_change_stales_bound_plan_authority`
- `design_plan_mismatch_stales_downstream_authority`
- `requirements_change_stales_design_and_plan_authority`
- `reapproval_creates_new_artifact_chain_id`
- `v4_plan_authorization_is_not_promoted_to_v5_authority`
- `unknown_or_newer_authoritative_state_is_preserved_not_rewritten`

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/artifact-chain.test.ts tests/core/plan-authorization.test.ts tests/core/v5-persistence.test.ts`

Expected: FAIL because current authorization is plan-only and reads the v4 file as authority.

- [ ] **Step 3: Implement artifact-chain and v5 authorization persistence**

Reuse `AtomicPersistence`. Preserve the existing authorization review boundary/locking semantics. Do not fabricate Requirements/Design lineage during migration.

- [ ] **Step 4: Mechanically migrate every baseline direct consumer**

Only these substitutions are allowed in the four consumer files in this task:

```text
binding.planPath          → binding.artifactChain.plan.path
binding.planFingerprint   → binding.artifactChain.plan.fingerprint
binding.canonicalSnapshot → binding.artifactChain.plan.canonicalSnapshot
```

Update the listed test fixtures to construct/read the new binding shape. Do not change acceptance, review scheduling, PlanBridge, or plugin semantics in this task.

- [ ] **Step 5: Run all directly affected tests + typecheck**

Run:
```bash
bun run vitest run \
  tests/core/artifact-chain.test.ts \
  tests/core/v5-persistence.test.ts \
  tests/core/plan-authorization.test.ts \
  tests/core/acceptance-decision.test.ts \
  tests/core/review-dispatch-state.test.ts \
  tests/core/review-dispatch-state-behavior.test.ts \
  tests/core/justice-plugin.test.ts \
  tests/hooks/plan-bridge-authorization.test.ts \
  tests/hooks/plan-bridge-implement.test.ts \
  tests/hooks/plan-bridge-posttooluse.test.ts \
  tests/hooks/plan-bridge.test.ts \
  tests/integration/plan-authorization-handoff.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the complete atomic migration**

```bash
git add \
  src/core/artifact-chain.ts src/core/v5-persistence.ts src/core/plan-authorization.ts \
  src/core/acceptance-decision.ts src/core/review-dispatch-state.ts src/core/justice-plugin.ts src/hooks/plan-bridge.ts \
  tests/core/artifact-chain.test.ts tests/core/v5-persistence.test.ts tests/core/plan-authorization.test.ts \
  tests/core/acceptance-decision.test.ts tests/core/review-dispatch-state.test.ts tests/core/review-dispatch-state-behavior.test.ts \
  tests/core/justice-plugin.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/hooks/plan-bridge-implement.test.ts \
  tests/hooks/plan-bridge-posttooluse.test.ts tests/hooks/plan-bridge.test.ts tests/integration/plan-authorization-handoff.test.ts
git commit -m "feat: bind authorization to approved artifact chains"
```

---

### Task 4: Build Deterministic Normative Clause Projection and Conformance Contracts

**Requirements / Design:** JUS5-PLAN-01..05, JUS5-CONFORM-01..09, JUS5-PROJ-01..03, J5D-TASK-01, J5D-PROJ-01..03.

**Files:**
- Create: `src/core/conformance-contract.ts`
- Create: `src/core/superpowers-plan-parser.ts`
- Create: `src/core/conformance-projector.ts`
- Modify: `src/core/plan-parser.ts` only to share canonical task-section helpers; do not make checkbox text the v5 semantic authority.
- Test: `tests/core/superpowers-plan-parser.test.ts`
- Test: `tests/core/conformance-projector.test.ts`
- Test: `tests/core/conformance-contract.test.ts`

**Interfaces:**
- Owns the registry-defined `ProjectionDiagnosticCode`, `ProjectionDiagnostic`, `ProjectionResult<T>`, and `ClauseResult`.
- Produces:
  ```ts
  type ProjectionStatus = "COMPLETE" | "INCOMPLETE" | "INVALID";
  type ClauseStatus = "SATISFIED" | "VIOLATED" | "NOT_PROVEN";

  type NormativeClause = {
    readonly clauseId: string;
    readonly sourceArtifact: "requirements" | "design" | "plan";
    readonly sourceRevision: string;
    readonly sourceAnchor: string;
    readonly normativeText: string;
    readonly obligation: "required" | "advisory";
    readonly scope: "global" | "plan" | "task";
  };

  type ConformanceContract = {
    readonly schemaVersion: "justice-conformance-v1";
    readonly contractId: string;
    readonly artifactChainId: string;
    readonly projectionStatus: ProjectionStatus;
    readonly clauses: readonly NormativeClause[];
    readonly diagnostics: readonly ProjectionDiagnostic[];
    readonly digest: string;
  };
  ```
- Exact producer signatures:
  - `parseSuperpowersPlan(markdown: string): ProjectionResult<ParsedSuperpowersPlan>`
  - `projectRequirementsClauses(markdown: string, ref: ArtifactRevisionRef): ProjectionResult<readonly NormativeClause[]>`
  - `projectDesignClauses(markdown: string, ref: ArtifactRevisionRef): ProjectionResult<readonly NormativeClause[]>`
  - `projectPlanClauses(markdown: string, ref: PlanArtifactRevisionRef): ProjectionResult<readonly NormativeClause[]>`
  - `buildConformanceContract(chain: ApprovedArtifactChain, sources: ProjectedSources): ConformanceContract`
- Plan parser recognizes Goal, Architecture, Tech Stack, Spec, Global Constraints, Review Focus, Task Files, Interfaces/Consumes/Produces, signatures, exact values, test assertions, and Expected lines.

- [ ] **Step 1: Write RED parser/projection tests**

Include exact test:
- `projection_failures_never_return_complete` — duplicate ID, missing source, ambiguous source, unsupported Plan structure, parser failure, source revision mismatch, and unmappable normative unit each produce `INCOMPLETE` or `INVALID`, never `COMPLETE`.

Also assert:
- every `JUS5-*` heading produces deterministic source identity + suffixes;
- Design projection enumerates exactly `INV-01..06` + `J5D-*`;
- structural multi-obligation units stay one clause;
- projection schema participates in contract identity.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/superpowers-plan-parser.test.ts tests/core/conformance-projector.test.ts tests/core/conformance-contract.test.ts`

Expected: FAIL because these modules do not exist.

- [ ] **Step 3: Implement deterministic parsing/projection**

Do not use LLM extraction as enumeration authority. Do not infer clauses by searching for `MUST` alone.

- [ ] **Step 4: Run GREEN tests and typecheck**

Run:
- focused tests above
- `bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/conformance-contract.ts src/core/superpowers-plan-parser.ts src/core/conformance-projector.ts src/core/plan-parser.ts \
  tests/core/superpowers-plan-parser.test.ts tests/core/conformance-projector.test.ts tests/core/conformance-contract.test.ts
git commit -m "feat: project versioned conformance contracts"
```

---

### Task 5: Add Durable ExecutionCorrelation and Task-Brief-Based Semantic Task Resolution

**Requirements / Design:** JUS5-CORR-02..05, JUS5-TASK-01..04, JUS5-REC-01..03, J5D-CORR-02, J5D-REC-01.

**Files:**
- Create: `src/core/execution-correlation.ts`
- Create: `src/core/superpowers-dispatch-resolver.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/execution-correlation.test.ts`
- Test: `tests/core/superpowers-dispatch-resolver.test.ts`

**Interfaces:**
- Consumes the registry-defined `TaskIdentity`.
- Owns the registry-defined `TaskIdentityResolution` and `CorrelationMutationResult`.
- Produces:
  ```ts
  type ExecutionCorrelation = {
    readonly authorizationId: string;
    readonly artifactChainId: string;
    readonly planIdentity: string;
    readonly taskIdentity: TaskIdentity;
    readonly executionMethod: "subagent-driven-development" | "executing-plans";
    readonly parentSessionId: string;
    readonly parentCallId: string;
    readonly childSessionId?: string;
    readonly omoContinuationSessionId?: string;
    readonly dispatchRevision: string;
    readonly status: "pending" | "child_observed" | "terminal" | "untrusted";
  };

  type ExecutionCorrelationKey = {
    readonly parentSessionId: string;
    readonly parentCallId: string;
  };
  ```
- Store path: `.justice/v5/execution-correlations.json`.
- `ExecutionCorrelationStore` methods:
  - `bindPending(input: BindPendingInput): Promise<CorrelationMutationResult>`
  - `attachChild(key: ExecutionCorrelationKey, childSessionId: string): Promise<CorrelationMutationResult>`
  - `attachContinuation(key: ExecutionCorrelationKey, sesId: string): Promise<CorrelationMutationResult>`
  - `markTerminal(key: ExecutionCorrelationKey): Promise<CorrelationMutationResult>`
  - `findByCall(key: ExecutionCorrelationKey): Promise<ExecutionCorrelation | null>`
  - `findTrustedByChildSession(childSessionId: string): Promise<ExecutionCorrelation | null>`
- `resolveSuperpowersImplementationTask(input: ResolveTaskIdentityInput): Promise<TaskIdentityResolution>`:
  - extracts exactly one Superpowers task-brief reference;
  - reads `task-N-brief.md`;
  - canonicalizes the full task section with checkbox state normalized away;
  - constructs the registry-defined `TaskIdentity`;
  - matches `semanticDigest` against exactly one task in the active authorized Plan snapshot;
  - task number/path alone is insufficient trust.

- [ ] **Step 1: Write RED correlation-store tests**

Cover:
- same `parentSessionId+parentCallId` is idempotent;
- conflicting semantic task for same call → `untrusted`;
- child relation accepted only when parent relation agrees;
- unrelated `ses_...` cannot rebind semantic task;
- trusted child continuation can reattach;
- persistence failure → `persistence_failed`;
- recovery uses durable file, not an ephemeral map.

- [ ] **Step 2: Write RED task-brief/identity tests**

Exact tests:
- `task_identity_is_stable_for_checkbox_only_progress`
- `task_identity_changes_for_substantive_task_body_change`
- `valid_task_brief_resolves_one_authorized_task_identity`
- `stale_task_brief_digest_is_untrusted`
- `multiple_or_missing_task_brief_reference_is_untrusted`
- `brief_from_other_plan_workspace_is_untrusted`

- [ ] **Step 3: Run RED tests**

Run: `bun run vitest run tests/core/execution-correlation.test.ts tests/core/superpowers-dispatch-resolver.test.ts`

Expected: FAIL because stores/resolver do not exist.

- [ ] **Step 4: Implement store/resolver using AtomicPersistence and existing plan canonicalization**

No semantic identity goes into OmO args.

- [ ] **Step 5: Run GREEN tests + typecheck**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/execution-correlation.ts src/core/superpowers-dispatch-resolver.ts src/core/types.ts \
  tests/core/execution-correlation.test.ts tests/core/superpowers-dispatch-resolver.test.ts
git commit -m "feat: persist Justice execution correlation"
```

---

### Task 6: Wire OpenCode Hooks to Durable Execution Correlation Without Restoring Orchestration

**Requirements / Design:** JUS5-CORR-02..06, JUS5-SDD-01..04, JUS5-INLINE-01..02, J5D-CORR-02, J5D-OWN-01.

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/core/types.ts` only for hook payload/event types.
- Test: `tests/runtime/opencode-adapter-execution-correlation.test.ts`
- Test: existing adapter child-session relation tests.

**Interfaces:**
- Consumes: `ExecutionCorrelationStore`, `resolveSuperpowersImplementationTask`, active `ApprovedArtifactChain`.
- Produces new/updated observation events with `parentSessionId`, `parentCallId`, optional `childSessionId`, and semantic correlation ID.
- Existing adapter in-memory maps are caches only; recovery authority is the durable `ExecutionCorrelationStore`.

- [ ] **Step 1: Write RED adapter tests**

Exact required tests in `tests/runtime/opencode-adapter-execution-correlation.test.ts`:
- `persists_execution_correlation_before_authorized_task_execution`
- `attaches_child_session_from_post_tool_and_session_observation`
- `conflicting_child_parent_observations_mark_correlation_untrusted`
- `preserves_omo_continuation_session_id_in_task_args`
- `invalid_both_target_routing_is_not_trusted`
- `does_not_create_extra_task_or_reviewer_dispatch`
- `correlation_persistence_failure_proceeds_runtime_but_not_evidence`
- `recovers_task_call_from_durable_parent_session_parent_call_binding`

The recovery test must instantiate a fresh adapter/plugin state with empty ephemeral relation maps and prove semantic resolution from the persisted `parentSessionId + parentCallId` binding.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/runtime/opencode-adapter-execution-correlation.test.ts`

Expected: FAIL on durable binding and `task_id` preservation.

- [ ] **Step 3: Wire the store/resolver into PreToolUse/PostToolUse/session events**

Keep the existing fail-open hook exception boundary. Remove any use of semantic `task_id` as correlation authority.

- [ ] **Step 4: Run GREEN tests + existing adapter suite + typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/opencode-adapter.ts src/core/justice-plugin.ts src/core/types.ts \
  tests/runtime/opencode-adapter-execution-correlation.test.ts
git commit -m "feat: bind OpenCode calls to Justice task identity"
```

---

### Task 7: Implement Versioned Superpowers Review Interop and Strict JusticeReviewResult Parsing

**Requirements / Design:** JUS5-REV-01..09, JUS5-SDD-03, J5D-REVIEW-01..04.

**Files:**
- Create: `src/core/review-interop.ts`
- Create: `src/core/review-result.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/review-interop.test.ts`
- Test: `tests/core/review-result.test.ts`
- Test: `tests/runtime/opencode-adapter-review-interop.test.ts`

**Interfaces:**
- Consumes `TaskIdentity` and `ReviewFindingV5` from Task 2.
- Consumes `ClauseResult` and `ConformanceContract` from Task 4.
- Owns the registry-defined `RecognizedReviewDispatch` and `ParseReviewResult`.
- Produces:
  ```ts
  type ReviewKindV5 = "task-review" | "scoped-re-review" | "final-review";

  type ReviewResultExpectation = {
    readonly reviewCorrelationId: string;
    readonly reviewKind: ReviewKindV5;
    readonly artifactChainId: string;
    readonly taskIdentity?: TaskIdentity;
    readonly contractId: string;
    readonly contractDigest: string;
    readonly reviewedRange: { readonly base: string; readonly head: string };
    readonly requiredClauseIds: readonly string[];
  };

  type JusticeReviewResult = {
    readonly schemaVersion: "justice-review-v1";
    readonly reviewCorrelationId: string;
    readonly reviewKind: ReviewKindV5;
    readonly artifactChainId: string;
    readonly taskIdentity?: TaskIdentity;
    readonly contractId: string;
    readonly contractDigest: string;
    readonly reviewedRange: { readonly base: string; readonly head: string };
    readonly quality: { readonly verdict: "approved" | "needs_fixes"; readonly findings: readonly ReviewFindingV5[] };
    readonly clauses: readonly ClauseResult[];
  };
  ```
- Serialization: exactly one final fenced `justice-review-result-v1` JSON block.
- Exact signatures:
  - `recognizeSuperpowersReviewDispatch(input: ReviewDispatchInput): RecognizedReviewDispatch`
  - `buildJusticeReviewAppendix(input: ReviewAppendixInput): string`
  - `parseJusticeReviewResult(output: string, expected: ReviewResultExpectation): ParseReviewResult`
- Appendix carries a read-only workspace-relative Conformance Contract path + digest and never changes model/provider/subagent/category.

- [ ] **Step 1: Write RED recognition/adapter tests**

Exact required tests:
- `does_not_dispatch_duplicate_reviewer_for_recognized_superpowers_review`
- `injects_conformance_contract_into_same_superpowers_task_review_call`

Also recognize all three v6.4.2 review profiles using multiple markers and concrete brief/review-package/range references. A single keyword is insufficient.

- [ ] **Step 2: Write RED structured-result tests**

Exact required tests:
- `missing_required_clause_result_becomes_not_proven`
- `missing_or_malformed_review_result_is_rejected`

Also cover multiple result blocks, wrong correlation/chain/task, stale base/head, wrong contract digest, and scoped re-review deltas.

- [ ] **Step 3: Run RED tests**

Run: `bun run vitest run tests/core/review-interop.test.ts tests/core/review-result.test.ts tests/runtime/opencode-adapter-review-interop.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement recognition, same-call appendix injection, and strict output parsing**

Use only the existing Superpowers reviewer dispatch. Do not create `sp-review` / `sp-final-review` calls.

- [ ] **Step 5: Re-run Task 1 regression gate plus focused tests**

Expected: PASS and exactly one reviewer call per Superpowers dispatch. Failure of Task 1's established baseline is upstream compatibility drift, not an implementation-time architecture choice.

- [ ] **Step 6: Commit**

```bash
git add src/core/review-interop.ts src/core/review-result.ts src/runtime/opencode-adapter.ts src/core/types.ts \
  tests/core/review-interop.test.ts tests/core/review-result.test.ts tests/runtime/opencode-adapter-review-interop.test.ts
git commit -m "feat: consume Superpowers reviews as Justice evidence"
```

---

### Task 8: Persist Structured Review Evidence and Canonicalize Quality Findings

**Requirements / Design:** JUS5-REV-08..11, JUS5-QUALITY-01..03, JUS5-ACC-03, J5D-QUALITY-01, J5D-STORAGE-01.

**Files:**
- Create: `src/core/review-evidence-store.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/v2/review-types.ts`
- Modify: `src/core/v2/review-aggregator.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/core/review-resolution-artifact.ts`
- Test: `tests/core/review-evidence-store.test.ts`
- Test: `tests/core/review-quality-v5.test.ts`
- Test: `tests/core/v2/review-aggregator.test.ts`
- Test: `tests/core/v2/state-projection-review.test.ts`

**Interfaces:**
- Consumes canonical `ReviewFindingV5` from Task 2 and `JusticeReviewResult` from Task 7; Task 8 does not redefine either.
- v5 evidence path: `.justice/v5/review-evidence.json`.
- Legacy `major` deserializes only through migration as `important`.
- A v5 human review-resolution artifact is bound to `artifactChainId`, review scope, and item keys; it may change quality disposition only and cannot set a conformance clause status.

- [ ] **Step 1: Write RED evidence/quality tests**

Exact required tests:
- `not_addressed_finding_remains_blocking`
- `parked_important_finding_remains_visible_and_blocking`
- `parked_critical_or_important_blocks_until_trusted_disposition`

Also assert:
- Minor is non-blocking for task progression but retained for final review;
- human quality adjudication never changes `VIOLATED/NOT_PROVEN` clauses;
- final review must disposition carried Minor/parked findings;
- legacy major becomes important only on migration;
- directly observed structured output is trusted without native artifact reservation;
- plain file fallback without secure reservation remains untrusted.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/review-evidence-store.test.ts tests/core/review-quality-v5.test.ts tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts`

Expected: FAIL on `major` vocabulary and parked semantics.

- [ ] **Step 3: Implement store, aggregation, and resolution semantics**

Do not remove the Linux native provider; demote it to optional secure file-artifact capability.

- [ ] **Step 4: Run GREEN tests + typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/review-evidence-store.ts src/core/types.ts src/core/v2/review-types.ts src/core/v2/review-aggregator.ts \
  src/core/v2/state-projection.ts src/core/review-resolution-artifact.ts \
  tests/core/review-evidence-store.test.ts tests/core/review-quality-v5.test.ts \
  tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts
git commit -m "feat: persist v5 review and quality evidence"
```

---

### Task 9: Make Conformance and Quality First-Class Acceptance Gates

**Requirements / Design:** JUS5-GATE-01..02, JUS5-CONFORM-01..09, JUS5-ACC-01..04, JUS5-COMPLETE-01, J5D-GATE-01, J5D-COMPLETE-01.

**Files:**
- Create: `src/core/conformance-gate.ts`
- Modify: `src/core/acceptance-decision.ts`
- Modify: `src/core/v2/gate-context.ts`
- Modify: `src/core/v2/decision-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Test: `tests/core/conformance-gate.test.ts`
- Test: existing acceptance-decision tests.
- Test: `tests/core/plan-completion-v5.test.ts`

**Interfaces:**
- Consumes `ApprovedArtifactChain`, `ConformanceContract`, `ClauseResult`, `ExecutionCorrelation`, trusted review evidence, and canonical `ReviewFindingV5`.
- Produces:
  ```ts
  type ConformanceGateVerdict =
    | { readonly verdict: "PASS"; readonly satisfiedClauseIds: readonly string[] }
    | {
        readonly verdict: "BLOCK";
        readonly violated: readonly string[];
        readonly notProven: readonly string[];
        readonly diagnostics: readonly string[];
      };

  function evaluateTaskConformance(input: TaskConformanceInput): ConformanceGateVerdict;
  function evaluatePlanConformance(input: PlanConformanceInput): ConformanceGateVerdict;
  ```
- Completion candidate contains exact candidate HEAD and reviewed range. Any post-review candidate mutation invalidates the review/conformance evidence.
- SDD task acceptance requires trusted task review.
- `executing-plans` does not require a fresh per-task reviewer; semantic clauses that are not otherwise proven remain `NOT_PROVEN` until the final review.

- [ ] **Step 1: Write RED gate tests**

In `tests/core/conformance-gate.test.ts`:
- `worker_success_alone_does_not_accept_task`
- `one_violated_clause_blocks_acceptance`
- `one_not_proven_clause_blocks_acceptance`
- `incomplete_or_invalid_projection_blocks_acceptance`
- `sdd_task_without_trusted_task_review_is_blocked`
- `executing_plans_task_does_not_require_fresh_per_task_reviewer`
- `plan_code_interface_violation_blocks_task_acceptance`
- `passing_tests_do_not_override_plan_contract_violation`
- `ambiguous_execution_correlation_leaves_evidence_not_proven`
- `substantive_ruling_does_not_authorize_acceptance`
- `parked_critical_or_important_quality_finding_blocks_acceptance`

In `tests/core/plan-completion-v5.test.ts`:
- `post_review_head_change_invalidates_completion_evidence`
- `final_review_can_prove_inline_semantic_clauses`
- `zero_drift_zero_missing_evidence_zero_blocking_quality_allows_completion`

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/conformance-gate.test.ts tests/core/plan-completion-v5.test.ts`

Expected: FAIL because current acceptance has no v5 conformance contract.

- [ ] **Step 3: Implement conformance gate and wire it into acceptance decisions**

Keep runtime hook behavior fail-open; only acceptance projections fail closed.

- [ ] **Step 4: Run GREEN focused suite + typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/conformance-gate.ts src/core/acceptance-decision.ts src/core/v2/gate-context.ts \
  src/core/v2/decision-model.ts src/core/v2/state-projection.ts \
  tests/core/conformance-gate.test.ts tests/core/plan-completion-v5.test.ts
git commit -m "feat: gate acceptance on v5 conformance"
```

---

### Task 10: Remove Justice Review/Task Scheduling Authority and Preserve Superpowers Task Semantics

**Requirements / Design:** JUS5-SDD-01..04, JUS5-DEP-01..03, JUS5-TASK-01..04, JUS5-PLAN-01..05, J5D-OWN-01, J5D-TASK-01, J5D-DEP-01.

**Files:**
- Modify: `src/core/review-dispatch-state.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/core/plan-bridge-core.ts`
- Modify: `src/core/dependency-analyzer.ts`
- Modify: `src/core/plan-completion-detector.ts`
- Modify: `src/core/execution-role-classifier.ts`
- Test: existing review-dispatch / plan-bridge / dependency tests.
- Create: `tests/core/superpowers-ownership-v5.test.ts`
- Create: `tests/core/plan-completion-detector-v5.test.ts`

**Interfaces:**
- `review-dispatch-state.ts` remains only for recognizing/migrating historical v4 review-dispatch records; it no longer emits current reviewer directives.
- `DependencyAnalyzer` exposes advisory diagnostics only:
  `analyzeDependencies(tasks) -> DependencyDiagnostic[]`; active execution-order/parallel-dispatch callers are removed.
- `PlanBridge` no longer reconstructs worker prompts from title + checkbox steps for v5 Superpowers execution.
- `PlanCompletionDetector` recognizes current artifact paths/contracts:
  - Plan completion artifact: `docs/superpowers/plans/YYYY-MM-DD-*.md`
  - Design artifact: `docs/superpowers/specs/YYYY-MM-DD-*-design.md`
  and removes obsolete reviewer-persona markers as authority.
- `ExecutionRoleClassifier` consumes full task semantic text/parsed task structure, not only checkbox descriptions.

- [ ] **Step 1: Write RED ownership tests**

Assert:
- implementation completion never causes Justice to dispatch `sp-review`.
- all tasks accepted never causes Justice to dispatch `sp-final-review`.
- dependency analyzer cannot reorder/dispatch implementation tasks.
- PlanBridge preserves the original Superpowers task brief instead of rebuilding a lossy prompt.
- Files/Interfaces/signatures affect role classification.
- current Plan artifact path is recognized; a Design path alone does not count as writing-plans completion.
- obsolete `code-quality-reviewer/spec-reviewer` markers do not determine v5 workflow state.

- [ ] **Step 2: Run RED tests**

Expected: FAIL on existing v4 review-dispatch and prompt reconstruction behavior.

- [ ] **Step 3: Remove active scheduling authority while retaining historical parsing/migration support**

Do not delete data types needed to read v4 state.

- [ ] **Step 4: Run GREEN tests + full core suite**

Run:
- focused tests
- `bun run test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/review-dispatch-state.ts src/core/justice-plugin.ts src/hooks/plan-bridge.ts src/core/plan-bridge-core.ts src/core/dependency-analyzer.ts src/core/plan-completion-detector.ts src/core/execution-role-classifier.ts tests/core/superpowers-ownership-v5.test.ts tests/core/plan-completion-detector-v5.test.ts
git commit -m "refactor: return workflow orchestration to Superpowers"
```

---

### Task 11: Implement OmO v5 Effective Configuration and Capability-First Doctor

**Requirements / Design:** JUS5-COMP-01..04, JUS5-CONFIG-01..05, JUS5-DOC-01..04, J5D-CONFIG-01, J5D-DOCTOR-01.

**Files:**
- Create: `src/core/omo-effective-config.ts`
- Modify: `src/core/doctor-config.ts`
- Modify: `src/core/doctor-categories.ts`
- Modify: `src/core/controller-routing.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Modify: `src/runtime/doctor-cli-helpers.ts`
- Test: `tests/core/omo-effective-config.test.ts`
- Test: existing doctor-config/controller-routing/doctor-cli tests.
- Create: `tests/runtime/doctor-v5.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type OmoConfigSource = {
    readonly path: string;
    readonly layer: "user" | "project";
    readonly precedence: number;
    readonly format: "jsonc" | "json";
  };

  type OmoEffectiveConfigResult =
    | {
        readonly kind: "resolved";
        readonly sources: readonly OmoConfigSource[];
        readonly profile?: string;
        readonly config: Readonly<Record<string, unknown>>;
        readonly diagnostics: readonly string[];
      }
    | { readonly kind: "unsupported"; readonly reason: string; readonly diagnostics: readonly string[] };
  ```
- `resolveOmoEffectiveConfig({ cwd, homeDir, env, readFile, fileExists }): OmoEffectiveConfigResult | Promise<OmoEffectiveConfigResult>`.
- Doctor capability result reports OpenCode version metadata, required hook/call capabilities, review-interop support, child-session relation observability, secure review-artifact capability, and configured/applied/observed controller status separately.
- Remove exact `SUPPORTED_OPENCODE_VERSION === "1.18.29"` authority. Version is metadata; capabilities are authority.

- [ ] **Step 1: Write RED effective-config tests**

In `tests/core/omo-effective-config.test.ts` include:
- `resolves_user_project_harness_profile_precedence`
- `jsonc_wins_over_same_layer_json_fallback`
- `home_directory_is_not_double_counted_as_project_layer`
- `invalid_source_produces_diagnostic_not_fabricated_config`

The precedence test must cover user → farthest ancestor → nearest project, shared base → `[opencode]` → selected profile base → selected profile `[opencode]`, and profile source order explicit → `OMO_PROFILE` → `OCX_PROFILE` → OpenCode profile-directory inference.

- [ ] **Step 2: Write RED doctor capability tests**

In `tests/runtime/doctor-v5.test.ts`:
- `compatible_patch_with_required_capabilities_is_supported`
- `missing_required_host_capability_is_reported_unsupported`
- `doctor_separates_source_configured_applied_and_observed_values`
- `secure_artifact_and_review_interop_capabilities_are_independent`

- [ ] **Step 3: Run RED tests**

Run: `bun run vitest run tests/core/omo-effective-config.test.ts tests/runtime/doctor-v5.test.ts`

Expected: FAIL on exact 1.18.29 gate and single-file assumptions.

- [ ] **Step 4: Implement effective config resolver + doctor capability model**

Prefer an OmO effective-config API if a compatible public API is available; otherwise use the exact resolver above. Do not silently switch semantics.

- [ ] **Step 5: Run GREEN tests + build**

Run:
- `bun run vitest run tests/core/omo-effective-config.test.ts tests/runtime/doctor-v5.test.ts`
- `bun run typecheck`
- `bun run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/omo-effective-config.ts src/core/doctor-config.ts src/core/doctor-categories.ts \
  src/core/controller-routing.ts src/runtime/doctor-cli.ts src/runtime/doctor-cli-helpers.ts \
  tests/core/omo-effective-config.test.ts tests/runtime/doctor-v5.test.ts
git commit -m "feat: diagnose OmO v5 effective configuration"
```

---

### Task 12: Synchronize Remaining OmO v5 Mechanical Drift Without Taking Runtime Ownership

**Requirements / Design:** JUS5-CAT-01..04, JUS5-CTRL-01..03, JUS5-ERR-01..03, J5D-CAT-01, J5D-RUNTIME-01.

**Files:**
- Modify: `src/core/provider-error-patterns.ts`
- Modify: `src/core/error-classifier.ts`
- Modify: `src/core/workflow-router.ts`
- Modify: `src/core/controller-routing.ts`
- Modify: `src/core/types.ts`
- Test: existing error-classifier/provider-pattern tests.
- Create: `tests/core/omo-v5-upstream-drift.test.ts`

**Interfaces:**
- Provider classification is terminal-diagnostic only; `ErrorClassifier.shouldRetry()` must not initiate provider retry/fallback for provider classes.
- Current OmO v5 provider signals include quota/usage/capacity, 429/503/529, temporarily unavailable, model not supported, credential exhaustion, plus current Japanese/Chinese upstream patterns captured from the audited v5 model-core baseline.
- Provider config remediation points to `omo.jsonc` / effective config, never `oh-my-opencode.jsonc`.
- Desired controller mapping remains configuration expectation only. Actual applied/observed controller is never inferred from the map; unsupported/unverified remains explicit.

- [ ] **Step 1: Write RED upstream-drift tests**

Cover:
- current OmO v5 retryable/config terminal patterns.
- stale `oh-my-opencode.jsonc` remediation absent.
- provider failure classification does not cause Justice provider fallback.
- desired/configured/applied/observed controller states do not collapse.
- current category union has no canonical `deep`.

- [ ] **Step 2: Run RED tests**

Expected: FAIL on stale pattern baseline/config message.

- [ ] **Step 3: Update patterns/messages/controller semantics only**

Do not implement OmO retry/fallback.

- [ ] **Step 4: Run GREEN tests + typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/provider-error-patterns.ts src/core/error-classifier.ts src/core/workflow-router.ts src/core/controller-routing.ts src/core/types.ts tests/core/omo-v5-upstream-drift.test.ts
git commit -m "chore: synchronize Justice with OmO v5 contracts"
```

---

### Task 13: Implement v5 Recovery Diagnostics and Turn justice_review into a Control-Plane View

**Requirements / Design:** JUS5-STATE-01..04, JUS5-REC-01..03, JUS5-PERSIST-01..05, JUS5-REVIEW-01, J5D-PERSIST-01, J5D-REC-01.

**Files:**
- Modify: `src/runtime/justice-tools.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/core/v5-persistence.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Test: `tests/runtime/justice-review-v5.test.ts`
- Test: `tests/core/v5-recovery.test.ts`

**Interfaces:**
- Consumes canonical `TaskIdentity`, `ProjectionStatus`, `ExecutionCorrelation`, review evidence, and acceptance state.
- `justice_review` read result includes:
  ```ts
  type JusticeReviewV5View = {
    readonly artifactChain: {
      readonly chainId?: string;
      readonly status: "AUTHORIZED" | "STALE" | "UNAVAILABLE";
    };
    readonly projection: {
      readonly status: ProjectionStatus;
      readonly diagnostics: readonly string[];
    };
    readonly tasks: readonly {
      readonly taskIdentity: TaskIdentity;
      readonly acceptance: string;
      readonly missingEvidence: readonly string[];
      readonly drift: readonly string[];
      readonly blockingFindings: readonly string[];
    }[];
    readonly planCompletion: {
      readonly status: "BLOCKED" | "READY" | "COMPLETE";
      readonly reasons: readonly string[];
    };
    readonly recoveryDiagnostics: readonly string[];
  };
  ```
- Human `resolve` remains quality-resolution only and cannot manufacture clause satisfaction.
- Recovery loads v5 chain/correlation/evidence stores, then classifies v4/unknown state and reports conflicts.
- Superpowers ledger disagreement is surfaced, never silently overwritten.

- [ ] **Step 1: Write RED recovery/view tests**

In `tests/core/v5-recovery.test.ts`:
- `recovers_plan_task_review_correlation_after_restart`
- `does_not_recorrelate_completed_work_to_different_plan_after_recovery`
- `surfaces_superpowers_justice_state_conflict`
- `v4_review_dispatch_state_does_not_resume_or_satisfy_v5_review_gate`
- `unknown_newer_schema_is_preserved_and_acceptance_fails_closed`
- `v4_raw_observation_cannot_satisfy_v5_acceptance`

In `tests/runtime/justice-review-v5.test.ts`:
- `justice_review_explains_missing_evidence_drift_and_blocking_findings`
- `human_quality_resolution_does_not_change_conformance_clause_status`

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/v5-recovery.test.ts tests/runtime/justice-review-v5.test.ts`

Expected: FAIL on current review-summary-only view and v4 authority assumptions.

- [ ] **Step 3: Implement recovery orchestration and v5 control-plane view**

Do not mutate Superpowers ledger.

- [ ] **Step 4: Run GREEN tests + full runtime suite**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/justice-tools.ts src/core/justice-plugin.ts src/core/v5-persistence.ts \
  src/core/v2/state-projection.ts src/runtime/doctor-cli.ts \
  tests/runtime/justice-review-v5.test.ts tests/core/v5-recovery.test.ts
git commit -m "feat: expose Justice v5 recovery and gate state"
```

---

### Task 14: Close Cross-Component E2E Coverage and Synchronize User/Upstream Documentation

**Requirements / Design:** all JUS5/J5D contracts; Design §29 required verification scenarios.

**Files:**
- Create: `tests/integration/justice-v5-semantic-control-plane.integration.test.ts`
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `docs/agents/upstream-drift.md`
- Modify: `docs/reports/upstream-compatibility-audit.md`
- Modify: other documentation only when it contains a directly stale OmO/Superpowers contract.
- No release-version edit.

**Interfaces:**
- Consumes every interface produced by Tasks 2–13.
- Produces end-to-end evidence from `ApprovedArtifactChain` through execution/review evidence to `PlanComplete`.
- Produces current documented stack:
  - OmO v5 OpenCode edition;
  - Superpowers v6.4.2;
  - capability-first OpenCode support;
  - effective `omo.jsonc` configuration;
  - Superpowers owns orchestration;
  - Justice owns semantic evidence/conformance/acceptance.

- [ ] **Step 1: Write the missing cross-component E2E cases**

In `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` implement exactly:
- `sdd_task_reaches_acceptance_through_existing_superpowers_review`
- `scoped_re_review_resolves_blocking_finding_and_allows_acceptance`
- `executing_plans_requires_final_review_and_final_conformance`
- `implementation_discovered_design_change_requires_reconciliation_before_resume`
- `complete_evidence_allows_plan_complete`

Do not duplicate focused tests whose exact evidence is already named in the traceability table.

- [ ] **Step 2: Run the E2E file and verify RED for uncovered cross-component behavior**

Run: `bun run vitest run tests/integration/justice-v5-semantic-control-plane.integration.test.ts`

Expected: remaining cross-component behavior fails explicitly until wiring is complete.

- [ ] **Step 3: Make only the smallest integration/wiring changes required by those exact E2E cases**

If a fix changes an architecture contract rather than wiring, STOP and return to artifact reconciliation instead of ruling around the Design.

- [ ] **Step 4: Update user/upstream documentation**

Required corrections:
- Superpowers upstream: `obra/superpowers`.
- OmO upstream: `code-yeongyu/oh-my-openagent`.
- current OmO config: effective `omo.jsonc` system.
- remove Justice-owned review scheduling language.
- explain `justice_review` as evidence/gate inspection.
- record audited baselines and exact tags/SHAs in compatibility audit.
- explain v4 persistent-state authority migration.
- record the verified OpenCode 1.18.31 review-interop baseline evidence from Design §14.2.
- do not claim OmO Native support.

- [ ] **Step 5: Run Task 14 verification before committing**

```bash
bun run typecheck
bun run lint
bun run test
bun run test:integration
bun run build
git diff --check
```

Expected: all PASS and no new warnings attributable to v5.

- [ ] **Step 6: Commit every Task 14 tracked change**

```bash
git add tests/integration/justice-v5-semantic-control-plane.integration.test.ts \
  README.md SPEC.md docs/agents/upstream-drift.md docs/reports/upstream-compatibility-audit.md
git commit -m "docs: complete Justice v5 compatibility migration"
```

If Step 3 required a directly related tracked wiring file, it MUST be explicitly added to Task 14's Files block by artifact reconciliation before implementation; the worker must not silently expand the commit scope.

- [ ] **Step 7: Confirm committed candidate state**

Run:
```bash
test -z "$(git status --porcelain)"
git rev-parse HEAD
```

Expected: clean working tree and one recorded `CANDIDATE_HEAD`. Task 14 ends here. The implementer does not dispatch the final whole-branch reviewer.

---

## Controller-Owned Finalization After Task 14

This phase belongs to the Superpowers controller, not the Task 14 implementer.

1. Record:
   ```bash
   MERGE_BASE=$(git merge-base master HEAD)
   CANDIDATE_HEAD=$(git rev-parse HEAD)
   test -z "$(git status --porcelain)"
   ```
2. Run final verification against that clean committed `CANDIDATE_HEAD`:
   ```bash
   bun run typecheck
   bun run lint
   bun run test
   bun run test:integration
   bun run build
   git diff --check "$MERGE_BASE..$CANDIDATE_HEAD"
   test "$(git rev-parse HEAD)" = "$CANDIDATE_HEAD"
   test -z "$(git status --porcelain)"
   ```
3. Dispatch the Superpowers final whole-branch reviewer for exactly `MERGE_BASE..CANDIDATE_HEAD`.
4. Run the Justice Final Conformance Gate against the same `CANDIDATE_HEAD`.
5. After both gates pass, **do not modify or commit any tracked file** before completion/branch finishing.
6. If the final review or Final Conformance Gate produces a finding that requires a fix:
   - make the fix through the normal Superpowers fix flow;
   - commit the fix;
   - record a new `CANDIDATE_HEAD`;
   - rerun final verification;
   - rerun the full final whole-branch review;
   - rerun the Final Conformance Gate from scratch against the new exact HEAD.

No review or conformance evidence from an older candidate HEAD is reusable as final completion evidence.

---

## Contract Traceability## Contract Traceability

### Requirements → Task mapping

| Requirement IDs | Owning task(s) |
|---|---|
| JUS5-COMP-01, JUS5-COMP-02, JUS5-COMP-03, JUS5-COMP-04 | Tasks 1, 11 |
| JUS5-HARNESS-01, JUS5-HARNESS-02 | Tasks 1, 6, 11 |
| JUS5-OWN-01, JUS5-OWN-02, JUS5-OWN-03 | Tasks 6, 10, 12 |
| JUS5-GATE-01, JUS5-GATE-02 | Task 9 |
| JUS5-CONFIG-01, JUS5-CONFIG-02, JUS5-CONFIG-03, JUS5-CONFIG-04, JUS5-CONFIG-05 | Task 11 |
| JUS5-CAT-01, JUS5-CAT-02, JUS5-CAT-03, JUS5-CAT-04 | Tasks 2, 12 |
| JUS5-CTRL-01, JUS5-CTRL-02, JUS5-CTRL-03 | Tasks 11, 12 |
| JUS5-PLAN-01, JUS5-PLAN-02, JUS5-PLAN-03, JUS5-PLAN-04, JUS5-PLAN-05 | Tasks 4, 10 |
| JUS5-AUTH-01, JUS5-AUTH-02, JUS5-AUTH-03, JUS5-AUTH-04, JUS5-AUTH-05, JUS5-AUTH-06, JUS5-AUTH-07, JUS5-AUTH-08, JUS5-AUTH-09 | Tasks 3, 9 |
| JUS5-SDD-01, JUS5-SDD-02, JUS5-SDD-03, JUS5-SDD-04 | Tasks 6, 7, 10 |
| JUS5-INLINE-01, JUS5-INLINE-02 | Tasks 9, 10 |
| JUS5-TASK-01, JUS5-TASK-02, JUS5-TASK-03, JUS5-TASK-04 | Tasks 2, 5, 10 |
| JUS5-CORR-01, JUS5-CORR-02, JUS5-CORR-03, JUS5-CORR-04, JUS5-CORR-05, JUS5-CORR-06 | Tasks 2, 5, 6 |
| JUS5-STATE-01, JUS5-STATE-02, JUS5-STATE-03, JUS5-STATE-04 | Tasks 3, 5, 8, 13 |
| JUS5-REV-01, JUS5-REV-02, JUS5-REV-03, JUS5-REV-04, JUS5-REV-05, JUS5-REV-06, JUS5-REV-07, JUS5-REV-08, JUS5-REV-09, JUS5-REV-10, JUS5-REV-11 | Tasks 1, 7, 8 |
| JUS5-CONFORM-01, JUS5-CONFORM-02, JUS5-CONFORM-03, JUS5-CONFORM-04, JUS5-CONFORM-05, JUS5-CONFORM-06, JUS5-CONFORM-07, JUS5-CONFORM-08, JUS5-CONFORM-09 | Tasks 4, 9 |
| JUS5-PROJ-01, JUS5-PROJ-02, JUS5-PROJ-03 | Task 4 |
| JUS5-QUALITY-01, JUS5-QUALITY-02, JUS5-QUALITY-03 | Tasks 8, 9 |
| JUS5-ACC-01, JUS5-ACC-02, JUS5-ACC-03, JUS5-ACC-04 | Tasks 8, 9 |
| JUS5-COMPLETE-01 | Tasks 9, 14 |
| JUS5-DEP-01, JUS5-DEP-02, JUS5-DEP-03 | Task 10 |
| JUS5-ERR-01, JUS5-ERR-02, JUS5-ERR-03 | Task 12 |
| JUS5-DOC-01, JUS5-DOC-02, JUS5-DOC-03, JUS5-DOC-04 | Tasks 11, 13 |
| JUS5-REC-01, JUS5-REC-02, JUS5-REC-03 | Tasks 5, 13 |
| JUS5-PERSIST-01, JUS5-PERSIST-02, JUS5-PERSIST-03, JUS5-PERSIST-04, JUS5-PERSIST-05 | Tasks 3, 13 |
| JUS5-REVIEW-01 | Task 13 |

### Design Contract → Task mapping

| Design contract | Owning task(s) |
|---|---|
| INV-01, J5D-OWN-01 | Tasks 6, 10 |
| INV-02, J5D-OWN-02, J5D-RUNTIME-01 | Tasks 2, 12 |
| INV-03, J5D-GATE-01 | Task 9 |
| INV-04 | Tasks 5–9, 13 |
| INV-05, INV-06, J5D-COMPLETE-01 | Tasks 3, 4, 9, 14 |
| J5D-TASK-01 | Tasks 5, 10 |
| J5D-CHAIN-01, J5D-CHAIN-02, J5D-RULING-01 | Tasks 3, 9 |
| J5D-CORR-01, J5D-CORR-02, J5D-ROUTE-01 | Tasks 2, 5, 6 |
| J5D-PROJ-01, J5D-PROJ-02, J5D-PROJ-03 | Task 4 |
| J5D-REVIEW-01, J5D-REVIEW-02, J5D-REVIEW-03, J5D-REVIEW-04 | Tasks 1, 7 |
| J5D-QUALITY-01, J5D-STORAGE-01 | Task 8 |
| J5D-CONFIG-01, J5D-DOCTOR-01 | Task 11 |
| J5D-PERSIST-01, J5D-REC-01 | Task 13 |
| J5D-CAT-01 | Tasks 2, 12 |
| J5D-DEP-01 | Task 10 |


## Required Verification Scenario Traceability

The numbering below is Design §29. Every row fixes the owning task, exact test file, exact test name, and evidence level. A scenario is incomplete until that named test asserts the listed behavior.

| # | Required scenario | Task | Exact test file | Exact test name | Type |
|---:|---|---:|---|---|---|
| 1 | checkbox-only Plan updates preserve authorization | 3 | `tests/core/artifact-chain.test.ts` | `preserves_authorization_for_checkbox_only_plan_progress` | unit |
| 2 | interface/signature/assertion/global-constraint changes invalidate authorization | 3 | `tests/core/artifact-chain.test.ts` | `invalidates_chain_when_plan_contract_changes` | unit |
| 3 | substantive Design change invalidates downstream Plan authority | 3 | `tests/core/artifact-chain.test.ts` | `design_change_stales_bound_plan_authority` | unit |
| 4 | new human approval establishes new authorization lineage | 3 | `tests/core/artifact-chain.test.ts` | `reapproval_creates_new_artifact_chain_id` | unit |
| 5 | implementation → Superpowers task review → Justice evidence → acceptance | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `sdd_task_reaches_acceptance_through_existing_superpowers_review` | E2E |
| 6 | Justice does not duplicate-dispatch reviewer | 7 | `tests/runtime/opencode-adapter-review-interop.test.ts` | `does_not_dispatch_duplicate_reviewer_for_recognized_superpowers_review` | integration |
| 7 | Needs fixes → fix → scoped re-review → ADDRESSED → acceptance | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `scoped_re_review_resolves_blocking_finding_and_allows_acceptance` | E2E |
| 8 | NOT ADDRESSED remains blocking | 8 | `tests/core/review-quality-v5.test.ts` | `not_addressed_finding_remains_blocking` | unit |
| 9 | round-cap/deferred findings remain visible | 8 | `tests/core/review-quality-v5.test.ts` | `parked_important_finding_remains_visible_and_blocking` | unit |
| 10 | executing-plans lacks per-task reviewer without failure | 9 | `tests/core/conformance-gate.test.ts` | `executing_plans_task_does_not_require_fresh_per_task_reviewer` | unit |
| 11 | inline final review/conformance still enforced | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `executing_plans_requires_final_review_and_final_conformance` | E2E |
| 12 | Plan interface differs from code → task block | 9 | `tests/core/conformance-gate.test.ts` | `plan_code_interface_violation_blocks_task_acceptance` | unit |
| 13 | Design invariant differs from Plan → downstream authorization block | 3 | `tests/core/artifact-chain.test.ts` | `design_plan_mismatch_stales_downstream_authority` | unit |
| 14 | implementation-discovered Design change requires reconciliation before resume | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `implementation_discovered_design_change_requires_reconciliation_before_resume` | E2E |
| 15 | code works/tests pass but violates Plan → acceptance blocked | 9 | `tests/core/conformance-gate.test.ts` | `passing_tests_do_not_override_plan_contract_violation` | unit |
| 16 | reviewer omits required normative clause → NOT_PROVEN | 7 | `tests/core/review-result.test.ts` | `missing_required_clause_result_becomes_not_proven` | unit |
| 17 | final review approves old revision, code changes afterward → completion blocked | 9 | `tests/core/plan-completion-v5.test.ts` | `post_review_head_change_invalidates_completion_evidence` | unit |
| 18 | all clauses SATISFIED, no blocking quality → completion permitted | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `complete_evidence_allows_plan_complete` | E2E |
| 19 | Justice does not emit canonical `deep` | 2 | `tests/core/omo-category-mapper-v5.test.ts` | `does_not_emit_legacy_deep` | unit |
| 20 | custom `sp-*` coexist with OmO v5 routing | 2 | `tests/core/omo-category-mapper-v5.test.ts` | `custom_sp_categories_coexist_with_omo_v5_categories` | unit |
| 21 | Justice does not directly select model/provider | 2 | `tests/core/v5-task-routing-contract.test.ts` | `justice_does_not_select_model_or_provider` | unit |
| 22 | compatible OpenCode patch not rejected solely by version | 11 | `tests/runtime/doctor-v5.test.ts` | `compatible_patch_with_required_capabilities_is_supported` | integration |
| 23 | missing required host capability reported accurately | 11 | `tests/runtime/doctor-v5.test.ts` | `missing_required_host_capability_is_reported_unsupported` | integration |
| 24 | compaction/restart retains plan/task/review correlation | 13 | `tests/core/v5-recovery.test.ts` | `recovers_plan_task_review_correlation_after_restart` | integration |
| 25 | completed work not re-correlated to another Plan after recovery | 13 | `tests/core/v5-recovery.test.ts` | `does_not_recorrelate_completed_work_to_different_plan_after_recovery` | integration |
| 26 | Justice/Superpowers state conflict surfaced | 13 | `tests/core/v5-recovery.test.ts` | `surfaces_superpowers_justice_state_conflict` | integration |
| 27 | OmO `task_id=ses_...` preserved, never replaced with TaskIdentity | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_omo_continuation_task_id` | unit |
| 28 | task call recoverably correlated by durable parent-session/parent-call sidecar | 6 | `tests/runtime/opencode-adapter-execution-correlation.test.ts` | `recovers_task_call_from_durable_parent_session_parent_call_binding` | integration |
| 29 | `category + subagent_type` not silently resolved by Justice | 2 | `tests/core/v5-task-routing-contract.test.ts` | `reports_category_subagent_type_as_invalid_both` | unit |
| 30 | missing/ambiguous execution correlation leaves evidence NOT_PROVEN | 9 | `tests/core/conformance-gate.test.ts` | `ambiguous_execution_correlation_leaves_evidence_not_proven` | unit |
| 31 | Requirements change stales Design + Plan chain | 3 | `tests/core/artifact-chain.test.ts` | `requirements_change_stales_design_and_plan_authority` | unit |
| 32 | substantive Ruling can continue execution but cannot authorize acceptance | 9 | `tests/core/conformance-gate.test.ts` | `substantive_ruling_does_not_authorize_acceptance` | unit |
| 33 | duplicate/missing/ambiguous projection becomes INCOMPLETE/INVALID | 4 | `tests/core/conformance-projector.test.ts` | `projection_failures_never_return_complete` | unit |
| 34 | v6.4.2 task reviewer gets Conformance Contract through same dispatch | 7 | `tests/runtime/opencode-adapter-review-interop.test.ts` | `injects_conformance_contract_into_same_superpowers_task_review_call` | integration |
| 35 | missing/malformed structured review result blocks | 7 | `tests/core/review-result.test.ts` | `missing_or_malformed_review_result_is_rejected` | unit |
| 36 | parked Important/Critical blocks until trusted disposition/human quality adjudication | 8 | `tests/core/review-quality-v5.test.ts` | `parked_critical_or_important_blocks_until_trusted_disposition` | unit |
| 37 | effective config honors user/project + harness/profile precedence | 11 | `tests/core/omo-effective-config.test.ts` | `resolves_user_project_harness_profile_precedence` | unit |
| 38 | v4 plan-only authorization not auto-promoted | 3 | `tests/core/v5-persistence.test.ts` | `v4_plan_authorization_is_not_promoted_to_v5_authority` | unit |
| 39 | v4 review-dispatch state cannot resume/satisfy v5 gate | 13 | `tests/core/v5-recovery.test.ts` | `v4_review_dispatch_state_does_not_resume_or_satisfy_v5_review_gate` | integration |
| 40 | unknown/newer persistence preserved and acceptance fail-closed | 13 | `tests/core/v5-recovery.test.ts` | `unknown_newer_schema_is_preserved_and_acceptance_fails_closed` | integration |

---

## Interface Dependency Scan for Execution Pre-Flight

The executor must record these rows in the Superpowers ledger before Task 1:

| Producer | Consumer | Contract to compare |
|---|---|---|
| Task 2 | Tasks 5–12 | `TaskIdentity`, `ReviewFindingV5`, `TaskCategory`, `TaskRoutingTarget` |
| Task 3 | Tasks 4–14 | `ApprovedArtifactChain`, `ApprovedPlanBinding.artifactChain`, `ApprovePlanInput` |
| Task 4 | Tasks 7–9, 13–14 | `ProjectionDiagnostic`, `ProjectionResult<T>`, `ClauseResult`, `ConformanceContract` |
| Task 5 | Tasks 6–9, 13 | `TaskIdentityResolution`, `CorrelationMutationResult`, `ExecutionCorrelation`, `ExecutionCorrelationKey` |
| Task 6 | Task 7 | durable parent-call/child-session observation available to `RecognizedReviewDispatch` |
| Task 7 | Tasks 8–9, 13 | `RecognizedReviewDispatch`, `JusticeReviewResult`, `ParseReviewResult`, reviewed range/contract digest |
| Task 8 | Tasks 9, 13 | `ReviewFindingV5` disposition semantics and trusted persisted review evidence |
| Task 9 | Tasks 13–14 | `ConformanceGateVerdict`, task/plan acceptance reasons, exact candidate revision |
| Task 11 | Tasks 12–14 | `OmoEffectiveConfigResult`, configured/applied/observed doctor vocabulary |
| Task 13 | Task 14 | `JusticeReviewV5View`, recovery diagnostics, completion projection |

Any mismatch is a Plan defect. Under the Justice v5 spec, a Ruling may record the conflict but MUST NOT silently change a normative interface; return to artifact reconciliation if the mismatch changes the Design contract.

---

## Plan Self-Review Checklist

Before this Plan is approved for execution, the Superpowers Review Gate must verify:

1. **Requirements → Design → Plan coverage**
   - every JUS5 requirement family maps to at least one task above;
   - every J5D registry contract maps to at least one task above.
2. **40 scenarios**
   - every Design §29 scenario has an owning task/test in the traceability table.
3. **Type/signature consistency**
   - `ApprovedArtifactChain`, `TaskIdentity`, `ExecutionCorrelation`, `ConformanceContract`, `JusticeReviewResult`, and severity vocabulary are spelled identically at every producer/consumer boundary.
4. **Ownership**
   - no task adds Justice-owned task/review/fix scheduling;
   - no task adds model/provider/retry/fallback ownership.
5. **TDD**
   - production behavior changes have RED then GREEN steps;
   - Task 1 is a regression gate for the pre-established baseline; failure is upstream compatibility drift, not architecture discovery.
6. **Persistence**
   - v4 state is recognized without becoming v5 authority;
   - unknown/newer state is preserved and blocks affected acceptance.
7. **Final review revision**
   - final review and Final Conformance Gate must cover the exact candidate HEAD.
8. **Proportion**
   - bodies/algorithms are not pre-written; the plan fixes interfaces, assertions, commands, and architecture decisions only.
