/**
 * NC1-only Two-Key reentry planner (Task 14, PLAN-012).
 *
 * `planNonConvergenceReentry` decides the reentry of a gate suspended by a
 * non-convergence (NC1) stop. It is a distinct pure authority path from the
 * ordinary orchestrator's upstream reopen planner: the decision union is
 * exactly `STAY_SUSPENDED | REENTER_SAME_GENERATION | BLOCK`, and it can never
 * produce `RESTORE_DOWNSTREAM_FIRST`, `prepare_restore`,
 * `REQUIREMENTS_REOPEN_REQUIRED` or `DESIGN_REOPEN_REQUIRED` (those belong to
 * the ordinary orchestrator or to the validator's vocabulary, not to this
 * planner).
 *
 * Two-Key authority: reentry requires BOTH the Task 7 verified eligible
 * change (phase-eligible clean committed workspace artifact, or an
 * authenticated immutable committed protocol release) AND an independently
 * validated `MATERIAL_PROGRESS` outcome bound to the original NC1 stop
 * evidence and to the observed change evidence. Every binding is re-checked
 * here rather than trusted from the input shape alone; forged or mismatched
 * evidence blocks. The planner creates no budgets and no generations, and it
 * never carries or creates upstream/restore authority: a verified
 * `REQUIREMENTS_REOPEN_REQUIRED` / `DESIGN_REOPEN_REQUIRED` outcome stays
 * suspended until a separately committed CURRENT upstream lineage is projected
 * and the ordinary orchestrator decides the upstream handling.
 *
 * Task 18 owns the runtime witness commits
 * (`NON_CONVERGENCE_REENTRY_VALIDATION_COMPLETED`, semantic context
 * transitions, epoch/reentry transitions) before a reentered gate returns to
 * ACTIVE; this planner only classifies the verified evidence. Publication
 * gates such as the separate Task 12 semantic compatibility result for
 * Requirements changes are enforced by the coordinator, not here.
 */

import type { VerifiedNC1EligibleChangeV1 } from "./admission.js";
import type { ReviewGatePhase } from "../review-gate-types.js";

/**
 * The independently verified evidence a coordinator may pass to the NC1
 * reentry planner. `verifiedChange` is the Task 7 `REENTRY_CANDIDATE`
 * proof (or `null` when nothing eligible was verified); `validation` carries
 * the dispatched `NON_CONVERGENCE_REENTRY_VALIDATION` outcome together with the
 * original NC1 stop and the change evidence it was bound to.
 */
export type VerifiedReentryInput = Readonly<{
  readonly gateId: string;
  readonly generationId: string;
  readonly epochId: string;
  readonly phase: ReviewGatePhase;
  readonly remainingRounds: number;
  readonly nc1EvidenceEventId: string;
  readonly verifiedChange: VerifiedNC1EligibleChangeV1 | null;
  readonly validation: Readonly<{
    readonly outcome:
      | "MATERIAL_PROGRESS"
      | "NO_MATERIAL_PROGRESS"
      | "DESIGN_REOPEN_REQUIRED"
      | "REQUIREMENTS_REOPEN_REQUIRED"
      | "INDETERMINATE";
    readonly validationEventId: string;
    readonly boundNc1EvidenceEventId: string;
    readonly boundChangeProofEventId: string;
  }> | null;
}>;

/**
 * The complete NC1 reentry decision vocabulary. Deliberately excludes every
 * restore/reopen variant: those are ordinary-orchestrator decisions projected
 * from independently verified CURRENT upstream lineage evidence.
 */
export type ReentryDecision =
  | "STAY_SUSPENDED"
  | "REENTER_SAME_GENERATION"
  | "BLOCK";

/**
 * Decide the NC1 reentry from independently verified evidence.
 *
 * - No validation outcome (yet) => `STAY_SUSPENDED`: reentry waits for the
 *   dispatched validator's witnessed result.
 * - Any binding mismatch (gate/generation/phase/NC1 stop/change-proof ids,
 *   forged observation, or a positive outcome with no verified change) =>
 *   `BLOCK`.
 * - `MATERIAL_PROGRESS` over a verified, phase-eligible change =>
 *   `REENTER_SAME_GENERATION` (the ordinary orchestrator and coordinator own
 *   everything that happens after the classification).
 * - `NO_MATERIAL_PROGRESS`, `INDETERMINATE`, and the two upstream reopen
 *   outcomes => `STAY_SUSPENDED`.
 */
export function planNonConvergenceReentry(input: VerifiedReentryInput): ReentryDecision {
  const validation = input.validation;
  if (validation === null) {
    return "STAY_SUSPENDED";
  }

  // Malformed identity bindings fail closed instead of guessing.
  if (
    input.gateId.length === 0 ||
    input.generationId.length === 0 ||
    input.epochId.length === 0 ||
    input.nc1EvidenceEventId.length === 0 ||
    validation.validationEventId.length === 0
  ) {
    return "BLOCK";
  }
  // The validation outcome itself must be bound to the recorded NC1 stop.
  if (validation.boundNc1EvidenceEventId !== input.nc1EvidenceEventId) {
    return "BLOCK";
  }
  const change = input.verifiedChange;
  if (change !== null) {
    // The eligible change must record exactly this suspension.
    if (
      change.gateId !== input.gateId ||
      change.generationId !== input.generationId ||
      change.phase !== input.phase ||
      change.nc1StopEventId !== input.nc1EvidenceEventId
    ) {
      return "BLOCK";
    }
    // The validation outcome must be bound to the exact change evidence.
    const expectedChangeProofEventId =
      change.kind === "artifact"
        ? change.changeObservedEventId
        : change.progressInvalidatedEventId;
    if (validation.boundChangeProofEventId !== expectedChangeProofEventId) {
      return "BLOCK";
    }
    // Phase eligibility, fail closed: a plan-phase payload cannot license the
    // reentry of a design-phase stop (and vice versa through the phase check
    // above); it suspends rather than crashing on evidence from a different
    // review scope.
    if (change.kind === "artifact" && change.artifactKind === "plan" && input.phase !== "plan") {
      return "STAY_SUSPENDED";
    }
    if (change.kind === "protocol") {
      if (change.protocolPhase !== input.phase) {
        return "STAY_SUSPENDED";
      }
      // No descriptor/fingerprint delta and no release advance: provider-only
      // or fabricated protocol change.
      if (
        change.beforeDescriptorDigest === change.afterDescriptorDigest &&
        change.beforePhaseFingerprint === change.afterPhaseFingerprint
      ) {
        return "BLOCK";
      }
      if (change.afterReleaseId === change.beforeReleaseId) {
        return "BLOCK";
      }
    } else if (
      change.beforeArtifactDigest === change.afterArtifactDigest ||
      change.beforeGitBlobOid === change.afterGitBlobOid
    ) {
      // No actual content delta: false model progress.
      return "BLOCK";
    }
  } else if (validation.outcome === "MATERIAL_PROGRESS") {
    // False model progress: a positive outcome with no verified change.
    return "BLOCK";
  }

  if (validation.outcome !== "MATERIAL_PROGRESS") {
    // Negative, upstream-required, and uncertain outcomes (including a missing
    // change binding for reopen outcomes) all keep the gate suspended. NC1
    // evidence/progress cannot create a new upstream lineage or override
    // upstream precedence.
    return "STAY_SUSPENDED";
  }
  if (input.remainingRounds <= 0) {
    return "STAY_SUSPENDED";
  }
  return "REENTER_SAME_GENERATION";
}
