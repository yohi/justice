# Justice v5 Semantic Control Plane Design

**Date:** 2026-09-27
**Status:** DRAFT — awaiting human review
**Authorization:** NOT SELF-AUTHORIZING
**Target:** Justice v5.x
**Baseline:** Justice master @ 080bcdb25b192962789ff5d67139e56487381de4
**Requirements:** `docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md`
**Upstream baselines:** Oh My OpenAgent v5.0.1 (OpenCode edition), Superpowers v6.4.2

---

## 1. Purpose

Justice v5 re-establishes Justice as the semantic nervous system between Superpowers and Oh My OpenAgent (OmO).

The architectural metaphor is normative:

- **Superpowers is the brain** — it owns development methodology, workflow intent, task progression, review progression, and completion semantics.
- **OmO is the limbs** — it owns agent runtime, task execution, model/provider resolution, fallback, retry, and tool execution.
- **Justice is the nervous system and gatekeeper** — it transmits semantic intent without distorting it, observes actual execution, correlates evidence, detects drift, and allows acceptance only when quality and conformance are proven.

Justice MUST NOT replace Superpowers as workflow orchestrator and MUST NOT replace OmO as runtime/model router.

The core mission is:

> Preserve semantic consistency between Superpowers Desired State and OmO Actual Execution, and prove that consistency from evidence before acceptance.

The highest-level completion invariant is:

```text
unresolved semantic drift == 0
unauthorized semantic drift == 0
missing required evidence == 0
blocking quality findings == 0
```

Only then may Justice project:

```text
PlanComplete = true
```

---

## 2. Scope

### 2.1 In scope

Justice v5 covers:

- OmO v5 OpenCode edition compatibility.
- Superpowers v6.4.2 workflow compatibility.
- plan-scoped human authorization.
- semantic task/category correlation.
- execution and review provenance.
- task and plan acceptance.
- semantic drift detection and reconciliation gates.
- task-level and final conformance gates.
- evidence-based quality gates.
- compaction/recovery.
- capability-based doctor diagnostics.
- migration away from stale v4 orchestration responsibilities.

### 2.2 Out of scope

The initial v5 scope does not include:

- direct OmO Native / Senpi integration.
- reimplementation of Superpowers SDD.
- reimplementation of OmO model/provider/fallback behavior.
- permanent behavioral compatibility with OmO v4.
- permanent compatibility with obsolete Superpowers reviewer contracts.
- automatic replacement of human plan approval.
- GitHub PR merge/approval automation.

Future OmO Native support must be a separate harness adapter over the same Justice core contracts.

---

## 3. Architectural invariants

### INV-01 — Superpowers owns methodology

Justice MUST NOT independently decide:

- which implementation task runs next;
- when a task reviewer is dispatched;
- when a fix round is dispatched;
- how many re-review rounds are allowed;
- when the final whole-branch review runs;
- when Superpowers advances its ledger.

### INV-02 — OmO owns runtime routing

Justice may resolve:

```text
semantic role
    ↓
semantic category
```

Justice MUST NOT directly select:

- model;
- provider;
- fallback model;
- provider fallback;
- reasoning mode;
- runtime retry strategy.

### INV-03 — Justice owns acceptance

A successful tool call, agent message, passing test, or reviewer message is not sufficient by itself to produce acceptance.

Justice owns the semantic decision:

```text
Observed execution
+ Provenance
+ Required evidence
+ Quality gates
+ Conformance gates
= Acceptance decision
```

### INV-04 — Fail-open execution, fail-closed acceptance

Optional telemetry/enrichment failures should not unnecessarily crash OmO/OpenCode execution.

However, if Justice cannot obtain positive evidence required by an acceptance rule, it MUST NOT project:

- Authorized;
- Accepted;
- Verified;
- Complete.

Unknown is blocking at the acceptance boundary.

### INV-05 — No silent semantic drift

A substantive difference between approved artifacts and implementation MUST NOT be normalized away, ignored until the end, or accepted because the implementation happens to work.

Drift requires reconciliation before acceptance.

### INV-06 — Lower artifacts cannot silently redefine higher artifacts

Authority flows downward:

```text
Requirements
    ↓
Design / Spec
    ↓
Implementation Plan
    ↓
Implementation
    ↓
Tests / Verification
```

A lower-level artifact may implement or prove a higher-level contract, but it may not silently redefine that contract.

### 3.7 Normative Design Contract Registry

For Conformance Contract projection, the canonical normative Design surface is exactly:

1. the `INV-01` through `INV-06` invariants above; and
2. the `J5D-*` contracts in this registry.

Other prose in this Design explains or elaborates these contracts. It is not independently enumerated by searching for words such as `MUST`.

| ID | Normative design obligation |
|---|---|
| J5D-OWN-01 | Superpowers owns workflow/review progression; Justice must not duplicate it. |
| J5D-OWN-02 | OmO owns runtime/model/provider/fallback routing. |
| J5D-GATE-01 | Justice owns fail-closed authorization/evidence/conformance acceptance. |
| J5D-TASK-01 | Superpowers task semantics must be preserved without lossy prompt reconstruction. |
| J5D-CHAIN-01 | Human authorization binds an exact Requirements→Design→Plan artifact chain. |
| J5D-CHAIN-02 | Requirements or Design substantive changes invalidate downstream authority. |
| J5D-RULING-01 | Superpowers Rulings may guide execution but cannot rewrite approved Justice authority. |
| J5D-CORR-01 | OmO `task_id` is continuation-session state and never Justice TaskIdentity. |
| J5D-CORR-02 | Runtime execution is correlated by durable `parentSessionId + parentCallId` sidecar binding, extended with observed child session. |
| J5D-ROUTE-01 | Justice obeys the category/subagent_type XOR contract without seizing explicit caller routing. |
| J5D-PROJ-01 | Requirements/Design/Plan normative sources are deterministically enumerable. |
| J5D-PROJ-02 | Projection has COMPLETE/INCOMPLETE/INVALID state; only COMPLETE may pass acceptance. |
| J5D-PROJ-03 | Projection schema/version is bound to artifact-chain and evidence identity. |
| J5D-REVIEW-01 | Justice observes an existing Superpowers review dispatch and never creates a duplicate review. |
| J5D-REVIEW-02 | The existing review call is enriched with a read-only Conformance Contract through the supported pre-tool hook. |
| J5D-REVIEW-03 | Trusted review evidence uses a versioned structured result bound to the same call/task/revision. |
| J5D-REVIEW-04 | Missing, malformed, stale, wrong-scope, or untrusted review results fail closed. |
| J5D-QUALITY-01 | Critical/Important findings block; Minor is deferred-visible; parked/Ruling is not resolution. |
| J5D-STORAGE-01 | Directly observed structured review results are canonical; insecure file fallback never becomes trusted evidence. |
| J5D-CONFIG-01 | Doctor/config verification uses OmO effective configuration precedence, not a single config file. |
| J5D-PERSIST-01 | v4 durable authority is not auto-promoted to v5 authority; incompatible state fails acceptance closed. |
| J5D-REC-01 | Recovery reconstructs semantic correlation from durable v5 bindings and surfaces state conflicts. |
| J5D-CAT-01 | Justice emits current OmO categories and never canonical legacy `deep`. |
| J5D-DEP-01 | DependencyAnalyzer is not a scheduling authority. |
| J5D-RUNTIME-01 | OmO owns retry/fallback; Justice classifies terminal outcome only. |
| J5D-DOCTOR-01 | Doctor separates source/configured/applied/observed state and reports unsupported evidence capabilities. |
| J5D-COMPLETE-01 | PlanComplete requires zero unresolved/unauthorized semantic drift, zero missing required evidence, and zero blocking quality findings. |

