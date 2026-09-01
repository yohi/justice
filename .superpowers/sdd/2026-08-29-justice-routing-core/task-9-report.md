# Task 9 Report: PlanBridge payload normalization

## Outcome

Task 9 is complete. `PlanBridge.handlePreToolUse` now uses the new
`PlanBridgeCore.classifyAndBuildWorkerRequest` flow and produces a normalized
OMO task payload with category-based routing.

## Implementation

- Removed the legacy `AgentRouter` and `inferPersonaFromToolInput` dependencies
  from `src/hooks/plan-bridge.ts`.
- Added the exported `enrichTaskToolInput` helper in `src/hooks/plan-bridge.ts`.
- Removed `subagent_type`, `agent`, `model`, `provider`, `variant`, `reasoning`,
  and `fallback_models` from the modified task payload.
- Preserved the caller prompt, task ID, and merged helper skills while adding
  the classified `category`.
- Kept persona selection for internal Wisdom scoping, without emitting persona
  or worker-agent fields on the OMO wire payload.
- Updated Atlas guidance and related integration tests to recommend only the
  OMO category.
- Moved the shared `AGENT_IDS` constant to `src/core/types.ts` and updated its
  consumers.
- Added Superpowers-category retry coverage and normalized completion handling.

## Verification

- `bun run test`: 143 test files passed, 1668 tests passed.
- `bun run typecheck`: passed.
- `bun run lint`: 0 errors, 98 warnings.
- `bun run build`: passed.
- LSP diagnostics for the changed PlanBridge, PlanBridgeCore,
  PlanCompletionDetector, and related tests: no diagnostics.
- `git diff --check`: passed.

## Scope notes

- The existing `src/core/task-packager.ts` enrichment helper remains for its
  existing compatibility tests; `PlanBridge` uses the new category-only helper.
- `REQUIREMENTS_2026-08-19.md` and `REQUIREMENTS_2026-08-29.md` are existing
  untracked files and are intentionally excluded from the commit.

## Review Fix Report

### Findings 1-4

- Preserved a caller-provided `category` in `PlanBridge.enrichTaskToolInput`; the
  classified category is assigned only when the caller did not provide one.
- Restored `RetryPolicyCalculator` to its original `TaskCategory` contract and
  modifiers. `LoopDetectionHandler` now adapts the new classifier output at the
  boundary so the existing escalation behavior remains unchanged.
- Prioritized `final-review` and `review` matches before integration keywords in
  `ExecutionRoleClassifier`.
- Moved forbidden task-field normalization into the shared
  `normalizeTaskToolInput` helper and applied it to both PlanBridge and the
  legacy TaskPackager enrichment helper.

### Finding 5

- This is an intentional breaking change deferred to Task 10. The deleted Task 3
  routing types are not re-exported here; Task 10 will organize the new public
  routing exports (`ControllerAgent`, `ExecutionRole`, `SpCategory`,
  `RoutingDecision`, `RoutingReason`, and related types) and decide the final
  compatibility policy.

### Fix verification

- Focused regression tests: 5 files passed, 68 tests passed.
- `bun run typecheck`: passed.
- `bun run lint`: 0 errors, 97 warnings.
- `bun run test`: 143 test files passed, 1670 tests passed.
- `bun run build`: passed.
- LSP diagnostics were clean for changed production files and most changed
  tests. The existing `loop-handler.test.ts` environment reports unresolved
  Node `process` types, while the project typecheck remains clean.

## Final Whole-Branch Review Fix Report

### Outcome

- Critical finding: fixed. The Adapter now normalizes the final `task` args after
  merging injected payloads, so forbidden routing fields cannot survive the
  runtime boundary.
- Important findings: fixed. Worker routing uses the validated factory,
  `DelegationRequest` has one canonical definition, and the Adapter execution
  path has regression coverage.
- Minor findings: fixed. AgentRouter documentation now describes its
  Controller-only responsibility, and the published `./core` export is tested
  through the package self-reference.

### Major findings from follow-up review

- PlanBridge category consistency: fixed. A regression test verifies that a
  review task's `sp-review` category is identical in the delegation context and
  the modified task payload.
- PlanCompletionDetector call scoping: fixed. Pending skill and completion
  persona state now use the `sessionId:callId` key, preventing unrelated task
  calls in one session from consuming each other's flags.
- ExecutionRoleClassifier false positive: fixed. Review and final-review
  keywords now use word-boundary matching, so `preview release` and
  `final preview` remain implementation tasks.

### Implementation

- `OpenCodeAdapter.onToolExecuteBefore` applies the shared
  `normalizeTaskToolInput` helper to the final `task` payload after merging
  modified arguments. This removes `subagent_type`, `agent`, `model`,
  `provider`, `variant`, `reasoning`, and `fallback_models` at the Adapter
  boundary.
- `PlanBridgeCore.buildWorkerRequest` now calls
  `createWorkerRoutingDecision`. Invalid intentional pairs such as
  `mechanical + sp-integration` still raise `Invalid routing pair`.
- Preserved the existing `CategoryClassifier` compatibility contract by
  translating only its legacy `unspecified-low` fallback to a valid role pair:
  `deep` maps to `deep`, `architecture` maps to `unspecified-high`, and mapped
  roles retain their OMO category.
