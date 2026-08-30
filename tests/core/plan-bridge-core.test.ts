import { describe, expect, it } from "vitest";
import { PlanBridgeCore } from "../../src/core/plan-bridge-core";
import type { PlanTask } from "../../src/core/types";

describe("PlanBridgeCore", () => {
  const core = new PlanBridgeCore();

  it("resolves controller workflows without selecting a worker agent", () => {
    expect(core.resolveController("brainstorming")).toBe("sisyphus");
    expect(core.resolveController("unknown-workflow")).toBeUndefined();
  });

  it("builds a controller request with a category-only worker payload", () => {
    const result = core.buildControllerRequest("brainstorming", {
      taskId: "task-controller",
      prompt: "plan the work",
    });

    expect(result).toEqual({
      controller: "sisyphus",
      request: expect.objectContaining({
        category: "quick",
        taskId: "task-controller",
        prompt: "plan the work",
      }),
    });
  });

  it("returns no controller request for an unknown workflow", () => {
    expect(
      core.buildControllerRequest("unknown-workflow", {
        taskId: "task-unknown-controller",
        prompt: "plan the work",
      }),
    ).toBeUndefined();
  });

  it("classifies a plan task and builds a worker request", () => {
    const task: PlanTask = {
      id: "task-worker",
      title: "implement user login feature",
      steps: [],
      status: "pending",
    };

    const result = core.classifyAndBuildWorkerRequest(task, {
      taskId: task.id,
      prompt: "implement feature",
    });

    expect(result?.category).toBe("sp-implementation");
    expect(result?.request.category).toBe("sp-implementation");
  });

  it("returns no worker request for unmapped execution roles", () => {
    const result = core.buildWorkerRequest("architecture", {
      taskId: "task-architecture",
      prompt: "design the architecture",
    });

    expect(result).toBeUndefined();
  });
});
