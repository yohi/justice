# Justice v4 Upstream Compatibility Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Justice v4 execute approved Superpowers v6.4.2 plans safely through OmO v4.19.4 without redesigning the current Justice execution loop.

**Architecture:** Keep the existing PlanParser → DependencyAnalyzer → PlanBridge → OmO `task()` flow. Add only four compatibility shims: lossless task-body preservation, Justice/OmO task-ID separation, caller-owned `subagent_type` preservation, and conservative sequential fallback for Superpowers `**Interfaces:**` plans.

**Tech Stack:** TypeScript 6.x, Bun, Vitest, OpenCode 1.18.29, Superpowers v6.4.2, oh-my-openagent v4.19.4.

**Spec:** `docs/superpowers/specs/2026-09-27-v4-superpowers-6.4.2-omo-4.19.4-compatibility-bridge-design.md`

## Global Constraints

- This is a temporary Justice v4 compatibility bridge; do not pull Justice v5 architecture into this change.
- Preserve the current direct Justice → OmO `task()` execution loop.
- Preserve `/justice-start`, `/justice-implement`, existing `sp-*` categories, config format, authorization, observation, gate, and review-artifact contracts.
- Superpowers target is exactly v6.4.2.
- OmO target is exactly v4.19.4.
- OpenCode support remains exactly the current Justice V1 target, 1.18.29; do not widen the matrix.
- Justice logical IDs such as `task-3` remain internal and must never be emitted as OmO continuation `task_id`.
- Only `task_id` values beginning with `ses_` are valid OmO continuations for this bridge.
- A trimmed, non-fenced line exactly equal to `**Interfaces:**` switches the whole plan to conservative dependency mode.
- In conservative dependency mode, only the first incomplete task is runnable and no parallel guidance is emitted.
- Core code must remain free of `@opencode-ai/*` imports.
- Follow TDD and run all repository verification commands fresh before completion.

## Review Focus

- Fenced examples containing `### Task N:` or `**Interfaces:**` must not alter real task boundaries or dependency mode; Task 1 and Task 3 pin both cases.
- A caller-supplied unknown `task_id` must not accidentally survive wire normalization; Task 2 pins removal.
- A caller-owned `subagent_type` combined with an existing `category` must remain caller-owned rather than being rewritten to Justice routing; Task 4 pins the precedence.
- An approved plan fingerprint must remain stable when only checkboxes change and must still invalidate on semantic task-body changes; Task 1 runs the existing fingerprint regression suite after parser changes.
- Authorization failure must still return the existing unauthorized directive without mutating caller payload, even when `subagent_type` or `ses_...` is present; Task 4 adds the regression.

---

### Task 1: Preserve full Superpowers task bodies without breaking plan state

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/plan-parser.ts`
- Test: `tests/core/plan-parser.test.ts`
- Test fixture compatibility: `tests/core/dependency-analyzer.test.ts`
- Test fixture compatibility: `tests/core/category-classifier.test.ts`
- Test fixture compatibility: `tests/core/plan-bridge-core.test.ts`
- Test fixture compatibility: `tests/core/progress-reporter.test.ts`
- Test fixture compatibility: `tests/core/task-splitter.test.ts`

**Interfaces:**
- Produces: `PlanTask.rawBody: string`, containing the exact original Markdown from the real task heading through the line before the next real task heading.
- Produces: `PlanParser.parse(content: string): PlanTask[]` with fence-aware task boundaries.
- Consumes later: Task 3 reads `PlanTask.rawBody` to detect exact Superpowers `**Interfaces:**` markers.
- Consumes later: Task 4 uses `PlanTask.rawBody` as the primary worker task contract.

- [ ] **Step 1: Write failing parser tests for lossless task sections**

Add tests named:
- `preserves the complete raw task body`
- `preserves Interfaces tests signatures verification and expected output`
- `ignores task headings inside fenced code blocks`

Assertions must prove:
- `rawBody` starts with the real `##/### Task N:` heading.
- `rawBody` includes `**Interfaces:**`, `Consumes:`, `Produces:`, test/assertion text, an exact signature, `Run:`, and `Expected:`.
- a fenced `### Task 999: example` does not create a task or terminate the surrounding `rawBody`.
- existing checkbox-derived `steps`, `status`, and line numbers remain unchanged.

