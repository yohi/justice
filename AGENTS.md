# Justice Plugin — Agent Guide

> Loaded automatically for every task. Contains repository-wide facts, quick commands, invariants, and development guidelines.

## Overview & Architecture

Justice bridges **Superpowers** (`plan.md`-driven planning) and **oh-my-openagent** (`task()` execution).
Its v2.0 Quality Control Plane observes tool/message events and emits non-blocking (L0 advisory) quality verdicts.

- **Thinking Plane**: Superpowers (`plan.md`, `design.md`) — Desired State
- **Execution Plane**: oh-my-openagent (`task()`) — Actual State
- **Quality Control Plane**: Justice — Quality Arbiter / Desired vs Actual Reconciliation (Observes and evaluates; does not execute)

## Quick Commands

Run all development commands inside `.devcontainer/` using **Bun**:

```bash
bun run test            # Run all unit and integration tests
bun run test:watch      # Run tests in watch mode
bun run typecheck       # Run TypeScript type checker (tsc --noEmit)
bun run lint            # Run ESLint checks
bun run format          # Run Prettier format check
bun run build           # Build production output to dist/
```

## Key Directory Structure

```text
src/
├── core/               # Pure business logic (NO @opencode-ai/* imports)
│   ├── v2/             # v2.0 Quality Control Plane (Observation log, Evidence, Gate engine)
│   └── ...             # Parsers, packagers, classifiers, directives
├── hooks/              # OmO hook handlers (plan-bridge, task-feedback, observation-handler, etc.)
└── runtime/            # Node/OpenCode adapter & runtime I/O (NodeFileSystem, OpenCodeAdapter, etc.)
tests/                  # Unit and integration test suites (using mock FS & notifier)
```

## Non-Negotiable Invariants

If a change appears to require breaking an invariant, **stop and ask first**.

1. **Pure core**: `src/core/**` (including `src/core/v2/`) NEVER imports `@opencode-ai/*`. Hooks coordinate; core owns pure business logic.
2. **Fail-open**: Every hook/adapter I/O or notifier boundary MUST catch errors and degrade to `PROCEED` or a safe fallback. A plugin failure must never crash a session.
3. **Immutable public state**: Use `readonly`, `ReadonlyArray`, and `ReadonlyMap`. Classes mutate only private internal state and return resolved immutable snapshots.
4. **JSON-only persistence**: Use atomic temp-file-plus-rename writes. Do NOT add external databases or binary storage.
5. **One public tool**: `OpenCodeAdapter.getTools()` exposes ONLY `justice_review`. Internal tools (`justice_status`, `justice_gate`) remain behind the trust boundary.
6. **Evidence trust**: `declared` provenance NEVER satisfies a Gate PASS; only `observed` and `derived` evidence can (FF-008).
7. **Advisory bootstrap**: `/justice-start` and `/justice-implement` guidance NEVER invoke a skill or `task()`.
8. **Implementation arm**: `handlePreToolUse` enriches `task()` ONLY when the session is explicitly armed via `/justice-implement` or an equivalent trusted trigger; otherwise it emits `implementation_unauthorized`.
9. **Reserved fallback**: Do NOT wire `parseWorkflowStartFallbackMarker()` into `PlanBridge.handleMessage()` without explicit approval.

## Code Style & Testing Guidelines

- **Mocking**: Unit tests MUST inject file-system and notifier mocks (`tests/helpers/mock-file-system.ts`, `tests/helpers/mock-notifier.ts`). Never access real disk in unit tests.
- **Type Inspection**: When a private field must be inspected in a test, cast through `unknown` (`(obj as unknown as { privateField: T }).privateField`), NEVER `any`.
- **Path Traversal & Safety**: All file path parameters must be validated via `normalizeSafeRelativePath` or `TriggerDetector` before dereferencing.
- **No Secrets**: Never output absolute host paths, API keys, or credentials to logs or persisted files.

## Pre-Completion Verification Checklist

Before declaring any task, bugfix, or feature complete, verify that:

1. [ ] Code compiles without errors: `bun run typecheck`
2. [ ] ESLint checks pass with 0 errors: `bun run lint`
3. [ ] All test suites pass: `bun run test`
4. [ ] Build succeeds: `bun run build`

## Progressive Disclosure & Pointers

- **[SPEC.md](./SPEC.md)**: Full architecture, contracts, event routing, data models, and component specifications.
- **[README.md](./README.md)**: User installation, command syntax (`/justice-start`, `/justice-implement`), and workflow behavior.
- **[docs/agents/upstream-drift.md](./docs/agents/upstream-drift.md)**: Upstream error classification and retry logic rules (read only when modifying error classification).
- **Codebase Query**: For exact function signatures, class locations, and call paths, query the codebase directly rather than relying solely on documentation.
