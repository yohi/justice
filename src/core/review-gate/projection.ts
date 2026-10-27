import type {
  CompletedApprovalBindingV2,
  CompletedApprovalBindingV1,
  DesignClearV2,
  DesignClearMilestone,
  FindingState,
  GateCreatedV1,
  GateCreatedV2,
  EpochId,
  LineageId,
  PlanClearMilestone,
  RemediationRound,
  ReviewApprovalBindingV1,
  ReviewGateEvent,
  ReviewGatePhase,
  ReviewGateProjection,
  ReviewGateState,
  ReviewGateSuspensionDetail,
  ReviewTargetWorkspaceState,
  VerifiedRequirementsBinding,
  VerifiedDispatchRecoveryCursorV1,
  PrivateResponseEvidenceV1,
  VerifiedScopeFrontier,
  VerifiedTargetWriterAuthorityV1,
  VerifiedTargetWriterHandoffStateV1,
  VerifiedTerminalStateV1,
  SemanticContextInputsV1,
  VerifiedCycleEvidence,
  VerifiedSemanticContext,
} from "./types.js";
import type { RequirementsAuthoritySnapshotV1, RequirementsResolutionV2 } from "../review-gate-types.js";
import { MAX_DESIGN_REMEDIATION_ROUNDS, MAX_PLAN_REMEDIATION_ROUNDS } from "../review-gate-types.js";
import type { VerifiedReviewGateEvent } from "./event-schema.js";
import type {
  VerifiedCompletedBindingSnapshot,
  VerifiedGateContextBinding,
  VerifiedGateTip,
  VerifiedNC1StopV1,
  VerifiedUnfinishedBindingSnapshot,
} from "./admission.js";
import { computeCanonicalJsonFingerprint } from "./identity.js";
import { computeSemanticGoverningProjectionDigest } from "./deterministic-validation.js";

export function getInitialReviewGateState(gateCreated: GateCreatedV1): ReviewGateState {
  return {
    reviewScopeId: gateCreated.payload.reviewScopeId,
    gateId: gateCreated.gateId,
    status: "active",
    phase: "design",
    epoch: {
      epochId: gateCreated.epochId,
      startedAt: gateCreated.emittedAt,
      reason: "gate_created",
    },
    designRemediationRounds: [],
    planRemediationRounds: [],
    findings: new Map(),
    suspensionReason: null,
    approvalBinding: null,
    supersedesGateId: null,
  };
}

export function projectReviewGateState(events: readonly ReviewGateEvent[]): ReviewGateState {
  const firstEvent = events[0];
  if (firstEvent === undefined) throw new Error("review_gate_empty_history");
  if (firstEvent.eventType !== "GATE_CREATED") {
    throw new Error("review_gate_history_must_start_with_gate_created");
  }

  let state = getInitialReviewGateState(firstEvent);
  let suspendedEpochId: EpochId | null = null;
  for (const event of events.slice(1)) {
    switch (event.eventType) {
      case "GATE_CREATED":
        throw new Error("review_gate_duplicate_gate_creation");
      case "ARTIFACT_BINDINGS_UPDATED":
        break;
      case "ORCHESTRATION_RESUMED": {
        // Task 14: only a same-epoch resumption clears a plain execution
        // suspension; a resumption from a different epoch leaves the stop durable.
        const clearsExecution =
          state.status === "suspended" &&
          state.suspensionReason === "execution_suspended" &&
          suspendedEpochId === event.epochId;
        state = {
          ...state,
          epoch: {
            epochId: event.epochId,
            startedAt: event.emittedAt,
            reason: "orchestration_resumed",
          },
          status: clearsExecution ? "active" : state.status,
          suspensionReason: clearsExecution ? null : state.suspensionReason,
        };
        if (clearsExecution) suspendedEpochId = null;
        break;
      }
      case "DESIGN_CLEAR":
        if (state.phase !== "design") {
          throw new Error("review_gate_design_clear_not_in_design_phase");
        }
        state = { ...state, phase: "plan" };
        break;
      case "PLAN_CLEAR":
        if (state.phase !== "plan") {
          throw new Error("review_gate_plan_clear_not_in_plan_phase");
        }
        state = { ...state, phase: "plan" };
        break;
      case "REOPEN_REQUIRED":
        state = { ...state, status: "suspended", suspensionReason: "reopen_required" };
        break;
      case "ROUND_LIMIT_EXHAUSTED":
        state = { ...state, status: "suspended", suspensionReason: "round_limit_exhausted" };
        break;
      case "REVIEW_NON_CONVERGENT":
        state = { ...state, status: "suspended", suspensionReason: "review_non_convergent" };
        break;
      case "EXECUTION_SUSPENDED": {
        // The stop identity is Task 14's reentry key; recording it is exactly
        // what makes a later resumption provable.
        suspendedEpochId = event.epochId;
        state = { ...state, status: "suspended", suspensionReason: "execution_suspended" };
        break;
      }
      case "FINDING_DISCOVERED": {
        if (state.findings.has(event.payload.lineageId)) {
          throw new Error("review_gate_duplicate_lineage");
        }
        const finding: FindingState = {
          lineageId: event.payload.lineageId,
          findingId: event.payload.findingId,
          observedPhase: event.payload.observedPhase,
          ownerScope: event.payload.ownerScope,
          descriptionDigest: event.payload.descriptionDigest,
          status: "open",
          remediationRound: null,
          reopenedBy: null,
        };
        const findings = new Map(state.findings);
        findings.set(event.payload.lineageId, finding);
        state = { ...state, findings };
        break;
      }
      case "FINDING_REMEDIATED":
      case "FINDING_SELF_REVIEWED": {
        const finding = getFinding(state.findings, event.payload.lineageId);
        const updatedFinding: FindingState = {
          ...finding,
          status: event.eventType === "FINDING_REMEDIATED" ? "remediated" : "self_reviewed",
          remediationRound: event.payload.remediationRound,
        };
        const findings = new Map(state.findings);
        findings.set(event.payload.lineageId, updatedFinding);
        state = addRemediationRound({ ...state, findings }, event.payload.remediationRound);
        break;
      }
      case "FINDING_REOPENED": {
        const finding = getFinding(state.findings, event.payload.lineageId);
        const findings = new Map(state.findings);
        findings.set(event.payload.lineageId, {
          ...finding,
          status: "reopened",
          reopenedBy: event.payload.reopenedBy,
        });
        state = {
          ...state,
          findings,
          status:
            state.status === "suspended" && state.suspensionReason === "reopen_required"
              ? "active"
              : state.status,
          suspensionReason:
            state.suspensionReason === "reopen_required" ? null : state.suspensionReason,
        };
        break;
      }
      case "COMPLETED_APPROVAL_BINDING":
        state = completeState(state, event);
        break;
      default:
        assertNever(event);
    }
  }
  return state;
}

