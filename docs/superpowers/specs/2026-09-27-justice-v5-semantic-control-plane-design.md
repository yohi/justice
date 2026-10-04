# Justice v5 Semantic Control Plane Design

**Date:** 2026-09-27
**Status:** DRAFT — awaiting human review
**Authorization:** NOT SELF-AUTHORIZING
**Target:** Justice v5.x
**Baseline:** Justice master @ 080bcdb25b192962789ff5d67139e56487381de4
**Requirements:** `docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md`
**Upstream baselines:** Oh My OpenAgent v5.1.17 (OmO Native), Senpi v2026.10.8, Superpowers v6.4.2

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

- OmO Native v5.1.17 / Senpi v2026.10.8 as the primary runtime harness.
- Superpowers v6.4.2 as a co-loaded Pi package and methodology authority.
- a Native Justice extension adapter that observes/mutates supported Senpi events without taking workflow/runtime ownership.
- an executable Native evidence spike that locks task correlation, skill activation, and reviewer context-delivery seams before production adapter implementation.
- plan-scoped human authorization.
- semantic task/category correlation.
- execution and review provenance.
- task and plan acceptance.
- semantic drift detection and reconciliation gates.
- task-level and final conformance gates.
- evidence-based quality gates.
- compaction/restart recovery.
- capability-based doctor diagnostics.
- migration away from stale v4/OpenCode orchestration responsibilities.

### 2.2 Out of scope

The initial Native-first v5 scope does not include:

- reimplementation of Superpowers SDD/review/fix progression.
- reimplementation of OmO task lifecycle, process/host choice, task revival, retry, model/provider fallback, workpool/team scheduling, or isolation.
- using the OmO OpenCode edition as the architecture authority for Native behavior.
- permanent behavioral compatibility with OmO v4.
- automatic replacement of human plan approval.
- GitHub PR merge/approval automation.

The existing OpenCode adapter may remain as a secondary compatibility surface, but Native semantics are specified independently. OpenCode-specific `chat.message`, `client.session.get`, command-template rewriting, or controller wrappers are never implicit Native contracts.

