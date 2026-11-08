# Justice v6 S1-c Deviation Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This sentence is a skill convention, not authorization to dispatch agents or begin implementation.** The Human Owner must separately authorize execution and the permitted review/commit scope. Do not start review/fix cycles automatically.

**Goal:** Deterministically compare a Task's Plan-bound candidate Scope Policy against a supplied ChangeSet, and report S1-b Evidence mismatches and missing references, without claiming unverified Owner authority or controlling the Superpowers workflow.

**Architecture:** A host-independent, read-only TypeScript core with four focused responsibilities: strict typed input/path contracts, bounded Markdown Policy extraction, independent Scope/Evidence diagnostic branches, and S1-e-style static acceptance fixtures. Reuse S1-b's `inspectBaseline()` and `bindEvidence()` rather than replicating S1-a/b validation or binding. The runtime `formalVerdict` stays `UNKNOWN` in v1 regardless of a successful candidate comparison.

**Tech Stack:** TypeScript (ES2022/ESNext), Node `node:crypto`, existing S1-a `parseStrictJson`, S1-b `inspectBaseline`/`bindEvidence`, Bun, Vitest. No new dependencies, Host adapter, service, or persistent state.

**Spec:** `docs/superpowers/specs/2026-11-07-justice-v6-s1c-deviation-rules-design.md` at immutable commit `4bad21ea7c79b43acae22423ea135279fff4577b`, Git Blob SHA-1 `dc1adc92e5c595508992b5e3f6fa72fcc57f4e88` (Design R0.1.1; Human Owner explicitly adopted this exact identity with limitations in the ChatGPT conversation). Branch locator: `feature/justice-v6-s1c-deviation-rules-implementation-20261107`. The Design file retains its historical `R0.1.1_OWNER_DECISION_PENDING` status text; this reference does not claim independent GitHub verification of Owner adoption. Issue: https://github.com/yohi/justice/issues/352.

**Document/authority status:** Original R0.1 was adopted with limitations. The Human Owner explicitly adopted the referenced R0.1.1 identity as the implementation basis and authorized the bounded implementation in the current conversation. This plan is therefore an implementation plan, not a `DOCUMENT_ONLY` proposal. The authorization covers only the S1-c scope and constraints recorded here; it does not authorize S2–S5, Host integration, approval mechanisms, or other excluded work. The current follow-up authorization is limited to (a) recognizing valid 0–3-space-indented ATX H1/H2 headings when ending the active Policy region and adding its regression test, and (b) clarifying the authorization wording in this plan. It also covers repository verification and commit/push of these correction changes only. It does not override or newly authorize any Task execution or Task-scoped commit step below; those conditional steps refer to the original implementation authorization and remain applicable to that work. The pre-existing D-3 permission to prepare an Implementation Plan was not execution authorization; the explicit authorizations above are the basis for execution.

## Global Constraints

