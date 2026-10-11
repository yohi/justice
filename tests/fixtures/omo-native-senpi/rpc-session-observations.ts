import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { decodeTaskCapabilityEnvelope } from "./capability-probe";

export const RPC_RECORD_SCHEMA = z.record(z.string(), z.unknown()).readonly();
const CAPABILITY_MARKER = "[[justice-capability-v1]]";
const FALLBACK_ERROR = "justice_capability_outbound_sanitize_failed";

export type CapabilityToolCallExpectation = Readonly<{
  readonly toolCallId: string;
  readonly originalDescription: string | null;
}>;

export type AppendObservation = Readonly<Record<string, unknown>>;
export type FixtureCapabilityTokens =
  | Readonly<{ readonly kind: "available"; readonly tokens: readonly string[] }>
  | Readonly<{ readonly kind: "unavailable"; readonly reason: "mock_script_path_missing" | "mock_script_unreadable" | "capability_envelope_missing" }>;

export const RpcSessionDriverSummarySchema = z.object({
  setupError: z.string().optional(),
  rpcResponseTrace: z.array(z.string()).optional(),
  runtimeMode: z.literal("rpc").optional(),
  sessionId: z.string().optional(),
  agentEndCount: z.number().optional(),
  entryAppendedObservations: z.array(RPC_RECORD_SCHEMA).optional(),
  syntheticToolResultObservations: z.array(RPC_RECORD_SCHEMA).optional(),
  fallbackAppendObservations: z.array(RPC_RECORD_SCHEMA).optional(),
});

export type RpcSessionDriverSummary = z.infer<typeof RpcSessionDriverSummarySchema>;

function isRecord(value: unknown): value is z.infer<typeof RPC_RECORD_SCHEMA> {
  return RPC_RECORD_SCHEMA.safeParse(value).success;
}

export function readFixtureCapabilityIds(): FixtureCapabilityTokens {
  const path = process.env.JUSTICE_SPIKE_MOCK_SCRIPT;
  if (path === undefined) return { kind: "unavailable", reason: "mock_script_path_missing" };

  let fixture: unknown;
  try {
    fixture = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause: unknown) {
    if (cause instanceof Error) return { kind: "unavailable", reason: "mock_script_unreadable" };
    throw cause;
  }

  const strings: string[] = [];
  const stack: unknown[] = [fixture];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") strings.push(current);
    else if (Array.isArray(current)) for (const item of current) stack.push(item);
    else if (isRecord(current)) {
      for (const [key, value] of Object.entries(current)) {
        strings.push(key);
        stack.push(value);
      }
    }
  }

  const ids = new Set<string>();
  for (const text of strings) {
    const marker = text.indexOf(CAPABILITY_MARKER);
    if (marker < 0) continue;
    const envelope = text.slice(marker).split("\n", 1)[0];
    if (envelope === undefined) continue;
    const decoded = decodeTaskCapabilityEnvelope(envelope);
    if (decoded.kind === "decoded") ids.add(decoded.capabilityId);
  }
  return ids.size === 0
    ? { kind: "unavailable", reason: "capability_envelope_missing" }
    : { kind: "available", tokens: Array.from(ids) };
}

function containsSecret(value: unknown, tokens: readonly string[]): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      if (tokens.some((token) => token.length > 0 && current.includes(token))) return true;
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (isRecord(current)) {
      for (const [key, item] of Object.entries(current)) {
        if (tokens.some((token) => token.length > 0 && key.includes(token))) return true;
        stack.push(item);
      }
    }
  }
  return false;
}

function diskEntryFor(sessionFile: string, entryId: string): z.infer<typeof RPC_RECORD_SCHEMA> | null {
  let contents: string;
  try {
    contents = readFileSync(sessionFile, "utf8");
  } catch (cause: unknown) {
    if (cause instanceof Error) return null;
    throw cause;
  }

  for (const line of contents.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause: unknown) {
      if (cause instanceof Error) continue;
      throw cause;
    }
    const entry = RPC_RECORD_SCHEMA.safeParse(parsed);
    if (entry.success && entry.data.id === entryId) return entry.data;
  }
  return null;
}

function descriptionRestored(argumentsValue: unknown, originalDescription: string | null): boolean {
  if (!isRecord(argumentsValue)) return false;
  const hasDescription = Object.hasOwn(argumentsValue, "description");
  return originalDescription === null
    ? !hasDescription
    : hasDescription && argumentsValue.description === originalDescription;
}

function toolCallsFromMessage(message: unknown): readonly z.infer<typeof RPC_RECORD_SCHEMA>[] {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(
    (part): part is z.infer<typeof RPC_RECORD_SCHEMA> => isRecord(part) && part.type === "toolCall",
  );
}

function readEventEntry(record: z.infer<typeof RPC_RECORD_SCHEMA>): z.infer<typeof RPC_RECORD_SCHEMA> | null {
  const parsed = RPC_RECORD_SCHEMA.safeParse(record.entry);
  return parsed.success ? parsed.data : null;
}

