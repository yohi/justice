import { describe, expect, it } from "vitest";
import { RetryPolicyCalculator } from "../../src/core/retry-policy-calculator";

describe("RetryPolicyCalculator", () => {
  it("computes category and step-count modifiers", () => {
    const calculator = new RetryPolicyCalculator();

    expect(calculator.compute({ category: "quick", stepCount: 2 })).toEqual({
      base: 3,
      categoryModifier: -1,
      volumeModifier: 0,
      maxRetries: 2,
    });
    expect(calculator.compute({ category: "ultrabrain", stepCount: 7 })).toEqual({
      base: 3,
      categoryModifier: 2,
      volumeModifier: 1,
      maxRetries: 6,
    });
  });
});
