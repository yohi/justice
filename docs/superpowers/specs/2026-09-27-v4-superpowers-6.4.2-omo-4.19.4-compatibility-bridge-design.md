# Justice v4 Compatibility Bridge for Superpowers v6.4.2 and OmO v4.19.4

**Status:** DESIGN APPROVED — IMPLEMENTATION NOT AUTHORIZED  
**Scope:** Temporary v4 compatibility bridge before Justice v5 major redesign  
**Base:** `master@080bcdb25b192962789ff5d67139e56487381de4`  
**Target upstreams:** Superpowers v6.4.2, oh-my-openagent v4.19.4

## Intent

Justice v5 will be rebuilt as a major update around OmO v5 and the then-current Superpowers contract. This change is not that redesign.

The purpose of this work is to keep the current Justice v4 execution architecture intact and make only the minimum compatibility fixes required for the existing workflow to behave at the intended level with Superpowers v6.4.2 and OmO v4.19.4.

The current Justice v4 execution loop remains authoritative:

1. Superpowers produces a plan.
2. Justice parses the approved plan, selects the next task, applies authorization/gate logic, and prepares delegation context.
3. Justice delegates directly through OmO `task()`.
4. OmO owns agent/model/tool runtime behavior for that delegated task.

This bridge must not pull the Justice v5 redesign forward into v4.

## Success Criteria

The bridge is successful when an approved Superpowers v6.4.2 plan can execute through the existing Justice v4 loop without the following known compatibility failures:

- Justice logical task IDs being sent as OmO continuation `task_id`.
- Justice removing caller-owned `subagent_type` routing.
- Justice reducing a Superpowers task contract to checkbox summaries and dropping task-body semantics.
- Justice incorrectly parallelizing tasks when dependency semantics cannot be proven safe.

A real-host smoke test must demonstrate:

```text
approved Plan
→ Justice selects Task
→ OmO task dispatch succeeds
→ worker receives the full Task contract
→ task completes without task_id/subagent_type protocol breakage
```

## Non-Goals

The following are explicitly deferred to Justice v5 or later work:

- Moving execution authority to Superpowers `subagent-driven-development` or `executing-plans`.
- Integrating the Superpowers progress ledger, rulings, task-start/task-done, or review-package protocol.
- Full Spike / Bounded / Architectural workflow support.
- Reworking Justice/Superpowers review ownership.
- Synchronizing provider fallback/error classification with all OmO v4.19.4 behavior.
- Reworking `writing-plans` completion detection.
- Redesigning doctor/config category authority.
- Adding complete OmO v4.19.4 schema parity such as `artistry`.
- Expanding the supported OpenCode version matrix.
- Building a structured Superpowers `Interfaces` dependency parser.

## Compatibility Constraints

Public Justice v4 behavior must remain backward compatible.

The following external contracts must not be intentionally broken:

- `/justice-start`
- `/justice-implement`
- existing `sp-*` categories
- current configuration format
- existing plan format
- authorization contract
- observation contract
- gate/review artifact contract

Internal behavior may change where required to correct the compatibility defects in this specification.

## Design Principle

Use a narrow boundary-shim approach.

Do not introduce a new Superpowers adapter subsystem or a new OmO protocol layer. The implementation should modify existing boundaries only, so the bridge can be removed or replaced cleanly in Justice v5.

The existing `OpenCodeAdapter` is part of this boundary shim. It is the runtime seam between caller-shaped OpenCode task arguments, Justice's `PreToolUse` contract, and the final OmO-shaped task arguments. This bridge must make that seam explicit rather than treating `task-packager.ts` / `plan-bridge.ts` as if they directly owned the final wire payload.

The five owned contracts are:

1. **Plan → Justice:** preserve the complete task section.
2. **Caller → Justice:** preserve information Justice needs for selection/validation until `PlanBridge` has consumed it.
3. **Justice → OmO:** do not overload OmO `task_id` with Justice logical task identity.
4. **Caller → OmO:** preserve caller-owned `subagent_type` while enforcing OmO's mutually-exclusive routing contract.
5. **Plan ordering:** parallelize only when Justice can prove the dependency contract it understands.

---

## 1. Preserve the Full Approved Task Section

