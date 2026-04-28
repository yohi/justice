import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isDebugEnabled, debugLog } from "../../src/runtime/debug";

describe("debug utility", () => {
  const originalEnv = process.env.DEBUG;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.DEBUG = originalEnv;
    vi.restoreAllMocks();
  });

  describe("isDebugEnabled", () => {
    it("should return true when DEBUG=justice", () => {
      process.env.DEBUG = "justice";
      expect(isDebugEnabled()).toBe(true);
    });

    it("should return true when DEBUG=justice:*", () => {
      process.env.DEBUG = "justice:*";
      expect(isDebugEnabled()).toBe(true);
    });

    it("should return true when DEBUG=justice:sub-task", () => {
      process.env.DEBUG = "justice:sub-task";
      expect(isDebugEnabled()).toBe(true);
    });

    it("should return true when DEBUG=justice:123", () => {
      process.env.DEBUG = "justice:123";
      expect(isDebugEnabled()).toBe(true);
    });

    it("should return true when it is part of a list", () => {
      process.env.DEBUG = "other,justice:sub-task,another";
      expect(isDebugEnabled()).toBe(true);
    });

    it("should return false when DEBUG is empty", () => {
      process.env.DEBUG = "";
      expect(isDebugEnabled()).toBe(false);
    });

    it("should return false when DEBUG is different", () => {
      process.env.DEBUG = "other";
      expect(isDebugEnabled()).toBe(false);
    });

    it("should return false when it is a partial match without boundary", () => {
      process.env.DEBUG = "injustice";
      expect(isDebugEnabled()).toBe(false);
    });

    // Regression tests for strict boundary check
    it("should return false when DEBUG=justice:", () => {
      process.env.DEBUG = "justice:";
      expect(isDebugEnabled()).toBe(false);
    });

    it("should return false when DEBUG=justice:!", () => {
      process.env.DEBUG = "justice:!";
      expect(isDebugEnabled()).toBe(false);
    });
  });

  describe("debugLog", () => {
    it("should log when isDebugEnabled is true", () => {
      process.env.DEBUG = "justice";
      debugLog("test message", { foo: "bar" });
      expect(console.warn).toHaveBeenCalledWith("[Justice:debug] test message", { foo: "bar" });
    });

    it("should not log when isDebugEnabled is false", () => {
      process.env.DEBUG = "";
      debugLog("test message");
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