/**
 * Owner-scope depth order for OSC1 precedence: requirements < design < plan.
 * The current phase sits at the design/plan depth; scopes at or below it are
 * remediable, and strictly shallower scopes are upstream blockers.
 */
type OwnerScope = FindingState["ownerScope"];

const OWNER_SCOPE_DEPTH: ReadonlyMap<OwnerScope, number> = new Map([
  ["requirements", 0],
  ["design", 1],
  ["plan", 2],
]);

const PHASE_DEPTH: ReadonlyMap<ReviewGatePhase, number> = new Map([
  ["design", 1],
  ["plan", 2],
]);

/**
 * Full Review Gate projection: the base state-machine state plus the derived
 * workspace, milestone, blocker, and context-identity fields. Invalid event
 * histories are rejected by `projectReviewGateState` before anything else.
 *
 * Cross-generation seam (not implemented yet): when a GATE_CREATED supersedes a
 * predecessor generation with an exact completed Design approval binding, the
 * new generation should start with an inherited Design clear. Cross-generation
 * histories are not loaded here, so the inherited clear stays absent:
 * `effectiveDesignClear` is non-null only when the current history contains a
 * DESIGN_CLEAR event. A later task supplies the predecessor generation load.
 */
export function projectReviewGate(events: readonly ReviewGateEvent[]): ReviewGateProjection {
  const baseState = projectReviewGateState(events);
  const gateCreated = getGateCreatedEvent(events);

  let effectiveDesignClear: DesignClearMilestone | null = null;
  let planClearMilestone: PlanClearMilestone | null = null;
  let phaseBaselineRevision = 0;

  for (const event of events) {
    switch (event.eventType) {
      case "DESIGN_CLEAR":
        // The base reducer rejects DESIGN_CLEAR outside the design phase, so in
        // a valid history the first DESIGN_CLEAR is the only one: it is recorded
        // as the effective clear and never reset within the generation.
        if (effectiveDesignClear === null) {
          effectiveDesignClear = {
            epochId: event.epochId,
            emittedAt: event.emittedAt,
            designProtocolFingerprint: event.payload.designProtocolFingerprint,
          };
        }
        break;
      case "PLAN_CLEAR":
        // Plan clear is terminal: the first PLAN_CLEAR event establishes the
        // milestone and later replays or updates never move it.
        if (planClearMilestone === null) {
          planClearMilestone = {
            epochId: event.epochId,
            emittedAt: event.emittedAt,
            completedApprovalBinding: event.payload.completedApprovalBinding,
          };
        }
        break;
      case "FINDING_REOPENED":
        phaseBaselineRevision += 1;
        break;
      default:
        break;
    }
  }

  const currentRemediableBlockers: LineageId[] = [];
  const currentUpstreamBlockers: LineageId[] = [];
  const pendingRevalidationBlockers: LineageId[] = [];

  for (const finding of baseState.findings.values()) {
    const scopeDepth = OWNER_SCOPE_DEPTH.get(finding.ownerScope);
    const phaseDepth = PHASE_DEPTH.get(baseState.phase);
    if (scopeDepth === undefined || phaseDepth === undefined) {
      throw new Error("review_gate_unexpected_scope_or_phase");
    }
    if (finding.status === "remediated") {
      pendingRevalidationBlockers.push(finding.lineageId);
      continue;
    }
    if (finding.status !== "open" && finding.status !== "reopened") continue;
    if (scopeDepth >= phaseDepth) {
      currentRemediableBlockers.push(finding.lineageId);
    } else {
      currentUpstreamBlockers.push(finding.lineageId);
    }
  }

  // WSP1 stub: real worktree inspection lands in a later task, so every review
  // target of the gate scope currently projects as "clean_committed".
  const workspaceStates = new Map<string, ReviewTargetWorkspaceState>([
    [gateCreated.payload.designArtifact.canonicalPath, "clean_committed"],
    [gateCreated.payload.planArtifact.canonicalPath, "clean_committed"],
  ]);

  const phaseReviewContextIdentity = computeCanonicalJsonFingerprint({
    reviewProtocolFingerprint: gateCreated.payload.reviewProtocolFingerprint,
    designProtocolFingerprint:
      effectiveDesignClear?.designProtocolFingerprint ??
      baseState.approvalBinding?.designProtocolFingerprint ??
      "",
    planProtocolFingerprint:
      planClearMilestone?.completedApprovalBinding.planProtocolFingerprint ??
      baseState.approvalBinding?.planProtocolFingerprint ??
      "",
    phaseBaselineRevision,
  });

  return Object.freeze({
    ...baseState,
    effectiveDesignClear,
    planClearMilestone,
    suspensionDetail: deriveSuspensionDetail(events),
    workspaceStates,
    currentRemediableBlockers: Object.freeze(currentRemediableBlockers),
    currentUpstreamBlockers: Object.freeze(currentUpstreamBlockers),
    pendingRevalidationBlockers: Object.freeze(pendingRevalidationBlockers),
    phaseBaselineRevision,
    phaseReviewContextIdentity,
  });
}

/**
 * Project the durable stop identity of the current suspension from the event
 * history (Task 14). Mirrors the reducer's suspension transitions exactly —
 * including the same-epoch execution-suspension resumption rule — so the
 * resume cursor and the orchestrator's reentry classification share one
 * authority with the projection.
 */
function deriveSuspensionDetail(events: readonly ReviewGateEvent[]): ReviewGateSuspensionDetail | null {
  let detail: ReviewGateSuspensionDetail | null = null;
  for (const event of events) {
    switch (event.eventType) {
      case "REOPEN_REQUIRED":
        detail = Object.freeze({
          kind: "reopen_required",
          phase: event.payload.phase,
          lineageIds: event.payload.lineageIds,
          stoppedByEpochId: event.epochId,
        });
        break;
      case "ROUND_LIMIT_EXHAUSTED":
        detail = Object.freeze({
          kind: "round_limit_exhausted",
          phase: event.payload.phase,
          roundLimit: event.payload.roundLimit,
          stoppedByEpochId: event.epochId,
          stoppedByWriterId: event.writerId,
        });
        break;
      case "REVIEW_NON_CONVERGENT":
        detail = Object.freeze({
          kind: "review_non_convergent",
          phase: event.payload.phase,
          lineageIds: event.payload.lineageIds,
          stoppedByEpochId: event.epochId,
          stoppedByWriterId: event.writerId,
        });
        break;
      case "EXECUTION_SUSPENDED":
        detail = Object.freeze({
          kind: "execution_suspended",
          reason: event.payload.reason,
          stoppedByEpochId: event.epochId,
          stoppedByStartedAt: event.emittedAt,
        });
        break;
      case "ORCHESTRATION_RESUMED":
        if (
          detail !== null &&
          detail.kind === "execution_suspended" &&
          detail.stoppedByEpochId === event.epochId
        ) {
          detail = null;
        }
        break;
      case "FINDING_REOPENED":
        if (detail !== null && detail.kind === "reopen_required") {
          detail = null;
        }
        break;
      default:
        break;
    }
  }
  return detail;
}

