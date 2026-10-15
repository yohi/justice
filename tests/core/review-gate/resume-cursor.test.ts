import { describe, expect, it } from "vitest";
import type {
  EpochId,
  GateId,
  LineageId,
  ReviewGateProjection,
  ReviewScopeId,
  VerifiedDispatchRecoveryCursorV1,
} from "../../../src/core/review-gate/types.js";
import { deriveResumeCursor } from "../../../src/core/review-gate/resume-cursor.js";

const gateId = "gate-1" as GateId;
const scopeId = "scope-1" as ReviewScopeId;
const epochId = "epoch-1" as EpochId;
const epochStartedAt = "2026-10-15T00:00:00.000Z";
const lineageId = "lineage-upstream" as LineageId;

function recoveryCursor(
  overrides: Partial<VerifiedDispatchRecoveryCursorV1> = {},
): VerifiedDispatchRecoveryCursorV1 {
  return {
    kind: "RESPONSE_STAGED",
    gateId,
    generationId: "generation-1",
    epochId,
    operationId: "operation-1",
    dispatchAttemptId: "attempt-1",
    role: "reviewer",
    candidateOrTargetSetDigest: "candidate-digest-1",
    inputBindingDigest: "input-binding-digest-1",
    protocolFingerprint: "review-protocol-1",
    dispatchEventId: "dispatch-event-1",
    dispatchFrontierHash: "frontier-hash-1",
    responseEvidence: {
      operationId: "operation-1",
      dispatchAttemptId: "attempt-1",
      contentDigest: "content-digest-1",
      byteLength: 1024,
      privateStoreRecordId: "private-store-1",
      policyVersion: "policy-1",
    },
    resultEventId: null,
    outcomeAppliedEventId: null,
    redeliveryEvidenceDigest: null,
    ...overrides,
  };
}

function projection(overrides: Partial<ReviewGateProjection> = {}): ReviewGateProjection {
  return Object.freeze({
    reviewScopeId: scopeId,
    gateId,
    status: "active",
    phase: "design",
    epoch: { epochId, startedAt: epochStartedAt, reason: "gate_created" },
    designRemediationRounds: [],
    planRemediationRounds: [],
    findings: new Map(),
    suspensionReason: null,
    approvalBinding: null,
    supersedesGateId: null,
    effectiveDesignClear: null,
    planClearMilestone: null,
    workspaceStates: new Map(),
    currentRemediableBlockers: [],
    currentUpstreamBlockers: [],
    pendingRevalidationBlockers: [],
    phaseBaselineRevision: 0,
    phaseReviewContextIdentity: "phase-context-1",
    dispatchRecoveryCursors: [],
    ...overrides,
  });
}

describe("deriveResumeCursor dispatch recovery", () => {
  it("returns a plain review cursor for a clean active phase without recovery cursors", () => {
    expect(deriveResumeCursor(projection())).toEqual({ kind: "review" });
  });

  it("returns the first RESPONSE_STAGED recovery cursor for a clean active phase", () => {
    const recovery = recoveryCursor({ kind: "RESPONSE_STAGED" });
    const cursor = deriveResumeCursor(projection({ dispatchRecoveryCursors: [recovery] }));
    expect(cursor).toEqual({ kind: "dispatch_recovery", recovery });
    if (cursor.kind !== "dispatch_recovery") throw new Error("expected dispatch_recovery cursor");
    expect(cursor.recovery).toBe(recovery);
    expect(cursor.recovery.kind).toBe("RESPONSE_STAGED");
  });

  it("returns the first cursor when several recovery cursors are present", () => {
    const first = recoveryCursor({ operationId: "operation-1" });
    const second = recoveryCursor({ operationId: "operation-2" });
    expect(
      deriveResumeCursor(projection({ dispatchRecoveryCursors: [first, second] })),
    ).toEqual({ kind: "dispatch_recovery", recovery: first });
  });

  it("suspended states still win over dispatch recovery", () => {
    const recovery = recoveryCursor();
    expect(
      deriveResumeCursor(
        projection({
          status: "suspended",
          suspensionReason: "execution_suspended",
          dispatchRecoveryCursors: [recovery],
        }),
      ),
    ).toEqual({ kind: "resume_execution", cursor: { epochId, startedAt: epochStartedAt } });
  });

  it("upstream blockers still win over dispatch recovery", () => {
    const recovery = recoveryCursor();
    expect(
      deriveResumeCursor(
        projection({
          currentUpstreamBlockers: [lineageId],
          dispatchRecoveryCursors: [recovery],
        }),
      ),
    ).toEqual({ kind: "resolve_upstream", lineageIds: [lineageId] });
  });

  it("pending revalidation blockers still win over dispatch recovery", () => {
    const recovery = recoveryCursor();
    expect(
      deriveResumeCursor(
        projection({
          pendingRevalidationBlockers: [lineageId],
          dispatchRecoveryCursors: [recovery],
        }),
      ),
    ).toEqual({ kind: "revalidate", lineageIds: [lineageId] });
  });

  it("the current-phase remediate disposition still wins over dispatch recovery", () => {
    const recovery = recoveryCursor();
    expect(
      deriveResumeCursor(projection({ dispatchRecoveryCursors: [recovery] }), { kind: "remediate" }),
    ).toEqual({ kind: "remediate", lineageIds: [] });
  });

  it("returns a deeply frozen dispatch_recovery cursor", () => {
    const cursor = deriveResumeCursor(
      projection({ dispatchRecoveryCursors: [recoveryCursor()] }),
    );
    expect(Object.isFrozen(cursor)).toBe(true);
    if (cursor.kind !== "dispatch_recovery") throw new Error("expected dispatch_recovery cursor");
    expect(Object.isFrozen(cursor.recovery)).toBe(true);
    expect(cursor.recovery.responseEvidence).not.toBeNull();
    const responseEvidence = cursor.recovery.responseEvidence;
    if (responseEvidence === null) throw new Error("expected response evidence");
    expect(Object.isFrozen(responseEvidence)).toBe(true);
  });

  it("returns an INTENT_PRE_LAUNCH recovery cursor", () => {
    const recovery = recoveryCursor({ kind: "INTENT_PRE_LAUNCH" });
    const cursor = deriveResumeCursor(projection({ dispatchRecoveryCursors: [recovery] }));
    expect(cursor).toEqual({ kind: "dispatch_recovery", recovery });
  });

  it("returns an EVIDENCE_UNAVAILABLE recovery cursor", () => {
    const recovery = recoveryCursor({ kind: "EVIDENCE_UNAVAILABLE" });
    const cursor = deriveResumeCursor(projection({ dispatchRecoveryCursors: [recovery] }));
    expect(cursor).toEqual({ kind: "dispatch_recovery", recovery });
  });

});