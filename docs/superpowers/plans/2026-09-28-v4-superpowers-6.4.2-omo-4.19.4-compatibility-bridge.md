# Justice v4 Upstream Compatibility Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Justice v4 execute approved Superpowers v6.4.2 plans safely through OmO v4.19.4 without redesigning the current Justice execution loop.

**Architecture:** Keep the existing PlanParser → DependencyAnalyzer → PlanBridge → OpenCodeAdapter → OmO `task()` flow. Add only four compatibility shims: lossless task-body preservation, two-phase Justice-input/OmO-wire task normalization, caller-owned `subagent_type` routing exclusivity, and conservative sequential fallback for Superpowers `**Interfaces:**` plans. `OpenCodeAdapter` remains the existing runtime boundary; no new subsystem is introduced.

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
- Caller → Justice normalization must preserve `task-N`, `ses_...`, unknown task IDs, `subagent_type`, and `category` until `PlanBridge` has consumed them.
- Justice → OmO wire normalization removes every non-`ses_...` task ID; only `task_id` values beginning with `ses_` may survive.
- A valid string `subagent_type` owns routing and requires final OmO `category` to be absent.
- For authorized task dispatch, the Justice-built `modifiedPayload.args.prompt` is the authoritative final worker prompt and the adapter must not append the original caller prompt again.
- A trimmed, non-fenced line exactly equal to `**Interfaces:**` switches the whole plan to conservative dependency mode.
- In conservative dependency mode, only the first incomplete task is runnable and no parallel guidance is emitted.
- Core code must remain free of `@opencode-ai/*` imports.
- Follow TDD and run all repository verification commands fresh before completion.

## Review Focus

- Fenced examples containing `### Task N:` or `**Interfaces:**` must not alter real task boundaries or dependency mode; Task 1 and Task 3 pin both cases.
- A caller logical `task-N` must survive the adapter's Justice-input phase but disappear before OmO execution; Task 2 pins both sides of the runtime boundary.
- A caller-supplied unknown `task_id` must remain visible to Justice but must not survive final wire normalization; Task 2 pins removal.
- A caller-owned `subagent_type` combined with any `category` must end with `subagent_type` preserved and `category` absent on final OmO args; Task 4 pins the precedence.
- The final worker prompt must contain `rawBody`, caller context exactly once, Justice constraints, and previous learnings in that order; Task 4 pins adapter-level prompt ownership.
- Authorization failure must still return the existing unauthorized directive without creating an authoritative modified task prompt; Task 4 adds the regression.

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
- derive a scan representation that treats CRLF/LF uniformly while retaining offsets into the original `content`;
- track Markdown backtick/tilde fences in that scan representation;
- recognize task headings only while outside a fence;
- record each real task section's start/end offsets in the original `content`;
- assign `rawBody` by slicing the original `content` with those offsets, so original Markdown and line endings are preserved exactly;
- preserve current checkbox parsing, status derivation, and 1-based line-number semantics.

Do not build `rawBody` from a newline-normalized copy.

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

### Task 2: Separate Justice input identity from OmO wire identity

**Files:**
- Modify: `src/core/task-packager.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Test: `tests/core/task-packager.test.ts`
- Test: `tests/runtime/opencode-adapter.test.ts`

**Interfaces:**
- Existing: `resolveTaskIdFromToolInput(toolInput: Readonly<Record<string, unknown>>): string | undefined` continues to expose the caller task identifier to Justice for internal selection/correlation.
- Add: `resolveOmoContinuationTaskId(toolInput: Readonly<Record<string, unknown>>): string | undefined` returns only `task_id ?? taskId` values beginning with `ses_`.
- Add: `normalizeTaskToolInputForJusticeInPlace(toolInput: Record<string, unknown>): void` canonicalizes task aliases/skill aliases needed by Justice without removing `task-N`, unknown task IDs, `subagent_type`, or `category`.
- Add: `normalizeTaskToolInputForOmoWireInPlace(toolInput: Record<string, unknown>): void` performs final wire filtering after Justice has returned: non-`ses_...` task IDs are removed, genuine continuations are canonicalized to `task_id`, and existing unsupported explicit model/agent routing fields are removed.
- Existing `normalizeTaskToolInput()` / `normalizeTaskToolInputInPlace()` remain available for backward compatibility; the runtime bridge must stop using one destructive generic pass for both phases.
- `OpenCodeAdapter.onToolExecuteBefore()` owns Phase A before `JusticePlugin.handleEvent(PreToolUse)` and Phase B after Justice response merge, on both inject and proceed paths.
- `#rememberReviewCategory()` reads routing fields without performing Phase B normalization.