---

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
| J5D-OWN-01 | Superpowers owns execution-method selection and workflow/review progression; Justice may activate the selected supported methodology but must not duplicate progression. |
| J5D-OWN-02 | OmO owns concrete agent/runtime/model/provider/reasoning/retry/fallback routing. |
| J5D-ACT-01 | Justice keeps methodology MethodSelection separate from Native current-session ActivationEvidence: only audited runtime-observed Superpowers skill loading/invocation may prove activation; cross-session recovery may restore selection but never activation, and unproven compaction survival invalidates activation for acceptance. |
| J5D-GATE-01 | Justice owns fail-closed authorization/evidence/conformance acceptance. |
| J5D-TASK-01 | Superpowers task semantics must be preserved without lossy prompt reconstruction. |
| J5D-CHAIN-01 | Human authorization binds an exact Requirements→Design→Plan artifact chain. |
| J5D-CHAIN-02 | Requirements or Design substantive changes invalidate downstream authority. |
| J5D-RULING-01 | Superpowers Rulings may guide execution but cannot rewrite approved Justice authority. |
| J5D-CORR-01 | OmO Native runtime task identity (`st_...`/task name and task_send target) is runtime state and never Justice TaskIdentity. |
| J5D-CORR-02 | Native execution is correlated by durable Senpi `parentSessionId + parentToolCallId` binding from `tool_call`, extended only with runtime task/child identity proven by the audited Native evidence contract. |
| J5D-ROUTE-01 | Justice obeys OmO Native `category XOR subagent_type`: a Native mapping appendix teaches Superpowers to use the existing `task` tool, Justice may translate only an already-issued recognized Superpowers task call, explicit specialized/caller routing remains caller-owned, and `task_send` continuation remains OmO-owned. |
| J5D-ROUTE-02 | Semantic execution classification is deterministic from structured task/review semantics with precedence final-review > review > architecture > deep > integration > mechanical > implementation; ambiguity never fabricates a category. |
| J5D-CAT-02 | Justice categories are semantic routing inputs only; OmO effective configuration resolves them to concrete runtime/model/provider, and Justice never selects a concrete model/provider. |
| J5D-PROJ-01 | Requirements/Design/Plan normative sources are deterministically enumerable. |
| J5D-PROJ-02 | Projection has COMPLETE/INCOMPLETE/INVALID state; only COMPLETE may pass acceptance. |
| J5D-PROJ-03 | Projection schema/version is bound to artifact-chain and evidence identity. |
| J5D-REVIEW-01 | Justice observes an existing Superpowers review dispatch and never creates a duplicate review. |
| J5D-REVIEW-02 | Native review interop binds an existing Superpowers-originated `tool_call(task)` to exactly one reviewer child/run and delivers the Conformance Contract through a race-free Senpi/OmO Native context seam proven by the runtime evidence spike; uncertainty yields no trusted evidence and Justice never duplicate-dispatches a reviewer. |
| J5D-REVIEW-03 | Trusted review evidence uses versioned structured results; the current Superpowers scoped dispatch supplies exact marker IDs for its current target set, while persisted trusted lineage evidence separately supplies metadata and a lineage-wide reserved finding-ID set so historical identities cannot be reused by new breakage; empty target sets remain valid for clause-only re-proof. |
| J5D-REVIEW-04 | Missing, malformed, stale, wrong-scope, untrusted, identity-inconsistent, diff-failed, or incompletely covered final-review evidence fails closed; failed final-evidence attempts never masquerade as trusted closures. |
| J5D-QUALITY-01 | Critical/Important findings block; Minor is deferred-visible; parked/Ruling is not resolution. |
| J5D-STORAGE-01 | Directly observed structured review results are canonical; insecure file fallback never becomes trusted evidence. |
| J5D-CONFIG-01 | Doctor/config verification uses OmO effective configuration precedence with the `[native]` harness view, not a single config file or legacy `[senpi]` spelling. |
| J5D-PERSIST-01 | v4 durable authority is not auto-promoted to v5 authority; incompatible state fails acceptance closed. |
| J5D-REC-01 | Recovery reconstructs semantic correlation from durable v5 bindings and surfaces state conflicts. |
| J5D-CAT-01 | Justice emits current OmO categories and never canonical legacy `deep`. |
| J5D-DEP-01 | DependencyAnalyzer is not a scheduling authority. |
| J5D-RUNTIME-01 | OmO owns retry/fallback; Justice classifies terminal outcome only. |
| J5D-DOCTOR-01 | Doctor separates source/configured/applied/observed state and reports OmO Native/Senpi task, correlation, Superpowers activation, and reviewer-delivery capabilities independently. |
| J5D-COMPLETE-01 | PlanComplete requires zero unresolved/unauthorized semantic drift, zero missing required evidence, and zero blocking quality findings. |

A registry ID is stable within a Design source revision. Changing the obligation text changes the Design fingerprint and invalidates evidence bound to the prior revision.

### 3.8 Historical regression corpus — Justice v4.3.1

Justice `v4.3.1` is evidence about failure modes, not a source implementation for v5. This section is explanatory: the normative Design surface remains exactly INV-01..INV-06 plus the J5D registry above.

The v4.2.0→v4.3.1 maintenance line established the following reusable lessons:

