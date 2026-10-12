/**
 * Pure event-sourced Review Gate orchestrator (convergence Task 11).
 *
 * `planReviewGateNextOperation` derives exactly one next operation from the
 * projected gate state plus coordinator-observed planning context. It emits
 * decisions only: no filesystem, no Git, no model calls, no clock reads, and
 * no randomness — every identity a coordinator must mint (operation ids,
 * review attempt ids, approval timestamps) stays on the coordinator side and
 * is echoed back through the context when a crashed dispatch must repeat.
 *
 * Planning precedence (first match wins, exactly one operation returned):
 *
 * 1. Terminal — a completed projection returns `completed`.
 * 2. Crash windows — `context.inFlight` represents a durably observed intent
 *    whose completion is not yet durable (restart recovery). Recovery wins
 *    over every other routing so an interrupted side effect is resolved
 *    exactly once before new work is planned.
 * 3. Suspended gates route the ordinary orchestrator first when a durably
 *    verified CURRENT upstream blocker (Task 14 verified upstream reopen
 *    context) exists — except a `reopen_required` suspension, whose reopen is
 *    already durable — then a `review_non_convergent` suspension with observed
 *    material progress routes to `validate_non_convergence_reentry`, and the
 *    rest map to `suspended` (with the shared `deriveResumeCursor` mapping).
 * 4. Coordinator-committed chain steps (review observed, remediation
 *    completed, self-review passed, commit completed, resolutions committed)
 *    take precedence over projection-derived routing so already-committed
 *    progress is never re-driven.
 * 5. Remaining active gates route through `deriveResumeCursor` with the
 *    current-phase disposition seam: OSC1 upstream precedence (restore a
 *    dirty Design target first, then reopen), pending lineage revalidation,
 *    then the NC1/round-limit/remediation truth table from the convergence
 *    engine, and finally a clean-phase review/pre-clear path.
 *
 * Contract violations throw before any operation is produced, mirroring the
 * other pure review-gate modules: the caller never observes a partial or
 * ambiguous decision.
 */

import type {
  CurrentPhaseDisposition,
  FindingState,
  LineageId,
  RemediationRound,
  ReviewApprovalBindingV1,
  ReviewArtifactBinding,
  ReviewGatePhase,
  ReviewGateProjection,
  ReviewGateResumeCursor,
  ReviewGateSuspensionReason,
  ReviewNonConvergentPayload,
  ReviewTargetWorkspaceState,
} from "./types.js";
import { deriveResumeCursor } from "./resume-cursor.js";
import {
  decideCurrentPhaseRemediationDisposition,
  evaluateNonConvergence,
} from "./convergence.js";
import type { ValidatedFinding, ValidatedFindingBatch } from "./lineage.js";
import type { ReviewCandidateObservationV1 } from "./agent-protocol.js";
import {
  bridgeDeterministicFindings,
  scheduleMandatoryValidations,
  type DeterministicValidationState,
  type DeterministicValidatorRegistry,
  type MandatoryValidationDispatch,
  type MandatoryValidationSchedule,
  type ValidationEvidence,
} from "./deterministic-validation.js";
import type {
  ReviewRestoreDestinationBinding,
  ReviewRestoreSourceBinding,
} from "./capabilities.js";

// ---------------------------------------------------------------------------
// Planning context
// ---------------------------------------------------------------------------

/** Phase artifact bindings pinned by the durable GATE_CREATED event. */
export type ReviewGatePlanningArtifacts = Readonly<{
  readonly design: ReviewArtifactBinding;
  readonly plan: ReviewArtifactBinding;
}>;

/**
 * Coordinator-observed external operation that was dispatched but whose
 * completion is not yet durable. Re-planning re-emits the identical logical
 * dispatch (same `operationId`) so the crashed attempt continues exactly once.
 */
export type ReviewGateInFlightIntent =
  | Readonly<{
      readonly kind: "external_operation_dispatched";
      readonly operation:
        | "reviewer"
        | "finding_validator"
        | "lineage_revalidation"
        | "self_review"
        | "non_convergence_reentry";
      readonly phase: ReviewGatePhase;
      readonly operationId: string;
      readonly candidate?: ReviewCandidateObservationV1;
      readonly lineageId?: LineageId;
      readonly round?: RemediationRound;
      readonly lineageIds?: ReadonlyArray<LineageId>;
    }>
  | Readonly<{
      readonly kind: "remediation_started";
      readonly phase: ReviewGatePhase;
      readonly round: RemediationRound;
      readonly lineageIds: ReadonlyArray<LineageId>;
      /** Whether the current worktree still equals the durable pre-image. */
      readonly worktreeMatchesPreImage: boolean;
    }>
  | Readonly<{ readonly kind: "restore_prepared"; readonly targetPath: string }>
  | Readonly<{
      readonly kind: "commit_prepared";
      readonly phase: ReviewGatePhase;
      readonly artifactPath: string;
    }>
  | Readonly<{
      readonly kind: "resolutions_pending";
      readonly lineageIds: ReadonlyArray<LineageId>;
    }>
  | Readonly<{ readonly kind: "fresh_review_pending"; readonly phase: ReviewGatePhase }>;

/** Fresh-reviewer candidates observed from a completed reviewer dispatch. */
export type ReviewGateReviewObservation = Readonly<{
  readonly phase: ReviewGatePhase;
  readonly candidates: ReadonlyArray<ReviewCandidateObservationV1>;
}>;

