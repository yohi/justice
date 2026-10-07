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
 * 3. Suspended gates map to `suspended` (with the shared `deriveResumeCursor`
 *    mapping), except a `review_non_convergent` suspension with observed
 *    material progress, which routes to `validate_non_convergence_reentry`.
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
}>;

// ---------------------------------------------------------------------------
// Next-operation vocabulary
// ---------------------------------------------------------------------------

export type ReviewGateNextOperation =
  | Readonly<{
      readonly kind: "dispatch_reviewer";
      readonly phase: ReviewGatePhase;
      readonly redispachedOperationId?: string;
    }>
  | Readonly<{
      readonly kind: "dispatch_finding_validator";
      readonly phase: ReviewGatePhase;
      readonly candidate: ReviewCandidateObservationV1;
      readonly redispachedOperationId?: string;
    }>
  | Readonly<{
      readonly kind: "commit_finding_reconciliation";
      readonly batch: ValidatedFindingBatch;
    }>
  | Readonly<{
      readonly kind: "dispatch_lineage_revalidation";
      readonly lineageId: LineageId;
      readonly redispachedOperationId?: string;
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
      readonly redispachedOperationId?: string;
    }>
  | Readonly<{
      readonly kind: "prepare_restore";
      readonly targetPath: string;
      readonly restoreTo: ReviewArtifactBinding;
    }>
  | Readonly<{
      readonly kind: "recover_restore";
      readonly targetPath: string;
      readonly restoreTo: ReviewArtifactBinding;
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
      readonly redispachedOperationId?: string;
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
      return freezeOperation({
        kind: "recover_restore",
        targetPath: intent.targetPath,
        restoreTo: resolveArtifactBinding(context, intent.targetPath),
      });
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
        redispachedOperationId: intent.operationId,
      });
    case "finding_validator":
      if (intent.candidate === undefined) {
        throw new Error("review_gate_orchestrator_redispatch_candidate_required");
      }
      return freezeOperation({
        kind: "dispatch_finding_validator",
        phase: intent.phase,
        candidate: intent.candidate,
        redispachedOperationId: intent.operationId,
      });
    case "lineage_revalidation":
      if (intent.lineageId === undefined) {
        throw new Error("review_gate_orchestrator_redispatch_lineage_required");
      }
      return freezeOperation({
        kind: "dispatch_lineage_revalidation",
        lineageId: intent.lineageId,
        redispachedOperationId: intent.operationId,
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
        redispachedOperationId: intent.operationId,
      });
    case "non_convergence_reentry":
      return freezeOperation({
        kind: "validate_non_convergence_reentry",
        phase: intent.phase,
        redispachedOperationId: intent.operationId,
      });
  }
}

// ---------------------------------------------------------------------------
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

function planUpstreamReopen(
  projection: ReviewGateProjection,
  context: ReviewGatePlanningContext,
  lineageIds: ReadonlyArray<LineageId>,
): ReviewGateNextOperation {
  if (projection.phase === "design") {
    // Requirements-owned blockers in the Design phase suspend the gate for an
    // upstream Requirements commit; the Design target itself is untouched.
    return freezeOperation({ kind: "append_reopen", phase: "design", lineageIds });
  }

  const designOwned = lineageIds.some((lineageId) => {
    const finding = projection.findings.get(lineageId);
    return finding !== undefined && finding.ownerScope === "design";
  });
  if (designOwned) {
    const workspaceStates = context.workspaceStates ?? projection.workspaceStates;
    const designPath = context.artifacts.design.canonicalPath;
    if (workspaceStates.get(designPath) !== "clean_committed") {
      // A Design-owned blocker found in the Plan phase means the approved
      // Design binding must be restored before the Design phase can reopen.
      return freezeOperation({
        kind: "prepare_restore",
        targetPath: designPath,
        restoreTo: context.artifacts.design,
      });
    }
  }
  return freezeOperation({ kind: "append_reopen", phase: "design", lineageIds });
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

function resolveArtifactBinding(
  context: ReviewGatePlanningContext,
  targetPath: string,
): ReviewArtifactBinding {
  if (context.artifacts.design.canonicalPath === targetPath) {
    return context.artifacts.design;
  }
  if (context.artifacts.plan.canonicalPath === targetPath) {
    return context.artifacts.plan;
  }
  throw new Error("review_gate_orchestrator_unknown_restore_target");
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
