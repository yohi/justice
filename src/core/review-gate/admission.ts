/**
 * Task 7 — Pure Core Review Gate admission planner.
 *
 * `planReviewGateAdmission` receives an immutable, pre-verified snapshot built
 * by the Runtime under its protected workspace/scope/Gate lease, and decides the
 * next legal transition. It performs no I/O, holds no Runtime instances, and
 * never mints a new generation from an unfinished Gate.
 */

import type {
  ArtifactDigest,
  RequirementsResolutionV2,
  ReviewArtifactBinding,
  ReviewGatePhase,
  ReviewScopeId,
} from "../review-gate-types.js";
import type {
  ScopeEnrollmentV1,
  VerifiedDispatchRecoveryCursorV1,
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedRequirementsBinding,
  VerifiedTargetWriterAuthoritiesV1,
  VerifiedTargetWriterHandoffStateV1,
  VerifiedTerminalStateV1,
} from "./types.js";
import { computeCanonicalJsonFingerprint } from "./identity.js";

// ---------------------------------------------------------------------------
// Verified material DTOs
// ---------------------------------------------------------------------------

export type VerifiedObservedRequirementsCandidate = Readonly<{
  readonly source: "explicit" | "design_declared_reference";
  readonly workspaceIdentity: string;
  readonly canonicalPath: string;
  readonly digest: ArtifactDigest;
  readonly gitMode: "100644" | "100755";
  readonly gitBlobOid: string;
  readonly observedCommitOid: string;
  readonly observationEvidenceId: string;
}>;

export type VerifiedGateContextBinding = Readonly<{
  readonly requirements: VerifiedRequirementsBinding;
  readonly design: ReviewArtifactBinding;
  readonly plan: ReviewArtifactBinding;
  readonly globalProtocolFingerprint: string;
  readonly designProtocolFingerprint: string;
  readonly planProtocolFingerprint: string;
}>;

export type VerifiedCompletedBindingSnapshot = Readonly<{
  readonly approvalEventId: string;
  readonly gateId: string;
  readonly generationId: string;
  readonly historicalRequirementsV2EventId: string;
  readonly historicalRequirements: RequirementsResolutionV2;
  readonly currentRequirementsAuthorityEventId: string;
  readonly currentRequirements: VerifiedRequirementsBinding;
  readonly design: ReviewArtifactBinding;
  readonly plan: ReviewArtifactBinding;
  readonly designClearEventId: string;
  readonly planClearEventId: string;
  readonly globalProtocolFingerprint: string;
  readonly verifiedHistoryFrontier: string;
}>;

export type VerifiedUnfinishedBindingSnapshot = Readonly<{
  readonly admission: Readonly<{
    readonly gateCreatedEventId: string;
    readonly historicalRequirementsV2EventId: string;
    readonly context: VerifiedGateContextBinding;
  }>;
  readonly effective: Readonly<{
    readonly context: VerifiedGateContextBinding;
    readonly authorityEventId: string;
    readonly operationId: string;
    readonly verifiedHistoryFrontier: string;
  }>;
  readonly ownDesignClear: Readonly<{
    readonly eventId: string;
    readonly approvedContextEventId: string;
    readonly approvedRequirementsAuthorityEventId: string;
    readonly approvedDesign: ReviewArtifactBinding;
    readonly designProtocolFingerprint: string;
  }> | null;
}>;

export type VerifiedNC1StoppedProtocolReleaseV1 = Readonly<{
  readonly stopEventId: string;
  readonly historicalReleaseId: string | null;
  readonly historicalReleaseProofDigest: string | null;
  readonly historicalPublisherTrustPolicyVersion: string | null;
}>;

/**
 * One durable NC1 stop. `epochId` + `stoppedWriterId` are the Task 14 two-key
 * reentry keys: resuming a gate stopped here requires the same epoch and
 * writer.
 */
export type VerifiedNC1StopV1 = Readonly<{
  readonly stopEventId: string;
  readonly phase: ReviewGatePhase;
  readonly epochId: string;
  readonly stoppedWriterId: string;
  readonly stoppedContextDigest: string;
  readonly remainingRounds: number;
  readonly witnessFrontierAtStop: string;
  readonly protocolRelease: VerifiedNC1StoppedProtocolReleaseV1;
}>;

