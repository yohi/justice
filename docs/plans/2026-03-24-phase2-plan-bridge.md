# Phase 2: Task Delegation Bridge — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the plan-bridge hook that detects delegation intent in agent messages, parses plan.md, and generates task() delegation requests via the existing PlanParser + TaskPackager core logic.

**Architecture:** Hook-first with pure core logic separation. A new `TriggerDetector` core class handles intent detection (no I/O). The `PlanBridge` hook class orchestrates the flow: detect trigger → read plan.md → parse → package → return delegation request. File I/O is abstracted via a `FileReader` interface for testability.

**Tech Stack:** TypeScript, Vitest, bun

---

## Task 1: OmO Hook API 型定義を追加

**Files:**

- Modify: `src/core/types.ts`
- Test: `tests/core/types.test.ts`

**Step 1: Write the failing test for new hook types**

```typescript
// tests/core/types.test.ts — append to existing tests
describe("Hook API types", () => {
  it("should accept valid HookEvent with Message payload", () => {
    const event: HookEvent<MessagePayload> = {
      type: "Message",
      payload: {
        role: "assistant",
        content: "Please delegate the next task from docs/plans/plan.md",
      },
      sessionId: "session-123",
    };
    expect(event.type).toBe("Message");
    expect(event.payload.content).toContain("plan.md");
  });

  it("should accept valid HookEvent with PreToolUse payload", () => {
    const event: HookEvent<PreToolUsePayload> = {
      type: "PreToolUse",
      payload: {
        toolName: "task",
        toolInput: { prompt: "implement feature X" },
      },
      sessionId: "session-456",
    };
    expect(event.type).toBe("PreToolUse");
    expect(event.payload.toolName).toBe("task");
  });

  it("should accept valid HookResponse", () => {
    const response: HookResponse = {
      action: "proceed",
      modifiedPayload: undefined,
      injectedContext: "Additional context here",
    };
    expect(response.action).toBe("proceed");
  });

  it("should enforce FileReader interface shape", () => {
    const reader: FileReader = {
      readFile: async (path: string) => `# Plan\n- [ ] Task 1`,
      fileExists: async (path: string) => true,
    };
    expect(reader.readFile).toBeDefined();
    expect(reader.fileExists).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/core/types.test.ts`
Expected: FAIL — `HookEvent`, `MessagePayload`, `PreToolUsePayload`, `HookResponse`, `FileReader` not found

**Step 3: Implement the types**

```typescript
// src/core/types.ts — append after existing types

/** OmO Hook イベントの汎用型 */
export interface HookEvent<T = unknown> {
  readonly type: HookEventType;
  readonly payload: T;
  readonly sessionId: string;
}

export type HookEventType = "Message" | "PreToolUse" | "PostToolUse" | "Event";

