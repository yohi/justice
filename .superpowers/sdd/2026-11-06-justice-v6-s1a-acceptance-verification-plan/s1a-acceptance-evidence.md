# S1-a Acceptance Evidence

## Identity

- Code under test: `8d30e24affe919f0302d7e335a0791b1ee3c6ad0`, on top of frozen base `3b3183c17f534168826022cbdfe01e487b68d16c`.
- Branch: `feature/justice-v6-s1a-acceptance-verification`.
- HEAD was rechecked before verification and remained the specified code-under-test commit. No checkout or HEAD movement was performed.
- Initial worktree status: dirty/untracked execution provenance: `TASK_2_HEAD`; `docs/superpowers/plans/2026-11-06-justice-v6-s1a-acceptance-verification-plan.md`. Neither was changed or staged as part of this task.
- Bun: `1.4.2`; Node: `v26.10.0`; Vitest (reported by focused runs): `v4.1.1`.
- Collection configuration: Path A used the default Vitest config (5 test files, 35 tests); Path B used `vitest.integration.config.ts` (1 test file, 2 tests). The Node test was invoked separately and is not a Vitest collection.

## Commands run, in execution order

Exit codes below are the process outcomes of the exact commands shown.

| # | Exact command | Exit | Collection / result | Relevant diagnostics |
|---|---|---:|---|---|
| Identity | `git rev-parse HEAD` | 0 | `8d30e24affe919f0302d7e335a0791b1ee3c6ad0` | Agreed code under test. |
| Identity | `git status --short` | 0 | Two pre-existing untracked paths listed above. | Worktree not clean; no source modifications observed. |
| Identity | `git branch --show-current` | 0 | `feature/justice-v6-s1a-acceptance-verification` | — |
| Identity | `bun --version` | 0 | `1.4.2` | — |
| Identity | `node --version` | 0 | `v26.10.0` | — |
| Path A | `bun run vitest run tests/core/s1a tests/runtime/s1a-cli.test.ts` | 0 | 5 files / 35 passed, 0 failed, 0 skipped. Vitest `v4.1.1`. Files: `contract.test.ts`, `loader.test.ts`, `manifest.test.ts`, `resolver.test.ts`, `s1a-cli.test.ts`. | No failure diagnostics. |
| Path B | `bun run vitest run --config vitest.integration.config.ts tests/real-fs/s1a-read-only-fs.test.ts` | 0 | 1 file / 2 passed, 0 failed, 0 skipped. Vitest `v4.1.1`. | No failure diagnostics. |
| Path C.1 | `bun run build` | 0 | Build completed; TypeScript compilation and Bun bundling succeeded. | `Bundled 379 modules`; output `dist/opencode-plugin.js` (1.33 MB). |
| Path C.2 | `node --test tests/node/s1a.test.mjs` | 0 | 21 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo. | Names: `P-01 valid exact raw-byte references identity MATCH never Owner approval`; `N-06b/c missing and malformed sha return UNKNOWN without reads`; `N-01 manifest digest mismatch stops before reading intent`; `N-03 dirty artifact byte mismatch`; `N-02 stale revision no fallback`; `N-05 required AC missing`; `invalid manifest field diagnostic never reveals secret`; `invalid intent value diagnostic never reveals secret`; `strict parser refuses escaped duplicate keys`; `invalid UTF-8 rejected before JSON parse`; `unsafe identifiers rejected; valid 64-character ASCII preserved`; `128 selected refs accepted, 129 rejected before artifact reads`; `real fs reads binary and rejects symlinks/traversal`; `real fs zero-byte limit accepts zero, rejects positive`; `CLI returns JSON only, and does not infer approval`; `N-DIAG-01/02 complete JSON matches contract and never emits input secrets`; `N-LIM-01 129 refs emits UNKNOWN and zero artifact reads`; `N-LIM-02 exact total 33,554,432 accepted; 33,554,433 rejected with UNKNOWN`; `N-LIM-02 observed earlier artifact digest MISMATCH overrides later total UNKNOWN`; `CLI rejects duplicate flags, unknown flags and positional extras without raw echo`; `observed revision contradiction takes priority over 129-ref count gate`. |
| Whole repository | `bun run typecheck` | 0 | TypeScript `tsc --noEmit` completed without diagnostics. | — |
| Whole repository | `bun run lint` | 1 | ESLint: 263 problems (2 errors, 261 warnings). | Errors in `tests/node/s1a.test.mjs`: line 4 unused `readFile`; line 15 `TextEncoder` not defined. The targeted Node test itself passed. No lint/source changes made. |
| Whole repository | `bun run test` | 1 | 170 files: 166 passed, 3 failed, 1 skipped; 2,272 tests passed, 17 failed, 5 skipped (2,294 total). | Native review-artifact tests report unsupported setup because native provider is unavailable. `tests/types/command-execute-before.contract.test.ts` cannot find `node_modules/typescript/bin/tsc`. The two failures in that file and native-provider failures are outside the focused S1-a suites. No source changes made. |

