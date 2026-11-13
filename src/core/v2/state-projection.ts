// src/core/v2/state-projection.ts
import type {
  DelegatedExecutionBinding,
  ObservedReviewExecutionV1,
  FullEvidenceRef,
  ReviewCorrelation,
  ReviewTaskCallBinding,
  TaskCallBinding,
  TaskExecutionRef,
} from "../types";
import type { ReviewDispatchSlot } from "../review-dispatch-state";
import { sameReviewCorrelation } from "../review-correlation";
import {
  computeMaxSequenceByShard,
  computeSourceHash,
  orderEventsForProjection,
} from "./integrity";
import type {
  Evidence,
  ObservationRecord,
  PersistedLogRecord,
  PersistedReviewArtifactCleanupRecord,
  PlanFinalizationState,
  TaskProgressState,
} from "./observation-model";
import { applyPlanTransition, applyTaskTransition } from "../task-lifecycle";
import { toEvidenceArray } from "./evidence-list";
import type { Verdict } from "./decision-model";
import type { ReviewSummary, ScopeReviewSummary } from "./review-types";
export type { ReviewSummary, ReviewSummaryItem, ScopeReviewSummary } from "./review-types";
import { aggregateReviews } from "./review-aggregator";
import { isWorkflowBootstrapRecordKind } from "./workflow-bootstrap-projection";

export type ProjectedEvidence = {
  readonly evidence: Evidence;
  readonly ref: FullEvidenceRef;
};

export type TaskStatus = "open" | Verdict;
export type TaskVerdict = "NONE" | Verdict;

export type ProjectedTask = {
  readonly status: TaskStatus;
  readonly lastVerdict: TaskVerdict;
  readonly evidence: readonly ProjectedEvidence[];
  readonly observedReviewScopes: readonly string[];
};

export type ProjectedState = {
  readonly schemaVersion: 2;
  readonly rebuiltAt: string;
  readonly integrity: {
    readonly sourceHash: string;
    readonly maxSequenceByShard: ReadonlyMap<string, number>;
  };
  readonly tasks: ReadonlyMap<string, ProjectedTask>;
  readonly reviewSummary: ReviewSummary;
  readonly lifecycle: ProjectedLifecycle;
  readonly reviewDispatchSlots: readonly ReviewDispatchSlot[];
  readonly taskCallBindings: readonly TaskCallBinding[];
  readonly delegatedExecutionBindings: readonly DelegatedExecutionBinding[];
};

export type FinalizationContext = {
  readonly parentSessionId: string;
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId: string;
  readonly finalReviewRound: number;
  readonly state: PlanFinalizationState;
};

export type ProjectedLifecycle = {
  readonly currentTaskExecutionRefs: ReadonlyMap<string, TaskExecutionRef>;
  readonly taskStates: ReadonlyMap<string, TaskProgressState>;
  readonly finalization: ReadonlyMap<string, FinalizationContext>;
};

export type ProjectedReviewArtifactCleanupState =
  | { readonly kind: "not_started" }
  | { readonly kind: "outcome_uncertain" }
  | { readonly kind: "finished"; readonly status: "cleaned" | "quarantine_retained" | "replacement_retained" | "cleanup_incomplete" };

export type ReviewArtifactCleanupIdentity = {
  readonly parentSessionId: string;
  readonly callId: string;
  readonly correlation: import("../types").ReviewCorrelation;
  readonly artifactId: string;
};

export function projectReviewArtifactCleanupState(
  records: readonly PersistedLogRecord[],
  identity: ReviewArtifactCleanupIdentity,
): ProjectedReviewArtifactCleanupState {
  const matching = orderEventsForProjection(records).filter(
    (record): record is PersistedReviewArtifactCleanupRecord =>
      record.recordType === "observation" &&
      record.kind === "review_artifact_cleanup" &&
      record.parentSessionId === identity.parentSessionId &&
      record.callId === identity.callId &&
      record.artifactId === identity.artifactId &&
      JSON.stringify(record.correlation) === JSON.stringify(identity.correlation),
  );
  const latest = matching.at(-1);
  if (latest === undefined) return { kind: "not_started" };
  if (latest.phase === "started") return { kind: "outcome_uncertain" };
  return { kind: "finished", status: latest.status };
}