- [ ] **Step 1: Write RED core tests for the two phase contracts**

In `tests/core/task-packager.test.ts`, add tests named:
- `preserves logical and unknown task ids for Justice input normalization`
- `preserves routing fields for Justice input normalization`
- `keeps only ses continuation on OmO wire normalization`
- `removes logical and unknown task ids on OmO wire normalization`

Assertions:
- Phase A preserves `task_id: "task-3"`, `task_id: "opaque-id"`, and `task_id: "ses_abc"`;
- Phase A preserves string `subagent_type` and `category`;
- `resolveOmoContinuationTaskId({ task_id: "ses_abc" }) === "ses_abc"`;
- `resolveOmoContinuationTaskId({ taskId: "ses_abc" }) === "ses_abc"`;
- logical/unknown IDs resolve to no OmO continuation;
- Phase B removes `task-N` / unknown task IDs and preserves exactly `task_id: "ses_abc"`.

- [ ] **Step 2: Write RED adapter integration tests for task-ID stage ordering**

In `tests/runtime/opencode-adapter.test.ts`, drive `OpenCodeAdapter.onToolExecuteBefore()` and spy/stub the Justice `handleEvent` response.

Add tests named:
- `keeps logical task id visible to Justice then removes it from final task args`
- `keeps ses continuation visible to Justice and final OmO args`
- `keeps unknown task id visible to Justice then removes it from final task args`

For the logical case, assert in one test:

```text
caller output.args.task_id == task-1
→ PreToolUse event payload.toolInput.task_id == task-1
→ Justice returns proceed/inject
→ final output.args has no task_id
```

For `ses_abc`, assert both Justice input and final `output.args.task_id` equal `ses_abc`.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:
```bash
bun run vitest run tests/core/task-packager.test.ts tests/runtime/opencode-adapter.test.ts
```

Expected: FAIL because current adapter destructively normalizes before Justice and uses the same normalizer again for final wire output.

- [ ] **Step 4: Implement the phase-specific task normalizers**

Implement the exact helpers in `src/core/task-packager.ts`.

Phase A may canonicalize `taskId` to `task_id` and merge `skills` / `loadSkills` / `load_skills`, but it must not classify a non-`ses_...` ID as invalid yet and must not erase `subagent_type` or `category`.

Phase B:
- deletes `taskId`;
- deletes `task_id` unless `resolveOmoContinuationTaskId()` succeeds;
- writes a successful continuation canonically as `task_id`;
- retains routing exclusivity handling for Task 4;
- retains existing removal of unsupported explicit `agent`, `model`, `provider`, `variant`, `reasoning`, and `fallback_models` fields.

Do not synthesize the Justice logical task ID into `task_id`.

- [ ] **Step 5: Reorder `OpenCodeAdapter.onToolExecuteBefore()` around the two phases**

For `task` calls:
1. call `#rememberReviewCategory()` without destructive normalization;
2. run Phase A;
3. invoke Justice with the Phase A args;
4. apply the Justice response/modified payload;
5. run Phase B exactly once before returning to OpenCode/OmO, including `PROCEED` paths;
6. preserve existing `sp-review` / `sp-final-review` synchronous enforcement after final category resolution.

