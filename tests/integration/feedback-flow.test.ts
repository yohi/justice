import { describe, it, expect } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import { DEFAULT_RETRY_POLICY } from "../../src/core/types";
import type {
  PostToolUseEvent,
} from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

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

      const maxRetries = DEFAULT_RETRY_POLICY.maxRetries;

      // Simulate retryable errors until exhaustion
      for (let i = 0; i < maxRetries; i++) {
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

      // Next attempt: should escalate
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
