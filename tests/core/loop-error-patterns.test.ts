import { describe, it, expect } from "vitest";
import { LOOP_ERROR_PATTERNS, matchesLoopError } from "../../src/core/loop-error-patterns";

describe("LOOP_ERROR_PATTERNS", () => {
  it("is a frozen array of RegExp", () => {
    expect(Array.isArray(LOOP_ERROR_PATTERNS)).toBe(true);
    expect(Object.isFrozen(LOOP_ERROR_PATTERNS)).toBe(true);
    for (const pattern of LOOP_ERROR_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

describe("matchesLoopError", () => {
  it("returns true for loop-detected phrases", () => {
    expect(matchesLoopError("loop detected in agent run")).toBe(true);
    expect(matchesLoopError("Loop Detect: halting")).toBe(true);
    expect(matchesLoopError("encountered an infinite loop")).toBe(true);
    expect(matchesLoopError("repetition limit exceeded")).toBe(true);
    expect(matchesLoopError("assistant made repeated tool calls")).toBe(true);
    expect(matchesLoopError("repeated attempts to reach the API")).toBe(true);
    expect(matchesLoopError("agent is stuck in a loop")).toBe(true);
    expect(matchesLoopError("stuck in an loop")).toBe(true);
    expect(matchesLoopError("too many iterations in planning")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(matchesLoopError("rate limit exceeded")).toBe(false);
    expect(matchesLoopError("timeout while calling provider")).toBe(false);
    expect(matchesLoopError("")).toBe(false);
  });
});
