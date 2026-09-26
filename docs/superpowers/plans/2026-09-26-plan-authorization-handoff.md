# Plan Authorization Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every authorized plan task observable and reviewable, without recording unauthorized attempts.

**Architecture:** The PlanBridge validates plan-scoped authority and selects a task before ObservationHandler starts its attempt. The attempt commits before exposing its binding. Review dispatch and progress processing retain their existing ordered path.

**Tech Stack:** TypeScript, Bun, Vitest, JSON observation log.

## Global Constraints

- Core remains free of OpenCode imports; all boundaries degrade to advisory without granting acceptance.
- An approved plan spans multiple tasks and final review; progress does not invalidate the fingerprint.
- `declared` evidence cannot satisfy Gate PASS; review calls remain separate from implementation calls.
- Development verification runs inside `.devcontainer/`.

---

### Task 1: Durable implementation handoff

**Files:** Modify `src/core/justice-plugin.ts`, `src/hooks/plan-bridge.ts`, `src/hooks/observation-handler.ts`; test `tests/core/justice-plugin-routing.test.ts`.

**Interfaces:** The selected `modifiedPayload.args.task_id` and a validated active authorization are consumed by the observation PreToolUse handler; it publishes a call binding only after both lifecycle transitions commit.

- [x] **Step 1: Write failing tests.** Add a plugin test that arms a two-task plan, invokes `task()` without `task_id`, then invokes PostToolUse and asserts a durable `review_pending` transition with the selected task ID. Add cases asserting no positive lifecycle for unarmed and changed plans, including a caller-supplied `task_id`.
- [x] **Step 2: Verify red.** Run `devcontainer exec --workspace-folder . bunx vitest run tests/integration/plan-authorization-handoff.test.ts` and verify the new assertions fail on the original handler ordering.
- [x] **Step 3: Make the handoff atomic.** Validate and select via PlanBridge first; only run observation attempt setup for a successful delegation, using its chosen task ID and validated binding. Commit `pending → authorized → in_progress` before storing the call binding. Leave review calls on the existing review-first branch.
- [x] **Step 4: Verify green.** Re-run the same targeted tests and confirm the transitions refer to one current `TaskExecutionRef`.

### Task 2: Plan-scoped arm and mismatch handling

**Files:** Modify `src/hooks/plan-bridge.ts`; test `tests/hooks/plan-bridge-authorization.test.ts` and `tests/core/justice-plugin-routing.test.ts`.

**Interfaces:** The active approved plan remains armed until explicit cancellation, invalidation or release; the selected canonical task ID overrides no caller-provided mismatched ID.

- [x] **Step 1: Write failing tests.** Drive two task calls under one `/justice-implement --approved` and assert both are delegated. Assert a mismatched explicit `task_id` does not produce an implementation binding.
- [x] **Step 2: Verify red.** Run `devcontainer exec --workspace-folder . bunx vitest run tests/integration/plan-authorization-handoff.test.ts`.
- [x] **Step 3: Implement.** Remove one-shot consumption from the validated PreToolUse path, preserving cancellation and fingerprint invalidation. Reject mismatched supplied IDs before observation starts.
- [x] **Step 4: Verify green.** Re-run the targeted tests.

### Task 3: Documentation and full verification

**Files:** Modify only the relevant descriptions in `README.md` and `SPEC.md` where they describe one-shot authorization or attempt order. This repository does not have `README.ja.md`.

**Interfaces:** Documentation describes the same plan-scoped authority and durable handoff as the tests; the English canonical README precedes its Japanese translation.

- [x] **Step 1: Reconcile descriptions.** Remove one-shot wording and document the validation-before-observation order, linking to the normative specification rather than duplicating its contract.
- [x] **Step 2: Verify.** Run `devcontainer exec --workspace-folder . bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` in the devcontainer; inspect the final diff for unrelated changes.