| Historical evidence | Observed failure mode | Retained v5 design contract | Non-retained implementation detail |
|---|---|---|---|
| `de2ca2a0e2c23ed0a71808b7de246a292c0c00d8`, `54e240ffc5415443dfa5d3dc243945e16d9d2631`, `8c8f8fd400b06d9228ceb7e30ab9c94a2acfcc72` | task meaning, routing ownership, or continuation identity was damaged by lossy reconstruction/normalization | J5D-TASK-01, J5D-CORR-01, J5D-ROUTE-01 | v4 PlanBridge/task-wire normalization |
| `821343eba1223371ae0a7a20e02e7370db900306`, `4759d777aab9c80b897c55392bcc0f5833d79d7b`, `1781c7efae22ac1304fa8dc0d1f621c888943a1e` | review/final-review work was confused with implementation or lost its semantic route | J5D-REVIEW-01, J5D-ROUTE-01/02 | v4 SDD-specific routing hooks |
| `aba390a983fd8eaea791785727aef39599b9d6aa`, `4688a96982355fff87e2d37e1a775b2456c6904f` | the model selected a review-looking executor that was not the intended trusted evidence producer | J5D-REVIEW-01/03/04 | dedicated OpenCode `justice-review-controller`, native TaskTool wrapper, exact OmO v4 envelope parser |
| `19ebb1c5ae9994e8b43a48b5b0ab0a43a6b006de`, `7ad4b6649a492049467d622dbc57d8b7dda94344` | unreadable/stale/mutated scope could otherwise be mistaken for valid review completion | J5D-CHAIN-01/02, J5D-REVIEW-04 | v4 Gate ID/session maps and OpenCode-specific cancellation path |
| `96d088398680c6ec04f65f809384e8d6fe6d5c80`, `faae0834c0c3e7bc2adb90cbf7de9cac36506dca`, `bef5f3437d8f3827ea13cdab06267740360a0ca9` | review-clear was able to drift toward implementation continuation unless authorization was separately enforced | J5D-GATE-01, J5D-CHAIN-01/02 | v4 session-scoped implementation lock mechanics |
| `05277cfdffb16ec135ea13ce1b4e978228e35a3a`, `7ad4b6649a492049467d622dbc57d8b7dda94344` | remediation needs fresh evidence, but Justice-owned retry progression conflates assurance with methodology/runtime ownership | J5D-OWN-01/02, J5D-REVIEW-03/04, J5D-RUNTIME-01 | Justice-owned auto-retry/remediation loop |
| `7f88e28c620ff74568691bedb88f93a1e723a1be`, `ac548a1a61eeb726f5bfe53c77ea6bab22a5300d` | operators benefit from an escape hatch that returns to the underlying harness without reviving stale Justice state | no new normative J5D contract in this baseline | adapter-specific enable/disable implementation; reconsider per target harness |
| `eea681d879ee848ba57ac51a69284392b9834544`, `368632bddda72f83fb36e58b50dd30df5fbe7e72` | OpenCode slash-command visibility/execution semantics differed from LLM assumptions | no cross-harness contract | OpenCode command discovery, `@path`, prompt-template rewriting |

The short-lived bootstrap-bound Gate from `efec7a3ec5e0ae38b1b3f09e44112526ea97ee77` was superseded by later v4 work that made the Gate an explicit standalone authority boundary. The bootstrap dependency therefore must not be revived as a v5 invariant.

The design rule extracted from the corpus is:

> Port **proof obligations and failure invariants**, not v4 harness mechanics.

In particular, a future harness adapter may establish trusted review provenance differently, but model inference alone never upgrades an ambiguous review-like action into trusted evidence; a clean review never creates human authorization; and remediation can only contribute fresh evidence without transferring Superpowers/OmO progression ownership to Justice.

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

Justice correlates independently evolving semantic and runtime records:

- approved artifact/TaskIdentity;
- Superpowers workflow/task/reviewer intent;
- Senpi parent session + tool call;
- OmO Native runtime task/child identity;
- review/evidence artifacts.

### 7.1 Semantic TaskIdentity

TaskIdentity remains artifact-chain/plan/task-semantic identity and MUST NOT depend on a runtime task id or mutable array index.

### 7.2 OmO Native runtime identity ownership — J5D-CORR-01

OmO Native background task ids such as `st_...`, session-local task names, process/in-process execution mode, and `task_send(to=...)` continuation targets are runtime state.

Justice never encodes semantic TaskIdentity into those values and never rewrites them to control runtime continuation.

