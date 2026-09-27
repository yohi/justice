# Justice v5 Requirements

**Date:** 2026-09-27  
**Status:** Requirements baseline for v5 design  
**Authorization:** NOT SELF-AUTHORIZING  
**Target:** Justice v5.x  
**Upstream baselines:** Oh My OpenAgent v5.0.1 (OpenCode edition), Superpowers v6.4.2

---

## 1. Purpose

Justice v5 must realign Justice with current OmO and Superpowers while preserving Justice's core role as the **Semantic Control Plane** between them.

The system boundary is:

```text
Superpowers
  methodology / desired workflow state
          ↓
Justice
  semantic correlation / observation
  evidence / gates / acceptance
          ↓
OmO
  runtime / task execution
  model / provider / fallback
```

Justice's responsibility is:

> Maintain semantic consistency between Superpowers Desired State and OmO Actual Execution, and prove that consistency from evidence.

Justice must act as the **nervous system and quality gatekeeper** between Superpowers' “brain” and OmO's “limbs”.

---

## 2. Primary completion requirement

Justice v5 must prevent completion while any substantive mismatch remains between:

- Requirements;
- Design / Spec;
- Implementation Plan;
- source implementation;
- tests / verification.

The target completion invariant is:

```text
unresolved semantic drift == 0
unauthorized semantic drift == 0
missing required evidence == 0
blocking quality findings == 0
```

“Zero drift” means zero unresolved, unexplained, or unauthorized difference that changes normative behavior or contract. It does not require textual identity between artifacts.

---

## 3. Compatibility scope

### JUS5-COMP-01

Primary supported integration:

- Justice v5;
- OmO >= v5.0.1 OpenCode edition compatible contract;
- Superpowers >= v6.4.2 compatible contract;
- OpenCode host satisfying required capabilities.

### JUS5-COMP-02

Justice must identify, where observable:

- Justice version;
- OpenCode version;
- OmO version/edition;
- Superpowers version/contract.

### JUS5-COMP-03

OpenCode support must not be based solely on exact patch equality. Required host capabilities must be checked.

### JUS5-COMP-04

OmO v4 and obsolete Superpowers behavioral compatibility are not mandatory for v5.

---

## 4. Harness scope

### JUS5-HARNESS-01

Justice v5 remains primarily an OpenCode plugin.

### JUS5-HARNESS-02

Direct OmO Native / Senpi integration is out of initial v5 scope and must be treated as a separate harness adapter if added later.

---

## 5. Ownership invariants

### JUS5-OWN-01 — Superpowers

Superpowers is the Source of Truth for:

- brainstorming;
- specification workflow;
- writing plans;
- execution-method selection;
- SDD task progression;
- task-review progression;
- fix/re-review progression;
- final whole-branch review;
- completion methodology.

Justice must not reimplement these workflows.

### JUS5-OWN-02 — OmO

OmO is the Source of Truth for:

- agent runtime;
- task execution;
- category-to-runtime resolution;
- model selection;
- provider selection;
- retry/fallback;
- tool execution.

Justice must not directly choose model/provider/fallback behavior.

### JUS5-OWN-03 — Justice

Justice owns:

- plan-scoped authorization;
- semantic category correlation;
- execution observation;
- provenance;
- evidence;
- gate evaluation;
- drift detection;
- task acceptance;
- plan completion;
- workflow integrity diagnostics.

---

## 6. Fail-open / fail-closed boundary

### JUS5-GATE-01

Runtime execution may remain fail-open for optional Justice telemetry/enrichment failures where safe.

### JUS5-GATE-02

Acceptance must be fail-closed.

If required evidence cannot be proven, Justice must not project:

- Authorized;
- Accepted;
- Verified;
- Complete.

Unknown or missing proof is blocking.

---

## 7. Configuration

### JUS5-CONFIG-01

The authority for **configured state** is the OmO v5 **effective configuration resolution**, not any single `omo.jsonc` file.

### JUS5-CONFIG-02

Legacy `oh-my-opencode.jsonc` / `oh-my-openagent.jsonc` may be detected as migration inputs but must not be documented as current primary configuration.

### JUS5-CONFIG-03

When filesystem resolution is required, Justice must reproduce the OmO v5 layer order:

