# Justice v5 Semantic Control Plane Design

**Date:** 2026-09-27
**Status:** DRAFT — awaiting human review
**Authorization:** NOT SELF-AUTHORIZING
**Target:** Justice v5.x
**Revised:** 2026-09-30
**Baseline:** Justice master @ a67af6e47560d2bb7e6fe25d28dc9e644860e7ed
**Requirements:** `docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md`
**Upstream baselines:** Oh My OpenAgent v5.1.x (OmO Native / senpi engine), Superpowers v6.4.2

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

- OmO v5.1.x **Native / senpi** compatibility as the primary execution harness.
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
- Native same-turn parallel tool execution and mass-ulw/workflow DAG observation.
- migration away from stale v4 and OpenCode-plugin-specific orchestration responsibilities.

### 2.2 Out of scope

The v5 Native scope does not include:

- reimplementation of Superpowers SDD.
- reimplementation of OmO model/provider/fallback behavior.
- Justice-owned task/review/fix scheduling.
- permanent behavioral compatibility with OmO v4.
- permanent compatibility with obsolete Superpowers reviewer contracts.
- automatic replacement of human plan approval.
- GitHub PR merge/approval automation.

OpenCode plugin support is secondary/legacy compatibility only. If retained, it is a separate adapter over the same Justice domain contracts and is not allowed to define the primary v5 runtime semantics.

## 3. Architectural invariants

### INV-01 — Superpowers owns methodology

Superpowers owns execution-method selection and all internal workflow progression.

Justice MAY activate the supported Superpowers execution method selected by authoritative intent, but MUST NOT independently decide:

- which implementation task runs next;
- when a task reviewer is dispatched;
- when a fix round is dispatched;
- how many re-review rounds are allowed;
- when the final whole-branch review runs;
- when Superpowers advances its ledger.

### INV-02 — OmO owns concrete runtime routing

Justice owns the semantic bridge:

```text
recognized Superpowers execution intent
    ↓
semantic execution class
    ↓
Justice category
    ↓
OmO concrete runtime resolution
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

Optional telemetry/enrichment failures should not unnecessarily crash OmO Native / senpi execution.

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
| J5D-OWN-01 | Superpowers owns execution-method selection and workflow/review progression; Justice may activate the selected supported methodology but must not duplicate progression. |
| J5D-OWN-02 | OmO owns concrete agent/runtime/model/provider/reasoning/retry/fallback routing. |
| J5D-ACT-01 | Justice keeps methodology MethodSelection separate from current-session ActivationEvidence: cross-session recovery may restore selection but never activation, matching same-session activation suppresses duplicate invocation, and conflicts fail closed. |
| J5D-GATE-01 | Justice owns fail-closed authorization/evidence/conformance acceptance. |
| J5D-TASK-01 | Superpowers task semantics must be preserved without lossy prompt reconstruction. |
| J5D-CHAIN-01 | Human authorization binds an exact Requirements→Design→Plan artifact chain. |
| J5D-CHAIN-02 | Requirements or Design substantive changes invalidate downstream authority. |
| J5D-RULING-01 | Superpowers Rulings may guide execution but cannot rewrite approved Justice authority. |
| J5D-CORR-01 | OmO `task_id` is continuation-session state and never Justice TaskIdentity. |
| J5D-CORR-02 | Runtime execution is correlated by durable Native `parentSessionId + parentToolCallId` sidecar binding, extended with observed OmO task/child/session metadata when available. Parallel callback order is never identity authority. |
| J5D-ROUTE-01 | Justice obeys Native task category/subagent_type XOR with provenance-aware translation: recognized Superpowers generic `general` is a compatibility encoding translated to one Justice category, while non-Superpowers explicit routing and Native task lifecycle/control remain caller/runtime-owned. |
| J5D-ROUTE-02 | Semantic execution classification is deterministic from structured task/review semantics with precedence final-review > review > architecture > deep > integration > mechanical > implementation; ambiguity never fabricates a category. |
| J5D-CAT-02 | Justice categories are semantic routing inputs only; OmO effective configuration resolves them to concrete runtime/model/provider, and Justice never selects a concrete model/provider. |
| J5D-PROJ-01 | Requirements/Design/Plan normative sources are deterministically enumerable. |
| J5D-PROJ-02 | Projection has COMPLETE/INCOMPLETE/INVALID state; only COMPLETE may pass acceptance. |
| J5D-PROJ-03 | Projection schema/version is bound to artifact-chain and evidence identity. |
| J5D-REVIEW-01 | Justice observes an existing Superpowers review dispatch and never creates a duplicate review. |
| J5D-REVIEW-02 | Justice observes the existing Superpowers Native `task` reviewer call through senpi `tool_call`, binds it by current session + toolCallId, and appends one deterministic Conformance Contract appendix to that same task prompt in place. Matching `tool_result` and trusted Native task metadata corroborate result provenance; Justice never creates a duplicate reviewer. |
| J5D-REVIEW-03 | Trusted review evidence uses versioned structured results; the current Superpowers scoped dispatch supplies exact marker IDs for its current target set, while persisted trusted lineage evidence separately supplies metadata and a lineage-wide reserved finding-ID set so historical identities cannot be reused by new breakage; empty target sets remain valid for clause-only re-proof. |
| J5D-REVIEW-04 | Missing, malformed, stale, wrong-scope, untrusted, identity-inconsistent, diff-failed, or incompletely covered final-review evidence fails closed; failed final-evidence attempts never masquerade as trusted closures. |
| J5D-QUALITY-01 | Critical/Important findings block; Minor is deferred-visible; parked/Ruling is not resolution. |
| J5D-STORAGE-01 | Directly observed structured review results are canonical; insecure file fallback never becomes trusted evidence. |
| J5D-CONFIG-01 | Doctor/config verification uses OmO Native effective configuration precedence plus the effective Native agent directory/state projection, not a single config file or OpenCode profile directory. |
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
User / authorized implementation intent
                │
                ▼
             Justice
  activation bridge only
  ├─ validate authoritative execution-method intent
  ├─ require/activate matching Superpowers skill
  └─ record activation evidence
                │
                ▼
          Superpowers = WHAT
  ├─ methodology semantics
  ├─ execution-method selection
  ├─ task selection
  ├─ implementer dispatch
  ├─ task-review dispatch
  ├─ fix / scoped re-review progression
  ├─ progress ledger
  └─ final whole-branch review
                │ semantic execution intent
                ▼
      Justice = SEMANTIC HOW
  ├─ task/review semantic classification
  ├─ provenance-aware category translation
  ├─ plan authorization / artifact lineage
  ├─ execution correlation / observation
  ├─ evidence / review provenance
  ├─ conformance / quality gates
  ├─ task acceptance / plan completion
  └─ diagnostics / recovery
                │ one semantic category
                ▼
        OmO = CONCRETE HOW
  ├─ child-session / task execution
  ├─ category → agent/runtime resolution
  ├─ model/provider/reasoning resolution
  ├─ retry/fallback
  └─ continuation session
```

