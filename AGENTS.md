# Justice Plugin — Agent Guide

> This file is loaded for every task. Keep only repository-wide facts, commands,
> and invariants here; place task-specific procedures in the linked documents.

## Purpose

Justice bridges [Superpowers](https://github.com/oh-my-openagent/superpowers)
(`plan.md`-driven planning) and [oh-my-openagent](https://github.com/oh-my-openagent)
(`task()` execution). Its v2.0 Quality Control Plane observes tool/message events and
emits non-blocking (L0 advisory) quality verdicts.

## Run And Verify

- Use **Bun**, not Node/npm: `bun run <script>`.
- When developing this repository, run `lint`, `typecheck`, `format`, `test`, and
  `build` inside `.devcontainer/`, never on the host.
- User installation and source-based setup are documented in [README.md](./README.md).

## Non-Negotiable Invariants

If a change appears to require breaking an invariant, stop and ask first.

- **Pure core**: `src/core/**`, including `src/core/v2/`, never imports
  `@opencode-ai/*`. Hooks coordinate; core owns business logic.
- **Fail-open**: every hook/adapter I/O or notifier boundary catches errors and
  degrades to `PROCEED`; a plugin failure must not crash a session.
- **Immutable public state**: use `readonly`, `ReadonlyArray`, and `ReadonlyMap`.
  A class may mutate only its own private state and must return resolved immutable values.
- **JSON-only persistence**: use atomic temp-file-plus-rename writes; do not add an
  external database.
- **One public tool**: `OpenCodeAdapter.getTools()` exposes only `justice_review`.
  Keep `justice_status` and `justice_gate` behind the trust boundary.
- **Evidence trust**: `declared` provenance never satisfies a Gate PASS; only
  `observed` and `derived` evidence can.
- **Advisory bootstrap**: `/justice-start` guidance never invokes a skill or `task()`.
- **Reserved fallback**: do not wire `parseWorkflowStartFallbackMarker()` into
  `PlanBridge.handleMessage()` without explicit approval.

## Testing

- Inject file-system and notifier mocks; unit tests never access real disk. See
  `tests/helpers/mock-file-system.ts` and `tests/helpers/mock-notifier.ts`.
- When a private field must be inspected in a test, cast through `unknown`, never `any`.

## Progressive Disclosure

- Read [SPEC.md](./SPEC.md) for architecture, contracts, event routing, data models,
  and component locations.
- Read [README.md](./README.md) for installation and user-facing workflow behavior.
- Read [docs/agents/upstream-drift.md](./docs/agents/upstream-drift.md) only when
  changing retry or provider-error classification logic derived from upstream.
- For current code locations and call paths, query the codebase rather than relying on
  documentation: paths change more often than contracts.
