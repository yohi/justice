# Justice v5 Semantic Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Justice as the fail-closed semantic nervous system between Superpowers v6.4.2 and OmO Native v5.1.17 / Senpi v2026.10.8, with zero unresolved semantic drift at PlanComplete.

**Architecture:** Superpowers owns WHAT (method selection and workflow/review progression), Justice owns the activation bridge plus SEMANTIC HOW (execution classification, provenance-aware category translation, correlation/evidence/acceptance), and OmO owns CONCRETE HOW (agent/runtime/model/provider/reasoning/retry/fallback). Justice activates only an authoritative selected Superpowers method, consumes Task-1/Task-6-proven Superpowers provenance to translate an already-issued OmO Native `task` call into one semantic `sp-*` category, and never becomes either a scheduler or a concrete model/provider resolver.

**Tech Stack:** TypeScript 6.x, Bun, Vitest 4.x, Effect, Zod, YAML, OmO Native/Senpi extension events, existing AtomicPersistence and Observation Log infrastructure.

**Requirements:** `docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md`

**Spec:** `docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md`

**Implementation Baseline:** current `master` containing this approved Requirements/Design/Plan revision. Production source/test/CI remains tree-equivalent to the historical production baseline `080bcdb25b192962789ff5d67139e56487381de4` until implementation begins.

**Historical Compatibility Reference:** Justice `v4.3.1` is a side-branch historical regression corpus only. It is **not** the Justice v5 implementation base. Do not merge or wholesale cherry-pick `v4.3.1` before implementing this Plan. Carry forward only the harness-independent regression contracts explicitly incorporated below.

## Global Constraints

- Superpowers owns execution-method selection, task selection, review scheduling, fix/re-review progression, ledger progression, and final whole-branch review. Justice MUST NOT duplicate that orchestration.
- Justice owns selected-method activation evidence plus SEMANTIC HOW: classification, Native task-routing translation, correlation, evidence, conformance, and acceptance.
- OmO Native/Senpi owns task creation/runtime, process vs in-process execution, task ids/names, `task_send` continuation, task recovery/revival, workpools/teams, model/provider/reasoning resolution, retry, and fallback.
- The primary audited runtime is OmO Native v5.1.17 at tag `091728d274f20d62504b0b5e1edbc3970671dd8b` with Senpi v2026.10.8 at tag `d56e6a260d9468418a39bc9120945cf98e06b840`.
- Superpowers v6.4.2 is a Pi package. Its Pi bootstrap does not define OmO's `task` tool. Justice may inject a **tool-mapping appendix** explaining “Superpowers subagent/reviewer dispatch → existing OmO Native `task`”, but the model/Superpowers workflow must issue the call; Justice MUST NOT call `task` to advance workflow.
- Native new-child routing is exactly `category XOR subagent_type`. Category-routed calls MUST NOT receive a Justice-selected concrete `model`.
- OmO Native background task ids (`st_...` when returned), task names, and `task_send(to=...)` targets are runtime identity only and MUST NOT encode Justice TaskIdentity.
- Senpi `tool_call` is the primary pre-execution task observation seam: `toolCallId` + `ctx.sessionManager.getSessionId()`; `event.input` may be mutated in place for routing translation.
- Task 1 is an **evidence spike and architecture gate**, not a regression replay of an assumed child API. It must prove the exact child/reviewer binding, context-delivery, Superpowers activation, and task-mapping seams against the audited runtime before Tasks 5–7/10 rely on them.
- If Task 1 cannot prove a race-free Native reviewer-delivery contract, STOP and return to artifact reconciliation. Do not fall back to OpenCode `chat.message/client.session.get`, v4 `justice-review-controller`, duplicate reviewer dispatch, or Justice-owned scheduling.
- Runtime execution may fail open where safe; Authorization / Accepted / Verified / Complete MUST fail closed when required proof is missing.
- Human implementation approval binds one exact Requirements→Design→Plan `ApprovedArtifactChain`.
- Required Conformance Contract clauses resolve only to `SATISFIED | VIOLATED | NOT_PROVEN`; `VIOLATED` and `NOT_PROVEN` block acceptance.
- Only `projectionStatus=COMPLETE` is acceptance-eligible.
- A substantive Requirements/Design/Plan change invalidates downstream authority and requires artifact reconciliation plus required human re-approval.
- Superpowers `Ruling:` may continue workflow execution but MUST NOT rewrite Justice semantic authority.
- Justice never dispatches a duplicate task reviewer, scoped re-reviewer, or final reviewer.
- Canonical v5 review severity is `critical | important | minor`; legacy `major` is migration-only.
- Open Critical/Important findings block Justice acceptance; parked/Ruling is not resolution.
- OmO configured state means the effective user/project + **[native]** harness/profile view, not one arbitrary `omo.jsonc`.
- v4 durable authority is never silently promoted to v5 authority.
- Final completion requires zero unresolved drift, zero unauthorized drift, zero missing required evidence, and zero blocking quality findings.
- Do not manually set the package release version; release automation owns versioning.
- Every production-code task follows RED → GREEN → focused verification → full task test → commit.
- Implementation starts from the master commit containing the approved artifact revision. Justice `v4.3.1` is not a merge/cherry-pick prerequisite.

## Review Focus

- **Post-review mutation:** a reviewer approves commit A, then HEAD changes to B; Task 9 must prove B cannot reuse A's review/conformance evidence.
- **Projection omission:** a malformed or unsupported Plan section disappears from projection; Task 4 must prove projection becomes INCOMPLETE/INVALID rather than silently complete.
- **Runtime identity collision:** an unrelated OmO `st_...` task id/name or `task_send` target is observed; Task 5/6 must prove it cannot rebind semantic TaskIdentity without the Task-1-proven relation.
- **Config precedence:** user, ancestor project, nearest project, harness, and profile layers disagree; Task 11 must prove doctor reports the exact effective value and its sources.
- **Upgrade recovery:** v4 state and unknown/newer state coexist with v5 files; Task 13 must prove neither can silently satisfy v5 acceptance.

## Historical Regression Evidence — Justice v4.3.1

Justice `v4.3.1` was released from the v4 side branch and is **not** the v5 implementation base. The full v4 implementation is non-normative for v5. It is retained as a regression corpus: production failures are translated into harness-independent proof obligations, while OpenCode/OmO-v4 mechanics are discarded unless current supported-runtime evidence independently requires them.

### Retained v4.2.0 regression contracts

The previously recorded v4.2.0 contracts remain mandatory regression evidence:

- `821343eba1223371ae0a7a20e02e7370db900306` — completed-plan final review must be recognized before implementation-task exhaustion / plan-completion cleanup can suppress the review path;
- `4759d777aab9c80b897c55392bcc0f5833d79d7b` — task/scoped/final review workers must remain outside implementation semantics and implementation-worker enrichment;
- `1781c7efae22ac1304fa8dc0d1f621c888943a1e` — recognized Superpowers review semantic routing must preserve reviewer intent even when a harness presents only a generic worker shape; Native v5 re-proves the equivalent mapping through its own task contract rather than retaining the OpenCode marker.

Earlier v4 compatibility fixes also remain evidence for existing v5 contracts:

- `de2ca2a0e2c23ed0a71808b7de246a292c0c00d8` — preserve approved task bodies instead of reconstructing them lossily;
- `54e240ffc5415443dfa5d3dc243945e16d9d2631` — separate Justice semantic normalization from OmO runtime/wire ownership;
- `8c8f8fd400b06d9228ceb7e30ab9c94a2acfcc72` — preserve OmO continuation/session identity instead of overloading it with Justice task identity.

### Additional v4.2.1–v4.3.1 lessons

| Historical evidence | Regression lesson retained by v5 | v5 owner / verification target | v4 implementation disposition |
|---|---|---|---|
| `aba390a983fd8eaea791785727aef39599b9d6aa`, `4688a96982355fff87e2d37e1a775b2456c6904f` | a review-looking action is not trusted evidence unless its producer/provenance is unambiguous and recognized | Task 7 / review provenance | **REDESIGN** — do not port the dedicated OpenCode controller/native-TaskTool wrapper as architecture |
| `19ebb1c5ae9994e8b43a48b5b0ab0a43a6b006de`, `7ad4b6649a492049467d622dbc57d8b7dda94344` | unreadable, stale, wrong-scope, or artifact-mutated review evidence fails closed | Tasks 7–9 / stale evidence and final closure | **PORT AS CONTRACT** |
| `96d088398680c6ec04f65f809384e8d6fe6d5c80`, `faae0834c0c3e7bc2adb90cbf7de9cac36506dca`, `bef5f3437d8f3827ea13cdab06267740360a0ca9` | `review_clear` / clean review evidence is not implementation authorization; human authorization remains a separate exact-artifact-chain boundary | Task 3 + Task 14 E2E | **PORT AS CONTRACT**, redesign enforcement for the target harness |
| `05277cfdffb16ec135ea13ce1b4e978228e35a3a`, `7ad4b6649a492049467d622dbc57d8b7dda94344` | remediation must produce fresh review evidence, but Justice must not own fix/re-review progression or runtime retry | Task 10 Superpowers progression ownership + Task 12 OmO retry/fallback boundary + Tasks 7–9 evidence + Task 14 cross-component closure | **PORT AS CONTRACT / DROP orchestration** |
| `7f88e28c620ff74568691bedb88f93a1e723a1be`, `ac548a1a61eeb726f5bfe53c77ea6bab22a5300d` | a per-session Justice bypass is operationally useful and must not revive stale authority when re-enabled | future adapter capability review | **KEEP CONCEPT**, not a v5 acceptance requirement in this baseline |
| `eea681d879ee848ba57ac51a69284392b9834544`, `368632bddda72f83fb36e58b50dd30df5fbe7e72` | OpenCode command visibility, `@path`, and prompt-template execution are harness quirks, not semantic-control-plane contracts | none cross-harness | **DROP from core**; re-evaluate only in an OpenCode adapter |

The temporary same-session bootstrap dependency from `efec7a3ec5e0ae38b1b3f09e44112526ea97ee77` was superseded later on the v4 line by the standalone Review Gate architecture and is not retained.

The v4 implementations themselves are **not** normative. In particular, do not carry forward:

- DependencyAnalyzer-owned execution ordering;
- Justice-owned task/review/fix progression;
- PlanBridge reconstruction of worker prompts from Plan task bodies;
- hardcoded SDD methodology selection;
- `justice_task_id` / semantic identity overloading of OmO `task_id`;
- external both-target normalization as a general caller contract;
- the OpenCode-specific `justice-review-controller` wrapper, custom-command prompt rewriting, or native TaskTool indirection;
- the OmO v4 synchronous completion-envelope parser as a general review evidence contract;
- Justice-owned Review Gate auto-retry/remediation scheduling;
- OpenCode-specific session cleanup as the portable implementation of a future enable/disable capability.

Where historical v4 behavior conflicts with the current Superpowers=WHAT / Justice=SEMANTIC HOW / OmO=CONCRETE HOW architecture, this v5 Plan wins.

The historical v4 review setting `run_in_background=false` is non-normative. Native Task 1 may observe foreground/background behavior only to establish identity and delivery semantics; Justice must never turn that observation into a workflow-scheduling policy.

Task ownership for the v4.3.1 corpus is explicit:

- Task 3 proves that review evidence never manufactures human implementation authorization and that artifact mutation invalidates the exact approved chain;
- Task 7 proves trusted review producer/provenance recognition and strict rejection of ambiguous/malformed/stale results;
- Task 9 proves reviewed-candidate freshness through final evidence closure;
- Task 10 proves remediation/re-review progression remains Superpowers-owned and Justice does not schedule fix/re-review work;
- Task 12 proves provider/runtime failure classification remains diagnostic-only and cannot initiate Justice retry/fallback, preserving OmO runtime ownership;
- Task 14 closes Design §29 Scenario 50 (review evidence cannot manufacture human implementation authorization) and Scenario 51 (Superpowers progression ownership + OmO runtime ownership) end-to-end; Scenarios 48–49 are fully owned by their focused Task 7/9 tests and require no duplicate E2E case.

Task 1 is now the OmO Native v5.1.17 / Senpi v2026.10.8 / Superpowers v6.4.2 runtime evidence gate. It closes Native adapter architecture; it is **not** a v4.3.1 or OpenCode behavior-compatibility gate.

---

## File Structure Locked by This Plan

New focused modules:

- `src/core/artifact-chain.ts` — v5 Requirements/Design/Plan revision identity and chain types.
- `src/core/conformance-contract.ts` — normative clauses, projection status, contract/result types.
- `src/core/conformance-contract-store.ts` — immutable durable Conformance Contract persistence and reviewer-readable paths.
- `src/core/superpowers-plan-parser.ts` — deterministic parser for the v6.4.2 plan structures Justice treats as normative.
- `src/core/conformance-projector.ts` — Requirements/Design/Plan projection and completeness validation.
- `src/core/execution-correlation.ts` — durable Senpi parent-session/tool-call ↔ semantic task ↔ observed OmO task/child sidecar state.
- `src/senpi-extension.ts` — Justice Native extension entry point.
- `src/runtime/senpi-adapter.ts` — Senpi event adapter for task observation/routing, activation evidence, and Task-1-proven child/reviewer binding.
- `src/runtime/senpi-superpowers-mapping.ts` — non-scheduling Superpowers→OmO Native tool-mapping appendix.
- `src/core/superpowers-dispatch-resolver.ts` — resolve implementation TaskIdentity from Superpowers task-brief artifacts.
- `src/core/workflow-activation.ts` — resolve authoritative Superpowers execution-method activation intent without owning methodology progression.
- `src/core/review-interop.ts` — versioned Superpowers reviewer recognition and prompt appendix construction.
- `src/core/review-result.ts` — strict JusticeReviewResult parsing and stale/scope validation.
- `src/core/review-evidence-store.ts` — durable v5 structured review/conformance evidence.
- `src/core/conformance-gate.ts` — task/final conformance, final evidence closure, and quality acceptance decisions.
- `src/runtime/revision-diff-provider.ts` — trusted exact-range Git name-status evidence for final fix-wave carry-forward.
- `src/core/omo-effective-config.ts` — OmO v5 file-layer + harness/profile effective config resolver.
- `src/core/v5-persistence.ts` — recognized v4 schema classification and v5 migration diagnostics.

Existing files retain their existing responsibility unless a task below explicitly changes it.

## OmO Native / Senpi Evidence Baseline

The primary architecture is pinned to:

```text
OmO Native: v5.1.17
tag commit: 091728d274f20d62504b0b5e1edbc3970671dd8b

Senpi: v2026.10.8
tag commit: d56e6a260d9468418a39bc9120945cf98e06b840

Superpowers: v6.4.2
```

Source-level facts already established:

- OmO Native packages its extension as `@code-yeongyu/omo-senpi` and contributes bundled skills through `resources_discover`.
- Superpowers v6.4.2 is also a Pi package with its own extension and skills.
- Senpi `tool_call` exposes `toolCallId`, current session through `ctx.sessionManager.getSessionId()`, and mutable `event.input`.
- Native `task` requires exactly one of `category | subagent_type`; background calls return `st_...` task ids; continuation/steering uses `task_send(to=...)`.
- Senpi exposes `tool_result`, `before_agent_start`, `context`, `session_start`, `session_compact`, and `session_shutdown`.
- Superpowers' Pi bootstrap explicitly says Pi has no standard subagent tool and does not name OmO's `task`; therefore Native interop needs a thin tool-mapping appendix.
- OmO owns task host/process selection, retry/fallback, child recovery, and lifecycle state.

Not yet assumed from source inspection alone:

- which exact public Native surface proves one parent `task` call ↔ one child/reviewer session/run;
- the exact event ordering that guarantees review appendix delivery before trusted reviewer output;
- the exact method-specific Superpowers activation evidence that survives/requires refresh across compaction.

Task 1 must prove those runtime facts. Its evidence becomes the only allowed implementation contract for Tasks 5–7 and 10. If runtime evidence differs from the Design, implementation stops for artifact reconciliation.

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

type FindingId = `jf_${string}`;

type ReviewFindingV5 = {
  readonly findingId: FindingId;
  readonly severity: "critical" | "important" | "minor";
  readonly summary: string;
  readonly location?: string;
  readonly disposition: "open" | "resolved" | "parked" | "human_adjudicated";
  readonly evidenceRefs: readonly string[];
};

type SuperpowersExecutionMethod =
  | "subagent-driven-development"
  | "executing-plans";

// Open OmO Native wire namespace for caller-owned explicit categories.
// Runtime validation is exactly: typeof value === "string" && value.length > 0.
// The string is preserved byte-for-byte; Justice does not trim or static-union-normalize it.
type OmoCategoryName = string;

type SemanticExecutionClass =
  | "mechanical"
  | "implementation"
  | "integration"
  | "deep"
  | "architecture"
  | "review"
  | "final-review";

type SpCategory =
  | "sp-mechanical"
  | "sp-implementation"
  | "sp-integration"
  | "sp-deep"
  | "sp-architecture"
  | "sp-review"
  | "sp-final-review";

