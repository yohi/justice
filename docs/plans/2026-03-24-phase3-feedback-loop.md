# Phase 3: Feedback Loop — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the task-feedback hook that processes task() tool results, structures feedback via FeedbackFormatter, classifies errors via ErrorClassifier, and auto-updates plan.md (checkbox ON + error note appending).

**Architecture:** Hook-first with pure core logic separation. A new `FeedbackFormatter` core class handles raw task() output parsing (no I/O). The `TaskFeedbackHandler` hook class orchestrates the flow: intercept PostToolUse → format feedback → classify errors → branch on result → update plan.md. File I/O is abstracted via `FileReader` + `FileWriter` interfaces for testability.

**Tech Stack:** TypeScript, Vitest, bun

**Dependencies:** Phase 2 must be merged. Existing `ErrorClassifier`, `PlanParser`, `PlanBridge` are leveraged.

---

## Task 1: PostToolUsePayload 型と FileWriter インターフェースを追加

**Files:**

- Modify: `src/core/types.ts`
- Modify: `tests/core/types.test.ts`

**Step 1: Write the failing test for new types**

```typescript
// tests/core/types.test.ts — append a new describe block
describe("Phase 3 types", () => {
  it("should accept valid PostToolUsePayload", () => {
    const payload: PostToolUsePayload = {
      toolName: "task",
      toolResult: "All tests passed. 5 files changed.",
      error: false,
    };
    expect(payload.toolName).toBe("task");
    expect(payload.error).toBe(false);
  });

  it("should accept PostToolUsePayload with error", () => {
    const payload: PostToolUsePayload = {
      toolName: "task",
      toolResult: "SyntaxError: unexpected token at line 42",
      error: true,
    };
    expect(payload.error).toBe(true);
  });

  it("should enforce FileWriter interface shape", () => {
    const writer: FileWriter = {
      writeFile: async (_path: string, _content: string) => {},
    };
    expect(writer.writeFile).toBeDefined();
  });

  it("should accept valid FeedbackAction discriminated union", () => {
    const success: FeedbackAction = { type: "success", taskId: "task-1" };
    const retry: FeedbackAction = {
      type: "retry",
      taskId: "task-1",
      errorClass: "syntax_error",
      retryCount: 1,
    };
    const escalate: FeedbackAction = {
      type: "escalate",
      taskId: "task-1",
      errorClass: "test_failure",
      message: "Tests are failing.",
    };
    expect(success.type).toBe("success");
    expect(retry.type).toBe("retry");
    expect(escalate.type).toBe("escalate");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/core/types.test.ts`
Expected: FAIL — `PostToolUsePayload`, `FileWriter`, `FeedbackAction` not found

**Step 3: Implement the types**

```typescript
// src/core/types.ts — append after existing types

/** PostToolUse イベントのペイロード */
export interface PostToolUsePayload {
  readonly toolName: string;
  readonly toolResult: string;
  readonly error: boolean;
}

/** ファイル書き込みアクセスの抽象化 */
export interface FileWriter {
  writeFile(path: string, content: string): Promise<void>;
}

/** フィードバックアクションの Discriminated Union */
export type FeedbackAction =
  | SuccessAction
  | RetryAction
  | EscalateAction;

export interface SuccessAction {
  readonly type: "success";
  readonly taskId: string;
}

export interface RetryAction {
  readonly type: "retry";
  readonly taskId: string;
  readonly errorClass: ErrorClass;
  readonly retryCount: number;
}

export interface EscalateAction {
  readonly type: "escalate";
  readonly taskId: string;
  readonly errorClass: ErrorClass;
  readonly message: string;
}
```

Also update the existing `PostToolUseEvent` to use the concrete payload:

```typescript
export interface PostToolUseEvent {
  readonly type: "PostToolUse";
  readonly payload: PostToolUsePayload;
  readonly sessionId: string;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/core/types.test.ts`
Expected: PASS

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/core/types.ts tests/core/types.test.ts
git commit -m "feat(types): PostToolUsePayload・FileWriter・FeedbackAction型を追加"
```

---

## Task 2: FeedbackFormatter コアロジック

**Files:**

- Create: `src/core/feedback-formatter.ts`
- Create: `tests/core/feedback-formatter.test.ts`

**Step 1: Write failing tests for FeedbackFormatter**

```typescript
// tests/core/feedback-formatter.test.ts
import { describe, it, expect } from "vitest";
import { FeedbackFormatter } from "../../src/core/feedback-formatter";