Do not call Phase B from `#rememberReviewCategory()`.

- [ ] **Step 6: Run focused tests and typecheck**

Run:
```bash
bun run vitest run tests/core/task-packager.test.ts tests/runtime/opencode-adapter.test.ts
bun run typecheck
```

Expected: PASS. Adapter tests prove Justice sees the caller identity before final filtering and OmO receives only a genuine continuation ID.

- [ ] **Step 7: Commit**

```bash
git add src/core/task-packager.ts src/runtime/opencode-adapter.ts tests/core/task-packager.test.ts tests/runtime/opencode-adapter.test.ts
git commit -m "fix: split Justice and OmO task normalization"
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

### Task 4: Enforce routing ownership and final prompt ownership at the runtime boundary

**Files:**
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Test: `tests/hooks/plan-bridge.test.ts`
- Test: `tests/hooks/plan-bridge-implement.test.ts`
- Regression test: `tests/hooks/plan-bridge-authorization.test.ts`
- Runtime integration test: `tests/runtime/opencode-adapter.test.ts`

**Interfaces:**
- Consumes from Task 1: `PlanTask.rawBody`.
- Consumes from Task 2: `resolveTaskIdFromToolInput()`, `resolveOmoContinuationTaskId()`, `normalizeTaskToolInputForJusticeInPlace()`, and `normalizeTaskToolInputForOmoWireInPlace()`.
- Consumes from Task 3: `getParallelizable()` returns a single candidate in conservative mode, automatically suppressing `Parallel:` guidance.
- Update private method to exact signature:
  `buildTaskPrompt(task: PlanTask, callerPrompt?: string, previousLearnings?: string): string`.
- Routing ownership rule: presence of a string `subagent_type` means caller-owned routing.
- Final wire precedence: caller-owned routing preserves `subagent_type` and removes `category`, whether that category came from the caller or Justice.
- Final prompt ownership: for an authorized task inject with `modifiedPayload.args.prompt`, `OpenCodeAdapter` assigns that string directly to `output.args.prompt` and does not append `injectedContext` or the original caller prompt again.

- [ ] **Step 1: Write RED PlanBridge prompt-construction tests**

Add assertions proving the Justice-built task prompt contains, in order:
1. `**TASK CONTRACT FROM APPROVED PLAN**`;
2. the selected task's complete `rawBody`, including `**Interfaces:**`, signature/test text, verification command, and expected output;
3. optional `**CALLER CONTEXT**` with the original caller prompt exactly once;
4. `**JUSTICE EXECUTION CONSTRAINTS**` including the implementation workflow directive;
5. optional `**PREVIOUS LEARNINGS**`.

Also assert no `Parallel:` guidance is generated for a conservative dependency plan.

- [ ] **Step 2: Write RED PlanBridge ownership tests**

Update/add `handlePreToolUse` tests for:
- incoming `task_id: "task-1"` is usable for selected Justice task validation;
- a mismatched logical task ID remains unauthorized;
- string `subagent_type: "general"` / `"explore"` selects caller-owned routing;
- Justice does not add a task-derived category to the modified payload in caller-owned mode;
- Justice-managed mode without `subagent_type` retains the task-derived category;
- unauthorized caller-owned invocation still returns the existing unauthorized directive and no authoritative modified task prompt.

Do not assert final OmO wire absence/presence in PlanBridge unit tests; Task 4 Step 3 owns that at the adapter boundary.

- [ ] **Step 3: Write RED OpenCodeAdapter final-routing and final-prompt tests**

In `tests/runtime/opencode-adapter.test.ts`, add tests named:
- `removes category when caller owned subagent routing is present`
- `keeps Justice category when subagent routing is absent`
- `uses authoritative modified task prompt without duplicating caller prompt`

Assert:

```text
subagent_type="general" + category="sp-implementation"
→ final output.args.subagent_type == "general"
→ final output.args has no category