export type VerifiedNC1EligibleChangeV1 = Readonly<{
  readonly gateId: string;
  readonly generationId: string;
  readonly phase: ReviewGatePhase;
  readonly nc1StopEventId: string;
  readonly beforeContextDigest: string;
  readonly afterContextDigest: string;
  readonly changeObservedEventId: string;
  readonly observationOperationId: string;
  readonly witnessFrontierAtObservation: string;
}> &
  (
    | Readonly<{
        readonly kind: "artifact";
        readonly artifactKind: "requirements" | "design" | "plan";
        readonly beforeArtifactDigest: string;
        readonly afterArtifactDigest: string;
        readonly committedGitOid: string;
        readonly verifiedGitParentOid: string;
        readonly beforeGitBlobOid: string;
        readonly afterGitBlobOid: string;
        readonly verifiedTargetClean: true;
      }>
    | Readonly<{
        readonly kind: "protocol";
        readonly protocolPhase: "design" | "plan";
        readonly beforePhaseFingerprint: string;
        readonly afterPhaseFingerprint: string;
        readonly beforeDescriptorDigest: string;
        readonly afterDescriptorDigest: string;
        readonly protocolSchemaVersion: string;
        readonly beforeReleaseId: string;
        readonly afterReleaseId: string;
        readonly verifiedPublisherIdentityDigest: string;
        readonly authenticatedImmutableReleaseProvenanceDigest: string;
        readonly protectedProtocolRegistryFrontierHash: string;
        readonly relevantStaticPromptAndPolicyDigest: string;
        readonly progressInvalidatedEventId: string;
      }>
  );

export type VerifiedGateTip =
  | Readonly<{
      readonly status: "completed";
      readonly gateId: string;
      readonly generationId: string;
      readonly scopeId: string;
      readonly supersedesGateId: string | null;
      readonly completedApproval: VerifiedCompletedBindingSnapshot;
    }>
  | Readonly<{
      readonly status: "active" | "suspended";
      readonly gateId: string;
      readonly generationId: string;
      readonly scopeId: string;
      readonly supersedesGateId: string | null;
      readonly rounds: Readonly<{ readonly design: number; readonly plan: number }>;
      readonly suspensionReason: string | null;
      readonly suspensionEpochId: string | null;
      readonly lastVerifiedBinding: VerifiedUnfinishedBindingSnapshot;
      readonly nc1Stop: VerifiedNC1StopV1 | null;
      readonly dispatchRecoveryCursors: ReadonlyArray<VerifiedDispatchRecoveryCursorV1>;
      readonly terminalState: VerifiedTerminalStateV1 | null;
      readonly targetWriterAuthorities: VerifiedTargetWriterAuthoritiesV1 | null;
      readonly targetWriterHandoffState: VerifiedTargetWriterHandoffStateV1 | null;
    }>

export type VerifiedWorkspaceContinuityV1 = Readonly<{
  readonly installationId: string;
  readonly workspaceIdentity: string;
  readonly protectedInstallationFrontierHash: string;
  readonly workspaceEnrollmentFrontierHash: string;
  readonly registryVerificationEventId: string;
  readonly allEnrollments: ReadonlyArray<ScopeEnrollmentV1>;
  readonly relatedScopeTips: ReadonlyArray<VerifiedGateTip>;
  readonly relatedGateHistoryFrontierHash: string;
  readonly authorizedFirstEnrollment: VerifiedFirstEnrollmentAuthorityV1 | null;
  readonly verifiedIndependentWorkflow: Readonly<{
    readonly authorizationEventId: string;
    readonly authenticatedDistinctWorkflowProofDigest: string;
    readonly comparedEnrollmentFrontierHash: string;
    readonly proposedPathPairDigest: string;
  }> | null;
  readonly verifiedCrossScopePredecessor: Readonly<{
    readonly priorScopeId: string;
    readonly priorGateId: string;
    readonly completedApprovalEventId: string;
    readonly predecessorVerificationEventId: string;
    readonly relationshipProofDigest: string;
  }> | null;
  readonly relationClosureProofDigest: string;
  readonly coverage: "COMPLETE" | "INCOMPLETE" | "AMBIGUOUS";
}>;