1. user layer: `~/.omo/omo.jsonc`, falling back to `~/.omo/omo.json`;
2. project layers: `.omo/omo.jsonc`, falling back to `.omo/omo.json`, from the farthest ancestor to the nearest project directory;
3. the nearest project layer has the highest file-layer precedence;
4. the home directory is not double-counted as a project layer.

### JUS5-CONFIG-04

After file-layer merge, Justice must account for the OmO v5 effective-view order for the OpenCode harness:

```text
shared base
→ [opencode]
→ selected profile base
→ selected profile [opencode]
```

Profile selection and loader diagnostics are part of configured-state interpretation.

### JUS5-CONFIG-05

If OmO exposes a compatible effective-config API, Justice should use that as configured-state authority. If not, Justice may inspect files only by following the same precedence/resolution semantics and must report the source layers and diagnostics used.

---

## 8. Categories and routing

### JUS5-CAT-01

Justice must align with current OmO OpenCode built-in categories, including:

- visual-engineering;
- ultrabrain;
- deep-low;
- deep-high;
- artistry;
- quick;
- unspecified-low;
- unspecified-high;
- writing.

### JUS5-CAT-02

Justice must not emit legacy `deep` as a new canonical category. Legacy input may normalize to `deep-low`.

### JUS5-CAT-03

Justice custom categories remain supported:

- sp-mechanical;
- sp-implementation;
- sp-integration;
- sp-deep;
- sp-architecture;
- sp-review;
- sp-final-review.

### JUS5-CAT-04

Category-to-model/provider mapping remains OmO configuration responsibility.

### JUS5-CTRL-01

Justice must recognize at least:

- brainstorming;
- writing-plans;
- subagent-driven-development;
- executing-plans.

### JUS5-CTRL-02

The old Sisyphus/Atlas mapping must be revalidated against current OmO OpenCode behavior and must not be treated as timeless truth.

### JUS5-CTRL-03

Desired, configured, applied, and observed controller state must remain distinct. If actual application cannot be authoritatively observed, Justice must report Unverified.

---

## 9. Plan and task semantics

### JUS5-PLAN-01

Current Superpowers plan default path is `docs/superpowers/plans/YYYY-MM-DD-<name>.md`.

### JUS5-PLAN-02

A Design/Spec artifact under `docs/superpowers/specs/` is not by itself proof that `writing-plans` completed.

### JUS5-PLAN-03

Legacy completion heuristics based on headings such as `Architecture` + `Implementation` must not be authoritative.

### JUS5-PLAN-04

Justice must preserve normative task semantics beyond checkbox text, including where present:

- Files;
- Interfaces;
- Consumes / Produces;
- signatures;
- exact values;
- tests/assertions;
- verification;
- Global Constraints.

### JUS5-PLAN-05

Justice must not replace a Superpowers full task brief with a lossy title + checkbox reconstruction.

---

## 10. Authorization and artifact lineage

### JUS5-AUTH-01

Authorization remains plan-scoped and human-controlled.

### JUS5-AUTH-02

Authorization must durably bind the exact approved Requirements → Design → Plan chain, not only the Plan.

The semantic binding must include at least:

- authorization identity;
- artifact-chain identity;
- Requirements identity/path, revision, and fingerprint;
- Design identity/path, revision, and fingerprint;
- Plan identity/path, fingerprint, and canonical snapshot;
- fingerprint/projection schema versions;
- approval time;
- status.

### JUS5-AUTH-03

Checkbox progress-only changes must not invalidate authorization.

### JUS5-AUTH-04

Substantive changes must invalidate authorization, including changes to:

- task scope/title;
- Files;
- Interfaces;
- signatures;
- exact requirements;
- assertions/tests;
- verification;
- Global Constraints;
- normative task body.

### JUS5-AUTH-05

A substantive Design change invalidates downstream Plan authority until the Plan is reconciled and human-approved again.

### JUS5-AUTH-06

AI review, PR creation, or PR merge must not silently substitute for explicit human plan authorization.

### JUS5-AUTH-07

A substantive Requirements change invalidates the bound Design and all downstream Plan authority until:

```text
Requirements reconciliation
→ Design reconciliation
→ Plan reconciliation
→ explicit human approval
→ new artifact-chain authorization
```

### JUS5-AUTH-08

A substantive Design change invalidates the bound Plan and requires Plan reconciliation, explicit human approval, and a new artifact-chain authorization before affected acceptance may resume.

