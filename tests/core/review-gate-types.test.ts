import { readFile } from "node:fs/promises";
import { expect, expectTypeOf, it } from "vitest";
import type {
  ArtifactDigest,
  CompletedApprovalBindingV1,
  DesignClearV1,
  EpochId,
  ExecutionSuspendedV1,
  FindingDiscoveredV1,
  FindingId,
  FindingRemediatedV1,
  FindingReopenedV1,
  FindingSelfReviewedV1,
  FindingState,
  GateCreatedV1,
  GateId,
  LineageId,
  OrchestrationResumedV1,
  PlanClearV1,
  RemediationRound,
  RequirementsResolutionV1,
  RequirementsResolutionV2,
  ReopenRequiredV1,
  ReviewArtifactBinding,
  ReviewGateEvent,
  ReviewGateState,
  ReviewGateStatus,
  ReviewApprovalBindingV1,
  ReviewNonConvergentV1,
  ReviewScopeId,
  RoundLimitExhaustedV1,
  VerifiedTrackedArtifactIdentity,
  RequirementsAuthoritySnapshotV1,
  WriterId,
} from "../../src/core/review-gate-types.js";
import type {
  CrossGenerationReconciliationCompletedV2,
  ExternalOperationDispatchedV2,
  FindingValidationCompletedV2,
  LineageRegressedV2,
  PrivateResponseEvidenceV1,
  ScopeEnrollmentV1,
  SemanticContextCompatibilityProofV1,
  SemanticContextInputsV1,
  TrustedProtocolReleaseAnchorV1,
  VerifiedCanonicalMutationTargetV1,
  VerifiedDispatchRecoveryCursorV1,
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedProtocolReleaseDeltaV1,
  VerifiedReviewWriterLeaseV1,
  VerifiedScopeFrontier,
  VerifiedSemanticContextTransitionInput,
  VerifiedTargetWriterAuthorityV1,
  VerifiedTargetWriterHandoffContinuationV1,
  VerifiedTargetWriterHandoffIntentV1,
  VerifiedTargetWriterHandoffV1,
  VerifiedTerminalWriterRevokeV1,
} from "../../src/core/review-gate/types.js";

declare const reviewScopeId: ReviewScopeId;
declare const gateId: GateId;
declare const writerId: WriterId;
declare const epochId: EpochId;
declare const lineageId: LineageId;
declare const findingId: FindingId;
declare const digest: ReviewArtifactBinding["digest"];

/** Runtime-evaluated branded digest for fixture objects (declare-const bindings are erased). */
const fixtureDigest = "d".repeat(64) as ArtifactDigest;

