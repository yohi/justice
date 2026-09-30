import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createConnection, type Socket } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const SUPERPOWERS_COMMIT = "8ca22dba9a94f28898bbce59f2537ff4d87c747d" as const;
export const OMO_COMMIT = "d1ee37cfbbfa29c37691f67a62592e42071b19e9" as const;
export const SENPI_VERSION = "2026.9.29-4" as const;
export const BUN_VERSION = "1.4.2" as const;
export const SPIKE_ENABLED = process.env.JUSTICE_NATIVE_UPSTREAM_SPIKE === "1";

type RecordValue = Record<string, unknown>;
type Proof = { readonly status: "proven" | "not_proven"; readonly detail: string };
export type NativeUpstreamSpikeResult = {
  readonly evidence: {
    readonly superpowersCommit: typeof SUPERPOWERS_COMMIT;
    readonly omoCommit: typeof OMO_COMMIT;
    readonly senpiVersion: typeof SENPI_VERSION;
    readonly bunVersion: typeof BUN_VERSION;
    readonly toolName: string;
    readonly genericTarget: unknown;
    readonly reviewTarget: unknown;
    readonly reviewPromptField: string;
    readonly activationChannels: readonly string[];
    readonly batchIndexStable: boolean;
    readonly modelEvidence: unknown;
    readonly translatedTargetValidation: "accepted" | "rejected" | "not_proven";
  };
  readonly proofs: Readonly<Record<string, Proof>>;
  readonly offeredToolNames: readonly string[];
  readonly receiptPath: string;
};

