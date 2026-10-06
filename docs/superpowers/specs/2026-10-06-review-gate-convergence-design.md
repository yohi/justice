# Justice Review Gate — Convergence, Validation, and Traceability Design

**Status:** Design candidate  
**Date:** 2026-10-06  
**Target:** Justice v4.x, baseline v4.3.1  
**Authority:** GitHub Issue #297 — Justice Review Gate — Convergence, Validation, and Traceability Requirements  
**Repository:** `yohi/justice`  
**Implementation Authorization:** NOT GRANTED by this document

---

## 1. Purpose

This design replaces the v4 Review Gate's combined Design + Plan retry loop with an event-sourced deterministic approval orchestrator.

The design MUST satisfy the following workflow:

```text
Requirements
    ↓
DESIGN GATE
    ↓
DESIGN_CLEAR
    ↓
approved Design fixed
    ↓
PLAN GATE
    ↓
PLAN_CLEAR
    ↓
explicit implementation authorization
    ↓
/justice-implement --approved
```

The Review Gate is a pre-implementation contract approval mechanism. It MUST NOT become a production source review, implementation executor, merge authority, or human approval substitute.

A CLEAR result means only:

```text
under the pinned Review Gate protocol and approved artifact binding,
no unresolved blocking finding remains in the applicable dependency closure
```

It MUST NOT mean human approval, merge approval, or implementation authorization.

---

## 2. Scope

### 2.1 In scope

- `/justice-review-gate`
- staged Design Gate then Plan Gate
- Requirements resolution and binding
- independent finding validation
- semantic finding lineage
- remediation and self-review
- deterministic review validation
- semantic non-convergence detection
- Justice-controlled remediation commits
- durable Review Gate history
- restart/recovery semantics
- review-safe capabilities
- approval binding and protocol fingerprinting
- history query UX
- v4 compatibility for `--retry`

### 2.2 Out of scope

- production implementation
- production source code review
- Requirements auto-remediation
- Plan Gate mutation of Design
- Git push or merge automation
- CodeRabbit integration changes
- project-tracked Review Gate history files
- TypeScript module/file layout
- exact class/interface names
- Zod schema file placement
- concrete OS lock API
- concrete test-file layout
- implementation task ordering

---

## 3. ARCH1 — Event-Sourced Deterministic Review Orchestrator

The architecture is fixed as:

```text
ARCH1
Event-Sourced Deterministic Review Orchestrator

1. Agents do not own workflow state.
2. Evidence does not mutate state by itself.
3. Justice core performs every authoritative transition.
4. Durable events are the only Review Gate state source.
5. Projection determines resume behavior after every restart.
6. Semantic lineage, not textual findings, determines convergence.
7. Git/workspace mutation is capability-scoped and core-controlled.
```

### 3.1 Responsibility split

```text
LLM agents
  = observation
  = semantic judgment
  = bounded artifact remediation

registered deterministic validators
  = deterministic rule authority

Justice core
  = identity issuance
  = state transitions
  = scope enforcement
  = lineage lifecycle
  = persistence
  = commit
  = recovery
  = convergence detection
  = approval binding
```

Agents MUST NOT issue authoritative Gate, lineage, commit, generation, round, or approval transitions.

### 3.2 Rejected alternatives

The following alternatives are rejected for v4:

1. Extending the current mutable retry-state machine with more flags.  
   This does not provide durable causal history, semantic lineage, or reliable crash recovery.

2. Introducing a database or generic workflow engine.  
   This adds migrations, database lifecycle, corruption semantics, and runtime dependencies that are unnecessary for v4.

---

## 4. Authority order and phase model

The artifact authority order is:

```text
requirements
  > design
    > plan
```

A finding's discovery location and remediation ownership are different concepts:

```text
observedPhase
  = where the defect was discovered

ownerScope
  = requirements | design | plan
  = artifact authority responsible for the defect
```

A reopen transition is orchestration state, not defect identity.

```text
lineage
  = semantic defect authority

REOPEN_REQUIRED
  = Justice-derived orchestration transition
```

---

## 5. R1 / C1 / L1 — Generation discovery and locking

### 5.1 Review scope identity

A workspace-local Review scope is:

```text
reviewScopeId =
  sha256(
    "justice-review-scope-v1\0"
    + canonicalDesignPath
    + "\0"
    + canonicalPlanPath
  )
```

Requirements are deliberately excluded from `reviewScopeId`.

### 5.2 Storage layout

```text
.justice/review-gates/
  events/<gateId>/<writerId>.jsonl
  locks/scopes/<reviewScopeId>.lock
  locks/<gateId>.lock
  recovery/objects/sha256/...
```

### 5.3 Gate discovery

Under a short-lived exclusive non-blocking scope lock:

1. Project all histories matching `reviewScopeId` and validate their `supersedesGateId` chain.
2. More than one resumable generation → `REVIEW_GATE_IDENTITY_CONFLICT`.
3. Exactly one resumable generation → acquire its Gate lock, reread all authoritative shards, reproject DA1/P1, then resume that generation.
4. If no resumable generation exists, identify the unique completed chain tip, if any. Multiple/broken completed tips → `REVIEW_GATE_IDENTITY_CONFLICT`.
5. If the unique completed tip's `CompletedApprovalBindingV1` exactly matches the current structured binding, return that COMPLETED Gate idempotently and read-only. Do not append an event and do not create a new generation.
6. Otherwise create a new random `gateId`; when a completed tip exists, set `supersedesGateId` to that exact tip. Acquire the new Gate lock and durably append `GATE_CREATED`.
7. Corrupt/unsupported matching history MUST NOT be treated as no history.

For a resumable/new generation, the scope lock MUST remain held until the Gate lock is acquired and the authoritative history has been reprojected/created. For exact completed reuse, the scope lock may be released after the immutable completed projection and binding match have been validated.

### 5.3.1 Generation creation payload

`GATE_CREATED` fixes at least:

- `reviewScopeId`,
- canonical Design path,
- canonical Plan path,
- the RR1 Requirements resolution,
- initial relevant artifact digests,
- current Design/Plan/global protocol fingerprints,
- writer identity,
- optional `supersedesGateId`.

A newly created generation is ACTIVE in Design unless IP1 immediately establishes `DESIGN_CLEAR_INHERITED`, in which case its initial effective phase is Plan.

### 5.4 Gate lock

`.justice/review-gates/locks/<gateId>.lock` is an OS process-lifetime exclusive lock bound to an open file descriptor.

- PID, writer ID, and timestamps are diagnostic only.
- TTL and heartbeat MUST NOT define ownership.
- Lock acquisition is non-blocking.
- Existing owner → `REVIEW_GATE_BUSY`.
- Workers MUST NOT inherit the lock descriptor.
- Missing required runtime lock capability → mutating Review Gate MUST fail closed.

### 5.5 Lock scope

The Gate lock is held for the entire orchestration invocation, not just individual state transitions.

The Gate lock defines state-transition ownership. It does not grant mutation permission; CAP1 capability checks are independently required.

A crash while ACTIVE does not synthesize a suspension. A later owner reacquires the Gate through R1, keeps the same epoch/budget, and may append `ORCHESTRATION_RESUMED` before continuing from the projected `ResumeCursor`.

---

## 6. G1 / E1 — Generation lifecycle, epochs, rounds

### 6.1 Generation status

```text
ACTIVE
SUSPENDED
COMPLETED
```

Invariant:

```text
COMPLETED iff PLAN_CLEAR exists
```

`DESIGN_CLEAR` is a milestone, not completion.

A history integrity/version failure is an invocation failure and MUST NOT be represented as a durable Gate status.

### 6.2 Reopen and resume

A reopen request suspends the generation. It does not itself invalidate an approval milestone.

```text
REOPEN_REQUIRED + unchanged guarded artifact
  → remain SUSPENDED

accepted committed relevant artifact change
  → observe change
  → invalidate affected progress
  → start a new orchestration epoch
  → ACTIVE
```

### 6.3 Orchestration epochs

Epochs are budget-accounting identities, not finding or round identities.

- `GATE_CREATED` starts epoch 1.
- Crash while ACTIVE → same epoch, same remaining budget.
- Explicit rerun from durable SUSPENDED → new epoch only when the suspension contract permits it.
- Killing/restarting the process MUST NOT refresh budget.

### 6.4 Remediation round identity

Design and Plan remediation rounds are generation-global and phase-local monotonic ordinals.

```text
designRemediationRound: 1, 2, 3, ...
planRemediationRound:   1, 2, 3, ...
```

They do not reset on a new epoch.

Per-epoch limits:

```text
Design: 5
Plan:   3
```

A started remediation round is consumed even if self-review later blocks commit.

---

## 7. RR1 — Requirements resolution

`--requirements <path>` is optional.

Resolution precedence is:

```text
explicit --requirements
  > Design-declared explicit Requirements reference
  > no other heuristic
```

### 7.1 Explicit path

If supplied, Justice MUST:

- canonicalize to a workspace-relative canonical path,
- reject path escape/symlink abuse,
- require a regular readable file,
- use the explicit path as resolution authority.

If the Design declares a different Requirements path, the resolver MUST NOT override the explicit path. The mismatch is a Design Gate finding.

