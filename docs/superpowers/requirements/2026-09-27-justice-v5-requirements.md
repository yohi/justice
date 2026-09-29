# Justice v5 Requirements

**Date:** 2026-09-27
**Status:** Requirements baseline for v5 design — revised for OmO Native
**Authorization:** NOT SELF-AUTHORIZING
**Target:** Justice v5.x
**Revised:** 2026-09-30
**Upstream baselines:** Oh My OpenAgent v5.1.x (OmO Native / senpi engine), Superpowers v6.4.2

---

## 1. Purpose

Justice v5 must realign Justice with current OmO and Superpowers while preserving Justice's core role as the **Semantic Control Plane** between them.

The system boundary is:

```text
User / authorized implementation intent
          ↓
Justice activation bridge
          ↓
Superpowers
  WHAT: methodology / execution-method selection / workflow progression
          ↓ semantic execution intent
Justice
  SEMANTIC HOW: execution classification / category translation
  correlation / evidence / gates / acceptance
          ↓ semantic category
OmO
  CONCRETE HOW: agent/runtime / model / provider / retry / fallback
```

Justice's responsibility is:

> Activate the supported Superpowers methodology selected by authoritative intent, translate Superpowers semantic execution intent into an OmO-facing semantic category, and prove that the resulting execution remains consistent with the approved artifact chain.

Justice must act as the **nervous system and quality gatekeeper** between Superpowers' “brain” and OmO's “limbs”. Superpowers does not need to know OmO categories, and OmO does not need to know Superpowers methodology semantics.

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
- Oh My OpenAgent >= v5.1.x using **OmO Native** on the senpi engine;
- Superpowers >= v6.4.2 compatible contract;
- a senpi host exposing the required ExtensionAPI, task lifecycle, and session capabilities.

### JUS5-COMP-02

Justice must identify, where observable:

- Justice version;
- OmO Native version;
- senpi engine/runtime version or compatible capability surface;
- Superpowers version/contract.

### JUS5-COMP-03

OmO Native / senpi support must be **capability-first**. Exact patch equality alone is neither sufficient nor required. Justice must verify the event, task, session, persistence, and review-interop capabilities on which trusted evidence depends.

### JUS5-COMP-04

The OpenCode plugin edition is a legacy/secondary compatibility target for Justice v5. It must not define the primary v5 acceptance contract, runtime adapter, configuration authority, or review-delivery mechanism.

OmO v4 and obsolete Superpowers behavioral compatibility remain non-mandatory for v5.

---

## 4. Harness scope

### JUS5-HARNESS-01

Justice v5 primarily targets **OmO Native**, integrated through a senpi/Pi extension adapter over the runtime-neutral Justice core.

### JUS5-HARNESS-02

The OpenCode plugin adapter, if retained, is secondary compatibility code only. It must sit behind the same runtime-neutral semantic contracts and must not force OpenCode-specific hook, session, or configuration semantics into the Justice domain model.

### JUS5-HARNESS-03

The Native adapter must support both ordinary delegated tasks and Native concurrency surfaces, including:

- multiple tool calls executed in parallel within one model turn;
- background Native tasks;
- batched task creation where exposed by the task tool;
- mass-ulw / workflow DAG execution where observable.

Parallel completion order must never be used as semantic ordering authority.

### JUS5-HARNESS-04 — Native contract evidence spike and production authorization boundary

The pinned Superpowers / OmO Native compatibility run is an **architecture evidence spike**, not a production implementation gate that can self-authorize downstream source work.

The spike may establish or invalidate architecture-critical facts including the actual Native dispatch tool/target, review call shape, activation channels, batch-index behavior, and Superpowers model-field behavior. Therefore:

```text
Fresh Review Gate approving the evidence-spike Plan
→ Task 1 evidence spike only
→ PASS/FAIL evidence receipt
→ Requirements / Design / Plan reconciliation using the measured facts
→ Fresh Review Gate + required human approval of the reconciled artifact chain
→ only then Production Tasks 2–14
```

A Task 1 PASS MUST NOT directly authorize Production Task 2. A Task 1 result that changes or fills an architecture-critical compatibility value is not production authority until the three authoritative artifacts contain that value and the reconciled chain is reviewed/approved.

### JUS5-HARNESS-05 — production compatibility-profile authority

After the evidence spike is reconciled, the production Native compatibility profile MUST be a versioned **built-in Justice contract** with one explicit producer. Runtime discovery, ambient machine state, user config, and test fixtures MUST NOT become production authority for the Superpowers→OmO compatibility shape.

The reconciled artifacts must fix at least:

```text
upstream Superpowers SHA
upstream OmO SHA / senpi package version
actual dispatch tool surface
generic target kind/value
review dispatch target
review prompt field
activation channel(s)
batch index contract
Superpowers model-field policy
```

If any required value remains unknown, Production Tasks 2–14 remain unauthorized.

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

- the supported Superpowers methodology activation bridge;
- semantic execution classification;
- provenance-aware Superpowers intent → OmO category translation;
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

The authority for **configured state** is the OmO v5.1.x effective configuration resolution for the **Native** harness, not any single file and not any OpenCode profile directory.