The boundary is intentionally asymmetric:

- Superpowers does not know Justice `sp-*` category names or OmO model/provider configuration.
- OmO does not know Superpowers methodology semantics.
- Justice is the only adapter that knows both contracts.
- Justice activation does not make Justice the workflow scheduler.
- Justice semantic classification does not make Justice the concrete runtime resolver.

Justice is authoritative at activation-validation, semantic translation, authorization, and acceptance boundaries, but not at Superpowers progression or OmO concrete runtime selection.
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
- OmO Native execution;
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

### 7.2 OmO Native task_id ownership — J5D-CORR-01

OmO Native `task_id` is task-engine lifecycle/control identity.

Justice semantic `TaskIdentity` is never encoded into that field.

A legitimate observed or incoming Native `task_id` is preserved unchanged. Justice may record it as `omoTaskId`, but it is runtime metadata rather than semantic proof.

### 7.3 Canonical sidecar binding — J5D-CORR-02

The Native parent-call container identity is:

```text
ExecutionCallKey = parentSessionId + parentToolCallId
```

- `parentSessionId` is the current senpi extension session identity.
- `parentToolCallId` is the stable `toolCallId` of the observed Native `task` call.

A parent call may represent either one task or a batch. Justice therefore persists **item-level** correlations:

```text
ExecutionCorrelationKey
├─ parentSessionId
├─ parentCallId
├─ itemKind            # single | batch
└─ batchItemIndex?     # required iff itemKind=batch
```

The v5.1.2 Native regression gate must prove that `task({tasks:[...]})` preserves input item order into `TaskToolDetails.items[]`. Only after that proof may `batchItemIndex` be used to join pre-execution input items to result items.

Each durable value is:

```text
ExecutionCorrelation
├─ authorizationId
├─ artifactChainId
├─ planIdentity
├─ taskIdentity
├─ executionMethod
├─ parentSessionId
├─ parentCallId
├─ itemKind
├─ batchItemIndex?
├─ omoTaskId?
├─ childSessionId?
├─ dagRunId?
├─ dagNodeId?
├─ dispatchRevision
└─ status
```

The in-memory relation maps used by an adapter are caches only; durable `.justice/` state is the recovery authority.

Lifecycle:

```text
senpi tool_call(task)
  → single: persist one PENDING correlation keyed by (session, call, single)
  → batch: persist one PENDING correlation for each input tasks[index]

matching senpi tool_result(task)
  → single: attach the Native task_id/result
  → batch: attach details.items[index].task_id/result to the matching batchItemIndex
  → never fan out the top-level aggregate/first-item task_id to all batch items

trusted OmO Native task lifecycle / TaskRecord observation
  → attach child/session/DAG metadata to the exact correlation when available and consistent

review / verification
  → resolve semantic evidence through that item-level correlation

recovery
  → reconstruct from durable Justice bindings + trusted Native runtime metadata
```

If Native result/task/session metadata disagree, the relation is untrusted.

Correlation persistence failure does not have to abort Native execution, but the affected execution cannot become trusted acceptance evidence.

#### Parallel, batch, and DAG identity

OmO Native can execute multiple tools concurrently in one turn, can spawn multiple ordered items from one batch call, and mass-ulw/workflow can run parallel-ready DAG nodes.

Justice therefore treats callback/event order as non-semantic. Every observation is keyed by stable call + work-item identity. DAG identity is corroborating runtime provenance attached to that exact work item. A batch or DAG execution is trusted only when every semantic work item is independently attributable; ambiguity remains `NOT_PROVEN`.

### 7.4 category / subagent_type and semantic translation — J5D-ROUTE-01 / J5D-ROUTE-02

Justice follows the OmO Native `task` XOR contract; it never intentionally emits both `category` and `subagent_type`.

Routing decisions are provenance-aware and bound to a versioned `NativeSuperpowersDispatchProfile`.

#### Non-Superpowers / explicit caller routing

- explicit `subagent_type` from a non-Superpowers caller is preserved;
- recognized Superpowers explicit specialized non-generic routing is also preserved and is not category-translated;
- explicit `category` is accepted as a caller-owned non-empty OmO category name and preserved byte-for-byte;
- external both-target input is a routing-contract violation;
- Justice does not invent precedence between explicit external targets.

#### NativeSuperpowersDispatchProfile

The Native profile is established by Task 1 using the exact supported Superpowers v6.4.2 Pi extension and OmO Native / senpi baseline. It records at least:

```text
profile version / upstream SHAs
actual worker-dispatch tool surface
actual generic target shape/marker, if one exists
actual review-dispatch shape
observable Native skill-activation channels
batch input-index ↔ result-items[index] ordering proof
```

