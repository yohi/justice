# Task 5/6 protected operation publication report

## Status

Implemented the owned operation-publication path and wired NC1 reentry and
semantic-context transitions to protected prepare → shard sync → witness CAS
with same-publication recovery. Added the V2 NC1 application event and projection
behavior that clears only a matching same-epoch NC1 stop. Existing Legacy event
bytes and the protocol-release BLOCK stub are unchanged.

The store regression uses a real protected witness and verifies first recovery
returns `committed`, a repeated recovery returns `already_committed`, and the
same gate/operation ID cannot publish again. Projection coverage verifies the
same generation and spent rounds remain in place when an NC1 stop is applied.

**Coverage limitation:** the requested new coordinator end-to-end test that
drives verified material progress through NC1 validation, protected publication,
and Gate resume was not added. The coordinator routes are implemented and the
existing coordinator/restart/integration suites pass, but this report does not
claim that requested end-to-end scenario is independently covered. The
Task 5/6 checkpoint should remain subject to that production-path coverage gap.

## Changes

- `src/runtime/review-gate-event-store.ts` — added
  `prepareAdmittedOperationPublication`. It validates the live owned capability,
  scope/Gate/writer membership, optional expected writer head, V2-only event
  batch, and once-only operation ID before using the existing publication
  builder, owned prepare, and exact shard sync path. Genesis authorization is
  rejected on this operation-only surface.
- `src/core/review-gate/event-schema.ts` — added the typed
  `NC1_REENTRY_OUTCOME_APPLIED` V2 event with validation, evidence, observed
  change, operation, and remaining-round references.
- `src/core/review-gate/projection.ts` — clears a non-convergent suspension only
  when the applied event matches the projected stop ID and epoch; does not
  alter remediation round counters.
- `src/runtime/review-gate-coordinator.ts` — routes semantic transitions and
  `REENTER_SAME_GENERATION` through owned protected operation publication and
  CAS/recovery, mirrors the committed V2 event into the local journal, and
  resumes the same Gate. Semantic operation/validation IDs are deterministic;
  already committed matching operations are detected via the owned verified
  scope history and are not re-applied.
- Tests updated in `tests/runtime/review-gate-event-store.test.ts` and
  `tests/core/review-gate/projection.test.ts`.

## Verification

The provided HEAD reference did not exactly match the worktree HEAD. The worktree
reported `9b0e01984e44bee7f749e6f4316d7f03c48b32dc` from `git rev-parse HEAD`.

Fresh verification after the implementation changes:

- Focused Task 5/6 suites plus event-store and projection regressions: **7 files
  passed; 188 tests passed; 2 pre-existing expected failures**.
- `bun run test`: **225 files passed, 2 skipped; 3,578 passed, 2 expected
  failures, 7 skipped**. The skipped cases are existing opt-in host E2E tests.
- `bun run typecheck`: passed (`tsc --noEmit`).
- `bun run lint`: exit 0, **775 warnings, 0 errors**. Warnings are the existing
  repository-wide lint findings; the introduced unused test variable was
  removed, and the changed files have no new lint errors.
- `bun run build`: passed; 438 modules bundled.
- `git diff --check`: passed before report creation; rerun before checkpoint.

No tests were deleted, no type errors were suppressed, and no merge or push was
performed.
