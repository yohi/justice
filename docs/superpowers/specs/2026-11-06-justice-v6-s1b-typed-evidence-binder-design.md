# Justice v6 — S1-b Typed Evidence Binder
## Design R0.1 — Owner Approval Candidate

**Repository:** `yohi/justice`  
**Issue:** [#351](https://github.com/yohi/justice/issues/351)  
**Date:** 2026-11-06 (JST)  
**Baseline:** `master@007209b0265efab9cff4f62f5c6de79784c93f28`  
**Scope:** S1-b / Host-independent Core  
**Status:** `DESIGN_CANDIDATE / OWNER_ADOPTION_PENDING / CODE_IMPLEMENTATION_NOT_AUTHORIZED`

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

Accept the existing `justice-s1a-result-v1` `LoaderResult` without modifying it. Relevant fields include:

- `identityStatus`, `identityCandidateReady`, `selectedRefs`
- `manifestDigestMatch`, `ownerAuthorityStatus`, `ownerTrustPrecondition`, `eligibleBaseline`
- `checks` and `limitations`

`selectedRefs` supply Task/AC identity, revision, scope, and parent associations. The caller may not substitute an independently claimed approved baseline for this input.

If `identityCandidateReady !== true`, S1-b lacks an established comparison candidate. It must not claim a successful authoritative binding; results requiring this baseline are `UNKNOWN`. The S1-a result is not mutated or promoted.

### 3.2 EvidenceRef v1 — proposed minimal typed input

| Field | Meaning |
| --- | --- |
| `evidenceId` | Unique ID within the input collection |
| `type` | `test` / `build` / `lint` / `artifact` / `review` / `other` |
| `taskRef` | Task `artifactId` and `revision` |
| `scopeKey` | Declared scope |
| `acRef` | Optional AC `artifactId` and `revision` |
| `issuerId` | Declared issuer identifier, **not authenticated** |
| `originId` | Declared origin identifier, **not authenticated** |
| `provenanceClass` | `SELF_DECLARED` / `FIXTURE_OBSERVATION` / `UNVERIFIED_EXTERNAL` |
| `reportedExecutionState` | `EXECUTED` / `NOT_EXECUTED` / `UNKNOWN` |
| `contentDigest` | Optional SHA-256, not independently authenticated by itself |

These are **design fields, not an implemented API**. The implementation plan may specify the exact structural representation without altering their semantics.

An EvidenceRef may reference **at most one AC** in this initial contract. An EvidenceRef without `acRef` may match the Task but must not count toward an individual AC's evidence presence.

The Core must distinguish declared origin/execution values from independently established facts; in particular, `FIXTURE_OBSERVATION` means fixture-supplied observation-shaped data, **not a verified real Host observation**.

Inputs and identifiers must be parsed strictly using an explicit finite schema. Reuse S1-a's diagnostic-safe identity rules for Task/AC/revision/scope references where applicable. Reject duplicate evidence IDs, unsafe identifiers, and unknown normative fields. Errors and diagnostics must not echo unchecked user-controlled text, paths, or origin claims.

## 4. Binding algorithm and result

Perform read-only deterministic processing in this order:

1. Examine the S1-a identity-candidate readiness and immutable selected identities.
2. Strictly validate the incoming EvidenceRef collection.
3. Compare each EvidenceRef's Task ID and Revision with the selected Task.
4. Compare exact Scope.
5. If `acRef` is present, compare AC ID, Revision, and parent Task association.
6. Report per-Evidence binding results and per-mandatory-AC evidence presence, without treating any match as acceptance.

### 4.1 Binding status

| Status | Meaning |
| --- | --- |
| `MATCH` | Declared Task/Revision/Scope/AC attribution matches the checked S1-a identity candidate |
| `MISMATCH` | An observable contradiction against the comparable selected identity |
| `UNKNOWN` | Unavailable, invalid, or unestablished comparison input |

Return a finite `reasonCode` indicating the observed mismatch, incompleteness, or invalidity; keep `MISMATCH` distinct from `UNKNOWN`.

### 4.2 Separate assurance axes

The output must keep the following separate from binding status:

- `authenticityStatus`: **always `NOT_VERIFIED` in S1-b v1**.
- `executionEvidenceStatus`: reflect the **reported** execution state/its lack of independent verification. Do not emit an independent Host execution proof.
- `acEvidenceCoverage`: indicate whether each mandatory AC has at least one identity-matching `acRef`, not whether the AC is satisfied.
- `reasonCode` and `limitations`: identify only what the Core established.

When no identity-matching EvidenceRef exists for a mandatory AC, report `MISSING_EVIDENCE`; **do not infer `NOT_EXECUTED`**. If the fixture reports `NOT_EXECUTED`, preserve that as a report, not independently proven execution state.

An EvidenceRef can be `MATCH` while its authenticity remains `NOT_VERIFIED`. **Never derive `PROVEN`, `PASS`, or `AC_SATISFIED` from a match or self-reported pass.**

## 5. Trust and authority boundary

Keep the S1-a result unchanged, including:

- `ownerAuthorityStatus: NOT_PROVEN`
- `ownerTrustPrecondition: EXTERNAL_NOT_VERIFIED_BY_S1A`
- `eligibleBaseline: false`
- the original `identityStatus`, `identityCandidateReady`, and `limitations`

In particular, a matching `taskRef`, `acRef`, digest, `issuerId`, or `originId` must not change any of those fields or independently establish provenance.

A future adapter may supply separately verified Host observations under a separately designed contract, but **this design neither verifies Host identity nor specifies an authorization mechanism**.

Invalid entries must not be silently accepted as partial success. Where the input is unsuitable for reliable binding, return safe explicit non-success diagnostics; do not misclassify a missing/invalid record as an observed contradiction.

## 6. Initial S1-e acceptance matrix

| Static fixture case | Expected outcome |
| --- | --- |
| Matching Task, Revision, Scope and AC | Binding `MATCH`, authenticity `NOT_VERIFIED` |
| Evidence attributed to another Task | `MISMATCH` |
| Evidence for stale Revision | `MISMATCH` |
| Evidence with different Scope | `MISMATCH` |
| AC belonging to another Task | `MISMATCH` |
| Mandatory AC lacking matching EvidenceRef | `MISSING_EVIDENCE`; not inferred unexecuted |
| Self-declared PASS | May have `MATCH` attribution; cannot become PROVEN/PASS |
| Unverified Host execution identifier | Authenticity remains `NOT_VERIFIED` |
| Unassessable input | `UNKNOWN`, not fabricated mismatch |
| Reported `NOT_EXECUTED` | Preserved as unverified report, not independent Host proof |
| S1-a `identityCandidateReady=false` | `UNKNOWN` for dependent binding; no authority escalation |

The fixture exercises what S1-b **actually verifies**. Passing static fixtures does not demonstrate an improvement in real-world detection or Host execution authenticity.

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

**Owner adoption of this complete Design R0.1 is pending.** Repository recording alone is not adoption. No source implementation, tests, CI, PR, Gate/HOLD change, or automatic follow-up is authorized by this document.