The profile MUST come from runtime evidence, not a hand-written synthetic fixture. OpenCode V1's `task(subagent_type="general")` mapping is historical evidence only and is not a Native default.

If the runtime regression does not expose a stable generic dispatch on a surface that Justice can translate in place, the supported Native compatibility capability is unavailable and implementation returns to artifact reconciliation. Justice does not manufacture a `task` call merely to fit its desired routing model.

#### Recognized Superpowers new-worker routing

For a dispatch that exactly matches the active profile's proven generic Native target:

```text
profile-recognized Superpowers generic dispatch
        ↓
semantic execution classification
        ↓
remove only the profile-defined generic marker
set category = exactly one Justice sp-* category
        ↓
same OmO Native task execution
```

The final payload still satisfies XOR. A shape that differs from the profile is untrusted rather than normalized.

Deterministic review mapping is:

```text
task review / scoped re-review → review       → sp-review
final whole-branch review      → final-review → sp-final-review
```

Implementation dispatches use the semantic classifier in §21.

#### Native task lifecycle/control

`task_send`, `task_output`, `task_cancel`, background completion, process-child recovery, and equivalent lifecycle/control operations are runtime-owned. Justice does not inject a new worker category on those calls.

#### Ambiguous recognition/classification

If Superpowers provenance, profile matching, or semantic classification is not authoritative:

- Justice does not fabricate an `sp-*` category;
- runtime may remain fail-open where safe;
- the routing/evidence path is untrusted and required acceptance evidence remains `NOT_PROVEN`.

Justice does not rely on defensive runtime normalization of invalid both-target input.

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

Justice uses the existing Superpowers reviewer dispatch. It never adds a Justice-owned reviewer.

#### Supported OmO Native delivery contract

The Native v5 review path is:

```text
Superpowers v6.4.2 dispatches existing reviewer
        ↓
OmO Native task(...)
        ↓
senpi tool_call(task, toolCallId, event.input)
        ↓
Justice recognizes review kind
+ records PendingReviewCorrelation(parentSessionId + toolCallId)
+ translates generic compatibility encoding when applicable:
  task/scoped → category=sp-review
  final       → category=sp-final-review
  subagent_type removed
+ appends deterministic Justice Conformance Contract appendix
  to the SAME event.input.prompt in place
        ↓
OmO Native task engine consumes the mutated input
        ↓
matching tool_result(task, same toolCallId)
        ↓
Native task_id/result metadata attached
        ↓
trusted TaskRecord/task lifecycle metadata corroborates
child/session/process/DAG identity when available
        ↓
reviewer result is attributed to the durable correlation
```

senpi `tool_call` explicitly permits in-place mutation of `event.input` before execution. Justice uses that extension point instead of an OpenCode `chat.message` hook.

Binding/injection succeeds only when:

1. the call is a recognized Superpowers review on the Native `task` surface;
2. current controller session identity and `toolCallId` are available;
3. `event.input.prompt` is exactly one string;
4. exactly one compatible pending review owns that call key;
5. the Justice appendix sentinel is not already present;
6. durable pending-correlation persistence succeeds.

Failure semantics are fail-closed for review evidence:

```text
missing session identity / toolCallId
→ untrusted

missing/non-string prompt
→ prompt_unavailable

duplicate/conflicting appendix sentinel
→ injection_conflict

ambiguous review provenance
→ ambiguous

pending correlation persistence failure
→ persistence_failed
```

These failures do not require crashing Native execution, but the semantic review remains `NOT_PROVEN`.

#### Prompt-preservation contract

Justice does not reconstruct the Superpowers review prompt.

The mutated prompt is:

```text
<original Superpowers prompt bytes>

<Justice appendix start sentinel>
<review correlation + artifact/task/range identity>
<Conformance Contract instructions>
<structured-result instructions>
<Justice appendix end sentinel>
```

Rules:

- original Superpowers prompt/content remains an exact prefix;
- one Justice appendix is added at most once;
- review routing mutation and appendix enrichment happen on the same original `task` call;
- Justice does not change model/provider/reasoning/fallback fields;
- a specialized caller-owned `subagent_type` remains specialized and is not category-translated;
- no new task/reviewer call is created.

#### Parallel CodeMode and mass-ulw

A single Native model turn may contain multiple concurrent tool calls. A workflow may contain multiple runnable DAG nodes.

Therefore:

- arrival/completion order is never used to match review calls;
- review identity is `parentSessionId + toolCallId`;
- Native `task_id`, process/child session, DAG run/node IDs may enrich provenance when available;
- two concurrent reviews or worker calls must remain independently correlated;
- missing identity that makes concurrent work ambiguous leaves affected evidence `NOT_PROVEN`.

Task 1 is a Native runtime regression gate for this selected contract, not an architecture-selection spike.

### 14.3 Structured result, finding continuity, and final evidence composition — J5D-REVIEW-03

The reviewer result contains the normal human-readable report plus one machine-readable Justice envelope.

Canonical result shape:

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
│  ├─ verdict
│  └─ findings[]
│     ├─ findingId
│     ├─ severity
│     ├─ summary
│     ├─ location?
│     ├─ disposition
│     └─ evidenceRefs[]
└─ clauses[]
   ├─ clauseId
   ├─ status: SATISFIED | VIOLATED | NOT_PROVEN
   ├─ evidenceRefs[]
   └─ evidenceScope
```

A SATISFIED clause records:

```text
ClauseEvidenceScope =
  global
  | files(normalized repository-relative paths[])
