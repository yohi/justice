import type {
  SemanticContextInputsV1,
  VerifiedScopeFrontier,
} from "../../../src/core/review-gate/types.js";
import { describe, expect, it } from "vitest";
import type {
  ArtifactDigest,
  EpochId,
  FindingDiscoveredV1,
  FindingId,
  FindingReopenedV1,
  GateCreatedV1,
  GateId,
  LineageId,
  ReviewGateEvent,
  ReviewScopeId,
  WriterId,
} from "../../../src/core/review-gate-types.js";
import {
  projectReviewGate,
  projectVerifiedDispatchRecoveryCursors,
  projectVerifiedGateTip,
  projectVerifiedLineageHistory,
  projectVerifiedTargetWriterAuthority,
} from "../../../src/core/review-gate/projection.js";
import { computeSemanticGoverningProjectionDigest } from "../../../src/core/review-gate/deterministic-validation.js";
import { deriveResumeCursor } from "../../../src/core/review-gate/resume-cursor.js";
import { validateReviewGateEventRecord } from "../../../src/core/review-gate/event-schema.js";

const gateId = "gate-1" as GateId;
const writerId = "writer-1" as WriterId;
const epochId = "epoch-1" as EpochId;
const lineageId = "lineage-design" as LineageId;
const findingId = "finding-design" as FindingId;
const digest = "digest-1" as ArtifactDigest;

const created = {
  eventType: "GATE_CREATED",
  gateId,
  writerId,
  epochId,
  emittedAt: "2026-10-08T00:00:00.000Z",
  payload: {
    reviewScopeId: "scope-1" as ReviewScopeId,
    designArtifact: { canonicalPath: "design.md", digest, gitMode: "100644" },
    planArtifact: { canonicalPath: "plan.md", digest, gitMode: "100644" },
    requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest },
    reviewProtocolFingerprint: "review",
  },
} satisfies GateCreatedV1;

function event<Event extends ReviewGateEvent>(
  eventType: Event["eventType"],
  payload: Event["payload"],
): Event {
  return { eventType, gateId, writerId, epochId, emittedAt: "2026-10-08T00:00:01.000Z", payload } as Event;
}

describe("projectReviewGate upstream blockers", () => {
  it("routes a reopened upstream finding to resolve_upstream", () => {
    const discovered = event<FindingDiscoveredV1>("FINDING_DISCOVERED", {
      lineageId,
      findingId,
      observedPhase: "design",
      ownerScope: "design",
      descriptionDigest: digest,
    });
    const reopened = event<FindingReopenedV1>("FINDING_REOPENED", {
      lineageId,
      findingId,
      reopenedBy: "epoch-2" as EpochId,
    });

    const projection = projectReviewGate([
      created,
      event("DESIGN_CLEAR", { designProtocolFingerprint: "design" }),
      discovered,
      reopened,
    ]);

    expect(projection.currentUpstreamBlockers).toEqual([lineageId]);
    expect(deriveResumeCursor(projection)).toEqual({ kind: "resolve_upstream", lineageIds: [lineageId] });
  });
});

function v2Target(canonicalLogicalTargetPath: string): object {
  return {
    installationId: "install-1",
    workspaceIdentity: "workspace-1",
    canonicalWorkspaceRoot: "workspace",
    canonicalLogicalTargetPath,
    targetIdentityDigest: "a".repeat(64),
    verifiedAliasSetDigest: "a".repeat(64),
    identityProofFrontier: "frontier-target",
  };
}

function v2TerminalHandoffRequested(
  eventId: string,
  parentEventId: string,
  handoffOperationId: string,
  targets: readonly string[],
): object {
  return v2Event("TARGET_WRITER_HANDOFF_REQUESTED", eventId, parentEventId, {
    purpose: "TERMINAL_REVOKE_ONLY",
    status: "REQUESTED",
    handoffOperationId,
    originalOperationId: handoffOperationId,
    scopeId: "scope-1",
    gateId: "gate-1",
    generationId: "generation-1",
    phase: "design",
    roundOrdinal: 1,
    protocolFingerprint: "a".repeat(64),
    target: v2Target(targets[0] ?? "target.md"),
    targets: targets.map(v2Target),
    closingSealOperationId: null,
    oldOwner: null,
    newOwner: null,
    expectedTargetWriterFrontier: "frontier-1",
    expectedGlobalTargetWriterGeneration: 1,
    expectedGateEventFrontier: "frontier-1",
    expectedPreImageDigest: "a".repeat(64),
    expectedGitMode: "100644",
    pendingNativeEffectReference: null,
  });
}

function v2HandoffRequested(
  eventId: string,
  parentEventId: string,
  handoffOperationId: string,
  targetPath: string,
  newOwner: object,
): object {
  return v2Event("TARGET_WRITER_HANDOFF_REQUESTED", eventId, parentEventId, {
    purpose: "HANDOFF",
    status: "REQUESTED",
    handoffOperationId,
    originalOperationId: handoffOperationId,
    scopeId: "scope-1",
    gateId: "gate-1",
    generationId: "generation-1",
    phase: "design",
    roundOrdinal: 1,
    protocolFingerprint: "a".repeat(64),
    target: v2Target(targetPath),
    targets: [],
    closingSealOperationId: null,
    oldOwner: null,
    newOwner,
    expectedTargetWriterFrontier: "frontier-1",
    expectedGlobalTargetWriterGeneration: 1,
    expectedGateEventFrontier: "frontier-1",
    expectedPreImageDigest: "a".repeat(64),
    expectedGitMode: "100644",
    pendingNativeEffectReference: null,
  });
}


function v2HandoffResumed(
  eventId: string,
  parentEventId: string,
  handoffOperationId: string,
  targetPath: string,
  newOwner: object,
): object {
  return v2Event("TARGET_WRITER_HANDOFF_RESUMED", eventId, parentEventId, {
    status: "RESUMED",
    handoffOperationId,
    originalOperationId: handoffOperationId,
    intent: {
      purpose: "HANDOFF",
      status: "RESUMED",
      handoffOperationId,
      originalOperationId: handoffOperationId,
      scopeId: "scope-1",
      gateId: "gate-1",
      generationId: "generation-1",
      phase: "design",
      roundOrdinal: 1,
      protocolFingerprint: "a".repeat(64),
      target: v2Target(targetPath),
      targets: [],
      closingSealOperationId: null,
      oldOwner: null,
      newOwner,
      expectedTargetWriterFrontier: "frontier-1",
      expectedGlobalTargetWriterGeneration: 2,
      expectedGateEventFrontier: "frontier-1",
      expectedPreImageDigest: "a".repeat(64),
      expectedGitMode: "100644",
      pendingNativeEffectReference: null,
    },
    protectedTargetFrontier: "frontier-1",
    gateEventFrontier: "frontier-1",
    globalTargetWriterGeneration: 2,
    pendingNativeEffectReference: null,
    continuationProofDigest: "b".repeat(64),
  });
}