- [ ] **Step 2: Run the focused parser tests and confirm RED**

Run: `bun run vitest run tests/core/plan-parser.test.ts`

Expected: FAIL because `PlanTask.rawBody` does not exist and fenced headings are still interpreted as task boundaries.

- [ ] **Step 3: Add `PlanTask.rawBody` and fence-aware parsing**

In `src/core/types.ts`, add exactly:

```ts
readonly rawBody: string;
```

to `PlanTask`.

In `src/core/plan-parser.ts`, make `parse(content: string): PlanTask[]`:
- normalize CRLF to LF for scanning only;
- track Markdown backtick/tilde fences;
- recognize task headings only while outside a fence;
- record each real task section's start/end line indexes;
- assign `rawBody` from the normalized original lines without checkbox canonicalization or semantic rewriting;
- preserve current checkbox parsing, status derivation, and line-number semantics.

Do not import task-section logic from `plan-fingerprint.ts`; keep this bridge local and avoid expanding the refactor surface.

- [ ] **Step 4: Update direct `PlanTask` test literals for the required field**

In the listed fixture-compatibility test files, add representative `rawBody` strings to manually constructed `PlanTask` objects without changing their behavior.

If `bun run typecheck` reports another direct `PlanTask` literal, update only that literal with `rawBody`; do not broaden production scope.

- [ ] **Step 5: Run parser, type, fingerprint, and checkbox regressions**

Run:
```bash
bun run vitest run tests/core/plan-parser.test.ts tests/core/plan-fingerprint.test.ts
bun run typecheck
```