/** Message イベントのペイロード */
export interface MessagePayload {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** PreToolUse イベントのペイロード */
export interface PreToolUsePayload {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
}

/** フックのレスポンス */
export interface HookResponse {
  readonly action: "proceed" | "skip" | "inject";
  readonly modifiedPayload?: unknown;
  readonly injectedContext?: string;
}

/** ファイルシステムアクセスの抽象化（テスト可能にするため） */
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/core/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/types.ts tests/core/types.test.ts
git commit -m "feat(types): OmO Hook API型定義とFileReaderインターフェースを追加"
```

---

## Task 2: TriggerDetector コアロジック

**Files:**

- Create: `src/core/trigger-detector.ts`
- Create: `tests/core/trigger-detector.test.ts`

**Step 1: Write failing tests for plan reference detection**

```typescript
// tests/core/trigger-detector.test.ts
import { describe, it, expect } from "vitest";
import { TriggerDetector } from "../../src/core/trigger-detector";
import type { PlanReference } from "../../src/core/trigger-detector";

describe("TriggerDetector", () => {
  const detector = new TriggerDetector();

  describe("detectPlanReference", () => {
    it("should detect explicit plan.md file path", () => {
      const result = detector.detectPlanReference(
        "Please look at docs/plans/feature.md and delegate tasks",
      );
      expect(result).not.toBeNull();
      expect(result!.planPath).toBe("docs/plans/feature.md");
    });

    it("should detect plan path with various extensions", () => {
      const result = detector.detectPlanReference(
        "Refer to docs/plans/2026-03-24-phase2.md",
      );
      expect(result).not.toBeNull();
      expect(result!.planPath).toContain("phase2.md");
    });

    it("should return null when no plan reference exists", () => {
      const result = detector.detectPlanReference("Hello, how are you?");
      expect(result).toBeNull();
    });

    it("should detect plan.md as a generic reference", () => {
      const result = detector.detectPlanReference(
        "Check the plan.md for the next task",
      );
      expect(result).not.toBeNull();
      expect(result!.planPath).toBe("plan.md");
    });
  });

  describe("detectDelegationIntent", () => {
    it("should detect 'delegate' keyword", () => {
      expect(detector.detectDelegationIntent("delegate the next task")).toBe(true);
    });

    it("should detect 'next task' keyword", () => {
      expect(detector.detectDelegationIntent("execute the next task")).toBe(true);
    });

    it("should detect Japanese delegation keywords", () => {
      expect(detector.detectDelegationIntent("次のタスクを実行して")).toBe(true);
      expect(detector.detectDelegationIntent("タスクを委譲する")).toBe(true);
    });

    it("should return false for unrelated messages", () => {
      expect(detector.detectDelegationIntent("What is the weather?")).toBe(false);
    });
  });

  describe("shouldTrigger", () => {
    it("should return true when plan reference AND delegation intent exist", () => {
      expect(
        detector.shouldTrigger("Delegate the next task from plan.md"),
      ).toBe(true);
    });

    it("should return true when plan reference exists (implicit delegation)", () => {
      expect(
        detector.shouldTrigger("Check plan.md and run the next incomplete task"),
      ).toBe(true);
    });

    it("should return false when neither exists", () => {
      expect(detector.shouldTrigger("Hello world")).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/core/trigger-detector.test.ts`
Expected: FAIL — module `trigger-detector` not found

**Step 3: Implement TriggerDetector**

```typescript
// src/core/trigger-detector.ts

export interface PlanReference {
  readonly planPath: string;
}

const PLAN_PATH_REGEX = /(?:^|\s|["'`])((?:[\w./-]*\/)?[\w.-]*plan[\w.-]*\.md)\b/i;

const DELEGATION_KEYWORDS: RegExp[] = [
  /\bdelegate\b/i,
  /\bnext\s+task\b/i,
  /\bexecute\s+(?:the\s+)?(?:next\s+)?task/i,
  /\brun\s+(?:the\s+)?(?:next\s+)?task/i,
  /\bstart\s+(?:the\s+)?(?:next\s+)?task/i,
  /次のタスク/,
  /タスクを(?:実行|委譲|開始)/,
];

export class TriggerDetector {
  /**
   * Detect a reference to a plan file (*.plan*.md or plan.md) in the message.
   */
  detectPlanReference(message: string): PlanReference | null {
    const match = message.match(PLAN_PATH_REGEX);
    if (!match || match[1] === undefined) return null;
    return { planPath: match[1] };
  }

  /**
   * Detect delegation intent keywords in the message.
   */
  detectDelegationIntent(message: string): boolean {
    return DELEGATION_KEYWORDS.some((kw) => kw.test(message));
  }

  /**
   * Combined check: should this message trigger plan-bridge?
   * Triggers if there is a plan reference AND delegation intent.
   */
  shouldTrigger(message: string): boolean {
    const hasRef = this.detectPlanReference(message) !== null;
    const hasIntent = this.detectDelegationIntent(message);
    return hasRef && hasIntent;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/core/trigger-detector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/trigger-detector.ts tests/core/trigger-detector.test.ts
git commit -m "feat(core): TriggerDetectorを追加 — plan.md参照と委譲意図の検出"
```

---

## Task 3: PlanBridgeCore コアロジック (Pure Logic)

**Files:**

- Create: `src/core/plan-bridge-core.ts`
- Create: `tests/core/plan-bridge-core.test.ts`

**Step 1: Write failing tests for PlanBridgeCore**

```typescript
// tests/core/plan-bridge-core.test.ts
import { describe, it, expect } from "vitest";
import { PlanBridgeCore } from "../../src/core/plan-bridge-core";
import type { DelegationRequest } from "../../src/core/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const samplePlan = readFileSync(
  resolve(__dirname, "../fixtures/sample-plan.md"),
  "utf-8",
);

describe("PlanBridgeCore", () => {
  const core = new PlanBridgeCore();

  describe("buildDelegationFromPlan", () => {
    it("should parse plan and build DelegationRequest for next incomplete task", () => {
      const result = core.buildDelegationFromPlan(samplePlan, {
        planFilePath: "docs/plans/sample-plan.md",
        referenceFiles: ["src/feature-x.ts"],
      });

      expect(result).not.toBeNull();
      expect(result!.context.taskId).toBe("task-1");
      expect(result!.prompt).toContain("Setup project structure");
      expect(result!.context.planFilePath).toBe("docs/plans/sample-plan.md");
    });

    it("should return null when all tasks are completed", () => {
      const completedPlan =
        "## Task 1: Done\n- [x] Step 1\n- [x] Step 2\n";
      const result = core.buildDelegationFromPlan(completedPlan, {
        planFilePath: "plan.md",
        referenceFiles: [],
      });

      expect(result).toBeNull();
    });

    it("should skip completed tasks and return the next incomplete one", () => {
      const partialPlan = [
        "## Task 1: Done",
        "- [x] All done",
        "## Task 2: WIP",
        "- [ ] Do this",
        "- [ ] And this",
      ].join("\n");

      const result = core.buildDelegationFromPlan(partialPlan, {
        planFilePath: "plan.md",
        referenceFiles: [],
      });

      expect(result).not.toBeNull();
      expect(result!.context.taskId).toBe("task-2");
    });

    it("should include rolePrompt when provided", () => {
      const result = core.buildDelegationFromPlan(samplePlan, {
        planFilePath: "plan.md",
        referenceFiles: [],
        rolePrompt: "You are a senior TypeScript engineer.",
      });

      expect(result).not.toBeNull();
      expect(result!.prompt).toContain("You are a senior TypeScript engineer.");
    });

    it("should include previousLearnings when provided", () => {
      const result = core.buildDelegationFromPlan(samplePlan, {
        planFilePath: "plan.md",
        referenceFiles: [],
        previousLearnings: "Always use strict mode.",
      });

      expect(result).not.toBeNull();
      expect(result!.prompt).toContain("Always use strict mode.");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/core/plan-bridge-core.test.ts`
Expected: FAIL — module `plan-bridge-core` not found

**Step 3: Implement PlanBridgeCore**

```typescript
// src/core/plan-bridge-core.ts
import { PlanParser } from "./plan-parser";
import { TaskPackager, type PackageOptions } from "./task-packager";
import type { DelegationRequest, TaskCategory } from "./types";

export interface BuildDelegationOptions {
  planFilePath: string;
  referenceFiles: string[];
  rolePrompt?: string;
  previousLearnings?: string;
  runInBackground?: boolean;
  category?: TaskCategory;
  loadSkills?: string[];
}

export class PlanBridgeCore {
  private readonly parser: PlanParser;
  private readonly packager: TaskPackager;

  constructor() {
    this.parser = new PlanParser();
    this.packager = new TaskPackager();
  }

  /**
   * Parse plan content and build a DelegationRequest for the next incomplete task.
   * Returns null if all tasks are completed.
   */
  buildDelegationFromPlan(
    planContent: string,
    options: BuildDelegationOptions,
  ): DelegationRequest | null {
    const tasks = this.parser.parse(planContent);
    const nextTask = this.parser.getNextIncompleteTask(tasks);

    if (!nextTask) return null;

    const packageOptions: PackageOptions = {
      planFilePath: options.planFilePath,
      referenceFiles: options.referenceFiles,
      rolePrompt: options.rolePrompt,
      previousLearnings: options.previousLearnings,
      runInBackground: options.runInBackground,
      category: options.category,
      loadSkills: options.loadSkills,
    };

    return this.packager.package(nextTask, packageOptions);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/core/plan-bridge-core.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/plan-bridge-core.ts tests/core/plan-bridge-core.test.ts
git commit -m "feat(core): PlanBridgeCoreを追加 — plan解析からDelegationRequest生成"
```

---

## Task 4: PlanBridge フック実装

**Files:**

- Create: `src/hooks/plan-bridge.ts`
- Create: `tests/hooks/plan-bridge.test.ts`

**Step 1: Write failing tests for PlanBridge hook**

```typescript
// tests/hooks/plan-bridge.test.ts
import { describe, it, expect, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type {
  FileReader,
  HookEvent,
  MessagePayload,
  PreToolUsePayload,
} from "../../src/core/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const samplePlan = readFileSync(
  resolve(__dirname, "../fixtures/sample-plan.md"),
  "utf-8",
);

function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    }),
    fileExists: vi.fn(async (path: string) => path in files),
  };
}

describe("PlanBridge", () => {
  describe("handleMessage", () => {
    it("should detect plan reference and return delegation request", async () => {
      const reader = createMockFileReader({
        "docs/plans/sample-plan.md": samplePlan,
      });
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Delegate the next task from docs/plans/sample-plan.md",
        },
        sessionId: "s-1",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("inject");
      expect(response.injectedContext).toContain("Setup project structure");
    });

    it("should return proceed when no plan reference found", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Hello, just chatting",
        },
        sessionId: "s-2",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
    });

    it("should return proceed when plan file does not exist", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Delegate task from docs/plans/nonexistent-plan.md",
        },
        sessionId: "s-3",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
    });

    it("should return proceed when all tasks are completed", async () => {
      const reader = createMockFileReader({
        "plan.md": "## Task 1: Done\n- [x] Step 1\n- [x] Step 2\n",
      });
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Run next task from plan.md",
        },
        sessionId: "s-4",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
      expect(response.injectedContext).toContain("completed");
    });

    it("should ignore user messages", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "user",
          content: "Delegate next task from plan.md",
        },
        sessionId: "s-5",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
    });
  });

  describe("handlePreToolUse", () => {
    it("should inject plan context when task() is about to be called", async () => {
      const reader = createMockFileReader({
        "docs/plans/sample-plan.md": samplePlan,
      });
      const bridge = new PlanBridge(reader);

      // Set the active plan via setter
      bridge.setActivePlan("docs/plans/sample-plan.md");

      const event: HookEvent<PreToolUsePayload> = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { prompt: "do something" },
        },
        sessionId: "s-6",
      };

      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("inject");
      expect(response.injectedContext).toBeDefined();
    });

    it("should proceed when non-task tool is used", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<PreToolUsePayload> = {
        type: "PreToolUse",
        payload: {
          toolName: "bash",
          toolInput: { command: "ls" },
        },
        sessionId: "s-7",
      };

      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("proceed");
    });

    it("should proceed when no active plan is set", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<PreToolUsePayload> = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { prompt: "do something" },
        },
        sessionId: "s-8",
      };

      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("proceed");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/hooks/plan-bridge.test.ts`
Expected: FAIL — module `plan-bridge` not found

**Step 3: Implement PlanBridge hook**

```typescript
// src/hooks/plan-bridge.ts
import type {
  FileReader,
  HookEvent,
  HookResponse,
  MessagePayload,
  PreToolUsePayload,
  DelegationRequest,
} from "../core/types";
import { TriggerDetector } from "../core/trigger-detector";
import { PlanBridgeCore } from "../core/plan-bridge-core";

const PROCEED: HookResponse = { action: "proceed" };

export class PlanBridge {
  private readonly fileReader: FileReader;
  private readonly triggerDetector: TriggerDetector;
  private readonly core: PlanBridgeCore;
  private activePlanPath: string | null = null;

  constructor(fileReader: FileReader) {
    this.fileReader = fileReader;
    this.triggerDetector = new TriggerDetector();
    this.core = new PlanBridgeCore();
  }

  /**
   * Set the currently active plan path (for PreToolUse context injection).
   */
  setActivePlan(planPath: string): void {
    this.activePlanPath = planPath.trim() || null;
  }

  /**
   * Get the current active plan path.
   */
  getActivePlan(): string | null {
    return this.activePlanPath;
  }

  /**
   * Handle Message event: detect plan references and delegation intent.
   */
  async handleMessage(
    event: HookEvent<MessagePayload>,
  ): Promise<HookResponse> {
    // Only react to assistant messages
    if (event.payload.role !== "assistant") return PROCEED;

    const content = event.payload.content;
    if (!this.triggerDetector.shouldTrigger(content)) return PROCEED;

    const planRef = this.triggerDetector.detectPlanReference(content);
    if (!planRef) return PROCEED;

    // Check if the plan file exists
    const exists = await this.fileReader.fileExists(planRef.planPath);
    if (!exists) return PROCEED;

    // Read the plan file
    const planContent = await this.fileReader.readFile(planRef.planPath);

    // Set as active plan for PreToolUse context injection
    this.activePlanPath = planRef.planPath;

    // Build delegation request
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: planRef.planPath,
      referenceFiles: [],
    });

    if (!delegation) {
      return {
        action: "proceed",
        injectedContext: `All tasks in ${planRef.planPath} are completed. No delegation needed.`,
      };
    }

    return {
      action: "inject",
      injectedContext: this.formatDelegationContext(delegation),
    };
  }

  /**
   * Handle PreToolUse event: inject plan context when task() is called.
   */
  async handlePreToolUse(
    event: HookEvent<PreToolUsePayload>,
  ): Promise<HookResponse> {
    // Only intercept task() tool calls
    if (event.payload.toolName !== "task") return PROCEED;

    // Need an active plan to provide context
    if (!this.activePlanPath) return PROCEED;

    const exists = await this.fileReader.fileExists(this.activePlanPath);
    if (!exists) return PROCEED;

    const planContent = await this.fileReader.readFile(this.activePlanPath);
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: this.activePlanPath,
      referenceFiles: [],
    });

    if (!delegation) return PROCEED;

    return {
      action: "inject",
      injectedContext: this.formatDelegationContext(delegation),
    };
  }

  private formatDelegationContext(delegation: DelegationRequest): string {
    const sections: string[] = [
      "---",
      "[JUSTICE: Task Delegation Context]",
      "",
      `**Category**: ${delegation.category}`,
      `**Task ID**: ${delegation.context.taskId}`,
      `**Plan File**: ${delegation.context.planFilePath}`,
      `**Background**: ${delegation.runInBackground}`,
      "",
      "**Delegation Prompt**:",
      delegation.prompt,
      "---",
    ];

    return sections.join("\n");
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/hooks/plan-bridge.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/plan-bridge.ts tests/hooks/plan-bridge.test.ts
git commit -m "feat(hooks): PlanBridgeフックを実装 — Message/PreToolUseイベントハンドリング"
```

---

## Task 5: インテグレーションテスト (E2E フロー)

**Files:**

- Create: `tests/integration/plan-bridge-flow.test.ts`

**Step 1: Write integration test for the full delegation flow**

```typescript
// tests/integration/plan-bridge-flow.test.ts
import { describe, it, expect, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type {
  FileReader,
  HookEvent,
  MessagePayload,
  PreToolUsePayload,
} from "../../src/core/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const samplePlan = readFileSync(
  resolve(__dirname, "../fixtures/sample-plan.md"),
  "utf-8",
);

function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    }),
    fileExists: vi.fn(async (path: string) => path in files),
  };
}