- Implement **S1-c only**. S2–S5, S1-a/b contract changes, review orchestration, approval mechanisms, Gate/HOLD changes and Host enforcement are out of scope.
- Use the exact `S1cInput` fields: `schemaVersion: 'justice-s1c-input-v1'`, `baseline: LoaderResult`, `planBytes: Uint8Array`, `changeSet: ChangeSet`, `evidenceRefs: readonly EvidenceRefV1[]`. Reject absent/extra outer keys.
- Reuse S1-b `inspectBaseline`: `MALFORMED`, `NOT_READY`, `READY`. **S1-c directly calls `inspectBaseline` once**; its later single `bindEvidence()` call on `{schemaVersion:'justice-s1b-input-v1', baseline: sameObject, evidenceRefs}` independently **re-inspects the baseline inside S1-b** when the shared baseline is structurally valid. Do not bypass or modify the Binder's internal check.
- Plan identity: select one `plan` and `task` from ready S1-a `selectedRefs`, require Plan raw-byte SHA-256 to match both `expectedDigest` and `observedDigest`, with `digestOutcome === 'MATCH'`. **Identity match does not establish Owner approval.**
- Policy is optional. The exact active heading is `## Justice S1-c Task Scope Policies`; active block delimiters are exact column-zero `<!-- justice:s1c-task-scope:begin -->` and `<!-- justice:s1c-task-scope:end -->` on their own lines. Follow Design §4.1's bounded Markdown recognition algorithm, including exclusion of fences/quotes/indented code/HTML comments. Missing != explicit `allowedPaths: []`.
- Policy schema: `justice-s1c-task-scope-v1`; exact `planRef`, `taskRef`, `scopeKey`, and `allowedPaths`. Validate **all** recognized blocks atomically. Selected Task ID has exactly one valid block; mismatched selected revisions/Plan/Scope => `SCOPE_POLICY_REFERENCE_MISMATCH`.
- Bounds: Plan `8,388,608` bytes; each policy JSON payload `65,536` UTF-8 bytes; Policy blocks `128`; allowlist entries per selected Task `128`; ChangeSet entries `128`; path `1,024` UTF-8 bytes. Use S1-a safe identifier semantics (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) for policy identity fields.
- Allowlist patterns only exact paths or directory-prefix `/**`. Paths are repository-relative POSIX paths, case-sensitive, with no normalization, dot/dotdot/empty segments, leading `/`, `\\`, controls, URL/drive syntax. Rename checks both endpoints. No recursive filesystem resolution.
- Candidate scope comparison is `WITHIN_CANDIDATE_SCOPE | OUTSIDE_CANDIDATE_SCOPE | UNKNOWN` and only covers **supplied** changes. A supplied empty `PRESENT` ChangeSet does not attest to Git diff completeness.
- Result schema is `justice-s1c-result-v1`; `ownerAuthorityVerification` is always `NOT_VERIFIED_BY_S1C`; **`formalVerdict` is always `UNKNOWN`** in v1; include exactly one `OWNER_AUTHORITY_NOT_VERIFIED` diagnostic even on rejected inputs.
- S1-b `BindingReasonCode` is imported from `../s1b/contract.js`, preserved in `bindingReasonCodes` in its existing order; never redeclare the code union or accept a caller-provided `BinderResult`.
- Invalid outer envelope or malformed shared baseline invalidates both branches. EvidenceRefs-only invalidity never destroys a valid candidate Scope comparison. ChangeSet-only invalidity never destroys independently valid S1-b diagnostics. Invalid entries do not yield partial success within their own branch.
- Emit immutable results, fixed diagnostic code priority from Design §7, unique safe validated paths/evidence IDs/AC IDs only. Sort path/evidence/AC identifiers using UTF-8 byte ordering, not locale or input order. Never output invalid raw values or exception text.
- Runtime side effects: **none**. No network access, file reads, auto Review/Fix, test/CI orchestration, Gate/HOLD, automatic approval, or Superpowers progress blocking.

## Review Focus (pin these in the owning tests; no new review Task)

1. An example Policy shown inside a fenced Markdown block must not become authorization → Task 2 `policyExamplesAreNotActive`.
2. A malformed non-selected Task block must invalidate all Policy extraction, not allow the selected one through → Task 2 `atomicPolicyInvalidityAcrossTasks`.
3. Invalid EvidenceRefs with a fully valid Scope comparison must retain the Scope result without partial Evidence success → Task 3 `evidenceInvalidRetainsCandidateScope`.
4. A malformed ChangeSet must not suppress a legitimate S1-b binding/coverage diagnostic → Task 3 `changeSetInvalidRetainsEvidenceDiagnostics`.
5. Untrusted `approved`-like input, empty supplied changes, and a claimed PASS must never yield a formal clean/accepted result → Task 4 `authorityCannotBePromoted`.

---

## File Structure and Task Dependencies

| File | Change | Responsibility |
| --- | --- | --- |
| `src/core/s1c/contract.ts` | Create | Import shared types; define strict S1-c input/result/diagnostic and pure helper types |
| `src/core/s1c/shared-utils.ts` | Create | Shared record-key validation and UTF-8 byte ordering helpers |
| `src/core/s1c/path-rules.ts` | Create | Validate ChangeSet and safe paths/allowlist; pure candidate path comparison |
| `src/core/s1c/policy.ts` | Create | Recognize active Markdown Policy section; atomically parse/validate bounded JSON blocks |
| `src/core/s1c/evaluator.ts` | Create | Envelope/shared baseline gate; Plan digest; independent Scope/Evidence branches; sorted immutable result |
| `tests/core/s1c/path-rules.test.ts` | Create | Task 1 unit tests |
| `tests/core/s1c/shared-utils.test.ts` | Create | Shared utility unit tests |
| `tests/core/s1c/policy.test.ts` | Create | Task 2 unit tests |
| `tests/core/s1c/evaluator.test.ts` | Create | Task 3 independent-branch and trust tests |
| `tests/helpers/s1c-fixtures.ts` | Create | Build a real S1-a ready baseline with Plan artifact bytes matching the embedded Policy |
| `tests/core/s1c/acceptance.test.ts` | Create | Task 4 integrated positive/negative fixture matrix |