### 7.2 Automatic resolution

If `--requirements` is absent, Justice MAY inspect only a strict explicit Requirements reference declared by the Design artifact.

Exactly one valid canonical candidate is required.

The following MUST produce the invocation/discovery outcome `REQUIREMENTS_RESOLUTION_REQUIRED` before any `gateId` generation is created:

- zero candidates,
- multiple distinct candidates,
- malformed reference,
- path escape,
- missing target,
- non-regular target.

The following heuristics are prohibited:

- directory scan,
- filename similarity,
- date/stem matching,
- most-recent file selection,
- reverse inference from Plan.

### 7.3 Persisted resolution

`GATE_CREATED` stores:

```text
RequirementsResolutionV1 {
  source:
    EXPLICIT
    | AUTO_DESIGN_REFERENCE

  canonicalPath
  digest

  designReferenceEvidence? {
    referenceKind
    logicalLocation
  }
}
```

No quoted artifact body is stored.

An existing generation never re-runs Requirements resolution. Later artifact changes use RI1 change observation.

---

## 8. PF1 — Protocol descriptors and fingerprints

Protocol identity is split by semantic effect.

```text
ReviewProtocolDescriptorV1
├─ design: DesignProtocolDescriptorV1
├─ plan: PlanProtocolDescriptorV1
└─ crossPhase: CrossPhaseProtocolDescriptorV1
```

```text
designProtocolFingerprint
  = sha256(canonicalJson(DesignProtocolDescriptorV1))

planProtocolFingerprint
  = sha256(canonicalJson(PlanProtocolDescriptorV1))

reviewProtocolFingerprint
  = sha256(canonicalJson(ReviewProtocolDescriptorV1))
```

A phase descriptor MUST include every semantic dependency capable of changing that phase's CLEAR result.

Shared semantics MUST be explicitly represented in every affected phase descriptor.

### 8.1 Design descriptor semantic inputs

At minimum:

- Design review contract version
- finding-validator contract version
- remediation contract version
- self-review contract version
- Requirements resolution policy version
- severity policy version
- Design reopen policy version
- resolution policy version
- lineage policy version
- convergence policy version
- Design round limit
- static reviewer/validator/remediator/self-review prompt digests
- deterministic validation semantic contract

### 8.2 Plan descriptor semantic inputs

At minimum:

- Plan review contract version
- finding-validator contract version
- remediation contract version
- self-review contract version
- severity policy version
- Plan reopen policy version
- resolution policy version
- lineage policy version
- convergence policy version
- Plan round limit
- static reviewer/validator/remediator/self-review prompt digests
- deterministic validation semantic contract

### 8.3 Cross-phase descriptor

Contains semantics that affect whole-Gate orchestration but do not independently alter Design or Plan review validity, including:

- phase transition policy
- completed binding policy
- Design CLEAR inheritance policy
- cross-generation lineage policy
- review-scope identity policy
- generation policy
- restart/resume policy

### 8.4 Exclusions

The following do not alter protocol fingerprints solely by changing:

- model/provider identity,
- temperature,
- writer/process identity,
- timestamp,
- package version if review semantics are unchanged,
- event storage version,
- lock implementation,
- filesystem layout,
- compression/archive mechanics,
- sandbox implementation details if semantic validator contract is unchanged.

Inconsistent shared semantic versions MUST fail with `REVIEW_PROTOCOL_DESCRIPTOR_INVALID`.

---

## 9. CB1 / IP1 — Approval bindings and generation reuse

### 9.1 Completed approval binding

```text
CompletedApprovalBindingV1 {
  reviewScopeId

  requirements {
    canonicalPath
    digest
  }

  design {
    canonicalPath
    digest
  }

  plan {
    canonicalPath
    digest
  }

  reviewProtocolFingerprint
}
```

A completed Gate is idempotently reused only when the current structured binding exactly matches the persisted binding. This reuse is read-only: no new event, writer shard, epoch, or Gate lock transition is created.

Package/model/provider/writer changes alone do not invalidate it.

Any binding mismatch creates a fresh generation with `supersedesGateId`; the old completed generation remains immutable.

`/justice-implement --approved` MUST use the same structured binding to detect stale approval.

### 9.2 Design approval binding

```text
DesignApprovalBindingV1 {
  reviewScopeId

  requirements {
    canonicalPath
    digest
  }

  design {
    canonicalPath
    digest
  }

  designProtocolFingerprint
}
```

### 9.3 Design CLEAR inheritance

A fresh generation MAY inherit predecessor Design CLEAR only when:

- predecessor is exactly `supersedesGateId`,
- predecessor generation is COMPLETED,
- predecessor has a valid Design CLEAR milestone,
- predecessor and current `DesignApprovalBindingV1` are exactly equal.

The new generation MUST append:

```text
DESIGN_CLEAR_INHERITED {
  predecessorGateId
  predecessorDesignClearEventId

  designApprovalBinding
  designApprovalBindingFingerprint

  inheritanceBasis {
    predecessorDesignApprovalBindingFingerprint
    currentDesignApprovalBindingFingerprint
  }
}
```

The projected authority is:

```text
designClear.authority =
  REVIEWED_THIS_GENERATION
  | INHERITED_FROM_PREDECESSOR
```

Inheritance follows only the immediate predecessor; older continuity follows the predecessor chain.

A Plan-only protocol/content change may create a fresh generation yet still inherit Design CLEAR when the Design binding remains exact.

---

## 10. CTX1 — Phase review context and baseline revision

State-machine ordinal and semantic identity are separate.

```text
phaseBaselineRevision
  = generation-local monotonic progress/version ordinal

PhaseReviewContextIdentity
  = semantic context identity
```

Design context identity is derived from:

- phase = Design,
- Requirements canonical path/digest,
- Design canonical path/digest,
- `designProtocolFingerprint`.

Plan context identity is derived from:

- phase = Plan,
- effective Design approval binding fingerprint,
- Plan canonical path/digest,
- `planProtocolFingerprint`.

Lineage applicability is projected as:

```text
CURRENT {
  baselineRevision
  contextIdentity
}

PENDING_REVALIDATION {
  fromBaselineRevision
  fromContextIdentity
  toBaselineRevision
  toContextIdentity
}
```

Artifact change changes baseline revision and semantic context.

Phase protocol change may change semantic context without changing artifact bytes.

Cross-phase-only protocol change does not invalidate phase lineage applicability, though an in-flight attempt bound to an old global protocol fingerprint becomes stale.

### 10.1 Protocol change observation

```text
REVIEW_PROTOCOL_CHANGE_OBSERVED {
  previousReviewProtocolFingerprint
  currentReviewProtocolFingerprint

  previousDesignProtocolFingerprint
  currentDesignProtocolFingerprint

  previousPlanProtocolFingerprint
  currentPlanProtocolFingerprint

  affectedPhases[]
}
```

This event records Justice's observation of typed descriptor differences; it is not the authority that defines protocol semantics.

Propagation:

```text
Design protocol changed
  → Design context stale
  → downstream Plan authority stale
  → effective Design CLEAR invalidated
  → Design + Plan progress invalidated
  → resume Design

Plan protocol changed only
  → Design CLEAR retained
  → Plan progress invalidated
  → resume Plan

CrossPhase only changed
  → phase lineage contexts remain current
  → completed Gate binding reuse may fail
```

---

## 11. DA1 / SV1 — Durable event log

Review Gate history uses a dedicated append-only store, separate from the existing Observation Log.

```text
.justice/review-gates/events/<gateId>/<writerId>.jsonl
```

### 11.1 Single causal chain

`GATE_CREATED` is the genesis event with `gateRevision = 1` and null predecessor ID/digest. Every later authoritative event MUST satisfy:

```text
gateRevision == previous.gateRevision + 1
previousEventId == previous.eventId
previousEventDigest == previous.eventDigest
```

```text
eventDigest =
  sha256(canonicalJson(event envelope excluding eventDigest))
```

Per-writer sequence is monotonic, but writer/time ordering is not global authority.

Fork, revision gap, broken predecessor digest, incompatible duplicate revision/event identity, or writer-sequence violation → `REVIEW_HISTORY_CONFLICT`.

Justice MUST NOT auto-sort forks or truncate an invalid tail.

### 11.2 Event append durability

A Review Gate event append is successful only after:

1. read current authoritative shard,
2. construct full previous content + one complete event line,
3. write same-directory temporary file,
4. flush file contents,
5. atomic same-filesystem rename/publish,
6. flush parent directory,
7. success return.

Append requires an expected head:

```text
{ eventId, eventDigest, gateRevision }
```

Mismatch → conflict; no append.

Temporary files are non-authoritative and may be cleaned best-effort.

Required runtime capabilities include open/write, file flush, atomic same-FS rename, directory flush, and CLOEXEC. Missing capability → mutating Review Gate fails closed.

### 11.3 Versioned envelope

```text
{
  envelopeVersion
  eventId
  gateId
  writerId
  sequence
  gateRevision
  previousEventId
  previousEventDigest
  eventType
  payloadVersion
  recordedAt
  payload
  eventDigest
}
```

Persisted events are immutable.

Storage version, review protocol version, and Justice package version are independent concepts.

