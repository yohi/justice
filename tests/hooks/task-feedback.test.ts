import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import type { PostToolUseEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { SmartRetryPolicy } from "../../src/core/smart-retry-policy";

const samplePlan = [
  "## Task 1: Setup",
  "- [x] Create project",
  "- [ ] Setup structure",
  "## Task 2: Implement",
  "- [ ] Write code",
].join("\n");

describe("TaskFeedbackHandler", () => {
  beforeEach(() => {
    vi.spyOn(SmartRetryPolicy.prototype, "calculateDelay").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe("handlePostToolUse", () => {
    it("should not write the plan on success (progress awaits review acceptance)", async () => {
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
      // Success no longer implies acceptance: plan.md checkboxes advance only
      // after a durable accepted TaskAcceptanceDecision (Task 3.7).
      expect(writer.writeFile).not.toHaveBeenCalled();
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("completed successfully");
      }
    });

    it("does not rewrite the approved plan on escalation", async () => {
      const reader = createMockFileReader({ "plan.md": samplePlan });
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);

      handler.setActivePlan("session-2", "plan.md", "task-1");

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult:
            "FAIL tests/setup.test.ts\nExpected: 42\nReceived: undefined\nTests: 0 passed, 1 failed",
          error: true,
        },
        sessionId: "session-2",
      };

      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("inject");
      expect(writer.writeFile).not.toHaveBeenCalled();
      // Verify escalation message is in injected context
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("systematic-debugging");
      }
    });

    it("omits split guidance when the active task is absent from the plan", async () => {
      const reader = createMockFileReader({ "plan.md": "## Task 2: Implement\n- [ ] Write code" });
      const handler = new TaskFeedbackHandler(reader, createMockFileWriter());
      handler.setActivePlan("session-missing-task", "plan.md", "task-1");

      const response = await handler.handlePostToolUse({
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "FAIL tests/setup.test.ts\nTests: 0 passed, 1 failed",
          error: true,
        },
        sessionId: "session-missing-task",
      });

      expect(response.action).toBe("inject");
      if (response.action === "inject") {
        expect(response.injectedContext).not.toContain("JUSTICE AI 提案");
      }
    });

    it("logs plan inspection errors with a fixed format string", async () => {
      const reader = createMockFileReader({ "plan.md": samplePlan });
      const error = new Error("plan read failed: %s");
      vi.spyOn(reader, "readFile").mockRejectedValue(error);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const handler = new TaskFeedbackHandler(reader, createMockFileWriter());
      handler.setActivePlan("session-log-format", "plan.md", "task-1");

      await handler.handlePostToolUse({
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "FAIL tests/setup.test.ts\nTests: 0 passed, 1 failed",
          error: true,
        },
        sessionId: "session-log-format",
      });

      expect(warn).toHaveBeenCalledWith(
        "[JUSTICE] Failed to inspect plan during escalation: %s",
        error.message,
        error,
      );
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

    it("should escalate on compaction_risk", async () => {
      const reader = createMockFileReader({ "plan.md": samplePlan });
      const writer = createMockFileWriter();
      const handler = new TaskFeedbackHandler(reader, writer);

      handler.setActivePlan("session-7", "plan.md", "task-1");

      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "Context window is 95% full. Compaction may occur.",
          error: false,
        },
        sessionId: "session-7",
      };

      const response = await handler.handlePostToolUse(event);
      expect(response.action).toBe("inject");
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("unknown");
      }
    });
  });
});
