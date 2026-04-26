<!-- vale Microsoft.Acronyms = NO -->
<!-- vale Google.Acronyms = NO -->

# Justice Plugin

## What This Is

Justice is an OpenCode plugin (hook-first architecture) that bridges
Superpowers (declarative planning via Markdown) with oh-my-openagent
(event-driven execution).

## Architecture

```text
src/
├── core/      — Pure business logic, no OmO dependency
├── hooks/     — OmO lifecycle hook implementations
├── runtime/   — Real filesystem implementation (NodeFileSystem)
└── index.ts   — Public API exports

tests/
├── core/       — Unit tests mirroring src/core/
├── hooks/      — Hook integration tests
├── integration/ — End-to-end flow tests
├── runtime/    — Filesystem tests (real tmpdir)
└── helpers/    — Shared mock factories (mock-file-system.ts)
```

## Key Patterns

- All core classes are **stateless** where possible.
- Hooks delegate to core logic immediately; no business logic in hooks.
- All types are `readonly` to enforce immutability.
- Error classification uses pattern-matching rules.
- I/O is abstracted via `FileReader` / `FileWriter` interfaces for testability.
- `JusticePlugin` is the single orchestrator — wires all hooks with a shared `TieredWisdomStore` (project-local + user-global).
- Wisdom writes use **atomic (temp + rename)** persistence to ensure integrity without locking.

## Commands

```bash
bun run test          # Run all tests (201 tests)
bun run test:watch    # Watch mode
bun run typecheck     # tsc --noEmit
bun run lint          # ESLint
bun run format        # Prettier
bun run build         # Build to dist/
```

---

## Implementation Guide for AI Agents

### Core Component Map

| File | Class | Responsibility |
|------|-------|---------------|
| `src/core/types.ts` | — | All shared type definitions |
| `src/core/agent-router.ts` | `AgentRouter` | Determine optimal agent based on affinity, context multipliers, and overrides |
| `src/core/plan-parser.ts` | `PlanParser` | Parse `plan.md` → `PlanTask[]`; update checkboxes |
| `src/core/task-packager.ts` | `TaskPackager` | `PlanTask` → `DelegationRequest`; embeds `AGENT` (Agent Identifier Header) section via `AgentRouter` |
| `src/core/trigger-detector.ts` | `TriggerDetector` | Detect plan reference + delegation intent in messages |
| `src/core/error-classifier.ts` | `ErrorClassifier` | Classify errors; determine retry eligibility |
| `src/core/provider-error-patterns.ts` | — | regex patterns for provider-side errors (Rate Limit, Quota, etc.) |
| `src/core/feedback-formatter.ts` | `FeedbackFormatter` | Parse raw `task()` output → `TaskFeedback` |
| `src/core/plan-bridge-core.ts` | `PlanBridgeCore` | Pure logic: plan→delegation pipeline |
| `src/core/smart-retry-policy.ts` | `SmartRetryPolicy` | Exponential backoff + context reduction |
| `src/core/task-splitter.ts` | `TaskSplitter` | Split suggestions for failed/timed-out tasks |
| `src/core/wisdom-store.ts` | `WisdomStore` | In-memory learning store (LRU, max 100 entries) |
| `src/core/tiered-wisdom-store.ts` | `TieredWisdomStore` | Compose local + global wisdom stores; handle routing/merging |
| `src/core/secret-pattern-detector.ts` | `SecretPatternDetector` | Scan for secrets (API keys, home paths) in wisdom entries |
| `src/core/learning-extractor.ts` | `LearningExtractor` | Extract `WisdomEntry` drafts from `TaskFeedback` |
| `src/core/wisdom-persistence.ts` | `WisdomPersistence` | Atomic persistence (`saveAtomic`) via temp + rename |
| `src/core/dependency-analyzer.ts` | `DependencyAnalyzer` | Parse `(depends: task-N)` markers; topological sort |
| `src/core/category-classifier.ts` | `CategoryClassifier` | Auto-select `TaskCategory` by keyword matching |
| `src/core/progress-reporter.ts` | `ProgressReporter` | Progress report generation (%, Markdown, compact) |
| `src/core/status-command.ts` | `StatusCommand` | Programmatic plan status API |
| `src/core/justice-plugin.ts` | `JusticePlugin` | Orchestrator — wires all hooks with `TieredWisdomStore` |
| `src/hooks/plan-bridge.ts` | `PlanBridge` | `Message`/`PreToolUse` event handler; syncs agent state |
| `src/hooks/task-feedback.ts` | `TaskFeedbackHandler` | `PostToolUse` feedback loop |
| `src/hooks/compaction-protector.ts` | `CompactionProtector` | Snapshot plan + wisdom on compaction event |
| `src/hooks/loop-handler.ts` | `LoopDetectionHandler` | Force-abort on loop-detector events, track trial history, escalate to `sisyphus` on failures >= MAX_RETRIES |
| `src/runtime/node-file-system.ts` | `NodeFileSystem` | `Bun.file`-based FS implementation with path sanitization |

