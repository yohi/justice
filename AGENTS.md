# Justice Plugin — Agent Guidelines

> Runtime instruction guide for AI agents working in this repo. This file is intentionally short — see "Where to look" for everything else. Don't add to it without asking: is this relevant to *every* task here, or just one?

## What this is

Justice is an OpenCode plugin bridging [Superpowers](https://github.com/oh-my-openagent/superpowers) (`plan.md`-driven planning) and [oh-my-openagent](https://github.com/oh-my-openagent) (`task()` execution), plus a parallel v2.0 Quality Control Plane (Observation Log + Gate Engine) that observes tool/message events and produces non-blocking (L0 advisory) quality verdicts. Full architecture, data model, hook routing, and directory/component map: **[SPEC.md](./SPEC.md)**.

## Environment

- Runtime is **Bun**, not Node/npm — use `bun run <script>`, not `npm run`.
- **Repository development** (building/editing this repo itself): `bun run lint` / `typecheck` / `format` / `test` / `build` must run **inside the Devcontainer** (`.devcontainer/`), never on the host.
- **Source-based user setup** (building the plugin from this repo for personal use): `bun install` and `bun run build` may run outside the Devcontainer, but CI-grade checks should still use the Devcontainer for reproducibility.

## Non-negotiable invariants

These are architectural, not stylistic — breaking them corrupts the design, not just the vibe. If a change seems to require breaking one, stop and ask first.

- **Pure Core**: `src/core/**` (including `src/core/v2/`) never imports `@opencode-ai/*`. Business logic lives in `src/core/`; `src/hooks/` only coordinates and delegates to it.
- **Fail-Open**: every hook/adapter boundary wraps I/O and notifier calls in `try/catch` and degrades to `PROCEED` — never crash a session.
- **Immutable state**: `readonly` / `ReadonlyArray` / `ReadonlyMap` everywhere; never mutate. (Exception: a class's own private internal state — e.g. `WisdomStore`'s/`SessionStateProvider`'s internal `Map`/array fields — may be mutable as an established precedent, provided the public API returns only already-resolved immutable values. This is not a license to introduce new mutable public state.)
- **No external DBs**: persistence is JSON flat files only (`WisdomPersistence`, `ObservationLogStore`), written atomically (temp file + rename).
- **Single public tool**: only `justice_review` is registered via `OpenCodeAdapter.getTools()`. Never register internal dry-run helpers (`justice_status`/`justice_gate`) as tools — they must stay unreachable from outside the trust boundary (design decision D50).
- **`declared` evidence never satisfies a Gate PASS**: only `observed`/`derived` provenance can (`src/core/v2/rule-evaluation-engine.ts`, fitness function FF-008).
- **Workflow bootstrap stays advisory, not executive**: `PlanBridge.handleWorkflowStart()` (triggered by the OpenCode `command.execute.before` hook, `/justice-start`) must never call `task()` or invoke a skill itself — it only returns guidance text for the agent's next action.
- **Fallback marker is deliberately unwired**: `parseWorkflowStartFallbackMarker()` exists but is not called from `PlanBridge.handleMessage()`. Don't "fix" this by wiring it in — it's reserved for future cross-harness integration and needs explicit user sign-off first.

## Testing

- Inject mocks; unit tests never touch real disk. See `tests/helpers/mock-file-system.ts` (`createMockFileReader`/`createMockFileWriter`) and `tests/helpers/mock-notifier.ts`.
- To assert on private fields, cast through `unknown` — never `any`.

## Where to look

- **Architecture, data model, hook event routing, full component/directory map**: [SPEC.md](./SPEC.md)
- **Upstream (`oh-my-openagent`) drift sync procedure** (only when bumping retry/error-classification logic): [docs/agents/upstream-drift.md](./docs/agents/upstream-drift.md)
- For current file locations, search the codebase (e.g. `codegraph_explore`, grep) rather than trusting any doc verbatim — paths drift faster than documentation does.
