import type {
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
} from "../../../src/core/review-gate/projection.js";
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
    it("projects active owner from HANDOFF_REQUESTED", () => {
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
      expect(tip.targetWriterAuthority).not.toBeNull();
      expect(tip.targetWriterAuthority?.activeOwner).toEqual(owner);
      expect(tip.targetWriterAuthority?.globalTargetWriterGeneration).toBe(1);
      expect(tip.targetWriterAuthority?.durableTombstoneProofDigest).toBeNull();
    });

    it("projects active owner from HANDOFF_RESUMED", () => {
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
      expect(tip.targetWriterAuthority).not.toBeNull();
      expect(tip.targetWriterAuthority?.activeOwner).toEqual(owner);
      expect(tip.targetWriterAuthority?.globalTargetWriterGeneration).toBe(2);
      expect(tip.targetWriterAuthority?.durableTombstoneProofDigest).toBeNull();
    });

    it("tombstones active owner after TERMINAL_REVOKED", () => {
      const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
      const owner = { scopeId: "scope-2", gateId: "gate-2", generationId: "generation-1", operationId: "op-1", attemptId: "attempt-1" };
      const handoff = validateReviewGateEventRecord(
        v2HandoffRequested("event-handoff", "event-genesis", "handoff-1", "target.md", owner),
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

      expect(tip.status).toBe("active");
      if (tip.status !== "active") return;
      expect(tip.targetWriterAuthority).not.toBeNull();
      expect(tip.targetWriterAuthority?.activeOwner).toBeNull();
      expect(tip.targetWriterAuthority?.durableTombstoneProofDigest).toBe("a".repeat(64));
    });
  });

});