### JUS5-AUTH-09

A Superpowers `Ruling:` may guide workflow execution but does not rewrite Justice authority.

- a non-substantive Ruling may be recorded as execution context without invalidating the chain;
- a Ruling that changes a normative Requirements/Design/Plan obligation may allow Superpowers execution to continue, but Justice acceptance remains blocked;
- substantive Rulings require artifact reconciliation and the human re-approval required by JUS5-AUTH-07/JUS5-AUTH-08;
- a Ruling alone must never convert a `VIOLATED` or `NOT_PROVEN` clause into `SATISFIED`.

---

## 11. Superpowers execution ownership

### JUS5-SDD-01

For SDD, Superpowers owns:

- task selection;
- fresh implementer lifecycle;
- task reviewer dispatch;
- fix round;
- scoped re-review;
- review round policy;
- next-task progression;
- final whole-branch review.

### JUS5-SDD-02

Justice must observe, correlate, verify, and gate these actions rather than duplicate them.

### JUS5-SDD-03

Justice must not duplicate-dispatch task/final reviewers because an implementation completes.

### JUS5-SDD-04

Justice must not add independent parallel task scheduling that overrides Superpowers.

### JUS5-INLINE-01

`executing-plans` must be treated according to its own current contract.

### JUS5-INLINE-02

Justice must not require a per-task fresh reviewer when Superpowers does not require one.

---

## 12. Delegation boundary and execution correlation

### JUS5-TASK-01

The original Superpowers task brief remains normative.

### JUS5-TASK-02

Justice may enrich delegation with correlation and conformance metadata but must preserve the original brief.

### JUS5-TASK-03

Justice must not force worker payload fields that seize OmO routing authority, including:

- model;
- provider;
- reasoning;
- variant;
- fallback models.

### JUS5-TASK-04

Justice may enforce its semantic category boundary where compatible with the current OmO task contract.

### JUS5-CORR-01 — OmO task_id ownership

Justice semantic `TaskIdentity` MUST NOT be encoded into OmO `task_id`.

OmO `task_id` remains exclusively owned by OmO as its continuation-session identifier (`ses_...`). Justice must preserve a legitimate incoming OmO `task_id` unchanged.

### JUS5-CORR-02 — Canonical execution-call key

Justice's canonical runtime correlation key is:

```text
parentSessionId + parentCallId
```

observed from the OpenCode tool-execution hook. Justice binds its semantic identities to that runtime call in durable `.justice/` sidecar state rather than overloading OmO tool arguments.

### JUS5-CORR-03 — ExecutionCorrelation binding

The durable execution binding must semantically contain at least:

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

Exact persistence layout is an implementation detail; these identity relationships are not.

### JUS5-CORR-04 — Correlation lifecycle

The supported lifecycle is:

```text
PreToolUse(task)
  → bind authorized semantic task to (parentSessionId, parentCallId)

PostToolUse/task metadata and session-created/session-updated observation
  → attach the observed childSessionId when available

PostToolUse / review / verification
  → resolve the evidence subject through the durable binding

Recovery
  → rebuild correlation from durable sidecar state, not ephemeral maps
```

A persistence/correlation failure may remain fail-open for runtime execution but must leave the affected evidence `NOT_PROVEN`.

### JUS5-CORR-05 — Continuations

When a legitimate OmO `task_id=ses_...` continuation is present:

- Justice must not replace or reinterpret it;
- Justice may associate it with an already-observed child-session relation only when that relation is already trusted;
- an unverified continuation-session identifier is runtime metadata, not proof of Justice task identity.

### JUS5-CORR-06 — category / subagent_type boundary

Justice follows the OmO public XOR contract and must not create a payload containing both `category` and `subagent_type`.

- explicit `subagent_type`: preserve it; do not add/replace it with a Justice category;
- explicit `category`: preserve/validate the category; do not add `subagent_type`;
- neither target on a non-continuation worker call: Justice may supply a semantic category only when the current authorized workflow and classifier provide an authoritative category decision;
- both targets supplied by a caller: Justice must not choose between them as routing authority; record a routing-contract violation and do not treat that call as trusted acceptance evidence;
- continuation calls: do not inject a semantic category merely to satisfy a new-task target contract.

Justice does not rely on OmO's defensive runtime normalization of an invalid both-target payload.

---

## 13. State ownership