/** One finding-validator result bound to its originating candidate. */
export type ReviewGateFindingValidationOutcome = Readonly<{
  readonly candidate: ReviewCandidateObservationV1;
  readonly validated: ValidatedFinding;
}>;

/** Completion evidence of one remediation round (post-image established). */
export type ReviewGateRemediationCompletion = Readonly<{
  readonly round: RemediationRound;
  readonly lineageIds: ReadonlyArray<LineageId>;
}>;

/** Self-review passed for one remediation round; the commit is pending. */
export type ReviewGateSelfReviewCompletion = Readonly<{
  readonly round: RemediationRound;
  readonly lineageIds: ReadonlyArray<LineageId>;
}>;

/** Exact-artifact commit completed; lineage resolution commits are pending. */
export type ReviewGateCommitCompletion = Readonly<{
  readonly phase: ReviewGatePhase;
  readonly artifactPath: string;
}>;

/** Lineage resolution commits landed; a fresh review is pending. */
export type ReviewGateResolutionCompletion = Readonly<{
  readonly lineageIds: ReadonlyArray<LineageId>;
}>;

/** Scheduling inputs for the mandatory deterministic PRE_CLEAR validations. */
export type ReviewGatePreClearValidationInputs = Readonly<{
  readonly registry: DeterministicValidatorRegistry;
  readonly state: DeterministicValidationState;
  readonly dispatches: readonly MandatoryValidationDispatch[];
}>;

/** Executed PRE_CLEAR evidence awaiting the DVF1 finding bridge. */
export type ReviewGatePreClearValidationOutcome = Readonly<{
  readonly validationEventId: string;
  readonly registry: DeterministicValidatorRegistry;
  readonly evidences: readonly ValidationEvidence[];
}>;

/**
 * Exact restore provenance bound into `prepare_restore` / `recover_restore`
 * decisions (Task 14). Every field comes from the durably verified upstream
 * reopen context, never from a guess.
 */
export type ReviewGateUpstreamRestoreProof = Readonly<{
  readonly upstreamFindingEventId: string;
  readonly currentLineageId: string;
  readonly restoreOperationId: string;
  readonly sourceBindingDigest: string;
  readonly destinationBindingDigest: string;
  readonly verifiedFrontierHash: string;
}>;

/**
 * Verified Task 9/11 + exact Task 10 Git-intent context the Task 18 runtime
 * coordinator projects for an ordinary ACTIVE/SUSPENDED upstream defect
 * (PLAN-012 authoritative separation). This is never an NC1 reentry input and
 * never carries NC1 evidence.
 */
export type VerifiedUpstreamReopenContextV1 = Readonly<{
  readonly gateId: string;
  readonly generationId: string;
  readonly currentPhase: ReviewGatePhase;
  readonly upstreamBlocker: Readonly<{
    readonly lineageId: string;
    readonly findingEventId: string;
    readonly currentOwner: "requirements" | "design";
    readonly committedAuthorityEventId: string;
  }>;
  readonly downstream: Readonly<{
    readonly phase: ReviewGatePhase;
    readonly targetPath: string;
    readonly knownDirtyPostImage: ReviewRestoreSourceBinding;
    readonly approvedCleanOriginal: ReviewRestoreDestinationBinding;
    readonly originatingRoundEventId: string;
  }> | null;
  readonly restoreCompletion: Readonly<{
    readonly preparedEventId: string;
    readonly completionEventId: string;
    readonly restoreOperationId: string;
    readonly targetPath: string;
    readonly verifiedDestinationDigest: string;
  }> | null;
  readonly verifiedFrontierHash: string;
}>;
/**
 * Coordinator-observed planning context. `artifacts` is required (it comes
 * from the durable GATE_CREATED); every other field is optional evidence that
 * is present only while the corresponding step is in flight.
 */
export type ReviewGatePlanningContext = Readonly<{
  readonly artifacts: ReviewGatePlanningArtifacts;
  readonly inFlight?: ReviewGateInFlightIntent;
  readonly reviewObserved?: ReviewGateReviewObservation;
  readonly validatedFindings?: ReadonlyArray<ReviewGateFindingValidationOutcome>;
  readonly remediationCompleted?: ReviewGateRemediationCompletion;
  readonly selfReviewPassed?: ReviewGateSelfReviewCompletion;
  readonly commitCompleted?: ReviewGateCommitCompletion;
  readonly resolutionsCommitted?: ReviewGateResolutionCompletion;
  readonly materialProgressObserved?: boolean;
  readonly currentPhaseDisposition?: CurrentPhaseDisposition;
  /** Coordinator-observed workspace states overriding the WSP1 projection stub. */
  readonly workspaceStates?: ReadonlyMap<string, ReviewTargetWorkspaceState>;
  readonly preClearValidation?: ReviewGatePreClearValidationInputs;
  readonly preClearValidationObserved?: ReviewGatePreClearValidationOutcome;
  /** Design protocol fingerprint the coordinator will bind into DESIGN_CLEAR. */
  readonly designClearFingerprint?: string;
  /** Approval binding the coordinator will append with PLAN_CLEAR. */
  readonly preparedApprovalBinding?: ReviewApprovalBindingV1;
  /**
   * Task 18-owned verified upstream reopen context (PLAN-012). Its presence is
   * the only restore/reopen authority for ordinary upstream defects; `undefined`
   * is not permission to infer or manufacture an upstream reopen.
   */
  readonly verifiedUpstreamReopen?: VerifiedUpstreamReopenContextV1;
}>;

// ---------------------------------------------------------------------------
// Next-operation vocabulary
// ---------------------------------------------------------------------------