```

#### Scoped re-review finding identity continuity

Justice never fuzzy-matches findings between separate reviewer calls and never derives the current scoped target set by projecting every finding from a preceding review.

The exact transport marker is:

```text
[[justice-finding:<findingId>]]
```

where `findingId` must match:

```text
^jf_[0-9a-f]{16}$
```

Every Justice-tracked quality finding in a task/final review and every new breakage in a scoped review must have:

1. exactly one human-readable marker on that finding line;
2. the same ID in the machine `ReviewFindingV5.findingId`;
3. an ID unique within that review result.

Human-marker/machine-ID mismatch, orphan markers, malformed markers, or duplicate IDs make the structured review evidence invalid.

This transport relies on a verified Superpowers v6.4.2 workflow property: the controller sends the current open findings verbatim to the fix implementer and to the scoped re-review. Justice uses that verbatim transport without taking ownership of which findings stay open.

##### Current-dispatch target set

For a recognized scoped re-review, Justice extracts marker IDs only from:

```text
## The Findings Under Verification
...
## The Fix
```

The start and end headings above are exact boundaries. Markers elsewhere in the reviewer prompt do not contribute to the current target set.

```text
ScopedFindingMarkerExtraction =
  resolved(requestedFindingIds[])
  | invalid(reason)
```

Extraction rules:

- preserve marker first-appearance order;
- `requestedFindingIds` may be empty;
- duplicate IDs are invalid;
- malformed Justice marker syntax inside the findings section is invalid;
- no summary/location/order matching is performed.

This current dispatch is the authority for **which Justice quality findings this scoped review is verifying**.

Therefore:

- Minor findings that Superpowers deferred and omitted from the loop do not re-enter `requestedFindingIds`;
- an ADDRESSED finding removed from the next open-findings list does not reappear merely because it exists in persisted evidence;
- a NOT ADDRESSED finding continues with the same marker because Superpowers carries its line forward verbatim;
- new Critical/Important breakage may enter a later round with the new stable marker created in the scoped result;
- spec/clause-only scoped re-review is represented by `requestedFindingIds = []`.

An empty marker set is a valid scoped target set and is different from extraction/context failure.

##### Trusted metadata and lineage reservation lookup

The context lookup contract is:

```text
ReviewFindingContextQuery
├─ artifactChainId
├─ scope: task | final
├─ taskIdentity?               # task scope only
├─ precedingReviewedHead       # scoped base SHA
└─ requestedFindingIds[]
```

The current scoped dispatch remains the sole authority for `requestedFindingIds`.

The evidence store has a second, independent responsibility: build the collision-prevention namespace for the same trusted review lineage.

```text
expectedFindings
= current scoped dispatch verdict targets only

reservedFindingIds
= every finding ID already used by trusted evidence
  in the same task/final review lineage
```

Lineage boundaries are exact.

Task lineage:

```text
artifactChainId + exact TaskIdentity
```

The task lineage is a **single contiguous trusted chain**.

Starting from the unique immediate preceding review whose `reviewedRange.head === precedingReviewedHead`:

- `task-review` is the root;
- for a `scoped-re-review`, `reviewedRange.base` must equal exactly one earlier trusted result's `reviewedRange.head` under the same artifact chain/task identity;
- traverse that edge backward until the single `task-review` root;
- missing predecessor, multiple predecessor candidates, multiple roots, or a cycle is untrusted/ambiguous.

Only IDs observed on that chain are reserved.

Final lineage:

```text
artifactChainId + current final-review lifecycle
```

For the supported one-fix-wave final flow, the scoped-final review's unique immediate predecessor must be the trusted `final-review` whose head equals `precedingReviewedHead`. That full-final result is the lineage root and supplies the reserved IDs. A scoped predecessor would imply a second final re-review and is unsupported/untrusted.

Finding IDs from another task, another artifact chain, or another final-review lifecycle are outside this reservation domain.

The store scans the trusted lineage and constructs a historical ID registry.

Repeated occurrences of the same ID are legal only when these immutable identity fields remain identical:

```text
findingId
severity
summary
location
```

Disposition and evidence references may evolve across rounds.

If one ID maps to conflicting immutable identity metadata in trusted history:

```text
ReviewFindingContextResult =
  untrusted("historical_finding_id_collision")
```

No identity is selected or normalized.

The resolved result is:

```text
ReviewFindingContextResult =
  resolved(
    expectedFindings[],
    reservedFindingIds[],
    sourceReviewCorrelationId
  )
  | not_found
  | ambiguous
  | untrusted
```

`reservedFindingIds` contains every valid historical lineage ID exactly once, in first-seen order along the resolved root→preceding chain.

Then current-target resolution applies:

- `requestedFindingIds=[]` is valid and yields `expectedFindings=[]` while still returning the lineage's `reservedFindingIds`;
- each requested ID must exist exactly once in the trusted immediate preceding review;
- its immutable metadata is projected into `ReviewFindingTarget`;
- an explicitly `resolved`, deferred Minor, or `human_adjudicated` stored finding requested as a current open target is inconsistent and yields `untrusted`;
- unknown or duplicate requested ID yields `untrusted`;
- zero preceding candidate → `not_found`; multiple candidates → `ambiguous`.

For task/first-final review there is no scoped context, so `expectedFindings` and `reservedFindingIds` are absent.

For scoped re-review both are present. `expectedFindings` may be empty. `reservedFindingIds` may be empty only if the lineage has never emitted a trusted quality finding.

Architecture ownership:

```text
review recognition / marker extraction (Task 7)
  current scoped dispatch → requestedFindingIds
        ↓
review evidence store (Task 8)
  exact preceding metadata → expectedFindings
  trusted lineage history  → reservedFindingIds
        ↓
review interop/parser (Task 7)
  current-target verdict validation
  + new-breakage collision validation
