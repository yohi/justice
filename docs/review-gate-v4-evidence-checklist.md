# Review Gate v4 Contract-Conformance — Evidence Checklist (Tasks 9–20)

Evidence-based review checklist for the
`docs/superpowers/plans/2026-10-09-review-gate-v4-contract-conformance.md`
implementation plan. Each plan task is linked to its durable evidence: the
test files that guard it, the declared test case count per file (counted from
the current branch at the date below), the verification command, and the PR
that carries the change.

**Verification basis (2026-10-16, branch `feature/task-20-real-host-e2e`):
`bun run test` → 222 files passed | 2 skipped (224 files),
3522 tests passed | 7 skipped (3529);
`bun run typecheck` → 0 errors;
`bun run lint` → 0 errors (711 pre-existing-style warnings);
`bun run build` → exits 0.**

## Task evidence table

| Task | Scope (one line) | Evidence (test file · declared cases) | Focused verification command | PR |
| --- | --- | --- | --- | --- |
| 9 | Yielded handoff replay / cross-Gate lineage / recovery cursor + terminal-revoke projection | `tests/core/review-gate/projection.test.ts` (53) · `tests/core/review-gate-projection.test.ts` (20) · `tests/core/review-gate/resume-cursor.test.ts` (17) | `bun run vitest run tests/core/review-gate/projection.test.ts tests/core/review-gate-projection.test.ts tests/core/review-gate/resume-cursor.test.ts` | [#329](https://github.com/yohi/justice/pull/329), follow-ups [#327](https://github.com/yohi/justice/pull/327) [#328](https://github.com/yohi/justice/pull/328) |
| 10 | Durable V2 Git/restore commit intents + exact prepared commit/restore recovery | `tests/runtime/review-gate-git.test.ts` (37) · `tests/integration/review-gate-restart-recovery.test.ts` (24) | `bun run vitest run tests/runtime/review-gate-git.test.ts tests/integration/review-gate-restart-recovery.test.ts` | [#314](https://github.com/yohi/justice/pull/314), recovery follow-up [#315](https://github.com/yohi/justice/pull/315) |
| 11 | Commit-bound semantic lineage resolution + self-review reconciliation | `tests/core/review-gate/lineage.test.ts` (20) · `tests/core/review-gate/agent-protocol.test.ts` (61) | `bun run vitest run tests/core/review-gate/lineage.test.ts tests/core/review-gate/agent-protocol.test.ts` | [#316](https://github.com/yohi/justice/pull/316) |
| 12 | Durable semantic cycle evidence + 6-rule NC1 evaluation | `tests/core/review-gate/cycle-evidence.test.ts` (13) · `tests/core/review-gate/convergence.test.ts` (matrix via `it.each`, 1 declaration) | `bun run vitest run tests/core/review-gate/cycle-evidence.test.ts tests/core/review-gate/convergence.test.ts` | [#317](https://github.com/yohi/justice/pull/317) |
| 13 | Stage-aware deterministic validation + persisted evidence reuse | `tests/core/review-gate/deterministic-validation.test.ts` (50) · `tests/runtime/review-gate-protocol.test.ts` (11) | `bun run vitest run tests/core/review-gate/deterministic-validation.test.ts tests/runtime/review-gate-protocol.test.ts` | [#330](https://github.com/yohi/justice/pull/330) |
| 14 | Two-key NC1 reentry + phase reopen state machine | `tests/core/review-gate/reentry.test.ts` (22) · `tests/core/review-gate/orchestrator.test.ts` (50) | `bun run vitest run tests/core/review-gate/reentry.test.ts tests/core/review-gate/orchestrator.test.ts` | [#332](https://github.com/yohi/justice/pull/332) |
| 15 | Immutable V2 Requirements authority versus independently verified current authority | `tests/core/review-gate/requirements-authority.test.ts` (2) · `tests/runtime/review-gate-requirements.test.ts` (22) · `tests/integration/review-gate-restart-recovery.test.ts` (24, shared) | `bun run vitest run tests/core/review-gate/requirements-authority.test.ts tests/runtime/review-gate-requirements.test.ts` | [#333](https://github.com/yohi/justice/pull/333) |
| 16 | Completed successor + read-only durable approval lookup | `tests/runtime/review-gate-approval.test.ts` (11) · `tests/runtime/review-gate-history.test.ts` (14) · `tests/core/review-gate/history.test.ts` (8) | `bun run vitest run tests/runtime/review-gate-approval.test.ts tests/runtime/review-gate-history.test.ts tests/core/review-gate/history.test.ts` | [#334](https://github.com/yohi/justice/pull/334) |
| 17 | Caller-owned routing (`subagent_type` string/preserve) + host adapter compatibility | `tests/hooks/plan-bridge.test.ts` (64) · `tests/hooks/plan-bridge-review-lock.test.ts` (19) · `tests/runtime/review-gate-query.test.ts` (21) · `tests/integration/review-gate-adapter-orchestration.test.ts` (3) | `bun run vitest run tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-review-lock.test.ts tests/runtime/review-gate-query.test.ts` | [#335](https://github.com/yohi/justice/pull/335) |
| 18 | Production coordinator end-to-end authority wiring | `tests/integration/review-gate-event-sourced-flow.test.ts` (2) · `tests/integration/review-gate-implementation-lock.test.ts` (5) · `tests/runtime/review-gate-scope-admission.test.ts` (14) · `tests/runtime/review-gate-protocol-release-authority.test.ts` (4) · `tests/integration/review-gate-restart-recovery.test.ts` (24, shared) | `bun run vitest run tests/integration/review-gate-event-sourced-flow.test.ts tests/integration/review-gate-implementation-lock.test.ts tests/runtime/review-gate-scope-admission.test.ts` | [#336](https://github.com/yohi/justice/pull/336) |
| 19 | G2 devcontainer production-path negative matrix (N1–N7) | `tests/integration/review-gate-production-path.test.ts` (9) | `bun run vitest run tests/integration/review-gate-production-path.test.ts` | [#337](https://github.com/yohi/justice/pull/337) |
| 20 | G3 real-host E2E entry point + final evidence-based review | `tests/integration/review-gate-real-host.test.ts` (2: full staged gate + unprepared-commit negative) · this checklist | `bun run vitest run tests/integration/review-gate-real-host.test.ts` (with `JUSTICE_REAL_HOST_E2E=1` to execute) | this branch (unmerged at checklist time) |

Declared test counts include `it()`/`test()`/`it.each()` declarations in the
named files; several cases in the shared files cover more than one task, so
the counts are per-file declarations, not unique-contract tallies.

## Devcontainer matrix vs real-host requirements

| Test surface | Requires devcontainer (Bun + native addon) | Requires real host | Opt-in env |
| --- | --- | --- | --- |
| `tests/core/**`, `tests/runtime/**` (unit-style guards, in-memory stores) | No — runs on any POSIX host with Bun | No | none |
| `tests/integration/review-gate-*` (in-memory event store + fake mutation substrate) | No | No | none |
| `tests/integration/review-gate-production-path.test.ts` (Task 19 N1–N7) | Yes (Task 19 G2 matrix — devcontainer negative matrix; durable stores on real disk) | No (no native flock provider; lock manager runs with `provider: null`) | none |
| `tests/integration/review-gate-real-host.test.ts` (Task 20 G3 entry point) | Yes | Yes — Linux x86_64/glibc with `dist/native/index.linux-x64-gnu.node` built (`bun run build:native:review-artifact`); default lock manager resolves the native flock provider; real `git` on PATH | `JUSTICE_REAL_HOST_E2E=1` |
| `tests/integration/review-artifact-linux-host-e2e.test.ts` / `tests/runtime/linux-review-gate-provider-e2e.test.ts` (pinned OpenCode host live E2E) | Yes | Yes — pinned OpenCode 1.18.x + provider credentials | `JUSTICE_RUN_LIVE_HOST_E2E=1` |

## Task 20 acceptance notes (read before claiming G3)

- The new entry point is **skipped by default**: full-suite skip count grows
  by exactly 1 test file (baseline `222 passed | 1 skipped` file tally →
  `222 passed | 2 skipped` with this file) and both cases report `skipped`.
- With `JUSTICE_REAL_HOST_E2E=1` the file executes 2 cases against a real
  temp git repository: the staged Design→Plan gate (real durable disk event
  store, real native flock lock provider, real exact-artifact Git commit,
  durable `COMPLETED_APPROVAL_BINDING`, post-completion implementation
  lock denial) and the unprepared-commit negative (scope-violated prepare +
  fabricated prepared payload rejected fail-closed with zero Git mutation).
- G3 PASS per the plan additionally requires the live OpenCode host cases
  (`JUSTICE_RUN_LIVE_HOST_E2E=1`) plus the plan's FDR-015/016 host-proof
  obligations and the report at
  `docs/reports/2026-10-09-issue-310-review-gate-v4-implementation-verification.md`.
  Until those run on a supported host, record G3 as **NOT CLAIMED**, not PASS.
- Never summarize a skip as PASS: `SKIPPED`/`NOT RUN` stays a blocker.
