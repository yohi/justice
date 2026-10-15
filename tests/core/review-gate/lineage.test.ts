import { describe, expect, it } from "vitest";
import type { SelfReviewResultV1 } from "../../../src/core/review-gate/agent-protocol.js";
import {
  buildLineageResolutionV2,
  buildVerifiedCommittedResolution,
  reconcileFindingBatch,
  planCrossGenerationLineageReconciliation,
  planResolvedFindingDisposition,
  planResolvedFindingDispositionV2,
  reconcileVerifiedSelfReviewBatch,
  type LineageRevalidationOriginV1,
  type SemanticBlockerEvidence,
  type ValidatedFinding,
  type VerifiedCommittedResolutionV2,
} from "../../../src/core/review-gate/lineage.js";
import { projectReviewGate } from "../../../src/core/review-gate/projection.js";
import type {
  ArtifactDigest,
  EpochId,
  FindingRemediatedV1,
  GateCreatedV1,
  GateId,
  LineageId,
  ReviewArtifactBinding,
  ReviewScopeId,
  WriterId,
} from "../../../src/core/review-gate/types.js";

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

  it.each([
    ["missing absence proof", null, "context-1"],
    ["empty absence proof", "", "context-1"],
    ["mismatched context", "absence-event-1", "different-context"],
  ] as const)("blocks ALREADY_RESOLVED with %s", (_label, absenceEventId, contextDigest) => {
    expect(
      planResolvedFindingDisposition({
        lineageId,
        decision: "ALREADY_RESOLVED",
        relation: "EXISTING",
        validatorEventId: "validation-event-1",
        contextDigest,
        priorCommittedResolution: priorResolution,
        independentlyVerifiedAbsenceEventId: absenceEventId,
        independentlyVerifiedPresenceEventId: null,
      }),
    ).toMatchObject({ kind: "block" });
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

  it("blocks a VALID regression when its context differs from the committed resolution", () => {
    expect(
      planResolvedFindingDisposition({
        lineageId,
        decision: "VALID",
        relation: "EXISTING",
        validatorEventId: "validation-event-3",
        contextDigest: "different-context",
        priorCommittedResolution: priorResolution,
        independentlyVerifiedAbsenceEventId: null,
        independentlyVerifiedPresenceEventId: "observation-event-3",
      }),
    ).toMatchObject({ kind: "block" });
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

describe("resolved finding disposition V2 (stage-aware revalidation)", () => {
  const lineageIdV2 = "lineage-v2" as LineageId;
  const priorResolution: VerifiedCommittedResolutionV2 = {
    lineageId: lineageIdV2,
    resolutionEventId: "resolution-event-2",
    remediationRound: { phase: "design", ordinal: 1 },
    semanticContextFingerprint: "semantic-context-1",
    pinnedBaselineDigest: "digest-1",
    origin: {
      kind: "justice_remediation_commit",
      commitEventId: "commit-event-1",
      verifiedCommitOid: "a".repeat(40),
    },
  };
  const baseline: ReviewArtifactBinding = {
    canonicalPath: "docs/plans/feature-plan.md",
    digest: "digest-1" as ReviewArtifactBinding["digest"],
    gitMode: "100644",
  };

  function dispositionInput(
    overrides: Partial<Parameters<typeof planResolvedFindingDispositionV2>[0]> = {},
  ): Parameters<typeof planResolvedFindingDispositionV2>[0] {
    return {
      lineageId: lineageIdV2,
      decision: "ALREADY_RESOLVED",
      relation: "EXISTING",
      validatorEventId: "validation-event-2",
      validatorOutcome: "absent",
      priorCommittedResolution: priorResolution,
      currentPinnedBaseline: baseline,
      semanticContextFingerprint: "semantic-context-1",
      validationEventId: "revalidation-event-2",
      currentPhase: "design",
      currentRoundOrdinal: 1,
      ...overrides,
    };
  }

  it("reuses persisted evidence when the outcome is absent, the prior origin is identical, and the pinned baseline and semantic context are unchanged", () => {
    const disposition = planResolvedFindingDispositionV2(
      dispositionInput(),
    );

    expect(disposition).toEqual({
      kind: "already_resolved",
      lineageId: lineageIdV2,
      validationEventId: "revalidation-event-2",
      priorResolutionEventId: "resolution-event-2",
      reusedPersistedEvidence: true,
    });
  });

  it("blocks revalidation reuse when the pinned baseline digest or git mode changed", () => {
    const disposition = planResolvedFindingDispositionV2(
      dispositionInput({
        currentPinnedBaseline: { ...baseline, digest: "digest-2" as ReviewArtifactBinding["digest"] },
      }),
    );

    expect(disposition).toEqual({
      kind: "block",
      reason: "pinned_baseline_changed",
    });
  });

  it("blocks revalidation reuse when the semantic context fingerprint changed", () => {
    const disposition = planResolvedFindingDispositionV2(
      dispositionInput({
        semanticContextFingerprint: "semantic-context-2",
      }),
    );

    expect(disposition).toEqual({
      kind: "block",
      reason: "semantic_context_changed",
    });
  });

  it("blocks indeterminate validator outcomes before any resolution reuse", () => {
    const disposition = planResolvedFindingDispositionV2(
      dispositionInput({ validatorOutcome: "indeterminate" }),
    );

    expect(disposition).toEqual({
      kind: "block",
      reason: "indeterminate_validation_blocks_reuse",
    });
  });

  it("throws when a finding observed in a different stage attempts revalidation reuse", () => {
    expect(() =>
      planResolvedFindingDispositionV2(
        dispositionInput({
          currentPhase: "design",
          currentRoundOrdinal: 2,
        }),
      ),
    ).toThrow("stage_mismatch_blocks_revalidation");
  });

});

describe("V2 lineage resolution origins", () => {
  const gateId = "gate-origin" as GateId;
  const scopeId = "scope-origin" as ReviewScopeId;
  const writerId = "writer-origin" as WriterId;
  const epochId = "epoch-origin" as EpochId;
  const digest = "b".repeat(64) as ArtifactDigest;
  const lineageOrigin = "lineage-origin" as LineageId;
  const designArtifact = {
    canonicalPath: "docs/design.md",
    digest,
    gitMode: "100644" as const,
  };
  const planArtifact = {
    canonicalPath: "docs/plan.md",
    digest,
    gitMode: "100644" as const,
  };
  const createdEvent: GateCreatedV1 = {
    eventType: "GATE_CREATED",
    gateId,
    writerId,
    epochId,
    emittedAt: "2026-10-12T00:00:00.000Z",
    payload: {
      reviewScopeId: scopeId,
      designArtifact,
      planArtifact,
      requirementsResolution: { source: "explicit", canonicalPath: "docs/requirements.md", digest },
      reviewProtocolFingerprint: "review-v1",
    },
  };
  const discovery: ReviewGateEvent = {
    eventType: "FINDING_DISCOVERED",
    gateId,
    writerId,
    epochId,
    emittedAt: "2026-10-12T00:00:01.000Z",
    payload: {
      lineageId: lineageOrigin,
      findingId: "finding-origin" as FindingId,
      observedPhase: "design",
      ownerScope: "design",
      descriptionDigest: digest,
    },
  };
  const remediation: FindingRemediatedV1 = {
    eventType: "FINDING_REMEDIATED",
    gateId,
    writerId,
    epochId,
    emittedAt: "2026-10-12T00:00:02.000Z",
    payload: {
      lineageId: lineageOrigin,
      findingId: "finding-origin" as FindingId,
      remediationRound: { phase: "design", ordinal: 1 },
    },
  };
  const projection = projectReviewGate([createdEvent, discovery, remediation]);
  const externalOrigin: LineageRevalidationOriginV1 = {
    kind: "external_committed_change",
    revalidationEventId: "revalidation-event-origin",
    changeObservedProofDigest: "f".repeat(64),
  };
  const committedBinding: ReviewArtifactBinding = {
    canonicalPath: "docs/design.md",
    digest: "c".repeat(64) as ReviewArtifactBinding["digest"],
    gitMode: "100644",
  };

  it("records an external committed change resolution with revalidation origin and verified Git change proof", () => {
    const result = buildLineageResolutionV2(projection, {
      lineageId: lineageOrigin,
      resolutionKind: "external_change_revalidation",
      resolutionEventId: "resolution-event-origin",
      semanticContextFingerprint: "semantic-context-1",
      pinnedBaselineDigest: committedBinding.digest,
      origin: externalOrigin,
      verifiedCommitBinding: committedBinding,
    });

    expect(result.resolutions).toEqual([
      {
        lineageId: lineageOrigin,
        resolutionEventId: "resolution-event-origin",
        remediationRound: { phase: "design", ordinal: 1 },
        semanticContextFingerprint: "semantic-context-1",
        pinnedBaselineDigest: committedBinding.digest,
        origin: externalOrigin,
      },
    ]);
    expect(result.events.map((event) => event.eventType)).toEqual(["FINDING_SELF_REVIEWED"]);
    expect(
      result.events.filter((event) => event.eventType === "REVIEW_COMMIT_PREPARED"),
    ).toHaveLength(0);
  });

  it("records a justice remediation resolution with the verified commit origin", () => {
    const result = buildLineageResolutionV2(projection, {
      lineageId: lineageOrigin,
      resolutionKind: "lineage_resolution_committed",
      resolutionEventId: "resolution-event-justice",
      semanticContextFingerprint: "semantic-context-1",
      pinnedBaselineDigest: digest,
      origin: {
        kind: "justice_remediation_commit",
        commitEventId: "commit-event-origin",
        verifiedCommitOid: "a".repeat(40),
      },
    });

    expect(result.resolutions).toEqual([
      {
        lineageId: lineageOrigin,
        resolutionEventId: "resolution-event-justice",
        remediationRound: { phase: "design", ordinal: 2 },
        semanticContextFingerprint: "semantic-context-1",
        pinnedBaselineDigest: digest,
        origin: {
          kind: "justice_remediation_commit",
          commitEventId: "commit-event-origin",
          verifiedCommitOid: "a".repeat(40),
        },
      },
    ]);
    expect(result.events.map((event) => event.eventType)).toEqual(["FINDING_REMEDIATED"]);
  });

  it.each([
    [
      "mismatched origin kind",
      {
        resolutionKind: "lineage_resolution_committed" as const,
        origin: externalOrigin,
      },
    ],
    [
      "unverified external binding",
      {
        resolutionKind: "external_change_revalidation" as const,
        origin: externalOrigin,
        verifiedCommitBinding: undefined,
      },
    ],
    [
      "empty verified commit oid",
      {
        resolutionKind: "lineage_resolution_committed" as const,
        origin: {
          kind: "justice_remediation_commit" as const,
          commitEventId: "commit-event-origin",
          verifiedCommitOid: "",
        },
      },
    ],
  ] as const)("fails closed on %s", (_label, overrides) => {
    expect(() =>
      buildLineageResolutionV2(projection, {
        lineageId: lineageOrigin,
        resolutionKind: "external_change_revalidation",
        resolutionEventId: "resolution-event-origin",
        semanticContextFingerprint: "semantic-context-1",
        pinnedBaselineDigest: committedBinding.digest,
        origin: externalOrigin,
        verifiedCommitBinding: committedBinding,
        ...overrides,
      }),
    ).toThrow();
  });
});

describe("stage-aware finding reconciliation", () => {
  const gateIdRecon = "gate-recon" as GateId;
  const scopeIdRecon = "scope-recon" as ReviewScopeId;
  const writerIdRecon = "writer-recon" as WriterId;
  const epochIdRecon = "epoch-recon" as EpochId;
  const digestRecon = "d".repeat(64) as ArtifactDigest;
  const lineageRecon = "lineage-recon" as LineageId;
  const createdRecon: GateCreatedV1 = {
    eventType: "GATE_CREATED",
    gateId: gateIdRecon,
    writerId: writerIdRecon,
    epochId: epochIdRecon,
    emittedAt: "2026-10-12T00:00:00.000Z",
    payload: {
      reviewScopeId: scopeIdRecon,
      designArtifact: { canonicalPath: "docs/design.md", digest: digestRecon, gitMode: "100644" as const },
      planArtifact: { canonicalPath: "docs/plan.md", digest: digestRecon, gitMode: "100644" as const },
      requirementsResolution: { source: "explicit", canonicalPath: "docs/requirements.md", digest: digestRecon },
      reviewProtocolFingerprint: "review-v1",
    },
  };
  const discoveryRecon: ReviewGateEvent = {
    eventType: "FINDING_DISCOVERED",
    gateId: gateIdRecon,
    writerId: writerIdRecon,
    epochId: epochIdRecon,
    emittedAt: "2026-10-12T00:00:01.000Z",
    payload: {
      lineageId: lineageRecon,
      findingId: "finding-recon" as FindingId,
      observedPhase: "design",
      ownerScope: "design",
      descriptionDigest: digestRecon,
    },
  };
  const remediationRecon: FindingRemediatedV1 = {
    eventType: "FINDING_REMEDIATED",
    gateId: gateIdRecon,
    writerId: writerIdRecon,
    epochId: epochIdRecon,
    emittedAt: "2026-10-12T00:00:02.000Z",
    payload: {
      lineageId: lineageRecon,
      findingId: "finding-recon" as FindingId,
      remediationRound: { phase: "design", ordinal: 1 },
    },
  };
  const designGateProjection = projectReviewGate([createdRecon, discoveryRecon, remediationRecon]);
  const planPhaseProjection = projectReviewGate([
    createdRecon,
    { eventType: "DESIGN_CLEAR", gateId: gateIdRecon, writerId: writerIdRecon, epochId: epochIdRecon, emittedAt: "2026-10-12T00:00:03.000Z", payload: { designProtocolFingerprint: "design-v1" } },
    discoveryRecon,
    remediationRecon,
  ]);

  function existingResolvedFinding(observedPhase: "design" | "plan"): ValidatedFinding {
    return {
      candidateId: "candidate-recon",
      existingLineageId: lineageRecon,
      basisDigest: digestRecon,
      ownerScope: "design" as const,
      observedPhase,
      status: "existing_resolved" as const,
      severity: "minor" as const,
      descriptionDigest: digestRecon,
    };
  }

  it("rejects a plan-phase observation claiming resolution of a design-round lineage", () => {
    expect(() =>
      reconcileFindingBatch(planPhaseProjection, { findings: [existingResolvedFinding("plan")] }),
    ).toThrow("validator_result_conflict");
  });

  it("allows the same-stage observation to keep the resolution claim audit-only", () => {
    const payload = reconcileFindingBatch(designGateProjection, {
      findings: [existingResolvedFinding("design")],
    });

    expect(payload.events).toEqual([]);
    expect(payload.lineages).toEqual([]);
  });
});