export type VerifiedAdmissionPrecedenceV1 = Readonly<{
  readonly gateId: string;
  readonly generationId: string;
  readonly phase: ReviewGatePhase;
  readonly verifiedLineageFrontierHash: string;
  readonly witnessFrontierHash: string;
  readonly completeLineageSetDigest: string;
  readonly currentStateProjectionEventId: string;
  readonly currentUpstreamBlockers: ReadonlyArray<
    Readonly<{
      readonly lineageId: string;
      readonly findingEventId: string;
      readonly owner: "requirements" | "design";
      readonly currentStatusEventId: string;
      readonly committedAuthorityEventId: string;
    }>
  >;
  readonly pendingStaleLineages: ReadonlyArray<
    Readonly<{
      readonly lineageId: string;
      readonly staleEvidenceEventId: string;
      readonly requiredRevalidationRuleId: string;
    }>
  >;
  readonly relationCompleteness: "COMPLETE" | "INDETERMINATE";
}>;

export type VerifiedAdmissionSnapshot = Readonly<{
  readonly workspaceIdentity: string;
  readonly scopeId: ReviewScopeId;
  readonly verifiedFrontierHash: string;
  readonly workspaceContinuity: VerifiedWorkspaceContinuityV1;
  readonly currentTips: ReadonlyArray<VerifiedGateTip>;
  readonly nc1Observation: "NOT_INSPECTED" | "VERIFIED_NONE" | "VERIFIED_CANDIDATE";
  readonly nc1Candidate: VerifiedNC1EligibleChangeV1 | null;
  readonly precedence: VerifiedAdmissionPrecedenceV1 | null;
  readonly current: Readonly<{
    readonly requirements: VerifiedObservedRequirementsCandidate;
    readonly design: ReviewArtifactBinding;
    readonly plan: ReviewArtifactBinding;
    readonly globalProtocolFingerprint: string;
    readonly designProtocolFingerprint: string;
    readonly planProtocolFingerprint: string;
  }>;
}>;

// ---------------------------------------------------------------------------
// Admission decisions
// ---------------------------------------------------------------------------

export type AdmissionBlockReason =
  | "workspace_continuity_incomplete"
  | "workspace_continuity_ambiguous"
  | "workspace_identity_mismatch"
  | "frontier_mismatch"
  | "related_unfinished_scope"
  | "conflicting_current_tips"
  | "completed_binding_missing_or_corrupt"
  | "unfinished_binding_missing_or_corrupt"
  | "admission_precedence_unverified"
  | "admission_precedence_indeterminate"
  | "admission_precedence_frontier_mismatch"
  | "nc1_candidate_invalid"
  | "nc1_candidate_mismatch"
  | "protocol_release_authority_unverified"
  | "first_enrollment_unauthorized"
  | "successor_predecessor_missing"
  | "scope_not_enrolled";

export type RevalidateDimension =
  | "requirements"
  | "design"
  | "plan"
  | "design_protocol"
  | "plan_protocol"
  | "global_protocol";