type TaskRoutingTarget =
  | { readonly kind: "category"; readonly category: OmoCategoryName }
  | { readonly kind: "subagent"; readonly subagentType: string }
  | { readonly kind: "unrouted" }
  | { readonly kind: "invalid_both"; readonly category: string; readonly subagentType: string };

type SemanticClassificationResult =
  | {
      readonly kind: "classified";
      readonly executionClass: SemanticExecutionClass;
      readonly category: SpCategory;
      readonly reasons: readonly [string, ...string[]];
    }
  | {
      readonly kind: "ambiguous";
      readonly reason:
        | "missing_semantic_context"
        | "unsupported_semantic_context"
        | "conflicting_authoritative_context";
      readonly details: readonly string[];
    };

type SuperpowersRoutingRole =
  | "implementation"
  | "task-review"
  | "scoped-re-review"
  | "final-review";

type NativeSuperpowersProvenanceProfile = {
  readonly schemaVersion: "justice-native-superpowers-provenance-profile-v1";
  readonly profileId: string;
  readonly sourceKind: string;
  readonly requiredObservedFields: readonly [string, ...string[]];
  readonly parentSessionBinding: string;
  readonly parentToolCallBinding: string;
  readonly workflowMethodBinding: string;
  readonly restartCompactionValidity: "same_session_only" | "task1_proven_persistent";
  readonly rejectionRules: readonly [string, ...string[]];
};

type NativeSuperpowersProvenanceEvidence = {
  readonly schemaVersion: "justice-native-superpowers-provenance-evidence-v1";
  readonly profileId: string;
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly role: SuperpowersRoutingRole;
  readonly sourceEvidenceRefs: readonly [string, ...string[]];
  readonly observedAt: string;
};

type NativeSuperpowersProvenanceInput = {
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly taskArgs: Readonly<Record<string, unknown>>;
  readonly executionMethod: SuperpowersExecutionMethod;
  readonly observedEvidenceRefs: readonly string[];
};

type TaskRoutingProvenance =
  | {
      readonly kind: "superpowers";
      readonly role: SuperpowersRoutingRole;
      readonly evidence: NativeSuperpowersProvenanceEvidence;
    }
  | { readonly kind: "external" }
  | { readonly kind: "ambiguous"; readonly reasons: readonly [string, ...string[]] };

interface NativeSuperpowersProvenanceResolver {
  resolve(
    input: NativeSuperpowersProvenanceInput,
    profile: NativeSuperpowersProvenanceProfile,
  ): TaskRoutingProvenance;
}

type SuperpowersRoutingTranslationResult =
  | {
      readonly kind: "category";
      readonly executionClass: SemanticExecutionClass;
      readonly category: SpCategory;
    }
  | { readonly kind: "preserve_explicit_category"; readonly category: OmoCategoryName }
  | { readonly kind: "preserve_explicit_subagent"; readonly subagentType: string }
  | { readonly kind: "unrouted" }
  | {
      readonly kind: "untrusted";
      readonly reason:
        | "invalid_both"
        | "ambiguous_provenance"
        | "semantic_classification_ambiguous"
        | "unexpected_superpowers_generic_shape";
      readonly details: readonly string[];
    };

type TrustedSuperpowersProvenance =
  Extract<TaskRoutingProvenance, { readonly kind: "superpowers" }>;

type TranslateTaskRoutingInput =
  | {
      readonly target: TaskRoutingTarget;
      readonly provenance: Extract<TaskRoutingProvenance, { readonly kind: "external" }>;
      readonly classification?: never;
    }
  | {
      readonly target: TaskRoutingTarget;
      readonly provenance: Extract<TaskRoutingProvenance, { readonly kind: "ambiguous" }>;
      readonly classification?: never;
    }
  | {
      readonly target: TaskRoutingTarget;
      readonly provenance: TrustedSuperpowersProvenance;
      readonly classification: SemanticClassificationResult;
    };

declare function translateTaskRouting(
  input: TranslateTaskRoutingInput,
): SuperpowersRoutingTranslationResult;
```

`FindingId` has the runtime canonical form `^jf_[0-9a-f]{16}$`; the template-literal type is only the static prefix guard, and every review parser/marker extractor MUST validate the full regex. `TaskIdentity` equality uses all six fields. `normalizedHeading` is exactly the existing `CanonicalTaskSnapshot.title` (the Task heading text after the existing trim). `semanticDigest` is exactly the matching existing `CanonicalTaskSnapshot.digest` (`sha256:<lowercase hex>`) produced by `buildCanonicalSnapshot`; Justice v5 does not invent a second task canonicalization algorithm. The existing canonical snapshot normalizes CRLF→LF and checkbox progress `[x]/[X] → [ ]` inside the uniquely matched approved task section while preserving substantive task text. Checkbox-only progress therefore preserves identity; any substantive task-body change that changes the canonical task body changes `semanticDigest`. A new approved artifact chain intentionally changes `artifactChainId` and therefore creates a new authority-scoped identity.

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

type ClauseEvidenceScope =
  | { readonly kind: "global" }
  | { readonly kind: "files"; readonly paths: readonly [string, ...string[]] };

type ClauseResult =
  | {
      readonly clauseId: string;
      readonly status: "SATISFIED";
      readonly evidenceRefs: readonly [string, ...string[]];
      readonly evidenceScope: ClauseEvidenceScope;
    }
  | {
      readonly clauseId: string;
      readonly status: "VIOLATED";
      readonly reason: string;
      readonly evidenceRefs: readonly string[];
      readonly evidenceScope?: ClauseEvidenceScope;
    }
  | {
      readonly clauseId: string;
      readonly status: "NOT_PROVEN";
      readonly reason: string;
      readonly evidenceRefs: readonly string[];
      readonly evidenceScope?: ClauseEvidenceScope;
    };
```

`ClauseEvidenceScope.kind === "global"` intersects every non-empty fix diff. `files` scope is carry-forward eligible only when normalized changed-file paths have an empty intersection with `paths`; undecidable/malformed scope is `NOT_PROVEN`. Only `ProjectionResult.status === "COMPLETE"` is acceptance-eligible.

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

### Task 7 owns review recognition, current-open-set identity transport, child-message injection, and parsing results

```ts
type ReviewFindingTarget = {
  readonly findingId: FindingId;
  readonly severity: "critical" | "important" | "minor";
  readonly summary: string;
  readonly location?: string;
};

type ScopedFindingMarkerExtraction =
  | { readonly kind: "resolved"; readonly requestedFindingIds: readonly FindingId[] }
  | {
      readonly kind: "invalid";
      readonly reason:
        | "missing_findings_section"
        | "malformed_finding_marker"
        | "duplicate_finding_id";
      readonly details: readonly string[];
    };

type ReviewFindingContextQuery = {
  readonly artifactChainId: string;
  readonly scope:
    | { readonly kind: "task"; readonly taskIdentity: TaskIdentity }
    | { readonly kind: "final" };
  readonly precedingReviewedHead: string;
  readonly requestedFindingIds: readonly FindingId[];
};

type ReviewFindingContextResult =
  | {
      readonly kind: "resolved";
      readonly sourceReviewCorrelationId: string;
      readonly expectedFindings: readonly ReviewFindingTarget[];
      readonly reservedFindingIds: readonly FindingId[];
    }
  | { readonly kind: "not_found"; readonly reason: string }
  | { readonly kind: "ambiguous"; readonly reviewCorrelationIds: readonly [string, string, ...string[]] }
  | {
      readonly kind: "untrusted";
      readonly reason:
        | "unknown_requested_finding"
        | "requested_set_mismatch"
        | "requested_finding_state_mismatch"
        | "duplicate_requested_finding"
        | "historical_finding_id_collision"
        | "task_lineage_gap"
        | "task_lineage_cycle"
        | "invalid_final_lineage";
      readonly details: readonly string[];
    };

interface ReviewFindingContextProvider {
  resolve(query: ReviewFindingContextQuery): Promise<ReviewFindingContextResult>;
}

type RecognizedReviewCommon = {
  readonly profile: "superpowers-6.4.2";
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly artifactChainId: string;
  readonly taskIdentity?: TaskIdentity;
  readonly reviewedRange: { readonly base: string; readonly head: string };
  readonly contractId: string;
  readonly contractDigest: string;
};

type RecognizedReviewDispatch =
  | {
      readonly kind: "recognized";
      readonly review: RecognizedReviewCommon & {
        readonly reviewKind: "task-review" | "final-review";
      };
    }
  | {
      readonly kind: "recognized";
      readonly review: RecognizedReviewCommon & {
        readonly reviewKind: "scoped-re-review";
        readonly requestedFindingIds: readonly FindingId[];
      };
    }
  | { readonly kind: "not_review" }
  | { readonly kind: "ambiguous"; readonly reasons: readonly [string, ...string[]] }
  | {
      readonly kind: "untrusted";
      readonly reason: "finding_marker_invalid";
      readonly details: readonly [string, ...string[]];
    };

type ReviewResultInvalidReason =
  | "missing_result"
  | "multiple_results"
  | "malformed_json"
  | "schema_mismatch"
  | "correlation_mismatch"
  | "scope_mismatch"
  | "stale_revision"
  | "contract_mismatch"
  | "missing_required_clause"
  | "finding_context_unavailable"
  | "missing_finding_marker"
  | "malformed_finding_marker"
  | "orphan_finding_marker"
  | "finding_marker_mismatch"
  | "missing_expected_finding"
  | "duplicate_finding_id"
  | "expected_finding_mismatch"
  | "finding_id_collision"
  | "forbidden_human_adjudication";

type PendingReviewCorrelationBase = {
  readonly reviewCorrelationId: string;
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly artifactChainId: string;
  readonly taskIdentity?: TaskIdentity;
  readonly reviewedRange: { readonly base: string; readonly head: string };
  readonly contractId: string;
  readonly contractDigest: string;
  readonly status: "pending_child" | "child_bound" | "ambiguous" | "terminal";
  readonly childSessionId?: string;
};

type PendingReviewCorrelation =
  | (PendingReviewCorrelationBase & {
      readonly reviewKind: "task-review" | "final-review";
      readonly requestedFindingIds?: never;
      readonly expectedFindings?: never;
      readonly reservedFindingIds?: never;
    })
  | (PendingReviewCorrelationBase & {
      readonly reviewKind: "scoped-re-review";
      readonly requestedFindingIds: readonly FindingId[];
      readonly expectedFindings: readonly ReviewFindingTarget[];
      readonly reservedFindingIds: readonly FindingId[];
    });

type PreparePendingReviewResult =
  | { readonly kind: "ready"; readonly correlation: PendingReviewCorrelation }
  | {
      readonly kind: "untrusted";
      readonly reason:
        | "finding_marker_invalid"
        | "finding_context_not_found"
        | "finding_context_ambiguous"
        | "finding_context_untrusted";
      readonly details: readonly string[];
    };

type ReviewChildBindingResult =
  | { readonly kind: "bound" | "idempotent"; readonly correlation: PendingReviewCorrelation }
  | {
      readonly kind: "lookup_failed";
      readonly reason: "binding_unavailable" | "identity_unavailable" | "transport_error";
      readonly details?: string;
    }
  | { readonly kind: "parent_missing"; readonly childSessionId: string }
  | { readonly kind: "not_found"; readonly reason: string }
  | { readonly kind: "ambiguous"; readonly reasons: readonly [string, ...string[]] }
  | {
      readonly kind: "conflict";
      readonly reason: "child_id_mismatch" | "incompatible_existing_binding";
      readonly details?: string;
    };

type ParseReviewResult =
  | { readonly kind: "valid"; readonly result: JusticeReviewResult }
  | { readonly kind: "invalid"; readonly reason: ReviewResultInvalidReason; readonly details: readonly string[] };
```

Marker syntax is exactly `[[justice-finding:<findingId>]]`, with runtime `findingId` regex `^jf_[0-9a-f]{16}$`.

For scoped re-review, marker extraction reads only the exact `## The Findings Under Verification` section up to the next exact `## The Fix` heading. The extracted `requestedFindingIds` array may be empty. Empty is a valid spec/clause-only scoped target set; it is not a context failure.

For task/first-final review, `expectedFindings` and `reservedFindingIds` MUST be absent. For scoped re-review, both MUST be present; `expectedFindings` may be empty, while `reservedFindingIds` contains every ID already used in the trusted same-scope lineage. Every expected ID MUST also appear in `reservedFindingIds`. Historical ID metadata conflict or unresolved lineage/context makes the scoped call ineligible for Justice structured appendix injection and leaves evidence `NOT_PROVEN`.

### Task 9 owns final-review evidence closure

```ts
type FinalFixDiffEvidence = {
  readonly base: string;
  readonly head: string;
  readonly changedPaths: readonly string[];
};

type RevisionDiffResult =
  | { readonly kind: "resolved"; readonly evidence: FinalFixDiffEvidence }
  | {
      readonly kind: "failed";
      readonly reason:
        | "git_failed"
        | "non_ancestor_range"
        | "malformed_output"
        | "unsupported_status"
        | "unsafe_path";
      readonly details: readonly string[];
    };

interface RevisionDiffProvider {
  resolve(base: string, head: string): Promise<RevisionDiffResult>;
}

type ResolvedFinalFixWaveEvidence = {
  readonly kind: "resolved";
  readonly diffEvidence: FinalFixDiffEvidence;
  readonly scopedReReview: JusticeReviewResult & { readonly reviewKind: "scoped-re-review" };
};

type FailedFinalFixWaveEvidence = {
  readonly kind: "diff_failed";
  readonly base: string;
  readonly head: string;
  readonly diffFailure: Extract<RevisionDiffResult, { readonly kind: "failed" }>;
  readonly scopedReReview: JusticeReviewResult & { readonly reviewKind: "scoped-re-review" };
};

type FinalReviewEvidenceClosure = {
  readonly schemaVersion: "justice-final-review-closure-v1";
  readonly artifactChainId: string;
  readonly candidateHead: string;
  readonly fullFinalReview: JusticeReviewResult & { readonly reviewKind: "final-review" };
  readonly finalFixWave?: ResolvedFinalFixWaveEvidence;
  readonly carriedClauseIds: readonly string[];
  readonly reProvenClauseIds: readonly string[];
  readonly clauseResults: readonly ClauseResult[];
  readonly findings: readonly ReviewFindingV5[];
  readonly diagnostics: readonly string[];
};

type BlockedFinalReviewEvidenceAttempt = {
  readonly schemaVersion: "justice-final-review-attempt-v1";
  readonly artifactChainId: string;
  readonly candidateHead: string;
  readonly fullFinalReview: JusticeReviewResult & { readonly reviewKind: "final-review" };
  readonly finalFixWave?: ResolvedFinalFixWaveEvidence | FailedFinalFixWaveEvidence;
  readonly notProvenClauseIds: readonly string[];
  readonly blockingFindingIds: readonly string[];
  readonly reasons: readonly [string, ...string[]];
  readonly diagnostics: readonly string[];
};

type BuildFinalReviewEvidenceClosureResult =
  | { readonly kind: "complete"; readonly closure: FinalReviewEvidenceClosure }
  | { readonly kind: "blocked"; readonly attempt: BlockedFinalReviewEvidenceAttempt };
```

`FinalReviewEvidenceClosure` is trusted/complete evidence only. `RevisionDiffResult.kind === "failed"` MUST create a blocked attempt with `FailedFinalFixWaveEvidence`; it MUST NOT create, populate, or synthesize a trusted closure. `PlanConformanceInput.finalReviewClosure` accepts only the complete branch.

A closure may extend Candidate A to Candidate B only through the single Superpowers final fix wave + exactly one scoped re-review. The core never accepts caller-supplied arbitrary changed-file lists; exact range evidence comes from `RevisionDiffProvider`. Justice never dispatches a second full reviewer.

### Major task-local input/output contracts

These are implementation interfaces, not cross-task architecture choices.

**Task 3**

```ts
type ArtifactChainSourceResolution =
  | {
      readonly kind: "resolved";
      readonly planPath: string;
      readonly designPath: string;
      readonly requirementsPath: string;
      readonly planSource: string;
      readonly designSource: string;
      readonly requirementsSource: string;
    }
  | {
      readonly kind: "invalid";
      readonly reason:
        | "plan_unreadable"
        | "missing_or_ambiguous_spec_reference"
        | "design_unreadable"
        | "missing_or_ambiguous_requirements_reference"
        | "requirements_unreadable"
        | "unsafe_artifact_path";
      readonly details: readonly string[];
    };

type PriorStateClassification =
  | {
      readonly kind: "recognized_v4";
      readonly family:
        | "plan_authorization"
        | "observation_envelope"
        | "review_snapshot"
        | "human_review_resolution";
      readonly schema: string;
    }
  | { readonly kind: "unknown_or_newer"; readonly schema?: string }
  | { readonly kind: "malformed"; readonly reason: string };

type BuildApprovedArtifactChainInput = {
  readonly requirements: { readonly path: string; readonly source: string; readonly sourceRevision?: string };
  readonly design: { readonly path: string; readonly source: string; readonly sourceRevision?: string };
  readonly plan: {
    readonly path: string;
    readonly source: string;
    readonly sourceRevision?: string;
    readonly canonicalSnapshot: CanonicalPlanSnapshot;
    readonly planFingerprint: PlanFingerprint;
  };
};
```