Supported old events are verified using their persisted canonicalization, decoded, and upcast in memory. Persisted history is never rewritten.

Unknown authoritative semantics → `REVIEW_HISTORY_VERSION_UNSUPPORTED`, not silent skip.

---

## 12. PR1 / RET1 — Persistence policy and retention

### 12.1 Long-lived event log

Persist only typed, bounded, redacted authority/audit data.

The event log MUST NOT persist:

- full artifact contents,
- quoted artifact excerpts,
- raw reviewer/validator/remediator/self-review output,
- prompts or hidden reasoning,
- raw tool output,
- environment variables,
- credentials/tokens,
- absolute home/workspace paths.

Agent raw output lifecycle:

```text
raw
→ strict parse
→ typed result
→ persistence policy validation
→ bounded/redacted event
→ discard raw
```

Malformed output persists only typed failure information.

Authority field policy violations MUST fail with `EVENT_PERSISTENCE_POLICY_VIOLATION`; authority fields MUST NOT be silently redacted into different semantics.

All persisted artifact paths are canonical workspace-relative paths. The persistence boundary is conceptually:

```text
typed event builder
→ persistence sanitizer + strict schema validator
→ PersistableReviewGateEvent
→ DurableReviewGateEventStore
```

Only the final persistable type may reach the durable event store.

### 12.2 Retention

v4 Review Gate event history is an indefinite durable audit ledger.

- ACTIVE/SUSPENDED histories are retained.
- COMPLETED histories are retained.
- corrupt/unsupported histories are retained and cannot be deleted to bypass failure.
- automatic rotation/compaction/manual prune is out of scope for v4.

Recovery CAS objects are the only automatically garbage-collected Review Gate storage.

Diagnostics may report `gateCount`, completed/active/suspended counts, `eventCount`, `eventBytes`, recovery object count/bytes, and oldest Gate. These are diagnostic only and confer no delete authority.

---

## 13. RO1 — Durable recovery CAS

Pre-remediation artifact bytes MUST NOT be embedded in JSONL history.

```text
.justice/review-gates/recovery/objects/sha256/ab/<digest...>
```

Events store only:

- algorithm,
- digest,
- size,
- objectRef locator.

Algorithm + digest are authority; objectRef is a locator.

Before mutation:

```text
capture exact bytes
→ hash
→ durable CAS publish
→ readback + digest verify
→ REMEDIATION_STARTED
→ mutation allowed
```

CAS publication requires owner-only storage, no symlink traversal, regular-file validation, temp write, file flush, atomic publish, parent directory flush, and readback verification.

Rollback:

- reads object,
- rehashes,
- verifies recovery guards,
- atomically restores,
- verifies restored digest.

Missing/corrupt recovery object → `RECOVERY_OBJECT_UNAVAILABLE` and SUSPENDED. Justice MUST NOT reconstruct missing bytes heuristically.

A pre-image is live only while the corresponding remediation operation is incomplete.

GC is event-projection mark/sweep under a short dedicated GC lock. If relevant history cannot be projected safely, no sweep occurs. Leaks are tolerated; deleting live recovery data is not.

---

## 14. CLR1 — CLEAR milestone semantics

CLEAR events are approval milestone authority. They do not duplicate finding history.

### 14.1 DESIGN_CLEAR

```text
DESIGN_CLEAR {
  designApprovalBinding
  designApprovalBindingFingerprint

  clearanceBasis {
    freshReviewOperationId
    reviewCandidatesEventId
    findingValidationEventId
    findingReconciliationEventId

    reviewAttemptId
    designReviewRound
    orchestrationEpoch
  }
}
```

Justice MUST append `DESIGN_CLEAR` only after fresh projection under the Gate lock proves:

- generation ACTIVE,
- phase Design,
- current review attempt RECONCILED,
- no unresolved critical/major blocker in Requirements + Design closure,
- no pending lineage revalidation in the closure,
- no pending reopen/failure/remediation/self-review/commit operation,
- current Requirements/Design binding exactly matches the approval binding,
- current Design protocol fingerprint matches.

Projection after Design CLEAR:

```text
generationStatus = ACTIVE
phase = plan
```

### 14.2 DESIGN_CLEAR_INHERITED

Defined by IP1. It is a first-class Design milestone in the new generation.

### 14.3 PLAN_CLEAR

```text
PLAN_CLEAR {
  designClearEventId

  completedApprovalBinding
  approvalBindingFingerprint

  planApprovalBinding {
    reviewScopeId

    approvedDesign {
      canonicalPath
      digest
    }

    plan {
      canonicalPath
      digest
    }

    planProtocolFingerprint
  }

  planApprovalBindingFingerprint

  clearanceBasis {
    freshReviewOperationId
    reviewCandidatesEventId
    findingValidationEventId
    findingReconciliationEventId

    reviewAttemptId
    planReviewRound
    orchestrationEpoch
  }
}
```

PLAN CLEAR requires:

- valid effective Design milestone,
- current Plan review attempt RECONCILED,
- no unresolved critical/major blocker in Requirements + Design + Plan closure,
- no pending lineage revalidation in the closure,
- no reopen/failure/remediation/self-review/commit operation,
- current approved Design equals Design milestone binding,
- current Plan digest equals Plan approval binding,
- current phase/global protocol fingerprints equal approval binding.

Projection:

```text
PLAN_CLEAR
→ generationStatus = COMPLETED
```

After PLAN CLEAR, no later Review Gate event may be appended to that generation, including diagnostic events.

Completed Gate reuse is read-only.

### 14.4 Effective Design milestone

History may contain:

```text
DESIGN_CLEAR #1
→ DESIGN_CLEAR_INVALIDATED(#1)
→ DESIGN_CLEAR #2
```

At most one Design milestone may be effective at once.

---

## 15. RI1 — Reopen and invalidation state machine

### 15.1 Reopen request

`DESIGN_REOPEN_REQUIRED` and `REQUIREMENTS_REOPEN_REQUIRED` are authoritative Justice transitions derived only after triggering blocking lineages have been committed.

They produce:

```text
generationStatus = SUSPENDED
resumeTargetPhase = design
```

They MUST NOT immediately invalidate Design CLEAR.

The reopen event stores the guarded artifact path/digest and triggering lineage/event references.

Re-running with the guarded artifact unchanged does not create a new epoch or new budget.

### 15.2 Accepted external change

Any external artifact change used to alter Review Gate authority — including reopen repair or Plan-only baseline replacement — may be accepted only when the affected artifact is clean and committed and its canonical path/digest is resolvable.

Events:

```text
REQUIREMENTS_CHANGE_OBSERVED
DESIGN_CHANGE_OBSERVED
PLAN_CHANGE_OBSERVED
```

A mid-attempt input mutation instead produces `REVIEW_INPUT_CHANGED_DURING_ATTEMPT`; mixed-snapshot validation is forbidden.

### 15.3 Progress invalidation

`REVIEW_PROGRESS_INVALIDATED` makes prior phase review progress stale and records the old/new phase review contexts.

Artifact/binding change advances the affected `phaseBaselineRevision`. Protocol-only change does **not** advance the revision solely because protocol changed; instead the `phaseProtocolFingerprint` and therefore `PhaseReviewContextIdentity` change. The invalidation event therefore records both old/new baseline revisions and old/new context identities, and the revision values may be equal for a protocol-only invalidation.

Artifact-change matrix:

```text
Requirements change
  → Design revision++
  → Plan revision++
  → effective Design CLEAR invalidated
  → resume Design

Design change
  → Design revision++
  → Plan revision++
  → effective Design CLEAR invalidated
  → resume Design

Plan-only change
  → Plan revision++
  → Design CLEAR retained
  → resume Plan
```

Protocol-only propagation follows CTX1:

```text
Design protocol changed
  → Design context stale
  → downstream Plan context/progress stale
  → revisions need not change
  → effective Design CLEAR invalidated
  → resume Design

Plan protocol changed only
  → Plan context/progress stale
  → Plan revision need not change
  → Design CLEAR retained
  → resume Plan
```

Existing Git remediation commits are not reverted. Only Review Gate approval progress becomes stale.

### 15.4 DESIGN_CLEAR_INVALIDATED

This event references and invalidates the exact currently effective Design milestone.

It never deletes or rewrites the historical milestone.

### 15.5 Lineage effect

Progress invalidation is not lineage resolution.

Every affected OPEN blocking lineage becomes `PENDING_REVALIDATION` for the new phase review context.

CLEAR is forbidden until explicit lineage revalidation completes.

---

## 16. LNR1 — Finding identity and lineage

Identity is separated into:

```text
occurrenceId
  = one semantic finding observation

lineageId
  = one semantic defect identity within a Gate generation

legacy itemKey
  = existing Observation/Review evidence identity
  = not Review Gate lineage authority
```

### 16.1 Lineage ID authority

LLMs MUST NOT create arbitrary lineage IDs.

Flow:

```text
candidate/validated observation
→ Justice issues occurrenceId
→ Justice presents opaque candidate existing-lineage refs
→ finding-validator decides semantic relation
→ Justice core binds existing lineage or issues new lineageId
```

