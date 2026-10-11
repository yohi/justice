// Fixture-only capability protocol probe. No production API. No Justice source imports.

export type SuperpowersExecutionMethod = "subagent-driven-development" | "executing-plans";

export type NativeSuperpowersTaskCapability = {
  readonly schemaVersion: "justice-native-superpowers-task-capability-v1";
  readonly capabilityId: string;
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly method: SuperpowersExecutionMethod;
  readonly issuedFromReadToolCallId: string;
  readonly issuedAt: string;
};

export type NativeSuperpowersActivationBinding = {
  readonly schemaVersion: "justice-native-superpowers-activation-binding-v1";
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly method: SuperpowersExecutionMethod;
  readonly evidenceKind: "read_tool_result";
  readonly issuedFromReadToolCallId: string;
  readonly observedAt: string;
};

/**
 * Fixture-private observation view of an activation. The canonical binding above
 * carries only the approved Design/Plan fields; verification state and issuance
 * timestamps are fixture observation concerns and live here.
 */
export type FixtureActivationObservation = NativeSuperpowersActivationBinding & {
  readonly verified: boolean;
  readonly issuedAt: string;
};

export type NativeSuperpowersCallBindingEvidence = {
  readonly schemaVersion: "justice-native-superpowers-call-binding-v1";
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly batchItemIndex?: number;
  readonly capabilityDigest: string;
  readonly strippedTaskArgsDigest: string;
  readonly observedAt: string;
};

export type NativeSuperpowersProvenanceEvidence = {
  readonly schemaVersion: "justice-native-superpowers-provenance-evidence-v1";
  readonly protocolId: "justice-native-superpowers-task-capability-v1";
  readonly capabilityDigest: string;
  readonly authorizationId: string;
  readonly method: SuperpowersExecutionMethod;
  readonly issuedFromReadToolCallId: string;
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly batchItemIndex?: number;
  readonly activationEvidence: NativeSuperpowersActivationBinding;
  readonly callBindingEvidence: NativeSuperpowersCallBindingEvidence;
  readonly observedAt: string;
};

export type NativeSuperpowersProvenanceInput = {
  readonly authorizationId: string;
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly batchItemIndex?: number;
  readonly taskArgs: Readonly<Record<string, unknown>>;
  readonly executionMethod: SuperpowersExecutionMethod;
};

export type TaskRoutingProvenance =
  | { readonly kind: "superpowers"; readonly evidence: NativeSuperpowersProvenanceEvidence }
  | { readonly kind: "external" }
  | { readonly kind: "ambiguous"; readonly reasons: readonly [string, ...string[]] };

export type CapabilityEnvelopeDecodeResult =
  | { readonly kind: "absent" }
  | { readonly kind: "decoded"; readonly capabilityId: string; readonly originalDescription: string | null }
  | { readonly kind: "invalid"; readonly reason: "malformed_capability" | "duplicate_capability" };

export type NativeCapabilityValidationResult = {
  readonly provenance: TaskRoutingProvenance;
  readonly restoredDescription: string | null;
  readonly stripRequired: boolean;
};

export type NativeCapabilityOutboundReceipt = {
  readonly schemaVersion: "justice-capability-outbound-receipt-v1";
  readonly authorizationId: string;
  readonly method: SuperpowersExecutionMethod;
  readonly issuedFromReadToolCallId: string;
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly batchItemIndex?: number;
  readonly capabilityDigest: string;
  readonly strippedTaskArgsDigest: string;
};

export type NativeCapabilityOutboundRecord =
  | { readonly kind: "captured"; readonly receipt: NativeCapabilityOutboundReceipt }
  | {
      readonly kind: "rejected";
      readonly parentSessionId: string;
      readonly parentToolCallId: string;
      readonly batchItemIndex?: number;
      readonly strippedTaskArgsDigest: string;
      readonly reasons: readonly [string, ...string[]];
    };

export type NativeCapabilityToolCallGuardInput = {
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly sessionId: string;
  readonly parentToolCallId: string;
};

export type NativeCapabilityToolCallGuardResult =
  | { readonly kind: "continue" }
  | { readonly kind: "block"; readonly reason: "justice_capability_token_leak"; readonly terminate: true };

