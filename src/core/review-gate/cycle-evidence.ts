/**
 * Task 12 — durable semantic cycle evidence and the six-rule NC1 evaluator.
 *
 * Pure core: consumes the Task 11 verified lineage evidence contracts and
 * produces deterministic non-convergence decisions. No I/O.
 */

import {
  computeCanonicalJsonFingerprint,
} from "./identity.js";
import {
  SEMANTIC_CONTEXT_COMPATIBILITY_PROOF_REGISTRY_DIGEST,
  SEMANTIC_CONTEXT_COMPATIBILITY_TABLE_DIGEST,
  SEMANTIC_CONTEXT_COMPATIBILITY_V1,
  computeSemanticGoverningProjectionDigest,
} from "./deterministic-validation.js";
import type {
  ReviewGatePhase,
  SemanticContextInputsV1,
  VerifiedSemanticContextTransitionInput,
} from "./types.js";
import type {
  SemanticBlockerEvidence,
  ValidatedTargetOutcome,
  VerifiedCommittedResolution,
  VerifiedRegression,
} from "./lineage.js";

export type VerifiedSemanticContext = Readonly<{
  readonly gateId: string;
  readonly generationId: string;
  readonly phase: ReviewGatePhase;
  readonly phaseBaselineId: string;
  readonly semanticContractFingerprint: string;
  readonly protocolFingerprint: string;
  readonly contextDigest: string;
}>;

export type VerifiedSemanticCycle = Readonly<{
  readonly context: VerifiedSemanticContext;
  readonly roundOrdinal: number;
  readonly operationId: string;
  readonly roundStartedEventId: string;
  readonly preRevisionDigest: string;
  readonly postRevisionDigest: string;
  readonly revisionCommitEventId: string | null;
  readonly comparisonSegmentId: string;
  readonly preLandscapeEventId: string;
  readonly postLandscapeEventId: string;
  readonly preBlockers: readonly SemanticBlockerEvidence[];
  readonly postBlockers: readonly SemanticBlockerEvidence[];
  readonly preCount: number;
  readonly postCount: number;
  readonly preFingerprint: string;
  readonly postFingerprint: string;
  readonly targetOutcomes: readonly ValidatedTargetOutcome[];
  readonly committedResolutions: readonly VerifiedCommittedResolution[];
  readonly regressions: readonly VerifiedRegression[];
}>;

/**
 * A cycle as supplied by a runtime projection, before the builder validates
 * cross-cycle links and freezes the result.
 */
export type VerifiedCycleEvidence = Readonly<{
  [K in keyof VerifiedSemanticCycle]: VerifiedSemanticCycle[K];
}>;

export type VerifiedLineageHistory = Readonly<{
  readonly frontierHash: string;
  readonly context: VerifiedSemanticContext;
  readonly rounds: readonly VerifiedCycleEvidence[];
}>;

export type VerifiedSemanticCyclesResult =
  | Readonly<{ readonly kind: "verified"; readonly cycles: readonly VerifiedSemanticCycle[] }>
  | Readonly<{ readonly kind: "indeterminate"; readonly reason: string; readonly missingEvidence: readonly string[] }>;

export function buildVerifiedSemanticCycles(
  history: VerifiedLineageHistory,
): VerifiedSemanticCyclesResult {
  const missingEvidence: string[] = [];
  const rounds = history.rounds;

  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    if (round === undefined) continue;
    if (
      computeCanonicalJsonFingerprint(round.context) !==
      computeCanonicalJsonFingerprint(history.context)
    ) {
      missingEvidence.push(`round_context:${round.roundOrdinal}`);
    }
    const expectedLineageIds = new Set(round.postBlockers.map((b) => b.lineageId));
    for (const lineageId of expectedLineageIds) {
      const outcome = round.targetOutcomes.find((o) => o.lineageId === lineageId);
      if (outcome === undefined) {
        missingEvidence.push(`target_outcome:${lineageId}:${round.roundOrdinal}`);
      }
    }
  }

  for (let index = 1; index < rounds.length; index += 1) {
    const previous = rounds[index - 1];
    const current = rounds[index];
    if (previous === undefined || current === undefined) continue;
    if (current.roundOrdinal !== previous.roundOrdinal + 1) {
      missingEvidence.push(
        `consecutive_round_ordinal:${previous.roundOrdinal}:${current.roundOrdinal}`,
      );
    }
    if (previous.comparisonSegmentId !== current.comparisonSegmentId) {
      missingEvidence.push(`consecutive_comparison_segment:${current.roundOrdinal}`);
    }
    if (previous.postRevisionDigest !== current.preRevisionDigest) {
      missingEvidence.push("consecutive_revision_link");
    }
  }

  if (missingEvidence.length > 0) {
    return Object.freeze({
      kind: "indeterminate",
      reason: "incomplete_or_unlinked_cycle_evidence",
      missingEvidence: Object.freeze(missingEvidence),
    });
  }

  return Object.freeze({
    kind: "verified",
    cycles: Object.freeze(rounds.map((round) => Object.freeze({ ...round }))),
  });
}

