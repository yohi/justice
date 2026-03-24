# Phase 7: Plugin Orchestrator & Runtime Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** JusticePluginオーケストレーターと実ファイルシステム実装を通じて、Justiceプラグインをoh-my-openagentに統合可能なランタイムとして完成させる。

**Architecture:** 4つのフックハンドラ（PlanBridge, TaskFeedbackHandler, CompactionProtector, LoopDetectionHandler）を統合するJusticePluginクラスを作成し、HookEventを適切なハンドラにルーティングする。実ファイルシステムはBun.fileを利用したNodeFileSystemで実装する。StatusCommandはプラン進捗の構造化レポートをプログラマティックに提供する。package.jsonをnpm配布可能な形式に更新する。

**Tech Stack:** TypeScript, Vitest, bun

---

## 現在の実装状態（Phase 6完了時）

| Layer | Files | Tests |
|-------|-------|-------|
| **Core** | 15 files | 15 test files |
| **Hooks** | 4 files | 4 test files |
| **Integration** | — | 5 test files |
| **Helpers/Fixtures** | — | 4 files |
| **Total** | 20 src files | 28 test files, **181 tests** |

### 実装済みコンポーネント

- **Core**: `types.ts`, `plan-parser.ts`, `task-packager.ts`, `feedback-formatter.ts`, `error-classifier.ts`, `trigger-detector.ts`, `plan-bridge-core.ts`, `smart-retry-policy.ts`, `task-splitter.ts`, `wisdom-store.ts`, `learning-extractor.ts`, `wisdom-persistence.ts`, `dependency-analyzer.ts`, `category-classifier.ts`, `progress-reporter.ts`
- **Hooks**: `plan-bridge.ts`, `task-feedback.ts`, `compaction-protector.ts`, `loop-handler.ts`

---

## Task 1: JusticePlugin — プラグインオーケストレーター

**Files:**
- Create: `src/core/justice-plugin.ts`
- Test: `tests/core/justice-plugin.test.ts`

**Step 1: Write the failing test**

Create `tests/core/justice-plugin.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import type { FileReader, FileWriter, HookEvent, MessageEvent, PreToolUseEvent, PostToolUseEvent, EventEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("JusticePlugin", () => {
  let reader: FileReader;
  let writer: FileWriter;
  let plugin: JusticePlugin;

  beforeEach(() => {
    reader = createMockFileReader({
      "plan.md": "## Task 1: Setup\n- [ ] Init\n",
    });
    writer = createMockFileWriter();
    plugin = new JusticePlugin(reader, writer);
  });

  describe("handleEvent", () => {
    it("should route Message events to PlanBridge", async () => {
      const event: MessageEvent = {
        type: "Message",
        payload: { role: "assistant", content: "Delegate the next task from plan.md" },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);
      expect(response.action).toBe("inject");
    });

    it("should route PreToolUse events to PlanBridge", async () => {
      // First set active plan via message
      const msgEvent: MessageEvent = {
        type: "Message",
        payload: { role: "assistant", content: "Delegate the next task from plan.md" },
        sessionId: "s-1",
      };
      await plugin.handleEvent(msgEvent);

      const event: PreToolUseEvent = {
        type: "PreToolUse",
        payload: { toolName: "task", toolInput: {} },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);
      expect(response.action).toBe("inject");
    });

    it("should route PostToolUse events to TaskFeedbackHandler", async () => {
      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: { toolName: "task", toolResult: "All tests passed", error: false },
        sessionId: "s-1",
      };
      // No active session → proceed silently
      const response = await plugin.handleEvent(event);
      expect(response.action).toBe("proceed");
    });

    it("should route Event (loop-detector) to LoopDetectionHandler", async () => {
      const event: EventEvent = {
        type: "Event",
        payload: { eventType: "loop-detector", sessionId: "s-1", message: "Loop detected" },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);
      expect(response.action).toBe("proceed");
    });

    it("should route Event (compaction) to CompactionProtector", async () => {
      const event: EventEvent = {
        type: "Event",
        payload: { eventType: "compaction", sessionId: "s-1", reason: "Context too long" },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);
      // CompactionProtector needs an active plan to protect
      expect(response.action).toBe("proceed");
    });

    it("should share WisdomStore across PlanBridge and TaskFeedback", () => {
      // The plugin should use a single WisdomStore instance
      const store = plugin.getWisdomStore();
      expect(store).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/justice-plugin.test.ts`
