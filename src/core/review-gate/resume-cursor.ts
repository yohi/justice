import {
  MAX_DESIGN_REMEDIATION_ROUNDS,
  MAX_PLAN_REMEDIATION_ROUNDS,
} from "../review-gate-types.js";
import type {
  CurrentPhaseDisposition,
  ReviewGateProjection,
  ReviewGateResumeCursor,
  ReviewGateSuspensionDetail,
  VerifiedDispatchRecoveryCursorV1,
  VerifiedTerminalStateV1,
} from "./types.js";

/**
 * Derive the resume cursor for a projected Review Gate (Task 14 two-key
 * reentry and phase reopen state machine).
 *
 * Precedence (first match wins):
 * 1. Completed — an absolute terminal state.
 * 2. Terminal writer-revoke states (terminal_revoke_pending /
 *    revoked_awaiting_terminal_publication / terminal_finalized).
 * 3. dispatch_recovery — an interrupted external-operation dispatch must be
 *    resolved exactly once before any reentry selection.
 * 4. The stopped reentry states carry their durable stop payloads:
 *    `reopen_required` (phase + lineages), `round_limit_exhausted` (phase +
 *    round limit), `review_non_convergent` (phase + lineages). A contradicting
 *    or missing stop record fails closed.
 * 5. Existing reentry-agnostic cursors for active gates: OSC1 upstream
 *    (resolve_upstream), pending revalidation (revalidate), then the
 *    current-phase disposition seam (non_convergent / round_limit_exhausted /
 *    remediate), then a plain review cursor for a clean active phase.
 * 6. A plain execution suspension resumes the recorded epoch (resume_execution).
 */
export function deriveResumeCursor(
  projection: ReviewGateProjection,
  currentPhaseDisposition?: CurrentPhaseDisposition,
): ReviewGateResumeCursor {
  if (projection.status === "completed") {
    return freezeCursor({ kind: "completed" });
  }
  const terminal = projection.terminalState;
  if (terminal !== undefined && terminal !== null) {
    return freezeTerminalCursor(terminal);
  }
  const firstRecovery = projection.dispatchRecoveryCursors?.[0];
  if (firstRecovery !== undefined) {
    return freezeCursor({
      kind: "dispatch_recovery",
      recovery: freezeDispatchRecovery(firstRecovery),
    });
  }
  if (projection.status === "suspended") {
    switch (projection.suspensionReason) {
      case "reopen_required":
      case "round_limit_exhausted":
      case "review_non_convergent":
        return freezeCursor(
          reentryCursorFromDetail(projection.suspensionDetail, projection.suspensionReason),
        );
      case "execution_suspended":
        return freezeCursor({
          kind: "resume_execution",
          cursor: Object.freeze({
            epochId: projection.epoch.epochId,
            startedAt: projection.epoch.startedAt,
          }),
        });
      case null:
      default:
        // Unreachable via valid reductions: the reducer never suspends without
        // a reason. Fail loudly on the impossible state instead of guessing.
        throw new Error("review_gate_suspended_without_suspension_reason");
    }
  }

  if (projection.currentUpstreamBlockers.length > 0) {
    return freezeCursor({
      kind: "resolve_upstream",
      lineageIds: projection.currentUpstreamBlockers,
    });
  }
  if (projection.pendingRevalidationBlockers.length > 0) {
    return freezeCursor({ kind: "revalidate", lineageIds: projection.pendingRevalidationBlockers });
  }
  if (currentPhaseDisposition !== undefined) {
    switch (currentPhaseDisposition.kind) {
      case "non_convergent":
        return freezeCursor({
          kind: "non_convergent",
          payload: currentPhaseDisposition.payload,
        });
      case "round_limit":
        return freezeCursor({
          kind: "round_limit_exhausted",
          phase: projection.phase,
          roundLimit:
            projection.phase === "design"
              ? MAX_DESIGN_REMEDIATION_ROUNDS
              : MAX_PLAN_REMEDIATION_ROUNDS,
        });
      case "remediate":
        return freezeCursor({
          kind: "remediate",
          lineageIds: projection.currentRemediableBlockers,
        });
    }
  }
  return freezeCursor({ kind: "review" });
}

/**
 * The stopped-suspension stop record is always carried by the projection; a
 * missing or contradictory record is a corrupt or foreign projection and
 * fails closed instead of guessing a cursor.
 */
function reentryCursorFromDetail(
  detail: ReviewGateSuspensionDetail | null,
  reason: "reopen_required" | "round_limit_exhausted" | "review_non_convergent",
): ReviewGateResumeCursor {
  // A stop record is required and must match the suspension reason; anything
  // else fails closed
  if (detail === null || detail.kind !== reason) {
    throw new Error("review_gate_suspension_detail_conflict");
  }
  if (detail.kind === "round_limit_exhausted") {
    return freezeCursor({
      kind: "round_limit_exhausted",
      phase: detail.phase,
      roundLimit: detail.roundLimit,
    });
  }
  return freezeCursor({
    kind: detail.kind,
    phase: detail.phase,
    lineageIds: detail.lineageIds,
  });
}

function freezeCursor(cursor: ReviewGateResumeCursor): ReviewGateResumeCursor {
  return Object.freeze(cursor);
}

/**
 * The recovery cursor is immutable projection data, but a projection is only
 * ever shallow-frozen; freezing it (and its response evidence) here keeps the
 * returned cursor deeply frozen even for freshly built cursor objects.
 */
function freezeDispatchRecovery(
  recovery: VerifiedDispatchRecoveryCursorV1,
): VerifiedDispatchRecoveryCursorV1 {
  if (recovery.responseEvidence !== null) {
    Object.freeze(recovery.responseEvidence);
  }
  return Object.freeze(recovery);
}

function freezeTerminalCursor(
  terminal: VerifiedTerminalStateV1,
): ReviewGateResumeCursor {
  terminal.targets.forEach((target) => Object.freeze(target));
  return freezeCursor({
    kind: terminal.kind.toLowerCase() as
      | "terminal_revoke_pending"
      | "revoked_awaiting_terminal_publication"
      | "terminal_finalized",
    handoffOperationId: terminal.handoffOperationId,
    terminalTransitionOperationId: terminal.terminalTransitionOperationId,
    targets: terminal.targets,
  });
}

