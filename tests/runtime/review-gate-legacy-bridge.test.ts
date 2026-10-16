/**
 * Task 8 — Immutable Legacy Snapshot and Atomic Continuation Bridge.
 *
 * The legacy `events.jsonl`/`dispatches.jsonl` bytes are immutable inputs:
 * verification anchors them against a pre-existing trusted frontier and fails
 * closed whenever complete authority is not provable. The bridge itself only
 * appends idempotent `LEGACY_BRIDGE_PREPARED` → `LEGACY_BRIDGE_COMMITTED`
 * marker events through the provided event store; original legacy files are
 * never rewritten.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createLegacyReviewGateEventStore,
  type ReviewGateEventStore,
  type ReviewGatePublicationResult,
} from "../../src/runtime/review-gate-event-store";
import {
  publishVerifiedLegacyBridge,
  verifyLegacyContinuation,
  type LegacyGateSnapshot,
  type LegacyVerificationResult,
  type VerifiedLegacyGate,
} from "../../src/runtime/review-gate-legacy-bridge";
import { encodeLegacyBridgeMarkerReason } from "../../src/core/review-gate/legacy-execution";
import type { ReviewGateEvent } from "../../src/core/review-gate-types";
import { computeArtifactDigest, computeCanonicalJsonFingerprint } from "../../src/core/review-gate/identity";
import { validateReviewGateEventRecord } from "../../src/core/review-gate/event-schema";

// ---------------------------------------------------------------------------
// Deterministic legacy fixtures
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const digestOf = (index: number): string =>
  computeArtifactDigest(textEncoder.encode(`fixture-bytes-${index}`));

const GATE_ID = "legacy-gate-alpha";
const EPOCH_1 = "epoch-alpha-1";
const WRITER = "justice-core";
const T0 = "2026-09-01T00:00:00.000Z";
const T1 = "2026-09-01T00:05:00.000Z";
const T2 = "2026-09-01T00:10:00.000Z";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/alpha-plan.md";

const designBinding = Object.freeze({
  canonicalPath: DESIGN_PATH,
  digest: digestOf(1),
  gitMode: "100644" as const,
});
const planBinding = Object.freeze({
  canonicalPath: PLAN_PATH,
  digest: digestOf(2),
  gitMode: "100644" as const,
});
const explicitRequirements = Object.freeze({
  source: "explicit" as const,
  canonicalPath: "docs/requirements/alpha.md",
  digest: digestOf(3),
});
const autoDesignRequirements = Object.freeze({
  source: "auto_design_reference" as const,
  canonicalPath: DESIGN_PATH,
  digest: digestOf(1),
});

type RawEvent = Record<string, unknown>;

function gateCreated(requirements: RawEvent): RawEvent {
  return {
    eventType: "GATE_CREATED",
    gateId: GATE_ID,
    writerId: WRITER,
    epochId: EPOCH_1,
    emittedAt: T0,
    payload: {
      reviewScopeId: "scope-alpha",
      designArtifact: designBinding,
      planArtifact: planBinding,
      requirementsResolution: requirements,
      reviewProtocolFingerprint: "rt-protocol-1",
    },
  };
}

function event(
  eventType: string,
  payload: RawEvent,
  overrides?: Readonly<{ emittedAt?: string; epochId?: string }>,
): RawEvent {
  return {
    eventType,
    gateId: GATE_ID,
    writerId: WRITER,
    epochId: overrides?.epochId ?? EPOCH_1,
    emittedAt: overrides?.emittedAt ?? T1,
    payload,
  };
}

const approvalBinding = Object.freeze({
  reviewScopeId: "scope-alpha",
  gateId: GATE_ID,
  designArtifact: designBinding,
  planArtifact: planBinding,
  requirementsResolution: explicitRequirements,
  reviewProtocolFingerprint: "rt-protocol-1",
  designProtocolFingerprint: "rt-design-1",
  planProtocolFingerprint: "rt-plan-1",
  approvedAt: T2,
});

const suspendedHistory: readonly RawEvent[] = [
  gateCreated(explicitRequirements),
  event("FINDING_DISCOVERED", {
    lineageId: "lineage-1",
    findingId: "finding-1",
    observedPhase: "design",
    ownerScope: "design",
    descriptionDigest: digestOf(4),
  }),
  event("EXECUTION_SUSPENDED", { reason: "review_dispatch_unavailable" }, { emittedAt: T2 }),
];

const completedHistory: readonly RawEvent[] = [
  gateCreated(explicitRequirements),
  event("FINDING_DISCOVERED", {
    lineageId: "lineage-1",
    findingId: "finding-1",
    observedPhase: "design",
    ownerScope: "design",
    descriptionDigest: digestOf(4),
  }),
  event("FINDING_REMEDIATED", {
    lineageId: "lineage-1",
    findingId: "finding-1",
    remediationRound: { phase: "design", ordinal: 1 },
  }),
  event("FINDING_SELF_REVIEWED", {
    lineageId: "lineage-1",
    findingId: "finding-1",
    remediationRound: { phase: "design", ordinal: 1 },
  }),
  event("DESIGN_CLEAR", { designProtocolFingerprint: "rt-design-1" }),
  event("PLAN_CLEAR", { completedApprovalBinding: approvalBinding }),
  event("COMPLETED_APPROVAL_BINDING", { approvalBinding }, { emittedAt: T2 }),
];

const dispatchRecord = Object.freeze({
  dispatchId: "disp-1",
  operationId: "op-1",
  operation: "review_candidates",
  phase: "design",
  dispatchedAt: T1,
  completedAt: T1,
});

function jsonlBytes(records: readonly RawEvent[]): Uint8Array {
  const text =
    records.length === 0 ? "" : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  return textEncoder.encode(text);
}

const EMPTY_BYTES = textEncoder.encode("");

const REQUIREMENTS_AUTHORITY_REF = Object.freeze({
  refKind: "requirements_authority" as const,
  refId: "recovery-requirements-1",
  storeDigest: digestOf(3),
  canonicalPath: explicitRequirements.canonicalPath,
  gitBlobOid: "a".repeat(40),
  commitOid: "b".repeat(40),
});

const COMMIT_REF = Object.freeze({
  refKind: "prepared_commit" as const, refId: "commit-round-1", storeDigest: digestOf(8),
  disposition: "committed" as const, phase: "design" as const, roundOrdinal: 1,
  commitOid: "c".repeat(40), lineageIds: ["lineage-1"],
});

type SnapshotInput = Readonly<{
  eventsBytes?: Uint8Array;
  dispatchesBytes?: Uint8Array | null;
  trustedFrontier?: LegacyGateSnapshot["trustedFrontier"];
  recoveryObjectRefs?: LegacyGateSnapshot["recoveryObjectRefs"];
  gateId?: string;
  scopeIdentity?: LegacyGateSnapshot["scopeIdentity"];
  gitIdentity?: LegacyGateSnapshot["gitIdentity"];
}>;

function buildSnapshot(input: SnapshotInput = {}): LegacyGateSnapshot {
  const eventsBytes = input.eventsBytes ?? jsonlBytes(suspendedHistory);
  const dispatchesBytes = input.dispatchesBytes ?? jsonlBytes([dispatchRecord]);
  const refs = input.recoveryObjectRefs ?? [REQUIREMENTS_AUTHORITY_REF, COMMIT_REF];
  const scopeIdentity = input.scopeIdentity ?? { reviewScopeId: "scope-alpha", canonicalDesignPath: DESIGN_PATH, canonicalPlanPath: PLAN_PATH };
  const gitIdentity = input.gitIdentity ?? { workspaceIdentity: "workspace-alpha", designGitMode: "100644" as const, planGitMode: "100644" as const };
  return Object.freeze({
    gateId: input.gateId ?? GATE_ID,
    eventsBytes,
    dispatchesBytes,
    recoveryObjectRefs: refs,
    trustedFrontier:
      input.trustedFrontier === undefined
        ? Object.freeze({
            eventsDigest: computeArtifactDigest(eventsBytes),
            dispatchesDigest: computeArtifactDigest(dispatchesBytes ?? EMPTY_BYTES),
            recoveryRefsDigest: computeCanonicalJsonFingerprint(refs),
            scopeGitDigest: computeCanonicalJsonFingerprint([scopeIdentity, gitIdentity]),
            generationOrdinal: 1,
            observedAt: T2,
          })
        : input.trustedFrontier,
    scopeIdentity:
      input.scopeIdentity ??
      Object.freeze({
        reviewScopeId: "scope-alpha",
        canonicalDesignPath: DESIGN_PATH,
        canonicalPlanPath: PLAN_PATH,
      }),
    gitIdentity:
      input.gitIdentity ??
      Object.freeze({
        workspaceIdentity: "workspace-alpha",
        designGitMode: "100644" as const,
        planGitMode: "100644" as const,
      }),
  });
}

/** Unwrap a verification result or fail the test with the BLOCK reason. */
function assertVerified(result: LegacyVerificationResult): VerifiedLegacyGate {
  if (result.kind !== "VERIFIED") throw new Error(`expected VERIFIED, got ${JSON.stringify(result)}`);
  return result.value;
}

