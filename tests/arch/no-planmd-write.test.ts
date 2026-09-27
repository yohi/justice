import { describe, expect, it } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

function buildPlan(taskId: string): string {
  return `## ${taskId}: sample task\n\n- [ ] step one\n`;
}

function buildPostToolUseEvent(
  sessionId: string,
  payload: { toolResult: string; error: boolean },
): {
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
      ...payload,
    },
  };
}

describe("FF-005", () => {
  it("does not write the registered plan.md on timeout escalation", async () => {
    const planPath = "plan.md";
    const reader = createMockFileReader({ [planPath]: buildPlan("Task 1") });
    const writer = createMockFileWriter();
    const handler = new TaskFeedbackHandler(reader, writer);

    handler.setActivePlan("session-1", planPath, "task-1");

    await handler.handlePostToolUse(
      buildPostToolUseEvent("session-1", {
        toolResult: "Task timed out after 300s.",
        error: true,
      }),
    );

    expect(writer.writeFile).not.toHaveBeenCalled();
  });

  it("does not write any plan path when escalation has another plan available", async () => {
    const planPath = "plan.md";
    const otherPath = "other-plan.md";
    const reader = createMockFileReader({
      [planPath]: buildPlan("Task 1"),
      [otherPath]: buildPlan("Task 1"),
    });
    const writer = createMockFileWriter();
    const handler = new TaskFeedbackHandler(reader, writer);

    handler.setActivePlan("session-1", planPath, "task-1");

    await handler.handlePostToolUse(
      buildPostToolUseEvent("session-1", {
        toolResult: "Task timed out after 300s.",
        error: true,
      }),
    );

    expect(writer.writeFile).not.toHaveBeenCalled();
  });
});
