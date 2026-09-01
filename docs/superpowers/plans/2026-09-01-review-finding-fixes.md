# Review Finding Fixes Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Do not dispatch subagents; this repository task explicitly requires inline execution.

**Goal:** Align the documented delegation contract with the implementation and preserve category, persona, and completion-state provenance at their existing boundaries.

**Architecture:** Keep `DelegationRequest.context` internal and task-scoped, while making category origin an explicit `PlanBridgeCore` option so classifier-derived categories retain routing validation. Make persona detection authoritative for valid explicit agent input, and keep completion pending state strictly keyed by an existing `callId`.

**Tech Stack:** TypeScript, Vitest, Bun, Markdown.

## Global Constraints

- `src/core/**` remains independent of `@opencode-ai/*` imports.
- Hook and adapter boundaries remain fail-open.
- `DelegationRequest.context` is internal-only and is not added to the OMO wire payload.
- Explicit externally supplied categories remain authoritative and continue to allow the existing role/category mismatch behavior.
- Calls without `callId` must not create or consume call-scoped completion state.
- Do not create commits or use subagents.

---

### Task 1: Add regression tests for routing provenance

**Files:**
- Modify: `tests/core/plan-bridge-core.test.ts`
- Modify: `tests/hooks/plan-bridge.test.ts` only if a hook-level provenance assertion is required by the existing test helpers

**Interfaces:**
- Consumes: `PlanBridgeCore.classifyAndBuildWorkerRequest()` and the existing `CategoryClassifier` behavior.
- Produces: Failing coverage for classifier-derived category provenance and preserved explicit category behavior.

- [ ] **Step 1: Write the failing test**

Add a test that passes the `CategoryClassifier` result for a `deep reasoning research` task with an explicit classifier source and expects the role/category mismatch to be rejected. Keep the existing test that passes `category: "sp-integration"` without classifier provenance and expects the explicit category to be preserved.

```typescript
it("validates a category supplied by the internal classifier", () => {
  expect(() =>
    core.classifyAndBuildWorkerRequest(makeTask({ title: "deep reasoning research" }), {
      taskId: "t1",
      prompt: "research the design",
      category: "unspecified-low",
      categorySource: "classifier",
    }),
  ).toThrow("Invalid routing pair");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun run vitest run tests/core/plan-bridge-core.test.ts`

Expected: FAIL because `categorySource` is not yet accepted and classifier provenance is not currently represented.

---

### Task 2: Add regression tests for persona and pending-state boundaries

**Files:**
- Modify: `tests/core/plan-completion-detector.test.ts`

**Interfaces:**
- Consumes: `inferPersonaFromToolInput()`, `PlanCompletionDetector.recordPreToolUseInvocation()`, and `evaluateSkillCompletion()`.
- Produces: Failing coverage for explicit persona precedence and callId-less medium-confidence fallback.

- [ ] **Step 1: Write the failing tests**

Add tests for a valid explicit persona overriding conflicting skills and for a missing `callId` not consuming pending skill state.

```typescript
it("prioritizes a valid explicit agent over conflicting skill hints", () => {
  expect(
    inferPersonaFromToolInput({ agent: "atlas", skills: ["systematic-debugging"] }),
  ).toBe("atlas");
});

it("does not use pending state when callId is absent", () => {
  const detector = new PlanCompletionDetector();
  detector.recordPreToolUseInvocation("s-no-call", undefined, "task", {
    skills: ["writing-plans"],
  });

  expect(
    detector.evaluateSkillCompletion(
      "s-no-call",
      undefined,
      "task",
      "Completed the plan",
      false,
      "writing-plans",
    ),
  ).toBeNull();
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun run vitest run tests/core/plan-completion-detector.test.ts`

Expected: FAIL because the skill hint currently overrides `agent`, and the `_` completion key currently enables pending state without a call ID.

---

### Task 3: Implement category provenance and completion fixes

**Files:**
- Modify: `src/core/plan-bridge-core.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/core/plan-completion-detector.ts`

**Interfaces:**
- Consumes: The regression tests from Tasks 1 and 2.
- Produces: `WorkerOptions.categorySource`, classifier provenance passed by `PlanBridge`, valid explicit-agent precedence, and callId-gated pending state.

- [ ] **Step 1: Add the minimal category-source option**

Add an internal `categorySource?: "classifier" | "explicit"` option. Use `"classifier"` to select `task_classification`; preserve the existing default in which a supplied category is `explicit_request` when no source is given. Pass `categorySource: "classifier"` from both `PlanBridge` classifier call sites.

- [ ] **Step 2: Make explicit persona validation authoritative**

Validate `toolInput.agent` before deriving skills or text hints. Return the canonical validated `AgentId`; continue through the existing heuristics only when the value is absent or invalid.

- [ ] **Step 3: Gate pending state on callId**

Make `getCompletionKey()` return `undefined` when `callId` is absent. Only read, update, delete, or create `pendingMap` entries when a key exists. For a missing key, continue directly to `detectFromResult()` after the existing tool/error checks.

- [ ] **Step 4: Run the focused tests**

Run: `bun run vitest run tests/core/plan-bridge-core.test.ts tests/core/plan-completion-detector.test.ts tests/core/routing-decision.test.ts tests/integration/routing-core.test.ts`

Expected: PASS with the new regression cases and all existing routing/completion cases.

---

### Task 4: Align the specification with the implemented contract

**Files:**
- Modify: `SPEC.md:119-124,262-272`

**Interfaces:**
- Consumes: The current `DelegationRequest` and `PlanBridge` persona flow.
- Produces: A specification that states `context` is internal-only, excludes it from wire payloads, and documents detector-first persona resolution.

- [ ] **Step 1: Update the delegation boundary text**

Explicitly state that `DelegationRequest.context` is an internal Justice field and is not serialized into the OMO wire payload.

- [ ] **Step 2: Remove the nonexistent `delegation.context.agentId` priority**

Document `PlanCompletionDetector.lastInvokedPersona(sessionId)` as the first available persona source after its validated `toolInput.agent` handling, followed by the `"hephaestus"` fallback. Keep `DelegationContext.agentId` documented for its separate retry context rather than conflating it with `DelegationRequest`.

- [ ] **Step 3: Check the specification section for contradictory wording**

Confirm that §4.1 no longer describes a field absent from `DelegationRequest` or an unimplemented priority path.

---

### Task 5: Run repository verification

**Files:**
- No additional files.

**Interfaces:**
- Consumes: The implementation and specification changes from Tasks 1-4.
- Produces: Verified type safety, lint cleanliness, complete tests, and a successful production build.

- [ ] **Step 1: Run type checking**

Run: `bun run typecheck`

Expected: exit code 0.

- [ ] **Step 2: Run linting**

Run: `bun run lint`

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 3: Run all tests**

Run: `bun run test`

Expected: all test files pass.

- [ ] **Step 4: Run the production build**

Run: `bun run build`

Expected: exit code 0 and the existing `dist/` output is regenerated successfully.
