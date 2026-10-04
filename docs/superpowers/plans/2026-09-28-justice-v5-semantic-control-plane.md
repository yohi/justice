# Justice v5 Semantic Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Justice as the fail-closed semantic nervous system between Superpowers v6.4.2 and OmO v5 OpenCode edition, with zero unresolved semantic drift at PlanComplete.

**Architecture:** Superpowers owns WHAT (method selection and workflow/review progression), Justice owns the activation bridge plus SEMANTIC HOW (execution classification, provenance-aware category translation, correlation/evidence/acceptance), and OmO owns CONCRETE HOW (agent/runtime/model/provider/reasoning/retry/fallback). Justice activates only an authoritative selected Superpowers method, translates recognized Superpowers generic workers into one semantic `sp-*` category, and never becomes either a scheduler or a concrete model/provider resolver.

**Tech Stack:** TypeScript 6.x, Bun, Vitest 4.x, Effect, Zod, YAML, OpenCode plugin hooks, existing AtomicPersistence and Observation Log infrastructure.

**Requirements:** `docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md`

**Spec:** `docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md`

**Implementation Baseline:** `master @ 080bcdb25b192962789ff5d67139e56487381de4`

**Historical Compatibility Reference:** Justice `v4.3.1` is a side-branch historical regression corpus only. It is **not** the Justice v5 implementation base. Do not merge or wholesale cherry-pick `v4.3.1` before implementing this Plan. Carry forward only the harness-independent regression contracts explicitly incorporated below.

## Global Constraints

- Superpowers owns execution-method selection, task selection, review scheduling, fix/re-review progression, ledger progression, and final whole-branch review. Justice MUST NOT duplicate that orchestration.
- Justice owns activation of the authoritatively selected supported Superpowers execution method and semantic Superpowers→OmO category translation; activation does not grant progression ownership.
- OmO owns concrete agent/runtime/category resolution, model/provider/reasoning selection, retry, fallback, and continuation `task_id=ses_...`. Justice MUST NOT seize those responsibilities.
- Recognized Superpowers `subagent_type="general"` on a new worker is a compatibility marker and MUST be translated to exactly one authoritative Justice category; non-Superpowers explicit subagent routing and OmO continuations remain preserved.
- Justice MUST NOT select a concrete model/provider. Ambiguous semantic classification is untrusted/`NOT_PROVEN`, not a reason to fabricate a category or model.
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
- All production implementation tasks start from `master @ 080bcdb25b192962789ff5d67139e56487381de4`. Justice `v4.3.1` is not a merge/cherry-pick prerequisite and does not replace this base.

## Review Focus

- **Post-review mutation:** a reviewer approves commit A, then HEAD changes to B; Task 9 must prove B cannot reuse A's review/conformance evidence.
- **Projection omission:** a malformed or unsupported Plan section disappears from projection; Task 4 must prove projection becomes INCOMPLETE/INVALID rather than silently complete.
- **Continuation collision:** an OmO `ses_...` continuation is unrelated to the current Justice task; Task 5/6 must prove it cannot rebind semantic identity without a trusted child relation.
- **Config precedence:** user, ancestor project, nearest project, harness, and profile layers disagree; Task 11 must prove doctor reports the exact effective value and its sources.
- **Upgrade recovery:** v4 state and unknown/newer state coexist with v5 files; Task 13 must prove neither can silently satisfy v5 acceptance.

## Historical Regression Evidence — Justice v4.3.1

Justice `v4.3.1` was released from the v4 side branch and is **not** the v5 implementation base. The full v4 implementation is non-normative for v5. It is retained as a regression corpus: production failures are translated into harness-independent proof obligations, while OpenCode/OmO-v4 mechanics are discarded unless current supported-runtime evidence independently requires them.

### Retained v4.2.0 regression contracts

The previously recorded v4.2.0 contracts remain mandatory regression evidence:

- `821343eba1223371ae0a7a20e02e7370db900306` — completed-plan final review must be recognized before implementation-task exhaustion / plan-completion cleanup can suppress the review path;
- `4759d777aab9c80b897c55392bcc0f5833d79d7b` — task/scoped/final review workers must remain outside implementation semantics and implementation-worker enrichment;
- `1781c7efae22ac1304fa8dc0d1f621c888943a1e` — recognized Superpowers review semantic routing must survive the OpenCode generic `subagent_type="general"` compatibility marker.

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

The historical v4 review setting `run_in_background=false` is also non-normative. It may only appear as a bounded Task 1/7 compatibility assertion if current supported-runtime evidence proves it is required to preserve the Superpowers review lifecycle; it must not become a new Justice-owned review-scheduling policy.

Task ownership for the v4.3.1 corpus is explicit:

- Task 3 proves that review evidence never manufactures human implementation authorization and that artifact mutation invalidates the exact approved chain;
- Task 7 proves trusted review producer/provenance recognition and strict rejection of ambiguous/malformed/stale results;
- Task 9 proves reviewed-candidate freshness through final evidence closure;
- Task 10 proves remediation/re-review progression remains Superpowers-owned and Justice does not schedule fix/re-review work;
- Task 12 proves provider/runtime failure classification remains diagnostic-only and cannot initiate Justice retry/fallback, preserving OmO runtime ownership;
- Task 14 closes Design §29 Scenario 50 (review evidence cannot manufacture human implementation authorization) and Scenario 51 (Superpowers progression ownership + OmO runtime ownership) end-to-end; Scenarios 48–49 are fully owned by their focused Task 7/9 tests and require no duplicate E2E case.

Task 1 remains the OpenCode 1.18.31 / Superpowers v6.4.2 runtime review-interop regression gate. It is **not** a v4.3.1 behavior-compatibility gate.

---

## File Structure Locked by This Plan

New focused modules:

- `src/core/artifact-chain.ts` — v5 Requirements/Design/Plan revision identity and chain types.
- `src/core/conformance-contract.ts` — normative clauses, projection status, contract/result types.
- `src/core/conformance-contract-store.ts` — immutable durable Conformance Contract persistence and reviewer-readable paths.
- `src/core/superpowers-plan-parser.ts` — deterministic parser for the v6.4.2 plan structures Justice treats as normative.
- `src/core/conformance-projector.ts` — Requirements/Design/Plan projection and completeness validation.
- `src/core/execution-correlation.ts` — durable parent-session/call ↔ semantic task ↔ child-session sidecar state.
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

## Verified Review-Interop Baseline

The architecture-critical review transport is fixed before implementation.

### Exact OpenCode 1.18.31 ordering contract

OpenCode v1.18.31 exposes:

- awaited `tool.execute.before` / `tool.execute.after` hooks;
- awaited `chat.message`;
- asynchronous plugin `event` forwarding whose returned Promise is **not awaited**.

Therefore Justice MUST NOT require its `session.created/session.updated` event handler to finish before the child reviewer's first `chat.message`.

The relevant OpenCode files are byte-identical between v1.18.29 and v1.18.31:

- `packages/opencode/src/session/prompt.ts`: `0f85d44f209ba792065aeb951f0bd2e12b59fae8`
- `packages/opencode/src/tool/task.ts`: `d8ca640cfba9a52d97e5180fda0ffa719910592b`
- `packages/plugin/src/index.ts`: `edfa0139dfcaf0e877ab906fabe8e0527afc3915`
- v1.18.31 tag commit: `014614d35b397775e5d397a490fc72368c894ec2`

OpenCode also exposes an authoritative awaited session lookup through the plugin client:

```ts
client.session.get({
  path: {
    id: childSessionId
  }
})
```

The successful Session contains `id` and optional `parentID`.

### Selected review-delivery contract

Justice uses:

```text
parent tool.execute.before
  → observe recognized Superpowers review
  → persist PendingReviewCorrelation(parentSessionId + parentCallId)
  → classify task/scoped review as review; final as final-review
  → translate subagent_type="general" to category=sp-review/sp-final-review
  → remove subagent_type; preserve XOR

TaskTool creates child session

child chat.message(input.sessionID)
  → await client.session.get({ path: { id: input.sessionID } })
  → require returned Session.id == input.sessionID
  → read authoritative Session.parentID
  → match exactly one pending review under that parent
  → bind child ↔ pending parent review
  → append one fully formed synthetic Justice TextPart to output.parts IN PLACE

session.created/session.updated
  → corroboration/cache/diagnostic only
  → never a delivery-order prerequisite

parent tool.execute.after
  → corroborate same parent call / child metadata
  → close review correlation
```

Lookup failure, missing/mismatched parent, or zero/multiple pending matches means no injection and `NOT_PROVEN`.

The appended Part is fixed:

```text
id        = "prt_justice_review_" + randomUUID()
sessionID = output.message.sessionID
messageID = output.message.id
type      = "text"
text      = rendered Justice review appendix
synthetic = true
```

`input.sessionID` must equal `output.message.sessionID`. The child `chat.message` appendix layer never removes/replaces original reviewer parts and never changes routing/model/provider/variant. Any recognized `general`→`sp-review` / `sp-final-review` translation already happened on the parent `tool.execute.before` routing layer.

### Before-hook mutation statement

OpenCode executes the same `args/taskArgs` object after `tool.execute.before`, so an in-place property mutation can be observable by the executor. Justice v5 **does not use that path by design** for review delivery; it uses the awaited child `chat.message` + authoritative session lookup contract above. Do not describe before-hook in-place mutation as source-impossible.

Superpowers v6.4.2 task review, scoped re-review, final whole-branch review, and ordinary SDD implementer templates use `Subagent (general-purpose)`; OpenCode V1 maps that to `task` with `subagent_type: "general"`. For recognized new-worker calls Justice treats this exact `general` value as the harness marker to be semantically translated, not as an explicit specialized subagent choice.

