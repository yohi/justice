import type { ApprovedPlanBinding, AuthorizationReviewBoundary } from "./plan-authorization";
import type { FullEvidenceRef, ReviewCorrelation, TaskExecutionRef } from "./types";
import type { GateContext, GatePendingAttemptContext } from "./v2/gate-context";
import type {
  AcceptanceDecision,
  AcceptanceDecisionPayload,
  GateDecision,
  GateDecisionPayload,
  HistoricalTaskAcceptanceDecision,
  HistoricalTaskGateDecision,
  LegacyTaskGateDecision,
  PendingDecisionRecord,
} from "./v2/decision-model";
import { orderEventsForProjection } from "./v2/integrity";
import { hashString } from "./v2/hash";
import type { ObservationRecord, PersistedLogRecord } from "./v2/observation-model";
import type {
  PlanFinalizationTransitionInput,
  TaskLifecycleTransitionInput,
} from "./task-lifecycle";
import {
  project,
  projectCompletedReviewCallHistory,
  projectImplementationCallBindings,
  taskLifecycleKey,
  type ProjectedEvidence,
  type ProjectedState,
} from "./v2/state-projection";
import { aggregateAdmittedReviews } from "./v2/review-aggregator";
import type { ReviewSummary } from "./v2/review-types";
import { toEvidenceArray } from "./v2/evidence-list";

type SkipGateEvaluation = { readonly verdict: "SKIP"; readonly reason: string };
type GateRuleEvaluation =
  | GateDecisionPayload
  | SkipGateEvaluation
  | { readonly kind: "insufficient_evidence"; readonly reason: string };

/**
 * F-002 Gate Evaluation wiring: Rules receive only admitted inputs. `projected` is
 * for lifecycle/reference lookups only and must not be read for evidence or the
 * diagnostic global review summary.
 */
export type EvaluateRulesInput = {
  readonly context: GateContext;
  readonly projected: ProjectedState;
  readonly admittedExecutionEvidence: readonly ProjectedEvidence[];
  readonly admittedReviewSummary: ReviewSummary;
};

export type GateEvaluationDependencies = {
  readonly readDurableRecords: () => Promise<readonly PersistedLogRecord[]>;
  readonly appendDecision: (
    record: PendingDecisionRecord,
  ) => Promise<{ readonly kind: "committed" | "failed" }>;
  readonly findAuthorizationById: (authorizationId: string) => Promise<ApprovedPlanBinding | null>;
  readonly withAuthorizationReviewBoundary: AuthorizationReviewBoundary["withParentSession"];
  readonly appendTaskLifecycleTransition: (
    input: TaskLifecycleTransitionInput,
  ) => Promise<{ readonly kind: "committed" | "failed" }>;
  readonly appendPlanFinalizationTransition: (
    input: PlanFinalizationTransitionInput,
  ) => Promise<{ readonly kind: "committed" | "failed" }>;
  readonly evaluateRules: (input: EvaluateRulesInput) => Promise<GateRuleEvaluation>;
  readonly recordAdvisory: (advisory: string) => Promise<void>;
};

export type GateDecisionLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "found"; readonly decision: GateDecision }
  | {
      readonly kind: "conflict";
      readonly advisory:
        | "multiple current GateDecision records"
        | "historic roundless GateDecision record";
    };
export type AcceptanceDecisionLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "found"; readonly decision: AcceptanceDecision }
  | {
      readonly kind: "conflict";
      readonly advisory:
        | "multiple current AcceptanceDecision records"
        | "historic roundless AcceptanceDecision record";
    };

export type GatePendingAttemptResult =
  | { readonly kind: "not_applicable" }
  | { readonly kind: "decided"; readonly decision: GateDecisionPayload }
  | { readonly kind: "blocked"; readonly advisory: string };

export function authorizationIdFor(correlation: ReviewCorrelation): string {
  return correlation.reviewKind === "task-review"
    ? correlation.taskExecutionRef.authorizationId
    : correlation.authorizationId;
}

export async function isCurrentActiveAuthorization(
  correlation: ReviewCorrelation,
  findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"],
): Promise<boolean> {
  try {
    const binding = await findAuthorizationById(authorizationIdFor(correlation));
    if (binding === null || binding.status !== "active") return false;
    if (correlation.reviewKind === "task-review") {
      return binding.canonicalSnapshot.tasks.some(
        (task) => task.taskId === correlation.taskExecutionRef.taskId,
      );
    }
    return (
      binding.planPath === correlation.planPath &&
      samePlanFingerprint(binding.planFingerprint, correlation.planFingerprint)
    );
  } catch {
    return false;
  }
}

