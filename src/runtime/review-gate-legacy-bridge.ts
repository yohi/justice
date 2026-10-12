import { z } from "zod";
import {
  decodeLegacyBridgeMarkerReason,
  deriveLegacyResumeCursor,
  encodeLegacyBridgeMarkerReason,
  type LegacyGateSnapshot,
  type LegacyVerificationResult,
  type VerifiedLegacyGate,
} from "../core/review-gate/legacy-execution.js";
import { validateReviewGateEventRecord } from "../core/review-gate/event-schema.js";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  isValidArtifactPath,
  validateStorageGateId,
} from "../core/review-gate/identity.js";
import { projectReviewGate } from "../core/review-gate/projection.js";
import type { ReviewGateEvent } from "../core/review-gate-types.js";
import type { ReviewGateEventStore } from "./review-gate-event-store.js";

export type { LegacyGateSnapshot, LegacyVerificationResult, VerifiedLegacyGate } from "../core/review-gate/legacy-execution.js";

const historicalClear = z.strictObject({
  eventType: z.literal("DESIGN_CLEAR_INHERITED"), gateId: z.string().min(1),
  writerId: z.string().min(1), epochId: z.string().min(1), emittedAt: z.iso.datetime(),
  payload: z.strictObject({ inheritedFromGateId: z.string().min(1), designProtocolFingerprint: z.string().min(1) }),
});
const dispatchSchema = z.strictObject({
  dispatchId: z.string().min(1), operationId: z.string().min(1),
  operation: z.enum(["review_candidates", "finding_validation", "remediation", "self_review", "lineage_revalidation", "cross_generation_reconciliation", "non_convergence_reentry"]),
  phase: z.enum(["design", "plan"]), dispatchedAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(),
});

function parseLines(bytes: Uint8Array | readonly number[]): readonly unknown[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  if (text !== "" && !text.endsWith("\n")) throw new Error("legacy_bridge_ambiguous_partial_commit");
  return text === "" ? [] : text.slice(0, -1).split("\n").map((line): unknown => JSON.parse(line));
}

/** Input frontier and recovery refs must come from a trusted external producer. */
export function verifyLegacyContinuation(input: LegacyGateSnapshot): LegacyVerificationResult {
  try {
    return verifySnapshot(input);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return Object.freeze({ kind: "BLOCK", reason: error.message.startsWith("legacy_bridge_") ? error.message : "legacy_bridge_invalid_history" });
  }
}