### JUS5-CONFIG-02

The canonical user configuration root is:

- `~/.omo/omo.jsonc`, falling back to `~/.omo/omo.json`.

Project layers are:

- `.omo/omo.jsonc`, falling back to `.omo/omo.json`, merged from the farthest ancestor to the nearest project directory.

Legacy `oh-my-opencode.jsonc` / `oh-my-openagent.jsonc` may be recognized as migration inputs but are not current configured-state authority.

### JUS5-CONFIG-03

When filesystem resolution is required, Justice must reproduce the OmO loader semantics:

1. user layer;
2. project layers from farthest ancestor to nearest;
3. nearest project layer has the highest file-layer precedence;
4. home directory is not double-counted as a project layer;
5. unreadable/invalid/skipped layers remain visible as diagnostics rather than fabricated configuration.

### JUS5-CONFIG-04

After file-layer merge, the OmO Native configured view resolves:

```text
shared base
→ [native]
→ selected profile base
→ selected profile [native]
```

Native profile selection must come from an explicit Justice/OmO profile input or OmO's Native profile authority such as `OMO_PROFILE`. Justice must not discover a Native profile by scanning `~/.config/opencode` or an OpenCode profile directory.

### JUS5-CONFIG-05

OmO Native agent-state files under the effective agent directory are separate runtime authorities from `omo.jsonc`.

The effective agent directory is the Native runtime-selected agent directory (normally `~/.omo/agent`, or the directory selected by `OMO_CODING_AGENT_DIR` when applicable). Justice may inspect safe projections of at least:

- `settings.json`;
- `auth.json`;
- `models.json`;

when those files are required to explain configured/applied capability. Secret material from `auth.json` must never be copied into Justice evidence, logs, diagnostics, or user-facing output.

### JUS5-CONFIG-06

If OmO Native exposes a compatible effective-config or runtime-state API, Justice should prefer that authoritative view. Otherwise Justice may reproduce the same resolution semantics locally, while recording source layers, Native harness selection, agent directory, and diagnostics used.

## 8. Categories and routing

### JUS5-CAT-01

Justice must align with the current OmO category vocabulary exposed to the Native task runtime, including:

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

Justice distinguishes two category namespaces:

- `SpCategory`: the closed Justice-generated semantic category union (`sp-*`);
- caller-owned OmO category names: an open non-empty string namespace that may include OmO built-ins or user-defined categories from effective `omo.jsonc`.

The static current built-in category list is compatibility/diagnostic vocabulary only. It is not the complete authority for caller-owned OmO category names.

### JUS5-CAT-05 — provenance-aware Superpowers routing translation

Justice must distinguish caller provenance before applying the OmO target/model contracts.

- a non-Superpowers caller's explicit `subagent_type` remains caller-owned and is preserved;
- an explicit caller `category` is accepted as a caller-owned non-empty OmO category name and preserved byte-for-byte; Justice must not reject or translate it merely because it is outside Justice's static built-in category vocabulary;
- an external/caller-owned concrete `model` remains caller-owned and is never removed merely to make Justice category translation possible;
- a recognized Superpowers new-worker dispatch is eligible for Justice semantic translation only when it matches a versioned **NativeSuperpowersDispatchProfile** fixed in the reconciled Requirements / Design / Plan after the Task 1 evidence spike;
- that profile records the actual Native tool surface and exact generic target encoding produced by the supported integration. Justice MUST NOT assume an OpenCode V1 encoding such as `subagent_type="general"` is also the Native encoding;
- model handling is part of the same profile. The profile model policy is either `absent` or a measured Superpowers-only `semantic_hint` for the `model` field;
- `semantic_hint` is legal only when the evidence spike proves that the field is compatibility capability/role intent rather than an authoritative concrete-model requirement and proves that removing it before category translation preserves the supported integration semantics;
- if a profile-recognized Superpowers model value is authoritative concrete-model intent, the category-translation profile is unsupported. Justice MUST NOT discard that intent;
- for a supported profile-recognized generic dispatch, Justice removes only the profile-defined generic marker and, only for `semantic_hint`, the profile-defined Superpowers model hint before emitting exactly one authoritative Justice semantic category;
- the translated category payload MUST pass the pinned OmO Native task target validator; trusted translation can never leave `category + model` together;
- a recognized Superpowers explicit specialized non-generic target remains an explicit specialized route and is preserved without Justice category replacement;
- if the supported runtime does not expose a stable, profile-proven generic dispatch that Justice can translate in place, the compatibility capability is unavailable/untrusted; Justice must not fabricate a `task` call or synthetic generic marker;
- an OmO Native task lifecycle/control call (`task_send`, `task_output`, `task_cancel`, or equivalent) remains Native-owned and must not receive a newly selected worker category;
- an ambiguous/untrusted Superpowers provenance or a dispatch shape/model policy that does not match the active NativeSuperpowersDispatchProfile must not be translated as trusted semantic routing.

Final wire payloads must still satisfy both OmO constraints: category/subagent_type XOR and category/model incompatibility.

### JUS5-CAT-06 — semantic execution classes