**Task 4**

```ts
type ParsedSuperpowersTask = {
  readonly ordinal: number;
  readonly heading: string;
  readonly fullBody: string;
  readonly files: readonly string[];
  readonly consumes: readonly string[];
  readonly produces: readonly string[];
  readonly signatures: readonly string[];
  readonly exactValues: readonly string[];
  readonly testAssertions: readonly string[];
  readonly expectedVerification: readonly string[];
};

type ParsedSuperpowersPlan = {
  readonly goal: string;
  readonly architecture: string;
  readonly techStack: string;
  readonly specPath: string;
  readonly globalConstraints: readonly string[];
  readonly reviewFocus: readonly string[];
  readonly tasks: readonly ParsedSuperpowersTask[];
};

type ProjectedSources = {
  readonly requirements: readonly NormativeClause[];
  readonly design: readonly NormativeClause[];
  readonly plan: readonly NormativeClause[];
};

type ConformanceContractPersistenceResult =
  | { readonly kind: "saved" | "already_present"; readonly contractId: string; readonly relativePath: string; readonly digest: string }
  | { readonly kind: "conflict" | "failed"; readonly reason: string };
```

**Task 5**

```ts
type BindPendingInput = {
  readonly authorizationId: string;
  readonly artifactChainId: string;
  readonly planIdentity: string;
  readonly taskIdentity: TaskIdentity;
  readonly executionMethod: "subagent-driven-development" | "executing-plans";
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly dispatchRevision: string;
};

type ResolveTaskIdentityInput = {
  readonly dispatchPrompt: string;
  readonly artifactChain: ApprovedArtifactChain;
  readonly planSnapshot: CanonicalPlanSnapshot;
  readonly fileReader: FileReader;
};
```

**Task 7**

```ts
type ReviewDispatchInput = {
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly taskArgs: Readonly<Record<string, unknown>>;
  readonly executionMethod: SuperpowersExecutionMethod;
  readonly provenance: TrustedSuperpowersProvenance;
  readonly artifactChain: ApprovedArtifactChain;
  readonly executionCorrelation?: ExecutionCorrelation;
  readonly contract: ConformanceContract;
};

type NativeReviewChildContext = {
  readonly childSessionId: string;
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly omoTaskId?: string;
};

type ReviewAppendixInput = {
  readonly correlation: PendingReviewCorrelation & {
    readonly status: "child_bound";
    readonly childSessionId: string;
  };
  readonly contractPath: string;
};

type ResolveReviewChildInput = {
  readonly observed: NativeReviewChildContext;
  readonly pendingReviews: readonly PendingReviewCorrelation[];
};
```

**Task 9**

```ts
type TaskConformanceInput = {
  readonly artifactChain: ApprovedArtifactChain;
  readonly contract: ConformanceContract;
  readonly taskIdentity: TaskIdentity;
  readonly executionMethod: "subagent-driven-development" | "executing-plans";
  readonly executionCorrelation?: ExecutionCorrelation;
  readonly clauseResults: readonly ClauseResult[];
  readonly qualityFindings: readonly ReviewFindingV5[];
  readonly hasTrustedRequiredReview: boolean;
  readonly candidateRevision: string;
};

type PlanConformanceInput = {
  readonly artifactChain: ApprovedArtifactChain;
  readonly contract: ConformanceContract;
  readonly taskVerdicts: readonly ConformanceGateVerdict[];
  readonly finalReviewClosure: FinalReviewEvidenceClosure;
  readonly qualityFindings: readonly ReviewFindingV5[];
  readonly candidateHead: string;
};
```

**Task 10**

```ts
type WorkflowMethodSelection =
  | {
      readonly kind: "selected";
      readonly method: SuperpowersExecutionMethod;
      readonly source: "explicit" | "recovered_selection";
      readonly originSessionId: string;
    }
  | {
      readonly kind: "selection_required";
      readonly reason: "no_authoritative_method";
    };

type WorkflowMethodSelectionEvidence = {
  readonly schemaVersion: "justice-workflow-selection-v1";
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly method: SuperpowersExecutionMethod;
  readonly source: "explicit";
  readonly selectedAt: string;
};

type WorkflowActivationEvidenceKind =
  | "read_tool_result"
  | "host_expanded_skill_input";

type WorkflowActivationEvidence = {
  readonly schemaVersion: "justice-workflow-activation-v1";
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly method: SuperpowersExecutionMethod;
  readonly evidenceKind: WorkflowActivationEvidenceKind;
  readonly observedCallOrInputId: string;
  readonly observedAt: string;
};

type WorkflowActivationInput = {
  readonly sessionId: string;
  readonly authorizationId: string;
  readonly selection: WorkflowMethodSelection;
  readonly currentSessionActivation?: WorkflowActivationEvidence;
  readonly capabilities: {
    readonly provenActivationEvidenceKinds: readonly WorkflowActivationEvidenceKind[];
    readonly subagentExecution: boolean;
  };
};

type WorkflowActivationDecision =
  | {
      readonly kind: "needs_activation";
      readonly selection: Extract<WorkflowMethodSelection, { readonly kind: "selected" }>;
      readonly requiredSkill: SuperpowersExecutionMethod;
    }
  | {
      readonly kind: "already_active";
      readonly selection: Extract<WorkflowMethodSelection, { readonly kind: "selected" }>;
      readonly evidence: WorkflowActivationEvidence;
    }
  | {
      readonly kind: "method_selection_required";
      readonly reason: "no_authoritative_method";
    }
  | {
      readonly kind: "unavailable";
      readonly selection: Extract<WorkflowMethodSelection, { readonly kind: "selected" }>;
      readonly reason: "activation_channel_unavailable" | "subagent_capability_unavailable" | "activation_state_unavailable";
    }
  | {
      readonly kind: "conflict";
      readonly selection: Extract<WorkflowMethodSelection, { readonly kind: "selected" }>;
      readonly reason: "recovered_selection_conflicts_with_current_activation" | "activation_identity_mismatch";
      readonly evidence?: WorkflowActivationEvidence;
    };

type WorkflowActivationStateMutationResult =
  | { readonly kind: "saved" | "idempotent" }
  | { readonly kind: "persistence_failed"; readonly reason: string };

type WorkflowActivationStateLookupResult<T> =
  | { readonly kind: "resolved"; readonly value: T | null }
  | { readonly kind: "untrusted"; readonly reason: "read_failed" | "schema_mismatch"; readonly details: readonly string[] };

interface WorkflowActivationStateStore {
  setSelection(evidence: WorkflowMethodSelectionEvidence): Promise<WorkflowActivationStateMutationResult>;
  setActivation(evidence: WorkflowActivationEvidence): Promise<WorkflowActivationStateMutationResult>;
  findSelection(authorizationId: string): Promise<WorkflowActivationStateLookupResult<WorkflowMethodSelectionEvidence>>;
  findCurrentActivation(
    authorizationId: string,
    sessionId: string,
  ): Promise<WorkflowActivationStateLookupResult<WorkflowActivationEvidence>>;
}

type SemanticExecutionInput =
  | {
      readonly kind: "implementation";
      readonly task: ParsedSuperpowersTask;
      readonly crossTaskDependencies: readonly string[];
    }
  | {
      readonly kind: "review";
      readonly reviewKind: "task-review" | "scoped-re-review" | "final-review";
    };

function resolveWorkflowMethodSelection(input: {
  readonly sessionId: string;
  readonly authorizationId: string;
  readonly explicitMethod?: SuperpowersExecutionMethod;
  readonly recoveredSelection?: WorkflowMethodSelectionEvidence;
}): WorkflowMethodSelection;

function resolveWorkflowActivation(
  input: WorkflowActivationInput,
): WorkflowActivationDecision;

function classifySemanticExecution(
  input: SemanticExecutionInput,
): SemanticClassificationResult;
```

Selection and activation are separate contracts.

Selection precedence is exact:

```text
explicit current selection
> latest trusted selection for the same authorization
> selection_required
```

`WorkflowMethodSelectionEvidence` is one current record per authorization and may be recovered across sessions, but it restores only the selected method. A new explicit selection atomically replaces that record. It never proves current-session activation.

`WorkflowActivationEvidence` is one current record per `authorizationId + sessionId`. A successful later activation atomically replaces that session record. It is trusted only when `authorizationId + sessionId + method` match the active selection, `evidenceKind` is one of `read_tool_result | host_expanded_skill_input` and was PROVEN by Task 1 for the pinned Native stack, `observedCallOrInputId` identifies the exact runtime-observed read/input event, and `setActivation` returned `saved | idempotent`. Task 10 MUST NOT add another activation evidence kind without artifact reconciliation.

Decision rules are exact:

```text
selection_required
→ method_selection_required

selected + exact matching current-session ActivationEvidence
→ already_active
→ no duplicate skill invocation

selected + no current-session ActivationEvidence
→ needs_activation

selected + capability missing
→ unavailable
```

Conflict rules:

- explicit current selection is authoritative over recovered selection; an older current-session activation for another method is not reused, so the explicit method returns `needs_activation`;
- if selection source is only `recovered_selection` and current-session activation evidence names another method, return `conflict`; do not silently choose either;
- mismatched authorization/session identity on activation evidence returns `conflict(activation_identity_mismatch)`.

Cross-session recovery therefore has this exact flow:

```text
recovered selection from prior session
→ needs_activation
→ fresh current-session Task-1-proven skill-loading observation
→ persisted current-session ActivationEvidence
→ already_active
```

Same-session restart may reuse persisted ActivationEvidence only for the exact matching authorization/session/method.

Any store `untrusted` lookup or `persistence_failed` mutation is `activation_state_unavailable`: it cannot produce trusted recovered selection or `already_active`; methodology evidence remains `NOT_PROVEN` until valid state is re-established.

Classifier precedence remains exact:

```text
final-review > review > architecture > deep > integration > mechanical > implementation
```

Implementation classification consumes the full `ParsedSuperpowersTask` plus cross-task dependencies. Keywords are supporting signals only; explicit review kind and structured architecture/integration obligations are authoritative.
**Task 11**

```ts
type ResolveOmoEffectiveConfigInput = {
  readonly cwd: string;
  readonly homeDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly explicitProfile?: string;
  readonly readFile: (path: string) => Promise<string>;
  readonly fileExists: (path: string) => Promise<boolean>;
};
```

### Existing task-local definitions remain canonical at their producer

- Task 3: `ApprovedArtifactChain` / `ApprovedPlanBinding.artifactChain`
- Task 4: `ConformanceContract`
- Task 5: `ExecutionCorrelation` / `ExecutionCorrelationKey`
- Task 7: `JusticeReviewResult`
- Task 9: `ConformanceGateVerdict`
- Task 11: `OmoEffectiveConfigResult`
- Task 13: `JusticeReviewV5View`

---

### Task 1: Prove OmO Native / Senpi / Superpowers Interop Before Production Implementation

**Requirements / Design:** JUS5-COMP-01..04, JUS5-HARNESS-01..03, JUS5-CAT-05, JUS5-ACT-03, JUS5-CORR-02..06, JUS5-REV-06..07, J5D-ACT-01, J5D-CORR-02, J5D-ROUTE-01, J5D-REVIEW-02.

**Scope:** evidence/tests/fixtures only. Do not modify Justice production source in this task.

**Files:**
- Create: `tests/integration/omo-native-senpi-contract-spike.test.ts`
- Create fixtures under: `tests/fixtures/omo-native-senpi/`
- Create evidence note: `docs/reports/omo-native-v5.1.17-senpi-2026.10.8-contract-evidence.md`

**Pinned upstream:**
- OmO Native v5.1.17 / `091728d274f20d62504b0b5e1edbc3970671dd8b`
- Senpi v2026.10.8 / `d56e6a260d9468418a39bc9120945cf98e06b840`
- Superpowers v6.4.2

- [ ] **Step 1: Build a minimal probe extension and fixture session**

The probe records only authoritative event fields/order needed by Justice:
- session id from `ctx.sessionManager.getSessionId()`;
- `tool_call` name/id/input and input mutation visibility;
- `tool_result` id/result;
- child `before_agent_start` / `context` session identity;
- session lifecycle needed for restart/compaction;
- input/read evidence needed for Superpowers method activation.

Do not add a Justice reviewer or scheduler.

- [ ] **Step 2: Write exact runtime evidence tests**

Required tests:

- `loads_omo_and_superpowers_pi_packages_together`
- `superpowers_using_superpowers_bootstrap_is_present_in_native_context`
- `native_task_tool_call_exposes_mutable_input_session_and_tool_call_id`
- `native_task_enforces_category_subagent_type_xor`
- `native_background_task_returns_runtime_id_without_becoming_task_identity`
- `native_task_send_continuation_remains_omo_owned`
- `superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch`
- `native_superpowers_task_provenance_is_authoritatively_bound_without_prompt_inference`
- `unrelated_model_issued_task_is_not_classified_as_superpowers`
- `review_like_prompt_without_provenance_remains_untrusted`
- `native_task_result_and_child_context_form_unique_parent_child_binding`
- `native_review_appendix_reaches_exact_bound_child_before_trusted_output`
- `unrelated_child_cannot_consume_pending_review_appendix`
- `native_method_skill_load_produces_current_session_activation_evidence`
- `compaction_activation_survival_is_observed_not_assumed`

- [ ] **Step 3: Run the spike against the pinned Native stack**

Run:
```bash
bun run vitest run tests/integration/omo-native-senpi-contract-spike.test.ts
```

The test fixture MUST create its own isolated HOME/agent directory and refuse to run against versions other than the pinned OmO/Senpi/Superpowers baseline.

Expected: every required contract is either **PROVEN with captured event evidence** or the Task is BLOCKED. No “probably equivalent to OpenCode” result is acceptable.

- [ ] **Step 4: Freeze the selected Native adapter contract in the evidence note**

Record:
- exact event names/fields/order;
- exact parent-call ↔ runtime-task ↔ child binding;
- exact review appendix injection seam;
- exact method activation evidence seam and which bounded `WorkflowActivationEvidenceKind` values are PROVEN;
- exact Native Superpowers provenance source and a stable `profileId`;
- exact session/call identity and correlation fields used by the provenance profile;
- how the mapping appendix / active workflow intent is authoritatively bound to that exact task call;
- how unrelated and merely review-looking model-issued task calls are rejected;
- how restart and compaction affect provenance validity;
- compaction activation result;
- process vs in-process differences, if any;
- exact public package/import surface used by a Justice extension.

If any result contradicts Requirements/Design, STOP for artifact reconciliation before Task 2.

- [ ] **Step 5: Commit evidence only**

Expected commit scope contains only the spike tests/fixtures/evidence note.

---

### Task 2: Establish Native Semantic Routing Types and Pure OmO Task Translation

**Requirements / Design:** JUS5-CAT-01..05, JUS5-CAT-09, JUS5-CORR-01, JUS5-CORR-05..06, JUS5-TASK-03..04, J5D-CORR-01, J5D-ROUTE-01, J5D-CAT-01..02.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/task-packager.ts`
- Modify: `src/core/omo-category-mapper.ts`
- Test: `tests/core/v5-task-routing-contract.test.ts`
- Test: `tests/core/omo-category-mapper-v5.test.ts`

**Interfaces:**
- Produces registry-defined semantic types.
- Known Native built-in diagnostic vocabulary includes `architect` in addition to visual-engineering, artistry, ultrabrain, deep-low, deep-high, quick, unspecified-low, unspecified-high, and writing.
- `TaskRoutingTarget` is the canonical registry type above for a **new-child task call**.
- `task_send` is parsed separately as OmO-owned runtime continuation; it never enters new-child category translation.
- Task 2 provenance domain MUST NOT import, reference, or otherwise depend on Task 10-owned `WorkflowActivationEvidence`; `NativeSuperpowersProvenanceInput` is fully defined by Task 2-owned/runtime-observed fields.
- `translateTaskRouting(input: TranslateTaskRoutingInput): SuperpowersRoutingTranslationResult` is the only pure routing translation contract.
- `external` provenance preserves the explicit caller route and accepts no semantic classification input.
- `ambiguous` provenance cannot become trusted translation and accepts no semantic classification input.
- `superpowers` provenance requires an explicit `SemanticClassificationResult`; classified work may become one `sp-*` category while ambiguous classification remains untrusted.
- `translateTaskRouting` never re-infers origin and never chooses model/provider/reasoning/execution-mode/retry/fallback.

- [ ] **Step 1: Write RED Native routing tests**

Exact tests:
- `never_serializes_justice_task_identity_as_omo_runtime_task_id`
- `preserves_task_send_runtime_continuation_target`
- `reports_category_subagent_type_as_invalid_both`
- `reports_missing_category_and_subagent_type_as_unrouted`
- `preserves_non_superpowers_explicit_subagent_type_without_category_injection`
- `preserves_superpowers_specialized_non_generic_subagent_type_without_category_injection`
- `preserves_explicit_category_without_subagent_type_injection`
- `preserves_user_defined_omo_category_without_translation`
- `recognized_superpowers_task_translates_classified_intent_to_one_sp_category`
- `recognized_superpowers_task_never_emits_category_and_subagent_type_together`
- `ambiguous_superpowers_semantic_classification_is_untrusted`
- `justice_does_not_select_concrete_model_or_provider`
- `task2_provenance_contract_does_not_depend_on_task10_activation_state`
- `routing_translation_consumes_explicit_provenance_without_reinferring_origin`

Category tests:
- `does_not_emit_legacy_deep`
- `recognizes_native_architect_deep_low_deep_high_artistry`
- `custom_sp_categories_coexist_with_omo_v5_categories`
- `maps_semantic_execution_classes_to_exact_sp_categories`

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts`