function samePlanFingerprint(
  left: { readonly algorithm: string; readonly value: string },
  right: { readonly algorithm: string; readonly value: string },
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function sameTask(left: TaskExecutionRef, right: TaskExecutionRef): boolean {
  return (
    left.authorizationId === right.authorizationId &&
    left.taskId === right.taskId &&
    left.attemptId === right.attemptId
  );
}

function samePlanPath(
  recordPath: string,
  recordDigest: string | undefined,
  correlationPath: string,
): boolean {
  return recordDigest === undefined
    ? recordPath === correlationPath
    : recordDigest === hashString(correlationPath);
}

/**
 * F-003: Task decisions match only the exact TaskExecutionRef and proven review
 * round; Final decisions match the full Final identity (existing finalReviewRound).
 */
function correlationMatchesGate(
  record: GateDecisionPayload,
  correlation: ReviewCorrelation,
): boolean {
  return correlation.reviewKind === "task-review"
    ? record.gateType === "task" &&
        record.taskId === record.taskExecutionRef.taskId &&
        sameTask(record.taskExecutionRef, correlation.taskExecutionRef) &&
        record.reviewRound === correlation.reviewRound
    : record.gateType === "plan" &&
        record.authorizationId === correlation.authorizationId &&
        samePlanPath(record.planPath, record.planPathDigest, correlation.planPath) &&
        record.finalizationAttemptId === correlation.finalizationAttemptId &&
        record.finalReviewRound === correlation.finalReviewRound;
}

function correlationMatchesAcceptance(
  record: AcceptanceDecision,
  correlation: ReviewCorrelation,
): boolean {
  return correlation.reviewKind === "task-review"
    ? record.kind === "task-acceptance" &&
        sameTask(record.taskExecutionRef, correlation.taskExecutionRef) &&
        record.reviewRound === correlation.reviewRound
    : record.kind === "plan-acceptance" &&
        record.authorizationId === correlation.authorizationId &&
        samePlanPath(record.planPath, record.planPathDigest, correlation.planPath) &&
        record.finalizationAttemptId === correlation.finalizationAttemptId &&
        record.finalReviewRound === correlation.finalReviewRound;
}

/** Current-round GateDecision: Plan, or Task with TaskExecutionRef and a review round. */
function isAuthoritativeGate(record: PersistedLogRecord): record is GateDecision {
  return (
    record.recordType === "decision" &&
    "gateType" in record &&
    (record.gateType === "plan" ||
      ("taskExecutionRef" in record &&
        record.taskExecutionRef !== undefined &&
        typeof record.reviewRound === "number"))
  );
}

/** Pre-F-003 Task Gate with TaskExecutionRef but no review round (read-only). */
function isHistoricalTaskGateDecisionRecord(
  record: PersistedLogRecord,
): record is HistoricalTaskGateDecision {
  return (
    record.recordType === "decision" &&
    "gateType" in record &&
    record.gateType === "task" &&
    "taskExecutionRef" in record &&
    record.taskExecutionRef !== undefined &&
    record.reviewRound === undefined
  );
}

/** Pre-F-003 Task Acceptance without a review round (read-only). */
function isHistoricalTaskAcceptanceDecisionRecord(
  record: PersistedLogRecord,
): record is HistoricalTaskAcceptanceDecision {
  return (
    record.recordType === "decision" &&
    "kind" in record &&
    record.kind === "task-acceptance" &&
    record.reviewRound === undefined
  );
}

export function isLegacyTaskGateDecisionRecord(
  record: PersistedLogRecord,
): record is LegacyTaskGateDecision {
  return (
    record.recordType === "decision" &&
    "gateType" in record &&
    record.gateType === "task" &&
    !("taskExecutionRef" in record)
  );
}

function isAcceptance(record: PersistedLogRecord): record is AcceptanceDecision {
  return (
    record.recordType === "decision" &&
    "kind" in record &&
    ((record.kind === "task-acceptance" && typeof record.reviewRound === "number") ||
      record.kind === "plan-acceptance")
  );
}

/**
 * F-003 Lookup: requires TaskExecutionRef and review round to match. A historic
 * roundless Task decision for the current attempt is never treated as missing
 * (which would let a new PASS be written beside it): it is a conflict.
 */
export function findCurrentGateDecision(
  records: readonly PersistedLogRecord[],
  correlation: ReviewCorrelation,
): GateDecisionLookup {
  if (
    correlation.reviewKind === "task-review" &&
    records.some(
      (record) =>
        isHistoricalTaskGateDecisionRecord(record) &&
        sameTask(record.taskExecutionRef, correlation.taskExecutionRef),
    )
  )
    return { kind: "conflict", advisory: "historic roundless GateDecision record" };
  const matches = orderEventsForProjection(records)
    .filter(isAuthoritativeGate)
    .filter((record) => correlationMatchesGate(record, correlation));
  if (matches.length > 1)
    return { kind: "conflict", advisory: "multiple current GateDecision records" };
  const decision = matches[0];
  return decision === undefined ? { kind: "missing" } : { kind: "found", decision };
}

export function findCurrentAcceptanceDecision(
  records: readonly PersistedLogRecord[],
  correlation: ReviewCorrelation,
): AcceptanceDecisionLookup {
  if (
    correlation.reviewKind === "task-review" &&
    records.some(
      (record) =>
        isHistoricalTaskAcceptanceDecisionRecord(record) &&
        sameTask(record.taskExecutionRef, correlation.taskExecutionRef),
    )
  )
    return { kind: "conflict", advisory: "historic roundless AcceptanceDecision record" };
  const matches = orderEventsForProjection(records)
    .filter(isAcceptance)
    .filter((record) => correlationMatchesAcceptance(record, correlation));
  // A blocked AcceptanceDecision records a provisional inability to decide. If
  // reevaluation later commits a final verdict, keep that final verdict current.
  const finalMatches = matches.filter((record) => record.verdict !== "blocked");
  const currentMatches = finalMatches.length > 0 ? finalMatches : matches;
  if (currentMatches.length > 1)
    return { kind: "conflict", advisory: "multiple current AcceptanceDecision records" };
  const decision = currentMatches[0];
  return decision === undefined ? { kind: "missing" } : { kind: "found", decision };
}

export function sameReviewCorrelation(left: ReviewCorrelation, right: ReviewCorrelation): boolean {
  if (left.reviewKind !== right.reviewKind) return false;
  if (left.reviewKind === "task-review" && right.reviewKind === "task-review")
    return (
      left.reviewRound === right.reviewRound &&
      sameTask(left.taskExecutionRef, right.taskExecutionRef)
    );
  if (left.reviewKind === "final-review" && right.reviewKind === "final-review")
    return (
      left.authorizationId === right.authorizationId &&
      left.planPath === right.planPath &&
      left.finalizationAttemptId === right.finalizationAttemptId &&
      left.finalReviewRound === right.finalReviewRound &&
      samePlanFingerprint(left.planFingerprint, right.planFingerprint)
    );
  return false;
}

export function deriveAcceptanceDecision(
  gate: GateDecisionPayload | GateDecision,
): AcceptanceDecisionPayload {
  if (gate.gateType === "task")
    return {
      recordType: "decision",
      kind: "task-acceptance",
      taskId: gate.taskId,
      taskExecutionRef: gate.taskExecutionRef,
      reviewRound: gate.reviewRound,
      verdict: gate.verdict === "PASS" ? "accepted" : "rework-required",
    };
  return {
    recordType: "decision",
    kind: "plan-acceptance",
    authorizationId: gate.authorizationId,
    planPath: gate.planPath,
    finalizationAttemptId: gate.finalizationAttemptId,
    finalReviewRound: gate.finalReviewRound,
    verdict: gate.verdict === "PASS" ? "complete" : "rework-required",
  };
}

/**
 * F-003 Verdict invariant: Gate PASS <=> accepted/complete, WARN/FAIL <=>
 * rework-required. A blocked or inverted Acceptance beside a Gate is never a
 * formal completion.
 */
function acceptanceAgreesWithGate(gate: GateDecision, acceptance: AcceptanceDecision): boolean {
  const expected = deriveAcceptanceDecision(gate);
  return acceptance.kind === expected.kind && acceptance.verdict === expected.verdict;
}

type ActiveApprovedPlanBinding = Extract<ApprovedPlanBinding, { readonly status: "active" }>;

export type CurrentReviewAdmission =
  | { readonly kind: "admitted"; readonly correlation: ReviewCorrelation }
  | { readonly kind: "not_proven"; readonly reason: string }
  | { readonly kind: "conflict"; readonly reason: string };

type ReviewDispatchTerminalRecord = Extract<
  PersistedLogRecord,
  { readonly recordType: "observation"; readonly kind: "review_dispatch_transition" }
>;

/**
 * Execution identity of the current gate context, excluding the review round:
 * Task = TaskExecutionRef, Final = authorization/plan/fingerprint/finalization attempt.
 * The round is deliberately excluded so that competing successful rounds for the
 * same execution surface as a conflict instead of being resolved by max/latest.
 */
function matchesExecutionIdentity(
  correlation: ReviewCorrelation,
  context: GatePendingAttemptContext,
  binding: ActiveApprovedPlanBinding,
): boolean {
  if (context.scope === "task")
    return (
      correlation.reviewKind === "task-review" &&
      sameTask(correlation.taskExecutionRef, context.taskExecutionRef)
    );
  return (
    correlation.reviewKind === "final-review" &&
    correlation.authorizationId === context.authorizationId &&
    correlation.planPath === context.planPath &&
    samePlanFingerprint(correlation.planFingerprint, binding.planFingerprint) &&
    correlation.finalizationAttemptId === context.finalizationAttemptId
  );
}

function bindingCoversContext(
  context: GatePendingAttemptContext,
  state: ProjectedState,
  binding: ActiveApprovedPlanBinding,
): boolean {
  if (binding.sessionId !== context.parentSessionId) return false;
  if (context.scope === "task") {
    const ref = context.taskExecutionRef;
    const key = taskLifecycleKey(context.parentSessionId, ref);
    const current = state.lifecycle.currentTaskExecutionRefs.get(key);
    return (
      binding.authorizationId === ref.authorizationId &&
      binding.canonicalSnapshot.tasks.some((task) => task.taskId === ref.taskId) &&
      current !== undefined &&
      sameTask(current, ref) &&
      state.lifecycle.taskStates.get(key) === "gate_pending"
    );
  }
  return (
    binding.authorizationId === context.authorizationId &&
    binding.planPath === context.planPath &&
    Array.from(state.lifecycle.finalization.values()).some(
      (value) =>
        value.parentSessionId === context.parentSessionId &&
        value.authorizationId === context.authorizationId &&
        value.planPath === context.planPath &&
        value.finalizationAttemptId === context.finalizationAttemptId &&
        value.finalReviewRound === context.finalReviewRound &&
        value.state === "final_gate_pending",
    )
  );
}

/**
 * F-001: proves the current review correlation at `gate_pending` from the durable
 * lifecycle, the successful terminal dispatch slot, and a correlation-bearing clean
 * complete review snapshot. Never guesses a round; competing candidates are a conflict.
 */
export function admitCurrentReview(
  context: GatePendingAttemptContext,
  state: ProjectedState,
  records: readonly PersistedLogRecord[],
  binding: ActiveApprovedPlanBinding,
): CurrentReviewAdmission {
  if (!bindingCoversContext(context, state, binding))
    return { kind: "not_proven", reason: "lifecycle_or_authorization_mismatch" };

  const slots = state.reviewDispatchSlots.filter(
    (slot) =>
      slot.key.parentSessionId === context.parentSessionId &&
      slot.state === "terminal" &&
      slot.terminalReason === "completed" &&
      matchesExecutionIdentity(slot.key.correlation, context, binding),
  );
  const terminalTransitions = records.filter(
    (record): record is ReviewDispatchTerminalRecord =>
      record.recordType === "observation" &&
      record.kind === "review_dispatch_transition" &&
      record.to === "terminal" &&
      record.terminalReason === "completed" &&
      record.parentSessionId === context.parentSessionId &&
      matchesExecutionIdentity(record.correlation, context, binding),
  );
  if (slots.length > 1 || terminalTransitions.length > 1)
    return { kind: "conflict", reason: "multiple_completed_terminal_candidates" };
  const slot = slots[0];
  const transition = terminalTransitions[0];
  if (
    slot === undefined ||
    transition === undefined ||
    !sameReviewCorrelation(slot.key.correlation, transition.correlation)
  )
    return { kind: "not_proven", reason: "completed_terminal_missing" };

  const correlation = slot.key.correlation;
  if (
    context.scope === "plan" &&
    correlation.reviewKind === "final-review" &&
    correlation.finalReviewRound !== context.finalReviewRound
  )
    return { kind: "not_proven", reason: "final_review_round_mismatch" };

  // F-002: the terminal slot no longer carries the claimed call, so prove the
  // review call from the durable claimed -> staged -> terminal history.
  const history = projectCompletedReviewCallHistory(records, context.parentSessionId, correlation);
  if (history.kind === "conflict") return { kind: "conflict", reason: history.reason };
  if (history.kind === "missing") return { kind: "not_proven", reason: history.reason };

  const scoped = records.filter(
    (record) =>
      record.recordType === "observation" &&
      isCurrentReviewObservation(record, context, correlation),
  );
  const clean = scoped.filter(
    (record) =>
      record.recordType === "observation" &&
      record.kind === "review_observed" &&
      record.isCompleteSnapshot === true &&
      record.items.length === 0,
  );
  if (clean.length === 0) return { kind: "not_proven", reason: "clean_review_observation_missing" };
  if (clean.length !== scoped.length)
    return { kind: "conflict", reason: "contradictory_review_observations" };
  return { kind: "admitted", correlation };
}

/**
 * F-002 current-correlation review observation predicate shared by admission and
 * by the Gate-facing review summary.
 */
function isCurrentReviewObservation(
  record: ObservationRecord,
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
): boolean {
  return (
    record.kind === "review_observed" &&
    record.correlation !== undefined &&
    sameReviewCorrelation(record.correlation, correlation) &&
    record.sessionId === context.parentSessionId &&
    (context.scope === "task"
      ? record.taskId === context.taskExecutionRef.taskId &&
        record.reviewScope === `task:${context.taskExecutionRef.taskId}`
      : record.reviewScope === "final")
  );
}

export type ExecutionEvidenceAdmission = {
  /**
   * `bound`: a durable binding proves at least one parent call of this attempt.
   * `unattributed`: no durable binding for this attempt (missing/failed/legacy).
   * `conflict`: a parent call touching this task is bound to different attempts.
   */
  readonly status: "bound" | "unattributed" | "conflict";
  readonly admitted: readonly ProjectedEvidence[];
  /** Same-task tool evidence excluded as UNATTRIBUTED/CONFLICT. */
  readonly excluded: readonly FullEvidenceRef[];
};

function fullEvidenceRefFor(
  record: PersistedLogRecord,
  evidenceId: string,
): FullEvidenceRef {
  return {
    agentId: record.agentId,
    sessionId: record.sessionId,
    writerId: record.writerId,
    sequence: record.sequence,
    kind: "full",
    evidenceId,
  };
}

function resolvesUniquely(records: readonly PersistedLogRecord[], ref: FullEvidenceRef): boolean {
  const matches = records.filter(
    (record) =>
      record.agentId === ref.agentId &&
      record.sessionId === ref.sessionId &&
      record.writerId === ref.writerId &&
      record.sequence === ref.sequence,
  );
  const target = matches[0];
  return (
    matches.length === 1 &&
    target !== undefined &&
    target.recordType === "observation" &&
    target.kind === "tool_executed" &&
    toEvidenceArray(target.evidence).filter((evidence) => evidence.evidenceId === ref.evidenceId)
      .length === 1
  );
}

/**
 * F-002 Execution Evidence Admission (Owner Option A). Admits a `tool_executed`
 * evidence item only when its exact FullEvidenceRef resolves to one durable
 * record whose `sessionId`/`callId`/`taskId` match a durable
 * `implementation_call_binding` of the current attempt. Task ID alone, ordering,
 * output text and in-memory bindings never admit evidence. Independent
 * child-session tool calls cannot be attributed by the parent binding and stay
 * UNATTRIBUTED.
 */
export function admitExecutionEvidence(
  scope: { readonly parentSessionId: string; readonly taskExecutionRef: TaskExecutionRef },
  records: readonly PersistedLogRecord[],
): ExecutionEvidenceAdmission {
  const target = scope.taskExecutionRef;
  const currentCalls = new Set<string>();
  const conflictCalls = new Set<string>();
  for (const binding of projectImplementationCallBindings(records).values()) {
    if (binding.parentSessionId !== scope.parentSessionId) continue;
    if (binding.kind === "conflict") {
      if (
        binding.taskExecutionRefs.length === 0 ||
        binding.taskExecutionRefs.some(
          (ref) => ref.authorizationId === target.authorizationId && ref.taskId === target.taskId,
        )
      )
        conflictCalls.add(binding.callId);
      continue;
    }
    if (sameTask(binding.taskExecutionRef, target)) currentCalls.add(binding.callId);
  }
  const admitted: ProjectedEvidence[] = [];
  const excluded: FullEvidenceRef[] = [];
  for (const record of orderEventsForProjection(records)) {
    if (record.recordType !== "observation" || record.kind !== "tool_executed") continue;
    const attributed =
      record.sessionId === scope.parentSessionId &&
      record.taskId === target.taskId &&
      currentCalls.has(record.callId) &&
      !conflictCalls.has(record.callId);
    for (const evidence of toEvidenceArray(record.evidence)) {
      const ref = fullEvidenceRefFor(record, evidence.evidenceId);
      if (attributed && resolvesUniquely(records, ref)) admitted.push({ evidence, ref });
      else if (record.taskId === target.taskId) excluded.push(ref);
    }
  }
  const status =
    conflictCalls.size > 0 ? "conflict" : currentCalls.size > 0 ? "bound" : "unattributed";
  return { status, admitted, excluded };
}

function evidenceRefKey(ref: FullEvidenceRef): string {
  return JSON.stringify([ref.agentId, ref.sessionId, ref.writerId, ref.sequence, ref.evidenceId]);
}

/**
 * Keys of admitted execution evidence whose outcome is indeterminate
 * (`unknown`/absent). A rule citing only such refs has not observed a violation.
 */
function indeterminateEvidenceKeys(admitted: readonly ProjectedEvidence[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const item of admitted) {
    const outcome =
      item.evidence.sourceClass === "tool_output" ? item.evidence.interpretation?.outcome : undefined;
    if (outcome === undefined || outcome === "unknown") keys.add(evidenceRefKey(item.ref));
  }
  return keys;
}

/**
 * True when a non-PASS Gate outcome rests only on unproven evidence AND a
 * fail-closed rule withholds a needed proof.
 *
 * - A non-PASS rule is "unproven" when it cites no evidence, or only admitted
 *   execution evidence with indeterminate outcomes. Any other ref is an observed
 *   violation, which keeps the formal FAIL/WARN verdict.
 * - The rule engine maps missing evidence through `onMissingEvidence`
 *   (`fail` -> FAIL, `warn`/`pass` -> WARN). An unproven WARN is therefore an
 *   advisory outcome and proceeds as a formal WARN Gate + rework-required
 *   Acceptance (pre-F-002 behavior). Only an unproven FAIL (fail-closed missing
 *   evidence) blocks. Unproven evidence is never converted into PASS.
 */
function restsOnUnprovenEvidence(
  result: GateDecisionPayload,
  admitted: readonly ProjectedEvidence[],
): boolean {
  const indeterminate = indeterminateEvidenceKeys(admitted);
  const nonPass = result.ruleResults.filter((rule) => rule.verdict !== "PASS");
  const failures = nonPass.filter((rule) => rule.verdict === "FAIL");
  const unproven = (rule: GateDecisionPayload["ruleResults"][number]): boolean =>
    rule.evidenceRefs.every(
      (ref) => ref.kind === "full" && indeterminate.has(evidenceRefKey(ref)),
    );
  return (
    result.verdict === "FAIL" &&
    nonPass.length > 0 &&
    failures.length > 0 &&
    failures.every(unproven)
  );
}

async function findActiveBinding(
  context: GatePendingAttemptContext,
  findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"],
): Promise<ActiveApprovedPlanBinding | null> {
  try {
    const binding = await findAuthorizationById(
      context.scope === "task" ? context.taskExecutionRef.authorizationId : context.authorizationId,
    );
    return binding !== null && binding.status === "active" ? binding : null;
  } catch {
    return null;
  }
}

function isGatePending(context: GatePendingAttemptContext, state: ProjectedState): boolean {
  if (context.scope === "task") {
    const current = Array.from(state.lifecycle.currentTaskExecutionRefs.entries()).find(([, ref]) =>
      sameTask(ref, context.taskExecutionRef),
    );
    return current !== undefined && state.lifecycle.taskStates.get(current[0]) === "gate_pending";
  }
  return Array.from(state.lifecycle.finalization.values()).some(
    (value) =>
      value.authorizationId === context.authorizationId &&
      value.planPath === context.planPath &&
      value.finalizationAttemptId === context.finalizationAttemptId &&
      value.finalReviewRound === context.finalReviewRound &&
      value.state === "final_gate_pending",
  );
}

function pending(
  context: GatePendingAttemptContext,
  payload: GateDecisionPayload | AcceptanceDecisionPayload,
): PendingDecisionRecord {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    agentId: context.agentId,
    sessionId: context.sessionId,
    writerId: context.writerId,
    ...payload,
  };
}