Example display IDs may be `DG-L-001` and `PG-L-001`, but IDs are opaque and MUST NOT carry semantic authority.

### 16.2 Typed semantic basis

A lineage has an immutable generation-local canonical basis containing:

- violationType
- governingReference
- semanticLocation
- violatedContract
- ownerScope

Line numbers and free-text explanation are evidence/display only.

Later baseline-specific observations store `confirmedSemanticBasis`; they do not rewrite the canonical lineage basis.

### 16.3 Reviewer finding-validator contract

Fresh reviewer and `finding-validator` MUST run as different agent roles in different contexts. The same underlying model is allowed. The validator MUST NOT receive reviewer hidden reasoning.

For REVIEWER observations, the validator receives only the candidate finding, pinned phase artifacts/baseline, necessary typed Review Gate history, and Justice-provided opaque lineage candidates.

The validator decision set is:

```text
VALID
INVALID
DUPLICATE
ALREADY_RESOLVED
ADVISORY
DESIGN_REOPEN_REQUIRED
REQUIREMENTS_REOPEN_REQUIRED
```

For a valid reviewer observation the finding-validator is authority for validity, severity, ownerScope, typed semantic basis, and current-generation semantic relation. Reviewer preference or a merely different architectural taste is not a blocking finding.

`INVALID` observations are never remediated and create no blocking lineage transition. Their occurrences/validator decisions remain auditable so repeated rejected reviewer observations can be tracked diagnostically.

`DUPLICATE + EXISTING` identifies duplicate candidate observations in the same review snapshot. All occurrences remain auditable, but they represent one blocker.

A VALID minor finding is projected as advisory:

- persist and display it,
- do not block CLEAR,
- do not auto-remediate it.

Justice may filter lineage candidates by owner/reference/location/type for efficiency, but candidate retrieval is not semantic authority; the finding-validator decides semantic identity among Justice-provided candidates.

### 16.4 Validator relation

```text
EXISTING
NEW
NONE
```

A resolved lineage observed again with the same defect present becomes `LINEAGE_REGRESSED`; a new lineage is not issued.

---

## 17. AR1 — Snapshot-pinned validity and ALREADY_RESOLVED

Reviewer and validator MUST evaluate the same `ReviewAttemptBaseline`.

Conceptually:

```text
ReviewAttemptBaseline {
  gateId
  reviewAttemptId
  phase

  phaseBaselineRevision
  phaseReviewContextIdentity

  relevantArtifactBindings {
    requirements? { canonicalPath, digest }
    design { canonicalPath, digest }
    plan? { canonicalPath, digest }
  }

  approvedDesignDigest?   # required in Plan

  phaseProtocolFingerprint
  reviewProtocolFingerprint
}
```

Design attempts bind Requirements + Design. Plan attempts bind the effective approved Design + Plan; the Requirements authority remains transitively fixed by the effective Design approval binding.

If any relevant binding/digest changes during the attempt:

```text
REVIEW_INPUT_CHANGED_DURING_ATTEMPT
→ SUSPENDED
```

`ALREADY_RESOLVED` is valid only when:

```text
lineageRelation = EXISTING
AND target lineage.status = RESOLVED
AND defect is absent on the pinned baseline
```

`NEW + ALREADY_RESOLVED` is impossible.

If a resolved lineage's semantic defect is present on the pinned baseline:

```text
VALID + EXISTING
→ LINEAGE_REGRESSED
→ lifecycle RESOLVED → OPEN
→ regressionCount++
```

Conflicting validity results for one lineage on one snapshot → `VALIDATOR_RESULT_CONFLICT`.

---

## 18. XG1 / XGR1 — Cross-generation lineage continuity

Lineage IDs are generation-local.

A fresh generation always creates a new lineage ID even when the defect is semantically identical to one in the predecessor generation.

Optional continuity:

```text
predecessorLineageRef {
  gateId
  lineageId
}
```

Same-generation recurrence uses `LINEAGE_REGRESSED`.

Cross-generation continuity uses `CROSS_GENERATION_LINEAGE_LINKED` semantics without inheriting counters/history.

Cross-generation reconciliation is a separate finding-validator context and occurs only when:

```text
current relation = NEW
AND supersedesGateId != null
AND new lineage creation is required
```

The validator may return:

```text
RELATED_PRIOR_GENERATION
NO_PRIOR_MATCH
```

It MUST NOT re-evaluate current defect validity.

Failure/malformed/stale/ambiguous cross-generation reconciliation → `CROSS_GENERATION_RECONCILIATION_FAILED`; lineage finalization is suspended.

Only the immediate completed predecessor is eligible for direct reconciliation.

---

## 19. EV1 — Evidence vs authoritative mutation

External results are evidence:

```text
REVIEW_CANDIDATES_OBSERVED
FINDING_VALIDATION_COMPLETED
CROSS_GENERATION_RECONCILIATION_COMPLETED
LINEAGE_REVALIDATION_COMPLETED
SELF_REVIEW_COMPLETED
DETERMINISTIC_VALIDATION_COMPLETED
```

Justice-core authoritative mutation events include:

```text
FINDING_RECONCILIATION_COMMITTED
LINEAGE_REVALIDATION_COMMITTED
LINEAGE_RESOLUTION_COMMITTED
DESIGN_CLEAR
PLAN_CLEAR
REVIEW_PROGRESS_INVALIDATED
```

Finding reconciliation is attempt-level batch mutation.

Before committing the batch, Justice MUST validate snapshot-wide consistency including duplicate/conflicting decisions, ownerScope/decision consistency, opaque-ref validity, and lifecycle legality.

An invalid batch produces no partial reconciliation mutation.

---

## 20. OSC1 — ownerScope disposition and CLEAR dependency closure

Only VALID critical/major CURRENT findings are automatic remediation targets. Minor/advisory findings are never automatic remediation targets and never block CLEAR.

Allowed blocking finding relationships:

| observed phase | ownerScope | blocking decision |
| --- | --- | --- |
| Design | Design | VALID |
| Design | Requirements | REQUIREMENTS_REOPEN_REQUIRED |
| Plan | Plan | VALID |
| Plan | Design | DESIGN_REOPEN_REQUIRED |
| Plan | Requirements | REQUIREMENTS_REOPEN_REQUIRED |

A blocking Design-phase finding owned by Plan is invalid.

A Plan finding owned by Design/Requirements but returned merely as `VALID` is invalid; the appropriate reopen decision is required.

Violations fail before reconciliation with `VALIDATOR_RESULT_CONFLICT`.

Minor findings are advisory and do not trigger reopen.

### 20.1 Upstream precedence

Plan disposition:

```text
requirements-owned CURRENT blocker
  → REQUIREMENTS_REOPEN_REQUIRED

else design-owned CURRENT blocker
  → DESIGN_REOPEN_REQUIRED

else plan-owned CURRENT blocker
  → remediation

else pending revalidation blocker
  → revalidation

else
  → PLAN_CLEAR candidate
```

Design disposition:

```text
requirements-owned CURRENT blocker
  → REQUIREMENTS_REOPEN_REQUIRED

else design-owned CURRENT blocker
  → remediation

else pending revalidation blocker
  → revalidation

else
  → DESIGN_CLEAR candidate
```

### 20.2 Blocker projection

Project separately:

- `currentRemediableBlockers`
- `currentUpstreamBlockers`
- `pendingRevalidationBlockers`

`unresolvedClearanceBlockers` is their union.

Design CLEAR dependency closure:

```text
requirements + design
```

Plan CLEAR dependency closure:

```text
requirements + design + plan
```

`PENDING_REVALIDATION` blocks CLEAR but is excluded from the NC1 semantic blocker landscape.

---

## 21. RV1 — Stale lineage revalidation

Lineage revalidation is not a new finding observation.

```text
reviewer candidate
  → occurrenceId

stale-lineage revalidation
  → no occurrenceId
```

Input identifies one existing lineage and target phase context.

Allowed outcomes:

```text
STILL_PRESENT
RESOLVED
INDETERMINATE
```

### 21.1 STILL_PRESENT

```text
OPEN + PENDING_REVALIDATION
→ LINEAGE_REVALIDATION_COMMITTED
→ OPEN + CURRENT(target context)
```

The following counters MUST NOT increase:

- occurrenceCount
- recurrenceCount
- regressionCount

Diagnostic `revalidationCount` may increase.

### 21.2 RESOLVED

Use:

```text
LINEAGE_RESOLUTION_COMMITTED
resolutionAuthority = EXTERNAL_CHANGE_REVALIDATION
```

No separate resolution event is introduced.

### 21.3 INDETERMINATE/failure

Lifecycle stays OPEN and applicability remains PENDING_REVALIDATION.

CLEAR remains prohibited.

Revalidation may update baseline-specific confirmed semantic basis, but MUST NOT create a new defect. Any different/new defect is the responsibility of a later fresh review.

---

## 22. RSL1 / FR1 — Resolution authority and fresh review

Reviewer absence, remediator assertion, artifact digest change, or fresh-review omission does not resolve a lineage.

### 22.1 Resolution authority

A blocking lineage may become RESOLVED only through:

```text
LINEAGE_RESOLUTION_COMMITTED
```

Normal remediation sequence:

