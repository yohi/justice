import { describe, it, expect } from "vitest";
import { ErrorClassifier } from "../../src/core/error-classifier";
import type { ErrorClass } from "../../src/core/types";

describe("ErrorClassifier", () => {
  const classifier = new ErrorClassifier();

  describe("classify", () => {
    it("should classify syntax errors", () => {
      const result = classifier.classify("SyntaxError: Unexpected token '}'");
      expect(result).toBe("syntax_error");
    });

    it("should classify type errors", () => {
      const result = classifier.classify(
        "TypeError: Property 'foo' does not exist on type 'Bar'",
      );
      expect(result).toBe("type_error");
    });

    it("should classify TS compiler errors as type errors", () => {
      const result = classifier.classify("error TS2339: Property 'x' does not exist");
      expect(result).toBe("type_error");
    });

    it("should classify test failures", () => {
      const result = classifier.classify("FAIL tests/foo.test.ts\nExpected: 1\nReceived: 2");
      expect(result).toBe("test_failure");
    });

    it("should classify timeout errors", () => {
      const result = classifier.classify("Task timed out after 180000ms");
      expect(result).toBe("timeout");
    });

    it("should classify loop detection", () => {
      const result = classifier.classify("Loop detected: same edit applied 5 times");
      expect(result).toBe("loop_detected");
    });

    it("should classify design errors from architectural keywords", () => {
      const result = classifier.classify(
        "Cannot implement: the interface is fundamentally incompatible with the requirement",
      );
      expect(result).toBe("design_error");
    });

    it("should return unknown for unrecognized errors", () => {
      const result = classifier.classify("Something unexpected happened");
      expect(result).toBe("unknown");
    });
  });

  describe("shouldRetry", () => {
    it("should retry syntax errors within limit", () => {
      expect(classifier.shouldRetry("syntax_error", 0)).toBe(true);
      expect(classifier.shouldRetry("syntax_error", 2)).toBe(true);
      expect(classifier.shouldRetry("syntax_error", 3)).toBe(false);
    });

    it("should retry type errors within limit", () => {
      expect(classifier.shouldRetry("type_error", 0)).toBe(true);
      expect(classifier.shouldRetry("type_error", 3)).toBe(false);
    });

    it("should never retry test failures", () => {
      expect(classifier.shouldRetry("test_failure", 0)).toBe(false);
    });

    it("should never retry design errors", () => {
      expect(classifier.shouldRetry("design_error", 0)).toBe(false);
    });

    it("should never retry timeouts", () => {
      expect(classifier.shouldRetry("timeout", 0)).toBe(false);
    });

    it("should never retry loop detected", () => {
      expect(classifier.shouldRetry("loop_detected", 0)).toBe(false);
    });
  });

  describe("getEscalationMessage", () => {
    it("should return re-planning message for test failures", () => {
      const msg = classifier.getEscalationMessage("test_failure");
      expect(msg).toContain("systematic-debugging");
    });

    it("should return split instruction for timeouts", () => {
      const msg = classifier.getEscalationMessage("timeout");
      expect(msg).toContain("split");
    });

    it("should return split instruction for loop detection", () => {
      const msg = classifier.getEscalationMessage("loop_detected");
      expect(msg).toContain("split");
    });

    it("should return re-design message for design errors", () => {
      const msg = classifier.getEscalationMessage("design_error");
      expect(msg).toContain("brainstorming");
    });
  });
});