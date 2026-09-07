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
Promise<boolean>`; `AuthorizationStore.hydrate(): Promise<readonly ApprovedPlanBinding[]>`;
`AuthorizationStore.findByAuthorizationId(authorizationId): Promise<ApprovedPlanBinding | null>`; and the
domain-private `mergeAuthorizationBindings(mine: ReadonlyArray<ApprovedPlanBinding>,
theirs: ReadonlyArray<ApprovedPlanBinding>): ReadonlyArray<ApprovedPlanBinding>` used only as this
store's `AtomicPersistence.merge` hook. It is exported from this source module only so its array
contract can be tested; it is not re-exported by a package barrel and is not a public Justice API.

- [ ] **Step 1: Write the failing persistence and hydration tests**

```ts
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value?: T) => void } {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve: (value) => resolve?.(value as T) };
}

const authorizationAtomic = new AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>(files, files, {
  filePath: ".justice/authorizations.json",
  conflictPath: ".justice/authorizations.conflict.json",
  serialize: (bindings) => JSON.stringify(bindings),
  deserialize: (raw) => JSON.parse(raw) as ReadonlyArray<ApprovedPlanBinding>,
  merge: mergeAuthorizationBindings,
  emptyValue: () => [],
});

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

it("reads a durable authorization by identity without treating a missing binding as active", async () => {
  const binding = await store.approve(input);
  await expect(store.findByAuthorizationId(binding!.authorizationId)).resolves.toEqual(binding);
  await expect(store.findByAuthorizationId("missing")).resolves.toBeNull();
});

it("generates a fresh authorizationId on reapproval", async () => {
  const oldBinding = await store.approve(input);
  await store.release(oldBinding!.authorizationId, "2026-09-05T00:00:00.000Z");
  const newBinding = await store.approve(input);
  expect(newBinding!.authorizationId).not.toBe(oldBinding!.authorizationId);
});

it("never lets a stale active merge overwrite the same terminal authorizationId", () => {
  expect(mergeAuthorizationBindings([staleActive], [releasedBinding])).toEqual([
    releasedBinding,
  ]);
});

it("preserves authorization cardinality through AtomicPersistence initial merge", async () => {
  await files.writeFile(
    ".justice/authorizations.json",
    JSON.stringify({ version: 4, data: [oldActiveBinding] }),
  );
  await authorizationAtomic.saveAtomicWithLock([
    invalidateSuperseded(oldActiveBinding),
    freshBindingFor("s1", "docs/new.md", "new-id"),
  ]);
  const durable = (await authorizationAtomic.loadWithLock()).data;

  expect(durable.filter((binding) => binding.sessionId === "s1" && binding.status === "active")).toHaveLength(1);
  expect(durable.find((binding) => binding.authorizationId === oldActiveBinding.authorizationId)).toMatchObject({
    status: "invalidated",
    invalidationReason: "plan_superseded",
  });
});

it("keeps one active binding when a version-conflicted fresh approval retries", async () => {
  const firstTwoLinkAttempts = deferred<void>();
  let coordinateContenders = false;
  let linkAttempts = 0;
  const files = new MockFileSystem();
  const originalLink = files.link.bind(files);
  files.link = async (target, claimPath) => {
    if (!coordinateContenders) return originalLink(target, claimPath);
    linkAttempts += 1;
    if (linkAttempts <= 2) {
      if (linkAttempts === 2) firstTwoLinkAttempts.resolve();
      await firstTwoLinkAttempts.promise;
    }
    await originalLink(target, claimPath);
  };
  const store = new AuthorizationStore(files, files);

  const old = await store.approve(inputFor("s1", "docs/old.md"));
  const other = await store.approve(inputFor("s2", "docs/other.md"));
  coordinateContenders = true;
  linkAttempts = 0;
  const approvalA = store.approve(inputFor("s1", "docs/a.md"));
  const approvalB = store.approve(inputFor("s1", "docs/b.md"));
  await firstTwoLinkAttempts.promise;
  const [a, b] = await Promise.all([approvalA, approvalB]);
  const durable = await store.hydrate();
  const active = durable.filter((binding) => binding.sessionId === "s1" && binding.status === "active");

  expect([a, b].filter((binding) => binding !== null)).toHaveLength(2);
  expect(linkAttempts).toBeGreaterThanOrEqual(3);
  expect(active).toHaveLength(1);
  expect(durable.filter((binding) => binding.sessionId === "s1" && binding.status !== "active")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ authorizationId: old?.authorizationId, status: "invalidated", invalidationReason: "plan_superseded" }),
    ]),
  );
  expect(
    durable.filter(
      (binding) =>
        (binding.authorizationId === a?.authorizationId || binding.authorizationId === b?.authorizationId) &&
        binding.status === "active",
    ),
  ).toHaveLength(1);
  expect(
    durable.filter(
      (binding) =>
        (binding.authorizationId === a?.authorizationId || binding.authorizationId === b?.authorizationId) &&
        binding.status === "invalidated",
    ),
  ).toEqual([expect.objectContaining({ invalidationReason: "plan_superseded" })]);
  expect(durable.find((binding) => binding.authorizationId === other?.authorizationId)).toMatchObject({ status: "active" });
  expect(bridge.activePlanFor("s1")).toBe(active[0]?.planPath);
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

Expected: FAIL because authorization persistence, hydration, and terminal-dominant array merge do not exist; after the import resolves, the terminal-dominance assertion fails until the merge implementation is added.

- [ ] **Step 3: Implement the authorization store**

Use exactly `.justice/authorizations.json` and `.justice/authorizations.conflict.json` as the
`AtomicPersistence` paths. Store only `ReadonlyArray<ApprovedPlanBinding>`. `ApprovePlanInput` must not
accept a caller-provided authorizationId. For approval, load the authoritative array and construct one
replacement array: map only same-session active bindings to `{ status: "invalidated", invalidatedAt,
invalidationReason: "plan_superseded" }`, retain every terminal and other-session binding, then append one
fresh active binding. Submit that complete array and the loaded `LockMetadata` through one
`AtomicPersistence.saveAtomicWithLock` call. Promote the result to the authorization cache and `PlanBridge`
only if the result is `saved`; on an exception or `conflict_diverted`, return `null`, retain the prior cache,
and leave enrichment unauthorized. On plugin initialization, hydrate active bindings and restore their
`planPath` into `PlanBridge`; if the file cannot be read, no binding is active. Do not add a transaction
framework. `findByAuthorizationId` reads only the authoritative binding array and returns the exact matching
binding or `null`; callers treat `null`, a read failure, or a persistence conflict as non-active. It must never
read `.justice/authorizations.conflict.json` or infer authority from the active-plan cache.

The `AtomicPersistence.merge` hook must merge the entire binding array, not only two records. It is used both
by `saveAtomicWithLock(candidate)` when no `LockMetadata` is supplied and by its version-mismatch retry.
`mine` is the approval candidate being retried and `theirs` is the latest durable array. `mergeSameAuthorizationId` returns
terminal. `invalidateSuperseded` creates only the Design §4.2 invalidated shape. A fresh active candidate is
an active `mine` record absent from `theirs`; the normal approve path creates exactly one per session. After
same-ID merging, choose that candidate for its session, invalidate every other active binding in that session,
and retain all other-session bindings unchanged. This makes the candidate that wins the authoritative retry
the sole active binding without modifying `AtomicPersistence` itself.

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

export function mergeAuthorizationBindings(
  mine: ReadonlyArray<ApprovedPlanBinding>,
  theirs: ReadonlyArray<ApprovedPlanBinding>,
): ReadonlyArray<ApprovedPlanBinding> {
  const theirsById = new Map(theirs.map((binding) => [binding.authorizationId, binding]));
  const merged = new Map(theirsById);
  for (const candidate of mine) {
    const durable = merged.get(candidate.authorizationId);
    merged.set(
      candidate.authorizationId,
      durable === undefined ? candidate : mergeSameAuthorizationId(candidate, durable),
    );
  }

  const freshCandidates = mine.filter(
    (binding): binding is Extract<ApprovedPlanBinding, { readonly status: "active" }> =>
      binding.status === "active" && !theirsById.has(binding.authorizationId),
  );
  for (const sessionId of new Set(freshCandidates.map((binding) => binding.sessionId))) {
    const winner = freshCandidates
      .filter((binding) => binding.sessionId === sessionId)
      .sort(
        (left, right) =>
          right.approvedAt.localeCompare(left.approvedAt) ||
          left.authorizationId.localeCompare(right.authorizationId),
      )[0];
    if (winner === undefined) continue;
    for (const binding of merged.values()) {
      if (
        binding.sessionId === sessionId &&
        binding.status === "active" &&
        binding.authorizationId !== winner.authorizationId
      ) {
        merged.set(binding.authorizationId, invalidateSuperseded(binding));
      }
    }
  }
  return [...merged.values()];
}

function mergeSameAuthorizationId(
  mine: ApprovedPlanBinding,
  theirs: ApprovedPlanBinding,
): ApprovedPlanBinding {
  if (mine.status === "active") return theirs.status === "active" ? mine : theirs;
  if (theirs.status === "active") return mine;
  return terminalTimestamp(mine).localeCompare(terminalTimestamp(theirs)) >= 0 ? mine : theirs;
}

function terminalTimestamp(
  binding: Exclude<ApprovedPlanBinding, { readonly status: "active" }>,
): string {
  return binding.status === "invalidated" ? binding.invalidatedAt : binding.releasedAt;
}

function invalidateSuperseded(
  binding: Extract<ApprovedPlanBinding, { readonly status: "active" }>,
): ApprovedPlanBinding {
  return {
    ...binding,
    status: "invalidated",
    invalidatedAt: new Date().toISOString(),
    invalidationReason: "plan_superseded",
  };
}
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

**Requirement:** JUS-P0-02, Design §4.8.1 and §5.2.

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

Accept exactly one of `--approved` and `--cancel`. Approve requires exactly one safe `--plan`; cancel forbids `--plan`. Reject both flags, duplicate flags, missing approve plan, and unsafe paths. In `PlanBridge.handleImplementationArm`, branch on `action` before resolving a plan path. For cancel, resolve only the current session's single active binding, persist `active -> released`, and clear the active plan cache only after durable success. With no active binding, return the deterministic non-armed no-op result without persistence I/O. After either successful release or no-op, later `handlePreToolUse` returns the existing unauthorized advisory. Task 2.3 owns parsing and durable Authorization release only. Task 3.4 is the sole owner of connecting successful terminalization, and fingerprint-driven invalidation, to the existing Review Dispatch `cancelled` transition after that module exists; it must not be anticipated here with a Phase 3 dependency or a second cancellation mechanism.

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

