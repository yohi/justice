import { describe, expect, it, vi } from "vitest";
import type { AdmissionDecision } from "../../src/core/review-gate/admission";
import type { ReviewScopeId } from "../../src/core/review-gate-types";
import { SEMANTIC_CONTEXT_COMPATIBILITY_TABLE_DIGEST } from "../../src/core/review-gate/deterministic-validation";
import type { SemanticContextInputsV1 } from "../../src/core/review-gate/types";
import type {
  VerifiedNC1EligibleChangeV1,
  VerifiedNC1StopV1,
} from "../../src/core/review-gate/admission";
import type {
  AdmissionOwnedWitness,
  ReviewGateAdmissionExecutionResult,
  ReviewGateAdmissionObservation,
  VerifiedNC1EvidenceBundleV1,
} from "../../src/runtime/review-gate-admission-context";
import {
  applyReviewGateAdmissionDecision,
  planAdmissionNC1Reentry,
  planVerifiedSemanticContextTransition,
} from "../../src/runtime/review-gate-admission-executor";

const result: ReviewGateAdmissionExecutionResult = {
  kind: "RESULT",
  result: {
    dispatched: true,
    gateId: "gate",
    guidance: "review started",
    designPath: "docs/design.md",
    planPath: "docs/plan.md",
    designDigest: "design-digest",
    planDigest: "plan-digest",
    lockPhase: "reviewing",
    completedReuse: false,
  },
};

const decisions = [
  { kind: "BLOCK", reason: "first_enrollment_unauthorized", detail: "blocked" },
  { kind: "REUSE_COMPLETED", gateId: "gate", generationId: "generation", approvalEventId: "approval", verifiedHistoryFrontier: "history" },
  { kind: "CREATE_GENESIS", workspaceIdentity: "workspace", scopeId: "scope" as ReviewScopeId, installationId: "installation", enrollmentAuthorizationEventId: "enrollment", verifiedWorkspaceFrontierHash: "frontier", completeRelationClosureDigest: "closure" },
  { kind: "CREATE_SUCCESSOR", scopeId: "scope" as ReviewScopeId, predecessorScopeId: "prior-scope", predecessorGateId: "prior-gate", predecessorApprovalEventId: "approval", predecessorRelationProofDigest: "relation", verifiedWorkspaceFrontierHash: "frontier" },
  { kind: "RESUME", gateId: "gate", generationId: "generation", witnessFrontierHash: "frontier" },
  { kind: "STAY_SUSPENDED", gateId: "gate", generationId: "generation", nc1StopEventId: null, witnessFrontierHash: "frontier" },
  {
    kind: "REVALIDATE_OR_BLOCK",
    gateId: "gate",
    generationId: "generation",
    dimension: "design",
    reason: "drift",
    predecessorProofRefs: ["created", "effective"],
    witnessFrontierHash: "frontier",
    phase: "design",
    effectiveBinding: {
      context: {
        requirements: {
          source: "explicit",
          workspaceIdentity: "workspace",
          canonicalPath: "docs/requirements.md",
          digest: "digest" as import("../../src/core/review-gate-types").ArtifactDigest,
          gitMode: "100644",
          gitBlobOid: "a".repeat(40),
          selectedByEventId: "effective",
        },
        design: { canonicalPath: "docs/design.md", digest: "design" as import("../../src/core/review-gate-types").ArtifactDigest, gitMode: "100644" },
        plan: { canonicalPath: "docs/plan.md", digest: "plan" as import("../../src/core/review-gate-types").ArtifactDigest, gitMode: "100644" },
        globalProtocolFingerprint: "global",
        designProtocolFingerprint: "design-protocol",
        planProtocolFingerprint: "plan-protocol",
      },
      currentRequirementsAuthorityEventId: "effective",
      currentRequirements: {
        source: "explicit",
        workspaceIdentity: "workspace",
        canonicalPath: "docs/requirements.md",
        digest: "digest" as import("../../src/core/review-gate-types").ArtifactDigest,
        gitMode: "100644",
        gitBlobOid: "a".repeat(40),
        selectedByEventId: "effective",
      },
      authorityEventId: "effective",
      operationId: "effective-operation",
      verifiedHistoryFrontier: "history-frontier",
    },
    current: {
      requirements: {
        source: "explicit",
        workspaceIdentity: "workspace",
        canonicalPath: "docs/requirements.md",
        digest: "current" as import("../../src/core/review-gate-types").ArtifactDigest,
        gitMode: "100644",
        gitBlobOid: "b".repeat(40),
        observedCommitOid: "commit",
        observationEvidenceId: "trigger",
      },
      design: { canonicalPath: "docs/design.md", digest: "design" as import("../../src/core/review-gate-types").ArtifactDigest, gitMode: "100644" },
      plan: { canonicalPath: "docs/plan.md", digest: "plan" as import("../../src/core/review-gate-types").ArtifactDigest, gitMode: "100644" },
      globalProtocolFingerprint: "global",
      designProtocolFingerprint: "design-protocol",
      planProtocolFingerprint: "plan-protocol",
    },
    triggeringAuthorityEventId: "trigger",
    roundCountersBefore: { design: 2, plan: 1 },
    roundCountersAfter: { design: 2, plan: 1 },
  },
  { kind: "UPSTREAM_PRECEDENCE_REQUIRED", gateId: "gate", generationId: "generation", witnessFrontierHash: "frontier", blockers: [] },
  { kind: "STALE_LINEAGE_REVALIDATION_REQUIRED", gateId: "gate", generationId: "generation", witnessFrontierHash: "frontier", pending: [] },
  { kind: "INSPECT_NC1_ELIGIBLE_CHANGE", gateId: "gate", generationId: "generation", nc1StopEventId: "stop", phase: "design", witnessFrontierHash: "frontier" },
  { kind: "REENTRY_CANDIDATE", gateId: "gate", generationId: "generation", nc1StopEventId: "stop", changeObservedEventId: "change", witnessFrontierHash: "frontier", nc1EvidenceEventId: "evidence" },
] satisfies readonly AdmissionDecision[];

