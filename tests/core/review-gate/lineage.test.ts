import { describe, expect, it } from "vitest";
import type { SelfReviewResultV1 } from "../../../src/core/review-gate/agent-protocol.js";
import {
  buildVerifiedCommittedResolution,
  planCrossGenerationLineageReconciliation,
  planResolvedFindingDisposition,
  reconcileVerifiedSelfReviewBatch,
  type SemanticBlockerEvidence,
} from "../../../src/core/review-gate/lineage.js";
import type { LineageId } from "../../../src/core/review-gate/types.js";

const lineageId = "lineage-current" as LineageId;
const predecessorLineageId = "lineage-predecessor" as LineageId;

function basis(id: LineageId, observationEventId: string): SemanticBlockerEvidence {
  return {
    lineageId: id,
    basisDigest: "basis-digest",
    semanticLocation: "design.md#failure-handling",
    ownerScope: "design",
    violationType: "missing_failure_handling",
    governingReference: "requirements.md#reliability",
    violatedContract: "failure-recovery",
    observationEventId,
  };
}

function selfReview(overrides: Partial<SelfReviewResultV1> = {}): SelfReviewResultV1 {
  return {
    schemaVersion: 1,
    operationId: "self-review-1",
    gateId: "gate-current",
    phase: "design",
    reviewAttemptId: null,
    remediationRound: { phase: "design", ordinal: 1 },
    targetLineageChecks: [{ lineageId, result: "RESOLVED" }],
    discoveredFindings: [],
    ...overrides,
  };
}

describe("commit-bound lineage contracts", () => {
  it("creates a committed resolution only from an exact verified commit", () => {
    const resolution = buildVerifiedCommittedResolution({
      lineageId,
      resolutionEventId: "resolution-event-1",
      verifiedCommitOid: "a".repeat(40),
      contextDigest: "context-1",
    });

    expect(resolution).toEqual({
      lineageId,
      resolutionEventId: "resolution-event-1",
      verifiedCommitOid: "a".repeat(40),
      contextDigest: "context-1",
    });
    expect(Object.isFrozen(resolution)).toBe(true);
    expect(() =>
      buildVerifiedCommittedResolution({
        lineageId,
        resolutionEventId: "resolution-event-1",
        verifiedCommitOid: "",
        contextDigest: "context-1",
      }),
    ).toThrow("verified_commit_oid_required");
  });
});

describe("finding validation dispositions", () => {
  const priorResolution = buildVerifiedCommittedResolution({
    lineageId,
    resolutionEventId: "resolution-event-1",
    verifiedCommitOid: "a".repeat(40),
    contextDigest: "context-1",
  });

  it("permits ALREADY_RESOLVED only for an independently absent same-context committed lineage", () => {
    expect(
      planResolvedFindingDisposition({
        lineageId,
        decision: "ALREADY_RESOLVED",
        relation: "EXISTING",
        validatorEventId: "validation-event-1",
        contextDigest: "context-1",
        priorCommittedResolution: priorResolution,
        independentlyVerifiedAbsenceEventId: "absence-event-1",
        independentlyVerifiedPresenceEventId: null,
      }),
    ).toEqual({
      kind: "already_resolved",
      lineageId,
      validationEventId: "validation-event-1",
      priorResolutionEventId: "resolution-event-1",
    });
  });

  it("opens a regression only for independently verified presence after a committed resolution", () => {
    expect(
      planResolvedFindingDisposition({
        lineageId,
        decision: "VALID",
        relation: "EXISTING",
        validatorEventId: "validation-event-2",
        contextDigest: "context-1",
        priorCommittedResolution: priorResolution,
        independentlyVerifiedAbsenceEventId: null,
        independentlyVerifiedPresenceEventId: "observation-event-2",
      }),
    ).toEqual({
      kind: "lineage_regressed",
      regression: {
        lineageId,
        priorResolutionEventId: "resolution-event-1",
        newObservationEventId: "observation-event-2",
        contextDigest: "context-1",
      },
    });
  });

  it("blocks conflicting or uncommitted resolution evidence rather than skipping it", () => {
    expect(
      planResolvedFindingDisposition({
        lineageId,
        decision: "ALREADY_RESOLVED",
        relation: "EXISTING",
        validatorEventId: "validation-event-1",
        contextDigest: "context-1",
        priorCommittedResolution: undefined,
        independentlyVerifiedAbsenceEventId: "absence-event-1",
        independentlyVerifiedPresenceEventId: null,
      }),
    ).toEqual({ kind: "block", reason: "prior_committed_resolution_required" });
  });
});

