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
- Test: `tests/core/task-packager.test.ts` or create `tests/core/v5-task-routing-contract.test.ts`
- Test: existing category-mapper/type tests or create `tests/core/omo-category-mapper-v5.test.ts`

**Interfaces:**
- Produces:
  - `TaskCategory = "visual-engineering" | "ultrabrain" | "deep-low" | "deep-high" | "artistry" | "quick" | "unspecified-low" | "unspecified-high" | "writing"`
  - `TaskIdentity` as an internal semantic identity type with no wire `task_id` alias.
  - `TaskRoutingTarget`:
    ```ts
    type TaskRoutingTarget =
      | { readonly kind: "category"; readonly category: SpCategory | TaskCategory }
      | { readonly kind: "subagent"; readonly subagentType: string }
      | { readonly kind: "continuation"; readonly taskId: string }
      | { readonly kind: "unrouted" }
      | { readonly kind: "invalid_both"; readonly category: string; readonly subagentType: string };
    ```
  - `inspectTaskRoutingTarget(input: Readonly<Record<string, unknown>>) -> TaskRoutingTarget`
- Changes:
  - `normalizeTaskToolInput(InPlace)` preserves legitimate OmO `task_id`.
  - `enrichTaskToolInput` no longer writes a Justice semantic ID into `task_id`.
- Consumes: none.

- [ ] **Step 1: Write RED routing-contract tests**

Test names/assertions:

- `preserves_omo_continuation_task_id`: `ses_123` survives normalization unchanged.
- `never_serializes_justice_task_identity_as_task_id`: semantic `task-1` is absent from normalized OmO args.
- `reports_category_subagent_type_as_invalid_both`: no Justice-side tie-break.
- `preserves_explicit_subagent_type_without_category_injection`.
- `preserves_explicit_category_without_subagent_type_injection`.
- `does_not_inject_category_into_continuation`.
- `does_not_emit_legacy_deep`.
- `recognizes_deep_low_deep_high_artistry`.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts`

Expected: FAIL on legacy `deep`, semantic `task_id` enrichment, and missing target inspection.

- [ ] **Step 3: Implement the exact types and normalization boundary**

Do not select model/provider/reasoning/fallback. Do not normalize an invalid both-target call into a trusted routing decision.

- [ ] **Step 4: Run GREEN tests and typecheck**

Run:
- `bun run vitest run tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts`
- `bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/task-packager.ts src/core/omo-category-mapper.ts tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts
git commit -m "refactor: separate Justice identity from OmO task routing"
```

---

### Task 3: Implement ApprovedArtifactChain Authorization and Non-Promoting v4 Authorization Migration

**Requirements / Design:** JUS5-AUTH-01..09, JUS5-PERSIST-01..05, J5D-CHAIN-01..02, J5D-RULING-01, J5D-PERSIST-01.

**Files:**
- Create: `src/core/artifact-chain.ts`
- Modify: `src/core/plan-authorization.ts`
- Create: `src/core/v5-persistence.ts`
- Test: create `tests/core/artifact-chain.test.ts`
- Test: modify/create authorization tests under `tests/core/plan-authorization*.test.ts`
- Test: create `tests/core/v5-persistence.test.ts`

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
  ```
- Evolves `ApprovedPlanBinding` to contain one `artifactChain: ApprovedArtifactChain` instead of duplicated plan-only authority fields.
- Changes `ApprovePlanInput` to:
  ```ts
  type ApprovePlanInput = {
    readonly sessionId: string;
    readonly artifactChain: ApprovedArtifactChain;
  };
  ```
- v5 authoritative authorization file: `.justice/v5/authorizations.json`.
- v4 `.justice/authorizations.json` remains untouched/historical.
- Produces `classifyPriorJusticeState(raw) -> PriorStateClassification` for `justice-plan-v1`, PersistedEnvelope v1, ReviewSnapshot v1, and legacy human review resolutions.

- [ ] **Step 1: Write RED artifact-chain and migration tests**

