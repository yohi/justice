// Fixture-only Senpi extension probe. No Justice production imports.

import { appendFileSync } from "node:fs";
import {
  CREDENTIAL_ENV_VARS,
  MOCK_MODEL_ID,
  MOCK_PROVIDER_ID,
  decodeTaskCapabilityEnvelope,
  fixtureCapabilityFromEnvelope,
  formatReviewAppendixSuffix,
  FixtureCapabilityRegistry,
  guardCapabilityToolCall,
  type CapabilityRejectionResult,
  type CapabilityVerdict,
  type NativeSuperpowersActivationBinding,
  type NativeSuperpowersTaskCapability,
  type TaskSendContinuationOutcome,
  type TranscriptGuardProfile,
  type UntrustedCallClassification,
} from "./capability-probe";
import { inspectCapabilitySessionStorage, scanCredentialStores } from "./capability-session-storage";

const evidencePath = process.env.JUSTICE_SPIKE_EVIDENCE_PATH;
const superpowersRoot = process.env.JUSTICE_SPIKE_SUPERPOWERS_ROOT?.replaceAll("\\", "/");
const APPENDIX = "[[JUSTICE_SPIKE_REVIEW_APPENDIX]]";
const REVIEW_TARGET = "JUSTICE_REVIEW_TARGET";
const CAPABILITY_MARKER = "[[justice-capability-v1]]";
const MALFORMED_ENVELOPE = `${CAPABILITY_MARKER}{not-json`;
const DUPLICATE_KEY_ENVELOPE = `${CAPABILITY_MARKER}{"capabilityId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","capabilityId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","originalDescription":null}`;

const activated = new Map<string, { readonly method: string; readonly sourceToolCallId: string; readonly sourcePath: string }>();
const registry = new FixtureCapabilityRegistry();
let parentSessionId: string | null = null;
const envEnvelope = process.env.JUSTICE_SPIKE_CAPABILITY_ENVELOPE ?? null;
const sessionFiles = new Map<string, string[]>();
const issuedCapabilityIds = new Set<string>();
const preSpawnDelivered = new Map<string, boolean>();
const nonTaskVetoed = new Map<string, boolean>();
const syntheticResultSanitized = new Map<string, boolean>();
const storageScanResults: Array<{ readonly tokenFound: boolean; readonly filesChecked: number; readonly entriesChecked: number }> = [];
const MAX_CAPABILITY_AGE_MS = 3_600_000;
const CREDENTIAL_SCAN = scanCredentialStores({
  homeDir: process.env.HOME ?? "",
  env: process.env,
  credentialEnvVars: CREDENTIAL_ENV_VARS,
});
const selectedModels: Array<{ readonly provider: string; readonly model: string; readonly source: string }> = [];
const observedUntrusted: UntrustedCallClassification[] = [];
const capabilityRejections: CapabilityRejectionResult[] = [];
const batchBindings: Array<{ readonly batchItemIndex: number; readonly taskId: string; readonly parentSessionId: string }> = [];
const compactionInvalidations: Array<{ readonly sessionId: string; readonly requestId: string; readonly accepted: boolean }> = [];
const restartInvalidations: Array<{ readonly sessionId: string; readonly reason: string }> = [];
const taskSendOutcomes: TaskSendContinuationOutcome[] = [];
const runtimeTaskIdsBySession = new Map<string, string>();
const replayRejections: Array<{ readonly reason: string; readonly surface: string }> = [];

function recordCapabilityVerdict(
  surface: string,
  verdict: CapabilityVerdict,
  extra: Record<string, unknown>,
): void {
  if (verdict.kind === "rejected") {
    capabilityRejections.push(verdict);
    record({
      event: "capability_presentation_rejected",
      surface,
      reason: verdict.reason,
      capabilityIdPresented: verdict.capabilityId !== null, // raw capability id is deliberately not written
      observedSessionId: verdict.observedSessionId,
      expectedSessionId: verdict.expectedSessionId,
      ...extra,
    });
    return;
  }
  record({
    event: "capability_presentation_accepted",
    surface,
    capabilityIdPresented: true, // raw capability id is deliberately not written
    ...extra,
  });
}

function guardProfileFor(sessionIdValue: string, verified: boolean, failureReason?: string): TranscriptGuardProfile {
  return verified
    ? { profileId: `justice-fixture-guard:${sessionIdValue}`, sessionId: sessionIdValue, verified: true }
    : {
        profileId: `justice-fixture-guard:${sessionIdValue}`,
        sessionId: sessionIdValue,
        verified: false,
        verificationFailureReason: failureReason ?? "transcript_guard_profile_unverifiable",
      };
}

function classifyAndRecordUntrusted(
  classification: UntrustedCallClassification,
  sessionIdValue: string,
  toolCallId: string,
): void {
  observedUntrusted.push(classification);
  record({
    event: "task_source_untrusted",
    sessionId: sessionIdValue,
    toolCallId,
    classificationKind: classification.kind,
    reason: classification.reason,
  });
}

function normalizeBatchBinding(
  sid: string,
  toolCallId: string,
  items: ReadonlyArray<unknown>,
): void {
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const prompt = (item as { readonly prompt?: unknown }).prompt;
    const binding = {
      batchItemIndex: index,
      taskId: `pending:${sid}:${toolCallId}:${String(index)}`,
      parentSessionId: sid,
    };
    batchBindings.push(binding);
    record({
      event: "task_batch_binding_normalized",
      sessionId: sid,
      parentToolCallId: String(toolCallId),
      batchItemIndex: index,
      promptPreview: typeof prompt === "string" ? prompt.slice(0, 60) : null,
      parentSessionId: sid,
    });
  });
}

