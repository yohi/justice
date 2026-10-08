/**
 * Semantic finding lineage for the Review Gate: deterministic lineage
 * identity, validated-batch reconciliation, revalidation and resolution
 * commits, and cross-generation scope dispositions.
 *
 * Pure core: no I/O and no host imports beyond `node:crypto`. Every payload is
 * returned as a frozen snapshot, and every failure mode throws before any
 * event is composed so callers never observe a partial commit.
 */

import { createHash } from "node:crypto";
import type {
  ArtifactDigest,
  FindingDiscoveredV1,
  FindingId,
  FindingRemediatedV1,
  FindingReopenedV1,
  FindingSelfReviewedV1,
  FindingState,
  GateId,
  LineageId,
  RemediationRound,
  ReviewArtifactBinding,
  ReviewGateEvent,
  ReviewGatePhase,
  ReviewGateProjection,
  WriterId,
} from "./types.js";

export type FindingOwnerScope = "requirements" | "design" | "plan";
export type ReviewPhase = "design" | "plan";

export type ValidatedFinding = Readonly<{
  readonly candidateId: string;
  readonly existingLineageId: LineageId | null;
  readonly basisDigest: ArtifactDigest;
  readonly ownerScope: FindingOwnerScope;
  readonly observedPhase: ReviewPhase;
  readonly status: "new" | "existing_valid" | "existing_resolved" | "existing_regressed" | "invalid";
  readonly severity: "blocking" | "minor";
  readonly descriptionDigest: ArtifactDigest;
}>;

export type ValidatedFindingBatch = Readonly<{ readonly findings: readonly ValidatedFinding[] }>;

export type ProjectedLineage = Readonly<{
readonly lineageId: LineageId;
readonly ownerScope: FindingOwnerScope;
readonly observedPhase: ReviewPhase;
readonly status: "open" | "remediated" | "self_reviewed" | "reopened";
  readonly findingId: FindingId;
  readonly remediationRound: RemediationRound | null;
readonly regressionCount: number;
readonly alreadyResolvedObservationCount: number;
readonly lastStaleObservationRound: number | null;
}>;

export type FindingReconciliationCommitPayload = Readonly<{
  readonly events: readonly ReviewGateEvent[];
  readonly lineages: readonly LineageId[];
}>;

export type LineageRevalidationEvidence = Readonly<{
  readonly lineageId: LineageId;
  readonly result: "still_present" | "resolved" | "indeterminate";
  readonly verifiedCommitBinding?: ReviewArtifactBinding;
}>;

export type LineageRevalidationCommitPayload = Readonly<{
  readonly events: readonly ReviewGateEvent[];
}>;

export type ResolutionCommitInput = Readonly<{
  readonly lineageId: LineageId;
  readonly resolutionKind: "lineage_resolution_committed" | "external_change_revalidation";
  readonly verifiedCommitBinding?: ReviewArtifactBinding;
}>;

export type LineageResolutionCommitPayload = Readonly<{
  readonly events: readonly ReviewGateEvent[];
}>;

export type ScopeDisposition = Readonly<{
  readonly kind: "remediate" | "no_action" | "validator_conflict";
  readonly lineageIds: readonly LineageId[];
}>;

/** Deterministic lineage-identity namespace, versioned for replay safety. */
const LINEAGE_ID_CONTEXT = "justice-lineage-v1";

/**
 * Envelope for gate-owned lineage commit events. The pure core cannot read a
 * wall clock, so every emitted `emittedAt` reuses the current epoch's start
 * timestamp and `writerId` is a fixed gate identity; persistence layers can
 * re-stamp the real delivery time when appending the event to a history.
 */
const GATE_EVENT_WRITER_ID = "justice-review-gate" as WriterId;

/**
 * `observedPhase` values accepted per current gate phase. The policy includes
 * a requirements-stage observation inside both gate phases; the current
 * `ValidatedFinding` contract narrows observations to the gate phases, so the
 * wider breadth is enforced defensively as a string-level policy.
 */
