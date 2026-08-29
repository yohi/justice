import { describe, expect, it } from "vitest";
import { CategoryClassifier } from "../../src/core/category-classifier";
import type { PlanTask } from "../../src/core/types";

function makeTask(title: string, steps: string[] = []): PlanTask {
  return {
    id: "t1",
    title,
    steps: steps.map((description, i) => ({
      id: `t1-step-${i + 1}`,
      description,
      checked: false,
      lineNumber: i + 5,
    })),
    status: "pending",
  };
}

describe("CategoryClassifier", () => {
  const classifier = new CategoryClassifier();

  it("classifies integration tasks", () => {
    expect(classifier.classify(makeTask("update API interface"))).toBe("sp-integration");
  });

  it("classifies mechanical tasks", () => {
    expect(classifier.classify(makeTask("rename constant"))).toBe("sp-mechanical");
  });

  it("classifies implementation tasks", () => {
    expect(classifier.classify(makeTask("implement parser"))).toBe("sp-implementation");
  });
});