Do not edit `src/core/s1a/`, `src/core/s1b/`, existing S1-a/b tests, package dependencies, global plugin/runtime integration, or existing Superpowers documents as part of implementation. Task 4 creates **test-only** fixtures, not an operational integration adapter.

### Task 1: Contract and Deterministic Path Comparison

**Files:**
- Create: `src/core/s1c/contract.ts`
- Create: `src/core/s1c/shared-utils.ts`
- Create: `src/core/s1c/path-rules.ts`
- Test: `tests/core/s1c/path-rules.test.ts`
- Test: `tests/core/s1c/shared-utils.test.ts`

**Interfaces:**
- Import `LoaderResult`, `SelectedArtifactRef` from `../s1a/contract.js`; `EvidenceRefV1`, `BindingReasonCode` from `../s1b/contract.js`.
- Export `S1cInput`, `S1cResult`, `S1cDiagnostic`, `DiagnosticCode`, `CandidateScopeComparison`, `DeviationVerdict`, `ChangeSet`, `ChangedPath`, `TaskScopePolicy`, and the frozen `S1C_LIMITATIONS` constant from `contract.ts`. Use the discriminated diagnostic union **exactly** as in Design §5; the binding mismatch arm requires `bindingReasonCodes: readonly BindingReasonCode[]`. Set `S1cResult.limitations` to `typeof S1C_LIMITATIONS` (mandatory fixed tuple), not `readonly string[]`.
- Export from `shared-utils.ts`:
  - `isPlainRecord(value: unknown): value is Record<string, unknown>`
  - `hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown>`
  - `compareUtf8(left: string, right: string): number`
- Export from `path-rules.ts`:
  - `validateAllowedPaths(value: unknown): readonly string[] | null`
  - `inspectChangeSet(value: unknown): {state:'PRESENT'; touchedPaths:readonly string[]} | {state:'UNAVAILABLE'} | {state:'INVALID'}`
  - `compareCandidatePaths(allowlist: readonly string[], touchedPaths: readonly string[]): {comparison:'WITHIN_CANDIDATE_SCOPE'|'OUTSIDE_CANDIDATE_SCOPE'; outsidePaths: readonly string[]}`
- `compareCandidatePaths` is a pure comparator: it does **not** issue `NO_DEVIATION_DETECTED` as an authorized runtime verdict.

- [ ] **Step 1: Write failing tests in `tests/core/s1c/path-rules.test.ts`.** Name and assert:
  - `exactAndDirectoryPrefixAreCaseSensitive`: `['src/core/s1c/**', 'docs/plan.md']` accepts `src/core/s1c/rules.ts` and `docs/plan.md` but rejects `src/core/s1b/rules.ts`, `src/core/s1c`, and `SRC/core/s1c/rules.ts`.
  - `renameChecksBothEndpoints`: `RENAME` from `src/core/s1b/x.ts` to `src/core/s1c/x.ts` reports exactly the outside *old* path.
  - `emptyAllowlistDiffersFromUnavailablePolicy`: `[]` plus `src/core/s1c/x.ts` is `OUTSIDE_CANDIDATE_SCOPE`; empty `PRESENT` changes yield `WITHIN_CANDIDATE_SCOPE` **for that snapshot**.
  - `changeSetRejectsWholeCollection`: valid and invalid changes together (`../secret`, absolute path, unexpected field, or sparse array) produce `{state:'INVALID'}`, not a valid subset.
  - `limitsAndPathSafety`: 129 changes, 129 allowlist entries, >1,024-byte path, `.`/`..`, double slash, backslash, leading slash, URL/drive syntax, and unsupported wildcard reject.
  - `permutationAndDuplicatePaths`: same set in different order gives the same sorted unique `outsidePaths`, sorted by UTF-8 byte order.