type MutableTask = {
  status: TaskStatus;
  lastVerdict: TaskVerdict;
  evidence: ProjectedEvidence[];
  observedReviewScopes: string[];
};

type MutableLifecycle = {
  currentTaskExecutionRefs: Map<string, TaskExecutionRef>;
  taskStates: Map<string, TaskProgressState>;
  finalization: Map<string, FinalizationContext>;
  lastTransitionIdentities: Map<string, string>;
  lastFinalizationTransitionIdentities: Map<string, string>;
};

type LatestMessageClaims = {
  readonly taskId: string;
  readonly evidenceRefKeys: ReadonlySet<string>;
};

function ensureTask(tasks: Map<string, MutableTask>, taskId: string): MutableTask {
  const existing = tasks.get(taskId);
  if (existing) return existing;
  const created: MutableTask = {
    status: "open",
    lastVerdict: "NONE",
    evidence: [],
    observedReviewScopes: [],
  };
  tasks.set(taskId, created);
  return created;
}

function fullEvidenceRefKey(ref: FullEvidenceRef): string {
  return JSON.stringify([ref.agentId, ref.sessionId, ref.writerId, ref.sequence, ref.evidenceId]);
}

function messageKey(sessionId: string, messageID: string, partID: string | undefined): string {
  // Historical records without partID share a distinct legacy key; newly generated
  // message evidence is always keyed by the complete (session, message, part) tuple.
  return JSON.stringify([sessionId, messageID, partID ?? null]);
}

export function taskLifecycleKey(
  parentSessionId: string,
  taskExecutionRef: Pick<TaskExecutionRef, "authorizationId" | "taskId">,
): string {
  return JSON.stringify([
    parentSessionId,
    taskExecutionRef.authorizationId,
    taskExecutionRef.taskId,
  ]);
}

function taskExecutionRefIdentity(taskExecutionRef: TaskExecutionRef): string {
  return JSON.stringify([
    taskExecutionRef.authorizationId,
    taskExecutionRef.taskId,
    taskExecutionRef.attemptId,
  ]);
}

function applyMessageObservation(
  tasks: Map<string, MutableTask>,
  latestMessageClaims: Map<string, LatestMessageClaims>,
  event: Extract<PersistedLogRecord, { recordType: "observation"; kind: "message" }>,
  taskId: string,
  taskState: MutableTask,
  baseRef: Pick<PersistedLogRecord, "agentId" | "sessionId" | "writerId" | "sequence">,
): void {
  const key = messageKey(event.sessionId, event.messageID, event.partID);
  const previousClaims = latestMessageClaims.get(key);
  if (previousClaims) {
    const previousTask = tasks.get(previousClaims.taskId);
    if (previousTask) {
      previousTask.evidence = previousTask.evidence.filter(
        (current) => !previousClaims.evidenceRefKeys.has(fullEvidenceRefKey(current.ref)),
      );
    }
  }

  const evidenceRefKeys = new Set<string>();
  for (const ev of event.evidence) {
    const projectedEvidence: ProjectedEvidence = {
      evidence: ev,
      ref: { ...baseRef, kind: "full", evidenceId: ev.evidenceId },
    };
    taskState.evidence.push(projectedEvidence);
    evidenceRefKeys.add(fullEvidenceRefKey(projectedEvidence.ref));
  }
  latestMessageClaims.set(key, { taskId, evidenceRefKeys });
}

type TaskLifecycleObservation = Extract<
  PersistedLogRecord,
  { readonly recordType: "observation"; readonly kind: "task_lifecycle_transition" }
>;

type PlanFinalizationObservation = Extract<
  PersistedLogRecord,
  { readonly recordType: "observation"; readonly kind: "plan_finalization_transition" }
>;

function planFinalizationKey(event: PlanFinalizationObservation): string {
  return JSON.stringify([event.parentSessionId, event.authorizationId, event.planPath]);
}

