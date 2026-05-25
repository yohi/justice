import { describe, it, expect } from "vitest";
import { LearningExtractor } from "../../src/core/learning-extractor";
import type { TaskFeedback } from "../../src/core/types";

describe("LearningExtractor", () => {
  const extractor = new LearningExtractor();

  describe("extract", () => {
    it("should extract success_pattern from successful task with tests", () => {
      const feedback: TaskFeedback = {
        taskId: "task-1",
        status: "success",
        retryCount: 0,
        testResults: { passed: 5, failed: 0, skipped: 0 },
      };

      const entries = extractor.extract(feedback);

      expect(entries.length).toBeGreaterThanOrEqual(1);
      const pattern = entries.find((e) => e.category === "success_pattern");
      expect(pattern).toBeDefined();
      expect(pattern?.taskId).toBe("task-1");
      expect(pattern?.content).toContain("5");
    });

    it("should return empty array for trivial success without tests", () => {
      const feedback: TaskFeedback = {
        taskId: "task-2",
        status: "success",
        retryCount: 0,
      };

      const entries = extractor.extract(feedback);
      expect(entries).toHaveLength(0);
    });

    it("should extract failure_gotcha from test failures with details", () => {
      const feedback: TaskFeedback = {
        taskId: "task-3",
        status: "failure",
        retryCount: 0,
        errorClassification: "test_failure",
        testResults: {
          passed: 3,
          failed: 2,
          skipped: 0,
          failureDetails: ["FAIL tests/core/foo.test.ts - AssertionError"],
        },
      };

      const entries = extractor.extract(feedback);

      const gotcha = entries.find((e) => e.category === "failure_gotcha");
      expect(gotcha).toBeDefined();
      expect(gotcha?.errorClass).toBe("test_failure");
      expect(gotcha?.content).toContain("FAIL");
    });

    it("should extract design_decision from design errors", () => {
      const feedback: TaskFeedback = {
        taskId: "task-4",
        status: "failure",
        retryCount: 0,
        errorClassification: "design_error",
      };

      const entries = extractor.extract(feedback, "architectural mismatch: refactor required");

      const decision = entries.find((e) => e.category === "design_decision");
      expect(decision).toBeDefined();
      expect(decision?.errorClass).toBe("design_error");
    });

    it("should extract environment_quirk from timeout", () => {
      const feedback: TaskFeedback = {
        taskId: "task-5",
        status: "timeout",
        retryCount: 0,
      };

      const entries = extractor.extract(feedback);

      const quirk = entries.find((e) => e.category === "environment_quirk");
      expect(quirk).toBeDefined();
      expect(quirk?.errorClass).toBe("timeout");
    });

    it("should mark high-retry successes as failure_gotcha", () => {
      const feedback: TaskFeedback = {
        taskId: "task-6",
        status: "success",
        retryCount: 3,
        testResults: { passed: 10, failed: 0, skipped: 0 },
      };

      const entries = extractor.extract(feedback);

      // Should have both success_pattern and failure_gotcha (high retry)
      const gotcha = entries.find((e) => e.category === "failure_gotcha");
      expect(gotcha).toBeDefined();
      expect(gotcha?.content).toContain("3");
    });

    it("should attach the provided persona to every extracted entry", () => {
      const feedback: TaskFeedback = {
        taskId: "task-6b",
        status: "success",
        retryCount: 2,
        testResults: { passed: 10, failed: 0, skipped: 0 },
      };

      const entries = extractor.extract(feedback, undefined, { persona: "atlas" });

      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => entry.persona === "atlas")).toBe(true);
    });

    it("should return empty array for non-actionable cases", () => {
      const feedback: TaskFeedback = {
        taskId: "task-7",
        status: "failure",
        retryCount: 0,
        errorClassification: "unknown",
      };

      const entries = extractor.extract(feedback);
      // Unknown errors don't produce specific learnings
      expect(entries.length).toBe(0);
    });

    it("should extract a design_decision from a root cause marker", () => {
      const feedback: TaskFeedback = {
        taskId: "task-13",
        status: "failure",
        retryCount: 0,
        errorClassification: "design_error",
      };

      const entries = extractor.extract(
        feedback,
        "Root cause: missing dependency injection in the adapter layer",
        { persona: "prometheus" },
      );

      expect(entries).toHaveLength(2); // One for the root cause, one for the design_error itself
      const rootCauseEntry = entries.find(e => e.category === "design_decision" && e.content.includes("Root cause identified"));
      expect(rootCauseEntry).toBeDefined();
      expect(rootCauseEntry).toEqual(
        expect.objectContaining({
          category: "design_decision",
          persona: "prometheus",
        }),
      );
    });

    it("should extract a design_decision from a Japanese root cause marker", () => {
      const feedback: TaskFeedback = {
        taskId: "task-13-ja",
        status: "failure",
        retryCount: 0,
        errorClassification: "design_error",
      };

      const entries = extractor.extract(
        feedback,
        "根本原因：競合状態",
        { persona: "atlas" },
      );

      expect(entries).toHaveLength(2);
      const rootCauseEntry = entries.find(
        (entry) => entry.category === "design_decision" && entry.content.includes("Root cause identified"),
      );
      expect(rootCauseEntry).toBeDefined();
      expect(rootCauseEntry).toEqual(
        expect.objectContaining({
          category: "design_decision",
          persona: "atlas",
        }),
      );
      expect(rootCauseEntry?.content).toContain("競合状態");
    });

    it("should extract a design_decision from a Japanese root cause marker with ASCII colon", () => {
      const feedback: TaskFeedback = {
        taskId: "task-13-ja-ascii",
        status: "failure",
        retryCount: 0,
        errorClassification: "design_error",
      };

      const entries = extractor.extract(
        feedback,
        "根本原因:競合状態",
        { persona: "atlas" },
      );

      expect(entries).toHaveLength(2);
      const rootCauseEntry = entries.find(
        (entry) => entry.category === "design_decision" && entry.content.includes("Root cause identified"),
      );
      expect(rootCauseEntry).toBeDefined();
      expect(rootCauseEntry).toEqual(
        expect.objectContaining({
          category: "design_decision",
          persona: "atlas",
        }),
      );
      expect(rootCauseEntry?.content).toContain("競合状態");
    });

    it("should not extract a root cause if the matched content is only whitespace", () => {
      const feedback: TaskFeedback = {
        taskId: "task-13b",
        status: "failure",
        retryCount: 0,
        errorClassification: "design_error",
      };

      const entries = extractor.extract(
        feedback,
        "Root cause:   \n\t  ",
      );

      // We expect 1 entry here because of the 'design_error' itself, but NOT the rootCauseEntry.
      // Wait, let's verify how many entries we expect.
      expect(entries.length).toBe(1);
      expect(entries[0]?.content).toContain("Design issue detected");
      expect(entries[0]?.content).not.toContain("Root cause identified");
    });

    it("should not extract a root cause if the error classification is not design_error", () => {
      const feedback: TaskFeedback = {
        taskId: "task-13c",
        status: "failure",
        retryCount: 0,
        errorClassification: "syntax_error", // Not design_error
      };

      const entries = extractor.extract(
        feedback,
        "Root cause: a simple typo",
      );

      // Since it's syntax_error and retryCount is 0, extractFromFailure might push something if it's the final failure.
      // But the rootCauseEntry shouldn't be there.
      expect(entries.every(e => !e.content.includes("Root cause identified"))).toBe(true);
    });

    describe("sanitization", () => {
      it("should mask secrets in raw output", () => {
        const feedback: TaskFeedback = {
          taskId: "task-8",
          status: "failure",
          retryCount: 0,
          errorClassification: "design_error",
        };

        const secretOutput =
          "Connection failed with apiKey: abc123def4567890 and password=mysecretpassword";
        const entries = extractor.extract(feedback, secretOutput);

        const entry = entries[0];
        expect(entry?.content).not.toContain("abc123def4567890");
        expect(entry?.content).not.toContain("mysecretpassword");
        expect(entry?.content).toContain("****[MASKED]****");
      });

      it("should mask URL-embedded passwords while preserving protocol and username", () => {
        const feedback: TaskFeedback = {
          taskId: "task-10",
          status: "failure",
          retryCount: 0,
          errorClassification: "timeout",
        };

        const urlOutput =
          "Failed to fetch from https://user:pass123@api.example.com and git@gituser:secret@github.com";
        const entries = extractor.extract(feedback, urlOutput);

        const entry = entries[0];
        expect(entry?.content).toContain("https://user:****[MASKED]****@api.example.com");
        expect(entry?.content).toContain("git@gituser:****[MASKED]****@github.com");
        expect(entry?.content).not.toContain("pass123");
        expect(entry?.content).not.toContain("secret");
      });

      it("should mask credentials with special characters in URL and SSH forms", () => {
        const feedback: TaskFeedback = {
          taskId: "task-11",
          status: "failure",
          retryCount: 0,
          errorClassification: "timeout",
        };

        const urlOutput =
          "Error: https://user:pa%ss!word@example.com or git@gituser:pa:ss!word@example.com";
        const entries = extractor.extract(feedback, urlOutput);

        const entry = entries[0];
        expect(entry?.content).toContain("https://user:****[MASKED]****@example.com");
        expect(entry?.content).toContain("git@gituser:****[MASKED]****@example.com");
        expect(entry?.content).not.toContain("pa%ss!word");
        expect(entry?.content).not.toContain("pa:ss!word");
      });

      it("should mask credentials in token@host form (no password)", () => {
        const feedback: TaskFeedback = {
          taskId: "task-12",
          status: "failure",
          retryCount: 0,
          errorClassification: "timeout",
        };

        const urlOutput = "Error: https://mytoken@example.com and git@gituser@github.com";
        const entries = extractor.extract(feedback, urlOutput);

        const entry = entries[0];
        // Note: The mask is always ":****[MASKED]****@" according to the new requirements
        expect(entry?.content).toContain("https://mytoken:****[MASKED]****@example.com");
        expect(entry?.content).toContain("git@gituser:****[MASKED]****@github.com");
        expect(entry?.content).not.toContain("mytoken@");
        expect(entry?.content).not.toContain("gituser@");
      });

      it("should truncate very long raw output", () => {
        const feedback: TaskFeedback = {
          taskId: "task-9",
          status: "failure",
          retryCount: 0,
          errorClassification: "test_failure",
        };

        const longOutput = "A".repeat(1000);
        const entries = extractor.extract(feedback, longOutput);

        const entry = entries[0];
        expect(entry?.content.length).toBeLessThan(600); // 500 + prefix/suffix
        expect(entry?.content).toContain("(truncated)");
      });
    });
  });
});
