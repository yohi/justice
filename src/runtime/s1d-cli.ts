#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LoaderInput } from "../core/s1a/contract.js";
import { formatFatal, formatJson, formatText } from "../core/s1d/formatter.js";
import type { S1dFatalErrorV1, S1dReportV1 } from "../core/s1d/contract.js";
import { runS1dDiagnostic } from "./s1d-diagnostic.js";
import { createS1aReadOnlySource } from "./s1a-read-only-fs.js";

export type S1dCliOutput = Readonly<{ stdout: string; exitCode: 0 | 3 | 64 | 70 }>;
export type S1dCliEnvironment = Readonly<Record<string, string | undefined>>;
export type S1dDiagnosticRunner = (
  request: Readonly<{ loaderInput: LoaderInput; evidencePath: string; changesetPath: string }>,
  env: S1dCliEnvironment,
) => Promise<S1dReportV1>;

const REQUIRED_FLAGS = ["--manifest", "--manifest-sha256", "--intent", "--artifacts-root", "--evidence", "--changeset"] as const;
const INVALID_ARGUMENT: S1dFatalErrorV1 = {
  schemaVersion: "justice-s1d-error-v1", operation: "diagnose", status: "ERROR",
  error: { category: "CLI_USAGE", code: "CLI_ARGUMENT_INVALID" },
};
const INTERNAL_ERROR: S1dFatalErrorV1 = {
  schemaVersion: "justice-s1d-error-v1", operation: "diagnose", status: "ERROR",
  error: { category: "INTERNAL_FAILURE", code: "UNEXPECTED_INTERNAL_ERROR" },
};
const SAFE_TEXT_FATAL = "Justice S1-d: fatal diagnostic error.\n";

function fatal(code: 64 | 70, format: "json" | "text"): S1dCliOutput {
  try {
    return { stdout: formatFatal(code === 64 ? INVALID_ARGUMENT : INTERNAL_ERROR, format), exitCode: code };
  } catch {
    return { stdout: SAFE_TEXT_FATAL, exitCode: code };
  }
}

function unambiguousFormat(argv: readonly string[]): "json" | "text" {
  const indexes = argv.flatMap((value, index) => value === "--format" ? [index] : []);
  if (indexes.length !== 1) return "text";
  const value = argv[indexes[0]! + 1];
  return value === "json" ? "json" : "text";
}

export async function runS1dCli(
  argv: readonly string[],
  env: S1dCliEnvironment,
  runDiagnostic: S1dDiagnosticRunner,
): Promise<S1dCliOutput> {
  const outputFormat = unambiguousFormat(argv);
  try {
    if (argv[0] !== "diagnose") return fatal(64, outputFormat);
    const allowed = new Set<string>([...REQUIRED_FLAGS, "--format"]);
    const flags = new Map<string, string>();
    for (let index = 1; index < argv.length; index += 2) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (flag === undefined || value === undefined || value.length === 0 || !allowed.has(flag) || flags.has(flag) || value.startsWith("--")) {
        return fatal(64, outputFormat);
      }
      flags.set(flag, value);
    }
    if (REQUIRED_FLAGS.some((flag) => !flags.has(flag))) return fatal(64, outputFormat);
    const format = flags.get("--format") ?? "text";
    if (format !== "text" && format !== "json") return fatal(64, "text");
    const digest = flags.get("--manifest-sha256");
    if (digest === undefined || !/^[0-9a-f]{64}$/.test(digest)) return fatal(64, outputFormat);
    const loaderInput: LoaderInput = {
      manifestPath: flags.get("--manifest") ?? "",
      expectedManifestSha256: digest,
      intentPath: flags.get("--intent") ?? "",
      artifactsRoot: flags.get("--artifacts-root") ?? "",
    };
    const report = await runDiagnostic({
      loaderInput,
      evidencePath: flags.get("--evidence") ?? "",
      changesetPath: flags.get("--changeset") ?? "",
    }, env);
    const stdout = format === "json" ? formatJson(report) : formatText(report);
    const complete = report.stages.s1a.state === "EVALUATED"
      && report.stages.s1b.state === "EVALUATED"
      && report.stages.s1c.state === "EVALUATED";
    return { stdout, exitCode: complete ? 0 : 3 };
  } catch {
    return fatal(70, outputFormat);
  }
}

export async function main(): Promise<void> {
  const source = createS1aReadOnlySource();
  const result = await runS1dCli(process.argv.slice(2), process.env, (request) => runS1dDiagnostic(request, source));
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  // no-excuse-ok: catch — process boundary uses a fixed safe fatal record.
  try {
    await main();
  } catch {
    process.stdout.write(SAFE_TEXT_FATAL);
    process.exitCode = 70;
  }
}