/** Reasons of the LEGACY_BRIDGE marker events recorded in a store. */
function bridgeMarkerReasons(events: readonly ReviewGateEvent[]): readonly string[] {
  return events
    .filter(
      (entry): entry is Extract<ReviewGateEvent, { eventType: "EXECUTION_SUSPENDED" }> =>
        entry.eventType === "EXECUTION_SUSPENDED" &&
        typeof entry.payload.reason === "string" &&
        entry.payload.reason.startsWith("LEGACY_BRIDGE:"),
    )
    .map((entry) => entry.payload.reason);
}

// ---------------------------------------------------------------------------
// Verification — fail-closed BLOCK matrix
// ---------------------------------------------------------------------------

describe("legacy continuation verification", () => {
  it("blocks a terminal stop followed by CLEAR without provable reentry", () => {
    const events = jsonlBytes([
      ...completedHistory.slice(0, 4), event("REVIEW_NON_CONVERGENT", { phase: "design", lineageIds: ["lineage-1"] }),
      ...completedHistory.slice(4),
    ]);
    expect(verifyLegacyContinuation(buildSnapshot({ eventsBytes: events }))).toEqual({
      kind: "BLOCK", reason: "legacy_bridge_invalid_sequence",
    });
  });

  it("blocks historical inherited CLEAR recorded against an unrelated epoch", () => {
    const inherited = event("DESIGN_CLEAR_INHERITED", { inheritedFromGateId: "older-gate", designProtocolFingerprint: "rt-design-0" }, { epochId: "unrelated-epoch" });
    const ref = { refKind: "inherited_clear" as const, refId: "inherited-proof-2", predecessorGateId: "older-gate", storeDigest: computeCanonicalJsonFingerprint(inherited) };
    const events = jsonlBytes([...completedHistory.slice(0, 1), inherited]);
    expect(verifyLegacyContinuation(buildSnapshot({ eventsBytes: events, recoveryObjectRefs: [REQUIREMENTS_AUTHORITY_REF, ref] }))).toEqual({
      kind: "BLOCK", reason: "legacy_bridge_ambiguous_epoch",
    });
  });
  it("blocks a self-review without its preceding remediation", () => {
    const events = jsonlBytes([...suspendedHistory.slice(0, 2), ...completedHistory.slice(3, 4)]);
    expect(verifyLegacyContinuation(buildSnapshot({ eventsBytes: events }))).toEqual({
      kind: "BLOCK", reason: "legacy_bridge_invalid_sequence",
    });
  });

  it("blocks a partially remediated round even when an unrelated commit proof exists", () => {
    const events = jsonlBytes(completedHistory.slice(0, 3));
    expect(verifyLegacyContinuation(buildSnapshot({ eventsBytes: events }))).toEqual({
      kind: "BLOCK", reason: "legacy_bridge_ambiguous_partial_commit",
    });
  });

  it("blocks a round whose commit proof does not cover its lineage", () => {
    const events = jsonlBytes(completedHistory);
    expect(verifyLegacyContinuation(buildSnapshot({
      eventsBytes: events, recoveryObjectRefs: [REQUIREMENTS_AUTHORITY_REF, { ...COMMIT_REF, lineageIds: ["other-lineage"] }],
    }))).toEqual({ kind: "BLOCK", reason: "legacy_bridge_commit_resolution_unproven" });
  });

  it("blocks a completed binding inconsistent with the original Requirements identity", () => {
    const wrong = { ...approvalBinding, requirementsResolution: { ...explicitRequirements, digest: digestOf(19) } };
    const events = jsonlBytes([
      ...completedHistory.slice(0, 5), event("PLAN_CLEAR", { completedApprovalBinding: wrong }),
      event("COMPLETED_APPROVAL_BINDING", { approvalBinding: wrong }),
    ]);
    expect(verifyLegacyContinuation(buildSnapshot({ eventsBytes: events }))).toEqual({
      kind: "BLOCK", reason: "legacy_bridge_approval_binding_mismatch",
    });
  });

  it("blocks completed approval without the preceding Plan clear", () => {
    const events = jsonlBytes([...completedHistory.slice(0, 1), ...completedHistory.slice(6, 7)]);
    expect(verifyLegacyContinuation(buildSnapshot({ eventsBytes: events }))).toEqual({
      kind: "BLOCK", reason: "legacy_bridge_ambiguous_final_state",
    });
  });

  it("blocks outstanding dispatches instead of inventing a redelivery cursor", () => {
    expect(verifyLegacyContinuation(buildSnapshot({ dispatchesBytes: jsonlBytes([{ ...dispatchRecord, completedAt: null }]) }))).toEqual({
      kind: "BLOCK", reason: "legacy_bridge_ambiguous_partial_commit",
    });
  });
  it("blocks a structurally well-formed history that has no pre-existing trusted frontier", () => {
    const result = verifyLegacyContinuation(buildSnapshot({ trustedFrontier: null }));
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_unanchored" });
  });

  it("blocks when the trusted frontier does not match the original bytes", () => {
    const anchored = buildSnapshot();
    const tampered = jsonlBytes([
      ...suspendedHistory,
      event("EXECUTION_SUSPENDED", { reason: "tampered-after-anchor" }),
    ]);
    const result = verifyLegacyContinuation(
      buildSnapshot({ eventsBytes: tampered, trustedFrontier: anchored.trustedFrontier }),
    );
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_trusted_frontier_mismatch" });
  });

  it("blocks an ambiguous partial round with conflicting duplicate round markers", () => {
    const ambiguous = jsonlBytes([
      ...suspendedHistory,
      event("FINDING_REMEDIATED", {
        lineageId: "lineage-1",
        findingId: "finding-1",
        remediationRound: { phase: "design", ordinal: 1 },
      }),
      event(
        "FINDING_REMEDIATED",
        {
          lineageId: "lineage-1",
          findingId: "finding-1",
          remediationRound: { phase: "design", ordinal: 1 },
        },
        { emittedAt: T2 },
      ),
    ]);
    const result = verifyLegacyContinuation(buildSnapshot({ eventsBytes: ambiguous }));
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_ambiguous_round" });
  });

  it("blocks multiple final states when a mutation follows the completed approval binding", () => {
    const events = jsonlBytes([
      ...completedHistory,
      event("EXECUTION_SUSPENDED", { reason: "post-completion" }, { emittedAt: T2 }),
    ]);
    const result = verifyLegacyContinuation(buildSnapshot({ eventsBytes: events }));
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_ambiguous_final_state" });
  });

  it("blocks old auto_design_reference requirements without independent original proof", () => {
    const events = jsonlBytes([gateCreated(autoDesignRequirements), ...suspendedHistory.slice(1)]);
    const result = verifyLegacyContinuation(buildSnapshot({ eventsBytes: events }));
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_requirements_unproven" });
  });

  it("blocks an explicit V1 gate whose recovered requirements authority does not match", () => {
    const mismatchedRef = Object.freeze({
      refKind: "requirements_authority" as const,
      refId: "recovery-requirements-other-gate",
      storeDigest: digestOf(9),
    });
    const result = verifyLegacyContinuation(buildSnapshot({ recoveryObjectRefs: [mismatchedRef] }));
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_requirements_unproven" });
  });

  it("blocks a legacy journal that contains a V2 typed event", () => {
    const v2Event: RawEvent = {
      schemaVersion: 2,
      eventId: "evt-2",
      parentEventId: "evt-1",
      emittedAt: T1,
      gateId: GATE_ID,
      epochId: EPOCH_1,
      generationId: "gen-alpha",
      writerId: WRITER,
      eventType: "EXTERNAL_OPERATION_DISPATCHED",
      payload: {
        eventType: "EXTERNAL_OPERATION_DISPATCHED",
        gateId: GATE_ID,
        generationId: "gen-alpha",
        epochId: EPOCH_1,
        operationId: "op-1",
        dispatchAttemptId: "att-1",
        phase: "design",
        role: "reviewer",
        candidateOrTargetSetDigest: digestOf(5),
        inputBindingDigest: digestOf(6),
        protocolFingerprint: "rt-protocol-1",
        expectedWitnessFrontier: digestOf(7),
        protectedLeaseProofDigest: null,
      },
    };
    const events = jsonlBytes([gateCreated(explicitRequirements), v2Event]);
    const result = verifyLegacyContinuation(buildSnapshot({ eventsBytes: events }));
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_v2_event_present" });
  });

  it("blocks a torn (non newline-terminated) journal tail as an ambiguous partial commit", () => {
    const anchored = buildSnapshot();
    const torn = textEncoder.encode(
      `${suspendedHistory.map((record) => JSON.stringify(record)).join("\n")}\n{"eventType":"EXECUTION_SUSPEND`,
    );
    const result = verifyLegacyContinuation(
      buildSnapshot({ eventsBytes: torn, trustedFrontier: anchored.trustedFrontier }),
    );
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_ambiguous_partial_commit" });
  });

  it("blocks a snapshot whose canonical scope identity does not anchor to the pinned history", () => {
    const result = verifyLegacyContinuation(
      buildSnapshot({
        scopeIdentity: Object.freeze({
          reviewScopeId: "scope-alpha",
          canonicalDesignPath: "docs/specs/other-design.md",
          canonicalPlanPath: PLAN_PATH,
        }),
      }),
    );
    expect(result).toEqual({ kind: "BLOCK", reason: "legacy_bridge_scope_identity_mismatch" });
  });
});