const ALLOWED_OBSERVED_PHASES: ReadonlyMap<ReviewGatePhase, ReadonlySet<string>> = new Map([
  ["design", new Set(["design", "requirements"])],
  ["plan", new Set(["plan", "design", "requirements"])],
]);

/** Owner-scope depth order for OSC1 precedence: requirements < design < plan. */
const OWNER_SCOPE_DEPTH: ReadonlyMap<FindingOwnerScope, number> = new Map([
  ["requirements", 0],
  ["design", 1],
  ["plan", 2],
]);

const PHASE_DEPTH: ReadonlyMap<ReviewPhase, number> = new Map([
  ["design", 1],
  ["plan", 2],
]);

type IssuedLineageId = Readonly<{ readonly id: LineageId; readonly counter: number }>;

type FindingReconciliationPlan =
  | Readonly<{ readonly kind: "skip" }>
  | Readonly<{ readonly kind: "discover" }>
  | Readonly<{
      readonly kind: "reopen";
      readonly lineageId: LineageId;
      readonly findingId: FindingId;
    }>;

/**
 * Deterministic new lineage identity:
 * `sha256("justice-lineage-v1\0" + gateId + "\0" + ownerScope + "\0" + counter)`
 * seeded with the current finding count plus one, and stepped forward past
 * any (astronomically unlikely) collision with an already-tracked lineage.
 */
export function issueNextLineageId(
  projection: ReviewGateProjection,
  ownerScope: FindingOwnerScope,
): LineageId {
  return issueUniqueLineageId(
    projection.gateId,
    ownerScope,
    projection.findings.size + 1,
    new Set(projection.findings.keys()),
  ).id;
}

function issueUniqueLineageId(
  gateId: GateId,
  ownerScope: FindingOwnerScope,
  startCounter: number,
  taken: ReadonlySet<LineageId>,
): IssuedLineageId {
  let counter = startCounter;
  for (;;) {
    const candidate = computeLineageId(gateId, ownerScope, counter);
    if (!taken.has(candidate)) {
      return Object.freeze({ id: candidate, counter });
    }
    counter += 1;
  }
}

function computeLineageId(gateId: GateId, ownerScope: FindingOwnerScope, counter: number): LineageId {
  return createHash("sha256")
    .update(`${LINEAGE_ID_CONTEXT}\0${gateId}\0${ownerScope}\0${counter}`)
    .digest("hex") as LineageId;
}

/**
 * Project tracked findings into lineage view. Regression counts, resolution
 * observations, and stale-observation rounds live behind a lineage-store seam
 * that a later task owns; until that seam lands they are stubbed at zero/null.
 */
export function projectLineages(projection: ReviewGateProjection): readonly ProjectedLineage[] {
  const lineages: ProjectedLineage[] = [];
  for (const finding of projection.findings.values()) {
    lineages.push(Object.freeze({
      lineageId: finding.lineageId,
      ownerScope: finding.ownerScope,
      observedPhase: finding.observedPhase,
      status: finding.status,
      findingId: finding.findingId,
      remediationRound: finding.remediationRound,
      regressionCount: 0,
      alreadyResolvedObservationCount: 0,
      lastStaleObservationRound: null,
    }));
  }
  return Object.freeze(lineages);
}

/**
 * Reconcile a validated finding batch against the current projection.
 *
 * Validation order, all before any event is composed (no partial payload):
 * 1. observed-phase policy, applied to every raw finding in the batch,
 * 2. `candidateId` deduplication — identical duplicates collapse to one
 *    entry, divergent duplicates conflict (one candidate maps to one lineage),
 * 3. per-finding status conflicts.
 *
 * Per-finding outcomes:
 * - `invalid` or `minor` severity produce no event,
 * - `new` produces `FINDING_DISCOVERED` with a freshly issued lineage,
 * - `existing_valid` on a tracked lineage produces no event (already tracked),
 * - `existing_resolved` produces no event either: its diagnostic observation
 *   only feeds the lineage-store counters seam, which stays stubbed this task
 *   (see `projectLineages`),
 * - `existing_regressed` produces `FINDING_REOPENED` on the same lineage with
 *   the current epoch.
 */
