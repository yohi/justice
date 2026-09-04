# Semantic Control Plane Implementation Plan

> **For agentic workers:** Execute this plan inline in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Justice v4.0.0 Semantic Control Plane for JUS-P0-01 through JUS-P0-04 with durable, attempt-scoped authorization, review, gate, and acceptance state.

**Architecture:** The append-only observation/decision log is the durable source for lifecycle, review dispatch, completion staging, artifact consumption, review observation, Gate, and Acceptance. `.justice/authorizations.json` is the sole explicit exception: it stores only `ApprovedPlanBinding`, including its `CanonicalPlanSnapshot`. Runtime code remains fail-open; an unavailable or unverified acceptance precondition remains blocked.

**Tech Stack:** TypeScript, Bun, Vitest, Zod, `AtomicPersistence`, `ObservationLogStore`, `StateProjectionCache`, and injected mock file systems.

## Global Constraints

- Modify only files listed by the task being executed.
- `src/core/**` must not import `@opencode-ai/*`.
- Public state is immutable through `readonly`, `ReadonlyArray`, and `ReadonlyMap`.
- Ordinary unit tests use `tests/helpers/mock-file-system.ts`; only existing designated real-fs suites access disk.
- Persist lifecycle and review state only in the existing append-only observation/decision log.
- Persist authorization state only in `.justice/authorizations.json`; `ApprovedPlanBinding.canonicalSnapshot` is the sole durable canonical snapshot.
- A failed I/O boundary returns `PROCEED`; it must not produce `Authorized`, `Accepted`, or `Complete`.
- Mandatory `sp-review` and `sp-final-review` calls canonicalize `run_in_background` to `false`.
- A Phase 3 runtime spike that cannot prove `parentCallId -> childSessionId` correlation blocks Phase 3 and JUS-P0-04 completion.
- Run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` inside `.devcontainer/` after every phase.
- Ask the user before each commit. The listed `git add` command is the complete commit scope.

---

## Phase 1: Semantic Category Routing — JUS-P0-03

### Task 1.1: Map all seven execution roles to seven `sp-*` categories

**Requirement:** JUS-P0-03, INV-01, INV-02, INV-05.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/omo-category-mapper.ts`
- Modify: `src/core/routing-decision.ts`
- Modify: `src/core/category-classifier.ts`
- Test: `tests/core/routing-decision.test.ts`
- Test: `tests/unit/core/omo-category-mapper.test.ts`

**Consumes:** `ExecutionRole`, `SpCategory`, `createWorkerRoutingDecision(executionRole, category, reason)`.

**Produces:** `SpCategory` with `"sp-deep" | "sp-architecture"`; `OmoCategoryMapper.map(role: ExecutionRole): SpCategory`; worker routing that rejects every non-compatibility pair outside the seven-pair mapping.

- [ ] **Step 1: Write the failing routing tests**

```ts
it.each([
  ["mechanical", "sp-mechanical"],
  ["implementation", "sp-implementation"],
  ["integration", "sp-integration"],
  ["review", "sp-review"],
  ["final-review", "sp-final-review"],
  ["deep", "sp-deep"],
  ["architecture", "sp-architecture"],
] as const)("maps %s to %s", (role, category) => {
  expect(new OmoCategoryMapper().map(role)).toBe(category);
  expect(createWorkerRoutingDecision(role, category, "task_classification").category).toBe(category);
});

it("rejects the legacy architecture downgrade", () => {
  expect(() => createWorkerRoutingDecision("architecture", "unspecified-high", "task_classification")).toThrow();
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/routing-decision.test.ts tests/unit/core/omo-category-mapper.test.ts`

Expected: FAIL because `sp-deep` and `sp-architecture` are not valid categories.

- [ ] **Step 3: Implement the exact mapping**

```ts
export type SpCategory =
  | "sp-mechanical"
  | "sp-implementation"
  | "sp-integration"
  | "sp-review"
  | "sp-final-review"
  | "sp-deep"
  | "sp-architecture";

const ROLE_TO_CATEGORY: Readonly<Record<ExecutionRole, SpCategory>> = {
  mechanical: "sp-mechanical",
  implementation: "sp-implementation",
  integration: "sp-integration",
  review: "sp-review",
  "final-review": "sp-final-review",
  deep: "sp-deep",
  architecture: "sp-architecture",
};
```

Remove `deep`, `unspecified-high`, and `unspecified-low` from the non-compatibility entries of `VALID_EXECUTION_ROLE_CATEGORIES`. Change `CategoryClassifier.classify()` to return `this.categoryMapper.map(role)` without a fallback. Do not modify `RetryPolicyCalculator`; its existing `SpCategory` modifier is zero.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/routing-decision.test.ts tests/unit/core/omo-category-mapper.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/types.ts src/core/omo-category-mapper.ts src/core/routing-decision.ts src/core/category-classifier.ts tests/core/routing-decision.test.ts tests/unit/core/omo-category-mapper.test.ts
git commit -m "feat: execution roleをsp categoryへ完全対応"
```

### Task 1.2: Check required `sp-*` categories in doctor

**Requirement:** JUS-P0-03, Design §5.3.

**Files:**
- Create: `src/core/doctor-categories.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Test: `tests/core/doctor-categories.test.ts`
- Test: `tests/runtime/doctor-cli.test.ts`

