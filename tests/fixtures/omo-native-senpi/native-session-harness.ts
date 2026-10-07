import { spawnSync } from "node:child_process";
import {
existsSync,
mkdirSync,
mkdtempSync,
readFileSync,
rmSync,
writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const BUN = process.env.JUSTICE_SPIKE_BUN ?? "bun";
const APPENDIX = "[[JUSTICE_SPIKE_REVIEW_APPENDIX]]";
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
  readonly expected: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, string>>;
  readonly contracts: Readonly<Record<string, boolean>>;
  readonly blockedAt?: string | null;
  readonly observed?: Readonly<Record<string, unknown>>;
};

function run(args: ReadonlyArray<string>, options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly inherit?: boolean } = {}) {
  const inherit = options.inherit ?? process.env.JUSTICE_SPIKE_DEBUG_MODEL === "1";
  const result = spawnSync(BUN, args as string[], {
    encoding: inherit ? undefined : "utf8",
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    cwd: options.cwd,
    env: options.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `command failed (${String(result.status)}): bun ${args.join(" ")}\n${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`,
    );
  }
  return result;
}

function json<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
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
  },
  superpowersRoot: string,
  fixtureEnvelope: string,
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
    JUSTICE_SPIKE_CAPABILITY_ENVELOPE: fixtureEnvelope,
  };
}

function main(): void {
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
    run(["install", "--no-progress"], { cwd: runtime, env: process.env });

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
    const version = run([join(omoRoot, "bin/omo.js"), "--version"], { cwd: runtime, inherit: false });
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
    } as const;
    for (const path of [sandbox.cwd, sandbox.home, sandbox.agent, sandbox.sessions]) mkdirSync(path, { recursive: true });
    mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true });
    mkdirSync(join(sandbox.home, ".omo"), { recursive: true });
    writeFileSync(
      join(sandbox.agent, "settings.json"),
      `${JSON.stringify({ defaultProjectTrust: "trust", packages: [], max_depth: 3 }, null, 2)}\n`,
    );
    const omoConfig = {
      memory: { enabled: false },
      max_depth: 3,
      task: { default_execution_mode: "process", process_runner: "child-process", max_depth: 3 },
      agents: {
        quick: {
          model: "omo-mock/mock-1",
          max_depth: 3,
          allowed_subagents: ["quick"],
          execution_mode: "in-process",
        },
      },
      categories: { quick: { description: "Justice evidence spike", model: "omo-mock/mock-1", max_depth: 3, allowed_subagents: ["quick"] } },
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

    spawnEnvForEval = runtimeEnv(sandbox, superpowersRoot, fixtureEnvelope);
    const result = run(
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

    const rows = evidence(sandbox.evidence);
    const parentSessionId = rows.find(
      (row) => row.event === "before_agent_start" && typeof row.prompt === "string" && row.prompt.includes("SPIKE_RECOGNIZED_PARENT"),
    )?.sessionId;
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

    const capabilityContextDelivered = parentRows.some((row) => row.event === "capability_context_delivered");
    const capabilityStrip = parentRows.find((row) => row.event === "tool_call_capability_stripped");
    const childSessionId = rows.find((row) => row.event === "before_agent_start" && row.isChild === true)?.sessionId;

    const storageScanRows = rows.filter((row) => row.event === "storage_scan");
    const anyStorageScanPerformed = storageScanRows.length > 0;
    const allStorageScansTokenFree = storageScanRows.every((row) => row.tokenFound === false);

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

    setCapabilityRuntimeEvidence(rows, parentSessionId, fixtureEnvelope, rawEvidenceText);
    const hostContracts = evaluateHostRuntimeContracts({
      rows,
      parentSessionId,
      childSessionId,
      runtimeTaskId: typeof runtimeTaskId === "string" ? runtimeTaskId : undefined,
      runtimeEnv: spawnEnvForEval,
      agentSettingsPath: join(sandbox.agent, "settings.json"),
    }).contracts;
    const capabilityContracts = evaluateCapabilityRuntimeContracts({
      rows,
      parentSessionId,
      fixtureEnvelope,
      rawEvidenceText,
    }).contracts;

    summary = {
      expected: EXPECTED,
      versions: {
        omo: omoPackage.version,
        senpi: senpiPackage.version,
        superpowers: superpowersPackage.version,
        launcher,
      },
      contracts: {
        ...hostContracts,
        ...capabilityContracts,
      },
      blockedAt: null,
      observed: {
        parentSessionId: parentSessionId ?? null,
        activationEvidenceKind: activation?.evidenceKind ?? null,
        activationMethod: activation?.method ?? null,
        taskToolCallId: taskCall?.toolCallId ?? null,
        taskParentToolCallId: taskCall?.parentToolCallId ?? null,
        taskEventKeys: taskCall?.eventKeys ?? [],
        currentSessionActivationObservedAtTask: taskCall?.currentSessionActivationObserved ?? false,
        runtimeTaskId: runtimeTaskId ?? null,
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
        processExitStatus: result.status,
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

main();
