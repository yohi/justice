// src/core/v2/state-projection.ts
import type { FullEvidenceRef, TaskExecutionRef } from "../types";
import {
  computeMaxSequenceByShard,
  computeSourceHash,
  orderEventsForProjection,
} from "./integrity";
import type {
  Evidence,
  ObservationRecord,
  PersistedLogRecord,
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
  readonly finalization?: FinalizationContext;
};

type MutableTask = {
  status: TaskStatus;
  lastVerdict: TaskVerdict;
  evidence: ProjectedEvidence[];
  observedReviewScopes: string[];
};

type MutableLifecycle = {
  currentTaskExecutionRefs: Map<string, TaskExecutionRef>;
  taskStates: Map<string, TaskProgressState>;
  finalization?: FinalizationContext;
  lastTransitionIdentities: Map<string, string>;
  lastFinalizationTransitionIdentity?: string;
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

function applyTaskLifecycleObservation(
  tasks: Map<string, MutableTask>,
  event: TaskLifecycleObservation,
  lifecycle: MutableLifecycle,
): void {
  const taskId = event.taskExecutionRef.taskId;
  ensureTask(tasks, taskId);
  const currentRef = lifecycle.currentTaskExecutionRefs.get(taskId);
  const identity = JSON.stringify(event.taskExecutionRef);
  if (currentRef !== undefined && JSON.stringify(currentRef) !== identity) {
    if (lifecycle.taskStates.get(taskId) !== "rework_required") return;
  }
  const current = lifecycle.taskStates.get(taskId) ?? "pending";
  const outcome = applyTaskTransition(
    {
      value: current,
      lastTransitionIdentity: lifecycle.lastTransitionIdentities.get(taskId),
    },
    {
      identity,
      from: event.from,
      to: event.to,
    },
  );
  if (outcome.kind === "applied") {
    lifecycle.taskStates.set(taskId, outcome.state);
    lifecycle.currentTaskExecutionRefs.set(taskId, event.taskExecutionRef);
    lifecycle.lastTransitionIdentities.set(taskId, identity);
  }
}

function applyPlanFinalizationObservation(
  event: PlanFinalizationObservation,
  lifecycle: MutableLifecycle,
): void {
  const current = lifecycle.finalization?.state ?? "tasks_pending";
  const identity = JSON.stringify([
    event.authorizationId,
    event.planPath,
    event.finalizationAttemptId,
    event.finalReviewRound,
  ]);
  const outcome = applyPlanTransition(
    {
      value: current,
      lastTransitionIdentity: lifecycle.lastFinalizationTransitionIdentity,
    },
    {
      identity,
      from: event.from,
      to: event.to,
    },
  );
  if (outcome.kind !== "applied") return;
  lifecycle.finalization = {
    parentSessionId: event.parentSessionId,
    authorizationId: event.authorizationId,
    planPath: event.planPath,
    finalizationAttemptId: event.finalizationAttemptId,
    finalReviewRound: event.finalReviewRound,
    state: outcome.state,
  };
  lifecycle.lastFinalizationTransitionIdentity = identity;
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
  const taskId = event.taskId;
  if (!taskId) return;
  const taskState = ensureTask(tasks, taskId);
  taskState.lastVerdict = event.verdict;
  taskState.status = event.verdict;
}

/**
 * Pure deterministic fold from an event log to `ProjectedState` (§6.3).
 * Ordering is delegated to `orderEventsForProjection` so replays are stable.
 * Observation and decision handling are delegated to `applyObservationEvent`/
 * `applyDecisionEvent` to keep this function's branching shallow.
 */
export function project(events: readonly PersistedLogRecord[], rebuiltAt: string): ProjectedState {
  const sorted = orderEventsForProjection(events);

  const maxSequenceByShard = computeMaxSequenceByShard(sorted);
  const tasks = new Map<string, MutableTask>();
  const latestMessageClaims = new Map<string, LatestMessageClaims>();
  const lifecycle: MutableLifecycle = {
    currentTaskExecutionRefs: new Map(),
    taskStates: new Map(),
    lastTransitionIdentities: new Map(),
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
    readonly finalization?: FinalizationContext;
  };
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
      finalization: state.lifecycle.finalization,
    },
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
      currentTaskExecutionRefs: new Map(Object.entries(raw.lifecycle?.currentTaskExecutionRefs ?? {})),
      taskStates: new Map(Object.entries(raw.lifecycle?.taskStates ?? {})) as Map<string, TaskProgressState>,
      finalization: raw.lifecycle?.finalization,
    },
  };
}
