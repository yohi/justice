import type {
  CompletedApprovalBindingV1,
  FindingState,
  GateCreatedV1,
  LineageId,
  RemediationRound,
  ReviewApprovalBindingV1,
  ReviewGateEvent,
  ReviewGateState,
} from "./review-gate-types.js";

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
    if (state.status === "completed") {
      if (event.eventType === "COMPLETED_APPROVAL_BINDING" && state.approvalBinding !== null) {
        if (sameBinding(state.approvalBinding, event.payload.approvalBinding)) continue;
        throw new Error("review_gate_completed_binding_conflict");
      }
      throw new Error("review_gate_event_after_completion");
    }

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
