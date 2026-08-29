# Task 1 Report: Routing core 型定義と RoutingDecision factory

## What I implemented

- `src/core/types.ts` に `ControllerAgent`, `ExecutionRole`, `SpCategory`, `RoutingReason`, `RoutingDecision` を追加しました。
- `src/core/routing-decision.ts` に以下のfactoryを追加しました。
  - `createControllerRoutingDecision`
  - `createWorkerRoutingDecision`
  - `createUnroutedRoutingDecision`
- Workerのrole/categoryペアを検証し、不正な組み合わせは `Invalid routing pair` を含むErrorを送出します。
- 実リポジトリのテスト配置に合わせ、テストは `tests/core/routing-decision.test.ts` に追加しました（brief記載の `tests/unit/core` は本リポジトリには存在しません）。

## Tests and results

- Focused test: `bun run test tests/core/routing-decision.test.ts` — PASS, 1 file / 4 tests.
- Typecheck: `bun run typecheck` — PASS.
- Lint: `bun run lint` — exit 0, 0 errors / 97 warnings. Existing repository warnings remain; the new `routing-decision.ts` has one `security/detect-object-injection` warning at the role map lookup.
- Full test suite: `bun run test` — PASS, 139 files / 1668 tests.
- Build: `bun run build` — PASS, TypeScript compilation and Bun bundle completed.
- LSP diagnostics: no diagnostics for `routing-decision.ts` or its test; `types.ts` only reports the pre-existing deprecated `MessagePayload` hint.

## TDD evidence

### RED

Command:

```text
bun run test tests/core/routing-decision.test.ts
```

Result: FAIL before production implementation because `../../src/core/routing-decision` could not be found. This demonstrated that the test required the missing factory module.

### GREEN

After adding the requested types and factories:

```text
bun run test tests/core/routing-decision.test.ts
```

Result: PASS — 1 test file and 4 tests passed.

## Files changed

- `src/core/types.ts`
- `src/core/routing-decision.ts`
- `tests/core/routing-decision.test.ts`
- `.superpowers/sdd/2026-08-29-justice-routing-core/task-1-report.md`

Unrelated pre-existing untracked files were not modified or staged:

- `REQUIREMENTS_2026-08-19.md`
- `REQUIREMENTS_2026-08-29.md`

## Self-review findings

- Single responsibility: routing decision types live in `types.ts`; factory construction and pair validation live in `routing-decision.ts`.
- Boundary purity: no external or `@opencode-ai/*` imports were added; the core remains pure.
- Variant discrimination: no discriminated-union branching was needed.
- Escape hatches: no `any`, `@ts-ignore`, `@ts-expect-error`, or non-null assertions were added.
- Immutability: all new decision fields are `readonly`; the pair map and sets are readonly-typed.
- Helper scope: the validation helper has a distinct responsibility and is used by the worker factory.
- Tests: all factory behaviors and invalid-pair rejection are covered by the new test and passed.
- File size: `routing-decision.ts` has 42 pure lines and is within the project limit.

## Issues or concerns

- The brief's requested `architecture` pairs (`unspecified-high` and `deep`) were implemented exactly, although `unspecified-high` is a `TaskCategory` and `deep` is valid in both category unions.
- Lint reports a new generic object-injection warning for the specified `validPairs[executionRole]` lookup; this is a warning only and does not fail the lint command. Existing unrelated lint warnings remain.

## Fix Report

### Changes

- Moved execution-role/category definitions to a module-level `ReadonlyMap`, avoiding `Set` allocation on every factory call.
- Changed pair lookup to `get(executionRole)?.has(category) ?? false`, so unknown runtime roles are treated as invalid pairs and produce the intended `Invalid routing pair` error from the factory.
- Added parameterized coverage for all valid pairs, including `deep → deep` and `architecture → unspecified-high/deep`.

### Verification

- `bun run test tests/core/routing-decision.test.ts` — PASS, 1 file / 12 tests.
- `bun run typecheck` — PASS.
- `bun run lint` — exit 0, 0 errors / 96 warnings. The prior routing object-injection warning is gone; remaining warnings are unrelated existing repository warnings.
- LSP diagnostics for changed TypeScript files — no diagnostics.

### TDD evidence

The new parameterized cases were added before the implementation refactor and focused tests passed against the existing valid behavior. The regression fix is exercised by the existing invalid-pair test; the implementation now handles unknown runtime roles through the guarded Map lookup rather than allowing an indexing `TypeError`.

### Self-review

The change is limited to the reviewed routing module and its focused test. The role/category data is immutable by type, allocated once, and the lookup has an explicit fallback. No `@opencode-ai/*` imports, type escape hatches, or unrelated files were changed.
