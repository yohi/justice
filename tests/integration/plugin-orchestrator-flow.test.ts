import { describe, it, expect } from "vitest";
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