import { describe, it, expect } from "vitest";
import { ErrorClassifier } from "../../src/core/error-classifier";

describe("ErrorClassifier", () => {
  const classifier = new ErrorClassifier();

  describe("classify", () => {
    it("should classify syntax errors", () => {
      const result = classifier.classify("SyntaxError: Unexpected token '}'");
      expect(result).toBe("syntax_error");
    });

    it("should classify type errors", () => {
      const result = classifier.classify("TypeError: Property 'foo' does not exist on type 'Bar'");
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

    it("should return false for invalid retry counts", () => {
      expect(classifier.shouldRetry("syntax_error", -1)).toBe(false);
      expect(classifier.shouldRetry("syntax_error", 1.5)).toBe(false);
      expect(classifier.shouldRetry("syntax_error", NaN)).toBe(false);
      expect(classifier.shouldRetry("syntax_error", Infinity)).toBe(false);
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

    it("should return transient provider issue message for provider_transient", () => {
      const msg = classifier.getEscalationMessage("provider_transient");
      expect(msg).toContain("transient provider issue");
      expect(msg).toContain("different `category`");
    });

    it("should return user intervention message for provider_config", () => {
      const msg = classifier.getEscalationMessage("provider_config");
      expect(msg).toContain("user intervention");
      expect(msg).toContain("oh-my-openagent.jsonc");
    });
  });

  describe("classify provider_transient classification", () => {
    it.each([
      ["Error: rate limit exceeded for model claude-sonnet"],
      ["Request failed with status 429: Too Many Requests"],
      ["Service is currently overloaded, please try again later"],
      ["Anthropic API quota exceeded for this billing period"],
      ["Provider returned: retrying in 30 seconds"],
      ["503 Service Unavailable"],
      ["You have exhausted your capacity for this model"],
      ["Cooling down before next request"],
      ["Gateway Timeout"],
    ])("should classify %j as provider_transient when in provider context", (input) => {
      expect(classifier.classify(input, { isProviderContext: true })).toBe("provider_transient");
    });

    it("should NOT classify transient patterns as provider_transient by default", () => {
      expect(classifier.classify("rate limit")).toBe("unknown");
      expect(classifier.classify("503 Service Unavailable")).toBe("unknown");
    });
  });

  describe("classify provider_config classification", () => {
    it.each([
      ["AI_LoadAPIKeyError: API key is missing. Set ANTHROPIC_API_KEY"],
      ["Error: model not found: claude-opus-99"],
      ["model_not_supported by current provider"],
      ["providerModelNotFoundError: gpt-99 unavailable"],
      ["Missing API key in environment"],
    ])("should classify %j as provider_config when in provider context", (input) => {
      expect(classifier.classify(input, { isProviderContext: true })).toBe("provider_config");
    });

    it("should NOT classify config patterns as provider_config by default", () => {
      expect(classifier.classify("missing api key")).toBe("unknown");
    });
  });

  describe("shouldRetry provider errors", () => {
    it("should never retry provider_transient errors", () => {
      expect(classifier.shouldRetry("provider_transient", 0)).toBe(false);
      expect(classifier.shouldRetry("provider_transient", 5)).toBe(false);
    });

    it("should never retry provider_config errors", () => {
      expect(classifier.shouldRetry("provider_config", 0)).toBe(false);
    });
  });

  describe("priority / boundary cases", () => {
    it("should prioritize type_error over provider_transient", () => {
      expect(classifier.classify("TypeError: caused by rate limit", { isProviderContext: true })).toBe("type_error");
    });

    it("should prioritize test_failure over provider patterns", () => {
      expect(classifier.classify("FAIL tests/quota.test.ts", { isProviderContext: true })).toBe("test_failure");
    });

    it("should prioritize provider_transient over generic timeout", () => {
      // "Gateway Timeout" contains "timeout", but should be "provider_transient"
      expect(classifier.classify("Gateway Timeout", { isProviderContext: true })).toBe("provider_transient");
    });

    it("should classify config-only text as provider_config in provider context", () => {
      expect(classifier.classify("missing api key", { isProviderContext: true })).toBe("provider_config");
    });

    it("should classify transient-only text as provider_transient in provider context", () => {
      expect(classifier.classify("rate limit", { isProviderContext: true })).toBe("provider_transient");
    });
  });

  describe("per-pattern coverage — provider_transient", () => {
    const transientSamples: [RegExp, string][] = [
      [/rate.?limit/i, "rate limit exceeded"],
      [/too.?many.?requests/i, "too many requests"],
      [/quota\s+will\s+reset\s+after/i, "quota will reset after 1 hour"],
      [/quota.?exceeded/i, "quota exceeded"],
      [/exhausted\s+your\s+capacity/i, "exhausted your capacity"],
      [/all\s+credentials\s+for\s+model/i, "all credentials for model exhausted"],
      [/cool(?:ing)?\s+down/i, "cooling down"],
      [/service.?unavailable/i, "service unavailable"],
      [/overloaded/i, "server overloaded"],
      [/temporarily.?unavailable/i, "temporarily unavailable"],
      [/\b429\b/, "429 Too Many Requests"],
      [/\b503\b/, "503 Service Unavailable"],
      [/\b504\b/, "504 Gateway Timeout"],
      [/\b529\b/, "529 Site is overloaded"],
      [/retrying\s+in/i, "retrying in 30s"],
    ];

    it.each(transientSamples)(
      "pattern %s should match %j as provider_transient when in provider context",
      (_pattern, sample) => {
        expect(classifier.classify(sample, { isProviderContext: true })).toBe("provider_transient");
      },
    );
  });

  describe("per-pattern coverage — provider_config", () => {
    const configSamples: [RegExp, string][] = [
      [/api.?key.?is.?missing/i, "api key is missing"],
      [/api.?key.*?must be a string/i, "api key must be a string"],
      [/model.{0,20}?not.{0,10}?supported/i, "model xyz not supported"],
      [/model.{0,20}?not.{0,10}?supported/i, "model_not_supported"],
      [/model\s+not\s+found/i, "model not found"],
      [/providerModelNotFoundError/i, "providerModelNotFoundError: gpt-5"],
      [/AI_LoadAPIKeyError/i, "AI_LoadAPIKeyError thrown"],
      [/missing.{0,10}?api.{0,10}?key/i, "missing api key"],
      [/payment.?required/i, "payment required"],
      [/usage\s+limit/i, "usage limit reached"],
      [/out\s+of\s+credits?/i, "out of credits"],
    ];

    it.each(configSamples)(
      "pattern %s should match %j as provider_config when in provider context",
      (_pattern, sample) => {
        expect(classifier.classify(sample, { isProviderContext: true })).toBe("provider_config");
      },
    );
  });
});
