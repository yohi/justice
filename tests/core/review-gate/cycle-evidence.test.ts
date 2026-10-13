import { describe, expect, it } from "vitest";
import {
  buildVerifiedSemanticCycles,
  evaluateNonConvergenceCycles,
  planSemanticContextTransition,
  type SemanticBlockerEvidence,
  type VerifiedCycleEvidence,
  type VerifiedLineageHistory,
  type VerifiedSemanticContext,
  type VerifiedSemanticCycle,
} from "../../../src/core/review-gate/cycle-evidence.js";
import {
  SEMANTIC_CONTEXT_COMPATIBILITY_PROOF_REGISTRY_DIGEST,
  SEMANTIC_CONTEXT_COMPATIBILITY_TABLE_DIGEST,
  SEMANTIC_CONTEXT_COMPATIBILITY_V1,
  computeSemanticGoverningProjectionDigest,
} from "../../../src/core/review-gate/deterministic-validation.js";
import type { LineageId, VerifiedSemanticContextTransitionInput } from "../../../src/core/review-gate/types.js";

const context: VerifiedSemanticContext = {
  gateId: "gate-1",
  generationId: "generation-1",
  phase: "design",
  phaseBaselineId: "design-baseline-0",
  semanticContractFingerprint: "semantic-v1",
  protocolFingerprint: "protocol-v1",
  contextDigest: "context-v1",
};

function blocker(
  lineageId: string,
  overrides: Partial<SemanticBlockerEvidence> = {},
): SemanticBlockerEvidence {
  return {
    lineageId: lineageId as LineageId,
    basisDigest: `basis-${lineageId}`,
    semanticLocation: `location-${lineageId}`,
    ownerScope: "design",
    violationType: "missing-invariant",
    governingReference: "requirements.md#invariant",
    violatedContract: "contract-v1",
    observationEventId: `observation-${lineageId}`,
    ...overrides,
  };
}

function cycle(
  roundOrdinal: number,
  overrides: Partial<VerifiedSemanticCycle> = {},
): VerifiedSemanticCycle {
  const defaultBlocker = blocker("lineage-1");
  return {
    context,
    roundOrdinal,
    operationId: `operation-${roundOrdinal}`,
    roundStartedEventId: `round-started-${roundOrdinal}`,
    preRevisionDigest: `revision-${roundOrdinal - 1}`,
    postRevisionDigest: `revision-${roundOrdinal}`,
    revisionCommitEventId: `commit-${roundOrdinal}`,
    comparisonSegmentId: "segment-0",
    preLandscapeEventId: `pre-landscape-${roundOrdinal}`,
    postLandscapeEventId: `post-landscape-${roundOrdinal}`,
    preBlockers: [defaultBlocker],
    postBlockers: [defaultBlocker],
    preCount: 1,
    postCount: 1,
    preFingerprint: `pre-fingerprint-${roundOrdinal}`,
    postFingerprint: `post-fingerprint-${roundOrdinal}`,
    targetOutcomes: [
      {
        lineageId: defaultBlocker.lineageId,
        roundOrdinal,
        result: "STILL_PRESENT",
        validationEventId: `validation-${roundOrdinal}`,
        targetEventId: `target-${roundOrdinal}`,
      },
    ],
    committedResolutions: [],
    regressions: [],
    ...overrides,
  };
}

function rawCycle(roundOrdinal: number): VerifiedCycleEvidence {
  const value = cycle(roundOrdinal);
  return { ...value };
}

