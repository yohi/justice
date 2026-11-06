# Justice v6 — S1-b Typed Evidence Binder
## Design R0.1.1 — Targeted Correction Candidate

**Repository:** `yohi/justice`  
**Issue:** [#351](https://github.com/yohi/justice/issues/351)  
**Date:** 2026-11-06 (JST)  
**Baseline:** `master@007209b0265efab9cff4f62f5c6de79784c93f28`  
**Scope:** S1-b / Host-independent Core  
**Correction base:** `13752b0c7da4ba19779db27584bc32df4c395559`  
**Status:** `DOCUMENT_CORRECTION_CANDIDATE / OWNER_ADOPTION_PENDING / CODE_IMPLEMENTATION_NOT_AUTHORIZED`  
**Correction scope:** F-001 / F-002 / F-003 only. Sections 3–6 clarified.

> **Authority:** This document records the S1-b brainstorming result. Committing this document does not adopt the design, authorize source-code changes or test execution, change Gate/HOLD state, authorize Host probes, or trigger further reviews or implementation. Any implementation requires a separate explicit Human Owner decision. S1-c and S2–S5 remain outside this scope.

## 1. Purpose and first use

Bind typed EvidenceRefs to the Task, Revision, Scope, and Acceptance Criteria (AC) identities selected and checked by S1-a, and detect misattribution and missing evidence.

The **first actual use** is S1-e static positive/negative fixtures. The initial Core is **Host-independent** and **READ_ONLY**. It must not depend directly on Justice v2's existing Evidence machinery, while its input contract must leave a clear seam for a future Host/Justice-v2 adapter.

**Identity/binding match is not evidence authenticity, execution success, Human Owner approval, or AC satisfaction.**

## 2. Approaches considered and decision

| Approach | Trade-off | Decision |
| --- | --- | --- |
| **A. Direct typed EvidenceRef binding** against the S1-a selected identity set | Minimal, deterministic, fixture-friendly, no separate authority source | **Selected** |
| B. Separate Binding Manifest | Adds another file/trust boundary and synchronization overhead | Not selected for MVP |
| C. Evidence Store integration | Adds persistence, discovery, and Host-related behavior beyond MVP | Out of scope |

The design uses a **pure, deterministic Core function** over explicit inputs. No implicit discovery, remote lookup, execution, persistence, or authority promotion.

## 3. Inputs

### 3.1 Baseline input — immutable S1-a LoaderResult

Accept the existing `justice-s1a-result-v1` `LoaderResult` without modifying its contract.

Relevant fields:

- `schemaVersion`
- `identityStatus`
- `identityCandidateReady`
- `manifestDigestMatch`
- `selectedRefs`
- `ownerAuthorityStatus`
- `ownerTrustPrecondition`
- `eligibleBaseline`
- `checks`
- `limitations`

Each S1-a `SelectedArtifactRef` provides:

- `artifactId`
- `kind`
- `revision`
- `scopeKey`
- `parentId?`
- `expectedDigest`
- `observedDigest`
- `digestOutcome`

These are the existing S1-a fields, not a new S1-b baseline format.

S1-b uses the selected Task and selected AC records as its comparison candidate. It must not discover or infer additional AC identities outside `selectedRefs`.

A baseline is usable for binding comparison only when the S1-a output has:

- `identityCandidateReady === true`
- `identityStatus === MATCH`
- `manifestDigestMatch === true`
- a structurally consistent selection containing exactly one Task and its selected mandatory AC records

The selected records must remain consistent with the relationships already checked by S1-a. Structural contradictions in the supplied LoaderResult are invalid input, not successful baseline selection.

**Normative S1-a aggregate consistency (F004):** The existing S1-a `loader.ts` derives `identityStatus` from `checks[].outcome` using this exact precedence:

1. If **any** check is `MISMATCH`, aggregate `identityStatus = MISMATCH`.
2. Otherwise, if **any** check is `UNKNOWN`, aggregate `identityStatus = UNKNOWN`.
3. Otherwise, aggregate `identityStatus = MATCH` (including the empty-check case, as defined by the existing implementation).

The derived readiness flag is **exactly** `identityCandidateReady === (identityStatus === 'MATCH' && manifestDigestMatch === true)`. S1-b validates the structure and outcome enum of every check, recomputes both derived values, and compares each against the supplied S1-a result. A contradiction in either comparison is **`MALFORMED`**, mapped to `INPUT_REJECTED` / `BASELINE_SHAPE_INVALID`; it must never be accepted as ready and must not be treated as a normal nonready result.

A structurally valid and **aggregate-consistent** S1-a result with `identityCandidateReady === false` is **`NOT_READY`**. This includes legitimate `MISMATCH` or `UNKNOWN` aggregate outcomes and incomplete selected references permitted by S1-a. It produces `BASELINE_UNKNOWN`, never an authoritative match or `MISSING_EVIDENCE`. Do not impose ready-only selected-ref completeness conditions on an otherwise valid `NOT_READY` result.

No S1-b operation can change:

- `ownerAuthorityStatus: NOT_PROVEN`
- `ownerTrustPrecondition: EXTERNAL_NOT_VERIFIED_BY_S1A`
- `eligibleBaseline: false`

Even an eligible identity comparison candidate is **not an Owner-approved baseline**.

### 3.2 EvidenceRef v1 — strict typed input

The proposed initial TypeScript contract is:

```typescript
type IdentityRef = Readonly<{
  artifactId: string;
  revision: string;
}>;

type EvidenceType =
  | "test"
  | "build"
  | "lint"
  | "artifact"
  | "review"
  | "other";

type ProvenanceClass =
  | "SELF_DECLARED"
  | "FIXTURE_OBSERVATION"
  | "UNVERIFIED_EXTERNAL";

type ReportedExecutionState =
  | "EXECUTED"
  | "NOT_EXECUTED"
  | "UNKNOWN";

type ReportedOutcome =
  | "PASS"
  | "FAIL"
  | "UNKNOWN";

type EvidenceRefV1 = Readonly<{
  evidenceId: string;
  type: EvidenceType;
  taskRef: IdentityRef;
  scopeKey: string;
  acRef?: IdentityRef;
  issuerId: string;
  originId: string;
  provenanceClass: ProvenanceClass;
  reportedExecutionState: ReportedExecutionState;
  reportedOutcome?: ReportedOutcome;
  contentDigest?: Readonly<{
    algorithm: "sha256";
    hex: string;
  }>;
}>;

type BinderInput = Readonly<{
  schemaVersion: "justice-s1b-input-v1";
  baseline: LoaderResult;
  evidenceRefs: readonly EvidenceRefV1[];
}>;
```

`LoaderResult` is imported as an existing S1-a type. This contract does not modify S1-a.

All normative input objects are strict: required fields must be present, optional fields may be omitted, unknown fields are rejected, and `null` is not a substitute for an omitted field.

**Evidence identity rules:**

- `evidenceId` must be unique within the input collection.
- Task, AC, revision, scope, issuer, origin and evidence IDs use the diagnostic-safe identifier rule defined in Section 3.3.
- Matching is exact, case-sensitive and non-normalizing.
- One EvidenceRef references at most one AC.
- An EvidenceRef without `acRef` cannot count toward individual AC coverage.
- `issuerId`, `originId` and `provenanceClass` are supplied claims, not authenticated identities.

`reportedOutcome` is deliberately optional. If omitted, no outcome claim is inferred.

`reportedOutcome: PASS` means only that PASS was reported. It does not establish that a test ran, that its output was authentic, that it succeeded, or that an AC was satisfied.

`reportedExecutionState: NOT_EXECUTED` likewise represents a supplied execution-state claim, not independently verified non-execution.

`FIXTURE_OBSERVATION` identifies the form of fixture-supplied information. It does not certify a real Host observation.

A `contentDigest` can express supplied content identity, but without an independent trusted expectation it cannot establish authenticity.

The initial Binder does not read, resolve or hash the referenced evidence content.

### 3.3 Finite input limits and validation policy

The following limits are normative for S1-b v1.

| Constraint | Limit |
|---|---|
| EvidenceRefs per input | 128 |
| Selected artifacts | Maximum 128, respecting S1-a |
| Identifier length | 1–64 ASCII characters |
| SHA-256 hex | Exactly 64 lowercase hexadecimal characters |
| AC references per EvidenceRef | 0 or 1 |
| Unknown fields | Rejected |
| Duplicate `evidenceId` | Rejected |
| Invalid enum values | Rejected |

Diagnostic-safe identifiers must satisfy:

`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`

All identifiers retain their original spelling after validation. No case folding, truncation or implicit normalization is permitted.

Every input field has a finite schema and bounded value domain or length. The Core must not echo unchecked fields, raw input content, paths or exceptions in diagnostics.

S1-a's existing limits and selected-artifact contract remain unchanged.

**Collection validation is atomic.**

If any EvidenceRef contains an invalid field, unsafe identifier, duplicate evidence ID or other schema violation, **the complete collection is rejected**.

No valid subset is accepted or exposed as partially successful binding.

An empty, structurally valid `evidenceRefs: []` is permitted. With a usable baseline, it represents no supplied matching evidence and therefore produces missing-evidence coverage for each mandatory AC.

## 4. Binding algorithm and result

S1-b exposes one conceptual pure operation:

`bindEvidence(input: BinderInput): BinderResult`

This is a proposed Core interface, not an implemented function.

### 4.1 Result type structure

```typescript
type EvaluationStatus =
  | "EVALUATED"
  | "BASELINE_UNKNOWN"
  | "INPUT_REJECTED";

type BindingStatus =
  | "MATCH"
  | "MISMATCH"
  | "UNKNOWN";

type BindingReasonCode =
  | "BASELINE_NOT_READY"
  | "TASK_NOT_SELECTED"
  | "TASK_REVISION_MISMATCH"
  | "SCOPE_MISMATCH"
  | "AC_NOT_SELECTED"
  | "AC_REVISION_MISMATCH"
  | "AC_TASK_MISMATCH";

type CoverageStatus =
  | "MATCHED_REF_PRESENT"
  | "MISSING_EVIDENCE"
  | "UNKNOWN";

type CoverageAssessmentStatus =
  | "ASSESSABLE"
  | "UNKNOWN";

type InputRejectionReason =
  | "INPUT_SCHEMA_INVALID"
  | "BASELINE_SHAPE_INVALID"
  | "EVIDENCE_LIMIT_EXCEEDED"
  | "EVIDENCE_FIELD_INVALID"
  | "UNSAFE_IDENTIFIER"
  | "DUPLICATE_EVIDENCE_ID";

type BindingResult = Readonly<{
  evidenceId: string;
  bindingStatus: BindingStatus;
  reasonCodes: readonly BindingReasonCode[];
  reportedExecutionState: ReportedExecutionState;
  reportedOutcome?: ReportedOutcome;
  authenticityStatus: "NOT_VERIFIED";
  executionVerificationStatus: "NOT_VERIFIED";
}>;

type CoverageResult = Readonly<{
  acRef: IdentityRef;
  coverageStatus: CoverageStatus;
  matchingEvidenceIds: readonly string[];
}>;

type BinderResult = Readonly<{
  schemaVersion: "justice-s1b-result-v1";
  evaluationStatus: EvaluationStatus;
  bindingResults: readonly BindingResult[];
  coverageResults: readonly CoverageResult[];
  coverageAssessmentStatus: CoverageAssessmentStatus;
  rejectionReasonCode?: InputRejectionReason;
  authenticityStatus: "NOT_VERIFIED";
  executionVerificationStatus: "NOT_VERIFIED";
  limitations: readonly string[];
}>;
```

`BindingResult` describes attribution of an individual EvidenceRef.

`CoverageResult` describes only the presence of matching EvidenceRefs for an individual mandatory AC.

These two records serve different purposes and must not be merged.

`MATCHED_REF_PRESENT` does not mean that evidence was verified or that an AC was satisfied.

### 4.2 Deterministic evaluation order

The Core performs the following steps.

**Step 1 — Validate input structure**

Validate the BinderInput schema, the supplied S1-a result structure, all EvidenceRefs, identifier safety, uniqueness and limits. For S1-a, independently recompute `identityStatus` from all validated `checks[].outcome` values using **MISMATCH > UNKNOWN > MATCH**, then recompute `identityCandidateReady` as `identityStatus === 'MATCH' && manifestDigestMatch === true`. Both values must match the corresponding supplied fields.

Validation must complete across the relevant collection before any binding success is emitted.

**Step 2 — Reject malformed collections atomically**

If validation fails—including an internally contradictory S1-a aggregate or ready flag—return `BASELINE_SHAPE_INVALID` for that baseline defect (subject to the existing global input-rejection precedence), not `BASELINE_UNKNOWN`:

- `evaluationStatus: INPUT_REJECTED`
- `bindingResults: []`
- `coverageAssessmentStatus: UNKNOWN`
- one fixed `rejectionReasonCode`
- no `MATCH`, `MISMATCH` or `MISSING_EVIDENCE` conclusions derived from a partially valid collection

When the baseline is independently structurally valid and ready, `coverageResults` contains one record per selected mandatory AC, each with `coverageStatus: UNKNOWN` and `matchingEvidenceIds: []`.

Otherwise `coverageResults` is empty, with aggregate `coverageAssessmentStatus: UNKNOWN`.

An invalid EvidenceRef must not cause an otherwise matching EvidenceRef to be exposed as a partial success.

When several input validation defects coexist, select the rejection reason using this fixed priority:

1. `INPUT_SCHEMA_INVALID`
2. `BASELINE_SHAPE_INVALID`
3. `EVIDENCE_LIMIT_EXCEEDED`
4. `EVIDENCE_FIELD_INVALID`
5. `UNSAFE_IDENTIFIER`
6. `DUPLICATE_EVIDENCE_ID`

The highest-priority detected defect determines `rejectionReasonCode`, independently of EvidenceRef input order.

No unchecked offending value is copied into the result.

**Step 3 — Establish comparison availability**

If the structurally valid, aggregate-consistent S1-a baseline is not ready (a legitimate `NOT_READY`, not `MALFORMED`), return:

- `evaluationStatus: BASELINE_UNKNOWN`
- One `BindingResult` per valid EvidenceRef, each with `bindingStatus: UNKNOWN`
- `reasonCodes: [BASELINE_NOT_READY]`
- `coverageAssessmentStatus: UNKNOWN`
- `coverageResults: []`

This is not evidence of missing AC coverage. The necessary baseline comparison was unavailable.

**Step 4 — Compare each valid EvidenceRef**

When the baseline candidate is ready, compare:

1. `taskRef.artifactId` against the selected Task ID.
2. Task Revision only if the Task ID matches.
3. `scopeKey` against the selected Task scope.
4. `acRef.artifactId`, when supplied, against the selected AC IDs.
5. AC Revision only if the AC ID matches a selected AC.
6. The selected AC's known `parentId` against the EvidenceRef's declared Task ID, but only when the referenced AC is selected and its parent information is actually available.

An EvidenceRef referencing a nonselected AC produces `AC_NOT_SELECTED`. The Core must not claim that the unknown AC belongs to another Task.

If a selected AC has comparable parent information and its `parentId` differs from the declared Task ID, `AC_TASK_MISMATCH` may be reported.

The binding result is:

- `MATCH` when all applicable identity comparisons match.
- `MISMATCH` when at least one observable contradiction exists.
- `UNKNOWN` when comparison cannot be established.

A present, valid but incorrect identifier is an observed mismatch. An absent or invalid collection is an input failure, not an observed mismatch.

**Step 5 — Deterministically report multiple mismatches**

A single EvidenceRef may have several independently observed mismatches.

The result uses `reasonCodes[]`, sorted according to this fixed priority:

1. `TASK_NOT_SELECTED`
2. `TASK_REVISION_MISMATCH`
3. `SCOPE_MISMATCH`
4. `AC_NOT_SELECTED`
5. `AC_REVISION_MISMATCH`
6. `AC_TASK_MISMATCH`

Each reason appears at most once.

Do not emit `TASK_REVISION_MISMATCH` if the Task ID itself is not selected. Likewise, do not emit AC revision or parent mismatch when the AC is not selected.

A successful `MATCH` has `reasonCodes: []`.

A `BASELINE_UNKNOWN` result has exactly `[BASELINE_NOT_READY]`.

Individual `bindingResults` are ordered lexicographically by validated `evidenceId`, and AC coverage results are ordered by validated `acRef.artifactId`, using case-sensitive ASCII ordering.

The same logical input therefore yields the same structured result independent of EvidenceRef collection ordering.

**Step 6 — Evaluate mandatory AC coverage**

The mandatory AC set is exactly the selected AC set supplied through the ready S1-a comparison candidate.

For each mandatory AC:

- If at least one `BindingResult` is `MATCH` and explicitly references that AC, return `MATCHED_REF_PRESENT`.
- Otherwise, when the complete collection was valid and evaluated against a ready baseline, return `MISSING_EVIDENCE`.
- If evaluation was rejected or the baseline was unavailable, use `UNKNOWN` according to the rules above.

`matchingEvidenceIds` includes only the IDs of successfully bound EvidenceRefs explicitly referencing the given AC, in deterministic lexical order.

Task-level EvidenceRefs without `acRef` never satisfy AC presence.

A `MISMATCH` EvidenceRef never contributes to matched AC presence.

Coverage is a **reference-presence measurement**, not an assurance, authorization or completion verdict.

### 4.3 Result-wide invariants

For every S1-b v1 result:

- `authenticityStatus === NOT_VERIFIED`
- `executionVerificationStatus === NOT_VERIFIED`
- No result field represents independently proven AC satisfaction.
- Neither reported PASS nor reported EXECUTED changes authenticity.
- No S1-a field is mutated or promoted.
- A rejected collection yields no partial `MATCH` output.
- An unassessable baseline cannot produce `MISSING_EVIDENCE`.

Result objects and arrays are immutable Core outputs.

## 5. Trust and authority boundary

S1-b preserves the original S1-a result without modifying:

- `identityStatus`
- `identityCandidateReady`
- `manifestDigestMatch`
- `selectedRefs`
- `ownerAuthorityStatus: NOT_PROVEN`
- `ownerTrustPrecondition: EXTERNAL_NOT_VERIFIED_BY_S1A`
- `eligibleBaseline: false`
- `limitations`

The Core performs comparison against a selected identity candidate. It does not authenticate the provenance of the `LoaderResult` object or the Human Owner who originally supplied S1-a's expected digest.

A matching Task or AC identity does not establish that the EvidenceRef was generated by the corresponding execution.

Likewise:

- `issuerId` is a declared identifier.
- `originId` is a declared identifier.
- `provenanceClass` is a supplied classification.
- `reportedExecutionState` is a supplied state.
- `reportedOutcome` is a supplied outcome.
- `contentDigest` is a supplied content digest.

None is promoted to independently verified evidence by the Binder.

The names `authenticityStatus` and `executionVerificationStatus` explicitly separate verification from the supplied claims.

A future Adapter may supply separately authenticated Host observations through a later authorized contract. S1-b v1 does not implement that contract or treat prospective Adapter capability as present.

Invalid entries must not be silently accepted as partial success. Diagnostics use finite reason-code enums and do not echo raw host paths, unvalidated identifiers, user-controlled exception messages or evidence content.

## 6. Initial S1-e acceptance matrix

All fixtures must use the strict schema defined in Section 3.2.

| Static fixture case | Expected outcome |
|---|---|
| Matching Task, Revision, Scope and AC | `MATCH`; authenticity `NOT_VERIFIED` |
| Evidence attributed to another Task | `TASK_NOT_SELECTED` |
| Evidence for stale Task Revision | `TASK_REVISION_MISMATCH` |
| Evidence with different Scope | `SCOPE_MISMATCH` |
| Evidence referencing an unselected AC | `AC_NOT_SELECTED`; no invented parent relationship |
| Selected AC paired with a different declared Task | Observable `AC_TASK_MISMATCH` when selected parent information is available |
| Selected AC with wrong Revision | `AC_REVISION_MISMATCH` |
| Multiple observable discrepancies | Multiple reason codes in fixed priority order |
| Required AC with no matching EvidenceRef | Coverage `MISSING_EVIDENCE` |
| Empty valid EvidenceRef collection | Every mandatory AC `MISSING_EVIDENCE` |
| Self-declared PASS with matching attribution | Binding `MATCH`, `reportedOutcome: PASS`, authenticity `NOT_VERIFIED`; no PROVEN or AC_SATISFIED |
| Self-declared FAIL with matching attribution | Binding `MATCH`, `reportedOutcome: FAIL`; no independently verified failure claim |
| Unverified Host execution identifier | Authenticity and execution verification remain `NOT_VERIFIED` |
| Reported `NOT_EXECUTED` | Preserve reported state; do not independently assert non-execution |
| Missing optional `reportedOutcome` | Do not infer PASS, FAIL or UNKNOWN as an observed outcome |
| Mixed valid and malformed EvidenceRefs | Whole collection `INPUT_REJECTED`, no partial Binding MATCH |
| Duplicate Evidence IDs | Whole collection `INPUT_REJECTED` |
| Unsafe identifier | Whole collection `INPUT_REJECTED` |
| EvidenceRef count exceeds 128 | `INPUT_REJECTED` |
| Non-ready S1-a baseline | Binding `UNKNOWN`, aggregate Coverage `UNKNOWN`; no MISSING_EVIDENCE |
| Invalid collection with ready baseline | Empty bindings; each known mandatory AC Coverage `UNKNOWN` |
| Malformed S1-a baseline | `INPUT_REJECTED`; no assumed AC set or successful binding |

Fixture assertions should compare structured results, including the exact expected ordered `reasonCodes`, binding statuses, coverage statuses, and unchanged trust limitations.

The fixture exercises only what S1-b actually verifies. Passing static fixtures does not demonstrate improved real-world detection rates, actual Host execution, evidence authenticity or Owner authorization.

No Host Probe, CI run or runtime testing is authorized by this design correction.

## 7. Explicit non-goals

- S1-c Deviation Rules or scope/change acceptance decisions
- Review/Fix dispatch, automatic review loops, Gate/HOLD updates
- Host execution control, Runtime Probe, Host identity issuance/verification
- Direct Justice-v2 Evidence integration, persistent Evidence Store, external network calls
- Cryptographic evidence-origin authentication
- Owner approval, authority escalation, implementation of S2–S5

## 8. Completion and stop conditions

Initial S1-b implementation can be considered complete when:

1. The listed positive/negative S1-e static fixtures pass and produce reproducible, correctly typed binding/coverage results.
2. S1-a identity and Owner-trust limits are preserved.
3. Core remains Host-independent, deterministic and read-only.
4. Non-observed/missing inputs remain distinct from observed contradictions and no claimed provenance becomes verified merely by matching identifiers.

These are future implementation acceptance criteria, **not a claim that tests have run**.

On satisfying these criteria, **stop the S1-b implementation scope and return to the Human Owner checkpoint**. Do not require additional review cycles, all findings resolved, Host integration, or S1-c implementation merely because they can be proposed. Fix safety/authority-critical problems affecting this scope before any dependent privileged action, without stopping unrelated work by default.

## 9. Owner decisions and permissions

The Human Owner has confirmed:

- Initial use: S1-e static fixture binding and misattribution detection.
- Host-independent Core; no direct Justice-v2 dependency in initial scope.
- Separation of binding correctness and evidence authenticity; preservation of S1-a boundary.
- S1-c/Review/Gate/Host control excluded; implementation may stop at initial acceptance.
- Approach A (direct EvidenceRef binding) as design direction.

**The Human Owner authorized the limited documentary correction of F-001, F-002, and F-003. Owner adoption of the complete Design R0.1.1 remains pending.** Repository recording is not adoption. No source implementation, test execution, CI, PR, Gate/HOLD change, implementation plan creation, or automatic follow-up is authorized by this document.