subagent_type="explore" + caller category
→ final output.args.subagent_type == "explore"
→ final output.args has no category

no subagent_type + Justice category
→ final output.args.category remains
```

For final prompt ownership, stub Justice to return an injected response with `modifiedPayload.args.prompt` containing the approved-contract/caller/constraints/learnings markers. Assert:
- final `output.args.prompt` equals the authoritative modified prompt exactly;
- the original caller prompt occurs exactly once;
- marker indexes satisfy `TASK CONTRACT < CALLER CONTEXT < JUSTICE EXECUTION CONSTRAINTS < PREVIOUS LEARNINGS`;
- `response.injectedContext` is not prepended to that final prompt.

- [ ] **Step 4: Run Task 4 tests and confirm RED**

Run:
```bash
bun run vitest run tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-implement.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/runtime/opencode-adapter.test.ts
```

Expected: FAIL on current checkbox-only prompt construction, category/subagent conflict, and adapter prompt duplication behavior.

- [ ] **Step 5: Make the approved task body primary in `buildTaskPrompt`**

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

Keep the current constraints against out-of-scope changes and skipped tests and include the implementation workflow directive inside the Justice execution constraints. Do not regenerate the approved task from checkbox descriptions.

For authorized PreToolUse delegation, put this complete string into `modifiedPayload.args.prompt`. Message-triggered guidance may reuse the same builder but does not get to duplicate caller context.

- [ ] **Step 6: Enforce caller-owned routing before Phase B**

In `PlanBridge.handlePreToolUse()`:
- determine `callerOwnedRouting = typeof event.payload.toolInput.subagent_type === "string"` from the Phase A input;
- when caller-owned, preserve `subagent_type` and do not inject/replace a Justice category in the modified payload;
- when Justice-managed, preserve current task-derived category behavior;
- continue using `resolveTaskIdFromToolInput()` only for Justice logical task validation.

In Phase B final normalization:
- if a string `subagent_type` exists, delete `category`;
- otherwise preserve the Justice/caller category;
- apply Task 2 continuation filtering.

- [ ] **Step 7: Make modified task prompt authoritative in `OpenCodeAdapter`**

Capture the original caller prompt before Justice dispatch.

After Justice returns:
- merge non-prompt modified args as today;
- if `input.tool === "task"` and `modifiedPayload.args.prompt` is a string, assign it directly to `output.args.prompt` and do not run the legacy `${injectedContext}\n\n${originalPrompt}` merge;
- otherwise retain the existing injected-context merge path for compatibility;
- then run Phase B normalization.

This change is task-specific and must not alter non-task injected-context behavior.

- [ ] **Step 8: Run Task 4 and authorization regressions**

Run:
```bash
bun run vitest run tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-implement.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/runtime/opencode-adapter.test.ts
bun run typecheck
```

Expected: PASS. Adapter-level assertions prove routing exclusivity and caller prompt exactly-once ordering on the final worker prompt.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/plan-bridge.ts src/runtime/opencode-adapter.ts tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-implement.test.ts tests/hooks/plan-bridge-authorization.test.ts tests/runtime/opencode-adapter.test.ts
git commit -m "fix: enforce OmO routing and prompt ownership"
```

---

### Task 5: Verify the complete bridge and record reproducible real-host evidence

**Files:**
- Create: `tests/host/v4-compatibility/verify.ts`
- Create: `docs/reports/2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-smoke.md`
- Modify only if verification exposes a bridge defect: files owned by Tasks 1–4 and their corresponding tests.

**Interfaces:**
- Consumes: all Task 1–4 behavior.
- Consumes: `JUSTICE_HOST_TEST_MODEL=provider/model` and an explicit allowlist of provider credential environment-variable names supplied by the local runner.
- Produces: deterministic adapter evidence for exact final args/prompt plus sanitized real-host evidence that OpenCode 1.18.29 with the exact pinned upstream plugins accepts and executes the bridge.
- Final-wire authority: `tests/runtime/opencode-adapter.test.ts`.
- Real-host authority: runtime acceptance, delegated execution, and sentinel outcomes only; it must not claim visibility of hidden final wire fields.

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

