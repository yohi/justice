/* eslint-disable security/detect-object-injection -- Test helper intentionally indexes fixture maps by dynamic path. */
import { describe, it, expect, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type {
  FileReader,
  HookEvent,
  PreToolUseEvent,
  WorkflowStartRequest,
} from "../../src/core/types";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { createMockFileWriter } from "../helpers/mock-file-system";
import { TaskSplitter } from "../../src/core/task-splitter";
import { parseWorkflowStartCommandArguments } from "../../src/core/trigger-detector";

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

describe("PlanBridge", () => {
  describe("handleMessage", () => {
    it("should detect plan reference and return delegation request", async () => {
      const reader = createMockFileReader({
        "docs/plans/sample-plan.md": samplePlanContent,
      });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      const event: HookEvent = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Delegate the next task from docs/plans/sample-plan.md",
        },
        sessionId: "s-1",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("inject");
      if (response.action !== "inject") {
        throw new Error("expected inject response");
      }
      expect(response.injectedContext).toContain("Setup project structure");
      expect(bridge.getActivePlan("s-1")).toBe("docs/plans/sample-plan.md");
    });

    it("should return PROCEED when file read fails", async () => {
      const reader: FileReader = {
        fileExists: vi.fn(async () => true),
        readFile: vi.fn(async () => {
          throw new Error("Read failed");
        }),
      };
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      const event: HookEvent = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Run task from plan.md",
        },
        sessionId: "s-err",
      };

      // Should not throw, but return PROCEED
      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
    });

    it("should return inject with message when all tasks are completed", async () => {
      const reader = createMockFileReader({
        "plan.md": "## Task 1: Done\n- [x] Step 1\n- [x] Step 2\n",
      });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      const event: HookEvent = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Run next task from plan.md",
        },
        sessionId: "s-4",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("inject");
      if (response.action !== "inject") {
        throw new Error("expected inject response");
      }
      expect(response.injectedContext).toContain("already completed");
      expect(bridge.getActivePlan("s-4")).toBeNull();
    });
  });

  it("returns PROCEED for observation-kind message payloads", async () => {
    const reader = createMockFileReader({ "plan.md": samplePlanContent });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    const event: HookEvent = {
      type: "Message",
      payload: {
        kind: "message_part_updated",
        sessionId: "s-obs",
        messageID: "m1",
        partID: "p1",
        text: "hello",
      },
      sessionId: "s-obs",
    };

    const response = await bridge.handleMessage(event);
    expect(response.action).toBe("proceed");
  });

  describe("handlePreToolUse", () => {
    it("should inject plan context when task() is about to be called", async () => {
      const reader = createMockFileReader({
        "docs/plans/sample-plan.md": samplePlanContent,
      });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      // Set the active plan for this session
      bridge.setActivePlan("s-6", "docs/plans/sample-plan.md");

      const event: HookEvent = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { prompt: "do something" },
        },
        sessionId: "s-6",
      };

      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("inject");
      if (response.action !== "inject") {
        throw new Error("expected inject response");
      }
      expect(response.injectedContext).toContain("Task ID");
    });

    it("should not inject context for a different session", async () => {
      const reader = createMockFileReader({
        "plan.md": samplePlanContent,
      });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      // Session A has an active plan
      bridge.setActivePlan("session-a", "plan.md");

      // Session B calls task()
      const event: HookEvent = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { prompt: "task for session b" },
        },
        sessionId: "session-b",
      };

      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("proceed");
    });
  });

  describe("Multi-Agent Coordination", () => {
    it("should include auto-classified category in delegation context", async () => {
      const planContent = ["### Task 1: Write API documentation", "- [ ] Document endpoints"].join(
        "\n",
      );
      const reader = createMockFileReader({ "plan.md": planContent });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));
      bridge.setActivePlan("s-1", "plan.md");

      const event: PreToolUseEvent = {
        type: "PreToolUse",
        payload: { toolName: "task", toolInput: {} },
        sessionId: "s-1",
      };
      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("inject");
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("writing");
      }
    });

    it("should include progress summary in delegation context", async () => {
      const planContent = [
        "### Task 1: Setup",
        "- [x] Init project",
        "### Task 2: Implement",
        "- [ ] Write code",
      ].join("\n");
      const reader = createMockFileReader({ "plan.md": planContent });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));
      bridge.setActivePlan("s-1", "plan.md");

      const event: PreToolUseEvent = {
        type: "PreToolUse",
        payload: { toolName: "task", toolInput: {} },
        sessionId: "s-1",
      };
      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("inject");
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("Progress");
        expect(response.injectedContext).toContain("50%");
      }
    });

    it("should identify parallelizable tasks and mention them in context", async () => {
      const planContent = [
        "### Task 1: Setup",
        "- [x] Init project",
        "### Task 2: Implement feature A",
        "- [ ] Write code",
        "### Task 3: Write docs",
        "- [ ] Write README",
      ].join("\n");
      const reader = createMockFileReader({ "plan.md": planContent });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));
      bridge.setActivePlan("s-1", "plan.md");

      const event: PreToolUseEvent = {
        type: "PreToolUse",
        payload: { toolName: "task", toolInput: {} },
        sessionId: "s-1",
      };
      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("inject");
      if (response.action === "inject") {
        expect(response.injectedContext).toContain("Parallel");
      }
    });
  });

  describe("handlePostToolUse", () => {
    it("should prioritize stored taskId from rememberCompletionInput during post tool use analysis", async () => {
      const planContent = ["### Task 1: Setup", "- [/] Init project"].join("\n");
      const reader = createMockFileReader({ "plan.md": planContent });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));
      bridge.setActivePlan("s-1", "plan.md");

      // 1. Simulate PreToolUse to store delegation context with taskId
      const preEvent: HookEvent = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { prompt: "do something", loadSkills: ["systematic-debugging"] },
        },
        sessionId: "s-1",
        callId: "call-1",
      };
      await bridge.handlePreToolUse(preEvent);

      // Verify taskId was stored in lastCompletionInputs
      const stored = (
        bridge as unknown as {
          lastCompletionInputs: Map<string, { taskId?: string }>;
        }
      ).lastCompletionInputs.get("s-1:call-1");
      expect(stored).toBeDefined();
      expect(stored?.taskId).toBe("task-1");

      // 2. Simulate PostToolUse
      const postEvent: HookEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "Root cause: manual intervention\n",
          error: false,
        },
        sessionId: "s-1",
        callId: "call-1",
      };

      const response = await bridge.handlePostToolUse(postEvent);
      expect(response).toBeDefined();
    });

    it("should skip Prometheus loop recordReviewOutput when isError is true", async () => {
      const planContent = ["### Task 1: Review", "- [/] Code review"].join("\n");
      const reader = createMockFileReader({ "plan.md": planContent });
      const mockLoopHandler = createLoopHandler(reader);
      const recordSpy = vi.spyOn(mockLoopHandler, "recordReviewOutput");

      const bridge = new PlanBridge(reader, mockLoopHandler);
      bridge.setActivePlan("s-2", "plan.md");

      // Setup completionDetector state to mimic last invoked persona as prometheus
      (
        bridge as unknown as {
          completionDetector: {
            recordPreToolUseInvocation: (
              sessionId: string,
              toolName: string,
              toolInput: Record<string, unknown>,
            ) => void;
          };
        }
      ).completionDetector.recordPreToolUseInvocation("s-2", "task", { agent: "prometheus" });

      // Simulate a failed PostToolUse execution
      const postEvent: HookEvent = {
        type: "PostToolUse",
        payload: {
          toolName: "task",
          toolResult: "Execution timeout",
          error: true,
        },
        sessionId: "s-2",
        callId: "call-2",
      };

      await bridge.handlePostToolUse(postEvent);

      // recordReviewOutput should NOT be called because error is true
      expect(recordSpy).not.toHaveBeenCalled();
    });
  });

  describe("handleWorkflowStart", () => {
    function createWorkflowStartRequest(
      overrides: Partial<WorkflowStartRequest> = {},
    ): WorkflowStartRequest {
      return {
        source: "command",
        goal: "add workflow bootstrap state",
        designPath: null,
        planPath: null,
        ...overrides,
      };
    }

    it("should return design_required when the requested design file cannot be read", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      const result = await bridge.handleWorkflowStart(
        "s-wf-1",
        createWorkflowStartRequest({ designPath: "docs/design.md", planPath: "docs/plan.md" }),
      );

      expect(result.phase).toBe("design_required");
      expect(bridge.getWorkflowBootstrap("s-wf-1")?.phase).toBe("design_required");
      expect(bridge.getActivePlan("s-wf-1")).toBeNull();
    });

    it("should return plan_ready and activate the plan when the requested plan is readable", async () => {
      const reader = createMockFileReader({
        "docs/design.md": "# Design",
        "docs/plans/sample-plan.md": samplePlanContent,
      });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      const result = await bridge.handleWorkflowStart(
        "s-wf-3",
        createWorkflowStartRequest({
          designPath: "docs/design.md",
          planPath: "docs/plans/sample-plan.md",
        }),
      );

      expect(result.phase).toBe("plan_ready");
      expect(result.nextSkill).toBeNull();
      expect(result.activePlanPath).toBe("docs/plans/sample-plan.md");
      expect(bridge.getActivePlan("s-wf-3")).toBe("docs/plans/sample-plan.md");
      expect(bridge.getWorkflowBootstrap("s-wf-3")?.request.planPath).toBe(
        "docs/plans/sample-plan.md",
      );
    });

    it("should return plan_required without touching the file system when no artifact is requested", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      const result = await bridge.handleWorkflowStart("s-wf-4", createWorkflowStartRequest());

      expect(result.phase).toBe("plan_required");
      expect(result.nextSkill).toBe("writing-plans");
      expect(result.activePlanPath).toBeNull();
      expect(reader.fileExists).not.toHaveBeenCalled();
    });

    it("should reject unsafe artifact paths at the parser boundary and never dereference them", async () => {
      expect(parseWorkflowStartCommandArguments("goal --plan ../outside/plan.md")).toBeNull();
      expect(parseWorkflowStartCommandArguments("goal --design /etc/design.md")).toBeNull();

      const reader = createMockFileReader({ "docs/plans/sample-plan.md": samplePlanContent });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      // Defense in depth: a hand-built request must not be dereferenced either.
      const result = await bridge.handleWorkflowStart(
        "s-wf-5",
        createWorkflowStartRequest({ planPath: "../outside/plan.md" }),
      );

      expect(result.phase).toBe("plan_required");
      expect(result.activePlanPath).toBeNull();
      expect(bridge.getActivePlan("s-wf-5")).toBeNull();
      expect(reader.readFile).not.toHaveBeenCalled();
    });

    it("should drop the bootstrap state on destroySession", async () => {
      const reader = createMockFileReader({ "docs/plans/sample-plan.md": samplePlanContent });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      await bridge.handleWorkflowStart(
        "s-wf-6",
        createWorkflowStartRequest({ planPath: "docs/plans/sample-plan.md" }),
      );
      expect(bridge.getWorkflowBootstrap("s-wf-6")?.phase).toBe("plan_ready");

      bridge.destroySession("s-wf-6");

      expect(bridge.getWorkflowBootstrap("s-wf-6")).toBeNull();
      expect(bridge.getActivePlan("s-wf-6")).toBeNull();
    });

    it("should degrade to plan_required when reading the plan throws (fail-open)", async () => {
      const reader: FileReader = {
        fileExists: vi.fn(async () => true),
        readFile: vi.fn(async () => {
          throw new Error("EIO: unreadable plan");
        }),
      };
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      const result = await bridge.handleWorkflowStart(
        "s-wf-7",
        createWorkflowStartRequest({ planPath: "docs/plans/sample-plan.md" }),
      );

      expect(result.phase).toBe("plan_required");
      expect(result.activePlanPath).toBeNull();
      expect(bridge.getActivePlan("s-wf-7")).toBeNull();
    });

    it("should clear a stale active plan when the workflow restarts without a readable plan", async () => {
      const reader = createMockFileReader({ "docs/plans/sample-plan.md": samplePlanContent });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));
      bridge.setActivePlan("s-wf-8", "docs/plans/sample-plan.md");

      const result = await bridge.handleWorkflowStart(
        "s-wf-8",
        createWorkflowStartRequest({ designPath: "docs/design.md" }),
      );

      expect(result.phase).toBe("design_required");
      expect(result.nextSkill).toBe("brainstorming");
      expect(bridge.getActivePlan("s-wf-8")).toBeNull();
    });

    it("should return plan_required when the design is readable but the plan is missing", async () => {
      const reader = createMockFileReader({ "docs/design.md": "# Design" });
      const bridge = new PlanBridge(reader, createLoopHandler(reader));

      const result = await bridge.handleWorkflowStart(
        "s-wf-2",
        createWorkflowStartRequest({ designPath: "docs/design.md", planPath: "docs/plan.md" }),
      );

      expect(result.phase).toBe("plan_required");
      expect(bridge.getActivePlan("s-wf-2")).toBeNull();
    });
  });
});
/* eslint-enable security/detect-object-injection */
