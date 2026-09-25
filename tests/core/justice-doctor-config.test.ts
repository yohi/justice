// tests/core/justice-doctor-config.test.ts
import { describe, expect, it } from "vitest";
import type { ControllerConfigurationAssessment } from "../../src/core/controller-routing";
import {
  assessDoctorControllerConfiguration,
  isJusticeSpecifier,
  mergeSourceScans,
  parseJsonc,
  projectDoctorEffectiveConfig,
  scanConfigContent,
  scanUnreadableSource,
  stripComments,
  type SourceScanResult,
} from "../../src/core/doctor-config";
import type { ControllerPinnedCommand } from "../../src/core/types";

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

  it("does not duplicate newlines when stripping line comments", () => {
    const result = stripComments("// a\n");
    expect(result).toEqual({ ok: true, content: "\n" });
  });

  it("does not duplicate newlines for consecutive line comments", () => {
    const result = stripComments("// a\n// b\n");
    expect(result).toEqual({ ok: true, content: "\n\n" });
  });

  it("strips a line comment at end of file without adding a newline", () => {
    const result = stripComments("// a");
    expect(result).toEqual({ ok: true, content: "" });
  });

  it("replaces block comments with whitespace to avoid token concatenation", () => {
    const result = stripComments(`{"plugin":[1/* comment */2]}`);
    expect(result).toEqual({ ok: true, content: `{"plugin":[1 2]}` });
  });

  it("reports a parse error when numbers are only separated by a block comment", () => {
    const result = parseJsonc(`{"plugin":[1/* comment */2]}`);
    expect(result.ok).toBe(false);
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
    const result = scanConfigContent("project", `{"plugin": ["/home/user/justice"]}`);
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

describe("projectDoctorEffectiveConfig()", () => {
  it("projects only the effective category names and exact pinned command definitions", () => {
    const projected = projectDoctorEffectiveConfig({
      category: {
        "sp-review": { model: "provider/model", secret: "do-not-copy" },
        quick: { description: "retain only the key name" },
      },
      command: {
        "justice-implement-brainstorming": {
          agent: "sisyphus",
          template: "do-not-copy",
        },
        unrelated: { agent: "atlas" },
      },
      provider: { apiKey: "do-not-copy" },
    });

    expect(projected).toEqual({
      kind: "available",
      view: {
        effectiveCategoryNames: ["sp-review", "quick"],
        effectiveCommandDefinitions: new Map([
          ["justice-implement-brainstorming", { kind: "valid", agent: "sisyphus" }],
        ]),
      },
    });
  });

  it("does not create a map entry for a missing pinned command", () => {
    const projected = projectDoctorEffectiveConfig({ category: {}, command: {} });

    expect(projected.kind).toBe("available");
    if (projected.kind !== "available") throw new Error("expected available");
    expect(projected.view.effectiveCommandDefinitions.size).toBe(0);
  });

  it("normalizes a pinned command with no agent as valid", () => {
    const projected = projectDoctorEffectiveConfig({
      command: { "justice-implement-writing-plans": { template: "do-not-copy" } },
    });

    expect(projected.kind).toBe("available");
    if (projected.kind !== "available") throw new Error("expected available");
    expect(
      projected.view.effectiveCommandDefinitions.get("justice-implement-writing-plans"),
    ).toEqual({ kind: "valid" });
  });

  it("normalizes a pinned command with a string agent as valid", () => {
    const projected = projectDoctorEffectiveConfig({
      command: { "justice-implement-subagent-driven-development": { agent: "atlas" } },
    });

    expect(projected.kind).toBe("available");
    if (projected.kind !== "available") throw new Error("expected available");
    expect(
      projected.view.effectiveCommandDefinitions.get(
        "justice-implement-subagent-driven-development",
      ),
    ).toEqual({ kind: "valid", agent: "atlas" });
  });

  it.each([
    ["null", null],
    ["scalar", 42],
    ["array", []],
    ["non-string agent", { agent: { name: "atlas" } }],
  ] as const)("normalizes a %s pinned command definition as invalid", (_label, definition) => {
    const projected = projectDoctorEffectiveConfig({
      command: { "justice-implement-executing-plans": definition },
    });

    expect(projected.kind).toBe("available");
    if (projected.kind !== "available") throw new Error("expected available");
    expect(
      projected.view.effectiveCommandDefinitions.get("justice-implement-executing-plans"),
    ).toEqual({ kind: "invalid" });
  });

  it.each([null, [], "invalid", 42])(
    "rejects a non-object resolved configuration with an explicit shape reason (%s)",
    (resolvedConfig) => {
      expect(projectDoctorEffectiveConfig(resolvedConfig)).toEqual({
        kind: "unsupported",
        reason: "resolved_config_shape_invalid",
      });
    },
  );
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

  it("accepts Justice package entry files below a Justice directory", () => {
    expect(isJusticeSpecifier("/path/to/justice/index.js")).toBe(true);
    expect(isJusticeSpecifier("/path/to/justice-plugin/index.js")).toBe(true);
  });

  it("does not treat an unrelated opencode-plugin filename as Justice", () => {
    expect(isJusticeSpecifier("/path/to/unrelated/opencode-plugin.js")).toBe(false);
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
    expect(result.diagnostics).toEqual([{ code: "justice_not_found_in_config", source: "merged" }]);
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

  it("dedupes justice specifiers that differ only by subpath", () => {
    const result = mergeSourceScans([
      scan("global", "@yohi/justice@2.7.0/subpath-a"),
      scan("project", "@yohi/justice@3.0.0/subpath-b"),
    ]);
    expect(result.specifiers).toEqual([
      { specifier: "@yohi/justice@3.0.0/subpath-b", optionsPresent: false, optionKeys: [] },
    ]);
  });

  it("dedupes non-scoped specifiers that differ only by subpath", () => {
    const result = mergeSourceScans([
      scan("global", "other-plugin@1.0.0/sub-a"),
      scan("project", "other-plugin@2.0.0/sub-b"),
    ]);
    expect(result.specifiers).toEqual([
      { specifier: "other-plugin@2.0.0/sub-b", optionsPresent: false, optionKeys: [] },
    ]);
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
    const result = scanUnreadableSource("env_config_content", `{"plugin":[["@yohi/justice",{}]]}`);
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

  it("does not detect justice inside tuple option values", () => {
    const result = scanUnreadableSource(
      "env_config_content",
      `{"plugin":[["other-plugin", {"note": "@yohi/justice"}]]}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("detects justice tuple entries even when options contain the word justice", () => {
    const result = scanUnreadableSource(
      "env_config_content",
      `{"plugin":[["@yohi/justice", {"note": "justice settings"}]]}`,
    );
    expect(result.diagnostics).toEqual([
      { code: "unsupported_config_source", source: "env_config_content" },
    ]);
  });
});

describe("assessDoctorControllerConfiguration()", () => {
  const findAssessment = (
    assessments: readonly ControllerConfigurationAssessment[],
    pinnedCommand: ControllerPinnedCommand,
  ): ControllerConfigurationAssessment => {
    const found = assessments.find((assessment) => assessment.pinnedCommand === pinnedCommand);
    if (found === undefined) throw new Error(`assessment not found: ${pinnedCommand}`);
    return found;
  };

  const exactFourSnapshot = {
    category: {},
    command: {
      "justice-implement-brainstorming": { agent: "sisyphus", template: "do-not-copy" },
      "justice-implement-writing-plans": { agent: "sisyphus" },
      "justice-implement-subagent-driven-development": { agent: "atlas" },
      "justice-implement-executing-plans": { agent: "sisyphus" },
    },
  } as const;

  it("assesses all four exact expected command/agent pairs as configured from an injected host-resolved snapshot", () => {
    const result = assessDoctorControllerConfiguration(
      projectDoctorEffectiveConfig(exactFourSnapshot),
    );

    expect(result).toEqual([
      {
        workflow: "brainstorming",
        desiredController: "sisyphus",
        pinnedCommand: "justice-implement-brainstorming",
        configuredController: "sisyphus",
        status: "configured",
      },
      {
        workflow: "writing-plans",
        desiredController: "sisyphus",
        pinnedCommand: "justice-implement-writing-plans",
        configuredController: "sisyphus",
        status: "configured",
      },
      {
        workflow: "subagent-driven-development",
        desiredController: "atlas",
        pinnedCommand: "justice-implement-subagent-driven-development",
        configuredController: "atlas",
        status: "configured",
      },
      {
        workflow: "executing-plans",
        desiredController: "sisyphus",
        pinnedCommand: "justice-implement-executing-plans",
        configuredController: "sisyphus",
        status: "configured",
      },
    ]);
  });

  it("reports a snapshot-available pinned command without a definition as missing", () => {
    const result = assessDoctorControllerConfiguration(
      projectDoctorEffectiveConfig({
        category: {},
        command: {
          "justice-implement-brainstorming": { agent: "sisyphus" },
          "justice-implement-writing-plans": { agent: "sisyphus" },
          "justice-implement-subagent-driven-development": { agent: "atlas" },
        },
      }),
    );

    expect(findAssessment(result, "justice-implement-executing-plans")).toEqual({
      workflow: "executing-plans",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-executing-plans",
      status: "missing",
      reason: "command_missing",
    });
  });

  it.each([
    ["recognized but wrong agent", { agent: "oracle" }, "oracle", "agent_mismatch"],
    ["unrecognized custom agent", { agent: "my-custom-agent" }, "my-custom-agent", "agent_invalid"],
  ] as const)(
    "reports a snapshot-available %s as misconfigured with its distinct reason",
    (_label, definition, configuredAgent, reason) => {
      const result = assessDoctorControllerConfiguration(
        projectDoctorEffectiveConfig({
          category: {},
          command: { "justice-implement-brainstorming": definition },
        }),
      );

      expect(findAssessment(result, "justice-implement-brainstorming")).toEqual({
        workflow: "brainstorming",
        desiredController: "sisyphus",
        pinnedCommand: "justice-implement-brainstorming",
        configuredController: configuredAgent,
        status: "misconfigured",
        reason,
      });
    },
  );

  it("reports a snapshot-available definition without an agent as misconfigured/agent_missing", () => {
    const result = assessDoctorControllerConfiguration(
      projectDoctorEffectiveConfig({
        category: {},
        command: { "justice-implement-writing-plans": { template: "do-not-copy" } },
      }),
    );

    expect(findAssessment(result, "justice-implement-writing-plans")).toEqual({
      workflow: "writing-plans",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-writing-plans",
      status: "misconfigured",
      reason: "agent_missing",
    });
  });

  it("reports a snapshot-available non-string agent as misconfigured/invalid_command_definition", () => {
    const result = assessDoctorControllerConfiguration(
      projectDoctorEffectiveConfig({
        category: {},
        command: { "justice-implement-writing-plans": { agent: 42 } },
      }),
    );

    expect(findAssessment(result, "justice-implement-writing-plans")).toEqual({
      workflow: "writing-plans",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-writing-plans",
      status: "misconfigured",
      reason: "invalid_command_definition",
    });
  });

  it.each([
    "resolved_config_command_unavailable",
    "resolved_config_command_failed",
    "resolved_config_host_version_unsupported",
    "resolved_config_timeout",
    "resolved_config_invalid_json",
    "resolved_config_context_unverified",
    "resolved_config_shape_invalid",
  ] as const)(
    "yields unsupported for every pinned command when the host result is unsupported (%s)",
    (reason) => {
      const result = assessDoctorControllerConfiguration({ kind: "unsupported", reason });

      expect(result).toHaveLength(4);
      for (const assessment of result) {
        expect(assessment.status).toBe("unsupported");
        expect(assessment.reason).toBe("effective_config_unsupported");
        expect(assessment.configuredController).toBeUndefined();
      }
    },
  );

  it("does not let a local config source with the exact four pairs convert an unsupported host result into configured", () => {
    const localScan = scanConfigContent(
      "project",
      JSON.stringify({ command: exactFourSnapshot.command }),
    );
    const result = assessDoctorControllerConfiguration({
      kind: "unsupported",
      reason: "resolved_config_host_version_unsupported",
    });

    // The local scan is advisory-only: no API converts SourceScanResult into assessments.
    expect(localScan.readable).toBe(true);
    expect(result.some((assessment) => assessment.status === "configured")).toBe(false);
    expect(
      result.every((assessment) => assessment.reason === "effective_config_unsupported"),
    ).toBe(true);
  });

  it("assesses exactly the four pinned commands of the controller-routing SSOT", () => {
    const result = assessDoctorControllerConfiguration(projectDoctorEffectiveConfig({}));

    expect(result.map((assessment) => assessment.pinnedCommand)).toEqual([
      "justice-implement-brainstorming",
      "justice-implement-writing-plans",
      "justice-implement-subagent-driven-development",
      "justice-implement-executing-plans",
    ]);
  });
});
