# Task 4b report — admitted genesis publication

## Result

Implemented the `CREATE_GENESIS` admitted generation publication path and the publication operations it invokes. The successor path and coordinator wiring remain unchanged.

- Genesis preparation validates the admission decision, owned pending enrollment, observation frontier, admitted scope membership, and exact V2 `GATE_CREATED` identity.
- The enrollment authority is consumed once under the existing admission-owned installation/scope guard before publication staging. A repeated genesis attempt fails closed.
- Publication bytes, digests, and deterministic publication identity are derived from the validated canonical event and membership. The membership writer head must match the derived shard head.
- The owned witness now reloads its registry under the held guard and uses unlocked prepare, shard-sync, CAS, and recovery helpers without reacquiring scope/Gate locks.
- The genesis regression test now uses a real witness and admission fixture; it checks the returned identity/frontier data, exact staged bytes/digest, and one-time enrollment consumption.

## Files changed

- `src/runtime/review-gate-admission-context.ts`
- `src/runtime/review-gate-event-store.ts`
- `src/runtime/review-gate-publication-record.ts`
- `src/runtime/review-gate-witness-context.ts`
- `src/runtime/review-gate-witness-publication.ts`
- `tests/runtime/review-gate-event-store.test.ts`

## Verification

- Focused RED: `bun run vitest run tests/runtime/review-gate-event-store.test.ts -t "creates one witnessed V2 genesis"` failed at the admitted-publication stub (`review_gate_admitted_publication_not_implemented`).
- Focused GREEN: same command passed (1 passed, 70 skipped).
- Focused file: `bun run vitest run tests/runtime/review-gate-event-store.test.ts` passed (69 passed, 2 expected fail).
- Full suite: `bun run test` passed (3,553 passed, 2 expected fail, 7 skipped; 224 files passed, 2 skipped).
- `bun run typecheck` passed.
- `bun run lint` completed with zero errors and 766 warnings.
- `bun run build` passed.
- `type_check` found no TypeScript errors. LSP reported an unreachable-code hint in `review-gate-event-store.ts` (line 1587), timed out on `review-gate-witness-context.ts`, and returned test diagnostics including unresolved Node built-in types and other typing errors. These did not reproduce in the project-level typecheck.
- `git diff --check` passed.
- Attempting the programming skill's optional checker at `scripts/typescript/check-no-excuse-rules.ts` reported that the file is absent in this worktree.

## Scope and review notes

No Legacy fallback, secondary signer, V1 projection cast, protocol-release activation, successor behavior, coordinator wiring, or commit was added. Build output is generated and not part of the staged source changes. The repository-wide lint warnings remain; no lint errors were reported.

Architectural self-review: the touched modules retain their existing single responsibilities; external event and membership inputs are parsed through their schemas; the new code uses no `any`, assertion escape hatch, or empty catch; publication work reuses the existing unlocked primitives; behavior is locked by the genesis regression test; no logging was introduced. Existing runtime modules are larger than the programming reference's 250-LOC ceiling; this task did not split unrelated existing responsibilities.