function getGateCreatedEvent(events: readonly ReviewGateEvent[]): GateCreatedV1 {
  const firstEvent = events[0];
  if (firstEvent === undefined) throw new Error("review_gate_empty_history");
  if (firstEvent.eventType !== "GATE_CREATED") {
    throw new Error("review_gate_history_must_start_with_gate_created");
  }
  return firstEvent;
}

function getFinding(
  findings: ReadonlyMap<LineageId, FindingState>,
  lineageId: LineageId,
): FindingState {
  const finding = findings.get(lineageId);
  if (finding === undefined) throw new Error("review_gate_unknown_lineage");
  return finding;
}

function addRemediationRound(
  state: ReviewGateState,
  round: RemediationRound,
): ReviewGateState {
  const rounds = round.phase === "design" ? state.designRemediationRounds : state.planRemediationRounds;
  if (rounds.some((existing) => existing.phase === round.phase && existing.ordinal === round.ordinal)) {
    return state;
  }
  return round.phase === "design"
    ? { ...state, designRemediationRounds: [...state.designRemediationRounds, round] }
    : { ...state, planRemediationRounds: [...state.planRemediationRounds, round] };
}

function completeState(
  state: ReviewGateState,
  event: CompletedApprovalBindingV1,
): ReviewGateState {
  const { approvalBinding } = event.payload;
  if (state.status === "completed" && state.approvalBinding !== null && !sameBinding(state.approvalBinding, approvalBinding)) {
    throw new Error("review_gate_completed_binding_conflict");
  }
  return { ...state, status: "completed", approvalBinding };
}

function sameBinding(left: ReviewApprovalBindingV1, right: ReviewApprovalBindingV1): boolean {
  const leftRequirements = left.requirementsResolution;
  const rightRequirements = right.requirementsResolution;
  const leftEvidence = leftRequirements.designReferenceEvidence;
  const rightEvidence = rightRequirements.designReferenceEvidence;
  return (
    left.reviewScopeId === right.reviewScopeId &&
    left.gateId === right.gateId &&
    left.designArtifact.canonicalPath === right.designArtifact.canonicalPath &&
    left.designArtifact.digest === right.designArtifact.digest &&
    left.designArtifact.gitMode === right.designArtifact.gitMode &&
    left.planArtifact.canonicalPath === right.planArtifact.canonicalPath &&
    left.planArtifact.digest === right.planArtifact.digest &&
    left.planArtifact.gitMode === right.planArtifact.gitMode &&
    leftRequirements.source === rightRequirements.source &&
    leftRequirements.canonicalPath === rightRequirements.canonicalPath &&
    leftRequirements.digest === rightRequirements.digest &&
    leftEvidence?.referenceKind === rightEvidence?.referenceKind &&
    leftEvidence?.logicalLocation === rightEvidence?.logicalLocation &&
    left.reviewProtocolFingerprint === right.reviewProtocolFingerprint &&
    left.designProtocolFingerprint === right.designProtocolFingerprint &&
    left.planProtocolFingerprint === right.planProtocolFingerprint &&
    left.approvedAt === right.approvedAt
  );
}

function assertNever(value: never): never {
  throw new Error(`Unexpected ReviewGateEvent: ${String(value)}`);
}

type V2Envelope = Readonly<{
  schemaVersion: 2;
  eventId: string;
  parentEventId: string;
  emittedAt: string;
  gateId: string;
  epochId: string;
  generationId: string;
  writerId: string;
}>;

function isV2Event(
  event: VerifiedReviewGateEvent,
): event is VerifiedReviewGateEvent & V2Envelope {
  return "schemaVersion" in event && event.schemaVersion === 2;
}

function getV2GateCreated(
  events: readonly VerifiedReviewGateEvent[],
): (VerifiedReviewGateEvent & V2Envelope & { readonly eventType: "GATE_CREATED"; readonly payload: GateCreatedV2 }) | null {
  const first = events[0];
  if (first === undefined) return null;
  if (!isV2Event(first)) return null;
  if (first.eventType !== "GATE_CREATED") return null;
  return first as VerifiedReviewGateEvent & V2Envelope & { readonly eventType: "GATE_CREATED"; readonly payload: GateCreatedV2 };
}

function v2RequirementsBinding(
  requirements: GateCreatedV2["requirementsResolution"],
  selectedByEventId: string,
): VerifiedRequirementsBinding {
  return Object.freeze({
    source: requirements.source,
    workspaceIdentity: requirements.workspaceIdentity,
    canonicalPath: requirements.canonicalPath,
    digest: requirements.digest,
    gitMode: requirements.gitMode,
    gitBlobOid: requirements.requirementsGitBlobOid,
    selectedByEventId,
  });
}

/**
 * Legacy V1 events carry no event id, so any V1-derived authority pointer
 * uses this deterministic marker (same identity rule as `synthetic-v1-stop`).
 */
const SYNTHETIC_V1_REQUIREMENTS_AUTHORITY_EVENT_ID = "synthetic-v1-requirements-authority";

/**
 * Immutable projection of the Review Gate requirements authority (Task 15):
 * the historical V2 resolution pinned by `GATE_CREATED`, and the latest
 * validated current authority selected by a V2 `COMPLETED_APPROVAL_BINDING`
 * (its explicit binding) or a legacy `ARTIFACT_BINDINGS_UPDATED` (which
 * re-validates the pinned V2 resolution and never rewrites it). A V1-only
 * gate pins no V2 requirements authority and fails closed to null. The
 * historical and current records are always reported separately and are
 * never merged.
 */
export type VerifiedRequirementsAuthorityProjection = Readonly<{
  readonly historical: RequirementsResolutionV2;
  readonly historicalEventId: string;
  readonly current: VerifiedRequirementsBinding | null;
  readonly currentAuthorityEventId: string | null;
}>;

/** Pure projection of the historical versus current requirements authority. */
export function projectVerifiedRequirementsAuthority(
  events: readonly VerifiedReviewGateEvent[],
): VerifiedRequirementsAuthorityProjection | null {
  const gateCreated = getV2GateCreated(events);
  if (gateCreated === null) return null;

  const historical = gateCreated.payload.requirementsResolution;
  let current: VerifiedRequirementsBinding | null = null;
  let currentAuthorityEventId: string | null = null;

  for (const event of events) {
    if (isV2CompletedApprovalBinding(event)) {
      current = event.payload.currentRequirements;
      currentAuthorityEventId = event.payload.currentRequirementsAuthorityEventId;
      continue;
    }
    if (event.eventType !== "ARTIFACT_BINDINGS_UPDATED") continue;
    current = v2RequirementsBinding(historical, SYNTHETIC_V1_REQUIREMENTS_AUTHORITY_EVENT_ID);
    currentAuthorityEventId = SYNTHETIC_V1_REQUIREMENTS_AUTHORITY_EVENT_ID;
  }

  return Object.freeze({
    historical,
    historicalEventId: gateCreated.eventId,
    current,
    currentAuthorityEventId,
  });
}