describe("verified self-review reconciliation", () => {
  it("creates commit-pending target outcomes and a regression from the strict self-review envelope", () => {
    const result = reconcileVerifiedSelfReviewBatch({
      result: selfReview({
        discoveredFindings: [
          {
            candidateId: "rediscovered-1",
            validity: "VALID",
            severity: "blocking",
            semanticRelation: "EXISTING",
            existingLineageRef: lineageId,
            semanticBasis: {
              violationType: "missing_failure_handling",
              governingReference: "requirements.md#reliability",
              semanticLocation: "design.md#failure-handling",
              violatedContract: "failure-recovery",
              ownerScope: "design",
            },
          },
        ],
      }),
      expected: {
        operationId: "self-review-1",
        gateId: "gate-current",
        phase: "design",
        roundOrdinal: 1,
        targetLineageIds: [lineageId],
        validationEventId: "self-review-event-1",
        targetEventIds: new Map([[lineageId, "remediation-event-1"]]),
        contextDigest: "context-1",
      },
      knownLineages: new Map([[lineageId, basis(lineageId, "finding-event-1")]]),
      priorCommittedResolutions: new Map([
        [
          lineageId,
          buildVerifiedCommittedResolution({
            lineageId,
            resolutionEventId: "resolution-event-1",
            verifiedCommitOid: "a".repeat(40),
            contextDigest: "context-1",
          }),
        ],
      ]),
    });

    expect(result.targetOutcomes).toEqual([
      {
        lineageId,
        roundOrdinal: 1,
        result: "RESOLVED",
        validationEventId: "self-review-event-1",
        targetEventId: "remediation-event-1",
      },
    ]);
    expect(result.regressions).toEqual([
      {
        lineageId,
        priorResolutionEventId: "resolution-event-1",
        newObservationEventId: "self-review-event-1",
        contextDigest: "context-1",
      },
    ]);
  });

  it("blocks incomplete target accounting and indeterminate target checks before commit", () => {
    expect(() =>
      reconcileVerifiedSelfReviewBatch({
        result: selfReview({ targetLineageChecks: [{ lineageId, result: "INDETERMINATE" }] }),
        expected: {
          operationId: "self-review-1",
          gateId: "gate-current",
          phase: "design",
          roundOrdinal: 1,
          targetLineageIds: [lineageId],
          validationEventId: "self-review-event-1",
          targetEventIds: new Map([[lineageId, "remediation-event-1"]]),
          contextDigest: "context-1",
        },
        knownLineages: new Map([[lineageId, basis(lineageId, "finding-event-1")]]),
        priorCommittedResolutions: new Map(),
      }),
    ).toThrow("self_review_indeterminate_target");
  });
});

describe("cross-generation reconciliation", () => {
  const predecessor = {
    gateId: "gate-predecessor",
    generationId: "generation-1",
    scopeId: "scope-1",
    finalizedLedgerDigest: "ledger-1",
    lineage: basis(predecessorLineageId, "predecessor-finding-event"),
  } as const;
  const current = {
    gateId: "gate-current",
    generationId: "generation-2",
    scopeId: "scope-1",
    admittedPredecessorGateId: "gate-predecessor",
    lineage: basis(lineageId, "current-finding-event"),
  } as const;

  it("returns only a historic durable link for an independently verified immediate predecessor match", () => {
    expect(
      planCrossGenerationLineageReconciliation({
        predecessor,
        current,
        operationId: "cross-generation-1",
        result: {
          operationId: "cross-generation-1",
          gateId: "gate-current",
          lineageId,
          verdict: "RELATED_PRIOR_GENERATION",
          predecessorLineageRef: { gateId: "gate-predecessor", lineageId: predecessorLineageId },
        },
      }),
    ).toEqual({
      kind: "durable_link",
      predecessorGateId: "gate-predecessor",
      predecessorLineageId,
    });
  });

  it("records an independently verified negative without inheriting predecessor authority", () => {
    const unrelated = {
      ...current,
      lineage: { ...current.lineage, violatedContract: "different-contract" },
    };
    expect(
      planCrossGenerationLineageReconciliation({
        predecessor,
        current: unrelated,
        operationId: "cross-generation-2",
        result: {
          operationId: "cross-generation-2",
          gateId: "gate-current",
          lineageId,
          verdict: "NO_PRIOR_MATCH",
          predecessorLineageRef: undefined,
        },
      }),
    ).toEqual({ kind: "no_prior_match" });
  });
});