### JUS5-STATE-01

`.superpowers/sdd/<plan>/progress.md` is Superpowers-owned workflow state.

### JUS5-STATE-02

`.justice/` is Justice-owned semantic control/evidence state.

### JUS5-STATE-03

Justice must not replace the Superpowers ledger.

### JUS5-STATE-04

A Superpowers “complete” claim is not sufficient proof for Justice acceptance; evidence must still satisfy Justice gates.

---

## 14. Review and provenance

### JUS5-REV-01

Justice must not depend on obsolete reviewer personas such as legacy spec-reviewer/code-quality-reviewer contracts.

### JUS5-REV-02

Justice must distinguish at least:

- task review;
- scoped re-review;
- final review.

### JUS5-REV-03

Current task review semantics must preserve at least:

- Spec Compliance;
- Critical / Important / Minor findings;
- Approved / Needs fixes.

### JUS5-REV-04

Scoped re-review must preserve:

- ADDRESSED;
- NOT ADDRESSED;
- new breakage;
- out-of-scope observations.

### JUS5-REV-05

Review text alone is not authoritative. Trusted evidence requires task/revision/workflow provenance.

### JUS5-REV-06 — Review detection

Justice must not dispatch reviews. A review becomes trusted only when a versioned Superpowers review-dispatch profile recognizes the already-dispatched reviewer and correlates it with:

- execution method;
- review kind;
- artifact chain;
- task identity when applicable;
- parent session/call;
- observed child session where available;
- implementation base/head or equivalent reviewed revision range.

Ambiguous classification is untrusted and fail-closed for acceptance.

### JUS5-REV-07 — Conformance Contract delivery

For a supported Superpowers review that is required to produce semantic conformance evidence, Justice must use the existing OpenCode `tool.execute.before` task-call extension point to enrich that same reviewer prompt with a read-only Justice Conformance Contract reference and structured-result instructions.

Justice must not create another reviewer dispatch.

If a future supported host cannot provide an equivalent safe extension point, semantic conformance review on that host is unsupported until a focused compatibility spike proves one.

### JUS5-REV-08 — Structured review result

Trusted semantic review evidence must carry a versioned result containing at least:

- review correlation identity;
- review kind;
- artifact-chain identity;
- task identity where applicable;
- reviewed revision/range;
- quality verdict/findings;
- clause results containing `clauseId`, `SATISFIED | VIOLATED | NOT_PROVEN`, and supporting evidence/reference.

### JUS5-REV-09 — Invalid review evidence

The following must not satisfy review/conformance gates:

- missing structured result;
- malformed result;
- stale reviewed revision;
- wrong artifact chain;
- wrong task/plan;
- untrusted provenance;
- missing required clause result.

Required missing clause results become `NOT_PROVEN`.

### JUS5-REV-10 — Quality severity and parked findings

Justice v5 canonical quality severity is:

```text
critical | important | minor
```

Legacy Justice `major` may be read only as historical/migration input and normalizes to `important`; it is not the v5 canonical vocabulary.

Gate semantics:

- open `critical` or `important` findings are blocking;
- `minor` findings do not block task progression but must remain visible and be included in final review;
- a Superpowers parked finding or `Ruling:` is not a resolution;
- a parked critical/important finding remains Justice-blocking until a later trusted review explicitly clears/resolves it or an explicit human review-resolution artifact adjudicates it;
- a human quality adjudication cannot satisfy a normative conformance clause that remains `VIOLATED` or `NOT_PROVEN`;
- the final review must explicitly disposition carried minor/parked findings; any finding still critical/important at final completion blocks `PlanComplete`.

### JUS5-REV-11 — Evidence storage capability

Directly observed structured reviewer output, correlated by the trusted execution binding, may be persisted as Justice evidence without requiring Linux-native review-artifact reservation.

When Justice imports or hands off file-based review artifacts, an untrusted/plain-file fallback must never be promoted to trusted evidence merely because secure reservation is unavailable.

Doctor must report the secure review-artifact capability. If a required evidence path depends on unavailable secure storage and no directly observed trusted result exists, acceptance is fail-closed.

---

## 15. Semantic conformance and drift

### JUS5-CONFORM-01

Final completion must have zero unresolved semantic drift between Requirements, Design, Plan, Code, and Tests.

### JUS5-CONFORM-02

Working code and passing tests do not authorize a Plan/Design mismatch.

