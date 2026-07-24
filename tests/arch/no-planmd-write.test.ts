import { describe, expect, it } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

function buildPlan(taskId: string): string {
  return `## ${taskId}: sample task\n\n- [ ] step one\n`;
}

function buildPostToolUseEvent(sessionId: string): {
  type: "PostToolUse";
  sessionId: string;
  payload: {
    toolName: "task";
    toolResult: string;
    error: boolean;
  };
} {
  return {
    type: "PostToolUse",
    sessionId,
    payload: {
      toolName: "task",
      toolResult: "task completed",
      error: false,
    },
  };
}

describe("FF-005", () => {
  it("writes the registered plan.md through the allowlisted TaskFeedbackHandler path", async () => {
    const planPath = "plan.md";
    const reader = createMockFileReader({ [planPath]: buildPlan("Task 1") });
    const writer = createMockFileWriter();
    const handler = new TaskFeedbackHandler(reader, writer);

    handler.setActivePlan("session-1", planPath, "task-1");

    await handler.handlePostToolUse(buildPostToolUseEvent("session-1"));

    expect(writer.writeFile).toHaveBeenCalledWith(planPath, expect.any(String));
  });

  it("does not write an unregistered plan path", async () => {
    const planPath = "plan.md";
    const otherPath = "other-plan.md";
    const reader = createMockFileReader({
      [planPath]: buildPlan("Task 1"),
      [otherPath]: buildPlan("Task 1"),
    });
    const writer = createMockFileWriter();
    const handler = new TaskFeedbackHandler(reader, writer);

    handler.setActivePlan("session-1", planPath, "task-1");

    await handler.handlePostToolUse(buildPostToolUseEvent("session-1"));

    expect(writer.writeFile).toHaveBeenCalledTimes(1);
    expect(writer.writeFile).toHaveBeenCalledWith(planPath, expect.any(String));
    expect(writer.writeFile).not.toHaveBeenCalledWith(otherPath, expect.any(String));
  });
});
