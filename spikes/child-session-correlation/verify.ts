#!/usr/bin/env bun
/**
 * Runtime spike: prove the OpenCode child-session correlation boundary
 * (parent `task()` call ID -> child session ID) for `sp-review` and
 * `sp-final-review` worker dispatches against the installed OpenCode runtime.
 *
 * The probe:
 *   1. asserts the pinned runtime (opencode-ai@1.18.29) is reachable,
 *   2. boots an isolated headless runtime (`opencode serve`) in a throwaway
 *      workspace together with a spike-local observation plugin and a
 *      deterministic scripted OpenAI-compatible model endpoint,
 *   3. drives ONE `sp-review` and ONE `sp-final-review` dispatch,
 *   4. correlates identities strictly from runtime-provided payloads:
 *        - parent call ID  <- `tool.execute.before` hook input `callID`
 *          (same value echoed in `tool.execute.after` input `callID`),
 *        - child session ID <- `tool.execute.after` hook output `metadata.sessionId`
 *          (same payload carries `metadata.parentSessionId` = parent session),
 *      and corroborates via runtime event/API surfaces only:
 *        - `session.created` / `session.updated` events with
 *          `properties.info.parentID` equal to the parent session,
 *        - child `message.updated` / `message.part.updated` events and
 *          `GET /session/{childId}/message` for child message/tool observation.
 *
 * The probe NEVER derives an identity from prompt text, category, artifact
 * path, or worker self-report. It fails non-zero when either trace lacks a
 * non-empty runtime-provided parent call ID or child session ID.
 *
 * Usage: bun spikes/child-session-correlation/verify.ts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PINNED_OPENCODE_VERSION = "1.18.29";
const REVIEW_AGENT = "sp-review";
const FINAL_REVIEW_AGENT = "sp-final-review";
const REQUIRED_WORKERS = [REVIEW_AGENT, FINAL_REVIEW_AGENT] as const;

// Script-driver markers. These exist only so the scripted model endpoint can
// tell conversations apart; the probe never reads prompt text for identity.
const PARENT_MARKER = "SPIKE-PARENT";
const CHILD_A_MARKER = "SPIKE-CHILD-A";
const PARENT_PROMPT = `${PARENT_MARKER}: dispatch the two spike review workers in order.`;
const CHILD_PROMPT_A = `${CHILD_A_MARKER}: inspect the fixture, then reply with DONE only.`;
const CHILD_PROMPT_B = "SPIKE-CHILD-B: reply with DONE only.";

// The server binds its port early (before init finishes), so a readiness fetch
 // can connect but never answer; each attempt is individually timed out.
const READY_TIMEOUT_MS = 60_000;
const READY_FETCH_TIMEOUT_MS = 2_000;
const TURN_TIMEOUT_MS = 240_000;

type Verdict = "OK" | "BLOCKED";

/**
 * Correlation-only observation records. The spike persists just the
 * runtime-provided fields needed to prove the parent-call -> child-session
 * relationship; full tool args, tool output, model requests, and raw event
 * payloads are never written to disk.
 */
interface ToolExecuteBeforeRecord {
  kind: "tool.execute.before";
  tool: string;
  sessionID: string;
  callID: string;
  // The runtime passes tool args via the hook's output parameter (output.args);
  // only the worker routing field is retained for the trace label.
  subagent_type?: unknown;
}

interface ToolExecuteAfterRecord {
  kind: "tool.execute.after";
  tool: string;
  sessionID: string;
  callID: string;
  metadata?: { parentSessionId?: unknown; sessionId?: unknown };
}

interface EventRecord {
  kind: "event";
  id?: unknown;
  type?: unknown;
  session?: { id?: unknown; parentID?: unknown };
  sessionID?: unknown;
  part?: { sessionID?: unknown; type?: unknown; callID?: unknown; tool?: unknown; status?: unknown };
}

type HookRecord = ToolExecuteBeforeRecord | ToolExecuteAfterRecord | EventRecord;

interface BusEvent {
  id?: string;
  type?: string;
  properties?: Record<string, unknown>;
}