A registry ID is stable within a Design source revision. Changing the obligation text changes the Design fingerprint and invalidates evidence bound to the prior revision.

---

## 4. Responsibility model

```text
Superpowers
  ├─ brainstorming / specification workflow
  ├─ writing-plans
  ├─ execution-method selection
  ├─ task selection
  ├─ implementer dispatch
  ├─ task-review dispatch
  ├─ fix / scoped re-review progression
  ├─ progress ledger
  └─ final whole-branch review
                │
                ▼
        OmO / OpenCode runtime
  ├─ child-session execution
  ├─ task tool execution
  ├─ category → runtime resolution
  ├─ model/provider resolution
  ├─ retry/fallback
  └─ tool execution
                │
                ▼ observed by
             Justice
  ├─ plan authorization
  ├─ artifact lineage
  ├─ semantic intent correlation
  ├─ observation
  ├─ evidence construction
  ├─ review provenance
  ├─ conformance evaluation
  ├─ quality gates
  ├─ task acceptance
  ├─ plan completion
  └─ diagnostics/recovery
```

Justice is observer-first, but not passive: it is authoritative at authorization and acceptance boundaries.

---

## 5. Plan and artifact authority

### 5.1 Approved artifact chain — J5D-CHAIN-01

Justice treats the authoritative unit of human implementation approval as one exact **ApprovedArtifactChain**:

```text
ApprovedArtifactChain
├─ chainId
├─ requirements
│  ├─ identity/path
│  ├─ sourceFingerprint
│  └─ sourceRevision
├─ design
│  ├─ identity/path
│  ├─ sourceFingerprint
│  └─ sourceRevision
├─ plan
│  ├─ identity/path
│  ├─ planFingerprint
│  ├─ canonicalSnapshot
│  └─ sourceRevision
├─ artifactFingerprintSchema = justice-artifact-v1
├─ planFingerprintSchema = justice-plan-v1
├─ projectionSchema = justice-conformance-v1
├─ approvedAt
└─ status
```

The fingerprints are mandatory identity.

- `justice-artifact-v1` hashes the complete UTF-8 Requirements/Design source after CRLF→LF normalization. It is deliberately an **exact approved-source identity**, not a semantic-equivalence hash.
- `justice-plan-v1` keeps the existing Plan canonicalization that normalizes approved-task checkbox progress while preserving substantive Plan content.
- `sourceRevision` is the repository revision when available; for uncommitted approval input, the corresponding content fingerprint remains the exact revision authority.

Because human approval binds an exact Requirements/Design source revision, any post-approval edit to those authoritative files makes the current chain stale. “Non-semantic drift” in §13.1 applies to implementation/output differences that do not change a normative contract and to Plan progress normalization explicitly allowed by `justice-plan-v1`; it does not silently rewrite an approved Requirements/Design source revision.

The exact storage file layout is an implementation detail. The semantic binding above is not.

Human implementation authorization binds this entire chain. A Plan fingerprint by itself is insufficient v5 authority.

### 5.2 Authorization and invalidation — J5D-CHAIN-02

Checkbox progress changes do not invalidate authorization.

Substantive Plan changes invalidate the chain, including changes to:

- task title or scope;
- Files;
- Interfaces;
- Consumes / Produces;
- signatures;
- exact values;
- assertions;
- required verification;
- Global Constraints;
- normative task body.

Substantive upstream changes propagate downward:

```text
Requirements substantive change
    ↓
bound Design stale
    ↓
bound Plan stale
    ↓
affected Justice acceptance blocked
    ↓
Design reconciliation
    ↓
Plan reconciliation
    ↓
human approval
    ↓
new ApprovedArtifactChain
```

and:

```text
Design substantive change
    ↓
bound Plan stale
    ↓
affected Justice acceptance blocked
    ↓
Plan reconciliation
    ↓
human approval
    ↓
new ApprovedArtifactChain
```

Execution may remain fail-open where Superpowers permits, but no affected acceptance may use the stale chain.

### 5.3 Superpowers Rulings — J5D-RULING-01

Superpowers v6.4.2 may record `Ruling:` entries and continue workflow execution through ambiguity or a plan defect.

Justice separates workflow continuation from semantic authority:

- a non-substantive Ruling that selects among choices already permitted by the approved chain may be recorded as execution context and does not invalidate authority;
- a Ruling that changes a normative Requirements/Design/Plan obligation may permit Superpowers execution to continue, but the current Justice chain becomes stale for the affected scope;
- the Ruling itself does not rewrite or approve Requirements, Design, or Plan;
- substantive Rulings require artifact reconciliation and the same human re-approval as any other substantive change;
- a Ruling alone never turns `VIOLATED` or `NOT_PROVEN` into `SATISFIED`.

This preserves Superpowers continuous execution without weakening Justice acceptance.

---