### JUS5-CONFORM-03

A Plan that contradicts Design is blocking.

### JUS5-CONFORM-04

If implementation discovers that an approved artifact must change, acceptance stops and the authoritative artifact must be reconciled first.

### JUS5-CONFORM-05

Substantive reconciliation follows:

```text
drift detected
→ affected acceptance blocked
→ authoritative artifact updated
→ downstream artifacts reconciled
→ human re-approval where required
→ new fingerprint/authorization
→ resume
```

### JUS5-CONFORM-06

Justice must have task-level conformance gating where the execution method provides the necessary evidence, and a mandatory final cross-artifact conformance gate for every supported execution method.

### JUS5-CONFORM-07

Required normative clauses must end as:

- SATISFIED;
- VIOLATED;
- NOT_PROVEN.

`VIOLATED` and `NOT_PROVEN` both block acceptance for required clauses.

### JUS5-CONFORM-08

Final Conformance must cover at least:

- Requirements ↔ Design;
- Design ↔ Plan;
- Plan ↔ Code;
- Design ↔ Code;
- Plan ↔ Tests;
- Requirements ↔ Verification;
- reviewed revision ↔ completion candidate revision.

### JUS5-CONFORM-09

A final review of an older revision is not proof for a newer candidate tree.

### JUS5-PROJ-01 — Canonical normative sources

Normative Clause Projection must use deterministic source identities.

**Requirements:** every `JUS5-*` requirement block is canonical. A block's prose obligation is clause suffix `/0`; each ordered bullet/list item that states an independent obligation receives deterministic suffix `/1`, `/2`, ... within that source revision. Source revision/fingerprint is part of evidence identity, so a changed list invalidates prior clause evidence.

**Design:** the canonical design source is the explicit normative Design Contract Registry (`INV-*` plus `J5D-*` IDs). Free prose is explanatory unless incorporated by a registered contract.

**Plan:** projection must deterministically enumerate the current Superpowers v6 plan's normative structural units, including at least:

- Goal;
- Architecture;
- Tech Stack constraints;
- Global Constraints;
- each Task's Files;
- Interfaces / Consumes / Produces;
- exact signatures;
- exact values;
- test assertions;
- expected verification results.

The Plan's `Spec` reference identifies the bound Design artifact rather than creating a duplicate normative clause.

### JUS5-PROJ-02 — Projection completeness state

Every Conformance Contract has:

```text
projectionStatus =
  COMPLETE
  | INCOMPLETE
  | INVALID
```

Only `COMPLETE` contracts may contribute to acceptance.

At minimum, the following are fail-closed:

- duplicate clause IDs;
- missing required source artifact;
- ambiguous source anchor;
- unsupported or structurally ambiguous Plan format;
- parser/projection failure;
- source fingerprint/revision mismatch;
- a normative structural unit that cannot be mapped to exactly one canonical clause identity.

### JUS5-PROJ-03 — Projection schema version

The projection schema/version must be durable and included in the approved artifact chain, Conformance Contract, and resulting clause evidence. Evidence produced under an incompatible projection schema must not satisfy current acceptance.

---

## 16. Quality

### JUS5-QUALITY-01

Quality and conformance are separate gate dimensions.

### JUS5-QUALITY-02

High-quality code that violates approved artifacts must be blocked.

### JUS5-QUALITY-03

Conformant code with unresolved blocking quality findings must also be blocked.

---

## 17. Acceptance

### JUS5-ACC-01

Worker success alone must not create TaskAccepted.

### JUS5-ACC-02

SDD TaskAccepted requires:

- valid authorization;
- matching task execution;
- required verification;
- required review lifecycle;
- no unresolved blocking findings;
- all required conformance clauses SATISFIED.

### JUS5-ACC-03

Round-cap/deferred findings must not be disguised as clean review.

### JUS5-ACC-04

Inline execution must use execution-method-specific gates rather than an SDD-only reviewer requirement.

### JUS5-COMPLETE-01

PlanComplete requires:

- all required task acceptance conditions;
- required final review;
- final conformance;
- final quality gates;
- zero unresolved/unauthorized semantic drift;
- zero missing required evidence.

---

## 18. Dependency ownership

### JUS5-DEP-01

Justice-specific `(depends: task-N)` syntax is not a current Superpowers scheduling authority.