export type VerifiedAdmissionAuthorityDecisionV1 =
  | Readonly<{
      readonly kind: "CREATE_GENESIS";
      readonly workspaceIdentity: string;
      readonly scopeId: ReviewScopeId;
      readonly installationId: string;
      readonly enrollmentAuthorizationEventId: string;
      readonly verifiedWorkspaceFrontierHash: string;
      readonly completeRelationClosureDigest: string;
    }>
  | Readonly<{
      readonly kind: "CREATE_SUCCESSOR";
      readonly scopeId: ReviewScopeId;
      readonly predecessorScopeId: string;
      readonly predecessorGateId: string;
      readonly predecessorApprovalEventId: string;
      readonly predecessorRelationProofDigest: string;
      readonly verifiedWorkspaceFrontierHash: string;
    }>
  | Readonly<{
      readonly kind: "UPSTREAM_PRECEDENCE_REQUIRED";
      readonly gateId: string;
      readonly generationId: string;
      readonly witnessFrontierHash: string;
      readonly blockers: VerifiedAdmissionPrecedenceV1["currentUpstreamBlockers"];
    }>
  | Readonly<{
      readonly kind: "STALE_LINEAGE_REVALIDATION_REQUIRED";
      readonly gateId: string;
      readonly generationId: string;
      readonly witnessFrontierHash: string;
      readonly pending: VerifiedAdmissionPrecedenceV1["pendingStaleLineages"];
    }>
  | Readonly<{
      readonly kind: "INSPECT_NC1_ELIGIBLE_CHANGE";
      readonly gateId: string;
      readonly generationId: string;
      readonly nc1StopEventId: string;
      readonly phase: ReviewGatePhase;
      readonly witnessFrontierHash: string;
    }>
  | Readonly<{
      readonly kind: "REENTRY_CANDIDATE";
      readonly gateId: string;
      readonly generationId: string;
      readonly nc1StopEventId: string;
      readonly changeObservedEventId: string;
      readonly witnessFrontierHash: string;
    }>;

export type AdmissionDecision =
  | VerifiedAdmissionAuthorityDecisionV1
  | Readonly<{
      readonly kind: "RESUME";
      readonly gateId: string;
      readonly generationId: string;
      readonly witnessFrontierHash: string;
    }>
  | Readonly<{
      readonly kind: "STAY_SUSPENDED";
      readonly gateId: string;
      readonly generationId: string;
      readonly nc1StopEventId: string | null;
      readonly witnessFrontierHash: string;
    }>
  | Readonly<{
      readonly kind: "REUSE_COMPLETED";
      readonly gateId: string;
      readonly generationId: string;
      readonly approvalEventId: string;
      readonly verifiedHistoryFrontier: string;
    }>
  | Readonly<{
      readonly kind: "REVALIDATE_OR_BLOCK";
      readonly gateId: string;
      readonly generationId: string;
      readonly dimension: RevalidateDimension;
      readonly reason: string;
      readonly predecessorProofRefs: ReadonlyArray<string>;
      readonly witnessFrontierHash: string;
    }>
  | Readonly<{
      readonly kind: "BLOCK";
      readonly reason: AdmissionBlockReason;
      readonly detail: string;
    }>;

// ---------------------------------------------------------------------------
// Planner implementation
// ---------------------------------------------------------------------------

type MaterialRequirementsIdentity = Readonly<{
  readonly source: string;
  readonly workspaceIdentity: string;
  readonly canonicalPath: string;
  readonly digest: string;
  readonly gitMode: "100644" | "100755";
  readonly gitBlobOid: string;
}>;

type MaterialContext = Readonly<{
  readonly requirements: MaterialRequirementsIdentity;
  readonly design: ReviewArtifactBinding;
  readonly plan: ReviewArtifactBinding;
  readonly globalProtocolFingerprint: string;
  readonly designProtocolFingerprint: string;
  readonly planProtocolFingerprint: string;
}>;

function materialRequirementsFromBinding(
  binding: VerifiedRequirementsBinding,
): MaterialRequirementsIdentity {
  return {
    source: binding.source,
    workspaceIdentity: binding.workspaceIdentity,
    canonicalPath: binding.canonicalPath,
    digest: binding.digest,
    gitMode: binding.gitMode,
    gitBlobOid: binding.gitBlobOid,
  };
}

function materialRequirementsFromCandidate(
  candidate: VerifiedObservedRequirementsCandidate,
): MaterialRequirementsIdentity {
  return {
    source: candidate.source,
    workspaceIdentity: candidate.workspaceIdentity,
    canonicalPath: candidate.canonicalPath,
    digest: candidate.digest,
    gitMode: candidate.gitMode,
    gitBlobOid: candidate.gitBlobOid,
  };
}

