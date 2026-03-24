import { describe, it, expect } from "vitest";
import { SmartRetryPolicy } from "../../src/core/smart-retry-policy";
import type { DelegationContext } from "../../src/core/types";

describe("SmartRetryPolicy", () => {
  const policy = new SmartRetryPolicy(1000, 30000, 3, ["syntax_error", "type_error"]);

  const mockContext: DelegationContext = {
    taskId: "task-1",
    planFilePath: "plan.md",
    referenceFiles: ["a.ts", "b.ts", "c.ts", "d.ts"],
    rolePrompt: "You are an expert developer. MUST NOT DO: use any.\n\nHere are the rules.",
  };

  describe("evaluate", () => {
    it("should return shouldRetry:false for non-retryable errors", () => {
      const decision = policy.evaluate("timeout", 1, mockContext);
      expect(decision.shouldRetry).toBe(false);
      expect(decision.delayMs).toBe(0);
    });

    it("should return shouldRetry:false if maxRetries reached (currentRetry >= maxRetries)", () => {
      // With maxRetries = 3, retry 3 should be disallowed if we use "<"
      const decision = policy.evaluate("syntax_error", 3, mockContext);
      expect(decision.shouldRetry).toBe(false);
    });

    it("should return shouldRetry:true for retryable errors under limit", () => {
      const decision = policy.evaluate("type_error", 1, mockContext);
      expect(decision.shouldRetry).toBe(true);
      expect(decision.retryCount).toBe(1);

      const decision2 = policy.evaluate("type_error", 2, mockContext);
      expect(decision2.shouldRetry).toBe(true);
    });
  });

  describe("calculateDelay", () => {
    it("should calculate exponential backoff with jitter", () => {
      // 1st retry: ~ 1000 * 2^1 = 2000 + jitter(0-500)
      const delay1 = policy.calculateDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(2000);
      expect(delay1).toBeLessThanOrEqual(2500);

      // 2nd retry: ~ 1000 * 2^2 = 4000 + jitter
      const delay2 = policy.calculateDelay(2);
      expect(delay2).toBeGreaterThanOrEqual(4000);
      expect(delay2).toBeLessThanOrEqual(4500);
    });

    it("should cap at maxDelayMs", () => {
      const longPolicy = new SmartRetryPolicy(10000, 30000);
      const delay = longPolicy.calculateDelay(3); // 10000 * 8 = 80000 -> max 30000
      expect(delay).toBe(30000);
    });
  });

  describe("determineReduction", () => {
    it("should return 'none' for first retry", () => {
      const reduction = policy.determineReduction(1, mockContext);
      expect(reduction.strategy).toBe("none");
    });

    it("should apply 'trim_reference_files' for second retry", () => {
      const reduction = policy.determineReduction(2, mockContext);
      expect(reduction.strategy).toBe("trim_reference_files");
      expect(reduction.removedItems?.length).toBeGreaterThan(0);
    });

    it("should apply 'simplify_prompt' for third retry if available", () => {
      const reduction = policy.determineReduction(3, mockContext);
      expect(reduction.strategy).toBe("simplify_prompt");
    });

    it("should gracefully handle missing context", () => {
      const reduction = policy.determineReduction(2);
      expect(reduction.strategy).toBe("none");
    });
  });
});
