import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type { FileReader } from "../../src/core/types";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";
import {
  createAuthorizationReviewBoundary,
  AuthorizationStore,
} from "../../src/core/plan-authorization";
import {
  createMockFileSystem,
  createMockFileReader,
  createMockFileWriter,
  wirePlanBridgeAuthorization,
} from "../helpers/mock-file-system";
import { createMockNotifier } from "../helpers/mock-notifier";

const planContent = ["## Task 1: Implement", "- [ ] Add implementation arm state"].join("\n");

afterEach(() => {
  vi.restoreAllMocks();
});

function createLoopHandler(reader: FileReader): LoopDetectionHandler {
  return new LoopDetectionHandler(reader, createMockFileWriter(), new TaskSplitter());
}

function createBridge(files: Record<string, string>): PlanBridge {
  const reader = createMockFileReader(files);
  const bridge = new PlanBridge(reader, createLoopHandler(reader), undefined, createMockNotifier());
  wirePlanBridgeAuthorization(bridge);
  return bridge;
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
    expect(result.guidance).toContain("[JUSTICE: REQUIRED SKILLS: subagent-driven-development]");
    expect(bridge.isImplementationArmed("session-1")).toBe(true);
  });

  it("warns about an active plan mismatch and arms the requested readable plan", async () => {
    const reader = createMockFileReader({
      "plan-a.md": planContent,
      "plan-b.md": planContent.replace("Implement", "Implement B"),
    });
    const notifier = createMockNotifier();
    const bridge = new PlanBridge(reader, createLoopHandler(reader), undefined, notifier);
    wirePlanBridgeAuthorization(bridge);
    bridge.setActivePlan("session-mismatch", "plan-a.md");

    const result = await bridge.handleImplementationArm("session-mismatch", {
      source: "command",
      planPath: "plan-b.md",
      approved: true,
    });

    expect(notifier.calls).toContainEqual({
      sessionId: "session-mismatch",
      taskId: undefined,
      level: "warning",
      variant: "escalation",
      title: "Plan mismatch",
      message: "Active plan plan-a.md differs from requested plan-b.md.",
    });
    expect(result.armed).toBe(true);
    expect(bridge.getActivePlan("session-mismatch")).toBe("plan-b.md");
    expect(bridge.isImplementationArmed("session-mismatch")).toBe(true);
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

  it("keeps plan-scoped arm state on task pre-tool-use", async () => {
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
    expect(bridge.isImplementationArmed("session-1")).toBe(true);
  });

  it("treats Superpowers general routing as a compatibility placeholder for an authorized task", async () => {
    const simplePlan = ["## Task 1: Implement behavior", "- [ ] Add handler logic"].join("\n");
    const bridge = createBridge({ "plan.md": simplePlan });
    await bridge.handleImplementationArm("session-general", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-general",
      callId: "call-general",
      payload: {
        toolName: "task",
        toolInput: { prompt: "implement it", subagent_type: "general" },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject response");
    expect(response.modifiedPayload).toMatchObject({
      args: { category: "sp-implementation" },
    });
    expect(response.modifiedPayload).not.toMatchObject({
      args: { subagent_type: expect.anything() },
    });
  });

  it("preserves an explicit sp-review category without review wording", async () => {
    const simplePlan = ["## Task 1: Implement behavior", "- [ ] Add handler logic"].join("\n");
    const bridge = createBridge({ "plan.md": simplePlan });
    await bridge.handleImplementationArm("session-explicit-review", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-explicit-review",
      callId: "call-explicit-review",
      payload: {
        toolName: "task",
        toolInput: {
          category: "sp-review",
          description: "Inspect the supplied result",
          prompt: "Inspect the supplied result.",
          subagent_type: "general",
        },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject response");
    expect(response.modifiedPayload).toMatchObject({
      args: { category: "sp-review", run_in_background: false },
    });
    expect(response.injectedContext).not.toContain("[JUSTICE: IMPLEMENTATION]");
  });

  it("routes a Superpowers task reviewer through sp-review without implementation semantics", async () => {
    const simplePlan = ["## Task 1: Implement behavior", "- [ ] Add handler logic"].join("\n");
    const bridge = createBridge({ "plan.md": simplePlan });
    await bridge.handleImplementationArm("session-review", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    const reviewerPrompt =
      "You are reviewing one task's implementation: verify the task requirements.";

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-review",
      callId: "call-review",
      payload: {
        toolName: "task",
        toolInput: {
          category: "sp-implementation",
          description: "Review Task 1 (spec + quality)",
          prompt: reviewerPrompt,
          subagent_type: "general",
        },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject response");
    expect(response.modifiedPayload).toMatchObject({
      args: {
        category: "sp-review",
        prompt: reviewerPrompt,
        run_in_background: false,
      },
    });
    expect(response.modifiedPayload).not.toMatchObject({
      args: { subagent_type: expect.anything() },
    });
    expect(response.modifiedPayload?.args.load_skills ?? []).not.toContain(
      "test-driven-development",
    );
    expect(response.modifiedPayload?.args.load_skills ?? []).not.toContain(
      "verification-before-completion",
    );
    expect(response.modifiedPayload?.args.prompt).not.toContain(
      "**TASK CONTRACT FROM APPROVED PLAN**",
    );
    expect(response.injectedContext).not.toContain("[JUSTICE: IMPLEMENTATION]");
  });

  it("routes a Superpowers task re-review through sp-review without implementation semantics", async () => {
    const simplePlan = ["## Task 1: Implement behavior", "- [ ] Add handler logic"].join("\n");
    const bridge = createBridge({ "plan.md": simplePlan });
    await bridge.handleImplementationArm("session-re-review", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    const reviewerPrompt = "You are re-reviewing one task's fix round: verify the fixes.";

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-re-review",
      callId: "call-re-review",
      payload: {
        toolName: "task",
        toolInput: {
          description: "Re-review Task 1",
          prompt: reviewerPrompt,
          subagent_type: "general",
        },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject response");
    expect(response.modifiedPayload).toMatchObject({
      args: {
        category: "sp-review",
        prompt: reviewerPrompt,
        run_in_background: false,
      },
    });
    expect(response.modifiedPayload?.args.load_skills ?? []).not.toContain(
      "test-driven-development",
    );
    expect(response.modifiedPayload?.args.load_skills ?? []).not.toContain(
      "verification-before-completion",
    );
    expect(response.injectedContext).not.toContain("[JUSTICE: IMPLEMENTATION]");
  });

  it("routes the Superpowers whole-branch code reviewer through sp-final-review", async () => {
    const simplePlan = ["## Task 1: Implement behavior", "- [x] Add handler logic"].join("\n");
    const bridge = createBridge({ "plan.md": simplePlan });
    await bridge.handleImplementationArm("session-final-review", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-final-review",
      callId: "call-final-review",
      payload: {
        toolName: "task",
        toolInput: {
          category: "sp-implementation",
          prompt: [
            "You are a Senior Code Reviewer with expertise in software architecture.",
            "## Git Range to Review",
            "**Base:** abc",
            "**Head:** def",
          ].join("\n"),
          subagent_type: "general",
        },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject response");
    expect(response.modifiedPayload).toMatchObject({
      args: { category: "sp-final-review", run_in_background: false },
    });
    expect(response.modifiedPayload).not.toMatchObject({
      args: { subagent_type: expect.anything() },
    });
    expect(response.modifiedPayload?.args.prompt).toContain(
      "You are a Senior Code Reviewer with expertise in software architecture.",
    );
    expect(response.modifiedPayload?.args.prompt).toContain("## Git Range to Review");
    expect(response.modifiedPayload?.args.load_skills ?? []).not.toContain(
      "test-driven-development",
    );
    expect(response.modifiedPayload?.args.load_skills ?? []).not.toContain(
      "verification-before-completion",
    );
    expect(response.injectedContext).not.toContain("[JUSTICE: IMPLEMENTATION]");
    expect(bridge.getActivePlan("session-final-review")).toBe("plan.md");
  });

  it("preserves explicit specialized routing for an authorized task", async () => {
    const simplePlan = ["## Task 1: Implement behavior", "- [ ] Add handler logic"].join("\n");
    const bridge = createBridge({ "plan.md": simplePlan });
    await bridge.handleImplementationArm("session-explore", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-explore",
      callId: "call-explore",
      payload: {
        toolName: "task",
        toolInput: { prompt: "inspect first", subagent_type: "explore" },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject response");
    expect(response.modifiedPayload).toMatchObject({
      args: { subagent_type: "explore" },
    });
    expect(response.modifiedPayload).not.toMatchObject({
      args: { category: expect.anything() },
    });
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

  it("keeps delegating under the same approved plan", async () => {
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
    expect(second.modifiedPayload).toMatchObject({ args: { justice_task_id: "task-1" } });
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

  it("deletes a stale arm when isImplementationArmed detects a plan change", async () => {
    const bridge = createBridge({
      "plan-a.md": planContent,
      "plan-b.md": planContent.replace("Implement", "Implement B"),
    });
    await bridge.handleImplementationArm("session-stale-probe", {
      source: "command",
      planPath: "plan-a.md",
      approved: true,
    });
    bridge.setActivePlan("session-stale-probe", "plan-b.md");
    const armedSessions = (
      bridge as unknown as {
        implementationArmedSessions: Map<string, { readonly planPath: string }>;
      }
    ).implementationArmedSessions;
    armedSessions.set("session-stale-probe", { planPath: "plan-a.md" });

    expect(bridge.isImplementationArmed("session-stale-probe")).toBe(false);
    expect(armedSessions.has("session-stale-probe")).toBe(false);
    expect(bridge.consumeImplementationArm("session-stale-probe")).toBeNull();
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

  it("retains a durable plan authorization after a same-plan workflow restart", async () => {
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
    expect(response.modifiedPayload).toMatchObject({ args: { justice_task_id: "task-1" } });
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

  it("releases the durable session authorization when the in-memory id is missing", async () => {
    const files = createMockFileSystem({ "plan.md": planContent });
    const boundary = createAuthorizationReviewBoundary();
    const authorizationStore = new AuthorizationStore(files, files, boundary);
    const reader = createMockFileReader({ "plan.md": planContent });
    const bridge = new PlanBridge(reader, createLoopHandler(reader), undefined, createMockNotifier());
    bridge.setAuthorizationDependencies({ authorizationStore, authorizationReviewBoundary: boundary });
    await bridge.handleImplementationArm("session-cancel-recovery", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    (bridge as unknown as { activeAuthorizationIds: Map<string, string> }).activeAuthorizationIds.delete(
      "session-cancel-recovery",
    );

    await bridge.handleImplementationArm("session-cancel-recovery", { source: "command", action: "cancel" });

    const bindings = await authorizationStore.hydrate();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.status).toBe("released");
  });
});
