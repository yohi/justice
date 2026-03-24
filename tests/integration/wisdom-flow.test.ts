import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import { CompactionProtector } from "../../src/hooks/compaction-protector";
import { WisdomStore } from "../../src/core/wisdom-store";
import { SmartRetryPolicy } from "../../src/core/smart-retry-policy";
import type { PostToolUseEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

const samplePlan = [
  "## Task 1: Implement feature",
  "- [ ] Write unit tests",
  "- [ ] Write implementation",
  "## Task 2: Setup CI",
  "- [ ] Add workflow",
].join("\n");

describe("Wisdom Flow Integration", () => {
  beforeEach(() => {
    vi.spyOn(SmartRetryPolicy.prototype, "calculateDelay").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("task success → learning extraction → WisdomStore → next delegation includes learnings", async () => {
    const sharedWisdomStore = new WisdomStore();
    const reader = createMockFileReader({ "plan.md": samplePlan });
    const writer = createMockFileWriter();

    // 1. TaskFeedbackHandler: task() succeeds with tests
    const feedbackHandler = new TaskFeedbackHandler(reader, writer, sharedWisdomStore);
    feedbackHandler.setActivePlan("s-1", "plan.md", "task-1");

    const successEvent: PostToolUseEvent = {
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Tests: 5 passed, 0 failed. All steps done.",
        error: false,
      },
      sessionId: "s-1",
    };

    const response = await feedbackHandler.handlePostToolUse(successEvent);
    expect(response.action).toBe("inject");

    // 2. Learning was accumulated in the WisdomStore
    const wisdomEntries = sharedWisdomStore.getRelevant();
    expect(wisdomEntries.length).toBeGreaterThanOrEqual(1);
    expect(wisdomEntries.some((e) => e.category === "success_pattern")).toBe(true);

    // 3. PlanBridge uses sharedWisdomStore → previousLearnings injected into delegation
    const planBridge = new PlanBridge(reader, sharedWisdomStore);
    planBridge.setActivePlan("s-2", "plan.md");

    const preToolEvent = {
      type: "PreToolUse" as const,
      payload: { toolName: "task", toolInput: {} },
      sessionId: "s-2",
    };
    const bridgeResponse = await planBridge.handlePreToolUse(preToolEvent);
    expect(bridgeResponse.action).toBe("inject");
    if (bridgeResponse.action === "inject") {
      expect(bridgeResponse.injectedContext).toContain("PREVIOUS LEARNINGS");
      expect(bridgeResponse.injectedContext).toContain("Success Pattern");
    }
  });

  it("task failure → gotcha extraction → subsequent delegation warns about gotcha", async () => {
    const sharedWisdomStore = new WisdomStore();
    const reader = createMockFileReader({ "plan.md": samplePlan });
    const writer = createMockFileWriter();

    // Failure scenario: test_failure is escalated
    const feedbackHandler = new TaskFeedbackHandler(reader, writer, sharedWisdomStore);
    feedbackHandler.setActivePlan("s-3", "plan.md", "task-1");

    const failEvent: PostToolUseEvent = {
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "FAIL tests/core/foo.test.ts - AssertionError: expected 1 to be 2",
        error: true,
      },
      sessionId: "s-3",
    };

    await feedbackHandler.handlePostToolUse(failEvent); // test_failure → immediate escalate

    // failure_gotcha should be recorded
    const gotchas = sharedWisdomStore.getRelevant({ errorClass: "test_failure" });
    expect(gotchas.length).toBeGreaterThanOrEqual(1);
    expect(gotchas[0]?.category).toBe("failure_gotcha");
  });

  it("should persist wisdom through compaction (WisdomStore in CompactionProtector snapshot)", () => {
    const sharedWisdomStore = new WisdomStore();
    sharedWisdomStore.add({
      taskId: "task-1",
      category: "success_pattern",
      content: "Use Bun.file for file operations",
    });
    sharedWisdomStore.add({
      taskId: "task-2",
      category: "failure_gotcha",
      content: "Don't forget async/await on Bun APIs",
      errorClass: "type_error",
    });

    const protector = new CompactionProtector(sharedWisdomStore);
    protector.setActivePlan("plan.md");

    const snapshot = protector.createSnapshot({
      planContent: samplePlan,
      currentTaskId: "task-1",
      currentStepId: "s1",
      learnings: "Manual learning: Keep commits small",
    });

    // accumulatedLearnings should include BOTH manual and WisdomStore learnings
    expect(snapshot.accumulatedLearnings).toContain("Manual learning: Keep commits small");
    expect(snapshot.accumulatedLearnings).toContain("Use Bun.file for file operations");
    expect(snapshot.accumulatedLearnings).toContain("Failure/Gotcha");

    // formatForInjection output is included
    const formatted = protector.formatForInjection(snapshot);
    expect(formatted).toContain("Key Learnings");
    expect(formatted).toContain("JUSTICE AI: Past Learnings");
  });
});