**Produces:** `TransitionOutcome = { readonly kind: "applied" | "duplicate" | "invalid"; readonly state: TaskProgressState | PlanFinalizationState; readonly advisory?: string }`; `applyTaskTransition`; `applyPlanTransition`; `startImplementationAttempt`; `recordWorkerReportedAndEvidence`; `requestCurrentTaskReview`; `advanceFinalizationAfterAllTasksAccepted`; `FinalizationContext`; and `startNextFinalizationAttempt(current: FinalizationContext): PlanFinalizationTransitionRecord`.

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

it("keeps the finalization identity for review-only retry and rotates it only for actual rework", async () => {
  const initial = await advanceFinalizationAfterAllTasksAccepted(binding);
  const reviewRetry = project(finalReviewFailureThenRetryRecords, now).currentFinalization();
  const rework = await startNextFinalizationAttempt(initial);

  expect(reviewRetry.finalizationAttemptId).toBe(initial.finalizationAttemptId);
  expect(reviewRetry.finalReviewRound).toBe(initial.finalReviewRound + 1);
  expect(reviewRetry.state).toBe("final_review_pending");
  expect(rework.finalizationAttemptId).not.toBe(initial.finalizationAttemptId);
  expect(rework.finalReviewRound).toBe(initial.finalReviewRound + 1);
  expect(rework.from).toBe("final_rework_required");
  expect(rework.to).toBe("final_review_pending");
});

