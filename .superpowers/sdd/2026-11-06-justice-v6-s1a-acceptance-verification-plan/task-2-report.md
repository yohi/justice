# Task 2 Report

## Final status: DONE_WITH_CONCERNS

Initial status was BLOCKED after interpreting the brief's `selectedRefs=[]` line as applying after artifact reads; this was superseded by the controller ruling recorded under Fix round 1.

## Attempted implementation

Added CLI acceptance tests in `tests/runtime/s1a-cli.test.ts` for:

- Rejection of 129 selected refs, checking reason/status, no artifact reads, no authority promotion, no selected refs, no sensitive identifier/path leakage, and deterministic stdout.
- Total attempted artifact bytes above 33,554,432, checking the total-limit reason, UNKNOWN status, no baseline authorization, and deterministic stdout.
- A previously observed artifact digest mismatch followed by a total-byte limit UNKNOWN, checking CLI exit code 2, both reasons, and no authority promotion.

No production code was changed. The task was stopped when focused verification exposed the exact acceptance defect: for incomplete artifact reads, the loader's result retains partially populated `selectedRefs`, whereas the Task 2 brief explicitly requires `selectedRefs=[]` for incomplete selection. This occurred in both the pure total-limit and MISMATCH-plus-later-UNKNOWN tests. Fixing that behavior would require production changes, which are outside this task's authorization.

No real-FS test changes were made because the production defect blocks completing the specified acceptance checks. `changed_during_read` remains `SKIPPED_UNPROVEN`; no deterministic race was induced.

## Verification and TDD evidence

### RED

Command: `bun run vitest run tests/runtime/s1a-cli.test.ts` (run twice, including after the final test-fixture/redaction adjustment)

Result: **6 passed, 2 failed (8 collected)**. The failures were expected to reveal currently uncovered acceptance behavior, but their concrete assertion showed a production defect rather than a test-only coverage gap:

- `total attempted bytes over the limit stay UNKNOWN and cannot authorize a baseline`: failed because `selectedRefs` contained four observed refs and one `UNKNOWN` ref rather than `[]`.
- `a previously observed mismatch outranks a later total-byte UNKNOWN`: failed because `selectedRefs` contained four refs including the observed mismatch and final `UNKNOWN` ref rather than `[]`.

Both tests reached the selected-ref assertions after observing their expected CLI exit/status and reason-code conditions. No implementation was attempted, per the task's stop constraint.

The 129-ref test passed, including its manifest digest pin, no-artifact-read assertion, deterministic stdout check, and absolute-path/identifier redaction assertions.

### GREEN

Not run. A green result requires a production behavior change prohibited by this task. The focused CLI suite is currently red and must not be represented as passing.

### Other requested commands

- `bun run vitest run --config vitest.integration.config.ts tests/real-fs/s1a-read-only-fs.test.ts` — **not run**; stopped after discovering the production defect.
- Full suite — **not run**; stopped after discovering the production defect.
- Typecheck, lint, and build — **not run**; no completion claim is made.

## Files changed

- `tests/runtime/s1a-cli.test.ts` — added three CLI acceptance tests.
- `.superpowers/sdd/2026-11-06-justice-v6-s1a-acceptance-verification-plan/task-2-report.md` — this report.

## Self-review

- Test fixtures recompute the expected manifest digest from the exact serialized manifest bytes passed to the in-memory source.
- Sensitive/ref identifiers are deliberately asserted absent from the output; no unsafe path access or project-state writes were introduced.
- No production files were touched.
- `selectedRefs=[]` remains the required acceptance criterion, not weakened to match the observed behavior.

## Concerns / follow-up boundary

The partial `selectedRefs` result contradicts Task 2 Step 2's explicit requirement for incomplete selection and affects both limit-only UNKNOWN and MISMATCH-priority cases. The owner/controller must authorize and dispatch any production correction separately before these tests can pass. No GitHub operations or follow-up implementation tasks were created.

## Fix round 1

The controller ruling established that complete resolved `selectedRefs` with unchecked entries `UNKNOWN` is the authoritative post-resolution contract. The earlier BLOCKED assessment above is superseded by this ruling; no production defect was present.

### Changes

- Updated the total-byte CLI test to assert all five resolved refs: the first four are `MATCH`; `ac-2` is `UNKNOWN` with `observedDigest: null`. It also repeats the invocation to verify byte-identical stdout and checks that the absolute manifest path and untrusted approval reference are not emitted.
- Updated the MISMATCH-plus-later-limit CLI test to assert all five resolved refs: `design-1` is `MISMATCH`, the next three are `MATCH`, and `ac-2` is `UNKNOWN` with `observedDigest: null`. It verifies repeated stdout equality and keeps exit 2, both reason codes, no identity candidate, and no baseline eligibility.
- Extended deterministic real-FS coverage for final-component symlinks, absolute artifact paths, and directory/nonregular paths. Existing byte-cap assertions cover exact-size success (3-byte file with cap 3) and +1 overflow (same file with cap 2).
- Reviewed `tests/core/s1a/loader.test.ts`: the total-byte case already requires the final selected ref to be `UNKNOWN`, and the mismatch-priority case retains the complete five-ref set. These assertions are consistent with the ruling; no change was needed.
- `changed_during_read` remains `SKIPPED_UNPROVEN`; inducing it deterministically would require a race/unsafe hook not authorized by this task.

### Verification

- `bun run vitest run tests/runtime/s1a-cli.test.ts` — **8/8 passed**.
- `bun run vitest run tests/core/s1a/loader.test.ts` — **9/9 passed**.
- `bun run vitest run --config vitest.integration.config.ts tests/real-fs/s1a-read-only-fs.test.ts` — **2/2 passed**.
- `bun run typecheck` — passed with no diagnostics.
- `bun run build` — passed; TypeScript compilation and bundle completed.
- `bunx eslint tests/runtime/s1a-cli.test.ts tests/real-fs/s1a-read-only-fs.test.ts` — **0 errors, 15 warnings** (the repository's existing `explicit-function-return-type` and dynamic temporary-path security warnings).
- `bun run lint` — completed with **2 errors and 261 warnings** in the existing lint scope, including errors in untouched `tests/node/s1a.test.mjs` (`readFile` unused and `TextEncoder` undefined); no errors in either changed test file.
- `bun run test` — **2,272 passed, 17 failed, 5 skipped (2,294 collected across 170 files)**. Failures were environment/setup-related and outside the changed S1-a tests: 15 native review-artifact provider tests cannot load the native addon, and 2 SDK fixture tests cannot resolve the expected worktree-local TypeScript compiler module. The focused CLI, core loader, and real-FS suites listed above all passed.

An intermediate focused run had 7/8 passing because the test asserted that the expected selected identifier `ac-2` was absent. This incorrectly treated a resolved selected ref as a leak; the assertion was corrected to check only the untrusted approval reference and absolute path, after which the focused suite passed 8/8.

No production files were changed. Fix round 1 changes are committed separately after the initial test/report commit.
