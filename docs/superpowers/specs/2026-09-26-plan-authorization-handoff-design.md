# Plan Authorization Handoff Correction

## Authority and scope

`REQUIREMENTS_2026-09-03.md` (JUS-P0-02, JUS-P0-03 and JUS-P0-04) and the semantic control plane design govern implementation. This document clarifies the handoff between the existing hooks; it does not replace the normative specification in `SPEC.md`.

## Authorized implementation calls

An approved plan binding lasts across all tasks and final review. An implementation command arms the plan, rather than granting a single-use task token. Cancellation, fingerprint invalidation, release, or replacement removes that authority. A call with an inactive or changed plan remains advisory-only: fail-open execution must never create a positive attempt or review authority.

For each implementation `task()` PreToolUse, the review claim path runs first. The ordinary path reads the active plan and binding, checks the current fingerprint and plan-scoped arm, and selects the next canonical task. A supplied `task_id` must equal that selection; the generated task ID must be passed to observation even if the caller omitted it. Only after that validation does observation append the initial lifecycle transitions. A call binding is published only when both transitions commit. On I/O failure the tool may run, but its result cannot produce an authorized review or acceptance. The same call ID and selected task ID must reach PostToolUse.

The controller must not interpret an advisory response as approval. Existing mandatory review claims never start an implementation attempt. Worker results remain declared evidence; review, Gate PASS and accepted decision precede progress updates.

## Worker routing

Every canonical role has a default `sp-*` category. Explicit caller-selected categories are intentional overrides, whereas an implicit downgrade of a high-complexity role is forbidden (JUS-P0-03-02). Existing `explicit_request` and `compatibility_fallback` exceptions are retained. Justice never selects a worker model.

## Verification

Integration tests must drive the real plugin PreToolUse and PostToolUse with and without a supplied task ID. They must distinguish authorized multi-task execution from unarmed, stale-plan, mismatched task ID, and failed lifecycle append. Assert on durable lifecycle/review transitions and final directive or progress, rather than on natural-language text. Unit tests cover the explicit routing mismatch. Run the project test, typecheck, lint and build commands inside the devcontainer.