Justice classifies recognized Superpowers work into exactly one semantic execution class when sufficient authoritative task/review semantics exist:

- `mechanical`: bounded, repetitive or deterministic work with a small change surface, no architecture judgment, and no cross-component state coordination;
- `implementation`: ordinary feature implementation with bounded component responsibility and normal coding judgment;
- `integration`: multi-component/module/interface coordination, migration, or state/concurrency/async/data-flow interaction across boundaries;
- `deep`: substantial investigation, root-cause research, unknown behavior, or high reasoning ambiguity that is not itself an architecture decision;
- `architecture`: component/public-interface boundary, persistent-state ownership, protocol responsibility, security boundary, or another major architectural decision;
- `review`: Superpowers task review or scoped re-review;
- `final-review`: Superpowers whole-branch/final review.

The semantic class maps deterministically to the matching Justice `sp-*` category.

### JUS5-CAT-07 — semantic precedence and inputs

When more than one semantic signal applies, precedence is:

```text
final-review
> review
> architecture
> deep
> integration
> mechanical
> implementation
```

Classification must consume structured Plan/review semantics where available, including:

- task heading and full task body;
- Files;
- Interfaces / Consumes / Produces;
- signatures / exact values;
- test and verification surface;
- cross-task dependencies;
- explicit review kind;
- architecture/security/persistent-state obligations.

Keywords may be supporting signals but must never be the sole authority for a higher semantic class.

### JUS5-CAT-08 — ambiguous semantic classification

If a recognized Superpowers new-worker dispatch cannot be classified authoritatively because required semantic context is missing, conflicting, or ambiguous, Justice must not fabricate an `sp-*` category.

The runtime call may remain on its original generic path only under the existing fail-open execution policy, but the routing result is untrusted and cannot satisfy required acceptance evidence.

Justice must not choose a concrete model/provider as an ambiguity fallback.

### JUS5-CAT-09 — review, runtime, and model-field mapping

For a **reconciled and Fresh-Review-approved** Superpowers v6.4.2 / OmO Native compatibility profile:

```text
task/scoped reviewer      → review       → sp-review
whole-branch final review → final-review → sp-final-review
implementation worker     → classifier   → sp-mechanical | sp-implementation |
                                         sp-integration | sp-deep | sp-architecture
```

Justice category is the semantic routing signal delivered to OmO. OmO effective configuration remains the authority that resolves that category to the actual agent/model/provider/reasoning/fallback behavior.

The production profile must carry an explicit model policy:

```text
absent
  → the profile-recognized generic Superpowers dispatch has no model override;
    category translation leaves no model field.

semantic_hint(field=model, removeBeforeCategoryTranslation=true)
  → Task 1 measured a Superpowers-owned model field whose supported compatibility
    meaning is semantic capability/role intent;
  → Justice removes that profile-defined hint together with the profile-defined
    generic target before setting category=sp-*;
  → OmO then resolves the concrete model from category configuration.
```

This exception applies **only** to a profile-recognized Superpowers generic dispatch. External/caller-owned concrete model choices remain untouched. Provider/reasoning/fallback fields remain caller/runtime-owned unless a future separately reviewed profile contract explicitly proves otherwise.

If Task 1 observes a Superpowers model field that cannot be safely classified as a removable semantic hint, the Native category-translation profile is unsupported and requires Design reconciliation; Justice must not silently choose between Superpowers concrete-model intent and OmO category routing.

The final translated profile-generic payload must be accepted by the pinned OmO Native target validator and therefore can never contain both `category` and `model`.

### JUS5-CTRL-01

Justice must recognize at least:

- brainstorming;
- writing-plans;
- subagent-driven-development;
- executing-plans.

### JUS5-CTRL-02

The old Sisyphus/Atlas mapping must be revalidated against current OmO Native behavior and must not be treated as timeless truth.

### JUS5-CTRL-03

Desired, configured, applied, and observed controller state must remain distinct. If actual application cannot be authoritatively observed, Justice must report Unverified.

### JUS5-ACT-01 — Superpowers methodology activation bridge

Justice must bridge an authoritative implementation-method selection into activation of exactly one supported Superpowers execution method:

- `subagent-driven-development`;
- `executing-plans`.

Justice owns the activation bridge, not methodology selection or internal workflow progression. Once the selected Superpowers skill is active for the current controller session, Superpowers remains authoritative for task/review/fix/final progression.

### JUS5-ACT-02 — method selection is distinct from activation

Justice must represent these as separate states:

```text
MethodSelection
= which supported Superpowers methodology is selected

ActivationEvidence
= proof that the selected methodology was successfully activated
  in the current controller session
```

The authoritative selection source order is:

1. explicit user/command selection for the current implementation start;
2. trusted recovered **method selection** from the same active authorization;
3. otherwise `method_selection_required`.

No additional pre-activation method-observation source exists. Native skill-system activation evidence is distinct from selection: observing a matching skill read or trusted Native skill expansion never retroactively selects the methodology.

An explicit inline selection maps to `executing-plans`; an explicit SDD selection maps to `subagent-driven-development`. Justice must not infer a default from task shape or capability.


