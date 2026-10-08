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
import { projectReviewGate } from "../../../src/core/review-gate/projection.js";
import { deriveResumeCursor } from "../../../src/core/review-gate/resume-cursor.js";

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
