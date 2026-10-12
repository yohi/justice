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

  function v2Event(
    eventType: string,
    eventId: string,
    parentEventId: string,
    payload: object,
  ): object {
    return {
      schemaVersion: 2,
      eventId,
      parentEventId,
      emittedAt: "2026-10-11T00:00:00.000Z",
      gateId: "gate-1",
      epochId: "epoch-1",
      generationId: "generation-1",
      writerId: "writer-1",
      eventType,
      payload,
    };
  }

  function v2Dispatch(phase: "design" | "plan", eventId: string, parentEventId: string): object {
    return v2Event("EXTERNAL_OPERATION_DISPATCHED", eventId, parentEventId, {
      eventType: "EXTERNAL_OPERATION_DISPATCHED",
      gateId: "gate-1",
      generationId: "generation-1",
      epochId: "epoch-1",
      operationId: `operation-${eventId}`,
      dispatchAttemptId: `attempt-${eventId}`,
      phase,
      role: "reviewer",
      candidateOrTargetSetDigest: digest,
      inputBindingDigest: digest,
      protocolFingerprint: digest,
      expectedWitnessFrontier: digest,
      protectedLeaseProofDigest: null,
    });
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

  it("counts external operation rounds per phase", () => {
    const genesis = validateReviewGateEventRecord(v2GateCreatedRecord());
    const d1 = validateReviewGateEventRecord(v2Dispatch("design", "event-d1", "event-genesis"));
    const d2 = validateReviewGateEventRecord(v2Dispatch("design", "event-d2", "event-d1"));
    const p1 = validateReviewGateEventRecord(v2Dispatch("plan", "event-p1", "event-d2"));

    const tip = projectVerifiedGateTip({
      gateId: "gate-1",
      scopeId: "scope-1",
      events: [genesis, d1, d2, p1],
      frontier: frontier() as VerifiedScopeFrontier,
    });

    expect(tip.rounds).toEqual({ design: 2, plan: 1 });
    expect(tip.status).toBe("active");
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
});