## 6. Preserve Superpowers task semantics

Justice v4 can reduce a task to title + checkbox descriptions when constructing worker prompts. That is no longer sufficient.

Superpowers v6 plans may place normative meaning in:

- Files;
- Interfaces;
- Consumes / Produces;
- signatures;
- exact values;
- assertions;
- verification steps;
- Global Constraints.

Justice v5 therefore adopts a preservation rule:

> The Superpowers-generated task brief is the normative worker-task content. Justice may enrich it but must not replace it with a lossy reconstruction.

Conceptually:

```text
Original Superpowers task brief
        +
Justice correlation envelope
        +
Justice conformance contract
        ↓
OmO task execution
```

Justice enrichment may include:

- authorization identity;
- plan identity;
- task identity;
- semantic category;
- evidence correlation identity;
- inherited normative constraints relevant to the task.

Justice MUST NOT delete or summarize away normative task content.

---

## 7. Task identity and execution correlation

Justice must correlate four independently evolving records:

- approved plan/task;
- Superpowers ledger entry;
- OmO/OpenCode execution;
- review/evidence artifacts.

### 7.1 Semantic TaskIdentity

Task identity MUST NOT depend only on a mutable array index.

The identity model combines stable plan scope with task semantics, conceptually:

```text
TaskIdentity
├─ artifactChainId
├─ plan identity
├─ task ordinal within approved revision
├─ normalized task heading
└─ task semantic fingerprint
```

The exact hash format is implementation detail. The required property is that Justice can distinguish:

- same task, progress-only update;
- modified task under same heading;
- task from another plan;
- review for another task;
- stale review for an older implementation revision.

### 7.2 OmO task_id ownership — J5D-CORR-01

OmO v5 OpenCode `task_id` is a continuation-session identifier (`ses_...`).

Justice semantic `TaskIdentity` is never encoded into that field.

A legitimate incoming OmO `task_id` is preserved unchanged. Justice may record it as `omoContinuationSessionId`, but it is runtime metadata rather than semantic proof.

### 7.3 Canonical sidecar binding — J5D-CORR-02

The canonical execution-call key is:

```text
ExecutionCallKey = parentSessionId + parentCallId
```

Both values are observed by the OpenCode `tool.execute.before` hook already used by the adapter.

Justice persists a sidecar binding before relying on execution evidence:

```text
ExecutionCorrelation
├─ authorizationId
├─ artifactChainId
├─ planIdentity
├─ taskIdentity
├─ executionMethod
├─ parentSessionId
├─ parentCallId
├─ childSessionId?
├─ omoContinuationSessionId?
├─ dispatchRevision
└─ status
```

The in-memory relation maps used by an adapter are caches only; durable `.justice/` state is the recovery authority.

Lifecycle:

```text
tool.execute.before(task)
  → persist PENDING correlation for (parentSessionId, parentCallId)

task post-tool metadata and/or observed session.created/session.updated
  → attach childSessionId when parent/child evidence agrees

post-tool / review / verification
  → resolve semantic evidence through that correlation

recovery
  → reconstruct from durable bindings
```

If child metadata and session-event parentage disagree, the relation is untrusted.

For a continuation, an incoming `ses_...` can reattach to semantic identity only if it matches a previously trusted child-session relation. Otherwise it remains unverified runtime metadata.

Correlation persistence failure does not have to abort OmO execution, but the affected execution cannot become trusted acceptance evidence.

### 7.4 category / subagent_type — J5D-ROUTE-01

Justice follows the OmO public XOR contract; it never intentionally emits both `category` and `subagent_type`.

- caller chose `subagent_type`: preserve it and do not replace/add category;
- caller chose `category`: preserve/validate it and do not add subagent_type;
- neither on a new worker call: Justice may add its semantic category only when the authorized workflow/classifier decision is authoritative;
- both supplied by caller: do not choose between them; record a routing-contract violation and do not trust the call for acceptance;
- continuation call: do not inject a new semantic target merely to satisfy the new-task contract.

OmO v5.0.1 currently normalizes some invalid both-target inputs defensively. Justice does not rely on that implementation detail as its contract.

---

## 8. Superpowers and Justice state ownership

### 8.1 Superpowers state

```text
.superpowers/sdd/<plan>/progress.md
```

is the workflow execution record owned by Superpowers.

It may contain:

- completed tasks;
- commits;
- review rounds;
- rulings;
- deferred findings;
- recovery state.

Justice MUST NOT rewrite this ledger as its own progress engine.

### 8.2 Justice state

```text
.justice/
```

is the semantic control/evidence store.

It owns:

- authorization;
- artifact lineage;
- observations;
- task/review correlation;
- provenance;
- gate results;
- acceptance projections.

### 8.3 Ledger is a claim, not sufficient proof

A Superpowers ledger entry such as “Task 3 complete” is a workflow claim.

Justice may use it as evidence input, but not as sufficient acceptance proof.

If the ledger says complete while required execution/review evidence is absent:

```text
Superpowers: complete
Justice: unverified
Acceptance: blocked
```

The reverse also applies: Justice does not advance Superpowers workflow solely because execution evidence exists.

---

## 9. Observation model

Observation records facts only.

Examples:

- task call observed;
- category observed;
- child session created;
- test command executed;
- exit status observed;
- implementation commit observed;
- reviewer task observed;
- review artifact observed;
- fix commit observed;
- scoped re-review observed.

Observation MUST NOT itself decide “passed”, “accepted”, or “complete”.

This separation keeps raw evidence auditable and prevents later policy changes from rewriting history.

---

## 10. Evidence model

Evidence assigns semantic meaning to observations.

Conceptually:

```text
Evidence
├─ subject
│  ├─ artifact revision
│  ├─ plan
│  ├─ task
│  └─ review
├─ supporting observations
├─ source revision/range
├─ provenance
├─ trust status
└─ semantic meaning
```

Justice should distinguish at least:

- trusted;
- observed-but-untrusted;
- missing.

A plain text file saying “Approved” is not trusted review evidence by itself.

Trusted review evidence requires correlation between:

- expected workflow context;
- observed reviewer execution;
- matching task/plan identity;
- matching implementation revision/range;
- resulting artifact/outcome.

---

## 11. Conformance contracts

Zero-drift acceptance requires a positive-evidence model, not merely absence of detected problems.