function v2Event(
  eventType: string,
  eventId: string,
  parentEventId: string,
  payload: object,
  generationId = "generation-1",
): object {
  return {
    schemaVersion: 2,
    eventId,
    parentEventId,
    emittedAt: "2026-10-11T00:00:00.000Z",
    gateId: "gate-1",
    epochId: "epoch-1",
    generationId,
    writerId: "writer-1",
    eventType,
    payload,
  };
}


function v2TerminalRevoked(
  eventId: string,
  parentEventId: string,
  handoffOperationId: string,
  terminalTransitionOperationId: string,
  status: "REVOKED" | "NEVER_CLAIMED_OR_ALREADY_REVOKED",
  nativeEffectDisposition: string,
  targets: readonly string[],
): object {
  return v2Event("TARGET_WRITER_TERMINAL_REVOKED", eventId, parentEventId, {
    purpose: "TERMINAL_REVOKE_ONLY",
    handoffOperationId,
    terminalTransitionOperationId,
    status,
    gateId: "gate-1",
    generationId: "generation-1",
    phase: "design",
    roundOrdinal: 1,
    targets: targets.map(v2Target),
    priorOwners: [],
    globalTargetWriterHighWatermark: 1,
    protectedTargetFrontier: "frontier-1",
    protectedRevokeCasProofDigest: "a".repeat(64),
    nativeNonWriteabilityProofDigest: "a".repeat(64),
    nativeEffectDisposition,
  });
}