function applyTaskLifecycleObservation(
  tasks: Map<string, MutableTask>,
  event: TaskLifecycleObservation,
  lifecycle: MutableLifecycle,
): void {
  const taskId = event.taskExecutionRef.taskId;
  const taskKey = taskLifecycleKey(event.parentSessionId, event.taskExecutionRef);
  ensureTask(tasks, taskId);
  const currentRef = lifecycle.currentTaskExecutionRefs.get(taskKey);
  const identity = taskExecutionRefIdentity(event.taskExecutionRef);
  if (currentRef !== undefined && taskExecutionRefIdentity(currentRef) !== identity) {
    if (lifecycle.taskStates.get(taskKey) !== "rework_required") return;
  }
  const current = lifecycle.taskStates.get(taskKey) ?? "pending";
  const outcome = applyTaskTransition(
    {
      value: current,
      lastTransitionIdentity: lifecycle.lastTransitionIdentities.get(taskKey),
    },
    {
      identity,
      from: event.from,
      to: event.to,
    },
  );
  if (outcome.kind === "applied") {
    lifecycle.taskStates.set(taskKey, outcome.state);
    lifecycle.currentTaskExecutionRefs.set(taskKey, event.taskExecutionRef);
    lifecycle.lastTransitionIdentities.set(taskKey, identity);
  }
}

function applyPlanFinalizationObservation(
  event: PlanFinalizationObservation,
  lifecycle: MutableLifecycle,
): void {
  const planKey = planFinalizationKey(event);
  const current = lifecycle.finalization.get(planKey)?.state ?? "tasks_pending";
  const identity = JSON.stringify([
    event.authorizationId,
    event.planPath,
    event.finalizationAttemptId,
    event.finalReviewRound,
  ]);
  const outcome = applyPlanTransition(
    {
      value: current,
      lastTransitionIdentity: lifecycle.lastFinalizationTransitionIdentities.get(planKey),
    },
    {
      identity,
      from: event.from,
      to: event.to,
    },
  );
  if (outcome.kind !== "applied") return;
  lifecycle.finalization.set(planKey, {
    parentSessionId: event.parentSessionId,
    authorizationId: event.authorizationId,
    planPath: event.planPath,
    finalizationAttemptId: event.finalizationAttemptId,
    finalReviewRound: event.finalReviewRound,
    state: outcome.state,
  });
  lifecycle.lastFinalizationTransitionIdentities.set(planKey, identity);
}

function applyObservationEvent(
  tasks: Map<string, MutableTask>,
  latestMessageClaims: Map<string, LatestMessageClaims>,
  event: Extract<PersistedLogRecord, { recordType: "observation" }>,
  baseRef: Pick<PersistedLogRecord, "agentId" | "sessionId" | "writerId" | "sequence">,
  lifecycle: MutableLifecycle,
): void {
  // Workflow bootstrap records are audit-only: skipped BEFORE ensureTask() so they
  // neither open a projected task window nor contribute evidence, even when they
  // carry a taskId. `projectWorkflowBootstrapAudit` exposes them separately.
  if (isWorkflowBootstrapRecordKind(event.kind)) return;
  if (event.kind === "task_lifecycle_transition") {
    applyTaskLifecycleObservation(tasks, event, lifecycle);
    return;
  }
  if (event.kind === "plan_finalization_transition") {
    applyPlanFinalizationObservation(event, lifecycle);
    return;
  }
  // F-002 attribution records carry no evidence; they are read back separately
  // by `projectImplementationCallBindings`.
  if (event.kind === "implementation_call_binding") return;
  const taskId = event.taskId;
  if (!taskId) return;
  const taskState = ensureTask(tasks, taskId);
  if (event.kind === "tool_executed") {
    for (const ev of toEvidenceArray(event.evidence)) {
      taskState.evidence.push({
        evidence: ev,
        ref: { ...baseRef, kind: "full", evidenceId: ev.evidenceId },
      });
    }
  } else if (event.kind === "message") {
    applyMessageObservation(tasks, latestMessageClaims, event, taskId, taskState, baseRef);
  } else if (event.kind === "review_observed") {
    if (event.reviewScope && !taskState.observedReviewScopes.includes(event.reviewScope)) {
      taskState.observedReviewScopes.push(event.reviewScope);
    }
  }
}