### Problem

The current `PlanParser` extracts:

- task number/title
- checkbox descriptions
- checkbox state

The current `buildTaskPrompt()` therefore sends a summarized task composed primarily of incomplete checkbox descriptions.

Superpowers v6.4.2 places implementation-significant decisions in the task body outside checkbox descriptions, including:

- Interfaces
- test names/assertions
- exact signatures
- exact specification values
- verification commands
- expected output

Dropping those fields can create implementation drift even while Justice believes it is executing the approved plan.

### Contract

Extend `PlanTask` with the exact original task section:

```ts
export interface PlanTask {
  readonly id: string;
  readonly title: string;
  readonly steps: PlanStep[];
  readonly status: PlanTaskStatus;
  readonly rawBody: string;
}
```

`rawBody` is the original Markdown from the real task heading through the line immediately before the next real task heading.

Example:

```markdown
### Task 2: Implement resolver

**Interfaces**
- Consumes: ...
- Produces: ...

**Files:**
- Modify: ...

**Step 1: Write failing test**
...

**Verification**
Run: ...
Expected: ...
```

The body must be preserved without canonicalization or semantic rewriting.

### Fence-Aware Task Boundaries

A heading inside a fenced code block must not start a new task.

For example:

```markdown
### Task 1: Parser

~~~text
### Task 999: example only
~~~

### Task 2: Runtime
```

must produce only Task 1 and Task 2.

The parser's task-boundary semantics should match the existing fence-aware intent already used by `plan-fingerprint.ts`, while worker handoff retains the original text rather than the canonicalized fingerprint body.

### Existing Checkbox Behavior

Checkbox parsing remains in place.

Responsibilities become:

- `steps`: progress/status tracking and checkbox updates.
- `rawBody`: implementation contract delivered to the worker.

No structured parser for `Interfaces`, tests, signatures, verification, or expected output is introduced in this bridge.

### Worker Prompt and Final Prompt Ownership

The approved task body becomes the primary implementation instruction.

For an authorized `task()` delegation, `PlanBridge` owns construction of the **complete final OmO worker prompt**. `OpenCodeAdapter` owns applying that prompt to `output.args.prompt` at the runtime boundary.

The final prompt order is exact:

```text
**TASK CONTRACT FROM APPROVED PLAN**

<rawBody>

**CALLER CONTEXT**

<original caller prompt exactly once, omitted when empty>

**JUSTICE EXECUTION CONSTRAINTS**

<Justice implementation constraints / required workflow directive>

**PREVIOUS LEARNINGS**

<advisory learnings, omitted when absent>
```

The caller prompt must occur exactly once. It must not be appended again after the Justice-built prompt.

To preserve existing non-task behavior, `OpenCodeAdapter` uses the following ownership rule:

- for an authorized `task()` response whose `modifiedPayload.args.prompt` is a string, that value is the authoritative final worker prompt; the adapter assigns it directly and does **not** prepend `injectedContext` or append the original caller prompt;
- for responses without an authoritative modified task prompt, the adapter retains its existing injected-context merge behavior.

`injectedContext` may still carry Justice diagnostic/progress context for the hook response, but it is not concatenated a second time into an authoritative task prompt.

Previous learnings remain advisory and cannot replace or precede the approved task contract.

---

## 2. Separate Justice Task Identity from OmO `task_id`

### Problem

Justice currently uses logical task IDs such as:

```text
task-1
task-2
```

and writes them into the OmO `task_id` argument.

In OmO v4.19.4, `task_id` is a continuation session ID. Supplying `task-1` therefore changes protocol meaning and may cause a fresh delegation to be interpreted as continuation.

### Internal Justice Identity

Justice logical task IDs remain unchanged for internal use, including:

- `DelegationRequest.taskId`
- `DelegationRequest.context.taskId`
- `TaskExecutionRef.taskId`
- progress correlation
- observations
- review correlation
- plan-task selection

This is an internal identity contract and is not an OmO wire identifier.

### Wire Contract

Only a genuine OmO continuation identifier matching:

```text
ses_...
```

may be emitted as `args.task_id`.

Behavior:

| Input `task_id` | Justice meaning | OmO wire |
|---|---|---|
| `task-N` | Justice logical task selection/correlation | remove |
| `ses_...` | genuine OmO continuation | preserve |
| any other value | unsupported/unknown | remove |
| absent | fresh delegation | absent |

A fresh Justice-managed delegation must therefore normally send no `task_id`.

### Selection Compatibility

Existing Justice logic may continue to recognize `task-N` when it is used internally to identify or validate the intended plan task.

That recognition must be separated from wire normalization so that identifying `task-3` does not imply forwarding `task_id: "task-3"` to OmO.

### Runtime Normalization Boundary

`OpenCodeAdapter.onToolExecuteBefore()` is the stage boundary. The two normalization phases have different contracts and must not be collapsed into one destructive generic normalization pass.

#### Phase A — Caller → Justice

Before dispatching `PreToolUse` to Justice:

- task-field aliases may be canonicalized;
- a caller logical `task-N` must remain visible to `PlanBridge`;
- a caller `ses_...` continuation must remain visible;
- an unknown task ID must remain visible until Justice has had the opportunity to classify/validate it;
- `subagent_type` and `category` must remain visible;
- OmO-wire-only filtering must not run.

`#rememberReviewCategory()` must not invoke Phase B as a side effect. It may inspect the caller routing fields, but it cannot erase task identity or routing information before Justice sees the input.

#### Phase B — Justice → OmO Wire

After Justice has returned and any `modifiedPayload.args` have been applied, every `task()` path performs final OmO wire normalization:

- remove Justice logical `task-N`;
- remove any unknown/non-`ses_...` task ID;
- preserve a genuine `ses_...` value canonically as `task_id`;
- enforce the routing exclusivity contract defined below;
- apply any existing Justice wire-level removal of unsupported explicit routing/model fields.

Phase B is the only phase allowed to discard a task ID because it is not a genuine OmO continuation.

The deterministic runtime tests for this boundary must prove:

```text
caller task_id=task-1
→ Justice PreToolUse input still contains task-1
→ selected-task validation can consume task-1
→ final OpenCode output.args contains no task_id

caller task_id=ses_abc
→ Justice PreToolUse input contains ses_abc
→ final OpenCode output.args.task_id == ses_abc

caller unknown task_id
→ Justice sees the caller value
→ final OpenCode output.args contains no task_id
```

---

## 3. Preserve Caller-Owned `subagent_type`

### Problem

`normalizeTaskToolInput()` currently removes `subagent_type` unconditionally.

Superpowers v6.4.2 OpenCode V1 integration can legitimately call OmO/OpenCode task dispatch with values such as:

```text
subagent_type: "general"
subagent_type: "explore"
```

Removing this field can destroy the caller's routing intent or produce an invalid task invocation.

### Ownership Rule

The existence of an active Justice plan does not imply that Justice owns routing for every `task()` call.

Two routing modes must be distinguished.

#### Justice-Managed Routing

When Justice owns the implementation dispatch, existing category-based routing remains in force.

Justice may:

- select the current plan task
- classify the task
- set its existing `category`
- merge required implementation skills
- inject approved plan context

#### Caller-Owned Routing

When the incoming `task()` includes a string `subagent_type`, routing is caller-owned.

Justice must:

- keep the authorization gate
- validate the active approved plan as today
- inject approved plan/task context when applicable
- preserve `subagent_type`
- remove `category` from the final OmO wire payload, whether the category came from the caller or Justice
- never add a Justice category while caller-owned routing is active
- remove Justice logical `task-N` from OmO wire `task_id`
- preserve only genuine `ses_...` continuation IDs

OmO v4.19.4 treats `category` and `subagent_type` as mutually exclusive. If both are present, category routing overrides the requested subagent. Therefore the bridge precedence is intentionally unambiguous:

```text
valid string subagent_type present
→ caller-owned routing
→ preserve subagent_type
→ category absent on final OmO wire
```

Without `subagent_type`, Justice-managed dispatch retains the existing task-derived `category`.

Justice must not transform:

```ts
task({
  subagent_type: "explore",
  prompt: "..."
})
```

into a category-routed Justice task.

### Normalization Boundary

Routing ownership is decided while Justice still sees the Phase A caller input, and routing exclusivity is enforced only during Phase B final-wire normalization.