export type ReviewGateNextOperation =
  | Readonly<{
      readonly kind: "dispatch_reviewer";
      readonly phase: ReviewGatePhase;
      readonly redispatchedOperationId?: string;
    }>
  | Readonly<{
      readonly kind: "dispatch_finding_validator";
      readonly phase: ReviewGatePhase;
      readonly candidate: ReviewCandidateObservationV1;
      readonly redispatchedOperationId?: string;
    }>
  | Readonly<{
      readonly kind: "commit_finding_reconciliation";
      readonly batch: ValidatedFindingBatch;
    }>
  | Readonly<{
      readonly kind: "dispatch_lineage_revalidation";
      readonly lineageId: LineageId;
      readonly redispatchedOperationId?: string;
    }>
  | Readonly<{
      readonly kind: "start_remediation";
      readonly phase: ReviewGatePhase;
      readonly round: RemediationRound;
      readonly lineageIds: ReadonlyArray<LineageId>;
    }>
  | Readonly<{
      readonly kind: "recover_remediation";
      readonly phase: ReviewGatePhase;
      readonly round: RemediationRound;
      readonly lineageIds: ReadonlyArray<LineageId>;
    }>
  | Readonly<{
      readonly kind: "dispatch_self_review";
      readonly phase: ReviewGatePhase;
      readonly round: RemediationRound;
      readonly lineageIds: ReadonlyArray<LineageId>;
      readonly redispatchedOperationId?: string;
    }>
  | Readonly<{
      readonly kind: "prepare_restore";
      readonly targetPath: string;
      readonly restoreTo: ReviewArtifactBinding;
      readonly restoreProof: ReviewGateUpstreamRestoreProof;
    }>
  | Readonly<{
      readonly kind: "recover_restore";
      readonly targetPath: string;
      readonly restoreTo: ReviewArtifactBinding;
      readonly restoreProof: ReviewGateUpstreamRestoreProof;
    }>
  | Readonly<{
      readonly kind: "prepare_commit";
      readonly phase: ReviewGatePhase;
      readonly artifactPath: string;
    }>
  | Readonly<{
      readonly kind: "recover_commit";
      readonly phase: ReviewGatePhase;
      readonly artifactPath: string;
    }>
  | Readonly<{
      readonly kind: "commit_resolutions";
      readonly lineageIds: ReadonlyArray<LineageId>;
    }>
  | Readonly<{
      readonly kind: "append_reopen";
      readonly phase: ReviewGatePhase;
      readonly lineageIds: ReadonlyArray<LineageId>;
      /** Task 10 witnessed completion event bound to this blocker, or null. */
      readonly verifiedRestoreCompletionEventId: string | null;
    }>
  | Readonly<{
      readonly kind: "run_pre_clear_validation";
      readonly phase: ReviewGatePhase;
      readonly schedule: MandatoryValidationSchedule;
    }>
  | Readonly<{
      readonly kind: "append_design_clear";
      readonly designProtocolFingerprint: string;
    }>
  | Readonly<{
      readonly kind: "append_plan_clear";
      readonly approvalBinding: ReviewApprovalBindingV1;
    }>
  | Readonly<{
      readonly kind: "validate_non_convergence_reentry";
      readonly phase: ReviewGatePhase;
      readonly redispatchedOperationId?: string;
    }>
  | Readonly<{
      readonly kind: "suspended";
      readonly reason: ReviewGateSuspensionReason;
      readonly resumeCursor?: ReviewGateResumeCursor;
      readonly nonConvergent?: ReviewNonConvergentPayload;
      readonly detail?: string;
    }>
  | Readonly<{
      readonly kind: "completed";
      readonly approvalBinding: ReviewApprovalBindingV1;
    }>;

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export function planReviewGateNextOperation(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
): ReviewGateNextOperation {
  if (projection.status === "completed") {
    const approvalBinding = projection.approvalBinding;
    if (approvalBinding === null) {
      throw new Error("review_gate_orchestrator_completed_without_binding");
    }
    return freezeOperation({ kind: "completed", approvalBinding });
  }

  if (context.inFlight !== undefined) {
    return planInFlightRecovery(projection, context, context.inFlight);
  }

  if (projection.status === "suspended") {
    // PLAN-012 OSC1 precedence: an ordinary suspension with a verified CURRENT
    // upstream blocker routes through the ordinary orchestrator before the
    // generic suspended/NC1 selection. A `reopen_required` suspension already
    // carries the durable reopen for the current upstream landscape — re-facing
    // it with append_reopen would duplicate the durable reopen — so its generic
    // mapping stands.
    if (
      projection.suspensionReason !== "reopen_required" &&
      context.verifiedUpstreamReopen !== undefined &&
      projection.currentUpstreamBlockers.length > 0
    ) {
      return planUpstreamReopen(projection, context, projection.currentUpstreamBlockers);
    }
    if (
      projection.suspensionReason === "review_non_convergent" &&
      context.materialProgressObserved === true
    ) {
      return freezeOperation({
        kind: "validate_non_convergence_reentry",
        phase: projection.phase,
      });
    }
    return freezeOperation({
      kind: "suspended",
      reason: requireSuspensionReason(projection),
      resumeCursor: deriveResumeCursor(projection),
    });
  }

  const chainStep = planChainStep(projection, context);
  if (chainStep !== null) {
    return chainStep;
  }

  return planFromCursor(projection, context);
}

// ---------------------------------------------------------------------------
// Crash-window recovery
// ---------------------------------------------------------------------------

