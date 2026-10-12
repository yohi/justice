import { describe, expect, it } from "vitest";
import type { ArtifactDigest, ReviewScopeId } from "../../../src/core/review-gate-types";
import {
  computeVerifiedContextDigest,
  planReviewGateAdmission,
  type AdmissionDecision,
  type VerifiedAdmissionSnapshot,
  type VerifiedCompletedBindingSnapshot,
  type VerifiedGateContextBinding,
  type VerifiedGateTip,
  type VerifiedNC1EligibleChangeV1,
  type VerifiedNC1StopV1,
  type VerifiedObservedRequirementsCandidate,
  type VerifiedUnfinishedBindingSnapshot,
  type VerifiedWorkspaceContinuityV1,
} from "../../../src/core/review-gate/admission";

const SCOPE_A = "scope-a" as ReviewScopeId;
const WORKSPACE = "workspace-1";
const FRONTIER = "frontier-abc";
const DIGEST = (value: string): ArtifactDigest =>
  `sha256-${value.padEnd(64, "0")}` as ArtifactDigest;

function artifactBinding(
  path: string,
  digestSeed: string,
): VerifiedGateContextBinding["design"] {
  return {
    canonicalPath: path,
    digest: DIGEST(digestSeed),
    gitMode: "100644",
  };
}

function requirementsBinding(
  path: string,
  digestSeed: string,
  blob: string,
): VerifiedGateContextBinding["requirements"] {
  return {
    source: "explicit",
    workspaceIdentity: WORKSPACE,
    canonicalPath: path,
    digest: DIGEST(digestSeed),
    gitMode: "100644",
    gitBlobOid: blob,
    selectedByEventId: `auth-${digestSeed}`,
  };
}

function observedRequirements(
  path: string,
  digestSeed: string,
  blob: string,
): VerifiedObservedRequirementsCandidate {
  return {
    source: "explicit",
    workspaceIdentity: WORKSPACE,
    canonicalPath: path,
    digest: DIGEST(digestSeed),
    gitMode: "100644",
    gitBlobOid: blob,
    observedCommitOid: `commit-${digestSeed}`,
    observationEvidenceId: `evidence-${digestSeed}`,
  };
}

function contextBinding(
  designSeed = "design",
  planSeed = "plan",
  requirementsSeed = "requirements",
): VerifiedGateContextBinding {
  return {
    requirements: requirementsBinding(
      "docs/requirements.md",
      requirementsSeed,
      `blob-${requirementsSeed}`,
    ),
    design: artifactBinding("docs/design.md", designSeed),
    plan: artifactBinding("docs/plan.md", planSeed),
    globalProtocolFingerprint: `global-${designSeed}-${planSeed}`,
    designProtocolFingerprint: `design-protocol-${designSeed}`,
    planProtocolFingerprint: `plan-protocol-${planSeed}`,
  };
}

function currentContext(
  designSeed = "design",
  planSeed = "plan",
  requirementsSeed = "requirements",
): VerifiedAdmissionSnapshot["current"] {
  return {
    requirements: observedRequirements(
      "docs/requirements.md",
      requirementsSeed,
      `blob-${requirementsSeed}`,
    ),
    design: artifactBinding("docs/design.md", designSeed),
    plan: artifactBinding("docs/plan.md", planSeed),
    globalProtocolFingerprint: `global-${designSeed}-${planSeed}`,
    designProtocolFingerprint: `design-protocol-${designSeed}`,
    planProtocolFingerprint: `plan-protocol-${planSeed}`,
  };
}

function emptyContinuity(
  overrides?: Partial<VerifiedWorkspaceContinuityV1>,
): VerifiedWorkspaceContinuityV1 {
  return {
    installationId: "install-1",
    workspaceIdentity: WORKSPACE,
    protectedInstallationFrontierHash: FRONTIER,
    workspaceEnrollmentFrontierHash: FRONTIER,
    registryVerificationEventId: "registry-1",
    allEnrollments: [],
    relatedScopeTips: [],
    relatedGateHistoryFrontierHash: FRONTIER,
    authorizedFirstEnrollment: null,
    verifiedIndependentWorkflow: null,
    verifiedCrossScopePredecessor: null,
    relationClosureProofDigest: "closure-abc",
    coverage: "COMPLETE",
    ...overrides,
  };
}

