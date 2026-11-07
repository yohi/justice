# Justice v6 — S1-c Deviation Rules
## Design R0.1 — Human Owner review candidate

- Date: 2026-11-07 (JST)
- Repository: `yohi/justice`
- Issue: https://github.com/yohi/justice/issues/352
- Status: `DESIGN_CANDIDATE / OWNER_ADOPTION_PENDING / CODE_IMPLEMENTATION_NOT_AUTHORIZED`
- Authority: `DOCUMENT_ONLY / NO_GITHUB_WRITE / NO_BUILD_OR_TEST / NO_GATE_OR_HOLD_CHANGE`
- Scope: S1-c Host-independent, deterministic, read-only diagnostic Core. S2–S5 excluded.

> **Decision scope:** This document incorporates the Owner's brainstorming direction as a **design input**: `APPROVE_S1C_PLAN_BOUND_TASK_SCOPE_WITH_UNKNOWN_NON_BLOCKING` and `S1C_EXTERNAL_OWNER_AUTHORITY_TRUST_BOUNDARY_WITH_UNKNOWN_FALLBACK`. It does not assert that a new operational trust boundary has been implemented or that this entire design has been formally adopted. No work on an Implementation Plan or source code follows automatically.

## 1. Purpose and scope

Compare a Task's explicitly permitted change paths, attributable to the exact Plan selected by S1-a, against a supplied minimal ChangeSet; report missing AC evidence references and evidence-identity mismatches by reusing S1-b. Report what is observed, what is merely claimed, and what cannot be determined without promoting unverified Owner authority. This is diagnostic assurance, not a substitute for Superpowers workflow, review, approval, acceptance or Host execution control.

Success is a small S1-e static fixture set that differentiates in-scope, out-of-scope, undefined policy and Plan-identity mismatch, while remaining non-blocking for normal Superpowers progression.

**Non-goals:** Natural-language Plan inference, general purpose glob engine, separate policy approval store, digital signatures, approval verification, trusted host diff collection, filesystem enforcement, autonomous Review/Fix/PR/CI/Gate/HOLD operations, AC satisfaction verification, requirement adoption or model selection.

## 2. Approaches considered

| Approach | Benefit | Defect | Decision |
| --- | --- | --- | --- |
| A. Read natural-language Design/Plan and infer permission | Low source-format burden | Unstable, ambiguous, not deterministic | Rejected |
| B. Accept a separate Task-path allowlist with no source binding | Simple comparator | Caller can forge permissions | Rejected as authoritative source |
| **C. Owner-approved Design/Plan as authority, explicit Task allowlist extracted from exact Plan bytes** | Deterministic scope comparison, source provenance retained | Requires an optional machine-readable section and byte association | **Selected design direction** |

The selected approach creates no independent authorization scheme. Existing Plan content remains the source of policy; a missing machine-readable section causes `UNKNOWN`, not guessed permission or an automatic workflow stop.

## 3. Reuse and invariants of S1-a / S1-b

Source contracts reviewed from the default branch on 2026-11-07:

- S1-a `src/core/s1a/contract.ts`: `LoaderResult`, `SelectedArtifactRef`, `identityCandidateReady`, `ownerAuthorityStatus: 'NOT_PROVEN'`, `eligibleBaseline: false`; `SelectedArtifactRef` contains `expectedDigest`, `observedDigest`, `digestOutcome`.
- S1-b `src/core/s1b/contract.ts`: `BinderInput`, `BinderResult`; coverage is `MATCHED_REF_PRESENT | MISSING_EVIDENCE | UNKNOWN`; `authenticityStatus` and `executionVerificationStatus` remain `NOT_VERIFIED`.
- S1-b `src/core/s1b/binder.ts`: existing `bindEvidence()` can be reused without copying its matching rules.

**Mandatory invariants:**

1. No mutation to S1-a or S1-b input or output contracts.
2. `identityCandidateReady` denotes comparison readiness, never actual Human Owner approval.
3. `MATCHED_REF_PRESENT` denotes the presence of a bound EvidenceRef, never evidence authenticity, executed tests, AC satisfaction, or acceptance.
4. Self-declared PASS/FAIL/EXECUTED must not be converted into independently verified observations.
5. No caller-supplied `approved: true` flag, revision string, digest claim, URL, or fixture marker may elevate Owner authority.
6. If Owner approval cannot be independently established by a previously authorized external trust boundary, formal deviation verdict remains `UNKNOWN` in the initial runtime MVP.

