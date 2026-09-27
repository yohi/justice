# Justice v5 Semantic Control Plane Design

**Date:** 2026-09-27  
**Status:** DRAFT — awaiting human review  
**Authorization:** NOT SELF-AUTHORIZING  
**Target:** Justice v5.x  
**Baseline:** Justice master @ 080bcdb25b192962789ff5d67139e56487381de4  
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

### 5.1 Approved artifact chain

Justice treats the current authoritative chain as:

```text
Requirements revision
        ↓
Design revision
        ↓
Implementation Plan revision
        ↓
Task execution against approved plan revision
```

Each substantive artifact revision has identity and lineage.

Conceptually:

```text
ArtifactRevision
├─ artifactType
├─ artifactIdentity
├─ fingerprint
├─ previousFingerprint
├─ changeClass
├─ sourceRevision
├─ approvalState
└─ observedAt
```

The exact storage schema is an implementation-plan decision, but the lineage semantics are mandatory.

### 5.2 Plan authorization

Plan authorization remains plan-scoped, not task-scoped.

Authorization must durably correlate at least:

- authorization identity;
- session identity where applicable;
- plan path;
- plan fingerprint;
- canonical snapshot;
- fingerprint schema version;
- approval timestamp;
- authorization status.

Checkbox progress changes do not invalidate authorization.

Substantive plan changes do invalidate authorization, including changes to:

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

After invalidation, execution may remain fail-open where technically unavoidable, but no new affected task acceptance may occur until reconciliation and human re-approval.

### 5.3 Design changes invalidate downstream authority

If a substantive Design/Spec change occurs after a Plan was approved:

```text
Design revision changed
    ↓
existing Plan becomes stale
    ↓
Plan reconciliation required
    ↓
human approval required
    ↓
new Plan authorization
```

Justice MUST NOT allow a previously approved plan fingerprint to authorize implementation against a semantically changed design.

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

## 7. Task identity and correlation

Justice must correlate four independently evolving records:

- approved plan/task;
- Superpowers ledger entry;
- OmO/OpenCode execution;
- review/evidence artifacts.

Task identity MUST NOT depend only on a mutable array index.

The identity model must combine stable plan scope with task semantics, conceptually:

```text
TaskIdentity
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

---

## 12. Early drift prevention

Drift is checked at task boundaries, not only at final completion.

For each task:

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

This prevents late discovery of drift accumulated over multiple tasks.

---

## 13. Drift classification and mandatory reconciliation

Justice distinguishes:

### 13.1 Non-semantic drift

Examples:

- formatting;
- checkbox state;
- import ordering;
- comments;
- wording changes that do not alter normative meaning;
- internal implementation detail outside any normative contract.

This does not invalidate authorization.

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

### 14.1 Superpowers owns review orchestration

For subagent-driven-development, Superpowers owns:

```text
implementation
→ task review
→ fix
→ scoped re-review
→ final whole-branch review
```

Justice v5 MUST NOT dispatch duplicate task/final reviewers merely because an implementation event completed.

### 14.2 Justice owns review proof

Justice correlates at least:

```text
ReviewEvidence
├─ plan identity
├─ task identity
├─ execution method
├─ review kind
├─ implementation revision/range
├─ reviewer execution
├─ review artifact
├─ review round
├─ provenance
└─ outcome
```

Review kinds include:

- task-review;
- scoped-re-review;
- final-review.

### 14.3 Current reviewer semantics

Justice understands the current Superpowers task-review semantics sufficiently to distinguish:

- Spec Compliance;
- Critical / Important / Minor findings;
- Task quality: Approved / Needs fixes.

Scoped re-review must preserve the distinction between:

- ADDRESSED;
- NOT ADDRESSED;
- new breakage;
- out-of-scope observation.

A round cap or parked finding MUST NOT be rewritten as “clean”.

---

## 15. Conformance evidence generation without Justice-owned orchestration

Semantic conformance cannot be guaranteed by string comparison alone. Justice therefore separates:

1. **deterministic evidence**, and
2. **semantic reviewer evidence**.

Deterministic evidence includes:

- artifact fingerprints;
- revision/range identity;
- exact signatures/values where machine-checkable;
- test execution and exit result;
- file presence/absence;
- task/review correlation.

Semantic evidence is produced within the existing Superpowers-owned review lifecycle.

Justice may enrich the reviewer task with a read-only Conformance Contract and require a structured clause-by-clause result. This does not make Justice the review orchestrator:

- Superpowers still decides when review runs;
- OmO still executes the reviewer;
- Justice supplies the acceptance contract and consumes evidence.

The required semantic-review output must allow Justice to correlate each normative clause to:

- SATISFIED;
- VIOLATED;
- NOT_PROVEN;
- supporting evidence/reference.

Justice MUST treat incomplete structured output as NOT_PROVEN for the missing required clauses.

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

## 24. Configuration contract

For OmO v5, `omo.jsonc` is the current configuration source of truth.

Justice documentation and remediation MUST NOT present:

- `oh-my-opencode.jsonc`;
- `oh-my-openagent.jsonc`

as current primary configuration files.

Legacy files may be detected and reported as migration inputs.

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

## 26. Recovery and compaction

After compaction/restart/continuation, Justice must recover at least:

- active plan authorization;
- artifact lineage;
- plan/task identity;
- review correlation;
- acceptance state.

Justice must also consult Superpowers workflow state sufficiently to avoid re-accepting or mis-correlating stale work.

Conflicts between Justice state and Superpowers ledger must be surfaced; neither side is silently overwritten.

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

---

## 31. Consequence of this design

Justice v5 is not a second Superpowers and not a thin OmO wrapper.

Its stable role is:

> **The semantic nervous system and quality gatekeeper between Superpowers' intended development process and OmO's actual execution. Justice does not think for Superpowers or act for OmO; it ensures that intent is transmitted faithfully, execution remains conformant, and completion is accepted only when positive evidence proves zero unresolved semantic drift.**

This is the architectural boundary future Justice changes must preserve.