Cover:
- checkbox-only Plan snapshot progress does not change semantic Plan fingerprint.
- Plan interface/signature/assertion/global-constraint change invalidates the chain.
- Requirements fingerprint change stales Design + Plan.
- Design fingerprint change stales Plan.
- new explicit approval creates a new `chainId`.
- v4 plan-only authorization is recognized but never returned as active v5 authority.
- unknown/newer/malformed state is preserved/classified incompatible, not rewritten.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/artifact-chain.test.ts tests/core/plan-authorization*.test.ts tests/core/v5-persistence.test.ts`

Expected: FAIL because current authorization is plan-only and reads the v4 file as authority.

- [ ] **Step 3: Implement artifact-chain and v5 authorization persistence**

Reuse `AtomicPersistence`. Preserve the existing authorization review boundary/locking semantics. Do not fabricate Requirements/Design lineage during migration.

- [ ] **Step 4: Update direct consumers of `ApprovedPlanBinding` to compile against `binding.artifactChain.plan`**

Mechanical compile-only changes are allowed here only where the type migration requires them; behavior changes belong to later tasks.

- [ ] **Step 5: Run focused tests + typecheck**

Run:
- `bun run vitest run tests/core/artifact-chain.test.ts tests/core/plan-authorization*.test.ts tests/core/v5-persistence.test.ts`
- `bun run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/artifact-chain.ts src/core/plan-authorization.ts src/core/v5-persistence.ts tests/core/artifact-chain.test.ts tests/core/plan-authorization*.test.ts tests/core/v5-persistence.test.ts
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
- Produces:
  - `parseSuperpowersPlan(markdown: string) -> ParsedSuperpowersPlan`
  - `projectRequirementsClauses(markdown, ref) -> ProjectionResult`
  - `projectDesignClauses(markdown, ref) -> ProjectionResult`
  - `projectPlanClauses(markdown, ref) -> ProjectionResult`
  - `buildConformanceContract(chain, sources) -> ConformanceContract`
- Plan parser must recognize Goal, Architecture, Tech Stack, Spec, Global Constraints, Review Focus, Task Files, Interfaces/Consumes/Produces, signatures, exact values, test assertions, and Expected lines.

- [ ] **Step 1: Write RED parser/projection tests**

Assertions:
- every `JUS5-*` heading produces deterministic source identity + `/0` and ordered bullet suffixes.
- Design projection enumerates exactly `INV-01..06` + `J5D-*` registry rows; prose containing MUST outside the registry is not auto-enumerated.
- Plan projection enumerates all required structural units.
- a structural unit containing several obligations stays one clause and requires all to be proven.
- duplicate IDs → INVALID.
- missing Requirements/Design/Plan source → INVALID.
- ambiguous task/section structure → INCOMPLETE or INVALID, never COMPLETE.
- source fingerprint mismatch → INVALID.
- unsupported Plan structure cannot disappear silently.
- projection schema is embedded in contract identity.

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
git add src/core/conformance-contract.ts src/core/superpowers-plan-parser.ts src/core/conformance-projector.ts src/core/plan-parser.ts tests/core/superpowers-plan-parser.test.ts tests/core/conformance-projector.test.ts tests/core/conformance-contract.test.ts
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
  - `bindPending(input) -> Promise<ExecutionCorrelation | null>`
  - `attachChild(key, childSessionId) -> Promise<CorrelationMutationResult>`
  - `attachContinuation(key, sesId) -> Promise<CorrelationMutationResult>`
  - `markTerminal(key) -> Promise<CorrelationMutationResult>`
  - `findByCall(key) -> Promise<ExecutionCorrelation | null>`
  - `findTrustedByChildSession(childSessionId) -> Promise<ExecutionCorrelation | null>`
- `resolveSuperpowersImplementationTask(input) -> Promise<TaskIdentityResolution>`:
  - extracts exactly one Superpowers task-brief reference from the dispatch prompt;
  - reads `task-N-brief.md`;
  - canonicalizes the full brief;
  - matches its digest against exactly one task in the active authorized Plan snapshot;
  - task number/path alone is insufficient trust.

- [ ] **Step 1: Write RED correlation-store tests**

Cover:
- same `parentSessionId+parentCallId` is idempotent.
- conflicting semantic task for same call becomes untrusted.
- child relation is accepted only when parent relation agrees.
- unrelated `ses_...` cannot rebind semantic task.
- trusted child continuation can reattach.
- persistence failure yields no trusted correlation.
- recovery uses the durable file, not an ephemeral map.

- [ ] **Step 2: Write RED task-brief resolver tests**

