# Justice Plugin — Agent Guidelines

> This document serves as the runtime instruction guide and constraint manual for AI coding agents working on the `justice` codebase.

## 1. Identity & Core Philosophy

You are an expert software engineer specializing in TypeScript, the Bun ecosystem, and hook-first agentic architectures.
Your goal is to maintain and extend the `justice` plugin securely, preserving its stateless, immutable, and fail-open design principles.

---

## 2. Quick Reference DOs and DON'Ts (CRITICAL)

### DON'Ts (Strictly Forbidden)
*   ❌ **NO Business Logic in Hooks**: Never place raw business logic inside files under `src/hooks/`. Hooks must only coordinate flow and delegate logic immediately to `src/core/`.
*   ❌ **NO Unsafe/Blocking File I/O**: Do not use blocking filesystem operations or lock files. Always use atomic persistence (`saveAtomic` via temp file writing + renaming).
*   ❌ **NO State Mutation**: Never mutate objects. All class properties, structures, and arrays must be marked as `readonly` or wrapped in `ReadonlyArray`/`ReadonlyMap` to enforce immutability.
*   ❌ **NO External Databases**: Do not import Postgres, Redis, or other external server-based DB clients. Data persistence is limited to JSON-based flat files using `WisdomPersistence`.
*   ❌ **NO Icon Duplication**: Do not repeat notification emojis (🎯, 🚧, 🔬, 🚨, 💡, 🔁) in prompt text bodies. Keep emojis strictly within the banner generation (`formatBanner`) layer to avoid visual duplication in chat interfaces.

### DOs (Mandatory Practices)
*   ✅ **Maintain Fail-Open Boundaries**: Wrap all file system operations and notification calls (`notifier.notify()`) in `try/catch` blocks. The plugin must degrade gracefully to `PROCEED` responses rather than crashing the session.
*   ✅ **Abstract all File I/O**: Access the file system *only* through the `FileReader` and `FileWriter` interfaces. Inject mocks for all unit testing.
*   ✅ **Respect Persona Isolation**: Ensure Wisdom (learnings) is routed to/from the correct `AgentId` namespace (`atlas`, `hephaestus`, `sisyphus`, `prometheus`) to prevent persona pollution.
*   ✅ **Enforce Strict PostToolUse Merging**: When merging multiple `PostToolUse` hook responses, always use `mergePostToolUseResponses` following these priority rules: `skip` action is absolute; `proceed` + `inject` results in `inject`; multiple `inject` results are concatenated with `\n\n---\n\n`.
*   ✅ **Standardize Banner Structure**: Ensure all generated Markdown banners from `formatBanner` adhere strictly to the 3-line quote layout: `> <icon> **JUSTICE NOTIFICATION** [<title>]` followed by `> <message>` and a trailing empty line.

---

## 3. Architecture Overview

```text
src/
├── core/      — Pure business logic, entirely decoupled from oh-my-openagent (OmO)
├── hooks/     — OmO lifecycle hook implementations and flow control
├── runtime/   — Concrete system runtime components (filesystem, logging adapter)
└── index.ts   — Public API exports
```

### Hook Event Routing

All hook entries map to `JusticePlugin.handleEvent()` and route as follows:

```text
Message          → PlanBridge.handleMessage()
PreToolUse       → PlanBridge.handlePreToolUse()
PostToolUse      → PlanBridge.handlePostToolUse()  (Plan Completion, Prometheus Pivot)
                 → TaskFeedbackHandler.handlePostToolUse()  (Task Checkboxes, Wisdom extraction)
                   * Merged using mergePostToolUseResponses() in JusticePlugin
Event:compaction → CompactionProtector
Event:loop-*     → LoopDetectionHandler
```

---

## 4. Core Component Map

Refer to this directory map before modifying logic or adding features:

| File | Class / Module | Primary Responsibility |
|:---|:---|:---|
| `src/core/types.ts` | — | Readonly type definitions, scopes, and schema shapes |
| `src/core/agent-router.ts` | `AgentRouter` | Assigns optimal agent according to affinity scoreboards and dominant overrides |
| `src/core/plan-parser.ts` | `PlanParser` | Parses Markdown plans (`plan.md`), updates checkboxes and logs error blocks |
| `src/core/task-packager.ts` | `TaskPackager` | Enriches tasks into structured `DelegationRequest` prompts |
| `src/core/trigger-detector.ts` | `TriggerDetector` | Evaluates message content for plan references and delegation triggers |
| `src/core/error-classifier.ts` | `ErrorClassifier` | Classifies failures (syntax, test, loop) and resolves retry thresholds |
| `src/core/feedback-formatter.ts` | `FeedbackFormatter` | Extracts test statistics and output results into structured feedback |
| `src/core/plan-bridge-core.ts` | `PlanBridgeCore` | Pure pipeline processing for plan-to-delegation transformations |
| `src/core/smart-retry-policy.ts` | `SmartRetryPolicy` | Jittered exponential backoffs and prompt context reduction |
| `src/core/task-splitter.ts` | `TaskSplitter` | Formulates plan split proposals on timeout or loop aborts |
| `src/core/wisdom-store.ts` | `WisdomStore` | In-memory persona-isolated wisdom cache with global LRU eviction |
| `src/core/tiered-wisdom-store.ts` | `TieredWisdomStore` | Wires local + global stores; handles auto-routing and deduplication |
| `src/core/secret-pattern-detector.ts` | `SecretPatternDetector` | Filters global promotions for secrets (API keys, home directory paths) |
| `src/core/learning-extractor.ts` | `LearningExtractor` | Extracts wisdom drafts from feedback; includes debug cause detection |
| `src/core/wisdom-persistence.ts` | `WisdomPersistence` | Implements v1→v2 migration and atomic save-atomic persistence |
| `src/core/persona-classifier.ts` | `PersonaClassifier` | Infer appropriate `AgentId` namespace from wisdom categories |
| `src/core/review-rejection-patterns.ts` | — | Frozen RegExp list representing review rejections |
| `src/core/review-rejection-detector.ts` | `ReviewRejectionDetector` | Extracts rejections, summaries, and snippets from reviews |
| `src/core/plan-completion-detector.ts` | `PlanCompletionDetector` | Hybrids skill start indicators (Pre) with result markers (Post) |
| `src/core/justice-notifier.ts` | `JusticeNotifier` | Notification interfaces, level mappings, and banner formatters |
| `src/runtime/node-file-system.ts` | `NodeFileSystem` | Real I/O runtime using `Bun.file` and path traversal guards |
| `src/runtime/opencode-notifier.ts` | `OpenCodeNotifier` | Runtime logger notifier piping directly to `client.app.log` |

---

## 5. Development & Testing Workflow

### Commands
```bash
bun install --frozen-lockfile   # Install dependencies
bun run typecheck               # Typecheck TypeScript (tsc --noEmit)
bun run lint                    # Analyze syntax with ESLint
bun run format                  # Format files using Prettier
bun run test                    # Run all Vitest tests (500+ tests)
bun run build                   # Compile plugin to dist/opencode-plugin.js
```

### Testing Conventions
*   **Decoupled I/O**: Unit tests in `tests/core/` must never touch the disk. Inject mock file readers/writers generated by `createMockFileReader()` / `createMockFileWriter()` from `tests/helpers/mock-file-system.ts`.
*   **Notifier Mocking**: Utilize `createMockNotifier()` from `tests/helpers/mock-notifier.ts` in integration tests to assert notifications and banner shapes.
*   **Testing Private Fields**: If a test needs to verify internal state, cast using `unknown` rather than `any`:
    ```typescript
    // ✅ Recommended
    const internalPending = (detector as unknown as { pendingMap: Map<string, any> }).pendingMap;

    // ❌ Prohibited
    const internalPending = (detector as any).pendingMap;
    ```

---

## 6. Upstream Drift & Maintenance

When the upstream package `oh-my-openagent` updates, review its retry constants and error classification logic. Check these files for updates:
*   `src/core/provider-error-patterns.ts`
*   `src/core/error-classifier.ts`

Ensure any newly introduced transient or configuration error patterns are synced to preserve optimal retry behavior.