```

The evidence store never chooses the current target set.

##### Scoped appendix/result validation

For non-scoped review, Justice requires every machine quality finding to have a matching human marker/ID and uniqueness within that result.

For scoped re-review:

- the appendix includes exactly the resolved `expectedFindings` array, even when empty;
- parser expectation also carries the lineage-wide `reservedFindingIds`;
- every expected finding appears exactly once with the same ID/severity/summary/location and marker;
- `ADDRESSED` maps to `resolved`;
- `NOT ADDRESSED` maps to `open`;
- new breakage gets a fresh `jf_<16 lowercase hex>` ID and matching marker;
- a new-breakage ID must not belong to the expected-ID set;
- a new-breakage ID must not belong to `reservedFindingIds`;
- reviewer output may not emit `human_adjudicated`.

When `expectedFindings=[]`, the appendix is still injected and the structured result must still return Conformance Contract clause results. Historical `reservedFindingIds` still apply to any new breakage emitted in that result.

Invalid cases include:

- missing/duplicate expected ID;
- expected metadata or marker mismatch;
- duplicate/malformed/orphan marker;
- new-breakage collision with current expected IDs;
- new-breakage collision with any historical reserved ID;
- historical ID collision while constructing the reserved set;
- requested/context identity inconsistency.

No similarity heuristic is an authority for finding identity.

#### Final fix diff provenance

When Superpowers performs its one final fix wave A..B, Justice obtains trusted deterministic diff evidence:

```text
FinalFixDiffEvidence
├─ base
├─ head
└─ changedPaths[]
```

The core conformance algorithm never accepts arbitrary caller-supplied changed paths.

A runtime/provider boundary supplies:

```ts
interface RevisionDiffProvider {
  resolve(
    base: string,
    head: string,
  ): Promise<RevisionDiffResult>;
}

type RevisionDiffResult =
  | {
      kind: "resolved";
      evidence: FinalFixDiffEvidence;
    }
  | {
      kind: "failed";
      reason:
        | "git_failed"
        | "non_ancestor_range"
        | "malformed_output"
        | "unsupported_status"
        | "unsafe_path";
      details: readonly string[];
    };
```

Provider semantics remain:

1. prove `base` is an ancestor of `head`;
2. derive exact `base..head` changes using Git name-status semantics equivalent to `git diff --name-status -z --find-renames --find-copies BASE..HEAD`;
3. normalize repository-relative touched paths;
4. A/M/D/T/U/B statuses add the single path;
5. R*/C* statuses add **both old and new paths**;
6. malformed/unsupported status, unsafe path, Git failure, or non-ancestor range returns `failed`.

#### Trusted closure versus blocked attempt

A trusted `FinalReviewEvidenceClosure` is a **complete/trusted evidence object only**. It is never fabricated for a failed diff or incomplete final review.

```text
ResolvedFinalFixWaveEvidence
├─ kind: resolved
├─ diffEvidence: FinalFixDiffEvidence
└─ scopedReReview

FailedFinalFixWaveEvidence
├─ kind: diff_failed
├─ base
├─ head
├─ diffFailure: RevisionDiffResult.failed
└─ scopedReReview

FinalReviewEvidenceClosure              # trusted only
├─ schemaVersion
├─ artifactChainId
├─ candidateHead
├─ fullFinalReview
├─ finalFixWave?: ResolvedFinalFixWaveEvidence
├─ carriedClauseIds
├─ reProvenClauseIds
├─ clauseResults
├─ findings
└─ diagnostics

BlockedFinalReviewEvidenceAttempt       # never completion evidence
├─ schemaVersion
├─ artifactChainId
├─ candidateHead
├─ fullFinalReview
├─ finalFixWave?: ResolvedFinalFixWaveEvidence | FailedFinalFixWaveEvidence
├─ notProvenClauseIds
├─ blockingFindingIds
├─ reasons
└─ diagnostics
```

The builder result is:

```text
complete(FinalReviewEvidenceClosure)
|
blocked(BlockedFinalReviewEvidenceAttempt)
```

Only the `complete` branch may populate `PlanConformanceInput.finalReviewClosure`.

Invariant:

```text
RevisionDiffResult.failed
→ no trusted FinalFixDiffEvidence
→ no trusted FinalReviewEvidenceClosure
→ blocked attempt preserves exact fix-wave failure provenance
→ PlanComplete BLOCKED
```

A failed diff may still coexist with a trusted scoped re-review result, but without trusted diff provenance Candidate-A clause evidence cannot be carried forward. The build result remains `blocked`.

For a resolved diff:

- `global` intersects every non-empty fix diff;
- `files(paths)` is non-intersecting only when `changedPaths ∩ paths === ∅`;
- missing/malformed/undecidable scope is not carry-forward eligible.

#### Superpowers final-review progression

Justice follows Superpowers v6.4.2 exactly:

```text
Candidate A
    ↓
ONE full final whole-branch review
    ↓ findings, if any
ONE Superpowers final fix wave A → B
    ↓
exactly ONE scoped re-review of A..B
    ↓
