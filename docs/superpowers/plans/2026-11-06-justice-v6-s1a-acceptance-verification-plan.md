# Justice v6 S1-a — Acceptance Verification Completion Plan

> **For agentic workers:** Apply Superpowers `writing-plans`/`executing-plans` to this **bounded, supplemental** plan only after Human Owner authorization of the exact execution scope. Tasks are checklists; none are authorized to run merely because this document exists. Do not dispatch new independent reviews or automatically start S1-b.

**Date:** 2026-11-06 (JST)  
**Repository:** `yohi/justice`  
**Reviewed feature branch:** `feature/justice-v6-s1a-artifact-loader-design-20261103`  
**Frozen planning input HEAD:** `3b3183c17f534168826022cbdfe01e487b68d16c`  
**Parent plan:** `docs/superpowers/plans/2026-11-04-justice-v6-s1a-artifact-loader.md` (R1.1, same HEAD)  
**Specification:** `docs/superpowers/specs/2026-11-03-justice-v6-s1a-artifact-loader-design.md` (R0.1.2)  
**Primary decision record:** Issue #350, https://github.com/yohi/justice/issues/350

**Goal:** Close the *observed test-coverage/evidence gaps* for already-implemented S1-a Tasks 1–5 and produce a defensible acceptance decision, without changing the identity contract, elevating Owner authority, or initiating subsequent S1 scopes.

**Architecture:** Preserve the existing pure `loadS1aArtifacts(input, source): Promise<LoaderResult>`, `resolveTaskIntent(manifest, intent): ResolvedSelection`, and `runS1aCli(argv, source)` surfaces. Add or strengthen **tests only when assertions are not yet present**, then separately run the default Vitest, integration Vitest, and compiled-output Node test paths. Any newly observed production defect, unexpected filesystem safety violation, or broader refactoring is a Human Owner checkpoint rather than implicit authorization to expand scope.

**Tech stack:** TypeScript 6, Bun scripts, Vitest 4, Node `node:test`, `node:fs/promises`. No new dependencies.

## 0. Scope, decision and evidence rules

- This is a **supplement to**, not a replacement for, Implementation Plan R1.1. Do not reimplement Tasks 1–5; do not rewrite Design R0.1.2.
- **Writing permission:** local plan document only. **Execution not authorized by this request.** Running tests, creating test fixtures, editing repository files, commit/push, changing CI, operating Host, or adjusting Gate/HOLD require a separately identified Owner execution/write authorization. Test-fixture writes, if authorized later, must stay within disposable test directories.
- Preserve `ownerAuthorityStatus='NOT_PROVEN'`, `ownerTrustPrecondition='EXTERNAL_NOT_VERIFIED_BY_S1A'`, `eligibleBaseline=false`, exact Revision/digest pinning, raw-byte dirty definition, and `MISMATCH > UNKNOWN > MATCH`. `identityCandidateReady` is identity-only.
- Maintain limits: `MAX_SELECTED_ARTIFACTS=128`, `MAX_ARTIFACT_BYTES=8_388_608`, `MAX_TOTAL_ARTIFACT_BYTES=33_554_432`; 129 refs or 33,554,433 cumulative attempted bytes cannot authorize a baseline.
- **Evidence statuses:** `TEST_EXISTS_UNEXECUTED`, `NOT_COLLECTED`, `TEST_ABSENT`, `SKIPPED_UNPROVEN`, `OBSERVED_FAIL`, `OBSERVED_PASS`. Never treat one as another. Record exact HEAD, command, exit code, collected test names, pass/fail/skip counts, and relevant diagnostics.
- **Stop conditions:** security-sensitive side effects, nondeterministic or leaking diagnostics, unauthorized writes, unexpected Head, serious test failures requiring source modifications, or permission ambiguity: stop affected operation, report the evidence, and leave unrelated work untouched. No automatic new review, new Finding campaign, or follow-up implementation task.