export function reconcileFindingBatch(
  projection: ReviewGateProjection,
  evidence: ValidatedFindingBatch,
): FindingReconciliationCommitPayload {
  const allowedObservedPhases = getAllowedObservedPhases(projection.phase);
  for (const finding of evidence.findings) {
    if (!allowedObservedPhases.has(finding.observedPhase)) {
      throw new Error("validator_result_conflict");
    }
  }

  const deduped = deduplicateByCandidateId(evidence.findings);

  const events: ReviewGateEvent[] = [];
  const lineages: LineageId[] = [];
  let nextCounter = projection.findings.size + 1;
  const issued = new Set<LineageId>();

  for (const finding of deduped) {
    const plan = planFindingReconciliation(projection, finding);
    if (plan.kind === "skip") continue;
    if (plan.kind === "discover") {
      const issuedId = issueUniqueLineageId(
        projection.gateId,
        finding.ownerScope,
        nextCounter,
        new Set([...projection.findings.keys(), ...issued]),
      );
      issued.add(issuedId.id);
      nextCounter = issuedId.counter + 1;
      lineages.push(issuedId.id);
      const event: FindingDiscoveredV1 = {
        eventType: "FINDING_DISCOVERED",
        gateId: projection.gateId,
        writerId: GATE_EVENT_WRITER_ID,
        epochId: projection.epoch.epochId,
        emittedAt: projection.epoch.startedAt,
        payload: {
          lineageId: issuedId.id,
          findingId: finding.candidateId as FindingId,
          observedPhase: finding.observedPhase,
          ownerScope: finding.ownerScope,
          descriptionDigest: finding.descriptionDigest,
        },
      };
      events.push(event);
      continue;
    }
    lineages.push(plan.lineageId);
    const event: FindingReopenedV1 = {
      eventType: "FINDING_REOPENED",
      gateId: projection.gateId,
      writerId: GATE_EVENT_WRITER_ID,
      epochId: projection.epoch.epochId,
      emittedAt: projection.epoch.startedAt,
      payload: {
        lineageId: plan.lineageId,
        findingId: plan.findingId,
        reopenedBy: projection.epoch.epochId,
      },
    };
    events.push(event);
  }
  return Object.freeze({
    events: Object.freeze(events),
    lineages: Object.freeze(lineages),
  });
}

/**
 * Decide what a single validated finding produces, throwing every conflict
 * before any emission. Enforced conflicts mirror the brief verbatim; the
 * uniform `existing_*` lineage-reference requirement (must point at a tracked
 * lineage) keeps every emitted event replayable by the projection reducer.
 */
function planFindingReconciliation(
  projection: ReviewGateProjection,
  finding: ValidatedFinding,
): FindingReconciliationPlan {
  if (finding.status === "invalid" || finding.severity === "minor") {
    return { kind: "skip" };
  }
  if (finding.status === "new") {
    if (finding.existingLineageId !== null) {
      throw new Error("validator_result_conflict");
    }
    return { kind: "discover" };
  }
  if (finding.status === "existing_resolved" && finding.severity === "blocking") {
    // EXISTING+RESOLVED must be defect-absent; blocking contradicts that.
    throw new Error("validator_result_conflict");
  }
  if (finding.existingLineageId === null) {
    // Every remaining status is existing_* and must reference a tracked lineage.
    throw new Error("validator_result_conflict");
  }
  const tracked = projection.findings.get(finding.existingLineageId);
  if (tracked === undefined) {
    throw new Error("validator_result_conflict");
  }
  if (finding.status === "existing_regressed") {
    return { kind: "reopen", lineageId: finding.existingLineageId, findingId: tracked.findingId };
  }
  // existing_valid: already tracked. Claiming validity on a remediated or
  // self-reviewed lineage is not this commit's concern — the revalidation
  // seam (`commitLineageRevalidation`) is where that divergence is observed.
  return { kind: "skip" };
}