- [ ] **Step 2: Run only the Task 1 test when implementation is authorized.** `bun run vitest run tests/core/s1c/path-rules.test.ts` → expected FAIL because the module or exports are not yet implemented.
- [ ] **Step 3: Implement contract types, shared utilities, and `path-rules.ts`.** Add the `shared-utils.ts` functions listed above. Require exact `availability`-dependent ChangeSet keys (`UNAVAILABLE` has no `changes`; `PRESENT` has dense `changes` array). ADD/MODIFY/DELETE require just `kind,path`; RENAME just `kind,oldPath,newPath`. Reject null, unknown keys, invalid enums/paths and sparse arrays. `/**` matches descendants only; don't normalize any input. Use `Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'))` for stable sorting; dedupe outside-path diagnostics only after validating the full collection.
- [ ] **Step 4: Rerun the Task 1 test.** `bun run vitest run tests/core/s1c/path-rules.test.ts` → expected PASS. (This parenthetical records the status during the original planning Task; it does not describe the current follow-up verification.)
- [ ] **Step 5: Stop Task 1 at its verified contract.** When separately permitted to write Git commits, stage only its listed files and commit `feat(s1c): add bounded path comparison contract`. No push/review/next Task is implicit in this step.

### Task 2: Exact-Plan Policy Extraction

**Files:**
- Create: `src/core/s1c/policy.ts`
- Test: `tests/core/s1c/policy.test.ts`

**Interfaces:**
- Consumes `TaskScopePolicy`, `validateAllowedPaths` from Task 1; S1-a `SelectedArtifactRef`, `isSafeIdentifier`; `parseStrictJson` from `../s1a/strict-json.js`.
- Export `extractTaskScopePolicy(planBytes: Uint8Array, selected: Readonly<{plan:SelectedArtifactRef;task:SelectedArtifactRef}>): {state:'READY';policy:TaskScopePolicy} | {state:'UNDEFINED'} | {state:'INVALID'} | {state:'REFERENCE_MISMATCH'}`.
- This function is invoked **only after** Task 3 checks S1-a readiness and Plan digest. It does not establish Owner authority, hash the Plan again, or accept a standalone caller-provided policy.

- [ ] **Step 1: Write failing `policy.test.ts` cases.** Include:
  - `singleExactActiveSectionAndBlock`: a column-zero `## Justice S1-c Task Scope Policies`, exact marker pair, and `{schemaVersion:'justice-s1c-task-scope-v1',planRef:{artifactId:'plan-1',revision:'R1'},taskRef:{artifactId:'task-1',revision:'R1'},scopeKey:'scope-1',allowedPaths:['src/core/s1c/**']}` → `READY`.
  - `policyExamplesAreNotActive`: the same heading/marker/JSON only in fenced `text` or `json`, `~~~` fence, blockquote, four-space indented code or ordinary HTML comment → `UNDEFINED`.
  - `mixedMarkdownOnlyActiveSectionCounts`: a fenced fake section before one active section plus quoted/indented fake markers inside it do not add Policy blocks; exact active block is selected.
  - `unpairedNestedAlteredOrDuplicateMarkers`: malformed markers within active region, crossing its ending ATX H1/H2 heading, duplicated active heading or duplicate selected-Task blocks → `INVALID`.
  - `indentedLevelOneOrTwoHeadingEndsActiveRegion`: ATX H1/H2 headings with zero to three leading spaces, including headings containing only `#` or `##`, end the active region.
  - `atomicPolicyInvalidityAcrossTasks`: malformed JSON or invalid path in **another Task**'s active block invalidates the entire Policy set.
  - `unknownSelectedTaskIsUndefined`; `selectedRevisionOrPlanMismatchIsReferenceMismatch`; `validExplicitEmptyAllowlistReady`.
  - `utf8AndBounds`: invalid UTF-8, UTF-8 BOM, bare CR, duplicate JSON keys, >128 blocks, >65,536-byte JSON or >128 entries → `INVALID`; code fences with unmatched internal markers are ignored.