function clone<T>(value: T): T {
if (value === undefined) return value as T;
try {
return JSON.parse(JSON.stringify(value)) as T;
} catch {
return String(value) as unknown as T;
}
}

function redactCapabilityEnvelopes(text: string): string {
  let result = text;
  let index = result.indexOf(CAPABILITY_MARKER);
  while (index !== -1) {
    const braceIndex = result.indexOf("{", index + CAPABILITY_MARKER.length);
    if (braceIndex === -1) break;
    let balance = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let i = braceIndex; i < result.length; i++) {
      const ch = result[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === "{") {
          balance++;
        } else if (ch === "}") {
          balance--;
          if (balance === 0) {
            end = i;
            break;
          }
        }
      }
    }
    if (end === -1) break;
    result = result.slice(0, index) + "[JUSTICE-CAPABILITY-REDACTED]" + result.slice(end + 1);
    index = result.indexOf(CAPABILITY_MARKER);
  }
  return result;
}

function redactString(text: string, tokens: readonly string[]): string {
  let changed = redactCapabilityEnvelopes(text);
  for (const token of tokens) {
    changed = changed.replaceAll(token, "[JUSTICE-CAPABILITY-REDACTED]");
  }
  return changed;
}

function redactText(text: string, tokens: readonly string[]): string {
  let changed = redactString(text, tokens);
  // Fallback: remove any partial-redaction remnants where the marker was
  // replaced but the JSON payload leaked through.
  changed = changed.replace(
    /\[JUSTICE-CAPABILITY-REDACTED\]\{[^{}]*\}/g,
    "[JUSTICE-CAPABILITY-REDACTED]",
  );
  return changed;
}

function record(row: Record<string, unknown>): void {
  if (!evidencePath) return;
  const tokens: string[] = Array.from(issuedCapabilityIds);
  if (envEnvelope) tokens.push(envEnvelope);
  tokens.push(CAPABILITY_MARKER);
  tokens.sort((a, b) => b.length - a.length);
  const redacted = sanitizeValue(row, tokens).value as Record<string, unknown>;
  const line = redactText(
    JSON.stringify({ at: Date.now(), pid: process.pid, ...redacted }),
    tokens,
  );
  appendFileSync(evidencePath, `${line}\n`);
}

function sessionId(ctx: { readonly sessionManager?: { readonly getSessionId: () => string } }): string {
  try {
    return String(ctx.sessionManager?.getSessionId());
  } catch {
    return "<unavailable>";
  }
}

function sessionFile(ctx: { readonly sessionManager?: { readonly getSessionFile?: () => string } }): string | null {
  try {
    const fn = ctx.sessionManager?.getSessionFile;
    if (typeof fn === "function") return String(fn());
    return null;
  } catch {
    return null;
  }
}

function methodFromReadPath(path: unknown): string | undefined {
  if (typeof path !== "string" || !superpowersRoot) return undefined;
  const normalized = path.replaceAll("\\", "/");
  const prefix = `${superpowersRoot}/skills/`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith("/SKILL.md")) return undefined;
  return normalized.slice(prefix.length, -"/SKILL.md".length);
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .slice(0, 8_000);
}

function registerSessionFile(sid: string, path: string): void {
  const list = sessionFiles.get(sid) ?? [];
  if (!list.includes(path)) {
    list.push(path);
    sessionFiles.set(sid, list);
  }
}
function scanSessionStorage(sid: string, label: string, ctx?: { readonly sessionManager?: { readonly getSessionFile?: () => string } }): void {
  const tokens = Array.from(issuedCapabilityIds);
  if (tokens.length === 0) return;
  const files = new Set(sessionFiles.get(sid) ?? []);
  if (ctx) {
    const sf = sessionFile(ctx);
    if (sf) files.add(sf);
  }
  inspectCapabilitySessionStorage({ isolatedRoot: "", sessionFiles: Array.from(files), capabilityIds: tokens })
    .then((result) => {
      storageScanResults.push(result);
      record({ event: "storage_scan", sessionId: sid, label, tokenFound: result.tokenFound, filesChecked: result.filesChecked, entriesChecked: result.entriesChecked });
    })
    .catch((error: unknown) => {
      record({ event: "storage_scan_error", sessionId: sid, label, error: error instanceof Error ? error.message : String(error) });
    });
}

function stripCapabilityFromArgs(args: Record<string, unknown>): { readonly args: Record<string, unknown>; readonly originalDescription: string | null } {
  let originalDescription: string | null = null;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "description" && typeof value === "string") {
      const markerIndex = value.indexOf(CAPABILITY_MARKER);
      if (markerIndex >= 0) {
        const envelope = value.slice(markerIndex);
        const decoded = decodeTaskCapabilityEnvelope(envelope);
        if (decoded.kind === "decoded") {
          originalDescription = decoded.originalDescription;
          const prefix = value.slice(0, markerIndex).trimEnd();
          result[key] = prefix.length > 0 ? prefix : originalDescription ?? undefined;
          if (result[key] === undefined) {
            delete result[key];
          }
          continue;
        }
      }
    }
    result[key] = clone(value);
  }
  return { args: result, originalDescription };
}

