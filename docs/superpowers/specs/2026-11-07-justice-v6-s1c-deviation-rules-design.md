# Justice v6 — S1-c Deviation Rules
## Design R0.1.1 — F001–F003 bounded documentary correction candidate

- Date: 2026-11-07 (JST)
- Repository: `yohi/justice`
- Issue: https://github.com/yohi/justice/issues/352
- Status: `R0.1_OWNER_ADOPTED_WITH_LIMITATIONS / R0.1.1_DOCUMENT_CORRECTION_CANDIDATE / R0.1.1_OWNER_DECISION_PENDING / CODE_IMPLEMENTATION_NOT_AUTHORIZED`
- Authority: `F001_F003_LOCAL_DOCUMENT_CORRECTION_APPROVED / NO_GITHUB_WRITE / NO_BUILD_OR_TEST / NO_GATE_OR_HOLD_CHANGE`
- Scope: S1-c Host-independent, deterministic, read-only diagnostic Core. S2–S5 excluded.

> **Decision scope:** The Human Owner adopted original Design R0.1 with limitations (`ADOPT_S1C_DESIGN_R0_1_WITH_LIMITATIONS`). The present R0.1.1 is a **bounded documentary correction candidate** for review findings JV6-S1C-DES-R1-F001/F002/F003, authorized for local document editing only. Its contents are not automatically adopted by the prior R0.1 decision. The Owner's brainstorming inputs remain `APPROVE_S1C_PLAN_BOUND_TASK_SCOPE_WITH_UNKNOWN_NON_BLOCKING` and `S1C_EXTERNAL_OWNER_AUTHORITY_TRUST_BOUNDARY_WITH_UNKNOWN_FALLBACK`. No Implementation Plan, source change, test, repository write or Gate/HOLD action follows automatically.

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

The S1-c input carries these exact top-level fields (normative candidate TypeScript interface; validation semantics follow §7):

```typescript
type S1cInput = Readonly<{
  schemaVersion: 'justice-s1c-input-v1';
  baseline: LoaderResult;              // S1-a imported type
  planBytes: Uint8Array;              // raw Plan artifact bytes
  changeSet: ChangeSet;               // §4.2
  evidenceRefs: readonly EvidenceRefV1[]; // S1-b imported type
}>;
```

The S1-c input carries:

- An unmodified S1-a `LoaderResult` (comparison candidate).
- The **raw bytes of the referenced Plan document**, supplied as an explicit bounded read-only input.
- An explicit supplied ChangeSet or an explicit `UNAVAILABLE` state.
- An S1-b input (EvidenceRefs and the same baseline); use the existing `bindEvidence()` locally rather than treating an arbitrary standalone BinderResult as validated against this task.

S1-c locates the unique selected `kind: 'plan'` and `kind: 'task'` among `selectedRefs`. Before extracting Task permissions, calculate SHA-256 of the Plan bytes and compare with the selected Plan's `expectedDigest` and `observedDigest`. All must match; selected `digestOutcome` must be `MATCH`. In addition, require a structurally valid, ready S1-a baseline according to the same baseline checks already implemented for S1-b (reuse `inspectBaseline`, not an approximate replica).

**This proves only equality with the S1-a supplied identity candidate.** It does not verify who pinned that candidate or whether an Owner-approved Plan has been superseded externally.

A Plan can optionally contain **one explicitly delimited, machine-readable S1-c Task Scope Policy per Task**. A multi-Task Plan may have several blocks, but the selected Task must match exactly one. The following is a **documentation example only**: it is not an active Policy when it appears inside a Markdown fenced code block.

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

This is a **proposed optional format**, not an instruction to modify existing Plans. Only the exact source bytes (not a free-standing claimed extracted object) establish that a block belongs to the supplied Plan. No fuzzy version comparison, alias, relative reference, natural-language inference, or automatic previous-revision fallback applies. An absent policy is **not** an empty allowlist.

**Normative Markdown recognition algorithm (F001, not a general Markdown renderer):**