Justice therefore projects approved artifacts into a **Conformance Contract**.

A conformance contract contains the normative clauses relevant to the acceptance subject.

Clause sources can include:

- Requirements;
- Design/Spec;
- Plan Global Constraints;
- Task Files/Interfaces;
- signatures;
- exact values;
- assertions;
- MUST / MUST NOT constraints;
- required verification outcomes.

Each normative clause has a stable identity within its source artifact, conceptually:

```text
NormativeClause
├─ clauseId
├─ sourceArtifact
├─ sourceRevision
├─ sourceAnchor
├─ normativeText
├─ obligation
│  ├─ required
│  └─ advisory
└─ scope
   ├─ global
   ├─ plan
   └─ task
```

Stable clause identity is required so that a reviewer cannot satisfy a different or stale requirement by emitting a generic success statement. Exact persistence and hash representation are implementation details.

Each normative clause must end in one of:

```text
SATISFIED
VIOLATED
NOT_PROVEN
```

For required clauses:

- `SATISFIED` may contribute to gate success.
- `VIOLATED` blocks acceptance.
- `NOT_PROVEN` also blocks acceptance.

This is deliberate: reviewer omission must not be interpreted as success.

Justice may additionally classify non-normative observations, but they cannot substitute for required-clause proof.

### 11.1 Canonical normative-source projection — J5D-PROJ-01

The projection surface is deterministic.

**Requirements**

- Every `JUS5-*` block is a canonical requirement source.
- The prose obligation in the block is suffix `/0`.
- Ordered independent bullet/list obligations are suffixes `/1`, `/2`, ... within that Requirements source revision.
- Because source revision/fingerprint participates in evidence identity, inserting/reordering obligations invalidates old clause evidence rather than aliasing it.

**Design**

- Canonical Design clauses are `INV-01..INV-06` and the `J5D-*` registry IDs in §3.7.
- Free prose is explanatory unless incorporated by a registry contract.
- A simple search for `MUST` is never the enumeration authority.

**Plan**

The Superpowers v6 plan projector enumerates normative structural units from at least:

```text
Goal
Architecture
Tech Stack constraints
Global Constraints
Task Files
Task Interfaces
  Consumes
  Produces
exact signatures
exact values
test assertions
expected verification results
```

The Plan `Spec` field binds the Design artifact in the ApprovedArtifactChain instead of duplicating the Design as another clause.

Each structural paragraph/list item is one canonical Plan clause. If one structural unit contains several obligations, the whole unit is SATISFIED only when all of them are proven; Justice does not silently split ambiguous prose by LLM guesswork.

### 11.2 Projection completeness — J5D-PROJ-02

Every generated Conformance Contract carries:

```text
projectionStatus =
  COMPLETE
  | INCOMPLETE
  | INVALID
```

Only `COMPLETE` is acceptance-eligible.

Projection becomes fail-closed when any of the following occurs:

- duplicate canonical clause IDs;
- required source artifact missing;
- ambiguous or missing source anchor;
- unsupported/ambiguous Plan structure;
- parser/projector failure;
- ApprovedArtifactChain fingerprint/revision mismatch;
- any normative structural unit cannot map to exactly one canonical clause.

`INCOMPLETE` and `INVALID` contracts may be inspected but cannot produce TaskAccepted or PlanComplete.

### 11.3 Projection versioning — J5D-PROJ-03

The projection schema/version is part of:

- ApprovedArtifactChain;
- Conformance Contract;
- clause evidence.

Evidence from an incompatible projection schema is stale and cannot satisfy current clauses.

---

## 12. Early drift prevention

Drift is checked at the earliest evidence boundary supported by the selected Superpowers execution method, not only at final completion.

### 12.1 Subagent-driven-development

For SDD, the existing Superpowers task-review lifecycle provides semantic evidence at every task boundary:

```text
Approved task contract
        ↓
implementation
        ↓
tests / verification
        ↓
Superpowers task review
        ↓
Justice Task Conformance Gate
```

The Task Conformance Gate checks at least:

- task brief ↔ implementation;
- interface contract ↔ implementation;
- exact values/invariants ↔ implementation;
- assertions ↔ tests;
- inherited Global Constraints ↔ diff;
- reviewed revision ↔ current candidate revision.

A substantive mismatch blocks task acceptance immediately.

### 12.2 Executing-plans

`executing-plans` does not require a fresh semantic reviewer for every task. Justice therefore MUST NOT invent one.

For inline execution:

- deterministic task-level conformance checks run whenever evidence is available;
- task acceptance remains fail-closed for machine-checkable required clauses;
- semantic clauses that cannot yet be proven remain `NOT_PROVEN`, not silently satisfied;
- the mandatory final whole-branch review receives the accumulated Conformance Contract and must provide semantic proof for any required clauses still unproven.

Thus inline execution may defer semantic proof to the current Superpowers final-review boundary, but it may never bypass the Final Conformance Gate.

This prevents late drift where possible without duplicating Superpowers orchestration.

---

## 13. Drift classification and mandatory reconciliation

Justice distinguishes:

### 13.1 Non-semantic drift

Examples in implementation/output:

- formatting;
- import ordering;
- comments;
- wording or internal implementation detail outside any normative contract.

For the Plan artifact, checkbox progress is additionally normalized by `justice-plan-v1`.

These differences do not create semantic conformance drift. They do **not** permit an approved Requirements/Design source file to be edited in place without producing a new exact source fingerprint and a stale artifact chain.

### 13.2 Semantic but reconcilable drift

Examples:

- implementation signature differs from Plan;
- interface differs from Design;
- required validation is missing;
- implementation discovers that the approved approach is no longer correct.

Required behavior:

```text
DRIFT DETECTED
    ↓
affected acceptance blocked
    ↓
authoritative artifact corrected
    ↓
downstream artifact reconciled
    ↓
human re-approval where authority changed
    ↓
new fingerprint/authorization
    ↓
resume
```

The implementation MUST NOT become the de facto source of truth merely because it exists.

### 13.3 Prohibited drift

Examples:

- violation of explicit MUST NOT;
- removal of required tests to manufacture success;
- violation of security/safety invariant;
- scope expansion that replaces the approved design;
- suppression or falsification of gate evidence.

These produce a blocking finding and are not automatically resolved by doc synchronization.

