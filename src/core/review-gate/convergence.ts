import { createHash } from "node:crypto";
import type {
  CurrentPhaseDisposition,
  FindingState,
  LineageId,
  RemediationRound,
  ReviewGatePhase,
  ReviewGateProjection,
} from "./types.js";
import { computeCanonicalJsonFingerprint } from "./identity.js";
import type { ProjectedLineage } from "./lineage.js";

export type NonConvergenceKind =
  | "resolved_lineage_regressed"
  | "remediation_oscillation"
  | "same_lineage_stall"
  | "contract_conflict_repeated"
  | "blocker_landscape_repeated"
  | "blocker_count_not_improving";

export type NonConvergenceDecision =
  | Readonly<{ readonly kind: "convergent" }>
  | Readonly<{
      readonly kind: "non_convergent";
      readonly trigger: NonConvergenceKind;
      readonly lineageIds: readonly LineageId[];
    }>;

export type RemediationCapacity = Readonly<{
  readonly remainingDesignRounds: number;
  readonly remainingPlanRounds: number;
}>;

export type ReviewNonConvergentPayload = Readonly<{
  readonly phase: ReviewGatePhase;
  readonly lineageIds: ReadonlyArray<LineageId>;
}>;

/**
 * Stable sha256 fingerprint of the currently blocking (open/reopened) lineage
 * set. Counter and round values never affect it.
 */
export function computeBlockerLandscapeFingerprint(
  lineages: readonly ProjectedLineage[],
): string {
  const hash = createHash("sha256");
  for (const lineage of blocking(lineages).sort(byLineageId)) {
    hash.update(
      `${lineage.lineageId}\0${lineage.ownerScope}\0${lineage.observedPhase}\0`,
    );
  }
  return hash.digest("hex");
}

/**
 * Stable canonical-JSON fingerprint of the full lineage set, including status,
 * owner scope, observed phase, and remediation round ordinal when present.
 */
export function computeConvergenceFingerprint(
  lineages: readonly ProjectedLineage[],
): string {
  const descriptor = [...lineages]
    .sort(byLineageId)
    .map((lineage) => ({
      lineageId: lineage.lineageId,
      status: lineage.status,
      ownerScope: lineage.ownerScope,
      observedPhase: lineage.observedPhase,
      remediationRoundOrdinal: lineage.remediationRound?.ordinal ?? null,
    }));
  return computeCanonicalJsonFingerprint(descriptor);
}

export function computeRemediationCapacity(
  projection: ReviewGateProjection,
): RemediationCapacity {
  return Object.freeze({
    remainingDesignRounds: remainingRounds(
      projection.designRemediationRounds,
      5,
    ),
    remainingPlanRounds: remainingRounds(projection.planRemediationRounds, 3),
  });
}

export function evaluateNonConvergence(
  projection: ReviewGateProjection,
): NonConvergenceDecision {
  const lineages = deriveConvergenceLineages(projection);
  const blockers = blocking(lineages);

  const regressed = blockers
    .filter((lineage) => lineage.regressionCount > 0)
    .map((lineage) => lineage.lineageId);
  if (regressed.length > 0) {
    return freezeDecision("resolved_lineage_regressed", regressed);
  }

  const oscillating = blockers
    .filter(
      (lineage) =>
        lineage.status === "reopened" &&
        lineage.remediationRound !== null &&
        !isLastPhaseRound(projection, lineage.remediationRound),
    )
    .map((lineage) => lineage.lineageId);
  if (oscillating.length > 0) {
    return freezeDecision("remediation_oscillation", oscillating);
  }

const stalled = blockers.filter((lineage) =>
    isInLastTwoPhaseRounds(projection, lineage) && lineage.status !== "reopened",
  );
  if (stalled.length > 0) {
    return freezeDecision(
      "same_lineage_stall",
      stalled.map((lineage) => lineage.lineageId),
    );
  }

  const repeatedConflict = blockers
    .filter((lineage) => lineage.alreadyResolvedObservationCount > 0)
    .map((lineage) => lineage.lineageId);
  if (repeatedConflict.length > 0) {
    return freezeDecision("contract_conflict_repeated", repeatedConflict);
  }

  const previousRound = previousPhaseRound(projection);
  if (previousRound !== null) {
    const currentFingerprint = computeBlockerLandscapeFingerprint(blockers);
    const previousFingerprint = blockerFingerprintForRound(
      projection,
      previousRound,
    );
    if (currentFingerprint === previousFingerprint && blockers.length > 0) {
      return freezeDecision(
        "blocker_landscape_repeated",
        blockerLineageIds(blockers),
      );
    }
    const previousCount = blockerCountForRound(projection, previousRound);
    if (
      previousCount > 0 &&
      blockers.length >= previousCount &&
      currentFingerprint !== previousFingerprint
    ) {
      return freezeDecision(
        "blocker_count_not_improving",
        blockerLineageIds(blockers),
      );
    }
  }

  return Object.freeze({ kind: "convergent" });
}


export function decideCurrentPhaseRemediationDisposition(
  projection: ReviewGateProjection,
  decision: NonConvergenceDecision,
): CurrentPhaseDisposition {
  if (decision.kind === "non_convergent") {
    const payload: ReviewNonConvergentPayload = Object.freeze({
      phase: projection.phase,
      lineageIds: decision.lineageIds,
    });
    return Object.freeze({ kind: "non_convergent", payload });
  }

  const capacity = computeRemediationCapacity(projection);
  const remaining =
    projection.phase === "design"
      ? capacity.remainingDesignRounds
      : capacity.remainingPlanRounds;
  if (remaining === 0) {
    return Object.freeze({ kind: "round_limit" });
  }
  return Object.freeze({ kind: "remediate" });
}

