// tests/core/v2/hash.test.ts
import { describe, expect, it } from "vitest";
import { hashString } from "../../../src/core/v2/hash";

describe("hashString", () => {
  it("returns a string starting with sha256: followed by 64 hex chars", () => {
    const result = hashString("test");
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic: same input produces same output", () => {
    const a = hashString("hello world");
    const b = hashString("hello world");
    expect(a).toBe(b);
  });

  it("different inputs produce different outputs", () => {
    const a = hashString("input_a");
    const b = hashString("input_b");
    expect(a).not.toBe(b);
  });
});