function applyDecisionEvent(
  tasks: Map<string, MutableTask>,
  event: Extract<PersistedLogRecord, { recordType: "decision" }>,
): void {
  if (!("gateType" in event) || event.gateType !== "task") return;
  const taskId = "taskId" in event ? event.taskId : undefined;
  if (!taskId) return;
  const taskState = ensureTask(tasks, taskId);
  taskState.lastVerdict = event.verdict;
  taskState.status = event.verdict;
}

function reviewCorrelationKey(parentSessionId: string, correlation: ReviewDispatchSlot["key"]["correlation"]): string {
  return JSON.stringify([parentSessionId, correlation]);
}

function foldReviewDispatchSlots(events: readonly PersistedLogRecord[]): readonly ReviewDispatchSlot[] {
  const slots = new Map<string, ReviewDispatchSlot>();
  for (const event of events) {
    if (
      event.recordType !== "observation" ||
      event.kind !== "review_dispatch_transition"
    ) {
      continue;
    }
    const key = reviewCorrelationKey(event.parentSessionId, event.correlation);
    const current = slots.get(key);
    const envelope = {
      agentId: event.agentId,
      sessionId: event.sessionId,
      writerId: event.writerId,
    };
    if (event.from === null && event.to === "pending" && current === undefined) {
      slots.set(key, {
        key: { parentSessionId: event.parentSessionId, correlation: event.correlation },
        expectedCategory: event.expectedCategory,
        state: "pending",
        ...envelope,
      });
    } else if (
      event.from === "pending" &&
      event.to === "claimed" &&
      current?.state === "pending"
    ) {
      slots.set(key, {
        ...current,
        state: "claimed",
        callId: event.callId,
        artifactReservation: event.artifactReservation,
        ...envelope,
      });
    } else if (
      event.to === "terminal" &&
      current !== undefined &&
      current.state === event.from &&
      (event.from !== "claimed" || current.callId === event.callId)
    ) {
      slots.set(key, {
        ...current,
        state: "terminal",
        terminalReason: event.terminalReason,
        ...envelope,
      });
    }
  }
  return [...slots.values()];
}

function taskCallBindingsFor(slots: readonly ReviewDispatchSlot[]): readonly TaskCallBinding[] {
  const bindings: ReviewTaskCallBinding[] = [];
  for (const slot of slots) {
    if (slot.state !== "claimed" || slot.callId === undefined || slot.artifactReservation === undefined) {
      continue;
    }
    bindings.push({
      purpose: slot.key.correlation.reviewKind === "task-review" ? "task_review" : "final_review",
      parentSessionId: slot.key.parentSessionId,
      callId: slot.callId,
      correlation: slot.key.correlation,
      expectedCategory: slot.expectedCategory,
      artifactReservation: slot.artifactReservation,
    });
  }
  return bindings;
}

type DelegatedBindingRecord = Extract<
  PersistedLogRecord,
  { readonly recordType: "observation"; readonly kind: "delegated_execution_binding" }
>;

export function projectDelegatedExecutionBindings(
  records: readonly PersistedLogRecord[],
): readonly DelegatedExecutionBinding[] {
  const bindings = new Map<string, DelegatedExecutionBinding>();
  for (const record of records) {
    if (record.recordType !== "observation" || record.kind !== "delegated_execution_binding") {
      continue;
    }
    const bindingRecord = record as DelegatedBindingRecord;
    if (!bindings.has(bindingRecord.binding.relationId)) {
      bindings.set(bindingRecord.binding.relationId, bindingRecord.binding);
    }
  }
  return [...bindings.values()];
}