- [ ] **Step 2: Run only Task 2 tests after implementation authorization.** `bun run vitest run tests/core/s1c/policy.test.ts` → expected FAIL for missing extractor.
- [ ] **Step 3: Implement one bounded, deterministic line scanner.** Verify strict UTF-8/no BOM/bare CR, then track fenced-code state (≤3 leading spaces, matching backtick/tilde run and closer rules), ordinary HTML comments, and ignored quoted/indented/list lines. Only the exact column-zero H2 heading opens the active region; a later valid ATX H1/H2 heading with zero to three leading spaces—including a heading containing only `#` or `##`—ends it. Only full-line markers inside the active region open/close blocks. Use `parseStrictJson` to reject duplicate keys; strict field whitelist; validate every recognized block before selecting exactly one by Task artifact ID. For mismatched selected Task revision, Plan ID/revision or Scope choose `REFERENCE_MISMATCH`; no block for selected Task is `UNDEFINED`. Never echo an unsafe source line.
- [ ] **Step 4: Run Task 1 and 2 tests.** `bun run vitest run tests/core/s1c/path-rules.test.ts tests/core/s1c/policy.test.ts` → expected PASS.
- [ ] **Step 5: Stop Task 2 at its extractor contract.** If separately authorized to commit, stage only `policy.ts` and `policy.test.ts` and commit `feat(s1c): extract unambiguous task scope from plan`.

### Task 3: Shared Baseline Gate and Independent Diagnostic Branches

**Files:**
- Create: `src/core/s1c/evaluator.ts`
- Test: `tests/core/s1c/evaluator.test.ts`

**Interfaces:**
- Export `evaluateS1c(input: S1cInput): S1cResult` from `evaluator.ts` (runtime-check untrusted callers as `unknown` internally).
- Consumes Task 1 `inspectChangeSet`/`compareCandidatePaths`, Task 2 `extractTaskScopePolicy`, S1-b `inspectBaseline` (`../s1b/baseline.js`) and `bindEvidence` (`../s1b/binder.js`). Do not pass a caller-created BinderResult.
- Reuses `BindingReasonCode` and fixed `S1C_LIMITATIONS` via Task 1's `contract.ts`. Diagnostic code priority is **exactly** Design §7; output arrays/entries and nested `bindingReasonCodes` are immutable. Return `limitations: S1C_LIMITATIONS` (or an identical frozen tuple) in all code paths, with the five values in Design §5 order and no dynamic entries.

- [ ] **Step 1: Write failing evaluator tests.** Pin these cases and exact diagnostics (always include `OWNER_AUTHORITY_NOT_VERIFIED`):
  - `malformedEnvelopeRejectsBothBranches`: extra key or absent slot → only `S1C_INPUT_INVALID` + mandatory authority code; candidate/formal both `UNKNOWN`; no Binder call.
  - `malformedBaselineRejectsBothBranches`: contradictory S1-a aggregate → `S1A_BASELINE_INVALID` and authority; candidate `UNKNOWN`.
  - `nonreadyBaselineRetainsS1bStatus`: structurally valid `NOT_READY` → `S1A_BASELINE_NOT_READY` plus the real S1-b `S1B_BASELINE_UNKNOWN` (or `S1B_INPUT_REJECTED` when EvidenceRefs invalid), no AC-missing conclusion.
  - `invalidOrOversizePlanBytesDoesNotStopEvidence`: non-`Uint8Array` or >8,388,608 bytes → `PLAN_BYTES_INVALID`, while valid S1-b diagnostic remains available.
  - `digestMismatchIsObservedNotInputInvalid`: valid readable Plan bytes with wrong SHA-256 → `PLAN_IDENTITY_MISMATCH`, candidate `UNKNOWN`, formal `UNKNOWN`.
  - `evidenceInvalidRetainsCandidateScope`: valid Plan Policy + valid ChangeSet + malformed EvidenceRefs → retained `WITHIN_CANDIDATE_SCOPE` or `OUTSIDE_CANDIDATE_SCOPE`; `S1B_INPUT_REJECTED`; no `AC_EVIDENCE_REF_MISSING` or partial binding mismatch.
  - `changeSetInvalidRetainsEvidenceDiagnostics`: valid baseline and EvidenceRefs with a real wrong Task and/or missing AC + malformed ChangeSet → candidate `UNKNOWN`, `CHANGESET_INVALID` plus real typed S1-b diagnostics.
  - `typedMismatchRetainsS1bReasonOrder`: `S1B_BINDING_MISMATCH` has an unchanged, nonempty `BindingReasonCode[]` from S1-b; include Task/Revision/Scope/AC negative variants.
  - `stableImmutabilityAndSafeDiagnostics`: permutations and duplicate outside path reports produce the exact same ordered output; no raw invalid values; freeze output and nested arrays; input/baseline remain untouched.
  - `limitationsFixedForEveryOutcome`: valid within/outside candidate, malformed outer envelope, malformed shared baseline and rejected EvidenceRefs all return the exact five-element immutable `S1C_LIMITATIONS` tuple in Design §5 order; no extra input-dependent limitation.
