# Justice v6 S1-b Typed Evidence Binder Implementation Plan R0.1

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` **only after separate Human Owner adoption of the design and explicit implementation/test authorization**. Steps use checkbox (`- [ ]`) syntax for tracking. Do not automatically start reviews, new correction tasks, or follow-up work.

**Goal:** Implement a deterministic, Host-independent, READ_ONLY S1-b Core that binds typed EvidenceRefs to the S1-a-selected Task/Revision/Scope/AC identities and detects misattribution and missing references without claiming authenticity, execution proof, approval, or AC satisfaction.

**Architecture:** Consume the unmodified S1-a `LoaderResult` and a bounded, strict `EvidenceRefV1[]`. Validate the entire input first, classify the S1-a comparison candidate, and then return immutable per-Evidence bindings and per-mandatory-AC reference coverage. Keep validation, baseline inspection, and binding in small pure TypeScript modules, with an S1-e-style in-memory fixture harness; no Host, storage, CLI, Justice-v2 Evidence, or Gate integration.

**Tech Stack:** Repository TypeScript 6 (strict, ES2022, ESM), Bun, Vitest 4; reuse `src/core/s1a/contract.ts` and `tests/helpers/s1a-fixtures.ts`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-justice-v6-s1b-typed-evidence-binder-design.md` — **Design R0.1.1**, GitHub commit `b6bd1d30e99b8aa3462505d0c77c278e83027611`, blob `e8a789ab02d878abc90181161fe7cf38f37a9d4d`; Issue [#351](https://github.com/yohi/justice/issues/351).

**Intended repo path:** `docs/superpowers/plans/2026-11-06-justice-v6-s1b-typed-evidence-binder.md`.

**Authority at drafting:** `PLAN_CANDIDATE / DESIGN_OWNER_ADOPTION_PENDING / IMPLEMENTATION_NOT_AUTHORIZED / TEST_NOT_AUTHORIZED / NO_GITHUB_WRITE`. This plan may be reviewed or adopted separately by the Human Owner, but its existence does not grant permission to implement, test, commit, push, create PRs, operate a Host, change Gate/HOLD, or launch further reviews. All checked steps below are **future instructions, not work executed**.

## Global Constraints

- S1-b only; first use is S1-e static positive/negative fixtures. Do **not** implement S1-c, S2–S5, Review/Fix orchestration, Host Adapter, Evidence Store, CLI, approval API, Gate/HOLD operations, or direct Justice-v2 Evidence integration.
- `bindEvidence(input: BinderInput): BinderResult` is synchronous, deterministic, READ_ONLY and free of filesystem, network, shell, clocks, randomness, and global mutable state. Runtime validation still treats a statically typed `BinderInput` as potentially untrusted.
- Reuse S1-a's `LoaderResult`, `SelectedArtifactRef`, `S1A_LIMITS.selectedArtifacts=128`, `isSafeIdentifier`, and `isLowercaseSha256Hex` **without modifying S1-a source or types**. Exactly the selected AC refs are comparable; never infer a nonselected AC's parent or discover another Manifest.
- `justice-s1b-input-v1` and `justice-s1b-result-v1` are fixed schema versions. Reject unknown fields, `null` for optional fields, wrong enums, and duplicate `evidenceId`; use exact case-sensitive comparison with no normalization. Each identifier uses `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (1–64 ASCII characters). Optional digest is `{algorithm:'sha256', hex:<64 lowercase hex>}`. Maximum EvidenceRefs per invocation: **128**; at most one `acRef` per EvidenceRef.
- Collection validation is **atomic**. Any invalid element causes `INPUT_REJECTED`, empty `bindingResults`, `coverageAssessmentStatus: UNKNOWN`, and no partial `MATCH` or `MISSING_EVIDENCE`. When a ready and valid baseline exists, its known ACs may appear in `coverageResults` with `UNKNOWN` and empty `matchingEvidenceIds`; otherwise `coverageResults=[]`.
- Rejection reason priority (first detected highest-priority, independent of input order): `INPUT_SCHEMA_INVALID`, `BASELINE_SHAPE_INVALID`, `EVIDENCE_LIMIT_EXCEEDED`, `EVIDENCE_FIELD_INVALID`, `UNSAFE_IDENTIFIER`, `DUPLICATE_EVIDENCE_ID`. Only one `rejectionReasonCode` is emitted, from this finite enum. Keep all invalid input content out of diagnostics.
- A structurally valid but unready S1-a baseline produces `BASELINE_UNKNOWN`; every otherwise valid EvidenceRef gets binding `UNKNOWN` and `[BASELINE_NOT_READY]`, and Coverage is aggregate `UNKNOWN` with no `MISSING_EVIDENCE`. This differs from a malformed S1-a input, which is `INPUT_REJECTED`.
- Ready S1-a comparison requires `identityCandidateReady=true`, `identityStatus='MATCH'`, `manifestDigestMatch=true`, and coherent selected Design → Plan → one Task → mandatory AC identities. This is **only** an identity candidate: S1-a owner authority remains `NOT_PROVEN`, trust precondition `EXTERNAL_NOT_VERIFIED_BY_S1A`, and `eligibleBaseline=false`.
- Binding reason order (all independently observed reasons, each at most once): `TASK_NOT_SELECTED`, `TASK_REVISION_MISMATCH`, `SCOPE_MISMATCH`, `AC_NOT_SELECTED`, `AC_REVISION_MISMATCH`, `AC_TASK_MISMATCH`. Compare Task revision only on matching Task ID; AC revision and selected AC parent only on matching selected AC ID. Nonselected AC produces `AC_NOT_SELECTED`, never an inferred parent mismatch.
- Sort `bindingResults` by `evidenceId`; sort `coverageResults` by AC `artifactId`; sort each `matchingEvidenceIds` lexically; use straightforward case-sensitive ASCII ordering. Input evidence order must not change the structured result.
- AC coverage is **reference presence only**. `MATCHED_REF_PRESENT` requires a `MATCH` binding explicitly referencing that AC. No matching reference on a fully evaluated collection is `MISSING_EVIDENCE`; missing never implies `NOT_EXECUTED`. Task-level evidence without `acRef` never fills AC coverage.
- `reportedOutcome`, `reportedExecutionState`, `issuerId`, `originId`, `provenanceClass`, `contentDigest` are **unverified declarations**. Overall and per-Evidence `authenticityStatus` and `executionVerificationStatus` always equal `NOT_VERIFIED`. Never output `PROVEN`, acceptance `PASS`, or `AC_SATISFIED`; matching labels are not approval or actual Host execution proof.
- Return immutable plain-data objects and arrays. Do not mutate S1-a input, EvidenceRefs, S1-a limitations, or trust fields. Diagnostics use finite reason codes and optional already-validated IDs only—never raw evidence content, paths, invalid strings, or exception messages.
- Future TDD/commit steps are conditional on the Owner separately authorizing execution; no automatic independent review, review chain, or GitHub mutation is permitted by this plan.

## File structure (implementation-time only)

| File | Responsibility |
|---|---|
| **Create** `src/core/s1b/contract.ts` | Exact v1 type aliases, reason-code unions, 128-item limit, finite output limitations |
| **Create** `src/core/s1b/validation.ts` | Strict bounded EvidenceRef collection validation and deterministic rejection defect collection |
| **Create** `src/core/s1b/baseline.ts` | Pure S1-a LoaderResult structure/readiness inspection; selected Task/AC lookup only |
| **Create** `src/core/s1b/binder.ts` | Exported synchronous `bindEvidence`, mismatch reasons, coverage, atomic results and freezing |
| **Create** `tests/core/s1b/validation.test.ts` | Strict schema, limits, duplicates, priority, unsafe diagnostics |
| **Create** `tests/core/s1b/baseline.test.ts` | S1-a ready/unready/invalid boundaries |
| **Create** `tests/core/s1b/binder.test.ts` | Binding, reason ordering, Coverage rules, immutability |
| **Create** `tests/helpers/s1b-fixtures.ts` | Deterministic in-memory fixtures building on `s1aFixture()` |
| **Create** `tests/core/s1b/acceptance.test.ts` | S1-e positive/negative acceptance matrix and trust non-escalation |

**Existing read-only dependencies:** `src/core/s1a/contract.ts`, `src/core/s1a/loader.ts`, `tests/helpers/s1a-fixtures.ts`, `package.json`, `tsconfig.json`. Do **not** add `src/runtime` adapters, a new package script/bin, or `src/index.ts` exports during this S1-b MVP. Tests import `src/core/s1b/binder.js` directly, using the repository's existing ESM pattern.

## Review Focus — mapped to concrete test steps

1. **Forged ready flag with mismatching S1-a metadata:** `identityCandidateReady=true` while `identityStatus='UNKNOWN'`, `manifestDigestMatch=false`, or selected AC parent contradicts Task → **`BASELINE_SHAPE_INVALID`**, no success (Task 2).
2. **Mixed valid + invalid/duplicate evidence in either ordering:** complete rejection, empty bindings, no valid subset and deterministic reason priority (Task 1, Task 3).
3. **Unselected AC with attacker-supplied parent story:** report `AC_NOT_SELECTED` only; never manufacture ownership of an unknown AC (Task 3).
4. **Self-reported PASS or EXECUTED with matching IDs:** only `MATCH` attribution and optional reported fields; always `NOT_VERIFIED`, never acceptance/AC satisfaction (Task 4).
5. **Empty collection or unready baseline:** ready → all mandatory ACs `MISSING_EVIDENCE`; unready → aggregate Coverage `UNKNOWN` with zero missing claims (Task 3, Task 4).

---

### Task 1: Define exact S1-b contract and atomic EvidenceRef validation

**Files:**
- Create: `src/core/s1b/contract.ts`
- Create: `src/core/s1b/validation.ts`
- Test: `tests/core/s1b/validation.test.ts`

**Interfaces:**
- Consumes: `isSafeIdentifier()`, `isLowercaseSha256Hex()` and type `LoaderResult` from `src/core/s1a/contract.js`.
- Produces: all Design §3.2/§4.1 named types, `S1B_MAX_EVIDENCE_REFS = 128`, `S1B_LIMITATIONS` fixed readonly tuple, plus:

```typescript
export type EvidenceInspection = Readonly<{
  issueCodes: readonly InputRejectionReason[];
  refs: readonly EvidenceRefV1[] | null;
}>;
export function inspectEvidenceRefs(value: unknown): EvidenceInspection;
export function primaryRejectionReason(
  codes: readonly InputRejectionReason[]
): InputRejectionReason;
```

- `inspectEvidenceRefs` checks the **collection** value (array) and every element, never throws for malformed consumer input and never outputs invalid field contents. It gathers all applicable detected finite defect categories so Task 3 can apply global priority together with baseline/top-level defects. `refs` is non-null only for an entirely valid collection. Keep `issueCodes` unique and ordered by the specified rejection priority. The parent envelope's exact keys (`schemaVersion`, `baseline`, `evidenceRefs`) are checked by Task 3 as `INPUT_SCHEMA_INVALID`.
- `EvidenceRefV1` includes optional `reportedOutcome: 'PASS'|'FAIL'|'UNKNOWN'` and optional nested SHA-256 digest, exactly as the Design. `BinderResult` types must include exact `BindingResult`, `CoverageResult`, `EvaluationStatus`, `CoverageAssessmentStatus`, `InputRejectionReason` and verification statuses. Use type-only imports for S1-a.
- Fixed output `limitations` tuple (plan-selected literal values): `['OWNER_APPROVAL_NOT_PROVEN','EVIDENCE_AUTHENTICITY_NOT_VERIFIED','HOST_EXECUTION_NOT_VERIFIED']`. These are disclaimers, not verified status assertions; S1-a's original `limitations` array remains untouched.

- [ ] **Step 1: Write failing tests** for `acceptsValidEvidenceAndOptionalClaim`, `strictUnknownNestedFieldAndNullOptional`, `rejectsUnsafeIdAndDigest`, `rejects128Vs129Boundary`, `rejectsDuplicateEvidenceIdEvenWhenMixed`, `priorityIgnoresEvidenceOrdering`. Assertions: valid 128 → `refs.length===128`; 129 → issue `EVIDENCE_LIMIT_EXCEEDED`; duplicate → `DUPLICATE_EVIDENCE_ID`; 65-character/ANSI ID → `UNSAFE_IDENTIFIER`; malformed enum/nested field → `EVIDENCE_FIELD_INVALID`; missing/invalid array → `INPUT_SCHEMA_INVALID`; simultaneous invalid enum and duplicate selects `EVIDENCE_FIELD_INVALID` over duplicate. `JSON.stringify(issueCodes)` must not contain attack strings.
- [ ] **Step 2: Verify RED**: `bun run vitest run tests/core/s1b/validation.test.ts` → expected FAIL before implementation (missing module/function).
- [ ] **Step 3: Implement the type definitions and strict validation** in the two specified files. Use explicit allowed-key sets, `Object.prototype.hasOwnProperty.call` where needed, exact enums, S1-a identifier/digest helpers, a Set for duplicates. Do not add an I/O parser, schema library dependency, side effects, or coercion. Stop inspection before allocating output proportional to unbounded input; a collection beyond 128 is rejectable without cloning it.
- [ ] **Step 4: Verify GREEN**: `bun run vitest run tests/core/s1b/validation.test.ts` → PASS; then `bun run typecheck` → PASS.
- [ ] **Step 5: Commit only if separately authorized**: `git add src/core/s1b/contract.ts src/core/s1b/validation.ts tests/core/s1b/validation.test.ts && git commit -m "feat(s1b): define typed evidence contract and atomic validation"`. Do not push without separate approval.

### Task 2: Inspect S1-a identity candidate without authority promotion

**Files:**
- Create: `src/core/s1b/baseline.ts`
- Test: `tests/core/s1b/baseline.test.ts`

**Interfaces:**
- Consumes: S1-a's unmodified `LoaderResult`, `SelectedArtifactRef`, `S1A_LIMITS`, `isSafeIdentifier`, `isLowercaseSha256Hex`.
- Produces:

```typescript
type ReadySelection = Readonly<{
  task: SelectedArtifactRef;
  acs: readonly SelectedArtifactRef[];
}>;
export type BaselineInspection =
  | Readonly<{ state: 'READY'; selection: ReadySelection }>
  | Readonly<{ state: 'NOT_READY' }>
  | Readonly<{ state: 'MALFORMED' }>;
export function inspectBaseline(value: unknown): BaselineInspection;
```

- Validate S1-a `schemaVersion`, typed readiness/status/digest/authority fields, selectedRefs as bounded records with correct kinds, IDs, revisions, scopes, digest shapes, expected vs observed digest outcome, and unique identities. A **ready** selection requires one `design`, one `plan`, one `task`, at least one `ac`, total 4–128 refs; Design→Plan→Task→AC parent links and scopes consistent; all selected artifact digests `MATCH`, observed==expected, plus readiness/status/digest equality. Malformed/internally contradictory combinations are `MALFORMED`. Valid S1-a outputs with `identityCandidateReady=false` remain `NOT_READY` even when `selectedRefs=[]` or partial checks are present; do not manufacture an AC set. Validate known S1-a `checks`/`limitations` container shapes without treating approvalRef claims as authority.
- A ready identity candidate is still never an approved baseline. Do not copy or modify `LoaderResult` fields; the returned selection references validated records read-only.

- [ ] **Step 1: Write failing tests** `readyLoaderFixtureIsCandidateNotAuthority`, `mismatchedManifestOrDirtyArtifactCannotBecomeReady`, `forgedReadyWithWrongIdentityRejected`, `invalidParentOrDuplicateSelectedIdRejected`, `normalUnknownAndPartialS1aIsNotReady`, `atMost128Selected`. Use `s1aFixture()` + `loadS1aArtifacts()` for authentic in-memory positive/negative S1-a shapes, and explicit shallow-clone tampering for malformed ones. Assert `baseline.eligibleBaseline === false` before/after, with identity/authority/limitations unchanged.
- [ ] **Step 2: Verify RED**: `bun run vitest run tests/core/s1b/baseline.test.ts` → FAIL.
- [ ] **Step 3: Implement `inspectBaseline(value: unknown): BaselineInspection`** in `src/core/s1b/baseline.ts`. Distinguish legitimate S1-a unready results from impossible ready combinations; never accept a self-reported Owner-proven state or external AC identity. Do not call S1-a Loader or read files inside production Core.
- [ ] **Step 4: Verify GREEN**: `bun run vitest run tests/core/s1b/baseline.test.ts` → PASS; `bun run typecheck` → PASS.
- [ ] **Step 5: Commit only if separately authorized**: `git add src/core/s1b/baseline.ts tests/core/s1b/baseline.test.ts && git commit -m "feat(s1b): validate S1-a comparison candidate"`.

### Task 3: Implement deterministic Binder and AC reference coverage

**Files:**
- Create: `src/core/s1b/binder.ts`
- Test: `tests/core/s1b/binder.test.ts`

**Interfaces:**
- Consumes: Task 1 types / `inspectEvidenceRefs()` / `primaryRejectionReason()`, Task 2 `inspectBaseline()`, existing S1-a `LoaderResult` (type only).
- Produces: `export function bindEvidence(input: BinderInput): BinderResult` (also validate at runtime as if the argument were `unknown`); no async/Host API.

- [ ] **Step 1: Write failing tests** `matchAndTaskLevelEvidence`, `wrongTaskAndRevisionAndScopeReasons`, `unknownAcNeverInventsParent`, `selectedAcWithWrongDeclaredTaskReportsParent`, `reasonArrayOrderStableUnderInputPermutation`, `invalidCollectionHasZeroPartialBindings`, `unreadyBaselineHasNoMissingCoverage`, `emptyReadyCollectionHasAllMissing`, `outputFrozenAndInputsUntouched`. Exact outcomes:

```typescript
// From s1aFixture(): task-1 R1 scope-1; ac-1 R1 and ac-2 R1.
expect(bindEvidence(validInput).evaluationStatus).toBe('EVALUATED');
expect(bindEvidence(validInput).bindingResults[0]?.bindingStatus).toBe('MATCH');
expect(bindEvidence(validInput).authenticityStatus).toBe('NOT_VERIFIED');
// A valid but nonselected AC reports exactly AC_NOT_SELECTED, not an invented parent.
expect(bindEvidence(unselectedAcInput).bindingResults[0]?.reasonCodes)
  .toEqual(['AC_NOT_SELECTED']);
// With no EvidenceRefs, a ready baseline has two missing ACs, not failed executions.
expect(bindEvidence(emptyReadyInput).coverageResults.map(x=>x.coverageStatus))
  .toEqual(['MISSING_EVIDENCE','MISSING_EVIDENCE']);
```

- [ ] **Step 2: Verify RED**: `bun run vitest run tests/core/s1b/binder.test.ts` → FAIL.
- [ ] **Step 3: Implement `bindEvidence(input: BinderInput): BinderResult`** with the following exact orchestration:
  1. Validate exact top-level envelope; collect `INPUT_SCHEMA_INVALID` if malformed. Independently inspect baseline and evidence where safely accessible.
  2. Collect all known defects, then select the highest-priority rejection reason from Global Constraints. For rejected input, return empty bindings, Coverage aggregate `UNKNOWN`, and either per-known-ready-AC `UNKNOWN` coverage with empty IDs or empty coverage if no ready selection exists.
  3. For valid input with structurally sound but unready baseline: sorted per-evidence `UNKNOWN` bindings with `[BASELINE_NOT_READY]`, aggregate Coverage `UNKNOWN`, no AC coverage records.
  4. For ready candidate: compare the exact selected Task ID, revision and scope, optional selected AC ID/revision, and selected AC parent against the **declared** task ID. Build unique mismatch reasons in normative priority. `MATCH` iff no observed mismatch; no evidence content/digest/issuer verification. Preserve reported fields without changing their meaning.
  5. Create one sorted `CoverageResult` per selected mandatory AC: `MATCHED_REF_PRESENT` only for explicitly AC-bound `MATCH` EvidenceRefs; else `MISSING_EVIDENCE`. Set aggregate `coverageAssessmentStatus='ASSESSABLE'` only on fully evaluated ready inputs.
  6. Return frozen copies of result arrays and nested records. Populate fixed `limitations` and `NOT_VERIFIED` statuses at both levels. No timestamps, logs, I/O or mutation.
- [ ] **Step 4: Verify GREEN**: `bun run vitest run tests/core/s1b/binder.test.ts` → PASS; `bun run typecheck` → PASS.
- [ ] **Step 5: Commit only if separately authorized**: `git add src/core/s1b/binder.ts tests/core/s1b/binder.test.ts && git commit -m "feat(s1b): bind evidence and assess AC reference presence"`.

### Task 4: S1-e static fixture acceptance and final bounded verification

**Files:**
- Create: `tests/helpers/s1b-fixtures.ts`
- Create: `tests/core/s1b/acceptance.test.ts`
- Test: same acceptance test; existing S1-a tests remain unmodified.

**Interfaces:**
- Consumes: `s1aFixture()`, `loadS1aArtifacts()` from existing S1-a test helpers/Core, and S1-b `bindEvidence()`.
- Produces: `s1bFixture()` returning `{ baseline, evidenceRefs, input }` where baseline is obtained from the **actual** S1-a in-memory Loader on its fixture, not a manufactured approval flag. An explicit fixture cloning helper may vary one field per negative case without changing the baseline source.

- [ ] **Step 1: Write failing acceptance tests** using table-driven cases. Assert exact `evaluationStatus`, `bindingStatus`, ordered `reasonCodes`, `coverageAssessmentStatus`, per-AC coverage, and both verification statuses for each:
  - matching Task/Revision/Scope/AC; wrong Task; stale Task revision; wrong scope;
  - nonselected AC (`AC_NOT_SELECTED`, **no** `AC_TASK_MISMATCH`); selected AC + other declared Task (observable parent mismatch); wrong selected AC revision;
  - multiple independent discrepancies in prescribed reason order; missing evidence for one AC; empty EvidenceRef set;
  - `reportedOutcome='PASS'` with `MATCH` but no PROVEN/AC satisfaction; `reportedOutcome='FAIL'`; omitted outcome; `reportedExecutionState='NOT_EXECUTED'` and `'EXECUTED'` remain declarations;
  - unverified origin/issuer/contentDigest; mixed valid+malformed refs; duplicate IDs; unsafe identifier; 128 accepted /129 rejected;
  - normal S1-a `identityCandidateReady=false`: bindings `UNKNOWN` and no `MISSING_EVIDENCE`; rejected input with ready baseline: zero bindings and AC `UNKNOWN`; forged/malformed baseline: rejected with no assumed AC set.
- [ ] **Step 2: Verify RED**: `bun run vitest run tests/core/s1b/acceptance.test.ts` → FAIL if any acceptance condition is not yet implemented.
- [ ] **Step 3: Add only the minimal fixture setup and targeted corrections** necessary for acceptance, without adding a runtime adapter, authorization, store, or new design subsystem. Ensure the Core has no import from `src/core/v2`, `src/runtime`, `node:fs`, or any network/Host module.
- [ ] **Step 4: Verify GREEN**: `bun run vitest run tests/core/s1b/acceptance.test.ts` → PASS. When Owner separately authorizes test execution, run the bounded final commands:

```bash
bun run vitest run tests/core/s1b/validation.test.ts tests/core/s1b/baseline.test.ts tests/core/s1b/binder.test.ts tests/core/s1b/acceptance.test.ts
bun run vitest run tests/core/s1a
bun run typecheck
bun run lint
```

Expected: all exit status 0. Record actual output and any known unrelated failures accurately; do not infer PASS from unexecuted commands. No CI, Host Probe, Gate change, or full-repo review is required for S1-b initial acceptance.
- [ ] **Step 5: Commit only if separately authorized**: `git add tests/helpers/s1b-fixtures.ts tests/core/s1b/acceptance.test.ts && git commit -m "test(s1b): cover static typed evidence binding acceptance"`. Any actual targeted Core corrections must be included in the same authorized commit as appropriate; do not rewrite prior commits gratuitously.

## Completion, residual risks, and Owner checkpoint

**Implementation completion (future, not currently met):** the Task 1–4 tests (including S1-e positive/negative fixtures) pass; the bounded existing S1-a regression check, typecheck and lint pass; no Host-dependent code, S1-a changes, authority promotion, or unintended side effects are present. The Core returns deterministic immutable results, distinguishes observed contradiction, unknown and missing, and does not turn binding matches or declared PASS into proof.

**Residual risks accepted by design:** static fixtures do not prove real Host execution, evidence authenticity, an Owner-approved baseline, or operational improvement versus Native-only. No v2 adapter or runtime integration is attempted.

**Stop rule:** on meeting the initial S1-b acceptance conditions, stop and report achieved results, unresolved safety-relevant blockers, and remaining limitations to the Human Owner. Do not start S1-c, another implementation Task, or a review/fix cycle automatically. An observation that is not an observed failure must not be converted into a blocking failure.

**Current state:** this is an implementation **plan candidate only**, created at the user's request for writing-plans. Design R0.1.1 remains `OWNER_ADOPTION_PENDING` until explicitly decided. Code changes, test execution and repository commits/push remain `NOT_AUTHORIZED`. The Human Owner may separately decide whether to adopt this plan and authorize its specific execution scope; no permission is assumed here.
