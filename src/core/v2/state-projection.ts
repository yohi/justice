// src/core/v2/state-projection.ts
import type { FullEvidenceRef } from "../types";
import {
  computeMaxSequenceByShard,
  computeSourceHash,
  orderEventsForProjection,
} from "./integrity";
import type { Evidence, PersistedLogRecord } from "./observation-model";
import { toEvidenceArray } from "./evidence-list";
import type { Verdict } from "./decision-model";

export type ProjectedEvidence = {
  readonly evidence: Evidence;
  readonly ref: FullEvidenceRef;
};

export type ReviewSummaryItem = {
  readonly itemKey: string;
  readonly ref: FullEvidenceRef;
  readonly severity: "critical" | "major" | "minor";
};

export type ScopeReviewSummary = {
  readonly critical: readonly ReviewSummaryItem[];
  readonly major: readonly ReviewSummaryItem[];
  readonly minor: readonly ReviewSummaryItem[];
  readonly resolved: readonly ReviewSummaryItem[];
  readonly open: readonly ReviewSummaryItem[];
};

export type ReviewSummary = ScopeReviewSummary & {
  readonly authority: "observed_review_output";
  readonly byScope: ReadonlyMap<string, ScopeReviewSummary>;
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
  readonly schemaVersion: 1;
  readonly rebuiltAt: string;
  readonly integrity: {
    readonly sourceHash: string;
    readonly maxSequenceByShard: ReadonlyMap<string, number>;
  };
  readonly tasks: ReadonlyMap<string, ProjectedTask>;
  readonly reviewSummary: ReviewSummary;
};

type MutableScopeSummary = {
  critical: ReviewSummaryItem[];
  major: ReviewSummaryItem[];
  minor: ReviewSummaryItem[];
  resolved: ReviewSummaryItem[];
  open: ReviewSummaryItem[];
};

type MutableTask = {
  status: TaskStatus;
  lastVerdict: TaskVerdict;
  evidence: ProjectedEvidence[];
  observedReviewScopes: string[];
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

function emptyScopeSummary(): MutableScopeSummary {
  return { critical: [], major: [], minor: [], resolved: [], open: [] };
}

function foldReviewSummary(sorted: readonly PersistedLogRecord[]): ReviewSummary {
  const global = emptyScopeSummary();
  const byScope = new Map<string, MutableScopeSummary>();

  const ensureScope = (scope: string): MutableScopeSummary => {
    const existing = byScope.get(scope);
    if (existing) return existing;
    const created = emptyScopeSummary();
    byScope.set(scope, created);
    return created;
  };

  for (const event of sorted) {
    if (event.recordType !== "observation" || event.kind !== "review_observed") continue;
    const scopeSummary = ensureScope(event.reviewScope);
    for (const item of event.items) {
      const projected: ReviewSummaryItem = {
        itemKey: item.itemKey,
        ref: {
          agentId: event.agentId,
          sessionId: event.sessionId,
          writerId: event.writerId,
          sequence: event.sequence,
          kind: "full",
          evidenceId: item.evidenceId,
        },
        severity: item.severity,
      };

      if (item.severity === "critical") {
        global.critical.push(projected);
        scopeSummary.critical.push(projected);
      } else if (item.severity === "major") {
        global.major.push(projected);
        scopeSummary.major.push(projected);
      } else {
        global.minor.push(projected);
        scopeSummary.minor.push(projected);
      }

      if (item.status === "resolved") {
        global.resolved.push(projected);
        scopeSummary.resolved.push(projected);
      } else {
        global.open.push(projected);
        scopeSummary.open.push(projected);
      }
    }
  }

  return { authority: "observed_review_output", ...global, byScope };
}

function applyObservationEvent(
  tasks: Map<string, MutableTask>,
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
  } else if (event.kind === "review_observed") {
    if (event.reviewScope) taskState.observedReviewScopes.push(event.reviewScope);
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

  for (const event of sorted) {
    const baseRef = {
      agentId: event.agentId,
      sessionId: event.sessionId,
      writerId: event.writerId,
      sequence: event.sequence,
    };

    if (event.recordType === "observation") {
      applyObservationEvent(tasks, event, baseRef);
    } else if (event.recordType === "decision") {
      applyDecisionEvent(tasks, event);
    }
  }

  return {
    schemaVersion: 1,
    rebuiltAt,
    integrity: {
      sourceHash: computeSourceHash(sorted),
      maxSequenceByShard,
    },
    tasks,
    reviewSummary: foldReviewSummary(sorted),
  };
}

type SerializedProjectedState = {
  readonly schemaVersion: 1;
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