const observation = Object.freeze({}) as ReviewGateAdmissionObservation;
const owned = Object.freeze({}) as AdmissionOwnedWitness;

describe("applyReviewGateAdmissionDecision", () => {
  it.each(decisions)("dispatches the exact $kind decision to its matching handler", async (decision) => {
    const handlers = {
      BLOCK: vi.fn(async (received: Extract<AdmissionDecision, { kind: "BLOCK" }>) => { expect(received).toBe(decision); return result; }),
      REUSE_COMPLETED: vi.fn(async (received: Extract<AdmissionDecision, { kind: "REUSE_COMPLETED" }>) => { expect(received).toBe(decision); return result; }),
      CREATE_GENESIS: vi.fn(async (received: Extract<AdmissionDecision, { kind: "CREATE_GENESIS" }>) => { expect(received).toBe(decision); return result; }),
      CREATE_SUCCESSOR: vi.fn(async (received: Extract<AdmissionDecision, { kind: "CREATE_SUCCESSOR" }>) => { expect(received).toBe(decision); return result; }),
      RESUME: vi.fn(async (received: Extract<AdmissionDecision, { kind: "RESUME" }>) => { expect(received).toBe(decision); return result; }),
      STAY_SUSPENDED: vi.fn(async (received: Extract<AdmissionDecision, { kind: "STAY_SUSPENDED" }>) => { expect(received).toBe(decision); return result; }),
      REVALIDATE_OR_BLOCK: vi.fn(async (received: Extract<AdmissionDecision, { kind: "REVALIDATE_OR_BLOCK" }>) => { expect(received).toBe(decision); return result; }),
      UPSTREAM_PRECEDENCE_REQUIRED: vi.fn(async (received: Extract<AdmissionDecision, { kind: "UPSTREAM_PRECEDENCE_REQUIRED" }>) => { expect(received).toBe(decision); return result; }),
      STALE_LINEAGE_REVALIDATION_REQUIRED: vi.fn(async (received: Extract<AdmissionDecision, { kind: "STALE_LINEAGE_REVALIDATION_REQUIRED" }>) => { expect(received).toBe(decision); return result; }),
      INSPECT_NC1_ELIGIBLE_CHANGE: vi.fn(async (received: Extract<AdmissionDecision, { kind: "INSPECT_NC1_ELIGIBLE_CHANGE" }>) => { expect(received).toBe(decision); return result; }),
      REENTRY_CANDIDATE: vi.fn(async (received: Extract<AdmissionDecision, { kind: "REENTRY_CANDIDATE" }>) => { expect(received).toBe(decision); return result; }),
    };
    const actual = await applyReviewGateAdmissionDecision(
      { decision, observation, owned },
      handlers,
    );

    expect(actual).toBe(result);
    for (const [name, handler] of Object.entries(handlers)) {
      expect(handler).toHaveBeenCalledTimes(name === decision.kind ? 1 : 0);
      if (name === decision.kind) {
        expect(handler).toHaveBeenCalledWith(decision, observation, owned);
      }
    }
  });
});

