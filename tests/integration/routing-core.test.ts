import { describe, expect, it } from "vitest";
import { AgentRouter } from "../../src/core/agent-router";
import { ExecutionRoleClassifier } from "../../src/core/execution-role-classifier";
import { OmoCategoryMapper } from "../../src/core/omo-category-mapper";
import { PlanBridgeCore } from "../../src/core/plan-bridge-core";
import { WorkflowRouter } from "../../src/core/workflow-router";
import type { PlanTask } from "../../src/core/types";

describe("routing core integration", () => {
  const workflowRouter = new WorkflowRouter();
  const roleClassifier = new ExecutionRoleClassifier();
  const categoryMapper = new OmoCategoryMapper();
  const agentRouter = new AgentRouter();
  const planBridge = new PlanBridgeCore();

  it.each([
    ["brainstorming", "sisyphus"],
    ["writing-plans", "sisyphus"],
    ["subagent-driven-development", "atlas"],
    ["executing-plans", "sisyphus"],
  ] as const)("workflow %s -> controller %s", (workflow, controller) => {
    expect(workflowRouter.resolveController(workflow)).toBe(controller);
    expect(agentRouter.routeController(workflow)).toBe(controller);
  });

  it.each([
    ["rename constant", "sp-mechanical"],
    ["implement user login", "sp-implementation"],
    ["update API interface", "sp-integration"],
  ] as const)("task '%s' -> %s", (description, expectedCategory) => {
    const task: PlanTask = {
      id: "t",
      title: description,
      steps: [],
      status: "pending",
    };
    const role = roleClassifier.classify(task);
    const category = categoryMapper.map(role);
    expect(category).toBe(expectedCategory);
  });

  it("builds a worker request with category and no subagent_type", () => {
    const task: PlanTask = {
      id: "t",
      title: "implement user login",
      steps: [],
      status: "pending",
    };
    const result = planBridge.classifyAndBuildWorkerRequest(task, {
      taskId: "t",
      prompt: "work",
    });

    expect(result?.category).toBe("sp-implementation");
    expect(result?.request.category).toBe("sp-implementation");

    const forbiddenFields = [
      "agent",
      "model",
      "provider",
      "variant",
      "reasoning",
      "fallback_models",
      "subagent_type",
    ] as const;
    for (const field of forbiddenFields) {
      expect(result?.request).not.toHaveProperty(field);
    }
  });
});
