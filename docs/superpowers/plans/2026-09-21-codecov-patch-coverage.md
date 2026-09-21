# Codecov Patch Coverage Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise PR #250's diff coverage above the configured 86% patch target by testing the newly added review-dispatch behavior without changing production behavior.

**Architecture:** Keep the implementation unchanged and exercise `createReviewDispatchState` through an in-memory dependency harness. Cover the artifact reservation port independently with injected filesystem mocks, then run the same unit/integration coverage commands used by CI so the merged LCOV result matches Codecov's input.

**Tech Stack:** TypeScript, Vitest, Bun, Vitest V8 coverage, LCOV, Codecov.

## Global Constraints

- Preserve the pure-core boundary: tests may import core modules, but production code must not import OpenCode APIs.
- Use injected in-memory filesystem and notifier/dependency mocks; ordinary unit tests must not use the real filesystem.
- Preserve fail-open behavior and immutable public state; assertions must verify observable outcomes rather than private implementation details.
- Do not add `any`; use `unknown` casts only where an existing test must inspect a private field.
- Do not change `codecov.yml`, CI workflow thresholds, or production implementation to mask missing coverage.
- Use Bun commands from the repository's existing scripts and do not commit unless explicitly requested.

---

### Task 1: Exercise Review Dispatch State Transitions

**Files:**
- Modify: `tests/core/review-dispatch-state.test.ts`
- Read-only references: `src/core/review-dispatch-state.ts`, `src/core/v2/observation-model.ts`, `src/core/plan-authorization.ts`

**Interfaces:**
- Consumes: `createReviewDirectiveSink`, `createReviewDispatchState`, `ReviewDispatchDependencies`, `ReviewCorrelation`, `ReviewDispatchTransitionRecord`, and `ApprovedPlanBinding`.
- Produces: behavior tests for pending/offered/claimed/terminal/retry/recovery paths and directive queue retention semantics.

- [ ] **Step 1: Add a deterministic in-memory dependency harness**

Create a helper in the existing test file that stores `records`, `authorizations`, appended directives, and advisories in local arrays. Its `appendReviewDispatchTransition` implementation must assign monotonically increasing `sequence` values and append committed records, while its `readDurableRecords`, `readDurableAuthorizations`, `findAuthorizationById`, `reserveReviewArtifact`, `withAuthorizationReviewBoundary`, and `generateId` implementations remain deterministic.

Use this shape for the transition appender so tests verify durable records rather than only return values:

```ts
appendReviewDispatchTransition: async (input) => {
  const record = { ...input, sequence: records.length + 1 };
  records.push(record);
  return { kind: "committed", record };
},
```

Use an active authorization whose canonical snapshot includes `task-1`, plus a task-review correlation with authorization `auth-1`, task `task-1`, attempt `attempt-1`, and review round `1`. Keep timestamps and generated IDs fixed.

- [ ] **Step 2: Test directive sink delivery, deduplication, retention, and rollback**

Add tests that:

```ts
const sink = createReviewDirectiveSink();
await sink.deliver(delivery);
await sink.deliver(delivery);
expect(await sink.drainForParentSession("parent-1", async () => "inject")).toEqual([delivery]);
```

Also verify that `"retain"` keeps a delivery for the next drain, `"discard"` removes it, and a throwing decision callback restores every queued delivery before rethrowing.

- [ ] **Step 3: Test offering and claiming a task review**

Seed a `task_lifecycle_transition` from `evidence_pending` to `review_pending`, call `offerNextMandatoryReview("parent-1")`, and assert an `offered` result, one pending dispatch transition, and one injected `review_required` directive. Then call `claimReviewDispatch` with category `sp-review` and assert a usable `task_review` binding plus a committed pending-to-claimed transition containing the supplied call ID and artifact reservation.

Cover the negative claim outcomes in the same describe block:

- wrong category or no pending slot returns `blocked` with `review_claim_unavailable`;
- an active authorization lookup that is no longer active cancels the pending slot and returns `review_authorization_terminal`;
- an append failure returns `review_claim_commit_failed` without manufacturing a binding;
- more than one outstanding slot records `review_dispatch_integrity_violation` and blocks.

- [ ] **Step 4: Test unusable artifacts and terminal failure retry**

Make `reserveReviewArtifact` return each unusable reservation and assert that claiming returns `claimed_unusable`, omits no binding fields other than the documented artifact-path behavior, records `artifact_reservation_unusable`, and appends a terminal transition.

