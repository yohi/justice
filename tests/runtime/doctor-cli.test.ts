// tests/runtime/doctor-cli.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDoctorHostCommandRunner,
  createDoctorHostConfigReader,
  formatControllerAssessmentLine,
  resolveCacheRoot,
  runDoctor,
  runStatus,
  type DoctorHostCommandResult,
  type DoctorHostCommandRunner,
  type DoctorHostProcess,
  type DoctorDeps,
} from "../../src/runtime/doctor-cli";
import type { ControllerConfigurationAssessment } from "../../src/core/controller-routing";
import { ALL_SP_CATEGORIES } from "../../src/core/doctor-categories";
import {
  isJusticeSpecifier,
  projectDoctorEffectiveConfig,
  type DoctorEffectiveCommandDefinition,
} from "../../src/core/doctor-config";
import {
  formatConfigDiagnostics,
  formatContractResult,
  formatLogScanLines,
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

function allFourConfiguredCommands(): ReadonlyMap<string, DoctorEffectiveCommandDefinition> {
  return new Map<string, DoctorEffectiveCommandDefinition>([
    ["justice-implement-brainstorming", { kind: "valid", agent: "sisyphus" }],
    ["justice-implement-writing-plans", { kind: "valid", agent: "sisyphus" }],
    ["justice-implement-subagent-driven-development", { kind: "valid", agent: "atlas" }],
    ["justice-implement-executing-plans", { kind: "valid", agent: "sisyphus" }],
  ]);
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
    hostConfigReader: async () => ({
      kind: "available",
      view: {
        effectiveCategoryNames: ALL_SP_CATEGORIES,
        effectiveCommandDefinitions: allFourConfiguredCommands(),
      },
    }),
    ...overrides,
  };
}