describe("FeedbackFormatter", () => {
  const formatter = new FeedbackFormatter();

  describe("format", () => {
    it("should format successful task output", () => {
      const output = [
        "Implementation complete.",
        "",
        "Test Results:",
        "Tests: 5 passed, 0 failed, 1 skipped",
        "",
        "Files changed:",
        "- src/feature.ts",
        "- tests/feature.test.ts",
      ].join("\n");

      const feedback = formatter.format("task-1", output, false);
      expect(feedback.status).toBe("success");
      expect(feedback.taskId).toBe("task-1");
      expect(feedback.retryCount).toBe(0);
      expect(feedback.testResults?.passed).toBe(5);
      expect(feedback.testResults?.failed).toBe(0);
      expect(feedback.testResults?.skipped).toBe(1);
    });

    it("should format failed task output with test failures", () => {
      const output = [
        "FAIL tests/feature.test.ts",
        "Expected: 42",
        "Received: undefined",
        "",
        "Tests: 2 passed, 1 failed",
      ].join("\n");

      const feedback = formatter.format("task-2", output, true);
      expect(feedback.status).toBe("failure");
      expect(feedback.testResults?.passed).toBe(2);
      expect(feedback.testResults?.failed).toBe(1);
    });

    it("should format timeout output", () => {
      const output = "Task timed out after 300s.";
      const feedback = formatter.format("task-3", output, true);
      expect(feedback.status).toBe("timeout");
    });

    it("should handle empty output", () => {
      const feedback = formatter.format("task-4", "", false);
      expect(feedback.status).toBe("success");
      expect(feedback.testResults).toBeUndefined();
    });

    it("should detect compaction_risk from output", () => {
      const output = "Warning: context window is 90% full. Compaction may occur.";
      const feedback = formatter.format("task-5", output, false);
      expect(feedback.status).toBe("compaction_risk");
    });
  });

  describe("parseTestResults", () => {
    it("should parse 'Tests: N passed, M failed' format", () => {
      const result = formatter.parseTestResults(
        "Tests: 10 passed, 2 failed, 3 skipped",
      );
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(10);
      expect(result!.failed).toBe(2);
      expect(result!.skipped).toBe(3);
    });

    it("should parse Vitest-style output", () => {
      const result = formatter.parseTestResults(
        "Tests  12 passed (12)",
      );
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(12);
      expect(result!.failed).toBe(0);
    });

    it("should return null when no test results found", () => {
      const result = formatter.parseTestResults("Hello world");
      expect(result).toBeNull();
    });

    it("should extract failure details", () => {
      const output = [
        "FAIL tests/a.test.ts > should work",
        "AssertionError: expected 1 to be 2",
        "",
        "FAIL tests/b.test.ts > should also work",
        "TypeError: cannot read property of undefined",
      ].join("\n");
      const result = formatter.parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.failureDetails).toBeDefined();
      expect(result!.failureDetails!.length).toBeGreaterThanOrEqual(1);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/core/feedback-formatter.test.ts`
Expected: FAIL — module `feedback-formatter` not found

**Step 3: Implement FeedbackFormatter**

```typescript
// src/core/feedback-formatter.ts
import type { TaskFeedback, TaskFeedbackStatus, TestSummary } from "./types";

// Tests: N passed, M failed, K skipped
const TEST_RESULT_REGEX =
  /Tests?:?\s+(\d+)\s+passed(?:,?\s+(\d+)\s+failed)?(?:,?\s+(\d+)\s+skipped)?/i;

// Vitest-style: Tests  12 passed (12)
const VITEST_RESULT_REGEX = /Tests\s+(\d+)\s+passed\s+\(\d+\)/i;

const FAILURE_LINE_REGEX = /^FAIL\s+.+$/gm;

const TIMEOUT_KEYWORDS = [/timed?\s*out/i, /timeout/i];

const COMPACTION_RISK_KEYWORDS = [
  /context window.*?\d+%\s*full/i,
  /compaction may occur/i,
  /approaching.*?context.*?limit/i,
];

export class FeedbackFormatter {
  /**
   * Format raw task() output into structured TaskFeedback.
   */
  format(
    taskId: string,
    rawOutput: string,
    isError: boolean,
  ): TaskFeedback {
    const testResults = this.parseTestResults(rawOutput) ?? undefined;
    const status = this.determineStatus(rawOutput, isError, testResults);

    return {
      taskId,
      status,
      testResults,
      retryCount: 0,
    };
  }

  /**
   * Parse test results from raw output.
   * Supports multiple formats (generic, vitest-style).
   */
  parseTestResults(rawOutput: string): TestSummary | null {
    // Try generic format first
    const genericMatch = rawOutput.match(TEST_RESULT_REGEX);
    if (genericMatch && genericMatch[1] !== undefined) {
      return {
        passed: parseInt(genericMatch[1], 10),
        failed: genericMatch[2] !== undefined ? parseInt(genericMatch[2], 10) : 0,
        skipped: genericMatch[3] !== undefined ? parseInt(genericMatch[3], 10) : 0,
        failureDetails: this.extractFailureDetails(rawOutput),
      };
    }

    // Try vitest format
    const vitestMatch = rawOutput.match(VITEST_RESULT_REGEX);
    if (vitestMatch && vitestMatch[1] !== undefined) {
      return {
        passed: parseInt(vitestMatch[1], 10),
        failed: 0,
        skipped: 0,
        failureDetails: this.extractFailureDetails(rawOutput),
      };
    }

    // Check if there are failure lines even without a summary
    const failureDetails = this.extractFailureDetails(rawOutput);
    if (failureDetails.length > 0) {
      return {
        passed: 0,
        failed: failureDetails.length,
        skipped: 0,
        failureDetails,
      };
    }

    return null;
  }

  private determineStatus(
    rawOutput: string,
    isError: boolean,
    testResults: TestSummary | undefined,
  ): TaskFeedbackStatus {
    // Check timeout first
    if (TIMEOUT_KEYWORDS.some((kw) => kw.test(rawOutput))) {
      return "timeout";
    }

    // Check compaction risk
    if (COMPACTION_RISK_KEYWORDS.some((kw) => kw.test(rawOutput))) {
      return "compaction_risk";
    }

    // Check failure
    if (isError || (testResults && testResults.failed > 0)) {
      return "failure";
    }

    return "success";
  }

  private extractFailureDetails(rawOutput: string): string[] {
    const details: string[] = [];
    const matches = rawOutput.matchAll(FAILURE_LINE_REGEX);
    for (const match of matches) {
      details.push(match[0].trim());
    }
    return details;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/core/feedback-formatter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/feedback-formatter.ts tests/core/feedback-formatter.test.ts
git commit -m "feat(core): FeedbackFormatterを追加 — task()出力をTaskFeedbackに構造化"
```

---

## Task 3: TaskFeedbackHandler フック実装

**Files:**

- Create: `src/hooks/task-feedback.ts`
- Create: `tests/hooks/task-feedback.test.ts`

**Step 1: Write failing tests for TaskFeedbackHandler**

```typescript
// tests/hooks/task-feedback.test.ts
import { describe, it, expect, vi } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import type {
  FileReader,
  FileWriter,
  PostToolUseEvent,
  HookResponse,
} from "../../src/core/types";

const samplePlan = [
  "## Task 1: Setup",
  "- [x] Create project",
  "- [ ] Setup structure",
  "## Task 2: Implement",
  "- [ ] Write code",
].join("\n");

function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (_path: string) => {
      const content = files[_path];
      if (content === undefined) throw new Error(`File not found: ${_path}`);
      return content;
    }),
    fileExists: vi.fn(async (_path: string) => _path in files),
  };
}

function createMockFileWriter(): FileWriter & { writtenFiles: Record<string, string> } {
  const writtenFiles: Record<string, string> = {};
  return {
    writtenFiles,
    writeFile: vi.fn(async (path: string, content: string) => {
      writtenFiles[path] = content;
    }),
  };
}

describe("TaskFeedbackHandler", () => {
  describe("handlePostToolUse", () => {
    it("should update checkbox on success", async () => {
      const reader = createMockFileReader({ "plan.md": samplePlan });
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);

      handler.setActivePlan("session-1", "plan.md", "task-1");

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "All done. Tests: 5 passed, 0 failed",
          error: false,
        },
        sessionId: "session-1",
      };

      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("inject");
      // Verify plan.md was written with checkbox checked
      expect(writer.writtenFiles["plan.md"]).toContain("[x] Setup structure");
    });

    it("should append error note on escalation (test_failure)", async () => {
      const reader = createMockFileReader({ "plan.md": samplePlan });
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);

      handler.setActivePlan("session-2", "plan.md", "task-1");

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "FAIL tests/setup.test.ts\nExpected: 42\nReceived: undefined\nTests: 0 passed, 1 failed",
          error: true,
        },
        sessionId: "session-2",
      };

      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("inject");
      // Verify error note was appended
      expect(writer.writtenFiles["plan.md"]).toContain("⚠️ **Error**");
      // Verify escalation message is in injected context
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("systematic-debugging");
      }
    });

    it("should proceed silently for retryable errors (Layer 1)", async () => {
      const reader = createMockFileReader({ "plan.md": samplePlan });
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);

      handler.setActivePlan("session-3", "plan.md", "task-1");

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "SyntaxError: unexpected token at line 10",
          error: true,
        },
        sessionId: "session-3",
      };

      const response = await handler.handlePostToolUse(event);
      // First attempt of a retryable error: proceed (Layer 1 auto-fix)
      expect(response.action).toBe("proceed");
    });

    it("should ignore non-task tool PostToolUse events", async () => {
      const reader = createMockFileReader({});
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: { toolName: "bash", toolResult: "ls output", error: false },
        sessionId: "session-4",
      };

      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("proceed");
    });

    it("should proceed when no active plan is set", async () => {
      const reader = createMockFileReader({});
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "done",
          error: false,
        },
        sessionId: "session-5",
      };

      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("proceed");
    });

    it("should inject timeout split instruction", async () => {
      const reader = createMockFileReader({ "plan.md": samplePlan });
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);

      handler.setActivePlan("session-6", "plan.md", "task-1");

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "Task timed out after 300s.",
          error: true,
        },
        sessionId: "session-6",
      };

      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("inject");
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("split");
      }
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/hooks/task-feedback.test.ts`
Expected: FAIL — module `task-feedback` not found

**Step 3: Implement TaskFeedbackHandler**

```typescript
// src/hooks/task-feedback.ts
import type {
  FileReader,
  FileWriter,
  HookEvent,
  HookResponse,
  PostToolUsePayload,
  FeedbackAction,
} from "../core/types";
import { FeedbackFormatter } from "../core/feedback-formatter";
import { ErrorClassifier } from "../core/error-classifier";
import { PlanParser } from "../core/plan-parser";