export function projectObservedReviewExecution(
  records: readonly PersistedLogRecord[],
  delegatedBinding: DelegatedExecutionBinding,
): ObservedReviewExecutionV1 | undefined {
  const candidates = records.filter(
    (record): record is DelegatedBindingRecord =>
      record.recordType === "observation" &&
      record.kind === "delegated_execution_binding" &&
      record.relation.runtimeEventId === delegatedBinding.relationId,
  );
  if (candidates.length !== 1) return undefined;
  const record = candidates[0];
  if (record === undefined) return undefined;
  if (
    record.relation.provenance !== "observed" ||
    record.binding.parentSessionId !== delegatedBinding.parentSessionId ||
    record.binding.parentCallId !== delegatedBinding.parentCallId ||
    record.binding.childSessionId !== delegatedBinding.childSessionId
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    provenance: "observed",
    reviewExecutionEventId: record.relation.runtimeEventId,
    parentSessionId: record.binding.parentSessionId,
    callId: record.binding.parentCallId,
    childSessionId: record.binding.childSessionId,
    correlation: record.binding.correlation,
  };
}

type ImplementationCallBindingRecord = Extract<
  PersistedLogRecord,
  { readonly recordType: "observation"; readonly kind: "implementation_call_binding" }
>;

export type ImplementationCallBindingProjection =
  | {
      readonly kind: "bound";
      readonly parentSessionId: string;
      readonly callId: string;
      readonly taskExecutionRef: TaskExecutionRef;
    }
  | {
      readonly kind: "conflict";
      readonly parentSessionId: string;
      readonly callId: string;
      readonly taskExecutionRefs: readonly TaskExecutionRef[];
    };

export function implementationCallBindingKey(parentSessionId: string, callId: string): string {
  return JSON.stringify([parentSessionId, callId]);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWellFormedImplementationCallBinding(record: ImplementationCallBindingRecord): boolean {
  const ref = record.taskExecutionRef as Partial<TaskExecutionRef> | undefined;
  return (
    isNonEmpty(record.parentSessionId) &&
    isNonEmpty(record.callId) &&
    isNonEmpty(record.authorizationId) &&
    ref !== undefined &&
    isNonEmpty(ref.authorizationId) &&
    isNonEmpty(ref.taskId) &&
    isNonEmpty(ref.attemptId) &&
    ref.authorizationId === record.authorizationId &&
    record.sessionId === record.parentSessionId
  );
}

/**
 * F-002 (Owner Option A): restores `(parentSessionId, callId) -> TaskExecutionRef`
 * from durable `implementation_call_binding` records only. This is distinct from
 * the review-dispatch `taskCallBindings`. Duplicate identical records are
 * idempotent; a call bound to different attempts, or a malformed record, is a
 * `conflict` and never yields an admissible binding.
 */
export function projectImplementationCallBindings(
  records: readonly PersistedLogRecord[],
): ReadonlyMap<string, ImplementationCallBindingProjection> {
  const result = new Map<string, ImplementationCallBindingProjection>();
  for (const record of orderEventsForProjection(records)) {
    if (record.recordType !== "observation" || record.kind !== "implementation_call_binding") continue;
    const binding = record as ImplementationCallBindingRecord;
    if (typeof binding.parentSessionId !== "string" || typeof binding.callId !== "string") continue;
    const key = implementationCallBindingKey(binding.parentSessionId, binding.callId);
    const current = result.get(key);
    const refs: readonly TaskExecutionRef[] =
      current === undefined
        ? []
        : current.kind === "bound"
          ? [current.taskExecutionRef]
          : current.taskExecutionRefs;
    if (!isWellFormedImplementationCallBinding(binding)) {
      result.set(key, {
        kind: "conflict",
        parentSessionId: binding.parentSessionId,
        callId: binding.callId,
        taskExecutionRefs: refs,
      });
      continue;
    }
    const ref: TaskExecutionRef = {
      authorizationId: binding.taskExecutionRef.authorizationId,
      taskId: binding.taskExecutionRef.taskId,
      attemptId: binding.taskExecutionRef.attemptId,
    };
    if (current === undefined) {
      result.set(key, {
        kind: "bound",
        parentSessionId: binding.parentSessionId,
        callId: binding.callId,
        taskExecutionRef: ref,
      });
    } else if (
      current.kind === "bound" &&
      taskExecutionRefIdentity(current.taskExecutionRef) === taskExecutionRefIdentity(ref)
    ) {
      continue;
    } else {
      result.set(key, {
        kind: "conflict",
        parentSessionId: binding.parentSessionId,
        callId: binding.callId,
        taskExecutionRefs: [...refs, ref],
      });
    }
  }
  return result;
}

function sameCorrelation(left: ReviewCorrelation | undefined, right: ReviewCorrelation): boolean {
  return left !== undefined && sameReviewCorrelation(left, right);
}

export type CompletedReviewCallHistory =
  | { readonly kind: "proven"; readonly callId: string; readonly artifactId: string }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "conflict"; readonly reason: string };