## Observed baseline at planning time (READ_ONLY GitHub inspection)

| Path | Grounded observation at input HEAD |
|---|---|
| `vitest.config.ts` | Collects `tests/**/*.test.ts` but excludes `tests/real-fs/**` |
| `vitest.integration.config.ts` | Collects `tests/real-fs/**/*.test.ts` |
| `tests/node/s1a.test.mjs` | Exists; imports `dist/core/s1a/**` and `dist/runtime/s1a-cli.js`; not collected by Vitest |
| `tests/core/s1a/resolver.test.ts` | Has `selectedArtifactCountBoundary128And129` and observed MISMATCH/UNKNOWN regressions |
| `tests/core/s1a/loader.test.ts` | Has authority/mismatch and unknown-reference tests; named Loader boundary acceptance cases from parent plan not yet present |
| `tests/runtime/s1a-cli.test.ts` | Has basic success/error and mismatch-vs-unknown tests; comprehensive CLI limits case not yet present |
| `tests/real-fs/s1a-read-only-fs.test.ts` | Has symlink/path, binary, over-limit, zero-byte tests; does not establish every optional FIFO/race scenario |
| `package.json` | `build` uses `tsc`; scripts `test`, `test:integration`, `lint`, `typecheck` exist |

No test runs, builds, CI inspection or fixture writes are represented as having happened in **this planning task**. The previously reported local Node 21/21 result is not an equivalent observation of current repository CI/Bun/Vitest.

## Review Focus — high-impact cases still requiring reproducible evidence

1. **N-LIM-01:** 128 refs accepted; 129 selected refs return `SELECTED_ARTIFACT_LIMIT_EXCEEDED`, `UNKNOWN`, `selectedRefs=[]`, with exactly zero selected `readArtifact` calls (Task 1).
2. **N-LIM-02:** total read 33,554,432 bytes accepted, 33,554,433 refused without truncation/digest promotion or further selected reads (Task 1).
3. **Observed MISMATCH plus subsequent UNKNOWN:** `identityStatus=MISMATCH` and both reasons retained; `selectedRefs=[]` on incomplete reference resolution, no private IDs echoed (Task 1/2).
4. **Filesystem:** symlinked directory and file, path traversal, nonregular file where supported; report skipped race/FIFO cases unproven, never claim race freedom (Task 2).
5. **False authority promotion:** a matching forged input remains `ownerAuthorityStatus=NOT_PROVEN`, `eligibleBaseline=false`; both JSON and CLI exit are deterministic and free of raw input paths/secrets (Task 2).

## Task 1: Fill missing Core Loader limit and aggregation acceptance cases

**Files**
- Modify only if necessary: `tests/core/s1a/loader.test.ts`
- Inspect/reuse: `tests/core/s1a/resolver.test.ts`, `tests/helpers/s1a-fixtures.ts`, `src/core/s1a/contract.ts`, `src/core/s1a/loader.ts`

**Interfaces**
- `loadS1aArtifacts(input: LoaderInput, source: S1aReadOnlySource): Promise<LoaderResult>`
- `S1aReadOnlySource.readArtifact(root, relativePath, maxBytes): Promise<Uint8Array>`
- `S1A_LIMITS.selectedArtifacts` and `S1A_LIMITS.totalArtifactBytes` are constant; no production interface edit.