it("replays the current final-review retry correlation and rejects its old round", () => {
  const projected = project(finalReviewFailureThenRetryRecords, now);
  expect(projected.currentFinalization()).toMatchObject({
    finalizationAttemptId: "final-1",
    finalReviewRound: 2,
    state: "final_review_pending",
  });
  expect(projected.finalGateInputFor(oldFinalReviewCorrelation)).toBeUndefined();
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-lifecycle.test.ts tests/core/session-state-provider.test.ts`

Expected: FAIL because lifecycle projection and runtime orchestration are absent.

- [ ] **Step 3: Implement non-throwing transition outcomes**

Encode every lifecycle record in `observation-model.ts` with its task execution reference or finalization identity. Make duplicate identity leave state unchanged. Make illegal transitions leave state unchanged and emit an advisory record in the projection result. Do not throw from the projector for either case. Derive `all_tasks_accepted` from `ApprovedPlanBinding.canonicalSnapshot.tasks.map(task => task.taskId)`.

In the sequential `JusticePlugin` path, select the authorized current task, issue a fresh attemptId only when starting implementation, durably record `authorized → in_progress`, and persist the implementation call binding before accepting its PostToolUse as authoritative. Matching PostToolUse records `worker_reported`, then observed/derived evidence scoped to that same ref, then `evidence_pending → review_pending`; it emits a current-attempt `ReviewRequiredDirective` only after Task 3.4 has committed its pending dispatch slot. Old-attempt records are advisory-only. On all accepted snapshot task IDs, create the current finalization attempt and durably enter `final_review_pending`. A review-only failure writes no plan lifecycle transition: Task 3.4 first terminalizes the failure, then appends a new final-review pending slot with the same `finalizationAttemptId` and incremented `finalReviewRound`. `startNextFinalizationAttempt` is reserved for actual `final_rework_required → final_review_pending` and writes the fresh identity transition. Do not evaluate a Gate in this task; Task 3.2 receives only projected `gate_pending` / `final_gate_pending` states after Task 3.6 terminalization.

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

type FinalizationContext = {
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
  readonly state: PlanFinalizationState;
};

function startNextFinalizationAttempt(
  current: FinalizationContext,
): PlanFinalizationTransitionRecord {
  return {
    recordType: "observation",
    kind: "plan_finalization_transition",
    planPath: current.planPath,
    authorizationId: current.authorizationId,
    finalizationAttemptId: randomUUID(),
    finalReviewRound: current.finalReviewRound + 1,
    from: "final_rework_required",
    to: "final_review_pending",
    reason: "finalization_rework",
  };
}
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

**Requirement:** JUS-P0-02, JUS-P0-04, INV-08, INV-09, INV-14, INV-19.

**Files:**

- Create: `src/core/acceptance-decision.ts`
- Modify: `src/core/v2/gate-definition.ts`
- Modify: `src/core/v2/gate-context.ts`
- Modify: `src/core/v2/rule-evaluation-engine.ts`
- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/core/v2/rule-evaluation-engine.test.ts`
- Create: `tests/core/acceptance-decision.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`

**Consumes:** `GateScope = "task" | "plan"`; `GateTrigger`; current projected lifecycle state from Task 3.1; `AuthorizationStore.findByAuthorizationId` for the gate correlation's authorizationId.

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

it.each(["released", "invalidated", "missing", "uncertain"] as const)(
  "does not invoke Gate or append accepted/complete for a %s authorization",
  async (status) => {
    await evaluateGatePendingAttempt(gatePendingContextForAuthorization(status));
    expect(evaluate).not.toHaveBeenCalled();
    expect(recordAcceptanceDecision).not.toHaveBeenCalled();
    expect(projectedTaskState()).toBe("gate_pending");
  },
);

it("rechecks authorization after Gate evaluation and before Acceptance append", async () => {
  releaseAuthorizationAfterGateEvaluation();
  await evaluateGatePendingAttempt(gatePendingContext);
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
  expect(projectedTaskState()).toBe("gate_pending");
});

it("does not append duplicate GateDecision or AcceptanceDecision when recovery revisits the current gate_pending identity", async () => {
  await arrangeCurrentGatePendingWithDurableGateAndAcceptance(gatePendingContext);
  await evaluateGatePendingAttempt(gatePendingContext);

  expect(recordGateDecision).not.toHaveBeenCalled();
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
});

it("resumes exactly one missing Gate evaluation after a durable gate_pending transition", async () => {
  await arrangeCurrentGatePendingWithoutGateDecision(gatePendingContext);
  await evaluateGatePendingAttempt(gatePendingContext);
  await evaluateGatePendingAttempt(gatePendingContext);

  expect(recordGateDecision).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
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

Define `GateRule.gateType` as `"task" | "plan"`. Define task triggers as `task_complete | tool_observed` and the plan trigger as `final_review_complete`. `evaluateGatePendingAttempt` must first read the durable projection and refuse to invoke `evaluate` unless its current lifecycle is `gate_pending` or `final_gate_pending` and the matching terminal review record is projected. It must then inspect the same current identity for an existing durable GateDecision and its derived AcceptanceDecision: an existing decision is reused as the authoritative result and neither record is appended again; a missing GateDecision is evaluated and appended once; a GateDecision with no derived AcceptanceDecision derives and appends that decision once. Before invocation, resolve the correlation's authorizationId from the task execution ref or finalization identity and require the durable `AuthorizationStore` binding to be current `active`; released, invalidated, missing, unreadable, conflict-diverted, or otherwise uncertain bindings return a blocked / stale advisory without a GateDecision. After evaluation and immediately before the GateDecision-derived AcceptanceDecision append, re-read that durable binding and apply the same guard. Append a current-attempt GateDecision before deriving and durably recording the matching AcceptanceDecision. Map PASS to `accepted` / `complete`, WARN and FAIL to `rework_required` / `final_rework_required`, and errors, SKIP, or insufficient evidence to blocked while preserving `gate_pending` / `final_gate_pending`. A terminality race after Gate evaluation must not append `accepted` or `complete`.

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

**Requirement:** JUS-P0-02, JUS-P0-04, INV-11, INV-16, INV-17, INV-19, Design §4.8, §4.8.1, §4.8.2, and §4.10.

**Files:**

- Create: `src/core/review-dispatch-state.ts`
- Create: `src/core/review-artifact-reservation.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/review-dispatch-state.test.ts`
- Test: `tests/core/review-artifact-reservation.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`
- Test: `tests/hooks/plan-bridge-authorization.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

**Consumes:** current `TaskExecutionRef` or finalization identity; `ReviewCorrelation`; review
`TaskCallPurpose`; durable `PersistedLogRecord` read/append and projection; `FileReader.fileExists`;
`FileWriter.mkdir`; safe-relative-path validation; `AuthorizationStore.findByAuthorizationId`.

**Produces:** `ReviewRequiredDirective`; durable `null -> pending` and `pending -> claimed` records;
`TaskCallBinding`; Design §4.10 `ReviewArtifactReservation`; `claimReviewDispatch(input):
Promise<ClaimReviewDispatchOutcome>`; `projectReviewDispatchSlots(records)`; and an in-memory cache
reconstructed only from the durable projection. `ClaimReviewDispatchOutcome` is either `{ readonly kind:
"claimed"; readonly taskCallBinding: TaskCallBinding }` or `{ readonly kind: "blocked"; readonly
advisory: string }`; a blocked outcome exposes neither `callId` nor `artifactId` as authority.
`serializeParentSessionClaim<T>(parentSessionId: string, operation: () => Promise<T>): Promise<T>` is a
module-private, parent-session keyed queue helper. `terminalizeReviewFailure(claim: ClaimedReviewDispatch,
reason: "review_execution_failed" | "lost_conclusive"): Promise<ReviewFailureOutcome>` appends the terminal
record and delegates retry-pending recovery to `ensureReviewRetryPendingAfterTerminalFailure`. The
module-private `nextReviewRetryCorrelation(correlation: ReviewCorrelation): ReviewCorrelation` and
`ensureReviewRetryPendingAfterTerminalFailure(terminal: RetryableTerminalFailure):
Promise<ReviewFailureOutcome>` and `recoverReviewDispatchesAfterRestart(): Promise<void>` operate only in the
ReviewDispatch domain; no generic retry, recovery, transaction, lock, or CAS abstraction is added. The
module-private `isCurrentActiveAuthorization(correlation: ReviewCorrelation): Promise<boolean>`,
`authorizationIdFor(correlation: ReviewCorrelation): string`, and
`hydrateAuthorizationsBeforeReviewRecovery(): Promise<void>` perform only the durable Authorization check needed
by this domain. The module-exported, Review Dispatch-specific
`cancelReviewDispatchesForTerminalAuthorization(parentSessionId, authorizationId): Promise<void>` is the public
queue-acquiring wrapper for PlanBridge, fingerprint invalidation, and startup entry points. Its module-private
`cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(parentSessionId, authorizationId):
Promise<void>` counterpart never acquires the queue and is callable only while the caller already owns that
parent-session critical section. It reads the latest durable projection, best-effort appends `cancelled` only for
the current pending or claimed slot of that authorization, and treats an existing terminal slot as a no-op. These
are the only cancellation helpers; callers must not choose lock behavior dynamically. The public wrapper is called
after Task 2.3 has committed a cancel or the fingerprint check has committed invalidation; queue-owning claim,
failure, retry, and recovery operations call the within-parent helper directly.

- [ ] **Step 1: Write the failing dispatch, claim, and recovery tests**

```ts
it("commits pending before injecting exactly one review directive", async () => {
  await requestMandatoryReview(taskExecutionRef);
  expect(trace).toEqual(["commit-pending", "inject-review-directive"]);
});

it("defers a second same-parent review until the outstanding slot terminalizes", async () => {
  await requestMandatoryReview(firstTaskReviewCorrelation);
  await requestMandatoryReview(secondTaskReviewCorrelation);

  expect(durableTransitions(null, "pending")).toHaveLength(1);
  expect(injectedReviewDirectives()).toEqual([
    { kind: "review_required", correlation: firstTaskReviewCorrelation },
  ]);

  await terminalizeCompletedReview(firstTaskReviewCorrelation);
  await requestMandatoryReview(secondTaskReviewCorrelation);
  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
});

it("does not create a retry pending while another same-parent review is outstanding", async () => {
  await arrangeRetryableTerminalWithoutNextPending(firstClaim, "lost_conclusive");
  await arrangeCurrentPendingReviewFor(secondTaskReviewCorrelation);

  await expect(ensureReviewRetryPendingAfterTerminalFailure(firstTerminal)).resolves.toEqual({
    kind: "blocked",
  });
  expect(durableTransitions(null, "pending", nextReviewRetryCorrelation(firstClaim.correlation))).toHaveLength(0);
  expect(injectedReviewDirectives()).toEqual([]);
});

it.each(["released", "invalidated", "missing", "uncertain"] as const)(
  "does not create or inject a review directive for a %s authorization",
  async (status) => {
    await requestMandatoryReview(taskExecutionRefForAuthorization(status));
    await recoverReviewDispatchesAfterRestart();
    expect(durableTransitions(null, "pending")).toEqual([]);
    expect(injectedReviewDirectives()).toEqual([]);
  },
);

it("cancels the current pending slot after durable explicit cancel and never reissues it", async () => {
  await arrangeCurrentPendingReview(activeAuthorization);
  await bridge.handleImplementationArm("s1", cancelRequest);
  expect(trace).toEqual(["authorization-released", "review-cancelled"]);
  restartReviewDispatchRepository();
  await recoverReviewDispatchesAfterRestart();
  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({ kind: "blocked" });
  expect(injectedReviewDirectives()).toEqual([]);
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
  expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
});

it("keeps acceptance fail-closed when cancellation tombstone append fails", async () => {
  await arrangeCurrentPendingReview(activeAuthorization);
  failNextCancellationTombstoneAppend();
  await bridge.handleImplementationArm("s1", cancelRequest);
  expect(durableAuthorization()).toMatchObject({ status: "released" });
  restartReviewDispatchRepository();
  await recoverReviewDispatchesAfterRestart();
  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({ kind: "blocked" });
  expect(injectedReviewDirectives()).toEqual([]);
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
  await recoverReviewDispatchesAfterRestart();
  expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
});

it.each(["review_execution_failed", "lost_conclusive"] as const)(
  "does not create a retry pending or directive when a retryable %s terminal outlives its authorization",
  async (reason) => {
    await arrangeRetryableTerminalWithoutNextPending(currentClaim, reason);
    releaseAuthorization(currentAuthorizationId);
    restartReviewDispatchRepository();

    await recoverReviewDispatchesAfterRestart();

    expect(durableTransitions(null, "pending", nextReviewRetryCorrelation(currentClaim.correlation))).toHaveLength(0);
    expect(injectedReviewDirectives()).toEqual([]);
    expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
  },
);

it("does not reissue or claim a pending slot after a cancellation tombstone append fails", async () => {
  await arrangeCurrentPendingReview(activeAuthorization);
  failNextCancellationTombstoneAppend();
  await bridge.handleImplementationArm("s1", cancelRequest);
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(injectedReviewDirectives()).toEqual([]);
  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({ kind: "blocked" });
  expect(durableTransitions("pending", "claimed")).toHaveLength(0);
  await recoverReviewDispatchesAfterRestart();
  expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
});

it.each(["review_execution_failed", "lost_conclusive"] as const)(
  "lets terminal authorization cancellation win over a claimed %s handler",
  async (reason) => {
    await arrangeCurrentClaimedReview(activeAuthorization);
    releaseAuthorizationBeforeFailureAuthorizationCheck(currentAuthorizationId);

    await expect(terminalizeReviewFailure(currentClaim, reason)).resolves.toEqual({ kind: "blocked" });

    expect(durableTerminals(reason)).toHaveLength(0);
    expect(durableTransitions(null, "pending", nextReviewRetryCorrelation(currentClaim.correlation))).toHaveLength(0);
    expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
  },
);

it("completes a terminal-authorization claim without recursively waiting on its parent queue", async () => {
  await arrangeCurrentPendingReview(releasedAuthorization);
  const completedCancellation = deferred<void>();
  appendCancellationTombstone.mockImplementation(async () => {
    completedCancellation.resolve();
    return committedCancelledTransition;
  });

  const claim = claimReviewDispatch(reviewPreToolUse);
  await completedCancellation.promise;
  await expect(claim).resolves.toMatchObject({
    kind: "blocked",
    advisory: "review_authorization_terminal",
  });

  expect(durableTerminals("cancelled")).toHaveLength(1);
  expect(durableTransitions("pending", "claimed")).toHaveLength(0);
  expect(projectedArtifactReservations()).toHaveLength(0);
  await expect(serializeParentSessionClaim("parent-1", async () => "next")).resolves.toBe("next");
});

it("serializes external cancellation with a concurrent claim for the same parent session", async () => {
  await arrangeCurrentPendingReview(activeAuthorization);
  const cancellationEntered = deferred<void>();
  const releaseCancellation = deferred<void>();
  blockCancellationAppend(cancellationEntered, releaseCancellation);

  const cancellation = cancelReviewDispatchesForTerminalAuthorization("parent-1", currentAuthorizationId);
  await cancellationEntered.promise;
  const claim = claimReviewDispatch(reviewPreToolUse);
  releaseCancellation.resolve();

  await Promise.all([cancellation, claim]);
  expect(maxConcurrentParentSessionOperations("parent-1")).toBe(1);
  expect(durableTerminals("cancelled")).toHaveLength(1);
  expect(durableTransitions("pending", "claimed")).toHaveLength(0);
});

it("preserves A then B then C parent-session ordering when cancellation occupies A", async () => {
  const a = cancelReviewDispatchesForTerminalAuthorization("parent-1", currentAuthorizationId);
  const b = claimReviewDispatch(reviewPreToolUseFor("call-b"));
  const c = claimReviewDispatch(reviewPreToolUseFor("call-c"));

  await releaseQueuedCancellationAThenAwaitAll(a, b, c);

  expect(parentSessionOperationTrace()).toEqual(["cancel-a", "claim-b", "claim-c"]);
  expect(pendingClaimQueues.has("parent-1")).toBe(false);
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

it("uses the selected durable slot rather than PreToolUse correlation for authorization", async () => {
  arrangeCurrentPendingReview(activeAuthorization, trustedTaskReviewCorrelation);
  const result = await claimReviewDispatch({
    ...reviewPreToolUse,
    correlation: staleOrForgedTaskReviewCorrelation,
  });

  expect(result).toMatchObject({ kind: "claimed" });
  expect(isCurrentActiveAuthorization).toHaveBeenCalledWith(trustedTaskReviewCorrelation);
  expect(isCurrentActiveAuthorization).not.toHaveBeenCalledWith(staleOrForgedTaskReviewCorrelation);
  expect(cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim).not.toHaveBeenCalledWith(
    expect.anything(),
    authorizationIdFor(staleOrForgedTaskReviewCorrelation),
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

it("does not let a third same-parent claim enter while the second queued claim is in its critical section", async () => {
  const aEntered = deferred<void>();
  const releaseA = deferred<void>();
  const bEntered = deferred<void>();
  const releaseB = deferred<void>();
  let durableReads = 0;
  readDurableRecords.mockImplementation(async () => {
    durableReads += 1;
    if (durableReads === 1) {
      aEntered.resolve();
      await releaseA.promise;
      return onePendingSlotRecords;
    }
    if (durableReads === 2) {
      bEntered.resolve();
      await releaseB.promise;
      return claimedSlotRecords;
    }
    return claimedSlotRecords;
  });

  const a = claimReviewDispatch(reviewPreToolUseFor("call-a"));
  await aEntered.promise;
  const b = claimReviewDispatch(reviewPreToolUseFor("call-b"));
  releaseA.resolve();
  await bEntered.promise;
  const c = claimReviewDispatch(reviewPreToolUseFor("call-c"));

  await Promise.resolve();
  expect(durableReads).toBe(2);
  releaseB.resolve();
  const [aResult, bResult, cResult] = await Promise.all([a, b, c]);
  expect([aResult, bResult, cResult].filter((result) => result.kind === "claimed")).toHaveLength(1);
  expect(durableTransitions("pending", "claimed")).toHaveLength(1);
  expect(projectedTaskCallBindings()).toHaveLength(1);
  expect(projectedArtifactReservations()).toHaveLength(1);
  expect(authoritativeCallIds()).toEqual(["call-a"]);
  expect(authoritativeCallIds()).not.toEqual(expect.arrayContaining(["call-b", "call-c"]));
  expect(authoritativeArtifactIds()).toHaveLength(1);
});

it("does not serialize claims from different parent sessions", async () => {
  const bothEntered = deferred<void>();
  const releaseBoth = deferred<void>();
  let activeReads = 0;
  readDurableRecords.mockImplementation(async () => {
    activeReads += 1;
    if (activeReads === 2) bothEntered.resolve();
    await releaseBoth.promise;
    return pendingSlotsForDifferentParents;
  });

  const first = claimReviewDispatch(reviewPreToolUseFor("call-a", "parent-a"));
  const second = claimReviewDispatch(reviewPreToolUseFor("call-b", "parent-b"));
  await bothEntered.promise;
  releaseBoth.resolve();
  await expect(Promise.all([first, second])).resolves.toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "claimed" })]),
  );
});

it("continues a same-parent queue after its predecessor rejects", async () => {
  const rejected = serializeParentSessionClaim("parent-1", async () => {
    throw new Error("append failed");
  });
  const following = serializeParentSessionClaim("parent-1", async () => "continued");

  await expect(rejected).rejects.toThrow("append failed");
  await expect(following).resolves.toBe("continued");
});

it("terminalizes conclusive loss before retrying the same task attempt", async () => {
  await terminalizeReviewFailure(currentClaim, "lost_conclusive");
  expect(durableTerminal()).toMatchObject({ terminalReason: "lost_conclusive" });
  expect(nextPendingCorrelation()).toMatchObject({
    taskExecutionRef: currentTaskExecutionRef,
    reviewRound: currentReviewRound + 1,
  });
  expect(trace).toEqual(["terminal-committed", "next-pending-committed", "directive-injected"]);
  expect(startImplementationAttempt).not.toHaveBeenCalled();
});

it("retries a task review with the same TaskExecutionRef and only reviewRound + 1", async () => {
  const retry = await terminalizeReviewFailure(currentClaim, "review_execution_failed");
  if (retry.kind !== "retried" || retry.correlation.reviewKind !== "task-review") {
    throw new Error("expected task-review retry");
  }

  expect(retry.correlation).toEqual({
    reviewKind: "task-review",
    taskExecutionRef: currentTaskExecutionRef,
    reviewRound: currentReviewRound + 1,
  });
  expect(retry.correlation).not.toHaveProperty("finalReviewRound");
  expect(projectReviewDispatchSlots(await readDurableRecords()).currentTaskReviewCorrelation()).toEqual(
    retry.correlation,
  );
  expect(projectReviewDispatchSlots(await readDurableRecords()).isCurrent(oldTaskReviewCorrelation)).toBe(
    false,
  );
});

it.each([
  ["reviewer execution failure", "review_execution_failed"],
  ["transport failure", "review_execution_failed"],
  ["conclusive loss", "lost_conclusive"],
] as const)("retries final review after %s without finalization rework", async (_name, reason) => {
  const retry = await terminalizeReviewFailure(currentFinalClaim, reason);
  const replayed = projectReviewDispatchSlots(await readDurableRecords());

  expect(retry).toMatchObject({ kind: "retried" });
  if (retry.kind !== "retried" || retry.correlation.reviewKind !== "final-review") {
    throw new Error("expected final review retry");
  }
  expect(durableTerminal()).toMatchObject({ terminalReason: reason });
  expect(retry.correlation).toMatchObject({
    finalizationAttemptId: currentFinalClaim.correlation.finalizationAttemptId,
    finalReviewRound: currentFinalClaim.correlation.finalReviewRound + 1,
  });
  expect(projectedFinalizationState()).toBe("final_review_pending");
  expect(durableFinalizationTransitions()).not.toContainEqual(
    expect.objectContaining({ from: "final_rework_required", to: "final_review_pending" }),
  );
  expect(replayed.currentFinalReviewCorrelation()).toEqual(retry.correlation);
});

it("retries a Final Review with the same finalizationAttemptId and only finalReviewRound + 1", async () => {
  const retry = await terminalizeReviewFailure(currentFinalClaim, "review_execution_failed");
  if (retry.kind !== "retried" || retry.correlation.reviewKind !== "final-review") {
    throw new Error("expected final-review retry");
  }

  expect(retry.correlation).toEqual({
    reviewKind: "final-review",
    planPath: currentFinalClaim.correlation.planPath,
    authorizationId: currentFinalClaim.correlation.authorizationId,
    planFingerprint: currentFinalClaim.correlation.planFingerprint,
    finalizationAttemptId: currentFinalClaim.correlation.finalizationAttemptId,
    finalReviewRound: currentFinalClaim.correlation.finalReviewRound + 1,
  });
  expect(retry.correlation).not.toHaveProperty("reviewRound");
  expect(projectReviewDispatchSlots(await readDurableRecords()).isCurrent(oldFinalReviewCorrelation)).toBe(
    false,
  );
});

it("recovers a terminal-to-pending crash exactly once and only dispatches after durable pending", async () => {
  failNextReviewPendingAppend();
  await expect(
    terminalizeReviewFailure(currentFinalClaim, "review_execution_failed"),
  ).resolves.toEqual({ kind: "blocked" });
  expect(trace).toEqual(["terminal-committed", "next-pending-append-failed"]);
  expect(injectedReviewDirectives()).toEqual([]);

  restartReviewDispatchRepository();
  await recoverReviewDispatchesAfterRestart();
  expect(trace).toEqual([
    "terminal-committed",
    "next-pending-append-failed",
    "next-pending-committed",
    "directive-injected",
  ]);
  expect(durableTransitions(null, "pending", nextFinalReviewCorrelation())).toHaveLength(1);
  expect(injectedReviewDirectives()).toEqual([
    { kind: "review_required", correlation: nextFinalReviewCorrelation() },
  ]);

  await recoverReviewDispatchesAfterRestart();
  expect(durableTransitions(null, "pending", nextFinalReviewCorrelation())).toHaveLength(1);
  expect(durableTransitions("pending", "claimed")).toHaveLength(0);
  expect(injectedReviewDirectives()).toEqual(
    expect.arrayContaining([
      { kind: "review_required", correlation: nextFinalReviewCorrelation() },
    ]),
  );
});

it("replays one current Final Review retry and rejects its old PostToolUse, artifact, and Gate", async () => {
  failNextReviewPendingAppend();
  await terminalizeReviewFailure(currentFinalClaim, "lost_conclusive");
  restartReviewDispatchRepository();
  await recoverReviewDispatchesAfterRestart();

  expect(currentFinalReviewCorrelation()).toEqual({
    ...currentFinalClaim.correlation,
    finalReviewRound: currentFinalClaim.correlation.finalReviewRound + 1,
  });
  await consumeReviewCompletion(oldFinalRoundPostToolUse);
  await evaluateGatePendingAttempt(oldFinalRoundGateContext);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(evaluate).not.toHaveBeenCalled();
  expect(currentFinalReviewCorrelation()).not.toEqual(oldFinalReviewCorrelation);
});

it("keeps an uncertain recovered claim blocked without redispatch", async () => {
  await recoverClaimedWithoutTerminal(currentClaim);
  expect(reissuedDirective).not.toHaveBeenCalled();
  expect(nextPendingCorrelation).not.toHaveBeenCalled();
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL at the retry assertions: the pre-change implementation reads `reviewRound` from the union,
does not reconstruct a missing retry pending after restart, and does not establish
`terminal-committed -> next-pending-committed -> directive-injected`. The test setup supplies all fixtures
and mocks; the RED failure is an assertion failure, not an unresolved symbol.

- [ ] **Step 3: Implement durable dispatch and claim**

Persist one `pending` slot per parent session before injecting its `ReviewRequiredDirective`. Implement a
private, domain-specific `pendingClaimQueues: Map<string, Promise<void>>`, keyed by `parentSessionId`.
This queue is not a reusable lock framework. Each operation installs its own unresolved tail before awaiting
the predecessor. Its `finally` resolves that tail and deletes the map entry only when the tail is still the
current entry; an older operation can therefore never delete a newer queued tail. A rejected predecessor is
ignored for queue progression while its caller still receives its own rejection.

Inside that one parent-session critical section, read the latest durable log and re-project the slots.
If any `pending` or `claimed` slot already exists for the parent session, `requestMandatoryReview` and
retry-pending creation create neither another `pending` record nor a directive; they leave the later review
pending in its lifecycle state for a later terminal/recovery trigger. Only when no outstanding slot exists may
they append one `null -> pending` record and inject its directive after the durable append. For claim, select
exactly one pending slot using only the runtime-observed parent session and expected category. Create its
reservation and append one claimed transition record containing the selected slot's trusted correlation,
`callId`, expected category, and reservation. The projection derives
the `TaskCallBinding` from that claimed record. Do not publish the binding, reservation, or worker-path
argument until that append succeeds. If the append fails, retain the pending slot, publish no binding or
reservation, emit a binding-failure advisory, and return `blocked`. The queue is process-local exclusion
only: restart always re-projects durable records, which remain the SSOT.

`requestMandatoryReview`, `claimReviewDispatch`, `terminalizeReviewFailure`, retry-pending creation, restart
directive reissue, and cancellation convergence each execute their durable Authorization recheck in the
parent-session critical section immediately before their state-changing append or directive injection. A request
that observes terminal, missing, unreadable, conflict-diverted, or otherwise uncertain Authorization calls the
within-parent cancellation helper for an existing pending or claimed slot, injects no directive, and returns a
blocked / stale advisory. A retryable terminal is immutable: when its Authorization is non-active, it remains
unchanged and produces neither a next pending slot nor a directive.

`ClaimInput.correlation` is untrusted echo data and is ignored by Review Dispatch.
`claimReviewDispatch` first selects the durable pending slot, then uses only `pending.key.correlation` for every
Authorization lookup, cancellation authorization ID, claimed transition, binding, and artifact-reservation
association. A missing, multiple, or category-mismatched slot returns `review_claim_unavailable` before any
Authorization lookup or state mutation.

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
slot is immutable. A restart recovery first re-reads the durable log and projection. For each terminal slot
whose terminal reason is only `review_execution_failed` or `lost_conclusive`, it derives the next correlation,
checks whether that exact parent-session/correlation slot is already pending, claimed, or terminal, and appends
`null -> pending` only when it is absent. It injects the next directive only after the pending record is durable.
When the next slot already exists, recovery may reissue that same directive as permitted by Design §4.8.2; it
must not append a second pending record or create a second claim. Recovered claimed slots wait for matching
PostToolUse, and uncertain claimed recovery does not redispatch.

Every directive creation or reissue, `claimReviewDispatch`, failure terminalization, and terminal-failure
retry-pending creation resolves the correlation's authorizationId and requires its `AuthorizationStore` binding to
be durably `active` immediately before the state-changing append or directive injection. Released, invalidated,
missing, unreadable, conflict-diverted, or otherwise uncertain Authorization returns a blocked / stale advisory,
creates no failure terminal, pending slot, claim binding, reservation, or directive, and invokes the within-parent
cancellation helper only for an already pending or claimed slot. `recoverReviewDispatchesAfterRestart` must
hydrate Authorization before projecting review records; it must never decide retry eligibility from the review log
alone. For every retryable terminal and ordinary pending slot, recovery acquires its parent-session queue,
re-reads the latest durable Authorization inside that operation, and only then creates/reissues a pending
directive. The parent-session queue serializes this domain-specific check with claim, failure terminalization,
retry-pending append, directive injection, and cancellation terminalization, so an operation that observes a newly
terminal Authorization cannot publish later review progress.

In this Task only, extend `PlanBridge.handleImplementationArm` after Task 2.3's successful durable release, and
the existing fingerprint-invalidation path after its durable invalidation, to call
`cancelReviewDispatchesForTerminalAuthorization`. The release / invalidation is never rolled back when that append
fails. On recovery, the same helper rechecks durable Authorization and retries a missing `cancelled` tombstone
without reissuing or claiming the slot. The helper reads the latest projection under the existing parent-session
queue, identifies only current slots whose correlation resolves to the supplied authorizationId, appends
`pending -> terminal(cancelled)` or `claimed -> terminal(cancelled)` only when still current, and treats an
existing terminal tombstone as a no-op. No generic cancellation, transaction, or recovery framework is added.

```ts
type ClaimedReviewDispatch = {
  readonly parentSessionId: string;
  readonly correlation: ReviewCorrelation;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly callId: string;
};

type ClaimInput = {
  readonly parentSessionId: string;
  readonly callId: string;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly correlation?: unknown;
};

type ReviewFailureOutcome =
  | { readonly kind: "retried"; readonly correlation: ReviewCorrelation }
  | { readonly kind: "blocked" };

const pendingClaimQueues = new Map<string, Promise<void>>();

function serializeParentSessionClaim<T>(
  parentSessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = pendingClaimQueues.get(parentSessionId) ?? Promise.resolve();
  let releaseTail: (() => void) | undefined;
  const tail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  pendingClaimQueues.set(parentSessionId, tail);

  return predecessor
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      releaseTail?.();
      if (pendingClaimQueues.get(parentSessionId) === tail) {
        pendingClaimQueues.delete(parentSessionId);
      }
  });
}

async function requestMandatoryReview(
  parentSessionId: string,
  correlation: ReviewCorrelation,
  expectedCategory: "sp-review" | "sp-final-review",
): Promise<void> {
  await serializeParentSessionClaim(parentSessionId, async () => {
    const slots = projectReviewDispatchSlots(await readDurableRecords());
    if (slots.some((slot) =>
      slot.key.parentSessionId === parentSessionId &&
      (slot.state === "pending" || slot.state === "claimed"),
    )) {
      return;
    }
    if (!(await isCurrentActiveAuthorization(correlation))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        parentSessionId,
        authorizationIdFor(correlation),
      );
      return;
    }
    const pending = await appendReviewDispatchTransition({
      recordType: "observation",
      kind: "review_dispatch_transition",
      transitionId: randomUUID(),
      parentSessionId,
      correlation,
      expectedCategory,
      from: null,
      to: "pending",
    });
    if (pending.kind !== "committed") return;
    if (!(await isCurrentActiveAuthorization(correlation))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        parentSessionId,
        authorizationIdFor(correlation),
      );
      return;
    }
    await injectReviewRequiredDirective({ kind: "review_required", correlation });
  });
}

async function claimReviewDispatch(input: ClaimInput): Promise<ClaimReviewDispatchOutcome> {
  return serializeParentSessionClaim(input.parentSessionId, async () => {
    const slots = projectReviewDispatchSlots(await readDurableRecords());
    const pending = selectExactlyOnePendingSlotForParentAndCategory(
      slots,
      input.parentSessionId,
      input.expectedCategory,
    );
    if (pending === undefined) return { kind: "blocked", advisory: "review_claim_unavailable" };
    const correlation = pending.key.correlation;
    if (!(await isCurrentActiveAuthorization(correlation))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        input.parentSessionId,
        authorizationIdFor(correlation),
      );
      return { kind: "blocked", advisory: "review_authorization_terminal" };
    }

    const reservation = await reserveReviewArtifact();
    if (!(await isCurrentActiveAuthorization(correlation))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        input.parentSessionId,
        authorizationIdFor(correlation),
      );
      return { kind: "blocked", advisory: "review_authorization_terminal" };
    }
    const claimed = await appendClaimedTransition({ pending, callId: input.callId, reservation });
    return claimed.kind === "committed"
      ? { kind: "claimed", taskCallBinding: projectTaskCallBinding(claimed.record) }
      : { kind: "blocked", advisory: "review_claim_commit_failed" };
  });
}

async function terminalizeReviewFailure(
  claim: ClaimedReviewDispatch,
  terminalReason: "review_execution_failed" | "lost_conclusive",
): Promise<ReviewFailureOutcome> {
  return serializeParentSessionClaim(claim.parentSessionId, async () => {
    if (!(await isCurrentActiveAuthorization(claim.correlation))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        claim.parentSessionId,
        authorizationIdFor(claim.correlation),
      );
      return { kind: "blocked" };
    }
    const existing = findRetryableTerminalFailure(
      await readDurableRecords(),
      claim.parentSessionId,
      claim.correlation,
    );
    if (existing !== undefined) {
      return ensureReviewRetryPendingWithinParentSessionClaim(existing);
    }

    if (!(await isCurrentActiveAuthorization(claim.correlation))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        claim.parentSessionId,
        authorizationIdFor(claim.correlation),
      );
      return { kind: "blocked" };
    }

    const terminal = await appendReviewDispatchTransition({
      recordType: "observation",
      kind: "review_dispatch_transition",
      transitionId: randomUUID(),
      parentSessionId: claim.parentSessionId,
      correlation: claim.correlation,
      expectedCategory: claim.expectedCategory,
      from: "claimed",
      to: "terminal",
      callId: claim.callId,
      terminalReason,
    });
    if (terminal.kind !== "committed") return { kind: "blocked" };
    return ensureReviewRetryPendingWithinParentSessionClaim(terminal.record);
  });
}

function nextReviewRetryCorrelation(correlation: ReviewCorrelation): ReviewCorrelation {
  if (correlation.reviewKind === "task-review") {
    return {
      reviewKind: "task-review",
      taskExecutionRef: correlation.taskExecutionRef,
      reviewRound: correlation.reviewRound + 1,
    };
  }
  return {
    reviewKind: "final-review",
    planPath: correlation.planPath,
    authorizationId: correlation.authorizationId,
    planFingerprint: correlation.planFingerprint,
    finalizationAttemptId: correlation.finalizationAttemptId,
    finalReviewRound: correlation.finalReviewRound + 1,
  };
}

type RetryableTerminalFailure = ReviewDispatchTransitionRecord & {
  readonly from: "claimed";
  readonly to: "terminal";
  readonly terminalReason: "review_execution_failed" | "lost_conclusive";
};

function isRetryableTerminalFailure(
  record: PersistedLogRecord,
): record is RetryableTerminalFailure {
  if (record.kind !== "review_dispatch_transition") return false;
  return (
    record.from === "claimed" &&
    record.to === "terminal" &&
    (record.terminalReason === "review_execution_failed" || record.terminalReason === "lost_conclusive")
  );
}

function sameReviewCorrelation(left: ReviewCorrelation, right: ReviewCorrelation): boolean {
  if (left.reviewKind !== right.reviewKind) return false;
  if (left.reviewKind === "task-review" && right.reviewKind === "task-review") {
    return (
      left.taskExecutionRef.authorizationId === right.taskExecutionRef.authorizationId &&
      left.taskExecutionRef.taskId === right.taskExecutionRef.taskId &&
      left.taskExecutionRef.attemptId === right.taskExecutionRef.attemptId &&
      left.reviewRound === right.reviewRound
    );
  }
  if (left.reviewKind === "final-review" && right.reviewKind === "final-review") {
    return (
      left.planPath === right.planPath &&
      left.authorizationId === right.authorizationId &&
      left.planFingerprint.algorithm === right.planFingerprint.algorithm &&
      left.planFingerprint.value === right.planFingerprint.value &&
      left.finalizationAttemptId === right.finalizationAttemptId &&
      left.finalReviewRound === right.finalReviewRound
    );
  }
  return false;
}

function findRetryableTerminalFailure(
  records: ReadonlyArray<PersistedLogRecord>,
  parentSessionId: string,
  correlation: ReviewCorrelation,
): RetryableTerminalFailure | undefined {
  return records.find(
    (record): record is RetryableTerminalFailure =>
      isRetryableTerminalFailure(record) &&
      record.parentSessionId === parentSessionId &&
      sameReviewCorrelation(record.correlation, correlation),
  );
}

async function ensureReviewRetryPendingAfterTerminalFailure(
  terminal: RetryableTerminalFailure,
): Promise<ReviewFailureOutcome> {
  return serializeParentSessionClaim(terminal.parentSessionId, async () =>
    ensureReviewRetryPendingWithinParentSessionClaim(terminal),
  );
}

async function ensureReviewRetryPendingWithinParentSessionClaim(
  terminal: RetryableTerminalFailure,
): Promise<ReviewFailureOutcome> {
  const correlation = nextReviewRetryCorrelation(terminal.correlation);
  if (!(await isCurrentActiveAuthorization(correlation))) {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      terminal.parentSessionId,
      authorizationIdFor(correlation),
    );
    return { kind: "blocked" };
  }
  const slots = projectReviewDispatchSlots(await readDurableRecords());
  const existing = slots.find(
    (slot) =>
      slot.key.parentSessionId === terminal.parentSessionId &&
      sameReviewCorrelation(slot.key.correlation, correlation),
  );
  if (existing?.state === "claimed" || existing?.state === "terminal") {
    return { kind: "retried", correlation };
  }
  if (existing?.state === "pending") {
    if (!(await isCurrentActiveAuthorization(correlation))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        terminal.parentSessionId,
        authorizationIdFor(correlation),
      );
      return { kind: "blocked" };
    }
    await injectReviewRequiredDirective({ kind: "review_required", correlation });
    return { kind: "retried", correlation };
  }

  if (slots.some((slot) =>
    slot.key.parentSessionId === terminal.parentSessionId &&
    (slot.state === "pending" || slot.state === "claimed"),
  )) {
    return { kind: "blocked" };
  }

  if (!(await isCurrentActiveAuthorization(correlation))) {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      terminal.parentSessionId,
      authorizationIdFor(correlation),
    );
    return { kind: "blocked" };
  }

  const pending = await appendReviewDispatchTransition({
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: randomUUID(),
    parentSessionId: terminal.parentSessionId,
    correlation,
    expectedCategory: terminal.expectedCategory,
    from: null,
    to: "pending",
  });
  if (pending.kind !== "committed") return { kind: "blocked" };
  if (!(await isCurrentActiveAuthorization(correlation))) {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      terminal.parentSessionId,
      authorizationIdFor(correlation),
    );
    return { kind: "blocked" };
  }
  await injectReviewRequiredDirective({ kind: "review_required", correlation });
  return { kind: "retried", correlation };
}

async function cancelReviewDispatchesForTerminalAuthorization(
  parentSessionId: string,
  authorizationId: string,
): Promise<void> {
  await serializeParentSessionClaim(parentSessionId, async () => {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      parentSessionId,
      authorizationId,
    );
  });
}

async function cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
  parentSessionId: string,
  authorizationId: string,
): Promise<void> {
  const slots = projectReviewDispatchSlots(await readDurableRecords());
  const current = slots.find(
    (slot) =>
      slot.key.parentSessionId === parentSessionId &&
      authorizationIdFor(slot.key.correlation) === authorizationId &&
      (slot.state === "pending" || slot.state === "claimed"),
  );
  if (current === undefined) return;
  await appendCancelledReviewDispatchTransition(current);
}

async function appendCancelledReviewDispatchTransition(current: ReviewDispatchSlot): Promise<void> {
  if (current.state === "pending") {
    await appendReviewDispatchTransition({
      recordType: "observation",
      kind: "review_dispatch_transition",
      transitionId: randomUUID(),
      parentSessionId: current.key.parentSessionId,
      correlation: current.key.correlation,
      expectedCategory: current.expectedCategory,
      from: "pending",
      to: "terminal",
      terminalReason: "cancelled",
    });
    return;
  }
  if (current.state !== "claimed" || current.callId === undefined) return;
  await appendReviewDispatchTransition({
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: randomUUID(),
    parentSessionId: current.key.parentSessionId,
    correlation: current.key.correlation,
    expectedCategory: current.expectedCategory,
    from: "claimed",
    to: "terminal",
    callId: current.callId,
    terminalReason: "cancelled",
  });
}

async function reissuePendingReviewDirectiveAfterRestart(slot: ReviewDispatchSlot): Promise<void> {
  await serializeParentSessionClaim(slot.key.parentSessionId, async () => {
    const latestSlots = projectReviewDispatchSlots(await readDurableRecords());
    const latest = latestSlots.find(
      (candidate) =>
        candidate.key.parentSessionId === slot.key.parentSessionId &&
        sameReviewCorrelation(candidate.key.correlation, slot.key.correlation),
    );
    if (latest?.state !== "pending") return;
    if (!(await isCurrentActiveAuthorization(latest.key.correlation))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        latest.key.parentSessionId,
        authorizationIdFor(latest.key.correlation),
      );
      return;
    }
    await injectReviewRequiredDirective({ kind: "review_required", correlation: latest.key.correlation });
  });
}

async function recoverReviewDispatchesAfterRestart(): Promise<void> {
  await hydrateAuthorizationsBeforeReviewRecovery();
  const records = await readDurableRecords();
  const retryableTerminals = records.filter(isRetryableTerminalFailure);
  for (const record of retryableTerminals) {
    await ensureReviewRetryPendingAfterTerminalFailure(record);
  }
  const slots = projectReviewDispatchSlots(await readDurableRecords());
  for (const slot of slots) {
    if (slot.state !== "pending") continue;
    const isRetryPending = retryableTerminals.some(
      (terminal) =>
        terminal.parentSessionId === slot.key.parentSessionId &&
        sameReviewCorrelation(nextReviewRetryCorrelation(terminal.correlation), slot.key.correlation),
    );
    if (isRetryPending) continue;
    await reissuePendingReviewDirectiveAfterRestart(slot);
  }
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-dispatch-state.ts src/core/review-artifact-reservation.ts src/core/types.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/hooks/observation-handler.ts src/hooks/plan-bridge.ts src/core/justice-plugin.ts tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/core/justice-plugin-routing.test.ts
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

**Requirement:** JUS-P0-02, JUS-P0-04, INV-06, INV-13, INV-15 through INV-19, Design §4.8.1, §4.8.2, §4.10, and §4.11.

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
- Test: `tests/core/justice-plugin-routing.test.ts`

**Consumes:** projected claimed dispatch slot; durable `TaskCallBinding`; durable
`DelegatedExecutionBinding`; Design §4.10 `ReviewArtifactReservation`; durable `AuthorizationStore`
`findByAuthorizationId`; `evaluateGatePendingAttempt` from Task 3.2; `terminalizeReviewFailure`; and exported
`cancelReviewDispatchesForTerminalAuthorization` from Task 3.4.

**Produces:** `consumeReviewCompletion(input): Promise<ReviewCompletionOutcome>`;
`recoverStagedReviewCompletion(staged: ReviewCompletionStagingRecord): Promise<ReviewCompletionOutcome>`;
`recoverStagedReviewCompletionsAfterRestart(): Promise<void>`;
`reviewAuthorizationId(correlation: ReviewCorrelation): string`; and
`isReviewAuthorizationActive(correlation: ReviewCorrelation): Promise<boolean>`;
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

it.each(["released", "invalidated"] as const)(
  "does not accept claimed review output or invoke Gate after authorization becomes %s",
  async (status) => {
    await arrangeCurrentClaimedReview(activeAuthorization);
    setAuthorizationStatus(currentAuthorizationId, status);
    await consumeReviewCompletion(matchingInput);
    expect(readArtifact).not.toHaveBeenCalled();
    expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
    expect(recordAcceptanceDecision).not.toHaveBeenCalled();
    expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
  },
);

it("recovers a staged terminalization after restart without rereading the artifact", async () => {
  await consumeReviewCompletion(inputWithTerminalCommitFailure);
  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(readArtifact).toHaveBeenCalledTimes(1);
  expect(appendTerminalRecord).toHaveBeenCalledTimes(2);
  expect(durableTerminalRecords()).toHaveLength(1);
  expect(recordGatePendingAndEvaluate).toHaveBeenCalledTimes(1);
});

it("does not duplicate terminalization, Gate, or Acceptance during repeated staged recovery", async () => {
  await arrangeClaimedStagedCompletion(stagedRecord);
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(readArtifact).not.toHaveBeenCalled();
  expect(durableTerminalRecords()).toHaveLength(1);
  expect(recordGatePendingAndEvaluate).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it("retains claimed plus staging and blocks Acceptance when terminal append keeps failing", async () => {
  await arrangeClaimedStagedCompletion(stagedRecord);
  failAllTerminalAppends();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(projectedSlot().state).toBe("claimed");
  expect(projectedCompletionStaging()).toEqual(stagedRecord);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(createReviewDispatch).not.toHaveBeenCalled();
  expect(createReviewArtifactReservation).not.toHaveBeenCalled();
  expect(nextPendingCorrelation).not.toHaveBeenCalled();
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
});

it.each([mismatchedParentSessionStaging, mismatchedCallIdStaging, mismatchedCorrelationStaging, mismatchedArtifactStaging, mismatchedChildBindingStaging])(
  "treats mismatched staged completion as stale without mutation",
  async (mismatchedStaging) => {
    await expect(recoverStagedReviewCompletion(mismatchedStaging)).resolves.toEqual({ kind: "stale" });
    expect(readArtifact).not.toHaveBeenCalled();
    expect(appendTerminalRecord).not.toHaveBeenCalled();
  },
);

it("recovers a clean terminal after terminal append but before gate_pending without rereading its artifact", async () => {
  await arrangeClaimedStagingWithMatchingCleanTerminalWithoutLifecycle(stagedRecord);
  await recoverStagedReviewCompletion(stagedRecord);
  await recoverStagedReviewCompletion(stagedRecord);

  expect(readArtifact).not.toHaveBeenCalled();
  expect(appendTerminalRecord).not.toHaveBeenCalled();
  expect(durableGatePendingTransitions()).toHaveLength(1);
  expect(recordGatePendingAndEvaluate).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it("resumes one missing Gate path after gate_pending was durable before a crash", async () => {
  await arrangeClaimedStagingWithMatchingCleanTerminalAndGatePending(stagedRecord);
  await recoverStagedReviewCompletion(stagedRecord);
  await recoverStagedReviewCompletion(stagedRecord);

  expect(appendTerminalRecord).not.toHaveBeenCalled();
  expect(durableGatePendingTransitions()).toHaveLength(1);
  expect(recordGatePendingAndEvaluate).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it("recovers a Final Review clean terminal to final_gate_pending and one Final Gate", async () => {
  await arrangeFinalStagingWithMatchingCleanTerminalWithoutLifecycle(finalStagedRecord);
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(appendTerminalRecord).not.toHaveBeenCalled();
  expect(durableFinalGatePendingTransitions()).toHaveLength(1);
  expect(recordGatePendingAndEvaluate).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it.each(["task-review", "final-review"] as const)(
  "recovers %s findings terminal to direct rework exactly once without Gate",
  async (reviewKind) => {
    await arrangeMatchingFindingsTerminalWithoutRework(reviewKind);
    await recoverStagedReviewCompletionsAfterRestart();
    await recoverStagedReviewCompletionsAfterRestart();

    expect(appendTerminalRecord).not.toHaveBeenCalled();
    expect(durableReworkTransitions(reviewKind)).toHaveLength(1);
    expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
  },
);

it("keeps an existing incomplete terminal blocked without Gate, rework, or duplicate mutation", async () => {
  await arrangeMatchingIncompleteTerminal(stagedRecord);
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(appendTerminalRecord).not.toHaveBeenCalled();
  expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
  expect(durableReworkTransitions()).toHaveLength(0);
  expect(projectedAcceptance()).toMatchObject({ verdict: "blocked" });
});

it("retains a clean terminal but suppresses lifecycle, Gate, and Acceptance after authorization becomes terminal", async () => {
  await arrangeClaimedStagingWithMatchingCleanTerminalWithoutLifecycle(stagedRecord);
  releaseAuthorization(stagedAuthorizationId);
  await recoverStagedReviewCompletionsAfterRestart();

  expect(durableTerminalRecords()).toHaveLength(1);
  expect(durableGatePendingTransitions()).toHaveLength(0);
  expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
});

it.each(["released", "invalidated"] as const)(
  "does not promote a staged clean review after authorization becomes %s",
  async (status) => {
    await arrangeClaimedStagedCompletion(stagedRecord);
    setAuthorizationStatus(stagedAuthorizationId, status);
    await recoverStagedReviewCompletionsAfterRestart();
    expect(readArtifact).not.toHaveBeenCalled();
    expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
    expect(recordAcceptanceDecision).not.toHaveBeenCalled();
    expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
  },
);

it("does not let old authorization A affect fresh authorization B", async () => {
  await arrangeCancelledAuthorizationWithStagedReview("A");
  await approveFreshAuthorization("B");
  await consumeReviewCompletion(oldAuthorizationAPostToolUse);
  await recoverStagedReviewCompletionsAfterRestart();
  const current = currentReviewCorrelation();
  if (current.reviewKind !== "task-review") throw new Error("expected task review");
  expect(current.taskExecutionRef.authorizationId).toBe("B");
  expect(readArtifact).not.toHaveBeenCalled();
  expect(recordGatePendingAndEvaluate).not.toHaveBeenCalled();
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
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

it.each([
  ["reviewer execution failure", "review_execution_failed"],
  ["transport failure", "review_execution_failed"],
  ["conclusive loss", "lost_conclusive"],
] as const)("rejects stale Final Review and Final Gate records after %s", async (_name, reason) => {
  const retry = await terminalizeReviewFailure(currentFinalClaim, reason);
  await consumeReviewCompletion(oldFinalRoundPostToolUse);
  await evaluateGatePendingAttempt(oldFinalRoundGateContext);
  const replayed = project(await readDurableRecords(), now);

  expect(retry).toMatchObject({ kind: "retried" });
  if (retry.kind !== "retried" || retry.correlation.reviewKind !== "final-review") {
    throw new Error("expected final review retry");
  }
  expect(readArtifact).not.toHaveBeenCalled();
  expect(evaluate).not.toHaveBeenCalled();
  expect(replayed.currentFinalization()).toMatchObject({
    finalizationAttemptId: currentFinalClaim.correlation.finalizationAttemptId,
    finalReviewRound: retry.correlation.finalReviewRound,
    state: "final_review_pending",
  });
  expect(replayed.planAcceptanceDecisionFor(oldFinalRoundGateContext)).toBeUndefined();
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL because matching review completion has no composite terminal physical record or ordered Gate request.

- [ ] **Step 3: Implement the fixed protocol**

Implement this exact sequence: validate claimed parent binding; check
`artifactReservation.status === "usable"`; validate durable child-session binding; read the usable artifact
once; strictly parse `ReviewWorkerResultV1`; classify it before lifecycle work; calculate digest; commit
`ReviewCompletionStagingRecord`; append exactly one composite terminal
`ReviewDispatchTransitionRecord` containing consumption, the classification-matched artifact subtype, and
`claimed → terminal`; then project the terminal result.

After every successful composite terminal append, and whenever recovery finds that matching terminal, call only
`ensureTerminalReviewOutcomeApplied`. This Task 3.6-private helper re-reads the latest durable Authorization and
lifecycle projection, classifies the immutable terminal reason, and never appends the terminal record itself. For
`completed`, it appends `review_pending → gate_pending` or `final_review_pending → final_gate_pending` only when
that exact current identity has no durable transition, then calls Task 3.2's idempotent
`evaluateGatePendingAttempt`. If the transition is already durable but its current-identity GateDecision is
missing, it resumes only that Gate path. For `completed_with_findings`, it appends direct
`rework_required` / `final_rework_required` only when absent and never calls Gate. For `review_incomplete`, it
does not append lifecycle, Gate, Acceptance, or retry records and returns blocked. Terminal, missing, unreadable,
conflict-diverted, or otherwise uncertain Authorization returns blocked / stale, retains the immutable terminal
record, and creates no positive lifecycle, Gate, Acceptance, or Progress state. Repeated calls use the Task 3.1
current-lifecycle and Task 3.2 current-decision checks so lifecycle transitions, GateDecision, and
AcceptanceDecision are each authoritative at most once.
Task 3.4 terminalizes `review_execution_failed` and `lost_conclusive` before it creates their next-round
pending slot; those failure branches never call this artifact-consumption path. For a final-review failure,
the next pending correlation retains `finalizationAttemptId`, increments `finalReviewRound`, and leaves
`final_review_pending` current; only actual final rework creates a fresh finalization identity. An `unusable` reservation
does no filesystem read, creates no `ReviewArtifactV1`, cannot terminalize as clean, does not invoke Gate,
and leaves mandatory Acceptance blocked while runtime task execution remains fail-open.

Review failure entry points must call Task 3.4's `terminalizeReviewFailure`; they must not construct a retry
correlation, read either round field, append a retry pending transition, or inject a retry directive themselves.
The helper discriminates `ReviewCorrelation`, preserves the task or finalization identity, and is the only
source of the next round. The Task 3.6 startup sequence runs staged-completion recovery before Task 3.4's
`recoverReviewDispatchesAfterRestart`; Task 3.4 then offers only active, recovered pending slots to the
Controller. Thus terminal failure followed by a failed pending append remains blocked without changing the
terminal tombstone, and a later recovery can commit exactly one next pending slot before it injects a directive.

Do not add `appendBatch`: the composite terminal record is the existing single-append atomicity boundary.
Any mismatch in parent session, parent call ID, purpose, correlation, artifact ID, review round, child
session, task attempt, or finalization attempt returns a stale advisory without artifact I/O or state
mutation.

Before artifact I/O in `consumeReviewCompletion`, resolve the correlation's authorizationId and require a
durable current `active` binding. Recheck the same binding after staging is committed and immediately before
the composite terminal append, lifecycle advance, and Gate request. If it is released, invalidated, missing,
unreadable, conflict-diverted, or otherwise uncertain, do not consume an artifact authoritatively, do not
append a clean / findings / incomplete terminal, do not invoke Gate, and do not generate Acceptance. Instead,
call Task 3.4's `cancelReviewDispatchesForTerminalAuthorization` for the current slot and return a blocked /
stale advisory. A cancel after staging therefore gives the terminal Authorization precedence: the staging is
not promoted, cannot be transferred to a fresh reapproval, and its artifact cleanup remains best-effort after
the cancelled terminal durable commit.

`recoverStagedReviewCompletionsAfterRestart` is a Task 3.6-specific recovery path, not a generic recovery
framework. It is wired from `JusticePlugin.initialize()` after authorization hydration and review projection,
and before Task 3.4's `recoverReviewDispatchesAfterRestart()`. The exact startup order is: (1) hydrate durable
Authorization bindings; (2) load and project durable observation records; (3) enumerate completion staging
records and call `recoverStagedReviewCompletion` for each; (4) re-project after every successful terminal
append; (5) run `recoverReviewDispatchesAfterRestart` to offer only still-active pending slots to the
Controller. This ordering prevents `claimed + staging` from being mistaken for pending and prevents a terminal
Authorization from reissuing a directive.

For each staging record, `recoverStagedReviewCompletion` first reads durable records for a matching terminal
physical record by parent session, callId, correlation, staged artifact ID / digest, and assembled artifact. When
that terminal exists, it reads neither the artifact nor worker output, does not require the slot to remain
`claimed`, does not append a terminal record, and calls `ensureTerminalReviewOutcomeApplied(existingTerminal)`.
When no matching terminal exists, it verifies that the parent session / callId / correlation slot remains current
`claimed`, that its `TaskCallBinding` and `DelegatedExecutionBinding` still match, and that the staged artifact ID
and digest match the staged composite payload. It then checks current active Authorization and retries exactly the
one composite terminal append using only the staging's stored `artifactConsumption`, assembled
`ReviewArtifactV1`, and `ObservedReviewExecution`; it never reads the artifact path, fetches worker output,
creates a reservation or dispatch, or changes either review-round field. Only a successful terminal append calls
`ensureTerminalReviewOutcomeApplied` for the same terminal. A failed append leaves the slot `claimed` plus staging
durable and Acceptance blocked. Cleanup is idempotent and runs only after the terminal durable success. A mismatch
is stale/advisory with no state mutation.

```ts
if (claim.artifactReservation.status === "unusable") return { kind: "blocked" };
if (!(await isReviewAuthorizationActive(claim.correlation))) {
  await cancelReviewDispatchesForTerminalAuthorization(
    claim.parentSessionId,
    reviewAuthorizationId(claim.correlation),
  );
  return { kind: "blocked" };
}
const staging = await commitStaging(await validateAndReadMatchingArtifact(input));
if (!(await isReviewAuthorizationActive(claim.correlation))) {
  await cancelReviewDispatchesForTerminalAuthorization(
    claim.parentSessionId,
    reviewAuthorizationId(claim.correlation),
  );
  return { kind: "blocked" };
}
const terminal = await appendTerminalRecord(staging);
if (terminal.kind !== "committed") return { kind: "blocked" };
await projectTerminalRecord(terminal.record);
await ensureTerminalReviewOutcomeApplied(terminal.record);
await cleanupArtifact(staging.artifactConsumption.artifactId);
return { kind: "terminalized" };
```

Replace the `Promise.all` path for task PostToolUse in `JusticePlugin` with `runTaskPostToolUseSequentially`. Keep independent non-task handlers unchanged.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-artifact.ts src/core/session-state-provider.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/core/review-artifact.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts
git commit -m "feat: review artifact消費とacceptanceをtransactionalに処理"
```

### Task 3.7: Update plan progress only after accepted task decisions

**Requirement:** JUS-P0-02, JUS-P0-04, INV-06, INV-08, INV-19.

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

it("does not update progress from an old terminal authorization decision", async () => {
  await handleAcceptedDecision(replayedAcceptedDecisionForAuthorization("released"));
  expect(updateCheckbox).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/progress-updater.test.ts tests/hooks/task-feedback.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL because worker feedback writes progress directly.

- [ ] **Step 3: Implement accepted-only progress updates**

Return the input unchanged unless `decision.verdict === "accepted"` and its `taskExecutionRef.taskId` equals `task.id`. For an accepted non-empty task, update every unchecked step in source order with the existing `PlanParser.updateCheckbox()` operation; preserve already checked steps and never touch another task. A zero-step task follows existing parser semantics and returns deterministic unchanged/no-op. Remove direct `PlanParser.updateCheckbox()` calls from TaskFeedback success and failure paths. `JusticePlugin` invokes the updater only after Task 3.2 has durably recorded the accepted decision and the same projected decision remains current for its active authorizationId; an old released / invalidated authorization's replayed decision is ignored. The primary defense remains Task 3.2, which must not create such an accepted decision after terminality. `ProgressUpdater` itself receives no `AuthorizationStore` dependency, and `TaskFeedbackHandler` must not infer acceptance from worker success.

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
| authorization sequential supersession                           | 2.2                     | same-session A→B atomic supersession, durable `plan_superseded`, exactly one active binding, old authorization rejection, other-session isolation |
| authorization concurrent supersession                           | 2.2                     | barrier-coordinated fresh-ID approvals traverse `AtomicPersistence` version mismatch and merge/retry, retain exactly one same-session active binding, terminalize old and losing bindings, preserve other-session active binding |
| authorization terminal dominance and cache consistency          | 2.2                     | same-ID terminal never resurrects; conflict-diverted candidate never updates cache; saved merged durable active binding is the cache value |
| JUS-P0-02 session-scoped cancel                                | 2.3, 3.4                | pathless parser, invalid flag combinations, durable release, no-binding idempotence, release-before-cancelled ordering, pending/claimed cancellation tombstone                            |
| terminal Authorization blocks review dispatch                  | 2.3, 3.4                | cancel or invalidation prevents initial/reissued directive and claim; restart does not revive a pending slot; tombstone failure remains fail-closed and later converges                  |
| terminal Authorization blocks review retry                     | 3.4                     | `review_execution_failed` and `lost_conclusive` terminal followed by cancel/restart creates no next pending, directive, or Acceptance progress                                      |
| terminal Authorization blocks pending recovery                 | 3.4                     | cancellation tombstone append failure followed by restart emits no pending directive, permits no claim, and later converges one tombstone                                              |
| cancellation serialization                                     | 3.4                     | terminal-Authorization claim completes without reentrant queue wait; external cancellation and claim serialize; A → B → C leaves no stale queue tail and at most one tombstone          |
| JUS-P0-03 seven-to-seven category mapping                      | 1.1                     | every role, legacy downgrade rejection                                                                                                                                                 |
| JUS-P0-03 doctor effective category configuration              | 1.2                     | JSONC parsing, source precedence, missing category, unreadable/unsupported source, redaction                                                                                           |
| JUS-P0-04 task lifecycle                                       | 3.1                     | full `authorized → in_progress → worker_reported → evidence_pending → review_pending` trace, fresh attempt, restart reconstruction                                                     |
| JUS-P0-04 attempt-scoped Evidence / Review / Gate              | 3.1, 3.2, 3.4, 3.5, 3.6 | stale attempt/call/child/artifact rejection, reviewRound reset on rework                                                                                                               |
| artifact reservation anti-replay                               | 3.4                     | safe path, collision retry with fresh UUID, bounded collision exhaustion, exists/directory I/O failure, invalid path, internal failure, unusable durable reservation and advisory      |
| unusable reservation blocks Acceptance                         | 3.4, 3.6                | fail-open review task execution, worker input without artifact path, no filesystem read or ReviewArtifact, blocked Acceptance                                                          |
| same-parent review claim serialization                          | 3.4                     | 2-call claim race and barrier-controlled overlapping 3-call race permit one critical section and exactly one claimed transition, binding, reservation, and authoritative call/artifact identity |
| atomic review claim                                             | 3.4                     | critical section re-reads latest durable records, projects, validates one pending slot, reserves, then appends claimed before publishing authority                                      |
| JUS-P0-04 review terminal atomicity                            | 3.6                     | one terminal physical record, failed append has no partial projection, deterministic replay, no pre-terminal acceptance                                                                |
| claimed + completion staging restart recovery                  | 3.6                     | staging durable, terminal append failure, restart recovery, no artifact/worker-output reread, exactly one terminal                                                                     |
| terminal to lifecycle crash recovery                           | 3.6                     | existing clean terminal is reused without artifact reread or terminal append; missing gate_pending / final_gate_pending transition is appended exactly once                            |
| clean terminal recovery                                        | 3.2, 3.6                | clean task and Final Review terminal recover gate_pending and current-identity Gate exactly once; repeated recovery creates no duplicate GateDecision or AcceptanceDecision             |
| findings terminal recovery                                     | 3.6                     | task and Final Review findings terminal recover rework_required / final_rework_required exactly once and never invoke Gate                                                            |
| terminal Authorization after completed terminal                | 3.2, 3.6                | completed terminal remains durable while terminal Authorization suppresses lifecycle promotion, Gate, Acceptance, and Progress                                                        |
| repeated post-terminal recovery                                | 3.2, 3.6                | terminal append, lifecycle transition, GateDecision, and AcceptanceDecision remain exactly once across repeated recovery                                                              |
| staged terminalization idempotency                             | 3.6                     | repeated recovery has no duplicate terminal, Gate, or Acceptance                                                                                                                        |
| staging recovery failure                                       | 3.6                     | claimed plus staging remains durable; no new dispatch, reservation, or round; Acceptance stays blocked                                                                                  |
| staging versus terminal Authorization                          | 2.3, 3.4, 3.6           | cancel/invalidation after staging prevents promotion; slot converges to cancelled; fresh approval does not reuse old state                                                              |
| terminal artifact classification                               | 3.6                     | clean → `completed`/Gate, findings → `completed_with_findings`/direct rework, incomplete → `review_incomplete`/blocked                                                                 |
| Task Review failure retry                                      | 3.4, 3.6                | `retries a task review with the same TaskExecutionRef and only reviewRound + 1` verifies the retained ref, incremented task round, absent `finalReviewRound`, and stale old-round rejection |
| Task implementation rework                                     | 3.1, 3.6                | fresh TaskExecutionRef and `reviewRound = 1` only after actual rework                                                                                                                  |
| Final Review failure retry                                     | 3.1, 3.4, 3.6           | `retries a Final Review with the same finalizationAttemptId and only finalReviewRound + 1` verifies retained identity, incremented final round, absent `reviewRound`; final stale PostToolUse/artifact/Gate replay is rejected |
| Final actual rework                                            | 3.1, 3.6                | findings or Final Gate WARN/FAIL enter final_rework_required, then issue fresh finalizationAttemptId and incremented finalReviewRound                                                    |
| terminal failure to retry-pending recovery                     | 3.4                     | `recovers a terminal-to-pending crash exactly once and only dispatches after durable pending` simulates committed terminal plus failed pending append, restart, and recovery                  |
| retry dispatch ordering                                        | 3.4                     | the terminal-to-pending crash test records `terminal-committed -> next-pending-committed -> directive-injected`; failed pending append has no directive                                  |
| retry recovery idempotency                                     | 3.4                     | the terminal-to-pending crash test runs recovery twice and verifies exactly one next-round `null -> pending` transition                                                               |
| stale old review round rejection                               | 3.4, 3.6                | task retry rejects old correlation; Final Review restart replay rejects old PostToolUse/artifact consumption/Gate and leaves the new correlation current                               |
| conclusive loss recovery                                       | 3.4, 3.6                | `lost_conclusive` terminalization occurs before a new round and uses the same union-safe retry helper                                                                                |
| uncertain claimed recovery                                     | 3.4, 3.6                | no automatic redispatch, artifact read, or Acceptance after restart                                                                                                                    |
| JUS-P0-04 Gate after `gate_pending`                            | 3.1, 3.2, 3.6           | no early evaluation, terminal review before gate_pending, active-Authorization guard before Gate and Acceptance append, unavailable/error blocked                                     |
| JUS-P0-04 finalization lifecycle                               | 3.1, 3.2, 3.4, 3.5, 3.6 | review-only retry preserves finalizationAttemptId and increments round; actual rework rotates identity; final review terminalization; stale Final Gate rejection; Final Gate PASS/rework/blocked |
| JUS-P0-04 durable review dispatch and child correlation        | 3.3, 3.4, 3.5           | runtime spike, pending/claimed recovery, parent-session critical section, concurrent claim, durable child binding                                                                      |
| JUS-P0-04 accepted task progress                               | 3.7                     | all unchecked steps checked, reparse completed, other tasks unchanged, zero-step no-op, durable acceptance ordering, old terminal-Authorization decision rejection                    |
| JSON review transport fixed for P0                             | 3.4, 3.6                | reservation anti-replay, unusable fail-open/blocked path, one usable-path read, composite terminal record; no typed transport dependency                                               |
| INV-01 through INV-05                                          | 1.1, 2.1, 2.2, 4.1      | category/routing/fingerprint/authorization focused tests named in those tasks                                                                                                          |
| INV-06 through INV-10                                          | 3.1, 3.2, 3.6, 3.7      | lifecycle, Gate, terminalization, progress, Final Gate tests named in those tasks                                                                                                      |
| INV-11 through INV-18                                          | 3.3, 3.4, 3.5, 3.6      | purpose separation, claim, restart, correlation, stale-event and consumption tests named in those tasks                                                                                |
| INV-19 terminal Authorization boundary                         | 2.3, 3.2, 3.4, 3.6, 3.7 | terminality guards for dispatch, claim, staged completion, Gate, Acceptance, progress, recovery, cancellation-tombstone failure, and fresh reapproval isolation                       |

| Plan Task | Requirement / Design Decision implemented                                  | Verification                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1       | JUS-P0-03, Design §5.3, INV-02, INV-05                                     | role-to-category mapping tests                                                                                                                                                     |
| 1.2       | JUS-P0-03, Design §3.4 and §5.3                                            | effective configuration and category-presence tests                                                                                                                                |
| 2.1       | JUS-P0-02, Design §4.3, INV-04                                             | fingerprint boundary tests                                                                                                                                                         |
| 2.2       | JUS-P0-02, Design §4.2 and §5.2, INV-03, INV-12, authorization cardinality | authorization persistence, fresh ID, same-ID terminal merge, sequential supersession, version-mismatch concurrent fresh-ID merge/retry, exactly-one-active, other-session preservation, cache/durable agreement, failed-save cache-retention tests |
| 2.3       | JUS-P0-02, Design §4.2, §4.8.1, and §5.2                                  | pathless cancel parser, durable release, and Task 3.4 cancellation-orchestration boundary tests                                                                                    |
| 3.1       | JUS-P0-04, Design §3.3, §4.4, §5.4, §5.5, INV-06, INV-09, INV-14           | lifecycle orchestration; review-only versus actual-rework finalization identity; replayed current final correlation tests                                                           |
| 3.2       | JUS-P0-02, JUS-P0-04, Design §4.6, §4.8.2, and §4.11, INV-07, INV-08, INV-10, INV-14, INV-19 | gate-pending-only, authorization guard before Gate and Acceptance append, current-identity Gate/Acceptance idempotency, decision ordering, blocked tests                      |
| 3.3       | JUS-P0-04, Design §4.9, INV-15                                             | child-session runtime spike                                                                                                                                                        |
| 3.4       | JUS-P0-02, JUS-P0-04, Design §4.8, §4.8.1, §4.8.2, §4.10, INV-11, INV-16, INV-17, INV-18, INV-19 | exact parent-session queue primitive; public cancellation wrapper versus within-parent helper; authorization guard before initial/reissued directive, claim, failure terminal, retry pending, and restart recovery; no-reentrant queue, terminal-to-pending crash recovery, durable-before-directive ordering, repeated recovery idempotency, and stale-round rejection tests |
| 3.5       | JUS-P0-04, Design §4.9, INV-14, INV-15, INV-17, INV-18                     | durable child-binding tests                                                                                                                                                        |
| 3.6       | JUS-P0-02, JUS-P0-04, Design §4.5, §4.8.1, §4.8.2, §4.10, §4.11, INV-13 through INV-19 | unusable no-read blocked path, authorization guard, staged terminalization and post-terminal outcome recovery, no reread, terminal reuse without reappend, lifecycle/Gate/Acceptance idempotency, failure blocking, mismatch rejection, terminal-auth precedence, composite terminal/replay tests |
| 3.7       | JUS-P0-02, JUS-P0-04, Design §3.3 and §5.4, INV-06, INV-08, INV-19        | accepted-only full progress update and old terminal-Authorization decision rejection tests                                                                                           |
| 4.1       | JUS-P0-01, Design §4.1, INV-01                                             | controller routing tests                                                                                                                                                           |
| 4.2       | JUS-P0-01, Design §3.4, §3.5, and §5.1                                     | effective pinned-command name-and-agent, precedence, redaction, template, and routing-observation tests                                                                            |

Phase 3 is incomplete if Task 3.3 cannot demonstrate both mandatory review correlations. It is incomplete if lifecycle orchestration, synchronous mandatory review canonicalization, terminal-Authorization guard, cancellation tombstone convergence, non-reentrant parent-session serialization, concurrent exactly-one claim, usable and unusable reservation branches, durable child binding, terminal classification, composite terminal record, staged-completion restart recovery without artifact/worker-output reread, post-terminal lifecycle/Gate recovery without terminal reappend, stale-event rejection, conclusive-loss recovery, uncertain-claimed blocking, attempt-scoped Gate/Acceptance idempotency, task Gate, Final Gate, or accepted-task progress lacks a passing automated test. A known runtime limitation documents an observation only; it never waives a P0 completion criterion.

<!-- markdownlint-enable MD013 MD060 -->

Before implementation handoff, inspect every implementation step for unresolved placeholders, ambiguous file paths, and unbound requirements. Verify that every test file in a Task's Files list appears in that Task's RED and GREEN command and its `git add` scope. Verify that every table row names an exact Task and RED/GREEN test, and that every Task row names its Design decision and Requirement. Do not hand off a plan with undefined work, implied test coverage, cross-task shorthand, or an atomicity statement without its exclusion mechanism.