### JUS5-ACT-03 — current-session activation evidence and recovery

For the OmO Native / senpi harness, Justice MUST NOT assume the existence of a Claude Code/OpenCode-style `skill` tool. Superpowers v6.4.2 on Pi uses the host's native skill system. The supported Native activation proof is therefore a successful, current-session observation of the selected Superpowers skill through one of the profile-proven Native channels:

1. **successful skill read** — a successful senpi `tool_result` for `read` whose canonical path resolves to the selected method's `skills/<method>/SKILL.md` under the resource-discovered Superpowers skill root; or
2. **trusted Native skill input** — a current-session, non-extension input event containing the host-expanded `<skill name="<method>" ...>` form produced by native `/skill:<method>` handling. A raw `/skill:<method>` token may be accepted only on a host surface that exposes it before expansion and is covered by the same runtime regression profile.

Extension-injected text, skill pointers/reminders, a mere mention of the skill name, `load_skills` on a child task, or the `using-superpowers` bootstrap do not prove activation of the selected execution method.

The runtime regression gate must prove which of these observation channels are actually available and which senpi event fields provide their stable identity. Justice must fail closed rather than inventing an observation shape.

Trusted activation evidence binds at least:

```text
authorizationId
sessionId
method
activationKind       # skill_read | native_skill_input
activationSourceRef  # stable Native call/input identity captured by the adapter
observedAt
```

For `skill_read`, the evidence also records the canonical SKILL.md path and the matching read `toolCallId`. A `read` call without a successful result is observation only and cannot prove activation.

An exact same-session persisted activation record may be reused after restart only when `authorizationId + sessionId + method` all match.
Justice persists one current method-selection record per authorization and one current activation record per `authorizationId + sessionId`. A new explicit selection replaces the prior selection record for that authorization; a later successful matching Native skill-system activation replaces the prior activation record for that authorization/session.

Activation evidence is acceptance-trusted only after durable persistence succeeds. Persistence/read/schema failure must not produce `already_active`; the affected methodology evidence is `NOT_PROVEN` until valid state is re-established.

Cross-session recovery may recover **method selection** from trusted prior Justice execution state for the same authorization, but it never proves current-session activation:

```text
prior session selected/used method
→ recovered method selection
→ current session needs_activation
→ fresh profile-proven Native skill-system activation
→ current-session ActivationEvidence
```

OmO child-task recovery, task resumption, or DAG resumption is never Superpowers methodology activation.

### JUS5-ACT-04 — activation decisions, conflicts, and failure

After method selection:

- matching current-session ActivationEvidence → `already_active`; Justice must not request duplicate skill invocation;
- no matching current-session evidence + a profile-proven Native skill activation channel available → `needs_activation`; request activation of exactly the selected method through that Native skill system without fabricating a `skill` tool call;
- no profile-proven activation channel, or a required SDD subagent capability missing → `unavailable`;
- no selection → `method_selection_required`.

Conflict policy is exact:

- an explicit current selection is authoritative over stale recovered selection; if existing current-session activation evidence is for another method, it is not reused and the explicit method requires fresh activation;
- without an explicit current selection, a recovered selection that conflicts with current-session activation evidence is `conflict` / untrusted and must not be silently precedence-resolved;
- activation evidence with mismatched authorization or session identity is untrusted and cannot prove activation.

If activation is unavailable, conflicting, or not proven:

- Justice must not silently bypass Superpowers by treating direct OmO implementation as authorized methodology execution;
- runtime may remain fail-open only where the existing runtime policy permits;
- affected implementation/review evidence remains `NOT_PROVEN`;
- TaskAccepted / PlanComplete remain blocked until valid current-session activation evidence exists.
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

Justice may activate the selected supported Superpowers execution method, then must observe, classify, translate, correlate, verify, and gate its actions rather than duplicate Superpowers progression.

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

Justice must enforce its semantic category boundary for recognized Superpowers new-worker dispatches when authoritative classification exists, while preserving non-Superpowers explicit routing and Native task-engine ownership.

### JUS5-CORR-01 — OmO Native task_id ownership

Justice semantic `TaskIdentity` MUST NOT be encoded into OmO Native `task_id`.

A Native `task_id` is owned by the OmO task engine for spawned-task lifecycle/control and recovery. Justice preserves every legitimate observed `task_id` unchanged and records it only as runtime identity.

### JUS5-CORR-02 — Canonical execution-call and work-item keys

The Native parent-call identity is:

```text
ExecutionCallKey = parentSessionId + parentToolCallId
```

where `parentSessionId` comes from the senpi extension session context and `parentToolCallId` is the stable `toolCallId` on the observed Native `task` call.

That identity names the **call container**, not necessarily one semantic execution. The canonical correlation key is item-aware:

```text
single task:
  parentSessionId + parentToolCallId + itemKind=single

batched task:
  parentSessionId + parentToolCallId + itemKind=batch + batchItemIndex
```

`batchItemIndex` is the zero-based input item position and is mandatory for every batch correlation. The supported runtime regression must prove that the Native result `items[index]` preserves that same item ordering before Justice trusts the mapping. One batched tool call therefore owns one durable `ExecutionCorrelation` per item, never one correlation shared by the whole batch.