Cover:
- valid `task-N-brief.md` full body digest resolves one authorized TaskIdentity.
- task number matches but brief body is stale → untrusted.
- multiple/missing brief references → untrusted.
- brief from another Plan workspace → untrusted.
- checkbox-only Plan progress still matches the same task digest.

- [ ] **Step 3: Run RED tests**

Run: `bun run vitest run tests/core/execution-correlation.test.ts tests/core/superpowers-dispatch-resolver.test.ts`

Expected: FAIL because stores/resolver do not exist.

- [ ] **Step 4: Implement store/resolver using AtomicPersistence and existing plan canonicalization**

No semantic identity goes into OmO args.

- [ ] **Step 5: Run GREEN tests + typecheck**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/execution-correlation.ts src/core/superpowers-dispatch-resolver.ts src/core/types.ts tests/core/execution-correlation.test.ts tests/core/superpowers-dispatch-resolver.test.ts
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
- Existing adapter in-memory maps become caches only; recovery reads the durable store.

- [ ] **Step 1: Write RED adapter tests**

Cover:
- PreToolUse on an authorized implementation call persists correlation before execution.
- PostToolUse metadata + `session.created/session.updated` attach the same child session.
- conflicting metadata/event parentage marks relation untrusted.
- legitimate `ses_...` is preserved in args.
- invalid both-target routing is observed but not trusted.
- no extra task/reviewer call is created.
- persistence failure returns PROCEED but leaves evidence untrusted/NOT_PROVEN.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/runtime/opencode-adapter-execution-correlation.test.ts`

Expected: FAIL on durable binding and `task_id` preservation.

- [ ] **Step 3: Wire the store/resolver into PreToolUse/PostToolUse/session events**

Keep the existing fail-open hook exception boundary. Remove any use of semantic `task_id` as correlation authority.

- [ ] **Step 4: Run GREEN tests + existing adapter suite + typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/opencode-adapter.ts src/core/justice-plugin.ts src/core/types.ts tests/runtime/opencode-adapter-execution-correlation.test.ts
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
- Produces:
  ```ts
  type ReviewKindV5 = "task-review" | "scoped-re-review" | "final-review";

  type RecognizedReviewDispatch =
    | { readonly kind: "recognized"; readonly reviewKind: ReviewKindV5; readonly profile: "superpowers-6.4.2"; ... }
    | { readonly kind: "not_review" }
    | { readonly kind: "ambiguous"; readonly reasons: readonly string[] };

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
- Serialization contract: reviewer appends exactly one final fenced block:
  ```text
  ```justice-review-result-v1
  { strict JSON matching JusticeReviewResult }
  ```
  ```
- `recognizeSuperpowersReviewDispatch(input) -> RecognizedReviewDispatch`
- `buildJusticeReviewAppendix(input) -> string`
- `parseJusticeReviewResult(output) -> ParseReviewResult`
- The appendix carries a read-only workspace-relative Conformance Contract path + digest; it does not alter model/provider/subagent/category.

- [ ] **Step 1: Write RED recognition tests for all three v6.4.2 review profiles**

Use Task 1's fixture strings. Require multiple markers plus concrete brief/review-package/range references. A single keyword must not classify a review.

- [ ] **Step 2: Write RED structured-result tests**

Cover:
- valid exact result.
- missing fenced block.
- multiple blocks.
- malformed JSON/schema.
- wrong correlation ID.
- wrong chain/task.
- stale base/head.
- wrong contract digest.
- missing required clause result → caller can convert to NOT_PROVEN.
- scoped re-review result may contain only affected finding/clause delta.

- [ ] **Step 3: Run RED tests**

Run: `bun run vitest run tests/core/review-interop.test.ts tests/core/review-result.test.ts tests/runtime/opencode-adapter-review-interop.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement recognition, appendix injection, and same-call output parsing**

Use only the existing Superpowers reviewer dispatch. Do not create `sp-review` / `sp-final-review` calls.

- [ ] **Step 5: Re-run Task 1's real-host gate plus focused unit tests**

Expected: PASS and exactly one reviewer call per Superpowers dispatch.

- [ ] **Step 6: Commit**

```bash
git add src/core/review-interop.ts src/core/review-result.ts src/runtime/opencode-adapter.ts src/core/types.ts tests/core/review-interop.test.ts tests/core/review-result.test.ts tests/runtime/opencode-adapter-review-interop.test.ts
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
- Test: existing review aggregator/projection tests.
- Test: `tests/core/review-quality-v5.test.ts`