---

## 14. Review ownership and evidence

### 14.1 Superpowers owns review orchestration — J5D-REVIEW-01

For subagent-driven-development, Superpowers owns:

```text
implementation
→ task review
→ fix
→ scoped re-review
→ final whole-branch review
```

Justice does not dispatch an additional reviewer.

A **versioned Superpowers ReviewDispatchProfile** recognizes an already-dispatched review. For the v6.4.2 profile, classification combines multiple signals rather than a single keyword:

- active execution method and workflow phase;
- task-tool `parentSessionId + parentCallId`;
- the current Superpowers review-template structure;
- concrete task/review-package inputs such as brief/report and reviewed base/head/diff references;
- active artifact-chain/task identity.

Task review, scoped re-review, and final review have distinct profiles.

If the signals are ambiguous, the execution may continue but the review is untrusted for Justice acceptance.

### 14.2 Conformance Contract delivery — J5D-REVIEW-02

When a supported review requires semantic conformance evidence, Justice enriches **that same existing review call** through the OpenCode `tool.execute.before` mutable task arguments already used by the OpenCode adapter.

Justice appends a read-only Justice review appendix containing:

- review-correlation ID;
- artifact-chain ID;
- task identity where applicable;
- reviewed base/head or candidate revision;
- a workspace-relative reference to the immutable Conformance Contract;
- the required structured-result schema.

It does not alter model/provider/subagent/category choice and does not create a second dispatch.

A host/version where the review call cannot be safely recognized and enriched is reported by doctor as review-interop unsupported; semantic review evidence remains `NOT_PROVEN` rather than falling back to a Justice-owned review.

#### Verified v5 baseline compatibility evidence

The review-interop extension point is an **established baseline contract before implementation planning**, not an architecture-discovery task.

Evidence chain:

1. Justice's existing `spikes/child-session-correlation/README.md` recorded a real OpenCode **1.18.29** runtime probe showing:
   - `tool.execute.before` exposes the parent `sessionID` and `callID`;
   - task args are mutable through the before-hook output;
   - `tool.execute.after` returns on the same call and exposes child-session metadata;
   - parent/child session correlation is observable through hook metadata and session events.
2. The OpenCode runtime/plugin files that implement this path are byte-identical between **v1.18.29** and **v1.18.31**:
   - `packages/opencode/src/session/tools.ts` — blob `99f7aec4fdfdfc857702b50b0ca3ce7c8651af4c`;
   - `packages/opencode/src/session/prompt.ts` — blob `0f85d44f209ba792065aeb951f0bd2e12b59fae8`;
   - `packages/opencode/src/tool/task.ts` — blob `d8ca640cfba9a52d97e5180fda0ffa719910592b`;
   - `packages/plugin/src/index.ts` — blob `edfa0139dfcaf0e877ab906fabe8e0527afc3915`.
   The v1.18.31 release tag resolves to commit `014614d35b397775e5d397a490fc72368c894ec2`.
3. Source-contract verification on v1.18.31 confirms the before-hook receives the mutable `args` object, the native task path consumes the resulting `params.prompt` through `ops.resolvePromptParts(params.prompt)`, and the after-hook is emitted for the same parent `sessionID + callID` with TaskTool child-session metadata.
4. Superpowers v6.4.2 defines task review, scoped re-review, and final whole-branch review as `Subagent (general-purpose)` dispatches, and its OpenCode V1 mapping resolves every one of those reviewer dispatches to the same native `task` tool with `subagent_type: "general"`. The review kind changes prompt content and review-package inputs; it does not select a reviewer-specific host execution path.
5. This is a compositional compatibility proof: the hook/task path was empirically observed on 1.18.29, that exact path is source-identical on 1.18.31, and all three Superpowers v6.4.2 reviewer kinds map to that one path. The implementation plan therefore treats three-kind runtime replay as **regression evidence**, not as the first architecture-feasibility decision.

Therefore the supported v5 baseline is fixed as:

```text
Superpowers v6.4.2 review dispatch
→ OpenCode 1.18.31 task(subagent_type="general")
→ tool.execute.before(sessionID, callID, mutable args)
→ same mutated args consumed by TaskTool
→ same-call tool.execute.after/result + child-session metadata
```

Implementation tests MUST preserve this as a regression contract. A future failure is treated as **upstream compatibility drift** and blocks the supported-stack claim; it does not invite a Justice-owned reviewer fallback or a new architecture decision inside the Implementation Plan.

### 14.3 Structured result — J5D-REVIEW-03

The same reviewer final result must contain a machine-readable Justice envelope in addition to the normal Superpowers human-readable report.

Canonical shape:

```text
JusticeReviewResult
├─ schemaVersion
├─ reviewCorrelationId
├─ reviewKind
├─ artifactChainId
├─ taskIdentity?
├─ reviewedRange
│  ├─ base
│  └─ head
├─ quality
│  ├─ verdict: approved | needs_fixes
│  └─ findings[]
│     ├─ findingId
│     ├─ severity: critical | important | minor
│     ├─ disposition
│     └─ evidenceRefs[]
└─ clauses[]
   ├─ clauseId
   ├─ status: SATISFIED | VIOLATED | NOT_PROVEN
   └─ evidenceRefs[]
```

The exact serialization syntax is an implementation detail, but it must be unambiguously delimited and strictly parsed.

Initial task review and final review are **full** results for the Conformance Contract supplied to that review.

A scoped re-review may be a delta for prior findings/affected clauses. Justice may carry forward earlier SATISFIED clause evidence only when the fix diff is proven not to intersect that clause's recorded evidence scope. If non-intersection cannot be proven, the clause returns to `NOT_PROVEN` until a trusted later full review.

### 14.4 Invalid/stale result — J5D-REVIEW-04

A structured review result is rejected when:

- missing or malformed;
- correlation ID does not match the observed call;
- artifact-chain/task identity is wrong;
- reviewed base/head does not cover the candidate revision;
- result provenance is not the observed reviewer call;
- required clause IDs are absent.

Missing required clause results are projected as `NOT_PROVEN`.

### 14.5 Quality severity and parked findings — J5D-QUALITY-01

Justice v5 canonical severity follows current Superpowers terminology:

```text
critical | important | minor
```

