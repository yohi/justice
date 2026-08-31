import { describe, expect, it } from "vitest";
import { WorkflowRouter } from "../../../src/core/workflow-router";

describe("WorkflowRouter", () => {
  const router = new WorkflowRouter();

  it.each([
    ["brainstorming", "sisyphus"],
    ["writing-plans", "sisyphus"],
    ["subagent-driven-development", "atlas"],
    ["executing-plans", "sisyphus"],
  ])("resolves %s to %s", (workflow, expected) => {
    expect(router.resolveController(workflow)).toBe(expected);
  });

  it("returns undefined for unknown workflows", () => {
    expect(router.resolveController("unknown-workflow")).toBeUndefined();
  });

  it("reports known workflows", () => {
    expect(router.isKnownWorkflow("brainstorming")).toBe(true);
    expect(router.isKnownWorkflow("unknown")).toBe(false);
  });
});
