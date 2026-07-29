import { describe, expect, it, vi } from "vitest";
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
    const reader = createMockFileReader({ "plan.md": planContent });
    const loopHandler = createLoopHandler(reader);
    const setLoopPlan = vi.spyOn(loopHandler, "setActivePlan");
    const bridge = new PlanBridge(reader, loopHandler, undefined, createMockNotifier());
    bridge.setActivePlan("session-1", "plan.md");
    const toolInput = {
      prompt: "do it",
      loadSkills: ["caller-skill"],
      metadata: { source: "caller" },
    };

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput,
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }
    expect(response.injectedContext).toContain("[JUSTICE: IMPLEMENTATION UNAUTHORIZED]");
    expect(response.injectedContext).not.toContain("Task Delegation Context");
    expect(response.injectedContext).not.toContain("Task ID");
    expect(response.injectedContext).not.toContain("Add implementation arm state");
    expect(response.modifiedPayload).toBeUndefined();
    expect(toolInput).toEqual({
      prompt: "do it",
      loadSkills: ["caller-skill"],
      metadata: { source: "caller" },
    });
    expect(reader.readFile).not.toHaveBeenCalled();
    expect(setLoopPlan).not.toHaveBeenCalled();
  });

  it("requires a fresh arm after the first task consumes it", async () => {
    const bridge = createBridge({ "plan.md": planContent });
    await bridge.handleImplementationArm("session-single-use", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    const first = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-single-use",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { prompt: "first" } },
    });
    const second = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-single-use",
      callId: "call-2",
      payload: { toolName: "task", toolInput: { prompt: "second" } },
    });

    expect(first.action).toBe("inject");
    if (first.action !== "inject") throw new Error("expected first inject response");
    expect(first.injectedContext).toContain("[JUSTICE: IMPLEMENTATION]");
    expect(second.action).toBe("inject");
    if (second.action !== "inject") throw new Error("expected second inject response");
    expect(second.injectedContext).toContain("[JUSTICE: IMPLEMENTATION UNAUTHORIZED]");
    expect(second.injectedContext).not.toContain("Task Delegation Context");
    expect(second.modifiedPayload).toBeUndefined();
  });

  it("invalidates an arm when the active plan changes", async () => {
    const bridge = createBridge({
      "plan-a.md": planContent,
      "plan-b.md": planContent.replace("Implement", "Implement B"),
    });
    await bridge.handleImplementationArm("session-plan-change", {
      source: "command",
      planPath: "plan-a.md",
      approved: true,
    });

    bridge.setActivePlan("session-plan-change", "plan-b.md");
    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-plan-change",
      callId: "call-plan-b",
      payload: { toolName: "task", toolInput: { prompt: "run plan B" } },
    });

    expect(bridge.isImplementationArmed("session-plan-change")).toBe(false);
    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject response");
    expect(response.injectedContext).toContain("[JUSTICE: IMPLEMENTATION UNAUTHORIZED]");
    expect(response.injectedContext).not.toContain("Task Delegation Context");
    expect(response.modifiedPayload).toBeUndefined();
  });

  it("invalidates an arm when the active plan is cleared", async () => {
    const bridge = createBridge({ "plan.md": planContent });
    await bridge.handleImplementationArm("session-plan-clear", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    bridge.setActivePlan("session-plan-clear", null);

    expect(bridge.getActivePlan("session-plan-clear")).toBeNull();
    expect(bridge.isImplementationArmed("session-plan-clear")).toBe(false);
  });

  it("invalidates an unused arm when workflow start restarts the same plan", async () => {
    const bridge = createBridge({ "plan.md": planContent });
    await bridge.handleWorkflowStart("session-same-plan", {
      source: "command",
      goal: "implement",
      designPath: null,
      planPath: "plan.md",
    });
    await bridge.handleImplementationArm("session-same-plan", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    await bridge.handleWorkflowStart("session-same-plan", {
      source: "command",
      goal: "restart implementation",
      designPath: null,
      planPath: "plan.md",
    });

    expect(bridge.isImplementationArmed("session-same-plan")).toBe(false);
  });

  it("requires a fresh arm after a consumed task and same-plan workflow restart", async () => {
    const bridge = createBridge({ "plan.md": planContent });
    await bridge.handleWorkflowStart("session-restart", {
      source: "command",
      goal: "implement",
      designPath: null,
      planPath: "plan.md",
    });
    await bridge.handleImplementationArm("session-restart", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-restart",
      callId: "call-authorized",
      payload: { toolName: "task", toolInput: { prompt: "authorized" } },
    });

    await bridge.handleWorkflowStart("session-restart", {
      source: "command",
      goal: "restart implementation",
      designPath: null,
      planPath: "plan.md",
    });
    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-restart",
      callId: "call-unauthorized",
      payload: { toolName: "task", toolInput: { prompt: "needs a new arm" } },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject response");
    expect(response.injectedContext).toContain("[JUSTICE: IMPLEMENTATION UNAUTHORIZED]");
    expect(response.injectedContext).not.toContain("Task Delegation Context");
    expect(response.modifiedPayload).toBeUndefined();
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