interface Trace {
  worker: string;
  parentCallId: string;
  parentSessionId: string;
  childSessionId: string;
  hookEvent: string;
  hookInput: { tool: string; sessionID: string; callID: string };
  hookArgsEchoed: Record<string, unknown>;
  hookAfterMetadata: Record<string, unknown>;
  childSessionEvent: { type: string; field: string; parentID: string; matches: boolean };
  childObservation: {
    messageEvents: number;
    partEvents: number;
    partTypes: string[];
    toolParts: Array<{ tool: string; callID: string; state: string }>;
    restMessages: number;
  };
}

const blockers: string[] = [];
const fail = (message: string): void => {
  blockers.push(message);
};
// Timestamped stderr progress trace (diagnostics only; never parsed).
const progress = (message: string): void => {
  console.error(`[spike ${new Date().toISOString()}] ${message}`);
};

function scrub(value: string, tmpRoot: string, maxLen = 120): string {
  const replaced = value.split(tmpRoot).join("<tmp>");
  if (replaced.length <= maxLen) return replaced;
  return `${replaced.slice(0, maxLen)}…[+${replaced.length - maxLen} chars]`;
}

function scrubDeep<T>(value: T, tmpRoot: string): T {
  if (typeof value === "string") return scrub(value, tmpRoot) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => scrubDeep(entry, tmpRoot)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubDeep(entry, tmpRoot);
    }
    return out as unknown as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Scripted model endpoint (deterministic, no external providers or keys)
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ id: string; type?: string; function?: { name?: string; arguments?: string } }>;
}

interface ChatRequest {
  stream?: boolean;
  tools?: Array<{ type?: string; function?: { name?: string; parameters?: Record<string, unknown> } }>;
  messages?: ChatMessage[];
}

function firstUserText(messages: ChatMessage[] | undefined): string {
  const first = (messages ?? []).find((m) => m.role === "user");
  if (!first) return "";
  return typeof first.content === "string" ? first.content : JSON.stringify(first.content);
}

function countTaskToolCalls(messages: ChatMessage[] | undefined): number {
  const ids = new Set<string>();
  for (const message of messages ?? []) {
    for (const call of message.tool_calls ?? []) {
      if (call.function?.name === "task" && call.id) ids.add(call.id);
    }
  }
  return ids.size;
}

function buildArgsFromSchema(
  schema: Record<string, unknown> | undefined,
  overrides: Record<string, string>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const prop of (schema?.required as string[] | undefined) ?? []) {
    args[prop] = overrides[prop] ?? "spike";
  }
  return args;
}

function taskToolSchema(tools: ChatRequest["tools"]): Record<string, unknown> | undefined {
  return tools?.find((t) => t.function?.name === "task")?.function?.parameters;
}

type Decision =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; args: Record<string, unknown> };

function createMockModelServer(fixturePath: string) {

  const decide = (body: ChatRequest): Decision => {
    const text = firstUserText(body.messages);
    if (text.includes(PARENT_MARKER)) {
      const hasTaskTool = (body.tools ?? []).some((t) => t.function?.name === "task");
      if (!hasTaskTool) return { kind: "text", text: "PARENT DONE" };
      const done = Math.min(countTaskToolCalls(body.messages), 2);
      if (done === 0) {
        return {
          kind: "tool_call",
          id: "call-1-sp-review",
          name: "task",
          args: buildArgsFromSchema(taskToolSchema(body.tools), {
            description: "spike sp-review dispatch",
            prompt: CHILD_PROMPT_A,
            subagent_type: REVIEW_AGENT,
          }),
        };
      }
      if (done === 1) {
        return {
          kind: "tool_call",
          id: "call-2-sp-final-review",
          name: "task",
          args: buildArgsFromSchema(taskToolSchema(body.tools), {
            description: "spike sp-final-review dispatch",
            prompt: CHILD_PROMPT_B,
            subagent_type: FINAL_REVIEW_AGENT,
          }),
        };
      }
      return { kind: "text", text: "PARENT DONE" };
    }
    if (text.includes(CHILD_A_MARKER)) {
      const last = (body.messages ?? []).at(-1);
      if (last?.role === "user") {
        return {
          kind: "tool_call",
          id: "call-child-read",
          name: "read",
          args: buildArgsFromSchema({ required: ["filePath"] }, { filePath: fixturePath }),
        };
      }
    }
    return { kind: "text", text: "CHILD DONE" };
  };

  const sseResponse = (decision: Decision): Response => {
    const encoder = new TextEncoder();
    const base = {
      id: `chatcmpl-${Math.random().toString(36).slice(2)}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "spike-model",
    };
    const stream = new ReadableStream({
      start(controller) {
        const push = (delta: Record<string, unknown>, finish?: string): void => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`),
          );
        };
        if (decision.kind === "text") {
          push({ role: "assistant", content: decision.text });
          push({}, "stop");
        } else {
          push({ role: "assistant", tool_calls: [{ index: 0, id: decision.id, type: "function", function: { name: decision.name, arguments: "" } }] });
          push({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(decision.args) } }] });
          push({}, "tool_calls");
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  };

  const jsonCompletion = (choices: Record<string, unknown>): Response =>
    new Response(
      JSON.stringify({
        id: `chatcmpl-${Math.random().toString(36).slice(2)}`,
        object: "chat.completion",
        model: "spike-model",
        choices,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { headers: { "content-type": "application/json" } },
    );

  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/v1/chat/completions") {
        return new Response(JSON.stringify({ path: url.pathname, note: "spike-mock-404" }), { status: 404 });
      }
      const body = (await req.json()) as ChatRequest;
      const decision = decide(body);
      if (!body.stream) {
        if (decision.kind === "text") {
          return jsonCompletion({ index: 0, message: { role: "assistant", content: decision.text }, finish_reason: "stop" });
        }
        return jsonCompletion({
          index: 0,
          message: { role: "assistant", content: null, tool_calls: [{ id: decision.id, type: "function", function: { name: decision.name, arguments: JSON.stringify(decision.args) } }] },
          finish_reason: "tool_calls",
        });
      }
      return sseResponse(decision);
    },
  });
}

