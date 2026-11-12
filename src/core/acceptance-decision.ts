import type { ApprovedPlanBinding, AuthorizationReviewBoundary } from "./plan-authorization";
import type { ReviewCorrelation, TaskExecutionRef } from "./types";
import type { GateContext, GatePendingAttemptContext } from "./v2/gate-context";
import type {
  AcceptanceDecision,
  AcceptanceDecisionPayload,
  DecisionPayload,
  GateDecision,
  GateDecisionPayload,
  LegacyTaskGateDecision,
  PendingDecisionRecord,
} from "./v2/decision-model";
import { orderEventsForProjection } from "./v2/integrity";
import { hashString } from "./v2/hash";
import type { PersistedLogRecord } from "./v2/observation-model";
import type {
  PlanFinalizationTransitionInput,
  TaskLifecycleTransitionInput,
} from "./task-lifecycle";
import { project, taskLifecycleKey, type ProjectedState } from "./v2/state-projection";

type SkipGateEvaluation = { readonly verdict: "SKIP"; readonly reason: string };
type GateRuleEvaluation =
  | GateDecisionPayload
  | SkipGateEvaluation
  | { readonly kind: "insufficient_evidence"; readonly reason: string };

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
  readonly evaluateRules: (input: {
    readonly context: GateContext;
    readonly projected: ProjectedState;
  }) => Promise<GateRuleEvaluation>;
  readonly recordAdvisory: (advisory: string) => Promise<void>;
};

export type GateDecisionLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "found"; readonly decision: GateDecision }
  | { readonly kind: "conflict"; readonly advisory: "multiple current GateDecision records" };
export type AcceptanceDecisionLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "found"; readonly decision: AcceptanceDecision }
  | { readonly kind: "conflict"; readonly advisory: "multiple current AcceptanceDecision records" };

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

function correlationMatchesGate(record: GateDecision, correlation: ReviewCorrelation): boolean {
  return correlation.reviewKind === "task-review"
    ? record.gateType === "task" && sameTask(record.taskExecutionRef, correlation.taskExecutionRef)
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
        sameTask(record.taskExecutionRef, correlation.taskExecutionRef)
    : record.kind === "plan-acceptance" &&
        record.authorizationId === correlation.authorizationId &&
        samePlanPath(record.planPath, record.planPathDigest, correlation.planPath) &&
        record.finalizationAttemptId === correlation.finalizationAttemptId &&
        record.finalReviewRound === correlation.finalReviewRound;
}

function isAuthoritativeGate(record: PersistedLogRecord): record is GateDecision {
  return (
    record.recordType === "decision" &&
    "gateType" in record &&
    (record.gateType === "plan" || "taskExecutionRef" in record)
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
    (record.kind === "task-acceptance" || record.kind === "plan-acceptance")
  );
}

export function findCurrentGateDecision(
  records: readonly PersistedLogRecord[],
  correlation: ReviewCorrelation,
): GateDecisionLookup {
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
  const matches = orderEventsForProjection(records)
    .filter(isAcceptance)
    .filter((record) => correlationMatchesAcceptance(record, correlation));
  if (matches.length > 1)
    return { kind: "conflict", advisory: "multiple current AcceptanceDecision records" };
  const decision = matches[0];
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

  const scoped = records.filter(
    (record) =>
      record.recordType === "observation" &&
      record.kind === "review_observed" &&
      record.correlation !== undefined &&
      sameReviewCorrelation(record.correlation, correlation) &&
      record.sessionId === context.parentSessionId &&
      (context.scope === "task"
        ? record.taskId === context.taskExecutionRef.taskId &&
          record.reviewScope === `task:${context.taskExecutionRef.taskId}`
        : record.reviewScope === "final"),
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
  payload: DecisionPayload,
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

function blockedAcceptance(context: GatePendingAttemptContext): AcceptanceDecisionPayload {
  return context.scope === "task"
    ? {
        recordType: "decision",
        kind: "task-acceptance",
        taskId: context.taskExecutionRef.taskId,
        taskExecutionRef: context.taskExecutionRef,
        verdict: "blocked",
      }
    : {
        recordType: "decision",
        kind: "plan-acceptance",
        authorizationId: context.authorizationId,
        planPath: context.planPath,
        finalizationAttemptId: context.finalizationAttemptId,
        finalReviewRound: context.finalReviewRound,
        verdict: "blocked",
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
  return dependencies.appendDecision(pending(context, blockedAcceptance(context)));
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
      if (gate.kind === "found" && acceptance.kind === "found")
        return { kind: "decided", decision: gate.decision };
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
      const gateContext: GateContext =
        context.scope === "task"
          ? {
              scope: "task",
              trigger: context.trigger,
              taskExecutionRef: context.taskExecutionRef,
              agentId: context.agentId,
              sessionId: context.sessionId,
              writerId: context.writerId,
              reviewScope:
                state.tasks.get(context.taskExecutionRef.taskId)?.observedReviewScopes ?? [],
              reviewSummary: state.reviewSummary,
            }
          : {
              scope: "plan",
              trigger: "final_review_complete",
              authorizationId: context.authorizationId,
              planPath: context.planPath,
              finalizationAttemptId: context.finalizationAttemptId,
              finalReviewRound: context.finalReviewRound,
              agentId: context.agentId,
              sessionId: context.sessionId,
              writerId: context.writerId,
              reviewScope: Array.from(state.reviewSummary.byScope.keys()),
              reviewSummary: state.reviewSummary,
            };
      let result: GateRuleEvaluation;
      try {
        result = await dependencies.evaluateRules({ context: gateContext, projected: state });
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
      if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
        return { kind: "blocked", advisory: "review_authorization_not_active" };
      const gateAppended = await dependencies.appendDecision(pending(context, result));
      if (gateAppended.kind !== "committed")
        return { kind: "blocked", advisory: "gate_decision_append_failed" };
      if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
        return { kind: "blocked", advisory: "review_authorization_not_active" };
      const acceptanceAppended = await dependencies.appendDecision(
        pending(context, deriveAcceptanceDecision(result)),
      );
      if (acceptanceAppended.kind !== "committed")
        return { kind: "blocked", advisory: "acceptance_append_failed" };
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