type V2CompletedApprovalEvent = Extract<
  VerifiedReviewGateEvent,
  { readonly eventType: "COMPLETED_APPROVAL_BINDING"; readonly schemaVersion: 2 }
>;

function isV2CompletedApprovalBinding(event: VerifiedReviewGateEvent): event is V2CompletedApprovalEvent {
  return isV2Event(event) && event.eventType === "COMPLETED_APPROVAL_BINDING";
}

function buildContextBinding(
  payload: GateCreatedV2,
  selectedByEventId: string,
): VerifiedGateContextBinding {
  return Object.freeze({
    requirements: v2RequirementsBinding(payload.requirementsResolution, selectedByEventId),
    design: payload.designArtifact,
    plan: payload.planArtifact,
    globalProtocolFingerprint: payload.reviewProtocolFingerprint,
    designProtocolFingerprint: payload.designProtocolFingerprint,
    planProtocolFingerprint: payload.planProtocolFingerprint,
  });
}

function contextDigest(context: VerifiedGateContextBinding): string {
  return computeCanonicalJsonFingerprint({
    requirements: {
      source: context.requirements.source,
      workspaceIdentity: context.requirements.workspaceIdentity,
      canonicalPath: context.requirements.canonicalPath,
      digest: context.requirements.digest,
      gitMode: context.requirements.gitMode,
      gitBlobOid: context.requirements.gitBlobOid,
    },
    design: context.design,
    plan: context.plan,
    globalProtocolFingerprint: context.globalProtocolFingerprint,
    designProtocolFingerprint: context.designProtocolFingerprint,
    planProtocolFingerprint: context.planProtocolFingerprint,
  });
}

function makeNc1Stop(
  stopEventId: string,
  phase: ReviewGatePhase,
  epochId: string,
  stoppedWriterId: string,
  effectiveContext: VerifiedGateContextBinding,
  frontierHash: string,
  remainingRounds: number,
): VerifiedNC1StopV1 {
  return Object.freeze({
    stopEventId,
    phase,
    epochId,
    stoppedWriterId,
    stoppedContextDigest: contextDigest(effectiveContext),
    remainingRounds,
    witnessFrontierAtStop: frontierHash,
    protocolRelease: Object.freeze({
      stopEventId,
      historicalReleaseId: null,
      historicalReleaseProofDigest: null,
      historicalPublisherTrustPolicyVersion: null,
    }),
  });
}