Justice binds semantic identities to these item-level keys in durable `.justice/` sidecar state rather than overloading OmO task arguments.

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
├─ parentCallId        # Native toolCallId
├─ itemKind            # single | batch
├─ batchItemIndex?     # REQUIRED iff itemKind=batch
├─ omoTaskId?
├─ childSessionId?
├─ dagRunId?
├─ dagNodeId?
├─ dispatchRevision
└─ status
```

Exact persistence layout is an implementation detail. `omoTaskId`, child/session identity, and DAG provenance are attached only when authoritatively observable. For a batch, a top-level aggregate/first-item `task_id` must never be copied onto every item; each `items[index].task_id` is attached only to the matching item-level correlation.

### JUS5-CORR-04 — Native correlation lifecycle

The supported lifecycle is:

```text
senpi tool_call(task)
  → resolve the authorized semantic work item(s)
  → single: bind one PENDING correlation for (session, call, single)
  → batch: bind one PENDING correlation per input item index
  → persist before task execution is trusted

matching tool_result(task)
  → single: attach the call's Native task_id/result metadata
  → batch: attach items[index].task_id/result metadata to the same batchItemIndex
  → corroborate child/session/DAG metadata from trusted TaskRecord/task lifecycle when available

review / verification / completion
  → resolve evidence through the exact item-level durable binding

recovery
  → rebuild correlation from durable Justice sidecar + trusted Native task metadata,
    not ephemeral maps, top-level batch aliases, or event arrival order
```

A persistence/correlation failure may remain fail-open for runtime execution but must leave the affected evidence `NOT_PROVEN`.

### JUS5-CORR-05 — Native task lifecycle/control calls

For `task_send`, `task_output`, `task_cancel`, background completion, process-child recovery, or equivalent Native task control:

- Justice must not replace or reinterpret the OmO `task_id`;
- Justice must not create a new semantic TaskIdentity merely because a lifecycle/control call is observed;
- Justice may associate a lifecycle event with an existing semantic execution only when the Native task identity is already trusted and resolves to exactly one item-level correlation;
- an unverified Native task identifier is runtime metadata, not proof of Justice task identity.

### JUS5-CORR-06 — category / subagent_type boundary

Justice follows the OmO Native `task` XOR contract and must not create a new-worker payload containing both `category` and `subagent_type`.

The boundary is provenance- and profile-aware:

- **non-Superpowers explicit `subagent_type`**: preserve it; do not add/replace it with a Justice category;
- **explicit `category`**: preserve a non-empty caller-owned OmO category byte-for-byte; do not require membership in Justice's static built-in union;
- **recognized Superpowers generic Native worker**: translate only when its target exactly matches the generic encoding proven by the active `NativeSuperpowersDispatchProfile`; remove only that profile-defined generic marker and emit the authoritative Justice semantic category from JUS5-CAT-06..09;
- **recognized specialized non-generic target**: preserve it and do not add a Justice category;
- **profile-proven recognized new worker with no explicit target**: Justice may emit the same authoritative semantic category only when the runtime regression defines that shape as the supported generic dispatch;
- **both targets from an external/ambiguous caller**: do not choose between them; record a routing-contract violation and mark the call untrusted;
- **Native lifecycle/control call**: do not inject a new worker category;
- **dispatch shape mismatch, ambiguous/untrusted Superpowers recognition, or ambiguous semantic classification**: do not fabricate a category; affected evidence remains untrusted/`NOT_PROVEN`.

Justice does not rely on defensive runtime normalization of an invalid both-target payload and does not inherit OpenCode V1 mappings into the Native profile.

### JUS5-CORR-07 — parallel, batch, and DAG observation

OmO Native may execute multiple tool calls from one model turn concurrently, one `task({tasks:[...]})` call may spawn multiple work items, and mass-ulw/workflow may execute a DAG with parallel-ready nodes.

Justice therefore must:

- correlate every observation by stable identities (`sessionId + toolCallId + itemKind/batchItemIndex`, plus Native `task_id`/DAG identity when available);
- never infer parentage, task order, review order, or dependency order from callback completion order;
- create and preserve one independently attributable correlation per batch item;
- attach `dagRunId + dagNodeId` only as runtime-owned provenance to the exact already-identified work item and reject conflicting node bindings;
- preserve fail-closed acceptance whenever Native metadata is insufficient to disambiguate a parallel, batch, or DAG execution.

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


### JUS5-REV-07 — Conformance Contract delivery on OmO Native

Justice uses the **existing Superpowers reviewer dispatch**. It does not create another reviewer and does not require an OpenCode child-message hook.

For the OmO Native / senpi harness, the authoritative delivery path is:

1. Superpowers issues the existing Native `task` reviewer call;
2. senpi `tool_call` observes that exact call before task execution, with stable `toolCallId` and current parent session identity;
3. Justice recognizes the review kind and creates `PendingReviewCorrelation(parentSessionId + toolCallId)`;
4. if the supported Superpowers generic routing encoding is present, Justice translates it on the **same** `event.input` to `sp-review` or `sp-final-review` while preserving category/subagent_type XOR;
5. Justice appends one deterministic, sentinel-delimited Conformance Contract appendix to the existing `event.input.prompt` **in place**;
6. the original Superpowers prompt remains intact as the prefix; Justice does not reconstruct the prompt and does not create another `task` call;
7. matching `tool_result` plus trusted OmO Native TaskRecord/task-lifecycle metadata bind the resulting `task_id` and child/session metadata where available;
8. review output/result is attributed through that durable correlation.

Appendix injection is trusted only when:

- the event is a recognized review on the Native `task` surface;
- `event.input.prompt` is an unambiguous string;
- the same `sessionId + toolCallId` owns the pending correlation;
- the appendix sentinel is absent before injection, so reinvocation cannot duplicate the contract;
- the correlation is durably persisted.

Missing/malformed prompt, duplicate/conflicting sentinel, ambiguous review provenance, or persistence failure means no trusted appendix and required semantic review evidence remains `NOT_PROVEN`. Runtime execution may remain fail-open where safe.

For parallel CodeMode execution, callback order is not authority: review correlation is keyed by stable call identity. For mass-ulw/workflow execution, DAG/run/node metadata may enrich provenance when observable but never substitutes for the review correlation.

Justice must preserve external/caller-owned concrete model/provider/reasoning/fallback choices. For a profile-recognized Superpowers generic dispatch only, the reconciled NativeSuperpowersDispatchProfile may additionally remove the exact Superpowers `model` field when—and only when—its model policy is the Task-1-proven `semantic_hint` policy from JUS5-CAT-05/JUS5-CAT-09. No other caller-owned runtime field may be rewritten.

### JUS5-REV-08 — Structured review result, current-dispatch finding continuity, and final evidence closure

Trusted semantic review evidence must carry a versioned result containing at least:

- review correlation identity;
- review kind;
- artifact-chain identity;
- task identity where applicable;
- reviewed revision/range;
- quality verdict/findings;
- clause results containing `clauseId`, `SATISFIED | VIOLATED | NOT_PROVEN`, supporting evidence/reference, and a deterministic evidence scope sufficient to decide carry-forward.

#### Finding identity transport

Justice must not infer the current scoped-review target set from all findings present in a preceding review and must not fuzzy-match findings across reviewer dispatches.

The exact human-readable transport marker is:

```text
[[justice-finding:<findingId>]]
```

A Justice v5 `findingId` used by this transport must match:

```text
^jf_[0-9a-f]{16}$
```

For every quality finding produced by a task review, final review, or scoped re-review new-breakage section:

- the human-readable finding line must contain exactly one marker;
- the marker ID must equal the machine-envelope `ReviewFindingV5.findingId`;
- finding IDs must be unique within that review result;
- marker/machine mismatch, missing marker for a machine quality finding, duplicate marker ID, or orphan marker makes the structured review evidence invalid.

This marker is deliberately embedded in the human-readable finding line because Superpowers v6.4.2 carries current open findings **verbatim** into fix dispatches and scoped re-review `Findings Under Verification`.

#### Current scoped-dispatch target authority

For a recognized scoped re-review, Justice extracts `requestedFindingIds` only from exact Justice markers present in that dispatch's `## The Findings Under Verification` section.

