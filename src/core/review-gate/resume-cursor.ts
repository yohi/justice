import type {
  CurrentPhaseDisposition,
  ReviewGateProjection,
  ReviewGateResumeCursor,
  VerifiedDispatchRecoveryCursorV1,
  VerifiedTerminalStateV1,
} from "./types.js";

/**
 * Derive the resume cursor for a projected Review Gate.
 *
 * Precedence:
 * 1. Terminal states — completed wins over everything else.
 * 2. Suspended states map to their specific await/resume cursor.
 * 3. Active states apply OSC1 upstream precedence first, then pending
 *    revalidation, then the current-phase disposition seam
 *    (NC1 / round-limit / remediation continuation), then the first
 *    dispatch recovery cursor for a pending external-operation dispatch,
 *    and finally a plain review cursor for a clean active phase.
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
  if (projection.status === "suspended") {
    switch (projection.suspensionReason) {
      case "execution_suspended":
        return freezeCursor({
          kind: "resume_execution",
          cursor: Object.freeze({
            epochId: projection.epoch.epochId,
            startedAt: projection.epoch.startedAt,
          }),
        });
      case "round_limit_exhausted":
        return freezeCursor({ kind: "await_external_change" });
      case "review_non_convergent":
        return freezeCursor({ kind: "await_material_progress" });
      case "reopen_required":
        return freezeCursor({ kind: "await_upstream_commit" });
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
        return freezeCursor({ kind: "round_limit_exhausted" });
      case "remediate":
        return freezeCursor({
          kind: "remediate",
          lineageIds: projection.currentRemediableBlockers,
        });
    }
  }
  const firstRecovery = projection.dispatchRecoveryCursors?.[0];
  if (firstRecovery !== undefined) {
    return freezeCursor({
      kind: "dispatch_recovery",
      recovery: freezeDispatchRecovery(firstRecovery),
    });
  }
  return freezeCursor({ kind: "review" });
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