Expected: PASS with zero failures and zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/plan-parser.ts tests/core
git commit -m "fix: preserve approved plan task bodies"
```

---

### Task 2: Separate Justice logical task IDs from OmO continuation IDs

**Files:**
- Modify: `src/core/task-packager.ts`
- Test: `tests/core/task-packager.test.ts`

**Interfaces:**
- Existing: `resolveTaskIdFromToolInput(toolInput: Readonly<Record<string, unknown>>): string | undefined` continues to recognize Justice logical `task-N` IDs for internal selection/correlation only.
- Add: `resolveOmoContinuationTaskId(toolInput: Readonly<Record<string, unknown>>): string | undefined` returns only canonical/camel alias values beginning with `ses_`.
- Update: `normalizeTaskToolInput(toolInput: Readonly<Record<string, unknown>>): Record<string, unknown>` removes logical/unknown task IDs from wire output and preserves only a genuine `ses_...` continuation.
- Update: `enrichTaskToolInput(...)` must no longer synthesize Justice `taskId` into OmO `task_id`.

- [ ] **Step 1: Replace legacy wire-ID expectations with RED compatibility tests**

Add/update tests to assert:
- `resolveTaskIdFromToolInput({ task_id: "task-3" }) === "task-3"`.
- `resolveOmoContinuationTaskId({ task_id: "ses_abc" }) === "ses_abc"`.
- `resolveOmoContinuationTaskId({ taskId: "ses_abc" }) === "ses_abc"`.
- `resolveOmoContinuationTaskId({ task_id: "task-3" }) === undefined`.
- `resolveOmoContinuationTaskId({ task_id: "opaque-id" }) === undefined`.
- normalized fresh input contains no `task_id`.
- normalized `task-N` and unknown IDs contain no `task_id`.
- normalized `ses_abc` preserves exactly `task_id: "ses_abc"`.
- `enrichTaskToolInput({ prompt: "run" }, "task-generated")` does not emit `task_id: "task-generated"`.

- [ ] **Step 2: Run task-packager tests and confirm RED**

Run: `bun run vitest run tests/core/task-packager.test.ts`

Expected: FAIL on the new continuation helper and on legacy expectations that currently emit `task-*` on the wire.

- [ ] **Step 3: Implement OmO continuation filtering**

Implement:

```ts
export function resolveOmoContinuationTaskId(
  toolInput: Readonly<Record<string, unknown>>,
): string | undefined
```

The accepted value is the first string from `task_id ?? taskId` that starts with `"ses_"`.

Update normalization so:
- `taskId` alias is removed;
- `task_id` is removed unless `resolveOmoContinuationTaskId()` succeeds;
- successful continuation is written canonically as `task_id`;
- Justice `taskId` arguments remain internal metadata only.

- [ ] **Step 4: Preserve `subagent_type` in the generic normalizer**

Remove `subagent_type` from the unconditional forbidden-field set. Continue removing Justice-forbidden explicit `agent`, `model`, `provider`, `variant`, `reasoning`, and `fallback_models` fields from Justice-owned normalization.

Task 4 will decide whether `category` may be added; this task only makes generic normalization non-destructive to caller-owned `subagent_type`.

- [ ] **Step 5: Run focused tests and typecheck**

Run:
```bash
bun run vitest run tests/core/task-packager.test.ts
bun run typecheck
```

Expected: PASS with no logical `task-*` synthesized into normalized OmO args.

- [ ] **Step 6: Commit**

```bash
git add src/core/task-packager.ts tests/core/task-packager.test.ts
git commit -m "fix: separate Justice and OmO task identities"
```

---

### Task 3: Fail safe to sequential execution for Superpowers Interfaces plans

**Files:**
- Modify: `src/core/dependency-analyzer.ts`
- Test: `tests/core/dependency-analyzer.test.ts`

**Interfaces:**
- Existing: `DependencyAnalyzer.getParallelizable(tasks: PlanTask[]): PlanTask[]`.
- Existing legacy semantics: `(depends: task-N)` remains unchanged when no real task contains the exact Superpowers marker.
- New internal rule: if any real `PlanTask.rawBody` contains a trimmed, non-fenced line exactly equal to `**Interfaces:**`, `getParallelizable()` returns at most the first incomplete task in document order.

- [ ] **Step 1: Write RED conservative-mode tests**

Add tests named:
- `runs only the first incomplete task when a real Interfaces block is present`
- `advances to the next incomplete task after the first completes`
- `ignores Interfaces text inside fenced code blocks`
- `does not enter conservative mode for prose containing the word Interfaces`
- `preserves legacy explicit dependency parallelization without Interfaces`

Assertions must prove:
- two pending tasks with a real `**Interfaces:**` block yield only Task 1;
- marking Task 1 complete yields only Task 2;
- fenced `**Interfaces:**` does not trigger sequential fallback;
- `"Discuss Interfaces here"` does not trigger fallback;
- the existing Task 2 + Task 3 parallel legacy example remains parallelizable.

- [ ] **Step 2: Run dependency tests and confirm RED**

Run: `bun run vitest run tests/core/dependency-analyzer.test.ts`

Expected: FAIL because current `getParallelizable()` treats no legacy marker as independence.

- [ ] **Step 3: Implement fence-aware conservative marker detection**

Add private/local detection that scans each `task.rawBody` and returns true only for a trimmed, non-fenced line equal to `**Interfaces:**`.

At the start of `getParallelizable()`:
- if conservative mode is active, return `[firstIncomplete]` or `[]`;
- do not evaluate legacy dependency graph for parallel candidates in that mode;
- otherwise retain current `(depends: ...)` behavior exactly.

Do not parse `Consumes`/`Produces` or build a new graph.

- [ ] **Step 4: Run focused and dependent tests**

Run:
```bash
bun run vitest run tests/core/dependency-analyzer.test.ts tests/hooks/plan-bridge.test.ts
bun run typecheck
```

Expected: PASS; existing legacy dependency behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/core/dependency-analyzer.ts tests/core/dependency-analyzer.test.ts
git commit -m "fix: serialize unknown plan dependencies"
```