The section boundary is:

```text
start: exact heading "## The Findings Under Verification"
end:   next exact heading "## The Fix"
```

Justice must not scan unrelated prompt sections for finding markers.

The extracted list:

- preserves first-appearance order;
- may be empty;
- rejects duplicate IDs;
- rejects malformed Justice marker syntax;
- is the sole authority for which Justice quality findings the current scoped review is expected to verdict.

Consequences:

- deferred Minor findings not present in the current Superpowers open-findings list are not added to `requestedFindingIds`;
- an `ADDRESSED` finding that Superpowers removes from the next round is not reintroduced by Justice;
- a `NOT ADDRESSED` finding remains targetable because its verbatim line retains the same marker;
- new Critical/Important breakage can continue into the next round with the marker generated in the scoped reviewer output;
- a legitimate spec/clause-only scoped re-review may have `requestedFindingIds = []`.

An empty requested set is **not** a finding-context failure. Justice must still inject the structured Conformance Contract appendix so clause re-proof can occur.

#### Trusted metadata and lineage reservation lookup

Justice uses persisted trusted review evidence for two separate purposes:

1. resolve immutable metadata for the IDs selected by the **current Superpowers scoped dispatch**;
2. reserve every finding ID already used in the same trusted review lineage so a new breakage cannot reuse a historical identity.

These concepts are distinct:

```text
expectedFindings
= current scoped dispatch verdict targets only

reservedFindingIds
= all finding IDs already used by trusted evidence
  in the same review lineage
```

The current target set remains controlled only by `requestedFindingIds`; historical reservations must never cause a non-target finding to re-enter `expectedFindings`.

The context query remains:

```text
ReviewFindingContextQuery
├─ artifactChainId
├─ scope: "task" | "final"
├─ precedingReviewedHead
├─ taskIdentity (required when scope = "task")
└─ requestedFindingIds[]
```