### 7.3 Canonical Native sidecar binding — J5D-CORR-02

The primary execution-call key is:

```text
ExecutionCallKey
= parentSessionId + parentToolCallId
```

with:

```text
parentSessionId = ctx.sessionManager.getSessionId()
parentToolCallId = tool_call.toolCallId
```

Senpi v2026.10.8 guarantees that `tool_call` runs before execution and that `event.input` is mutable in place. Justice persists the semantic binding before trusting later execution evidence.

```text
ExecutionCorrelation
├─ authorizationId
├─ artifactChainId
├─ planIdentity
├─ taskIdentity
├─ executionMethod
├─ parentSessionId
├─ parentToolCallId
├─ omoTaskId?
├─ childSessionId?
├─ dispatchRevision
└─ status
```

`omoTaskId` / `childSessionId` are attached only through the exact runtime-observed surface established by the Native evidence spike. The Design does not fabricate an OpenCode-style child lookup API.

Nested/codemode-issued calls expose `parentToolCallId`; the initial compatibility profile supports them only if Task 1 proves an unambiguous correlation contract.

Lifecycle:

```text
tool_call(task)
  → persist pending semantic correlation
  → optionally mutate the same task input for semantic routing

tool_result(task) / audited OmO task lifecycle
  → attach runtime task identity and child identity if proven

bound child context + structured result
  → produce trusted evidence

session_start/restart
  → recover durable Justice binding
```

Missing/ambiguous binding may remain fail-open for execution but is `NOT_PROVEN` for acceptance.

### 7.4 Native task routing — J5D-ROUTE-01 / J5D-ROUTE-02

New child calls obey:

```text
task(prompt, exactly one of category | subagent_type)
```

Routing is provenance-aware:

- explicit non-Superpowers `category` / `subagent_type` stays caller-owned;
- custom category names are open and preserved;
- explicitly specialized named agents remain caller-owned unless a compatibility profile explicitly maps that role;
- Superpowers v6.4.2's Pi bootstrap does not define OmO's task tool, so Justice contributes only a Native tool-mapping appendix that tells the active workflow to express a subagent/reviewer dispatch through the existing OmO `task` tool;
- the model still issues that `task` call; Justice does not dispatch it;
- for a recognized Superpowers call, Justice classifies semantics and mutates that same `tool_call.event.input` to exactly one Justice `sp-*` category when appropriate;
- ambiguous provenance/classification does not fabricate routing.

Deterministic review mapping remains:

```text
task/scoped review → review       → sp-review
final review       → final-review → sp-final-review
```

Native continuation is `task_send(to=<task id or name>)`; it is not passed through new-child category translation.

### 7.5 Native Superpowers provenance — J5D-ROUTE-01

Trusted Superpowers provenance is a runtime evidence product, not a prompt classification.

Task 1 produces an audited `NativeSuperpowersProvenanceProfile` for the pinned stack:

```text
NativeSuperpowersProvenanceProfile
├─ profileId
├─ sourceKind
├─ requiredObservedFields[]
├─ parentSessionBinding
├─ parentToolCallBinding
├─ workflowMethodBinding
├─ restartCompactionValidity
└─ rejectionRules[]
```

Task 6 is the sole runtime producer. It applies the proven profile to one observed Native `tool_call(task)` and produces:

```text
NativeSuperpowersProvenanceEvidence
├─ profileId
├─ parentSessionId
├─ parentToolCallId
├─ role
├─ sourceEvidenceRefs[]
└─ observedAt
```

The resolver result is:

```text
superpowers(evidence)
external
ambiguous(reasons)
```

False-positive prevention is normative:

- prompt wording, task body similarity, review-looking text, method activation alone, and mapping-appendix presence alone are insufficient;
- unrelated model-issued `task` calls must resolve to `external`;
- missing/conflicting required observations resolve to `ambiguous`;
- restart/compaction may reuse provenance only when the Task-1 profile explicitly proves the binding survives that boundary;
- Tasks 7 and 10 consume the result but do not re-infer provenance.

