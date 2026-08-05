// tests/core/justice-doctor-config.test.ts
import { describe, expect, it } from "vitest";
import {
  isJusticeSpecifier,
  mergeSourceScans,
  parseJsonc,
  scanConfigContent,
  scanUnreadableSource,
  type SourceScanResult,
} from "../../src/core/doctor-config";

describe("parseJsonc()", () => {
  it("parses JSONC with line/block comments and trailing commas", () => {
    const content = `{
      // line comment
      "plugin": [
        "@yohi/justice@3.0.0", /* block */
      ],
    }`;
    const result = parseJsonc(content);
    expect(result).toEqual({ ok: true, value: { plugin: ["@yohi/justice@3.0.0"] } });
  });

  it("does not strip comment-like text inside strings", () => {
    const result = parseJsonc(`{"plugin": ["@yohi/justice", "a // b", "c /* d */ e"]}`);
    expect(result).toEqual({
      ok: true,
      value: { plugin: ["@yohi/justice", "a // b", "c /* d */ e"] },
    });
  });

  it("does not remove trailing commas inside strings", () => {
    const result = parseJsonc(`{"plugin": ["text, ]", "more, }"]}`);
    expect(result).toEqual({ ok: true, value: { plugin: ["text, ]", "more, }"] } });
  });

  it("rejects an unterminated block comment with a clear error", () => {
    const result = parseJsonc(`{ "plugin": [ /* unfinished `);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unterminated block comment");
    }
  });

  it("handles escaped characters inside strings", () => {
    const result = parseJsonc(`{"plugin": ["\\\\", "\\"", "@yohi/justice"]}`);
    expect(result).toEqual({
      ok: true,
      value: { plugin: ["\\", '"', "@yohi/justice"] },
    });
  });

  it("skips line comments that appear after a trailing comma", () => {
    const result = parseJsonc(`{"plugin": ["@yohi/justice"], // trailing comment\n}`);
    expect(result).toEqual({ ok: true, value: { plugin: ["@yohi/justice"] } });
  });
});

