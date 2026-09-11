# Semantic Control Plane Implementation Plan

> **For agentic workers:** Execute this plan inline in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Justice v4.0.0 Semantic Control Plane for JUS-P0-01 through JUS-P0-04 with durable, attempt-scoped authorization, review, gate, and acceptance state.

**Spec:** `docs/superpowers/specs/2026-09-03-semantic-control-plane-design.md`
**Requirements:** `REQUIREMENTS_2026-09-03.md`

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
- A Phase 4 runtime spike that cannot prove both (a) the non-content invocation-level join and (b) an exact safe no-command-completion lifecycle contract blocks JUS-P0-01 implementation. Task 4.0 capability PASS alone never authorizes source changes: the exact cleanup scope/hook/value/order and suppression-clear authority must first be copied into Design/Plan in a document-only change and re-reviewed. `sessionId` alone is never an invocation identity; fixed per-session bounds do not waive the lifecycle gate.
- A Phase 3 secure Review Artifact capability spike that cannot prove the supported Linux `openat2(2)` provider blocks Phase 3 and JUS-P0-04 completion before Task 3.4; an unsupported runtime is fail-open for execution but never a P0 completion waiver.
- v4.0.0's supported Review Artifact deployment is Bun 1.x on Linux x86_64 with glibc and Linux kernel 5.6 or newer. The provider is the bundled Node-API addon `dist/native/justice_review_artifact_linux.linux-x64-gnu.node`; `bun:ffi`, pathname-only helpers, and a generic storage backend are not accepted providers.
- The native addon build is pinned by `rust-toolchain.toml`: Rust `1.85.1`, `profile = "minimal"`, components `rustfmt` and `clippy`, and target `x86_64-unknown-linux-gnu`. The devcontainer provisions `rustup` and `build-essential`, never an unpinned apt `rustc`/`cargo` pair; `rustup show active-toolchain` must report `1.85.1-x86_64-unknown-linux-gnu` before native build.
- At every Phase or Phase 3 subsection boundary, after the final task's targeted `Confirm GREEN` and before that task's Step 5 commit, run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` inside `.devcontainer/`; the full gate must pass before the phase is committed.
- From Task 3.3b onward, a supported Linux x86_64 Phase 3 production-provider boundary additionally requires `bun run build:native:review-artifact`, exact existence of `dist/native/justice_review_artifact_linux.linux-x64-gnu.node`, addon-loading provider tests, and package/tarball inclusion verification before the generic full gate. Unsupported local platforms may run ordinary non-native gates but cannot satisfy the supported-provider Phase 3 Definition of Done.
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
GIT_MASTER=1 git add src/core/types.ts src/core/omo-category-mapper.ts src/core/routing-decision.ts src/core/category-classifier.ts tests/core/routing-decision.test.ts tests/unit/core/omo-category-mapper.test.ts tests/core/retry-policy-calculator.test.ts
GIT_MASTER=1 git commit -m "feat: execution roleをsp categoryへ完全対応"
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
GIT_MASTER=1 git add src/core/doctor-categories.ts src/core/doctor-config.ts src/runtime/doctor-cli.ts tests/core/doctor-categories.test.ts tests/core/justice-doctor-config.test.ts tests/runtime/doctor-cli.test.ts
GIT_MASTER=1 git commit -m "feat: doctorでsp category設定を検査"
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
GIT_MASTER=1 git add src/core/plan-fingerprint.ts src/core/error-annotation.ts src/core/types.ts src/core/v2/observation-model.ts src/runtime/validation.ts tests/core/plan-fingerprint.test.ts tests/core/plan-parser.test.ts tests/core/v2/observation-model.test.ts tests/runtime/validation.test.ts
GIT_MASTER=1 git commit -m "feat: semantic plan fingerprintとcanonical snapshotを追加"
```

### Task 2.2: Persist and hydrate the single authorization record

**Requirement:** JUS-P0-02, INV-03, INV-04, INV-12, Design §4.2, §4.4, §5.2.

**Files:**

- Modify: `src/core/atomic-persistence.ts`
- Create: `src/core/plan-authorization.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/hooks/plan-bridge.ts`
- Test: `tests/core/atomic-persistence.test.ts`
- Test: `tests/core/plan-authorization.test.ts`
- Test: `tests/hooks/plan-bridge-authorization.test.ts`
- Test: `tests/core/justice-plugin.test.ts`

**Consumes:** the existing `AtomicPersistence.loadWithLock()` default contract, where `ENOENT`, an existing blank file, and parse/deserialize failures become `emptyValue()` while non-ENOENT read I/O failures still throw; the Design §4.2 requirement for strict authoritative Authorization reads; `AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>`; `CanonicalPlanSnapshot`; `PlanFingerprint`; Task 2.1's `buildCanonicalSnapshot(planContent, approvedTaskIds)` and `computePlanFingerprint(planContent, approvedTaskIds)`; approval-time `PlanParser.parse(planContent).map((task) => task.id)`; and the approved task IDs persisted in `binding.canonicalSnapshot.tasks.map((task) => task.taskId)` as the validation-time approved task set. `restoreActivePlans()` must not derive a replacement approval task set from `PlanParser.parse(planContent)`.

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
`AuthorizationRestorationOutcome = "authoritative" | "uncertain"`; and
`AuthorizationReviewBoundary`; `createAuthorizationReviewBoundary(): AuthorizationReviewBoundary`; and the
domain-private `mergeAuthorizationBindings(mine: ReadonlyArray<ApprovedPlanBinding>,
theirs: ReadonlyArray<ApprovedPlanBinding>): ReadonlyArray<ApprovedPlanBinding>` used only as this
store's `AtomicPersistence.merge` hook. It is exported from this source module only so its array
contract can be tested; it is not re-exported by a package barrel and is not a public Justice API. It also
produces public boundary-acquiring `AuthorizationStore.release` / fingerprint invalidation operations and
their explicitly named `WithinAuthorizationReviewBoundary` counterparts:
`releaseWithinAuthorizationReviewBoundary(parentSessionId, authorizationId, at)` and
`invalidateForFingerprintWithinAuthorizationReviewBoundary(parentSessionId, authorizationId,
currentFingerprint, at)`, plus the focused
`invalidateMissingPlanWithinAuthorizationReviewBoundary(parentSessionId, authorizationId, at)`. The latter
is only for confirmed missing plan files: it does not take a sentinel fingerprint, does not change
`planPath`, and produces an invalidated binding without `invalidationReason`. It produces one injected
`AuthorizationReviewBoundary` shared by the Authorization, PlanBridge,
review-dispatch, review-completion, and Gate domains. `ApprovedPlanBinding.sessionId` and review
`parentSessionId` use the same boundary key; the boundary serializes the durable commit and all
dependent state changes, but is not a generic transaction or mutex framework. The PlanBridge owns the
active-plan cache; AuthorizationStore receives no PlanBridge instance. Its approval inner operation invokes
the injected `AuthorizationActivePlanReconciler` according to the callback matrix below. The callback never
changes the approval return semantics. The task also produces one narrow optional
`AtomicPersistenceConfig.strictReadValidation` opt-in, with omitted/`false` preserving the existing
fail-open malformed-payload behavior; only `AuthorizationStore` enables it. No generic persistence policy,
error taxonomy, validator registry, or separate authorization persistence implementation is introduced.

| outcome | save | `reconcileActivePlan` | `approve()` | cache / arm behavior |
| --- | --- | --- | --- | --- |
| initial authoritative read failure | save しない | 呼ばない | `null` | existing cache を変更せず、arm しない |
| save exception / `conflict_diverted` | authoritative success ではない | 呼ばない | `null` | requested candidate を publish せず、existing cache を変更しない |
| save 成功 + post-save reread 成功 + own fresh ID が winner | saved | active own binding を渡す | 同じ active binding | requested approval は arm してよい |
| save 成功 + post-save reread 成功 + own fresh ID が loser | saved | latest durable active winner、なければ `null` を渡す | `null` | requested loser plan を publish / arm しない |
| save 成功 + post-save reread 失敗 | saved | `null` を渡す | `null` | stale positive cache を clear し、requested plan を arm しない |

- [ ] **Step 1: Write the failing persistence and hydration tests**

First extend `tests/core/atomic-persistence.test.ts`. Keep the existing default corrupted-JSON
assertion unchanged so the generic persistence contract remains executable. Add focused strict-mode
coverage using the same injected mock file system:

```ts
it("treats only ENOENT as an absent state in strict mode", async () => {
  const strict = new AtomicPersistence(createMockFileReader({}), createMockFileWriter(), {
    ...config(),
    strictReadValidation: true,
  });

  await expect(strict.loadWithLock()).resolves.toEqual({
    data: [],
    lockMeta: { version: 0 },
  });
});

it("rejects an existing blank file in strict mode", async () => {
  const strict = new AtomicPersistence(
    createMockFileReader({ "state.json": "" }),
    createMockFileWriter(),
    { ...config(), strictReadValidation: true },
  );

  await expect(strict.loadWithLock()).rejects.toThrow();
});

it("rejects malformed JSON in strict mode", async () => {
  const strict = new AtomicPersistence(
    createMockFileReader({ "state.json": "{" }),
    createMockFileWriter(),
    { ...config(), strictReadValidation: true },
  );

  await expect(strict.loadWithLock()).rejects.toThrow();
});

it("propagates domain deserialization failure in strict mode", async () => {
  const strict = new AtomicPersistence(
    createMockFileReader({
      "state.json": JSON.stringify({ version: 4, data: { invalid: true } }),
    }),
    createMockFileWriter(),
    {
      ...config(),
      strictReadValidation: true,
      deserialize: () => {
        throw new Error("invalid domain schema");
      },
    },
  );

  await expect(strict.loadWithLock()).rejects.toThrow("invalid domain schema");
});
```

The default compatibility test must continue to prove that an omitted
`strictReadValidation` still converts corrupted JSON to `emptyValue()` with version `0`.

The test module imports the Task 2.1 production functions directly and imports the
fingerprint module as a namespace only for the calculation-failure test. Keep the
existing test imports and add the following names where the Task 2.2 tests are
placed:

```ts
import { afterEach } from "vitest";
import { PlanParser } from "../../src/core/plan-parser";
import {
  buildCanonicalSnapshot,
  computePlanFingerprint,
} from "../../src/core/plan-fingerprint";
import * as planFingerprintModule from "../../src/core/plan-fingerprint";
```

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
  readonly nestedAcquiresFor: (parentSessionId: string) => number;
  readonly reset: () => void;
} {
  const boundary = createAuthorizationReviewBoundary();
  const acquires = new Map<string, number>();
  const nestedAcquires = new Map<string, number>();
  const active = new Map<string, number>();
  return {
    withParentSession: async (parentSessionId, operation) => {
      acquires.set(parentSessionId, (acquires.get(parentSessionId) ?? 0) + 1);
      if ((active.get(parentSessionId) ?? 0) > 0) {
        nestedAcquires.set(parentSessionId, (nestedAcquires.get(parentSessionId) ?? 0) + 1);
      }
      return boundary.withParentSession(parentSessionId, async () => {
        active.set(parentSessionId, (active.get(parentSessionId) ?? 0) + 1);
        try {
          return await operation();
        } finally {
          const remaining = (active.get(parentSessionId) ?? 1) - 1;
          if (remaining === 0) active.delete(parentSessionId);
          else active.set(parentSessionId, remaining);
        }
      });
    },
    acquiresFor: (parentSessionId) => acquires.get(parentSessionId) ?? 0,
    nestedAcquiresFor: (parentSessionId) => nestedAcquires.get(parentSessionId) ?? 0,
    reset: () => {
      acquires.clear();
      nestedAcquires.clear();
    },
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
    strictReadValidation: true,
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

async function approvePlanContent(
  store: AuthorizationStore,
  sessionId: string,
  planPath: string,
  planContent: string,
  approvedAt = "2026-09-05T00:00:00.000Z",
): Promise<Extract<ApprovedPlanBinding, { readonly status: "active" }>> {
  const approvedTaskIds = new PlanParser().parse(planContent).map((task) => task.id);
  const binding = await store.approve({
    sessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(planContent, approvedTaskIds),
    planFingerprint: computePlanFingerprint(planContent, approvedTaskIds),
    approvedAt,
  });
  if (binding === null || binding.status !== "active") {
    throw new Error("approval fixture did not produce an active binding");
  }
  return binding;
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

afterEach(() => {
  vi.restoreAllMocks();
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

it("rejects malformed authoritative persistence during hydration", async () => {
  await files.writeFile(".justice/authorizations.json", "{");

  await expect(store.hydrate()).rejects.toThrow();
});

it("rejects schema-invalid authoritative persistence during hydration", async () => {
  await files.writeFile(".justice/authorizations.json", JSON.stringify([{}]));

  await expect(store.hydrate()).rejects.toThrow("Invalid authorization binding array");
});

it("does not overwrite malformed authority during initial approval", async () => {
  const malformed = "{";
  await files.writeFile(".justice/authorizations.json", malformed);
  const writes = trackAuthorizationWrites(files);

  await expect(store.approve(input)).resolves.toBeNull();
  expect(writes.count()).toBe(0);
  await expect(files.readFile(".justice/authorizations.json")).resolves.toBe(malformed);
});

it("does not classify malformed authority as deterministic not_found", async () => {
  await files.writeFile(".justice/authorizations.json", "{");
  const writes = trackAuthorizationWrites(files);

  await expect(store.release("missing-id", "2026-09-05T00:00:00.000Z")).resolves.toEqual({
    kind: "failed",
  });
  expect(writes.count()).toBe(0);
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

it("invalidates a confirmed-missing startup plan inside one parent boundary", async () => {
  const files = new MockFileSystem();
  const boundary = tracedAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  bridge.setReviewDispatchCancellation(async () => undefined);
  const active = await store.approve(inputFor("s1", "docs/missing.md"));
  boundary.reset();

  await expect(bridge.restoreActivePlans()).resolves.toBe("authoritative");

  const durable = await store.findByAuthorizationId(active!.authorizationId);
  expect(durable).toMatchObject({ status: "invalidated" });
  expect(durable).toHaveProperty("invalidatedAt");
  expect(durable).not.toHaveProperty("invalidationReason");
  expect(bridge.getActivePlan("s1")).toBeNull();
  expect(boundary.acquiresFor("s1")).toBe(1);
  expect(boundary.nestedAcquiresFor("s1")).toBe(0);
});

it("restores an unchanged semantic startup plan only after current fingerprint validation", async () => {
  const plan = "## Task 1: approved\n- [ ] implement\n";
  const active = await approvePlanContent(store, "s1", "docs/existing.md", plan);
  await files.writeFile("docs/existing.md", plan);
  const bridge = createAuthorizationPlanBridge(files, store, boundary);

  await expect(bridge.restoreActivePlans()).resolves.toBe("authoritative");

  expect(bridge.getActivePlan("s1")).toBe("docs/existing.md");
  await expect(store.findByAuthorizationId(active!.authorizationId)).resolves.toMatchObject({
    status: "active",
  });
});

it("terminalizes a semantic startup fingerprint mismatch without restoring its cache", async () => {
  const approved = "## Task 1: approved\n- [ ] implement\n";
  const changed = "## Task 1: changed requirement\n- [ ] implement\n";
  const active = await approvePlanContent(store, "s1", "docs/changed.md", approved);
  await files.writeFile("docs/changed.md", changed);
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  bridge.setReviewDispatchCancellation(async () => undefined);

  await expect(bridge.restoreActivePlans()).resolves.toBe("authoritative");

  await expect(store.findByAuthorizationId(active!.authorizationId)).resolves.toMatchObject({
    status: "invalidated",
  });
  await expect(store.findByAuthorizationId(active!.authorizationId)).resolves.toHaveProperty(
    "invalidatedAt",
  );
  expect(bridge.getActivePlan("s1")).toBeNull();
});

it("retains startup authorization for an approved-task progress-only checkbox update", async () => {
  const approved = "## Task 1: approved\n- [ ] implement\n";
  const progressOnly = "## Task 1: approved\n- [x] implement\n";
  const active = await approvePlanContent(store, "s1", "docs/progress.md", approved);
  await files.writeFile("docs/progress.md", progressOnly);
  const bridge = createAuthorizationPlanBridge(files, store, boundary);

  await expect(bridge.restoreActivePlans()).resolves.toBe("authoritative");

  await expect(store.findByAuthorizationId(active!.authorizationId)).resolves.toMatchObject({
    status: "active",
  });
  expect(bridge.getActivePlan("s1")).toBe("docs/progress.md");
});

it("marks startup restoration uncertain without invalidating when the plan probe throws", async () => {
  const active = await store.approve(inputFor("s1", "docs/probe-error.md"));
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  files.fileExists = async () => {
    throw new Error("plan probe failed");
  };

  await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");

  await expect(store.findByAuthorizationId(active!.authorizationId)).resolves.toMatchObject({
    status: "active",
  });
  expect(bridge.getActivePlan("s1")).toBeNull();
});

it("marks startup restoration uncertain without mutation when fingerprint calculation fails", async () => {
  const plan = "## Task 1: approved\n- [ ] implement\n";
  const writes = trackAuthorizationWrites(files);
  const active = await approvePlanContent(store, "s1", "docs/fingerprint-error.md", plan);
  writes.reset();
  await files.writeFile("docs/fingerprint-error.md", plan);
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  vi.spyOn(planFingerprintModule, "computePlanFingerprint").mockImplementationOnce(() => {
    throw new Error("fingerprint calculation failed");
  });

  await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");

  await expect(store.findByAuthorizationId(active!.authorizationId)).resolves.toMatchObject({
    status: "active",
  });
  expect(bridge.getActivePlan("s1")).toBeNull();
  expect(writes.count()).toBe(0);
});

it("marks startup restoration uncertain when authoritative authorization hydration fails", async () => {
  const writes = trackAuthorizationWrites(files);
  const active = await store.approve(inputFor("s1", "docs/hydration-error.md"));
  writes.reset();
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  vi.spyOn(store, "hydrate").mockRejectedValueOnce(new Error("authorization hydration failed"));

  await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");

  expect(bridge.getActivePlan("s1")).toBeNull();
  expect(writes.count()).toBe(0);
  await expect(store.findByAuthorizationId(active!.authorizationId)).resolves.toMatchObject({
    status: "active",
  });
});

/*
 * Also add this test to tests/hooks/plan-bridge-authorization.test.ts using the real persistence
 * path rather than mocking AuthorizationStore.hydrate(). Keep the mocked hydration-failure test
 * above as coverage for PlanBridge's direct catch behavior. This test owns the
 * AtomicPersistence -> AuthorizationStore -> PlanBridge propagation and must not replace the
 * existing PlanBridge/Store wiring with a stub.
 */
it("returns uncertain for malformed authoritative authorization persistence", async () => {
  const files = new MockFileSystem();
  await files.writeFile(".justice/authorizations.json", "{");
  const boundary = createAuthorizationReviewBoundary();
  const store = new AuthorizationStore(files, files, boundary);
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  const writes = trackAuthorizationWrites(files);

  await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");
  expect(bridge.getActivePlan("s1")).toBeNull();
  expect(writes.count()).toBe(0);
});

it("does not restore authority when confirmed-missing invalidation cannot persist", async () => {
  const active = await store.approve(inputFor("s1", "docs/missing-save-failure.md"));
  const bridge = createAuthorizationPlanBridge(files, store, boundary);
  vi.spyOn(authorizationPersistenceOf(store), "saveAtomicWithLock").mockResolvedValueOnce({
    status: "conflict_diverted",
    retries: 3,
    conflictPath: ".justice/authorizations.conflict.json",
  });

  await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");

  expect(bridge.getActivePlan("s1")).toBeNull();
  await expect(store.findByAuthorizationId(active!.authorizationId)).resolves.toMatchObject({
    status: "active",
  });
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

Extend `tests/core/justice-plugin.test.ts` in the same RED phase with focused composition-root
regression tests. Keep the existing `refreshes the projection cache during initialization` and
`should call loadAll on TieredWisdomStore during initialize` tests unchanged and continue to run them.
The new tests use the existing `plugin.getPlanBridge()`, `plugin.getTieredWisdomStore()`, and
`plugin.getObservationHandler()` accessors with `vi.spyOn`:

- `plugin.initialize()` calls `restoreActivePlans()`, `TieredWisdomStore.loadAll()`, and
  `ObservationHandler.initializeProjectionCache()` when authorization restoration succeeds.
- A rejected `restoreActivePlans()` does not reject `plugin.initialize()` and does not prevent
  `TieredWisdomStore.loadAll()` or `ObservationHandler.initializeProjectionCache()` from running.

The test setup must use the same `JusticePlugin` production construction path as the existing tests.
The restoration spy is the only authorization-specific test double; it must not replace the existing
wisdom, telemetry, projection, notifier, or observation-handler wiring.

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

Run:

```sh
devcontainer exec --workspace-folder . bun run vitest run \
  tests/core/atomic-persistence.test.ts \
  tests/core/plan-authorization.test.ts \
  tests/hooks/plan-bridge-authorization.test.ts \
  tests/core/justice-plugin.test.ts
```

Before running RED, add only the compile-only typed scaffold required by the exact `AtomicPersistenceConfig`
`strictReadValidation` property, `AuthorizationStore`, `PlanBridge.setAuthorizationDependencies`, and
`PlanBridge.restoreActivePlans` signatures in **Produces**, and the new `JusticePlugin` tests if the new
module or methods do not yet exist. The scaffold is created after the tests are written, does not change
runtime read behavior, is not a fallback boundary, and is replaced by Step 3 before any commit. RED must
therefore fail on intended behavioral assertions rather than module resolution, constructor compile failure,
missing test helpers/imports, matcher misuse, accidental deletion of existing initialization, or a deadlock.
The expected result is:

```text
RED:
- all four test files compile after the typed scaffold is added;
- the existing default AtomicPersistence corruption behavior remains executable;
- strict ENOENT behavior remains green, while strict blank/malformed/schema-validation tests fail because
  the runtime strict opt-in is not implemented yet;
- the malformed Authorization hydrate test fails because corruption is currently converted to `[]`;
- the corrupt initial approval test fails because current code proceeds as if authority were empty;
- no RED is caused by an undefined helper, undefined module namespace, or invalid call-count matcher.
```

The intended behavioral failures are: default/strict AtomicPersistence read behavior, canonical snapshot
persistence/hydration, fresh-ID supersession,
terminal-dominant merge, same-parent approval serialization, real version-mismatch merge/retry, loser return
semantics, explicit PlanBridge cache wiring, failed-save non-publication, post-save reread failure fail-closed
behavior, unchanged semantic-plan restoration after fingerprint validation, semantic-mismatch durable
invalidation, progress-only fingerprint preservation, fingerprint and hydration uncertainty, confirmed-missing
durable invalidation without `plan_superseded`, plan-probe uncertainty, invalidation persistence uncertainty,
authorization restoration invocation, and restoration failure isolation from the existing plugin initialization
path. The Task 2.2 `Files` list above, this RED/GREEN command, and the Step 5 `git add` path set are consistent;
the `Files` list and `git add` scope contain the same eight paths, while the RED/GREEN command contains the same
four test paths. Task 2.1 modules are consumed dependencies and are not added to the Task 2.2 commit.

- [ ] **Step 3: Implement the authorization store**

First add the smallest strict-read opt-in to `src/core/atomic-persistence.ts`. Extend
`AtomicPersistenceConfig<T>` with exactly one optional setting:

```ts
readonly strictReadValidation?: boolean;
```

Keep the existing behavior when the setting is omitted or `false`: `ENOENT`, an existing blank
file, JSON parse failure, and deserialize failure return `emptyValue()` with lock version `0`,
while non-ENOENT read I/O errors still propagate. When it is `true`, keep `ENOENT` as the only
legitimate absent-state fallback, but throw for an existing blank file and rethrow the original
JSON parse or deserialize/validation failure. The setting must apply to every `loadWithLock()`
call, including the authoritative reread inside `saveAtomicWithLock()`; do not change the
generic default or add a persistence policy/error taxonomy abstraction.

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
unauthorized. `invalidateMissingPlanWithinAuthorizationReviewBoundary(parentSessionId, authorizationId, at)`
re-reads the authoritative array, exact-matches the authorization ID, requires the same parent and `active`
status, and performs exactly one `saveAtomicWithLock` that changes only that binding to `invalidated` with
`invalidatedAt: at`. It does not set `invalidationReason`, mutate `planPath`, acquire a boundary, update a
cache, or turn any terminal binding active. It returns the existing deterministic `not_found`, `wrong_parent`,
`already_terminal`, `failed`, or `uncertain` result as applicable; only `saved` is terminal success. On plugin
initialization, `AuthorizationStore.hydrate()` reads only the authoritative array and never treats the conflict
journal as authority. A hydrate read / parse / validation failure must propagate to `PlanBridge.restoreActivePlans()`;
it must not be converted to `[]` and then treated as an authoritative empty startup state. For each hydrated active
binding, `restoreActivePlans()` uses `PlanBridge.readPlanFile()` and, when content exists, computes the Task 2.1
canonical current fingerprint with `computePlanFingerprint(planContent, binding.canonicalSnapshot.tasks.map((task) => task.taskId))`
before any cache restoration. It must not derive a replacement task set by parsing the current plan. Only a
within-boundary `fingerprint_current` result followed by an exact same-parent, still-active authoritative reread restores
the cache. A mismatch uses `invalidateForFingerprintWithinAuthorizationReviewBoundary`, then cancellation and cache clear
inside that same parent boundary. `readPlanFile() === null` is confirmed missing and follows the focused invalidation
path; a thrown probe, hydrate failure, parser/canonicalization/approved-task mapping failure, fingerprint calculation
failure, or failed/uncertain invalidation returns `"uncertain"` without irreversible mutation unless a mismatch was
successfully terminalized. Terminal bindings and every uncertainty restore no active binding and permit no positive
authorization-dependent recovery. Do not add a transaction framework. `findByAuthorizationId` reads only the authoritative binding
array and returns the exact matching binding or `null`; callers treat `null`, a read failure, or a persistence
conflict as non-active. It must never read `.justice/authorizations.conflict.json` or infer authority from the
active-plan cache.

`AuthorizationStore.approve` is the boundary-external wrapper and keeps the public
`Promise<ApprovedPlanBinding | null>` signature. It acquires `AuthorizationReviewBoundary` once using
`input.sessionId`, then calls `approveWithinAuthorizationReviewBoundary` without acquiring again. The
PlanBridge path does not call this wrapper; it already owns the same parent boundary and passes its explicit
cache reconciler to the inner operation. The complete class body below is the implementation source of truth
for the approval, authoritative reread, and hydrate behavior.

`src/hooks/plan-bridge.ts` imports `computePlanFingerprint` from Task 2.1's
`src/core/plan-fingerprint.ts` and the shared `PlanFingerprint` type from `src/core/types.ts`. The startup
test module imports the same function as a module namespace only to make the required calculation-failure test
throw; production code receives no new fingerprint service or validation pipeline.

Add an explicit authorization dependency setter to the existing PlanBridge construction path so the existing
non-authorization constructor arguments remain unchanged while the production plugin wires the shared objects
exactly once. The setter is not a boundary factory or fallback: an implementation-arm request received before
this wiring is fail-closed and cannot arm, and authorization tests must call it before exercising approval.

```ts
export type AuthorizationRestorationOutcome = "authoritative" | "uncertain";

export type PlanBridgeAuthorizationDependencies = {
  readonly authorizationStore: AuthorizationStore;
  readonly authorizationReviewBoundary: AuthorizationReviewBoundary;
};

private authorizationDependencies: PlanBridgeAuthorizationDependencies | null = null;
private cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim:
  ((parentSessionId: string, authorizationId: string) => Promise<void>) | null = null;

setAuthorizationDependencies(dependencies: PlanBridgeAuthorizationDependencies): void {
  if (this.authorizationDependencies !== null) {
    throw new Error("PlanBridge authorization dependencies already configured");
  }
  this.authorizationDependencies = dependencies;
}

// Task 3.4 injects this exact within-boundary helper once. It is not a public cancellation wrapper.
setReviewDispatchCancellation(
  cancellation: (parentSessionId: string, authorizationId: string) => Promise<void>,
): void {
  if (this.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim !== null) {
    throw new Error("PlanBridge review-dispatch cancellation already configured");
  }
  this.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim = cancellation;
}

private reconcileActivePlan(
  parentSessionId: string,
  activeBinding: Extract<ApprovedPlanBinding, { readonly status: "active" }> | null,
): void {
  this.setActivePlan(parentSessionId, activeBinding?.planPath ?? null);
}

async restoreActivePlans(): Promise<AuthorizationRestorationOutcome> {
  const dependencies = this.authorizationDependencies;
  if (dependencies === null) return "authoritative";
  let bindings: readonly ApprovedPlanBinding[];
  try {
    bindings = await dependencies.authorizationStore.hydrate();
  } catch {
    return "uncertain";
  }
  for (const binding of bindings) {
    if (binding.status !== "active") continue;
    let planContent: string | null;
    try {
      planContent = await this.readPlanFile(binding.planPath);
    } catch {
      return "uncertain";
    }
    if (planContent !== null) {
      try {
        const restoration = await dependencies.authorizationReviewBoundary.withParentSession(
          binding.sessionId,
          async () => {
            let currentFingerprint: PlanFingerprint;
            try {
              const approvedTaskIds = binding.canonicalSnapshot.tasks.map((task) => task.taskId);
              currentFingerprint = computePlanFingerprint(planContent, approvedTaskIds);
            } catch {
              return "uncertain" as const;
            }
            const mutation = await dependencies.authorizationStore
              .invalidateForFingerprintWithinAuthorizationReviewBoundary(
                binding.sessionId,
                binding.authorizationId,
                currentFingerprint,
                new Date().toISOString(),
              );
            if (mutation.kind === "fingerprint_current") {
              const current = await dependencies.authorizationStore.findByAuthorizationId(binding.authorizationId);
              if (current?.status === "active" && current.sessionId === binding.sessionId) {
                this.reconcileActivePlan(binding.sessionId, current);
                return "current" as const;
              }
              this.reconcileActivePlan(binding.sessionId, null);
              return "uncertain" as const;
            }
            if (
              mutation.kind === "not_found" ||
              mutation.kind === "wrong_parent" ||
              mutation.kind === "already_terminal"
            ) {
              const latest = await dependencies.authorizationStore.findByAuthorizationId(binding.authorizationId);
              this.reconcileActivePlan(binding.sessionId, null);
              return latest === null || latest.status !== "active"
                ? ("terminalized" as const)
                : ("uncertain" as const);
            }
            if (mutation.kind !== "saved") {
              this.reconcileActivePlan(binding.sessionId, null);
              return "uncertain" as const;
            }
            const cancellation = this.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim;
            if (cancellation === null) {
              this.reconcileActivePlan(binding.sessionId, null);
              return "uncertain" as const;
            }
            try {
              await cancellation(binding.sessionId, binding.authorizationId);
            } catch {
              // The durable terminal remains authoritative; restart converges the cancelled tombstone.
            }
            this.reconcileActivePlan(binding.sessionId, null);
            return "terminalized" as const;
          },
        );
        if (restoration === "uncertain") return "uncertain";
      } catch {
        return "uncertain";
      }
      continue;
    }

    const mutation = await dependencies.authorizationReviewBoundary.withParentSession(
      binding.sessionId,
      async () => {
        const result = await dependencies.authorizationStore
          .invalidateMissingPlanWithinAuthorizationReviewBoundary(
            binding.sessionId,
            binding.authorizationId,
            new Date().toISOString(),
          );
        if (result.kind !== "saved") return result;
        const cancellation = this.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim;
        if (cancellation === null) {
          this.reconcileActivePlan(binding.sessionId, null);
          return { kind: "uncertain" };
        }
        try {
          await cancellation(binding.sessionId, binding.authorizationId);
        } catch {
          // The durable terminal remains authoritative; restart converges the cancelled tombstone.
        }
        this.reconcileActivePlan(binding.sessionId, null);
        return result;
      },
    );
    if (mutation.kind !== "saved") return "uncertain";
  }
  return "authoritative";
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
currentFingerprint, at)`, and `invalidateMissingPlanWithinAuthorizationReviewBoundary(parentSessionId,
authorizationId, at)`. Those inner operations re-read durable state, exact-match the authorization ID,
require `binding.sessionId === parentSessionId`, perform only their Authorization mutation, and never
acquire the boundary. Release changes only an active binding to `released`; fingerprint invalidation changes
only an active binding whose stored fingerprint differs from `currentFingerprint` to `invalidated`; missing-plan
invalidation changes an active binding proven missing by PlanBridge to `invalidated` without a reason. Missing,
wrong-parent, already-terminal, and unchanged-fingerprint cases are deterministic non-successes. Each inner
operation performs one `AtomicPersistence.saveAtomicWithLock` call; only `saved` returns a saved result,
while an exception returns `failed` and conflict diversion returns `uncertain`. Neither inner operation
updates a cache or restores a terminal binding to active.

PlanBridge's combined release, fingerprint invalidation, or startup confirmed-missing invalidation path acquires
the boundary once, calls the matching inner Authorization operation, requires its `saved` result, then calls
Task 3.4's within-boundary review-cancellation helper, clears the active-plan cache, and only then releases the
boundary. A non-saved terminal mutation returns the `uncertain` restoration outcome before cancellation or cache
publication. It must never call a public mutation wrapper while it already owns the boundary. A standalone
authorization recheck outside this boundary is never sufficient to authorize a later state change. On restart,
durable Authorization terminality and the observation log remain authoritative; the process-local boundary is
recreated empty.

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

// src/core/justice-plugin.ts -- fields added to the existing JusticePlugin class.
private readonly authorizationReviewBoundary: AuthorizationReviewBoundary;
private readonly authorizationStore: AuthorizationStore;
```

The field declarations above are additive. Do not remove or reorder the existing fields solely to
introduce authorization state, and do not replace the existing `JusticePlugin` constructor with a
standalone constructor snippet.

At the existing constructor construction point, preserve this exact order:

1. Keep the existing `fileReader` / `options` assignments, `TelemetryStore` construction, Wisdom metrics
   and persistence construction, `WisdomStore` / `TieredWisdomStore` construction, and
   `LoopDetectionHandler` construction unchanged.
2. Immediately after `this.loopHandler` has been constructed, call
   `createAuthorizationReviewBoundary()` exactly once and assign the result to
   `this.authorizationReviewBoundary`.
3. Construct exactly one production `AuthorizationStore(fileReader, fileWriter,
   this.authorizationReviewBoundary)` and assign it to `this.authorizationStore`.
4. Keep the existing `PlanBridge` construction at its current point and with its current arguments:

```ts
this.planBridge = new PlanBridge(
  fileReader,
  this.loopHandler,
  this.tieredWisdomStore,
  options.notifier,
  this.telemetry,
);
```

5. Immediately after that existing `PlanBridge` construction, inject the same production instances:

```ts
this.planBridge.setAuthorizationDependencies({
  authorizationStore: this.authorizationStore,
  authorizationReviewBoundary: this.authorizationReviewBoundary,
});
```

6. Continue with every existing constructor statement without deletion or replacement:
   `SessionStateProvider` construction; `TaskFeedbackHandler` construction with the existing
   `fileReader`, `fileWriter`, `tieredWisdomStore`, and `telemetry`; `CompactionProtector` construction;
   the full `ObservationHandler` construction with `ObservationLogStore`, `StateProjectionCache`,
   writer ID, workspace root, logger, and gate loader; the `loopHandler.setSessionRemovedCallback`
   callback; and the `taskFeedback.setObservationHandler`, `loopHandler.setObservationHandler`, and
   `planBridge.setObservationHandler` injections. Tasks 3.2, 3.4, and 3.6 reuse these same stored
   boundary and store instances and do not create a second boundary, a second authorization PlanBridge,
   or an implicit/test-only boundary.

The `initialize()` change is an additive integration into the existing method. Authorization restoration
has its own fail-open try/catch so an unexpected restoration exception cannot skip the existing Wisdom,
Telemetry, projection, or notifier path. The existing initialization try/catch and nested notifier
failure isolation remain in place:

```ts
async initialize(): Promise<void> {
  try {
    await this.planBridge.restoreActivePlans();
  } catch (error) {
    try {
      this.options.logger?.warn(`Failed to restore authorization during initialization: ${error}`);
    } catch {
      /* Ignore logging errors to preserve fail-open behavior */
    }
  }

  try {
    await this.tieredWisdomStore.loadAll();
    await this.telemetry.load();
    await this.observationHandler.initializeProjectionCache();
    try {
      await this.options.notifier?.notify({
        level: "info",
        variant: "atlas_orchestration",
        title: "Justice initialized",
        message: "OpenCode adapter initialization complete.",
      });
    } catch {
      /* Ignore notification errors to preserve fail-open behavior */
    }
  } catch (error) {
    try {
      this.options.logger?.warn(`Failed to load wisdom during initialization: ${error}`);
    } catch {
      /* Ignore logging errors to preserve fail-open behavior */
    }
  }
}
```

The two error paths are distinct: authorization restoration failure is logged and then the existing
initialization path still runs; an existing initialization failure uses the current outer logger guard;
and notifier failure remains isolated by its current nested catch. Do not introduce a startup framework,
generic lifecycle abstraction, or generic error-handling framework.

Task 3.6 later extends this same `JusticePlugin.initialize()` method; it must not replace this method or
rebuild the composition root. After authorization hydration and the existing
`observationHandler.initializeProjectionCache()` durable-record projection, Task 3.6 inserts
`recoverStagedReviewCompletionsAfterRestart`, then Task 3.4 inserts
`recoverReviewDispatchesAfterRestart`, in that order. The existing Wisdom, Telemetry, and notifier
statements and their error isolation remain wired; the two recovery calls are inserted between
`observationHandler.initializeProjectionCache()` and the existing notifier invocation. Task 3.6 replaces the
ignored restoration result with the local `authorizationRecoveryReady` boolean: authorization hydration and
durable record projection always run under their existing fail-open rules, while staged completion recovery and
review dispatch recovery run only for the authoritative outcome. The final startup sequence is authorization
hydration → durable record projection → staged completion recovery → review dispatch recovery, with no new
startup orchestrator abstraction.

Task 2.2 → Task 3.6 traceability for authoritative persistence is explicit: malformed or schema-invalid
`.justice/authorizations.json` → strict `AuthorizationStore.hydrate()` failure →
`restoreActivePlans() === "uncertain"` → `authorizationRecoveryReady = false` → base initialization
continues while staged-completion and Review Dispatch recovery are skipped. Task 3.6's direct
`restoreActivePlans()` mock tests retain the readiness-gate coverage; Task 2.2's real malformed-file
integration test owns the persistence-to-outcome link.

```ts
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
      strictReadValidation: true,
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
    const current = await this.authorizationPersistence.loadWithLock();
    return current.data;
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

  async invalidateMissingPlanWithinAuthorizationReviewBoundary(
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

Run:

```sh
devcontainer exec --workspace-folder . bun run vitest run \
  tests/core/atomic-persistence.test.ts \
  tests/core/plan-authorization.test.ts \
  tests/hooks/plan-bridge-authorization.test.ts \
  tests/core/justice-plugin.test.ts
```

Expected:

```text
GREEN:
- all Task 2.2 tests pass with no undefined test helpers/imports;
- default AtomicPersistence malformed-payload behavior remains unchanged;
- strict Authorization persistence distinguishes ENOENT from malformed, blank, and invalid payloads;
- malformed or schema-invalid Authorization hydration propagates failure;
- PlanBridge returns uncertain for malformed authoritative persistence and restores no positive cache;
- initial approval against malformed authority returns null and writes nothing;
- Authorization mutation does not classify malformed authority as deterministic `not_found`;
- unchanged semantic plans restore the active binding and cache only after fingerprint validation;
- semantic mismatch durably invalidates the binding, records invalidatedAt, clears the cache, and returns authoritative;
- progress-only checkbox changes retain Authorization and restore the cache;
- fingerprint-calculation uncertainty and hydration uncertainty perform zero startup Authorization writes,
  retain durable active authority, restore no cache, and return uncertain;
- confirmed-missing startup behavior remains authoritative only after durable invalidation and existing Review cancellation;
- existing JusticePlugin initialization remains GREEN, and the Task 3.4 terminal critical-section and Task 3.6
  startup-readiness contracts remain unchanged for their later integration tests.
```

Before Step 5, verify both traceability directions for Task 2.2: Design §5.2 current-fingerprint-before-cache,
same-parent terminalization, cancellation ordering, and uncertainty semantics each have a named test above; and
each startup test names the corresponding Design §5.2 contract and Task 2.1 canonical function. Also verify that
the Task 2.2 `Files` list and `git add` scope contain the same eight paths, and the RED/GREEN command contains the
same four test paths shown in this task.

- [ ] **Step 5: Commit after approval**

```bash
GIT_MASTER=1 git add \
  src/core/atomic-persistence.ts \
  src/core/plan-authorization.ts \
  src/core/justice-plugin.ts \
  src/hooks/plan-bridge.ts \
  tests/core/atomic-persistence.test.ts \
  tests/core/plan-authorization.test.ts \
  tests/hooks/plan-bridge-authorization.test.ts \
  tests/core/justice-plugin.test.ts
GIT_MASTER=1 git commit -m "feat: plan authorizationをdurable bindingへ置換"
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
GIT_MASTER=1 git add src/core/implement-command.ts src/core/types.ts src/runtime/opencode-adapter.ts src/hooks/plan-bridge.ts tests/core/implement-command.test.ts tests/runtime/opencode-adapter.test.ts tests/hooks/plan-bridge-authorization.test.ts
GIT_MASTER=1 git commit -m "feat: plan authorizationのcancelを追加"
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
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/opencode-plugin.ts`
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

Task 3.1 also owns the lifecycle-to-dispatch seam without importing Review Dispatch. Export the
following shared callback type from `src/core/types.ts`; Task 3.4 binds it to the single production
`reviewDispatchState` instance:

```ts
export type ReviewPendingCommittedHandler = (
  parentSessionId: string,
) => Promise<void>;
```

The lifecycle orchestrator accepts an optional `onReviewPendingCommitted` dependency and an optional
best-effort advisory writer. The callback receives only the durable parent session identity. It is
invoked after, and only after, the append returning `kind: "committed"` for `review_pending` or
`final_review_pending`; duplicate, invalid, and failed appends do not notify. A rejected callback
does not change the committed transition result and is converted to a swallowed advisory failure.
The two call sites are the `evidence_pending → review_pending` append in
`requestCurrentTaskReview` and the `all_tasks_accepted → final_review_pending` append in
`advanceFinalizationAfterAllTasksAccepted`.

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

it("notifies Review Dispatch once after a committed task review-pending transition", async () => {
  const onReviewPendingCommitted = vi.fn(async (_parentSessionId: string) => undefined);
  await runImplementationLifecycle(currentTask, { onReviewPendingCommitted });

  expect(onReviewPendingCommitted).toHaveBeenCalledTimes(1);
  expect(onReviewPendingCommitted).toHaveBeenCalledWith(currentTask.parentSessionId);
});

it("notifies Review Dispatch once after the committed final review-pending transition", async () => {
  const onReviewPendingCommitted = vi.fn(async (_parentSessionId: string) => undefined);
  await runFinalizationLifecycle(currentPlan, { onReviewPendingCommitted });

  expect(onReviewPendingCommitted).toHaveBeenCalledTimes(1);
  expect(onReviewPendingCommitted).toHaveBeenCalledWith(currentPlan.parentSessionId);
});

it("does not notify for failed or duplicate lifecycle appends", async () => {
  const onReviewPendingCommitted = vi.fn(async (_parentSessionId: string) => undefined);
  const lifecycle = createLifecycleTestHarness({ onReviewPendingCommitted });

  await lifecycle.appendReviewPending({ kind: "failed" });
  await lifecycle.appendReviewPending({ kind: "duplicate" });

  expect(onReviewPendingCommitted).not.toHaveBeenCalled();
});

it("keeps a committed transition when the notification callback fails", async () => {
  const onReviewPendingCommitted = vi.fn(async (_parentSessionId: string) => {
    throw new Error("offer failed");
  });
  const lifecycle = createLifecycleTestHarness({ onReviewPendingCommitted });

  await expect(lifecycle.appendReviewPending({ kind: "committed" })).resolves.toMatchObject({
    kind: "committed",
  });
  expect(lifecycle.advisories()).toContain("review_pending_offer_failed");
});

it.each(["task", "final"] as const)(
  "uses the stored callback for the actual %s PostToolUse lifecycle path",
  async (kind) => {
    const fixture = await arrangeObservationHandlerLifecycle(kind);
    const offer = vi.fn(async (_parentSessionId: string) => undefined);
    fixture.handler.setReviewPendingCommittedHandler(offer);

    await fixture.handler.handlePostToolUse(fixture.postToolUse);

    expect(offer).toHaveBeenCalledTimes(1);
    expect(offer).toHaveBeenCalledWith(fixture.parentSessionId);
    expect(fixture.durableReviewPendingTransition()).toHaveLength(1);
  },
);

it("keeps the actual durable lifecycle transition when the stored callback rejects", async () => {
  const fixture = await arrangeObservationHandlerLifecycle("task");
  fixture.handler.setReviewPendingCommittedHandler(async () => {
    throw new Error("offer failed");
  });

  await expect(fixture.handler.handlePostToolUse(fixture.postToolUse)).resolves.toEqual(PROCEED);

  expect(fixture.durableReviewPendingTransition()).toHaveLength(1);
  expect(fixture.durableAdvisories()).toContain("review_pending_offer_failed");
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

Use one non-throwing helper at the two lifecycle append sites that reach a review-pending state.
The helper receives only the durable `parentSessionId`, invokes the injected callback only after a
committed append, and preserves the append result when callback delivery fails:

```ts
type LifecycleAppendResult =
  | { readonly kind: "committed" }
  | { readonly kind: "failed" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "invalid"; readonly advisory: string };

type LifecycleNotificationDependencies = {
  readonly onReviewPendingCommitted?: ReviewPendingCommittedHandler;
  readonly recordAdvisory?: (advisory: string, cause?: unknown) => Promise<void>;
};

async function notifyReviewPendingCommitted(
  parentSessionId: string,
  dependencies: LifecycleNotificationDependencies,
): Promise<void> {
  if (dependencies.onReviewPendingCommitted === undefined) return;
  try {
    await dependencies.onReviewPendingCommitted(parentSessionId);
  } catch (cause: unknown) {
    try {
      await dependencies.recordAdvisory?.("review_pending_offer_failed", cause);
    } catch {
      // Advisory persistence is fail-open and must not hide the committed lifecycle transition.
    }
  }
}

async function appendReviewPendingAndNotify(
  parentSessionId: string,
  append: () => Promise<LifecycleAppendResult>,
  dependencies: LifecycleNotificationDependencies,
): Promise<LifecycleAppendResult> {
  const result = await append();
  if (result.kind === "committed") {
    await notifyReviewPendingCommitted(parentSessionId, dependencies);
  }
  return result;
}

// requestCurrentTaskReview: evidence_pending -> review_pending
return appendReviewPendingAndNotify(
  input.parentSessionId,
  () => appendLifecycleRecord({ kind: "task", ...reviewPendingTransition }),
  dependencies,
);

// advanceFinalizationAfterAllTasksAccepted: all_tasks_accepted -> final_review_pending
return appendReviewPendingAndNotify(
  input.parentSessionId,
  () => appendPlanFinalizationTransition({
    ...input,
    from: "all_tasks_accepted",
    to: "final_review_pending",
  }),
  dependencies,
);
```

`reviewPendingTransition` is the existing local record assembled by
`requestCurrentTaskReview`; the helper above adds no new public append API. The test-only
`createLifecycleTestHarness` must inject the same append result union and advisory writer used by
the production orchestrator, so the RED cases fail on missing callback invocation rather than on an
undefined test symbol. The existing `runImplementationLifecycle` and `runFinalizationLifecycle`
fixtures must expose `parentSessionId` and accept `LifecycleNotificationDependencies`.

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

Promote the existing composition-root `writerId` and `ObservationLogStore` locals to fields in this
task so later tasks can bind every domain to the same durable log. Replace only the current local
allocation; do not construct a second store in Task 3.4 or Task 3.6:

```ts
// src/core/justice-plugin.ts -- additive fields on the existing class
private readonly writerId: string;
private readonly observationLogStore: ObservationLogStore;

// At the existing ObservationLogStore construction point in the constructor:
this.writerId = options.writerId ?? generateWriterId();
this.observationLogStore = new ObservationLogStore(fileWriter, fileReader, this.writerId);

this.observationHandler = new ObservationHandler({
  logStore: this.observationLogStore,
  sessionStateProvider: this.sessionStateProvider,
  projectionCache: new StateProjectionCache(
    fileWriter,
    fileReader,
    ".justice/state.json",
    options.logger ?? console,
  ),
  writerId: this.writerId,
  workspaceRoot: options.workspaceRoot,
  logger: options.logger,
  gateLoader: new FileGateLoader(fileReader, undefined, options.logger ?? console),
});
```

The lifecycle handler receives `onReviewPendingCommitted` through its existing injected
dependencies. The handler's private field is the callback SSOT: Task 3.1 adds the following one-time
setter and derives a fresh dependency snapshot only when it calls a lifecycle operation. No constructor
dependency or second callback storage is retained:

```ts
private reviewPendingCommittedHandler?: ReviewPendingCommittedHandler;

setReviewPendingCommittedHandler(handler: ReviewPendingCommittedHandler): void {
  this.reviewPendingCommittedHandler = handler;
}

private lifecycleNotificationDependencies(): LifecycleNotificationDependencies {
  return {
    onReviewPendingCommitted: this.reviewPendingCommittedHandler,
    recordAdvisory: (advisory, cause) => this.appendLifecycleAdvisory(advisory, cause),
  };
}

private async appendLifecycleAdvisory(advisory: string, cause?: unknown): Promise<void> {
  void cause;
  try {
    const agentId: ObservationAgentId = "system";
    const sessionId = "lifecycle";
    await this.options.logStore.append(
      { agentId, sessionId, writerId: this.options.writerId },
      buildSessionErrorRecord({
        envelope: {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId,
          sessionId,
          writerId: this.options.writerId,
          recordType: "observation",
        },
        errorKind: "lifecycle_advisory",
        message: advisory,
      }),
    );
  } catch {
    // Advisory persistence must not change the already-committed lifecycle result.
  }
}

// In the real ObservationHandler PostToolUse lifecycle route. Each existing branch retains
// its input construction and passes this one snapshot only to its applicable operation.
const dependencies = this.lifecycleNotificationDependencies();
// Task-review branch:
await requestCurrentTaskReview(taskReviewInput, dependencies);
// All-tasks-accepted branch:
await advanceFinalizationAfterAllTasksAccepted(finalizationInput, dependencies);
```

`appendLifecycleAdvisory` uses the existing `ObservationLogStore.append()` and redaction path while
persisting only the advisory code, never the raw cause; it swallows its own failure. Task 3.4 calls this
setter after its state instance exists; Task 3.1 must
not construct a Review Dispatch state or a second authorization boundary. The Task 3.1 RED/GREEN
fixture above must exercise this actual `ObservationHandler.handlePostToolUse()` route rather than
passing an ad-hoc dependency directly to a lifecycle helper.

- [ ] **Step 4: Confirm GREEN**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-lifecycle.test.ts tests/core/session-state-provider.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit after approval**

```bash
GIT_MASTER=1 git add src/core/task-lifecycle.ts src/core/types.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/core/session-state-provider.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts tests/core/task-lifecycle.test.ts tests/core/v2/state-projection.test.ts tests/hooks/observation-handler-lifecycle.test.ts tests/core/session-state-provider.test.ts
GIT_MASTER=1 git commit -m "feat: lifecycle replayをidempotentに処理"
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
GIT_MASTER=1 git add src/core/acceptance-decision.ts src/core/v2/decision-model.ts src/core/v2/gate-definition.ts src/core/v2/default-gates.ts src/core/v2/gate-context.ts src/core/v2/rule-evaluation-engine.ts src/core/v2/state-projection.ts src/core/v2/persistence-redaction.ts src/runtime/validation.ts src/hooks/observation-handler.ts src/runtime/justice-tools.ts tests/core/v2/rule-evaluation-engine.test.ts tests/core/v2/gate-yaml-parser.test.ts tests/core/v2/gate-definition.test.ts tests/core/v2/default-gates.test.ts tests/core/acceptance-decision.test.ts tests/core/v2/state-projection.test.ts tests/core/v2/persistence-redaction.test.ts tests/runtime/validation.test.ts tests/runtime/gate-loader.test.ts tests/runtime/gate-yaml-injection.test.ts tests/hooks/observation-handler-gate.test.ts tests/core/rule-engine-determinism.test.ts tests/core/evidence-provenance.test.ts tests/core/v2/gate-provenance-gating.test.ts tests/runtime/justice-gate-tool.test.ts tests/core/observation-log-replay.test.ts tests/core/record-reference-resolution.test.ts tests/runtime/observation-log-integrity.test.ts tests/hooks/observation-handler-tool.test.ts tests/hooks/observation-handler-workflow-bootstrap.test.ts
GIT_MASTER=1 git commit -m "feat: Final Gateをplan scopeで評価"
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
GIT_MASTER=1 git add spikes/child-session-correlation/verify.ts spikes/child-session-correlation/README.md
GIT_MASTER=1 git commit -m "test: child session correlation runtime境界を検証"
```

### Task 3.3a: Prove the supported Linux Review Artifact provider before wiring

**Files:**

- Create `spikes/review-artifact-linux/probe.c`.
- Create `spikes/review-artifact-linux/verify.ts`.
- Replace `.devcontainer/Dockerfile` with the complete pinned-toolchain structure below; do not install an unpinned apt `rustc` or `cargo`.
- Preserve `.devcontainer/devcontainer.json`'s root execution contract: `remoteUser` must remain `root` during the hard gate and must not be changed to `bun`.
- Create `docs/agents/review-artifact-linux-provider.md` with the exact probe output and the supported deployment statement.
- Test `tests/runtime/review-artifact-linux-probe.test.ts`.

**Requirement:** F-045, F-047.

The probe is a hard gate, not a best-effort experiment. It must prove the exact primitives that the production provider will expose before Task 3.3b or Task 3.4 starts. The probe must not use `bun:ffi`, `realpath`-then-path-operation sequences, pathname-only `readFile`/`writeFile`, or a check-then-unlink cleanup fallback. The same task owns the supported host CLI provisioning: the built image must contain exactly `opencode-ai@1.18.29` in a root-readable shared global bin, and the image verification must fail if `opencode --version` is not exactly `1.18.29`.

**Implementation steps:**

Before compiling the probe, make the devcontainer provisioning match the pinned toolchain. The final
Dockerfile is not a partial insertion: it must use this complete structure, and it must not install
`rustc` or `cargo` from apt. The image intentionally ends as `root`: the repository's existing rootless
Docker bind mount maps the host user to container `root`, so switching to the image's `bun` account would
make `/workspace` and the host-mounted checkout non-writable. Toolchains are installed into shared,
root-owned, mode-0755 prefixes and are consumed by the same root process that runs `devcontainer exec`:

```dockerfile
FROM oven/bun:1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git sudo \
    && rm -rf /var/lib/apt/lists/*

ARG USERNAME=bun
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN set -eux; \
    if ! getent group "$USERNAME" >/dev/null; then groupadd --gid "$USER_GID" "$USERNAME"; fi; \
    if ! id -u "$USERNAME" >/dev/null 2>&1; then useradd --uid "$USER_UID" --gid "$USERNAME" -m "$USERNAME"; fi; \
    echo "$USERNAME ALL=(root) NOPASSWD:ALL" > "/etc/sudoers.d/$USERNAME"; \
    chmod 0440 "/etc/sudoers.d/$USERNAME"

WORKDIR /workspace
RUN chown -R "$USERNAME:$USERNAME" /workspace

ENV BUN_INSTALL=/opt/justice/bun
ENV RUSTUP_HOME=/opt/justice/rustup
ENV CARGO_HOME=/opt/justice/cargo
ENV PATH=/opt/justice/bun/bin:/opt/justice/cargo/bin:${PATH}

RUN install -d -o root -g root -m 0755 \
    "$BUN_INSTALL" "$RUSTUP_HOME" "$CARGO_HOME" \
    "$BUN_INSTALL/bin" "$CARGO_HOME/bin"

USER root
RUN bun add --global --exact opencode-ai@1.18.29
RUN test "$(whoami)" = "root" \
    && command -v opencode \
    && test "$(opencode --version)" = "1.18.29"

RUN curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs \
    | RUSTUP_HOME="$RUSTUP_HOME" CARGO_HOME="$CARGO_HOME" \
      sh -s -- -y --no-modify-path --profile minimal --default-toolchain 1.85.1
RUN rustup toolchain install 1.85.1 \
    --profile minimal \
    --component rustfmt \
    --component clippy \
    --target x86_64-unknown-linux-gnu \
    && rustup default 1.85.1 \
    && test "$(rustup show active-toolchain | cut -d' ' -f1)" = "1.85.1-x86_64-unknown-linux-gnu"

USER root
```

The existing `devcontainer.json` already selects `remoteUser: "root"`; retain that value. Replace the
complete file only if another change has overwritten it, and use this explicit selection so
`devcontainer exec` validates and runs the gate in the same root environment that owns `/opt/justice`:

```jsonc
{
  "name": "Justice Plugin Dev",
  "build": { "dockerfile": "Dockerfile" },
  "features": { "ghcr.io/devcontainers/features/common-utils:2": {} },
  "mounts": [
    "source=justice-node-modules,target=${containerWorkspaceFolder}/node_modules,type=volume"
  ],
  "postCreateCommand": "bun install --frozen-lockfile",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "vitest.explorer"
      ],
      "settings": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode"
      }
    }
  },
  "remoteUser": "root"
}
```

The exact `rust-toolchain.toml` created by Task 3.3b must repeat these values. Every Rust command must
run as `root` and must verify the toolchain token (rustup may append a source suffix for a directory
override). The CLI and workspace write checks must be in the same command, not merely in a Docker build
layer:

The OpenCode CLI is provisioned in this same Dockerfile layer, not downloaded by the runtime spike or
installed opportunistically during a test. `BUN_INSTALL=/opt/justice/bun`,
`RUSTUP_HOME=/opt/justice/rustup`, `CARGO_HOME=/opt/justice/cargo`, and
`PATH=/opt/justice/bun/bin:/opt/justice/cargo/bin:${PATH}` are the sole supported shared,
root-owned toolchain locations. `bun add --global --exact opencode-ai@1.18.29` plus the version
assertion above must fail the image build if the exact host CLI is unavailable. Task 3.3c consumes
this already-installed binary; it must not introduce a second installer, a floating OpenCode version,
a `/home/bun` runtime toolchain, a user-home global bin, or a host-version compatibility range.

```bash
test "$(whoami)" = "root"
test -w /workspace
probe="/workspace/.justice-write-probe.$$"
printf '%s' root > "$probe"
test "$(cat "$probe")" = "root"
rm -f "$probe"
command -v opencode
test "$(opencode --version)" = "1.18.29"
command -v rustup
command -v cargo
command -v rustc
test "$(rustup show active-toolchain | cut -d' ' -f1)" = "1.85.1-x86_64-unknown-linux-gnu"
rustc --version
cargo --version
```

Do not mix a root-installed rustup with `/home/bun` paths, do not set `remoteUser: "bun"`, and do not
treat a successful image-layer command as evidence for the bind-mounted root execution environment.
`BUN_INSTALL=/opt/justice/bun`, `RUSTUP_HOME=/opt/justice/rustup`, `CARGO_HOME=/opt/justice/cargo`,
and the exact `PATH` above are the only supported installation locations. The final image must not
download or install OpenCode/Rust from the runtime spike or a test.

1. Implement `probe.c` as a standalone Linux x86_64 program using `syscall(SYS_openat2, ...)`, `openat(2)`, `linkat(2)`, `renameat2(2)`, `fstat(2)`, `pread(2)`, `pwrite(2)`, and `unlinkat(2)`. It must open a supplied temporary workspace root as a directory descriptor, create `.justice/reviews`, `.justice/reviews/.leases`, and `.justice/reviews/.quarantine` beneath that descriptor, and never derive a trusted descriptor from a path resolved outside the root descriptor.
2. Configure every descendant open with `RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS`, plus `O_DIRECTORY`, `O_CLOEXEC`, and `O_NOFOLLOW` where applicable. Create the artifact leaf with `O_CREAT | O_EXCL | O_NOFOLLOW`, record its `st_dev`/`st_ino`, and create the private lease with `linkat(2)` before returning the reservation.
3. Exercise these cases in the probe: successful exclusive reservation; second reservation collision;
descriptor-relative write and read; final-component symlink; symlinked ancestor; ancestor replacement after
reservation; artifact replacement before cleanup; lease replacement before cleanup; root descriptor
close/reopen followed by `openExistingReservation`; reservation-local `renameat2(2)` quarantine; and a
post-verification quarantine-name replacement race; artifact-name replacement after artifact `fstat` but before lease construction; and lease-name replacement immediately after the identity-bound fd hard-link. The production-equivalent cleanup case MUST NOT call
`unlinkat(dirfd, verified_name)` after verification. The race case passes only when the replacement inode is
not deleted or overwritten and the outcome is fail-closed retention.
4. Implement `verify.ts` to compile the probe with
`cc -D_GNU_SOURCE -std=c11 -Wall -Wextra -Werror -O2`, execute it under a temporary directory, and emit one
JSON result with `provider`, `nativeApi`, `platform`, `kernel`, `status`, and one result for each case.
The only passing status is `status: "PASS"`. Missing `openat2(2)` / `renameat2(2)` still blocks the provider,
but absence of an identity-bound unlink-by-handle primitive is **not** a reason to use name-only unlink:
the supported behavior is `quarantine_retained`. The cleanup and reservation-creation race results must prove replacement deletion count zero, replacement overwrite count zero, retained replacement bytes, and no usable reservation from either reservation-creation race. For the reservation races, the probe records the replacement inode identity immediately after the test seam and compares the same named leaf identity and bytes after the production-equivalent failure path; unchanged inode identity proves no delete/recreate, unchanged bytes prove no overwrite. Do not add syscall interception or a generic fault registry.
5. Record the successful supported-environment output in `docs/agents/review-artifact-linux-provider.md`. Record the exact unsupported result and the user-visible `artifact_storage_unavailable` behavior as well; do not describe an unsupported runtime as a P0 exemption.

**Verification:**

```bash
devcontainer exec --workspace-folder . bash -lc 'test "$(whoami)" = "root" && test -w /workspace && probe="/workspace/.justice-write-probe.$$" && printf "%s" root > "$probe" && test "$(cat "$probe")" = root && rm -f "$probe" && command -v opencode && test "$(opencode --version)" = "1.18.29" && command -v rustup && command -v cargo && command -v rustc && test "$(rustup show active-toolchain | cut -d" " -f1)" = "1.85.1-x86_64-unknown-linux-gnu" && rustc --version && cargo --version'
devcontainer exec --workspace-folder . bun spikes/review-artifact-linux/verify.ts
devcontainer exec --workspace-folder . bun run test -- tests/runtime/review-artifact-linux-probe.test.ts
```

The first command must pass on the supported Linux x86_64 deployment. The second command must assert that a failed probe blocks provider publication and that no artifact path is handed to a worker. If the first command is `BLOCKED`, stop the implementation plan at this task and do not claim Phase 3 or JUS-P0-04 completion.

**Commit:**

```bash
GIT_MASTER=1 git add spikes/review-artifact-linux/probe.c spikes/review-artifact-linux/verify.ts .devcontainer/Dockerfile .devcontainer/devcontainer.json docs/agents/review-artifact-linux-provider.md tests/runtime/review-artifact-linux-probe.test.ts
GIT_MASTER=1 git commit -m "test: gate review artifact provider on Linux primitives"
```

### Task 3.3b: Implement the production LinuxOpenat2ReviewArtifactProvider

**Files:**

- Create `native/review-artifact-linux/Cargo.toml`.
- Create `native/review-artifact-linux/build.rs`.
- Create `native/review-artifact-linux/src/lib.rs`.
- Create `rust-toolchain.toml` with the pinned supported Rust toolchain used by the addon build.
- Modify `package.json` to add `@napi-rs/cli` and the `build:native:review-artifact` script.
- Modify `bun.lock` through the package manager after the package change.
- Modify `.github/workflows/ci.yml` to build and verify the supported Linux addon before addon-dependent tests.
- Modify `.github/workflows/release.yml` to build, inspect, publish, and upload a package that contains the exact addon.
- Create `src/runtime/linux-review-artifact-provider.ts`.
- Create `tests/runtime/linux-review-artifact-provider.test.ts`.
- Create `tests/runtime/linux-review-artifact-provider-security.test.ts`.

**Requirement:** JUS-P0-04, INV-21, Design §4.10, F-045, F-048.

The implementation must be the concrete provider named by the design: `LinuxOpenat2ReviewArtifactProvider`. The native crate package name is `justice_review_artifact_linux`, and the release build must produce `dist/native/justice_review_artifact_linux.linux-x64-gnu.node`. The TypeScript owner must load only that bundled addon on the supported deployment; it must not silently substitute a generic filesystem backend, `bun:ffi`, or a pathname-based implementation.

**Reservation namespace SSOT:** the existing durable `ReviewArtifactReservation.artifactId` is the reservation
identifier. The native ABI does not add a second reservation-id field: create, reopen, and cleanup derive the
same identifier from the validated artifact leaf `<artifactId>.json`. `cleanupExistingReservation(descriptor)` computes it once from
`descriptor.artifactPath` and passes the same validated artifact leaf scope and the same derived identifier
to both artifact and lease quarantine operations. This makes restart reconstruction deterministic from the
existing durable descriptor (`artifactPath`, `leasePath`, `artifactIdentity`) without adding a new durable ID.


**Cleanup reopen contract:** write/read and cleanup do not share the same reopen precondition.
`openExistingReservation(descriptor)` remains the strict write/read path and requires the original artifact
and lease leaves to exist and match `artifactIdentity`. Cleanup instead uses the narrow
`cleanupExistingReservation(descriptor)` N-API entry point. It validates the same durable descriptor,
reconstructs the safe artifact leaf, lease leaf, and existing durable `artifactId`, and enters the
reservation-local cleanup state machine without pre-opening the original pair. This is required because a
prior `cleanup_incomplete` may have already deleted one or both originals while leaving an identity-verified
quarantine residual. No pathname fallback, global namespace scan, weaker identity rule, generic reopen mode,
or new durable reservation ID is allowed.

**Pinned toolchain and package contract:**

```toml
# rust-toolchain.toml
[toolchain]
channel = "1.85.1"
profile = "minimal"
components = ["rustfmt", "clippy"]
targets = ["x86_64-unknown-linux-gnu"]
```

```toml
# native/review-artifact-linux/Cargo.toml
[package]
name = "justice_review_artifact_linux"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
libc = "=0.2.177"
napi = { version = "=3.12.2", default-features = false, features = ["napi8"] }
napi-derive = "=3.6.3"

[build-dependencies]
napi-build = "=2.4.1"
```

The package manager must add `"@napi-rs/cli": "3.2.0"` and the exact script
`"build:native:review-artifact": "bunx --no-install napi build --manifest-path native/review-artifact-linux/Cargo.toml --target x86_64-unknown-linux-gnu --output-dir dist/native --platform --release --no-js"`.
The lockfile must resolve that exact CLI version and the exact Cargo versions above.

**Native API:**

Expose these synchronous N-API functions and object methods, with `Buffer` used for artifact bytes and opaque reservation handles used for descriptor ownership:

```text
openReviewArtifactRoot(rootDir: string) -> ReviewArtifactRootHandle
ReviewArtifactRootHandle.createExclusiveMarker(artifactPath: string) -> ReservationHandle
ReviewArtifactRootHandle.openExistingReservation(descriptor: {
  artifactPath: string,
  leasePath: string,
  artifactIdentity: { device: string, inode: string }
}) -> ReservationHandle
ReviewArtifactRootHandle.writeExisting(reservation: ReservationHandle, bytes: Buffer) -> void
ReviewArtifactRootHandle.readOnce(reservation: ReservationHandle) -> Buffer
ReviewArtifactRootHandle.cleanupExistingReservation(descriptor: {
  artifactPath: string,
  leasePath: string,
  artifactIdentity: { device: string, inode: string }
}) -> CleanupResult
ReviewArtifactRootHandle.close() -> void
ReservationHandle.artifactIdentity() -> { device: string, inode: string }
ReservationHandle.leasePath() -> string
ReservationHandle.close() -> void
probeReviewArtifactCapabilities() -> {
  linux: boolean,
  x64: boolean,
  glibc: boolean,
  openat2: boolean,
  renameat2: boolean
}
```

`CleanupResult.status` is the exact `ReviewArtifactCleanupStatus` union from Design §4.10:
`"cleaned"`, `"quarantine_retained"`, `"replacement_retained"`, or `"cleanup_incomplete"`.
`"cleaned"` is allowed only when no reservation-owned original or quarantine leaf remains.
On the supported v4.0.0 Linux provider, a normal matching cleanup moves artifact and lease into the
reservation-local quarantine, verifies both identities and both absent originals, performs **no**
name-only `unlinkat`, and returns `"quarantine_retained"`. A target/quarantine replacement or restore
collision returns `"replacement_retained"`; an uncertain/partial state returns `"cleanup_incomplete"`.
`"quarantine_retained"` is terminal physical retention and is not an automatic retry signal.

The JavaScript descriptor is exactly `{ artifactPath, leasePath, artifactIdentity }`. Rust may keep
`artifact_path`, `lease_path`, and `artifact_identity` internally, but the N-API generated JavaScript
surface and declaration output must expose the camelCase names above. Verify the generated declaration and
the runtime call against the pinned `napi` version; if that version does not perform the required conversion,
use its explicit field-name mapping rather than changing the TypeScript adapter to snake_case. The direct
addon test below is the authoritative ABI check.

`openReviewArtifactRoot` is the only operation that accepts a host path. It must open and retain the
canonical workspace root descriptor. All subsequent paths are validated relative paths under
`.justice/reviews`; all opens are descriptor-relative `openat2(2)` operations with
`RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS`. `createExclusiveMarker` uses
`O_CREAT | O_EXCL | O_NOFOLLOW`, records `st_dev`/`st_ino`, and creates the private lease with `linkat(2)`.
`openExistingReservation` remains the strict write/read restart path. `cleanupExistingReservation` remains
the descriptor-only cleanup restart path and does not require the original pair to exist.

For cleanup, `renameat2(..., RENAME_NOREPLACE)` may move a currently matching artifact/lease into its
reservation-local quarantine, and `openat2`/`fstat` verifies the moved inode. The supported v4.0.0 Linux
primitive set does **not** provide an unlink operation that atomically targets that verified file descriptor:
`unlinkat(dirfd, name)` resolves the name again. Therefore the production cleanup path MUST NOT invoke
name-only `unlinkat` on a verified quarantine leaf. After both moved leaves and both absent original slots
are verified, the provider retains those quarantine leaves and returns `quarantine_retained`. Replacement
or restore collision remains `replacement_retained`; uncertainty remains `cleanup_incomplete`.
The quarantine is "private" only in the API/reservation-local sense; `0700` is not treated as a same-UID
process isolation boundary.

The provider object owns the root descriptor for the lifetime of the initialized
`OpenCodeAdapter`; `close()` is called by the adapter's teardown path when the host exposes one,
and the native process boundary closes the descriptor on process exit. No reservation handle may
outlive its root handle. Tests must call `close()` explicitly and assert that subsequent native
operations fail closed without touching the artifact or replacement path.

The Rust crate must use the exact manifest above. `build.rs` must call `napi_build::setup()`. The package script must invoke the exact target build:

```bash
bunx napi build --manifest-path native/review-artifact-linux/Cargo.toml --target x86_64-unknown-linux-gnu --output-dir dist/native --platform --release --no-js
```

- [ ] **Step 1: Write the failing native-provider tests**

Create `tests/runtime/linux-review-artifact-provider.test.ts` with the complete supported-path and
publication contract below. The helper builds only a trusted `ReviewArtifactReservation` from the
provider's marker result; it never fabricates inode identity or calls generic filesystem I/O for the
artifact.

```ts
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLinuxOpenat2ReviewArtifactProvider,
  isSupportedLinuxOpenat2Environment,
  type LinuxOpenat2RuntimeEnvironment,
} from "../../src/runtime/linux-review-artifact-provider";

type UsableReservation = {
  readonly status: "usable";
  readonly artifactId: string;
  readonly artifactPath: string;
  readonly leasePath: string;
  readonly artifactIdentity: { readonly device: string; readonly inode: string };
};
type NativeAddonForTest = {
  readonly openReviewArtifactRoot: (rootDir: string) => {
    readonly openExistingReservation: (descriptor: {
      readonly artifactPath: string;
      readonly leasePath: string;
      readonly artifactIdentity: { readonly device: string; readonly inode: string };
    }) => { readonly artifactIdentity: () => { readonly device: string; readonly inode: string }; readonly close: () => void };
    readonly cleanupExistingReservation: (descriptor: {
      readonly artifactPath: string;
      readonly leasePath: string;
      readonly artifactIdentity: { readonly device: string; readonly inode: string };
    }) => { readonly status: "cleaned" | "quarantine_retained" | "replacement_retained" | "cleanup_incomplete" };
    readonly close: () => void;
  };
};
const roots: string[] = [];

function loadBuiltReviewArtifactAddonForTest(): NativeAddonForTest {
  const addonPath = fileURLToPath(
    new URL("../../dist/native/justice_review_artifact_linux.linux-x64-gnu.node", import.meta.url),
  );
  return createRequire(import.meta.url)(addonPath) as NativeAddonForTest;
}

const unsupportedRuntimes = [
  { platform: "darwin", arch: "x64", glibc: true, openat2: true, renameat2: true },
  { platform: "linux", arch: "arm64", glibc: true, openat2: true, renameat2: true },
  { platform: "linux", arch: "x64", glibc: false, openat2: true, renameat2: true },
  { platform: "linux", arch: "x64", glibc: true, openat2: false, renameat2: true },
  { platform: "linux", arch: "x64", glibc: true, openat2: true, renameat2: false },
] as const satisfies readonly LinuxOpenat2RuntimeEnvironment[];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function arrangeProvider(): Promise<{
  readonly root: string;
  readonly provider: NonNullable<ReturnType<typeof createLinuxOpenat2ReviewArtifactProvider>>;
  readonly reservation: UsableReservation;
}> {
  const root = await mkdtemp(join(tmpdir(), "justice-review-artifact-"));
  roots.push(root);
  const provider = createLinuxOpenat2ReviewArtifactProvider(root);
  if (provider === undefined) throw new Error("supported Linux provider was not published");
  const artifactPath = ".justice/reviews/review-1.json";
  const marker = await provider.createExclusiveMarker(artifactPath);
  if (marker.kind !== "created") throw new Error("test artifact unexpectedly occupied");
  return {
    root,
    provider,
    reservation: {
      status: "usable",
      artifactId: "review-1",
      artifactPath,
      leasePath: marker.leasePath,
      artifactIdentity: marker.artifactIdentity,
    },
  };
}

async function replaceLeaf(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(root, relativePath);
  await unlink(absolutePath);
  await writeFile(absolutePath, content, "utf8");
}

describe("LinuxOpenat2ReviewArtifactProvider publication", () => {
  it.each(unsupportedRuntimes)(
    "publishes no capability for unsupported runtime %j",
    (runtime) => {
      expect(isSupportedLinuxOpenat2Environment(runtime)).toBe(false);
    },
  );

  it("publishes marker and reserved I/O only on the supported built-addon runtime", async () => {
    const fixture = await arrangeProvider();
    expect(fixture.provider.createExclusiveMarker).toBeTypeOf("function");
    expect(fixture.provider.reservedReviewArtifactIo).toBeDefined();
    fixture.provider.close();
  });
});

describe("LinuxOpenat2ReviewArtifactProvider operations", () => {
  it("creates one artifact/lease inode and reports the second create as occupied", async () => {
    const fixture = await arrangeProvider();
    const second = await fixture.provider.createExclusiveMarker(fixture.reservation.artifactPath);
    expect(second).toEqual({ kind: "occupied" });
    expect(fixture.reservation.leasePath).toContain(".justice/reviews/.leases/");
    fixture.provider.close();
  });

  it("writes and reads exact bytes through the same reservation", async () => {
    const fixture = await arrangeProvider();
    const io = fixture.provider.reservedReviewArtifactIo;
    await io.writeExisting(fixture.reservation, "{\"complete\":true}");
    await expect(io.readOnce(fixture.reservation)).resolves.toBe("{\"complete\":true}");
    fixture.provider.close();
  });

  it("reopens the root and rehydrates the durable reservation identity", async () => {
    const fixture = await arrangeProvider();
    await fixture.provider.reservedReviewArtifactIo.writeExisting(fixture.reservation, "durable");
    fixture.provider.close();

    const reopened = createLinuxOpenat2ReviewArtifactProvider(fixture.root);
    if (reopened === undefined) throw new Error("provider did not reopen");
    await expect(reopened.reservedReviewArtifactIo.readOnce(fixture.reservation)).resolves.toBe("durable");
    await replaceLeaf(fixture.root, fixture.reservation.artifactPath, "replacement");
    await expect(reopened.reservedReviewArtifactIo.readOnce(fixture.reservation)).rejects.toThrow();
    reopened.close();
  });

  it("passes the camelCase durable descriptor through the built N-API addon", async () => {
    const fixture = await arrangeProvider();
    fixture.provider.close();
    const addon = loadBuiltReviewArtifactAddonForTest();
    const root = addon.openReviewArtifactRoot(fixture.root);
    const handle = root.openExistingReservation({
      artifactPath: fixture.reservation.artifactPath,
      leasePath: fixture.reservation.leasePath,
      artifactIdentity: fixture.reservation.artifactIdentity,
    });
    expect(handle.artifactIdentity()).toEqual(fixture.reservation.artifactIdentity);
    handle.close();
    expect(typeof root.cleanupExistingReservation).toBe("function");
    expect(
      root.cleanupExistingReservation({
        artifactPath: fixture.reservation.artifactPath,
        leasePath: fixture.reservation.leasePath,
        artifactIdentity: fixture.reservation.artifactIdentity,
      }),
    ).toEqual({ status: "quarantine_retained" });
    root.close();
  });

  it("reopens the provider and cleans from the durable reservation descriptor", async () => {
    const fixture = await arrangeProvider();
    fixture.provider.close();

    const reopened = createLinuxOpenat2ReviewArtifactProvider(fixture.root);
    if (reopened === undefined) throw new Error("provider did not reopen");
    await expect(reopened.reservedReviewArtifactIo.cleanup(fixture.reservation)).resolves.toBe(
      "quarantine_retained",
    );
    reopened.close();
  });

  it("fails closed after close without mutating the artifact", async () => {
    const fixture = await arrangeProvider();
    fixture.provider.close();
    await expect(
      fixture.provider.reservedReviewArtifactIo.writeExisting(fixture.reservation, "must-not-write"),
    ).rejects.toThrow();
    await expect(readFile(join(fixture.root, fixture.reservation.artifactPath), "utf8")).resolves.toBe("");
  });
});
```

`loadBuiltReviewArtifactAddonForTest()` must load the exact bundled `.node` file with `createRequire()`;
it must not call the TypeScript provider, a mock addon, or a generic filesystem helper. This direct ABI
assertion complements the provider-level restart test and fails if NAPI-RS exposes `artifactPath` while the
adapter sends `artifact_path` (or the equivalent mismatch for `leasePath` / `artifactIdentity`).

Create `tests/runtime/linux-review-artifact-provider-security.test.ts` with the real filesystem race
and replacement cases below. These tests must run against the built addon, not a mock capability.

```ts
import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLinuxOpenat2ReviewArtifactProvider } from "../../src/runtime/linux-review-artifact-provider";

type UsableReservation = {
  readonly status: "usable";
  readonly artifactId: string;
  readonly artifactPath: string;
  readonly leasePath: string;
  readonly artifactIdentity: { readonly device: string; readonly inode: string };
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function arrangeSecurityFixture(): Promise<{
  readonly root: string;
  readonly provider: NonNullable<ReturnType<typeof createLinuxOpenat2ReviewArtifactProvider>>;
  readonly reservation: UsableReservation;
}> {
  const root = await mkdtemp(join(tmpdir(), "justice-review-artifact-security-"));
  roots.push(root);
  const provider = createLinuxOpenat2ReviewArtifactProvider(root);
  if (provider === undefined) throw new Error("supported Linux provider was not published");
  const artifactPath = ".justice/reviews/security.json";
  const marker = await provider.createExclusiveMarker(artifactPath);
  if (marker.kind !== "created") throw new Error("test artifact unexpectedly occupied");
  return {
    root,
    provider,
    reservation: {
      status: "usable",
      artifactId: "security",
      artifactPath,
      leasePath: marker.leasePath,
      artifactIdentity: marker.artifactIdentity,
    },
  };
}

describe("LinuxOpenat2ReviewArtifactProvider security boundaries", () => {
  it("rejects final-leaf replacement before write or read", async () => {
    const fixture = await arrangeSecurityFixture();
    await unlink(join(fixture.root, fixture.reservation.artifactPath));
    await writeFile(join(fixture.root, fixture.reservation.artifactPath), "replacement", "utf8");
    await expect(
      fixture.provider.reservedReviewArtifactIo.writeExisting(fixture.reservation, "forged"),
    ).rejects.toThrow();
    await expect(fixture.provider.reservedReviewArtifactIo.readOnce(fixture.reservation)).rejects.toThrow();
    await expect(readFile(join(fixture.root, fixture.reservation.artifactPath), "utf8")).resolves.toBe(
      "replacement",
    );
    fixture.provider.close();
  });

  it("rejects artifact symlink replacement without touching the target", async () => {
    const fixture = await arrangeSecurityFixture();
    const outside = await mkdtemp(join(tmpdir(), "justice-review-artifact-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "target"), "outside", "utf8");
    await unlink(join(fixture.root, fixture.reservation.artifactPath));
    await symlink(join(outside, "target"), join(fixture.root, fixture.reservation.artifactPath));
    await expect(
      fixture.provider.reservedReviewArtifactIo.writeExisting(fixture.reservation, "forged"),
    ).rejects.toThrow();
    await expect(readFile(join(outside, "target"), "utf8")).resolves.toBe("outside");
    fixture.provider.close();
  });

  it("rejects lease symlink replacement without touching the target", async () => {
    const fixture = await arrangeSecurityFixture();
    const outside = await mkdtemp(join(tmpdir(), "justice-review-artifact-lease-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "target"), "outside", "utf8");
    await unlink(join(fixture.root, fixture.reservation.leasePath));
    await symlink(join(outside, "target"), join(fixture.root, fixture.reservation.leasePath));
    await expect(
      fixture.provider.reservedReviewArtifactIo.writeExisting(fixture.reservation, "forged"),
    ).rejects.toThrow();
    await expect(readFile(join(outside, "target"), "utf8")).resolves.toBe("outside");
    fixture.provider.close();
  });

  it("keeps an ancestor swap anchored to the original directory descriptor", async () => {
    const fixture = await arrangeSecurityFixture();
    const outside = await mkdtemp(join(tmpdir(), "justice-review-artifact-ancestor-"));
    roots.push(outside);
    await writeFile(join(outside, "security.json"), "outside", "utf8");
    const reviews = join(fixture.root, ".justice", "reviews");
    await rename(reviews, `${reviews}.original`);
    await symlink(outside, reviews);
    await expect(fixture.provider.reservedReviewArtifactIo.readOnce(fixture.reservation)).resolves.toBe("");
    await expect(
      fixture.provider.reservedReviewArtifactIo.writeExisting(fixture.reservation, "inside"),
    ).resolves.toBeUndefined();
    await expect(readFile(join(`${reviews}.original`, "security.json"), "utf8")).resolves.toBe("inside");
    await expect(readFile(join(outside, "security.json"), "utf8")).resolves.toBe("outside");
    fixture.provider.close();
  });

  it("retains and restores a replacement during identity-safe cleanup", async () => {
    const fixture = await arrangeSecurityFixture();
    await unlink(join(fixture.root, fixture.reservation.artifactPath));
    await writeFile(join(fixture.root, fixture.reservation.artifactPath), "replacement", "utf8");
    await expect(fixture.provider.reservedReviewArtifactIo.cleanup(fixture.reservation)).resolves.toBe(
      "replacement_retained",
    );
    await expect(readFile(join(fixture.root, fixture.reservation.artifactPath), "utf8")).resolves.toBe(
      "replacement",
    );
    await expect(readdir(join(fixture.root, ".justice", "reviews", ".quarantine"))).resolves.toEqual([]);
    fixture.provider.close();
  });

  it("retains a lease replacement and never deletes its replacement bytes", async () => {
    const fixture = await arrangeSecurityFixture();
    await unlink(join(fixture.root, fixture.reservation.leasePath));
    await writeFile(join(fixture.root, fixture.reservation.leasePath), "lease-replacement", "utf8");
    await expect(fixture.provider.reservedReviewArtifactIo.cleanup(fixture.reservation)).resolves.toBe(
      "replacement_retained",
    );
    await expect(readFile(join(fixture.root, fixture.reservation.leasePath), "utf8")).resolves.toBe(
      "lease-replacement",
    );
    await expect(readFile(join(fixture.root, fixture.reservation.artifactPath), "utf8")).resolves.toBe("");
    fixture.provider.close();
  });
});
```

The deterministic native cleanup tests are part of the complete
`#[cfg(test)] mod cleanup_fault_tests` in the `lib.rs` listing below and MUST be materialized unchanged in
the RED scaffold before `cargo test` runs. The module defines reservation-local namespace inspection,
durable-descriptor reopen coverage, and the narrow post-verification replacement seam; there are no
illustrative or undefined fixture helpers.

The module contains these required behavioral tests:

- `normal_cleanup_retains_verified_quarantine_without_unlink`: a normal matching artifact/lease pair is
  moved to its reservation-local quarantine, both identities and absent original slots are verified, no
  physical quarantine unlink occurs, and the result is `quarantine_retained`.
- `post_verify_name_replacement_is_never_unlinked`: after quarantine identity verification completes, the
  test-only narrow seam replaces the same quarantine name with a different inode; cleanup performs zero
  physical delete, returns `quarantine_retained`, and the replacement bytes remain.
- `retained_quarantine_survives_root_reopen`: after `quarantine_retained`, the old root is closed and a new
  root consumes only the durable descriptor; it opens only the same reservation namespace and returns
  `quarantine_retained` without deleting retained leaves.
- `retained_quarantine_isolation_does_not_cross_reservations`: A and B each retain only their own
  reservation-local quarantine, and re-evaluating either reservation never opens the other's namespace.
- `cross_reservation_retention_isolation_survives_root_reopen`: reservation A is retained, the root is
  reopened, B is processed without opening A's namespace, then A is re-evaluated without opening B's
  namespace.

The equivalent TypeScript/native-provider coverage must use two durable `artifactId` identities reconstructed
from two validated artifact leaves. Any verification failure has delete count zero, and no test-only state is
exposed through N-API.

The two files above are the RED source. Before running RED, Step 1 must materialize a complete buildable
scaffold, not a prose placeholder. Use the complete `lib.rs` implementation listing in Step 3 as the source
for the scaffold, materialize it before RED, and replace only `writeExisting`, `readOnce`, and `cleanupExistingReservation`
with the deterministic unsupported-operation errors described below. This preserves the real N-API exports,
root descriptor ownership, exclusive marker, inode/lease identity, and restart ABI during RED while making
the RED assertions behavioral. The scaffold consists of these exact files and contracts:

```toml
# rust-toolchain.toml
[toolchain]
channel = "1.85.1"
profile = "minimal"
components = ["rustfmt", "clippy"]
targets = ["x86_64-unknown-linux-gnu"]
```

```toml
# native/review-artifact-linux/Cargo.toml
[package]
name = "justice_review_artifact_linux"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
libc = "=0.2.177"
napi = { version = "=3.12.2", default-features = false, features = ["napi8"] }
napi-derive = "=3.6.3"

[build-dependencies]
napi-build = "=2.4.1"
```

```rust
// native/review-artifact-linux/build.rs
fn main() {
    napi_build::setup();
}
```

`native/review-artifact-linux/src/lib.rs` must export every ABI member listed in the Native API block:
`NativeIdentity`, `NativeReservationDescriptor`, `NativeCleanupResult`, `NativeCapabilities`,
`NativeReviewArtifactRoot`, `NativeReservationHandle`, `openReviewArtifactRoot`, and
`probeReviewArtifactCapabilities`. The scaffold's root-open, directory-anchor, exclusive-marker,
`fstat` identity, hard-link lease, and `openExistingReservation` bodies must be the real descriptor-relative
Linux implementation used by the production provider. They must not fabricate an identity, use pathname
fallbacks, or return a fake successful handle. Only `writeExisting`, `readOnce`, and `cleanupExistingReservation` may return
the deterministic `artifact_storage_unavailable` error until Step 3 replaces those bodies. The capability
probe must report the actual `openat2(2)` / `renameat2(2)` availability; it must not return unconditional
success. The scaffold therefore can arrange the reservation fixture and exercise the ABI, while the RED
assertions fail on the intentionally unsupported operations rather than on module loading or setup.

The TypeScript scaffold must load only the bundled addon and expose the same camelCase JS surface as the
Native API. Its operation stubs are deterministic failures, never a generic filesystem fallback:

```ts
const addonPath = fileURLToPath(new URL(
  "../../dist/native/justice_review_artifact_linux.linux-x64-gnu.node",
  import.meta.url,
));

function loadNativeAddon(): NativeAddon | undefined {
  try {
    return createRequire(import.meta.url)(addonPath) as NativeAddon;
  } catch {
    return undefined;
  }
}

const unsupported = (operation: string): Error =>
  new Error(`artifact_storage_unavailable:${operation}`);

// createLinuxOpenat2ReviewArtifactProvider() must return undefined when the
// addon, capability probe, or root open is unavailable. When published, its
// marker callback delegates to createExclusiveMarker() and its reservation
// methods delegate to writeExisting/readOnce/cleanup without pathname I/O.
```

The package script must exist before RED:

```json
"build:native:review-artifact": "bunx --no-install napi build --manifest-path native/review-artifact-linux/Cargo.toml --target x86_64-unknown-linux-gnu --output-dir dist/native --platform --release --no-js"
```

Step 3 replaces only the deterministic unsupported operation bodies and completes the production
implementation in place. Every fixture must compile using only the planned public signatures and must fail
on behavior assertions, not on a missing symbol, malformed fixture, unsupported matcher, unavailable import,
or absent `.node` file. The test runner must load the built native addon for supported Linux cases;
unsupported publication is covered by the pure environment guard matrix and must not be silently skipped.

- [ ] **Step 2: Confirm RED**

Run:

```bash
devcontainer exec --workspace-folder . bash -lc 'test "$(whoami)" = "root" && test -w /workspace && command -v rustup && command -v cargo && command -v rustc && active_toolchain="$(rustup show active-toolchain)" && test "${active_toolchain%% *}" = "1.85.1-x86_64-unknown-linux-gnu"'
devcontainer exec --workspace-folder . bash -lc 'cargo test --manifest-path native/review-artifact-linux/Cargo.toml cleanup_fault_tests; cleanup_status=$?; cargo test --manifest-path native/review-artifact-linux/Cargo.toml reservation_creation_race_tests; reservation_status=$?; test "$cleanup_status" -ne 0 && test "$reservation_status" -ne 0'
devcontainer exec --workspace-folder . bun run build:native:review-artifact
devcontainer exec --workspace-folder . bun run vitest run tests/runtime/linux-review-artifact-provider.test.ts tests/runtime/linux-review-artifact-provider-security.test.ts
```

Expected RED is behavioral: the native test modules compile, the addon builds and loads, the
root/reservation fixtures succeed, and assertions for intentionally unsupported write/read/cleanup behavior fail.
The reservation-creation race module must compile and execute its production failure path; a sibling-private
helper error, malformed Markdown materialization, or skipped module is an invalid RED. A missing build, missing import, undefined symbol, invalid N-API binding, malformed
fixture, unsupported matcher, addon setup failure, or skipped supported-platform suite is an invalid RED and
must be fixed before implementation.

- [ ] **Step 3: Implement the production provider**

Implement the following files exactly. No pathname fallback, `bun:ffi`, generic storage abstraction, or
second provider is allowed.

**Native build files:**

```rust
// native/review-artifact-linux/build.rs
fn main() {
    napi_build::setup();
}
```

```rust
// native/review-artifact-linux/src/lib.rs
#![deny(unsafe_op_in_unsafe_fn)]

use std::ffi::CString;
use std::mem::size_of;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::sync::Mutex;

use libc::{c_int, c_long, c_uint, mode_t, off_t, stat, AT_FDCWD};
use napi::bindgen_prelude::Buffer;
use napi::{Error, Result, Status};
use napi_derive::napi;

const SYS_OPENAT2: c_long = 437;
const SYS_RENAMEAT2: c_long = 316;
const RESOLVE_NO_MAGICLINKS: u64 = 0x02;
const RESOLVE_NO_SYMLINKS: u64 = 0x04;
const RESOLVE_BENEATH: u64 = 0x08;
const OPEN_RESOLVE: u64 = RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS;
const RENAME_NOREPLACE: c_uint = 1;

#[repr(C)]
struct OpenHow {
    flags: u64,
    mode: u64,
    resolve: u64,
}

#[napi(object)]
pub struct NativeIdentity {
    pub device: String,
    pub inode: String,
}

#[napi(object)]
pub struct NativeReservationDescriptor {
    pub artifact_path: String,
    pub lease_path: String,
    pub artifact_identity: NativeIdentity,
}

#[napi(object)]
pub struct NativeCleanupResult {
    pub status: String,
}

#[napi(object)]
pub struct NativeCapabilities {
    pub linux: bool,
    pub x64: bool,
    pub glibc: bool,
    pub openat2: bool,
    pub renameat2: bool,
}

struct RootState {
    _root: OwnedFd,
    reviews: OwnedFd,
    leases: OwnedFd,
    quarantine_root: OwnedFd,
    #[cfg(test)]
    faults: CleanupFaults,
    #[cfg(test)]
    reservation_faults: ReservationCreationFaults,
}

#[napi]
pub struct NativeReservationHandle {
    root_token: u64,
    artifact_path: String,
    lease_path: String,
    identity: NativeIdentity,
}

enum RetentionReason {
    Replacement,
    Incomplete,
}

enum QuarantineOutcome {
    Moved(MovedQuarantineLeaf),
    AlreadyAbsent,
    Retained { reason: RetentionReason },
}

enum ExistingQuarantine {
    None,
    Matching(String),
    Replacement,
}

enum VerificationOutcome {
    Verified,
    ReplacementRetained,
    Incomplete,
}

struct MovedQuarantineLeaf {
    target_dir: RawFd,
    target_leaf: String,
    quarantine_dir: OwnedFd,
    quarantine_leaf: String,
}

#[cfg(test)]
#[derive(Default)]
struct CleanupFaults {
    replace_after_verify_label: Option<String>,
    opened_quarantine_namespaces: Vec<(String, String)>,
}

#[cfg(test)]
#[derive(Default)]
struct ReservationCreationFaults {
    replace_artifact_before_lease_link: bool,
    replace_lease_after_link: bool,
    replacement_identity: Option<NativeIdentity>,
}

#[napi]
impl NativeReservationHandle {
    #[napi]
    pub fn artifact_identity(&self) -> NativeIdentity {
        NativeIdentity { device: self.identity.device.clone(), inode: self.identity.inode.clone() }
    }

    #[napi]
    pub fn lease_path(&self) -> String {
        self.lease_path.clone()
    }

    #[napi]
    pub fn close(self) {}
}

#[napi]
pub struct NativeReviewArtifactRoot {
    root_token: u64,
    state: Mutex<Option<RootState>>,
}

#[napi]
impl NativeReviewArtifactRoot {
    #[napi]
    pub fn create_exclusive_marker(&self, artifact_path: String) -> Result<NativeReservationHandle> {
        let mut guard = self.lock_open()?;
        let state = guard
            .as_mut()
            .ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        let artifact_leaf = artifact_leaf(&artifact_path)?;
        let artifact_fd = openat2(
            state.reviews.as_raw_fd(),
            &artifact_leaf,
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
            OPEN_RESOLVE,
        )?;
        let identity = fstat_identity(artifact_fd.as_raw_fd())?;

        #[cfg(test)]
        if state.reservation_faults.replace_artifact_before_lease_link {
            state.reservation_faults.replace_artifact_before_lease_link = false;
            state.reservation_faults.replacement_identity = Some(
                replace_named_leaf_for_reservation_test(
                    state.reviews.as_raw_fd(),
                    &artifact_leaf,
                    b"artifact-replacement",
                )?,
            );
        }

        let lease_leaf = format!("{artifact_leaf}.lease");
        link_open_fd_to_name(&artifact_fd, state.leases.as_raw_fd(), &lease_leaf)?;

        #[cfg(test)]
        if state.reservation_faults.replace_lease_after_link {
            state.reservation_faults.replace_lease_after_link = false;
            state.reservation_faults.replacement_identity = Some(
                replace_named_leaf_for_reservation_test(
                    state.leases.as_raw_fd(),
                    &lease_leaf,
                    b"lease-replacement",
                )?,
            );
        }

        let current_artifact = openat2(
            state.reviews.as_raw_fd(),
            &artifact_leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
            OPEN_RESOLVE,
        )?;
        verify_identity(current_artifact.as_raw_fd(), &identity)?;

        let lease_fd = openat2(
            state.leases.as_raw_fd(),
            &lease_leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
            OPEN_RESOLVE,
        )?;
        verify_identity(lease_fd.as_raw_fd(), &identity)?;

        Ok(NativeReservationHandle {
            root_token: self.root_token,
            artifact_path,
            lease_path: format!(".justice/reviews/.leases/{lease_leaf}"),
            identity,
        })
    }

    #[napi]
    pub fn open_existing_reservation(
        &self,
        descriptor: NativeReservationDescriptor,
    ) -> Result<NativeReservationHandle> {
        let mut guard = self.lock_open()?;
        let state = guard
            .as_mut()
            .ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        let artifact_leaf = artifact_leaf(&descriptor.artifact_path)?;
        let lease_leaf = lease_leaf(&descriptor.lease_path)?;
        let artifact_fd = openat2(
            state.reviews.as_raw_fd(),
            &artifact_leaf,
            libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
            OPEN_RESOLVE,
        )?;
        let expected = descriptor.artifact_identity;
        let actual = fstat_identity(artifact_fd.as_raw_fd())?;
        if !same_identity(&actual, &expected) {
            return Err(error(Status::InvalidArg, "artifact_identity_mismatch", libc::EINVAL));
        }
        let lease_fd = openat2(
            state.leases.as_raw_fd(),
            &lease_leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
            OPEN_RESOLVE,
        )?;
        verify_identity(lease_fd.as_raw_fd(), &expected)?;
        Ok(NativeReservationHandle {
            root_token: self.root_token,
            artifact_path: descriptor.artifact_path,
            lease_path: descriptor.lease_path,
            identity: expected,
        })
    }

    #[napi]
    pub fn write_existing(&self, reservation: &NativeReservationHandle, bytes: Buffer) -> Result<()> {
        let mut guard = self.lock_open()?;
        let state = guard
            .as_mut()
            .ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        self.verify_handle(reservation)?;
        let (artifact_fd, _lease_fd) = open_reservation_pair(state, reservation)?;
        let length = i64::try_from(bytes.len()).map_err(|_| error(Status::InvalidArg, "content_too_large", libc::EFBIG))?;
        check_errno(unsafe { libc::ftruncate(artifact_fd.as_raw_fd(), length as off_t) }, "ftruncate")?;
        write_all(artifact_fd.as_raw_fd(), bytes.as_ref())?;
        Ok(())
    }

    #[napi]
    pub fn read_once(&self, reservation: &NativeReservationHandle) -> Result<Buffer> {
        let mut guard = self.lock_open()?;
        let state = guard
            .as_mut()
            .ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        self.verify_handle(reservation)?;
        let (artifact_fd, _lease_fd) = open_reservation_pair(state, reservation)?;
        let size = fstat_size(artifact_fd.as_raw_fd())?;
        let mut bytes = vec![0_u8; size];
        read_exact(artifact_fd.as_raw_fd(), &mut bytes)?;
        Ok(Buffer::from(bytes))
    }

    #[napi(js_name = "cleanupExistingReservation")]
    pub fn cleanup_existing_reservation(
        &self,
        descriptor: NativeReservationDescriptor,
    ) -> Result<NativeCleanupResult> {
        let mut guard = self.lock_open()?;
        let state = guard
            .as_mut()
            .ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        let NativeReservationDescriptor {
            artifact_path,
            lease_path,
            artifact_identity,
        } = descriptor;
        cleanup_descriptor(state, &artifact_path, &lease_path, &artifact_identity)
    }

    fn lock_open(&self) -> Result<std::sync::MutexGuard<'_, Option<RootState>>> {
        let guard = self
            .state
            .lock()
            .map_err(|_| error(Status::GenericFailure, "root_lock_poisoned", libc::EIO))?;
        if guard.is_none() {
            return Err(error(Status::GenericFailure, "root_closed", libc::EBADF));
        }
        Ok(guard)
    }

    fn verify_handle(&self, reservation: &NativeReservationHandle) -> Result<()> {
        if reservation.root_token != self.root_token {
            return Err(error(Status::InvalidArg, "root_closed", libc::EBADF));
        }
        Ok(())
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        let mut guard = self.state.lock().map_err(|_| error(Status::GenericFailure, "root_lock_poisoned", libc::EIO))?;
        *guard = None;
        Ok(())
    }
}

fn cleanup_descriptor(
    state: &mut RootState,
    artifact_path: &str,
    lease_path: &str,
    expected: &NativeIdentity,
) -> Result<NativeCleanupResult> {
    let artifact_leaf = artifact_leaf(artifact_path)?;
    let lease_leaf = lease_leaf(lease_path)?;
    let reservation_id = reservation_id_from_artifact_leaf(&artifact_leaf)?;
    let reviews_fd = state.reviews.as_raw_fd();
    let leases_fd = state.leases.as_raw_fd();

    let artifact = quarantine_one(
        state,
        reviews_fd,
        &artifact_leaf,
        expected,
        "artifact",
        &artifact_leaf,
        &reservation_id,
    );
    let lease = quarantine_one(
        state,
        leases_fd,
        &lease_leaf,
        expected,
        "lease",
        &artifact_leaf,
        &reservation_id,
    );

    let status = match (artifact, lease) {
        (QuarantineOutcome::Moved(artifact), QuarantineOutcome::Moved(lease)) => {
            cleanup_moved_pair(state, artifact, lease, expected)
        }
        (QuarantineOutcome::Moved(moved), QuarantineOutcome::Retained { reason }) => {
            restore_moved_after_peer_failure(moved, reason)
        }
        (QuarantineOutcome::Retained { reason }, QuarantineOutcome::Moved(moved)) => {
            restore_moved_after_peer_failure(moved, reason)
        }
        (
            QuarantineOutcome::Retained { reason: artifact_reason },
            QuarantineOutcome::Retained { reason: lease_reason },
        ) => match (artifact_reason, lease_reason) {
            (RetentionReason::Replacement, _) | (_, RetentionReason::Replacement) => {
                "replacement_retained"
            }
            _ => "cleanup_incomplete",
        },
        (QuarantineOutcome::AlreadyAbsent, QuarantineOutcome::AlreadyAbsent) => "cleaned",
        (QuarantineOutcome::AlreadyAbsent, QuarantineOutcome::Moved(moved)) => {
            cleanup_residual_leaf(state, moved, expected, "lease")
        }
        (QuarantineOutcome::Moved(moved), QuarantineOutcome::AlreadyAbsent) => {
            cleanup_residual_leaf(state, moved, expected, "artifact")
        }
        (
            QuarantineOutcome::AlreadyAbsent,
            QuarantineOutcome::Retained { reason },
        )
        | (
            QuarantineOutcome::Retained { reason },
            QuarantineOutcome::AlreadyAbsent,
        ) => match reason {
            RetentionReason::Replacement => "replacement_retained",
            RetentionReason::Incomplete => "cleanup_incomplete",
        },
    };
    Ok(NativeCleanupResult { status: status.to_string() })
}

#[napi(js_name = "openReviewArtifactRoot")]
pub fn open_review_artifact_root(root_dir: String) -> Result<NativeReviewArtifactRoot> {
    let root = open_root_directory(&root_dir)?;
    let justice = open_or_create_dir(&root, ".justice")?;
    let reviews = open_or_create_dir(&justice, "reviews")?;
    let leases = open_or_create_dir(&reviews, ".leases")?;
    let quarantine = open_or_create_dir(&reviews, ".quarantine")?;
    let token = random_token()?;
    Ok(NativeReviewArtifactRoot {
        root_token: token,
        state: Mutex::new(Some(RootState {
            _root: root,
            reviews,
            leases,
            quarantine_root: quarantine,
            #[cfg(test)]
            faults: CleanupFaults::default(),
            #[cfg(test)]
            reservation_faults: ReservationCreationFaults::default(),
        })),
    })
}

#[napi(js_name = "probeReviewArtifactCapabilities")]
pub fn probe_review_artifact_capabilities() -> Result<NativeCapabilities> {
    Ok(NativeCapabilities {
        linux: cfg!(target_os = "linux"),
        x64: cfg!(target_arch = "x86_64"),
        glibc: cfg!(target_env = "gnu"),
        openat2: probe_openat2(),
        renameat2: probe_renameat2(),
    })
}

fn artifact_leaf(path: &str) -> Result<String> {
    safe_leaf(path, ".justice/reviews/")
}

fn lease_leaf(path: &str) -> Result<String> {
    safe_leaf(path, ".justice/reviews/.leases/")
}

fn safe_leaf(path: &str, prefix: &str) -> Result<String> {
    let leaf = path
        .strip_prefix(prefix)
        .filter(|value| {
            !value.is_empty()
                && *value != "."
                && *value != ".."
                && !value.contains('/')
                && !value.contains('\\')
        })
        .ok_or_else(|| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    CString::new(leaf)
        .map(|_| leaf.to_string())
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))
}

fn open_reservation_pair(
    state: &RootState,
    reservation: &NativeReservationHandle,
) -> Result<(OwnedFd, OwnedFd)> {
    let artifact = artifact_leaf(&reservation.artifact_path)?;
    let lease = lease_leaf(&reservation.lease_path)?;
    let artifact_fd = openat2(
        state.reviews.as_raw_fd(),
        &artifact,
        libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
        OPEN_RESOLVE,
        )?;
    verify_identity(
        artifact_fd.as_raw_fd(),
        &reservation.identity,
    )?;
    let lease_fd = openat2(
        state.leases.as_raw_fd(),
        &lease,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
        OPEN_RESOLVE,
    )?;
    verify_identity(lease_fd.as_raw_fd(), &reservation.identity)?;
    Ok((artifact_fd, lease_fd))
}

fn openat2(
    dir: RawFd,
    path: &str,
    flags: c_int,
    mode: mode_t,
    resolve: u64,
) -> Result<OwnedFd> {
    let path = CString::new(path)
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let how = OpenHow { flags: flags as u64, mode: mode as u64, resolve };
    let result = unsafe {
        libc::syscall(
            SYS_OPENAT2,
            dir,
            path.as_ptr(),
            &how as *const OpenHow,
            size_of::<OpenHow>(),
        )
    };
    if result < 0 {
        return Err(error_for_errno("openat2", current_errno()));
    }
    let fd = c_int::try_from(result)
        .map_err(|_| error(Status::GenericFailure, "artifact_storage_unavailable", libc::EIO))?;
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn renameat2(from_dir: RawFd, from: &str, to_dir: RawFd, to: &str, flags: c_uint) -> Result<()> {
    let from = CString::new(from)
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let to = CString::new(to)
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let result = unsafe {
        libc::syscall(
            SYS_RENAMEAT2,
            from_dir,
            from.as_ptr(),
            to_dir,
            to.as_ptr(),
            flags,
        )
    };
    check_errno(result as c_int, "renameat2")
}

fn link_open_fd_to_name(source: &OwnedFd, to_dir: RawFd, to: &str) -> Result<()> {
    let empty = CString::new("")
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let to = CString::new(to)
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let direct = unsafe {
        libc::linkat(
            source.as_raw_fd(),
            empty.as_ptr(),
            to_dir,
            to.as_ptr(),
            libc::AT_EMPTY_PATH,
        )
    };
    if direct == 0 {
        return Ok(());
    }

    let direct_errno = current_errno();
    if direct_errno != libc::ENOENT {
        return Err(error_for_errno("linkat", direct_errno));
    }

    let proc_source = CString::new(format!("/proc/self/fd/{}", source.as_raw_fd()))
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let fallback = unsafe {
        libc::linkat(
            libc::AT_FDCWD,
            proc_source.as_ptr(),
            to_dir,
            to.as_ptr(),
            libc::AT_SYMLINK_FOLLOW,
        )
    };
    check_errno(fallback, "linkat")
}

#[cfg(test)]
fn replace_named_leaf_for_reservation_test(
    dir: RawFd,
    leaf: &str,
    replacement_bytes: &[u8],
) -> Result<NativeIdentity> {
    let token = random_token()?;
    let saved = format!("reservation-race-saved-{token:x}");
    renameat2(dir, leaf, dir, &saved, RENAME_NOREPLACE)?;
    let replacement = openat2(
        dir,
        leaf,
        libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0o600,
        OPEN_RESOLVE,
    )?;
    write_all(replacement.as_raw_fd(), replacement_bytes)?;
    fstat_identity(replacement.as_raw_fd())
}

fn unlinkat(dir: RawFd, path: &str, flags: c_int) -> Result<()> {
    let path = CString::new(path)
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let result = unsafe { libc::unlinkat(dir, path.as_ptr(), flags) };
    check_errno(result, "unlinkat")
}

fn fstat_identity(fd: RawFd) -> Result<NativeIdentity> {
    let mut value: stat = unsafe { std::mem::zeroed() };
    check_errno(unsafe { libc::fstat(fd, &mut value) }, "fstat")?;
    Ok(NativeIdentity { device: value.st_dev.to_string(), inode: value.st_ino.to_string() })
}

fn verify_identity(fd: RawFd, expected: &NativeIdentity) -> Result<()> {
    let actual = fstat_identity(fd)?;
    if same_identity(&actual, expected) {
        Ok(())
    } else {
        Err(error(Status::InvalidArg, "artifact_identity_mismatch", libc::EINVAL))
    }
}

fn same_identity(left: &NativeIdentity, right: &NativeIdentity) -> bool {
    left.device == right.device && left.inode == right.inode
}

fn identity_matches(fd: RawFd, expected: &NativeIdentity) -> Result<bool> {
    Ok(same_identity(&fstat_identity(fd)?, expected))
}

fn validate_quarantine_component(value: &str) -> Result<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || CString::new(value).is_err()
    {
        return Err(error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL));
    }
    Ok(())
}

fn validate_reservation_id(value: &str) -> Result<()> {
    validate_quarantine_component(value)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL));
    }
    Ok(())
}

fn reservation_id_from_artifact_leaf(artifact_leaf: &str) -> Result<String> {
    validate_quarantine_component(artifact_leaf)?;
    let artifact_id = artifact_leaf
        .strip_suffix(".json")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    validate_reservation_id(artifact_id)?;
    Ok(artifact_id.to_string())
}

fn open_reservation_quarantine(
    state: &mut RootState,
    safe_target_leaf: &str,
    reservation_id: &str,
) -> Result<OwnedFd> {
    validate_quarantine_component(safe_target_leaf)?;
    validate_reservation_id(reservation_id)?;

    #[cfg(test)]
    state
        .faults
        .opened_quarantine_namespaces
        .push((safe_target_leaf.to_string(), reservation_id.to_string()));

    let target_scope = open_or_create_dir(&state.quarantine_root, safe_target_leaf)?;
    open_or_create_dir(&target_scope, reservation_id)
}

fn quarantine_one(
    state: &mut RootState,
    target_dir: RawFd,
    target_leaf: &str,
    expected: &NativeIdentity,
    label: &str,
    safe_target_leaf: &str,
    reservation_id: &str,
) -> QuarantineOutcome {
    // Check the current target first. A pre-existing replacement must not create or
    // inspect a quarantine namespace.
    let current = match openat2(
        target_dir,
        target_leaf,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
        OPEN_RESOLVE,
    ) {
        Ok(fd) => Some(fd),
        Err(_) if current_errno() == libc::ENOENT => None,
        Err(_) => return QuarantineOutcome::Retained { reason: RetentionReason::Incomplete },
    };

    if let Some(current) = current.as_ref() {
        match identity_matches(current.as_raw_fd(), expected) {
            Ok(true) => {}
            Ok(false) => {
                return QuarantineOutcome::Retained { reason: RetentionReason::Replacement };
            }
            Err(_) => {
                return QuarantineOutcome::Retained { reason: RetentionReason::Incomplete };
            }
        }
    }

    let reservation_quarantine = match open_reservation_quarantine(
        state,
        safe_target_leaf,
        reservation_id,
    ) {
        Ok(directory) => directory,
        Err(_) => return QuarantineOutcome::Retained { reason: RetentionReason::Incomplete },
    };
    let existing_quarantine = match find_matching_quarantine(&reservation_quarantine, label, expected) {
        Ok(ExistingQuarantine::None) => None,
        Ok(ExistingQuarantine::Matching(leaf)) => Some(leaf),
        Ok(ExistingQuarantine::Replacement) => {
            return QuarantineOutcome::Retained { reason: RetentionReason::Replacement };
        }
        Err(_) => return QuarantineOutcome::Retained { reason: RetentionReason::Incomplete },
    };

    if current.is_none() {
        return match existing_quarantine {
            Some(quarantine_leaf) => QuarantineOutcome::Moved(MovedQuarantineLeaf {
                target_dir,
                target_leaf: target_leaf.to_string(),
                quarantine_dir: reservation_quarantine,
                quarantine_leaf,
            }),
            None => QuarantineOutcome::AlreadyAbsent,
        };
    }

    if existing_quarantine.is_some() {
        return QuarantineOutcome::Retained { reason: RetentionReason::Incomplete };
    }

    let token = match random_token() {
        Ok(token) => token,
        Err(_) => return QuarantineOutcome::Retained { reason: RetentionReason::Incomplete },
    };
    let quarantine_leaf = format!("{label}-{token:x}");
    if renameat2(
        target_dir,
        target_leaf,
        reservation_quarantine.as_raw_fd(),
        &quarantine_leaf,
        RENAME_NOREPLACE,
    )
    .is_err()
    {
        return QuarantineOutcome::Retained { reason: RetentionReason::Incomplete };
    }

    let quarantined = match openat2(
        reservation_quarantine.as_raw_fd(),
        &quarantine_leaf,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
        OPEN_RESOLVE,
    ) {
        Ok(fd) => fd,
        Err(_) => {
            let reason = match restore_quarantine(
                &reservation_quarantine,
                target_dir,
                target_leaf,
                &quarantine_leaf,
            ) {
                RestoreOutcome::Collision => RetentionReason::Replacement,
                RestoreOutcome::Restored | RestoreOutcome::Failed => RetentionReason::Incomplete,
            };
            return QuarantineOutcome::Retained { reason };
        }
    };
    let quarantine_matches = match identity_matches(quarantined.as_raw_fd(), expected) {
        Ok(matches) => matches,
        Err(_) => {
            let reason = match restore_quarantine(
                &reservation_quarantine,
                target_dir,
                target_leaf,
                &quarantine_leaf,
            ) {
                RestoreOutcome::Collision => RetentionReason::Replacement,
                RestoreOutcome::Restored | RestoreOutcome::Failed => RetentionReason::Incomplete,
            };
            return QuarantineOutcome::Retained { reason };
        }
    };
    if !quarantine_matches {
        let reason = match restore_quarantine(
            &reservation_quarantine,
            target_dir,
            target_leaf,
            &quarantine_leaf,
        ) {
            RestoreOutcome::Collision => RetentionReason::Replacement,
            RestoreOutcome::Restored | RestoreOutcome::Failed => RetentionReason::Incomplete,
        };
        return QuarantineOutcome::Retained { reason };
    }

    QuarantineOutcome::Moved(MovedQuarantineLeaf {
        target_dir,
        target_leaf: target_leaf.to_string(),
        quarantine_dir: reservation_quarantine,
        quarantine_leaf,
    })
}


fn find_matching_quarantine(
    reservation_quarantine: &OwnedFd,
    label: &str,
    expected: &NativeIdentity,
) -> Result<ExistingQuarantine> {
    let prefix = format!("{label}-");
    let mut matching: Option<String> = None;
    let mut saw_replacement = false;
    for leaf in read_directory_entries(reservation_quarantine.as_raw_fd())? {
        if !leaf.starts_with(&prefix) {
            continue;
        }
        let fd = match openat2(
            reservation_quarantine.as_raw_fd(),
            &leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
            OPEN_RESOLVE,
        ) {
            Ok(fd) => fd,
            Err(_) if current_errno() == libc::ENOENT => continue,
            Err(error) => return Err(error),
        };
        let actual = fstat_identity(fd.as_raw_fd())?;
        if same_identity(&actual, expected) {
            if matching.replace(leaf).is_some() {
                return Err(error(Status::GenericFailure, "cleanup_incomplete", libc::EIO));
            }
        } else {
            saw_replacement = true;
        }
    }
    if saw_replacement {
        return Ok(ExistingQuarantine::Replacement);
    }
    Ok(match matching {
        Some(leaf) => ExistingQuarantine::Matching(leaf),
        None => ExistingQuarantine::None,
    })
}

`open_reservation_quarantine` opens only
`.justice/reviews/.quarantine/<safe-target-leaf>/<reservation-id>` beneath the trusted root descriptor;
both components are validated before lookup. `find_matching_quarantine` sorts entries and applies the
fail-closed classification only inside that descriptor: exactly one expected-identity leaf is `Matching`,
two are `cleanup_incomplete`, any non-matching leaf with the same label is `Replacement`, and an unreadable
entry is `cleanup_incomplete`. It must never scan the global quarantine root or infer ownership from a name.
On the supported v4.0.0 provider, revalidation of a matching residual can return `quarantine_retained` but
does not authorize a later name-only unlink.

fn read_directory_entries(dir: RawFd) -> Result<Vec<String>> {
    let duplicate = unsafe { libc::fcntl(dir, libc::F_DUPFD_CLOEXEC, 0) };
    if duplicate < 0 {
        return Err(error_for_errno("fcntl", current_errno()));
    }
    let duplicate = unsafe { OwnedFd::from_raw_fd(duplicate) };
    let mut buffer = vec![0_u8; 8192];
    let mut entries = Vec::new();
    const DIRENT64_HEADER_SIZE: usize = size_of::<u64>() + size_of::<i64>() + size_of::<u16>() + size_of::<u8>();
    loop {
        let count = unsafe {
            libc::syscall(
                libc::SYS_getdents64,
                duplicate.as_raw_fd(),
                buffer.as_mut_ptr(),
                buffer.len(),
            )
        };
        if count == 0 {
            entries.sort_unstable();
            return Ok(entries);
        }
        if count < 0 {
            return Err(error_for_errno("getdents64", current_errno()));
        }
        let count = usize::try_from(count)
            .map_err(|_| error(Status::GenericFailure, "cleanup_incomplete", libc::EIO))?;
        let mut offset = 0_usize;
        while offset < count {
            if count - offset < DIRENT64_HEADER_SIZE {
                return Err(error(Status::GenericFailure, "cleanup_incomplete", libc::EIO));
            }
            let record_length = usize::from(u16::from_ne_bytes([
                buffer[offset + 16],
                buffer[offset + 17],
            ]));
            if record_length < DIRENT64_HEADER_SIZE || offset + record_length > count {
                return Err(error(Status::GenericFailure, "cleanup_incomplete", libc::EIO));
            }
            let name_bytes =
                &buffer[offset + DIRENT64_HEADER_SIZE..offset + record_length];
            let name_end = name_bytes
                .iter()
                .position(|byte| *byte == 0)
                .ok_or_else(|| error(Status::GenericFailure, "cleanup_incomplete", libc::EIO))?;
            let name = std::str::from_utf8(&name_bytes[..name_end])
                .map_err(|_| error(Status::GenericFailure, "cleanup_incomplete", libc::EILSEQ))?;
            if name != "." && name != ".." {
                entries.push(name.to_string());
            }
            offset += record_length;
        }
    }
}

enum RestoreOutcome {
    Restored,
    Collision,
    Failed,
}

fn restore_quarantine(quarantine_dir: &OwnedFd, target_dir: RawFd, target_leaf: &str, quarantine_leaf: &str) -> RestoreOutcome {
    match renameat2(
        quarantine_dir.as_raw_fd(),
        quarantine_leaf,
        target_dir,
        target_leaf,
        RENAME_NOREPLACE,
    ) {
        Ok(()) => RestoreOutcome::Restored,
        Err(_) if current_errno() == libc::EEXIST => RestoreOutcome::Collision,
        Err(_) => RestoreOutcome::Failed,
    }
}

fn verify_quarantine_leaf(
    state: &mut RootState,
    moved: &MovedQuarantineLeaf,
    expected: &NativeIdentity,
    label: &str,
) -> VerificationOutcome {
    let fd = match openat2(
        moved.quarantine_dir.as_raw_fd(),
        &moved.quarantine_leaf,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
        OPEN_RESOLVE,
    ) {
        Ok(fd) => fd,
        Err(_) => return VerificationOutcome::Incomplete,
    };
    if verify_identity(fd.as_raw_fd(), expected).is_err() {
        return VerificationOutcome::ReplacementRetained;
    }
    match target_is_absent(moved.target_dir, &moved.target_leaf) {
        Ok(true) => {}
        Ok(false) => return VerificationOutcome::ReplacementRetained,
        Err(_) => return VerificationOutcome::Incomplete,
    }

    #[cfg(test)]
    if state.faults.replace_after_verify_label.as_deref() == Some(label) {
        state.faults.replace_after_verify_label = None;
        if replace_verified_quarantine_for_test(moved, label).is_err() {
            return VerificationOutcome::Incomplete;
        }
    }
    #[cfg(not(test))]
    let _ = (state, label);

    VerificationOutcome::Verified
}

#[cfg(test)]
fn replace_verified_quarantine_for_test(
    moved: &MovedQuarantineLeaf,
    label: &str,
) -> Result<()> {
    let token = random_token()?;
    let saved_leaf = format!("race-saved-{label}-{token:x}");
    let replacement_leaf = format!("race-replacement-{label}-{token:x}");
    let replacement = openat2(
        moved.quarantine_dir.as_raw_fd(),
        &replacement_leaf,
        libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0o600,
        OPEN_RESOLVE,
    )?;
    write_all(replacement.as_raw_fd(), b"replacement-after-verify")?;

    renameat2(
        moved.quarantine_dir.as_raw_fd(),
        &moved.quarantine_leaf,
        moved.quarantine_dir.as_raw_fd(),
        &saved_leaf,
        RENAME_NOREPLACE,
    )?;
    if let Err(error) = renameat2(
        moved.quarantine_dir.as_raw_fd(),
        &replacement_leaf,
        moved.quarantine_dir.as_raw_fd(),
        &moved.quarantine_leaf,
        RENAME_NOREPLACE,
    ) {
        let _ = renameat2(
            moved.quarantine_dir.as_raw_fd(),
            &saved_leaf,
            moved.quarantine_dir.as_raw_fd(),
            &moved.quarantine_leaf,
            RENAME_NOREPLACE,
        );
        return Err(error);
    }
    Ok(())
}

fn restore_moved_after_peer_failure(
    moved: MovedQuarantineLeaf,
    peer_reason: RetentionReason,
) -> &'static str {
    let restore = restore_quarantine(
        &moved.quarantine_dir,
        moved.target_dir,
        &moved.target_leaf,
        &moved.quarantine_leaf,
    );
    match (peer_reason, restore) {
        (RetentionReason::Replacement, _) | (_, RestoreOutcome::Collision) => "replacement_retained",
        (_, RestoreOutcome::Failed) | (RetentionReason::Incomplete, RestoreOutcome::Restored) => "cleanup_incomplete",
    }
}

fn cleanup_moved_pair(
    state: &mut RootState,
    artifact: MovedQuarantineLeaf,
    lease: MovedQuarantineLeaf,
    expected: &NativeIdentity,
) -> &'static str {
    let artifact_verified = verify_quarantine_leaf(state, &artifact, expected, "artifact");
    let lease_verified = verify_quarantine_leaf(state, &lease, expected, "lease");
    match (artifact_verified, lease_verified) {
        (VerificationOutcome::Verified, VerificationOutcome::Verified) => "quarantine_retained",
        (artifact_result, lease_result) => {
            let replacement_detected = matches!(artifact_result, VerificationOutcome::ReplacementRetained)
                || matches!(lease_result, VerificationOutcome::ReplacementRetained);
            let artifact_restore = restore_quarantine(
                &artifact.quarantine_dir, artifact.target_dir, &artifact.target_leaf, &artifact.quarantine_leaf,
            );
            let lease_restore = restore_quarantine(
                &lease.quarantine_dir, lease.target_dir, &lease.target_leaf, &lease.quarantine_leaf,
            );
            if replacement_detected
                || matches!(artifact_restore, RestoreOutcome::Collision)
                || matches!(lease_restore, RestoreOutcome::Collision)
            {
                "replacement_retained"
            } else {
                "cleanup_incomplete"
            }
        }
    }
}

fn cleanup_residual_leaf(
    state: &mut RootState,
    moved: MovedQuarantineLeaf,
    expected: &NativeIdentity,
    label: &str,
) -> &'static str {
    match verify_quarantine_leaf(state, &moved, expected, label) {
        VerificationOutcome::Verified => "quarantine_retained",
        VerificationOutcome::ReplacementRetained => "replacement_retained",
        VerificationOutcome::Incomplete => "cleanup_incomplete",
    }
}


fn target_is_absent(target_dir: RawFd, target_leaf: &str) -> Result<bool> {
    match openat2(
        target_dir,
        target_leaf,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
        OPEN_RESOLVE,
    ) {
        Ok(_) => Ok(false),
        Err(_) if current_errno() == libc::ENOENT => Ok(true),
        Err(error) => Err(error),
    }
}

fn write_all(fd: RawFd, bytes: &[u8]) -> Result<()> {
    let mut written = 0_usize;
    while written < bytes.len() {
        let count = unsafe {
            libc::pwrite(
                fd,
                bytes[written..].as_ptr().cast(),
                bytes.len() - written,
                written as off_t,
            )
        };
        if count < 0 {
            return Err(error_for_errno("pwrite", current_errno()));
        }
        if count == 0 {
            return Err(error(Status::GenericFailure, "artifact_storage_unavailable", libc::EIO));
        }
        written += usize::try_from(count)
            .map_err(|_| error(Status::GenericFailure, "artifact_storage_unavailable", libc::EIO))?;
    }
    Ok(())
}

fn read_exact(fd: RawFd, bytes: &mut [u8]) -> Result<()> {
    let mut read = 0_usize;
    while read < bytes.len() {
        let count = unsafe {
            libc::pread(
                fd,
                bytes[read..].as_mut_ptr().cast(),
                bytes.len() - read,
                read as off_t,
            )
        };
        if count < 0 {
            return Err(error_for_errno("pread", current_errno()));
        }
        if count == 0 {
            return Err(error(Status::GenericFailure, "artifact_read_failed", libc::EIO));
        }
        read += usize::try_from(count)
            .map_err(|_| error(Status::GenericFailure, "artifact_read_failed", libc::EIO))?;
    }
    Ok(())
}

fn fstat_size(fd: RawFd) -> Result<usize> {
    let mut value: stat = unsafe { std::mem::zeroed() };
    check_errno(unsafe { libc::fstat(fd, &mut value) }, "fstat")?;
    if value.st_size < 0 {
        return Err(error(Status::GenericFailure, "artifact_read_failed", libc::EIO));
    }
    usize::try_from(value.st_size)
        .map_err(|_| error(Status::GenericFailure, "artifact_read_failed", libc::EFBIG))
}

fn open_root_directory(path: &str) -> Result<OwnedFd> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| error(Status::GenericFailure, "artifact_storage_unavailable", libc::EIO))?;
    let canonical = CString::new(canonical.as_os_str().as_bytes())
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let fd = unsafe { libc::open(canonical.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW) };
    if fd < 0 {
        return Err(error_for_errno("open_root", current_errno()));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn open_or_create_dir(parent: &OwnedFd, leaf: &str) -> Result<OwnedFd> {
    let leaf = CString::new(leaf)
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    let created = unsafe { libc::mkdirat(parent.as_raw_fd(), leaf.as_ptr(), 0o700) };
    if created < 0 && current_errno() != libc::EEXIST {
        return Err(error_for_errno("mkdirat", current_errno()));
    }
    let leaf = leaf
        .to_str()
        .map_err(|_| error(Status::InvalidArg, "artifact_path_invalid", libc::EINVAL))?;
    openat2(
        parent.as_raw_fd(),
        leaf,
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        0,
        OPEN_RESOLVE,
    )
}

fn random_token() -> Result<u64> {
    let mut token = 0_u64;
    let count = unsafe {
        libc::getrandom(
            (&mut token as *mut u64).cast(),
            size_of::<u64>(),
            0,
        )
    };
    if count == size_of::<u64>() as isize {
        Ok(token)
    } else {
        Err(error(Status::GenericFailure, "artifact_storage_unavailable", libc::EIO))
    }
}

fn probe_openat2() -> bool {
    let result = unsafe {
        libc::syscall(
            SYS_OPENAT2,
            AT_FDCWD,
            std::ptr::null::<libc::c_char>(),
            std::ptr::null::<OpenHow>(),
            0,
        )
    };
    if result >= 0 {
        return true;
    }
    let errno = current_errno();
    errno != libc::ENOSYS && errno != libc::EINVAL
}

fn probe_renameat2() -> bool {
    let result = unsafe {
        libc::syscall(
            SYS_RENAMEAT2,
            -1,
            std::ptr::null::<libc::c_char>(),
            -1,
            std::ptr::null::<libc::c_char>(),
            0,
        )
    };
    if result >= 0 {
        return true;
    }
    let errno = current_errno();
    errno != libc::ENOSYS && errno != libc::EINVAL
}

fn check_errno(result: c_int, operation: &str) -> Result<()> {
    if result < 0 {
        Err(error_for_errno(operation, current_errno()))
    } else {
        Ok(())
    }
}

fn current_errno() -> c_int {
    unsafe { *libc::__errno_location() }
}

fn error_for_errno(operation: &str, errno: c_int) -> Error {
    let code = match (operation, errno) {
        // `openat2` is O_EXCL only for marker creation; `linkat` is used only
        // for the corresponding lease creation. Other EEXIST values (notably
        // renameat2 quarantine collisions) remain storage/retention failures.
        ("openat2" | "linkat", libc::EEXIST) => "artifact_occupied",
        (_, libc::ENOENT) => "artifact_missing",
        (_, libc::EBADF) => "root_closed",
        (_, libc::EACCES | libc::EPERM) => "artifact_permission_denied",
        (_, libc::ELOOP | libc::EXDEV | libc::EINVAL | libc::ENOTDIR) => "artifact_path_invalid",
        _ => "artifact_storage_unavailable",
    };
    let status = match code {
        "artifact_missing" => Status::GenericFailure,
        "artifact_path_invalid" => Status::InvalidArg,
        "artifact_permission_denied" => Status::GenericFailure,
        _ => Status::GenericFailure,
    };
    error(status, code, errno)
}

fn error(status: Status, code: &str, errno: c_int) -> Error {
    Error::new(status, format!("{code}:{errno}"))
}

#[cfg(test)]
mod cleanup_fault_tests {
    use super::*;
    use std::path::PathBuf;

    struct NativeCleanupFixture {
        root_path: PathBuf,
        root: NativeReviewArtifactRoot,
        reservation: NativeReservationHandle,
    }

    struct TwoReservationCleanupFixture {
        root_path: PathBuf,
        root: NativeReviewArtifactRoot,
        first: NativeReservationHandle,
        second: NativeReservationHandle,
    }

    impl Drop for NativeCleanupFixture {
        fn drop(&mut self) {
            let _ = self.root.close();
            let _ = std::fs::remove_dir_all(&self.root_path);
        }
    }

    impl Drop for TwoReservationCleanupFixture {
        fn drop(&mut self) {
            let _ = self.root.close();
            let _ = std::fs::remove_dir_all(&self.root_path);
        }
    }

    fn create_test_root(label: &str) -> Result<(PathBuf, NativeReviewArtifactRoot)> {
        let path = std::env::temp_dir().join(format!("justice-review-artifact-{label}-{:x}", random_token()?));
        std::fs::create_dir(&path)
            .map_err(|_| error(Status::GenericFailure, "artifact_storage_unavailable", libc::EIO))?;
        let root = open_review_artifact_root(path.to_string_lossy().into_owned())?;
        Ok((path, root))
    }

    fn create_test_reservation(root: &NativeReviewArtifactRoot, artifact_id: &str) -> Result<NativeReservationHandle> {
        validate_reservation_id(artifact_id)?;
        root.create_exclusive_marker(format!(".justice/reviews/{artifact_id}.json"))
    }

    fn descriptor_for(reservation: &NativeReservationHandle) -> NativeReservationDescriptor {
        NativeReservationDescriptor {
            artifact_path: reservation.artifact_path.clone(),
            lease_path: reservation.lease_path.clone(),
            artifact_identity: reservation.artifact_identity(),
        }
    }

    fn cleanup_reservation(root: &NativeReviewArtifactRoot, reservation: &NativeReservationHandle) -> Result<NativeCleanupResult> {
        root.cleanup_existing_reservation(descriptor_for(reservation))
    }

    fn arrange_native_cleanup_fixture() -> Result<NativeCleanupFixture> {
        let (root_path, root) = create_test_root("single")?;
        let reservation = create_test_reservation(&root, "native-cleanup-a")?;
        Ok(NativeCleanupFixture { root_path, root, reservation })
    }

    fn arrange_two_reservation_cleanup_fixture() -> Result<TwoReservationCleanupFixture> {
        let (root_path, root) = create_test_root("pair")?;
        let first = create_test_reservation(&root, "native-cleanup-a")?;
        let second = create_test_reservation(&root, "native-cleanup-b")?;
        Ok(TwoReservationCleanupFixture { root_path, root, first, second })
    }

    fn reservation_namespace(reservation: &NativeReservationHandle) -> Result<(String, String)> {
        let safe_target_leaf = artifact_leaf(&reservation.artifact_path)?;
        let reservation_id = reservation_id_from_artifact_leaf(&safe_target_leaf)?;
        Ok((safe_target_leaf, reservation_id))
    }

    fn replace_after_verify_once(root: &NativeReviewArtifactRoot, label: &str) -> Result<()> {
        let mut guard = root.lock_open()?;
        let state = guard.as_mut().ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        state.faults.replace_after_verify_label = Some(label.to_string());
        Ok(())
    }

    fn take_opened_quarantine_namespaces(root: &NativeReviewArtifactRoot) -> Result<Vec<(String, String)>> {
        let mut guard = root.lock_open()?;
        let state = guard.as_mut().ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        Ok(std::mem::take(&mut state.faults.opened_quarantine_namespaces))
    }

    fn quarantine_entry_count(root: &NativeReviewArtifactRoot, reservation: &NativeReservationHandle, label: &str) -> Result<usize> {
        let (safe_target_leaf, reservation_id) = reservation_namespace(reservation)?;
        let mut guard = root.lock_open()?;
        let state = guard.as_mut().ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        let directory = open_reservation_quarantine(state, &safe_target_leaf, &reservation_id)?;
        let prefix = format!("{label}-");
        Ok(read_directory_entries(directory.as_raw_fd())?.into_iter().filter(|leaf| leaf.starts_with(&prefix)).count())
    }

    fn quarantine_leaf_contents(root: &NativeReviewArtifactRoot, reservation: &NativeReservationHandle, label: &str) -> Result<String> {
        let (safe_target_leaf, reservation_id) = reservation_namespace(reservation)?;
        let mut guard = root.lock_open()?;
        let state = guard.as_mut().ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        let directory = open_reservation_quarantine(state, &safe_target_leaf, &reservation_id)?;
        let prefix = format!("{label}-");
        let leaves: Vec<String> = read_directory_entries(directory.as_raw_fd())?
            .into_iter().filter(|leaf| leaf.starts_with(&prefix)).collect();
        if leaves.len() != 1 {
            return Err(error(Status::GenericFailure, "cleanup_incomplete", libc::EIO));
        }
        let fd = openat2(directory.as_raw_fd(), &leaves[0], libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0, OPEN_RESOLVE)?;
        let size = fstat_size(fd.as_raw_fd())?;
        let mut bytes = vec![0_u8; size];
        read_exact(fd.as_raw_fd(), &mut bytes)?;
        String::from_utf8(bytes).map_err(|_| error(Status::GenericFailure, "cleanup_incomplete", libc::EILSEQ))
    }

    fn target_exists(root: &NativeReviewArtifactRoot, reservation: &NativeReservationHandle) -> Result<(bool, bool)> {
        let artifact = artifact_leaf(&reservation.artifact_path)?;
        let lease = lease_leaf(&reservation.lease_path)?;
        let mut guard = root.lock_open()?;
        let state = guard.as_mut().ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        Ok((!target_is_absent(state.reviews.as_raw_fd(), &artifact)?, !target_is_absent(state.leases.as_raw_fd(), &lease)?))
    }

    fn assert_only_namespace_opened(opened: &[(String, String)], expected: &(String, String)) {
        assert!(!opened.is_empty());
        assert!(opened.iter().all(|namespace| namespace == expected));
    }

    #[test]
    fn normal_cleanup_retains_verified_quarantine_without_unlink() -> Result<()> {
        let fixture = arrange_native_cleanup_fixture()?;
        let result = cleanup_reservation(&fixture.root, &fixture.reservation)?;
        assert_eq!(result.status, "quarantine_retained");
        assert_eq!(target_exists(&fixture.root, &fixture.reservation)?, (false, false));
        assert_eq!(quarantine_entry_count(&fixture.root, &fixture.reservation, "artifact")?, 1);
        assert_eq!(quarantine_entry_count(&fixture.root, &fixture.reservation, "lease")?, 1);
        Ok(())
    }

    #[test]
    fn post_verify_name_replacement_is_never_unlinked() -> Result<()> {
        let fixture = arrange_native_cleanup_fixture()?;
        replace_after_verify_once(&fixture.root, "artifact")?;
        let result = cleanup_reservation(&fixture.root, &fixture.reservation)?;
        assert_eq!(result.status, "quarantine_retained");
        assert_eq!(target_exists(&fixture.root, &fixture.reservation)?, (false, false));
        assert_eq!(quarantine_leaf_contents(&fixture.root, &fixture.reservation, "artifact")?, "replacement-after-verify");
        assert_eq!(quarantine_entry_count(&fixture.root, &fixture.reservation, "lease")?, 1);
        Ok(())
    }

    #[test]
    fn retained_quarantine_survives_root_reopen() -> Result<()> {
        let fixture = arrange_native_cleanup_fixture()?;
        let durable = descriptor_for(&fixture.reservation);
        let expected_namespace = reservation_namespace(&fixture.reservation)?;
        assert_eq!(cleanup_reservation(&fixture.root, &fixture.reservation)?.status, "quarantine_retained");
        fixture.root.close()?;
        let reopened = open_review_artifact_root(fixture.root_path.to_string_lossy().into_owned())?;
        let _ = take_opened_quarantine_namespaces(&reopened)?;
        assert_eq!(reopened.cleanup_existing_reservation(durable)?.status, "quarantine_retained");
        assert_only_namespace_opened(&take_opened_quarantine_namespaces(&reopened)?, &expected_namespace);
        assert_eq!(quarantine_entry_count(&reopened, &fixture.reservation, "artifact")?, 1);
        assert_eq!(quarantine_entry_count(&reopened, &fixture.reservation, "lease")?, 1);
        reopened.close()?;
        Ok(())
    }

    #[test]
    fn retained_quarantine_isolation_does_not_cross_reservations() -> Result<()> {
        let fixture = arrange_two_reservation_cleanup_fixture()?;
        let first_namespace = reservation_namespace(&fixture.first)?;
        let second_namespace = reservation_namespace(&fixture.second)?;
        assert_eq!(cleanup_reservation(&fixture.root, &fixture.first)?.status, "quarantine_retained");
        let _ = take_opened_quarantine_namespaces(&fixture.root)?;
        assert_eq!(cleanup_reservation(&fixture.root, &fixture.second)?.status, "quarantine_retained");
        assert_only_namespace_opened(&take_opened_quarantine_namespaces(&fixture.root)?, &second_namespace);
        assert_eq!(quarantine_entry_count(&fixture.root, &fixture.first, "artifact")?, 1);
        let _ = take_opened_quarantine_namespaces(&fixture.root)?;
        assert_eq!(cleanup_reservation(&fixture.root, &fixture.first)?.status, "quarantine_retained");
        assert_only_namespace_opened(&take_opened_quarantine_namespaces(&fixture.root)?, &first_namespace);
        Ok(())
    }

    #[test]
    fn cross_reservation_retention_isolation_survives_root_reopen() -> Result<()> {
        let fixture = arrange_two_reservation_cleanup_fixture()?;
        let first_descriptor = descriptor_for(&fixture.first);
        let second_descriptor = descriptor_for(&fixture.second);
        let first_namespace = reservation_namespace(&fixture.first)?;
        let second_namespace = reservation_namespace(&fixture.second)?;
        assert_eq!(cleanup_reservation(&fixture.root, &fixture.first)?.status, "quarantine_retained");
        fixture.root.close()?;
        let reopened = open_review_artifact_root(fixture.root_path.to_string_lossy().into_owned())?;
        let _ = take_opened_quarantine_namespaces(&reopened)?;
        assert_eq!(reopened.cleanup_existing_reservation(second_descriptor)?.status, "quarantine_retained");
        assert_only_namespace_opened(&take_opened_quarantine_namespaces(&reopened)?, &second_namespace);
        assert_eq!(quarantine_entry_count(&reopened, &fixture.first, "artifact")?, 1);
        let _ = take_opened_quarantine_namespaces(&reopened)?;
        assert_eq!(reopened.cleanup_existing_reservation(first_descriptor)?.status, "quarantine_retained");
        assert_only_namespace_opened(&take_opened_quarantine_namespaces(&reopened)?, &first_namespace);
        reopened.close()?;
        Ok(())
    }
}

#[cfg(test)]
mod reservation_creation_race_tests {
    use super::*;
    use std::path::PathBuf;

    struct ReservationRaceFixture {
        root_path: PathBuf,
        root: NativeReviewArtifactRoot,
    }

    impl Drop for ReservationRaceFixture {
        fn drop(&mut self) {
            let _ = self.root.close();
            let _ = std::fs::remove_dir_all(&self.root_path);
        }
    }

    fn arrange_reservation_race_fixture(label: &str) -> Result<ReservationRaceFixture> {
        let root_path = std::env::temp_dir().join(format!(
            "justice-review-artifact-reservation-race-{label}-{:x}",
            random_token()?,
        ));
        std::fs::create_dir(&root_path)
            .map_err(|_| error(Status::GenericFailure, "artifact_storage_unavailable", libc::EIO))?;
        let root = open_review_artifact_root(root_path.to_string_lossy().into_owned())?;
        Ok(ReservationRaceFixture { root_path, root })
    }

    fn take_expected_replacement_identity(root: &NativeReviewArtifactRoot) -> Result<NativeIdentity> {
        let mut guard = root.lock_open()?;
        let state = guard
            .as_mut()
            .ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        state
            .reservation_faults
            .replacement_identity
            .take()
            .ok_or_else(|| error(Status::GenericFailure, "artifact_storage_unavailable", libc::EIO))
    }

    fn named_leaf_identity_for_reservation_test(
        root: &NativeReviewArtifactRoot,
        lease: bool,
        leaf: &str,
    ) -> Result<NativeIdentity> {
        let mut guard = root.lock_open()?;
        let state = guard
            .as_mut()
            .ok_or_else(|| error(Status::GenericFailure, "root_closed", libc::EBADF))?;
        let dir = if lease { state.leases.as_raw_fd() } else { state.reviews.as_raw_fd() };
        let fd = openat2(
            dir,
            leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
            OPEN_RESOLVE,
        )?;
        fstat_identity(fd.as_raw_fd())
    }

    #[test]
    fn artifact_name_replacement_before_lease_link_is_retained_and_never_usable() -> Result<()> {
        let fixture = arrange_reservation_race_fixture("artifact-replacement")?;
        {
            let mut guard = fixture.root.lock_open()?;
            let state = guard.as_mut().ok_or_else(|| {
                error(Status::GenericFailure, "root_closed", libc::EBADF)
            })?;
            state.reservation_faults.replace_artifact_before_lease_link = true;
        }
        let result = fixture.root.create_exclusive_marker(
            ".justice/reviews/reservation-artifact-race.json".to_string(),
        );
        assert!(result.is_err());
        let expected_replacement = take_expected_replacement_identity(&fixture.root)?;
        let current_replacement = named_leaf_identity_for_reservation_test(
            &fixture.root,
            false,
            "reservation-artifact-race.json",
        )?;
        assert!(same_identity(&expected_replacement, &current_replacement));
        assert_eq!(
            read_named_leaf_for_reservation_test(
                &fixture.root,
                false,
                "reservation-artifact-race.json",
            )?,
            b"artifact-replacement",
        );
        Ok(())
    }

    #[test]
    fn lease_name_replacement_after_fd_link_is_retained_and_never_usable() -> Result<()> {
        let fixture = arrange_reservation_race_fixture("lease-replacement")?;
        {
            let mut guard = fixture.root.lock_open()?;
            let state = guard.as_mut().ok_or_else(|| {
                error(Status::GenericFailure, "root_closed", libc::EBADF)
            })?;
            state.reservation_faults.replace_lease_after_link = true;
        }
        let result = fixture.root.create_exclusive_marker(
            ".justice/reviews/reservation-lease-race.json".to_string(),
        );
        assert!(result.is_err());
        let expected_replacement = take_expected_replacement_identity(&fixture.root)?;
        let current_replacement = named_leaf_identity_for_reservation_test(
            &fixture.root,
            true,
            "reservation-lease-race.json.lease",
        )?;
        assert!(same_identity(&expected_replacement, &current_replacement));
        assert_eq!(
            read_named_leaf_for_reservation_test(
                &fixture.root,
                true,
                "reservation-lease-race.json.lease",
            )?,
            b"lease-replacement",
        );
        Ok(())
    }

    fn read_named_leaf_for_reservation_test(
        root: &NativeReviewArtifactRoot,
        lease: bool,
        leaf: &str,
    ) -> Result<Vec<u8>> {
        let mut guard = root.lock_open()?;
        let state = guard.as_mut().ok_or_else(|| {
            error(Status::GenericFailure, "root_closed", libc::EBADF)
        })?;
        let dir = if lease { state.leases.as_raw_fd() } else { state.reviews.as_raw_fd() };
        let fd = openat2(
            dir,
            leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
            OPEN_RESOLVE,
        )?;
        let size = fstat_size(fd.as_raw_fd())?;
        let mut bytes = vec![0_u8; size];
        read_exact(fd.as_raw_fd(), &mut bytes)?;
        Ok(bytes)
    }
}
```

The code above is the complete native implementation contract, not a placeholder. Every directory
descriptor and reservation-local quarantine descriptor remains owned by `OwnedFd`. `openat2` uses
`O_CLOEXEC`, `O_NOFOLLOW`, and the documented resolve flags. `quarantine_one` uses
`renameat2(..., RENAME_NOREPLACE)`, reopens and checks the quarantine inode identity, and never scans outside
the reservation namespace.

Reservation creation follows the same no-replacement-deletion principle. After the exclusive artifact
leaf is created, no fstat/link/open/identity failure path may call `unlinkat` on artifact or lease names.
The lease source is always the open artifact fd via `link_open_fd_to_name`; a path source such as
`linkat(reviews_fd, artifact_leaf, ...)` is forbidden. Both names are reopened and verified against the
original fd identity before a `NativeReservationHandle` is returned. Partial/orphan names are retained on
failure, the candidate reservation is unusable, and replacement deletion/overwrite counts remain zero. The
reservation race tests capture the replacement inode identity at the narrow `#[cfg(test)]` seam and assert that
the same named inode and bytes remain after the production failure path. Same identity proves no successful
delete/recreate; unchanged bytes prove no overwrite. This is the zero-delete/zero-overwrite observation and
requires no syscall interception framework.

Most importantly, the supported v4.0.0 cleanup path contains **no physical unlink of a quarantine leaf**.
An opened/fstat-verified fd is not evidence that a later `unlinkat(dirfd, name)` removes that same inode.
Therefore `verify_quarantine_leaf` returns only a classification; it does not return a capability authorizing
name-based deletion. Both verified leaves are retained as `quarantine_retained`. The test-only
`replace_after_verify_label` seam swaps the name after verification and proves the replacement bytes survive.

`cleanupExistingReservation(descriptor)` is the only production cleanup entry point. It validates the
descriptor and enters `cleanup_descriptor` without calling `openExistingReservation`; therefore ENOENT for
an original cleanup target is classified by `quarantine_one` as `AlreadyAbsent`, not surfaced as a strict
read/write `artifact_missing` failure. The old `NativeReservationHandle` is neither required nor reused
across restart.

Native errors have this fixed mapping: `EEXIST` from marker creation is `artifact_occupied`; `ENOENT`
from an existing-reservation open is `artifact_missing`; `ELOOP`, `EXDEV`, `EINVAL`, and `ENOTDIR` are
`artifact_path_invalid`; `EBADF` or `root.close()` is `root_closed`; `EACCES` and `EPERM` are
`artifact_permission_denied`; `ENOSYS` and unsupported `EINVAL` from capability probing make the provider
undefined; all other errors are `artifact_storage_unavailable`. Error messages may contain only the
stable code and errno, never absolute paths or file contents.

**TypeScript adapter:**

`src/runtime/linux-review-artifact-provider.ts` must expose
`createLinuxOpenat2ReviewArtifactProvider(rootDir: string): LinuxOpenat2ReviewArtifactProvider | undefined`,
where a supported `LinuxOpenat2ReviewArtifactProvider` contains the required
`FileWriter.createExclusiveMarker` callback and the `ReservedReviewArtifactIo` value. The
`NodeFileSystem` adapter exposes the callback as optional because unsupported construction omits it. It must first
verify `process.platform === "linux"`, `process.arch === "x64"`, glibc availability, and the native
capability probe. It returns `undefined` for every failed condition. `OpenCodeAdapter` passes the
returned provider into `NodeFileSystem`; that class exposes the marker callback and
`createReservedReviewArtifactIo()` only when the provider is present. The provider maps native
reservation handles to the existing `ReservedReviewArtifactIo` contract without adding methods to
`FileReader` or requiring unrelated `FileWriter` implementers to change. Native addon load errors
and native operation errors must be converted to the existing safe fallback and must not escape a
hook or adapter boundary.

```ts
// src/runtime/linux-review-artifact-provider.ts
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { FileWriter } from "../core/types";
import type { ReservedReviewArtifactIo } from "../core/review-artifact";

type NativeIdentity = Readonly<{ device: string; inode: string }>;
type NativeCapabilities = Readonly<{
  linux: boolean;
  x64: boolean;
  glibc: boolean;
  openat2: boolean;
  renameat2: boolean;
}>;
type NativeHandle = Readonly<{
  artifactIdentity(): NativeIdentity;
  leasePath(): string;
  close(): void;
}>;
type NativeRoot = Readonly<{
  createExclusiveMarker(path: string): NativeHandle;
  openExistingReservation(descriptor: {
    artifactPath: string;
    leasePath: string;
    artifactIdentity: NativeIdentity;
  }): NativeHandle;
  writeExisting(handle: NativeHandle, bytes: Buffer): void;
  readOnce(handle: NativeHandle): Buffer;
  cleanupExistingReservation(descriptor: {
    artifactPath: string;
    leasePath: string;
    artifactIdentity: NativeIdentity;
  }): {
    readonly status: "cleaned" | "quarantine_retained" | "replacement_retained" | "cleanup_incomplete";
  };
  close(): void;
}>;
type NativeAddon = Readonly<{
  openReviewArtifactRoot(rootDir: string): NativeRoot;
  probeReviewArtifactCapabilities(): NativeCapabilities;
}>;

export type LinuxOpenat2RuntimeEnvironment = Readonly<{
  platform: NodeJS.Platform;
  arch: string;
  glibc: boolean;
  openat2: boolean;
  renameat2: boolean;
}>;

export type LinuxOpenat2ReviewArtifactProvider = Readonly<{
  readonly createExclusiveMarker: NonNullable<FileWriter["createExclusiveMarker"]>;
  readonly reservedReviewArtifactIo: ReservedReviewArtifactIo;
  readonly close: () => void;
}>;

const NATIVE_ADDON_FILE = "justice_review_artifact_linux.linux-x64-gnu.node";

export function isSupportedLinuxOpenat2Environment(
  environment: LinuxOpenat2RuntimeEnvironment,
): boolean {
  return (
    environment.platform === "linux" &&
    environment.arch === "x64" &&
    environment.glibc &&
    environment.openat2 &&
    environment.renameat2
  );
}

export function createLinuxOpenat2ReviewArtifactProvider(
  rootDir: string,
): LinuxOpenat2ReviewArtifactProvider | undefined {
  if (process.platform !== "linux" || process.arch !== "x64" || !hasGlibcRuntime()) return undefined;
  const addon = loadNativeAddon();
  if (addon === undefined) return undefined;

  let capabilities: NativeCapabilities;
  try {
    capabilities = addon.probeReviewArtifactCapabilities();
  } catch {
    return undefined;
  }

  const environment: LinuxOpenat2RuntimeEnvironment = {
    platform: process.platform,
    arch: process.arch,
    glibc: true,
    openat2: capabilities.openat2,
    renameat2: capabilities.renameat2,
  };
  if (
    !capabilities.linux ||
    !capabilities.x64 ||
    !capabilities.glibc ||
    !isSupportedLinuxOpenat2Environment(environment)
  ) {
    return undefined;
  }

  let root: NativeRoot;
  try {
    root = addon.openReviewArtifactRoot(rootDir);
  } catch {
    return undefined;
  }

  const createExclusiveMarker: NonNullable<FileWriter["createExclusiveMarker"]> = async (path) => {
    let handle: NativeHandle | undefined;
    try {
      handle = root.createExclusiveMarker(path);
      return {
        kind: "created",
        leasePath: handle.leasePath(),
        artifactIdentity: handle.artifactIdentity(),
      };
    } catch (cause: unknown) {
      if (nativeErrorCode(cause) === "artifact_occupied") return { kind: "occupied" };
      throw safeNativeError("artifact_storage_unavailable", cause);
    } finally {
      handle?.close();
    }
  };

  const openHandle = (
    reservation: Extract<
      Parameters<ReservedReviewArtifactIo["readOnce"]>[0],
      { readonly status: "usable" }
    >,
  ): NativeHandle =>
    root.openExistingReservation({
      artifactPath: reservation.artifactPath,
      leasePath: reservation.leasePath,
      artifactIdentity: reservation.artifactIdentity,
    });

  const reservedReviewArtifactIo: ReservedReviewArtifactIo = {
    writeExisting: async (reservation, content) => {
      let handle: NativeHandle | undefined;
      try {
        handle = openHandle(reservation);
        root.writeExisting(handle, Buffer.from(content, "utf8"));
      } catch (cause: unknown) {
        throw safeNativeError("artifact_write_failed", cause);
      } finally {
        handle?.close();
      }
    },
    readOnce: async (reservation) => {
      let handle: NativeHandle | undefined;
      try {
        handle = openHandle(reservation);
        return root.readOnce(handle).toString("utf8");
      } catch (cause: unknown) {
        throw safeNativeError("artifact_read_failed", cause);
      } finally {
        handle?.close();
      }
    },
    cleanup: async (reservation) => {
      try {
        return root.cleanupExistingReservation({
          artifactPath: reservation.artifactPath,
          leasePath: reservation.leasePath,
          artifactIdentity: reservation.artifactIdentity,
        }).status;
      } catch (cause: unknown) {
        throw safeNativeError("artifact_cleanup_failed", cause);
      }
    },
  };

  let closed = false;
  return {
    createExclusiveMarker,
    reservedReviewArtifactIo,
    close: () => {
      if (closed) return;
      closed = true;
      try {
        root.close();
      } catch {
        // Teardown is fail-open; the native process still owns descriptor cleanup.
      }
    },
  };
}

function loadNativeAddon(): NativeAddon | undefined {
  try {
    const require = createRequire(import.meta.url);
    const addonPath = fileURLToPath(new URL(`../../dist/native/${NATIVE_ADDON_FILE}`, import.meta.url));
    return require(addonPath) as NativeAddon;
  } catch {
    return undefined;
  }
}

function hasGlibcRuntime(): boolean {
  try {
    const report = process.report?.getReport() as
      | { readonly header?: { readonly glibcVersionRuntime?: unknown } }
      | undefined;
    return typeof report?.header?.glibcVersionRuntime === "string";
  } catch {
    return false;
  }
}

function nativeErrorCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const code = cause.message.split(":", 1)[0];
  return /^[a-z][a-z0-9_]*$/u.test(code) ? code : undefined;
}

function safeNativeError(fallbackCode: string, cause: unknown): Error {
  const code = nativeErrorCode(cause) ?? fallbackCode;
  return new Error(code);
}
```

The built-addon test above MUST assert both camelCase descriptor APIs against the real `.node` addon:
`openExistingReservation` remains the strict read/write reopen ABI, while
`cleanupExistingReservation` accepts the same durable descriptor and returns `quarantine_retained` for a
normal matching reservation because the supported provider intentionally performs no name-only quarantine
unlink. The provider operations suite MUST close and reopen the provider and call
`ReservedReviewArtifactIo.cleanup(reservation)` from the durable reservation data, preserving the same
reservation-local retained state. The post-verification replacement race remains Rust-only under
`#[cfg(test)]`; do not expose fault injection through N-API. Together, these tests prove that production
cleanup delegates through the descriptor ABI rather than `openHandle()` and that restart reachability does
not reintroduce physical deletion.

**F-048 cleanup recovery traceability:**

| Requirement | Owner | Verification |
|---|---|---|
| Design §4.10 strict read/write reopen | Task 3.3b | `openExistingReservation` requires original artifact + lease pair |
| Design §4.10 cleanup descriptor reopen | Task 3.3b | `cleanupExistingReservation` enters cleanup with originals absent |
| no verify→name-only unlink | Task 3.3b | production listing contains no `delete_verified_quarantine` / quarantine `unlinkat` path |
| normal fail-closed retention | Task 3.3b | matching pair → verify both → physical delete count zero → `quarantine_retained` |
| post-verification replacement race | Task 3.3b | verify → replace same quarantine name → replacement bytes remain → `quarantine_retained` |
| retained restart reachability | Task 3.3b | `quarantine_retained` → root close/reopen → durable descriptor → same namespace retained |
| cross-reservation restart isolation | Task 3.3b | A retained → reopen → B cleanup → A re-evaluation; namespace trace remains isolated |
| built-addon cleanup ABI | Task 3.3b | real `.node` exposes camelCase `cleanupExistingReservation` and returns `quarantine_retained` |
| provider cleanup composition | Task 3.3b | reopened provider calls `ReservedReviewArtifactIo.cleanup` through descriptor API |
| Task 3.6 cleanup retention | Task 3.6 | `quarantine_retained` records `review_artifact_cleanup_retained` without Gate/Acceptance rollback |
| Task 3.6 durable cleanup idempotency | Task 3.6 | `started` before provider; only finished `cleanup_incomplete` retries; terminal/uncertain state does not call provider |
| reservation fd-bound lease creation | Task 3.3a / 3.3b | opened artifact fd is hard-link source; pathname source link is forbidden |
| reservation creation replacement race | Task 3.3b | artifact/lease replacement bytes remain; delete=0; overwrite=0; no usable reservation |

**Verification:**

```bash
devcontainer exec --workspace-folder . bash -lc 'test "$(whoami)" = "root" && test -w /workspace && command -v rustup && command -v cargo && command -v rustc && active_toolchain="$(rustup show active-toolchain)" && test "${active_toolchain%% *}" = "1.85.1-x86_64-unknown-linux-gnu" && rustc --version && cargo --version && cargo test --manifest-path native/review-artifact-linux/Cargo.toml cleanup_fault_tests && cargo test --manifest-path native/review-artifact-linux/Cargo.toml reservation_creation_race_tests && bun run build:native:review-artifact && bun run test -- tests/runtime/linux-review-artifact-provider.test.ts tests/runtime/linux-review-artifact-provider-security.test.ts && bun run typecheck && bun run lint && bun run build'
```

The runtime tests must run against the built addon on Linux x86_64 and cover exclusive creation, lease identity,
descriptor-relative writes/reads, symlink rejection, ancestor replacement, restart, direct camelCase
`openExistingReservation` and `cleanupExistingReservation` ABI bindings, replacement-retaining cleanup, and `close()` descriptor release.
The unsupported-platform test must verify `undefined` capability rather than a fallback provider. Mock filesystem
tests remain unchanged and continue to cover ordinary plugin behavior.

#### CI / release / package delivery contract

The native provider is not complete when only a local/devcontainer build succeeds. Because the supported v4.0.0
provider is the bundled file `dist/native/justice_review_artifact_linux.linux-x64-gnu.node`, CI and release must
materialize and verify that exact file before addon-dependent tests or publishing.

**CI (`.github/workflows/ci.yml`)**

Keep the existing ordinary CI behavior, but add the minimum supported Linux x86_64 native path. Do not generalize
this into a cross-platform matrix. The supported native path must execute in this order:

```text
checkout
→ Bun setup
→ build prerequisites (`build-essential`)
→ rustup toolchain install/select from rust-toolchain.toml (Rust 1.85.1, x86_64-unknown-linux-gnu)
→ bun install --frozen-lockfile
→ bun run build:native:review-artifact
→ test -f dist/native/justice_review_artifact_linux.linux-x64-gnu.node
→ addon-dependent native/provider tests
→ existing lint/typecheck/test/build/dist/integration gates
```

Use the repository's `rust-toolchain.toml` as the version SSOT and assert before native build:

```bash
active_toolchain="$(rustup show active-toolchain)"
test "${active_toolchain%% *}" = "1.85.1-x86_64-unknown-linux-gnu"
bun run build:native:review-artifact
test -f dist/native/justice_review_artifact_linux.linux-x64-gnu.node
bun run vitest run tests/runtime/linux-review-artifact-provider.test.ts tests/runtime/linux-review-artifact-provider-security.test.ts
```

A supported-provider test must not be skipped and counted as success when the addon is missing or cannot load.
Ordinary unsupported developer environments may continue to run non-native gates, but such a run does not satisfy
the supported Linux Phase 3 production-provider Definition of Done.

**Release (`.github/workflows/release.yml`)**

The release-created path must execute this order before publication/upload:

```text
checkout release tag
→ Node/Bun setup
→ build prerequisites
→ pinned Rust 1.85.1 toolchain selection/assertion
→ bun install --frozen-lockfile
→ bun run build:native:review-artifact
→ exact .node existence assertion
→ bun run build
→ npm pack --ignore-scripts
→ inspect the exact generated tarball
→ npm publish the same inspected tarball with --ignore-scripts
→ upload the same inspected tarball as the release asset
```

The workflow currently publishes with `npm publish --ignore-scripts`; therefore native generation MUST NOT depend
on `prepublishOnly`, `prepare`, or another npm lifecycle script. Build the addon explicitly before packaging.
Registry publication and release upload both consume the already-inspected tarball; neither command may silently
re-pack the package directory after verification.

Create one normalized relative tarball path and inspect it before publish:

```bash
PACKAGE_FILE="$(npm pack --ignore-scripts --silent)"
PACKAGE_PATH="./${PACKAGE_FILE#./}"
test -f "$PACKAGE_PATH"
tar -tzf "$PACKAGE_PATH" | grep -Fx \
  'package/dist/native/justice_review_artifact_linux.linux-x64-gnu.node'
echo "PACKAGE_PATH=$PACKAGE_PATH" >> "$GITHUB_ENV"
```

Expected: `PACKAGE_PATH` names the exact generated `.tgz`, and the addon path above exists once in its listing.
A successful native build alone is not release artifact evidence.

After that inspection, publish and upload that exact file:

```bash
npm publish "$PACKAGE_PATH" --ignore-scripts
gh release upload "${{ steps.release.outputs.tag_name }}" "$PACKAGE_PATH"
```

If publish and upload are separate workflow steps, use the `PACKAGE_PATH` written to `$GITHUB_ENV`; do not run a
second `npm pack`. `npm publish . --ignore-scripts`, bare `npm publish --ignore-scripts`, or any later implicit
re-pack is not the verified release path. No checksum service, artifact registry abstraction, or new release
framework is introduced.

**Task/phase verification**

Task 3.3b GREEN and every supported-Linux Phase 3 boundary after Task 3.3b must include, before the generic full
phase gate, at least:

```bash
bun run build:native:review-artifact
test -f dist/native/justice_review_artifact_linux.linux-x64-gnu.node
bun run vitest run tests/runtime/linux-review-artifact-provider.test.ts tests/runtime/linux-review-artifact-provider-security.test.ts
PACKAGE_FILE="$(npm pack --ignore-scripts --silent)"
tar -tzf "$PACKAGE_FILE" | grep -Fx 'package/dist/native/justice_review_artifact_linux.linux-x64-gnu.node'
rm -f "$PACKAGE_FILE"
```

Expected: addon build succeeds, the exact output file exists and is loadable by provider tests, and the exact addon
path exists in the generated package. Then run the existing `bun run test`, `bun run typecheck`, `bun run lint`, and
`bun run build` phase gate. The native verification is mandatory for supported production completion, but must not
be imposed as an unconditional success criterion on unrelated unsupported local platforms.

**Commit:**

```bash
GIT_MASTER=1 git add native/review-artifact-linux/Cargo.toml native/review-artifact-linux/build.rs native/review-artifact-linux/src/lib.rs rust-toolchain.toml package.json bun.lock src/runtime/linux-review-artifact-provider.ts tests/runtime/linux-review-artifact-provider.test.ts tests/runtime/linux-review-artifact-provider-security.test.ts .github/workflows/ci.yml .github/workflows/release.yml
GIT_MASTER=1 git commit -m "feat: add Linux openat2 review artifact provider"
```

### Task 3.3c: Prove the supported OpenCode host mutation and cancellation boundary

**Requirement:** JUS-P0-04, INV-20, INV-22, INV-23, Design §4.10, §12.5, §12.6, §12.7, F-046, F-047.

**Files:**

- Create `spikes/opencode-host-review-contract/verify.ts`.
- Create `spikes/opencode-host-review-contract/justice-host-contract.ts` as the complete spike-only
  `Plugin` fixture loaded by the real host. `verify.ts` copies this file into the temporary
  `.opencode/plugins/` directory; it is not an inline mock or a direct adapter call.
- Create `spikes/opencode-host-review-contract/README.md` with redacted host traces and exact field paths.
- Test `tests/integration/opencode-host-review-contract.test.ts`.

**Consumes:** the installed OpenCode CLI, the host plugin loader, the real `tool.execute.before` and
`tool.execute.after` dispatch, the built-in `task` and `write` tools, and the runtime child-session events.

Task 3.3a is the sole owner of installing and version-checking the CLI in the devcontainer. Task 3.3c
must use the preinstalled `opencode` executable and may only record its version; it must not run `bun add`,
`bunx`, `npm install`, or any network-dependent installer. A missing executable or version mismatch is
`BLOCKED` before the host fixture is created.

**Produces:** a committed host acceptance report with the exact OpenCode CLI version, SDK version, hook
dispatch shape, mutable-args field path, actual TaskTool execution observation, throw-cancellation behavior,
and the supported/blocked result. This is a capability spike, not a generic OpenCode compatibility layer.

**Supported host contract:**

- `opencode --version` must equal exactly `1.18.29`.
- The project SDK remains `@opencode-ai/plugin` / `@opencode-ai/sdk` `1.14.21`; this does not establish
  host compatibility by itself.
- A different host version, a missing version, or an unredacted/ambiguous event shape is `BLOCKED`, not a
  supported range or a best-effort fallback.

**Step 1: Implement the host-boundary probe**

Create a temporary isolated workspace and a spike-only plugin fixture that is loaded by the real OpenCode
host. Do not call `OpenCodeAdapter.onToolExecuteBefore()` directly. The fixture must:

- receive an original `task` invocation with `run_in_background: true`;
- mutate the actual `tool.execute.before` output args to `run_in_background: false` and add one approved
  sentinel field containing the exact committed artifact path;
- observe the host's actual TaskTool execution and child-session trace, proving that both mutated values were
  consumed by the execution path rather than merely present in the hook-local object;
- record the runtime-provided parent call ID and child session ID without deriving either from prompt,
  category, artifact path, or worker self-report;
- invoke the real built-in `write` tool against a temporary symlink/replacement target through the same host;
  the rejection fixture throws the dedicated cancellation error, records no `tool.execute.after` for the
  built-in writer, and verifies that both the outside target and symlink remain unchanged;
- run one allowed non-review write to prove that generic writes retain their existing behavior.

The report must contain separate `hookArgs`, `taskExecutionArgs`, `childBinding`, `writeCancellation`, and
`unrelatedWrite` records. A hook-local `output.args` assertion is insufficient. The probe must exit non-zero
when the host drops a mutation, rewrites `run_in_background`, loses the exact artifact path, swallows the
cancellation throw, invokes the built-in writer after rejection, or changes an outside target.

The model/provider setup is explicit and does not install anything. `JUSTICE_HOST_TEST_MODEL` must contain the
already configured `provider/model` selected for this probe. Provider configuration and credentials are supplied
by the host's existing configuration or an allowlisted provider environment variable; they are never copied into
the temporary `opencode.json`, written to the trace, or printed in a failure report. The child environment is an
allowlist containing `PATH`, `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `JUSTICE_HOST_TEST_MODEL`, and only
the provider variables declared by the local test runner. Missing model/provider setup is `failureClass:
"setup"`, not a contract failure. The exact non-interactive invocation for each case is:

```text
opencode run --format json --model "$JUSTICE_HOST_TEST_MODEL" "$PROMPT"
```

The command runs with the temporary workspace as its current directory. The temporary layout is fixed:

```text
<tmp>/workspace/opencode.json
<tmp>/workspace/.opencode/plugins/justice-host-contract.ts
<tmp>/workspace/.justice-host-contract/<case>.trace.jsonl
<tmp>/workspace/.justice-host-contract/<case>.report.json
<tmp>/workspace/.justice/reviews/<case>.json -> <tmp>/outside/<case>.json
```

`opencode.json` contains only the schema and exact model string; it has no `plugin` array or explicit plugin
path. The copied fixture is loaded exactly once through workspace auto-discovery at
`.opencode/plugins/justice-host-contract.ts`. It never contains a credential. The fixture records only `input.callID`, the mutated task fields, the runtime event field
paths selected by the preceding child-correlation spike, and the count/result of the built-in write hook. A
missing or ambiguous runtime path is a contract failure; prompt text, category, artifact path, and worker
self-report are not identity sources.

`verify.ts` must be the complete executable below. The helper `readCapped` consumes the process streams with a
64 KiB cap, the timeout kills the child before returning `BLOCKED`, and `finally` removes the temporary tree.
The `process.exitCode` assignment is the only exit decision; no setup or contract failure is swallowed.

```ts
import { appendFile, copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST_VERSION = "1.18.29";
const SDK_VERSION = "1.14.21";
const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 120_000;
const CASES = ["task-review", "final-review"] as const;
type ReviewCase = (typeof CASES)[number];

type ProcessResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

type TraceRecord = Readonly<Record<string, unknown>>;
type HostTrace = {
  readonly hookArgs: {
    readonly parentCallId: string;
    readonly runInBackground: false;
    readonly artifactPath: string;
  };
  readonly taskExecutionArgs: {
    readonly runInBackground: false;
    readonly artifactPath: string;
  };
  readonly childBinding: {
    readonly parentCallId: string;
    readonly childSessionId: string;
    readonly parentCallFieldPath: string;
    readonly childSessionFieldPath: string;
  };
};

type HostReport = {
  readonly status: "PASS" | "BLOCKED";
  readonly failureClass?: "setup" | "contract";
  readonly failureCode?:
    | "host_missing"
    | "host_version_mismatch"
    | "model_unconfigured"
    | "host_run_failed"
    | "plugin_load_failed"
    | "host_contract_paths_unconfigured"
    | "task_mutation_dropped"
    | "child_correlation_missing"
    | "write_cancellation_failed"
    | "unrelated_write_regressed"
    | "unknown_failure";
  readonly hostVersion: string;
  readonly sdkVersion: string;
  readonly taskReview: HostTrace;
  readonly finalReview: HostTrace;
  readonly writeCancellation: Readonly<Record<string, unknown>>;
  readonly unrelatedWrite: Readonly<Record<string, unknown>>;
};

type HostCaseResult = {
  readonly trace: HostTrace;
  readonly writeCancellation: Readonly<Record<string, unknown>>;
  readonly unrelatedWrite: Readonly<Record<string, unknown>>;
};

type MutableHostReport = { -readonly [Key in keyof HostReport]: HostReport[Key] };

const emptyTrace = (): HostTrace => ({
  hookArgs: { parentCallId: "", runInBackground: false, artifactPath: "" },
  taskExecutionArgs: { runInBackground: false, artifactPath: "" },
  childBinding: {
    parentCallId: "",
    childSessionId: "",
    parentCallFieldPath: "",
    childSessionFieldPath: "",
  },
});

async function readCapped(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = MAX_OUTPUT_BYTES - size;
      if (remaining <= 0) continue;
      const chunk = next.value.subarray(0, remaining);
      chunks.push(chunk);
      size += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(bytes);
}

async function runProcess(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<ProcessResult> {
  const process = Bun.spawn(argv, { cwd, env, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    process.kill();
  }, TIMEOUT_MS);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      readCapped(process.stdout),
      readCapped(process.stderr),
    ]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timeout);
  }
}

function redact(value: string): string {
  return value
    .replace(/(sk|key|token|secret)[-_A-Za-z0-9]*\s*[:=]\s*[^\s,}]+/giu, "$1=<redacted>")
    .replace(/\/home\/[^\s/]+/gu, "$HOME")
    .slice(0, MAX_OUTPUT_BYTES);
}

function requiredModel(): string {
  const model = process.env.JUSTICE_HOST_TEST_MODEL?.trim();
  if (model === undefined || model.length === 0 || !model.includes("/")) {
    throw new Error("setup:model_unconfigured");
  }
  return model;
}

function requiredContractPath(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/u.test(value)) {
    throw new Error("contract:host_contract_paths_unconfigured");
  }
  return value;
}

function allowedEnvironment(
  model: string,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const names = [
    "PATH",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "JUSTICE_HOST_TEST_MODEL",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
  ];
  const environment: Record<string, string> = { JUSTICE_HOST_TEST_MODEL: model, ...extra };
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && environment[name] === undefined) environment[name] = value;
  }
  return environment;
}

function parseTrace(text: string): readonly TraceRecord[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TraceRecord);
}

function recordByKind(records: readonly TraceRecord[], kind: string): TraceRecord {
  const record = records.find((candidate) => candidate.kind === kind);
  if (record === undefined) throw new Error(`contract:${kind}_missing`);
  return record;
}

function stringField(record: TraceRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`contract:${key}_missing`);
  return value;
}

function booleanField(record: TraceRecord, key: string, expected: boolean): false | true {
  if (record[key] !== expected) throw new Error(`contract:${key}_mismatch`);
  return expected;
}

async function verifyCase(
  workspace: string,
  model: string,
  reviewCase: ReviewCase,
  outsideTarget: string,
  hostEnvironment: Readonly<Record<string, string>>,
): Promise<HostCaseResult> {
  const stateDir = join(workspace, ".justice-host-contract");
  const tracePath = join(stateDir, `${reviewCase}.trace.jsonl`);
  const artifactPath = `.justice/reviews/${reviewCase}.json`;
  const prompt = [
    `Invoke exactly one task tool call for category ${reviewCase === "task-review" ? "sp-review" : "sp-final-review"}.`,
    "Set run_in_background to true so the host hook must canonicalize it.",
    `In the child worker, write JSON to ${artifactPath}, then write ordinary text to .justice/unrelated.txt.`,
    "Do not report success unless both tool calls were actually attempted.",
  ].join(" ");
  const childSessionFieldPath = requiredContractPath("JUSTICE_HOST_CHILD_SESSION_FIELD_PATH");
  const runtimeParentCallFieldPath = requiredContractPath("JUSTICE_HOST_PARENT_CALL_FIELD_PATH");
  const result = await runProcess(
    ["opencode", "run", "--format", "json", "--model", model, prompt],
    workspace,
    { ...hostEnvironment,
      JUSTICE_HOST_TRACE_PATH: tracePath,
      JUSTICE_HOST_ARTIFACT_PATH: artifactPath,
      JUSTICE_HOST_CATEGORY: reviewCase === "task-review" ? "sp-review" : "sp-final-review",
      JUSTICE_HOST_CHILD_SESSION_FIELD_PATH: childSessionFieldPath,
      JUSTICE_HOST_PARENT_CALL_FIELD_PATH: runtimeParentCallFieldPath,
    },
  );
  if (result.timedOut || result.exitCode !== 0) {
    const failureCode = /plugin|load/iu.test(result.stderr) ? "plugin_load_failed" : "host_run_failed";
    throw new Error(`setup:${failureCode}`);
  }
  const records = parseTrace(await readFile(tracePath, "utf8"));
  const hook = recordByKind(records, "hook_args");
  const execution = recordByKind(records, "task_execution_args");
  const binding = recordByKind(records, "child_binding");
  const cancellation = recordByKind(records, "write_cancellation");
  const unrelated = recordByKind(records, "unrelated_write");
  const expectedParentCallId = stringField(hook, "parentCallId");
  const expectedArtifactPath = stringField(hook, "artifactPath");
  if (expectedArtifactPath !== artifactPath) throw new Error("contract:artifact_path_mismatch");
  booleanField(hook, "runInBackground", false);
  booleanField(execution, "runInBackground", false);
  if (stringField(execution, "artifactPath") !== expectedArtifactPath) {
    throw new Error("contract:task_artifact_path_dropped");
  }
  if (stringField(binding, "parentCallId") !== expectedParentCallId) {
    throw new Error("contract:parent_call_correlation_mismatch");
  }
  if (stringField(cancellation, "reason") !== "review_artifact_write_rejected") {
    throw new Error("contract:write_cancellation_reason_mismatch");
  }
  booleanField(cancellation, "builtInWriterInvocations", false);
  if (records.some((record) => record.kind === "write_after")) {
    throw new Error("contract:built_in_writer_invoked_after_cancellation");
  }
  if ((await readFile(outsideTarget, "utf8")) !== "outside") {
    throw new Error("contract:outside_target_changed");
  }
  const artifactEntry = await lstat(join(workspace, artifactPath));
  if (!artifactEntry.isSymbolicLink()) throw new Error("contract:replacement_symlink_changed");
  booleanField(cancellation, "outsideTargetUnchanged", true);
  booleanField(unrelated, "builtInWriterInvocations", true);
  const trace: HostTrace = {
    hookArgs: {
      parentCallId: expectedParentCallId,
      runInBackground: false,
      artifactPath: expectedArtifactPath,
    },
    taskExecutionArgs: {
      runInBackground: false,
      artifactPath: stringField(execution, "artifactPath"),
    },
    childBinding: {
      parentCallId: stringField(binding, "parentCallId"),
      childSessionId: stringField(binding, "childSessionId"),
      parentCallFieldPath: stringField(binding, "parentCallFieldPath"),
      childSessionFieldPath: stringField(binding, "childSessionFieldPath"),
    },
  };
  const resultByKind = (kind: string): Readonly<Record<string, unknown>> =>
    recordByKind(records, kind);
  const caseResult: HostCaseResult = {
    trace,
    writeCancellation: resultByKind("write_cancellation"),
    unrelatedWrite: resultByKind("unrelated_write"),
  };
  await writeFile(
    join(stateDir, `${reviewCase}.report.json`),
    `${JSON.stringify(caseResult)}\n`,
    "utf8",
  );
  return caseResult;
}

type FailureCode = NonNullable<HostReport["failureCode"]>;

function normalizeFailureCode(failureClass: string, rawCode: string): FailureCode {
  const known: readonly FailureCode[] = [
    "host_missing",
    "host_version_mismatch",
    "model_unconfigured",
    "host_run_failed",
    "plugin_load_failed",
    "host_contract_paths_unconfigured",
    "task_mutation_dropped",
    "child_correlation_missing",
    "write_cancellation_failed",
    "unrelated_write_regressed",
    "unknown_failure",
  ];
  if (known.includes(rawCode as FailureCode)) return rawCode as FailureCode;
  if (failureClass === "contract") {
    if (/artifact|background|hook_args|task_execution_args/u.test(rawCode)) {
      return "task_mutation_dropped";
    }
    if (/parent|child|binding|correlation/u.test(rawCode)) return "child_correlation_missing";
    if (/write|outside|replacement/u.test(rawCode)) return "write_cancellation_failed";
    if (/unrelated/u.test(rawCode)) return "unrelated_write_regressed";
  }
  return "unknown_failure";
}

async function main(): Promise<void> {
  let hostVersion = "";
  let model = "";
  let workspace = "";
  const report: MutableHostReport = {
    status: "BLOCKED",
    failureClass: "setup",
    failureCode: "host_missing",
    hostVersion,
    sdkVersion: SDK_VERSION,
    taskReview: emptyTrace(),
    finalReview: emptyTrace(),
    writeCancellation: {},
    unrelatedWrite: {},
  };
  try {
    let version: ProcessResult;
    try {
      version = await runProcess(["opencode", "--version"], process.cwd(), allowedEnvironment("probe/probe"));
    } catch {
      report.failureCode = "host_missing";
      throw new Error("setup:host_missing");
    }
    hostVersion = version.stdout.trim();
    report.hostVersion = hostVersion;
    if (version.timedOut || version.exitCode !== 0 || hostVersion !== HOST_VERSION) {
      report.failureCode = "host_version_mismatch";
      throw new Error("setup:host_version_mismatch");
    }
    model = requiredModel();
    workspace = await mkdtemp(join(tmpdir(), "justice-opencode-host-contract-"));
    const hostHome = join(workspace, ".host-home");
    const hostConfigHome = join(workspace, ".host-config");
    const hostCacheHome = join(workspace, ".host-cache");
    await mkdir(hostHome, { recursive: true });
    await mkdir(hostConfigHome, { recursive: true });
    await mkdir(hostCacheHome, { recursive: true });
    const hostEnvironment = allowedEnvironment("probe/probe", {
      HOME: hostHome,
      XDG_CONFIG_HOME: hostConfigHome,
      XDG_CACHE_HOME: hostCacheHome,
    });
    const stateDir = join(workspace, ".justice-host-contract");
    const pluginDir = join(workspace, ".opencode", "plugins");
    await mkdir(pluginDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await copyFile(new URL("./justice-host-contract.ts", import.meta.url), join(pluginDir, "justice-host-contract.ts"));
    await writeFile(
      join(workspace, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        model,
      }),
      "utf8",
    );
    report.failureClass = "contract";
    for (const reviewCase of CASES) {
      const outside = await mkdtemp(join(tmpdir(), `justice-opencode-outside-${reviewCase}-`));
      try {
        const outsideTarget = join(outside, `${reviewCase}.json`);
        const artifact = join(workspace, ".justice", "reviews", `${reviewCase}.json`);
        await mkdir(join(workspace, ".justice", "reviews"), { recursive: true });
        await writeFile(outsideTarget, "outside", "utf8");
        await symlink(outsideTarget, artifact);
        const caseResult = await verifyCase(workspace, model, reviewCase, outsideTarget, hostEnvironment);
        if (reviewCase === "task-review") {
          report.taskReview = caseResult.trace;
        } else {
          report.finalReview = caseResult.trace;
        }
        report.writeCancellation = caseResult.writeCancellation;
        report.unrelatedWrite = caseResult.unrelatedWrite;
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    }
    report.status = "PASS";
    delete report.failureClass;
    delete report.failureCode;
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : "unknown_failure";
    const [failureClass, failureCode] = message.split(":", 2);
    report.failureClass = failureClass === "contract" ? "contract" : "setup";
    report.failureCode = normalizeFailureCode(report.failureClass, failureCode ?? "unknown_failure");
    if (workspace.length > 0) {
      await appendFile(
        join(workspace, ".justice-host-contract", "failure-report.json"),
        `${JSON.stringify({ ...report, hostVersion, diagnostic: redact(message) })}\n`,
        "utf8",
      ).catch(() => undefined);
    }
    process.exitCode = 1;
  } finally {
    console.log(JSON.stringify(report));
    if (workspace.length > 0) await rm(workspace, { recursive: true, force: true });
  }
  if (report.status === "PASS") process.exitCode = 0;
}

await main();
```

The committed `justice-host-contract.ts` must contain the full plugin fixture used above. Its runtime field
paths are not guessed: Task 3.3's successful correlation spike supplies the exact paths as constants, and an
empty or ambiguous path lookup writes `child_binding` with no identity and fails the probe. The fixture must
record these records and nothing else:

```ts
import { appendFile } from "node:fs/promises";
import type { Plugin } from "@opencode-ai/plugin";

type JsonRecord = Record<string, unknown>;
const tracePath = process.env.JUSTICE_HOST_TRACE_PATH;
const expectedArtifactPath = process.env.JUSTICE_HOST_ARTIFACT_PATH;
const expectedCategory = process.env.JUSTICE_HOST_CATEGORY;
const parentCallFieldPath = "tool.execute.before.input.callID";
const childSessionFieldPath = process.env.JUSTICE_HOST_CHILD_SESSION_FIELD_PATH ?? "";
const runtimeParentCallFieldPath = process.env.JUSTICE_HOST_PARENT_CALL_FIELD_PATH ?? "";

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) throw new Error(`fixture:${name}_missing`);
  return value;
}

async function record(kind: string, fields: JsonRecord): Promise<void> {
  await appendFile(required(tracePath, "trace_path"), `${JSON.stringify({ kind, ...fields })}\n`, "utf8");
}

function readStringAt(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as JsonRecord)[key];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

export const JusticeHostContractFixture: Plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    const args = output.args as JsonRecord;
    if (input.tool === "task" && args.category === expectedCategory) {
      const parentCallId = required(input.callID, "parent_call_id");
      args.run_in_background = false;
      args.artifact_path = required(expectedArtifactPath, "artifact_path");
      await record("hook_args", {
        parentCallId,
        runInBackground: args.run_in_background,
        artifactPath: args.artifact_path,
      });
      return;
    }
    if (input.tool === "write" && args.filePath === expectedArtifactPath) {
      await record("write_cancellation", {
        reason: "review_artifact_write_rejected",
        builtInWriterInvocations: false,
        outsideTargetUnchanged: true,
      });
      throw new Error("ReviewArtifactWriteCancelled:review_artifact_write_rejected");
    }
  },
  "tool.execute.after": async (input) => {
    if (input.tool === "task" && input.args.category === expectedCategory) {
      await record("task_execution_args", {
        runInBackground: input.args.run_in_background,
        artifactPath: input.args.artifact_path,
      });
    }
    if (input.tool === "write" && input.args.filePath === expectedArtifactPath) {
      await record("write_after", { builtInWriterInvocations: true });
    }
    if (input.tool === "write" && input.args.filePath === ".justice/unrelated.txt") {
      await record("unrelated_write", { builtInWriterInvocations: true });
    }
  },
  event: async ({ event }) => {
    if (event.type !== "session.created") return;
    const childSessionId = readStringAt(event.properties, childSessionFieldPath.split("."));
    const parentCallId = readStringAt(event.properties, runtimeParentCallFieldPath.split("."));
    if (childSessionId === undefined || parentCallId === undefined) return;
    await record("child_binding", {
      parentCallId,
      childSessionId,
      parentCallFieldPath,
      childSessionFieldPath: `event.properties.${childSessionFieldPath}`,
    });
  },
});

export default JusticeHostContractFixture;
```

The fixture source above is deliberately narrow: it does not fake `JusticePlugin`, call an adapter method,
or synthesize child identities. The actual `task`/`write` execution, hook throw, and `session.created` event
must come from the installed host. The integration test must launch `verify.ts`, parse the generated report,
assert the exact schema from Design §12.7, and fail on a non-zero probe exit or any `BLOCKED` report; it may not
replace the CLI with a mocked `Bun.spawn`.

The complete integration test is:

```ts
import { describe, expect, it } from "vitest";

describe("OpenCode host review contract", () => {
  it("runs the real CLI and accepts only a complete PASS report", async () => {
    if ((process.env.JUSTICE_HOST_TEST_MODEL ?? "").includes("/") === false) {
      throw new Error("unsupported setup: JUSTICE_HOST_TEST_MODEL=provider/model is required");
    }
    for (const name of [
      "JUSTICE_HOST_CHILD_SESSION_FIELD_PATH",
      "JUSTICE_HOST_PARENT_CALL_FIELD_PATH",
    ]) {
      if ((process.env[name] ?? "").trim().length === 0) {
        throw new Error(`unsupported setup: ${name} must come from Task 3.3 correlation evidence`);
      }
    }
    const child = Bun.spawn(["bun", "spikes/opencode-host-review-contract/verify.ts"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, discardedStderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    void discardedStderr;
    const reportLine = stdout.trim().split("\n").at(-1);
    if (reportLine === undefined || reportLine.length === 0) {
      throw new Error("OpenCode host contract probe emitted no report");
    }
    const report = JSON.parse(reportLine) as {
      readonly status: string;
      readonly hostVersion: string;
      readonly sdkVersion: string;
      readonly taskReview: { readonly childBinding: { readonly childSessionId: string } };
      readonly finalReview: { readonly childBinding: { readonly childSessionId: string } };
      readonly writeCancellation: {
        readonly reason: string;
        readonly builtInWriterInvocations: boolean;
      };
      readonly unrelatedWrite: { readonly builtInWriterInvocations: boolean };
    };
    if (exitCode !== 0) throw new Error(`OpenCode host contract probe blocked: ${report.status}`);
    expect(report).toMatchObject({
      status: "PASS",
      hostVersion: "1.18.29",
      sdkVersion: "1.14.21",
      writeCancellation: {
        reason: "review_artifact_write_rejected",
        builtInWriterInvocations: false,
      },
      unrelatedWrite: { builtInWriterInvocations: true },
    });
    expect(report.taskReview.childBinding.childSessionId).not.toBe("");
    expect(report.finalReview.childBinding.childSessionId).not.toBe("");
  });
});
```

`spikes/opencode-host-review-contract/README.md` must be written from the successful probe output before
the spike commit. It must contain the exact `opencode --version` and SDK version, the two field-path
environment values copied from the committed Task 3.3 correlation report, the redacted `task-review` and
`sp-final-review` traces, the mutable-args path, the cancellation reason and zero-writer assertion, and the
unrelated-write assertion. It must not contain prompts, worker text, credentials, provider values, absolute
host paths, or guessed field paths. A missing or ambiguous correlation value keeps the report `BLOCKED` and
prevents the README and Task 3.3c commit from being marked complete.

**Step 2: Run the runtime hard gate**

```bash
devcontainer exec --workspace-folder . bash -lc 'test "$(whoami)" = "root" && test -w /workspace && test "$(opencode --version)" = "1.18.29"'
devcontainer exec --workspace-folder . bun spikes/opencode-host-review-contract/verify.ts
devcontainer exec --workspace-folder . bun run vitest run tests/integration/opencode-host-review-contract.test.ts
```

Expected: the report status is `PASS`, both review categories have actual TaskTool execution traces with
`run_in_background=false` and the exact sentinel artifact path, and rejected review writes have zero
built-in writer invocations. A missing host, unsupported version, direct-adapter-only trace, setup/import
failure, skipped case, or absent child correlation is `BLOCKED` and stops Phase 3 before Task 3.4.

**Step 3: Commit after approval**

```bash
GIT_MASTER=1 git add spikes/opencode-host-review-contract/verify.ts spikes/opencode-host-review-contract/justice-host-contract.ts spikes/opencode-host-review-contract/README.md tests/integration/opencode-host-review-contract.test.ts
GIT_MASTER=1 git commit -m "test: OpenCode host境界のreview契約を検証"
```

Task 3.3c owns only the evidence and hard gate. It must not add a host abstraction, compatibility registry,
multi-host framework, OpenCode fork, or adapter rewrite. Task 3.6 consumes the recorded field paths and uses
the real host acceptance path for the final task-review and final-review E2E.

### Task 3.4: Persist review dispatch and the PreToolUse claim protocol

**Requirement:** JUS-P0-02, JUS-P0-04, INV-11, INV-16, INV-17, INV-19, INV-20, INV-21, Design §4.8, §4.8.1, §4.8.2, §4.10, §12.1, §12.2, §12.3, §12.5, F-043, F-045, F-048, and the PreToolUse portion of §12.6.

Task 3.4 owns Review Dispatch composition, directive delivery, and review-first PreToolUse
claiming. It does not import or invoke Task 3.6's completion consumer and does not own the
purpose-aware review PostToolUse branch; Task 3.6 owns that branch and its completion tests.

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
- Modify: `tests/helpers/mock-file-system.ts`
- Test: `tests/core/review-dispatch-state.test.ts`
- Test: `tests/core/review-artifact-reservation.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/hooks/plan-bridge-authorization.test.ts`
- Test: `tests/hooks/plan-bridge.test.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`
- Test: `tests/runtime/node-file-system.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`

`tests/runtime/opencode-adapter-v2.test.ts` is extended here only for the review-category
`run_in_background = false` final-wire cases; Task 3.5 later extends the same file for the
runtime child relation. `tests/core/v2/state-projection.test.ts` remains a shared projection
file: Task 3.4 owns dispatch-slot and task-call-binding projections, while Tasks 3.5 and 3.6
append their child-binding and completion-record cases. `tests/core/justice-plugin-routing.test.ts`
is owned here for the live PreToolUse claim route and is extended by Task 3.6 for live review
PostToolUse completion routing. The completion-specific transactional test is owned by Task 3.6,
not this task.

**Consumes:** current `TaskExecutionRef` or finalization identity; `ReviewCorrelation`; `ProjectedLifecycle` and `project(records, rebuiltAt).lifecycle` from Task 3.1; `findCurrentGateDecision` and `findCurrentAcceptanceDecision` from Task 3.2; active `ApprovedPlanBinding` snapshots for current authorization membership and Final Review `planFingerprint`; review
`TaskCallPurpose`; durable `PersistedLogRecord` read/append and projection; the optional injected
the `LinuxOpenat2ReviewArtifactProvider` runtime capability exposed by `NodeFileSystem`; safe-relative-path validation;
`AuthorizationStore.findByAuthorizationId`.
It also consumes the normalized review `task()` payload, the observed runtime identity from
Task 3.3, the existing `HookResponse` union and `mergePreToolUseResponses`, and the production
`JusticePlugin` composition inputs needed to bind the factory ports. The category is only an
expected-category selector; the durable pending slot remains the source of correlation identity.
Task 2.2's `AuthorizationStore` strict authoritative-read contract is also consumed:
malformed, blank, schema-invalid, or otherwise unreadable `.justice/authorizations.json`
may reject the `readDurableAuthorizations` port. That rejection means
`Authorization` is unreadable / uncertain; it is not a legitimate empty authoritative
array and must never be normalized to `[]` for candidate selection or claim.
All log, Authorization, filesystem, directive, and advisory operations are injected ports assembled by
the hook/runtime layer. `src/core/review-dispatch-state.ts` contains no runtime singleton import or direct
filesystem access; its append ports receive a `Pick<PersistedEnvelope, "agentId" | "sessionId" | "writerId">`
from the observed event or the durable source record.

**Produces:** `ReviewRequiredDirective`; `ReviewDirectiveDelivery`; durable `null -> pending` and `pending -> claimed` records;
`TaskCallBinding`; Design §4.10 `ReviewArtifactReservation`; `claimReviewDispatch(input):
Promise<ClaimReviewDispatchOutcome>`; `projectReviewDispatchSlots(records)`; `projectTaskCallBindings(records)`;
and an in-memory cache
reconstructed only from the durable projection. `ClaimReviewDispatchOutcome` is either `{ readonly kind:
"claimed"; readonly taskCallBinding: TaskCallBinding }`, `{ readonly kind: "claimed_unusable";
readonly taskCallBinding: Extract<TaskCallBinding, { readonly purpose: "task_review" | "final_review" }>;
readonly artifactPathOmitted: true; readonly advisory: "artifact_reservation_unusable" }`, or `{ readonly kind:
"blocked"; readonly advisory: string }`.
For live offer and claim, rejection from either full authoritative
`readDurableAuthorizations()` read is an ordinary authority-unavailable condition:
offer resolves `{ readonly kind: "blocked" }`, while claim resolves
`{ readonly kind: "blocked"; readonly advisory: "review_authorization_unreadable" }`.
Neither operation leaks that rejection to its caller. The rejection branch records
`review_authorization_unreadable` best-effort, attempts only existing same-parent stale-slot
cancellation convergence, and creates no pending slot, directive, reservation, claim,
Gate, Acceptance, or Progress authority. The `readDurableAuthorizations` port remains
typed as `() => Promise<readonly ApprovedPlanBinding[]>`; it is explicitly not a
never-rejecting port.
`claimed_unusable` carries the trusted durable call binding while its `artifactReservation.status` is
`unusable`; the runtime continues the task fail-open with no artifact path and never treats that binding as
review completion authority. A `blocked` outcome exposes neither `callId` nor `artifactId` as authority.
`FileWriter.createExclusiveMarker?.(path)` returns `"created"` with a JSON-safe
`ReviewArtifactInodeIdentity` and private `leasePath`, or `"occupied"`. This is an optional runtime
capability, not a promise that every `FileWriter` can provide it. A runtime may implement it only with
descriptor-relative or equivalent native operations that bind the review directory and all ancestors
for the complete operation. `resolveSafely()` followed by an absolute-path `O_NOFOLLOW` open is not
such an implementation. On the supported deployment, `NodeFileSystem` receives the selected
`LinuxOpenat2ReviewArtifactProvider` and exposes its marker callback plus reserved-artifact I/O. On
unsupported deployments, both capabilities remain absent. Missing or failed exclusive-create,
identity capture, or no-follow support returns an unusable reservation with
`artifact_storage_unavailable`; no `fileExists` → `writeFile` fallback is permitted.
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
The Task 3.4 production composition stores exactly one returned state instance on `JusticePlugin`,
binds every port to the shared boundary, `AuthorizationStore`, `ObservationLogStore`, artifact
reservation adapter, advisory append path, and hook-response delivery sink, and injects its
within-parent cancellation capability into `PlanBridge` before initialization. The production
PreToolUse route uses that instance and the existing `HookResponse` merger; it never falls back
to `PlanBridge` for a review category. PostToolUse completion routing and
`consumeReviewCompletion` are explicitly deferred to Task 3.6.
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
queue-acquiring wrapper for boundary-external callers only. Its returned internal
`cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(parentSessionId, authorizationId):
Promise<void>` counterpart is returned for Task 3.6 and injected once into PlanBridge through
`setReviewDispatchCancellation`, never acquires the queue, and is callable only while the caller already owns that
parent-session critical section. It reads the latest durable projection, best-effort appends `cancelled` only for
the current pending or claimed slot of that authorization, and treats an existing terminal slot as a no-op. These
are the only cancellation helpers; callers must not choose lock behavior dynamically. The public wrapper is
never called by PlanBridge while it owns the boundary: explicit cancel, runtime fingerprint invalidation, startup fingerprint
mismatch invalidation, and startup confirmed-missing invalidation use their corresponding Authorization and cancellation within-boundary helpers in
one outer operation. Queue-owning claim, failure, retry, and recovery operations call the within-parent helper
directly. The Task 3.4 composition root injects the exact returned helper before `initialize()`; no optional
runtime fallback or second queue is permitted.

At the existing `JusticePlugin` composition root, immediately after constructing the one Review Dispatch state
with the Task 2.2 boundary, inject its returned within-parent helper into the already-constructed PlanBridge:

```ts
this.planBridge.setReviewDispatchCancellation(
  reviewDispatchState.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim,
);
```

This is a one-time direct dependency injection, not a second boundary, public cancellation wrapper, or generic
container. It must occur before `initialize()` can call `restoreActivePlans()`.

- [ ] **Step 1: Write the failing dispatch, claim, offer, and recovery tests**

The test setup constructs one `reviewDispatchState` with the existing injected ports and destructures
its returned operations (`claimReviewDispatch`, `offerNextMandatoryReview`, `terminalizeReviewFailure`,
the cancellation boundary, and restart recovery). Queue tests use the returned
`withReviewDispatchParentSessionClaim`; they do not access closure state.
The unreadable-Authorization fixtures use the same injected `readDurableAuthorizations` mock for both
the initial read and the post-convergence reread. A first-read rejection is configured with one
`mockRejectedValueOnce`; a reread rejection is configured with one successful active-binding result
followed by `mockRejectedValueOnce`. The offer fixture has a current lifecycle candidate, and the claim
fixture has a current pending slot. Assertions distinguish an unchanged pre-existing pending record from
an attempted new `null -> pending` record, and use the existing projected reservation, directive, terminal,
and Acceptance-record helpers rather than inspecting closure state.

Add these tests to `tests/core/review-dispatch-state.test.ts`:

```ts
it("returns blocked when offer's initial Authorization read is unreadable", async () => {
  const lifecycle = await arrangeInitialFinalizationLifecycle({ finalReviewRound: 1 });
  const error = new Error("authorization JSON is unreadable");
  readDurableAuthorizations.mockRejectedValueOnce(error);

  await expect(offerNextMandatoryReview(lifecycle.parentSessionId)).resolves.toEqual({
    kind: "blocked",
  });
  expect(recordAdvisory).toHaveBeenCalledWith(
    "review_authorization_unreadable",
    error,
  );
  expect(durableTransitions(null, "pending")).toHaveLength(0);
  expect(injectedReviewDirectives()).toEqual([]);
  expect(projectedArtifactReservations()).toHaveLength(0);
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it("returns blocked when offer's Authorization reread is unreadable", async () => {
  const lifecycle = await arrangeInitialFinalizationLifecycle({ finalReviewRound: 1 });
  const error = new Error("authorization reread failed");
  readDurableAuthorizations
    .mockResolvedValueOnce([activeAuthorization])
    .mockRejectedValueOnce(error);

  await expect(offerNextMandatoryReview(lifecycle.parentSessionId)).resolves.toEqual({
    kind: "blocked",
  });
  expect(recordAdvisory).toHaveBeenCalledWith(
    "review_authorization_unreadable",
    error,
  );
  expect(durableTransitions(null, "pending")).toHaveLength(0);
  expect(injectedReviewDirectives()).toEqual([]);
  expect(projectedArtifactReservations()).toHaveLength(0);
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it("blocks claim and cancels the current slot when the initial Authorization read is unreadable", async () => {
  await arrangeCurrentPendingReview(activeAuthorization);
  const error = new Error("authorization JSON is unreadable");
  readDurableAuthorizations.mockRejectedValueOnce(error);

  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({
    kind: "blocked",
    advisory: "review_authorization_unreadable",
  });
  expect(recordAdvisory).toHaveBeenCalledWith(
    "review_authorization_unreadable",
    error,
  );
  expect(durableTransitions("pending", "claimed")).toHaveLength(0);
  expect(durableTerminals("cancelled")).toHaveLength(1);
  expect(projectedArtifactReservations()).toHaveLength(0);
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});

it("blocks claim and cancels the latest slot when the Authorization reread is unreadable", async () => {
  await arrangeCurrentPendingReview(activeAuthorization);
  const error = new Error("authorization reread failed");
  readDurableAuthorizations
    .mockResolvedValueOnce([activeAuthorization])
    .mockRejectedValueOnce(error);

  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({
    kind: "blocked",
    advisory: "review_authorization_unreadable",
  });
  expect(recordAdvisory).toHaveBeenCalledWith(
    "review_authorization_unreadable",
    error,
  );
  expect(durableTransitions("pending", "claimed")).toHaveLength(0);
  expect(durableTerminals("cancelled")).toHaveLength(1);
  expect(projectedArtifactReservations()).toHaveLength(0);
  expect(durableAcceptanceRecords(await readDurableRecords())).toHaveLength(0);
});
```

Add this integration regression to `tests/core/justice-plugin-routing.test.ts`. The fixture must drive
the production `JusticePlugin.handleEvent()` -> live mandatory-review PreToolUse -> `claimReviewDispatch`
path with the real strict Authorization persistence adapter; do not replace the claim path with a direct
mock of `handleEvent()`. The response assertion must use the existing `HookResponse` union: it must resolve,
must not be `"skip"`, and may be either the existing non-blocking `"proceed"` response or an advisory
`"inject"` response. If it is `"inject"`, assert that its context contains
`review_authorization_unreadable`; do not add a new `PROCEED` type.

Define the fixture locally in `justice-plugin-routing.test.ts`; do not call the unit-only
`createReviewDispatchState` factory from this integration test. The fixture uses the production
`JusticePlugin` composition (including its strict `AuthorizationStore`) and only uses a separate
`AuthorizationStore` instance to seed the valid authoritative file before constructing the plugin.
The pending dispatch record is seeded directly through the existing `ObservationLogStore` so the
test enters the claim path without mocking `handleEvent()` or any claim operation. After
`plugin.initialize()` has restored the valid binding, overwrite only
`.justice/authorizations.json` with malformed JSON. This makes the failure occur in the plugin's
own live `readDurableAuthorizations` path, not in a test replacement.

Extend the existing imports in `tests/core/justice-plugin-routing.test.ts` with the following
production values and shared types; keep its existing `JusticePlugin`, `PreToolUseEvent`, and
mock-helper imports:

```ts
import { PlanParser } from "../../src/core/plan-parser";
import {
  buildCanonicalSnapshot,
  computePlanFingerprint,
} from "../../src/core/plan-fingerprint";
import {
  AuthorizationStore,
  createAuthorizationReviewBoundary,
} from "../../src/core/plan-authorization";
import {
  projectReviewDispatchSlots,
  projectTaskCallBindings,
} from "../../src/core/review-dispatch-state";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import type { ShardId, TaskExecutionRef, TaskReviewCorrelation } from "../../src/core/types";
import type {
  PendingLogRecord,
  PersistedLogRecord,
} from "../../src/core/v2/observation-model";
import { createMockFileSystem, type MockFileSystem } from "../helpers/mock-file-system";
```

```ts
type LiveMandatoryReviewFixture = {
  readonly plugin: JusticePlugin;
  readonly event: PreToolUseEvent;
  readonly files: MockFileSystem;
  readonly parentSessionId: string;
  readonly planPath: string;
  readonly planContent: string;
  readonly readDurableRecords: () => Promise<readonly PersistedLogRecord[]>;
};

async function arrangeLiveMandatoryReviewWithUnreadableAuthorization(): Promise<LiveMandatoryReviewFixture> {
  const files = createMockFileSystem();
  const parentSessionId = "parent-live";
  const planPath = "docs/live-review.md";
  const planContent = "## Task 1: live review\n- [ ] execute live review\n";
  const writerId = "writer-live";
  const shard: ShardId = { agentId: "atlas", sessionId: parentSessionId, writerId };
  const approvedTaskIds = new PlanParser().parse(planContent).map((task) => task.id);
  if (approvedTaskIds.length !== 1 || approvedTaskIds[0] !== "task-1") {
    throw new Error("fixture plan did not produce the expected approved task ID");
  }

  await files.writeFile(planPath, planContent);
  const seedStore = new AuthorizationStore(files, files, createAuthorizationReviewBoundary());
  const activeAuthorization = await seedStore.approve({
    sessionId: parentSessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(planContent, approvedTaskIds),
    planFingerprint: computePlanFingerprint(planContent, approvedTaskIds),
    approvedAt: "2026-09-05T00:00:00.000Z",
  });
  if (activeAuthorization === null || activeAuthorization.status !== "active") {
    throw new Error("fixture did not create an active Authorization");
  }

  const taskExecutionRef: TaskExecutionRef = {
    authorizationId: activeAuthorization.authorizationId,
    taskId: "task-1",
    attemptId: "attempt-live",
  };
  const correlation: TaskReviewCorrelation = {
    reviewKind: "task-review",
    taskExecutionRef,
    reviewRound: 1,
  };
  const reviewLog = new ObservationLogStore(files, files, writerId);
  const pendingDispatch: PendingLogRecord = {
    schemaVersion: 1,
    timestamp: "2026-09-05T00:00:01.000Z",
    agentId: shard.agentId,
    sessionId: shard.sessionId,
    writerId: shard.writerId,
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: "dispatch-pending",
    parentSessionId,
    correlation,
    expectedCategory: "sp-review",
    from: null,
    to: "pending",
  };
  await reviewLog.append(shard, pendingDispatch);

  const reservedReviewArtifactIo = createMockReservedReviewArtifactIo(files);
  const plugin = new JusticePlugin(files, files, {
    writerId,
    workspaceRoot: ".",
    reservedReviewArtifactIo,
  });
  await plugin.initialize();
  await files.writeFile(".justice/authorizations.json", "{");

  const event: PreToolUseEvent = {
    type: "PreToolUse",
    sessionId: parentSessionId,
    callId: "review-call",
    payload: {
      toolName: "task",
      callId: "review-call",
      toolInput: {
        category: "sp-review",
        prompt: "review the current task",
        run_in_background: false,
      },
    },
  };

  return {
    plugin,
    event,
    files,
    parentSessionId,
    planPath,
    planContent,
    readDurableRecords: () => reviewLog.readAll(),
  };
}

it("keeps live mandatory-review PreToolUse fail-open when Authorization is unreadable", async () => {
  const fixture = await arrangeLiveMandatoryReviewWithUnreadableAuthorization();

  const response = await fixture.plugin.handleEvent(fixture.event);

  expect(response.action).not.toBe("skip");
  expect(["proceed", "inject"]).toContain(response.action);
  if (response.action === "inject") {
    expect(response.injectedContext).toContain("review_authorization_unreadable");
  }

  const records = await fixture.readDurableRecords();
  const dispatchTransitions = records.filter(
    (record) =>
      record.kind === "review_dispatch_transition" &&
      record.parentSessionId === fixture.parentSessionId,
  );
  expect(dispatchTransitions).toHaveLength(2);
  expect(dispatchTransitions.filter((record) => record.from === null && record.to === "pending"))
    .toHaveLength(1);
  expect(dispatchTransitions.filter((record) => record.from === "pending" && record.to === "claimed"))
    .toHaveLength(0);
  expect(
    dispatchTransitions.filter(
      (record) =>
        record.from === "pending" &&
        record.to === "terminal" &&
        record.terminalReason === "cancelled",
    ),
  ).toHaveLength(1);
  expect(
    dispatchTransitions.filter(
      (record) => record.to === "terminal" && record.terminalReason !== "cancelled",
    ),
  ).toEqual([]);

  const slots = projectReviewDispatchSlots(records);
  expect(
    slots.filter(
      (slot) =>
        slot.key.parentSessionId === fixture.parentSessionId && slot.state === "claimed",
    ),
  ).toEqual([]);
  expect(
    slots.filter(
      (slot) =>
        slot.key.parentSessionId === fixture.parentSessionId &&
        slot.artifactReservation !== undefined,
    ),
  ).toEqual([]);
  expect(
    projectTaskCallBindings(records).filter((binding) => binding.callId === fixture.event.callId),
  ).toEqual([]);
  expect(records.filter((record) => record.recordType === "decision")).toEqual([]);
  expect(
    records.filter(
      (record) =>
        record.kind === "task_lifecycle_transition" ||
        record.kind === "plan_finalization_transition",
    ),
  ).toEqual([]);
  await expect(fixture.files.readFile(".justice/authorizations.json")).resolves.toBe("{");
  await expect(fixture.files.readFile(fixture.planPath)).resolves.toBe(fixture.planContent);
});
```

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
  const records = await readDurableRecords();
  expect(
    records.filter(
      (record) =>
        record.recordType === "decision" ||
        (record.kind === "task_lifecycle_transition" &&
          (record.to === "gate_pending" || record.to === "accepted")) ||
        (record.kind === "plan_finalization_transition" &&
          (record.to === "final_gate_pending" || record.to === "complete")),
    ),
  ).toEqual([]);
});

it("invalidates a missing startup plan, cancels its review, and does not revive authority", async () => {
  await arrangeActiveAuthorizationWithMissingPlanAndPendingReview("parent-1");
  await bridge.restoreActivePlans();

  expect(trace).toEqual([
    "boundary-enter",
    "authorization-invalidated-durable",
    "review-cancelled-tombstone-attempt",
    "active-plan-cache-clear",
    "boundary-release",
  ]);
  expect(parentBoundary.nestedAcquiresFor("parent-1")).toBe(0);
  expect(durableCancelledTombstones()).toHaveLength(1);
  expect(reissuedReviewDirectives()).toHaveLength(0);
  expect(newPendingReviewOffersForInvalidAuthorization()).toHaveLength(0);
  expect(reviewClaimsForInvalidAuthorization()).toHaveLength(0);
  expect(durableAcceptanceDecisionsForInvalidAuthorization()).toHaveLength(0);
});

it("invalidates a semantically changed startup plan, cancels its review, and does not revive authority", async () => {
  await arrangeActiveAuthorizationWithSemanticStartupMutationAndPendingReview("parent-1");
  await bridge.restoreActivePlans();

  expect(trace).toEqual([
    "boundary-enter",
    "current-fingerprint-computed",
    "authorization-invalidated-durable",
    "review-cancelled-tombstone-attempt",
    "active-plan-cache-clear",
    "boundary-release",
  ]);
  expect(parentBoundary.nestedAcquiresFor("parent-1")).toBe(0);
  expect(durableCancelledTombstones()).toHaveLength(1);
  expect(reissuedReviewDirectives()).toHaveLength(0);
  expect(newPendingReviewOffersForInvalidAuthorization()).toHaveLength(0);
  expect(reviewClaimsForInvalidAuthorization()).toHaveLength(0);
  expect(durableAcceptanceDecisionsForInvalidAuthorization()).toHaveLength(0);
});

it("does not cancel, restore cache, or reissue when missing-plan invalidation is uncertain", async () => {
  await arrangeActiveAuthorizationWithMissingPlanAndPendingReview("parent-1");
  authorizationStore.invalidateMissingPlanWithinAuthorizationReviewBoundary.mockResolvedValueOnce({
    kind: "uncertain",
  });

  await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");

  expect(cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim).not.toHaveBeenCalled();
  expect(activePlanCacheFor("parent-1")).toBeNull();
  expect(reissuedReviewDirectives()).toHaveLength(0);
  expect(newPendingReviewOffersForInvalidAuthorization()).toHaveLength(0);
  expect(reviewClaimsForInvalidAuthorization()).toHaveLength(0);
});

it("does not cancel, restore cache, or positively recover when startup fingerprint invalidation is uncertain", async () => {
  await arrangeActiveAuthorizationWithSemanticStartupMutationAndPendingReview("parent-1");
  authorizationStore.invalidateForFingerprintWithinAuthorizationReviewBoundary.mockResolvedValueOnce({
    kind: "uncertain",
  });

  await expect(bridge.restoreActivePlans()).resolves.toBe("uncertain");

  expect(cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim).not.toHaveBeenCalled();
  expect(activePlanCacheFor("parent-1")).toBeNull();
  expect(reissuedReviewDirectives()).toHaveLength(0);
  expect(newPendingReviewOffersForInvalidAuthorization()).toHaveLength(0);
  expect(reviewClaimsForInvalidAuthorization()).toHaveLength(0);
  expect(durableAcceptanceDecisionsForInvalidAuthorization()).toHaveLength(0);
});

it("retains missing-plan terminality and clears cache when cancellation append fails", async () => {
  await arrangeActiveAuthorizationWithMissingPlanAndPendingReview("parent-1");
  cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim.mockRejectedValueOnce(
    new Error("cancelled tombstone append failed"),
  );

  await expect(bridge.restoreActivePlans()).resolves.toBe("authoritative");

  expect(durableAuthorizationFor("parent-1")).toMatchObject({ status: "invalidated" });
  expect(activePlanCacheFor("parent-1")).toBeNull();
  expect(reissuedReviewDirectives()).toEqual([]);
  expect(durableCancelledTombstones()).toEqual([]);
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
  expect(injectedReviewDeliveries()).toEqual([
    {
      parentSessionId: firstReviewPending.parentSessionId,
      directive: { kind: "review_required", correlation: firstTaskReviewCorrelation },
    },
  ]);
});

it("automatically offers an undispatched second candidate after a pending predecessor completes", async () => {
  await appendReviewPendingLifecycleFixture(firstReviewPending);
  await appendReviewPendingLifecycleFixture(secondReviewPending);
  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(0);

  await appendTerminalThenRunOfferFixture(firstCompletedTerminal);

  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDeliveriesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("automatically offers an undispatched second candidate after a claimed predecessor completes", async () => {
  await appendReviewPendingLifecycleFixture(firstReviewPending);
  await claimReviewDispatch(reviewPreToolUseFor("call-a"));
  await appendReviewPendingLifecycleFixture(secondReviewPending);

  await appendTerminalThenRunOfferFixture(firstCompletedTerminal);

  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDeliveriesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("keeps an undispatched candidate deferred across restart until its predecessor terminalizes", async () => {
  await arrangePendingOrClaimedFirstAndUndispatchedSecond();
  restartReviewDispatchRepository();
  await recoverReviewDispatchesAfterRestart();
  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(0);

  await appendTerminalThenRunOfferFixture(firstCompletedTerminal);
  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDeliveriesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("rediscovers an undispatched candidate after a terminal-to-offer crash", async () => {
  await arrangeDurableFirstTerminalAndUndispatchedSecondAfterCrash();
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(durableTransitions(null, "pending", secondTaskReviewCorrelation)).toHaveLength(1);
  expect(injectedReviewDeliveriesFor(secondTaskReviewCorrelation)).toHaveLength(1);
});

it("restores the task review parent session from the lifecycle record after restart", async () => {
  const correlation = await arrangeUndispatchedTaskLifecycleCandidate("parent-task");
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(injectedReviewDeliveriesFor(correlation)).toHaveLength(1);
});

it("restores the Final Review parent session from the lifecycle record after restart", async () => {
  const correlation = await arrangeUndispatchedFinalLifecycleCandidate("parent-final");
  restartReviewDispatchRepository();

  await recoverReviewDispatchesAfterRestart();

  expect(injectedReviewDeliveriesFor(correlation)).toHaveLength(1);
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

  expect(injectedReviewDeliveriesFor(authorizationNewCorrelation)).toHaveLength(1);
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

it("returns review_claim_unavailable for no eligible or category-mismatched slot", async () => {
  arrangeProjectedSlots([]);
  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({
    kind: "blocked",
    advisory: "review_claim_unavailable",
  });
  expect(writeDurableRecord).not.toHaveBeenCalledWith(
    expect.objectContaining({ kind: "delegated_execution_binding" }),
  );
  expect(projectedReviewTaskCallBindings()).toHaveLength(0);
  expect(projectedArtifactReservations()).toHaveLength(0);

  arrangeProjectedSlots([pendingSlotFor("sp-final-review")]);
  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({
    kind: "blocked",
    advisory: "review_claim_unavailable",
  });
  expect(projectedReviewTaskCallBindings()).toHaveLength(0);
  expect(projectedArtifactReservations()).toHaveLength(0);
});

it("returns review_dispatch_integrity_violation for multiple outstanding slots", async () => {
  arrangeProjectedSlots([pendingSlotFor("sp-review"), pendingSlotFor("sp-review", "second")]);
  await expect(claimReviewDispatch(reviewPreToolUse)).resolves.toEqual({
    kind: "blocked",
    advisory: "review_dispatch_integrity_violation",
  });
  expect(recordAdvisory).toHaveBeenCalledWith("review_dispatch_integrity_violation");
  expect(projectedReviewTaskCallBindings()).toHaveLength(0);
  expect(projectedArtifactReservations()).toHaveLength(0);
});

it("uses the selected durable slot correlation for authorization", async () => {
  arrangeCurrentPendingReview(activeAuthorization, trustedTaskReviewCorrelation);
  const result = await claimReviewDispatch(reviewPreToolUse);

  expect(result).toMatchObject({ kind: "claimed" });
  expect(isCurrentActiveAuthorization).toHaveBeenCalledWith(trustedTaskReviewCorrelation);
});

Add the spoof regression to `tests/core/justice-plugin-routing.test.ts`, where the input crosses the actual
PreToolUse router. This test intentionally puts an arbitrary correlation-shaped value in `toolInput`; that value
is untrusted data, not a `ClaimInput` member.

```ts
it("does not forward an incoming tool correlation into a review claim", async () => {
  const fixture = await arrangeStartupRecoveryWithPendingReviewDelivery();
  await fixture.plugin.initialize();
  const spoofedCorrelation = {
    reviewKind: "task-review",
    taskExecutionRef: {
      authorizationId: "forged-authorization",
      taskId: "forged-task",
      attemptId: "forged-attempt",
    },
    reviewRound: 99,
  };
  const event: PreToolUseEvent = {
    ...fixture.matchingReviewPreToolUse,
    payload: {
      ...fixture.matchingReviewPreToolUse.payload,
      toolInput: {
        ...fixture.matchingReviewPreToolUse.payload.toolInput,
        correlation: spoofedCorrelation,
      },
    },
  };

  const response = await fixture.plugin.handleEvent(event);

  expect(response).toEqual(expect.objectContaining({ action: "inject" }));
  await expect(fixture.durableTransitions("pending", "claimed")).resolves.toHaveLength(1);
  const [binding] = await fixture.projectedReviewTaskCallBindings();
  expect(binding?.correlation).not.toEqual(spoofedCorrelation);
});
```

it("reserves a safe unused artifact path", async () => {
  await expect(reserveReviewArtifact()).resolves.toMatchObject({
    status: "usable",
    artifactId: expect.any(String),
    artifactPath: expect.stringMatching(/^\.justice\/reviews\/.+\.json$/u),
    leasePath: expect.stringMatching(/^\.justice\/reviews\/\.leases\/.+\.lease$/u),
    artifactIdentity: { device: expect.any(String), inode: expect.any(String) },
  });
});

it("returns unusable without a marker capability or unsafe fallback", async () => {
  const writer = createMockFileSystem();
  const artifactIo = createMockReservedReviewArtifactIo(writer);
  delete writer.createExclusiveMarker;
  const reserve = createReviewArtifactReservationPort(
    fileReader,
    writer,
    artifactIo,
    recordAdvisory,
  ).reserve;

  await expect(reserve()).resolves.toEqual({
    status: "unusable",
    reason: "artifact_storage_unavailable",
  });
  expect(fileReader.fileExists).not.toHaveBeenCalled();
  expect(writer.writeFile).not.toHaveBeenCalled();
  expect(workerInput).not.toContain(".justice/reviews/");
});

it("rejects artifact replacement before parsing and never unlinks the replacement", async () => {
  const reservation = await reserveReviewArtifact();
  replaceArtifactLeafWithDifferentInode(reservation);
  await expect(reservedReviewArtifactIo.readOnce(reservation)).rejects.toMatchObject({
    reason: "artifact_read_failed",
  });
  await expect(reservedReviewArtifactIo.cleanup(reservation)).resolves.toBe("replacement_retained");
  expect(await artifactPathExists(replacementPath)).toBe(true);
  expect(recordAdvisory).toHaveBeenCalledWith("review_artifact_identity_mismatch");
});

it("accepts writes and reads only through the reserved no-follow inode", async () => {
  const reservation = await reserveReviewArtifact();
  await reservedReviewArtifactIo.writeExisting(reservation, validReviewWorkerJson);
  await expect(reservedReviewArtifactIo.readOnce(reservation)).resolves.toBe(validReviewWorkerJson);
});

it("rejects replacement before a reserved write without changing replacement bytes", async () => {
  const reservation = await reserveReviewArtifact();
  replaceArtifactLeafWithDifferentInode(reservation, "replacement bytes");

  await expect(
    reservedReviewArtifactIo.writeExisting(reservation, validReviewWorkerJson),
  ).rejects.toMatchObject({ reason: "artifact_write_failed" });
  await expect(readReplacementArtifact(reservation)).resolves.toBe("replacement bytes");
});

it("returns an unusable reservation when the complete artifact I/O capability is absent", async () => {
  reserveReviewArtifact = createReviewArtifactReservationPort(
    fileReader,
    writer,
    undefined,
    recordAdvisory,
  ).reserve;

  await expect(reserveReviewArtifact()).resolves.toEqual({
    status: "unusable",
    reason: "artifact_storage_unavailable",
  });
  expect(workerInput).not.toContain(".justice/reviews/");
});

it("retries a colliding artifact candidate with a fresh UUID and path", async () => {
  createExclusiveMarker
    .mockResolvedValueOnce({ kind: "occupied" })
    .mockResolvedValueOnce({
      kind: "created",
      leasePath: ".justice/reviews/.leases/second.lease",
      artifactIdentity: { device: "1", inode: "2" },
    });
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
  expect(injectedReviewDeliveries()).toEqual([
    {
      parentSessionId: currentFinalClaim.parentSessionId,
      directive: { kind: "review_required", correlation: nextFinalReviewCorrelation() },
    },
  ]);

  await recoverReviewDispatchesAfterRestart();
  expect(durableTransitions(null, "pending", nextFinalReviewCorrelation())).toHaveLength(1);
  expect(durableTransitions("pending", "claimed")).toHaveLength(0);
  expect(injectedReviewDeliveries()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        directive: { kind: "review_required", correlation: nextFinalReviewCorrelation() },
      }),
    ]),
  );
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

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/hooks/plan-bridge.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/node-file-system.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: FAIL at the offer assertions: the pre-change implementation has no durable candidate selector,
cannot rediscover an undispatched lifecycle candidate after restart, and does not establish
`terminal-committed -> next-pending-committed -> directive-injected` through the shared offer boundary. The
test setup defines its fixtures and calls only planned production signatures; the RED failure is an assertion
failure, not an unresolved symbol or argument-count/type error.
The four unreadable-Authorization tests also fail behaviorally because the strict full-read rejection currently
escapes `offerNextMandatoryReview` / `claimReviewDispatch`; the runtime fail-open routing test fails because the
rejection is not normalized to the existing non-blocking HookResponse. The failures must not be caused by an
undefined advisory, missing helper, invented `PROCEED` type, or invalid matcher.

- [ ] **Step 3: Implement durable dispatch and claim**

The same Step 3 must add the production composition and PreToolUse route below. The code is
part of the Task 3.4 implementation, not an appendix or a later integration task. Adapter
details such as the exact authoritative-reader method names are resolved against the existing
Task 2.2 ports, but every port shown here must be bound to a real shared instance.

```ts
type ReviewDirectiveSink = {
  readonly deliver: (delivery: ReviewDirectiveDelivery) => Promise<void>;
  readonly drainForParentSession: (
    parentSessionId: string,
    decide: (
      delivery: ReviewDirectiveDelivery,
    ) => Promise<"inject" | "discard" | "retain">,
  ) => Promise<readonly ReviewDirectiveDelivery[]>;
};

// Task 3.4 owns these shapes because its append adapter and claim protocol compile
// independently; Task 3.6 imports them for completion consumption.
type PendingReviewDispatchTransitionRecord = Omit<ReviewDispatchTransitionRecord, "sequence">;
type ReviewTaskCallBinding =
  | Extract<TaskCallBinding, { readonly purpose: "task_review" }>
  | Extract<TaskCallBinding, { readonly purpose: "final_review" }>;

function createReviewDirectiveSink(): ReviewDirectiveSink {
  const deliveriesByParent = new Map<string, ReviewDirectiveDelivery[]>();
  const restoreWithoutDuplicates = (
    parentSessionId: string,
    deliveries: readonly ReviewDirectiveDelivery[],
  ): void => {
    const existing = deliveriesByParent.get(parentSessionId) ?? [];
    const restored = [...deliveries, ...existing].filter(
      (delivery, index, all) =>
        all.findIndex(
          (candidate) =>
            sameReviewCorrelation(candidate.directive.correlation, delivery.directive.correlation),
        ) === index,
    );
    if (restored.length > 0) deliveriesByParent.set(parentSessionId, restored);
  };

  return {
    async deliver(delivery) {
      const deliveries = deliveriesByParent.get(delivery.parentSessionId) ?? [];
      if (
        deliveries.some((existing) =>
          sameReviewCorrelation(existing.directive.correlation, delivery.directive.correlation),
        )
      ) {
        return;
      }
      deliveriesByParent.set(delivery.parentSessionId, [...deliveries, delivery]);
    },
    async drainForParentSession(parentSessionId, decide) {
      const deliveries = deliveriesByParent.get(parentSessionId) ?? [];
      deliveriesByParent.delete(parentSessionId);
      const inject: ReviewDirectiveDelivery[] = [];
      const retain: ReviewDirectiveDelivery[] = [];
      try {
        for (const delivery of deliveries) {
          const decision = await decide(delivery);
          switch (decision) {
            case "inject":
              inject.push(delivery);
              break;
            case "retain":
              retain.push(delivery);
              break;
            case "discard":
              break;
            default: {
              const _exhaustive: never = decision;
              return _exhaustive;
            }
          }
        }
      } catch (cause: unknown) {
        // A failed validation is uncertain, not proof that a directive is stale.
        restoreWithoutDuplicates(parentSessionId, deliveries);
        throw cause;
      }
      if (retain.length > 0) restoreWithoutDuplicates(parentSessionId, retain);
      return inject;
    },
  };
}

// src/core/review-dispatch-state.ts
export type QueuedReviewDirectiveValidation = "inject" | "discard" | "retain";

// This is a Review Dispatch operation, not a generic queue-validation pipeline.
// Define it inside createReviewDispatchState(dependencies); its caller already owns
// the shared parent-session boundary.
async function validateQueuedReviewDirectiveWithinParentSessionClaim(
  delivery: ReviewDirectiveDelivery,
): Promise<QueuedReviewDirectiveValidation> {
  try {
    const records = await dependencies.readDurableRecords();
    const slots = projectReviewDispatchSlots(records).filter(
      (slot) =>
        slot.key.parentSessionId === delivery.parentSessionId &&
        sameReviewCorrelation(slot.key.correlation, delivery.directive.correlation),
    );
    if (slots.length !== 1) return "discard";
    const slot = slots[0];
    if (slot === undefined || slot.state !== "pending") return "discard";

    const authorizations = await dependencies.readDurableAuthorizations();
    const authorization = authorizations.find(
      (candidate) =>
        candidate.authorizationId === authorizationIdFor(slot.key.correlation) &&
        candidate.status === "active",
    );
    if (authorization === undefined) return "discard";
    if (!reviewCorrelationUsesAuthorizationSnapshot(slot.key.correlation, authorization)) {
      return "discard";
    }
    if (!(
      await isCurrentActiveAuthorization(slot.key.correlation, dependencies.findAuthorizationById)
    )) {
      return "discard";
    }
    const lifecycle = project(records, new Date().toISOString()).lifecycle;
    return reviewCorrelationMatchesCurrentLifecycle(
      slot.key.correlation,
      lifecycle,
      records,
      authorizations,
    )
      ? "inject"
      : "discard";
  } catch (cause: unknown) {
    await recordAdvisorySafely(dependencies, "review_directive_delivery_unreadable", cause);
    return "retain";
  }
}

// Include this function in the object returned by createReviewDispatchState.
// It is called only by the composition root while that root holds the same
// AuthorizationReviewBoundary parent-session claim used by claim/cancellation.

class JusticePlugin {
  private readonly reviewDispatchState: ReturnType<typeof createReviewDispatchState>;
  private readonly reviewDirectiveSink: ReviewDirectiveSink;
  private readonly recordReviewAdvisory: (advisory: string, cause?: unknown) => Promise<void>;
  // `writerId`, `observationLogStore`, `authorizationReviewBoundary`, and `authorizationStore`
  // are the fields created by Tasks 3.1 and 2.2; do not redeclare or recreate them here.
}
```

// Insert at the end of the existing JusticePlugin constructor, after the existing
// ObservationHandler and PlanBridge wiring has completed. This is an additive block, not a
// replacement constructor:
```ts
const reviewDirectiveSink = createReviewDirectiveSink();
this.recordReviewAdvisory = (advisory, cause) =>
  appendReviewDispatchAdvisory(this.observationLogStore, this.writerId, advisory, cause);
const reviewArtifactReservationPort = createReviewArtifactReservationPort(
  fileReader,
  fileWriter,
  this.options.reservedReviewArtifactIo,
  this.recordReviewAdvisory,
);

this.reviewDirectiveSink = reviewDirectiveSink;
this.reviewDispatchState = createReviewDispatchState({
  readDurableRecords: () => this.observationLogStore.readAll(),
  // `readDurableAuthorizations` is a Review Dispatch port, not an
  // AuthorizationStore method; the authoritative production implementation
  // is the existing strict `AuthorizationStore.hydrate()` API.
  readDurableAuthorizations: () => this.authorizationStore.hydrate(),
  findAuthorizationById: (authorizationId) =>
    this.authorizationStore.findByAuthorizationId(authorizationId),
  appendReviewDispatchTransition: (input) =>
    appendReviewDispatchTransitionToStore(this.observationLogStore, input),
  reserveReviewArtifact: () => reviewArtifactReservationPort.reserve(),
  injectReviewRequiredDirective: (delivery) => this.reviewDirectiveSink.deliver(delivery),
  withAuthorizationReviewBoundary: this.authorizationReviewBoundary.withParentSession,
  hydrateAuthorizationsBeforeReviewRecovery: () => this.authorizationStore.hydrate(),
  recordAdvisory: this.recordReviewAdvisory,
});

// The same state instance owns both dispatch cancellation and the lifecycle offer callback.
this.planBridge.setReviewDispatchCancellation(
  this.reviewDispatchState.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim,
);
this.observationHandler.setReviewPendingCommittedHandler((parentSessionId) =>
  this.reviewDispatchState.offerNextMandatoryReview(parentSessionId),
);
```

Add only this optional runtime input to the existing `JusticePluginOptions`; it is an injected review-artifact
capability, not a debug interface and not a new `FileWriter` requirement.

```ts
export interface JusticePluginOptions {
  // Existing options remain unchanged.
  readonly reservedReviewArtifactIo?: ReservedReviewArtifactIo;
}
```

The sole production composition owner is `OpenCodeAdapter.#runInit()` in
`src/runtime/opencode-adapter.ts`. It first calls
`createLinuxOpenat2ReviewArtifactProvider(root)` exactly once, then passes that provider into the one
`NodeFileSystem` instance. `NodeFileSystem` exposes the provider's optional
`createExclusiveMarker` callback and calls `createReservedReviewArtifactIo()` exactly once; the
returned capability is conditionally passed to the same `JusticePlugin` constructor that receives
`localFs`, the shared `ObservationLogStore`, and the shared `AuthorizationStore`. Test compositions
pass `createMockReservedReviewArtifactIo(files)` explicitly. A runtime that has no review-artifact
capability passes no option; reservation is then unusable and the artifact path is never included in
the worker payload. Do not derive the capability from `FileWriter` with `instanceof`, do not add it
to unrelated storage interfaces, and do not introduce a generic filesystem DI layer.

```ts
// src/runtime/opencode-adapter.ts, OpenCodeAdapter.#runInit()
const reviewArtifactProvider = createLinuxOpenat2ReviewArtifactProvider(root);
const localFs = new NodeFileSystem(root, reviewArtifactProvider);
const reservedReviewArtifactIo = localFs.createReservedReviewArtifactIo();
const reviewArtifactOptions: Pick<JusticePluginOptions, "reservedReviewArtifactIo"> =
  reservedReviewArtifactIo === undefined ? {} : { reservedReviewArtifactIo };

const justice = new JusticePlugin(localFs, localFs, {
  logger: loggerAdapter,
  onError: (err): void => {
    void this.log("error", "[Justice] internal error", err);
  },
  globalFileSystem: globalFs ?? undefined,
  notifier,
  writerId,
  workspaceRoot: root,
  ...reviewArtifactOptions,
});
```

`tests/runtime/opencode-adapter-v2.test.ts` must exercise this exact composition path, not a direct
`new JusticePlugin(...)` substitute. It spies on the runtime capability factory, returns one sentinel
`ReservedReviewArtifactIo`, calls `adapter.ensureInitialized()`, and inspects the constructed plugin
through an `unknown` cast to assert that the same sentinel is stored in
`JusticePluginOptions.reservedReviewArtifactIo`. A second case returns `undefined` and asserts that a
review claim reaches the existing `artifact_reservation_unusable` fail-open path without exposing an
artifact path. The test must restore the prototype spy in `finally` and must not add a production test hook.

The production task route must branch before `PlanBridge.handlePreToolUse()` while preserving
the existing observation handler and response merger. `buildReviewClaimResponse` must use the
committed binding and reservation only; it must never copy a correlation or artifact path from
the incoming task payload.

```ts
private async mergePreToolUseWithReviewDeliveries(
  parentSessionId: string,
  response: HookResponse,
): Promise<HookResponse> {
  const deliveries = await this.authorizationReviewBoundary
    .withParentSession(parentSessionId, () =>
      this.reviewDirectiveSink.drainForParentSession(parentSessionId, (delivery) =>
        this.reviewDispatchState.validateQueuedReviewDirectiveWithinParentSessionClaim(delivery),
      ),
    )
    .catch(async (cause: unknown): Promise<readonly ReviewDirectiveDelivery[]> => {
      await this.recordReviewAdvisory("review_directive_delivery_validation_failed", cause);
      return [];
    });
  return deliveries
    .reduce(
      (merged, delivery) =>
        mergePreToolUseResponses(
          merged,
          { action: "inject", injectedContext: formatReviewDirective(delivery.directive) },
          (message) => this.warnMergeConflict(message),
        ),
      response,
    );
}

case "PreToolUse": {
  // Preserve the existing callId-keyed window lifecycle for every task call. Review
  // calls have no implementation task ID, so only the non-review branch re-registers it.
  openSessionTaskWindow(this.sessionStateProvider, event);
  const capturedGeneration = this.sessionStateProvider.getSessionGeneration(event.sessionId);
  const observation = await this.observationHandler.handlePreToolUse(event).catch((error: unknown) => {
    this.options.logger?.warn("review observation pre-tool-use failed", error);
    return PROCEED;
  });

  const category =
    event.payload.toolName === "task"
      ? resolveMandatoryReviewCategory(event.payload.toolInput)
      : undefined;
  const isReviewRoute = category !== undefined;
  let delegated: HookResponse = PROCEED;
  if (isReviewRoute) {
    const callId = event.callId;
    if (callId === undefined || callId.trim().length === 0) {
      await this.recordReviewAdvisory("review_call_id_missing");
    } else {
      const agentId = this.sessionStateProvider.getAgentId(event.sessionId);
      const claim = await this.reviewDispatchState
        .claimReviewDispatch({
          parentSessionId: event.sessionId,
          callId,
          expectedCategory: category,
          agentId,
          sessionId: event.sessionId,
          writerId: this.writerId,
        })
        .catch((error: unknown): ClaimReviewDispatchOutcome => {
          void this.recordReviewAdvisory("review_claim_failed", error);
          return { kind: "blocked", advisory: "review_claim_failed" };
        });
      delegated = buildReviewClaimResponse(event, claim);
    }
  } else if (event.payload.toolName === "task") {
    delegated = await this.planBridge.handlePreToolUse(event).catch((error: unknown) => {
      this.options.logger?.warn("plan-bridge pre-tool-use failed", error);
      return PROCEED;
    });
  }

  const reviewWrite =
    event.payload.toolName === "write"
      ? await this.handleReviewArtifactWrite(event).catch(async (error: unknown) => {
          await this.recordReviewAdvisory("review_artifact_write_rejected", error).catch(
            () => undefined,
          );
          return { action: "skip" as const, reason: "review_artifact_write_rejected" as const };
        })
      : undefined;
  const response = mergePreToolUseResponses(
    mergePreToolUseResponses(
      observation,
      reviewWrite ?? PROCEED,
      (message) => this.warnMergeConflict(message),
    ),
    delegated,
    (message) => this.warnMergeConflict(message),
  );
  if (!isReviewRoute) {
    const taskId = resolveTaskIdFromModifiedPayload(
      response.action === "inject" ? response.modifiedPayload : undefined,
    );
    const planPath = this.planBridge.getActivePlan(event.sessionId);
    if (event.payload.toolName === "task" && taskId !== undefined && planPath !== null) {
      this.taskFeedback.setActivePlan(event.sessionId, planPath, taskId);
    }
    if (event.callId !== undefined && taskId !== undefined) {
      try {
        const currentGeneration = this.sessionStateProvider.getSessionGeneration(event.sessionId);
        if (capturedGeneration !== undefined && currentGeneration === capturedGeneration) {
          this.sessionStateProvider.setActiveTaskWindow(event.callId, taskId, event.sessionId);
        }
      } catch (error) {
        this.options.logger?.warn("failed to set active task window", error);
      }
    }
  }
  return await this.mergePreToolUseWithReviewDeliveries(
    event.sessionId,
    response,
  );
}
```

`resolveMandatoryReviewCategory` must accept only exact `sp-review` and `sp-final-review`,
`buildReviewClaimResponse` must produce only the existing `HookResponse` union, and all helper
failures must remain inside the review branch. A review task must never consume an implementation
arm or fall through to the PlanBridge route. Task 3.4 ends after this PreToolUse claim path and
the durable dispatch operations; the PostToolUse completion branch is implemented and wired only
in Task 3.6.

The PostToolUse composition in Task 3.6 must drain the same sink after every parallel handler has
settled, then merge only current-pending-authority deliveries into the response returned for that
very event. The root route invokes the Review Dispatch validator while holding the existing shared
parent-session boundary; `inject` and stale `discard` items leave the sink, while unreadable /
uncertain items are retained for the next matching root hook. The sink is not drained only by the
PreToolUse branch, and no individual domain handler may consume it. The response merger must
preserve the existing observation, PlanBridge, TaskFeedback, and Gate contexts while adding each
validated review directive as an ordinary `inject` response:

```ts
private async mergePostToolUseWithReviewDeliveries(
  parentSessionId: string,
  response: HookResponse,
): Promise<HookResponse> {
  const deliveries = await this.authorizationReviewBoundary
    .withParentSession(parentSessionId, () =>
      this.reviewDirectiveSink.drainForParentSession(parentSessionId, (delivery) =>
        this.reviewDispatchState.validateQueuedReviewDirectiveWithinParentSessionClaim(delivery),
      ),
    )
    .catch(async (cause: unknown): Promise<readonly ReviewDirectiveDelivery[]> => {
      await this.recordReviewAdvisory("review_directive_delivery_validation_failed", cause);
      return [];
    });
  const directiveResponses: readonly HookResponse[] = deliveries
    .map((delivery) => ({
      action: "inject" as const,
      injectedContext: formatReviewDirective(delivery.directive),
    }));
  return mergePostToolUseResponses(
    [response, ...directiveResponses],
    (message) => this.warnMergeConflict(message),
  );
}

// In the root PostToolUse route, after every handler has settled:
const response = await (
  event.payload.toolName === "task"
    ? this.routeTaskPostToolUse(event)
    : this.observationHandler.handlePostToolUse(event)
).catch((error: unknown) => {
  void this.recordReviewAdvisory("post_tool_use_route_failed", error);
  return PROCEED;
});
return await this.mergePostToolUseWithReviewDeliveries(event.sessionId, response);
```

This drain occurs after Task 3.6 has run `consumeReviewCompletion` and after any Task 3.1
lifecycle offer performed during the same hook invocation. A directive produced after its durable
`pending` append therefore reaches the Controller in that PostToolUse `HookResponse`; it is not
dependent on a later unrelated PreToolUse. If a handler fails, the fail-open catch must still
return through the same drain-and-merge helper before closing the task window. Startup recovery
has no current hook response, so it queues the delivery and the next Controller-facing PreToolUse
or PostToolUse drain reissues it once. The root `JusticePlugin` route is the only sink consumer.

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

The bulk `readDurableAuthorizations()` port is explicitly allowed to reject because Task 2.2 uses strict
authoritative persistence for Authorization. In the live offer and claim paths, both the initial read and the
post-convergence reread are narrow authority-unavailable branches: catch the rejection inside the already-held
parent-session boundary, record `review_authorization_unreadable` best-effort, converge only the current same-parent
`pending | claimed` slots through the existing within-parent cancellation helper, and return before candidate
selection, reservation, claim, append of a new pending/claimed state, or directive injection. Never replace the
rejected result with `[]`; an unreadable Authorization is not an authoritative empty state. The cancellation and
advisory attempts are themselves best-effort and must not turn this blocked outcome into a rejection.

`ClaimInput` は correlation field を持たない。`claimReviewDispatch` first selects the durable pending slot,
then uses only `pending.key.correlation` for every
Authorization lookup, cancellation authorization ID, claimed transition, binding, and artifact-reservation
association. A missing, multiple, or category-mismatched slot returns `review_claim_unavailable` before any
Authorization lookup or state mutation.

`reserveReviewArtifact` uses the fixed P0 constant
`MAX_ARTIFACT_RESERVATION_ATTEMPTS = 3`. For each attempt it generates a fresh UUID, builds
`.justice/reviews/<artifactId>.json`, validates it with `normalizeSafeRelativePath`, and calls the
injected optional `FileWriter.createExclusiveMarker` before dispatch. On the supported provider, the
provider root opens/anchors `.justice/reviews` and `.justice/leases` during capability initialization;
the reservation port must not call generic `fileWriter.mkdir` for these directories. When that capability
is absent, reservation returns `artifact_storage_unavailable` before directory creation,
`fileExists`, or `writeFile`; it never falls back to check-then-use creation.
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
rejected before artifact parsing. The injected reservation port may be usable only when the runtime exposes
the descriptor-relative/no-follow operation; generic pathname `readFile` / `writeFile` is not sufficient for
this artifact path. The supported Linux path uses `LinuxOpenat2ReviewArtifactProvider` through
`NodeFileSystem`; unsupported runtimes must return `artifact_storage_unavailable` without creating a worker
artifact path. The provider's probe and runtime tests must cover the ancestor-swap cases before any capability
is exposed. Cleanup must refuse to unlink a replacement path, retain an advisory, and remove the private lease
only when the runtime can perform identity-verified deletion.

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

export type ReviewDirectiveDelivery = {
  readonly parentSessionId: string;
  readonly directive: ReviewRequiredDirective;
};

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
  readonly injectReviewRequiredDirective: (delivery: ReviewDirectiveDelivery) => Promise<void>;
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

async function handleUnreadableAuthorizationWithinParentSessionClaim(
  parentSessionId: string,
  cause: unknown,
): Promise<void> {
  try {
    await recordAdvisory("review_authorization_unreadable", cause);
  } catch {
    // The authority-unavailable outcome must survive advisory I/O failure.
  }

  let slots: readonly ReviewDispatchSlot[];
  try {
    slots = projectReviewDispatchSlots(await readDurableRecords());
  } catch {
    return;
  }

  const authorizationIds = [
    ...new Set(
      slots
        .filter(
          (slot) =>
            slot.key.parentSessionId === parentSessionId &&
            (slot.state === "pending" || slot.state === "claimed"),
        )
        .map((slot) => authorizationIdFor(slot.key.correlation)),
    ),
  ];
  for (const authorizationId of authorizationIds) {
    try {
      await cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim(
        parentSessionId,
        authorizationId,
      );
    } catch {
      // Cancellation is best-effort; unreadable Authorization remains blocked.
    }
  }
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
  let initialAuthorizations: readonly ApprovedPlanBinding[];
  try {
    initialAuthorizations = await readDurableAuthorizations();
  } catch (cause) {
    await handleUnreadableAuthorizationWithinParentSessionClaim(parentSessionId, cause);
    return { kind: "blocked" };
  }
  await convergeStaleReviewSlotsWithinParentSessionClaim(
    parentSessionId,
    initialSlots,
    initialAuthorizations,
  );
  const records = await readDurableRecords();
  const slots = projectReviewDispatchSlots(records);
  let authorizations: readonly ApprovedPlanBinding[];
  try {
    authorizations = await readDurableAuthorizations();
  } catch (cause) {
    await handleUnreadableAuthorizationWithinParentSessionClaim(parentSessionId, cause);
    return { kind: "blocked" };
  }
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
    parentSessionId,
    directive: {
      kind: "review_required",
      correlation: candidate.correlation,
    },
  });
  return { kind: "offered", correlation: candidate.correlation };
}

async function claimReviewDispatch(input: ClaimInput): Promise<ClaimReviewDispatchOutcome> {
  return serializeParentSessionClaim(input.parentSessionId, async () => {
    const initialSlots = projectReviewDispatchSlots(await readDurableRecords());
    let initialAuthorizations: readonly ApprovedPlanBinding[];
    try {
      initialAuthorizations = await readDurableAuthorizations();
    } catch (cause) {
      await handleUnreadableAuthorizationWithinParentSessionClaim(input.parentSessionId, cause);
      return { kind: "blocked", advisory: "review_authorization_unreadable" };
    }
    await convergeStaleReviewSlotsWithinParentSessionClaim(
      input.parentSessionId,
      initialSlots,
      initialAuthorizations,
    );
    const slots = projectReviewDispatchSlots(await readDurableRecords());
    let authorizations: readonly ApprovedPlanBinding[];
    try {
      authorizations = await readDurableAuthorizations();
    } catch (cause) {
      await handleUnreadableAuthorizationWithinParentSessionClaim(input.parentSessionId, cause);
      return { kind: "blocked", advisory: "review_authorization_unreadable" };
    }
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
      parentSessionId: latest.key.parentSessionId,
      directive: {
        kind: "review_required",
        correlation: latest.key.correlation,
      },
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

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/hooks/plan-bridge.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/node-file-system.test.ts tests/core/justice-plugin-routing.test.ts`

Expected: PASS.
The unreadable-Authorization assertions must additionally prove:

- offer full-read rejection resolves `{ kind: "blocked" }` and claim full-read rejection resolves `{ kind: "blocked", advisory: "review_authorization_unreadable" }`;
- neither initial nor reread failure rejects its ordinary live caller;
- unreadable Authorization creates no new pending transition, directive, reservation, claimed transition, Gate, Acceptance, or Progress positive state;
- existing same-parent `pending | claimed` slots receive only a best-effort cancellation-tombstone attempt and remain unclaimable;
- cancellation uses the already-held parent boundary with zero nested acquisition;
- the live mandatory-review PreToolUse integration continues through the existing non-blocking `HookResponse` shape.
- `tests/core/justice-plugin-routing.test.ts` observes the production plugin path and exactly one
  seeded `null -> pending` transition plus one same-parent `pending -> terminal(cancelled)` transition;
  it invokes the real `plugin.handleEvent()` and does not mock `handleEvent()` or the claim operation.

- [ ] **Step 5: Commit after approval**

```bash
GIT_MASTER=1 git add src/core/review-dispatch-state.ts src/core/review-artifact-reservation.ts src/core/types.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/hooks/observation-handler.ts src/hooks/plan-bridge.ts src/runtime/opencode-adapter.ts src/runtime/node-file-system.ts src/core/justice-plugin.ts tests/helpers/mock-file-system.ts tests/core/review-dispatch-state.test.ts tests/core/review-artifact-reservation.test.ts tests/core/v2/state-projection.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/hooks/plan-bridge.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/node-file-system.test.ts tests/core/justice-plugin-routing.test.ts
GIT_MASTER=1 git commit -m "feat: durable review dispatchとclaimを追加"
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
- Create: `tests/helpers/captured-runtime-events.ts`

**Consumes:** the exact runtime event/API and field paths recorded by Task 3.3; projected claimed dispatch slot; `TaskCallBinding`; trusted `ReviewCorrelation`.
The adapter and observation handler provide the runtime event and append operations as injected
boundaries; core projection and binding logic must not import OpenCode runtime types or access the
filesystem directly.

**Produces:** `DelegatedExecutionRelationObserved` from the adapter and a durable `DelegatedExecutionBinding` whose `ExecutionScope` is derived from the claimed slot, never from worker input.

It also exports the projection helper used by Task 3.6:
`projectObservedReviewExecution(records, delegatedBinding): ObservedReviewExecutionV1 | undefined`.
The helper selects the single durable, observed relation record that produced the binding, copies its stable
runtime event ID, and derives `parentSessionId`, parent `callId`, child session, and trusted correlation from
the binding/current claimed slot. It returns `undefined` for missing, duplicate, stale, or declared-only
relations; it never derives provenance from `PostToolUse` payload, artifact path, category, prompt, or worker
output.

`tests/helpers/captured-runtime-events.ts` exports `capturedRuntimeEvents(category, parentCallId,
childSessionId)`. It contains the exact successful Task 3.3 runtime event/API field paths and returns
fresh event objects for each test. It must throw when the required parent-call/child-session relation is
absent; it must not synthesize a relation from worker-provided metadata or return an empty array.
It also exports `CapturedReviewKind = "task-review" | "final-review"`; the helper's category argument
accepts the exact runtime categories `"sp-review" | "sp-final-review"` and maps them to that kind only
after the relation fixture has been validated.

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
GIT_MASTER=1 git add src/runtime/opencode-adapter.ts src/core/types.ts src/hooks/observation-handler.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts tests/helpers/captured-runtime-events.ts tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/v2/state-projection.test.ts
GIT_MASTER=1 git commit -m "feat: review child bindingをdurableに記録"
```

### Task 3.6: Consume a matching review artifact exactly once

**Requirement:** JUS-P0-02, JUS-P0-04, INV-06, INV-13, INV-15 through INV-21, Design §4.8.1, §4.8.2, §4.10, §4.11, §12.2, §12.4, §12.5, §12.7, F-043, F-045, F-046, F-047, F-048, and the PostToolUse portion of §12.6.

Task 3.6 owns the purpose-aware review PostToolUse router, the completion-domain call, and
the composition-root startup wiring that invokes completion recovery before Review Dispatch
recovery. It consumes the Task 3.4 dispatch state and its within-parent capability; it does
not reconstruct a second boundary or move PreToolUse claim logic into the completion domain.

**Files:**

- Create: `src/core/review-artifact.ts`
- Modify: `src/core/review-dispatch-state.ts`
- Modify: `src/core/session-state-provider.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/state-projection.ts`
- Modify: `src/runtime/validation.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Test: `tests/core/review-artifact.test.ts`
- Test: `tests/core/review-artifact-reservation.test.ts`
- Test: `tests/core/session-state-provider.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/runtime/validation.test.ts`
- Test: `tests/hooks/observation-handler-transactional.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`
- Test: `tests/core/justice-plugin.test.ts`
- Modify: `src/core/hook-response-merger.ts`
- Test: `tests/core/hook-response-merger.test.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`
- Modify: `src/opencode-plugin.ts`
- Test: `tests/integration/opencode-plugin.test.ts`
- Create: `tests/helpers/review-artifact-e2e-fixture.ts`
- Test: `tests/integration/review-artifact-linux-e2e.test.ts` (adapter/composition integration)
- Test: `tests/integration/review-artifact-linux-host-e2e.test.ts` (supported OpenCode host acceptance)

`tests/core/justice-plugin-routing.test.ts` is the shared production routing file: Task 3.4
owns its live PreToolUse claim cases and Task 3.6 adds its matching review PostToolUse cases.
`tests/hooks/observation-handler-transactional.test.ts` is owned by Task 3.5 for durable child
binding cases and extended by this task for completion staging, terminalization, and stale-event
cases. `tests/core/v2/state-projection.test.ts` is extended here only for completion-record
projection and restart recovery; its dispatch-slot and child-binding cases remain owned by Tasks
3.4 and 3.5 respectively. `tests/core/justice-plugin.test.ts` is owned here for single-boundary
composition and startup ordering.

`tests/integration/review-artifact-linux-e2e.test.ts` is the required adapter/composition integration test.
It runs only on the supported Linux x86_64 deployment after `bun run build:native:review-artifact`; on every
other platform or when the provider probe is unavailable it must fail as unsupported setup rather than
silently skip the P0 path. It constructs the real `OpenCodeAdapter` and `JusticePlugin`, seeds one active
Authorization and review-pending lifecycle, drives a `sp-review` PreToolUse claim, and then drives the child-session
write followed by the parent task's matching PostToolUse event. It proves composition behavior only: the committed
artifact path is the only path exposed to the adapter; `run_in_background` is `false`; the write is mediated
by `writeExisting` and does not call the generic `FileWriter.writeFile`; the one `readOnce` consumes the
matching artifact; replacement and symlink cases are rejected before JSON parsing; the terminal record is
durable before Gate/Acceptance; and cleanup retains a replacement with `replacement_retained` and an
advisory. Run the same flow for `sp-final-review`, including its finalization identity and stale-round
rejection. This direct adapter test is not host acceptance evidence.

`tests/integration/review-artifact-linux-host-e2e.test.ts` is the separate production host acceptance. It
must invoke the exact supported OpenCode CLI `1.18.29`, load the built Justice plugin through the real host
plugin loader, and execute both task-review and final-review flows through actual `task` and `write` tool
dispatch. It must observe the actual child worker receiving `run_in_background = false` and the exact committed
artifact path, then observe secure artifact write, the parent task's matching PostToolUse, Gate, and Acceptance. The rejected
symlink and inode replacement cases must throw the dedicated cancellation through the host boundary, invoke
the built-in writer zero times, leave the outside target and replacement unchanged, and never reach JSON
parsing, Gate, or Acceptance. Direct calls to `OpenCodeAdapter`, `JusticePlugin.handleEvent`, or
`consumeReviewCompletion` cannot substitute for this test.

The current OpenCode adapter method is `onToolExecuteBefore(...): Promise<void>` and its host-facing output
contract currently exposes only mutable `output.args`; it silently returns after an internal `{ action: "skip" }`.
The implementation must change that method to return the internal `HookResponse`, then have the plugin wrapper
throw a dedicated `ReviewArtifactWriteCancelled` only for the two review-artifact write reasons. A secure
commit maps to `review_artifact_write_committed`; every rejected review-owned write maps to
`review_artifact_write_rejected`. OpenCode's documented `tool.execute.before` hook is not treated as proven
until Task 3.3c and the host E2E observe that the throw prevents the built-in tool from executing. Ordinary
adapter and I/O failures remain fail-open. `tests/runtime/opencode-adapter-v2.test.ts`,
`tests/core/hook-response-merger.test.ts`, the adapter composition E2E, and the supported-host E2E must prove
the returned reason, reason preservation, narrow throw, and zero normal filesystem-writer invocations;
none may bypass the adapter with a direct child `JusticePlugin.handleEvent()` call.

The following are the complete boundary edits. They are not pseudocode: the implementation must preserve the
existing imports and normal inject/proceed behavior while applying these exact response and cancellation rules.
First extend `src/core/types.ts` before the `HookResponse` alias:

```ts
export type ReviewArtifactWriteSkipReason =
  | "review_artifact_write_committed"
  | "review_artifact_write_rejected";

export interface SkipResponse {
  readonly action: "skip";
  readonly reason?: ReviewArtifactWriteSkipReason;
}

export type HookResponse = ProceedResponse | SkipResponse | InjectResponse;
```

Replace `src/core/hook-response-merger.ts` with the same existing merge logic plus this complete reason
preservation path. A reasoned skip always wins over inject/proceed, a reasonless skip remains reasonless,
and two distinct reasons fail closed to `review_artifact_write_rejected`:

```ts
import type {
  HookResponse,
  InjectResponse,
  ReviewArtifactWriteSkipReason,
  SkipResponse,
} from "./types";

export type HookResponseConflictLogger = (message: string) => void;

function mergeSkipResponses(
  responses: readonly HookResponse[],
  onConflict?: HookResponseConflictLogger,
): SkipResponse {
  const reasons = responses.flatMap((response) =>
    response.action === "skip" && response.reason !== undefined ? [response.reason] : [],
  );
  const uniqueReasons = [...new Set<ReviewArtifactWriteSkipReason>(reasons)];
  if (uniqueReasons.length > 1) {
    onConflict?.("Conflicting review-artifact skip reasons; rejecting the host write");
    return { action: "skip", reason: "review_artifact_write_rejected" };
  }
  const reason = uniqueReasons[0];
  return reason === undefined ? { action: "skip" } : { action: "skip", reason };
}

export function mergePreToolUseResponses(
  a: HookResponse,
  b: HookResponse,
  onConflict?: HookResponseConflictLogger,
): HookResponse {
  if (a.action === "skip" || b.action === "skip") {
    return mergeSkipResponses([a, b], onConflict);
  }
  if (a.action === "inject" && b.action === "inject") {
    const contexts = [a.injectedContext, b.injectedContext].filter((context) => context !== "");
    const base: InjectResponse = {
      action: "inject",
      injectedContext: contexts.join("\n\n---\n\n"),
    };
    const result: InjectResponse =
      a.variant === "gate_advisory" || b.variant === "gate_advisory"
        ? { ...base, variant: "gate_advisory" }
        : base;
    if (a.modifiedPayload !== undefined && b.modifiedPayload !== undefined) {
      onConflict?.("Conflict detected in pre-tool-use modifiedPayload; using the first response");
    }
    if (a.modifiedPayload !== undefined) return { ...result, modifiedPayload: a.modifiedPayload };
    if (b.modifiedPayload !== undefined) return { ...result, modifiedPayload: b.modifiedPayload };
    return result;
  }
  if (a.action === "inject") return { ...a };
  if (b.action === "inject") return { ...b };
  return { action: "proceed" };
}

export function mergePostToolUseResponses(
  responses: readonly HookResponse[],
  onConflict?: HookResponseConflictLogger,
): HookResponse {
  if (responses.some((response) => response.action === "skip")) {
    return mergeSkipResponses(responses, onConflict);
  }
  const injects = responses.filter(
    (response): response is InjectResponse => response.action === "inject",
  );
  if (injects.length === 0) return { action: "proceed" };
  const contexts = injects.map((inject) => inject.injectedContext).filter((context) => context !== "");
  const normalContexts = injects
    .map(
      (inject) =>
        inject.normalInjectedContext ??
        (inject.variant === "gate_advisory" ? "" : inject.injectedContext),
    )
    .filter((context) => context !== "");
  const gateContexts = injects
    .map(
      (inject) =>
        inject.gateAdvisoryContext ??
        (inject.variant === "gate_advisory" ? inject.injectedContext : ""),
    )
    .filter((context) => context !== "");
  const base: InjectResponse = {
    action: "inject",
    injectedContext: contexts.join("\n\n---\n\n"),
  };
  const normalInjectedContext = normalContexts.join("\n\n---\n\n");
  const gateAdvisoryContext = gateContexts.join("\n\n---\n\n");
  const result: InjectResponse = {
    ...base,
    ...(normalInjectedContext.length === 0 ? {} : { normalInjectedContext }),
    ...(gateAdvisoryContext.length === 0 ? {} : { gateAdvisoryContext }),
    ...(gateAdvisoryContext.length === 0 ? {} : { variant: "gate_advisory" }),
  };
  const modifieds = injects.filter((inject) => inject.modifiedPayload !== undefined);
  if (modifieds.length > 1) {
    onConflict?.("Conflict detected in post-tool-use modifiedPayload; using the first response");
  }
  const single = modifieds[0];
  return single === undefined ? result : { ...result, modifiedPayload: single.modifiedPayload };
}
```

`src/runtime/opencode-adapter.ts` must return the actual internal response. Its complete method body keeps
the old in-place argument merge and normal fail-open catch; every old `return;` becomes `return PROCEED` or
`return response` as shown:

```ts
const PROCEED: HookResponse = { action: "proceed" };

async onToolExecuteBefore(
  input: { readonly tool: string; readonly sessionID: string; readonly callID: string },
  output: { args: Record<string, unknown> },
): Promise<HookResponse> {
  try {
    if (input.tool === "task") normalizeTaskToolInputInPlace(output.args);
    if (this.#noOp) return PROCEED;
    if (input.tool.startsWith("justice_")) return PROCEED;
    await this.ensureInitialized();
    const justice = this.#justice;
    if (justice === null) return PROCEED;

    const response = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: input.sessionID,
      callId: input.callID,
      payload: { toolName: input.tool, callId: input.callID, toolInput: output.args },
    });
    if (response.action !== "inject") return response;

    const originalPrompt = typeof output.args.prompt === "string" ? output.args.prompt : "";
    output.args.prompt = `${response.injectedContext}\n\n${originalPrompt}`;
    const modified = response.modifiedPayload as { args?: Record<string, unknown> } | undefined;
    if (modified?.args !== undefined) {
      for (const [key, value] of Object.entries(modified.args)) {
        if (key !== "prompt") output.args[key] = value;
      }
      if (input.tool === "task") normalizeTaskToolInputInPlace(output.args);
    }
    return response;
  } catch (error: unknown) {
    await this.log("error", "[Justice] onToolExecuteBefore failure", error);
    return PROCEED;
  }
}
```

Define `ReviewArtifactWriteCancelled` in the runtime/plugin boundary, not in `src/core`, and do not catch it
in the wrapper. `src/opencode-plugin.ts` imports `ReviewArtifactWriteSkipReason` as a type from
`src/core/types.ts`; the adapter continues to import only core-safe types and does not import the plugin
wrapper error:

```ts
export class ReviewArtifactWriteCancelled extends Error {
  readonly reason: ReviewArtifactWriteSkipReason;

  constructor(reason: ReviewArtifactWriteSkipReason) {
    super(`review artifact write cancelled: ${reason}`);
    this.name = "ReviewArtifactWriteCancelled";
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function cancellationReason(response: HookResponse): ReviewArtifactWriteSkipReason | undefined {
  if (response.action !== "skip") return undefined;
  return response.reason;
}

"tool.execute.before": async (input, output): Promise<void> => {
  const response = await adapter.onToolExecuteBefore(
    input as { tool: string; sessionID: string; callID: string },
    output as { args: Record<string, unknown> },
  );
  const reason = cancellationReason(response);
  if (reason !== undefined) throw new ReviewArtifactWriteCancelled(reason);
  if (!adapter.getJustice() && !adapter.isNoOp()) {
    debugLog("Justice: Prompt ignored by TriggerDetector (Justice not initialized or no delegation intent found).");
  }
};
```

Before the existing PostToolUse routing, add the review-artifact write branch to the same
`JusticePlugin.handleEvent(PreToolUse)` route. It must resolve the child session through the durable
`DelegatedExecutionBinding`, then resolve the claimed `TaskCallBinding` and its usable reservation.
For `toolName === "write"`, accept only a string `toolInput.filePath` that equals the committed
`artifactPath` after the existing safe-relative-path validation, and a string `toolInput.content`.
Call the injected `ReservedReviewArtifactIo.writeExisting(reservation, content)` and return
`{ action: "skip", reason: "review_artifact_write_committed" }` only after that write commits; the normal
OpenCode write tool must not run. A missing/stale child binding, path mismatch, invalid content, identity
mismatch, symlink/replacement, or provider error returns
`{ action: "skip", reason: "review_artifact_write_rejected" }` after recording a fail-closed advisory and
leaves the review slot without trusted completion evidence. The plugin wrapper must cancel the host built-in
writer for both reasons. Non-review writes and writes from unrelated child sessions retain the existing
routing. This is the only worker artifact-write path and is covered by both the adapter composition test and
the supported-host E2E.

The production `JusticePlugin` route is also concrete. It is called from the existing PreToolUse route after
observation and before any generic writer can run. `resolveReviewArtifactWriteContext` returns
`{ kind: "not_review" }` for unrelated writes, and returns a review context for an observed child session;
missing binding, stale binding, path mismatch, invalid content, identity mismatch, or provider failure all
return the rejected reason:

```ts
type ReviewArtifactWriteContext =
  | { readonly kind: "not_review" }
  | { readonly kind: "review"; readonly binding?: ReviewTaskCallBinding };

private async resolveReviewArtifactWriteContext(
  childSessionId: string,
): Promise<ReviewArtifactWriteContext> {
  const records = await this.observationHandler.getLogStore().readAll();
  const delegated = projectDelegatedExecutionBindings(records).find(
    (candidate) => candidate.childSessionId === childSessionId,
  );
  if (delegated === undefined) return { kind: "not_review" };
  const slot = projectReviewDispatchSlots(records).find(
    (candidate) =>
      candidate.state === "claimed" &&
      candidate.key.parentSessionId === delegated.parentSessionId &&
      candidate.callId === delegated.parentCallId &&
      isReviewDispatchSlot(candidate),
  );
  const binding = projectTaskCallBindings(records).find(
    (candidate): candidate is ReviewTaskCallBinding =>
      isReviewTaskCallBinding(candidate) &&
      slot !== undefined &&
      candidate.parentSessionId === delegated.parentSessionId &&
      candidate.callId === delegated.parentCallId &&
      reviewTaskCallBindingMatchesSlot(candidate, slot),
  );
  return binding === undefined ? { kind: "review" } : { kind: "review", binding };
}

private async handleReviewArtifactWrite(event: PreToolUseEvent): Promise<HookResponse | undefined> {
  if (event.payload.toolName !== "write" || event.sessionId === undefined) return undefined;
  const context = await this.resolveReviewArtifactWriteContext(event.sessionId);
  if (context.kind === "not_review") return undefined;
  const binding = context.binding;
  const input = event.payload.toolInput;
  const filePath = readStringRecordValue(input, "filePath");
  const content = readStringRecordValue(input, "content");
  if (
    binding === undefined ||
    binding.artifactReservation.status !== "usable" ||
    filePath === undefined ||
    content === undefined ||
    normalizeSafeRelativePath(filePath) !== binding.artifactReservation.artifactPath
  ) {
    await this.recordReviewAdvisory("review_artifact_write_rejected").catch(() => undefined);
    return { action: "skip", reason: "review_artifact_write_rejected" };
  }
  try {
    const reservedIo = this.options.reservedReviewArtifactIo;
    if (reservedIo === undefined) {
      await this.recordReviewAdvisory("review_artifact_write_rejected").catch(() => undefined);
      return { action: "skip", reason: "review_artifact_write_rejected" };
    }
    await reservedIo.writeExisting(binding.artifactReservation, content);
    await this.recordReviewAdvisory("review_artifact_write_committed").catch(() => undefined);
    return { action: "skip", reason: "review_artifact_write_committed" };
  } catch (error: unknown) {
    await this.recordReviewAdvisory("review_artifact_write_rejected", error).catch(() => undefined);
    return { action: "skip", reason: "review_artifact_write_rejected" };
  }
}
```

The `PreToolUse` route above invokes `handleReviewArtifactWrite` for `write` events and merges its
response with observation and delegation responses before the host can run the built-in writer. The
review-write branch is not a second route or a direct adapter call.

The `writeExisting` call above is the only review-owned writer. It must not call `FileWriter.writeFile`,
`readFile`, or any generic path helper after the reservation has been resolved. The helper must return
`not_review` only when the durable projection proves that the session is not an observed review child; an
observed review child with no current binding is rejected, not passed to the built-in writer.

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
It also consumes `ReviewDirectiveDelivery` only through the Task 3.4 sink handoff, the durable
`TaskCallBinding` purpose projection, the normalized `PostToolUseEvent`, the existing
`HookResponse` union and merger, and the shared `AuthorizationReviewBoundary` instance. Task 3.6
must resolve purpose and parent identity from durable projection before invoking completion; it
must not infer either value from category, prompt, artifact path, or worker output.
`AuthorizationRestorationOutcome` from Task 2.2 is consumed only by the final `JusticePlugin.initialize()`
control flow to decide whether authorization-dependent positive recovery is allowed; it is not a generic
startup-state abstraction.
All returned operations use the shared `withAuthorizationReviewBoundary` through the Task 3.4
parent-session boundary; no completion operation performs an Authorization check and later append
outside that boundary.
`consumeReviewCompletion`, staged-completion recovery, and post-terminal outcome recovery already own that
parent boundary. They must call only Task 3.2's within-boundary Gate capability, which retains
decision-identity serialization but never reacquires the parent boundary.
The completion consumer receives the normalized parent `task` `PostToolUse` identity plus an optional observed
execution. It resolves the claimed slot, `TaskCallBinding`, and `DelegatedExecutionBinding` from the durable
projection rather than trusting correlation, category, artifact path, or worker-provided metadata from the event.
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
`projectReviewArtifactCleanupState(records: readonly PersistedLogRecord[], identity:
{ readonly parentSessionId: string; readonly callId: string; readonly correlation: ReviewCorrelation; readonly artifactId: string }):
ProjectedReviewArtifactCleanupState`;
`appendReviewArtifactCleanupRecord(record: PendingReviewArtifactCleanupRecord): Promise<
  | { readonly kind: "committed"; readonly record: PersistedReviewArtifactCleanupRecord }
  | { readonly kind: "failed" }
>`;
`findMatchingTerminalForStaging(records: readonly PersistedLogRecord[], staged:
ReviewCompletionStagingRecord): ReviewDispatchTransitionRecord | undefined`;
`routeTaskPostToolUse(event): Promise<HookResponse>` and the production `JusticePlugin.handleEvent(PostToolUse)`
purpose branch; plus the `JusticePlugin.initialize()` startup wiring that runs staged completion recovery
before Task 3.4 Review Dispatch recovery on the same authoritative instance.
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
ReviewArtifactFailureStagingRecord`, the pending PostToolUse variant as `PendingEnvelope &
ReviewPostToolUsePendingRecord`, the read-attempt variant as `PendingEnvelope &
ReviewArtifactReadAttemptRecord`, and the cleanup variant as `PendingEnvelope & ReviewArtifactCleanupRecord`.
Include each pending shape in `PendingObservationRecord` and each `PersistedEnvelope & ...` shape, including
`PersistedReviewArtifactCleanupRecord`, in `PersistedLogRecord`; replay and projection must consume the same
strictly validated cleanup shape.
`appendReviewCompletionStaging` accepts the pending staging shape, `appendReviewArtifactFailureStaging`
accepts the failure staging shape, and `appendReviewPostToolUsePending` accepts the pending PostToolUse shape, while
`appendCompositeTerminalRecord` accepts a pending terminal transition and delegates to the existing
`appendReviewDispatchTransition` physical append boundary, which is the only boundary that assigns the
persisted sequence. `readAndAssembleMatchingArtifact` returns the nested `ReviewCompletionStaging`
payload after strict parse, classification, digest calculation, and observed-execution construction.
`ReviewPostToolUsePendingRecord` persists the parent session / call identity, purpose, and trusted correlation.
It optionally persists the observed child-session identity and `ObservedReviewExecutionV1` when the durable child
binding is already available; those fields are omitted when the parent task event wins the binding race. Restart
recovery must compare every present field with the current claimed slot and durable child binding before rereading
an artifact or terminalizing; any mismatch is rejected as stale/advisory.

The artifact `write` is a child-session `PreToolUse` operation and is handled by the review-artifact write
branch before the normal write tool runs. Completion consumption is triggered only by the parent `task` tool's
matching `PostToolUse` event, whose `sessionId` and `callId` are the claimed parent identity. The observed
execution supplied to the completion domain is resolved from the durable child binding; it is not inferred from
the parent event. Do not pass the child write call ID to `consumeReviewCompletion`, and do not use the worker's
artifact path, category, prompt, or output as a binding selector. The E2E test must exercise the child write
followed by the parent task PostToolUse in this order.
All artifact reads, durable appends, Authorization lookups, cleanup, lifecycle transitions, and Gate
requests in this task are injected ports.

Task 3.6 adds exactly one review-artifact-specific durable record to the existing Observation Log:

```ts
type ReviewArtifactCleanupRecord = {
  readonly recordType: "observation";
  readonly kind: "review_artifact_cleanup";
  readonly parentSessionId: string;
  readonly callId: string;
  readonly correlation: ReviewCorrelation;
  readonly artifactId: string;
} & (
  | { readonly phase: "started" }
  | {
      readonly phase: "finished";
      readonly status: ReviewArtifactCleanupStatus;
    }
);

type ProjectedReviewArtifactCleanupState =
  | { readonly kind: "not_started" }
  | { readonly kind: "outcome_uncertain" }
  | {
      readonly kind: "finished";
      readonly status: ReviewArtifactCleanupStatus;
    };

type PendingReviewArtifactCleanupRecord = PendingEnvelope & ReviewArtifactCleanupRecord;
type PersistedReviewArtifactCleanupRecord = PersistedEnvelope & ReviewArtifactCleanupRecord;

type ReviewArtifactCleanupIdentity = {
  readonly parentSessionId: string;
  readonly callId: string;
  readonly correlation: ReviewCorrelation;
  readonly artifactId: string;
};
```

`projectReviewArtifactCleanupState(records, identity)` selects only records matching the durable
parent/call/correlation/artifact identity and takes the latest one in `orderEventsForProjection()` order.
No new cleanup queue, cleanup database, background worker, transaction abstraction, or mutable cleanup row is
introduced. Before each permitted provider invocation, Task 3.6 must append `phase: "started"` durably.
Only after that commit may it call `cleanupArtifact`. It then appends `phase: "finished"` with the exact
provider outcome. If the started append fails, do not call the provider. If the provider throws, record
`cleanup_incomplete` when possible. If the finished append fails, latest durable state remains
`outcome_uncertain`; automatic recovery does not call the provider again.

Automatic invocation policy is exact:
- `not_started` -> one provider cleanup attempt may start;
- latest finished `cleanup_incomplete` -> one re-evaluation attempt may start;
- latest finished `cleaned`, `quarantine_retained`, or `replacement_retained` -> terminal, do not call provider;
- `outcome_uncertain` -> fail-closed retention, advisory only, do not call provider.

**Strict persisted cleanup validation / replay:** `ReviewArtifactCleanupRecord` is a closed durable
Observation Log variant, not an in-memory marker. `PendingObservationRecord` includes
`PendingReviewArtifactCleanupRecord`; `PersistedLogRecord` includes `PersistedReviewArtifactCleanupRecord`.
`src/runtime/validation.ts` must recognize the new kind before its unknown-observation fallback. Use the
following concrete validation delta; the correlation check mirrors the canonical `ReviewCorrelation` shape
and does not trust worker/path data:

```ts
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isValidPlanFingerprintValue(value: unknown): boolean {
  return isObject(value) && value.algorithm === "sha256" && isNonEmptyString(value.value);
}

function isValidReviewCorrelationValue(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.reviewKind === "task-review") {
    const ref = value.taskExecutionRef;
    return (
      isObject(ref) &&
      isNonEmptyString(ref.authorizationId) &&
      isNonEmptyString(ref.taskId) &&
      isNonEmptyString(ref.attemptId) &&
      isPositiveInteger(value.reviewRound)
    );
  }
  if (value.reviewKind === "final-review") {
    return (
      isNonEmptyString(value.planPath) &&
      isValidBootstrapPath(value.planPath) &&
      isNonEmptyString(value.authorizationId) &&
      isValidPlanFingerprintValue(value.planFingerprint) &&
      isNonEmptyString(value.finalizationAttemptId) &&
      isPositiveInteger(value.finalReviewRound)
    );
  }
  return false;
}

function isValidReviewArtifactCleanupStatus(value: unknown): value is ReviewArtifactCleanupStatus {
  return isOneOf(value, [
    "cleaned",
    "quarantine_retained",
    "replacement_retained",
    "cleanup_incomplete",
  ]);
}

function validateReviewArtifactCleanupRecord(r: Record<string, unknown>): void {
  const common =
    r.recordType === "observation" &&
    r.kind === "review_artifact_cleanup" &&
    isNonEmptyString(r.parentSessionId) &&
    isNonEmptyString(r.callId) &&
    isValidReviewCorrelationValue(r.correlation) &&
    isNonEmptyString(r.artifactId);
  const phase =
    (r.phase === "started" && r.status === undefined) ||
    (r.phase === "finished" && isValidReviewArtifactCleanupStatus(r.status));
  if (!common || !phase) throw new Error("Invalid review_artifact_cleanup record");
}

// Inside validateObservationRecord(r), before the unknown-kind fallback:
} else if (kind === "review_artifact_cleanup") {
  validateReviewArtifactCleanupRecord(r);
}
```

The same shape is used by pending append, persisted replay, and projection. A malformed cleanup record,
unknown status, `started` record carrying `status`, `finished` record missing `status`, empty identity field,
or malformed correlation is rejected and never becomes restart authority. Do not add a permissive unknown-kind
fallback.


Add the strict cleanup-record RED/GREEN cases to `tests/runtime/validation.test.ts` and the replay case to the
existing observation-log/projection fixture. These tests are part of Task 3.6, not a later hardening task:

```ts
it.each([
  { phase: "started" as const },
  { phase: "finished" as const, status: "cleaned" as const },
  { phase: "finished" as const, status: "quarantine_retained" as const },
  { phase: "finished" as const, status: "replacement_retained" as const },
  { phase: "finished" as const, status: "cleanup_incomplete" as const },
])("validates and replays review_artifact_cleanup %#", async (phase) => {
  const pending = validCleanupRecord(phase);
  const persisted = await appendAndReplay(pending);
  expect(() => validateRecordSchema(persisted)).not.toThrow();
  expect(projectReviewArtifactCleanupState([persisted], cleanupIdentity)).not.toEqual({
    kind: "not_started",
  });
});

it.each([
  validCleanupRecord({ phase: "started", status: "cleaned" }),
  validCleanupRecord({ phase: "finished" }),
  validCleanupRecord({ phase: "finished", status: "unknown_status" }),
  validCleanupRecord({ phase: "started", artifactId: "" }),
  validCleanupRecord({ phase: "started", callId: "" }),
  validCleanupRecord({ phase: "started", correlation: malformedCorrelation }),
])("rejects malformed review_artifact_cleanup replay authority", (record) => {
  expect(() => validateRecordSchema(record)).toThrow(/review_artifact_cleanup/u);
});
```

RED is valid only when these tests compile and fail because the cleanup kind/state-machine behavior has not yet
been implemented. Unknown-kind rejection by itself is not a valid behavioral RED after the Task 3.6 test source
has been added. GREEN must include `tests/runtime/validation.test.ts` together with the Task 3.6 completion and
projection tests.


 The core module must not import `ObservationLogStore`,
`AuthorizationStore`, OpenCode adapter types, or notifier implementations directly. The injected
`cleanupArtifact(reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>)`
port returns `Promise<ReviewArtifactCleanupStatus>` and receives the trusted reservation pair, not an
artifact path or ID from PostToolUse or worker output. The completion domain, not the provider adapter,
owns durable cleanup-attempt bookkeeping so provider status is never erased to `Promise<void>`. Both
`ensureConsumedReviewArtifactCleaned()` and `ensureFailedReviewArtifactCleaned()` call the same
`ensureReviewArtifactCleanupStateMachine()` helper; neither invokes `cleanupArtifact` directly. `readAndAssembleMatchingArtifact` must call the reservation port's descriptor-relative,
no-follow read using the trusted `artifactPath`, `leasePath`, and `artifactIdentity`; it must not call
generic pathname `readFile` for a reserved artifact. A missing, replaced, symlinked, or identity-mismatched
leaf is an `artifact_read_failed` result before JSON parsing.

The module-private bodies in this task are implemented inside the task-specific
`createReviewCompletionDomain(dependencies)` boundary. Artifact readers, durable appenders, Authorization
lookups, lifecycle/Gate requests, cleanup, and advisory reporting are captured from explicit injected ports;
the code never reads a store singleton. Use Task 3.2's shared authorization helpers with the injected
`findAuthorizationById` port, and do not expose any Acceptance append helper to this task.

Replace only the Task 2.2 authorization-restoration portion of the existing `JusticePlugin.initialize()` with
the following final control flow. `authorizationRecoveryReady` is a local boolean, not a field or lifecycle
abstraction. `"authoritative"` means every startup active binding has completed missing-plan and current semantic
fingerprint validation, and every binding still eligible for positive recovery is the latest durable active binding.
A returned `"uncertain"` outcome, a rejected restoration, an authorization hydration read / parse / validation failure,
a plan probe I/O error, a fingerprint calculation failure, a fingerprint invalidation persistence uncertainty, or a
confirmed-missing invalidation that did not save all leave it false. Wisdom, Telemetry, durable projection, and
notifier initialization retain their existing fail-open isolation. Staged completion and Review Dispatch recovery
run only after projection and only when it is true.

```ts
async initialize(): Promise<void> {
  let authorizationRecoveryReady = false;
  try {
    authorizationRecoveryReady =
      (await this.planBridge.restoreActivePlans()) === "authoritative";
  } catch (error) {
    try {
      this.options.logger?.warn(`Failed to restore authorization during initialization: ${error}`);
    } catch {
      /* Ignore logging errors to preserve fail-open behavior */
    }
  }

  try {
    await this.tieredWisdomStore.loadAll();
    await this.telemetry.load();
    await this.observationHandler.initializeProjectionCache();
    if (authorizationRecoveryReady) {
      try {
        await this.recoverStagedReviewCompletionsAfterRestart();
      } catch (error) {
        this.warnInitializationRecoveryFailure("staged completion", error);
      }
      try {
        await this.reviewDispatchState.recoverReviewDispatchesAfterRestart();
      } catch (error) {
        this.warnInitializationRecoveryFailure("review dispatch", error);
      }
    }
    try {
      await this.options.notifier?.notify({
        level: "info",
        variant: "atlas_orchestration",
        title: "Justice initialized",
        message: "OpenCode adapter initialization complete.",
      });
    } catch {
      /* Ignore notification errors to preserve fail-open behavior */
    }
  } catch (error) {
    try {
      this.options.logger?.warn(`Failed to load wisdom during initialization: ${error}`);
    } catch {
      /* Ignore logging errors to preserve fail-open behavior */
    }
  }
}
```

`warnInitializationRecoveryFailure` is the existing guarded logger pattern kept as a small private helper in
`JusticePlugin`; it neither changes recovery readiness nor throws. The Task 3.4 composition root injects
`cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim` into PlanBridge before this method can
run. Thus a successful startup missing-plan invalidation observes the terminal Authorization during both later
recovery phases, while an uncertain restoration runs neither positive phase. Do not add a coordinator,
lifecycle manager, transaction layer, or DI container.

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
The same production fixture extends `tests/core/justice-plugin-routing.test.ts` with the routing
assertion below; it must use a real durable review binding and the real plugin, not a mocked
`consumeReviewCompletion` call.

```ts
it("routes a matching review PostToolUse to completion before implementation handlers", async () => {
  const fixture = await arrangeLiveClaimedReviewWithChildBinding();

  const response = await fixture.plugin.handleEvent(fixture.postToolUse);

  expect(fixture.reviewCompletionTerminal()).toHaveLength(1);
  expect(fixture.planBridgePostToolUse).not.toHaveBeenCalled();
  expect(fixture.taskFeedbackPostToolUse).not.toHaveBeenCalled();
  expect(fixture.readArtifact).toHaveBeenCalledTimes(1);
  expect(response).toEqual(
    expect.objectContaining({
      action: "inject",
      injectedContext: expect.stringContaining("[JUSTICE"),
    }),
  );
});
```

```ts
it("drains a lifecycle offer created during PostToolUse into that same response", async () => {
  const fixture = await arrangeImplementationPostToolUseWithReviewOffer();

  const response = await fixture.plugin.handleEvent(fixture.postToolUse);

  expect(fixture.reviewPendingCommittedCallback).toHaveBeenCalledTimes(1);
  expect(fixture.reviewDispatchOffer).toHaveBeenCalledWith(fixture.parentSessionId);
  expect(fixture.durablePendingDispatches()).toHaveLength(1);
  expect(fixture.durablePendingDispatches()[0]?.correlation).toEqual(
    fixture.durableReviewPendingCorrelation(),
  );
  expect(response).toEqual(
    expect.objectContaining({
      action: "inject",
      injectedContext: expect.stringContaining("[JUSTICE"),
    }),
  );
  await expect(fixture.takePendingDeliveries()).resolves.toEqual([]);
  expect(fixture.reviewPreToolUse).not.toHaveBeenCalled();
});

it("retains a pending delivery when a PostToolUse handler fails", async () => {
  const fixture = await arrangePostToolUseWithFailingHandlerAndPendingDelivery();

  const response = await fixture.plugin.handleEvent(fixture.postToolUse);

  expect(response).toEqual(
    expect.objectContaining({
      action: "inject",
      injectedContext: expect.stringContaining("[JUSTICE"),
    }),
  );
  await expect(fixture.takePendingDeliveries()).resolves.toEqual([]);
});

Define this local fixture immediately before the startup-delivery cases in
`tests/core/justice-plugin-routing.test.ts`. It must use the production `JusticePlugin` composition, whose
single internal `AuthorizationStore`, `AuthorizationReviewBoundary`, and `ObservationLogStore` are shared by
the normal hook path, the real `ReviewDirectiveSink`, and the real `reviewDispatchState`. The fixture seeds the
same mock durable files before `plugin.initialize()` with an active Authorization, a current `review_pending`
lifecycle record, and one pending Review Dispatch. `readDurableRecords()` is refreshed after every append and
after every hook invocation, so every assertion below is against durable state rather than a factory closure.

```ts
type StartupRecoveryReviewFixture = {
  readonly plugin: JusticePlugin;
  readonly nextControllerPreToolUse: PreToolUseEvent;
  readonly matchingReviewPreToolUse: PreToolUseEvent;
  readonly durableTransitions: (
    from: "pending" | null,
    to: "pending" | "claimed" | "terminal",
  ) => Promise<readonly ReviewDispatchTransitionRecord[]>;
  readonly projectedReviewTaskCallBindings: () => Promise<readonly ReviewTaskCallBinding[]>;
  readonly projectedArtifactReservations: () => Promise<readonly ReviewArtifactReservation[]>;
  readonly pendingDeliveries: () => Promise<readonly ReviewDirectiveDelivery[]>;
  readonly takePendingDeliveries: () => Promise<readonly ReviewDirectiveDelivery[]>;
  readonly terminalizeQueuedReviewDispatch: () => Promise<void>;
  readonly rejectNextDirectiveAuthorityRead: () => void;
  readonly restoreDirectiveAuthority: () => Promise<void>;
  readonly reviewDispatchOffer: ReturnType<typeof vi.fn>;
};

async function arrangeStartupRecoveryWithPendingReviewDelivery(): Promise<StartupRecoveryReviewFixture> {
  const files = createMockFileSystem();
  const parentSessionId = "parent-startup-review";
  const writerId = "writer-startup-review";
  const planPath = "docs/startup-review.md";
  const planContent = "## Task 1: startup review\n- [ ] verify recovery\n";
  const taskId = "task-1";
  const boundary = createAuthorizationReviewBoundary();
  const authorizationStore = new AuthorizationStore(files, files, boundary);
  const logStore = new ObservationLogStore(files, files, writerId);
  const originalReadFile = files.readFile.bind(files);
  let rejectNextAuthorizationRead = false;

  await files.writeFile(planPath, planContent);
  const authorization = await authorizationStore.approve({
    sessionId: parentSessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(planContent, [taskId]),
    planFingerprint: computePlanFingerprint(planContent, [taskId]),
    approvedAt: "2026-09-05T00:00:00.000Z",
  });
  if (authorization === null || authorization.status !== "active") {
    throw new Error("startup fixture could not seed an active Authorization");
  }

  files.readFile = vi.fn(async (path: string): Promise<string> => {
    if (path === ".justice/authorizations.json" && rejectNextAuthorizationRead) {
      rejectNextAuthorizationRead = false;
      throw new Error("test-only unreadable directive authority");
    }
    return originalReadFile(path);
  });

  const taskExecutionRef: TaskExecutionRef = {
    authorizationId: authorization.authorizationId,
    taskId,
    attemptId: "attempt-startup-review",
  };
  const correlation: TaskReviewCorrelation = {
    reviewKind: "task-review",
    taskExecutionRef,
    reviewRound: 1,
  };
  const shard: ShardId = { agentId: "atlas", sessionId: parentSessionId, writerId };
  const append = async (record: PendingLogRecord): Promise<void> => {
    await logStore.append(shard, record);
  };

  await append({
    schemaVersion: 1,
    timestamp: "2026-09-05T00:00:01.000Z",
    agentId: shard.agentId,
    sessionId: shard.sessionId,
    writerId: shard.writerId,
    recordType: "observation",
    kind: "task_lifecycle_transition",
    parentSessionId,
    taskExecutionRef,
    from: "evidence_pending",
    to: "review_pending",
  });
  await append({
    schemaVersion: 1,
    timestamp: "2026-09-05T00:00:02.000Z",
    agentId: shard.agentId,
    sessionId: shard.sessionId,
    writerId: shard.writerId,
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: "startup-pending-dispatch",
    parentSessionId,
    correlation,
    expectedCategory: "sp-review",
    from: null,
    to: "pending",
  });

  const reservedReviewArtifactIo = createMockReservedReviewArtifactIo(files);
  const plugin = new JusticePlugin(files, files, {
    writerId,
    workspaceRoot: ".",
    reservedReviewArtifactIo,
  });
  const internals = plugin as unknown as {
    readonly reviewDispatchState: {
      readonly offerNextMandatoryReview: (
        parent: string,
      ) => Promise<ReviewOfferOutcome>;
    };
    readonly reviewDirectiveSink: {
      readonly deliver: (delivery: ReviewDirectiveDelivery) => Promise<void>;
      readonly drainForParentSession: (
        parent: string,
        decide: (delivery: ReviewDirectiveDelivery) => Promise<"inject" | "discard" | "retain">,
      ) => Promise<readonly ReviewDirectiveDelivery[]>;
    };
  };
  const sink = internals.reviewDirectiveSink as unknown as {
    deliver: (delivery: ReviewDirectiveDelivery) => Promise<void>;
    drainForParentSession: (
      parent: string,
      decide: (delivery: ReviewDirectiveDelivery) => Promise<"inject" | "discard" | "retain">,
    ) => Promise<readonly ReviewDirectiveDelivery[]>;
  };
  const queued = new Map<string, ReviewDirectiveDelivery[]>();
  const deliver = sink.deliver.bind(sink);
  const drain = sink.drainForParentSession.bind(sink);
  sink.deliver = async (delivery: ReviewDirectiveDelivery): Promise<void> => {
    queued.set(delivery.parentSessionId, [...(queued.get(delivery.parentSessionId) ?? []), delivery]);
    await deliver(delivery);
  };
  sink.drainForParentSession = async (parent, decide) =>
    drain(parent, async (delivery) => {
      const decision = await decide(delivery);
      if (decision !== "retain") {
        queued.set(
          parent,
          (queued.get(parent) ?? []).filter(
            (candidate) => !sameReviewCorrelation(candidate.directive.correlation, delivery.directive.correlation),
          ),
        );
      }
      return decision;
    });
  const reviewDispatchOffer = vi.spyOn(internals.reviewDispatchState, "offerNextMandatoryReview");
  const records = (): Promise<readonly PersistedLogRecord[]> => logStore.readAll();

  return {
    plugin,
    nextControllerPreToolUse: {
      type: "PreToolUse",
      sessionId: parentSessionId,
      callId: "normal-controller-call",
      payload: { toolName: "read", toolInput: {} },
    },
    matchingReviewPreToolUse: {
      type: "PreToolUse",
      sessionId: parentSessionId,
      callId: "startup-review-call",
      payload: {
        toolName: "task",
        toolInput: { category: "sp-review", prompt: "perform required review" },
      },
    },
    durableTransitions: async (from, to) =>
      (await records()).filter(
        (record): record is ReviewDispatchTransitionRecord =>
          record.kind === "review_dispatch_transition" &&
          record.parentSessionId === parentSessionId &&
          record.from === from &&
          record.to === to,
      ),
    projectedReviewTaskCallBindings: async () =>
      projectTaskCallBindings(await records()).filter(isReviewTaskCallBinding),
    projectedArtifactReservations: async () =>
      projectTaskCallBindings(await records()).flatMap((binding) =>
        isReviewTaskCallBinding(binding) ? [binding.artifactReservation] : [],
      ),
    pendingDeliveries: async () => [...(queued.get(parentSessionId) ?? [])],
    takePendingDeliveries: async () => {
      const deliveries = [...(queued.get(parentSessionId) ?? [])];
      queued.set(parentSessionId, []);
      return deliveries;
    },
    terminalizeQueuedReviewDispatch: async () => {
      const pending = (await records()).find(
        (record): record is ReviewDispatchTransitionRecord =>
          record.kind === "review_dispatch_transition" &&
          record.parentSessionId === parentSessionId &&
          record.from === null &&
          record.to === "pending",
      );
      if (pending === undefined) throw new Error("startup fixture pending dispatch is missing");
      await append({
        ...pending,
        transitionId: "startup-terminal-dispatch",
        timestamp: "2026-09-05T00:00:03.000Z",
        from: "pending",
        to: "terminal",
        terminalReason: "review_execution_failed",
      });
    },
    rejectNextDirectiveAuthorityRead: () => {
      rejectNextAuthorizationRead = true;
    },
    restoreDirectiveAuthority: async () => undefined,
    reviewDispatchOffer,
  };
}
```

The fixture uses the actual `JusticePlugin` composition; its startup state therefore reads the same persisted
Authorization and Observation Log stores as the seeded records. The `unknown` casts are test-only inspection of
private fields, as required by this repository's test policy; no `as any`, public getter, debug API, or alternate
production code path is added. The wrapped real sink keeps a test closure synchronized with `deliver` and each
real validator decision, so `pendingDeliveries` and `takePendingDeliveries` do not inspect or mutate production
closure state. Change the four cases below to `await` each durable/sink fixture query.

```ts
it("reissues startup recovery delivery at the next Controller-facing hook exactly once", async () => {
  const fixture = await arrangeStartupRecoveryWithPendingReviewDelivery();
  await fixture.plugin.initialize();

  const firstResponse = await fixture.plugin.handleEvent(fixture.nextControllerPreToolUse);
  const secondResponse = await fixture.plugin.handleEvent(fixture.nextControllerPreToolUse);

  expect(firstResponse).toEqual(
    expect.objectContaining({
      action: "inject",
      injectedContext: expect.stringContaining("[JUSTICE"),
    }),
  );
  expect(secondResponse).not.toEqual(
    expect.objectContaining({ injectedContext: expect.stringContaining("[JUSTICE") }),
  );
  await expect(fixture.takePendingDeliveries()).resolves.toEqual([]);
});

it("does not re-inject startup delivery when the first matching hook claims it", async () => {
  const fixture = await arrangeStartupRecoveryWithPendingReviewDelivery();
  await fixture.plugin.initialize();

  const claimResponse = await fixture.plugin.handleEvent(fixture.matchingReviewPreToolUse);
  const laterResponse = await fixture.plugin.handleEvent(fixture.nextControllerPreToolUse);
  const claimContext = claimResponse.action === "inject" ? claimResponse.injectedContext : "";

  expect(claimContext).toContain("REVIEW DISPATCH CLAIMED");
  expect(claimContext).not.toContain("REVIEW REQUIRED");
  await expect(fixture.durableTransitions("pending", "claimed")).resolves.toHaveLength(1);
  await expect(fixture.projectedReviewTaskCallBindings()).resolves.toHaveLength(1);
  await expect(fixture.projectedArtifactReservations()).resolves.toHaveLength(1);
  await expect(fixture.takePendingDeliveries()).resolves.toEqual([]);
  expect(fixture.reviewDispatchOffer).toHaveBeenCalledTimes(0);
  expect(laterResponse).not.toEqual(
    expect.objectContaining({ injectedContext: expect.stringContaining("REVIEW REQUIRED") }),
  );
});

it("drops a startup delivery whose dispatch becomes terminal before root drain", async () => {
  const fixture = await arrangeStartupRecoveryWithPendingReviewDelivery();
  await fixture.plugin.initialize();
  await fixture.terminalizeQueuedReviewDispatch();

  const response = await fixture.plugin.handleEvent(fixture.nextControllerPreToolUse);

  expect(response).not.toEqual(
    expect.objectContaining({ injectedContext: expect.stringContaining("REVIEW REQUIRED") }),
  );
  await expect(fixture.takePendingDeliveries()).resolves.toEqual([]);
});

it("retains an unreadable startup delivery without injecting a positive directive", async () => {
  const fixture = await arrangeStartupRecoveryWithPendingReviewDelivery();
  await fixture.plugin.initialize();
  fixture.rejectNextDirectiveAuthorityRead();

  const uncertainResponse = await fixture.plugin.handleEvent(fixture.nextControllerPreToolUse);

  expect(uncertainResponse).not.toEqual(
    expect.objectContaining({ injectedContext: expect.stringContaining("REVIEW REQUIRED") }),
  );
  await expect(fixture.pendingDeliveries()).resolves.toHaveLength(1);
  await fixture.restoreDirectiveAuthority();
  const recoveredResponse = await fixture.plugin.handleEvent(fixture.nextControllerPreToolUse);
  expect(recoveredResponse).toEqual(
    expect.objectContaining({ injectedContext: expect.stringContaining("REVIEW REQUIRED") }),
  );
  await expect(fixture.pendingDeliveries()).resolves.toEqual([]);
});
```

Add the following Task 3.6 artifact-I/O tests to `tests/core/review-artifact.test.ts`. The fixture creates a
claimed usable binding through Task 3.4, injects the same `ReservedReviewArtifactIo` used by the composition
root, and records JSON parsing through a spy on `assembleReviewCompletionStaging`. It must never call the
ordinary `FileReader.readFile` for a reserved artifact.

The helper wraps the real mock port operations with `vi.fn`, then injects those exact wrapped functions into the
completion composition. This makes the interaction assertions type-safe without adding a production test hook.

```ts
type ReviewArtifactCompletionFixture = {
  readonly reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>;
  readonly validReviewWorkerJson: string;
  readonly writeReservedArtifact: ReturnType<typeof vi.fn>;
  readonly readReservedArtifact: ReturnType<typeof vi.fn>;
  readonly genericArtifactRead: ReturnType<typeof vi.fn>;
  readonly parseAndAssemble: ReturnType<typeof vi.fn>;
  readonly recordAdvisory: ReturnType<typeof vi.fn>;
  readonly unlinkArtifactPath: ReturnType<typeof vi.fn>;
  readonly consume: () => Promise<ReviewCompletionOutcome>;
  readonly replaceArtifactWithDifferentInode: (content: string) => Promise<void>;
  readonly failNextLeaseDelete: () => void;
  readonly artifactExists: () => Promise<boolean>;
  readonly leaseExists: () => Promise<boolean>;
  readonly ensureCleanup: () => Promise<void>;
  readonly readReplacementArtifact: () => Promise<string>;
  readonly durableFailureStaging: () => Promise<
    | Extract<PersistedLogRecord, { readonly kind: "review_artifact_failure_staged" }>
    | undefined
  >;
  readonly durableGateDecisions: () => Promise<readonly GateDecision[]>;
  readonly durableAcceptanceDecisions: () => Promise<readonly AcceptanceDecision[]>;
};
```

Export `createMockReservedReviewArtifactIo(files)` from `tests/helpers/mock-file-system.ts` so the routing,
reservation, and completion tests all use the same deterministic capability double. Define the two fixture
functions below immediately after the type. They must construct the real `createReviewCompletionDomain` and
the real Task 3.2 within-boundary Gate evaluator; they must not stub `consumeReviewCompletion` or return a
synthetic completion outcome. The only test doubles are the injected filesystem capability, durable append
ports, advisory spy, and the rule evaluator's deterministic `PASS` result.

```ts
type UsableReviewArtifactReservation = Extract<
  ReviewArtifactReservation,
  { readonly status: "usable" }
>;
type CompletionFixtureMode = "claimed" | "terminalized";
type ReviewCompletionDependenciesForTest = Parameters<
  typeof reviewArtifactModule.createReviewCompletionDomain
>[0];

async function arrangeClaimedUsableReviewCompletion(): Promise<ReviewArtifactCompletionFixture> {
  return arrangeReviewArtifactCompletionFixture("claimed");
}

async function arrangeTerminalizedReviewWithUsableReservation(): Promise<ReviewArtifactCompletionFixture> {
  return arrangeReviewArtifactCompletionFixture("terminalized");
}

async function arrangeReviewArtifactCompletionFixture(
  mode: CompletionFixtureMode,
): Promise<ReviewArtifactCompletionFixture> {
  const files = createMockFileSystem();
  const parentSessionId = "parent-review-artifact";
  const childSessionId = "child-review-artifact";
  const callId = "review-artifact-call";
  const writerId = "writer-review-artifact";
  const agentId: ObservationAgentId = "atlas";
  const planPath = "docs/review-artifact.md";
  const planContent = "## Task 1: review artifact\n- [ ] implementation\n";
  const shard: ShardId = { agentId, sessionId: parentSessionId, writerId };
  const logStore = new ObservationLogStore(files, files, writerId);
  const boundary = createAuthorizationReviewBoundary();
  const seedAuthorizationStore = new AuthorizationStore(files, files, boundary);
  const approvedTaskIds = new PlanParser().parse(planContent).map((task) => task.id);
  await files.writeFile(planPath, planContent);
  const authorization = await seedAuthorizationStore.approve({
    sessionId: parentSessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(planContent, approvedTaskIds),
    planFingerprint: computePlanFingerprint(planContent, approvedTaskIds),
    approvedAt: "2026-09-05T00:00:00.000Z",
  });
  if (authorization === null || authorization.status !== "active") {
    throw new Error("completion fixture could not seed an active Authorization");
  }
  const taskExecutionRef: TaskExecutionRef = {
    authorizationId: authorization.authorizationId,
    taskId: "task-1",
    attemptId: "attempt-review-artifact",
  };
  const correlation: TaskReviewCorrelation = {
    reviewKind: "task-review",
    taskExecutionRef,
    reviewRound: 1,
  };

  const artifactPath = ".justice/reviews/review-artifact.json";
  const leasePath = ".justice/reviews/.leases/review-artifact.json.lease";
  const artifactIdentity: ReviewArtifactInodeIdentity = {
    device: "mock-device",
    inode: "review-artifact-1",
  };
  const reservation: UsableReviewArtifactReservation = {
    status: "usable",
    artifactId: "review-artifact-1",
    artifactPath,
    leasePath,
    artifactIdentity,
  };
  files.writtenFiles[artifactPath] = "";
  files.writtenFiles[leasePath] = "";
  files.reviewArtifactIdentities.set(artifactPath, artifactIdentity);
  files.reviewArtifactIdentities.set(leasePath, artifactIdentity);

  const originalDeleteFile = files.deleteFile.bind(files);
  let failLeaseDelete = false;
  const unlinkArtifactPath = vi.fn(async (path: string): Promise<void> => {
    if (failLeaseDelete && path === leasePath) {
      failLeaseDelete = false;
      throw new Error("mock lease unlink failure");
    }
    await originalDeleteFile(path);
  });
  files.deleteFile = unlinkArtifactPath;
  const baseArtifactIo = createMockReservedReviewArtifactIo(files);
  const writeReservedArtifact = vi.fn(baseArtifactIo.writeExisting.bind(baseArtifactIo));
  const readReservedArtifact = vi.fn(baseArtifactIo.readOnce.bind(baseArtifactIo));
  const genericArtifactRead = vi.fn(files.readFile.bind(files));
  const recordAdvisory = vi.fn(async (_advisory: string, _cause?: unknown): Promise<void> => undefined);
  const parseAndAssemble = vi.spyOn(reviewArtifactModule, "assembleReviewCompletionStaging");
  const appendPendingRecord = async <T extends PendingLogRecord>(
    input: T,
  ): Promise<T & { readonly sequence: number }> => {
    const sequence = await logStore.append(shard, input);
    return { ...input, sequence };
  };

  const envelope = () => ({
    schemaVersion: 1 as const,
    timestamp: "2026-09-05T00:00:00.000Z",
    agentId,
    sessionId: parentSessionId,
    writerId,
    recordType: "observation" as const,
  });
  await appendPendingRecord({
    ...envelope(),
    kind: "review_dispatch_transition",
    transitionId: "review-artifact-pending",
    parentSessionId,
    correlation,
    expectedCategory: "sp-review",
    from: null,
    to: "pending",
  });
  await appendPendingRecord({
    ...envelope(),
    kind: "review_dispatch_transition",
    transitionId: "review-artifact-claimed",
    parentSessionId,
    correlation,
    expectedCategory: "sp-review",
    from: "pending",
    to: "claimed",
    callId,
    artifactReservation: reservation,
  });
  await appendPendingRecord({
    ...envelope(),
    kind: "delegated_execution_binding",
    parentSessionId,
    parentCallId: callId,
    childSessionId,
    scope: { kind: "task", taskExecutionRef },
  });

  const findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"] = (id) =>
    id === authorization.authorizationId
      ? Promise.resolve(authorization)
      : Promise.resolve(null);
  const appendReviewDispatchTransition: ReviewCompletionDependenciesForTest["appendReviewDispatchTransition"] =
    async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    });
  const appendTaskLifecycleTransition: ReviewCompletionDependenciesForTest["appendTaskLifecycleTransition"] =
    async (input) => {
      await appendPendingRecord({ ...envelope(), kind: "task_lifecycle_transition", ...input });
      return { kind: "committed" as const };
    };
  const appendPlanFinalizationTransition: ReviewCompletionDependenciesForTest["appendPlanFinalizationTransition"] =
    async (input) => {
      await appendPendingRecord({ ...envelope(), kind: "plan_finalization_transition", ...input });
      return { kind: "committed" as const };
    };
  const appendDecision: GateEvaluationDependencies["appendDecision"] = async (input) => {
    await appendPendingRecord(input);
    return { kind: "committed" as const };
  };
  const gateEvaluator = createGatePendingAttemptEvaluator({
    readDurableRecords: () => logStore.readAll(),
    appendDecision,
    findAuthorizationById,
    withAuthorizationReviewBoundary: boundary.withParentSession,
    appendTaskLifecycleTransition,
    appendPlanFinalizationTransition,
    evaluateRules: async ({ context }) =>
      context.scope === "task"
        ? {
            recordType: "decision" as const,
            gateType: "task" as const,
            taskId: context.taskExecutionRef.taskId,
            taskExecutionRef: context.taskExecutionRef,
            verdict: "PASS" as const,
            reachableEnforcementLevel: "L1" as const,
            appliedEnforcementLevel: "L0" as const,
            ruleResults: [],
          }
        : {
            recordType: "decision" as const,
            gateType: "plan" as const,
            authorizationId: context.authorizationId,
            planPath: context.planPath,
            finalizationAttemptId: context.finalizationAttemptId,
            finalReviewRound: context.finalReviewRound,
            verdict: "PASS" as const,
            reachableEnforcementLevel: "L1" as const,
            appliedEnforcementLevel: "L0" as const,
            ruleResults: [],
          },
    recordAdvisory: async (advisory) => recordAdvisory(advisory),
  });
  const readAndAssembleMatchingArtifact: ReviewCompletionDependenciesForTest["readAndAssembleMatchingArtifact"] =
    async (postToolUse, binding, delegatedBinding, trustedCorrelation, observedExecution) => {
      const content = await readReservedArtifact(binding.artifactReservation);
      return parseAndAssemble(
        postToolUse,
        binding,
        delegatedBinding,
        trustedCorrelation,
        observedExecution,
        content,
      );
    };
  const cleanupArtifact: ReviewCompletionDependenciesForTest["cleanupArtifact"] = async (usableReservation) => {
    const outcome = await baseArtifactIo.cleanup(usableReservation);
    if (outcome === "quarantine_retained") {
      await recordAdvisory("review_artifact_cleanup_retained");
    } else if (outcome === "replacement_retained") {
      await recordAdvisory("review_artifact_identity_mismatch");
    } else if (outcome === "cleanup_incomplete") {
      await recordAdvisory("review_artifact_cleanup_incomplete");
    }
    return outcome;
  };
  const completion = createReviewCompletionDomain({
    readDurableRecords: () => logStore.readAll(),
    findAuthorizationById,
    appendReviewCompletionStaging: async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    }),
    appendReviewArtifactReadAttempt: async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    }),
    appendReviewArtifactFailureStaging: async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    }),
    appendReviewPostToolUsePending: async (input) => {
      await appendPendingRecord(input);
      return { kind: "committed" as const };
    },
    appendReviewArtifactCleanupRecord: async (input) => ({
      kind: "committed" as const,
      record: await appendPendingRecord(input),
    }),
    appendReviewDispatchTransition,
    readAndAssembleMatchingArtifact,
    cleanupArtifact,
    evaluateGatePendingAttemptWithinAuthorizationReviewBoundary:
      gateEvaluator.evaluateGatePendingAttemptWithinAuthorizationReviewBoundary,
    appendTaskLifecycleTransition,
    appendPlanFinalizationTransition,
    recordAdvisory,
    dispatch: {
      withReviewDispatchParentSessionClaim: boundary.withParentSession,
      offerNextMandatoryReviewWithinParentSessionClaim: vi.fn(async () => ({ kind: "none" as const })),
      cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim: vi.fn(
        async () => undefined,
      ),
    },
  });
  const validReviewWorkerJson = JSON.stringify({ schemaVersion: 1, complete: true, findings: [] });
  const postToolUse: Pick<PostToolUseEvent, "type" | "sessionId" | "callId"> = {
    type: "PostToolUse",
    sessionId: parentSessionId,
    callId,
  };
  const observedExecution: ObservedReviewExecutionV1 = {
    schemaVersion: 1,
    provenance: "observed",
    reviewExecutionEventId: "review-artifact-execution",
    parentSessionId,
    callId,
    childSessionId,
    correlation,
  };
  const consume = (): Promise<ReviewCompletionOutcome> =>
    completion.consumeReviewCompletion({
      parentSessionId,
      callId,
      postToolUse,
      observedExecution,
      agentId,
      writerId,
    });
  let staged: ReviewCompletionStagingRecord | undefined;
  let terminal: ReviewDispatchTransitionRecord | undefined;
  if (mode === "terminalized") {
    const reviewArtifact: CleanReviewArtifactV1 = {
      schemaVersion: 1,
      reviewKind: "task-review",
      reviewSource: "sp-review",
      correlation,
      observedExecution,
      complete: true,
      findings: [],
    };
    const artifactConsumption = {
      artifactId: reservation.artifactId,
      digest: hashString(validReviewWorkerJson),
    };
    staged = await appendPendingRecord({
      ...envelope(),
      kind: "review_completion_staged",
      parentSessionId,
      staging: { callId, correlation, artifactConsumption, reviewArtifact, observedExecution },
    });
    terminal = await appendPendingRecord({
      ...envelope(),
      kind: "review_dispatch_transition",
      transitionId: "review-artifact-terminal",
      parentSessionId,
      correlation,
      expectedCategory: "sp-review",
      from: "claimed",
      to: "terminal",
      callId,
      artifactConsumption,
      terminalReason: "completed",
      reviewArtifact,
    });
  }

  return {
    reservation,
    validReviewWorkerJson,
    writeReservedArtifact,
    readReservedArtifact,
    genericArtifactRead,
    parseAndAssemble,
    recordAdvisory,
    unlinkArtifactPath,
    consume,
    replaceArtifactWithDifferentInode: async (content) => {
      files.writtenFiles[reservation.artifactPath] = content;
      files.reviewArtifactIdentities.set(reservation.artifactPath, {
        device: "mock-device",
        inode: "review-artifact-replacement",
      });
    },
    failNextLeaseDelete: () => {
      failLeaseDelete = true;
    },
    artifactExists: () => files.fileExists(reservation.artifactPath),
    leaseExists: () => files.fileExists(reservation.leasePath),
    ensureCleanup: async () => {
      if (staged === undefined || terminal === undefined) {
        throw new Error("terminalized completion fixture was not initialized");
      }
      await completion.ensureConsumedReviewArtifactCleaned(staged, terminal);
    },
    readReplacementArtifact: () => files.readFile(reservation.artifactPath),
    durableFailureStaging: async () =>
      (await logStore.readAll()).find(
        (record): record is Extract<
          PersistedLogRecord,
          { readonly kind: "review_artifact_failure_staged" }
        > =>
          record.kind === "review_artifact_failure_staged" && record.callId === callId,
      ),
    durableGateDecisions: async () =>
      (await logStore.readAll()).filter(
        (record): record is GateDecision =>
          record.recordType === "decision" &&
          (record.gateType === "task" || record.gateType === "plan"),
      ),
    durableAcceptanceDecisions: async () =>
      (await logStore.readAll()).filter(
        (record): record is AcceptanceDecision =>
          record.recordType === "decision" &&
          (record.kind === "task-acceptance" || record.kind === "plan-acceptance"),
      ),
  };
}
```

The fixture must import the module namespace used by the spy, `PlanParser`, the plan fingerprint helpers,
`AuthorizationStore`, `createAuthorizationReviewBoundary`, `ObservationLogStore`, the Task 3.2
`createGatePendingAttemptEvaluator`, and the shared model types. `createMockReservedReviewArtifactIo` must
be defined in the shared mock-file-system helper, not copied into each test. The `terminalized` variant
seeds the exact claimed binding, completion staging, and matching terminal needed by
`ensureConsumedReviewArtifactCleaned`; it does not call the completion consumer during arrangement.

```ts
it("reads exactly once from matching artifact, lease, and durable identities", async () => {
  const fixture = await arrangeClaimedUsableReviewCompletion();
  await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

  await expect(fixture.consume()).resolves.toMatchObject({ kind: "completed" });
  expect(fixture.readReservedArtifact).toHaveBeenCalledTimes(1);
  expect(fixture.genericArtifactRead).not.toHaveBeenCalled();
  expect(fixture.parseAndAssemble).toHaveBeenCalledTimes(1);
});

it("stages artifact_read_failed before parsing when artifact is replaced", async () => {
  const fixture = await arrangeClaimedUsableReviewCompletion();
  await fixture.replaceArtifactWithDifferentInode("replacement artifact");

  await expect(fixture.consume()).resolves.toMatchObject({ kind: "blocked" });
  await expect(fixture.durableFailureStaging()).resolves.toEqual(
    expect.objectContaining({ reason: "artifact_read_failed" }),
  );
  expect(fixture.parseAndAssemble).not.toHaveBeenCalled();
  await expect(fixture.durableGateDecisions()).resolves.toEqual([]);
  await expect(fixture.durableAcceptanceDecisions()).resolves.toEqual([]);
});

it("retains a replacement path during terminal cleanup and records an advisory", async () => {
  const fixture = await arrangeTerminalizedReviewWithUsableReservation();
  await fixture.replaceArtifactWithDifferentInode("replacement artifact");

  await fixture.ensureCleanup();

  await expect(fixture.readReplacementArtifact()).resolves.toBe("replacement artifact");
  expect(fixture.unlinkArtifactPath).not.toHaveBeenCalled();
  expect(fixture.recordAdvisory).toHaveBeenCalledWith("review_artifact_identity_mismatch");
});

it("propagates cleanup_incomplete without using mock unlink counts as native security evidence", async () => {
  const fixture = await arrangeTerminalizedReviewWithUsableReservation();
  fixture.failNextLeaseDelete();

  await fixture.ensureCleanup();

  expect(fixture.recordAdvisory).toHaveBeenCalledWith("review_artifact_cleanup_incomplete");
  await expect(fixture.leaseExists()).resolves.toBe(true);
});
```

The real-filesystem Node test asserts that an unsupported platform or failed native probe exposes neither
review-artifact capability. The supported Linux x86_64 suite must exercise the actual
`LinuxOpenat2ReviewArtifactProvider` through production `NodeFileSystem` composition; it must prove
matching-inode writes and reads, unlink/recreate and symlink replacement rejection without changing
replacement bytes, identity mismatch rejection before JSON parsing, normal `quarantine_retained` cleanup
with no physical quarantine unlink, durable root reopen, and reservation-local A/B isolation. The native
Rust race test is the authoritative proof for the verify→name-replacement window: replacement deletion and
overwrite counts remain zero and replacement bytes remain. The provider-specific cleanup test must never
rely on `lstat`/`fstat` followed by name-only `unlink`. Mock tests remain deterministic capability tests and
are not evidence of the native provider's security properties.

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

it("runs startup recovery in authoritative order after a missing-plan terminalization", async () => {
  await arrangeMissingPlanStartupWithPendingReview();
  await plugin.initialize();

  expect(trace).toEqual([
    "authorization-hydration",
    "authorization-invalidated-durable",
    "review-cancelled-tombstone-attempt",
    "active-plan-cache-clear",
    "observation-projection",
    "staged-completion-recovery",
    "review-dispatch-recovery",
  ]);
  expect(reissuedReviewDirectives()).toEqual([]);
  expect(newPendingReviewOffersForInvalidAuthorization()).toEqual([]);
  expect(durableGateDecisionsForInvalidAuthorization()).toEqual([]);
  expect(durableAcceptanceDecisionsForInvalidAuthorization()).toEqual([]);
});

it("terminalizes a stale semantic startup authorization before any positive recovery", async () => {
  await arrangeApprovedPlanAtFingerprintThenMutateSemantics("F1", "F2");
  await plugin.initialize();

  expect(trace).toEqual([
    "authorization-hydration",
    "current-fingerprint-computed",
    "authorization-invalidated-durable",
    "review-cancelled-tombstone-attempt",
    "active-plan-cache-clear",
    "observation-projection",
    "staged-completion-recovery",
    "review-dispatch-recovery",
  ]);
  expect(durableAuthorizationFor("parent-1")).toMatchObject({ status: "invalidated" });
  expect(reissuedReviewDirectives()).toEqual([]);
  expect(newPendingReviewOffersForInvalidAuthorization()).toEqual([]);
  expect(reviewClaimsForInvalidAuthorization()).toEqual([]);
  expect(durableGateDecisionsForInvalidAuthorization()).toEqual([]);
  expect(durableAcceptanceDecisionsForInvalidAuthorization()).toEqual([]);
});

it("allows normal startup recovery for a progress-only semantic-equivalent plan", async () => {
  await arrangeApprovedPlanAtFingerprintThenUpdateApprovedTaskProgressOnly();
  await plugin.initialize();

  expect(durableAuthorizationFor("parent-1")).toMatchObject({ status: "active" });
  expect(recoverStagedReviewCompletionsAfterRestart).toHaveBeenCalledOnce();
  expect(recoverReviewDispatchesAfterRestart).toHaveBeenCalledOnce();
});

it("continues base initialization but skips positive recovery when restoration is uncertain", async () => {
  planBridge.restoreActivePlans = vi.fn().mockResolvedValue("uncertain");

  await expect(plugin.initialize()).resolves.toBeUndefined();

  expect(tieredWisdomLoad).toHaveBeenCalledOnce();
  expect(telemetryLoad).toHaveBeenCalledOnce();
  expect(projectionInitialization).toHaveBeenCalledOnce();
  expect(recoverStagedReviewCompletionsAfterRestart).not.toHaveBeenCalled();
  expect(recoverReviewDispatchesAfterRestart).not.toHaveBeenCalled();
  expect(reissuedReviewDirectives()).toEqual([]);
  expect(durableAcceptanceRecords(await readDurableRecords())).toEqual([]);
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
  expect(injectedReviewDeliveriesFor(secondTaskReviewCorrelation)).toHaveLength(1);
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

it("does not automatically retry a durable terminal cleanup outcome", async () => {
  await arrangeClaimedStagedCompletion(stagedRecord);
  cleanupArtifact.mockResolvedValueOnce("quarantine_retained");

  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(readArtifact).not.toHaveBeenCalled();
  expect(appendCompositeTerminalRecord).not.toHaveBeenCalled();
  expect(cleanupArtifact).toHaveBeenCalledTimes(1);
  expect(projectedCleanupState()).toEqual({
    kind: "finished",
    status: "quarantine_retained",
  });
  expect(durableTerminalRecords()).toHaveLength(1);
});

it("retries only cleanup_incomplete and preserves terminal, Gate, and Acceptance authority", async () => {
  cleanupArtifact
    .mockResolvedValueOnce("cleanup_incomplete")
    .mockResolvedValueOnce("quarantine_retained");

  await consumeReviewCompletion(matchingInput);
  expect(durableTerminalRecords()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);
  expect(projectedCleanupState()).toEqual({
    kind: "finished",
    status: "cleanup_incomplete",
  });

  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(cleanupArtifact).toHaveBeenCalledTimes(2);
  expect(projectedCleanupState()).toEqual({
    kind: "finished",
    status: "quarantine_retained",
  });
  expect(durableTerminalRecords()).toHaveLength(1);
  expect(evaluateGatePendingAttempt).toHaveBeenCalledTimes(1);
  expect(recordAcceptanceDecision).toHaveBeenCalledTimes(1);

  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();
  expect(cleanupArtifact).toHaveBeenCalledTimes(2);
});

it("does not automatically retry replacement_retained", async () => {
  cleanupArtifact.mockResolvedValueOnce("replacement_retained");
  await consumeReviewCompletion(matchingInput);

  restartReviewCompletionRepository();
  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(cleanupArtifact).toHaveBeenCalledTimes(1);
  expect(projectedCleanupState()).toEqual({
    kind: "finished",
    status: "replacement_retained",
  });
  expect(durableTerminalRecords()).toHaveLength(1);
});

it("does not call provider after a durable started marker with no finished outcome", async () => {
  await arrangeDurableCleanupStartedWithoutOutcome(stagedRecord);

  await recoverStagedReviewCompletionsAfterRestart();
  await recoverStagedReviewCompletionsAfterRestart();

  expect(cleanupArtifact).not.toHaveBeenCalled();
  expect(projectedCleanupState()).toEqual({ kind: "outcome_uncertain" });
  expect(recordAdvisory).toHaveBeenCalledWith("review_artifact_cleanup_outcome_uncertain");
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

The Linux production E2E is also part of Step 1, not a later smoke test. Create
`tests/integration/review-artifact-linux-e2e.test.ts` with the following composition. The fixture helpers
are test-only and are specified below; they seed durable files before `OpenCodeAdapter.ensureInitialized()`
and return a `readDurableRecords()` probe. They must use the real `NodeFileSystem`, `AuthorizationStore`,
`ObservationLogStore`, and `AuthorizationStore.approve()` contract. They must not inject a fake
`JusticePlugin`, call a private production method, or return an empty runtime-event list.

Create `tests/helpers/review-artifact-e2e-fixture.ts` with this seed contract. The helper is deliberately
separate from the integration test so the same durable setup can be reused for task-review and final-review
round assertions without a mock store:

```ts
export type CapturedReviewKind = "task-review" | "final-review";

export type ReviewArtifactE2ESeed = {
  readonly readDurableRecords: () => Promise<readonly PersistedLogRecord[]>;
};

export async function seedDurableReviewLifecycle(
  root: string,
  kind: CapturedReviewKind,
): Promise<ReviewArtifactE2ESeed> {
  const files = new NodeFileSystem(root);
  const boundary = createAuthorizationReviewBoundary();
  const authorizationStore = new AuthorizationStore(files, files, boundary);
  const writerId = `writer-review-artifact-e2e-${kind}`;
  const logStore = new ObservationLogStore(files, files, writerId);
  const parentSessionId = "parent-review-artifact-e2e";
  const planPath = `docs/review-artifact-${kind}.md`;
  const planContent = "## Review artifact E2E\n- [ ] verify review completion\n";
  const taskId = "task-1";
  const taskExecutionRef = {
    authorizationId: "pending",
    taskId,
    attemptId: "attempt-review-artifact-e2e",
  } as const;

  await files.writeFile(planPath, planContent);
  const authorization = await authorizationStore.approve({
    sessionId: parentSessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(planContent, [taskId]),
    planFingerprint: computePlanFingerprint(planContent, [taskId]),
    approvedAt: "2026-09-05T00:00:00.000Z",
  });
  if (authorization === null || authorization.status !== "active") {
    throw new Error("E2E fixture could not seed an active Authorization");
  }

  const resolvedTaskExecutionRef = { ...taskExecutionRef, authorizationId: authorization.authorizationId };
  const correlation =
    kind === "task-review"
      ? ({
          reviewKind: "task-review",
          taskExecutionRef: resolvedTaskExecutionRef,
          reviewRound: 1,
        } as const)
      : ({
          reviewKind: "final-review",
          planPath,
          authorizationId: authorization.authorizationId,
          planFingerprint: authorization.planFingerprint,
          finalizationAttemptId: "finalization-review-artifact-e2e",
          finalReviewRound: 1,
        } as const);
  const shard = { agentId: "atlas", sessionId: parentSessionId, writerId } as const;
  const envelope = {
    schemaVersion: 1,
    timestamp: "2026-09-05T00:00:01.000Z",
    agentId: shard.agentId,
    sessionId: shard.sessionId,
    writerId: shard.writerId,
    recordType: "observation",
  } as const;
  const append = (record: PendingLogRecord): Promise<number> => logStore.append(shard, record);

  if (kind === "task-review") {
    await append({
      ...envelope,
      kind: "task_lifecycle_transition",
      parentSessionId,
      taskExecutionRef: resolvedTaskExecutionRef,
      from: "evidence_pending",
      to: "review_pending",
    });
  } else {
    await append({
      ...envelope,
      kind: "plan_finalization_transition",
      parentSessionId,
      planPath,
      authorizationId: authorization.authorizationId,
      finalizationAttemptId: "finalization-review-artifact-e2e",
      finalReviewRound: 1,
      from: "all_tasks_accepted",
      to: "final_review_pending",
    });
  }
  await append({
    ...envelope,
    kind: "review_dispatch_transition",
    transitionId: `pending-${kind}`,
    parentSessionId,
    correlation,
    expectedCategory: kind === "task-review" ? "sp-review" : "sp-final-review",
    from: null,
    to: "pending",
  });

  return { readDurableRecords: () => logStore.readAll() };
}
```

The helper imports the existing `AuthorizationStore`, `createAuthorizationReviewBoundary`, canonical
snapshot/fingerprint helpers, `PendingLogRecord`/`PersistedLogRecord`, `NodeFileSystem`, and
`ObservationLogStore`. The placeholder `authorizationId: "pending"` is never persisted: it is replaced
before the lifecycle record is appended. The final-review seed must preserve the same
`finalizationAttemptId` and `finalReviewRound` in both the lifecycle transition and trusted correlation.

```ts
import { lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HookResponse } from "../../src/core/types";
import type { PersistedLogRecord } from "../../src/core/v2/observation-model";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import {
  capturedRuntimeEvents,
  type CapturedReviewKind,
} from "../helpers/captured-runtime-events";
import {
  seedDurableReviewLifecycle,
  type ReviewArtifactE2ESeed,
} from "../helpers/review-artifact-e2e-fixture";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function arrangeProductionAdapter(root: string): Promise<{
  readonly adapter: OpenCodeAdapter;
  readonly justice: NonNullable<ReturnType<OpenCodeAdapter["getJustice"]>>;
  readonly genericWrite: ReturnType<typeof vi.spyOn>;
  readonly writeReviewArtifact: (
    sessionId: string,
    callId: string,
    artifactPath: string,
    content: string,
  ) => Promise<HookResponse>;
}> {
  const genericWrite = vi.spyOn(NodeFileSystem.prototype, "writeFile");
  const adapter = new OpenCodeAdapter({
    project: { name: "justice-review-artifact-e2e", root },
    client: { app: { log: async () => undefined } },
    $: () => undefined,
    worktree: root,
  });
  await adapter.ensureInitialized();
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("supported native provider did not initialize JusticePlugin");
  const writeReviewArtifact = (
    sessionId: string,
    callId: string,
    artifactPath: string,
    content: string,
  ): Promise<HookResponse> =>
    adapter.onToolExecuteBefore(
      { tool: "write", sessionID: sessionId, callID: callId },
      { args: { filePath: artifactPath, content } },
    );
  return { adapter, justice, genericWrite, writeReviewArtifact };
}

function countRecords(
  records: readonly PersistedLogRecord[],
  predicate: (record: PersistedLogRecord) => boolean,
): number {
  return records.filter(predicate).length;
}

async function runCleanFlow(kind: CapturedReviewKind): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "justice-review-artifact-e2e-"));
  roots.push(root);
  const seed: ReviewArtifactE2ESeed = await seedDurableReviewLifecycle(root, kind);
  const fixture = await arrangeProductionAdapter(root);
  const category = kind === "task-review" ? "sp-review" : "sp-final-review";
  const parentSessionId = "parent-review-artifact-e2e";
  const parentCallId = `call-${kind}`;
  const childSessionId = `child-${kind}`;
  const writeCallId = `write-${kind}`;
  const taskArgs: Record<string, unknown> = {
    category,
    ...(kind === "task-review" ? { task_id: "task-1" } : {}),
    prompt: "run the mandatory review",
    run_in_background: true,
  };

  await fixture.adapter.onToolExecuteBefore(
    { tool: "task", sessionID: parentSessionId, callID: parentCallId },
    { args: taskArgs },
  );
  expect(taskArgs.run_in_background).toBe(false);
  const artifactPath = taskArgs.artifact_path;
  if (typeof artifactPath !== "string") throw new Error("claim did not expose committed artifact path");
  expect(artifactPath).toMatch(/^\.justice\/reviews\/[A-Za-z0-9-]+\.json$/u);

  for (const event of capturedRuntimeEvents(category, parentCallId, childSessionId)) {
    await fixture.adapter.onEvent(event);
  }

  const writeResponse = await fixture.writeReviewArtifact(
    childSessionId,
    writeCallId,
    artifactPath,
    JSON.stringify({ schemaVersion: 1, complete: true, findings: [] }),
  );
  expect(writeResponse).toEqual(
    expect.objectContaining({ action: "skip", reason: "review_artifact_write_committed" }),
  );
  expect(fixture.genericWrite.mock.calls.filter(([path]) => path === artifactPath)).toHaveLength(0);

  await fixture.adapter.onToolExecuteAfter(
    {
      tool: "write",
      sessionID: childSessionId,
      callID: writeCallId,
      args: { filePath: artifactPath },
    },
    { output: "written", metadata: {} },
  );
  const firstRecords = await seed.readDurableRecords();
  expect(
    countRecords(firstRecords, (record) => record.kind === "review_artifact_read_attempt"),
  ).toBe(1);
  expect(
    countRecords(
      firstRecords,
      (record) => record.kind === "review_dispatch_transition" && record.to === "terminal",
    ),
  ).toBe(1);
  const terminalSequence = firstRecords.find(
    (record) => record.kind === "review_dispatch_transition" && record.to === "terminal",
  )?.sequence;
  if (terminalSequence === undefined) throw new Error("missing durable terminal transition");
  const decisionSequences = firstRecords
    .filter(
      (record) =>
        record.recordType === "decision" &&
        ("gateType" in record ||
          ("kind" in record &&
            (record.kind === "task-acceptance" || record.kind === "plan-acceptance"))),
    )
    .map((record) => record.sequence);
  expect(decisionSequences.every((sequence) => sequence > terminalSequence)).toBe(true);
  await expect(readFile(join(root, artifactPath), "utf8")).rejects.toThrow();

  await fixture.adapter.onToolExecuteAfter(
    {
      tool: "write",
      sessionID: childSessionId,
      callID: writeCallId,
      args: { filePath: artifactPath },
    },
    { output: "duplicate", metadata: {} },
  );
  const duplicateRecords = await seed.readDurableRecords();
  expect(
    countRecords(duplicateRecords, (record) => record.kind === "review_artifact_read_attempt"),
  ).toBe(1);

  if (kind === "final-review") {
    await fixture.adapter.onToolExecuteAfter(
      {
        tool: "write",
        sessionID: childSessionId,
        callID: `${writeCallId}-stale-round`,
        args: { filePath: artifactPath },
      },
      { output: "stale", metadata: {} },
    );
    const staleRecords = await seed.readDurableRecords();
    expect(
      countRecords(staleRecords, (record) => record.kind === "review_artifact_read_attempt"),
    ).toBe(1);
  }
}

describe("Linux review-artifact production composition", () => {
  it.each(["task-review", "final-review"] as const)(
    "runs the real %s flow without a generic filesystem artifact write",
    async (kind) => {
      if (process.platform !== "linux" || process.arch !== "x64") {
        throw new Error("unsupported setup: Linux x86_64 is required for the P0 E2E");
      }
      await runCleanFlow(kind);
    },
  );

  it("rejects a symlink replacement and retains it during cleanup", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") {
      throw new Error("unsupported setup: Linux x86_64 is required for the P0 E2E");
    }
    const root = await mkdtemp(join(tmpdir(), "justice-review-artifact-symlink-e2e-"));
    roots.push(root);
    const seed = await seedDurableReviewLifecycle(root, "task-review");
    const fixture = await arrangeProductionAdapter(root);
    const parentSessionId = "parent-review-artifact-e2e";
    const parentCallId = "call-task-review";
    const childSessionId = "child-task-review";
    const writeCallId = "write-task-review";
    const taskArgs: Record<string, unknown> = {
      category: "sp-review",
      task_id: "task-1",
      prompt: "run the mandatory review",
      run_in_background: false,
    };
    await fixture.adapter.onToolExecuteBefore(
      { tool: "task", sessionID: parentSessionId, callID: parentCallId },
      { args: taskArgs },
    );
    const artifactPath = taskArgs.artifact_path;
    if (typeof artifactPath !== "string") throw new Error("missing committed artifact path");
    for (const event of capturedRuntimeEvents("sp-review", parentCallId, childSessionId)) {
      await fixture.adapter.onEvent(event);
    }

    const outside = await mkdtemp(join(tmpdir(), "justice-review-artifact-outside-e2e-"));
    roots.push(outside);
    const outsideTarget = join(outside, "target");
    await writeFile(outsideTarget, "outside", "utf8");
    await unlink(join(root, artifactPath));
    await symlink(outsideTarget, join(root, artifactPath));

    await expect(
      fixture.writeReviewArtifact(childSessionId, writeCallId, artifactPath, "forged"),
    ).resolves.toEqual(
      expect.objectContaining({ action: "skip", reason: "review_artifact_write_rejected" }),
    );
    expect(fixture.genericWrite.mock.calls.filter(([path]) => path === artifactPath)).toHaveLength(0);

    await expect(readFile(outsideTarget, "utf8")).resolves.toBe("outside");
    await expect(lstat(join(root, artifactPath)).then((entry) => entry.isSymbolicLink())).resolves.toBe(true);
    const records = await seed.readDurableRecords();
    expect(countRecords(records, (record) => record.kind === "review_artifact_read_attempt")).toBe(0);
    expect(
      countRecords(
        records,
        (record) => record.kind === "review_dispatch_transition" && record.to === "terminal",
      ),
    ).toBe(0);
    expect(
      records.filter(
        (record) =>
          record.recordType === "decision" &&
          ("gateType" in record ||
            ("kind" in record &&
              (record.kind === "task-acceptance" || record.kind === "plan-acceptance"))),
      ),
    ).toHaveLength(0);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorKind: "lifecycle_advisory",
          message: "review_artifact_identity_mismatch",
        }),
      ]),
    );
  });
});
```

The E2E must not use `describe.skip`, a platform skip helper, a mocked provider, a direct
`consumeReviewCompletion` call, or a fake `JusticePlugin`. Unsupported platform/probe setup is a hard test
failure. The clean flow must assert exactly one durable read attempt, one terminal transition, no Gate or
Acceptance decision before that terminal, and unchanged read-attempt count after duplicate and stale events.
The replacement flow must assert that the normal filesystem writer is never called, JSON parsing/Gate/Acceptance
are not reached, the outside target remains unchanged, the symlink remains retained, and the durable advisory is
`review_artifact_identity_mismatch`.

- [ ] **Step 2: Confirm RED**

Run:

```bash
devcontainer exec --workspace-folder . bash -lc 'test "$(whoami)" = "root" && test -w /workspace && active_toolchain="$(rustup show active-toolchain)" && test "${active_toolchain%% *}" = "1.85.1-x86_64-unknown-linux-gnu" && test "$(opencode --version)" = "1.18.29" && bun run build:native:review-artifact && bun run vitest run tests/core/review-artifact.test.ts tests/core/review-artifact-reservation.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/runtime/validation.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts tests/core/justice-plugin.test.ts tests/core/hook-response-merger.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/integration/opencode-plugin.test.ts tests/integration/review-artifact-linux-e2e.test.ts tests/integration/review-artifact-linux-host-e2e.test.ts tests/integration/opencode-host-review-contract.test.ts'
```

Expected: FAIL behaviorally because matching review completion has no composite terminal physical record or
ordered Gate request, the response merger does not yet preserve the cancellation reason, and the plugin wrapper
does not yet throw the dedicated cancellation. The Linux x86_64 composition E2E and supported-host E2E must
load the built addon and fail on behavioral assertions; a provider-unavailable setup failure, skipped
supported-platform case, missing helper, missing-symbol/type error, or host-version mismatch is an invalid RED.

`tests/runtime/validation.test.ts` is part of this same RED command. Its cleanup-record cases must
compile and fail for the intended unimplemented or incorrect `review_artifact_cleanup` validation/replay
behavior. A missing helper/type, shell syntax error, validator-test setup error, or other setup/compile failure
is not acceptable RED evidence.

- [ ] **Step 3: Implement the fixed protocol**

Wire the production PostToolUse route in this task. `JusticePlugin` must store one
`reviewCompletionDomain` created from the same `observationLogStore`, `authorizationStore`,
`authorizationReviewBoundary`, and `reviewDispatchState` used above. Bind every remaining port
listed in `ReviewCompletionDependencies` to the existing artifact, lifecycle, Gate, advisory, and
cleanup adapters; no completion port may create a second store or boundary.

Before wiring the child-write branch, preserve the host cancellation contract. OpenCode's documented
`tool.execute.before` behavior allows the hook to throw to prevent the built-in tool from executing. Change
`OpenCodeAdapter.onToolExecuteBefore()` to return the internal `HookResponse` while preserving its existing
fail-open handling for ordinary errors. The production plugin wrapper must translate only the two review-artifact
skip reasons into a dedicated cancellation error that is allowed to escape the hook; all unrelated adapter/I/O
errors still degrade to `PROCEED` and never throw. The E2E helper must call this real adapter path and assert
the returned reason; it must not bypass the adapter with a direct child `JusticePlugin.handleEvent()` call.
Add adapter, merger, and plugin-boundary tests proving that the normal OpenCode write tool is not entered after
either cancellation error.

The adapter/plugin boundary is explicit:

```ts
const response = await adapter.onToolExecuteBefore(input, output);
if (
  response.action === "skip" &&
  (response.reason === "review_artifact_write_committed" ||
    response.reason === "review_artifact_write_rejected")
) {
  throw new ReviewArtifactWriteCancelled(response.reason);
}
```

The cancellation response must carry a non-user-facing reason discriminant so unrelated `skip` responses are
not converted into host cancellation. Add the optional internal `SkipResponse.reason` union
`ReviewArtifactWriteSkipReason`; all other skip responses omit it. `ReviewArtifactWriteCancelled` stores the
same reason for diagnostics without exposing it to users. The wrapper must not catch
`ReviewArtifactWriteCancelled`; the adapter's ordinary outer catch must continue to catch and log all other
failures.
`OpenCodeAdapter.onToolExecuteBefore()` must therefore return `PROCEED` for every existing early-return and
ordinary-error path, return the actual `HookResponse` from `JusticePlugin.handleEvent()` after any in-place
payload merge, and preserve the existing `justice_*` early return as `PROCEED`. The OpenCode plugin wrapper
must throw only the dedicated cancellation error through the SDK hook boundary without changing fail-open
behavior for unrelated tools.

The required failure matrix is:

| Input case | Adapter response | Plugin wrapper | Built-in writer | Durable completion authority |
| --- | --- | --- | --- | --- |
| Matching usable reservation and `writeExisting` commit | `skip` + `review_artifact_write_committed` | throws `ReviewArtifactWriteCancelled` with the same reason | 0 calls | eligible for matching PostToolUse only |
| Missing or stale child binding | `skip` + `review_artifact_write_rejected` | throws the rejected cancellation | 0 calls | no read, terminal, Gate, or Acceptance |
| Wrong artifact path or invalid/non-string content | `skip` + `review_artifact_write_rejected` | throws the rejected cancellation | 0 calls | no read, terminal, Gate, or Acceptance |
| Identity mismatch, symlink, inode replacement, or provider I/O failure | `skip` + `review_artifact_write_rejected` | throws the rejected cancellation | 0 calls | no JSON parse, read, terminal, Gate, or Acceptance |
| Unrelated child write or ordinary non-review write | existing `PROCEED` behavior | does not throw | host decides normally | existing routing only |
| Any unrelated `skip` without the reason union | existing `skip` | does not throw | existing host behavior | no reason-based completion |

`tests/core/hook-response-merger.test.ts` must prove both reasons survive every response merge and that a
reasonless `skip` remains reasonless. `tests/runtime/opencode-adapter-v2.test.ts` must prove the adapter returns
each reason after in-place argument merge and returns `PROCEED` for ordinary errors. The existing
`tests/integration/opencode-plugin.test.ts` must prove the wrapper throws only those two reasons and never
converts an arbitrary `skip` or ordinary failure into a throw. The composition E2E and supported-host E2E must
each cover one committed write and one rejected replacement, with the rejected flow producing no
`tool.execute.after` evidence for the built-in writer.

The required unit and boundary cases are concrete. Extend the existing
`tests/integration/opencode-plugin.test.ts` imports with
`import type { HookResponse } from "../../src/core/types";`. The existing imports already provide
`OpenCodePlugin`, `OpenCodeAdapter`, `OpenCodePluginInit`, `fakeInit`, and `vi`. Derive the actual
`tool.execute.before` host input/output types from the returned OpenCode hook map; do not pass core
`PreToolUseEvent` / `PostToolUseEvent` objects to the host hook.


```ts
it.each([
  "review_artifact_write_committed",
  "review_artifact_write_rejected",
] as const)("preserves %s through every PreToolUse merge", (reason) => {
  const warnings: string[] = [];
  expect(
    mergePreToolUseResponses(
      { action: "skip", reason },
      { action: "inject", injectedContext: "observation" },
      (message) => warnings.push(message),
    ),
  ).toEqual({ action: "skip", reason });
  expect(
    mergePostToolUseResponses(
      [
        { action: "skip", reason },
        { action: "proceed" },
      ],
      (message) => warnings.push(message),
    ),
  ).toEqual({ action: "skip", reason });
  expect(warnings).toEqual([]);
});

it("fails closed when two reasoned skips conflict", () => {
  const warnings: string[] = [];
  expect(
    mergePreToolUseResponses(
      { action: "skip", reason: "review_artifact_write_committed" },
      { action: "skip", reason: "review_artifact_write_rejected" },
      (message) => warnings.push(message),
    ),
  ).toEqual({ action: "skip", reason: "review_artifact_write_rejected" });
  expect(warnings).toHaveLength(1);
});

type OpenCodeHooks = Awaited<ReturnType<typeof OpenCodePlugin>>;
type ToolExecuteBeforeHook = NonNullable<OpenCodeHooks["tool.execute.before"]>;
type HostToolInput = Parameters<ToolExecuteBeforeHook>[0];
type HostToolOutput = Parameters<ToolExecuteBeforeHook>[1];

function hostWriteInput(overrides: Partial<HostToolInput> = {}): HostToolInput {
  return {
    tool: "write",
    sessionID: "child-review-session",
    callID: "write-call-1",
    ...overrides,
  } as HostToolInput;
}

function hostWriteOutput(overrides: Partial<HostToolOutput> = {}): HostToolOutput {
  return {
    args: {
      filePath: ".justice/reviews/review-1.json",
      content: "{}",
    },
    ...overrides,
  } as HostToolOutput;
}

function arrangeAdapterReturning(response: HookResponse): OpenCodeAdapter {
  return {
    ...createMockAdapter(),
    onToolExecuteBefore: vi.fn(async () => response),
  } as unknown as OpenCodeAdapter;
}

function arrangeAdapterThrowing(
  cause: unknown = new Error("adapter failure"),
): OpenCodeAdapter {
  return {
    ...createMockAdapter(),
    onToolExecuteBefore: vi.fn(async () => {
      throw cause;
    }),
  } as unknown as OpenCodeAdapter;
}

async function arrangePluginWithAdapter(
  adapter: OpenCodeAdapter,
): Promise<OpenCodeHooks> {
  const init = fakeInit() as OpenCodePluginInit & {
    __justiceTestAdapter?: OpenCodeAdapter;
  };
  init.__justiceTestAdapter = adapter;
  return await OpenCodePlugin(init as never);
}

function requireToolExecuteBefore(hooks: OpenCodeHooks): ToolExecuteBeforeHook {
  const before = hooks["tool.execute.before"];
  if (before === undefined) {
    throw new Error("fixture: tool.execute.before hook missing");
  }
  return before;
}

async function invokeHostWriteBoundary(
  hooks: OpenCodeHooks,
  input: HostToolInput,
  output: HostToolOutput,
  builtInWriter: () => Promise<void>,
): Promise<void> {
  try {
    await requireToolExecuteBefore(hooks)(input, output);
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.name === "ReviewArtifactWriteCancelled") {
      return;
    }
    throw cause;
  }
  await builtInWriter();
}

it("does not convert a reasonless skip into dedicated cancellation", async () => {
  const input = hostWriteInput();
  const output = hostWriteOutput();
  const adapter = arrangeAdapterReturning({ action: "skip" });
  const direct = adapter.onToolExecuteBefore(input, output) as unknown as Promise<HookResponse>;
  await expect(direct).resolves.toEqual({ action: "skip" });

  const hooks = await arrangePluginWithAdapter(adapter);
  await expect(requireToolExecuteBefore(hooks)(input, output)).resolves.toBeUndefined();
});

it("does not relabel an ordinary adapter error as review cancellation", async () => {
  const hooks = await arrangePluginWithAdapter(
    arrangeAdapterThrowing(new Error("ordinary adapter failure")),
  );

  await expect(
    requireToolExecuteBefore(hooks)(hostWriteInput(), hostWriteOutput()),
  ).rejects.toMatchObject({
    name: "Error",
    message: "ordinary adapter failure",
  });
});

it.each([
  "review_artifact_write_committed",
  "review_artifact_write_rejected",
] as const)("throws only the dedicated cancellation for %s", async (reason) => {
  const adapter = arrangeAdapterReturning({ action: "skip", reason });
  const hooks = await arrangePluginWithAdapter(adapter);
  await expect(
    requireToolExecuteBefore(hooks)(hostWriteInput(), hostWriteOutput()),
  ).rejects.toMatchObject({
    name: "ReviewArtifactWriteCancelled",
    reason,
  });
});

it("keeps an unrelated normal write on the existing host path", async () => {
  const builtInWriter = vi.fn(async () => undefined);
  const hooks = await arrangePluginWithAdapter(
    arrangeAdapterReturning({ action: "proceed" }),
  );

  await invokeHostWriteBoundary(
    hooks,
    hostWriteInput({
      callID: "unrelated-write-call",
    }),
    hostWriteOutput({
      args: {
        filePath: ".justice/unrelated.txt",
        content: "ok",
      },
    }),
    builtInWriter,
  );

  expect(builtInWriter).toHaveBeenCalledTimes(1);
});

it("keeps the built-in writer at zero after a rejected replacement", async () => {
  const builtInWriter = vi.fn(async () => undefined);
  const hooks = await arrangePluginWithAdapter(
    arrangeAdapterReturning({
      action: "skip",
      reason: "review_artifact_write_rejected",
    }),
  );

  await invokeHostWriteBoundary(
    hooks,
    hostWriteInput(),
    hostWriteOutput(),
    builtInWriter,
  );

  expect(builtInWriter).toHaveBeenCalledTimes(0);
});
```

`arrangeAdapterReturning`, `arrangeAdapterThrowing`, and `arrangePluginWithAdapter` must use the real
`OpenCodePlugin` factory with only the adapter injection seam already used by existing integration tests;
they must not call `JusticePlugin.handleEvent()` directly. The final two cases also assert that the host
fixture's built-in writer spy has zero calls after the rejection.

The definitions above are executable RED-fixture code, not illustrative pseudocode. The fixture derives
the host hook shapes from `OpenCodePlugin` itself, overrides only the existing
`OpenCodeAdapter.onToolExecuteBefore` method on the local test double, injects it exclusively through
`__justiceTestAdapter`, and returns the actual plugin hook map. It MUST NOT reference
`adapter.handlePreToolUse`, pass core `PreToolUseEvent` / `PostToolUseEvent` values to the host hook, call
`fakeInit({ adapter })`, or invent another test injection API. The fixture must typecheck before RED and
fail only on behavioral assertions. Every call to the async `arrangePluginWithAdapter` helper uses `await`.

Create the two artifact adapters in this composition block, before creating the completion domain. Both take
the durable `ReviewTaskCallBinding` or its usable reservation; neither receives an `artifactPath` from
`PostToolUseEvent`, the task payload, or worker output. `assembleReviewCompletionStaging` is the Task 3.6
pure helper that already owns strict JSON parsing, schema validation, digest calculation, classification, and
artifact assembly. Its explicit `observedExecution: ObservedReviewExecutionV1` argument is copied into the
assembled artifact; it must never fabricate observed provenance from the worker JSON or artifact path.

```ts
private readonly reviewCompletionDomain: ReturnType<typeof createReviewCompletionDomain>;

const reservedReviewArtifactIo = this.options.reservedReviewArtifactIo;
const readAndAssembleMatchingArtifact: ReviewCompletionDependencies["readAndAssembleMatchingArtifact"] = async (
  postToolUse,
  binding,
  delegatedBinding,
  correlation,
  observedExecution,
) => {
  if (binding.artifactReservation.status !== "usable" || reservedReviewArtifactIo === undefined) {
    return { kind: "failure", reason: "artifact_read_failed" };
  }
  let content: string;
  try {
    content = await reservedReviewArtifactIo.readOnce(binding.artifactReservation);
  } catch (cause: unknown) {
    await this.recordReviewAdvisory("review_artifact_read_failed", cause);
    return { kind: "failure", reason: "artifact_read_failed" };
  }
  try {
    // JSON and schema failures are values in this union, not exceptions to be collapsed to I/O.
    return assembleReviewCompletionStaging(
      postToolUse,
      binding,
      delegatedBinding,
      correlation,
      observedExecution,
      content,
    );
  } catch (cause: unknown) {
    await this.recordReviewAdvisory("review_artifact_assembly_failed", cause);
    return { kind: "failure", reason: "artifact_read_failed" };
  }
};
const cleanupArtifact: ReviewCompletionDependencies["cleanupArtifact"] = async (reservation) => {
  if (reservedReviewArtifactIo === undefined) {
    await this.recordReviewAdvisory("review_artifact_cleanup_incomplete");
    return "cleanup_incomplete";
  }
  try {
    return await reservedReviewArtifactIo.cleanup(reservation);
  } catch (cause: unknown) {
    await this.recordReviewAdvisory("review_artifact_cleanup_failed", cause);
    throw cause;
  }
};

this.reviewCompletionDomain = createReviewCompletionDomain({
  ...reviewCompletionDependencies,
  // This appender is wired to the same ObservationLogStore append boundary used by
  // the other Task 3.6 pending observation records. There is no second cleanup store.
  appendReviewArtifactCleanupRecord:
    reviewCompletionDependencies.appendReviewArtifactCleanupRecord,
  readAndAssembleMatchingArtifact,
  cleanupArtifact,
  dispatch: {
    withReviewDispatchParentSessionClaim:
      this.reviewDispatchState.withReviewDispatchParentSessionClaim,
    offerNextMandatoryReviewWithinParentSessionClaim:
      this.reviewDispatchState.offerNextMandatoryReviewWithinParentSessionClaim,
    cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim:
      this.reviewDispatchState.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim,
  },
});
```

Here `reviewCompletionDependencies` is the constructor-local object whose explicit properties
are the injected ports listed in `ReviewCompletionDependencies`; it is not a service locator or
runtime singleton. Wire the production PostToolUse route in this task. The route must resolve the durable
`TaskCallBinding` purpose before invoking any implementation handler. A review-purpose binding
must never enter `PlanBridge.handlePostToolUse()` or `TaskFeedbackHandler.handlePostToolUse()`.
The completion domain is constructed with the same dispatch state, parent boundary, log store,
and authoritative Authorization reader used by Task 3.4.

```ts
private async routeTaskPostToolUse(event: PostToolUseEvent): Promise<HookResponse> {
  const inputCategory = readStringRecordValue(event.payload.toolInput, "category");
  const isReviewCategory = inputCategory === "sp-review" || inputCategory === "sp-final-review";
  if (
    event.payload.toolName !== "task" ||
    event.callId === undefined ||
    event.callId.trim().length === 0
  ) {
    if (isReviewCategory) {
      await this.recordReviewAdvisory("review_parent_call_identity_missing");
      return PROCEED;
    }
    return this.routeImplementationPostToolUse(event);
  }

  const records = await this.observationHandler.getLogStore().readAll();
  const binding = projectTaskCallBindings(records).find(
    (candidate): candidate is ReviewTaskCallBinding =>
      candidate.parentSessionId === event.sessionId &&
      candidate.callId === event.callId &&
      isReviewTaskCallBinding(candidate),
  );
  if (binding === undefined) {
    if (isReviewCategory) {
      await this.recordReviewAdvisory("review_task_binding_missing");
      return PROCEED;
    }
    return this.routeImplementationPostToolUse(event);
  }
  const slot = projectReviewDispatchSlots(records).find(
    (candidate): candidate is ClaimedReviewDispatchSlot =>
      candidate.key.parentSessionId === event.sessionId &&
      candidate.state === "claimed" &&
      candidate.callId === event.callId &&
      reviewTaskCallBindingMatchesSlot(binding, candidate),
  );
  if (slot === undefined) {
    await this.recordReviewAdvisory("review_dispatch_slot_stale");
    return PROCEED;
  }
  const delegatedBinding = projectDelegatedExecutionBindings(records).find(
    (candidate) =>
      candidate.parentSessionId === event.sessionId &&
      candidate.parentCallId === event.callId &&
      delegatedBindingMatchesSlot(candidate, slot),
  );
  const observedExecution =
    delegatedBinding === undefined
      ? undefined
      : projectObservedReviewExecution(records, delegatedBinding);
  const agentId = this.sessionStateProvider.getAgentId(event.sessionId);
  const outcome = await this.reviewCompletionDomain
    .consumeReviewCompletion({
      parentSessionId: event.sessionId,
      callId: event.callId,
      postToolUse: {
        type: "PostToolUse",
        sessionId: event.sessionId,
        callId: event.callId,
      },
      ...(observedExecution === undefined ? {} : { observedExecution }),
      agentId,
      writerId: this.writerId,
    })
    .catch((error: unknown): ReviewCompletionOutcome => {
      void this.recordReviewAdvisory("review_completion_route_failed", error);
      return { kind: "blocked" };
    });

  return reviewCompletionOutcomeToHookResponse(outcome);
}

function readStringRecordValue(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

private reviewParentSessionIdForPostToolUse(event: PostToolUseEvent): string {
  return event.sessionId;
}

private async routeImplementationPostToolUse(event: PostToolUseEvent): Promise<HookResponse> {
  const [observation, planBridge, taskFeedback] = await Promise.all([
    this.observationHandler.handlePostToolUse(event).catch(() => PROCEED),
    event.payload.toolName === "task"
      ? this.planBridge.handlePostToolUse(event).catch(() => PROCEED)
      : Promise.resolve(PROCEED),
    event.payload.toolName === "task"
      ? this.taskFeedback.handlePostToolUse(event).catch(() => PROCEED)
      : Promise.resolve(PROCEED),
  ]);
  return mergePostToolUseResponses([observation, planBridge, taskFeedback], (message) =>
    this.warnMergeConflict(message),
  );
}

private async mergePostToolUseWithReviewDeliveries(
  parentSessionId: string,
  response: HookResponse,
): Promise<HookResponse> {
  const deliveries = await this.authorizationReviewBoundary
    .withParentSession(parentSessionId, () =>
      this.reviewDirectiveSink.drainForParentSession(parentSessionId, (delivery) =>
        this.reviewDispatchState.validateQueuedReviewDirectiveWithinParentSessionClaim(delivery),
      ),
    )
    .catch(async (cause: unknown): Promise<readonly ReviewDirectiveDelivery[]> => {
      await this.recordReviewAdvisory("review_directive_delivery_validation_failed", cause);
      return [];
    });
  const directiveResponses: readonly HookResponse[] = deliveries
    .map((delivery) => ({
      action: "inject" as const,
      injectedContext: formatReviewDirective(delivery.directive),
    }));
  return mergePostToolUseResponses(
    [response, ...directiveResponses],
    (message) => this.warnMergeConflict(message),
  );
}

case "PostToolUse": {
  let response: HookResponse = PROCEED;
  try {
    response = await this.routeTaskPostToolUse(event);
  } catch (error: unknown) {
    await this.recordReviewAdvisory("post_tool_use_route_failed", error).catch(() => undefined);
  }
  try {
    return await this.mergePostToolUseWithReviewDeliveries(
      await this.reviewParentSessionIdForPostToolUse(event),
      response,
    );
  } finally {
    closeSessionTaskWindow(this.sessionStateProvider, event.callId);
  }
}
```

`projectTaskCallBindings(records)` is the durable projection, not a session cache. The lookup
must preserve the binding's `parentSessionId`, purpose, and trusted correlation; the incoming
PostToolUse category, prompt, artifact path, and worker result are never used to select the
completion domain. `routeImplementationPostToolUse` retains the existing non-review behavior,
while the review branch is the only production caller of `consumeReviewCompletion`.

Implement this exact staging-first sequence: validate the claimed parent binding; check
`artifactReservation.status === "usable"`; append or reuse exactly one `ReviewPostToolUsePendingRecord` for the
parent event; if the durable child-session binding is absent, return `awaiting_child_binding` without artifact I/O;
then validate the durable child-session binding and observed execution; append exactly one
`ReviewArtifactReadAttemptRecord` before any artifact I/O; then read the usable artifact once. If the read, JSON
parse, or strict
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
and the durable claimed binding's artifact ID. Cleanup status is projected from `ReviewArtifactCleanupRecord`, not from an advisory. Only
`not_started` and latest finished `cleanup_incomplete` may enter the provider; `cleaned`,
`quarantine_retained`, `replacement_retained`, and outcome-uncertain latest `started` do not. Cleanup
failure/retention is reported as an advisory but never rolls back terminal, lifecycle, Gate, or Acceptance
authority. `ensureTerminalReviewOutcomeApplied`
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
recovery never rereads the artifact. After a durable failure terminal, never reread or reappend it. Cleanup then uses the trusted claimed
reservation plus the latest durable `ReviewArtifactCleanupRecord`. Record absence permits one started
attempt; latest finished `cleanup_incomplete` permits one re-evaluation; latest finished `cleaned`,
`quarantine_retained`, or `replacement_retained`, and latest `started`, do not invoke the provider. The runtime
provider is reached only through descriptor-based `cleanupExistingReservation({ artifactPath, leasePath,
artifactIdentity })`; Task 3.6 continues to call only `ReservedReviewArtifactIo.cleanup(reservation)` and MUST
NOT call or know `openExistingReservation`. `artifact_missing` from strict read/write reopen is therefore not a
cleanup prerequisite or recovery signal. Descriptor cleanup may inspect reservation-local residual state, but
supported v4.0.0 never uses an identity check to authorize a later name-only unlink of a quarantine leaf. A different eligible candidate may still be offered.

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

type MatchingReviewParentPostToolUse = {
  readonly type: "PostToolUse";
  readonly sessionId: string;
  readonly callId: string;
};

export type ReviewCompletionInput = {
  readonly parentSessionId: string;
  readonly callId: string;
  readonly postToolUse: MatchingReviewParentPostToolUse;
  readonly observedExecution?: ObservedReviewExecutionV1;
  readonly agentId: ObservationAgentId;
  readonly writerId: string;
};

type PersistedReviewPostToolUseRecord = PersistedEnvelope & ReviewPostToolUsePendingRecord;
type PersistedReviewArtifactReadAttemptRecord = PersistedEnvelope & ReviewArtifactReadAttemptRecord;
type PersistedReviewArtifactFailureStagingRecord = PersistedEnvelope & ReviewArtifactFailureStagingRecord;

// Imported from Task 3.4. Task 3.6 consumes these types and does not redeclare them.
// - ReviewTaskCallBinding
// - PendingReviewDispatchTransitionRecord

type ClaimedReviewDispatchSlot = ReviewDispatchSlot & {
  readonly state: "claimed";
  readonly callId: string;
};

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
  postToolUse: MatchingReviewParentPostToolUse,
  parentSessionId: string,
  callId: string,
  slot: ClaimedReviewDispatchSlot,
): boolean {
  return (
    postToolUse.type === "PostToolUse" &&
    postToolUse.sessionId.length > 0 &&
    postToolUse.callId.length > 0 &&
    postToolUse.sessionId === parentSessionId &&
    postToolUse.callId === callId &&
    slot.key.parentSessionId === parentSessionId &&
    slot.callId === callId
  );
}

function observedExecutionMatchesReview(
  observed: ObservedReviewExecutionV1,
  parentSessionId: string,
  parentCallId: string,
  childSessionId: string,
  correlation: ReviewCorrelation,
): boolean {
  return (
    observed.schemaVersion === 1 &&
    observed.provenance === "observed" &&
    observed.reviewExecutionEventId.length > 0 &&
    observed.parentSessionId === parentSessionId &&
    observed.callId === parentCallId &&
    observed.childSessionId === childSessionId &&
    sameReviewCorrelation(observed.correlation, correlation)
  );
}

function matchesReviewPostToolUse(
  postToolUse: MatchingReviewParentPostToolUse,
  slot: ClaimedReviewDispatchSlot,
  taskCallBinding: ReviewTaskCallBinding,
  binding: DelegatedExecutionBinding,
): boolean {
  return (
    postToolUse.type === "PostToolUse" &&
    postToolUse.callId.length > 0 &&
    postToolUse.sessionId === slot.key.parentSessionId &&
    postToolUse.callId === slot.callId &&
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
    postToolUse: MatchingReviewParentPostToolUse,
    binding: ReviewTaskCallBinding,
    delegatedBinding: DelegatedExecutionBinding,
    correlation: ReviewCorrelation,
    observedExecution: ObservedReviewExecutionV1,
  ) => Promise<ReviewCompletionStaging | ReviewArtifactReadFailure>;
  readonly cleanupArtifact: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ) => Promise<ReviewArtifactCleanupStatus>;
  readonly appendReviewArtifactCleanupRecord: (
    input: PendingReviewArtifactCleanupRecord,
  ) => Promise<
    | { readonly kind: "committed"; readonly record: PersistedReviewArtifactCleanupRecord }
    | { readonly kind: "failed" }
  >;
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
    appendReviewArtifactCleanupRecord,
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
          candidate.callId === callId &&
          candidate.expectedCategory ===
            (marker.purpose === "task_review" ? "sp-review" : "sp-final-review") &&
          sameReviewCorrelation(candidate.key.correlation, marker.trustedCorrelation),
      );
      const delegatedBinding = projectDelegatedExecutionBindings(records).find(
        (candidate) =>
          slot !== undefined &&
          candidate.parentSessionId === parentSessionId &&
          candidate.parentCallId === callId &&
          delegatedBindingMatchesSlot(candidate, slot),
      );
      if (slot === undefined || delegatedBinding === undefined) return;
      if (
        marker.childSessionId !== undefined &&
        marker.childSessionId !== delegatedBinding.childSessionId
      ) {
        await recordAdvisory("review_pending_completion_stale");
        return;
      }
      const observedExecution =
        marker.observedExecution ?? projectObservedReviewExecution(records, delegatedBinding);
      if (observedExecution === undefined) {
        await recordAdvisory("review_observed_execution_missing");
        return;
      }
      await consumeReviewCompletionWithinParentSessionClaim({
        parentSessionId: marker.parentSessionId,
        callId: marker.callId,
        postToolUse: {
          type: "PostToolUse",
          sessionId: marker.parentSessionId,
          callId: marker.callId,
        },
        observedExecution,
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
        return input.postToolUse.type === "PostToolUse" &&
          input.postToolUse.sessionId === input.parentSessionId &&
          input.postToolUse.callId === input.callId &&
          (input.observedExecution === undefined ||
            observedExecutionMatchesReview(
              input.observedExecution,
              input.parentSessionId,
              input.callId,
              existingStaging.staging.observedExecution.childSessionId,
              existingStaging.staging.correlation,
            )) &&
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
        return input.postToolUse.type === "PostToolUse" &&
          input.postToolUse.sessionId === input.parentSessionId &&
          input.postToolUse.callId === input.callId
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
      if (
        pendingPostToolUse !== undefined &&
        (!sameReviewCorrelation(
          pendingPostToolUse.trustedCorrelation,
          slot.key.correlation,
        ) ||
          pendingPostToolUse.purpose !== taskCallBinding.purpose ||
          (pendingPostToolUse.childSessionId !== undefined &&
            delegatedBinding !== undefined &&
            pendingPostToolUse.childSessionId !== delegatedBinding.childSessionId))
      ) {
        return { kind: "stale" };
      }
      if (pendingPostToolUse === undefined) {
        const pending = await appendReviewPostToolUsePending({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId: input.agentId,
          sessionId: input.parentSessionId,
          writerId: input.writerId,
          recordType: "observation",
          kind: "review_post_tooluse_pending",
          parentSessionId: input.parentSessionId,
          callId: input.callId,
          purpose: taskCallBinding.purpose,
          trustedCorrelation: slot.key.correlation,
          ...(delegatedBinding === undefined || input.observedExecution === undefined
            ? {}
            : {
                childSessionId: delegatedBinding.childSessionId,
                observedExecution: input.observedExecution,
              }),
        });
        if (pending.kind !== "committed") {
          await recordAdvisory("review_completion_pending_append_failed");
          return { kind: "blocked" };
        }
      }
      if (delegatedBinding === undefined) {
        return { kind: "awaiting_child_binding" };
      }
      const observedExecution = input.observedExecution;
      if (
        observedExecution === undefined ||
        !observedExecutionMatchesReview(
          observedExecution,
          input.parentSessionId,
          input.callId,
          delegatedBinding.childSessionId,
          slot.key.correlation,
        )
      ) {
        return { kind: "stale" };
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
          observedExecution,
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


function cleanupIdentityFor(
  terminal: ReviewDispatchTransitionRecord,
  reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
): ReviewArtifactCleanupIdentity | undefined {
  if (!("callId" in terminal) || terminal.callId === undefined) return undefined;
  return {
    parentSessionId: terminal.parentSessionId,
    callId: terminal.callId,
    correlation: terminal.correlation,
    artifactId: reservation.artifactId,
  };
}

function projectReviewArtifactCleanupState(
  records: readonly PersistedLogRecord[],
  identity: ReviewArtifactCleanupIdentity,
): ProjectedReviewArtifactCleanupState {
  const matching = orderEventsForProjection(records).filter(
    (record): record is PersistedReviewArtifactCleanupRecord =>
      record.kind === "review_artifact_cleanup" &&
      record.parentSessionId === identity.parentSessionId &&
      record.callId === identity.callId &&
      record.artifactId === identity.artifactId &&
      sameReviewCorrelation(record.correlation, identity.correlation),
  );
  const latest = matching.at(-1);
  if (latest === undefined) return { kind: "not_started" };
  if (latest.phase === "started") return { kind: "outcome_uncertain" };
  return { kind: "finished", status: latest.status };
}

async function appendCleanupPhase(
  terminal: ReviewDispatchTransitionRecord,
  identity: ReviewArtifactCleanupIdentity,
  phase:
    | { readonly phase: "started" }
    | { readonly phase: "finished"; readonly status: ReviewArtifactCleanupStatus },
): Promise<
  | { readonly kind: "committed"; readonly record: PersistedReviewArtifactCleanupRecord }
  | { readonly kind: "failed" }
> {
  return appendReviewArtifactCleanupRecord({
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    agentId: terminal.agentId,
    sessionId: terminal.sessionId,
    writerId: terminal.writerId,
    recordType: "observation",
    kind: "review_artifact_cleanup",
    ...identity,
    ...phase,
  });
}

async function recordCleanupStatusAdvisory(status: ReviewArtifactCleanupStatus): Promise<void> {
  if (status === "quarantine_retained") {
    await recordAdvisory("review_artifact_cleanup_retained");
  } else if (status === "replacement_retained") {
    await recordAdvisory("review_artifact_identity_mismatch");
  } else if (status === "cleanup_incomplete") {
    await recordAdvisory("review_artifact_cleanup_incomplete");
  }
}

async function ensureReviewArtifactCleanupStateMachine(
  terminal: ReviewDispatchTransitionRecord,
  reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
): Promise<void> {
  const identity = cleanupIdentityFor(terminal, reservation);
  if (identity === undefined) return;
  const current = projectReviewArtifactCleanupState(await readDurableRecords(), identity);
  if (current.kind === "outcome_uncertain") {
    await recordAdvisory("review_artifact_cleanup_outcome_uncertain");
    return;
  }
  if (current.kind === "finished" && current.status !== "cleanup_incomplete") return;

  const started = await appendCleanupPhase(terminal, identity, { phase: "started" });
  if (started.kind !== "committed") {
    await recordAdvisory("review_artifact_cleanup_start_append_failed");
    return;
  }

  let status: ReviewArtifactCleanupStatus;
  try {
    status = await cleanupArtifact(reservation);
  } catch (error: unknown) {
    const finished = await appendCleanupPhase(terminal, identity, {
      phase: "finished",
      status: "cleanup_incomplete",
    });
    if (finished.kind !== "committed") {
      await recordAdvisory("review_artifact_cleanup_outcome_uncertain", error);
      return;
    }
    await recordAdvisory("review_artifact_cleanup_failed", error);
    await recordCleanupStatusAdvisory("cleanup_incomplete");
    return;
  }

  const finished = await appendCleanupPhase(terminal, identity, { phase: "finished", status });
  if (finished.kind !== "committed") {
    await recordAdvisory("review_artifact_cleanup_outcome_uncertain");
    return;
  }
  await recordCleanupStatusAdvisory(status);
}

async function ensureConsumedReviewArtifactCleaned(
  staged: ReviewCompletionStagingRecord,
  terminal: ReviewDispatchTransitionRecord,
): Promise<void> {
  const records = await readDurableRecords();
  const matchingTerminal = findMatchingTerminalForStaging(records, staged);
  if (matchingTerminal === undefined || matchingTerminal.transitionId !== terminal.transitionId) return;
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
  await ensureReviewArtifactCleanupStateMachine(matchingTerminal, reservation);
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
  const records = await readDurableRecords();
  const reservation = findClaimedUsableReservationForTerminal(records, terminal);
  if (reservation === undefined) {
    await recordAdvisory("review_artifact_cleanup_reservation_missing");
    return;
  }
  await ensureReviewArtifactCleanupStateMachine(terminal, reservation);
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

Run:

```bash
devcontainer exec --workspace-folder . bash -lc 'test "$(whoami)" = "root" && test -w /workspace && active_toolchain="$(rustup show active-toolchain)" && test "${active_toolchain%% *}" = "1.85.1-x86_64-unknown-linux-gnu" && test "$(opencode --version)" = "1.18.29" && bun run build:native:review-artifact && bun run vitest run tests/core/review-artifact.test.ts tests/core/review-artifact-reservation.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/runtime/validation.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts tests/core/justice-plugin.test.ts tests/core/hook-response-merger.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/integration/opencode-plugin.test.ts tests/integration/review-artifact-linux-e2e.test.ts tests/integration/review-artifact-linux-host-e2e.test.ts tests/integration/opencode-host-review-contract.test.ts'
```

Expected: PASS, including both task-review and final-review composition and supported-host flows, exact-once
read/terminal assertions, camelCase N-API reopen binding, both cancellation reasons, reason-preserving merge,
zero built-in writer calls after secure rejection, no generic artifact write, stale final-round rejection,
symlink/inode replacement retention, and the `review_artifact_identity_mismatch` advisory.

The same GREEN run must pass `tests/runtime/validation.test.ts`: valid
`review_artifact_cleanup` `started` and `finished(status)` records are accepted and replayed; malformed
phase/status/required identity combinations are rejected; and restart/replay reconstructs the latest durable
cleanup state. Only `finished(cleanup_incomplete)` is re-evaluable. `cleaned`, `quarantine_retained`, and
`replacement_retained` are terminal, while started-without-finished projects `outcome_uncertain`; none of those
terminal/uncertain states may automatically re-enter the provider.

- [ ] **Step 5: Commit after approval**

```bash
GIT_MASTER=1 git add src/core/review-artifact.ts src/core/review-dispatch-state.ts src/core/session-state-provider.ts src/core/types.ts src/core/v2/observation-model.ts src/core/v2/state-projection.ts src/core/hook-response-merger.ts src/hooks/observation-handler.ts src/core/justice-plugin.ts src/runtime/validation.ts src/runtime/opencode-adapter.ts src/opencode-plugin.ts tests/helpers/mock-file-system.ts tests/helpers/review-artifact-e2e-fixture.ts tests/core/review-artifact.test.ts tests/core/review-artifact-reservation.test.ts tests/core/session-state-provider.test.ts tests/core/v2/state-projection.test.ts tests/runtime/validation.test.ts tests/core/hook-response-merger.test.ts tests/hooks/observation-handler-transactional.test.ts tests/core/justice-plugin-routing.test.ts tests/core/justice-plugin.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/integration/opencode-plugin.test.ts tests/integration/review-artifact-linux-e2e.test.ts tests/integration/review-artifact-linux-host-e2e.test.ts
GIT_MASTER=1 git commit -m "feat: review artifact消費とacceptanceをtransactionalに処理"
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
GIT_MASTER=1 git add src/core/progress-updater.ts src/hooks/task-feedback.ts src/core/justice-plugin.ts tests/core/progress-updater.test.ts tests/hooks/task-feedback.test.ts tests/core/justice-plugin-routing.test.ts
GIT_MASTER=1 git commit -m "feat: accepted decision後だけplan progressを更新"
```

---

## Phase 4: Controller Routing — JUS-P0-01

### Task 4.0: Verify supported-host invocation correlation and abandonment lifecycle

**Requirement:** JUS-P0-01, Design §3.3, §4.1, §5.1.

**Files:**

- Create: `docs/spikes/2026-09-controller-routing-runtime-signals.md`

No production source, test source, production OpenCode configuration, workflow, package, lockfile, Rust/native file,
or persistent probe implementation is modified by this spike. Temporary files live only under
`/tmp/justice-controller-routing-spike` in the existing devcontainer. Step 1 starts by removing that entire root so
a rerun never reuses stale scratch state, and Step 6 removes it after the final report is validated. If Steps 1-5
exit early, the temporary root may remain under `/tmp` only; it is non-authoritative scratch state, MUST NOT be
persisted or treated as capability evidence, and the next Step 1 removes it before provisioning a fresh CLI.

**Consumes:** Bun in the existing devcontainer; temporary exact `opencode-ai@1.18.29` provisioned under
`/tmp/justice-controller-routing-spike/opencode-cli`; resolved `@opencode-ai/plugin@1.14.21` /
`@opencode-ai/sdk@1.14.21`; pinned OpenCode `1.18.29` source snapshot; existing
`tests/types/command-execute-before.contract-fixture.ts`; `JUSTICE_HOST_TEST_MODEL`.

The repository devcontainer is **not** assumed to have `opencode` on `PATH`. Every OpenCode invocation in this task
MUST use the exact temporary binary
`/tmp/justice-controller-routing-spike/opencode-cli/node_modules/.bin/opencode`. Failure to provision that exact
package/binary, verify its package version, or execute `--version` is an **execution-prerequisite BLOCKED** result:
do not create the runtime-signal report, do not synthesize `JUS-P0-01 runtime observation = BLOCKED`, and do not
start Steps 2-6. A runtime observation exists only after Step 1 completes successfully.

After Step 1 succeeds, capability `PASS` / `BLOCKED` values are **data outcomes**, not shell harness outcomes.
A validator may internally use exit `0` for PASS and exit `1` for BLOCKED, but the enclosing Step 5/6 shell MUST
treat either result as successful execution only after the corresponding result artifact is well-formed and the
validator exit code matches that exact result. Shell non-zero is reserved for cases where a capability outcome
cannot be trusted or completed, such as validator crash/unexpected exit, malformed or missing artifacts, I/O
failure, or other harness failure. Step 7 is the only capability branch point after a runtime report exists.

**Hard gate:** Task 4.1/4.2 MUST NOT start unless Step 6 has completed and the report contains exactly one
`## Result` section whose exact result line is:

```text
JUS-P0-01 runtime observation = PASS
```

The final post-Step-6 `## Result` exact line is the sole overall Task 4.0 status authority. It is authoritative only
after Step 6 has combined both (1) correlation-validator PASS for the four nominal probes plus deterministic
same-server/same-session overlap probe and (2) `JUS-P0-01 abandonment observation = PASS` for the deterministic
post-arm failure/abandonment probe. A provisional PASS written by the correlation validator before Step 6 combines
the abandonment result MUST NOT unlock Task 4.1/4.2.
Task 4.0 records capability evidence only; it does **not** pre-authorize a production abandonment API. A PASS report
must identify the exact target-session binding, cleanup scope/hook/value/order, and concurrent-B/suppression
safety. After either PASS or BLOCKED, stop before Task 4.1/4.2. A separate document-only change must copy the
observed lifecycle contract into
Design §4.1 and Task 4.2 and pass document review before implementation is reconsidered.

The trace allowlist is exact:

```text
hook
command
sessionID
agent
role
userMessageID
assistantMessageID
parentMessageID
completedPresent
status
```

Allowed hook values are exactly:

```text
command.execute.before
chat.params
message.updated
command.executed
session.status
session.idle
session.error
probe.failure_injected
probe.dispose_started
probe.dispose_flushed
```

Never record `arguments`, prompt/message content, parts, raw event objects, command templates, model/provider IDs,
credentials, environment values, arbitrary config, tool payloads, or stdout/stderr from the host.

- [ ] **Step 1: Provision the exact supported CLI, then re-confirm declarations and pinned host source**

Run:

```bash
devcontainer exec --workspace-folder . bash -lc '
set -euo pipefail

SPIKE_ROOT=/tmp/justice-controller-routing-spike
CLI_ROOT="$SPIKE_ROOT/opencode-cli"
OPENCODE_BIN="$CLI_ROOT/node_modules/.bin/opencode"

rm -rf "$SPIKE_ROOT"
mkdir -p "$CLI_ROOT"
printf "%s\n" "{\"private\":true}" > "$CLI_ROOT/package.json"

(
  cd "$CLI_ROOT"
  BUN_INSTALL_CACHE_DIR="$CLI_ROOT/cache" bun add --exact opencode-ai@1.18.29
)

test -x "$OPENCODE_BIN"
CLI_PACKAGE_VERSION="$(
  bun -e "const p=await Bun.file(process.argv.at(-1)).json(); process.stdout.write(p.version)"     "$CLI_ROOT/node_modules/opencode-ai/package.json"
)"
test "$CLI_PACKAGE_VERSION" = "1.18.29"
test "$("$OPENCODE_BIN" --version)" = "1.18.29"
test -n "${JUSTICE_HOST_TEST_MODEL:-}"

bun run vitest run tests/types/command-execute-before.contract.test.ts

bun - <<'BUN'
const pluginPackage = await Bun.file("node_modules/@opencode-ai/plugin/package.json").json();
const sdkPackage = await Bun.file("node_modules/@opencode-ai/sdk/package.json").json();
if (pluginPackage.version !== "1.14.21") throw new Error(`plugin=${pluginPackage.version}`);
if (sdkPackage.version !== "1.14.21") throw new Error(`sdk=${sdkPackage.version}`);

const plugin = (await Bun.file("node_modules/@opencode-ai/plugin/dist/index.d.ts").text())
  .replace(/\s+/g, " ");
const sdk = (await Bun.file("node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts").text())
  .replace(/\s+/g, " ");

function requireText(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`missing ${label}: ${needle}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireHookInputFields(haystack, hookName, fields) {
  const hook = escapeRegExp(hookName);
  const match = haystack.match(
    new RegExp(
      `"${hook}"\\?\\s*:\\s*\\(\\s*input\\s*:\\s*\\{([^}]*)\\}`,
    ),
  );
  if (!match) throw new Error(`missing ${hookName} input object`);

  const input = match[1];
  for (const [field, type] of fields) {
    const fieldPattern = new RegExp(
      `\\b${escapeRegExp(field)}\\s*:\\s*${escapeRegExp(type)}\\b`,
    );
    if (!fieldPattern.test(input)) {
      throw new Error(`missing ${hookName}.${field}: ${type}`);
    }
  }
}

requireHookInputFields(plugin, "command.execute.before", [
  ["command", "string"],
  ["sessionID", "string"],
  ["arguments", "string"],
]);
requireHookInputFields(plugin, "chat.params", [
  ["sessionID", "string"],
  ["agent", "string"],
  ["model", "Model"],
  ["provider", "ProviderContext"],
  ["message", "UserMessage"],
]);

const userStart = sdk.indexOf("export type UserMessage = {");
const userEnd = sdk.indexOf("export type ProviderAuthError", userStart);
if (userStart < 0 || userEnd < 0) throw new Error("UserMessage declaration not found");
const user = sdk.slice(userStart, userEnd);
requireText(user, "id: string", "UserMessage.id");
requireText(user, "sessionID: string", "UserMessage.sessionID");

const assistantStart = sdk.indexOf("export type AssistantMessage = {");
const assistantEnd = sdk.indexOf("export type Message =", assistantStart);
if (assistantStart < 0 || assistantEnd < 0) throw new Error("AssistantMessage declaration not found");
const assistant = sdk.slice(assistantStart, assistantEnd);
requireText(assistant, "id: string", "AssistantMessage.id");
requireText(assistant, "sessionID: string", "AssistantMessage.sessionID");
requireText(assistant, "parentID: string", "AssistantMessage.parentID");
requireText(assistant, "role: \"assistant\"", "AssistantMessage.role");
requireText(assistant, "completed?: number", "AssistantMessage.time.completed");
if (assistant.includes(" agent: string")) {
  throw new Error("root SDK now types AssistantMessage.agent; re-review provenance");
}

const commandStart = sdk.indexOf("export type EventCommandExecuted = {");
const commandEnd = sdk.indexOf("export type Session =", commandStart);
if (commandStart < 0 || commandEnd < 0) throw new Error("EventCommandExecuted not found");
const commandEvent = sdk.slice(commandStart, commandEnd);
for (const field of ["name: string", "sessionID: string", "messageID: string"]) {
  requireText(commandEvent, field, `EventCommandExecuted.${field}`);
}

console.log("@opencode-ai/plugin=1.14.21");
console.log("@opencode-ai/sdk=1.14.21");
console.log("candidate identity fields typed; AssistantMessage.agent requires host trace");
BUN

"$OPENCODE_BIN" run --help | grep -F -- "--command"
"$OPENCODE_BIN" run --help | grep -F -- "--session"
"$OPENCODE_BIN" run --help | grep -F -- "--attach"
"$OPENCODE_BIN" serve --help | grep -F -- "--port"
"$OPENCODE_BIN" serve --help | grep -F -- "--hostname"

SRC="$SPIKE_ROOT/pinned-source"
rm -rf "$SRC"
mkdir -p "$SRC"

PINNED=16747470f976aca3d362ad730bcd3fe82ecc2c9a
BASE="https://raw.githubusercontent.com/anomalyco/opencode/$PINNED"

curl -fsSL "$BASE/packages/opencode/src/session/prompt.ts" -o "$SRC/prompt.ts"
curl -fsSL "$BASE/packages/opencode/src/effect/runner.ts" -o "$SRC/runner.ts"
curl -fsSL "$BASE/packages/opencode/src/plugin/index.ts" -o "$SRC/opencode-plugin-index.ts"
curl -fsSL "$BASE/packages/opencode/src/session/llm/request.ts" -o "$SRC/request.ts"
curl -fsSL "$BASE/packages/opencode/src/session/processor.ts" -o "$SRC/processor.ts"
curl -fsSL "$BASE/packages/opencode/src/cli/effect-cmd.ts" -o "$SRC/effect-cmd.ts"
curl -fsSL "$BASE/packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts" -o "$SRC/instance-handler.ts"
curl -fsSL "$BASE/packages/opencode/src/server/routes/instance/httpapi/lifecycle.ts" -o "$SRC/instance-lifecycle.ts"
curl -fsSL "$BASE/packages/sdk/js/src/gen/sdk.gen.ts" -o "$SRC/sdk.gen.ts"
curl -fsSL "$BASE/packages/sdk/js/src/gen/types.gen.ts" -o "$SRC/types.gen.ts"
curl -fsSL "$BASE/packages/plugin/src/index.ts" -o "$SRC/plugin-index.ts"

curl -fsSL "$BASE/packages/opencode/package.json" -o "$SRC/package.json"

SOURCE_VERSION="$(
  bun -e "const p=await Bun.file(process.argv.at(-1)).json(); process.stdout.write(p.version)" "$SRC/package.json"
)"
test "$SOURCE_VERSION" = "1.18.29"

grep -F "\"command.execute.before\"" "$SRC/prompt.ts"
grep -F "const result = yield* prompt({" "$SRC/prompt.ts"
grep -F "messageID: result.info.id" "$SRC/prompt.ts"

grep -F "void hook[\"event\"]?." "$SRC/opencode-plugin-index.ts"
grep -F "yield* Effect.promise(async () => fn(input, output))" "$SRC/opencode-plugin-index.ts"

grep -F "const params = yield* input.plugin.trigger(" "$SRC/request.ts"
grep -F "\"chat.params\"" "$SRC/request.ts"
grep -F "Effect.catch(halt)" "$SRC/processor.ts"

grep -F "await AppRuntime.runPromise(store.dispose(ctx))" "$SRC/effect-cmd.ts"
grep -F "url: \"/instance/dispose\"" "$SRC/sdk.gen.ts"
grep -F "yield* markInstanceForDisposal" "$SRC/instance-handler.ts"
grep -F "marked.store.dispose(marked.ctx)" "$SRC/instance-lifecycle.ts"
grep -F "response is sent before disposeMiddleware performs the teardown" "$SRC/instance-lifecycle.ts"

grep -F "case \"Running\":" "$SRC/runner.ts"
grep -F "case \"ShellThenRun\":" "$SRC/runner.ts"
grep -F "return [awaitDone(st.run.done), st]" "$SRC/runner.ts"
grep -F "export type EventCommandExecuted = {" "$SRC/types.gen.ts"
grep -F "export type EventSessionStatus = {" "$SRC/types.gen.ts"
grep -F "export type EventSessionIdle = {" "$SRC/types.gen.ts"
grep -F "export type EventSessionError = {" "$SRC/types.gen.ts"
grep -F "\"chat.params\"?:" "$SRC/plugin-index.ts"

echo "TEMP_OPENCODE_PACKAGE=opencode-ai"
echo "TEMP_OPENCODE_PACKAGE_VERSION=$CLI_PACKAGE_VERSION"
echo "TEMP_OPENCODE_BIN=$OPENCODE_BIN"
echo "PINNED_HOST_SOURCE_COMMIT=$PINNED"
echo "PINNED_HOST_SOURCE_VERSION=$SOURCE_VERSION"
echo "PINNED_HOST_SOURCE_OK"
'
```

Expected: PASS. The temporary `opencode-ai` package version, the exact temporary binary's `--version`, fetched
`packages/opencode/package.json`, and the immutable source commit must all resolve to OpenCode `1.18.29`; the source
commit is exactly `16747470f976aca3d362ad730bcd3fe82ecc2c9a`. The repository/global `PATH` is not an OpenCode authority.
The installed declaration checks are semantic field checks: they MUST tolerate declaration-emitter whitespace and
line-layout differences while still requiring the exact hook name and required input field/type pairs. Do not
replace them with one formatting-sensitive flattened substring or weaken them to hook-name-only presence checks.
Package provisioning is isolated under `SPIKE_ROOT`, including Bun's install cache. The source checks must also prove:
generic `event` callbacks are dispatched without awaiting their Promise, named hooks are awaited by
`Plugin.trigger()`, `chat.params` runs inside the LLM/processor failure boundary, and `command.execute.before`
precedes `prompt()` and `command.executed` in `SessionPrompt.command()`. They must additionally prove that local
`opencode run` disposes its instance, the SDK exposes `POST /instance/dispose`, and the HTTP response can be produced
before `InstanceStore.dispose()` finishes. Therefore attached probes must wait for a plugin-disposal sentinel;
neither the HTTP response nor `kill` is a trace-flush guarantee. Network failure while retrieving that exact
snapshot is execution-prerequisite `BLOCKED`; exact `opencode-ai@1.18.29` provisioning failure is the same.
In either prerequisite failure case, stop before Step 2 without generating the runtime report or an overall
`JUS-P0-01 runtime observation` line. The failed attempt may leave only temporary scratch state under `SPIKE_ROOT`;
do not commit, copy, or interpret it as evidence. A rerun starts with Step 1's `rm -rf "$SPIKE_ROOT"` and therefore
must create a fresh temporary CLI and source snapshot. Do not substitute another package version, tag, branch,
global binary, or `PATH` binary.

- [ ] **Step 2: Create the temporary workspace, probe, and validator**

Run from repository root:

```bash
devcontainer exec --workspace-folder . bash -lc '
set -euo pipefail
SPIKE_ROOT=/tmp/justice-controller-routing-spike
WORKSPACE="$SPIKE_ROOT/workspace"
NOMINAL_TRACE="$SPIKE_ROOT/nominal.trace.jsonl"
OVERLAP_TRACE="$SPIKE_ROOT/overlap.trace.jsonl"
NOMINAL_STATUS="$SPIKE_ROOT/nominal-status.tsv"
OVERLAP_STATUS="$SPIKE_ROOT/overlap-status.tsv"
BARRIER_DIR="$SPIKE_ROOT/barrier"

mkdir -p "$WORKSPACE/.opencode/plugins" "$BARRIER_DIR"
: > "$NOMINAL_TRACE"
: > "$OVERLAP_TRACE"
: > "$NOMINAL_STATUS"
: > "$OVERLAP_STATUS"

cat > "$WORKSPACE/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "sisyphus": { "mode": "primary" },
    "atlas": { "mode": "primary" }
  },
  "command": {
    "justice-implement-brainstorming": {
      "template": "Reply with ROUTING_PROBE_OK only.",
      "agent": "sisyphus"
    },
    "justice-implement-writing-plans": {
      "template": "Reply with ROUTING_PROBE_OK only.",
      "agent": "sisyphus"
    },
    "justice-implement-subagent-driven-development": {
      "template": "Reply with ROUTING_PROBE_OK only.",
      "agent": "atlas"
    },
    "justice-implement-executing-plans": {
      "template": "Reply with ROUTING_PROBE_OK only.",
      "agent": "sisyphus"
    }
  }
}
JSON

cat > "$WORKSPACE/.opencode/plugins/controller-routing-probe.js" <<'PROBE'
import { appendFile, writeFile } from "node:fs/promises";

const tracePath = process.env.JUSTICE_ROUTING_TRACE;
if (!tracePath) throw new Error("JUSTICE_ROUTING_TRACE is required");

const barrierEnabled = process.env.JUSTICE_ROUTING_BARRIER === "1";
const barrierDir = process.env.JUSTICE_ROUTING_BARRIER_DIR;
const PROBE_REVISION = "jus-p0-01-f016";
const processRole = process.env.JUSTICE_ROUTING_PROBE_ROLE;
if (!["local", "server", "client"].includes(processRole)) {
  throw new Error("JUSTICE_ROUTING_PROBE_ROLE must be local, server, or client");
}

const COMMAND_A = "justice-implement-writing-plans";
const COMMAND_B = "justice-implement-subagent-driven-development";

const ALLOWED_KEYS = new Set([
  "hook",
  "command",
  "sessionID",
  "agent",
  "role",
  "userMessageID",
  "assistantMessageID",
  "parentMessageID",
  "completedPresent",
  "barrierEnabled",
  "barrierDirSet",
  "commandASeen",
  "overlapSessionSet",
  "sessionMatchesOverlap",
  "aChatBlocked",
  "releasePromiseSet",
  "probeRevision",
  "processRole",
]);

let writeChain = Promise.resolve();
let overlapSession;
let releaseA;
let releasePromise;
let aChatBlocked = false;
let commandASeen = false;
let closing = false;

function append(record) {
  const clean = Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
  const stamped = {
    ...clean,
    probeRevision: PROBE_REVISION,
    processRole,
  };
  for (const key of Object.keys(stamped)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`forbidden trace key: ${key}`);
  }
  writeChain = writeChain.then(() =>
    appendFile(tracePath, `${JSON.stringify(stamped)}\n`, "utf8"),
  );
  return writeChain;
}

function armBarrier(sessionID) {
  if (!barrierEnabled) return;
  overlapSession = sessionID;
  releasePromise = new Promise((resolve) => {
    releaseA = resolve;
  });
}

async function awaitBCommand() {
  if (!releasePromise) throw new Error("overlap release promise missing");
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("overlap barrier timeout")), 15000);
  });
  try {
    await Promise.race([releasePromise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const ControllerRoutingProbe = async () => ({
  "command.execute.before": async (input) => {
    await append({
      hook: "command.execute.before",
      command: input.command,
      sessionID: input.sessionID,
    });

    if (input.command === COMMAND_A) commandASeen = true;
    if (!barrierEnabled) return;
    if (input.command === COMMAND_A && overlapSession === undefined) {
      armBarrier(input.sessionID);
      return;
    }
    if (
      input.command === COMMAND_B &&
      overlapSession !== undefined &&
      input.sessionID === overlapSession
    ) {
      releaseA?.();
    }
  },

  "chat.params": async (input) => {
    await append({
      hook: "chat.params",
      sessionID: input.sessionID,
      agent: input.agent,
      userMessageID:
        input.message && typeof input.message.id === "string"
          ? input.message.id
          : undefined,
      barrierEnabled,
      barrierDirSet: typeof barrierDir === "string" && barrierDir.length > 0,
      commandASeen,
      overlapSessionSet: overlapSession !== undefined,
      sessionMatchesOverlap:
        overlapSession !== undefined && input.sessionID === overlapSession,
      aChatBlocked,
      releasePromiseSet: releasePromise !== undefined,
    });

    if (
      barrierEnabled &&
      !aChatBlocked &&
      overlapSession !== undefined &&
      input.sessionID === overlapSession
    ) {
      if (!barrierDir) throw new Error("JUSTICE_ROUTING_BARRIER_DIR is required");
      aChatBlocked = true;
      await writeFile(`${barrierDir}/a-chat-blocked`, input.sessionID, "utf8");
      await awaitBCommand();
    }
  },

  event: async ({ event }) => {
    if (closing) return;

    if (event?.type === "message.updated") {
      const info = event?.properties?.info;
      if (!info || info.role !== "assistant") return;
      const time = info.time && typeof info.time === "object" ? info.time : {};
      await append({
        hook: "message.updated",
        sessionID: typeof info.sessionID === "string" ? info.sessionID : undefined,
        role: "assistant",
        agent: typeof info.agent === "string" ? info.agent : undefined,
        assistantMessageID: typeof info.id === "string" ? info.id : undefined,
        parentMessageID:
          typeof info.parentID === "string" ? info.parentID : undefined,
        completedPresent:
          Object.prototype.hasOwnProperty.call(time, "completed") &&
          time.completed !== undefined,
      });
      return;
    }

    if (event?.type === "command.executed") {
      const p = event?.properties;
      await append({
        hook: "command.executed",
        command: typeof p?.name === "string" ? p.name : undefined,
        sessionID: typeof p?.sessionID === "string" ? p.sessionID : undefined,
        assistantMessageID:
          typeof p?.messageID === "string" ? p.messageID : undefined,
      });
    }
  },

  dispose: async () => {
    closing = true;
    await writeChain;
    await appendFile(tracePath, `${JSON.stringify({ hook: "probe.dispose_started" })}\n`, "utf8");
    await appendFile(tracePath, `${JSON.stringify({ hook: "probe.dispose_flushed" })}\n`, "utf8");
  },
});
PROBE

cat > "$SPIKE_ROOT/create-session.mjs" <<'CREATE_SESSION'
import { writeFile } from "node:fs/promises";

const [baseUrl, workspace, outputPath] = process.argv.slice(2);
if (!baseUrl || !workspace || !outputPath) {
  throw new Error("usage: create-session.mjs BASE_URL WORKSPACE OUTPUT");
}

const response = await fetch(`${baseUrl}/session`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-opencode-directory": workspace,
  },
  body: JSON.stringify({ title: "justice-controller-routing-overlap" }),
});

if (!response.ok) throw new Error(`session create failed: ${response.status}`);
const body = await response.json();
if (!body || typeof body.id !== "string" || body.id.length === 0) {
  throw new Error("session create response missing id");
}
await writeFile(outputPath, body.id, "utf8");
CREATE_SESSION

cat > "$SPIKE_ROOT/validate-and-report.mjs" <<'VALIDATOR'
import { readFile, writeFile } from "node:fs/promises";

const [
  nominalTracePath,
  nominalStatusPath,
  overlapTracePath,
  overlapStatusPath,
  reportPath,
] = process.argv.slice(2);

if (
  !nominalTracePath ||
  !nominalStatusPath ||
  !overlapTracePath ||
  !overlapStatusPath ||
  !reportPath
) {
  throw new Error(
    "usage: validate-and-report.mjs NOMINAL_TRACE NOMINAL_STATUS OVERLAP_TRACE OVERLAP_STATUS REPORT",
  );
}

const EXPECTED = new Map([
  ["justice-implement-brainstorming", "sisyphus"],
  ["justice-implement-writing-plans", "sisyphus"],
  ["justice-implement-subagent-driven-development", "atlas"],
  ["justice-implement-executing-plans", "sisyphus"],
]);

const OVERLAP = [
  ["justice-implement-writing-plans", "sisyphus"],
  ["justice-implement-subagent-driven-development", "atlas"],
];

const ALLOWED_KEYS = new Set([
  "hook",
  "command",
  "sessionID",
  "agent",
  "role",
  "userMessageID",
  "assistantMessageID",
  "parentMessageID",
  "completedPresent",
  "barrierEnabled",
  "barrierDirSet",
  "commandASeen",
  "overlapSessionSet",
  "sessionMatchesOverlap",
  "aChatBlocked",
  "releasePromiseSet",
  "probeRevision",
  "processRole",
]);

const ALLOWED_HOOKS = new Set([
  "command.execute.before",
  "chat.params",
  "message.updated",
  "command.executed",
  "probe.dispose_started",
  "probe.dispose_flushed",
]);

const failures = [];

async function readTrace(path, label) {
  const lines = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    let record;
    try {
      record = JSON.parse(lines[index]);
    } catch {
      failures.push(`${label}:trace_json_invalid:${index + 1}`);
      continue;
    }
    if (!record || Array.isArray(record) || typeof record !== "object") {
      failures.push(`${label}:trace_record_not_object:${index + 1}`);
      continue;
    }
    const forbidden = Object.keys(record).filter((k) => !ALLOWED_KEYS.has(k));
    if (forbidden.length) {
      failures.push(
        `${label}:trace_forbidden_keys:${index + 1}:${forbidden.sort().join(",")}`,
      );
    }
    if (!ALLOWED_HOOKS.has(record.hook)) {
      failures.push(`${label}:trace_hook_invalid:${index + 1}`);
    }
    records.push({ ...record, __index: index });
  }
  return records;
}

function validateDisposeFlush(records, expectedCount, label) {
  const started = records.filter((r) => r.hook === "probe.dispose_started");
  const flushed = records.filter((r) => r.hook === "probe.dispose_flushed");

  if (started.length !== expectedCount) {
    failures.push(`${label}:dispose_started_count:${started.length}`);
  }
  if (flushed.length !== expectedCount) {
    failures.push(`${label}:dispose_flushed_count:${flushed.length}`);
  }

  const pairs = Math.min(started.length, flushed.length);
  for (let index = 0; index < pairs; index += 1) {
    if (!(started[index].__index < flushed[index].__index)) {
      failures.push(`${label}:dispose_marker_order:${index}`);
    }
  }
}

async function readStatuses(path, expectedCommands, label) {
  const statuses = new Map();
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    if (!line) continue;
    const [command, rawCode, extra] = line.split("\t");
    if (
      extra !== undefined ||
      !expectedCommands.has(command) ||
      !/^\d+$/.test(rawCode ?? "") ||
      statuses.has(command)
    ) {
      failures.push(`${label}:run_status_invalid`);
      continue;
    }
    statuses.set(command, Number(rawCode));
  }
  for (const command of expectedCommands) {
    if (!statuses.has(command)) failures.push(`${label}:run_status_missing:${command}`);
    else if (statuses.get(command) !== 0) {
      failures.push(`${label}:host_command_failed:${command}:${statuses.get(command)}`);
    }
  }
  return statuses;
}

function completedMessages(records, sessionID, assistantMessageID, expectedAgent) {
  return records.filter(
    (r) =>
      r.hook === "message.updated" &&
      r.sessionID === sessionID &&
      r.role === "assistant" &&
      r.assistantMessageID === assistantMessageID &&
      r.agent === expectedAgent &&
      r.completedPresent === true,
  );
}

function chatsFor(records, sessionID, userMessageID, expectedAgent) {
  return records.filter(
    (r) =>
      r.hook === "chat.params" &&
      r.sessionID === sessionID &&
      r.userMessageID === userMessageID &&
      r.agent === expectedAgent,
  );
}

function validateCommandChain(records, command, expectedAgent, label) {
  const starts = records.filter(
    (r) => r.hook === "command.execute.before" && r.command === command,
  );
  const completions = records.filter(
    (r) => r.hook === "command.executed" && r.command === command,
  );

  if (starts.length !== 1) {
    failures.push(`${label}:command_start_count:${command}:${starts.length}`);
    return undefined;
  }
  if (completions.length !== 1) {
    failures.push(`${label}:command_completion_count:${command}:${completions.length}`);
    return undefined;
  }

  const start = starts[0];
  const completion = completions[0];
  if (
    typeof start.sessionID !== "string" ||
    start.sessionID.length === 0 ||
    completion.sessionID !== start.sessionID
  ) {
    failures.push(`${label}:command_session_mismatch:${command}`);
    return undefined;
  }

  const assistantMessageID = completion.assistantMessageID;
  if (typeof assistantMessageID !== "string" || assistantMessageID.length === 0) {
    failures.push(`${label}:command_assistant_id_missing:${command}`);
    return undefined;
  }

  const finals = completedMessages(
    records,
    start.sessionID,
    assistantMessageID,
    expectedAgent,
  );
  if (finals.length !== 1) {
    failures.push(`${label}:final_message_count:${command}:${finals.length}`);
    return undefined;
  }

  const final = finals[0];
  const userMessageID = final.parentMessageID;
  if (typeof userMessageID !== "string" || userMessageID.length === 0) {
    failures.push(`${label}:parent_user_id_missing:${command}`);
    return undefined;
  }

  const chats = chatsFor(records, start.sessionID, userMessageID, expectedAgent);
  if (chats.length === 0) {
    failures.push(`${label}:chat_identity_missing:${command}`);
    return undefined;
  }

  if (!(start.__index < completion.__index)) {
    failures.push(`${label}:completion_before_start:${command}`);
  }

  return {
    command,
    sessionID: start.sessionID,
    userMessageID,
    assistantMessageID,
    chatAgent: chats[0].agent,
    finalAgent: final.agent,
    startIndex: start.__index,
    chatIndex: chats[0].__index,
    finalIndex: final.__index,
    completionIndex: completion.__index,
  };
}

const nominalRecords = await readTrace(nominalTracePath, "nominal");
validateDisposeFlush(nominalRecords, EXPECTED.size, "nominal");
await readStatuses(nominalStatusPath, new Set(EXPECTED.keys()), "nominal");

const nominalSummary = [];
for (const [command, agent] of EXPECTED) {
  const chain = validateCommandChain(nominalRecords, command, agent, "nominal");
  if (chain) nominalSummary.push(chain);
}

const overlapRecords = await readTrace(overlapTracePath, "overlap");
validateDisposeFlush(overlapRecords, 1, "overlap");
await readStatuses(
  overlapStatusPath,
  new Set(OVERLAP.map(([command]) => command)),
  "overlap",
);

const overlapSummary = OVERLAP.map(([command, agent]) =>
  validateCommandChain(overlapRecords, command, agent, "overlap"),
).filter(Boolean);

if (overlapSummary.length === 2) {
  const [a, b] = overlapSummary;
  if (a.sessionID !== b.sessionID) {
    failures.push("overlap:not_same_session");
  }
  if (a.userMessageID === b.userMessageID) {
    failures.push("overlap:user_identity_collapsed");
  }
  if (a.assistantMessageID === b.assistantMessageID) {
    failures.push("overlap:assistant_identity_collapsed");
  }

  const aStart = overlapRecords.find(
    (r) =>
      r.hook === "command.execute.before" &&
      r.command === "justice-implement-writing-plans",
  );
  const bStart = overlapRecords.find(
    (r) =>
      r.hook === "command.execute.before" &&
      r.command === "justice-implement-subagent-driven-development",
  );
  const aChat = overlapRecords.find(
    (r) =>
      r.hook === "chat.params" &&
      r.sessionID === a.sessionID &&
      r.userMessageID === a.userMessageID,
  );
  const aFinal = overlapRecords.find(
    (r) =>
      r.hook === "message.updated" &&
      r.assistantMessageID === a.assistantMessageID &&
      r.completedPresent === true,
  );

  if (!aStart || !bStart || !aChat || !aFinal) {
    failures.push("overlap:barrier_evidence_missing");
  } else if (
    !(
      aStart.__index < aChat.__index &&
      aChat.__index < bStart.__index &&
      bStart.__index < aFinal.__index
    )
  ) {
    failures.push("overlap:required_interleaving_not_observed");
  }

  const crossA = completedMessages(
    overlapRecords,
    a.sessionID,
    b.assistantMessageID,
    "sisyphus",
  );
  const crossB = completedMessages(
    overlapRecords,
    b.sessionID,
    a.assistantMessageID,
    "atlas",
  );
  if (crossA.length || crossB.length) failures.push("overlap:controller_cross_join");
} else {
  failures.push(`overlap:chain_count:${overlapSummary.length}`);
}

const result = failures.length === 0 ? "PASS" : "BLOCKED";

const report = [
  "# Controller Routing Runtime Signal Spike",
  "",
  "## Environment",
  "- OpenCode version: `1.18.29`",
  "- @opencode-ai/plugin: `1.14.21`",
  "- @opencode-ai/sdk: `1.14.21`",
  "- pinned host source commit: `16747470f976aca3d362ad730bcd3fe82ecc2c9a`",
  "",
  "## Verified candidate contract",
  "- command.execute.before: exact command + session; capture-arm only",
  "- chat.params: session + UserMessage.id + raw agent",
  "- finalized message.updated: session + assistant id + parent user id + raw agent + completion",
  "- command.executed: exact command + session + result assistant message id",
  "- detached event trace flush: instance disposal + probe.dispose_flushed sentinel",
  "",
  "## Nominal four-command chains",
];

for (const item of nominalSummary) {
  report.push(`### ${item.command}`);
  report.push(`- sessionID: \`${item.sessionID}\``);
  report.push(`- userMessageID: \`${item.userMessageID}\``);
  report.push(`- assistantMessageID: \`${item.assistantMessageID}\``);
  report.push(`- chat agent: \`${item.chatAgent}\``);
  report.push(`- final agent: \`${item.finalAgent}\``);
  report.push("");
}

report.push("## Same-session overlap");
for (const item of overlapSummary) {
  report.push(`### ${item.command}`);
  report.push(`- sessionID: \`${item.sessionID}\``);
  report.push(`- userMessageID: \`${item.userMessageID}\``);
  report.push(`- assistantMessageID: \`${item.assistantMessageID}\``);
  report.push(`- chat agent: \`${item.chatAgent}\``);
  report.push(`- final agent: \`${item.finalAgent}\``);
  report.push("");
}

report.push("## Result");
report.push(`JUS-P0-01 runtime observation = ${result}`);
report.push("");
report.push("## Sanitized failures");
if (failures.length === 0) report.push("- none");
else for (const failure of failures) report.push(`- ${failure}`);
report.push("");

await writeFile(reportPath, `${report.join("\n")}\n`, "utf8");
console.log(`JUS-P0-01 runtime observation = ${result}`);
process.exit(result === "PASS" ? 0 : 1);
VALIDATOR

WORKSPACE="$WORKSPACE" SPIKE_ROOT="$SPIKE_ROOT" bun - <<'BUN'
const workspace = process.env.WORKSPACE;
const spikeRoot = process.env.SPIKE_ROOT;
if (!workspace || !spikeRoot) throw new Error("syntax-check paths are required");

const files = [
  `${workspace}/.opencode/plugins/controller-routing-probe.js`,
  `${spikeRoot}/create-session.mjs`,
  `${spikeRoot}/validate-and-report.mjs`,
];

const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
for (const file of files) {
  const source = await Bun.file(file).text();
  transpiler.transformSync(source);
  console.log(`syntax-ok:${file}`);
}
BUN
'
```

Expected: all three temporary JavaScript files pass syntax validation. This check MUST use Bun's parser without
executing the temporary modules: `Bun.Transpiler.transformSync()` parses/transpiles the source while module resolution
and runtime execution remain outside this syntax-only gate. Do not substitute `node --check` unless Step 1 has
explicitly proved that `node` is a real Node.js CLI with compatible `--check` semantics; a Bun fallback wrapper is not
such proof. In particular, syntax validation MUST NOT evaluate the probe's top-level `JUSTICE_ROUTING_TRACE` guard.

- [ ] **Step 3: Run the four fresh-session nominal probes**

Run:

```bash
devcontainer exec --workspace-folder . bash -lc '
set -euo pipefail
SPIKE_ROOT=/tmp/justice-controller-routing-spike
OPENCODE_BIN="$SPIKE_ROOT/opencode-cli/node_modules/.bin/opencode"
test -x "$OPENCODE_BIN"
test "$("$OPENCODE_BIN" --version)" = "1.18.29"

WORKSPACE="$SPIKE_ROOT/workspace"
TRACE="$SPIKE_ROOT/nominal.trace.jsonl"
STATUS="$SPIKE_ROOT/nominal-status.tsv"
PROBE_HOME="$SPIKE_ROOT/probe-home"
PROBE_XDG_CONFIG="$SPIKE_ROOT/probe-xdg-config"
mkdir -p "$PROBE_HOME" "$PROBE_XDG_CONFIG"

: > "$TRACE"
: > "$STATUS"

run_probe() {
  command_name="$1"
  set +e
  (
    cd "$WORKSPACE"
    HOME="$PROBE_HOME" \
    XDG_CONFIG_HOME="$PROBE_XDG_CONFIG" \
    JUSTICE_ROUTING_TRACE="$TRACE" \
    JUSTICE_ROUTING_BARRIER=0 \
    JUSTICE_ROUTING_PROBE_ROLE=local \
      "$OPENCODE_BIN" run \
        --format json \
        --model "$JUSTICE_HOST_TEST_MODEL" \
        --command "$command_name" \
        >/dev/null 2>/dev/null
  )
  code=$?
  set -e
  printf "%s\t%s\n" "$command_name" "$code" >> "$STATUS"
}

run_probe justice-implement-brainstorming
run_probe justice-implement-writing-plans
run_probe justice-implement-subagent-driven-development
run_probe justice-implement-executing-plans

test "$(wc -l < "$STATUS" | tr -d " ")" = "4"
'
```

These four probes remain separate because workflow identity must stay correct even where multiple workflows choose
`sisyphus`.

- [ ] **Step 4: Run one deterministic same-host/same-session overlap probe**

This probe MUST use one exact temporary `$OPENCODE_BIN serve` process. Two independent local `$OPENCODE_BIN run` processes without `--attach`
do not satisfy the concurrency requirement because they do not share the same process-local session runner.

Run:

```bash
devcontainer exec --workspace-folder . bash -lc '
set -euo pipefail
SPIKE_ROOT=/tmp/justice-controller-routing-spike
OPENCODE_BIN="$SPIKE_ROOT/opencode-cli/node_modules/.bin/opencode"
test -x "$OPENCODE_BIN"
test "$("$OPENCODE_BIN" --version)" = "1.18.29"

WORKSPACE="$SPIKE_ROOT/workspace"
TRACE="$SPIKE_ROOT/overlap.trace.jsonl"
STATUS="$SPIKE_ROOT/overlap-status.tsv"
BARRIER_DIR="$SPIKE_ROOT/barrier"
SESSION_FILE="$SPIKE_ROOT/overlap-session.txt"
PORT=40967
BASE_URL="http://127.0.0.1:$PORT"
SERVER_STDERR="$SPIKE_ROOT/overlap-server.stderr"
A_STDERR="$SPIKE_ROOT/overlap-a.stderr"
B_STDERR="$SPIKE_ROOT/overlap-b.stderr"
PROBE_HOME="$SPIKE_ROOT/probe-home"
PROBE_XDG_CONFIG="$SPIKE_ROOT/probe-xdg-config"
mkdir -p "$PROBE_HOME" "$PROBE_XDG_CONFIG"

: > "$TRACE"
: > "$STATUS"
: > "$SERVER_STDERR"
: > "$A_STDERR"
: > "$B_STDERR"
rm -f "$BARRIER_DIR/a-chat-blocked" "$SESSION_FILE"

SERVER_PID=
A_PID=
B_PID=

cleanup_processes() {
  code=$?
  for pid in "${A_PID:-}" "${B_PID:-}" "${SERVER_PID:-}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  exit "$code"
}
trap cleanup_processes EXIT

(
  cd "$WORKSPACE"
  HOME="$PROBE_HOME" \
  XDG_CONFIG_HOME="$PROBE_XDG_CONFIG" \
  JUSTICE_ROUTING_TRACE="$TRACE" \
  JUSTICE_ROUTING_BARRIER=1 \
  JUSTICE_ROUTING_BARRIER_DIR="$BARRIER_DIR" \
  JUSTICE_ROUTING_PROBE_ROLE=server \
    "$OPENCODE_BIN" serve --hostname 127.0.0.1 --port "$PORT" >/dev/null 2>"$SERVER_STDERR"
) &
SERVER_PID=$!

for _ in $(seq 1 100); do
  if curl -fsS "$BASE_URL/global/health" >/dev/null 2>/dev/null; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "OpenCode overlap server exited" >&2
    exit 1
  fi
  sleep 0.1
done
curl -fsS "$BASE_URL/global/health" >/dev/null

bun "$SPIKE_ROOT/create-session.mjs" "$BASE_URL" "$WORKSPACE" "$SESSION_FILE"
SESSION_ID="$(cat "$SESSION_FILE")"
test -n "$SESSION_ID"

set +e
(
  cd "$WORKSPACE"
  HOME="$PROBE_HOME" \
  XDG_CONFIG_HOME="$PROBE_XDG_CONFIG" \
  JUSTICE_ROUTING_TRACE="$TRACE" \
  JUSTICE_ROUTING_BARRIER=1 \
  JUSTICE_ROUTING_BARRIER_DIR="$BARRIER_DIR" \
  JUSTICE_ROUTING_PROBE_ROLE=client \
    "$OPENCODE_BIN" run \
      --attach "$BASE_URL" \
      --dir "$WORKSPACE" \
      --session "$SESSION_ID" \
      --format json \
      --model "$JUSTICE_HOST_TEST_MODEL" \
      --command justice-implement-writing-plans \
      >/dev/null 2>"$A_STDERR"
) &
A_PID=$!
set -e

classify_a_pre_barrier_failure() {
  set +e
  wait "$A_PID"
  A_EARLY_CODE=$?
  set -e
  A_PID=
  A_START_COUNT="$(grep -Ec '"hook":"command.execute.before".*"command":"justice-implement-writing-plans"' "$TRACE" 2>/dev/null || true)"
  A_CHAT_COUNT="$(grep -Ec '"hook":"chat.params"' "$TRACE" 2>/dev/null || true)"
  A_STDERR_PRESENT=false
  test ! -s "$A_STDERR" || A_STDERR_PRESENT=true
  if [ "$A_START_COUNT" -eq 0 ]; then
    FAILURE_STAGE="before_command_execute_before"
  elif [ "$A_CHAT_COUNT" -eq 0 ]; then
    FAILURE_STAGE="after_command_execute_before_before_chat_params"
  else
    FAILURE_STAGE="after_chat_params_before_barrier_file"
  fi
  printf '%s\n' \
    "OVERLAP_A_PRE_BARRIER_FAILURE" \
    "a_exit_code=$A_EARLY_CODE" \
    "failure_stage=$FAILURE_STAGE" \
    "a_command_start_count=$A_START_COUNT" \
    "chat_params_count=$A_CHAT_COUNT" \
    "a_stderr_present=$A_STDERR_PRESENT" >&2

  TRACE="$TRACE" F012_CHAT_COUNT="$A_CHAT_COUNT" bun - <<'BARRIER_DIAGNOSTIC'
const path = process.env.TRACE;
if (!path) throw new Error("TRACE is required");

const f012CountRaw = process.env.F012_CHAT_COUNT;
if (!f012CountRaw || !/^\d+$/.test(f012CountRaw)) {
  throw new Error("F012_CHAT_COUNT must be a non-negative integer");
}
const f012Count = Number(f012CountRaw);

const records = (await Bun.file(path).text())
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((record) => record?.hook === "chat.params");

const fields = [
  ["barrierEnabled", "barrier_enabled"],
  ["barrierDirSet", "barrier_dir_set"],
  ["commandASeen", "command_a_seen"],
  ["overlapSessionSet", "overlap_session_set"],
  ["sessionMatchesOverlap", "session_matches_overlap"],
  ["aChatBlocked", "a_chat_blocked"],
  ["releasePromiseSet", "release_promise_set"],
];

const EXPECTED_REVISION = "jus-p0-01-f016";
const expectedWriterRecords = records.filter(
  (record) =>
    record?.probeRevision === EXPECTED_REVISION &&
    record?.processRole === "server",
);
const clientWriterRecords = records.filter(
  (record) =>
    record?.probeRevision === EXPECTED_REVISION &&
    record?.processRole === "client",
);
const schemaRecords = expectedWriterRecords.filter((record) =>
  fields.every(([key]) => typeof record[key] === "boolean"),
);

console.error(`barrier_trace_record_count=${records.length}`);
console.error(`barrier_trace_expected_writer_count=${expectedWriterRecords.length}`);
console.error(`barrier_trace_client_writer_count=${clientWriterRecords.length}`);
console.error(
  `barrier_trace_other_writer_count=${records.length - expectedWriterRecords.length - clientWriterRecords.length}`,
);
console.error(`barrier_trace_schema_record_count=${schemaRecords.length}`);
console.error(
  `barrier_trace_count_matches_f012=${records.length === f012Count}`,
);

let reason;
if (records.length !== f012Count) {
  reason = "count_changed_after_f012_snapshot";
} else if (records.length !== 1) {
  reason = "chat_params_record_count_not_one";
} else if (expectedWriterRecords.length !== 1) {
  reason = "unexpected_probe_revision_or_process_role";
} else if (schemaRecords.length !== 1) {
  reason = "f014_boolean_schema_missing_or_non_boolean";
} else {
  reason = "valid";
}
console.error(`barrier_trace_diagnostic_reason=${reason}`);

if (reason !== "valid") {
  console.error("barrier_trace_diagnostic_valid=false");
} else {
  const state = schemaRecords[0];
  for (const [key, label] of fields) {
    console.error(`${label}=${state[key]}`);
  }
  console.error("barrier_trace_diagnostic_valid=true");
}
BARRIER_DIAGNOSTIC

  echo "Raw A stderr and overlap trace remain scratch-only and MUST NOT be copied into the report or repository." >&2
  exit 1
}

for _ in $(seq 1 150); do
  if [ -f "$BARRIER_DIR/a-chat-blocked" ]; then break; fi
  if ! kill -0 "$A_PID" 2>/dev/null; then
    classify_a_pre_barrier_failure
  fi
  sleep 0.1
done
if [ ! -f "$BARRIER_DIR/a-chat-blocked" ]; then
  echo "OVERLAP_A_BARRIER_TIMEOUT" >&2
  exit 1
fi
test "$(cat "$BARRIER_DIR/a-chat-blocked")" = "$SESSION_ID"

set +e
(
  cd "$WORKSPACE"
  HOME="$PROBE_HOME" \
  XDG_CONFIG_HOME="$PROBE_XDG_CONFIG" \
  JUSTICE_ROUTING_TRACE="$TRACE" \
  JUSTICE_ROUTING_BARRIER=1 \
  JUSTICE_ROUTING_BARRIER_DIR="$BARRIER_DIR" \
  JUSTICE_ROUTING_PROBE_ROLE=client \
    "$OPENCODE_BIN" run \
      --attach "$BASE_URL" \
      --dir "$WORKSPACE" \
      --session "$SESSION_ID" \
      --format json \
      --model "$JUSTICE_HOST_TEST_MODEL" \
      --command justice-implement-subagent-driven-development \
      >/dev/null 2>"$B_STDERR"
) &
B_PID=$!

wait "$A_PID"; A_CODE=$?
A_PID=
wait "$B_PID"; B_CODE=$?
B_PID=
set -e

printf "%s\t%s\n" justice-implement-writing-plans "$A_CODE" >> "$STATUS"
printf "%s\t%s\n" justice-implement-subagent-driven-development "$B_CODE" >> "$STATUS"

test "$(wc -l < "$STATUS" | tr -d " ")" = "2"

curl -fsS -X POST \
  -H "x-opencode-directory: $WORKSPACE" \
  "$BASE_URL/instance/dispose" \
  >/dev/null

for _ in $(seq 1 200); do
  if grep -F "\"hook\":\"probe.dispose_flushed\"" "$TRACE" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "OpenCode overlap server exited before dispose flush" >&2
    exit 1
  fi
  sleep 0.05
done

grep -F "\"hook\":\"probe.dispose_started\"" "$TRACE" >/dev/null
grep -F "\"hook\":\"probe.dispose_flushed\"" "$TRACE" >/dev/null

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=
trap - EXIT
'
```

Required observed ordering for the barrier proof is:

```text
A command.execute.before
A chat.params (probe records it, then blocks that hook)
B command.execute.before (same server process + same session; releases A)
A finalized assistant message.updated
```

The full A/B command completion/message chains may contain additional assistant updates, but PASS requires a unique
completed chain for each command and distinct A/B user and assistant identities.

If A exits before the deterministic barrier, Step 4 is a **harness failure**, not a runtime capability BLOCKED result. Raw server/A/B stderr MUST remain scratch-only under `SPIKE_ROOT` and MUST NOT be copied into the repository or report. Emit only sanitized fields `a_exit_code`, `failure_stage`, `a_command_start_count`, `chat_params_count`, and `a_stderr_present`. `failure_stage` is exactly one of `before_command_execute_before`, `after_command_execute_before_before_chat_params`, or `after_chat_params_before_barrier_file`. If A remains alive past the barrier deadline, emit `OVERLAP_A_BARRIER_TIMEOUT` and stop as a harness failure. These diagnostics are not capability evidence and MUST NOT unlock Step 5. For an A pre-barrier exit,
the probe MUST co-locate the boolean barrier predicate snapshot in the same allowlisted `chat.params` trace record
that establishes `chat_params_count`; do not use a second sidecar write as diagnostic authority. The additional
trace keys are exactly `barrierEnabled`, `barrierDirSet`, `commandASeen`, `overlapSessionSet`,
`sessionMatchesOverlap`, `aChatBlocked`, and `releasePromiseSet`, all boolean. The harness may emit only
`barrier_enabled`, `barrier_dir_set`, `command_a_seen`, `overlap_session_set`, `session_matches_overlap`,
`a_chat_blocked`, `release_promise_set`, `barrier_trace_record_count`, `barrier_trace_schema_record_count`,
`barrier_trace_count_matches_f012`, `barrier_trace_expected_writer_count`,
`barrier_trace_client_writer_count`, `barrier_trace_other_writer_count`,
`barrier_trace_diagnostic_reason`, and `barrier_trace_diagnostic_valid`; it MUST NOT emit either session identifier,
raw hook input, prompt/message content, raw trace content, filesystem paths, or process identifiers.
Every probe-generated trace record is stamped with the fixed `probeRevision=jus-p0-01-f016` and a sanitized
`processRole` in `local|server|client`. Step 3 runs with role `local`; the Step 4 serve process runs with role
`server`; attached A/B clients run with role `client`. Step 3 and Step 4 MUST also set scratch-only `HOME` and
`XDG_CONFIG_HOME` under `SPIKE_ROOT` so global OpenCode config/plugin directories cannot contribute external
plugins to the probe. `barrier_trace_diagnostic_reason` is exactly one of
`count_changed_after_f012_snapshot`, `chat_params_record_count_not_one`,
`unexpected_probe_revision_or_process_role`, `f014_boolean_schema_missing_or_non_boolean`, or `valid`.
`barrier_trace_diagnostic_valid=true` requires reason `valid`, exactly one pre-B `chat.params` record, and all seven
boolean keys. `barrier_trace_record_count` is the count observed by the diagnostic reader;
`barrier_trace_schema_record_count` is the subset whose seven F-014 diagnostic keys are all boolean;
`barrier_trace_count_matches_f012` compares the diagnostic-time count with the earlier F-012 `chat_params_count`.
These diagnostics distinguish a trace-count race from a missing/non-boolean F-014 schema without exposing raw
trace content. They are not runtime capability evidence. If the host collapses the two
commands onto one assistant identity, omits B's own chain, or cannot process B while A is blocked, the candidate
correlation contract is not proven and the result is `BLOCKED`.

The overlap trace becomes authoritative only after `POST /instance/dispose` produces
`probe.dispose_flushed`. `kill "$SERVER_PID"` is process cleanup only; it is never a plugin-finalizer or trace-flush
authority.


- [ ] **Step 5: Run deterministic awaited-hook failure + successful-B probe**

This probe validates the no-`command.executed` path itself. Failure injection MUST occur in the awaited
`command.execute.before` named hook, which `SessionPrompt.command()` invokes before `prompt()`. The detached generic
`event` callback is observation-only. Do not inject from `event`, `message.updated`, or `chat.params`.

A is `justice-implement-writing-plans`; B is `justice-implement-subagent-driven-development`. A writes its
`command.execute.before` trace and a barrier file, waits until B's `command.execute.before` is observed in the same
server process/session, writes `probe.failure_injected`, then throws. B releases A and returns normally from its
named hook.

Run:

```bash
devcontainer exec --workspace-folder . bash -lc '
set -euo pipefail
SPIKE_ROOT=/tmp/justice-controller-routing-spike
OPENCODE_BIN="$SPIKE_ROOT/opencode-cli/node_modules/.bin/opencode"
test -x "$OPENCODE_BIN"
test "$("$OPENCODE_BIN" --version)" = "1.18.29"

FAIL_WORKSPACE="$SPIKE_ROOT/failure-workspace"
FAIL_TRACE="$SPIKE_ROOT/failure.trace.jsonl"
FAIL_STATUS="$SPIKE_ROOT/failure-status.tsv"
FAIL_RESULT="$SPIKE_ROOT/failure-result.txt"
FAIL_BARRIER="$SPIKE_ROOT/failure-barrier"
SESSION_FILE="$SPIKE_ROOT/failure-session.txt"
PORT=40968
BASE_URL="http://127.0.0.1:$PORT"

rm -rf "$FAIL_WORKSPACE" "$FAIL_BARRIER"
mkdir -p "$FAIL_WORKSPACE/.opencode/plugins" "$FAIL_BARRIER"
: > "$FAIL_TRACE"
: > "$FAIL_STATUS"
: > "$FAIL_RESULT"

cp "$SPIKE_ROOT/workspace/opencode.json" "$FAIL_WORKSPACE/opencode.json"

cat > "$FAIL_WORKSPACE/.opencode/plugins/controller-routing-failure-probe.js" <<'"'"'FAIL_PROBE'"'"'
import { appendFile, writeFile } from "node:fs/promises";

const tracePath = process.env.JUSTICE_ROUTING_FAILURE_TRACE;
const barrierDir = process.env.JUSTICE_ROUTING_FAILURE_BARRIER_DIR;
if (!tracePath || !barrierDir) throw new Error("failure probe env missing");

const A = "justice-implement-writing-plans";
const B = "justice-implement-subagent-driven-development";
const ALLOWED_KEYS = new Set([
  "hook",
  "command",
  "sessionID",
  "assistantMessageID",
  "parentMessageID",
  "completedPresent",
  "status",
]);

let writeChain = Promise.resolve();
let sessionID;
let releaseA;
let releasePromise;
let closing = false;

function append(record) {
  const clean = Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
  for (const key of Object.keys(clean)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`forbidden failure trace key: ${key}`);
  }
  writeChain = writeChain.then(() =>
    appendFile(tracePath, `${JSON.stringify(clean)}\n`, "utf8"),
  );
  return writeChain;
}

function armBarrier(id) {
  sessionID = id;
  releasePromise = new Promise((resolve) => {
    releaseA = resolve;
  });
}

async function waitForB() {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("failure overlap barrier timeout")), 15000);
  });
  try {
    await Promise.race([releasePromise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const ControllerRoutingFailureProbe = async () => ({
  "command.execute.before": async (input) => {
    await append({
      hook: "command.execute.before",
      command: input.command,
      sessionID: input.sessionID,
    });

    if (input.command === A && sessionID === undefined) {
      armBarrier(input.sessionID);
      await writeFile(`${barrierDir}/a-command-blocked`, input.sessionID, "utf8");
      await waitForB();
      await append({
        hook: "probe.failure_injected",
        command: A,
        sessionID: input.sessionID,
      });
      throw new Error("ROUTING_PROBE_FORCED_POST_ARM_FAILURE");
    }

    if (input.command === B && input.sessionID === sessionID) {
      releaseA?.();
    }
  },

  event: async ({ event }) => {
    if (closing) return;

    if (event?.type === "session.status") {
      const p = event.properties;
      await append({
        hook: "session.status",
        sessionID: typeof p?.sessionID === "string" ? p.sessionID : undefined,
        status: typeof p?.status?.type === "string" ? p.status.type : undefined,
      });
      return;
    }

    if (event?.type === "session.idle") {
      await append({
        hook: "session.idle",
        sessionID:
          typeof event.properties?.sessionID === "string"
            ? event.properties.sessionID
            : undefined,
      });
      return;
    }

    if (event?.type === "session.error") {
      await append({
        hook: "session.error",
        sessionID:
          typeof event.properties?.sessionID === "string"
            ? event.properties.sessionID
            : undefined,
      });
      return;
    }

    if (event?.type === "message.updated") {
      const info = event.properties?.info;
      if (info?.role !== "assistant" || typeof info.sessionID !== "string") return;
      await append({
        hook: "message.updated",
        sessionID: info.sessionID,
        assistantMessageID: typeof info.id === "string" ? info.id : undefined,
        parentMessageID: typeof info.parentID === "string" ? info.parentID : undefined,
        completedPresent: info.time?.completed !== undefined,
      });
      return;
    }

    if (event?.type === "command.executed") {
      const p = event.properties;
      await append({
        hook: "command.executed",
        command: typeof p?.name === "string" ? p.name : undefined,
        sessionID: typeof p?.sessionID === "string" ? p.sessionID : undefined,
        assistantMessageID: typeof p?.messageID === "string" ? p.messageID : undefined,
      });
    }
  },

  dispose: async () => {
    closing = true;
    await writeChain;
    await appendFile(tracePath, `${JSON.stringify({ hook: "probe.dispose_started" })}\n`, "utf8");
    await appendFile(tracePath, `${JSON.stringify({ hook: "probe.dispose_flushed" })}\n`, "utf8");
  },
});
FAIL_PROBE

cat > "$SPIKE_ROOT/validate-failure-lifecycle.mjs" <<'"'"'FAIL_VALIDATE'"'"'
import { readFile, writeFile } from "node:fs/promises";

const [tracePath, statusPath, resultPath] = process.argv.slice(2);
if (!tracePath || !statusPath || !resultPath) {
  throw new Error("usage: validate-failure-lifecycle.mjs TRACE STATUS RESULT");
}

const A = "justice-implement-writing-plans";
const B = "justice-implement-subagent-driven-development";

const allowedKeys = new Set([
  "hook",
  "command",
  "sessionID",
  "assistantMessageID",
  "parentMessageID",
  "completedPresent",
  "status",
]);

const allowedHooks = new Set([
  "command.execute.before",
  "message.updated",
  "command.executed",
  "session.status",
  "session.idle",
  "session.error",
  "probe.failure_injected",
  "probe.dispose_started",
  "probe.dispose_flushed",
]);

const failures = [];
const records = [];

for (const [index, line] of (await readFile(tracePath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .entries()) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    failures.push(`trace_json_invalid:${index + 1}`);
    continue;
  }

  const forbidden = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (forbidden.length) failures.push(`forbidden_keys:${index + 1}`);
  if (!allowedHooks.has(record.hook)) failures.push(`invalid_hook:${index + 1}`);

  records.push({ ...record, __index: index });
}

const status = new Map();
for (const line of (await readFile(statusPath, "utf8")).split(/\r?\n/).filter(Boolean)) {
  const [command, raw, extra] = line.split("\t");
  if (extra !== undefined || ![A, B].includes(command) || !/^\d+$/.test(raw ?? "")) {
    failures.push("status_invalid");
    continue;
  }
  status.set(command, Number(raw));
}

if (!status.has(A) || status.get(A) === 0) failures.push("A_did_not_fail");
if (!status.has(B) || status.get(B) !== 0) failures.push("B_did_not_succeed");

const aStarts = records.filter(
  (r) => r.hook === "command.execute.before" && r.command === A,
);
const bStarts = records.filter(
  (r) => r.hook === "command.execute.before" && r.command === B,
);

if (aStarts.length !== 1) failures.push(`A_command_start_count:${aStarts.length}`);
if (bStarts.length !== 1) failures.push(`B_command_start_count:${bStarts.length}`);

const aStart = aStarts.length === 1 ? aStarts[0] : undefined;
const bStart = bStarts.length === 1 ? bStarts[0] : undefined;

const targetSessionID =
  aStart &&
  bStart &&
  typeof aStart.sessionID === "string" &&
  aStart.sessionID.length > 0 &&
  aStart.sessionID === bStart.sessionID
    ? aStart.sessionID
    : undefined;

if (!targetSessionID) failures.push("target_session_not_exact");

const injectedCandidates = targetSessionID
  ? records.filter(
      (r) =>
        r.hook === "probe.failure_injected" &&
        r.command === A &&
        r.sessionID === targetSessionID,
    )
  : [];
if (injectedCandidates.length !== 1) {
  failures.push(`A_failure_injection_count:${injectedCandidates.length}`);
}
const injected = injectedCandidates.length === 1 ? injectedCandidates[0] : undefined;

const aExecuted = targetSessionID
  ? records.filter(
      (r) =>
        r.hook === "command.executed" &&
        r.command === A &&
        r.sessionID === targetSessionID,
    )
  : [];
const bExecuted = targetSessionID
  ? records.filter(
      (r) =>
        r.hook === "command.executed" &&
        r.command === B &&
        r.sessionID === targetSessionID,
    )
  : [];

if (injected && bStart && !(bStart.__index < injected.__index)) {
  failures.push("A_failed_before_B_was_armed");
}
if (injected && injected.sessionID !== targetSessionID) {
  failures.push("A_failure_injection_session_mismatch");
}
if (aExecuted.length !== 0) failures.push("A_unexpected_command_executed");
if (bExecuted.length !== 1) failures.push(`B_command_executed_count:${bExecuted.length}`);

let bDone;
let bFinal;

if (bExecuted.length === 1 && targetSessionID) {
  bDone = bExecuted[0];
  if (bDone.sessionID !== targetSessionID) {
    failures.push("B_completion_session_mismatch");
  }

  const bFinalCandidates = records.filter(
    (r) =>
      r.hook === "message.updated" &&
      r.sessionID === targetSessionID &&
      r.assistantMessageID === bDone.assistantMessageID &&
      r.completedPresent === true,
  );

  if (bFinalCandidates.length !== 1) {
    failures.push(`B_finalized_identity_count:${bFinalCandidates.length}`);
  }
  bFinal = bFinalCandidates.length === 1 ? bFinalCandidates[0] : undefined;

  if (!bDone.assistantMessageID) failures.push("B_completion_messageID_missing");
  if (bFinal && bFinal.sessionID !== targetSessionID) {
    failures.push("B_finalized_session_mismatch");
  }
}

const disposeStarted = records.filter((r) => r.hook === "probe.dispose_started");
const disposeFlushed = records.filter((r) => r.hook === "probe.dispose_flushed");

if (disposeStarted.length !== 1) failures.push(`dispose_started_count:${disposeStarted.length}`);
if (disposeFlushed.length !== 1) failures.push(`dispose_flushed_count:${disposeFlushed.length}`);
if (
  disposeStarted.length === 1 &&
  disposeFlushed.length === 1 &&
  !(disposeStarted[0].__index < disposeFlushed[0].__index)
) {
  failures.push("dispose_marker_order");
}

const evidenceCutoff =
  disposeStarted.length === 1 ? disposeStarted[0].__index : Number.POSITIVE_INFINITY;

const lifecycle = targetSessionID
  ? records.filter(
      (r) =>
        r.__index < evidenceCutoff &&
        r.sessionID === targetSessionID &&
        (
          r.hook === "session.error" ||
          r.hook === "session.idle" ||
          (r.hook === "session.status" && r.status === "idle")
        ),
    )
  : [];

let safeCandidate;
let unsafeEarly = false;

if (bDone && bFinal && injected && targetSessionID) {
  const safeAfter = Math.max(
    injected.__index,
    bDone.__index,
    bFinal.__index,
  );

  for (const event of lifecycle) {
    if (event.__index <= safeAfter) {
      unsafeEarly = true;
      continue;
    }

    // session.error is same-session evidence only. It never establishes quiescence.
    if (
      event.hook === "session.idle" ||
      (event.hook === "session.status" && event.status === "idle")
    ) {
      if (event.sessionID !== targetSessionID) {
        failures.push("safe_candidate_session_mismatch");
        continue;
      }
      safeCandidate = event;
      break;
    }
  }
}

if (!safeCandidate) {
  failures.push("no_safe_same_session_post_failure_and_B_quiescence_boundary");
}

const result = failures.length === 0 ? "PASS" : "BLOCKED";
const cleanupHook = safeCandidate?.hook ?? "none";
const cleanupStatus =
  safeCandidate?.hook === "session.status" ? (safeCandidate.status ?? "none") : "none";

const output = [
  `JUS-P0-01 abandonment observation = ${result}`,
  "failure_injection_hook=command.execute.before",
  `a_command_executed=${aExecuted.length === 0 ? "no" : "yes"}`,
  `b_command_executed=${bExecuted.length === 1 ? "yes" : "no"}`,
  `b_finalized_identity=${bFinal ? "yes" : "no"}`,
  `unsafe_early_lifecycle_observed=${unsafeEarly ? "true" : "false"}`,
  `cleanup_scope=${safeCandidate ? "session" : "none"}`,
  `cleanup_session=${safeCandidate ? "target_probe_session" : "none"}`,
  `cleanup_hook=${cleanupHook}`,
  `cleanup_status=${cleanupStatus}`,
  `cleanup_order=${safeCandidate ? "after_a_failure_injected_and_b_finalized_and_command_executed" : "none"}`,
  `preserves_concurrent_invocation=${safeCandidate ? "true" : "false"}`,
  `suppression_clear_authority=${safeCandidate ? "same_verified_boundary" : "removeSession_only"}`,
  "trace_flush=explicit_instance_dispose_then_probe.dispose_flushed",
  ...failures.map((failure) => `failure=${failure}`),
  "",
];

await writeFile(resultPath, output.join("\n"), "utf8");
console.log(output[0]);
process.exit(result === "PASS" ? 0 : 1);
FAIL_VALIDATE

node --check "$FAIL_WORKSPACE/.opencode/plugins/controller-routing-failure-probe.js"
node --check "$SPIKE_ROOT/validate-failure-lifecycle.mjs"

SERVER_PID=
A_PID=
B_PID=

cleanup() {
  code=$?
  for pid in "${A_PID:-}" "${B_PID:-}" "${SERVER_PID:-}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  exit "$code"
}
trap cleanup EXIT

(
  cd "$FAIL_WORKSPACE"
  JUSTICE_ROUTING_FAILURE_TRACE="$FAIL_TRACE" \
  JUSTICE_ROUTING_FAILURE_BARRIER_DIR="$FAIL_BARRIER" \
    "$OPENCODE_BIN" serve --hostname 127.0.0.1 --port "$PORT" >/dev/null 2>/dev/null
) &
SERVER_PID=$!

for _ in $(seq 1 100); do
  if curl -fsS "$BASE_URL/global/health" >/dev/null 2>/dev/null; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then exit 1; fi
  sleep 0.1
done
curl -fsS "$BASE_URL/global/health" >/dev/null

bun "$SPIKE_ROOT/create-session.mjs" "$BASE_URL" "$FAIL_WORKSPACE" "$SESSION_FILE"
SESSION_ID="$(cat "$SESSION_FILE")"
test -n "$SESSION_ID"

set +e
(
  cd "$FAIL_WORKSPACE"
  "$OPENCODE_BIN" run \
    --attach "$BASE_URL" \
    --dir "$FAIL_WORKSPACE" \
    --session "$SESSION_ID" \
    --format json \
    --model "$JUSTICE_HOST_TEST_MODEL" \
    --command justice-implement-writing-plans \
    >/dev/null 2>/dev/null
) &
A_PID=$!
set -e

for _ in $(seq 1 150); do
  if [ -f "$FAIL_BARRIER/a-command-blocked" ]; then break; fi
  if ! kill -0 "$A_PID" 2>/dev/null; then exit 1; fi
  sleep 0.1
done
test -f "$FAIL_BARRIER/a-command-blocked"

set +e
(
  cd "$FAIL_WORKSPACE"
  "$OPENCODE_BIN" run \
    --attach "$BASE_URL" \
    --dir "$FAIL_WORKSPACE" \
    --session "$SESSION_ID" \
    --format json \
    --model "$JUSTICE_HOST_TEST_MODEL" \
    --command justice-implement-subagent-driven-development \
    >/dev/null 2>/dev/null
) &
B_PID=$!

wait "$A_PID"; A_CODE=$?
A_PID=
wait "$B_PID"; B_CODE=$?
B_PID=
set -e

printf "%s\t%s\n" justice-implement-writing-plans "$A_CODE" >> "$FAIL_STATUS"
printf "%s\t%s\n" justice-implement-subagent-driven-development "$B_CODE" >> "$FAIL_STATUS"

test "$A_CODE" -ne 0
test "$B_CODE" -eq 0

curl -fsS -X POST \
  -H "x-opencode-directory: $FAIL_WORKSPACE" \
  "$BASE_URL/instance/dispose" \
  >/dev/null

for _ in $(seq 1 200); do
  if grep -F "\"hook\":\"probe.dispose_flushed\"" "$FAIL_TRACE" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "OpenCode failure server exited before dispose flush" >&2
    exit 1
  fi
  sleep 0.05
done

grep -F "\"hook\":\"probe.dispose_started\"" "$FAIL_TRACE" >/dev/null
grep -F "\"hook\":\"probe.dispose_flushed\"" "$FAIL_TRACE" >/dev/null

set +e
bun "$SPIKE_ROOT/validate-failure-lifecycle.mjs" \
  "$FAIL_TRACE" "$FAIL_STATUS" "$FAIL_RESULT"
FAILURE_CODE=$?
set -e

test -s "$FAIL_RESULT"
ABANDONMENT_RESULT="$(head -n 1 "$FAIL_RESULT")"

for required in \
  failure_injection_hook= \
  a_command_executed= \
  b_command_executed= \
  b_finalized_identity= \
  unsafe_early_lifecycle_observed= \
  cleanup_scope= \
  cleanup_session= \
  cleanup_hook= \
  cleanup_status= \
  cleanup_order= \
  preserves_concurrent_invocation= \
  suppression_clear_authority= \
  trace_flush=
do
  test "$(grep -Ec "^${required}" "$FAIL_RESULT")" = "1"
done

case "$ABANDONMENT_RESULT" in
  "JUS-P0-01 abandonment observation = PASS")
    test "$FAILURE_CODE" -eq 0
    test "$(grep -Ec "^failure=" "$FAIL_RESULT")" = "0"
    ;;
  "JUS-P0-01 abandonment observation = BLOCKED")
    test "$FAILURE_CODE" -eq 1
    grep -Eq "^failure=" "$FAIL_RESULT"
    ;;
  *)
    echo "ERROR: invalid abandonment result header" >&2
    exit 1
    ;;
esac

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=

trap - EXIT
exit 0
'
```

Expected shell outcome:

```text
well-formed abandonment PASS + validator exit 0
  → Step 5 shell exit 0
well-formed abandonment BLOCKED + validator exit 1
  → Step 5 shell exit 0
missing/malformed result, PASS/exit mismatch, BLOCKED/exit mismatch, unexpected validator exit, or harness failure
  → Step 5 shell non-zero
```

`failure-result.txt` is the Step 5 capability artifact; the Step 5 shell exit is only harness status. A valid
BLOCKED result MUST continue to Step 6 unchanged. The wrapper does not erase the validator's original exit `1`;
it requires exact `BLOCKED` ↔ exit `1` correspondence before normalizing the enclosing step to successful execution.

The validator MUST distinguish **observed lifecycle evidence** from **safe cleanup authority**. It derives one
non-empty `targetSessionID` from the unique A/B `command.execute.before` records and requires A failure injection,
B command completion, B finalized assistant identity, and every lifecycle candidate to belong to that same session.
A same-session `session.status idle`, `session.idle`, or `session.error` that occurs before A
`probe.failure_injected`, B's matching finalized assistant, or B's exact `command.executed` is retained as
`unsafe_early_lifecycle_observed=true` but cannot make the probe PASS. Unrelated-session lifecycle events are not
candidates. `session.error` alone is never session-quiescence authority.

`probe.dispose_started` is the evidence cutoff, not a lifecycle candidate. `dispose()` sets `closing = true`, drains
the already-chained detached-event writes, writes `probe.dispose_started`, then writes `probe.dispose_flushed`.
Lifecycle events at or after that cutoff are excluded, so forced disposal cannot manufacture a false safe boundary.

PASS requires all of:

```text
A exits non-zero
A command.execute.before and probe.failure_injected observed
B command.execute.before observed before A injection in the same session
A command.executed absent
B exits zero
B finalized assistant identity matches B command.executed.messageID in the target session
target sessionID is a non-empty exact A/B session identity
A probe.failure_injected belongs to the target session
B command.executed belongs to the target session
one same-session session.status(idle) or session.idle occurs only after A failure injection, B finalized identity, and B command.executed
cleanup_scope/session + cleanup_session/target_probe_session + hook/value/order are written explicitly
preserves_concurrent_invocation=true
probe.dispose_started and probe.dispose_flushed each occur exactly once
all lifecycle evidence used for cleanup classification occurs before probe.dispose_started
```

If no same-session quiescence signal exists after A failure injection plus B finalized identity and B
`command.executed`, the lifecycle capability result is `BLOCKED`. Do not weaken the validator, treat unrelated-
session or early idle/error as cleanup authority, or invent a Justice-local invocation token.


- [ ] **Step 6: Validate correlation traces, abandonment result, and write the bounded report**

Run:

```bash
devcontainer exec --workspace-folder . bash -lc '
set -euo pipefail
SPIKE_ROOT=/tmp/justice-controller-routing-spike
REPORT=/workspace/docs/spikes/2026-09-controller-routing-runtime-signals.md

mkdir -p "$(dirname "$REPORT")"

set +e
bun "$SPIKE_ROOT/validate-and-report.mjs" \
  "$SPIKE_ROOT/nominal.trace.jsonl" \
  "$SPIKE_ROOT/nominal-status.tsv" \
  "$SPIKE_ROOT/overlap.trace.jsonl" \
  "$SPIKE_ROOT/overlap-status.tsv" \
  "$REPORT"
correlation_code=$?
set -e

test -s "$REPORT"
test "$(grep -Fxc "## Result" "$REPORT")" = "1"
test "$(grep -Ec "^JUS-P0-01 runtime observation = (PASS|BLOCKED)$" "$REPORT")" = "1"

CORRELATION_RESULT_LINE_NUMBER="$(
  grep -nFx "## Result" "$REPORT" |
    cut -d: -f1
)"
test -n "$CORRELATION_RESULT_LINE_NUMBER"

CORRELATION_RESULT="$(
  sed -n "$((CORRELATION_RESULT_LINE_NUMBER + 1))p" "$REPORT"
)"

case "$CORRELATION_RESULT" in
  "JUS-P0-01 runtime observation = PASS")
    test "$correlation_code" -eq 0
    ;;
  "JUS-P0-01 runtime observation = BLOCKED")
    test "$correlation_code" -eq 1
    ;;
  *)
    echo "ERROR: invalid provisional correlation result" >&2
    exit 1
    ;;
esac

test -s "$SPIKE_ROOT/failure-result.txt"

abandonment_line="$(head -n 1 "$SPIKE_ROOT/failure-result.txt")"

case "$abandonment_line" in
  "JUS-P0-01 abandonment observation = PASS"|"JUS-P0-01 abandonment observation = BLOCKED") ;;
  *) echo "ERROR: invalid abandonment result header" >&2; exit 1 ;;
esac

for required in   failure_injection_hook=   a_command_executed=   b_command_executed=   b_finalized_identity=   unsafe_early_lifecycle_observed=   cleanup_scope=   cleanup_session=   cleanup_hook=   cleanup_status=   cleanup_order=   preserves_concurrent_invocation=   suppression_clear_authority=   trace_flush=
do
  grep -E "^${required}" "$SPIKE_ROOT/failure-result.txt" >/dev/null
done

printf "\n## Failure / abandonment capability\n\n" >> "$REPORT"
sed 's/^/- /' "$SPIKE_ROOT/failure-result.txt" >> "$REPORT"

validation_code=0
if [ "$CORRELATION_RESULT" = "JUS-P0-01 runtime observation = BLOCKED" ] || \
   [ "$abandonment_line" = "JUS-P0-01 abandonment observation = BLOCKED" ]; then
  validation_code=1
  sed -i \
    's/^JUS-P0-01 runtime observation = PASS$/JUS-P0-01 runtime observation = BLOCKED/' \
    "$REPORT"
fi

test "$(grep -Fxc "## Result" "$REPORT")" = "1"
test "$(grep -Ec "^JUS-P0-01 runtime observation = (PASS|BLOCKED)$" "$REPORT")" = "1"

RESULT_LINE_NUMBER="$(
  grep -nFx "## Result" "$REPORT" |
    cut -d: -f1
)"
test -n "$RESULT_LINE_NUMBER"

FINAL_RESULT="$(
  sed -n "$((RESULT_LINE_NUMBER + 1))p" "$REPORT"
)"

case "$FINAL_RESULT" in
  "JUS-P0-01 runtime observation = PASS"|"JUS-P0-01 runtime observation = BLOCKED") ;;
  *) echo "ERROR: invalid final ## Result line: $FINAL_RESULT" >&2; exit 1 ;;
esac

if [ "$validation_code" -ne 0 ]; then
  test "$FINAL_RESULT" = "JUS-P0-01 runtime observation = BLOCKED"
else
  test "$FINAL_RESULT" = "JUS-P0-01 runtime observation = PASS"
fi

grep -Fx "## Verified candidate contract" "$REPORT"
grep -Fx "## Nominal four-command chains" "$REPORT"
grep -Fx "## Same-session overlap" "$REPORT"
grep -Fx "## Sanitized failures" "$REPORT"
grep -Fx "## Failure / abandonment capability" "$REPORT"

git diff --check -- docs/spikes/2026-09-controller-routing-runtime-signals.md

rm -rf "$SPIKE_ROOT"
test ! -e "$SPIKE_ROOT"

exit 0
'
```

A well-formed final report is a successful execution of Step 6 whether its unique `## Result` is PASS or BLOCKED.
`validation_code` is internal capability-combination state used to verify and, when required, rewrite the final
result; it is not the shell harness status. Only report construction/validation/I/O or other harness failures make
Step 6 exit non-zero. Therefore a valid BLOCKED report proceeds to Step 7 after scratch cleanup.

The validator is the redaction/identity proof. `git diff --check` is formatting verification only. The exact line
immediately following the unique `## Result` heading after Step 6 finishes is the sole overall Task 4.0 status
authority. `## Failure / abandonment capability` is supporting evidence and MUST NOT be treated as a second overall
status authority.

PASS requires all of the following:

```text
four exact nominal pinned commands each have:
  command.execute.before
  → exact same-session command.executed
  → command.executed.assistantMessageID
  → exact finalized assistant message with that ID
  → assistant.parentMessageID
  → exact chat.params.userMessageID
  → expected raw agent

overlap:
  A and B use one host process and one session
  A/B command starts are both observed
  barrier ordering is observed
  A/B userMessageID values are distinct
  A/B assistantMessageID values are distinct
  each command completion joins only its own finalized assistant
  each finalized assistant joins only its own parent user chat
  no controller cross-join is possible
```

PASS additionally requires `JUS-P0-01 abandonment observation = PASS` and the complete sanitized lifecycle
contract above. The report must retain the exact `cleanup_scope`, `cleanup_session`, `cleanup_hook`,
`cleanup_status`, `cleanup_order`, `preserves_concurrent_invocation`, `suppression_clear_authority`, and
`trace_flush` values. Any failure is `BLOCKED`; do not weaken
either validator, parse content/error payloads, infer workflow from controller, or substitute latest/current event
heuristics. The report is capability evidence only and is not itself permission to implement cleanup.

- [ ] **Step 7: Record capability outcome and stop before source implementation**

Task 4.0 never directly unlocks Task 4.1/4.2. After Step 1 has succeeded and Steps 2-6 have completed without a
harness failure, Step 7 is the **only capability branch point**. It branches only on the final post-Step-6 unique
`## Result` exact line; Step 5/6 shell exit status MUST NOT be used as a second PASS/BLOCKED authority.

If the final post-Step-6 `## Result` exact line is:

```text
JUS-P0-01 runtime observation = PASS
```

then:

1. stop before Task 4.1;
2. commit only the sanitized spike report after its normal review;
3. copy the exact lifecycle contract, including target-session binding and cleanup order, from the report into Design §4.1;
4. update Task 4.2 with exactly one matching cleanup scope/API/session/hook/value/order contract and concrete RED tests;
5. define suppression-clear authority from the same verified boundary;
6. commit that Design/Plan change separately and run document review again;
7. only the reviewed exact contract may unlock Task 4.1/4.2.

If the final post-Step-6 `## Result` exact line is:

```text
JUS-P0-01 runtime observation = BLOCKED
```

then:

1. stop before Task 4.1;
2. retain fixed resource bounds and `removeSession()` cleanup only;
3. update Design/Plan with the observed limitation or a newly justified capability strategy;
4. run document review again;
5. do not implement source/tests.

No implementation agent may choose between session-wide and invocation-specific cleanup.

After the spike report itself has been reviewed and approved for commit:

```bash
GIT_MASTER=1 git add docs/spikes/2026-09-controller-routing-runtime-signals.md
GIT_MASTER=1 git commit -m "docs: verify controller routing failure lifecycle"
```

### Task 4.1: Preserve workflow identity and define the verified invocation contract

**Requirement:** JUS-P0-01, INV-01, Design §4.1.

**Precondition:** the final post-Step-6 `## Result` exact line is
`JUS-P0-01 runtime observation = PASS` **and** a subsequent document-only amendment has copied the exact sanitized
lifecycle contract into Design §4.1 / Task 4.2 and passed document review. The current pre-spike Design
does not authorize a production abandonment API. Do not edit source until that reviewed amendment exists.

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/routing-decision.ts`
- Create: `src/core/controller-routing.ts`
- Test: `tests/core/routing-decision.test.ts`
- Test: `tests/core/controller-routing.test.ts`

**Consumes:** `WorkflowRouter.resolveController(workflow)`; `ControllerAgent`.

**Produces:**

```ts
export type ControllerWorkflow =
  | "brainstorming"
  | "writing-plans"
  | "subagent-driven-development"
  | "executing-plans";

export type ControllerPinnedCommand =
  | "justice-implement-brainstorming"
  | "justice-implement-writing-plans"
  | "justice-implement-subagent-driven-development"
  | "justice-implement-executing-plans";

export const PINNED_COMMAND_WORKFLOW_MAP: Readonly<Record<
  ControllerPinnedCommand,
  ControllerWorkflow
>>;

export function resolvePinnedCommandWorkflow(
  command: string,
): ControllerWorkflow | undefined;

export type ControllerObservedAgentId = string;

export type ControllerActualObservation =
  | {
      readonly source: "chat.params";
      readonly sessionId: string;
      readonly userMessageId: string;
      readonly actualController: ControllerObservedAgentId;
    }
  | {
      readonly source: "message.updated";
      readonly sessionId: string;
      readonly assistantMessageId: string;
      readonly parentUserMessageId: string;
      readonly actualController: ControllerObservedAgentId;
      readonly finalized: boolean;
    };

export type ControllerCommandCompletion = {
  readonly sessionId: string;
  readonly command: ControllerPinnedCommand;
  readonly assistantMessageId: string;
};

export type ControllerRoutingInvocationContext = {
  readonly sessionId: string;
  readonly command: ControllerPinnedCommand;
  readonly workflow: ControllerWorkflow;
  readonly applicationMethod: "pinned-command";
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly chatParamsActualController?: ControllerObservedAgentId;
  readonly finalizedMessageActualController: ControllerObservedAgentId;
};

export type ControllerRoutingEvaluationInput = {
  readonly decision: ControllerRoutingDecision;
  readonly applicationMethod: ControllerApplicationMethod;
  readonly chatParamsActualController?: ControllerObservedAgentId;
  readonly finalizedMessageActualController?: ControllerObservedAgentId;
  readonly runtimeCapabilitySupported: boolean;
};

export function evaluateControllerRoutingObservation(
  input: ControllerRoutingEvaluationInput,
): ControllerRoutingObservation;
```

There is no `routingGeneration` and no `ControllerRoutingSessionContext`. The invocation context exists only after
host message identities have been joined. `ControllerObservedAgentId` remains separate from the closed
`ObservationAgentId` physical-shard identity.

- [ ] **Step 1: Write the complete failing mapping/evaluator/type-contract tests**

Keep the exact four mappings and leading-slash behavior:

```ts
it.each([
  ["justice-implement-brainstorming", "brainstorming"],
  ["/justice-implement-writing-plans", "writing-plans"],
  ["justice-implement-subagent-driven-development", "subagent-driven-development"],
  ["justice-implement-executing-plans", "executing-plans"],
] as const)("maps pinned command %s to workflow %s", (command, workflow) => {
  expect(resolvePinnedCommandWorkflow(command)).toBe(workflow);
});

it("does not infer workflow from arbitrary command/controller text", () => {
  expect(resolvePinnedCommandWorkflow("please-use-sisyphus")).toBeUndefined();
});
```

Define the evaluator fixtures explicitly:

```ts
const sisyphusDecision = createControllerRoutingDecision(
  "writing-plans",
  "sisyphus",
  "workflow_rule",
);

const appliedInput: ControllerRoutingEvaluationInput = {
  decision: sisyphusDecision,
  applicationMethod: "pinned-command",
  chatParamsActualController: "sisyphus",
  finalizedMessageActualController: "sisyphus",
  runtimeCapabilitySupported: false,
};

const knownMismatchInput = {
  ...appliedInput,
  finalizedMessageActualController: "atlas",
} satisfies ControllerRoutingEvaluationInput;

const customMismatchInput = {
  ...appliedInput,
  finalizedMessageActualController: "custom-controller-v2",
} satisfies ControllerRoutingEvaluationInput;

const chatParamsOnlyInput: ControllerRoutingEvaluationInput = {
  decision: sisyphusDecision,
  applicationMethod: "pinned-command",
  chatParamsActualController: "sisyphus",
  runtimeCapabilitySupported: false,
};

const unconfiguredInput: ControllerRoutingEvaluationInput = {
  decision: sisyphusDecision,
  applicationMethod: "none",
  runtimeCapabilitySupported: false,
};
```

Required assertions:

- finalized matching actual → `applied`, source `both`;
- finalized known/custom mismatch → `mismatch` with raw actual preserved;
- chat-only pure evaluator input → `unapplied/actual_not_observed`;
- explicit `none` → `unapplied/application_not_configured`;
- `brainstorming` and `writing-plans` both choose `sisyphus` but preserve different `workflow`;
- `ControllerActualObservation` source members require their source-specific IDs;
- no test or type treats `sessionId` or a local generation as invocation identity.

- [ ] **Step 2: Confirm RED**

```bash
devcontainer exec --workspace-folder . bun run vitest run \
  tests/core/routing-decision.test.ts \
  tests/core/controller-routing.test.ts
```

Expected: behavioral/type-contract FAIL because the workflow-preserving decision and verified identity types do not
exist. Missing imports, undeclared fixtures, or malformed tests are not acceptable RED evidence.

- [ ] **Step 3: Implement the exact pure-domain contract**

1. Add `workflow` only to the controller routing decision member and update
   `createControllerRoutingDecision(workflow, controller, reason)` plus callers.
2. Define the four-literal workflow/command types, exact map, and exact resolver. Remove at most one leading `/`;
   accept no aliases/fuzzy/prompt/skill/controller reverse matching.
3. Define the source-discriminated `ControllerActualObservation`, `ControllerCommandCompletion`, and
   `ControllerRoutingInvocationContext` exactly as above. Do not introduce a generic message identity abstraction.
4. Keep `ControllerRoutingEvaluationInput` pure. Only a finalized message actual can produce
   `applied`/`mismatch`; preserve custom raw strings.
5. Do not widen `src/core/types.ts::ObservationAgentId`.
6. Do not add session state, host hooks, tracing, or runtime mutation in Task 4.1.

- [ ] **Step 4: Confirm GREEN**

Run the Step 2 command.

Expected: PASS for exact command→workflow identity, same-controller workflow distinction, finalized actual
evaluation, custom raw identity, and source-specific invocation identity types.

- [ ] **Step 5: Commit after approval**

```bash
GIT_MASTER=1 git add src/core/types.ts src/core/routing-decision.ts src/core/controller-routing.ts tests/core/routing-decision.test.ts tests/core/controller-routing.test.ts
GIT_MASTER=1 git commit -m "feat: controller routingにinvocation identityを定義"
```

### Task 4.2: Correlate verified invocations and persist controller-routing audit

**Requirement:** JUS-P0-01, Design §3.2, §3.3, §3.4, §4.1, §5.1, §7.3.

**Precondition:** Task 4.0 is PASS and a subsequent reviewed document-only lifecycle amendment has replaced the
pre-spike cleanup checkpoint with one exact host-verified cleanup scope/API/hook/value/order contract. Until then,
this task is intentionally non-executable; do not infer or invent the missing production cleanup API.

**Files:**

- Modify: `src/core/session-state-provider.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `src/core/v2/observation-model.ts`
- Modify: `src/core/v2/record-builder.ts`
- Modify: `src/runtime/validation.ts`
- Modify: `src/core/v2/persistence-redaction.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/doctor-categories.ts`
- Modify: `src/core/doctor-config.ts`
- Modify: `src/runtime/doctor-cli.ts`
- Modify: `README.md`
- Modify: `SPEC.md`
- Test: `tests/core/session-state-provider.test.ts`
- Test: `tests/core/justice-plugin-routing.test.ts`
- Test: `tests/core/v2/observation-model.test.ts`
- Test: `tests/runtime/validation.test.ts`
- Test: `tests/core/v2/persistence-redaction.test.ts`
- Test: `tests/runtime/observation-log-store.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`
- Test: `tests/core/justice-doctor-config.test.ts`
- Test: `tests/runtime/doctor-cli.test.ts`

**Consumes:** Task 4.0 verified exact identity fields; Task 4.1 `ControllerWorkflow`,
`ControllerPinnedCommand`, `resolvePinnedCommandWorkflow()`, `ControllerActualObservation`,
`ControllerCommandCompletion`, `ControllerRoutingInvocationContext`, evaluator; existing `SessionStateProvider`,
`WorkflowRouter`, `PendingEnvelope`, `PendingObservationRecord`, `ObservationLogStore.append()`,
`validateRecordSchema()`, `redactPendingLogRecord()`; Task 1.2 effective doctor config.

**Produces:**

```ts
// src/core/session-state-provider.ts
beginControllerRoutingCapture(
  sessionId: string,
  command: ControllerPinnedCommand,
): void;

recordControllerActualObservation(
  observation: ControllerActualObservation,
): ControllerRoutingInvocationContext | undefined;

recordControllerCommandCompletion(
  completion: ControllerCommandCompletion,
): ControllerRoutingInvocationContext | undefined;

export const CONTROLLER_ROUTING_MAX_PENDING_CAPTURES_PER_SESSION = 8;
export const CONTROLLER_ROUTING_MAX_CHAT_ACTUALS_PER_SESSION = 8;
export const CONTROLLER_ROUTING_MAX_FINAL_ACTUALS_PER_SESSION = 8;
export const CONTROLLER_ROUTING_MAX_COMPLETIONS_PER_SESSION = 8;

// src/core/justice-plugin.ts
beginControllerRoutingCapture(
  sessionId: string,
  command: ControllerPinnedCommand,
): void;

observeControllerActual(
  observation: ControllerActualObservation,
): Promise<void>;

observeControllerCommandCompletion(
  completion: ControllerCommandCompletion,
): Promise<void>;

// src/hooks/observation-handler.ts
emitControllerRoutingObservation(
  context: ControllerRoutingInvocationContext,
): Promise<void>;

// src/core/v2/observation-model.ts
export type ControllerRoutingObservedRecord = {
  readonly recordType: "observation";
  readonly kind: "controller_routing_observed";
  readonly workflow: string;
} & ControllerRoutingObservation;
```

Ephemeral state is bounded to sessions with active exact pinned-command captures and contains only:

```text
capture count by (sessionId, command)
chat actual by (sessionId, userMessageId)
finalized assistant actual by (sessionId, assistantMessageId)
command completion by (sessionId, assistantMessageId)
```

There is no session-current workflow slot and no routing generation.

- [ ] **Step 1: Write complete failing correlation/runtime/durable/doctor tests**

First pin exact identity correlation. The tests must not call the evaluator alone for production correlation.

#### Different-controller deterministic interleaving

Use `writing-plans` (`sisyphus`) as A and `subagent-driven-development` (`atlas`) as B. Encode the Task 4.0 verified
ordering. Under the candidate contract, the minimum sequence is:

```text
A command.execute.before / capture arm, session=S
A chat.params,             session=S user=U_A agent=sisyphus
B command.execute.before / capture arm, session=S
A finalized message,      session=S assistant=A_A parent=U_A agent=sisyphus
B chat.params,             session=S user=U_B agent=atlas
A command.executed,        session=S command=A assistant=A_A
B finalized message,      session=S assistant=A_B parent=U_B agent=atlas
B command.executed,        session=S command=B assistant=A_B
```

If Task 4.0 proves a different callback order while preserving the same exact identity join, use that proven order
and update this document before implementation.

Assertions are mandatory:

```ts
expect(aRecord).toMatchObject({
  workflow: "writing-plans",
  desiredController: "sisyphus",
  actualController: "sisyphus",
  routingStatus: "applied",
});

expect(bRecord).toMatchObject({
  workflow: "subagent-driven-development",
  desiredController: "atlas",
  actualController: "atlas",
  routingStatus: "applied",
});

expect(aRecord.workflow).not.toBe(bRecord.workflow);
expect(aRecord.actualController).not.toBe("atlas");
expect(bRecord.actualController).not.toBe("sisyphus");
```

Also assert:

- A final actual cannot create/update B's durable record;
- resolving A consumes only `(S, A_A)` and `U_A` state;
- A completion does not remove B's capture/chat/final/completion state;
- B final cannot create/update A's durable record;
- no path compares only `sessionId` when selecting an invocation.

#### Same-controller workflow distinction

Use `brainstorming` and `writing-plans`, both `sisyphus`, with distinct user/assistant IDs. Interleave them and assert
two records with exact workflow values:

```ts
expect(records.map((r) => r.workflow)).toEqual([
  "brainstorming",
  "writing-plans",
]);
expect(records.every((r) => r.actualController === "sisyphus")).toBe(true);
```

This test exists to prove that `desiredController === actualController` cannot hide wrong workflow attribution.

#### Source-specific state behavior

Add focused tests proving:

- `command.execute.before` exact pinned match only arms capture; it does not bind a current workflow context;
- unrelated command text does not arm capture;
- `chat.params` preserves exact raw `agent` under `(sessionId, userMessageId)`;
- non-finalized assistant `message.updated` stores no positive finalized actual and produces no record;
- finalized assistant observation is keyed by exact `(sessionId, assistantMessageId)` and retains
  `parentUserMessageId`;
- exact pinned `command.executed` is keyed by its `(sessionId, assistantMessageId)` and supplies workflow identity;
- completion-before-final and final-before-completion both converge to the same joined invocation;
- mismatched assistant IDs do not resolve;
- mismatched parent user ID cannot borrow another invocation's chat actual;
- when matching chat is absent but command completion + finalized assistant identity match, final routing may use
  `observationSource = "message.updated"` without guessing chat identity;
- production `chat.params` alone appends **no provisional durable routing record**;
- session cleanup removes every routing-correlation entry/count for that session;
- per-session pending/chat/final/completion limits are exactly 8 and overflow is fail-open suppression; pre-spike suppression clears only on `removeSession()`;
- once a session's capture count reaches zero, unmatched routing leftovers are discarded;
- a later event with no active pinned capture creates no routing record.

#### Failure lifecycle contract checkpoint

Do not write production failed-capture cleanup tests from this pre-spike document. Task 4.0 must run first. The
mandatory post-spike document-only amendment must replace this checkpoint with one concrete RED sequence copied from
the sanitized report:

- exact cleanup scope (`session` or a host-verified invocation identity);
- exact hook/event and required value;
- exact ordering relative to B finalized assistant + B `command.executed`;
- one unsafe-early lifecycle case that must **not** clear B;
- one failed-A/successful-B case proving A creates no durable audit and B remains correct;
- exact suppression-clear authority.

The amendment must also add the exact narrow API signature matching that verified scope. No local generation,
sequence, latest/current heuristic, content correlation, generic queue, TTL, cache, timer, or background worker may
be introduced.

Resource-bound tests remain required independently of lifecycle discovery. Use exact value `8`:

- the ninth pending capture credit in one session triggers fail-open overflow handling;
- the ninth unmatched chat entry triggers the same bounded suppression;
- the ninth unmatched finalized-assistant entry triggers the same bounded suppression;
- the ninth unmatched command-completion entry triggers the same bounded suppression;
- overflow appends no routing record and never changes Gate/Acceptance/Authorization/lifecycle/progress state;
- overflow clears unresolved routing entries and sets only the bounded routing-suppression marker;
- in the pre-spike contract, suppression remains until `removeSession(sessionId)`;
- the post-spike reviewed amendment may replace that final rule only with the exact verified
  `suppression_clear_authority` from Task 4.0.

#### Custom raw identity

Keep the closed shard identity separate:

```ts
expect(record.actualController).toBe("custom-controller-v2");
expect(record.actualController).not.toBe("unknown");
```

Existing `setAgentMapping()` may normalize that same runtime agent to `"unknown"` for shard identity; the routing
payload must retain the custom string.

#### Adapter field transport

Drive the exact Task 4.0 fields:

```text
command.execute.before:
  command + sessionID

chat.params:
  sessionID + message.id + raw agent

message.updated:
  info.sessionID + info.id + info.parentID + raw info.agent
  role=assistant + time.completed present

command.executed:
  properties.name + properties.sessionID + properties.messageID
```

Never transport prompt/message content, arguments, parts, model/provider payload, or raw events into routing state.

#### Durable fixtures — self-contained current-plan contract

Define these concrete fixtures before validator/store/redaction/projection assertions:

```ts
const routingEnvelope = {
  schemaVersion: 1 as const,
  timestamp: "2026-09-09T00:00:00.000Z",
  agentId: "system" as const,
  sessionId: "controller-routing",
  writerId: "w-1",
  recordType: "observation" as const,
};

const validCustomMismatch = {
  ...routingEnvelope,
  kind: "controller_routing_observed" as const,
  workflow: "subagent-driven-development",
  routingStatus: "mismatch" as const,
  desiredController: "atlas" as const,
  actualController: "custom-controller-v2",
  applicationMethod: "pinned-command" as const,
  observationSource: "message.updated" as const,
};

const validApplied = {
  ...routingEnvelope,
  kind: "controller_routing_observed" as const,
  workflow: "writing-plans",
  routingStatus: "applied" as const,
  desiredController: "sisyphus" as const,
  actualController: "sisyphus" as const,
  applicationMethod: "pinned-command" as const,
  observationSource: "both" as const,
};

const validUnappliedActualNotObserved = {
  ...routingEnvelope,
  kind: "controller_routing_observed" as const,
  workflow: "writing-plans",
  routingStatus: "unapplied" as const,
  desiredController: "sisyphus" as const,
  applicationMethod: "pinned-command" as const,
  observationSource: "none" as const,
  reason: "actual_not_observed" as const,
};

const validUnappliedApplicationNotConfigured = {
  ...routingEnvelope,
  kind: "controller_routing_observed" as const,
  workflow: "brainstorming",
  routingStatus: "unapplied" as const,
  desiredController: "sisyphus" as const,
  applicationMethod: "none" as const,
  observationSource: "none" as const,
  reason: "application_not_configured" as const,
};

const validUnconfiguredWithObservedActual = {
  ...routingEnvelope,
  kind: "controller_routing_observed" as const,
  workflow: "brainstorming",
  routingStatus: "unapplied" as const,
  desiredController: "sisyphus" as const,
  actualController: "custom-controller-v2",
  applicationMethod: "none" as const,
  observationSource: "message.updated" as const,
  reason: "application_not_configured" as const,
};

const legacySchemaVersion1Record = {
  schemaVersion: 1 as const,
  sequence: 7,
  timestamp: "2026-09-09T00:00:00.000Z",
  agentId: "system" as const,
  sessionId: "legacy",
  writerId: "w-legacy",
  recordType: "observation" as const,
  kind: "skill_invoked" as const,
  skillName: "git-master",
  source: "skill_tool" as const,
};
```

Minimum validator matrix:

```ts
expect(() => validateRecordSchema({ ...validCustomMismatch, sequence: 1 })).not.toThrow();
expect(() => validateRecordSchema({ ...validApplied, sequence: 2 })).not.toThrow();
expect(() =>
  validateRecordSchema({ ...validUnappliedActualNotObserved, sequence: 3 }),
).not.toThrow();
expect(() =>
  validateRecordSchema({ ...validUnappliedApplicationNotConfigured, sequence: 4 }),
).not.toThrow();
expect(() =>
  validateRecordSchema({ ...validUnconfiguredWithObservedActual, sequence: 5 }),
).not.toThrow();
expect(() => validateRecordSchema(legacySchemaVersion1Record)).not.toThrow();

it.each([
  [{ ...validApplied, reason: "actual_not_observed" }],
  [{ ...validCustomMismatch, actualController: undefined }],
  [{ ...validUnappliedActualNotObserved, actualController: "atlas" }],
  [{ ...validUnappliedApplicationNotConfigured, applicationMethod: "pinned-command" }],
  [{ ...validUnappliedApplicationNotConfigured, observationSource: "message.updated" }],
  [{ ...validUnappliedApplicationNotConfigured, actualController: "atlas" }],
  [{ ...validCustomMismatch, actualController: "" }],
])("rejects an illegal controller-routing persisted shape", (record) => {
  expect(() => validateRecordSchema({ ...record, sequence: 99 })).toThrow();
});
```

Also reject unknown routing status/reason and empty workflow.

#### Real append/read/replay boundary

Use the existing `createMemFs()` and real `ObservationLogStore`:

```ts
const { reader, writer } = createMemFs();
const store = new ObservationLogStore(writer, reader, "w-routing");
const routingShard = {
  agentId: "system" as const,
  sessionId: "controller-routing",
  writerId: "w-routing",
};
const pendingCustomMismatch = {
  ...validCustomMismatch,
  writerId: "w-routing",
};

const sequence = await store.append(routingShard, pendingCustomMismatch);
const replayed = await store.readAll();

expect(sequence).toBe(1);
expect(replayed).toContainEqual(
  expect.objectContaining({
    ...pendingCustomMismatch,
    sequence: 1,
  }),
);
```

Assert individually that replay preserves workflow/status/desired/actual/applicationMethod/source/sequence. Keep the
legacy schemaVersion 1 fixture valid and readable without migration.

#### Persistence redaction

Use `redactPendingLogRecord()` directly:

```ts
const sensitiveRouting = {
  ...validCustomMismatch,
  workflow: "/home/user/private/workflow",
  actualController: "TOKEN=secret123",
};
const redacted = redactPendingLogRecord(sensitiveRouting);

expect(redacted).toMatchObject({
  kind: "controller_routing_observed",
  workflow: "[REDACTED_PATH]",
  actualController: "[REDACTED_ENV]",
  routingStatus: "mismatch",
  applicationMethod: "pinned-command",
});
```

The persisted routing payload never contains command arguments/templates, prompt/message content, config objects,
model/provider data, credentials, environment values, or host raw events.

#### Audit-only projection

Project the valid routing records alongside representative lifecycle/Evidence/Gate/Acceptance/Authorization state
and assert adding/removing routing records changes none of:

```text
task count/status
evidence refs
Gate verdict/current decision
Acceptance state
Authorization state
plan/finalization progress
```

Routing audit may feed existing L0 advisory visibility only; it is never authority.

#### Doctor

Retain the existing exact four command definitions and expected agents. Test correct/missing/malformed/mismatched
agent values, source precedence, redacted diagnostics, and expected command template output. Doctor reads only the
effective allowlisted `agent` field and does not expose raw config.

- [ ] **Step 2: Confirm RED**

Run:

```bash
devcontainer exec --workspace-folder . bun run vitest run \
  tests/core/session-state-provider.test.ts \
  tests/core/justice-plugin-routing.test.ts \
  tests/core/v2/observation-model.test.ts \
  tests/runtime/validation.test.ts \
  tests/core/v2/persistence-redaction.test.ts \
  tests/runtime/observation-log-store.test.ts \
  tests/core/v2/state-projection.test.ts \
  tests/runtime/opencode-adapter-v2.test.ts \
  tests/hooks/observation-handler-gate.test.ts \
  tests/core/justice-doctor-config.test.ts \
  tests/runtime/doctor-cli.test.ts
```

Expected: RED because invocation-level state/transport and durable routing support are absent. The deterministic
A/B interleaving and same-controller workflow tests must fail behaviorally against any session-current/latest
implementation. Broken scaffolding is not acceptable RED evidence.

- [ ] **Step 3: Implement in exact ownership order**

1. **`src/core/session-state-provider.ts` — narrow ephemeral correlation**
   - add capture counts keyed by exact `(sessionId, command)`;
   - add chat actuals keyed by `(sessionId, userMessageId)`;
   - add finalized assistant actuals keyed by `(sessionId, assistantMessageId)`;
   - add pinned command completions keyed by `(sessionId, assistantMessageId)`;
   - `beginControllerRoutingCapture()` only increments exact pinned capture; it creates no current workflow slot;
   - both record methods attempt the exact assistant-ID join and may return one
     `ControllerRoutingInvocationContext`;
   - workflow comes only from the joined `ControllerCommandCompletion.command`;
   - finalized assistant `parentUserMessageId` selects only the matching chat entry;
   - consume only the resolved invocation's IDs/count; when no captures remain for a session, drop unmatched routing
     leftovers;
   - `removeSession()` clears all routing correlation state for that session;
   - implement the exact four per-session limits (`8`) from Design §4.1; on overflow clear unresolved routing
     state, set the bounded routing-suppression marker, append no audit, and do not affect authoritative state;
   - under the current pre-spike contract, `routingSuppressed` clears only through `removeSession()`;
   - do not implement any abandonment/quiescence API until the mandatory post-spike reviewed amendment has added
     one exact signature and lifecycle contract to this task;
   - add no generic cache/TTL/timer/background-worker/session/event/correlation framework.

2. **`src/runtime/opencode-adapter.ts` — lossless verified transport**
   - exact pinned `command.execute.before` → `beginControllerRoutingCapture(sessionID, command)`;
   - `chat.params` → raw agent + sessionID + `input.message.id`;
   - assistant `message.updated` → raw agent + sessionID + `info.id` + `info.parentID` + finalized flag derived only
     from `role === "assistant" && time.completed !== undefined`;
   - `command.executed` → exact pinned `name` + sessionID + messageID;
   - before the mandatory post-spike lifecycle amendment, consume no session lifecycle event as routing cleanup
     authority; `session.status`, `session.idle`, and `session.error` remain observation-only capability evidence;
   - after that amendment, transport only its exact allowlisted lifecycle fields; never forward error objects,
     stack traces, status messages, prompt/message content, or raw lifecycle events;
   - do not serialize/transport raw events or content;
   - existing persona `AgentMapped` path stays separate.

3. **`src/core/justice-plugin.ts` — emit only a joined invocation**
   - expose the three exact entry points listed in Produces;
   - when a record call returns no joined context, return without routing append;
   - when it returns a context, pass only that immutable snapshot to the observation handler;
   - expose no abandonment entry point in the pre-spike contract; the mandatory post-spike reviewed amendment
     must add the exact cleanup entry point before this task may run;
   - overflow emits no routing audit and remains fail-open;
   - audit failures remain fail-open.

4. **`src/hooks/observation-handler.ts` — no current-session lookup**
   - accept `ControllerRoutingInvocationContext`;
   - resolve desired controller from `context.workflow`;
   - evaluate final raw actual; use matching chat actual only for source classification;
   - build and append one final routing audit snapshot for the joined invocation;
   - production `chat.params` arrival alone emits no provisional routing record;
   - never query a "current/latest routing context".

5. **`src/core/v2/observation-model.ts` / `record-builder.ts`**
   - add exactly one flattened `controller_routing_observed` observation union member/builder;
   - preserve schemaVersion 1 envelope and custom raw actual string.

6. **`src/runtime/validation.ts`**
   - implement the explicit status/reason/field matrix from Step 1;
   - preserve every previously valid schemaVersion 1 record.

7. **`src/core/v2/persistence-redaction.ts`**
   - explicit routing branch;
   - redact only free-form workflow/custom actual using the existing primitive;
   - preserve literals/enums.

8. **`src/runtime/observation-log-store.ts` existing boundary**
   - no new store;
   - append/read/replay through existing validation/redaction path.

9. **state projection**
   - explicit no-authority handling for routing observation;
   - no lifecycle/Evidence/Gate/Acceptance/Authorization/progress mutation.

10. **doctor / README / SPEC**
    - keep exact four pinned command definitions and expected agents;
    - document that command execution correlation uses verified message identities and final audit is deferred until
      exact command-completion/final-message join;
    - expose no raw config/content.

- [ ] **Step 4: Confirm GREEN and Phase 4 boundary**

Run the Step 2 command.

Expected: PASS for:

```text
different-controller deterministic interleaving
same-controller different-workflow interleaving
exact message identity correlation
A/B independent exact-join cleanup
exact per-session bounds and overflow suppression
post-spike reviewed lifecycle-contract tests added before Task 4.2 execution
custom raw controller preservation
non-finalized suppression
no provisional chat.params durable append
session cleanup
durable schema/validator/redaction/append/read/replay
legacy schemaVersion 1 compatibility
audit-only projection
doctor diagnostics
```

Then run the full Phase 4 boundary gate required by Global Constraints. Task 4.0 must already be PASS; unit tests
cannot substitute for the supported-host overlap evidence.

- [ ] **Step 5: Commit after approval**

```bash
GIT_MASTER=1 git add src/core/session-state-provider.ts src/core/justice-plugin.ts src/core/v2/observation-model.ts src/core/v2/record-builder.ts src/runtime/validation.ts src/core/v2/persistence-redaction.ts src/runtime/opencode-adapter.ts src/hooks/observation-handler.ts src/core/doctor-categories.ts src/core/doctor-config.ts src/runtime/doctor-cli.ts README.md SPEC.md tests/core/session-state-provider.test.ts tests/core/justice-plugin-routing.test.ts tests/core/v2/observation-model.test.ts tests/runtime/validation.test.ts tests/core/v2/persistence-redaction.test.ts tests/runtime/observation-log-store.test.ts tests/core/v2/state-projection.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/hooks/observation-handler-gate.test.ts tests/core/justice-doctor-config.test.ts tests/runtime/doctor-cli.test.ts
GIT_MASTER=1 git commit -m "feat: correlate controller routing by invocation identity"
```

## Traceability and Definition of Done

<!-- markdownlint-disable MD013 MD060 -->

### Requirement-to-Task Traceability

| Requirement / Design Decision                                  | Plan Task               | Required tests                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JUS-P0-01 controller workflow identity and runtime observation | 4.0, 4.1, 4.2           | OpenCode 1.18.29 immutable-source provenance, four nominal probes, deterministic same-server/same-session correlation overlap, awaited command-hook failure probe, sanitized exact lifecycle contract report, mandatory post-spike Design/Plan review checkpoint, fixed per-session bounds/overflow suppression, durable validation/redaction/append/replay |
| Design §4.1 controller routing runtime correlation              | 4.0, 4.1, 4.2           | pinned SDK + exact v1.18.29 source → nominal/overlap traces → exact invocation join; awaited `command.execute.before` failure → ordered lifecycle evidence → exact cleanup contract report → mandatory document-only Design/Plan synchronization/review → only then production cleanup API/tests; no session-current/latest heuristic |
| Design §4.1 `controller_routing_observed` durable audit contract | 4.2 | PendingObservationRecord member, record builder, strict runtime validator, persistence redaction, ObservationLogStore append/read replay, schemaVersion:1 compatibility, no-authority state projection test |
| pinned command name + agent validation                         | 4.2                     | correct agent, missing command, missing agent, mismatched agent, higher-priority replacement in both directions, expected-agent template, raw-config redaction                                                                   |
| JUS-P0-02-05 semantic mutation invalidates authorization       | 2.1, 2.2                | startup current fingerprint mismatch becomes durable `invalidated` before cache restore                                                                                                                                            |
| JUS-P0-02-06 progress-only mutation preserves authorization    | 2.1, 2.2                | approved-task checkbox-only progress produces an equal fingerprint, retains the active binding, and restores cache                                                                                                                 |
| JUS-P0-02-07 canonical fingerprint reuse                       | 2.1, 2.2                | startup validation uses the same `computePlanFingerprint` with durable approved snapshot task IDs                                                                                                                                |
| restart fingerprint validation                                  | 2.2                     | cache restore occurs only after current fingerprint validation and exact same-parent active reread                                                                                                                               |
| startup fingerprint invalidation boundary                       | 2.2, 3.4                | current fingerprint -> durable invalidation -> cancellation attempt -> cache clear -> boundary release                                                                                                                          |
| fingerprint validation uncertainty                              | 2.2, 3.6                | hydrate/read/parse/canonicalization/fingerprint or invalidation uncertainty returns `uncertain` and skips positive recovery                                                                                                     |
| terminal Authorization restart dominance                        | 3.4, 3.6                | startup fingerprint terminalization permits no stale Review, Gate, or Acceptance revival                                                                                                                                        |
| startup recovery readiness                                      | 2.2, 3.6                | `authoritative` only after every startup active binding passes missing-plan and fingerprint validation                                                                                                                          |
| typed `error_annotation` provenance and exact line migration   | 2.1                     | persisted observation validation/replay, plan-path and raw-snapshot scoping, line number / occurrence / digest matching, cross-plan and unknown-provenance retention                                                          |
| authorization sequential supersession                          | 2.2                     | same-session A→B atomic supersession, durable `plan_superseded`, exactly one active binding, old authorization rejection, other-session isolation                                                                                |
| same-process approval serialization                            | 2.2                     | one store plus one injected boundary: concurrent same-parent approvals have maximum mutation-body concurrency one, do not deadlock, retain one active binding, terminalize losers, and publish the final durable active cache |
| cross-process authorization conflict                           | 2.2                     | two stores plus independent boundaries and shared persistence: fresh approvals traverse real `AtomicPersistence` version mismatch and `mergeAuthorizationBindings` retry, retain one active binding, terminalize the losing fresh ID as `plan_superseded`, preserve other-session active binding |
| post-merge own-ID authority                                    | 2.2                     | authoritative reread returns the own fresh-ID winner, returns `null` for a merge loser, reconciles loser cache to durable winner / `null`, and never arms the requested loser plan |
| authorization startup hydration                                | 2.2                     | `hydrate()` reads only authoritative bindings and reports read/parse/validation failure; only a current-fingerprint-equal, same-parent still-active durable binding restores the `PlanBridge` active plan |
| Design §4.2 initial authoritative read failure                  | 2.2                     | malformed authority -> `approve()` returns `null`, invokes no reconciler, and performs zero authoritative save writes |
| Design §4.2 hydrate parse/validation failure                    | 2.2                     | malformed or schema-invalid authoritative persistence -> `hydrate()` rejects rather than returning `[]` |
| Design §4.2 public/inner authoritative reread failure            | 2.2                     | corrupt authority -> mutation returns failed/uncertain, is not classified as deterministic `not_found`, and performs no authoritative mutation |
| Design §5.2 startup hydration uncertainty                       | 2.2, 3.6                | real malformed authority -> strict hydrate failure -> `restoreActivePlans() === "uncertain"` -> positive startup recovery is skipped |
| AtomicPersistence backward compatibility                        | 2.2                     | default `loadWithLock()` corruption behavior remains `emptyValue()` with lock version `0` |
| Authorization strict persistence                              | 2.2                     | strict mode treats ENOENT as empty state and throws for existing blank, malformed, and invalid-schema payloads |
| Design §4.8.1 live Authorization read failure                     | 3.4                     | strict initial or reread failure in offer/claim resolves a blocked outcome, records `review_authorization_unreadable`, converges same-parent active slots by best-effort cancellation, and creates no positive dispatch or decision state |
| missing plan startup invalidation                              | 2.2                     | confirmed missing (`readPlanFile() === null`) performs durable active -> invalidated; an existing plan proceeds to current fingerprint validation rather than restoring by existence alone |
| missing-plan invalidation reason                               | 2.2                     | missing-plan terminalization records `invalidatedAt` and never records `plan_superseded` |
| missing-plan boundary ownership                                | 2.2, 3.4                | one parent boundary owns exact reread, invalidation, cancellation, and cache clear; inner acquire count is zero |
| missing-plan invalidation -> review cancellation               | 2.2, 3.4                | durable invalidation -> cancelled tombstone attempt -> cache clear -> boundary release; cancellation failure never rolls back invalidation |
| startup plan probe uncertainty                                 | 2.2, 3.6                | probe throw performs no irreversible mutation or positive cache restore and prevents positive recovery |
| startup invalidation persistence uncertainty                   | 2.2, 3.6                | failed/uncertain terminal mutation performs no cancellation, cache restore, directive reissue, offer, claim, Gate, or Acceptance recovery |
| authorization terminal dominance and cache consistency         | 2.2                     | same-ID terminal never resurrects; conflict-diverted candidate never updates cache; saved merged durable active binding is the cache value; post-save reread failure invokes `reconcileActivePlan(sessionId, null)` and clears positive cache |
| authorization active-plan callback matrix                      | 2.2                     | initial-read/save failure has no callback and retains cache; winner returns own binding; loser returns `null` and reconciles winner / `null`; post-save reread failure callbacks `null` and never arms |
| JusticePlugin existing initialization preservation              | 2.2                     | `plugin.initialize()` keeps `TieredWisdomStore.loadAll()`, telemetry load, projection cache initialization, notifier invocation, notifier isolation, and initialization logging |
| authorization restoration failure isolation                     | 2.2, 3.6                | rejected or uncertain `restoreActivePlans()` does not reject `plugin.initialize()` and does not prevent Wisdom, Telemetry, projection, or notifier initialization, but prevents positive authorization-dependent recovery |
| startup recovery ordering                                       | 2.2, 3.4, 3.6           | composition-root test proves authorization hydration -> fingerprint terminalization when needed -> projection -> staged completion recovery -> review dispatch recovery; terminal Authorization exposes no stale positive transition and uncertainty skips both positive recovery phases |
| Authorization public/inner mutation split                      | 2.2                     | public release and fingerprint invalidation acquire the boundary once; their within-boundary counterparts acquire it zero times; wrong parent causes no durable mutation                                                                                                       |
| `AuthorizationReviewBoundary` implementation                  | 2.2                     | same-parent exclusion, rejected-predecessor recovery, A -> B -> C conditional-tail cleanup, and different-parent progress                                                                                                       |
| shared boundary singleton wiring                               | 2.2, 3.2, 3.4, 3.6      | plugin construction calls the factory once; cross-domain same-parent integration proves max concurrency one                                                                                                                      |
| review completion -> Gate lock ownership                       | 3.2, 3.6                | live clean Task and Final Review reach Gate without nested parent acquisition and append one GateDecision / AcceptanceDecision                                                                                                  |
| staged recovery -> Gate lock ownership                         | 3.2, 3.6                | Task and Final Review restart recovery complete without nested parent acquisition and append one GateDecision / AcceptanceDecision                                                                                               |
| release -> cancellation critical section                       | 2.2, 3.4                | one outer parent operation orders durable release, cancellation attempt, cache update, and boundary release; failed or uncertain release has no cancellation or terminal cache publication                                                                                      |
| invalidation -> cancellation critical section                  | 2.2, 3.4                | fingerprint and confirmed-missing invalidation each use one outer parent operation ordering durable invalidation, cancellation attempt, cache clear, and boundary release; failed or uncertain invalidation has no cancellation or terminal cache publication |
| missing-plan terminal restart dominance                         | 3.4, 3.6                | missing-plan terminal Authorization permits no directive, offer, claim, staged completion promotion, Gate, or Acceptance revival after restart |
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
| Design §4.10 exclusive reservation                             | 3.4                     | `createExclusiveMarker` created/occupied, fresh-UUID collision retry, bounded collision exhaustion, and no `fileExists` / `writeFile` fallback |
| Design §4.10 lease-aware worker write                          | 3.4                     | matching-inode `writeExisting` success; unlink/recreate and symlink replacement reject without changing replacement bytes |
| Design §4.10 unsupported runtime                               | 3.4                     | missing marker or reserved-artifact I/O capability produces `artifact_storage_unavailable`, an unusable reservation, and no worker artifact path |
| Design §4.10 no-follow Justice read                            | 3.6                     | artifact descriptor, lease descriptor, and durable identity must match before exactly-one read and JSON parsing |
| Design §4.10 identity-safe cleanup                             | 3.6                     | replacement path is retained with an advisory; no check-then-unlink fallback; terminal authority is not rolled back |
| anti-replay completion                                         | 3.6                     | replacement fails before parse, Gate, and Acceptance; interrupted read never rereads a changed path |
| artifact reservation anti-replay                               | 3.4, 3.6                | exclusive reservation, reserved write, no-follow read, replacement-safe cleanup, and unusable fail-closed behavior |
| FileWriter marker capability compatibility                     | 3.4                     | unrelated `FileWriter` implementations remain type-compatible; shared production-routing mock supplies deterministic created/occupied marker behavior |
| synchronous mandatory review execution                         | 3.4                     | explicit true is forced to false by package, hook normalization, and final adapter wire guard for both review categories; non-review categories preserve caller value              |
| artifact inode lease and no-follow consumption                 | 3.4, 3.6                | retained private lease, durable device/inode identity, existing-inode write, replacement/symlink rejection, descriptor-relative read, replacement-safe cleanup                    |
| unusable reservation blocks before Acceptance                   | 3.4, 3.6                | fail-open review task execution, worker input without artifact path, no filesystem read or ReviewArtifact, no AcceptanceDecision                                                                                             |
| artifact read / validation failure terminality                  | 3.6                     | missing file, read I/O failure, invalid JSON, and schema mismatch each persist its exact no-artifact terminal reason; claimed slot converges after restart, lifecycle stays blocked, no Gate/Acceptance/retry/round change, and cleanup is idempotent |
| same-parent review claim serialization                         | 3.4                     | 2-call claim race and barrier-controlled overlapping 3-call race permit one critical section and exactly one claimed transition, binding, reservation, and authoritative call/artifact identity                                  |
| one outstanding dispatch per parent                            | 3.4                     | active-authorized pending / claimed cardinality permits zero or one; stale terminal/missing/uncertain Authorization slots are excluded from the limit but remain unclaimable; corrupt multiple active outstanding input is advisory, creates no pending, claim, reservation, directive, or AcceptanceDecision |
| deferred ReviewPending liveness                                | 3.1, 3.4, 3.6           | a second lifecycle candidate receives exactly one dispatch and directive from the production terminalization path without a second manual request                                                                                |
| queued directive drain-time authority                          | 3.4, 3.6                | root drain validates same-parent current pending slot and current active Authorization inside the shared boundary; claimed, terminal, cancelled, missing, and stale deliveries are removed without injection; unreadable authority retains delivery without positive injection |
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
| JUS-P0-04 durable review dispatch and child correlation        | 3.3, 3.3c, 3.4, 3.5     | child-session runtime spike, supported-host TaskTool mutation/correlation probe, pending/claimed recovery, parent-session critical section, concurrent claim, durable child binding                                                                                                  |
| JUS-P0-04 accepted task progress                               | 3.7                     | all unchecked steps checked, reparse completed, other tasks unchanged, zero-step no-op, durable acceptance ordering, old terminal-Authorization decision rejection                                                               |
| JSON review transport fixed for P0                             | 3.4, 3.6                | reservation anti-replay, unusable fail-open/blocked path, one usable-path read, composite terminal record; no typed transport dependency                                                                                         |
| INV-01 through INV-05                                          | 1.1, 2.1, 2.2, 4.1      | category/routing/fingerprint/authorization focused tests named in those tasks                                                                                                                                                    |
| INV-06 through INV-10                                          | 3.1, 3.2, 3.6, 3.7      | lifecycle, Gate, terminalization, progress, Final Gate tests named in those tasks                                                                                                                                                |
| INV-11 through INV-18                                          | 3.3, 3.4, 3.5, 3.6      | purpose separation, claim, restart, correlation, stale-event and consumption tests named in those tasks                                                                                                                          |
| INV-19 terminal Authorization boundary                         | 2.3, 3.2, 3.4, 3.6, 3.7 | terminality guards for dispatch, claim, staged completion, Gate, Acceptance, progress, recovery, cancellation-tombstone failure, and fresh reapproval isolation                                                                  |
| INV-20 synchronous mandatory review                             | 3.3c, 3.4, 3.6          | host-boundary TaskTool execution proves the mutation is consumed; package, hook, and final adapter wire guards force false for both review categories while preserving non-review caller values                                                                                     |
| INV-21 artifact inode identity                                  | 3.4, 3.6                | private lease, durable identity, no-follow existing-inode write/read, replacement rejection, and safe cleanup tests                                                                                                             |
| INV-22 review-owned write cancellation                          | 3.3c, 3.6               | supported-host success/rejection cancellation, reason-preserving merger, narrow plugin throw, zero built-in writer calls, and outside-target retention                                                                                 |
| INV-23 authoritative host mutation                              | 3.3c, 3.6               | exact OpenCode CLI hard gate, actual TaskTool execution trace, child-session correlation, committed artifact path delivery, and production host E2E                                                                                   |
| N-API descriptor and addon build contract                       | 3.3b                   | direct camelCase `openExistingReservation` ABI call, root reopen identity, pinned Rust toolchain, exact N-API addon output, and built-addon runtime tests                                                                                   |

### Task-to-Requirement Traceability

| Plan Task | Requirement / Design Decision implemented                                                        | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1       | JUS-P0-03, Design §5.3, INV-02, INV-05                                                           | role-to-category mapping tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.2       | JUS-P0-03, Design §3.4 and §5.3                                                                  | effective configuration and category-presence tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.1       | JUS-P0-02, Design §4.3, INV-04                                                                   | fingerprint boundary, typed `error_annotation` persistence/replay, exact plan/line identity migration tests                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.2       | JUS-P0-02-05 through JUS-P0-02-07, Design §4.2 and §5.2, INV-03, INV-04, INV-12, authorization cardinality, shared boundary, strict Authorization persistence, AtomicPersistence backward compatibility, missing-plan terminality, and JusticePlugin initialization preservation | default/strict `AtomicPersistence` read behavior, malformed/schema-invalid hydration rejection, corrupt initial approval returning `null` with zero authoritative writes, malformed mutation not classified as `not_found`, authorization persistence, fresh ID, same-ID terminal merge, sequential supersession, version-mismatch concurrent fresh-ID merge/retry, exactly-one-active, other-session preservation, callback matrix and cache/durable agreement, failed-save cache retention, post-save reread failure cache clearing, unchanged semantic restore, semantic mismatch terminalization, progress-only preservation, fingerprint and hydration uncertainty, confirmed-missing active -> invalidated without `plan_superseded`, one-boundary/zero-inner-acquire, rejected predecessor recovery, A -> B -> C tail cleanup, different-parent progress, one-factory construction contract, existing initialization preservation, and restoration failure isolation tests |
| 2.3       | JUS-P0-02, Design §4.2, §4.8.1, and §5.2                                                         | pathless cancel parser, durable release, and Task 3.4 cancellation-orchestration boundary tests                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3.1       | JUS-P0-04, Design §3.3, §4.4, §5.4, §5.5, INV-06, INV-09, INV-14                                 | lifecycle orchestration; initial finalization and actual-rework fresh identity tests; no Review Dispatch schema, retry projection, or old-round test dependency                                                                                                                                                                                                                                                                                                                                                                                   |
| 3.2       | JUS-P0-02, JUS-P0-04, Design §4.6, §4.8.2, and §4.11, INV-07, INV-08, INV-10, INV-14, INV-19     | gate-pending-only; authorization guard; public parent-boundary entry and within-boundary Gate entry; same-identity Gate / Acceptance serialization and sequential idempotency; barrier-coordinated two- and three-way overlap; legacy schemaVersion 1 validation, shard replay, compatibility projection, and non-authority; strict new-decision validation / lookup; decision ordering; Gate-phase blocked-Acceptance and pre-Gate no-Acceptance tests |
| 3.3       | JUS-P0-04, Design §4.9, INV-15                                                                   | child-session runtime spike                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.3a      | JUS-P0-04, Design §4.10, F-043, F-045, F-047                                                    | Linux `openat2(2)` / `renameat2(2)` hard-gate probe; exact CLI provisioning; exclusive marker, inode/lease identity, descriptor-relative write/read, symlink and ancestor-swap rejection, paired cleanup semantics, unsupported-runtime result, and recorded PASS/BLOCKED output |
| 3.3b      | JUS-P0-04, Design §4.10, INV-21, F-043, F-045, F-048                                           | bundled Rust Node-API `LinuxOpenat2ReviewArtifactProvider`; exact addon build, camelCase descriptor ABI, root reopen identity, `NodeFileSystem` capability composition, native security tests, `replacement_retained` / `cleanup_incomplete` behavior, unsupported-platform tests, and fail-open capability publication |
| 3.3c      | JUS-P0-04, Design §12.5, §12.6, §12.7, INV-20, INV-22, INV-23, F-046, F-047                | exact OpenCode CLI hard gate; actual host plugin dispatch; mutable task-args propagation into TaskTool and child execution; runtime call/child correlation; secure-write and rejection cancellation; zero built-in writer calls; unrelated-write control; redacted evidence report |
| 3.4       | JUS-P0-02, JUS-P0-04, Design §4.8, §4.8.1, §4.8.2, §4.10, §12.1, §12.2, §12.3, §12.5, PreToolUse §12.6, INV-11, INV-16, INV-17, INV-18, INV-19, INV-20, INV-21, F-036, F-040, F-041, F-042, F-043, F-045, F-048 | deterministic selector and parent-session candidate projector; single production composition root and shared boundary/log wiring; drain-time queued-delivery validator with deliver/discard/retain outcomes; startup fixture with normal-hook delivery, review-first claim/no-old-directive, terminal discard, and unreadable-authority retention; `ClaimInput` without correlation, exact unavailable/integrity blocked outcomes, and production routing spoof regression; authorization-specific snapshot membership; exact parent-session queue primitive; public cancellation wrapper versus within-parent helper; one outer release/fingerprint/missing-plan invalidation plus cancellation critical section; review-first PreToolUse claim and existing HookResponse mapping; startup missing-plan and fingerprint-mismatch terminalization inject no directive, offer, claim, Gate, or Acceptance; strict initial/reread Authorization rejection resolves blocked without leaking, records `review_authorization_unreadable`, attempts same-parent cancellation, and creates no positive state; category-aware synchronous wire normalization; optional exclusive-marker plus separate reserved-artifact I/O capability, unusable missing-capability result, inode lease, matching-inode write, and replacement rejection; paired cleanup status propagation; review-only Final Review retry/current-round projection; no-reentrant queue, terminal-to-pending crash recovery, durable-before-directive ordering, repeated recovery idempotency, and stale-round rejection tests |
| 3.5       | JUS-P0-04, Design §4.9, INV-14, INV-15, INV-17, INV-18                                           | durable child-binding tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.6       | JUS-P0-02, JUS-P0-04, Design §4.5, §4.8.1, §4.8.2, §4.10, §4.11, §12.2, §12.4, §12.5, §12.6, §12.7, PostToolUse §12.6, INV-13 through INV-23, F-040, F-043, F-045, F-046, F-047, F-048 | uncertain authorization restoration from hydration, probe, fingerprint, or persistence keeps Wisdom/Telemetry/projection/notifier initialization but skips staged and dispatch positive recovery; startup-first matching Review PreToolUse claims once without old directive reinjection; terminal delivery discard and unreadable-authority retention; composition-root semantic-mismatch and progress-only startup ordering; purpose-aware parent-task PostToolUse routing before implementation handlers; trusted-reservation `readOnce` binding, no-follow artifact/lease/durable three-way identity validation before parse, replacement failure before Gate/Acceptance, paired cleanup status propagation including `cleanup_incomplete`, unusable no-read blocked path, authorization guard, within-boundary Gate capability for live and staged/post-terminal recovery, concrete staged-terminal recovery and post-terminal outcome helpers, exact staging/terminal cleanup matching, no reread, terminal reuse without reappend, lifecycle/Gate/Acceptance idempotency, failure blocking, mismatch rejection, terminal-auth precedence, composite terminal/replay, reason-preserving HookResponse merge, narrow host cancellation for both review-write outcomes, composition and supported-host E2E, and shared-singleton integration tests |
| 3.7       | JUS-P0-02, JUS-P0-04, Design §3.3 and §5.4, INV-06, INV-08, INV-19                               | accepted-only full progress update and old terminal-Authorization decision rejection tests                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4.1       | JUS-P0-01, Design §4.1, INV-01                                                                   | controller routing tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4.2       | JUS-P0-01, Design §3.4, §3.5, and §5.1                                                           | effective pinned-command name-and-agent, precedence, redaction, template, and routing-observation tests                                                                                                                                                                                                                                                                                                                                                                                                                                           |

F-035 reverse traceability is also explicit: `AtomicPersistence` strict-read opt-in implements the
Design §4.2 authoritative-read failure semantics without changing other persistence domains;
Authorization malformed-persistence tests verify Design §4.2 and §5.2 propagation; and the Task 3.6
uncertainty gate consumes the `AuthorizationRestorationOutcome` produced by Task 2.2 to keep
`authorizationRecoveryReady` false and skip positive startup recovery.
F-036 reverse traceability is explicit: Task 3.4 covers both initial and reread live offer/claim
reads, maps rejection to blocked outcomes and `review_authorization_unreadable`, performs only
best-effort same-parent cancellation/advisory recording, and verifies that no positive dispatch,
claim, reservation, Gate, Acceptance, or Progress state leaks through the runtime integration path.
The named executable coverage is the four unreadable-Authorization unit tests in
`tests/core/review-dispatch-state.test.ts` plus
`keeps live mandatory-review PreToolUse fail-open when Authorization is unreadable` in
`tests/core/justice-plugin-routing.test.ts`; the latter uses concrete durable-log projections
and the existing `HookResponse` union rather than test-only authority or response helpers.
F-040 reverse traceability is explicit: Task 3.4 owns the narrow Review Dispatch validator and
the root-only sink primitive, while Task 3.6 owns the production PostToolUse drain and the
startup-first matching PreToolUse regression. Both invoke validation under the one shared parent
boundary, inject only an active current pending slot, discard terminal / claimed / stale deliveries,
and retain unreadable-authority deliveries with zero positive directive.
F-041 reverse traceability is explicit: Task 3.4 makes `createExclusiveMarker` an optional
`FileWriter` capability; the reservation port turns capability absence into an unusable result with
no check-then-use fallback, the production adapter passes only the verified
`LinuxOpenat2ReviewArtifactProvider` capability on the supported deployment, and the shared
production-routing helper supplies deterministic marker behavior without forcing unrelated writers or
inline test doubles to change. Task 3.3a is the hard gate for exposing that provider.
F-043 reverse traceability is explicit: Design §4.10 names the concrete Rust Node-API addon, supported
Linux deployment, exact `openat2(2)` / `renameat2(2)` security primitives, and unsupported-runtime
behavior; Task 3.3a proves those primitives before Task 3.3b/3.4; Task 3.3b builds and tests the real
provider; Task 3.4 wires the provider through the actual `OpenCodeAdapter` composition; and Task 3.6
drives a real Linux E2E from review claim through mediated worker write, one read, terminalization,
Gate/Acceptance ordering, and replacement-safe paired cleanup. A mock-only GREEN result or a provider
probe failure cannot satisfy F-043.
F-045 reverse traceability is explicit: Task 3.3a is the hard gate for the supported Linux provider and
its exact runtime prerequisites; Task 3.3b owns the concrete native/TypeScript implementation and
restart ABI; and Task 3.4 exposes the provider only as the narrow reservation capability without a
pathname fallback. The Task 3.3a probe, Task 3.3b native security suite, and Task 3.4 reservation
tests must all pass before the review completion path can be authoritative.
F-046 reverse traceability is explicit: Design §12.5 defines the two-value
`ReviewArtifactWriteSkipReason` contract; Task 3.6 changes the response merger to retain that reason,
returns `review_artifact_write_committed` only after `writeExisting` commits, returns
`review_artifact_write_rejected` for every review-owned rejection/provider failure, and makes the plugin
wrapper throw only `ReviewArtifactWriteCancelled` for those two values. The failure matrix covers missing
or stale bindings, wrong paths, invalid content, identity mismatch, symlink/inode replacement, provider
failure, unrelated writes, and reasonless skips. Both composition and host tests assert zero built-in writer
calls and no rejected completion evidence.
F-047 reverse traceability is explicit: Design §12.7 pins the supported OpenCode CLI to `1.18.29` while
keeping the lockfile SDK at `1.14.21`; Task 3.3c is the hard-gate runtime probe that records actual host
hook dispatch, TaskTool execution, child-session correlation, mutable `run_in_background` and artifact-path
propagation, and host cancellation; Task 3.6 consumes those recorded field paths in a separate supported-host
production E2E. Direct adapter tests remain composition coverage only and cannot satisfy F-047.
F-048 reverse traceability is explicit: Design §4.10 defines paired artifact/lease quarantine,
identity revalidation, `quarantine_retained`, `replacement_retained`, and `cleanup_incomplete`; Task 3.3b
implements the no-name-only-unlink retention policy and the post-verification replacement race; Task 3.4
carries the narrow cleanup status through the reservation capability; and Task 3.6 records
`review_artifact_cleanup_retained` without rereading, rolling back Gate/Acceptance, restoring over, or
deleting a replacement. Native security, provider reopen, composition, and restart tests must cover
fail-closed retention and cross-reservation isolation before F-048 is complete.

Phase 3 is incomplete if Task 3.3 cannot demonstrate both mandatory review correlations, if Task 3.3a
cannot produce a supported-provider `PASS`, or if Task 3.3b cannot build and test the concrete addon.
It is incomplete if lifecycle orchestration, synchronous mandatory review canonicalization,
terminal-Authorization guard, cancellation tombstone convergence, non-reentrant parent-session
serialization, concurrent exactly-one claim, usable and unusable reservation branches, durable child
binding, mediated worker artifact write, terminal classification, composite terminal record,
staged-completion restart recovery without artifact/worker-output reread, post-terminal lifecycle/Gate
recovery without terminal reappend, stale-event rejection, conclusive-loss recovery, uncertain-claimed
blocking, attempt-scoped Gate/Acceptance idempotency, task Gate, Final Gate, or accepted-task progress
lacks a passing automated test. Gate/Acceptance idempotency specifically requires the concurrent
decision-identity cases, legacy task Gate shard replay compatibility, legacy non-authority, and strict
new-decision replay described in Task 3.2. A provider probe `BLOCKED` result is an implementation
blocker, not a runtime limitation that waives a P0 completion criterion.

<!-- markdownlint-enable MD013 MD060 -->

Before implementation handoff, inspect every implementation step for unresolved placeholders, ambiguous file paths, and unbound requirements. Verify that every test file in a Task's Files list appears in that Task's RED and GREEN command and its `git add` scope. Verify that every table row names an exact Task and RED/GREEN test, and that every Task row names its Design decision and Requirement. Do not hand off a plan with undefined work, implied test coverage, cross-task shorthand, or an atomicity statement without its exclusion mechanism.

---

## F-037/F-040対応追記: production wiring and root response drain

これは F-037 の未解決だった production composition と F-040 の root response drain を実装計画へ
固定する追記である。`createReviewDispatchState` の unit test が GREEN であることだけでは不十分で、
Task 3.4 は下記の single composition と review-first PreToolUse route が production test
で GREEN になるまで未完了とする。purpose-aware PostToolUse と startup recovery の呼び出し
順序は Task 3.6 の完了条件であり、この追記はその接続契約を明示する。

### Production composition contract

既存の `JusticePlugin` composition root を拡張し、domain factory を一度だけ実体化する。
Task 2.2、Task 3.2、Task 3.4、Task 3.6 は同じ boundary と同じ durable log を共有し、
各 Task が独自の singleton、queue、AuthorizationStore、ObservationLogStore を作っては
ならない。

- `JusticePlugin` に `private readonly reviewDispatchState: ReturnType<typeof createReviewDispatchState>`
  を追加する。
- `createAuthorizationReviewBoundary()` は plugin construction 中に一度だけ呼び出し、
  そのインスタンスを `AuthorizationStore`、Gate evaluator、Review Dispatch factory、
  Review Completion factory に渡す。
- `AuthorizationStore` は `new AuthorizationStore(fileReader, fileWriter, authorizationReviewBoundary)`
  で一つだけ生成し、`readDurableAuthorizations` と `findAuthorizationById` の production
  port はこの instance に束縛する。
- `writerId` は一度だけ確定し、同じ `ObservationLogStore(fileWriter, fileReader, writerId)`
  を `ObservationHandler` と Review Dispatch の durable read/append port で共有する。
- Review Dispatch は `readDurableRecords`、`readDurableAuthorizations`、
  `findAuthorizationById`、`appendReviewDispatchTransition`、`reserveReviewArtifact`、
  `injectReviewRequiredDirective`、`withAuthorizationReviewBoundary`、
  `hydrateAuthorizationsBeforeReviewRecovery`、`recordAdvisory` の全 port を実際の
  hook/runtime adapter に束縛して生成する。production で `async () => undefined` の
  no-op port を使用してはならない。
- `appendReviewDispatchTransition` は共有 `ObservationLogStore.append()` へ接続し、入力の
  `agentId`、`sessionId`、`writerId` から現在の shard を構成する。Core factory が
  `ObservationLogStore`、`AuthorizationStore`、OpenCode adapter を直接 import しては
  ならない。
- `reserveReviewArtifact` は Task 3.4 の `ReviewArtifactReservationPort` と、
  `OpenCodeAdapter.#runInit()` から渡される optional な descriptor-relative review-artifact
  capability に接続する。path の再生成、`fileExists` と `writeFile` の check-then-use、
  非排他的な上書き、canonical absolute path と leaf-only `O_NOFOLLOW` の組み合わせは
  許可しない。capability がない Node runtime は `artifact_storage_unavailable` へ縮退する。
- `recordAdvisory` は既存の Observation Log の advisory append 経路へ接続する。
  logger のみへの出力を durable advisory の代替にしてはならない。
- `reviewDispatchState` を生成した直後に `this.reviewDispatchState` へ代入し、同じ
  instance の
  `cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim` を、既存の
  `PlanBridge` へ一度だけ `setReviewDispatchCancellation(...)` で注入する。既存の
  cancellation-only snippet はこの state wiring の代替ではない。

### Concrete helper and port contracts

The identifiers used by the composition and routing snippets below are planned symbols with
the following exact contracts; implementation must define them before the production RED/GREEN
tests are run. None of these names may be treated as an implicit global or an API invented only
inside a test.

The following module-private helpers belong in `src/core/justice-plugin.ts`, beside the production
composition. They import `normalizeTaskToolInput` and `resolveTaskIdFromModifiedPayload` from
`src/core/task-packager.ts`, `buildSessionErrorRecord` from `src/core/v2/record-builder.ts`, and the
planned Review Dispatch types from their owner modules. `cause` is never serialized; the existing log
persistence redaction remains the final storage boundary.

```ts
async function appendReviewDispatchAdvisory(
  logStore: ObservationLogStore,
  writerId: string,
  advisory: string,
  cause?: unknown,
): Promise<void> {
  void cause;
  try {
    const agentId: ObservationAgentId = "system";
    const sessionId = "review-dispatch";
    await logStore.append(
      { agentId, sessionId, writerId },
      buildSessionErrorRecord({
        envelope: {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId,
          sessionId,
          writerId,
          recordType: "observation",
        },
        errorKind: "review_dispatch_advisory",
        message: advisory,
      }),
    );
  } catch {
    // Durable advisories are best-effort. Never replace them with logger-only behavior.
  }
}

async function appendReviewDispatchTransitionToStore(
  logStore: ObservationLogStore,
  input: PendingReviewDispatchTransitionRecord,
): Promise<
  | { readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord }
  | { readonly kind: "failed" }
> {
  try {
    const sequence = await logStore.append(
      { agentId: input.agentId, sessionId: input.sessionId, writerId: input.writerId },
      input,
    );
    return { kind: "committed", record: { ...input, sequence } };
  } catch {
    return { kind: "failed" };
  }
}

function resolveMandatoryReviewCategory(
  toolInput: Readonly<Record<string, unknown>>,
): "sp-review" | "sp-final-review" | undefined {
  const category = normalizeTaskToolInput(toolInput).category;
  return category === "sp-review" || category === "sp-final-review" ? category : undefined;
}

function buildReviewClaimResponse(
  event: PreToolUseEvent,
  outcome: ClaimReviewDispatchOutcome,
): HookResponse {
  switch (outcome.kind) {
    case "claimed": {
      const reservation = outcome.taskCallBinding.artifactReservation;
      if (reservation.status !== "usable") {
        return {
          action: "inject",
          injectedContext: "[JUSTICE] REVIEW ARTIFACT RESERVATION UNUSABLE",
        };
      }
      const args = normalizeTaskToolInput(event.payload.toolInput);
      delete args.correlation;
      delete args.artifact_path;
      delete args.artifactPath;
      return {
        action: "inject",
        injectedContext: "[JUSTICE] REVIEW DISPATCH CLAIMED",
        modifiedPayload: {
          args: {
            ...args,
            artifact_path: reservation.artifactPath,
            run_in_background: false,
          },
        },
      };
    }
    case "claimed_unusable":
      return {
        action: "inject",
        injectedContext: `[JUSTICE] ${outcome.advisory.toUpperCase()}`,
      };
    case "blocked":
      return { action: "proceed" };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

function formatReviewDirective(directive: ReviewRequiredDirective): string {
  if (directive.correlation.reviewKind === "task-review") {
    return [
      "[JUSTICE] REVIEW REQUIRED",
      "category: sp-review",
      `task_id: ${directive.correlation.taskExecutionRef.taskId}`,
      `attempt_id: ${directive.correlation.taskExecutionRef.attemptId}`,
    ].join("\n");
  }
  return [
    "[JUSTICE] FINAL REVIEW REQUIRED",
    "category: sp-final-review",
    `finalization_attempt_id: ${directive.correlation.finalizationAttemptId}`,
    `final_review_round: ${directive.correlation.finalReviewRound}`,
  ].join("\n");
}
```

`appendReviewDispatchTransitionToStore` is the only physical dispatch-transition append adapter and
preserves the input envelope identity. `buildReviewClaimResponse` removes incoming correlation and artifact-path
fields, then copies only the durable usable reservation path into the worker payload; it never treats an incoming
correlation, category, or artifact path as authority.
The exhaustive switch intentionally keeps future outcome variants from silently becoming a Runtime fallback.
`FileWriter` gains only the optional runtime-boundary capability below. Existing unrelated writers,
including `NoOpPersistence` and tests that do not reserve review artifacts, remain type-compatible.

```ts
// src/core/types.ts
export interface FileWriter {
  // Existing writeFile, rename, mkdir, rmdir, deleteFile, and link members remain unchanged.
  createExclusiveMarker?(
    path: string,
  ): Promise<
    | {
        readonly kind: "created";
        readonly leasePath: string;
        readonly artifactIdentity: ReviewArtifactInodeIdentity;
      }
    | { readonly kind: "occupied" }
  >;
}
```

Define the following review-artifact-only runtime port in `src/core/review-artifact.ts`. Do not add its three
members to `FileReader`, `FileWriter`, `NoOpPersistence`, or unrelated test doubles. The core reservation port
receives it as a separate optional constructor argument; it is the only capability that can consume a usable
reservation.

```ts
export type ReservedReviewArtifactIo = {
  readonly writeExisting: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
    content: string,
  ) => Promise<void>;
  readonly readOnce: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ) => Promise<string>;
  readonly cleanup: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ) => Promise<"cleaned" | "quarantine_retained" | "replacement_retained" | "cleanup_incomplete">;
};
```

The current `NodeFileSystem` uses path-only `node:fs/promises` operations and must not claim that
`resolveSafely()` plus leaf-only `O_NOFOLLOW` is descriptor-relative. Do not add
`createExclusiveMarker` or `ReservedReviewArtifactIo` implementations that resolve an absolute path and
then open, link, or unlink it. Such code leaves an ancestor-swap window between validation and use.

The supported deployment uses the concrete `LinuxOpenat2ReviewArtifactProvider` from Task 3.3b. The
method remains intentionally separate from `FileWriter` for reserved-artifact I/O; it gives the
production composition a typed capability probe without turning an unsafe path helper into a review
artifact boundary. Unsupported platforms and failed probes continue to expose no capability.

```ts
// src/runtime/node-file-system.ts
private readonly reviewArtifactProvider?: LinuxOpenat2ReviewArtifactProvider;
readonly createExclusiveMarker?: NonNullable<FileWriter["createExclusiveMarker"]>;

constructor(
  root: string,
  reviewArtifactProvider?: LinuxOpenat2ReviewArtifactProvider,
) {
  // Existing root initialization remains unchanged.
  this.createExclusiveMarker = reviewArtifactProvider?.createExclusiveMarker;
  this.reviewArtifactProvider = reviewArtifactProvider;
}

createReservedReviewArtifactIo(): ReservedReviewArtifactIo | undefined {
  return this.reviewArtifactProvider?.reservedReviewArtifactIo;
}
```

`NodeFileSystem` exposes `createExclusiveMarker` only when the constructor receives the selected provider.
The provider holds an open directory descriptor for the review root and every ancestor used by marker,
lease, read, write, and cleanup. Its operations are descriptor-relative (or a platform-equivalent atomic
primitive), compare artifact and lease identities before I/O, and are guarded by the Task 3.3a probe and
Task 3.3b real-filesystem ancestor-swap tests. Unsupported platforms continue to pass no capability and
the reservation port returns `artifact_storage_unavailable` without creating a directory or exposing a
path.
- `createReviewArtifactReservationPort(fileReader: FileReader, fileWriter: FileWriter, reservedReviewArtifactIo: ReservedReviewArtifactIo | undefined, recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>): ReviewArtifactReservationPort` returns the injected port whose public `reserve(): Promise<ReviewArtifactReservation>` operation owns safe-path validation, bounded collision retry, and capability completeness. `createExclusiveMarker` and `ReservedReviewArtifactIo` are runtime capabilities, not general storage interfaces or a second composition dependency.

Define the reservation port and helper before the production RED/GREEN tests. The helper below is the
complete core-side retry and classification boundary; inode capture, marker cleanup, and no-follow
support remain inside the injected `FileWriter.createExclusiveMarker` runtime operation when that
optional capability is present. The path-only Node runtime takes the missing-capability branch.

```ts
const MAX_ARTIFACT_RESERVATION_ATTEMPTS = 3;

export type ReviewArtifactReservationPort = {
  readonly reserve: () => Promise<ReviewArtifactReservation>;
};

export function createReviewArtifactReservationPort(
  fileReader: FileReader,
  fileWriter: FileWriter,
  reservedReviewArtifactIo: ReservedReviewArtifactIo | undefined,
  recordAdvisory: (advisory: string, cause?: unknown) => Promise<void>,
): ReviewArtifactReservationPort {
  // Reservation never uses fileExists: the marker operation is the exclusive create boundary.
  void fileReader;

  const recordAdvisorySafely = async (advisory: string, cause?: unknown): Promise<void> => {
    try {
      await recordAdvisory(advisory, cause);
    } catch {
      // Advisory persistence is fail-open.
    }
  };

  return {
    async reserve(): Promise<ReviewArtifactReservation> {
      const createExclusiveMarker = fileWriter.createExclusiveMarker;
      if (createExclusiveMarker === undefined || reservedReviewArtifactIo === undefined) {
        await recordAdvisorySafely("artifact_reservation_storage_unavailable");
        return { status: "unusable", reason: "artifact_storage_unavailable" };
      }
      for (let attempt = 0; attempt < MAX_ARTIFACT_RESERVATION_ATTEMPTS; attempt += 1) {
        let artifactId: string;
        try {
          artifactId = randomUUID();
        } catch (cause: unknown) {
          await recordAdvisorySafely("review_artifact_reservation_internal_error", cause);
          return { status: "unusable", reason: "reservation_internal_error" };
        }

        const artifactPath = `.justice/reviews/${artifactId}.json`;
        let safeArtifactPath: string;
        try {
          safeArtifactPath = normalizeSafeRelativePath(artifactPath);
        } catch (cause: unknown) {
          await recordAdvisorySafely("review_artifact_path_invalid", cause);
          return { status: "unusable", reason: "artifact_path_invalid" };
        }

        try {
          const marker = await createExclusiveMarker.call(fileWriter, safeArtifactPath);
          if (marker.kind === "occupied") {
            await recordAdvisorySafely("review_unexpected_existing_artifact");
            continue;
          }
          return {
            status: "usable",
            artifactId,
            artifactPath: safeArtifactPath,
            leasePath: marker.leasePath,
            artifactIdentity: marker.artifactIdentity,
          };
        } catch (cause: unknown) {
          await recordAdvisorySafely("artifact_reservation_storage_unavailable", cause);
          return { status: "unusable", reason: "artifact_storage_unavailable" };
        }
      }

      return { status: "unusable", reason: "artifact_path_collision_exhausted" };
    },
  };
}
```

The optional `FileWriter` type change is part of Task 3.4's Files list. The `NodeFileSystem`
implementation receives the selected provider, exposes its optional `createExclusiveMarker`, and
`createReservedReviewArtifactIo()` is called once at the composition root. Either capability being absent
is an explicit `artifact_storage_unavailable` unusable result: it invokes neither
`fileExists` nor `writeFile` and exposes no worker artifact path. `createMockFileWriter()` remains compatible;
the review-artifact tests create a separate deterministic `createMockReservedReviewArtifactIo(files)` alongside
it. `createMockFileSystem()` uses that explicit test port only when a test constructs
the review composition. `createMemFs().writer` and unrelated inline writer doubles remain unchanged unless their
own test exercises reservation. The mock I/O port must reject a mismatched/symlink replacement without mutating
its bytes, read only a matching recorded identity, and return `replacement_retained` instead of deleting a
replacement. The shared helper owns only deterministic identity bookkeeping; the runtime file test owns the
unsupported-capability probe and the Linux provider tests own native semantics. Tests must assert that `fileExists` is never
used for reservation, that a collision retries with a fresh UUID, and that
marker, identity, lease, or either missing capability returns the exact unusable reason without exposing a path.

Extend the existing `node:path` import with `basename` and add type-only imports for
`ReviewArtifactInodeIdentity` and `ReservedReviewArtifactIo`. Extend both `MockFileWriter` and
`MockFileSystem` with `readonly reviewArtifactIdentities: Map<string, ReviewArtifactInodeIdentity>`. Add this
state beside `writtenFiles` in `createMockFileWriter()`, and add the method and map to its returned
`MockFileWriter` object. This helper is intentionally a deterministic reservation double, not a replacement for
the Node runtime's no-follow implementation.

```ts
let nextMockInode = 1;
const reviewArtifactIdentities = new Map<string, ReviewArtifactInodeIdentity>();

createExclusiveMarker: vi.fn(async (path: string) => {
  if (path in writtenFiles) return { kind: "occupied" as const };
  const identity = { device: "mock-device", inode: String(nextMockInode) };
  nextMockInode += 1;
  const leasePath = `${dirname(path)}/.leases/${basename(path)}.lease`;
  writtenFiles[path] = "";
  writtenFiles[leasePath] = "";
  reviewArtifactIdentities.set(path, identity);
  reviewArtifactIdentities.set(leasePath, identity);
  return { kind: "created" as const, leasePath, artifactIdentity: identity };
}),
```

Define and export `createMockReservedReviewArtifactIo(files)` in `tests/helpers/mock-file-system.ts` as a separate
`ReservedReviewArtifactIo`. `replaceArtifactLeafWithDifferentInode` changes the artifact entry in
`files.reviewArtifactIdentities` without changing the lease entry. This lets the mock test the same durable
identity mismatch boundary as the runtime test without pretending that an in-memory record is a no-follow file
descriptor.

```ts
function createMockReservedReviewArtifactIo(
  files: MockFileSystem,
): ReservedReviewArtifactIo {
  const isCurrent = (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ): boolean => {
    const artifact = files.reviewArtifactIdentities.get(reservation.artifactPath);
    const lease = files.reviewArtifactIdentities.get(reservation.leasePath);
    const matches = (identity: ReviewArtifactInodeIdentity | undefined): boolean =>
      identity?.device === reservation.artifactIdentity.device &&
      identity.inode === reservation.artifactIdentity.inode;
    return matches(artifact) && matches(lease);
  };
  const isCleanable = (
    path: string,
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ): boolean => {
    if (!(path in files.writtenFiles)) return !files.reviewArtifactIdentities.has(path);
    return matches(files.reviewArtifactIdentities.get(path));
  };
  const failure = (reason: "artifact_write_failed" | "artifact_read_failed"): Error =>
    Object.assign(new Error("mock review artifact identity mismatch"), { reason });

  return {
    writeExisting: async (reservation, content): Promise<void> => {
      if (!isCurrent(reservation)) throw failure("artifact_write_failed");
      await files.writeFile(reservation.artifactPath, content);
    },
    readOnce: async (reservation): Promise<string> => {
      if (!isCurrent(reservation)) throw failure("artifact_read_failed");
      return files.readFile(reservation.artifactPath);
    },
    cleanup: async (
      reservation,
    ): Promise<"cleaned" | "quarantine_retained" | "replacement_retained" | "cleanup_incomplete"> => {
      if (
        !isCleanable(reservation.artifactPath, reservation) ||
        !isCleanable(reservation.leasePath, reservation)
      ) {
        return "replacement_retained";
      }
      try {
        if (reservation.artifactPath in files.writtenFiles) {
          await files.deleteFile(reservation.artifactPath);
          files.reviewArtifactIdentities.delete(reservation.artifactPath);
        }
      } catch {
        return "cleanup_incomplete";
      }
      try {
        if (reservation.leasePath in files.writtenFiles) {
          await files.deleteFile(reservation.leasePath);
          files.reviewArtifactIdentities.delete(reservation.leasePath);
        }
      } catch {
        return "cleanup_incomplete";
      }
      return "cleaned";
    },
  };
}
```

`createMockFileSystem()` continues to spread only its writer. Each review fixture explicitly passes this separate
I/O port to `JusticePluginOptions`, so unrelated `FileWriter` users remain unchanged. The mock port is the
usable-capability test double; it must not be described as evidence of Node's descriptor-relative guarantees.

Add a focused assertion in `tests/core/review-artifact-reservation.test.ts` that the production routing fixture
receives a usable reservation through an explicitly supplied `createMockReservedReviewArtifactIo(files)`. The
test must also assert a second call for the same destination returns `{ kind: "occupied" }` without replacing
its existing content.

Add the unsupported-platform capability probe to `tests/runtime/node-file-system.test.ts`. It owns the
runtime capability decision rather than pretending that the shared mock helper proves filesystem semantics.
The Linux x86_64 provider behavior is tested by `tests/runtime/linux-review-artifact-provider.test.ts`
and `tests/runtime/linux-review-artifact-provider-security.test.ts` after the native addon build.

```ts
it("does not advertise review-artifact I/O when the provider probe is unavailable", () => {
  const fs = new NodeFileSystem(".", undefined);

  expect(fs.createReservedReviewArtifactIo()).toBeUndefined();
  expect("createExclusiveMarker" in fs).toBe(false);
});
```

The Linux provider suite must additionally prove matching-inode `writeExisting` / `readOnce`,
ancestor-swap, symlink-replacement, and replacement-retaining cleanup. Those tests are a prerequisite
for publishing the addon and are not optional coverage.
- `resolveMandatoryReviewCategory(toolInput: Readonly<Record<string, unknown>>): "sp-review" | "sp-final-review" | undefined` returns a value only for exact canonical categories after the existing task-input normalizer has run.
- `buildReviewClaimResponse(event: PreToolUseEvent, outcome: ClaimReviewDispatchOutcome): HookResponse` maps only a committed `TaskCallBinding` / explicit blocked outcome to the existing `HookResponse` union; it never copies correlation or artifact identity from `event.payload`.
- `formatReviewDirective(directive: ReviewRequiredDirective): string` is the single pure formatter for the Controller-facing review directive.
- `JusticePlugin.warnMergeConflict(message: string): void` is the existing guarded logger method used by both response mergers; no free-standing logger callback is introduced.

`readDurableAuthorizations` is also an injected Review Dispatch port, not an
`AuthorizationStore` method. Its production binding is exactly
`() => authorizationStore.hydrate()`, and every read remains strict and allowed to reject as
described above. Do not add `AuthorizationStore.readDurableAuthorizations()` or normalize its
rejection to an empty array.

`injectReviewRequiredDirective` は notifier-only callback ではなく、hook response へ到達
する domain-specific sink とする。既存の `ReviewRequiredDirective` の identity は
`correlation` のみを SSOT として維持し、delivery routing のためだけに次の envelope を
使用する。

```ts
export type ReviewDirectiveDelivery = {
  readonly parentSessionId: string;
  readonly directive: ReviewRequiredDirective;
};
```

Review Dispatch factory の `injectReviewRequiredDirective` port はこの
`ReviewDirectiveDelivery` を受け取り、`parentSessionId` を directive identity に複製
せず、`JusticePlugin` が所有する hook response accumulator へ渡す。live hook では同じ
event の response に一度だけ merge し、startup recovery では次の Controller-facing hook
へ再発行できる domain-specific pending delivery として保持する。delivery は
`parentSessionId + sameReviewCorrelation` で重複排除する。notifier、prompt text、category、
artifact path、worker self-report を delivery identity に使用してはならない。sink 内の delivery
だけでは inject authority にならない。root drain は同じ parent の current `pending` slot、current
active Authorization、current lifecycle を Review Dispatch validator で確認し、claimed / terminal /
cancelled / missing / stale item を削除して inject しない。Authorization または durable read が
uncertain の item は削除せず、次の matching root hook で再検証する。

### Startup ordering

`JusticePlugin.initialize()` の全体 sequence は Task 3.6 が実装する。Task 3.4 は
`reviewDispatchState.recoverReviewDispatchesAfterRestart()` と PlanBridge cancellation
capability を提供し、Task 3.6 が同じ production instance を使って既存の Wisdom、Telemetry、
projection cache、notifier の fail-open を維持しつつ、Authorization-dependent recovery を
次の順序で実行する。

1. `PlanBridge.restoreActivePlans()` を通じて authoritative `AuthorizationStore.hydrate()`
   を完了し、`AuthorizationRestorationOutcome` を readiness として保持する。
2. `ObservationHandler.initializeProjectionCache()` で durable observation log を読み、
   lifecycle と Review Dispatch projection を再構築する。
3. `authorizationRecoveryReady` が true の場合だけ、Task 3.6 の
   `recoverStagedReviewCompletionsAfterRestart()` を実行する。
4. 同じ readiness の内側で、Task 3.4 の
   `this.reviewDispatchState.recoverReviewDispatchesAfterRestart()` を実行する。
5. 既存の notifier 初期化を完了し、その後に通常の event processing を受け付ける。

Authorization の read、parse、validation が失敗した場合は empty array として扱わない。
readiness を false にし、Review Dispatch directive の reissue、offer、claim、reservation、
Gate、Acceptance、Progress を行わず、既存の fail-open plugin 初期化だけを継続する。
`claimed` slot は directive を再発行せず、`pending` slot だけを同じ correlation で再発行
する。recovery は上記の production instance を使用し、factory を再生成してはならない。

### Lifecycle offer ownership

Task 3.1 の lifecycle handler は、`review_pending` または `final_review_pending` の durable
transition が commit された後にだけ、`this.reviewDispatchState.offerNextMandatoryReview(parentSessionId)`
を呼び出す。caller は correlation を渡してはならず、candidate の選択と
`null -> pending` append は Review Dispatch の single offer boundary が行う。

Task 3.4 の failure terminalization、Task 3.6 の completion terminalization、startup
recovery は同じ offer boundary を使用する。すでに parent boundary を保持している caller
は `offerNextMandatoryReviewWithinParentSessionClaim` を使い、public wrapper を再入しない。
`pending` commit が成功する前に directive を delivery してはならず、terminalization の
前に retry pending を作ってはならない。

### PreToolUse routing precedence

`JusticePlugin.handleEvent(PreToolUse)` は既存の PlanBridge path より先に、review task の
専用 routing を判定する。判定は次の順序で行う。

1. `toolName === "task"` 以外は既存の ObservationHandler path へ渡す。
2. task input を既存の normalizer で canonicalize し、category が正確に `sp-review` または
   `sp-final-review` の場合だけ review route に入る。category は candidate identity ではなく
   expected category としてのみ使用する。
3. `event.sessionId`、観測された `event.callId`、`SessionStateProvider` から解決した
   `agentId`、plugin が保持する `writerId` が空でないことを検証する。parent session と
   parent call の field path は Task 3.3 の runtime spike で観測したものを使用し、prompt、
   category、artifact path、worker report から推測しない。
4. `ClaimInput` を構成し、`parentSessionId`、`callId`、`expectedCategory`、`agentId`、
   `sessionId`、`writerId` を渡して `reviewDispatchState.claimReviewDispatch()` を呼ぶ。
   `ClaimInput` は correlation field を持たず、durable pending slot の correlation だけを使用する。
5. claim が commit されるまで `TaskCallBinding`、`ReviewArtifactReservation`、worker path、
   `SessionStateProvider` の positive binding cache を公開しない。

review route に入った call は `PlanBridge.handlePreToolUse()` を呼ばず、
`consumeImplementationArm()` を消費しない。pending slot がない、複数ある、category が
不一致、Authorization が terminal / missing / unreadable / uncertain、または claim append
が失敗した場合は blocked / stale advisory とし、implementation route へ fallback しない。
これにより review task が implementation task として誤認される経路を禁止する。

`claimed` の成功結果からは、commit 済み `TaskCallBinding` の trusted correlation と
`artifactReservation` だけを使用する。usable reservation の `artifactPath` は一度だけ
worker payload へ渡し、hook / adapter が再生成・再正規化・別 path の選択をしてはならない。
`claimed_unusable` は path を省略したまま task execution を fail-open で継続し、
`artifact_reservation_unusable` terminal tombstone を authoritative completion として扱わない。

両 review category は package、hook、adapter の全境界で `run_in_background = false` にする。
caller が `runInBackground: true` または `run_in_background: true` を指定しても、review
route が最終 wire payload を上書きする。non-review category の caller 値は変更しない。

### HookResponse mapping

既存の `HookResponse` union だけを使用し、`PROCEED` の新しい型や `skip` の代替を追加しない。
`ProceedResponse` は `modifiedPayload` を持てないため、usable claim の payload 変更は必ず
既存の `InjectResponse` と `mergePreToolUseResponses` で行う。

- usable な `claimed` は `action: "inject"` とし、元の args を保った
  `modifiedPayload.args` に committed binding の exact `artifactPath` と
  `run_in_background: false` を設定する。correlation、category、task identity は committed
  binding と expected category から構成し、入力値を権威にしない。
- `claimed_unusable` は `action: "inject"` の advisory を返してもよいが、
  `modifiedPayload.args` に `artifactPath` を含めない。元の task は fail-open で継続し、
  ReviewArtifact、Gate、Acceptance、retry を生成しない。
- `blocked` は既存の `action: "proceed"` または advisory を含む既存の `action: "inject"`
  とし、binding、reservation、artifact path を返さない。`action: "skip"` は使用しない。
- observation response、normal injected context、gate advisory context がある場合は既存
  merger の意味を保ち、review route の payload が PlanBridge の implementation payload を
  上書きしない。
- claim、reservation、projection、directive delivery の例外は全て review route 内で捕捉し、
  advisory を best-effort に記録した上で `PROCEED` または既存 inject response に縮退する。
  exception を `handleEvent()` の外へ漏らしてはならない。

### PostToolUse routing handoff

`PostToolUse` の production routing は Task 3.6 Step 3 に実装する。Task 3.4 は
`TaskCallBinding`、trusted correlation、child-binding lookup に必要な durable projection と、
failure terminalization / next-offer capability を提供するだけで、completion consumerを呼ばない。
Task 3.6 の route は call ID から durable projection の `TaskCallBinding` を解決し、purpose を
最初に判定する。

- `purpose === "implementation"` は既存の WorkerReported / Evidence / lifecycle path へ渡す。
- `purpose === "task_review"` または `purpose === "final_review"` は、matching parent
  session、call ID、trusted correlation、expected category、child binding を検証した後、
  Task 3.6 の `consumeReviewCompletion` へ渡す。failure は Task 3.4 が提供する
  `terminalizeReviewFailure` capabilityへ渡し、callerがretry correlationを構成しない。
- stale event、purpose mismatch、old round、unknown child relation は advisory-only とし、
  artifact I/O、ReviewArtifact、Gate、Acceptance、Progress に影響させない。
- review purpose の PostToolUse を PlanBridge の implementation feedback、
  `TaskFeedbackHandler` の implementation completion、または generic task summary として
  処理してはならない。side-effecting review completion は Task 3.6 の指定順序で直列化する。

### Required production tests

以下は planned test ではなく production path を実際に通す RED/GREEN acceptance criteria
として扱う。unit-only の `createReviewDispatchState` を直接呼ぶだけでは代替できない。
テストの追加責務は Task 3.4 / 3.5 / 3.6 の Files、RED、GREEN、git add に合わせる。

- `tests/core/justice-plugin-routing.test.ts` で、実際の `JusticePlugin` composition を構築し、
  valid Authorization と durable `null -> pending` slot を準備する。`sp-review` と
  `sp-final-review` の PreToolUse がそれぞれ一度だけ claim され、`TaskCallPurpose`、trusted
  correlation、exact artifact path、`run_in_background: false` が production response に
  現れることを確認する。
- 同じテストで runtime `event.callId` が欠落または空の場合、payload の optional な `callId` を
  fallback にせず、claim、binding、reservation、artifact path を生成しない fail-open
  response になることを確認する。
- `tests/core/review-dispatch-state.test.ts` に compile-only assertion を置き、正しい
  `ClaimInput` は type-check される一方、`correlation` property を含む object literal には
  `@ts-expect-error` が必要であることを確認する。test-only input、sanitizer、validator を
  追加せず、production input type 自体を authority boundary とする。`ClaimInput` を export する
  必要はなく、production return value から input type を取得する。

  ```ts
  type ProductionClaimInput = Parameters<
    ReturnType<typeof createReviewDispatchState>["claimReviewDispatch"]
  >[0];

  const validClaimInput: ProductionClaimInput = fixture.claimInput;
  void validClaimInput;

  // @ts-expect-error ClaimInput intentionally has no untrusted correlation surface.
  const forgedCorrelation: ProductionClaimInput = {
    ...fixture.claimInput,
    correlation: { reviewKind: "task-review" },
  };
  void forgedCorrelation;
  ```
- 同じテストで review task が implementation arm を消費せず、PlanBridge の
  `implementation_unauthorized` または implementation context を返さないことを確認する。
  pending slot がない場合は binding / reservation / path なしで blocked / advisory となる。
- 同じテストで review PreToolUse は `PlanBridge.handlePreToolUse()`、
  `TaskFeedbackHandler.setActivePlan()`、implementation task window の再登録を一度も呼ばない一方、
  non-review task は既存どおり `openSessionTaskWindow`、modified payload からの task ID 解決、
  active-plan 設定、session generation 再確認後の window 再登録を通ることを確認する。
  session removal を Promise 待機中に発生させた fixture では、non-review 再登録がゼロであることを
  assert し、review route 追加が既存 race guard を失わせないことを証明する。
- 同じテストで `arrangeLiveMandatoryReviewWithUnreadableAuthorization()` を使い、strict な
  real Authorization persistence adapter の malformed JSON を production plugin 初期化後に
  読ませる。`handleEvent()` が reject せず、既存 `HookResponse` union の proceed または
  inject に縮退し、new claim、reservation、Gate、Acceptance、Progress を作らず、同じ
  parent の cancellation tombstone だけを best-effort に試行することを確認する。
- `tests/hooks/observation-handler-lifecycle.test.ts` は Task 3.1 が所有し、lifecycle
  transition commit 後の一度だけの offer、pending commit 前の directive delivery防止、二重
  offer防止を確認する。
- `tests/core/justice-plugin-routing.test.ts` は Task 3.6 で、実際の PostToolUse route が
  lifecycle offer / completion consumer が sink に積んだ directive を同じ
  `HookResponse` に merge すること、PreToolUse だけを drain point にしてもテストが GREEN に
  ならないことを確認する。handler failure の fail-open path でも delivery を捨てないことを
  確認する。
- `tests/hooks/observation-handler-transactional.test.ts` はTask 3.5のchild-binding casesを
  維持し、Task 3.6がmatching review PostToolUseのcompletion / terminalization、implementation
  feedback path非通過、stale call ID / old roundのartifact非読込を追加する。
- `tests/runtime/opencode-adapter-v2.test.ts` はTask 3.4がreview categoryのsynchronous
  final-wire casesを追加し、Task 3.5がchild relation casesを追加する。
- `tests/core/justice-plugin.test.ts` はTask 3.6がboundary、AuthorizationStore、ObservationLogStore、
  Review Dispatch stateの各一つと、initializeのAuthorization hydration、projection、staged
  completion recovery、Review Dispatch recovery順序を確認する。

各 production integration test は、実装前に missing routing / missing composition を理由と
する assertion failure を確認し、undefined symbol や引数型エラーを RED の根拠にしない。
実装後は次の targeted command と全体 command を実行する。

```bash
devcontainer exec --workspace-folder . bun run vitest run \
  tests/core/justice-plugin-routing.test.ts \
  tests/runtime/opencode-adapter-v2.test.ts
devcontainer exec --workspace-folder . bun run vitest run \
  tests/core/justice-plugin-routing.test.ts \
  tests/core/justice-plugin.test.ts \
  tests/hooks/observation-handler-transactional.test.ts
bun run test
bun run typecheck
bun run lint
bun run build
```

F-037/F-040 の reverse traceability は、`JusticePlugin` の single composition、review-first
PreToolUse routing、Task 3.6へのpurpose-aware PostToolUse handoff、PostToolUse/PreToolUse の
root sink drain、既存 `HookResponse` mapping、fail-open boundary、Task 3.4 / 3.6のproduction
integration testsで構成する。
なお、`ec23694` は計画書だけを変更したため、既存の F-036 記述にある integration test は
このコミットで実際に追加されたテストではなく、計画上のテスト仕様である。この区別を保った
まま、Task 3.4はPreToolUse/composition、Task 3.6はPostToolUse/startup wiringの実テスト追加と
GREENをそれぞれの完了条件にする。