function materialContextFromBinding(context: VerifiedGateContextBinding): MaterialContext {
  return {
    requirements: materialRequirementsFromBinding(context.requirements),
    design: context.design,
    plan: context.plan,
    globalProtocolFingerprint: context.globalProtocolFingerprint,
    designProtocolFingerprint: context.designProtocolFingerprint,
    planProtocolFingerprint: context.planProtocolFingerprint,
  };
}

function materialContextFromCurrent(
  current: VerifiedAdmissionSnapshot["current"],
): MaterialContext {
  return {
    requirements: materialRequirementsFromCandidate(current.requirements),
    design: current.design,
    plan: current.plan,
    globalProtocolFingerprint: current.globalProtocolFingerprint,
    designProtocolFingerprint: current.designProtocolFingerprint,
    planProtocolFingerprint: current.planProtocolFingerprint,
  };
}

function completedContextMaterial(
  approval: VerifiedCompletedBindingSnapshot,
    ): Readonly<Pick<MaterialContext, "requirements" | "design" | "plan" | "globalProtocolFingerprint">> {
  return {
    requirements: materialRequirementsFromBinding(approval.currentRequirements),
    design: approval.design,
    plan: approval.plan,
    globalProtocolFingerprint: approval.globalProtocolFingerprint,
  };
}

function contextDigest(context: MaterialContext): string {
  return computeCanonicalJsonFingerprint(context);
}

export function computeVerifiedContextDigest(context: VerifiedGateContextBinding): string {
  return computeCanonicalJsonFingerprint(materialContextFromBinding(context));
}

function sameRequirementsMaterial(
  left: MaterialRequirementsIdentity,
  right: MaterialRequirementsIdentity,
): boolean {
  return (
    left.source === right.source &&
    left.workspaceIdentity === right.workspaceIdentity &&
    left.canonicalPath === right.canonicalPath &&
    left.digest === right.digest &&
    left.gitMode === right.gitMode &&
    left.gitBlobOid === right.gitBlobOid
  );
}

function sameArtifactBinding(
  left: ReviewArtifactBinding,
  right: ReviewArtifactBinding,
): boolean {
  return (
    left.canonicalPath === right.canonicalPath &&
    left.digest === right.digest &&
    left.gitMode === right.gitMode
  );
}

function compareContextMaterial(
  left: MaterialContext,
  right: MaterialContext,
): RevalidateDimension | null {
  if (!sameRequirementsMaterial(left.requirements, right.requirements)) {
    return "requirements";
  }
  if (!sameArtifactBinding(left.design, right.design)) {
    return "design";
  }
  if (!sameArtifactBinding(left.plan, right.plan)) {
    return "plan";
  }
  if (left.globalProtocolFingerprint !== right.globalProtocolFingerprint) {
    return "global_protocol";
  }
  if (left.designProtocolFingerprint !== right.designProtocolFingerprint) {
    return "design_protocol";
  }
  if (left.planProtocolFingerprint !== right.planProtocolFingerprint) {
    return "plan_protocol";
  }
  return null;
}

function block(reason: AdmissionBlockReason, detail: string): AdmissionDecision {
  return Object.freeze({ kind: "BLOCK", reason, detail });
}

function isUnfinishedTip(tip: VerifiedGateTip): tip is Extract<VerifiedGateTip, { status: "active" | "suspended" }> {
  return tip.status === "active" || tip.status === "suspended";
}

function isCompletedTip(tip: VerifiedGateTip): tip is Extract<VerifiedGateTip, { status: "completed" }> {
  return tip.status === "completed";
}


function findCompletedTip(
  tips: ReadonlyArray<VerifiedGateTip>,
  scopeId: string,
  gateId: string,
): Extract<VerifiedGateTip, { status: "completed" }> | undefined {
  const tip = tips.find((t) => t.scopeId === scopeId && t.gateId === gateId);
  return tip && isCompletedTip(tip) ? tip : undefined;
}

function hasRelatedUnfinishedScope(continuity: VerifiedWorkspaceContinuityV1): boolean {
  return continuity.relatedScopeTips.some((tip) => isUnfinishedTip(tip));
}