// ---------------------------------------------------------------------------
// Verification — verified continuations
// ---------------------------------------------------------------------------

describe("legacy continuation verification — verified gates", () => {
  it("accepts historical auto references only when the independent original Requirements document is bound", () => {
    const events = jsonlBytes([gateCreated({ ...explicitRequirements, source: "auto_design_reference" })]);
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot({ eventsBytes: events })));
    expect(verified.requirementsResolution.source).toBe("auto_design_reference");
    expect(verified.requirementsResolution.canonicalPath).toBe(explicitRequirements.canonicalPath);
  });
  it("copies and freezes the original bytes and all returned evidence", () => {
    const snapshot = buildSnapshot();
    const verified = assertVerified(verifyLegacyContinuation(snapshot));
    const original = Array.from(verified.snapshot.eventsBytes);
    if (snapshot.eventsBytes instanceof Uint8Array) snapshot.eventsBytes.fill(0);
    expect(Array.from(verified.snapshot.eventsBytes)).toEqual(original);
    expect(Object.isFrozen(verified.snapshot.eventsBytes)).toBe(true);
    expect(Object.isFrozen(verified.commitResolutionBindings)).toBe(true);
  });
  it("verifies a complete anchored suspended legacy gate with deterministic counters and cursor", () => {
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot()));
    expect(verified.snapshot.gateId).toBe(GATE_ID);
    expect(verified.finalEpochId).toBe(EPOCH_1);
    expect(verified.epochCounters).toEqual({
      generationOrdinal: 1,
      epochCount: 1,
      designRoundCount: 0,
      planRoundCount: 0,
    });
    expect(verified.resumeCursor).toEqual({
      kind: "resume_execution",
      cursor: { epochId: EPOCH_1, startedAt: T2 },
    });
    expect(verified.commitBinding).toBeNull();
    expect(verified.requirementsResolution).toEqual(explicitRequirements);
    expect(verified.bridgeDigest).toMatch(/^[0-9a-f]{64}$/u);
    // Verification is deterministic: identical snapshots derive identical
    // counters, cursor and bridge digest.
    const replayed = assertVerified(verifyLegacyContinuation(buildSnapshot()));
    expect(replayed.bridgeDigest).toBe(verified.bridgeDigest);
    expect(replayed.resumeCursor).toEqual(verified.resumeCursor);
    expect(replayed.epochCounters).toEqual(verified.epochCounters);
  });

  it("verifies a completed gate and carries the commit binding without inventing rounds", () => {
    const verified = assertVerified(
      verifyLegacyContinuation(buildSnapshot({ eventsBytes: jsonlBytes(completedHistory) })),
    );
    expect(verified.commitBinding).toEqual(approvalBinding);
    expect(verified.resumeCursor).toEqual({ kind: "completed" });
    expect(verified.epochCounters).toEqual({
      generationOrdinal: 1,
      epochCount: 1,
      designRoundCount: 1,
      planRoundCount: 0,
    });
  });

  it("reads a valid historical DESIGN_CLEAR_INHERITED as recognized history without granting new authority", () => {
    const inherited: RawEvent = {
      eventType: "DESIGN_CLEAR_INHERITED",
      gateId: GATE_ID,
      writerId: WRITER,
      epochId: EPOCH_1,
      emittedAt: T1,
      payload: { inheritedFromGateId: "older-gate", designProtocolFingerprint: "rt-design-0" },
    };
    const events = jsonlBytes([gateCreated(explicitRequirements), inherited]);
    const inheritedRef = {
      refKind: "inherited_clear" as const, refId: "inherited-proof-1",
      predecessorGateId: "older-gate", storeDigest: computeCanonicalJsonFingerprint(inherited),
    };
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot({
      eventsBytes: events, recoveryObjectRefs: [REQUIREMENTS_AUTHORITY_REF, inheritedRef],
    })));
    expect(verified.historicalInheritedClears).toEqual([
      { eventType: "DESIGN_CLEAR_INHERITED", epochId: EPOCH_1, emittedAt: T1 },
    ]);
    // The inherited historical clear never becomes new authority: the
    // continuation remains in the design phase with a plain review cursor.
    expect(verified.resumeCursor.kind).toBe("review");
    expect(verified.commitBinding).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Atomic publication (idempotent LEGACY_BRIDGE markers)
