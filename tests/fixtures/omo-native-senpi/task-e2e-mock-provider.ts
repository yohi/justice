import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MockStep =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_call"; readonly name: string; readonly arguments: Readonly<Record<string, unknown>> };

export type MockScript = {
  readonly parentSteps: readonly MockStep[];
  readonly childSteps: readonly MockStep[];
};

const CHILD_IDENTITY = "running as an omo senpi-task child";
const CAPABILITY_MARKER = "[[justice-capability-v1]]";
const RUNTIME_TASK_ID_PLACEHOLDER = "@JUSTICE_RUNTIME_TASK_ID@";

function sanitize(value: unknown): unknown {
  const tokens: string[] = [];
  const envEnvelope = process.env.JUSTICE_SPIKE_CAPABILITY_ENVELOPE;
  if (envEnvelope) tokens.push(envEnvelope);
  tokens.push(CAPABILITY_MARKER);
  tokens.sort((a, b) => b.length - a.length);
  return sanitizeWithTokens(value, tokens);
}

function sanitizeWithTokens(value: unknown, tokens: readonly string[]): unknown {
  if (typeof value === "string") {
    let changed = value;
    for (const token of tokens) {
      changed = changed.replaceAll(token, "[JUSTICE-CAPABILITY-REDACTED]");
    }
    return changed;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWithTokens(item, tokens));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = sanitizeWithTokens(v, tokens);
    }
    return result;
  }
  return value;
}

function record(row: Record<string, unknown>): void {
  const evidencePath = process.env.JUSTICE_SPIKE_EVIDENCE_PATH;
  if (!evidencePath) return;
  const sanitized = sanitize(row);
  const payloadObject: Record<string, unknown> =
    sanitized !== null && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? (sanitized as Record<string, unknown>)
      : {};
  appendFileSync(evidencePath, `${JSON.stringify({ at: Date.now(), pid: process.pid, ...payloadObject })}\n`);
}

function extractCapabilityEnvelope(context: { readonly messages?: ReadonlyArray<unknown> }): string | null {
  const messages = context.messages ?? [];
  record({ event: "mock_provider_context", messageCount: messages.length, hasEnvEnvelope: Boolean(process.env.JUSTICE_SPIKE_CAPABILITY_ENVELOPE), messages });
  // Fixture-only: a deterministic mock provider reads a pre-generated envelope from the harness
  // and injects it into the next model-issued task description, simulating request-local context copy delivery.
  const envEnvelope = process.env.JUSTICE_SPIKE_CAPABILITY_ENVELOPE;
  if (envEnvelope && envEnvelope.includes(CAPABILITY_MARKER)) {
    return envEnvelope;
  }
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as { readonly content?: unknown }).content;
    const texts: string[] = [];
    if (typeof content === "string") {
      texts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          texts.push(part.text);
        }
      }
    }
    for (const text of texts) {
      const index = text.indexOf(CAPABILITY_MARKER);
      if (index >= 0) {
        const tail = text.slice(index);
        const newline = tail.indexOf("\n");
        const envelope = newline >= 0 ? tail.slice(0, newline) : tail;
        return envelope;
      }
    }
  }
  return null;
}

function injectCapabilityIntoTaskStep(step: MockStep, envelope: string): MockStep {
  if (step.type !== "tool_call" || step.name !== "task") return step;
  const args = { ...step.arguments };
  if (typeof args.description !== "string" || args.description.length === 0) {
    args.description = envelope;
  } else if (!String(args.description).includes(CAPABILITY_MARKER)) {
    args.description = `${String(args.description)}\n${envelope}`;
  }
  return { ...step, arguments: args };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function isChild(context: { readonly messages?: ReadonlyArray<unknown> }): boolean {
  return (context.messages ?? []).some((message) => messageText((message as { readonly content?: unknown }).content).includes(CHILD_IDENTITY));
}

function extractRuntimeTaskId(context: { readonly messages?: ReadonlyArray<unknown> }): string | null {
  for (const message of context.messages ?? []) {
    if (!message || typeof message !== "object") continue;
    const role = (message as { readonly role?: unknown }).role;
    const toolName = (message as { readonly toolName?: unknown }).toolName;
    if (role !== "toolResult" || toolName !== "task") continue;
    const content = (message as { readonly content?: unknown }).content;
    const text = messageText(content);
    const started = /Started task .* \((st_[A-Za-z0-9_-]+),/.exec(text);
    if (started?.[1]) return started[1];
  }
  return null;
}

function substituteRuntimeTaskId(step: MockStep, runtimeTaskId: string | null): MockStep {
  if (runtimeTaskId === null) return step;
  if (step.type !== "tool_call") return step;
  let replaced = false;
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step.arguments)) {
    if (typeof value === "string" && value.includes(RUNTIME_TASK_ID_PLACEHOLDER)) {
      args[key] = value.replaceAll(RUNTIME_TASK_ID_PLACEHOLDER, runtimeTaskId);
      replaced = true;
    } else if (Array.isArray(value)) {
      const items = value.map((item: unknown) => {
        const serialized = JSON.stringify(item);
        if (typeof serialized === "string" && serialized.includes(RUNTIME_TASK_ID_PLACEHOLDER)) {
          return JSON.parse(serialized.replaceAll(RUNTIME_TASK_ID_PLACEHOLDER, runtimeTaskId)) as Record<string, unknown>;
        }
        return item;
      });
      args[key] = items;
      replaced = items.length > 0;
    } else {
      args[key] = value;
    }
  }
  return replaced ? { ...step, arguments: args } : step;
}


