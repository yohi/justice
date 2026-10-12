import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  decodeTaskCapabilityEnvelope,
  encodeTaskCapabilityEnvelope,
  type NativeSuperpowersTaskCapability,
} from "./capability-probe";
import {
  evaluateCapabilityRuntimeContracts,
  issueFixtureCapability,
  setCapabilityRuntimeEvidence,
} from "./capability-runtime-cases";
import { inspectCapabilitySessionStorage, REQUIRED_STORAGE_CLASSES } from "./capability-session-storage";
import { areSessionManagerHistoriesComplete, isRecord } from "./session-history-readback";
import {
  installProcessGroupSignalHandlers,
  runInIsolatedProcessGroup,
  type IsolatedProcessResult,
} from "./process-group-supervisor";
import { buildTask1RuntimeMockScript, evaluateHostRuntimeContracts } from "./task1-runtime-cases";

const EXPECTED = {
  omoVersion: "5.1.17",
  omoCommit: "091728d274f20d62504b0b5e1edbc3970671dd8b",
  senpiVersion: "2026.10.8",
  senpiCommit: "d56e6a260d9468418a39bc9120945cf98e06b840",
  superpowersVersion: "6.4.2",
  superpowersCommit: "8ca22dba9a94f28898bbce59f2537ff4d87c747d",
} as const;

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(fixtureDir, "task-e2e-mock-provider.ts");
const probeExtension = join(fixtureDir, "probe-extension.ts");
const rpcSessionDriver = join(fixtureDir, "rpc-session-driver.ts");
const BUN = process.env.JUSTICE_SPIKE_BUN ?? "bun";
const APPENDIX = "[[JUSTICE_SPIKE_REVIEW_APPENDIX]]";
const RPC_SUMMARY_PREFIX = "JUSTICE_SPIKE_RPC_SESSION_SUMMARY=";
const CREDENTIAL_ENV_VARS_FOR_EVAL: readonly string[] = Object.freeze([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENCODE_API_KEY",
  "KIMI_API_KEY",
]);
let spawnEnvForEval: NodeJS.ProcessEnv | undefined;

function capabilityEnvelopeFor(capability: NativeSuperpowersTaskCapability, originalDescription: string | null): string {
  return encodeTaskCapabilityEnvelope(capability.capabilityId, originalDescription);
}


type EvidenceRow = Readonly<Record<string, unknown>>;

type SpikeSummary = {
  readonly setupError?: string;
  readonly task1Result?: "PROVEN" | "BLOCKED";
  readonly blockedContracts?: readonly string[];
  readonly expected: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, string>>;
  readonly contracts: Readonly<Record<string, boolean>>;
  readonly blockedAt?: string | null;
  readonly observed?: Readonly<Record<string, unknown>>;
};

const RpcSessionSummarySchema = z.object({
  setupError: z.string().optional(),
  rpcResponseTrace: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  listedSessionCount: z.number().optional(),
  attachedSessionCount: z.number().optional(),
  closedSessionCount: z.number().optional(),
  entryAppendedObservations: z.array(z.record(z.string(), z.unknown())).optional(),
  syntheticToolResultObservations: z.array(z.record(z.string(), z.unknown())).optional(),
  fallbackAppendObservations: z.array(z.record(z.string(), z.unknown())).optional(),
}).readonly();

type RpcSessionSummary = z.infer<typeof RpcSessionSummarySchema>;

function readRpcSessionSummary(stdout: string): RpcSessionSummary {
  const line = stdout.split("\n").find((entry) => entry.startsWith(RPC_SUMMARY_PREFIX));
  if (line === undefined) throw new Error("RPC session driver produced no summary");
  const parsed = RpcSessionSummarySchema.safeParse(JSON.parse(line.slice(RPC_SUMMARY_PREFIX.length)) as unknown);
  if (!parsed.success) throw new Error("RPC session driver summary is invalid");
  return parsed.data;
}