/**
 * F-003: a blocked Acceptance is derived only from the admitted correlation's
 * proven round. Without one (`null`) nothing is written — never a guessed round.
 */
function blockedAcceptance(
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
): AcceptanceDecisionPayload | null {
  if (context.scope === "task")
    return correlation.reviewKind === "task-review" &&
      sameTask(correlation.taskExecutionRef, context.taskExecutionRef)
      ? {
          recordType: "decision",
          kind: "task-acceptance",
          taskId: context.taskExecutionRef.taskId,
          taskExecutionRef: context.taskExecutionRef,
          reviewRound: correlation.reviewRound,
          verdict: "blocked",
        }
      : null;
  return correlation.reviewKind === "final-review" &&
    correlation.finalReviewRound === context.finalReviewRound
    ? {
        recordType: "decision",
        kind: "plan-acceptance",
        authorizationId: context.authorizationId,
        planPath: context.planPath,
        finalizationAttemptId: context.finalizationAttemptId,
        finalReviewRound: context.finalReviewRound,
        verdict: "blocked",
      }
    : null;
}

/**
 * F-003 Evaluator identity check: the Rule callback output must carry exactly the
 * admitted correlation's identity (Task: TaskExecutionRef + review round; Final:
 * full Final identity) before anything is persisted.
 */