- Moved the canonical `DelegationRequest` definition to `src/core/types.ts`;
  `TaskPackager`, `PlanBridgeCore`, `PlanBridge`, and the public barrel now use
  that single definition.
- Added Adapter, routing, canonical-type, and package export-map regression
  coverage. Added a `.gitignore` exception so `tests/dist` remains tracked as
  the configured distribution-test location.
- Updated README and SPEC descriptions for the Controller-only AgentRouter
  contract and current delegation payload/export API. The earlier Finding 5
  public-export deferral is resolved by this change.

### Debugging evidence

- The first full-suite run after strict factory integration reproduced four
  failures with `architecture + unspecified-low`.
- The call path was traced from `PlanBridge` through `CategoryClassifier` into
  `PlanBridgeCore`; the failure was caused by treating a legacy classifier
  fallback as an intentional explicit category.
- A focused regression test was added before the compatibility fix, failed with
  the exact invalid-pair error, and passed after the role-compatible fallback
  was introduced.

### Verification

- `bun run test tests/runtime/opencode-adapter.test.ts` — PASS, 1 file / 41 tests.
- `bun run test tests/core/plan-bridge-core.test.ts` — PASS, 1 file / 8 tests.
- `bun run test tests/integration/role-based-wisdom-flow.test.ts` — PASS, 1 file / 4 tests.
- `bun run test:dist` — PASS, 2 files / 10 tests; `@yohi/justice/core` resolved
  through the package self-reference.
- `bun run typecheck && bun run lint && bun run test && bun run build` — PASS:
  typecheck passed, lint 0 errors / 97 warnings, 144 test files / 1681 tests
  passed, and build passed.
- `git diff --check` — PASS.
- LSP diagnostics were clean for changed production files and the new export
  test. Existing diagnostics remain for the deprecated `MessagePayload` hint in
  `src/core/types.ts` and four pre-existing `WorkflowStartResult` fixture
  errors in `tests/runtime/opencode-adapter.test.ts`; project typecheck is
  clean.

### Scope notes

- `REQUIREMENTS_2026-08-19.md` and `REQUIREMENTS_2026-08-29.md` remain existing
  untracked files and are intentionally excluded from the commit.

## Follow-up: OMO canonical wire boundary

The Adapter boundary now distinguishes Justice's internal `DelegationRequest` names from
OMO's task-tool wire names. `taskId`, `loadSkills`, and `runInBackground` are emitted as
`task_id`, `load_skills`, and `run_in_background`; legacy `skills` and camelCase aliases
remain accepted as inputs.

`OpenCodeAdapter.onToolExecuteBefore` normalizes task args in place before any early return
and again after injected args are merged. The original `output.args` object is retained, and
`subagent_type`, `agent`, `model`, `provider`, `variant`, `reasoning`, and `fallback_models`
are removed at the runtime boundary.

PlanBridge also keeps its enriched modified payload canonical, while the internal
`DelegationRequest` remains camelCase. Routing scope and the category-only worker contract
are unchanged.

### Follow-up verification

- `bun run test tests/runtime/opencode-adapter.test.ts` — PASS, 1 file / 43 tests.
- `bun run test tests/runtime/opencode-adapter-v2.test.ts` — PASS, 1 file / 49 tests.
- `bun run test tests/core/plan-completion-detector.test.ts` — PASS, 1 file / 6 tests.
- Affected normalization, PlanBridge, ObservationHandler, and integration tests — PASS,
  5 files / 66 tests.

## Important Findings Follow-up Report

### Status

All four Important findings from the final whole-branch review are fixed.

### Findings

1. Explicit `PlanBridgeCore` categories, including `unspecified-low`, were being
   replaced by role-derived categories.
2. The Controller request return contract was underspecified in the plan and SPEC.
3. Completion detection selected only the first populated skill alias.
4. The SPEC and Task 8 plan contained stale category and Controller API contracts.

### Changes

- `PlanBridgeCore` now preserves every explicit category and maps a category only when
  the caller leaves it undefined. Explicit worker requests remain authoritative in the
  routing decision factory.
- Controller construction is documented and tested as
  `{ controller: ControllerAgent; request: DelegationRequest } | undefined`; its `quick`
  request is explicitly a Controller-path envelope, not a Worker routing result.
- `PlanCompletionDetector` now uses `resolveSkillsFromToolInput`, which merges and
  deduplicates `skills`, `loadSkills`, and `load_skills` in caller order.
- SPEC and Task 8 now describe `SpCategory | TaskCategory`, the current Controller API,
  and `buildControllerRequest`.

### Verification

- Focused routing/completion/packaging tests: 3 files / 23 tests passed.
- `bun run typecheck && bun run lint && bun run test && bun run build`: passed;
  lint 0 errors / 97 warnings, 144 test files / 1686 tests passed, build bundled
  369 modules.

### Concerns

- Existing lint warnings remain unchanged.
- Existing LSP diagnostics remain for the deprecated `MessagePayload` hint and four
  `WorkflowStartResult` test fixtures; project typecheck is clean.

### Contract

No `as any`, `@ts-ignore`, or `@ts-expect-error` was added. The two existing
`REQUIREMENTS_2026-08-19.md` and `REQUIREMENTS_2026-08-29.md` files remain untracked and
are excluded from the commit.
