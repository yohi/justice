import { describe, it, expect } from "vitest";
import {
  PROVIDER_TRANSIENT_PATTERNS,
  PROVIDER_CONFIG_PATTERNS,
} from "../../src/core/provider-error-patterns";

describe("provider-error-patterns", () => {
  describe("PROVIDER_TRANSIENT_PATTERNS", () => {
    it("should be a frozen array of RegExp", () => {
      expect(Array.isArray(PROVIDER_TRANSIENT_PATTERNS)).toBe(true);
      expect(Object.isFrozen(PROVIDER_TRANSIENT_PATTERNS)).toBe(true);
      for (const pattern of PROVIDER_TRANSIENT_PATTERNS) {
        expect(pattern).toBeInstanceOf(RegExp);
      }
    });

    it("should contain 17 patterns", () => {
      expect(PROVIDER_TRANSIENT_PATTERNS).toHaveLength(17);
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

    it("should contain 7 patterns", () => {
      expect(PROVIDER_CONFIG_PATTERNS).toHaveLength(7);
    });
  });
});