function gateMatchesAdmittedCorrelation(
  result: GateDecisionPayload,
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
): boolean {
  return (
    result.gateType === context.scope &&
    (context.scope === "task"
      ? result.gateType === "task" && sameTask(result.taskExecutionRef, context.taskExecutionRef)
      : result.gateType === "plan" &&
        result.authorizationId === context.authorizationId &&
        result.finalizationAttemptId === context.finalizationAttemptId &&
        result.finalReviewRound === context.finalReviewRound) &&
    correlationMatchesGate(result, correlation)
  );
}

function gateContextFor(
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
  admittedReviewSummary: ReviewSummary,
): GateContext | null {
  const reviewScope = Array.from(admittedReviewSummary.byScope.keys());
  if (context.scope === "task")
    return correlation.reviewKind === "task-review"
      ? {
          scope: "task",
          trigger: context.trigger,
          taskExecutionRef: context.taskExecutionRef,
          reviewRound: correlation.reviewRound,
          agentId: context.agentId,
          sessionId: context.sessionId,
          writerId: context.writerId,
          reviewScope,
          reviewSummary: admittedReviewSummary,
        }
      : null;
  return {
    scope: "plan",
    trigger: "final_review_complete",
    authorizationId: context.authorizationId,
    planPath: context.planPath,
    finalizationAttemptId: context.finalizationAttemptId,
    finalReviewRound: context.finalReviewRound,
    agentId: context.agentId,
    sessionId: context.sessionId,
    writerId: context.writerId,
    reviewScope,
    reviewSummary: admittedReviewSummary,
  };
}

