// S2-b Correlation → Evidence projector (offline, READ_ONLY, pure; no I/O).
//
// Fixed order (design §6.3 F-001 / §7, plan Task 3):
//   Phase 1  global/structural validation of the selected Intent, the Correlation identity, every Binding
//            (keys/types/safe S1 identifiers/Tool IDs/limits) and Source Message ID uniqueness.
//            Any failure here is a global REJECTED: a malformed Binding is never "rescued" by Task classification.
//   Phase 2  uniqueness / ownership conflicts BEFORE Task selection: duplicate `(sessionId,messageId)` Bindings
//            (identical values included, different Tasks included) and duplicate `(sessionId,messageId,toolId)`.
//            These are local CONFLICTs: only the affected candidates are excluded.
//   Phase 3  classification by selected Task ID + Revision + Scope; other valid Bindings are FOREIGN_TASK_EXCLUDED.
//   Phase 4  `acRef` membership in the selected Intent's `ac[]`, applied ONLY to selected Bindings.
//   Phase 5  resolution against the validated Source prefix: the Message must exist, be `assistant`,
//            and carry exactly one Tool part with the bound ID.
//   Phase 6  UNMAPPED accounting for Source Tool parts that no Binding references (never implicit evidence).
//   Phase 7  hashed Evidence identity (collisions rejected), canonical EvidenceRefV1 emission, output limits
//            and the deterministic Adapter status (see Phase 7c for the fixed priority).
//
// Child Sessions are never merged: only the single validated Source Session is consulted, and the Correlation
// must name exactly that Session (SOURCE_IDENTITY_MISMATCH otherwise).
import { createHash } from "node:crypto";
import { isSafeIdentifier } from "../core/s1a/contract.js";
import { S1B_MAX_EVIDENCE_REFS } from "../core/s1b/contract.js";
import {
  S2B_LIMITS,
  type CorrelationBinding,
  type CorrelationResult,
  type DiagnosticCode,
  type EvidenceRefV1,
  type Projection,
  type S2bDiagnostic,
  type S2bStatus,
  type TaskIntent,
  type ValidatedSource,
} from "./s2b-contract.js";
import { DIAGNOSTIC_ORDER, isMessageId, isSessionId } from "./s2b-input.js";

type Ref = Readonly<{ artifactId: string; revision: string }>;
type JsonRecord = Readonly<Record<string, unknown>>;
type AcceptedCorrelation = Extract<CorrelationResult, { state: "ACCEPTED" }>;

const ISSUER_ID = "opencode-v225-record";

class GlobalRejection extends Error {
  constructor(readonly code: DiagnosticCode) {
    super(code);
  }
}
const fail = (code: DiagnosticCode): never => {
  throw new GlobalRejection(code);
};

const isRecord = (v: unknown): v is JsonRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const hasExactKeys = (v: JsonRecord, keys: readonly string[]): boolean => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
};
const isSafeRef = (v: unknown): v is Ref =>
  isRecord(v) && hasExactKeys(v, ["artifactId", "revision"]) && isSafeIdentifier(v["artifactId"]) && isSafeIdentifier(v["revision"]);
const refEquals = (a: Ref, b: Ref): boolean => a.artifactId === b.artifactId && a.revision === b.revision;
const toolKey = (messageId: string, toolId: string): string => `${messageId.length}:${messageId}\u0000${toolId}`;

/** Deterministic anonymous token for user-originated identities placed in the S2-b projection scope. */
function anonymousToken(label: string, value: string): string {
  const bytes = new TextEncoder().encode(value);
  return createHash("sha256").update(`justice-s2b-${label}\u0000${bytes.byteLength}\u0000`).update(bytes).digest("hex");
}

class Tally {
  private readonly counts = new Map<DiagnosticCode, number>();

  constructor(seed: readonly S2bDiagnostic[]) {
    for (const d of seed) this.add(d.code, d.count);
  }

  add(code: DiagnosticCode, by = 1): void {
    if (by > 0) this.counts.set(code, (this.counts.get(code) ?? 0) + by);
  }

  freeze(): readonly S2bDiagnostic[] {
    return Object.freeze(
      DIAGNOSTIC_ORDER.filter((code) => (this.counts.get(code) ?? 0) > 0).map((code) =>
        Object.freeze({ code, count: this.counts.get(code) ?? 0 }),
      ),
    );
  }
}