/** Pure projection of a verified V2 event history into a `VerifiedGateTip`. */
export function projectVerifiedGateTip(
  input: Readonly<{
    gateId: string;
    scopeId: string;
    events: readonly VerifiedReviewGateEvent[];
    frontier: VerifiedScopeFrontier;
    persistedAuthority?: RequirementsAuthoritySnapshotV1 | null;
  }>,
): VerifiedGateTip {
  void input.persistedAuthority;

  const gateCreated = getV2GateCreated(input.events);
  if (gateCreated === null) {
    throw new Error("review_gate_tip_missing_v2_gate_created");
  }
  if (gateCreated.gateId !== input.gateId) {
    throw new Error("review_gate_tip_gate_id_mismatch");
  }

  const gateCreatedEventId = gateCreated.eventId;
  const gateGenerationId = gateCreated.generationId;
  const frontierHash = input.frontier.globalFrontierHash;

  const admissionContext = buildContextBinding(gateCreated.payload, gateCreatedEventId);
  const effectiveContext = admissionContext;
  let authorityEventId = gateCreatedEventId;
  let operationId = gateCreatedEventId;
  const historicalRequirements = gateCreated.payload.requirementsResolution;
  let currentRequirements = admissionContext.requirements;
  let currentRequirementsAuthorityEventId = gateCreatedEventId;


  let ownDesignClear: VerifiedUnfinishedBindingSnapshot["ownDesignClear"] = null;
  let completedApproval: VerifiedCompletedBindingSnapshot | null = null;

  const rounds = { design: 0, plan: 0 };
  const countedOperations = new Set<string>();
  let suspensionReason: string | null = null;
  let suspensionEpochId: string | null = null;
  let executionSuspended = false;
  let reopenRequired = false;
  let reopenRequiredEpochId: string | null = null;
  let nc1Reason: "round_limit_exhausted" | "review_non_convergent" | null = null;
  let nc1Stop: VerifiedNC1StopV1 | null = null;

  for (const event of input.events) {
    if (!isV2Event(event)) {
      switch (event.eventType) {
        case "REOPEN_REQUIRED":
          reopenRequired = true;
          reopenRequiredEpochId = event.epochId;
          suspensionReason = "reopen_required";
          suspensionEpochId = reopenRequiredEpochId;
          break;
        case "ROUND_LIMIT_EXHAUSTED": {
          const phase = event.payload.phase;
          suspensionReason = "round_limit_exhausted";
          suspensionEpochId = event.epochId;
          nc1Reason = "round_limit_exhausted";
          const remainingRounds = phase === "design"
            ? MAX_DESIGN_REMEDIATION_ROUNDS - rounds.design
            : MAX_PLAN_REMEDIATION_ROUNDS - rounds.plan;
          nc1Stop = makeNc1Stop(
            "synthetic-v1-stop",
            phase,
            event.epochId,
            event.writerId,
            effectiveContext,
            frontierHash,
            remainingRounds,
          );
          break;
        }
        case "REVIEW_NON_CONVERGENT": {
          const phase = event.payload.phase;
          suspensionReason = "review_non_convergent";
          suspensionEpochId = event.epochId;
          nc1Reason = "review_non_convergent";
          const remainingRounds = phase === "design"
            ? MAX_DESIGN_REMEDIATION_ROUNDS - rounds.design
            : MAX_PLAN_REMEDIATION_ROUNDS - rounds.plan;
          nc1Stop = makeNc1Stop(
            "synthetic-v1-stop",
            phase,
            event.epochId,
            event.writerId,
            effectiveContext,
            frontierHash,
            remainingRounds,
          );
          break;
        }
        case "ARTIFACT_BINDINGS_UPDATED":
          // Task 15: a legacy artifact rebinding re-validates the gate context
          // against the still-pinned V2 resolution; it never rewrites the
          // historical requirements authority.
          currentRequirements = v2RequirementsBinding(
            historicalRequirements,
            SYNTHETIC_V1_REQUIREMENTS_AUTHORITY_EVENT_ID,
          );
          currentRequirementsAuthorityEventId = SYNTHETIC_V1_REQUIREMENTS_AUTHORITY_EVENT_ID;
          break;
        case "EXECUTION_SUSPENDED":
          executionSuspended = true;
          if (suspensionReason === null) {
            suspensionReason = "execution_suspended";
            suspensionEpochId = event.epochId;
          }
          break;
        case "ORCHESTRATION_RESUMED":
          // Task 14: only a same-epoch resumption clears a plain execution
          // suspension; a resumption from a different epoch leaves the stop durable.
          if (
            !reopenRequired &&
            nc1Reason === null &&
            suspensionReason === "execution_suspended" &&
            suspensionEpochId !== event.epochId
          ) {
            break;
          }
          executionSuspended = false;
          suspensionReason = reopenRequired ? "reopen_required" : nc1Reason;
          if (reopenRequired) suspensionEpochId = reopenRequiredEpochId;
          else if (suspensionReason === null) suspensionEpochId = null;
          break;
        case "FINDING_REOPENED":
          reopenRequired = false;
          reopenRequiredEpochId = null;
          suspensionReason = nc1Reason ?? (executionSuspended ? "execution_suspended" : null);
          suspensionEpochId = suspensionReason === "execution_suspended"
            ? suspensionEpochId
            : nc1Stop?.epochId ?? null;
          break;
        default:
          break;
      }
      continue;
    }

    if (event.gateId !== input.gateId || event.generationId !== gateGenerationId) {
      throw new Error("review_gate_tip_event_identity_mismatch");
    }

    switch (event.eventType) {
      case "EXTERNAL_OPERATION_DISPATCHED": {
        if (event.payload.role !== "remediator" || countedOperations.has(event.payload.operationId)) break;
        countedOperations.add(event.payload.operationId);
        const phase = event.payload.phase;
        if (phase === "design") rounds.design += 1;
        else rounds.plan += 1;
        break;
      }
      case "SEMANTIC_CONTEXT_TRANSITION": {
        authorityEventId = event.eventId;
        operationId = event.payload.operationId;
        break;
      }
      case "NC1_REENTRY_OUTCOME_APPLIED": {
        if (
          nc1Reason === "review_non_convergent" &&
          nc1Stop !== null &&
          event.epochId === nc1Stop.epochId &&
          event.payload.nc1EvidenceEventId === nc1Stop.stopEventId
        ) {
          nc1Reason = null;
          nc1Stop = null;
          suspensionReason = reopenRequired
            ? "reopen_required"
            : executionSuspended
              ? "execution_suspended"
              : null;
          if (reopenRequired) suspensionEpochId = reopenRequiredEpochId;
          else if (!executionSuspended) suspensionEpochId = null;
        }
        break;
      }
      case "DESIGN_CLEAR": {
        const payload = event.payload as unknown as DesignClearV2;
        ownDesignClear = Object.freeze({
          eventId: event.eventId,
          approvedContextEventId: payload.approvedContextEventId,
          approvedRequirementsAuthorityEventId: authorityEventId,
          approvedDesign: effectiveContext.design,
          designProtocolFingerprint: payload.designProtocolFingerprint,
        });
        break;
      }
      case "COMPLETED_APPROVAL_BINDING": {
        const payload = event.payload as unknown as CompletedApprovalBindingV2;
        completedApproval = Object.freeze({
          approvalEventId: event.eventId,
          gateId: input.gateId,
          approvalBinding: payload.approvalBinding,
          generationId: gateGenerationId,
          historicalRequirementsV2EventId: gateCreatedEventId,
          historicalRequirements: gateCreated.payload.requirementsResolution,
          currentRequirementsAuthorityEventId: payload.currentRequirementsAuthorityEventId,
          currentRequirements: payload.currentRequirements,
          design: payload.approvalBinding.designArtifact,
          plan: payload.approvalBinding.planArtifact,
          designClearEventId: payload.designClearEventId,
          planClearEventId: payload.planClearEventId,
          globalProtocolFingerprint: gateCreated.payload.reviewProtocolFingerprint,
          verifiedHistoryFrontier: frontierHash,
        });
          currentRequirements = payload.currentRequirements;
          currentRequirementsAuthorityEventId = payload.currentRequirementsAuthorityEventId;
          break;
      }
      default:
        break;
    }
  }

  if (completedApproval !== null) {
    return Object.freeze({
      status: "completed",
      gateId: input.gateId,
      generationId: gateGenerationId,
      scopeId: input.scopeId,
      supersedesGateId: gateCreated.payload.supersedesGateId,
      completedApproval,
    });
  }

  const lastVerifiedBinding: VerifiedUnfinishedBindingSnapshot = Object.freeze({
    admission: Object.freeze({
      gateCreatedEventId,
      historicalRequirementsV2EventId: gateCreatedEventId,
      historicalRequirements,
      context: admissionContext,
    }),
    effective: Object.freeze({
      context: effectiveContext,
      currentRequirementsAuthorityEventId,
      currentRequirements,
      authorityEventId,
      operationId,
      verifiedHistoryFrontier: frontierHash,
    }),
    ownDesignClear,
  });

  return Object.freeze({
    status: suspensionReason === null ? "active" : "suspended",
    gateId: input.gateId,
    generationId: gateGenerationId,
    scopeId: input.scopeId,
    supersedesGateId: gateCreated.payload.supersedesGateId,
    rounds: Object.freeze({ design: rounds.design, plan: rounds.plan }),
    suspensionReason,
    suspensionEpochId,
    lastVerifiedBinding,
    nc1Stop,
    dispatchRecoveryCursors: projectVerifiedDispatchRecoveryCursors(input.events),
    terminalState: projectVerifiedTerminalState(input.events),
    targetWriterAuthorities: projectVerifiedTargetWriterAuthority(input.events),
    targetWriterHandoffState: projectVerifiedTargetWriterHandoffState(input.events),
  });
}

/**
 * Project the terminal writer-revoke state from a verified V2 event history.
 * Returns the latest non-finalized terminal revoke state, or null if no
 * terminal handoff has been requested.
 */
