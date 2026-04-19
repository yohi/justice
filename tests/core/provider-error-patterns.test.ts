import { describe, it, expect } from "vitest";
import {
  PROVIDER_TRANSIENT_PATTERNS,
  PROVIDER_CONFIG_PATTERNS,
} from "../../src/core/provider-error-patterns";
import { ErrorClassifier } from "../../src/core/error-classifier";

describe("provider-error-patterns", () => {
  const classifier = new ErrorClassifier();

  describe("PROVIDER_TRANSIENT_PATTERNS", () => {
    it("should be a frozen array of RegExp", () => {
      expect(Array.isArray(PROVIDER_TRANSIENT_PATTERNS)).toBe(true);
      expect(Object.isFrozen(PROVIDER_TRANSIENT_PATTERNS)).toBe(true);
      for (const pattern of PROVIDER_TRANSIENT_PATTERNS) {
        expect(pattern).toBeInstanceOf(RegExp);
      }
    });

    it("should match transient error messages", () => {
      const positiveExamples = [
        "Rate limit reached for model-x",
        "Too many requests. Please try again later.",
        "Error 429: Too Many Requests",
        "Service Unavailable (503)",
        "The server is overloaded.",
        "Quota exceeded for your account",
        "quota will reset after 24h",
      ];

      for (const msg of positiveExamples) {
        expect(classifier.classify(msg, { isProviderContext: true })).toBe("provider_transient");
      }
    });

    it("should not match unrelated messages", () => {
      const negativeExamples = [
        "SyntaxError: unexpected token",
        "Success: operation completed",
        "File not found",
      ];

      for (const msg of negativeExamples) {
        expect(classifier.classify(msg)).not.toBe("provider_transient");
      }
    });
  });

  describe("PROVIDER_CONFIG_PATTERNS", () => {
    it("should be a frozen array of RegExp", () => {
      expect(Array.isArray(PROVIDER_CONFIG_PATTERNS)).toBe(true);
      expect(Object.isFrozen(PROVIDER_CONFIG_PATTERNS)).toBe(true);
      for (const pattern of PROVIDER_CONFIG_PATTERNS) {
        expect(pattern).toBeInstanceOf(RegExp);
      }
    });

    it("should match configuration error messages", () => {
      const positiveExamples = [
        "API key is missing or invalid",
        "The API key must be a string.",
        "model not found",
        "providerModelNotFoundError: the requested model does not exist",
        "AI_LoadAPIKeyError: failed to load credentials",
        "Model not supported",
        "Out of credits",
        "Payment Required",
      ];

      for (const msg of positiveExamples) {
        expect(classifier.classify(msg, { isProviderContext: true })).toBe("provider_config");
      }
    });
  });
});
