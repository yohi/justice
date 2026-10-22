# Task 7 Part B — Approved Design authority wiring

## Changes

- Plan-phase caller operations now request an approved Design read binding while holding the scope-admission lease. Missing admission, workspace identity, or verified binding rejects preparation before a dispatch intent is published.
- Prepared recovery records now persist the bounded binding. Because the record is content-addressed, its recovery digest and the existing V2 `inputBindingDigest` cover the binding; the existing digest contract remains unchanged.
- Executing a recovered Plan operation restores the stored binding to the session and includes the binding plus its durable recovery digest in the task operation payload. Plan execution blocks if the prepared record has no binding.
- Recovery storage remains the existing immutable byte CAS; no parallel store or schema was added there.

## Verification

- Focused coordinator, recovery-store, scope-admission, and implementation-lock suites: **47 passed**.
- `bun run test`: **3581 passed, 2 expected failures, 7 skipped** (226 files passed, 2 skipped).
- `bun run typecheck`: passed.
- `bun run lint`: passed with **775 warnings, 0 errors**.
- `bun run build`: passed.

## Scope note

No PlanBridge mediation or scoped query facade was added (Task 7 Part C remains out of scope). Recovery uses the existing content-addressed store contract; bindings are carried in the prepared-operation record and restored by the coordinator.