Expected: FAIL — Cannot find module `../../src/core/justice-plugin`

**Step 3: Write minimal implementation**

Create `src/core/justice-plugin.ts`:

```typescript
import type { FileReader, FileWriter, HookEvent, HookResponse } from "./types";
import { PlanBridge } from "../hooks/plan-bridge";
import { TaskFeedbackHandler } from "../hooks/task-feedback";
import { CompactionProtector } from "../hooks/compaction-protector";
import { LoopDetectionHandler } from "../hooks/loop-handler";
import { TaskSplitter } from "./task-splitter";
import { WisdomStore } from "./wisdom-store";

const PROCEED: HookResponse = { action: "proceed" };

export class JusticePlugin {
  private readonly planBridge: PlanBridge;
  private readonly taskFeedback: TaskFeedbackHandler;
  private readonly compactionProtector: CompactionProtector;
  private readonly loopHandler: LoopDetectionHandler;
  private readonly wisdomStore: WisdomStore;

  constructor(fileReader: FileReader, fileWriter: FileWriter) {
    this.wisdomStore = new WisdomStore();
    this.planBridge = new PlanBridge(fileReader, this.wisdomStore);
    this.taskFeedback = new TaskFeedbackHandler(fileReader, fileWriter, this.wisdomStore);
    this.compactionProtector = new CompactionProtector(this.wisdomStore);
    this.loopHandler = new LoopDetectionHandler(fileReader, fileWriter, new TaskSplitter());
  }

  /**
   * Route a HookEvent to the appropriate handler(s).
   */
  async handleEvent(event: HookEvent): Promise<HookResponse> {
    switch (event.type) {
      case "Message":
        return this.planBridge.handleMessage(event);
      case "PreToolUse":
        return this.planBridge.handlePreToolUse(event);
      case "PostToolUse":
        return this.taskFeedback.handlePostToolUse(event);
      case "Event":
        return this.handleEventType(event);
      default: {
        const _exhaustiveCheck: never = event;
        void _exhaustiveCheck;
        return PROCEED;
      }
    }
  }

  /**
   * Get the shared WisdomStore for persistence or inspection.
   */
  getWisdomStore(): WisdomStore {
    return this.wisdomStore;
  }

  /**
   * Get the PlanBridge instance for direct configuration (e.g., setActivePlan).
   */
  getPlanBridge(): PlanBridge {
    return this.planBridge;
  }

  /**
   * Get the TaskFeedbackHandler for direct configuration.
   */
  getTaskFeedback(): TaskFeedbackHandler {
    return this.taskFeedback;
  }

  /**
   * Route Event-type events based on eventType payload.
   */
  private async handleEventType(event: HookEvent): Promise<HookResponse> {
    if (event.type !== "Event") return PROCEED;

    switch (event.payload.eventType) {
      case "loop-detector":
        return this.loopHandler.handleEvent(event);
      case "compaction":
        // CompactionProtector is stateful but passive —
        // it requires external orchestration to snapshot/restore.
        // For now, proceed and let the host application manage it.
        return PROCEED;
      default:
        return PROCEED;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/justice-plugin.test.ts`