function verifySnapshot(input: LegacyGateSnapshot): LegacyVerificationResult {
  const block = (reason: string): LegacyVerificationResult => Object.freeze({ kind: "BLOCK", reason });
  const frontier = input.trustedFrontier;
  if (frontier === null) return block("legacy_bridge_unanchored");
  if (!validateStorageGateId(input.gateId) || !isValidArtifactPath(input.scopeIdentity.canonicalDesignPath)
    || !isValidArtifactPath(input.scopeIdentity.canonicalPlanPath) || !Number.isSafeInteger(frontier.generationOrdinal)
    || frontier.generationOrdinal < 1) return block("legacy_bridge_snapshot_invalid");
  const records = parseLines(input.eventsBytes);
  const dispatches = parseLines(input.dispatchesBytes ?? []).map((record) => dispatchSchema.parse(record));
  if (new Set(dispatches.map((record) => record.operationId)).size !== dispatches.length
    || new Set(dispatches.map((record) => record.dispatchId)).size !== dispatches.length
    || dispatches.some((record) => record.completedAt === null || record.completedAt < record.dispatchedAt)) {
    return block("legacy_bridge_ambiguous_partial_commit");
  }
  if (computeArtifactDigest(Uint8Array.from(input.eventsBytes)) !== frontier.eventsDigest
    || computeArtifactDigest(Uint8Array.from(input.dispatchesBytes ?? [])) !== frontier.dispatchesDigest
    || computeCanonicalJsonFingerprint(input.recoveryObjectRefs) !== frontier.recoveryRefsDigest
    || computeCanonicalJsonFingerprint([input.scopeIdentity, input.gitIdentity]) !== frontier.scopeGitDigest) {
    return block("legacy_bridge_trusted_frontier_mismatch");
  }
  const events: ReviewGateEvent[] = [];
  const inherited: z.infer<typeof historicalClear>[] = [];
  let historicalEpoch: string | null = null;
  for (const record of records) {
    if (record !== null && typeof record === "object" && "schemaVersion" in record) return block("legacy_bridge_v2_event_present");
    const historical = historicalClear.safeParse(record);
    if (historical.success) {
      if (historical.data.epochId !== historicalEpoch) return block("legacy_bridge_ambiguous_epoch");
      if (historical.data.gateId !== input.gateId || !input.recoveryObjectRefs.some((ref) =>
        ref.refKind === "inherited_clear" && ref.predecessorGateId === historical.data.payload.inheritedFromGateId
        && ref.storeDigest === computeCanonicalJsonFingerprint(historical.data))) return block("legacy_bridge_inherited_clear_unproven");
      inherited.push(historical.data);
      continue;
    }
    const event = validateReviewGateEventRecord(record);
    if ("schemaVersion" in event) return block("legacy_bridge_v2_event_present");
    if (event.gateId !== input.gateId) return block("legacy_bridge_gate_identity_mismatch");
    if (event.eventType === "GATE_CREATED" || event.eventType === "ORCHESTRATION_RESUMED") historicalEpoch = event.epochId;
    events.push(event);
  }
  const first = events[0];
  const originalFirst = records[0];
  if (first?.eventType !== "GATE_CREATED" || originalFirst === null || typeof originalFirst !== "object"
    || !("eventType" in originalFirst) || originalFirst.eventType !== "GATE_CREATED") {
    return block("legacy_bridge_invalid_history");
  }
  if (first.payload.reviewScopeId !== input.scopeIdentity.reviewScopeId
    || first.payload.designArtifact.canonicalPath !== input.scopeIdentity.canonicalDesignPath
    || first.payload.planArtifact.canonicalPath !== input.scopeIdentity.canonicalPlanPath) return block("legacy_bridge_scope_identity_mismatch");
  if (first.payload.designArtifact.gitMode !== input.gitIdentity.designGitMode
    || first.payload.planArtifact.gitMode !== input.gitIdentity.planGitMode) return block("legacy_bridge_git_identity_mismatch");
  const requirements = first.payload.requirementsResolution;
  const proof = input.recoveryObjectRefs.filter((ref) => ref.refKind === "requirements_authority");
  if (proof.length !== 1 || !proof.some((ref) => ref.storeDigest === requirements.digest
    && ref.canonicalPath === requirements.canonicalPath && isValidArtifactPath(ref.canonicalPath)
    && ref.canonicalPath !== first.payload.designArtifact.canonicalPath
    && ref.canonicalPath !== first.payload.planArtifact.canonicalPath
    && /^[a-f0-9]{40,64}$/u.test(ref.gitBlobOid ?? "") && /^[a-f0-9]{40,64}$/u.test(ref.commitOid ?? ""))) {
    return block("legacy_bridge_requirements_unproven");
  }
  let completedDigest: string | null = null;
  const roundMarkers = new Map<string, string>();
  const epochs = new Set<string>([first.epochId]);
  let epochId = first.epochId;
  for (const event of events.slice(1)) {
    if (completedDigest !== null && (event.eventType !== "COMPLETED_APPROVAL_BINDING"
      || computeCanonicalJsonFingerprint(event.payload.approvalBinding) !== completedDigest)) return block("legacy_bridge_ambiguous_final_state");
    if (event.eventType === "COMPLETED_APPROVAL_BINDING") completedDigest = computeCanonicalJsonFingerprint(event.payload.approvalBinding);
    if (event.eventType === "ORCHESTRATION_RESUMED") {
      if (epochs.has(event.epochId)) return block("legacy_bridge_ambiguous_epoch");
      epochs.add(event.epochId);
      epochId = event.epochId;
    } else if (event.epochId !== epochId) return block("legacy_bridge_ambiguous_epoch");
    if (event.eventType === "FINDING_REMEDIATED" || event.eventType === "FINDING_SELF_REVIEWED") {
      const round = event.payload.remediationRound;
      const key = `${event.eventType}:${event.payload.lineageId}:${round.phase}:${round.ordinal}`;
      const digest = computeCanonicalJsonFingerprint(event);
      if (roundMarkers.has(key) && roundMarkers.get(key) !== digest) return block("legacy_bridge_ambiguous_round");
      roundMarkers.set(key, digest);
    }
  }
  const sequenceReason = verifySequence(events);
  if (sequenceReason !== null) return block(sequenceReason);
  const projection = projectReviewGate(events);
  const commits = input.recoveryObjectRefs.filter((ref) => ref.refKind === "prepared_commit");
  if (input.recoveryObjectRefs.some((ref) => (ref.refKind === "prepared_commit" || ref.refKind === "prepared_restore")
    && ref.disposition !== "committed" && ref.disposition !== "rolled_back")) return block("legacy_bridge_ambiguous_partial_commit");
  for (const round of [...projection.designRemediationRounds, ...projection.planRemediationRounds]) {
    if (!commits.some((ref) => ref.disposition === "committed" && ref.phase === round.phase
      && ref.roundOrdinal === round.ordinal && /^[a-f0-9]{40,64}$/u.test(ref.commitOid ?? ""))) return block("legacy_bridge_ambiguous_partial_commit");
  }
  for (const event of events) {
    if (event.eventType !== "FINDING_SELF_REVIEWED") continue;
    const round = event.payload.remediationRound;
    const covering = commits.filter((ref) => ref.disposition === "committed" && ref.phase === round.phase
      && ref.roundOrdinal === round.ordinal && ref.lineageIds?.includes(event.payload.lineageId));
    if (covering.length !== 1) return block("legacy_bridge_commit_resolution_unproven");
  }
  for (const rounds of [projection.designRemediationRounds, projection.planRemediationRounds]) {
    if (rounds.some((round, index) => round.ordinal !== index + 1)) return block("legacy_bridge_ambiguous_round");
  }
  if (projection.designRemediationRounds.length > 5 || projection.planRemediationRounds.length > 3) return block("legacy_bridge_ambiguous_round");
  const snapshot = immutableSnapshot(input);
  const epochCounters = Object.freeze({ generationOrdinal: frontier.generationOrdinal, epochCount: epochs.size,
    designRoundCount: projection.designRemediationRounds.length, planRoundCount: projection.planRemediationRounds.length });
  const resumeCursor = deriveLegacyResumeCursor(projection);
  const verifiedEventsDigest = computeCanonicalJsonFingerprint(records);
  return freezeTree({ kind: "VERIFIED" as const, value: { snapshot,
    bridgeDigest: computeCanonicalJsonFingerprint(snapshot), verifiedEventsDigest, epochCounters,
    finalEpochId: projection.epoch.epochId, writerId: first.writerId,
    requirementsResolution: requirements, commitBinding: projection.approvalBinding,
    commitResolutionBindings: snapshot.recoveryObjectRefs.filter((ref) => ref.refKind === "prepared_commit"),
    resumeCursor, historicalInheritedClears: Object.freeze(inherited.map((event) => Object.freeze({
      eventType: event.eventType, epochId: event.epochId, emittedAt: event.emittedAt }))),
  } });
}

