import { describe, expect, it } from "vitest";
import type {
  ArtifactDigest,
  EpochId,
  GateId,
  RequirementsResolutionV2,
  ReviewApprovalBindingV1,
  ReviewGateEvent,
  ReviewScopeId,
  WriterId,
} from "../../../src/core/review-gate-types";
import {
  lookupCompletedApproval,
  type VerifiedCompletedBindingSnapshot,
  type VerifiedGateContextBinding,
  type VerifiedGateTip,
  type VerifiedRequirementsBinding,
  type VerifiedUnfinishedBindingSnapshot,
} from "../../../src/core/review-gate/admission";
import {
  validateReviewGateEventRecord,
  type VerifiedReviewGateEvent,
} from "../../../src/core/review-gate/event-schema";
import { verifyCompletedSuccessor } from "../../../src/core/review-gate/scope-continuity";

const SCOPE = "scope-1";
const WORKSPACE = "workspace-1";
const FRONTIER = "frontier-1";

const DIGEST = (value: string): ArtifactDigest =>
  `sha256-${value.padEnd(64, "0")}` as ArtifactDigest;

function v2Event(
  gateId: string,
  generationId: string,
  eventType: string,
  eventId: string,
  parentEventId: string,
  payload: object,
): object {
  return {
    schemaVersion: 2,
    eventId,
    parentEventId,
    emittedAt: "2026-10-12T00:00:00.000Z",
    gateId,
    epochId: "epoch-1",
    generationId,
    writerId: "writer-1",
    eventType,
    payload,
  };
}

function v2SuccessorGateCreated(
  gateId: string,
  supersedesGateId: string | null,
  eventId: string,
): VerifiedReviewGateEvent {
  return validateReviewGateEventRecord(
    v2Event(gateId, `gen-${gateId}`, "GATE_CREATED", eventId, "event-parent", {
      reviewScopeId: SCOPE,
      supersedesGateId,
      requirementsResolution: {
        schemaVersion: 2,
        source: "explicit",
        canonicalPath: "docs/requirements.md",
        digest: "digest-requirements",
        gitMode: "100644",
        requirementsGitBlobOid: "blob-requirements",
        committedBaselineOid: "commit-requirements",
        workspaceIdentity: WORKSPACE,
        selectionEvidence: {},
      },
      designArtifact: {
        canonicalPath: "docs/design.md",
        digest: "digest-design",
        gitMode: "100644",
      },
      planArtifact: {
        canonicalPath: "docs/plan.md",
        digest: "digest-plan",
        gitMode: "100644",
      },
      reviewProtocolFingerprint: "review-protocol-1",
      designProtocolFingerprint: "design-protocol-1",
      planProtocolFingerprint: "plan-protocol-1",
    }),
  );
}

function historicalResolution(): RequirementsResolutionV2 {
  return {
    schemaVersion: 2,
    source: "explicit",
    canonicalPath: "docs/requirements.md",
    digest: DIGEST("requirements"),
    gitMode: "100644",
    requirementsGitBlobOid: "blob-requirements",
    committedBaselineOid: "commit-requirements",
    workspaceIdentity: WORKSPACE,
    selectionEvidence: {},
  };
}

function currentRequirements(): VerifiedRequirementsBinding {
  return {
    source: "explicit",
    workspaceIdentity: WORKSPACE,
    canonicalPath: "docs/requirements.md",
    digest: DIGEST("requirements"),
    gitMode: "100644",
    gitBlobOid: "blob-requirements",
    selectedByEventId: "event-historical",
  };
}

function approvalBinding(gateId: string): ReviewApprovalBindingV1 {
  return {
    reviewScopeId: SCOPE as ReviewScopeId,
    gateId: gateId as GateId,
    designArtifact: {
      canonicalPath: "docs/design.md",
      digest: DIGEST("design"),
      gitMode: "100644",
    },
    planArtifact: {
      canonicalPath: "docs/plan.md",
      digest: DIGEST("plan"),
      gitMode: "100644",
    },
    requirementsResolution: {
      source: "explicit",
      canonicalPath: "docs/requirements.md",
      digest: DIGEST("requirements"),
    },
    reviewProtocolFingerprint: "review-protocol-1",
    designProtocolFingerprint: "design-protocol-1",
    planProtocolFingerprint: "plan-protocol-1",
    approvedAt: "2026-10-12T00:00:00.000Z",
  };
}