Legacy Justice `major` is migration-only and normalizes to `important`.

Gate semantics are fixed:

- open Critical or Important → Justice blocking;
- Minor → non-blocking for task progression, but durable and mandatory input to final review;
- `Ruling:` or `parked` → workflow disposition only, not Justice resolution;
- parked Critical/Important remains blocking until a later trusted review explicitly clears/resolves it or an explicit human review-resolution artifact adjudicates the quality finding;
- if the finding corresponds to a normative clause, quality adjudication cannot turn `VIOLATED`/`NOT_PROVEN` into `SATISFIED`; the artifact chain/code must be reconciled and re-proven;
- final review must explicitly disposition all carried Minor/parked findings; any finding still Critical/Important blocks `PlanComplete`.

This allows Superpowers to continue after its round cap while Justice remains fail-closed.

---

## 15. Conformance evidence generation without Justice-owned orchestration

Semantic conformance cannot be guaranteed by string comparison alone. Justice separates deterministic and semantic evidence.

Deterministic evidence includes:

- artifact fingerprints;
- projection completeness/version;
- execution-call and child-session correlation;
- revision/range identity;
- exact signatures/values where machine-checkable;
- test execution and exit result;
- file presence/absence.

Semantic evidence is produced only inside the existing Superpowers-owned review lifecycle using §14's interop contract.

### 15.1 Canonical evidence transport

The Conformance Contract is durable Justice sidecar state. The reviewer receives only a read-only reference plus correlation metadata.

The structured reviewer result is captured from the **same observed reviewer call** and persisted into Justice evidence state. This call-bound output is the canonical semantic-review transport; a reviewer-authored file is not required for trust.

### 15.2 Evidence storage — J5D-STORAGE-01

Current Justice has a Linux x64/glibc `openat2`/`renameat2` reserved-review-artifact mechanism. v5 treats it as an optional secure capability for file-based artifact handoff/import, not as a prerequisite for directly observed call-bound structured output.

Rules:

- directly observed, strictly parsed, correctly correlated structured output may be trusted and persisted atomically on supported Justice state storage;
- an ordinary file may be retained as untrusted/historical input but is never promoted to trusted evidence merely because native reservation is unavailable;
- if a required evidence path depends on secure file reservation and that capability is unavailable, there is no insecure authoritative fallback — the evidence is `NOT_PROVEN`;
- doctor reports secure-artifact and review-interop capabilities separately.

---

## 16. Execution-method-aware acceptance

### 16.1 Subagent-driven-development

Task acceptance requires:

- current plan authorization;
- matching implementation execution;
- required verification evidence;
- required task-review lifecycle;
- no unresolved blocking findings;
- all required task conformance clauses SATISFIED.

### 16.2 Executing-plans

Justice MUST NOT require a fresh per-task reviewer when current Superpowers methodology does not require one.

Acceptance policy is based on that execution method’s actual contract, including:

- TDD/verification evidence;
- progress;
- applicable review evidence;
- final whole-branch review;
- conformance gates.

Gate policy is therefore execution-method aware.

---

## 17. Final Conformance Gate

Superpowers final review is necessary but not sufficient for `PlanComplete`.

After final review, Justice applies an independent Final Conformance Gate.

It verifies:

```text
Requirements ↔ Design
Design       ↔ Plan
Plan         ↔ Code
Design       ↔ Code
Plan         ↔ Tests
Requirements ↔ Verification
reviewed revision ↔ completion candidate revision
```

The final gate covers cross-task properties that task-local review may miss:

- Design invariants remain true globally;
- producer/consumer interfaces agree;
- no Plan task silently disappeared;
- no undocumented normative behavior was introduced;
- test assertions still prove required contracts;
- deferred findings remain visible;
- final review actually covers the candidate tree;
- no post-review code change invalidated the evidence.

Completion requires:

```text
all required tasks accepted
AND final review requirement satisfied
AND all required conformance clauses SATISFIED
AND unresolved semantic drift == 0
AND unauthorized semantic drift == 0
AND missing required evidence == 0
AND blocking quality findings == 0
```

---

## 18. Quality and conformance are independent

Justice MUST NOT collapse quality and conformance into one score.

Examples:

- Code may conform exactly to Design and still contain a serious bug.
- Code may be high quality and still violate an approved interface.
- Review may be positive while evidence is incomplete.
- Tests may pass while testing the wrong contract.

Therefore:

```text
Quality != Conformance
Correctness != Authorization
Review != Evidence completeness
```

Acceptance requires all applicable gates.

---

## 19. Gate model

Justice v5 separates gates by purpose.

### Authorization Gate

Proves that the active artifact revision was human-approved and remains unchanged in substantive meaning.

### Execution Gate

Proves that the intended task was actually executed and that evidence was not borrowed from another task/plan.

### Verification Gate

Proves required tests/checks ran against the relevant revision.

### Review Gate

Proves the execution method’s required review lifecycle completed and blocking findings are resolved or explicitly adjudicated.

### Conformance Gate

Proves required normative clauses across Requirements/Design/Plan/Code/Tests are satisfied.

### Quality Gate

Proves no blocking quality findings remain.

### Completion Gate

Projects TaskAccepted or PlanComplete only when all applicable gates succeed.

---

## 20. Controller routing

Justice v5 keeps controller verification distinct from worker routing.

The previous v4 mapping:

```text
brainstorming → sisyphus
writing-plans → sisyphus
subagent-driven-development → atlas
executing-plans → sisyphus
```

is not treated as an eternal architectural invariant.

Instead:

- Justice has a compatibility profile for expected controller behavior where supported by upstream evidence.
- Desired/configured/applied/observed controller states remain distinct.
- A controller mapping is considered verified only when supported by current OpenCode-edition evidence or live compatibility tests.
- If actual attribution cannot be observed authoritatively, Justice reports Unverified rather than inventing Applied.

This preserves the v4 Configuration Assurance goal without binding v5 to an unverified stale mapping.

---

## 21. Worker category routing

Justice continues to use semantic worker categories without selecting models/providers directly.

The current OmO v5 OpenCode built-in category contract includes:

- visual-engineering;
- ultrabrain;
- deep-low;
- deep-high;
- artistry;
- quick;
- unspecified-low;
- unspecified-high;
- writing.

Justice MUST NOT emit legacy `deep` as a new canonical result.