async function applyGateOutcomeLifecycle(
  dependencies: GateEvaluationDependencies,
  context: GatePendingAttemptContext,
  decision: GateDecisionPayload,
): Promise<{ readonly kind: "committed" | "failed" }> {
  return context.scope === "task"
    ? dependencies.appendTaskLifecycleTransition({
        parentSessionId: context.parentSessionId,
        taskExecutionRef: context.taskExecutionRef,
        from: "gate_pending",
        to: decision.verdict === "PASS" ? "accepted" : "rework_required",
      })
    : dependencies.appendPlanFinalizationTransition({
        parentSessionId: context.parentSessionId,
        authorizationId: context.authorizationId,
        planPath: context.planPath,
        finalizationAttemptId: context.finalizationAttemptId,
        finalReviewRound: context.finalReviewRound,
        from: "final_gate_pending",
        to: decision.verdict === "PASS" ? "complete" : "final_rework_required",
      });
}

async function appendBlockedAcceptanceIfMissing(
  dependencies: GateEvaluationDependencies,
  context: GatePendingAttemptContext,
  correlation: ReviewCorrelation,
): Promise<{ readonly kind: "committed" | "failed" }> {
  const existing = findCurrentAcceptanceDecision(await dependencies.readDurableRecords(), correlation);
  if (existing.kind === "found") return { kind: "committed" };
  if (existing.kind === "conflict") return { kind: "failed" };
  const blocked = blockedAcceptance(context, correlation);
  if (blocked === null) return { kind: "failed" };
  return dependencies.appendDecision(pending(context, blocked));
}