function planInFlightRecovery(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
  intent: ReviewGateInFlightIntent,
): ReviewGateNextOperation {
  switch (intent.kind) {
    case "remediation_started":
      requirePhaseMatch(projection, intent.phase, "remediation_started");
      if (intent.worktreeMatchesPreImage) {
        return freezeOperation({
          kind: "recover_remediation",
          phase: intent.phase,
          round: intent.round,
          lineageIds: intent.lineageIds,
        });
      }
      // Unknown partial mutation: never overwrite, restore, or chmod a target
      // whose worktree binding drifted from the durable pre-image.
      return freezeOperation({
        kind: "suspended",
        reason: "execution_suspended",
        detail: "remediation_recovery_conflict",
      });
    case "restore_prepared":
      return planRestoreRecovery(projection, context, intent);
    case "commit_prepared":
      requirePhaseMatch(projection, intent.phase, "commit_prepared");
      requirePhaseArtifact(context, intent.phase, intent.artifactPath);
      return freezeOperation({
        kind: "recover_commit",
        phase: intent.phase,
        artifactPath: intent.artifactPath,
      });
    case "resolutions_pending":
      return freezeOperation({
        kind: "commit_resolutions",
        lineageIds: intent.lineageIds,
      });
    case "fresh_review_pending":
      return freezeOperation({ kind: "dispatch_reviewer", phase: intent.phase });
    case "external_operation_dispatched":
      return redispatchExternalOperation(intent);
  }
}

function redispatchExternalOperation(
  intent: Extract<ReviewGateInFlightIntent, { readonly kind: "external_operation_dispatched" }>,
): ReviewGateNextOperation {
  switch (intent.operation) {
    case "reviewer":
      return freezeOperation({
        kind: "dispatch_reviewer",
        phase: intent.phase,
        redispatchedOperationId: intent.operationId,
      });
    case "finding_validator":
      if (intent.candidate === undefined) {
        throw new Error("review_gate_orchestrator_redispatch_candidate_required");
      }
      return freezeOperation({
        kind: "dispatch_finding_validator",
        phase: intent.phase,
        candidate: intent.candidate,
        redispatchedOperationId: intent.operationId,
      });
    case "lineage_revalidation":
      if (intent.lineageId === undefined) {
        throw new Error("review_gate_orchestrator_redispatch_lineage_required");
      }
      return freezeOperation({
        kind: "dispatch_lineage_revalidation",
        lineageId: intent.lineageId,
        redispatchedOperationId: intent.operationId,
      });
    case "self_review":
      if (intent.round === undefined || intent.lineageIds === undefined) {
        throw new Error("review_gate_orchestrator_redispatch_round_required");
      }
      return freezeOperation({
        kind: "dispatch_self_review",
        phase: intent.phase,
        round: intent.round,
        lineageIds: intent.lineageIds,
        redispatchedOperationId: intent.operationId,
      });
    case "non_convergence_reentry":
      return freezeOperation({
        kind: "validate_non_convergence_reentry",
        phase: intent.phase,
        redispatchedOperationId: intent.operationId,
      });
  }
}

/**
 * Recover a durably prepared restore. Recovery is bound to the exact verified
 * provenance — blocker lineage, source/destination bindings, operation id and
 * pinned frontier. Without verified upstream reopen provenance Core cannot
 * bind the recovery and never guesses a target.
 */
function planRestoreRecovery(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
  intent: Extract<ReviewGateInFlightIntent, { readonly kind: "restore_prepared" }>,
): ReviewGateNextOperation {
  const verified = context.verifiedUpstreamReopen;
  if (verified === undefined) {
    return freezeOperation({
      kind: "suspended",
      reason: "execution_suspended",
      detail: "restore_recovery_provenance_missing",
    });
  }
  const blocker = verified.upstreamBlocker;
  const phaseArtifact =
    projection.phase === "design" ? context.artifacts.design : context.artifacts.plan;
  const provenanceInvalid =
    verified.gateId !== projection.gateId ||
    verified.currentPhase !== projection.phase ||
    verified.verifiedFrontierHash.length === 0 ||
    blocker.lineageId.length === 0 ||
    blocker.findingEventId.length === 0 ||
    blocker.committedAuthorityEventId.length === 0 ||
    !projection.currentUpstreamBlockers.some((id) => id === blocker.lineageId) ||
    verified.restoreCompletion !== null ||
    verified.downstream === null ||
    verified.downstream.targetPath !== intent.targetPath ||
    intent.targetPath !== phaseArtifact.canonicalPath;
  if (provenanceInvalid) {
    return freezeOperation({
      kind: "suspended",
      reason: "execution_suspended",
      detail: "restore_recovery_provenance_missing",
    });
  }
  const provenanceProblem = validateDownstreamProvenance(phaseArtifact, verified.downstream);
  if (provenanceProblem !== null) {
    return freezeOperation({
      kind: "suspended",
      reason: "execution_suspended",
      detail: provenanceProblem,
    });
  }
  return freezeOperation({
    kind: "recover_restore",
    targetPath: intent.targetPath,
    restoreTo: phaseArtifact,
    restoreProof: buildRestoreProof(verified),
  });
}

/**
 * Restore operation identity derived deterministically from the verified
 * context (`upstream-restore:` prefix) so re-planning is crash-idempotent.
 */
function upstreamRestoreOperationId(verified: VerifiedUpstreamReopenContextV1): string {
  if (verified.downstream === null) {
    throw new Error("review_gate_orchestrator_restore_operation_without_downstream");
  }
  return `upstream-restore:${verified.upstreamBlocker.lineageId}:${verified.downstream.targetPath}:${verified.verifiedFrontierHash}`;
}

