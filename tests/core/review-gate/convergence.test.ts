import { describe, expect, it } from "vitest";
import { evaluateNonConvergence } from "../../../src/core/review-gate/convergence.js";
import { projectReviewGate } from "../../../src/core/review-gate/projection.js";
import type {
  ArtifactDigest,
  EpochId,
  FindingDiscoveredV1,
  FindingId,
  FindingRemediatedV1,
  FindingReopenedV1,
  GateCreatedV1,
  GateId,
  LineageId,
  ReviewScopeId,
  WriterId,
} from "../../../src/core/review-gate/types.js";

const gateId = "gate-1" as GateId;
const writerId = "writer-1" as WriterId;
const epochId = "epoch-1" as EpochId;
const lineageId = "lineage-1" as LineageId;
const findingId = "finding-1" as FindingId;
const digest = "a".repeat(64) as ArtifactDigest;

const gateCreated: GateCreatedV1 = {
  eventType: "GATE_CREATED",
  gateId,
  writerId,
  epochId,
  emittedAt: "2026-10-08T00:00:00.000Z",
  payload: {
    reviewScopeId: "scope-1" as ReviewScopeId,
    designArtifact: { canonicalPath: "design.md", digest, gitMode: "100644" },
    planArtifact: { canonicalPath: "plan.md", digest, gitMode: "100644" },
    requirementsResolution: {
      source: "explicit",
      canonicalPath: "requirements.md",
      digest,
    },
    reviewProtocolFingerprint: "review-v1",
  },
};

function event<Event extends FindingDiscoveredV1 | FindingRemediatedV1 | FindingReopenedV1>(
  eventType: Event["eventType"],
  payload: Event["payload"],
  emittedAt: string,
): Event {
  return { eventType, gateId, writerId, epochId, emittedAt, payload } as Event;
}

describe("evaluateNonConvergence", () => {
  it("detects a lineage reopened after two consecutive remediation rounds", () => {
    const projection = projectReviewGate([
      gateCreated,
      event<FindingDiscoveredV1>(
        "FINDING_DISCOVERED",
        {
          lineageId,
          findingId,
          observedPhase: "design",
          ownerScope: "design",
          descriptionDigest: digest,
        },
        "2026-10-08T00:00:01.000Z",
      ),
      event<FindingRemediatedV1>(
        "FINDING_REMEDIATED",
        { lineageId, findingId, remediationRound: { phase: "design", ordinal: 1 } },
        "2026-10-08T00:00:02.000Z",
      ),
      event<FindingReopenedV1>(
        "FINDING_REOPENED",
        { lineageId, findingId, reopenedBy: epochId },
        "2026-10-08T00:00:03.000Z",
      ),
      event<FindingRemediatedV1>(
        "FINDING_REMEDIATED",
        { lineageId, findingId, remediationRound: { phase: "design", ordinal: 2 } },
        "2026-10-08T00:00:04.000Z",
      ),
      event<FindingReopenedV1>(
        "FINDING_REOPENED",
        { lineageId, findingId, reopenedBy: epochId },
        "2026-10-08T00:00:05.000Z",
      ),
    ]);

    expect(evaluateNonConvergence(projection)).toEqual({
      kind: "non_convergent",
      trigger: "same_lineage_stall",
      lineageIds: [lineageId],
    });
  });
});
