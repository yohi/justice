import { describe, expect, it, vi } from "vitest";
import type { S1aReadOnlySource } from "../../src/core/s1a/contract.js";
import { runS1dDiagnostic } from "../../src/runtime/s1d-diagnostic.js";
import { runS1dCli } from "../../src/runtime/s1d-cli.js";
import { jsonBytes, s1aFixture, sha256 } from "../helpers/s1a-fixtures.js";

const fixtureSource = (): Readonly<{ source: S1aReadOnlySource; argv: readonly string[] }> => {
  const fixture = s1aFixture();
  const source: S1aReadOnlySource = {
    async readInputFile(path) {
      if (path === "evidence.json") return jsonBytes([]);
      if (path === "changeset.json") return jsonBytes({ availability: "PRESENT", changes: [] });
      if (path === fixture.input.manifestPath) return jsonBytes(fixture.manifest);
      if (path === fixture.input.intentPath) return jsonBytes(fixture.intent);
      throw new Error("unexpected input");
    },
    readArtifact: fixture.source.readArtifact,
  };
  return {
    source,
    argv: ["diagnose", "--manifest", fixture.input.manifestPath, "--manifest-sha256", sha256(jsonBytes(fixture.manifest)),
      "--intent", fixture.input.intentPath, "--artifacts-root", "root", "--evidence", "evidence.json", "--changeset", "changeset.json"],
  };
};

describe("runS1dCli", () => {
  it("validDiagnoseTextAndJsonAreDeterministic", async () => {
    const { source, argv } = fixtureSource();
    const runDiagnostic = (request: Parameters<typeof runS1dDiagnostic>[0]) => runS1dDiagnostic(request, source);
    const text = await runS1dCli(argv, {}, runDiagnostic);
    const textAgain = await runS1dCli(argv, {}, runDiagnostic);
    const json = await runS1dCli([...argv, "--format", "json"], {}, runDiagnostic);
    expect(text).toEqual({ stdout: textAgain.stdout, exitCode: 0 });
    expect(text.stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(json.stdout).stages.s1a.result.identityStatus).toBe("MATCH");
    expect(JSON.parse(json.stdout).stages.s1c.result.formalVerdict).toBe("UNKNOWN");
    expect(json.exitCode).toBe(0);
  });

  it("parsedLevelBStillCompletes", async () => {
    const { source, argv } = fixtureSource();
    const invalidSource: S1aReadOnlySource = {
      ...source,
      async readInputFile(path, maxBytes) {
        if (path === "evidence.json") return jsonBytes({ invalid: true });
        return source.readInputFile(path, maxBytes);
      },
    };
    const result = await runS1dCli([...argv, "--format", "json"], {}, (request) => runS1dDiagnostic(request, invalidSource));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).stages.s1b.result.evaluationStatus).toBe("INPUT_REJECTED");
  });

  it("levelAPartialUsesExit3", async () => {
    const { source, argv } = fixtureSource();
    const unavailableEvidence: S1aReadOnlySource = {
      ...source,
      async readInputFile(path, maxBytes) {
        if (path === "evidence.json") throw new Error("private path");
        return source.readInputFile(path, maxBytes);
      },
    };
    const result = await runS1dCli([...argv, "--format", "json"], {}, (request) => runS1dDiagnostic(request, unavailableEvidence));
    const report = JSON.parse(result.stdout);
    expect(result.exitCode).toBe(3);
    expect(report.inputIssues).toEqual([{ source: "evidence", code: "INPUT_READ_FAILED" }]);
    expect(report.stages.s1b.state).toBe("NOT_EVALUATED");
    expect(result.stdout).not.toContain("private path");
  });

  it("invalidArgumentsAreSafe", async () => {
    const { argv } = fixtureSource();
    const runDiagnostic = vi.fn(async () => { throw new Error("must not run"); });
    const invalidDigest = [...argv];
    const digestValueIndex = invalidDigest.indexOf("--manifest-sha256") + 1;
    invalidDigest[digestValueIndex] = "invalid";
    const invalidArguments = [
      [...argv, "--format", "json", "--other", "secret"],
      [...argv, "--manifest", "duplicate"],
      [...argv.slice(0, -2)],
      [...argv, "--format", "yaml"],
      invalidDigest,
      [...argv, "extra"],
      [...argv, "--format"],
    ];
    for (const args of invalidArguments) {
      const result = await runS1dCli(args, {}, runDiagnostic);
      expect(result.exitCode).toBe(64);
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout).not.toContain("secret");
      expect(result.stdout).not.toContain("invalid");
    }
    expect(JSON.parse((await runS1dCli([...argv, "--format", "json", "--other", "secret"], {}, runDiagnostic)).stdout))
      .toMatchObject({ schemaVersion: "justice-s1d-error-v1", error: { code: "CLI_ARGUMENT_INVALID" } });
    expect(runDiagnostic).not.toHaveBeenCalled();
  });

  it("noRuntimeSideEffects", async () => {
    const { source, argv } = fixtureSource();
    const accessed = new Set<string>();
    const readOnlySource: S1aReadOnlySource = {
      async readInputFile(path, maxBytes) {
        accessed.add(`read:${path}:${maxBytes}`);
        return source.readInputFile(path, maxBytes);
      },
      async readArtifact(root, path, maxBytes) {
        accessed.add(`artifact:${path}:${maxBytes}`);
        return source.readArtifact(root, path, maxBytes);
      },
    };
    const runDiagnostic = vi.fn((request: Parameters<typeof runS1dDiagnostic>[0]) => runS1dDiagnostic(request, readOnlySource));
    const result = await runS1dCli(argv, { HOME: "/must-not-be-read" }, runDiagnostic);
    expect(result.exitCode).toBe(0);
    expect(runDiagnostic).toHaveBeenCalledTimes(1);
    expect(accessed.size).toBeGreaterThan(0);
    expect([...accessed].every((entry) => entry.startsWith("read:") || entry.startsWith("artifact:"))).toBe(true);
  });

  it("unexpectedInternalFaultUsesExit70", async () => {
    const { argv } = fixtureSource();
    const result = await runS1dCli([...argv, "--format", "json"], {}, async () => { throw new Error("/secret/path stack"); });
    expect(result.exitCode).toBe(70);
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: "justice-s1d-error-v1", error: { code: "UNEXPECTED_INTERNAL_ERROR" } });
    expect(result.stdout).not.toContain("secret");
  });
});