export function observeAppendedEntry(input: {
  readonly record: z.infer<typeof RPC_RECORD_SCHEMA>;
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly expectedCapabilityCalls: ReadonlyMap<string, string | null>;
  readonly expectedSyntheticToolCallIds: ReadonlySet<string>;
  readonly knownCapabilityIds: readonly string[];
}): Readonly<{
  readonly assistantToolCalls: readonly AppendObservation[];
  readonly syntheticToolResults: readonly AppendObservation[];
  readonly fallbackMessages: readonly AppendObservation[];
}> {
  const entry = readEventEntry(input.record);
  if (entry === null || entry.type !== "message") {
    return { assistantToolCalls: [], syntheticToolResults: [], fallbackMessages: [] };
  }
  const messageResult = RPC_RECORD_SCHEMA.safeParse(entry.message);
  if (!messageResult.success) return { assistantToolCalls: [], syntheticToolResults: [], fallbackMessages: [] };
  const message = messageResult.data;
  const diskEntry = typeof entry.id === "string" ? diskEntryFor(input.sessionFile, entry.id) : null;
  const readBackMatched = diskEntry !== null && isDeepStrictEqual(entry, diskEntry);

  const assistantToolCalls: AppendObservation[] = [];
  if (message.role === "assistant") {
    for (const call of toolCallsFromMessage(message)) {
      if (typeof call.id !== "string" || !input.expectedCapabilityCalls.has(call.id)) continue;
      const diskMessage = diskEntry === null ? null : RPC_RECORD_SCHEMA.safeParse(diskEntry.message);
      const diskCall = diskMessage?.success === true
        ? toolCallsFromMessage(diskMessage.data).find((candidate) => candidate.id === call.id)
        : undefined;
      const expectedDescription = input.expectedCapabilityCalls.get(call.id) ?? null;
      const descriptionMatched = descriptionRestored(call.arguments, expectedDescription);
      const diskDescriptionMatched = diskCall !== undefined && descriptionRestored(diskCall.arguments, expectedDescription);
      const markerAbsent = !containsSecret(entry, [CAPABILITY_MARKER]);
      const knownTokenAbsent = !containsSecret(entry, input.knownCapabilityIds);
      assistantToolCalls.push({
        sessionId: input.sessionId,
        entryId: entry.id,
        toolCallId: call.id,
        subscriptionEvent: "entry_appended",
        subscriptionSource: "AgentSession.subscribe via Senpi RPC",
        observedAt: Date.now(),
        immediateJsonlReadBackMatched: readBackMatched && diskDescriptionMatched,
        descriptionRestored: descriptionMatched && diskDescriptionMatched ? expectedDescription : null,
        descriptionRestoredMatchesExpected: descriptionMatched && diskDescriptionMatched,
        capabilityEnvelopeMarkerAbsent: markerAbsent,
        knownCapabilityTokenAbsent: knownTokenAbsent,
        capabilityAbsentFromArguments: markerAbsent && knownTokenAbsent && descriptionMatched && diskDescriptionMatched,
      });
    }
  }

  const syntheticToolResults: AppendObservation[] = [];
  if (message.role === "toolResult" && typeof message.toolCallId === "string" &&
      input.expectedSyntheticToolCallIds.has(message.toolCallId)) {
    syntheticToolResults.push({
      sessionId: input.sessionId,
      entryId: entry.id,
      toolCallId: message.toolCallId,
      role: message.role,
      isError: message.isError === true,
      entryAppendedObserved: true,
      immediateJsonlReadBackMatched: readBackMatched,
      capabilityAbsentFromResult: diskEntry !== null &&
        !containsSecret(diskEntry, input.knownCapabilityIds) &&
        !containsSecret(diskEntry, [CAPABILITY_MARKER]),
    });
  }

  const fallbackMessages: AppendObservation[] = [];
  if (message.role === "assistant" && message.errorMessage === FALLBACK_ERROR) {
    const usage = RPC_RECORD_SCHEMA.safeParse(message.usage);
    const cost = usage.success ? RPC_RECORD_SCHEMA.safeParse(usage.data.cost) : null;
    const allowedKeys = new Set([
      "role", "content", "api", "provider", "model", "timestamp", "stopReason", "errorMessage", "usage",
    ]);
    const keys = Object.keys(message);
    const optionalFieldsRemoved = keys.length === allowedKeys.size && keys.every((key) => allowedKeys.has(key));
    const usageZero = usage.success &&
      ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every((key) => usage.data[key] === 0);
    const costZero = cost?.success === true &&
      ["input", "output", "cacheRead", "cacheWrite", "total"].every((key) => cost.data[key] === 0);
    fallbackMessages.push({
      sessionId: input.sessionId,
      entryId: entry.id,
      role: message.role,
      content: message.content,
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
      timestamp: message.timestamp,
      fallbackExact: Array.isArray(message.content) && message.content.length === 0 &&
        message.stopReason === "error" && typeof message.timestamp === "number" &&
        usageZero && costZero && optionalFieldsRemoved,
      catalogValuesSafe: message.api === "openai-completions" && message.provider === "omo-mock" && message.model === "mock-1",
      immediateJsonlReadBackMatched: readBackMatched && diskEntry !== null &&
        RPC_RECORD_SCHEMA.safeParse(diskEntry.message).success,
      tokenFree: !containsSecret(entry, input.knownCapabilityIds) && !containsSecret(entry, [CAPABILITY_MARKER]),
    });
  }

  return { assistantToolCalls, syntheticToolResults, fallbackMessages };
}