```text
remediation
→ SELF_REVIEW_COMPLETED
→ Justice commit
→ REMEDIATION_COMMIT_SUCCEEDED | REMEDIATION_COMMIT_RECOVERED
→ LINEAGE_RESOLUTION_COMMITTED
→ fresh review required
```

Self-review `RESOLVED` is evidence only until:

- the remediation commit succeeds,
- the committed artifact digest equals the self-review pinned digest.

Commit failure leaves the lineage OPEN.

External committed artifact change may resolve a lineage only through explicit `EXTERNAL_CHANGE_REVALIDATION`.

### 22.2 Fresh review

Fresh review is:

- history-blind,
- independent,
- performed against the committed current baseline,
- responsible for new defect discovery, regression rediscovery, and missed defect rediscovery.

The reviewer receives the phase artifacts/protocol/current committed digests, but not remediation story or lineage history.

The validator/core perform validity and semantic lineage reconciliation afterward.

An OPEN lineage omitted by fresh review stays OPEN.

CLEAR is possible only after fresh review reconciliation and all CLR1 conditions.

Fresh review execution failure → SUSPENDED; prior commit and resolution evidence remain durable and remediation MUST NOT be repeated.

---

## 23. AIM1 — Review attempt identity

```text
reviewAttemptId
  = one history-blind reviewer snapshot evaluation

remediationRound
  = phase mutation-cycle identity

operationId
  = one logical external/side-effect operation

dispatchSerial
  = one physical dispatch attempt for the same operationId
```

A new `reviewAttemptId` is issued only for a new independent reviewer evaluation of an authoritative baseline, including:

- phase entry,
- post-remediation commit fresh review,
- post-baseline-change fresh review,
- post-non-convergence material-progress reentry fresh review when required.

Crash/retry/host restart/malformed-result redispatch:

```text
same reviewAttemptId
same operationId
dispatchSerial++
```

### 23.1 Attempt origin

A fresh attempt records why it exists:

```text
PHASE_ENTRY
POST_REMEDIATION_COMMIT
POST_BASELINE_CHANGE
POST_NON_CONVERGENCE_REENTRY
```

Fresh review is therefore a new attempt plus history-blind reviewer context and validated origin prerequisites; it is not a separate identity type.

### 23.2 Attempt start

```text
REVIEW_ATTEMPT_STARTED {
  reviewAttemptId
  attemptOrdinal
  phase
  origin
  phaseBaselineRevision
  phaseReviewContextIdentity
  reviewAttemptBaseline
}
```

This event MUST be durable before reviewer dispatch. Before each reviewer/validator/reconciliator external call, Justice also appends `EXTERNAL_OPERATION_DISPATCHED` with the stable `operationId`, next `dispatchSerial`, operation kind, owner reference, and pinned-input fingerprint.

Candidate-zero review still commits an empty candidate, validation, and reconciliation batch so "no findings" is distinguishable from incomplete execution.

An attempt is RECONCILED only after `FINDING_RECONCILIATION_COMMITTED`.

If its baseline revision/context/protocol no longer matches current phase state, it projects as STALE and cannot authorize CLEAR.

### 23.3 Non-1:1 relationships

```text
1 review attempt → N remediation rounds
1 remediation round → 0 or 1 successful commit
successful remediation commit → exactly 1 subsequent fresh review attempt
```

Self-review is not a review attempt.

A remediation round need not originate directly from a review attempt. Its authoritative basis is one of:

```text
REVIEW_RECONCILIATION
LINEAGE_REVALIDATION
SELF_REVIEW_CARRY_FORWARD
```

`REMEDIATION_STARTED` therefore binds `remediationRound`, `RemediationBasis`, the authority event, target lineages, phase context, and recovery pre-image; `sourceReviewAttemptId` is not universally required.

---

## 24. SRF1 — Self-review findings

Self-review uses the same `finding-validator` role in a fresh context.

Self-review is both:

1. targeted resolution validation for remediation targets, and
2. validated discovery authority for new regressions.

```text
SelfReviewResult {
  targetLineageChecks[]
  discoveredFindings[]
  deterministicChecks[]
}
```

Target checks do not create occurrences.

Discovered findings do create `occurrenceId` and enter normal lineage reconciliation with:

```text
observationSource = SELF_REVIEW
```

They MUST NOT be run through a second ordinary validity-validation call.

If the same semantic defect appears as both target `STILL_PRESENT` and discovered `EXISTING` in one self-review result:

```text
SELF_REVIEW_RESULT_CONFLICT
→ fail closed
```

### 24.1 PASS

PASS requires:

- every targeted blocking lineage = RESOLVED,
- no discovered VALID critical/major finding,
- no upstream reopen finding,
- no INDETERMINATE target,
- pinned baseline unchanged,
- all mandatory deterministic checks PASS.

Minor/advisory findings may coexist with PASS.

Every discovered self-review finding MUST complete its semantic reconciliation before commit eligibility is evaluated. Self-review PASS evidence alone never skips `FINDING_RECONCILIATION_COMMITTED` for its discovered occurrences.

### 24.2 Blocking self-review finding

Current-phase owner:

```text
no commit
→ current round consumed
→ SELF_REVIEW_CARRY_FORWARD
→ next remediation round
```

Upstream owner:

```text
no commit
→ corresponding REOPEN_REQUIRED
→ SUSPENDED
```

Self-review occurrences count toward recurrence/regression and NC1.

---

## 25. VAL1 / VSC1 — Deterministic validation

`runDeterministicValidation()` is not arbitrary command execution.

Agent input may select only a registered `validatorId`.

Justice controls:

- executable/function,
- arguments,
- declared inputs,
- environment,
- isolation,
- result schema,
- semantic rule contract.

### 25.1 Execution kinds

```text
IN_PROCESS
  = preferred pure validation

ISOLATED_PROCESS
  = exceptional
  = pinned snapshot
  = authoritative workspace write impossible
  = network disabled
  = private disposable scratch only
```

General `lint`, `test`, `build`, shell, or package commands are not review-safe merely by name.

Missing isolation capability → deterministic validation unavailable/fail closed.

### 25.2 Result semantics

```text
PASS
FAIL
INDETERMINATE
```

These are semantic outcomes.

Timeout, sandbox failure, missing binary, malformed output, and runner failure are execution failures and are not cached semantic outcomes.

### 25.3 Mandatory stages

```text
BASELINE_ADMISSION
POST_REMEDIATION_SELF_REVIEW
PRE_CLEAR
```

`BASELINE_ADMISSION` is a reviewability prerequisite. Its FAIL is not a finding lineage; it suspends before reviewer dispatch.

Post-remediation semantic FAIL and PRE_CLEAR semantic FAIL may enter DVF1 finding flow.

`PRE_CLEAR` means required PASS evidence completeness; it does not force execution when exact reusable PASS evidence exists.

### 25.4 Stage behavior

`BASELINE_ADMISSION` executes before history-blind reviewer dispatch. FAIL or INDETERMINATE cannot satisfy admission and does not create a finding; the Gate suspends.

For `POST_REMEDIATION_SELF_REVIEW`, mandatory deterministic validators run against the same pinned post-remediation baseline before the LLM self-review result is finalized. A semantic FAIL is bridged/reconciled through DVF1, but the LLM self-review still runs so the round obtains combined deterministic and semantic evidence. Any blocking deterministic finding prevents commit.

For `PRE_CLEAR`, Justice first checks evidence completeness. An exact reusable PASS may satisfy the stage. A cache miss executes the validator. A semantic FAIL enters DVF1 and then OSC1 remediation/reopen disposition; it is not merely a silent "CLEAR denied". INDETERMINATE creates no finding and cannot satisfy a mandatory stage.

### 25.5 Exact-input reuse

Validators MUST completely declare semantic inputs.

```text
ValidationInputBinding
→ validationCacheKey = sha256(canonicalJson(binding))
```

The binding includes validator contract/result schema, phase, declared content digests/bindings, and execution environment identity where applicable.

Reuse requires exact cache-key equality.

PASS/FAIL/INDETERMINATE semantic results may all be reused on exact inputs.

Execution failure is never cached as semantic evidence.

Reuse is represented by `DETERMINISTIC_VALIDATION_REUSED`, referencing the original completed validation event.

### 25.6 Execution environment binding

External deterministic validators bind their execution environment separately from protocol semantics:

```text
ValidationEnvironmentBinding {
  executionKind
  resolvedExecutableIdentity?
  resolvedToolVersion?
  runtimeContractVersion
}
```

A reviewer attempt pins the required external-validator bindings used by that attempt; a self-review operation similarly pins bindings for its logical operation. Redispatch of the same logical operation with a changed binding fails closed with `VALIDATION_ENVIRONMENT_CHANGED_DURING_ATTEMPT`.

The binding participates in exact-input cache identity where applicable. Tool/runtime drift therefore causes a cache miss even when artifact bytes are unchanged, while sandbox implementation details that do not change the binding or semantic contract do not change protocol identity.

---

## 26. DVF1 — Deterministic finding bridge

Finding observation sources are:

```text
REVIEWER
SELF_REVIEW
DETERMINISTIC_VALIDATION
```

`LINEAGE_REVALIDATION` is not an observation source because it creates no occurrence.