It is not sufficient merely to remove `subagent_type` from the forbidden-field list while continuing to overwrite category routing unconditionally. It is also invalid to preserve both `subagent_type` and `category` on the final OmO payload.

---

## 4. Conservative Dependency Fallback

### Problem

The current `DependencyAnalyzer` only understands explicit legacy markers in checkbox descriptions:

```text
(depends: task-1)
(depends: task-1, task-3)
```

Superpowers v6.4.2 uses richer task contracts, especially `Interfaces`, that Justice v4 does not fully interpret.

Treating “no legacy `(depends: ...)` marker found” as proof of independence can cause unsafe parallel execution.

### Legacy Contract

Plans that use only dependency semantics Justice already understands continue to use the existing dependency graph and parallelization behavior.

### Rich/Unknown Contract

If a plan contains dependency semantics that Justice v4 does not model safely, Justice must not infer parallelizability.

For this bridge, the exact Superpowers v6.4.2 task marker `**Interfaces:**` is the compatibility signal for such richer dependency semantics. Detection must be fence-aware and must match a trimmed, non-fenced line exactly; arbitrary prose containing the word "Interfaces" must not switch the plan into conservative mode.

If any real parsed task contains that `**Interfaces:**` marker, the plan uses conservative dependency mode. Justice does not parse `Consumes` or `Produces` into a graph in v4.

Instead:

1. retain document order;
2. identify incomplete tasks;
3. allow only the first incomplete task to be selected/runnable;
4. suppress parallel-task guidance.

After that task is completed, the next incomplete task becomes runnable.

### Safety Property

This fallback does not assert that `Interfaces` necessarily means tasks are dependent.

It asserts only:

> Justice v4 cannot prove those tasks independent using its supported dependency contract, therefore it must not parallelize them.

Correctness is preferred over parallel throughput for this temporary bridge.

---

## Data Flow

### Fresh Justice-Managed Delegation

```text
caller task args
        │
        ▼
OpenCodeAdapter — Phase A
  - aliases canonicalized as needed
  - task-N / ses_* / unknown task id still visible
  - subagent_type / category still visible
        │
        ▼
PlanBridge
  - authorization + fingerprint validation
  - PlanParser rawBody
  - DependencyAnalyzer
  - task selection / logical task validation
  - Justice category classification
  - authoritative final task prompt
        │
        ▼
OpenCodeAdapter applies modified payload
        │
        ▼
OpenCodeAdapter — Phase B
  - task-N / unknown task id removed
  - only ses_* may remain as task_id
  - caller-owned subagent_type removes category
  - Justice-managed routing keeps category
        │
        ▼
OmO task()
        │
        ▼
worker receives the final prompt with raw approved task body
```

### Genuine Continuation

```text
Justice internal task-3
caller task_id = ses_abc
        │
        ▼
Justice correlation = task-3
OmO args.task_id = ses_abc
```

### Caller-Owned Subagent Dispatch

```text
task(subagent_type="explore", category=<optional caller value>)
        │
        ▼
OpenCodeAdapter Phase A preserves both fields for Justice
        │
        ▼
Justice authorization + approved context
        │
        ▼
OpenCodeAdapter Phase B
        ├─ preserve subagent_type="explore"
        ├─ remove category unconditionally
        ├─ remove task-N / unknown wire id
        └─ preserve ses_* continuation only
        │
        ▼
OmO caller-owned subagent routing
```

---

## Error and Fallback Behavior

### Plan Read / Authorization Failures

Existing Justice authorization and active-plan failure behavior remains unchanged.

This bridge must not weaken current authorization/fingerprint protection.

### Unknown `task_id`

Unknown non-`ses_...` task IDs may remain visible during Phase A so Justice can classify the caller input, but they are not forwarded to OmO.

They do not become Justice logical IDs and do not become OmO continuation IDs. Phase B removes them from the final wire payload.

### Dependency Ambiguity

Ambiguity fails safe to sequential execution rather than parallel execution.

### Task Body Extraction Failure

The implementation must not silently fall back to checkbox-only delegation if a recognized task exists but its full body cannot be preserved correctly.