export function projectVerifiedTerminalState(
  events: readonly VerifiedReviewGateEvent[],
): VerifiedTerminalStateV1 | null {
  const states = new Map<string, VerifiedTerminalStateV1>();
  let latestHandoffOperationId: string | null = null;

  for (const event of events) {
    if (!isV2Event(event)) continue;
    if (event.eventType === "TARGET_WRITER_HANDOFF_REQUESTED") {
      const payload = event.payload;
      if (payload.purpose !== "TERMINAL_REVOKE_ONLY") continue;
      states.set(
        payload.handoffOperationId,
        Object.freeze({
          kind: "TERMINAL_REVOKE_PENDING",
          handoffOperationId: payload.handoffOperationId,
          terminalTransitionOperationId: payload.handoffOperationId,
          targets: payload.targets,
        }),
      );
      latestHandoffOperationId = payload.handoffOperationId;
      continue;
    }
    if (event.eventType === "TARGET_WRITER_TERMINAL_REVOKED") {
      const payload = event.payload;
      const finalized =
        payload.status === "NEVER_CLAIMED_OR_ALREADY_REVOKED" ||
        payload.nativeEffectDisposition === "APPLIED" ||
        payload.nativeEffectDisposition === "COMMITTED";
      states.set(
        payload.handoffOperationId,
        Object.freeze({
          kind: finalized
            ? "TERMINAL_FINALIZED"
            : "REVOKED_AWAITING_TERMINAL_PUBLICATION",
          handoffOperationId: payload.handoffOperationId,
          terminalTransitionOperationId: payload.terminalTransitionOperationId,
          targets: payload.targets,
        }),
      );
      latestHandoffOperationId = payload.handoffOperationId;
    }
  }

  return latestHandoffOperationId === null
    ? null
    : (states.get(latestHandoffOperationId) ?? null);
}

/**
 * Project the verified cross-Gate target writer authority from a verified V2
 * event history. Fail closed: a non-null snapshot is produced only from a
 * `TARGET_WRITER_TERMINAL_REVOKED` record — the sole gate event that carries
 * protected Task 5 revocation evidence — bound to exactly one matching
 * `TERMINAL_REVOKE_ONLY` handoff intent for the identical single target. Each
 * target's latest verified authority is retained independently and keyed by
 * its target identity digest.
 * Handoff intents and continuation receipts alone never mint authority: gate
 * events carry no protected Task 5 receipt, so the projected generation,
 * frontier and revoke-CAS binding come only from the witnessed revoke record,
 * the pre-image binding only from the matching intent, and the Task 5
 * tombstone digest is never fabricated (`durableTombstoneProofDigest` stays
 * null). Multi-target or multi-prior-owner revokes and divergent duplicate
 * records fail closed as ambiguous.
 */
export function projectVerifiedTargetWriterAuthority(
  events: readonly VerifiedReviewGateEvent[],
): ReadonlyMap<string, VerifiedTargetWriterAuthorityV1> | null {
  type TerminalRevokePayload = Extract<
    VerifiedReviewGateEvent,
    { readonly eventType: "TARGET_WRITER_TERMINAL_REVOKED" }
  >["payload"];
  type HandoffIntentPayload = Extract<
    VerifiedReviewGateEvent,
    { readonly eventType: "TARGET_WRITER_HANDOFF_REQUESTED" }
  >["payload"];

  const revokes = new Map<string, TerminalRevokePayload>();
  const intents = new Map<string, HandoffIntentPayload>();

  for (const event of events) {
    if (!isV2Event(event)) continue;
    if (event.eventType === "TARGET_WRITER_TERMINAL_REVOKED") {
      const payload = event.payload;
      const known = revokes.get(payload.handoffOperationId);
      if (known !== undefined) {
        if (computeCanonicalJsonFingerprint(known) !== computeCanonicalJsonFingerprint(payload)) {
          return null;
        }
        continue;
      }
      revokes.set(payload.handoffOperationId, payload);
      continue;
    }
    if (event.eventType === "TARGET_WRITER_HANDOFF_REQUESTED" && event.payload.purpose === "TERMINAL_REVOKE_ONLY") {
      const payload = event.payload;
      const known = intents.get(payload.handoffOperationId);
      if (known !== undefined) {
        if (computeCanonicalJsonFingerprint(known) !== computeCanonicalJsonFingerprint(payload)) {
          return null;
        }
        continue;
      }
      intents.set(payload.handoffOperationId, payload);
    }
  }

  if (revokes.size === 0) return null;

  const authorities = new Map<string, VerifiedTargetWriterAuthorityV1>();
  for (const revoke of revokes.values()) {
    if (revoke.targets.length !== 1) return null;
    if (revoke.priorOwners.length > 1) return null;
    const revokeTarget = revoke.targets[0];
    if (revokeTarget === undefined) return null;

    const intent = intents.get(revoke.handoffOperationId);
    if (intent === undefined) return null;
    if (intent.targets.length !== 1) return null;
    const intentTarget = intent.targets[0];
    if (intentTarget === undefined) return null;
    if (
      computeCanonicalJsonFingerprint(intent.target) !== computeCanonicalJsonFingerprint(intentTarget) ||
      computeCanonicalJsonFingerprint(intentTarget) !== computeCanonicalJsonFingerprint(revokeTarget)
    ) {
      return null;
    }

    authorities.set(
      revokeTarget.targetIdentityDigest,
      Object.freeze({
        target: revokeTarget,
        globalTargetWriterGeneration: revoke.globalTargetWriterHighWatermark,
        activeOwner: null,
        priorOwner: revoke.priorOwners[0] ?? null,
        expectedImage: Object.freeze({
          digest: intent.expectedPreImageDigest,
          gitMode: intent.expectedGitMode,
        }),
        protectedTargetFrontier: revoke.protectedTargetFrontier,
        protectedTargetCasProofDigest: revoke.protectedRevokeCasProofDigest,
        durableTombstoneProofDigest: null,
      }),
    );
  }
  return authorities;
}

/**
 * Project the yielded handoff replay state (Task 9 PLAN-027) from a verified
 * V2 event history. Returns the latest handoff state, or null if no handoff
 * event has been witnessed.
 */
export function projectVerifiedTargetWriterHandoffState(
  events: readonly VerifiedReviewGateEvent[],
): VerifiedTargetWriterHandoffStateV1 | null {
  let latest: VerifiedTargetWriterHandoffStateV1 | null = null;

  for (const event of events) {
    if (!isV2Event(event)) continue;
    if (event.eventType === "TARGET_WRITER_HANDOFF_REQUESTED") {
      const payload = event.payload;
      if (payload.purpose !== "HANDOFF") continue;
      let status: VerifiedTargetWriterHandoffStateV1["status"];
      switch (payload.status) {
        case "REQUESTED":
          status = "REQUESTED";
          break;
        case "FENCED":
          status = "FENCED_NO_ACTIVE_WRITER";
          break;
        case "CLAIMED":
          status = "CLAIMED_OUTCOME_UNRECORDED";
          break;
        case "RESUMED":
          status = "RESUMED";
          break;
        default:
          status = "WAITING_FOR_GUARDS";
      }
      latest = Object.freeze({
        status,
        handoffOperationId: payload.handoffOperationId,
        originalOperationId: payload.originalOperationId,
        target: payload.targets[0] ?? payload.target,
        protectedTargetFrontier: payload.expectedTargetWriterFrontier,
        expectedGlobalTargetWriterGeneration: payload.expectedGlobalTargetWriterGeneration,
        newOwner: payload.newOwner,
        pendingNativeEffectReference: payload.pendingNativeEffectReference,
      });
      continue;
    }
    if (event.eventType === "TARGET_WRITER_HANDOFF_RESUMED") {
      const payload = event.payload;
      const intent = payload.intent;
      latest = Object.freeze({
        status: "RESUMED",
        handoffOperationId: intent.handoffOperationId,
        originalOperationId: intent.originalOperationId,
        target: intent.targets[0] ?? intent.target,
        protectedTargetFrontier: payload.protectedTargetFrontier,
        expectedGlobalTargetWriterGeneration: payload.globalTargetWriterGeneration,
        newOwner: intent.newOwner,
        pendingNativeEffectReference: payload.pendingNativeEffectReference,
      });
    }
  }

  return latest;
}