const PROCEED: HookResponse = { action: "proceed" };

interface SessionState {
  planPath: string;
  activeTaskId: string;
  retryCounts: Map<string, number>; // errorClass -> count
}

export class TaskFeedbackHandler {
  private readonly fileReader: FileReader;
  private readonly fileWriter: FileWriter;
  private readonly formatter: FeedbackFormatter;
  private readonly classifier: ErrorClassifier;
  private readonly parser: PlanParser;
  private readonly sessions: Map<string, SessionState> = new Map();

  constructor(fileReader: FileReader, fileWriter: FileWriter) {
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.formatter = new FeedbackFormatter();
    this.classifier = new ErrorClassifier();
    this.parser = new PlanParser();
  }

  /**
   * Register the active plan and task for a session.
   */
  setActivePlan(sessionId: string, planPath: string, taskId: string): void {
    this.sessions.set(sessionId, {
      planPath,
      activeTaskId: taskId,
      retryCounts: new Map(),
    });
  }

  /**
   * Clear the active plan for a session.
   */
  clearActivePlan(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Handle PostToolUse event: process task() results and update plan.md.
   */
  async handlePostToolUse(event: HookEvent): Promise<HookResponse> {
    if (event.type !== "PostToolUse") return PROCEED;

    const payload = event.payload as PostToolUsePayload;
    if (payload.toolName !== "task") return PROCEED;

    const session = this.sessions.get(event.sessionId);
    if (!session) return PROCEED;

    // Format the raw output into structured feedback
    const feedback = this.formatter.format(
      session.activeTaskId,
      payload.toolResult,
      payload.error,
    );

    // Determine the action to take
    const action = this.determineAction(feedback, session);

    // Execute the action
    return this.executeAction(action, session);
  }

  private determineAction(
    feedback: ReturnType<FeedbackFormatter["format"]>,
    session: SessionState,
  ): FeedbackAction {
    if (feedback.status === "success") {
      return { type: "success", taskId: feedback.taskId };
    }

    // Classify the error
    const errorClass = feedback.errorClassification
      ?? this.classifier.classify(feedback.testResults?.failureDetails?.join("\n") ?? "");

    // Check retry eligibility
    const currentCount = session.retryCounts.get(errorClass) ?? 0;
    if (this.classifier.shouldRetry(errorClass, currentCount)) {
      session.retryCounts.set(errorClass, currentCount + 1);
      return {
        type: "retry",
        taskId: feedback.taskId,
        errorClass,
        retryCount: currentCount + 1,
      };
    }

    // Escalation
    return {
      type: "escalate",
      taskId: feedback.taskId,
      errorClass,
      message: this.classifier.getEscalationMessage(errorClass),
    };
  }

  private async executeAction(
    action: FeedbackAction,
    session: SessionState,
  ): Promise<HookResponse> {
    switch (action.type) {
      case "success":
        return this.handleSuccess(session);
      case "retry":
        // Layer 1: proceed silently, OmO auto-fix handles it
        return PROCEED;
      case "escalate":
        return this.handleEscalation(action, session);
    }
  }

  private async handleSuccess(session: SessionState): Promise<HookResponse> {
    try {
      const planContent = await this.fileReader.readFile(session.planPath);
      const tasks = this.parser.parse(planContent);
      const task = tasks.find((t) => t.id === session.activeTaskId);

      if (task) {
        // Check all incomplete steps
        let updatedContent = planContent;
        for (const step of task.steps) {
          if (!step.checked) {
            updatedContent = this.parser.updateCheckbox(updatedContent, step.lineNumber, true);
          }
        }
        await this.fileWriter.writeFile(session.planPath, updatedContent);
      }
    } catch {
      // Fail-open on I/O errors
    }

    return {
      action: "inject",
      injectedContext: `[JUSTICE: Task ${session.activeTaskId} completed successfully. plan.md updated. ✅]`,
    };
  }

  private async handleEscalation(
    action: Extract<FeedbackAction, { type: "escalate" }>,
    session: SessionState,
  ): Promise<HookResponse> {
    try {
      const planContent = await this.fileReader.readFile(session.planPath);
      const updatedContent = this.parser.appendErrorNote(
        planContent,
        action.taskId,
        `${action.errorClass}: ${action.message}`,
      );
      await this.fileWriter.writeFile(session.planPath, updatedContent);
    } catch {
      // Fail-open on I/O errors
    }

    return {
      action: "inject",
      injectedContext: [
        "---",
        "[JUSTICE: Task Escalation]",
        "",
        `**Task**: ${action.taskId}`,
        `**Error Class**: ${action.errorClass}`,
        `**Action Required**: ${action.message}`,
        "---",
      ].join("\n"),
    };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/hooks/task-feedback.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/task-feedback.ts tests/hooks/task-feedback.test.ts
git commit -m "feat(hooks): TaskFeedbackHandlerを実装 — PostToolUseのフィードバックループ"
```

---

## Task 4: インテグレーションテスト (E2E フィードバックフロー)

**Files:**

- Create: `tests/integration/feedback-flow.test.ts`

**Step 1: Write integration test for the full feedback loop**

```typescript
// tests/integration/feedback-flow.test.ts
import { describe, it, expect, vi } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import type {
  FileReader,
  FileWriter,
  PostToolUseEvent,
} from "../../src/core/types";

function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (_path: string) => {
      const content = files[_path];
      if (content === undefined) throw new Error(`File not found: ${_path}`);
      return content;
    }),
    fileExists: vi.fn(async (_path: string) => _path in files),
  };
}