- [ ] **Step 2: Run only the evaluator test after implementation authorization.** `bun run vitest run tests/core/s1c/evaluator.test.ts` → expected FAIL for missing evaluator.
- [ ] **Step 3: Implement `evaluateS1c`.** Validate the exact envelope first (presence, unknown keys, schema); treat malformed existing `planBytes`, `changeSet`, `evidenceRefs` as branch-local. Call `inspectBaseline` **once directly from S1-c** and handle `MALFORMED`/`NOT_READY`/`READY` in Design §7 order; the subsequent `bindEvidence` invocation performs **its own internal re-inspection**, so do not describe the entire pipeline as checking the baseline only once. For READY, select Plan and Task, hash bytes with `createHash('sha256').update(planBytes).digest('hex')`, compare to both expected/observed and require `MATCH`; invoke Policy extractor and ChangeSet validator independently, preserving **both** applicable branch errors. Run S1-b exactly once when baseline is structurally valid; translate its real `INPUT_REJECTED`, `BASELINE_UNKNOWN`, `MISMATCH` and `MISSING_EVIDENCE` without partial Evidence success. Deduplicate identical diagnostic identities and sort by fixed priority then bytewise validated keys. Always return immutable `formalVerdict:'UNKNOWN'`, `ownerAuthorityVerification:'NOT_VERIFIED_BY_S1C'`, the authority diagnostic, and the fixed `S1C_LIMITATIONS` tuple defined in Task 1, regardless of error or success path.
- [ ] **Step 4: Verify Task 3 and targeted S1-b regression tests.** `bun run vitest run tests/core/s1c tests/core/s1b` → expected PASS, with no S1-b source edits.
- [ ] **Step 5: Stop Task 3 after deterministic output verification.** If separately authorized to commit, stage only `evaluator.ts` and `evaluator.test.ts` and commit `feat(s1c): compose scope and evidence diagnostics`.

### Task 4: S1-e-Style Static Acceptance Fixtures and Bounded Completion

**Files:**
- Create: `tests/helpers/s1c-fixtures.ts`
- Create: `tests/core/s1c/acceptance.test.ts`

**Interfaces:**
- Test helper `s1cFixture(options?: Readonly<{planText?: string; changes?: ChangeSet; evidenceRefs?: readonly EvidenceRefV1[]}>): Promise<{input:S1cInput; planBytes:Uint8Array}>`.
- Tests use the **actual** S1-a `loadS1aArtifacts()` with `s1aFixture()` adapted to embed Plan bytes. Never synthesize `ownerAuthorityStatus:'PROVEN'` or alter the `eligibleBaseline:false` contract.
- Task 4 uses `evaluateS1c` from Task 3 and no production adapter.