For `scope = "task"`, `taskIdentity` is required. Together with
`artifactChainId` and `precedingReviewedHead`, it identifies the task lineage
being queried. For `scope = "final"`, `taskIdentity` is not required; the
final-review lifecycle is selected within the artifact chain.

Lineage boundaries are fixed.

Task scope:

```text
artifactChainId
+
exact TaskIdentity
```

The trusted task lineage is a **single contiguous review chain**, not an unordered set:

1. start from the unique trusted immediate preceding result whose `reviewedRange.head === precedingReviewedHead`;
2. if it is `task-review`, it is the lineage root;
3. if it is `scoped-re-review`, its `reviewedRange.base` must equal the `reviewedRange.head` of exactly one earlier trusted result with the same `artifactChainId + TaskIdentity`;
4. repeat until one trusted `task-review` root is reached;
5. missing predecessor, multiple predecessors, multiple roots, or a cycle makes lineage resolution untrusted/ambiguous.

Only findings on that contiguous chain are reserved.

Final scope:

```text
artifactChainId
+
current final-review lifecycle
```

For the supported Superpowers v6.4.2 one-fix-wave final path, the current scoped-final re-review's unique immediate preceding result must be a trusted `final-review` whose `reviewedRange.head === precedingReviewedHead`. That full final review is the final-lineage root and supplies the historical reserved IDs for the scoped-final parser. A predecessor that is already `scoped-re-review` would imply an unsupported second final re-review and is untrusted.

Finding IDs from unrelated tasks, another artifact chain, or another final-review lifecycle are not globally reserved.

For every trusted result in the selected lineage, Justice builds a historical finding-ID registry. Repeated occurrences of the same ID are valid only when the immutable identity fields are identical:

```text
findingId
severity
summary
location
```

Disposition and evidence references may change across rounds.

If one historical ID maps to conflicting immutable identity fields, context resolution is:

```text
untrusted("historical_finding_id_collision")
```

Justice must not normalize or guess which historical finding owns that ID.

The resolved context contains:

```text
ReviewFindingContextResult.resolved
├─ sourceReviewCorrelationId
├─ expectedFindings[]
└─ reservedFindingIds[]
```

`reservedFindingIds` contains each valid historical lineage ID exactly once.

Then current-target metadata resolution applies:

- `requestedFindingIds = []` → `resolved(expectedFindings = [], reservedFindingIds = <lineage IDs>)`;
- each requested ID must exist exactly once in the trusted immediate preceding review;
- the stored finding must still be compatible with being carried by the current Superpowers open list;
- unknown requested ID → `untrusted`;
- duplicate requested ID → `untrusted`;
- duplicate/ambiguous preceding-review candidate → `ambiguous`;
- missing/untrusted preceding evidence → `not_found` / `untrusted`;
- broken/ambiguous task-lineage predecessor chain or unsupported final-lineage shape → `untrusted` / `ambiguous`.

Justice never uses summary/location/order/severity-only similarity as identity authority.

For task/first-final reviews, `expectedFindings` and `reservedFindingIds` are absent because they are not scoped re-reviews.

For scoped re-review, both are present. `expectedFindings` may be empty; `reservedFindingIds` may also be empty only when the trusted lineage has never produced a quality finding.

#### Scoped reviewer/result contract

The scoped-review appendix must require:

- every expected finding to be returned exactly once with the same `findingId`, severity, summary, and location;
- its human-readable finding verdict line to preserve the exact marker;
- Superpowers `ADDRESSED` semantics → `disposition: resolved`;
- Superpowers `NOT ADDRESSED` semantics → `disposition: open`;
- new breakage to use a fresh `jf_<16 lowercase hex>` ID and the matching marker in its human-readable line;
- new breakage must not reuse any current expected ID or any `reservedFindingIds` ID from the trusted review lineage;
- reviewer output must never create `human_adjudicated`.

When `expectedFindings = []`, no quality finding verdict is required, but the machine result must still contain the required clause results for Conformance Contract re-proof.

Validation remains fail-closed:

- missing expected finding → invalid;
- duplicate expected finding ID → invalid;
- mismatched severity/summary/location or marker for an expected ID → invalid;
- new breakage ID collision with the current expected set or lineage-reserved set → invalid;
- orphan/malformed marker → invalid.

#### Final evidence closure

For Superpowers final-review progression, Justice supports a compositional final evidence closure:

```text
full final-review result for Candidate A
+
zero or one Superpowers final fix-wave scoped re-review for A..B
+
trusted FinalFixDiffEvidence for exact A..B when a fix wave exists
=
trusted FinalReviewEvidenceClosure for candidate A or B
```

Justice must not request or dispatch a second full final review after the Superpowers final fix wave.

When a final fix wave exists, carry-forward authority comes from Justice-controlled deterministic diff evidence for the exact final fix range:

```text
FinalFixDiffEvidence
├─ base
├─ head
└─ changedPaths
```

Required provenance remains:

- `base === fullFinalReview.reviewedRange.head`;
- `head === scopedReReview.reviewedRange.head`;
- `head === candidateHead`;
- the range is a valid ancestor range;
- `changedPaths` is derived from exact `base..head` Git name-status evidence;
- rename/copy includes both old and new paths;
- malformed/unsupported status, unsafe path, Git failure, or non-ancestor range means diff evidence is unavailable.