**Interfaces:**
- v5 evidence path: `.justice/v5/review-evidence.json`.
- Canonical finding:
  ```ts
  type ReviewFindingV5 = {
    readonly findingId: string;
    readonly severity: "critical" | "important" | "minor";
    readonly summary: string;
    readonly location?: string;
    readonly disposition: "open" | "resolved" | "parked" | "human_adjudicated";
    readonly evidenceRefs: readonly string[];
  };
  ```
- Legacy `major` deserializes only through migration as `important`.
- A v5 human review-resolution artifact must be bound to `artifactChainId`, review scope, and item keys; it resolves quality disposition only and cannot set clause status.

- [ ] **Step 1: Write RED evidence/quality tests**

Cover:
- Critical/Important open → blocking.
- Minor → non-blocking task progression but retained for final review.
- parked Critical/Important remains blocking.
- human quality adjudication changes finding disposition but not `VIOLATED/NOT_PROVEN` clauses.
- final review must disposition carried Minor/parked findings.
- legacy major becomes important only on migration.
- directly observed structured output is trusted without native artifact reservation.
- plain file fallback without secure reservation remains untrusted.

- [ ] **Step 2: Run RED tests**

Expected: FAIL on `major` vocabulary and parked semantics.

- [ ] **Step 3: Implement store, aggregation, and resolution semantics**

Do not remove the Linux native provider; demote it to optional secure file-artifact capability.

- [ ] **Step 4: Run GREEN tests + typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/review-evidence-store.ts src/core/types.ts src/core/v2/review-types.ts src/core/v2/review-aggregator.ts src/core/v2/state-projection.ts src/core/review-resolution-artifact.ts tests/core/review-evidence-store.test.ts tests/core/review-quality-v5.test.ts
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
- Produces:
  ```ts
  type ConformanceGateVerdict =
    | { readonly verdict: "PASS"; readonly satisfiedClauseIds: readonly string[] }
    | { readonly verdict: "BLOCK"; readonly violated: readonly string[]; readonly notProven: readonly string[]; readonly diagnostics: readonly string[] };

  evaluateTaskConformance(input: TaskConformanceInput): ConformanceGateVerdict;
  evaluatePlanConformance(input: PlanConformanceInput): ConformanceGateVerdict;
  ```
- Completion candidate includes exact HEAD/reviewed range; a post-review mutation invalidates review evidence.
- SDD task acceptance requires trusted task review; executing-plans does not require a per-task reviewer but leaves semantic clauses NOT_PROVEN until the final review proves them.

- [ ] **Step 1: Write RED gate tests**

Cover:
- worker success alone does not accept.
- all required clauses SATISFIED + required quality/review → PASS.
- one VIOLATED → BLOCK.
- one NOT_PROVEN → BLOCK.
- projection INCOMPLETE/INVALID → BLOCK.
- stale review range after HEAD mutation → BLOCK.
- SDD missing task review → BLOCK.
- executing-plans missing per-task review is not itself a failure.
- final whole-branch review can prove deferred inline semantic clauses.
- parked Critical/Important → BLOCK.
- zero drift + zero missing proof + zero blocking quality → PlanComplete.

- [ ] **Step 2: Run RED tests**

Expected: FAIL because current acceptance is review/gate oriented but has no v5 conformance contract.

- [ ] **Step 3: Implement conformance gate and wire it into acceptance decisions**

Keep runtime hook behavior fail-open; only acceptance projections fail closed.

