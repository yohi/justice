// tests/runtime/doctor-cli.test.ts
import { describe, expect, it } from "vitest";
import { runDoctor, type DoctorDeps } from "../../src/runtime/doctor-cli";
import {
  formatConfigDiagnostics,
  formatContractResult,
  formatLogScanLines,
  isJusticeSpecifier,
  resolveAndCheckSpecifier,
} from "../../src/runtime/doctor-cli-helpers";
import type { FileReader } from "../../src/core/types";

function mockReader(files: Record<string, string>): FileReader {
  return {
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) {
        const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    },
    fileExists: async (path: string) => path in files,
    listFiles: async (prefix: string) => {
      const matches: string[] = [];
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix)) {
          matches.push(key);
        } else {
          // readdir(..., { recursive: true }) semantics: caller passes a directory prefix
          // and expects every file under that prefix, regardless of depth.
          // For pathological mock lookups like a file path, fall back to directory containment.
          const lastSlash = prefix.lastIndexOf("/");
          const dir = lastSlash >= 0 ? prefix.slice(0, lastSlash) : "";
          if (dir !== "" && key.startsWith(dir)) {
            matches.push(key);
          }
        }
      }
      return matches;
    },
    readFileStats: async (path: string) =>
      path in files ? { size: files[path]!.length, mtimeMs: 1000 } : null,
  };
}

function baseDeps(overrides: Partial<DoctorDeps>): DoctorDeps {
  return {
    fileReader: mockReader({}),
    env: {},
    cwd: "/proj",
    homeDir: "/home/user",
    cacheRoot: "/home/user/.cache/opencode",
    logPaths: [],
    importer: async () => {
      throw new Error("importer not configured");
    },
    ...overrides,
  };
}

const GLOBAL_CONFIG = "/home/user/.config/opencode/opencode.jsonc";
const CACHE_300 =
  "/home/user/.cache/opencode/packages/@yohi/justice@3.0.0/node_modules/@yohi/justice";

function healthyFixture(): Record<string, string> {
  return {
    [GLOBAL_CONFIG]: `{ "plugin": ["@yohi/justice@3.0.0"] }`,
    [`${CACHE_300}/package.json`]: JSON.stringify({
      name: "@yohi/justice",
      version: "3.0.0",
      exports: { ".": { import: "./dist/opencode-plugin.js" } },
    }),
    [`${CACHE_300}/dist/opencode-plugin.js`]: "// plugin",
  };
}

