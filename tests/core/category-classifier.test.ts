import { describe, it, expect } from "vitest";
import { CategoryClassifier } from "../../src/core/category-classifier";
import type { PlanTask } from "../../src/core/types";

const makeTask = (title: string, steps: string[]): PlanTask => ({
  id: "task-1",
  title,
  steps: steps.map((desc, i) => ({
    id: `task-1-step-${i + 1}`,
    description: desc,
    checked: false,
    lineNumber: i + 5,
  })),
  status: "pending",
});

describe("CategoryClassifier", () => {
  const classifier = new CategoryClassifier();

  it("should classify UI/CSS/design tasks as visual-engineering", () => {
    const task = makeTask("Implement responsive navbar", ["Create CSS grid layout", "Add hover animations"]);
    expect(classifier.classify(task)).toBe("visual-engineering");
  });

  it("should classify architecture/design tasks as ultrabrain", () => {
    const task = makeTask("Design plugin architecture", ["Define interfaces", "Create dependency graph"]);
    expect(classifier.classify(task)).toBe("ultrabrain");
  });

  it("should classify test-only or small fix tasks as quick", () => {
    const task = makeTask("Fix typo in README", ["Correct spelling"]);
    expect(classifier.classify(task)).toBe("quick");
  });

  it("should classify writing/docs tasks as writing", () => {
    const task = makeTask("Write API documentation", ["Document endpoints", "Add examples"]);
    expect(classifier.classify(task)).toBe("writing");
  });

  it("should default to deep for implementation tasks", () => {
    const task = makeTask("Implement parser module", ["Write failing test", "Implement logic", "Run tests"]);
    expect(classifier.classify(task)).toBe("deep");
  });

  it("should handle empty steps gracefully", () => {
    const task = makeTask("Unknown task", []);
    expect(classifier.classify(task)).toBe("deep");
  });
});