function firstEnrollment(): NonNullable<
  VerifiedWorkspaceContinuityV1["authorizedFirstEnrollment"]
> {
  return {
    installationId: "install-1",
    workspaceIdentity: WORKSPACE,
    canonicalDesignPath: "docs/design.md",
    canonicalPlanPath: "docs/plan.md",
    authorizationOperationId: "op-first",
    authenticatedProvisionerDigest: "prov-abc",
    verifiedAbsentPriorEnrollmentFrontierHash: FRONTIER,
    authorizationEventId: "first-enroll-1",
  };
}

function completedApproval(
  gateId: string,
  generationId: string,
  scopeId: string,
): VerifiedCompletedBindingSnapshot {
  return {
    approvalEventId: `approval-${gateId}`,
    gateId,
    generationId,
    historicalRequirementsV2EventId: "req-v2-1",
    historicalRequirements: {
      schemaVersion: 2,
      source: "explicit",
      canonicalPath: "docs/requirements.md",
      digest: DIGEST("requirements"),
      gitMode: "100644",
      requirementsGitBlobOid: "blob-requirements",
      committedBaselineOid: "commit-base",
      workspaceIdentity: WORKSPACE,
      selectionEvidence: {},
    },
    currentRequirementsAuthorityEventId: "req-auth-1",
    currentRequirements: requirementsBinding(
      "docs/requirements.md",
      "requirements",
      "blob-requirements",
    ),
    design: artifactBinding("docs/design.md", "design"),
    plan: artifactBinding("docs/plan.md", "plan"),
    designClearEventId: "design-clear-1",
    planClearEventId: "plan-clear-1",
    globalProtocolFingerprint: "global-design-plan",
    verifiedHistoryFrontier: FRONTIER,
    scopeId,
  } as unknown as VerifiedCompletedBindingSnapshot;
}

function completedTip(
  gateId: string,
  scopeId: string,
): VerifiedGateTip {
  return {
    status: "completed",
    gateId,
    generationId: `gen-${gateId}`,
    scopeId,
    supersedesGateId: null,
    completedApproval: completedApproval(gateId, `gen-${gateId}`, scopeId),
  };
}

function unfinishedBinding(): VerifiedUnfinishedBindingSnapshot {
  return {
    admission: {
      gateCreatedEventId: "created-1",
      historicalRequirementsV2EventId: "req-v2-1",
      context: contextBinding(),
    },
    effective: {
      context: contextBinding(),
      authorityEventId: "effective-1",
      operationId: "op-effective",
      verifiedHistoryFrontier: FRONTIER,
    },
    ownDesignClear: null,
  };
}

function activeTip(gateId: string, scopeId: string): VerifiedGateTip {
  return {
    status: "active",
    gateId,
    generationId: `gen-${gateId}`,
    scopeId,
    supersedesGateId: null,
    rounds: { design: 1, plan: 0 },
    suspensionReason: null,
    lastVerifiedBinding: unfinishedBinding(),
    nc1Stop: null,
  };
}

function suspendedTip(
  gateId: string,
  scopeId: string,
  reason: string,
  nc1Stop?: VerifiedNC1StopV1,
): VerifiedGateTip {
  return {
    status: "suspended",
    gateId,
    generationId: `gen-${gateId}`,
    scopeId,
    supersedesGateId: null,
    rounds: { design: 2, plan: 1 },
    suspensionReason: reason,
    lastVerifiedBinding: unfinishedBinding(),
    nc1Stop: nc1Stop ?? null,
  };
}

function emptyPrecedence(
  gateId: string,
  generationId: string,
): NonNullable<VerifiedAdmissionSnapshot["precedence"]> {
  return {
    gateId,
    generationId,
    phase: "design",
    verifiedLineageFrontierHash: FRONTIER,
    witnessFrontierHash: FRONTIER,
    completeLineageSetDigest: "lineage-set",
    currentStateProjectionEventId: "projection-1",
    currentUpstreamBlockers: [],
    pendingStaleLineages: [],
    relationCompleteness: "COMPLETE",
  };
}