function completedApprovalSnapshot(
  gateId: string,
  approvalGateId: string,
): VerifiedCompletedBindingSnapshot {
  return {
    approvalEventId: `approval-${gateId}`,
    approvalBinding: approvalBinding(approvalGateId),
    gateId,
    generationId: `gen-${gateId}`,
    historicalRequirementsV2EventId: "event-historical",
    historicalRequirements: historicalResolution(),
    currentRequirementsAuthorityEventId: "event-current",
    currentRequirements: currentRequirements(),
    design: {
      canonicalPath: "docs/design.md",
      digest: DIGEST("design"),
      gitMode: "100644",
    },
    plan: {
      canonicalPath: "docs/plan.md",
      digest: DIGEST("plan"),
      gitMode: "100644",
    },
    designClearEventId: "event-design-clear",
    planClearEventId: "event-plan-clear",
    globalProtocolFingerprint: "review-protocol-1",
    verifiedHistoryFrontier: FRONTIER,
  };
}

function completedPredecessorTip(
  gateId: string,
  approvalGateId = gateId,
): VerifiedGateTip {
  return {
    status: "completed",
    gateId,
    generationId: `gen-${gateId}`,
    scopeId: SCOPE,
    supersedesGateId: null,
    completedApproval: completedApprovalSnapshot(gateId, approvalGateId),
  };
}

function unfinishedBinding(): VerifiedUnfinishedBindingSnapshot {
  const context: VerifiedGateContextBinding = {
    requirements: currentRequirements(),
    design: {
      canonicalPath: "docs/design.md",
      digest: DIGEST("design"),
      gitMode: "100644",
    },
    plan: {
      canonicalPath: "docs/plan.md",
      digest: DIGEST("plan"),
      gitMode: "100644",
    },
    globalProtocolFingerprint: "review-protocol-1",
    designProtocolFingerprint: "design-protocol-1",
    planProtocolFingerprint: "plan-protocol-1",
  };
  return {
    admission: {
      gateCreatedEventId: "event-created",
      historicalRequirementsV2EventId: "event-historical",
      historicalRequirements: historicalResolution(),
      context,
    },
    effective: {
      context,
      currentRequirementsAuthorityEventId: "event-current",
      currentRequirements: currentRequirements(),
      authorityEventId: "event-effective",
      operationId: "op-1",
      verifiedHistoryFrontier: FRONTIER,
    },
    ownDesignClear: null,
  };
}

function activePredecessorTip(gateId: string): VerifiedGateTip {
  return {
    status: "active",
    gateId,
    generationId: `gen-${gateId}`,
    scopeId: SCOPE,
    supersedesGateId: null,
    rounds: { design: 0, plan: 0 },
    suspensionReason: null,
    suspensionEpochId: null,
    lastVerifiedBinding: unfinishedBinding(),
    nc1Stop: null,
    dispatchRecoveryCursors: [],
    terminalState: null,
    targetWriterAuthority: null,
    targetWriterHandoffState: null,
  };
}

describe("read-only approval lookup cross-check (Task 16)", () => {
  it("keeps the predecessor approval binding reachable through the read-only lookup", () => {
    const tip = completedPredecessorTip("gate-pred");
    const binding = lookupCompletedApproval(tip);
    expect(binding).not.toBeNull();
    expect(binding?.gateId).toBe("gate-pred");
  });
});