A registered deterministic rule failure has this authority split:

```text
rule execution
  → defect existence authority

DeterministicValidationRuleDescriptor
  → severity
  → ownerScope
  → violationType
  → governingReference
  → violatedContract

finding-validator
  → EXISTING | NEW semantic identity only

Justice core
  → occurrenceId
  → lineageId
  → lifecycle transition
```

The LLM MUST NOT override deterministic validity, severity, or ownerScope.

```text
DETERMINISTIC_VALIDATION_COMPLETED
  = validation execution evidence

DETERMINISTIC_FINDINGS_OBSERVED
  = finding subsystem bridge
```

One deterministic finding occurrence is allowed per:

```text
(validationEventId, ruleId)
```

Reusing the same validation result creates no new occurrence.

A new exact-input validation event that fails the same rule creates a new occurrence and may contribute to recurrence/regression.

BASELINE_ADMISSION FAIL never enters lineage flow.

---

## 27. NC1 / N1 — Semantic non-convergence

The current v4 `contentChanged == false` no-progress heuristic is not authority.

Detector input is only:

```text
VALID
critical | major
OPEN
applicability = CURRENT
authoritative lineage state
```

Excluded:

- minor/advisory,
- PENDING_REVALIDATION,
- raw text diff,
- model/provider,
- worker retry noise.

### 27.1 Fingerprints

The counter-free blocker landscape is the canonical hash of a sorted typed descriptor:

```text
BlockerLandscapeDescriptorV1 {
  phase

  activeBlockingLineages[] {
    lineageId
    ownerScope
    severity
    violationType
    governingReference
    violatedContract
    currentSemanticLocation
  }
}
```

Only VALID critical/major OPEN CURRENT lineages are included.

```text
blockerLandscapeFingerprint
  = semantic identity of the current blocking set
  = no recurrence/regression counters

convergenceFingerprint
  = richer convergence state
  = blocker landscape
  + recurrence/regression counters
  + repeated conflict groups
```

### 27.2 Trigger rules

Priority order:

1. `RESOLVED_LINEAGE_REGRESSED`
2. `REMEDIATION_OSCILLATION`
3. `SAME_LINEAGE_STALL`
4. `CONTRACT_CONFLICT_REPEATED`
5. `BLOCKER_LANDSCAPE_REPEATED`
6. `BLOCKER_COUNT_NOT_IMPROVING`

Multiple rules may trigger simultaneously. The first in the fixed order is `primaryReason`; all are persisted in `triggerRules[]`.

#### RESOLVED_LINEAGE_REGRESSED

On the same phase baseline revision and phase protocol fingerprint:

```text
LINEAGE_RESOLUTION_COMMITTED
→ later LINEAGE_REGRESSED
→ immediate REVIEW_NON_CONVERGENT
```

Accepted context change does not count as this same-loop regression.

#### SAME_LINEAGE_STALL

The same lineage is targeted by two consecutive remediation rounds and is `STILL_PRESENT` after both.

#### BLOCKER_COUNT_NOT_IMPROVING

Two consecutive remediation cycles with:

```text
postBlockingCount >= preBlockingCount
```

A strictly lower count resets the streak.

#### BLOCKER_LANDSCAPE_REPEATED

Exact semantic blocker landscape remains unchanged for two consecutive remediation cycles.

#### CONTRACT_CONFLICT_REPEATED

A deterministic conflict-group key is derived from:

```text
ownerScope
violationType
governingReference
violatedContract
```

Semantic location is excluded.

If the same group is targeted and remains blocking after two consecutive targeted rounds, non-convergence triggers.

#### REMEDIATION_OSCILLATION

```text
fingerprint[n] == fingerprint[n-2]
AND fingerprint[n] != fingerprint[n-1]
```

### 27.3 Detector state

No dedicated mutable convergence-state file exists.

```text
durable events
→ remediation-cycle projection
→ NC1 pure evaluation
```

Semantic streak reset boundaries:

- phase baseline revision change,
- phase protocol fingerprint change.

They are NOT reset by:

- orchestration epoch,
- host restart,
- writer change,
- model/provider,
- operation redispatch.

### 27.4 Budget priority

At a checkpoint:

```text
if semantic detector triggers
  → REVIEW_NON_CONVERGENT
else if epoch budget exhausted
  → ROUND_LIMIT_EXHAUSTED
```

### 27.5 Reentry guard

`REVIEW_NON_CONVERGENT` stores phase, relevant artifact/protocol identity, blockers, recurring set, and convergence fingerprints.

Eligible reentry changes:

Design:
- Requirements digest,
- Design digest,
- Design protocol fingerprint.

Plan:
- approved Design digest,
- Plan digest,
- Plan protocol fingerprint.

Model/provider alone is not eligible.

Eligible change invokes a new-context validator:

```text
NON_CONVERGENCE_REENTRY_VALIDATION
→ MATERIAL_PROGRESS
 | NO_MATERIAL_PROGRESS
 | REQUIREMENTS_REOPEN_REQUIRED
 | DESIGN_REOPEN_REQUIRED
```

Only MATERIAL_PROGRESS starts a new epoch/fresh budget. The changed target artifacts used for reentry MUST be clean and committed.

A reentry-validator `REQUIREMENTS_REOPEN_REQUIRED` or `DESIGN_REOPEN_REQUIRED` result is evidence only and is valid only when it points to an already committed CURRENT upstream blocking lineage satisfying OSC1. Non-convergence reentry validation is not a fifth finding-entry path and cannot create a new lineage. Without such an existing upstream lineage, a reopen result is invalid/fail-closed.

No eligible/material change → remain SUSPENDED with `REVIEW_NON_CONVERGENT_UNCHANGED` invocation outcome.

`ROUND_LIMIT_EXHAUSTED` may start a fresh epoch on explicit rerun; NON_CONVERGENT requires material progress.

`REVIEW_NON_CONVERGENT` persists at least:

```text
phase
phaseBaselineRevision
phaseReviewContextIdentity
primaryReason
triggerRules[]
blockerLandscapeFingerprint
convergenceFingerprint
phaseProtocolFingerprint
reviewProtocolFingerprint
currentBlockingLineageIds[]

evidence {
  firstRelevantRemediationRound
  latestRelevantRemediationRound
  recurringLineageIds[]
  conflictGroupKeys[]
  resolutionEventIds[]
  regressionEventIds[]
  remediationCommitShas[]
  relevantEventIds[]
}
```

Free-text explanation is display-only and bounded.

---

## 28. CAP1 — Review-safe capability model

Operation authority is split into:

```text
review_query
review_mutation
review_commit
implementation
```

### 28.1 review_query

Typed read-only APIs only, such as:

- artifact reads,
- scoped search,
- scoped diff,
- Git status/diff/log/show/rev-parse equivalents,
- registered deterministic validation.

Review query does not expose arbitrary shell execution.

Search/read/diff APIs MUST be scoped so they cannot silently expand semantic review beyond the current phase artifact set and explicitly allowed review-safe Git metadata. A query capability is not permission to perform repository-wide implementation compatibility review.

### 28.2 review_mutation

Only the remediator receives a short-lived, single-use mutation capability bound to:

```text
gateId
operationId
phase
remediationRound
targetCanonicalPath
expectedPreDigest
phaseBaselineRevision
```

Design Gate → Design only.  
Plan Gate → Plan only.  
Requirements and production/test/CI/config/release metadata are never Review Gate mutation targets.

### 28.3 review_commit

Only Justice core receives commit authority and only after self-review PASS under CP1/GIT1 prepared intent.

### 28.4 implementation

Production implementation remains gated by:

```text
/justice-implement --approved
```

Fundamental invariant:

```text
review_mutation != implementation
```

### 28.5 Error taxonomy

```text
implementation_not_authorized
  = implementation authority is required but absent

review_scope_violation
  = review operation class is valid but target is outside review scope

review_operation_not_permitted
  = actor lacks permission for the requested review operation class

review_commit_scope_violation
  = exact prepared commit scope was violated

review_commit_failed
  = scoped commit operation failed

review_commit_recovery_conflict
  = crash recovery cannot prove exact intended commit identity
```

---

## 29. CP1 — Event-sourced step journal and recovery

There is no mutable checkpoint source of truth.

```text
durable events
→ pure projection
→ ResumeCursor
→ next permitted operation
```

`operationId` is stable for one logical operation. `dispatchSerial` increments for physical redispatch.

Completed durable evidence prevents the corresponding side effect from being repeated.

### 29.1 Read-only external calls

Reviewer/validator external call with dispatch intent but no completion may be redispatched with the same operation ID if its pinned baseline remains valid.

### 29.2 Remediation crash

Before mutation, RO1 pre-image must be durable.

```text
REMEDIATION_STARTED only
→ if HEAD unchanged and only target has Justice-owned partial mutation
   restore durable pre-image
   verify restored digest
   append REMEDIATION_INTERRUPTED_RECOVERED
   rerun same round
→ otherwise REMEDIATION_RECOVERY_CONFLICT
```

`REMEDIATION_COMPLETED` with valid post-digest resumes at self-review.

### 29.3 Commit crash

Before Git side effect:

```text
REVIEW_COMMIT_PREPARED {
  operationId
  parent HEAD
  target path
  expected digest/blob
  message digest
  round
  lineage refs
}
```

Recovery:

```text
HEAD == prepared parent
  → commit not proven complete
  → same operation may execute

HEAD is exact intended commit
  → REMEDIATION_COMMIT_RECOVERED
  → do not recommit

otherwise
  → REVIEW_COMMIT_RECOVERY_CONFLICT
  → SUSPENDED
```

---

## 30. GIT1 — Exact-artifact remediation commit

Each phase admission requires only that phase's target artifact to be clean. Initial Design admission is checked before creating a new generation. Plan admission is checked before Plan review begins, including after an inherited/current Design CLEAR.

```text
target HEAD blob
== target index blob
== target working-tree content
```

Otherwise:

```text
REVIEW_TARGET_NOT_CLEAN
→ Gate/phase admission blocked
```

Before `GATE_CREATED`, this is an invocation outcome and no history event is created. If a valid generation already exists and a later phase/resume target is externally dirty/staged, Justice records an operational suspension with reason `REVIEW_TARGET_NOT_CLEAN`.

Unrelated dirty and staged paths are allowed.

### 30.1 Commit primitive contract

Justice core uses an exact single-artifact Git commit primitive equivalent to:

```text
git -c core.hooksPath=/dev/null   commit --only   --no-gpg-sign   --no-status   --cleanup=verbatim   --pathspec-from-file=-   --pathspec-file-nul   -F <Justice-owned-message-file>
```

The only pathspec is the canonical phase artifact, passed as literal NUL-terminated input.

Agents never receive Git commit authority.

### 30.2 Commit message

Base format:

```text
docs: address plan review round 2

Review-Gate: plan
Review-Round: 2
Findings: PG-L-004, PG-L-007
```

Gate ID and validator internals remain only in Justice history.

Review Gate never pushes.

### 30.3 Post-verification

Git process exit 0 is evidence only.

Authoritative success requires:

```text
newCommit.parent == prepared.parentHeadSha
changed paths == [targetCanonicalPath]
newCommit target blob == prepared.expectedBlobSha
working-tree target digest == prepared.expectedArtifactDigest
index target blob == prepared.expectedBlobSha
commit message digest == prepared.messageDigest
unrelatedIndexFingerprintBefore == unrelatedIndexFingerprintAfter
```

Only then may Justice append `REMEDIATION_COMMIT_SUCCEEDED`.

HEAD change, target external mutation/staging, extra commit paths, or index contamination fail closed.

---

## 31. HQ1 — Durable history query UX

Execution and query are separate commands.

```text
/justice-review-gate
  = orchestration / mutation / resume

/justice-review-history
  = durable projection read only
```

Supported lookup:

```text
/justice-review-history
  --design <path>
  --plan <path>
  [--view summary|rounds|findings]
  [--all-generations]

/justice-review-history
  --gate <gateId>
  [--view summary|rounds|findings]
```

History query:

- appends no event,
- acquires no Gate/Scope lock,
- creates no epoch,
- performs no resume,
- re-resolves no artifact,
- executes no validator.

Scope lookup uses `reviewScopeId` and authoritative `supersedesGateId` chain ordering, not timestamps.

Default selection:

1. unique ACTIVE/SUSPENDED chain tip,
2. otherwise unique latest COMPLETED chain tip,
3. ambiguous/broken tips → `REVIEW_GATE_IDENTITY_CONFLICT`.

Views:

```text
summary   # default
rounds
findings
```

The summary view exposes at least:

- `gateId` and `reviewScopeId`,
- generation status and current phase,
- orchestration epoch,
- effective Design CLEAR authority/binding,
- current blocker counts by ownerScope,
- pending revalidation count,
- current epoch budget usage,
- generation-total remediation rounds,
- last suspension/transition,
- last successful remediation commit,
- projected `ResumeCursor`,
- projected `gateRevision`,
- head event ID.

The rounds view emphasizes attempt → remediation → self-review → commit → fresh-review causality. The findings view is lineage-centric and exposes ownerScope, severity, lifecycle/applicability, occurrence/regression diagnostics, semantic basis, and resolution/regression history.

Raw event schema is not public UX.

History rendering pipeline:

```text
versioned persisted events
→ canonical projection
→ stable HistoryQuery DTO
→ renderer
```

A query captures the target shard set and each shard's bytes once, then projects that coherent snapshot only. It does not re-read individual shards mid-projection.

Concurrent orchestration may therefore produce a slightly stale but coherent durable prefix.

History conflict/version unsupported → fail closed; no partial best-effort display.

---

## 32. RTY1 — v4 `--retry` compatibility

v4 continues parsing:

```text
--retry N
```

using the current compatibility range, but the option is:

```text
deprecated
parser compatibility only
no-op
```

It MUST NOT:

- alter Design/Plan budgets,
- create an epoch,
- bypass NON_CONVERGENT,
- alter protocol fingerprints,
- mutate history.

Internal naming SHOULD be `legacyRetryOption?: number`, not `retryBudget`.

The authoritative limits come only from phase protocol descriptors:

```text
Design = 5
Plan   = 3
```

A deprecation warning is invocation-level only and is not persisted.

v5 removes the option.

---

## 33. EVC1 — Event catalog

The following is the normative logical catalog. Exact TypeScript names/schema locations are implementation details, but semantic event identities and authority boundaries are fixed.

| Category | Event | Authority |
| --- | --- | --- |
| Generation | `GATE_CREATED` | generation creation and initial bindings |
| Orchestration | `ORCHESTRATION_RESUMED` | same-epoch crash resume audit |
| Orchestration | `ORCHESTRATION_EPOCH_STARTED` | explicit new epoch after eligible suspension |
| Dispatch | `EXTERNAL_OPERATION_DISPATCHED` | physical dispatch intent for logical operation |
| Review | `REVIEW_ATTEMPT_STARTED` | AIM1 attempt + pinned baseline |
| Review | `REVIEW_CANDIDATES_OBSERVED` | reviewer candidate evidence |
| Validation | `FINDING_VALIDATION_COMPLETED` | reviewer candidate validator evidence |
| Cross-gen | `CROSS_GENERATION_RECONCILIATION_COMPLETED` | predecessor semantic relation evidence |
| Finding | `FINDING_RECONCILIATION_COMMITTED` | occurrence-to-lineage authoritative mutation |
| Deterministic | `DETERMINISTIC_VALIDATION_COMPLETED` | semantic validator result |
| Deterministic | `DETERMINISTIC_VALIDATION_REUSED` | exact-input evidence reuse reference |
| Deterministic | `DETERMINISTIC_FINDINGS_OBSERVED` | deterministic finding bridge |
| Revalidation | `LINEAGE_REVALIDATION_COMPLETED` | stale lineage validator evidence |
| Revalidation | `LINEAGE_REVALIDATION_COMMITTED` | STILL_PRESENT applicability authority |
| Remediation | `REMEDIATION_STARTED` | mutation intent after durable pre-image |
| Remediation | `REMEDIATION_COMPLETED` | target post-image established |
| Recovery | `REMEDIATION_INTERRUPTED_RECOVERED` | exact pre-image restoration |
| Self-review | `SELF_REVIEW_STARTED` | round/pinned targets fixed |
| Self-review | `SELF_REVIEW_COMPLETED` | resolution/regression evidence |
| Commit | `REVIEW_COMMIT_PREPARED` | exact Git side-effect intent |
| Commit | `REMEDIATION_COMMIT_SUCCEEDED` | verified normal commit |
| Commit | `REMEDIATION_COMMIT_RECOVERED` | verified crash-recovered commit |
| Lineage | `LINEAGE_RESOLUTION_COMMITTED` | only OPEN→RESOLVED authority |
| Reopen | `REQUIREMENTS_REOPEN_REQUIRED` | upstream Requirements suspension |
| Reopen | `DESIGN_REOPEN_REQUIRED` | Plan→Design suspension |
| Change | `REQUIREMENTS_CHANGE_OBSERVED` | accepted committed Requirements change |
| Change | `DESIGN_CHANGE_OBSERVED` | accepted committed Design change |
| Change | `PLAN_CHANGE_OBSERVED` | accepted committed Plan change |
| Protocol | `REVIEW_PROTOCOL_CHANGE_OBSERVED` | observation of typed protocol descriptor drift |
| Invalidation | `REVIEW_PROGRESS_INVALIDATED` | old phase progress made stale |
| Invalidation | `DESIGN_CLEAR_INVALIDATED` | exact effective Design milestone invalidated |
| Approval | `DESIGN_CLEAR` | current-generation Design approval |
| Approval | `DESIGN_CLEAR_INHERITED` | predecessor Design approval inherited |
| Approval | `PLAN_CLEAR` | complete approval + terminal completion |
| Convergence | `REVIEW_NON_CONVERGENT` | semantic non-convergence suspension |
| Budget | `ROUND_LIMIT_EXHAUSTED` | epoch budget exhaustion suspension |
| Reentry | `NON_CONVERGENCE_REENTRY_VALIDATION_COMPLETED` | material-progress/reopen evidence |
| Failure | `EXECUTION_SUSPENDED` | valid-history operational fail-closed suspension |