export function createGatePendingAttemptEvaluator(dependencies: GateEvaluationDependencies): {
  readonly evaluateGatePendingAttempt: (
    context: GatePendingAttemptContext,
  ) => Promise<GatePendingAttemptResult>;
  readonly evaluateGatePendingAttemptWithinAuthorizationReviewBoundary: (
    context: GatePendingAttemptContext,
  ) => Promise<GatePendingAttemptResult>;
} {
  const tails = new Map<string, Promise<void>>();
  const key = (context: GatePendingAttemptContext): string =>
    context.scope === "task"
      ? JSON.stringify([
          "task",
          context.taskExecutionRef.authorizationId,
          context.taskExecutionRef.taskId,
          context.taskExecutionRef.attemptId,
        ])
      : JSON.stringify([
          "plan",
          context.authorizationId,
          context.planPath,
          context.finalizationAttemptId,
          context.finalReviewRound,
        ]);
  const serialized = async (
    context: GatePendingAttemptContext,
  ): Promise<GatePendingAttemptResult> => {
    const identity = key(context);
    const predecessor = (tails.get(identity) ?? Promise.resolve()).catch(() => undefined);
    let release = (): void => undefined;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = predecessor.then(() => completion);
    tails.set(identity, current);
    await predecessor;
    try {
      return await evaluateWithin(context);
    } finally {
      release();
      if (tails.get(identity) === current) tails.delete(identity);
    }
  };
  const evaluateWithin = async (
    context: GatePendingAttemptContext,
  ): Promise<GatePendingAttemptResult> => {
    try {
      const records = await dependencies.readDurableRecords();
      const state = project(records, new Date().toISOString());
      if (!isGatePending(context, state)) return { kind: "not_applicable" };
      if (
        context.scope === "task" &&
        records.some(
          (record) =>
            isLegacyTaskGateDecisionRecord(record) && record.taskId === context.taskExecutionRef.taskId,
        )
      )
        return { kind: "not_applicable" };
      const binding = await findActiveBinding(context, dependencies.findAuthorizationById);
      if (binding === null) return { kind: "blocked", advisory: "review_authorization_not_active" };
      const admission = admitCurrentReview(context, state, records, binding);
      if (admission.kind === "conflict")
        return { kind: "blocked", advisory: "review_correlation_conflict" };
      if (admission.kind === "not_proven")
        return { kind: "blocked", advisory: "review_correlation_not_proven" };
      const correlation = admission.correlation;
      if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
        return { kind: "blocked", advisory: "review_authorization_not_active" };
      const gate = findCurrentGateDecision(records, correlation);
      const acceptance = findCurrentAcceptanceDecision(records, correlation);
      if (gate.kind === "conflict" || acceptance.kind === "conflict")
        return { kind: "blocked", advisory: "decision_integrity_violation" };
      if (gate.kind === "found" && acceptance.kind === "found") {
        return acceptanceAgreesWithGate(gate.decision, acceptance.decision)
          ? { kind: "decided", decision: gate.decision }
          : { kind: "blocked", advisory: "decision_integrity_violation" };
      }
      if (gate.kind === "found") {
        if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
          return { kind: "blocked", advisory: "review_authorization_not_active" };
        const appended = await dependencies.appendDecision(
          pending(context, deriveAcceptanceDecision(gate.decision)),
        );
        if (appended.kind !== "committed")
          return { kind: "blocked", advisory: "acceptance_append_failed" };
        const lifecycle = await applyGateOutcomeLifecycle(dependencies, context, gate.decision);
        if (lifecycle.kind !== "committed")
          return { kind: "blocked", advisory: "lifecycle_append_failed" };
        return { kind: "decided", decision: gate.decision };
      }
      // F-002: Rules see only admitted inputs — the current-correlation review
      // summary and execution evidence proven by the durable implementation binding.
      const admittedReviewSummary = aggregateAdmittedReviews(
        records.filter((record): record is ObservationRecord => record.recordType === "observation"),
        (record) => isCurrentReviewObservation(record, context, correlation),
      );
      const execution: ExecutionEvidenceAdmission =
        context.scope === "task"
          ? admitExecutionEvidence(context, records)
          : { status: "unattributed", admitted: [], excluded: [] };
      const gateContext = gateContextFor(context, correlation, admittedReviewSummary);
      if (gateContext === null) return { kind: "blocked", advisory: "review_correlation_not_proven" };
      let result: GateRuleEvaluation;
      try {
        result = await dependencies.evaluateRules({
          context: gateContext,
          projected: state,
          admittedExecutionEvidence: execution.admitted,
          admittedReviewSummary,
        });
      } catch {
        if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
          return { kind: "blocked", advisory: "review_authorization_not_active" };
        const blocked = await appendBlockedAcceptanceIfMissing(dependencies, context, correlation);
        if (blocked.kind !== "committed")
          return { kind: "blocked", advisory: "acceptance_append_failed" };
        return { kind: "blocked", advisory: "gate_evaluation_failed" };
      }
      if ("verdict" in result && result.verdict === "SKIP")
        return { kind: "not_applicable" };
      if (!("recordType" in result)) {
        if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
          return { kind: "blocked", advisory: "review_authorization_not_active" };
        const blocked = await appendBlockedAcceptanceIfMissing(dependencies, context, correlation);
        if (blocked.kind !== "committed")
          return { kind: "blocked", advisory: "acceptance_append_failed" };
        return { kind: "blocked", advisory: "gate_evaluation_blocked" };
      }
      if (!gateMatchesAdmittedCorrelation(result, context, correlation))
        return { kind: "blocked", advisory: "gate_decision_identity_mismatch" };
      if (context.scope === "task" && restsOnUnprovenEvidence(result, execution.admitted)) {
        // Missing / UNATTRIBUTED / CONFLICT / indeterminate execution evidence on a
        // fail-closed rule is not an observed FAIL: never record a formal Gate
        // verdict from it, only a blocked Acceptance.
        if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
          return { kind: "blocked", advisory: "review_authorization_not_active" };
        const blocked = await appendBlockedAcceptanceIfMissing(dependencies, context, correlation);
        if (blocked.kind !== "committed")
          return { kind: "blocked", advisory: "acceptance_append_failed" };
        return { kind: "blocked", advisory: "execution_evidence_not_proven" };
      }
      const expectedAcceptance = deriveAcceptanceDecision(result);
      if (
        acceptance.kind === "found" &&
        acceptance.decision.verdict !== "blocked" &&
        acceptance.decision.verdict !== expectedAcceptance.verdict
      ) {
        return { kind: "blocked", advisory: "decision_integrity_violation" };
      }
      if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
        return { kind: "blocked", advisory: "review_authorization_not_active" };
      const gateAppended = await dependencies.appendDecision(pending(context, result));
      if (gateAppended.kind !== "committed")
        return { kind: "blocked", advisory: "gate_decision_append_failed" };
      if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
        return { kind: "blocked", advisory: "review_authorization_not_active" };
      if (acceptance.kind !== "found" || acceptance.decision.verdict === "blocked") {
        const acceptanceAppended = await dependencies.appendDecision(
          pending(context, expectedAcceptance),
        );
        if (acceptanceAppended.kind !== "committed")
          return { kind: "blocked", advisory: "acceptance_append_failed" };
      }
      const lifecycle = await applyGateOutcomeLifecycle(dependencies, context, result);
      if (lifecycle.kind !== "committed")
        return { kind: "blocked", advisory: "lifecycle_append_failed" };
      return { kind: "decided", decision: result };
    } catch {
      return { kind: "blocked", advisory: "gate_evaluation_failed" };
    }
  };
  return {
    evaluateGatePendingAttempt: (context) =>
      dependencies.withAuthorizationReviewBoundary(context.parentSessionId, () =>
        serialized(context),
      ),
    evaluateGatePendingAttemptWithinAuthorizationReviewBoundary: serialized,
  };
}