export function buildTypeFixtures(): ReadonlyArray<ReviewGateEvent> {
  const common = { gateId, writerId, epochId, emittedAt: "2026-10-07T00:00:00.000Z" };
  const approvalBinding = {
    reviewScopeId,
    gateId,
    designArtifact: { canonicalPath: "design.md", digest, gitMode: "100644" },
    planArtifact: { canonicalPath: "plan.md", digest, gitMode: "100644" },
    requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest },
    reviewProtocolFingerprint: "review",
    designProtocolFingerprint: "design",
    planProtocolFingerprint: "plan",
    approvedAt: "2026-10-07T00:00:00.000Z",
  } satisfies ReviewApprovalBindingV1;
  const events = [
    { ...common, eventType: "GATE_CREATED", payload: { reviewScopeId, designArtifact: approvalBinding.designArtifact, planArtifact: approvalBinding.planArtifact, requirementsResolution: approvalBinding.requirementsResolution, reviewProtocolFingerprint: "review" } } satisfies GateCreatedV1,
    { ...common, eventType: "ORCHESTRATION_RESUMED", payload: { resumedAt: common.emittedAt } } satisfies OrchestrationResumedV1,
    { ...common, eventType: "DESIGN_CLEAR", payload: { designProtocolFingerprint: "design" } } satisfies DesignClearV1,
    { ...common, eventType: "PLAN_CLEAR", payload: { completedApprovalBinding: approvalBinding } } satisfies PlanClearV1,
    { ...common, eventType: "REOPEN_REQUIRED", payload: { phase: "design", lineageIds: [lineageId] } } satisfies ReopenRequiredV1,
    { ...common, eventType: "ROUND_LIMIT_EXHAUSTED", payload: { phase: "plan", roundLimit: 3 } } satisfies RoundLimitExhaustedV1,
    { ...common, eventType: "REVIEW_NON_CONVERGENT", payload: { phase: "design", lineageIds: [lineageId] } } satisfies ReviewNonConvergentV1,
    { ...common, eventType: "EXECUTION_SUSPENDED", payload: { reason: "execution suspended" } } satisfies ExecutionSuspendedV1,
    { ...common, eventType: "FINDING_DISCOVERED", payload: { lineageId, findingId, observedPhase: "design", ownerScope: "design", descriptionDigest: digest } } satisfies FindingDiscoveredV1,
    { ...common, eventType: "FINDING_REMEDIATED", payload: { lineageId, findingId, remediationRound: { phase: "design", ordinal: 1 } } } satisfies FindingRemediatedV1,
    { ...common, eventType: "FINDING_SELF_REVIEWED", payload: { lineageId, findingId, remediationRound: { phase: "design", ordinal: 1 } } } satisfies FindingSelfReviewedV1,
    { ...common, eventType: "FINDING_REOPENED", payload: { lineageId, findingId, reopenedBy: epochId } } satisfies FindingReopenedV1,
    { ...common, eventType: "COMPLETED_APPROVAL_BINDING", payload: { approvalBinding } } satisfies CompletedApprovalBindingV1,
  ] as const satisfies ReadonlyArray<ReviewGateEvent>;
  const sampleFinding: FindingState = {
    lineageId,
    findingId,
    observedPhase: "design",
    ownerScope: "design",
    descriptionDigest: digest,
    status: "open",
    remediationRound: null,
    reopenedBy: null,
  };
  const sampleRound: RemediationRound = { phase: "design", ordinal: 1 };
  const sampleState: ReviewGateState = {
    reviewScopeId,
    gateId,
    status: "active",
    phase: "design",
    epoch: { epochId, startedAt: common.emittedAt, reason: "gate_created" },
    designRemediationRounds: [sampleRound],
    planRemediationRounds: [],
    findings: new Map([[lineageId, sampleFinding]]),
    suspensionReason: null,
    approvalBinding: null,
    supersedesGateId: null,
  };
  void sampleState;
  return events;
}

it("Review Gate event types are discriminated and unique", () => {
  const eventTypes = ["GATE_CREATED", "ARTIFACT_BINDINGS_UPDATED", "ORCHESTRATION_RESUMED", "DESIGN_CLEAR", "PLAN_CLEAR", "REOPEN_REQUIRED", "ROUND_LIMIT_EXHAUSTED", "REVIEW_NON_CONVERGENT", "EXECUTION_SUSPENDED", "FINDING_DISCOVERED", "FINDING_REMEDIATED", "FINDING_SELF_REVIEWED", "FINDING_REOPENED", "COMPLETED_APPROVAL_BINDING"] as const;
  expect(new Set(eventTypes).size).toBe(eventTypes.length);
  expectTypeOf<(typeof eventTypes)[number]>().toEqualTypeOf<ReviewGateEvent["eventType"]>();
  expectTypeOf<Extract<ReviewGateEvent, { readonly eventType: "GATE_CREATED" }>>().not.toBeNever();
});

it("Review Gate status and snapshot types have the expected shape", () => {
  expectTypeOf<ReviewGateStatus>().toEqualTypeOf<"active" | "suspended" | "completed">();
  expectTypeOf<ReviewGateState["findings"]>().toEqualTypeOf<ReadonlyMap<LineageId, FindingState>>();
});

it("VerifiedTrackedArtifactIdentity pins runtime filesystem evidence without persisted paths", () => {
  expectTypeOf<VerifiedTrackedArtifactIdentity>().toEqualTypeOf<Readonly<{
    canonicalPath: string;
    workspaceIdentity: string;
    repositoryIdentity: string;
    gitBlobOid: string;
    digest: ArtifactDigest;
    gitMode: "100644" | "100755";
    fsIdentity: Readonly<{ device: string; inode: string }>;
  }>>();
  const tracked = {
    canonicalPath: "docs/design.md",
    workspaceIdentity: "workspace-identity",
    repositoryIdentity: "repository-identity",
    gitBlobOid: "a".repeat(40),
    digest: fixtureDigest,
    gitMode: "100644",
    fsIdentity: { device: "2049", inode: "1188593" },
  } satisfies VerifiedTrackedArtifactIdentity;
  void tracked;
});