describe("projectVerifiedGateTip", () => {
  const digest = "a".repeat(64);

  function v2GateCreatedRecord(): object {
    return {
      schemaVersion: 2,
      eventId: "event-genesis",
      parentEventId: "event-before-genesis",
      emittedAt: "2026-10-11T00:00:00.000Z",
      gateId: "gate-1",
      epochId: "epoch-1",
      generationId: "generation-1",
      writerId: "writer-1",
      eventType: "GATE_CREATED",
      payload: {
        reviewScopeId: "scope-1",
        supersedesGateId: null,
        designArtifact: { canonicalPath: "docs/design.md", digest, gitMode: "100644" },
        planArtifact: { canonicalPath: "docs/plan.md", digest, gitMode: "100644" },
        requirementsResolution: {
          schemaVersion: 2,
          source: "explicit",
          canonicalPath: "docs/requirements.md",
          digest,
          gitMode: "100644",
          requirementsGitBlobOid: "requirements-blob-1",
          committedBaselineOid: "baseline-commit-1",
          workspaceIdentity: "workspace-1",
          selectionEvidence: { commandPath: "--requirements docs/requirements.md" },
        },
        reviewProtocolFingerprint: "review-protocol-1",
        designProtocolFingerprint: "design-protocol-1",
        planProtocolFingerprint: "plan-protocol-1",
      },
    };
  }


  function v2Dispatch(
    phase: "design" | "plan",
    eventId: string,
    parentEventId: string,
    role = "reviewer",
    generationId = "generation-1",
    operationId = `operation-${eventId}`,
  ): object {
    return v2Event("EXTERNAL_OPERATION_DISPATCHED", eventId, parentEventId, {
      eventType: "EXTERNAL_OPERATION_DISPATCHED",
      gateId: "gate-1",
      generationId,
      epochId: "epoch-1",
      operationId,
      dispatchAttemptId: `attempt-${eventId}`,
      phase,
      role,
      candidateOrTargetSetDigest: digest,
      inputBindingDigest: digest,
      protocolFingerprint: digest,
      expectedWitnessFrontier: digest,
      protectedLeaseProofDigest: role === "remediator" ? digest : null,
    }, generationId);
  }

  function frontier(): object {
    return {
      workspaceIdentity: "workspace-1",
      workspaceEnrollmentId: "enrollment-1",
      scopes: [],
      writerHeads: [],
      globalFrontierHash: "frontier-1",
    };
  }

  function v2ResponseStaged(
    eventId: string,
    parentEventId: string,
    operationId: string,
    dispatchAttemptId: string,
  ): object {
    return v2Event("EXTERNAL_OPERATION_RESPONSE_STAGED", eventId, parentEventId, {
      eventType: "EXTERNAL_OPERATION_RESPONSE_STAGED",
      gateId: "gate-1",
      generationId: "generation-1",
      epochId: "epoch-1",
      operationId,
      dispatchAttemptId,
      responseEvidence: {
        operationId,
        dispatchAttemptId,
        contentDigest: digest,
        byteLength: 1024,
        privateStoreRecordId: `${operationId}:${dispatchAttemptId}`,
        policyVersion: "1",
      },
    });
  }

  function v2ResultCommitted(
    eventId: string,
    parentEventId: string,
    operationId: string,
    dispatchAttemptId: string,
    resultEventId: string,
    redeliveryEvidenceDigest: string | null = null,
  ): object {
    return v2Event("EXTERNAL_OPERATION_RESULT_COMMITTED", eventId, parentEventId, {
      eventType: "EXTERNAL_OPERATION_RESULT_COMMITTED",
      gateId: "gate-1",
      generationId: "generation-1",
      epochId: "epoch-1",
      operationId,
      dispatchAttemptId,
      resultEventId,
      redeliveryEvidenceDigest,
    });
  }

  function v2OutcomeApplied(
    eventId: string,
    parentEventId: string,
    operationId: string,
    dispatchAttemptId: string,
  ): object {
    return v2Event("EXTERNAL_OPERATION_OUTCOME_APPLIED", eventId, parentEventId, {
      eventType: "EXTERNAL_OPERATION_OUTCOME_APPLIED",
      gateId: "gate-1",
      generationId: "generation-1",
      epochId: "epoch-1",
      operationId,
      dispatchAttemptId,
      outcomeAppliedEventId: eventId,
    });
  }


  it("projects the immutable V2 genesis context as the initial effective active tip", () => {
    const event = validateReviewGateEventRecord(v2GateCreatedRecord());

    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [event],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip).toMatchObject({
      status: "active",
      gateId: "gate-1",
      generationId: "generation-1",
      scopeId: "scope-1",
      supersedesGateId: null,
      rounds: { design: 0, plan: 0 },
      suspensionReason: null,
      lastVerifiedBinding: {
        admission: {
          gateCreatedEventId: "event-genesis",
          historicalRequirementsV2EventId: "event-genesis",
          context: {
            requirements: {
              source: "explicit",
              workspaceIdentity: "workspace-1",
              canonicalPath: "docs/requirements.md",
              gitBlobOid: "requirements-blob-1",
              selectedByEventId: "event-genesis",
            },
            design: { canonicalPath: "docs/design.md", gitMode: "100644" },
            plan: { canonicalPath: "docs/plan.md", gitMode: "100644" },
            globalProtocolFingerprint: "review-protocol-1",
            designProtocolFingerprint: "design-protocol-1",
            planProtocolFingerprint: "plan-protocol-1",
          },
        },
        effective: {
          authorityEventId: "event-genesis",
          operationId: "event-genesis",
          verifiedHistoryFrontier: "frontier-1",
        },
      },
      nc1Stop: null,
    });
  });

  it("projects an IN_FLIGHT recovery cursor for a dispatched V2 operation", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const dispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-dispatch", "event-genesis"),
    );

    const cursors = projectVerifiedDispatchRecoveryCursors([genesis, dispatch]);

    expect(cursors).toEqual([
      {
        kind: "IN_FLIGHT",
        gateId: "gate-1",
        generationId: "generation-1",
        epochId: "epoch-1",
        operationId: "operation-event-dispatch",
        dispatchAttemptId: "attempt-event-dispatch",
        role: "reviewer",
        candidateOrTargetSetDigest: digest,
        inputBindingDigest: digest,
        protocolFingerprint: digest,
        dispatchEventId: "event-dispatch",
        dispatchFrontierHash: digest,
        responseEvidence: null,
        resultEventId: null,
        outcomeAppliedEventId: null,
        redeliveryEvidenceDigest: null,
      },
    ]);
  });

  it("projects no recovery cursors when a V2 history has no dispatch", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());

    expect(projectVerifiedDispatchRecoveryCursors([genesis])).toEqual([]);
  });

  it("projects multiple IN_FLIGHT recovery cursors for multiple V2 dispatches", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const designDispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-design-dispatch", "event-genesis"),
    );
    const planDispatch = validateReviewGateEventRecord(
      v2Dispatch("plan", "event-plan-dispatch", "event-design-dispatch"),
    );

    const cursors = projectVerifiedDispatchRecoveryCursors([
      genesis,
      designDispatch,
      planDispatch,
    ]);

    expect(cursors.map((cursor) => cursor.operationId)).toEqual([
      "operation-event-design-dispatch",
      "operation-event-plan-dispatch",
    ]);
    expect(cursors.map((cursor) => cursor.kind)).toEqual(["IN_FLIGHT", "IN_FLIGHT"]);
  });

  it("freezes recovery cursor arrays and cursor objects on the verified tip", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const dispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-dispatch", "event-genesis"),
    );

    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [genesis, dispatch],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip.status).toBe("active");
    if (tip.status === "completed") throw new Error("expected_unfinished_verified_gate_tip");
    expect(tip.dispatchRecoveryCursors).toHaveLength(1);
    expect(Object.isFrozen(tip.dispatchRecoveryCursors)).toBe(true);
    expect(Object.isFrozen(tip.dispatchRecoveryCursors[0])).toBe(true);
  });

  it("counts external operation rounds per phase", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const d1 = validateReviewGateEventRecord(v2Dispatch("design", "event-d1", "event-genesis", "remediator"));
    const d2 = validateReviewGateEventRecord(v2Dispatch("design", "event-d2", "event-d1", "remediator"));
    const p1 = validateReviewGateEventRecord(v2Dispatch("plan", "event-p1", "event-d2", "remediator"));

    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [genesis, d1, d2, p1],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip.rounds).toEqual({ design: 2, plan: 1 });
    expect(tip.status).toBe("active");
  });

  it("projects a RESPONSE_STAGED cursor with response evidence once staged", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const dispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-dispatch", "event-genesis"),
    );
    const staged = validateReviewGateEventRecord(
      v2ResponseStaged(
        "event-staged",
        "event-dispatch",
        "operation-event-dispatch",
        "attempt-event-dispatch",
      ),
    );

    const cursors = projectVerifiedDispatchRecoveryCursors([genesis, dispatch, staged]);

    expect(cursors).toHaveLength(1);
    const cursor = cursors[0];
    if (cursor === undefined) throw new Error("expected_dispatch_recovery_cursor");
    expect(cursor.kind).toBe("RESPONSE_STAGED");
    expect(cursor.responseEvidence).toEqual({
      operationId: "operation-event-dispatch",
      dispatchAttemptId: "attempt-event-dispatch",
      contentDigest: digest,
      byteLength: 1024,
      privateStoreRecordId: "operation-event-dispatch:attempt-event-dispatch",
      policyVersion: "1",
    });
    expect(cursor.resultEventId).toBeNull();
  });

  it("keeps staged response evidence and records the result id once committed", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const dispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-dispatch", "event-genesis"),
    );
    const staged = validateReviewGateEventRecord(
      v2ResponseStaged(
        "event-staged",
        "event-dispatch",
        "operation-event-dispatch",
        "attempt-event-dispatch",
      ),
    );
    const committed = validateReviewGateEventRecord(
      v2ResultCommitted(
        "event-result-committed",
        "event-staged",
        "operation-event-dispatch",
        "attempt-event-dispatch",
        "event-authoritative-result",
      ),
    );

    const cursors = projectVerifiedDispatchRecoveryCursors([
      genesis,
      dispatch,
      staged,
      committed,
    ]);

    expect(cursors).toHaveLength(1);
    const cursor = cursors[0];
    if (cursor === undefined) throw new Error("expected_dispatch_recovery_cursor");
    expect(cursor.kind).toBe("RESULT_COMMITTED_OUTCOME_PENDING");
    expect(cursor.resultEventId).toBe("event-authoritative-result");
    expect(cursor.responseEvidence).not.toBeNull();
    expect(cursor.redeliveryEvidenceDigest).toBeNull();
  });

  it("drops the cursor once the outcome is applied", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const dispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-dispatch", "event-genesis"),
    );
    const staged = validateReviewGateEventRecord(
      v2ResponseStaged(
        "event-staged",
        "event-dispatch",
        "operation-event-dispatch",
        "attempt-event-dispatch",
      ),
    );
    const committed = validateReviewGateEventRecord(
      v2ResultCommitted(
        "event-result-committed",
        "event-staged",
        "operation-event-dispatch",
        "attempt-event-dispatch",
        "event-authoritative-result",
      ),
    );
    const applied = validateReviewGateEventRecord(
      v2OutcomeApplied(
        "event-applied",
        "event-result-committed",
        "operation-event-dispatch",
        "attempt-event-dispatch",
      ),
    );

    expect(
      projectVerifiedDispatchRecoveryCursors([genesis, dispatch, staged, committed, applied]),
    ).toEqual([]);
  });

  it("projects per-operation cursors each at their own lifecycle stage", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const inFlightDispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-a", "event-genesis"),
    );
    const stagedDispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-b", "event-a"),
    );
    const staged = validateReviewGateEventRecord(
      v2ResponseStaged("event-b-staged", "event-b", "operation-event-b", "attempt-event-b"),
    );
    const committedDispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-c", "event-b-staged"),
    );
    const committedStaged = validateReviewGateEventRecord(
      v2ResponseStaged("event-c-staged", "event-c", "operation-event-c", "attempt-event-c"),
    );
    const committed = validateReviewGateEventRecord(
      v2ResultCommitted(
        "event-c-committed",
        "event-c-staged",
        "operation-event-c",
        "attempt-event-c",
        "event-c-result",
        digest,
      ),
    );

    const cursors = projectVerifiedDispatchRecoveryCursors([
      genesis,
      inFlightDispatch,
      stagedDispatch,
      staged,
      committedDispatch,
      committedStaged,
      committed,
    ]);

    expect(cursors.map((cursor) => ({ operationId: cursor.operationId, kind: cursor.kind }))).toEqual([
      { operationId: "operation-event-a", kind: "IN_FLIGHT" },
      { operationId: "operation-event-b", kind: "RESPONSE_STAGED" },
      { operationId: "operation-event-c", kind: "RESULT_COMMITTED_OUTCOME_PENDING" },
    ]);
    const committedCursor = cursors[2];
    if (committedCursor === undefined) throw new Error("expected_committed_recovery_cursor");
    expect(committedCursor.resultEventId).toBe("event-c-result");
    expect(committedCursor.redeliveryEvidenceDigest).toBe(digest);
  });

  it("fails closed when two results are committed for the same operation attempt", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const dispatch = validateReviewGateEventRecord(
      v2Dispatch("design", "event-dispatch", "event-genesis"),
    );
    const firstResult = validateReviewGateEventRecord(
      v2ResultCommitted(
        "event-result-1",
        "event-dispatch",
        "operation-event-dispatch",
        "attempt-event-dispatch",
        "event-authoritative-result-1",
      ),
    );
    const secondResult = validateReviewGateEventRecord(
      v2ResultCommitted(
        "event-result-2",
        "event-result-1",
        "operation-event-dispatch",
        "attempt-event-dispatch",
        "event-authoritative-result-2",
      ),
    );

    expect(() =>
      projectVerifiedDispatchRecoveryCursors([genesis, dispatch, firstResult, secondResult]),
    ).toThrow("review_gate_dispatch_recovery_result_conflict");
  });

  it("fails closed when a lifecycle event references an unknown dispatch", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const staged = validateReviewGateEventRecord(
      v2ResponseStaged("event-staged", "event-genesis", "operation-unknown", "attempt-unknown"),
    );

    expect(() => projectVerifiedDispatchRecoveryCursors([genesis, staged])).toThrow(
      "review_gate_dispatch_recovery_unknown_dispatch",
    );
  });

  it("counts only unique remediator operation IDs", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const remediator = (eventId: string, parentEventId: string, role: string) =>
      validateReviewGateEventRecord(v2Dispatch(
        "design", eventId, parentEventId, role, "generation-1", "operation-shared",
      ));
    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [genesis, remediator("event-remediator-1", "event-genesis", "remediator"),
        remediator("event-remediator-2", "event-remediator-1", "remediator"),
        remediator("event-reviewer", "event-remediator-2", "reviewer")],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip.rounds).toEqual({ design: 1, plan: 0 });
  });

  it("preserves NC1 stop when orchestration resumes after execution suspension", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const nonConvergent = validateReviewGateEventRecord({
      eventType: "REVIEW_NON_CONVERGENT", gateId: "gate-1", writerId: "writer-1",
      epochId: "epoch-1", emittedAt: "2026-10-11T00:00:00.500Z",
      payload: { phase: "design", lineageIds: [] },
    });
    const suspended = validateReviewGateEventRecord({
      eventType: "EXECUTION_SUSPENDED", gateId: "gate-1", writerId: "writer-1",
      epochId: "epoch-1", emittedAt: "2026-10-11T00:00:01.000Z",
      payload: { reason: "execution failed" },
    });
    const resumed = validateReviewGateEventRecord({
      eventType: "ORCHESTRATION_RESUMED", gateId: "gate-1", writerId: "writer-1",
      epochId: "epoch-1", emittedAt: "2026-10-11T00:00:02.000Z",
      payload: { resumedAt: "2026-10-11T00:00:02.000Z" },
    });

    const tip = projectVerifiedGateTip({
      gateId: "gate-1", scopeId: "scope-1", events: [genesis, nonConvergent, suspended, resumed],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip).toMatchObject({ status: "suspended", suspensionReason: "review_non_convergent" });
    expect(tip.nc1Stop).not.toBeNull();
  });

  it("clears suspension layers after an orchestration resume event", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const suspended = validateReviewGateEventRecord({
      eventType: "EXECUTION_SUSPENDED",
      gateId: "gate-1",
      writerId: "writer-1",
      epochId: "epoch-1",
      emittedAt: "2026-10-11T00:00:01.000Z",
      payload: { reason: "execution failed" },
    });
    const resumed = validateReviewGateEventRecord({
      eventType: "ORCHESTRATION_RESUMED",
      gateId: "gate-1",
      writerId: "writer-1",
      epochId: "epoch-1",
      emittedAt: "2026-10-11T00:00:02.000Z",
      payload: { resumedAt: "2026-10-11T00:00:02.000Z" },
    });
    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [genesis, suspended, resumed],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip).toMatchObject({ status: "active", suspensionReason: null, nc1Stop: null });
  });

  it("rejects V2 histories whose gate or generation identity differs from genesis", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const mismatchedGate = validateReviewGateEventRecord({
      ...v2GateCreatedRecord(),
      gateId: "gate-other",
    });
    expect(() => projectVerifiedGateTip({
      gateId: "gate-1", scopeId: "scope-1", events: [mismatchedGate],
      frontier: frontier() as VerifiedScopeFrontier,
    })).toThrow("review_gate_tip_gate_id_mismatch");

    const mismatchedGeneration = validateReviewGateEventRecord(
      v2Dispatch("design", "event-generation-mismatch", "event-genesis", "reviewer", "generation-other"),
    );
    expect(() => projectVerifiedGateTip({
      gateId: "gate-1", scopeId: "scope-1", events: [genesis, mismatchedGeneration],
      frontier: frontier() as VerifiedScopeFrontier,
    })).toThrow("review_gate_tip_event_identity_mismatch");
  });

  it("projects a DESIGN_CLEAR into ownDesignClear", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const clear = validateReviewGateEventRecord(v2Event("DESIGN_CLEAR", "event-design-clear", "event-genesis", {
      designProtocolFingerprint: "design-protocol-1",
      approvedContextEventId: "event-genesis",
    }));

    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [genesis, clear],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip.lastVerifiedBinding.ownDesignClear).toMatchObject({
      eventId: "event-design-clear",
      approvedContextEventId: "event-genesis",
      approvedRequirementsAuthorityEventId: "event-genesis",
      designProtocolFingerprint: "design-protocol-1",
    });
  });

  it("projects a COMPLETED_APPROVAL_BINDING into a completed tip", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const completed = validateReviewGateEventRecord(v2Event("COMPLETED_APPROVAL_BINDING", "event-completed", "event-genesis", {
      approvalBinding: {
        reviewScopeId: "scope-1",
        gateId: "gate-1",
        designArtifact: { canonicalPath: "docs/design.md", digest, gitMode: "100644" },
        planArtifact: { canonicalPath: "docs/plan.md", digest, gitMode: "100644" },
        requirementsResolution: { source: "explicit", canonicalPath: "docs/requirements.md", digest },
        reviewProtocolFingerprint: "review-protocol-1",
        designProtocolFingerprint: "design-protocol-1",
        planProtocolFingerprint: "plan-protocol-1",
        approvedAt: "2026-10-11T00:00:00.000Z",
      },
      designClearEventId: "event-design-clear",
      planClearEventId: "event-plan-clear",
      currentRequirementsAuthorityEventId: "event-genesis",
      currentRequirements: {
        source: "explicit",
        workspaceIdentity: "workspace-1",
        canonicalPath: "docs/requirements.md",
        digest,
        gitMode: "100644",
        gitBlobOid: "requirements-blob-1",
        selectedByEventId: "event-genesis",
      },
    }));

    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [genesis, completed],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip.status).toBe("completed");
    expect(tip.completedApproval).toMatchObject({
      approvalEventId: "event-completed",
      gateId: "gate-1",
      generationId: "generation-1",
      historicalRequirementsV2EventId: "event-genesis",
      designClearEventId: "event-design-clear",
      planClearEventId: "event-plan-clear",
      currentRequirementsAuthorityEventId: "event-genesis",
      verifiedHistoryFrontier: "frontier-1",
    });
  });

  it("projects an NC1 stop from a legacy REVIEW_NON_CONVERGENT event", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const nc1: ReviewGateEvent = {
      eventType: "REVIEW_NON_CONVERGENT",
      gateId: "gate-1" as GateId,
      writerId: "writer-1" as WriterId,
      epochId: "epoch-1" as EpochId,
      emittedAt: "2026-10-11T00:00:01.000Z",
      payload: { phase: "design", lineageIds: ["lineage-1" as LineageId] },
    };

    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [genesis, nc1 as VerifiedReviewGateEvent],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip.status).toBe("suspended");
    expect(tip.suspensionReason).toBe("review_non_convergent");
    expect(tip.nc1Stop).toMatchObject({
      phase: "design",
      epochId: "epoch-1",
      remainingRounds: 5,
      witnessFrontierAtStop: "frontier-1",
    });
  });

  it("rejects a history without a V2 GATE_CREATED event", () => {
    const event = validateReviewGateEventRecord(v2Dispatch("design", "event-dispatch", "event-before-dispatch"));

    expect(() => projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [event],
      frontier: frontier() as VerifiedScopeFrontier,
    })).toThrow("review_gate_tip_missing_v2_gate_created");
  });

  describe("terminal writer-revoke projection", () => {
    it("projects TERMINAL_REVOKE_PENDING from a requested terminal handoff", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const handoff = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );

      const tip = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, handoff],
        frontier: frontier() as VerifiedScopeFrontier,
      });

      expect(tip.terminalState).toMatchObject({
        kind: "TERMINAL_REVOKE_PENDING",
        handoffOperationId: "handoff-1",
        terminalTransitionOperationId: "handoff-1",
      });
      expect(tip.terminalState?.targets).toHaveLength(1);
      expect(tip.terminalState?.targets[0]?.canonicalLogicalTargetPath).toBe("target.md");
    });

    it("projects REVOKED_AWAITING_TERMINAL_PUBLICATION when native effect is not yet applied", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const handoff = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );
      const revoked = validateReviewGateEventRecord(
        v2TerminalRevoked("event-revoked", "event-handoff", "handoff-1", "transition-1", "REVOKED", "NO_EFFECT", ["target.md"]),
      );

      const tip = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, handoff, revoked],
        frontier: frontier() as VerifiedScopeFrontier,
      });

      expect(tip.terminalState).toMatchObject({
        kind: "REVOKED_AWAITING_TERMINAL_PUBLICATION",
        handoffOperationId: "handoff-1",
        terminalTransitionOperationId: "transition-1",
      });
    });

    it("projects TERMINAL_FINALIZED when native effect is APPLIED", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const handoff = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );
      const revoked = validateReviewGateEventRecord(
        v2TerminalRevoked("event-revoked", "event-handoff", "handoff-1", "transition-1", "REVOKED", "APPLIED", ["target.md"]),
      );

      const tip = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, handoff, revoked],
        frontier: frontier() as VerifiedScopeFrontier,
      });

      expect(tip.terminalState).toMatchObject({
        kind: "TERMINAL_FINALIZED",
        handoffOperationId: "handoff-1",
        terminalTransitionOperationId: "transition-1",
      });
    });

    it("projects TERMINAL_FINALIZED when status is NEVER_CLAIMED_OR_ALREADY_REVOKED", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const revoked = validateReviewGateEventRecord(
        v2TerminalRevoked("event-revoked", "event-genesis", "handoff-1", "transition-1", "NEVER_CLAIMED_OR_ALREADY_REVOKED", "NO_EFFECT", ["target.md"]),
      );

      const tip = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, revoked],
        frontier: frontier() as VerifiedScopeFrontier,
      });

      expect(tip.terminalState).toMatchObject({
        kind: "TERMINAL_FINALIZED",
        handoffOperationId: "handoff-1",
        terminalTransitionOperationId: "transition-1",
      });
    });

    it("returns null terminalState for non-terminal handoffs", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const handoff = validateReviewGateEventRecord(
        v2Event("TARGET_WRITER_HANDOFF_REQUESTED", "event-handoff", "event-genesis", {
          purpose: "HANDOFF",
          status: "REQUESTED",
          handoffOperationId: "handoff-1",
          originalOperationId: "handoff-1",
          scopeId: "scope-1",
          gateId: "gate-1",
          generationId: "generation-1",
          phase: "design",
          roundOrdinal: 1,
          protocolFingerprint: digest,
          target: v2Target("target.md"),
          targets: [],
          closingSealOperationId: null,
          oldOwner: null,
          newOwner: {
            scopeId: "scope-2",
            gateId: "gate-2",
            generationId: "generation-1",
            operationId: "op-1",
            attemptId: "attempt-1",
          },
          expectedTargetWriterFrontier: "frontier-1",
          expectedGlobalTargetWriterGeneration: 1,
          expectedGateEventFrontier: "frontier-1",
          expectedPreImageDigest: digest,
          expectedGitMode: "100644",
          pendingNativeEffectReference: null,
        }),
      );

      const tip = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, handoff],
        frontier: frontier() as VerifiedScopeFrontier,
      });

      expect(tip.terminalState).toBeNull();
    });
  });


  describe("target writer authority projection", () => {
    const priorOwner = {
      scopeId: "scope-0",
      gateId: "gate-0",
      generationId: "generation-0",
      operationId: "op-0",
      attemptId: "attempt-0",
    };

    function revokePayload(
      overrides: {
        eventId?: string;
        status?: "REVOKED" | "NEVER_CLAIMED_OR_ALREADY_REVOKED";
        targets?: readonly string[];
        priorOwners?: readonly object[];
        globalTargetWriterHighWatermark?: number;
      } = {},
    ): object {
      return v2Event("TARGET_WRITER_TERMINAL_REVOKED", overrides.eventId ?? "event-revoked", "event-handoff", {
        purpose: "TERMINAL_REVOKE_ONLY",
        handoffOperationId: "handoff-1",
        terminalTransitionOperationId: "transition-1",
        status: overrides.status ?? "REVOKED",
        gateId: "gate-1",
        generationId: "generation-1",
        phase: "design",
        roundOrdinal: 1,
        targets: (overrides.targets ?? ["target.md"]).map(v2Target),
        priorOwners: overrides.priorOwners ?? [priorOwner],
        globalTargetWriterHighWatermark: overrides.globalTargetWriterHighWatermark ?? 7,
        protectedTargetFrontier: "frontier-revoke",
        protectedRevokeCasProofDigest: "c".repeat(64),
        nativeNonWriteabilityProofDigest: "d".repeat(64),
        nativeEffectDisposition: "APPLIED",
      });
    }

    it("binds terminal authority from a single-target verified revoke with its matching intent", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );
      const revoked = validateReviewGateEventRecord(revokePayload());

      const authority = projectVerifiedTargetWriterAuthority([genesis, intent, revoked]);

      expect(authority).toMatchObject({
        target: { canonicalLogicalTargetPath: "target.md" },
        globalTargetWriterGeneration: 7,
        activeOwner: null,
        priorOwner,
        expectedImage: { digest: "a".repeat(64), gitMode: "100644" },
        protectedTargetFrontier: "frontier-revoke",
        protectedTargetCasProofDigest: "c".repeat(64),
        durableTombstoneProofDigest: null,
      });
    });

    it("binds a no-writer authority when a never-claimed revoke is verified", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );
      const revoked = validateReviewGateEventRecord(
        revokePayload({ status: "NEVER_CLAIMED_OR_ALREADY_REVOKED", priorOwners: [] }),
      );

      expect(projectVerifiedTargetWriterAuthority([genesis, intent, revoked])).toMatchObject({
        activeOwner: null,
        priorOwner: null,
        globalTargetWriterGeneration: 7,
        durableTombstoneProofDigest: null,
      });
    });

    it("returns null for a requested intent without a verified revoke receipt", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );

      expect(projectVerifiedTargetWriterAuthority([genesis, intent])).toBeNull();
    });

    it("returns null for a protected continuation without a verified revoke receipt", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const owner = { scopeId: "scope-2", gateId: "gate-2", generationId: "generation-1", operationId: "op-1", attemptId: "attempt-1" };
      const resumed = validateReviewGateEventRecord(
        v2HandoffResumed("event-resumed", "event-genesis", "handoff-1", "target.md", owner),
      );

      expect(projectVerifiedTargetWriterAuthority([genesis, resumed])).toBeNull();
    });

    it("fails closed when the matching terminal intent is missing", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const revoked = validateReviewGateEventRecord(revokePayload());

      expect(projectVerifiedTargetWriterAuthority([genesis, revoked])).toBeNull();
    });

    it("fails closed when the revoke target diverges from the intent target", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["other.md"]),
      );
      const revoked = validateReviewGateEventRecord(revokePayload());

      expect(projectVerifiedTargetWriterAuthority([genesis, intent, revoked])).toBeNull();
    });

    it("fails closed on a multi-target terminal revoke", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md", "target-2.md"]),
      );
      const revoked = validateReviewGateEventRecord(
        revokePayload({ targets: ["target.md", "target-2.md"] }),
      );

      expect(projectVerifiedTargetWriterAuthority([genesis, intent, revoked])).toBeNull();
    });

    it("fails closed against multiple prior owners", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );
      const revoked = validateReviewGateEventRecord(
        revokePayload({
          priorOwners: [
            priorOwner,
            { scopeId: "scope-2", gateId: "gate-2", generationId: "generation-1", operationId: "op-1", attemptId: "attempt-1" },
          ],
        }),
      );

      expect(projectVerifiedTargetWriterAuthority([genesis, intent, revoked])).toBeNull();
    });

    it("fails closed on divergent duplicate revoke records", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );
      const first = validateReviewGateEventRecord(revokePayload({ eventId: "event-revoked-1" }));
      const second = validateReviewGateEventRecord(
        revokePayload({ eventId: "event-revoked-2", globalTargetWriterHighWatermark: 9 }),
      );

      expect(projectVerifiedTargetWriterAuthority([genesis, intent, first, second])).toBeNull();
    });

    it("collapses identical replayed revoke records idempotently", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );
      const revoked = validateReviewGateEventRecord(revokePayload());
      const replayed = validateReviewGateEventRecord(revokePayload());

      expect(projectVerifiedTargetWriterAuthority([genesis, intent, revoked, replayed])).toMatchObject({
        globalTargetWriterGeneration: 7,
        protectedTargetCasProofDigest: "c".repeat(64),
      });
    });

    it("exposes the fail-closed authority on the gate tip", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const intent = validateReviewGateEventRecord(
        v2TerminalHandoffRequested("event-handoff", "event-genesis", "handoff-1", ["target.md"]),
      );
      const revoked = validateReviewGateEventRecord(revokePayload());

      const withoutRevoke = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, intent],
        frontier: frontier() as VerifiedScopeFrontier,
      });
      const withRevoke = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, intent, revoked],
        frontier: frontier() as VerifiedScopeFrontier,
      });

      expect(withoutRevoke.status).toBe("active");
      if (withoutRevoke.status !== "active") return;
      expect(withoutRevoke.targetWriterAuthority).toBeNull();
      expect(withRevoke.status).toBe("active");
      if (withRevoke.status !== "active") return;
      expect(withRevoke.targetWriterAuthority?.globalTargetWriterGeneration).toBe(7);
      expect(withRevoke.targetWriterAuthority?.durableTombstoneProofDigest).toBeNull();
    });
  });


  describe("target writer handoff replay state projection", () => {
    it("projects REQUESTED from TARGET_WRITER_HANDOFF_REQUESTED", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const owner = { scopeId: "scope-2", gateId: "gate-2", generationId: "generation-1", operationId: "op-1", attemptId: "attempt-1" };
      const handoff = validateReviewGateEventRecord(
        v2HandoffRequested("event-handoff", "event-genesis", "handoff-1", "target.md", owner),
      );

      const tip = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, handoff],
        frontier: frontier() as VerifiedScopeFrontier,
      });

      expect(tip.status).toBe("active");
      if (tip.status !== "active") return;
      expect(tip.targetWriterHandoffState).not.toBeNull();
      expect(tip.targetWriterHandoffState?.status).toBe("REQUESTED");
      expect(tip.targetWriterHandoffState?.handoffOperationId).toBe("handoff-1");
      expect(tip.targetWriterHandoffState?.newOwner).toEqual(owner);
    });

    it("projects RESUMED from TARGET_WRITER_HANDOFF_RESUMED", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const owner = { scopeId: "scope-2", gateId: "gate-2", generationId: "generation-1", operationId: "op-1", attemptId: "attempt-1" };
      const resumed = validateReviewGateEventRecord(
        v2HandoffResumed("event-resumed", "event-genesis", "handoff-1", "target.md", owner),
      );

      const tip = projectVerifiedGateTip({
        gateId: "gate-1",
        scopeId: "scope-1",
        events: [genesis, resumed],
        frontier: frontier() as VerifiedScopeFrontier,
      });

      expect(tip.status).toBe("active");
      if (tip.status !== "active") return;
      expect(tip.targetWriterHandoffState).not.toBeNull();
      expect(tip.targetWriterHandoffState?.status).toBe("RESUMED");
      expect(tip.targetWriterHandoffState?.expectedGlobalTargetWriterGeneration).toBe(2);
    });
  });

});

