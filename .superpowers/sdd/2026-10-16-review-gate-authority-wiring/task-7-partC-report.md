# Task 7 part C report

## Implemented

- Added the `justice_review.query` union for `artifact_read`, `artifact_search`, `show`, `status`, and `diff`.
- Added PlanBridge query dispatch. Approved Design reads/searches use the verified approved-Design authority; scoped status/diff are labeled `unapproved_D1_diagnostic`.
- Built the Review Gate query service and approved-Design authority in the shared OpenCode runtime graph and installed both on PlanBridge.
- Added a pre-tool cancellation for generic content-bearing reads/searches, shell/terminal fallback, and Git show aliases while a Review Gate lock is active. Guidance directs callers to `justice_review.query`.
- Added tests for D0-vs-D1 query output and generic-read cancellation.

## Verification

- Focused Task 7 command: 7 files, 146 tests passed.
- `bun run test`: 227 files passed, 2 skipped; 3,584 passed, 2 expected-fail, 7 skipped.
- `bun run typecheck`: passed.
- `bun run lint`: exited 0, 775 warnings, 0 errors.
- `bun run build`: passed.

## Remaining gaps / limitations

- The PlanBridge lock snapshot currently initializes `reviewPhase` and `operationId` to `null` and this change does not establish the current durable operation from host call context. Therefore the requested wrong-operation/session/generation binding enforcement at the query boundary is not yet complete.
- The coordinator still persists the approved-Design read binding but this change does not replace every reviewer/validator/revalidator/self-review prompt's mutable Design/workspace attachment with content assembled from verified D0 bytes.
- The integration test uses injected authority/query doubles to exercise the PlanBridge boundary; it does not exercise a real durable Gate/witness/blob or staged Git index. Missing/corrupt blob, stale CLEAR, protocol/Requirements changes, and operation/generation spoof cases remain uncovered by this part C change.
- The adapter regression asserts cancellation response before dispatch. It does not execute a host tool callback; OpenCode's hook boundary is the cancellation point.

The changes are therefore partial and must not be treated as completing the full Task 7 part C acceptance criteria.
