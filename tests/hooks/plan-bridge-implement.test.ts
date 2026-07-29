import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type { FileReader } from "../../src/core/types";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { createMockNotifier } from "../helpers/mock-notifier";

const planContent = ["## Task 1: Implement", "- [ ] Add implementation arm state"].join("\n");

function createLoopHandler(reader: FileReader): LoopDetectionHandler {
  return new LoopDetectionHandler(reader, createMockFileWriter(), new TaskSplitter());
}

function createBridge(files: Record<string, string>): PlanBridge {
  const reader = createMockFileReader(files);
  return new PlanBridge(reader, createLoopHandler(reader), undefined, createMockNotifier());
}

describe("PlanBridge.handleImplementationArm", () => {
  it("arms a session when the plan is readable and approved", async () => {
    const bridge = createBridge({ "plan.md": planContent });

    const result = await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    expect(result.armed).toBe(true);
    expect(result.planPath).toBe("plan.md");
    expect(result.directiveStage).toBe("implementation_arm");
    expect(bridge.isImplementationArmed("session-1")).toBe(true);
  });

  it("refuses to arm a session when approval is absent", async () => {
    const bridge = createBridge({ "plan.md": planContent });

    const result = await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "plan.md",
      approved: false,
    });

    expect(result.armed).toBe(false);
    expect(bridge.isImplementationArmed("session-1")).toBe(false);
  });

  it("rejects an unreadable plan path", async () => {
    const bridge = createBridge({});

    const result = await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "missing.md",
      approved: true,
    });

    expect(result.armed).toBe(false);
    expect(result.planPath).toBeNull();
  });

  it("consumes arm state on task pre-tool-use", async () => {
    const bridge = createBridge({ "plan.md": planContent });
    await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { prompt: "do it" },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }
    expect(response.injectedContext).toContain("[JUSTICE: IMPLEMENTATION]");
    expect(bridge.isImplementationArmed("session-1")).toBe(false);
  });

  it("injects an unauthorized directive when the active plan is not armed", async () => {
    const bridge = createBridge({ "plan.md": planContent });
    bridge.setActivePlan("session-1", "plan.md");

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { prompt: "do it" },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }
    expect(response.injectedContext).toContain("[JUSTICE: IMPLEMENTATION UNAUTHORIZED]");
  });

  it("clears a session arm during cleanup", async () => {
    const bridge = createBridge({ "plan.md": planContent });
    await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    bridge.destroySession("session-1");

    expect(bridge.isImplementationArmed("session-1")).toBe(false);
  });
});
