import { describe, it, expect, vi } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import type {
  PostToolUseEvent,
} from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

const samplePlan = [
  "## Task 1: Setup",
  "- [x] Create project",
  "- [ ] Setup structure",
  "## Task 2: Implement",
  "- [ ] Write code",
].join("\n");

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
        expect(response.injectedContext).toContain("loop_detected");
      }
    });
  });
});
