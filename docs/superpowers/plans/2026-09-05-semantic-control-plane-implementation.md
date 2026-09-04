# Semantic Control Plane Implementation Plan

> **For agentic workers:** Execute this plan inline in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Justice v4.0.0 Semantic Control Plane for JUS-P0-01 through JUS-P0-04 with durable, attempt-scoped authorization, review, gate, and acceptance state.

**Architecture:** The append-only observation/decision log is the durable source for lifecycle, review dispatch, completion staging, artifact consumption, review observation, Gate, and Acceptance. `.justice/authorizations.json` is the sole authoritative-state exception: it stores only `ApprovedPlanBinding`, including its `CanonicalPlanSnapshot`; `.justice/authorizations.conflict.json` is an `AtomicPersistence` failure journal and never an authorization input. Runtime code remains fail-open; an unavailable or unverified acceptance precondition remains blocked.

**Tech Stack:** TypeScript, Bun, Vitest, Zod, `AtomicPersistence`, `ObservationLogStore`, `StateProjectionCache`, and injected mock file systems.

## Global Constraints

- Modify only files listed by the task being executed.
- `src/core/**` must not import `@opencode-ai/*`.
- Public state is immutable through `readonly`, `ReadonlyArray`, and `ReadonlyMap`.
- Ordinary unit tests use `tests/helpers/mock-file-system.ts`; only existing designated real-fs suites access disk.
- Persist lifecycle and review state only in the existing append-only observation/decision log.
- Persist authorization state only in `.justice/authorizations.json`; `ApprovedPlanBinding.canonicalSnapshot` is the sole durable canonical snapshot.
- Use `.justice/authorizations.conflict.json` only as `AtomicPersistence`'s non-authoritative failure journal; never hydrate it or use it for authorization, canonical snapshot, or active-plan restoration.
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
- Test: `tests/core/retry-policy-calculator.test.ts`

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