Task 1 is a runtime regression/replay gate for this already-selected architecture. A failure is upstream/runtime compatibility drift, not permission to invent a different architecture.

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

// Open OmO wire namespace for caller-owned explicit categories.
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

type TaskRoutingProvenance =
  | {
      readonly kind: "superpowers";
      readonly role: "implementation" | "task-review" | "scoped-re-review" | "final-review";
    }
  | { readonly kind: "external" }
  | { readonly kind: "ambiguous"; readonly reasons: readonly [string, ...string[]] };

type SuperpowersRoutingTranslationResult =
  | {
      readonly kind: "category";
      readonly executionClass: SemanticExecutionClass;
      readonly category: SpCategory;
    }
  | { readonly kind: "preserve_explicit_category"; readonly category: OmoCategoryName }
  | { readonly kind: "preserve_explicit_subagent"; readonly subagentType: string }
  | { readonly kind: "continuation"; readonly taskId: string }
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
  readonly parentCallId: string;
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
  readonly parentCallId: string;
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
      readonly reason: "sdk_error_response" | "missing_data" | "transport_error";
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
  readonly parentCallId: string;
  readonly omoContinuationSessionId?: string;
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
  readonly parentCallId: string;
  readonly taskArgs: Readonly<Record<string, unknown>>;
  readonly executionMethod: "subagent-driven-development" | "executing-plans";
  readonly artifactChain: ApprovedArtifactChain;
  readonly executionCorrelation?: ExecutionCorrelation;
  readonly contract: ConformanceContract;
};

type ChatMessageHook = NonNullable<Hooks["chat.message"]>;
type ChatMessageInput = Parameters<ChatMessageHook>[0];
type ChatMessageOutput = Parameters<ChatMessageHook>[1];

type JusticePluginClient = Pick<PluginInput["client"], "app" | "session">;

type ReviewAppendixInput = {
  readonly correlation: PendingReviewCorrelation & {
    readonly status: "child_bound";
    readonly childSessionId: string;
  };
  readonly contractPath: string;
};

type ResolveReviewChildInput = {
  readonly childSessionId: string;
  readonly client: JusticePluginClient;
  readonly pendingReviews: readonly PendingReviewCorrelation[];
};

type SessionGetFieldsResult = Awaited<
  ReturnType<JusticePluginClient["session"]["get"]>
>;

