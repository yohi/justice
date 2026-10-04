import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED = {
  omoVersion: "5.1.17",
  omoCommit: "091728d274f20d62504b0b5e1edbc3970671dd8b",
  senpiVersion: "2026.10.8",
  senpiCommit: "d56e6a260d9468418a39bc9120945cf98e06b840",
  superpowersVersion: "6.4.2",
  superpowersCommit: "8ca22dba9a94f28898bbce59f2537ff4d87c747d",
};
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(fixtureDir, "mock-provider.mjs");
const probeExtension = join(fixtureDir, "probe-extension.mjs");
const BUN = process.env.JUSTICE_SPIKE_BUN ?? "bun";
const APPENDIX = "[[JUSTICE_SPIKE_REVIEW_APPENDIX]]";

function run(args, options = {}) {
  const result = spawnSync(BUN, args, {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`command failed (${String(result.status)}): bun ${args.join(" ")}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result;
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function evidence(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function runtimeEnv(sandbox, superpowersRoot) {
  const env = {};
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
  };
}

function main() {
  const root = mkdtempSync(join(tmpdir(), "justice-v5-native-spike-"));
  let summary;
  try {
    const runtime = join(root, "runtime");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, "package.json"), `${JSON.stringify({
      private: true,
      dependencies: {
        "omo-ai": EXPECTED.omoVersion,
        superpowers: `github:obra/superpowers#${EXPECTED.superpowersCommit}`,
      },
    }, null, 2)}\n`);
    run(["install", "--no-progress"], { cwd: runtime, env: process.env });

    const omoRoot = join(runtime, "node_modules/omo-ai");
    const superpowersRoot = join(runtime, "node_modules/superpowers");
    const senpiRoot = existsSync(join(runtime, "node_modules/@code-yeongyu/senpi/package.json"))
      ? join(runtime, "node_modules/@code-yeongyu/senpi")
      : join(omoRoot, "node_modules/@code-yeongyu/senpi");
    const omoPackage = json(join(omoRoot, "package.json"));
    const senpiPackage = json(join(senpiRoot, "package.json"));
    const superpowersPackage = json(join(superpowersRoot, "package.json"));
    if (omoPackage.version !== EXPECTED.omoVersion) throw new Error(`OmO version mismatch: ${String(omoPackage.version)}`);
    if (senpiPackage.version !== EXPECTED.senpiVersion) throw new Error(`Senpi version mismatch: ${String(senpiPackage.version)}`);
    if (superpowersPackage.version !== EXPECTED.superpowersVersion) throw new Error(`Superpowers version mismatch: ${String(superpowersPackage.version)}`);
    if (omoPackage.dependencies?.["@code-yeongyu/senpi"] !== EXPECTED.senpiVersion) {
      throw new Error(`OmO→Senpi pin mismatch: ${String(omoPackage.dependencies?.["@code-yeongyu/senpi"])}`);
    }
    const version = run([join(omoRoot, "bin/omo.js"), "--version"], { cwd: runtime });
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
    };
    for (const path of [sandbox.cwd, sandbox.home, sandbox.agent, sandbox.sessions]) mkdirSync(path, { recursive: true });
    mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true });
    writeFileSync(join(sandbox.agent, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "trust", packages: [] }, null, 2)}\n`);
    writeFileSync(join(sandbox.cwd, ".omo/omo.json"), `${JSON.stringify({
      memory: { enabled: false },
      task: { default_execution_mode: "process", process_runner: "child-process" },
      categories: { quick: { description: "Justice evidence spike", model: "omo-mock/mock-1" } },
    }, null, 2)}\n`);

    const skillPath = join(superpowersRoot, "skills/subagent-driven-development/SKILL.md");
    if (!existsSync(skillPath)) throw new Error(`Superpowers skill missing: ${skillPath}`);
    writeFileSync(sandbox.script, `${JSON.stringify({
      parentSteps: [
        { type: "tool_call", name: "read", arguments: { path: skillPath } },
        {
          type: "tool_call",
          name: "task",
          arguments: {
            category: "quick",
            prompt: "JUSTICE_REVIEW_TARGET\nReview the fixture and reply REVIEW_CHILD_DONE.",
            run_in_background: true,
            name: "provenance-probe",
          },
        },
        { type: "text", text: "SPIKE_PARENT_DONE" },
      ],
      childSteps: [{ type: "text", text: "REVIEW_CHILD_DONE" }],
    }, null, 2)}\n`);

    const result = run([
      join(omoRoot, "bin/omo.js"),
      "-e", superpowersRoot,
      "-e", mockProvider,
      "-e", probeExtension,
      "-p", "--mode", "json",
      "--provider", "omo-mock", "--model", "mock-1",
      "--session-dir", sandbox.sessions,
      "SPIKE_RECOGNIZED_PARENT",
    ], { cwd: sandbox.cwd, env: runtimeEnv(sandbox, superpowersRoot) });

    const rows = evidence(sandbox.evidence);
    const parentSessionId = rows.find((row) => row.event === "before_agent_start" && row.prompt?.includes("SPIKE_RECOGNIZED_PARENT"))?.sessionId;
    const parentRows = rows.filter((row) => row.sessionId === parentSessionId);
    const bootstrap = parentRows.some((row) => row.event === "context" && row.hasSuperpowersBootstrap === true);
    const activation = parentRows.find((row) => row.event === "activation_evidence");
    const taskCall = parentRows.find((row) => row.event === "tool_call" && row.toolName === "task");
    const taskResult = parentRows.find((row) => row.event === "tool_result" && row.toolName === "task");
    const runtimeTaskId = taskResult?.details?.task_id;
    const mutableInput = taskCall?.fixtureMutation === true
      && taskCall?.inputAfter?.prompt?.includes(APPENDIX) === true
      && taskCall?.inputBefore?.prompt?.includes(APPENDIX) !== true;
    const authoritativeProvenance = taskCall?.authoritativeSuperpowersOriginObserved === true;

    summary = {
      expected: EXPECTED,
      versions: {
        omo: omoPackage.version,
        senpi: senpiPackage.version,
        superpowers: superpowersPackage.version,
        launcher,
      },
      contracts: {
        loads_omo_and_superpowers_pi_packages_together: true,
        superpowers_using_superpowers_bootstrap_is_present_in_native_context: bootstrap,
        native_task_tool_call_exposes_mutable_input_session_and_tool_call_id:
          Boolean(mutableInput && parentSessionId && taskCall?.toolCallId),
        native_background_task_returns_runtime_id_without_becoming_task_identity:
          typeof runtimeTaskId === "string" && runtimeTaskId.startsWith("st_"),
        superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch:
          Boolean(activation && taskCall && !parentRows.some((row) => row.event === "tool_call" && String(row.toolName).startsWith("justice"))),
        native_superpowers_task_provenance_is_authoritatively_bound_without_prompt_inference: authoritativeProvenance,
      },
      blockedAt: authoritativeProvenance ? null : "native_superpowers_task_provenance_is_authoritatively_bound_without_prompt_inference",
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
        authoritativeSuperpowersOriginObserved: authoritativeProvenance,
        authoritativeProvenanceGap: authoritativeProvenance ? null :
          "The model-issued native task tool_call exposed toolCallId, optional parentToolCallId, toolName and input, but no host-authenticated Superpowers origin. A successful Superpowers skill read was observed earlier in the same session; the approved design explicitly forbids treating activation alone as provenance.",
        processExitStatus: result.status,
        stderrTail: (result.stderr ?? "").slice(-2000),
      },
    };
  } catch (error) {
    summary = {
      expected: EXPECTED,
      setupError: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error),
      contracts: {},
      blockedAt: "runtime_setup",
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write(`JUSTICE_SPIKE_EVIDENCE_SUMMARY=${JSON.stringify(summary)}\n`);
}

main();