export type CapabilityValidationContext = {
  readonly currentSessionId: string;
  readonly currentMethod: SuperpowersExecutionMethod;
  readonly nowMs: number;
  readonly maxAgeMs: number;
};

export type CapabilityRejectionKind =
  | "wrong_session"
  | "authorization_mismatch"
  | "method_mismatch"
  | "expired"
  | "malformed_capability"
  | "duplicate_capability"
  | "stale_transcript_replay"
  | "unverified_guard_profile"
  | "non_mock_provider"
  | "untrusted_in_process"
  | "untrusted_nested_call";

export type CapabilityRejectionResult = {
  readonly kind: "rejected";
  readonly reason: CapabilityRejectionKind;
  readonly capabilityId: string | null;
  readonly observedSessionId: string | null;
  readonly expectedSessionId: string | null;
};

export type CapabilityAcceptanceResult = {
  readonly kind: "accepted";
  readonly capability: NativeSuperpowersTaskCapability;
};

export type CapabilityVerdict = CapabilityAcceptanceResult | CapabilityRejectionResult;

export type TranscriptGuardProfile = {
  readonly profileId: string;
  readonly sessionId: string;
  readonly verified: boolean;
  readonly verificationFailureReason?: string;
};

export type ProviderSelectionGuardInput = {
  readonly provider: string;
  readonly model: string;
};

export type ProviderSelectionGuardResult =
  | { readonly kind: "allowed"; readonly provider: "omo-mock"; readonly model: string }
  | { readonly kind: "blocked"; readonly provider: string; readonly model: string; readonly reason: "non_mock_provider" };

export const MOCK_PROVIDER_ID = "omo-mock";
export const MOCK_MODEL_ID = "mock-1";

/**
 * Prompt sentinel marking the deterministic capability-bearing task call whose
 * processing the fixture fails after message_end capture/sanitation, proving
 * the runtime's same-role minimal error fallback path.
 */
export const FALLBACK_PROBE_SENTINEL = "JUSTICE_FALLBACK_PROBE";

export type ProviderCredentialScan = {
  readonly credentialEnvVarsFound: readonly string[];
  readonly authJsonPresent: boolean;
  readonly mockProviderOnly: boolean;
};

export const CREDENTIAL_ENV_VARS: readonly string[] = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
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

export type TaskSendContinuationOutcome =
  | { readonly kind: "steered"; readonly taskId: string; readonly parentSessionId: string; readonly delivered: "steer" }
  | { readonly kind: "queued"; readonly taskId: string; readonly parentSessionId: string; readonly queuePosition: number }
  | { readonly kind: "rejected"; readonly taskId: string; readonly parentSessionId: string | null; readonly outcome: string };

export type UntrustedCallClassification =
  | { readonly kind: "in_process"; readonly executionMode: "in-process"; readonly reason: "untrusted_in_process" }
  | { readonly kind: "nested"; readonly parentToolCallId: string; readonly reason: "untrusted_nested_call" }
  | { readonly kind: "trusted_pending_receipt"; readonly reason: "trusted_pending_receipt" };

const CAPABILITY_MARKER = "[[justice-capability-v1]]";
const CAPABILITY_ID_REGEX = /^[A-Za-z0-9_-]{43}$/;

export function encodeCapabilityId(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new TypeError("capability_byte_length");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  let i = 0;
  const cloned = new Uint8Array(bytes);
  while (i < 32) {
    const b1 = cloned[i++];
    const b2 = i < 32 ? cloned[i++] : 0;
    const b3 = i < 32 ? cloned[i++] : 0;
    result += alphabet[b1 >> 2];
    result += alphabet[((b1 & 0x03) << 4) | (b2 >> 4)];
    result += alphabet[((b2 & 0x0f) << 2) | (b3 >> 6)];
    result += alphabet[b3 & 0x3f];
  }
  // Drop padding (two chars for 32 bytes: 32*8/6 = 42.666 → 43 chars, one pad byte).
  return result.slice(0, 43);
}