function verifySequence(events: readonly ReviewGateEvent[]): string | null {
  const first = events[0];
  if (first?.eventType !== "GATE_CREATED") return "legacy_bridge_invalid_sequence";
  let design = first.payload.designArtifact;
  let plan = first.payload.planArtifact;
  let phase: "design" | "plan" = "design";
  let designFingerprint: string | null = null;
  let planApproval: string | null = null;
  let stopped: "execution" | "terminal" | null = null;
  const findings = new Map<string, Readonly<{ findingId: string; status: "open" | "remediated" | "self_reviewed"; round: string | null }>>();
  for (const event of events.slice(1)) {
    if (stopped !== null && (event.eventType !== "ORCHESTRATION_RESUMED" || stopped === "terminal")) return "legacy_bridge_invalid_sequence";
    switch (event.eventType) {
      case "GATE_CREATED": return "legacy_bridge_invalid_sequence";
      case "ARTIFACT_BINDINGS_UPDATED":
        if (event.payload.designArtifact.canonicalPath !== design.canonicalPath
          || event.payload.planArtifact.canonicalPath !== plan.canonicalPath) return "legacy_bridge_scope_identity_mismatch";
        design = event.payload.designArtifact;
        plan = event.payload.planArtifact;
        break;
      case "FINDING_DISCOVERED":
        if (event.payload.observedPhase !== phase || findings.has(event.payload.lineageId)) return "legacy_bridge_invalid_sequence";
        findings.set(event.payload.lineageId, { findingId: event.payload.findingId, status: "open", round: null });
        break;
      case "FINDING_REMEDIATED":
      case "FINDING_SELF_REVIEWED": {
        const prior = findings.get(event.payload.lineageId);
        const round = `${event.payload.remediationRound.phase}:${event.payload.remediationRound.ordinal}`;
        const status = event.eventType === "FINDING_REMEDIATED" ? "remediated" : "self_reviewed";
        if (prior?.findingId !== event.payload.findingId || event.payload.remediationRound.phase !== phase
          || event.payload.remediationRound.ordinal < 1 || status === "self_reviewed" && (prior.status !== "remediated" || prior.round !== round)) {
          return "legacy_bridge_invalid_sequence";
        }
        findings.set(event.payload.lineageId, { findingId: prior.findingId, status, round });
        break;
      }
      case "FINDING_REOPENED": {
        const prior = findings.get(event.payload.lineageId);
        if (prior?.findingId !== event.payload.findingId || prior.status !== "self_reviewed" || event.payload.reopenedBy !== event.epochId) return "legacy_bridge_invalid_sequence";
        findings.set(event.payload.lineageId, { ...prior, status: "open", round: null });
        break;
      }
      case "DESIGN_CLEAR":
        if (phase !== "design" || [...findings.values()].some((finding) => finding.status !== "self_reviewed")) return "legacy_bridge_invalid_sequence";
        phase = "plan";
        designFingerprint = event.payload.designProtocolFingerprint;
        break;
      case "PLAN_CLEAR": {
        const binding = event.payload.completedApprovalBinding;
        if (phase !== "plan" || planApproval !== null || [...findings.values()].some((finding) => finding.status !== "self_reviewed")) return "legacy_bridge_ambiguous_final_state";
        if (binding.gateId !== first.gateId || binding.reviewScopeId !== first.payload.reviewScopeId
          || computeCanonicalJsonFingerprint(binding.designArtifact) !== computeCanonicalJsonFingerprint(design)
          || computeCanonicalJsonFingerprint(binding.planArtifact) !== computeCanonicalJsonFingerprint(plan)
          || computeCanonicalJsonFingerprint(binding.requirementsResolution) !== computeCanonicalJsonFingerprint(first.payload.requirementsResolution)
          || binding.reviewProtocolFingerprint !== first.payload.reviewProtocolFingerprint
          || binding.designProtocolFingerprint !== designFingerprint) return "legacy_bridge_approval_binding_mismatch";
        planApproval = computeCanonicalJsonFingerprint(binding);
        break;
      }
      case "COMPLETED_APPROVAL_BINDING":
        if (planApproval === null || planApproval !== computeCanonicalJsonFingerprint(event.payload.approvalBinding)) return "legacy_bridge_ambiguous_final_state";
        break;
      case "REOPEN_REQUIRED":
      case "REVIEW_NON_CONVERGENT":
        if (event.payload.lineageIds.some((id) => !findings.has(id))) return "legacy_bridge_invalid_sequence";
        stopped = "terminal";
        break;
      case "ROUND_LIMIT_EXHAUSTED":
        stopped = "terminal";
        break;
      case "EXECUTION_SUSPENDED":
        stopped = "execution";
        break;
      case "ORCHESTRATION_RESUMED":
        stopped = null;
        break;
      default: { const exhaustive: never = event; return exhaustive; }
    }
  }
  if ([...findings.values()].some((finding) => finding.status === "remediated")
    || planApproval !== null && !events.some((event) => event.eventType === "COMPLETED_APPROVAL_BINDING")) return "legacy_bridge_ambiguous_partial_commit";
  return null;
}