describe("scanConfigContent()", () => {
  it("extracts string and tuple specifiers", () => {
    const result = scanConfigContent(
      "project",
      `{ "plugin": ["@yohi/justice@3.0.0", ["@yohi/justice", { "enableAdvisoryOutputAppend": true }]] }`,
    );
    expect(result.specifiers).toEqual([
      { specifier: "@yohi/justice@3.0.0", optionsPresent: false, optionKeys: [] },
      {
        specifier: "@yohi/justice",
        optionsPresent: true,
        optionKeys: ["enableAdvisoryOutputAppend"],
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("records parse_error for broken JSONC and does not throw", () => {
    const result = scanConfigContent("global", `{ "plugin": [`);
    expect(result.specifiers).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "parse_error", source: "global", detail: expect.any(String) },
    ]);
  });

  it("records plugin_missing when the field is absent", () => {
    const result = scanConfigContent("global", `{ "model": "x" }`);
    expect(result.diagnostics).toEqual([{ code: "plugin_missing", source: "global" }]);
  });

  it("records plugin_not_array when plugin is not an array", () => {
    const result = scanConfigContent("global", `{ "plugin": "@yohi/justice" }`);
    expect(result.diagnostics).toEqual([{ code: "plugin_not_array", source: "global" }]);
  });

  it.each([
    ["null entry", `{"plugin": [null, "@yohi/justice"]}`, 1],
    ["number entry", `{"plugin": [123, "@yohi/justice"]}`, 1],
    ["tuple of length 3", `{"plugin": [["@yohi/justice", {}, "extra"]]}`, 0],
    ["tuple with non-string head", `{"plugin": [[123, {}]]}`, 0],
    ["tuple with non-object options", `{"plugin": [["@yohi/justice", "yes"]]}`, 0],
  ])(
    "records invalid_plugin_entry for %s and still extracts valid entries",
    (_label, content, expectedCount) => {
      const result = scanConfigContent("project", content);
      expect(result.diagnostics.some((d) => d.code === "invalid_plugin_entry")).toBe(true);
      expect(result.specifiers.filter((s) => s.specifier === "@yohi/justice")).toHaveLength(
        expectedCount,
      );
    },
  );

  it("detects justice in plain-JSON global config (non-JSONC)", () => {
    const result = scanConfigContent("global", `{"plugin":["@yohi/justice@2.7.0"]}`);
    expect(result.specifiers).toHaveLength(1);
  });

  it("detects absolute-path registrations whose basename is justice or starts with justice-", () => {
    const result = scanConfigContent(
      "project",
      `{"plugin": ["/home/user/justice"]}`
    );
    expect(result.specifiers[0]?.specifier).toBe("/home/user/justice");
  });

  it("sorts option keys alphabetically for tuple specifiers", () => {
    const result = scanConfigContent(
      "project",
      `{"plugin": [["@yohi/justice", {"b": 1, "a": 2, "c": 3}]]}`,
    );
    expect(result.specifiers[0]?.optionKeys).toEqual(["a", "b", "c"]);
  });
});

describe("isJusticeSpecifier()", () => {
  it("rejects absolute paths where 'justice' appears only as a substring in another segment", () => {
    expect(isJusticeSpecifier("/home/user/injustice-report/index.ts")).toBe(false);
    expect(isJusticeSpecifier("/usr/local/lib/no-justice-helper/lib.js")).toBe(false);
  });

  it("accepts absolute paths whose basename is justice or starts with justice-", () => {
    expect(isJusticeSpecifier("/home/user/justice")).toBe(true);
    expect(isJusticeSpecifier("/path/to/justice-plugin")).toBe(true);
    expect(isJusticeSpecifier("/opt/justice-v2")).toBe(true);
  });
});

describe("mergeSourceScans()", () => {
  const scan = (source: SourceScanResult["source"], specifier: string): SourceScanResult => ({
    source,
    readable: true,
    specifiers: [{ specifier, optionsPresent: false, optionKeys: [] }],
    diagnostics: [],
  });

  it("reports justice_not_found_in_config when merged plugin list is empty", () => {
    const result = mergeSourceScans([
      { source: "global", readable: true, specifiers: [], diagnostics: [] },
    ]);
    expect(result.specifiers).toEqual([]);
    expect(result.diagnostics.some((d) => d.code === "justice_not_found_in_config")).toBe(true);
  });

  it("higher-priority source wins on conflicting justice entries", () => {
    // global(2) に 2.7.0、.opencode(5) に 3.0.0 → .opencode 側が優先（設計書 §9.1.0 fixture）
    const result = mergeSourceScans([
      scan("global", "@yohi/justice@2.7.0"),
      scan("dot_opencode", "@yohi/justice@3.0.0"),
    ]);
    expect(result.specifiers).toEqual([
      { specifier: "@yohi/justice@3.0.0", optionsPresent: false, optionKeys: [] },
    ]);
  });

  it("env_config / project / dot_opencode / env_config_dir are all merged", () => {
    const result = mergeSourceScans([scan("env_config", "@yohi/justice@3.0.0")]);
    expect(result.specifiers[0]?.specifier).toBe("@yohi/justice@3.0.0");
  });

  it("keeps distinct non-justice plugins while deduping justice by package name", () => {
    const result = mergeSourceScans([
      {
        source: "global",
        readable: true,
        specifiers: [
          { specifier: "@yohi/justice@2.7.0", optionsPresent: false, optionKeys: [] },
          { specifier: "other-plugin", optionsPresent: false, optionKeys: [] },
        ],
        diagnostics: [],
      },
      scan("project", "@yohi/justice@3.0.0"),
    ]);
    const names = result.specifiers.map((s) => s.specifier);
    expect(names).toContain("other-plugin");
    expect(names).toContain("@yohi/justice@3.0.0");
    expect(names).not.toContain("@yohi/justice@2.7.0");
  });
});

describe("scanUnreadableSource()", () => {
  it("reports unsupported_config_source when OPENCODE_CONFIG_CONTENT contains justice", () => {
    const result = scanUnreadableSource(
      "env_config_content",
      `{"plugin": ["@yohi/justice@3.0.0"]}`,
    );
    expect(result.diagnostics).toEqual([
      { code: "unsupported_config_source", source: "env_config_content" },
    ]);
  });

  it("reports nothing when the unreadable source has no justice reference", () => {
    const result = scanUnreadableSource("env_config_content", `{"plugin": ["other"]}`);
    expect(result.diagnostics).toEqual([]);
  });

  it("detects justice in unreadable source when JSONC parse fails but specifier appears as a string literal", () => {
    const result = scanUnreadableSource("managed", `{ "plugin": ["@yohi/justice"]`);
    expect(result.diagnostics).toEqual([{ code: "unsupported_config_source", source: "managed" }]);
  });

  it("detects justice tuple entries in unreadable parsed source", () => {
    const result = scanUnreadableSource(
      "env_config_content",
      `{"plugin":[["@yohi/justice",{}]]}`,
    );
    expect(result.diagnostics).toEqual([
      { code: "unsupported_config_source", source: "env_config_content" },
    ]);
  });

  it("reports nothing for unreadable source with a parse-failing but justice-free string", () => {
    const result = scanUnreadableSource("managed", `{ "plugin": ["other-plugin"]`);
    expect(result.diagnostics).toEqual([]);
  });

  it("continues scanning after the first justice specifier occurrence in parse-failing content", () => {
    const result = scanUnreadableSource(
      "managed",
      `{ "plugin": ["@yohi/justice", "@yohi/justice"]`,
    );
    expect(result.diagnostics).toEqual([{ code: "unsupported_config_source", source: "managed" }]);
  });

  it("reports nothing for parsed unreadable source with non-string plugin entries", () => {
    const result = scanUnreadableSource("managed", `{"plugin": [null, 123]}`);
    expect(result.diagnostics).toEqual([]);
  });

  it("continues scanning after a justice specifier in a comment when a later string occurrence matches", () => {
    const result = scanUnreadableSource(
      "managed",
      `/* @yohi/justice */ { "plugin": ["@yohi/justice"]`,
    );
    expect(result.diagnostics).toEqual([{ code: "unsupported_config_source", source: "managed" }]);
  });
});