**Consumes:** `SpCategory` from `src/core/types.ts`; parsed config text already produced by `src/runtime/doctor-cli.ts`.

**Produces:** `ALL_SP_CATEGORIES: readonly SpCategory[]`; `checkSpCategoryPresence(categoryNames: readonly string[]): SpCategoryPresenceResult` where `SpCategoryPresenceResult` is `{ readonly missing: readonly SpCategory[]; readonly ok: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("reports exactly the missing required categories", () => {
  expect(checkSpCategoryPresence(["sp-mechanical"])).toEqual({
    ok: false,
    missing: ["sp-implementation", "sp-integration", "sp-review", "sp-final-review", "sp-deep", "sp-architecture"],
  });
});

it("accepts all seven categories", () => {
  expect(checkSpCategoryPresence(Array.from(ALL_SP_CATEGORIES))).toEqual({ ok: true, missing: [] });
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/doctor-categories.test.ts tests/runtime/doctor-cli.test.ts`

Expected: FAIL because the category checker is absent.

- [ ] **Step 3: Implement the checker and CLI diagnostic**

```ts
export const ALL_SP_CATEGORIES: readonly SpCategory[] = [
  "sp-mechanical", "sp-implementation", "sp-integration", "sp-review",
  "sp-final-review", "sp-deep", "sp-architecture",
];

export function checkSpCategoryPresence(categoryNames: readonly string[]): SpCategoryPresenceResult {
  const names = new Set(categoryNames);
  const missing = ALL_SP_CATEGORIES.filter((category) => !names.has(category));
  return { ok: missing.length === 0, missing };
}
```

Have `doctor-cli.ts` extract category names from the already loaded effective configuration and append one non-zero-exit diagnostic for every missing name.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/doctor-categories.test.ts tests/runtime/doctor-cli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/doctor-categories.ts src/runtime/doctor-cli.ts tests/core/doctor-categories.test.ts tests/runtime/doctor-cli.test.ts
git commit -m "feat: doctorでsp category設定を検査"
```

---

## Phase 2: Plan-Scoped Authorization — JUS-P0-02

### Task 2.1: Build a parser-aligned canonical plan snapshot

**Requirement:** JUS-P0-02, INV-03, INV-04, Design §4.3.

**Files:**
- Create: `src/core/plan-fingerprint.ts`
- Test: `tests/core/plan-fingerprint.test.ts`
- Test: `tests/core/plan-parser.test.ts`

**Consumes:** `PlanParser.parse(content): PlanTask[]`; `hashString(value: string): string` from `src/core/v2/hash.ts`.

**Produces:** `buildCanonicalSnapshot(raw: string, tasks: readonly PlanTask[]): CanonicalPlanSnapshot`; `computePlanFingerprint(raw: string, tasks: readonly PlanTask[]): PlanFingerprint`; `migrateJusticeGeneratedErrorAnnotations(raw: string, observations: readonly PersistedLogRecord[]): MigrationResult`.

- [ ] **Step 1: Write the failing semantic-boundary tests**

```ts
it("normalizes only checkbox state in parsed task sections", () => {
  expect(computePlanFingerprint(taskUnchecked, parser.parse(taskUnchecked))).toEqual(
    computePlanFingerprint(taskChecked, parser.parse(taskUnchecked)),
  );
});

it("treats a global checkbox and a fenced checkbox as semantic", () => {
  expect(computePlanFingerprint(globalUnchecked, parser.parse(globalUnchecked))).not.toEqual(
    computePlanFingerprint(globalChecked, parser.parse(globalUnchecked)),
  );
  expect(computePlanFingerprint(fencedUnchecked, parser.parse(fencedUnchecked))).not.toEqual(
    computePlanFingerprint(fencedChecked, parser.parse(fencedUnchecked)),
  );
});

it("changes for task body edits and not for EOL-only edits", () => {
  expect(computePlanFingerprint(taskBodyA, parser.parse(taskBodyA))).not.toEqual(
    computePlanFingerprint(taskBodyB, parser.parse(taskBodyA)),
  );
  expect(computePlanFingerprint(taskBodyA, parser.parse(taskBodyA))).toEqual(
    computePlanFingerprint(taskBodyA.replace(/\n/g, "\r\n"), parser.parse(taskBodyA)),
  );
});
```

Add one test whose `error_annotation` observation identifies the exact legacy annotation line and expects migration to remove it. Add one manual annotation test and one unknown-provenance annotation test that expect the fingerprint to change.

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-fingerprint.test.ts tests/core/plan-parser.test.ts`

Expected: FAIL because canonical snapshot generation is absent.

- [ ] **Step 3: Implement task-section-only canonicalization**

Traverse normalized lines with the same task-heading rule as `PlanParser`. Enter a task section only at `TASK_HEADING_REGEX`; leave it at the next task heading; maintain a fenced-code state. Replace checkbox state only when `inTask === true` and `inFence === false`. Construct each `CanonicalTaskSnapshot` from that task section and construct `globalBodyDigest` from every non-task line without checkbox rewriting.