function immutableSnapshot(input: LegacyGateSnapshot): LegacyGateSnapshot {
  const snapshot = structuredClone({ ...input, eventsBytes: Array.from(input.eventsBytes),
    dispatchesBytes: input.dispatchesBytes === null ? null : Array.from(input.dispatchesBytes) });
  return freezeTree(snapshot);
}

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

const publicationChains = new WeakMap<ReviewGateEventStore, Promise<void>>();

/** The caller supplies a separate authority store; populated original V1 journals are rejected. */
export function publishVerifiedLegacyBridge(
  input: VerifiedLegacyGate, store: ReviewGateEventStore,
): Promise<"committed" | "already_committed"> {
  const prior = publicationChains.get(store) ?? Promise.resolve();
  const next = prior.then(() => publishBridge(input, store));
  publicationChains.set(store, next.then(() => undefined, () => undefined));
  return next;
}

async function publishBridge(
  input: VerifiedLegacyGate, store: ReviewGateEventStore,
): Promise<"committed" | "already_committed"> {
  const checked = verifyLegacyContinuation(input.snapshot);
  if (checked.kind !== "VERIFIED" || checked.value.bridgeDigest !== input.bridgeDigest
    || computeCanonicalJsonFingerprint(checked.value) !== computeCanonicalJsonFingerprint(input)) throw new Error("legacy_bridge_verification_mismatch");
  const gateId = input.snapshot.gateId;
  const frontier = await store.readFrontierHash(gateId);
  const current = await store.readEvents(gateId);
  if (await store.readFrontierHash(gateId) !== frontier) throw new Error("review_gate_publication_cas_conflict");
  const markers = current.map((event) => event.eventType === "EXECUTION_SUSPENDED" ? decodeLegacyBridgeMarkerReason(event.payload.reason) : undefined);
  if (current.length > 0 && markers.some((marker) => marker === undefined)) throw new Error("legacy_bridge_original_journal_not_destination");
  if (markers.some((marker) => marker?.bridgeDigest !== input.bridgeDigest)) throw new Error("legacy_bridge_digest_conflict");
  if (current.some((event) => event.gateId !== gateId || event.epochId !== input.finalEpochId
    || event.writerId !== input.writerId)) throw new Error("legacy_bridge_marker_identity_mismatch");
  if (markers.length > 2 || markers[0]?.kind === "committed"
    || markers.length === 2 && markers[1]?.kind !== "committed") throw new Error("legacy_bridge_marker_order_invalid");
  if (markers[1]?.kind === "committed") return "already_committed";
  const kinds: readonly ("prepared" | "committed")[] = current.length === 0 ? ["prepared", "committed"] : ["committed"];
  let expected = frontier;
  for (const kind of kinds) {
    const marker = validateReviewGateEventRecord({ eventType: "EXECUTION_SUSPENDED", gateId,
      writerId: input.writerId, epochId: input.finalEpochId, emittedAt: new Date().toISOString(),
      payload: { reason: encodeLegacyBridgeMarkerReason(kind, input.bridgeDigest) } });
    if ("schemaVersion" in marker) throw new Error("legacy_bridge_marker_invalid");
    if (typeof store.publishEvents === "function") {
      expected = (await store.publishEvents(gateId, [marker], expected)).frontierHash;
    } else {
      if (await store.readFrontierHash(gateId) !== expected) throw new Error("review_gate_publication_cas_conflict");
      await store.appendEvents(gateId, [marker]);
      expected = await store.readFrontierHash(gateId);
    }
  }
  return "committed";
}