Evidence: record command, exit status, and test summary only.

- [ ] **Step 2: Implement the isolated real-host verifier**

Create `tests/host/v4-compatibility/verify.ts`.

The verifier must:
- require `JUSTICE_HOST_TEST_MODEL`; missing value is setup blocked;
- run `opencode --version` and require exact trimmed output `1.18.29`;
- create a unique OS-temp root and delete it in `finally`;
- create separate `fresh/` and `caller-owned/` workspaces plus isolated `home/`, `xdg-config/`, `xdg-cache/`, and `xdg-data/`;
- forward only `PATH`, the isolated HOME/XDG variables, `JUSTICE_HOST_TEST_MODEL`, and explicitly allowlisted provider credential variables;
- cap captured stdout/stderr at 64 KiB per child process;
- use a 120-second timeout per OpenCode invocation and kill/wait on timeout;
- never print or persist credential values.

Each workspace gets this exact OpenCode V1 plugin contract, with the repository path JSON-escaped at runtime:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "<JUSTICE_REPO>/dist/opencode-plugin.js",
    "oh-my-openagent@4.19.4",
    "superpowers@git+https://github.com/obra/superpowers.git#v6.4.2"
  ],
  "model": "<JUSTICE_HOST_TEST_MODEL>"
}
```

Each workspace also gets project-local `.omo/omo.jsonc`:

```jsonc
{
  "categories": {
    "sp-implementation": {
      "model": "<JUSTICE_HOST_TEST_MODEL>"
    }
  },
  "agents": {
    "explore": {
      "model": "<JUSTICE_HOST_TEST_MODEL>"
    }
  }
}
```

The verifier must read both generated files back and assert the exact three plugin specifiers and exact model string before starting OpenCode. Package/plugin resolution failure is setup/upstream blocked.

- [ ] **Step 3: Write the fixed approved smoke plan and sentinels**

In each workspace create `docs/justice-v4-compat-smoke.md` with at least two tasks. Task 1 must contain:
- a real trimmed non-fenced `**Interfaces:**` line;
- a test/assertion example;
- an exact function signature;
- `Run:` and `Expected:` lines;
- a unique line outside every checkbox description containing `J4C_RAW_BODY_SENTINEL_642_4194`;
- an instruction outside the checkbox summary requiring the delegated implementation worker to create `.justice-host-smoke/raw-body.txt` whose entire content is exactly `J4C_RAW_BODY_SENTINEL_642_4194`.

The checkbox description itself must not contain the sentinel or the target file content, so successful file creation cannot be explained by the legacy checkbox-summary prompt.

Task 2 remains pending so the harness can also verify no Task 2 sentinel appears during Task 1 execution.

- [ ] **Step 4: Run the fresh Justice-managed host case**

From the `fresh/` workspace, with the isolated environment:

Run activation:

```bash
opencode run --auto --format json --model "$JUSTICE_HOST_TEST_MODEL" \
  --command justice-implement -- "--approved --plan docs/justice-v4-compat-smoke.md"
```

Expected:
- exit 0;
- no plugin-load error in captured output;
- the command executes in a newly created root session.

Run execution in the same workspace session:

```bash
opencode run --auto --continue --format json --model "$JUSTICE_HOST_TEST_MODEL" \
  "Use the task tool exactly once to execute the currently approved Justice plan task. Do not implement the task yourself. Do not provide task_id or subagent_type. Follow the injected approved task contract."