// ---------------------------------------------------------------------------
// Spike observation plugin (registered with the runtime; records hook payloads)
// ---------------------------------------------------------------------------

const PLUGIN_SOURCE = `
import { appendFileSync } from "node:fs";
const logPath = process.env.JUSTICE_SPIKE_HOOK_LOG;
const append = (record) => {
  if (!logPath) return;
  try {
    appendFileSync(logPath, JSON.stringify(record) + "\\n");
  } catch {
    // fail-open: a spike observation failure must never break the runtime
  }
};
export const JusticeChildSessionCorrelationSpikePlugin = async () => ({
  // Correlation-only persistence: record just the runtime-provided fields
  // needed to prove the parent-call -> child-session relationship. Full tool
  // args, tool output, model requests, and raw event payloads are never
  // written to disk.
  event: async ({ event }) => {
    const type = event?.type;
    if (type === "session.created" || type === "session.updated" || type === "session.deleted") {
      const info = event?.properties?.info ?? {};
      append({ kind: "event", id: event?.id, type, session: { id: info.id, parentID: info.parentID } });
      return;
    }
    if (type === "message.updated") {
      append({ kind: "event", id: event?.id, type, sessionID: event?.properties?.sessionID });
      return;
    }
    if (type === "message.part.updated") {
      const part = event?.properties?.part ?? {};
      append({
        kind: "event",
        id: event?.id,
        type,
        part: { sessionID: part.sessionID, type: part.type, callID: part.callID, tool: part.tool, status: part.state?.status },
      });
    }
  },
  "tool.execute.before": async (input, output) => {
    // The runtime passes tool args via the hook's output parameter (output.args);
    // only the worker routing field is retained for the trace label.
    append({
      kind: "tool.execute.before",
      tool: input.tool,
      sessionID: input.sessionID,
      callID: input.callID,
      subagent_type: output?.args?.subagent_type,
    });
  },
  "tool.execute.after": async (input, output) => {
    append({
      kind: "tool.execute.after",
      tool: input.tool,
      sessionID: input.sessionID,
      callID: input.callID,
      metadata: { parentSessionId: output?.metadata?.parentSessionId, sessionId: output?.metadata?.sessionId },
    });
  },
});
`;

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readPinnedRuntimeVersion(): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(["opencode", "--version"], { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text.trim();
  } catch {
    return undefined;
  }
}

