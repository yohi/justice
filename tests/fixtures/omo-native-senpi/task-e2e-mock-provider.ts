import { appendFileSync, existsSync, readFileSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";

export type MockStep =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_call"; readonly name: string; readonly id?: string; readonly arguments: Readonly<Record<string, unknown>> };

export type MockScript = {
  readonly parentSteps: readonly MockStep[];
  readonly childSteps: readonly MockStep[];
  readonly nonTaskChildSteps?: readonly MockStep[];
};

const CAPABILITY_MARKER = "[[justice-capability-v1]]";
const RUNTIME_TASK_ID_PLACEHOLDER = "@JUSTICE_RUNTIME_TASK_ID@";

function redactionTokensForContext(messages: ReadonlyArray<unknown>): string[] {
  const tokens = [CAPABILITY_MARKER];
  const envelope = capabilityEnvelopeFromMessages(messages);
  if (envelope) tokens.push(envelope);
  tokens.sort((a, b) => b.length - a.length);
  return tokens;
}

function sanitize(value: unknown, tokens: readonly string[]): unknown {
  return sanitizeWithTokens(value, tokens);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function capabilityEnvelopeFromMessages(messages: ReadonlyArray<unknown>): string | null {
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as { readonly content?: unknown }).content;
    const texts: string[] = [];
    if (typeof content === "string") {
      texts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && "text" in part && typeof (part as { readonly text: unknown }).text === "string") {
          texts.push((part as { readonly text: string }).text);
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

function record(row: Record<string, unknown>, tokens: readonly string[] = [CAPABILITY_MARKER]): void {
  const evidencePath = process.env.JUSTICE_SPIKE_EVIDENCE_PATH;
  if (!evidencePath) return;
  const sanitized = sanitize(row, tokens);
  const payloadObject: Record<string, unknown> =
    sanitized !== null && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? (sanitized as Record<string, unknown>)
      : {};
  appendFileSync(evidencePath, `${JSON.stringify({ at: Date.now(), pid: process.pid, ...payloadObject })}\n`);
}

function injectCapabilityIntoTaskStep(step: MockStep, envelope: string): MockStep {
  if (step.type !== "tool_call" || step.name !== "task") return step;
  const args = { ...step.arguments };
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const capabilityTransportRequested =
    prompt.includes("JUSTICE_REVIEW_TARGET") || prompt.includes("JUSTICE_FALLBACK_PROBE");
  if (!capabilityTransportRequested) return step;
  if (typeof args.description !== "string" || args.description.length === 0) {
    args.description = envelope;
  } else if (!String(args.description).includes(CAPABILITY_MARKER)) {
    args.description = `${String(args.description)}\n${envelope}`;
  }
  return { ...step, arguments: args };
}

function injectCapabilityIntoUnknownEchoStep(step: MockStep, envelope: string): MockStep {
  if (step.type !== "tool_call" || step.name !== "justice_unknown_echo") return step;
  return {
    ...step,
    arguments: { ...step.arguments, payload: envelope, description: envelope },
  };
}

function injectCapabilityIntoNonTaskStep(step: MockStep, envelope: string): MockStep {
  if (step.type !== "tool_call" || step.name !== "fixture_non_task_side_effect") return step;
  if (step.arguments.payload === "JUSTICE_CAPABILITY_ECHO_PLACEHOLDER") {
    return { ...step, arguments: { ...step.arguments, payload: envelope } };
  }
  return step;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function isChild(context: { readonly messages?: ReadonlyArray<unknown> }): boolean {
  const fixtureRole = process.env.JUSTICE_SPIKE_FIXTURE_ROLE;
  if (fixtureRole === "child") return true;
  if (fixtureRole === "parent") return false;
  const messageTexts = (context.messages ?? []).map((message) =>
    messageText((message as { readonly content?: unknown }).content),
  );
  if (messageTexts.some((text) => text.includes("SPIKE_RECOGNIZED_PARENT"))) return false;
  return true;
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
      : [{ type: "toolCall", id: step.id ?? `justice-spike-${call}`, name: step.name, arguments: step.arguments }];
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

function waitForSignalFile(path: string, signal?: AbortSignal): Promise<void> {
  if (existsSync(path) || signal?.aborted === true) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("task_send_signal_timeout")), 5_000);
    const watcher = watch(dirname(path), (_event: string, filename: string | Buffer | null) => {
      if ((filename === null || filename.toString() === basename(path)) && existsSync(path)) finish();
    });
    const onAbort = (): void => finish();
    const finish = (cause?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      watcher.close();
      signal?.removeEventListener("abort", onAbort);
      if (cause === undefined) resolve();
      else reject(cause);
    };
    watcher.once("error", (error: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (existsSync(path)) finish();
  });
}

function localStream(
  step: MockStep,
  call: number,
  options?: { readonly signal?: AbortSignal },
  waitForSignalPath?: string,
) {
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
    void (async (): Promise<void> => {
      if (waitForSignalPath !== undefined) await waitForSignalFile(waitForSignalPath, options?.signal);
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
    })().catch((cause: unknown) => {
      const failed = { ...result, stopReason: "error", errorMessage: cause instanceof Error ? cause.message : String(cause) };
      stream.push({ type: "error", reason: "error", error: failed });
      stream.end(failed);
    });
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

let emittedCallCount = 0;
let executingPlansReadIssued = false;
const issuedParentStepIndexes = new Set<number>();
const issuedChildStepIndexes = new Set<number>();

function hasToolCallId(messages: readonly unknown[], toolCallId: string): boolean {
  return messages.some((message) => {
    if (!isRecord(message)) return false;
    if (message.toolCallId === toolCallId) return true;
    if (!Array.isArray(message.content)) return false;
    return message.content.some(
      (part: unknown) => isRecord(part) && part.type === "toolCall" && part.id === toolCallId,
    );
  });
}

function executingPlansReadStep(messages: readonly unknown[]): MockStep | undefined {
  const superpowersRoot = process.env.JUSTICE_SPIKE_SUPERPOWERS_ROOT?.replaceAll("\\", "/");
  if (superpowersRoot === undefined) return undefined;
  const messagesText = messages.map((message) => messageText(isRecord(message) ? message.content : undefined));
  const designMethodReadDelivered = messagesText.some((text) =>
    text.includes("[[justice-capability-directive-v1]] successful subagent-driven-development method read"),
  );
  const planSkillPath = `${superpowersRoot}/skills/executing-plans/SKILL.md`;
  const planMethodReadDelivered = messagesText.some((text) =>
    text.includes("[[justice-capability-directive-v1]] successful executing-plans method read"),
  );
  const readCallId = "justice-spike-read-2";
  if (
    executingPlansReadIssued ||
    !designMethodReadDelivered ||
    planMethodReadDelivered ||
    hasToolCallId(messages, readCallId)
  ) {
    return undefined;
  }
  executingPlansReadIssued = true;
  return {
    type: "tool_call",
    name: "read",
    id: readCallId,
    arguments: { path: planSkillPath },
  };
}

function nextScriptStep(
  steps: readonly MockStep[],
  messages: readonly unknown[],
  issuedIndexes: Set<number>,
  child: boolean,
): MockStep {
  for (let index = 0; index < steps.length; index++) {
    if (issuedIndexes.has(index)) continue;
    const step = steps[index];
    if (step === undefined) continue;
    if (step.type === "tool_call" && typeof step.id === "string" && hasToolCallId(messages, step.id)) {
      issuedIndexes.add(index);
      continue;
    }
    issuedIndexes.add(index);
    return step;
  }
  return { type: "text", text: child ? "child done" : "parent done" };
}

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
      const messages = context.messages ?? [];
      const contextTokens = redactionTokensForContext(messages);
      const nonTaskProbeChild = messages.some((message) =>
        messageText(isRecord(message) ? message.content : undefined).includes("JUSTICE_NON_TASK_CHILD"),
      );
      const steps = child
        ? nonTaskProbeChild
          ? script.nonTaskChildSteps ?? script.childSteps
          : script.childSteps
        : script.parentSteps;
      const extraMethodRead = child ? undefined : executingPlansReadStep(messages);
      let step: MockStep;
      if (extraMethodRead !== undefined) {
        step = extraMethodRead;
      } else {
        step = nextScriptStep(
          steps,
          messages,
          child ? issuedChildStepIndexes : issuedParentStepIndexes,
          child,
        );
      }
      // The deterministic mock model reads the capability ONLY from the request-local
      // context copy delivered by the probe's context handler. No environment fallback exists.
      const envelope = capabilityEnvelopeFromMessages(messages);
      record(
        {
          event: "mock_provider_context",
          isChild: child,
          messageCount: messages.length,
          capabilityInContext: envelope !== null,
          capabilitySource: envelope !== null ? "context_messages" : "none",
          envCapabilityVarPresent: Object.hasOwn(process.env, "JUSTICE_SPIKE_CAPABILITY_ENVELOPE"),
        },
        contextTokens,
      );
      if (envelope) {
        step = injectCapabilityIntoTaskStep(step, envelope);
        step = injectCapabilityIntoUnknownEchoStep(step, envelope);
        step = injectCapabilityIntoNonTaskStep(step, envelope);
      }
      const runtimeTaskId = !child ? extractRuntimeTaskId(context) : null;
      step = substituteRuntimeTaskId(step, runtimeTaskId);
      const taskSendSignalPath = process.env.JUSTICE_SPIKE_TASK_SEND_SIGNAL_PATH;
      const awaitParentTaskSend =
        child &&
        messages.some((message) => messageText(isRecord(message) ? message.content : undefined).includes("JUSTICE_REVIEW_TARGET")) &&
        taskSendSignalPath !== undefined;
      if (!child && step.type === "tool_call" && step.name === "task_send") {
        record(
          { event: "mock_provider_task_send_step", to: step.arguments.to, runtimeTaskIdResolved: runtimeTaskId },
          contextTokens,
        );
      }
      emittedCallCount++;
      return localStream(step, emittedCallCount, options, awaitParentTaskSend ? taskSendSignalPath : undefined);
    },
  });
}
