import { describe, expect, it } from "vitest";
import {
  createControllerRoutingDecision,
  createUnroutedRoutingDecision,
  createWorkerRoutingDecision,
} from "../../src/core/routing-decision";
import type { ExecutionRole } from "../../src/core/types";

describe("routing-decision factories", () => {
  it("creates a controller decision", () => {
    const decision = createControllerRoutingDecision("sisyphus", "workflow_rule");
    expect(decision).toEqual({
      kind: "controller",
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
    ["deep", "deep"],
    ["architecture", "unspecified-high"],
    ["architecture", "deep"],
  ] as const)("accepts the valid %s/%s pair", (executionRole, category) => {
    expect(createWorkerRoutingDecision(executionRole, category, "task_classification")).toEqual({
      kind: "worker",
      executionRole,
      category,
      reason: "task_classification",
    });
  });

  it("rejects invalid role/category pairs", () => {
    expect(() =>
      createWorkerRoutingDecision("mechanical", "sp-integration", "task_classification"),
    ).toThrow("Invalid routing pair");
  });

  it("allows explicit requests to preserve caller-selected role and category", () => {
    expect(
      createWorkerRoutingDecision("mechanical", "sp-integration", "explicit_request"),
    ).toEqual({
      kind: "worker",
      executionRole: "mechanical",
      category: "sp-integration",
      reason: "explicit_request",
    });
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
