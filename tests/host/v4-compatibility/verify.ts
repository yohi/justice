import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT = 64 * 1024;
const TIMEOUT_MS = 120_000;
const PLAN_PATH = "docs/justice-v4-compat-smoke-plan.md";
const RAW = "J4C_RAW_BODY_SENTINEL_642_4194";
const LATER = "J4C_LATER_TASK_SENTINEL_642_4194";
const ACCEPTED = "J4C_SUBAGENT_ACCEPTED_642_4194";
const OMO = "oh-my-openagent@4.19.4";
const SUPERPOWERS = "superpowers@git+https://github.com/obra/superpowers.git#v6.4.2";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Opt-in provider names only: never inherit the runner's general environment.
function childEnv(root: string, model: string): NodeJS.ProcessEnv {
  const allowed = (process.env.JUSTICE_HOST_CREDENTIAL_NAMES ?? "").split(",").filter(Boolean);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    XDG_DATA_HOME: join(root, "xdg-data"),
    JUSTICE_HOST_TEST_MODEL: model,
  };
  for (const name of allowed) {
    if (!/^[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|CREDENTIALS)$/u.test(name)) {
      throw new Error("SETUP / UPSTREAM BLOCKED — invalid credential allowlist name");
    }
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

type SpawnFailure = "none" | "not_found" | "other";
type Result = { readonly exit: number | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean; readonly overflow: boolean; readonly spawnFailure: SpawnFailure };

function execute(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, timeout = TIMEOUT_MS): Promise<Result> {
  return new Promise((done) => {
    const child = spawn("opencode", [...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    let spawnFailure: SpawnFailure = "none";
    let finished = false;
    const finish = (exit: number | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done({ exit, stdout, stderr, timedOut, overflow, spawnFailure });
    };
    const stop = (): void => {
      if (child.pid === undefined || child.exitCode !== null) return;
      if (process.platform === "win32") child.kill("SIGKILL");
      else {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return; throw error; }
      }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    const collect = (stream: NodeJS.ReadableStream, which: "stdout" | "stderr"): void => {
      stream.on("data", (chunk: Buffer) => {
        const previous = which === "stdout" ? stdout : stderr;
        const remaining = MAX_OUTPUT - Buffer.byteLength(previous);
        if (chunk.length > remaining) { overflow = true; stop(); }
        const next = previous + chunk.subarray(0, Math.max(0, remaining)).toString("utf8");
        if (which === "stdout") stdout = next;
        else stderr = next;
      });
    };
    if (child.stdout) collect(child.stdout, "stdout");
    if (child.stderr) collect(child.stderr, "stderr");
    child.once("error", (error: Error & { readonly code?: unknown }) => {
      spawnFailure = error.code === "ENOENT" ? "not_found" : "other";
      finish(null);
    });
    child.once("close", (exit) => finish(exit));
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function upstreamFailure(...results: readonly (Result | null)[]): boolean {
  const signal = /failed to load plugin|plugin.{0,30}(?:load|runtime) error|provider|credential|authentication|model.{0,40}(?:unavailable|not found|not configured)|\b401\b|\b403\b|econnrefused|econnreset|getaddrinfo|network|resolution|\bnpm\b|package/iu;
  return results.some((result) => result !== null && (
    result.spawnFailure !== "none" || signal.test(result.stdout) || signal.test(result.stderr)
  ));
}

function toolSucceeded(output: string): { readonly success: boolean; readonly accepted: boolean } {
  let success = false;
  let accepted = false;
  for (const line of output.split("\n")) {
    let event: unknown;
    try { event = JSON.parse(line); }
    catch { continue; }
    if (!record(event) || !record(event.part) || event.part.type !== "tool" || event.part.tool !== "task") continue;
    const state = event.part.state;
    if (!record(state) || state.status !== "completed") continue;
    success = true;
    if (typeof state.output === "string" && state.output.includes(ACCEPTED)) accepted = true;
  }
  return { success, accepted };
}

function freshPlan(): string {
  return [
    "# Approved fresh compatibility smoke",
    "", "## Task 1: Write the raw plan-body proof", "", "- [ ] Delegate the first approved task to a worker.", "",
    "**Interfaces:** create the local smoke artifact via a delegated implementation task.",
    "Exact function signature: `function writeSmokeEvidence(content: string): Promise<void>`.",
    "Test/assertion example: `assert.equal(await readFile('.justice-host-smoke/raw-body.txt', 'utf8'), expected)`.",
    "Run: execute the first approved task exactly once.",
    "Expected: the artifact content matches the exact value on the next line.",
    RAW,
    "The delegated implementation worker must create `.justice-host-smoke/raw-body.txt` with its entire content exactly equal to the preceding sentinel line (no newline).",
    "", "## Task 2: Pending unrelated work", "", "- [ ] Leave the second task unexecuted.", "",
    `Do not create .justice-host-smoke/later-task.txt or write ${LATER}.`, "",
  ].join("\n");
}

function callerPlan(): string {
  return [
    "# Approved caller-owned compatibility smoke", "", "## Task 1: Delegate without mutations", "",
    "- [ ] Delegate the first approved task to a caller-selected child.", "",
    "**Interfaces:** caller-owned `subagent_type=explore` is preserved.",
    `The delegated child must return exactly ${ACCEPTED} and perform no file changes.`,
    "Run: call the task tool once with subagent_type=explore.",
    "Expected: the delegated child returns the exact acceptance sentinel above.",
    "", "## Task 2: Pending unrelated work", "", "- [ ] Leave the second task unexecuted.", "",
    `Do not create .justice-host-smoke/later-task.txt or write ${LATER}.`, "",
  ].join("\n");
}

async function prepare(workspace: string, model: string, plan: string): Promise<void> {
  const dist = join(repo, "dist");
  const config = {
    $schema: "https://opencode.ai/config.json",
    plugin: [join(dist, "opencode-plugin.js"), OMO, SUPERPOWERS], model,
    permission: { external_directory: { "*": "deny", [`${dist}/**`]: "allow" } },
  };
  const omo = { categories: { "sp-implementation": { model } }, agents: { explore: { model } } };
  await mkdir(join(workspace, "docs"), { recursive: true });
  await mkdir(join(workspace, ".omo"), { recursive: true });
  await writeFile(join(workspace, "opencode.json"), JSON.stringify(config, null, 2));
  await writeFile(join(workspace, ".omo/omo.jsonc"), JSON.stringify(omo, null, 2));
  await writeFile(join(workspace, PLAN_PATH), plan);
  const actualConfig: unknown = JSON.parse(await readFile(join(workspace, "opencode.json"), "utf8"));
  const actualOmo: unknown = JSON.parse(await readFile(join(workspace, ".omo/omo.jsonc"), "utf8"));
  if (JSON.stringify(actualConfig) !== JSON.stringify(config) || JSON.stringify(actualOmo) !== JSON.stringify(omo)) {
    throw new Error("SETUP / UPSTREAM BLOCKED — generated host config verification failed");
  }
  if (!record(actualConfig) || !Array.isArray(actualConfig.plugin) ||
      JSON.stringify(actualConfig.plugin) !== JSON.stringify([join(dist, "opencode-plugin.js"), OMO, SUPERPOWERS]) ||
      actualConfig.model !== model || !record(actualConfig.permission) ||
      !record(actualConfig.permission.external_directory) ||
      JSON.stringify(actualConfig.permission.external_directory) !== JSON.stringify({ "*": "deny", [`${dist}/**`]: "allow" })) {
    throw new Error("SETUP / UPSTREAM BLOCKED — plugin/model/permission contract differs");
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "justice-v4-compat-"));
  try {
    const model = process.env.JUSTICE_HOST_TEST_MODEL;
    if (!model || !/^[^/\s]+\/[^/\s]+$/u.test(model)) {
      throw new Error("SETUP / UPSTREAM BLOCKED — JUSTICE_HOST_TEST_MODEL is unavailable or invalid; real-host capability not evaluated");
    }
    const env = childEnv(root, model);
    await Promise.all(["home", "xdg-config", "xdg-cache", "xdg-data"].map((name) => mkdir(join(root, name))));
    const version = await execute(["--version"], root, env, 10_000);
    if (version.spawnFailure !== "none" || version.exit !== 0 || version.stdout.trim() !== "1.18.29") {
      throw new Error("SETUP / UPSTREAM BLOCKED — exact OpenCode 1.18.29 unavailable; real-host capability not evaluated");
    }
    const fresh = join(root, "fresh");
    const caller = join(root, "caller-owned");
    await prepare(fresh, model, freshPlan());
    await prepare(caller, model, callerPlan());
    // Preflight host-resolved policy. Without confirmation, no --auto run is safe.
    for (const workspace of [fresh, caller]) {
      const preflight = await execute(["debug", "config"], workspace, env);
      let resolved: unknown;
      try { resolved = JSON.parse(preflight.stdout); }
      catch { resolved = null; }
      const policy = record(resolved) && record(resolved.permission) ? resolved.permission.external_directory : null;
      const expected = { "*": "deny", [`${join(repo, "dist")}/**`]: "allow" };
      if (preflight.exit !== 0 || JSON.stringify(policy) !== JSON.stringify(expected)) {
        throw new Error("SETUP / UPSTREAM BLOCKED — host policy not enforceable; no bounded OS sandbox available; real-host capability not evaluated");
      }
    }
    for (const [label, workspace, prompt] of [
      ["Fresh delegation", fresh, "Use the task tool exactly once to execute the currently approved Justice plan task. Do not implement the task yourself. Do not provide task_id, category, or subagent_type. Follow the injected approved task contract."],
      ["Caller-owned routing", caller, `Call the task tool exactly once with subagent_type=explore, no category, and no task_id. The delegated child must return exactly ${ACCEPTED} and perform no file changes.`],
    ]) {
      const activation = await execute(["run", "--auto", "--format", "json", "--model", model, "--command", "justice-implement", "--", "--approved", "--plan", PLAN_PATH], workspace, env);
      const execution = activation.exit === 0 && !activation.timedOut && !activation.overflow
        ? await execute(["run", "--auto", "--continue", "--format", "json", "--model", model, prompt], workspace, env)
        : null;
      if (upstreamFailure(activation, execution)) {
        throw new Error("SETUP / UPSTREAM BLOCKED — real-host capability not evaluated");
      }
      const tools = toolSucceeded(execution?.stdout ?? "");
      const raw = label === "Fresh delegation" ? await readFile(join(workspace, ".justice-host-smoke/raw-body.txt"), "utf8").catch(() => "") : "";
      const later = await readFile(join(workspace, ".justice-host-smoke/later-task.txt"), "utf8").then(() => true, () => false);
      const pluginError = /failed to load plugin|plugin.{0,30}(?:load|runtime) error/iu.test(
        activation.stdout + activation.stderr + (execution?.stdout ?? "") + (execution?.stderr ?? ""),
      );
      const good = activation.exit === 0 && execution?.exit === 0 && !activation.overflow && !execution.overflow &&
        !activation.timedOut && !execution.timedOut && !pluginError && tools.success && !later &&
        (label === "Fresh delegation" ? raw === RAW : tools.accepted);
      console.log(`${label}: activation=${activation.exit ?? "not-run"} execution=${execution?.exit ?? "not-run"} task=${tools.success} rawBody=${raw === RAW} laterNotRun=${!later} accepted=${tools.accepted} result=${good ? "PASS" : "FAIL"}`);
      if (!good) process.exitCode = 1;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  // Never print untrusted host output or an error cause (may contain credentials).
  console.error(error instanceof Error && error.message.startsWith("SETUP / UPSTREAM BLOCKED")
    ? error.message : "FAIL — verifier failed; inspect sanitized evidence only");
  process.exitCode = 2;
});
