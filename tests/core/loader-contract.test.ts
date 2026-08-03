// tests/core/loader-contract.test.ts
import { describe, expect, it } from "vitest";
import { checkLoaderContract } from "../../src/core/loader-contract";

describe("checkLoaderContract()", () => {
  it("accepts a module whose exports are all functions", () => {
    const plugin = async () => ({});
    const result = checkLoaderContract({ default: plugin, OpenCodePlugin: plugin });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    // default と named が同一関数オブジェクト → dedup 後 1 件
    expect(result.pluginFactories).toHaveLength(1);
  });

  it("accepts { server: fn } module-shape exports", () => {
    const server = async () => ({});
    const result = checkLoaderContract({ mod: { server } });
    expect(result.ok).toBe(true);
    expect(result.pluginFactories).toEqual([server]);
  });

  it("rejects non-function exports with their names and kinds", () => {
    const result = checkLoaderContract({
      AGENT_IDS: ["a"],
      DEFAULT_PERSONA: "atlas",
      OpenCodePlugin: async () => ({}),
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { exportName: "AGENT_IDS", actualKind: "array" },
      { exportName: "DEFAULT_PERSONA", actualKind: "string" },
    ]);
  });

  it("reports null and object exports as violations", () => {
    const result = checkLoaderContract({ A: null, B: { notServer: 1 } });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { exportName: "A", actualKind: "null" },
      { exportName: "B", actualKind: "object" },
    ]);
  });

  it("dedups repeated references before validating", () => {
    const fn = async () => ({});
    const result = checkLoaderContract({ a: fn, b: fn, c: fn });
    expect(result.pluginFactories).toHaveLength(1);
  });
});