---

### Task 4: Apply routing ownership and full task contract in PlanBridge

**Files:**
- Modify: `src/hooks/plan-bridge.ts`
- Test: `tests/hooks/plan-bridge.test.ts`
- Test: `tests/hooks/plan-bridge-implement.test.ts`
- Regression test: `tests/hooks/plan-bridge-authorization.test.ts`

**Interfaces:**
- Consumes from Task 1: `PlanTask.rawBody`.
- Consumes from Task 2: `resolveTaskIdFromToolInput()`, `resolveOmoContinuationTaskId()`, and non-destructive `normalizeTaskToolInput()`.
- Consumes from Task 3: `getParallelizable()` returns a single candidate in conservative mode, automatically suppressing `Parallel:` guidance.
- Update private method to exact signature:
  `buildTaskPrompt(task: PlanTask, callerPrompt?: string, previousLearnings?: string): string`.
- Routing ownership rule: presence of a string `subagent_type` means caller-owned routing; Justice must not add/replace `category` in that invocation.

- [ ] **Step 1: Write RED worker-prompt tests**

Add assertions proving injected delegation context contains:
- `**TASK CONTRACT FROM APPROVED PLAN**`;
- the selected task's complete `rawBody`, including `**Interfaces:**`, signature/test text, verification command, and expected output;
- caller prompt only as secondary context;
- previous learnings after the approved contract.

Also assert no `Parallel:` section appears for a plan in conservative dependency mode.

- [ ] **Step 2: Write RED wire-routing tests**

Update/add `handlePreToolUse` tests for:
- fresh Justice-managed invocation → `category: "sp-implementation"`, no `task_id`;
- Justice-managed continuation with `task_id: "ses_abc"` → category retained and `task_id: "ses_abc"`;
- incoming `task_id: "task-1"` may validate the selected Justice task internally but is absent from modified OmO args;
- unknown incoming `task_id` is absent from modified args;
- `subagent_type: "general"` → preserved and no Justice category added;
- `subagent_type: "explore"` → preserved and no Justice category added;
- caller-owned `subagent_type` plus an incoming category → preserve caller fields; do not replace with Justice category;
- unauthorized caller-owned invocation → existing unauthorized directive, no modified payload.

Replace current tests that explicitly expect `task_id: "task-1"`.

- [ ] **Step 3: Run PlanBridge tests and confirm RED**

Run:
```bash
bun run vitest run tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-implement.test.ts tests/hooks/plan-bridge-authorization.test.ts
```

Expected: FAIL on the current synthesized logical `task_id`, stripped `subagent_type`, and checkbox-only task prompt behavior.

- [ ] **Step 4: Make the approved task body primary in `buildTaskPrompt`**

Implement:

```ts
private buildTaskPrompt(
  task: PlanTask,
  callerPrompt?: string,
  previousLearnings?: string,
): string
```

Required section order:
1. `**TASK CONTRACT FROM APPROVED PLAN**`
2. `task.rawBody`
3. optional `**CALLER CONTEXT**`
4. `**JUSTICE EXECUTION CONSTRAINTS**`
5. optional `**PREVIOUS LEARNINGS**`

Keep the current constraints against out-of-scope changes and skipped tests. Do not regenerate the approved task from checkbox descriptions.

Ensure both Message-triggered and PreToolUse-triggered delegation paths use this same prompt contract.

- [ ] **Step 5: Split caller-owned and Justice-managed routing in PreToolUse**

After authorization/fingerprint checks and task selection:
- determine `callerOwnedRouting = typeof toolInput.subagent_type === "string"`;
- normalize aliases/skills and task-ID semantics;
- when caller-owned, preserve `subagent_type` and do not add or overwrite `category`;
- when Justice-managed, preserve current task-derived `category` behavior;
- in both modes, emit `task_id` only when `resolveOmoContinuationTaskId()` returns `ses_...`;
- continue using `resolveTaskIdFromToolInput()` only to validate an explicitly requested Justice logical task.