- [ ] **Step 1 — Check existing assertions.** At frozen HEAD identify tests for `selectedArtifactLimitPerformsZeroArtifactReads`, `totalArtifactByteBudgetBoundary`, `mismatchOverridesOtherUnknown`; if functionality is already covered by equally strong collected assertions, reuse them rather than adding redundant tests. Otherwise add precisely these named test cases in `loader.test.ts`.
- [ ] **Step 2 — N-LIM-01 test.** Construct a digest-pinned Manifest+TaskIntent selecting 128 unique refs, assert resolver completes, then construct 129 unique refs: `reasonCode='SELECTED_ARTIFACT_LIMIT_EXCEEDED'`, `identityStatus='UNKNOWN'`, `selectedRefs=[]`, `identityCandidateReady=false`, `eligibleBaseline=false`, and `vi.fn(source.readArtifact)` called **zero times**. Keep Manifest digest updated from exactly the test bytes; do not use an invalid-digest false positive.
- [ ] **Step 3 — N-LIM-02 test.** Build four 8,388,608-byte in-memory artifact buffers plus a zero-length fifth selected artifact. Stub `readArtifact` to enforce `maxBytes`; 33,554,432 total bytes must match if hashes are correct. Change the fifth artifact to 1 byte; expect `TOTAL_ARTIFACT_LIMIT_EXCEEDED`, `identityStatus='UNKNOWN'` unless another observed contradiction exists, candidate false, and no subsequent reads. Ensure stable result fields and no prefix accepted as a valid digest. Do not write large fixtures to the repository.
- [ ] **Step 4 — Priority test.** With the same byte-budget scenario, introduce an **observed** earlier artifact digest mismatch followed by budget UNKNOWN; expect aggregate `MISMATCH` and both `ARTIFACT_DIGEST_MISMATCH` and `TOTAL_ARTIFACT_LIMIT_EXCEEDED`. Preserve false `eligibleBaseline` and no sensitive input echo. Also retain existing `revisionMismatchPlusUnknownAcRetainsMismatchAndNeverSelects` behavior.
- [ ] **Step 5 — Verify after future explicit execution authorization.** Run `bun run vitest run tests/core/s1a/loader.test.ts tests/core/s1a/resolver.test.ts`. Newly written tests must directly test required behavior; if they pass immediately because the implementation is already correct, record **coverage gap closed without production modification**, not a fictitious RED-to-GREEN code fix. If they fail, document the failure and request Owner authorization for any production correction. Expected successful result: all collected tests PASS; report exact counts.

## Task 2: Complete CLI/real-FS acceptance coverage without inventing PASS

**Files**
- Modify only if necessary: `tests/runtime/s1a-cli.test.ts`
- Modify only if necessary: `tests/real-fs/s1a-read-only-fs.test.ts`
- Read only: `src/runtime/s1a-cli.ts`, `src/runtime/s1a-read-only-fs.ts`, `tests/node/s1a.test.mjs`

**Interfaces**
- `runS1aCli(argv: readonly string[], source: S1aReadOnlySource): Promise<{stdout: string; exitCode: 0|2|3|64}>`
- `createS1aReadOnlySource(): S1aReadOnlySource`; temporary file tests do not mutate project state beyond disposable fixtures.

- [ ] **Step 1 — CLI gap inventory.** Compare existing collected CLI tests with the parent Plan's `invalidIdentifiersJsonOutputIsRedacted`, `cliLimitResultsDeterministic` requirements. Reuse existing tests for 0/2/3/64 exits, MISMATCH/UNKNOWN priority and `NOT_PROVEN`; only add absent assertions.
- [ ] **Step 2 — Add exact CLI boundary assertions when absent.** Use a memory source plus correct Manifest raw digest for 129 refs and total-byte +1; assert `exitCode=3` for pure limits, exact reason codes, `selectedRefs=[]` for incomplete selection, no `identityCandidateReady`, `eligibleBaseline=false`, no output of secret ID/absolute path. Repeat same argv/source to assert byte-identical stdout. For a **previously observed** mismatch plus later UNKNOWN, assert `exitCode=2` and all safely reported reasons, with no authority promotion. Keep `tests/runtime/s1a-cli.test.ts` the primary file; do not add another CLI.
- [ ] **Step 3 — Complete deterministic real-FS cases only.** Extend existing integration test to check a final-component symlink, exact-file-size/effective read cap and +1 overflow, absolute/`..` paths and nonregular file when the authorized environment supports constructing it. Preserve named temporary-directory cleanup. Do not create flaky race-based PASS claims: if `changed_during_read` cannot be deterministically induced without modifying production code or unsafe operations, record `SKIPPED_UNPROVEN`.
- [ ] **Step 4 — Verify separately after authorization.** Run `bun run vitest run tests/runtime/s1a-cli.test.ts`, then `bun run vitest run --config vitest.integration.config.ts tests/real-fs/s1a-read-only-fs.test.ts`. The default `vitest.config.ts` excludes real-FS tests. For each suite note how many tests were actually collected, not only command exit code. Do not start CI or write to GitHub implicitly.

