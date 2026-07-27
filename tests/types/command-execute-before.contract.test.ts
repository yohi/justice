/**
 * Permanent gate for the compile-time SDK contract fixtures in this directory.
 *
 * WHY A SPAWNED `tsc` INSTEAD OF PLAIN `bun run typecheck`
 * -------------------------------------------------------
 * The repository root `tsconfig.json` declares `include: ["src/**\/*"]` and
 * `exclude: [..., "tests"]`, so `bun run typecheck` (`tsc --noEmit`) never sees
 * anything under `tests/`. Verified empirically: a file containing
 * `const probe: number = "deliberate type error"` placed in `tests/` compiles
 * "clean" under `bun run typecheck`. Enabling type-checking for all of `tests/`
 * is out of scope — the directory currently carries ~120 pre-existing type
 * errors because it has never been checked.
 *
 * So the fixtures get their own narrowly scoped project (`tests/types/tsconfig.json`,
 * `include: ["*.contract-fixture.ts"]`) and this test drives it. That makes the
 * contract a real regression gate under `bun run test` without touching build
 * configuration or production code.
 *
 * WHAT A PASSING RUN PROVES
 * -------------------------
 * A zero exit code proves both directions at once:
 *   - every positive assertion in the fixture still type-checks, and
 *   - every `@ts-expect-error` still suppresses a real error (otherwise `tsc`
 *     reports TS2578 "Unused '@ts-expect-error' directive").
 *
 * A non-zero exit code means `@opencode-ai/plugin` drifted from the contract
 * recorded in the fixture header — re-read the resolved `.d.ts` and update both
 * the fixture and the adapter boundary that depends on it.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TSC_BIN = resolve(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");
const FIXTURE_PROJECT = resolve(__dirname, "tsconfig.json");
const FIXTURE_FILE = resolve(__dirname, "command-execute-before.contract-fixture.ts");

/** Scoped `tsc` over a single fixture takes ~15s in the Devcontainer. */
const TSC_TIMEOUT_MS = 180_000;

describe("SDK type contract fixtures", () => {
  it("resolves the toolchain and fixture files", () => {
    /* eslint-disable security/detect-non-literal-fs-filename -- all paths are derived from __dirname, not user input. */
    expect(existsSync(TSC_BIN)).toBe(true);
    expect(existsSync(FIXTURE_PROJECT)).toBe(true);
    expect(existsSync(FIXTURE_FILE)).toBe(true);
    /* eslint-enable security/detect-non-literal-fs-filename */
  });

  it(
    "compiles cleanly, proving both the positive assertions and every @ts-expect-error",
    () => {
      const result = spawnSync(process.execPath, [TSC_BIN, "-p", FIXTURE_PROJECT], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        timeout: TSC_TIMEOUT_MS,
      });

      const diagnostics = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

      expect(result.error).toBeUndefined();
      // Surface the compiler diagnostics in the failure message before asserting
      // on the exit code, so a contract drift is immediately actionable.
      expect(diagnostics).toBe("");
      expect(result.status).toBe(0);
    },
    TSC_TIMEOUT_MS,
  );
});