The task parser should provide a valid `rawBody` for every parsed real task. Parser-level inconsistencies must be covered by tests rather than hidden by a lossy fallback.

---

## Expected Source Scope

The implementation is expected to remain concentrated around existing modules such as:

- `src/core/types.ts`
- `src/core/plan-parser.ts`
- `src/core/task-packager.ts`
- `src/core/dependency-analyzer.ts`
- `src/hooks/plan-bridge.ts`
- `src/runtime/opencode-adapter.ts`
- directly corresponding tests, including `tests/runtime/opencode-adapter.test.ts`

Exact file scope belongs in the implementation plan after repository-level verification.

Unrelated refactors are out of scope.

---

## Testing Strategy

Implementation must follow TDD.

### PlanParser Tests

Cover at minimum:

- full task section preserved in `rawBody`
- `Interfaces` preserved
- test/assertion text preserved
- signatures preserved
- verification command and expected output preserved
- fenced-code fake task headings ignored
- existing checkbox state/status behavior unchanged
- existing checkbox update behavior unchanged

### Task Normalization Tests

Core helper tests cover the two phase-specific normalization contracts separately:

- Phase A preserves Justice `task-1`, `ses_...`, unknown task IDs, `subagent_type`, and `category` for Justice inspection;
- Phase B removes Justice `task-1` and unknown task IDs;
- Phase B preserves `ses_...`;
- Phase B preserves caller-owned `subagent_type: "general"` / `"explore"`;
- Phase B removes `category` whenever a valid string `subagent_type` is present;
- without `subagent_type`, Justice-managed `category` remains.

### PlanBridge Tests

Cover at minimum:

- fresh Justice-managed dispatch selects/classifies the intended Justice task;
- Justice-managed genuine continuation remains associated with the selected Justice task;
- caller-owned `subagent_type` is recognized as caller-owned routing;
- worker prompt construction contains the full approved task body;
- caller context occurs exactly once in the Justice-built authoritative task prompt;
- authorization/fingerprint gating remains in force.

### OpenCodeAdapter Runtime Boundary Tests

`tests/runtime/opencode-adapter.test.ts` is authoritative for the final wire-shaped task arguments and final prompt.

Cover at minimum:

- caller `task_id=task-1` is visible in the `PreToolUse` event delivered to Justice, but absent from final `output.args`;
- caller `task_id=ses_abc` is visible to Justice and remains exactly `task_id: "ses_abc"` on final `output.args`;
- caller unknown `task_id` is visible to Justice and absent from final `output.args`;
- `subagent_type="general"` plus any category produces final args with `subagent_type="general"` and no `category`;
- `subagent_type="explore"` plus any category produces final args with `subagent_type="explore"` and no `category`;
- no `subagent_type` on a Justice-managed invocation leaves the Justice category on the final wire;
- an authoritative modified task prompt becomes final `output.args.prompt` without adapter re-appending the original caller prompt;
- the final prompt contains `rawBody`, contains caller context exactly once, and preserves the required section order.

### Dependency Tests

Cover at minimum:

- existing legacy `(depends: ...)` behavior is retained
- a plan with richer/unknown dependency semantics selects only the first incomplete task
- after completion, the next incomplete task is selected
- parallel guidance is not emitted in conservative mode

### Regression Verification

At minimum:

```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

Existing tests covering the following must remain passing:

- authorization
- plan fingerprinting
- observations
- review correlation
- `/justice-start`
- `/justice-implement`
- `sp-*` routing

---

## Real-Host Smoke Requirement

Unit and integration tests are necessary but not sufficient because this bridge fixes a wire-contract mismatch across Justice, Superpowers, OmO, and OpenCode.

The proof responsibilities are deliberately split:

```text
deterministic OpenCodeAdapter tests
→ exact final task args and final prompt shape