function deriveConvergenceLineages(
  projection: ReviewGateProjection,
): readonly ProjectedLineage[] {
  const lineages: ProjectedLineage[] = [];
  for (const finding of projection.findings.values()) {
    lineages.push(
      Object.freeze({
        lineageId: finding.lineageId,
        ownerScope: finding.ownerScope,
        observedPhase: finding.observedPhase as ProjectedLineage["observedPhase"],
        status: finding.status,
        findingId: finding.findingId,
        remediationRound: finding.remediationRound,
        regressionCount: readSeamCount(finding, "regressionCount"),
        alreadyResolvedObservationCount: readSeamCount(
          finding,
          "alreadyResolvedObservationCount",
        ),
        lastStaleObservationRound: null,
      }),
    );
  }
  return Object.freeze(lineages);
}

type FindingStateWithSeamCounters = Readonly<{
  regressionCount?: number;
  alreadyResolvedObservationCount?: number;
}>;

function readSeamCount(
  finding: FindingState,
  key: "regressionCount" | "alreadyResolvedObservationCount",
): number {
  const extended = (finding as unknown) as FindingStateWithSeamCounters;
  const value = key === "regressionCount" ? extended.regressionCount : extended.alreadyResolvedObservationCount;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function blocking(lineages: readonly ProjectedLineage[]): ProjectedLineage[] {
  return [...lineages].filter(
    (lineage) => lineage.status === "open" || lineage.status === "reopened",
  );
}

function byLineageId(
  left: ProjectedLineage,
  right: ProjectedLineage,
): number {
  return left.lineageId < right.lineageId
    ? -1
    : left.lineageId > right.lineageId
      ? 1
      : 0;
}

function freezeDecision(
  trigger: NonConvergenceKind,
  lineageIds: LineageId[],
): NonConvergenceDecision {
  return Object.freeze({
    kind: "non_convergent",
    trigger,
    lineageIds: Object.freeze([...lineageIds].sort()),
  });
}

function phaseRounds(
  projection: ReviewGateProjection,
): readonly RemediationRound[] {
  return projection.phase === "design"
    ? projection.designRemediationRounds
    : projection.planRemediationRounds;
}

function distinctRoundOrdinals(
  rounds: readonly RemediationRound[],
): readonly number[] {
  return [...new Set(rounds.map((round) => round.ordinal))].sort(
    (a, b) => a - b,
  );
}

function previousPhaseRound(
  projection: ReviewGateProjection,
): number | null {
  const ordinals = distinctRoundOrdinals(phaseRounds(projection));
  return ordinals.length >= 2 ? ordinals.at(-2) ?? null : null;
}

function isLastPhaseRound(
  projection: ReviewGateProjection,
  round: RemediationRound,
): boolean {
  const ordinals = distinctRoundOrdinals(phaseRounds(projection));
  const last = ordinals.at(-1);
  return round.phase === projection.phase && round.ordinal === last;
}

function isInLastTwoPhaseRounds(
  projection: ReviewGateProjection,
  lineage: ProjectedLineage,
): boolean {
  const round = lineage.remediationRound;
  if (round === null || round.phase !== projection.phase) return false;
  const ordinals = distinctRoundOrdinals(phaseRounds(projection));
  if (ordinals.length < 2) return false;
  const lastTwo = new Set(ordinals.slice(-2));
  return lastTwo.has(round.ordinal);
}

function blockerFingerprintForRound(
  projection: ReviewGateProjection,
  roundOrdinal: number,
): string {
  const previousLineages: ProjectedLineage[] = [];
  for (const finding of projection.findings.values()) {
    const round = finding.remediationRound;
    const wasOpenAtPreviousRound =
      (finding.status === "open" && round === null) ||
      (round !== null &&
        round.phase === projection.phase &&
        round.ordinal <= roundOrdinal &&
        (finding.status === "reopened" || finding.status === "open"));
    if (wasOpenAtPreviousRound) {
      previousLineages.push(
        Object.freeze({
          lineageId: finding.lineageId,
          ownerScope: finding.ownerScope,
          observedPhase: finding.observedPhase,
          status: finding.status,
          findingId: finding.findingId,
          remediationRound: finding.remediationRound,
          regressionCount: 0,
          alreadyResolvedObservationCount: 0,
          lastStaleObservationRound: null,
        }),
      );
    }
  }
  return computeBlockerLandscapeFingerprint(previousLineages);
}

function blockerCountForRound(
  projection: ReviewGateProjection,
  roundOrdinal: number,
): number {
  let count = 0;
  for (const finding of projection.findings.values()) {
    const round = finding.remediationRound;
    const wasOpenAtPreviousRound =
      (finding.status === "open" && round === null) ||
      (round !== null &&
        round.phase === projection.phase &&
        round.ordinal <= roundOrdinal &&
        (finding.status === "reopened" || finding.status === "open"));
    if (wasOpenAtPreviousRound) {
      count += 1;
    }
  }
  return count;
}

function blockerLineageIds(lineages: readonly ProjectedLineage[]): LineageId[] {
  return lineages.map((lineage) => lineage.lineageId).sort();
}

function remainingRounds(
  rounds: readonly RemediationRound[],
  limit: number,
): number {
  return Math.max(0, limit - distinctRoundOrdinals(rounds).length);
}