residual adjudication / branch finishing
```

Justice does not request or dispatch a second full final review.

Trusted closure range rules:

1. without a final fix wave, `candidateHead === fullFinalReview.reviewedRange.head`;
2. with a resolved fix wave:
   - `diffEvidence.base === fullFinalReview.reviewedRange.head`;
   - `scopedReReview.reviewedRange.base === diffEvidence.base`;
   - `diffEvidence.head === scopedReReview.reviewedRange.head`;
   - `diffEvidence.head === candidateHead`;
3. only resolved exact-range diff evidence authorizes carry-forward;
4. intersecting/undecidable clauses require explicit scoped re-proof; otherwise build result is blocked with those clauses `NOT_PROVEN`.

#### Deterministic finding disposition merge

Finding merge runs only after current-dispatch marker extraction and scoped finding-context validation.

The scoped result is authoritative only for the `expectedFindings` selected by the current Superpowers dispatch.

For every expected/current-target finding:

- exactly one same-ID scoped result with `resolved` → original finding resolved;
- same-ID `open` → remains unresolved;
- missing same-ID result → scoped evidence invalid/fail-closed;
- duplicate/conflicting same-ID result → invalid/fail-closed.

Findings from the preceding review that are **not** in the current target set retain their prior disposition and are not re-reviewed by Justice. This includes task-loop deferred Minor findings and already-resolved findings. A preceding open Critical/Important task finding cannot silently disappear because Task 8's requested-set consistency check would make that scoped context untrusted before parsing.

For new scoped findings:

- new Critical/Important + `open` → unresolved blocker and may become a later Superpowers open finding with the same marker;
- new Minor remains deferred-visible and does not enter the task fix loop unless the current Superpowers workflow explicitly carries it;
- ID collision with an original/expected finding is invalid.

Original severity/summary/location remain authoritative for an expected finding; a scoped reviewer cannot mutate those fields to clear a blocker.

`human_adjudicated` is never manufactured by reviewer output. It may only be applied through the separate trusted human review-resolution path and cannot change a conformance clause status.

### 14.4 Invalid/stale result — J5D-REVIEW-04

An individual structured review result is rejected when:

- missing or malformed;
- correlation ID does not match the observed call;
- artifact-chain/task identity is wrong;
- declared review range does not match the observed dispatch;
- provenance is not the observed reviewer call;
- required clause IDs are absent;
- scoped expected-findings context is missing, ambiguous, or untrusted;
- expected finding ID is missing/duplicated or its immutable target fields mismatch;
- a new breakage reuses an expected/original finding ID.

Missing required clause results become `NOT_PROVEN`. Invalid scoped finding identity never silently clears the preceding blocker.

A final evidence build is blocked when:

- Candidate A's full review is used alone for later Candidate B;
- final fix range is non-contiguous or mismatches full/scoped/candidate revisions;
- `RevisionDiffResult.kind === "failed"`;
- changed-path parsing is unsafe/ambiguous;
- scoped re-review is untrusted;
- affected/undecidable clause lacks scoped re-proof;
- an expected/current-open blocker is omitted rather than explicitly resolved;
- duplicate/conflicting finding dispositions exist;
- a new blocking scoped finding remains open/parked.

A blocked build returns `BlockedFinalReviewEvidenceAttempt`; it does **not** return or fabricate a trusted `FinalReviewEvidenceClosure`.

Only a trusted `complete` closure may satisfy plan-conformance completion input.

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
trusted final-review evidence closure ↔ completion candidate revision
```

The final gate covers cross-task properties that task-local review may miss:

- Design invariants remain true globally;
- producer/consumer interfaces agree;
- no Plan task silently disappeared;
- no undocumented normative behavior was introduced;
- test assertions still prove required contracts;
- deferred findings remain visible;
- the trusted final-review evidence closure covers the candidate tree;
- no post-review mutation is accepted unless it is the single Superpowers final fix wave and is fully covered by the trusted scoped re-review delta;
- no uncovered post-review code change can inherit stale evidence.

Completion requires:

```text
all required tasks accepted
AND Superpowers final-review lifecycle satisfied
AND trusted FinalReviewEvidenceClosure covers the completion candidate
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

Justice v5 keeps controller verification, Superpowers execution-method activation, and worker routing as three distinct concerns.

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
- A controller mapping is considered verified only when supported by current OmO Native evidence or live compatibility tests.
- If actual attribution cannot be observed authoritatively, Justice reports Unverified rather than inventing Applied.

This preserves the v4 Configuration Assurance goal without binding v5 to an unverified stale mapping.

---


### 20.1 Supported execution-method activation — J5D-ACT-01

Justice does not own methodology-selection semantics. It models selection and activation separately.

#### Method selection

```text
explicit user/command selection for this implementation start
→ trusted recovered method selection from the same active authorization
→ otherwise method_selection_required
```

No additional pre-activation method-observation source exists. Native skill-system activation evidence is not a selection event.

Cross-session Justice state may recover which method was selected/used previously for the same authorization, but only as `recovered_selection`.

#### Native activation seam

The supported Pi/Senpi contract does **not** assume a `skill` tool. Superpowers v6.4.2 directs Pi to use its native skill system. Task 1 therefore proves the concrete OmO Native observation channels before production implementation.

The v5 activation model accepts only profile-proven current-session observations:

```text
A. successful skill read
   read tool_result(success)
   canonical path == <Superpowers skill root>/skills/<selected-method>/SKILL.md

B. trusted native skill input
   non-extension input
   host-expanded <skill name="<selected-method>" ...>
   (or raw /skill:<selected-method> only if the host exposes that pre-expansion form)
```

Extension-injected text, pointers/reminders, skill-name mentions, child `load_skills`, or the generic `using-superpowers` bootstrap are not activation proof.

Trusted evidence binds:

```text
authorizationId
sessionId
method
activationKind
activationSourceRef
observedAt
```

A skill-read observation additionally binds its canonical SKILL.md path and read `toolCallId`. The read call alone is insufficient; its result must be successful.

An exact persisted same-session activation record may be reused after restart only when all identity fields required by the contract still match. A record from another session never proves current activation.
Justice stores one current selection per authorization and one current activation per `authorizationId + sessionId`. Explicit reselection atomically replaces the selection record; a later successful profile-proven Native activation atomically replaces that session's activation record.

A selection/activation store read, schema, or write failure is fail-closed for methodology evidence: it cannot yield `already_active` or trusted recovered selection. Runtime may remain fail-open only under the existing global policy, while acceptance remains `NOT_PROVEN`.

#### Decision state

```text
no selected method
→ method_selection_required

selected method + matching current-session activation evidence
→ already_active
→ do NOT request duplicate activation

selected method + no matching current-session activation evidence
→ needs_activation
→ request exactly the selected method through the profile-proven Native skill system

selected method + no proven activation channel
→ unavailable
```

Justice may direct the controller to load the exact selected SKILL.md through the Native skill system, but it must not fabricate a Claude Code/OpenCode-style `skill` tool call.

Conflict handling is deterministic:

- explicit current selection overrides stale recovered selection, but if another method was activated earlier in the current session that evidence is not reused; the explicitly selected method requires fresh activation;
- when selection comes only from recovery and a different current-session method is observed active, return `conflict` / untrusted instead of silently preferring either;
- activation evidence with mismatched authorization/session identity is untrusted.

Therefore:

```text
cross-session recovered method
→ selection restored
→ needs_activation
→ fresh profile-proven current-session Native skill activation

