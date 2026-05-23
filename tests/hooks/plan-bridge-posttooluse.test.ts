import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type { FileReader, PostToolUseEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";

function createLoopHandler(reader: FileReader): LoopDetectionHandler {
  return new LoopDetectionHandler(reader, createMockFileWriter(), new TaskSplitter());
}

describe("PlanBridge.handlePostToolUse", () => {
  it("injects Atlas guidance after a completed writing task", async () => {
    const reader = createMockFileReader({
      "plan.md": [
        "## Task 1: Write docs",
        "- [ ] Document the new workflow",
      ].join("\n"),
    });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    await bridge.handleMessage({
      type: "Message",
      payload: {
        role: "assistant",
        content: "Delegate the next task from plan.md",
      },
      sessionId: "s-1",
      callId: "c-1",
    });

    const response = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Completed the docs update",
        error: false,
      },
      sessionId: "s-1",
      callId: "c-1",
    } as PostToolUseEvent);

    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }

    expect(response.injectedContext).toContain("Atlas guidance");

    // Verify cache is cleared: second call should return PROCEED
    const secondResponse = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Completed the docs update",
        error: false,
      },
      sessionId: "s-1",
      callId: "c-1",
    } as PostToolUseEvent);
    expect(secondResponse.action).toBe("proceed");
  });

  it("clears lastCompletionInputs even if completion is not detected (Issue 3)", async () => {
    const reader = createMockFileReader({
      "plan.md": "## Task 1: Write docs\n- [ ] Document it\n",
    });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    await bridge.handleMessage({
      type: "Message",
      payload: { role: "assistant", content: "Delegate from plan.md" },
      sessionId: "s-issue3",
      callId: "c-issue3",
    });

    // Error event: detectCompletion returns null
    const response1 = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Failed",
        error: true,
      },
      sessionId: "s-issue3",
      callId: "c-issue3",
    } as PostToolUseEvent);

    expect(response1.action).toBe("proceed");

    // Success event later for the same session should NOT find the old input
    const response2 = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Success",
        error: false,
      },
      sessionId: "s-issue3",
      callId: "c-issue3",
    } as PostToolUseEvent);

    expect(response2.action).toBe("proceed");
  });
});