```ts
export function computePlanFingerprint(raw: string, tasks: readonly PlanTask[]): PlanFingerprint {
  return { algorithm: "sha256", value: hashString(canonicalize(raw, tasks)).replace("sha256:", "") };
}
```

`migrateJusticeGeneratedErrorAnnotations` must remove only a line whose exact normalized content is referenced by a persisted Justice `error_annotation` observation. It must retain every non-provenance-backed line.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-fingerprint.test.ts tests/core/plan-parser.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/plan-fingerprint.ts tests/core/plan-fingerprint.test.ts tests/core/plan-parser.test.ts
git commit -m "feat: semantic plan fingerprintとcanonical snapshotを追加"
```

### Task 2.2: Persist and hydrate the single authorization record

**Requirement:** JUS-P0-02, INV-03, INV-04, INV-12, Design §4.2, §4.4, §5.2.

**Files:**
- Create: `src/core/plan-authorization.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Test: `tests/core/plan-authorization.test.ts`
- Test: `tests/hooks/plan-bridge-authorization.test.ts`

**Consumes:** `AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>`; `CanonicalPlanSnapshot`; `PlanFingerprint`.

**Produces:** `ApprovedPlanBinding` containing `canonicalSnapshot`; `AuthorizationStore.approve(input): Promise<ApprovedPlanBinding | null>`; `AuthorizationStore.release(authorizationId, at): Promise<boolean>`; `AuthorizationStore.hydrate(): Promise<readonly ApprovedPlanBinding[]>`.

- [ ] **Step 1: Write the failing persistence and hydration tests**

```ts
it("stores the canonical snapshot in the same authorization record", async () => {
  const binding = await store.approve(input);
  expect(binding?.canonicalSnapshot.documentDigest).toBe(snapshot.documentDigest);
  expect(JSON.parse(files.get(".justice/authorizations.json") ?? "[]")[0].canonicalSnapshot).toEqual(snapshot);
});

it("hydrates an active binding and rejects a changed fingerprint", async () => {
  await store.approve(input);
  expect((await store.hydrate())[0]?.status).toBe("active");
  expect(isBindingActiveFor(binding!, "s1", "docs/p.md", changedFingerprint)).toBe(false);
});

it("never resurrects invalidated or released bindings", async () => {
  const binding = await store.approve(input);
  await store.release(binding!.authorizationId, "2026-09-05T00:00:00.000Z");
  expect(await store.approve(Object.assign({}, input, { authorizationId: binding!.authorizationId }))).toBeNull();
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-authorization.test.ts tests/hooks/plan-bridge-authorization.test.ts`

Expected: FAIL because authorization persistence and hydration do not exist.

- [ ] **Step 3: Implement the authorization store**

Use exactly `.justice/authorizations.json` and `.justice/authorizations.conflict.json` as the `AtomicPersistence` paths. Store only `ReadonlyArray<ApprovedPlanBinding>`. On approval, atomically invalidate an existing active binding for the same session with reason `plan_superseded`, generate a fresh authorization ID, and persist the new binding containing the computed snapshot. On a persistence failure, return `null` and leave enrichment unauthorized. On plugin initialization, hydrate active bindings and restore their `planPath` into `PlanBridge`; if the file cannot be read, no binding is active.

```ts
export type ApprovedPlanBinding = {
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly canonicalSnapshot: CanonicalPlanSnapshot;
  readonly fingerprintSchema: "justice-plan-v1";
  readonly status: "active" | "invalidated" | "released";
  readonly approvedAt: string;
  readonly invalidatedAt?: string;
  readonly releasedAt?: string;
};
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-authorization.test.ts tests/hooks/plan-bridge-authorization.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/plan-authorization.ts src/core/justice-plugin.ts src/hooks/plan-bridge.ts tests/core/plan-authorization.test.ts tests/hooks/plan-bridge-authorization.test.ts
git commit -m "feat: plan authorizationをdurable bindingへ置換"
```

### Task 2.3: Parse and execute explicit authorization cancellation

**Requirement:** JUS-P0-02, Design §5.2.

**Files:**
- Modify: `src/core/implement-command.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Test: `tests/core/implement-command.test.ts`
- Test: `tests/runtime/opencode-adapter.test.ts`
- Test: `tests/hooks/plan-bridge-authorization.test.ts`

**Consumes:** `parseJusticeImplementCommandArguments(argumentsString)`; `AuthorizationStore.release(authorizationId, at)`.

**Produces:** `ImplementationArmRequest` union with `{ readonly source: "command"; readonly action: "approve"; readonly planPath: string; readonly approved: boolean }` and `{ readonly source: "command"; readonly action: "cancel"; readonly planPath: string }`.

- [ ] **Step 1: Write the failing cancellation tests**

```ts
it("parses cancel with a safe plan path", () => {
  expect(parseJusticeImplementCommandArguments("--plan docs/p.md --cancel")).toEqual({
    source: "command", action: "cancel", planPath: "docs/p.md",
  });
});