## Acceptance matrix

`OBSERVED_PASS` is limited to the named assertions actually collected and run. Per-case labels below are mapped only where test names/assertions identify the behavior; broader Owner trust, host authority, or race guarantees are not inferred.

| Plan case / behavior | Status | Supporting command and collected test name(s) / note |
|---|---|---|
| P-01: exact pinned identity returns MATCH without granting Owner authority | `OBSERVED_PASS` | Path A: `P-01 emits deterministic MATCH without Owner authorization`; Path C.2: `P-01 valid exact raw-byte references identity MATCH never Owner approval`. Both assert `NOT_PROVEN` and `eligibleBaseline=false`. |
| N-01: manifest digest mismatch halts before later input read | `OBSERVED_PASS` | Path A: `manifestMismatchStopsBeforeParse`; Path C.2: `N-01 manifest digest mismatch stops before reading intent`. |
| N-02: stale revision has no fallback | `OBSERVED_PASS` | Path A: `stalePlanRevisionNoFallback`; Path C.2: `N-02 stale revision no fallback`. |
| N-03: changed raw artifact bytes produce mismatch | `OBSERVED_PASS` | Path C.2: `N-03 dirty artifact byte mismatch`. |
| N-04a: scope mismatch | `OBSERVED_PASS` | Path A: `scopeAndParentConflict`. |
| N-04b: kind mismatch | `OBSERVED_PASS` | Path A: `wrongKindAndDuplicatedSelectedIdPreservesKindMismatch`. |
| N-04c: parent-link mismatch | `TEST_ABSENT/NOT_COLLECTED` | No separate parent-link mismatch test was collected. |
| N-05: required acceptance criterion missing prevents selection | `OBSERVED_PASS` | Path A: `missingMandatoryAcNeverResolvesPartially`; Path C.2: `N-05 required AC missing`. |
| N-06: missing/malformed manifest digest produces UNKNOWN before reads | `OBSERVED_PASS` | Path A: `missingDigestPerformsZeroReadsAndMalformedDigestPerformsZeroReads`; Path C.2: `N-06b/c missing and malformed sha return UNKNOWN without reads`. |
| N-07: `approved: true` is rejected by the Loader after a matching Manifest digest, with no selected refs | `TEST_ABSENT/NOT_COLLECTED` | Path A: `rejects duplicate Artifact ID and unknown approval claim` verifies only that `parseOwnerManifest` rejects the claim. The Loader test `malformedManifestReturnsUnknownAfterDigestMatch` uses `unsupported: true`, not `approved: true`; it does not establish this exact case. |
| N-08a.1: Duplicate JSON object keys are rejected by the strict parser | `OBSERVED_PASS` | Path A: `duplicateEscapedKeysAndInvalidUtf8` asserts escaped duplicate `artifacts` keys throw `MANIFEST_INVALID`; Path C.2: `strict parser refuses escaped duplicate keys`. |
| N-08a.2: Duplicate Artifact IDs are rejected by `parseOwnerManifest` | `OBSERVED_PASS` | Path A: `rejects duplicate Artifact ID and unknown approval claim` asserts duplicated artifact records throw `MANIFEST_INVALID`. |
| N-08a.3: Invalid diagnostic identifiers are rejected and not leaked | `OBSERVED_PASS` | Path A: `rejectUnsafeDiagnosticIdentifiers`, `invalidIdentifiersNeverLeakInResult`; Path C.2: `unsafe identifiers rejected; valid 64-character ASCII preserved`. This does not verify artifact-path rejection. |
| N-08a.4: Unknown schema version is rejected | `TEST_ABSENT/NOT_COLLECTED` | No collected assertion specifically supplies an unknown `schemaVersion` and verifies rejection. |
| N-08a.5: Invalid artifact path in a Manifest is rejected | `TEST_ABSENT/NOT_COLLECTED` | No collected assertion specifically supplies an invalid artifact `relativePath` and verifies rejection. |
| N-08a.6: Malformed Manifest after matching digest returns `MANIFEST_INVALID` and no selected refs | `OBSERVED_PASS` | Path A: `malformedManifestReturnsUnknownAfterDigestMatch` uses `unsupported: true` and asserts matching digest, `MANIFEST_INVALID`, `UNKNOWN`, and `selectedRefs=[]`. This does not cover N-07's `approved: true` case. |
| N-08b.1: Real filesystem source rejects symlink, traversal, and nonregular paths | `OBSERVED_PASS` | Path B: `readsExactRawBytes and rejectSymlinkAndSpecialFiles`; Path C.2: `real fs reads binary and rejects symlinks/traversal`, `real fs zero-byte limit accepts zero, rejects positive`. The final-component symlink case `child/file-link` is directly asserted to reject with `unsafe_path`. |
| N-08b.2: Loader maps an unreadable artifact to `ARTIFACT_UNREADABLE` | `OBSERVED_PASS` | Path A: `unreadableArtifactReturnsUnknownAndRetainsOtherArtifactEvidence` uses the mocked `readArtifact` failure and asserts `ARTIFACT_UNREADABLE`. This is a Loader mock test, not a real-filesystem unreadable-path test. |
| N-09: Altered Manifest plus matching digest does not independently establish Owner trust or authorize acceptance | `OBSERVED_PASS` | Path A: `matchingForgedPairNeverPromotesAuthority` asserts `ownerAuthorityStatus='NOT_PROVEN'`, `eligibleBaseline=false`; Path C.2: `CLI returns JSON only, and does not infer approval` asserts `eligibleBaseline=false` and no raw echo; Path C.2: `N-DIAG-01/02 complete JSON matches contract and never emits input secrets` asserts `ownerTrustPrecondition='EXTERNAL_NOT_VERIFIED_BY_S1A'`. |
| N-DIAG-01: invalid manifest diagnostic is safe | `OBSERVED_PASS` | Path C.2: `N-DIAG-01/02 complete JSON matches contract and never emits input secrets`; Path A: `invalidIdentifiersNeverLeakInResult`. |
| N-DIAG-02: invalid intent diagnostic is safe | `OBSERVED_PASS` | Path C.2: `N-DIAG-01/02 complete JSON matches contract and never emits input secrets`; Path A: `invalid intent value diagnostic never reveals secret`. |
| N-LIM-01: 128 selected accepted, 129 rejected before artifact reads | `OBSERVED_PASS` | Path A: `selectedArtifactLimitPerformsZeroArtifactReads`; Path C.2: `128 selected refs accepted, 129 rejected before artifact reads`, `N-LIM-01 129 refs emits UNKNOWN and zero artifact reads`. |
| N-LIM-02: exact cumulative byte limit accepted; +1 rejected | `OBSERVED_PASS` | Path A: `totalArtifactByteBudgetBoundary`; Path C.2: `N-LIM-02 exact total 33,554,432 accepted; 33,554,433 rejected with UNKNOWN`. |
| Real-FS safety: binary bytes, symlink/traversal, nonregular and read cap | `OBSERVED_PASS` | Path B: `readsExactRawBytes and rejectSymlinkAndSpecialFiles` and `zeroByteBudgetAcceptsEmptyRejectsPositive`; Path C.2: `real fs reads binary and rejects symlinks/traversal`, `real fs zero-byte limit accepts zero, rejects positive`. |
| Real-FS race freedom / changed-during-read and FIFO-specific behavior | `SKIPPED_UNPROVEN` | No deterministic race/FIFO acceptance case was run. The contract expressly does not prove filesystem race freedom. |
| Raw-byte hashing (not text-normalized artifact bytes) | `OBSERVED_PASS` | Path C.2: `N-03 dirty artifact byte mismatch`, `real fs reads binary and rejects symlinks/traversal`; Path B: `readsExactRawBytes and rejectSymlinkAndSpecialFiles`. |
| No output leak (input secret/path not echoed) | `OBSERVED_PASS` | Path A: `invalidIdentifiersNeverLeakInResult`; Path C.2: `invalid manifest field diagnostic never reveals secret`, `invalid intent value diagnostic never reveals secret`, `CLI rejects duplicate flags, unknown flags and positional extras without raw echo`, `N-DIAG-01/02 complete JSON matches contract and never emits input secrets`. |
| F001: observed MISMATCH retained over later UNKNOWN | `OBSERVED_PASS` | Path A: `revisionMismatchPlusUnknownAcRetainsMismatchAndNeverSelects`, `mismatchOverridesOtherUnknown`; Path C.2: `N-LIM-02 observed earlier artifact digest MISMATCH overrides later total UNKNOWN`, `observed revision contradiction takes priority over 129-ref count gate`. |

## Decision package

**ACCEPTANCE_EVIDENCE_COMPLETE_WITH_LIMITATIONS.** The required focused S1-a paths establish the claims marked `OBSERVED_PASS` in the matrix. N-04c (parent-link mismatch) is not separately evidenced. Race/FIFO remains `SKIPPED_UNPROVEN`. Repo-wide lint/test environmental failures are not S1-a acceptance failures. This evidence does not prove Owner origin/authenticity or baseline eligibility.

Bounded follow-up note (not a blocker; not executed): add an explicit parent-link mismatch test to collect N-04c, then rerun the focused S1-a paths. Cost/impact: one bounded test-only addition and rerun; no production behavior change is proposed. Owner authority remains `NOT_PROVEN`; `ownerTrustPrecondition='EXTERNAL_NOT_VERIFIED_BY_S1A'`; `eligibleBaseline=false`; identity candidate readiness remains identity-only. Exact Revision/digest pinning and raw-byte dirty semantics remain the tested contract; limits remain 128 selected refs, 8,388,608 bytes per artifact, and 33,554,432 total attempted bytes. A 129-ref or 33,554,433-byte case does not authorize a baseline. Priority remains `MISMATCH > UNKNOWN > MATCH`.