For a claimed slot, call `terminalizeReviewFailure` with `review_execution_failed` and `lost_conclusive`. Assert that the original slot becomes terminal, the next review round is offered when the authorization remains active, and the result is `retried` with the incremented correlation. Assert that terminalization blocks when the claim identity does not match, the authorization is terminal, or the terminal append fails.

- [ ] **Step 5: Test cancellation, queued validation, and restart recovery**

Add cases for:

- cancelling a pending or claimed slot for a terminal authorization;
- `validateQueuedReviewDirectiveWithinParentSessionClaim` returning `inject`, `discard`, and `retain` for a valid pending slot, stale correlation, and unreadable durable records respectively;
- restart recovery reinjecting an active pending directive;
- restart recovery terminalizing a claimed slot with an unusable reservation;
- restart recovery cancelling an inactive pending slot and recording `review_dispatch_recovery_failed` when hydration or recovery I/O throws.

- [ ] **Step 6: Run the focused state tests**

Run:

```bash
bun run vitest run tests/core/review-dispatch-state.test.ts
```

Expected: all existing projection tests and all new state-machine tests pass.

### Task 2: Cover Artifact Reservation Failure Modes

**Files:**
- Modify: `tests/core/review-artifact-reservation.test.ts`
- Read-only references: `src/core/review-artifact-reservation.ts`, `tests/helpers/mock-file-system.ts`

**Interfaces:**
- Consumes: `createReviewArtifactReservationPort`, `ReviewArtifactReservationPort`, `FileReader`, `FileWriter`, and `ReservedReviewArtifactIo`.
- Produces: deterministic tests for every reservation result and advisory boundary.

- [ ] **Step 1: Test collision retry and exhaustion**

Configure `createExclusiveMarker` to return `occupied` once and then `created`; assert that the generated IDs advance and the second marker produces the usable reservation. Configure it to return `occupied` for all `MAX_ARTIFACT_RESERVATION_ATTEMPTS` calls and assert `artifact_path_collision_exhausted` plus the expected advisory calls.

- [ ] **Step 2: Test invalid IDs, ID generation failures, and storage failures**

Use an ID containing `../` and assert `artifact_path_invalid`. Make `generateId` throw and assert `reservation_internal_error`. Make `createExclusiveMarker` throw and assert `artifact_storage_unavailable` with the thrown cause passed to the advisory callback.

- [ ] **Step 3: Test advisory failure remains fail-open**

Make the advisory callback throw for occupied, invalid, generation-error, and storage-error cases. Assert that reservation still returns the documented unusable result and does not reject.

- [ ] **Step 4: Run the focused artifact tests**

Run:

```bash
bun run vitest run tests/core/review-artifact-reservation.test.ts
```

Expected: all existing and new reservation tests pass without real filesystem access.

### Task 3: Verify the CI Coverage Artifact and Quality Gates

**Files:**
- Modify: none unless the merged LCOV identifies a still-uncovered changed branch that is not represented by the tests above.
- Inspect: `.github/workflows/codecov.yml`, `codecov.yml`

**Interfaces:**
- Consumes: unit and integration Vitest configurations and the merged LCOV format expected by Codecov.
- Produces: fresh test, type, lint, build, and merged-coverage evidence.

- [ ] **Step 1: Run the required project checks**

Run each command independently:

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

Expected: all commands exit successfully.

- [ ] **Step 2: Reproduce the workflow's unit and integration coverage**

Run the workflow-equivalent commands:

```bash
rm -rf coverage
bunx vitest run --coverage --coverage.reporter=lcov --coverage.reporter=text
mv coverage/lcov.info /tmp/unit-lcov.info
rm -rf coverage
bunx vitest run --coverage --coverage.reporter=lcov --coverage.reporter=text --config vitest.integration.config.ts
mv coverage/lcov.info /tmp/integration-lcov.info
rm -rf coverage
mkdir -p coverage
npx lcov-result-merger '/tmp/*-lcov.info' coverage/lcov.info
```

Expected: `coverage/lcov.info` exists and the changed source files have at least 86% patch coverage when evaluated from the merged report. If a changed branch remains below target, add the smallest behavior test for that exact branch and rerun this step.

- [ ] **Step 3: Inspect the final diff and report evidence**

Run `git diff --check` and inspect `git diff --stat` plus the changed test files. Confirm that no production behavior, Codecov threshold, secret, or absolute host path was added before reporting completion.