function createMockFileWriter(): FileWriter & { writtenFiles: Record<string, string> } {
  const writtenFiles: Record<string, string> = {};
  return {
    writtenFiles,
    writeFile: vi.fn(async (path: string, content: string) => {
      writtenFiles[path] = content;
    }),
  };
}

describe("Feedback Flow Integration", () => {
  it("should complete full success flow: task() → format → classify → checkbox update",
    async () => {
      const plan = [
        "## Task 1: Setup",
        "- [ ] Create project",
        "- [ ] Setup structure",
      ].join("\n");

      const reader = createMockFileReader({ "plan.md": plan });
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);
      handler.setActivePlan("int-1", "plan.md", "task-1");

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "All steps done. Tests: 3 passed, 0 failed",
          error: false,
        },
        sessionId: "int-1",
      };

      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("inject");

      // Verify plan.md was updated
      const updatedPlan = writer.writtenFiles["plan.md"];
      expect(updatedPlan).toBeDefined();
      expect(updatedPlan).toContain("[x] Create project");
      expect(updatedPlan).toContain("[x] Setup structure");
    },
  );

  it("should complete full escalation flow: retry exhaustion → error note → escalation message",
    async () => {
      const plan = [
        "## Task 1: Setup",
        "- [ ] Create project",
      ].join("\n");

      const reader = createMockFileReader({ "plan.md": plan });
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);
      handler.setActivePlan("int-2", "plan.md", "task-1");

      // Simulate 3 retryable errors (syntax_error maxRetries = 3)
      for (let i = 0; i < 3; i++) {
        const event: PostToolUseEvent = {
          type: "PostToolUse",
          payload: {
            toolName: "task",
            toolResult: "SyntaxError: unexpected token",
            error: true,
          },
          sessionId: "int-2",
        };
        const r = await handler.handlePostToolUse(event);
        expect(r.action).toBe("proceed"); // Layer 1 auto-fix
      }

      // 4th attempt: should escalate
      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "SyntaxError: unexpected token",
          error: true,
        },
        sessionId: "int-2",
      };
      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("inject");
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("Task Escalation");
      }

      // Verify error note was appended to plan.md
      expect(writer.writtenFiles["plan.md"]).toContain("⚠️ **Error**");
    },
  );
});
```

**Step 2: Run tests**

Run: `bun run test tests/integration/feedback-flow.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add tests/integration/feedback-flow.test.ts
git commit -m "test(integration): フィードバックループのE2Eインテグレーションテストを追加"
```

---

## Task 5: エクスポート更新 + 全体検証

**Files:**

- Modify: `src/index.ts`

**Step 1: Update index.ts exports**

Add these new exports to `src/index.ts`:

```typescript
// Phase 3 Exports
export { FeedbackFormatter } from "./core/feedback-formatter";
export { TaskFeedbackHandler } from "./hooks/task-feedback";
```

Also add to the existing type export from `./core/types`:

```typescript
export type {
  // ... existing types ...
  PostToolUsePayload,
  FileWriter,
  FeedbackAction,
  SuccessAction,
  RetryAction,
  EscalateAction,
} from "./core/types";
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