describe("projectVerifiedLineageHistory", () => {
  function v2Genesis(): object {
    const hexDigest = "a".repeat(64);
    return {
      schemaVersion: 2,
      eventId: "event-genesis",
      parentEventId: "event-before-genesis",
      emittedAt: "2026-10-11T00:00:00.000Z",
      gateId: "gate-1",
      epochId: "epoch-1",
      generationId: "generation-1",
      writerId: "writer-1",
      eventType: "GATE_CREATED",
      payload: {
        reviewScopeId: "scope-1",
        supersedesGateId: null,
        designArtifact: { canonicalPath: "docs/design.md", digest: hexDigest, gitMode: "100644" },
        planArtifact: { canonicalPath: "docs/plan.md", digest: hexDigest, gitMode: "100644" },
        requirementsResolution: {
          schemaVersion: 2,
          source: "explicit",
          canonicalPath: "docs/requirements.md",
          digest: hexDigest,
          gitMode: "100644",
          requirementsGitBlobOid: "requirements-blob-1",
          committedBaselineOid: "baseline-commit-1",
          workspaceIdentity: "workspace-1",
          selectionEvidence: { commandPath: "--requirements docs/requirements.md" },
        },
        reviewProtocolFingerprint: "review-protocol-1",
        designProtocolFingerprint: "design-protocol-1",
        planProtocolFingerprint: "plan-protocol-1",
      },
    };
  }

  function v2RemediatorDispatch(): object {
    return v2Event("EXTERNAL_OPERATION_DISPATCHED", "event-dispatch", "event-transition-1", {
      eventType: "EXTERNAL_OPERATION_DISPATCHED",
      gateId: "gate-1",
      generationId: "generation-1",
      epochId: "epoch-1",
      operationId: "remediation-operation-1",
      dispatchAttemptId: "attempt-remediation-1",
      phase: "design",
      role: "remediator",
      candidateOrTargetSetDigest: "a".repeat(64),
      inputBindingDigest: "a".repeat(64),
      protocolFingerprint: "a".repeat(64),
      expectedWitnessFrontier: "frontier-transition-1",
      protectedLeaseProofDigest: "a".repeat(64),
    });
  }

  function semanticInputs(overrides: Partial<SemanticContextInputsV1> = {}): SemanticContextInputsV1 {
    return {
      workspaceIdentity: "workspace-1",
      gateId: "gate-1",
      generationId: "generation-1",
      phase: "design",
      phaseBaselineId: "design-baseline-0",
      comparisonSegmentId: "segment-0",
      requirements: {
        source: "explicit",
        canonicalPath: "docs/requirements.md",
        gitBlobOid: "requirements-blob-1",
        gitMode: "100644",
        authorityEventId: "requirements-authority-0",
        governingReferenceManifestDigest: "manifest-0",
      },
      upstreamApproved: null,
      policy: {
        contractId: "semantic-contract",
        version: "1",
        semanticFingerprint: "semantic-v1",
        lineageFingerprint: "lineage-v1",
        nc1Fingerprint: "nc1-v1",
        validatorRegistryDigest: "registry-v1",
      },
      ...overrides,
    };
  }

  function transitionPayload(
      overrides: {
        eventId?: string;
        parentEventId?: string;
        oldInputs?: SemanticContextInputsV1;
        newInputs?: SemanticContextInputsV1;
        verifiedHistoryFrontier?: string;
      } = {},
  ): object {
    const oldInputs = overrides.oldInputs ?? semanticInputs();
    const newInputs = overrides.newInputs ?? oldInputs;
    const triggeringAuthorityEventId = "requirements-rebased-1";
    return v2Event("SEMANTIC_CONTEXT_TRANSITION", overrides.eventId ?? "event-transition-1", overrides.parentEventId ?? "event-genesis", {
      oldInputs,
      newInputs,
      proof: {
        validationEventId: `compatibility-validation-${overrides.eventId ?? "event-transition-1"}`,
        triggeringAuthorityEventId,
        validatorId: "SEMANTIC_CONTEXT_COMPATIBILITY_V1",
        validatorVersion: "1",
        executableDigest: "validator-executable-v1",
        registryDigest: "registry-v1",
        compatibilityTableDigest: "table-v1",
        oldNormalizedInputsDigest: computeSemanticGoverningProjectionDigest(oldInputs),
        newNormalizedInputsDigest: computeSemanticGoverningProjectionDigest(newInputs),
        result: "EQUIVALENT",
        ruleId: "SEMANTIC_CONTEXT_FIELDS_IDENTICAL_V1",
        ruleVersion: "1",
        requirementsDelta: null,
      },
      triggeringAuthorityEventId,
      verifiedHistoryFrontier: overrides.verifiedHistoryFrontier ?? "frontier-transition-1",
      roundCountersBefore: { design: 0, plan: 0 },
      roundCountersAfter: { design: 0, plan: 0 },
      operationId: "transition-operation-1",
    });
  }

  it("projects a verified context-only history from consecutive transitions", () => {
    const genesis = validateReviewGateEventRecord(v2Genesis());
    const first = validateReviewGateEventRecord(transitionPayload({ eventId: "event-transition-1" }));
    const secondNewInputs = semanticInputs({ comparisonSegmentId: "segment-0:transition-operation-1" });
    const second = validateReviewGateEventRecord(transitionPayload({
      eventId: "event-transition-2",
      parentEventId: "event-transition-1",
      newInputs: secondNewInputs,
      verifiedHistoryFrontier: "frontier-transition-2",
    }));

    expect(projectVerifiedLineageHistory([genesis, first, second])).toEqual({
      frontierHash: "frontier-transition-2",
      context: {
        gateId: "gate-1",
        generationId: "generation-1",
        phase: "design",
        phaseBaselineId: "design-baseline-0",
        semanticContractFingerprint: "semantic-v1",
        protocolFingerprint: "design-protocol-1",
        contextDigest: computeSemanticGoverningProjectionDigest(secondNewInputs),
      },
      rounds: [],
    });
  });

  it("fails closed without verified semantic transition evidence", () => {
    const genesis = validateReviewGateEventRecord(v2Genesis());

    expect(projectVerifiedLineageHistory([genesis])).toBeNull();
  });

  it("fails closed when remediation evidence cannot be bound to complete cycle evidence", () => {
    const genesis = validateReviewGateEventRecord(v2Genesis());
    const transition = validateReviewGateEventRecord(transitionPayload());
    const dispatch = validateReviewGateEventRecord(
      v2RemediatorDispatch(),
    );

    expect(projectVerifiedLineageHistory([genesis, transition, dispatch])).toBeNull();
  });

  it("fails closed when lineage regression evidence cannot be bound to complete cycle evidence", () => {
    const genesis = validateReviewGateEventRecord(v2Genesis());
    const transition = validateReviewGateEventRecord(transitionPayload());
    const regressed = validateReviewGateEventRecord(
      v2Event("LINEAGE_REGRESSED", "event-regressed", "event-transition-1", {
        eventType: "LINEAGE_REGRESSED",
        operationId: "transition-operation-1",
        validationEventId: "validation-regressed",
        lineageId: "lineage-design",
        priorCommittedResolutionEventId: "resolution-0",
        pinnedBaselineDigest: "baseline-1",
        semanticContextFingerprint: "semantic-v1",
        validatedPresenceProofDigest: "presence-1",
        witnessedFrontierHash: "frontier-transition-1",
      }),
    );

    expect(projectVerifiedLineageHistory([genesis, transition, regressed])).toBeNull();
  });

  it("fails closed when the transition chain is not causally linked", () => {
    const genesis = validateReviewGateEventRecord(v2Genesis());
    const first = validateReviewGateEventRecord(transitionPayload({ eventId: "event-transition-1" }));
    const brokenOld = semanticInputs({ comparisonSegmentId: "segment-9" });
    const second = validateReviewGateEventRecord(transitionPayload({
      eventId: "event-transition-2",
      parentEventId: "event-transition-1",
      oldInputs: brokenOld,
      newInputs: semanticInputs({ comparisonSegmentId: "segment-9" }),
    }));

    expect(projectVerifiedLineageHistory([genesis, first, second])).toBeNull();
  });

  it("fails closed when transitions span more than one phase", () => {
    const genesis = validateReviewGateEventRecord(v2Genesis());
    const first = validateReviewGateEventRecord(transitionPayload({ eventId: "event-transition-1" }));
    const second = validateReviewGateEventRecord(transitionPayload({
      eventId: "event-transition-2",
      parentEventId: "event-transition-1",
      oldInputs: semanticInputs({ phase: "plan" }),
      newInputs: semanticInputs({ phase: "plan" }),
    }));

    expect(projectVerifiedLineageHistory([genesis, first, second])).toBeNull();
  });

  it("fails closed when transition evidence leaves the admitted generation", () => {
    const genesis = validateReviewGateEventRecord(v2Genesis());
    const drifted = transitionPayload({
      oldInputs: semanticInputs({ generationId: "generation-2" }),
      newInputs: semanticInputs({ generationId: "generation-2" }),
    }) as unknown as VerifiedReviewGateEvent;

    expect(projectVerifiedLineageHistory([genesis, drifted])).toBeNull();
  });

  it("projects deterministically on replay", () => {
    const genesis = validateReviewGateEventRecord(v2Genesis());
    const first = validateReviewGateEventRecord(transitionPayload({ eventId: "event-transition-1" }));
    const second = validateReviewGateEventRecord(transitionPayload({
      eventId: "event-transition-2",
      parentEventId: "event-transition-1",
      newInputs: semanticInputs({ comparisonSegmentId: "segment-0:transition-operation-1" }),
      verifiedHistoryFrontier: "frontier-transition-2",
    }));

    const firstReplay = projectVerifiedLineageHistory([genesis, first, second]);
    const secondReplay = projectVerifiedLineageHistory([genesis, first, second]);

    expect(firstReplay).not.toBeNull();
    expect(secondReplay).toEqual(firstReplay);
  });
});