real-host smoke
→ OpenCode 1.18.29 + OmO 4.19.4 actually accept that contract
→ a delegated worker runs successfully
→ a rawBody-only sentinel proves the approved task body reached the worker
```

The real-host smoke must not claim observation of an internal wire field that the host does not expose. Exact absence/presence of `task_id` / `category` on the final wire is proven by `tests/runtime/opencode-adapter.test.ts`; the host smoke proves runtime acceptance and execution.

### Fixed Host Configuration

The smoke uses an isolated temporary workspace and isolated `HOME` / XDG directories. It requires `JUSTICE_HOST_TEST_MODEL` to contain an already configured `provider/model`; only explicitly allowlisted provider credential environment variables may be forwarded.

The generated OpenCode V1 `opencode.json` pins exactly:

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

The project-local `.omo/omo.jsonc` binds the smoke `sp-implementation` category to the same `JUSTICE_HOST_TEST_MODEL`; no global OmO config is required.

The harness must verify `opencode --version` is exactly `1.18.29` before any capability claim. Failure to resolve a pinned plugin, model, provider, or credential is setup/upstream blocked, not a Justice capability failure.

### Fixed Activation and Execution Method

For each host case, the harness:

1. writes the approved smoke plan into the temporary workspace;
2. builds/loads the patched local Justice plugin from `dist/opencode-plugin.js`;
3. invokes the actual Justice command through OpenCode's v1 command path:

```bash
opencode run --auto --format json --model "$JUSTICE_HOST_TEST_MODEL" \
  --command justice-implement -- "--approved --plan docs/justice-v4-compat-smoke.md"
```

4. continues the same isolated workspace session with `opencode run --continue ...` and a fixed prompt that requests exactly one `task()` delegation.

The fresh-delegation plan places a unique sentinel only in `rawBody` (outside the checkbox summary) and requires the delegated worker to write that exact sentinel to `.justice-host-smoke/raw-body.txt`. Exact file content is the deterministic evidence that the worker received the full approved task contract.

A separate caller-owned case requests exactly one `task()` with `subagent_type="explore"`, no category, and no task ID, and requires the delegated child to return a fixed acceptance sentinel. The harness checks that the task invocation completes and the sentinel is present. Exact routing-field exclusivity remains the responsibility of the adapter integration test.

### PASS / BLOCKED

Real-host PASS requires:

- OpenCode version exactly `1.18.29`;
- both pinned upstream plugin specs resolve/load;
- Justice command activation succeeds;
- fresh delegation completes;
- `.justice-host-smoke/raw-body.txt` contains the exact raw-body sentinel;
- caller-owned `explore` delegation completes and returns the acceptance sentinel;
- no plugin-load/runtime error invalidates either case.

If the environment cannot supply the exact host, pinned plugins, model/provider, or credentials, classify:

```text
SETUP / UPSTREAM BLOCKED — real-host capability not evaluated
```

This work does not expand the supported OpenCode version matrix.

The sanitized report records the Justice commit, exact version/specifier pins, commands and exit statuses, sentinel checks, and the deterministic adapter-test result that owns final-wire proof. It must not include absolute host paths, credentials, raw provider configuration, or chat contents.

---

## Backward Compatibility

This is a v4 compatibility patch, not a workflow migration.

The implementation must preserve existing public behavior unless this specification explicitly changes an internal protocol mistake.

In particular:

- existing Justice logical task IDs remain stable internally;
- existing legacy `(depends: ...)` plans remain supported;
- current commands/categories remain available;
- current authorization and review flows remain authoritative;
- current direct Justice → OmO task execution remains in place.

---

## Deferred v5 Work

Justice v5 should revisit these boundaries from first principles with OmO v5 as a target.

Likely v5 topics include:

- Justice as semantic control plane/gatekeeper rather than execution-protocol reimplementation
- Superpowers execution authority
- durable ledger/ruling integration
- semantic Spec → Plan → execution → evidence reconciliation
- native Superpowers task briefs/review packages
- OmO v5 routing/session contract
- richer dependency/interface semantics
- explicit workflow-mode support
- redesigned doctor/config authority
- versioned upstream compatibility/provenance

Nothing in this bridge should make those future boundaries harder to replace.

## Review Focus

Review this bridge primarily for:

1. accidental expansion into Justice v5 scope;
2. any remaining path that can put `task-N` into OmO wire `task_id`;
3. any path that still strips or overwrites caller-owned `subagent_type`;
4. any worker handoff that can lose approved task-body semantics;
5. any dependency ambiguity that can still produce unsafe parallel execution;
6. regressions to existing Justice v4 authorization/gate/review behavior.