// ---------------------------------------------------------------------------

describe("legacy continuation bridge publication", () => {
  const tempRoots: string[] = [];
  afterAll(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createTempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), prefix));
    tempRoots.push(root);
    return root;
  }

  it("rejects markers bearing a different historical writer identity", async () => {
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot()));
    const store = createLegacyReviewGateEventStore(await createTempRoot("legacy-bridge-wrong-writer-"));
    const prepared = validateReviewGateEventRecord({
      eventType: "EXECUTION_SUSPENDED", gateId: GATE_ID, writerId: "foreign-writer", epochId: EPOCH_1,
      emittedAt: T2, payload: { reason: encodeLegacyBridgeMarkerReason("prepared", verified.bridgeDigest) },
    });
    await store.publishEvents(GATE_ID, [prepared], await store.readFrontierHash(GATE_ID));
    await expect(publishVerifiedLegacyBridge(verified, store)).rejects.toThrow("legacy_bridge_marker_identity_mismatch");
  });

  it("serializes competing append-only continuation publications without duplicate markers", async () => {
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot()));
    const store = createLegacyReviewGateEventStore(await createTempRoot("legacy-bridge-concurrent-"));
    Object.defineProperty(store, "publishEvents", { value: undefined });
    expect(await Promise.all([publishVerifiedLegacyBridge(verified, store), publishVerifiedLegacyBridge(verified, store)])).toEqual([
      "committed", "already_committed",
    ]);
    expect(bridgeMarkerReasons(await store.readEvents(GATE_ID))).toHaveLength(2);
  });

  it("refuses the original populated legacy store as the bridge destination", async () => {
    const root = await createTempRoot("legacy-bridge-original-destination-");
    const gateDir = path.join(root, ".justice", "review-gates", GATE_ID);
    await mkdir(gateDir, { recursive: true });
    const bytes = jsonlBytes(suspendedHistory);
    await writeFile(path.join(gateDir, "events.jsonl"), bytes);
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot({ eventsBytes: bytes })));
    await expect(publishVerifiedLegacyBridge(verified, createLegacyReviewGateEventStore(root))).rejects.toThrow("legacy_bridge_original_journal_not_destination");
    expect(await readFile(path.join(gateDir, "events.jsonl"))).toEqual(Buffer.from(bytes));
  });

  it("preserves the spent round after commit and repeated bridge publication", async () => {
    const root = await createTempRoot("legacy-bridge-rounds-");
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot({ eventsBytes: jsonlBytes(completedHistory) })));
    const store = createLegacyReviewGateEventStore(root);
    expect(await publishVerifiedLegacyBridge(verified, store)).toBe("committed");
    expect(await publishVerifiedLegacyBridge(verified, store)).toBe("already_committed");
    const replayed = assertVerified(verifyLegacyContinuation(verified.snapshot));
    expect(replayed.epochCounters.designRoundCount).toBe(1);
    expect(bridgeMarkerReasons(await store.readEvents(GATE_ID))).toHaveLength(2);
  });

  it("publishes prepared and committed markers exactly once and never rewrites the original JSONL", async () => {
    const originalRoot = await createTempRoot("legacy-bridge-original-");
    const authorityRoot = await createTempRoot("legacy-bridge-authority-");
    const gateDir = path.join(originalRoot, ".justice", "review-gates", GATE_ID);
    await mkdir(gateDir, { recursive: true });
    await writeFile(path.join(gateDir, "events.jsonl"), jsonlBytes(suspendedHistory));
    await writeFile(path.join(gateDir, "dispatches.jsonl"), jsonlBytes([dispatchRecord]));

    const snapshot = buildSnapshot({
      eventsBytes: await readFile(path.join(gateDir, "events.jsonl")),
      dispatchesBytes: await readFile(path.join(gateDir, "dispatches.jsonl")),
    });
    const verified = assertVerified(verifyLegacyContinuation(snapshot));

    const store = createLegacyReviewGateEventStore(authorityRoot);
    expect(await publishVerifiedLegacyBridge(verified, store)).toBe("committed");

    const preparedReason = encodeLegacyBridgeMarkerReason("prepared", verified.bridgeDigest);
    const committedReason = encodeLegacyBridgeMarkerReason("committed", verified.bridgeDigest);
    expect(bridgeMarkerReasons(await store.readEvents(GATE_ID))).toEqual([
      preparedReason,
      committedReason,
    ]);
    // No lineage/epoch/round/requirements provenance is invented by the bridge.
    expect(
      (await store.readEvents(GATE_ID)).some((entry) => entry.eventType.startsWith("FINDING_")),
    ).toBe(false);

    // Idempotency: the same verified gate republishes as already committed.
    expect(await publishVerifiedLegacyBridge(verified, store)).toBe("already_committed");
    expect(bridgeMarkerReasons(await store.readEvents(GATE_ID))).toEqual([
      preparedReason,
      committedReason,
    ]);

    // The original legacy JSONL bytes remain immutable on disk.
    expect(Buffer.from(await readFile(path.join(gateDir, "events.jsonl")))).toEqual(
      Buffer.from(snapshot.eventsBytes),
    );
    expect(Buffer.from(await readFile(path.join(gateDir, "dispatches.jsonl")))).toEqual(
      Buffer.from(snapshot.dispatchesBytes ?? EMPTY_BYTES),
    );
  });

  it("falls back to appendEvents when the store has no publishEvents surface", async () => {
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot()));
    const base = createLegacyReviewGateEventStore(await createTempRoot("legacy-bridge-fallback-"));
    const store = base;
    Object.defineProperty(store, "publishEvents", { value: undefined });
    expect(await publishVerifiedLegacyBridge(verified, store)).toBe("committed");
    expect(await publishVerifiedLegacyBridge(verified, store)).toBe("already_committed");
    const recorded = await store.readEvents(GATE_ID);
    expect(bridgeMarkerReasons(recorded)).toHaveLength(2);
    // The fallback path never writes a second generation of markers.
    expect(recorded.filter((entry) => entry.eventType === "EXECUTION_SUSPENDED")).toHaveLength(2);
  });

  it("completes a crashed prepared-only bridge on restart without doubling markers", async () => {
    const crashRoot = await createTempRoot("legacy-bridge-crash-");
    const verified = assertVerified(verifyLegacyContinuation(buildSnapshot()));
    const preparedReason = encodeLegacyBridgeMarkerReason("prepared", verified.bridgeDigest);
    const committedReason = encodeLegacyBridgeMarkerReason("committed", verified.bridgeDigest);

    // Crash between LEGACY_BRIDGE_PREPARED and LEGACY_BRIDGE_COMMITTED.
    const crashStore = crashAfterSecondBridgeWrite(createLegacyReviewGateEventStore(crashRoot));
    await expect(publishVerifiedLegacyBridge(verified, crashStore)).rejects.toThrow(
      /bridge_crash_test/,
    );

    const restartedStore = createLegacyReviewGateEventStore(crashRoot);
    const staged = bridgeMarkerReasons(await restartedStore.readEvents(GATE_ID));
    expect(staged).toEqual([preparedReason]);

    expect(await publishVerifiedLegacyBridge(verified, restartedStore)).toBe("committed");
    expect(bridgeMarkerReasons(await restartedStore.readEvents(GATE_ID))).toEqual([
      preparedReason,
      committedReason,
    ]);
    expect(await publishVerifiedLegacyBridge(verified, restartedStore)).toBe("already_committed");
  });
});

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

/** Delegating store whose second-or-later bridge write crashes (simulated). */
function crashAfterSecondBridgeWrite(base: ReviewGateEventStore): ReviewGateEventStore {
  let bridgeWrites = 0;
  return {
    ...base,
    publishEvents: async (gateId, batch, expectedFrontierHash): Promise<ReviewGatePublicationResult> => {
      bridgeWrites += 1;
      if (bridgeWrites >= 2) throw new Error("bridge_crash_test");
      return base.publishEvents(gateId, batch, expectedFrontierHash);
    },
  };
}