function loadScript(cwd: string): MockScript {
  const override = process.env.JUSTICE_SPIKE_MOCK_SCRIPT;
  const path = override && override.length > 0 ? override : join(cwd, "mock-script.json");
  if (!existsSync(path)) {
    return {
      parentSteps: [{ type: "text", text: "parent done" }],
      childSteps: [{ type: "text", text: "child done" }],
    };
  }
  return JSON.parse(readFileSync(path, "utf8")) as MockScript;
}

function assistantMessage(step: MockStep, call: number, model = "mock-1") {
  const content =
    step.type === "text"
      ? [{ type: "text", text: step.text }]
      : [{ type: "toolCall", id: `justice-spike-${call}`, name: step.name, arguments: step.arguments }];
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "omo-mock",
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason: step.type === "tool_call" ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

function localStream(step: MockStep, call: number, options?: { readonly signal?: AbortSignal }) {
  const queue: unknown[] = [];
  const waiters: Array<(value: { value?: unknown; done: boolean }) => void> = [];
  let done = false;
  let settle: (value: unknown) => void;
  const final = new Promise<unknown>((resolve) => {
    settle = resolve;
  });
  const result = assistantMessage(step, call);
  const stream = {
    push(event: unknown) {
      if (done) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    },
    end(value: unknown) {
      if (done) return;
      done = true;
      settle(value);
      while (waiters.length > 0) waiters.shift()?.({ value: undefined, done: true });
    },
    result() {
      return final;
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise<{ value?: unknown; done: boolean }>((resolve) => waiters.push(resolve));
        },
      };
    },
  };

  queueMicrotask(() => {
    if (options?.signal?.aborted) {
      const aborted = { ...result, stopReason: "aborted" };
      stream.push({ type: "error", reason: "aborted", error: aborted });
      stream.end(aborted);
      return;
    }
    stream.push({ type: "start", partial: { ...result, content: [] } });
    if (step.type === "text") {
      stream.push({ type: "text_start", contentIndex: 0, partial: { ...result, content: [{ type: "text", text: "" }] } });
      stream.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: result });
      stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: result });
    } else {
      const toolCall = (result.content as unknown[])[0] as Record<string, unknown>;
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: { ...result, content: [{ ...toolCall, arguments: {} }] } });
      stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: result });
      stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: result });
    }
    stream.push({ type: "done", reason: result.stopReason, message: result });
    stream.end(result);
  });

  return stream as {
    readonly push: (event: unknown) => void;
    readonly end: (value: unknown) => void;
    readonly result: () => Promise<unknown>;
    readonly [Symbol.asyncIterator]: () => {
      next(): Promise<{ value?: unknown; done: boolean }>;
    };
  };
}

let parentCallCount = 0;
let childCallCount = 0;

export default function registerMockProvider(pi: {
  readonly registerProvider: (
    name: string,
    provider: {
      readonly name: string;
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly api: string;
      readonly models: readonly unknown[];
      readonly streamSimple: (model: string, context: { readonly cwd?: string; readonly messages?: ReadonlyArray<unknown> }, options?: { readonly signal?: AbortSignal }) => ReturnType<typeof localStream>;
    },
  ) => void;
}): void {
  pi.registerProvider("omo-mock", {
    name: "Justice evidence mock provider",
    baseUrl: "file://justice-spike",
    apiKey: "mock",
    api: "openai-completions",
    models: [
      {
        id: "mock-1",
        name: "Mock 1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 4096,
      },
    ],
    streamSimple(_model: string, context: { readonly cwd?: string; readonly messages?: ReadonlyArray<unknown> }, options?: { readonly signal?: AbortSignal }) {
      const script = loadScript(context.cwd ?? process.cwd());
      const child = isChild(context);
      const index = child ? childCallCount++ : parentCallCount++;
      const steps = child ? script.childSteps : script.parentSteps;
      let step = steps[Math.min(index, Math.max(steps.length - 1, 0))] ?? { type: "text", text: child ? "child done" : "parent done" };
      const envelope = !child ? extractCapabilityEnvelope(context) : null;
      if (envelope) {
        step = injectCapabilityIntoTaskStep(step, envelope);
      }
      const runtimeTaskId = !child ? extractRuntimeTaskId(context) : null;
      step = substituteRuntimeTaskId(step, runtimeTaskId);
      if (!child && step.type === "tool_call" && step.name === "task_send") {
        record({ event: "mock_provider_task_send_step", to: step.arguments.to, runtimeTaskIdResolved: runtimeTaskId });
      }
      return localStream(step, index + 1, options);
    },
  });
}
