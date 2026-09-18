import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";

const PROVIDER_NAME = "LinuxOpenat2ReviewArtifactProvider" as const;
const PASS_STATUS = "PASS" as const;
const BLOCKED_STATUS = "BLOCKED" as const;

const ProbeCaseSchema = z.object({
  status: z.enum(["PASS", "FAIL", "BLOCKED"]),
  detail: z.string(),
  outcome: z.string().optional(),
  replacement_delete_count: z.number().int().nonnegative().optional(),
  replacement_overwrite_count: z.number().int().nonnegative().optional(),
  replacement_bytes_retained: z.boolean().optional(),
  usable_reservation: z.boolean().optional(),
});

const ProbeReportSchema = z.object({
  provider: z.literal(PROVIDER_NAME),
  nativeApi: z.record(z.string(), z.boolean()),
  platform: z.object({
    os: z.string(),
    arch: z.string(),
    libc: z.string(),
  }),
  kernel: z.string(),
  status: z.enum(["PASS", "FAIL", "BLOCKED"]),
  cases: z.record(z.string(), ProbeCaseSchema),
});

export type ProbeReport = z.infer<typeof ProbeReportSchema>;

export type ProviderPublication =
  | Readonly<{
      readonly status: "PUBLISHED";
      readonly provider: typeof PROVIDER_NAME;
    }>
  | Readonly<{
      readonly status: "BLOCKED";
      readonly reason: "artifact_storage_unavailable";
    }>;

export type WorkerInput = Readonly<{
  readonly artifactPath?: string;
}>;

type CommandResult = Readonly<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}>;

function runCommand(command: readonly [string, ...string[]]): CommandResult {
  const executable = command[0];
  const result = spawnSync(executable, command.slice(1), { encoding: "utf8" });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout === null ? "" : result.stdout.toString(),
    stderr: result.stderr === null ? "" : result.stderr.toString(),
  };
}

function failedReport(status: "FAIL" | "BLOCKED", detail: string): ProbeReport {
  return {
    provider: PROVIDER_NAME,
    nativeApi: {
      openat2: false,
      renameat2: false,
      descriptorRelative: false,
      identityBoundLease: false,
    },
    platform: {
      os: process.platform,
      arch: process.arch,
      libc: "unknown",
    },
    kernel: "unknown",
    status,
    cases: {
      probe_execution: { status, detail },
    },
  };
}

function allCasesPass(report: ProbeReport): boolean {
  return Object.values(report.cases).every((result) => result.status === PASS_STATUS);
}

function normalizeProbeStatus(report: ProbeReport): ProbeReport {
  const nativePrimitivesAvailable =
    report.nativeApi.openat2 === true && report.nativeApi.renameat2 === true;
  if (report.status === PASS_STATUS && nativePrimitivesAvailable && allCasesPass(report)) {
    return report;
  }
  if (!nativePrimitivesAvailable || report.status === BLOCKED_STATUS) {
    return { ...report, status: BLOCKED_STATUS };
  }
  return { ...report, status: "FAIL" };
}

export function decideProviderPublication(report: ProbeReport): ProviderPublication {
  if (
    report.status === PASS_STATUS &&
    report.nativeApi.openat2 === true &&
    report.nativeApi.renameat2 === true &&
    allCasesPass(report)
  ) {
    return { status: "PUBLISHED", provider: PROVIDER_NAME };
  }
  return { status: "BLOCKED", reason: "artifact_storage_unavailable" };
}

export function buildWorkerInputForPublication(
  publication: ProviderPublication,
  artifactPath: string,
): WorkerInput {
  return publication.status === "PUBLISHED" ? { artifactPath } : {};
}

async function verifyProbe(): Promise<ProbeReport> {
  const workspace = await mkdtemp(join(tmpdir(), "justice-review-artifact-probe-"));
  const source = fileURLToPath(new URL("./probe.c", import.meta.url));
  const binary = join(workspace, "review-artifact-probe");

  try {
    const compile = runCommand([
      "cc",
      "-D_GNU_SOURCE",
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-O2",
      source,
      "-o",
      binary,
    ]);
    if (compile.exitCode !== 0) {
      return failedReport("FAIL", "probe compilation failed");
    }

    const execution = runCommand([binary, workspace]);
    const parsed = ProbeReportSchema.safeParse(JSON.parse(execution.stdout));
    if (!parsed.success) {
      return failedReport("FAIL", "probe output was not a valid report");
    }
    return normalizeProbeStatus(parsed.data);
  } catch (error: unknown) {
    if (error instanceof Error) {
      return failedReport("FAIL", "probe execution failed");
    }
    return failedReport("FAIL", "probe execution failed");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const report = await verifyProbe();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (decideProviderPublication(report).status !== "PUBLISHED") {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : "probe verification failed";
    process.stdout.write(`${JSON.stringify(failedReport("FAIL", detail))}\n`);
    process.exitCode = 1;
  });
}