If Task 1 cannot prove an authoritative source/binding, Native semantic translation and trusted Native review evidence are blocked for artifact reconciliation.

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

A **versioned Superpowers ReviewDispatchProfile** classifies review kind only after Native Superpowers origin is trusted.

The trust boundary is two-stage:

```text
Task 1 NativeSuperpowersProvenanceProfile
        ↓
Task 6 NativeSuperpowersProvenanceResolver
        ↓
trusted TaskRoutingProvenance(superpowers)
        ↓
Task 7 ReviewDispatchProfile classifies task-review | scoped-re-review | final-review
```

The ReviewDispatchProfile may use active execution method/workflow phase, exact parent session/tool call, current Superpowers review-template structure, concrete brief/report/base/head/diff references, and active artifact-chain/task identity to determine **review kind**. Those signals MUST NOT independently manufacture Superpowers origin.

Prompt wording, review-looking text, template similarity, or active-method state without Task 6 trusted provenance remain untrusted. Task review, scoped re-review, and final review have distinct profiles. Ambiguous review-kind classification may continue runtime execution but cannot produce Justice-trusted review evidence.

### 14.2 Native Conformance Contract delivery — J5D-REVIEW-02

The old OpenCode delivery path (`tool.execute.before → child chat.message → client.session.get`) is historical adapter behavior, not a Native invariant.

The primary Native parent observation seam is Senpi v2026.10.8 `tool_call`:

```text
event.toolName == "task"
event.toolCallId
event.input                 # mutable in place
ctx.sessionManager.getSessionId()
```

The primary Native child/context capabilities available for evaluation include `before_agent_start`, `context`, session lifecycle events, and OmO's own task lifecycle/state surfaces.

Because source-level capability does not by itself prove child binding or event ordering, **Task 1 is an architecture-closing runtime evidence spike**. Before Task 6/7 production adapter work begins, the spike must select and prove one exact delivery contract that satisfies:

1. the parent Superpowers review task call is observed before execution;
2. one parent session/tool-call pair binds to exactly one reviewer child/run;
3. unrelated children cannot consume the pending review appendix;
4. the Conformance Contract reaches the bound reviewer before trusted reviewer output is produced;
5. no asynchronous discovery race is required for correctness;
6. task/process mode differences do not silently alter identity semantics;
7. missing/ambiguous/transport-failed binding produces no trusted result and therefore `NOT_PROVEN`;
8. Justice does not create a second reviewer.

The implementation plan may use `tool_result(task)`, OmO task state, child `before_agent_start`, child `context`, or another public v5.1.17/v2026.10.8 surface **only if the spike demonstrates it** and records the exact observed fields/order.

If the spike cannot prove a supported contract, implementation stops for artifact reconciliation. Justice must not revive the v4/OpenCode `justice-review-controller`, native TaskTool indirection, synchronous v4 envelope parser, or a duplicate reviewer as fallback.

The delivered appendix still carries the same semantic payload:

- review correlation id;
- artifact-chain id;
- task identity when applicable;
- reviewed range/candidate revision;
- immutable Conformance Contract path/digest;
- strict structured-result instructions.

Routing translation and appendix delivery remain separate concerns: routing may mutate the existing parent `task` call; child delivery never selects a concrete model/provider/runtime.

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

## 20. Native methodology activation and controller state

Justice v5 separates:

1. Superpowers package/bootstrap availability;
2. selected execution method;
3. method-specific current-session activation evidence;
4. OmO Native worker/runtime routing.

Legacy Sisyphus/Atlas/OpenCode controller mappings are compatibility history only.

### 20.1 Supported execution-method activation — J5D-ACT-01

Method selection remains:

```text
explicit current selection
→ trusted recovered selection for same authorization
→ method_selection_required
```

The Native Superpowers package itself injects `using-superpowers` via its Pi `context` handler. Justice coexists with that bootstrap; bootstrap presence proves Superpowers availability but does not by itself prove that `subagent-driven-development` or `executing-plans` was loaded.