function buildRestoreProof(
  verified: VerifiedUpstreamReopenContextV1,
): ReviewGateUpstreamRestoreProof {
  if (verified.downstream === null) {
    throw new Error("review_gate_orchestrator_restore_proof_without_downstream");
  }
  return Object.freeze({
    upstreamFindingEventId: verified.upstreamBlocker.findingEventId,
    currentLineageId: verified.upstreamBlocker.lineageId,
    restoreOperationId: upstreamRestoreOperationId(verified),
    sourceBindingDigest: verified.downstream.knownDirtyPostImage.worktree.digest,
    destinationBindingDigest: verified.downstream.approvedCleanOriginal.worktree.digest,
    verifiedFrontierHash: verified.verifiedFrontierHash,
  });
}

/**
 * Validate the Task 10 dirty-post-image provenance (P1 over the exact pinned
 * P0). Returns a block detail, or null when the provenance explains the dirty
 * state over the same pinned HEAD with unchanged HEAD/index/modes.
 */
function validateDownstreamProvenance(
  phaseArtifact: ReviewArtifactBinding,
  downstream: NonNullable<VerifiedUpstreamReopenContextV1["downstream"]>,
): string | null {
  if (
    downstream.targetPath.length === 0 ||
    downstream.originatingRoundEventId.length === 0
  ) {
    return "upstream_reopen_dirty_provenance_missing";
  }
  const source = downstream.knownDirtyPostImage;
  const destination = downstream.approvedCleanOriginal;

  // Destination: the exact pinned clean committed original.
  if (
    destination.headSha.length === 0 ||
    destination.headEntry.canonicalPath !== downstream.targetPath ||
    destination.indexEntry.canonicalPath !== downstream.targetPath ||
    destination.worktree.canonicalPath !== downstream.targetPath ||
    destination.worktree.digest !== phaseArtifact.digest ||
    destination.worktree.gitMode !== phaseArtifact.gitMode ||
    destination.headEntry.gitMode !== destination.worktree.gitMode
  ) {
    return "upstream_reopen_wrong_clean_original";
  }

  // Source: structurally complete dirty-post-image provenance.
  if (
    source.headSha.length === 0 ||
    source.headEntry.canonicalPath !== downstream.targetPath ||
    source.indexEntry.canonicalPath !== downstream.targetPath ||
    source.worktree.canonicalPath !== downstream.targetPath ||
    source.sourceEventId.length === 0
  ) {
    return "upstream_reopen_dirty_provenance_missing";
  }
  // Unexplained HEAD drift: the pinned original is no longer HEAD.
  if (
    source.headSha !== destination.headSha ||
    source.headEntry.blobSha !== destination.headEntry.blobSha
  ) {
    return "upstream_reopen_changed_head";
  }
  // Unexplained staged drift outside the explained dirty state.
  if (source.indexEntry.blobSha !== destination.indexEntry.blobSha) {
    return "upstream_reopen_changed_index";
  }
  // Unexplained mode drift on the restore channel.
  if (
    source.headEntry.gitMode !== destination.headEntry.gitMode ||
    source.indexEntry.gitMode !== destination.indexEntry.gitMode ||
    source.worktree.gitMode !== destination.worktree.gitMode
  ) {
    return "upstream_reopen_changed_mode";
  }
  // A "dirty" post-image equal to the clean original is a contradiction.
  if (source.worktree.digest === destination.worktree.digest) {
    return "upstream_reopen_unexplained_dirty_state";
  }
  return null;
}

/**
 * Validate a witnessed Task 10 restore completion against the pinned clean
 * original and (when present) the blocked dirty provenance. PREPARED alone
 * never reopens.
 */