function sha256Digest(input: string): string {
  // Fixture-only: Bun provides crypto.subtle. Synchronous wrapper for convenience.
  const bytes = new TextEncoder().encode(input);
  const digest = new Uint8Array(32);
  // Placeholder: in fixture runtime we use a stable deterministic digest for non-cryptographic fixture identities.
  for (let i = 0; i < bytes.length; i++) {
    digest[i % 32] ^= bytes[i];
    digest[(i + 7) % 32] = (digest[(i + 7) % 32] + bytes[i] + 31) % 256;
  }
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function capabilityDigest(capability: NativeSuperpowersTaskCapability): string {
  const payload = `${capability.schemaVersion}:${capability.capabilityId}:${capability.authorizationId}:${capability.sessionId}:${capability.method}:${capability.issuedFromReadToolCallId}`;
  return `sha256:${sha256Digest(payload)}`;
}

export function strippedArgsDigest(args: Readonly<Record<string, unknown>>): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return `sha256:${sha256Digest(canonical)}`;
}

export function encodeTaskCapabilityEnvelope(capabilityId: string, originalDescription: string | null): string {
  if (!CAPABILITY_ID_REGEX.test(capabilityId)) {
    throw new TypeError("capability_id_encoding");
  }
  const payload = { capabilityId, originalDescription };
  const json = JSON.stringify(payload);
  if (new TextEncoder().encode(json).length > 8_192 - CAPABILITY_MARKER.length) {
    throw new TypeError("capability_envelope_too_large");
  }
  return `${CAPABILITY_MARKER}${json}`;
}

export function decodeTaskCapabilityEnvelope(description: unknown): CapabilityEnvelopeDecodeResult {
  if (typeof description !== "string") return { kind: "absent" };
  if (!description.startsWith(CAPABILITY_MARKER)) return { kind: "absent" };
  const jsonPart = description.slice(CAPABILITY_MARKER.length);
  if (jsonPart.length === 0) return { kind: "invalid", reason: "malformed_capability" };
  try {
    // Duplicate-key detection: JS JSON parsers dedupe keys before invoking the reviver,
    // so the reviver never sees repeats. Scan the raw JSON text for repeated top-level keys.
    if (Array.from(jsonPart.matchAll(/"capabilityId"\s*:/gu)).length > 1) {
      return { kind: "invalid", reason: "duplicate_capability" };
    }
    const parsed = JSON.parse(jsonPart) as { capabilityId?: unknown; originalDescription?: unknown };
    if (typeof parsed.capabilityId !== "string" || !CAPABILITY_ID_REGEX.test(parsed.capabilityId)) {
      return { kind: "invalid", reason: "malformed_capability" };
    }
    if (parsed.originalDescription !== undefined && parsed.originalDescription !== null && typeof parsed.originalDescription !== "string") {
      return { kind: "invalid", reason: "malformed_capability" };
    }
    return { kind: "decoded", capabilityId: parsed.capabilityId, originalDescription: parsed.originalDescription ?? null };
  } catch {
    return { kind: "invalid", reason: "malformed_capability" };
  }
}

export function issueFixtureCapability(read: {
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly method: SuperpowersExecutionMethod;
  readonly authorizationId: string;
}): NativeSuperpowersTaskCapability {
  return {
    schemaVersion: "justice-native-superpowers-task-capability-v1",
    capabilityId: encodeCapabilityId(crypto.getRandomValues(new Uint8Array(32))),
    authorizationId: read.authorizationId,
    sessionId: read.sessionId,
    method: read.method,
    issuedFromReadToolCallId: read.toolCallId,
    issuedAt: new Date().toISOString(),
  };
}

export function fixtureCapabilityFromEnvelope(
  envelope: string,
  sessionId: string,
  toolCallId: string,
): NativeSuperpowersTaskCapability | null {
  const decoded = decodeTaskCapabilityEnvelope(envelope);
  if (decoded.kind !== "decoded") return null;
  return {
    schemaVersion: "justice-native-superpowers-task-capability-v1",
    capabilityId: decoded.capabilityId,
    authorizationId: `${sessionId}:subagent-driven-development`,
    sessionId,
    method: "subagent-driven-development",
    issuedFromReadToolCallId: toolCallId,
    issuedAt: new Date().toISOString(),
  };
}

