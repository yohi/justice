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

The four owned contracts are:

1. **Plan → Justice:** preserve the complete task section.
2. **Justice → OmO:** do not overload OmO `task_id` with Justice logical task identity.
3. **Caller → OmO:** preserve caller-owned `subagent_type`.
4. **Plan ordering:** parallelize only when Justice can prove the dependency contract it understands.

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

### Worker Prompt

The approved task body becomes the primary implementation instruction.

The prompt should preserve Justice execution constraints, but must not replace or summarize the task contract.

Conceptually:

```text
**TASK CONTRACT FROM APPROVED PLAN**

<rawBody>

**JUSTICE EXECUTION CONSTRAINTS**
- ...
```

Previous learnings may still be appended, but they are advisory and cannot replace the approved task contract.

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

When the incoming `task()` includes `subagent_type`, routing is caller-owned.

Justice must:

- keep the authorization gate
- validate the active approved plan as today
- inject approved plan/task context when applicable
- preserve `subagent_type`
- not add or replace `category` merely to force Justice routing
- remove Justice logical `task-N` from OmO wire `task_id`
- preserve only genuine `ses_...` continuation IDs

Justice must not transform:

```ts
task({
  subagent_type: "explore",
  prompt: "..."
})
```

into a category-routed Justice task.

### Normalization Boundary

The implementation should make routing ownership explicit at the point where the PreToolUse payload is normalized.

It is not sufficient merely to remove `subagent_type` from the forbidden-field list while continuing to overwrite category routing unconditionally.

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

For this bridge, a Superpowers-style structured `Interfaces` task contract is treated as such an unknown/richer dependency semantic.

Justice does not parse `Interfaces` into a graph.

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
approved Superpowers plan
        │
        ▼
PlanParser
  - task id/title
  - checkboxes
  - rawBody
        │
        ▼
DependencyAnalyzer
  - known legacy contract → existing graph
  - unknown/rich contract → first incomplete only
        │
        ▼
Justice category classification
        │
        ▼
PreToolUse normalization
  - category preserved/added
  - Justice task-N retained internally
  - OmO task_id omitted
        │
        ▼
OmO task()
        │
        ▼
worker receives raw approved task body
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
task(subagent_type="explore")
        │
        ▼
Justice authorization + approved context
        │
        ├─ preserve subagent_type
        ├─ do not force Justice category
        ├─ remove task-N wire id
        └─ preserve ses_* continuation only
        │
        ▼
OmO/OpenCode caller-owned routing
```

---

## Error and Fallback Behavior

### Plan Read / Authorization Failures

Existing Justice authorization and active-plan failure behavior remains unchanged.

This bridge must not weaken current authorization/fingerprint protection.

### Unknown `task_id`

Unknown non-`ses_...` task IDs are not forwarded.

They do not become Justice logical IDs and do not become OmO continuation IDs.

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
- directly corresponding tests

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

Cover at minimum:

- Justice `task-1` is recognizable internally but absent from OmO wire args
- `ses_...` remains in wire args
- unknown `task_id` is removed
- `subagent_type: "general"` is preserved for caller-owned routing
- `subagent_type: "explore"` is preserved for caller-owned routing

### PlanBridge Tests

Cover at minimum:

- fresh Justice-managed dispatch has Justice category and no OmO `task_id`
- Justice-managed genuine continuation has Justice category plus `task_id: ses_...`
- caller-owned `subagent_type` is preserved
- caller-owned routing is not overwritten with Justice category
- worker context contains the full approved task body
- authorization/fingerprint gating remains in force

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

Perform at least one real-host smoke using:

- patched Justice v4
- Superpowers v6.4.2
- OmO v4.19.4
- the currently supported Justice OpenCode V1 environment

The smoke test is intentionally narrow. It must prove:

1. an approved plan is active;
2. Justice selects the intended task;
3. OmO/OpenCode accepts the task invocation;
4. no Justice `task-N` is misused as OmO continuation `task_id`;
5. caller-owned `subagent_type` remains valid when exercised;
6. the worker receives the full task contract;
7. the delegated task can complete through the existing Justice v4 loop.

This work does not expand the supported OpenCode version matrix.

Sanitized evidence should be retained using the repository's existing evidence conventions where applicable.

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
