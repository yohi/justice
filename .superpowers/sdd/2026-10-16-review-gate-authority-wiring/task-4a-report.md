# Task 4a Report — Admitted V2 Publication Foundation

## Outcome

Added the admitted membership contract and Zod schema, extended `AdmissionOwnedWitness` with the publication method contracts and not-implemented stubs, and added `prepareAdmittedGenerationPublication` to the durable EventStore interface/implementation as a typed stub. Added the requested genesis, successor, and recovery RED cases to `tests/runtime/review-gate-event-store.test.ts`. No publication path was implemented.

The three cases are written with Vitest `it.fails`, so the stubs produce the intended runtime failure while the repository test command reports those failures as expected; this keeps the global test suite green. The focused run reported **68 passed, 3 expected fail**.

## Verification

- `bun run test` — passed: 224 files passed, 2 skipped; 3,552 tests passed, 3 expected fail, 7 skipped.
- `bun run typecheck` — passed (`tsc --noEmit`).
- `bun run lint` — passed with 0 errors and 758 warnings (repository warnings).
- `bun run build` — passed; bundled 435 modules.
- `bun run test -- tests/runtime/review-gate-event-store.test.ts` — passed: 68 tests passed, 3 expected fail.
- `type_check` on `review-gate-event-store.ts` — no TypeScript errors.
- LSP diagnostics on edited source/test files — no errors. An existing informational unreachable-code hint remains in `review-gate-event-store.ts` at the unrelated `readFrontierHash` return/following throw (around line 1572).
- `git diff --check` — passed.

## Scope and constraints

No legacy fallback, second signer, V1 projection cast, `as any`, `@ts-ignore`, empty catch, or commit was added. Changes are staged as requested.