async function waitForServer(baseUrl: string): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/config`, { signal: AbortSignal.timeout(READY_FETCH_TIMEOUT_MS) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await Bun.sleep(250);
  }
  return false;
}

async function collectSseEvents(
  baseUrl: string,
  sink: BusEvent[],
  controller: AbortController,
): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/event`, { signal: controller.signal });
    if (!res.body) return;
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            const raw = line.slice("data: ".length);
            try {
              // Parsed into memory for corroboration; raw frames are never persisted.
              sink.push(JSON.parse(raw) as BusEvent);
            } catch {
              // ignore malformed frames
            }
          }
        }
        index = buffer.indexOf("\n\n");
      }
    }
  } catch {
    // aborted or stream ended — the probe reads whatever was collected
  }
}

function sessionEventsFor(sessions: BusEvent[], sessionId: string): Array<{ type: string; info: Record<string, unknown> }> {
  const out: Array<{ type: string; info: Record<string, unknown> }> = [];
  for (const event of sessions) {
    if (event.type !== "session.created" && event.type !== "session.updated") continue;
    const info = event.properties?.info as Record<string, unknown> | undefined;
    if (info && info.id === sessionId) out.push({ type: event.type as string, info });
  }
  return out;
}

function childObservationFromEvents(events: BusEvent[], childId: string): Trace["childObservation"] {
  let messageEvents = 0;
  let partEvents = 0;
  const partTypes = new Set<string>();
  const toolParts = new Map<string, { tool: string; callID: string; state: string }>();
  for (const event of events) {
    const properties = event.properties ?? {};
    if (event.type === "message.updated" && properties.sessionID === childId) {
      messageEvents += 1;
      continue;
    }
    if (event.type === "message.part.updated") {
      const part = properties.part as Record<string, unknown> | undefined;
      if (!part || part.sessionID !== childId) continue;
      partEvents += 1;
      const type = String(part.type);
      partTypes.add(type);
      if (type === "tool") {
        const state = part.state as Record<string, unknown> | undefined;
        const key = `${String(part.tool)}:${String(part.callID)}`;
        toolParts.set(key, {
          tool: String(part.tool),
          callID: String(part.callID),
          state: String(state?.status ?? "unknown"),
        });
      }
    }
  }
  return {
    messageEvents,
    partEvents,
    partTypes: [...partTypes].sort(),
    toolParts: [...toolParts.values()],
    restMessages: 0,
  };
}