`EXECUTION_SUSPENDED.reason` is a typed enum and may include:

- `FRESH_REVIEW_FAILED`
- `DETERMINISTIC_VALIDATION_FAILED`
- `DETERMINISTIC_VALIDATION_PRECONDITION_FAILED`
- `VALIDATION_ENVIRONMENT_CHANGED_DURING_ATTEMPT`
- `REVIEW_INPUT_CHANGED_DURING_ATTEMPT`
- `VALIDATOR_RESULT_CONFLICT`
- `SELF_REVIEW_RESULT_CONFLICT`
- `CROSS_GENERATION_RECONCILIATION_FAILED`
- `REVIEW_COMMIT_FAILED`
- `REVIEW_COMMIT_SCOPE_VIOLATION`
- `REMEDIATION_RECOVERY_CONFLICT`
- `REVIEW_COMMIT_RECOVERY_CONFLICT`
- `RECOVERY_OBJECT_UNAVAILABLE`
- `REVIEW_TARGET_NOT_CLEAN`

The following are invocation errors and MUST NOT be appended when authoritative append/projection is unsafe:

- `REVIEW_GATE_BUSY`
- `REVIEW_GATE_IDENTITY_CONFLICT`
- `REVIEW_HISTORY_CONFLICT`
- `REVIEW_HISTORY_VERSION_UNSUPPORTED`
- `REVIEW_PROTOCOL_DESCRIPTOR_INVALID`
- `EVENT_PERSISTENCE_POLICY_VIOLATION`
- `REQUIREMENTS_RESOLUTION_REQUIRED`
- `REVIEW_TARGET_NOT_CLEAN` when failure occurs before any generation exists

---

## 34. Projection invariants

The canonical projection MUST enforce all of the following.

| Domain | Invariant |
| --- | --- |
| Event chain | DA1 predecessor/revision/digest chain is exact |
| Generation | `GATE_CREATED` is first authoritative generation event |
| Completion | `PLAN_CLEAR` is unique and terminal; nothing follows |
| Status | COMPLETED iff PLAN_CLEAR exists |
| Design milestone | at most one effective Design CLEAR milestone |
| Invalidation | only the exact current effective milestone may be invalidated |
| Phase | Plan authority requires an effective Design milestone |
| Attempt | current authority requires current baseline/context/protocol; protocol-only drift can stale an attempt without changing baseline revision |
| Attempt completion | attempt RECONCILED only after batch finding reconciliation |
| Empty review | zero candidates still require empty validation/reconciliation batch |
| Operation | external completion must correspond to durable dispatch intent |
| Dispatch | `dispatchSerial` is monotonic for one `operationId` |
| Occurrence | occurrence ID is generation-unique and reconciled at most once |
| Lineage | lineage ID is Justice-issued; canonical basis is immutable |
| Owner scope | OSC1 phase/owner/decision matrix must hold |
| Resolution | only `LINEAGE_RESOLUTION_COMMITTED` changes OPEN→RESOLVED |
| Revalidation | STILL_PRESENT creates no occurrence or recurrence counter |
| Pending revalidation | blocking pending lineage prohibits CLEAR |
| Remediation | phase-local round ordinal is generation-global monotonic |
| Mutation | only current phase artifact may be mutated |
| Self-review | blocking discovery/INDETERMINATE prohibits commit |
| Commit | no `REVIEW_COMMIT_PREPARED` without self-review PASS |
| Commit identity | actual Git result must exactly match prepared intent |
| Post-commit | verified remediation commit requires a new fresh review attempt |
| Deterministic reuse | validation reuse requires exact cache key |
| Deterministic bridge | one occurrence max per validation event + rule |
| Reopen | triggering upstream blocking lineage must already be committed |
| Non-convergence | NC1 is reconstructed from history and not reset by epoch |
| CLEAR | dependency closure has zero CURRENT/PENDING blocking lineage |
| PLAN CLEAR | full current CompletedApprovalBinding must exactly match |

---

## 35. ResumeCursor

The next legal action is derived from projection; it is not stored as mutable checkpoint state.

Representative cursor values:

```text
DESIGN_REVIEW_REQUIRED
PLAN_REVIEW_REQUIRED

VALIDATION_REQUIRED
CROSS_GENERATION_RECONCILIATION_REQUIRED
FINDING_RECONCILIATION_COMMIT_REQUIRED

LINEAGE_REVALIDATION_REQUIRED

REMEDIATION_REQUIRED
REMEDIATION_RECOVERY_REQUIRED

SELF_REVIEW_REQUIRED

COMMIT_REQUIRED
COMMIT_RECOVERY_REQUIRED
RESOLUTION_COMMIT_REQUIRED

REQUIREMENTS_REOPEN_TRANSITION_REQUIRED
DESIGN_REOPEN_TRANSITION_REQUIRED

FRESH_REVIEW_REQUIRED

PRE_CLEAR_VALIDATION_REQUIRED
CLEAR_READY

NON_CONVERGENCE_REENTRY_VALIDATION_REQUIRED

SUSPENDED
COMPLETED
```

A crash after any durable evidence/mutation event MUST project to the same next legal operation without relying on in-memory state.

Examples:

```text
FINDING_RECONCILIATION_COMMITTED
→ crash
→ upstream blocker exists
→ DESIGN_REOPEN_TRANSITION_REQUIRED
  or REQUIREMENTS_REOPEN_TRANSITION_REQUIRED
```

```text
SELF_REVIEW_COMPLETED
→ finding reconciliation committed
→ crash
→ current-phase blocker exists
→ REMEDIATION_REQUIRED
  basis = SELF_REVIEW_CARRY_FORWARD
```

---

## 36. Finding entry-point closure

The complete finding lifecycle has four entry paths:

```text
REVIEWER
  → candidate observation
  → LLM validator decides validity + semantic relation
  → normal lineage reconciliation

SELF_REVIEW
  → finding-validator produces validated observation
  → semantic relation only
  → normal lineage reconciliation

DETERMINISTIC_VALIDATION
  → registered rule produces validated observation
  → semantic relation only
  → normal lineage reconciliation

LINEAGE_REVALIDATION
  → existing lineage applicability check
  → no occurrence
  → applicability or resolution transition
```

No fifth implicit path may mutate lineage lifecycle.

---

## 37. Security and implementation-safety invariants

Before explicit implementation authorization:

- production source mutation is prohibited,
- test source mutation is prohibited,
- CI/config/release/dependency mutation is prohibited,
- arbitrary shell mutation is prohibited,
- reviewer/validator/self-review are query-only,
- remediator may mutate exactly one phase artifact,
- Git commit is Justice-core-only,
- Review Gate never pushes.

Review read scope is contract-validation scope, not repository-wide implementation review.

Design Gate semantic review inputs:

```text
Requirements
Design
review-safe Git metadata
registered deterministic validation evidence
```

Plan Gate semantic review inputs:

```text
approved Design
Plan
review-safe Git metadata
registered deterministic validation evidence
```

---

## 38. Acceptance mapping to Issue #297

| Requirement / AC | Design contract |
| --- | --- |
| Design then Plan separation | CLR1, OSC1, ResumeCursor |
| Design immutability in Plan | CAP1, OSC1 |
| Finding validation | LNR1, AR1, EV1 |
| Minor advisory | severity policy in PF1/OSC1 |
| Self-review | SRF1, RSL1 |
| Regression handling | SRF1, LNR1, NC1 |
| Justice commit boundary | CAP1, CP1, GIT1 |
| Dirty/staged isolation | GIT1 |
| Commit traceability | GIT1 + event history |
| Commit failure blocking | CP1/EVC1 |
| Semantic non-convergence | NC1/N1 |
| Fixed round limits | E1/RTY1 |
| Persistence | DA1/SV1/PR1/RET1 |
| Restart/resume | CP1 + projection/ResumeCursor |
| Design reopen | OSC1/RI1 |
| Requirements reopen | OSC1/RI1 |
| Implementation safety | CAP1 |
| Review-safe access | CAP1/VAL1 |
| Requirements resolution | RR1 |
| Durable history query | HQ1 |
| Approval/digest boundary | PF1/CB1/IP1/CTX1 |
| `--retry` compatibility | RTY1 |

---

## 39. Design consequences

This design intentionally accepts:

- linear rewrite cost for small v4 JSONL Gate histories,
- generation-local lineage IDs,
- strict fail-closed behavior for unsupported/corrupt history,
- explicit semantic revalidation after baseline/protocol context changes,
- multiple small remediation commits,
- no automatic history compaction in v4.

In return, it provides:

- deterministic restart behavior,
- traceable remediation causality,
- explicit authority boundaries,
- semantic recurrence/regression tracking,
- recoverable exact commits,
- isolation from unrelated dirty/staged work,
- clear separation between Review Gate mutation and implementation authority.

---

## 40. Implementation boundary

This Design Spec does not select:

- final TypeScript module names,
- final classes/interfaces,
- exact event schema source files,
- exact native lock binding,
- exact Git process wrapper,
- exact test file organization,
- implementation task order.

Those belong to the subsequent Implementation Plan.

No production source/test/config implementation is authorized by approval of this Design Spec.
