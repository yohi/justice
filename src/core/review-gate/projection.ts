import type {
  CompletedApprovalBindingV2,
  CompletedApprovalBindingV1,
  DesignClearV2,
  DesignClearMilestone,
  FindingState,
  GateCreatedV1,
  GateCreatedV2,
  LineageId,
  PlanClearMilestone,
  RemediationRound,
  ReviewApprovalBindingV1,
  ReviewGateEvent,
  ReviewGatePhase,
  ReviewGateProjection,
  ReviewGateState,
  ReviewTargetWorkspaceState,
  VerifiedRequirementsBinding,
  VerifiedScopeFrontier,
} from "./types.js";
import type { RequirementsAuthoritySnapshotV1 } from "../review-gate-types.js";
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
  for (const event of events.slice(1)) {
    switch (event.eventType) {
      case "GATE_CREATED":
        throw new Error("review_gate_duplicate_gate_creation");
      case "ARTIFACT_BINDINGS_UPDATED":
        break;
      case "ORCHESTRATION_RESUMED":
        state = {
          ...state,
          epoch: {
            epochId: event.epochId,
            startedAt: event.emittedAt,
            reason: "orchestration_resumed",
          },
          status:
            state.status === "suspended" && state.suspensionReason === "execution_suspended"
              ? "active"
              : state.status,
          suspensionReason:
            state.suspensionReason === "execution_suspended" ? null : state.suspensionReason,
        };
        break;
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
      case "EXECUTION_SUSPENDED":
        state = { ...state, status: "suspended", suspensionReason: "execution_suspended" };
        break;
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
    workspaceStates,
    currentRemediableBlockers: Object.freeze(currentRemediableBlockers),
    currentUpstreamBlockers: Object.freeze(currentUpstreamBlockers),
    pendingRevalidationBlockers: Object.freeze(pendingRevalidationBlockers),
    phaseBaselineRevision,
    phaseReviewContextIdentity,
  });
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
  effectiveContext: VerifiedGateContextBinding,
  frontierHash: string,
  remainingRounds: number,
): VerifiedNC1StopV1 {
  return Object.freeze({
    stopEventId,
    phase,
    epochId,
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

  let ownDesignClear: VerifiedUnfinishedBindingSnapshot["ownDesignClear"] = null;
  let completedApproval: VerifiedCompletedBindingSnapshot | null = null;

  const rounds = { design: 0, plan: 0 };
  const countedOperations = new Set<string>();
  let suspensionReason: string | null = null;
  let nc1Stop: VerifiedNC1StopV1 | null = null;

  for (const event of input.events) {
    if (!isV2Event(event)) {
      switch (event.eventType) {
        case "REOPEN_REQUIRED":
          suspensionReason = "reopen_required";
          break;
        case "ROUND_LIMIT_EXHAUSTED": {
          const phase = event.payload.phase;
          suspensionReason = "round_limit_exhausted";
          const remainingRounds = phase === "design"
            ? MAX_DESIGN_REMEDIATION_ROUNDS - rounds.design
            : MAX_PLAN_REMEDIATION_ROUNDS - rounds.plan;
          nc1Stop = makeNc1Stop("synthetic-v1-stop", phase, event.epochId, effectiveContext, frontierHash, remainingRounds);
          break;
        }
        case "REVIEW_NON_CONVERGENT": {
          const phase = event.payload.phase;
          suspensionReason = "review_non_convergent";
          const remainingRounds = phase === "design"
            ? MAX_DESIGN_REMEDIATION_ROUNDS - rounds.design
            : MAX_PLAN_REMEDIATION_ROUNDS - rounds.plan;
          nc1Stop = makeNc1Stop("synthetic-v1-stop", phase, event.epochId, effectiveContext, frontierHash, remainingRounds);
          break;
        }
        case "EXECUTION_SUSPENDED":
          suspensionReason = "execution_suspended";
          break;
        case "ORCHESTRATION_RESUMED":
          suspensionReason = null;
          nc1Stop = null;
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
      context: admissionContext,
    }),
    effective: Object.freeze({
      context: effectiveContext,
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
    lastVerifiedBinding,
    nc1Stop,
  });
}