describe("verifyCompletedSuccessor", () => {
  it("verifies a successor gate that supersedes a completed predecessor", () => {
    const predecessor = completedPredecessorTip("gate-pred");
    const successor = v2SuccessorGateCreated(
      "gate-succ",
      "gate-pred",
      "event-successor",
    );

    const result = verifyCompletedSuccessor(predecessor, successor);

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.predecessorGateId).toBe("gate-pred");
    expect(result.predecessorGenerationId).toBe("gen-gate-pred");
    expect(result.successorGateId).toBe("gate-succ");
    expect(result.successorGenerationId).toBe("gen-gate-succ");
    expect(result.completedApprovalEventId).toBe("approval-gate-pred");
    expect(result.completedApprovalBinding).toEqual(
      predecessor.completedApproval.approvalBinding,
    );
    expect(result.relationshipProofDigest.length).toBeGreaterThan(0);
  });

  it("computes a deterministic digest bound to both gate identities", () => {
    const predecessor = completedPredecessorTip("gate-pred");
    const first = verifyCompletedSuccessor(
      predecessor,
      v2SuccessorGateCreated("gate-succ", "gate-pred", "event-successor"),
    );
    const repeat = verifyCompletedSuccessor(
      predecessor,
      v2SuccessorGateCreated("gate-succ", "gate-pred", "event-successor"),
    );
    const otherSuccessor = verifyCompletedSuccessor(
      predecessor,
      v2SuccessorGateCreated("gate-succ-2", "gate-pred", "event-successor-2"),
    );

    expect(first).not.toBeNull();
    expect(repeat).not.toBeNull();
    expect(otherSuccessor).not.toBeNull();
    expect(first?.relationshipProofDigest).toBe(
      repeat?.relationshipProofDigest,
    );
    expect(first?.relationshipProofDigest).not.toBe(
      otherSuccessor?.relationshipProofDigest,
    );
  });

  it("fails closed when the predecessor tip is not completed", () => {
    const predecessor = activePredecessorTip("gate-pred");
    const successor = v2SuccessorGateCreated(
      "gate-succ",
      "gate-pred",
      "event-successor",
    );

    expect(verifyCompletedSuccessor(predecessor, successor)).toBeNull();
  });

  it("fails closed when the successor event is not a V2 GATE_CREATED", () => {
    const predecessor = completedPredecessorTip("gate-pred");
    const legacyCreated: ReviewGateEvent = {
      eventType: "GATE_CREATED",
      gateId: "gate-succ" as GateId,
      writerId: "writer-1" as WriterId,
      epochId: "epoch-1" as EpochId,
      emittedAt: "2026-10-12T00:00:00.000Z",
      payload: {
        reviewScopeId: SCOPE as ReviewScopeId,
        designArtifact: {
          canonicalPath: "docs/design.md",
          digest: "digest-design" as ArtifactDigest,
          gitMode: "100644",
        },
        planArtifact: {
          canonicalPath: "docs/plan.md",
          digest: "digest-plan" as ArtifactDigest,
          gitMode: "100644",
        },
        requirementsResolution: {
          source: "explicit",
          canonicalPath: "docs/requirements.md",
          digest: "digest-requirements" as ArtifactDigest,
        },
        reviewProtocolFingerprint: "review-protocol-1",
      },
    };

    expect(
      verifyCompletedSuccessor(
        predecessor,
        legacyCreated as VerifiedReviewGateEvent,
      ),
    ).toBeNull();
  });

  it("fails closed when the successor names no predecessor", () => {
    const predecessor = completedPredecessorTip("gate-pred");
    const successor = v2SuccessorGateCreated(
      "gate-succ",
      null,
      "event-successor",
    );

    expect(verifyCompletedSuccessor(predecessor, successor)).toBeNull();
  });

  it("fails closed when the successor names a different predecessor", () => {
    const predecessor = completedPredecessorTip("gate-pred");
    const successor = v2SuccessorGateCreated(
      "gate-succ",
      "gate-other",
      "event-successor",
    );

    expect(verifyCompletedSuccessor(predecessor, successor)).toBeNull();
  });

  it("fails closed when the successor gate claims to supersede itself", () => {
    const predecessor = completedPredecessorTip("gate-pred");
    const successor = v2SuccessorGateCreated(
      "gate-pred",
      "gate-pred",
      "event-successor",
    );

    expect(verifyCompletedSuccessor(predecessor, successor)).toBeNull();
  });

  it("fails closed when the durable binding names a different gate than the predecessor tip", () => {
    const predecessor = completedPredecessorTip("gate-pred", "gate-mismatch");
    const successor = v2SuccessorGateCreated(
      "gate-succ",
      "gate-pred",
      "event-successor",
    );

    expect(verifyCompletedSuccessor(predecessor, successor)).toBeNull();
  });
});