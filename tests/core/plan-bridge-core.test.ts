import { describe, expect, it } from "vitest";
import { PlanBridgeCore } from "../../src/core/plan-bridge-core";
import type { PlanTask } from "../../src/core/types";

const FORBIDDEN_WORKER_FIELDS = [
  "model",
  "provider",
  "agent",
  "subagent_type",
  "variant",
  "reasoning",
  "fallback_models",
] as const;

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: "t1",
    title: "implement login",
    steps: [],
    status: "pending",
    ...overrides,
  };
}

describe("PlanBridgeCore", () => {
  const core = new PlanBridgeCore();

  it("returns a controller and quick request for a known workflow", () => {
    const result = core.buildControllerRequest("brainstorming", {
      taskId: "t1",
      prompt: "plan the work",
    });

    expect(result?.controller).toBe("sisyphus");
    expect(result?.request).toEqual({
      category: "quick",
      taskId: "t1",
      loadSkills: [],
      prompt: "plan the work",
      runInBackground: false,
      context: { taskId: "t1" },
    });
  });

  it("returns undefined for an unknown controller workflow", () => {
    expect(
      core.buildControllerRequest("unknown-workflow", {
        taskId: "t1",
        prompt: "plan the work",
      }),
    ).toBeUndefined();
  });

  it("classifies a PlanTask and builds a worker request", () => {
    const result = core.classifyAndBuildWorkerRequest(makeTask(), {
      taskId: "t1",
      prompt: "implement feature",
    });

    expect(result?.category).toBe("sp-implementation");
    expect(result?.request).toEqual({
      category: "sp-implementation",
      taskId: "t1",
      loadSkills: [],
      prompt: "implement feature",
      runInBackground: false,
      context: { taskId: "t1" },
    });
    for (const field of FORBIDDEN_WORKER_FIELDS) {
      expect(result?.request).not.toHaveProperty(field);
    }
  });

  it("uses an explicit category when provided", () => {
    const result = core.classifyAndBuildWorkerRequest(
      makeTask({ title: "deep reasoning research" }),
      {
        taskId: "t1",
        prompt: "research the design",
        category: "deep",
      },
    );

    expect(result?.category).toBe("deep");
    expect(result?.request.category).toBe("deep");
  });

  it("preserves an explicit category that differs from the execution role", () => {
    const result = core.classifyAndBuildWorkerRequest(makeTask(), {
      taskId: "t1",
      prompt: "implement feature",
      category: "sp-integration",
    });

    expect(result?.category).toBe("sp-integration");
    expect(result?.request.category).toBe("sp-integration");
  });

  it("preserves an explicit unspecified-low category for a normal role", () => {
    const result = core.buildWorkerRequest("implementation", {
      taskId: "t1",
      prompt: "implement the feature",
      category: "unspecified-low",
    });

    expect(result?.category).toBe("unspecified-low");
    expect(result?.request.category).toBe("unspecified-low");
  });

  it("returns undefined when the classified role has no OMO category", () => {
    expect(
      core.classifyAndBuildWorkerRequest(makeTask({ title: "deep reasoning research" }), {
        taskId: "t1",
        prompt: "research the design",
      }),
    ).toBeUndefined();
  });

  it("builds a worker request from an explicit execution role", () => {
    const result = core.buildWorkerRequest("integration", {
      taskId: "t1",
      prompt: "integrate the modules",
    });

    expect(result?.category).toBe("sp-integration");
    expect(result?.request.category).toBe("sp-integration");
  });
});