export type NonConvergenceKind =
  | "RESOLVED_LINEAGE_REGRESSED"
  | "SAME_LINEAGE_STALL"
  | "CONTRACT_CONFLICT_REPEATED"
  | "OSCILLATION"
  | "ROUND_LIMIT_EXHAUSTED"
  | "REVIEW_NON_CONVERGENT";

export type NonConvergenceEvaluationResult =
  | Readonly<{ readonly kind: "convergent" }>
  | Readonly<{ readonly kind: "non_convergent"; readonly primaryReason: NonConvergenceKind; readonly allReasons: readonly NonConvergenceKind[] }>
  | Readonly<{ readonly kind: "indeterminate"; readonly reason: string; readonly missingEvidence: readonly string[] }>;

const PHASE_ROUND_LIMIT: ReadonlyMap<ReviewGatePhase, number> = new Map([
  ["design", 4],
  ["plan", 2],
]);

export function evaluateNonConvergenceCycles(
  cycles: readonly VerifiedSemanticCycle[],
): NonConvergenceEvaluationResult {
  const missingEvidence: string[] = [];
  const reasons = new Set<NonConvergenceKind>();

  for (const cycle of cycles) {
    const expectedLineageIds = new Set(cycle.postBlockers.map((b) => b.lineageId));
    for (const lineageId of expectedLineageIds) {
      const outcome = cycle.targetOutcomes.find((o) => o.lineageId === lineageId);
      if (outcome === undefined) {
        missingEvidence.push(`target_outcome:${lineageId}:${cycle.roundOrdinal}`);
      }
    }
  }

  if (missingEvidence.length > 0) {
    return Object.freeze({
      kind: "indeterminate",
      reason: "incomplete_cycle_evidence",
      missingEvidence: Object.freeze(missingEvidence),
    });
  }

  const firstCycle = cycles[0];
  const limit = firstCycle === undefined ? undefined : PHASE_ROUND_LIMIT.get(firstCycle.context.phase);

  const committedResolutionEventIds = new Set<string>();
  for (const cycle of cycles) {
    for (const resolution of cycle.committedResolutions) {
      committedResolutionEventIds.add(resolution.resolutionEventId);
    }
    if (cycle.regressions.length > 0) {
      const hasCommittedResolution = cycle.regressions.some((regression) =>
        committedResolutionEventIds.has(regression.priorResolutionEventId)
      );
      if (hasCommittedResolution) {
        reasons.add("RESOLVED_LINEAGE_REGRESSED");
      }
    }

    if (limit !== undefined && cycle.roundOrdinal >= limit) {
      reasons.add("ROUND_LIMIT_EXHAUSTED");
    }
  }

  for (let index = 1; index < cycles.length; index += 1) {
    const previous = cycles[index - 1];
    const current = cycles[index];
    if (previous === undefined || current === undefined) continue;

    for (const currentOutcome of current.targetOutcomes) {
      if (currentOutcome.result !== "STILL_PRESENT") continue;
      const priorOutcome = previous.targetOutcomes.find(
        (o) => o.lineageId === currentOutcome.lineageId,
      );
      if (priorOutcome !== undefined && priorOutcome.result === "STILL_PRESENT") {
        reasons.add("SAME_LINEAGE_STALL");
      }
    }

    const previousContractSet = new Set(
      previous.postBlockers.map((b) => `${b.violatedContract}:${b.ownerScope}`),
    );
    for (const blocker of current.postBlockers) {
      const key = `${blocker.violatedContract}:${blocker.ownerScope}`;
      if (previousContractSet.has(key)) {
        reasons.add("CONTRACT_CONFLICT_REPEATED");
      }
    }
  }

  const fingerprints = cycles.map((cycle) => cycle.postFingerprint);
  for (let index = 2; index < fingerprints.length; index += 1) {
    if (
      fingerprints[index] === fingerprints[index - 2] &&
      fingerprints[index - 1] !== fingerprints[index - 2]
    ) {
      reasons.add("OSCILLATION");
    }
  }

  if (reasons.size > 0) {
    reasons.add("REVIEW_NON_CONVERGENT");
    const ordered: NonConvergenceKind[] = [
      "RESOLVED_LINEAGE_REGRESSED",
      "OSCILLATION",
      "SAME_LINEAGE_STALL",
      "CONTRACT_CONFLICT_REPEATED",
      "REVIEW_NON_CONVERGENT",
      "ROUND_LIMIT_EXHAUSTED",
    ];
    const allReasons = ordered.filter((reason) => reasons.has(reason));
    const primaryReason = allReasons[0] ?? "REVIEW_NON_CONVERGENT";
    return Object.freeze({
      kind: "non_convergent",
      primaryReason,
      allReasons: Object.freeze(allReasons),
    });
  }

  return Object.freeze({ kind: "convergent" });
}