function validateRestoreCompletion(
  phaseArtifact: ReviewArtifactBinding,
  downstream: VerifiedUpstreamReopenContextV1["downstream"],
  completion: VerifiedUpstreamReopenContextV1["restoreCompletion"],
): string | null {
  if (completion === null) {
    return null;
  }
  if (
    completion.preparedEventId.length === 0 ||
    completion.completionEventId.length === 0 ||
    completion.restoreOperationId.length === 0 ||
    completion.targetPath !== phaseArtifact.canonicalPath ||
    completion.verifiedDestinationDigest !== phaseArtifact.digest
  ) {
    return "upstream_reopen_forged_restore_completion";
  }
  if (
    downstream !== null &&
    (downstream.targetPath !== completion.targetPath ||
      downstream.approvedCleanOriginal.worktree.digest !==
        completion.verifiedDestinationDigest)
  ) {
    return "upstream_reopen_forged_restore_completion";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Coordinator-committed chain steps
// Coordinator-committed chain steps
// ---------------------------------------------------------------------------

function planChainStep(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
): ReviewGateNextOperation | null {
  const { commitCompleted } = context;
  if (commitCompleted !== undefined) {
    requirePhaseMatch(projection, commitCompleted.phase, "commit_completed");
    requirePhaseArtifact(context, commitCompleted.phase, commitCompleted.artifactPath);
    const lineageIds = selfReviewedLineageIds(projection);
    if (lineageIds.length === 0) {
      throw new Error("review_gate_orchestrator_no_resolutions_to_commit");
    }
    return freezeOperation({ kind: "commit_resolutions", lineageIds });
  }

  const { remediationCompleted } = context;
  if (remediationCompleted !== undefined) {
    requirePhaseMatch(projection, remediationCompleted.round.phase, "remediation_completed");
    return freezeOperation({
      kind: "dispatch_self_review",
      phase: remediationCompleted.round.phase,
      round: remediationCompleted.round,
      lineageIds: remediationCompleted.lineageIds,
    });
  }

  const { selfReviewPassed } = context;
  if (selfReviewPassed !== undefined) {
    requirePhaseMatch(projection, selfReviewPassed.round.phase, "self_review_passed");
    return freezeOperation({
      kind: "prepare_commit",
      phase: selfReviewPassed.round.phase,
      artifactPath: phaseArtifactPath(context, selfReviewPassed.round.phase),
    });
  }

  if (context.resolutionsCommitted !== undefined) {
    return freezeOperation({ kind: "dispatch_reviewer", phase: projection.phase });
  }

  const { reviewObserved } = context;
  if (reviewObserved !== undefined) {
    return planReviewObservationStep(projection, context, reviewObserved);
  }

  return null;
}

function planReviewObservationStep(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
  observation: ReviewGateReviewObservation,
): ReviewGateNextOperation {
  requirePhaseMatch(projection, observation.phase, "review_observed");

  if (observation.candidates.length === 0) {
    return planPreClear(projection, context);
  }

  const validated = context.validatedFindings ?? [];
  const validatedIds = new Set(validated.map((outcome) => outcome.candidate.candidateId));
  const pending = observation.candidates.find(
    (candidate) => !validatedIds.has(candidate.candidateId),
  );
  if (pending !== undefined) {
    return freezeOperation({
      kind: "dispatch_finding_validator",
      phase: projection.phase,
      candidate: pending,
    });
  }

  const batch: ValidatedFinding[] = validated.map((outcome) => outcome.validated);
  return freezeOperation({
    kind: "commit_finding_reconciliation",
    batch: Object.freeze({ findings: Object.freeze(batch) }),
  });
}

// ---------------------------------------------------------------------------
// Pre-clear deterministic validation and clear milestones
// ---------------------------------------------------------------------------

function planPreClear(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
): ReviewGateNextOperation {
  const observed = context.preClearValidationObserved;
  if (observed !== undefined) {
    if (observed.evidences.some((evidence) => evidence.stage !== "PRE_CLEAR")) {
      return freezeOperation({ kind: "suspended", reason: "execution_suspended" });
    }
    const bridged = bridgeDeterministicFindings({
      validationEventId: observed.validationEventId,
      evidences: observed.evidences,
      registry: observed.registry,
    });
    if (bridged.findings.length > 0) {
      // DVF1 findings join the ordinary blocker landscape: they are validated
      // like any reviewer finding and drive the normal disposition.
      const batch: ValidatedFinding[] = bridged.findings.map((observation) =>
        deterministicObservationToValidatedFinding(projection, observation),
      );
      return freezeOperation({
        kind: "commit_finding_reconciliation",
        batch: Object.freeze({ findings: Object.freeze(batch) }),
      });
    }
    if (
      observed.evidences.length === 0 ||
      observed.evidences.some(
        (evidence) => evidence.kind !== "semantic" || evidence.result !== "PASS",
      )
    ) {
      return freezeOperation({ kind: "suspended", reason: "execution_suspended" });
    }
    return appendClearOperation(projection, context);
  }

  const inputs = context.preClearValidation;
  if (inputs !== undefined) {
    const schedule = scheduleMandatoryValidations(inputs.registry, inputs.dispatches, inputs.state);
    return freezeOperation({
      kind: "run_pre_clear_validation",
      phase: projection.phase,
      schedule,
    });
  }

  throw new Error("review_gate_orchestrator_pre_clear_validation_context_required");
}

function deterministicObservationToValidatedFinding(
  projection: ReviewGateProjection,
  observation: ReturnType<typeof bridgeDeterministicFindings>["findings"][number],
): ValidatedFinding {
  return Object.freeze({
    candidateId: `${observation.validationEventId}/${observation.ruleId}`,
    existingLineageId: null,
    basisDigest: observation.detailDigest,
    ownerScope: observation.ownerScope,
    observedPhase: projection.phase,
    status: "new",
    severity: observation.severity === "minor" ? "minor" : "blocking",
    descriptionDigest: observation.detailDigest,
  });
}

function appendClearOperation(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
): ReviewGateNextOperation {
  if (projection.phase === "design") {
    const fingerprint = context.designClearFingerprint;
    if (fingerprint === undefined) {
      throw new Error("review_gate_orchestrator_design_clear_fingerprint_required");
    }
    return freezeOperation({ kind: "append_design_clear", designProtocolFingerprint: fingerprint });
  }
  const approvalBinding = context.preparedApprovalBinding;
  if (approvalBinding === undefined) {
    throw new Error("review_gate_orchestrator_approval_binding_required");
  }
  return freezeOperation({ kind: "append_plan_clear", approvalBinding });
}

// ---------------------------------------------------------------------------
// Projection-derived routing (OSC1 / revalidation / NC1 / clean phase)
// ---------------------------------------------------------------------------

function planFromCursor(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
): ReviewGateNextOperation {
  let disposition = context.currentPhaseDisposition;
  if (disposition === undefined && projection.currentRemediableBlockers.length > 0) {
    disposition = decideCurrentPhaseRemediationDisposition(
      projection,
      evaluateNonConvergence(projection),
    );
  }
  const cursor = deriveResumeCursor(projection, disposition);

  switch (cursor.kind) {
    case "completed":
      return freezeOperation({ kind: "completed", approvalBinding: requireApprovalBinding(projection) });
    case "resolve_upstream":
      return planUpstreamReopen(projection, context, cursor.lineageIds);
    case "revalidate": {
      const lineageId = cursor.lineageIds[0];
      if (lineageId === undefined) {
        throw new Error("review_gate_orchestrator_revalidation_lineage_missing");
      }
      return freezeOperation({ kind: "dispatch_lineage_revalidation", lineageId });
    }
    case "remediate":
      return freezeOperation({
        kind: "start_remediation",
        phase: projection.phase,
        round: nextRemediationRound(projection),
        lineageIds: cursor.lineageIds,
      });
    case "non_convergent":
      return freezeOperation({
        kind: "suspended",
        reason: "review_non_convergent",
        nonConvergent: cursor.payload,
        resumeCursor: Object.freeze({ kind: "await_material_progress" }),
      });
    case "round_limit_exhausted":
      return freezeOperation({
        kind: "suspended",
        reason: "round_limit_exhausted",
        resumeCursor: Object.freeze({ kind: "await_external_change" }),
      });
    case "resume_execution":
      return freezeOperation({
        kind: "suspended",
        reason: "execution_suspended",
        resumeCursor: cursor,
      });
    case "await_external_change":
      return freezeOperation({
        kind: "suspended",
        reason: "round_limit_exhausted",
        resumeCursor: cursor,
      });
    case "await_material_progress":
      return freezeOperation({
        kind: "suspended",
        reason: "review_non_convergent",
        resumeCursor: cursor,
      });
    case "await_upstream_commit":
      return freezeOperation({
        kind: "suspended",
        reason: "reopen_required",
        resumeCursor: cursor,
      });
    case "review":
      return freezeOperation({ kind: "dispatch_reviewer", phase: projection.phase });
  }
}

/**
 * Ordinary orchestrator upstream defect handling (OSC1, Task 14): restore the
 * dirty downstream target first (its `prepare_restore` decision is the phase
 * reopen state machine's RESTORE_DOWNSTREAM_FIRST), or append the upstream
 * reopen once the downstream target is clean or the exact Task 10 restore
 * completion is witnessed. Fail closed on every missing or disagreeing
 * provenance: the verified context is the only reopen authority.
 */
function planUpstreamReopen(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
  lineageIds: ReadonlyArray<LineageId>,
): ReviewGateNextOperation {
  const blockUpstreamReopen = (detail: string): ReviewGateNextOperation =>
    freezeOperation({
      kind: "suspended",
      reason: "execution_suspended",
      detail,
    });

  const verified = context.verifiedUpstreamReopen;
  if (verified === undefined) {
    // An undefined upstream context is not permission to infer or manufacture
    // an upstream reopen.
    return blockUpstreamReopen("upstream_reopen_context_missing");
  }
  // Gate/generation/phase/frontier agreement.
  if (verified.gateId !== projection.gateId) {
    return blockUpstreamReopen("upstream_reopen_gate_mismatch");
  }
  if (verified.generationId.length === 0) {
    return blockUpstreamReopen("upstream_reopen_generation_missing");
  }
  if (verified.currentPhase !== projection.phase) {
    return blockUpstreamReopen("upstream_reopen_phase_mismatch");
  }
  if (verified.verifiedFrontierHash.length === 0) {
    return blockUpstreamReopen("upstream_reopen_frontier_missing");
  }

  // CURRENT upstream blocker agreement.
  const blocker = verified.upstreamBlocker;
  if (
    blocker.lineageId.length === 0 ||
    blocker.findingEventId.length === 0 ||
    blocker.committedAuthorityEventId.length === 0
  ) {
    return blockUpstreamReopen("upstream_reopen_blocker_provenance_missing");
  }
  if (!projection.currentUpstreamBlockers.some((id) => id === blocker.lineageId)) {
    return blockUpstreamReopen("upstream_reopen_blocker_lineage_not_current");
  }
  if (!lineageIds.some((id) => id === blocker.lineageId)) {
    return blockUpstreamReopen("upstream_reopen_blocker_lineage_not_current");
  }
  let finding: FindingState | undefined;
  for (const current of projection.findings.values()) {
    if (current.lineageId === blocker.lineageId) {
      finding = current;
      break;
    }
  }
  if (finding === undefined) {
    return blockUpstreamReopen("upstream_reopen_blocker_provenance_missing");
  }
  if (finding.ownerScope !== "requirements" && finding.ownerScope !== "design") {
    return blockUpstreamReopen("upstream_reopen_blocker_lineage_not_current");
  }
  if (blocker.currentOwner !== finding.ownerScope) {
    return blockUpstreamReopen("upstream_reopen_blocker_owner_mismatch");
  }

  const phaseArtifact =
    projection.phase === "design" ? context.artifacts.design : context.artifacts.plan;
  const workspaceStates = context.workspaceStates ?? projection.workspaceStates;
  const workspaceState = workspaceStates.get(phaseArtifact.canonicalPath);
  if (workspaceState === undefined) {
    return blockUpstreamReopen("upstream_reopen_unexplained_dirty_state");
  }

  if (projection.phase === "design") {
    // Requirements-owned blockers in the Design phase reopen Design; the
    // Design target itself is untouched and no restore lives below Design.
    if (verified.downstream !== null) {
      return blockUpstreamReopen("upstream_reopen_downstream_not_applicable");
    }
    if (verified.restoreCompletion !== null) {
      return blockUpstreamReopen("upstream_reopen_stale_restore_completion");
    }
    if (workspaceState !== "clean_committed") {
      return blockUpstreamReopen("upstream_reopen_unexplained_dirty_state");
    }
    return freezeOperation({
      kind: "append_reopen",
      phase: "design",
      lineageIds,
      verifiedRestoreCompletionEventId: null,
    });
  }

  // Plan phase: restore the dirty downstream target first, or reopen once it
  // is clean (with the Task 10 completion bound in when witnessed).
  if (workspaceState === "mutation_in_flight") {
    return blockUpstreamReopen("upstream_reopen_conflicting_restore");
  }
  const completionProblem = validateRestoreCompletion(
    phaseArtifact,
    verified.downstream,
    verified.restoreCompletion,
  );
  if (completionProblem !== null) {
    return blockUpstreamReopen(completionProblem);
  }

  if (verified.restoreCompletion !== null) {
    // Exactly matched SUCCEEDED/RECOVERED completion reopens on re-projection,
    // and a completion claimed over a still dirty target contradicts the
    // workspace witness.
    if (verified.downstream !== null) {
      const downstreamProblem = validateDownstreamProvenance(phaseArtifact, verified.downstream);
      if (downstreamProblem !== null) {
        return blockUpstreamReopen(downstreamProblem);
      }
    }
    if (workspaceState !== "clean_committed") {
      return blockUpstreamReopen("upstream_reopen_restore_completion_workspace_conflict");
    }
    return freezeOperation({
      kind: "append_reopen",
      phase: "design",
      lineageIds,
      verifiedRestoreCompletionEventId: verified.restoreCompletion.completionEventId,
    });
  }

  if (verified.downstream === null) {
    if (workspaceState === "known_dirty") {
      return blockUpstreamReopen("upstream_reopen_dirty_provenance_missing");
    }
    // Clean downstream: append the reopen without a speculative restore.
    return freezeOperation({
      kind: "append_reopen",
      phase: "design",
      lineageIds,
      verifiedRestoreCompletionEventId: null,
    });
  }

  // A known-dirty target without a completion needs exact Task 10 provenance.
  if (workspaceState !== "known_dirty") {
    return blockUpstreamReopen("upstream_reopen_unexplained_dirty_state");
  }
  if (verified.downstream.phase !== projection.phase) {
    return blockUpstreamReopen("upstream_reopen_downstream_phase_mismatch");
  }
  if (verified.downstream.targetPath !== phaseArtifact.canonicalPath) {
    // The dirty upstream Design artifact is never the downstream Plan target.
    return blockUpstreamReopen("upstream_reopen_wrong_downstream_target");
  }
  const provenanceProblem = validateDownstreamProvenance(phaseArtifact, verified.downstream);
  if (provenanceProblem !== null) {
    return blockUpstreamReopen(provenanceProblem);
  }
  return freezeOperation({
    kind: "prepare_restore",
    targetPath: verified.downstream.targetPath,
    restoreTo: phaseArtifact,
    restoreProof: buildRestoreProof(verified),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freezeOperation(operation: ReviewGateNextOperation): ReviewGateNextOperation {
  return Object.freeze(operation);
}

function requireSuspensionReason(projection: ReviewGateProjection): ReviewGateSuspensionReason {
  const reason = projection.suspensionReason;
  if (reason === null) {
    // Unreachable via valid reductions; fail loudly instead of guessing.
    throw new Error("review_gate_suspended_without_suspension_reason");
  }
  return reason;
}

function requireApprovalBinding(projection: ReviewGateProjection): ReviewApprovalBindingV1 {
  const approvalBinding = projection.approvalBinding;
  if (approvalBinding === null) {
    throw new Error("review_gate_orchestrator_completed_without_binding");
  }
  return approvalBinding;
}

function requirePhaseMatch(
  projection: ReviewGateProjection,
  phase: ReviewGatePhase,
  step: string,
): void {
  if (projection.phase !== phase) {
    throw new Error(`review_gate_orchestrator_phase_mismatch_${step}`);
  }
}

function phaseArtifactPath(
  context: ReviewGatePlanningContext,
  phase: ReviewGatePhase,
): string {
  return phase === "design"
    ? context.artifacts.design.canonicalPath
    : context.artifacts.plan.canonicalPath;
}

function requirePhaseArtifact(
  context: ReviewGatePlanningContext,
  phase: ReviewGatePhase,
  artifactPath: string,
): void {
  if (phaseArtifactPath(context, phase) !== artifactPath) {
    throw new Error("review_gate_orchestrator_commit_artifact_mismatch");
  }
}


function selfReviewedLineageIds(projection: ReviewGateProjection): LineageId[] {
  const lineageIds: LineageId[] = [];
  for (const finding of projection.findings.values()) {
    if (finding.status === "self_reviewed") {
      lineageIds.push(finding.lineageId);
    }
  }
  return lineageIds;
}

/**
 * Next remediation round for the projection's current phase: one past the
 * highest ordinal already recorded for that phase (1 when none). Mirrors the
 * lineage module's round issuance so the reducer de-duplicates by (phase,
 * ordinal) cleanly.
 */
function nextRemediationRound(projection: ReviewGateProjection): RemediationRound {
  const rounds =
    projection.phase === "design"
      ? projection.designRemediationRounds
      : projection.planRemediationRounds;
  let maxOrdinal = 0;
  for (const round of rounds) {
    if (round.ordinal > maxOrdinal) {
      maxOrdinal = round.ordinal;
    }
  }
  return Object.freeze({ phase: projection.phase, ordinal: maxOrdinal + 1 });
}