function continuityCheck(
  input: VerifiedAdmissionSnapshot,
): AdmissionDecision | null {
  const continuity = input.workspaceContinuity;
  if (continuity.workspaceIdentity !== input.workspaceIdentity) {
    return block("workspace_identity_mismatch", "Workspace identity in continuity proof does not match the requested scope.");
  }
  if (continuity.coverage !== "COMPLETE") {
    return block(
      continuity.coverage === "AMBIGUOUS" ? "workspace_continuity_ambiguous" : "workspace_continuity_incomplete",
      `Workspace continuity coverage is ${continuity.coverage}.`,
    );
  }
  if (continuity.relatedGateHistoryFrontierHash !== input.verifiedFrontierHash) {
    return block("frontier_mismatch", "Workspace continuity frontier does not match the verified admission frontier.");
  }
  if (hasRelatedUnfinishedScope(continuity)) {
    return block("related_unfinished_scope", "A related scope has an unfinished Gate tip.");
  }
  return null;
}

function validatePrecedence(
  input: VerifiedAdmissionSnapshot,
  tip: Extract<VerifiedGateTip, { status: "active" | "suspended" }>,
): AdmissionDecision | null {
  const precedence = input.precedence;
  if (precedence === null) {
    return block("admission_precedence_unverified", "Missing admission precedence proof for an unfinished Gate.");
  }
  if (precedence.gateId !== tip.gateId || precedence.generationId !== tip.generationId) {
    return block("admission_precedence_unverified", "Admission precedence proof identifies a different Gate or generation.");
  }
  if (precedence.witnessFrontierHash !== input.verifiedFrontierHash) {
    return block("admission_precedence_frontier_mismatch", "Admission precedence frontier does not match the verified admission frontier.");
  }
  if (precedence.relationCompleteness === "INDETERMINATE") {
    return block("admission_precedence_indeterminate", "Lineage relation completeness is indeterminate.");
  }
  return null;
}

function evaluateNc1Candidate(
  input: VerifiedAdmissionSnapshot,
  tip: Extract<VerifiedGateTip, { status: "active" | "suspended" }>,
  stop: VerifiedNC1StopV1,
): AdmissionDecision {
  const candidate = input.nc1Candidate;
  if (candidate === null) {
    return block("nc1_candidate_invalid", "NC1 observation claims a candidate but none was supplied.");
  }
  if (
    candidate.gateId !== tip.gateId ||
    candidate.generationId !== tip.generationId ||
    candidate.phase !== stop.phase ||
    candidate.nc1StopEventId !== stop.stopEventId ||
    candidate.witnessFrontierAtObservation !== input.verifiedFrontierHash
  ) {
    return block("nc1_candidate_mismatch", "NC1 candidate does not match the suspended Gate or stop event.");
  }
  if (candidate.beforeContextDigest !== stop.stoppedContextDigest) {
    return block("nc1_candidate_mismatch", "NC1 candidate before-context does not match the verified stop context.");
  }

  const currentDigest = contextDigest(materialContextFromCurrent(input.current));
  if (candidate.afterContextDigest !== currentDigest) {
    return block("nc1_candidate_mismatch", "NC1 candidate after-context does not match the current observed context.");
  }

  if (candidate.kind === "protocol") {
    if (
      stop.protocolRelease.historicalReleaseId === null ||
      candidate.beforeReleaseId !== stop.protocolRelease.historicalReleaseId
    ) {
      return block(
        "protocol_release_authority_unverified",
        "Protocol-only NC1 candidate lacks a matching verified historical release authority.",
      );
    }
  }

  return Object.freeze({
    kind: "REENTRY_CANDIDATE",
    gateId: tip.gateId,
    generationId: tip.generationId,
    nc1StopEventId: stop.stopEventId,
    changeObservedEventId: candidate.changeObservedEventId,
    witnessFrontierHash: input.verifiedFrontierHash,
  });
}