function commandResult(overrides: Partial<DoctorHostCommandResult> = {}): DoctorHostCommandResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

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
  it("returns JSON analytics from the status CLI path", async () => {
    const output = await runStatus(".", "package.json", true, true);
    const parsed = JSON.parse(output) as { analytics: { failureRate: number } };

    expect(parsed.analytics.failureRate).toBe(0);
  });

  it("returns markdown status without analytics when the flag is omitted", async () => {
    const output = await runStatus(".", "package.json", false, false);

    expect(output).toContain("Plan Status");
  });
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
    expect(result.text).not.toContain(secret);
  });

  it("redacts AWS secret access key values from doctor diagnostics", async () => {
    const secret = "aws-secret-value-that-must-not-leak";
    const logPath = "/home/user/.local/share/opencode/log/doctor.log";
    const files = {
      ...healthyFixture(),
      [logPath]: `level=ERROR failed to load plugin path=@yohi/justice@3.0.0 AWS_SECRET_ACCESS_KEY=${secret}`,
    };

    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(files),
        logPaths: [logPath],
        importer: async () => ({ default: async () => ({}) }),
      }),
    );

    expect(result.text).not.toContain(secret);
    expect(result.text).toContain("[REDACTED_ENV]");
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

  it("redacts mixed-case credential pairs and uppercase environment values", async () => {
    const configuredCredential = "apiKey=lowercase-value API_KEY=UPPERCASE_VALUE";
    const result = await runDoctor(
      baseDeps({
        hostConfigReader: async () => ({
          kind: "available",
          view: {
            effectiveCategoryNames: ALL_SP_CATEGORIES,
            effectiveCommandDefinitions: new Map([
              ["justice-implement-brainstorming", { kind: "valid", agent: configuredCredential }],
              ["justice-implement-writing-plans", { kind: "valid", agent: "sisyphus" }],
              ["justice-implement-subagent-driven-development", { kind: "valid", agent: "atlas" }],
              ["justice-implement-executing-plans", { kind: "valid", agent: "sisyphus" }],
            ]),
          },
        }),
      }),
    );

    expect(result.text).not.toContain("lowercase-value");
    expect(result.text).not.toContain("UPPERCASE_VALUE");
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
    expect(isJusticeSpecifier("/opt/justice")).toBe(true);
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
    expect(logLines).toContain("  /missing.log: 読み込めません (ENOENT: /missing.log)");
  });

  it("resolves a healthy specifier through resolveAndCheckSpecifier", async () => {
    const plugin = async () => ({});
    const section = await resolveAndCheckSpecifier(
      "■ 検査 2",
      { specifier: "@yohi/justice@3.0.0", optionsPresent: false, optionKeys: [] },
      baseDeps({
        fileReader: mockReader(healthyFixture()),
        importer: async () => ({ default: plugin, OpenCodePlugin: plugin }),
      }),
    );
    expect(section.failed).toBe(false);
    expect(section.lines).toContain("  ✓ ローダ契約 OK（plugin factory: 1 件）");
  });

  it("reports specifier resolution failure when resolveAndCheckSpecifier throws", async () => {
    const throwingReader = mockReader({});
    throwingReader.listFiles = async () => {
      throw new Error("reader boom");
    };
    const section = await resolveAndCheckSpecifier(
      "■ 検査 2",
      { specifier: "@yohi/justice@3.0.0", optionsPresent: false, optionKeys: [] },
      baseDeps({ fileReader: throwingReader }),
    );
    expect(section.failed).toBe(true);
    expect(section.lines.some((line) => line.includes("reader boom"))).toBe(true);
  });

  it("reports import failure when resolveAndCheckSpecifier's importer throws", async () => {
    const section = await resolveAndCheckSpecifier(
      "■ 検査 2",
      { specifier: "@yohi/justice@3.0.0", optionsPresent: false, optionKeys: [] },
      baseDeps({
        fileReader: mockReader(healthyFixture()),
        importer: async () => {
          throw new Error("import boom");
        },
      }),
    );
    expect(section.failed).toBe(true);
    expect(section.lines.some((line) => line.includes("import boom"))).toBe(true);
  });

  it("handles unreadable .justice/events shards gracefully", async () => {
    const reader = mockReader(healthyFixture());
    reader.listFiles = async (prefix) =>
      prefix === "/proj/.justice/events" ? ["/proj/.justice/events/broken.jsonl"] : [];
    const result = await runDoctor(
      baseDeps({
        fileReader: reader,
        importer: async () => ({ default: async () => ({}) }),
      }),
    );
    expect(result.text).toContain(".justice/events:");
    expect(result.text).toContain("shard 1 件 / レコード 0 件");
  });

  it("reports missing required categories from the host-resolved snapshot", async () => {
    const result = await runDoctor(
      baseDeps({
        hostConfigReader: async () => ({
          kind: "available",
          view: {
            effectiveCategoryNames: ["sp-mechanical"],
            effectiveCommandDefinitions: new Map(),
          },
        }),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("sp-implementation");
    expect(result.text).toContain("sp-architecture");
  });

  it("does not treat local source scans as a successful category authority", async () => {
    const result = await runDoctor(
      baseDeps({
        hostConfigReader: async () => ({
          kind: "unsupported",
          reason: "resolved_config_command_unavailable",
        }),
        fileReader: mockReader({
          [GLOBAL_CONFIG]:
            '{ "plugin": ["@yohi/justice@3.0.0"], "category": { "sp-mechanical": {} } }',
        }),
        importer: async () => ({ default: async () => ({}) }),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("resolved_config_command_unavailable");
  });

  it("converts a synchronously throwing host reader into an unsupported result", async () => {
    const result = await runDoctor(
      baseDeps({
        hostConfigReader: () => {
          throw new Error("host reader failed secret=do-not-copy");
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("resolved_config_command_failed");
    expect(result.text).not.toContain("do-not-copy");
  });
});

describe("createDoctorHostConfigReader()", () => {
  it("requires the exact supported version before reading resolved JSON", async () => {
    const calls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = [];
    const runner: DoctorHostCommandRunner = async (args, options) => {
      calls.push({ args, cwd: options.cwd });
      return args[1] === "--version"
        ? commandResult({ stdout: "1.18.29\n" })
        : commandResult({ stdout: '{"category":{"sp-mechanical":{}}}' });
    };
    const reader = createDoctorHostConfigReader(runner);

    const result = await reader({ cwd: "/target", env: { PATH: "/bin" } });

    expect(result.kind).toBe("available");
    expect(calls).toEqual([
      { args: ["opencode", "--version"], cwd: "/target" },
      { args: ["opencode", "debug", "config"], cwd: "/target" },
    ]);
  });

  it.each([
    [
      "missing executable",
      async (): Promise<DoctorHostCommandResult> => {
        throw new Error("missing executable secret=do-not-copy");
      },
      "resolved_config_command_unavailable",
    ],
    [
      "version command failure",
      async (): Promise<DoctorHostCommandResult> =>
        commandResult({ exitCode: 1, stderr: "secret=do-not-copy" }),
      "resolved_config_command_failed",
    ],
    [
      "version mismatch",
      async (): Promise<DoctorHostCommandResult> => commandResult({ stdout: "1.18.28\n" }),
      "resolved_config_host_version_unsupported",
    ],
  ] as const)("returns unsupported for %s", async (_label, runnerResult, reason) => {
    const reader = createDoctorHostConfigReader(async () => runnerResult());

    const result = await reader({ cwd: "/target", env: {} });

    expect(result).toEqual({ kind: "unsupported", reason });
  });

  it("returns unsupported when the resolved-config command exits non-zero without exposing stderr", async () => {
    const reader = createDoctorHostConfigReader(async (args) =>
      args[1] === "--version"
        ? commandResult({ stdout: "1.18.29" })
        : commandResult({ exitCode: 1, stderr: "provider secret=do-not-copy" }),
    );

    const result = await reader({ cwd: "/target", env: {} });

    expect(result).toEqual({ kind: "unsupported", reason: "resolved_config_command_failed" });
    expect(JSON.stringify(result)).not.toContain("do-not-copy");
  });

  it.each([
    ["version", ["opencode", "--version"] as const],
    ["config", ["opencode", "debug", "config"] as const],
  ] as const)("returns unsupported on %s probe timeout", async (_label, timedOutArgs) => {
    const reader = createDoctorHostConfigReader(async (args) => {
      if (args.join(" ") === timedOutArgs.join(" ")) {
        return commandResult({ timedOut: true });
      }
      return args[1] === "--version"
        ? commandResult({ stdout: "1.18.29" })
        : commandResult({ stdout: '{"category":{}}' });
    });

    const result = await reader({ cwd: "/target", env: {} });

    expect(result).toEqual({ kind: "unsupported", reason: "resolved_config_timeout" });
  });

  it("returns unsupported for invalid JSON without exposing host output", async () => {
    const reader = createDoctorHostConfigReader(async (args) =>
      args[1] === "--version"
        ? commandResult({ stdout: "1.18.29" })
        : commandResult({ stdout: '{"secret":"do-not-copy"' }),
    );

    const result = await reader({ cwd: "/target", env: {} });

    expect(result).toEqual({ kind: "unsupported", reason: "resolved_config_invalid_json" });
    expect(JSON.stringify(result)).not.toContain("do-not-copy");
  });

  it("returns unsupported for an unexpected resolved-config top-level shape", async () => {
    const reader = createDoctorHostConfigReader(async (args) =>
      args[1] === "--version"
        ? commandResult({ stdout: "1.18.29" })
        : commandResult({ stdout: "[]" }),
    );

    await expect(reader({ cwd: "/target", env: {} })).resolves.toEqual({
      kind: "unsupported",
      reason: "resolved_config_shape_invalid",
    });
  });

  it("rejects an unverified target context before spawning a host command", async () => {
    let calls = 0;
    const reader = createDoctorHostConfigReader(async () => {
      calls += 1;
      return commandResult({ stdout: "1.18.29" });
    });

    const result = await reader({ cwd: "", env: {} });

    expect(result).toEqual({ kind: "unsupported", reason: "resolved_config_context_unverified" });
    expect(calls).toBe(0);
  });
});

describe("createDoctorHostCommandRunner()", () => {
  it("kills a timed-out child and waits for its termination", async () => {
    vi.useFakeTimers();
    let killed = false;
    let terminated = false;
    let resolveExited: ((exitCode: number) => void) | undefined;
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve;
    }).then((exitCode) => {
      terminated = true;
      return exitCode;
    });
    const process: DoctorHostProcess = {
      stdout: null,
      stderr: null,
      exited,
      kill: () => {
        killed = true;
        resolveExited?.(143);
      },
    };
    const runner = createDoctorHostCommandRunner(() => process);
    const resultPromise = runner(["opencode", "--version"], {
      cwd: "/target",
      env: {},
      timeoutMs: 30_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    const result = await resultPromise;

    expect(killed).toBe(true);
    expect(terminated).toBe(true);
    expect(result).toMatchObject({ exitCode: 143, timedOut: true });
  });
});

describe("resolveCacheRoot()", () => {
  it("falls back to ~/.cache when XDG_CACHE_HOME is empty", () => {
    expect(resolveCacheRoot({ XDG_CACHE_HOME: "" }, "/home/user")).toBe(
      "/home/user/.cache/opencode",
    );
  });

  it("uses XDG_CACHE_HOME when set", () => {
    expect(resolveCacheRoot({ XDG_CACHE_HOME: "/tmp/cache" }, "/home/user")).toBe(
      "/tmp/cache/opencode",
    );
  });

  it("falls back to ~/.cache when XDG_CACHE_HOME is undefined", () => {
    expect(resolveCacheRoot({}, "/home/user")).toBe("/home/user/.cache/opencode");
  });
});

const UNSUPPORTED_REASONS = [
  "resolved_config_command_unavailable",
  "resolved_config_command_failed",
  "resolved_config_host_version_unsupported",
  "resolved_config_timeout",
  "resolved_config_invalid_json",
  "resolved_config_context_unverified",
  "resolved_config_shape_invalid",
] as const;

describe("runDoctor() controller configuration", () => {
  it("formats incomplete controller assessments with safe fallback labels", () => {
    const configuredWithoutAgent: ControllerConfigurationAssessment = {
      workflow: "brainstorming",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-brainstorming",
      status: "configured",
    };
    const misconfiguredWithoutAgent: ControllerConfigurationAssessment = {
      workflow: "writing-plans",
      desiredController: "sisyphus",
      pinnedCommand: "justice-implement-writing-plans",
      status: "misconfigured",
      reason: "agent_missing",
    };

    expect(formatControllerAssessmentLine(configuredWithoutAgent)).toContain("agent: unknown");
    expect(formatControllerAssessmentLine(misconfiguredWithoutAgent)).not.toContain("設定値:");
  });

  it("reports all four pinned commands as configured for the exact host-resolved snapshot", async () => {
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(healthyFixture()),
        importer: async () => ({ default: async () => ({}) }),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.text).toContain(
      "  ✓ justice-implement-brainstorming: configured (agent: sisyphus)",
    );
    expect(result.text).toContain(
      "  ✓ justice-implement-subagent-driven-development: configured (agent: atlas)",
    );
    expect(result.text).toContain("4件すべて configured");
    expect(result.text).not.toContain("修復テンプレート");
  });

  it("reports missing pinned commands and emits the exact four-command remediation template", async () => {
    const result = await runDoctor(
      baseDeps({
        fileReader: mockReader(healthyFixture()),
        importer: async () => ({ default: async () => ({}) }),
        hostConfigReader: async () => ({
          kind: "available",
          view: {
            effectiveCategoryNames: ALL_SP_CATEGORIES,
            effectiveCommandDefinitions: new Map(),
          },
        }),
      }),
    );

    expect(result.text).toContain(
      "  ✗ justice-implement-brainstorming: missing (command_missing / 期待 agent: sisyphus)",
    );
    expect(result.text).toContain(
      "  ✗ justice-implement-executing-plans: missing (command_missing / 期待 agent: sisyphus)",
    );
    expect(result.text).toContain(
      "  ! 4件の pinned command の修復テンプレート（command.agent を exact 一致で設定・configured != applied）:",
    );
    expect(result.text).toContain(
      `    "justice-implement-subagent-driven-development": { "agent": "atlas" }`,
    );
    // controller 設定の findings は L0 advisory であり、host unsupported 以外は終了コードに影響しない。
    expect(result.exitCode).toBe(0);
  });

  it("reports misconfigured agents, naming the configured agent only where allowed", async () => {
    const result = await runDoctor(
      baseDeps({
        hostConfigReader: async () => ({
          kind: "available",
          view: {
            effectiveCategoryNames: ALL_SP_CATEGORIES,
            effectiveCommandDefinitions: new Map<string, DoctorEffectiveCommandDefinition>([
              ["justice-implement-brainstorming", { kind: "valid", agent: "my-custom-agent" }],
              ["justice-implement-writing-plans", { kind: "valid" }],
              ["justice-implement-subagent-driven-development", { kind: "invalid" }],
              ["justice-implement-executing-plans", { kind: "valid", agent: "oracle" }],
            ]),
          },
        }),
      }),
    );

    expect(result.text).toContain(
      "  ✗ justice-implement-brainstorming: misconfigured (agent_invalid / 設定値: my-custom-agent / 期待 agent: sisyphus)",
    );
    expect(result.text).toContain(
      "  ✗ justice-implement-writing-plans: misconfigured (agent_missing / 期待 agent: sisyphus)",
    );
    expect(result.text).toContain(
      "  ✗ justice-implement-subagent-driven-development: misconfigured (invalid_command_definition / 期待 agent: atlas)",
    );
    expect(result.text).toContain(
      "  ✗ justice-implement-executing-plans: misconfigured (agent_mismatch / 設定値: oracle / 期待 agent: sisyphus)",
    );
  });

  it.each(UNSUPPORTED_REASONS)(
    "keeps every pinned command unsupported when the host result is unsupported (%s)",
    async (reason) => {
      const result = await runDoctor(
        baseDeps({ hostConfigReader: async () => ({ kind: "unsupported", reason }) }),
      );

      expect(result.exitCode).toBe(1);
      expect(result.text).toContain(`host-resolved config unsupported: ${reason}`);
      expect(result.text).toContain(
        "  ✗ justice-implement-brainstorming: unsupported (effective_config_unsupported / 期待 agent: sisyphus)",
      );
      expect(result.text).toContain("修復テンプレート");
      expect(result.text).not.toContain("configured (agent:");
      expect(result.text).not.toContain("4件すべて configured");
    },
  );

  it("does not let a local config source with the exact four pairs emit configured controller output when the host is unsupported", async () => {
    const localConfig = "/proj/opencode.json";
    const result = await runDoctor(
      baseDeps({
        hostConfigReader: async () => ({
          kind: "unsupported",
          reason: "resolved_config_host_version_unsupported",
        }),
        fileReader: mockReader({
          ...healthyFixture(),
          [localConfig]: JSON.stringify({
            plugin: ["@yohi/justice@3.0.0"],
            command: {
              "justice-implement-brainstorming": { agent: "sisyphus" },
              "justice-implement-writing-plans": { agent: "sisyphus" },
              "justice-implement-subagent-driven-development": { agent: "atlas" },
              "justice-implement-executing-plans": { agent: "sisyphus" },
            },
          }),
        }),
        importer: async () => ({ default: async () => ({}) }),
      }),
    );

    expect(result.text).toContain("resolved_config_host_version_unsupported");
    expect(result.text).toContain(
      "unsupported (effective_config_unsupported / 期待 agent:",
    );
    expect(result.text).not.toContain("✓ justice-implement-");
    expect(result.text).not.toContain("4件すべて configured");
  });

  it("never emits raw command bodies, provider options, credentials, or unrelated config values from the host snapshot", async () => {
    const result = await runDoctor(
      baseDeps({
        hostConfigReader: async () =>
          projectDoctorEffectiveConfig({
            category: Object.fromEntries(
              ALL_SP_CATEGORIES.map((name) => [
                name,
                { model: "provider/model-x", secret: "do-not-leak" },
              ]),
            ),
            command: {
              "justice-implement-brainstorming": {
                agent: "sisyphus",
                template: "do-not-leak-body",
              },
              "justice-implement-writing-plans": { agent: "sisyphus" },
              "justice-implement-subagent-driven-development": { agent: "atlas" },
              "justice-implement-executing-plans": { agent: "sisyphus" },
            },
            provider: { apiKey: "sk-do-not-leak" },
          }),
      }),
    );

    expect(result.text).not.toContain("do-not-leak");
    expect(result.text).not.toContain("provider/model-x");
    // runtime routing / observation mechanisms are out of scope for the doctor path
    expect(result.text).not.toContain("command.execute.before");
    expect(result.text).not.toContain("chat.params");
    expect(result.text).not.toContain("message.updated");
    expect(result.text).not.toContain("command.executed");
    expect(result.text).not.toContain("controller_routing_observed");
  });

  it("surfaces a host version mismatch through the real reader as unsupported with the remediation template", async () => {
    const runner: DoctorHostCommandRunner = async (args) =>
      args[1] === "--version"
        ? commandResult({ stdout: "1.18.28\n" })
        : commandResult({ stdout: "{}" });
    const result = await runDoctor(
      baseDeps({ hostConfigReader: createDoctorHostConfigReader(runner) }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("resolved_config_host_version_unsupported");
    expect(result.text).toContain(
      "unsupported (effective_config_unsupported / 期待 agent: sisyphus)",
    );
    expect(result.text).toContain("修復テンプレート");
  });
});