const semanticInputs = (overrides: Partial<SemanticContextInputsV1> = {}): SemanticContextInputsV1 => ({
  workspaceIdentity: "workspace",
  gateId: "gate",
  generationId: "generation",
  phase: "design",
  phaseBaselineId: "baseline",
  comparisonSegmentId: "segment",
  requirements: {
    source: "explicit",
    canonicalPath: "docs/requirements.md",
    gitBlobOid: "a".repeat(40),
    gitMode: "100644",
    authorityEventId: "authority-old",
    governingReferenceManifestDigest: "manifest",
  },
  upstreamApproved: null,
  policy: {
    contractId: "review-gate-phase-semantic-policy",
    version: "1",
    semanticFingerprint: "semantic-policy",
    lineageFingerprint: "lineage-policy",
    nc1Fingerprint: "nc1-policy",
    validatorRegistryDigest: "registry",
  },
  ...overrides,
});

const transitionFixture = (input: Readonly<{
  readonly oldSourceText?: string;
  readonly newSourceText?: string;
  readonly newPolicyVersion?: string;
}> = {}): ReturnType<typeof planVerifiedSemanticContextTransition> => {
  const oldInputs = semanticInputs();
  const newInputs = semanticInputs({
    ...oldInputs,
    requirements: {
      ...oldInputs.requirements,
      gitBlobOid: "b".repeat(40),
      authorityEventId: "authority-current",
    },
    policy: {
      ...oldInputs.policy,
      version: input.newPolicyVersion ?? oldInputs.policy.version,
    },
  });
  return planVerifiedSemanticContextTransition({
    oldInputs,
    newInputs,
    oldSourceText: input.oldSourceText ?? "# Requirements\n\n## API {#api}\nStable contract.\n",
    newSourceText: input.newSourceText ?? "# Requirements\n\n## API {#api}\nStable contract.\n",
    oldAuthorityEventId: "authority-old",
    newAuthorityEventId: "authority-current",
    triggeringAuthorityEventId: "trigger",
    verifiedFrontierHash: "frontier",
    roundCountersBefore: { design: 2, plan: 1 },
    roundCountersAfter: { design: 2, plan: 1 },
    operationId: "transition-operation",
    validationEventId: "validation-event",
    executableDigest: "executable-digest",
    registeredPolicyDigest: SEMANTIC_CONTEXT_COMPATIBILITY_TABLE_DIGEST,
    governingReferenceSectionKeys: ["/#api"],
  });
};

describe("planVerifiedSemanticContextTransition", () => {
  it("keeps continuity for a verified equivalent context without spending rounds", () => {
    const result = transitionFixture();

    expect(result.kind).toBe("verified");
    if (result.kind !== "verified") throw new Error("transition_should_be_verified");
    expect(result.decision.kind).toBe("KEEP_CONTINUITY");
    if (result.decision.kind !== "KEEP_CONTINUITY") throw new Error("transition_should_keep_continuity");
    expect(result.decision.phaseBaselineId).toBe("baseline");
    expect(result.decision.comparisonSegmentId).toBe("segment");
  });

  it("prepares an incompatible segment for the registered breaking policy transition", () => {
    const result = transitionFixture({
      oldSourceText: "# Requirements\n\n## API {#api}\nOld contract.\n",
      newSourceText: "# Requirements\n\n## API {#api}\nNew contract.\n",
      newPolicyVersion: "2",
    });

    expect(result.kind).toBe("verified");
    if (result.kind !== "verified") throw new Error("transition_should_be_verified");
    expect(result.decision.kind).toBe("PREPARE_INCOMPATIBLE_SEGMENT");
    if (result.decision.kind !== "PREPARE_INCOMPATIBLE_SEGMENT") {
      throw new Error("transition_should_prepare_incompatible_segment");
    }
    expect(result.decision.comparisonSegmentId).toBe("segment:transition-operation");
  });

  it("blocks when the validator cannot produce a verified compatibility proof", () => {
    const result = transitionFixture({ newPolicyVersion: "unregistered" });

    expect(result.kind).toBe("BLOCK");
    if (result.kind !== "BLOCK") throw new Error("transition_should_block_without_proof");
    expect(result.reason).toBe("semantic_compatibility_indeterminate");
  });
});

const nc1Stop: VerifiedNC1StopV1 = {
  stopEventId: "nc1-stop",
  phase: "design",
  epochId: "epoch",
  stoppedWriterId: "writer",
  stoppedContextDigest: "before-context",
  remainingRounds: 2,
  witnessFrontierAtStop: "stop-frontier",
  protocolRelease: {
    stopEventId: "nc1-stop",
    historicalReleaseId: null,
    historicalReleaseProofDigest: null,
    historicalPublisherTrustPolicyVersion: null,
  },
};

