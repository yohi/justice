# Justice Plugin — Agent Guide

Justice is an OpenCode plugin that bridges **Superpowers** (`plan.md`-driven planning) and **oh-my-openagent** (`task()` execution). Its v2.0 Quality Control Plane observes tool/message events and emits non-blocking (L0 advisory) quality verdicts.

- **Thinking Plane**: Superpowers (`plan.md`, `design.md`) — Desired State
- **Execution Plane**: oh-my-openagent (`task()`) — Actual State
- **Quality Control Plane**: Justice — observes and evaluates; never executes

## Commands

Run all development commands inside `.devcontainer/` using **Bun**:

```bash
bun run test        # Unit and integration tests
bun run typecheck   # tsc --noEmit
bun run lint        # ESLint (0 errors required)
bun run build       # Production output to dist/
```

Before declaring any task complete, run all four commands fresh and confirm they pass.

## Layers

- `src/core/` — pure business logic; `src/core/v2/` is the observation/evidence/gate engine
- `src/hooks/` — OmO hook handlers that coordinate core logic with the plugin lifecycle
- `src/runtime/` — Node/OpenCode adapters and all runtime I/O boundaries
- `tests/` — unit and integration suites with injected mocks; no real disk access

## Non-Negotiable Invariants

If a change appears to require breaking an invariant, stop and ask first.

1. **Pure core**: `src/core/**` never imports `@opencode-ai/*`. Hooks coordinate; core owns business logic.
2. **Fail-open**: every hook/adapter I/O or notifier boundary catches errors and degrades to `PROCEED` or a safe fallback. A plugin failure must never crash a session.
3. **Immutable public state**: use `readonly`, `ReadonlyArray`, and `ReadonlyMap`. Classes mutate only private internal state and return resolved immutable snapshots.
4. **JSON-only persistence**: atomic temp-file-plus-rename writes. No external databases or binary storage.
5. **One public tool**: `OpenCodeAdapter.getTools()` exposes only `justice_review`. Internal tools stay behind the trust boundary.
6. **Evidence trust**: `declared` provenance never satisfies a Gate PASS; only `observed` and `derived` evidence can (FF-008).
7. **Advisory bootstrap**: `/justice-start` and `/justice-implement` guidance never invokes a skill or `task()`.
8. **Implementation arm**: `handlePreToolUse` enriches `task()` only when the session is explicitly armed via `/justice-implement` or an equivalent trusted trigger; otherwise it emits `implementation_unauthorized`.
9. **Reserved fallback**: do not wire `parseWorkflowStartFallbackMarker()` into `PlanBridge.handleMessage()` without explicit approval.

## Testing & Safety Rules

- Inject file-system and notifier mocks (`tests/helpers/mock-file-system.ts`, `tests/helpers/mock-notifier.ts`); unit tests never access real disk.
- Inspect private fields in tests by casting through `unknown` (`(obj as unknown as { field: T }).field`), never `any`.
- Validate every file path parameter via `normalizeSafeRelativePath` or `TriggerDetector` before dereferencing.
- Never output absolute host paths, API keys, or credentials to logs or persisted files.

## Read When Needed

- [SPEC.md](./SPEC.md) — full architecture, contracts, event routing, data models; read before design-level changes.
- [README.md](./README.md) — user installation and command syntax (`/justice-start`, `/justice-implement`).
- [docs/agents/upstream-drift.md](./docs/agents/upstream-drift.md) — upstream error classification and retry rules; read only when modifying error classification.
- For exact function signatures and call paths, query the codebase directly rather than relying on docs.