## 4. Input provenance and minimum contract

### 4.1 Plan identity and the scope block

The S1-c input carries:

- An unmodified S1-a `LoaderResult` (comparison candidate).
- The **raw bytes of the referenced Plan document**, supplied as an explicit bounded read-only input.
- An explicit supplied ChangeSet or an explicit `UNAVAILABLE` state.
- An S1-b input (EvidenceRefs and the same baseline); use the existing `bindEvidence()` locally rather than treating an arbitrary standalone BinderResult as validated against this task.

S1-c locates the unique selected `kind: 'plan'` and `kind: 'task'` among `selectedRefs`. Before extracting Task permissions, calculate SHA-256 of the Plan bytes and compare with the selected Plan's `expectedDigest` and `observedDigest`. All must match; selected `digestOutcome` must be `MATCH`. In addition, require a structurally valid, ready S1-a baseline according to the same baseline checks already implemented for S1-b (reuse `inspectBaseline`, not an approximate replica).

**This proves only equality with the S1-a supplied identity candidate.** It does not verify who pinned that candidate or whether an Owner-approved Plan has been superseded externally.

A Plan can optionally contain **one explicitly delimited, machine-readable S1-c Task Scope Policy per Task**. A multi-Task Plan may have several blocks, but the selected Task must match exactly one. Candidate serialization for R0.1:

```text
<!-- justice:s1c-task-scope:begin -->
{
  "schemaVersion": "justice-s1c-task-scope-v1",
  "planRef": {"artifactId": "plan-001", "revision": "R0.1"},
  "taskRef": {"artifactId": "task-001", "revision": "R0.1"},
  "scopeKey": "S1-c",
  "allowedPaths": ["src/core/s1c/**", "tests/s1c/**"]
}
<!-- justice:s1c-task-scope:end -->
```

This is a **proposed optional format**, not an instruction to modify existing Plans. Only the exact source bytes (not a free-standing claimed extracted object) establish that a block belongs to the supplied Plan. Parse bounded blocks, select the **unique** block whose `taskRef` matches the S1-a selected Task, and require exact `planRef`, `taskRef`, `scopeKey` matching the selected S1-a references. A duplicate block for the selected Task is invalid; a block for another Task does not grant permission to the selected Task. No fuzzy version comparison, alias, relative reference, natural-language inference, or automatic previous-revision fallback. If no selected-Task block exists, return `UNKNOWN` with `SCOPE_POLICY_UNDEFINED`; if the selected block is contradictory, malformed, duplicated or unparseable, return `UNKNOWN` with a specific safe diagnostic. Do not assume a missing block means an empty allowlist.

A dedicated validator enforces strict JSON (no duplicate object keys), exact schema/fields, size/entry limits, safe identifiers and safe paths. Detailed mechanical limits can be tuned during an approved Implementation Plan without altering the trust model; baseline candidates are `128` Task policy blocks per Plan, `128` allowlist entries per selected Task, `128` changes, `1024` characters per path and a Plan byte limit no greater than the S1-a artifact ceiling.

### 4.2 Minimal ChangeSet

Proposed shape, illustrative rather than compiled code:

```typescript
type ChangedPath = Readonly<
  | { kind: 'ADD' | 'MODIFY' | 'DELETE'; path: string }
  | { kind: 'RENAME'; oldPath: string; newPath: string }
>;
type ChangeSet = Readonly<
  | { availability: 'UNAVAILABLE' }
  | { availability: 'PRESENT'; changes: readonly ChangedPath[] }
>;
```

`PRESENT` and `changes: []` mean that **the supplied snapshot contains zero recorded changes**; they do not prove that a full Host/repository diff was independently collected. `UNAVAILABLE` and a missing field are distinct from an explicit empty array; missing/invalid input yields `UNKNOWN`, never a claim of compliance. This input is not a trusted observer and its completeness is not established by S1-c.