same-session exact activation evidence
→ already_active
```

Justice never treats OmO child continuation as methodology activation and never responds to activation failure by dispatching implementation work itself.

## 21. Worker semantic classification and category routing — J5D-ROUTE-02 / J5D-CAT-02

Justice classifies semantic execution intent; it does not select a concrete model/provider.

### 21.1 Semantic classes

```text
mechanical
  bounded/repetitive/deterministic;
  small surface;
  no architecture judgment;
  no cross-component state coordination

implementation
  ordinary bounded feature work;
  normal coding judgment;
  default when no stronger semantic class applies

integration
  multiple modules/components/interfaces;
  migration or cross-boundary state/concurrency/async/data-flow coordination

deep
  substantial investigation/root-cause research/unknown behavior;
  high reasoning ambiguity without an architecture decision requirement

architecture
  component/public-interface boundary;
  persistent-state ownership;
  protocol/security boundary;
  major architecture responsibility decision

review
  task review or scoped re-review

final-review
  whole-branch/final review
```

### 21.2 Precedence

If several signals apply:

```text
final-review
> review
> architecture
> deep
> integration
> mechanical
> implementation
```

Review kind is explicit workflow semantics, not keyword inference.

### 21.3 Authoritative classifier input

The classifier consumes structured semantics where available:

- task heading;
- full task body;
- Files;
- Interfaces / Consumes / Produces;
- signatures / exact values;
- tests / expected verification;
- cross-task dependencies;
- explicit review kind;
- architecture/security/persistent-state obligations.

Keywords may contribute evidence but cannot alone upgrade a task into `integration`, `deep`, or `architecture`.

If required context is missing/conflicting such that the classifier cannot authoritatively choose one class, the result is `ambiguous`; Justice does not fabricate an `sp-*` category and the execution cannot satisfy trusted semantic-routing evidence.

### 21.4 Category mapping and namespace ownership

Justice-generated semantic categories are a closed union:

```text
mechanical      → sp-mechanical
implementation  → sp-implementation
integration     → sp-integration
deep            → sp-deep
architecture    → sp-architecture
review          → sp-review
final-review    → sp-final-review
```

Caller-owned OmO category names are different: the wire namespace is open and may contain any non-empty configured category key.

Current OmO v5 built-in names remain useful compatibility/diagnostic vocabulary:

- visual-engineering;
- ultrabrain;
- deep-low;
- deep-high;
- artistry;
- quick;
- unspecified-low;
- unspecified-high;
- writing.

But that list is **not** the universe of legal caller-owned categories. OmO effective configuration may define names such as `company-backend`, and Justice preserves such explicit caller categories without translating or rejecting them merely because they are unknown to Justice.

Justice MUST NOT emit legacy `deep` as a canonical OmO built-in result; legacy input may normalize `deep → deep-low` only where legacy normalization is explicitly applicable.

Validation ownership is split:

```text
Justice pure translator
→ require a non-empty category string for explicit caller category
→ preserve exact string

OmO effective config/runtime
→ determine whether that category is configured/resolvable
→ resolve actual runtime/model/provider
```

Justice never promotes its built-in vocabulary into OmO namespace authority.

### 21.5 Model/provider boundary

For the supported OmO Native profile:

```text
Superpowers task complexity / capability intent
        ↓
Justice semantic execution class/category
        ↓
OmO effective category configuration
        ↓
actual agent/model/provider/reasoning/retry/fallback
```

Justice never writes a concrete model/provider into this semantic translation.

Superpowers v6.4.2's generic templates contain model-selection guidance, but the supported OmO Native task surface exposes category/subagent routing while OmO remains runtime/model authority. Therefore the compatibility profile interprets that guidance as semantic capability/complexity intent.

If future supported upstream introduces a concrete model field as authoritative wire input, Justice must update the compatibility profile explicitly; it must not silently choose precedence between category and concrete model fields.
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

Justice treats **OmO v5.1.x Native effective configuration resolution** as configured-state authority, not an arbitrary single file and not an OpenCode config directory.

### 24.1 File-layer precedence

Justice reproduces the audited OmO loader order when it cannot consume an authoritative effective-config API:

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

Invalid/unreadable/skipped layers and loader diagnostics are represented explicitly rather than silently treated as valid configuration.

### 24.2 Native effective-view resolution

After file-layer merge, the Native configured view resolves:

```text
shared base
→ [native]
→ selected profile base
→ selected profile [native]
```

The selected profile comes from explicit resolution input or the Native OmO profile authority (for example `OMO_PROFILE`). Justice does not infer a Native profile from `OPENCODE_CONFIG_DIR` or an OpenCode profile directory.

### 24.3 Native agent directory/state

The senpi runtime exposes an effective agent state directory for the session. Normally this is `~/.omo/agent`, subject to the Native runtime's supported agent-directory override such as `OMO_CODING_AGENT_DIR`.

Justice may inspect safe projections from:

- `settings.json`;
- `auth.json`;
- `models.json`;

when required for doctor/config explanation.

Rules:

- `auth.json` secret values are never copied into Justice state, logs, observations, or diagnostics;
- existence/schema/availability may be reported without secret contents;
- agent-state files do not replace the effective `omo.jsonc` view; they are distinct Native runtime authorities.

### 24.4 Doctor representation

Doctor distinguishes:

```text
source layers + diagnostics
        ↓
effective Native configured value
        ↓
runtime-applied value/state (if authoritatively available)
        ↓
