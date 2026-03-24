import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";
import type { PostToolUseEvent, EventEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { SmartRetryPolicy } from "../../src/core/smart-retry-policy";

describe("Advanced Error Flow Integration", () => {
  beforeEach(() => {
    vi.spyOn(SmartRetryPolicy.prototype, "calculateDelay").mockReturnValue(0);
    // Mock determineReduction to simulate context shrinking without needing real context fields
    vi.spyOn(SmartRetryPolicy.prototype, "determineReduction").mockImplementation((retryCount) => {
      if (retryCount === 2) return { strategy: "trim_reference_files", removedItems: ["ref.ts"] };
      if (retryCount === 3) return { strategy: "simplify_prompt", removedItems: [] };
      return { strategy: "none" };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const samplePlan = ["## Task 1: Complex Implementation", "- [ ] Step A", "- [ ] Step B"].join(
    "\n",
  );

  it("should incrementally reduce context and ultimately escalate with split on repeated failures", async () => {
    const reader = createMockFileReader({ "plan.md": samplePlan });
    const writer = createMockFileWriter();
    const handler = new TaskFeedbackHandler(reader, writer);
    handler.setActivePlan("s-1", "plan.md", "task-1");

    // Helper to simulate a tool failure
    const simulateFailure = async (
      result: string,
    ): Promise<import("../../src/core/types").HookResponse> => {
      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: { toolName: "task", toolResult: result, error: true },
        sessionId: "s-1",
      };
      return handler.handlePostToolUse(event);
    };

    // Attempt 1: Fails with syntax error. Should retry normally.
    const resp1 = await simulateFailure("SyntaxError: parse error");
    expect(resp1.action).toBe("proceed"); // retryCount: 1, strategy: 'none'

    // Attempt 2: Fails again. Policy triggers trim_reference_files.
    const resp2 = await simulateFailure("SyntaxError: parse error");
    expect(resp2.action).toBe("inject");
    if (resp2.action === "inject") {
      expect(resp2.injectedContext).toContain("trim_reference_files");
    }

    // Attempt 3: Fails again. Policy triggers 'simplify_prompt' on retryCount >= 3
    const resp3 = await simulateFailure("SyntaxError: parse error");
    expect(resp3.action).toBe("inject");
    if (resp3.action === "inject") {
      expect(resp3.injectedContext).toContain("simplify_prompt");
    }

    // Attempt 4: Exceeds maxRetries (3). Should escalate and suggest split.
    const resp4 = await simulateFailure("SyntaxError: parse error");
    expect(resp4.action).toBe("inject");
    if (resp4.action === "inject") {
      expect(resp4.injectedContext).toContain("Task Escalation");
      expect(resp4.injectedContext).toContain("task-1.1"); // Split suggestion
    }

    // Check that plan.md was updated with the error note
    expect(writer.writtenFiles["plan.md"]).toContain("⚠️ **Error**");
  });

  it("should immediately escalate and split when loop-detector event is emitted", async () => {
    const reader = createMockFileReader({ "plan.md": samplePlan });
    const writer = createMockFileWriter();
    const splitter = new TaskSplitter();
    const handler = new LoopDetectionHandler(reader, writer, splitter);
    handler.setActivePlan("s-2", "plan.md", "task-1");

    const event: EventEvent = {
      type: "Event",
      payload: { eventType: "loop-detector", sessionId: "s-2", message: "Infinite loop" },
      sessionId: "s-2",
    };

    const response = await handler.handleEvent(event);

    expect(response.action).toBe("inject");
    if (response.action === "inject") {
      expect(response.injectedContext).toContain("JUSTICE プロテクター");
      expect(response.injectedContext).toContain("task-1.1");
    }

    // Check plan.md
    expect(writer.writtenFiles["plan.md"]).toContain("loop_detected: Infinite loop");
  });
});