- [ ] **Step 4: Run GREEN focused suite + typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/conformance-gate.ts src/core/acceptance-decision.ts src/core/v2/gate-context.ts src/core/v2/decision-model.ts src/core/v2/state-projection.ts tests/core/conformance-gate.test.ts tests/core/plan-completion-v5.test.ts
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
  type OmoConfigSource = { readonly path: string; readonly layer: "user" | "project"; readonly precedence: number; readonly format: "jsonc" | "json" };

  type OmoEffectiveConfigResult =
    | { readonly kind: "resolved"; readonly sources: readonly OmoConfigSource[]; readonly profile?: string; readonly config: Readonly<Record<string, unknown>>; readonly diagnostics: readonly string[] }
    | { readonly kind: "unsupported"; readonly reason: string; readonly diagnostics: readonly string[] };
  ```
- `resolveOmoEffectiveConfig({ cwd, homeDir, env, readFile, fileExists })`.
- Doctor capability result explicitly reports:
  - OpenCode version metadata;
  - required hook/call capabilities;
  - review-interop supported;
  - child-session relation observable;
  - secure review-artifact available;
  - configured/applied/observed controller status separately.
- Remove exact `SUPPORTED_OPENCODE_VERSION === "1.18.29"` gate. Version is metadata; capabilities are authority.

- [ ] **Step 1: Write RED config precedence tests**

Cover:
- `~/.omo/omo.jsonc` wins over its same-layer `.json` fallback.
- farthest project → nearest project merge order.
- home is not double-counted.
- `[opencode]` overrides shared base.
- selected profile base overrides harness base where specified.
- selected profile `[opencode]` is highest effective-view layer.
- explicit profile → `OMO_PROFILE` → `OCX_PROFILE` → OpenCode profile-dir inference.
- invalid/unreadable source produces diagnostics, not fabricated configured state.

- [ ] **Step 2: Write RED doctor capability tests**

Cover:
- OpenCode 1.18.31 with required capabilities is supported.
- a different patch with same capabilities is not rejected solely by version.
- expected version with missing mutable task hook is unsupported.
- source/configured/applied/observed values are printed separately.
- secure artifact capability and review interop capability are independent.

- [ ] **Step 3: Run RED tests**

Expected: FAIL on exact 1.18.29 gate and single-file assumptions.

- [ ] **Step 4: Implement effective config resolver + doctor capability model**

Prefer an OmO effective-config API if a compatible public API is available; otherwise use the exact resolver above. Do not silently switch semantics.

- [ ] **Step 5: Run GREEN tests + integration doctor smoke**

Run:
- focused tests
- `bun run typecheck`
- `bun run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/omo-effective-config.ts src/core/doctor-config.ts src/core/doctor-categories.ts src/core/controller-routing.ts src/runtime/doctor-cli.ts src/runtime/doctor-cli-helpers.ts tests/core/omo-effective-config.test.ts tests/runtime/doctor-v5.test.ts
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
- `justice_review` read result includes:
  ```ts
  type JusticeReviewV5View = {
    readonly artifactChain: { readonly chainId?: string; readonly status: "AUTHORIZED" | "STALE" | "UNAVAILABLE" };
    readonly projection: { readonly status: ProjectionStatus; readonly diagnostics: readonly string[] };
    readonly tasks: readonly { readonly taskIdentity: string; readonly acceptance: string; readonly missingEvidence: readonly string[]; readonly drift: readonly string[]; readonly blockingFindings: readonly string[] }[];
    readonly planCompletion: { readonly status: "BLOCKED" | "READY" | "COMPLETE"; readonly reasons: readonly string[] };
    readonly recoveryDiagnostics: readonly string[];
  };
  ```
- Human `resolve` action remains a quality-resolution path only; it cannot manufacture clause satisfaction.
- Recovery loads v5 chain/correlation/evidence stores, then classifies v4/unknown state and reports conflicts.
- Superpowers ledger disagreement is surfaced, never silently overwritten.

- [ ] **Step 1: Write RED recovery/view tests**

Cover:
- v4 authorization appears historical/untrusted, not AUTHORIZED.
- v4 review-dispatch state never resumes a review.
- v4 raw observation cannot satisfy v5 acceptance.
- unknown/newer schema is preserved and reported; acceptance blocked.
- durable ExecutionCorrelation survives restart; adapter ephemeral map absence does not break recovery.
- Justice/Superpowers complete-state conflict is surfaced.
- `justice_review` explains exact missing clause/evidence/drift/finding.
- human quality resolution does not change conformance clause status.

- [ ] **Step 2: Run RED tests**

Expected: FAIL on current review-summary-only view and v4 authority assumptions.

- [ ] **Step 3: Implement recovery orchestration and v5 control-plane view**

Do not mutate Superpowers ledger.

