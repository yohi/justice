// tests/core/v2/safe-segment.test.ts
import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { encodeSafeSegment } from "../../../src/core/v2/safe-segment";

function h(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

describe("encodeSafeSegment()", () => {
  it("encodes a normal segment as <safe>__<8hex>", () => {
    expect(encodeSafeSegment("hello")).toBe(`hello__${h("hello")}`);
  });

  it('encodes "." as _dot___<8hex>', () => {
    expect(encodeSafeSegment(".")).toBe(`_dot___${h(".")}`);
  });

  it('encodes ".." as _dotdot___<8hex>', () => {
    expect(encodeSafeSegment("..")).toBe(`_dotdot___${h("..")}`);
  });

  it('encodes "" (empty string) as _empty___<8hex>', () => {
    expect(encodeSafeSegment("")).toBe(`_empty___${h("")}`);
  });

  it("replaces unsafe chars with underscores", () => {
    const seg = "foo/bar baz";
    const safePart = "foo_bar_baz";
    expect(encodeSafeSegment(seg)).toBe(`${safePart}__${h(seg)}`);
  });

  it("replaces spaces and special chars but preserves alphanumeric, _, -", () => {
    const seg = "my-task_01!@#";
    const safePart = "my-task_01___";
    expect(encodeSafeSegment(seg)).toBe(`${safePart}__${h(seg)}`);
  });

  it("truncates the safe part to 64 chars before the suffix", () => {
    const longSeg = "a".repeat(100);
    const result = encodeSafeSegment(longSeg);
    // Derive the safe part from the deterministic 8-hex suffix length ("__" + 8 hex = 10 chars)
    // rather than split("__"), which would mis-split if the safe part itself contained "__".
    const suffix = `__${h(longSeg)}`;
    expect(result.endsWith(suffix)).toBe(true);
    const safePart = result.slice(0, result.length - suffix.length);
    expect(safePart).toHaveLength(64);
    expect(result).toBe(`${"a".repeat(64)}${suffix}`);
  });

  it("is deterministic — same input always produces the same output", () => {
    const seg = "some/arbitrary-segment_123";
    expect(encodeSafeSegment(seg)).toBe(encodeSafeSegment(seg));
  });
});