- [ ] **Step 1: Build `s1c-fixtures.ts` in tests only.** Start from `tests/helpers/s1a-fixtures.ts`; replace the `plan-1.md` artifact bytes with a Plan containing the active S1-c H2 Policy section, `planRef:{artifactId:'plan-1',revision:'R1'}`, `taskRef:{artifactId:'task-1',revision:'R1'}`, `scopeKey:'scope-1'`, and allowlist `['src/core/s1c/**','tests/core/s1c/**']`. Recalculate that Plan's `digest` in the copy of the Manifest, then `expectedManifestSha256` of the updated Manifest, and load it using a replacement read-only fixture source. Use selected ACs to create valid S1-b `EvidenceRefV1` references with `reportedExecutionState:'EXECUTED'` and `provenanceClass:'SELF_DECLARED'`. This retains `eligibleBaseline:false` while ensuring `identityCandidateReady:true` with Plan-byte consistency.
- [ ] **Step 2: Write the first failing acceptance tests.** In `acceptance.test.ts`, assert complete `evaluateS1c()` results for the three MVP cases: (a) allowed changes → `WITHIN_CANDIDATE_SCOPE`; (b) one outside change → `OUTSIDE_CANDIDATE_SCOPE` with exact validated path; (c) no Policy → `UNKNOWN` and `SCOPE_POLICY_UNDEFINED`. **All three** must have `formalVerdict:'UNKNOWN'` and the Owner authority diagnostic. Also test a Plan-byte identity mismatch negative.
- [ ] **Step 3: Expand the same test table, not a new review Task.** Cover explicit empty allowlist + change, `UNAVAILABLE`, zero supplied changes, two selected Policy blocks, example-only fenced/quoted marker, active malformed marker, invalid other-Task block, crossing RENAME, mixed malformed ChangeSet, malformed EvidenceRefs with valid candidate Scope, malformed ChangeSet with real S1-b mismatch/AC missing, typed Task/Revision/Scope/AC reasons, self-declared PASS, `NOT_EXECUTED`, and a mismatched Plan/Task policy reference. Include `authorityCannotBePromoted`: adding an extra `approved:true` to the outer envelope is rejected; no input yields `NO_DEVIATION_DETECTED` or `DEVIATION_DETECTED` as the public runtime `formalVerdict`.
- [ ] **Step 4: Run the bounded verification only if implementation execution is authorized.** First `bun run vitest run tests/core/s1c`; then `bun run vitest run tests/core/s1a tests/core/s1b`; then `bun run typecheck`. If those succeed and the Owner-approved implementation scope includes repository-wide verification, run `bun run test` once; do not automatically start repeated fixes/reviews. Record actual pass/fail/not-executed separately.
- [ ] **Step 5: Stop at the Human Owner checkpoint.** If separately authorized, stage only `tests/helpers/s1c-fixtures.ts` and `tests/core/s1c/acceptance.test.ts` and commit `test(s1c): verify bounded deviation fixtures`. Report exact commit(s), changed files, observed tests and limitations. Do not open PR, dispatch CodeRabbit, start an independent reviewer, change HOLD, or implement S2+ without a new explicit Owner decision.

## Traceability and Completion Matrix

| Design contract / important counterexample | Owned by | Evidence to collect at authorized execution |
| --- | --- | --- |
| §4.2–§4.3 strict ChangeSet, path rules, rename, exact vs `/**`, finite bounds | Task 1 | `path-rules.test.ts` |
| §4.1 / F001 policy heading/fences/comments/markers/atomic validation, nonselected malformed blocks | Task 2 | `policy.test.ts` |
| §4.1 S1-a readiness and byte identity, `UNKNOWN` on absent/invalid Policy | Tasks 2–3 | `policy.test.ts`, `evaluator.test.ts` |
| §5 two-level verdict, fixed typed diagnostics, no authority promotion | Tasks 1, 3 | `evaluator.test.ts` |
| §6 / F003 S1-b typed mismatch and AC presence distinction | Task 3 | `evaluator.test.ts` |
| §7 / F002 invalid envelope, baseline, independent Scope/Evidence branches, ordering | Task 3 | `evaluator.test.ts` |
| §8 positive/negative/undefined and Plan mismatch fixtures, no execution or acceptance inference | Task 4 | `acceptance.test.ts` |
| §9–§10 read-only/nonblocking and no Host/Review/Fix/Gate behavior | Tasks 3–4 | Source boundary check plus fixture outputs; no external integration |

**Definition of Done for an explicitly authorized implementation:** the small deterministic Core and tests described above work against the exact adopted Design; documented positive/negative/UNKNOWN fixture outputs are reproducible; S1-a/b contracts remain unchanged; `formalVerdict` never elevates unverified authority; no Host/workflow effects are introduced. **Finding count zero, repeated independent reviews, S2 integration, real Host evidence, and a complete Git-diff guarantee are not completion criteria.**

**Stop and residual risks:** At original plan creation, the R0.1.1 corrections still required Human Owner acceptance as the implementation baseline and no tests had been executed; that records the planning-stage status, not the current follow-up verification. Runtime Owner approval verification, collection/completeness of ChangeSet, S1-b evidence authenticity/AC satisfaction, and external enforcement remain outside S1-c. An `UNKNOWN` result is nonblocking for ordinary Superpowers progression, but may not satisfy an independent acceptance/authority gate that requires proven authorization.

**Handoff policy:** At original plan handoff, this plan was prepared for Owner review only; the Owner could approve its bounded implementation later, decline it, or defer implementation. This historical handoff status does not supersede the explicit, narrowly scoped follow-up authorization above. No automatic next Task, independent review, PR, or Gate/HOLD change is authorized. If a plan correction is required, limit it to the concrete issue; do not begin a revision/re-review cycle by default.