// ---------------------------------------------------------------------------
// Main probe
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("== Justice spike: child-session correlation boundary ==");

  const version = await readPinnedRuntimeVersion();
  if (version === undefined) {
    fail("installed OpenCode runtime is unreachable from this environment (opencode --version failed)");
  } else if (version !== PINNED_OPENCODE_VERSION) {
    fail(`pinned runtime drift: expected opencode ${PINNED_OPENCODE_VERSION}, observed ${version || "<empty>"}`);
  }

  if (blockers.length > 0) {
    console.log(JSON.stringify({ verdict: "BLOCKED", blockers }, null, 2));
    process.exit(1);
  }

  const tmpRoot = await mkdtemp(join(tmpdir(), "justice-child-session-correlation-"));
  const projectDir = join(tmpRoot, "project");
  const outDir = join(tmpRoot, "out");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const hookLogPath = join(outDir, "hook-log.jsonl");
  const pluginPath = join(outDir, "justice-correlation-spike-plugin.js");
  const fixturePath = join(projectDir, "spike-fixture.txt");

  writeFileSync(pluginPath, PLUGIN_SOURCE);
  writeFileSync(
    fixturePath,
    [
      "Spike fixture observed by the sp-review worker through the read tool.",
      "The fixture exists only so the child emits a deterministic tool part;",
      "no correlation identity is ever derived from this file or its path.",
    ].join("\n"),
  );

  // The mock binds port 0 and exposes its actual bound port — no release-then-
  // rebind window, so no other process can race us for the port.
  const mock = createMockModelServer(fixturePath);
  const mockPort = mock.port;

  writeFileSync(
    join(projectDir, "opencode.json"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugin: [pluginPath],
        model: "spike/spike-model",
        small_model: "spike/spike-model",
        share: "disabled",
        autoupdate: false,
        snapshot: false,
        provider: {
          spike: {
            npm: "@ai-sdk/openai-compatible",
            name: "Spike",
            options: { baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKey: "spike-local" },
            models: {
              "spike-model": {
                name: "Spike Model",
                tool_call: true,
                reasoning: false,
                attachment: false,
                limit: { context: 128000, output: 8192 },
              },
            },
          },
        },
        agent: {
          [REVIEW_AGENT]: {
            model: "spike/spike-model",
            description: "spike review worker",
            mode: "subagent",
            prompt: "You are a spike review worker. Follow the task prompt.",
            permission: { edit: "allow", bash: "allow" },
          },
          [FINAL_REVIEW_AGENT]: {
            model: "spike/spike-model",
            description: "spike final review worker",
            mode: "subagent",
            prompt: "You are a spike final review worker. Follow the task prompt.",
            permission: { edit: "allow", bash: "allow" },
          },
        },
        permission: { edit: "allow", bash: "allow", webfetch: "allow" },
      },
      null,
      2,
    ),
  );

  // `--port 0` lets the runtime bind an OS-assigned port and report the
  // actual bound port on its listening line — no release-then-rebind window,
  // so no other process can race us for the port (TOCTOU-free).
  const server = Bun.spawn(["opencode", "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: projectDir,
    env: {
      ...process.env,
      JUSTICE_SPIKE_HOOK_LOG: hookLogPath,
      XDG_DATA_HOME: join(tmpRoot, "data"),
      XDG_CONFIG_HOME: join(tmpRoot, "config"),
      OPENCODE_DISABLE_AUTOUPDATE: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  progress("spawned opencode serve with --port 0 (runtime reports its bound port)");
  // Drain serve output incrementally in memory for BLOCKED diagnostics only
  // (never persisted); a running server never closes its streams, so a
  // whole-stream text() read would never resolve.
  const serveLog = { text: "" };
  const drainServeStream = async (stream: ReadableStream<Uint8Array> | undefined): Promise<void> => {
    if (!stream) return;
    const decoder = new TextDecoder();
    try {
      for await (const chunk of stream) {
        serveLog.text += decoder.decode(chunk as Uint8Array, { stream: true });
      }
    } catch {
      // stream ended or process killed
    }
  };
  void drainServeStream(server.stdout);
  void drainServeStream(server.stderr);

  const sseController = new AbortController();
  const busEvents: BusEvent[] = [];
  let sseCollector: Promise<void> = Promise.resolve();

  let exitCode = 1;
  try {
    const reportServeFailure = async (why: string): Promise<void> => {
      const exited = await Promise.race([server.exited, Bun.sleep(1_000).then(() => "still-running")]);
      const tail = scrub(serveLog.text.trim(), tmpRoot, 400);
      fail(`${why} (exit=${typeof exited === "number" ? exited : "running"}, output="${tail || "<empty>"}")`);
    };
    progress("waiting for opencode serve to report its bound port");
    let opencodePort = 0;
    const listenDeadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < listenDeadline) {
      const match = serveLog.text.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match?.[1]) {
        opencodePort = Number(match[1]);
        break;
      }
      await Bun.sleep(100);
    }
    if (opencodePort === 0) {
      await reportServeFailure(`opencode serve did not report a bound port within ${READY_TIMEOUT_MS}ms`);
    } else {
      const baseUrl = `http://127.0.0.1:${opencodePort}`;
      progress(`opencode serve listening on 127.0.0.1:${opencodePort}; probing readiness`);
      if (!(await waitForServer(baseUrl))) {
        await reportServeFailure(`opencode serve did not become ready within ${READY_TIMEOUT_MS}ms`);
    } else {
      progress("serve ready");
      // Start the SSE collector only after the server is accepting requests,
      // otherwise the first fetch fails with ECONNREFUSED and the bus stays empty.
      sseCollector = collectSseEvents(baseUrl, busEvents, sseController);
      // Create the parent session and drive exactly two task() dispatches.
      const createRes = await withTimeout(
        fetch(`${baseUrl}/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "justice-spike-parent" }),
        }),
        30_000,
        "POST /session",
      ).catch((error: unknown) => {
        fail(`POST /session failed: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      });
      if (!createRes) {
        // blocker already recorded
      } else if (!createRes.ok) {
        fail(`POST /session failed with HTTP ${createRes.status}`);
      } else {
        const parentSession = (await createRes.json()) as { id: string };
        const parentSessionId = parentSession.id;
        progress("parent session created; driving dispatch turn");

        const promptRes = await withTimeout(
          fetch(`${baseUrl}/session/${parentSessionId}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agent: "build", parts: [{ type: "text", text: PARENT_PROMPT }] }),
          }),
          TURN_TIMEOUT_MS,
          "parent prompt turn",
        ).catch((error: unknown) => {
          fail(`parent prompt turn failed: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        });
        if (promptRes) {
          if (!promptRes.ok) {
            fail(`POST /session/{id}/message failed with HTTP ${promptRes.status}`);
          } else {
            const turn = (await promptRes.json()) as { info?: { error?: unknown } };
            if (turn.info?.error) {
              fail(`parent turn completed with a runtime error: ${JSON.stringify(turn.info.error).slice(0, 200)}`);
            }
          }
        }
        progress("dispatch turn complete; waiting for bus to settle");

        // Wait for the bus to settle (session.idle for the parent session).
        const idleDeadline = Date.now() + 30_000;
        while (Date.now() < idleDeadline) {
          const seen = busEvents.some((e) => e.type === "session.idle" && e.properties?.sessionID === parentSessionId);
          if (seen) break;
          await Bun.sleep(200);
        }
      }
      }
    }

    await Bun.sleep(500);
    sseController.abort();
    await sseCollector;

    // Runtime observation payloads. A missing, unreadable, or partially
    // written log means the correlation evidence itself is unavailable —
    // fall through to the structured BLOCKED result below instead of crashing.
    let hookRecords: HookRecord[] = [];
    try {
      hookRecords = readFileSync(hookLogPath, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as HookRecord);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(`correlation evidence unavailable: observation log could not be read or parsed (${scrub(reason, tmpRoot, 160)})`);
    }

    const beforeRecords = hookRecords.filter(
      (r): r is ToolExecuteBeforeRecord =>
        r.kind === "tool.execute.before" && r.tool === "task" && typeof r.callID === "string" && r.callID.length > 0,
    );
    const afterRecords = hookRecords.filter(
      (r): r is ToolExecuteAfterRecord =>
        r.kind === "tool.execute.after" && r.tool === "task" && typeof r.callID === "string" && r.callID.length > 0,
    );

    if (beforeRecords.length !== REQUIRED_WORKERS.length) {
      fail(`expected exactly ${REQUIRED_WORKERS.length} task() tool.execute.before hook payloads, observed ${beforeRecords.length}`);
    }

    const traces: Trace[] = [];
    for (const before of beforeRecords) {
      const afterMatches = afterRecords.filter((r) => r.callID === before.callID);
      if (afterMatches.length !== 1) {
        fail(`no unique tool.execute.after payload for parent call ID ${before.callID} (matches: ${afterMatches.length})`);
        continue;
      }
      const after = afterMatches[0]!;
      const parentCallId = before.callID;
      const childSessionId = typeof after.metadata?.sessionId === "string" ? after.metadata.sessionId : "";
      if (!childSessionId) {
        fail(`no non-empty runtime-provided child session ID for parent call ID ${parentCallId} (metadata.sessionId missing or empty)`);
        continue;
      }
      const parentSessionIdFromHook = typeof after.metadata?.parentSessionId === "string" ? after.metadata.parentSessionId : "";
      if (parentSessionIdFromHook !== before.sessionID) {
        fail(`after-hook metadata.parentSessionId (${parentSessionIdFromHook || "<empty>"}) does not match hook input sessionID (${before.sessionID}) for call ${parentCallId}`);
      }

      const workerLabel = typeof before.subagent_type === "string" ? before.subagent_type : "";
      if (!REQUIRED_WORKERS.includes(workerLabel as (typeof REQUIRED_WORKERS)[number])) {
        fail(`task dispatch for call ${parentCallId} does not carry a required worker subagent_type (observed: "${workerLabel}")`);
        continue;
      }

      const sessionMatches = sessionEventsFor(busEvents, childSessionId);
      const parentLinkEvent = sessionMatches.find(
        (entry) => (entry.info.parentID as string | undefined) === before.sessionID,
      );
      if (!parentLinkEvent) {
        fail(`no session.created/session.updated event on the bus links child session ${childSessionId} to parent session ${before.sessionID} via properties.info.parentID`);
      }

      const observation = childObservationFromEvents(busEvents, childSessionId);
      try {
        const childRes = await fetch(`${baseUrl}/session/${childSessionId}/message`, { signal: AbortSignal.timeout(10_000) });
        if (childRes.ok) {
          const childMessages = (await childRes.json()) as unknown[];
          observation.restMessages = childMessages.length;
        }
      } catch {
        // REST corroboration is best-effort
      }
      if (observation.messageEvents === 0 && observation.restMessages === 0) {
        fail(`no child-session message observations found for child session ${childSessionId}`);
      }

      traces.push({
        worker: workerLabel,
        parentCallId,
        parentSessionId: before.sessionID,
        childSessionId,
        hookEvent: "plugin hook tool.execute.before + tool.execute.after",
        hookInput: { tool: "task", sessionID: before.sessionID, callID: parentCallId },
        hookArgsEchoed: { subagent_type: workerLabel },
        hookAfterMetadata: {
          parentSessionId: parentSessionIdFromHook,
          sessionId: childSessionId,
        },
        childSessionEvent: {
          type: parentLinkEvent?.type ?? "<missing>",
          field: "properties.info.parentID",
          parentID: String(parentLinkEvent?.info.parentID ?? "<missing>"),
          matches: Boolean(parentLinkEvent),
        },
        childObservation: observation,
      });
    }

    if (traces.length === REQUIRED_WORKERS.length) {
      const workers = new Set(traces.map((t) => t.worker));
      for (const required of REQUIRED_WORKERS) {
        if (!workers.has(required)) fail(`missing ${required} dispatch trace (observed workers: ${[...workers].join(", ")})`);
      }
      if (new Set(traces.map((t) => t.childSessionId)).size !== traces.length) {
        fail("two dispatches resolved to the same child session ID; expected distinct child sessions");
      }
    }

    const verdict: Verdict = blockers.length === 0 && traces.length === REQUIRED_WORKERS.length ? "OK" : "BLOCKED";
    const firstSessionBusEvent = busEvents.find((e) => e.type === "session.created" || e.type === "session.updated");
    const rawFirstSessionEvent = firstSessionBusEvent
      ? {
          kind: "event",
          id: firstSessionBusEvent.id,
          type: firstSessionBusEvent.type,
          session: {
            id: (firstSessionBusEvent.properties?.info as Record<string, unknown> | undefined)?.id,
            parentID: (firstSessionBusEvent.properties?.info as Record<string, unknown> | undefined)?.parentID,
          },
        }
      : null;

    const result = {
      verdict,
      runtime: { cli: "opencode", version: PINNED_OPENCODE_VERSION, mode: "opencode serve (headless HTTP)" },
      observedSurfaces: {
        hooks: "plugin tool.execute.before / tool.execute.after (JSONL via spike observation plugin)",
        eventBus: "GET /event (SSE) — same events the plugin `event` hook receives",
        rest: "POST /session, POST /session/{id}/message, GET /session/{id}/message",
      },
      fieldPaths: {
        parentCallId: "tool.execute.before hook input .callID (echoed in tool.execute.after input .callID and the parent session ToolPart.callID)",
        taskArgs: "tool.execute.before hook output .args (the runtime passes tool args via the hook's output parameter, not input.args)",
        childSessionId: "tool.execute.after hook output .metadata.sessionId",
        parentSessionCorroboration: "tool.execute.after hook output .metadata.parentSessionId; event bus properties.info.parentID",
      },
      traces: traces.map((t) => scrubDeep(t, tmpRoot)),
      ...(verdict === "BLOCKED"
        ? {
            blockers,
            rawShapes: {
              firstTaskBeforeHook: scrubDeep(
                hookRecords.find((r) => r.kind === "tool.execute.before") ?? null,
                tmpRoot,
              ),
              firstTaskAfterHook: scrubDeep(
                hookRecords.find((r) => r.kind === "tool.execute.after" && r.tool === "task") ?? null,
                tmpRoot,
              ),
              firstSessionEvent: scrubDeep(rawFirstSessionEvent, tmpRoot),
            },
          }
        : {}),
    };

    console.log(JSON.stringify(result, null, 2));
    exitCode = verdict === "OK" ? 0 : 1;
  } finally {
    sseController.abort();
    try {
      server.kill();
    } catch {
      // process already gone
    }
    mock.stop(true);
    await Bun.sleep(250);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

await main();