function snapshot(
  overrides?: Partial<VerifiedAdmissionSnapshot>,
): VerifiedAdmissionSnapshot {
  return {
    workspaceIdentity: WORKSPACE,
    scopeId: SCOPE_A,
    verifiedFrontierHash: FRONTIER,
    workspaceContinuity: emptyContinuity(),
    currentTips: [],
    nc1Observation: "NOT_INSPECTED",
    nc1Candidate: null,
    precedence: null,
    current: currentContext(),
    ...overrides,
  };
}

function expectDecision(decision: AdmissionDecision, kind: AdmissionDecision["kind"]): void {
  expect(decision.kind).toBe(kind);
}

// ---------------------------------------------------------------------------
// Import-boundary guard: Core admission must not import Runtime.
// ---------------------------------------------------------------------------

describe("admission module import boundary", () => {
  it("does not import from src/runtime in admission.ts", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../../../src/core/review-gate/admission.ts", import.meta.url),
      "utf8",
    );
    const runtimeImportPattern = /from\s+["']\.\.\/\.\.\/\.\.\/runtime|from\s+["']\.\.\/\.\.\/runtime|from\s+["']\.\.\/runtime/;
    expect(source).not.toMatch(runtimeImportPattern);
    expect(source).not.toMatch(/import\s+.*\s+from\s+["']\.\.\/\.\.\/\.\.\/runtime/);
  });
});

// ---------------------------------------------------------------------------
// New scope admission
// ---------------------------------------------------------------------------

describe("new scope admission", () => {
  it("creates a genesis gate with authorized first enrollment and no related tips", () => {
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [],
        workspaceContinuity: emptyContinuity({
          authorizedFirstEnrollment: firstEnrollment(),
        }),
      }),
    );
    expectDecision(decision, "CREATE_GENESIS");
    if (decision.kind !== "CREATE_GENESIS") return;
    expect(decision.scopeId).toBe(SCOPE_A);
    expect(decision.enrollmentAuthorizationEventId).toBe("first-enroll-1");
    expect(decision.verifiedWorkspaceFrontierHash).toBe(FRONTIER);
  });

  it("blocks genesis when first enrollment is missing", () => {
    const decision = planReviewGateAdmission(snapshot({ currentTips: [] }));
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("first_enrollment_unauthorized");
  });

  it("blocks genesis when a related scope has an unfinished tip", () => {
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [],
        workspaceContinuity: emptyContinuity({
          authorizedFirstEnrollment: firstEnrollment(),
          relatedScopeTips: [activeTip("gate-other", "scope-other")],
        }),
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("related_unfinished_scope");
  });

  it("blocks when workspace continuity coverage is incomplete", () => {
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [],
        workspaceContinuity: emptyContinuity({
          coverage: "INCOMPLETE",
          authorizedFirstEnrollment: firstEnrollment(),
        }),
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("workspace_continuity_incomplete");
  });

  it("blocks when workspace identity in continuity proof mismatches", () => {
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [],
        workspaceContinuity: emptyContinuity({
          workspaceIdentity: "workspace-2",
          authorizedFirstEnrollment: firstEnrollment(),
        }),
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("workspace_identity_mismatch");
  });

  it("blocks when verified frontier does not match the continuity frontier", () => {
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [],
        verifiedFrontierHash: "different-frontier",
        workspaceContinuity: emptyContinuity({
          authorizedFirstEnrollment: firstEnrollment(),
        }),
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("frontier_mismatch");
  });
});

// ---------------------------------------------------------------------------
// Successor admission
// ---------------------------------------------------------------------------