- [ ] **Step 4: Run GREEN tests + full runtime suite**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/justice-tools.ts src/core/justice-plugin.ts src/core/v5-persistence.ts src/core/v2/state-projection.ts src/runtime/doctor-cli.ts tests/runtime/justice-review-v5.test.ts tests/core/v5-recovery.test.ts
git commit -m "feat: expose Justice v5 recovery and gate state"
```

---

### Task 14: Close the 40-Scenario E2E Matrix and Synchronize User/Upstream Documentation

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
- Produces one end-to-end acceptance fixture that can assert an `ApprovedArtifactChain` from authorization through implementation/review evidence to `PlanComplete`.
- Produces the current documented stack:
  - OmO v5 OpenCode edition;
  - Superpowers v6.4.2;
  - capability-first OpenCode support;
  - `omo.jsonc` effective config;
  - Superpowers owns orchestration;
  - Justice owns semantic evidence/conformance/acceptance.

- [ ] **Step 1: Add/complete the integration cases listed in the traceability table below**

Do not create duplicate tests if an earlier focused test already provides the exact E2E evidence; reference the focused test in the table and add only missing cross-component cases here.

- [ ] **Step 2: Run the v5 integration suite RED if any scenario is still uncovered**

Run: `bun run vitest run tests/integration/justice-v5-semantic-control-plane.integration.test.ts`

Expected: any remaining unimplemented cross-component behavior fails explicitly.

- [ ] **Step 3: Make only the smallest integration/wiring changes needed to satisfy uncovered cross-component cases**

If the required fix changes an architecture contract rather than wiring, STOP and return to Design review instead of ruling around it.

- [ ] **Step 4: Update user/upstream documentation**

Required documentation corrections:
- Superpowers upstream: `obra/superpowers`.
- OmO upstream: `code-yeongyu/oh-my-openagent`.
- Current OmO config: effective `omo.jsonc` system.
- Remove Justice-owned review scheduling language.
- Explain `justice_review` as evidence/gate inspection.
- Record audited baselines and exact SHAs/tags in upstream compatibility audit.
- Explain v4 persistent-state authority migration.
- Do not claim OmO Native support.

- [ ] **Step 5: Run final verification**

Run in order:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:integration
bun run build
git diff --check
```

Expected: all PASS; output contains no new warnings attributable to this change.

- [ ] **Step 6: Verify the candidate revision has no stale review evidence**

After the final code commit, the final whole-branch review must run against that exact candidate HEAD. Any code change after final review invalidates the review and requires a new review/conformance result.

- [ ] **Step 7: Commit documentation/integration closure**

```bash
git add tests/integration/justice-v5-semantic-control-plane.integration.test.ts README.md SPEC.md docs/agents/upstream-drift.md docs/reports/upstream-compatibility-audit.md
git commit -m "docs: complete Justice v5 compatibility migration"
```

---


## Contract Traceability

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

The numbering below is the Design §29 numbering. A scenario is not complete because a nearby test exists; the named test must assert the listed behavior.