/**
 * Projected Task 9 semantic cycle history: the verified phase context plus
 * the complete, causally linked round evidence for Task 12's NC1 builder.
 */
export type VerifiedLineageHistory = Readonly<{
  readonly frontierHash: string;
  readonly context: VerifiedSemanticContext;
  readonly rounds: readonly VerifiedCycleEvidence[];
}>;

/**
 * Project the durable semantic cycle history (Task 9's evidence feed for
 * Task 12's `buildVerifiedSemanticCycles`) from a verified V2 event history.
 * Fail closed: a history is produced only when a verified semantic context is
 * reconstructible from witness-committed `SEMANTIC_CONTEXT_TRANSITION` inputs
 * that share one pinned phase/baseline/generation and are exactly causally
 * linked (each transition's old inputs equal the previous transition's new
 * inputs). Any lineage-bearing event that cannot yet be represented as
 * complete cycle evidence — remediation dispatches, `ALREADY_RESOLVED`
 * validations, regressions, cross-generation reconciliations and commit-bound
 * resolution records — fails closed to null instead of inferring the missing
 * Task 11 evidence, so replay cannot silently drop counter evidence.
 * Duplicate transitions collapse idempotently; divergent duplicates fail
 * closed.
 */
export function projectVerifiedLineageHistory(
  events: readonly VerifiedReviewGateEvent[],
): VerifiedLineageHistory | null {
  type SemanticTransitionPayload = Extract<
    VerifiedReviewGateEvent,
    { readonly eventType: "SEMANTIC_CONTEXT_TRANSITION" }
  >["payload"];

  const gateCreated = getV2GateCreated(events);
  if (gateCreated === null) return null;

  const transitions: SemanticTransitionPayload[] = [];
  const seenValidationEventIds = new Map<string, string>();

  for (const event of events) {
    if (!isV2Event(event)) continue;
    switch (event.eventType) {
      case "SEMANTIC_CONTEXT_TRANSITION": {
        const payload: SemanticTransitionPayload = event.payload;
        const fingerprint = computeCanonicalJsonFingerprint(payload);
        const knownFingerprint = seenValidationEventIds.get(payload.proof.validationEventId);
        if (knownFingerprint !== undefined) {
          if (knownFingerprint !== fingerprint) return null;
          continue;
        }
        seenValidationEventIds.set(payload.proof.validationEventId, fingerprint);
        transitions.push(payload);
        continue;
      }
      case "EXTERNAL_OPERATION_DISPATCHED":
        if (event.payload.role !== "remediator") break;
        return null;
      case "FINDING_VALIDATION_COMPLETED":
      case "LINEAGE_REGRESSED":
      case "CROSS_GENERATION_RECONCILIATION_COMPLETED":
      case "REVIEW_COMMIT_PREPARED":
      case "REMEDIATION_COMMIT_SUCCEEDED":
        return null;
      default:
        break;
    }
  }

  if (transitions.length === 0) return null;

  const first = transitions[0];
  if (first === undefined) return null;
  const phase = first.newInputs.phase;
  const phaseBaselineId = first.newInputs.phaseBaselineId;
  let previousNewInputs: SemanticContextInputsV1 | undefined;

  for (const { oldInputs, newInputs } of transitions) {
    if (
      oldInputs.gateId !== gateCreated.gateId ||
      newInputs.gateId !== gateCreated.gateId ||
      oldInputs.generationId !== gateCreated.generationId ||
      newInputs.generationId !== gateCreated.generationId
    ) {
      return null;
    }
    if (oldInputs.phase !== phase || newInputs.phase !== phase) return null;
    if (
      oldInputs.phaseBaselineId !== phaseBaselineId ||
      newInputs.phaseBaselineId !== phaseBaselineId
    ) {
      return null;
    }
    if (
      previousNewInputs !== undefined &&
      computeCanonicalJsonFingerprint(previousNewInputs) !== computeCanonicalJsonFingerprint(oldInputs)
    ) {
      return null;
    }
    previousNewInputs = newInputs;
  }

  const latest = transitions[transitions.length - 1];
  if (latest === undefined) return null;
  const protocolFingerprint = latest.newInputs.phase === "design"
    ? gateCreated.payload.designProtocolFingerprint
    : gateCreated.payload.planProtocolFingerprint;

  return Object.freeze({
    frontierHash: latest.verifiedHistoryFrontier,
    context: Object.freeze({
      gateId: latest.newInputs.gateId,
      generationId: latest.newInputs.generationId,
      phase: latest.newInputs.phase,
      phaseBaselineId: latest.newInputs.phaseBaselineId,
      semanticContractFingerprint: latest.newInputs.policy.semanticFingerprint,
      protocolFingerprint,
      contextDigest: computeSemanticGoverningProjectionDigest(latest.newInputs),
    }),
    rounds: Object.freeze([]),
  });
}
/**
 * Mutable accumulator for one dispatched external operation while folding the
 * verified event history. Mutation is private to this projection fold; every
 * returned cursor is rebuilt as a frozen immutable snapshot.
 */
type DispatchRecoveryFoldState = {
  readonly gateId: string;
  readonly generationId: string;
  readonly epochId: string;
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly role: string;
  readonly candidateOrTargetSetDigest: string;
  readonly inputBindingDigest: string;
  readonly protocolFingerprint: string;
  readonly dispatchEventId: string;
  readonly dispatchFrontierHash: string;
  kind:
    | "INTENT_PRE_LAUNCH"
    | "IN_FLIGHT"
    | "RESPONSE_STAGED"
    | "RESULT_COMMITTED_OUTCOME_PENDING"
    | "APPLIED"
    | "EVIDENCE_UNAVAILABLE";
  responseEvidence: PrivateResponseEvidenceV1 | null;
  resultEventId: string | null;
  redeliveryEvidenceDigest: string | null;
};