Method-specific activation uses runtime-observed Native skill evidence. Task 1 must lock the exact accepted channels. The compatibility profile may accept only channels that prove the skill content was actually loaded, such as:

```text
successful read tool_result
  path → trusted installed Superpowers skills/<method>/SKILL.md

or

host-expanded /skill:<method> input
  → <skill name="<method>">...
  when event/source authenticity is proven
```

A model assertion, extension-injected text, child-only `load_skills`, runtime task id, or mere package presence is not activation evidence.

Trusted evidence binds:

```text
authorizationId
sessionId
method
evidenceKind
observedCallOrInputId
observedAt
```

For this baseline:

```text
evidenceKind
= read_tool_result
| host_expanded_skill_input
```

Task 1 must prove at least one member end-to-end. Task 10 consumes only the proven member(s); any third channel is an architecture change requiring artifact reconciliation.

Cross-session recovery restores selection only. Same-session activation may survive restart only with exact identity/evidence validation.

Superpowers resets its bootstrap on `session_compact`. Until Task 1 proves method-specific skill activation survives compaction without reloading, compaction invalidates method ActivationEvidence for acceptance and the selected method must be observed again.

Decision state:

```text
no selection                         → method_selection_required
valid current-session activation     → already_active
selected + proven activation channel → needs_activation
missing/ambiguous channel            → unavailable / NOT_PROVEN
```

Justice may request the supported Native skill-loading action, but it never advances Superpowers task/review/fix progression itself.

---

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
- architect;
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

For the supported Native profile:

```text
Superpowers semantic worker/reviewer intent
        ↓
model-issued OmO Native task(...)
        ↓
Justice semantic execution class / sp-* category
        ↓
OmO Native effective category configuration
        ↓
actual agent/model/provider/reasoning/execution-mode/retry/fallback
```

Justice never writes a concrete model/provider into category-routed task translation. Superpowers Pi's lack of an OmO-specific subagent tool mapping is handled by the Native mapping appendix; it is not permission for Justice to schedule a worker itself.

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

If Justice retains error patterns, they must be synchronized to the OmO v5.1.17 / Senpi v2026.10.8 runtime behavior rather than stale OpenCode/v4 assumptions. Task lifecycle recovery, host reattach, provider retry, and fallback remain OmO/Senpi responsibilities.

---

## 24. Configuration contract — J5D-CONFIG-01

Justice treats the OmO v5.1.17 effective `omo.json[c]` resolution as configured-state authority.

### 24.1 File-layer precedence

The resolver follows the documented OmO loader order:

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

The home directory is not double-counted. Invalid/unreadable/malformed values remain diagnostics rather than silently fabricated configuration.

### 24.2 Native effective-view resolution

After file merge:

```text
shared base
→ [native]
→ selected profile base
→ selected profile [native]
```

Canonical profile selection follows the audited current loader. `[senpi]` is legacy/deprecation input and is not emitted as canonical Justice documentation.

### 24.3 Doctor representation

Doctor separates:

```text
source layers + diagnostics
        ↓
effective Native configured value
        ↓
runtime applied value (if authoritatively observable)
        ↓
observed execution value
```

Legacy `oh-my-opencode.json[c]`, `oh-my-openagent.json[c]`, and historical `~/.omo/config.jsonc` are migration-only inputs.

---

## 25. Doctor and compatibility model

`justice doctor` answers whether the Native semantic-control-plane proof obligations can operate in the current environment.

Primary checks include:

- OmO Native version and Senpi engine/API metadata;
- Justice Senpi extension registration;
- Native `task`, `task_send`, and category/subagent XOR behavior;
- `tool_call` mutable-input, `toolCallId`, and current-session observation;
- Task-1-proven runtime task/child correlation capability;
- Task-1-proven reviewer context-delivery capability;
- Superpowers Pi package/bootstrap and skill-resource availability;
- method-specific activation evidence capability;
- effective `[native]` configuration and category availability;
- persistence/review-evidence capability;
- secondary OpenCode adapter status separately when present.