export type SemanticContextTransitionDecision =
  | Readonly<{ readonly kind: "KEEP_CONTINUITY"; readonly phaseBaselineId: string; readonly comparisonSegmentId: string }>
  | Readonly<{ readonly kind: "PREPARE_INCOMPATIBLE_SEGMENT"; readonly phaseBaselineId: string; readonly comparisonSegmentId: string }>
  | Readonly<{ readonly kind: "BLOCK"; readonly reason: string }>;

export function computeSemanticContextInputsDigest(
  inputs: SemanticContextInputsV1,
): string {
  return computeCanonicalJsonFingerprint({
    workspaceIdentity: inputs.workspaceIdentity,
    gateId: inputs.gateId,
    generationId: inputs.generationId,
    phase: inputs.phase,
    phaseBaselineId: inputs.phaseBaselineId,
    comparisonSegmentId: inputs.comparisonSegmentId,
    requirements: inputs.requirements,
    upstreamApproved: inputs.upstreamApproved,
    policy: inputs.policy,
  });
}

function inputsAreCompatible(oldInputs: SemanticContextInputsV1, newInputs: SemanticContextInputsV1): boolean {
  return (
    oldInputs.gateId === newInputs.gateId &&
    oldInputs.generationId === newInputs.generationId &&
    oldInputs.phase === newInputs.phase &&
    oldInputs.workspaceIdentity === newInputs.workspaceIdentity
  );
}

export function planSemanticContextTransition(
  input: VerifiedSemanticContextTransitionInput,
): SemanticContextTransitionDecision {
  const { oldInputs, newInputs, proof, triggeringAuthorityEventId, roundCountersBefore, roundCountersAfter, operationId } = input;

  if (proof.validationEventId === triggeringAuthorityEventId) {
    return Object.freeze({ kind: "BLOCK", reason: "self_referential_proof" });
  }

  if (proof.triggeringAuthorityEventId !== triggeringAuthorityEventId) {
    return Object.freeze({ kind: "BLOCK", reason: "triggering_authority_mismatch" });
  }

  if (!inputsAreCompatible(oldInputs, newInputs)) {
    return Object.freeze({ kind: "BLOCK", reason: "incompatible_inputs" });
  }

  if (
    roundCountersBefore.design !== roundCountersAfter.design ||
    roundCountersBefore.plan !== roundCountersAfter.plan
  ) {
    return Object.freeze({ kind: "BLOCK", reason: "round_counter_changed" });
  }

  if (
    proof.validatorId !== SEMANTIC_CONTEXT_COMPATIBILITY_V1.validatorId ||
    proof.compatibilityTableDigest !== SEMANTIC_CONTEXT_COMPATIBILITY_TABLE_DIGEST ||
    proof.registryDigest !== SEMANTIC_CONTEXT_COMPATIBILITY_PROOF_REGISTRY_DIGEST ||
    proof.oldNormalizedInputsDigest !== computeSemanticGoverningProjectionDigest(oldInputs) ||
    proof.newNormalizedInputsDigest !== computeSemanticGoverningProjectionDigest(newInputs)
  ) {
    return Object.freeze({ kind: "BLOCK", reason: "proof_digest_mismatch" });
  }

  if (proof.result === "INDETERMINATE") {
    return Object.freeze({ kind: "BLOCK", reason: "indeterminate_compatibility" });
  }

  if (proof.result === "EQUIVALENT") {
    return Object.freeze({
      kind: "KEEP_CONTINUITY",
      phaseBaselineId: oldInputs.phaseBaselineId,
      comparisonSegmentId: oldInputs.comparisonSegmentId,
    });
  }

  if (proof.result === "INCOMPATIBLE") {
    return Object.freeze({
      kind: "PREPARE_INCOMPATIBLE_SEGMENT",
      phaseBaselineId: oldInputs.phaseBaselineId,
      comparisonSegmentId: `${oldInputs.comparisonSegmentId}:${operationId}`,
    });
  }

  return Object.freeze({ kind: "BLOCK", reason: "unsupported_proof_result" });
}