function transitionInput(
  overrides: Partial<VerifiedSemanticContextTransitionInput> = {},
): VerifiedSemanticContextTransitionInput {
  const oldInputs = {
    workspaceIdentity: "workspace-1",
    gateId: "gate-1",
    generationId: "generation-1",
    phase: "design" as const,
    phaseBaselineId: "design-baseline-0",
    comparisonSegmentId: "segment-0",
    requirements: {
      source: "explicit",
      canonicalPath: "requirements.md",
      gitBlobOid: "requirements-0",
      gitMode: "100644" as const,
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
  };
  const newInputs = { ...oldInputs };
  const triggeringAuthorityEventId = "requirements-rebased-1";

  return {
    oldInputs,
    newInputs,
    proof: {
      validationEventId: "compatibility-validation-1",
      triggeringAuthorityEventId,
      validatorId: SEMANTIC_CONTEXT_COMPATIBILITY_V1.validatorId,
      validatorVersion: "1",
      executableDigest: "validator-executable-v1",
      registryDigest: SEMANTIC_CONTEXT_COMPATIBILITY_PROOF_REGISTRY_DIGEST,
      compatibilityTableDigest: SEMANTIC_CONTEXT_COMPATIBILITY_TABLE_DIGEST,
      oldNormalizedInputsDigest: computeSemanticGoverningProjectionDigest(oldInputs),
      newNormalizedInputsDigest: computeSemanticGoverningProjectionDigest(newInputs),
      result: "EQUIVALENT",
      ruleId: "SEMANTIC_CONTEXT_FIELDS_IDENTICAL_V1",
      ruleVersion: "1",
      requirementsDelta: null,
    },
    triggeringAuthorityEventId,
    verifiedHistoryFrontier: "frontier-1",
    roundCountersBefore: { design: 2, plan: 0 },
    roundCountersAfter: { design: 2, plan: 0 },
    operationId: "transition-operation-1",
    ...overrides,
  };
}

describe("buildVerifiedSemanticCycles", () => {
  it("preserves a stable semantic context across consecutive committed revisions", () => {
    const history: VerifiedLineageHistory = {
      frontierHash: "frontier-1",
      context,
      rounds: [rawCycle(1), rawCycle(2)],
    };

    expect(buildVerifiedSemanticCycles(history)).toEqual({
      kind: "verified",
      cycles: [cycle(1), cycle(2)],
    });
  });

  it("returns indeterminate for a revision gap instead of resetting the cycle", () => {
    const first = rawCycle(1);
    const second = rawCycle(2);
    const history: VerifiedLineageHistory = {
      frontierHash: "frontier-1",
      context,
      rounds: [first, { ...second, preRevisionDigest: "unrelated-revision" }],
    };

    expect(buildVerifiedSemanticCycles(history)).toMatchObject({
      kind: "indeterminate",
      missingEvidence: expect.arrayContaining(["consecutive_revision_link"]),
    });
  });

  it("returns indeterminate when a round context differs from the history context", () => {
    const changedContext = { ...context, protocolFingerprint: "protocol-v2" };
    const history: VerifiedLineageHistory = {
      frontierHash: "frontier-1",
      context,
      rounds: [{ ...rawCycle(1), context: changedContext }],
    };

    expect(buildVerifiedSemanticCycles(history)).toMatchObject({
      kind: "indeterminate",
      missingEvidence: ["round_context:1"],
    });
  });

  it("returns indeterminate when adjacent rounds do not increment by one", () => {
    const history: VerifiedLineageHistory = {
      frontierHash: "frontier-1",
      context,
      rounds: [rawCycle(1), { ...rawCycle(2), roundOrdinal: 3 }],
    };

    expect(buildVerifiedSemanticCycles(history)).toMatchObject({
      kind: "indeterminate",
      missingEvidence: ["consecutive_round_ordinal:1:3"],
    });
  });

  it("returns indeterminate when adjacent rounds change comparison segment", () => {
    const history: VerifiedLineageHistory = {
      frontierHash: "frontier-1",
      context,
      rounds: [rawCycle(1), { ...rawCycle(2), comparisonSegmentId: "segment-1" }],
    };

    expect(buildVerifiedSemanticCycles(history)).toMatchObject({
      kind: "indeterminate",
      missingEvidence: ["consecutive_comparison_segment:2"],
    });
  });
});

describe("evaluateNonConvergenceCycles", () => {
  it("evaluates all six predicates and keeps the normative primary priority", () => {
    const shared = blocker("lineage-1");
    const cycles = [
      cycle(1, { postFingerprint: "A", postBlockers: [shared] }),
      cycle(2, { postFingerprint: "B", postBlockers: [shared] }),
      cycle(3, {
        postFingerprint: "A",
        postBlockers: [shared],
        regressions: [
          {
            lineageId: shared.lineageId,
            priorResolutionEventId: "resolution-1",
            newObservationEventId: "observation-regressed",
            contextDigest: context.contextDigest,
          },
        ],
        committedResolutions: [
          {
            lineageId: shared.lineageId,
            resolutionEventId: "resolution-1",
            verifiedCommitOid: "commit-resolution-1",
            contextDigest: context.contextDigest,
          },
        ],
      }),
      cycle(4, { postFingerprint: "A", postBlockers: [shared] }),
    ];

    expect(evaluateNonConvergenceCycles(cycles)).toEqual({
      kind: "non_convergent",
      primaryReason: "RESOLVED_LINEAGE_REGRESSED",
      allReasons: [
        "RESOLVED_LINEAGE_REGRESSED",
        "OSCILLATION",
        "SAME_LINEAGE_STALL",
        "CONTRACT_CONFLICT_REPEATED",
        "REVIEW_NON_CONVERGENT",
        "ROUND_LIMIT_EXHAUSTED",
      ],
    });
  });

  it("does not classify an uncommitted reappearance as a regression", () => {
    const value = cycle(1, {
      regressions: [
        {
          lineageId: "lineage-1" as LineageId,
          priorResolutionEventId: "uncommitted-resolution",
          newObservationEventId: "observation-1",
          contextDigest: context.contextDigest,
        },
      ],
      targetOutcomes: [],
      postBlockers: [],
      preBlockers: [],
      preCount: 0,
      postCount: 0,
    });

    expect(evaluateNonConvergenceCycles([value])).toEqual({ kind: "convergent" });
  });

  it("matches a regression to a committed resolution in an earlier cycle", () => {
    const resolved = cycle(1, {
      committedResolutions: [
        {
          lineageId: "old-lineage" as LineageId,
          resolutionEventId: "resolution-from-earlier-cycle",
          verifiedCommitOid: "verified-commit",
          contextDigest: context.contextDigest,
        },
      ],
    });
    const regressed = cycle(2, {
      regressions: [
        {
          lineageId: "new-lineage" as LineageId,
          priorResolutionEventId: "resolution-from-earlier-cycle",
          newObservationEventId: "observation-regressed",
          contextDigest: context.contextDigest,
        },
      ],
    });

    expect(evaluateNonConvergenceCycles([resolved, regressed])).toMatchObject({
      kind: "non_convergent",
      primaryReason: "RESOLVED_LINEAGE_REGRESSED",
    });
  });

  it("returns indeterminate for an incomplete target outcome", () => {
    const value = cycle(1, { targetOutcomes: [] });

    expect(evaluateNonConvergenceCycles([value])).toMatchObject({
      kind: "indeterminate",
      missingEvidence: expect.arrayContaining(["target_outcome:lineage-1:1"]),
    });
  });
});

describe("planSemanticContextTransition", () => {
  it("keeps continuity only for the registered proof bound to both exact inputs", () => {
    const input = transitionInput();

    expect(planSemanticContextTransition(input)).toEqual({
      kind: "KEEP_CONTINUITY",
      phaseBaselineId: "design-baseline-0",
      comparisonSegmentId: "segment-0",
    });
  });

  it("prepares an incompatible segment without resetting the spent rounds", () => {
    const base = transitionInput();
    const newInputs = {
      ...base.newInputs,
      policy: { ...base.newInputs.policy, version: "2", semanticFingerprint: "semantic-v2" },
    };
    const input = transitionInput({
      newInputs,
      proof: {
        ...base.proof,
        newNormalizedInputsDigest: computeSemanticGoverningProjectionDigest(newInputs),
        result: "INCOMPATIBLE",
        ruleId: "REGISTERED_BREAKING_POLICY_V2",
      },
    });

    expect(planSemanticContextTransition(input)).toEqual({
      kind: "PREPARE_INCOMPATIBLE_SEGMENT",
      phaseBaselineId: "design-baseline-0",
      comparisonSegmentId: "segment-0:transition-operation-1",
    });
  });

  it("blocks a self-referential or mismatched proof rather than accepting a worker claim", () => {
    const base = transitionInput();
    const input = transitionInput({
      proof: { ...base.proof, validationEventId: base.triggeringAuthorityEventId },
    });

    expect(planSemanticContextTransition(input)).toMatchObject({ kind: "BLOCK" });
  });

  it.each([
    ["validatorId", "UNREGISTERED_VALIDATOR"],
    ["compatibilityTableDigest", "forged-table-digest"],
    ["registryDigest", "forged-registry-digest"],
    ["oldNormalizedInputsDigest", "forged-projection-digest"],
  ] as const)("blocks a proof with a mismatched %s", (field, value) => {
    const base = transitionInput();
    const input = transitionInput({
      proof: { ...base.proof, [field]: value },
    });

    expect(planSemanticContextTransition(input)).toMatchObject({ kind: "BLOCK" });
  });
});
