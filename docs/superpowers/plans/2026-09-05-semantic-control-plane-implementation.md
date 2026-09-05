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
  expect(createWorkerRoutingDecision(role, category, "task_classification").category).toBe(
    category,
  );
});

it("rejects the legacy architecture downgrade", () => {
  expect(() =>
    createWorkerRoutingDecision("architecture", "unspecified-high", "task_classification"),
  ).toThrow();
});

it.each(["sp-deep", "sp-architecture"] as const)(
  "keeps %s at the existing zero retry modifier",
  (category) => {
    expect(new RetryPolicyCalculator().compute({ category, stepCount: 1 })).toMatchObject({
      categoryModifier: 0,
      maxRetries: RetryPolicyCalculator.BASE,
    });
  },
);
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
- Modify: `src/core/doctor-config.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Test: `tests/core/doctor-categories.test.ts`
- Test: `tests/core/justice-doctor-config.test.ts`
- Test: `tests/runtime/doctor-cli.test.ts`

**Consumes:** `SpCategory` from `src/core/types.ts`; `buildDoctorEffectiveConfigView(scans): DoctorEffectiveConfigView` from `src/core/doctor-config.ts`.

**Produces:** `DoctorEffectiveConfigView = { readonly effectiveCategoryNames: readonly string[]; readonly effectiveCommandDefinitions: ReadonlyMap<string, { readonly agent?: string }> }`; `ALL_SP_CATEGORIES: readonly SpCategory[]`; `checkSpCategoryPresence(categoryNames: readonly string[]): SpCategoryPresenceResult` where `SpCategoryPresenceResult` is `{ readonly missing: readonly SpCategory[]; readonly ok: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("reports exactly the missing required categories", () => {
  expect(checkSpCategoryPresence(["sp-mechanical"])).toEqual({
    ok: false,
    missing: [
      "sp-implementation",
      "sp-integration",
      "sp-review",
      "sp-final-review",
      "sp-deep",
      "sp-architecture",
    ],
  });
});

it("accepts all seven categories", () => {
  expect(checkSpCategoryPresence(Array.from(ALL_SP_CATEGORIES))).toEqual({ ok: true, missing: [] });
});

it("uses the higher-priority JSONC category value instead of a source union", () => {
  const effective = buildDoctorEffectiveConfigView([
    scanConfigText("global", '{ category: { "sp-review": { agent: "old" }, "sp-deep": {} } }'),
    scanConfigText("project", '{ category: { "sp-review": { agent: "new" } } }'),
  ]);
  expect(effective.effectiveCategoryNames).toEqual(["sp-review"]);
});

it.each(["category", "command"])("omits a missing %s key without exposing values", (key) => {
  const effective = buildDoctorEffectiveConfigView([scanConfigText("project", "{}")]);
  expect(
    key === "category"
      ? effective.effectiveCategoryNames
      : Array.from(effective.effectiveCommandDefinitions),
  ).toEqual([]);
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/doctor-categories.test.ts tests/core/justice-doctor-config.test.ts tests/runtime/doctor-cli.test.ts`

Expected: FAIL because the category checker is absent.

- [ ] **Step 3: Implement the checker and CLI diagnostic**

```ts
export const ALL_SP_CATEGORIES: readonly SpCategory[] = [
  "sp-mechanical",
  "sp-implementation",
  "sp-integration",
  "sp-review",
  "sp-final-review",
  "sp-deep",
  "sp-architecture",
];

export function checkSpCategoryPresence(
  categoryNames: readonly string[],
): SpCategoryPresenceResult {
  const names = new Set(categoryNames);
  const missing = ALL_SP_CATEGORIES.filter((category) => !names.has(category));
  return { ok: missing.length === 0, missing };
}
```

Parse each readable supported JSONC source in `doctor-config.ts` and reduce it in existing `SOURCE_PRIORITY` order. For allowlisted top-level `category` and `command` objects, a higher-priority same-name key replaces the lower-priority value; do not deep-merge or union names. Export category names and, for commands only, the allowlisted `agent` field keyed by command name. Unreadable, unsupported, and parse-error sources contribute no effective values and retain redacted diagnostics. `doctor-cli.ts` passes `effectiveCategoryNames` to the checker and appends one non-zero-exit diagnostic for every missing name.

Add focused tests for command precedence, unreadable source, unsupported source, JSONC comments/trailing commas, category missing, command missing, and diagnostics that contain neither literal category/command values nor secret-like values.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/doctor-categories.test.ts tests/core/justice-doctor-config.test.ts tests/runtime/doctor-cli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/doctor-categories.ts src/core/doctor-config.ts src/runtime/doctor-cli.ts tests/core/doctor-categories.test.ts tests/core/justice-doctor-config.test.ts tests/runtime/doctor-cli.test.ts
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

````ts
const taskUnchecked = "## Task 1: approved\n- [ ] execute\n";
const taskChecked = "## Task 1: approved\n- [x] execute\n";
const globalUnchecked = "- [ ] release checklist\n\n## Task 1: approved\n- [ ] execute\n";
const globalChecked = "- [x] release checklist\n\n## Task 1: approved\n- [ ] execute\n";
const unscopedUnchecked = "Notes\n- [ ] verify manually\n\n## Task 1: approved\n- [ ] execute\n";
const unscopedChecked = "Notes\n- [x] verify manually\n\n## Task 1: approved\n- [ ] execute\n";
const fencedUnchecked = "## Task 1: approved\n```text\n- [ ] example\n```\n- [ ] execute\n";
const fencedChecked = "## Task 1: approved\n```text\n- [x] example\n```\n- [ ] execute\n";
const unapprovedTaskUnchecked =
  "## Task 1: approved\n- [ ] execute\n\n## Task 2: added\n- [ ] added step\n";
const unapprovedTaskChecked =
  "## Task 1: approved\n- [ ] execute\n\n## Task 2: added\n- [x] added step\n";
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
````

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
export function computePlanFingerprint(
  raw: string,
  approvedTaskIds: readonly string[],
): PlanFingerprint {
  return {
    algorithm: "sha256",
    value: hashString(canonicalize(raw, approvedTaskIds)).replace("sha256:", ""),
  };
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

**Produces:** the Design §4.2 discriminated `ApprovedPlanBinding`, including
`invalidationReason: "plan_superseded"` only on a superseded invalid binding;
`ApprovePlanInput` without `authorizationId`; `AuthorizationStore.approve(input:
ApprovePlanInput): Promise<ApprovedPlanBinding | null>` that always generates a fresh authorizationId and
leaves at most one active binding per session; `AuthorizationStore.release(authorizationId, at):
Promise<boolean>`; `AuthorizationStore.hydrate(): Promise<readonly ApprovedPlanBinding[]>`.

- [ ] **Step 1: Write the failing persistence and hydration tests**

```ts
it("stores the canonical snapshot in the same authorization record", async () => {
  const binding = await store.approve(input);
  expect(binding?.canonicalSnapshot.documentDigest).toBe(snapshot.documentDigest);
  expect(
    JSON.parse(files.get(".justice/authorizations.json") ?? "[]")[0].canonicalSnapshot,
  ).toEqual(snapshot);
});

it("hydrates an active binding and rejects a changed fingerprint", async () => {
  await store.approve(input);
  expect((await store.hydrate())[0]?.status).toBe("active");
  expect(isBindingActiveFor(binding!, "s1", "docs/p.md", changedFingerprint)).toBe(false);
});

it("generates a fresh authorizationId on reapproval", async () => {
  const oldBinding = await store.approve(input);
  await store.release(oldBinding!.authorizationId, "2026-09-05T00:00:00.000Z");
  const newBinding = await store.approve(input);
  expect(newBinding!.authorizationId).not.toBe(oldBinding!.authorizationId);
});

it("never lets a stale active merge overwrite the same terminal authorizationId", () => {
  expect(mergeBindings(staleActive, releasedBinding)).toEqual(releasedBinding);
});

it("atomically supersedes only the active binding in the approving session", async () => {
  const planA = await store.approve(inputFor("s1", "docs/a.md"));
  const planB = await store.approve(inputFor("s1", "docs/b.md"));
  const otherSession = await store.approve(inputFor("s2", "docs/other.md"));
  const bindings = await store.hydrate();
  const superseded = bindings.find((binding) => binding.authorizationId === planA?.authorizationId);

  expect(superseded).toMatchObject({
    status: "invalidated",
    invalidationReason: "plan_superseded",
  });
  expect(planB).toMatchObject({ status: "active" });
  expect(planB?.authorizationId).not.toBe(planA?.authorizationId);
  expect(
    bindings.filter((binding) => binding.sessionId === "s1" && binding.status === "active"),
  ).toHaveLength(1);
  expect(isBindingActiveFor(superseded!, "s1", "docs/a.md", fingerprintFor("docs/a.md"))).toBe(
    false,
  );
  expect(otherSession).toMatchObject({ sessionId: "s2", status: "active" });
});

it("does not publish a superseding binding when the single authoritative save fails", async () => {
  const planA = await store.approve(inputFor("s1", "docs/a.md"));
  persistence.saveAtomicWithLock.mockResolvedValueOnce({ status: "conflict_diverted", retries: 3 });

  await expect(store.approve(inputFor("s1", "docs/b.md"))).resolves.toBeNull();
  expect(await store.hydrate()).toEqual([planA]);
  expect(bridge.activePlanFor("s1")).toBe("docs/a.md");
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-authorization.test.ts tests/hooks/plan-bridge-authorization.test.ts`

Expected: FAIL because authorization persistence and hydration do not exist.

- [ ] **Step 3: Implement the authorization store**

Use exactly `.justice/authorizations.json` and `.justice/authorizations.conflict.json` as the
`AtomicPersistence` paths. Store only `ReadonlyArray<ApprovedPlanBinding>`. `ApprovePlanInput` must not
accept a caller-provided authorizationId. For approval, load the authoritative array and construct one
replacement array: map only same-session active bindings to `{ status: "invalidated", invalidatedAt,
invalidationReason: "plan_superseded" }`, retain every terminal and other-session binding, then append one
fresh active binding. Submit that complete array through one `AtomicPersistence.saveAtomicWithLock` call.
Promote the result to the authorization cache and `PlanBridge` only if the result is `saved`; on an
exception or `conflict_diverted`, return `null`, retain the prior cache, and leave enrichment unauthorized.
Keep the same-ID terminal-overwrite rule inside the persistence merge function and test it independently
from approval. On plugin initialization, hydrate active bindings and restore their `planPath` into
`PlanBridge`; if the file cannot be read, no binding is active. Do not add a transaction framework.

```ts
type ApprovedPlanBindingBase = {
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly canonicalSnapshot: CanonicalPlanSnapshot;
  readonly fingerprintSchema: "justice-plan-v1";
  readonly approvedAt: string;
};

export type ApprovedPlanBinding =
  | (ApprovedPlanBindingBase & { readonly status: "active" })
  | (ApprovedPlanBindingBase & {
      readonly status: "invalidated";
      readonly invalidatedAt: string;
      readonly invalidationReason?: "plan_superseded";
    })
  | (ApprovedPlanBindingBase & { readonly status: "released"; readonly releasedAt: string });
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
- Modify: `src/core/types.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Test: `tests/core/implement-command.test.ts`
- Test: `tests/runtime/opencode-adapter.test.ts`
- Test: `tests/hooks/plan-bridge-authorization.test.ts`

**Consumes:** `parseJusticeImplementCommandArguments(argumentsString)`; `AuthorizationStore.release(authorizationId, at)`.

**Produces:** `ImplementationArmRequest` discriminated union with `{ readonly source: "command"; readonly action: "approve"; readonly planPath: string; readonly approved: boolean }` and `{ readonly source: "command"; readonly action: "cancel" }`.

- [ ] **Step 1: Write the failing cancellation tests**

```ts
it("parses pathless cancel", () => {
  expect(parseJusticeImplementCommandArguments("--cancel")).toEqual({
    source: "command",
    action: "cancel",
  });
});

it.each(["--plan docs/p.md --cancel", "--approved --cancel", "--cancel --cancel"])(
  "rejects incompatible cancel flags: %s",
  (argumentsString) => {
    expect(parseJusticeImplementCommandArguments(argumentsString)).toBeNull();
  },
);

it("accepts only plan-scoped approval", () => {
  expect(parseJusticeImplementCommandArguments("--plan docs/p.md --approved")).toMatchObject({
    action: "approve",
    planPath: "docs/p.md",
    approved: true,
  });
});

it("releases then rejects subsequent task authorization", async () => {
  await bridge.handleImplementationArm("s1", approveRequest);
  await bridge.handleImplementationArm("s1", cancelRequest);
  expect((await bridge.handlePreToolUse(taskEvent)).injectedContext).toContain(
    "IMPLEMENTATION UNAUTHORIZED",
  );
});

it("treats cancel without an active binding as an idempotent no-op", async () => {
  await expect(bridge.handleImplementationArm("s1", cancelRequest)).resolves.toMatchObject({
    armed: false,
  });
  expect(release).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/implement-command.test.ts tests/runtime/opencode-adapter.test.ts tests/hooks/plan-bridge-authorization.test.ts`

Expected: FAIL because `--cancel` is rejected.

- [ ] **Step 3: Implement cancellation**

Accept exactly one of `--approved` and `--cancel`. Approve requires exactly one safe `--plan`; cancel forbids `--plan`. Reject both flags, duplicate flags, missing approve plan, and unsafe paths. In `PlanBridge.handleImplementationArm`, branch on `action` before resolving a plan path. For cancel, resolve only the current session's single active binding, persist `active -> released`, and clear the active plan cache only after durable success. With no active binding, return the deterministic non-armed no-op result without persistence I/O. After either successful release or no-op, later `handlePreToolUse` returns the existing unauthorized advisory.

```ts
if (cancel) return { source: "command", action: "cancel" };
return { source: "command", action: "approve", planPath, approved };
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/implement-command.test.ts tests/runtime/opencode-adapter.test.ts tests/hooks/plan-bridge-authorization.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/implement-command.ts src/core/types.ts src/runtime/opencode-adapter.ts src/hooks/plan-bridge.ts tests/core/implement-command.test.ts tests/runtime/opencode-adapter.test.ts tests/hooks/plan-bridge-authorization.test.ts
git commit -m "feat: plan authorizationのcancelを追加"
```

---

## Phase 3a: Lifecycle and Final Gate — JUS-P0-04

### Task 3.1: Make lifecycle replay-safe and orchestrate attempts

**Requirement:** JUS-P0-04, INV-06, INV-08, INV-09, INV-14.

**Files:**

- Create: `src/core/task-lifecycle.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/core/session-state-provider.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/task-lifecycle.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Create: `tests/hooks/observation-handler-lifecycle.test.ts`
- Test: `tests/core/session-state-provider.test.ts`

**Consumes:** active `ApprovedPlanBinding` from Task 2.2; implementation `TaskCallBinding`; `PersistedLogRecord`; `TaskExecutionRef`; `FinalizationAttemptId`.

**Produces:** `TransitionOutcome = { readonly kind: "applied" | "duplicate" | "invalid"; readonly state: TaskProgressState | PlanFinalizationState; readonly advisory?: string }`; `applyTaskTransition`; `applyPlanTransition`; `startImplementationAttempt`; `recordWorkerReportedAndEvidence`; `requestCurrentTaskReview`; `advanceFinalizationAfterAllTasksAccepted`.

- [ ] **Step 1: Write the failing replay tests**

```ts
it("keeps state for duplicate and illegal transitions", () => {
  expect(applyTaskTransition("accepted", acceptedToPendingEvent)).toEqual({
    kind: "invalid",
    state: "accepted",
    advisory: "accepted -> pending is not allowed",
  });
  expect(applyTaskTransition("in_progress", duplicateStartEvent)).toEqual({
    kind: "duplicate",
    state: "in_progress",
  });
});

it("projects an invalid record without aborting later records", () => {
  expect(
    project([invalidRecord, validRecord], "2026-09-05T00:00:00.000Z").tasks.get("task-1")?.status,
  ).toBe("open");
});

it("records the happy-path lifecycle in order", async () => {
  await runImplementationLifecycle(currentTask);
  expect(trace).toEqual([
    "authorized",
    "in_progress",
    "worker_reported",
    "evidence_pending",
    "review_pending",
    "review-directive",
  ]);
});

it("starts rework with a fresh attempt and reviewRound 1", async () => {
  const next = await startImplementationAttempt(reworkRequiredTask);
  expect(next.taskExecutionRef.attemptId).not.toBe(oldAttemptId);
  expect(next.reviewRound).toBe(1);
});

it("rejects old-attempt evidence and worker reports", async () => {
  await recordWorkerReportedAndEvidence(oldAttemptBinding);
  expect(projectedCurrentAttempt().evidence).toEqual([]);
});

it("rebuilds exactly one current task attempt after restart", () => {
  expect(project(lifecycleRecords, now).currentTaskExecutionRef("task-1")).toEqual(currentAttempt);
});

it("starts and reworks finalization with fresh finalization identities", async () => {
  const initial = await advanceFinalizationAfterAllTasksAccepted(binding);
  const rework = await startNextFinalizationAttempt(initial);
  expect(rework.finalizationAttemptId).not.toBe(initial.finalizationAttemptId);
  expect(rework.finalReviewRound).toBe(initial.finalReviewRound + 1);
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-lifecycle.test.ts tests/core/session-state-provider.test.ts`

Expected: FAIL because lifecycle projection and runtime orchestration are absent.

- [ ] **Step 3: Implement non-throwing transition outcomes**

Encode every lifecycle record in `observation-model.ts` with its task execution reference or finalization identity. Make duplicate identity leave state unchanged. Make illegal transitions leave state unchanged and emit an advisory record in the projection result. Do not throw from the projector for either case. Derive `all_tasks_accepted` from `ApprovedPlanBinding.canonicalSnapshot.tasks.map(task => task.taskId)`.

In the sequential `JusticePlugin` path, select the authorized current task, issue a fresh attemptId only when starting implementation, durably record `authorized → in_progress`, and persist the implementation call binding before accepting its PostToolUse as authoritative. Matching PostToolUse records `worker_reported`, then observed/derived evidence scoped to that same ref, then `evidence_pending → review_pending`; it emits a current-attempt `ReviewRequiredDirective` only after Task 3.4 has committed its pending dispatch slot. Old-attempt records are advisory-only. On all accepted snapshot task IDs, create the current finalization attempt and durably enter `final_review_pending`. Do not evaluate a Gate in this task; Task 3.2 receives only projected `gate_pending` / `final_gate_pending` states after Task 3.6 terminalization.

```ts
if (event.identity === state.lastTransitionIdentity)
  return { kind: "duplicate", state: state.value };
if (!VALID_TASK_TRANSITIONS.get(state.value)?.has(event.to)) {
  return {
    kind: "invalid",
    state: state.value,
    advisory: `${state.value} -> ${event.to} is not allowed`,
  };
}
return { kind: "applied", state: event.to };
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-lifecycle.test.ts tests/core/session-state-provider.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/task-lifecycle.ts src/core/types.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/core/session-state-provider.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-lifecycle.test.ts tests/core/session-state-provider.test.ts
git commit -m "feat: lifecycle replayをidempotentに処理"
```

### Task 3.2: Add task and plan-scoped Gate evaluation

**Requirement:** JUS-P0-04, INV-08, INV-09, INV-14.

**Files:**

- Create: `src/core/acceptance-decision.ts`
- Modify: `src/core/v2/gate-definition.ts`
- Modify: `src/core/v2/gate-context.ts`
- Modify: `src/core/v2/rule-evaluation-engine.ts`
- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/core/v2/rule-evaluation-engine.test.ts`
- Create: `tests/core/acceptance-decision.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`

**Consumes:** `GateScope = "task" | "plan"`; `GateTrigger`; current projected lifecycle state from Task 3.1.

**Produces:** `GateDecision = TaskGateDecision | PlanGateDecision`; `evaluateGatePendingAttempt`; `deriveAcceptanceDecision`; `evaluate(gates, evidence, context)` returns a decision containing either `taskExecutionRef` or `authorizationId`, `planPath`, `finalizationAttemptId`, and `finalReviewRound`.

- [ ] **Step 1: Write the failing Final Gate tests**

```ts
it("selects a plan gate only for final_review_complete", () => {
  expect(evaluate([planGate], [], finalReviewContext).gateType).toBe("plan");
  expect(
    evaluate([planGate], [], Object.assign({}, finalReviewContext, { trigger: "tool_observed" }))
      .verdict,
  ).toBe("SKIP");
});

it("includes the current finalization identity in a plan decision", () => {
  expect(evaluate([planGate], [], finalReviewContext)).toMatchObject({
    gateType: "plan",
    authorizationId: "a1",
    planPath: "docs/p.md",
    finalizationAttemptId: "f2",
    finalReviewRound: 2,
  });
});

it("maps Final Gate verdicts without accepting stale evidence", () => {
  expect(decidePlanCompletion({ gate: passForCurrentAttempt })).toBe("complete");
  expect(decidePlanCompletion({ gate: warnForCurrentAttempt })).toBe("final_rework_required");
  expect(decidePlanCompletion({ gate: undefined })).toBe("final_gate_pending");
  expect(decidePlanCompletion({ gate: passForOldAttempt })).toBe("final_gate_pending");
});

it("does not evaluate before the terminal review projects gate_pending", async () => {
  await evaluateGatePendingAttempt(reviewPendingContext);
  expect(evaluate).not.toHaveBeenCalled();
});

it("records GateDecision before deriving acceptance for the same current attempt", async () => {
  await evaluateGatePendingAttempt(gatePendingContext);
  expect(trace).toEqual(["record-gate-decision", "record-acceptance", "accepted"]);
});

it("blocks an old-attempt GateDecision", () => {
  expect(deriveAcceptanceDecision(oldAttemptPass, currentAttempt)).toMatchObject({
    verdict: "blocked",
  });
});

it.each([gateUnavailable, gateError, insufficientEvidence])(
  "keeps gate_pending and blocks acceptance for %s",
  async (outcome) => {
    await evaluateGatePendingAttempt(contextFor(outcome));
    expect(projectedTaskState()).toBe("gate_pending");
    expect(latestAcceptanceDecision()).toMatchObject({ verdict: "blocked" });
  },
);
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/v2/rule-evaluation-engine.test.ts tests/core/acceptance-decision.test.ts tests/hooks/observation-handler-gate.test.ts`

Expected: FAIL because plan gates are skipped and task gate decisions are fixed.

- [ ] **Step 3: Implement scoped Gate selection**

Define `GateRule.gateType` as `"task" | "plan"`. Define task triggers as `task_complete | tool_observed` and the plan trigger as `final_review_complete`. `evaluateGatePendingAttempt` must first read the durable projection and refuse to invoke `evaluate` unless its current lifecycle is `gate_pending` or `final_gate_pending` and the matching terminal review record is projected. Append a current-attempt GateDecision before deriving and durably recording the matching AcceptanceDecision. Map PASS to `accepted` / `complete`, WARN and FAIL to `rework_required` / `final_rework_required`, and errors, SKIP, or insufficient evidence to blocked while preserving `gate_pending` / `final_gate_pending`.

```ts
const activeGates = gates.filter(
  (gate) => gate.enabled && gate.gateType === ctx.scope && gate.trigger.on === ctx.trigger,
);
if (ctx.scope === "plan") {
  return {
    gateType: "plan",
    authorizationId: ctx.authorizationId,
    planPath: ctx.planPath,
    finalizationAttemptId: ctx.finalizationAttemptId,
    finalReviewRound: ctx.finalReviewRound,
    verdict,
    ruleResults,
  };
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/v2/rule-evaluation-engine.test.ts tests/core/acceptance-decision.test.ts tests/hooks/observation-handler-gate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/acceptance-decision.ts src/core/v2/gate-definition.ts src/core/v2/gate-context.ts src/core/v2/rule-evaluation-engine.ts src/hooks/observation-handler.ts tests/core/v2/rule-evaluation-engine.test.ts tests/core/acceptance-decision.test.ts tests/hooks/observation-handler-gate.test.ts
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

**Consumes:** current `TaskExecutionRef` or finalization identity; `ReviewCorrelation`; review
`TaskCallPurpose`; durable log append; `FileReader.fileExists`; `FileWriter.mkdir`; safe-relative-path
validation.

**Produces:** `ReviewRequiredDirective`; durable `null -> pending` and `pending -> claimed` records;
`TaskCallBinding`; Design §4.10 `ReviewArtifactReservation`; `claimReviewDispatch(input):
Promise<ClaimReviewDispatchOutcome>`; `projectReviewDispatchSlots(records)`; and an in-memory cache
reconstructed only from the durable projection. `ClaimReviewDispatchOutcome` is either `{ readonly kind:
"claimed"; readonly taskCallBinding: TaskCallBinding }` or `{ readonly kind: "blocked"; readonly
advisory: string }`; a blocked outcome exposes neither `callId` nor `artifactId` as authority.

- [ ] **Step 1: Write the failing dispatch, claim, and recovery tests**

```ts
it("commits pending before injecting exactly one review directive", async () => {
  await requestMandatoryReview(taskExecutionRef);
  expect(trace).toEqual(["commit-pending", "inject-review-directive"]);
});

it.each(["pending", "claimed_without_staging", "claimed_with_staging", "terminal"] as const)(
  "replays %s without unsafe redispatch",
  (state) => {
    expect(projectReviewDispatchSlots(recordsFor(state))).toMatchSnapshot();
  },
);

it("claims only one matching pending slot without creating a child binding", async () => {
  const result = await claimReviewDispatch(reviewPreToolUse);
  expect(result).toMatchObject({ kind: "claimed", taskCallBinding: expect.any(Object) });
  expect(result).not.toHaveProperty("delegatedExecutionBinding");
});

it("rejects zero, multiple, and category-mismatched pending slots without a binding or reservation", async () => {
  arrangeProjectedSlots(invalidSlots);
  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({ kind: "blocked" });
  expect(writeDurableRecord).not.toHaveBeenCalledWith(
    expect.objectContaining({ kind: "delegated_execution_binding" }),
  );
});

it("reserves a safe unused artifact path", async () => {
  await expect(reserveReviewArtifact()).resolves.toMatchObject({
    status: "usable",
    artifactId: expect.any(String),
    artifactPath: expect.stringMatching(/^\.justice\/reviews\/.+\.json$/u),
  });
});

it("retries a colliding artifact candidate with a fresh UUID and path", async () => {
  fileReader.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(reserveReviewArtifact()).resolves.toMatchObject({ status: "usable" });
  expect(uuid).toHaveBeenCalledTimes(2);
  expect(recordAdvisory).toHaveBeenCalledWith("review_unexpected_existing_artifact");
});

it.each([
  ["exhausted collisions", setupEveryCandidateExists, "artifact_path_collision_exhausted"],
  ["storage I/O", setupExistsCheckFailure, "artifact_storage_unavailable"],
  ["review-directory I/O", setupDirectoryCreationFailure, "artifact_storage_unavailable"],
  ["unsafe generated path", setupUnsafeRelativePath, "artifact_path_invalid"],
  ["unexpected generator failure", setupUuidFailure, "reservation_internal_error"],
] as const)("returns unusable reservation for %s", async (_name, setup, reason) => {
  setup();
  await expect(reserveReviewArtifact()).resolves.toEqual({ status: "unusable", reason });
});

it("keeps an unusable reservation durably claimed but omits its path from worker input", async () => {
  setupEveryCandidateExists();
  await claimReviewDispatch(reviewPreToolUse);
  expect(projectedClaim().artifactReservation).toEqual({
    status: "unusable",
    reason: "artifact_path_collision_exhausted",
  });
  expect(workerInput).not.toContain(".justice/reviews/");
  expect(taskExecution).toHaveBeenCalledTimes(1);
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
});

it("allows exactly one concurrent claim for one parent-session slot", async () => {
  const [first, second] = await Promise.all([
    claimReviewDispatch(reviewPreToolUseFor("call-a")),
    claimReviewDispatch(reviewPreToolUseFor("call-b")),
  ]);

  expect([first, second].filter((result) => result.kind === "claimed")).toHaveLength(1);
  expect([first, second].filter((result) => result.kind === "blocked")).toHaveLength(1);
  expect(durableTransitions("pending", "claimed")).toHaveLength(1);
  expect(projectedTaskCallBindings()).toHaveLength(1);
  expect(projectedArtifactReservations()).toHaveLength(1);
  const winner = [first, second].find(
    (result): result is { readonly kind: "claimed"; readonly taskCallBinding: TaskCallBinding } =>
      result.kind === "claimed",
  );
  const loser = [first, second].find((result) => result.kind === "blocked");
  expect(winner).toBeDefined();
  expect(authoritativeCallIds()).toEqual([winner?.taskCallBinding.callId]);
  expect(authoritativeCallIds()).not.toContain(loser === first ? "call-a" : "call-b");
  expect(authoritativeArtifactIds()).toHaveLength(1);
  expect(reserveReviewArtifact).toHaveBeenCalledTimes(1);
});

it("terminalizes conclusive loss before retrying the same task attempt", async () => {
  await recoverConclusiveReviewLoss(currentClaim);
  expect(durableTerminal()).toMatchObject({ terminalReason: "lost_conclusive" });
  expect(nextPendingCorrelation()).toMatchObject({
    taskExecutionRef: currentTaskExecutionRef,
    reviewRound: currentReviewRound + 1,
  });
});

it("keeps an uncertain recovered claim blocked without redispatch", async () => {
  await recoverClaimedWithoutTerminal(currentClaim);
  expect(reissuedDirective).not.toHaveBeenCalled();
  expect(nextPendingCorrelation).not.toHaveBeenCalled();
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL because durable dispatch, trusted call binding, and review directives do not exist.

- [ ] **Step 3: Implement durable dispatch and claim**

Persist one `pending` slot per parent session before injecting its `ReviewRequiredDirective`. Implement a
private, domain-specific `pendingClaimQueues: Map<string, Promise<void>>`, keyed by `parentSessionId`.
`claimReviewDispatch` appends its operation to that parent session's queue and removes the map entry after
the queued operation settles. This queue is not a reusable lock framework.

Inside that one parent-session critical section, read the latest durable log and re-project the slot;
require exactly one matching pending slot; create its reservation; and append one claimed transition record
containing the trusted correlation, `callId`, expected category, and reservation. The projection derives
the `TaskCallBinding` from that claimed record. Do not publish the binding, reservation, or worker-path
argument until that append succeeds. If the append fails, retain the pending slot, publish no binding or
reservation, emit a binding-failure advisory, and return `blocked`. The queue is process-local exclusion
only: restart always re-projects durable records, which remain the SSOT.

`reserveReviewArtifact` uses the fixed P0 constant
`MAX_ARTIFACT_RESERVATION_ATTEMPTS = 3`. For each attempt it generates a fresh UUID, builds
`.justice/reviews/<artifactId>.json`, validates it with `normalizeSafeRelativePath`, ensures the review
directory exists, and calls `fileExists` before dispatch. A collision records
`review_unexpected_existing_artifact` and retries with a new UUID. All three collisions return
`{ status: "unusable", reason: "artifact_path_collision_exhausted" }`; exists or directory I/O failure
returns `artifact_storage_unavailable`; invalid paths return `artifact_path_invalid`; other generator
failures return `reservation_internal_error`. The claimed record retains either result. For a usable result,
add only `artifactPath` to the worker input. For an unusable result, omit the path, continue the runtime
`task()` call fail-open, and record blocked mandatory-review acceptance without creating a ReviewArtifact.

Do not create `DelegatedExecutionBinding` here: a child session has not yet been authoritatively observed.
Canonicalize `sp-review` and `sp-final-review` to `run_in_background = false` before the claim. A terminal
slot is immutable; pending recovery reissues the same directive, recovered claimed slots wait for matching
PostToolUse, conclusive loss writes `lost_conclusive` before a new review round, and uncertain claimed
recovery does not redispatch.

```ts
const pendingClaimQueues = new Map<string, Promise<void>>();

async function claimReviewDispatch(input: ClaimInput): Promise<ClaimReviewDispatchOutcome> {
  return serializeParentSessionClaim(input.parentSessionId, async () => {
    const slots = projectReviewDispatchSlots(await readDurableRecords());
    const pending = selectExactlyOnePendingSlot(slots, input);
    if (pending === undefined) return { kind: "blocked", advisory: "review_claim_unavailable" };

    const reservation = await reserveReviewArtifact();
    const claimed = await appendClaimedTransition({ pending, callId: input.callId, reservation });
    return claimed.kind === "committed"
      ? { kind: "claimed", taskCallBinding: projectTaskCallBinding(claimed.record) }
      : { kind: "blocked", advisory: "review_claim_commit_failed" };
  });
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
it.each(["sp-review", "sp-final-review"] as const)(
  "captures and persists %s child relation",
  async (category) => {
    await adapter.replay(capturedRuntimeEvents(category, "parent-call", "child-session"));
    expect(await projectedBinding("parent-call")).toMatchObject({
      parentCallId: "parent-call",
      childSessionId: "child-session",
    });
  },
);

it("derives task and finalization scopes from the claimed correlation", async () => {
  expect(await bindObservedChild(taskClaim, childRelation)).toMatchObject({
    scope: { kind: "task" },
  });
  expect(await bindObservedChild(finalClaim, childRelation)).toMatchObject({
    scope: { kind: "finalization" },
  });
});

it.each([unknownParentCall, staleChildRelation])(
  "rejects an untrusted child relation",
  async (relation) => {
    await expect(bindObservedChild(currentClaim, relation)).resolves.toEqual({ kind: "stale" });
  },
);

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
- Modify: `src/core/session-state-provider.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/review-artifact.test.ts`
- Test: `tests/core/session-state-provider.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`

**Consumes:** projected claimed dispatch slot; durable `TaskCallBinding`; durable
`DelegatedExecutionBinding`; Design §4.10 `ReviewArtifactReservation`; `evaluateGatePendingAttempt` from
Task 3.2.

**Produces:** `consumeReviewCompletion(input): Promise<ReviewCompletionOutcome>`;
`classifyReviewCompletion(result: ReviewWorkerResultV1): ReviewCompletionClassification`; one composite
terminal `ReviewDispatchTransitionRecord`; a projected `review_observed` semantic only for an assembled
artifact; and a gate-evaluation request only for a durable clean-artifact `gate_pending` /
`final_gate_pending` transition. `ReviewCompletionClassification` is a discriminated union for
`completed`, `completed_with_findings`, and `review_incomplete`, with the exact Design §4.8.1 artifact
subtype in each branch.

- [ ] **Step 1: Write the failing ordering, decision, and anti-replay tests**

```ts
it("performs the review completion protocol in durable order", async () => {
  await consumeReviewCompletion(matchingInput);
  expect(trace).toEqual([
    "verify-claimed-binding",
    "verify-child-binding",
    "read-artifact-once",
    "validate-schema",
    "compute-digest",
    "commit-staging",
    "append-terminal-record",
    "project-review-observed",
    "record-gate-pending",
    "evaluate-gate",
    "cleanup-artifact",
  ]);
});

it("does not accept a review without a durable child binding", async () => {
  await expect(consumeReviewCompletion(inputWithoutBinding)).resolves.toEqual({ kind: "blocked" });
  expect(readArtifact).not.toHaveBeenCalled();
});

it("does not read or assemble an unusable reservation and leaves Acceptance blocked", async () => {
  await expect(consumeReviewCompletion(inputWithUnusableReservation)).resolves.toEqual({
    kind: "blocked",
  });
  expect(readArtifact).not.toHaveBeenCalled();
  expect(assembleReviewArtifact).not.toHaveBeenCalled();
  expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
});

it("retries terminalization from staging without rereading the artifact", async () => {
  await consumeReviewCompletion(inputWithTerminalCommitFailure);
  await recoverReviewCompletion(stagedRecord);
  expect(readArtifact).toHaveBeenCalledTimes(1);
});

it("does not consume a duplicate matching PostToolUse twice", async () => {
  await consumeReviewCompletion(matchingInput);
  await consumeReviewCompletion(matchingInput);
  expect(readArtifact).toHaveBeenCalledTimes(1);
  expect(appendTerminalRecord).toHaveBeenCalledTimes(1);
});

it("never exposes a partial terminal state when the physical append fails", async () => {
  await consumeReviewCompletion(inputWithTerminalCommitFailure);
  expect(projectedReview()).toBeUndefined();
  expect(projectedSlot().state).toBe("claimed");
});

it("replays one terminal record into the same consumed review and summary", () => {
  expect(project([terminalRecord], now)).toEqual(project([terminalRecord], later));
});

it("rejects a terminal record that lacks its required artifact payload", () => {
  expect(project([malformedConsumedWithoutArtifact], now).reviewSummary).toEqual(
    emptyReviewSummary,
  );
  expect(project([malformedConsumedWithoutArtifact], now).dispatchSlot?.state).toBe("claimed");
});

it("does not create acceptance before terminalization and gate_pending", async () => {
  await consumeReviewCompletion(inputBeforeTerminalAppend);
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
});

it("classifies a clean artifact as completed and invokes the Gate", async () => {
  await consumeReviewCompletion(inputFor({ complete: true, findings: [] }));
  expect(durableTerminal()).toMatchObject({ terminalReason: "completed" });
  expect(recordGatePendingAndEvaluate).toHaveBeenCalledWith(
    expect.objectContaining({ complete: true, findings: [] }),
  );
});

it("classifies findings as completed_with_findings and requires direct rework", async () => {
  await consumeReviewCompletion(inputFor({ complete: true, findings: [finding] }));
  expect(durableTerminal()).toMatchObject({ terminalReason: "completed_with_findings" });
  expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
  expect(projectedTaskState()).toBe("rework_required");
});

it("classifies an incomplete artifact as review_incomplete and keeps the review blocked", async () => {
  await consumeReviewCompletion(inputFor({ complete: false, findings: [] }));
  expect(durableTerminal()).toMatchObject({ terminalReason: "review_incomplete" });
  expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
  expect(projectedTaskState()).toBe("review_pending");
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
});

it.each([
  ["reviewer execution failure", recordReviewerExecutionFailure],
  ["transport failure", recordReviewTransportFailure],
] as const)("retries %s in the same implementation attempt", async (_name, failReview) => {
  await failReview(currentClaim);
  expect(durableTerminal()).toMatchObject({ terminalReason: "review_execution_failed" });
  expect(nextPendingCorrelation()).toMatchObject({
    taskExecutionRef: currentTaskExecutionRef,
    reviewRound: currentReviewRound + 1,
  });
});

it("rejects an old-round PostToolUse without changing the new round", async () => {
  await terminalizeAndRetryCurrentAttempt();
  await consumeReviewCompletion(oldRoundPostToolUse);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(currentReviewCorrelation()).toMatchObject({ reviewRound: currentReviewRound + 1 });
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts`

Expected: FAIL because matching review completion has no composite terminal physical record or ordered Gate request.

- [ ] **Step 3: Implement the fixed protocol**

Implement this exact sequence: validate claimed parent binding; check
`artifactReservation.status === "usable"`; validate durable child-session binding; read the usable artifact
once; strictly parse `ReviewWorkerResultV1`; classify it before lifecycle work; calculate digest; commit
`ReviewCompletionStagingRecord`; append exactly one composite terminal
`ReviewDispatchTransitionRecord` containing consumption, the classification-matched artifact subtype, and
`claimed → terminal`; then project the terminal result.

For `completed`, durably record `review_pending → gate_pending` or `final_review_pending →
final_gate_pending` and request `evaluateGatePendingAttempt`. For `completed_with_findings`, durably
project direct `rework_required` / `final_rework_required` without calling Gate. For `review_incomplete`,
retain `review_pending` / `final_review_pending` as blocked without invoking Gate or auto-redispatching.
Task 3.4 terminalizes `review_execution_failed` and `lost_conclusive` before it creates their next-round
pending slot; those failure branches never call this artifact-consumption path. An `unusable` reservation
does no filesystem read, creates no `ReviewArtifactV1`, cannot terminalize as clean, does not invoke Gate,
and leaves mandatory Acceptance blocked while runtime task execution remains fail-open.

Do not add `appendBatch`: the composite terminal record is the existing single-append atomicity boundary.
Any mismatch in parent session, parent call ID, purpose, correlation, artifact ID, review round, child
session, task attempt, or finalization attempt returns a stale advisory without artifact I/O or state
mutation.

```ts
if (claim.artifactReservation.status === "unusable") return { kind: "blocked" };
const staging = await commitStaging(await validateAndReadMatchingArtifact(input));
const terminal = await appendTerminalRecord(staging);
if (terminal.kind !== "committed") return { kind: "blocked" };
await projectTerminalRecord(terminal);
switch (terminal.terminalReason) {
  case "completed":
    await recordGatePendingAndEvaluate(terminal.reviewArtifact);
    break;
  case "completed_with_findings":
    await recordDirectRework(terminal.correlation);
    break;
  case "review_incomplete":
    await recordBlockedReview(terminal.correlation);
    break;
}
await cleanupArtifact(staging.artifactConsumption.artifactId);
return { kind: "terminalized" };
```

Replace the `Promise.all` path for task PostToolUse in `JusticePlugin` with `runTaskPostToolUseSequentially`. Keep independent non-task handlers unchanged.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-artifact.ts src/core/session-state-provider.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts
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
  expect(updatePlanProgress(plan, task, blockedDecision)).toEqual({
    content: plan,
    updated: false,
  });
});

it("updates only an accepted task", () => {
  const result = updatePlanProgress(planWithThreeUncheckedSteps, task, acceptedDecision);
  expect(result.content).toContain("- [x] first");
  expect(result.content).toContain("- [x] second");
  expect(result.content).toContain("- [x] third");
  expect(new PlanParser().parse(result.content).find((item) => item.id === task.id)?.status).toBe(
    "completed",
  );
});

it("preserves checked steps and leaves every other task unchanged", () => {
  expect(
    updatePlanProgress(planWithOneCheckedStepAndAnotherTask, task, acceptedDecision).content,
  ).toEqual(expectedOnlyTargetChanged);
});

it("does not throw or change a zero-step accepted task", () => {
  expect(updatePlanProgress(planWithZeroStepTask, zeroStepTask, acceptedDecision)).toEqual({
    content: planWithZeroStepTask,
    updated: false,
  });
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

Return the input unchanged unless `decision.verdict === "accepted"` and its `taskExecutionRef.taskId` equals `task.id`. For an accepted non-empty task, update every unchecked step in source order with the existing `PlanParser.updateCheckbox()` operation; preserve already checked steps and never touch another task. A zero-step task follows existing parser semantics and returns deterministic unchanged/no-op. Remove direct `PlanParser.updateCheckbox()` calls from TaskFeedback success and failure paths. `JusticePlugin` invokes the updater only after Task 3.2 has durably recorded the accepted decision; `TaskFeedbackHandler` must not infer acceptance from worker success.

```ts
export function updatePlanProgress(
  content: string,
  task: PlanTask,
  decision: TaskAcceptanceDecision,
): ProgressUpdateResult {
  if (decision.verdict !== "accepted" || decision.taskExecutionRef.taskId !== task.id)
    return { content, updated: false };
  if (task.steps.length === 0) return { content, updated: false };
  const parser = new PlanParser();
  const updated = task.steps.reduce(
    (current, step) =>
      step.checked ? current : parser.updateCheckbox(current, step.lineNumber, true),
    content,
  );
  return { content: updated, updated: updated !== content };
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
  expect(
    createControllerRoutingDecision("brainstorming", "sisyphus", "workflow_rule").workflow,
  ).toBe("brainstorming");
  expect(
    createControllerRoutingDecision("writing-plans", "sisyphus", "workflow_rule").workflow,
  ).toBe("writing-plans");
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
  workflow: string,
  controller: ControllerAgent,
  reason: RoutingReason,
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
- Modify: `src/core/doctor-config.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Modify: `README.md`
- Modify: `SPEC.md`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`
- Test: `tests/core/justice-doctor-config.test.ts`
- Test: `tests/runtime/doctor-cli.test.ts`

**Consumes:** `ControllerRoutingDecision`; `evaluateControllerRoutingObservation`; `DoctorEffectiveConfigView.effectiveCommandDefinitions` from Task 1.2.

**Produces:** durable `controller_routing_observed` observation carrying workflow, desired controller,
actual controller, status, application method, and source;
`checkPinnedCommandPresence(commandDefinitions: ReadonlyMap<string, { readonly agent?: string }>):
PinnedCommandPresenceResult`; `justice doctor` output containing the complete missing, missing-agent, or
mismatched-agent pinned-command templates; README and release documentation describing the required
v4.0.0 configuration and its manual-install boundary.

- [ ] **Step 1: Write the failing runtime and doctor tests**

```ts
it("persists mismatch when the observed controller differs", async () => {
  await adapter.handleMessageUpdated(messageUpdatedFor("sisyphus"));
  expect(await readRoutingObservation()).toMatchObject({
    workflow: "subagent-driven-development",
    routingStatus: "mismatch",
  });
});

it("accepts each required pinned command with its expected agent", () => {
  const definitions = new Map(
    Object.entries(REQUIRED_PINNED_COMMAND_AGENTS).map(
      ([name, agent]) => [name, { agent }] as const,
    ),
  );
  expect(checkPinnedCommandPresence(definitions)).toEqual({ ok: true, diagnostics: [] });
});

it.each([
  ["missing command", new Map(), "missing"],
  ["missing agent", new Map([["justice-implement-brainstorming", {}]]), "missing_agent"],
  [
    "wrong agent without raw configuration leakage",
    new Map([
      [
        "justice-implement-brainstorming",
        { agent: "atlas", template: "secret-template", token: "secret-value" },
      ],
    ]),
    "mismatched_agent",
  ],
] as const)("reports %s without copying raw command configuration", (_name, definitions, kind) => {
  const result = checkPinnedCommandPresence(definitions);
  expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ kind })] });
  expect(JSON.stringify(result)).not.toContain("template");
  expect(JSON.stringify(result)).not.toContain("secret-value");
});

it("rejects a higher-priority source that replaces a correct agent with a wrong agent", () => {
  const effective = buildDoctorEffectiveConfigView([
    scanConfigText(
      "global",
      '{ command: { "justice-implement-brainstorming": { agent: "sisyphus" } } }',
    ),
    scanConfigText(
      "project",
      '{ command: { "justice-implement-brainstorming": { agent: "atlas" } } }',
    ),
  ]);
  expect(
    checkPinnedCommandPresence(effective.effectiveCommandDefinitions).diagnostics,
  ).toContainEqual(
    expect.objectContaining({
      kind: "mismatched_agent",
      expectedAgent: "sisyphus",
      actualAgent: "atlas",
    }),
  );
});

it("accepts a higher-priority source that replaces a wrong agent with the expected agent", () => {
  const effective = buildDoctorEffectiveConfigView([
    scanConfigText(
      "global",
      '{ command: { "justice-implement-brainstorming": { agent: "atlas" } } }',
    ),
    scanConfigText(
      "project",
      '{ command: { "justice-implement-brainstorming": { agent: "sisyphus" } } }',
    ),
  ]);
  expect(
    checkPinnedCommandPresence(effective.effectiveCommandDefinitions).diagnostics,
  ).not.toContainEqual(expect.objectContaining({ commandName: "justice-implement-brainstorming" }));
});

it("renders the expected agent for every diagnostic template", () => {
  expect(
    formatPinnedCommandTemplates([
      {
        kind: "mismatched_agent",
        commandName: "justice-implement-brainstorming",
        expectedAgent: "sisyphus",
        actualAgent: "atlas",
      },
    ]),
  ).toContain('"agent": "sisyphus"');
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/core/justice-doctor-config.test.ts tests/runtime/doctor-cli.test.ts`

Expected: FAIL because routing observations and pinned-command diagnostics are absent.

- [ ] **Step 3: Implement observation and diagnostics**

Translate `chat.params` and finalized `message.updated` agent values through the existing adapter event path.
Have ObservationHandler append the typed routing observation after evaluating the desired decision. Do not make a
routing mismatch block execution. In `doctor-categories.ts`, define the exact P0 mapping:
`justice-implement-brainstorming`, `justice-implement-writing-plans`, and
`justice-implement-executing-plans` require `sisyphus`; `justice-implement-subagent-driven-development`
requires `atlas`. Consume only `DoctorEffectiveConfigView.effectiveCommandDefinitions`; a name-only checker
is forbidden. For every required entry, emit exactly one diagnostic discriminant:
`{ kind: "missing"; commandName; expectedAgent }`, `{ kind: "missing_agent"; commandName;
expectedAgent }`, or `{ kind: "mismatched_agent"; commandName; expectedAgent; actualAgent }`.
`PinnedCommandPresenceResult` is `{ readonly ok: boolean; readonly diagnostics: readonly
PinnedCommandDiagnostic[] }` and contains neither raw command objects nor configuration values other than
the agent necessary for the comparison. Format every diagnostic as a complete corrected `command` object
with `template`, `description`, and that diagnostic's `expectedAgent`; exit non-zero. Do not parse a second
configuration path or union source names. Document the same four command definitions and the v4.0.0
migration in `README.md` and `SPEC.md`; state that users register the commands and Justice only observes the
result.

```ts
export const REQUIRED_PINNED_COMMAND_AGENTS = {
  "justice-implement-brainstorming": "sisyphus",
  "justice-implement-writing-plans": "sisyphus",
  "justice-implement-subagent-driven-development": "atlas",
  "justice-implement-executing-plans": "sisyphus",
} as const;

export function checkPinnedCommandPresence(
  commandDefinitions: ReadonlyMap<string, { readonly agent?: string }>,
): PinnedCommandPresenceResult {
  const diagnostics = Object.entries(REQUIRED_PINNED_COMMAND_AGENTS).flatMap(
    ([commandName, expectedAgent]) => {
      const definition = commandDefinitions.get(commandName);
      if (definition === undefined) return [{ kind: "missing", commandName, expectedAgent }];
      if (definition.agent === undefined)
        return [{ kind: "missing_agent", commandName, expectedAgent }];
      return definition.agent === expectedAgent
        ? []
        : [{ kind: "mismatched_agent", commandName, expectedAgent, actualAgent: definition.agent }];
    },
  );
  return { ok: diagnostics.length === 0, diagnostics };
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/core/justice-doctor-config.test.ts tests/runtime/doctor-cli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/runtime/opencode-adapter.ts src/hooks/observation-handler.ts src/core/doctor-categories.ts src/core/doctor-config.ts src/runtime/doctor-cli.ts README.md SPEC.md tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/core/justice-doctor-config.test.ts tests/runtime/doctor-cli.test.ts
git commit -m "feat: controller routing observationとdoctor診断を追加"
```

---

## Traceability and Definition of Done

<!-- markdownlint-disable MD013 MD060 -->

| Requirement / Design Decision                                  | Plan Task               | Required tests                                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JUS-P0-01 controller workflow identity and runtime observation | 4.1, 4.2                | routing decision, applied, mismatch, effective pinned-command precedence, template output                                                                                              |
| pinned command name + agent validation                         | 4.2                     | correct agent, missing command, missing agent, mismatched agent, higher-priority replacement in both directions, expected-agent template, raw-config redaction                         |
| JUS-P0-02 semantic fingerprint and canonical snapshot          | 2.1, 2.2                | semantic mutation, snapshot persistence, hydration, fresh reapproval ID, terminal merge protection                                                                                     |
| authorization cardinality                                      | 2.2                     | same-session A→B atomic supersession, durable `plan_superseded`, exactly one active binding, old authorization rejection, other-session isolation, failed save retains authority/cache |
| JUS-P0-02 session-scoped cancel                                | 2.3                     | pathless parser, invalid flag combinations, durable release, no-binding idempotence                                                                                                    |
| JUS-P0-03 seven-to-seven category mapping                      | 1.1                     | every role, legacy downgrade rejection                                                                                                                                                 |
| JUS-P0-03 doctor effective category configuration              | 1.2                     | JSONC parsing, source precedence, missing category, unreadable/unsupported source, redaction                                                                                           |
| JUS-P0-04 task lifecycle                                       | 3.1                     | full `authorized → in_progress → worker_reported → evidence_pending → review_pending` trace, fresh attempt, restart reconstruction                                                     |
| JUS-P0-04 attempt-scoped Evidence / Review / Gate              | 3.1, 3.2, 3.4, 3.5, 3.6 | stale attempt/call/child/artifact rejection, reviewRound reset on rework                                                                                                               |
| artifact reservation anti-replay                               | 3.4                     | safe path, collision retry with fresh UUID, bounded collision exhaustion, exists/directory I/O failure, invalid path, internal failure, unusable durable reservation and advisory      |
| unusable reservation blocks Acceptance                         | 3.4, 3.6                | fail-open review task execution, worker input without artifact path, no filesystem read or ReviewArtifact, blocked Acceptance                                                          |
| concurrent review claim                                        | 3.4                     | simultaneous same-parent claims yield exactly one claimed transition, binding, reservation, and authoritative call/artifact identity                                                   |
| JUS-P0-04 review terminal atomicity                            | 3.6                     | one terminal physical record, failed append has no partial projection, deterministic replay, no pre-terminal acceptance                                                                |
| terminal artifact classification                               | 3.6                     | clean → `completed`/Gate, findings → `completed_with_findings`/direct rework, incomplete → `review_incomplete`/blocked                                                                 |
| review failure retry                                           | 3.4, 3.6                | reviewer execution and transport failure terminalize, retain the TaskExecutionRef, and issue `reviewRound + 1`                                                                         |
| conclusive loss recovery                                       | 3.4, 3.6                | `lost_conclusive` terminalization occurs before a new round                                                                                                                            |
| uncertain claimed recovery                                     | 3.4, 3.6                | no automatic redispatch, artifact read, or Acceptance after restart                                                                                                                    |
| JUS-P0-04 Gate after `gate_pending`                            | 3.1, 3.2, 3.6           | no early evaluation, terminal review before gate_pending, GateDecision before AcceptanceDecision, unavailable/error blocked                                                            |
| JUS-P0-04 finalization lifecycle                               | 3.1, 3.2, 3.4, 3.5, 3.6 | fresh finalization attempt, final review terminalization, Final Gate PASS/rework/blocked                                                                                               |
| JUS-P0-04 durable review dispatch and child correlation        | 3.3, 3.4, 3.5           | runtime spike, pending/claimed recovery, parent-session critical section, concurrent claim, durable child binding                                                                      |
| JUS-P0-04 accepted task progress                               | 3.7                     | all unchecked steps checked, reparse completed, other tasks unchanged, zero-step no-op, durable acceptance ordering                                                                    |
| JSON review transport fixed for P0                             | 3.4, 3.6                | reservation anti-replay, unusable fail-open/blocked path, one usable-path read, composite terminal record; no typed transport dependency                                               |
| INV-01 through INV-05                                          | 1.1, 2.1, 2.2, 4.1      | category/routing/fingerprint/authorization focused tests named in those tasks                                                                                                          |
| INV-06 through INV-10                                          | 3.1, 3.2, 3.6, 3.7      | lifecycle, Gate, terminalization, progress, Final Gate tests named in those tasks                                                                                                      |
| INV-11 through INV-18                                          | 3.3, 3.4, 3.5, 3.6      | purpose separation, claim, restart, correlation, stale-event and consumption tests named in those tasks                                                                                |

| Plan Task | Requirement / Design Decision implemented                                  | Verification                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1       | JUS-P0-03, Design §5.3, INV-02, INV-05                                     | role-to-category mapping tests                                                                                                                                                     |
| 1.2       | JUS-P0-03, Design §3.4 and §5.3                                            | effective configuration and category-presence tests                                                                                                                                |
| 2.1       | JUS-P0-02, Design §4.3, INV-04                                             | fingerprint boundary tests                                                                                                                                                         |
| 2.2       | JUS-P0-02, Design §4.2 and §5.2, INV-03, INV-12, authorization cardinality | authorization persistence, fresh ID, terminal merge, atomic supersession, exactly-one-active, failed-save cache-retention tests                                                    |
| 2.3       | JUS-P0-02, Design §4.2 and §5.2                                            | pathless cancel parser and durable release tests                                                                                                                                   |
| 3.1       | JUS-P0-04, Design §3.3, §4.4, §5.4, INV-06, INV-09, INV-14                 | lifecycle orchestration and finalization tests                                                                                                                                     |
| 3.2       | JUS-P0-04, Design §4.6 and §4.11, INV-07, INV-08, INV-10, INV-14           | gate-pending-only, decision ordering, blocked tests                                                                                                                                |
| 3.3       | JUS-P0-04, Design §4.9, INV-15                                             | child-session runtime spike                                                                                                                                                        |
| 3.4       | JUS-P0-04, Design §4.8, §4.8.1, §4.8.2, §4.10, INV-11, INV-16, INV-17      | parent-session critical section, concurrent claim, reservation collision/I/O/unusable, conclusive-loss and uncertain-claim recovery tests                                          |
| 3.5       | JUS-P0-04, Design §4.9, INV-14, INV-15, INV-17, INV-18                     | durable child-binding tests                                                                                                                                                        |
| 3.6       | JUS-P0-04, Design §4.5, §4.8.1, §4.10, §4.11, INV-13 through INV-18        | unusable no-read blocked path, terminal subtype classification, clean Gate, direct findings rework, incomplete blocking, same-attempt retry, composite terminal/replay/stale tests |
| 3.7       | JUS-P0-04, Design §3.3 and §5.4, INV-06, INV-08                            | accepted-only full progress update tests                                                                                                                                           |
| 4.1       | JUS-P0-01, Design §4.1, INV-01                                             | controller routing tests                                                                                                                                                           |
| 4.2       | JUS-P0-01, Design §3.4, §3.5, and §5.1                                     | effective pinned-command name-and-agent, precedence, redaction, template, and routing-observation tests                                                                            |

Phase 3 is incomplete if Task 3.3 cannot demonstrate both mandatory review correlations. It is incomplete if lifecycle orchestration, synchronous mandatory review canonicalization, parent-session claim serialization, concurrent exactly-one claim, usable and unusable reservation branches, durable child binding, terminal classification, composite terminal record, staging recovery, stale-event rejection, conclusive-loss recovery, uncertain-claimed blocking, attempt-scoped Gate/Acceptance, task Gate, Final Gate, or accepted-task progress lacks a passing automated test. A known runtime limitation documents an observation only; it never waives a P0 completion criterion.

<!-- markdownlint-enable MD013 MD060 -->

Before implementation handoff, inspect every implementation step for unresolved placeholders, ambiguous file paths, and unbound requirements. Verify that every test file in a Task's Files list appears in that Task's RED and GREEN command and its `git add` scope. Verify that every table row names an exact Task and RED/GREEN test, and that every Task row names its Design decision and Requirement. Do not hand off a plan with undefined work, implied test coverage, cross-task shorthand, or an atomicity statement without its exclusion mechanism.