function deduplicateByCandidateId(findings: readonly ValidatedFinding[]): readonly ValidatedFinding[] {
  const seen = new Map<string, ValidatedFinding>();
  const deduped: ValidatedFinding[] = [];
  for (const finding of findings) {
    const tracked = seen.get(finding.candidateId);
    if (tracked === undefined) {
      seen.set(finding.candidateId, finding);
      deduped.push(finding);
      continue;
    }
    if (!sameValidatedFinding(tracked, finding)) {
      throw new Error("validator_result_conflict");
    }
  }
  return deduped;
}

function sameValidatedFinding(left: ValidatedFinding, right: ValidatedFinding): boolean {
  return (
    left.candidateId === right.candidateId &&
    left.existingLineageId === right.existingLineageId &&
    left.basisDigest === right.basisDigest &&
    left.ownerScope === right.ownerScope &&
    left.observedPhase === right.observedPhase &&
    left.status === right.status &&
    left.severity === right.severity &&
    left.descriptionDigest === right.descriptionDigest
  );
}


/**
 * Commit a lineage revalidation observation. `resolved` requires a verified
 * commit binding and emits `FINDING_SELF_REVIEWED` on the current epoch with
 * the tracked remediation round; `still_present` emits nothing (the lineage is
 * already tracked); `indeterminate` blocks the clear by throwing so the
 * caller can suspend the gate.
 */
export function commitLineageRevalidation(
  projection: ReviewGateProjection,
  evidence: LineageRevalidationEvidence,
): LineageRevalidationCommitPayload {
  const tracked = requireTrackedFinding(projection, evidence.lineageId);
  if (evidence.result === "still_present") {
    return Object.freeze({ events: Object.freeze([]) });
  }
  if (evidence.result === "indeterminate") {
    throw new Error("indeterminate_revalidation_blocks_clear");
  }
  if (evidence.verifiedCommitBinding === undefined) {
    throw new Error("revalidation_requires_binding");
  }
  const event: FindingSelfReviewedV1 = {
    eventType: "FINDING_SELF_REVIEWED",
    gateId: projection.gateId,
    writerId: GATE_EVENT_WRITER_ID,
    epochId: projection.epoch.epochId,
    emittedAt: projection.epoch.startedAt,
    payload: {
      lineageId: evidence.lineageId,
      findingId: tracked.findingId,
      remediationRound: requireRemediationRound(tracked),
    },
  };
  const events: ReviewGateEvent[] = [event];
  return Object.freeze({ events: Object.freeze(events) });
}

/**
 * Commit a lineage resolution. `lineage_resolution_committed` emits
 * `FINDING_REMEDIATED` on the current epoch with the next remediation round;
 * `external_change_revalidation` requires a verified commit binding and emits
 * `FINDING_SELF_REVIEWED`.
 */
export function buildLineageResolution(
  projection: ReviewGateProjection,
  input: ResolutionCommitInput,
): LineageResolutionCommitPayload {
  const tracked = requireTrackedFinding(projection, input.lineageId);
  if (input.resolutionKind === "lineage_resolution_committed") {
    const event: FindingRemediatedV1 = {
      eventType: "FINDING_REMEDIATED",
      gateId: projection.gateId,
      writerId: GATE_EVENT_WRITER_ID,
      epochId: projection.epoch.epochId,
      emittedAt: projection.epoch.startedAt,
      payload: {
        lineageId: input.lineageId,
        findingId: tracked.findingId,
        remediationRound: nextRemediationRound(projection),
      },
    };
    const events: ReviewGateEvent[] = [event];
    return Object.freeze({ events: Object.freeze(events) });
  }
  if (input.verifiedCommitBinding === undefined) {
    throw new Error("external_change_requires_binding");
  }
  const event: FindingSelfReviewedV1 = {
    eventType: "FINDING_SELF_REVIEWED",
    gateId: projection.gateId,
    writerId: GATE_EVENT_WRITER_ID,
    epochId: projection.epoch.epochId,
    emittedAt: projection.epoch.startedAt,
    payload: {
      lineageId: input.lineageId,
      findingId: tracked.findingId,
      remediationRound: requireRemediationRound(tracked),
    },
  };
  const events: ReviewGateEvent[] = [event];
  return Object.freeze({ events: Object.freeze(events) });
}

