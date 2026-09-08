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
- Do not redefine an existing valid persisted `schemaVersion: 1` record as invalid. Runtime validator changes for durable schemas include replay coverage, and read compatibility never promotes a legacy record to current lifecycle / Gate / Acceptance authority.
- Treat `read → check → append` as exactly-once only inside the documented decision-identity serialization boundary; the in-memory boundary is never durable authority and is not a generic lock or idempotency framework.
- Persist authorization state only in `.justice/authorizations.json`; `ApprovedPlanBinding.canonicalSnapshot` is the sole durable canonical snapshot.
- Use `.justice/authorizations.conflict.json` only as `AtomicPersistence`'s non-authoritative failure journal; never hydrate it or use it for authorization, canonical snapshot, or active-plan restoration.
- A failed I/O boundary returns `PROCEED`; it must not produce `Authorized`, `Accepted`, or `Complete`.
- Mandatory `sp-review` and `sp-final-review` calls canonicalize `run_in_background` to `false`.
- A Phase 3 runtime spike that cannot prove `parentCallId -> childSessionId` correlation blocks Phase 3 and JUS-P0-04 completion.
- At every Phase or Phase 3 subsection boundary, after the final task's targeted `Confirm GREEN` and before that task's Step 5 commit, run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` inside `.devcontainer/`; the full gate must pass before the phase is committed.
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

**Produces:** `DoctorEffectiveConfigView = { readonly effectiveCategoryNames: readonly string[]; readonly effectiveCommandDefinitions: ReadonlyMap<string, DoctorEffectiveCommandDefinition>; readonly diagnostics: readonly (DoctorCommandDefinitionDiagnostic | DoctorSourceDiagnostic)[] }`; `DoctorEffectiveCommandDefinition = { readonly agent?: string }`; `DoctorCommandDefinitionDiagnostic` records only `source`, command name, and one of `null | scalar | array | agent_not_string | missing_agent`; `DoctorSourceDiagnostic` records only `source` and one of `unreadable | unsupported | parse_failure`; `ALL_SP_CATEGORIES: readonly SpCategory[]`; `checkSpCategoryPresence(categoryNames: readonly string[]): SpCategoryPresenceResult` where `SpCategoryPresenceResult` is `{ readonly missing: readonly SpCategory[]; readonly ok: boolean }`.

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

it.each([
  ["null", "null", "null"],
  ["scalar", "false", "scalar"],
  ["array", "[]", "array"],
] as const)("normalizes an invalid command shape (%s) before map insertion", (_name, value, reason) => {
  const effective = buildDoctorEffectiveConfigView([
    scanConfigText(
      "project",
      `{ command: { "justice-implement-brainstorming": ${value} } }`,
    ),
  ]);

  expect(effective.effectiveCommandDefinitions.get("justice-implement-brainstorming")).toEqual({});
  expect(effective.diagnostics).toContainEqual(
    expect.objectContaining({
      kind: "invalid_command_definition",
      commandName: "justice-implement-brainstorming",
      reason,
    }),
  );
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

Parse each readable supported JSONC source in `doctor-config.ts` and reduce it in existing `SOURCE_PRIORITY` order. For allowlisted top-level `category` and `command` objects, a higher-priority same-name key replaces the lower-priority value; do not deep-merge or union names. Before a command value enters `effectiveCommandDefinitions`, validate that it is a non-null non-array object and retain only a string `agent`; normalize null, scalar, array, or non-string `agent` to `{}` and append a redacted `DoctorCommandDefinitionDiagnostic` with no raw value. This makes malformed higher-priority values produce `missing_agent` instead of resurrecting a lower-priority agent or throwing in `justice doctor`. Export category names and, for commands only, the validated allowlisted `agent` field keyed by command name. Unreadable, unsupported, and parse-error sources contribute no effective values and retain redacted diagnostics. `doctor-cli.ts` passes `effectiveCategoryNames` to the checker and appends one non-zero-exit diagnostic for every missing name.

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
- Create: `src/core/error-annotation.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/runtime/validation.ts`
- Test: `tests/core/plan-fingerprint.test.ts`
- Test: `tests/core/v2/observation-model.test.ts`
- Test: `tests/runtime/validation.test.ts`
- Test: `tests/core/plan-parser.test.ts`

**Consumes:** `PlanParser.parse(content): PlanTask[]`; `hashString(value: string): string` from `src/core/v2/hash.ts`; approval-time task IDs from `PlanParser.parse(raw).map((task) => task.id)`; validation-time task IDs from `binding.canonicalSnapshot.tasks.map((task) => task.taskId)`; typed `error_annotation` observations from the durable log.

**Produces:** `buildCanonicalSnapshot(raw: string, approvedTaskIds: readonly string[]): CanonicalPlanSnapshot`; `computePlanFingerprint(raw: string, approvedTaskIds: readonly string[]): PlanFingerprint`; `createErrorAnnotationObservation(planPath: string, rawBeforeAnnotation: string, lineNumber: number): ErrorAnnotationObservation`; `migrateJusticeGeneratedErrorAnnotations(raw: string, planPath: string, observations: readonly PersistedLogRecord[]): MigrationResult`.
Export `CanonicalTaskSnapshot`, `CanonicalPlanSnapshot`, and `PlanFingerprint` from
`src/core/types.ts`; `plan-fingerprint.ts` imports these shared types rather than defining a
second fingerprint shape.

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

Add one replay test whose observed `error_annotation` identifies the exact legacy annotation line and expects migration to remove it. Add tests for a different `planPath`, a stale `planSnapshotDigest`, the second of two identical annotation lines, a manual annotation, and an unknown-provenance annotation; each must preserve the line and make the fingerprint change. Validate the typed observation through `observation-model.ts` and `runtime/validation.ts` before passing it to migration.

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-fingerprint.test.ts tests/core/plan-parser.test.ts tests/core/v2/observation-model.test.ts tests/runtime/validation.test.ts`

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
// src/core/types.ts
export type CanonicalTaskSnapshot = {
  readonly taskId: string;
  readonly title: string;
  readonly canonicalBody: string;
  readonly digest: string;
};

export type CanonicalPlanSnapshot = {
  readonly schema: "justice-plan-v1";
  readonly documentDigest: string;
  readonly globalBodyDigest: string;
  readonly tasks: ReadonlyArray<CanonicalTaskSnapshot>;
};

export type PlanFingerprint = {
  readonly algorithm: "sha256";
  readonly value: string;
};

// src/core/plan-fingerprint.ts
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

`createErrorAnnotationObservation` records the EOL-normalized raw plan digest, safe `planPath`, 1-based line number, occurrence among equal normalized lines, and normalized line digest; it never persists the annotation text. `migrateJusticeGeneratedErrorAnnotations` accepts only `provenance: "observed"` records whose plan path and raw snapshot digest match the current input and whose line number, occurrence, and line digest identify one exact line in that snapshot. Process multiple targets against the original line identities, delete only those exact lines, and emit a migration warning for every unmatched, cross-plan, stale-digest, manual, or unknown-provenance annotation. `PendingObservationRecord` and `PersistedLogRecord` must include the `error_annotation` variant, and strict validation/replay must reject unsafe paths, non-positive line identities, invalid digests, or malformed provenance.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-fingerprint.test.ts tests/core/plan-parser.test.ts tests/core/v2/observation-model.test.ts tests/runtime/validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

The commit scope explicitly includes the shared `src/core/types.ts` exports for
`CanonicalTaskSnapshot`, `CanonicalPlanSnapshot`, and `PlanFingerprint`; do not defer
that type contract to a later task or commit.

```bash
git add src/core/plan-fingerprint.ts src/core/error-annotation.ts src/core/types.ts src/core/v2/observation-model.ts src/runtime/validation.ts tests/core/plan-fingerprint.test.ts tests/core/plan-parser.test.ts tests/core/v2/observation-model.test.ts tests/runtime/validation.test.ts
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
`ApprovePlanInput` without `authorizationId`; `AuthorizationActivePlanReconciler`;
`AuthorizationStore.approve(input: ApprovePlanInput): Promise<ApprovedPlanBinding | null>` that always
generates a fresh authorizationId and leaves at most one active binding per session;
`AuthorizationStore.approveWithinAuthorizationReviewBoundary(input, reconcileActivePlan):
Promise<ApprovedPlanBinding | null>` for callers that already hold the shared boundary;
`AuthorizationMutationResult`; public
`AuthorizationStore.release(authorizationId, at): Promise<AuthorizationMutationResult>` and
`AuthorizationStore.invalidateForFingerprint(authorizationId, currentFingerprint, at):
Promise<AuthorizationMutationResult>`; `AuthorizationStore.hydrate(): Promise<readonly ApprovedPlanBinding[]>`;
`AuthorizationStore.findByAuthorizationId(authorizationId): Promise<ApprovedPlanBinding | null>`;
`AuthorizationReviewBoundary`; `createAuthorizationReviewBoundary(): AuthorizationReviewBoundary`; and the
domain-private `mergeAuthorizationBindings(mine: ReadonlyArray<ApprovedPlanBinding>,
theirs: ReadonlyArray<ApprovedPlanBinding>): ReadonlyArray<ApprovedPlanBinding>` used only as this
store's `AtomicPersistence.merge` hook. It is exported from this source module only so its array
contract can be tested; it is not re-exported by a package barrel and is not a public Justice API. It also
produces public boundary-acquiring `AuthorizationStore.release` / fingerprint invalidation operations and
their explicitly named `WithinAuthorizationReviewBoundary` counterparts:
`releaseWithinAuthorizationReviewBoundary(parentSessionId, authorizationId, at)` and
`invalidateForFingerprintWithinAuthorizationReviewBoundary(parentSessionId, authorizationId,
currentFingerprint, at)`. It produces one injected
`AuthorizationReviewBoundary` shared by the Authorization, PlanBridge,
review-dispatch, review-completion, and Gate domains. `ApprovedPlanBinding.sessionId` and review
`parentSessionId` use the same boundary key; the boundary serializes the durable commit and all
dependent state changes, but is not a generic transaction or mutex framework. The PlanBridge owns the
active-plan cache; AuthorizationStore receives no PlanBridge instance. Its approval inner operation invokes
the injected `AuthorizationActivePlanReconciler` only after a successful post-save authoritative reread,
and the callback never changes the approval return semantics.

- [ ] **Step 1: Write the failing persistence and hydration tests**

```ts
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value?: T) => void } {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve: (value) => resolve?.(value as T) };
}

function tracedAuthorizationReviewBoundary(): AuthorizationReviewBoundary & {
  readonly acquiresFor: (parentSessionId: string) => number;
  readonly reset: () => void;
} {
  const boundary = createAuthorizationReviewBoundary();
  const acquires = new Map<string, number>();
  return {
    withParentSession: async (parentSessionId, operation) => {
      acquires.set(parentSessionId, (acquires.get(parentSessionId) ?? 0) + 1);
      return boundary.withParentSession(parentSessionId, operation);
    },
    acquiresFor: (parentSessionId) => acquires.get(parentSessionId) ?? 0,
    reset: () => acquires.clear(),
  };
}

function trackAuthorizationWrites(files: MockFileSystem): {
  readonly count: () => number;
  readonly reset: () => void;
} {
  let count = 0;
  const originalWriteFile = files.writeFile.bind(files);
  files.writeFile = async (path, content) => {
    if (path.startsWith(".justice/authorizations.json.tmp.")) count += 1;
    await originalWriteFile(path, content);
  };
  return { count: () => count, reset: () => (count = 0) };
}

function createAuthorizationFixture(): {
  readonly files: MockFileSystem;
  readonly boundary: AuthorizationReviewBoundary;
  readonly store: AuthorizationStore;
} {
  const files = new MockFileSystem();
  const boundary = createAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  return { files, boundary, store };
}

function createAuthorizationAtomic(
  files: MockFileSystem,
): AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>> {
  return new AtomicPersistence(files, files, {
    filePath: ".justice/authorizations.json",
    conflictPath: ".justice/authorizations.conflict.json",
    serialize: (bindings) => JSON.stringify(bindings),
    deserialize: deserializeAuthorizationBindings,
    merge: mergeAuthorizationBindings,
    emptyValue: () => [],
  });
}

function fingerprintFor(planPath: string): PlanFingerprint {
  const encoded = [...planPath]
    .map((character) => character.charCodeAt(0).toString(16))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
  return { algorithm: "sha256", value: encoded };
}

function snapshotFor(planPath: string): CanonicalPlanSnapshot {
  return {
    schema: "justice-plan-v1",
    documentDigest: `sha256:${fingerprintFor(planPath).value}`,
    globalBodyDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    tasks: [
      {
        taskId: "task-1",
        title: planPath,
        canonicalBody: planPath,
        digest: `sha256:${fingerprintFor(planPath).value}`,
      },
    ],
  };
}

function inputFor(
  sessionId: string,
  planPath: string,
  approvedAt = "2026-09-05T00:00:00.000Z",
): ApprovePlanInput {
  return {
    sessionId,
    planPath,
    planFingerprint: fingerprintFor(planPath),
    canonicalSnapshot: snapshotFor(planPath),
    approvedAt,
  };
}

function freshBindingFor(
  sessionId: string,
  planPath: string,
  authorizationId: string,
): Extract<ApprovedPlanBinding, { readonly status: "active" }> {
  return {
    authorizationId,
    sessionId,
    planPath,
    planFingerprint: fingerprintFor(planPath),
    canonicalSnapshot: snapshotFor(planPath),
    fingerprintSchema: "justice-plan-v1",
    approvedAt: "2026-09-05T00:00:00.000Z",
    status: "active",
  };
}

function isBindingActiveFor(
  binding: ApprovedPlanBinding,
  sessionId: string,
  planPath: string,
  fingerprint: PlanFingerprint,
): boolean {
  return (
    binding.status === "active" &&
    binding.sessionId === sessionId &&
    binding.planPath === planPath &&
    binding.planFingerprint.algorithm === fingerprint.algorithm &&
    binding.planFingerprint.value === fingerprint.value
  );
}

function authorizationPersistenceOf(
  store: AuthorizationStore,
): AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>> {
  return (
    store as unknown as {
      readonly authorizationPersistence: AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>;
    }
  ).authorizationPersistence;
}

function createAuthorizationPlanBridge(
  files: MockFileSystem,
  authorizationStore: AuthorizationStore,
  authorizationReviewBoundary: AuthorizationReviewBoundary,
): PlanBridge {
  const bridge = new PlanBridge(files);
  bridge.setAuthorizationDependencies({ authorizationStore, authorizationReviewBoundary });
  return bridge;
}

function approveRequestFor(planPath: string): ImplementationArmRequest {
  return { source: "command", planPath, approved: true };
}

async function writePlanFixture(files: MockFileSystem, planPath: string): Promise<void> {
  await files.writeFile(planPath, "# Plan\n\n- [ ] task-1: authorize this plan\n");
}

let files: MockFileSystem;
let boundary: AuthorizationReviewBoundary;
let store: AuthorizationStore;
let input: ApprovePlanInput;
let authorizationAtomic: AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>;

beforeEach(() => {
  const fixture = createAuthorizationFixture();
  files = fixture.files;
  boundary = fixture.boundary;
  store = fixture.store;
  input = inputFor("s1", "docs/p.md");
  authorizationAtomic = createAuthorizationAtomic(files);
});

const oldActiveBinding = freshBindingFor("s1", "docs/old.md", "old-id");
const staleActive = freshBindingFor("s1", "docs/stale.md", "stale-id");
const releasedBinding: ApprovedPlanBinding = {
  ...freshBindingFor("s1", "docs/released.md", "released-id"),
  status: "released",
  releasedAt: "2026-09-05T00:00:00.000Z",
};
const changedFingerprint = fingerprintFor("docs/changed.md");

// Every Store test uses an explicit boundary. No test creates a Store without its boundary.

it("stores the canonical snapshot in the same authorization record", async () => {
  const binding = await store.approve(input);
  expect(binding?.canonicalSnapshot.documentDigest).toBe(input.canonicalSnapshot.documentDigest);
  expect((await authorizationAtomic.loadWithLock()).data[0]?.canonicalSnapshot).toEqual(
    input.canonicalSnapshot,
  );
});

it("hydrates an active binding and rejects a changed fingerprint", async () => {
  const binding = await store.approve(input);
  expect((await store.hydrate())[0]?.status).toBe("active");
  expect(isBindingActiveFor(binding!, "s1", "docs/p.md", changedFingerprint)).toBe(false);
});

it("never hydrates or authorizes from the non-authoritative conflict journal", async () => {
  const conflictBinding = freshBindingFor("s1", "docs/from-conflict.md", "conflict-id");
  await files.writeFile(
    ".justice/authorizations.conflict.json",
    JSON.stringify({
      version: 1,
      conflicts: [
        {
          version: 1,
          reason: "version_mismatch",
          data: [conflictBinding],
          recordedAt: "2026-09-05T00:00:00.000Z",
        },
      ],
    }),
  );

  await expect(store.hydrate()).resolves.toEqual([]);
  await expect(store.findByAuthorizationId("conflict-id")).resolves.toBeNull();
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
  expect(mergeAuthorizationBindings([staleActive], [releasedBinding])).toEqual([releasedBinding]);
});

it("chooses the deterministic winner across active candidates from both merge sides", () => {
  const mine = { ...freshBindingFor("s1", "docs/mine.md", "mine"), approvedAt: "2026-09-05T00:00:01.000Z" };
  const theirs = { ...freshBindingFor("s1", "docs/theirs.md", "theirs"), approvedAt: "2026-09-05T00:00:02.000Z" };

  expect(mergeAuthorizationBindings([mine], [theirs])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ authorizationId: "theirs", status: "active" }),
      expect.objectContaining({
        authorizationId: "mine",
        status: "invalidated",
        invalidationReason: "plan_superseded",
      }),
    ]),
  );
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

  expect(
    durable.filter((binding) => binding.sessionId === "s1" && binding.status === "active"),
  ).toHaveLength(1);
  expect(
    durable.find((binding) => binding.authorizationId === oldActiveBinding.authorizationId),
  ).toMatchObject({
    status: "invalidated",
    invalidationReason: "plan_superseded",
  });
});

it("serializes same-process same-session approvals without a filesystem conflict", async () => {
  const boundary = createAuthorizationReviewBoundary();
  const files = new MockFileSystem();
  const store = new AuthorizationStore(files, files, boundary);
  const firstMutationEntered = deferred<void>();
  const releaseFirstMutation = deferred<void>();
  const originalWriteFile = files.writeFile.bind(files);
  let holdFirstAuthorizationWrite = false;
  let activeMutationBodies = 0;
  let maximumMutationBodies = 0;
  files.writeFile = async (path, content) => {
    if (holdFirstAuthorizationWrite && path.startsWith(".justice/authorizations.json.tmp.")) {
      activeMutationBodies += 1;
      maximumMutationBodies = Math.max(maximumMutationBodies, activeMutationBodies);
      firstMutationEntered.resolve();
      await releaseFirstMutation.promise;
      activeMutationBodies -= 1;
    }
    await originalWriteFile(path, content);
  };

  const old = await store.approve(inputFor("s1", "docs/old.md"));
  holdFirstAuthorizationWrite = true;
  const approvalA = store.approve(inputFor("s1", "docs/a.md"));
  await firstMutationEntered.promise;
  const approvalB = store.approve(inputFor("s1", "docs/b.md"));
  releaseFirstMutation.resolve();
  const [a, b] = await Promise.all([approvalA, approvalB]);
  const durable = await store.hydrate();
  const active = durable.filter(
    (binding) => binding.sessionId === "s1" && binding.status === "active",
  );

  expect(maximumMutationBodies).toBe(1);
  expect([a, b].filter((binding) => binding !== null)).toHaveLength(2);
  expect(active).toHaveLength(1);
  expect(durable.find((binding) => binding.authorizationId === old?.authorizationId)).toMatchObject({
    status: "invalidated",
    invalidationReason: "plan_superseded",
  });
  expect(
    durable.filter(
      (binding) =>
        (binding.authorizationId === a?.authorizationId || binding.authorizationId === b?.authorizationId) &&
        binding.status === "invalidated",
    ),
  ).toEqual([expect.objectContaining({ invalidationReason: "plan_superseded" })]);
  expect(
    [a, b].some(
      (binding) => binding?.authorizationId === active[0]?.authorizationId,
    ),
  ).toBe(true);
});

it("merges a cross-process version conflict through independent boundaries", async () => {
  const firstTwoLinkAttempts = deferred<void>();
  const firstClaimCompleted = deferred<void>();
  const files = new MockFileSystem();
  const boundaryA = createAuthorizationReviewBoundary();
  const boundaryB = createAuthorizationReviewBoundary();
  const storeA = new AuthorizationStore(files, files, boundaryA);
  const storeB = new AuthorizationStore(files, files, boundaryB);
  const originalLink = files.link.bind(files);
  let coordinateContenders = false;
  let linkAttempts = 0;
  files.link = async (target, claimPath) => {
    if (!coordinateContenders) return originalLink(target, claimPath);
    linkAttempts += 1;
    if (linkAttempts <= 2) {
      if (linkAttempts === 1) {
        firstTwoLinkAttempts.resolve();
        await firstTwoLinkAttempts.promise;
        await originalLink(target, claimPath);
        firstClaimCompleted.resolve();
        return;
      }
      await firstTwoLinkAttempts.promise;
      await firstClaimCompleted.promise;
    }
    await originalLink(target, claimPath);
  };

  const old = await storeA.approve(inputFor("s1", "docs/old.md"));
  const other = await storeA.approve(inputFor("s2", "docs/other.md"));
  coordinateContenders = true;
  const approvalA = storeA.approve(inputFor("s1", "docs/a.md", "2026-09-05T00:00:02.000Z"));
  const approvalB = storeB.approve(inputFor("s1", "docs/b.md", "2026-09-05T00:00:01.000Z"));
  await firstTwoLinkAttempts.promise;
  const [a, b] = await Promise.all([approvalA, approvalB]);
  const durable = await storeA.hydrate();
  const active = durable.filter(
    (binding) => binding.sessionId === "s1" && binding.status === "active",
  );
  const freshDurable = durable.filter(
    (binding) =>
      binding.sessionId === "s1" &&
      (binding.planPath === "docs/a.md" || binding.planPath === "docs/b.md"),
  );
  const freshWinner = freshDurable.find((binding) => binding.status === "active");
  const freshLoser = freshDurable.find(
    (binding) =>
      binding.status === "invalidated" && binding.invalidationReason === "plan_superseded",
  );

  // The first two link attempts are coordinated contenders; the third observes the winner's
  // published version and enters the real version-mismatch merge/retry path.
  expect(linkAttempts).toBeGreaterThanOrEqual(4);
  expect(active).toHaveLength(1);
  expect(freshDurable.filter((binding) => binding.status === "active")).toHaveLength(1);
  expect(freshLoser).toBeDefined();
  expect(freshLoser).toMatchObject({
    status: "invalidated",
    invalidationReason: "plan_superseded",
  });
  expect(freshWinner).toEqual(active[0]);
  const winnerResult = freshWinner?.planPath === "docs/a.md" ? a : b;
  const loserResult = freshLoser?.planPath === "docs/a.md" ? a : b;
  expect(winnerResult).toEqual(freshWinner);
  expect(loserResult).toBeNull();
  expect(durable.find((binding) => binding.authorizationId === old?.authorizationId)).toMatchObject({
    status: "invalidated",
    invalidationReason: "plan_superseded",
  });
  expect(durable.find((binding) => binding.authorizationId === other?.authorizationId)).toMatchObject({
    status: "active",
  });
});

it("acquires the public release boundary once while the inner release acquires none", async () => {
  const boundary = tracedAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  const active = await store.approve(inputFor("s1", "docs/p.md"));
  boundary.reset();

  await expect(store.release(active!.authorizationId, "2026-09-05T00:00:00.000Z")).resolves.toMatchObject({
    kind: "saved",
  });
  expect(boundary.acquiresFor("s1")).toBe(1);
  await expect(
    store.releaseWithinAuthorizationReviewBoundary(
      "s1",
      active!.authorizationId,
      "2026-09-05T00:00:00.000Z",
    ),
  ).resolves.toMatchObject({ kind: "already_terminal" });
  expect(boundary.acquiresFor("s1")).toBe(1);
});

it("rejects a within-boundary release for the wrong parent without durable mutation", async () => {
  const boundary = createAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  const writes = trackAuthorizationWrites(files);
  const active = await store.approve(inputFor("s1", "docs/p.md"));
  writes.reset();

  await expect(
    store.releaseWithinAuthorizationReviewBoundary(
      "s2",
      active!.authorizationId,
      "2026-09-05T00:00:00.000Z",
    ),
  ).resolves.toEqual({ kind: "wrong_parent" });
  expect(writes.count()).toBe(0);
  expect((await store.hydrate()).find((binding) => binding.authorizationId === active!.authorizationId))
    .toMatchObject({ status: "active" });
});

it("acquires the public fingerprint-invalidation boundary once while the inner mutation acquires none", async () => {
  const boundary = tracedAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  const active = await store.approve(inputFor("s1", "docs/p.md"));
  boundary.reset();

  await expect(
    store.invalidateForFingerprint(
      active!.authorizationId,
      changedFingerprint,
      "2026-09-05T00:00:00.000Z",
    ),
  ).resolves.toMatchObject({ kind: "saved" });
  expect(boundary.acquiresFor("s1")).toBe(1);
  await expect(
    store.invalidateForFingerprintWithinAuthorizationReviewBoundary(
      "s1",
      active!.authorizationId,
      changedFingerprint,
      "2026-09-05T00:00:00.000Z",
    ),
  ).resolves.toMatchObject({ kind: "already_terminal" });
  expect(boundary.acquiresFor("s1")).toBe(1);
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
  const persistence = authorizationPersistenceOf(store);
  vi.spyOn(persistence, "saveAtomicWithLock").mockResolvedValueOnce({
    status: "conflict_diverted",
    retries: 3,
    conflictPath: ".justice/authorizations.conflict.json",
  });

  await expect(store.approve(inputFor("s1", "docs/b.md"))).resolves.toBeNull();
  expect(await store.hydrate()).toEqual([planA]);
});

it("reconciles the explicit PlanBridge cache only from the tested Store authority", async () => {
  const files = new MockFileSystem();
  const boundary = createAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  await writePlanFixture(files, "docs/a.md");

  const result = await bridge.handleImplementationArm("s1", approveRequestFor("docs/a.md"));
  const durable = await store.hydrate();
  const active = durable.find((binding) => binding.sessionId === "s1" && binding.status === "active");

  expect(result).toMatchObject({ armed: true, planPath: active?.planPath });
  expect(bridge.getActivePlan("s1")).toBe(active?.planPath);
});

it("does not arm or retain a positive cache when post-save authoritative reread fails", async () => {
  const files = new MockFileSystem();
  const boundary = createAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  await writePlanFixture(files, "docs/old.md");
  await writePlanFixture(files, "docs/new.md");
  await bridge.handleImplementationArm("s1", approveRequestFor("docs/old.md"));

  let failPostSaveRead = false;
  const originalReadFile = files.readFile.bind(files);
  const originalRename = files.rename.bind(files);
  files.rename = async (from, to) => {
    await originalRename(from, to);
    if (to === ".justice/authorizations.json") failPostSaveRead = true;
  };
  files.readFile = async (path) => {
    if (failPostSaveRead && path === ".justice/authorizations.json") {
      throw new Error("post-save authoritative reread failed");
    }
    return originalReadFile(path);
  };

  const result = await bridge.handleImplementationArm("s1", approveRequestFor("docs/new.md"));
  failPostSaveRead = false;
  const durable = await store.hydrate();

  expect(result).toMatchObject({ armed: false });
  expect(bridge.getActivePlan("s1")).toBeNull();
  expect(durable.some((binding) => binding.planPath === "docs/new.md" && binding.status === "active")).toBe(true);
});

it("serializes same-parent operations while another parent can proceed", async () => {
  const enteredA = deferred<void>();
  const releaseA = deferred<void>();
  const boundary = createAuthorizationReviewBoundary();
  let concurrent = 0;
  let maximumConcurrent = 0;
  const a = boundary.withParentSession("s1", async () => {
    concurrent += 1;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    enteredA.resolve();
    await releaseA.promise;
    concurrent -= 1;
  });
  await enteredA.promise;
  const b = boundary.withParentSession("s1", async () => {
    concurrent += 1;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    concurrent -= 1;
  });
  let differentParentStarted = false;
  await boundary.withParentSession("s2", async () => {
    differentParentStarted = true;
  });
  expect(differentParentStarted).toBe(true);
  releaseA.resolve();
  await Promise.all([a, b]);
  expect(maximumConcurrent).toBe(1);
});

it("continues a parent queue after a rejected predecessor", async () => {
  const boundary = createAuthorizationReviewBoundary();
  await expect(
    boundary.withParentSession("s1", async () => {
      throw new Error("expected predecessor failure");
    }),
  ).rejects.toThrow("expected predecessor failure");
  await expect(boundary.withParentSession("s1", async () => "next")).resolves.toBe("next");
});

it("does not let old cleanup delete a newer same-parent tail", async () => {
  const boundary = createAuthorizationReviewBoundary();
  const enteredA = deferred<void>();
  const releaseA = deferred<void>();
  const enteredB = deferred<void>();
  const releaseB = deferred<void>();
  const order: string[] = [];
  const a = boundary.withParentSession("s1", async () => {
    order.push("a");
    enteredA.resolve();
    await releaseA.promise;
  });
  await enteredA.promise;
  const b = boundary.withParentSession("s1", async () => {
    order.push("b");
    enteredB.resolve();
    await releaseB.promise;
  });
  releaseA.resolve();
  await enteredB.promise;
  const c = boundary.withParentSession("s1", async () => {
    order.push("c");
  });
  releaseB.resolve();
  await Promise.all([a, b, c]);
  expect(order).toEqual(["a", "b", "c"]);
});
```

Every `AuthorizationStore` fixture in this task, including shared `beforeEach` fixtures and both stores in
the cross-process test, passes an explicit `AuthorizationReviewBoundary`; do not add an optional or test-only
boundary fallback. The same-process test intentionally holds only the first authorization mutation and then
releases it, so it verifies serialization without manufacturing a persistence conflict or waiting for a second
same-boundary contender. The cross-process test uses separate boundaries and a shared filesystem so both
stores observe the old version. Its forced retry must execute `AtomicPersistence`'s configured
`mergeAuthorizationBindings` hook, not a test replacement; the durable losing fresh authorization is therefore
the deterministic `plan_superseded` result of the real merge/retry path. Cache assertions are not made in this
core Store test. The hook integration fixture below constructs the same `AuthorizationStore`, the same shared
boundary, and the PlanBridge that receives that Store explicitly.

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-authorization.test.ts tests/hooks/plan-bridge-authorization.test.ts`

Before running RED, add only the compile-only typed scaffold required by the exact `AuthorizationStore`
signatures in **Produces** if the new module does not yet exist. The scaffold is created after the tests are
written, is not a fallback boundary, and is replaced by Step 3 before any commit. RED must therefore fail on
intended behavioral assertions rather than module resolution, missing methods, or a deadlock. The expected
failures are: canonical snapshot persistence/hydration, fresh-ID supersession, terminal-dominant merge,
same-parent approval serialization, real version-mismatch merge/retry, loser return semantics, explicit
PlanBridge cache wiring, failed-save non-publication, and post-save reread failure fail-closed behavior.

- [ ] **Step 3: Implement the authorization store**

Use exactly `.justice/authorizations.json` and `.justice/authorizations.conflict.json` as the
`AtomicPersistence` paths. Store only `ReadonlyArray<ApprovedPlanBinding>`. `ApprovePlanInput` must not
accept a caller-provided authorizationId. For approval, load the authoritative array and construct one
replacement array: map only same-session active bindings to `{ status: "invalidated", invalidatedAt,
invalidationReason: "plan_superseded" }`, retain every terminal and other-session binding, then append one
fresh active binding. Submit that complete array and the loaded `LockMetadata` through one
`AtomicPersistence.saveAtomicWithLock` call. A `saved` result is only a durable merge success; it is not a
positive approval result until the authoritative post-save reread proves that the fresh ID is the sole current
active binding for the requested session. On `conflict_diverted` or exception, return `null`, do not invoke
the cache reconciler, retain the prior cache, and leave enrichment unauthorized. On post-save reread failure,
invoke the reconciler with `null`, clear the local positive cache, return `null`, and leave enrichment
unauthorized. On plugin initialization, hydrate active bindings from the authoritative array only and restore
their `planPath` into PlanBridge; terminal bindings and any read/parse/validation failure restore no active
binding. Do not add a transaction framework. `findByAuthorizationId` reads only the authoritative binding
array and returns the exact matching binding or `null`; callers treat `null`, a read failure, or a persistence
conflict as non-active. It must never read `.justice/authorizations.conflict.json` or infer authority from the
active-plan cache.

`AuthorizationStore.approve` is the boundary-external wrapper and keeps the public
`Promise<ApprovedPlanBinding | null>` signature. It acquires `AuthorizationReviewBoundary` once using
`input.sessionId`, then calls `approveWithinAuthorizationReviewBoundary` without acquiring again. The
PlanBridge path does not call this wrapper; it already owns the same parent boundary and passes its explicit
cache reconciler to the inner operation. The complete class body below is the implementation source of truth
for the approval, authoritative reread, and hydrate behavior.

Add an explicit authorization dependency setter to the existing PlanBridge construction path so the existing
non-authorization constructor arguments remain unchanged while the production plugin wires the shared objects
exactly once. The setter is not a boundary factory or fallback: an implementation-arm request received before
this wiring is fail-closed and cannot arm, and authorization tests must call it before exercising approval.

```ts
export type PlanBridgeAuthorizationDependencies = {
  readonly authorizationStore: AuthorizationStore;
  readonly authorizationReviewBoundary: AuthorizationReviewBoundary;
};

private authorizationDependencies: PlanBridgeAuthorizationDependencies | null = null;

setAuthorizationDependencies(dependencies: PlanBridgeAuthorizationDependencies): void {
  if (this.authorizationDependencies !== null) {
    throw new Error("PlanBridge authorization dependencies already configured");
  }
  this.authorizationDependencies = dependencies;
}

private reconcileActivePlan(
  parentSessionId: string,
  activeBinding: Extract<ApprovedPlanBinding, { readonly status: "active" }> | null,
): void {
  this.setActivePlan(parentSessionId, activeBinding?.planPath ?? null);
}

async restoreActivePlans(): Promise<void> {
  const dependencies = this.authorizationDependencies;
  if (dependencies === null) return;
  const bindings = await dependencies.authorizationStore.hydrate();
  for (const binding of bindings) {
    if (binding.status === "active") {
      this.reconcileActivePlan(binding.sessionId, binding);
    }
  }
}
```

Replace the approved branch of `PlanBridge.handleImplementationArm` with this exact path after the existing
safe-plan read and `request.approved` check:

```ts
const dependencies = this.authorizationDependencies;
if (dependencies === null) {
  return {
    armed: false,
    planPath: null,
    directiveStage: "implementation_arm_required",
    guidance: formatWorkflowDirective({ stage: "implementation_arm_required" }),
  };
}

const planContent = await this.readPlanFile(planPath);
if (planContent === null) {
  return {
    armed: false,
    planPath: null,
    directiveStage: "implementation_arm_required",
    guidance: formatWorkflowDirective({ stage: "implementation_arm_required" }),
  };
}
const approvedTaskIds = this.parser.parse(planContent).map((task) => task.id);
const approvalInput: ApprovePlanInput = {
  sessionId,
  planPath,
  canonicalSnapshot: buildCanonicalSnapshot(planContent, approvedTaskIds),
  planFingerprint: computePlanFingerprint(planContent, approvedTaskIds),
  approvedAt: new Date().toISOString(),
};
const approved = await dependencies.authorizationReviewBoundary.withParentSession(sessionId, () =>
  dependencies.authorizationStore.approveWithinAuthorizationReviewBoundary(
    approvalInput,
    (parentSessionId, activeBinding) =>
      this.reconcileActivePlan(parentSessionId, activeBinding),
  ),
);
if (approved === null) {
  return {
    armed: false,
    planPath: null,
    directiveStage: "implementation_arm_required",
    guidance: formatWorkflowDirective({ stage: "implementation_arm_required" }),
  };
}

this.implementationArmedSessions.set(sessionId, { planPath: approved.planPath });
return {
  armed: true,
  planPath: approved.planPath,
  directiveStage: "implementation_arm",
  guidance: formatWorkflowDirective({ stage: "implementation_arm", planPath: approved.planPath }),
};
```

Task 2.1's `buildCanonicalSnapshot` and `computePlanFingerprint` receive the parser-derived task IDs from the
same raw plan. This validates the safe relative path, builds the `CanonicalPlanSnapshot`, and computes the
`PlanFingerprint` without accepting or forwarding a caller-supplied `authorizationId`. A losing approval
returns `null` and never arms the requested plan; its
reconciler may instead set the cache to the latest durable winner. A save conflict does not invoke the
reconciler and therefore retains the prior cache. A post-save reread failure invokes the reconciler with
`null`, clearing the local positive cache. No requested plan is written to `activePlanPaths` outside the
reconciler.

The `AtomicPersistence.merge` hook must merge the entire binding array, not only two records. It is used both
by `saveAtomicWithLock(candidate)` when no `LockMetadata` is supplied and by its version-mismatch retry.
`mine` is the approval candidate being retried and `theirs` is the latest durable array. `mergeSameAuthorizationId` returns
terminal. `invalidateSuperseded` creates only the Design §4.2 invalidated shape. After same-ID merging, collect
every remaining active binding from both arrays for each session, including an active `mine` record absent from
`theirs` and any active `theirs` record. Choose one winner by `approvedAt` descending and, on a tie,
`authorizationId` ascending; do not give `mine` implicit priority. Invalidate every other active binding in that
session and retain all other-session bindings unchanged. This makes the deterministic winner the sole active
binding without modifying `AtomicPersistence` itself.

Implement `createAuthorizationReviewBoundary` in this module and call it exactly once during plugin
construction. Its `withParentSession(parentSessionId, operation)` is the only serialization boundary
shared by Authorization and review state. The plugin passes this same instance to `AuthorizationStore`,
`PlanBridge`, the Task 3.2 Gate evaluator, the Task 3.4 Review Dispatch factory, and the Task 3.6 Review
Completion factory; no domain constructs its own map. Task 3.6 adds the cross-domain integration fixture
that proves operations supplied to those consumers for one parent actually serialize on this instance.

`AuthorizationStore.approve`, public `release`, and public fingerprint invalidation acquire the boundary
using the immutable binding `sessionId`. The public release and invalidation wrappers first read the
authoritative binding by exact `authorizationId`; missing or unreadable bindings return their defined
non-success result without acquiring a guessed parent key. Each public mutation then delegates to an
explicitly named domain operation that assumes ownership is already held:
`releaseWithinAuthorizationReviewBoundary(parentSessionId, authorizationId, at)` and
`invalidateForFingerprintWithinAuthorizationReviewBoundary(parentSessionId, authorizationId,
currentFingerprint, at)`. Those inner operations re-read durable state, exact-match the authorization ID,
require `binding.sessionId === parentSessionId`, perform only their Authorization mutation, and never
acquire the boundary. Release changes only an active binding to `released`; fingerprint invalidation changes
only an active binding whose stored fingerprint differs from `currentFingerprint` to `invalidated`. Missing,
wrong-parent, already-terminal, and unchanged-fingerprint cases are deterministic non-successes. Each inner
operation performs one `AtomicPersistence.saveAtomicWithLock` call; only `saved` returns a saved result,
while an exception returns `failed` and conflict diversion returns `uncertain`. Neither inner operation
updates a cache or restores a terminal binding to active.

PlanBridge's combined release or invalidation path acquires the boundary once, calls the matching inner
Authorization operation, requires its `saved` result, then calls Task 3.4's within-boundary
review-cancellation helper, updates the active-plan cache, and only then releases the boundary. A non-saved
terminal mutation returns fail-closed before cancellation or cache publication. It must never call a public
mutation wrapper while it already owns the boundary. A standalone authorization recheck outside this boundary
is never sufficient to authorize a later state change. On restart, durable Authorization terminality and the
observation log remain authoritative; the process-local boundary is recreated empty.

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

export type AuthorizationReviewBoundary = {
  readonly withParentSession: <T>(
    parentSessionId: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
};

export function createAuthorizationReviewBoundary(): AuthorizationReviewBoundary {
  const tails = new Map<string, Promise<void>>();
  return {
    async withParentSession<T>(parentSessionId: string, operation: () => Promise<T>): Promise<T> {
      const predecessor = (tails.get(parentSessionId) ?? Promise.resolve()).catch(() => undefined);
      let releaseCurrent: () => void = () => undefined;
      const currentCompletion = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
      });
      const currentTail = predecessor.then(() => currentCompletion);
      tails.set(parentSessionId, currentTail);
      await predecessor;
      try {
        return await operation();
      } finally {
        releaseCurrent();
        if (tails.get(parentSessionId) === currentTail) tails.delete(parentSessionId);
      }
    },
  };
}

// src/core/justice-plugin.ts -- the one construction site retained by Tasks 3.2, 3.4, and 3.6.
private readonly authorizationReviewBoundary: AuthorizationReviewBoundary;
private readonly authorizationStore: AuthorizationStore;

constructor(fileReader: FileReader, fileWriter: FileWriter, options: JusticePluginOptions = {}) {
  this.authorizationReviewBoundary = createAuthorizationReviewBoundary();
  this.authorizationStore = new AuthorizationStore(
    fileReader,
    fileWriter,
    this.authorizationReviewBoundary,
  );
  this.planBridge = new PlanBridge(
    fileReader,
    this.loopHandler,
    this.tieredWisdomStore,
    options.notifier,
    this.telemetry,
  );
  this.planBridge.setAuthorizationDependencies({
    authorizationStore: this.authorizationStore,
    authorizationReviewBoundary: this.authorizationReviewBoundary,
  });
}

async initialize(): Promise<void> {
  try {
    await this.planBridge.restoreActivePlans();
    // Continue with the existing wisdom, telemetry, projection, and notifier initialization.
  } catch {
    // The Store already fails closed; startup restoration must never block plugin initialization.
  }
}

// Tasks 3.2, 3.4, and 3.6 pass this same field, never a newly constructed boundary,
// to the Gate evaluator, Review Dispatch factory, and Review Completion factory respectively.

export type AuthorizationMutationResult =
  | {
      readonly kind: "saved";
      readonly binding: Exclude<ApprovedPlanBinding, { readonly status: "active" }>;
    }
  | {
      readonly kind:
        | "not_found"
        | "wrong_parent"
        | "already_terminal"
        | "fingerprint_current"
        | "failed"
        | "uncertain";
    };

export class AuthorizationStore {
  private readonly authorizationPersistence: AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>;

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly authorizationReviewBoundary: AuthorizationReviewBoundary,
  ) {
    this.authorizationPersistence = new AtomicPersistence(fileReader, fileWriter, {
      filePath: ".justice/authorizations.json",
      conflictPath: ".justice/authorizations.conflict.json",
      serialize: (bindings) => JSON.stringify(bindings),
      deserialize: deserializeAuthorizationBindings,
      merge: mergeAuthorizationBindings,
      emptyValue: () => [],
    });
  }

  async approve(input: ApprovePlanInput): Promise<ApprovedPlanBinding | null> {
    return this.authorizationReviewBoundary.withParentSession(input.sessionId, () =>
      this.approveWithinAuthorizationReviewBoundary(input, () => undefined),
    );
  }

  async approveWithinAuthorizationReviewBoundary(
    input: ApprovePlanInput,
    reconcileActivePlan: AuthorizationActivePlanReconciler,
  ): Promise<ApprovedPlanBinding | null> {
    let current: Awaited<ReturnType<AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>["loadWithLock"]>>;
    try {
      current = await this.authorizationPersistence.loadWithLock();
    } catch {
      return null;
    }

    const fresh: Extract<ApprovedPlanBinding, { readonly status: "active" }> = {
      authorizationId: randomUUID(),
      sessionId: input.sessionId,
      planPath: input.planPath,
      planFingerprint: input.planFingerprint,
      canonicalSnapshot: input.canonicalSnapshot,
      fingerprintSchema: "justice-plan-v1",
      approvedAt: input.approvedAt,
      status: "active",
    };
    const candidate: ReadonlyArray<ApprovedPlanBinding> = [
      ...current.data.map((binding) =>
        binding.sessionId === input.sessionId && binding.status === "active"
          ? invalidateSuperseded(binding, input.approvedAt)
          : binding,
      ),
      fresh,
    ];

    let saved: SaveResult;
    try {
      saved = await this.authorizationPersistence.saveAtomicWithLock(candidate, current.lockMeta);
    } catch {
      return null;
    }
    if (saved.status !== "saved") return null;

    let authoritative: Awaited<
      ReturnType<AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>["loadWithLock"]>
    >;
    try {
      authoritative = await this.authorizationPersistence.loadWithLock();
    } catch {
      reconcileActivePlan(input.sessionId, null);
      return null;
    }

    const activeBindings = authoritative.data.filter(
      (binding): binding is Extract<ApprovedPlanBinding, { readonly status: "active" }> =>
        binding.sessionId === input.sessionId && binding.status === "active",
    );
    const active = activeBindings[0];
    if (activeBindings.length !== 1 || active === undefined) {
      reconcileActivePlan(input.sessionId, null);
      return null;
    }

    const own = authoritative.data.find((binding) => binding.authorizationId === fresh.authorizationId);
    if (own?.status !== "active" || active.authorizationId !== fresh.authorizationId) {
      reconcileActivePlan(input.sessionId, active);
      return null;
    }

    reconcileActivePlan(input.sessionId, active);
    return active;
  }

  async hydrate(): Promise<readonly ApprovedPlanBinding[]> {
    try {
      const current = await this.authorizationPersistence.loadWithLock();
      return current.data;
    } catch {
      return [];
    }
  }

  async findByAuthorizationId(authorizationId: string): Promise<ApprovedPlanBinding | null> {
    const current = await this.authorizationPersistence.loadWithLock();
    return current.data.find((binding) => binding.authorizationId === authorizationId) ?? null;
  }

  async release(authorizationId: string, at: string): Promise<AuthorizationMutationResult> {
    let binding: ApprovedPlanBinding | null;
    try {
      binding = await this.findByAuthorizationId(authorizationId);
    } catch {
      return { kind: "failed" };
    }
    if (binding === null) return { kind: "not_found" };
    return this.authorizationReviewBoundary.withParentSession(binding.sessionId, () =>
      this.releaseWithinAuthorizationReviewBoundary(binding.sessionId, authorizationId, at),
    );
  }

  async releaseWithinAuthorizationReviewBoundary(
    parentSessionId: string,
    authorizationId: string,
    at: string,
  ): Promise<AuthorizationMutationResult> {
    try {
      const current = await this.authorizationPersistence.loadWithLock();
      const binding = current.data.find((candidate) => candidate.authorizationId === authorizationId);
      if (binding === undefined) return { kind: "not_found" };
      if (binding.sessionId !== parentSessionId) return { kind: "wrong_parent" };
      if (binding.status !== "active") return { kind: "already_terminal" };
      const released: Extract<ApprovedPlanBinding, { readonly status: "released" }> = {
        ...binding,
        status: "released",
        releasedAt: at,
      };
      const saved = await this.authorizationPersistence.saveAtomicWithLock(
        current.data.map((candidate) =>
          candidate.authorizationId === authorizationId ? released : candidate,
        ),
        current.lockMeta,
      );
      return saved.status === "saved" ? { kind: "saved", binding: released } : { kind: "uncertain" };
    } catch {
      return { kind: "failed" };
    }
  }

  async invalidateForFingerprint(
    authorizationId: string,
    currentFingerprint: PlanFingerprint,
    at: string,
  ): Promise<AuthorizationMutationResult> {
    let binding: ApprovedPlanBinding | null;
    try {
      binding = await this.findByAuthorizationId(authorizationId);
    } catch {
      return { kind: "failed" };
    }
    if (binding === null) return { kind: "not_found" };
    return this.authorizationReviewBoundary.withParentSession(binding.sessionId, () =>
      this.invalidateForFingerprintWithinAuthorizationReviewBoundary(
        binding.sessionId,
        authorizationId,
        currentFingerprint,
        at,
      ),
    );
  }

  async invalidateForFingerprintWithinAuthorizationReviewBoundary(
    parentSessionId: string,
    authorizationId: string,
    currentFingerprint: PlanFingerprint,
    at: string,
  ): Promise<AuthorizationMutationResult> {
    try {
      const current = await this.authorizationPersistence.loadWithLock();
      const binding = current.data.find((candidate) => candidate.authorizationId === authorizationId);
      if (binding === undefined) return { kind: "not_found" };
      if (binding.sessionId !== parentSessionId) return { kind: "wrong_parent" };
      if (binding.status !== "active") return { kind: "already_terminal" };
      if (samePlanFingerprint(binding.planFingerprint, currentFingerprint)) {
        return { kind: "fingerprint_current" };
      }
      const invalidated: Extract<ApprovedPlanBinding, { readonly status: "invalidated" }> = {
        ...binding,
        status: "invalidated",
        invalidatedAt: at,
      };
      const saved = await this.authorizationPersistence.saveAtomicWithLock(
        current.data.map((candidate) =>
          candidate.authorizationId === authorizationId ? invalidated : candidate,
        ),
        current.lockMeta,
      );
      return saved.status === "saved" ? { kind: "saved", binding: invalidated } : { kind: "uncertain" };
    } catch {
      return { kind: "failed" };
    }
  }
}

function samePlanFingerprint(left: PlanFingerprint, right: PlanFingerprint): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function deserializeAuthorizationBindings(raw: string): ReadonlyArray<ApprovedPlanBinding> {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isApprovedPlanBinding)) {
    throw new Error("Invalid authorization binding array");
  }
  return parsed as ReadonlyArray<ApprovedPlanBinding>;
}

function isApprovedPlanBinding(value: unknown): value is ApprovedPlanBinding {
  if (!isRecord(value)) return false;
  if (
    typeof value.authorizationId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.planPath !== "string" ||
    !isPlanFingerprint(value.planFingerprint) ||
    !isCanonicalPlanSnapshot(value.canonicalSnapshot) ||
    value.fingerprintSchema !== "justice-plan-v1" ||
    typeof value.approvedAt !== "string"
  ) {
    return false;
  }

  switch (value.status) {
    case "active":
      return true;
    case "invalidated":
      return (
        typeof value.invalidatedAt === "string" &&
        (value.invalidationReason === undefined || value.invalidationReason === "plan_superseded")
      );
    case "released":
      return typeof value.releasedAt === "string";
    default:
      return false;
  }
}

function isPlanFingerprint(value: unknown): value is PlanFingerprint {
  return (
    isRecord(value) &&
    value.algorithm === "sha256" &&
    typeof value.value === "string"
  );
}

function isCanonicalPlanSnapshot(value: unknown): value is CanonicalPlanSnapshot {
  return (
    isRecord(value) &&
    value.schema === "justice-plan-v1" &&
    typeof value.documentDigest === "string" &&
    typeof value.globalBodyDigest === "string" &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isCanonicalTaskSnapshot)
  );
}

function isCanonicalTaskSnapshot(value: unknown): value is CanonicalTaskSnapshot {
  return (
    isRecord(value) &&
    typeof value.taskId === "string" &&
    typeof value.title === "string" &&
    typeof value.canonicalBody === "string" &&
    typeof value.digest === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

  const activeCandidates = [...merged.values()].filter(
    (binding): binding is Extract<ApprovedPlanBinding, { readonly status: "active" }> =>
      binding.status === "active",
  );
  for (const sessionId of new Set(activeCandidates.map((binding) => binding.sessionId))) {
    const winner = activeCandidates
      .filter((binding) => binding.sessionId === sessionId)
      .sort(
        (left, right) =>
          right.approvedAt.localeCompare(left.approvedAt) ||
          left.authorizationId.localeCompare(right.authorizationId),
      )[0];
    if (winner === undefined) continue;
    for (const binding of [...merged.values()]) {
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
  invalidatedAt = new Date().toISOString(),
): ApprovedPlanBinding {
  return {
    ...binding,
    status: "invalidated",
    invalidatedAt,
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

**Consumes:** `parseJusticeImplementCommandArguments(argumentsString)`; public
`AuthorizationStore.release(authorizationId, at): Promise<AuthorizationMutationResult>`.

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

Accept exactly one of `--approved` and `--cancel`. Approve requires exactly one safe `--plan`; cancel forbids `--plan`. Reject both flags, duplicate flags, missing approve plan, and unsafe paths. In `PlanBridge.handleImplementationArm`, branch on `action` before resolving a plan path. For cancel, resolve only the current session's single active binding and call public `release`; only its `saved` result persists `active -> released` and clears the active plan cache. Every non-saved result is non-armed and fail-closed. With no active binding, return the deterministic non-armed no-op result without persistence I/O. After either successful release or no-op, later `handlePreToolUse` returns the existing unauthorized advisory. Task 2.3 owns parsing and durable Authorization release only. Task 3.4 replaces this cache path with its one outer release-plus-cancellation operation after Review Dispatch exists; it is the sole owner of connecting successful terminalization, and fingerprint-driven invalidation, to the existing Review Dispatch `cancelled` transition. Do not anticipate it here with a Phase 3 dependency or a second cancellation mechanism.

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

**Produces:** `TransitionOutcome = { readonly kind: "applied" | "duplicate" | "invalid"; readonly state: TaskProgressState | PlanFinalizationState; readonly advisory?: string }`; `applyTaskTransition`; `applyPlanTransition`; `startImplementationAttempt`; `recordWorkerReportedAndEvidence`; `requestCurrentTaskReview`; `advanceFinalizationAfterAllTasksAccepted`; `FinalizationContext`; `ProjectedLifecycle = { readonly currentTaskExecutionRefs: ReadonlyMap<string, TaskExecutionRef>; readonly taskStates: ReadonlyMap<string, TaskProgressState>; readonly finalization?: FinalizationContext }`; the existing `project(events, rebuiltAt): ProjectedState` extended with the lifecycle-only `ProjectedLifecycle`; `appendTaskLifecycleTransition(input: { readonly parentSessionId: string; readonly taskExecutionRef: TaskExecutionRef; readonly from: "review_pending"; readonly to: "gate_pending" | "rework_required" } | { readonly parentSessionId: string; readonly taskExecutionRef: TaskExecutionRef; readonly from: "gate_pending"; readonly to: "accepted" | "rework_required" }): Promise<{ readonly kind: "committed" | "failed" }>`; `appendPlanFinalizationTransition(input: { readonly parentSessionId: string; readonly authorizationId: string; readonly planPath: string; readonly finalizationAttemptId: FinalizationAttemptId; readonly finalReviewRound: 1; readonly from: "tasks_pending"; readonly to: "all_tasks_accepted" } | { readonly parentSessionId: string; readonly authorizationId: string; readonly planPath: string; readonly finalizationAttemptId: FinalizationAttemptId; readonly finalReviewRound: 1; readonly from: "all_tasks_accepted"; readonly to: "final_review_pending" } | { readonly parentSessionId: string; readonly authorizationId: string; readonly planPath: string; readonly finalizationAttemptId: FinalizationAttemptId; readonly finalReviewRound: number; readonly from: "final_review_pending"; readonly to: "final_gate_pending" | "final_rework_required" } | { readonly parentSessionId: string; readonly authorizationId: string; readonly planPath: string; readonly finalizationAttemptId: FinalizationAttemptId; readonly finalReviewRound: number; readonly from: "final_gate_pending"; readonly to: "complete" | "final_rework_required" }): Promise<{ readonly kind: "committed" | "failed" }>`; and `startNextFinalizationAttempt(current: FinalizationContext): PlanFinalizationTransitionRecord`.

**Type ownership:** Export `TaskExecutionRef`, `TaskAttemptId`, and `FinalizationAttemptId` from
`src/core/types.ts` in this task. Task 3.2 imports those types and does not define a second identity
shape. Task 3.1 owns lifecycle identity projection; Task 3.2 owns only the durable Gate and
Acceptance decision variants and their lookup.
The `PlanFinalizationTransitionInput` union also includes the initial
`tasks_pending → all_tasks_accepted` and `all_tasks_accepted → final_review_pending` variants;
both use the fresh initial identity and `finalReviewRound = 1`.
The same `src/core/types.ts` module also owns `ReviewKind`, `TaskReviewCorrelation`,
`FinalReviewCorrelation`, and `ReviewCorrelation`; Task 3.2 and Task 3.4 import these shared
correlation types rather than creating local copies.
The lifecycle appenders also expose the post-Gate outcome transitions as discriminated inputs:
`gate_pending → accepted | rework_required` for a current task attempt and
`final_gate_pending → complete | final_rework_required` for the current finalization identity.
Task 3.2 appends these transitions only after the matching AcceptanceDecision is durable; blocked
Acceptance leaves the lifecycle in `gate_pending` / `final_gate_pending`.

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

it("rejects a transition whose declared source differs from the projected state", () => {
  expect(
    applyTaskTransition("in_progress", {
      ...acceptedToPendingEvent,
      from: "pending",
      to: "gate_pending",
    }),
  ).toEqual({
    kind: "invalid",
    state: "in_progress",
    advisory: "pending -> gate_pending does not start at in_progress",
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
  expect(project(lifecycleRecords, now).lifecycle.currentTaskExecutionRefs.get("task-1")).toEqual(
    currentAttempt,
  );
});

it("projects current lifecycle identity and round without GateDecision input", () => {
  const projected = project(lifecycleRecords, now);
  expect(projected.lifecycle.currentTaskExecutionRefs.get("task-1")).toEqual(currentAttempt);
  expect(projected.lifecycle.taskStates.get("task-1")).toBe("review_pending");
  expect(projected.lifecycle.finalization).toMatchObject({
    finalizationAttemptId: currentFinalizationAttemptId,
    finalReviewRound: currentFinalReviewRound,
  });
});

it("durably records the initial finalization identity before final review pending", async () => {
  const initial = await advanceFinalizationAfterAllTasksAccepted(binding);
  const transitions = durableFinalizationTransitions();

  expect(transitions).toEqual([
    expect.objectContaining({
      from: "tasks_pending",
      to: "all_tasks_accepted",
      finalizationAttemptId: initial.finalizationAttemptId,
      finalReviewRound: 1,
    }),
    expect.objectContaining({
      from: "all_tasks_accepted",
      to: "final_review_pending",
      finalizationAttemptId: initial.finalizationAttemptId,
      finalReviewRound: 1,
    }),
  ]);
});

it("rotates the finalization identity only for actual final rework", async () => {
  const initial = await advanceFinalizationAfterAllTasksAccepted(binding);
  const rework = await startNextFinalizationAttempt(initial);

  expect(rework.finalizationAttemptId).not.toBe(initial.finalizationAttemptId);
  expect(rework.finalReviewRound).toBe(initial.finalReviewRound + 1);
  expect(rework.from).toBe("final_rework_required");
  expect(rework.to).toBe("final_review_pending");
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-lifecycle.test.ts tests/core/session-state-provider.test.ts`

Expected: FAIL because lifecycle projection and runtime orchestration are absent.

“Lifecycle-only” means Gate/Acceptance records are not used to derive or mutate lifecycle state
inside Task 3.1. Preserve the existing task-Gate compatibility projection under
`ProjectedState.tasks` where current rule-engine consumers require it; `applyDecisionEvent` must
ignore AcceptanceDecision and plan-scoped GateDecision records, while Task 3.2 uses its own
current-identity decision lookups for authoritative Gate/Acceptance recovery.

- [ ] **Step 3: Implement non-throwing transition outcomes**

Encode every lifecycle record in `observation-model.ts` with its task execution reference or finalization identity. Make duplicate identity leave state unchanged. Make illegal transitions leave state unchanged and emit an advisory record in the projection result. Do not throw from the projector for either case. Derive `all_tasks_accepted` from `ApprovedPlanBinding.canonicalSnapshot.tasks.map(task => task.taskId)`.

For the initial plan finalization, issue the fresh identity before appending
`tasks_pending → all_tasks_accepted`, then append `all_tasks_accepted → final_review_pending` with
the same identity and round. If the second append fails, leave `all_tasks_accepted` durable and let
restart recovery append only the missing successor.

Extend the transition tables explicitly: task `review_pending` may enter `gate_pending` or
`rework_required`, and current-ref `gate_pending` may enter `accepted` or `rework_required`;
finalization `tasks_pending` may enter `all_tasks_accepted`, current `all_tasks_accepted` may enter
`final_review_pending`, `final_review_pending` may enter `final_gate_pending` or
`final_rework_required`, and current-identity `final_gate_pending` may enter `complete` or
`final_rework_required`.
Post-Gate transitions must require the exact current `TaskExecutionRef` or finalization identity;
matching identity plus an already-applied target is a duplicate, while a stale identity is invalid
and leaves the projected state unchanged.

In the sequential `JusticePlugin` path, select the authorized current task, issue a fresh attemptId only when starting implementation, durably record `authorized → in_progress`, and persist the implementation call binding before accepting its PostToolUse as authoritative. Matching PostToolUse records `worker_reported`, then observed/derived evidence scoped to that same ref, then `evidence_pending → review_pending`; it emits a current-attempt `ReviewRequiredDirective` only after the review-dispatch offer boundary has committed its pending slot. Old-attempt records are advisory-only. On all accepted snapshot task IDs, issue a fresh finalization identity with `finalReviewRound = 1`, durably append `tasks_pending → all_tasks_accepted`, then durably append `all_tasks_accepted → final_review_pending` with the same identity. Do not offer Final Review until the latter append succeeds; if it fails, recovery resumes from `all_tasks_accepted` without issuing a new identity. Task 3.1 neither defines nor projects review-dispatch retry records: review-only failure retry, its current final-review round, and old-round rejection belong exclusively to Task 3.4. `startNextFinalizationAttempt` is reserved for actual `final_rework_required → final_review_pending` and writes the fresh identity transition. `project(...)` remains the only projection boundary: it adds lifecycle-only data under `ProjectedState.lifecycle` and does not define or project GateDecision / AcceptanceDecision. Do not evaluate a Gate in this task; Task 3.2 receives the lifecycle-only projection and queries durable decisions independently.

```ts
// src/core/types.ts
export type TaskAttemptId = string;
export type TaskExecutionRef = {
  readonly authorizationId: string;
  readonly taskId: string;
  readonly attemptId: TaskAttemptId;
};
export type FinalizationAttemptId = string;
export type ReviewKind = "task-review" | "final-review";
export type TaskReviewCorrelation = {
  readonly reviewKind: "task-review";
  readonly taskExecutionRef: TaskExecutionRef;
  readonly reviewRound: number;
};
export type FinalReviewCorrelation = {
  readonly reviewKind: "final-review";
  readonly planPath: string;
  readonly authorizationId: string;
  readonly planFingerprint: PlanFingerprint;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
};
export type ReviewCorrelation = TaskReviewCorrelation | FinalReviewCorrelation;

if (event.identity === state.lastTransitionIdentity)
  return { kind: "duplicate", state: state.value };
if (event.from !== state.value)
  return {
    kind: "invalid",
    state: state.value,
    advisory: `${event.from} -> ${event.to} does not start at ${state.value}`,
  };
if (!VALID_TASK_TRANSITIONS.get(state.value)?.has(event.to)) {
  return {
    kind: "invalid",
    state: state.value,
    advisory: `${state.value} -> ${event.to} is not allowed`,
  };
}
return { kind: "applied", state: event.to };

type FinalizationContext = {
  readonly parentSessionId: string;
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
    parentSessionId: current.parentSessionId,
    planPath: current.planPath,
    authorizationId: current.authorizationId,
    finalizationAttemptId: randomUUID(),
    finalReviewRound: current.finalReviewRound + 1,
    from: "final_rework_required",
    to: "final_review_pending",
    reason: "finalization_rework",
  };
}

export type TaskLifecycleTransitionInput =
  | {
      readonly parentSessionId: string;
      readonly taskExecutionRef: TaskExecutionRef;
      readonly from: "review_pending";
      readonly to: "gate_pending" | "rework_required";
    }
  | {
      readonly parentSessionId: string;
      readonly taskExecutionRef: TaskExecutionRef;
      readonly from: "gate_pending";
      readonly to: "accepted" | "rework_required";
    };

export async function appendTaskLifecycleTransition(
  input: TaskLifecycleTransitionInput,
): Promise<{ readonly kind: "committed" | "failed" }> {
  return appendLifecycleRecord({ kind: "task", ...input });
}

export type PlanFinalizationTransitionInput =
  | {
      readonly parentSessionId: string;
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: 1;
      readonly from: "tasks_pending";
      readonly to: "all_tasks_accepted";
    }
  | {
      readonly parentSessionId: string;
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: 1;
      readonly from: "all_tasks_accepted";
      readonly to: "final_review_pending";
    }
  | {
      readonly parentSessionId: string;
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: number;
      readonly from: "final_review_pending";
      readonly to: "final_gate_pending" | "final_rework_required";
    }
  | {
      readonly parentSessionId: string;
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: number;
      readonly from: "final_gate_pending";
      readonly to: "complete" | "final_rework_required";
    };

export async function appendPlanFinalizationTransition(
  input: PlanFinalizationTransitionInput,
): Promise<{ readonly kind: "committed" | "failed" }> {
  return appendLifecycleRecord({ kind: "final", ...input });
}
```

`advanceFinalizationAfterAllTasksAccepted` generates the initial identity once, appends the two
initial transitions in order, and returns the committed identity only after
`all_tasks_accepted → final_review_pending` is durable. Each append remains an independent atomic
record boundary; if the second append fails, recovery observes `all_tasks_accepted` with the same
identity and retries only that successor.

Every lifecycle transition record and append input also carries the durable `parentSessionId` of the
Controller session that owns the review dispatch. The append helper preserves that field in the persisted
record; restart candidate projection reads it from the record rather than deriving it from a child session
or an unrelated envelope field.

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
- Modify: `src/core/v2/decision-model.ts`
- Modify: `src/core/v2/gate-definition.ts`
- Modify: `src/core/v2/default-gates.ts`
- Modify: `src/core/v2/gate-context.ts`
- Modify: `src/core/v2/rule-evaluation-engine.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/core/v2/persistence-redaction.ts`
- Modify: `src/runtime/validation.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/runtime/justice-tools.ts`
- Test: `tests/core/v2/rule-evaluation-engine.test.ts`
- Test: `tests/core/v2/gate-yaml-parser.test.ts`
- Test: `tests/core/v2/gate-definition.test.ts`
- Test: `tests/core/v2/default-gates.test.ts`
- Test: `tests/runtime/gate-loader.test.ts`
- Test: `tests/runtime/gate-yaml-injection.test.ts`
- Create: `tests/core/acceptance-decision.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/core/v2/persistence-redaction.test.ts`
- Test: `tests/runtime/validation.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`
- Test: `tests/core/rule-engine-determinism.test.ts`
- Test: `tests/core/evidence-provenance.test.ts`
- Test: `tests/core/v2/gate-provenance-gating.test.ts`
- Test: `tests/runtime/justice-gate-tool.test.ts`
- Test: `tests/core/observation-log-replay.test.ts`
- Test: `tests/core/record-reference-resolution.test.ts`
- Test: `tests/runtime/observation-log-integrity.test.ts`
- Test: `tests/hooks/observation-handler-tool.test.ts`
- Test: `tests/hooks/observation-handler-workflow-bootstrap.test.ts`

**Consumes:** `GateScope = "task" | "plan"`; `GateTrigger`; `ProjectedLifecycle` and `project(records, rebuiltAt).lifecycle` from Task 3.1; durable `PersistedLogRecord` decision records; `AuthorizationStore.findByAuthorizationId` for the gate correlation's authorizationId.

**Produces:** durable `DecisionRecord` with four new authoritative discriminated payload variants (`task` / `plan` GateDecision and `task-acceptance` / `plan-acceptance` AcceptanceDecision); `GateDecision = TaskGateDecision | PlanGateDecision`; `AcceptanceDecision = TaskAcceptanceDecision | PlanAcceptanceDecision`; `GatePendingAttemptContext = { readonly scope: "task"; readonly trigger: "task_complete" | "tool_observed"; readonly parentSessionId: string; readonly taskExecutionRef: TaskExecutionRef; readonly agentId: ObservationAgentId; readonly sessionId: string; readonly writerId: string } | { readonly scope: "plan"; readonly trigger: "final_review_complete"; readonly parentSessionId: string; readonly authorizationId: string; readonly planPath: string; readonly finalizationAttemptId: FinalizationAttemptId; readonly finalReviewRound: number; readonly agentId: ObservationAgentId; readonly sessionId: string; readonly writerId: string }`; `GatePendingAttemptResult = { readonly kind: "not_applicable" } | { readonly kind: "decided"; readonly decision: GateDecisionPayload } | { readonly kind: "blocked"; readonly advisory: string }`; `GateDecisionLookup` and `AcceptanceDecisionLookup` results that distinguish `missing`, `found`, and `conflict`; `findCurrentGateDecision(records: readonly PersistedLogRecord[], correlation: ReviewCorrelation): GateDecisionLookup`; `findCurrentAcceptanceDecision(records: readonly PersistedLogRecord[], correlation: ReviewCorrelation): AcceptanceDecisionLookup`; `evaluateGatePendingAttempt(context: GatePendingAttemptContext): Promise<GatePendingAttemptResult>`; `deriveAcceptanceDecision(gate: GateDecision): AcceptanceDecisionPayload`; `evaluate(gates, evidence, context)` returns a `GateDecisionPayload` containing either `taskExecutionRef` or the complete plan finalization identity; and the exported pure/helper functions `authorizationIdFor(correlation)` / `isCurrentActiveAuthorization(correlation, findAuthorizationById)`. The orchestration boundary is `createGatePendingAttemptEvaluator(dependencies)`, which returns `evaluateGatePendingAttempt(context)` and owns the injected ports. `DecisionRecord` remains the source used by the existing `PersistedLogRecord` alias; no second persistence union or projection subsystem is introduced.
The Gate evaluator produces two distinct entries: public
`evaluateGatePendingAttempt(context: GatePendingAttemptContext): Promise<GatePendingAttemptResult>` and
internal orchestration-only
`evaluateGatePendingAttemptWithinAuthorizationReviewBoundary(context: GatePendingAttemptContext): Promise<GatePendingAttemptResult>`.
The latter is passed only to Task 3.6 and is not re-exported as a public Justice API.

The four variants above are the new authoritative variants. Add the separate read-only
`LegacyTaskGateDecisionPayload` for the pre-existing `schemaVersion: 1` task Gate shape that lacks
`taskExecutionRef`; it remains in `DecisionPayload` / `DecisionRecord` so persisted records are
readable, but it is excluded from `GateDecision`, current Gate lookup, Acceptance derivation, and
lifecycle authority. No migration, second persistence union, or generic compatibility router is added.

`AcceptanceDecision { verdict: "blocked" }` is not a review-dispatch API. It is created only inside
`evaluateGatePendingAttemptWithinDecisionIdentity` after a clean terminal review and current
`gate_pending` / `final_gate_pending` have been established, when Gate evaluation cannot safely produce a
`GateDecision`. Unusable reservations, uncertain claims, missing child bindings, incomplete reviews, and
terminal Authorization are pre-Gate blocked states: they retain their existing durable review state and
advisory, but never append an `AcceptanceDecision`.

Both `GatePendingAttemptContext` variants also carry the invoking `agentId`, `sessionId`, and `writerId`
needed to build the durable decision envelope; review scope and projected review summary are resolved
from the current durable projection rather than trusted from a caller-supplied result.
`authorizationIdFor` derives the authorization ID from the task execution reference or finalization
correlation. `isCurrentActiveAuthorization` receives only the injected
`findAuthorizationById` port, requires `status === "active"`, and for Final Review also checks the
correlation's plan path and fingerprint against the binding; read, missing, or conflict-diverted
authorization returns `false`. Both pure / port-parameterized helpers are exported for Tasks 3.4 and 3.6;
they do not import a runtime store or read the conflict journal.
`sameReviewCorrelation(left, right)` is the third shared identity helper and has one owner in Task 3.2.
It performs exact discriminated-union identity comparison, including the task execution identity and
review round or the complete Final Review identity and fingerprint. Tasks 3.4 and 3.6 import this helper;
neither task redeclares a correlation comparison.
Define `GateEvaluationDependencies` as the explicit injected boundary with `readDurableRecords`,
`appendDecision`, `findAuthorizationById`, `appendTaskLifecycleTransition`,
`appendPlanFinalizationTransition`, `evaluateRules`, and `recordAdvisory` ports. Export only pure
lookup / identity functions, including `isLegacyTaskGateDecisionRecord`, `authorizationIdFor`,
`sameReviewCorrelation`, and the port-parameterized `isCurrentActiveAuthorization`. The internal factory
`createGatePendingAttemptEvaluator(dependencies)` closes over the ports, returns a public
`evaluateGatePendingAttempt` and an internal orchestration-only
`evaluateGatePendingAttemptWithinAuthorizationReviewBoundary`, and owns one private decision-identity tail
map. The public evaluation first enters the shared
`withAuthorizationReviewBoundary(parentSessionId, operation)` and keeps it through the inner
decision-identity operation, all durable reads/appends, lifecycle application, and Acceptance handling. The
within-boundary capability never acquires the parent boundary; Task 3.6 receives only that capability for
live completion, staged recovery, and post-terminal outcome recovery. Neither capability is re-exported as
a public Justice API.
Helpers that perform
I/O receive the same explicit dependency object; pure lookup, identity, and payload helpers remain
module-private. The hook/runtime layer creates exactly one evaluator with its log, Authorization, lifecycle,
shared boundary, rule, and notifier adapters, so
`evaluateGatePendingAttempt(context)` never reads an implicit singleton or a caller-supplied
Authorization object.

`decisionIdentityKey(identity)` uses exactly the authoritative identity: task keys contain
`authorizationId`, `taskId`, and `attemptId`; plan keys contain `authorizationId`, `planPath`,
`finalizationAttemptId`, and `finalReviewRound`. `serializeDecisionIdentity(correlation, operation)`
is a module-private factory helper, not a generic queue utility or authority store. Its per-key
Promise-tail implementation waits for a predecessor after absorbing predecessor rejection, installs
its own tail before executing `operation`, releases that tail only after `operation` settles, and
removes the map entry only if it still owns the current tail. Therefore a rejected predecessor cannot
poison the queue, an old cleanup cannot delete a newer tail, and a subsequent operation cannot begin
before the current operation finishes. The map is discarded on restart; durable records alone remain
the restart authority.

```ts
type DecisionIdentity =
  | Pick<TaskExecutionRef, "authorizationId" | "taskId" | "attemptId">
  | Pick<
      FinalReviewCorrelation,
      "authorizationId" | "planPath" | "finalizationAttemptId" | "finalReviewRound"
    >;

function decisionIdentityKey(identity: DecisionIdentity): string {
  if ("taskId" in identity) {
    return JSON.stringify([
      "task",
      identity.authorizationId,
      identity.taskId,
      identity.attemptId,
    ]);
  }
  return JSON.stringify([
    "plan",
    identity.authorizationId,
    identity.planPath,
    identity.finalizationAttemptId,
    identity.finalReviewRound,
  ]);
}

function decisionIdentityForContext(context: GatePendingAttemptContext): DecisionIdentity {
  return context.scope === "task"
    ? context.taskExecutionRef
    : {
        authorizationId: context.authorizationId,
        planPath: context.planPath,
        finalizationAttemptId: context.finalizationAttemptId,
        finalReviewRound: context.finalReviewRound,
      };
}

function decisionIdentityForCorrelation(correlation: ReviewCorrelation): DecisionIdentity {
  return correlation.reviewKind === "task-review"
    ? correlation.taskExecutionRef
    : {
        authorizationId: correlation.authorizationId,
        planPath: correlation.planPath,
        finalizationAttemptId: correlation.finalizationAttemptId,
        finalReviewRound: correlation.finalReviewRound,
      };
}

```

Expose only this factory closure to hook/runtime consumers:

```ts
export function createGatePendingAttemptEvaluator(
  dependencies: GateEvaluationDependencies,
): {
  readonly evaluateGatePendingAttempt: (
    context: GatePendingAttemptContext,
  ) => Promise<GatePendingAttemptResult>;
  // Internal orchestration capability. It is supplied only to callers that already own the parent boundary.
  readonly evaluateGatePendingAttemptWithinAuthorizationReviewBoundary: (
    context: GatePendingAttemptContext,
  ) => Promise<GatePendingAttemptResult>;
} {
  const decisionTails = new Map<string, Promise<void>>();

  async function serializeDecisionIdentity<T>(
    identity: DecisionIdentity,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = decisionIdentityKey(identity);
    const predecessor = (decisionTails.get(key) ?? Promise.resolve()).catch(() => undefined);
    let releaseCurrent: () => void = () => undefined;
    const currentCompletion = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const currentTail = predecessor.then(() => currentCompletion);
    decisionTails.set(key, currentTail);

    await predecessor;
    try {
      return await operation();
    } finally {
      releaseCurrent();
      if (decisionTails.get(key) === currentTail) decisionTails.delete(key);
    }
  }

  const evaluateGatePendingAttemptWithinAuthorizationReviewBoundary = (
    context: GatePendingAttemptContext,
  ) =>
    serializeDecisionIdentity(decisionIdentityForContext(context), () =>
      evaluateGatePendingAttemptWithinDecisionIdentity(context, dependencies),
    );

  const evaluateGatePendingAttempt = (context: GatePendingAttemptContext) =>
    dependencies.withAuthorizationReviewBoundary(context.parentSessionId, () =>
      evaluateGatePendingAttemptWithinAuthorizationReviewBoundary(context),
    );

  return {
    evaluateGatePendingAttempt,
    evaluateGatePendingAttemptWithinAuthorizationReviewBoundary,
  };
}
```
All log reads, decision appends, Authorization lookups, lifecycle appends, and advisory writes in this
task are injected ports supplied by `ObservationHandler` / `JusticePlugin`; `src/core` does not import
runtime adapters, persistence implementations, or notifier implementations directly.

- [ ] **Step 1: Write the failing task/Final Gate and recovery tests**

The test setup constructs one `gateEvaluator` with the existing log, Authorization, lifecycle, rule, and
advisory mocks, then destructures its returned public and within-boundary entries; no test calls an
unbound module-level evaluator. A direct public call must acquire the shared boundary and serialize with a
concurrent release/invalidation for the same parent. A within-boundary call must acquire no parent boundary,
must retain decision-identity serialization, and must not append a positive decision after terminal
Authorization.

```ts
it("acquires the parent boundary for a direct public Gate call", async () => {
  await evaluateGatePendingAttempt(currentTaskGateContext);
  expect(parentBoundary.callsFor("parent-1")).toBe(1);
});

it("serializes a public Gate call with terminal authorization mutation", async () => {
  await arrangeReleaseBetweenGateAuthorizationChecks();
  await evaluateGatePendingAttempt(currentTaskGateContext);
  expect(durablePositiveDecisionsFor(currentTaskExecutionRef)).toEqual([]);
});

it("keeps decision serialization without reacquiring the parent boundary", async () => {
  await parentBoundary.withParentSession("parent-1", async () => {
    await evaluateGatePendingAttemptWithinAuthorizationReviewBoundary(currentTaskGateContext);
  });
  expect(parentBoundary.nestedAcquiresFor("parent-1")).toBe(0);
  expect(durableGateDecisionsFor(currentTaskExecutionRef)).toHaveLength(1);
});
```

```ts
const currentTaskExecutionRef: TaskExecutionRef = {
  authorizationId: "a1",
  taskId: "task-1",
  attemptId: "attempt-1",
};
const currentFinalizationIdentity = {
  authorizationId: "a1",
  planPath: "docs/p.md",
  finalizationAttemptId: "f2",
  finalReviewRound: 2,
} as const;
const currentPlanFingerprint = { algorithm: "sha256", value: "f1" } as const;
const decisionEnvelope = {
  schemaVersion: 1,
  sequence: 4,
  timestamp: "2026-09-05T00:00:00.000Z",
  agentId: "atlas",
  sessionId: "s1",
  writerId: "w1",
  recordType: "decision",
} as const;
const gateAudit = {
  verdict: "PASS",
  reachableEnforcementLevel: "L1",
  appliedEnforcementLevel: "L0",
  ruleResults: [],
} as const;
const taskGateRecord = {
  ...decisionEnvelope,
  taskId: currentTaskExecutionRef.taskId,
  taskExecutionRef: currentTaskExecutionRef,
  gateType: "task",
  ...gateAudit,
} as const;
const planGateRecord = {
  ...decisionEnvelope,
  ...currentFinalizationIdentity,
  gateType: "plan",
  ...gateAudit,
} as const;
const taskAcceptanceRecord = {
  ...decisionEnvelope,
  taskId: currentTaskExecutionRef.taskId,
  taskExecutionRef: currentTaskExecutionRef,
  kind: "task-acceptance",
  verdict: "accepted",
} as const;
const planAcceptanceRecord = {
  ...decisionEnvelope,
  ...currentFinalizationIdentity,
  kind: "plan-acceptance",
  verdict: "complete",
} as const;
const currentTaskCorrelation: TaskReviewCorrelation = {
  reviewKind: "task-review",
  taskExecutionRef: currentTaskExecutionRef,
  reviewRound: 1,
};
const currentFinalReviewCorrelation: FinalReviewCorrelation = {
  reviewKind: "final-review",
  ...currentFinalizationIdentity,
  planFingerprint: currentPlanFingerprint,
};
const taskGate: GateRule = {
  id: "task-tests",
  gateType: "task",
  trigger: { scope: "task", on: "task_complete" },
  check: { type: "evidence_present", evidenceKind: "test" },
  onViolation: "fail",
  onMissingEvidence: "warn",
  enabled: true,
};
const planGate: GateRule = {
  id: "final-review-clean",
  gateType: "plan",
  trigger: { scope: "plan", on: "final_review_complete" },
  check: { type: "review_open_items", minimumSeverity: "major" },
  onViolation: "fail",
  onMissingEvidence: "warn",
  enabled: true,
};
const finalReviewContext: GateContext = {
  scope: "plan",
  trigger: "final_review_complete",
  ...currentFinalizationIdentity,
  agentId: "atlas",
  sessionId: "s1",
  writerId: "w1",
  reviewScope: [],
};
const taskGateContext: GateContext = {
  scope: "task",
  trigger: "task_complete",
  taskExecutionRef: currentTaskExecutionRef,
  agentId: "atlas",
  sessionId: "s1",
  writerId: "w1",
  reviewScope: [],
};
const passForCurrentAttempt = planGateRecord;
const warnForCurrentAttempt = { ...planGateRecord, verdict: "WARN" } as const;
const passForOldAttempt = { ...planGateRecord, finalReviewRound: 1 } as const;
const oldFinalAcceptanceRecord = { ...planAcceptanceRecord, finalReviewRound: 1 } as const;
const oldAttemptPass = {
  ...taskGateRecord,
  taskExecutionRef: { ...currentTaskExecutionRef, attemptId: "old-attempt" },
} as const;
const gatePendingContext: GatePendingAttemptContext = {
  scope: "task",
  trigger: "task_complete",
  parentSessionId: "s1",
  taskExecutionRef: currentTaskExecutionRef,
  agentId: "atlas",
  sessionId: "s1",
  writerId: "w1",
};
const finalGatePendingContext: GatePendingAttemptContext = {
  scope: "plan",
  trigger: "final_review_complete",
  parentSessionId: "s1",
  ...currentFinalizationIdentity,
  agentId: "atlas",
  sessionId: "s1",
  writerId: "w1",
};
const reviewPendingContext: GatePendingAttemptContext = gatePendingContext;

it("selects a task gate and preserves the current task execution reference", () => {
  expect(evaluate([taskGate], [], taskGateContext)).toMatchObject({
    gateType: "task",
    taskExecutionRef: currentTaskExecutionRef,
  });
});

it("selects a plan gate only for final_review_complete", () => {
  expect(evaluate([planGate], [], finalReviewContext)).toMatchObject({ gateType: "plan" });
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

it.each([
  ["task", "final_review_complete"],
  ["plan", "task_complete"],
] as const)("rejects a %s gate with an incompatible trigger", (gateType, trigger) => {
  expect(() =>
    GateRuleSchema.parse({
      id: "gate",
      gateType,
      trigger: { scope: gateType, on: trigger },
      check: { type: "evidence_present", evidenceKind: "test" },
      onViolation: "warn",
      onMissingEvidence: "warn",
      enabled: true,
    }),
  ).toThrow();
});

it("maps current Final Gate verdicts and excludes stale evidence", () => {
  expect(deriveAcceptanceDecision(passForCurrentAttempt)).toMatchObject({
    kind: "plan-acceptance",
    verdict: "complete",
  });
  expect(deriveAcceptanceDecision(warnForCurrentAttempt)).toMatchObject({
    kind: "plan-acceptance",
    verdict: "rework-required",
  });
  expect(findCurrentGateDecision([passForOldAttempt], currentFinalReviewCorrelation)).toEqual({
    kind: "missing",
  });
});

it("does not evaluate before the terminal review projects gate_pending", async () => {
  await evaluateGatePendingAttempt(reviewPendingContext);
  expect(evaluate).not.toHaveBeenCalled();
});

it("records GateDecision before deriving acceptance for the same current attempt", async () => {
  await evaluateGatePendingAttempt(gatePendingContext);
  expect(trace).toEqual([
    "record-gate-decision",
    "record-acceptance",
    "record-lifecycle-accepted",
    "accepted",
  ]);
});

it.each(["WARN", "FAIL"] as const)(
  "records %s Acceptance before entering task rework",
  async (verdict) => {
    await evaluateGatePendingAttempt(contextForGateVerdict(verdict));
    expect(trace).toEqual(["record-gate-decision", "record-acceptance", "record-lifecycle-rework"]);
    expect(projectedTaskState()).toBe("rework_required");
  },
);

it("resumes a Gate outcome lifecycle after Acceptance was durable before restart", async () => {
  await arrangeCurrentGatePendingWithDurableGateAndAcceptance(gatePendingContext);
  await evaluateGatePendingAttempt(gatePendingContext);
  expect(recordGateDecision).not.toHaveBeenCalled();
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
  expect(recordLifecycleTransition).toHaveBeenCalledTimes(1);
  expect(projectedTaskState()).toBe("accepted");
});

it("records Final Gate PASS before completing the current finalization identity", async () => {
  await arrangeCurrentFinalGatePendingWithoutDecisions(finalGatePendingContext);
  await evaluateGatePendingAttempt(finalGatePendingContext);
  expect(trace).toEqual(["record-gate-decision", "record-acceptance", "record-lifecycle-complete"]);
  expect(projectedFinalizationState()).toBe("complete");
});

it.each(["WARN", "FAIL"] as const)(
  "maps Final Gate %s to final rework after Acceptance",
  async (verdict) => {
    await arrangeCurrentFinalGatePendingWithVerdict(finalGatePendingContext, verdict);
    await evaluateGatePendingAttempt(finalGatePendingContext);
    expect(projectedFinalizationState()).toBe("final_rework_required");
  },
);

it("blocks an old-attempt GateDecision", () => {
  expect(
    findCurrentGateDecision([oldAttemptPass], {
      reviewKind: "task-review",
      taskExecutionRef: currentTaskExecutionRef,
      reviewRound: 1,
    }),
  ).toEqual({ kind: "missing" });
});

it("validates all four durable decision variants", () => {
  for (const record of [
    taskGateRecord,
    planGateRecord,
    taskAcceptanceRecord,
    planAcceptanceRecord,
  ]) {
    expect(() => validateRecordSchema(record)).not.toThrow();
  }
});

it.each([
  ["plan Gate", planGateRecord, "taskId", currentTaskExecutionRef.taskId],
  ["plan Gate", planGateRecord, "taskExecutionRef", currentTaskExecutionRef],
  ["plan Acceptance", planAcceptanceRecord, "taskId", currentTaskExecutionRef.taskId],
  ["plan Acceptance", planAcceptanceRecord, "taskExecutionRef", currentTaskExecutionRef],
  ["task Gate", taskGateRecord, "authorizationId", "a2"],
  ["task Gate", taskGateRecord, "planPath", "docs/other.md"],
  ["task Gate", taskGateRecord, "finalizationAttemptId", "f3"],
  ["task Gate", taskGateRecord, "finalReviewRound", 1],
  ["task Acceptance", taskAcceptanceRecord, "authorizationId", "a2"],
  ["task Acceptance", taskAcceptanceRecord, "planPath", "docs/other.md"],
  ["task Acceptance", taskAcceptanceRecord, "finalizationAttemptId", "f3"],
  ["task Acceptance", taskAcceptanceRecord, "finalReviewRound", 1],
] as const)("rejects replayed %s records with cross-scope field %s", (_name, record, field, value) => {
  expect(() => validateRecordSchema({ ...record, [field]: value })).toThrow();
});

it.each([
  ["plan gate", { ...planGateRecord, planPath: "../unsafe.md" }],
  ["plan acceptance", { ...planAcceptanceRecord, finalReviewRound: Number.POSITIVE_INFINITY }],
  ["task acceptance", { ...taskAcceptanceRecord, kind: "task-acceptance", verdict: "PASS" }],
  ["unknown decision", { ...taskGateRecord, gateType: "other", kind: undefined }],
] as const)("rejects malformed durable %s records", (_name, record) => {
  expect(() => validateRecordSchema(record)).toThrow();
});

it("returns a conflict instead of selecting an arbitrary duplicate current GateDecision", () => {
  expect(findCurrentGateDecision([taskGateRecord, taskGateRecord], currentTaskCorrelation)).toEqual(
    {
      kind: "conflict",
      advisory: "multiple current GateDecision records",
    },
  );
});

it("returns missing for a stale final-review round", () => {
  expect(
    findCurrentAcceptanceDecision([oldFinalAcceptanceRecord], currentFinalReviewCorrelation),
  ).toEqual({
    kind: "missing",
  });
});

it("does not treat a task GateDecision with a different attempt as current", () => {
  const oldAttempt = {
    ...taskGateRecord,
    taskExecutionRef: { ...currentTaskExecutionRef, attemptId: "old-attempt" },
  };
  expect(findCurrentGateDecision([oldAttempt], currentTaskCorrelation)).toEqual({
    kind: "missing",
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
    expect(recordAcceptanceDecision).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: "blocked" }),
    );
  },
);
```

Add the following RED cases to the named Task 3.2 suites. They use the real current producer shape,
not an unsafe cast or a synthetic legacy approximation:

Define `normalObservationRecord`, `writeOneShard`, and `arrangeCurrentGatePendingWith` as local test
fixtures in their named test files before using them below. `normalObservationRecord(sequence)` returns
the existing valid ObservationRecord fixture with only its sequence replaced;
`writeOneShard(records)` serializes those records into one valid physical shard; and
`arrangeCurrentGatePendingWith(records)` seeds the existing lifecycle fixture with the supplied durable
records. They are not new production symbols, so RED failures remain behavior failures.

```ts
const legacyTaskGateRecord = {
  ...decisionEnvelope,
  taskId: currentTaskExecutionRef.taskId,
  gateType: "task",
  ...gateAudit,
} as const;

it("accepts a schemaVersion 1 legacy task Gate record without taskExecutionRef", () => {
  expect(() => validateRecordSchema(legacyTaskGateRecord)).not.toThrow();
  expect(project([legacyTaskGateRecord], "2026-09-05T00:00:00.000Z").tasks.get("task-1"))
    .toMatchObject({ lastVerdict: "PASS" });
});

it("keeps a physical shard readable around a legacy task Gate record", async () => {
  await writeOneShard([
    normalObservationRecord(1),
    { ...legacyTaskGateRecord, sequence: 2 },
    normalObservationRecord(3),
  ]);
  await expect(store.readAll()).resolves.toHaveLength(3);
  expect(store.getLastReadIntegrity()).toEqual({ hasIntegrityViolation: false });
});

it("excludes a legacy task Gate from current authority and Acceptance", async () => {
  await arrangeCurrentGatePendingWith([legacyTaskGateRecord]);
  expect(findCurrentGateDecision([legacyTaskGateRecord], currentTaskCorrelation)).toEqual({
    kind: "missing",
  });
  await evaluateGatePendingAttempt(gatePendingContext);
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
  expect(projectedTaskState()).toBe("gate_pending");
});

it("rejects a malformed present taskExecutionRef instead of reading it as legacy", () => {
  expect(() =>
    validateRecordSchema({ ...legacyTaskGateRecord, taskExecutionRef: { attemptId: "attempt-1" } }),
  ).toThrow();
});
```

Keep the existing four-new-variant validation fixture and add replay fixtures for each new task Gate,
plan Gate, task Acceptance, and plan Acceptance variant. Put the exact legacy validation and
malformed-half-new tests in `tests/runtime/validation.test.ts`; put the three-line single-physical-shard
fixture in `tests/runtime/observation-log-integrity.test.ts`; put compatibility projection coverage in
`tests/core/v2/state-projection.test.ts`; and put authoritative lookup / no-Acceptance-promotion
coverage in `tests/core/acceptance-decision.test.ts`. These tests must fail for the intended missing
compatibility behavior, not because a symbol is undefined.

Add barrier-coordinated concurrent RED tests in `tests/core/acceptance-decision.test.ts` against the
factory's public entry points. Release all callers at a barrier *before* they enter the decision
serialization boundary; pause the first `evaluateRules` result until the other calls are pending, then
release it. This creates actual overlapping invocations without blocking a correctly serialized
critical section. Cover all of the following:

- Two concurrent `evaluateGatePendingAttempt` calls for one `gate_pending` task identity evaluate Gate authority once, append exactly one durable GateDecision and one durable AcceptanceDecision, apply one downstream lifecycle transition, and return no integrity conflict.
- With one durable authoritative GateDecision but no AcceptanceDecision, two concurrent recoveries append exactly one AcceptanceDecision and return no conflict.
- Three overlapping calls for one identity maintain maximum one active decision operation and append one GateDecision and one AcceptanceDecision. Arrange A's completion after B and C have installed tails, then invoke a subsequent same-identity call after all three settle; it must proceed without waiting on a stale tail, so the test detects an old cleanup deleting a newer tail without exposing the private map.
- Concurrent Gate-phase blocked paths, including an evaluator failure and insufficient evidence, use the
  same decision-identity boundary through `appendBlockedAcceptanceWithinDecisionIdentity` and append exactly
  one blocked AcceptanceDecision; pre-Gate blocked paths append none.
- When inexpensive, a different TaskExecutionRef or Finalization identity can enter its own boundary while the first identity is paused; it must not wait on an unrelated global lock.

The tests must use only existing dependency ports and the factory's returned evaluator; do not add
test-only production DI or expose queue internals. They must prove overlap with a barrier
and controlled promises, not claim concurrency idempotency from sequential invocations.

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/v2/rule-evaluation-engine.test.ts tests/core/v2/gate-yaml-parser.test.ts tests/core/v2/gate-definition.test.ts tests/core/v2/default-gates.test.ts tests/core/acceptance-decision.test.ts tests/core/v2/state-projection.test.ts tests/core/v2/persistence-redaction.test.ts tests/runtime/validation.test.ts tests/runtime/gate-loader.test.ts tests/runtime/gate-yaml-injection.test.ts tests/hooks/observation-handler-gate.test.ts tests/core/rule-engine-determinism.test.ts tests/core/evidence-provenance.test.ts tests/core/v2/gate-provenance-gating.test.ts tests/runtime/justice-gate-tool.test.ts tests/core/observation-log-replay.test.ts tests/core/record-reference-resolution.test.ts tests/runtime/observation-log-integrity.test.ts tests/hooks/observation-handler-tool.test.ts tests/hooks/observation-handler-workflow-bootstrap.test.ts`

Expected: FAIL because plan-scoped Gate selection, the four durable decision variants,
restart validation, and Gate/Acceptance recovery are not implemented.

- [ ] **Step 3: Implement scoped Gate selection**

Define `GateRule.gateType` as `"task" | "plan"`. Define task triggers as `task_complete | tool_observed` and the plan trigger as `final_review_complete`. `evaluateGatePendingAttempt` must first read the durable projection and refuse to invoke `evaluate` unless its current lifecycle is `gate_pending` or `final_gate_pending` and the matching terminal review record is projected. Gate and Acceptance lookups are pure queries over the durable `PersistedLogRecord` stream: `findCurrentGateDecision` and `findCurrentAcceptanceDecision` scan projection order and match the complete task execution identity or finalization identity, so an old attempt or old final-review round is never reused. They do not add methods to `ProjectedLifecycle` and do not infer decisions from lifecycle state. The evaluator must inspect the same current identity for both existing durable decisions: an existing GateDecision and AcceptanceDecision are reused as the authoritative result and neither record is appended again; a missing GateDecision is evaluated and appended once; a GateDecision with no derived AcceptanceDecision derives and appends that decision once. Before invocation, resolve the correlation's authorizationId from the task execution ref or finalization identity and require the durable `AuthorizationStore` binding to be current `active`; released, invalidated, missing, unreadable, conflict-diverted, or otherwise uncertain bindings return a blocked / stale advisory without a GateDecision. After evaluation and immediately before the GateDecision-derived AcceptanceDecision append, re-read that durable binding and apply the same guard. Append a current-attempt GateDecision before deriving and durably recording the matching AcceptanceDecision. Map PASS to `accepted` / `complete`, WARN and FAIL to `rework_required` / `final_rework_required`, and errors, SKIP, or insufficient evidence to blocked while preserving `gate_pending` / `final_gate_pending`. A terminality race after Gate evaluation must not append `accepted` or `complete`.

Update every existing `GateContext` caller to use the new scope-discriminated shape. `ObservationHandler.evaluateGateIfTriggered` keeps its fail-open hook boundary, resolves the current `TaskExecutionRef` from the Task 3.1 lifecycle projection, and calls `evaluateGatePendingAttempt` instead of directly appending a raw GateDecision on every PostToolUse. `defineJusticeGateTool` returns a `SKIP` result when no current task attempt exists and otherwise builds a task-scoped context from the projected current ref. Update the direct rule-engine fixtures in `tests/core/rule-engine-determinism.test.ts`, `tests/core/evidence-provenance.test.ts`, `tests/core/v2/gate-provenance-gating.test.ts`, and `tests/core/v2/rule-evaluation-engine.test.ts` with `scope: "task"` and `taskExecutionRef`; update the gate-tool fixture to include the new `gateType`/trigger pair. The schema parser must reject a `task` gate with `final_review_complete` and a `plan` gate with a task trigger rather than silently ignoring either configuration.

```ts
// src/core/v2/gate-definition.ts
export type GateScope = "task" | "plan";
export type GateTrigger =
  | { readonly scope: "task"; readonly on: "task_complete" | "tool_observed" }
  | { readonly scope: "plan"; readonly on: "final_review_complete" };

export const GateRuleSchema = z
  .strictObject({
    id: z.string().trim().min(1),
    description: z.string().optional(),
    gateType: z.enum(["task", "plan"]),
    trigger: z.strictObject({
      scope: z.enum(["task", "plan"]),
      on: z.enum(["task_complete", "tool_observed", "final_review_complete"]),
    }),
    check: GateCheckSchema,
    onViolation: z.enum(["pass", "warn", "fail"]),
    onMissingEvidence: z.enum(["pass", "warn", "fail"]),
    enabled: z.boolean().default(true),
  })
  .superRefine((rule, refinement) => {
    const validTrigger =
      rule.trigger.scope === rule.gateType &&
      (rule.gateType === "task"
        ? rule.trigger.on === "task_complete" || rule.trigger.on === "tool_observed"
        : rule.trigger.on === "final_review_complete");
    if (!validTrigger) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trigger", "on"],
        message: "gateType and trigger scope do not match",
      });
    }
  });

export type GateRule = Omit<z.infer<typeof GateRuleSchema>, "trigger"> & {
  readonly trigger: GateTrigger;
};

// Update the matching `trigger.scope` field in every `DEFAULT_GATES` entry and every valid YAML
// fixture. Verify that `gate-yaml-parser` and `gate-loader` consume the new schema/defaults, and
// update the injection tests together so the required schema change cannot silently fall back to
// stale task-only fixtures.

// src/core/v2/gate-context.ts
import type { FinalizationAttemptId, ObservationAgentId, TaskExecutionRef } from "../types";
import type { ScopeReviewSummary } from "./state-projection";

export type GateContext =
  | {
      readonly scope: "task";
      readonly trigger: "task_complete" | "tool_observed";
      readonly taskExecutionRef: TaskExecutionRef;
      readonly agentId: ObservationAgentId;
      readonly sessionId: string;
      readonly writerId: string;
      readonly reviewScope: readonly string[];
      readonly reviewSummary?: { readonly byScope: ReadonlyMap<string, ScopeReviewSummary> };
    }
  | {
      readonly scope: "plan";
      readonly trigger: "final_review_complete";
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: number;
      readonly agentId: ObservationAgentId;
      readonly sessionId: string;
      readonly writerId: string;
      readonly reviewScope: readonly string[];
      readonly reviewSummary?: { readonly byScope: ReadonlyMap<string, ScopeReviewSummary> };
    };

export type GatePendingAttemptContext =
  | {
      readonly scope: "task";
      readonly trigger: "task_complete" | "tool_observed";
      readonly parentSessionId: string;
      readonly taskExecutionRef: TaskExecutionRef;
      readonly agentId: ObservationAgentId;
      readonly sessionId: string;
      readonly writerId: string;
    }
  | {
      readonly scope: "plan";
      readonly trigger: "final_review_complete";
      readonly parentSessionId: string;
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: number;
      readonly agentId: ObservationAgentId;
      readonly sessionId: string;
      readonly writerId: string;
    };

// src/core/v2/decision-model.ts
import type { FinalizationAttemptId, TaskExecutionRef } from "../types";

type GateDecisionFields = {
  readonly verdict: Verdict;
  readonly reachableEnforcementLevel: "L1";
  readonly appliedEnforcementLevel: "L0";
  readonly ruleResults: readonly RuleResult[];
};

export type TaskGateDecisionPayload = GateDecisionFields & {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly taskId: string;
  readonly taskExecutionRef: TaskExecutionRef;
};

// Read compatibility only. It is deliberately not a member of GateDecision.
export type LegacyTaskGateDecisionPayload = GateDecisionFields & {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly taskId: string;
  readonly taskExecutionRef?: undefined;
};

export type PlanGateDecisionPayload = GateDecisionFields & {
  readonly recordType: "decision";
  readonly gateType: "plan";
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
};

export type TaskAcceptanceDecisionPayload = {
  readonly recordType: "decision";
  readonly kind: "task-acceptance";
  readonly taskId: string;
  readonly taskExecutionRef: TaskExecutionRef;
  readonly verdict: "accepted" | "rework-required" | "blocked";
};

export type PlanAcceptanceDecisionPayload = {
  readonly recordType: "decision";
  readonly kind: "plan-acceptance";
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
  readonly verdict: "complete" | "rework-required" | "blocked";
};

export type DecisionPayload =
  | LegacyTaskGateDecisionPayload
  | TaskGateDecisionPayload
  | PlanGateDecisionPayload
  | TaskAcceptanceDecisionPayload
  | PlanAcceptanceDecisionPayload;
export type GateDecisionPayload = TaskGateDecisionPayload | PlanGateDecisionPayload;
export type AcceptanceDecisionPayload =
  | TaskAcceptanceDecisionPayload
  | PlanAcceptanceDecisionPayload;
export type PendingDecisionRecord = PendingEnvelope & DecisionPayload;
export type DecisionRecord = PersistedEnvelope & DecisionPayload;
export type TaskGateDecision = PersistedEnvelope & TaskGateDecisionPayload;
export type LegacyTaskGateDecision = PersistedEnvelope & LegacyTaskGateDecisionPayload;
export type PlanGateDecision = PersistedEnvelope & PlanGateDecisionPayload;
export type TaskAcceptanceDecision = PersistedEnvelope & TaskAcceptanceDecisionPayload;
export type PlanAcceptanceDecision = PersistedEnvelope & PlanAcceptanceDecisionPayload;
export type GateDecision = TaskGateDecision | PlanGateDecision;
export type AcceptanceDecision = TaskAcceptanceDecision | PlanAcceptanceDecision;

// src/runtime/validation.ts
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafePlanPath(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !/^[A-Za-z]:/u.test(value) &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function isPositiveReviewRound(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

function isTaskExecutionRef(value: unknown): value is TaskExecutionRef {
  return (
    isObject(value) &&
    isNonEmptyString(value.authorizationId) &&
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.attemptId)
  );
}

const TASK_IDENTITY_FIELDS = ["taskId", "taskExecutionRef"] as const;
const PLAN_IDENTITY_FIELDS = [
  "authorizationId",
  "planPath",
  "finalizationAttemptId",
  "finalReviewRound",
] as const;

function hasAnyOwnProperty(
  record: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.some((field) => Object.hasOwn(record, field));
}

function validateRuleResults(value: unknown): void {
  if (!Array.isArray(value)) throw new Error("Invalid decision record");
  for (const ruleResult of value) {
    if (
      !isObject(ruleResult) ||
      !isNonEmptyString(ruleResult.ruleId) ||
      !isOneOf(ruleResult.verdict, ["PASS", "WARN", "FAIL"]) ||
      typeof ruleResult.reason !== "string" ||
      !Array.isArray(ruleResult.evidenceRefs)
    ) {
      throw new Error("Invalid decision ruleResult");
    }
    for (const ref of ruleResult.evidenceRefs) {
      if (
        !isObject(ref) ||
        ref.kind !== "full" ||
        typeof ref.agentId !== "string" ||
        typeof ref.sessionId !== "string" ||
        typeof ref.writerId !== "string" ||
        typeof ref.sequence !== "number" ||
        !Number.isFinite(ref.sequence) ||
        ref.sequence < 0 ||
        typeof ref.evidenceId !== "string"
      ) {
        throw new Error("Invalid decision evidenceRef");
      }
    }
  }
}

function validateGateFields(r: Record<string, unknown>): void {
  if (
    !isOneOf(r.verdict, ["PASS", "WARN", "FAIL"]) ||
    r.reachableEnforcementLevel !== "L1" ||
    r.appliedEnforcementLevel !== "L0"
  ) {
    throw new Error("Invalid decision record");
  }
  validateRuleResults(r.ruleResults);
}

function validateDecisionRecord(r: Record<string, unknown>): void {
  const hasGateDiscriminant = r.gateType !== undefined;
  const hasAcceptanceDiscriminant = r.kind !== undefined;
  if (hasGateDiscriminant === hasAcceptanceDiscriminant) {
    throw new Error("Invalid decision record: ambiguous decision discriminant");
  }

  if (hasGateDiscriminant) {
    if (!isOneOf(r.gateType, ["task", "plan"])) {
      throw new Error("Invalid decision record: unknown gateType");
    }
    validateGateFields(r);
    if (r.gateType === "task") {
      if (hasAnyOwnProperty(r, PLAN_IDENTITY_FIELDS)) {
        throw new Error("Invalid task GateDecision scope");
      }
      // Property presence selects the new schema. Invalid present data must not
      // downgrade to the legacy branch.
      if (!Object.hasOwn(r, "taskExecutionRef")) {
        if (!isNonEmptyString(r.taskId)) {
          throw new Error("Invalid legacy task GateDecision");
        }
        return;
      }
      if (
        !isTaskExecutionRef(r.taskExecutionRef) ||
        !isNonEmptyString(r.taskId) ||
        r.taskId !== r.taskExecutionRef.taskId
      ) {
        throw new Error("Invalid task GateDecision identity");
      }
      return;
    }
    if (
      hasAnyOwnProperty(r, TASK_IDENTITY_FIELDS) ||
      !isNonEmptyString(r.authorizationId) ||
      !isSafePlanPath(r.planPath) ||
      !isNonEmptyString(r.finalizationAttemptId) ||
      !isPositiveReviewRound(r.finalReviewRound)
    ) {
      throw new Error("Invalid plan GateDecision identity");
    }
    return;
  }

  if (r.kind === "task-acceptance") {
    if (
      hasAnyOwnProperty(r, PLAN_IDENTITY_FIELDS) ||
      !isTaskExecutionRef(r.taskExecutionRef) ||
      !isNonEmptyString(r.taskId) ||
      r.taskId !== r.taskExecutionRef.taskId ||
      !isOneOf(r.verdict, ["accepted", "rework-required", "blocked"])
    ) {
      throw new Error("Invalid task AcceptanceDecision");
    }
    return;
  }
  if (r.kind === "plan-acceptance") {
    if (
      hasAnyOwnProperty(r, TASK_IDENTITY_FIELDS) ||
      !isNonEmptyString(r.authorizationId) ||
      !isSafePlanPath(r.planPath) ||
      !isNonEmptyString(r.finalizationAttemptId) ||
      !isPositiveReviewRound(r.finalReviewRound) ||
      !isOneOf(r.verdict, ["complete", "rework-required", "blocked"])
    ) {
      throw new Error("Invalid plan AcceptanceDecision");
    }
    return;
  }
  throw new Error("Invalid decision record: unknown acceptance kind");
}

// src/core/v2/state-projection.ts
function applyDecisionEvent(
  tasks: Map<string, MutableTask>,
  event: Extract<PersistedLogRecord, { readonly recordType: "decision" }>,
): void {
  if (!("gateType" in event) || event.gateType !== "task") return;
  const taskState = ensureTask(tasks, event.taskId);
  taskState.lastVerdict = event.verdict;
  taskState.status = event.verdict;
}

// Legacy task Gate records remain compatibility projection input only. The
// authoritative lookup, Acceptance derivation, and lifecycle code use the
// separate isAuthoritativeGateDecisionRecord predicate below.

// src/core/v2/persistence-redaction.ts
// Replace only the decision branch at the top of the existing redaction boundary;
// keep the observation-record switch below it unchanged.
if (record.recordType === "decision") {
  if (!("ruleResults" in record)) return record;
  return {
    ...record,
    ruleResults: record.ruleResults.map((result) => ({
      ...result,
      ...(result.reason === undefined ? {} : { reason: redactForPersistence(result.reason) }),
    })),
  };
}

// src/core/acceptance-decision.ts
import type {
  FinalizationAttemptId,
  FinalReviewCorrelation,
  ReviewCorrelation,
  TaskExecutionRef,
} from "./types";
import type { ApprovedPlanBinding, AuthorizationReviewBoundary } from "./plan-authorization";
import type {
  AcceptanceDecision,
  AcceptanceDecisionPayload,
  DecisionPayload,
  GateDecision,
  GateDecisionPayload,
  LegacyTaskGateDecision,
  PendingDecisionRecord,
} from "./v2/decision-model";
import type { GateContext, GatePendingAttemptContext } from "./v2/gate-context";
import { orderEventsForProjection } from "./v2/integrity";
import type { PersistedLogRecord } from "./v2/observation-model";
import {
  project,
  type PlanFinalizationTransitionInput,
  type ProjectedLifecycle,
  type ProjectedState,
  type TaskLifecycleTransitionInput,
} from "./v2/state-projection";

type SkipGateEvaluation = {
  readonly verdict: "SKIP";
  readonly reason: string;
};

type GateRuleEvaluation =
  | GateDecisionPayload
  | SkipGateEvaluation
  | { readonly kind: "insufficient_evidence"; readonly reason: string };

type SafeGateEvaluation =
  | { readonly kind: "evaluated"; readonly decision: GateDecisionPayload }
  | { readonly kind: "blocked"; readonly advisory: string };

export type GateEvaluationDependencies = {
  readonly readDurableRecords: () => Promise<readonly PersistedLogRecord[]>;
  readonly appendDecision: (
    record: PendingDecisionRecord,
  ) => Promise<{ readonly kind: "committed" | "failed" }>;
  // The runtime adapter normalizes missing, unreadable, and conflict-diverted
  // authorization state to null; this core module never reads the store directly.
  readonly findAuthorizationById: (
    authorizationId: string,
  ) => Promise<ApprovedPlanBinding | null>;
  readonly withAuthorizationReviewBoundary: AuthorizationReviewBoundary["withParentSession"];
  readonly appendTaskLifecycleTransition: (
    input: TaskLifecycleTransitionInput,
  ) => Promise<{ readonly kind: "committed" | "failed" }>;
  readonly appendPlanFinalizationTransition: (
    input: PlanFinalizationTransitionInput,
  ) => Promise<{ readonly kind: "committed" | "failed" }>;
  readonly evaluateRules: (
    input: { readonly context: GateContext; readonly projected: ProjectedState },
  ) => Promise<GateRuleEvaluation>;
  readonly recordAdvisory: (advisory: string) => Promise<void>;
};

async function recordAdvisorySafely(
  dependencies: GateEvaluationDependencies,
  advisory: string,
): Promise<void> {
  try {
    await dependencies.recordAdvisory(advisory);
  } catch {
    // An advisory failure must not change the non-blocking hook result.
  }
}

export function authorizationIdFor(correlation: ReviewCorrelation): string {
  return correlation.reviewKind === "task-review"
    ? correlation.taskExecutionRef.authorizationId
    : correlation.authorizationId;
}

export async function isCurrentActiveAuthorization(
  correlation: ReviewCorrelation,
  findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"],
): Promise<boolean> {
  try {
    const binding = await findAuthorizationById(authorizationIdFor(correlation));
    if (binding === null || binding.status !== "active") return false;
    if (correlation.reviewKind === "task-review") {
      return binding.canonicalSnapshot.tasks.some(
        (task) => task.taskId === correlation.taskExecutionRef.taskId,
      );
    }
    return (
      binding.planPath === correlation.planPath &&
      binding.planFingerprint.algorithm === correlation.planFingerprint.algorithm &&
      binding.planFingerprint.value === correlation.planFingerprint.value
    );
  } catch {
    return false;
  }
}

async function currentReviewCorrelationFor(
  context: GatePendingAttemptContext,
  records: readonly PersistedLogRecord[],
  lifecycle: ProjectedLifecycle,
  findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"],
): Promise<ReviewCorrelation | undefined> {
  const ordered = orderEventsForProjection(records);
  if (context.scope === "task") {
    const currentRef = lifecycle.currentTaskExecutionRefs.get(context.taskExecutionRef.taskId);
    if (
      currentRef === undefined ||
      !sameTaskExecutionRef(currentRef, context.taskExecutionRef)
    ) {
      return undefined;
    }
    let reviewRound = 1;
    for (const record of ordered) {
      if (
        record.kind === "review_dispatch_transition" &&
        record.correlation.reviewKind === "task-review" &&
        sameTaskExecutionRef(record.correlation.taskExecutionRef, currentRef)
      ) {
        reviewRound = Math.max(reviewRound, record.correlation.reviewRound);
      }
    }
    return { reviewKind: "task-review", taskExecutionRef: currentRef, reviewRound };
  }

  const current = lifecycle.finalization;
  if (
    current === undefined ||
    current.authorizationId !== context.authorizationId ||
    current.planPath !== context.planPath ||
    current.finalizationAttemptId !== context.finalizationAttemptId ||
    current.finalReviewRound !== context.finalReviewRound
  ) {
    return undefined;
  }
  const binding = await findAuthorizationById(current.authorizationId);
  if (binding === null || binding.planPath !== current.planPath) return undefined;
  let finalReviewRound = current.finalReviewRound;
  for (const record of ordered) {
    if (
      record.kind === "review_dispatch_transition" &&
      record.correlation.reviewKind === "final-review" &&
      record.correlation.authorizationId === current.authorizationId &&
      record.correlation.planPath === current.planPath &&
      record.correlation.finalizationAttemptId === current.finalizationAttemptId
    ) {
      finalReviewRound = Math.max(finalReviewRound, record.correlation.finalReviewRound);
    }
  }
  return {
    reviewKind: "final-review",
    authorizationId: current.authorizationId,
    planPath: current.planPath,
    planFingerprint: binding.planFingerprint,
    finalizationAttemptId: current.finalizationAttemptId,
    finalReviewRound,
  };
}

export function sameReviewCorrelation(left: ReviewCorrelation, right: ReviewCorrelation): boolean {
  if (left.reviewKind !== right.reviewKind) return false;
  if (left.reviewKind === "task-review" && right.reviewKind === "task-review") {
    return (
      left.reviewRound === right.reviewRound &&
      sameTaskExecutionRef(left.taskExecutionRef, right.taskExecutionRef)
    );
  }
  if (left.reviewKind === "final-review" && right.reviewKind === "final-review") {
    return (
      left.authorizationId === right.authorizationId &&
      left.planPath === right.planPath &&
      left.finalizationAttemptId === right.finalizationAttemptId &&
      left.finalReviewRound === right.finalReviewRound &&
      left.planFingerprint.algorithm === right.planFingerprint.algorithm &&
      left.planFingerprint.value === right.planFingerprint.value
    );
  }
  return false;
}

function hasProjectedTerminalReview(
  records: readonly PersistedLogRecord[],
  correlation: ReviewCorrelation,
): boolean {
  return orderEventsForProjection(records).some(
    (record) =>
      record.kind === "review_dispatch_transition" &&
      record.to === "terminal" &&
      record.terminalReason === "completed" &&
      record.reviewArtifact.complete === true &&
      record.reviewArtifact.findings.length === 0 &&
      sameReviewCorrelation(record.correlation, correlation),
  );
}

function isCurrentGatePending(
  context: GatePendingAttemptContext,
  lifecycle: ProjectedLifecycle,
  ): boolean {
  if (context.scope === "task") {
    const currentRef = lifecycle.currentTaskExecutionRefs.get(context.taskExecutionRef.taskId);
    if (currentRef === undefined) return false;
    return (
      sameTaskExecutionRef(currentRef, context.taskExecutionRef) &&
      lifecycle.taskStates.get(context.taskExecutionRef.taskId) === "gate_pending"
    );
  }
  const current = lifecycle.finalization;
  return (
    current !== undefined &&
    current.authorizationId === context.authorizationId &&
    current.planPath === context.planPath &&
    current.finalizationAttemptId === context.finalizationAttemptId &&
    current.finalReviewRound === context.finalReviewRound &&
    current.state === "final_gate_pending"
  );
}

async function safelyEvaluateGate(
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
  records: readonly PersistedLogRecord[],
  dependencies: GateEvaluationDependencies,
): Promise<SafeGateEvaluation> {
  try {
    const projected = project(records, new Date().toISOString());
    const gateContext =
      correlation.reviewKind === "task-review"
        ? {
            scope: "task" as const,
            trigger: context.scope === "task" ? context.trigger : "task_complete",
            taskExecutionRef: correlation.taskExecutionRef,
            agentId: context.agentId,
            sessionId: context.sessionId,
            writerId: context.writerId,
            reviewScope:
              projected.tasks.get(correlation.taskExecutionRef.taskId)?.observedReviewScopes ?? [],
            reviewSummary: projected.reviewSummary,
          }
        : {
            scope: "plan" as const,
            trigger: "final_review_complete" as const,
            authorizationId: correlation.authorizationId,
            planPath: correlation.planPath,
            finalizationAttemptId: correlation.finalizationAttemptId,
            finalReviewRound: correlation.finalReviewRound,
            agentId: context.agentId,
            sessionId: context.sessionId,
            writerId: context.writerId,
            reviewScope: Array.from(projected.reviewSummary.byScope.keys()),
            reviewSummary: projected.reviewSummary,
          };
    const result = await dependencies.evaluateRules({ context: gateContext, projected });
    if ("kind" in result && result.kind === "insufficient_evidence") {
      return { kind: "blocked", advisory: "gate_evidence_insufficient" };
    }
    if ("verdict" in result && result.verdict === "SKIP") {
      return { kind: "blocked", advisory: "gate_evaluation_skipped" };
    }
    return { kind: "evaluated", decision: result };
  } catch {
    // Loader, projection, and evaluator failures are fail-closed for the Gate.
    return { kind: "blocked", advisory: "gate_evaluation_failed" };
  }
}

export type GateDecisionLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "found"; readonly decision: GateDecision }
  | { readonly kind: "conflict"; readonly advisory: "multiple current GateDecision records" };
export type AcceptanceDecisionLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "found"; readonly decision: AcceptanceDecision }
  | {
      readonly kind: "conflict";
      readonly advisory: "multiple current AcceptanceDecision records";
    };

function sameTaskExecutionRef(left: TaskExecutionRef, right: TaskExecutionRef): boolean {
  return (
    left.authorizationId === right.authorizationId &&
    left.taskId === right.taskId &&
    left.attemptId === right.attemptId
  );
}

function isAuthoritativeGateDecisionRecord(record: PersistedLogRecord): record is GateDecision {
  return (
    record.recordType === "decision" &&
    "gateType" in record &&
    ((record.gateType === "task" && "taskExecutionRef" in record) || record.gateType === "plan")
  );
}

export function isLegacyTaskGateDecisionRecord(
  record: PersistedLogRecord,
): record is LegacyTaskGateDecision {
  return (
    record.recordType === "decision" &&
    "gateType" in record &&
    record.gateType === "task" &&
    !("taskExecutionRef" in record)
  );
}

function isAcceptanceDecisionRecord(record: PersistedLogRecord): record is AcceptanceDecision {
  return (
    record.recordType === "decision" &&
    "kind" in record &&
    (record.kind === "task-acceptance" || record.kind === "plan-acceptance")
  );
}

function gateMatchesCorrelation(record: GateDecision, correlation: ReviewCorrelation): boolean {
  if (correlation.reviewKind === "task-review") {
    return (
      record.gateType === "task" &&
      sameTaskExecutionRef(record.taskExecutionRef, correlation.taskExecutionRef)
    );
  }
  return (
    record.gateType === "plan" &&
    record.authorizationId === correlation.authorizationId &&
    record.planPath === correlation.planPath &&
    record.finalizationAttemptId === correlation.finalizationAttemptId &&
    record.finalReviewRound === correlation.finalReviewRound
  );
}

function acceptanceMatchesCorrelation(
  record: AcceptanceDecision,
  correlation: ReviewCorrelation,
): boolean {
  if (correlation.reviewKind === "task-review") {
    return (
      record.kind === "task-acceptance" &&
      sameTaskExecutionRef(record.taskExecutionRef, correlation.taskExecutionRef)
    );
  }
  return (
    record.kind === "plan-acceptance" &&
    record.authorizationId === correlation.authorizationId &&
    record.planPath === correlation.planPath &&
    record.finalizationAttemptId === correlation.finalizationAttemptId &&
    record.finalReviewRound === correlation.finalReviewRound
  );
}

function acceptanceMatchesGate(gate: GateDecision, acceptance: AcceptanceDecision): boolean {
  if (gate.gateType === "task") {
    return (
      acceptance.kind === "task-acceptance" &&
      sameTaskExecutionRef(acceptance.taskExecutionRef, gate.taskExecutionRef) &&
      acceptance.verdict === (gate.verdict === "PASS" ? "accepted" : "rework-required")
    );
  }
  return (
    acceptance.kind === "plan-acceptance" &&
    acceptance.authorizationId === gate.authorizationId &&
    acceptance.planPath === gate.planPath &&
    acceptance.finalizationAttemptId === gate.finalizationAttemptId &&
    acceptance.finalReviewRound === gate.finalReviewRound &&
    acceptance.verdict === (gate.verdict === "PASS" ? "complete" : "rework-required")
  );
}

async function ensureGateAcceptance(
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
  gate: GateDecision,
  dependencies: GateEvaluationDependencies,
): Promise<GatePendingAttemptResult> {
  if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById))) {
    return { kind: "blocked", advisory: "review_authorization_not_active" };
  }
  const existing = findCurrentAcceptanceDecision(await dependencies.readDurableRecords(), correlation);
  if (existing.kind === "conflict") {
    await recordAdvisorySafely(dependencies, "decision_integrity_violation");
    return { kind: "blocked", advisory: "decision_integrity_violation" };
  }
  if (existing.kind === "missing") {
    await appendAcceptanceDecisionIfMissing(
      context,
      correlation,
      deriveAcceptanceDecision(gate),
      context.writerId,
      dependencies,
    );
  }
  const latest = findCurrentAcceptanceDecision(await dependencies.readDurableRecords(), correlation);
  if (latest.kind === "conflict") {
    await recordAdvisorySafely(dependencies, "decision_integrity_violation");
    return { kind: "blocked", advisory: "decision_integrity_violation" };
  }
  if (latest.kind === "found" && !acceptanceMatchesGate(gate, latest.decision)) {
    await recordAdvisorySafely(dependencies, "decision_integrity_violation");
    return { kind: "blocked", advisory: "decision_integrity_violation" };
  }
  if (latest.kind !== "found") {
    return { kind: "blocked", advisory: "acceptance_append_failed" };
  }
  const lifecycle = await applyGateOutcomeLifecycle(context, correlation, gate, dependencies);
  return lifecycle.kind === "blocked" ? lifecycle : { kind: "decided", decision: gate };
}

export function deriveAcceptanceDecision(gate: GateDecision): AcceptanceDecisionPayload {
  if (gate.gateType === "task") {
    return {
      recordType: "decision",
      kind: "task-acceptance",
      taskId: gate.taskId,
      taskExecutionRef: gate.taskExecutionRef,
      verdict: gate.verdict === "PASS" ? "accepted" : "rework-required",
    };
  }
  return {
    recordType: "decision",
    kind: "plan-acceptance",
    authorizationId: gate.authorizationId,
    planPath: gate.planPath,
    finalizationAttemptId: gate.finalizationAttemptId,
    finalReviewRound: gate.finalReviewRound,
    verdict: gate.verdict === "PASS" ? "complete" : "rework-required",
  };
}

type DecisionAppendResult = {
  readonly kind: "committed" | "already_present" | "failed";
};

async function appendDecisionWithEnvelope(
  context: GatePendingAttemptContext,
  payload: DecisionPayload,
  writerId: string,
  appendDecision: GateEvaluationDependencies["appendDecision"],
): Promise<DecisionAppendResult> {
  const pending: PendingDecisionRecord = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    agentId: context.agentId,
    sessionId: context.sessionId,
    writerId,
    recordType: "decision",
    ...payload,
  };
  try {
    const appended = await appendDecision(pending);
    return appended.kind === "committed" ? { kind: "committed" } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

async function appendGateDecision(
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
  payload: GateDecisionPayload,
  dependencies: GateEvaluationDependencies,
): Promise<DecisionAppendResult> {
  if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById))) {
    return { kind: "failed" };
  }
  const existing = findCurrentGateDecision(await dependencies.readDurableRecords(), correlation);
  if (existing.kind === "conflict") {
    await recordAdvisorySafely(dependencies, "decision_integrity_violation");
    return { kind: "failed" };
  }
  if (existing.kind === "found") return { kind: "already_present" };
  return appendDecisionWithEnvelope(context, payload, context.writerId, dependencies.appendDecision);
}

async function appendAcceptanceDecisionIfMissing(
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
  payload: AcceptanceDecisionPayload,
  writerId: string,
  dependencies: GateEvaluationDependencies,
): Promise<DecisionAppendResult> {
  if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById))) {
    return { kind: "failed" };
  }
  const existing = findCurrentAcceptanceDecision(await dependencies.readDurableRecords(), correlation);
  if (existing.kind === "conflict") {
    await recordAdvisorySafely(dependencies, "decision_integrity_violation");
    return { kind: "failed" };
  }
  if (existing.kind === "found") return { kind: "already_present" };
  return appendDecisionWithEnvelope(context, payload, writerId, dependencies.appendDecision);
}

function blockedAcceptancePayload(correlation: ReviewCorrelation): AcceptanceDecisionPayload {
  if (correlation.reviewKind === "task-review") {
    return {
      recordType: "decision",
      kind: "task-acceptance",
      taskId: correlation.taskExecutionRef.taskId,
      taskExecutionRef: correlation.taskExecutionRef,
      verdict: "blocked",
    };
  }
  return {
    recordType: "decision",
    kind: "plan-acceptance",
    authorizationId: correlation.authorizationId,
    planPath: correlation.planPath,
    finalizationAttemptId: correlation.finalizationAttemptId,
    finalReviewRound: correlation.finalReviewRound,
    verdict: "blocked",
  };
}

async function appendBlockedAcceptanceWithinDecisionIdentity(
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
  dependencies: GateEvaluationDependencies,
): Promise<DecisionAppendResult> {
  try {
    const records = await dependencies.readDurableRecords();
    const lifecycle = project(records, new Date().toISOString()).lifecycle;
    const current = await currentReviewCorrelationFor(
      context,
      records,
      lifecycle,
      dependencies.findAuthorizationById,
    );
    if (
      current === undefined ||
      !sameReviewCorrelation(current, correlation) ||
      !isCurrentGatePending(context, lifecycle) ||
      !hasProjectedTerminalReview(records, current)
    ) {
      return { kind: "failed" };
    }

    const gate = findCurrentGateDecision(records, current);
    if (gate.kind === "conflict") {
      await recordAdvisorySafely(dependencies, "decision_integrity_violation");
      return { kind: "failed" };
    }
    if (gate.kind === "found") return { kind: "failed" };

    const acceptance = findCurrentAcceptanceDecision(records, current);
    if (acceptance.kind === "conflict") {
      await recordAdvisorySafely(dependencies, "decision_integrity_violation");
      return { kind: "failed" };
    }
    if (acceptance.kind === "found") {
      if (acceptance.decision.verdict === "blocked") return { kind: "already_present" };
      await recordAdvisorySafely(dependencies, "acceptance_without_gate");
      return { kind: "failed" };
    }

    return appendAcceptanceDecisionIfMissing(
      context,
      current,
      blockedAcceptancePayload(current),
      context.writerId,
      dependencies,
    );
  } catch {
    await recordAdvisorySafely(dependencies, "blocked_acceptance_append_failed");
    return { kind: "failed" };
  }
}

export function findCurrentGateDecision(
  records: readonly PersistedLogRecord[],
  correlation: ReviewCorrelation,
): GateDecisionLookup {
  const matches = orderEventsForProjection(records)
    .filter(isAuthoritativeGateDecisionRecord)
    .filter((record) => gateMatchesCorrelation(record, correlation));
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) {
    return { kind: "conflict", advisory: "multiple current GateDecision records" };
  }
  const decision = matches[0];
  return decision === undefined ? { kind: "missing" } : { kind: "found", decision };
}

export function findCurrentAcceptanceDecision(
  records: readonly PersistedLogRecord[],
  correlation: ReviewCorrelation,
): AcceptanceDecisionLookup {
  const matches = orderEventsForProjection(records)
    .filter(isAcceptanceDecisionRecord)
    .filter((record) => acceptanceMatchesCorrelation(record, correlation));
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) {
    return { kind: "conflict", advisory: "multiple current AcceptanceDecision records" };
  }
  const decision = matches[0];
  return decision === undefined ? { kind: "missing" } : { kind: "found", decision };
}

async function evaluateGatePendingAttemptWithinDecisionIdentity(
  context: GatePendingAttemptContext,
  dependencies: GateEvaluationDependencies,
): Promise<GatePendingAttemptResult> {
  try {
    const records = await dependencies.readDurableRecords();
    const lifecycle = project(records, new Date().toISOString()).lifecycle;
    const correlation = await currentReviewCorrelationFor(
      context,
      records,
      lifecycle,
      dependencies.findAuthorizationById,
    );
    if (
      correlation === undefined ||
      !isCurrentGatePending(context, lifecycle) ||
      !hasProjectedTerminalReview(records, correlation)
    ) {
      return { kind: "not_applicable" };
    }

    const gate = findCurrentGateDecision(records, correlation);
    const acceptance = findCurrentAcceptanceDecision(records, correlation);
    if (gate.kind === "conflict" || acceptance.kind === "conflict") {
      await recordAdvisorySafely(dependencies, "decision_integrity_violation");
      return { kind: "blocked", advisory: "decision_integrity_violation" };
    }
    if (gate.kind === "found" && acceptance.kind === "found") {
      if (!acceptanceMatchesGate(gate.decision, acceptance.decision)) {
        await recordAdvisorySafely(dependencies, "decision_integrity_violation");
        return { kind: "blocked", advisory: "decision_integrity_violation" };
      }
      const lifecycleResult = await applyGateOutcomeLifecycle(
        context,
        correlation,
        gate.decision,
        dependencies,
      );
      return lifecycleResult.kind === "blocked"
        ? lifecycleResult
        : { kind: "decided", decision: gate.decision };
    }

    if (gate.kind === "found") {
      return ensureGateAcceptance(context, correlation, gate.decision, dependencies);
    }

    // A blocked Acceptance without a Gate is a prior Gate-phase fail-closed result.
    if (acceptance.kind === "found") {
      if (acceptance.decision.verdict === "blocked") {
        return { kind: "blocked", advisory: "gate_evaluation_blocked" };
      }
      await recordAdvisorySafely(dependencies, "acceptance_without_gate");
      return { kind: "blocked", advisory: "acceptance_without_gate" };
    }

    if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById))) {
      return { kind: "blocked", advisory: "review_authorization_not_active" };
    }
    const evaluated = await safelyEvaluateGate(context, correlation, records, dependencies);
    if (evaluated.kind === "blocked") {
      const blocked = await appendBlockedAcceptanceWithinDecisionIdentity(
        context,
        correlation,
        dependencies,
      );
      if (blocked.kind === "failed") {
        await recordAdvisorySafely(dependencies, "blocked_acceptance_append_failed");
      }
      return { kind: "blocked", advisory: evaluated.advisory };
    }

    const gateAppend = await appendGateDecision(context, correlation, evaluated.decision, dependencies);
    if (gateAppend.kind === "failed") {
      return { kind: "blocked", advisory: "gate_decision_append_failed" };
    }
    const latestGate = findCurrentGateDecision(
      await dependencies.readDurableRecords(),
      correlation,
    );
    if (latestGate.kind !== "found") {
      const advisory =
        latestGate.kind === "conflict"
          ? "decision_integrity_violation"
          : "gate_decision_append_failed";
      await recordAdvisorySafely(dependencies, advisory);
      return { kind: "blocked", advisory };
    }
    return ensureGateAcceptance(context, correlation, latestGate.decision, dependencies);
  } catch {
    await recordAdvisorySafely(dependencies, "gate_evaluation_failed");
    return { kind: "blocked", advisory: "gate_evaluation_failed" };
  }
}

type GateOutcomeLifecycleResult =
  | { readonly kind: "applied" | "already_applied" }
  | { readonly kind: "blocked"; readonly advisory: string };

async function applyGateOutcomeLifecycle(
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
  decision: GateDecisionPayload,
  dependencies: GateEvaluationDependencies,
): Promise<GateOutcomeLifecycleResult> {
  if (context.scope === "task" && decision.gateType !== "task") {
    return { kind: "blocked", advisory: "gate_scope_mismatch" };
  }
  if (context.scope === "plan" && decision.gateType !== "plan") {
    return { kind: "blocked", advisory: "gate_scope_mismatch" };
  }

  const records = await dependencies.readDurableRecords();
  const lifecycle = project(records, new Date().toISOString()).lifecycle;
  if (context.scope === "task") {
    const target = decision.verdict === "PASS" ? "accepted" : "rework_required";
    const currentRef = lifecycle.currentTaskExecutionRefs.get(context.taskExecutionRef.taskId);
    if (currentRef === undefined || !sameTaskExecutionRef(currentRef, context.taskExecutionRef)) {
      return { kind: "blocked", advisory: "gate_lifecycle_identity_stale" };
    }
    const current = lifecycle.taskStates.get(context.taskExecutionRef.taskId);
    if (current === target) return { kind: "already_applied" };
    if (current !== "gate_pending") {
      return { kind: "blocked", advisory: "gate_lifecycle_state_stale" };
    }
    if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById))) {
      return { kind: "blocked", advisory: "review_authorization_not_active" };
    }
    const appended = await dependencies.appendTaskLifecycleTransition({
      parentSessionId: context.parentSessionId,
      taskExecutionRef: context.taskExecutionRef,
      from: "gate_pending",
      to: target,
    });
    return appended.kind === "committed"
      ? { kind: "applied" }
      : { kind: "blocked", advisory: "gate_lifecycle_append_failed" };
  }

  const current = lifecycle.finalization;
  const target = decision.verdict === "PASS" ? "complete" : "final_rework_required";
  if (
    current === undefined ||
    current.authorizationId !== context.authorizationId ||
    current.planPath !== context.planPath ||
    current.finalizationAttemptId !== context.finalizationAttemptId ||
    current.finalReviewRound !== context.finalReviewRound
  ) {
    return { kind: "blocked", advisory: "gate_lifecycle_identity_stale" };
  }
  if (current?.state === target) return { kind: "already_applied" };
  if (current === undefined || current.state !== "final_gate_pending") {
    return { kind: "blocked", advisory: "gate_lifecycle_state_stale" };
  }
  if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById))) {
    return { kind: "blocked", advisory: "review_authorization_not_active" };
  }
  const appended = await dependencies.appendPlanFinalizationTransition({
    parentSessionId: context.parentSessionId,
    authorizationId: context.authorizationId,
    planPath: context.planPath,
    finalizationAttemptId: context.finalizationAttemptId,
    finalReviewRound: context.finalReviewRound,
    from: "final_gate_pending",
    to: target,
  });
  return appended.kind === "committed"
    ? { kind: "applied" }
    : { kind: "blocked", advisory: "gate_lifecycle_append_failed" };
}

export type GatePendingAttemptResult =
  | { readonly kind: "not_applicable" }
  | { readonly kind: "decided"; readonly decision: GateDecisionPayload }
  | { readonly kind: "blocked"; readonly advisory: string };

export function evaluate(
  gates: readonly GateRule[],
  evidence: readonly ProjectedEvidence[],
  ctx: GateContext,
): GateDecisionPayload | SkipGateEvaluation {
  const activeGates = gates.filter(
    (gate) =>
      gate.enabled &&
      gate.gateType === ctx.scope &&
      gate.trigger.scope === ctx.scope &&
      gate.trigger.on === ctx.trigger,
  );
  if (activeGates.length === 0) {
    return {
      verdict: "SKIP",
      reason: `no matching active gates found for trigger: ${ctx.trigger}`,
    };
  }

  const ruleResults = activeGates.map((gate) => evaluateRule(gate, evidence, ctx));
  const verdict = worstOf(ruleResults.map((result) => result.verdict));
  if (ctx.scope === "plan") {
    return {
      recordType: "decision",
      gateType: "plan",
      authorizationId: ctx.authorizationId,
      planPath: ctx.planPath,
      finalizationAttemptId: ctx.finalizationAttemptId,
      finalReviewRound: ctx.finalReviewRound,
      verdict,
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      ruleResults,
    };
  }
  return {
    recordType: "decision",
    gateType: "task",
    taskId: ctx.taskExecutionRef.taskId,
    taskExecutionRef: ctx.taskExecutionRef,
    verdict,
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults,
  };
}
```

`createGatePendingAttemptEvaluator` is the only public orchestration entry point. Its returned
`evaluateGatePendingAttempt` wraps the complete read/project/authorization/lookup/evaluation/append
operation with `serializeDecisionIdentity`; the wrapper owns one private tail map and never exposes that
map or a second queue entry point. `appendGateDecision`, `appendAcceptanceDecisionIfMissing`,
`ensureGateAcceptance`, and `appendBlockedAcceptanceWithinDecisionIdentity` are module-private helpers
that receive the already-injected dependencies and run only inside that serialized operation. Tasks 3.4
and 3.6 do not receive an Acceptance append function and therefore cannot issue a pre-Gate blocked
Acceptance.

The module-private helpers used above have fixed responsibilities: the injected
`readDurableRecords()` port supplies the latest durable records; `currentReviewCorrelationFor()` derives the current task review
round or final-review correlation from the Task 3.1/3.4 projection and trusted authorization
snapshot; `hasProjectedTerminalReview()` requires the matching observed terminal review record;
`isCurrentGatePending()` checks the matching `gate_pending` or `final_gate_pending` lifecycle state;
`safelyEvaluateGate()` constructs the full `GateContext` from the current correlation, projected
review summary, agent/session identity, and trigger; it normalizes `SKIP`, loader, projection, and
evaluator failures to a blocked outcome; and `appendGateDecision()` /
`appendAcceptanceDecisionIfMissing(context, payload, writerId)` add the common
persisted envelope and use the injected append-only store port. `appendBlockedAcceptanceWithinDecisionIdentity()`
rechecks the clean terminal, current Gate-pending lifecycle, missing GateDecision, and missing
AcceptanceDecision before deriving the blocked payload, and is called only after `safelyEvaluateGate()`
fails. It is not exposed to Tasks 3.4 or 3.6. Both append helpers re-read their corresponding durable
lookup inside the append boundary and treat an existing found record as a no-op, while a conflict records
`decision_integrity_violation` and never chooses a winner. `evaluateGatePendingAttempt`
wraps its complete read/project/authorization/evaluation/append boundary and converts any I/O,
projection, loader, or append failure into `{ kind: "blocked" }` without throwing; callers still
retain their outer fail-open boundary. `ObservationHandler` catches every failure around this
orchestration and still returns `PROCEED`. Update the existing
`applyGateOutcomeLifecycle` so it is called only after the matching AcceptanceDecision is found. It
appends `gate_pending → accepted | rework_required` or
`final_gate_pending → complete | final_rework_required` through the Task 3.1 idempotent lifecycle
boundary, after a fresh authorization check; it never updates `plan.md` directly.
`observation-handler-gate`, `observation-handler-tool`, and `observation-handler-workflow-bootstrap`
fixtures to arrange a current lifecycle identity before invoking the private hook path; assert the
Gate/Acceptance pair and advisory result rather than a raw per-event GateDecision append.
The hook maps `GatePendingAttemptResult.kind` as follows: `not_applicable` returns `PROCEED`;
`decided` returns `PROCEED` for `PASS` and uses `formatGateAdvisoryMessage` for `WARN`/`FAIL`;
`blocked` injects a plain L0 blocked/stale advisory without passing it to the GateDecision formatter.
All three paths remain non-blocking and preserve the existing response merge behavior for review
directives.
The public `evaluate` and `formatGateAdvisoryMessage` signatures accept only `GateDecisionPayload`;
change the formatter parameter from `Pick<DecisionPayload, "verdict" | "ruleResults">` to the
corresponding `GateDecisionPayload` pick, handle `SkipGateEvaluation` before formatting, and never
pass an AcceptanceDecision record to the Gate advisory formatter. Keep the Design §7.2 distinction
explicit: AcceptanceDecision uses the literal `rework-required`, while lifecycle transitions use
`rework_required` and `final_rework_required`.

For `defineJusticeGateTool`, return the existing JSON `SKIP` shape directly when `taskId` is
missing or when `state.lifecycle.currentTaskExecutionRefs.get(taskId)` is absent; do not call
`evaluate` with a partial context. For a current ref, construct the task `GateContext` with that
ref, the invoking agent/session, projected review summary, and `trigger: "task_complete"`, then
handle `SkipGateEvaluation` before serializing the result. The tool remains internal and must not
be added to `OpenCodeAdapter.getTools()`.

GREEN requires all legacy and new decision variants to replay without shard loss; legacy task Gate
records to remain excluded from authoritative lookup and Acceptance; the malformed half-new record to
be rejected; and every same-identity concurrent test to produce exactly one GateDecision and one
AcceptanceDecision without an integrity conflict. Sequential recovery remains idempotent, and restart
reconstructs state only from durable records.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/v2/rule-evaluation-engine.test.ts tests/core/v2/gate-yaml-parser.test.ts tests/core/v2/gate-definition.test.ts tests/core/v2/default-gates.test.ts tests/core/acceptance-decision.test.ts tests/core/v2/state-projection.test.ts tests/core/v2/persistence-redaction.test.ts tests/runtime/validation.test.ts tests/runtime/gate-loader.test.ts tests/runtime/gate-yaml-injection.test.ts tests/hooks/observation-handler-gate.test.ts tests/core/rule-engine-determinism.test.ts tests/core/evidence-provenance.test.ts tests/core/v2/gate-provenance-gating.test.ts tests/runtime/justice-gate-tool.test.ts tests/core/observation-log-replay.test.ts tests/core/record-reference-resolution.test.ts tests/runtime/observation-log-integrity.test.ts tests/hooks/observation-handler-tool.test.ts tests/hooks/observation-handler-workflow-bootstrap.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/acceptance-decision.ts src/core/v2/decision-model.ts src/core/v2/gate-definition.ts src/core/v2/default-gates.ts src/core/v2/gate-context.ts src/core/v2/rule-evaluation-engine.ts src/core/v2/state-projection.ts src/core/v2/persistence-redaction.ts src/runtime/validation.ts src/hooks/observation-handler.ts src/runtime/justice-tools.ts tests/core/v2/rule-evaluation-engine.test.ts tests/core/v2/gate-yaml-parser.test.ts tests/core/v2/gate-definition.test.ts tests/core/v2/default-gates.test.ts tests/core/acceptance-decision.test.ts tests/core/v2/state-projection.test.ts tests/core/v2/persistence-redaction.test.ts tests/runtime/validation.test.ts tests/runtime/gate-loader.test.ts tests/runtime/gate-yaml-injection.test.ts tests/hooks/observation-handler-gate.test.ts tests/core/rule-engine-determinism.test.ts tests/core/evidence-provenance.test.ts tests/core/v2/gate-provenance-gating.test.ts tests/runtime/justice-gate-tool.test.ts tests/core/observation-log-replay.test.ts tests/core/record-reference-resolution.test.ts tests/runtime/observation-log-integrity.test.ts tests/hooks/observation-handler-tool.test.ts tests/hooks/observation-handler-workflow-bootstrap.test.ts
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

**Requirement:** JUS-P0-02, JUS-P0-04, INV-11, INV-16, INV-17, INV-19, INV-20, INV-21, Design §4.8, §4.8.1, §4.8.2, and §4.10.

**Files:**

- Create: `src/core/review-dispatch-state.ts`
- Create: `src/core/review-artifact-reservation.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/runtime/node-file-system.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/review-dispatch-state.test.ts`
- Test: `tests/core/review-artifact-reservation.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`
- Test: `tests/hooks/plan-bridge-authorization.test.ts`
- Test: `tests/hooks/plan-bridge.test.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`
- Test: `tests/runtime/node-file-system.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

**Consumes:** current `TaskExecutionRef` or finalization identity; `ReviewCorrelation`; `ProjectedLifecycle` and `project(records, rebuiltAt).lifecycle` from Task 3.1; `findCurrentGateDecision` and `findCurrentAcceptanceDecision` from Task 3.2; active `ApprovedPlanBinding` snapshots for current authorization membership and Final Review `planFingerprint`; review
`TaskCallPurpose`; durable `PersistedLogRecord` read/append and projection; the injected
`ReviewArtifactReservationPort.createExclusiveMarker`; safe-relative-path validation;
`AuthorizationStore.findByAuthorizationId`.
All log, Authorization, filesystem, directive, and advisory operations are injected ports assembled by
the hook/runtime layer. `src/core/review-dispatch-state.ts` contains no runtime singleton import or direct
filesystem access; its append ports receive a `Pick<PersistedEnvelope, "agentId" | "sessionId" | "writerId">`
from the observed event or the durable source record.

**Produces:** `ReviewRequiredDirective`; durable `null -> pending` and `pending -> claimed` records;
`TaskCallBinding`; Design §4.10 `ReviewArtifactReservation`; `claimReviewDispatch(input):
Promise<ClaimReviewDispatchOutcome>`; `projectReviewDispatchSlots(records)`; `projectTaskCallBindings(records)`;
and an in-memory cache
reconstructed only from the durable projection. `ClaimReviewDispatchOutcome` is either `{ readonly kind:
"claimed"; readonly taskCallBinding: TaskCallBinding }`, `{ readonly kind: "claimed_unusable";
readonly taskCallBinding: Extract<TaskCallBinding, { readonly purpose: "task_review" | "final_review" }>;
readonly artifactPathOmitted: true; readonly advisory: "artifact_reservation_unusable" }`, or `{ readonly kind:
"blocked"; readonly advisory: string }`.
`claimed_unusable` carries the trusted durable call binding while its `artifactReservation.status` is
`unusable`; the runtime continues the task fail-open with no artifact path and never treats that binding as
review completion authority. A `blocked` outcome exposes neither `callId` nor `artifactId` as authority.
`ReviewArtifactReservationPort.createExclusiveMarker(path)` returns `"created"` with a JSON-safe
`ReviewArtifactInodeIdentity` and private `leasePath`, or `"occupied"`. The runtime adapter implements
it with a unique same-directory temporary marker, the existing atomic `FileWriter.link` destination
operation, and a retained private hard-link lease to the created inode; it maps only `EEXIST` to
`"occupied"` and removes only collision markers best-effort. It must not use `fileExists` followed by
`writeFile`, follow a destination symlink, or fall back to non-exclusive overwrite. Missing or failed
exclusive-create, identity capture, or no-follow support returns an unusable reservation with
`artifact_storage_unavailable`.
`ReviewDispatchTransitionRecord` is `PersistedEnvelope` plus the dispatch fields, so every durable
transition also carries the observed `agentId` and `sessionId` used later to build Gate/Acceptance
decision envelopes. The common append helper supplies those envelope fields from the current runtime
observation or the durable recovery record; correlation and category remain selected from the durable
slot, never from worker text.
`ReviewDispatchSlot` is a projection and therefore also retains the source `agentId`, `sessionId`, and
`writerId` needed for cancellation append envelopes; those fields are not part of slot identity.
`PendingReviewDispatchTransitionRecord` and `ReviewDispatchTransitionRecord` are the exact Design §4.8.1
transition union intersected with `PendingEnvelope` and `PersistedEnvelope` respectively. The injected
`appendReviewDispatchTransition(input: PendingReviewDispatchTransitionRecord)` boundary is the only
function that appends a dispatch transition and returns either
`{ readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord }` or
`{ readonly kind: "failed" }`.
`createReviewDispatchState(dependencies)` returns the Review Dispatch operations used by the hook/runtime
layer; no module-level log, Authorization, filesystem, notifier, or directive singleton is permitted.
`withAuthorizationReviewBoundary<T>(parentSessionId: string, operation: () => Promise<T>): Promise<T>` is
the injected, parent-session keyed queue shared with Authorization, Gate, and artifact completion. The
internal `withReviewDispatchParentSessionClaim<T>(parentSessionId: string, operation: () => Promise<T>):
Promise<T>` wrapper delegates to that same boundary for Task 3.6; it is a Review Dispatch domain view, not
a second queue or generic lock API. The boundary remains held from the latest Authorization read through
the related durable append(s) and directive injection.
`terminalizeReviewFailure(claim: ClaimedReviewDispatch,
reason: "review_execution_failed" | "lost_conclusive"): Promise<ReviewFailureOutcome>` appends the terminal
record and delegates all next-dispatch work to `offerNextMandatoryReview`. The returned,
ReviewDispatch-specific `offerNextMandatoryReview(parentSessionId: string): Promise<ReviewOfferOutcome>` is
called only after a durable ReviewPending / FinalReviewPending lifecycle notification, a durable terminalization,
or startup recovery. Its returned internal
`offerNextMandatoryReviewWithinParentSessionClaim(parentSessionId: string): Promise<ReviewOfferOutcome>`
reprojects the durable lifecycle, snapshot, dispatch, and Authorization state and is the only function allowed
to append `null -> pending`. Its module-private `selectNextEligibleReviewCandidate(input)` and
`projectReviewCandidateParentSessionIds(records, authorizations)` implement only Design §4.8.1 candidate derivation and
deterministic order; `recordAdvisory("review_dispatch_integrity_violation")` records the fail-closed
corruption outcome. `projectCurrentFinalReviewCorrelation(records, lifecycle, authorizations)` is module-private and derives the
current final review round from `lifecycle.finalization?.finalReviewRound` first, then applies ordered
Review Dispatch records for the same finalization identity. It returns `undefined` unless that finalization
identity resolves to a durable active Authorization, so stale / terminal / uncertain Authorization can never
become a current Final Review candidate. Task 3.4 alone owns review-only Final Review retry projection and
stale old-round rejection. Use the shared identity helper from Task 3.2,
`sameReviewCorrelation(left: ReviewCorrelation, right: ReviewCorrelation): boolean`, for Task 3.6's durable
binding and staging checks; do not redeclare a correlation comparison here. Keep
`nextReviewRetryCorrelation(correlation: ReviewCorrelation)` module-private and
`recoverReviewDispatchesAfterRestart(): Promise<void>` operate only in the ReviewDispatch domain; no
generic scheduler, queue, recovery, transaction, lock, or CAS abstraction is added. The
Task 3.2's `isCurrentActiveAuthorization(correlation, findAuthorizationById): Promise<boolean>` and
`authorizationIdFor(correlation: ReviewCorrelation): string` are the shared authorization helpers, and
Task 3.2's `sameReviewCorrelation(left, right)` is the shared identity helper;
Task 3.4 receives `findAuthorizationById`, `readDurableAuthorizations`,
`hydrateAuthorizationsBeforeReviewRecovery`, `injectReviewRequiredDirective`, and `recordAdvisory` as
injected domain ports, and passes the authorization lookup port to the shared helper. The module-private
`readDurableAuthorizations` result is used only to reconstruct canonical-snapshot membership and Final Review
fingerprint; it never authorizes an append or directive by itself. Every such state change still calls the Task 3.2
guard immediately before it occurs. The module-private
`projectActiveAuthorizedOutstandingSlots(slots, parentSessionId, authorizations)` is the sole source for
outstanding cardinality and claim selection. It reprojects only same-parent `pending | claimed` slots whose
correlation resolves to a durable active Authorization; raw slot arrays and stale Authorization slots are never
counted or passed to the selector. `selectExactlyOnePendingSlotForParentAndCategory(slots, parentSessionId,
expectedCategory)` then selects one durable pending slot or returns `undefined`; `appendClaimedTransition({ pending, callId, reservation, envelope })`
delegates to `appendReviewDispatchTransition` and returns its committed-or-failed result. The returned, Review Dispatch-specific
`cancelReviewDispatchesForTerminalAuthorization(parentSessionId, authorizationId): Promise<void>` is the public
queue-acquiring wrapper for PlanBridge, fingerprint invalidation, and startup entry points. Its returned internal
`cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(parentSessionId, authorizationId):
Promise<void>` counterpart is returned for Task 3.6, never acquires the queue, and is callable only while the caller already owns that
parent-session critical section. It reads the latest durable projection, best-effort appends `cancelled` only for
the current pending or claimed slot of that authorization, and treats an existing terminal slot as a no-op. These
are the only cancellation helpers; callers must not choose lock behavior dynamically. The public wrapper is
called only by boundary-external startup entry points; PlanBridge's explicit cancel and fingerprint paths use
the corresponding Authorization and cancellation within-boundary helpers in their one outer operation.
Queue-owning claim, failure, retry, and recovery operations call the within-parent helper directly.

- [ ] **Step 1: Write the failing dispatch, claim, offer, and recovery tests**

The test setup constructs one `reviewDispatchState` with the existing injected ports and destructures
its returned operations (`claimReviewDispatch`, `offerNextMandatoryReview`, `terminalizeReviewFailure`,
the cancellation boundary, and restart recovery). Queue tests use the returned
`withReviewDispatchParentSessionClaim`; they do not access closure state.

```ts
it("releases and cancels in one parent-boundary operation", async () => {
  await bridge.handleImplementationArm("parent-1", cancelRequest);
  expect(trace).toEqual([
    "boundary-enter",
    "authorization-release-durable",
    "review-cancelled-tombstone-attempt",
    "active-plan-cache-update",
    "boundary-release",
  ]);
  expect(parentBoundary.nestedAcquiresFor("parent-1")).toBe(0);
  await expect(claimReviewDispatch(claimInput)).resolves.toMatchObject({ kind: "blocked" });
});

it("invalidates and cancels in one parent-boundary operation", async () => {
  await invalidatePlanFingerprint("parent-1", changedFingerprint);
  expect(trace).toEqual([
    "boundary-enter",
    "authorization-invalidation-durable",
    "review-cancelled-tombstone-attempt",
    "active-plan-cache-update",
    "boundary-release",
  ]);
  expect(parentBoundary.nestedAcquiresFor("parent-1")).toBe(0);
  expect(durableCancelledTombstones()).toHaveLength(1);
  expect(durablePositiveReviewProgress()).toEqual([]);
});

it("does not cancel or publish cache when the within-boundary parent is wrong", async () => {
  await runTerminalAuthorizationPath({
    parentSessionId: "parent-2",
    authorizationId: activeAuthorization.authorizationId,
    kind: "release",
  });

  expect(authorizationDurableMutations()).toHaveLength(0);
  expect(cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim).not.toHaveBeenCalled();
  expect(updateActivePlanCache).not.toHaveBeenCalled();
});

it("does not cancel or publish cache when the terminal authorization save fails", async () => {
  authorizationStore.releaseWithinAuthorizationReviewBoundary.mockResolvedValueOnce({ kind: "failed" });

  await bridge.handleImplementationArm("parent-1", cancelRequest);

  expect(cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim).not.toHaveBeenCalled();
  expect(updateActivePlanCache).not.toHaveBeenCalled();
  expect(durableCancelledTombstones()).toEqual([]);
});
```

Final Review fixtures must persist the current lifecycle's `finalReviewRound` as the source of the initial
candidate. The actual-rework fixture must persist a fresh `finalizationAttemptId` with `finalReviewRound + 1`,
and the review-only retry fixture must retain that attempt ID while advancing only the round. These fixtures are
defined before the tests and are reused by the restart cases.
The setup also defines `arrangeUndispatchedTaskLifecycleCandidate(parentSessionId): Promise<TaskReviewCorrelation>`
and `arrangeUndispatchedFinalLifecycleCandidate(parentSessionId): Promise<FinalReviewCorrelation>`; each writes
only its lifecycle `review_pending` record with the supplied parent session and leaves dispatch undispatched.

```ts
type ReviewPendingLifecycleFixture = {
  readonly parentSessionId: string;
  readonly appendCurrentLifecycle: () => Promise<void>;
};

function durableAcceptanceRecords(
  records: readonly PersistedLogRecord[],
): readonly PersistedLogRecord[] {
  return records.filter(
    (record) =>
      record.recordType === "decision" &&
      "kind" in record &&
      (record.kind === "task-acceptance" || record.kind === "plan-acceptance"),
  );
}

async function appendReviewPendingLifecycleFixture(
  candidate: ReviewPendingLifecycleFixture,
): Promise<void> {
  await candidate.appendCurrentLifecycle();
  await offerNextMandatoryReview(candidate.parentSessionId);
}

async function appendTerminalThenRunOfferFixture(
  terminal: PendingReviewDispatchTransitionRecord,
): Promise<ReviewOfferOutcome> {
  const appended = await appendReviewDispatchTransition(terminal);
  if (appended.kind !== "committed") throw new Error("fixture terminal append failed");
  return offerNextMandatoryReview(terminal.parentSessionId);
}

it("offers one pending slot and one directive after a durable lifecycle notification", async () => {
  await appendReviewPendingLifecycleFixture(firstReviewPending);
  await appendReviewPendingLifecycleFixture(firstReviewPending);
  expect(trace).toEqual(["commit-pending", "inject-review-directive"]);
  expect(durableTransitions(null, "pending", firstTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDirectives()).toEqual([
    { kind: "review_required", correlation: firstTaskReviewCorrelation },
  ]);
});

it("automatically offers an undispatched second candidate after a pending predecessor completes", async () => {
  await appendReviewPendingLifecycleFixture(firstReviewPending);
  await appendReviewPendingLifecycleFixture(secondReviewPending);
  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(0);

  await appendTerminalThenRunOfferFixture(firstCompletedTerminal);

  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDirectivesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("automatically offers an undispatched second candidate after a claimed predecessor completes", async () => {
  await appendReviewPendingLifecycleFixture(firstReviewPending);
  await claimReviewDispatch(reviewPreToolUseFor("call-a"));
  await appendReviewPendingLifecycleFixture(secondReviewPending);

  await appendTerminalThenRunOfferFixture(firstCompletedTerminal);

  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDirectivesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("keeps an undispatched candidate deferred across restart until its predecessor terminalizes", async () => {
  await arrangePendingOrClaimedFirstAndUndispatchedSecond();
  restartReviewDispatchRepository();
  await recoverReviewDispatchesAfterRestart();
  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(0);

  await appendTerminalThenRunOfferFixture(firstCompletedTerminal);
  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDirectivesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("rediscovers an undispatched candidate after a terminal-to-offer crash", async () => {
  await arrangeDurableFirstTerminalAndUndispatchedSecondAfterCrash();
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDirectivesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("restores the task review parent session from the lifecycle record after restart", async () => {
  const correlation = await arrangeUndispatchedTaskLifecycleCandidate("parent-task");
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(injectedReviewDirectivesFor(correlation)).toHaveLength(1);
});

it("restores the Final Review parent session from the lifecycle record after restart", async () => {
  const correlation = await arrangeUndispatchedFinalLifecycleCandidate("parent-final");
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(injectedReviewDirectivesFor(correlation)).toHaveLength(1);
});

it("uses durable queue order across terminalizations and restart", async () => {
  await arrangeThreeOrderedReviewPendingCandidates();
  await offerNextMandatoryReview("parent-1");
  await appendTerminalThenRunOfferFixture(firstCompletedTerminal);
  restartReviewDispatchRepository();
  await recoverReviewDispatchesAfterRestart();
  await appendTerminalThenRunOfferFixture(secondCompletedTerminal);

  expect(offeredCorrelations()).toEqual([
    firstTaskReviewCorrelation,
    secondTaskReviewCorrelation,
    thirdTaskReviewCorrelation,
  ]);
});

it("offers a retry candidate before an unrelated ReviewPending candidate", async () => {
  await arrangeRetryableTerminalAndUnrelatedReviewPending();
  await offerNextMandatoryReview("parent-1");
  expect(offeredCorrelations()).toEqual([nextReviewRetryCorrelation(firstClaim.correlation)]);
});

it("uses the candidate authorization binding snapshot instead of a global snapshot cache", async () => {
  await arrangeActiveAuthorization({
    authorizationId: "authorization-a",
    sessionId: "session-a",
    canonicalSnapshot: snapshotWithTaskIds(["task-a"]),
  });
  await arrangeActiveAuthorization({
    authorizationId: "authorization-b",
    sessionId: "session-b",
    canonicalSnapshot: snapshotWithTaskIds(["task-b"]),
  });
  setLegacyCurrentSnapshotForFixture(snapshotWithTaskIds(["task-a"]));
  await appendReviewPendingLifecycleFixture(
    taskReviewPendingFor("parent-b", "authorization-b", "task-b"),
  );

  await offerNextMandatoryReview("parent-b");

  expect(offeredCorrelations()).toEqual([
    expect.objectContaining({
      reviewKind: "task-review",
      taskExecutionRef: expect.objectContaining({
        authorizationId: "authorization-b",
        taskId: "task-b",
      }),
    }),
  ]);
  expect(legacyCurrentSnapshotWasRead()).toBe(false);
});

it("fails closed for corrupt multiple outstanding slots", async () => {
  await arrangeMultipleOutstandingSlotsForSameParent();
  await offerNextMandatoryReview("parent-1");
  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toMatchObject({
    kind: "blocked",
    advisory: "review_dispatch_integrity_violation",
  });
  expect(durableTransitions(null, "pending")).toHaveLength(0);
  expect(projectedArtifactReservations()).toHaveLength(0);
  expect(recordAdvisory).toHaveBeenCalled();
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it.each(["released", "invalidated", "missing", "uncertain"] as const)(
  "does not create or inject a review directive for a %s authorization",
  async (status) => {
    await appendReviewPendingLifecycleFixture(reviewPendingForAuthorization(status));
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
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
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
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
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

    expect(
      durableTransitions(null, "pending", nextReviewRetryCorrelation(currentClaim.correlation)),
    ).toHaveLength(0);
    expect(injectedReviewDirectives()).toEqual([]);
    expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
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

it("offers a fresh reapproval while the stale cancellation tombstone is still pending", async () => {
  await arrangeCurrentPendingReview(activeAuthorization);
  failNextCancellationTombstoneAppend();
  await bridge.handleImplementationArm("s1", cancelRequest);

  failNextCancellationTombstoneAppend();
  await arrangeFreshActiveAuthorizationForSameParent({
    authorizationId: "authorization-new",
    parentSessionId: "parent-1",
  });
  await appendReviewPendingLifecycleFixture(
    reviewPendingForAuthorization("authorization-new"),
  );

  await offerNextMandatoryReview("parent-1");

  expect(injectedReviewDirectivesFor(authorizationNewCorrelation)).toHaveLength(1);
  expect(stalePendingSlotFor(currentAuthorizationId)).toMatchObject({ state: "pending" });
  expect(
    projectReviewDispatchSlots(await readDurableRecords()).some(
      (slot) =>
        slot.key.parentSessionId === "parent-1" &&
        authorizationIdFor(slot.key.correlation) === currentAuthorizationId &&
        slot.state === "claimed",
    ),
  ).toBe(false);
});

it("cancels a claimed slot after restart when its authorization is terminal", async () => {
  await arrangeCurrentClaimedReview(activeAuthorization);
  releaseAuthorization(currentAuthorizationId);
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
  expect(injectedReviewDirectives()).toEqual([]);
  expect(durableTransitions("pending", "claimed")).toHaveLength(1);
});

it.each(["review_execution_failed", "lost_conclusive"] as const)(
  "lets terminal authorization cancellation win over a claimed %s handler",
  async (reason) => {
    await arrangeCurrentClaimedReview(activeAuthorization);
    releaseAuthorizationBeforeFailureAuthorizationCheck(currentAuthorizationId);

    await expect(terminalizeReviewFailure(currentClaim, reason)).resolves.toEqual({
      kind: "blocked",
    });

    expect(durableTerminals(reason)).toHaveLength(0);
    expect(
      durableTransitions(null, "pending", nextReviewRetryCorrelation(currentClaim.correlation)),
    ).toHaveLength(0);
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
  await expect(
    withReviewDispatchParentSessionClaim("parent-1", async () => "next"),
  ).resolves.toBe("next");
});

it("does not arbitrarily cancel one slot from corrupted multiple outstanding slots", async () => {
  await arrangeCorruptMultipleOutstandingSlotsForAuthorization(currentAuthorizationId);

  await cancelReviewDispatchesForTerminalAuthorization("parent-1", currentAuthorizationId);

  expect(recordAdvisory).toHaveBeenCalledWith("review_dispatch_integrity_violation");
  expect(durableTerminals("cancelled")).toHaveLength(0);
});

it("serializes external cancellation with a concurrent claim for the same parent session", async () => {
  await arrangeCurrentPendingReview(activeAuthorization);
  const cancellationEntered = deferred<void>();
  const releaseCancellation = deferred<void>();
  blockCancellationAppend(cancellationEntered, releaseCancellation);

  const cancellation = cancelReviewDispatchesForTerminalAuthorization(
    "parent-1",
    currentAuthorizationId,
  );
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
  await expect(
    withReviewDispatchParentSessionClaim("parent-1", async () => "after-queue"),
  ).resolves.toBe("after-queue");
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
  expect(
    cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim,
  ).not.toHaveBeenCalledWith(
    expect.anything(),
    authorizationIdFor(staleOrForgedTaskReviewCorrelation),
  );
});

it("reserves a safe unused artifact path", async () => {
  await expect(reserveReviewArtifact()).resolves.toMatchObject({
    status: "usable",
    artifactId: expect.any(String),
    artifactPath: expect.stringMatching(/^\.justice\/reviews\/.+\.json$/u),
    leasePath: expect.stringMatching(/^\.justice\/reviews\/\.leases\/.+\.lease$/u),
    artifactIdentity: { device: expect.any(String), inode: expect.any(String) },
  });
});

it("rejects artifact replacement before parsing and never unlinks the replacement", async () => {
  const reservation = await reserveReviewArtifact();
  replaceArtifactLeafWithDifferentInode(reservation);
  await expect(readReservedArtifact(reservation)).rejects.toMatchObject({
    reason: "artifact_read_failed",
  });
  await cleanupArtifact(reservation);
  expect(await artifactPathExists(replacementPath)).toBe(true);
  expect(recordAdvisory).toHaveBeenCalledWith("review_artifact_identity_mismatch");
});

it("accepts writes and reads only through the reserved no-follow inode", async () => {
  const reservation = await reserveReviewArtifact();
  await writeReservedArtifact(reservation, validReviewWorkerJson);
  await expect(readReservedArtifact(reservation)).resolves.toBe(validReviewWorkerJson);
});

it("retries a colliding artifact candidate with a fresh UUID and path", async () => {
  createExclusiveMarker.mockResolvedValueOnce("occupied").mockResolvedValueOnce("created");
  await expect(reserveReviewArtifact()).resolves.toMatchObject({ status: "usable" });
  expect(uuid).toHaveBeenCalledTimes(2);
  expect(recordAdvisory).toHaveBeenCalledWith("review_unexpected_existing_artifact");
});

it.each([
  ["exhausted collisions", setupEveryCandidateExists, "artifact_path_collision_exhausted"],
  ["storage I/O", setupMarkerCreationFailure, "artifact_storage_unavailable"],
  ["review-directory I/O", setupDirectoryCreationFailure, "artifact_storage_unavailable"],
  ["unsafe generated path", setupUnsafeRelativePath, "artifact_path_invalid"],
  ["unexpected generator failure", setupUuidFailure, "reservation_internal_error"],
] as const)("returns unusable reservation for %s", async (_name, setup, reason) => {
  setup();
  await expect(reserveReviewArtifact()).resolves.toEqual({ status: "unusable", reason });
});

it("terminalizes an unusable reservation without reading or exposing an artifact path", async () => {
  setupEveryCandidateExists();
  const result = await claimReviewDispatch(reviewPreToolUse);
  expect(result).toMatchObject({
    kind: "claimed_unusable",
    taskCallBinding: {
      callId: reviewPreToolUse.callId,
      artifactReservation: { status: "unusable" },
    },
    artifactPathOmitted: true,
    advisory: "artifact_reservation_unusable",
  });
  expect(durableTerminal()).toMatchObject({
    terminalReason: "artifact_reservation_unusable",
    callId: reviewPreToolUse.callId,
  });
  expect(projectedSlot().state).toBe("terminal");
  expect(projectedClaim().artifactReservation).toEqual({
    status: "unusable",
    reason: "artifact_path_collision_exhausted",
  });
  expect(workerInput).not.toContain(".justice/reviews/");
  expect(taskExecution).toHaveBeenCalledTimes(1);
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it("retries unusable-reservation terminalization after restart without redispatch", async () => {
  setupEveryCandidateExists();
  failNextUnusableReservationTerminalAppend();

  await claimReviewDispatch(reviewPreToolUse);
  expect(projectedSlot().state).toBe("claimed");

  restartReviewDispatchRepository();
  await recoverReviewDispatchesAfterRestart();

  expect(durableTerminal()).toMatchObject({
    terminalReason: "artifact_reservation_unusable",
  });
  expect(projectedSlot().state).toBe("terminal");
  expect(reissuedDirective).not.toHaveBeenCalled();
  expect(reserveReviewArtifact).toHaveBeenCalledTimes(1);
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
  const rejected = withReviewDispatchParentSessionClaim("parent-1", async () => {
    throw new Error("append failed");
  });
  const following = withReviewDispatchParentSessionClaim("parent-1", async () => "continued");

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
  expect(
    projectReviewDispatchSlots(await readDurableRecords()).currentTaskReviewCorrelation(),
  ).toEqual(retry.correlation);
  expect(
    projectReviewDispatchSlots(await readDurableRecords()).isCurrent(oldTaskReviewCorrelation),
  ).toBe(false);
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
  expect(
    projectReviewDispatchSlots(await readDurableRecords()).isCurrent(oldFinalReviewCorrelation),
  ).toBe(false);
});

it("uses the initial lifecycle finalReviewRound for the first Final Review dispatch", async () => {
  const initial = await arrangeInitialFinalizationLifecycle({ finalReviewRound: 1 });

  await offerNextMandatoryReview(initial.parentSessionId);

  expect(nextPendingCorrelation()).toMatchObject({
    reviewKind: "final-review",
    finalizationAttemptId: initial.finalizationAttemptId,
    finalReviewRound: 1,
  });
});

it("dispatches an actual final rework at the lifecycle finalReviewRound without resetting it", async () => {
  const rework = await arrangeCurrentFinalReworkLifecycle({
    finalizationAttemptId: "fresh-finalization-attempt",
    finalReviewRound: currentFinalClaim.correlation.finalReviewRound + 1,
  });

  await offerNextMandatoryReview(rework.parentSessionId);

  expect(nextPendingCorrelation()).toMatchObject({
    reviewKind: "final-review",
    finalizationAttemptId: rework.finalizationAttemptId,
    finalReviewRound: rework.finalReviewRound,
  });
  expect(nextPendingCorrelation()).not.toMatchObject({ finalReviewRound: 1 });
});

it("keeps a clean Final Review after actual rework on the lifecycle round through Final Gate", async () => {
  const rework = await arrangeCurrentFinalReworkLifecycle({
    finalizationAttemptId: "fresh-finalization-attempt",
    finalReviewRound: currentFinalClaim.correlation.finalReviewRound + 1,
  });
  await arrangeCleanFinalReviewFor(rework);

  await consumeReviewCompletion(currentFinalCompletionInput);

  expect(currentFinalReviewCorrelation()).toMatchObject({
    finalizationAttemptId: rework.finalizationAttemptId,
    finalReviewRound: rework.finalReviewRound,
  });
  expect(projectedFinalizationState()).toBe("final_gate_pending");
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
});

it("increments only the review round for a review-only retry after actual rework", async () => {
  const rework = await arrangeCurrentFinalReworkLifecycle({
    finalizationAttemptId: "fresh-finalization-attempt",
    finalReviewRound: currentFinalClaim.correlation.finalReviewRound + 1,
  });
  const retry = await terminalizeReviewFailure(
    await currentFinalClaimFor(rework),
    "review_execution_failed",
  );

  expect(retry).toMatchObject({
    kind: "retried",
    correlation: {
      finalizationAttemptId: rework.finalizationAttemptId,
      finalReviewRound: rework.finalReviewRound + 1,
    },
  });
});

it("reconstructs the actual-rework Final Review round from lifecycle state after restart", async () => {
  const rework = await arrangeCurrentFinalReworkLifecycle({
    finalizationAttemptId: "fresh-finalization-attempt",
    finalReviewRound: currentFinalClaim.correlation.finalReviewRound + 1,
  });
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(currentFinalReviewCorrelation()).toMatchObject({
    finalizationAttemptId: rework.finalizationAttemptId,
    finalReviewRound: rework.finalReviewRound,
  });
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
  await consumeReviewCompletion(oldFinalRoundCompletionInput);
  await evaluateGatePendingAttempt(oldFinalRoundGateContext);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(evaluate).not.toHaveBeenCalled();
  expect(currentFinalReviewCorrelation()).not.toEqual(oldFinalReviewCorrelation);
});

it("projects a review-only Final Review retry and rejects the old round", async () => {
  await arrangeCurrentFinalReviewFailureWithoutNextPending(
    currentFinalClaim,
    "review_execution_failed",
  );
  await offerNextMandatoryReview(currentFinalClaim.parentSessionId);
  const projected = project(await readDurableRecords(), now);

  expect(projected.lifecycle.finalization).toMatchObject({
    finalizationAttemptId: currentFinalClaim.correlation.finalizationAttemptId,
    finalReviewRound: currentFinalClaim.correlation.finalReviewRound + 1,
    state: "final_review_pending",
  });
  expect(
    findCurrentGateDecision(await readDurableRecords(), currentFinalClaim.correlation),
  ).toEqual({
    kind: "missing",
  });
});

it("keeps an uncertain recovered claim blocked without redispatch", async () => {
  await recoverClaimedWithoutTerminal(currentClaim);
  expect(reissuedDirective).not.toHaveBeenCalled();
  expect(nextPendingCorrelation).not.toHaveBeenCalled();
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/hooks/plan-bridge.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/node-file-system.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL at the offer assertions: the pre-change implementation has no durable candidate selector,
cannot rediscover an undispatched lifecycle candidate after restart, and does not establish
`terminal-committed -> next-pending-committed -> directive-injected` through the shared offer boundary. The
test setup defines its fixtures and calls only planned production signatures; the RED failure is an assertion
failure, not an unresolved symbol or argument-count/type error.

- [ ] **Step 3: Implement durable dispatch and claim**

Persist one `pending` slot per parent session before injecting its `ReviewRequiredDirective`. Inside
`createReviewDispatchState(dependencies)`, use the injected, domain-specific
`withAuthorizationReviewBoundary(parentSessionId, operation)` shared with Authorization, Gate, and artifact
completion. This is not a reusable lock or transaction framework. The boundary installs its own unresolved
tail before awaiting the predecessor, absorbs predecessor rejection for queue progression, and releases the
tail only after the complete operation settles; an older operation can therefore never delete a newer tail.

`offerNextMandatoryReviewWithinParentSessionClaim` is the single domain-specific offer boundary. Inside that
one parent-session critical section it reads the latest durable log, re-projects lifecycle, Approved Canonical
Snapshot membership, review slots, and Authorization. Classify same-parent `pending | claimed` slots whose
correlation resolves to terminal, missing, unreadable, conflict-diverted, or otherwise uncertain Authorization
as stale; exclude those slots from outstanding cardinality, but run the within-parent cancellation helper for
their `cancelled` tombstone convergence. A stale slot remains unclaimable even when its tombstone append fails.
Count only active-authorized same-parent `pending | claimed` slots: one active outstanding slot creates neither
another pending record nor a directive, while two or more active outstanding slots are an integrity violation:
record an advisory, create no pending / claim / reservation / directive, leave the lifecycle and dispatch state
blocked, and emit no AcceptanceDecision.
With zero active outstanding slots, enumerate only Design §4.8.1 eligible current task and final candidates, apply
its durable total order (retry source terminal first, then lifecycle projection order), check the selected
correlation's current Authorization, append exactly one `null -> pending`, and inject exactly one directive only
after that append succeeds. It never accepts a caller-provided correlation as selection authority.
An ordinary Final Review candidate copies `finalReviewRound` from the current finalization lifecycle, and its source
transition must match `authorizationId`, `planPath`, `finalizationAttemptId`, and that same round. Only
`nextReviewRetryCorrelation` advances the round without rotating `finalizationAttemptId`.

Task 3.1 calls the public offer boundary immediately after a durable current `review_pending` or
`final_review_pending` lifecycle transition; this is a lifecycle candidate notification, not a request to append
a supplied correlation. Task 3.4 failure terminalization and Task 3.6 normal terminalization call the same
boundary after their terminal record becomes durable. Startup invokes it only after Authorization hydration,
lifecycle / review projection, staged-completion recovery, and post-terminal outcome recovery. For claim,
classify stale slots before cardinality and select from active-authorized pending slots only. First reject a
same-parent projection containing multiple active outstanding slots, then select exactly one pending slot using
only the runtime-observed parent session and expected category. A stale pending slot is never claimable; its
cancellation tombstone is retried independently. Create the selected active slot's reservation and append one
claimed transition record containing its trusted correlation, `callId`, expected category, and reservation. The projection derives
the `TaskCallBinding` from that claimed record. Do not publish the binding, reservation, or worker-path
argument until that append succeeds. If the append fails, retain the pending slot, publish no binding or
reservation, emit a binding-failure advisory, and return `blocked`. The queue is process-local exclusion
only: restart always re-projects durable records, which remain the SSOT.

`offerNextMandatoryReview`, `claimReviewDispatch`, `terminalizeReviewFailure`, restart directive reissue, and
cancellation convergence each execute their durable Authorization recheck in the shared
`withAuthorizationReviewBoundary` parent-session critical section immediately before their state-changing
append or directive injection. A request
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
directory exists, and calls `ReviewArtifactReservationPort.createExclusiveMarker` before dispatch.
The port creates the destination atomically and reports `"occupied"` for an existing file or symlink;
there is no `fileExists` check-then-use window. A collision records
`review_unexpected_existing_artifact` and retries with a new UUID. All three collisions return
`{ status: "unusable", reason: "artifact_path_collision_exhausted" }`; marker or directory I/O failure
returns `artifact_storage_unavailable`; invalid paths return `artifact_path_invalid`; other generator
failures return `reservation_internal_error`. The claimed record retains either result. For a usable result,
retain `leasePath` and `artifactIdentity` in the trusted reservation, and add only `artifactPath` to the
worker input. The worker-facing write operation must open the existing artifact leaf with no-follow,
verify the same `artifactIdentity`, and reject rename/unlink/recreate writes. For an unusable result, omit the path, continue the runtime
`task()` call fail-open, and append an `artifact_reservation_unusable` terminal tombstone without creating
a ReviewArtifact, Gate, retry, or AcceptanceDecision. If that terminal append fails, retain the claimed
reservation and let restart recovery retry the same tombstone. Gate-phase blocked Acceptance is produced
only by Task 3.2 after a clean terminal review has created `gate_pending` / `final_gate_pending`;
unusable-reservation recovery, uncertain claimed recovery, failed terminalization staging,
terminal-authorization cancellation, and `review_incomplete` remain pre-Gate states with no
AcceptanceDecision. A terminal unusable reservation is authoritative only to suppress that same
correlation; the shared offer boundary may select another eligible candidate.
The hook treats `claimed_unusable` as the fail-open path: it continues the original review task with the
trusted binding identity but omits `artifactPath`, and it must not use that result to create a ReviewArtifact,
Gate, AcceptanceDecision, or retry.

The usable claim path is explicit and single-source: `claimReviewDispatch` returns the committed
`TaskCallBinding`; the task-payload hook receives that outcome, reads
`taskCallBinding.artifactReservation.artifactPath`, and passes that exact string to the worker payload.
The hook and adapter must not regenerate, normalize again, or select a different path after claim. Add
tests that assert the path in the directive, hook payload, and final adapter wire payload is byte-for-byte
equal to the committed `TaskCallBinding.artifactReservation.artifactPath`, and that an unusable claim
omits the field at every boundary.

The reservation and runtime filesystem tests must verify that the worker's existing-inode write is accepted,
while a deleted-and-recreated leaf, symlink replacement, or replacement with a different hard-linked inode is
rejected before artifact parsing. `NodeFileSystem` must expose the descriptor-relative/no-follow operation
needed by the injected reservation port; generic pathname `readFile` / `writeFile` is not sufficient for this
artifact path. Cleanup must refuse to unlink a replacement path, retain an advisory, and remove only the
private lease after the original inode has reached a durable terminal.

Do not create `DelegatedExecutionBinding` here: a child session has not yet been authoritatively observed.
Canonicalize `sp-review` and `sp-final-review` to `run_in_background = false` before the claim. The
canonical owner is `normalizeTaskToolInputWithCategory` in `src/hooks/plan-bridge.ts`: it calls the
generic `normalizeTaskToolInput` first and then overwrites `run_in_background` for exactly these two
categories. `TaskPackager.package` must also emit false for these categories, while
`OpenCodeAdapter.onToolExecuteBefore` repeats the same category-aware override after merging any
modified payload, making the final wire payload authoritative. `PlanBridgeCore.classifyAndBuildWorkerRequest`
and `injectReviewRequiredDirective` do not own execution mode and must not be used as the sole guard.
Add regression tests that pass explicit `runInBackground: true`, `run_in_background: true`, and a
directive-modified payload for both categories and expect false at the package, hook, and adapter boundaries;
non-review categories preserve their caller value. A terminal
slot is immutable. Retryable terminalization derives its next-round correlation only while constructing the
durable candidate projection; it never directly appends a retry pending slot. `offerNextMandatoryReview` then
resolves retry-versus-unrelated priority and may append the one selected pending slot after the terminal is
durable. A restart recovery first re-reads the durable log and projection, reissues existing active pending slots,
then runs the same offer boundary for every parent session with a lifecycle-derived candidate. It must not append
a second pending record or create a second claim. Recovered claimed slots wait for matching PostToolUse, and
uncertain claimed recovery does not redispatch.

Every directive creation or reissue, `claimReviewDispatch`, failure terminalization, and offer candidate selection
resolves the correlation's authorizationId and runs inside the shared
`AuthorizationReviewBoundary.withParentSession` for that parent session. It requires its
`AuthorizationStore` binding to be durably `active` immediately before the state-changing append or directive
injection, with the boundary held through that append / injection. Released, invalidated, missing, unreadable,
conflict-diverted, or otherwise uncertain Authorization returns a blocked / stale advisory, creates no failure
terminal, pending slot, claim binding, reservation, or directive, and invokes the within-parent cancellation
helper only for an already pending or claimed slot. A standalone recheck outside this boundary is not an
authorization for later progress. `recoverReviewDispatchesAfterRestart` must
hydrate Authorization before projecting review records; it must never decide retry eligibility from the review log
alone. For every retryable terminal and ordinary pending slot, recovery acquires the shared parent-session
boundary,
re-reads the latest durable Authorization inside that operation, and only then creates/reissues a pending
directive. The shared boundary serializes this domain-specific check with claim, failure terminalization,
retry-pending append, directive injection, and cancellation terminalization, so an operation that observes a newly
terminal Authorization cannot publish later review progress.

In this Task only, replace Task 2.3's release-after-return orchestration with one PlanBridge outer
`AuthorizationReviewBoundary` operation. For explicit cancel, it calls
`releaseWithinAuthorizationReviewBoundary(parentSessionId, authorizationId, at)`, then
`cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(parentSessionId, authorizationId)`,
then updates the active-plan cache before releasing the boundary. The fingerprint-invalidation path uses the
same order with `invalidateForFingerprintWithinAuthorizationReviewBoundary`. PlanBridge must not call public
`AuthorizationStore.release`, public fingerprint invalidation, or public
`cancelReviewDispatchesForTerminalAuthorization` while it owns this boundary. The release / invalidation is
never rolled back when the dependent tombstone append fails, but the boundary remains held until that attempt
and all cache updates finish. If the inner Authorization mutation is any non-saved result, PlanBridge returns
fail-closed without attempting cancellation and without publishing a terminal active-plan cache value.

```ts
await withAuthorizationReviewBoundary(parentSessionId, async () => {
  const result = await authorizationStore.releaseWithinAuthorizationReviewBoundary(
    parentSessionId,
    authorizationId,
    at,
  );
  if (result.kind !== "saved") {
    await recordAdvisory("authorization_terminal_mutation_not_saved");
    return;
  }
  await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
    parentSessionId,
    authorizationId,
  );
  updateActivePlanCache(parentSessionId, null);
});

await withAuthorizationReviewBoundary(parentSessionId, async () => {
  const result = await authorizationStore.invalidateForFingerprintWithinAuthorizationReviewBoundary(
    parentSessionId,
    authorizationId,
    currentFingerprint,
    at,
  );
  if (result.kind !== "saved") {
    await recordAdvisory("authorization_terminal_mutation_not_saved");
    return;
  }
  await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
    parentSessionId,
    authorizationId,
  );
  updateActivePlanCache(parentSessionId, null);
});
```
On recovery, the same helper rechecks durable Authorization and retries a missing `cancelled` tombstone without
reissuing or claiming the slot. The helper reads the latest projection under the shared parent-session boundary,
identifies only current slots whose correlation resolves to the supplied authorizationId, appends
`pending -> terminal(cancelled)` or `claimed -> terminal(cancelled)` only when still current, and treats an
existing terminal tombstone as a no-op. Task 3.6 wraps this returned cancellation boundary: after the cancellation
operation, it locates only a matching staged completion and calls `ensureConsumedReviewArtifactCleaned`; failed
tombstone append performs no cleanup, and restart retries tombstone convergence before cleanup. No generic cancellation,
transaction, or recovery framework is added.

The following module-private bodies are implemented inside the task-specific
`createReviewDispatchState(dependencies)` boundary. `readDurableRecords`, `readDurableAuthorizations`,
`findAuthorizationById`, `recordAdvisory`, appenders, directive injection, and cancellation helpers are
captured from its explicit dependency object; none is a module-level singleton. Import the shared
`authorizationIdFor`, `isCurrentActiveAuthorization`, and `sameReviewCorrelation` helpers from Task 3.2,
passing `findAuthorizationById` to every authorization check. Import and use the same injected
`withAuthorizationReviewBoundary`; `serializeParentSessionClaim` is only a compatibility-shaped local alias
for that shared dependency and never allocates a second queue.

```ts
type ClaimedReviewDispatch = {
  readonly parentSessionId: string;
  readonly correlation: ReviewCorrelation;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly callId: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
};

type ClaimInput = {
  readonly parentSessionId: string;
  readonly callId: string;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly correlation?: unknown;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
};

type ReviewDispatchSlot = {
  readonly key: ReviewDispatchSlotKey;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly state: "pending" | "claimed" | "terminal";
  readonly callId?: string;
  readonly artifactReservation?: ReviewArtifactReservation;
  // The last durable transition envelope supplies cancellation/reissue provenance.
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
};

type ReviewDispatchEnvelope = Pick<PersistedEnvelope, "agentId" | "sessionId" | "writerId">;

function envelopeFromRecord(record: PersistedLogRecord): ReviewDispatchEnvelope {
  return { agentId: record.agentId, sessionId: record.sessionId, writerId: record.writerId };
}

function envelopeFromSlot(slot: ReviewDispatchSlot): ReviewDispatchEnvelope {
  return { agentId: slot.agentId, sessionId: slot.sessionId, writerId: slot.writerId };
}

type ReviewCandidateKind = "retry" | "task-review" | "final-review";

type ReviewCandidate = {
  readonly parentSessionId: string;
  readonly correlation: ReviewCorrelation;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly orderingSource: PersistedLogRecord;
  readonly kind: ReviewCandidateKind;
};

type SelectNextEligibleReviewCandidateInput = {
  readonly parentSessionId: string;
  readonly records: readonly PersistedLogRecord[];
  readonly lifecycle: ProjectedLifecycle;
  readonly slots: readonly ReviewDispatchSlot[];
  readonly authorizations: readonly ApprovedPlanBinding[];
};

`authorizationIdFor(correlation)` returns the authorization ID from the task execution reference or
finalization correlation. `isCurrentActiveAuthorization(correlation, findAuthorizationById)` reads only the injected authoritative
Authorization port, requires `status === "active"`, and for final review also requires the correlation's
plan path and fingerprint to match the binding. Read failures return `false` and never consult the
conflict journal.

function candidateAuthorizationId(candidate: ReviewCandidate): string {
  return authorizationIdFor(candidate.correlation);
}

function activeBindingMatchesReviewCorrelation(
  binding: ApprovedPlanBinding,
  correlation: ReviewCorrelation,
): boolean {
  if (binding.status !== "active") return false;
  if (correlation.reviewKind === "task-review") {
    return binding.canonicalSnapshot.tasks.some(
      (task) => task.taskId === correlation.taskExecutionRef.taskId,
    );
  }
  return (
    binding.planPath === correlation.planPath &&
    binding.planFingerprint.algorithm === correlation.planFingerprint.algorithm &&
    binding.planFingerprint.value === correlation.planFingerprint.value
  );
}

function findActiveCandidateAuthorization(
  candidate: ReviewCandidate,
  authorizations: readonly ApprovedPlanBinding[],
): ApprovedPlanBinding | undefined {
  const authorizationId = candidateAuthorizationId(candidate);
  return authorizations.find(
    (binding) =>
      binding.authorizationId === authorizationId &&
      activeBindingMatchesReviewCorrelation(binding, candidate.correlation),
  );
}

function hasDispatchSlotForCorrelation(
  slots: readonly ReviewDispatchSlot[],
  parentSessionId: string,
  correlation: ReviewCorrelation,
): boolean {
  return slots.some(
    (slot) =>
      slot.key.parentSessionId === parentSessionId &&
      sameReviewCorrelation(slot.key.correlation, correlation),
  );
}

function hasAuthoritativeTerminalForCorrelation(
  records: readonly PersistedLogRecord[],
  parentSessionId: string,
  correlation: ReviewCorrelation,
): boolean {
  return records.some(
    (record) =>
      record.kind === "review_dispatch_transition" &&
      record.parentSessionId === parentSessionId &&
      record.to === "terminal" &&
      sameReviewCorrelation(record.correlation, correlation) &&
      record.terminalReason !== "review_execution_failed" &&
      record.terminalReason !== "lost_conclusive",
  );
}

function isActiveAuthorizedReviewSlot(
  slot: ReviewDispatchSlot,
  authorizations: readonly ApprovedPlanBinding[],
): boolean {
  const authorizationId = authorizationIdFor(slot.key.correlation);
  return authorizations.some(
    (binding) =>
      binding.authorizationId === authorizationId &&
      activeBindingMatchesReviewCorrelation(binding, slot.key.correlation),
  );
}

function projectActiveAuthorizedOutstandingSlots(
  slots: readonly ReviewDispatchSlot[],
  parentSessionId: string,
  authorizations: readonly ApprovedPlanBinding[],
): readonly ReviewDispatchSlot[] {
  return slots.filter(
    (slot) =>
      slot.key.parentSessionId === parentSessionId &&
      (slot.state === "pending" || slot.state === "claimed") &&
      isActiveAuthorizedReviewSlot(slot, authorizations),
  );
}

async function convergeStaleReviewSlotsWithinParentSessionClaim(
  parentSessionId: string,
  slots: readonly ReviewDispatchSlot[],
  authorizations: readonly ApprovedPlanBinding[],
): Promise<void> {
  const staleAuthorizationIds = [
    ...new Set(
      slots
        .filter(
          (slot) =>
            slot.key.parentSessionId === parentSessionId &&
            (slot.state === "pending" || slot.state === "claimed") &&
            !isActiveAuthorizedReviewSlot(slot, authorizations),
        )
        .map((slot) => authorizationIdFor(slot.key.correlation)),
    ),
  ];
  for (const authorizationId of staleAuthorizationIds) {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      parentSessionId,
      authorizationId,
    );
  }
}

function reviewCorrelationMatchesCurrentLifecycle(
  correlation: ReviewCorrelation,
  lifecycle: ProjectedLifecycle,
  records: readonly PersistedLogRecord[],
  authorizations: readonly ApprovedPlanBinding[],
): boolean {
  if (correlation.reviewKind === "task-review") {
    const current = lifecycle.currentTaskExecutionRefs.get(correlation.taskExecutionRef.taskId);
    const binding = authorizations.find(
      (candidate) =>
        candidate.authorizationId === correlation.taskExecutionRef.authorizationId &&
        candidate.status === "active",
    );
    return (
      current !== undefined &&
      current.authorizationId === correlation.taskExecutionRef.authorizationId &&
      current.attemptId === correlation.taskExecutionRef.attemptId &&
      lifecycle.taskStates.get(correlation.taskExecutionRef.taskId) === "review_pending" &&
      binding !== undefined &&
      activeBindingMatchesReviewCorrelation(binding, correlation)
    );
  }
  const current = projectCurrentFinalReviewCorrelation(records, lifecycle, authorizations);
  return current !== undefined && sameReviewCorrelation(current, correlation);
}

function candidateMatchesCurrentLifecycle(
  candidate: ReviewCandidate,
  lifecycle: ProjectedLifecycle,
  records: readonly PersistedLogRecord[],
  authorizations: readonly ApprovedPlanBinding[],
): boolean {
  return reviewCorrelationMatchesCurrentLifecycle(candidate.correlation, lifecycle, records, authorizations);
}

function reviewCorrelationUsesAuthorizationSnapshot(
  correlation: ReviewCorrelation,
  binding: ApprovedPlanBinding,
): boolean {
  if (correlation.reviewKind !== "task-review") return true;
  return binding.canonicalSnapshot.tasks.some(
    (task) => task.taskId === correlation.taskExecutionRef.taskId,
  );
}

function candidateUsesAuthorizationSnapshot(
  candidate: ReviewCandidate,
  binding: ApprovedPlanBinding,
): boolean {
  return reviewCorrelationUsesAuthorizationSnapshot(candidate.correlation, binding);
}

function currentRetryCandidates(
  ordered: readonly PersistedLogRecord[],
  lifecycle: ProjectedLifecycle,
  authorizations: readonly ApprovedPlanBinding[],
): readonly ReviewCandidate[] {
  const candidates: ReviewCandidate[] = [];
  for (const record of ordered) {
    if (!isRetryableTerminalFailure(record)) continue;
    const correlation = nextReviewRetryCorrelation(record.correlation);
    const candidate: ReviewCandidate = {
      parentSessionId: record.parentSessionId,
      correlation,
      expectedCategory: correlation.reviewKind === "task-review" ? "sp-review" : "sp-final-review",
      orderingSource: record,
      kind: "retry",
    };
    const binding = findActiveCandidateAuthorization(candidate, authorizations);
    if (binding === undefined || !candidateUsesAuthorizationSnapshot(candidate, binding)) continue;
    const currentCorrelation =
      correlation.reviewKind === "task-review"
        ? projectCurrentTaskReviewCorrelation(
            ordered,
            lifecycle,
            correlation.taskExecutionRef.taskId,
          )
        : projectCurrentFinalReviewCorrelation(ordered, lifecycle, authorizations);
    if (
      currentCorrelation !== undefined &&
      sameReviewCorrelation(currentCorrelation, correlation) &&
      candidateMatchesCurrentLifecycle(candidate, lifecycle, ordered, authorizations)
    ) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function projectCurrentTaskReviewCorrelation(
  ordered: readonly PersistedLogRecord[],
  lifecycle: ProjectedLifecycle,
  taskId: string,
): TaskReviewCorrelation | undefined {
  const taskExecutionRef = lifecycle.currentTaskExecutionRefs.get(taskId);
  if (
    taskExecutionRef === undefined ||
    lifecycle.taskStates.get(taskId) !== "review_pending"
  ) {
    return undefined;
  }
  let reviewRound = 1;
  for (const record of ordered) {
    if (
      record.kind !== "review_dispatch_transition" ||
      record.correlation.reviewKind !== "task-review" ||
      record.correlation.taskExecutionRef.authorizationId !== taskExecutionRef.authorizationId ||
      record.correlation.taskExecutionRef.taskId !== taskExecutionRef.taskId ||
      record.correlation.taskExecutionRef.attemptId !== taskExecutionRef.attemptId
    ) {
      continue;
    }
    reviewRound = Math.max(
      reviewRound,
      record.correlation.reviewRound + (isRetryableTerminalFailure(record) ? 1 : 0),
    );
  }
  return { reviewKind: "task-review", taskExecutionRef, reviewRound };
}

function currentOrdinaryCandidates(
  ordered: readonly PersistedLogRecord[],
  lifecycle: ProjectedLifecycle,
  authorizations: readonly ApprovedPlanBinding[],
): readonly ReviewCandidate[] {
  const candidates: ReviewCandidate[] = [];
  for (const record of ordered) {
    if (record.kind === "task_lifecycle_transition" && record.to === "review_pending") {
      const current = lifecycle.currentTaskExecutionRefs.get(record.taskExecutionRef.taskId);
      if (
        current !== undefined &&
        current.authorizationId === record.taskExecutionRef.authorizationId &&
        current.attemptId === record.taskExecutionRef.attemptId
      ) {
        const correlation = projectCurrentTaskReviewCorrelation(
          ordered,
          lifecycle,
          record.taskExecutionRef.taskId,
        );
        const binding = authorizations.find(
          (candidate) =>
            candidate.authorizationId === current.authorizationId && candidate.status === "active",
        );
        if (
          correlation !== undefined &&
          binding !== undefined &&
          reviewCorrelationUsesAuthorizationSnapshot(correlation, binding)
        ) {
          candidates.push({
            parentSessionId: record.parentSessionId,
            correlation,
            expectedCategory: "sp-review",
            orderingSource: record,
            kind: "task-review",
          });
        }
      }
      continue;
    }
    if (record.kind === "plan_finalization_transition" && record.to === "final_review_pending") {
      const current = lifecycle.finalization;
      const binding = authorizations.find(
        (candidate) =>
          candidate.authorizationId === current?.authorizationId && candidate.status === "active",
      );
      if (
        current !== undefined &&
        binding !== undefined &&
        current.authorizationId === record.authorizationId &&
        current.planPath === record.planPath &&
        current.finalizationAttemptId === record.finalizationAttemptId &&
        current.finalReviewRound === record.finalReviewRound
      ) {
        const correlation = projectCurrentFinalReviewCorrelation(ordered, lifecycle, authorizations);
        if (correlation === undefined) continue;
        candidates.push({
          parentSessionId: record.parentSessionId,
          correlation,
          expectedCategory: "sp-final-review",
          orderingSource: record,
          kind: "final-review",
        });
      }
    }
  }
  return candidates;
}

function projectCurrentFinalReviewCorrelation(
  records: readonly PersistedLogRecord[],
  lifecycle: ProjectedLifecycle,
  authorizations: readonly ApprovedPlanBinding[],
): Extract<ReviewCorrelation, { readonly reviewKind: "final-review" }> | undefined {
  const current = lifecycle.finalization;
  if (current === undefined || current.state !== "final_review_pending") return undefined;
  const binding = authorizations.find(
    (candidate) => candidate.authorizationId === current.authorizationId && candidate.status === "active",
  );
  if (binding === undefined) return undefined;
  let correlation: Extract<ReviewCorrelation, { readonly reviewKind: "final-review" }> = {
    reviewKind: "final-review",
    planPath: current.planPath,
    authorizationId: current.authorizationId,
    planFingerprint: binding.planFingerprint,
    finalizationAttemptId: current.finalizationAttemptId,
    finalReviewRound: current.finalReviewRound,
  };
  for (const record of orderEventsForProjection(records)) {
    if (record.kind !== "review_dispatch_transition" || record.correlation.reviewKind !== "final-review") {
      continue;
    }
    if (
      record.correlation.authorizationId !== current.authorizationId ||
      record.correlation.planPath !== current.planPath ||
      record.correlation.finalizationAttemptId !== current.finalizationAttemptId
    ) {
      continue;
    }
    if (isRetryableTerminalFailure(record)) {
      correlation = nextReviewRetryCorrelation(record.correlation);
      continue;
    }
    if (record.correlation.finalReviewRound >= correlation.finalReviewRound) {
      correlation = record.correlation;
    }
  }
  return correlation;
}

function selectNextEligibleReviewCandidate(
  input: SelectNextEligibleReviewCandidateInput,
): ReviewCandidate | undefined {
  const ordered = orderEventsForProjection(input.records);
  const candidates = [
    ...currentRetryCandidates(ordered, input.lifecycle, input.authorizations),
    ...currentOrdinaryCandidates(ordered, input.lifecycle, input.authorizations),
  ];
  for (const candidate of candidates) {
    if (candidate.parentSessionId !== input.parentSessionId) continue;
    if (!candidateMatchesCurrentLifecycle(candidate, input.lifecycle, ordered, input.authorizations)) continue;
    if (candidate.correlation.reviewKind === "task-review") {
      const current = projectCurrentTaskReviewCorrelation(
        ordered,
        input.lifecycle,
        candidate.correlation.taskExecutionRef.taskId,
      );
      if (current === undefined || !sameReviewCorrelation(current, candidate.correlation)) continue;
    } else {
      const current = projectCurrentFinalReviewCorrelation(ordered, input.lifecycle, input.authorizations);
      if (current === undefined || !sameReviewCorrelation(current, candidate.correlation)) continue;
    }
    if (hasDispatchSlotForCorrelation(input.slots, candidate.parentSessionId, candidate.correlation)) continue;
    if (hasAuthoritativeTerminalForCorrelation(ordered, candidate.parentSessionId, candidate.correlation)) continue;
    const binding = findActiveCandidateAuthorization(candidate, input.authorizations);
    if (binding === undefined || !candidateUsesAuthorizationSnapshot(candidate, binding)) continue;
    return candidate;
  }
  return undefined;
}

function projectReviewCandidateParentSessionIds(
  records: readonly PersistedLogRecord[],
  authorizations: readonly ApprovedPlanBinding[],
): readonly string[] {
  const ordered = orderEventsForProjection(records);
  const lifecycle = project(ordered, new Date().toISOString()).lifecycle;
  const slots = projectReviewDispatchSlots(ordered);
  const parentSessionIds: string[] = [];
  for (const candidate of [
    ...currentRetryCandidates(ordered, lifecycle, authorizations),
    ...currentOrdinaryCandidates(ordered, lifecycle, authorizations),
  ]) {
    if (hasDispatchSlotForCorrelation(slots, candidate.parentSessionId, candidate.correlation)) continue;
    if (hasAuthoritativeTerminalForCorrelation(ordered, candidate.parentSessionId, candidate.correlation)) continue;
    if (!parentSessionIds.includes(candidate.parentSessionId)) parentSessionIds.push(candidate.parentSessionId);
  }
  return parentSessionIds;
}

type ReviewFailureOutcome =
  | { readonly kind: "retried"; readonly correlation: ReviewCorrelation }
  | { readonly kind: "blocked" };

type ClaimReviewDispatchOutcome =
  | { readonly kind: "claimed"; readonly taskCallBinding: TaskCallBinding }
  | {
      readonly kind: "claimed_unusable";
      readonly taskCallBinding: ReviewTaskCallBinding;
      readonly artifactPathOmitted: true;
      readonly advisory: "artifact_reservation_unusable";
    }
  | { readonly kind: "blocked"; readonly advisory: string };

type ReviewOfferOutcome =
  | { readonly kind: "offered"; readonly correlation: ReviewCorrelation }
  | { readonly kind: "deferred" | "blocked" | "none" };

type ReviewDispatchDependencies = {
  readonly readDurableRecords: () => Promise<readonly PersistedLogRecord[]>;
  readonly readDurableAuthorizations: () => Promise<readonly ApprovedPlanBinding[]>;
  readonly findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"];
  readonly appendReviewDispatchTransition: (
    input: PendingReviewDispatchTransitionRecord,
  ) => Promise<
    | { readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord }
    | { readonly kind: "failed" }
  >;
  readonly reserveReviewArtifact: () => Promise<ReviewArtifactReservation>;
  readonly injectReviewRequiredDirective: (input: {
    readonly kind: "review_required";
    readonly correlation: ReviewCorrelation;
  }) => Promise<void>;
  readonly withAuthorizationReviewBoundary: AuthorizationReviewBoundary["withParentSession"];
  readonly hydrateAuthorizationsBeforeReviewRecovery: () => Promise<void>;
  readonly recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>;
};

export function createReviewDispatchState(dependencies: ReviewDispatchDependencies) {
  const {
    readDurableRecords,
    readDurableAuthorizations,
    findAuthorizationById,
    appendReviewDispatchTransition,
    reserveReviewArtifact,
    injectReviewRequiredDirective,
    withAuthorizationReviewBoundary,
    hydrateAuthorizationsBeforeReviewRecovery,
    recordAdvisory,
  } = dependencies;

// This aliases the one shared Authorization/review domain boundary; it is not a second queue.
const serializeParentSessionClaim = withAuthorizationReviewBoundary;

function withReviewDispatchParentSessionClaim<T>(
  parentSessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withAuthorizationReviewBoundary(parentSessionId, operation);
}

async function offerNextMandatoryReview(parentSessionId: string): Promise<ReviewOfferOutcome> {
  return serializeParentSessionClaim(parentSessionId, () =>
    offerNextMandatoryReviewWithinParentSessionClaim(parentSessionId),
  );
}

async function offerNextMandatoryReviewWithinParentSessionClaim(
  parentSessionId: string,
): Promise<ReviewOfferOutcome> {
  const initialRecords = await readDurableRecords();
  const initialSlots = projectReviewDispatchSlots(initialRecords);
  const initialAuthorizations = await readDurableAuthorizations();
  await convergeStaleReviewSlotsWithinParentSessionClaim(
    parentSessionId,
    initialSlots,
    initialAuthorizations,
  );
  const records = await readDurableRecords();
  const slots = projectReviewDispatchSlots(records);
  const authorizations = await readDurableAuthorizations();
  const outstanding = projectActiveAuthorizedOutstandingSlots(slots, parentSessionId, authorizations);
  if (outstanding.length > 1) {
    await recordAdvisory("review_dispatch_integrity_violation");
    return { kind: "blocked" };
  }
  if (outstanding.length === 1) return { kind: "deferred" };

  const candidate = selectNextEligibleReviewCandidate({
    parentSessionId,
    records,
    lifecycle: project(records, new Date().toISOString()).lifecycle,
    slots,
    authorizations,
  });
  if (candidate === undefined) return { kind: "none" };
  if (!(await isCurrentActiveAuthorization(candidate.correlation, findAuthorizationById))) {
    return { kind: "blocked" };
  }

  const pending = await appendReviewDispatchTransition({
    ...envelopeFromRecord(candidate.orderingSource),
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: randomUUID(),
    parentSessionId,
    correlation: candidate.correlation,
    expectedCategory: candidate.expectedCategory,
    from: null,
    to: "pending",
  });
  if (pending.kind !== "committed") return { kind: "blocked" };
  if (!(await isCurrentActiveAuthorization(candidate.correlation, findAuthorizationById))) {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      parentSessionId,
      authorizationIdFor(candidate.correlation),
    );
    return { kind: "blocked" };
  }
  await injectReviewRequiredDirective({
    kind: "review_required",
    correlation: candidate.correlation,
  });
  return { kind: "offered", correlation: candidate.correlation };
}

async function claimReviewDispatch(input: ClaimInput): Promise<ClaimReviewDispatchOutcome> {
  return serializeParentSessionClaim(input.parentSessionId, async () => {
    const initialSlots = projectReviewDispatchSlots(await readDurableRecords());
    const initialAuthorizations = await readDurableAuthorizations();
    await convergeStaleReviewSlotsWithinParentSessionClaim(
      input.parentSessionId,
      initialSlots,
      initialAuthorizations,
    );
    const slots = projectReviewDispatchSlots(await readDurableRecords());
    const authorizations = await readDurableAuthorizations();
    const activeAuthorizedSlots = projectActiveAuthorizedOutstandingSlots(
      slots,
      input.parentSessionId,
      authorizations,
    );
    const outstanding = activeAuthorizedSlots;
    if (outstanding.length > 1) {
      await recordAdvisory("review_dispatch_integrity_violation");
      return { kind: "blocked", advisory: "review_dispatch_integrity_violation" };
    }
    const pending = selectExactlyOnePendingSlotForParentAndCategory(
      activeAuthorizedSlots,
      input.parentSessionId,
      input.expectedCategory,
    );
    if (pending === undefined) return { kind: "blocked", advisory: "review_claim_unavailable" };
    const correlation = pending.key.correlation;
    if (!(await isCurrentActiveAuthorization(correlation, findAuthorizationById))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        input.parentSessionId,
        authorizationIdFor(correlation),
      );
      return { kind: "blocked", advisory: "review_authorization_terminal" };
    }

    const reservation = await reserveReviewArtifact();
    if (!(await isCurrentActiveAuthorization(correlation, findAuthorizationById))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        input.parentSessionId,
        authorizationIdFor(correlation),
      );
      return { kind: "blocked", advisory: "review_authorization_terminal" };
    }
    const claimed = await appendClaimedTransition({
      pending,
      callId: input.callId,
      reservation,
      envelope: {
        agentId: input.agentId,
        sessionId: input.sessionId,
        writerId: input.writerId,
      },
    });
    if (claimed.kind !== "committed") return { kind: "blocked", advisory: "review_claim_commit_failed" };
    if (reservation.status === "unusable") {
      if (!(await isCurrentActiveAuthorization(correlation, findAuthorizationById))) {
        await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
          input.parentSessionId,
          authorizationIdFor(correlation),
        );
        return { kind: "blocked", advisory: "review_authorization_terminal" };
      }
      const claimedSlot = projectReviewDispatchSlots(await readDurableRecords()).find(
        (slot) =>
          slot.key.parentSessionId === input.parentSessionId &&
          sameReviewCorrelation(slot.key.correlation, correlation) &&
          slot.state === "claimed",
      );
      if (claimedSlot !== undefined) {
        const terminal = await appendUnusableReservationTerminal(claimedSlot);
        if (terminal?.kind === "committed") {
          await offerNextMandatoryReviewWithinParentSessionClaim(input.parentSessionId);
        } else {
          await recordAdvisory("review_artifact_reservation_terminal_append_failed");
        }
      }
      return {
        kind: "claimed_unusable",
        taskCallBinding: projectTaskCallBinding(claimed.record) as ReviewTaskCallBinding,
        artifactPathOmitted: true,
        advisory: "artifact_reservation_unusable",
      };
    }
    return { kind: "claimed", taskCallBinding: projectTaskCallBinding(claimed.record) };
  });
}

async function terminalizeReviewFailure(
  claim: ClaimedReviewDispatch,
  terminalReason: "review_execution_failed" | "lost_conclusive",
): Promise<ReviewFailureOutcome> {
  return serializeParentSessionClaim(claim.parentSessionId, async () => {
    if (!(await isCurrentActiveAuthorization(claim.correlation, findAuthorizationById))) {
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
      const offered = await offerNextMandatoryReviewWithinParentSessionClaim(claim.parentSessionId);
      return offered.kind === "offered" &&
        sameReviewCorrelation(offered.correlation, nextReviewRetryCorrelation(existing.correlation))
        ? { kind: "retried", correlation: offered.correlation }
        : { kind: "blocked" };
    }

    if (!(await isCurrentActiveAuthorization(claim.correlation, findAuthorizationById))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        claim.parentSessionId,
        authorizationIdFor(claim.correlation),
      );
      return { kind: "blocked" };
    }

    const terminal = await appendReviewDispatchTransition({
      agentId: claim.agentId,
      sessionId: claim.sessionId,
      writerId: claim.writerId,
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
    const offered = await offerNextMandatoryReviewWithinParentSessionClaim(claim.parentSessionId);
    return offered.kind === "offered" &&
      sameReviewCorrelation(
        offered.correlation,
        nextReviewRetryCorrelation(terminal.record.correlation),
      )
      ? { kind: "retried", correlation: offered.correlation }
      : { kind: "blocked" };
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
    (record.terminalReason === "review_execution_failed" ||
      record.terminalReason === "lost_conclusive")
  );
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
  const candidates = findCurrentPendingOrClaimedSlotsForAuthorization(
    projectReviewDispatchSlots(await readDurableRecords()),
    parentSessionId,
    authorizationId,
  );
  if (candidates.length === 0) return;
  if (candidates.length > 1) {
    await recordAdvisory("review_dispatch_integrity_violation");
    return;
  }
  const current = candidates[0];
  if (current === undefined) return;
  const terminal = await appendCancelledReviewDispatchTransition(current);
  if (terminal?.kind !== "committed") return;
}

async function appendCancelledReviewDispatchTransition(current: ReviewDispatchSlot) {
  if (current.state === "pending") {
    return appendReviewDispatchTransition({
      ...envelopeFromSlot(current),
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
  }
  if (current.state !== "claimed" || current.callId === undefined) return;
  return appendReviewDispatchTransition({
    ...envelopeFromSlot(current),
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

async function appendUnusableReservationTerminal(current: ReviewDispatchSlot) {
  if (
    current.state !== "claimed" ||
    current.callId === undefined ||
    current.artifactReservation?.status !== "unusable"
  ) {
    return undefined;
  }
  return appendReviewDispatchTransition({
    ...envelopeFromSlot(current),
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: randomUUID(),
    parentSessionId: current.key.parentSessionId,
    correlation: current.key.correlation,
    expectedCategory: current.expectedCategory,
    from: "claimed",
    to: "terminal",
    callId: current.callId,
    terminalReason: "artifact_reservation_unusable",
  });
}

async function reissuePendingReviewDirectiveAfterRestart(slot: ReviewDispatchSlot): Promise<void> {
  await serializeParentSessionClaim(slot.key.parentSessionId, async () => {
    const latestRecords = await readDurableRecords();
    const latestSlots = projectReviewDispatchSlots(latestRecords);
    const authorizations = await readDurableAuthorizations();
    await convergeStaleReviewSlotsWithinParentSessionClaim(
      slot.key.parentSessionId,
      latestSlots,
      authorizations,
    );
    const outstanding = projectActiveAuthorizedOutstandingSlots(
      latestSlots,
      slot.key.parentSessionId,
      authorizations,
    );
    if (outstanding.length > 1) {
      await recordAdvisory("review_dispatch_integrity_violation");
      return;
    }
    const latest = latestSlots.find(
      (candidate) =>
        candidate.key.parentSessionId === slot.key.parentSessionId &&
        sameReviewCorrelation(candidate.key.correlation, slot.key.correlation),
    );
    if (latest?.state !== "pending") return;
    const lifecycle = project(latestRecords, new Date().toISOString()).lifecycle;
    if (
      !reviewCorrelationMatchesCurrentLifecycle(
        latest.key.correlation,
        lifecycle,
        latestRecords,
        authorizations,
      )
    ) {
      return;
    }
    const authorization = authorizations.find(
      (binding) =>
        binding.authorizationId === authorizationIdFor(latest.key.correlation) &&
        binding.status === "active",
    );
    if (authorization === undefined) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        latest.key.parentSessionId,
        authorizationIdFor(latest.key.correlation),
      );
      return;
    }
    if (!reviewCorrelationUsesAuthorizationSnapshot(latest.key.correlation, authorization)) {
      await recordAdvisory("review_dispatch_integrity_violation");
      return;
    }
    if (!(await isCurrentActiveAuthorization(latest.key.correlation, findAuthorizationById))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        latest.key.parentSessionId,
        authorizationIdFor(latest.key.correlation),
      );
      return;
    }
    await injectReviewRequiredDirective({
      kind: "review_required",
      correlation: latest.key.correlation,
    });
  });
}

async function cancelTerminalClaimedReviewDispatchAfterRestart(
  slot: ReviewDispatchSlot,
): Promise<void> {
  await serializeParentSessionClaim(slot.key.parentSessionId, async () => {
    const latest = projectReviewDispatchSlots(await readDurableRecords()).find(
      (candidate) =>
        candidate.key.parentSessionId === slot.key.parentSessionId &&
        sameReviewCorrelation(candidate.key.correlation, slot.key.correlation),
    );
    if (latest?.state !== "claimed") return;
    if (await isCurrentActiveAuthorization(latest.key.correlation, findAuthorizationById)) return;
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      latest.key.parentSessionId,
      authorizationIdFor(latest.key.correlation),
    );
  });
}

async function terminalizeUnusableReviewDispatchAfterRestart(
  slot: ReviewDispatchSlot,
): Promise<void> {
  await serializeParentSessionClaim(slot.key.parentSessionId, async () => {
    const latest = projectReviewDispatchSlots(await readDurableRecords()).find(
      (candidate) =>
        candidate.key.parentSessionId === slot.key.parentSessionId &&
        sameReviewCorrelation(candidate.key.correlation, slot.key.correlation),
    );
    if (
      latest?.state !== "claimed" ||
      latest.artifactReservation?.status !== "unusable"
    ) {
      return;
    }
    if (!(await isCurrentActiveAuthorization(latest.key.correlation, findAuthorizationById))) {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        latest.key.parentSessionId,
        authorizationIdFor(latest.key.correlation),
      );
      return;
    }
    const terminal = await appendUnusableReservationTerminal(latest);
    if (terminal?.kind === "committed") {
      await offerNextMandatoryReviewWithinParentSessionClaim(latest.key.parentSessionId);
    } else {
      await recordAdvisory("review_artifact_reservation_terminal_append_failed");
    }
  });
}

async function recoverReviewDispatchesAfterRestart(): Promise<void> {
  try {
    await hydrateAuthorizationsBeforeReviewRecovery();
    const records = await readDurableRecords();
    const parentSessionIds = projectReviewCandidateParentSessionIds(
      records,
      await readDurableAuthorizations(),
    );
    const slots = projectReviewDispatchSlots(records);
    for (const slot of slots) {
      try {
        if (slot.state === "pending") {
          await reissuePendingReviewDirectiveAfterRestart(slot);
        } else if (slot.state === "claimed" && slot.artifactReservation?.status === "unusable") {
          await terminalizeUnusableReviewDispatchAfterRestart(slot);
        } else if (slot.state === "claimed") {
          await cancelTerminalClaimedReviewDispatchAfterRestart(slot);
        }
      } catch (error) {
        await recordAdvisory("review_dispatch_slot_recovery_failed", error);
      }
    }
    for (const parentSessionId of parentSessionIds) {
      try {
        await offerNextMandatoryReview(parentSessionId);
      } catch (error) {
        await recordAdvisory("review_dispatch_offer_recovery_failed", error);
      }
    }
  } catch (error) {
    await recordAdvisory("review_dispatch_recovery_failed", error);
  }
}

  return {
    claimReviewDispatch,
    offerNextMandatoryReview,
    offerNextMandatoryReviewWithinParentSessionClaim,
    withReviewDispatchParentSessionClaim,
    terminalizeReviewFailure,
    cancelReviewDispatchesForTerminalAuthorization,
    cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim,
    recoverReviewDispatchesAfterRestart,
  };
}
```

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/hooks/plan-bridge.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/node-file-system.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-dispatch-state.ts src/core/review-artifact-reservation.ts src/core/types.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/hooks/observation-handler.ts src/hooks/plan-bridge.ts src/runtime/opencode-adapter.ts src/runtime/node-file-system.ts src/core/justice-plugin.ts tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/hooks/plan-bridge.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/node-file-system.test.ts tests/core/justice-plugin-routing.test.ts
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
The adapter and observation handler provide the runtime event and append operations as injected
boundaries; core projection and binding logic must not import OpenCode runtime types or access the
filesystem directly.

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

Use only the event/API and field paths recorded by the successful Task 3.3 spike. The adapter converts that runtime relation into `DelegatedExecutionRelationObserved` and forwards it through the existing `JusticePlugin.handleEvent()` boundary. The observation handler accepts it only when `parentCallId` matches a current claimed slot, derives task or finalization `ExecutionScope` from that slot's trusted correlation, and appends `DelegatedExecutionBinding` durably. Reject unknown parent calls and stale child relations without state mutation. A matching review PostToolUse remains non-authoritative until this binding is present in the durable projection. Task 3.5 itself does not import Task 3.6. At the integrated observation-handler boundary added in Task 3.6, if PostToolUse arrived first, invoke `recoverPendingReviewCompletionsForBinding` only after the binding append commits; that operation acquires and holds the same per-parent boundary while replaying its durable `ReviewPostToolUsePendingRecord`. If replay fails, the marker remains for startup recovery. This boundary prevents binding append and completion replay from racing a later PostToolUse handler.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/v2/state-projection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/runtime/opencode-adapter.ts src/core/types.ts src/hooks/observation-handler.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/v2/state-projection.test.ts
git commit -m "feat: review child bindingをdurableに記録"
```

### Task 3.6: Consume a matching review artifact exactly once

**Requirement:** JUS-P0-02, JUS-P0-04, INV-06, INV-13, INV-15 through INV-21, Design §4.8.1, §4.8.2, §4.10, and §4.11.

**Files:**

- Create: `src/core/review-artifact.ts`
- Modify: `src/core/review-dispatch-state.ts`
- Modify: `src/core/session-state-provider.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/core/review-artifact.test.ts`
- Test: `tests/core/review-artifact-reservation.test.ts`
- Test: `tests/core/session-state-provider.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

**Consumes:** `ProjectedLifecycle` and `project(records, rebuiltAt).lifecycle` from Task 3.1; `findCurrentGateDecision` and
`findCurrentAcceptanceDecision` from Task 3.2; projected claimed dispatch slot; durable `TaskCallBinding`; durable
`DelegatedExecutionBinding`; Design §4.10 `ReviewArtifactReservation`; durable `AuthorizationStore`
`findByAuthorizationId`; internal `evaluateGatePendingAttemptWithinAuthorizationReviewBoundary` from Task 3.2;
`terminalizeReviewFailure`; the Task 3.4
imported `authorizationIdFor` and `isCurrentActiveAuthorization` helpers from Task 3.2; and the Task 3.4
returned boundaries `withReviewDispatchParentSessionClaim`,
`offerNextMandatoryReviewWithinParentSessionClaim`, and
`cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim`, plus the shared
`sameReviewCorrelation` identity helper and `ReviewPostToolUsePendingRecord` projection from the same
Review Dispatch domain.
All returned operations use the shared `withAuthorizationReviewBoundary` through the Task 3.4
parent-session boundary; no completion operation performs an Authorization check and later append
outside that boundary.
`consumeReviewCompletion`, staged-completion recovery, and post-terminal outcome recovery already own that
parent boundary. They must call only Task 3.2's within-boundary Gate capability, which retains
decision-identity serialization but never reacquires the parent boundary.
The completion consumer receives the normalized `PostToolUseEvent` plus its observed
`parentSessionId` / `callId`; it resolves the claimed slot, `TaskCallBinding`, and
`DelegatedExecutionBinding` from the durable projection rather than trusting correlation,
category, artifact path, or worker-provided metadata from the event.
Its input also carries the already-resolved `ObservationAgentId` and `writerId` used only for the
new persisted envelope; the correlation and artifact identity always come from the durable claimed
slot and binding.

**Produces:** `consumeReviewCompletion(input): Promise<ReviewCompletionOutcome>`;
`recoverPendingReviewCompletionsForBinding(parentSessionId: string, callId: string): Promise<void>`;
`recoverStagedReviewCompletion(staged: ReviewCompletionStagingRecord): Promise<ReviewCompletionOutcome>`;
`recoverStagedReviewCompletionsAfterRestart(): Promise<void>`;
`recoverInterruptedArtifactRead(staged: PersistedReviewArtifactReadAttemptRecord): Promise<ReviewCompletionOutcome>`;
`ensureTerminalReviewOutcomeApplied(terminal: ReviewDispatchTransitionRecord): Promise<ReviewCompletionOutcome>`;
`ensureConsumedReviewArtifactCleaned(staged: ReviewCompletionStagingRecord, terminal:
ReviewDispatchTransitionRecord): Promise<void>`;
`ensureFailedReviewArtifactCleaned(terminal: ReviewDispatchTransitionRecord): Promise<void>`;
`findMatchingTerminalForStaging(records: readonly PersistedLogRecord[], staged:
ReviewCompletionStagingRecord): ReviewDispatchTransitionRecord | undefined`;
`classifyReviewCompletion(result: ReviewWorkerResultV1): ReviewCompletionClassification`; one composite
terminal `ReviewDispatchTransitionRecord`; a projected `review_observed` semantic only for an assembled
artifact; and a gate-evaluation request only for a durable clean-artifact `gate_pending` /
`final_gate_pending` transition. `ReviewCompletionClassification` is a discriminated union for
`completed`, `completed_with_findings`, and `review_incomplete`, with the exact Design §4.8.1 artifact
subtype in each branch.
If artifact consumption cannot produce that shape, classify the exact Design §4.10
`ReviewArtifactFailureReason` (`artifact_missing`, `artifact_read_failed`, `artifact_json_invalid`, or
`artifact_schema_invalid`), append `ReviewArtifactFailureStagingRecord` first, and then append the
no-artifact failure terminal from that durable staging instead of constructing completion staging.
`readAndAssembleMatchingArtifact` returns the nested `ReviewCompletionStaging` payload after strict parse,
classification, digest calculation, and observed-execution construction, or returns the exact
`ReviewArtifactReadFailure` for missing, read-I/O, JSON-parse, or schema-validation failure. If the injected
reader unexpectedly throws instead of returning that union, `consumeReviewCompletionWithinParentSessionClaim`
records an advisory and converts the throw to `artifact_read_failed` through the already durable read-attempt
marker; the outer fail-open catch must not be the only handling path.
Before any filesystem read, append one `ReviewArtifactReadAttemptRecord`. If recovery finds that marker
without completion or failure staging, it must not reread the artifact; it stages `artifact_read_failed`
as an interrupted read and converges the no-artifact terminal. Thus a process crash cannot cause a second
read against a mutated path.
`ReviewCompletionStagingRecord` is the existing Design §4.8.1 nested `staging` shape carried in a
`PersistedEnvelope`; the common envelope supplies the observed `agentId`, `sessionId`, `writerId`,
and sequence without changing the nested staging contract. Terminal transition records, staged
completion records, artifact-read attempt records, artifact-failure staging records, and pending PostToolUse records therefore remain
replayable `PersistedLogRecord` variants and never become in-memory-only completion markers. In
`observation-model.ts`, define the pending staging variant as `PendingEnvelope & { readonly recordType:
"observation"; readonly kind: "review_completion_staged"; readonly parentSessionId: string; readonly
staging: ReviewCompletionStaging }`, the artifact-failure staging variant as `PendingEnvelope &
ReviewArtifactFailureStagingRecord`, and the pending PostToolUse variant as `PendingEnvelope &
ReviewPostToolUsePendingRecord`; define the read-attempt variant as `PendingEnvelope &
ReviewArtifactReadAttemptRecord`; include all corresponding persisted shapes in `PersistedLogRecord`.
`appendReviewCompletionStaging` accepts the pending staging shape, `appendReviewArtifactFailureStaging`
accepts the failure staging shape, and `appendReviewPostToolUsePending` accepts the pending PostToolUse shape, while
`appendCompositeTerminalRecord` accepts a pending terminal transition and delegates to the existing
`appendReviewDispatchTransition` physical append boundary, which is the only boundary that assigns the
persisted sequence. `readAndAssembleMatchingArtifact` returns the nested `ReviewCompletionStaging`
payload after strict parse, classification, digest calculation, and observed-execution construction.
`ReviewPostToolUsePendingRecord` also persists the observed child-session identity, task-review/final-review
purpose, trusted correlation, and `ObservedReviewExecutionV1`. Restart recovery must compare all of these
values with the current claimed slot and durable child binding before rereading an artifact or terminalizing;
any mismatch is rejected as stale/advisory.
All artifact reads, durable appends, Authorization lookups, cleanup, lifecycle transitions, and Gate
requests in this task are injected ports. The core module must not import `ObservationLogStore`,
`AuthorizationStore`, OpenCode adapter types, or notifier implementations directly. The injected
`cleanupArtifact(reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>)`
port receives the trusted reservation pair, not an artifact path or ID from PostToolUse or worker
output. `readAndAssembleMatchingArtifact` must call the reservation port's descriptor-relative,
no-follow read using the trusted `artifactPath`, `leasePath`, and `artifactIdentity`; it must not call
generic pathname `readFile` for a reserved artifact. A missing, replaced, symlinked, or identity-mismatched
leaf is an `artifact_read_failed` result before JSON parsing.

The module-private bodies in this task are implemented inside the task-specific
`createReviewCompletionDomain(dependencies)` boundary. Artifact readers, durable appenders, Authorization
lookups, lifecycle/Gate requests, cleanup, and advisory reporting are captured from explicit injected ports;
the code never reads a store singleton. Use Task 3.2's shared authorization helpers with the injected
`findAuthorizationById` port, and do not expose any Acceptance append helper to this task.

- [ ] **Step 1: Write the failing ordering, decision, and anti-replay tests**

The test setup constructs one `reviewCompletionDomain` with the existing artifact, log, lifecycle, Gate,
Authorization, advisory, and `reviewDispatchState` ports, then destructures the returned completion
operations. No completion test reads a store singleton or calls an unbound module-level consumer.
The fixture's deterministic parent-boundary probe records entered operations and rejects a second acquisition
for the active parent instead of relying on wall-clock timeouts. It covers live clean Task and Final Review
completion plus staged-restart Task and Final Review recovery: each resolves, records exactly one GateDecision
and exactly one AcceptanceDecision, and records zero nested parent-boundary acquisitions. A construction-level
integration fixture also drives Authorization, Review Dispatch, Review Completion, and Gate work for one
parent through the plugin wiring and proves max concurrent parent operations is one, establishing that all
domains received the one Task 2.2 boundary instance.

```ts
it.each(["task-review", "final-review"] as const)(
  "moves live clean %s completion to Gate without nested parent acquisition",
  async (reviewKind) => {
    await arrangeCleanClaimedReview(reviewKind);
    await consumeReviewCompletion(completionInputFor(reviewKind));
    expect(parentBoundary.nestedAcquiresFor("parent-1")).toBe(0);
    expect(durableGateDecisionsForCurrentIdentity(reviewKind)).toHaveLength(1);
    expect(durableAcceptanceDecisionsForCurrentIdentity(reviewKind)).toHaveLength(1);
  },
);

it.each(["task-review", "final-review"] as const)(
  "recovers staged clean %s completion to Gate without nested parent acquisition",
  async (reviewKind) => {
    await arrangeCleanTerminalOrGatePendingForRestart(reviewKind);
    await recoverStagedReviewCompletionsAfterRestart();
    expect(parentBoundary.nestedAcquiresFor("parent-1")).toBe(0);
    expect(durableGateDecisionsForCurrentIdentity(reviewKind)).toHaveLength(1);
    expect(durableAcceptanceDecisionsForCurrentIdentity(reviewKind)).toHaveLength(1);
  },
);

it("wires one shared boundary across Authorization, dispatch, completion, and Gate", async () => {
  await runCrossDomainSameParentOverlapFixture();
  expect(parentBoundary.maximumConcurrentOperationsFor("parent-1")).toBe(1);
  expect(parentBoundary.factoryCalls).toBe(1);
  expect(parentBoundary.nestedAcquiresFor("parent-1")).toBe(0);
});
```

All staging fixtures used by these tests, projection fixtures, and restart fixtures must construct the Design
§4.8.1 shape exactly: `kind: "review_completion_staged"`, top-level `parentSessionId`, and the nested
`staging: { callId, correlation, artifactConsumption, reviewArtifact, observedExecution }`. The final-review
round fixtures include initial lifecycle round 1, actual-rework lifecycle round `N + 1`, and review-only retry
round `N + 2` without rotating the finalization attempt. The named fixture helpers below are defined in the test
setup with these types so RED failures are assertion failures rather than unresolved symbols or shape errors.
Every completion fixture passed to `consumeReviewCompletion` is a `ReviewCompletionInput`; raw
`PostToolUseEvent` fixtures are wrapped with their trusted parent session, parent call ID, observed agent ID,
and writer ID before the call. In particular, define `currentFinalCompletionInput`,
`oldFinalRoundCompletionInput`, `oldAuthorizationACompletionInput`, and `oldRoundCompletionInput` rather
than passing the raw `*PostToolUse` event directly. Define `inputForArtifactFailure(reason)` fixtures for all
four Design `ReviewArtifactFailureReason` values and a terminal-append-failure fixture that keeps the durable
failure staging record available for restart recovery.

```ts
function durableAcceptanceRecords(
  records: readonly PersistedLogRecord[],
): readonly PersistedLogRecord[] {
  return records.filter(
    (record) =>
      record.recordType === "decision" &&
      "kind" in record &&
      (record.kind === "task-acceptance" || record.kind === "plan-acceptance"),
  );
}

it("performs the review completion protocol in durable order", async () => {
  await consumeReviewCompletion(matchingInput);
  expect(trace).toEqual([
    "verify-claimed-binding",
    "verify-child-binding",
    "append-read-attempt",
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

it("uses the production PostToolUse terminal path to offer one deferred candidate", async () => {
  await arrangeFirstClaimedReviewAndSecondUndispatchedReviewPending();

  await consumeReviewCompletion(firstMatchingInput);

  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDirectivesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("defers a matching review until its child binding is durable", async () => {
  await expect(consumeReviewCompletion(inputWithoutBinding)).resolves.toEqual({
    kind: "awaiting_child_binding",
  });
  expect(readArtifact).not.toHaveBeenCalled();
  expect(appendReviewPostToolUsePending).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "review_post_tooluse_pending",
      parentSessionId: inputWithoutBinding.parentSessionId,
      callId: inputWithoutBinding.callId,
    }),
  );
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it("replays a PostToolUse that arrived before child binding without rereading it", async () => {
  await expect(consumeReviewCompletion(inputWithoutBinding)).resolves.toEqual({
    kind: "awaiting_child_binding",
  });
  await bindObservedChild(currentClaim, childRelation);

  await recoverPendingReviewCompletionsForBinding(
    inputWithoutBinding.parentSessionId,
    inputWithoutBinding.callId,
  );

  expect(readArtifact).toHaveBeenCalledTimes(1);
  expect(durableTerminalRecords()).toHaveLength(1);
  expect(appendReviewPostToolUsePending).toHaveBeenCalledTimes(1);
});

it("rejects a PostToolUse when the durable review binding purpose mismatches its claimed slot", async () => {
  await arrangeClaimedSlotWithMismatchedReviewTaskCallPurpose();

  await expect(consumeReviewCompletion(matchingInput)).resolves.toEqual({ kind: "stale" });

  expect(readArtifact).not.toHaveBeenCalled();
  expect(appendReviewCompletionStaging).not.toHaveBeenCalled();
});

it("does not read or assemble an unusable reservation or create an AcceptanceDecision", async () => {
  await expect(consumeReviewCompletion(inputWithUnusableReservation)).resolves.toEqual({
    kind: "blocked",
  });
  expect(readArtifact).not.toHaveBeenCalled();
  expect(assembleReviewArtifact).not.toHaveBeenCalled();
  expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it.each([
  ["missing artifact", "artifact_missing"],
  ["artifact read failure", "artifact_read_failed"],
  ["invalid artifact JSON", "artifact_json_invalid"],
  ["artifact schema mismatch", "artifact_schema_invalid"],
] as const)("terminalizes %s without promoting an artifact", async (_name, terminalReason) => {
  await expect(consumeReviewCompletion(inputForArtifactFailure(terminalReason))).resolves.toEqual({
    kind: "blocked",
  });
  expect(durableTerminal()).toMatchObject({
    from: "claimed",
    to: "terminal",
    terminalReason,
  });
  expect(projectedSlot().state).toBe("terminal");
  expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
  expect(nextPendingCorrelation()).toBeUndefined();
});

it("retries a staged artifact failure terminal without rereading the artifact", async () => {
  await consumeReviewCompletion(inputForArtifactFailureWithTerminalAppendFailure("artifact_read_failed"));
  expect(projectedSlot().state).toBe("claimed");

  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(readArtifact).toHaveBeenCalledTimes(1);
  expect(durableTerminal()).toMatchObject({ terminalReason: "artifact_read_failed" });
  expect(projectedSlot().state).toBe("terminal");
  expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it("fails closed without rereading when a process stops after artifact read", async () => {
  await consumeReviewCompletion(inputWithCompletionStagingAppendFailure);
  expect(readArtifact).toHaveBeenCalledTimes(1);
  expect(projectedSlot().state).toBe("claimed");
  expect(durableReadAttempt()).toMatchObject({ kind: "review_artifact_read_started" });
  expect(durableArtifactFailureStaging()).toBeUndefined();

  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(readArtifact).toHaveBeenCalledTimes(1);
  expect(durableArtifactFailureStaging()).toMatchObject({
    terminalReason: "artifact_read_failed",
  });
  expect(durableTerminal()).toMatchObject({ terminalReason: "artifact_read_failed" });
});

it.each(["released", "invalidated"] as const)(
  "does not accept claimed review output or invoke Gate after authorization becomes %s",
  async (status) => {
    await arrangeCurrentClaimedReview(activeAuthorization);
    setAuthorizationStatus(currentAuthorizationId, status);
    await consumeReviewCompletion(matchingInput);
    expect(readArtifact).not.toHaveBeenCalled();
    expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
    expect(recordAcceptanceDecision).not.toHaveBeenCalled();
    expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
  },
);

it("recovers a staged terminalization after restart without rereading the artifact", async () => {
  await consumeReviewCompletion(inputWithTerminalCommitFailure);
  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(readArtifact).toHaveBeenCalledTimes(1);
  expect(appendCompositeTerminalRecord).toHaveBeenCalledTimes(2);
  expect(durableTerminalRecords()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
});

it("does not duplicate terminalization, Gate, or Acceptance during repeated staged recovery", async () => {
  await arrangeClaimedStagedCompletion(stagedRecord);
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(readArtifact).not.toHaveBeenCalled();
  expect(durableTerminalRecords()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it("retries cleanup after a crash following durable normal terminalization", async () => {
  await arrangeClaimedStagingWithMatchingCleanTerminalWithoutCleanup(stagedRecord);
  restartReviewCompletionRepository();

  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(readArtifact).not.toHaveBeenCalled();
  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
  expect(cleanupArtifact).toHaveBeenCalledTimes(2);
  expect(durableTerminalRecords()).toHaveLength(1);
});

it("retains terminal, Gate, and Acceptance authority when cleanup fails then retries on restart", async () => {
  failNextArtifactCleanup();
  await consumeReviewCompletion(matchingInput);
  expect(durableTerminalRecords()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);

  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(cleanupArtifact).toHaveBeenCalledTimes(2);
  expect(durableTerminalRecords()).toHaveLength(1);
});

it.each([
  mismatchedParentSessionTerminal,
  mismatchedCallIdTerminal,
  mismatchedCorrelationTerminal,
  mismatchedArtifactIdTerminal,
  mismatchedDigestTerminal,
  malformedPendingToTerminalWithArtifact,
])("does not match completion staging on a partial or invalid terminal identity", (terminal) => {
  expect(findMatchingTerminalForStaging([stagedRecord, terminal], stagedRecord)).toBeUndefined();
});

it("cleans a staged artifact only after the cancelled tombstone is durable", async () => {
  await arrangeClaimedStagedCompletion(stagedRecord);
  releaseAuthorization(stagedAuthorizationId);

  await consumeReviewCompletion(matchingInput);

  expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
  expect(cleanupArtifact).toHaveBeenCalledTimes(1);
});

it("does not clean when cancelled tombstone append fails and retries after restart", async () => {
  await arrangeClaimedStagedCompletion(stagedRecord);
  releaseAuthorization(stagedAuthorizationId);
  failNextCancellationTombstoneAppend();

  await consumeReviewCompletion(matchingInput);
  expect(cleanupArtifact).not.toHaveBeenCalled();

  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
  expect(cleanupArtifact).toHaveBeenCalledTimes(1);
});

it("keeps repeated cancelled recovery idempotent and blocked", async () => {
  await arrangeCancelledStagedCompletion(stagedRecord);
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(readArtifact).not.toHaveBeenCalled();
  expect(durableTerminals("cancelled")).toHaveLength(1);
  expect(cleanupArtifact).toHaveBeenCalledWith(
    expect.objectContaining({ artifactId: stagedRecord.staging.artifactConsumption.artifactId }),
  );
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it("retries cleanup after a durable cancelled terminal cleanup failure without rereading or reappending", async () => {
  await arrangeCancelledStagedCompletion(stagedRecord);
  failNextArtifactCleanup();

  await recoverStagedReviewCompletionsAfterRestart();
  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(readArtifact).not.toHaveBeenCalled();
  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
  expect(cleanupArtifact).toHaveBeenCalledTimes(2);
  expect(durableTerminals("cancelled")).toHaveLength(1);
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it("retains claimed plus staging and creates no AcceptanceDecision when terminal append keeps failing", async () => {
  await arrangeClaimedStagedCompletion(stagedRecord);
  failAllTerminalAppends();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(projectedSlot().state).toBe("claimed");
  expect(projectedCompletionStaging()).toEqual(stagedRecord);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(createReviewDispatch).not.toHaveBeenCalled();
  expect(createReviewArtifactReservation).not.toHaveBeenCalled();
  expect(nextPendingCorrelation).not.toHaveBeenCalled();
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it.each([
  mismatchedParentSessionStaging,
  mismatchedCallIdStaging,
  mismatchedCorrelationStaging,
  mismatchedArtifactStaging,
  mismatchedChildBindingStaging,
])("treats mismatched staged completion as stale without mutation", async (mismatchedStaging) => {
  await expect(recoverStagedReviewCompletion(mismatchedStaging)).resolves.toEqual({
    kind: "stale",
  });
  expect(readArtifact).not.toHaveBeenCalled();
  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
});

it("recovers a clean terminal after terminal append but before gate_pending without rereading its artifact", async () => {
  await arrangeClaimedStagingWithMatchingCleanTerminalWithoutLifecycle(stagedRecord);
  await recoverStagedReviewCompletion(stagedRecord);
  await recoverStagedReviewCompletion(stagedRecord);

  expect(readArtifact).not.toHaveBeenCalled();
  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
  expect(durableGatePendingTransitions()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it("resumes one missing Gate path after gate_pending was durable before a crash", async () => {
  await arrangeClaimedStagingWithMatchingCleanTerminalAndGatePending(stagedRecord);
  await recoverStagedReviewCompletion(stagedRecord);
  await recoverStagedReviewCompletion(stagedRecord);

  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
  expect(durableGatePendingTransitions()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it("recovers a Final Review clean terminal to final_gate_pending and one Final Gate", async () => {
  await arrangeFinalStagingWithMatchingCleanTerminalWithoutLifecycle(finalStagedRecord);
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
  expect(durableFinalGatePendingTransitions()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it("resumes one missing Final Gate path after final_gate_pending was durable before a crash", async () => {
  await arrangeFinalStagingWithMatchingCleanTerminalAndFinalGatePending(finalStagedRecord);
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
  expect(durableFinalGatePendingTransitions()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
});

it.each(["task-review", "final-review"] as const)(
  "recovers %s findings terminal to direct rework exactly once without Gate",
  async (reviewKind) => {
    await arrangeMatchingFindingsTerminalWithoutRework(reviewKind);
    await recoverStagedReviewCompletionsAfterRestart();
    await recoverStagedReviewCompletionsAfterRestart();

    expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
    expect(durableReworkTransitions(reviewKind)).toHaveLength(1);
    expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  },
);

it("keeps an existing incomplete terminal blocked without Gate, rework, or duplicate mutation", async () => {
  await arrangeMatchingIncompleteTerminal(stagedRecord);
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
  expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  expect(durableReworkTransitions()).toHaveLength(0);
  expect(
    findCurrentAcceptanceDecision(await readDurableRecords(), currentReviewCorrelation()),
  ).toEqual({ kind: "missing" });
});

it("retains a clean terminal but suppresses lifecycle, Gate, and Acceptance after authorization becomes terminal", async () => {
  await arrangeClaimedStagingWithMatchingCleanTerminalWithoutLifecycle(stagedRecord);
  releaseAuthorization(stagedAuthorizationId);
  await recoverStagedReviewCompletionsAfterRestart();

  expect(durableTerminalRecords()).toHaveLength(1);
  expect(durableGatePendingTransitions()).toHaveLength(0);
  expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
});

it.each(["released", "invalidated"] as const)(
  "does not promote a staged clean review after authorization becomes %s",
  async (status) => {
    await arrangeClaimedStagedCompletion(stagedRecord);
    setAuthorizationStatus(stagedAuthorizationId, status);
    await recoverStagedReviewCompletionsAfterRestart();
    expect(readArtifact).not.toHaveBeenCalled();
    expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
    expect(recordAcceptanceDecision).not.toHaveBeenCalled();
    expect(durableTerminal()).toMatchObject({ terminalReason: "cancelled" });
  },
);

it("does not let old authorization A affect fresh authorization B", async () => {
  await arrangeCancelledAuthorizationWithStagedReview("A");
  await approveFreshAuthorization("B");
  await consumeReviewCompletion(oldAuthorizationACompletionInput);
  await recoverStagedReviewCompletionsAfterRestart();
  const current = currentReviewCorrelation();
  if (current.reviewKind !== "task-review") throw new Error("expected task review");
  expect(current.taskExecutionRef.authorizationId).toBe("B");
  expect(readArtifact).not.toHaveBeenCalled();
  expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  expect(recordAcceptanceDecision).not.toHaveBeenCalled();
});

it("does not consume a duplicate matching PostToolUse twice", async () => {
  await consumeReviewCompletion(matchingInput);
  await consumeReviewCompletion(matchingInput);
  expect(readArtifact).toHaveBeenCalledTimes(1);
  expect(appendCompositeTerminalRecord).toHaveBeenCalledTimes(1);
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
  expect(evaluateGatePendingAttempt).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: "task",
      trigger: "task_complete",
      taskExecutionRef: currentTaskExecutionRef,
      agentId: expect.any(String),
      sessionId: expect.any(String),
    }),
  );
});

it("classifies findings as completed_with_findings and requires direct rework", async () => {
  await consumeReviewCompletion(inputFor({ complete: true, findings: [finding] }));
  expect(durableTerminal()).toMatchObject({ terminalReason: "completed_with_findings" });
  expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  expect(projectedTaskState()).toBe("rework_required");
});

it("classifies an incomplete artifact as review_incomplete and keeps the review blocked", async () => {
  await consumeReviewCompletion(inputFor({ complete: false, findings: [] }));
  expect(durableTerminal()).toMatchObject({ terminalReason: "review_incomplete" });
  expect(evaluateGatePendingAttempt).not.toHaveBeenCalled();
  expect(projectedTaskState()).toBe("review_pending");
  expect(
    findCurrentAcceptanceDecision(await readDurableRecords(), currentReviewCorrelation()),
  ).toEqual({ kind: "missing" });
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
  await consumeReviewCompletion(oldRoundCompletionInput);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(currentReviewCorrelation()).toMatchObject({ reviewRound: currentReviewRound + 1 });
});

it.each([
  ["reviewer execution failure", "review_execution_failed"],
  ["transport failure", "review_execution_failed"],
  ["conclusive loss", "lost_conclusive"],
] as const)("rejects stale Final Review and Final Gate records after %s", async (_name, reason) => {
  const retry = await terminalizeReviewFailure(currentFinalClaim, reason);
  await consumeReviewCompletion(oldFinalRoundCompletionInput);
  await evaluateGatePendingAttempt(oldFinalRoundGateContext);
  const replayedRecords = await readDurableRecords();
  const replayed = project(replayedRecords, now);

  expect(retry).toMatchObject({ kind: "retried" });
  if (retry.kind !== "retried" || retry.correlation.reviewKind !== "final-review") {
    throw new Error("expected final review retry");
  }
  expect(readArtifact).not.toHaveBeenCalled();
  expect(evaluate).not.toHaveBeenCalled();
  expect(replayed.lifecycle.finalization).toMatchObject({
    finalizationAttemptId: currentFinalClaim.correlation.finalizationAttemptId,
    finalReviewRound: retry.correlation.finalReviewRound,
    state: "final_review_pending",
  });
  expect(findCurrentAcceptanceDecision(replayedRecords, currentFinalClaim.correlation)).toEqual({
    kind: "missing",
  });
});
```

- [ ] **Step 2: Confirm RED**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/review-artifact-reservation.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL because matching review completion has no composite terminal physical record or ordered Gate request.

- [ ] **Step 3: Implement the fixed protocol**

Implement this exact staging-first sequence: validate claimed parent binding; check
`artifactReservation.status === "usable"`; validate durable child-session binding; append or reuse exactly
one `ReviewPostToolUsePendingRecord`; append exactly one `ReviewArtifactReadAttemptRecord` before any
artifact I/O; then read the usable artifact once. If the read, JSON parse, or strict
`ReviewWorkerResultV1` schema validation fails, classify the corresponding Design §4.10
`ReviewArtifactFailureReason`, append `ReviewArtifactFailureStagingRecord` first, and append exactly one
no-artifact failure terminal from that staging. If recovery finds a read-attempt marker without completion
or failure staging, do not reread the path; classify the interrupted read as `artifact_read_failed`, append
failure staging, and converge the no-artifact terminal. For a successful read, strictly parse
`ReviewWorkerResultV1`; classify it before lifecycle work; calculate digest; commit
`ReviewCompletionStagingRecord`; append exactly one composite terminal `ReviewDispatchTransitionRecord`
containing consumption, the classification-matched artifact subtype, and `claimed → terminal`; then
project the terminal result.

`createReviewCompletionDomain(dependencies)` returns `recoverStagedReviewCompletion` and
`ensureTerminalReviewOutcomeApplied` for focused tests; runtime wiring exposes only
`recoverStagedReviewCompletionsAfterRestart` for `JusticePlugin.initialize()`. The same domain returns
`findMatchingTerminalForStaging` and `ensureConsumedReviewArtifactCleaned` to its focused tests. Task 3.6
does not redeclare or mutate Task 3.4's cancellation helper: it invokes the returned helper while holding the
parent-session claim, then performs matching staged-artifact cleanup after a durable cancellation tombstone.
Task 3.4 has no import from Task 3.6 and remains independently GREEN. Task 3.6
consumes `projectTaskCallBindings` from Task 3.4, `projectDelegatedExecutionBindings` from Task 3.5, and
Task 3.2's `evaluateGatePendingAttemptWithinAuthorizationReviewBoundary`. Startup runs authorization hydration, durable record projection,
`recoverStagedReviewCompletionsAfterRestart`, then Task 3.4's `recoverReviewDispatchesAfterRestart` in that order.

After every successful composite terminal append, and whenever recovery finds that matching terminal, call
`ensureTerminalReviewOutcomeApplied`, then `ensureConsumedReviewArtifactCleaned(staging, terminal)`, then the
Task 3.4 `offerNextMandatoryReviewWithinParentSessionClaim(parentSessionId)` operation. These Task 3.6 paths
already hold the parent-session claim; they must use the within-parent operation and must not reacquire the
non-reentrant boundary. Public `offerNextMandatoryReview(parentSessionId)` is exclusively a boundary-external
Review Dispatch entry point. The cleanup helper is a small Review Dispatch
domain helper in `review-dispatch-state.ts`, not a generic cleanup framework. It reprojects the matching staging,
terminal consume marker, and reservation; it reads neither artifact content nor worker output. It performs
best-effort / idempotent cleanup only when `findMatchingTerminalForStaging` finds a durable `completed`,
`completed_with_findings`, `review_incomplete`, or matching staged `cancelled` terminal. Artifact read / validation
failure terminals are also cleanup-eligible through their trusted claimed reservation, without rereading artifact
content or worker output. Normal matching requires
`parentSessionId`, `staging.callId`, exact `staging.correlation`, and matching artifact ID / digest. Cancelled
matching requires `terminalReason: "cancelled"`, `parentSessionId`, `staging.callId`, exact `staging.correlation`,
and the durable claimed binding's artifact ID. Cleanup failure is reported as an advisory
but never rolls back terminal, lifecycle, Gate, or Acceptance authority. `ensureTerminalReviewOutcomeApplied`
re-reads the latest durable Authorization and
lifecycle projection, classifies the immutable terminal reason, and never appends the terminal record itself. It
first checks only current identity. For `completed`, `review_pending` / `final_review_pending` appends the matching
Gate-pending transition only when absent; `gate_pending` / `final_gate_pending` appends no lifecycle transition
and resumes only that current Gate path. If the current identity already has its GateDecision and Acceptance,
the operation is a no-op. For `completed_with_findings`, it appends direct `rework_required` /
`final_rework_required` only when absent, treats the same identity's already durable rework state as a no-op, and
never calls Gate. For `review_incomplete`, it does not append lifecycle, Gate, Acceptance, or retry records and
returns blocked. Terminal, missing, unreadable, conflict-diverted, or otherwise uncertain Authorization returns
blocked / stale, retains the immutable terminal record, and creates no positive lifecycle, Gate, Acceptance, or
Progress state. Repeated calls use the Task 3.1 current-lifecycle and Task 3.2 current-decision checks so lifecycle
transitions, GateDecision, and AcceptanceDecision are each authoritative at most once.
Task 3.4 terminalizes `review_execution_failed` and `lost_conclusive` before its shared offer boundary selects
any next-round pending slot; those failure branches never call this artifact-consumption path. For a final-review failure,
the next pending correlation retains `finalizationAttemptId`, increments `finalReviewRound`, and leaves
`final_review_pending` current; only actual final rework creates a fresh finalization identity. An `unusable` reservation
does no filesystem read, creates no `ReviewArtifactV1`, cannot terminalize as clean, and does not invoke Gate.
The claim path appends `artifact_reservation_unusable` as a terminal tombstone after the durable claim;
if that append fails, recovery retries it without redispatch, retry, or AcceptanceDecision while runtime task
execution remains fail-open.

For an artifact read / validation failure, the failure terminal carries only the trusted correlation, `callId`,
expected category, and exact `terminalReason`; it carries no `artifactConsumption`, `reviewArtifact`, or digest.
The corresponding task or final lifecycle remains `review_pending` / `final_review_pending` and blocked. Do not
invoke Gate, append Acceptance, advance `reviewRound`, create a retry candidate, or issue another directive for
that correlation. Append one `ReviewArtifactReadAttemptRecord` before the read and
`ReviewArtifactFailureStagingRecord` before the failure terminal. If either staging or terminal append fails,
retain the claimed slot and durable marker and retry the same staging / terminalization on recovery. A
read-attempt marker without a staging record is treated as an interrupted `artifact_read_failed` attempt;
recovery never rereads the artifact. After a durable failure terminal, never reread or reappend it. Cleanup
then uses the trusted claimed reservation only, is best-effort / idempotent, treats `artifact_missing` as a
no-op, and retries cleanup alone after a cleanup failure. A different eligible candidate may still be offered.

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
call Task 3.4's `cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim` for the current slot and return a blocked /
stale advisory. That cancellation path invokes `ensureConsumedReviewArtifactCleaned` only after a matching
`cancelled` tombstone is durably committed; a tombstone append failure leaves staging and artifact intact for
restart convergence. A cancel after staging therefore gives the terminal Authorization precedence: the staging
is not promoted, cannot be transferred to a fresh reapproval, and its artifact cleanup remains best-effort after
the cancelled terminal durable commit.

`recoverStagedReviewCompletionsAfterRestart` is a Task 3.6-specific recovery path, not a generic recovery
framework. It is wired from `JusticePlugin.initialize()` after authorization hydration and review projection,
and before Task 3.4's `recoverReviewDispatchesAfterRestart()`. The exact startup order is: (1) hydrate durable
Authorization bindings; (2) load and project durable observation records; (3) enumerate completion staging
records and call `recoverStagedReviewCompletion` for each; (4) enumerate `ReviewArtifactReadAttemptRecord`
records that have neither completion nor failure staging and call `recoverInterruptedArtifactRead` for each,
which appends `artifact_read_failed` failure staging without rereading; (5) enumerate artifact-failure staging
records and call `recoverStagedArtifactFailure` for each, retrying the exact no-artifact terminalization without
rereading; (6) enumerate `ReviewPostToolUsePendingRecord` records whose current claimed slot and durable child
binding now match, and call `recoverPendingReviewCompletionsForBinding` for each; (7) re-project after every
successful terminal append; (8) run `recoverReviewDispatchesAfterRestart` to reissue still-active pending slots and offer exactly one eligible
undispatched lifecycle candidate when no outstanding slot exists. Pending markers whose binding is still absent
remain durable and blocked. This ordering prevents `claimed + staging` from being mistaken for pending and
prevents a terminal Authorization from reissuing a directive.

For each staging record, `recoverStagedReviewCompletion` first reads durable records through the single
`findMatchingTerminalForStaging(records, staged)` domain helper. The helper matches a normal terminal by
`parentSessionId`, `staging.callId`, exact `staging.correlation`, and `staging.artifactConsumption` ID / digest;
it matches a claimed `cancelled` terminal by the same parent/call/correlation plus the durable claimed binding's
artifact ID. When that terminal exists, recovery reads neither the artifact nor worker output, does not require the slot to remain
`claimed`, does not append a terminal record, and calls `ensureTerminalReviewOutcomeApplied(existingTerminal)`,
`ensureConsumedReviewArtifactCleaned(staged, existingTerminal)`, and then
`offerNextMandatoryReviewWithinParentSessionClaim`.
When no matching terminal exists, it verifies that the parent session / callId / correlation slot remains current
`claimed`, that its `TaskCallBinding` and `DelegatedExecutionBinding` still match, and that the
`staged.staging.artifactConsumption` ID and digest match the staged composite payload. It then checks current active
Authorization and retries exactly the one composite terminal append using only `staged.staging.artifactConsumption`,
`staged.staging.reviewArtifact`, and `staged.staging.observedExecution`; it never reads the artifact path, fetches worker output,
creates a reservation or dispatch, or changes either review-round field. Only a successful terminal append calls
`ensureTerminalReviewOutcomeApplied`, `ensureConsumedReviewArtifactCleaned`, and
`offerNextMandatoryReviewWithinParentSessionClaim` for the same terminal. A failed append leaves the slot
`claimed` plus staging durable, with no AcceptanceDecision. A
mismatch is stale/advisory with no state mutation.

`consumeReviewCompletion` must first validate the PostToolUse parent/call identity against the
current claimed slot. A matching current event appends one idempotent
`ReviewPostToolUsePendingRecord` before artifact I/O. A current slot with no durable child binding then
returns `awaiting_child_binding` without reading the artifact; a stale parent/call/identity is stale with
no mutation. After the child binding is present, append one durable `ReviewArtifactReadAttemptRecord` and
read and validate the artifact once against that lease. If a read-attempt marker already exists, recovery
must not reread the path. For an artifact read / validation failure, it appends
`ReviewArtifactFailureStagingRecord` before the no-artifact failure terminal; a failed staging or terminal
append leaves the read-attempt marker and other durable state available for restart recovery. A marker with
no outcome staging is conservatively classified as interrupted `artifact_read_failed`, without another read.
The successful path appends completion staging before the composite terminal, and returns the downstream
outcome from `ensureTerminalReviewOutcomeApplied` rather than treating terminal append success alone as
completion.

```ts
type ReviewCompletionOutcome =
  | { readonly kind: "terminalized" }
  | { readonly kind: "awaiting_child_binding" }
  | { readonly kind: "blocked" }
  | { readonly kind: "stale" };

export type ReviewCompletionInput = {
  readonly parentSessionId: string;
  readonly callId: string;
  readonly postToolUse: Pick<PostToolUseEvent, "type" | "sessionId" | "callId">;
  readonly agentId: ObservationAgentId;
  readonly writerId: string;
};

type PersistedReviewPostToolUseRecord = PersistedEnvelope & ReviewPostToolUsePendingRecord;
type PersistedReviewArtifactReadAttemptRecord = PersistedEnvelope & ReviewArtifactReadAttemptRecord;
type PersistedReviewArtifactFailureStagingRecord = PersistedEnvelope & ReviewArtifactFailureStagingRecord;

type ReviewTaskCallBinding =
  | Extract<TaskCallBinding, { readonly purpose: "task_review" }>
  | Extract<TaskCallBinding, { readonly purpose: "final_review" }>;

type ClaimedReviewDispatchSlot = ReviewDispatchSlot & {
  readonly state: "claimed";
  readonly callId: string;
};

type PendingReviewDispatchTransitionRecord = Omit<ReviewDispatchTransitionRecord, "sequence">;

function isReviewTaskCallBinding(binding: TaskCallBinding): binding is ReviewTaskCallBinding {
  return binding.purpose === "task_review" || binding.purpose === "final_review";
}

function executionScopeMatchesCorrelation(
  scope: ExecutionScope,
  correlation: ReviewCorrelation,
): boolean {
  if (correlation.reviewKind === "task-review") {
    return (
      scope.kind === "task" &&
      scope.taskExecutionRef.authorizationId === correlation.taskExecutionRef.authorizationId &&
      scope.taskExecutionRef.taskId === correlation.taskExecutionRef.taskId &&
      scope.taskExecutionRef.attemptId === correlation.taskExecutionRef.attemptId
    );
  }
  return (
    scope.kind === "finalization" &&
    scope.authorizationId === correlation.authorizationId &&
    scope.planPath === correlation.planPath &&
    scope.finalizationAttemptId === correlation.finalizationAttemptId &&
    scope.finalReviewRound === correlation.finalReviewRound
  );
}

function delegatedBindingMatchesSlot(
  binding: DelegatedExecutionBinding,
  slot: ClaimedReviewDispatchSlot,
): boolean {
  return (
    binding.parentSessionId === slot.key.parentSessionId &&
    binding.parentCallId === slot.callId &&
    executionScopeMatchesCorrelation(binding.scope, slot.key.correlation)
  );
}

function reviewTaskCallBindingMatchesSlot(
  binding: ReviewTaskCallBinding,
  slot: ClaimedReviewDispatchSlot,
): boolean {
  return reviewTaskCallBindingMatchesCorrelation(binding, slot.callId, slot.key.correlation);
}

function reviewTaskCallBindingMatchesCorrelation(
  binding: ReviewTaskCallBinding,
  callId: string,
  correlation: ReviewCorrelation,
): boolean {
  const expectedPurpose = correlation.reviewKind === "task-review" ? "task_review" : "final_review";
  return (
    binding.callId === callId &&
    binding.purpose === expectedPurpose &&
    sameReviewCorrelation(binding.correlation, correlation)
  );
}

function matchesReviewPostToolUseIdentity(
  postToolUse: Pick<PostToolUseEvent, "type" | "sessionId" | "callId">,
  parentSessionId: string,
  callId: string,
  slot: ClaimedReviewDispatchSlot,
): boolean {
  return (
    postToolUse.type === "PostToolUse" &&
    slot.key.parentSessionId === parentSessionId &&
    slot.callId === callId &&
    postToolUse.callId === callId
  );
}

function matchesReviewPostToolUse(
  postToolUse: Pick<PostToolUseEvent, "type" | "sessionId" | "callId">,
  slot: ClaimedReviewDispatchSlot,
  taskCallBinding: ReviewTaskCallBinding,
  binding: DelegatedExecutionBinding,
): boolean {
  return (
    postToolUse.sessionId === binding.childSessionId &&
    reviewTaskCallBindingMatchesSlot(taskCallBinding, slot) &&
    delegatedBindingMatchesSlot(binding, slot)
  );
}

function isCleanReviewArtifact(artifact: ReviewArtifactV1): artifact is CleanReviewArtifactV1 {
  return artifact.complete && artifact.findings.length === 0;
}

function isReviewArtifactWithFindings(
  artifact: ReviewArtifactV1,
): artifact is ReviewArtifactWithFindingsV1 {
  return artifact.complete && artifact.findings.length > 0;
}

function isIncompleteReviewArtifact(
  artifact: ReviewArtifactV1,
): artifact is IncompleteReviewArtifactV1 {
  return !artifact.complete;
}

type PendingReviewCompletionStagingRecord = Omit<ReviewCompletionStagingRecord, "sequence">;
type PendingReviewArtifactReadAttemptRecord = PendingEnvelope & ReviewArtifactReadAttemptRecord;
type PendingReviewArtifactFailureStagingRecord = Omit<ReviewArtifactFailureStagingRecord, "sequence">;
type PendingReviewPostToolUseRecord = PendingEnvelope & ReviewPostToolUsePendingRecord;

type ReviewArtifactReadFailure = {
  readonly kind: "failure";
  readonly reason: ReviewArtifactFailureReason;
};

type ReviewCompletionDependencies = {
  readonly readDurableRecords: () => Promise<readonly PersistedLogRecord[]>;
  readonly findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"];
  readonly appendReviewCompletionStaging: (
    input: PendingReviewCompletionStagingRecord,
  ) => Promise<
    | { readonly kind: "committed"; readonly record: ReviewCompletionStagingRecord }
    | { readonly kind: "failed" }
  >;
  readonly appendReviewArtifactReadAttempt: (
    input: PendingReviewArtifactReadAttemptRecord,
  ) => Promise<
    | { readonly kind: "committed"; readonly record: PersistedReviewArtifactReadAttemptRecord }
    | { readonly kind: "failed" }
  >;
  readonly appendReviewArtifactFailureStaging: (
    input: PendingReviewArtifactFailureStagingRecord,
  ) => Promise<
    | { readonly kind: "committed"; readonly record: PersistedReviewArtifactFailureStagingRecord }
    | { readonly kind: "failed" }
  >;
  readonly appendReviewPostToolUsePending: (
    input: PendingReviewPostToolUseRecord,
  ) => Promise<{ readonly kind: "committed" } | { readonly kind: "failed" }>;
  readonly appendReviewDispatchTransition: ReviewDispatchDependencies["appendReviewDispatchTransition"];
  readonly readAndAssembleMatchingArtifact: (
    postToolUse: Pick<PostToolUseEvent, "type" | "sessionId" | "callId">,
    binding: ReviewTaskCallBinding,
    delegatedBinding: DelegatedExecutionBinding,
    correlation: ReviewCorrelation,
  ) => Promise<ReviewCompletionStaging | ReviewArtifactReadFailure>;
  readonly cleanupArtifact: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ) => Promise<void>;
  readonly evaluateGatePendingAttemptWithinAuthorizationReviewBoundary: ReturnType<
    typeof createGatePendingAttemptEvaluator
  >["evaluateGatePendingAttemptWithinAuthorizationReviewBoundary"];
  readonly appendTaskLifecycleTransition: GateEvaluationDependencies["appendTaskLifecycleTransition"];
  readonly appendPlanFinalizationTransition: GateEvaluationDependencies["appendPlanFinalizationTransition"];
  readonly recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>;
  readonly dispatch: Pick<
    ReturnType<typeof createReviewDispatchState>,
    | "withReviewDispatchParentSessionClaim"
    | "offerNextMandatoryReviewWithinParentSessionClaim"
    | "cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim"
  >;
};

export function createReviewCompletionDomain(dependencies: ReviewCompletionDependencies) {
  const {
    readDurableRecords,
    findAuthorizationById,
    appendReviewCompletionStaging,
    appendReviewArtifactReadAttempt,
    appendReviewArtifactFailureStaging,
    appendReviewPostToolUsePending,
    appendReviewDispatchTransition,
    readAndAssembleMatchingArtifact,
    cleanupArtifact,
    evaluateGatePendingAttemptWithinAuthorizationReviewBoundary,
    appendTaskLifecycleTransition,
    appendPlanFinalizationTransition,
    recordAdvisory,
  } = dependencies;
  const {
    withReviewDispatchParentSessionClaim,
    offerNextMandatoryReviewWithinParentSessionClaim,
    cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim,
  } = dependencies.dispatch;

function buildTerminalRecord(
  staged: ReviewCompletionStagingRecord,
  slot: ClaimedReviewDispatchSlot,
): PendingReviewDispatchTransitionRecord {
  const base = {
    schemaVersion: staged.schemaVersion,
    timestamp: new Date().toISOString(),
    agentId: staged.agentId,
    sessionId: staged.sessionId,
    writerId: staged.writerId,
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: randomUUID(),
    parentSessionId: staged.parentSessionId,
    correlation: staged.staging.correlation,
    expectedCategory: slot.expectedCategory,
    from: "claimed",
    to: "terminal",
    callId: staged.staging.callId,
    artifactConsumption: staged.staging.artifactConsumption,
  } as const;
  const artifact = staged.staging.reviewArtifact;
  if (isCleanReviewArtifact(artifact)) {
    return { ...base, terminalReason: "completed", reviewArtifact: artifact };
  }
  if (isReviewArtifactWithFindings(artifact)) {
    return { ...base, terminalReason: "completed_with_findings", reviewArtifact: artifact };
  }
  if (isIncompleteReviewArtifact(artifact)) {
    return { ...base, terminalReason: "review_incomplete", reviewArtifact: artifact };
  }
  throw new Error("review artifact classification invariant violated");
}

function buildArtifactFailureTerminal(
  input: {
    readonly agentId: ObservationAgentId;
    readonly sessionId: string;
    readonly writerId: string;
    readonly parentSessionId: string;
    readonly callId: string;
    readonly correlation: ReviewCorrelation;
    readonly expectedCategory: "sp-review" | "sp-final-review";
    readonly terminalReason: ReviewArtifactFailureReason;
  },
): PendingReviewDispatchTransitionRecord {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    agentId: input.agentId,
    sessionId: input.sessionId,
    writerId: input.writerId,
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: randomUUID(),
    parentSessionId: input.parentSessionId,
    correlation: input.correlation,
    expectedCategory: input.expectedCategory,
    from: "claimed",
    to: "terminal",
    callId: input.callId,
    terminalReason: input.terminalReason,
  };
}

async function appendArtifactFailureTerminal(
  input: Parameters<typeof buildArtifactFailureTerminal>[0],
): Promise<
  | { readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord }
  | { readonly kind: "failed" }
> {
  return appendReviewDispatchTransition(buildArtifactFailureTerminal(input));
}

async function appendCompositeTerminalRecord(
  pending: PendingReviewDispatchTransitionRecord,
): Promise<
  | { readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord }
  | { readonly kind: "failed" }
> {
  return appendReviewDispatchTransition(pending);
}

function isArtifactFailureTerminal(
  record: PersistedLogRecord,
): record is ReviewDispatchTransitionRecord & {
  readonly from: "claimed";
  readonly to: "terminal";
  readonly terminalReason: ReviewArtifactFailureReason;
} {
  return (
    record.kind === "review_dispatch_transition" &&
    record.from === "claimed" &&
    record.to === "terminal" &&
    [
      "artifact_missing",
      "artifact_read_failed",
      "artifact_json_invalid",
      "artifact_schema_invalid",
    ].includes(record.terminalReason)
  );
}

function findMatchingArtifactFailureTerminal(
  records: readonly PersistedLogRecord[],
  staged: PersistedReviewArtifactFailureStagingRecord,
): ReviewDispatchTransitionRecord | undefined {
  return records.find(
    (record): record is ReviewDispatchTransitionRecord =>
      record.kind === "review_dispatch_transition" &&
      record.from === "claimed" &&
      record.to === "terminal" &&
      (isArtifactFailureTerminal(record) || record.terminalReason === "cancelled") &&
      record.parentSessionId === staged.parentSessionId &&
      record.callId === staged.callId &&
      sameReviewCorrelation(record.correlation, staged.correlation),
  );
}

function findStagedCompletionForCall(
  records: readonly PersistedLogRecord[],
  parentSessionId: string,
  callId: string,
): ReviewCompletionStagingRecord | undefined {
  return records.find(
    (record): record is ReviewCompletionStagingRecord =>
      record.kind === "review_completion_staged" &&
      record.parentSessionId === parentSessionId &&
      record.staging.callId === callId,
  );
}

function findArtifactFailureStagingForCall(
  records: readonly PersistedLogRecord[],
  parentSessionId: string,
  callId: string,
): PersistedReviewArtifactFailureStagingRecord | undefined {
  return records.find(
    (record): record is PersistedReviewArtifactFailureStagingRecord =>
      record.kind === "review_artifact_failure_staged" &&
      record.parentSessionId === parentSessionId &&
      record.callId === callId,
  );
}

function findReviewArtifactReadAttemptForCall(
  records: readonly PersistedLogRecord[],
  parentSessionId: string,
  callId: string,
): PersistedReviewArtifactReadAttemptRecord | undefined {
  return records.find(
    (record): record is PersistedReviewArtifactReadAttemptRecord =>
      record.kind === "review_artifact_read_started" &&
      record.parentSessionId === parentSessionId &&
      record.callId === callId,
  );
}

async function stageArtifactFailureFromReadAttempt(
  readAttempt: PersistedReviewArtifactReadAttemptRecord,
  terminalReason: ReviewArtifactFailureReason,
): Promise<ReviewCompletionOutcome> {
  const existing = findArtifactFailureStagingForCall(
    await readDurableRecords(),
    readAttempt.parentSessionId,
    readAttempt.callId,
  );
  if (existing !== undefined) return recoverStagedArtifactFailure(existing);
  const failureStaging = await appendReviewArtifactFailureStaging({
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    agentId: readAttempt.agentId,
    sessionId: readAttempt.sessionId,
    writerId: readAttempt.writerId,
    recordType: "observation",
    kind: "review_artifact_failure_staged",
    parentSessionId: readAttempt.parentSessionId,
    callId: readAttempt.callId,
    correlation: readAttempt.correlation,
    terminalReason,
  });
  if (failureStaging.kind !== "committed") {
    await recordAdvisory("review_artifact_failure_staging_append_failed");
    return { kind: "blocked" };
  }
  return recoverStagedArtifactFailure(failureStaging.record);
}

function findPendingReviewPostToolUseForCall(
  records: readonly PersistedLogRecord[],
  parentSessionId: string,
  callId: string,
): (PersistedEnvelope & ReviewPostToolUsePendingRecord) | undefined {
  return records.find(
    (record): record is PersistedEnvelope & ReviewPostToolUsePendingRecord =>
      record.kind === "review_post_tooluse_pending" &&
      record.parentSessionId === parentSessionId &&
      record.callId === callId,
  );
}

async function recoverPendingReviewCompletionsForBinding(
  parentSessionId: string,
  callId: string,
): Promise<void> {
  try {
    await withReviewDispatchParentSessionClaim(parentSessionId, async () => {
      const records = await readDurableRecords();
      const marker = findPendingReviewPostToolUseForCall(records, parentSessionId, callId);
      if (marker === undefined) return;
      const slot = projectReviewDispatchSlots(records).find(
        (candidate): candidate is ClaimedReviewDispatchSlot =>
          candidate.key.parentSessionId === parentSessionId &&
          candidate.state === "claimed" &&
          candidate.callId === callId,
      );
      const delegatedBinding = projectDelegatedExecutionBindings(records).find(
        (candidate) =>
          slot !== undefined &&
          candidate.parentSessionId === parentSessionId &&
          candidate.parentCallId === callId &&
          delegatedBindingMatchesSlot(candidate, slot),
      );
      if (slot === undefined || delegatedBinding === undefined) return;
      if (marker.sessionId !== delegatedBinding.childSessionId) {
        await recordAdvisory("review_pending_completion_stale");
        return;
      }
      await consumeReviewCompletionWithinParentSessionClaim({
        parentSessionId: marker.parentSessionId,
        callId: marker.callId,
        postToolUse: {
          type: "PostToolUse",
          sessionId: marker.sessionId,
          callId: marker.callId,
        },
        agentId: marker.agentId,
        writerId: marker.writerId,
      });
    });
  } catch (error) {
    await recordAdvisory("review_pending_completion_recovery_failed", error);
  }
}

async function consumeReviewCompletion(
  input: ReviewCompletionInput,
): Promise<ReviewCompletionOutcome> {
  try {
    return await withReviewDispatchParentSessionClaim(input.parentSessionId, () =>
      consumeReviewCompletionWithinParentSessionClaim(input),
    );
  } catch (error) {
    await recordAdvisory("review_completion_failed", error);
    return { kind: "blocked" };
  }
}

async function consumeReviewCompletionWithinParentSessionClaim(
  input: ReviewCompletionInput,
): Promise<ReviewCompletionOutcome> {
  const records = await readDurableRecords();
      const existingStaging = findStagedCompletionForCall(
        records,
        input.parentSessionId,
        input.callId,
      );
      if (existingStaging !== undefined) {
        const stagedBinding = projectTaskCallBindings(records).find(
          (candidate): candidate is ReviewTaskCallBinding =>
            isReviewTaskCallBinding(candidate) &&
            reviewTaskCallBindingMatchesCorrelation(
              candidate,
              existingStaging.staging.callId,
              existingStaging.staging.correlation,
            ),
        );
        return input.postToolUse.callId === existingStaging.staging.callId &&
          input.postToolUse.sessionId ===
            existingStaging.staging.observedExecution.childSessionId &&
          stagedBinding !== undefined
          ? recoverStagedReviewCompletion(existingStaging)
          : { kind: "stale" };
      }
      const existingFailureStaging = findArtifactFailureStagingForCall(
        records,
        input.parentSessionId,
        input.callId,
      );
      if (existingFailureStaging !== undefined) {
        return input.postToolUse.callId === existingFailureStaging.callId &&
          input.postToolUse.sessionId === existingFailureStaging.sessionId
          ? recoverStagedArtifactFailure(existingFailureStaging)
          : { kind: "stale" };
      }
      const slot = projectReviewDispatchSlots(records).find(
        (candidate): candidate is ClaimedReviewDispatchSlot =>
          candidate.key.parentSessionId === input.parentSessionId &&
          candidate.state === "claimed" &&
          candidate.callId === input.callId,
      );
      const taskCallBinding = projectTaskCallBindings(records).find(
        (candidate): candidate is ReviewTaskCallBinding =>
          slot !== undefined &&
          isReviewTaskCallBinding(candidate) &&
          reviewTaskCallBindingMatchesSlot(candidate, slot),
      );
      const delegatedBinding = projectDelegatedExecutionBindings(records).find(
        (candidate) =>
          slot !== undefined &&
          candidate.parentSessionId === input.parentSessionId &&
          candidate.parentCallId === input.callId &&
          delegatedBindingMatchesSlot(candidate, slot),
      );
      if (slot === undefined || taskCallBinding === undefined) {
        return { kind: "stale" };
      }
      if (
        !matchesReviewPostToolUseIdentity(
          input.postToolUse,
          input.parentSessionId,
          input.callId,
          slot,
        )
      ) {
        return { kind: "stale" };
      }
      if (!(await isCurrentActiveAuthorization(slot.key.correlation, findAuthorizationById))) {
        await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
          input.parentSessionId,
          authorizationIdFor(slot.key.correlation),
        );
        await cleanupCancelledStagedCompletion(
          input.parentSessionId,
          authorizationIdFor(slot.key.correlation),
        );
        return { kind: "blocked" };
      }
      if (taskCallBinding.artifactReservation.status === "unusable") {
        return { kind: "blocked" };
      }
      const pendingPostToolUse = findPendingReviewPostToolUseForCall(
        records,
        input.parentSessionId,
        input.callId,
      );
      if (pendingPostToolUse !== undefined && pendingPostToolUse.sessionId !== input.postToolUse.sessionId) {
        return { kind: "stale" };
      }
      if (pendingPostToolUse === undefined) {
        const pending = await appendReviewPostToolUsePending({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId: input.agentId,
          sessionId: input.postToolUse.sessionId,
          writerId: input.writerId,
          recordType: "observation",
          kind: "review_post_tooluse_pending",
          parentSessionId: input.parentSessionId,
          callId: input.callId,
        });
        if (pending.kind !== "committed") {
          await recordAdvisory("review_completion_pending_append_failed");
          return { kind: "blocked" };
        }
      }
      if (delegatedBinding === undefined) {
        return { kind: "awaiting_child_binding" };
      }
      if (!matchesReviewPostToolUse(input.postToolUse, slot, taskCallBinding, delegatedBinding)) {
        return { kind: "stale" };
      }
      const existingReadAttempt = findReviewArtifactReadAttemptForCall(
        records,
        input.parentSessionId,
        input.callId,
      );
      if (existingReadAttempt !== undefined) {
        if (
          !sameReviewCorrelation(existingReadAttempt.correlation, slot.key.correlation) ||
          taskCallBinding.artifactReservation.status !== "usable" ||
          existingReadAttempt.artifactId !== taskCallBinding.artifactReservation.artifactId ||
          existingReadAttempt.artifactPath !== taskCallBinding.artifactReservation.artifactPath
        ) {
          return { kind: "stale" };
        }
        return stageArtifactFailureFromReadAttempt(existingReadAttempt, "artifact_read_failed");
      }
      if (taskCallBinding.artifactReservation.status !== "usable") return { kind: "blocked" };
      const readAttemptAppend = await appendReviewArtifactReadAttempt({
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        agentId: input.agentId,
        sessionId: input.postToolUse.sessionId,
        writerId: input.writerId,
        recordType: "observation",
        kind: "review_artifact_read_started",
        parentSessionId: input.parentSessionId,
        callId: input.callId,
        correlation: slot.key.correlation,
        artifactId: taskCallBinding.artifactReservation.artifactId,
        artifactPath: taskCallBinding.artifactReservation.artifactPath,
      });
      if (readAttemptAppend.kind !== "committed") {
        await recordAdvisory("review_artifact_read_attempt_append_failed");
        return { kind: "blocked" };
      }
      const readAttempt = readAttemptAppend.record;
      let assembled: ReviewCompletionStaging | ReviewArtifactReadFailure;
      try {
        assembled = await readAndAssembleMatchingArtifact(
          input.postToolUse,
          taskCallBinding,
          delegatedBinding,
          slot.key.correlation,
        );
      } catch (error) {
        await recordAdvisory("review_artifact_read_unhandled", error);
        return stageArtifactFailureFromReadAttempt(readAttempt, "artifact_read_failed");
      }
      if ("kind" in assembled && assembled.kind === "failure") {
        return stageArtifactFailureFromReadAttempt(readAttempt, assembled.reason);
      }
      const staging = await appendReviewCompletionStaging({
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        agentId: input.agentId,
        sessionId: input.postToolUse.sessionId,
        writerId: input.writerId,
        recordType: "observation",
        kind: "review_completion_staged",
        parentSessionId: input.parentSessionId,
        staging: assembled,
      });
      if (staging.kind !== "committed") return { kind: "blocked" };
      if (!(await isCurrentActiveAuthorization(slot.key.correlation, findAuthorizationById))) {
        await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
          input.parentSessionId,
          authorizationIdFor(slot.key.correlation),
        );
        await cleanupCancelledStagedCompletion(
          input.parentSessionId,
          authorizationIdFor(slot.key.correlation),
        );
        return { kind: "blocked" };
      }

      const terminal = await appendCompositeTerminalRecord(buildTerminalRecord(staging.record, slot));
      if (terminal.kind !== "committed") return { kind: "blocked" };
      const outcome = await ensureTerminalReviewOutcomeApplied(terminal.record);
      await ensureConsumedReviewArtifactCleaned(staging.record, terminal.record);
      await offerNextMandatoryReviewWithinParentSessionClaim(input.parentSessionId);
      return outcome;
}

function isMatchingNormalStaging(
  staged: ReviewCompletionStagingRecord,
  terminal: ReviewDispatchTransitionRecord,
): boolean {
  if (
    terminal.from !== "claimed" ||
    terminal.to !== "terminal" ||
    !("callId" in terminal) ||
    terminal.callId === undefined ||
    !("artifactConsumption" in terminal) ||
    terminal.artifactConsumption === undefined ||
    (terminal.terminalReason !== "completed" &&
      terminal.terminalReason !== "completed_with_findings" &&
      terminal.terminalReason !== "review_incomplete")
  ) {
    return false;
  }
  return (
    staged.parentSessionId === terminal.parentSessionId &&
    staged.staging.callId === terminal.callId &&
    sameReviewCorrelation(staged.staging.correlation, terminal.correlation) &&
    staged.staging.artifactConsumption.artifactId === terminal.artifactConsumption.artifactId &&
    staged.staging.artifactConsumption.digest === terminal.artifactConsumption.digest
  );
}

function isMatchingCancelledStaging(
  records: readonly PersistedLogRecord[],
  staging: ReviewCompletionStagingRecord,
  terminal: ReviewDispatchTransitionRecord,
): boolean {
  if (
    terminal.to !== "terminal" ||
    !("callId" in terminal) ||
    terminal.terminalReason !== "cancelled" ||
    terminal.callId !== staging.staging.callId
  ) {
    return false;
  }
  if (
    terminal.parentSessionId !== staging.parentSessionId ||
    !sameReviewCorrelation(terminal.correlation, staging.staging.correlation)
  ) {
    return false;
  }
  const binding = projectTaskCallBindings(records).find(
    (candidate): candidate is ReviewTaskCallBinding =>
      isReviewTaskCallBinding(candidate) &&
      candidate.callId === staging.staging.callId &&
      sameReviewCorrelation(candidate.correlation, staging.staging.correlation),
  );
  return (
    binding?.artifactReservation.status === "usable" &&
    binding.artifactReservation.artifactId === staging.staging.artifactConsumption.artifactId
  );
}

function findMatchingTerminalForStaging(
  records: readonly PersistedLogRecord[],
  staged: ReviewCompletionStagingRecord,
): ReviewDispatchTransitionRecord | undefined {
  return records.find(
    (record): record is ReviewDispatchTransitionRecord =>
      record.kind === "review_dispatch_transition" &&
      record.to === "terminal" &&
      (isMatchingNormalStaging(staged, record) ||
        isMatchingCancelledStaging(records, staged, record)),
  );
}

function findCurrentPendingOrClaimedSlotsForAuthorization(
  slots: readonly ReviewDispatchSlot[],
  parentSessionId: string,
  authorizationId: string,
): readonly ReviewDispatchSlot[] {
  return slots.filter(
    (slot) =>
      slot.key.parentSessionId === parentSessionId &&
      authorizationIdFor(slot.key.correlation) === authorizationId &&
      (slot.state === "pending" || slot.state === "claimed"),
  );
}

function findMatchingUsableArtifactReservation(
  records: readonly PersistedLogRecord[],
  staged: ReviewCompletionStagingRecord,
): Extract<ReviewArtifactReservation, { readonly status: "usable" }> | undefined {
  const binding = projectTaskCallBindings(records).find(
    (candidate): candidate is ReviewTaskCallBinding =>
      isReviewTaskCallBinding(candidate) &&
      candidate.callId === staged.staging.callId &&
      sameReviewCorrelation(candidate.correlation, staged.staging.correlation),
  );
  const reservation = binding?.artifactReservation;
  return reservation?.status === "usable" &&
    reservation.artifactId === staged.staging.artifactConsumption.artifactId
    ? reservation
    : undefined;
}

async function ensureConsumedReviewArtifactCleaned(
  staged: ReviewCompletionStagingRecord,
  terminal: ReviewDispatchTransitionRecord,
): Promise<void> {
  const records = await readDurableRecords();
  const matchingTerminal = findMatchingTerminalForStaging(records, staged);
  if (matchingTerminal === undefined || matchingTerminal.transitionId !== terminal.transitionId)
    return;
  if (
    matchingTerminal.terminalReason !== "completed" &&
    matchingTerminal.terminalReason !== "completed_with_findings" &&
    matchingTerminal.terminalReason !== "review_incomplete" &&
    matchingTerminal.terminalReason !== "cancelled"
  ) {
    return;
  }
  const reservation = findMatchingUsableArtifactReservation(records, staged);
  if (reservation === undefined) {
    await recordAdvisory("review_artifact_cleanup_reservation_missing");
    return;
  }
  try {
    await cleanupArtifact(reservation);
  } catch (error) {
    await recordAdvisory("review_artifact_cleanup_failed", error);
  }
}

function findClaimedUsableReservationForTerminal(
  records: readonly PersistedLogRecord[],
  terminal: ReviewDispatchTransitionRecord,
): Extract<ReviewArtifactReservation, { readonly status: "usable" }> | undefined {
  const claimed = records.find(
    (record): record is ReviewDispatchTransitionRecord & {
      readonly from: "pending";
      readonly to: "claimed";
      readonly callId: string;
      readonly artifactReservation: ReviewArtifactReservation;
    } =>
      record.kind === "review_dispatch_transition" &&
      record.from === "pending" &&
      record.to === "claimed" &&
      record.parentSessionId === terminal.parentSessionId &&
      record.callId === terminal.callId &&
      sameReviewCorrelation(record.correlation, terminal.correlation),
  );
  return claimed?.artifactReservation.status === "usable" ? claimed.artifactReservation : undefined;
}

async function ensureFailedReviewArtifactCleaned(
  terminal: ReviewDispatchTransitionRecord,
): Promise<void> {
  if (!isArtifactFailureTerminal(terminal) && terminal.terminalReason !== "cancelled") return;
  if (terminal.terminalReason === "artifact_missing") return;
  const records = await readDurableRecords();
  const reservation = findClaimedUsableReservationForTerminal(records, terminal);
  if (reservation === undefined) {
    await recordAdvisory("review_artifact_cleanup_reservation_missing");
    return;
  }
  try {
    await cleanupArtifact(reservation);
  } catch (error) {
    await recordAdvisory("review_artifact_cleanup_failed", error);
  }
}

async function recoverStagedArtifactFailure(
  staged: PersistedReviewArtifactFailureStagingRecord,
): Promise<ReviewCompletionOutcome> {
  const records = await readDurableRecords();
  const existingTerminal = findMatchingArtifactFailureTerminal(records, staged);
  if (existingTerminal !== undefined) {
    await ensureFailedReviewArtifactCleaned(existingTerminal);
    await offerNextMandatoryReviewWithinParentSessionClaim(staged.parentSessionId);
    return { kind: "blocked" };
  }
  const slot = projectReviewDispatchSlots(records).find(
    (candidate): candidate is ClaimedReviewDispatchSlot =>
      candidate.key.parentSessionId === staged.parentSessionId &&
      candidate.state === "claimed" &&
      candidate.callId === staged.callId &&
      sameReviewCorrelation(candidate.key.correlation, staged.correlation),
  );
  if (slot === undefined) return { kind: "stale" };
  if (!(await isCurrentActiveAuthorization(staged.correlation, findAuthorizationById))) {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      staged.parentSessionId,
      authorizationIdFor(staged.correlation),
    );
    const cancelled = findMatchingArtifactFailureTerminal(await readDurableRecords(), staged);
    if (cancelled !== undefined) await ensureFailedReviewArtifactCleaned(cancelled);
    return { kind: "blocked" };
  }
  const terminal = await appendArtifactFailureTerminal({
    agentId: staged.agentId,
    sessionId: staged.sessionId,
    writerId: staged.writerId,
    parentSessionId: staged.parentSessionId,
    callId: staged.callId,
    correlation: staged.correlation,
    expectedCategory: slot.expectedCategory,
    terminalReason: staged.terminalReason,
  });
  if (terminal.kind !== "committed") return { kind: "blocked" };
  await ensureFailedReviewArtifactCleaned(terminal.record);
  await offerNextMandatoryReviewWithinParentSessionClaim(staged.parentSessionId);
  return { kind: "blocked" };
}

async function recoverInterruptedArtifactRead(
  readAttempt: PersistedReviewArtifactReadAttemptRecord,
): Promise<ReviewCompletionOutcome> {
  const records = await readDurableRecords();
  const existingFailure = findArtifactFailureStagingForCall(
    records,
    readAttempt.parentSessionId,
    readAttempt.callId,
  );
  if (existingFailure !== undefined) return recoverStagedArtifactFailure(existingFailure);
  const slot = projectReviewDispatchSlots(records).find(
    (candidate): candidate is ClaimedReviewDispatchSlot =>
      candidate.key.parentSessionId === readAttempt.parentSessionId &&
      candidate.state === "claimed" &&
      candidate.callId === readAttempt.callId &&
      sameReviewCorrelation(candidate.key.correlation, readAttempt.correlation),
  );
  const binding = projectTaskCallBindings(records).find(
    (candidate): candidate is ReviewTaskCallBinding =>
      isReviewTaskCallBinding(candidate) &&
      candidate.callId === readAttempt.callId &&
      sameReviewCorrelation(candidate.correlation, readAttempt.correlation),
  );
  if (
    slot === undefined ||
    binding === undefined ||
    binding.artifactReservation.status !== "usable" ||
    binding.artifactReservation.artifactId !== readAttempt.artifactId ||
    binding.artifactReservation.artifactPath !== readAttempt.artifactPath
  ) {
    return { kind: "stale" };
  }
  if (!(await isCurrentActiveAuthorization(readAttempt.correlation, findAuthorizationById))) {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      readAttempt.parentSessionId,
      authorizationIdFor(readAttempt.correlation),
    );
    return { kind: "blocked" };
  }
  return stageArtifactFailureFromReadAttempt(readAttempt, "artifact_read_failed");
}

async function cleanupCancelledStagedCompletion(
  parentSessionId: string,
  authorizationId: string,
): Promise<void> {
  const records = await readDurableRecords();
  const staged = records
    .filter(
      (record): record is ReviewCompletionStagingRecord =>
        record.kind === "review_completion_staged" &&
        record.parentSessionId === parentSessionId &&
        authorizationIdFor(record.staging.correlation) === authorizationId,
    )
    .find((candidate) => {
      const terminal = findMatchingTerminalForStaging(records, candidate);
      return terminal?.terminalReason === "cancelled";
    });
  if (staged === undefined) return;
  const terminal = findMatchingTerminalForStaging(records, staged);
  if (terminal !== undefined) await ensureConsumedReviewArtifactCleaned(staged, terminal);
}

type TerminalOutcomeTransition =
  | {
      readonly scope: "task";
      readonly parentSessionId: string;
      readonly taskExecutionRef: TaskExecutionRef;
      readonly from: "review_pending";
      readonly to: "gate_pending" | "rework_required";
    }
  | {
      readonly scope: "final";
      readonly parentSessionId: string;
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: number;
      readonly from: "final_review_pending";
      readonly to: "final_gate_pending" | "final_rework_required";
    };

function terminalMatchesCurrentIdentity(
  terminal: ReviewDispatchTransitionRecord,
  lifecycle: ProjectedLifecycle,
  records: readonly PersistedLogRecord[],
  authorizations: readonly ApprovedPlanBinding[],
): boolean {
  if (terminal.correlation.reviewKind === "task-review") {
    const current = lifecycle.currentTaskExecutionRefs.get(
      terminal.correlation.taskExecutionRef.taskId,
    );
    return (
      current !== undefined &&
      current.authorizationId === terminal.correlation.taskExecutionRef.authorizationId &&
      current.attemptId === terminal.correlation.taskExecutionRef.attemptId
    );
  }
  const current = projectCurrentFinalReviewCorrelation(records, lifecycle, authorizations);
  return current !== undefined && sameReviewCorrelation(current, terminal.correlation);
}

function gatePendingTransitionFor(
  terminal: ReviewDispatchTransitionRecord,
  lifecycle: ProjectedLifecycle,
  records: readonly PersistedLogRecord[],
  authorizations: readonly ApprovedPlanBinding[],
): TerminalOutcomeTransition | undefined {
  if (!terminalMatchesCurrentIdentity(terminal, lifecycle, records, authorizations)) return undefined;
  if (terminal.correlation.reviewKind === "task-review") {
    if (
      lifecycle.taskStates.get(terminal.correlation.taskExecutionRef.taskId) !== "review_pending"
    ) {
      return undefined;
    }
    return {
      scope: "task",
      parentSessionId: terminal.parentSessionId,
      taskExecutionRef: terminal.correlation.taskExecutionRef,
      from: "review_pending",
      to: "gate_pending",
    };
  }
  const current = lifecycle.finalization;
  if (current === undefined || current.state !== "final_review_pending") return undefined;
  return {
    scope: "final",
    parentSessionId: terminal.parentSessionId,
    authorizationId: terminal.correlation.authorizationId,
    planPath: terminal.correlation.planPath,
    finalizationAttemptId: terminal.correlation.finalizationAttemptId,
    finalReviewRound: terminal.correlation.finalReviewRound,
    from: "final_review_pending",
    to: "final_gate_pending",
  };
}

function reworkTransitionFor(
  terminal: ReviewDispatchTransitionRecord,
  lifecycle: ProjectedLifecycle,
  records: readonly PersistedLogRecord[],
  authorizations: readonly ApprovedPlanBinding[],
): TerminalOutcomeTransition | undefined {
  const gatePending = gatePendingTransitionFor(terminal, lifecycle, records, authorizations);
  if (gatePending === undefined) return undefined;
  return gatePending.scope === "task"
    ? { ...gatePending, to: "rework_required" }
    : { ...gatePending, to: "final_rework_required" };
}

function hasLifecycleTransition(
  records: readonly PersistedLogRecord[],
  transition: TerminalOutcomeTransition,
): boolean {
  return records.some((record) => {
    if (transition.scope === "task") {
      return (
        record.kind === "task_lifecycle_transition" &&
        record.parentSessionId === transition.parentSessionId &&
        record.from === transition.from &&
        record.to === transition.to &&
        record.taskExecutionRef.authorizationId === transition.taskExecutionRef.authorizationId &&
        record.taskExecutionRef.taskId === transition.taskExecutionRef.taskId &&
        record.taskExecutionRef.attemptId === transition.taskExecutionRef.attemptId
      );
    }
    return (
      record.kind === "plan_finalization_transition" &&
      record.parentSessionId === transition.parentSessionId &&
      record.from === transition.from &&
      record.to === transition.to &&
      record.authorizationId === transition.authorizationId &&
      record.planPath === transition.planPath &&
      record.finalizationAttemptId === transition.finalizationAttemptId &&
      record.finalReviewRound === transition.finalReviewRound
    );
  });
}

async function appendLifecycleTransition(
  transition: TerminalOutcomeTransition,
): Promise<{ readonly kind: "committed" | "failed" }> {
  if (transition.scope === "task") {
    return appendTaskLifecycleTransition({
      parentSessionId: transition.parentSessionId,
      taskExecutionRef: transition.taskExecutionRef,
      from: transition.from,
      to: transition.to,
    });
  }
  return appendPlanFinalizationTransition({
    parentSessionId: transition.parentSessionId,
    authorizationId: transition.authorizationId,
    planPath: transition.planPath,
    finalizationAttemptId: transition.finalizationAttemptId,
    finalReviewRound: transition.finalReviewRound,
    from: transition.from,
    to: transition.to,
  });
}

function hasCurrentGateAndAcceptanceDecisions(
  records: readonly PersistedLogRecord[],
  correlation: ReviewCorrelation,
): boolean {
  const gate = findCurrentGateDecision(records, correlation);
  const acceptance = findCurrentAcceptanceDecision(records, correlation);
  return (
    gate.kind === "found" &&
    acceptance.kind === "found" &&
    acceptanceMatchesGate(gate.decision, acceptance.decision)
  );
}

function gateContextForCurrentTerminal(
  terminal: ReviewDispatchTransitionRecord,
  lifecycle: ProjectedLifecycle,
  records: readonly PersistedLogRecord[],
  authorizations: readonly ApprovedPlanBinding[],
): GatePendingAttemptContext | undefined {
  if (!terminalMatchesCurrentIdentity(terminal, lifecycle, records, authorizations)) return undefined;
  if (terminal.correlation.reviewKind === "task-review") {
    if (lifecycle.taskStates.get(terminal.correlation.taskExecutionRef.taskId) !== "gate_pending") {
      return undefined;
    }
    return {
      scope: "task",
      trigger: "task_complete",
      parentSessionId: terminal.parentSessionId,
      taskExecutionRef: terminal.correlation.taskExecutionRef,
      agentId: terminal.agentId,
      sessionId: terminal.sessionId,
      writerId: terminal.writerId,
    };
  }
  const current = lifecycle.finalization;
  if (current === undefined || current.state !== "final_gate_pending") return undefined;
  return {
    scope: "plan",
    trigger: "final_review_complete",
    parentSessionId: terminal.parentSessionId,
    authorizationId: terminal.correlation.authorizationId,
    planPath: terminal.correlation.planPath,
    finalizationAttemptId: terminal.correlation.finalizationAttemptId,
    finalReviewRound: terminal.correlation.finalReviewRound,
    agentId: terminal.agentId,
    sessionId: terminal.sessionId,
    writerId: terminal.writerId,
  };
}

function delegatedBindingMatchesStaging(
  binding: DelegatedExecutionBinding,
  staging: ReviewCompletionStagingRecord,
): boolean {
  if (
    binding.parentSessionId !== staging.parentSessionId ||
    binding.parentCallId !== staging.staging.callId ||
    binding.childSessionId !== staging.staging.observedExecution.childSessionId
  ) {
    return false;
  }
  return executionScopeMatchesCorrelation(binding.scope, staging.staging.correlation);
}

async function ensureTerminalReviewOutcomeApplied(
  terminal: ReviewDispatchTransitionRecord,
): Promise<ReviewCompletionOutcome> {
  if (!(await isCurrentActiveAuthorization(terminal.correlation, findAuthorizationById))) {
    return { kind: "blocked" };
  }
  const records = await readDurableRecords();
  const authorizations = await readDurableAuthorizations();
  const lifecycle = project(records, new Date().toISOString()).lifecycle;
  if (!terminalMatchesCurrentIdentity(terminal, lifecycle, records, authorizations)) {
    return { kind: "stale" };
  }

  switch (terminal.terminalReason) {
    case "completed": {
      const transition = gatePendingTransitionFor(terminal, lifecycle, records, authorizations);
      if (transition !== undefined && !hasLifecycleTransition(records, transition)) {
        if (!(await isCurrentActiveAuthorization(terminal.correlation, findAuthorizationById))) {
          return { kind: "blocked" };
        }
        const appended = await appendLifecycleTransition(transition);
        if (appended.kind !== "committed") return { kind: "blocked" };
      }
      const currentRecords = await readDurableRecords();
      const projected = project(currentRecords, new Date().toISOString()).lifecycle;
      const gateContext = gateContextForCurrentTerminal(
        terminal,
        projected,
        currentRecords,
        authorizations,
      );
      if (gateContext !== undefined) {
        const gateOutcome = await evaluateGatePendingAttemptWithinAuthorizationReviewBoundary(gateContext);
        if (gateOutcome.kind === "blocked") return { kind: "blocked" };
        if (gateOutcome.kind === "not_applicable") return { kind: "stale" };
        return { kind: "terminalized" };
      }
      return hasCurrentGateAndAcceptanceDecisions(currentRecords, terminal.correlation)
        ? { kind: "terminalized" }
        : { kind: "stale" };
    }
    case "completed_with_findings": {
      const currentState =
        terminal.correlation.reviewKind === "task-review"
          ? lifecycle.taskStates.get(terminal.correlation.taskExecutionRef.taskId)
          : lifecycle.finalization?.state;
      if (currentState === "rework_required" || currentState === "final_rework_required") {
        return { kind: "terminalized" };
      }
      const transition = reworkTransitionFor(terminal, lifecycle, records, authorizations);
      if (transition === undefined) return { kind: "stale" };
      if (!hasLifecycleTransition(records, transition)) {
        if (!(await isCurrentActiveAuthorization(terminal.correlation, findAuthorizationById))) {
          return { kind: "blocked" };
        }
        const appended = await appendLifecycleTransition(transition);
        if (appended.kind !== "committed") return { kind: "blocked" };
      }
      return { kind: "terminalized" };
    }
    case "review_incomplete":
      return { kind: "blocked" };
    case "cancelled":
    case "artifact_reservation_unusable":
    case "artifact_missing":
    case "artifact_read_failed":
    case "artifact_json_invalid":
    case "artifact_schema_invalid":
    case "review_execution_failed":
    case "lost_conclusive":
      return { kind: "blocked" };
  }
}

async function recoverStagedReviewCompletion(
  staged: ReviewCompletionStagingRecord,
): Promise<ReviewCompletionOutcome> {
  const records = await readDurableRecords();
  const existingTerminal = findMatchingTerminalForStaging(records, staged);
  if (existingTerminal !== undefined) {
    const outcome = await ensureTerminalReviewOutcomeApplied(existingTerminal);
    await ensureConsumedReviewArtifactCleaned(staged, existingTerminal);
    await offerNextMandatoryReviewWithinParentSessionClaim(staged.parentSessionId);
    return outcome;
  }

  const slot = projectReviewDispatchSlots(records).find(
    (candidate): candidate is ClaimedReviewDispatchSlot =>
      candidate.key.parentSessionId === staged.parentSessionId &&
      candidate.state === "claimed" &&
      candidate.callId === staged.staging.callId &&
      sameReviewCorrelation(candidate.key.correlation, staged.staging.correlation),
  );
  const taskCallBinding = projectTaskCallBindings(records).find(
    (candidate): candidate is ReviewTaskCallBinding =>
      isReviewTaskCallBinding(candidate) &&
      slot !== undefined &&
      reviewTaskCallBindingMatchesSlot(candidate, slot),
  );
  const delegatedBinding = projectDelegatedExecutionBindings(records).find(
    (candidate) =>
      slot !== undefined &&
      candidate.parentSessionId === staged.parentSessionId &&
      candidate.parentCallId === staged.staging.callId &&
      delegatedBindingMatchesSlot(candidate, slot),
  );
  if (
    slot === undefined ||
    taskCallBinding === undefined ||
    delegatedBinding === undefined ||
    !delegatedBindingMatchesStaging(delegatedBinding, staged) ||
    taskCallBinding.artifactReservation.status !== "usable" ||
    taskCallBinding.artifactReservation.artifactId !== staged.staging.artifactConsumption.artifactId
  ) {
    return { kind: "stale" };
  }
  if (!(await isCurrentActiveAuthorization(staged.staging.correlation, findAuthorizationById))) {
    await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
      staged.parentSessionId,
      authorizationIdFor(staged.staging.correlation),
    );
    await cleanupCancelledStagedCompletion(
      staged.parentSessionId,
      authorizationIdFor(staged.staging.correlation),
    );
    return { kind: "blocked" };
  }
  const terminal = await appendCompositeTerminalRecord(buildTerminalRecord(staged, slot));
  if (terminal.kind !== "committed") return { kind: "blocked" };
  const outcome = await ensureTerminalReviewOutcomeApplied(terminal.record);
  await ensureConsumedReviewArtifactCleaned(staged, terminal.record);
  await offerNextMandatoryReviewWithinParentSessionClaim(staged.parentSessionId);
  return outcome;
}

async function recoverStagedReviewCompletionsAfterRestart(): Promise<void> {
  const records = orderEventsForProjection(await readDurableRecords());
  const stagings = records.filter(
    (record): record is ReviewCompletionStagingRecord => record.kind === "review_completion_staged",
  );
  for (const staged of stagings) {
    try {
      await withReviewDispatchParentSessionClaim(staged.parentSessionId, () =>
        recoverStagedReviewCompletion(staged),
      );
    } catch (error) {
      await recordAdvisory("review_staged_completion_recovery_failed", error);
    }
  }
  const interruptedReads = records.filter(
    (record): record is PersistedReviewArtifactReadAttemptRecord =>
      record.kind === "review_artifact_read_started" &&
      findStagedCompletionForCall(records, record.parentSessionId, record.callId) === undefined &&
      findArtifactFailureStagingForCall(records, record.parentSessionId, record.callId) === undefined,
  );
  for (const readAttempt of interruptedReads) {
    try {
      await withReviewDispatchParentSessionClaim(readAttempt.parentSessionId, () =>
        recoverInterruptedArtifactRead(readAttempt),
      );
    } catch (error) {
      await recordAdvisory("review_artifact_read_recovery_failed", error);
    }
  }
  const failureStagings = records.filter(
    (record): record is PersistedReviewArtifactFailureStagingRecord =>
      record.kind === "review_artifact_failure_staged",
  );
  for (const staged of failureStagings) {
    try {
      await withReviewDispatchParentSessionClaim(staged.parentSessionId, () =>
        recoverStagedArtifactFailure(staged),
      );
    } catch (error) {
      await recordAdvisory("review_artifact_failure_recovery_failed", error);
    }
  }
  const pendingPostToolUses = records.filter(
    (record): record is PersistedReviewPostToolUseRecord =>
      record.kind === "review_post_tooluse_pending",
  );
  for (const pending of pendingPostToolUses) {
    await recoverPendingReviewCompletionsForBinding(pending.parentSessionId, pending.callId);
  }
}

  return {
    consumeReviewCompletion,
    recoverPendingReviewCompletionsForBinding,
    recoverStagedReviewCompletion,
    recoverStagedReviewCompletionsAfterRestart,
    recoverInterruptedArtifactRead,
    recoverStagedArtifactFailure,
    ensureTerminalReviewOutcomeApplied,
    ensureConsumedReviewArtifactCleaned,
    ensureFailedReviewArtifactCleaned,
    findMatchingTerminalForStaging,
  };
}
```

Replace the `Promise.all` path for task PostToolUse in `JusticePlugin` with `runTaskPostToolUseSequentially`. Keep independent non-task handlers unchanged.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-artifact.test.ts tests/core/review-artifact-reservation.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
git add src/core/review-artifact.ts src/core/review-dispatch-state.ts src/core/session-state-provider.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/core/review-artifact.test.ts tests/core/review-artifact-reservation.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts
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
`checkPinnedCommandPresence(commandDefinitions: ReadonlyMap<string, DoctorEffectiveCommandDefinition>):
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
  ["empty agent", new Map([["justice-implement-brainstorming", { agent: "" }]]), "missing_agent"],
  [
    "unrecognized agent",
    new Map([["justice-implement-brainstorming", { agent: "prometheus" }]]),
    "missing_agent",
  ],
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
is forbidden. Treat an entry as pinned only when `isPinnedControllerCommand(definition)` succeeds, so an
empty or unrecognized `agent` produces `missing_agent` rather than counting as a configured command. For
every required entry, emit exactly one diagnostic discriminant:
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
  commandDefinitions: ReadonlyMap<string, DoctorEffectiveCommandDefinition>,
): PinnedCommandPresenceResult {
  const diagnostics = Object.entries(REQUIRED_PINNED_COMMAND_AGENTS).flatMap(
    ([commandName, expectedAgent]) => {
      const definition = commandDefinitions.get(commandName);
      if (definition === undefined) return [{ kind: "missing", commandName, expectedAgent }];
      if (!isPinnedControllerCommand(definition))
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

### Requirement-to-Task Traceability

| Requirement / Design Decision                                  | Plan Task               | Required tests                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JUS-P0-01 controller workflow identity and runtime observation | 4.1, 4.2                | routing decision, applied, mismatch, effective pinned-command precedence, template output                                                                                                                                        |
| pinned command name + agent validation                         | 4.2                     | correct agent, missing command, missing agent, mismatched agent, higher-priority replacement in both directions, expected-agent template, raw-config redaction                                                                   |
| JUS-P0-02 semantic fingerprint and canonical snapshot          | 2.1, 2.2                | semantic mutation, snapshot persistence, hydration, fresh reapproval ID, terminal merge protection                                                                                                                               |
| typed `error_annotation` provenance and exact line migration   | 2.1                     | persisted observation validation/replay, plan-path and raw-snapshot scoping, line number / occurrence / digest matching, cross-plan and unknown-provenance retention                                                          |
| authorization sequential supersession                          | 2.2                     | same-session A→B atomic supersession, durable `plan_superseded`, exactly one active binding, old authorization rejection, other-session isolation                                                                                |
| same-process approval serialization                            | 2.2                     | one store plus one injected boundary: concurrent same-parent approvals have maximum mutation-body concurrency one, do not deadlock, retain one active binding, terminalize losers, and publish the final durable active cache |
| cross-process authorization conflict                           | 2.2                     | two stores plus independent boundaries and shared persistence: fresh approvals traverse real `AtomicPersistence` version mismatch and `mergeAuthorizationBindings` retry, retain one active binding, terminalize the losing fresh ID as `plan_superseded`, preserve other-session active binding |
| authorization terminal dominance and cache consistency         | 2.2                     | same-ID terminal never resurrects; conflict-diverted candidate never updates cache; saved merged durable active binding is the cache value                                                                                       |
| Authorization public/inner mutation split                      | 2.2                     | public release and fingerprint invalidation acquire the boundary once; their within-boundary counterparts acquire it zero times; wrong parent causes no durable mutation                                                                                                       |
| `AuthorizationReviewBoundary` implementation                  | 2.2                     | same-parent exclusion, rejected-predecessor recovery, A -> B -> C conditional-tail cleanup, and different-parent progress                                                                                                       |
| shared boundary singleton wiring                               | 2.2, 3.2, 3.4, 3.6      | plugin construction calls the factory once; cross-domain same-parent integration proves max concurrency one                                                                                                                      |
| review completion -> Gate lock ownership                       | 3.2, 3.6                | live clean Task and Final Review reach Gate without nested parent acquisition and append one GateDecision / AcceptanceDecision                                                                                                  |
| staged recovery -> Gate lock ownership                         | 3.2, 3.6                | Task and Final Review restart recovery complete without nested parent acquisition and append one GateDecision / AcceptanceDecision                                                                                               |
| release -> cancellation critical section                       | 2.2, 3.4                | one outer parent operation orders durable release, cancellation attempt, cache update, and boundary release; failed or uncertain release has no cancellation or terminal cache publication                                                                                      |
| invalidation -> cancellation critical section                  | 2.2, 3.4                | one outer parent operation orders durable invalidation, cancellation attempt, cache update, and boundary release; failed or uncertain invalidation has no cancellation or terminal cache publication                                                                          |
| review completion next-offer lock ownership                    | 3.4, 3.6                | parent-boundary completion and recovery paths use only `offerNextMandatoryReviewWithinParentSessionClaim`; the public offer entry is boundary-external and nested parent acquisition remains zero                                                                             |
| public Gate operation                                          | 3.2                     | direct call acquires the shared parent boundary and terminal concurrent Authorization prevents positive decision                                                                                                                  |
| within-boundary Gate operation                                 | 3.2, 3.6                | inner call skips parent acquisition while retaining decision-identity serialization                                                                                                                                            |
| JUS-P0-02 session-scoped cancel                                | 2.3, 3.4                | pathless parser, invalid flag combinations, durable release, no-binding idempotence, release-before-cancelled ordering, pending/claimed cancellation tombstone                                                                   |
| terminal Authorization blocks review dispatch                  | 2.3, 3.4                | cancel or invalidation prevents initial/reissued directive and claim; restart does not revive a pending slot; tombstone failure remains fail-closed and later converges                                                          |
| terminal Authorization blocks review retry                     | 3.4                     | `review_execution_failed` and `lost_conclusive` terminal followed by cancel/restart creates no next pending, directive, or Acceptance progress                                                                                   |
| terminal Authorization blocks pending recovery                 | 3.4                     | cancellation tombstone append failure followed by restart emits no pending directive, permits no claim, and later converges one tombstone                                                                                        |
| cancellation serialization                                     | 3.4                     | terminal-Authorization claim completes without reentrant queue wait; external cancellation and claim serialize; A → B → C leaves no stale queue tail and at most one tombstone                                                   |
| JUS-P0-03 seven-to-seven category mapping                      | 1.1                     | every role, legacy downgrade rejection                                                                                                                                                                                           |
| JUS-P0-03 doctor effective category configuration              | 1.2                     | JSONC parsing, source precedence, missing category, unreadable/unsupported source, redaction                                                                                                                                     |
| JUS-P0-04 task lifecycle                                       | 3.1                     | full `authorized → in_progress → worker_reported → evidence_pending → review_pending` trace, fresh attempt, restart reconstruction                                                                                               |
| JUS-P0-04 attempt-scoped Evidence / Review / Gate              | 3.1, 3.2, 3.4, 3.5, 3.6 | stale attempt/call/child/artifact rejection, reviewRound reset on rework                                                                                                                                                         |
| concurrent GateDecision idempotency                            | 3.2                     | same-identity concurrent evaluation produces one GateDecision, one AcceptanceDecision, and one lifecycle transition without conflict                                                                                               |
| concurrent AcceptanceDecision idempotency                      | 3.2                     | same-identity concurrent recovery after a durable GateDecision produces one AcceptanceDecision without conflict                                                                                                                   |
| decision identity serialization                                | 3.2                     | barrier-coordinated three-way overlap proves one active critical section, successor-tail preservation, and cleanup only after the final operation                                                                                   |
| legacy task Gate replay compatibility                          | 3.2                     | exact existing schemaVersion 1 task Gate record without `taskExecutionRef` is accepted by validation and compatibility projection                                                                                                  |
| legacy shard integrity                                         | 3.2                     | legacy task Gate between two normal observations leaves all three records readable from one physical shard                                                                                                                        |
| legacy Gate non-authority                                     | 3.2                     | current Gate lookup excludes legacy task Gate; legacy-only input neither generates Acceptance nor promotes `gate_pending`                                                                                                          |
| new task/plan Gate replay                                      | 3.2                     | strict validation and authoritative lookup accept the new task and plan Gate variants, while rejecting mixed plan/task identity                                                                                                  |
| new task/plan Acceptance replay                                | 3.2                     | strict validation and lookup accept the new task and plan Acceptance variants, while rejecting mixed plan/task identity                                                                                                           |
| artifact reservation anti-replay                               | 3.4                     | safe path, collision retry with fresh UUID, bounded collision exhaustion, exists/directory I/O failure, invalid path, internal failure, unusable durable reservation and advisory                                                |
| synchronous mandatory review execution                         | 3.4                     | explicit true is forced to false by package, hook normalization, and final adapter wire guard for both review categories; non-review categories preserve caller value              |
| artifact inode lease and no-follow consumption                 | 3.4, 3.6                | retained private lease, durable device/inode identity, existing-inode write, replacement/symlink rejection, descriptor-relative read, replacement-safe cleanup                    |
| unusable reservation blocks before Acceptance                   | 3.4, 3.6                | fail-open review task execution, worker input without artifact path, no filesystem read or ReviewArtifact, no AcceptanceDecision                                                                                             |
| artifact read / validation failure terminality                  | 3.6                     | missing file, read I/O failure, invalid JSON, and schema mismatch each persist its exact no-artifact terminal reason; claimed slot converges after restart, lifecycle stays blocked, no Gate/Acceptance/retry/round change, and cleanup is idempotent |
| same-parent review claim serialization                         | 3.4                     | 2-call claim race and barrier-controlled overlapping 3-call race permit one critical section and exactly one claimed transition, binding, reservation, and authoritative call/artifact identity                                  |
| one outstanding dispatch per parent                            | 3.4                     | active-authorized pending / claimed cardinality permits zero or one; stale terminal/missing/uncertain Authorization slots are excluded from the limit but remain unclaimable; corrupt multiple active outstanding input is advisory, creates no pending, claim, reservation, directive, or AcceptanceDecision |
| deferred ReviewPending liveness                                | 3.1, 3.4, 3.6           | a second lifecycle candidate receives exactly one dispatch and directive from the production terminalization path without a second manual request                                                                                |
| deferred candidate restart recovery                            | 3.4                     | an undispatched current lifecycle candidate with no dispatch record is rediscovered after restart and offered exactly once                                                                                                       |
| deterministic eligible review candidate selection              | 3.4                     | `selectNextEligibleReviewCandidate` code uses `orderEventsForProjection`; retry candidates precede ordinary candidates and each category retains source order                                                                    |
| Canonical Snapshot membership                                  | 3.4                     | multi-Authorization fixture proves task-B is accepted only through authorization-B's durable `canonicalSnapshot`, never a global snapshot cache                                                                                  |
| deferred parent-session discovery                              | 3.4                     | `projectReviewCandidateParentSessionIds` code discovers undispatched current task/final candidates and retryable terminal candidates in deterministic order                                                                      |
| deterministic durable queue order                              | 3.4                     | three candidates terminalize and offer in projection order across a restart                                                                                                                                                      |
| retry versus unrelated candidate priority                      | 3.4                     | a retryable terminal candidate precedes an unrelated ReviewPending candidate according to Design §4.8.1                                                                                                                          |
| corrupt multiple outstanding slots                             | 3.4                     | fail-closed offer, claim, and cancellation create no arbitrary pending, claim, reservation, directive, or tombstone and record an integrity advisory                                                                             |
| atomic review claim                                            | 3.4                     | critical section re-reads latest durable records, projects, validates one pending slot, reserves, then appends claimed before publishing authority                                                                               |
| JUS-P0-04 review terminal atomicity                            | 3.6                     | one terminal physical record, failed append has no partial projection, deterministic replay, no pre-terminal acceptance                                                                                                          |
| ReviewCompletionStagingRecord schema                           | 3.6                     | Design `review_completion_staged`, `review_artifact_failure_staged`, and `review_post_tooluse_pending` discriminants and their exact payloads are used by append, projection, cleanup, and restart fixtures                         |
| claimed + completion staging restart recovery                  | 3.6                     | staging durable, terminal append failure, restart recovery, no artifact/worker-output reread, exactly one terminal                                                                                                               |
| staged completion restart recovery                             | 3.6                     | `recoverStagedReviewCompletion` reuses matching terminal or retries one terminal append from durable staging, and `recoverStagedReviewCompletionsAfterRestart` processes ordered staging records independently                   |
| terminal to lifecycle crash recovery                           | 3.6                     | existing clean terminal is reused without artifact reread or terminal append; missing gate_pending / final_gate_pending transition is appended exactly once                                                                      |
| gate_pending / final_gate_pending crash recovery               | 3.2, 3.6                | durable lifecycle transition is not reappended; a missing current-identity Gate or Final Gate resumes exactly once                                                                                                               |
| post-terminal outcome recovery                                 | 3.6                     | `ensureTerminalReviewOutcomeApplied` discriminates completed/findings/incomplete and failure terminals, verifies repeated lifecycle/Gate recovery is idempotent, and keeps failure outcomes blocked without Acceptance           |
| clean terminal recovery                                        | 3.2, 3.6                | clean task and Final Review terminal recover gate_pending and current-identity Gate exactly once; repeated recovery creates no duplicate GateDecision or AcceptanceDecision                                                      |
| findings terminal recovery                                     | 3.6                     | task and Final Review findings terminal recover rework_required / final_rework_required exactly once and never invoke Gate                                                                                                       |
| terminal Authorization after completed terminal                | 3.2, 3.6                | completed terminal remains durable while terminal Authorization suppresses lifecycle promotion, Gate, Acceptance, and Progress                                                                                                   |
| repeated post-terminal recovery                                | 3.2, 3.6                | terminal append, lifecycle transition, GateDecision, and AcceptanceDecision remain exactly once across repeated recovery                                                                                                         |
| staged terminalization idempotency                             | 3.6                     | repeated recovery has no duplicate terminal, Gate, or Acceptance                                                                                                                                                                 |
| staging recovery failure                                       | 3.6                     | claimed plus staging remains durable; no new dispatch, reservation, round, or AcceptanceDecision                                                                                                                                |
| consumed artifact cleanup recovery                             | 3.6                     | normal terminal before cleanup crash and cleanup failure retry without artifact reread, terminal reappend, Gate rollback, or Acceptance rollback                                                                                 |
| consumed artifact cleanup                                      | 3.6                     | `findMatchingTerminalForStaging` matches normal terminals by nested staging identity and cancelled claimed terminals by durable binding artifact ID; cleanup occurs only after a matching durable terminal                       |
| cancelled staged artifact cleanup                              | 3.4, 3.6                | cancelled tombstone precedes cleanup; failed tombstone preserves artifact; restart rediscovers the durable tombstone without reread/reappend and retries idempotent cleanup with no AcceptanceDecision                     |
| staging versus terminal Authorization                          | 2.3, 3.4, 3.6           | cancel/invalidation after staging prevents promotion; slot converges to cancelled; fresh approval does not reuse old state                                                                                                       |
| terminal artifact classification                               | 3.6                     | clean → `completed`/Gate, findings → `completed_with_findings`/direct rework, incomplete → `review_incomplete`/blocked                                                                                                           |
| Task Review failure retry                                      | 3.4, 3.6                | `retries a task review with the same TaskExecutionRef and only reviewRound + 1` verifies the retained ref, incremented task round, absent `finalReviewRound`, and stale old-round rejection                                      |
| Task implementation rework                                     | 3.1, 3.6                | fresh TaskExecutionRef and `reviewRound = 1` only after actual rework                                                                                                                                                            |
| Final Review review-only retry                                 | 3.4, 3.6                | dispatch retry retains finalizationAttemptId, increments finalReviewRound, projects that round as current, and rejects old PostToolUse/artifact/Gate records                                                                     |
| Final actual rework                                            | 3.1, 3.4, 3.6           | findings or Final Gate WARN/FAIL enter final_rework_required, then issue fresh finalizationAttemptId and incremented finalReviewRound; dispatch uses that lifecycle round                                                        |
| terminal failure to retry-pending recovery                     | 3.4                     | `recovers a terminal-to-pending crash exactly once and only dispatches after durable pending` simulates committed terminal plus failed pending append, restart, and recovery                                                     |
| retry dispatch ordering                                        | 3.4                     | the terminal-to-pending crash test records `terminal-committed -> next-pending-committed -> directive-injected`; failed pending append has no directive                                                                          |
| retry recovery idempotency                                     | 3.4                     | the terminal-to-pending crash test runs recovery twice and verifies exactly one next-round `null -> pending` transition                                                                                                          |
| stale old review round rejection                               | 3.4, 3.6                | task retry rejects old correlation; Final Review restart replay rejects old PostToolUse/artifact consumption/Gate and leaves the new correlation current                                                                         |
| conclusive loss recovery                                       | 3.4, 3.6                | `lost_conclusive` terminalization occurs before a new round and uses the same union-safe retry helper                                                                                                                            |
| uncertain claimed recovery                                     | 3.4, 3.6                | no automatic redispatch, artifact read, or Acceptance after restart                                                                                                                                                              |
| JUS-P0-04 Gate after `gate_pending`                            | 3.1, 3.2, 3.6           | no early evaluation, terminal review before gate_pending, active-Authorization guard before Gate and Acceptance append, unavailable/error blocked                                                                                |
| JUS-P0-04 finalization lifecycle                               | 3.1, 3.2, 3.4, 3.5, 3.6 | review-only retry preserves finalizationAttemptId and increments round; actual rework rotates identity; final review terminalization; stale Final Gate rejection; Final Gate PASS/rework/blocked                                 |
| JUS-P0-04 durable review dispatch and child correlation        | 3.3, 3.4, 3.5           | runtime spike, pending/claimed recovery, parent-session critical section, concurrent claim, durable child binding                                                                                                                |
| JUS-P0-04 accepted task progress                               | 3.7                     | all unchecked steps checked, reparse completed, other tasks unchanged, zero-step no-op, durable acceptance ordering, old terminal-Authorization decision rejection                                                               |
| JSON review transport fixed for P0                             | 3.4, 3.6                | reservation anti-replay, unusable fail-open/blocked path, one usable-path read, composite terminal record; no typed transport dependency                                                                                         |
| INV-01 through INV-05                                          | 1.1, 2.1, 2.2, 4.1      | category/routing/fingerprint/authorization focused tests named in those tasks                                                                                                                                                    |
| INV-06 through INV-10                                          | 3.1, 3.2, 3.6, 3.7      | lifecycle, Gate, terminalization, progress, Final Gate tests named in those tasks                                                                                                                                                |
| INV-11 through INV-18                                          | 3.3, 3.4, 3.5, 3.6      | purpose separation, claim, restart, correlation, stale-event and consumption tests named in those tasks                                                                                                                          |
| INV-19 terminal Authorization boundary                         | 2.3, 3.2, 3.4, 3.6, 3.7 | terminality guards for dispatch, claim, staged completion, Gate, Acceptance, progress, recovery, cancellation-tombstone failure, and fresh reapproval isolation                                                                  |
| INV-20 synchronous mandatory review                             | 3.4                     | package, hook, and final adapter wire guards force false for both review categories while preserving non-review caller values                                                                                                    |
| INV-21 artifact inode identity                                  | 3.4, 3.6                | private lease, durable identity, no-follow existing-inode write/read, replacement rejection, and safe cleanup tests                                                                                                             |

### Task-to-Requirement Traceability

| Plan Task | Requirement / Design Decision implemented                                                        | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1       | JUS-P0-03, Design §5.3, INV-02, INV-05                                                           | role-to-category mapping tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.2       | JUS-P0-03, Design §3.4 and §5.3                                                                  | effective configuration and category-presence tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.1       | JUS-P0-02, Design §4.3, INV-04                                                                   | fingerprint boundary, typed `error_annotation` persistence/replay, exact plan/line identity migration tests                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.2       | JUS-P0-02, Design §4.2 and §5.2, INV-03, INV-12, authorization cardinality and shared boundary    | authorization persistence, fresh ID, same-ID terminal merge, sequential supersession, version-mismatch concurrent fresh-ID merge/retry, exactly-one-active, other-session preservation, cache/durable agreement, failed-save cache retention, same-parent boundary exclusion, rejected predecessor recovery, A -> B -> C tail cleanup, different-parent progress, and one-factory construction contract tests |
| 2.3       | JUS-P0-02, Design §4.2, §4.8.1, and §5.2                                                         | pathless cancel parser, durable release, and Task 3.4 cancellation-orchestration boundary tests                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3.1       | JUS-P0-04, Design §3.3, §4.4, §5.4, §5.5, INV-06, INV-09, INV-14                                 | lifecycle orchestration; initial finalization and actual-rework fresh identity tests; no Review Dispatch schema, retry projection, or old-round test dependency                                                                                                                                                                                                                                                                                                                                                                                   |
| 3.2       | JUS-P0-02, JUS-P0-04, Design §4.6, §4.8.2, and §4.11, INV-07, INV-08, INV-10, INV-14, INV-19     | gate-pending-only; authorization guard; public parent-boundary entry and within-boundary Gate entry; same-identity Gate / Acceptance serialization and sequential idempotency; barrier-coordinated two- and three-way overlap; legacy schemaVersion 1 validation, shard replay, compatibility projection, and non-authority; strict new-decision validation / lookup; decision ordering; Gate-phase blocked-Acceptance and pre-Gate no-Acceptance tests |
| 3.3       | JUS-P0-04, Design §4.9, INV-15                                                                   | child-session runtime spike                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.4       | JUS-P0-02, JUS-P0-04, Design §4.8, §4.8.1, §4.8.2, §4.10, INV-11, INV-16, INV-17, INV-18, INV-19, INV-20, INV-21 | deterministic selector and parent-session candidate projector; authorization-specific snapshot membership; exact parent-session queue primitive; public cancellation wrapper versus within-parent helper; one outer release/invalidation plus cancellation critical section; authorization guard before initial/reissued directive, claim, failure terminal, retry pending, and restart recovery; category-aware synchronous wire normalization; inode lease and no-follow replacement rejection; review-only Final Review retry/current-round projection; no-reentrant queue, terminal-to-pending crash recovery, durable-before-directive ordering, repeated recovery idempotency, and stale-round rejection tests |
| 3.5       | JUS-P0-04, Design §4.9, INV-14, INV-15, INV-17, INV-18                                           | durable child-binding tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.6       | JUS-P0-02, JUS-P0-04, Design §4.5, §4.8.1, §4.8.2, §4.10, §4.11, INV-13 through INV-19           | unusable no-read blocked path, authorization guard, within-boundary Gate capability for live and staged/post-terminal recovery, concrete staged-terminal recovery and post-terminal outcome helpers, exact staging/terminal cleanup matching, no reread, terminal reuse without reappend, lifecycle/Gate/Acceptance idempotency, failure blocking, mismatch rejection, terminal-auth precedence, composite terminal/replay, and shared-singleton integration tests |
| 3.7       | JUS-P0-02, JUS-P0-04, Design §3.3 and §5.4, INV-06, INV-08, INV-19                               | accepted-only full progress update and old terminal-Authorization decision rejection tests                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4.1       | JUS-P0-01, Design §4.1, INV-01                                                                   | controller routing tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4.2       | JUS-P0-01, Design §3.4, §3.5, and §5.1                                                           | effective pinned-command name-and-agent, precedence, redaction, template, and routing-observation tests                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Phase 3 is incomplete if Task 3.3 cannot demonstrate both mandatory review correlations. It is incomplete if lifecycle orchestration, synchronous mandatory review canonicalization, terminal-Authorization guard, cancellation tombstone convergence, non-reentrant parent-session serialization, concurrent exactly-one claim, usable and unusable reservation branches, durable child binding, terminal classification, composite terminal record, staged-completion restart recovery without artifact/worker-output reread, post-terminal lifecycle/Gate recovery without terminal reappend, stale-event rejection, conclusive-loss recovery, uncertain-claimed blocking, attempt-scoped Gate/Acceptance idempotency, task Gate, Final Gate, or accepted-task progress lacks a passing automated test. Gate/Acceptance idempotency specifically requires the concurrent decision-identity cases, legacy task Gate shard replay compatibility, legacy non-authority, and strict new-decision replay described in Task 3.2. A known runtime limitation documents an observation only; it never waives a P0 completion criterion.

<!-- markdownlint-enable MD013 MD060 -->

Before implementation handoff, inspect every implementation step for unresolved placeholders, ambiguous file paths, and unbound requirements. Verify that every test file in a Task's Files list appears in that Task's RED and GREEN command and its `git add` scope. Verify that every table row names an exact Task and RED/GREEN test, and that every Task row names its Design decision and Requirement. Do not hand off a plan with undefined work, implied test coverage, cross-task shorthand, or an atomicity statement without its exclusion mechanism.
