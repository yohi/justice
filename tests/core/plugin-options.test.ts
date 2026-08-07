// tests/core/plugin-options.test.ts
import { describe, expect, it } from "vitest";
import { validatePluginOptions } from "../../src/core/plugin-options";

describe("validatePluginOptions()", () => {
  it("returns empty options and no warnings for undefined / null", () => {
    expect(validatePluginOptions(undefined)).toEqual({ options: {}, warnings: [] });
    expect(validatePluginOptions(null)).toEqual({ options: {}, warnings: [] });
  });

  it("accepts a boolean enableAdvisoryOutputAppend", () => {
    expect(validatePluginOptions({ enableAdvisoryOutputAppend: true })).toEqual({
      options: { enableAdvisoryOutputAppend: true },
      warnings: [],
    });
    expect(validatePluginOptions({ enableAdvisoryOutputAppend: false })).toEqual({
      options: { enableAdvisoryOutputAppend: false },
      warnings: [],
    });
  });

  it("ignores unknown keys silently (forward compatibility)", () => {
    const result = validatePluginOptions({ futureOption: 123, enableAdvisoryOutputAppend: true });
    expect(result.options).toEqual({ enableAdvisoryOutputAppend: true });
    expect(result.warnings).toEqual([]);
  });

  it("falls back to the default with a warning on type mismatch", () => {
    const result = validatePluginOptions({ enableAdvisoryOutputAppend: "yes" });
    expect(result.options).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("enableAdvisoryOutputAppend");
    expect(result.warnings[0]).toContain("string");
  });

  it("warns and ignores everything for a non-object options value", () => {
    for (const raw of ["yes", 42, ["enableAdvisoryOutputAppend"]]) {
      const result = validatePluginOptions(raw);
      expect(result.options).toEqual({});
      expect(result.warnings).toHaveLength(1);
    }
  });
});

it("returns empty options and a warning when reading enableAdvisoryOutputAppend throws", () => {
  const throwing = new Proxy<Record<string, unknown>>(
    {},
    {
      get(_target, prop) {
        if (prop === "enableAdvisoryOutputAppend") {
          throw new Error("proxy throw");
        }
        return undefined;
      },
    },
  );
  const result = validatePluginOptions(throwing);
  expect(result.options).toEqual({});
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain("enableAdvisoryOutputAppend");
  expect(result.warnings[0]).toContain("proxy throw");
  expect(result.warnings[0]).toContain("false");
});
