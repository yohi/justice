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

Justice review interop uses the existing Superpowers reviewer dispatch and must not depend on asynchronous `session.created/session.updated` plugin-event completion before prompt delivery.

For the current Justice SDK lock (`@opencode-ai/sdk@1.14.21`) and the supported OpenCode 1.18.31 baseline, `client.session.get()` uses the generated default `responseStyle: "fields"` and `throwOnError: false` contract.

Therefore the authoritative lookup algorithm is:

```ts
let lookup;
try {
  lookup = await client.session.get({
    path: {
      id: childSessionId,
    },
  });
} catch {
  // transport/runtime exception
  return lookup_failed;
}

if (lookup.data === undefined) {
  // SDK/HTTP error response or otherwise missing data
  return lookup_failed;
}

const childSession = lookup.data;
```

Justice must never treat the fields-response wrapper itself as a Session.

Binding then proceeds as follows:

1. parent `tool.execute.before` observes the recognized Superpowers `task` review call and creates `PendingReviewCorrelation(parentSessionId + parentCallId)`; Justice does not alter caller routing;
2. when the child reviewer's awaited `chat.message` hook runs, Justice takes `input.sessionID` as `childSessionId` and performs the awaited fields-response lookup above;
3. thrown transport/runtime exception, `lookup.data === undefined`, or SDK/HTTP error response → `lookup_failed`, **no injection**, semantic evidence `NOT_PROVEN`;
4. `childSession.id !== childSessionId` → conflict/untrusted, **no injection**;
5. missing `childSession.parentID` → `parent_missing`, **no injection**;
6. Justice matches `childSession.parentID` to exactly one pending recognized review call;
7. zero matches → `not_found`; multiple matches → `ambiguous`; either means **no injection**;
8. exactly one compatible match → bind the child and append the read-only Conformance Contract appendix to the existing `output.parts` array in place;
9. `session.created/session.updated` observations are corroboration/cache/diagnostic inputs only and are never a prompt-delivery ordering prerequisite;
10. parent `tool.execute.after` corroborates the same parent call and child metadata; a mismatch invalidates the evidence.

The v5 architecture deliberately uses the child `chat.message` path for review delivery. This is an architectural choice, not a claim that in-place mutation of the same `tool.execute.before.output.args` object is impossible.

The appended element is one fully formed synthetic OpenCode text Part with:

- `id = "prt_justice_review_" + randomUUID()`;
- `sessionID = output.message.sessionID`, which must equal `input.sessionID`;
- `messageID = output.message.id`;
- `type = "text"`;
- `text = <Justice review appendix>`;
- `synthetic = true`.

If the message/session identities are missing or inconsistent, Justice performs no injection.

Justice must not create another reviewer dispatch and must not change the caller-selected subagent/category/model/provider/variant.

A future supported host must provide an equivalent awaited authoritative parent lookup plus a consumed prompt/message extension point. Otherwise semantic conformance review on that host is unsupported until compatibility evidence establishes a replacement contract.

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
├─ scope
├─ precedingReviewedHead
└─ requestedFindingIds[]
```

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
14. custom sp-* categories coexist with OmO v5.
15. canonical `deep` is not emitted.
16. Justice does not directly choose model/provider.
17. capability-compatible OpenCode patch is not rejected solely for version mismatch.
18. compaction preserves correlation and does not reuse stale evidence.
19. final completion has zero unresolved/unauthorized semantic drift.
20. final completion has zero missing required evidence and zero blocking quality findings.