describe("successor admission", () => {
  it("creates a successor from a verified completed predecessor", () => {
    const predecessor = completedTip("gate-pred", "scope-pred");
    const decision = planReviewGateAdmission(
      snapshot({
        scopeId: SCOPE_A,
        currentTips: [predecessor],
        workspaceContinuity: emptyContinuity({
          verifiedCrossScopePredecessor: {
            priorScopeId: "scope-pred",
            priorGateId: "gate-pred",
            completedApprovalEventId: predecessor.completedApproval.approvalEventId,
            predecessorVerificationEventId: "pred-verify-1",
            relationshipProofDigest: "rel-proof",
          },
        }),
      }),
    );
    expectDecision(decision, "CREATE_SUCCESSOR");
    if (decision.kind !== "CREATE_SUCCESSOR") return;
    expect(decision.predecessorScopeId).toBe("scope-pred");
    expect(decision.predecessorGateId).toBe("gate-pred");
    expect(decision.predecessorApprovalEventId).toBe(
      predecessor.completedApproval.approvalEventId,
    );
  });

  it("blocks successor when predecessor tip is not completed", () => {
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [activeTip("gate-pred", "scope-pred")],
        workspaceContinuity: emptyContinuity({
          verifiedCrossScopePredecessor: {
            priorScopeId: "scope-pred",
            priorGateId: "gate-pred",
            completedApprovalEventId: "approval-gate-pred",
            predecessorVerificationEventId: "pred-verify-1",
            relationshipProofDigest: "rel-proof",
          },
        }),
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("successor_predecessor_missing");
  });
});

// ---------------------------------------------------------------------------
// Completed gate admission
// ---------------------------------------------------------------------------

describe("completed gate admission", () => {
  it("reuses a completed gate when current material identity is exact", () => {
    const tip = completedTip("gate-done", SCOPE_A);
    const decision = planReviewGateAdmission(
      snapshot({ currentTips: [tip] }),
    );
    expectDecision(decision, "REUSE_COMPLETED");
    if (decision.kind !== "REUSE_COMPLETED") return;
    expect(decision.approvalEventId).toBe(tip.completedApproval.approvalEventId);
  });

  it("creates a successor when plan artifact has drifted", () => {
    const tip = completedTip("gate-done", SCOPE_A);
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        current: currentContext("design", "plan-changed", "requirements"),
      }),
    );
    expectDecision(decision, "CREATE_SUCCESSOR");
    if (decision.kind !== "CREATE_SUCCESSOR") return;
    expect(decision.predecessorGateId).toBe("gate-done");
  });

  it("blocks when multiple current tips exist for the same scope", () => {
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [
          completedTip("gate-done", SCOPE_A),
          activeTip("gate-active", SCOPE_A),
        ],
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("conflicting_current_tips");
  });
});

// ---------------------------------------------------------------------------
// Unfinished gate admission
// ---------------------------------------------------------------------------

describe("unfinished gate admission", () => {
  it("resumes an active gate with exact current binding", () => {
    const tip = activeTip("gate-active", SCOPE_A);
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-active", `gen-gate-active`),
      }),
    );
    expectDecision(decision, "RESUME");
    if (decision.kind !== "RESUME") return;
    expect(decision.gateId).toBe("gate-active");
  });

  it("revalidates when design artifact has drifted", () => {
    const tip = activeTip("gate-active", SCOPE_A);
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-active", `gen-gate-active`),
        current: currentContext("design-changed", "plan", "requirements"),
      }),
    );
    expectDecision(decision, "REVALIDATE_OR_BLOCK");
    if (decision.kind !== "REVALIDATE_OR_BLOCK") return;
    expect(decision.dimension).toBe("design");
  });

  it("revalidates when plan protocol fingerprint has drifted", () => {
    const tip = activeTip("gate-active", SCOPE_A);
    const current = currentContext();
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-active", `gen-gate-active`),
        current: {
          ...current,
          planProtocolFingerprint: "plan-protocol-changed",
        },
      }),
    );
    expectDecision(decision, "REVALIDATE_OR_BLOCK");
    if (decision.kind !== "REVALIDATE_OR_BLOCK") return;
    expect(decision.dimension).toBe("plan_protocol");
  });

  it("requires upstream precedence when blockers exist", () => {
    const tip = activeTip("gate-active", SCOPE_A);
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: {
          ...emptyPrecedence("gate-active", `gen-gate-active`),
          currentUpstreamBlockers: [
            {
              lineageId: "lineage-1",
              findingEventId: "finding-1",
              owner: "design",
              currentStatusEventId: "status-1",
              committedAuthorityEventId: "authority-1",
            },
          ],
        },
      }),
    );
    expectDecision(decision, "UPSTREAM_PRECEDENCE_REQUIRED");
    if (decision.kind !== "UPSTREAM_PRECEDENCE_REQUIRED") return;
    expect(decision.blockers).toHaveLength(1);
  });

  it("requires stale lineage revalidation when pending stale lineages exist", () => {
    const tip = activeTip("gate-active", SCOPE_A);
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: {
          ...emptyPrecedence("gate-active", `gen-gate-active`),
          pendingStaleLineages: [
            {
              lineageId: "lineage-2",
              staleEvidenceEventId: "stale-1",
              requiredRevalidationRuleId: "rule-1",
            },
          ],
        },
      }),
    );
    expectDecision(decision, "STALE_LINEAGE_REVALIDATION_REQUIRED");
    if (decision.kind !== "STALE_LINEAGE_REVALIDATION_REQUIRED") return;
    expect(decision.pending).toHaveLength(1);
  });

  it("blocks an unfinished gate when precedence proof is missing", () => {
    const tip = activeTip("gate-active", SCOPE_A);
    const decision = planReviewGateAdmission(
      snapshot({ currentTips: [tip], precedence: null }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("admission_precedence_unverified");
  });

  it("blocks when precedence frontier does not match the admission frontier", () => {
    const tip = activeTip("gate-active", SCOPE_A);
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: {
          ...emptyPrecedence("gate-active", `gen-gate-active`),
          witnessFrontierHash: "different-frontier",
        },
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("admission_precedence_frontier_mismatch");
  });
});

