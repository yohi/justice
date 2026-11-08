# Task 1 Implementation Report

## Status

Implemented the pure S1-d report contract, provenance projection, report assembly, and five required unit tests. No existing S1-a, S1-b, or S1-c source or test files were modified, and no Task 2-6 work was started.

## Changes

- `src/core/s1d/contract.ts`
  - Added the readonly `Stage<T>`, `InputIssue`, `EvidenceProvenanceClaim`, `ProvenanceProjection`, `ScopeFallback`, and `S1dReportV1` contracts from Design §§7-8.
  - Added the fixed `StageSkipReason` union and the Design §8 `S1dFatalErrorV1` contract.
  - Kept `ScopeFallback.NOT_EVALUATED` separate from the comparison-bearing evaluated variant.
- `src/core/s1d/report.ts`
  - `projectProvenance` validates the entire parsed Evidence value using the existing `inspectEvidenceRefs`, only projects its canonical validated refs, accepts only evaluated/baseline-unknown S1-b results, checks exact one-to-one binding ID correspondence, sorts claims by evidence ID, and freezes the output.
  - All withheld outcomes contain no claims and distinguish unavailable source, malformed set, unavailable binding, and inconsistent bindings.
  - `assembleReport` preserves the original Core result objects, snapshots report-owned containers, and emits sorted/deduplicated limitations from evaluated Core stages and relevant report boundaries. It includes `scopeFallback` only when supplied.
- `tests/core/s1d/report.test.ts`
  - Added the five required named tests: `projectsOnlyCompletelyValidEvidenceClaims`, `withholdsAllClaimsForOneInvalidRef`, `withholdsMismatchedBindingIds`, `retainsEmptyValidSetAndNotReadyBaseline`, and `unionsLimitationsAndPreservesCore`.

## Test-first evidence

The required test command was run before implementation. It failed at module resolution because `src/core/s1d/report.ts` did not exist, as expected for the missing implementation. After implementation, the same command passed all five tests.

## Verification

- `bun run vitest run tests/core/s1d/report.test.ts` — PASS, 1 test file / 5 tests.
- `bun run typecheck` — PASS (`tsc --noEmit`, exit 0).
- `bun run lint` — PASS, exit 0; repository emitted 286 warnings and 0 errors. Warnings are repository-wide existing lint warnings; this run did not identify a blocking lint error.
- LSP diagnostics for all three changed TypeScript files — no diagnostics.
- Pure LOC: contract 70, report implementation 80, tests 108.
- `git diff --check` — PASS before staging.

## Review notes

- Responsibility: `contract.ts` owns S1-d report data contracts; `report.ts` owns pure report projection and assembly; the test file owns their behavioral coverage.
- Trust boundary: provenance projection accepts `unknown` and relies on the full existing validator before copying any claim fields.
- Core S1-a/b/c results are passed through unchanged; no result fields or semantics were invented or reinterpreted.
- Returned report-owned objects and arrays are frozen. Core result values are retained by reference and are not deep-cloned or reinterpreted.
- No `any`, suppression, logger, or one-off helper beyond the internal withheld-result constructor was introduced. The helper centralizes the invariant that withheld claims are always empty.
- No specification conflict was identified.

## Commit

Commit: `feat(justice): add S1-d report projection`.