/**
 * Project the outstanding external-operation dispatch recovery cursors from a
 * verified V2 event history. Each `EXTERNAL_OPERATION_DISPATCHED` starts as
 * `IN_FLIGHT`; the private response-custody lifecycle events advance it —
 * `EXTERNAL_OPERATION_RESPONSE_STAGED` → `RESPONSE_STAGED`,
 * `EXTERNAL_OPERATION_RESULT_COMMITTED` → `RESULT_COMMITTED_OUTCOME_PENDING`,
 * and `EXTERNAL_OPERATION_OUTCOME_APPLIED` removes the cursor from the
 * outstanding set (the authoritative outcome is applied; nothing to recover).
 *
 * `INTENT_PRE_LAUNCH` and `EVIDENCE_UNAVAILABLE` are not produced by the
 * pure event fold here; they are emitted by the Task 18 runtime coordinator
 * when it has a verified intent before dispatch, or when independently
 * verified private evidence is unavailable. The fold type includes them so
 * the same cursor machinery can carry them through `deriveResumeCursor`.
 * Operations are keyed by `operationId` + `dispatchAttemptId`: every lifecycle
 * payload carries both ids, matching the private response record keying, so
 * the attempt is stable across events. Result events may appear before their
 * matching dispatch in the folded order, so dispatches are indexed in a first
 * pass and lifecycle states advance in a second pass. Inconsistent histories
 * (unknown dispatch reference, duplicate dispatch, or a repeated lifecycle
 * stage) fail closed instead of silently dropping evidence.
 */
export function projectVerifiedDispatchRecoveryCursors(
  events: readonly VerifiedReviewGateEvent[],
): ReadonlyArray<VerifiedDispatchRecoveryCursorV1> {
  const states = new Map<string, DispatchRecoveryFoldState>();
  const keyOf = (operationId: string, dispatchAttemptId: string): string =>
    `${operationId}\u0000${dispatchAttemptId}`;

  for (const event of events) {
    if (!isV2Event(event)) continue;
    if (event.eventType !== "EXTERNAL_OPERATION_DISPATCHED") continue;
    const payload = event.payload;
    const key = keyOf(payload.operationId, payload.dispatchAttemptId);
    if (states.has(key)) throw new Error("review_gate_dispatch_recovery_duplicate_dispatch");
    states.set(key, {
      gateId: payload.gateId,
      generationId: payload.generationId,
      epochId: payload.epochId,
      operationId: payload.operationId,
      dispatchAttemptId: payload.dispatchAttemptId,
      role: payload.role,
      candidateOrTargetSetDigest: payload.candidateOrTargetSetDigest,
      inputBindingDigest: payload.inputBindingDigest,
      protocolFingerprint: payload.protocolFingerprint,
      dispatchEventId: event.eventId,
      dispatchFrontierHash: payload.expectedWitnessFrontier,
      kind: "IN_FLIGHT",
      responseEvidence: null,
      resultEventId: null,
      redeliveryEvidenceDigest: null,
    });
  }

  for (const event of events) {
    if (!isV2Event(event)) continue;
    switch (event.eventType) {
      case "EXTERNAL_OPERATION_RESPONSE_STAGED":
      case "EXTERNAL_OPERATION_RESULT_COMMITTED":
      case "EXTERNAL_OPERATION_OUTCOME_APPLIED":
        break;
      default:
        continue;
    }
    const target = states.get(keyOf(event.payload.operationId, event.payload.dispatchAttemptId));
    if (target === undefined) throw new Error("review_gate_dispatch_recovery_unknown_dispatch");
    if (event.eventType === "EXTERNAL_OPERATION_RESPONSE_STAGED") {
      if (target.kind !== "IN_FLIGHT") {
        throw new Error("review_gate_dispatch_recovery_response_conflict");
      }
      target.kind = "RESPONSE_STAGED";
      target.responseEvidence = event.payload.responseEvidence;
      continue;
    }
    if (event.eventType === "EXTERNAL_OPERATION_RESULT_COMMITTED") {
      if (target.kind !== "IN_FLIGHT" && target.kind !== "RESPONSE_STAGED") {
        throw new Error("review_gate_dispatch_recovery_result_conflict");
      }
      target.kind = "RESULT_COMMITTED_OUTCOME_PENDING";
      target.resultEventId = event.payload.resultEventId;
      target.redeliveryEvidenceDigest = event.payload.redeliveryEvidenceDigest;
      continue;
    }
    if (target.kind === "APPLIED") {
      throw new Error("review_gate_dispatch_recovery_apply_conflict");
    }
    target.kind = "APPLIED";
  }

  const cursors: VerifiedDispatchRecoveryCursorV1[] = [];
  for (const state of states.values()) {
    if (state.kind === "APPLIED") continue;
    const base = {
      gateId: state.gateId,
      generationId: state.generationId,
      epochId: state.epochId,
      operationId: state.operationId,
      dispatchAttemptId: state.dispatchAttemptId,
      role: state.role,
      candidateOrTargetSetDigest: state.candidateOrTargetSetDigest,
      inputBindingDigest: state.inputBindingDigest,
      protocolFingerprint: state.protocolFingerprint,
      dispatchEventId: state.dispatchEventId,
      dispatchFrontierHash: state.dispatchFrontierHash,
    };
    if (state.kind === "RESPONSE_STAGED") {
      cursors.push(
        Object.freeze({
          ...base,
          kind: "RESPONSE_STAGED" as const,
          responseEvidence: state.responseEvidence,
          resultEventId: null,
          outcomeAppliedEventId: null,
          redeliveryEvidenceDigest: null,
        }),
      );
      continue;
    }
    if (state.kind === "RESULT_COMMITTED_OUTCOME_PENDING") {
      cursors.push(
        Object.freeze({
          ...base,
          kind: "RESULT_COMMITTED_OUTCOME_PENDING" as const,
          responseEvidence: state.responseEvidence,
          resultEventId: state.resultEventId,
          outcomeAppliedEventId: null,
          redeliveryEvidenceDigest: state.redeliveryEvidenceDigest,
        }),
      );
      continue;
    }
    if (state.kind === "INTENT_PRE_LAUNCH" || state.kind === "EVIDENCE_UNAVAILABLE") {
      // Task 18 runtime coordinator produces these states; the pure Core
      // projection only preserves them when forwarded. No current V2 event
      // emits them, so this branch is unreachable from event history alone.
      cursors.push(
        Object.freeze({
          ...base,
          kind: state.kind,
          responseEvidence: null,
          resultEventId: null,
          outcomeAppliedEventId: null,
          redeliveryEvidenceDigest: null,
        }),
      );
      continue;
    }
    cursors.push(
      Object.freeze({
        ...base,
        kind: "IN_FLIGHT" as const,
        responseEvidence: null,
        resultEventId: null,
        outcomeAppliedEventId: null,
        redeliveryEvidenceDigest: null,
      }),
    );
  }
  return Object.freeze(cursors);
}