// ---------------------------------------------------------------------------
// NC1 suspended gate admission
// ---------------------------------------------------------------------------

function nc1Stop(phase: "design" | "plan" = "design"): VerifiedNC1StopV1 {
  const context = contextBinding();
  return {
    stopEventId: "nc1-stop-1",
    phase,
    epochId: "epoch-1",
    stoppedContextDigest: computeVerifiedContextDigest(context),
    remainingRounds: 3,
    witnessFrontierAtStop: FRONTIER,
    protocolRelease: {
      stopEventId: "nc1-stop-1",
      historicalReleaseId: "release-1",
      historicalReleaseProofDigest: "proof-1",
      historicalPublisherTrustPolicyVersion: "policy-1",
    },
  };
}

function artifactCandidate(
  afterContext: VerifiedGateContextBinding,
): VerifiedNC1EligibleChangeV1 {
  const stop = nc1Stop();
  return {
    kind: "artifact",
    gateId: "gate-nc1",
    generationId: "gen-gate-nc1",
    phase: "design",
    nc1StopEventId: stop.stopEventId,
    beforeContextDigest: stop.stoppedContextDigest,
    afterContextDigest: computeVerifiedContextDigest(afterContext),
    changeObservedEventId: "change-observed-1",
    observationOperationId: "op-change-1",
    witnessFrontierAtObservation: FRONTIER,
    artifactKind: "design",
    beforeArtifactDigest: DIGEST("design"),
    afterArtifactDigest: DIGEST("design-changed"),
    committedGitOid: "commit-1",
    verifiedGitParentOid: "parent-1",
    beforeGitBlobOid: "blob-design",
    afterGitBlobOid: "blob-design-changed",
    verifiedTargetClean: true,
  };
}

function protocolCandidate(
  afterContext: VerifiedGateContextBinding,
): VerifiedNC1EligibleChangeV1 {
  const stop = nc1Stop();
  return {
    kind: "protocol",
    gateId: "gate-nc1",
    generationId: "gen-gate-nc1",
    phase: "design",
    nc1StopEventId: stop.stopEventId,
    beforeContextDigest: stop.stoppedContextDigest,
    afterContextDigest: computeVerifiedContextDigest(afterContext),
    changeObservedEventId: "change-observed-1",
    observationOperationId: "op-change-1",
    witnessFrontierAtObservation: FRONTIER,
    protocolPhase: "design",
    beforePhaseFingerprint: "design-protocol-design",
    afterPhaseFingerprint: "design-protocol-changed",
    beforeDescriptorDigest: "desc-1",
    afterDescriptorDigest: "desc-2",
    protocolSchemaVersion: "1",
    beforeReleaseId: "release-1",
    afterReleaseId: "release-2",
    verifiedPublisherIdentityDigest: "publisher-1",
    authenticatedImmutableReleaseProvenanceDigest: "provenance-1",
    protectedProtocolRegistryFrontierHash: "registry-1",
    relevantStaticPromptAndPolicyDigest: "prompt-1",
    progressInvalidatedEventId: "invalidate-1",
  };
}

