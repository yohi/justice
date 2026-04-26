/* eslint-disable security/detect-object-injection -- Test helper intentionally indexes fixture maps by dynamic path. */
import { describe, it, expect, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type { FileReader, HookEvent } from "../../src/core/types";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { createMockFileWriter } from "../helpers/mock-file-system";
import { TaskSplitter } from "../../src/core/task-splitter";

const samplePlanContent = [
  "## Task 1: Setup",
  "- [x] Create project",
  "- [ ] Setup project structure",
].join("\n");

function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    }),
    fileExists: vi.fn(async (path: string) => path in files),
  };
}

function createLoopHandler(reader: FileReader): LoopDetectionHandler {
  return new LoopDetectionHandler(reader, createMockFileWriter(), new TaskSplitter());
}

describe("Plan Bridge Integration Flow", () => {
  it("should handle the full delegation flow correctly", async () => {
    const planPath = "docs/plans/sample-plan.md";
    const reader = createMockFileReader({ [planPath]: samplePlanContent });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    // Step 1: Agent sends message referencing the plan
    const messageEvent: HookEvent = {
      type: "Message",
      payload: {
        role: "assistant",
        content: `I'll start by checking the plan in ${planPath} and delegate the next task.`,
      },
      sessionId: "session-1",
    };

    const messageResponse = await bridge.handleMessage(messageEvent);
    expect(messageResponse.action).toBe("inject");
    if (messageResponse.action !== "inject") {
      throw new Error("expected inject response");
    }
    expect(messageResponse.injectedContext).toContain("Task Delegation Context");
    expect(messageResponse.injectedContext).toContain("Setup project structure");

    // Step 2: Verify active plan was set
    expect(bridge.getActivePlan(messageEvent.sessionId)).toBe(planPath);

    // Step 3: task() is about to be called, inject context
    const toolEvent: HookEvent = {
      type: "PreToolUse",
      payload: {
        toolName: "task",
        toolInput: { prompt: "setting up project structure" },
      },
      sessionId: "session-1",
    };

    const toolResponse = await bridge.handlePreToolUse(toolEvent);
    expect(toolResponse.action).toBe("inject");
    if (toolResponse.action !== "inject") {
      throw new Error("expected inject response");
    }
    expect(toolResponse.injectedContext).toContain("**Task ID**: task-1");
    expect(toolResponse.injectedContext).toContain("**Plan File**: docs/plans/sample-plan.md");
  });

  it("should handle completed plans correctly", async () => {
    const planPath = "completed-plan.md";
    const partialPlan = ["## Task 1: Done", "- [x] All finished"].join("\n");

    const reader = createMockFileReader({ [planPath]: partialPlan });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    const event: HookEvent = {
      type: "Message",
      payload: {
        role: "assistant",
        content: `Delegate the next task from ${planPath}.`,
      },
      sessionId: "session-2",
    };

    const response = await bridge.handleMessage(event);
    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }
    expect(response.injectedContext).toContain("already completed");
    expect(bridge.getActivePlan(event.sessionId)).toBeNull();
  });

  it("should return PROCEED when file read fails during message handling", async () => {
    const reader: FileReader = {
      fileExists: vi.fn(async () => true),
      readFile: vi.fn(async () => {
        throw new Error("Permission denied");
      }),
    };
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    const event: HookEvent = {
      type: "Message",
      payload: {
        role: "assistant",
        content: "delegate from secure-plan.md",
      },
      sessionId: "session-3",
    };

    // Should not throw, should return proceed
    const response = await bridge.handleMessage(event);
    expect(response.action).toBe("proceed");
  });
});
/* eslint-enable security/detect-object-injection */