describe("Plan Bridge Integration Flow", () => {
  it("should complete full Message → Delegation flow", async () => {
    const planPath = "docs/plans/sample-plan.md";
    const reader = createMockFileReader({ [planPath]: samplePlan });
    const bridge = new PlanBridge(reader);

    // Step 1: Agent sends message referencing the plan
    const messageEvent: HookEvent<MessagePayload> = {
      type: "Message",
      payload: {
        role: "assistant",
        content: `I'll delegate the next task from ${planPath}`,
      },
      sessionId: "integration-1",
    };

    const messageResponse = await bridge.handleMessage(messageEvent);
    expect(messageResponse.action).toBe("inject");
    expect(messageResponse.injectedContext).toContain(
      "Task Delegation Context",
    );
    expect(messageResponse.injectedContext).toContain("task-1");

    // Step 2: Verify active plan was set
    expect(bridge.getActivePlan()).toBe(planPath);

    // Step 3: task() is about to be called, inject context
    const toolEvent: HookEvent<PreToolUsePayload> = {
      type: "PreToolUse",
      payload: {
        toolName: "task",
        toolInput: { prompt: "implement feature" },
      },
      sessionId: "integration-1",
    };

    const toolResponse = await bridge.handlePreToolUse(toolEvent);
    expect(toolResponse.action).toBe("inject");
    expect(toolResponse.injectedContext).toContain("task-1");
  });

  it("should handle partial progress plan correctly", async () => {
    const planPath = "plan.md";
    const partialPlan = [
      "## Task 1: Done",
      "- [x] All complete",
      "## Task 2: Next",
      "- [ ] First step",
      "- [ ] Second step",
      "## Task 3: Later",
      "- [ ] Future step",
    ].join("\n");

    const reader = createMockFileReader({ [planPath]: partialPlan });
    const bridge = new PlanBridge(reader);

    const event: HookEvent<MessagePayload> = {
      type: "Message",
      payload: {
        role: "assistant",
        content: `Execute the next task from ${planPath}`,
      },
      sessionId: "integration-2",
    };

    const response = await bridge.handleMessage(event);
    expect(response.action).toBe("inject");
    expect(response.injectedContext).toContain("task-2");
    // Task 1 is completed, so should delegate Task 2
    expect(response.injectedContext).not.toContain(
      "**Task ID**: task-1",
    );
  });

  it("should gracefully handle read errors", async () => {
    const reader: FileReader = {
      readFile: vi.fn(async () => {
        throw new Error("Permission denied");
      }),
      fileExists: vi.fn(async () => true),
    };
    const bridge = new PlanBridge(reader);

    const event: HookEvent<MessagePayload> = {
      type: "Message",
      payload: {
        role: "assistant",
        content: "Delegate task from plan.md",
      },
      sessionId: "integration-3",
    };

    // Should throw since readFile fails
    await expect(bridge.handleMessage(event)).rejects.toThrow(
      "Permission denied",
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/integration/plan-bridge-flow.test.ts`
Expected: FAIL — directory/module resolution issues initially

**Step 3: Fix any issues and verify all pass**

Ensure `tests/integration/` directory exists. No new source code needed.

Run: `bun run test tests/integration/plan-bridge-flow.test.ts`
Expected: PASS

**Step 4: Run full test suite to verify no regressions**

Run: `bun run test`
Expected: ALL PASS (original 58 tests + new tests)

**Step 5: Commit**

```bash
git add tests/integration/plan-bridge-flow.test.ts
git commit -m "test(integration): PlanBridge E2Eフローのインテグレーションテストを追加"
```

---

## Task 6: エクスポート更新 + 全体検証

**Files:**

- Modify: `src/index.ts`

**Step 1: Update index.ts exports**

Add these new exports to `src/index.ts`:

```typescript
// New Phase 2 exports
export { TriggerDetector } from "./core/trigger-detector";
export type { PlanReference } from "./core/trigger-detector";
export { PlanBridgeCore } from "./core/plan-bridge-core";
export type { BuildDelegationOptions } from "./core/plan-bridge-core";
export { PlanBridge } from "./hooks/plan-bridge";
```

Also add to the existing type export block:

```typescript
export type {
  // ... existing types ...
  HookEvent,
  HookEventType,
  MessagePayload,
  PreToolUsePayload,
  HookResponse,
  FileReader,
} from "./core/types";
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors

**Step 3: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

**Step 4: Run lint**

Run: `bun run lint`
Expected: PASS (or only pre-existing warnings)

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): Phase 2のエクスポートを追加 — TriggerDetector, PlanBridgeCore, PlanBridge"
```

---

## Summary

| Task | Component | Test File | Source File |
|------|-----------|-----------|-------------|
| 1 | OmO Hook API 型定義 | `tests/core/types.test.ts` | `src/core/types.ts` |
| 2 | TriggerDetector | `tests/core/trigger-detector.test.ts` | `src/core/trigger-detector.ts` |
| 3 | PlanBridgeCore | `tests/core/plan-bridge-core.test.ts` | `src/core/plan-bridge-core.ts` |
| 4 | PlanBridge フック | `tests/hooks/plan-bridge.test.ts` | `src/hooks/plan-bridge.ts` |
| 5 | インテグレーション | `tests/integration/plan-bridge-flow.test.ts` | — |
| 6 | エクスポート更新 | — | `src/index.ts` |

**Total new files:** 5 (3 source + 2 test, plus 1 integration test)
**Modified files:** 2 (`types.ts`, `index.ts`)
**Estimated time:** ~60-90 minutes with TDD
