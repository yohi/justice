/**
 * Consumer type-resolution regression test for the packed `@yohi/justice` package.
 *
 * Opt-in only: this suite needs network access to registry.npmjs.org and takes
 * minutes, so it is skipped unless `JUSTICE_H3_CONSUMER_TYPES=1` is set.
 *
 * Prerequisite: `bun run build` (the suite packs the current `dist/`).
 *
 * Run:
 *   JUSTICE_H3_CONSUMER_TYPES=1 bun run vitest run tests/integration/opencode-v2-consumer-types.test.ts
 * Optional: `JUSTICE_H3_CONSUMER_TMPDIR=<dir>` selects the parent of the scratch directory
 * (default: the OS temp dir). Every npm call runs with a scrubbed environment (only PATH,
 * a private HOME, a private npm cache and TMPDIR), `--ignore-scripts --no-audit --no-fund`
 * and `--registry=https://registry.npmjs.org/`.
 *
 * Contract:
 * 1. A NodeNext consumer that installs the tarball plus the exact SDK `@opencode/plugin@2.3.2`
 *    type-checks `import ... from "@yohi/justice/server"` with the repo's pinned tsc
 *    (strict, skipLibCheck false) with zero diagnostics.
 * 2. A V1-only consumer that installs the tarball WITHOUT `@opencode/plugin` is not forced to
 *    install the SDK, and type-checking the V1 entry (`@yohi/justice`) reports no diagnostic
 *    caused by `@opencode/plugin`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.JUSTICE_H3_CONSUMER_TYPES === "1";
const REPO_ROOT = resolve(__dirname, "../..");
const TSC = join(REPO_ROOT, "node_modules", ".bin", "tsc");
const REGISTRY = "https://registry.npmjs.org/";
// The consumer explicitly installs the exact SDK version (contract of the ./server entry).
const SDK_VERSION = "2.3.2";
// The SDK's dependency @ai-sdk/provider@3.0.8 imports `json-schema` types but omits
// @types/json-schema (TS7016), so the V2 consumer installs it explicitly (consumer-side only).
const JSON_SCHEMA_TYPES_VERSION = "7.0.15";
const TIMEOUT_MS = 600_000;

interface RunResult {
  readonly status: number | null;
  readonly output: string;
}

interface Sandbox {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
}

/* eslint-disable security/detect-non-literal-fs-filename -- all paths are derived from a mkdtemp scratch dir or REPO_ROOT, not user input. */

function createSandbox(): Sandbox {
  const parent = process.env.JUSTICE_H3_CONSUMER_TMPDIR ?? tmpdir();
  const root = mkdtempSync(join(parent, "justice-consumer-types-"));
  const home = join(root, "home");
  const cache = join(root, "npm-cache");
  const tmp = join(root, "tmp");
  for (const dir of [home, cache, tmp]) mkdirSync(dir, { recursive: true });
  // Equivalent of `env -i`: only these variables reach npm and tsc.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: tmp,
    XDG_CACHE_HOME: cache,
    npm_config_cache: cache,
    npm_config_userconfig: join(home, ".npmrc"),
    npm_config_registry: REGISTRY,
    npm_config_update_notifier: "false",
  };
  return { root, env };
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): RunResult {
  const result = spawnSync(command, [...args], { cwd, env, encoding: "utf8", timeout: TIMEOUT_MS });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
  return { status: result.status, output: output.trim() };
}

function npmInstall(cwd: string, env: NodeJS.ProcessEnv): RunResult {
  return run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", `--registry=${REGISTRY}`],
    cwd,
    env,
  );
}

function writeConsumer(
  dir: string,
  dependencies: Readonly<Record<string, string>>,
  source: string,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module", dependencies }, null, 2),
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          lib: ["ESNext", "DOM"],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ["use.ts"],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "use.ts"), source);
}

function typecheck(dir: string, env: NodeJS.ProcessEnv): RunResult {
  return run(TSC, ["-p", join(dir, "tsconfig.json")], dir, env);
}

describe.skipIf(!ENABLED)("packed @yohi/justice consumer type resolution (NodeNext)", () => {
  let sandbox: Sandbox;
  let tarball: string;

  beforeAll(() => {
    expect(existsSync(join(REPO_ROOT, "dist", "opencode-v2-plugin.js"))).toBe(true);
    expect(existsSync(TSC)).toBe(true);
    sandbox = createSandbox();
    const packDir = join(sandbox.root, "pack");
    mkdirSync(packDir);
    const pack = run(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", packDir],
      REPO_ROOT,
      sandbox.env,
    );
    expect(pack.status, pack.output).toBe(0);
    const tgz = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
    expect(tgz).toHaveLength(1);
    tarball = join(packDir, tgz[0] ?? "");
  }, TIMEOUT_MS);

  it(
    "V2 consumer with the exact SDK type-checks '@yohi/justice/server' without diagnostics",
    () => {
      const dir = join(sandbox.root, "consumer-v2");
      writeConsumer(
        dir,
        {
          "@yohi/justice": `file:${tarball}`,
          "@opencode/plugin": SDK_VERSION,
          "@types/json-schema": JSON_SCHEMA_TYPES_VERSION,
        },
        [
          'import type { Plugin } from "@opencode/plugin";',
          'import JusticeV2Plugin from "@yohi/justice/server";',
          "const plugin: Plugin.Plugin = JusticeV2Plugin;",
          "export const id: string = plugin.id;",
          "",
        ].join("\n"),
      );
      const install = npmInstall(dir, sandbox.env);
      expect(install.status, install.output).toBe(0);

      const result = typecheck(dir, sandbox.env);
      writeFileSync(join(sandbox.root, "consumer-v2-tsc.txt"), result.output);
      expect({ status: result.status, diagnostics: result.output }).toEqual({
        status: 0,
        diagnostics: "",
      });
    },
    TIMEOUT_MS,
  );

  it(
    "V1-only consumer is not forced to install the SDK and gets no SDK-caused diagnostics",
    () => {
      const dir = join(sandbox.root, "consumer-v1");
      writeConsumer(
        dir,
        { "@yohi/justice": `file:${tarball}` },
        [
          'import JusticePlugin from "@yohi/justice";',
          "export const kind: string = typeof JusticePlugin;",
          "",
        ].join("\n"),
      );
      const install = npmInstall(dir, sandbox.env);
      expect(install.status, install.output).toBe(0);
      expect(existsSync(join(dir, "node_modules", "@opencode", "plugin"))).toBe(false);

      const result = typecheck(dir, sandbox.env);
      writeFileSync(join(sandbox.root, "consumer-v1-tsc.txt"), result.output);
      const sdkDiagnostics = result.output
        .split("\n")
        .filter((line) => line.includes("@opencode/plugin"));
      expect(sdkDiagnostics).toEqual([]);
    },
    TIMEOUT_MS,
  );
});

/* eslint-enable security/detect-non-literal-fs-filename */