export class FixtureCapabilityRegistry {
  readonly #capabilities = new Map<string, NativeSuperpowersTaskCapability>();
  readonly #outbound = new Map<string, NativeCapabilityOutboundRecord>();
  readonly #nonTaskVetoes = new Map<string, Set<string>>();
  readonly #sanitationTokens = new Set<string>();
  readonly #authorizations = new Map<string, NativeSuperpowersActivationBinding>();
  readonly #invalidated = new Map<string, string>();

  registerActivation(binding: NativeSuperpowersActivationBinding): void {
    this.#authorizations.set(binding.authorizationId, binding);
  }

  issue(activation: NativeSuperpowersActivationBinding): NativeSuperpowersTaskCapability | null {
    if (!this.#authorizations.has(activation.authorizationId)) return null;
    const capability: NativeSuperpowersTaskCapability = {
      schemaVersion: "justice-native-superpowers-task-capability-v1",
      capabilityId: encodeCapabilityId(crypto.getRandomValues(new Uint8Array(32))),
      authorizationId: activation.authorizationId,
      sessionId: activation.sessionId,
      method: activation.method,
      issuedFromReadToolCallId: activation.issuedFromReadToolCallId,
      issuedAt: new Date().toISOString(),
    };
    this.#capabilities.set(capability.capabilityId, capability);
    // The presentation/registry surface keys by authorizationId; index both so either resolves.
    this.#capabilities.set(capability.authorizationId, capability);
    this.#sanitationTokens.add(capability.capabilityId);
    return capability;
  }

  registerCapability(capability: NativeSuperpowersTaskCapability): void {
    this.#capabilities.set(capability.capabilityId, capability);
    this.#capabilities.set(capability.authorizationId, capability);
    this.#sanitationTokens.add(capability.capabilityId);
  }

  captureOutbound(input: NativeSuperpowersProvenanceInput): NativeCapabilityOutboundRecord | null {
    const capability = this.#capabilities.get(input.authorizationId);
    if (!capability) return null;
    const receipt: NativeCapabilityOutboundReceipt = {
      schemaVersion: "justice-capability-outbound-receipt-v1",
      authorizationId: capability.authorizationId,
      method: capability.method,
      issuedFromReadToolCallId: capability.issuedFromReadToolCallId,
      parentSessionId: input.parentSessionId,
      parentToolCallId: input.parentToolCallId,
      batchItemIndex: input.batchItemIndex,
      capabilityDigest: capabilityDigest(capability),
      strippedTaskArgsDigest: strippedArgsDigest(input.taskArgs),
    };
    const key = outboundKey(input);
    const record: NativeCapabilityOutboundRecord = { kind: "captured", receipt };
    this.#outbound.set(key, record);
    return record;
  }

  rejectOutbound(input: NativeSuperpowersProvenanceInput, reasons: readonly [string, ...string[]]): NativeCapabilityOutboundRecord {
    const record: NativeCapabilityOutboundRecord = {
      kind: "rejected",
      parentSessionId: input.parentSessionId,
      parentToolCallId: input.parentToolCallId,
      batchItemIndex: input.batchItemIndex,
      strippedTaskArgsDigest: strippedArgsDigest(input.taskArgs),
      reasons,
    };
    this.#outbound.set(outboundKey(input), record);
    return record;
  }

  validate(input: NativeSuperpowersProvenanceInput): NativeCapabilityValidationResult {
    const key = outboundKey(input);
    const outbound = this.#outbound.get(key);
    if (!outbound || outbound.kind !== "captured") {
      return {
        provenance: { kind: "ambiguous", reasons: ["missing_or_untrusted_outbound_receipt"] },
        restoredDescription: null,
        stripRequired: false,
      };
    }
    const capability = this.#capabilities.get(outbound.receipt.authorizationId);
    if (!capability) {
      return {
        provenance: { kind: "ambiguous", reasons: ["capability_not_found"] },
        restoredDescription: null,
        stripRequired: false,
      };
    }
    const activation = this.#authorizations.get(capability.authorizationId);
    if (!activation) {
      return {
        provenance: { kind: "ambiguous", reasons: ["activation_not_found"] },
        restoredDescription: null,
        stripRequired: false,
      };
    }
    if (activation.sessionId !== input.parentSessionId) {
      return {
        provenance: { kind: "external" },
        restoredDescription: null,
        stripRequired: true,
      };
    }
    if (activation.method !== input.executionMethod) {
      return {
        provenance: { kind: "ambiguous", reasons: ["method_mismatch"] },
        restoredDescription: null,
        stripRequired: false,
      };
    }
    if (activation.authorizationId !== input.authorizationId) {
      return {
        provenance: { kind: "ambiguous", reasons: ["authorization_mismatch"] },
        restoredDescription: null,
        stripRequired: false,
      };
    }
    const callBinding: NativeSuperpowersCallBindingEvidence = {
      schemaVersion: "justice-native-superpowers-call-binding-v1",
      parentSessionId: input.parentSessionId,
      parentToolCallId: input.parentToolCallId,
      batchItemIndex: input.batchItemIndex,
      capabilityDigest: capabilityDigest(capability),
      strippedTaskArgsDigest: strippedArgsDigest(input.taskArgs),
      observedAt: new Date().toISOString(),
    };
    const provenanceEvidence: NativeSuperpowersProvenanceEvidence = {
      schemaVersion: "justice-native-superpowers-provenance-evidence-v1",
      protocolId: "justice-native-superpowers-task-capability-v1",
      capabilityDigest: capabilityDigest(capability),
      authorizationId: capability.authorizationId,
      method: capability.method,
      issuedFromReadToolCallId: capability.issuedFromReadToolCallId,
      parentSessionId: input.parentSessionId,
      parentToolCallId: input.parentToolCallId,
      batchItemIndex: input.batchItemIndex,
      activationEvidence: activation,
      callBindingEvidence: callBinding,
      observedAt: new Date().toISOString(),
    };
    return {
      provenance: { kind: "superpowers", evidence: provenanceEvidence },
      restoredDescription: null,
      stripRequired: true,
    };
  }

  // --- Fixture contract validation surface (task1_* probes) ---

  getCapabilityForAuthorization(authorizationId: string): NativeSuperpowersTaskCapability | null {
    return this.#capabilities.get(authorizationId) ?? null;
  }

  hasCapabilityForAuthorization(authorizationId: string): boolean {
    return this.#capabilities.has(authorizationId);
  }

  /**
   * Tombstones a capability so a stale transcript replay (same digest, same ids)
   * can no longer validate. Compaction, restart, and leak invalidation share this.
   */
  invalidateCapability(authorizationId: string, reason: string): CapabilityRejectionResult | null {
    const capability = this.#capabilities.get(authorizationId);
    if (!capability) return null;
    this.#capabilities.delete(authorizationId);
    this.#sanitationTokens.add(`invalidated:${capability.capabilityId}`);
    this.#invalidated.set(authorizationId, reason);
    return {
      kind: "rejected",
      reason: "stale_transcript_replay",
      capabilityId: capability.capabilityId,
      observedSessionId: capability.sessionId,
      expectedSessionId: capability.sessionId,
    };
  }

  invalidatedReasonFor(authorizationId: string): string | undefined {
    return this.#invalidated.get(authorizationId);
  }

  /**
   * Envelope-independent verdict for a presented capability: session binding,
   * authorization, method, and expiry must all agree for the presentation to be
   * accepted. Session mismatch is the strongest rejection and short-circuits.
   */
  presentCapability(
    presented: {
      readonly authorizationId: string;
      readonly method: SuperpowersExecutionMethod;
      readonly presentingSessionId: string;
    },
    context: CapabilityValidationContext,
  ): CapabilityVerdict {
    void context;
    const capability = this.#capabilities.get(presented.authorizationId);
    if (!capability) {
      return {
        kind: "rejected",
        reason: "stale_transcript_replay",
        capabilityId: null,
        observedSessionId: presented.presentingSessionId,
        expectedSessionId: null,
      };
    }
    if (capability.sessionId !== presented.presentingSessionId) {
      return {
        kind: "rejected",
        reason: "wrong_session",
        capabilityId: capability.capabilityId,
        observedSessionId: presented.presentingSessionId,
        expectedSessionId: capability.sessionId,
      };
    }
    if (capability.authorizationId !== presented.authorizationId) {
      return {
        kind: "rejected",
        reason: "authorization_mismatch",
        capabilityId: capability.capabilityId,
        observedSessionId: presented.presentingSessionId,
        expectedSessionId: capability.sessionId,
      };
    }
    if (capability.method !== presented.method) {
      return {
        kind: "rejected",
        reason: "method_mismatch",
        capabilityId: capability.capabilityId,
        observedSessionId: presented.presentingSessionId,
        expectedSessionId: capability.sessionId,
      };
    }
    return { kind: "accepted", capability };
  }

  /** Presents an already-invalidated capability; used for stale replay probes. */
  presentInvalidated(
    authorizationId: string,
    presentingSessionId: string,
  ): CapabilityRejectionResult {
    const reason = this.#invalidated.get(authorizationId) ?? "stale_transcript_replay";
    return {
      kind: "rejected",
      reason: reason === "expired" ? "expired" : "stale_transcript_replay",
      capabilityId: authorizationId,
      observedSessionId: presentingSessionId,
      expectedSessionId: null,
    };
  }

  /** Marks a capability expired (fixture-controlled clock) and tombstones it. */
  expireCapability(authorizationId: string, nowMs: number, maxAgeMs: number): CapabilityRejectionResult | null {
    const capability = this.#capabilities.get(authorizationId);
    if (!capability) return null;
    const issuedMs = Date.parse(capability.issuedAt);
    if (Number.isNaN(issuedMs) || nowMs - issuedMs <= maxAgeMs) return null;
    this.#invalidated.set(authorizationId, "expired");
    return {
      kind: "rejected",
      reason: "expired",
      capabilityId: capability.capabilityId,
      observedSessionId: capability.sessionId,
      expectedSessionId: capability.sessionId,
    };
  }

  /** Guard-profile gate: an unverified transcript profile must never issue a capability. */
  issueIfGuardProfileVerified(
    binding: NativeSuperpowersActivationBinding,
    guardProfile: TranscriptGuardProfile,
  ): CapabilityVerdict {
    if (!guardProfile.verified) {
      return {
        kind: "rejected",
        reason: "unverified_guard_profile",
        capabilityId: null,
        observedSessionId: guardProfile.sessionId,
        expectedSessionId: guardProfile.sessionId,
      };
    }
    const capability = this.issue(binding);
    if (!capability) {
      return {
        kind: "rejected",
        reason: "unverified_guard_profile",
        capabilityId: null,
        observedSessionId: binding.sessionId,
        expectedSessionId: binding.sessionId,
      };
    }
    return { kind: "accepted", capability };
  }

  /** Provider guard: fixture capabilities are only issued for the mock provider. */
  checkProviderSelection(input: ProviderSelectionGuardInput): ProviderSelectionGuardResult {
    if (input.provider === MOCK_PROVIDER_ID) {
      return { kind: "allowed", provider: MOCK_PROVIDER_ID, model: input.model };
    }
    return { kind: "blocked", provider: input.provider, model: input.model, reason: "non_mock_provider" };
  }

  /**
   * Classifies a task-family call surface as trusted or untrusted for capability
   * provenance. In-process execution and nested calls without provenance are
   * always untrusted in the fixture.
   */
  classifyTaskCallSource(input: {
    readonly executionMode?: string;
    readonly parentToolCallId?: string;
    readonly hasOutboundReceipt: boolean;
  }): UntrustedCallClassification {
    if (input.executionMode === "in-process") {
      return { kind: "in_process", executionMode: "in-process", reason: "untrusted_in_process" };
    }
    if (typeof input.parentToolCallId === "string" && input.parentToolCallId.length > 0) {
      return { kind: "nested", parentToolCallId: input.parentToolCallId, reason: "untrusted_nested_call" };
    }
    if (!input.hasOutboundReceipt) {
      return { kind: "nested", parentToolCallId: "<missing>", reason: "untrusted_nested_call" };
    }
    return { kind: "trusted_pending_receipt", reason: "trusted_pending_receipt" };
  }

  /** Deterministic verdict for decoding a presentation envelope (malformed / duplicate / replay). */
  decodePresentation(envelope: string, presentingSessionId: string): CapabilityVerdict {
    const decoded = decodeTaskCapabilityEnvelope(envelope);
    if (decoded.kind === "invalid") {
      return {
        kind: "rejected",
        reason: decoded.reason,
        capabilityId: null,
        observedSessionId: presentingSessionId,
        expectedSessionId: null,
      };
    }
    if (decoded.kind !== "decoded") {
      return {
        kind: "rejected",
        reason: "stale_transcript_replay",
        capabilityId: null,
        observedSessionId: presentingSessionId,
        expectedSessionId: null,
      };
    }
    const capability = this.#capabilities.get(decoded.capabilityId) ?? this.#capabilities.get(`${presentingSessionId}:${decoded.capabilityId}`);
    if (!capability) {
      this.#invalidated.set(decoded.capabilityId, "stale_transcript_replay");
      return {
        kind: "rejected",
        reason: "stale_transcript_replay",
        capabilityId: decoded.capabilityId,
        observedSessionId: presentingSessionId,
        expectedSessionId: null,
      };
    }
    return { kind: "accepted", capability };
  }

  rememberNonTaskLeak(sessionId: string, parentToolCallId: string): void {
    let set = this.#nonTaskVetoes.get(sessionId);
    if (!set) {
      set = new Set();
      this.#nonTaskVetoes.set(sessionId, set);
    }
    set.add(parentToolCallId);
  }

  hasNonTaskLeak(sessionId: string, parentToolCallId: string): boolean {
    return this.#nonTaskVetoes.get(sessionId)?.has(parentToolCallId) ?? false;
  }

  invalidateCapabilityForLeak(sessionId: string): void {
    for (const [id, capability] of this.#capabilities) {
      if (capability.sessionId === sessionId) {
        this.#capabilities.delete(id);
      }
    }
    for (const [key, record] of this.#outbound) {
      if (record.kind === "captured" && record.receipt.parentSessionId === sessionId) {
        this.#outbound.delete(key);
      }
    }
    this.#authorizations.delete(sessionId);
  }

  invalidateSession(sessionId: string, _reason: string): void {
    for (const [id, capability] of this.#capabilities) {
      if (capability.sessionId === sessionId) this.#capabilities.delete(id);
    }
    for (const [key, record] of this.#outbound) {
      if (record.kind === "captured" && record.receipt.parentSessionId === sessionId) {
        this.#outbound.delete(key);
      }
    }
    for (const [authId, activation] of this.#authorizations) {
      if (activation.sessionId === sessionId) this.#authorizations.delete(authId);
    }
    this.#nonTaskVetoes.delete(sessionId);
  }

  getSanitationTokens(): readonly string[] {
    return Array.from(this.#sanitationTokens);
  }

  addSanitationToken(token: string): void {
    this.#sanitationTokens.add(token);
  }

  containsTokenLiteral(value: unknown, tokens: ReadonlyArray<string>): boolean {
    return containsLiteral(value, tokens);
  }
}

function outboundKey(input: { readonly parentSessionId: string; readonly parentToolCallId: string; readonly batchItemIndex?: number }): string {
  return `${input.parentSessionId}:${input.parentToolCallId}:${String(input.batchItemIndex ?? "none")}`;
}

function containsLiteral(value: unknown, tokens: ReadonlyArray<string>): boolean {
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

export function guardCapabilityToolCall(
  registry: FixtureCapabilityRegistry,
  input: NativeCapabilityToolCallGuardInput,
): NativeCapabilityToolCallGuardResult {
  const tokens = registry.getSanitationTokens();
  if (registry.containsTokenLiteral(input.args, tokens) || registry.hasNonTaskLeak(input.sessionId, input.parentToolCallId)) {
    registry.invalidateCapabilityForLeak(input.sessionId);
    return { kind: "block", reason: "justice_capability_token_leak", terminate: true };
  }
  return { kind: "continue" };
}

export function formatNativeCapabilityDirective(capability: NativeSuperpowersTaskCapability, originalDescription: string | null): string {
  return encodeTaskCapabilityEnvelope(capability.capabilityId, originalDescription);
}

export function formatReviewAppendixSuffix(_contractText: string): string {
  // Fixture-only marker for pre-spawn contract delivery. Real §14.2 suffix omitted in fixture.
  return "[[JUSTICE_FIXTURE_PRE_SPAWN_CONTRACT]]";
}