const nc1Change: VerifiedNC1EligibleChangeV1 = {
  kind: "artifact",
  artifactKind: "design",
  gateId: "gate",
  generationId: "generation",
  phase: "design",
  nc1StopEventId: "nc1-stop",
  beforeContextDigest: "before-context",
  afterContextDigest: "after-context",
  changeObservedEventId: "change-event",
  observationOperationId: "change-operation",
  witnessFrontierAtObservation: "frontier",
  beforeArtifactDigest: "old-design",
  afterArtifactDigest: "new-design",
  committedGitOid: "commit",
  verifiedGitParentOid: "parent",
  beforeGitBlobOid: "a".repeat(40),
  afterGitBlobOid: "b".repeat(40),
  verifiedTargetClean: true,
};

const reentryBundle = (
  overrides: Partial<VerifiedNC1EvidenceBundleV1> = {},
): VerifiedNC1EvidenceBundleV1 => ({
  stop: nc1Stop,
  change: nc1Change,
  validationOutcome: {
    outcome: "MATERIAL_PROGRESS",
    validationEventId: "validation-event",
    boundNc1EvidenceEventId: "nc1-stop",
    boundChangeProofEventId: "change-event",
  },
  frontierHash: "frontier",
  ...overrides,
});

const reentryDecision = decisions.find(
  (decision): decision is Extract<AdmissionDecision, { kind: "REENTRY_CANDIDATE" }> =>
    decision.kind === "REENTRY_CANDIDATE",
);

describe("planAdmissionNC1Reentry", () => {
  it("reenters only for matching independently verified material progress", () => {
    if (reentryDecision === undefined) throw new Error("reentry_decision_fixture_missing");
    const evidence = reentryBundle();
    const candidateDecision = {
      ...reentryDecision,
      nc1StopEventId: nc1Stop.stopEventId,
      changeObservedEventId: nc1Change.changeObservedEventId,
      nc1EvidenceEventId: nc1Stop.stopEventId,
    };
    const admissionObservation: ReviewGateAdmissionObservation = {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        verifiedFrontierHash: "frontier",
        nc1Evidence: evidence,
      },
      nc1Evidence: evidence,
    };

    expect(planAdmissionNC1Reentry(candidateDecision, admissionObservation)).toEqual({
      kind: "REENTER_SAME_GENERATION",
      gateId: "gate",
      generationId: "generation",
      epochId: "epoch",
      validationEventId: "validation-event",
      input: expect.objectContaining({
        nc1EvidenceEventId: "nc1-stop",
        verifiedChange: nc1Change,
        validation: {
          outcome: "MATERIAL_PROGRESS",
          validationEventId: "validation-event",
          boundNc1EvidenceEventId: "nc1-stop",
          boundChangeProofEventId: "change-event",
        },
      }),
    });
  });

  it("blocks a candidate whose evidence frontier is stale", () => {
    if (reentryDecision === undefined) throw new Error("reentry_decision_fixture_missing");
    const staleBundle = reentryBundle({ frontierHash: "stale-frontier" });
    const candidateDecision = {
      ...reentryDecision,
      nc1StopEventId: nc1Stop.stopEventId,
      changeObservedEventId: nc1Change.changeObservedEventId,
      nc1EvidenceEventId: nc1Stop.stopEventId,
    };
    const admissionObservation: ReviewGateAdmissionObservation = {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        verifiedFrontierHash: "frontier",
        nc1Evidence: staleBundle,
      },
      nc1Evidence: staleBundle,
    };

    expect(planAdmissionNC1Reentry(candidateDecision, admissionObservation)).toEqual({
      kind: "BLOCK",
      reason: "nc1_admission_evidence_binding_mismatch",
    });
  });

  it("stays suspended when no independent validation outcome is present", () => {
    if (reentryDecision === undefined) throw new Error("reentry_decision_fixture_missing");
    const pendingBundle = reentryBundle({ validationOutcome: null });
    const candidateDecision = {
      ...reentryDecision,
      nc1StopEventId: nc1Stop.stopEventId,
      changeObservedEventId: nc1Change.changeObservedEventId,
      nc1EvidenceEventId: nc1Stop.stopEventId,
    };
    const admissionObservation: ReviewGateAdmissionObservation = {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        verifiedFrontierHash: "frontier",
        nc1Evidence: pendingBundle,
      },
      nc1Evidence: pendingBundle,
    };

    expect(planAdmissionNC1Reentry(candidateDecision, admissionObservation)).toEqual({
      kind: "STAY_SUSPENDED",
      gateId: "gate",
      generationId: "generation",
    });
  });
});
