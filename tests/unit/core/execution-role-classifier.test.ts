import { describe, expect, it } from "vitest";
import { ExecutionRoleClassifier } from "../../../src/core/execution-role-classifier";
import type { PlanTask } from "../../../src/core/types";

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: "t1",
    title: "Task",
    steps: [{ id: "t1-step-1", description: "step 1", checked: false, lineNumber: 1 }],
    status: "pending",
    ...overrides,
  };
}

describe("ExecutionRoleClassifier", () => {
  const classifier = new ExecutionRoleClassifier();

  it("classifies integration tasks", () => {
    const task = makeTask({
      title: "update API interface and coordinate modules",
    });
    expect(classifier.classify(task)).toBe("integration");
  });

  it("classifies mechanical tasks", () => {
    const task = makeTask({
      title: "rename typo in constant",
      steps: [{ id: "s1", description: "replace value", checked: false, lineNumber: 1 }],
    });
    expect(classifier.classify(task)).toBe("mechanical");
  });

  it("integration beats mechanical when both apply", () => {
    const task = makeTask({
      title: "add API endpoint boilerplate",
    });
    expect(classifier.classify(task)).toBe("integration");
  });

  it("falls back to implementation for normal tasks", () => {
    const task = makeTask({
      title: "implement user login feature with tests",
    });
    expect(classifier.classify(task)).toBe("implementation");
  });
});