type ReviewDispatchRecord = Extract<
  PersistedLogRecord,
  { readonly recordType: "observation"; readonly kind: "review_dispatch_transition" }
>;
type ReviewCompletionStagedRecord = Extract<
  PersistedLogRecord,
  { readonly recordType: "observation"; readonly kind: "review_completion_staged" }
>;

/**
 * F-002 Review Binding history: once a review slot is terminal the claimed-only
 * `taskCallBindings` projection is empty, so the formal attribution is proven from
 * the durable `pending -> claimed` record (callId, artifact reservation), the
 * successful `claimed -> terminal` record, and the `review_completion_staged`
 * record, all required to name the same parent session, call, correlation and
 * artifact identity. Missing pieces are `missing`; disagreeing pieces are a
 * `conflict`. Nothing is inferred from ordering or scope.
 */
export function projectCompletedReviewCallHistory(
  records: readonly PersistedLogRecord[],
  parentSessionId: string,
  correlation: ReviewCorrelation,
): CompletedReviewCallHistory {
  const dispatch = records.filter(
    (record): record is ReviewDispatchRecord =>
      record.recordType === "observation" &&
      record.kind === "review_dispatch_transition" &&
      record.parentSessionId === parentSessionId &&
      sameCorrelation(record.correlation, correlation),
  );
  const claimed = dispatch.filter((record) => record.from === "pending" && record.to === "claimed");
  if (claimed.length === 0) return { kind: "missing", reason: "claimed_history_missing" };
  if (claimed.length > 1) return { kind: "conflict", reason: "multiple_claimed_history" };
  const claim = claimed[0];
  if (claim === undefined || !("callId" in claim) || !("artifactReservation" in claim))
    return { kind: "missing", reason: "claimed_history_missing" };
  const callId = claim.callId;
  if (!isNonEmpty(callId)) return { kind: "missing", reason: "claimed_call_missing" };
  const reservation = claim.artifactReservation;
  if (reservation.status !== "usable")
    return { kind: "missing", reason: "artifact_reservation_unusable" };

  const terminals = dispatch.filter(
    (record) => record.to === "terminal" && "terminalReason" in record && record.terminalReason === "completed",
  );
  if (terminals.length === 0) return { kind: "missing", reason: "completed_terminal_missing" };
  if (terminals.length > 1) return { kind: "conflict", reason: "multiple_completed_terminals" };
  const terminal = terminals[0];
  if (terminal === undefined || terminal.to !== "terminal")
    return { kind: "missing", reason: "completed_terminal_missing" };
  if (terminal.from !== "claimed" || terminal.callId === undefined)
    return { kind: "missing", reason: "terminal_call_missing" };
  if (terminal.callId !== callId) return { kind: "conflict", reason: "terminal_call_mismatch" };

  const stagings = records.filter(
    (record): record is ReviewCompletionStagedRecord =>
      record.recordType === "observation" &&
      record.kind === "review_completion_staged" &&
      record.parentSessionId === parentSessionId &&
      sameCorrelation(record.staging.correlation, correlation),
  );
  if (stagings.length === 0) return { kind: "missing", reason: "completion_staging_missing" };
  if (stagings.length > 1) return { kind: "conflict", reason: "multiple_completion_stagings" };
  const staged = stagings[0];
  if (staged === undefined) return { kind: "missing", reason: "completion_staging_missing" };
  const staging = staged.staging;
  if (staging.callId !== callId) return { kind: "conflict", reason: "staging_call_mismatch" };
  if (staging.artifactConsumption.artifactId !== reservation.artifactId)
    return { kind: "conflict", reason: "staging_artifact_mismatch" };
  const artifact = staging.reviewArtifact;
  const observed = staging.observedExecution;
  if (
    !sameCorrelation(artifact.correlation, correlation) ||
    observed.parentSessionId !== parentSessionId ||
    observed.callId !== callId ||
    !sameCorrelation(observed.correlation, correlation) ||
    artifact.observedExecution.callId !== callId ||
    artifact.observedExecution.parentSessionId !== parentSessionId ||
    artifact.observedExecution.childSessionId !== observed.childSessionId ||
    artifact.observedExecution.reviewExecutionEventId !== observed.reviewExecutionEventId ||
    !sameCorrelationIdentity(artifact.observedExecution.correlation, observed.correlation)
  )
    return { kind: "conflict", reason: "staging_identity_mismatch" };
  if (artifact.complete !== true || artifact.findings.length !== 0)
    return { kind: "conflict", reason: "staging_artifact_not_clean" };
  if (
    terminal.artifactConsumption !== undefined &&
    (terminal.artifactConsumption.artifactId !== staging.artifactConsumption.artifactId ||
      terminal.artifactConsumption.digest !== staging.artifactConsumption.digest)
  )
    return { kind: "conflict", reason: "terminal_artifact_mismatch" };
  if (
    terminal.reviewArtifact !== undefined &&
    (!sameCorrelation(terminal.reviewArtifact.correlation, correlation) ||
      terminal.reviewArtifact.observedExecution.callId !== callId)
  )
    return { kind: "conflict", reason: "terminal_artifact_mismatch" };
  return { kind: "proven", callId, artifactId: reservation.artifactId };
}