observed execution value
```

It never infers applied/observed state merely from a source file.

Legacy `oh-my-opencode.jsonc`, `oh-my-openagent.jsonc`, OpenCode plugin config, and OpenCode profile directories are migration/secondary-compatibility diagnostics only.

---

## 25. Doctor and compatibility model

`justice doctor` answers:

> Can Justice operate correctly and prove the required contracts in this OmO Native environment?

It does not answer:

> Is the current plan conformant?

Doctor checks include:

- OmO Native / senpi version metadata;
- required senpi extension capabilities;
- Justice Native extension/adapter registration;
- `tool_call` / `tool_result` observability;
- current session identity availability;
- Native task/task-lifecycle capability;
- configuration sources and loader diagnostics;
- Native `[native]` effective view;
- effective agent directory and safe state-file availability;
- category availability;
- command/skill availability;
- Superpowers availability where observable;
- review-interop capability;
- secure review-evidence capability;
- observation limitations.

Compatibility is capability-first:

```text
version metadata
    +
required capability probes
    +
known compatibility constraints
```

Exact Native/senpi patch equality alone is neither necessary nor sufficient.

A newer patch with intact required capabilities may remain supported.

A nominally expected version missing a required capability is unsupported.

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

The v5 implementation plan must include E2E/integration coverage for at least the following behaviors.

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
17. an older full final review alone cannot complete a post-fix candidate; the single Superpowers scoped final re-review may extend trusted coverage only when affected clauses are re-proven and unaffected clause scopes are deterministically non-intersecting.
18. all required clauses SATISFIED and no blocking quality findings → completion permitted.

### Routing and Native compatibility

19. Justice does not emit canonical `deep`.
20. custom `sp-*` categories coexist with OmO Native routing.
21. Justice does not directly select model/provider.
22. compatible OmO Native / senpi patch with required capabilities is not rejected solely by patch mismatch.
23. missing required Native host capability is reported accurately.

### Recovery and Native correlation

24. compaction retains plan/task/review correlation.
25. completed work is not re-correlated to another plan after recovery.
26. Justice/Superpowers state conflict is surfaced rather than silently resolved.
27. OmO Native `task_id` is preserved and never replaced with Justice TaskIdentity.
28. a Native task call is recoverably correlated by durable parent-session/tool-call sidecar binding.
29. both-target `category + subagent_type` input is not silently resolved by Justice.
30. missing/ambiguous execution correlation leaves evidence NOT_PROVEN.
31. Requirements change stales Design + Plan chain authority.
32. a substantive Superpowers Ruling can continue execution but cannot authorize acceptance.
33. clause projection with duplicate/missing/ambiguous source becomes INCOMPLETE/INVALID and blocks.
34. the v6.4.2 reviewer receives the Conformance Contract through the same observed Native `task` dispatch.
35. missing/malformed structured review result blocks acceptance.
36. parked Important/Critical remains blocking until trusted later disposition/human quality adjudication.
37. OmO effective config resolution honors user/project + `[native]` + profile precedence without OpenCode profile inference.
38. v4 plan-only authorization is not promoted automatically to v5 artifact-chain authority.
39. v4 review-dispatch state cannot resume or satisfy v5 review gates.
40. unknown/newer persistent schema is preserved and acceptance fails closed.

### Activation and semantic bridge

41. authorized implementation intent activates the selected Superpowers execution method through a Task-1-proven Native skill-system observation (successful selected SKILL.md read or trusted native skill expansion), never an assumed `skill` tool.
42. Justice activation does not take ownership of Superpowers task/review progression.
43. a recognized Superpowers generic Native worker is translated into one Justice semantic category only when its dispatch shape matches the runtime-proven NativeSuperpowersDispatchProfile, while preserving XOR.
44. a non-Superpowers explicit `subagent_type` remains caller-owned and is not translated.
45. Justice semantic classification uses task/review semantics and complexity without selecting a concrete model/provider.
46. OmO remains the only concrete model/provider/runtime resolver for translated Superpowers work.
47. a caller-owned OmO custom category outside Justice's static built-in vocabulary is preserved without translation and remains OmO-resolved.

### Native concurrency

48. two or more same-turn parallel Native task/tool calls completing out of order cannot cross-correlate execution or review evidence.
49. a batched Native task dispatch creates one item-level correlation per zero-based input index and attaches only the matching `items[index]` Native metadata; any unproven/ambiguous index mapping remains NOT_PROVEN.
50. mass-ulw/workflow DAG execution records run/node identity where observable and never derives dependency ordering from callback arrival.

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
12. the trusted FinalReviewEvidenceClosure covers the exact completion candidate without changing Superpowers final-review progression.
13. unresolved semantic drift is zero at `PlanComplete`.
14. unauthorized semantic drift is zero at `PlanComplete`.
15. missing required evidence is zero at `PlanComplete`.
16. blocking quality findings are zero at `PlanComplete`.
17. OmO continuation `task_id` ownership never conflicts with Justice semantic identity.
18. execution/review evidence is bound through durable Native session/tool-call/task correlation rather than wire-payload overloading.
19. ApprovedArtifactChain binds exact Requirements + Design + Plan revisions.
20. normative projection is COMPLETE under a versioned schema before acceptance.
21. Superpowers review interop obtains structured clause evidence without Justice-owned review dispatch.
22. parked/Ruling semantics cannot silently remove blocking quality/conformance state.
23. doctor reports effective OmO Native configuration plus safe agent-state capability instead of a single-file or OpenCode-profile approximation.
24. v4 persistent authority cannot be mistaken for v5 authority after upgrade.
25. same-turn parallel or DAG execution cannot make callback order an evidence identity or dependency-order authority.

---

## 31. Consequence of this design

Justice v5 is not a second Superpowers and not a thin OmO wrapper.

Its stable role is:

> **The semantic nervous system and quality gatekeeper between Superpowers' intended development process and OmO's actual execution. Justice does not think for Superpowers or act for OmO; it ensures that intent is transmitted faithfully, execution remains conformant, and completion is accepted only when positive evidence proves zero unresolved semantic drift.**

This is the architectural boundary future Justice changes must preserve.
