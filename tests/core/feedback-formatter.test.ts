import { describe, it, expect } from "vitest";
import { FeedbackFormatter } from "../../src/core/feedback-formatter";

describe("FeedbackFormatter", () => {
  const formatter = new FeedbackFormatter();

  describe("format", () => {
    it("should format successful task output", () => {
      const output = [
        "Implementation complete.",
        "",
        "Test Results:",
        "Tests: 5 passed, 0 failed, 1 skipped",
        "",
        "Files changed:",
        "- src/feature.ts",
        "- tests/feature.test.ts",
      ].join("\n");

      const feedback = formatter.format("task-1", output, false);
      expect(feedback.status).toBe("success");
      expect(feedback.taskId).toBe("task-1");
      expect(feedback.retryCount).toBe(0);
      expect(feedback.testResults?.passed).toBe(5);
      expect(feedback.testResults?.failed).toBe(0);
      expect(feedback.testResults?.skipped).toBe(1);
    });

    it("should format failed task output with test failures", () => {
      const output = [
        "FAIL tests/feature.test.ts",
        "Expected: 42",
        "Received: undefined",
        "",
        "Tests: 2 passed, 1 failed",
      ].join("\n");

      const feedback = formatter.format("task-2", output, true);
      expect(feedback.status).toBe("failure");
      expect(feedback.testResults?.passed).toBe(2);
      expect(feedback.testResults?.failed).toBe(1);
    });

    it("should format timeout output", () => {
      const output = "Task timed out after 300s.";
      const feedback = formatter.format("task-3", output, true);
      expect(feedback.status).toBe("timeout");
    });

    it("should handle empty output", () => {
      const feedback = formatter.format("task-4", "", false);
      expect(feedback.status).toBe("success");
      expect(feedback.testResults).toBeUndefined();
    });

    it("should detect compaction_risk from output", () => {
      const output = "Warning: context window is 90% full. Compaction may occur.";
      const feedback = formatter.format("task-5", output, false);
      expect(feedback.status).toBe("compaction_risk");
    });
  });

  describe("parseTestResults", () => {
    it("should parse 'Tests: N passed, M failed' format", () => {
      const result = formatter.parseTestResults("Tests: 10 passed, 2 failed, 3 skipped");
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(10);
      expect(result!.failed).toBe(2);
      expect(result!.skipped).toBe(3);
    });

    it("should parse format with missing parts (e.g. only failures)", () => {
      const result = formatter.parseTestResults("Tests: 2 failed");
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(0);
      expect(result!.failed).toBe(2);
      expect(result!.skipped).toBe(0);
    });

    it("should parse format with multiple missing parts", () => {
      const result = formatter.parseTestResults("Test: 5 passed, 1 skipped");
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(5);
      expect(result!.failed).toBe(0);
      expect(result!.skipped).toBe(1);
    });

    it("should parse Vitest-style output", () => {
      const result = formatter.parseTestResults("Tests  12 passed (12)");
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(12);
      expect(result!.failed).toBe(0);
    });

    it("should return null when no test results found", () => {
      const result = formatter.parseTestResults("Hello world");
      expect(result).toBeNull();
    });

    it("should extract failure details", () => {
      const output = [
        "FAIL tests/a.test.ts > should work",
        "AssertionError: expected 1 to be 2",
        "",
        "FAIL tests/b.test.ts > should also work",
        "TypeError: cannot read property of undefined",
      ].join("\n");
      const result = formatter.parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.failureDetails).toBeDefined();
      expect(result!.failureDetails!.length).toBeGreaterThanOrEqual(1);
    });
  });
});