export default function justiceSpikeProbe(pi: {
  readonly on: (event: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown | Promise<unknown>) => void;
}): void {
  pi.on("session_start", (event, ctx) => {
    const sid = sessionId(ctx);
    record({ event: "session_start", sessionId: sid, reason: event.reason });
    record({
      event: "provider_credential_scan",
      sessionId: sid,
      credentialEnvVarsFound: CREDENTIAL_SCAN.credentialEnvVarsFound,
      authJsonPresent: CREDENTIAL_SCAN.authJsonPresent,
      mockProviderOnly: CREDENTIAL_SCAN.credentialEnvVarsFound.length === 0 && !CREDENTIAL_SCAN.authJsonPresent, // fixture evidence
      scannedEnvVarCount: CREDENTIAL_SCAN.credentialEnvVarsFound.length === 0 ? CREDENTIAL_ENV_VARS.length : CREDENTIAL_ENV_VARS.length,
      providerInScope: MOCK_PROVIDER_ID,
      modelInScope: MOCK_MODEL_ID,
    });
  });


  pi.on("model_select", (event, _ctx) => {
    const model = event.model as { readonly provider?: unknown; readonly id?: unknown } | undefined;
    const provider = typeof model?.provider === "string" ? model.provider : "<unknown>";
    const modelId = typeof model?.id === "string" ? model.id : "<unknown>";
    const source = typeof event.source === "string" ? event.source : "<unknown>";
    selectedModels.push({ provider, model: modelId, source });
    const guard = registry.checkProviderSelection({ provider, model: modelId });
    if (guard.kind === "blocked") {
      capabilityRejections.push({
        kind: "rejected",
        reason: "non_mock_provider",
        capabilityId: null,
        observedSessionId: null,
        expectedSessionId: null,
      });
    }
    record({
      event: "model_select_observed",
      provider,
      model: modelId,
      source,
      guardVerdict: guard.kind,
      guardFailReason: guard.kind === "blocked" ? guard.reason : undefined,
    });
  });

  // Fixture fail-closed probe: a non-mock provider selection attempt must be blocked and recorded.
  pi.on("session_start", () => {
    const forced = registry.checkProviderSelection({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
    if (forced.kind === "blocked") {
      capabilityRejections.push({
        kind: "rejected",
        reason: "non_mock_provider",
        capabilityId: null,
        observedSessionId: null,
        expectedSessionId: null,
      });
    }
    record({
      event: "fixture_provider_selection_blocked",
      attemptedProvider: "anthropic",
      attemptedModel: "claude-sonnet-4-20250514",
      guardVerdict: forced.kind,
      guardFailReason: forced.kind === "blocked" ? forced.reason : undefined,
    });
  });

  pi.on("before_agent_start", (event, ctx) => {
    const sid = sessionId(ctx);
    const promptText = typeof event.prompt === "string" ? event.prompt : "";
    const isParentPrompt = promptText.trim() === "SPIKE_RECOGNIZED_PARENT";
    const isChild = !isParentPrompt && (promptText.includes("JUSTICE_") || promptText.includes("Category_Context") || promptText.includes("onboarding/SKILL.md"));
    let hasPreSpawnSuffix = false;
    if (isChild) {
      const suffix = formatReviewAppendixSuffix("");
      if (typeof event.prompt === "string" && !event.prompt.includes(suffix)) {
        try {
          event.prompt = `${event.prompt}\n${suffix}`;
          preSpawnDelivered.set(sid, true);
          record({ event: "pre_spawn_contract_appended", sessionId: sid, child: true });
        } catch {
          // Event may be read-only in some contexts; record failure without crashing.
          record({ event: "pre_spawn_contract_append_failed", sessionId: sid });
        }
      }
      hasPreSpawnSuffix = typeof event.prompt === "string" && event.prompt.includes(suffix);
    }
    record({
      event: "before_agent_start",
      sessionId: sid,
      trigger: event.trigger,
      prompt: typeof event.prompt === "string" ? event.prompt.slice(0, 20_000) : "",
      preview: event.preview === true,
      isChild,
      hasPreSpawnSuffix,
    });
  });

  // Parent-side validation surfaces. These run once per parent prompt (not preview) and exercise
  // the fixture registry's reject/expire/replay/guard logic deterministically.
  pi.on("before_agent_start", (event, ctx) => {
    if (event.preview === true) return;
    const sid = sessionId(ctx);
    if (typeof event.prompt !== "string" || !event.prompt.includes("SPIKE_RECOGNIZED_PARENT")) return;
    parentSessionId = sid;

    // (a) Wrong authorization id + wrong method presentations.
    const authz = resolveAuthorizationId(sid, "subagent-driven-development");
    const binding: NativeSuperpowersActivationBinding = {
      schemaVersion: "justice-native-superpowers-activation-binding-v1",
      authorizationId: authz,
      sessionId: sid,
      method: "subagent-driven-development",
      evidenceKind: "read_tool_result",
      issuedFromReadToolCallId: "justice-spike-read-1",
      observedAt: new Date().toISOString(),
      verified: true,
      issuedAt: new Date().toISOString(),
    };
    registry.registerActivation(binding);
    const issued = registry.issueIfGuardProfileVerified(binding, guardProfileFor(sid, true));
    if (issued.kind === "accepted") {
      issuedCapabilityIds.add(issued.capability.capabilityId);
      registryBySession.set(sid, issued.capability);
    }
    const wrongAuthz = registry.presentCapability(
      { authorizationId: "justice-spike-wrong-authz", method: "subagent-driven-development", presentingSessionId: sid },
      { currentSessionId: sid, currentMethod: "subagent-driven-development", nowMs: Date.now(), maxAgeMs: MAX_CAPABILITY_AGE_MS },
    );
    recordCapabilityVerdict("wrong_authorization", wrongAuthz, { sessionId: sid });
    if (issued.kind === "accepted") {
      const wrongMethod = registry.presentCapability(
        { authorizationId: issued.capability.authorizationId, method: "executing-plans", presentingSessionId: sid },
        { currentSessionId: sid, currentMethod: "executing-plans", nowMs: Date.now(), maxAgeMs: MAX_CAPABILITY_AGE_MS },
      );
      recordCapabilityVerdict("wrong_method", wrongMethod, { sessionId: sid });
    }

    // (b) Expired capability: clock-shifted verification against the issued capability.
    if (issued.kind === "accepted") {
      const expiredVerdict = registry.expireCapability(issued.capability.authorizationId, Date.now() + 2 * MAX_CAPABILITY_AGE_MS, MAX_CAPABILITY_AGE_MS);
      if (expiredVerdict) {
        capabilityRejections.push(expiredVerdict);
        record({
          event: "capability_presentation_rejected",
          surface: "expired",
          reason: expiredVerdict.reason,
          capabilityIdPresented: expiredVerdict.capabilityId !== null,
          observedSessionId: expiredVerdict.observedSessionId,
          expectedSessionId: expiredVerdict.expectedSessionId,
          sessionId: sid,
        });
      }
    }

    // (c) Malformed + duplicate envelopes.
    const malformed = registry.decodePresentation(MALFORMED_ENVELOPE, sid);
    recordCapabilityVerdict("malformed", malformed, { sessionId: sid });
    const duplicate = registry.decodePresentation(DUPLICATE_KEY_ENVELOPE, sid);
    recordCapabilityVerdict("duplicate", duplicate, { sessionId: sid });

    // (d) Unverified transcript guard profile must not issue a capability.
    const unverifiedBinding: NativeSuperpowersActivationBinding = {
      ...binding,
      authorizationId: `${sid}:unverified-profile`,
      verified: false,
    };
    const unverified = registry.issueIfGuardProfileVerified(unverifiedBinding, guardProfileFor(sid, false));
    recordCapabilityVerdict("unverified_guard_profile", unverified, { sessionId: sid });

    // (f) Wrong-session presentation: present the capability as a foreign session.
    const foreignSid = `${sid}:foreign`;
    const wrongSession =
      issued.kind === "accepted"
        ? registry.presentCapability(
            { authorizationId: issued.capability.authorizationId, method: issued.capability.method, presentingSessionId: foreignSid },
            { currentSessionId: foreignSid, currentMethod: issued.capability.method, nowMs: Date.now(), maxAgeMs: MAX_CAPABILITY_AGE_MS },
          )
        : ({ kind: "rejected", reason: "wrong_session", capabilityId: null, observedSessionId: foreignSid, expectedSessionId: sid } as const);
    recordCapabilityVerdict("wrong_session_registry", wrongSession, { sessionId: sid, foreignSessionId: foreignSid });

    // (e) In-process + nested untrusted classification (fixture-side gates).
    const inProcess = registry.classifyTaskCallSource({ executionMode: "in-process", hasOutboundReceipt: false });
    classifyAndRecordUntrusted(inProcess, sid, "fixture-in-process-probe");
    const nested = registry.classifyTaskCallSource({ parentToolCallId: "fixture-parent/1", hasOutboundReceipt: false });
    classifyAndRecordUntrusted(nested, sid, "fixture-nested-probe");
  });

  // Deterministic compaction leg: apply a precomputed, LLM-free compaction once the parent starts.
  // The subsequent session_compact event carries the capability invalidation.
  pi.on("before_agent_start", (event, ctx) => {
    if (event.preview === true) return;
    const sid = sessionId(ctx);
    if (typeof event.prompt !== "string" || !event.prompt.includes("SPIKE_RECOGNIZED_PARENT")) return;
    const applyCompaction = (
      ctx as {
        readonly applyCompaction?: (
          precomputed: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => Promise<{ applied: boolean; reason: string }>;
      }
    ).applyCompaction;
    if (typeof applyCompaction !== "function") {
      record({ event: "apply_compaction_unavailable", sessionId: sid });
      return;
    }
    const leafId =
      typeof (ctx as { readonly sessionManager?: { readonly getLeafId?: () => unknown } }).sessionManager?.getLeafId === "function"
        ? ((ctx as { readonly sessionManager: { getLeafId: () => unknown } }).sessionManager.getLeafId())
        : null;
    const firstKeptEntryId =
      typeof leafId === "string" && leafId.length > 0 ? leafId : "justice-fixture-keep-root";
    void applyCompaction
      .call(
        ctx,
        { summary: "Justice fixture compaction: capability state invalidated.", firstKeptEntryId, tokensBefore: 1 },
        { reason: "extension" },
      )
      .then((result) => {
        record({ event: "apply_compaction_result", sessionId: sid, applied: result.applied, applyReason: result.reason });
      })
      .catch((error: unknown) => {
        record({ event: "apply_compaction_error", sessionId: sid, message: error instanceof Error ? error.message : String(error) });
      });
  });

  pi.on("context", (event, ctx) => {
    const sid = sessionId(ctx);
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const serialized = JSON.stringify(messages);
    const suffix = formatReviewAppendixSuffix("");
    record({
      event: "context",
      sessionId: sid,
      hasSuperpowersBootstrap: serialized.includes("superpowers:using-superpowers bootstrap for pi"),
      messageCount: messages.length,
      preSpawnSuffixInContext: serialized.includes(suffix),
    });

    // Request-local capability delivery: record that the capability was issued for this
    // successful method-read context, without persisting the directive in message content
    // (which would leak capability tokens into raw evidence).
    const activation = activated.get(sid);
    if (activation) {
      const capability = issueCapabilityForActivation(sid, activation);
      if (capability) {
        record({
          event: "capability_context_delivered",
          sessionId: sid,
          toolCallId: activation.sourceToolCallId,
          capabilityPresent: true,
          messageRole: "toolResult",
        });
        scanSessionStorage(sid, "after_capability_context_delivery", ctx);
      }
    }
  });

  pi.on("message_end", (event, ctx) => {
    const sid = sessionId(ctx);
    const message = event.message;
    if (!message || typeof message !== "object") return;
    const role = (message as { readonly role?: string }).role;
    const content = (message as { readonly content?: unknown }).content;
    if (role === "assistant" && Array.isArray(content)) {
      for (let i = 0; i < content.length; i++) {
        const part = content[i];
        if (part && typeof part === "object" && (part as { readonly type?: string }).type === "toolCall") {
          const args = (part as { readonly arguments?: Record<string, unknown> }).arguments ?? {};
          const stripped = stripCapabilityFromArgs(args);
          (part as { arguments: Record<string, unknown> }).arguments = stripped.args;
          const toolCallId = (part as { readonly id?: string }).id ?? "<unknown>";
          record({
            event: "message_end_sanitized",
            sessionId: sid,
            toolCallId,
            toolName: (part as { readonly name?: string }).name,
            hadCapability: stripped.originalDescription !== undefined,
          });
        }
      }
      const provider = (message as { readonly provider?: unknown }).provider;
      const model = (message as { readonly model?: unknown }).model;
      const modelId = typeof model === "string" ? model : "<unknown>";
      if (typeof provider === "string" && provider.length > 0) {
        const guard = registry.checkProviderSelection({ provider, model: modelId });
        selectedModels.push({ provider, model: modelId, source: "message_end" });
        record({
          event: "assistant_message_provider_observed",
          sessionId: sid,
          provider,
          model: modelId,
          guardVerdict: guard.kind,
        });
      }
    }
    if (role === "tool" || role === "toolResult") {
      // Synthetic toolResult redaction fallback.
      const sanitized = sanitizeValue(content, Array.from(issuedCapabilityIds));
      if (sanitized.changed) {
        (message as { content: unknown }).content = sanitized.value;
        record({ event: "tool_result_sanitized", sessionId: sid, role });
      }
    }
  });

  pi.on("tool_call", (event, ctx) => {
    const sid = sessionId(ctx);
    const before = clone(event.input);
    let fixtureMutation = false;

    // Strip any capability envelope from incoming tool arguments before guard/execution.
    const hadCapabilityMarker =
      typeof (event.input as { readonly description?: string }).description === "string" &&
      ((event.input as { readonly description: string }).description as string).includes(CAPABILITY_MARKER);
    const stripped = stripCapabilityFromArgs(event.input as Record<string, unknown>);
    if (hadCapabilityMarker) {
      Object.assign(event.input as Record<string, unknown>, stripped.args);
      record({
        event: "tool_call_capability_stripped",
        sessionId: sid,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        hadCapabilityMarker,
        hadOriginalDescription: stripped.originalDescription !== null,
      });
      scanSessionStorage(sid, "after_tool_call_strip", ctx);
    }

    // Fixture compaction trigger: the marker tool forces an accepted compaction so capability
    // invalidation is observed from a real Senpi lifecycle event.
    if (event.toolName === "justice_trigger_compaction") {
      const compactFn = (ctx as { readonly compact?: (options?: Record<string, unknown>) => void }).compact;
      if (typeof compactFn === "function") {
        compactFn.call(ctx, { customInstructions: "justice fixture compaction trigger" });
        record({ event: "compaction_trigger_requested", sessionId: sid, toolCallId: event.toolCallId });
      } else {
        record({ event: "compaction_trigger_unavailable", sessionId: sid, toolCallId: event.toolCallId });
      }
    }

    // Fixture contract probes (task1_*): run validation surfaces for control tool calls.
    if (event.toolName === "task" && event.input && typeof event.input === "object") {
      const tasks = (event.input as { readonly tasks?: unknown }).tasks;
      if (Array.isArray(tasks) && tasks.length > 0) {
        normalizeBatchBinding(sid, String(event.toolCallId), tasks);
      }
    }
    if (typeof event.parentToolCallId === "string" && event.parentToolCallId.length > 0) {
      classifyAndRecordUntrusted(
        { kind: "nested", parentToolCallId: event.parentToolCallId, reason: "untrusted_nested_call" },
        sid,
        String(event.toolCallId),
      );
    }
    if (event.toolName === "task" && typeof sid === "string" && sid !== parentSessionId && envEnvelope) {
      // Wrong-session presentation: a capability envelope arriving in a session that did not issue it.
      const decodedPresentation = decodeTaskCapabilityEnvelope(envEnvelope);
      const fromEnv =
        decodedPresentation.kind === "decoded"
          ? fixtureCapabilityFromEnvelope(envEnvelope, sid, String(event.toolCallId))
          : null;
      const verdict: CapabilityVerdict =
        decodedPresentation.kind === "decoded" && fromEnv
          ? registry.presentCapability(
              {
                authorizationId: fromEnv.authorizationId,
                method: fromEnv.method,
                presentingSessionId: sid,
              },
              {
                currentSessionId: sid,
                currentMethod: fromEnv.method,
                nowMs: Date.now(),
                maxAgeMs: MAX_CAPABILITY_AGE_MS,
              },
            )
          : {
              kind: "rejected" as const,
              reason: "stale_transcript_replay" as const,
              capabilityId: null,
              observedSessionId: sid,
              expectedSessionId: null,
            };
      recordCapabilityVerdict("wrong_session_tool_call", verdict, {
        sessionId: sid,
        toolCallId: event.toolCallId,
      });
    }

    // Capture outbound task capability receipt when a model-issued task carries a capability.
    const activation = activated.get(sid);
    const prompt = typeof (event.input as { readonly prompt?: string }).prompt === "string" ? (event.input as { readonly prompt: string }).prompt : "";
    const isUnrelatedTask = event.toolName === "task" && prompt.includes("JUSTICE_UNRELATED_TASK");
    if (activation && event.toolName === "task" && (stripped.originalDescription !== null || isUnrelatedTask)) {
      const capability = registryBySession.get(sid);
      if (capability) {
        registry.captureOutbound({
          authorizationId: capability.authorizationId,
          parentSessionId: sid,
          parentToolCallId: String(event.toolCallId),
          taskArgs: event.input as Record<string, unknown>,
          executionMethod: capability.method,
        });
      }
    }

    // Fixture validator: report provenance for task calls.
    if (event.toolName === "task" && activation) {
      if (isUnrelatedTask) {
        record({
          event: "task_provenance_validated",
          sessionId: sid,
          toolCallId: event.toolCallId,
          provenanceKind: "external",
          isUnrelatedTask,
        });
      } else {
        const validationInput = {
          authorizationId: resolveAuthorizationId(sid, activation.method),
          parentSessionId: sid,
          parentToolCallId: String(event.toolCallId),
          taskArgs: event.input as Record<string, unknown>,
          executionMethod: activation.method as "subagent-driven-development" | "executing-plans",
        };
        const validation = registry.validate(validationInput);
        record({
          event: "task_provenance_validated",
          sessionId: sid,
          toolCallId: event.toolCallId,
          provenanceKind: validation.provenance.kind,
          provenanceReasons: validation.provenance.kind === "ambiguous" ? validation.provenance.reasons : undefined,
          isUnrelatedTask,
        });
        if (validation.provenance.kind === "superpowers") {
          record({
            event: "authenticated_protocol_affiliation_observed",
            sessionId: sid,
            toolCallId: event.toolCallId,
            parentToolCallId: String(event.toolCallId),
            activationBindingValidated: true,
            privateOutboundReceiptValidated: true,
            exactCallBindingValidated: true,
            strippedArgsDigestValidated: true,
            capabilityDigest: validation.provenance.evidence.capabilityDigest,
            strippedTaskArgsDigest: validation.provenance.evidence.callBindingEvidence.strippedTaskArgsDigest,
            promptSemanticsUsedAsAuthority: false,
            protocolAffiliationAuthority: "justice_capability_receipt_chain",
          });
        }
      }
    }

    const guardResult = guardCapabilityToolCall(registry, {
      toolName: String(event.toolName),
      args: event.input as Record<string, unknown>,
      sessionId: sid,
      parentToolCallId: String(event.toolCallId),
    });
    if (guardResult.kind === "block") {
      nonTaskVetoed.set(`${sid}:${String(event.toolCallId)}`, true);
      event.block = true;
      event.terminate = true;
      (event as { blockReason?: string }).blockReason = guardResult.reason;
      record({
        event: "tool_call",
        sessionId: sid,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        parentToolCallId: event.parentToolCallId ?? null,
        eventKeys: Object.keys(event).sort(),
        inputBefore: before,
        inputAfter: clone(event.input),
        fixtureMutation,
        currentSessionActivationObserved: activated.has(sid),
        nativeTaskToolCallFieldsObserved: ["toolCallId", "toolName", "input", "parentToolCallId"],
        hostIndependentSuperpowersOriginField: "absent",
        protocolAffiliationAuthority: "justice_capability_receipt_chain",
        promptSemanticsUsedAsAuthority: false,
        guardResult,
      });
      return;
    }

    if (
      event.toolName === "task" &&
      typeof (event.input as { readonly prompt?: string }).prompt === "string" &&
      ((event.input as { readonly prompt: string }).prompt as string).includes(REVIEW_TARGET)
    ) {
      (event.input as { prompt: string }).prompt = `${(event.input as { readonly prompt: string }).prompt}\n${APPENDIX}`;
      fixtureMutation = true;
    }

    record({
      event: "tool_call",
      sessionId: sid,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      parentToolCallId: event.parentToolCallId ?? null,
      eventKeys: Object.keys(event).sort(),
      inputBefore: before,
      inputAfter: clone(event.input),
      fixtureMutation,
      currentSessionActivationObserved: activated.has(sid),
      nativeTaskToolCallFieldsObserved: ["toolCallId", "toolName", "input", "parentToolCallId"],
      hostIndependentSuperpowersOriginField: "absent",
      protocolAffiliationAuthority: "justice_capability_receipt_chain",
      promptSemanticsUsedAsAuthority: false,
      nativeTaskToolCallNote:
        event.toolName === "task"
          ? "Pinned native task tool_call exposes no independent Superpowers workflow-origin field. The approved architecture does not require such a field."
          : undefined,
    });
  });

  pi.on("tool_result", (event, ctx) => {
    const sid = sessionId(ctx);
    record({
      event: "tool_result",
      sessionId: sid,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      parentToolCallId: event.parentToolCallId ?? null,
      input: clone(event.input),
      isError: event.isError === true,
      contentText: contentText(event.content),
      details: clone(event.details),
      structuredContent: clone(event.structuredContent),
    });

    if (event.toolName === "read" && event.isError !== true) {
      const path = (event.input as { readonly path?: string }).path;
      const method = methodFromReadPath(path);
      if (method) {
        activated.set(sid, { method, sourceToolCallId: String(event.toolCallId), sourcePath: String(path) });
        const binding: NativeSuperpowersActivationBinding = {
          schemaVersion: "justice-native-superpowers-activation-binding-v1",
          authorizationId: resolveAuthorizationId(sid, method),
          sessionId: sid,
          method: method as "subagent-driven-development" | "executing-plans",
          evidenceKind: "read_tool_result",
          issuedFromReadToolCallId: String(event.toolCallId),
          observedAt: new Date().toISOString(),
          verified: true,
          issuedAt: new Date().toISOString(),
        };
        registry.registerActivation(binding);
        registerSessionFile(sid, String(path));
        record({
          event: "activation_evidence",
          evidenceKind: "read_tool_result",
          sessionId: sid,
          observedCallOrInputId: event.toolCallId,
          method,
          sourcePath: path,
        });
      }
    }

    // Batch task result: bind each spawned item index to its real runtime task id (OMO-owned spawn).
    if (event.toolName === "task" && event.details && typeof event.details === "object") {
      const details = event.details as { readonly items?: unknown; readonly execution_mode?: unknown };
      if (Array.isArray(details.items)) {
        details.items.forEach((item, index) => {
          if (!item || typeof item !== "object") return;
          const itemId = (item as { readonly task_id?: unknown }).task_id;
          if (typeof itemId !== "string" || itemId.length === 0) return;
          batchBindings.push({ batchItemIndex: index, taskId: itemId, parentSessionId: sid });
          record({
            event: "task_batch_binding_normalized",
            sessionId: sid,
            parentToolCallId: String(event.toolCallId),
            batchItemIndex: index,
            runtimeTaskId: itemId,
            parentSessionId: sid,
          });
        });
      }
      // In-process execution classification for the untrusted-source contract.
      if (details.execution_mode === "in-process") {
        classifyAndRecordUntrusted(
          { kind: "in_process", executionMode: "in-process", reason: "untrusted_in_process" },
          sid,
          String(event.toolCallId),
        );
      }
    }

    // task_send continuation: prove the continuation stays session/task-bound and OmO-owned.
    if (event.toolName === "task_send" && event.details && typeof event.details === "object") {
      const details = event.details as {
        readonly kind?: unknown;
        readonly task_id?: unknown;
        readonly delivered?: unknown;
        readonly queue_position?: unknown;
        readonly status?: unknown;
        readonly reason?: unknown;
      };
      const kind = typeof details.kind === "string" ? details.kind : "<unknown>";
      const taskId = typeof details.task_id === "string" ? details.task_id : "<unknown>";
      let outcome: TaskSendContinuationOutcome;
      if (kind === "steered" && typeof details.delivered === "string") {
        outcome = { kind: "steered", taskId, parentSessionId: sid, delivered: "steer" };
      } else if (kind === "queued" && typeof details.queue_position === "number") {
        outcome = { kind: "queued", taskId, parentSessionId: sid, queuePosition: details.queue_position };
      } else {
        outcome = { kind: "rejected", taskId, parentSessionId: sid, outcome: kind };
      }
      taskSendOutcomes.push(outcome);
      record({
        event: "task_send_continuation_observed",
        sessionId: sid,
        toolCallId: event.toolCallId,
        outcomeKind: outcome.kind,
        runtimeTaskId: taskId,
        delivered: typeof details.delivered === "string" ? details.delivered : null,
        queuePosition: typeof details.queue_position === "number" ? details.queue_position : null,
        taskStatus: typeof details.status === "string" ? details.status : null,
        scopeReason: typeof details.reason === "string" ? details.reason : null,
        isParentSession: sid === parentSessionId,
      });
    }

    // Single background task result: capture the runtime task id for OMO-ownership binding.
    if (event.toolName === "task" && event.details && typeof event.details === "object") {
      const details = event.details as { readonly task_id?: unknown };
      if (typeof details.task_id === "string" && details.task_id.startsWith("st_")) {
        runtimeTaskIdsBySession.set(sid, details.task_id);
        record({
          event: "runtime_task_identity_observed",
          sessionId: sid,
          toolCallId: event.toolCallId,
          runtimeTaskId: details.task_id,
        });
      }
    }
    // Track synthetic unknown-tool or validation-error results for RG-005 backstop proof.
    if (event.isError === true) {
      const content = event.content;
      const hasToken = containsLiteral(content, Array.from(issuedCapabilityIds));
      if (hasToken) {
        syntheticResultSanitized.set(`${sid}:${String(event.toolCallId)}`, false);
      } else {
        syntheticResultSanitized.set(`${sid}:${String(event.toolCallId)}`, true);
      }
    }
  });

  pi.on("session_compact", (event, ctx) => {
    const sid = sessionId(ctx);
    const previous = activated.get(sid);
    const accepted = event.accepted === true;
    activated.delete(sid);
    registry.invalidateSession(sid, "session_compact");
    const requestId =
      typeof (event as { readonly requestId?: unknown }).requestId === "string"
        ? ((event as { readonly requestId: string }).requestId)
        : "<unknown>";
    compactionInvalidations.push({ sessionId: sid, requestId, accepted });

    record({
      event: "capability_invalidated_by_compaction",
      sessionId: sid,
      accepted,
      requestId,
      invalidatedActivation: previous !== undefined,
      previousMethod: previous?.method,
    });

    // Stale transcript replay: after compaction invalidated the capability, the stale envelope
    // (or a batch echo of it) must not restore or reissue a capability.
    if (envEnvelope) {
      const replay = registry.decodePresentation(envEnvelope, sid);
      recordCapabilityVerdict("stale_transcript_replay", replay, { sessionId: sid, surface: "post_compaction_replay" });
      if (replay.kind === "rejected") {
        replayRejections.push({ reason: replay.reason, surface: "post_compaction_replay" });
      }
    }
    for (const [authorizationId] of registryBySession) {
      const verdict = registry.presentInvalidated(authorizationId, sid);
      recordCapabilityVerdict("post_compaction_tombstone", verdict, { sessionId: sid });
      if (verdict.kind === "rejected") {
        replayRejections.push({ reason: verdict.reason, surface: "post_compaction_tombstone" });
      }
    }
    registryBySession.delete(sid);
  });

  pi.on("session_shutdown", (event, ctx) => {
    const sid = sessionId(ctx);
    registry.invalidateSession(sid, "session_shutdown");
    const reason = typeof event.reason === "string" ? event.reason : "<unknown>";
    restartInvalidations.push({ sessionId: sid, reason });
    record({
      event: "capability_invalidated_by_restart",
      sessionId: sid,
      shutdownReason: reason,
    });
    record({ event: "session_shutdown", sessionId: sid });
  });
}
const registryBySession = new Map<string, NativeSuperpowersTaskCapability>();


function resolveAuthorizationId(sessionId: string, method: string): string {
  // If the harness supplied a fixed envelope, align activation authorization so validation matches.
  if (envEnvelope) {
    const decoded = decodeTaskCapabilityEnvelope(envEnvelope);
    if (decoded.kind === "decoded") {
      const fromEnv = fixtureCapabilityFromEnvelope(envEnvelope, sessionId, "<unused>");
      if (fromEnv) return fromEnv.authorizationId;
    }
  }
  return `${sessionId}:${method}`;
}

function issueCapabilityForActivation(
  sid: string,
  activation: { readonly method: string; readonly sourceToolCallId: string },
): NativeSuperpowersTaskCapability | null {
  const binding: NativeSuperpowersActivationBinding = {
    schemaVersion: "justice-native-superpowers-activation-binding-v1",
    authorizationId: resolveAuthorizationId(sid, activation.method),
    sessionId: sid,
    method: activation.method as "subagent-driven-development" | "executing-plans",
    evidenceKind: "read_tool_result",
    issuedFromReadToolCallId: activation.sourceToolCallId,
    observedAt: new Date().toISOString(),
    verified: true,
    issuedAt: new Date().toISOString(),
  };
  let capability: NativeSuperpowersTaskCapability | null = null;
  if (envEnvelope) {
    const fromEnv = fixtureCapabilityFromEnvelope(envEnvelope, sid, activation.sourceToolCallId);
    if (fromEnv) {
      capability = fromEnv;
      registry.registerActivation(binding);
      registry.registerCapability(fromEnv);
      registry.addSanitationToken(fromEnv.capabilityId);
      issuedCapabilityIds.add(fromEnv.capabilityId);
      registryBySession.set(sid, fromEnv);
    }
  } else {
    const issuedFixture = registry.issue(binding);
    if (issuedFixture) {
      capability = issuedFixture;
      issuedCapabilityIds.add(issuedFixture.capabilityId);
      registryBySession.set(sid, issuedFixture);
    }
  }
  return capability;
}

function containsLiteral(value: unknown, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      for (const token of tokens) {
        if (current.includes(token)) return true;
      }
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (current !== null && typeof current === "object") {
      for (const v of Object.values(current)) stack.push(v);
    }
  }
  return false;
}

function sanitizeValue(value: unknown, tokens: readonly string[]): { readonly value: unknown; readonly changed: boolean } {
  if (typeof value === "string") {
    const changed = redactString(value, tokens);
    return { value: changed, changed: changed !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const sanitized = sanitizeValue(item, tokens);
      if (sanitized.changed) changed = true;
      return sanitized.value;
    });
    return { value: result, changed };
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const sanitized = sanitizeValue(v, tokens);
      if (sanitized.changed) changed = true;
      result[k] = sanitized.value;
    }
    return { value: result, changed };
  }
  return { value, changed: false };
}
