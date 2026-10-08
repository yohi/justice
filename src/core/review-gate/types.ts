/**
 * Review Gate projection-level vocabulary.
 *
 * The primitive state-machine types stay canonical in `../review-gate-types.ts`;
 * this module re-exports that public surface and adds the derived types used by
 * `./projection.ts` and `./resume-cursor.ts`.
 */
export * from "../review-gate-types.js";

import type {
  EpochId,
  LineageId,
  ReviewApprovalBindingV1,
  ReviewGatePhase,
  ReviewGateState,
} from "../review-gate-types.js";

/**
 * WSP1 workspace state of a Review Gate target artifact. Real worktree
 * inspection lands in a later task; the current projection derives every
 * target as `"clean_committed"` (stub, see `projectReviewGate`).
 */
export type ReviewTargetWorkspaceState =
  | "clean_committed"
  | "known_dirty"
  | "mutation_in_flight";

/** Exact Design clear milestone observed in the current gate history. */
export type DesignClearMilestone = Readonly<{
  readonly epochId: EpochId;
  readonly emittedAt: string;
  readonly designProtocolFingerprint: string;
}>;

/** Exact Plan clear milestone observed in the current gate history. */
export type PlanClearMilestone = Readonly<{
  readonly epochId: EpochId;
  readonly emittedAt: string;
  readonly completedApprovalBinding: ReviewApprovalBindingV1;
}>;

/** Payload carried by a non-convergent current-phase disposition. */
export type ReviewNonConvergentPayload = Readonly<{
  readonly phase: ReviewGatePhase;
  readonly lineageIds: ReadonlyArray<LineageId>;
}>;

/**
 * Decision about the current review round supplied by the review coordinator.
 * Kept as an explicit seam: NC1 non-convergence, round-limit exhaustion, and
 * remediation continuation are decided upstream of `deriveResumeCursor`, while
 * OSC1 upstream precedence and pending revalidation are handled inside it.
 */
export type CurrentPhaseDisposition =
  | Readonly<{ readonly kind: "non_convergent"; readonly payload: ReviewNonConvergentPayload }>
  | Readonly<{ readonly kind: "round_limit" }>
  | Readonly<{ readonly kind: "remediate" }>;

/**
 * Resume cursor for a Review Gate. `resume_execution` carries the identity of
 * the epoch whose execution was suspended so a coordinator can verify the
 * epoch has not changed before resuming.
 */
export type ReviewGateResumeCursor =
  | Readonly<{ readonly kind: "completed" }>
  | Readonly<{
      readonly kind: "resume_execution";
      readonly cursor: Readonly<{ readonly epochId: EpochId; readonly startedAt: string }>;
    }>
  | Readonly<{ readonly kind: "await_external_change" }>
  | Readonly<{ readonly kind: "await_material_progress" }>
  | Readonly<{ readonly kind: "await_upstream_commit" }>
  | Readonly<{ readonly kind: "resolve_upstream"; readonly lineageIds: ReadonlyArray<LineageId> }>
  | Readonly<{ readonly kind: "revalidate"; readonly lineageIds: ReadonlyArray<LineageId> }>
  | Readonly<{ readonly kind: "non_convergent"; readonly payload: ReviewNonConvergentPayload }>
  | Readonly<{ readonly kind: "round_limit_exhausted" }>
  | Readonly<{ readonly kind: "remediate"; readonly lineageIds: ReadonlyArray<LineageId> }>
  | Readonly<{ readonly kind: "review" }>;

/**
 * Immutable projection of a Review Gate event history: the base reducer state
 * plus derived workspace, milestone, blocker, and context-identity fields.
 */
export type ReviewGateProjection = Readonly<
  ReviewGateState & {
    readonly effectiveDesignClear: DesignClearMilestone | null;
    readonly planClearMilestone: PlanClearMilestone | null;
    readonly workspaceStates: ReadonlyMap<string, ReviewTargetWorkspaceState>;
    readonly currentRemediableBlockers: ReadonlyArray<LineageId>;
    readonly currentUpstreamBlockers: ReadonlyArray<LineageId>;
    readonly pendingRevalidationBlockers: ReadonlyArray<LineageId>;
    readonly phaseBaselineRevision: number;
    readonly phaseReviewContextIdentity: string;
  }
>;