Accept only repository-relative POSIX-style paths: no leading slash, backslash, `.` or `..` segments, NUL/control characters, empty segments, or URL/drive syntax. Paths are case-sensitive and never normalized into a different identity. Full matching is against supplied paths only; no filesystem traversal, symlink resolution, Host probing, or implicit Git ignore processing. A rename must check **both** old and new paths; a delete checks its old path.

### 4.3 Allowlist syntax

Use only exact file matches (`src/a.ts`) and a directory-prefix suffix (`src/core/s1c/**`). The suffix means descendant files, not the directory token alone. No wildcard in another position, brace expansion, negation, regex, or overlaps with deny rules. Both the allowlist and changes must be validated before any successful comparison is output. An explicitly present `allowedPaths: []` is a valid **empty permission set**, materially different from no Scope Policy.

### 4.4 External Owner authority

S1-c v1 **does not implement an authorization provider**, does not accept self-declared trust flags, and has no method to mint or verify approval evidence. In production-style S1-c calls, the verified Owner-authority state available to this component is **not established**. Therefore its *formal* verdict is `UNKNOWN`.

A future S2+ integration may supply verified authority by a separately authorized and demonstrably trustworthy boundary, but that future extension must not be predeclared as present. Unit fixtures may assume an authorized policy **only inside the pure comparison tests**; that assumption is not transferred into runtime authority state.

## 5. Two-level result and semantics

The output explicitly separates **candidate comparison** from **formal deviation verdict**:

```typescript
type DeviationVerdict =
  | 'NO_DEVIATION_DETECTED'
  | 'DEVIATION_DETECTED'
  | 'UNKNOWN';

type CandidateScopeComparison =
  | 'WITHIN_CANDIDATE_SCOPE'
  | 'OUTSIDE_CANDIDATE_SCOPE'
  | 'UNKNOWN';

type DiagnosticCode =
  | 'S1A_BASELINE_NOT_READY'
  | 'PLAN_IDENTITY_MISMATCH'
  | 'SCOPE_POLICY_UNDEFINED'
  | 'SCOPE_POLICY_INVALID'
  | 'SCOPE_POLICY_REFERENCE_MISMATCH'
  | 'CHANGESET_UNAVAILABLE'
  | 'CHANGESET_INVALID'
  | 'OUTSIDE_CANDIDATE_SCOPE'
  | 'S1B_INPUT_REJECTED'
  | 'S1B_BASELINE_UNKNOWN'
  | 'S1B_BINDING_MISMATCH'
  | 'AC_EVIDENCE_REF_MISSING'
  | 'OWNER_AUTHORITY_NOT_VERIFIED';

type S1cResult = Readonly<{
  schemaVersion: 'justice-s1c-result-v1';
  formalVerdict: DeviationVerdict;
  candidateScopeComparison: CandidateScopeComparison;
  ownerAuthorityVerification: 'NOT_VERIFIED_BY_S1C';
  diagnostics: readonly Readonly<{
    code: DiagnosticCode;
    path?: string;       // validated, repository-relative only
    evidenceId?: string; // validated S1-b identifier only
    acId?: string;       // validated S1-a identifier only
  }>[];
  limitations: readonly string[];
}>;
```

`formalVerdict` remains `UNKNOWN` in the initial runtime MVP because S1-c cannot verify trusted Owner authority. The **pure path comparison**, tested with a fixture assumption of authorization, yields `NO_DEVIATION_DETECTED` or `DEVIATION_DETECTED` as its comparator verdict and is mapped to `WITHIN_CANDIDATE_SCOPE` or `OUTSIDE_CANDIDATE_SCOPE` in the public result. The same words must never imply that the runtime approved the Plan.

For example, with an unverified Owner authority and a Plan-byte-matched policy:

- All supplied changes within candidate scope → `formalVerdict: UNKNOWN`, `candidateScopeComparison: WITHIN_CANDIDATE_SCOPE`.
- One supplied change outside candidate scope → `formalVerdict: UNKNOWN`, `candidateScopeComparison: OUTSIDE_CANDIDATE_SCOPE`, path-specific diagnostic `OUTSIDE_CANDIDATE_SCOPE`.
- No block, no ChangeSet, invalid input or Plan identity mismatch → `formalVerdict: UNKNOWN`, `candidateScopeComparison: UNKNOWN`.