type BuildReviewAppendixPartInput = {
  readonly input: ChatMessageInput;
  readonly output: ChatMessageOutput;
  readonly appendix: string;
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

type WorkflowActivationEvidence = {
  readonly schemaVersion: "justice-workflow-activation-v1";
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly method: SuperpowersExecutionMethod;
  readonly skillCallId: string;
  readonly observedAt: string;
  readonly source: "skill_tool_success";
};

type WorkflowActivationInput = {
  readonly sessionId: string;
  readonly authorizationId: string;
  readonly selection: WorkflowMethodSelection;
  readonly currentSessionActivation?: WorkflowActivationEvidence;
  readonly capabilities: {
    readonly nativeSkillInvocation: boolean;
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
      readonly reason: "skill_invocation_unavailable" | "subagent_capability_unavailable" | "activation_state_unavailable";
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

`WorkflowActivationEvidence` is one current record per `authorizationId + sessionId`. A successful later activation atomically replaces that session record. It is trusted only when `authorizationId + sessionId + method` match the active selection, it originated from successful `tool.execute.after` observation of the native `skill` tool with `args.name === method` and `callID === skillCallId`, and `setActivation` returned `saved | idempotent`.

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
→ fresh current-session skill invocation
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

### Task 1: Lock the Race-Free Review-Interop Contract as a Runtime Regression Gate

**Requirements / Design:** JUS5-COMP-01..03, JUS5-REV-06..09, JUS5-CAT-05, JUS5-CORR-06, J5D-REVIEW-01..04, J5D-ROUTE-01.

**Files:**
- Create: `tests/integration/justice-v5-review-interop-host.test.ts`
- Create: `tests/fixtures/superpowers-v6.4.2-review-prompts.ts`
- Modify: `.github/workflows/ci.yml` only to pin this regression job to `opencode-ai@1.18.31`; this is test evidence, not a product allowlist.
- Production source: **none**

**Interfaces:**
- Consumes the fixed Design §14.2 contract:
  - parent `tool.execute.before` creates pending review correlation;
  - child `chat.message` is awaited;
  - the fixture plugin calls `client.session.get({ path: { id: input.sessionID } })` inside `chat.message` using default fields-response semantics;
  - only `lookup.data` is treated as the authoritative Session; `lookup.error`, missing `data`, or thrown transport errors block injection;
  - authoritative `lookup.data.parentID` selects exactly one pending parent review;
  - `session.created/session.updated` may be arbitrarily delayed and are not required for injection;
  - one fully formed synthetic text Part is appended in place;
  - parent `tool.execute.after` corroborates the same review relation.
- Produces runtime regression evidence only. It does not select/discover another architecture.

- [ ] **Step 1: Add the three exact Superpowers v6.4.2 reviewer fixtures**

Represent:
- task review: brief/report/base/head/diff;
- scoped re-review: original findings/fix-base/head/diff;
- final whole-branch review: plan-or-requirements/base/head;
- OpenCode V1 routing: `subagent_type: "general"`.

- [ ] **Step 2: Add exact runtime regression cases**

In `tests/integration/justice-v5-review-interop-host.test.ts`:

- `task_review_uses_authoritative_child_session_lookup_and_injects_appendix`
- `scoped_re_review_uses_authoritative_child_session_lookup_and_injects_appendix`
- `final_review_uses_authoritative_child_session_lookup_and_injects_appendix`
- `child_chat_message_can_bind_via_authoritative_session_lookup_without_waiting_for_event_hook`
- `delayed_session_created_plugin_event_does_not_lose_review_appendix`
- `session_lookup_parent_mismatch_blocks_injection`
- `session_get_fields_response_uses_data_as_authoritative_session`
- `session_get_error_response_blocks_injection`
- `session_get_transport_failure_blocks_injection`
- `review_interop_supports_same_call_general_to_category_translation_without_duplicate_dispatch`
- `synthetic_review_part_uses_actual_child_message_identity`
- `review_result_is_attributed_to_same_parent_call_and_child_session`

Assertions:
- exactly one existing Superpowers reviewer dispatch occurs;
- parent `sessionID + callID` are observed;
- the `chat.message` hook can bind from awaited `session.get` even when no Justice event callback has completed;
- delayed `session.created` handling does not change whether the appendix reaches the reviewer;
- fields-response success reads `lookup.data`; SDK/HTTP error response, `data` absence, transport exception, parent mismatch, or zero/multiple pending matches produces no appendix and untrusted evidence;
- synthetic Part has `prt_justice_review_<uuid>`, actual child `sessionID`, actual child user-message `messageID`, `type: "text"`, and `synthetic: true`;
- original reviewer content remains present;
- the fixture proves in-place parent-args translation can remove `subagent_type="general"`, add exactly one category, and reach the same executor call without creating another dispatch;
- the translated payload never contains both category and subagent_type;
- model/provider/variant are not rewritten;
- parent after-hook/result and child session are attributable to the same review correlation;
- no duplicate Justice reviewer is created.

- [ ] **Step 3: Pin and verify the host-test baseline**

Change the existing CI host-test install to exactly:

```text
bun install --global opencode-ai@1.18.31
```

The regression file asserts `opencode --version == 1.18.31` for this baseline replay only. Task 11 remains capability-first.

- [ ] **Step 4: Run the regression gate**

Run: `bun run vitest run tests/integration/justice-v5-review-interop-host.test.ts`

Expected: all twelve cases PASS, including same-call generic-marker translation capability.

Failure means upstream/runtime compatibility drift. STOP implementation and return to Design review; do not add Justice-owned reviewers and do not make async session-event completion a delivery prerequisite.

- [ ] **Step 5: Commit the regression evidence**

```bash
git add .github/workflows/ci.yml tests/integration/justice-v5-review-interop-host.test.ts tests/fixtures/superpowers-v6.4.2-review-prompts.ts
git commit -m "test: lock Justice v5 review interop baseline"
```

---

### Task 2: Establish v5 Semantic Routing Types and Provenance-Aware OmO Wire Translation

**Requirements / Design:** JUS5-CAT-01..05, JUS5-CAT-09, JUS5-CORR-01, JUS5-CORR-05..06, JUS5-TASK-03..04, J5D-CORR-01, J5D-ROUTE-01, J5D-CAT-01..02.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/task-packager.ts`
- Modify: `src/core/omo-category-mapper.ts`
- Test: `tests/core/v5-task-routing-contract.test.ts`
- Test: `tests/core/omo-category-mapper-v5.test.ts`

**Interfaces:**
- Produces registry-defined `TaskIdentity`, `ReviewFindingV5`, `SuperpowersExecutionMethod`, `OmoCategoryName`, `SemanticExecutionClass`, `SemanticClassificationResult`, `TaskRoutingProvenance`, and `SuperpowersRoutingTranslationResult` in `src/core/types.ts`.
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
    | { readonly kind: "category"; readonly category: OmoCategoryName }
    | { readonly kind: "subagent"; readonly subagentType: string }
    | { readonly kind: "continuation"; readonly taskId: string }
    | { readonly kind: "unrouted" }
    | { readonly kind: "invalid_both"; readonly category: string; readonly subagentType: string };

  function parseOmoCategoryName(value: unknown): OmoCategoryName | null;

  function inspectTaskRoutingTarget(
    input: Readonly<Record<string, unknown>>,
  ): TaskRoutingTarget;

  function translateTaskRouting(input: {
    readonly target: TaskRoutingTarget;
    readonly provenance: TaskRoutingProvenance;
    readonly classification?: SemanticClassificationResult;
  }): SuperpowersRoutingTranslationResult;
  ```
- Translation precedence is exact:
  1. legitimate `task_id=ses_...` continuation → `continuation`, no new category;
  2. explicit non-empty category string → preserve byte-for-byte as `OmoCategoryName`; do not require membership in `TaskCategory` or `SpCategory`;
  3. non-Superpowers explicit subagent → preserve;
  4. recognized Superpowers non-generic specialized subagent (for example `explore`) → preserve;
  5. recognized Superpowers new-worker `subagent_type="general"` + classified semantic intent → remove `subagent_type`, emit one mapped `sp-*` category;
  6. recognized Superpowers new worker with no target + classified semantic intent → emit one mapped `sp-*` category;
  7. invalid both-target / ambiguous provenance / ambiguous classification → `untrusted`.
- `TaskCategory` is only the known/current built-in vocabulary for compatibility/doctor assertions; it is not the caller-owned wire namespace.
- `parseOmoCategoryName` accepts every non-empty string and returns it unchanged; unknown-to-Justice names remain OmO-owned.
- `translateTaskRouting` never chooses model/provider/reasoning/fallback and never mutates continuation `task_id`.
- `normalizeTaskToolInput(InPlace)` preserves a legitimate OmO `task_id=ses_...`.
- `enrichTaskToolInput` never serializes `TaskIdentity` into `task_id`.

- [ ] **Step 1: Write RED routing/domain tests**

Exact tests in `tests/core/v5-task-routing-contract.test.ts`:
- `preserves_omo_continuation_task_id`
- `never_serializes_justice_task_identity_as_task_id`
- `reports_category_subagent_type_as_invalid_both`
- `preserves_non_superpowers_explicit_subagent_type_without_category_injection`
- `preserves_superpowers_specialized_non_generic_subagent_type_without_category_injection`
- `preserves_explicit_category_without_subagent_type_injection`
- `preserves_user_defined_omo_category_without_translation`
- `unknown_to_justice_but_caller_owned_category_is_not_rejected_by_static_union`
- `explicit_custom_category_never_gains_subagent_type`
- `justice_generated_semantic_category_remains_sp_category`
- `recognized_superpowers_general_worker_translates_classified_intent_to_category`
- `recognized_superpowers_general_worker_never_emits_category_and_subagent_type_together`
- `ambiguous_superpowers_semantic_classification_is_untrusted`
- `does_not_inject_category_into_continuation`
- `justice_category_is_the_only_semantic_routing_signal_to_omo`
- `justice_does_not_select_concrete_model_or_provider`

In `tests/core/omo-category-mapper-v5.test.ts`:
- `does_not_emit_legacy_deep`
- `recognizes_deep_low_deep_high_artistry`
- `custom_sp_categories_coexist_with_omo_v5_categories`
- `maps_semantic_execution_classes_to_exact_sp_categories`

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts`

Expected: FAIL on legacy `deep`, semantic `task_id` enrichment, missing provenance-aware translation, and missing semantic-class domain types.

- [ ] **Step 3: Implement exact routing domain + pure translation primitive**

Implement only the pure wire-boundary translation. Task 2 does **not** decide whether a dispatch is Superpowers-owned and does **not** classify implementation complexity; Task 7 supplies review provenance/classes and Task 10 supplies implementation activation/classification.

Do not select model/provider/reasoning/fallback. Do not normalize invalid/ambiguous routing into a trusted category.

- [ ] **Step 4: Run GREEN tests and typecheck**

Run:
- `bun run vitest run tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts`
- `bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/task-packager.ts src/core/omo-category-mapper.ts \
  tests/core/v5-task-routing-contract.test.ts tests/core/omo-category-mapper-v5.test.ts
git commit -m "refactor: define Justice semantic routing boundary"
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

Run:
- focused tests above
- `bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/conformance-contract.ts src/core/conformance-contract-store.ts src/core/superpowers-plan-parser.ts \
  src/core/conformance-projector.ts src/core/plan-parser.ts \
  tests/core/superpowers-plan-parser.test.ts tests/core/conformance-projector.test.ts \
  tests/core/conformance-contract.test.ts tests/core/conformance-contract-store.test.ts
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

- [ ] **Step 4: Run GREEN tests + exact existing adapter regressions + typecheck**

Run:
```bash
bun run vitest run \
  tests/runtime/opencode-adapter-execution-correlation.test.ts \
  tests/runtime/opencode-adapter.test.ts \
  tests/runtime/opencode-adapter-capability.test.ts \
  tests/runtime/opencode-adapter-v2.test.ts
bun run typecheck
```

The three pre-existing adapter files are regression-run inputs only; Task 6 does not plan to modify them. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/opencode-adapter.ts src/core/justice-plugin.ts src/core/types.ts \
  tests/runtime/opencode-adapter-execution-correlation.test.ts
git commit -m "feat: bind OpenCode calls to Justice task identity"
```

---

### Task 7: Implement Superpowers Open-Set Finding Transport, Exact SDK Child Lookup, and Strict Review Parsing

**Requirements / Design:** JUS5-REV-01..09, JUS5-SDD-03, JUS5-CAT-05, JUS5-CAT-09, JUS5-CORR-06, J5D-REVIEW-01..04, J5D-ROUTE-01..02, J5D-CAT-02.

**Files:**
- Create: `src/core/review-interop.ts`
- Create: `src/core/review-result.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/review-interop.test.ts`
- Test: `tests/core/review-result.test.ts`
- Test: `tests/runtime/opencode-adapter-review-interop.test.ts`

**Interfaces:**
- Consumes `FindingId`, `TaskIdentity`, `ReviewFindingV5`, `SemanticExecutionClass`, `TaskRoutingProvenance`, `SemanticClassificationResult`, and `translateTaskRouting` from Task 2 plus `ClauseResult` / `ClauseEvidenceScope` / `ConformanceContract` from Task 4.
- Owns registry-defined `ReviewFindingTarget`, `ScopedFindingMarkerExtraction`, `ReviewFindingContextQuery`, `ReviewFindingContextResult`, `ReviewFindingContextProvider`, `RecognizedReviewDispatch`, `PendingReviewCorrelation`, `PreparePendingReviewResult`, `ReviewChildBindingResult`, and `ParseReviewResult`.
- Changes `OpenCodePluginInit.client` to:
  ```ts
  type JusticePluginClient = Pick<PluginInput["client"], "app" | "session">;
  ```
- `chat.message` input/output types are derived directly from `Hooks["chat.message"]`.
- Produces:
  ```ts
  type ReviewKindV5 = "task-review" | "scoped-re-review" | "final-review";

  type ReviewResultExpectation =
    | {
        readonly reviewCorrelationId: string;
        readonly reviewKind: "task-review" | "final-review";
        readonly artifactChainId: string;
        readonly taskIdentity?: TaskIdentity;
        readonly contractId: string;
        readonly contractDigest: string;
        readonly reviewedRange: { readonly base: string; readonly head: string };
        readonly requiredClauseIds: readonly string[];
        readonly expectedFindings?: never;
        readonly reservedFindingIds?: never;
      }
    | {
        readonly reviewCorrelationId: string;
        readonly reviewKind: "scoped-re-review";
        readonly artifactChainId: string;
        readonly taskIdentity?: TaskIdentity;
        readonly contractId: string;
        readonly contractDigest: string;
        readonly reviewedRange: { readonly base: string; readonly head: string };
        readonly requiredClauseIds: readonly string[];
        readonly expectedFindings: readonly ReviewFindingTarget[];
        readonly reservedFindingIds: readonly FindingId[];
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
    readonly quality: {
      readonly verdict: "approved" | "needs_fixes";
      readonly findings: readonly ReviewFindingV5[];
    };
    readonly clauses: readonly ClauseResult[];
  };
  ```
- Exact marker:
  ```text
  [[justice-finding:<findingId>]]
  ```
  with runtime ID regex `^jf_[0-9a-f]{16}$`.
- Exact signatures:
  - `extractScopedFindingMarkerIds(prompt: string): ScopedFindingMarkerExtraction`
  - `recognizeSuperpowersReviewDispatch(input: ReviewDispatchInput): RecognizedReviewDispatch`
  - `preparePendingReviewCorrelation(review: Extract<RecognizedReviewDispatch, { readonly kind: "recognized" }>["review"], deps: { findingContextProvider: ReviewFindingContextProvider }): Promise<PreparePendingReviewResult>`
  - `resolveReviewChildFromSession(input: ResolveReviewChildInput): Promise<ReviewChildBindingResult>`
  - `buildJusticeReviewAppendix(input: ReviewAppendixInput): string`
  - `buildJusticeReviewAppendixPart(input: BuildReviewAppendixPartInput): ChatMessageOutput["parts"][number]`
  - `parseJusticeReviewResult(output: string, expected: ReviewResultExpectation): ParseReviewResult`
  - `translateRecognizedReviewRouting(review: Extract<RecognizedReviewDispatch, { readonly kind: "recognized" }>, taskArgs: Record<string, unknown>): SuperpowersRoutingTranslationResult`

**Review semantic-routing contract:**
- review recognition happens before parent task execution and before child-session creation;
- recognized `task-review` / `scoped-re-review` produces semantic class `review`; recognized `final-review` produces `final-review`;
- provenance is `{ kind: "superpowers", role: <review kind> }`;
- when raw routing is `subagent_type="general"` with no continuation, call `translateTaskRouting` and mutate the same parent task args in place to:
  - task/scoped: `category="sp-review"` and no `subagent_type`;
  - final: `category="sp-final-review"` and no `subagent_type`;
- a recognized specialized non-generic subagent route is preserved;
- continuation remains continuation-owned and receives no new review category;
- ambiguous/untrusted review recognition is not category-translated as trusted routing;
- the later child `chat.message` appendix path never changes routing.
**Current scoped target extraction:**
- for scoped re-review only, read `taskArgs.prompt` as a string;
- take content strictly between exact headings `## The Findings Under Verification` and the next exact `## The Fix`;
- extract only exact Justice markers from that section;
- preserve first-appearance order;
- duplicate/malformed marker → `RecognizedReviewDispatch.kind = "untrusted"`;
- no markers → recognized scoped review with `requestedFindingIds = []`;
- markers outside that section never enter the requested set.

**Finding-context preparation:**
- task/first-final review → no context lookup; `expectedFindings` absent;
- scoped re-review → query `ReviewFindingContextProvider` with:
  - exact artifact chain/scope/task identity;
  - `precedingReviewedHead = review.reviewedRange.base`;
  - exact `requestedFindingIds = review.requestedFindingIds` extracted from the current scoped dispatch;
- `resolved(expectedFindings=[], reservedFindingIds=[...])` is valid and produces `kind: "ready"`;
- copy both `expectedFindings` and `reservedFindingIds` into the scoped `PendingReviewCorrelation`;
- missing/ambiguous/untrusted context, including `historical_finding_id_collision`, → no trusted pending correlation / no structured appendix / `NOT_PROVEN`.
- Task 7 ships a fail-closed unavailable provider until Task 8 wires the production store-backed provider. Tests inject deterministic fakes.

**Review appendix contract:**
- task/final review:
  - instruct every machine quality finding to use one fresh `jf_<16 lowercase hex>` ID;
  - require the corresponding human-readable finding line to contain exactly `[[justice-finding:<same id>]]`.
- scoped re-review:
  - include the correlation's `expectedFindings` array even when empty;
  - include `reservedFindingIds` as a collision-prevention namespace, explicitly stating that reserved non-target IDs are **not** verdict targets;
  - require exact marker/ID/severity/summary/location echo for each expected target;
  - `ADDRESSED → resolved`; `NOT ADDRESSED → open`;
  - new breakage gets a fresh ID outside both current expected IDs and all `reservedFindingIds`, plus a matching marker.
- `human_adjudicated` is forbidden reviewer output.
- `expectedFindings=[]` still injects the Conformance Contract and requires clause results.

**Structured-result parser contract:**
- for every review kind, human quality-finding markers and machine `findingId` values must be one-to-one;
- machine quality finding with no human marker → `missing_finding_marker`;
- orphan/malformed human marker → invalid;
- human marker ID != machine finding ID → `finding_marker_mismatch`;
- duplicate ID → `duplicate_finding_id`;
- scoped expected ID missing → `missing_expected_finding`;
- scoped expected metadata mismatch → `expected_finding_mismatch`;
- new breakage may not reuse a current expected ID;
- every scoped `expectedFindings[].findingId` MUST belong to `reservedFindingIds`; otherwise the expectation/context is invalid;
- new breakage may not reuse any historical `reservedFindingIds` ID, including deferred Minor or prior resolved IDs;
- no summary/location/order fuzzy matching is permitted.
- Serialization remains exactly one final fenced `justice-review-result-v1` JSON block.

**RG-007 transport remains unchanged:**
- fields-response `lookup.data` is the authoritative child Session;
- transport/error/missing-data → no injection / `NOT_PROVEN`;
- session events are corroboration only;
- synthetic Part uses actual child session/message identity.

- [ ] **Step 1: Write RED marker/open-set/adapter tests**

In `tests/core/review-interop.test.ts`:
- `superpowers_open_finding_marker_is_used_as_scoped_identity_authority`
- `minor_finding_excluded_from_fix_loop_is_not_added_to_expected_findings`
- `addressed_finding_is_not_reintroduced_in_next_fix_round`
- `next_round_expected_findings_match_only_current_superpowers_open_finding_ids`
- `current_expected_findings_remain_only_current_superpowers_targets`
- `new_blocking_breakage_marker_survives_into_next_scoped_round`
- `spec_only_scoped_rereview_allows_empty_expected_findings`
- `unknown_requested_finding_id_is_untrusted`
- `duplicate_requested_finding_id_is_untrusted`

In `tests/runtime/opencode-adapter-review-interop.test.ts`:
- `does_not_dispatch_duplicate_reviewer_for_recognized_superpowers_review`
- `superpowers_task_review_maps_to_sp_review`
- `superpowers_scoped_rereview_maps_to_sp_review`
- `superpowers_final_review_maps_to_sp_final_review`
- `recognized_superpowers_review_translation_preserves_category_subagent_xor`
- `recognized_superpowers_review_semantic_routing_survives_generic_marker_translation`
- `review_appendix_path_does_not_rewrite_semantic_routing`
- `child_chat_message_resolves_parent_with_awaited_session_get_before_injection`
- `delayed_session_event_does_not_block_or_enable_review_injection`
- `session_lookup_parent_mismatch_blocks_review_injection`
- `session_get_fields_response_uses_data_as_authoritative_session`
- `session_get_error_response_blocks_injection`
- `session_get_transport_failure_blocks_injection`
- `injects_conformance_contract_into_authoritatively_bound_child_chat_message`
- `synthetic_review_part_uses_output_message_session_and_message_ids`
- `empty_expected_findings_still_injects_conformance_contract_for_clause_reproof`
- `ambiguous_review_like_action_is_not_trusted_without_recognized_superpowers_provenance`

For `ambiguous_review_like_action_is_not_trusted_without_recognized_superpowers_provenance`, RED must demonstrate that a review-looking/model-inferred task lacking recognized Superpowers review provenance cannot create a trusted pending review correlation, cannot receive trusted review evidence status, and cannot satisfy review acceptance. Minimum GREEN behavior is `untrusted` / `NOT_PROVEN` with no fabricated review category or evidence producer identity.

In `tests/core/review-result.test.ts`:
- `initial_review_human_marker_matches_machine_finding_id`
- `missing_required_clause_result_becomes_not_proven`
- `missing_or_malformed_review_result_is_rejected`
- `reviewer_cannot_assert_human_adjudicated_disposition`
- `scoped_result_must_echo_expected_original_finding_id`
- `missing_expected_original_finding_is_rejected`
- `duplicate_original_finding_id_is_rejected`
- `expected_finding_metadata_mismatch_is_rejected`
- `new_breakage_cannot_reuse_current_expected_finding_id`
- `new_breakage_cannot_reuse_deferred_minor_finding_id`
- `new_breakage_cannot_reuse_resolved_prior_round_finding_id`
- `historical_reserved_id_does_not_become_current_expected_target`
- `orphan_or_malformed_human_finding_marker_is_rejected`

Historical review-routing regression assertions for `recognized_superpowers_review_semantic_routing_survives_generic_marker_translation`:

- use the existing Superpowers reviewer dispatch; Justice creates no additional reviewer;
- recognized task/scoped review remains semantic `review → sp-review`;
- recognized final review remains semantic `final-review → sp-final-review`;
- the generic `subagent_type="general"` marker is removed and category/subagent_type XOR remains valid;
- external/ambiguous both-target input remains a routing-contract violation; this regression does not legalize the v4.2.0 external both-target normalization behavior;
- original Superpowers review prompt/content is preserved; only the existing Justice review appendix path may enrich reviewer content.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/review-interop.test.ts tests/core/review-result.test.ts tests/runtime/opencode-adapter-review-interop.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement current-dispatch marker transport and review parsing**

Implement:
1. recognize task/scoped/final Superpowers review provenance;
2. translate the recognized parent `subagent_type="general"` marker to `sp-review` / `sp-final-review` through Task 2's pure translator;
3. exact scoped section extraction;
4. marker parsing/validation;
5. current-dispatch `requestedFindingIds`;
6. provider-backed metadata resolution;
7. exact SDK child lookup;
8. appendix generation for initial/final/scoped reviews without further routing mutation;
9. human-marker ↔ machine-envelope parity validation.

The review-interop module does not read persistence directly and never decides which findings Superpowers keeps open.

- [ ] **Step 4: Run GREEN focused tests + Task 1 regression gate + typecheck**

Expected: PASS. Production scoped metadata lookup remains fail-closed until Task 8 wires the store-backed provider.

- [ ] **Step 5: Commit**

```bash
git add src/core/review-interop.ts src/core/review-result.ts src/runtime/opencode-adapter.ts src/core/types.ts \
  tests/core/review-interop.test.ts tests/core/review-result.test.ts tests/runtime/opencode-adapter-review-interop.test.ts
git commit -m "feat: follow Superpowers open findings in review interop"
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
- Test: `tests/runtime/opencode-adapter-review-interop.test.ts`

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

In `tests/runtime/opencode-adapter-review-interop.test.ts`:
- `store_backed_provider_uses_current_scoped_marker_ids_for_expected_findings`
- `store_backed_provider_supplies_lineage_reserved_finding_ids`
- `empty_store_backed_expected_findings_still_inject_clause_reproof_appendix`

Existing quality tests remain:
- `not_addressed_finding_remains_blocking`
- `parked_important_finding_remains_visible_and_blocking`
- `parked_critical_or_important_blocks_until_trusted_disposition`

Also assert Minor retention, human-adjudication/clause separation, legacy-major migration, trusted direct output, and untrusted plain-file fallback.

- [ ] **Step 2: Run RED tests**

Run: `bun run vitest run tests/core/review-evidence-store.test.ts tests/core/review-quality-v5.test.ts tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts tests/runtime/opencode-adapter-review-interop.test.ts`

Expected: FAIL on current-open-set metadata resolution and marker-aware production wiring.

- [ ] **Step 3: Implement persistence and store-backed current-open-set context**

Persist trusted structured review evidence. Implement `ReviewFindingContextProvider` as exact metadata resolution/validation for dispatch-provided IDs plus lineage-wide reserved-ID evidence. Do not infer a replacement target set. Historical same-ID metadata conflicts are `untrusted`, never normalized.

Wire the store-backed provider through `justice-plugin.ts` into Task 7 review interop.

- [ ] **Step 4: Run GREEN tests + Task 7 marker/open-set regressions + typecheck**

Expected: PASS, including multi-round behavior and spec-only empty-quality context.

- [ ] **Step 5: Commit**

```bash
git add src/core/review-evidence-store.ts src/core/justice-plugin.ts src/core/types.ts src/core/v2/review-types.ts \
  src/core/v2/review-aggregator.ts src/core/v2/state-projection.ts src/core/review-resolution-artifact.ts \
  tests/core/review-evidence-store.test.ts tests/core/review-quality-v5.test.ts \
  tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts \
  tests/runtime/opencode-adapter-review-interop.test.ts
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

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/conformance-gate.ts src/runtime/revision-diff-provider.ts \
  src/core/acceptance-decision.ts src/core/v2/gate-context.ts src/core/v2/decision-model.ts src/core/v2/state-projection.ts \
  tests/core/conformance-gate.test.ts tests/core/acceptance-decision.test.ts tests/core/plan-completion-v5.test.ts \
  tests/runtime/revision-diff-provider.test.ts
git commit -m "feat: gate acceptance on type-safe final evidence"
```

---

### Task 10: Activate Selected Superpowers Method, Classify Semantic Work, and Remove Justice Scheduling Authority

**Requirements / Design:** JUS5-ACT-01..04, JUS5-SDD-01..04, JUS5-DEP-01..03, JUS5-TASK-01..04, JUS5-PLAN-01..05, JUS5-CAT-06..09, J5D-OWN-01, J5D-ACT-01, J5D-TASK-01, J5D-ROUTE-02, J5D-CAT-02, J5D-DEP-01.

**Files:**
- Create: `src/core/workflow-activation.ts`
- Modify: `src/core/workflow-directives.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/review-dispatch-state.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/core/plan-bridge-core.ts`
- Modify: `src/core/dependency-analyzer.ts`
- Modify: `src/core/plan-completion-detector.ts`
- Modify: `src/core/execution-role-classifier.ts`
- Modify: `src/core/category-classifier.ts`
- Test: `tests/core/workflow-activation-v5.test.ts`
- Test: `tests/runtime/opencode-adapter-semantic-routing.test.ts`
- Test: `tests/core/review-dispatch-state.test.ts`
- Test: `tests/core/review-dispatch-state-behavior.test.ts`
- Test: `tests/core/plan-bridge-core.test.ts`
- Test: `tests/core/dependency-analyzer.test.ts`
- Test: `tests/unit/core/execution-role-classifier.test.ts`
- Test: `tests/hooks/plan-bridge-authorization.test.ts`
- Test: `tests/hooks/plan-bridge-implement.test.ts`
- Test: `tests/hooks/plan-bridge-posttooluse.test.ts`
- Test: `tests/hooks/plan-bridge.test.ts`
- Test: `tests/integration/plan-bridge-fallback.test.ts`
- Test: `tests/integration/plan-bridge-flow.test.ts`
- Create: `tests/core/superpowers-ownership-v5.test.ts`
- Create: `tests/core/plan-completion-detector-v5.test.ts`

**Interfaces — activation bridge:**
- Implement registry-defined `resolveWorkflowMethodSelection(input): WorkflowMethodSelection` and `resolveWorkflowActivation(input): WorkflowActivationDecision` in `workflow-activation.ts`.
- `workflow-activation.ts` owns `.justice/v5/workflow-activation-state.json` through existing AtomicPersistence and implements the registry-defined `WorkflowActivationStateStore`. The file stores exactly one current selection per authorization and at most one current activation per authorization/session.
- Extend `ImplementationArmRequest.action="approve"` with optional `executionMethod?: SuperpowersExecutionMethod` representing explicit user/command selection.
- On explicit selection, atomically replace the authorization's selection record with `WorkflowMethodSelectionEvidence` containing current `authorizationId`, current controller `sessionId`, selected method, and selection time. `persistence_failed` makes activation state unavailable.
- `findSelection(authorizationId)` may return the one current selection record from another session. That recovery avoids re-asking which method was selected, but never proves current-session activation. An `untrusted` lookup is not equivalent to no selection; surface activation state unavailable.
- `findCurrentActivation(authorizationId, sessionId)` is the only persistence lookup that can satisfy `already_active` after restart, and only a `resolved` exact matching value is eligible.
- Extend `ImplementationArmResult` with `selection: WorkflowMethodSelection` and `activation: WorkflowActivationDecision`.
- Extend `CanonicalWorkflowSkill` with `subagent-driven-development | executing-plans`.
- Extend `WorkflowDirectiveInput` with `activation?: WorkflowActivationDecision`.
- Extend `WorkflowNextAction` with `continue_superpowers | await_method_selection | report_activation_blocked`.
- Implementation/implementation-arm directive mapping is exact:
  - `needs_activation` → `requiredSkills=[selected method]`, `nextAction="invoke_skill"`;
  - `already_active` → `requiredSkills=[]`, `nextAction="continue_superpowers"`; do not invoke the skill again;
  - `method_selection_required` → `requiredSkills=[]`, `nextAction="await_method_selection"`;
  - `unavailable | conflict` → `requiredSkills=[]`, `nextAction="report_activation_blocked"`;
  - implementation stages no longer use `delegate_task` as a Justice-owned progression action.
- OpenCode activation observation is exact: successful controller `tool.execute.after` for tool `skill`, with `args.name === selected method`; use hook `sessionID` + `callID` plus active `authorizationId` to persist `WorkflowActivationEvidence`. The activation is trusted only after `setActivation` returns `saved | idempotent`; persistence failure is fail-closed for methodology evidence.
- A worker call is trusted as selected-method execution only when `resolveWorkflowActivation` returns `already_active` for that same authorization/session/method.
- Same-session persisted activation may satisfy `already_active` after restart; cross-session activation evidence is never reused.
- Cross-session selection recovery flow is always: recovered selection → `needs_activation` → fresh current-session skill invocation → activation evidence.
- Conflict policy:
  - explicit current selection wins over stale recovered selection, but requires fresh activation if current activation is another method;
  - recovered-only selection conflicting with current-session activation → `conflict` / untrusted;
  - mismatched activation authorization/session → `conflict(activation_identity_mismatch)`.
- OmO `task_id=ses_...` never counts as methodology selection or activation.

**Selection / activation source model:**
```text
MethodSelection:
explicit current selection
> latest trusted persisted selection for same authorization
> method_selection_required

ActivationEvidence:
successful current-session skill(name=selected method)
or exact persisted same authorization + same session + same method evidence
```

Justice does not infer SDD vs inline from task complexity. If selected SDD lacks subagent capability, return `unavailable`; do not silently switch to executing-plans. If native skill invocation is unavailable, return `unavailable`.
**Interfaces — semantic classifier:**
- Implement registry-defined `classifySemanticExecution(input): SemanticClassificationResult`.
- Implementation input is the full Task 4 `ParsedSuperpowersTask` plus advisory cross-task dependency IDs; review input uses explicit `ReviewKindV5` semantics.
- Exact precedence: `final-review > review > architecture > deep > integration > mechanical > implementation`.
- Review rules:
  - `final-review` review kind → `final-review`;
  - task/scoped review kind → `review`.
- Implementation rules are deterministic and structurally guarded:
  - `architecture`: an explicit architecture/boundary/ownership/protocol/security/persistent-state decision obligation **and** a structured boundary surface (`interfaces/consumes/produces/signatures` non-empty or multiple affected components);
  - `deep`: explicit investigation/root-cause/research/unknown-behavior obligation, unless architecture already matched;
  - `integration`: at least two integration-surface signals among: 3+ files, non-empty Consumes/Produces, cross-task dependencies, explicit migration/state/concurrency/async/data-flow coordination;
  - `mechanical`: at most 2 files, no Consumes/Produces, no cross-task dependencies, no architecture/deep/integration signal, and an exact bounded deterministic edit obligation such as rename/constant/field/config/boilerplate/test-only;
  - otherwise `implementation`.
- A bare token such as `api`, `module`, or `architecture` without the required structured/semantic guard cannot upgrade the class.
- Missing parsed task semantics or mutually inconsistent authoritative metadata returns `ambiguous`; do not fabricate a category.
- Classifier output contains semantic class/category only; it never contains model/provider/reasoning/fallback.

**Interfaces — implementation routing:**
- For an authorized SDD implementation task, `resolveSuperpowersImplementationTask` first proves TaskIdentity/provenance from the Superpowers task brief.
- Task 10 then classifies that exact approved task and calls Task 2 `translateTaskRouting` on the existing parent task args.
- Recognized new-worker `subagent_type="general"` becomes exactly one `sp-mechanical | sp-implementation | sp-integration | sp-deep | sp-architecture` category and removes `subagent_type`.
- Recognized specialized non-generic subagent routing is preserved.
- Ambiguous classification may run fail-open on original generic routing where safe, but correlation/acceptance is untrusted/`NOT_PROVEN`.
- Justice never directly dispatches the implementer; it only translates the already-existing Superpowers dispatch.

**Interfaces — orchestration removal:**
- `review-dispatch-state.ts` remains only for recognizing/migrating historical v4 review-dispatch records; it no longer emits current reviewer directives.
- `DependencyAnalyzer` exposes advisory diagnostics only: `analyzeDependencies(tasks) -> DependencyDiagnostic[]`; it cannot order/dispatch work.
- `PlanBridge` preserves original Superpowers task semantics and does not reconstruct worker prompts or dispatch workers/reviewers.
- `PlanCompletionDetector` recognizes current artifact paths/contracts and removes obsolete reviewer-persona markers as authority.

**Historical review/implementation boundary regression contract:**
- for every incoming Superpowers `task` call, Task 7 review recognition/classification runs **before** implementation task resolution, implementation semantic classification, and plan-completion cleanup;
- if Task 7 recognizes `task-review | scoped-re-review | final-review`, PlanBridge returns through the review path and MUST NOT enter the implementation-worker enrichment pipeline;
- final-review recognition is independent of whether any implementation task remains incomplete;
- when all implementation tasks are already complete, a recognized whole-branch final reviewer is still correlated/routed as `final-review → sp-final-review` before any active-Plan completion cleanup can suppress recognition;
- review workers never receive the approved implementation-task contract, implementation-only Justice context/markers, or implementation-only TDD/verification skill injection;
- review workers never call the implementation-form `classifySemanticExecution({ kind: "implementation", ... })` or `resolveSuperpowersImplementationTask`;
- PlanBridge never reconstructs a Superpowers review prompt as an implementation prompt; original review prompt/content remains intact, with Justice review appendix enrichment occurring only through Task 7's existing review-interop path;
- recognized review routing uses the existing Superpowers reviewer dispatch exactly once; Justice never dispatches a replacement/duplicate reviewer;
- these ordering/non-leakage assertions are historical v4.2.0 regression coverage only and do not restore v4 scheduling, prompt reconstruction, hardcoded SDD selection, or external both-target normalization.

- [ ] **Step 1: Write RED activation/ownership tests**

In `tests/core/workflow-activation-v5.test.ts`:
- `authorized_implementation_activates_selected_superpowers_execution_method`
- `authorized_implementation_activates_superpowers_sdd`
- `explicit_inline_execution_activates_superpowers_executing_plans`
- `explicit_method_precedes_recovered_selection`
- `same_authorization_recovery_restores_method_selection_without_reselection`
- `observed_skill_activation_does_not_request_duplicate_skill_invocation`
- `cross_session_recovered_method_requires_fresh_skill_activation`
- `same_session_activation_evidence_can_be_reused_only_when_identity_matches`
- `recovered_method_does_not_by_itself_prove_current_session_activation`
- `conflicting_recovered_and_current_activation_is_fail_closed`
- `explicit_selection_overrides_stale_recovery_but_requires_matching_activation`
- `missing_authoritative_method_requires_method_selection`
- `selected_method_capability_failure_does_not_silently_switch_method`
- `superpowers_activation_failure_cannot_be_trusted_as_authorized_implementation`
- `activation_state_persistence_failure_cannot_produce_already_active`
- `activation_state_schema_failure_is_not_treated_as_missing_selection`

In `tests/core/superpowers-ownership-v5.test.ts`:
- `justice_activation_does_not_own_superpowers_task_progression`
- `justice_does_not_directly_dispatch_implementation_tasks_instead_of_superpowers`
- `implementation_completion_never_dispatches_sp_review`
- `all_tasks_accepted_never_dispatches_sp_final_review`
- `dependency_analyzer_cannot_reorder_or_dispatch_tasks`
- `justice_does_not_schedule_remediation_or_rereview`

For `justice_does_not_schedule_remediation_or_rereview`, RED must demonstrate that a blocking review result may block acceptance but cannot cause Justice to dispatch the fixer, schedule a scoped re-review, or advance the Superpowers fix loop. Minimum GREEN behavior is evidence/gate state only; Superpowers remains the sole fix/re-review progression owner.

In `tests/hooks/plan-bridge-implement.test.ts` add the historical boundary regressions:
- `completed_plan_final_review_is_recognized_before_plan_completion_cleanup`
- `task_review_never_enters_implementation_semantics`
- `scoped_re_review_never_enters_implementation_semantics`
- `final_review_never_enters_implementation_semantics`

Exact assertions:
- completed approved Plan + all implementation tasks complete + existing Superpowers whole-branch reviewer → recognized `final-review`, semantic `final-review`, `category="sp-final-review"`, no `subagent_type="general"`, no implementation task selection/classifier path, and no cleanup before review recognition/correlation;
- task/scoped review → `sp-review`; final review → `sp-final-review`;
- all three review kinds bypass implementation task-contract enrichment, implementation-only context/markers, implementation-only TDD/verification skill injection, and implementation prompt reconstruction;
- original Superpowers review prompt/content is preserved, with Justice appendix enrichment only through Task 7 review interop;
- the existing Superpowers reviewer dispatch count remains exactly one and Justice emits no reviewer dispatch.

- [ ] **Step 2: Write RED semantic-classification/routing tests**

In `tests/unit/core/execution-role-classifier.test.ts`:
- `single_file_deterministic_change_classifies_mechanical`
- `ordinary_feature_classifies_implementation`
- `cross_module_state_coordination_classifies_integration`
- `investigative_high_reasoning_task_classifies_deep`
- `component_boundary_decision_classifies_architecture`
- `task_review_classifies_review`
- `whole_branch_review_classifies_final_review`
- `architecture_precedes_generic_integration_signals`
- `classifier_uses_full_plan_semantics_not_keyword_only`
- `classifier_uses_full_plan_semantics_without_selecting_concrete_runtime`
- `ambiguous_semantic_classification_does_not_select_concrete_model`

In `tests/runtime/opencode-adapter-semantic-routing.test.ts`:
- `recognized_superpowers_general_worker_translates_to_justice_category`
- `recognized_superpowers_general_worker_never_emits_category_and_subagent_type_together`
- `external_explicit_subagent_type_is_preserved`
- `superpowers_specialized_subagent_type_is_preserved`
- `omo_continuation_does_not_receive_new_worker_category`
- `missing_superpowers_skill_activation_makes_worker_routing_untrusted`
- `justice_category_is_the_only_semantic_routing_signal_to_omo`
- `justice_does_not_select_concrete_model_or_provider`

- [ ] **Step 3: Run RED focused tests and confirm expected failures**

Before modifying any production source, run the authoritative Task 10 RED set:

```bash
bun run vitest run \
  tests/core/workflow-activation-v5.test.ts \
  tests/core/superpowers-ownership-v5.test.ts \
  tests/hooks/plan-bridge-implement.test.ts \
  tests/unit/core/execution-role-classifier.test.ts \
  tests/runtime/opencode-adapter-semantic-routing.test.ts
```

Expected: **FAIL before production changes** because the `master @ 080bcdb25b192962789ff5d67139e56487381de4` production baseline does not yet provide the v5 activation-state contract, Justice-without-progression ownership contract (including no remediation/re-review scheduling), review-before-implementation sequencing contract, semantic-classification contract, or provenance-aware v5 routing behavior.

The RED run MUST exercise the Step 1 historical boundary regressions in `tests/hooks/plan-bridge-implement.test.ts`, including:
- `completed_plan_final_review_is_recognized_before_plan_completion_cleanup`;
- `task_review_never_enters_implementation_semantics`;
- `scoped_re_review_never_enters_implementation_semantics`;
- `final_review_never_enters_implementation_semantics`.

Record the observed failure categories before starting Step 4. If any historical regression unexpectedly already passes on the master production baseline, inspect that test's contract/assertions and test seam to determine whether the baseline already satisfies that individual contract. A pre-existing PASS is not a reason to modify production merely to force RED. Production changes may begin only after the newly introduced v5 RED failures are understood and the historical regression tests are confirmed to exercise their intended paths.

- [ ] **Step 4: Remove active Justice scheduling authority and lock review-before-implementation sequencing**

Remove v4 active review/task progression behavior while retaining migration readers. Do not delete types needed to read prior state.

Wire PlanBridge so Task 7 review recognition/translation is evaluated before implementation-task resolution/classification and before Plan-completion cleanup. A recognized review returns through the review path immediately; only a non-review call may continue into implementation semantics.

- [ ] **Step 5: Implement activation bridge and activation observation**

Implement the AtomicPersistence-backed selection/activation store, then wire `workflow-activation.ts`, `workflow-directives.ts`, PlanBridge, `justice-plugin.ts`, and OpenCode `tool.execute.after` observation for the native `skill` tool (`args.name`). Persist successful current-session activation by authorization/session/method/call identity. Do not dispatch tasks from the bridge.

- [ ] **Step 6: Implement semantic classifier and implementation translation**

Replace keyword-first `ExecutionRoleClassifier` authority with the exact structured rules above. Route only already-recognized Superpowers new-worker calls through Task 2's translator. Preserve explicit external/specialized routing and continuation.

- [ ] **Step 7: Run GREEN focused tests + full suite**

Run the complete Task 10 focused regression set:

```bash
bun run vitest run \
  tests/core/workflow-activation-v5.test.ts \
  tests/core/superpowers-ownership-v5.test.ts \
  tests/hooks/plan-bridge-implement.test.ts \
  tests/unit/core/execution-role-classifier.test.ts \
  tests/runtime/opencode-adapter-semantic-routing.test.ts \
  tests/core/review-dispatch-state.test.ts \
  tests/core/review-dispatch-state-behavior.test.ts \
  tests/core/plan-bridge-core.test.ts \
  tests/core/dependency-analyzer.test.ts \
  tests/hooks/plan-bridge-authorization.test.ts \
  tests/hooks/plan-bridge-posttooluse.test.ts \
  tests/hooks/plan-bridge.test.ts \
  tests/integration/plan-bridge-fallback.test.ts \
  tests/integration/plan-bridge-flow.test.ts \
  tests/core/plan-completion-detector-v5.test.ts
```

Then run:

```bash
bun run typecheck
bun run test
```

Expected: PASS. The focused GREEN run MUST include the Step 1 historical PlanBridge regressions and all Task 10 activation/ownership/semantic-routing tests before the full suite.

- [ ] **Step 8: Commit**

```bash
git add \
  src/core/workflow-activation.ts src/core/workflow-directives.ts src/core/types.ts \
  src/core/review-dispatch-state.ts src/core/justice-plugin.ts src/runtime/opencode-adapter.ts \
  src/hooks/plan-bridge.ts src/core/plan-bridge-core.ts \
  src/core/dependency-analyzer.ts src/core/plan-completion-detector.ts \
  src/core/execution-role-classifier.ts src/core/category-classifier.ts \
  tests/core/workflow-activation-v5.test.ts tests/runtime/opencode-adapter-semantic-routing.test.ts \
  tests/core/review-dispatch-state.test.ts tests/core/review-dispatch-state-behavior.test.ts \
  tests/core/plan-bridge-core.test.ts tests/core/dependency-analyzer.test.ts \
  tests/unit/core/execution-role-classifier.test.ts tests/hooks/plan-bridge-authorization.test.ts \
  tests/hooks/plan-bridge-implement.test.ts tests/hooks/plan-bridge-posttooluse.test.ts \
  tests/hooks/plan-bridge.test.ts tests/integration/plan-bridge-fallback.test.ts \
  tests/integration/plan-bridge-flow.test.ts tests/core/superpowers-ownership-v5.test.ts \
  tests/core/plan-completion-detector-v5.test.ts
git commit -m "feat: bridge Superpowers methodology to OmO semantic routing"
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
- Test: `tests/core/justice-doctor-config.test.ts`
- Test: `tests/core/controller-routing.test.ts`
- Test: `tests/runtime/doctor-cli.test.ts`
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
- `resolveOmoEffectiveConfig(input: ResolveOmoEffectiveConfigInput): Promise<OmoEffectiveConfigResult>`.
- Doctor capability result reports OpenCode version metadata, required hook/call capabilities, native Superpowers `skill` invocation observability, review-interop support, child-session relation observability, secure review-artifact capability, and configured/applied/observed controller status separately.
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
- `doctor_reports_superpowers_skill_activation_capability_separately`

- [ ] **Step 3: Run RED tests**

Run: `bun run vitest run tests/core/omo-effective-config.test.ts tests/runtime/doctor-v5.test.ts`

Expected: FAIL on exact 1.18.29 gate and single-file assumptions.

- [ ] **Step 4: Implement effective config resolver + doctor capability model**

Implement the exact filesystem resolver above. Do not import or depend on `@oh-my-opencode/omo-config-core`: in the v5.0.1 baseline it is a private workspace package rather than a supported external runtime API. A future public effective-config API is upstream drift that requires a later compatibility decision, not an implementation-time choice in this Plan.

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
  tests/core/omo-effective-config.test.ts tests/core/justice-doctor-config.test.ts \
  tests/core/controller-routing.test.ts tests/runtime/doctor-cli.test.ts tests/runtime/doctor-v5.test.ts
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
- Test: `tests/core/error-classifier.test.ts`
- Test: `tests/core/provider-error-patterns.test.ts`
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
- `provider_failure_classification_does_not_trigger_justice_retry_or_fallback`.
- desired/configured/applied/observed controller states do not collapse.
- current category union has no canonical `deep`.

For `provider_failure_classification_does_not_trigger_justice_retry_or_fallback`, RED must prove that provider/runtime failure classification can describe terminal/diagnostic impact but cannot call or select a Justice retry, fallback model, fallback provider, or retry schedule. Minimum GREEN behavior is diagnostic classification only; OmO remains the exclusive runtime retry/fallback owner.

- [ ] **Step 2: Run RED tests**

Run:
```bash
bun run vitest run tests/core/error-classifier.test.ts tests/core/provider-error-patterns.test.ts tests/core/omo-v5-upstream-drift.test.ts
```

Expected: FAIL on stale pattern baseline/config message and on `provider_failure_classification_does_not_trigger_justice_retry_or_fallback` until the runtime-ownership boundary is explicit.

- [ ] **Step 3: Update patterns/messages/controller semantics only**

Do not implement OmO retry/fallback. `ErrorClassifier.shouldRetry()` may report/classify legacy diagnostic intent only where still required by callers; it must not initiate or schedule provider/model retry/fallback. No Justice component may choose a fallback model/provider from these classifications.

- [ ] **Step 4: Run GREEN tests + typecheck**

Run:
```bash
bun run vitest run tests/core/error-classifier.test.ts tests/core/provider-error-patterns.test.ts tests/core/omo-v5-upstream-drift.test.ts
bun run typecheck
```

Expected: PASS, including `provider_failure_classification_does_not_trigger_justice_retry_or_fallback`.

- [ ] **Step 5: Commit**

```bash
git add src/core/provider-error-patterns.ts src/core/error-classifier.ts src/core/workflow-router.ts \
  src/core/controller-routing.ts src/core/types.ts tests/core/error-classifier.test.ts \
  tests/core/provider-error-patterns.test.ts tests/core/omo-v5-upstream-drift.test.ts
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
- No other tracked documentation is in Task 14 scope. If another stale contract is discovered, stop for artifact reconciliation before editing it.
- No release-version edit.

**Interfaces:**
- Consumes every interface produced by Tasks 2–13.
- Produces end-to-end evidence from `ApprovedArtifactChain` through execution/review evidence to `PlanComplete`.
- Produces current documented stack:
  - OmO v5 OpenCode edition;
  - Superpowers v6.4.2;
  - capability-first OpenCode support;
  - effective `omo.jsonc` configuration;
  - Superpowers owns WHAT: method selection + workflow/review progression;
  - Justice owns activation bridge + SEMANTIC HOW: classification/category translation/correlation/evidence/acceptance;
  - OmO owns CONCRETE HOW: agent/runtime/model/provider/reasoning/retry/fallback.

- [ ] **Step 1: Write the missing cross-component E2E cases**

In `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` implement exactly:
- `sdd_task_reaches_acceptance_through_existing_superpowers_review`
- `scoped_re_review_resolves_blocking_finding_and_allows_acceptance`
- `executing_plans_requires_final_review_and_final_conformance`
- `implementation_discovered_design_change_requires_reconciliation_before_resume`
- `complete_evidence_allows_plan_complete`
- `translated_superpowers_work_leaves_concrete_runtime_resolution_to_omo`
- `clean_review_does_not_bypass_human_artifact_chain_authorization`
- `superpowers_remediation_and_omo_retry_ownership_remain_separate`

Scenario 50 E2E must exercise a trusted clean review on an otherwise valid candidate without current explicit human approval for the exact artifact chain and prove implementation/acceptance remains blocked until that approval exists.

Scenario 51 E2E must exercise both ownership halves in the integrated wiring: a blocking review/remediation condition must not cause Justice to schedule the fixer or re-review, and a provider/runtime failure classification must not cause Justice retry/fallback. The observed progression remains Superpowers-owned and runtime retry/fallback remains OmO-owned.

Do not duplicate focused tests whose exact evidence is already named in the traceability table unless this Task explicitly names the cross-component E2E closure above.

- [ ] **Step 2: Run the E2E file and verify RED for uncovered cross-component behavior**

Run: `bun run vitest run tests/integration/justice-v5-semantic-control-plane.integration.test.ts`

Expected: remaining cross-component behavior fails explicitly until wiring is complete, including Scenario 50 authorization separation and the two-part Scenario 51 ownership boundary.

- [ ] **Step 3: Make only the smallest integration/wiring changes required by those exact E2E cases**

If a fix changes an architecture contract rather than wiring, STOP and return to artifact reconciliation instead of ruling around the Design.

- [ ] **Step 4: Update user/upstream documentation**

Required corrections:
- Superpowers upstream: `obra/superpowers`.
- OmO upstream: `code-yeongyu/oh-my-openagent`.
- current OmO config: effective `omo.jsonc` system.
- remove Justice-owned review/task scheduling language.
- document the selected-method Superpowers activation bridge without implying Justice owns method-selection semantics.
- document recognized Superpowers `general` → Justice semantic category translation and the preservation of specialized/external routing.
- document OmO as the sole concrete model/provider/runtime resolver for translated work.
- document caller-owned OmO custom categories as an open runtime/config namespace distinct from Justice-generated `SpCategory`.
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
| JUS5-HARNESS-01, JUS5-HARNESS-02 | Tasks 1, 6, 11 |
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
| 17 | old full final review alone is stale after a fix; trusted scoped final re-review delta extends coverage only when affected/unaffected clause scope is proven | 9 | `tests/core/plan-completion-v5.test.ts` | `final_review_evidence_closure_extends_to_fix_head_only_with_scoped_delta_coverage` | unit |
| 18 | all clauses SATISFIED, no blocking quality → completion permitted | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `complete_evidence_allows_plan_complete` | E2E |
| 19 | Justice does not emit canonical `deep` | 2 | `tests/core/omo-category-mapper-v5.test.ts` | `does_not_emit_legacy_deep` | unit |
| 20 | custom `sp-*` coexist with OmO v5 routing | 2 | `tests/core/omo-category-mapper-v5.test.ts` | `custom_sp_categories_coexist_with_omo_v5_categories` | unit |
| 21 | Justice does not directly select model/provider | 2 | `tests/core/v5-task-routing-contract.test.ts` | `justice_does_not_select_concrete_model_or_provider` | unit |
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
| 34 | v6.4.2 reviewer gets Conformance Contract through the same dispatch using authoritative child-session lookup | 7 | `tests/runtime/opencode-adapter-review-interop.test.ts` | `injects_conformance_contract_into_authoritatively_bound_child_chat_message` | integration |
| 35 | missing/malformed structured review result blocks | 7 | `tests/core/review-result.test.ts` | `missing_or_malformed_review_result_is_rejected` | unit |
| 36 | parked Important/Critical blocks until trusted disposition/human quality adjudication | 8 | `tests/core/review-quality-v5.test.ts` | `parked_critical_or_important_blocks_until_trusted_disposition` | unit |
| 37 | effective config honors user/project + harness/profile precedence | 11 | `tests/core/omo-effective-config.test.ts` | `resolves_user_project_harness_profile_precedence` | unit |
| 38 | v4 plan-only authorization not auto-promoted | 3 | `tests/core/v5-persistence.test.ts` | `v4_plan_authorization_is_not_promoted_to_v5_authority` | unit |
| 39 | v4 review-dispatch state cannot resume/satisfy v5 gate | 13 | `tests/core/v5-recovery.test.ts` | `v4_review_dispatch_state_does_not_resume_or_satisfy_v5_review_gate` | integration |
| 40 | unknown/newer persistence preserved and acceptance fail-closed | 13 | `tests/core/v5-recovery.test.ts` | `unknown_newer_schema_is_preserved_and_acceptance_fails_closed` | integration |
| 41 | authorized implementation intent activates the selected Superpowers execution method | 10 | `tests/core/workflow-activation-v5.test.ts` | `authorized_implementation_activates_selected_superpowers_execution_method` | integration |
| 42 | Justice activation does not own Superpowers task/review progression | 10 | `tests/core/superpowers-ownership-v5.test.ts` | `justice_activation_does_not_own_superpowers_task_progression` | unit |
| 43 | recognized Superpowers generic worker translates to one Justice semantic category | 10 | `tests/runtime/opencode-adapter-semantic-routing.test.ts` | `recognized_superpowers_general_worker_translates_to_justice_category` | integration |
| 44 | non-Superpowers explicit subagent_type remains caller-owned | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_non_superpowers_explicit_subagent_type_without_category_injection` | unit |
| 45 | semantic classification uses task semantics/complexity without selecting concrete runtime | 10 | `tests/unit/core/execution-role-classifier.test.ts` | `classifier_uses_full_plan_semantics_without_selecting_concrete_runtime` | unit |
| 46 | OmO remains concrete model/provider/runtime resolver for translated Superpowers work | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `translated_superpowers_work_leaves_concrete_runtime_resolution_to_omo` | E2E |
| 47 | caller-owned OmO custom category outside Justice built-in vocabulary is preserved | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_user_defined_omo_category_without_translation` | unit |
| 48 | ambiguous/model-inferred review-like producer provenance remains untrusted | 7 | `tests/runtime/opencode-adapter-review-interop.test.ts` | `ambiguous_review_like_action_is_not_trusted_without_recognized_superpowers_provenance` | integration |
| 49 | artifact/scope/revision mutation stales review evidence before acceptance | 9 | `tests/core/plan-completion-v5.test.ts` | `artifact_or_revision_mutation_stales_review_evidence_before_acceptance` | unit |
| 50 | clean review evidence does not create human implementation authorization | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `clean_review_does_not_bypass_human_artifact_chain_authorization` | E2E |
| 51 | Justice does not schedule remediation/re-review or own runtime retry/fallback | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `superpowers_remediation_and_omo_retry_ownership_remain_separate` | E2E |

---

## Interface Dependency Scan for Execution Pre-Flight

The executor must record these rows in the Superpowers ledger before Task 1.

Implementation checkout precondition:

```text
git merge-base HEAD master == 080bcdb25b192962789ff5d67139e56487381de4
production source/test/CI baseline before execution == master @ 080bcdb25b192962789ff5d67139e56487381de4
pre-execution branch differences are the approved Requirements / Design / Plan documents only
v4.3.1 merge/cherry-pick prerequisite == false
```

Justice `v4.3.1` is consulted only as the historical regression corpus explicitly listed in this Plan:

| Producer | Consumer | Contract to compare |
|---|---|---|
| Task 2 | Tasks 5–12, 14 | `TaskIdentity`, `ReviewFindingV5`, `SuperpowersExecutionMethod`, `OmoCategoryName`, known built-in `TaskCategory`, `SemanticExecutionClass`, `SemanticClassificationResult`, `TaskRoutingProvenance`, `TaskRoutingTarget`, `SuperpowersRoutingTranslationResult`, pure `translateTaskRouting` |
| Task 3 | Tasks 4–14 | `ArtifactFingerprint`, `ApprovedArtifactChain`, `ApprovedPlanBinding.artifactChain`, `ApprovePlanInput` |
| Task 4 | Tasks 7–10, 13–14 | `ParsedSuperpowersTask`, `ProjectionDiagnostic`, `ProjectionResult<T>`, `ClauseEvidenceScope`, `ClauseResult`, `ConformanceContract`, `ConformanceContractPersistenceResult` + immutable contract path/digest |
| Task 5 | Tasks 6–10, 13 | `TaskIdentityResolution`, `CorrelationMutationResult`, `ExecutionCorrelation`, `ExecutionCorrelationKey` |
| Task 6 | Task 7 | durable parent-call observation plus session-event corroboration; Task 7 performs authoritative child parent lookup inside `chat.message` |
| Task 7 | Tasks 8–10, 13 | recognized review provenance/kind, `sp-review`/`sp-final-review` parent-call translation, current scoped `requestedFindingIds`, `ReviewFindingTarget`, `ReviewFindingContextProvider`, scoped `reservedFindingIds`, authoritative child binding, `JusticeReviewResult` |
| Task 8 | runtime scoped-review coordination + Tasks 9, 13 | store-backed metadata resolution for current marker IDs, lineage-wide `reservedFindingIds`, historical-ID collision detection, Superpowers open-set consistency validation, trusted persisted review evidence |
| Task 9 | Tasks 13–14 | `RevisionDiffProvider`, resolved/failed fix-wave evidence, trusted `FinalReviewEvidenceClosure`, `BlockedFinalReviewEvidenceAttempt`, deterministic finding merge, gate reasons |
| Task 10 | Task 14 | `WorkflowMethodSelection`, persisted `WorkflowMethodSelectionEvidence`, current-session `WorkflowActivationEvidence`, `WorkflowActivationDecision`, `SemanticClassificationResult`, implementation semantic-category translation, Superpowers ownership invariants |
| Task 11 | Tasks 12–14 | `OmoEffectiveConfigResult`, configured/applied/observed doctor vocabulary |
| Task 13 | Task 14 | `JusticeReviewV5View`, recovery diagnostics, completion projection |

Methodology persistence authority is exclusive: Task 10 selection/activation recovery uses `WorkflowActivationStateStore` only. `ExecutionCorrelation.executionMethod` may remain execution correlation/evidence, but neither `ExecutionCorrelation` nor its store is a methodology selection/activation recovery authority.

Historical regression evidence does not create a producer/consumer dependency on the v4.3.1 implementation. The referenced v4 commits are test/audit evidence only; Tasks 2/3/7/9/10/12/14 implement the current v5 contracts above.

Any mismatch is a Plan defect. Under the Justice v5 spec, a Ruling may record the conflict but MUST NOT silently change a normative interface; return to artifact reconciliation if the mismatch changes the Design contract.

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
   - `ApprovedArtifactChain`, `TaskIdentity`, `SuperpowersExecutionMethod`, `OmoCategoryName`, `WorkflowMethodSelection`, `WorkflowMethodSelectionEvidence`, `WorkflowActivationEvidence`, `WorkflowActivationDecision`, `SemanticExecutionClass`, `SemanticClassificationResult`, `TaskRoutingProvenance`, `SuperpowersRoutingTranslationResult`, `ExecutionCorrelation`, `ConformanceContract`, `ScopedFindingMarkerExtraction`, `ReviewFindingTarget`, `ReviewFindingContextProvider`, `JusticeReviewResult`, `RevisionDiffProvider`, `FinalReviewEvidenceClosure`, `BlockedFinalReviewEvidenceAttempt`, `PlanConformanceInput`, and severity/finding-disposition vocabulary are identical at every producer/consumer boundary.
4. **Ownership**
   - Superpowers remains the owner of execution-method selection and all task/review/fix/final progression;
   - Justice owns only selected-method activation plus semantic classification/category translation/correlation/evidence/acceptance;
   - no task adds Justice-owned task/review/fix scheduling;
   - no task adds concrete model/provider/reasoning/retry/fallback ownership;
   - recognized Superpowers generic `general` is translated without breaking category/subagent_type XOR; explicit specialized/external routing, caller-owned custom OmO categories, and `ses_...` continuation remain preserved;
   - selection recovery and activation recovery are separate: cross-session state can restore method selection but only exact same-session activation evidence can suppress a fresh skill invocation.
5. **TDD**
   - production behavior changes have RED then GREEN steps;
   - Task 1 is a regression gate for the pre-established baseline; failure is upstream compatibility drift, not architecture discovery.
6. **Persistence**
   - v4 state is recognized without becoming v5 authority;
   - unknown/newer state is preserved and blocks affected acceptance.
7. **Final review revision**
   - the trusted `FinalReviewEvidenceClosure` and Final Conformance Gate must cover the exact candidate HEAD without changing Superpowers final-review progression.
8. **Proportion**
   - bodies/algorithms are not pre-written; the plan fixes interfaces, assertions, commands, and architecture decisions only.