Legacy input may be normalized as:

```text
deep → deep-low
```

Justice custom categories remain valid:

- sp-mechanical;
- sp-implementation;
- sp-integration;
- sp-deep;
- sp-architecture;
- sp-review;
- sp-final-review.

The mapping from these categories to actual model/provider/fallback behavior remains an OmO `omo.jsonc` responsibility.

---

## 22. Dependency analysis

Justice v4 custom syntax such as:

```text
(depends: task-1)
```

is no longer a scheduling authority.

Superpowers owns execution order.

If DependencyAnalyzer remains, it may serve only:

- consistency checking;
- advisory diagnostics;
- evidence correlation.

It MUST NOT independently dispatch tasks or override Superpowers progression.

---

## 23. Provider/runtime failure boundary

OmO owns:

- provider retry;
- fallback;
- credential selection;
- model resolution.

Justice observes terminal execution outcome.

Provider failure classification exists only to explain terminal failure and acceptance impact, not to compete with OmO retry logic.

If Justice retains error patterns, they must be synchronized to the OmO v5 model-core baseline rather than the stale 3.17.4 source.

---

## 24. Configuration contract — J5D-CONFIG-01

Justice treats **OmO v5 effective configuration resolution** as configured-state authority, not an arbitrary single file.

### 24.1 File-layer precedence

When Justice cannot consume a compatible OmO effective-config API and must inspect the filesystem, it follows the OmO v5 loader order:

```text
lowest
  ~/.omo/omo.jsonc
    else ~/.omo/omo.json

  farthest ancestor/.omo/omo.jsonc
    else .json
  ...
  nearest project/.omo/omo.jsonc
    else .json
highest
```

The home directory is the user layer and is not re-read as a project layer.

Invalid/unreadable layers and loader diagnostics must be represented consistently with OmO's effective loader semantics rather than silently treated as valid configuration.

### 24.2 Effective-view resolution

After file-layer merge, the OpenCode configured view resolves:

```text
shared base
→ [opencode]
→ selected profile base
→ selected profile [opencode]
```

Profile selection follows the OmO v5 profile resolver (explicit profile where provided, then supported environment/profile sources such as `OMO_PROFILE`, legacy `OCX_PROFILE`, and OpenCode profile directory inference).

### 24.3 Doctor representation

Doctor distinguishes:

```text
source layers + diagnostics
        ↓
effective configured value
        ↓
runtime applied value (if authoritatively available)
        ↓
observed execution value
```

It never infers applied/observed state merely from a source file.

Legacy `oh-my-opencode.jsonc` / `oh-my-openagent.jsonc` files are migration inputs only and never current configured-state authority.

---

## 25. Doctor and compatibility model

`justice doctor` answers:

> Can Justice operate correctly and prove the required contracts in this environment?

It does not answer:

> Is the current plan conformant?

Doctor checks include:

- OpenCode required capabilities;
- Justice plugin/hook registration;
- OmO/OpenCode integration;
- configuration source;
- category availability;
- command availability;
- Superpowers availability where observable;
- legacy configuration;
- observation limitations.

Compatibility is capability-first:

```text
version metadata
    +
required capability probes
    +
known compatibility constraints
```

Exact OpenCode patch equality alone is neither necessary nor sufficient.

A newer patch with intact required capabilities may remain supported.

A nominally expected version missing a required capability is unsupported.

---

## 26. Recovery, persistence versioning, and v4 migration

### 26.1 v5 authoritative state — J5D-PERSIST-01

Every authoritative v5 persisted record is governed by an explicit v5-compatible schema version. The exact split into files is implementation detail; authority semantics are not.

v5 recovery reconstructs at least:

- ApprovedArtifactChain;
- plan authorization;
- ExecutionCorrelation bindings;
- projection schema/status;
- review/evidence correlation;
- acceptance state.

### 26.2 v4 authority policy

Migration is conservative and non-destructive.

The v5 migration reader recognizes these current v4 contract families only as prior-state inputs:

```text
authorization:
  fingerprintSchema = justice-plan-v1

observation/decision log:
  PersistedEnvelope.schemaVersion = 1
  including review_dispatch_transition,
            task_lifecycle_transition,
            plan_finalization_transition

review snapshot:
  ReviewSnapshotArtifact.schemaVersion = 1

human review resolution:
  authority = human_approved
  (legacy artifact has no v5 artifact-chain/clause binding)
```

A recognized v4 record is still subject to the authority rules below. Recognition never means automatic v5 trust.

**v4 plan authorization**

A v4 binding such as `justice-plan-v1` proves only the old plan-level contract. It is not automatically promoted to a v5 artifact-chain authorization. It remains historical until the current Requirements, Design, and Plan are reconciled and explicitly re-approved.

**v4 review dispatch/scheduling state**

Old Justice-owned review scheduling/dispatch records are historical only. v5 never resumes review orchestration from them and they cannot satisfy v5 review gates.

**v4 observations/evidence**

Raw observations may be retained/imported as historical or untrusted inputs. Evidence without v5 artifact-chain ID, execution correlation, projection schema, and canonical clause IDs cannot satisfy v5 acceptance.

### 26.3 Unknown/newer/incompatible state

For an unknown, newer, malformed, or failed migration:

- preserve the original state rather than rewriting/downgrading it;
- emit a doctor/recovery diagnostic;
- do not fabricate Requirements/Design lineage;
- mark the affected authoritative domain unavailable;
- keep runtime execution fail-open where safe;
- keep affected Justice acceptance fail-closed.

Migration never creates trusted v5 evidence solely from absence of a detected conflict.

### 26.4 Recovery conflict — J5D-REC-01

Justice also reads enough Superpowers workflow state to prevent stale re-correlation and duplicate acceptance.

When Superpowers ledger and Justice semantic state disagree, neither silently overwrites the other. Justice reports both claims and blocks any acceptance that depends on the unresolved conflict.

Ephemeral adapter relation maps are never recovery authority; durable v5 ExecutionCorrelation is.

---

## 27. justice_review

`justice_review` becomes a control-plane inspection interface, not a hidden review scheduler.

Its primary output is current evidence/gate state, for example:

