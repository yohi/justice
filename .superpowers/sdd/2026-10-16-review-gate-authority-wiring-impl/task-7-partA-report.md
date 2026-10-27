# Task 7 Part A Report — Approved Design Authority Wiring

## Delivered

- Extended `AdmissionOwnedWitness` with `readVerifiedDesignBinding`. Its implementation is available only on the live admission-owned capability, checks the held Gate lock and enrolled Design path, and reads the HEAD tree entry plus blob size from Git object storage while the protected witness transaction is live. It does not read Design bytes from the public workspace.
- Added `buildApprovedDesignOperationReadBinding`. With its authority services supplied, it resolves the protected scope/Gate history through `readVerifiedScopeOwned`, requires the operation to match the current `DESIGN_CLEAR` context, and compares the verified witness Git binding against the current committed/index/worktree Git identity.
- Added `createReviewGateApprovedDesignAuthority`, forwarding approved immutable read/search calls to the supplied query service.
- Added `reviewPhase` and `operationId` to `ReviewGateLockSnapshot`. They initialize to `null` because this part does not add coordinator/bridge mediation.
- Added focused tests covering owned Design binding production, verified clear/current Git binding, unsafe path rejection, and fail-closed behavior when factory admission context is missing.

## Scope note

The existing `ReviewGateScopeAdmission.withAdmissionLease` requires a complete workspace/protocol `ScopeAdmissionRequest`, which is not included among the four required factory arguments. The factory therefore accepts an optional `admissionRequest`; when supplied, binding lookup obtains a live owned capability and uses `readVerifiedScopeOwned`. When omitted, binding lookup fails closed and returns `null`. The factory is not wired into `opencode-adapter.ts` or PlanBridge mediation, per task instructions. A follow-up wiring task must provide the admission request at the composition boundary before enabling approved reads.

## Verification

- Focused: `bun run vitest run tests/runtime/review-gate-approved-design-authority.test.ts` — 3 passed.
- `bun run test` — 226 files passed, 2 skipped; 3,581 passed, 2 expected failures, 7 skipped.
- `bun run typecheck` — passed.
- `bun run lint` — passed with 775 warnings and 0 errors. The run includes repository-wide existing warnings; the new authority module introduced no lint warnings.
- `bun run build` — passed.
