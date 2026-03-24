import { describe, it, expect } from "vitest";
import type {
  HookEvent,
  HookResponse,
  PostToolUsePayload,
  LoopDetectorPayload,
  CompactionPayload,
  FileWriter,
  FeedbackAction,
} from "../../src/core/types";

describe("Hook Types Validation", () => {
  describe("HookEvent", () => {
    it("should accept valid MessageEvent", () => {
      const event: HookEvent = {
        type: "Message",
        payload: {
          role: "user",
          content: "Hello",
        },
        sessionId: "session-123",
      };
      expect(event.type).toBe("Message");
      expect(event.payload.content).toBe("Hello");
    });

    it("should accept valid PreToolUseEvent", () => {
      const event: HookEvent = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { taskId: "1" },
        },
        sessionId: "session-123",
      };
      expect(event.type).toBe("PreToolUse");
      expect(event.payload.toolName).toBe("task");
    });
  });

  describe("HookResponse", () => {
    it("should accept valid ProceedResponse", () => {
      const response: HookResponse = {
        action: "proceed",
      };
      expect(response.action).toBe("proceed");
    });

    it("should accept valid InjectResponse", () => {
      const response: HookResponse = {
        action: "inject",
        injectedContext: "Some context",
      };
      expect(response.action).toBe("inject");
      expect(response.injectedContext).toBe("Some context");
    });
  });
});

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

describe("Phase 4 types", () => {
  it("should accept LoopDetectorPayload", () => {
    const payload: LoopDetectorPayload = {
      eventType: "loop-detector",
      sessionId: "s-1",
      message: "Same edit applied 3 times",
    };
    expect(payload.eventType).toBe("loop-detector");
  });

  it("should accept CompactionPayload", () => {
    const payload: CompactionPayload = {
      eventType: "compaction",
      sessionId: "s-2",
      reason: "context window limit reached",
    };
    expect(payload.eventType).toBe("compaction");
  });
});