```text
Plan: AUTHORIZED
Tasks: 7/8 ACCEPTED

Task 8:
  implementation: observed
  verification: satisfied
  review: satisfied
  conformance: BLOCKED

Drift:
  PLAN-CODE-003
  expected: credentialProviderID(...) resolves credential owner
  observed: provider id returned

Plan Completion:
  BLOCKED
```

The tool should explain:

- what is blocked;
- why;
- which artifact/revision is authoritative;
- which evidence is missing;
- whether reconciliation requires human re-approval.

---

## 28. v4 → v5 subsystem treatment

### Keep and strengthen

- plan authorization;
- canonical fingerprinting;
- Observation Log;
- evidence model;
- Gate Engine;
- provenance;
- fail-open execution;
- fail-closed acceptance;
- compaction/recovery.

### Redesign

- PlanParser semantic extraction;
- TaskPackager;
- ExecutionRoleClassifier;
- CompletionDetector;
- controller verification;
- review correlation;
- doctor compatibility;
- artifact lineage;
- conformance contract projection.

### Remove from scheduling authority

- DependencyAnalyzer-driven progression;
- Justice-owned task-review dispatch;
- Justice-owned final-review dispatch;
- Justice-owned fix/re-review loop;
- Justice-owned SDD progression.

### Delegate completely

- model selection;
- provider selection;
- model/provider fallback;
- runtime retry;
- task scheduling;
- review scheduling.

---

## 29. Required verification scenarios

The v5 implementation plan must include E2E coverage for at least the following behaviors.

### Authorization

1. checkbox-only plan updates preserve authorization.
2. interface/signature/assertion/global-constraint changes invalidate authorization.
3. substantive Design change invalidates downstream Plan authority.
4. new human approval establishes a new authorization lineage.

### SDD

5. implementation → Superpowers task review → Justice evidence → acceptance.
6. Justice does not duplicate-dispatch the reviewer.
7. Needs fixes → fix → scoped re-review → ADDRESSED → acceptance.
8. NOT ADDRESSED remains blocking.
9. round-cap/deferred findings remain explicitly visible.

### Inline execution

10. executing-plans does not fail merely because per-task fresh review is absent.
11. final review and conformance requirements remain enforced.

### Drift

12. Plan interface differs from code → immediate task conformance block.
13. Design invariant differs from Plan → downstream implementation authorization block.
14. implementation-discovered design change requires artifact reconciliation before resume.
15. code works and tests pass but violates approved Plan → acceptance blocked.
16. reviewer omits a required normative clause → clause becomes NOT_PROVEN and blocks acceptance.
17. final review approves old revision and code changes afterward → completion blocked.
18. all required clauses SATISFIED and no blocking quality findings → completion permitted.

### Routing and compatibility

19. Justice does not emit canonical `deep`.
20. custom `sp-*` categories coexist with OmO v5 routing.
21. Justice does not directly select model/provider.
22. compatible OpenCode patch with required capabilities is not rejected solely by patch mismatch.
23. missing required host capability is reported accurately.

### Recovery

24. compaction retains plan/task/review correlation.
25. completed work is not re-correlated to another plan after recovery.
26. Justice/Superpowers state conflict is surfaced rather than silently resolved.
27. OmO `task_id=ses_...` is preserved and never replaced with Justice TaskIdentity.
28. a task call is recoverably correlated by durable parent-session/parent-call sidecar binding.
29. both-target `category + subagent_type` input is not silently resolved by Justice.
30. missing/ambiguous execution correlation leaves evidence NOT_PROVEN.
31. Requirements change stales Design + Plan chain authority.
32. a substantive Superpowers Ruling can continue execution but cannot authorize acceptance.
33. clause projection with duplicate/missing/ambiguous source becomes INCOMPLETE/INVALID and blocks.
34. the v6.4.2 task reviewer receives the Conformance Contract through the same observed review dispatch.
35. missing/malformed structured review result blocks acceptance.
36. parked Important/Critical remains blocking until trusted later disposition/human quality adjudication.
37. OmO effective config resolution honors user/project plus harness/profile precedence.
38. v4 plan-only authorization is not promoted automatically to v5 artifact-chain authority.
39. v4 review-dispatch state cannot resume or satisfy v5 review gates.
40. unknown/newer persistent schema is preserved and acceptance fails closed.

---

## 30. Acceptance criteria for Justice v5 architecture

The implementation satisfies this design only if all of the following are true:

1. Superpowers remains the workflow/orchestration authority.
2. OmO remains the runtime/model/provider authority.
3. Justice can block acceptance without duplicating Superpowers orchestration.
4. approved plan semantics are preserved in worker delegation.
5. plan authorization detects substantive artifact changes.
6. task review evidence is revision- and task-correlated.
7. required conformance clauses cannot silently disappear.
8. `NOT_PROVEN` is fail-closed for required clauses.
9. semantic drift is blocked at the earliest acceptance boundary.
10. substantive drift requires authoritative artifact reconciliation before resume.
11. final completion independently checks cross-artifact conformance.
12. the final reviewed revision matches the completion candidate.
13. unresolved semantic drift is zero at `PlanComplete`.
14. unauthorized semantic drift is zero at `PlanComplete`.
15. missing required evidence is zero at `PlanComplete`.
16. blocking quality findings are zero at `PlanComplete`.
17. OmO continuation `task_id` ownership never conflicts with Justice semantic identity.
18. execution/review evidence is bound through durable call/session correlation rather than wire-payload overloading.
19. ApprovedArtifactChain binds exact Requirements + Design + Plan revisions.
20. normative projection is COMPLETE under a versioned schema before acceptance.
21. Superpowers review interop obtains structured clause evidence without Justice-owned review dispatch.
22. parked/Ruling semantics cannot silently remove blocking quality/conformance state.
23. doctor reports effective OmO configuration rather than a single-file approximation.
24. v4 persistent authority cannot be mistaken for v5 authority after upgrade.

---

## 31. Consequence of this design

Justice v5 is not a second Superpowers and not a thin OmO wrapper.

Its stable role is:

> **The semantic nervous system and quality gatekeeper between Superpowers' intended development process and OmO's actual execution. Justice does not think for Superpowers or act for OmO; it ensures that intent is transmitted faithfully, execution remains conformant, and completion is accepted only when positive evidence proves zero unresolved semantic drift.**

This is the architectural boundary future Justice changes must preserve.