Expected: FAIL on stale OpenCode continuation assumptions, missing Native category vocabulary, any Task 2 provenance type that depends on Task 10 activation state, or any routing path that attempts to infer Superpowers origin instead of consuming explicit provenance.

- [ ] **Step 3: Implement pure Native routing domain**

Do not decide whether a call belongs to Superpowers here. Do not dispatch a task. Do not alter `task_send`.

- [ ] **Step 4: Run GREEN + typecheck**

```bash
bun run vitest run tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts
bun run typecheck
```

Expected: PASS, including Native category XOR, open caller category preservation, and no concrete model/provider selection.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/task-packager.ts src/core/omo-category-mapper.ts \
  tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts
git commit -m "feat: define Native semantic routing contracts"
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
  type ArtifactFingerprint = {
    readonly algorithm: "sha256";
    readonly value: string;
  };

  type ArtifactRevisionRef = {
    readonly path: string;
    readonly sourceFingerprint: ArtifactFingerprint;
    readonly sourceRevision?: string;
  };

  type PlanArtifactRevisionRef = {
    readonly path: string;
    readonly planFingerprint: PlanFingerprint;
    readonly canonicalSnapshot: CanonicalPlanSnapshot;
    readonly sourceRevision?: string;
  };

  type ApprovedArtifactChain = {
    readonly chainId: string;
    readonly requirements: ArtifactRevisionRef;
    readonly design: ArtifactRevisionRef;
    readonly plan: PlanArtifactRevisionRef;
    readonly artifactFingerprintSchema: "justice-artifact-v1";
    readonly planFingerprintSchema: "justice-plan-v1";
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
- Produces:
  - `computeArtifactFingerprint(raw: string): ArtifactFingerprint` using SHA-256 after CRLF→LF normalization.
  - `resolveArtifactChainSources(planPath: string, fileReader: FileReader): Promise<ArtifactChainSourceResolution>`.
    - Plan must contain exactly one safe repository-relative `**Spec:** \`...\`` reference.
    - bound Design must contain exactly one safe repository-relative `**Requirements:** \`...\`` reference.
    - missing, ambiguous, unreadable, or unsafe references fail closed.
  - `buildApprovedArtifactChain(input: BuildApprovedArtifactChainInput): ApprovedArtifactChain`; `chainId` is a fresh `randomUUID()`, Requirements/Design use `justice-artifact-v1`, and Plan uses existing `justice-plan-v1`.
  - `classifyPriorJusticeState(raw): PriorStateClassification` for `justice-plan-v1`, PersistedEnvelope v1, ReviewSnapshot v1, and legacy human review resolutions.

- [ ] **Step 1: Write RED artifact-chain and migration tests**

Exact required tests:
- `preserves_authorization_for_checkbox_only_plan_progress`
- `invalidates_chain_when_plan_contract_changes`
- `design_change_stales_bound_plan_authority`
- `design_plan_mismatch_stales_downstream_authority`
- `requirements_change_stales_design_and_plan_authority`
- `reapproval_creates_new_artifact_chain_id`
- `clean_review_evidence_does_not_create_human_authorization`
- `v4_plan_authorization_is_not_promoted_to_v5_authority`
- `unknown_or_newer_authoritative_state_is_preserved_not_rewritten`
- `resolves_requirements_design_plan_chain_from_declared_metadata`
- `missing_or_ambiguous_artifact_reference_blocks_authorization`

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/artifact-chain.test.ts tests/core/plan-authorization.test.ts tests/core/v5-persistence.test.ts`

Expected: FAIL because current authorization is plan-only and reads the v4 file as authority. `clean_review_evidence_does_not_create_human_authorization` must specifically fail until a trusted clean review remains non-authorizing unless the exact current Requirements→Design→Plan chain has explicit human approval.

- [ ] **Step 3: Implement artifact-chain and v5 authorization persistence**

Reuse `AtomicPersistence`. Preserve the existing authorization review boundary/locking semantics. Do not fabricate Requirements/Design lineage during migration.

Minimum GREEN behavior for the v4.3.1 authorization regression: review/conformance evidence may be attached to the current chain, but it must never create, replace, or upgrade human implementation authorization. Only explicit approval of the exact current `ApprovedArtifactChain` can authorize implementation.

- [ ] **Step 4: Mechanically migrate every baseline direct consumer**

Only these substitutions are allowed in the four consumer files in this task:

```text
binding.planPath          → binding.artifactChain.plan.path
binding.planFingerprint   → binding.artifactChain.plan.planFingerprint
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

Expected: PASS, including `clean_review_evidence_does_not_create_human_authorization`; a clean trusted review remains non-authorizing until explicit human approval exists for the exact current artifact chain.

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
- Create: `src/core/conformance-contract-store.ts`
- Create: `src/core/superpowers-plan-parser.ts`
- Create: `src/core/conformance-projector.ts`
- Modify: `src/core/plan-parser.ts` only to share canonical task-section helpers; do not make checkbox text the v5 semantic authority.
- Test: `tests/core/superpowers-plan-parser.test.ts`
- Test: `tests/core/conformance-projector.test.ts`
- Test: `tests/core/conformance-contract.test.ts`
- Test: `tests/core/conformance-contract-store.test.ts`

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
- Conformance Contract persistence is immutable at `.justice/v5/conformance-contracts/<contractId>.json`.
  - The hash payload contains exactly `schemaVersion`, `artifactChainId`, `projectionStatus`, `clauses`, and `diagnostics`; it excludes the derived `contractId` and `digest` fields.
  - Canonical JSON recursively sorts object keys lexicographically, preserves array order, and serializes JSON primitives with normal `JSON.stringify` semantics; `undefined`, non-finite numbers, functions, symbols, and other non-JSON values are rejected before hashing.
  - `digest = hashString(canonicalJson(hashPayload))`, yielding `sha256:<lowercase hex>` through the existing `src/core/v2/hash.ts` helper.
  - `contractId` is exactly the lowercase hex portion of that `digest` with the `sha256:` prefix removed.
  - saving the same ID+digest is idempotent; same ID with different content is a conflict and fail-closed.
  - reviewers receive the repository-relative path returned by this store.
- Exact producer signatures:
  - `parseSuperpowersPlan(markdown: string): ProjectionResult<ParsedSuperpowersPlan>`
  - `projectRequirementsClauses(markdown: string, ref: ArtifactRevisionRef): ProjectionResult<readonly NormativeClause[]>`
  - `projectDesignClauses(markdown: string, ref: ArtifactRevisionRef): ProjectionResult<readonly NormativeClause[]>`
  - `projectPlanClauses(markdown: string, ref: PlanArtifactRevisionRef): ProjectionResult<readonly NormativeClause[]>`
  - `buildConformanceContract(chain: ApprovedArtifactChain, sources: ProjectedSources): ConformanceContract`
  - `saveConformanceContract(contract: ConformanceContract): Promise<ConformanceContractPersistenceResult>`
- Plan parser recognizes Goal, Architecture, Tech Stack, Spec, Global Constraints, Review Focus, Task Files, Interfaces/Consumes/Produces, signatures, exact values, test assertions, and Expected lines.

- [ ] **Step 1: Write RED parser/projection tests**

Include exact test:
- `projection_failures_never_return_complete` — duplicate ID, missing source, ambiguous source, unsupported Plan structure, parser failure, source revision mismatch, and unmappable normative unit each produce `INCOMPLETE` or `INVALID`, never `COMPLETE`.
- `persists_contract_immutably_at_reviewer_readable_path` — exact contract body is readable from the returned repo-relative path.
- `same_contract_save_is_idempotent_but_digest_conflict_fails_closed`.

Also assert:
- every `JUS5-*` heading produces deterministic source identity + suffixes;
- Design projection enumerates exactly `INV-01..06` + `J5D-*`;
- structural multi-obligation units stay one clause;
- projection schema participates in contract identity.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/superpowers-plan-parser.test.ts tests/core/conformance-projector.test.ts tests/core/conformance-contract.test.ts tests/core/conformance-contract-store.test.ts`

Expected: FAIL because these modules do not exist.

- [ ] **Step 3: Implement deterministic parsing/projection**

Do not use LLM extraction as enumeration authority. Do not infer clauses by searching for `MUST` alone.

- [ ] **Step 4: Run GREEN tests and typecheck**

```bash
bun run vitest run tests/core/superpowers-plan-parser.test.ts tests/core/conformance-projector.test.ts \
  tests/core/conformance-contract.test.ts tests/core/conformance-contract-store.test.ts
bun run typecheck
```

Expected: PASS; projection failures never become COMPLETE and immutable Conformance Contract persistence remains deterministic.

- [ ] **Step 5: Commit**

```bash
git add src/core/conformance-contract.ts src/core/conformance-contract-store.ts src/core/superpowers-plan-parser.ts \
  src/core/conformance-projector.ts src/core/plan-parser.ts \
  tests/core/superpowers-plan-parser.test.ts tests/core/conformance-projector.test.ts \
  tests/core/conformance-contract.test.ts tests/core/conformance-contract-store.test.ts
git commit -m "feat: project versioned conformance contracts"
```

---

### Task 5: Add Durable Native ExecutionCorrelation and Task-Brief-Based Semantic Resolution

**Requirements / Design:** JUS5-CORR-02..05, JUS5-TASK-01..04, JUS5-REC-01..03, J5D-CORR-02, J5D-REC-01.

**Files:**
- Create: `src/core/execution-correlation.ts`
- Create: `src/core/superpowers-dispatch-resolver.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/execution-correlation.test.ts`
- Test: `tests/core/superpowers-dispatch-resolver.test.ts`

**Interface:**
```ts
type ExecutionCorrelation = {
  readonly authorizationId: string;
  readonly artifactChainId: string;
  readonly planIdentity: string;
  readonly taskIdentity: TaskIdentity;
  readonly executionMethod: SuperpowersExecutionMethod;
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly omoTaskId?: string;
  readonly childSessionId?: string;
  readonly dispatchRevision: string;
  readonly status: "pending" | "runtime_observed" | "child_observed" | "terminal" | "untrusted";
};

type ExecutionCorrelationKey = {
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
};
```

Store: `.justice/v5/execution-correlations.json`.

Runtime task/child attachment methods must use only the exact identities/fields Task 1 proved. No `ses_...` or OpenCode parent lookup assumptions remain.

- [ ] **Step 1: RED correlation tests**

Cover:
- same session + toolCallId idempotence;
- conflicting semantic task for same call → untrusted;
- unrelated `st_...` id/name cannot rebind semantic task;
- runtime task id can attach only to the matching pending call;
- child session can attach only through Task-1-proven relation;
- persistence failure → `persistence_failed`;
- restart uses durable state;
- TaskIdentity is never serialized into OmO task/task_send args.

- [ ] **Step 2: RED task-brief identity tests**

Keep the existing exact task-body preservation/digest tests.

- [ ] **Step 3: Run RED**

```bash
bun run vitest run tests/core/execution-correlation.test.ts tests/core/superpowers-dispatch-resolver.test.ts
```

Expected: FAIL because durable Native parent-session/tool-call correlation and Task-1-proven runtime task/child attachment do not yet exist.

- [ ] **Step 4: Implement with AtomicPersistence and existing Plan canonicalization**

- [ ] **Step 5: Run GREEN + typecheck**

```bash
bun run vitest run tests/core/execution-correlation.test.ts tests/core/superpowers-dispatch-resolver.test.ts
bun run typecheck
```

Expected: PASS; runtime task/child identities attach only through trusted correlation and never replace semantic TaskIdentity.

- [ ] **Step 6: Commit**

```bash
git add src/core/execution-correlation.ts src/core/superpowers-dispatch-resolver.ts src/core/types.ts \
  tests/core/execution-correlation.test.ts tests/core/superpowers-dispatch-resolver.test.ts
git commit -m "feat: persist Native execution correlation"
```

---

### Task 6: Wire Senpi Events to Durable Execution Correlation and Produce Native Superpowers Provenance

**Requirements / Design:** JUS5-HARNESS-01..03, JUS5-CAT-05, JUS5-CORR-02..06, JUS5-SDD-01..04, JUS5-INLINE-01..02, J5D-CORR-02, J5D-ROUTE-01, J5D-OWN-01.

**Consumes:**
- Task 1 evidence note, including the exact public Senpi package/import surface and the PROVEN `NativeSuperpowersProvenanceProfile`;
- Task 2 `TaskRoutingProvenance`, `NativeSuperpowersProvenanceInput`, `NativeSuperpowersProvenanceProfile`, `NativeSuperpowersProvenanceResolver`;
- Task 5 `ExecutionCorrelation` / `ExecutionCorrelationKey`.

**Produces:**
- Justice Senpi/Pi extension entrypoint;
- runtime `NativeSuperpowersProvenanceResolver`;
- runtime provenance evidence bound to `parentSessionId + parentToolCallId`;
- durable runtime task/child correlation updates.

**Files:**
- Create: `src/senpi-extension.ts`
- Create: `src/runtime/senpi-adapter.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/core/types.ts` only for Native adapter payloads.
- Modify: `package.json`
- Create: `tests/runtime/senpi-adapter-execution-correlation.test.ts`
- Create: `tests/runtime/senpi-adapter-provenance.test.ts`

**Package/build contract:**
- `src/senpi-extension.ts` is the Native extension entrypoint and imports `ExtensionAPI` from the exact public module specifier proven by Task 1; the audited expected specifier is `@code-yeongyu/senpi`.
- Task 1 MUST prove that this specifier is resolvable for the repository build. If it is not, STOP for artifact reconciliation; Task 6 must not choose an alternative SDK/package ad hoc.
- `package.json` adds an exact `./senpi` export:
  ```json
  {
    "./senpi": {
      "import": "./dist/senpi-extension.js",
      "types": "./dist/senpi-extension.d.ts"
    }
  }
  ```
- Add `@code-yeongyu/senpi` version `2026.10.8` as a **devDependency only** for TypeScript extension API types; do not add Senpi as a Justice runtime dependency and do not bundle Senpi into Justice.
- Existing `tsc` emission is the build authority for `dist/senpi-extension.js/.d.ts`; the OpenCode bundle command remains unchanged.

**Interfaces:**
- `tool_call(task)` is the pre-execution binding/routing seam.
- `ctx.sessionManager.getSessionId() + event.toolCallId` create the pending correlation.
- `event.input` may be mutated only after trusted provenance/classification permits translation.
- `tool_result(task)` and the exact Task-1-proven lifecycle surface attach runtime task/child identity.
- `resolveNativeSuperpowersProvenance(input, profile)` is the only runtime producer of trusted `TaskRoutingProvenance.kind === "superpowers"`.
- prompt wording, active method alone, task-body similarity, review-looking text, and mapping-appendix presence alone are rejected as provenance authority.
- OpenCode adapter code is not used as Native authority and is not deleted merely to implement Native.

- [ ] **Step 1: Write RED correlation and provenance tests**

Correlation:
- `persists_native_execution_correlation_before_task_execution`
- `attaches_omo_task_and_child_from_proven_native_surface`
- `conflicting_runtime_child_binding_marks_correlation_untrusted`
- `task_send_continuation_is_not_rewritten_by_justice`
- `correlation_persistence_failure_proceeds_runtime_but_not_evidence`
- `recovers_native_task_call_from_durable_parent_session_tool_call_binding`

Provenance:
- `task1_proven_profile_produces_superpowers_provenance_for_exact_bound_call`
- `unrelated_model_issued_task_resolves_external`
- `review_like_prompt_without_required_runtime_evidence_resolves_ambiguous`
- `restart_or_compaction_invalidates_provenance_when_profile_does_not_allow_reuse`
- `provenance_evidence_binds_parent_session_and_tool_call_id`
- `mutates_only_existing_model_issued_task_call`
- `invalid_both_target_routing_is_not_trusted`
- `does_not_create_extra_task_or_reviewer_dispatch`

- [ ] **Step 2: Run RED**

```bash
bun run vitest run \
  tests/runtime/senpi-adapter-execution-correlation.test.ts \
  tests/runtime/senpi-adapter-provenance.test.ts
```

Expected: FAIL because the Native adapter, package export, and authoritative provenance resolver do not yet exist.

- [ ] **Step 3: Implement the exact Task-1-proven Native event/profile wiring**

Minimum GREEN:
- persist pending correlation before execution;
- apply only the Task-1-proven provenance profile;
- resolve unrelated task calls to `external` and missing/conflicting evidence to `ambiguous`;
- produce trusted Superpowers provenance only with non-empty evidence refs bound to the exact parent session/tool call;
- attach runtime task/child identity only through the proven Native surface;
- never dispatch a task/reviewer or rewrite `task_send`.

- [ ] **Step 4: Run GREEN + Task 1 evidence replay + typecheck/build**

```bash
bun run vitest run tests/integration/omo-native-senpi-contract-spike.test.ts
bun run vitest run \
  tests/runtime/senpi-adapter-execution-correlation.test.ts \
  tests/runtime/senpi-adapter-provenance.test.ts
bun run typecheck
bun run build
```

Expected: PASS, including `task1_proven_profile_produces_superpowers_provenance_for_exact_bound_call`; `dist/senpi-extension.js` and `dist/senpi-extension.d.ts` are emitted without bundling Senpi.

- [ ] **Step 5: Commit exact Task 6 boundary**

```bash
git add package.json src/senpi-extension.ts src/runtime/senpi-adapter.ts \
  src/core/justice-plugin.ts src/core/types.ts \
  tests/runtime/senpi-adapter-execution-correlation.test.ts \
  tests/runtime/senpi-adapter-provenance.test.ts
git commit -m "feat: add Native Senpi correlation and provenance adapter"
```

---

### Task 7: Implement Native Superpowers Review Recognition, Child Delivery, Open-Set Finding Transport, and Strict Parsing

**Requirements / Design:** JUS5-REV-01..09, JUS5-SDD-03, JUS5-CAT-05, JUS5-CAT-09, JUS5-CORR-06, J5D-REVIEW-01..04, J5D-ROUTE-01..02, J5D-CAT-02.

**Files:**
- Create: `src/core/review-interop.ts`
- Create: `src/core/review-result.ts`
- Modify: `src/runtime/senpi-adapter.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/review-interop.test.ts`
- Test: `tests/core/review-result.test.ts`
- Create: `tests/runtime/senpi-adapter-review-interop.test.ts`

**Consumes:**
- Task 1 PROVEN child/reviewer delivery profile;
- Task 6 trusted `TaskRoutingProvenance` and bound runtime child correlation.

**Interfaces:**
- Task 7 MUST NOT infer Superpowers provenance from prompt/review text; only `TaskRoutingProvenance.kind === "superpowers"` produced by Task 6 may enter trusted review recognition.
- Preserve the existing `ReviewKindV5`, `ReviewResultExpectation`, `JusticeReviewResult`, finding marker `[[justice-finding:<id>]]`, scoped target extraction, lineage reservation, and strict parser contracts.
- Review recognition occurs on the **existing model-issued `task` call** before execution.
- recognized task/scoped review → `sp-review`; final review → `sp-final-review`.
- Justice mutates only the existing Native `task` input; it does not dispatch the reviewer.
- Child binding and appendix delivery use exactly the Task-1-proven Native surface. No `client.session.get`, OpenCode `chat.message`, synthetic OpenCode Part, or v4 controller wrapper is allowed.
- transport/binding ambiguity → no trusted appendix/result → `NOT_PROVEN`.

- [ ] **Step 1: RED core marker/result tests**

Retain the current exact open-set/finding-ID/parser tests from the v5 Plan, including:
- `superpowers_open_finding_marker_is_used_as_scoped_identity_authority`
- `spec_only_scoped_rereview_allows_empty_expected_findings`
- `missing_or_malformed_review_result_is_rejected`
- historical finding-ID collision/reservation cases.

- [ ] **Step 2: RED Native adapter review tests**

Exact tests:
- `does_not_dispatch_duplicate_reviewer_for_recognized_superpowers_review`
- `superpowers_task_review_maps_existing_native_task_to_sp_review`
- `superpowers_scoped_rereview_maps_existing_native_task_to_sp_review`
- `superpowers_final_review_maps_existing_native_task_to_sp_final_review`
- `recognized_review_translation_preserves_native_category_subagent_xor`
- `native_bound_child_receives_conformance_contract_before_trusted_output`
- `unrelated_native_child_cannot_receive_review_appendix`
- `binding_or_transport_failure_blocks_review_evidence`
- `empty_expected_findings_still_deliver_clause_reproof_contract`
- `ambiguous_review_like_action_is_not_trusted_without_recognized_superpowers_provenance`
- `review_dispatch_requires_task6_trusted_superpowers_provenance`

For the final test, a review-looking task lacking recognized Superpowers provenance must remain untrusted and cannot satisfy review acceptance.

- [ ] **Step 3: Run RED**

Run:
```bash
bun run vitest run tests/core/review-interop.test.ts tests/core/review-result.test.ts tests/runtime/senpi-adapter-review-interop.test.ts
```

Expected: FAIL because trusted Task-6 provenance consumption, Task-1-proven child delivery, and strict Native review parsing are not yet wired.

- [ ] **Step 4: Implement review recognition/delivery/parser using only Task-1-proven Native seams**

Task 7 ships a fail-closed unavailable finding-context provider until Task 8 wires persistence. `ReviewDispatchInput.provenance` is required and typed as `TrustedSuperpowersProvenance`; Task 7 must not reconstruct provenance from adapter-local state, prompt/review text, execution method, or task shape.

- [ ] **Step 5: Run GREEN + Task 1 evidence replay + typecheck**

```bash
bun run vitest run tests/integration/omo-native-senpi-contract-spike.test.ts
bun run vitest run tests/core/review-interop.test.ts tests/core/review-result.test.ts tests/runtime/senpi-adapter-review-interop.test.ts
bun run typecheck
```

Expected: PASS; `review_dispatch_requires_task6_trusted_superpowers_provenance` proves the canonical input rejects any review path without Task 6 trusted provenance, the existing Superpowers reviewer dispatch count remains exactly one, and review-looking calls without that provenance remain untrusted.

- [ ] **Step 6: Commit**

```bash
git add src/core/review-interop.ts src/core/review-result.ts src/runtime/senpi-adapter.ts src/core/types.ts \
  tests/core/review-interop.test.ts tests/core/review-result.test.ts \
  tests/runtime/senpi-adapter-review-interop.test.ts
git commit -m "feat: bind trusted Native Superpowers review evidence"
```

---

### Task 8: Persist Review Evidence and Resolve Metadata for the Current Superpowers Open Set

**Requirements / Design:** JUS5-REV-08..11, JUS5-QUALITY-01..03, JUS5-ACC-03, J5D-QUALITY-01, J5D-STORAGE-01, J5D-REVIEW-03..04.

**Files:**
- Create: `src/core/review-evidence-store.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/v2/review-types.ts`
- Modify: `src/core/v2/review-aggregator.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/core/review-resolution-artifact.ts`
- Test: `tests/core/review-evidence-store.test.ts`
- Test: `tests/core/review-quality-v5.test.ts`
- Test: `tests/core/v2/review-aggregator.test.ts`
- Test: `tests/core/v2/state-projection-review.test.ts`
- Test: `tests/runtime/senpi-adapter-review-interop.test.ts`

**Interfaces:**
- Consumes canonical `FindingId` / `ReviewFindingV5` from Task 2 and `JusticeReviewResult`, `ReviewFindingContextQuery`, `ReviewFindingContextResult`, and `ReviewFindingContextProvider` from Task 7.
- v5 evidence path: `.justice/v5/review-evidence.json`.
- `ReviewEvidenceStore` implements `ReviewFindingContextProvider`.
- The store **does not select the current open set**. `query.requestedFindingIds` from the current recognized Superpowers scoped dispatch is authoritative.
- The store additionally owns trusted lineage reservation evidence: `reservedFindingIds` is collision-prevention data only and never expands `expectedFindings`.

**Exact context and reservation resolution:**
1. Resolve exactly one trusted immediate preceding review using:
   - `artifactChainId`;
   - exact task/final scope;
   - exact `TaskIdentity` for task scope;
   - `reviewedRange.head === precedingReviewedHead`.
2. Zero candidate → `not_found`; multiple → `ambiguous`; untrusted-only source → `untrusted`.
3. Validate `requestedFindingIds` has no duplicates.
4. Build the trusted lineage for collision prevention.
   - task scope key = `artifactChainId + exact TaskIdentity`;
   - start at the resolved immediate preceding result;
   - if it is `task-review`, it is the root;
   - if it is `scoped-re-review`, its `reviewedRange.base` MUST equal the `reviewedRange.head` of exactly one earlier trusted review with the same task-scope key;
   - traverse backward until one `task-review` root is reached;
   - missing predecessor → `untrusted("task_lineage_gap")`;
   - multiple predecessor candidates → `ambiguous`;
   - repeated review correlation / cycle → `untrusted("task_lineage_cycle")`;
   - final scope: the resolved immediate preceding result MUST be a trusted `final-review`; a `scoped-re-review` predecessor would imply a second final scoped review and returns `untrusted("invalid_final_lineage")`;
   - do not include unrelated tasks, other artifact chains, or another final-review lifecycle.
5. Reverse the resolved task chain into root→preceding order (or use the single full-final root for final scope).
6. Build a historical ID registry from every quality finding in that resolved lineage, including deferred Minor, resolved, parked, and human-adjudicated findings.
7. Repeated occurrences of the same ID are valid only when `severity + summary + location` are identical. Disposition/evidence refs may change. Conflicting immutable metadata → `untrusted("historical_finding_id_collision")`.
8. Produce `reservedFindingIds` as the unique historical IDs in deterministic first-seen root→preceding order.
9. Derive the quality open-set that Superpowers v6.4.2 is permitted to carry from the **immediate preceding result**:
   - task scope: findings with `disposition === "open"` and severity `critical | important`; Minor is excluded from the task fix loop;
   - final scope: findings with `disposition === "open"` of any severity because the final fix subagent receives the complete final-review findings list.
10. The current dispatch remains the target authority, but its requested ID **set must equal** that permitted immediate open-set ID set. Set mismatch → `untrusted("requested_set_mismatch")`.
11. `requestedFindingIds = []` is valid when the permitted quality open set is also empty; return `resolved(expectedFindings=[], reservedFindingIds=<lineage IDs>)`.
12. For every requested ID:
   - it exists exactly once in the trusted immediate preceding review;
   - task scope rejects Minor/resolved/parked/human-adjudicated targets;
   - final scope rejects resolved/parked/human-adjudicated targets;
   - project immutable ID/severity/summary/location into `ReviewFindingTarget`.
13. Require every expected finding ID to be present in `reservedFindingIds`, then return `expectedFindings` in current dispatch marker order and `reservedFindingIds` in deterministic first-seen root→preceding order.
14. No summary/location/order similarity is used for identity.

This supports:
- initial Important + Minor → task scoped target contains Important only;
- round N resolved finding → absent from round N+1 requested set;
- round N NOT ADDRESSED finding → same marker/ID remains;
- new Critical/Important scoped breakage → marker survives when Superpowers adds it to the next open list;
- spec-only fix round → empty requested/expected quality set while clause re-proof continues;
- deferred Minor ID remains reserved without becoming a current expected target;
- prior resolved ID remains reserved without being reintroduced into a later round;
- historical same-ID/different-metadata evidence is fail-closed rather than normalized.

`src/core/justice-plugin.ts` replaces Task 7's unavailable provider with the store-backed provider. No review/fix scheduling is added.

Legacy `major` deserializes only through migration as `important`. Human review-resolution artifacts remain quality-only and cannot set conformance clause status.

- [ ] **Step 1: Write RED evidence/open-set tests**

In `tests/core/review-evidence-store.test.ts`:
- `scoped_context_resolves_exact_trusted_preceding_review_head`
- `requested_open_finding_ids_resolve_in_dispatch_order`
- `minor_finding_excluded_from_task_open_set`
- `addressed_finding_is_not_reintroduced_in_next_fix_round`
- `next_round_expected_findings_match_only_current_superpowers_open_finding_ids`
- `new_blocking_breakage_marker_survives_into_next_scoped_round`
- `reserved_finding_ids_cover_trusted_task_review_lineage`
- `reserved_finding_ids_cover_trusted_final_review_lineage`
- `deferred_minor_finding_id_is_reserved_but_not_expected`
- `resolved_prior_round_finding_id_is_reserved_but_not_expected`
- `historical_finding_id_collision_is_untrusted`
- `task_reserved_lineage_requires_contiguous_reviewed_range_chain`
- `ambiguous_task_lineage_predecessor_is_untrusted`
- `second_scoped_final_predecessor_is_invalid_final_lineage`
- `spec_only_scoped_rereview_resolves_empty_expected_findings`
- `unknown_requested_finding_id_is_untrusted`
- `duplicate_requested_finding_id_is_untrusted`
- `missing_current_open_marker_is_untrusted`
- `scoped_context_wrong_base_is_not_found`
- `scoped_context_ambiguous_preceding_review_is_untrusted`
- `untrusted_preceding_review_cannot_supply_scoped_finding_context`

In `tests/runtime/senpi-adapter-review-interop.test.ts`:
- `store_backed_provider_uses_current_scoped_marker_ids_for_expected_findings`
- `store_backed_provider_supplies_lineage_reserved_finding_ids`
- `empty_store_backed_expected_findings_still_inject_clause_reproof_appendix`

Existing quality tests remain:
- `not_addressed_finding_remains_blocking`
- `parked_important_finding_remains_visible_and_blocking`
- `parked_critical_or_important_blocks_until_trusted_disposition`

Also assert Minor retention, human-adjudication/clause separation, legacy-major migration, trusted direct output, and untrusted plain-file fallback.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/review-evidence-store.test.ts tests/core/review-quality-v5.test.ts tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts tests/runtime/senpi-adapter-review-interop.test.ts`

Expected: FAIL on current-open-set metadata resolution and marker-aware production wiring.

- [ ] **Step 3: Implement persistence and store-backed current-open-set context**

Persist trusted structured review evidence. Implement `ReviewFindingContextProvider` as exact metadata resolution/validation for dispatch-provided IDs plus lineage-wide reserved-ID evidence. Do not infer a replacement target set. Historical same-ID metadata conflicts are `untrusted`, never normalized.

Wire the store-backed provider through `justice-plugin.ts` into Task 7 review interop.

- [ ] **Step 4: Run GREEN tests + Task 7 marker/open-set regressions + typecheck**

```bash
bun run vitest run tests/core/review-evidence-store.test.ts tests/core/review-quality-v5.test.ts \
  tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts \
  tests/runtime/senpi-adapter-review-interop.test.ts
bun run typecheck
```

Expected: PASS, including multi-round behavior, lineage-reserved IDs, and spec-only empty-quality context.

- [ ] **Step 5: Commit**

```bash
git add src/core/review-evidence-store.ts src/core/justice-plugin.ts src/core/types.ts src/core/v2/review-types.ts \
  src/core/v2/review-aggregator.ts src/core/v2/state-projection.ts src/core/review-resolution-artifact.ts \
  tests/core/review-evidence-store.test.ts tests/core/review-quality-v5.test.ts \
  tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts \
  tests/runtime/senpi-adapter-review-interop.test.ts
git commit -m "feat: resolve scoped metadata for Superpowers open findings"
```

---

### Task 9: Make Conformance, Quality, and Type-Safe Final Review Evidence First-Class Acceptance Gates

**Requirements / Design:** JUS5-GATE-01..02, JUS5-CONFORM-01..09, JUS5-ACC-01..04, JUS5-COMPLETE-01, JUS5-REV-08..09, J5D-GATE-01, J5D-COMPLETE-01, J5D-REVIEW-03..04.

**Files:**
- Create: `src/core/conformance-gate.ts`
- Create: `src/runtime/revision-diff-provider.ts`
- Modify: `src/core/acceptance-decision.ts`
- Modify: `src/core/v2/gate-context.ts`
- Modify: `src/core/v2/decision-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Test: `tests/core/conformance-gate.test.ts`
- Test: `tests/core/acceptance-decision.test.ts`
- Test: `tests/core/plan-completion-v5.test.ts`
- Test: `tests/runtime/revision-diff-provider.test.ts`

**Interfaces:**
- Consumes `ApprovedArtifactChain`, `ConformanceContract`, `ClauseResult`, `ClauseEvidenceScope`, `ExecutionCorrelation`, trusted `JusticeReviewResult`, canonical `ReviewFindingV5`, and Task 7's validated finding identity semantics.
- Owns registry-defined `FinalFixDiffEvidence`, `RevisionDiffResult`, `RevisionDiffProvider`, `ResolvedFinalFixWaveEvidence`, `FailedFinalFixWaveEvidence`, `FinalReviewEvidenceClosure`, `BlockedFinalReviewEvidenceAttempt`, and `BuildFinalReviewEvidenceClosureResult`.
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

  async function buildFinalReviewEvidenceClosure(
    input: {
      readonly artifactChainId: string;
      readonly candidateHead: string;
      readonly fullFinalReview: JusticeReviewResult & { readonly reviewKind: "final-review" };
      readonly finalFixWave?: {
        readonly scopedReReview: JusticeReviewResult & { readonly reviewKind: "scoped-re-review" };
      };
    },
    deps: {
      readonly revisionDiffProvider: RevisionDiffProvider;
    },
  ): Promise<BuildFinalReviewEvidenceClosureResult>;

  function evaluateTaskConformance(input: TaskConformanceInput): ConformanceGateVerdict;
  function evaluatePlanConformance(input: PlanConformanceInput): ConformanceGateVerdict;
  ```
- Canonical `PlanConformanceInput.finalReviewClosure` accepts **only** a trusted `FinalReviewEvidenceClosure` from `BuildFinalReviewEvidenceClosureResult.kind === "complete"`.
- If the build result is `blocked`, acceptance maps directly to BLOCK using `attempt.notProvenClauseIds`, `attempt.blockingFindingIds`, and reasons. A blocked attempt is never coerced into `PlanConformanceInput`.
- Runtime `RevisionDiffProvider` remains the sole changed-path authority:
  - exact ancestor-checked `BASE..HEAD`;
  - Git name-status `-z --find-renames --find-copies`;
  - rename/copy adds old and new paths;
  - malformed/unsafe/failure/non-ancestor → `RevisionDiffResult.failed`.
- Diff-failure construction is exact:
  ```text
  base = fullFinalReview.reviewedRange.head
  head = candidateHead
  RevisionDiffResult.failed
  + scopedReReview
  → FailedFinalFixWaveEvidence
  → BlockedFinalReviewEvidenceAttempt
  → no FinalReviewEvidenceClosure
  ```
- Only `RevisionDiffResult.resolved` may construct `ResolvedFinalFixWaveEvidence` and authorize clause carry-forward.
- Finding merge assumes Task 7/8 validated the exact current Superpowers target set:
  - merge scoped dispositions only for `expectedFindings` from the current dispatch;
  - same-ID resolved → clears that targeted blocker;
  - same-ID open → remains unresolved;
  - missing expected finding cannot arrive as trusted scoped evidence; defensively it blocks;
  - non-target preceding findings retain their prior disposition (for example deferred Minor or already-resolved findings) and are not reintroduced into the round;
  - new Critical/Important open finding → blocker; new Minor remains deferred-visible;
  - human adjudication remains separate.
- Justice never requests another full final review to close missing coverage.

- [ ] **Step 1: Write RED gate/provenance tests**

In `tests/core/conformance-gate.test.ts` keep existing acceptance cases.

In `tests/runtime/revision-diff-provider.test.ts` keep:
- `changed_file_set_is_derived_from_exact_final_fix_range`
- `rename_marks_old_and_new_paths_as_intersecting`
- `copy_marks_old_and_new_paths_as_intersecting`
- `diff_resolution_rejects_non_ancestor_range`
- `diff_resolution_rejects_unsafe_or_malformed_paths`

In `tests/core/plan-completion-v5.test.ts` include:
- `old_full_final_review_alone_cannot_complete_new_candidate_head`
- `final_review_evidence_closure_extends_to_fix_head_only_with_scoped_delta_coverage`
- `global_or_undecidable_clause_scope_requires_scoped_reproof_after_fix`
- `intersecting_file_scope_without_scoped_reproof_becomes_not_proven`
- `unaffected_file_scope_can_carry_forward_across_final_fix_wave`
- `omitted_changed_path_cannot_cause_clause_carry_forward`
- `diff_resolution_failure_makes_prior_unreproved_coverage_not_proven`
- `diff_resolution_failure_cannot_construct_trusted_final_review_closure`
- `blocked_final_evidence_preserves_fix_wave_failure_provenance`
- `scoped_final_rereview_resolved_finding_clears_original_blocker`
- `scoped_final_rereview_not_addressed_finding_remains_blocking`
- `missing_scoped_disposition_does_not_silently_clear_original_blocker`
- `new_blocking_finding_from_scoped_rereview_blocks_completion`
- `final_review_can_prove_inline_semantic_clauses`
- `zero_drift_zero_missing_evidence_zero_blocking_quality_allows_completion`
- `artifact_or_revision_mutation_stales_review_evidence_before_acceptance`

For `artifact_or_revision_mutation_stales_review_evidence_before_acceptance`, RED must bind trusted review evidence to Candidate A, then mutate the approved artifact chain, scope, or reviewed revision before acceptance and prove that Candidate B cannot reuse Candidate A's evidence. Minimum GREEN behavior is a blocked/stale result with the affected proof becoming `NOT_PROVEN`; no stale closure may be coerced into `PlanConformanceInput`.

- [ ] **Step 2: Run RED tests**

Run:
```bash
bun run vitest run tests/core/conformance-gate.test.ts tests/core/plan-completion-v5.test.ts
bun run vitest run tests/runtime/revision-diff-provider.test.ts
```

Expected: FAIL because current acceptance has no type-safe v5 final evidence build and does not yet enforce the Scenario 49 artifact/scope/revision freshness regression.

- [ ] **Step 3: Implement runtime diff provider**

Provider produces exact-range `RevisionDiffResult` only; it never fabricates evidence and never decides clause semantics.

- [ ] **Step 4: Implement complete/blocked final evidence build and finding merge**

- diff resolved → may produce trusted closure if all clause/finding/range conditions pass;
- diff failed → produce blocked attempt preserving `FailedFinalFixWaveEvidence`; never construct closure;
- merge only validated exact finding IDs from Task 7/8 flow;
- runtime remains fail-open where safe; acceptance remains fail-closed.

- [ ] **Step 5: Run GREEN focused suite + typecheck**

Run:
```bash
bun run vitest run tests/core/conformance-gate.test.ts tests/core/plan-completion-v5.test.ts
bun run vitest run tests/runtime/revision-diff-provider.test.ts
bun run typecheck
```

Expected: PASS, including `artifact_or_revision_mutation_stales_review_evidence_before_acceptance`; evidence bound to an older artifact chain, scope, or reviewed revision remains stale/blocked and cannot construct trusted current-candidate completion evidence.

- [ ] **Step 6: Commit**

```bash
git add src/core/conformance-gate.ts src/runtime/revision-diff-provider.ts \
  src/core/acceptance-decision.ts src/core/v2/gate-context.ts src/core/v2/decision-model.ts src/core/v2/state-projection.ts \
  tests/core/conformance-gate.test.ts tests/core/acceptance-decision.test.ts tests/core/plan-completion-v5.test.ts \
  tests/runtime/revision-diff-provider.test.ts
git commit -m "feat: gate acceptance on type-safe final evidence"
```

---

### Task 10: Activate Selected Superpowers Method on Native, Consume Provenance, Classify Semantic Work, and Remove Justice Scheduling Authority

**Requirements / Design:** JUS5-ACT-01..04, JUS5-SDD-01..04, JUS5-DEP-01..03, JUS5-TASK-01..04, JUS5-PLAN-01..05, JUS5-CAT-05..09, J5D-OWN-01, J5D-ACT-01, J5D-TASK-01, J5D-ROUTE-01..02, J5D-CAT-02, J5D-DEP-01.

**Consumes:**
- Task 1 PROVEN activation evidence kind(s);
- Task 2 semantic routing/provenance types;
- Task 6 trusted `TaskRoutingProvenance`; Task 10 MUST NOT independently infer Superpowers origin.

**Produces:**
- `WorkflowActivationEvidence` using only `read_tool_result | host_expanded_skill_input` members proven by Task 1;
- semantic classification and in-place routing translation for already-issued trusted Superpowers task calls;
- explicit Superpowers ownership / no-Justice-scheduling behavior.

**Files:**
- Create: `src/core/workflow-activation.ts`
- Create: `src/runtime/senpi-superpowers-mapping.ts`
- Modify: `src/runtime/senpi-adapter.ts`
- Modify: `src/core/workflow-directives.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/review-dispatch-state.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/core/dependency-analyzer.ts`
- Modify: `src/core/execution-role-classifier.ts`
- Modify: `src/core/category-classifier.ts`
- Test: `tests/core/workflow-activation-v5.test.ts`
- Test: `tests/core/superpowers-ownership-v5.test.ts`
- Create: `tests/runtime/senpi-adapter-semantic-routing.test.ts`
- Test: `tests/core/dependency-analyzer.test.ts`
- Test: `tests/core/category-classifier.test.ts`
- Test: `tests/unit/core/execution-role-classifier.test.ts`
- Test: `tests/hooks/plan-bridge-implement.test.ts`
- Test: `tests/core/review-dispatch-state.test.ts`

**Activation contract:**
- selection and activation remain separate;
- `WorkflowActivationEvidence.evidenceKind` is exactly `read_tool_result | host_expanded_skill_input`;
- Task 10 accepts only member(s) marked PROVEN in the Task 1 evidence note;
- `observedCallOrInputId` binds the exact observed read/input event;
- package/bootstrap presence and child-only `load_skills` do not prove controller activation;
- if Task 1 shows compaction does not preserve method-specific activation, `session_compact` invalidates current ActivationEvidence;
- any third evidence kind is an artifact change, not an implementation choice.

**Native tool-mapping appendix:**
- instruct the active Superpowers workflow to express requested subagent/reviewer work via the existing OmO Native `task`;
- never issue the call;
- never prescribe model/provider;
- Task 6 supplies provenance; Task 10 only consumes it and performs semantic translation.

- [ ] **Step 1: Write RED activation/ownership tests**

Exact tests:
- `authorized_implementation_activates_selected_superpowers_execution_method`
- `read_tool_result_activation_evidence_uses_observed_call_or_input_id`
- `host_expanded_skill_input_activation_evidence_uses_observed_call_or_input_id`
- `unproven_activation_evidence_kind_is_rejected`
- `package_bootstrap_alone_does_not_prove_method_activation`
- `child_load_skills_does_not_activate_controller_method`
- `compaction_requires_fresh_activation_when_survival_is_unproven`
- `cross_session_recovered_method_requires_fresh_native_activation`
- `justice_activation_does_not_own_superpowers_task_progression`
- `justice_does_not_directly_dispatch_implementation_tasks_instead_of_superpowers`
- `justice_does_not_schedule_remediation_or_rereview`
- `dependency_analyzer_cannot_reorder_or_dispatch_tasks`

- [ ] **Step 2: Write RED semantic/provenance routing tests**

Exact tests:
- `recognized_superpowers_native_task_translates_to_justice_category`
- `recognized_superpowers_native_task_never_emits_category_and_subagent_type_together`
- `routing_requires_task6_trusted_superpowers_provenance`
- `task10_passes_task6_provenance_into_pure_routing_translation`
- `ambiguous_or_external_provenance_is_not_upgraded_by_prompt_shape`
- `external_explicit_subagent_type_is_preserved`
- `superpowers_specialized_subagent_type_is_preserved`
- `task_send_continuation_does_not_receive_worker_category`
- `missing_native_method_activation_makes_worker_routing_untrusted`
- `justice_does_not_select_concrete_model_or_provider`
- existing full-task semantic classifier regressions.

- [ ] **Step 3: Run RED focused set**

```bash
bun run vitest run \
  tests/core/workflow-activation-v5.test.ts \
  tests/core/superpowers-ownership-v5.test.ts \
  tests/runtime/senpi-adapter-semantic-routing.test.ts \
  tests/core/dependency-analyzer.test.ts \
  tests/core/category-classifier.test.ts \
  tests/unit/core/execution-role-classifier.test.ts \
  tests/hooks/plan-bridge-implement.test.ts \
  tests/core/review-dispatch-state.test.ts
```

Expected: FAIL on stale activation shape, missing Task-6 provenance consumption, and remaining Justice-owned progression.

- [ ] **Step 4: Remove active Justice scheduling authority**

Migration readers may remain; current review/task/fix dispatch directives must not.

- [ ] **Step 5: Implement Native activation observation and mapping appendix**

Minimum GREEN:
- activation evidence uses the canonical bounded evidence type;
- unsupported/unproven channel → `unavailable / NOT_PROVEN`;
- same-session recovery requires matching authorization/session/method/evidence kind;
- compaction invalidation follows Task 1 evidence exactly.

- [ ] **Step 6: Implement semantic classifier and in-place Native task translation**

Minimum GREEN:
- call the Task 2-owned `translateTaskRouting(TranslateTaskRoutingInput)` contract with Task 6-produced provenance explicitly;
- consume only Task 6 trusted provenance and never re-infer origin;
- translate only the already-issued task call;
- preserve external/specialized routes and `task_send`;
- never select model/provider/retry/fallback.

- [ ] **Step 7: Run GREEN focused set + full suite**

```bash
bun run vitest run \
  tests/core/workflow-activation-v5.test.ts \
  tests/core/superpowers-ownership-v5.test.ts \
  tests/runtime/senpi-adapter-semantic-routing.test.ts \
  tests/core/dependency-analyzer.test.ts \
  tests/core/category-classifier.test.ts \
  tests/unit/core/execution-role-classifier.test.ts \
  tests/hooks/plan-bridge-implement.test.ts \
  tests/core/review-dispatch-state.test.ts
bun run test
bun run typecheck
```

Expected: PASS, including `task10_passes_task6_provenance_into_pure_routing_translation`, historical v4.3.1 ownership regressions, bounded Native activation evidence, and provenance-only routing translation.

- [ ] **Step 8: Commit exact Task 10 boundary**

```bash
git add src/core/workflow-activation.ts src/runtime/senpi-superpowers-mapping.ts \
  src/runtime/senpi-adapter.ts src/core/workflow-directives.ts src/core/types.ts \
  src/core/review-dispatch-state.ts src/core/justice-plugin.ts src/hooks/plan-bridge.ts \
  src/core/dependency-analyzer.ts src/core/execution-role-classifier.ts src/core/category-classifier.ts \
  tests/core/workflow-activation-v5.test.ts tests/core/superpowers-ownership-v5.test.ts \
  tests/runtime/senpi-adapter-semantic-routing.test.ts tests/core/dependency-analyzer.test.ts \
  tests/core/category-classifier.test.ts tests/unit/core/execution-role-classifier.test.ts \
  tests/hooks/plan-bridge-implement.test.ts tests/core/review-dispatch-state.test.ts
git commit -m "feat: activate Superpowers and translate trusted Native intent"
```

---

### Task 11: Implement OmO Native Effective Configuration and Capability-First Doctor

**Requirements / Design:** JUS5-COMP-01..04, JUS5-HARNESS-01..03, JUS5-CONFIG-01..05, JUS5-DOC-01..04, J5D-CONFIG-01, J5D-DOCTOR-01.

**Files:**
- Create: `src/core/omo-effective-config.ts`
- Modify: `src/core/doctor-config.ts`
- Modify: `src/core/doctor-categories.ts`
- Modify: `src/core/doctor-specifier.ts`
- Modify: `src/core/controller-routing.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Modify: `src/runtime/doctor-cli-helpers.ts`
- Create: `tests/core/omo-effective-config.test.ts`
- Modify: `tests/core/justice-doctor-config.test.ts`
- Modify: `tests/core/doctor-categories.test.ts`
- Modify: `tests/core/doctor-specifier.test.ts`
- Modify: `tests/core/controller-routing.test.ts`
- Create: `tests/runtime/doctor-v5.test.ts`
- Modify: `tests/runtime/doctor-cli.test.ts`

**Consumes:**
- Task 1 capability/evidence profile;
- Task 2 current category vocabulary;
- Task 6 Native extension/correlation capability;
- Task 10 activation capability.

**Produces:**
- `OmoEffectiveConfigResult`;
- configured/applied/observed Native doctor capability model.

**Effective config:**
- user + ancestor project layers;
- effective view `shared → [native] → profile → profile.[native]`;
- `[senpi]` is legacy/deprecation input only;
- profile precedence matches audited v5.1.17 loader;
- custom category namespace is open;
- built-in diagnostic list includes `architect`.

- [ ] **Step 1: Write RED effective-config/doctor tests**

Exact config tests:
- `resolves_user_project_harness_profile_precedence`
- `native_section_overrides_shared_base`
- `selected_profile_native_overrides_selected_profile_base`
- `legacy_senpi_section_is_reported_as_migration_input_not_canonical_output`
- `invalid_config_layer_is_reported_not_silently_ignored`

Exact doctor tests:
- `compatible_native_patch_with_required_capabilities_is_supported`
- `missing_native_task_or_child_binding_capability_is_unsupported`
- `doctor_reports_superpowers_native_activation_capability_separately`
- `doctor_reports_provenance_profile_capability_separately`
- `doctor_separates_source_configured_applied_and_observed_values`
- `doctor_does_not_treat_opencode_adapter_as_native_authority`

- [ ] **Step 2: Run RED**

```bash
bun run vitest run \
  tests/core/omo-effective-config.test.ts \
  tests/core/justice-doctor-config.test.ts \
  tests/core/doctor-categories.test.ts \
  tests/core/doctor-specifier.test.ts \
  tests/core/controller-routing.test.ts \
  tests/runtime/doctor-v5.test.ts \
  tests/runtime/doctor-cli.test.ts
```

Expected: FAIL because current doctor/config paths model OpenCode/single-file state and do not expose Native provenance/activation capability separately.

- [ ] **Step 3: Implement resolver + capability model**

Minimum GREEN:
- reproduce current documented file/profile precedence;
- use `[native]` as canonical harness key;
- surface Task-1/Task-6 provenance and child-binding capability independently;
- distinguish source/configured/applied/observed values;
- do not import an unsupported private upstream config workspace package.

- [ ] **Step 4: Run GREEN + build**

```bash
bun run vitest run \
  tests/core/omo-effective-config.test.ts \
  tests/core/justice-doctor-config.test.ts \
  tests/core/doctor-categories.test.ts \
  tests/core/doctor-specifier.test.ts \
  tests/core/controller-routing.test.ts \
  tests/runtime/doctor-v5.test.ts \
  tests/runtime/doctor-cli.test.ts
bun run typecheck
bun run build
```

Expected: PASS with the effective Native configured value and all required proof capabilities reported independently.

- [ ] **Step 5: Commit exact Task 11 boundary**

```bash
git add src/core/omo-effective-config.ts src/core/doctor-config.ts src/core/doctor-categories.ts \
  src/core/doctor-specifier.ts src/core/controller-routing.ts src/runtime/doctor-cli.ts \
  src/runtime/doctor-cli-helpers.ts tests/core/omo-effective-config.test.ts \
  tests/core/justice-doctor-config.test.ts tests/core/doctor-categories.test.ts \
  tests/core/doctor-specifier.test.ts tests/core/controller-routing.test.ts \
  tests/runtime/doctor-v5.test.ts tests/runtime/doctor-cli.test.ts
git commit -m "feat: diagnose OmO Native effective configuration"
```

---

### Task 12: Synchronize Remaining OmO Native v5.1.17 Drift Without Taking Runtime Ownership

**Requirements / Design:** JUS5-CAT-01..04, JUS5-CTRL-01..03, JUS5-ERR-01..03, J5D-CAT-01, J5D-RUNTIME-01.

**Files:**
- Modify: `src/core/provider-error-patterns.ts`
- Modify: `src/core/error-classifier.ts`
- Modify: `src/core/workflow-router.ts`
- Modify: `src/core/controller-routing.ts`
- Modify: `src/core/category-classifier.ts`
- Modify: `src/core/omo-category-mapper.ts`
- Test: `tests/core/provider-error-patterns.test.ts`
- Test: `tests/core/error-classifier.test.ts`
- Test: `tests/unit/core/workflow-router.test.ts`
- Test: `tests/core/controller-routing.test.ts`
- Test: `tests/core/category-classifier.test.ts`
- Test: `tests/unit/core/omo-category-mapper.test.ts`
- Create: `tests/core/omo-v5-upstream-drift.test.ts`

**Current drift assertions:**
- Native built-in vocabulary includes `architect` and no canonical legacy `deep`;
- provider/runtime failure classification remains diagnostic-only;
- Justice does not implement provider retry/fallback, task reconnect/revival, host handoff, lane reclaim, or process-mode recovery;
- config remediation points to current `omo.json[c]` / `[native]`, never legacy OpenCode files;
- runtime/provider signals align with audited v5.1.17/Senpi v2026.10.8 behavior.

- [ ] **Step 1: Write RED drift tests**

Exact tests:
- `native_category_vocabulary_includes_architect_and_excludes_legacy_deep`
- `provider_failure_classification_does_not_trigger_justice_retry_or_fallback`
- `task_transport_or_host_recovery_is_not_reimplemented_by_justice`
- `native_config_remediation_does_not_point_to_legacy_opencode_files`
- `controller_routing_does_not_restore_sisyphus_atlas_authority`

- [ ] **Step 2: Run RED**

```bash
bun run vitest run \
  tests/core/provider-error-patterns.test.ts \
  tests/core/error-classifier.test.ts \
  tests/unit/core/workflow-router.test.ts \
  tests/core/controller-routing.test.ts \
  tests/core/category-classifier.test.ts \
  tests/unit/core/omo-category-mapper.test.ts \
  tests/core/omo-v5-upstream-drift.test.ts
```

Expected: FAIL on stale category/config/controller/runtime diagnostics.

- [ ] **Step 3: Update diagnostics only**

Minimum GREEN:
- synchronize patterns/vocabulary/messages to v5.1.17/Senpi v2026.10.8;
- keep `ErrorClassifier.shouldRetry()` diagnostic-only;
- no Justice provider/model retry/fallback;
- no task reconnect/revival/host handoff/lane reclaim/process-mode recovery;
- no legacy OpenCode config remediation as canonical guidance.

- [ ] **Step 4: Run GREEN + typecheck**

```bash
bun run vitest run \
  tests/core/provider-error-patterns.test.ts \
  tests/core/error-classifier.test.ts \
  tests/unit/core/workflow-router.test.ts \
  tests/core/controller-routing.test.ts \
  tests/core/category-classifier.test.ts \
  tests/unit/core/omo-category-mapper.test.ts \
  tests/core/omo-v5-upstream-drift.test.ts
bun run typecheck
```

Expected: PASS including `provider_failure_classification_does_not_trigger_justice_retry_or_fallback`.

- [ ] **Step 5: Commit exact Task 12 boundary**

```bash
git add src/core/provider-error-patterns.ts src/core/error-classifier.ts src/core/workflow-router.ts \
  src/core/controller-routing.ts src/core/category-classifier.ts src/core/omo-category-mapper.ts \
  tests/core/provider-error-patterns.test.ts tests/core/error-classifier.test.ts \
  tests/unit/core/workflow-router.test.ts tests/core/controller-routing.test.ts \
  tests/core/category-classifier.test.ts tests/unit/core/omo-category-mapper.test.ts \
  tests/core/omo-v5-upstream-drift.test.ts
git commit -m "fix: synchronize OmO Native runtime diagnostics"
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

```bash
bun run vitest run tests/core/v5-recovery.test.ts tests/runtime/justice-review-v5.test.ts
bun run test:integration
bun run typecheck
```

Expected: PASS; recovery preserves v5 authority boundaries, does not silently reconcile Superpowers conflicts, and `justice_review` remains inspection-only.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/justice-tools.ts src/core/justice-plugin.ts src/core/v5-persistence.ts \
  src/core/v2/state-projection.ts src/runtime/doctor-cli.ts \
  tests/runtime/justice-review-v5.test.ts tests/core/v5-recovery.test.ts
git commit -m "feat: expose Justice v5 recovery and gate state"
```

---

### Task 14: Close Native Cross-Component E2E Coverage and Synchronize User/Upstream Documentation

**Requirements / Design:** all JUS5/J5D contracts; Design §29.

**Files:**
- Create: `tests/integration/justice-v5-semantic-control-plane.integration.test.ts`
- Add the Task-1 Native contract evidence test to integration verification.
- Modify: `README.md`, `SPEC.md`, `docs/agents/upstream-drift.md`, `docs/reports/upstream-compatibility-audit.md`.
- No release-version edit.

**Documented stack:**
- OmO Native v5.1.17;
- Senpi v2026.10.8;
- Superpowers v6.4.2 Pi package;
- capability-first Native support;
- effective `omo.json[c]` with `[native]`;
- Superpowers owns WHAT;
- Justice owns activation evidence + SEMANTIC HOW;
- OmO owns CONCRETE HOW and runtime lifecycle;
- OpenCode adapter is secondary compatibility only.

- [ ] **Step 1: E2E cases**

Retain the existing v5 semantic-control-plane E2Es and add/ensure Native boundaries:
- `sdd_task_reaches_acceptance_through_existing_superpowers_review`
- `scoped_re_review_resolves_blocking_finding_and_allows_acceptance`
- `executing_plans_requires_final_review_and_final_conformance`
- `implementation_discovered_design_change_requires_reconciliation_before_resume`
- `complete_evidence_allows_plan_complete`
- `translated_superpowers_work_leaves_concrete_runtime_resolution_to_omo`
- `clean_review_does_not_bypass_human_artifact_chain_authorization`
- `superpowers_remediation_and_omo_retry_ownership_remain_separate`
- `native_superpowers_task_review_uses_one_model_issued_omo_task_and_trusted_child_binding`
- `native_task_runtime_identity_never_becomes_justice_task_identity`.

- [ ] **Step 2: Run RED E2E + Task 1 Native evidence gate**

```bash
bun run vitest run tests/integration/omo-native-senpi-contract-spike.test.ts
bun run vitest run tests/integration/justice-v5-semantic-control-plane.integration.test.ts
```

Expected: the pinned Task 1 contract remains PASS; cross-component Native E2Es fail only on missing final integration wiring, never because the adapter contract is reinterpreted.

- [ ] **Step 3: Smallest integration wiring only**

Architecture mismatch → STOP for artifact reconciliation.

- [ ] **Step 4: Update docs**

Required:
- record exact OmO/Senpi/Superpowers tags and Task-1 evidence;
- explain Superpowers Pi bootstrap + Justice Native mapping appendix;
- explain Native task XOR, `st_...` runtime ids, and `task_send`;
- remove primary OpenCode claims and old `task_id=ses_...` semantics;
- document `[native]` effective config;
- document OpenCode as secondary compatibility;
- explain `justice_review` as inspection, not scheduler;
- retain v4.3.1 regression corpus/migration explanation.

- [ ] **Step 5: Run GREEN E2E + full verification**

```bash
bun run vitest run tests/integration/omo-native-senpi-contract-spike.test.ts
bun run vitest run tests/integration/justice-v5-semantic-control-plane.integration.test.ts

bun run typecheck
bun run lint
bun run test
bun run test:integration
bun run build
git diff --check
```

Expected: PASS for both exact integration files, then PASS for typecheck/lint/unit/integration/build/diff checks; Task-1 pinned Native contract evidence remains unchanged and PROVEN.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/justice-v5-semantic-control-plane.integration.test.ts \
  README.md SPEC.md docs/agents/upstream-drift.md docs/reports/upstream-compatibility-audit.md
git commit -m "docs: finalize Justice v5 Native integration evidence"
```

- [ ] **Step 7: Confirm clean candidate HEAD**

The implementer does not dispatch the final whole-branch reviewer.

---

## Controller-Owned Finalization After Task 14

This phase belongs to the Superpowers controller, not the Task 14 implementer. It MUST follow Superpowers v6.4.2 final-review progression exactly; Justice observes/composes evidence and never schedules an additional reviewer.

1. Record the clean committed initial final candidate:
   ```bash
   MERGE_BASE=$(git merge-base master HEAD)
   FINAL_BASE_HEAD=$(git rev-parse HEAD)
   test -z "$(git status --porcelain)"
   ```
2. Run final verification against `FINAL_BASE_HEAD`:
   ```bash
   bun run typecheck
   bun run lint
   bun run test
   bun run test:integration
   bun run build
   git diff --check "$MERGE_BASE..$FINAL_BASE_HEAD"
   test "$(git rev-parse HEAD)" = "$FINAL_BASE_HEAD"
   test -z "$(git status --porcelain)"
   ```
3. Dispatch the single Superpowers full final whole-branch reviewer for exactly `MERGE_BASE..FINAL_BASE_HEAD`.
4. If the full final review is clean:
   - Justice builds a `FinalReviewEvidenceClosure` with no fix wave;
   - `candidateHead == FINAL_BASE_HEAD`;
   - proceed to step 8.
5. If the full final review returns findings:
   - follow Superpowers exactly: dispatch **ONE** final fix subagent with the complete findings list;
   - let that fix subagent implement/test/commit the fix wave;
   - record:
     ```bash
     FIX_BASE="$FINAL_BASE_HEAD"
     FINAL_CANDIDATE_HEAD=$(git rev-parse HEAD)
     test -z "$(git status --porcelain)"
     ```
   - run normal final verification against `FINAL_CANDIDATE_HEAD`;
   - generate the Superpowers scoped review package for exactly `FIX_BASE..FINAL_CANDIDATE_HEAD`;
   - dispatch **exactly one scoped re-review of that fix wave**.
6. Justice ingests the original full final-review result plus, when present, the one scoped final re-review and calls the final-evidence builder for `FINAL_CANDIDATE_HEAD`:
   - obtain trusted `FinalFixDiffEvidence` for exactly `FIX_BASE..FINAL_CANDIDATE_HEAD` through `RevisionDiffProvider`;
   - rename/copy contributes both old and new paths to the touched set;
   - diff resolution failure produces `BlockedFinalReviewEvidenceAttempt` with exact failure provenance; it never produces a trusted closure;
   - Candidate-A clauses carry only when their evidence scope is deterministically non-intersecting with trusted changed paths;
   - affected/undecidable clauses require explicit scoped re-proof; otherwise `NOT_PROVEN`;
   - merge full→scoped finding disposition by `findingId`: explicit scoped `resolved` clears the matching original blocker; open/parked/NOT ADDRESSED or omission keeps it unresolved;
   - new scoped Critical/Important findings become blockers;
   - A's full review alone never proves B.
7. Follow Superpowers residual adjudication rules after the one scoped re-review. **There is no second Justice-requested full review and no second Justice-requested fix wave.** If residual/load-bearing findings or missing clause coverage remain, Justice leaves `PlanComplete` BLOCKED and surfaces them to branch finishing/human review.
8. Continue to the Final Conformance Gate only when the builder returned `kind: "complete"`; a `blocked` attempt is surfaced by `justice_review` and keeps `PlanComplete` BLOCKED. For a complete build, invoke `justice_review` in read/inspection mode and require:
   - `artifactChain.status == "AUTHORIZED"`;
   - `projection.status == "COMPLETE"`;
   - trusted `FinalReviewEvidenceClosure.candidateHead == git rev-parse HEAD`;
   - closure has no `NOT_PROVEN` required clause and no unresolved blocking finding;
   - `planCompletion.status == "COMPLETE"`;
   - `planCompletion.reasons` is empty.
9. After the gates pass, do not modify or commit any tracked file before completion/branch finishing.

Any tracked change outside the single Superpowers final fix wave invalidates the existing closure. Justice does not compensate by dispatching extra reviews; coverage remains fail-closed.

---

## Contract Traceability

### Requirements → Task mapping

| Requirement IDs | Owning task(s) |
|---|---|
| JUS5-COMP-01, JUS5-COMP-02, JUS5-COMP-03, JUS5-COMP-04 | Tasks 1, 11 |
| JUS5-HARNESS-01, JUS5-HARNESS-02, JUS5-HARNESS-03 | Tasks 1, 6, 11 |
| JUS5-OWN-01, JUS5-OWN-02, JUS5-OWN-03 | Tasks 2, 6, 7, 10, 12 |
| JUS5-GATE-01, JUS5-GATE-02 | Task 9 |
| JUS5-CONFIG-01, JUS5-CONFIG-02, JUS5-CONFIG-03, JUS5-CONFIG-04, JUS5-CONFIG-05 | Task 11 |
| JUS5-CAT-01, JUS5-CAT-02, JUS5-CAT-03, JUS5-CAT-04 | Tasks 2, 12 |
| JUS5-CAT-05 | Tasks 1, 2, 7, 10 |
| JUS5-CAT-06, JUS5-CAT-07, JUS5-CAT-08 | Task 10 |
| JUS5-CAT-09 | Tasks 2, 7, 10, 14 |
| JUS5-CTRL-01, JUS5-CTRL-02, JUS5-CTRL-03 | Tasks 10, 11, 12 |
| JUS5-ACT-01, JUS5-ACT-02, JUS5-ACT-03, JUS5-ACT-04 | Task 10 |
| JUS5-PLAN-01, JUS5-PLAN-02, JUS5-PLAN-03, JUS5-PLAN-04, JUS5-PLAN-05 | Tasks 4, 10 |
| JUS5-AUTH-01, JUS5-AUTH-02, JUS5-AUTH-03, JUS5-AUTH-04, JUS5-AUTH-05, JUS5-AUTH-06, JUS5-AUTH-07, JUS5-AUTH-08, JUS5-AUTH-09 | Tasks 3, 9 |
| JUS5-SDD-01, JUS5-SDD-02, JUS5-SDD-03, JUS5-SDD-04 | Tasks 6, 7, 10 |
| JUS5-INLINE-01, JUS5-INLINE-02 | Tasks 9, 10 |
| JUS5-TASK-01, JUS5-TASK-02, JUS5-TASK-03, JUS5-TASK-04 | Tasks 2, 5, 10 |
| JUS5-CORR-01, JUS5-CORR-02, JUS5-CORR-03, JUS5-CORR-04, JUS5-CORR-05 | Tasks 2, 5, 6 |
| JUS5-CORR-06 | Tasks 1, 2, 6, 7, 10 |
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
| INV-01, J5D-OWN-01, J5D-ACT-01 | Task 10 |
| INV-02, J5D-OWN-02, J5D-RUNTIME-01 | Tasks 2, 7, 10, 12 |
| INV-03, J5D-GATE-01 | Task 9 |
| INV-04 | Tasks 5–9, 13 |
| INV-05, INV-06, J5D-COMPLETE-01 | Tasks 3, 4, 9, 14 |
| J5D-TASK-01 | Tasks 5, 10 |
| J5D-CHAIN-01, J5D-CHAIN-02, J5D-RULING-01 | Tasks 3, 9 |
| J5D-CORR-01, J5D-CORR-02 | Tasks 2, 5, 6 |
| J5D-ROUTE-01 | Tasks 1, 2, 7, 10 |
| J5D-ROUTE-02 | Tasks 2, 7, 10 |
| J5D-PROJ-01, J5D-PROJ-02, J5D-PROJ-03 | Task 4 |
| J5D-REVIEW-01, J5D-REVIEW-02, J5D-REVIEW-03, J5D-REVIEW-04 | Tasks 1, 7 |
| J5D-QUALITY-01, J5D-STORAGE-01 | Task 8 |
| J5D-CONFIG-01, J5D-DOCTOR-01 | Task 11 |
| J5D-PERSIST-01, J5D-REC-01 | Task 13 |
| J5D-CAT-01 | Tasks 2, 12 |
| J5D-CAT-02 | Tasks 2, 10, 14 |
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
| 6 | Justice does not duplicate-dispatch reviewer | 7 | `tests/runtime/senpi-adapter-review-interop.test.ts` | `does_not_dispatch_duplicate_reviewer_for_recognized_superpowers_review` | integration |
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
| 17 | old full final review alone is stale after a fix; trusted scoped final re-review delta extends coverage only when affected/unaffected clause scope is proven | 9 | `tests/core/plan-completion-v5.test.ts` | `final_review_evidence_closure_extends_to_fix_head_only_with_scoped_delta_coverage` | unit |
| 18 | all clauses SATISFIED, no blocking quality → completion permitted | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `complete_evidence_allows_plan_complete` | E2E |
| 19 | Justice does not emit canonical `deep` | 2 | `tests/core/omo-category-mapper-v5.test.ts` | `does_not_emit_legacy_deep` | unit |
| 20 | custom `sp-*` coexist with OmO v5 routing | 2 | `tests/core/omo-category-mapper-v5.test.ts` | `custom_sp_categories_coexist_with_omo_v5_categories` | unit |
| 21 | Justice does not directly select model/provider | 2 | `tests/core/v5-task-routing-contract.test.ts` | `justice_does_not_select_concrete_model_or_provider` | unit |
| 22 | compatible OmO Native/Senpi patch not rejected solely by version | 11 | `tests/runtime/doctor-v5.test.ts` | `compatible_native_patch_with_required_capabilities_is_supported` | integration |
| 23 | missing required Native capability reported accurately | 11 | `tests/runtime/doctor-v5.test.ts` | `missing_native_task_or_child_binding_capability_is_unsupported` | integration |
| 24 | compaction/restart retains plan/task/review correlation | 13 | `tests/core/v5-recovery.test.ts` | `recovers_plan_task_review_correlation_after_restart` | integration |
| 25 | completed work not re-correlated to another Plan after recovery | 13 | `tests/core/v5-recovery.test.ts` | `does_not_recorrelate_completed_work_to_different_plan_after_recovery` | integration |
| 26 | Justice/Superpowers state conflict surfaced | 13 | `tests/core/v5-recovery.test.ts` | `surfaces_superpowers_justice_state_conflict` | integration |
| 27 | OmO Native task id/name and task_send target remain runtime-owned | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_task_send_runtime_continuation_target` | unit |
| 28 | Native task call recoverably correlated by durable parent-session/tool-call binding | 6 | `tests/runtime/senpi-adapter-execution-correlation.test.ts` | `recovers_native_task_call_from_durable_parent_session_tool_call_binding` | integration |
| 29 | `category + subagent_type` not silently resolved by Justice | 2 | `tests/core/v5-task-routing-contract.test.ts` | `reports_category_subagent_type_as_invalid_both` | unit |
| 30 | missing/ambiguous execution correlation leaves evidence NOT_PROVEN | 9 | `tests/core/conformance-gate.test.ts` | `ambiguous_execution_correlation_leaves_evidence_not_proven` | unit |
| 31 | Requirements change stales Design + Plan chain | 3 | `tests/core/artifact-chain.test.ts` | `requirements_change_stales_design_and_plan_authority` | unit |
| 32 | substantive Ruling can continue execution but cannot authorize acceptance | 9 | `tests/core/conformance-gate.test.ts` | `substantive_ruling_does_not_authorize_acceptance` | unit |
| 33 | duplicate/missing/ambiguous projection becomes INCOMPLETE/INVALID | 4 | `tests/core/conformance-projector.test.ts` | `projection_failures_never_return_complete` | unit |
| 34 | v6.4.2 reviewer gets Conformance Contract through the Task-1-proven Native child/context path | 7 | `tests/runtime/senpi-adapter-review-interop.test.ts` | `native_bound_child_receives_conformance_contract_before_trusted_output` | integration |
| 35 | missing/malformed structured review result blocks | 7 | `tests/core/review-result.test.ts` | `missing_or_malformed_review_result_is_rejected` | unit |
| 36 | parked Important/Critical blocks until trusted disposition/human quality adjudication | 8 | `tests/core/review-quality-v5.test.ts` | `parked_critical_or_important_blocks_until_trusted_disposition` | unit |
| 37 | effective config honors user/project + harness/profile precedence | 11 | `tests/core/omo-effective-config.test.ts` | `resolves_user_project_harness_profile_precedence` | unit |
| 38 | v4 plan-only authorization not auto-promoted | 3 | `tests/core/v5-persistence.test.ts` | `v4_plan_authorization_is_not_promoted_to_v5_authority` | unit |
| 39 | v4 review-dispatch state cannot resume/satisfy v5 gate | 13 | `tests/core/v5-recovery.test.ts` | `v4_review_dispatch_state_does_not_resume_or_satisfy_v5_review_gate` | integration |
| 40 | unknown/newer persistence preserved and acceptance fail-closed | 13 | `tests/core/v5-recovery.test.ts` | `unknown_newer_schema_is_preserved_and_acceptance_fails_closed` | integration |
| 41 | authorized implementation intent gains runtime-observed Native activation evidence | 10 | `tests/core/workflow-activation-v5.test.ts` | `authorized_implementation_activates_selected_superpowers_execution_method` | integration |
| 42 | Justice activation does not own Superpowers task/review progression | 10 | `tests/core/superpowers-ownership-v5.test.ts` | `justice_activation_does_not_own_superpowers_task_progression` | unit |
| 43 | recognized Superpowers Native worker intent translates the existing OmO task to one Justice category | 10 | `tests/runtime/senpi-adapter-semantic-routing.test.ts` | `recognized_superpowers_native_task_translates_to_justice_category` | integration |
| 44 | non-Superpowers explicit subagent_type remains caller-owned | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_non_superpowers_explicit_subagent_type_without_category_injection` | unit |
| 45 | semantic classification uses task semantics/complexity without selecting concrete runtime | 10 | `tests/unit/core/execution-role-classifier.test.ts` | `classifier_uses_full_plan_semantics_without_selecting_concrete_runtime` | unit |
| 46 | OmO remains concrete model/provider/runtime resolver for translated Superpowers work | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `translated_superpowers_work_leaves_concrete_runtime_resolution_to_omo` | E2E |
| 47 | caller-owned OmO custom category outside Justice built-in vocabulary is preserved | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_user_defined_omo_category_without_translation` | unit |
| 48 | ambiguous/model-inferred review-like producer provenance remains untrusted | 7 | `tests/runtime/senpi-adapter-review-interop.test.ts` | `ambiguous_review_like_action_is_not_trusted_without_recognized_superpowers_provenance` | integration |
| 49 | artifact/scope/revision mutation stales review evidence before acceptance | 9 | `tests/core/plan-completion-v5.test.ts` | `artifact_or_revision_mutation_stales_review_evidence_before_acceptance` | unit |
| 50 | clean review evidence does not create human implementation authorization | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `clean_review_does_not_bypass_human_artifact_chain_authorization` | E2E |
| 51 | Justice does not schedule remediation/re-review or own runtime retry/fallback | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `superpowers_remediation_and_omo_retry_ownership_remain_separate` | E2E |

---

## Interface Dependency Scan for Execution Pre-Flight

The executor must record these rows in the Superpowers ledger before Task 1.

Implementation checkout precondition:

```text
implementation HEAD descends from the master commit containing the approved v5 Requirements / Design / Plan revision
production source/test/CI before Task 1 remains unchanged from the pre-v5 implementation baseline
Task 1 evidence targets OmO v5.1.17 / Senpi v2026.10.8 / Superpowers v6.4.2 exactly
v4.3.1 merge/cherry-pick prerequisite == false
```

Justice `v4.3.1` is consulted only as the historical regression corpus explicitly listed in this Plan:

| Producer | Consumer | Contract to compare |
|---|---|---|
| Task 2 | Task 6 | `NativeSuperpowersProvenanceProfile`, activation-independent `NativeSuperpowersProvenanceInput`, `TaskRoutingProvenance`, and `NativeSuperpowersProvenanceResolver` interface; Task 2 consumes no Task 10 activation output |
| Task 2 | Task 7 | `TrustedSuperpowersProvenance`, `TaskIdentity`, `ReviewFindingV5`, and shared review/routing vocabulary |
| Task 2 | Task 10 | `TaskRoutingTarget`, `SemanticClassificationResult`, `TranslateTaskRoutingInput`, `SuperpowersRoutingTranslationResult`, and exact pure `translateTaskRouting(input)` signature |
| Task 2 | Tasks 5, 8, 9, 11, 12, 14 | remaining shared semantic identity/category/quality vocabulary |
| Task 3 | Tasks 4–14 | `ArtifactFingerprint`, `ApprovedArtifactChain`, `ApprovedPlanBinding.artifactChain`, `ApprovePlanInput` |
| Task 4 | Tasks 7–10, 13–14 | `ParsedSuperpowersTask`, `ProjectionDiagnostic`, `ProjectionResult<T>`, `ClauseEvidenceScope`, `ClauseResult`, `ConformanceContract`, `ConformanceContractPersistenceResult` + immutable contract path/digest |
| Task 5 | Tasks 6–10, 13 | `TaskIdentityResolution`, `CorrelationMutationResult`, `ExecutionCorrelation`, `ExecutionCorrelationKey` |
| Task 6 | Task 7 | Task-1-proven Senpi parent tool-call observation, `NativeSuperpowersProvenanceResolver` output narrowed to `TrustedSuperpowersProvenance`, and exact OmO runtime task/child binding consumed directly by `ReviewDispatchInput.provenance` |
| Task 6 | Task 10 | `TaskRoutingProvenance` produced from the Task-1 profile and passed explicitly into Task 2-owned `translateTaskRouting(TranslateTaskRoutingInput)`; Task 10 does not re-infer origin |
| Task 7 | Tasks 8–10, 13 | recognized review provenance/kind, `sp-review`/`sp-final-review` parent-call translation, current scoped `requestedFindingIds`, `ReviewFindingTarget`, `ReviewFindingContextProvider`, scoped `reservedFindingIds`, authoritative child binding, `JusticeReviewResult` |
| Task 8 | runtime scoped-review coordination + Tasks 9, 13 | store-backed metadata resolution for current marker IDs, lineage-wide `reservedFindingIds`, historical-ID collision detection, Superpowers open-set consistency validation, trusted persisted review evidence |
| Task 9 | Tasks 13–14 | `RevisionDiffProvider`, resolved/failed fix-wave evidence, trusted `FinalReviewEvidenceClosure`, `BlockedFinalReviewEvidenceAttempt`, deterministic finding merge, gate reasons |
| Task 10 | Task 14 | `WorkflowMethodSelection`, persisted `WorkflowMethodSelectionEvidence`, current-session `WorkflowActivationEvidence`, `WorkflowActivationDecision`, `SemanticClassificationResult`, Task-2 pure routing result produced from explicit Task-6 provenance, implementation semantic-category translation, Superpowers ownership invariants |
| Task 11 | Tasks 12–14 | `OmoEffectiveConfigResult`, configured/applied/observed doctor vocabulary |
| Task 13 | Task 14 | `JusticeReviewV5View`, recovery diagnostics, completion projection |

Provenance dependency invariant:

```text
Task 1 → Task 2 → Task 6 → Task 7 / Task 10 → Task 14
```

Task 2 and Task 6 MUST NOT consume Task 10 output, including `WorkflowActivationEvidence` or `WorkflowActivationDecision`. Task 10 is a downstream consumer of Task 6 provenance, never a provenance-domain producer for Task 2/6.

Methodology persistence authority is exclusive: Task 10 selection/activation recovery uses `WorkflowActivationStateStore` only. `ExecutionCorrelation.executionMethod` may remain execution correlation/evidence, but neither `ExecutionCorrelation` nor its store is a methodology selection/activation recovery authority.

Historical regression evidence does not create a producer/consumer dependency on the v4.3.1 implementation. The referenced v4 commits are test/audit evidence only; Tasks 1/2/3/6/7/9/10/11/12/14 implement or prove the current Native v5 contracts above.

Any mismatch is a Plan defect. Under the Justice v5 spec, a Ruling may record the conflict but MUST NOT silently change a normative interface; return to artifact reconciliation if the mismatch changes the Design contract.

Focused provenance contract checks that must be executable before this graph is accepted:

```text
Task 2:
task2_provenance_contract_does_not_depend_on_task10_activation_state
routing_translation_consumes_explicit_provenance_without_reinferring_origin

Task 7:
review_dispatch_requires_task6_trusted_superpowers_provenance

Task 10:
task10_passes_task6_provenance_into_pure_routing_translation
```

---

## Plan Self-Review Checklist

Before this Plan is approved for execution, the Superpowers Review Gate must verify:

1. **Requirements → Design → Plan coverage**
   - every JUS5 requirement family maps to at least one task above;
   - every J5D registry contract maps to at least one task above.
2. **51 scenarios**
   - every Design §29 scenario has an owning task/test in the traceability table;
   - Scenarios 48–49 appear in their focused owning Task 7/9 RED→GREEN procedures;
   - Scenario 50 has Task 3 focused authorization evidence plus Task 14 E2E closure;
   - Scenario 51 has Task 10 Superpowers-progression evidence, Task 12 OmO-runtime evidence, and Task 14 cross-component E2E closure.
3. **Type/signature consistency**
   - `ApprovedArtifactChain`, `TaskIdentity`, `SuperpowersExecutionMethod`, `OmoCategoryName`, `WorkflowMethodSelection`, `WorkflowMethodSelectionEvidence`, `WorkflowActivationEvidence`, `WorkflowActivationDecision`, `SemanticExecutionClass`, `SemanticClassificationResult`, `NativeSuperpowersProvenanceProfile`, `NativeSuperpowersProvenanceInput`, `TaskRoutingProvenance`, `TrustedSuperpowersProvenance`, `TranslateTaskRoutingInput`, `SuperpowersRoutingTranslationResult`, `ExecutionCorrelation`, `ConformanceContract`, `ScopedFindingMarkerExtraction`, `ReviewFindingTarget`, `ReviewFindingContextProvider`, `JusticeReviewResult`, `RevisionDiffProvider`, `FinalReviewEvidenceClosure`, `BlockedFinalReviewEvidenceAttempt`, `PlanConformanceInput`, and severity/finding-disposition vocabulary are identical at every producer/consumer boundary;
   - Task 2 provenance domain has no dependency on Task 10-owned activation types;
   - Task 6 is the sole trusted runtime provenance producer;
   - Task 7 consumes trusted provenance through `ReviewDispatchInput.provenance`;
   - Task 10 consumes provenance only through the Task 2-owned `translateTaskRouting(TranslateTaskRoutingInput)` contract;
   - the dependency direction is Task 1 → Task 2 → Task 6 → Task 7/Task 10 → Task 14 with no provenance/activation back-edge.
4. **Ownership**
   - Superpowers remains the owner of execution-method selection and all task/review/fix/final progression;
   - Justice owns only selected-method activation plus semantic classification/category translation/correlation/evidence/acceptance;
   - no task adds Justice-owned task/review/fix scheduling;
   - no task adds concrete model/provider/reasoning/retry/fallback ownership;
   - recognized Superpowers Native worker/reviewer intent maps to one model-issued OmO `task` whose existing input is translated without breaking category/subagent_type XOR; explicit specialized/external routing and caller-owned custom categories remain preserved;
   - OmO `st_...` task ids/names and `task_send` continuation remain runtime-owned;
   - selection recovery and activation recovery are separate: cross-session state can restore method selection but only Task-1-proven current-session Native skill evidence can suppress fresh activation.
5. **TDD**
   - production behavior changes have RED then GREEN steps;
   - Task 1 is an executable Native evidence spike that closes the exact adapter contract; failure blocks production implementation and requires artifact reconciliation.
6. **Persistence**
   - v4 state is recognized without becoming v5 authority;
   - unknown/newer state is preserved and blocks affected acceptance.
7. **Final review revision**
   - the trusted `FinalReviewEvidenceClosure` and Final Conformance Gate must cover the exact candidate HEAD without changing Superpowers final-review progression.
8. **Proportion**
   - bodies/algorithms are not pre-written; the plan fixes interfaces, assertions, commands, and architecture decisions only.
