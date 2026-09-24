import { describe, expect, it } from "vitest";
import {
  createControllerRoutingDecision,
  createUnroutedRoutingDecision,
  createWorkerRoutingDecision,
} from "../../src/core/routing-decision";
import type { ControllerWorkflow, ExecutionRole } from "../../src/core/types";

describe("routing-decision factories", () => {
  it("creates a desired controller decision", () => {
    const decision = createControllerRoutingDecision("brainstorming", "workflow_rule");
    expect(decision).toEqual({
      kind: "controller",
      workflow: "brainstorming",
      controller: "sisyphus",
      reason: "workflow_rule",
    });
  });

  it("creates a worker decision", () => {
    const decision = createWorkerRoutingDecision(
      "implementation",
      "sp-implementation",
      "task_classification",
    );
    expect(decision).toEqual({
      kind: "worker",
      executionRole: "implementation",
      category: "sp-implementation",
      reason: "task_classification",
    });
  });

  it.each([
    ["mechanical", "sp-mechanical"],
    ["implementation", "sp-implementation"],
    ["integration", "sp-integration"],
    ["review", "sp-review"],
    ["final-review", "sp-final-review"],
    ["deep", "sp-deep"],
    ["architecture", "sp-architecture"],
  ] as const)("maps %s to %s", (executionRole, category) => {
    expect(createWorkerRoutingDecision(executionRole, category, "task_classification")).toEqual({
      kind: "worker",
      executionRole,
      category,
      reason: "task_classification",
    });
  });

  it("rejects the legacy architecture downgrade", () => {
    expect(() =>
      createWorkerRoutingDecision("architecture", "unspecified-high", "task_classification"),
    ).toThrow();
  });

  it("rejects invalid role/category pairs", () => {
    expect(() =>
      createWorkerRoutingDecision("mechanical", "sp-integration", "task_classification"),
    ).toThrow("Invalid routing pair");
  });

  it("allows explicit requests to preserve caller-selected role and category", () => {
    expect(createWorkerRoutingDecision("mechanical", "sp-integration", "explicit_request")).toEqual(
      {
        kind: "worker",
        executionRole: "mechanical",
        category: "sp-integration",
        reason: "explicit_request",
      },
    );
  });

  it("rejects an unknown execution role", () => {
    const unknownRole = "unknown" as unknown as ExecutionRole;

    expect(() =>
      createWorkerRoutingDecision(unknownRole, "sp-mechanical", "task_classification"),
    ).toThrow("Invalid routing pair");
  });

  it("creates an unrouted decision", () => {
    const decision = createUnroutedRoutingDecision("compatibility_fallback");
    expect(decision).toEqual({
      kind: "unrouted",
      reason: "compatibility_fallback",
    });
  });
});

describe("desired controller decision", () => {
  it.each([
    ["brainstorming", "sisyphus"],
    ["writing-plans", "sisyphus"],
    ["subagent-driven-development", "atlas"],
    ["executing-plans", "sisyphus"],
  ] as const)("resolves the exact desired controller for %s", (workflow, controller) => {
    expect(createControllerRoutingDecision(workflow, "workflow_rule")).toEqual({
      kind: "controller",
      workflow,
      controller,
      reason: "workflow_rule",
    });
  });

  it("carries only the desired-controller fields and no runtime-applied field", () => {
    const decision = createControllerRoutingDecision("executing-plans", "explicit_request");
    expect(Object.keys(decision).sort()).toEqual(["controller", "kind", "reason", "workflow"]);
  });

  it("rejects an unknown controller workflow", () => {
    const unknownWorkflow = "unknown" as unknown as ControllerWorkflow;

    expect(() => createControllerRoutingDecision(unknownWorkflow, "workflow_rule")).toThrow(
      "Unknown controller workflow",
    );
  });
});