function evaluateExistingUnfinishedTip(
  input: VerifiedAdmissionSnapshot,
  tip: Extract<VerifiedGateTip, { status: "active" | "suspended" }>,
): AdmissionDecision {
  const binding = tip.lastVerifiedBinding;
  if (!binding.admission || !binding.effective) {
    return block(
      "unfinished_binding_missing_or_corrupt",
      "Unfinished Gate tip lacks a verified admission or effective binding.",
    );
  }

  const precedenceError = validatePrecedence(input, tip);
  if (precedenceError !== null) {
    return precedenceError;
  }

  const precedence = input.precedence!;
  if (precedence.currentUpstreamBlockers.length > 0) {
    return Object.freeze({
      kind: "UPSTREAM_PRECEDENCE_REQUIRED",
      gateId: tip.gateId,
      generationId: tip.generationId,
      witnessFrontierHash: input.verifiedFrontierHash,
      blockers: precedence.currentUpstreamBlockers,
    });
  }
  if (precedence.pendingStaleLineages.length > 0) {
    return Object.freeze({
      kind: "STALE_LINEAGE_REVALIDATION_REQUIRED",
      gateId: tip.gateId,
      generationId: tip.generationId,
      witnessFrontierHash: input.verifiedFrontierHash,
      pending: precedence.pendingStaleLineages,
    });
  }

  if (tip.status === "suspended" && tip.suspensionReason === "review_non_convergent") {
    const stop = tip.nc1Stop;
    if (stop === null) {
      return block(
        "unfinished_binding_missing_or_corrupt",
        "NC1 suspended tip lacks a verified stop record.",
      );
    }
    if (input.nc1Observation === "NOT_INSPECTED") {
      return Object.freeze({
        kind: "INSPECT_NC1_ELIGIBLE_CHANGE",
        gateId: tip.gateId,
        generationId: tip.generationId,
        nc1StopEventId: stop.stopEventId,
        phase: stop.phase,
        witnessFrontierHash: input.verifiedFrontierHash,
      });
    }
    if (input.nc1Observation === "VERIFIED_NONE") {
      return Object.freeze({
        kind: "STAY_SUSPENDED",
        gateId: tip.gateId,
        generationId: tip.generationId,
        nc1StopEventId: stop.stopEventId,
        witnessFrontierHash: input.verifiedFrontierHash,
      });
    }
    return evaluateNc1Candidate(input, tip, stop);
  }

  const effectiveDigest = contextDigest(materialContextFromBinding(binding.effective.context));
  const currentDigest = contextDigest(materialContextFromCurrent(input.current));
  if (effectiveDigest !== currentDigest) {
    const dimension = compareContextMaterial(
      materialContextFromBinding(binding.effective.context),
      materialContextFromCurrent(input.current),
    );
    return Object.freeze({
      kind: "REVALIDATE_OR_BLOCK",
      gateId: tip.gateId,
      generationId: tip.generationId,
      dimension: dimension ?? "requirements",
      reason: "Effective binding material identity differs from the current observed context.",
      predecessorProofRefs: [binding.admission.gateCreatedEventId, binding.effective.authorityEventId],
      witnessFrontierHash: input.verifiedFrontierHash,
    });
  }

  if (tip.status === "suspended" && tip.suspensionReason !== "execution_suspended") {
    return Object.freeze({
      kind: "STAY_SUSPENDED",
      gateId: tip.gateId,
      generationId: tip.generationId,
      nc1StopEventId: tip.nc1Stop?.stopEventId ?? null,
      witnessFrontierHash: input.verifiedFrontierHash,
    });
  }

  // ACTIVE or ordinary SUSPENDED with exact binding: resume.
  return Object.freeze({
    kind: "RESUME",
    gateId: tip.gateId,
    generationId: tip.generationId,
    witnessFrontierHash: input.verifiedFrontierHash,
  });
}