async function run(
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly inherit?: boolean } = {},
): Promise<IsolatedProcessResult> {
  const inherit = options.inherit ?? process.env.JUSTICE_SPIKE_DEBUG_MODEL === "1";
  const result = await runInIsolatedProcessGroup(BUN, args, {
    timeoutMs: 300_000,
    maxOutputBytes: 64 * 1024 * 1024,
    inheritOutput: inherit,
    cwd: options.cwd,
    env: options.env,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (${String(result.exitCode)}): bun ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function json<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readTaskStateExecutionMode(
  agentRoot: string,
  taskId: string,
): "in-process" | "process" | null {
  if (!/^st_[A-Za-z0-9_-]+$/u.test(taskId)) return null;
  const projectsRoot = join(agentRoot, "projects");
  let projects: Array<{ readonly name: string; isDirectory(): boolean }>;
  try {
    projects = readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const matches: Array<"in-process" | "process"> = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const tasksDirectory = join(projectsRoot, project.name, "senpi-task", "tasks");
    const taskStatePath = join(tasksDirectory, `${taskId}.json`);
    try {
      const directoryStat = lstatSync(tasksDirectory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue;
      const stateStat = lstatSync(taskStatePath);
      if (!stateStat.isFile() || stateStat.isSymbolicLink()) return null;
      const state: unknown = JSON.parse(readFileSync(taskStatePath, "utf8"));
      const parsed = z.object({
        task_id: z.string(),
        execution_mode: z.enum(["in-process", "process"]),
      }).passthrough().safeParse(state);
      if (!parsed.success || parsed.data.task_id !== taskId) return null;
      matches.push(parsed.data.execution_mode);
    } catch {
      if (existsSync(taskStatePath)) return null;
    }
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}

function waitForEvidenceFile(path: string): string {
  const maxWaitMs = 60000;
  const start = Date.now();
  while (true) {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n").filter(Boolean);
    const allParse = lines.every((line) => {
      try {
        JSON.parse(line as string);
        return true;
      } catch {
        return false;
      }
    });
    const users =
      spawnSync("fuser", [path], { encoding: "utf8" }).stdout?.trim() ?? "";
    if (allParse && users.length === 0) return text;
    if (Date.now() - start >= maxWaitMs) return text;
    spawnSync("sleep", ["0.1"], { stdio: "ignore" });
  }
}

function evidence(path: string): readonly EvidenceRow[] {
  return waitForEvidenceFile(path)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line as string) as EvidenceRow);
}

function runtimeEnv(
  sandbox: {
    readonly root: string;
    readonly cwd: string;
    readonly home: string;
    readonly agent: string;
    readonly sessions: string;
    readonly evidence: string;
    readonly script: string;
    readonly runtimeNodeModules: string;
    readonly sideEffectPath: string;
    readonly taskSendSignalPath: string;
  },
  superpowersRoot: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "TERM"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    CI: "1",
    NO_COLOR: "1",
    HOME: sandbox.home,
    USERPROFILE: sandbox.home,
    XDG_CONFIG_HOME: join(sandbox.root, "xdg-config"),
    XDG_DATA_HOME: join(sandbox.root, "xdg-data"),
    XDG_CACHE_HOME: join(sandbox.root, "xdg-cache"),
    XDG_STATE_HOME: join(sandbox.root, "xdg-state"),
    OMO_CODING_AGENT_DIR: sandbox.agent,
    SENPI_CODING_AGENT_DIR: sandbox.agent,
    PI_CODING_AGENT_DIR: sandbox.agent,
    OMO_DISABLE_TELEMETRY: "1",
    OMO_SENPI_QA: "1",
    JUSTICE_SPIKE_EVIDENCE_PATH: sandbox.evidence,
    JUSTICE_SPIKE_SUPERPOWERS_ROOT: superpowersRoot,
    JUSTICE_SPIKE_MOCK_SCRIPT: sandbox.script,
    JUSTICE_SPIKE_SANDBOX_ROOT: sandbox.root,
    JUSTICE_SPIKE_RUNTIME_NODE_MODULES: sandbox.runtimeNodeModules,
    JUSTICE_SPIKE_SIDE_EFFECT_PATH: sandbox.sideEffectPath,
    JUSTICE_SPIKE_TASK_SEND_SIGNAL_PATH: sandbox.taskSendSignalPath,
    OMO_RPC_CLIENT_CAPABILITIES: "extension_events",
  };
}

async function main(): Promise<void> {
  installProcessGroupSignalHandlers();
  const root = mkdtempSync(join(tmpdir(), "justice-v5-native-spike-"));
  let summary: SpikeSummary;
  let keepRoot = false;
  try {
    const runtime = join(root, "runtime");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      join(runtime, "package.json"),
      `${JSON.stringify(
        {
          private: true,
          dependencies: {
            "omo-ai": EXPECTED.omoVersion,
            superpowers: `github:obra/superpowers#${EXPECTED.superpowersCommit}`,
          },
        },
        null,
        2,
      )}\n`,
    );
    await run(["install", "--no-progress"], { cwd: runtime, env: process.env });

    const omoRoot = join(runtime, "node_modules/omo-ai");
    const superpowersRoot = join(runtime, "node_modules/superpowers");
    const senpiRoot = existsSync(join(runtime, "node_modules/@code-yeongyu/senpi/package.json"))
      ? join(runtime, "node_modules/@code-yeongyu/senpi")
      : join(omoRoot, "node_modules/@code-yeongyu/senpi");
    const omoPackage = json<{ readonly version: string; readonly dependencies?: Readonly<Record<string, string>> }>(
      join(omoRoot, "package.json"),
    );
    const senpiPackage = json<{ readonly version: string }>(join(senpiRoot, "package.json"));
    const superpowersPackage = json<{ readonly version: string }>(join(superpowersRoot, "package.json"));
    if (omoPackage.version !== EXPECTED.omoVersion) throw new Error(`OmO version mismatch: ${String(omoPackage.version)}`);
    if (senpiPackage.version !== EXPECTED.senpiVersion) throw new Error(`Senpi version mismatch: ${String(senpiPackage.version)}`);
    if (superpowersPackage.version !== EXPECTED.superpowersVersion) {
      throw new Error(`Superpowers version mismatch: ${String(superpowersPackage.version)}`);
    }
    if (omoPackage.dependencies?.["@code-yeongyu/senpi"] !== EXPECTED.senpiVersion) {
      throw new Error(`OmO→Senpi pin mismatch: ${String(omoPackage.dependencies?.["@code-yeongyu/senpi"])}`);
    }
    const version = await run([join(omoRoot, "bin/omo.js"), "--version"], { cwd: runtime, inherit: false });
    const launcher = `${version.stdout}${version.stderr}`.trim();
    if (!launcher.includes("5.1.17") || !launcher.includes("senpi 2026.10.8")) {
      throw new Error(`unexpected omo --version: ${launcher}`);
    }

    const sandbox = {
      root: join(root, "sandbox"),
      cwd: join(root, "sandbox/project"),
      home: join(root, "sandbox/home"),
      agent: join(root, "sandbox/agent"),
      sessions: join(root, "sandbox/sessions"),
      evidence: join(root, "sandbox/evidence.jsonl"),
      script: join(root, "sandbox/project/mock-script.json"),
      runtimeNodeModules: join(runtime, "node_modules"),
      sideEffectPath: join(root, "sandbox/side-effects/fixture"),
      taskSendSignalPath: join(root, "sandbox/task-send.signal"),
    } as const;
    for (const path of [sandbox.cwd, sandbox.home, sandbox.agent, sandbox.sessions]) mkdirSync(path, { recursive: true });
    mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true });
    mkdirSync(dirname(sandbox.sideEffectPath), { recursive: true });
    mkdirSync(join(sandbox.home, ".omo"), { recursive: true });
    writeFileSync(
      join(sandbox.agent, "settings.json"),
      `${JSON.stringify({ defaultProjectTrust: "trust", packages: [], max_depth: 1 }, null, 2)}\n`,
    );
    const omoConfig = {
      memory: { enabled: false },
      max_depth: 1,
      task: {
        default_execution_mode: "process",
        process_runner: "child-process",
        max_depth: 1,
        resume_children: false,
      },
      agents: {
        quick: {
          model: "omo-mock/mock-1",
          max_depth: 1,
          allowed_subagents: ["quick"],
          execution_mode: "in-process",
        },
      },
      categories: { quick: { description: "Justice evidence spike", model: "omo-mock/mock-1", max_depth: 1, allowed_subagents: ["quick"] } },
    };
    writeFileSync(
      join(sandbox.cwd, ".omo/omo.json"),
      `${JSON.stringify(omoConfig, null, 2)}\n`,
    );
    writeFileSync(
      join(sandbox.home, ".omo/omo.json"),
      `${JSON.stringify(omoConfig, null, 2)}\n`,
    );

    const fixtureCapability = issueFixtureCapability({
      sessionId: "justice-spike-parent",
      toolCallId: "justice-spike-read-1",
      method: "subagent-driven-development",
      authorizationId: "justice-spike-parent:subagent-driven-development",
    });
    const fixtureEnvelope = capabilityEnvelopeFor(fixtureCapability, "original-task-description");

    const mockScript = buildTask1RuntimeMockScript(superpowersRoot, fixtureEnvelope);
    writeFileSync(sandbox.script, `${JSON.stringify(mockScript, null, 2)}\n`);

    spawnEnvForEval = runtimeEnv(sandbox, superpowersRoot);
    const capabilityEnvVarAbsent =
      spawnEnvForEval.JUSTICE_SPIKE_CAPABILITY_ENVELOPE === undefined &&
      !Object.hasOwn(spawnEnvForEval, "JUSTICE_SPIKE_CAPABILITY_ENVELOPE");
    const result = await run(
      [
        join(omoRoot, "bin/omo.js"),
        "-e",
        superpowersRoot,
        "-e",
        mockProvider,
        "-e",
        probeExtension,
        "-p",
        "--mode",
        "json",
        "--provider",
        "omo-mock",
        "--model",
        "mock-1",
        "--session-dir",
        sandbox.sessions,
        "SPIKE_RECOGNIZED_PARENT",
      ],
      { cwd: sandbox.cwd, env: spawnEnvForEval },
    );

    const rpcConfiguration = {
      command: BUN,
      commandArgs: [
        join(omoRoot, "bin/omo.js"),
        "-e", superpowersRoot,
        "-e", mockProvider,
        "-e", probeExtension,
        "--mode", "rpc",
        "--multi-session",
        "--provider", "omo-mock",
        "--model", "mock-1",
        "--session-dir", sandbox.sessions,
      ],
      cwd: sandbox.cwd,
      prompts: ["SPIKE_RECOGNIZED_PARENT"],
      expectedCapabilityCalls: [
        { toolCallId: "justice-spike-task-2", originalDescription: "original-task-description" },
        { toolCallId: "justice-spike-task-fallback", originalDescription: "fallback-probe-description" },
        { toolCallId: "justice-spike-unknown-echo", originalDescription: "original-task-description" },
        { toolCallId: "justice-spike-invalid-schema", originalDescription: null },
        { toolCallId: "justice-spike-task-sanitizer-failure", originalDescription: "original-task-description" },
        { toolCallId: "justice-spike-case-b-late-echo", originalDescription: "original-task-description" },
        { toolCallId: "justice-spike-post-failure-task", originalDescription: "post-failure-task-description" },
      ],
      expectedSyntheticToolCallIds: [
        "justice-spike-unknown-echo",
        "justice-spike-invalid-schema",
        "justice-spike-task-sanitizer-failure",
        "justice-spike-case-b-late-echo",
      ],
    };
    const rpcResult = await run([rpcSessionDriver, JSON.stringify(rpcConfiguration)], {
      cwd: sandbox.cwd,
      env: spawnEnvForEval,
    });
    const rpcSummary = readRpcSessionSummary(rpcResult.stdout);
    if (rpcSummary.setupError !== undefined) {
      throw new Error(
        `RPC session evidence failed: ${rpcSummary.setupError}; responses=${(rpcSummary.rpcResponseTrace ?? []).join(",")}`,
      );
    }
    if (rpcSummary.sessionId === undefined) throw new Error("RPC session identity unavailable");

    const rows = evidence(sandbox.evidence);
    const rpcAppendObservations = rpcSummary.entryAppendedObservations ?? [];
    const assistantToolCallAppendObservations: readonly EvidenceRow[] = rpcAppendObservations.map((row) => ({
      ...row,
      persistedEntryReadBack: row.immediateJsonlReadBackMatched === true,
    }));
    const rpcSyntheticToolResultObservations = rpcSummary.syntheticToolResultObservations ?? [];
    const rpcFallbackAppendObservations = rpcSummary.fallbackAppendObservations ?? [];
    const rpcAppendEvidenceRows: readonly EvidenceRow[] = assistantToolCallAppendObservations.map((row) => ({
      ...row,
      event: "assistant_tool_call_append_observed",
      entryAppendedObserved: row.subscriptionEvent === "entry_appended",
      sessionFileReadBackMatched: row.immediateJsonlReadBackMatched === true,
      capabilityAbsentFromPersistedArguments: row.capabilityAbsentFromArguments === true,
      toolExecutionStartedAfterAppend: row.toolExecutionStartedAfterAppend === true,
    }));
    const rpcSyntheticResultEvidenceRows: readonly EvidenceRow[] = rpcSyntheticToolResultObservations.map((row) => ({
      ...row,
      event: "rpc_synthetic_tool_result_append_observed",
    }));
    const rpcFallbackEvidenceRows: readonly EvidenceRow[] = rpcFallbackAppendObservations.map((row) => ({
      ...row,
      event: "rpc_failure_fallback_append_observed",
    }));
    const parentSessionIdValue = rows.find(
      (row) => row.event === "before_agent_start" && typeof row.prompt === "string" && row.prompt.includes("SPIKE_RECOGNIZED_PARENT"),
    )?.sessionId;
    const parentSessionId = typeof parentSessionIdValue === "string" ? parentSessionIdValue : undefined;
    const parentRows = rows.filter((row) => row.sessionId === parentSessionId);
    const activation = parentRows.find((row) => row.event === "activation_evidence");
    const taskCall = parentRows.find((row) => row.event === "tool_call" && row.toolName === "task");
    const taskResult = parentRows.find((row) => row.event === "tool_result" && row.toolName === "task");
    const runtimeTaskId = (taskResult?.details as { readonly task_id?: string } | undefined)?.task_id;
    const taskInputAfter = taskCall?.inputAfter as Record<string, unknown> | undefined;
    const mutableInput =
      taskCall?.fixtureMutation === true &&
      typeof taskInputAfter === "object" &&
      taskInputAfter !== null &&
      typeof taskInputAfter.prompt === "string" &&
      taskInputAfter.prompt.includes(APPENDIX) === true &&
      typeof taskCall?.inputBefore === "object" &&
      taskCall.inputBefore !== null &&
      typeof (taskCall.inputBefore as Record<string, unknown>).prompt === "string" &&
      ((taskCall.inputBefore as Record<string, unknown>).prompt as string).includes(APPENDIX) !== true;

    const capabilityContextDelivered = parentRows.some(
      (row) => row.event === "capability_context_delivered" && row.deliveryKind === "request_local_context_copy",
    );
    const capabilityStrip = parentRows.find(
      (row) => row.event === "tool_call_capability_stripped" && row.hadCapability === true,
    );
    const childSessionIdValue = rows.find((row) => row.event === "before_agent_start" && row.isChild === true)?.sessionId;
    const childSessionId = typeof childSessionIdValue === "string" ? childSessionIdValue : undefined;

    const storageScanRows = rows.filter((row) => row.event === "storage_scan");
    const sessionManagerHistoryReadback = rows
      .filter(
        (row) =>
          row.event === "session_manager_history_readback" &&
          row.sessionId === parentSessionId &&
          row.phase === "session_shutdown",
      )
      .at(-1);
    const anyStorageScanPerformed = storageScanRows.length > 0;
    const allStorageScansTokenFree =
      storageScanRows.length > 0 &&
      storageScanRows.every((row) => row.tokenFound === false && row.unsafeStorage === false);
    const allStorageScansSafe = allStorageScansTokenFree;

    const rawEvidenceText = readFileSync(sandbox.evidence, "utf8");
    const decodedEnvelope = decodeTaskCapabilityEnvelope(fixtureEnvelope);
    const sensitiveTokens: string[] = [];
    if (decodedEnvelope.kind === "decoded") sensitiveTokens.push(decodedEnvelope.capabilityId);
    sensitiveTokens.push(fixtureEnvelope);
    const rawEvidenceLeaks = sensitiveTokens.filter((token) => rawEvidenceText.includes(token));
    if (rawEvidenceLeaks.length > 0) {
      for (const token of rawEvidenceLeaks) {
        const idx = rawEvidenceText.indexOf(token);
        process.stderr.write(
          `RAW_EVIDENCE_LEAK token_prefix=${token.slice(0, 60)} token_len=${token.length} index=${idx} context=${rawEvidenceText.slice(Math.max(0, idx - 80), idx + 200)}\n`,
        );
      }
    }

    const credentialScanRows = rows.filter((row) => row.event === "provider_credential_scan");
    const runtimeEnvCredentialLeak = CREDENTIAL_ENV_VARS_FOR_EVAL.filter((name) => {
      const value = spawnEnvForEval?.[name];
      return typeof value === "string" && value.length > 0;
    });

    const providerBlockedRows = rows.filter((row) => row.event === "fixture_provider_selection_blocked");
    const providerObservedRows = rows.filter((row) => row.event === "assistant_message_provider_observed");
    const nonMockSelectionBlocked = providerBlockedRows.some(
        (row) => row.attemptedProvider !== "omo-mock" && row.guardVerdict === "blocked" && row.guardFailReason === "non_mock_provider",
    );

    const rejections = rows.filter((row) => row.event === "capability_presentation_rejected");
    const rejectionReasons = new Set(rejections.map((row) => String(row.reason)));

    const compactionRows = rows.filter((row) => row.event === "capability_invalidated_by_compaction");
    const acceptedCompaction = compactionRows.some((row) => row.accepted === true);
    const restartRows = rows.filter((row) => row.event === "capability_invalidated_by_restart");

    const untrustedRows = rows.filter((row) => row.event === "task_source_untrusted");

    const batchBindingRows = rows.filter((row) => row.event === "task_batch_binding_normalized");
    const batchIndexes = new Set(batchBindingRows.map((row) => Number(row.batchItemIndex)));

    const taskSendRows = rows.filter((row) => row.event === "task_send_continuation_observed");

    const replayRows = rows.filter((row) => row.event === "capability_presentation_rejected");

    const protocolAffiliationRows = parentRows.filter((row) => row.event === "authenticated_protocol_affiliation_observed");
    const protocolAffiliationRow = protocolAffiliationRows[0];
    const authenticatedProtocolAffiliationObserved = protocolAffiliationRows.length > 0;
    const activationBindingValidated = authenticatedProtocolAffiliationObserved && protocolAffiliationRow?.activationBindingValidated === true;
    const privateOutboundReceiptValidated = authenticatedProtocolAffiliationObserved && protocolAffiliationRow?.privateOutboundReceiptValidated === true;
    const exactCallBindingValidated = authenticatedProtocolAffiliationObserved && protocolAffiliationRow?.exactCallBindingValidated === true;
    const strippedArgsDigestValidated = authenticatedProtocolAffiliationObserved && protocolAffiliationRow?.strippedArgsDigestValidated === true;
    const capabilityRestoredAndStripped = capabilityContextDelivered && capabilityStrip !== undefined;
    const tokenFreeReadBackValidated = anyStorageScanPerformed && allStorageScansTokenFree;

    // Harness-side authoritative final scan after the runtime exited: no async race,
    // covers the full isolated tree for the harness-issued capability identity.
    const harnessScanSessionFiles = Array.from(
      new Set(rows.filter((row) => typeof row.sessionFile === "string").map((row) => row.sessionFile as string)),
    );
    const harnessScanSessionIds = Array.from(
      new Set(
        rows
          .filter((row) => row.event === "session_start" && typeof row.sessionId === "string")
          .map((row) => row.sessionId as string),
      ),
    );
    const harnessFinalScan = await inspectCapabilitySessionStorage({
      isolatedRoot: sandbox.root,
      sessionFiles: harnessScanSessionFiles,
      sessionIds: harnessScanSessionIds,
      capabilityIds: sensitiveTokens.filter((token) => token !== fixtureEnvelope),
      excludedRelativePaths: ["project/mock-script.json"],
    });
    const harnessFinalScanSafe =
      harnessFinalScan.tokenFound === false &&
      harnessFinalScan.unsafeStorage === false;
    const finalScanClassesComplete =
      REQUIRED_STORAGE_CLASSES.every((storageClass) => harnessFinalScan.classesObserved.includes(storageClass)) &&
      harnessFinalScan.explicitSessionFilesRequired > 0 &&
      harnessFinalScan.explicitSessionFilesObserved === harnessFinalScan.explicitSessionFilesRequired &&
      harnessFinalScan.sessionIdsRequired >= 2 &&
      harnessFinalScan.sessionIdsObserved === harnessFinalScan.sessionIdsRequired &&
      harnessFinalScan.sessionManagerEntriesRequired > 0 &&
      harnessFinalScan.sessionManagerEntriesObserved === harnessFinalScan.sessionManagerEntriesRequired;
    const childSessionIds = Array.from(
      new Set(
        rows
          .filter((row) => row.event === "before_agent_start" && row.isChild === true && typeof row.sessionId === "string")
          .map((row) => row.sessionId as string),
      ),
    );
    const startedSessionIds = Array.from(
      new Set(
        rows
          .filter((row) => row.event === "session_start" && typeof row.sessionId === "string")
          .map((row) => row.sessionId as string),
      ),
    );
    const sessionManagerHistoryRows = rows.filter((row) => row.event === "session_manager_history_readback");
    const expectedHistorySessionIds = Array.from(
      new Set(
        [parentSessionId, ...startedSessionIds, ...childSessionIds].filter(
          (sessionId): sessionId is string => typeof sessionId === "string",
        ),
      ),
    );
    const shutdownHistorySessionIds = Array.from(
      new Set(
        sessionManagerHistoryRows
          .filter((row) => row.phase === "session_shutdown" && typeof row.sessionId === "string")
          .map((row) => row.sessionId as string),
      ),
    );
    const expectedHistorySessionIdSet = new Set(expectedHistorySessionIds);
    const sessionManagerHistoryReadbacksForExpected = shutdownHistorySessionIds.filter((sessionId) =>
      expectedHistorySessionIdSet.has(sessionId),
    ).length;
    const sessionManagerHistoryCoverage = {
      expectedSessions: expectedHistorySessionIds.length,
      readbacks: sessionManagerHistoryReadbacksForExpected,
      expectedSessionIds: expectedHistorySessionIds,
      startedSessionIds,
      childSessionIds,
      shutdownSessionIds: shutdownHistorySessionIds,
      snapshots: sessionManagerHistoryRows.map((row) => ({
        sessionId: typeof row.sessionId === "string" ? row.sessionId : null,
        phase: row.phase,
        headerValid: row.headerValid === true,
        headerCount: typeof row.headerCount === "number" ? row.headerCount : null,
        sessionEntriesObserved: typeof row.sessionEntriesObserved === "number" ? row.sessionEntriesObserved : null,
        diskEntriesObserved: typeof row.diskEntriesObserved === "number" ? row.diskEntriesObserved : null,
        entryIdsAndBranchesMatch: row.entryIdsAndBranchesMatch === true,
        tokenFoundInMemoryEntries: row.tokenFoundInMemoryEntries === true,
        tokenFoundInDiskEntries: row.tokenFoundInDiskEntries === true,
        unsafeStorage: row.unsafeStorage !== false,
        failureReasons: Array.isArray(row.failureReasons) ? row.failureReasons : ["failure_reasons_unavailable"],
      })),
      complete: areSessionManagerHistoriesComplete(sessionManagerHistoryRows, expectedHistorySessionIds),
    };
    const capabilitySideEffectMarkerPresent = existsSync(`${sandbox.sideEffectPath}.capability`);
    const positiveControlMarkerPresent = existsSync(`${sandbox.sideEffectPath}.positive`);
    const evidenceRowsWithHarnessScan: readonly EvidenceRow[] = [
      ...rows,
      ...rpcAppendEvidenceRows,
      ...rpcSyntheticResultEvidenceRows,
      ...rpcFallbackEvidenceRows,
      {
        event: "fixture_side_effect_post_exit_scan",
        capabilityMarkerPresent: capabilitySideEffectMarkerPresent,
        positiveControlMarkerPresent,
      },
      {
        event: "storage_scan",
        label: "final_authoritative",
        source: "harness_post_exit_scan",
        tokenFound: harnessFinalScan.tokenFound,
        unsafeStorage: harnessFinalScan.unsafeStorage,
        filesChecked: harnessFinalScan.filesChecked,
        entriesChecked: harnessFinalScan.entriesChecked,
        classesObserved: harnessFinalScan.classesObserved,
        explicitSessionFilesRequired: harnessFinalScan.explicitSessionFilesRequired,
        explicitSessionFilesObserved: harnessFinalScan.explicitSessionFilesObserved,
        sessionIdsRequired: harnessFinalScan.sessionIdsRequired,
        sessionIdsObserved: harnessFinalScan.sessionIdsObserved,
        sessionManagerEntriesRequired: harnessFinalScan.sessionManagerEntriesRequired,
        sessionManagerEntriesObserved: harnessFinalScan.sessionManagerEntriesObserved,
      },
    ];

    setCapabilityRuntimeEvidence(
      evidenceRowsWithHarnessScan,
      parentSessionId,
      childSessionId,
      fixtureEnvelope,
      rawEvidenceText,
      capabilityEnvVarAbsent,
    );
    const hostContracts = evaluateHostRuntimeContracts({
      rows,
      parentSessionId,
      childSessionId,
      runtimeTaskId: typeof runtimeTaskId === "string" ? runtimeTaskId : undefined,
      runtimeEnv: spawnEnvForEval,
      agentSettingsPath: join(sandbox.agent, "settings.json"),
      superpowersRoot,
    }).contracts;
    const capabilityContractEvaluation = evaluateCapabilityRuntimeContracts({
      rows: evidenceRowsWithHarnessScan,
      parentSessionId,
      childSessionId,
      fixtureEnvelope,
      rawEvidenceText,
      capabilityEnvVarAbsent,
    });
    const capabilityContracts = capabilityContractEvaluation.contracts;
    const contracts = { ...hostContracts, ...capabilityContracts };
    const blockedContracts = Object.entries(contracts)
      .filter(([, proven]) => !proven)
      .map(([name]) => name)
      .sort();
    const unknownToolEmissionRows = rows.filter((row) => row.event === "unknown_tool_model_emitted");
    const unknownToolIds = new Set(unknownToolEmissionRows.map((row) => String(row.toolCallId)));
    const unknownToolResultCount = rows.filter(
      (row) => row.event === "tool_result" && unknownToolIds.has(String(row.toolCallId)),
    ).length;
    const unknownToolSanitizedCount = rows.filter(
      (row) => row.event === "tool_result_sanitized" && unknownToolIds.has(String(row.toolCallId)),
    ).length;
    const unknownRpcSyntheticResults = rpcSyntheticToolResultObservations.filter(
      (row) => typeof row.toolCallId === "string" && unknownToolIds.has(row.toolCallId),
    );
    const unknownRpcSyntheticResultsReadBackSafely =
      unknownToolIds.size > 0 &&
      Array.from(unknownToolIds).every((toolCallId) =>
        unknownRpcSyntheticResults.some(
          (row) =>
            row.toolCallId === toolCallId &&
            row.entryAppendedObserved === true &&
            row.isError === true &&
            row.immediateJsonlReadBackMatched === true &&
            row.capabilityAbsentFromResult === true,
          ),
      );
    const unknownToolSanitizerObservations = rows
      .filter(
        (row) =>
          row.event === "synthetic_tool_result_message_end_observed" &&
          typeof row.toolCallId === "string" &&
          unknownToolIds.has(row.toolCallId),
      )
      .map((row) => ({
        sessionId: typeof row.sessionId === "string" ? row.sessionId : null,
        toolCallId: typeof row.toolCallId === "string" ? row.toolCallId : null,
        messageId: typeof row.messageId === "string" ? row.messageId : null,
        sanitizerSource: row.sanitizerSource,
        capabilityTokenPresentBeforeSanitization: row.capabilityTokenPresentBeforeSanitization === true,
        capabilityTokenAbsentAfterSanitization: row.capabilityTokenAbsentAfterSanitization === true,
        sanitizationChanged: row.sanitizationChanged === true,
        unknownToolCall: row.unknownToolCall === true,
        registeredSchemaValidationProbe: row.registeredSchemaValidationProbe === true,
      }));
    const registeredSchemaToolCallId = "justice-spike-invalid-schema";
    const registeredSchemaAssistantCall = assistantToolCallAppendObservations.find(
      (row) => row.toolCallId === registeredSchemaToolCallId,
    );
    const registeredSchemaSyntheticResult = rpcSyntheticToolResultObservations.find(
      (row) => row.toolCallId === registeredSchemaToolCallId,
    );
    const registeredSchemaToolExecutionStarted = rows.some(
      (row) =>
        row.event === "fixture_schema_validation_probe_executed" &&
        row.toolCallId === registeredSchemaToolCallId,
    );
    const registeredSchemaNoReceiptOrProvenance =
      !rows.some(
        (row) => row.event === "capability_outbound_captured" && row.toolCallId === registeredSchemaToolCallId,
      ) &&
      !rows.some(
        (row) => row.event === "task_provenance_validated" && row.toolCallId === registeredSchemaToolCallId,
      );
    const registeredSchemaValidationProven =
      rows.some((row) => row.event === "fixture_schema_validation_probe_registered") &&
      registeredSchemaAssistantCall?.persistedEntryReadBack === true &&
      registeredSchemaAssistantCall.capabilityAbsentFromArguments === true &&
      registeredSchemaSyntheticResult?.entryAppendedObserved === true &&
      registeredSchemaSyntheticResult.isError === true &&
      registeredSchemaSyntheticResult.immediateJsonlReadBackMatched === true &&
      registeredSchemaSyntheticResult.capabilityAbsentFromResult === true &&
      !registeredSchemaToolExecutionStarted &&
      registeredSchemaNoReceiptOrProvenance &&
      harnessFinalScanSafe;
    const registeredSchemaValidationStatus = registeredSchemaValidationProven ? "PROVEN" : "BLOCKED";
    const providerStreamErrorObserved = rows.some((row) => row.event === "message_end_forced_failure_injected");
    const sanitizerFailureRow = parentRows.find((row) => row.event === "sanitizer_failure_fault_injected");
    const sanitizerFailureReadbackMatches =
      sessionManagerHistoryReadback !== undefined &&
      sanitizerFailureRow !== undefined &&
      sessionManagerHistoryReadback.sessionId === sanitizerFailureRow.sessionId &&
      sessionManagerHistoryReadback.phase === "session_shutdown" &&
      sessionManagerHistoryReadback.headerValid === true &&
      sessionManagerHistoryReadback.headerCount === 1 &&
      sessionManagerHistoryReadback.entryIdsAndBranchesMatch === true &&
      sessionManagerHistoryReadback.sanitizerFailureFallbackMemoryEntries === 1 &&
      sessionManagerHistoryReadback.sanitizerFailureFallbackDiskEntries === 1 &&
      sessionManagerHistoryReadback.tokenFoundInMemoryEntries === false &&
      sessionManagerHistoryReadback.tokenFoundInDiskEntries === false &&
      sessionManagerHistoryReadback.unsafeStorage === false;
    const sanitizerFailureCallId =
      typeof sanitizerFailureRow?.toolCallId === "string" ? sanitizerFailureRow.toolCallId : undefined;
    const noTrustedSanitizerFailureExecution =
      sanitizerFailureCallId !== undefined &&
      !parentRows.some(
        (row) =>
          row.event === "runtime_task_identity_observed" &&
          String(row.toolCallId) === sanitizerFailureCallId,
      ) &&
      !parentRows.some(
        (row) =>
          row.event === "authenticated_protocol_affiliation_observed" &&
          String(row.toolCallId) === sanitizerFailureCallId,
      );
    const sanitizerFailureReplayRejected =
      sanitizerFailureCallId !== undefined &&
      parentRows.some(
        (row) =>
          row.event === "sanitizer_failure_receipt_replay_rejected" &&
          row.toolCallId === sanitizerFailureCallId &&
          row.receiptReplayRejected === true,
      );
    const caseBFreshRead = parentRows.find(
      (row) =>
        row.event === "activation_evidence" &&
        row.observedCallOrInputId === "justice-spike-case-b-reauthorizing-read",
    );
    const caseBReauthorizedTask = parentRows.find(
      (row) =>
        row.event === "authenticated_protocol_affiliation_observed" &&
        row.toolCallId === "justice-spike-post-failure-task",
    );
    const caseBFailureRowIndex = parentRows.findIndex((row) => row.event === "sanitizer_failure_fault_injected");
    const caseBFreshReadIndex = caseBFreshRead === undefined ? -1 : parentRows.indexOf(caseBFreshRead);
    const caseBReauthorizedTaskIndex =
      caseBReauthorizedTask === undefined ? -1 : parentRows.indexOf(caseBReauthorizedTask);
    const freshReadReauthorizedAfterFailure =
      caseBFailureRowIndex >= 0 &&
      caseBFreshReadIndex > caseBFailureRowIndex &&
      caseBReauthorizedTaskIndex > caseBFreshReadIndex &&
      caseBReauthorizedTask?.issuedFromReadToolCallId === "justice-spike-case-b-reauthorizing-read";
    const caseBLateEchoSanitized =
      parentRows.some(
        (row) =>
          row.event === "message_end_sanitized" &&
          row.toolCallId === "justice-spike-case-b-late-echo" &&
          row.hadCapability === true,
      ) &&
      sanitizerFailureReadbackMatches;
    const sanitizerFailureControlProven =
      sanitizerFailureRow?.failureSurface === "message_end_guard" &&
      sanitizerFailureRow.messageEndHookObserved === true &&
      sanitizerFailureRow.failureInjectedAfterCaptureAndSanitation === true &&
      sanitizerFailureRow.candidateReceiptCaptured === true &&
      sanitizerFailureRow.sanitationCompleted === true &&
      sanitizerFailureRow.sanitizedInputTokenFree === true &&
      sanitizerFailureRow.candidateReceiptsInvalidated === true &&
      sanitizerFailureRow.liveCapabilityInvalidated === true &&
      sanitizerFailureRow.activationInvalidated === true &&
      sanitizerFailureRow.postFailureProvenance !== "superpowers" &&
      sanitizerFailureRow.exactMinimalFallbackObserved === true &&
      sanitizerFailureReadbackMatches &&
      noTrustedSanitizerFailureExecution &&
      sanitizerFailureReplayRejected &&
      freshReadReauthorizedAfterFailure &&
      caseBLateEchoSanitized &&
      harnessFinalScanSafe;
    const directTaskExecutionModes = parentRows
      .filter((row) => row.event === "tool_result" && row.toolName === "task")
      .flatMap((row) => {
        const details = isRecord(row.details) ? row.details : {};
        if (Array.isArray(details.items) || typeof row.toolCallId !== "string") return [];
        const runtimeTaskId = typeof details.task_id === "string" ? details.task_id : null;
        const reportedMode = details.execution_mode;
        const executionMode =
          reportedMode === "in-process" || reportedMode === "process"
            ? reportedMode
            : runtimeTaskId === null
              ? null
              : readTaskStateExecutionMode(sandbox.agent, runtimeTaskId);
        return [{
          toolCallId: row.toolCallId,
          runtimeTaskId,
          executionMode,
          modeSource:
            reportedMode === "in-process" || reportedMode === "process"
              ? "tool_result.details.execution_mode"
              : executionMode === null
                ? "unavailable"
                : "task_state.execution_mode",
        }];
      });
    const batchTaskExecutionModes = parentRows.flatMap((row) => {
      if (
        row.event !== "task_batch_binding_normalized" ||
        typeof row.runtimeTaskId !== "string" ||
        typeof row.batchItemIndex !== "number"
      ) {
        return [];
      }
      const runtimeTaskId = row.runtimeTaskId;
      const executionMode = readTaskStateExecutionMode(sandbox.agent, runtimeTaskId);
      return [
        {
          toolCallId: typeof row.parentToolCallId === "string" ? row.parentToolCallId : null,
          batchItemIndex: row.batchItemIndex,
          runtimeTaskId,
          executionMode,
          modeSource: executionMode === null ? "unavailable" : "task_state.execution_mode",
        },
      ];
    });
    const taskExecutionModes = [...directTaskExecutionModes, ...batchTaskExecutionModes];

    summary = {
      task1Result: blockedContracts.length === 0 ? "PROVEN" : "BLOCKED",
      blockedContracts,
      expected: EXPECTED,
      versions: {
        omo: omoPackage.version,
        senpi: senpiPackage.version,
        superpowers: superpowersPackage.version,
        launcher,
      },
      contracts,
      blockedAt: blockedContracts[0] ?? null,
      observed: {
        parentSessionId: parentSessionId ?? null,
        rpcSessionId: rpcSummary.sessionId,
        capabilityContractDiagnostics: capabilityContractEvaluation.diagnostics,
        rpcSessionLifecycle: {
          listedSessionCount: rpcSummary.listedSessionCount ?? null,
          attachedSessionCount: rpcSummary.attachedSessionCount ?? null,
          closedSessionCount: rpcSummary.closedSessionCount ?? null,
        },
        activationEvidenceKind: activation?.evidenceKind ?? null,
        activationMethod: activation?.method ?? null,
        taskToolCallId: taskCall?.toolCallId ?? null,
        taskParentToolCallId: taskCall?.parentToolCallId ?? null,
        taskEventKeys: taskCall?.eventKeys ?? [],
        currentSessionActivationObservedAtTask: taskCall?.currentSessionActivationObserved ?? false,
        runtimeTaskId: runtimeTaskId ?? null,
        taskExecutionModes,
        taskInputMutationReachedNativeCall: mutableInput,
        authenticatedProtocolAffiliationObserved,
        activationBindingValidated,
        privateOutboundReceiptValidated,
        exactCallBindingValidated,
        strippedArgsDigestValidated,
        capabilityRestoredAndStripped,
        tokenFreeReadBackValidated,
        promptSemanticsUsedAsAuthority: false,
        protocolAffiliationProvenanceKind: (protocolAffiliationRow?.protocolAffiliationAuthority as string | undefined) ?? null,
        capabilityDigest: (protocolAffiliationRow?.capabilityDigest as string | undefined) ?? null,
        strippedTaskArgsDigest: (protocolAffiliationRow?.strippedTaskArgsDigest as string | undefined) ?? null,
        nativeTaskToolCallFieldsObserved: (taskCall?.nativeTaskToolCallFieldsObserved as readonly string[] | undefined) ?? null,
        hostIndependentSuperpowersOriginField: (taskCall?.hostIndependentSuperpowersOriginField as string | undefined) ?? null,
        processExitStatus: result.exitCode,
        stderrTail: (result.stderr ?? "").slice(-2000),
        taskSendOutcomes: taskSendRows,
        batchBindingCount: batchBindingRows.length,
        batchIndexes: Array.from(batchIndexes).sort((a, b) => a - b),
        capabilityRejectionReasons: Array.from(rejectionReasons).sort(),
        untrustedClassifications: untrustedRows.map((row) => ({ kind: row.classificationKind, reason: row.reason })),
        compactionInvalidationCount: compactionRows.length,
        acceptedCompaction,
        restartInvalidationCount: restartRows.length,
        credentialScanRows: credentialScanRows.length,
        runtimeEnvCredentialLeak,
        providerObservations: providerObservedRows.map((row) => ({ provider: row.provider, model: row.model, verdict: row.guardVerdict })),
        nonMockSelectionBlocked,
        replayReasons: replayRows.map((row) => row.reason),
        capabilityEnvVarAbsent,
        allStorageScansSafe,
        finalScanClassesComplete,
        sessionManagerHistoryReadback: sessionManagerHistoryReadback ?? null,
        assistantToolCallAppendObservations,
        rpcSyntheticToolResultObservations,
        sessionManagerHistoryCoverage,
        storageScanOutcomes: storageScanRows.map((row) => ({
          label: row.label,
          tokenFound: row.tokenFound,
          unsafeStorage: row.unsafeStorage,
          sessionIdsRequired: row.sessionIdsRequired,
          sessionIdsObserved: row.sessionIdsObserved,
          explicitSessionFilesRequired: row.explicitSessionFilesRequired,
          explicitSessionFilesObserved: row.explicitSessionFilesObserved,
          classesObserved: row.classesObserved,
          sessionManagerEntriesRequired: row.sessionManagerEntriesRequired,
          sessionManagerEntriesObserved: row.sessionManagerEntriesObserved,
        })),
        appendObservationSource: assistantToolCallAppendObservations.length > 0
          ? "AgentSession.subscribe via Senpi RPC"
          : "unavailable",
        entryAppendedSubscriptionAvailable: assistantToolCallAppendObservations.some(
          (row) => row.subscriptionEvent === "entry_appended" && row.persistedEntryReadBack === true,
        ),
        providerStreamErrorControl: {
          status: "BLOCKED",
          streamErrorObserved: providerStreamErrorObserved,
          messageEndSanitationObserved: rows.some(
            (row) => row.event === "message_end_sanitized" && row.forcedFailureArmed === true,
          ),
          candidateReceiptCaptured: parentRows.some(
            (row) =>
              row.event === "message_end_sanitized" &&
              row.forcedFailureArmed === true &&
              row.outboundReceiptCaptured === true,
          ),
          invalidationObserved: parentRows.some(
            (row) => row.event === "provider_stream_error_authority_invalidated",
          ),
          candidateReceiptsInvalidated: parentRows.some(
            (row) =>
              row.event === "provider_stream_error_authority_invalidated" &&
              row.candidateReceiptsInvalidated === true,
          ),
          liveCapabilityInvalidated: parentRows.some(
            (row) =>
              row.event === "provider_stream_error_authority_invalidated" &&
              row.liveCapabilityInvalidated === true,
          ),
          activationInvalidated: parentRows.some(
            (row) =>
              row.event === "provider_stream_error_authority_invalidated" &&
              row.activationInvalidated === true,
          ),
          noTrustedExecution: !parentRows.some(
            (row) =>
              row.event === "runtime_task_identity_observed" &&
              row.toolCallId === parentRows.find(
                (candidate) => candidate.event === "message_end_forced_failure_injected",
              )?.toolCallId,
          ),
        },
        justiceSanitizerFailureControl: {
          status: sanitizerFailureControlProven ? "PROVEN" : "BLOCKED",
          failureInjectedAfterCaptureAndSanitation:
            sanitizerFailureRow?.failureInjectedAfterCaptureAndSanitation === true,
          failureSurface: sanitizerFailureRow?.failureSurface ?? "unobserved",
          messageEndHookObserved: sanitizerFailureRow?.messageEndHookObserved === true,
          capabilityReceiptCaptured: sanitizerFailureRow?.candidateReceiptCaptured === true,
          sanitationCompleted: sanitizerFailureRow?.sanitationCompleted === true,
          sanitizedInputTokenFree: sanitizerFailureRow?.sanitizedInputTokenFree === true,
          candidateReceiptsInvalidated: sanitizerFailureRow?.candidateReceiptsInvalidated === true,
          liveCapabilityInvalidated: sanitizerFailureRow?.liveCapabilityInvalidated === true,
          activationInvalidated: sanitizerFailureRow?.activationInvalidated === true,
          postFailureProvenance: sanitizerFailureRow?.postFailureProvenance ?? "unobserved",
          exactMinimalFallbackObserved:
            sanitizerFailureRow?.exactMinimalFallbackObserved === true &&
            sanitizerFailureReadbackMatches,
          persistedFallbackReadBackMatched:
            sanitizerFailureReadbackMatches,
          sameSessionFallbackReadBackMatched: sanitizerFailureReadbackMatches,
          noTrustedExecution: noTrustedSanitizerFailureExecution,
          oldReceiptReplayRejected: sanitizerFailureReplayRejected,
          freshReadReauthorized: freshReadReauthorizedAfterFailure,
          lateResponseSanitized: caseBLateEchoSanitized,
          task1ContractStatus:
            contracts.task1_message_end_fallback_prevents_token_persistence_on_error ? "PROVEN" : "BLOCKED",
          fallbackEvidence: sanitizerFailureReadbackMatches
            ? {
                sessionId: sessionManagerHistoryReadback?.sessionId ?? null,
                source: "ReadonlySessionManager.getEntries and matching session JSONL",
                memoryEntries: sessionManagerHistoryReadback?.sanitizerFailureFallbackMemoryEntries ?? 0,
                diskEntries: sessionManagerHistoryReadback?.sanitizerFailureFallbackDiskEntries ?? 0,
                fallbackExactBeforeAppend: sanitizerFailureRow?.exactMinimalFallbackObserved === true,
                tokenFree: sessionManagerHistoryReadback?.tokenFoundInMemoryEntries === false &&
                  sessionManagerHistoryReadback?.tokenFoundInDiskEntries === false,
              }
            : null,
        },
        failureInvalidationControls: {
          provider_stream_error: {
            status: "BLOCKED",
            streamErrorObserved: providerStreamErrorObserved,
            candidateReceiptsInvalidated: parentRows.some(
              (row) => row.event === "provider_stream_error_authority_invalidated" && row.candidateReceiptsInvalidated === true,
            ),
          },
          justice_sanitizer_failure: {
            status: sanitizerFailureControlProven ? "PROVEN" : "BLOCKED",
            failureInjectedAfterCaptureAndSanitation:
              sanitizerFailureRow?.failureInjectedAfterCaptureAndSanitation === true,
            exactMinimalFallbackObserved:
              sanitizerFailureRow?.exactMinimalFallbackObserved === true &&
              sanitizerFailureReadbackMatches,
          },
        },
        syntheticUnknownToolResult: {
          status: contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence
            ? "PROVEN"
            : "BLOCKED",
          actualUnknownToolModelCallObserved: unknownToolEmissionRows.length > 0,
          actualSyntheticToolResultMessageEndObserved: unknownToolSanitizerObservations.length > 0,
          resultCount: unknownToolResultCount,
          sanitizedCount: unknownToolSanitizedCount,
          rpcPersistedSyntheticResultObserved: unknownRpcSyntheticResults.length > 0,
          rpcPersistedSyntheticResultCount: unknownRpcSyntheticResults.length,
          rpcPersistedResultsReadBackSafely: unknownRpcSyntheticResultsReadBackSafely,
          messageEndSanitizerObservations: unknownToolSanitizerObservations,
        },
        registeredSchemaValidation: {
          attempted: registeredSchemaAssistantCall !== undefined,
          toolCallId: registeredSchemaToolCallId,
          toolRegistered: rows.some((row) => row.event === "fixture_schema_validation_probe_registered"),
          toolCallObserved: rows.some(
            (row) => row.event === "tool_call" && row.toolCallId === registeredSchemaToolCallId,
          ),
          toolExecutionStarted: registeredSchemaToolExecutionStarted,
          validationFailureObserved:
            registeredSchemaSyntheticResult?.isError === true && !registeredSchemaToolExecutionStarted,
          persistedSyntheticResultObserved: registeredSchemaSyntheticResult?.entryAppendedObserved === true,
          immediateJsonlReadBackMatched:
            registeredSchemaSyntheticResult?.immediateJsonlReadBackMatched === true,
          capabilityAbsentFromArguments:
            registeredSchemaAssistantCall?.capabilityAbsentFromArguments === true,
          capabilityAbsentFromResult:
            registeredSchemaSyntheticResult?.capabilityAbsentFromResult === true,
          noOutboundReceiptOrProvenance: registeredSchemaNoReceiptOrProvenance,
          status: registeredSchemaValidationStatus,
          task1ContractStatus:
            contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence ? "PROVEN" : "BLOCKED",
        },
        harnessFinalScan: {
          tokenFound: harnessFinalScan.tokenFound,
          unsafeStorage: harnessFinalScan.unsafeStorage,
          filesChecked: harnessFinalScan.filesChecked,
          entriesChecked: harnessFinalScan.entriesChecked,
          classesObserved: harnessFinalScan.classesObserved,
          explicitSessionFilesRequired: harnessFinalScan.explicitSessionFilesRequired,
          explicitSessionFilesObserved: harnessFinalScan.explicitSessionFilesObserved,
          sessionIdsRequired: harnessFinalScan.sessionIdsRequired,
          sessionIdsObserved: harnessFinalScan.sessionIdsObserved,
          sessionManagerEntriesRequired: harnessFinalScan.sessionManagerEntriesRequired,
          sessionManagerEntriesObserved: harnessFinalScan.sessionManagerEntriesObserved,
          safe: harnessFinalScanSafe,
        },
        nonTaskSideEffectMarkers: {
          capability: capabilitySideEffectMarkerPresent,
          positiveControl: positiveControlMarkerPresent,
        },
        nonTaskTrace: rows
          .filter(
            (row) =>
              row.event === "fixture_non_task_tool_executed" ||
              row.event === "non_task_capability_veto_armed" ||
              row.event === "fixture_non_task_tool_preflight_allowed" ||
              (row.event === "tool_call" && row.toolName === "fixture_non_task_side_effect"),
          )
          .map((row) => ({
            event: row.event,
            toolCallId: row.toolCallId,
            hadCapability: row.hadCapability,
            payloadContainsCapability: row.payloadContainsCapability,
            markerKind: row.markerKind,
            guardKind: (row.guardResult as { readonly kind?: unknown } | undefined)?.kind,
          })),
        storageScanCount: storageScanRows.length,
        fallbackInjectionCount: parentRows.filter((row) => row.event === "message_end_forced_failure_injected").length,
        fallbackObservedCount: parentRows.filter((row) => row.event === "message_end_error_fallback_observed").length,
        fallbackEvidence: parentRows
          .filter((row) => row.event === "message_end_error_fallback_observed")
          .map((row) => ({
            sameRoleFallback: row.sameRoleFallback,
            minimalContent: row.minimalContent,
            stopReasonObserved: row.stopReasonObserved,
            errorMessagePresent: row.errorMessagePresent,
            rawExceptionStack: row.rawExceptionStack,
            hadCapabilityToken: row.hadCapabilityToken,
          })),
        failedCallEvidence: (() => {
          const callId = parentRows.find((row) => row.event === "message_end_forced_failure_injected")?.toolCallId;
          if (typeof callId !== "string") return null;
          return {
            toolCallCount: parentRows.filter((row) => row.event === "tool_call" && String(row.toolCallId) === callId).length,
            blockedCount: parentRows.filter((row) => row.event === "tool_call" && String(row.toolCallId) === callId && row.forcedFailureBlock === true).length,
            resultCount: parentRows.filter((row) => row.event === "tool_result" && String(row.toolCallId) === callId).length,
            runtimeTaskIdentityCount: parentRows.filter((row) => row.event === "runtime_task_identity_observed" && String(row.toolCallId) === callId).length,
            outboundReceiptCount: parentRows.filter((row) => row.event === "capability_outbound_captured" && String(row.toolCallId) === callId).length,
          };
        })(),
        unknownToolEmissionCount: parentRows.filter((row) => row.event === "unknown_tool_model_emitted").length,
        unknownToolEvidence: (() => {
          const callIds = new Set(
            parentRows.filter((row) => row.event === "unknown_tool_model_emitted").map((row) => String(row.toolCallId)),
          );
          return {
            callCount: callIds.size,
            resultCount: parentRows.filter((row) => row.event === "tool_result" && callIds.has(String(row.toolCallId))).length,
            sanitizedCount: parentRows.filter((row) => row.event === "tool_result_sanitized" && callIds.has(String(row.toolCallId))).length,
          };
        })(),
        activationMethods: Array.from(
          new Set(rows.filter((row) => row.event === "activation_evidence").map((row) => String(row.method))),
        ).sort(),
        methodActivationProof: rows
          .filter((row) => row.event === "activation_evidence" && row.sessionId === parentSessionId)
          .map((row) => {
            const method = String(row.method);
            const callId = String(row.observedCallOrInputId);
            const sourcePath = typeof row.sourcePath === "string" ? row.sourcePath : "";
            return {
              method,
              callId,
              sameParentSession: row.sessionId === parentSessionId,
              canonicalInstalledPath:
                sourcePath.endsWith(`/skills/${method}/SKILL.md`) &&
                sourcePath.startsWith(`${superpowersRoot}/skills/`),
              successfulReadResult: rows.some(
                (result) =>
                  result.event === "tool_result" &&
                  result.toolName === "read" &&
                  String(result.toolCallId) === callId &&
                  result.isError === false,
              ),
            };
          }),
      },
    };

    if (process.env.JUSTICE_SPIKE_KEEP_ROOT === "1") {
      keepRoot = true;
    }
  } catch (error) {
    summary = {
      expected: EXPECTED,
      setupError: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error),
      contracts: {},
      blockedAt: "runtime_setup",
    };
  } finally {
    if (!keepRoot) {
      rmSync(root, { recursive: true, force: true });
    }
  }
  process.stdout.write(`JUSTICE_SPIKE_EVIDENCE_SUMMARY=${JSON.stringify(summary)}\n`);
}

void main();
