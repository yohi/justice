// src/core/v2/state-projection.ts
import type { FullEvidenceRef } from "../types";
import {
  computeMaxSequenceByShard,
  computeSourceHash,
  orderEventsForProjection,
} from "./integrity";
import type { Evidence, ObservationRecord, PersistedLogRecord } from "./observation-model";
import { toEvidenceArray } from "./evidence-list";
import type { Verdict } from "./decision-model";
import type { ReviewSummary, ScopeReviewSummary } from "./review-types";
export type { ReviewSummary, ReviewSummaryItem, ScopeReviewSummary } from "./review-types";
import { aggregateReviews } from "./review-aggregator";

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
};

type MutableTask = {
  status: TaskStatus;
  lastVerdict: TaskVerdict;
  evidence: ProjectedEvidence[];
  observedReviewScopes: string[];
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

function applyObservationEvent(
  tasks: Map<string, MutableTask>,
  latestMessageClaims: Map<string, LatestMessageClaims>,
  event: Extract<PersistedLogRecord, { recordType: "observation" }>,
  baseRef: Pick<PersistedLogRecord, "agentId" | "sessionId" | "writerId" | "sequence">,
): void {
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

  for (const event of sorted) {
    const baseRef = {
      agentId: event.agentId,
      sessionId: event.sessionId,
      writerId: event.writerId,
      sequence: event.sequence,
    };

    if (event.recordType === "observation") {
      applyObservationEvent(tasks, latestMessageClaims, event, baseRef);
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
  };
}