**Step 4: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): Phase 3のエクスポートを追加 — FeedbackFormatter, TaskFeedbackHandler"
```

---

## Summary

| Task | Component | Test File | Source File |
|------|-----------|-----------|-------------|
| 1 | PostToolUsePayload + FileWriter | `tests/core/types.test.ts` | `src/core/types.ts` |
| 2 | FeedbackFormatter | `tests/core/feedback-formatter.test.ts` | `src/core/feedback-formatter.ts` |
| 3 | TaskFeedbackHandler | `tests/hooks/task-feedback.test.ts` | `src/hooks/task-feedback.ts` |
| 4 | インテグレーション | `tests/integration/feedback-flow.test.ts` | — |
| 5 | エクスポート更新 | — | `src/index.ts` |

**New files:** 3 (2 source + 1 integration test)
**Modified files:** 2 (`types.ts`, `index.ts`)
**Leveraged existing:** `ErrorClassifier`, `PlanParser`, `PlanBridge` (Phase 1/2)
**Estimated time:** ~60-90 minutes with TDD

## Design Decisions

1. **FeedbackAction Discriminated Union**: `success | retry | escalate` を使用して、フィードバックの処理分岐を型安全に表現。ErrorClassifier の `shouldRetry()` と連携してリトライ回数を管理。

2. **FileWriter 分離**: FileReader と別インターフェースとして定義し、読み取り専用のフック（PlanBridge）に不要な書き込み権限を持たせない。

3. **セッションスコープのリトライ管理**: `Map<string, SessionState>` でセッション毎にリトライカウントを追跡。Phase 2 の PlanBridge と同じパターンを踏襲。

4. **Fail-open on I/O**: plan.md 更新時の I/O エラーはフィードバック通知を妨げない。Phase 2 レビューで確立されたパターンに従う。