type Decision =
  | { readonly kind: "text"; readonly text: string; readonly reason: string }
  | { readonly kind: "tool"; readonly name: string; readonly args: RecordValue; readonly reason: string };

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function allText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(allText).join("\n");
  if (!isRecord(value)) return "";
  return Object.values(value).map(allText).join("\n");
}
async function command(bin: string, args: readonly string[], cwd?: string, timeout = 180_000): Promise<string> {
  const { stdout, stderr } = await exec(bin, [...args], { cwd, timeout, maxBuffer: 32 * 1024 * 1024 });
  return `${stdout}${stderr}`;
}
async function clonePinned(url: string, sha: string, dest: string): Promise<void> {
  await command("git", ["clone", "--filter=blob:none", "--no-checkout", url, dest], undefined, 180_000);
  await command("git", ["-C", dest, "fetch", "--depth=1", "origin", sha], undefined, 180_000);
  await command("git", ["-C", dest, "checkout", "--detach", sha], undefined, 180_000);
  if ((await command("git", ["-C", dest, "rev-parse", "HEAD"])).trim() !== sha) throw new Error(`SHA mismatch for ${url}`);
}
function toolSpecs(body: RecordValue): readonly RecordValue[] {
  return (Array.isArray(body.tools) ? body.tools : []).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const fn = isRecord(entry.function) ? entry.function : entry;
    return typeof fn.name === "string" ? [fn] : [];
  });
}
function toolName(tool: RecordValue): string { return typeof tool.name === "string" ? tool.name : ""; }
function toolParameters(tool: RecordValue): RecordValue { return isRecord(tool.parameters) ? tool.parameters : {}; }
function suggestedSubagent(body: RecordValue): string | undefined {
  const text = (Array.isArray(body.messages) ? body.messages : []).map(allText).join("\n");
  return text.match(/subagent tool such as\s+[`'\"]([^`'\"]+)[`'\"]/iu)?.[1];
}
function argsFor(tool: RecordValue): RecordValue | undefined {
  const params = toolParameters(tool);
  const props = isRecord(params.properties) ? params.properties : {};
  const required = Array.isArray(params.required) ? params.required.filter((x): x is string => typeof x === "string") : [];
  const args: RecordValue = {};
  for (const key of required) {
    if (["category", "subagent_type", "agent", "agent_type"].includes(key)) return undefined;
    if (key === "model") args[key] = "mock/mock-model";
    else if (["prompt", "instructions", "task", "description"].includes(key)) args[key] = "Report the evidence-only result without modifying files.";
    else if (key === "run_in_background") args[key] = false;
    else return undefined;
  }
  return args;
}
function decide(body: RecordValue): Decision {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages.at(-1);
  if (isRecord(last) && last.role === "tool") return { kind: "text", text: "Evidence tool returned.", reason: "tool continuation" };
  const suggested = suggestedSubagent(body);
  const tool = suggested === undefined ? undefined : toolSpecs(body).find((candidate) => toolName(candidate) === suggested);
  const args = tool === undefined ? undefined : argsFor(tool);
  if (tool !== undefined && args !== undefined) return { kind: "tool", name: toolName(tool), args, reason: "tool name derived from upstream Superpowers bootstrap" };
  return {
    kind: "text",
    text: "No upstream-identified subagent surface can be called without inventing a routing target.",
    reason: suggested === undefined ? "no upstream subagent surface name" : `upstream suggested ${suggested}, but no callable matching tool exists`,
  };
}
async function readRequest(req: IncomingMessage): Promise<RecordValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(parsed)) throw new Error("model request is not an object");
  return parsed;
}
function jsonCompletion(decision: Decision): RecordValue {
  return {
    id: "chatcmpl-justice-spike", object: "chat.completion", created: 0, model: "mock-model",
    choices: [{ index: 0, finish_reason: decision.kind === "tool" ? "tool_calls" : "stop", message: decision.kind === "tool"
      ? { role: "assistant", content: null, tool_calls: [{ id: "call_justice_spike", type: "function", function: { name: decision.name, arguments: JSON.stringify(decision.args) } }] }
      : { role: "assistant", content: decision.text } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}
function streamCompletion(res: ServerResponse, decision: Decision): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const delta = decision.kind === "tool"
    ? { role: "assistant", tool_calls: [{ index: 0, id: "call_justice_spike", type: "function", function: { name: decision.name, arguments: JSON.stringify(decision.args) } }] }
    : { role: "assistant", content: decision.text };
  res.write(`data: ${JSON.stringify({ id: "chatcmpl-justice-spike", object: "chat.completion.chunk", created: 0, model: "mock-model", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: "chatcmpl-justice-spike", object: "chat.completion.chunk", created: 0, model: "mock-model", choices: [{ index: 0, delta: {}, finish_reason: decision.kind === "tool" ? "tool_calls" : "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}
async function fakeModel(): Promise<{ readonly baseUrl: string; readonly requests: RecordValue[]; readonly decisions: Decision[]; readonly close: () => Promise<void> }> {
  const requests: RecordValue[] = [];
  const decisions: Decision[] = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST") { res.writeHead(404).end(); return; }
      const body = await readRequest(req); requests.push(body);
      const decision = decide(body); decisions.push(decision);
      if (body.stream === true) streamCompletion(res, decision);
      else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(jsonCompletion(decision))); }
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    }
  });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake model has no port");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, decisions, close: () => new Promise<void>((ok, fail) => server.close((error) => error === undefined ? ok() : fail(error))) };
}

class RpcClient {
  private readonly socket: Socket;
  private buffer = "";
  private sequence = 0;
  private readonly records: RecordValue[] = [];
  private constructor(socket: Socket) { this.socket = socket; socket.on("data", (chunk) => this.ingest(chunk.toString("utf8"))); }
  static async connect(path: string): Promise<RpcClient> {
    const socket = createConnection(path);
    await new Promise<void>((ok, fail) => { const timer = setTimeout(() => fail(new Error("RPC connect timeout")), 15_000); socket.once("connect", () => { clearTimeout(timer); ok(); }); socket.once("error", fail); });
    return new RpcClient(socket);
  }
  close(): void { this.socket.destroy(); }
  private ingest(text: string): void {
    this.buffer += text;
    while (this.buffer.includes("\n")) {
      const end = this.buffer.indexOf("\n"); const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      try { const value: unknown = JSON.parse(line); if (isRecord(value)) this.records.push(value); } catch { /* ignore non-JSON host output */ }
    }
  }
  private async wait(predicate: (value: RecordValue) => boolean, from: number, timeout: number): Promise<RecordValue> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const hit = this.records.slice(from).find(predicate); if (hit !== undefined) return hit;
      await new Promise((ok) => setTimeout(ok, 25));
    }
    throw new Error("RPC response timeout");
  }
  async request(command: RecordValue, timeout = 60_000): Promise<RecordValue> {
    const id = `justice-${++this.sequence}`; const from = this.records.length;
    this.socket.write(`${JSON.stringify({ id, ...command })}\n`);
    const response = await this.wait((value) => value.type === "response" && value.id === id, from, timeout);
    if (response.success !== true) throw new Error(`${String(command.type)} failed: ${JSON.stringify(response)}`);
    return response;
  }
  async promptAndSettle(sessionId: string, message: string): Promise<void> {
    const from = this.records.length;
    await this.request({ type: "prompt", sessionId, message });
    await this.wait((value) => value.type === "agent_settled" && value.sessionId === sessionId, from, 120_000);
  }
}

async function waitReady(child: ChildProcessWithoutNullStreams, socket: string): Promise<void> {
  const wanted = `rpc listening on unix://${socket}`;
  await new Promise<void>((ok, fail) => {
    let output = ""; const timer = setTimeout(() => fail(new Error(`host readiness timeout: ${output.slice(-2000)}`)), 60_000);
    const onData = (chunk: Buffer): void => { output += chunk.toString("utf8"); if (output.includes(wanted)) { clearTimeout(timer); ok(); } };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.once("exit", (code) => { clearTimeout(timer); fail(new Error(`host exited ${String(code)}: ${output.slice(-2000)}`)); });
  });
}
async function stop(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try { if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch { child.kill("SIGTERM"); }
  await new Promise((ok) => setTimeout(ok, 500));
  if (child.exitCode === null && child.signalCode === null) { try { if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); } }
}
function proof(status: "proven" | "not_proven", detail: string): Proof { return { status, detail }; }
function target(args: RecordValue): unknown {
  if (typeof args.category === "string") return { kind: "category", value: args.category };
  if (typeof args.subagent_type === "string") return { kind: "subagent_type", value: args.subagent_type };
  if (typeof args.agent === "string") return { kind: "agent", value: args.agent };
  return { kind: "unrouted" };
}

export async function runNativeUpstreamEvidenceSpike(): Promise<NativeUpstreamSpikeResult> {
  if (!SPIKE_ENABLED) throw new Error("set JUSTICE_NATIVE_UPSTREAM_SPIKE=1");
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error(`requires linux/x64, found ${process.platform}/${process.arch}`);
  if ((await command("bun", ["--version"])).trim() !== BUN_VERSION) throw new Error(`requires Bun ${BUN_VERSION}`);
  const evidenceOut = process.env.JUSTICE_NATIVE_UPSTREAM_EVIDENCE_OUT;
  if (!evidenceOut) throw new Error("JUSTICE_NATIVE_UPSTREAM_EVIDENCE_OUT is required");

  const root = await mkdtemp(join(tmpdir(), "justice-native-spike-"));
  const superpowers = join(root, "superpowers"); const omo = join(root, "omo"); const work = join(root, "work"); const agent = join(root, "agent"); const socket = join(root, "rpc.sock");
  let host: ChildProcessWithoutNullStreams | undefined; let model: Awaited<ReturnType<typeof fakeModel>> | undefined; let rpc: RpcClient | undefined;
  const proofs: Record<string, Proof> = {};
  try {
    await clonePinned("https://github.com/obra/superpowers.git", SUPERPOWERS_COMMIT, superpowers);
    await clonePinned("https://github.com/code-yeongyu/oh-my-openagent.git", OMO_COMMIT, omo);
    await command("bun", ["install", "--frozen-lockfile"], omo, 600_000);
    await command("bun", ["run", "build:senpi-plugin"], omo, 600_000);
    const senpi = JSON.parse(await readFile(join(omo, "node_modules/@code-yeongyu/senpi/package.json"), "utf8")) as RecordValue;
    if (senpi.version !== SENPI_VERSION) throw new Error(`Senpi mismatch ${String(senpi.version)}`);
    const extension = await readFile(join(superpowers, ".pi/extensions/superpowers.ts"), "utf8");
    proofs.native_contract_does_not_require_skill_tool = proof(extension.includes("does not expose Claude Code's `Skill` tool") ? "proven" : "not_proven", "Pinned Pi extension explicitly documents native-skill loading instead of a Skill tool.");
    if (!(await readFile(join(omo, "packages/senpi-task/src/tools/task/validation.ts"), "utf8")).includes("category_with_model")) throw new Error("category_with_model validator missing");

    await mkdir(work, { recursive: true }); await mkdir(agent, { recursive: true }); model = await fakeModel();
    await writeFile(join(agent, "settings.json"), "{}\n");
    await writeFile(join(agent, "models.json"), `${JSON.stringify({ providers: { mock: { baseUrl: model.baseUrl, apiKey: "sk-evidence-only", api: "openai-completions", models: [{ id: "mock-model", baseUrl: model.baseUrl, api: "openai-completions", contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }, null, 2)}\n`);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: process.env.LANG ?? "C.UTF-8", TERM: "xterm-256color", HOME: root, XDG_CONFIG_HOME: join(root, "xdg-config"), XDG_DATA_HOME: join(root, "xdg-data"), XDG_CACHE_HOME: join(root, "xdg-cache"), XDG_STATE_HOME: join(root, "xdg-state"), SENPI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent, OMO_AGENT_DIR: agent, OMO_DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" };
    const cli = join(omo, "node_modules/@code-yeongyu/senpi/dist/cli.js"); const omoExtension = join(omo, "packages/omo-senpi/plugin/extensions/omo.js");
    host = spawn("bun", [cli, "--mode", "rpc", "--multi-session", "--listen", `unix://${socket}`, "--provider", "mock", "--model", "mock-model", "--extension", omoExtension, "-e", superpowers], { cwd: work, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    await waitReady(host, socket); rpc = await RpcClient.connect(socket);
    const opened = await rpc.request({ type: "open_session", cwd: work }); const data = isRecord(opened.data) ? opened.data : {}; if (typeof data.sessionId !== "string") throw new Error("open_session lacked sessionId");
    await rpc.promptAndSettle(data.sessionId, "/skill:subagent-driven-development\nExecute one evidence-only task using the loaded Superpowers workflow. Do not modify files. If the required subagent capability is unavailable, report it rather than inventing a tool call.");
    const messagesResponse = await rpc.request({ type: "get_messages", sessionId: data.sessionId }); const messageData = isRecord(messagesResponse.data) ? messagesResponse.data : {}; const transcript = allText(messageData.messages);
    const expanded = transcript.includes("Always specify the model explicitly") && transcript.includes("subagent-driven-development");
    proofs.trusted_native_skill_expansion_is_observable_when_supported = proof(expanded ? "proven" : "not_proven", expanded ? "Live transcript contains host-expanded selected skill content." : "No trusted selected-skill expansion observed.");
    proofs.selected_skill_read_success_is_observable_activation = proof("not_proven", "No selected SKILL.md read result was observed; native expansion is the alternative accepted activation channel.");
    proofs.extension_injected_skill_text_is_not_activation = proof("proven", "Bootstrap text alone is not counted as selected-method activation.");

    const offered = [...new Set(model.requests.flatMap((request) => toolSpecs(request).map(toolName)))].sort();
    const calls = model.decisions.filter((decision): decision is Extract<Decision, { kind: "tool" }> => decision.kind === "tool");
    const generic = calls[0];
    proofs.captures_actual_superpowers_generic_worker_dispatch_shape = proof(generic === undefined ? "not_proven" : "proven", generic === undefined ? `No upstream-instruction-derived subagent dispatch occurred. Offered tools: ${offered.join(", ") || "<none>"}.` : `Observed tool=${generic.name} target=${JSON.stringify(target(generic.args))}.`);
    proofs.opencode_general_encoding_is_not_assumed_as_native_evidence = proof(calls.some((call) => call.args.subagent_type === "general") ? "not_proven" : "proven", "No hand-authored OpenCode-V1 general marker was accepted as Native evidence.");
    proofs.captures_superpowers_model_field_behavior = proof(generic === undefined ? "not_proven" : "proven", generic === undefined ? "Model-field semantics cannot be classified without a proven profile-generic dispatch." : `Observed model=${String(generic.args.model ?? "<absent>")}.`);

    for (const name of ["captures_actual_task_review_dispatch_shape", "captures_actual_scoped_re_review_dispatch_shape", "captures_actual_final_review_dispatch_shape", "proposed_profile_translation_passes_omo_target_validation", "category_translation_never_retains_conflicting_model", "profile_proven_review_prompt_can_be_enriched_in_place", "profile_proven_review_translation_preserves_category_subagent_xor", "matching_tool_result_is_attributed_by_session_and_tool_call_id", "out_of_order_parallel_tool_results_do_not_cross_correlate_reviews", "batch_input_index_matches_result_items_index", "batch_items_expose_independent_task_ids", "mass_ulw_metadata_never_replaces_call_or_item_identity", "review_interop_uses_exactly_one_existing_superpowers_dispatch"]) {
      proofs[name] = proof("not_proven", generic === undefined ? "Blocked by unproven Superpowers→Native generic-dispatch prerequisite; downstream evidence was not manufactured." : "This deterministic probe did not establish the seam without manufacturing an upstream routing decision.");
    }
    proofs.pinned_upstream_shas_and_senpi_version_are_exact = proof("proven", `Superpowers=${SUPERPOWERS_COMMIT} OmO=${OMO_COMMIT} Senpi=${SENPI_VERSION} Bun=${BUN_VERSION}`);

    const taskTool = model.requests.flatMap(toolSpecs).find((tool) => toolName(tool) === "task"); const taskProps = taskTool === undefined ? {} : (isRecord(toolParameters(taskTool).properties) ? toolParameters(taskTool).properties as RecordValue : {});
    const observedModels = calls.flatMap((call) => typeof call.args.model === "string" ? [call.args.model] : []);
    const evidence = { superpowersCommit: SUPERPOWERS_COMMIT, omoCommit: OMO_COMMIT, senpiVersion: SENPI_VERSION, bunVersion: BUN_VERSION, toolName: generic?.name ?? "", genericTarget: generic === undefined ? { kind: "not_proven" } : target(generic.args), reviewTarget: { kind: "not_proven" }, reviewPromptField: "prompt" in taskProps ? "prompt" : "", activationChannels: expanded ? ["native_skill_input"] : [], batchIndexStable: false, modelEvidence: observedModels.length === 0 ? { kind: "absent" } : { kind: "observed_model", field: "model", observedValues: observedModels, semanticHintSafe: false, omoCategoryTranslationAccepted: false }, translatedTargetValidation: "not_proven" as const };
    const receipt = { schemaVersion: "justice-native-upstream-evidence-v1", status: Object.values(proofs).every((item) => item.status === "proven") ? "PASS" : "NOT_PROVEN", evidence, proofs, offeredToolNames: offered, modelDecisions: model.decisions, environment: { platform: process.platform, arch: process.arch, node: process.version, bun: BUN_VERSION } };
    await mkdir(dirname(resolve(evidenceOut)), { recursive: true }); await writeFile(resolve(evidenceOut), `${JSON.stringify(receipt, null, 2)}\n`);
    return { evidence, proofs, offeredToolNames: offered, receiptPath: resolve(evidenceOut) };
  } finally {
    rpc?.close(); await stop(host); if (model !== undefined) await model.close(); await rm(root, { recursive: true, force: true });
  }
}