/**
 * Pure deterministic fold from an event log to `ProjectedState` (§6.3).
 * Ordering is delegated to `orderEventsForProjection` so replays are stable.
 * Observation and decision handling are delegated to `applyObservationEvent`/
 * `applyDecisionEvent` to keep this function's branching shallow.
 */
export function project(events: readonly PersistedLogRecord[], rebuiltAt: string): ProjectedState {
  const sorted = orderEventsForProjection(events);
  const reviewDispatchSlots = foldReviewDispatchSlots(sorted);

  const maxSequenceByShard = computeMaxSequenceByShard(sorted);
  const tasks = new Map<string, MutableTask>();
  const latestMessageClaims = new Map<string, LatestMessageClaims>();
  const lifecycle: MutableLifecycle = {
    currentTaskExecutionRefs: new Map(),
    taskStates: new Map(),
    finalization: new Map(),
    lastTransitionIdentities: new Map(),
    lastFinalizationTransitionIdentities: new Map(),
  };

  for (const event of sorted) {
    const baseRef = {
      agentId: event.agentId,
      sessionId: event.sessionId,
      writerId: event.writerId,
      sequence: event.sequence,
    };

    if (event.recordType === "observation") {
      applyObservationEvent(tasks, latestMessageClaims, event, baseRef, lifecycle);
    } else if (event.recordType === "decision") {
      applyDecisionEvent(tasks, event);
    }
  }

  return {
    schemaVersion: 2,
    rebuiltAt,
    integrity: {
      sourceHash: computeSourceHash(sorted),
      maxSequenceByShard,
    },
    tasks,
    lifecycle,
    reviewDispatchSlots,
    taskCallBindings: taskCallBindingsFor(reviewDispatchSlots),
    delegatedExecutionBindings: projectDelegatedExecutionBindings(sorted),
    reviewSummary: aggregateReviews(
      sorted.filter((event): event is ObservationRecord => event.recordType === "observation"),
    ),
  };
}