```

Expected:
- exit 0;
- at least one successful `task` tool execution is present in JSON event output;
- `.justice-host-smoke/raw-body.txt` exists and its entire content equals `J4C_RAW_BODY_SENTINEL_642_4194`;
- no Task 2 sentinel/file exists;
- no plugin/runtime error invalidates the run.

Evidence: activation exit, execution exit, task-tool-success boolean, raw-body sentinel exact-match boolean, Task-2-not-run boolean. Do not claim exact final `task_id` shape from this host case; Task 2 adapter tests own that proof.

- [ ] **Step 5: Run the caller-owned `subagent_type` host case**

From the independent `caller-owned/` workspace, run the same exact activation command.

Then run:

```bash
opencode run --auto --continue --format json --model "$JUSTICE_HOST_TEST_MODEL" \
  "Call the task tool exactly once with subagent_type=explore, no category, and no task_id. The delegated child must return exactly J4C_SUBAGENT_ACCEPTED_642_4194 and perform no file changes."
```

Expected:
- activation exits 0;
- execution exits 0;
- JSON event output shows a completed `task` invocation rather than an argument-validation failure;
- task output/session result contains `J4C_SUBAGENT_ACCEPTED_642_4194`;
- no plugin/runtime error invalidates the run.

Evidence: activation exit, execution exit, task-tool-success boolean, acceptance-sentinel boolean.

This host case proves OmO/OpenCode accept and execute caller-owned routing under the bridge. The exact final absence of `category` is proven only by `tests/runtime/opencode-adapter.test.ts`.

- [ ] **Step 6: Apply the exact PASS / BLOCKED classification**

Return `PASS` only when all are true:
- `opencode --version === 1.18.29`;
- generated plugin config contains exactly patched local Justice, `oh-my-openagent@4.19.4`, and Superpowers `#v6.4.2`;
- deterministic repository verification passes;
- Task 2/4 adapter integration tests pass;
- fresh activation/execution succeeds and raw-body sentinel matches exactly;
- caller-owned activation/execution succeeds and acceptance sentinel is observed.

If OpenCode 1.18.29, a pinned plugin, `JUSTICE_HOST_TEST_MODEL`, provider access, credentials, or network/package resolution needed for the pinned plugins is unavailable, classify exactly:

```text
SETUP / UPSTREAM BLOCKED — real-host capability not evaluated
```

A deterministic adapter-test failure is a Justice contract failure and must never be downgraded to setup blocked.

- [ ] **Step 7: Write the sanitized smoke report**

Create `docs/reports/2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-smoke.md` with exactly these evidence groups:

```text
Justice commit:
OpenCode version:
Justice plugin source: local dist/opencode-plugin.js
OmO plugin specifier: oh-my-openagent@4.19.4
Superpowers plugin specifier: superpowers@git+https://github.com/obra/superpowers.git#v6.4.2
JUSTICE_HOST_TEST_MODEL configured: YES/NO

Deterministic verification:
- typecheck:
- test:
- lint:
- build:
- adapter task-id boundary tests:
- adapter routing exclusivity tests:
- adapter final-prompt tests:

Fresh delegation:
- activation exit:
- execution exit:
- task accepted:
- rawBody sentinel exact match:
- later task remained unexecuted:

Caller-owned routing:
- activation exit:
- execution exit:
- task accepted:
- acceptance sentinel observed:

Final classification:
PASS / SETUP / UPSTREAM BLOCKED — real-host capability not evaluated / FAIL
```

Do not record absolute host paths, credential values, raw provider configuration, raw prompts/chat, or full model/provider secrets beyond the non-secret model identifier already supplied for the smoke.

- [ ] **Step 8: Re-run deterministic verification after any smoke-driven fix**

Run:
```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

Expected: all exit 0.

- [ ] **Step 9: Commit the verifier and verification evidence**

```bash
git add tests/host/v4-compatibility/verify.ts docs/reports/2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-smoke.md
git commit -m "test: verify v4 upstream compatibility bridge"
```

If Task 5 exposes a code defect, return to the owning Task 1–4 test cycle, commit the fix separately, rerun all deterministic verification, then rerun the host verifier before committing the report.

---
