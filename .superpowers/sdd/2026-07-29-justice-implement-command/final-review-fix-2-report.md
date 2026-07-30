# Final Review Fix 2 Report

## Status

`DONE_WITH_CONCERNS`

## Implementation Commit

- SHA: `4b15135ed8ffb961228a6c02861699993101a312`
- Subject: `fix(plan-bridge): 実装アームをプランへ束縛する`
- Scope: 19 files, 427 insertions, 100 deletions

## Findings And Changes

### 1. Unarmed `task()` calls received implementation context

`PlanBridge.handlePreToolUse()` now consumes and validates the plan-bound arm
before reading the plan or constructing delegation state. An unarmed or stale
call returns only the `implementation_unauthorized` advisory. It does not read
the plan, build delegation metadata, resolve wisdom or persona data, update
loop/completion state, generate a task ID, add skills, or return a modified
payload.

### 2. Implementation arms were not bound to the active plan lifecycle

The arm stores its normalized plan path and is accepted only while that path
matches the current active plan. Changing or clearing the active plan removes
the arm. Every workflow restart also removes the arm, including a restart with
the same plan path. A successful arm remains single-use and is consumed by the
next eligible `task()` call.

### 3. The adapter mutated tool arguments for advisory-only responses

`OpenCodeAdapter.onToolExecuteBefore()` now updates the prompt and other tool
arguments only when `modifiedPayload.args` exists. Advisory-only responses
therefore preserve the caller's complete argument object, including prompt,
skills, and metadata.

### 4. The re-arm guidance used obsolete command syntax

The implementation-arm-required guidance now uses the supported command:
`/justice-implement --plan <planPath> --approved`.

### 5. Existing authorized flows relied on implicit enrichment

Unit and integration tests now arm explicitly before flows that require plan
context, task IDs, implementation skills, wisdom, reflection, or post-tool
completion processing. New regressions cover unarmed non-mutation, no plan
read or loop update, single-use consumption, plan change/clear invalidation,
same-plan workflow restart invalidation, and adapter-level argument
preservation.

The reflection adapter integration test now injects the repository mock file
system instead of using a shared real temporary directory. This removes the
parallel cleanup race while preserving the adapter-origin reflection flow.

### 6. User and architecture documentation described implicit enrichment

`README.md` and `SPEC.md` now document the required explicit arm, single-use
semantics, plan-bound invalidation, same-plan restart invalidation,
advisory-only unarmed behavior, argument preservation, and the behavior change
from the previous implicit enrichment contract.

## Verification

All format, static analysis, test, and build commands were run inside the
project devcontainer.

### Targeted RED/GREEN

The targeted command was:

```sh
bun run test \
  tests/hooks/plan-bridge-implement.test.ts \
  tests/hooks/plan-bridge.test.ts \
  tests/integration/workflow-bootstrap-flow.test.ts \
  tests/runtime/opencode-adapter.test.ts \
  tests/core/workflow-directives.test.ts
```

- Before implementation, the expected RED result was 41/48 tests passed
  and 7 new regression assertions failed.
- After implementation, all 5/5 files and 48/48 tests passed.

### Quality Gates

- `bun run format`: PASS with exit 0.
- `bun run lint`: PASS with exit 0; 0 errors and 5 warnings.
- `bun run typecheck`: PASS with exit 0.
- `bun run build`: PASS with exit 0.
- `bun run test`: PASS; 127/127 files and 1501/1501 tests passed.
- `bun run test -- --no-file-parallelism`: PASS; 127/127 files and
  1501/1501 tests passed.
- `git diff --check` before the implementation commit: PASS with no output.

## Scope And Invariants

- `src/runtime/validation.ts` was not modified.
- `src/core/**` retains the pure-core import boundary.
- Unauthorized handling remains advisory and non-blocking.
- No database or persistence behavior was introduced.
- The pre-existing untracked `.devcontainer/devcontainer-lock.json` and
  `docs/superpowers/plans/2026-07-29-justice-implement-command.md` were not
  staged or modified.

## Concerns And Decisions

- Lint succeeds but reports five warnings. They are non-blocking and were not
  expanded into unrelated cleanup work.
- LSP diagnostics could not be obtained because the TypeScript language-server
  transport timed out repeatedly. The devcontainer compiler checks passed via
  both `bun run typecheck` and `bun run build`.
- `src/hooks/plan-bridge.ts` and `src/runtime/opencode-adapter.ts` contain 1021
  and 736 nonblank, non-comment lines respectively. Their pre-existing size is
  above the current programming guideline, but splitting these high-blast-
  radius modules was deliberately excluded from this focused authorization
  fix. The production change remains localized to the arm state machine and
  adapter mutation boundary.
- This report was created after the implementation commit so it could include
  the exact implementation SHA. It is intentionally committed separately.