| # | Required scenario | Owning task / test |
|---|---|---|
| 1 | checkbox-only plan updates preserve authorization | Task 3 — `plan_authorization_preserves_checkbox_progress` |
| 2 | interface/signature/assertion/global-constraint changes invalidate authorization | Task 3 — `artifact_chain_invalidates_substantive_plan_change` |
| 3 | substantive Design change invalidates downstream Plan authority | Task 3 — `design_change_stales_plan_chain` |
| 4 | new human approval establishes new authorization lineage | Task 3 — `reapproval_creates_new_chain_id` |
| 5 | implementation → Superpowers task review → Justice evidence → acceptance | Task 14 E2E — `sdd_task_reaches_acceptance_through_existing_review` |
| 6 | Justice does not duplicate-dispatch reviewer | Task 1 + 7 adapter test |
| 7 | Needs fixes → fix → scoped re-review → ADDRESSED → acceptance | Task 14 — `scoped_re_review_can_resolve_blocking_finding` |
| 8 | NOT ADDRESSED remains blocking | Task 8/9 — `not_addressed_remains_blocking` |
| 9 | round-cap/deferred findings remain visible | Task 8 — `parked_findings_remain_visible_and_blocking_when_important` |
| 10 | executing-plans lacks per-task reviewer without failure | Task 9 — `inline_task_does_not_require_fresh_reviewer` |
| 11 | inline final review/conformance still enforced | Task 14 — `inline_requires_final_review_and_conformance` |
| 12 | Plan interface differs from code → task block | Task 9 — `plan_code_interface_violation_blocks` |
| 13 | Design invariant differs from Plan → downstream authorization block | Task 3/4 — `design_plan_violation_stales_chain` |
| 14 | implementation-discovered Design change requires reconciliation before resume | Task 3/9 E2E |
| 15 | code works/tests pass but violates Plan → acceptance blocked | Task 9 — `passing_tests_do_not_override_plan_violation` |
| 16 | reviewer omits required normative clause → NOT_PROVEN | Task 7/9 — `missing_clause_result_becomes_not_proven` |
| 17 | final review approves old revision, code changes afterward → completion blocked | Task 9 Review Focus test |
| 18 | all clauses SATISFIED, no blocking quality → completion permitted | Task 9 + 14 E2E |
| 19 | Justice does not emit canonical `deep` | Task 2 |
| 20 | custom `sp-*` coexist with OmO v5 routing | Task 2/12 |
| 21 | Justice does not directly select model/provider | Task 2/7 |
| 22 | compatible OpenCode patch not rejected solely by version | Task 11 |
| 23 | missing required host capability reported accurately | Task 11 |
| 24 | compaction retains plan/task/review correlation | Task 13 |
| 25 | completed work not re-correlated to another Plan after recovery | Task 13 |
| 26 | Justice/Superpowers state conflict surfaced | Task 13 |
| 27 | OmO `task_id=ses_...` preserved, never replaced with TaskIdentity | Task 2/6 |
| 28 | task call recoverably correlated by durable parent-session/parent-call sidecar | Task 5/6 |
| 29 | `category + subagent_type` not silently resolved by Justice | Task 2 |
| 30 | missing/ambiguous execution correlation leaves evidence NOT_PROVEN | Task 5/9 |
| 31 | Requirements change stales Design + Plan chain | Task 3 |
| 32 | substantive Ruling can continue execution but cannot authorize acceptance | Task 3/9 |
| 33 | duplicate/missing/ambiguous projection becomes INCOMPLETE/INVALID | Task 4 |
| 34 | v6.4.2 task reviewer gets Conformance Contract through same dispatch | Task 1/7 |
| 35 | missing/malformed structured review result blocks | Task 7/9 |
| 36 | parked Important/Critical blocks until trusted disposition/human quality adjudication | Task 8/9 |
| 37 | effective config honors user/project + harness/profile precedence | Task 11 Review Focus test |
| 38 | v4 plan-only authorization not auto-promoted | Task 3/13 |
| 39 | v4 review-dispatch state cannot resume/satisfy v5 gate | Task 10/13 |
| 40 | unknown/newer persistence preserved and acceptance fail-closed | Task 13 Review Focus test |

---

## Interface Dependency Scan for Execution Pre-Flight

The executor must record these rows in the Superpowers ledger before Task 1:

| Producer | Consumer | Contract to compare |
|---|---|---|
| Task 2 | Tasks 5–12 | `TaskIdentity`, `TaskCategory`, routing target vocabulary |
| Task 3 | Tasks 4–14 | `ApprovedArtifactChain`, `ApprovedPlanBinding.artifactChain`, schema names |
| Task 4 | Tasks 7–9, 13–14 | `ConformanceContract`, clause IDs, projection status/version |
| Task 5 | Tasks 6–9, 13 | `ExecutionCorrelation` key/status and durable lookup |
| Task 6 | Task 7 | observed parent call + child relation available to review recognition |
| Task 7 | Tasks 8–9, 13 | `JusticeReviewResult`, review kind, range, clause-result semantics |
| Task 8 | Tasks 9, 13 | canonical finding severity/disposition |
| Task 9 | Tasks 13–14 | task/plan acceptance reasons and completion state |
| Task 11 | Tasks 12–14 | configured/applied/observed doctor vocabulary |
| Task 13 | Task 14 | v5 recovery/control-plane view semantics |

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
   - Task 1 is a compatibility gate and must stop the plan if the supported extension point is not proven.
6. **Persistence**
   - v4 state is recognized without becoming v5 authority;
   - unknown/newer state is preserved and blocks affected acceptance.
7. **Final review revision**
   - final review and Final Conformance Gate must cover the exact candidate HEAD.
8. **Proportion**
   - bodies/algorithms are not pre-written; the plan fixes interfaces, assertions, commands, and architecture decisions only.