function evaluateExistingCompletedTip(
  input: VerifiedAdmissionSnapshot,
  tip: Extract<VerifiedGateTip, { status: "completed" }>,
): AdmissionDecision {
  const approval = tip.completedApproval;
  const completedContext = completedContextMaterial(approval);
  const currentContext = materialContextFromCurrent(input.current);

  if (
    completedContext.requirements.source !== currentContext.requirements.source ||
    completedContext.requirements.workspaceIdentity !== currentContext.requirements.workspaceIdentity ||
    completedContext.requirements.canonicalPath !== currentContext.requirements.canonicalPath ||
    completedContext.requirements.digest !== currentContext.requirements.digest ||
    completedContext.requirements.gitMode !== currentContext.requirements.gitMode ||
    completedContext.requirements.gitBlobOid !== currentContext.requirements.gitBlobOid ||
    !sameArtifactBinding(completedContext.design, currentContext.design) ||
    !sameArtifactBinding(completedContext.plan, currentContext.plan) ||
    completedContext.globalProtocolFingerprint !== currentContext.globalProtocolFingerprint
  ) {
    return Object.freeze({
      kind: "CREATE_SUCCESSOR",
      scopeId: input.scopeId,
      predecessorScopeId: tip.scopeId,
      predecessorGateId: tip.gateId,
      predecessorApprovalEventId: approval.approvalEventId,
      predecessorRelationProofDigest: input.workspaceContinuity.relationClosureProofDigest,
      verifiedWorkspaceFrontierHash: input.verifiedFrontierHash,
    });
  }

  return Object.freeze({
    kind: "REUSE_COMPLETED",
    gateId: tip.gateId,
    generationId: tip.generationId,
    approvalEventId: approval.approvalEventId,
    verifiedHistoryFrontier: approval.verifiedHistoryFrontier,
  });
}

function evaluateNewScopeAdmission(input: VerifiedAdmissionSnapshot): AdmissionDecision {
  const continuity = input.workspaceContinuity;
  const predecessor = continuity.verifiedCrossScopePredecessor;
  if (predecessor !== null) {
    const matched = findCompletedTip(
      input.currentTips,
      predecessor.priorScopeId,
      predecessor.priorGateId,
    );
    if (
      matched === undefined ||
      matched.completedApproval.approvalEventId !== predecessor.completedApprovalEventId
    ) {
      return block(
        "successor_predecessor_missing",
        "Verified cross-scope predecessor does not match a completed Gate tip.",
      );
    }
    return Object.freeze({
      kind: "CREATE_SUCCESSOR",
      scopeId: input.scopeId,
      predecessorScopeId: predecessor.priorScopeId,
      predecessorGateId: predecessor.priorGateId,
      predecessorApprovalEventId: predecessor.completedApprovalEventId,
      predecessorRelationProofDigest: predecessor.relationshipProofDigest,
      verifiedWorkspaceFrontierHash: input.verifiedFrontierHash,
    });
  }

  const firstEnrollment = continuity.authorizedFirstEnrollment;
  if (firstEnrollment === null) {
    return block("first_enrollment_unauthorized", "No authorized first-enrollment proof for a new scope.");
  }
  if (firstEnrollment.workspaceIdentity !== input.workspaceIdentity) {
    return block("workspace_identity_mismatch", "First-enrollment workspace identity does not match the requested scope.");
  }

  return Object.freeze({
    kind: "CREATE_GENESIS",
    workspaceIdentity: input.workspaceIdentity,
    scopeId: input.scopeId,
    installationId: continuity.installationId,
    enrollmentAuthorizationEventId: firstEnrollment.authorizationEventId,
    verifiedWorkspaceFrontierHash: input.verifiedFrontierHash,
    completeRelationClosureDigest: continuity.relationClosureProofDigest,
  });
}

export function planReviewGateAdmission(input: VerifiedAdmissionSnapshot): AdmissionDecision {
  const continuityError = continuityCheck(input);
  if (continuityError !== null) {
    return continuityError;
  }

  const ownTips = input.currentTips.filter((tip) => tip.scopeId === input.scopeId);
  if (ownTips.length > 1) {
    return block("conflicting_current_tips", "Multiple current tips exist for the same scope.");
  }
  const ownTip = ownTips[0];

  if (ownTip === undefined) {
    return evaluateNewScopeAdmission(input);
  }

  if (isCompletedTip(ownTip)) {
    return evaluateExistingCompletedTip(input, ownTip);
  }

  return evaluateExistingUnfinishedTip(input, ownTip);
}