/**
 * Classify the scope disposition for a set of projected lineages. Open and
 * reopened lineages are the blocking population here (minor-severity findings
 * never reach this classifier because the reconciliation filters them out).
 * Findings whose owner scope is upstream of the gate phase must have been
 * resolved before this call, so they surface as a `validator_conflict` first;
 * otherwise remaining blocking lineages request `remediate`.
 */
export function selectFindingDisposition(
  phase: ReviewPhase,
  lineages: readonly ProjectedLineage[],
): ScopeDisposition {
  const phaseDepth = getPhaseDepth(phase);
  const remediating: LineageId[] = [];
  const upstream: LineageId[] = [];
  for (const lineage of lineages) {
    if (lineage.status !== "open" && lineage.status !== "reopened") continue;
    if (getOwnerScopeDepth(lineage.ownerScope) < phaseDepth) {
      upstream.push(lineage.lineageId);
      continue;
    }
    remediating.push(lineage.lineageId);
  }
  if (upstream.length > 0) {
    return Object.freeze({ kind: "validator_conflict", lineageIds: Object.freeze(upstream) });
  }
  if (remediating.length > 0) {
    return Object.freeze({ kind: "remediate", lineageIds: Object.freeze(remediating) });
  }
  return Object.freeze({ kind: "no_action", lineageIds: Object.freeze([]) });
}

function requireTrackedFinding(
  projection: ReviewGateProjection,
  lineageId: LineageId,
): FindingState {
  const tracked = projection.findings.get(lineageId);
  if (tracked === undefined) {
    throw new Error("unknown_lineage");
  }
  return tracked;
}

function requireRemediationRound(tracked: FindingState): RemediationRound {
  if (tracked.remediationRound === null) {
    throw new Error("lineage_revalidation_requires_remediation_round");
  }
  return tracked.remediationRound;
}

/**
 * Next remediation round for the projection's current phase: one past the
 * highest ordinal already recorded for that phase (1 when none). The
 * projection reducer de-duplicates rounds by (phase, ordinal), so a
 * gate-phase-scoped counter keeps every emitted round unique within the phase.
 */
function nextRemediationRound(projection: ReviewGateProjection): RemediationRound {
  const rounds =
    projection.phase === "design"
      ? projection.designRemediationRounds
      : projection.planRemediationRounds;
  let maxOrdinal = 0;
  for (const round of rounds) {
    if (round.ordinal > maxOrdinal) maxOrdinal = round.ordinal;
  }
  return Object.freeze({ phase: projection.phase, ordinal: maxOrdinal + 1 });
}

function getAllowedObservedPhases(phase: ReviewGatePhase): ReadonlySet<string> {
  const allowed = ALLOWED_OBSERVED_PHASES.get(phase);
  if (allowed === undefined) {
    throw new Error("review_gate_unexpected_scope_or_phase");
  }
  return allowed;
}

function getPhaseDepth(phase: ReviewPhase): number {
  const depth = PHASE_DEPTH.get(phase);
  if (depth === undefined) {
    throw new Error("review_gate_unexpected_scope_or_phase");
  }
  return depth;
}

function getOwnerScopeDepth(scope: FindingOwnerScope): number {
  const depth = OWNER_SCOPE_DEPTH.get(scope);
  if (depth === undefined) {
    throw new Error("review_gate_unexpected_scope_or_phase");
  }
  return depth;
}