describe("NC1 suspended gate admission", () => {
  it("requests NC1 inspection when no observation has been attempted", () => {
    const stop = nc1Stop();
    const tip = suspendedTip(
      "gate-nc1",
      SCOPE_A,
      "review_non_convergent",
      stop,
    );
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-nc1", `gen-gate-nc1`),
        nc1Observation: "NOT_INSPECTED",
      }),
    );
    expectDecision(decision, "INSPECT_NC1_ELIGIBLE_CHANGE");
    if (decision.kind !== "INSPECT_NC1_ELIGIBLE_CHANGE") return;
    expect(decision.nc1StopEventId).toBe(stop.stopEventId);
    expect(decision.phase).toBe("design");
  });

  it("stays suspended when no eligible NC1 change was found", () => {
    const stop = nc1Stop();
    const tip = suspendedTip(
      "gate-nc1",
      SCOPE_A,
      "review_non_convergent",
      stop,
    );
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-nc1", `gen-gate-nc1`),
        nc1Observation: "VERIFIED_NONE",
      }),
    );
    expectDecision(decision, "STAY_SUSPENDED");
    if (decision.kind !== "STAY_SUSPENDED") return;
    expect(decision.nc1StopEventId).toBe(stop.stopEventId);
  });

  it("emits a reentry candidate for a verified artifact change", () => {
    const stop = nc1Stop();
    const afterContext = contextBinding("design-changed");
    const candidate = artifactCandidate(afterContext);
    const tip = suspendedTip(
      "gate-nc1",
      SCOPE_A,
      "review_non_convergent",
      stop,
    );
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-nc1", `gen-gate-nc1`),
        nc1Observation: "VERIFIED_CANDIDATE",
        nc1Candidate: candidate,
        current: currentContext("design-changed"),
      }),
    );
    expectDecision(decision, "REENTRY_CANDIDATE");
    if (decision.kind !== "REENTRY_CANDIDATE") return;
    expect(decision.changeObservedEventId).toBe(candidate.changeObservedEventId);
  });

  it("blocks an NC1 protocol candidate when historical release does not match stop authority", () => {
    const stop = nc1Stop();
    const afterContext = contextBinding("design-changed");
    const candidate: VerifiedNC1EligibleChangeV1 = {
      ...protocolCandidate(afterContext),
      beforeReleaseId: "release-mismatch",
    };
    const tip = suspendedTip(
      "gate-nc1",
      SCOPE_A,
      "review_non_convergent",
      stop,
    );
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-nc1", `gen-gate-nc1`),
        nc1Observation: "VERIFIED_CANDIDATE",
        nc1Candidate: candidate,
        current: currentContext("design-changed"),
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("protocol_release_authority_unverified");
  });

  it("blocks when NC1 candidate after-context does not match current observed context", () => {
    const stop = nc1Stop();
    const candidate = artifactCandidate(contextBinding("design-changed"));
    const tip = suspendedTip(
      "gate-nc1",
      SCOPE_A,
      "review_non_convergent",
      stop,
    );
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-nc1", `gen-gate-nc1`),
        nc1Observation: "VERIFIED_CANDIDATE",
        nc1Candidate: candidate,
        current: currentContext("design-changed-differently"),
      }),
    );
    expectDecision(decision, "BLOCK");
    if (decision.kind !== "BLOCK") return;
    expect(decision.reason).toBe("nc1_candidate_mismatch");
  });

  it("revalidates instead of resuming when NC1 suspended gate has exact binding", () => {
    const stop = nc1Stop();
    const tip = suspendedTip(
      "gate-nc1",
      SCOPE_A,
      "review_non_convergent",
      stop,
    );
    const decision = planReviewGateAdmission(
      snapshot({
        currentTips: [tip],
        precedence: emptyPrecedence("gate-nc1", `gen-gate-nc1`),
        nc1Observation: "VERIFIED_NONE",
      }),
    );
    expectDecision(decision, "STAY_SUSPENDED");
  });
});