it("foundational Review Gate v4 DTOs are declared as immutable Core contracts", async () => {
  const typesSource = await readFile(
    new URL("../../src/core/review-gate/types.ts", import.meta.url),
    "utf8",
  );
  const reviewGateTypesSource = await readFile(
    new URL("../../src/core/review-gate-types.ts", import.meta.url),
    "utf8",
  );
  const coreDtoNames = [
    "ScopeEnrollmentV1",
    "VerifiedScopeFrontier",
    "VerifiedFirstEnrollmentAuthorityV1",
    "SemanticContextInputsV1",
    "SemanticContextCompatibilityProofV1",
    "VerifiedSemanticContextTransitionInput",
    "ExternalOperationDispatchedV2",
    "PrivateResponseEvidenceV1",
    "VerifiedDispatchRecoveryCursorV1",
    "TrustedProtocolReleaseAnchorV1",
    "VerifiedProtocolReleaseDeltaV1",
    "FindingValidationCompletedV2",
    "LineageRegressedV2",
    "CrossGenerationReconciliationCompletedV2",
    "VerifiedReviewWriterLeaseV1",
    "VerifiedCanonicalMutationTargetV1",
    "VerifiedTargetWriterAuthorityV1",
    "VerifiedTargetWriterHandoffV1",
    "VerifiedTargetWriterHandoffIntentV1",
    "VerifiedTargetWriterHandoffContinuationV1",
    "VerifiedTerminalWriterRevokeV1",
  ] as const;

  for (const name of coreDtoNames) {
    expect(typesSource).toContain(`export type ${name} = Readonly<`);
  }
  expect(reviewGateTypesSource).toContain(
    "export type RequirementsAuthoritySnapshotV1 = Readonly<",
  );
  expect(typesSource).not.toMatch(/from ["'][^"']*runtime\//);

  expectTypeOf<ScopeEnrollmentV1["gateMembership"]>().toEqualTypeOf<ReadonlyArray<
    Readonly<{
      gateId: string;
      generationId: string;
      supersedesGateId: string | null;
      admissionEventId: string;
      writerIds: ReadonlyArray<string>;
    }>
  >>();
  expectTypeOf<VerifiedScopeFrontier["scopes"]>().toEqualTypeOf<ReadonlyArray<ScopeEnrollmentV1>>();
  expectTypeOf<VerifiedFirstEnrollmentAuthorityV1["authorizationOperationId"]>().toEqualTypeOf<string>();
  expectTypeOf<SemanticContextInputsV1["requirements"]["gitMode"]>().toEqualTypeOf<
    "100644" | "100755"
  >();
  expectTypeOf<SemanticContextCompatibilityProofV1["result"]>().toEqualTypeOf<
    "EQUIVALENT" | "INCOMPATIBLE" | "INDETERMINATE"
  >();
  expectTypeOf<VerifiedSemanticContextTransitionInput["roundCountersBefore"]>().toEqualTypeOf<
    Readonly<{ design: number; plan: number }>
  >();
  expectTypeOf<ExternalOperationDispatchedV2["phase"]>().toEqualTypeOf<"design" | "plan">();
  expectTypeOf<PrivateResponseEvidenceV1["byteLength"]>().toEqualTypeOf<number>();
  expectTypeOf<VerifiedDispatchRecoveryCursorV1["kind"]>().toEqualTypeOf<
    | "INTENT_PRE_LAUNCH"
    | "IN_FLIGHT"
    | "RESPONSE_STAGED"
    | "RESULT_COMMITTED_OUTCOME_PENDING"
    | "APPLIED"
    | "EVIDENCE_UNAVAILABLE"
  >();
  expectTypeOf<TrustedProtocolReleaseAnchorV1["installationId"]>().toEqualTypeOf<string>();
  expectTypeOf<VerifiedProtocolReleaseDeltaV1["trustPolicyVersion"]>().toEqualTypeOf<string>();
  expectTypeOf<FindingValidationCompletedV2["disposition"]>().toEqualTypeOf<"ALREADY_RESOLVED">();
  expectTypeOf<LineageRegressedV2["eventType"]>().toEqualTypeOf<"LINEAGE_REGRESSED">();
  expectTypeOf<CrossGenerationReconciliationCompletedV2["result"]>().toEqualTypeOf<
    "RELATED_PRIOR_GENERATION" | "NO_PRIOR_MATCH"
  >();
  expectTypeOf<VerifiedReviewWriterLeaseV1["revokesAttemptId"]>().toEqualTypeOf<string | null>();
  expectTypeOf<VerifiedCanonicalMutationTargetV1["targetIdentityDigest"]>().toEqualTypeOf<string>();
  expectTypeOf<VerifiedTargetWriterAuthorityV1["globalTargetWriterGeneration"]>().toEqualTypeOf<number>();
  expectTypeOf<VerifiedTargetWriterHandoffV1["status"]>().toEqualTypeOf<
    "REVOKED_NO_ACTIVE_WRITER" | "CLAIMED_CURRENT_WRITER" | "BLOCKED"
  >();
  expectTypeOf<VerifiedTargetWriterHandoffIntentV1["status"]>().toEqualTypeOf<
    "REQUESTED" | "FENCED" | "CLAIMED" | "RESUMED" | "BLOCKED"
  >();
  expectTypeOf<VerifiedTargetWriterHandoffContinuationV1["status"]>().toEqualTypeOf<
    "REQUESTED" | "FENCED" | "CLAIMED" | "RESUMED" | "BLOCKED"
  >();
  expectTypeOf<VerifiedTerminalWriterRevokeV1["purpose"]>().toEqualTypeOf<"TERMINAL_REVOKE_ONLY">();
  expectTypeOf<RequirementsAuthoritySnapshotV1["requirements"]["gitMode"]>().toEqualTypeOf<
    "100644" | "100755"
  >();
});

it("RequirementsResolutionV2 is versioned, source-bounded and never confusable with legacy V1", () => {
  expectTypeOf<RequirementsResolutionV2["schemaVersion"]>().toEqualTypeOf<2>();
  expectTypeOf<RequirementsResolutionV2["source"]>().toEqualTypeOf<
    "explicit" | "design_declared_reference"
  >();
  expectTypeOf<RequirementsResolutionV1["source"]>().toEqualTypeOf<
    "explicit" | "auto_design_reference"
  >();
  expectTypeOf<RequirementsResolutionV1["source"]>().not.toEqualTypeOf<
    RequirementsResolutionV2["source"]
  >();
  expectTypeOf<RequirementsResolutionV2["selectionEvidence"]>().toEqualTypeOf<Readonly<{
    commandPath?: string;
    declaration?: Readonly<{
      designCanonicalPath: string;
      designDigest: ArtifactDigest;
      declarationLine: number;
      declarationDigest: ArtifactDigest;
      declaredCanonicalPath: string;
    }>;
  }>>();

  const v2Explicit = {
    schemaVersion: 2,
    source: "explicit",
    canonicalPath: "requirements.md",
    digest: fixtureDigest,
    gitMode: "100644",
    requirementsGitBlobOid: "b".repeat(40),
    committedBaselineOid: "c".repeat(40),
    workspaceIdentity: "workspace-identity",
    selectionEvidence: { commandPath: "requirements.md" },
  } satisfies RequirementsResolutionV2;
  const v2Declared = {
    ...v2Explicit,
    source: "design_declared_reference",
    selectionEvidence: {
      declaration: {
        designCanonicalPath: "docs/design.md",
        designDigest: fixtureDigest,
        declarationLine: 3,
        declarationDigest: fixtureDigest,
        declaredCanonicalPath: "requirements.md",
      },
    },
  } satisfies RequirementsResolutionV2;
  void v2Declared;

  // Historical V1 stored payloads keep their own shape: no schemaVersion
  // discriminator and the legacy `auto_design_reference` source that V2 never
  // carries, so a V1 record can never satisfy the V2 provenance contract.
  const v1Stored = { source: "auto_design_reference", canonicalPath: "requirements.md", digest: fixtureDigest };
  expect("schemaVersion" in v1Stored).toBe(false);
  expect(v1Stored.source).toBe("auto_design_reference");
  expect(v2Explicit.schemaVersion).toBe(2);
});