type Counts = {
  bindings: number;
  conflictedBindings: number;
  conflictedSelectedMessages: number;
  foreignBindings: number;
  selectedBindings: number;
  explicitSelectedCandidates: number;
  validCandidates: number;
  rejectedCandidates: number;
  unconfirmedCandidates: number;
  unmappedTools: number;
};
const zeroCounts = (): Counts => ({
  bindings: 0, conflictedBindings: 0, conflictedSelectedMessages: 0, foreignBindings: 0, selectedBindings: 0,
  explicitSelectedCandidates: 0, validCandidates: 0, rejectedCandidates: 0, unconfirmedCandidates: 0, unmappedTools: 0,
});
const freezeCounts = (c: Counts): Readonly<Record<string, number>> =>
  Object.freeze(Object.fromEntries(Object.entries(c).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

type Candidate = Readonly<{ binding: CorrelationBinding; toolId: string; acRef: Ref }>;
type ResolvedCandidate = Readonly<{ candidate: Candidate; part: JsonRecord }>;

// ---------------------------------------------------------------------------
// Phase 1: global / structural validation (no Task semantics)
// ---------------------------------------------------------------------------

function validateSelectedIntent(selected: TaskIntent): void {
  if (!isSafeRef(selected.task) || !isSafeIdentifier(selected.scopeKey) || !Array.isArray(selected.ac) || !selected.ac.every(isSafeRef)) {
    fail("SOURCE_SCHEMA_INVALID");
  }
}

function validateBindingStructure(binding: unknown): void {
  if (!isRecord(binding) || !hasExactKeys(binding, ["messageId", "taskRef", "scopeKey", "tools"])) return fail("SOURCE_SCHEMA_INVALID");
  const tools = binding["tools"];
  if (!isMessageId(binding["messageId"]) || !isSafeRef(binding["taskRef"]) || !isSafeIdentifier(binding["scopeKey"]) || !Array.isArray(tools)) {
    return fail("SOURCE_SCHEMA_INVALID");
  }
  for (const tool of tools as unknown[]) {
    if (!isRecord(tool) || !hasExactKeys(tool, ["toolId", "acRef"])) return fail("SOURCE_SCHEMA_INVALID");
    const toolId = tool["toolId"];
    if (typeof toolId !== "string" || toolId.length === 0 || !isSafeRef(tool["acRef"])) return fail("SOURCE_SCHEMA_INVALID");
  }
}

function validateBindingInputLimits(bindings: readonly unknown[]): void {
  // Limits are evaluated over the whole input before any structural decision (no truncation).
  if (bindings.length > S2B_LIMITS.bindings) fail("INPUT_LIMIT_EXCEEDED");
  let totalTools = 0;
  for (const binding of bindings) {
    const tools = isRecord(binding) ? binding["tools"] : undefined;
    if (!Array.isArray(tools)) continue;
    if (tools.length > S2B_LIMITS.toolsPerMessage) fail("INPUT_LIMIT_EXCEEDED");
    totalTools += tools.length;
  }
  if (totalTools > S2B_LIMITS.toolsTotal) fail("INPUT_LIMIT_EXCEEDED");
}

function validateGlobal(source: ValidatedSource, correlation: AcceptedCorrelation): void {
  if (!isSessionId(correlation.sessionId) || !isSessionId(source.sessionId)) fail("SOURCE_SCHEMA_INVALID");
  // T05: the Correlation must name the Source Session itself; a child/parent Session cannot be joined.
  if (correlation.sessionId !== source.sessionId) fail("SOURCE_IDENTITY_MISMATCH");
  const bindings: unknown = correlation.bindings;
  if (!Array.isArray(bindings)) return fail("SOURCE_SCHEMA_INVALID");
  validateBindingInputLimits(bindings);
  for (const binding of bindings as unknown[]) validateBindingStructure(binding);
  // Global Message identity must be resolvable; otherwise no candidate can be attributed safely.
  const ids = new Set<string>();
  for (const message of source.messages) {
    const id = message["id"];
    if (typeof id !== "string" || ids.has(id)) fail("CONFLICT");
    ids.add(id as string);
  }
}

// ---------------------------------------------------------------------------
// Phase 5 helpers: Source resolution
// ---------------------------------------------------------------------------

function toolParts(message: JsonRecord): readonly JsonRecord[] {
  const content = message["content"];
  if (message["type"] !== "assistant" || !Array.isArray(content)) return [];
  return content.filter((part): part is JsonRecord => isRecord(part) && part["type"] === "tool");
}

type BindingConflicts = Readonly<{
  messages: ReadonlySet<string>;
  tools: ReadonlyMap<CorrelationBinding, ReadonlySet<string>>;
}>;

function findBindingConflicts(bindings: readonly CorrelationBinding[], tally: Tally): BindingConflicts {
  const bindingsPerMessage = new Map<string, number>();
  for (const binding of bindings) {
    bindingsPerMessage.set(binding.messageId, (bindingsPerMessage.get(binding.messageId) ?? 0) + 1);
  }
  const messages = new Set([...bindingsPerMessage].filter(([, count]) => count > 1).map(([id]) => id));
  tally.add("CONFLICT", messages.size);

  const tools = new Map<CorrelationBinding, ReadonlySet<string>>();
  for (const binding of bindings) {
    if (messages.has(binding.messageId)) continue;
    const seen = new Map<string, number>();
    for (const tool of binding.tools) seen.set(tool.toolId, (seen.get(tool.toolId) ?? 0) + 1);
    const colliding = new Set([...seen].filter(([, count]) => count > 1).map(([id]) => id));
    tally.add("CONFLICT", colliding.size);
    tools.set(binding, colliding);
  }
  return Object.freeze({ messages, tools });
}

type SelectionCounts = Pick<
  Counts,
  "conflictedBindings" | "foreignBindings" | "selectedBindings" | "explicitSelectedCandidates" | "rejectedCandidates" | "conflictedSelectedMessages"
>;
type CandidateSelection = Readonly<{
  pending: readonly Candidate[];
  selectedBindings: readonly CorrelationBinding[];
  counts: SelectionCounts;
}>;

// Candidate diagnostics count unique (messageId, toolId) keys; Binding counters count entries.
function selectCandidates(
  bindings: readonly CorrelationBinding[],
  selected: TaskIntent,
  conflicts: BindingConflicts,
  tally: Tally,
): CandidateSelection {
  const isSelectedTuple = (binding: CorrelationBinding): boolean =>
    refEquals(binding.taskRef, selected.task) && binding.scopeKey === selected.scopeKey;
  const pending: Candidate[] = [];
  const selectedBindings: CorrelationBinding[] = [];
  const conflictedSelectedKeys = new Set<string>();
  const conflictedSelectedMessages = new Set<string>();
  const counts: SelectionCounts = {
    conflictedBindings: 0,
    foreignBindings: 0,
    selectedBindings: 0,
    explicitSelectedCandidates: 0,
    rejectedCandidates: 0,
    conflictedSelectedMessages: 0,
  };

  for (const binding of bindings) {
    if (conflicts.messages.has(binding.messageId)) {
      counts.conflictedBindings++;
      if (isSelectedTuple(binding)) {
        conflictedSelectedMessages.add(binding.messageId);
        for (const tool of binding.tools) conflictedSelectedKeys.add(toolKey(binding.messageId, tool.toolId));
      }
      continue;
    }
    const colliding = conflicts.tools.get(binding) ?? new Set<string>();
    if (!isSelectedTuple(binding)) {
      if (colliding.size === 0) {
        counts.foreignBindings++;
        tally.add("FOREIGN_TASK_EXCLUDED");
      }
      continue;
    }
    selectedBindings.push(binding);
    counts.selectedBindings++;
    const seenToolIds = new Set<string>();
    for (const tool of binding.tools) {
      if (seenToolIds.has(tool.toolId)) continue;
      seenToolIds.add(tool.toolId);
      counts.explicitSelectedCandidates++;
      if (colliding.has(tool.toolId)) {
        counts.rejectedCandidates++;
        continue;
      }
      if (!selected.ac.some((ac) => refEquals(ac, tool.acRef))) {
        tally.add("CORRELATION_MISMATCH");
        counts.rejectedCandidates++;
        continue;
      }
      pending.push(Object.freeze({ binding, toolId: tool.toolId, acRef: tool.acRef }));
    }
  }
  counts.conflictedSelectedMessages = conflictedSelectedMessages.size;
  counts.explicitSelectedCandidates += conflictedSelectedKeys.size;
  counts.rejectedCandidates += conflictedSelectedKeys.size;
  return Object.freeze({ pending: Object.freeze(pending), selectedBindings: Object.freeze(selectedBindings), counts });
}

type CandidateResolution = Readonly<{
  valid: readonly ResolvedCandidate[];
  rejectedCandidates: number;
  unconfirmedCandidates: number;
}>;

function resolveCandidates(source: ValidatedSource, selection: CandidateSelection, tally: Tally): CandidateResolution {
  const messagesById = new Map<string, JsonRecord>();
  for (const message of source.messages) messagesById.set(message["id"] as string, message);
  const complete = source.collectionStatus === "PAGINATION_COMPLETE";
  const valid: ResolvedCandidate[] = [];
  let rejectedCandidates = 0;
  let unconfirmedCandidates = 0;
  const byBinding = new Map<CorrelationBinding, Candidate[]>();
  for (const candidate of selection.pending) {
    byBinding.set(candidate.binding, [...(byBinding.get(candidate.binding) ?? []), candidate]);
  }
  for (const binding of selection.selectedBindings) {
    const candidates = byBinding.get(binding);
    if (candidates === undefined) continue;
    const message = messagesById.get(binding.messageId);
    if (message === undefined) {
      if (complete) {
        tally.add("MISSING_MESSAGE");
        rejectedCandidates += candidates.length;
      } else {
        unconfirmedCandidates += candidates.length;
      }
      continue;
    }
    if (message["type"] !== "assistant") {
      tally.add("NOT_ASSISTANT_MESSAGE");
      rejectedCandidates += candidates.length;
      continue;
    }
    const parts = toolParts(message);
    for (const candidate of candidates) {
      const matches = parts.filter((part) => part["id"] === candidate.toolId);
      if (matches.length === 0) {
        tally.add("MISSING_TOOL");
        rejectedCandidates++;
      } else if (matches.length > 1) {
        tally.add("CONFLICT");
        rejectedCandidates++;
      } else {
        valid.push(Object.freeze({ candidate, part: matches[0] as JsonRecord }));
      }
    }
  }
  return Object.freeze({ valid: Object.freeze(valid), rejectedCandidates, unconfirmedCandidates });
}

function countUnmappedTools(source: ValidatedSource, bindings: readonly CorrelationBinding[]): number {
  const referenced = new Set<string>();
  for (const binding of bindings) {
    for (const tool of binding.tools) referenced.add(toolKey(binding.messageId, tool.toolId));
  }
  let unmappedTools = 0;
  for (const message of source.messages) {
    for (const part of toolParts(message)) {
      if (!referenced.has(toolKey(message["id"] as string, String(part["id"])))) unmappedTools++;
    }
  }
  return unmappedTools;
}

type EvidenceOutput = Readonly<{ status: S2bStatus; evidenceRefs: readonly EvidenceRefV1[] }>;

function emitEvidence(
  source: ValidatedSource,
  valid: readonly ResolvedCandidate[],
  counts: Counts,
  tally: Tally,
  complete: boolean,
): EvidenceOutput {
  const hashed = partitionHashedIdentities(valid, (resolved) =>
    s2bEvidenceIdentityToken(
      source.collectionId,
      source.sessionId,
      resolved.candidate.binding.messageId,
      resolved.candidate.toolId,
    ),
  );
  tally.add("CONFLICT", hashed.collisionGroups);
  counts.rejectedCandidates += hashed.collided.length;
  counts.validCandidates = hashed.unique.length;

  const projected: EvidenceRefV1[] = hashed.unique
    .map(({ item, token }) => toEvidenceRef(item, token, source))
    .sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));
  const limitViolation = checkEvidenceOutputLimits(projected);
  if (limitViolation !== null) {
    tally.add(limitViolation);
    return Object.freeze({ status: "REJECTED", evidenceRefs: Object.freeze([]) });
  }
  // Partial results retain valid Evidence; an empty partial result is rejected.
  const partial =
    !complete || counts.rejectedCandidates > 0 || counts.unconfirmedCandidates > 0 || counts.conflictedSelectedMessages > 0;
  let status: S2bStatus;
  if (!partial) {
    status = "PROJECTED";
  } else if (projected.length > 0) {
    status = "LIMITED";
  } else {
    status = "REJECTED";
  }
  return Object.freeze({ status, evidenceRefs: Object.freeze(status === "REJECTED" ? [] : projected) });
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function projectS2bEvidence(
  source: ValidatedSource,
  correlation: AcceptedCorrelation,
  selected: TaskIntent,
): Projection {
  const tally = new Tally(source.diagnostics);
  const counts = zeroCounts();
  let selectedIntentValidated = false;

  const finish = (status: S2bStatus, evidenceRefs: readonly EvidenceRefV1[], selectedMessageCount: number): Projection =>
    Object.freeze({
      status,
      evidenceRefs: Object.freeze([...evidenceRefs]),
      diagnostics: tally.freeze(),
      projectionScope: Object.freeze({
        sessionId: anonymousToken("session", source.sessionId),
        collectionId: anonymousToken("collection", source.collectionId),
        taskRef: selectedIntentValidated
          ? Object.freeze({ artifactId: selected.task.artifactId, revision: selected.task.revision })
          : Object.freeze({ artifactId: "", revision: "" }),
        scopeKey: selectedIntentValidated ? selected.scopeKey : "",
        firstPageIndex: source.validatedPageCount > 0 ? (0 as const) : null,
        lastValidatedPageIndex: source.lastValidatedPageIndex,
        validatedPageCount: source.validatedPageCount,
        selectedMessageCount,
        projectedEvidenceCount: evidenceRefs.length,
      }),
      counts: freezeCounts(counts),
    });

  // Phase 1
  try {
    validateSelectedIntent(selected);
    selectedIntentValidated = true;
    validateGlobal(source, correlation);
  } catch (error) {
    tally.add(error instanceof GlobalRejection ? error.code : "SOURCE_SCHEMA_INVALID");
    return finish("REJECTED", [], 0);
  }
  if (source.validatedPageCount === 0) {
    tally.add("PAGINATION_INCOMPLETE");
    return finish("REJECTED", [], 0);
  }

  const bindings = correlation.bindings;
  counts.bindings = bindings.length;
  const conflicts = findBindingConflicts(bindings, tally);

  // Phase 3/4: classify bindings, then apply AC semantics to selected candidates only.
  const selection = selectCandidates(bindings, selected, conflicts, tally);
  counts.conflictedBindings = selection.counts.conflictedBindings;
  counts.foreignBindings = selection.counts.foreignBindings;
  counts.selectedBindings = selection.counts.selectedBindings;
  counts.explicitSelectedCandidates = selection.counts.explicitSelectedCandidates;
  counts.rejectedCandidates = selection.counts.rejectedCandidates;
  counts.conflictedSelectedMessages = selection.counts.conflictedSelectedMessages;

  // Phase 5: resolve selected candidates against the validated Source prefix.
  const resolution = resolveCandidates(source, selection, tally);
  counts.rejectedCandidates += resolution.rejectedCandidates;
  counts.unconfirmedCandidates = resolution.unconfirmedCandidates;

  // Phase 6: Source Tool parts without an explicit Binding are UNMAPPED, never implicit evidence.
  counts.unmappedTools = countUnmappedTools(source, bindings);
  tally.add("UNMAPPED", counts.unmappedTools);

  // Phase 7: emit canonical EvidenceRefs and apply output limits/status priority.
  const complete = source.collectionStatus === "PAGINATION_COMPLETE";
  const output = emitEvidence(source, resolution.valid, counts, tally, complete);
  return finish(output.status, output.evidenceRefs, counts.selectedBindings);
}

// ---------------------------------------------------------------------------
// Evidence identity / emission helpers (exported for direct contract tests)
// ---------------------------------------------------------------------------

const EVIDENCE_ID_DOMAIN = "justice-s2b-evidence-id-v1";
const ORIGIN_ID_DOMAIN = "justice-s2b-origin-id-v1";
const ORIGIN_ID_PREFIX = "oc225-msg-";

/** SHA-256 hex over a domain tag followed by length-delimited (`<utf8ByteLength>:<bytes>`) UTF-8 fields. */
function lengthDelimitedSha256(domain: string, fields: readonly string[]): string {
  const hash = createHash("sha256").update(`${domain}\u0000`);
  const encoder = new TextEncoder();
  for (const field of fields) {
    const bytes = encoder.encode(field);
    hash.update(`${bytes.byteLength}:`).update(bytes);
  }
  return hash.digest("hex");
}

/** Deterministic 64-char lowercase SHA-256 Evidence ID over `(collectionId, sessionId, messageId, toolId)`. */
export function s2bEvidenceIdentityToken(collectionId: string, sessionId: string, messageId: string, toolId: string): string {
  return lengthDelimitedSha256(EVIDENCE_ID_DOMAIN, [collectionId, sessionId, messageId, toolId]);
}

/** Deterministic safe origin label for the source record (the Message); no raw ID is exposed. 64 chars max. */
function originLabel(collectionId: string, sessionId: string, messageId: string): string {
  const hex = lengthDelimitedSha256(ORIGIN_ID_DOMAIN, [collectionId, sessionId, messageId]);
  return `${ORIGIN_ID_PREFIX}${hex.slice(0, 64 - ORIGIN_ID_PREFIX.length)}`;
}

/**
 * Groups items by hashed identity token. Any token shared by more than one item is a collision: every item in
 * that group is rejected (returned in `collided`, input order preserved) and counted once in `collisionGroups`.
 */
export function partitionHashedIdentities<T>(
  items: readonly T[],
  tokenOf: (item: T) => string,
): Readonly<{ unique: readonly Readonly<{ item: T; token: string }>[]; collided: readonly T[]; collisionGroups: number }> {
  const tokened = items.map((item) => Object.freeze({ item, token: tokenOf(item) }));
  const occurrences = new Map<string, number>();
  for (const { token } of tokened) occurrences.set(token, (occurrences.get(token) ?? 0) + 1);
  const unique: Readonly<{ item: T; token: string }>[] = [];
  const collided: T[] = [];
  for (const entry of tokened) {
    if ((occurrences.get(entry.token) ?? 0) > 1) collided.push(entry.item);
    else unique.push(entry);
  }
  const collisionGroups = [...occurrences.values()].filter((n) => n > 1).length;
  return Object.freeze({ unique: Object.freeze(unique), collided: Object.freeze(collided), collisionGroups });
}

/**
 * Evidence-output limits: at most `evidenceRefs` entries and at most `evidenceJsonBytes` UTF-8 bytes of the
 * serialized Evidence JSON array. Returns the diagnostic code to reject with, or null when within limits.
 */
export function checkEvidenceOutputLimits(
  refs: readonly EvidenceRefV1[],
  limits: Readonly<{ evidenceRefs: number; evidenceJsonBytes: number }> = {
    evidenceRefs: Math.min(S2B_LIMITS.evidenceRefs, S1B_MAX_EVIDENCE_REFS),
    evidenceJsonBytes: S2B_LIMITS.evidenceJsonBytes,
  },
): DiagnosticCode | null {
  if (refs.length > limits.evidenceRefs) return "EVIDENCE_LIMIT_EXCEEDED";
  if (new TextEncoder().encode(JSON.stringify(refs)).byteLength > limits.evidenceJsonBytes) return "EVIDENCE_LIMIT_EXCEEDED";
  return null;
}

/** v2.2.5 Tool part: only `state.status === "completed"` with `executed === true` is a *reported* execution. */
function reportedExecutionState(part: JsonRecord): EvidenceRefV1["reportedExecutionState"] {
  const state = part["state"];
  return isRecord(state) && state["status"] === "completed" && part["executed"] === true ? "EXECUTED" : "UNKNOWN";
}

function toEvidenceRef(resolved: ResolvedCandidate, evidenceId: string, source: ValidatedSource): EvidenceRefV1 {
  const { candidate: c, part } = resolved;
  // taskRef / scopeKey / acRef come exclusively from the selected, validated Binding. contentDigest is omitted.
  return Object.freeze({
    evidenceId,
    type: "other" as const,
    taskRef: Object.freeze({ artifactId: c.binding.taskRef.artifactId, revision: c.binding.taskRef.revision }),
    scopeKey: c.binding.scopeKey,
    acRef: Object.freeze({ artifactId: c.acRef.artifactId, revision: c.acRef.revision }),
    issuerId: ISSUER_ID,
    originId: originLabel(source.collectionId, source.sessionId, c.binding.messageId),
    provenanceClass: "UNVERIFIED_EXTERNAL" as const,
    reportedExecutionState: reportedExecutionState(part),
    reportedOutcome: "UNKNOWN" as const,
  });
}
