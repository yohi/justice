# Acceptance Finalization and Review Directives Implementation Plan

> **For agentic workers:** Use inline execution with test-first checkpoints. Steps use checkbox syntax for tracking.

**Goal:** Automatically request Final Review after every approved canonical task is durably accepted, and provide controllers with structured review directive context.

**Architecture:** Extend the existing task-review PostToolUse path to read durable records, verify acceptance for every task in the current active authorization's canonical snapshot, and invoke the existing finalization lifecycle API only when no finalization has begun. Keep the lifecycle append and notification path authoritative. Add a pure formatter for the discriminated `ReviewRequiredDirective` correlation and use it for both PreToolUse and PostToolUse delivery.

**Tech Stack:** TypeScript, Bun, Vitest.

## Global Constraints

- Preserve pure-core boundaries, fail-open hook behavior, immutable public state, and JSON-only persistence.
- Use only `binding.canonicalSnapshot.tasks` as the task set for all-accepted evaluation.
- Do not treat plan checkboxes or declared/self-reported evidence as acceptance authority.
- Follow parent-session authorization/review serialization and existing durable lifecycle transition rules.
- Run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` inside `.devcontainer/` before completion.

---

### Task 1: Auto-advance Final Review after canonical tasks are accepted

**Files:**
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

**Interfaces:**
- Consumes: `ReviewTaskCallBinding.canonicalSnapshot`, durable task lifecycle projection, and `ObservationHandler.advanceFinalizationAfterAllTasksAccepted`.
- Produces: after an accepted task review, a finalization attempt only when all canonical task IDs are currently `accepted` and no finalization transition exists for that authorization.

- [x] Add a regression test with two canonical tasks: accepting the first must not enqueue Final Review; accepting the second must durably advance finalization and deliver a Final Review directive.
- [x] Add regression tests proving an already-started finalization is not restarted by duplicate PostToolUse handling and simultaneous acceptance events serialize into one finalization.
- [x] Run the targeted routing test and confirm the new cases fail before implementation.
- [x] Implement the check using a fresh durable-log read and projection keyed by the current `parentSessionId` and `authorizationId`; require every canonical snapshot task to have lifecycle state `accepted`, with per-parent serialization around check-and-advance.
- [x] Preserve fail-open behavior: read/advance failures record a review-dispatch advisory and do not block the hook response.
- [x] Run the targeted routing tests and confirm both new cases pass.

### Task 2: Format review directive context for both delivery hooks

**Files:**
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

**Interfaces:**
- Consumes: `ReviewRequiredDirective` (`task-review` or `final-review` correlation).
- Produces: `formatReviewDirective(directive: ReviewRequiredDirective): string`, rendering the review kind and all identity fields relevant to that correlation variant.

- [x] Add routing assertions for task-review context containing `taskId`, `attemptId`, and `reviewRound`, and final-review context containing `planPath`, `authorizationId`, `finalizationAttemptId`, and `finalReviewRound`.
- [x] Run the targeted routing test and confirm the assertions fail against the current title-only injection.
- [x] Implement the formatter with exhaustive discriminated-union handling; derive `sp-review` / `sp-final-review` category from `reviewKind` rather than assuming category is stored on the directive.
- [x] Replace both title-only injected contexts with `formatReviewDirective(delivery.directive)`.
- [x] Run the targeted routing test and confirm it passes.

### Task 3: Verify repository quality gates

**Files:** None beyond Tasks 1 and 2.

- [x] In `.devcontainer/`, run `bun run test`.
- [x] In `.devcontainer/`, run `bun run typecheck`.
- [x] In `.devcontainer/`, run `bun run lint` and distinguish pre-existing warnings from errors.
- [x] In `.devcontainer/`, run `bun run build`.
- [x] Inspect the final diff and working-tree status; report any checks that could not run.