1. Verify the raw Plan SHA-256 and ready S1-a baseline **before** interpreting content. Decode Plan bytes as strict UTF-8 (no BOM); split into lines using LF or CRLF without changing the hashed bytes. A bare CR or invalid UTF-8 makes the policy unreadable (`SCOPE_POLICY_INVALID`). Compare each logical line without its line-ending bytes.
2. Scan the document once in source order. Recognize fenced-code regions opened by a line indented at most three ASCII spaces followed by **at least three** backticks (`` ` ``) or tildes (`~`), optionally followed by info text. A backtick opener cannot have a backtick in its info text. A closer has at most three leading spaces, the same fence character repeated at least the opening run length, and only spaces/tabs after it. Ignore headings and policy markers on every line within a fence, including the opener/closer. Ignore indented-code lines (at least four leading spaces or an initial tab), blockquote/list-prefixed lines, and content within ordinary multi-line HTML comments. The exact standalone S1-c marker lines defined below are exceptions to ordinary HTML-comment scanning and **do not** open an HTML-comment region.
3. The sole authorization-bearing region begins at one unquoted, unindented, unfenced line **exactly** `## Justice S1-c Task Scope Policies`. It ends immediately before the next unquoted, unindented, unfenced Markdown ATX heading of level 1 or 2 (`# ` or `## ` at column zero), or at EOF. A second exact policy-section heading anywhere outside ignored regions makes the extraction ambiguous (`SCOPE_POLICY_INVALID`). A heading appearing only inside a code fence, blockquote, indented code or HTML comment does not create a region.
4. **Inside this region only**, each policy block starts with the complete line `<!-- justice:s1c-task-scope:begin -->` and ends with the complete line `<!-- justice:s1c-task-scope:end -->`, both at column zero with **no surrounding whitespace**. The sole content between them is exactly one strict UTF-8 JSON object. Marker-like lines outside the region are non-authoritative; marker-like lines inside ignored Markdown regions are examples, not live markers. Inside the active region, an unpaired, reversed, nested, altered or duplicate delimiter, or a non-ignored line containing `<!-- justice:s1c-task-scope:` without matching the exact standalone marker, makes the **whole policy extraction invalid** (`SCOPE_POLICY_INVALID`). A block cannot cross the region boundary. Ordinary prose outside a block has no Policy effect.
5. Validate **all** recognized blocks atomically, including non-selected Tasks: duplicate JSON keys, malformed structure, unknown fields, invalid identifiers/paths, duplicate Task `artifactId` blocks, or limits exceeded yield `SCOPE_POLICY_INVALID` and no candidate comparison. Select by the S1-a Task `artifactId`; if there is no selected-Task block, yield `SCOPE_POLICY_UNDEFINED`. If the selected Task ID occurs but its revision, Plan ID/revision or `scopeKey` disagrees with the S1-a selection, yield `SCOPE_POLICY_REFERENCE_MISMATCH`. Exactly one valid selected block with matching `planRef`, `taskRef` and `scopeKey` is usable. A Policy for another Task never grants permissions to the selected Task. No raw invalid marker, JSON or path is echoed in diagnostics.
6. If the policy heading is absent, or only explanatory examples appear in fenced/quoted/indented sections, return `candidateScopeComparison: UNKNOWN` and `SCOPE_POLICY_UNDEFINED`, even if the raw Plan SHA matches. No code fragment acquires permission merely because it was included in the digest-matched Plan.

This restricted parser is intentionally specified independently of unspecified Markdown renderer behavior. The active region is optional; there is **no** migration requirement to add it to existing Plans.

A dedicated validator enforces strict JSON (no duplicate object keys), exact schema/fields, size/entry limits, safe identifiers and safe paths. For this candidate contract, enforce at most `128` Policy blocks per Plan, `128` allowlist entries per selected Task, `128` changes, `1024` UTF-8 bytes per path and a Plan byte limit of `8,388,608` (the S1-a single-artifact ceiling). A Policy JSON payload exceeds its bound if its UTF-8 bytes exceed `65,536`; such a block is invalid. Bounds are normative; an eventual Implementation Plan must not silently relax them.


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

// Import the existing S1-b type; never redeclare its reason vocabulary.
import type { BindingReasonCode, EvidenceRefV1 } from '../s1b/contract.js';
import type { LoaderResult } from '../s1a/contract.js';

type DiagnosticCode =
  | 'S1C_INPUT_INVALID'
  | 'S1A_BASELINE_INVALID'
  | 'S1A_BASELINE_NOT_READY'
  | 'PLAN_BYTES_INVALID'
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

type S1cDiagnostic = Readonly<
  | { code: 'S1B_BINDING_MISMATCH'; evidenceId: string;
      bindingReasonCodes: readonly BindingReasonCode[] }
  | { code: 'OUTSIDE_CANDIDATE_SCOPE'; path: string }
  | { code: 'AC_EVIDENCE_REF_MISSING'; acId: string }
  | { code: Exclude<DiagnosticCode,
      'S1B_BINDING_MISMATCH' | 'OUTSIDE_CANDIDATE_SCOPE' | 'AC_EVIDENCE_REF_MISSING'> }
>;

// Mandatory S1-c limitations, on every output path and in this exact order.
// Export this constant from src/core/s1c/contract.ts; do not concatenate
// S1-a/S1-b limitation arrays or add input-dependent entries.
export const S1C_LIMITATIONS = Object.freeze([
  'OWNER_APPROVAL_NOT_PROVEN',
  'SUPERSESSION_NOT_CHECKED',
  'CHANGESET_COMPLETENESS_NOT_VERIFIED',
  'EVIDENCE_AUTHENTICITY_NOT_VERIFIED',
  'HOST_EXECUTION_NOT_VERIFIED',
] as const);

type S1cResult = Readonly<{
  schemaVersion: 'justice-s1c-result-v1';
  formalVerdict: DeviationVerdict;
  candidateScopeComparison: CandidateScopeComparison;
  ownerAuthorityVerification: 'NOT_VERIFIED_BY_S1C';
  diagnostics: readonly S1cDiagnostic[];
  limitations: typeof S1C_LIMITATIONS;
}>;
```

`limitations` is mandatory and **identical on every output path**, including invalid envelope, malformed baseline, unavailable ChangeSet, and normal candidate comparisons. Its five values and order are defined by `S1C_LIMITATIONS` above; callers cannot supply, remove, reorder, or append entries. The result copies or freezes the fixed tuple and never treats it as a verified claim. The five S1-c codes preserve the relevant trust boundaries of S1-a/S1-b while explicitly covering unverified ChangeSet completeness; S1-c does not redefine or mutate the existing S1-a/S1-b `LIMITATIONS` constants.

`formalVerdict` remains `UNKNOWN` in the initial runtime MVP because S1-c cannot verify trusted Owner authority. The **pure path comparison**, tested with a fixture assumption of authorization, yields `NO_DEVIATION_DETECTED` or `DEVIATION_DETECTED` as its comparator verdict and is mapped to `WITHIN_CANDIDATE_SCOPE` or `OUTSIDE_CANDIDATE_SCOPE` in the public result. The same words must never imply that the runtime approved the Plan.

For example, with an unverified Owner authority and a Plan-byte-matched policy:

- All supplied changes within candidate scope → `formalVerdict: UNKNOWN`, `candidateScopeComparison: WITHIN_CANDIDATE_SCOPE`.
- One supplied change outside candidate scope → `formalVerdict: UNKNOWN`, `candidateScopeComparison: OUTSIDE_CANDIDATE_SCOPE`, path-specific diagnostic `OUTSIDE_CANDIDATE_SCOPE`.
- Missing Policy, unavailable/invalid ChangeSet, invalid **S1-c envelope or shared baseline**, or Plan identity mismatch → `formalVerdict: UNKNOWN`, `candidateScopeComparison: UNKNOWN`. **EvidenceRefs-only invalidity is an exception:** a fully valid, independently computed candidate Scope comparison is retained (§6–§7).

An externally authorized adapter could eventually bind a verified Owner decision to the precise Plan digest, Task identity and Scope and produce a trusted formal verdict, but **that is not a part of S1-c v1**.

## 6. S1-b evidence diagnostics without trust promotion

S1-c reuses S1-b's `bindEvidence({schemaVersion: 'justice-s1b-input-v1', baseline, evidenceRefs})` and interprets its structured output. It must not accept `bindingStatus: MATCH` from an arbitrary uncorrelated BinderResult as proof of correct attribution.

- `INPUT_REJECTED` → diagnostic `S1B_INPUT_REJECTED`; do not emit partial success.
- `BASELINE_UNKNOWN` → diagnostic `S1B_BASELINE_UNKNOWN`; never infer missing AC evidence.
- `bindingStatus: MISMATCH` → emit **one** `S1B_BINDING_MISMATCH` per validated `evidenceId`, with required `bindingReasonCodes: readonly BindingReasonCode[]`, copied unchanged and in S1-b's own order from the same `BindingResult.reasonCodes`. The array must be nonempty; it is never inferred from the ID or constructed by S1-c's own matching rules. This is the **required** typed diagnostic shape defined in §5, not an optional extension.
- `coverageStatus: MISSING_EVIDENCE` → emit `AC_EVIDENCE_REF_MISSING`. This means **no matching reference supplied**, not "AC failed" or "task failed".
- `reportedOutcome: FAIL` or `NOT_EXECUTED` remains a **reported claim**, not an independently observed execution result.

These are additional diagnostics. **They never independently elevate the formal S1-c verdict or the underlying Owner approval.** S1-c imports the real `BindingReasonCode` union from S1-b; it does not copy that enum, recreate bind rules or accept raw arbitrary `reasonCodes` supplied by a caller. Only safe validated `evidenceId` and S1-b-produced reason codes enter the mismatch diagnostic. Cases such as `TASK_NOT_SELECTED`, `TASK_REVISION_MISMATCH`, `SCOPE_MISMATCH`, `AC_NOT_SELECTED`, `AC_REVISION_MISMATCH`, and `AC_TASK_MISMATCH` remain distinguishable in the output. If EvidenceRefs are rejected, emit `S1B_INPUT_REJECTED` without partial binding or AC-coverage success, but retain independently valid candidate Scope diagnostics. If ChangeSet is invalid, the S1-b branch may still report its separately valid binding and coverage diagnostics; **neither branch can convert the other's unassessable state into a successful assurance verdict**.

## 7. Deterministic evaluation order

1. **Envelope gate.** Require one plain data record with exactly the top-level keys in `S1cInput` (§4.1), all keys present and no extras; validate `schemaVersion`, the required baseline slot and presence of `planBytes`, `changeSet`, and `evidenceRefs` before evaluating either branch. Wrong schema, missing field, unknown field, or non-object envelope → only `S1C_INPUT_INVALID` plus the mandatory `OWNER_AUTHORITY_NOT_VERIFIED`; return `candidateScopeComparison: UNKNOWN`, `formalVerdict: UNKNOWN`. **An existing field containing malformed `evidenceRefs` or `changeSet` is a branch-local invalid payload, not an envelope error.** A non-byte `planBytes` value is invalid input for the Scope branch; no candidate conclusion is emitted, while an independently usable S1-b branch can still run.
2. **Shared S1-a gate.** Call S1-b's `inspectBaseline` **directly once from S1-c**. This count excludes the independent **internal `inspectBaseline` re-inspection performed by `bindEvidence()`** when S1-c subsequently invokes it; S1-c neither bypasses nor modifies that S1-b check. `MALFORMED` → only `S1A_BASELINE_INVALID` plus the mandatory authority diagnostic; scope is `UNKNOWN` and do not run S1-b. Structurally valid `NOT_READY` → `S1A_BASELINE_NOT_READY`, scope `UNKNOWN`; invoke S1-b on structurally supplied EvidenceRefs and report `S1B_BASELINE_UNKNOWN` or `S1B_INPUT_REJECTED` according to its real result. A `READY` candidate permits the two independent branches below, **without proving Owner approval**.
3. **Scope branch.** With a ready baseline, check that `planBytes` is a bounded byte array, select exactly one Plan and Task, verify the Plan raw-byte SHA-256 against both S1-a selected digests and its `MATCH` outcome, then apply the §4.1 Markdown policy-recognition algorithm. A present but non-byte or oversized `planBytes` value → `PLAN_BYTES_INVALID` (**input unusable, not an observed digest mismatch**); two readable, structurally valid but unequal Plan digests → `PLAN_IDENTITY_MISMATCH` (observed contradiction); invalid UTF-8/markers/schema/limits → `SCOPE_POLICY_INVALID`; absent policy → `SCOPE_POLICY_UNDEFINED`; Policy identity mismatch → `SCOPE_POLICY_REFERENCE_MISMATCH`. Any of these yields `candidateScopeComparison: UNKNOWN` without suppressing independently valid S1-b diagnostics.
4. **ChangeSet branch dependency.** Independently validate the entire supplied ChangeSet with strict exact fields, finite length, legal enums and all paths. `UNAVAILABLE` → `CHANGESET_UNAVAILABLE`; malformed `PRESENT` or any invalid entry → `CHANGESET_INVALID`; either yields Scope `UNKNOWN` even if the Plan policy is valid, without suppressing valid S1-b diagnostics. A malformed ChangeSet cannot partially yield `WITHIN_CANDIDATE_SCOPE` or `OUTSIDE_CANDIDATE_SCOPE`. When both Plan Policy and ChangeSet are fully valid, compare all touched paths; **any** outside path yields `OUTSIDE_CANDIDATE_SCOPE`, else `WITHIN_CANDIDATE_SCOPE`. An explicit empty allowlist with a nonempty ChangeSet yields outside; an empty valid ChangeSet is within the **supplied snapshot only**. If both Policy and ChangeSet have independent defects, report both codes, but never emit a candidate Scope conclusion.
5. **Evidence branch.** With a structurally valid S1-a baseline, construct the exact S1-b input envelope from the **same baseline object** and the supplied `evidenceRefs`, and call the existing `bindEvidence` once. **That call performs S1-b's own internal `inspectBaseline` re-inspection**, in addition to S1-c's one direct check in step 2; it is not a second direct S1-c call. On `MALFORMED`, step 2 returns without invoking `bindEvidence`. `INPUT_REJECTED` → `S1B_INPUT_REJECTED` only for that branch; never emit partial `S1B_BINDING_MISMATCH` or `AC_EVIDENCE_REF_MISSING`. `BASELINE_UNKNOWN` → `S1B_BASELINE_UNKNOWN`; no missing-AC claim. `EVALUATED` → emit only actual typed mismatches and missing-ref coverage per §6. EvidenceRefs-only invalidity **does not erase** a separately completed candidate Scope comparison. Conversely, ChangeSet-only invalidity **does not erase** valid S1-b diagnostics. A caller-provided BinderResult is not an input.
6. **Fixed diagnostic construction.** Emit each applicable branch failure at most once; path violations are one per **distinct validated outside path**, ordered by exact UTF-8 byte lexical order. Each Evidence mismatch produces one typed diagnostic with its validated S1-b `evidenceId` and the original ordered `BindingReasonCode[]`. Missing coverage produces one per validated AC ID. The fixed code priority, highest first, is: `S1C_INPUT_INVALID`, `S1A_BASELINE_INVALID`, `S1A_BASELINE_NOT_READY`, `PLAN_BYTES_INVALID`, `PLAN_IDENTITY_MISMATCH`, `SCOPE_POLICY_INVALID`, `SCOPE_POLICY_REFERENCE_MISMATCH`, `SCOPE_POLICY_UNDEFINED`, `CHANGESET_INVALID`, `CHANGESET_UNAVAILABLE`, `OUTSIDE_CANDIDATE_SCOPE`, `S1B_INPUT_REJECTED`, `S1B_BASELINE_UNKNOWN`, `S1B_BINDING_MISMATCH`, `AC_EVIDENCE_REF_MISSING`, `OWNER_AUTHORITY_NOT_VERIFIED`. Within a code sort by validated `path`, then `evidenceId`, then `acId` using fixed case-sensitive bytewise order, not locale; duplicates of identical diagnostic identity are collapsed. Never echo invalid input, raw JSON, an exception, or an unchecked path. Do not reorder the inner S1-b `bindingReasonCodes`.
7. **Final immutable result.** Return `ownerAuthorityVerification: NOT_VERIFIED_BY_S1C`, `formalVerdict: UNKNOWN`, and **always** include one `OWNER_AUTHORITY_NOT_VERIFIED` diagnostic (even when an earlier gate failed). Freeze/copy outputs without mutating either S1-a or S1-b records. Do not run acceptance, Review, Fix, Gate, HOLD, Host actions or workflow stops.

**F002 four-case result matrix:** The diagnostics shown are the **minimal set** for the named condition, always in the fixed order above. When an independent branch also has a genuine finding, append its independently justified code in that order. No branch may invent a clean or accepted result to fill an unknown.

| Condition | `candidateScopeComparison` | `formalVerdict` | Mandatory diagnostics / preserved evidence |
| --- | --- | --- | --- |
| Invalid outer S1-c envelope (wrong schema, missing required field or unknown key) | `UNKNOWN` | `UNKNOWN` | `S1C_INPUT_INVALID`, `OWNER_AUTHORITY_NOT_VERIFIED`; **no S1-b evaluation** |
| Malformed S1-a shared baseline (`inspectBaseline = MALFORMED`) | `UNKNOWN` | `UNKNOWN` | `S1A_BASELINE_INVALID`, `OWNER_AUTHORITY_NOT_VERIFIED`; **no S1-b evaluation** |
| Valid ready baseline + valid Plan Policy + valid ChangeSet, but malformed EvidenceRefs | `WITHIN_CANDIDATE_SCOPE` or `OUTSIDE_CANDIDATE_SCOPE` according to the valid ChangeSet | `UNKNOWN` | `S1B_INPUT_REJECTED`, `OWNER_AUTHORITY_NOT_VERIFIED`, plus path-specific `OUTSIDE_CANDIDATE_SCOPE` if actually outside; **no partial binding/coverage diagnostics** |
| Valid ready baseline + valid EvidenceRefs, but malformed ChangeSet | `UNKNOWN` | `UNKNOWN` | `CHANGESET_INVALID`, `OWNER_AUTHORITY_NOT_VERIFIED` **plus any independently produced S1-b mismatch or missing-AC diagnostics**; no candidate Scope conclusion |

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
| Two policy blocks for the selected Task | `UNKNOWN` | `UNKNOWN` | `SCOPE_POLICY_INVALID`; ambiguous permission set not adopted |
| Same marker pair appears only inside a fenced `text`/`json` example, blockquote or indented code | `UNKNOWN` | `UNKNOWN` | `SCOPE_POLICY_UNDEFINED`, not an active allowlist |
| Duplicate active policy heading, unmatched/nested/altered active markers | `UNKNOWN` | `UNKNOWN` | `SCOPE_POLICY_INVALID`; no partial extraction |
| Malformed policy block for another Task in active section | `UNKNOWN` | `UNKNOWN` | Atomic policy rejection (no selected-block success) |
| Envelope has unknown field or required field missing | `UNKNOWN` | `UNKNOWN` | `S1C_INPUT_INVALID`; no S1-b result |
| S1-a baseline `MALFORMED` | `UNKNOWN` | `UNKNOWN` | `S1A_BASELINE_INVALID`, no S1-b evaluation |
| Scope Policy + ChangeSet valid, EvidenceRefs malformed | Valid candidate outcome retained | `UNKNOWN` | `S1B_INPUT_REJECTED`, no partial Evidence/AC success |
| Valid EvidenceRefs + ChangeSet malformed | `UNKNOWN` | `UNKNOWN` | `CHANGESET_INVALID`, valid S1-b diagnostics preserved |
| Rename crossing the boundary | `DEVIATION_DETECTED` / `OUTSIDE_CANDIDATE_SCOPE` | `UNKNOWN` | Compare both endpoints |
| One invalid entry in mixed ChangeSet | `UNKNOWN` | `UNKNOWN` | No partial clean conclusion |
| S1-b EvidenceRef bound to wrong Task/Revision/Scope/AC | Independent S1-b mismatch diagnostics | `UNKNOWN` | Preserve nonempty typed `bindingReasonCodes` from S1-b with unchanged order |
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

**Current stop (GitHub state at reviewed HEAD `8fcea46591146d40ef8b53de6724b7f49c592475`):** Original Design **R0.1 is Owner-adopted with limitations**. Design **R0.1.1** (F001–F003 correction) was **committed and pushed** on the S1-c feature branch at `6f898215ad6c2e3ea727042c96694e2bbb043f24`; its status remains **`R0.1.1_OWNER_DECISION_PENDING`**. The companion **Implementation Plan exists and was committed and pushed** at `8fcea46591146d40ef8b53de6724b7f49c592475`. Neither commit implies R0.1.1 adoption or implementation authorization. The F004–F006 documentary clarification does not itself grant adoption or implementation authority; no source implementation or test execution is evidenced by the cited document commits. Stop at the Human Owner checkpoint; no review, implementation, Gate/HOLD or GitHub action starts automatically.

## 11. Owner decision requested

The original two-level S1-c contract was adopted in Design R0.1. At the checkpoint, decide whether to **maintain that adoption scope and adopt only F001–F003 clarifications** in R0.1.1:

1. Read an optional strict machine-readable Task Scope Policy directly from SHA-256-matched Plan bytes; absent/ambiguous policy => `UNKNOWN`.
2. Evaluate a deterministic candidate scope comparison independently of Owner trust.
3. Keep the formal v1 runtime verdict `UNKNOWN` until a separately authorized, trustworthy external authority boundary exists; test comparator positive/negative cases under explicit fixture assumptions only.
4. Reuse S1-b without claiming evidence authenticity, execution verification, or AC satisfaction.

The prior D-3 permission concerning S1 Implementation Plan creation remains unchanged, but **this correction does not auto-start that Task**. Human Owner approval of this R0.1.1 correction will not authorize source modifications, tests, GitHub writes or Gate/HOLD changes. No independent re-review or additional Finding/Task loop is automatic.
