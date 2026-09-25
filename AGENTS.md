# Justice Plugin — Agent Guide

## Overview (WHY & WHAT)

Justice is an OpenCode plugin providing the quality control nervous system that bridges **Superpowers** (`plan.md`-driven planning) and **oh-my-openagent** (`task()` execution) to prevent false completion ("Task Success ≠ Feature Success").

- **Thinking Plane**: Superpowers (`plan.md`, `design.md`) — Desired State
- **Execution Plane**: oh-my-openagent (`task()`) — Actual State
- **Quality Control Plane**: Justice — observes tool/message events and emits non-blocking (L0 advisory) quality verdicts; never executes directly

## Project Structure & Architecture

- `src/core/` — Pure business logic; no `@opencode-ai/*` imports. `src/core/v2/` houses the observation, evidence, and gate engine.
- `src/hooks/` — OmO hook handlers coordinating core logic with plugin lifecycle events.
- `src/runtime/` — Node/OpenCode adapters, storage, and I/O boundaries.
- `native/` — Rust N-API crate for descriptor-relative Linux filesystem operations.
- `tests/` — Unit and integration tests (mocked I/O by default; real-fs suites are designated exceptions).

## Verification & Commands (HOW)

Run all development commands inside `.devcontainer/` using **Bun**. Never rely on manual style checks when deterministic tools exist:

```bash
bun run test        # Unit and integration tests
bun run typecheck   # TypeScript compiler check (tsc --noEmit)
bun run lint        # ESLint (0 errors required)
bun run build       # Production bundle to dist/
```

Before declaring any task complete, run all four commands fresh and ensure they pass with zero errors.

## Non-Negotiable Invariants

Core invariants that must never be broken:

1. **Pure core**: `src/core/**` never imports `@opencode-ai/*`. Hooks coordinate; core owns business logic.
2. **Fail-open**: Hook/adapter I/O and notifier boundaries catch errors and degrade to `PROCEED` or safe fallback. Plugin failure never crashes a session.
3. **Immutable public state**: Use `readonly`, `ReadonlyArray`, and `ReadonlyMap`. Mutate only private internal state; return resolved immutable snapshots.
4. **JSON-only persistence**: Atomic temp-file-plus-rename writes. No external databases or binary storage.
5. **One public tool**: `OpenCodeAdapter.getTools()` exposes only `justice_review`. Internal tools stay behind the trust boundary.
6. **Evidence trust**: `declared` provenance (agent self-claims) never satisfies a Gate PASS; only `observed` and `derived` evidence can (FF-008).
7. **Advisory bootstrap**: `/justice-start` and `/justice-implement` guidance never invokes a skill or `task()`.
8. **Implementation arm**: `handlePreToolUse` enriches `task()` only when explicitly armed via `/justice-implement` or trusted trigger; otherwise emits `implementation_unauthorized`.
9. **Reserved fallback**: Do not wire `parseWorkflowStartFallbackMarker()` into `PlanBridge.handleMessage()` without explicit approval.

## Testing & Safety Rules

- **Mock I/O**: Use injected mocks (`mock-file-system.ts`, `mock-notifier.ts`). Ordinary unit tests never touch real disk.
- **Type safety**: Inspect private fields in tests via `unknown` cast (`(obj as unknown as { field: T }).field`), never `any`.
- **Path safety**: Validate every relative path via `normalizeSafeRelativePath` or `TriggerDetector` before dereferencing.
- **Redaction**: Never output absolute host paths, API keys, or credentials to logs or persisted files.

## Progressive Disclosure (Read When Needed)

To preserve context and instruction budget, consult detailed documentation only when relevant:

- [SPEC.md](./SPEC.md) — Full architecture, data models, event routing, and v2.0 gate engine specifications. Read before design-level or structural changes.
- [README.md](./README.md) — User installation, command syntax (`/justice-start`, `/justice-implement`), and configuration options.
- [docs/agents/upstream-drift.md](./docs/agents/upstream-drift.md) — Upstream error classification and retry policies. Read only when modifying error handling.
- [docs/agents/review-artifact-linux-provider.md](./docs/agents/review-artifact-linux-provider.md) — Linux review artifact provider probe and audit conditions. Read when modifying native I/O or review artifacts.
- For exact signatures and call paths, explore the codebase directly (via CodeGraph or symbol navigation) rather than relying on stale narrative docs.