Compatibility is capability-first. A newer OmO/Senpi patch may remain supported when the required seams remain intact; a nominally expected version missing a required proof seam is unsupported.

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

The treatment below applies to the full historical `v4.3.1` regression corpus. v4 source code is not an implementation predecessor for v5: only the harness-independent contracts identified in §3.8 are carried forward.

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
17. an older full final review alone cannot complete a post-fix candidate; the single Superpowers scoped final re-review may extend trusted coverage only when affected clauses are re-proven and unaffected clause scopes are deterministically non-intersecting.
18. all required clauses SATISFIED and no blocking quality findings → completion permitted.

### Routing and compatibility

19. Justice does not emit canonical `deep`.
20. custom `sp-*` categories coexist with OmO v5 routing.
21. Justice does not directly select model/provider.
22. compatible OmO Native/Senpi patch with required capabilities is not rejected solely by patch mismatch.
23. missing required host capability is reported accurately.

### Recovery

24. compaction retains plan/task/review correlation.
25. completed work is not re-correlated to another plan after recovery.
26. Justice/Superpowers state conflict is surfaced rather than silently resolved.
27. OmO Native runtime task id/name and `task_send` continuation target remain runtime-owned and are never replaced with Justice TaskIdentity.
28. a Native `tool_call(task)` is recoverably correlated by durable parent-session/parent-tool-call sidecar binding and the Task-1-proven runtime child binding.
29. both-target `category + subagent_type` input is not silently resolved by Justice.
30. missing/ambiguous execution correlation leaves evidence NOT_PROVEN.
31. Requirements change stales Design + Plan chain authority.
32. a substantive Superpowers Ruling can continue execution but cannot authorize acceptance.
33. clause projection with duplicate/missing/ambiguous source becomes INCOMPLETE/INVALID and blocks.
34. the v6.4.2 reviewer receives the Conformance Contract through the Task-1-proven Native child/context delivery path without duplicate dispatch.
35. missing/malformed structured review result blocks acceptance.
36. parked Important/Critical remains blocking until trusted later disposition/human quality adjudication.
37. OmO effective config resolution honors user/project plus harness/profile precedence.
38. v4 plan-only authorization is not promoted automatically to v5 artifact-chain authority.
39. v4 review-dispatch state cannot resume or satisfy v5 review gates.
40. unknown/newer persistent schema is preserved and acceptance fails closed.

### Activation and semantic bridge

41. authorized implementation intent produces runtime-observed Native activation evidence for the selected Superpowers execution method; unproven compaction survival requires fresh activation.
42. Justice activation does not take ownership of Superpowers task/review progression.
43. a recognized Superpowers Native worker intent becomes one model-issued OmO `task` call whose existing input is translated to one Justice semantic category while preserving XOR.
44. a non-Superpowers explicit `subagent_type` remains caller-owned and is not translated.
45. Justice semantic classification uses task/review semantics and complexity without selecting a concrete model/provider.
46. OmO remains the only concrete model/provider/runtime resolver for translated Superpowers work.
47. a caller-owned OmO custom category outside Justice's static built-in vocabulary is preserved without translation and remains OmO-resolved.

### Historical v4.3.1 regression closure

48. an acceptance-critical review-like action with ambiguous/model-inferred producer provenance remains untrusted and cannot satisfy review evidence.
49. review evidence whose bound artifact chain, scope, or reviewed revision changes before acceptance becomes stale and cannot authorize the current candidate.
50. a clean/complete review result cannot create implementation authorization without the required explicit human approval for the exact current artifact chain.
51. remediation/re-review can contribute fresh evidence, but Justice does not schedule the fix/re-review loop and does not take ownership of OmO retry/fallback.

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
12. the trusted FinalReviewEvidenceClosure covers the exact completion candidate without changing Superpowers final-review progression.
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