A `RevisionDiffResult.failed` means:

```text
trusted FinalFixDiffEvidence does not exist
→ trusted FinalReviewEvidenceClosure is not constructed
→ BuildFinalReviewEvidenceClosureResult is BLOCKED
→ PlanComplete remains BLOCKED
```

The blocked build attempt retains exact failure provenance without fabricating trusted diff evidence.

A `SATISFIED` clause from Candidate A may carry forward only when trusted resolved diff evidence proves the exact fix range does not intersect its recorded evidence scope. Otherwise it must be explicitly re-proven or becomes `NOT_PROVEN`.

Final quality findings are merged only after the current scoped-dispatch target IDs have been validated against trusted preceding metadata:

- matching scoped `resolved` clears that original blocker;
- matching scoped `open` remains unresolved;
- an original finding not targeted by the current scoped dispatch is not silently reintroduced into that round;
- new scoped Critical/Important finding becomes an unresolved blocker and receives a stable marker/ID for a later task-fix round when Superpowers carries it forward;
- reviewer evidence cannot manufacture `human_adjudicated`.

### JUS5-REV-09 — Invalid review/final evidence

The following must not satisfy review/conformance gates:

- missing or malformed structured result;
- stale reviewed revision used without a valid final evidence closure;
- wrong artifact chain/task/plan;
- untrusted provenance;
- missing required clause result;
- malformed/duplicate current-dispatch Justice marker;
- human marker ↔ machine finding ID mismatch;
- missing/ambiguous/untrusted metadata lookup for non-empty `requestedFindingIds`;
- unknown requested finding ID;
- requested finding whose trusted stored disposition/severity is incompatible with current open-loop targeting;
- missing, duplicate, conflicting, or metadata-mismatched expected finding;
- new breakage reusing a current expected finding ID or any lineage-reserved historical finding ID;
- historical finding-ID collision within the trusted task/final lineage;
- final evidence whose candidate head, fix range, diff provenance, carried-clause scope, scoped-delta coverage, or finding-disposition merge cannot be proven.

A legitimate `requestedFindingIds = []` / `expectedFindings = []` scoped re-review is not invalid and must still receive the Conformance Contract.

Required missing/uncovered clause results become `NOT_PROVEN`.

A full final review of Candidate A alone can never complete later Candidate B.

A failed diff build does not produce a trusted `FinalReviewEvidenceClosure`; only the `complete` build-result branch may be passed as final completion evidence.

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

- OmO Native / senpi host capabilities;
- Justice Native extension/adapter registration;
- `tool_call` and `tool_result` observability required by trusted evidence;
- current session identity availability;
- Native `task` and task-lifecycle capability;
- required command/skill availability;
- controller configuration where observable;
- custom categories;
- Superpowers availability where observable;
- effective Native `omo.jsonc` configuration source;
- effective Native agent directory and safe state-file presence;
- legacy OpenCode/plugin configuration as migration diagnostics only.

### JUS5-DOC-02

Source, configured, runtime-applied, and observed state must not be conflated.

### JUS5-DOC-03

Exact OmO Native or senpi patch mismatch alone must not define unsupported status. Missing a required extension/task/evidence capability is authoritative.

### JUS5-DOC-04

Unknown authority must be reported as unknown/unverified rather than guessed. Secret values from Native auth state must never be emitted by doctor.

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

The migration reader explicitly recognizes the current v4 families as **prior** contracts, including:

- plan authorization with `fingerprintSchema: justice-plan-v1`;
- persisted Observation/Decision envelopes with `schemaVersion: 1`, including v4 review-dispatch/task-lifecycle/finalization records;
- `ReviewSnapshotArtifact` with `schemaVersion: 1`;
- legacy `human_approved` review-resolution artifacts, which lack v5 artifact-chain/clause identity.

Recognition means “safe to classify/migrate or retain historically”, not “authorized for v5 acceptance”.

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
14. custom sp-* categories coexist with OmO Native routing.
15. canonical `deep` is not emitted.
16. Justice does not directly choose model/provider.
17. capability-compatible OmO Native / senpi patch is not rejected solely for version mismatch.
18. compaction preserves correlation and does not reuse stale evidence.
19. final completion has zero unresolved/unauthorized semantic drift.
20. final completion has zero missing required evidence and zero blocking quality findings.
21. Native `task_id` remains OmO-owned and is never overloaded with Justice TaskIdentity.
22. same-turn parallel tool results completing out of order cannot cross-correlate Justice evidence.
23. mass-ulw/workflow DAG observations preserve independent task provenance without deriving dependency order from event arrival.
24. an existing Superpowers reviewer receives the Conformance Contract through the same Native `task` call, without a duplicate dispatch.
25. Native effective configuration uses user/project + `[native]` + profile precedence and does not depend on an OpenCode profile directory.
26. profile-recognized Superpowers category translation never produces OmO-invalid `category + model`, while external caller-owned model routing remains unchanged.