### JUS5-DEP-02

Superpowers owns execution order.

### JUS5-DEP-03

If DependencyAnalyzer remains, it is advisory/diagnostic/correlation-only.

---

## 19. Runtime failures

### JUS5-ERR-01

Justice must not compete with OmO retry/fallback orchestration.

### JUS5-ERR-02

Justice classifies terminal runtime failure for evidence/diagnostic impact.

### JUS5-ERR-03

Any retained provider-error patterns must be resynchronized to the current OmO v5 model-core baseline.

---

## 20. Doctor

### JUS5-DOC-01

`justice doctor` must diagnose at least:

- host capabilities;
- Justice plugin registration;
- required command availability;
- controller configuration where observable;
- custom categories;
- Superpowers availability where observable;
- current configuration source;
- legacy configuration.

### JUS5-DOC-02

Configured and runtime-applied state must not be conflated.

### JUS5-DOC-03

Exact OpenCode patch mismatch alone must not define unsupported status.

### JUS5-DOC-04

Unknown authority must be reported as unknown/unverified rather than guessed.

---

## 21. Recovery

### JUS5-REC-01

After compaction/restart/continuation Justice must recover:

- active authorization;
- artifact lineage;
- plan/task identity;
- review correlation;
- acceptance state.

### JUS5-REC-02

Justice must not cause already completed Superpowers tasks to be re-dispatched.

### JUS5-REC-03

Justice/Superpowers state conflict must be surfaced, not silently overwritten.

### JUS5-PERSIST-01 — v5 state schema

Every v5 authoritative persistent record must carry or be governed by an explicit v5-compatible schema version. The exact file split is an implementation detail.

### JUS5-PERSIST-02 — v4 authorization

A v4 plan-only authorization must not be automatically promoted to a v5 Requirements→Design→Plan artifact-chain authorization. Human reconciliation/re-approval is required before it can authorize v5 acceptance.

### JUS5-PERSIST-03 — v4 review state

v4 Justice-owned review-dispatch/scheduling records are historical only. They must not schedule v5 reviews and must not satisfy v5 review or conformance gates.

### JUS5-PERSIST-04 — v4 observations/evidence

v4 raw observations may be retained/imported as historical or untrusted input, but evidence lacking v5 artifact-chain, correlation, projection-schema, and clause identities must not satisfy v5 acceptance.

### JUS5-PERSIST-05 — migration failure / unknown schema

Unknown, newer, malformed, or unsuccessfully migrated authoritative state must:

- remain preserved rather than silently overwritten or downgraded;
- produce an explicit diagnostic;
- leave affected v5 acceptance fail-closed;
- never fabricate missing Requirements/Design lineage.

Runtime execution may remain fail-open when safe.

---

## 22. justice_review

### JUS5-REVIEW-01

`justice_review` is a control-plane inspection interface.

It must explain:

- current authorization state;
- task acceptance state;
- missing evidence;
- unresolved drift;
- blocking findings;
- authoritative artifact/revision;
- whether human re-approval is required.

It must not act as a hidden duplicate review scheduler.

---

## 23. Required acceptance scenarios

Justice v5 is acceptable only if E2E evidence proves at least:

1. checkbox-only Plan updates preserve authorization.
2. substantive Plan contract changes invalidate authorization.
3. substantive Design changes invalidate downstream Plan authority.
4. SDD review is observed without duplicate Justice reviewer dispatch.
5. Needs fixes → fix → scoped re-review can reach acceptance.
6. NOT ADDRESSED remains blocking.
7. executing-plans is not rejected solely for lacking per-task fresh reviewer.
8. Plan/Code interface mismatch blocks task acceptance.
9. Design/Plan mismatch blocks downstream authorization.
10. implementation-discovered design change requires artifact reconciliation before resume.
11. passing tests cannot override approved-contract drift.
12. omitted required conformance proof becomes NOT_PROVEN and blocks.
13. review of stale revision cannot authorize current completion candidate.
14. custom sp-* categories coexist with OmO v5.
15. canonical `deep` is not emitted.
16. Justice does not directly choose model/provider.
17. capability-compatible OpenCode patch is not rejected solely for version mismatch.
18. compaction preserves correlation and does not reuse stale evidence.
19. final completion has zero unresolved/unauthorized semantic drift.
20. final completion has zero missing required evidence and zero blocking quality findings.
