import { describe, expect, it } from "vitest";
import { compareUtf8, hasExactKeys, isPlainRecord, isRecord } from "../../../src/core/s1c/shared-utils.js";

describe("S1-c shared utilities", () => {
  it("distinguishes plain records from other non-null objects", () => {
    const nullPrototypeRecord = Object.setPrototypeOf({ value: 1 }, null);

    expect(isPlainRecord({ value: 1 })).toBe(true);
    expect(isPlainRecord(nullPrototypeRecord)).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(new Date())).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord(new Date())).toBe(false);
  });

  it("compares strings by UTF-8 byte order", () => {
    expect(compareUtf8("a", "é")).toBeLessThan(0);
    expect(compareUtf8("é", "a")).toBeGreaterThan(0);
    expect(compareUtf8("same", "same")).toBe(0);
  });

  it("requires exact own string keys including non-enumerable and symbol keys", () => {
    const record: Record<PropertyKey, unknown> = { required: true };
    Object.defineProperty(record, "hidden", { value: true });
    expect(hasExactKeys(record, ["required"])).toBe(false);
    Reflect.deleteProperty(record, "hidden");
    record[Symbol("extra")] = true;
    expect(hasExactKeys(record, ["required"])).toBe(false);
    expect(hasExactKeys({ required: true }, ["required"])).toBe(true);
  });
});