## Task 3: Run complete three-path verification and produce Owner acceptance evidence

**Files**
- Write a **local-only evidence report** after separate execution authorization (example: `s1a-acceptance-evidence.md` in an expressly permitted workspace). Do not mutate the existing Design/Plan, GitHub, CI, or Gate/HOLD to record results.

**Interfaces and command order (future, approval-dependent)**

```bash
# Baseline and identity preflight in an isolated worktree
# Require HEAD == 3b3183c17f534168826022cbdfe01e487b68d16c

# 1. Pure Core + CLI tests (default Vitest)
bun run vitest run tests/core/s1a tests/runtime/s1a-cli.test.ts

# 2. Real filesystem tests (integration Vitest)
bun run vitest run --config vitest.integration.config.ts tests/real-fs/s1a-read-only-fs.test.ts

# 3. Build before Node test: tests/node/s1a.test.mjs imports dist/**
bun run build
node --test tests/node/s1a.test.mjs

# 4. Whole-repository checks, if Owner authorized
bun run typecheck
bun run lint
bun run test
```

- [ ] **Step 1 — Pin identity.** Record `git rev-parse HEAD`, source tree clean/dirty status, exact versions of Bun/Node and test collection settings; STOP on unexpected HEAD rather than silently retargeting this plan. Working-tree dirtiness here is *execution provenance*, not S1-a's artifact-byte `dirty` definition.
- [ ] **Step 2 — Execute only approved commands.** For each command above record exit code, captured stdout/stderr, discovered test names, passed/failed/skipped counts; `tests/node/s1a.test.mjs` must run separately after build and never be assumed covered by `bun run test`.
- [ ] **Step 3 — Acceptance matrix.** Mark P-01, N-01–N-09, N-DIAG-01/02, N-LIM-01/02, real-FS safety/limits, raw-byte hashing, no output leak, and F001 MISMATCH-retention as `OBSERVED_PASS`, `OBSERVED_FAIL`, `SKIPPED_UNPROVEN`, or `TEST_ABSENT/NOT_COLLECTED`. Include supporting command and case name for each PASS. State unproven contract areas; never promote no-execution to PASS.
- [ ] **Step 4 — Owner checkpoint.** Deliver a concise `ACCEPTANCE_EVIDENCE_COMPLETE_WITH_LIMITATIONS` or `ACCEPTANCE_EVIDENCE_INCOMPLETE` decision package. If important blockers exist, identify a **single bounded** proposed correction with cost/impact; do not automatically execute correction, another review, new tasks, GitHub push, or Gate/HOLD change.

## Completion and stop contract

**Done for this planning task:** This bounded addendum names exact interfaces, files, missing/partial tests, commands, and Owner acceptance evidence rules, grounded in current GitHub sources. Document creation is **not** test execution, Owner acceptance of S1-a outcomes, or authorization to move to S1-b.

**Done for future execution task only when authorized:** The tests actually run through all applicable collected paths, results are recorded with identities and exception categories, applicable acceptance assertions pass, and all skipped/unsupported cases are explicitly described. No requirement that all Findings be zero or that another independent review run by default.

**Stop:** After presenting the plan, return to Human Owner. Source/test edits, execution, further documents, external writes, and downstream work are not automatically authorized. GitHub commit/push requires an explicit separate request.