describe("runDoctor()", () => {
  it("exits 0 when the configured plugin resolves and satisfies the loader contract", async () => {
    const plugin = async () => ({});
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(healthyFixture()),
        importer: async () => ({ default: plugin, OpenCodePlugin: plugin }),
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("@yohi/justice@3.0.0");
    expect(result.text).not.toContain("✗");
  });

  it("exits 1 and prints the §9.2 guidance when the entry violates the loader contract", async () => {
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(healthyFixture()),
        // barrel 形状（2.7.0 事故の再現）
        importer: async () => ({
          AGENT_IDS: ["a"],
          DEFAULT_PERSONA: "atlas",
          OpenCodePlugin: async () => ({}),
        }),
      }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("ローダ契約を満たしていません");
    expect(result.text).toContain("AGENT_IDS");
    expect(result.text).toContain("DEFAULT_PERSONA");
    expect(result.text).toContain("3.0.0 以上に更新");
  });

  it("exits 1 with justice_not_found_in_config when no justice plugin is configured", async () => {
    const result = await runDoctor(
      baseDeps({ fileReader: mockReader({ [GLOBAL_CONFIG]: `{ "plugin": [] }` }) }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("justice_not_found_in_config");
  });

  it("reports unsupported_config_source for OPENCODE_CONFIG_CONTENT with justice", async () => {
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(healthyFixture()),
        env: { OPENCODE_CONFIG_CONTENT: `{"plugin":["@yohi/justice"]}` },
        importer: async () => ({ default: async () => ({}) }),
      }),
    );
    expect(result.text).toContain("unsupported_config_source");
  });

  it("reports ambiguous_versions without silently picking one", async () => {
    const cache270 =
      "/home/user/.cache/opencode/packages/@yohi/justice@2.7.0/node_modules/@yohi/justice";
    const files = {
      ...healthyFixture(),
      [GLOBAL_CONFIG]: `{ "plugin": ["@yohi/justice"] }`,
      [`${cache270}/package.json`]: JSON.stringify({ version: "2.7.0", exports: {} }),
    };
    const result = await runDoctor(baseDeps({ fileReader: mockReader(files) }));
    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("ambiguous_versions");
    expect(result.text).toContain("2.7.0");
    expect(result.text).toContain("3.0.0");
  });

  it("reports log scan findings (failed to load / initialized)", async () => {
    const logPath = "/home/user/.local/share/opencode/log/2026-08-02.log";
    const files = {
      ...healthyFixture(),
      [logPath]: `level=ERROR message="failed to load plugin" path=@yohi/justice@2.7.0 error="x"\nlevel=INFO service=justice message="Justice initialized via opencode-adapter"`,
    };
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(files),
        logPaths: [logPath],
        importer: async () => ({ default: async () => ({}) }),
      }),
    );
    expect(result.text).toContain("failed to load plugin");
    expect(result.text).toContain("Justice initialized");
  });

  it("summarizes nested .justice/events shards", async () => {
    const shard = "/proj/.justice/events/atlas/sess-1/w-1.jsonl";
    const files = {
      ...healthyFixture(),
      [shard]: `{"sequence":1}\n{"sequence":2}\n`,
      "/proj/.justice/gate.yaml": `gates: []`,
    };
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(files),
        importer: async () => ({ default: async () => ({}) }),
      }),
    );
    expect(result.text).toContain(".justice/events:");
    expect(result.text).toContain("shard 1 件 / レコード 2 件");
    expect(result.text).not.toContain("未観測");
  });

  it("redacts secrets emitted during gate.yaml loading", async () => {
    const secret = "sk-ant-012345678901234567890123456789";
    // missing required fields forces parseGateYaml to throw, causing loadGates to log a warning
    // that includes the raw YAML content containing the secret.
    const files = {
      ...healthyFixture(),
      "/proj/.justice/gate.yaml": `schemaVersion: 1\nauthority: human_approved\ngates:\n  - id: bad\n    description: ${secret}`,
    };
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(files),
        importer: async () => ({ default: async () => ({}) }),
      }),
    );
    // If the warning went to console instead of being collected into runDoctor's lines,
    // the gate.yaml warning message itself would not appear in result.text.
    expect(result.text).toContain("Failed to parse gates configuration");
    expect(result.text).toContain("falling back to defaults");
    expect(result.text).toContain("gate.yaml 読込警告");
    expect(result.text).not.toContain(secret);
    expect(result.text).toContain("[REDACTED_SECRET]");
  });

  it("summarizes a valid gate.yaml without warnings", async () => {
    const files = {
      ...healthyFixture(),
      "/proj/.justice/gate.yaml": `schemaVersion: 1\nauthority: human_approved\ngates: []`,
    };
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(files),
        importer: async () => ({ default: async () => ({}) }),
      }),
    );
    expect(result.text).toContain(".justice/gate.yaml: 有効（実効 gate:");
    expect(result.text).toContain("required-tests");
    expect(result.text).toContain("build-green");
    expect(result.text).toContain("review-clean");
    expect(result.text).not.toContain("gate.yaml 読込警告");
  });

  it("redacts secrets from diagnostic output", async () => {
    const token = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789";
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader({
          [GLOBAL_CONFIG]: `{ "plugin": ["@yohi/justice@3.0.0"], "note": "${token}" }`,
        }),
        importer: async () => ({ AGENT_IDS: ["x"] }), // 契約違反で detail を出させる
      }),
    );
    expect(result.text).not.toContain(token);
  });

  it("covers configCandidates enumeration paths", async () => {
    const result = await runDoctor(
      baseDeps({
        env: {
          OPENCODE_CONFIG: "/env/opencode.json",
          OPENCODE_CONFIG_DIR: "/env/dir",
          OPENCODE_CONFIG_CONTENT: `{"plugin":["@yohi/justice"]}`,
        },
        homeDir: undefined,
        fileReader: mockReader({}),
      }),
    );
    expect(result.text).toContain("unsupported_config_source");
  });

  it("covers helper functions directly", async () => {
    expect(isJusticeSpecifier("@yohi/justice")).toBe(true);
    expect(isJusticeSpecifier("@yohi/justice@3.0.0")).toBe(true);
    expect(isJusticeSpecifier("@yohi/justice/core")).toBe(true);
    expect(isJusticeSpecifier("/opt/justice/dist/opencode-plugin.js")).toBe(true);
    expect(isJusticeSpecifier("other-plugin")).toBe(false);

    expect(formatConfigDiagnostics([{ code: "plugin_missing", source: "project" }])).toEqual([]);
    expect(
      formatConfigDiagnostics([{ code: "justice_not_found_in_config", source: "project" }]),
    ).toEqual(["  ✗ justice_not_found_in_config: 設定に @yohi/justice が見つかりません"]);
    expect(
      formatConfigDiagnostics([
        { code: "unsupported_config_source", source: "env_config_content" },
      ]),
    ).toEqual([
      "  ! unsupported_config_source: env_config_content に justice 系 plugin がありますが、このソースは doctor から読み込めません。手動で確認してください。",
    ]);
    expect(
      formatConfigDiagnostics([{ code: "invalid_plugin_entry", source: "project", detail: "x" }]),
    ).toEqual(["  ! invalid_plugin_entry: project (x)"]);

    const okContract = formatContractResult({
      ok: true,
      violations: [],
      pluginFactories: [async () => ({})],
    });
    expect(okContract).toEqual(["  ✓ ローダ契約 OK（plugin factory: 1 件）"]);
    const ngContract = formatContractResult({
      ok: false,
      violations: [{ exportName: "AGENT_IDS", actualKind: "object" }],
      pluginFactories: [],
    });
    expect(ngContract.some((l) => l.includes("AGENT_IDS"))).toBe(true);
    expect(
      ngContract.some((l) =>
        l.includes("plugin エントリが OpenCode のローダ契約を満たしていません"),
      ),
    ).toBe(true);

    const logLines = await formatLogScanLines(baseDeps({ logPaths: ["/missing.log"] }));
    expect(logLines).toContain("  /missing.log: 読み込めません");
  });

  it("resolves a healthy specifier through resolveAndCheckSpecifier", async () => {
    const plugin = async () => ({});
    const section = await resolveAndCheckSpecifier(
      { specifier: "@yohi/justice@3.0.0", optionsPresent: false, optionKeys: [] },
      baseDeps({
        fileReader: mockReader(healthyFixture()),
        importer: async () => ({ default: plugin, OpenCodePlugin: plugin }),
      }),
    );
    expect(section.failed).toBe(false);
    expect(section.lines).toContain("  ✓ ローダ契約 OK（plugin factory: 1 件）");
  });
});
