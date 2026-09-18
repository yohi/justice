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
import type { PersistedLogRecord } from "./v2/observation-model";
import type {
  PlanFinalizationTransitionInput,
  TaskLifecycleTransitionInput,
} from "./task-lifecycle";
import { project, type ProjectedState } from "./v2/state-projection";

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

function correlationMatchesGate(record: GateDecision, correlation: ReviewCorrelation): boolean {
  return correlation.reviewKind === "task-review"
    ? record.gateType === "task" && sameTask(record.taskExecutionRef, correlation.taskExecutionRef)
    : record.gateType === "plan" &&
        record.authorizationId === correlation.authorizationId &&
        record.planPath === correlation.planPath &&
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
        record.planPath === correlation.planPath &&
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

async function currentCorrelation(
  context: GatePendingAttemptContext,
  state: ProjectedState,
  findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"],
): Promise<ReviewCorrelation | undefined> {
  if (context.scope === "task") {
    const ref = Array.from(state.lifecycle.currentTaskExecutionRefs.values()).find((value) =>
      sameTask(value, context.taskExecutionRef),
    );
    return ref === undefined
      ? undefined
      : { reviewKind: "task-review", taskExecutionRef: ref, reviewRound: 1 };
  }
  const entry = Array.from(state.lifecycle.finalization.values()).find(
    (value) =>
      value.authorizationId === context.authorizationId &&
      value.planPath === context.planPath &&
      value.finalizationAttemptId === context.finalizationAttemptId &&
      value.finalReviewRound === context.finalReviewRound,
  );
  if (entry === undefined) return undefined;
  const binding = await findAuthorizationById(entry.authorizationId);
  return binding === null
    ? undefined
    : {
        reviewKind: "final-review",
        authorizationId: entry.authorizationId,
        planPath: entry.planPath,
        planFingerprint: binding.planFingerprint,
        finalizationAttemptId: entry.finalizationAttemptId,
        finalReviewRound: entry.finalReviewRound,
      };
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

function hasTerminalReview(
  records: readonly PersistedLogRecord[],
  context: GatePendingAttemptContext,
): boolean {
  return records.some(
    (record) =>
      record.recordType === "observation" &&
      record.kind === "review_observed" &&
      record.isCompleteSnapshot === true &&
      record.items.length === 0 &&
      (context.scope === "plan" || record.taskId === context.taskExecutionRef.taskId),
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
      const correlation = await currentCorrelation(
        context,
        state,
        dependencies.findAuthorizationById,
      );
      if (
        correlation === undefined ||
        !isGatePending(context, state) ||
        !hasTerminalReview(records, context)
      )
        return { kind: "not_applicable" };
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
      const result = await dependencies.evaluateRules({ context: gateContext, projected: state });
      if (!("recordType" in result)) {
        if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
          return { kind: "blocked", advisory: "review_authorization_not_active" };
        const existing = findCurrentAcceptanceDecision(
          await dependencies.readDurableRecords(),
          correlation,
        );
        if (existing.kind === "missing") {
          const blocked = await dependencies.appendDecision(pending(context, blockedAcceptance(context)));
          if (blocked.kind !== "committed")
            return { kind: "blocked", advisory: "acceptance_append_failed" };
        }
        return { kind: "blocked", advisory: "gate_evaluation_blocked" };
      }
      if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
        return { kind: "blocked", advisory: "review_authorization_not_active" };
      const gateAppended = await dependencies.appendDecision(pending(context, result));
      if (gateAppended.kind !== "committed")
        return { kind: "blocked", advisory: "gate_decision_append_failed" };
      if (context.scope === "task") {
        const lifecycle = await dependencies.appendTaskLifecycleTransition({
          parentSessionId: context.parentSessionId,
          taskExecutionRef: context.taskExecutionRef,
          from: "gate_pending",
          to: result.verdict === "PASS" ? "accepted" : "rework_required",
        });
        if (lifecycle.kind !== "committed")
          return { kind: "blocked", advisory: "lifecycle_append_failed" };
      } else {
        const lifecycle = await dependencies.appendPlanFinalizationTransition({
          parentSessionId: context.parentSessionId,
          authorizationId: context.authorizationId,
          planPath: context.planPath,
          finalizationAttemptId: context.finalizationAttemptId,
          finalReviewRound: context.finalReviewRound,
          from: "final_gate_pending",
          to: result.verdict === "PASS" ? "complete" : "final_rework_required",
        });
        if (lifecycle.kind !== "committed")
          return { kind: "blocked", advisory: "lifecycle_append_failed" };
      }
      if (!(await isCurrentActiveAuthorization(correlation, dependencies.findAuthorizationById)))
        return { kind: "blocked", advisory: "review_authorization_not_active" };
      const acceptanceAppended = await dependencies.appendDecision(
        pending(context, deriveAcceptanceDecision(result)),
      );
      if (acceptanceAppended.kind !== "committed")
        return { kind: "blocked", advisory: "acceptance_append_failed" };
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