An externally authorized adapter could eventually bind a verified Owner decision to the precise Plan digest, Task identity and Scope and produce a trusted formal verdict, but **that is not a part of S1-c v1**.

## 6. S1-b evidence diagnostics without trust promotion

S1-c reuses S1-b's `bindEvidence({schemaVersion: 'justice-s1b-input-v1', baseline, evidenceRefs})` and interprets its structured output. It must not accept `bindingStatus: MATCH` from an arbitrary uncorrelated BinderResult as proof of correct attribution.

- `INPUT_REJECTED` → diagnostic `S1B_INPUT_REJECTED`; do not emit partial success.
- `BASELINE_UNKNOWN` → diagnostic `S1B_BASELINE_UNKNOWN`; never infer missing AC evidence.
- `bindingStatus: MISMATCH` → emit `S1B_BINDING_MISMATCH` associated with validated evidence ID, preserving S1-b's reason codes in an optional typed extension if needed.
- `coverageStatus: MISSING_EVIDENCE` → emit `AC_EVIDENCE_REF_MISSING`. This means **no matching reference supplied**, not "AC failed" or "task failed".
- `reportedOutcome: FAIL` or `NOT_EXECUTED` remains a **reported claim**, not an independently observed execution result.

These are additional diagnostics. **They never independently elevate the formal S1-c verdict or the underlying Owner approval.** If S1-b cannot be evaluated, Scope comparison may still be reported as a candidate; do not make unrelated diagnostic work fail simply because another category is unknown.

## 7. Deterministic evaluation order

1. Strictly validate the S1-c envelope and bounded inputs; reject unknown keys and malformed paths without echoing attacker-controlled raw text. Fail to `UNKNOWN`, never partially claim clean results.
2. Inspect the S1-a baseline using the existing S1-b baseline checks. If it is not ready or malformed, report `S1A_BASELINE_NOT_READY`, and do not claim a Plan-based scope verdict.
3. Select exactly the Plan and Task references, verify Plan raw-byte SHA-256 against selected expected/observed digest, and extract the single optional policy block.
4. Check policy-to-selected-Plan/Task/Scope identity; undefined or contradictory input produces `UNKNOWN`, not an allowlist fabricated by the caller.
5. Validate all ChangeSet entries, paths and allowlist paths. Do not use a valid subset when any entry is invalid.
6. For a fully comparable candidate, compare all touched paths to the allowlist; aggregate `OUTSIDE_CANDIDATE_SCOPE` if **any** path is outside, otherwise `WITHIN_CANDIDATE_SCOPE`. Explicit empty policy + nonempty changes = outside. Policy missing + any changes = `UNKNOWN`.
7. Independently obtain S1-b results for the same immutable baseline and EvidenceRefs, translate binding/coverage gaps into diagnostics, and retain their verification limitations.
8. Return immutable, stably sorted results. Sort offending paths lexicographically and diagnostics by fixed code priority then path/evidence/AC. Same logical inputs produce the same diagnostics regardless of ChangeSet enumeration order.
9. Enforce `ownerAuthorityVerification: NOT_VERIFIED_BY_S1C` and `formalVerdict: UNKNOWN` in the v1 runtime result. No acceptance, Review, Fix, Gate, HOLD or workflow control side effects.

The design's deterministic candidate conclusion is about **supplied changes compared to Plan-byte-bound candidate permissions**, not an authenticated complete Host diff.

## 8. Acceptance fixtures (S1-e static, no execution yet)