Do not weaken implementation-arm or durable authorization checks.

- [ ] **Step 6: Run PlanBridge and authorization regressions**

Run:
```bash
bun run vitest run tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-implement.test.ts tests/hooks/plan-bridge-authorization.test.ts
bun run typecheck
```

Expected: PASS with caller-owned routing preserved and no Justice logical task ID on OmO wire args.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/plan-bridge.ts tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-implement.test.ts tests/hooks/plan-bridge-authorization.test.ts
git commit -m "fix: bridge Superpowers tasks to OmO safely"
```

---

### Task 5: Verify the complete bridge and record real-host evidence

**Files:**
- Create: `docs/reports/2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-smoke.md`
- Modify only if verification exposes a bridge defect: files owned by Tasks 1–4 and their corresponding tests.

**Interfaces:**
- Consumes: all Task 1–4 behavior.
- Produces: sanitized evidence that the supported OpenCode V1 host accepts the patched Justice v4 bridge with Superpowers v6.4.2 and OmO v4.19.4.

- [ ] **Step 1: Run the complete deterministic repository verification**

Run:
```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

Expected:
- all four commands exit 0;
- TypeScript reports no errors;
- Vitest reports no failing tests;
- ESLint reports 0 errors;
- production bundle builds successfully.

- [ ] **Step 2: Confirm the supported host version and local plugin health**

Run:
```bash
opencode --version
./dist/runtime/doctor-cli.js doctor
```

Expected:
- OpenCode reports `1.18.29`;
- doctor exits 0 for the supported host/configuration under test.

If the environment cannot provide OpenCode 1.18.29, record `SETUP / UPSTREAM BLOCKED — real-host capability not evaluated` and do not reinterpret that as a Justice capability failure.

- [ ] **Step 3: Run one narrow real-host fresh-delegation smoke**

In the isolated test configuration, pin:
- Superpowers v6.4.2;
- oh-my-openagent v4.19.4;
- the patched local Justice v4 build.

Use an approved test plan containing:
- at least two tasks;
- a real `**Interfaces:**` block;
- a test/assertion line;
- an exact signature;
- `Run:` and `Expected:` lines.

Execute the normal Justice flow:
1. activate the test plan;
2. arm it with `/justice-implement --approved`;
3. trigger a fresh implementation `task()`.

Expected observed result:
- only the first incomplete task is selected;
- OmO accepts the fresh task without a Justice `task-N` continuation ID;
- the worker context contains the complete selected task body;
- no false parallel guidance appears.

- [ ] **Step 4: Run one caller-owned `subagent_type` smoke**

Under the same pinned host, exercise a task invocation using a supported caller-owned `subagent_type` (`general` or `explore`).

Expected observed result:
- the invocation is accepted;
- `subagent_type` is not stripped;
- Justice does not replace it with an `sp-*` category;
- authorization/context behavior remains active.

Do not test broader OmO v5 behavior or expand the compatibility matrix.

- [ ] **Step 5: Write the sanitized smoke report**

Create `docs/reports/2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-smoke.md` containing:
- Justice commit SHA under test;
- Superpowers version `v6.4.2`;
- OmO version `v4.19.4`;
- OpenCode version `1.18.29`;
- deterministic verification command outcomes;
- fresh-delegation result;
- caller-owned routing result;
- whether full task-body delivery was observed;
- whether conservative sequential selection was observed;
- final classification: `PASS`, or the exact setup/upstream-blocked classification above.

Never include absolute host paths, credentials, provider secrets, or chat contents.

- [ ] **Step 6: Re-run deterministic verification after any smoke-driven fix**

Run:
```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

Expected: all exit 0.

- [ ] **Step 7: Commit the verification evidence**

```bash
git add docs/reports/2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-smoke.md
git commit -m "docs: record v4 upstream compatibility smoke"
```

If Task 5 required a code fix, commit that fix separately with its owning test before committing the smoke report.