### Hook Event Routing

```text
Message          → PlanBridge.handleMessage()
PreToolUse       → PlanBridge.handlePreToolUse()
PostToolUse      → TaskFeedbackHandler.handlePostToolUse()
Event:compaction → CompactionProtector (via JusticePlugin)
Event:loop-*     → LoopDetectionHandler (via JusticePlugin)
```

### Adding New Functionality

1. **New core logic** → add to `src/core/`, write unit tests in `tests/core/`
2. **New hook handler** → add to `src/hooks/`, register in `JusticePlugin.handleEvent()`
3. **New types** → add to `src/core/types.ts`, update `tests/core/types.test.ts`
4. **Export new public API** → add to `src/index.ts`

### Testing Conventions

- Mock `FileReader`/`FileWriter` using `createMockFileReader()` / `createMockFileWriter()` from `tests/helpers/mock-file-system.ts`
- Core logic tests must **not** do any I/O — inject mocks only
- Integration tests live in `tests/integration/` and test multi-component flows
- Use `unknown` casts instead of `any` when accessing private members in tests:

  ```typescript
  // ✅ Preferred
  (obj as unknown as { privateField: Type }).privateField

  // ❌ Avoid
  (obj as any).privateField
  ```

### Error Handling Rules

- All hook handlers must be **fail-open**: wrap file I/O in `try/catch`, always return `HookResponse`
- Use `catch { }` (no bound variable) for error swallowing
- `console.warn` for unexpected but non-fatal conditions

### Type Safety Rules

- Always use discriminated union narrowing before accessing specific payload fields:

  ```typescript
  // ✅ Correct
  const payload = event.payload as CompactionPayload;

  // ❌ Wrong — EventPayload union doesn't have .reason
  event.payload.reason
  ```

- Prefer `readonly` on all interface properties
- Use `Omit<T, "id" | "timestamp">` pattern for draft types (see `WisdomEntry`)

---

## Bun Specific Guidelines

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun run test` (this project uses Vitest) instead of `bun test` directly
- Use `bun install` instead of `npm install` / `yarn install` / `pnpm install`
- Use `bun run <script>` instead of `npm run <script>`
- Bun automatically loads `.env` — do not use `dotenv`
- Prefer `Bun.file` over `node:fs` `readFile`/`writeFile`
- Prefer `import { readFile, writeFile } from "node:fs/promises"` when stdlib is needed

### Testing

Use `bun run test` to run tests (this project uses **Vitest**).

```typescript
import { describe, it, expect } from "vitest";

describe("MyClass", () => {
  it("should do something", () => {
    expect(1).toBe(1);
  });
});
```

### SQLite / Redis / Postgres

This project does not use databases, but if needed:

- `bun:sqlite` for SQLite (not `better-sqlite3`)
- `Bun.sql` for Postgres (not `pg`)
- `Bun.redis` for Redis (not `ioredis`)

### Upstream Drift Tracking

When `oh-my-openagent` releases a new version, review its upstream code:
- `src/hooks/runtime-fallback/constants.ts` (for `RETRYABLE_ERROR_PATTERNS`)
- `src/hooks/runtime-fallback/error-classifier.ts` (for `classifyErrorType`)

If new patterns are added or semantics shift, update the corresponding local files:
- `src/core/provider-error-patterns.ts` (and bump the source version comment at the top)
- `src/core/error-classifier.ts` (if classification logic changes)