| Case | Internal comparator / candidate result | Formal runtime result | Key assertion |
| --- | --- | --- | --- |
| Selected Plan content and explicit allowlist, all changes allowed | `NO_DEVIATION_DETECTED` / `WITHIN_CANDIDATE_SCOPE` | `UNKNOWN` | No false path violation; authority not promoted |
| One change outside allowlist | `DEVIATION_DETECTED` / `OUTSIDE_CANDIDATE_SCOPE` | `UNKNOWN` | Exact changed path reported as candidate violation |
| Plan omits allowlist | `UNKNOWN` | `UNKNOWN` | `SCOPE_POLICY_UNDEFINED`, normal workflow unaffected |
| Present policy with `allowedPaths: []`, one change | `DEVIATION_DETECTED` / `OUTSIDE_CANDIDATE_SCOPE` | `UNKNOWN` | Empty set distinct from undefined |
| ChangeSet is `UNAVAILABLE` | `UNKNOWN` | `UNKNOWN` | No scope-compliance claim |
| No trusted Owner confirmation, candidate allowed/outside | Candidate result retained | `UNKNOWN` | No promotion from identity or local SHA match |
| Plan bytes or Plan/Task reference mismatch | `UNKNOWN` | `UNKNOWN` | Identity mismatch surfaced; no false approved-scope deviation |
| Two policy blocks for the selected Task | `UNKNOWN` | `UNKNOWN` | Ambiguous permission set not adopted |
| Rename crossing the boundary | `DEVIATION_DETECTED` / `OUTSIDE_CANDIDATE_SCOPE` | `UNKNOWN` | Compare both endpoints |
| One invalid entry in mixed ChangeSet | `UNKNOWN` | `UNKNOWN` | No partial clean conclusion |
| S1-b EvidenceRef bound to wrong Task/Revision/Scope | Independent S1-b mismatch diagnostics | `UNKNOWN` | No duplicate binding implementation; correct linkage |
| S1-b mandatory AC has no matching EvidenceRef | `AC_EVIDENCE_REF_MISSING` diagnostic | `UNKNOWN` | Reference absence is not proven AC failure |
| S1-b reports PASS or NOT_EXECUTED | Preserve reported claim | `UNKNOWN` | No execution/authenticity inference |

The **three minimum comparator fixtures** are allowed, outside and undefined. A Plan-identity mismatch negative is mandatory; the remaining rows are bounded, inexpensive safety regression cases, not a new review loop.

## 9. Trust, safety, operational boundaries

- **No source or external changes:** this design is READ_ONLY and DOCUMENT_ONLY. No automatic GitHub comments, branch, commit, PR, test, CI, review dispatch or gate modification.
- **Non-blocking:** `UNKNOWN` does not interrupt ordinary Superpowers task execution. It also cannot authorize an acceptance or sensitive action that independently requires proven scope/Owner authority; existing protected operations fail closed at their actual authority boundary.
- **Not a Host control:** S1-c reports diagnostics and never promises that an unauthorized side effect has been prevented.
- **Not a complete-diff guarantee:** Present ChangeSet input only proves what paths were supplied; trusted collection/completeness remains outside the MVP.
- **No unnecessary review cycles:** complete S1-c design at Owner sign-off; produce an Implementation Plan only after separate explicit approval, then seek implementation authorization separately as necessary.

## 10. Completion and stopping conditions

**Design complete when:** inputs, trust boundary, result vocabulary, deterministic matching semantics, S1-a/b reuse, missing-data behavior and fixture acceptance matrix are agreed by Human Owner. No independent review or new document iteration is automatically required.

**Implementation complete when separately authorized and demonstrably tested:** the specified core contract produces the expected fixture outputs; S1-a/b types and authority limitations remain unchanged; there are no mutation or Host-enforcement side effects; UNKNOWN is not promoted; no review or Gate automations are triggered. Stop at this Task boundary and return to Owner checkpoint.

**Current stop:** This is a candidate design for Owner approval, not an adopted Design, an Implementation Plan, source code, or an executed test result.

## 11. Owner decision requested

Approve (or request a bounded modification of) **the two-level S1-c contract**:

1. Read an optional strict machine-readable Task Scope Policy directly from SHA-256-matched Plan bytes; absent/ambiguous policy => `UNKNOWN`.
2. Evaluate a deterministic candidate scope comparison independently of Owner trust.
3. Keep the formal v1 runtime verdict `UNKNOWN` until a separately authorized, trustworthy external authority boundary exists; test comparator positive/negative cases under explicit fixture assumptions only.
4. Reuse S1-b without claiming evidence authenticity, execution verification, or AC satisfaction.

Approval of this design **does not** authorize an Implementation Plan unless the Human Owner explicitly requests one, nor does it authorize any source modifications, tests, GitHub writes or Gate/HOLD changes.