type SerializedProjectedState = {
  readonly schemaVersion: 2;
  readonly rebuiltAt: string;
  readonly integrity: {
    readonly sourceHash: string;
    readonly maxSequenceByShard: Record<string, number>;
  };
  readonly tasks: Record<string, ProjectedTask>;
  readonly reviewSummary: ScopeReviewSummary & {
    readonly authority: "observed_review_output";
    readonly byScope: Record<string, ScopeReviewSummary>;
  };
  readonly lifecycle?: {
    readonly currentTaskExecutionRefs: Record<string, TaskExecutionRef>;
    readonly taskStates: Record<string, TaskProgressState>;
    readonly finalization: Record<string, FinalizationContext>;
  };
  readonly reviewDispatchSlots?: readonly ReviewDispatchSlot[];
  readonly taskCallBindings?: readonly TaskCallBinding[];
  readonly delegatedExecutionBindings?: readonly DelegatedExecutionBinding[];
};

/**
 * Converts `ProjectedState` (which uses `ReadonlyMap` for in-memory immutability)
 * into a plain JSON-serializable object for `state.json`.
 */
export function toSerializableProjectedState(state: ProjectedState): SerializedProjectedState {
  return {
    schemaVersion: state.schemaVersion,
    rebuiltAt: state.rebuiltAt,
    integrity: {
      sourceHash: state.integrity.sourceHash,
      maxSequenceByShard: Object.fromEntries(state.integrity.maxSequenceByShard),
    },
    tasks: Object.fromEntries(state.tasks),
    reviewSummary: {
      authority: state.reviewSummary.authority,
      critical: state.reviewSummary.critical,
      major: state.reviewSummary.major,
      minor: state.reviewSummary.minor,
      resolved: state.reviewSummary.resolved,
      open: state.reviewSummary.open,
      byScope: Object.fromEntries(state.reviewSummary.byScope),
    },
    lifecycle: {
      currentTaskExecutionRefs: Object.fromEntries(state.lifecycle.currentTaskExecutionRefs),
      taskStates: Object.fromEntries(state.lifecycle.taskStates),
      finalization: Object.fromEntries(state.lifecycle.finalization),
    },
    reviewDispatchSlots: state.reviewDispatchSlots,
    taskCallBindings: state.taskCallBindings,
    delegatedExecutionBindings: state.delegatedExecutionBindings,
  };
}

/**
 * Rebuilds a `ProjectedState` (with `ReadonlyMap` fields) from a parsed
 * `state.json` object. Callers should structurally validate before invoking.
 */
export function fromSerializableProjectedState(obj: unknown): ProjectedState {
  const raw = obj as SerializedProjectedState;
  return {
    schemaVersion: raw.schemaVersion,
    rebuiltAt: raw.rebuiltAt,
    integrity: {
      sourceHash: raw.integrity.sourceHash,
      maxSequenceByShard: new Map(Object.entries(raw.integrity.maxSequenceByShard)),
    },
    tasks: new Map(Object.entries(raw.tasks)),
    reviewSummary: {
      authority: raw.reviewSummary.authority,
      critical: raw.reviewSummary.critical,
      major: raw.reviewSummary.major,
      minor: raw.reviewSummary.minor,
      resolved: raw.reviewSummary.resolved,
      open: raw.reviewSummary.open,
      byScope: new Map(Object.entries(raw.reviewSummary.byScope)),
    },
    lifecycle: {
      currentTaskExecutionRefs: new Map(
        Object.entries(raw.lifecycle?.currentTaskExecutionRefs ?? {}),
      ),
      taskStates: new Map(Object.entries(raw.lifecycle?.taskStates ?? {})) as Map<
        string,
        TaskProgressState
      >,
      finalization: new Map(Object.entries(raw.lifecycle?.finalization ?? {})),
    },
    reviewDispatchSlots: raw.reviewDispatchSlots ?? [],
    taskCallBindings: raw.taskCallBindings ?? [],
    delegatedExecutionBindings: raw.delegatedExecutionBindings ?? [],
  };
}