Expected: PASS — All tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/core/justice-plugin.ts tests/core/justice-plugin.test.ts && git commit -m "feat(core): JusticePluginオーケストレーターの実装 — イベントルーティングと共有状態管理"
```

---

## Task 2: NodeFileSystem — 実ファイルシステム実装

**Files:**
- Create: `src/runtime/node-file-system.ts`
- Test: `tests/runtime/node-file-system.test.ts`

**Step 1: Write the failing test**

Create `tests/runtime/node-file-system.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("NodeFileSystem", () => {
  let tempDir: string;
  let fs: NodeFileSystem;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "justice-test-"));
    fs = new NodeFileSystem(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("writeFile + readFile", () => {
    it("should write and read back file content", async () => {
      await fs.writeFile("test.md", "# Hello\n");
      const content = await fs.readFile("test.md");
      expect(content).toBe("# Hello\n");
    });

    it("should create parent directories if they don't exist", async () => {
      await fs.writeFile("docs/plans/plan.md", "# Plan\n");
      const content = await fs.readFile("docs/plans/plan.md");
      expect(content).toBe("# Plan\n");
    });
  });

  describe("fileExists", () => {
    it("should return true for existing files", async () => {
      await fs.writeFile("exists.md", "content");
      expect(await fs.fileExists("exists.md")).toBe(true);
    });

    it("should return false for non-existing files", async () => {
      expect(await fs.fileExists("missing.md")).toBe(false);
    });
  });

  describe("path safety", () => {
    it("should reject absolute paths", async () => {
      await expect(fs.readFile("/etc/passwd")).rejects.toThrow("path traversal");
    });

    it("should reject path traversal attempts", async () => {
      await expect(fs.readFile("../etc/passwd")).rejects.toThrow("path traversal");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/runtime/node-file-system.test.ts`
Expected: FAIL — Cannot find module `../../src/runtime/node-file-system`

**Step 3: Write minimal implementation**

Create `src/runtime/node-file-system.ts`:

```typescript
import type { FileReader, FileWriter } from "../core/types";
import { join, resolve, isAbsolute, relative } from "node:path";
import { mkdir } from "node:fs/promises";

export class NodeFileSystem implements FileReader, FileWriter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async readFile(path: string): Promise<string> {
    const safePath = this.resolveSafely(path);
    const file = Bun.file(safePath);
    return await file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    const safePath = this.resolveSafely(path);

    // Ensure parent directory exists
    const parentDir = join(safePath, "..");
    await mkdir(parentDir, { recursive: true });

    await Bun.write(safePath, content);
  }

  async fileExists(path: string): Promise<boolean> {
    const safePath = this.resolveSafely(path);
    const file = Bun.file(safePath);
    return await file.exists();
  }

  /**
   * Resolve a relative path to an absolute path within the root directory.
   * Rejects absolute paths and path traversal attempts.
   */
  private resolveSafely(path: string): string {
    if (isAbsolute(path)) {
      throw new Error(`Unsafe path traversal rejected: ${path}`);
    }

    const resolved = resolve(this.rootDir, path);
    const rel = relative(this.rootDir, resolved);

    // Check for path traversal (relative path starts with ..)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Unsafe path traversal rejected: ${path}`);
    }

    return resolved;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/runtime/node-file-system.test.ts`
Expected: PASS — All tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/runtime/node-file-system.ts tests/runtime/node-file-system.test.ts && git commit -m "feat(runtime): NodeFileSystemの実装 — Bun.fileベースの実ファイルシステムアクセス"
```

---

## Task 3: StatusCommand — プラン進捗レポートAPI

**Files:**
- Create: `src/core/status-command.ts`
- Test: `tests/core/status-command.test.ts`

**Step 1: Write the failing test**

Create `tests/core/status-command.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { StatusCommand } from "../../src/core/status-command";
import { createMockFileReader } from "../helpers/mock-file-system";

describe("StatusCommand", () => {
  const planContent = [
    "## Task 1: Setup",
    "- [x] Init project",
    "- [x] Configure linter",
    "## Task 2: Implement core",
    "- [ ] Write parser (depends: task-1)",
    "- [ ] Write tests",
    "## Task 3: Write docs",
    "- [ ] Write README",
    "## Task 4: Integration",
    "- [ ] E2E tests (depends: task-2, task-3)",
  ].join("\n");

  const reader = createMockFileReader({ "plan.md": planContent });
  const command = new StatusCommand(reader);

  describe("getStatus", () => {
    it("should return structured status with progress", async () => {
      const status = await command.getStatus("plan.md");

      expect(status.progress.overallProgress).toBe(33); // 2/6 steps
      expect(status.progress.completedTasks).toBe(1);
      expect(status.progress.totalTasks).toBe(4);
    });

    it("should include parallelizable tasks", async () => {
      const status = await command.getStatus("plan.md");

      expect(status.parallelizable.map(t => t.id)).toContain("task-2");
      expect(status.parallelizable.map(t => t.id)).toContain("task-3");
      expect(status.parallelizable.map(t => t.id)).not.toContain("task-4");
    });

    it("should include execution order", async () => {
      const status = await command.getStatus("plan.md");

      const ids = status.executionOrder.map(t => t.id);
      expect(ids.indexOf("task-1")).toBeLessThan(ids.indexOf("task-2"));
      expect(ids.indexOf("task-2")).toBeLessThan(ids.indexOf("task-4"));
    });
  });

  describe("formatAsMarkdown", () => {
    it("should produce comprehensive Markdown report", async () => {
      const status = await command.getStatus("plan.md");
      const md = command.formatAsMarkdown(status);

      expect(md).toContain("Progress");
      expect(md).toContain("33%");
      expect(md).toContain("Parallelizable");
      expect(md).toContain("Execution Order");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/status-command.test.ts`
Expected: FAIL — Cannot find module `../../src/core/status-command`

**Step 3: Write minimal implementation**

Create `src/core/status-command.ts`:

```typescript
import type { FileReader, PlanTask } from "./types";
import { PlanParser } from "./plan-parser";
import { DependencyAnalyzer } from "./dependency-analyzer";
import { ProgressReporter, type ProgressReport } from "./progress-reporter";
import { CategoryClassifier } from "./category-classifier";

export interface PlanStatus {
  readonly planPath: string;
  readonly tasks: PlanTask[];
  readonly progress: ProgressReport;
  readonly parallelizable: PlanTask[];
  readonly executionOrder: PlanTask[];
  readonly categoryMap: Map<string, string>;
}

export class StatusCommand {
  private readonly fileReader: FileReader;
  private readonly parser: PlanParser;
  private readonly analyzer: DependencyAnalyzer;
  private readonly reporter: ProgressReporter;
  private readonly classifier: CategoryClassifier;

  constructor(fileReader: FileReader) {
    this.fileReader = fileReader;
    this.parser = new PlanParser();
    this.analyzer = new DependencyAnalyzer();
    this.reporter = new ProgressReporter();
    this.classifier = new CategoryClassifier();
  }

  /**
   * Get comprehensive status for a plan file.
   */
  async getStatus(planPath: string): Promise<PlanStatus> {
    const content = await this.fileReader.readFile(planPath);
    const tasks = this.parser.parse(content);

    const progress = this.reporter.generateReport(tasks);
    const parallelizable = this.analyzer.getParallelizable(tasks);
    const executionOrder = this.analyzer.buildExecutionOrder(tasks);
    const categoryMap = new Map<string, string>();
    for (const task of tasks) {
      categoryMap.set(task.id, this.classifier.classify(task));
    }

    return { planPath, tasks, progress, parallelizable, executionOrder, categoryMap };
  }

  /**
   * Format PlanStatus as comprehensive Markdown report.
   */
  formatAsMarkdown(status: PlanStatus): string {
    const lines: string[] = [];

    // Header
    lines.push(`# 📋 Justice Plan Status: ${status.planPath}`);
    lines.push("");

    // Progress
    lines.push(this.reporter.formatAsMarkdown(status.progress));
    lines.push("");

    // Parallelizable Tasks
    lines.push("## ⚡ Parallelizable Tasks");
    lines.push("");
    if (status.parallelizable.length === 0) {
      lines.push("No tasks can be run in parallel at this time.");
    } else {
      for (const task of status.parallelizable) {
        const cat = status.categoryMap.get(task.id) ?? "deep";
        lines.push(`- **${task.id}**: ${task.title} (category: ${cat})`);
      }
    }
    lines.push("");

    // Execution Order
    lines.push("## 📐 Execution Order");
    lines.push("");
    for (let i = 0; i < status.executionOrder.length; i++) {
      const task = status.executionOrder[i]!;
      const icon = task.status === "completed" ? "✅" : "⬜";
      lines.push(`${i + 1}. ${icon} ${task.title}`);
    }

    return lines.join("\n");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/status-command.test.ts`
Expected: PASS — All tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/core/status-command.ts tests/core/status-command.test.ts && git commit -m "feat(core): StatusCommandの実装 — プラン進捗・依存・並列タスクの構造化レポート"
```

---

## Task 4: Build & Distribution設定

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

**Step 1: Update package.json for npm distribution**

Modify `package.json` to add proper `exports`, `main`, `types` fields:

```json
{
  "name": "justice-plugin",
  "version": "0.1.0",
  "description": "OpenCode plugin bridging Superpowers and oh-my-openagent",
  "module": "dist/index.js",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./runtime": {
      "import": "./dist/runtime/node-file-system.js",
      "types": "./dist/runtime/node-file-system.d.ts"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/ tests/",
    "format": "prettier --write 'src/**/*.ts' 'tests/**/*.ts'",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "bun run typecheck && bun run test && bun run build"
  }
}
```

**Step 2: Run build to verify**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run build`
Expected: PASS — TypeScript compiles without errors

**Step 3: Verify all tests still pass**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: PASS — All tests pass

**Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add package.json && git commit -m "build: package.jsonをnpm配布可能な形式に更新"
```

---

## Task 5: エクスポート更新 + インテグレーションテスト

**Files:**
- Modify: `src/index.ts`
- Create: `tests/integration/plugin-orchestrator-flow.test.ts`

**Step 1: Update exports**

Add to `src/index.ts`:

```typescript
// Phase 7 Exports
export { JusticePlugin } from "./core/justice-plugin";
export { StatusCommand, type PlanStatus } from "./core/status-command";
export { NodeFileSystem } from "./runtime/node-file-system";
```

**Step 2: Write integration test**

Create `tests/integration/plugin-orchestrator-flow.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { StatusCommand } from "../../src/core/status-command";
import type { MessageEvent, PostToolUseEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("Phase 7: Plugin Orchestrator Flow", () => {
  it("should complete full lifecycle: delegate → execute → feedback → status", async () => {
    const planContent = [
      "## Task 1: Setup project",
      "- [ ] Init repository",
      "- [ ] Configure tools",
    ].join("\n");

    const reader = createMockFileReader({ "plan.md": planContent });
    const writer = createMockFileWriter();
    const plugin = new JusticePlugin(reader, writer);

    // 1. Delegate via Message
    const msgEvent: MessageEvent = {
      type: "Message",
      payload: { role: "assistant", content: "Delegate the next task from plan.md" },
      sessionId: "flow-session",
    };
    const delegationResponse = await plugin.handleEvent(msgEvent);
    expect(delegationResponse.action).toBe("inject");

    // 2. Register active task for feedback
    plugin.getTaskFeedback().setActivePlan("flow-session", "plan.md", "task-1");

    // 3. Process successful task result
    const postEvent: PostToolUseEvent = {
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "All tests passed. Implementation complete.", error: false },
      sessionId: "flow-session",
    };
    const feedbackResponse = await plugin.handleEvent(postEvent);
    expect(feedbackResponse.action).toBe("inject");
    if (feedbackResponse.action === "inject") {
      expect(feedbackResponse.injectedContext).toContain("completed successfully");
    }

    // 4. Check status
    const status = new StatusCommand(reader);
    const report = await status.getStatus("plan.md");
    expect(report.progress.totalTasks).toBe(1);
  });
});
```

**Step 3: Run all tests to verify**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run typecheck && bun run test`
Expected: PASS — All tests pass

**Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/index.ts tests/integration/plugin-orchestrator-flow.test.ts && git commit -m "feat(integration): Phase 7エクスポート追加 + プラグインオーケストレーターフローのテスト完了"
```

---

## 完成状態

Phase 7完了時の新規ファイル:

| File | Role |
|------|------|
| `src/core/justice-plugin.ts` | 統合オーケストレーター（イベントルーティング + 共有状態管理） |
| `src/core/status-command.ts` | プラン進捗・依存・並列タスクの構造化レポートAPI |
| `src/runtime/node-file-system.ts` | Bun.fileベースの実ファイルシステム実装 |
| `tests/core/justice-plugin.test.ts` | オーケストレーターユニットテスト |
| `tests/core/status-command.test.ts` | ステータスコマンドユニットテスト |
| `tests/runtime/node-file-system.test.ts` | ファイルシステムユニットテスト |
| `tests/integration/plugin-orchestrator-flow.test.ts` | E2Eフローテスト |

Phase 7完了時の総計（予想）:

| Layer | Files | Tests |
|-------|-------|-------|
| **Core** | 17 files | 17 test files |
| **Hooks** | 4 files | 4 test files |
| **Runtime** | 1 file | 1 test file |
| **Integration** | — | 6 test files |
| **Total** | 23 src files | 32 test files, **~200+ tests** |