it("releases then rejects subsequent task authorization", async () => {
  await bridge.handleImplementationArm("s1", approveRequest);
  await bridge.handleImplementationArm("s1", cancelRequest);
  expect((await bridge.handlePreToolUse(taskEvent)).injectedContext).toContain("IMPLEMENTATION UNAUTHORIZED");
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/implement-command.test.ts tests/runtime/opencode-adapter.test.ts tests/hooks/plan-bridge-authorization.test.ts`

Expected: FAIL because `--cancel` is rejected.

- [ ] **Step 3: Implement cancellation**

Accept exactly one of `--approved` and `--cancel`; reject both flags, duplicate flags, missing `--plan`, and unsafe paths. In `PlanBridge.handleImplementationArm`, resolve the active binding for the session and path, persist `active -> released`, clear the active plan cache only after durable success, and make later `handlePreToolUse` return the existing unauthorized advisory.

```ts
if (cancel) return { source: "command", action: "cancel", planPath };
return { source: "command", action: "approve", planPath, approved };
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/implement-command.test.ts tests/runtime/opencode-adapter.test.ts tests/hooks/plan-bridge-authorization.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/implement-command.ts src/runtime/opencode-adapter.ts src/hooks/plan-bridge.ts tests/core/implement-command.test.ts tests/runtime/opencode-adapter.test.ts tests/hooks/plan-bridge-authorization.test.ts
git commit -m "feat: plan authorizationのcancelを追加"
```

---

## Phase 3a: Lifecycle and Final Gate — JUS-P0-04

### Task 3.1: Make lifecycle replay-safe

**Requirement:** JUS-P0-04, INV-06, INV-08, INV-09, INV-14.

**Files:**
- Create: `src/core/task-lifecycle.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Test: `tests/core/task-lifecycle.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`

**Consumes:** `PersistedLogRecord`; `TaskExecutionRef`; `FinalizationAttemptId`.

**Produces:** `TransitionOutcome = { readonly kind: "applied" | "duplicate" | "invalid"; readonly state: TaskProgressState | PlanFinalizationState; readonly advisory?: string }`; `applyTaskTransition`; `applyPlanTransition`.

- [ ] **Step 1: Write the failing replay tests**

```ts
it("keeps state for duplicate and illegal transitions", () => {
  expect(applyTaskTransition("accepted", acceptedToPendingEvent)).toEqual({
    kind: "invalid", state: "accepted", advisory: "accepted -> pending is not allowed",
  });
  expect(applyTaskTransition("in_progress", duplicateStartEvent)).toEqual({ kind: "duplicate", state: "in_progress" });
});

it("projects an invalid record without aborting later records", () => {
  expect(project([invalidRecord, validRecord], "2026-09-05T00:00:00.000Z").tasks.get("task-1")?.status).toBe("open");
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts`

Expected: FAIL because lifecycle projection is absent and invalid transitions throw.

- [ ] **Step 3: Implement non-throwing transition outcomes**

Encode every lifecycle record in `observation-model.ts` with its task execution reference or finalization identity. Make duplicate identity leave state unchanged. Make illegal transitions leave state unchanged and emit an advisory record in the projection result. Do not throw from the projector for either case. Derive `all_tasks_accepted` from `ApprovedPlanBinding.canonicalSnapshot.tasks.map(task => task.taskId)`.

```ts
if (event.identity === state.lastTransitionIdentity) return { kind: "duplicate", state: state.value };
if (!VALID_TASK_TRANSITIONS.get(state.value)?.has(event.to)) {
  return { kind: "invalid", state: state.value, advisory: `${state.value} -> ${event.to} is not allowed` };
}
return { kind: "applied", state: event.to };
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/task-lifecycle.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts
git commit -m "feat: lifecycle replayをidempotentに処理"
```

### Task 3.2: Add task and plan-scoped Gate evaluation

**Requirement:** JUS-P0-04, INV-08, INV-09, INV-14.

**Files:**
- Modify: `src/core/v2/gate-definition.ts`
- Modify: `src/core/v2/gate-context.ts`
- Modify: `src/core/v2/rule-evaluation-engine.ts`
- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/core/v2/rule-evaluation-engine.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`

**Consumes:** `GateScope = "task" | "plan"`; `GateTrigger`; current projected lifecycle state.

**Produces:** `GateDecision = TaskGateDecision | PlanGateDecision`; `evaluate(gates, evidence, context)` returns a decision containing either `taskExecutionRef` or `authorizationId`, `planPath`, `finalizationAttemptId`, and `finalReviewRound`.

- [ ] **Step 1: Write the failing Final Gate tests**

```ts
it("selects a plan gate only for final_review_complete", () => {
  expect(evaluate([planGate], [], finalReviewContext).gateType).toBe("plan");
  expect(evaluate([planGate], [], Object.assign({}, finalReviewContext, { trigger: "tool_observed" })).verdict).toBe("SKIP");
});

it("includes the current finalization identity in a plan decision", () => {
  expect(evaluate([planGate], [], finalReviewContext)).toMatchObject({
    gateType: "plan", authorizationId: "a1", planPath: "docs/p.md", finalizationAttemptId: "f2", finalReviewRound: 2,
  });
});

it("maps Final Gate verdicts without accepting stale evidence", () => {
  expect(decidePlanCompletion({ gate: passForCurrentAttempt })).toBe("complete");
  expect(decidePlanCompletion({ gate: warnForCurrentAttempt })).toBe("final_rework_required");
  expect(decidePlanCompletion({ gate: undefined })).toBe("final_gate_pending");
  expect(decidePlanCompletion({ gate: passForOldAttempt })).toBe("final_gate_pending");
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/v2/rule-evaluation-engine.test.ts tests/hooks/observation-handler-gate.test.ts`

Expected: FAIL because plan gates are skipped and task gate decisions are fixed.

- [ ] **Step 3: Implement scoped Gate selection**

Define `GateRule.gateType` as `"task" | "plan"`. Define task triggers as `task_complete | tool_observed` and the plan trigger as `final_review_complete`. Evaluate task gates only in `gate_pending`; evaluate plan gates only in `final_gate_pending`. Append a PlanGateDecision only for the current finalization attempt. Map PASS to `complete`, WARN and FAIL to `final_rework_required`, and errors, SKIP, or insufficient evidence to `final_gate_pending`.

```ts
const activeGates = gates.filter((gate) => gate.enabled && gate.gateType === ctx.scope && gate.trigger.on === ctx.trigger);
if (ctx.scope === "plan") {
  return { gateType: "plan", authorizationId: ctx.authorizationId, planPath: ctx.planPath,
    finalizationAttemptId: ctx.finalizationAttemptId, finalReviewRound: ctx.finalReviewRound, verdict, ruleResults };
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/v2/rule-evaluation-engine.test.ts tests/hooks/observation-handler-gate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/v2/gate-definition.ts src/core/v2/gate-context.ts src/core/v2/rule-evaluation-engine.ts src/hooks/observation-handler.ts tests/core/v2/rule-evaluation-engine.test.ts tests/hooks/observation-handler-gate.test.ts
git commit -m "feat: Final Gateをplan scopeで評価"
```

---

## Phase 3b: Child Correlation and Durable Review Dispatch — JUS-P0-04

### Task 3.3: Prove the child-session correlation boundary

**Requirement:** JUS-P0-04, INV-15, Design §4.9.

**Files:**
- Create: `spikes/child-session-correlation/verify.ts`
- Create: `spikes/child-session-correlation/README.md`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`

**Consumes:** OpenCode `task()` PreToolUse and PostToolUse event payloads; child-session message and tool observations emitted by the installed runtime.

**Produces:** A committed spike report containing the observed event names, parent `callId`, child `sessionId`, and evidence for both `sp-review` and `sp-final-review`; a test fixture proving the adapter converts that relation into a `DelegatedExecutionBinding` input.

- [ ] **Step 1: Write the failing adapter fixtures**

```ts
it.each(["sp-review", "sp-final-review"] as const)("captures child session for %s", async (category) => {
  const events = fixtureWithParentTaskAndChildSession(category, "parent-call", "child-session");
  await adapter.replay(events);
  expect(adapter.getDelegatedExecutionInput("parent-call")).toMatchObject({
    parentCallId: "parent-call", childSessionId: "child-session",
  });
});
```

- [ ] **Step 2: Run the fixture and runtime spike**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts`

Expected: FAIL because the adapter has no child-session relation.

Run: `devcontainer exec --workspace-folder . bun run tsx spikes/child-session-correlation/verify.ts`

Expected: the report contains one task-review trace and one final-review trace, each with a non-empty parent call ID and child session ID.

- [ ] **Step 3: Apply the exit condition**

If either trace lacks a runtime-provided child session ID correlated to its parent call ID, record the raw event shape in `spikes/child-session-correlation/README.md`, mark Phase 3 as BLOCKED, and stop before Task 3.4. Do not substitute artifact-path, category, prompt, or worker self-report for child-session evidence.

- [ ] **Step 4: Commit after approval**

```bash
git add spikes/child-session-correlation/verify.ts spikes/child-session-correlation/README.md tests/runtime/opencode-adapter-v2.test.ts
git commit -m "test: child session correlation runtime境界を検証"
```

### Task 3.4: Persist review dispatch, binding, and completion staging

**Requirement:** JUS-P0-04, INV-11, INV-15, INV-16, INV-17, INV-18, Design §4.8 through §4.10.

**Files:**
- Create: `src/core/review-dispatch-state.ts`
- Create: `src/core/review-artifact-reservation.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Test: `tests/core/review-dispatch-state.test.ts`
- Test: `tests/core/review-artifact-reservation.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`

**Consumes:** `ReviewCorrelation`; `ReviewArtifactV1`; `DelegatedExecutionBinding`; `ReviewArtifactReservation`.

**Produces:** durable records for `null -> pending`, `pending -> claimed`, `review_completion_staged`, `review_artifact_consumed`, `review_observed`, and `claimed -> terminal`; `projectReviewDispatchSlots(records)`; `projectDelegatedExecutionBindings(records)`.

- [ ] **Step 1: Write the failing protocol and recovery tests**

```ts
it.each(["pending", "claimed_without_staging", "claimed_with_staging", "terminal"] as const)(
  "replays %s without unsafe redispatch", (state) => {
    expect(projectReviewDispatchSlots(recordsFor(state))).toMatchSnapshot();
  },
);

it("does not modify current state for stale PostToolUse", () => {
  for (const stale of [oldCallId, differentRound, differentArtifactId, differentChildSession]) {
    expect(acceptPostToolUse(currentClaim, stale)).toEqual({ kind: "stale" });
  }
});

it("canonicalizes mandatory reviews to synchronous execution", () => {
  expect(normalizeTaskToolInput({ category: "sp-review", run_in_background: true }).runInBackground).toBe(false);
  expect(normalizeTaskToolInput({ category: "sp-final-review", run_in_background: true }).runInBackground).toBe(false);
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts`

Expected: FAIL because no durable review protocol exists.

- [ ] **Step 3: Implement durable records and replay rules**

Create one pending slot per parent session. Claim only one matching pending slot and write the claimed transition, `TaskCallBinding`, `ReviewArtifactReservation`, and `DelegatedExecutionBinding` in one durable commit. Generate a UUID artifact ID and a validated `.justice/reviews/<artifactId>.json` path. A terminal slot is immutable. Recover pending by reissuing the same directive; recover claimed without staging by waiting for matching PostToolUse; recover claimed with staging by terminalizing only with the staged call ID, correlation, artifact ID, digest, and observed execution; recover terminal as a tombstone.

```ts
export type DelegatedExecutionBinding = {
  readonly parentSessionId: string;
  readonly parentCallId: string;
  readonly childSessionId: string;
  readonly scope: ExecutionScope;
};

export function canClaim(slots: readonly ReviewDispatchSlot[], input: ClaimInput): boolean {
  return slots.filter((slot) => slot.state === "pending" && slot.key.parentSessionId === input.parentSessionId && slot.expectedCategory === input.category).length === 1;
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-dispatch-state.ts src/core/review-artifact-reservation.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts
git commit -m "feat: durable review dispatchとchild bindingを追加"
```

---

## Phase 3c: Transactional PostToolUse — JUS-P0-04

### Task 3.5: Consume a matching review artifact exactly once

**Requirement:** JUS-P0-04, INV-13, INV-15 through INV-18, Design §4.8.1, §4.8.2, §4.10.

**Files:**
- Create: `src/core/review-artifact.ts`
- Modify: `src/core/session-state-provider.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/review-artifact.test.ts`
- Test: `tests/core/session-state-provider.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`

**Consumes:** projected claimed dispatch slot; `TaskCallBinding`; `DelegatedExecutionBinding`; reserved artifact path.

**Produces:** `consumeReviewCompletion(input): Promise<ReviewCompletionOutcome>` where success is possible only after a matching child observation and durable terminalization.

- [ ] **Step 1: Write the failing ordering and anti-replay tests**

```ts
it("performs the review completion protocol in durable order", async () => {
  await consumeReviewCompletion(matchingInput);
  expect(trace).toEqual([
    "verify-claimed-binding", "verify-child-binding", "read-artifact-once", "validate-schema",
    "compute-digest", "commit-staging", "commit-consumption-review-terminal", "apply-acceptance", "cleanup-artifact",
  ]);
});

it("retries terminalization from staging without rereading the artifact", async () => {
  await consumeReviewCompletion(inputWithTerminalCommitFailure);
  await recoverReviewCompletion(stagedRecord);
  expect(readArtifact).toHaveBeenCalledTimes(1);
});

it("does not dispatch task PostToolUse side effects through Promise.all", async () => {
  expect(await runTaskPostToolUseSequentially(event)).toEqual(PROCEED);
  expect(trace).toEqual(["observation", "lifecycle", "directive", "acceptance", "progress"]);
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/hooks/observation-handler-transactional.test.ts tests/runtime/opencode-adapter-v2.test.ts`

Expected: FAIL because matching review completion is not transactional.

- [ ] **Step 3: Implement the fixed protocol**

Implement this exact sequence: validate claimed parent binding; validate child-session binding; read the usable artifact once; strictly parse `ReviewWorkerResultV1`; calculate digest; commit `ReviewCompletionStagingRecord`; commit `review_artifact_consumed`, `review_observed`, assembled `ReviewArtifactV1`, and terminal transition atomically; only then evaluate acceptance; archive or delete the artifact idempotently. Any mismatch in parent session, parent call ID, purpose, correlation, artifact ID, review round, or child session returns a stale advisory without artifact I/O or state mutation.

```ts
const staging = await commitStaging(await validateAndReadMatchingArtifact(input));
const terminal = await commitConsumedReviewAndTerminal(staging);
if (terminal.kind !== "committed") return { kind: "blocked" };
await cleanupArtifact(staging.artifactConsumption.artifactId);
return applyAcceptance(terminal.reviewArtifact);
```

Replace the `Promise.all` path for task PostToolUse in `JusticePlugin` with `runTaskPostToolUseSequentially`. Keep independent non-task handlers unchanged.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/hooks/observation-handler-transactional.test.ts tests/runtime/opencode-adapter-v2.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-artifact.ts src/core/session-state-provider.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/hooks/observation-handler-transactional.test.ts tests/runtime/opencode-adapter-v2.test.ts
git commit -m "feat: review artifact消費をtransactionalに処理"
```

### Task 3.6: Update plan progress only after accepted task decisions

**Requirement:** JUS-P0-04, INV-06, INV-08.

**Files:**
- Create: `src/core/progress-updater.ts`
- Modify: `src/hooks/task-feedback.ts`
- Test: `tests/core/progress-updater.test.ts`
- Test: `tests/hooks/task-feedback.test.ts`

**Consumes:** `TaskAcceptanceDecision`; `PlanParser.updateCheckbox(content, lineNumber, checked)`.

**Produces:** `updatePlanProgress(content: string, task: PlanTask, decision: TaskAcceptanceDecision): ProgressUpdateResult`.

- [ ] **Step 1: Write the failing progress tests**

```ts
it("does not update a checkbox for rework-required or blocked", () => {
  expect(updatePlanProgress(plan, task, reworkDecision)).toEqual({ content: plan, updated: false });
  expect(updatePlanProgress(plan, task, blockedDecision)).toEqual({ content: plan, updated: false });
});

it("updates only an accepted task", () => {
  expect(updatePlanProgress(plan, task, acceptedDecision).updated).toBe(true);
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/progress-updater.test.ts tests/hooks/task-feedback.test.ts`

Expected: FAIL because worker feedback writes progress directly.

- [ ] **Step 3: Implement accepted-only progress updates**

Return the input unchanged unless `decision.verdict === "accepted"` and its `taskExecutionRef.taskId` equals `task.id`. Remove direct `PlanParser.updateCheckbox()` calls from TaskFeedback success and failure paths. Invoke the updater after the durable acceptance decision only.

```ts
export function updatePlanProgress(content: string, task: PlanTask, decision: TaskAcceptanceDecision): ProgressUpdateResult {
  if (decision.verdict !== "accepted" || decision.taskExecutionRef.taskId !== task.id) return { content, updated: false };
  return { content: new PlanParser().updateCheckbox(content, task.steps.at(-1)!.lineNumber, true), updated: true };
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/progress-updater.test.ts tests/hooks/task-feedback.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/progress-updater.ts src/hooks/task-feedback.ts tests/core/progress-updater.test.ts tests/hooks/task-feedback.test.ts
git commit -m "feat: accepted decision後だけplan progressを更新"
```

---

## Phase 4: Controller Routing — JUS-P0-01

### Task 4.1: Preserve workflow identity in routing decisions

**Requirement:** JUS-P0-01, INV-01, Design §4.1.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/routing-decision.ts`
- Create: `src/core/controller-routing.ts`
- Test: `tests/core/routing-decision.test.ts`
- Test: `tests/core/controller-routing.test.ts`

**Consumes:** `WorkflowRouter.resolveController(workflow)`; `ControllerAgent`.

**Produces:** `ControllerRoutingDecision = { readonly kind: "controller"; readonly workflow: string; readonly controller: ControllerAgent; readonly reason: RoutingReason }`; `createControllerRoutingDecision(workflow, controller, reason)`.

- [ ] **Step 1: Write the failing workflow-identity tests**

```ts
it("retains workflow when two workflows select the same controller", () => {
  expect(createControllerRoutingDecision("brainstorming", "sisyphus", "workflow_rule").workflow).toBe("brainstorming");
  expect(createControllerRoutingDecision("writing-plans", "sisyphus", "workflow_rule").workflow).toBe("writing-plans");
});

it("reports applied, mismatch, and unapplied controller observations", () => {
  expect(evaluateControllerRoutingObservation(appliedInput).routingStatus).toBe("applied");
  expect(evaluateControllerRoutingObservation(mismatchInput).routingStatus).toBe("mismatch");
  expect(evaluateControllerRoutingObservation(unappliedInput).routingStatus).toBe("unapplied");
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/routing-decision.test.ts tests/core/controller-routing.test.ts`

Expected: FAIL because controller routing decisions discard workflow identity.

- [ ] **Step 3: Implement typed routing identity and observation evaluation**

Move only the controller union member in `RoutingDecision` to include `workflow`; preserve the union in `src/core/types.ts`. Change the factory signature and all callers. Implement `evaluateControllerRoutingObservation` in `src/core/controller-routing.ts`; only a matching `message.updated` observation can return `applied`, and `chat.params` alone returns `unapplied` with `actual_not_observed`.

```ts
export function createControllerRoutingDecision(
  workflow: string, controller: ControllerAgent, reason: RoutingReason,
): Extract<RoutingDecision, { readonly kind: "controller" }> {
  return { kind: "controller", workflow, controller, reason };
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/routing-decision.test.ts tests/core/controller-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/types.ts src/core/routing-decision.ts src/core/controller-routing.ts tests/core/routing-decision.test.ts tests/core/controller-routing.test.ts
git commit -m "feat: controller routingにworkflow identityを保持"
```

### Task 4.2: Persist controller routing observations and doctor diagnostics

**Requirement:** JUS-P0-01, Design §3.3 and §5.1.

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/doctor-categories.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`
- Test: `tests/runtime/doctor-cli.test.ts`

**Consumes:** `ControllerRoutingDecision`; `evaluateControllerRoutingObservation`; parsed command configuration.

**Produces:** durable `controller_routing_observed` observation carrying workflow, desired controller, actual controller, status, application method, and source; `checkPinnedCommandPresence(commandNames: readonly string[]): PinnedCommandPresenceResult`.

- [ ] **Step 1: Write the failing runtime and doctor tests**

```ts
it("persists mismatch when the observed controller differs", async () => {
  await adapter.handleMessageUpdated(messageUpdatedFor("sisyphus"));
  expect(await readRoutingObservation()).toMatchObject({ workflow: "subagent-driven-development", routingStatus: "mismatch" });
});

it("reports missing pinned command names", () => {
  expect(checkPinnedCommandPresence(["justice-start"])).toEqual({
    ok: false,
    missing: ["justice-implement-brainstorming", "justice-implement-writing-plans", "justice-implement-subagent-driven-development", "justice-implement-executing-plans"],
  });
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/runtime/doctor-cli.test.ts`

Expected: FAIL because routing observations and pinned-command diagnostics are absent.

- [ ] **Step 3: Implement observation and diagnostics**

Translate `chat.params` and finalized `message.updated` agent values through the existing adapter event path. Have ObservationHandler append the typed routing observation after evaluating the desired decision. Do not make a routing mismatch block execution. In `doctor-categories.ts`, require `justice-implement-brainstorming`, `justice-implement-writing-plans`, `justice-implement-subagent-driven-development`, and `justice-implement-executing-plans`; doctor reports each missing name and exits non-zero.

```ts
export function checkPinnedCommandPresence(commandNames: readonly string[]): PinnedCommandPresenceResult {
  const present = new Set(commandNames);
  const missing = REQUIRED_PINNED_COMMANDS.filter((name) => !present.has(name));
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/runtime/doctor-cli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/runtime/opencode-adapter.ts src/hooks/observation-handler.ts src/core/doctor-categories.ts src/runtime/doctor-cli.ts tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/runtime/doctor-cli.test.ts
git commit -m "feat: controller routing observationとdoctor診断を追加"
```

---

## Traceability and Definition of Done

| Requirement / Design Decision | Plan Task | Required tests |
|---|---|---|
| JUS-P0-01 controller workflow identity and runtime observation | 4.1, 4.2 | routing decision, applied, mismatch, unapplied, pinned command presence |
| JUS-P0-02 semantic fingerprint | 2.1 | task progress invariant, global mutation invalidates, fenced mutation invalidates, EOL invariant |
| JUS-P0-02 canonical snapshot | 2.1, 2.2 | snapshot persistence, hydration, all-tasks-accepted snapshot SSOT |
| JUS-P0-02 cancel and release | 2.3 | cancel, release, subsequent authorization rejection |
| JUS-P0-03 seven-to-seven category mapping | 1.1, 1.2 | every role, legacy downgrade rejection, doctor presence |
| JUS-P0-04 lifecycle replay | 3.1 | duplicate identity, invalid transition, replay continuation |
| JUS-P0-04 task Gate | 3.2 | current task attempt only |
| JUS-P0-04 Final Gate | 3.2 | current finalization attempt only, PASS complete, WARN/FAIL rework, insufficient blocked |
| JUS-P0-04 durable review dispatch | 3.4 | pending, claimed, terminal, four restart states |
| JUS-P0-04 child-session correlation | 3.3, 3.4 | runtime spike, task review correlation, final review correlation, durable binding |
| JUS-P0-04 anti-replay | 3.4, 3.5 | consume once, staging recovery, stale call ID, stale round, stale artifact, stale child session |
| JUS-P0-04 transactional PostToolUse | 3.5 | strict sequence, terminal-commit recovery, no parallel side effects |
| INV-01 through INV-18 | 1.1 through 4.2 | each invariant is covered by the rows above and the named tests |

Every task above implements one named design decision: Tasks 1.1-1.2 implement Design §5.3; Tasks 2.1-2.3 implement §4.2, §4.3, and §5.2; Tasks 3.1-3.6 implement §4.4 through §4.11 and §5.4 through §5.5; Tasks 4.1-4.2 implement §4.1 and §5.1. No task exists solely for future reuse.

Phase 3 is incomplete if Task 3.3 cannot demonstrate both mandatory review correlations. It is incomplete if synchronous mandatory review canonicalization, durable claim, staging, artifact consumption, stale-event rejection, task Gate, or Final Gate lacks a passing automated test. A known runtime limitation documents an observation only; it never waives a P0 completion criterion.

Before implementation handoff, inspect every implementation step for unresolved placeholders, ambiguous file paths, and unbound requirements. Then verify that each table row names at least one exact task and test file.
