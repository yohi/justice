/* global process queueMicrotask */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CHILD_IDENTITY = "running as an omo senpi-task child";
let parentCallCount = 0;
let childCallCount = 0;

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function isChild(context) {
  return (context.messages ?? []).some((message) => messageText(message.content).includes(CHILD_IDENTITY));
}

function loadScript(cwd) {
  const override = process.env.JUSTICE_SPIKE_MOCK_SCRIPT;
  const path = override && override.length > 0 ? override : join(cwd, "mock-script.json");
  if (!existsSync(path)) {
    return {
      parentSteps: [{ type: "text", text: "parent done" }],
      childSteps: [{ type: "text", text: "child done" }],
    };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function assistantMessage(step, call, model = "mock-1") {
  const content = step.type === "text"
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

function localStream(step, call, options) {
  const queue = [];
  const waiters = [];
  let done = false;
  let settle;
  const final = new Promise((resolve) => {
    settle = resolve;
  });
  const result = assistantMessage(step, call);
  const stream = {
    push(event) {
      if (done) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    },
    end(value) {
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
          return new Promise((resolve) => waiters.push(resolve));
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
      const toolCall = result.content[0];
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: { ...result, content: [{ ...toolCall, arguments: {} }] } });
      stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: result });
      stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: result });
    }
    stream.push({ type: "done", reason: result.stopReason, message: result });
    stream.end(result);
  });
  return stream;
}

export default function registerMockProvider(pi) {
  pi.registerProvider("omo-mock", {
    name: "Justice evidence mock provider",
    baseUrl: "file://justice-spike",
    apiKey: "mock",
    api: "openai-completions",
    models: [{
      id: "mock-1",
      name: "Mock 1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 4096,
    }],
    streamSimple(_model, context, options) {
      const script = loadScript(context.cwd ?? process.cwd());
      const child = isChild(context);
      const index = child ? childCallCount++ : parentCallCount++;
      const steps = child ? script.childSteps : script.parentSteps;
      const step = steps[Math.min(index, Math.max(steps.length - 1, 0))]
        ?? { type: "text", text: child ? "child done" : "parent done" };
      return localStream(step, index + 1, options);
    },
  });
}