it.each(["sp-deep", "sp-architecture"] as const)("keeps %s at the existing zero retry modifier", (category) => {
  expect(new RetryPolicyCalculator().compute({ category, stepCount: 1 })).toMatchObject({
    categoryModifier: 0,
    maxRetries: RetryPolicyCalculator.BASE,
  });
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/routing-decision.test.ts tests/unit/core/omo-category-mapper.test.ts tests/core/retry-policy-calculator.test.ts`

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

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/routing-decision.test.ts tests/unit/core/omo-category-mapper.test.ts tests/core/retry-policy-calculator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/types.ts src/core/omo-category-mapper.ts src/core/routing-decision.ts src/core/category-classifier.ts tests/core/routing-decision.test.ts tests/unit/core/omo-category-mapper.test.ts tests/core/retry-policy-calculator.test.ts
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

**Consumes:** `PlanParser.parse(content): PlanTask[]`; `hashString(value: string): string` from `src/core/v2/hash.ts`; approval-time task IDs from `PlanParser.parse(raw).map((task) => task.id)`; validation-time task IDs from `binding.canonicalSnapshot.tasks.map((task) => task.taskId)`.

**Produces:** `buildCanonicalSnapshot(raw: string, approvedTaskIds: readonly string[]): CanonicalPlanSnapshot`; `computePlanFingerprint(raw: string, approvedTaskIds: readonly string[]): PlanFingerprint`; `migrateJusticeGeneratedErrorAnnotations(raw: string, observations: readonly PersistedLogRecord[]): MigrationResult`.

- [ ] **Step 1: Write the failing semantic-boundary tests**

<!-- markdownlint-disable MD013 -->

```ts
const taskUnchecked = "## Task 1: approved\n- [ ] execute\n";
const taskChecked = "## Task 1: approved\n- [x] execute\n";
const globalUnchecked = "- [ ] release checklist\n\n## Task 1: approved\n- [ ] execute\n";
const globalChecked = "- [x] release checklist\n\n## Task 1: approved\n- [ ] execute\n";
const unscopedUnchecked = "Notes\n- [ ] verify manually\n\n## Task 1: approved\n- [ ] execute\n";
const unscopedChecked = "Notes\n- [x] verify manually\n\n## Task 1: approved\n- [ ] execute\n";
const fencedUnchecked = "## Task 1: approved\n```text\n- [ ] example\n```\n- [ ] execute\n";
const fencedChecked = "## Task 1: approved\n```text\n- [x] example\n```\n- [ ] execute\n";
const unapprovedTaskUnchecked = "## Task 1: approved\n- [ ] execute\n\n## Task 2: added\n- [ ] added step\n";
const unapprovedTaskChecked = "## Task 1: approved\n- [ ] execute\n\n## Task 2: added\n- [x] added step\n";
const taskBodyA = "## Task 1: approved\n- [ ] execute\n";
const taskBodyB = "## Task 1: renamed\n- [ ] execute\n";

it("normalizes only checkbox state in parsed task sections", () => {
  expect(computePlanFingerprint(taskUnchecked, ["task-1"])).toEqual(
    computePlanFingerprint(taskChecked, ["task-1"]),
  );
});

it("treats global, unscoped, and fenced checkboxes as semantic", () => {
  expect(computePlanFingerprint(globalUnchecked, ["task-1"])).not.toEqual(
    computePlanFingerprint(globalChecked, ["task-1"]),
  );
  expect(computePlanFingerprint(unscopedUnchecked, ["task-1"])).not.toEqual(
    computePlanFingerprint(unscopedChecked, ["task-1"]),
  );
  expect(computePlanFingerprint(fencedUnchecked, ["task-1"])).not.toEqual(
    computePlanFingerprint(fencedChecked, ["task-1"]),
  );
});

it("changes for an unapproved task section, task body edits, and not for EOL-only edits", () => {
  expect(computePlanFingerprint(unapprovedTaskUnchecked, ["task-1"])).not.toEqual(
    computePlanFingerprint(unapprovedTaskChecked, ["task-1"]),
  );
  expect(computePlanFingerprint(taskBodyA, ["task-1"])).not.toEqual(
    computePlanFingerprint(taskBodyB, ["task-1"]),
  );
  expect(computePlanFingerprint(taskBodyA, ["task-1"])).toEqual(
    computePlanFingerprint(taskBodyA.replace(/\n/g, "\r\n"), ["task-1"]),
  );
});

it("treats duplicate approved task headings as semantic", () => {
  const original = "## Task 1: approved\n- [ ] execute\n";
  const duplicate = "## Task 1: approved\n- [ ] execute\n\n## Task 1: duplicate\n- [x] execute\n";

  expect(computePlanFingerprint(duplicate, ["task-1"])).not.toEqual(
    computePlanFingerprint(original, ["task-1"]),
  );
});
```

<!-- markdownlint-enable MD013 -->

Add one test whose `error_annotation` observation identifies the exact legacy annotation line and expects migration to remove it. Add one manual annotation test and one unknown-provenance annotation test that expect the fingerprint to change.

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-fingerprint.test.ts tests/core/plan-parser.test.ts`

Expected: FAIL because canonical snapshot generation is absent.

- [ ] **Step 3: Implement task-section-only canonicalization**

Traverse normalized lines with the same task-heading rule as `PlanParser`. Derive a heading
ID as `task-${taskNumber}` and compare it to `new Set(approvedTaskIds)`. Count each approved
heading ID while scanning; if an approved ID occurs other than exactly once, retain every
checkbox in that section and return a fingerprint that differs from the approved snapshot.
Enter a normalizable task section only when the heading ID is in that set exactly once; leave
it at the next heading; maintain a fenced-code state. Replace checkbox state only when
`inApprovedTask === true` and `inFence === false`. A heading not in the approved set, an
unscoped line, and a fenced line remain byte-semantic after EOL normalization. Construct each
`CanonicalTaskSnapshot` from an approved task section and construct `globalBodyDigest` from
every non-approved line without checkbox rewriting. Approval calls both functions with
`parser.parse(raw).map((task) => task.id)`; later validation calls them with
`binding.canonicalSnapshot.tasks.map((task) => task.taskId)`.

```ts
export function computePlanFingerprint(raw: string, approvedTaskIds: readonly string[]): PlanFingerprint {
  return { algorithm: "sha256", value: hashString(canonicalize(raw, approvedTaskIds)).replace("sha256:", "") };
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

**Consumes:** OpenCode `task()` PreToolUse and PostToolUse event payloads; child-session message and tool observations emitted by the installed runtime.

**Produces:** A committed spike report containing the exact runtime event/API, field paths, parent `callId`, child `sessionId`, and evidence for both `sp-review` and `sp-final-review`. This task does not add production adapter behavior or an adapter regression test.

- [ ] **Step 1: Implement a runtime-only correlation probe**

Create `verify.ts` as a Bun-native TypeScript executable. It must run one `sp-review` and one `sp-final-review` dispatch against the installed runtime, collect only the runtime hook/event/API payloads needed for correlation, and fail non-zero when either trace has no non-empty runtime-provided parent call ID or child session ID. It must not infer either identity from prompt text, category, artifact path, or worker self-report.

- [ ] **Step 2: Run the runtime spike**

Run: `devcontainer exec --workspace-folder . bun spikes/child-session-correlation/verify.ts`

Expected: the report contains one task-review trace and one final-review trace, each with a non-empty parent call ID and child session ID.

- [ ] **Step 3: Record the runtime contract and apply the exit condition**

Record the observed event/API name, exact parent-call field path, exact child-session field path, and the two redacted traces in `README.md`. If either trace lacks a runtime-provided child session ID correlated to its parent call ID, record the raw event shape, mark Phase 3 as BLOCKED, and stop before Task 3.4. Do not substitute artifact-path, category, prompt, or worker self-report for child-session evidence.

- [ ] **Step 4: Commit after approval**

```bash
git add spikes/child-session-correlation/verify.ts spikes/child-session-correlation/README.md
git commit -m "test: child session correlation runtime境界を検証"
```

### Task 3.4: Persist review dispatch and the PreToolUse claim protocol

**Requirement:** JUS-P0-04, INV-11, INV-16, INV-17, Design §4.8, §4.8.2, and §4.10.

**Files:**
- Create: `src/core/review-dispatch-state.ts`
- Create: `src/core/review-artifact-reservation.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/review-dispatch-state.test.ts`
- Test: `tests/core/review-artifact-reservation.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

**Consumes:** current `TaskExecutionRef` or finalization identity; `ReviewCorrelation`; review `TaskCallPurpose`; durable log append.

**Produces:** `ReviewRequiredDirective`; durable `null -> pending` and `pending -> claimed` records; `TaskCallBinding`; `ReviewArtifactReservation`; `projectReviewDispatchSlots(records)`; and an in-memory cache reconstructed only from the durable projection.

- [ ] **Step 1: Write the failing dispatch, claim, and recovery tests**

```ts
it("commits pending before injecting exactly one review directive", async () => {
  await requestMandatoryReview(taskExecutionRef);
  expect(trace).toEqual(["commit-pending", "inject-review-directive"]);
});

it.each(["pending", "claimed_without_staging", "claimed_with_staging", "terminal"] as const)(
  "replays %s without unsafe redispatch", (state) => {
    expect(projectReviewDispatchSlots(recordsFor(state))).toMatchSnapshot();
  },
);

it("claims only one matching pending slot without creating a child binding", async () => {
  const result = await claimReviewDispatch(currentPendingSlot, reviewPreToolUse);
  expect(result).toMatchObject({ kind: "claimed", taskCallBinding: expect.any(Object) });
  expect(result).not.toHaveProperty("delegatedExecutionBinding");
});

it("rejects zero, multiple, and category-mismatched pending slots without a binding or reservation", async () => {
  await expect(claimReviewDispatch(invalidSlots, reviewPreToolUse)).resolves.toEqual({ kind: "blocked" });
  expect(writeDurableRecord).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "delegated_execution_binding" }));
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL because durable dispatch, trusted call binding, and review directives do not exist.

- [ ] **Step 3: Implement durable dispatch and claim**

Persist one `pending` slot per parent session before injecting its `ReviewRequiredDirective`. In the review `task()` PreToolUse path, claim only one matching pending slot and write `pending -> claimed`, `TaskCallBinding`, and `ReviewArtifactReservation` in one durable commit. Generate a UUID artifact ID and validated `.justice/reviews/<artifactId>.json` path. Do not create `DelegatedExecutionBinding` here: a child session has not yet been authoritatively observed. Canonicalize `sp-review` and `sp-final-review` to `run_in_background = false` before the claim. A terminal slot is immutable; pending recovery reissues the same directive, while recovered claimed slots wait for a matching PostToolUse.

```ts
export function canClaim(slots: readonly ReviewDispatchSlot[], input: ClaimInput): boolean {
  return slots.filter(
    (slot) =>
      slot.state === "pending" &&
      slot.key.parentSessionId === input.parentSessionId &&
      slot.expectedCategory === input.category,
  ).length === 1;
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-dispatch-state.ts src/core/review-artifact-reservation.ts src/core/types.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts
git commit -m "feat: durable review dispatchとclaimを追加"
```

---

## Phase 3c: Transactional PostToolUse — JUS-P0-04

### Task 3.5: Convert observed child relations into durable execution bindings

**Requirement:** JUS-P0-04, INV-14, INV-15, INV-17, INV-18, Design §4.8.1, §4.8.2, and §4.9.

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/core/types.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`

**Consumes:** the exact runtime event/API and field paths recorded by Task 3.3; projected claimed dispatch slot; `TaskCallBinding`; trusted `ReviewCorrelation`.

**Produces:** `DelegatedExecutionRelationObserved` from the adapter and a durable `DelegatedExecutionBinding` whose `ExecutionScope` is derived from the claimed slot, never from worker input.

- [ ] **Step 1: Write failing adapter and durable-binding tests from the spike fixtures**

```ts
it.each(["sp-review", "sp-final-review"] as const)("captures and persists %s child relation", async (category) => {
  await adapter.replay(capturedRuntimeEvents(category, "parent-call", "child-session"));
  expect(await projectedBinding("parent-call")).toMatchObject({
    parentCallId: "parent-call", childSessionId: "child-session",
  });
});

it("derives task and finalization scopes from the claimed correlation", async () => {
  expect(await bindObservedChild(taskClaim, childRelation)).toMatchObject({ scope: { kind: "task" } });
  expect(await bindObservedChild(finalClaim, childRelation)).toMatchObject({ scope: { kind: "finalization" } });
});

it.each([unknownParentCall, staleChildRelation])("rejects an untrusted child relation", async (relation) => {
  await expect(bindObservedChild(currentClaim, relation)).resolves.toEqual({ kind: "stale" });
});

it("rebuilds the durable binding after restart", () => {
  expect(projectDelegatedExecutionBindings(bindingRecords)).toEqual(expectedBindings);
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/v2/state-projection.test.ts`

Expected: FAIL because the adapter does not expose the spike-proven relation and no durable child binding exists.

- [ ] **Step 3: Implement runtime relation extraction and durable binding append**

Use only the event/API and field paths recorded by the successful Task 3.3 spike. The adapter converts that runtime relation into `DelegatedExecutionRelationObserved` and forwards it through the existing `JusticePlugin.handleEvent()` boundary. The observation handler accepts it only when `parentCallId` matches a current claimed slot, derives task or finalization `ExecutionScope` from that slot's trusted correlation, and appends `DelegatedExecutionBinding` durably. Reject unknown parent calls and stale child relations without state mutation. A matching review PostToolUse remains non-authoritative until this binding is present in the durable projection.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/v2/state-projection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/runtime/opencode-adapter.ts src/core/types.ts src/hooks/observation-handler.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/v2/state-projection.test.ts
git commit -m "feat: review child bindingをdurableに記録"
```

### Task 3.6: Consume a matching review artifact exactly once

**Requirement:** JUS-P0-04, INV-06, INV-13, INV-15 through INV-18, Design §4.8.1, §4.8.2, §4.10, and §4.11.

**Files:**
- Create: `src/core/review-artifact.ts`
- Create: `src/core/acceptance-decision.ts`
- Modify: `src/core/session-state-provider.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/review-artifact.test.ts`
- Test: `tests/core/acceptance-decision.test.ts`
- Test: `tests/core/session-state-provider.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`

**Consumes:** projected claimed dispatch slot; durable `TaskCallBinding`; durable `DelegatedExecutionBinding`; reserved artifact path; current Gate decision.

**Produces:** `consumeReviewCompletion(input): Promise<ReviewCompletionOutcome>` and attempt-scoped `TaskAcceptanceDecision | PlanAcceptanceDecision`; success is possible only after matching child observation and durable terminalization.

- [ ] **Step 1: Write the failing ordering, decision, and anti-replay tests**

```ts
it("performs the review completion protocol in durable order", async () => {
  await consumeReviewCompletion(matchingInput);
  expect(trace).toEqual([
    "verify-claimed-binding", "verify-child-binding", "read-artifact-once", "validate-schema",
    "compute-digest", "commit-staging", "commit-consumption-review-terminal", "apply-acceptance", "cleanup-artifact",
  ]);
});

it("does not accept a review without a durable child binding", async () => {
  await expect(consumeReviewCompletion(inputWithoutBinding)).resolves.toEqual({ kind: "blocked" });
  expect(readArtifact).not.toHaveBeenCalled();
});

it("retries terminalization from staging without rereading the artifact", async () => {
  await consumeReviewCompletion(inputWithTerminalCommitFailure);
  await recoverReviewCompletion(stagedRecord);
  expect(readArtifact).toHaveBeenCalledTimes(1);
});

it("creates an acceptance decision only from the current attempt's Gate verdict", () => {
  expect(decideTaskAcceptance(currentPass)).toMatchObject({ verdict: "accepted" });
  expect(decideTaskAcceptance(stalePass)).toMatchObject({ verdict: "blocked" });
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/acceptance-decision.test.ts tests/core/session-state-provider.test.ts tests/hooks/observation-handler-transactional.test.ts`

Expected: FAIL because matching review completion and attempt-scoped acceptance decisions are not transactional.

- [ ] **Step 3: Implement the fixed protocol**

Implement this exact sequence: validate claimed parent binding; validate durable child-session binding; read the usable artifact once; strictly parse `ReviewWorkerResultV1`; calculate digest; commit `ReviewCompletionStagingRecord`; commit `review_artifact_consumed`, `review_observed`, assembled `ReviewArtifactV1`, and terminal transition atomically; evaluate and durably record the current attempt's acceptance decision; then archive or delete the artifact idempotently. Any mismatch in parent session, parent call ID, purpose, correlation, artifact ID, review round, child session, task attempt, or finalization attempt returns a stale advisory without artifact I/O or state mutation.

```ts
const staging = await commitStaging(await validateAndReadMatchingArtifact(input));
const terminal = await commitConsumedReviewAndTerminal(staging);
if (terminal.kind !== "committed") return { kind: "blocked" };
const decision = await applyAcceptance(terminal.reviewArtifact);
await cleanupArtifact(staging.artifactConsumption.artifactId);
return decision;
```

Replace the `Promise.all` path for task PostToolUse in `JusticePlugin` with `runTaskPostToolUseSequentially`. Keep independent non-task handlers unchanged.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/acceptance-decision.test.ts tests/core/session-state-provider.test.ts tests/hooks/observation-handler-transactional.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-artifact.ts src/core/acceptance-decision.ts src/core/session-state-provider.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/core/review-artifact.test.ts tests/core/acceptance-decision.test.ts tests/core/session-state-provider.test.ts tests/hooks/observation-handler-transactional.test.ts
git commit -m "feat: review artifact消費とacceptanceをtransactionalに処理"
```

### Task 3.7: Update plan progress only after accepted task decisions

**Requirement:** JUS-P0-04, INV-06, INV-08.

**Files:**
- Create: `src/core/progress-updater.ts`
- Modify: `src/hooks/task-feedback.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/progress-updater.test.ts`
- Test: `tests/hooks/task-feedback.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

**Consumes:** durable accepted `TaskAcceptanceDecision`; `PlanParser.updateCheckbox(content, lineNumber, checked)`.

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

it("does not update progress until the acceptance decision is durably recorded", async () => {
  await handleTaskPostToolUse(taskEvent);
  expect(trace).toEqual(["record-acceptance", "update-progress"]);
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/progress-updater.test.ts tests/hooks/task-feedback.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL because worker feedback writes progress directly.

- [ ] **Step 3: Implement accepted-only progress updates**

Return the input unchanged unless `decision.verdict === "accepted"` and its `taskExecutionRef.taskId` equals `task.id`. Remove direct `PlanParser.updateCheckbox()` calls from TaskFeedback success and failure paths. `JusticePlugin` invokes the updater only after Task 3.6 has durably recorded the accepted decision; `TaskFeedbackHandler` must not infer acceptance from worker success.

```ts
export function updatePlanProgress(content: string, task: PlanTask, decision: TaskAcceptanceDecision): ProgressUpdateResult {
  if (decision.verdict !== "accepted" || decision.taskExecutionRef.taskId !== task.id) return { content, updated: false };
  return { content: new PlanParser().updateCheckbox(content, task.steps.at(-1)!.lineNumber, true), updated: true };
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/progress-updater.test.ts tests/hooks/task-feedback.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/progress-updater.ts src/hooks/task-feedback.ts src/core/justice-plugin.ts tests/core/progress-updater.test.ts tests/hooks/task-feedback.test.ts tests/core/justice-plugin-routing.test.ts
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

**Requirement:** JUS-P0-01, Design §3.3, §3.4, §5.1, and §7.3.

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/doctor-categories.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Modify: `README.md`
- Modify: `SPEC.md`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`
- Test: `tests/runtime/doctor-cli.test.ts`

**Consumes:** `ControllerRoutingDecision`; `evaluateControllerRoutingObservation`; parsed command configuration.

**Produces:** durable `controller_routing_observed` observation carrying workflow, desired controller, actual controller, status, application method, and source; `checkPinnedCommandPresence(commandNames: readonly string[]): PinnedCommandPresenceResult`; `justice doctor` output containing the complete missing pinned-command templates; README and release documentation describing the required v4.0.0 configuration and its manual-install boundary.

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

it("renders every missing pinned command as an agent-pinned OpenCode configuration", () => {
  expect(formatPinnedCommandTemplates(["justice-implement-brainstorming"])).toContain(
    '"agent": "sisyphus"',
  );
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/runtime/doctor-cli.test.ts`

Expected: FAIL because routing observations and pinned-command diagnostics are absent.

- [ ] **Step 3: Implement observation and diagnostics**

Translate `chat.params` and finalized `message.updated` agent values through the existing adapter event path. Have ObservationHandler append the typed routing observation after evaluating the desired decision. Do not make a routing mismatch block execution. In `doctor-categories.ts`, require `justice-implement-brainstorming`, `justice-implement-writing-plans`, `justice-implement-subagent-driven-development`, and `justice-implement-executing-plans`; doctor reports each missing name, renders its complete `command` object with `template`, `description`, and the required `agent`, and exits non-zero. Document the same four command definitions and the v4.0.0 migration in `README.md` and `SPEC.md`; state that users register the commands and Justice only observes the result.

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
git add src/runtime/opencode-adapter.ts src/hooks/observation-handler.ts src/core/doctor-categories.ts src/runtime/doctor-cli.ts README.md SPEC.md tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/runtime/doctor-cli.test.ts
git commit -m "feat: controller routing observationとdoctor診断を追加"
```

---

## Traceability and Definition of Done

<!-- markdownlint-disable MD013 MD060 -->

| Requirement / Design Decision | Plan Task | Required tests |
|---|---|---|
| JUS-P0-01 controller workflow identity and runtime observation | 4.1, 4.2 | routing decision, applied, mismatch, unapplied, pinned command presence, command template output, release documentation |
| JUS-P0-02 semantic fingerprint | 2.1 | approved task progress invariant, global/unscoped/fenced mutation invalidates, duplicate approved task heading invalidates, EOL invariant |
| JUS-P0-02 canonical snapshot | 2.1, 2.2 | snapshot persistence, hydration, all-tasks-accepted snapshot SSOT |
| JUS-P0-02 cancel and release | 2.3 | cancel, release, subsequent authorization rejection |
| JUS-P0-03 seven-to-seven category mapping | 1.1, 1.2 | every role, legacy downgrade rejection, doctor presence |
| JUS-P0-04 lifecycle replay | 3.1 | duplicate identity, invalid transition, replay continuation |
| JUS-P0-04 task Gate | 3.2 | current task attempt only |
| JUS-P0-04 Final Gate | 3.2 | current finalization attempt only, PASS complete, WARN/FAIL rework, insufficient blocked |
| JUS-P0-04 durable review dispatch | 3.4 | pending, claimed, terminal, four restart states |
| JUS-P0-04 child-session correlation | 3.3, 3.5 | runtime spike, task review correlation, final review correlation, durable binding |
| JUS-P0-04 anti-replay | 3.4, 3.5, 3.6 | consume once, staging recovery, stale call ID, stale round, stale artifact, stale child session |
| JUS-P0-04 transactional PostToolUse | 3.6 | strict sequence, terminal-commit recovery, no parallel side effects |
| INV-01 controller intent differs from worker intent | 4.1 | `tests/core/routing-decision.test.ts` preserves workflow on controller decisions |
| INV-02 worker decision ends at category | 1.1 | `tests/core/routing-decision.test.ts` rejects invalid role/category pairs |
| INV-03 approval survives multiple tasks | 2.2 | `tests/core/plan-authorization.test.ts` hydrates an active binding |
| INV-04 semantic mutation invalidates approval | 2.1, 2.2 | `tests/core/plan-fingerprint.test.ts` checks semantic changes; `tests/hooks/plan-bridge-authorization.test.ts` rejects a changed fingerprint |
| INV-05 high complexity does not silently downgrade | 1.1 | `tests/core/routing-decision.test.ts` rejects the architecture downgrade |
| INV-06 WorkerReported is not TaskAccepted | 3.1, 3.6, 3.7 | `tests/core/task-lifecycle.test.ts`, `tests/core/acceptance-decision.test.ts`, and `tests/core/progress-updater.test.ts` require an accepted decision |
| INV-07 declared evidence cannot pass alone | 3.2 | `tests/core/v2/rule-evaluation-engine.test.ts` and `tests/core/v2/gate-provenance-gating.test.ts` require observed or derived evidence |
| INV-08 Gate PASS precedes progress completion | 3.2, 3.6, 3.7 | `tests/hooks/observation-handler-gate.test.ts`, `tests/core/acceptance-decision.test.ts`, and `tests/core/progress-updater.test.ts` |
| INV-09 Final Review and Final Gate precede Plan Complete | 3.1, 3.2, 3.6 | `tests/core/task-lifecycle.test.ts`, `tests/core/v2/rule-evaluation-engine.test.ts`, and `tests/core/acceptance-decision.test.ts` |
| INV-10 fail-open execution differs from fail-open acceptance | 2.2, 3.2 | `tests/core/plan-authorization.test.ts` and `tests/hooks/observation-handler-gate.test.ts` retain blocked state on unavailable prerequisites |
| INV-11 TaskCallPurpose separates all task call kinds | 3.4, 3.6 | `tests/core/review-dispatch-state.test.ts` and `tests/core/session-state-provider.test.ts` |
| INV-12 terminal authorization is not resurrected | 2.2, 2.3 | `tests/core/plan-authorization.test.ts` and `tests/hooks/plan-bridge-authorization.test.ts` |
| INV-13 PostToolUse side effects are not parallelized | 3.6 | `tests/hooks/observation-handler-transactional.test.ts` checks the ordered trace |
| INV-14 evidence, review, Gate, and Acceptance are attempt-scoped | 3.1, 3.2, 3.4, 3.5, 3.6 | `tests/core/task-lifecycle.test.ts`, `tests/core/v2/rule-evaluation-engine.test.ts`, `tests/core/review-dispatch-state.test.ts`, and `tests/core/acceptance-decision.test.ts` |
| INV-15 mandatory completion precedes artifact consumption | 3.3, 3.5, 3.6 | `tests/runtime/opencode-adapter-v2.test.ts` and `tests/core/review-artifact.test.ts` |
| INV-16 one outstanding dispatch and atomic claim | 3.4 | `tests/core/review-dispatch-state.test.ts` |
| INV-17 dispatch state survives restart without claimed redispatch | 3.4 | `tests/core/v2/state-projection.test.ts` covers pending, claimed without staging, claimed with staging, and terminal |
| INV-18 stale review cannot affect the current round | 3.4, 3.5, 3.6 | `tests/core/review-dispatch-state.test.ts` rejects call, round, artifact, child session, task attempt, and finalization attempt mismatches |

Every task above implements one named design decision: Tasks 1.1-1.2 implement Design §5.3; Tasks 2.1-2.3 implement §4.2, §4.3, and §5.2; Tasks 3.1-3.7 implement §4.4 through §4.11 and §5.4 through §5.5; Tasks 4.1-4.2 implement §3.4, §4.1, §5.1, and §7.3. No task exists solely for future reuse.

Phase 3 is incomplete if Task 3.3 cannot demonstrate both mandatory review correlations. It is incomplete if synchronous mandatory review canonicalization, durable claim, durable child binding, staging, artifact consumption, stale-event rejection, attempt-scoped acceptance, task Gate, or Final Gate lacks a passing automated test. A known runtime limitation documents an observation only; it never waives a P0 completion criterion.

<!-- markdownlint-enable MD013 MD060 -->

Before implementation handoff, inspect every implementation step for unresolved placeholders, ambiguous file paths, and unbound requirements. Then verify that each table row names at least one exact task and test file.
