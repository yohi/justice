import { describe, expect, it } from "vitest";

/**
 * Positive OpenCode v2.3.2 loader contract.
 * Reference: packages/core/src/plugin/module.ts (OpenCode v2.3.2) expects the
 * default export to match {id:string,effect:function} or {id:string,setup:function}.
 */
function satisfiesLoaderContract(mod: unknown): boolean {
  if (typeof mod !== "object" || mod === null) return false;
  const def = (mod as { default?: unknown }).default;
  if (typeof def !== "object" || def === null) return false;
  const candidate = def as { id?: unknown; setup?: unknown; effect?: unknown };
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
  return typeof candidate.setup === "function" || typeof candidate.effect === "function";
}

describe("satisfiesLoaderContract helper (negative cases)", () => {
  it("accepts {id, setup}", () => {
    expect(satisfiesLoaderContract({ default: { id: "x", setup: () => undefined } })).toBe(true);
  });

  it("accepts {id, effect}", () => {
    expect(satisfiesLoaderContract({ default: { id: "x", effect: () => undefined } })).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(satisfiesLoaderContract({ default: { setup: () => undefined } })).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(satisfiesLoaderContract({ default: { id: "", setup: () => undefined } })).toBe(false);
  });

  it("rejects a non-function setup and no effect", () => {
    expect(satisfiesLoaderContract({ default: { id: "x", setup: "nope" } })).toBe(false);
  });

  it("rejects a function default export", () => {
    expect(satisfiesLoaderContract({ default: () => undefined })).toBe(false);
  });
});

describe("OpenCode v2.3.2 loader contract", () => {
  it("the existing V1 entry does not satisfy the V2 shape", async () => {
    const v1 = await import("../../src/opencode-plugin.js");
    expect(typeof v1.default).toBe("function");
    expect(satisfiesLoaderContract(v1)).toBe(false);
  });

  it("the V2 entry default export satisfies {id, setup|effect}", async () => {
    const v2: unknown = await import("../../src/opencode-v2-plugin.js").catch(() => undefined);
    expect(satisfiesLoaderContract(v2)).toBe(true);
  });
});
