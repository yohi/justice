// src/core/v2/workflow-bootstrap-projection.ts
import type { ShardId } from "../types";
import { orderEventsForProjection } from "./integrity";
import type {
  ObservationRecord,
  PersistedLogRecord,
  WorkflowBootstrapAudit,
  WorkflowBootstrapRecordKind,
} from "./observation-model";

export type WorkflowBootstrapObservation = Extract<
  ObservationRecord,
  { readonly kind: WorkflowBootstrapRecordKind }
>;

/** Shard-qualified pointer at the originating log record (no evidence identity). */
export type WorkflowBootstrapAuditRef = ShardId & {
  readonly sequence: number;
};

export type WorkflowBootstrapAuditEntry = {
  readonly kind: WorkflowBootstrapRecordKind;
  readonly timestamp: string;
  readonly ref: WorkflowBootstrapAuditRef;
  readonly workflow: WorkflowBootstrapAudit;
};

/**
 * Single source of truth for which observation kinds belong to the bootstrap
 * lifecycle. `state-projection` and the persisted-schema validator both consult
 * it so the "audit-only" boundary is defined in exactly one place.
 */
const WORKFLOW_BOOTSTRAP_RECORD_KIND_SET: Readonly<Record<WorkflowBootstrapRecordKind, true>> = {
  workflow_started: true,
  design_requested: true,
  plan_requested: true,
  plan_activated: true,
};

export const WORKFLOW_BOOTSTRAP_RECORD_KINDS: readonly WorkflowBootstrapRecordKind[] = Object.keys(
  WORKFLOW_BOOTSTRAP_RECORD_KIND_SET,
) as WorkflowBootstrapRecordKind[];

export function isWorkflowBootstrapRecordKind(kind: unknown): kind is WorkflowBootstrapRecordKind {
  return typeof kind === "string" && Object.hasOwn(WORKFLOW_BOOTSTRAP_RECORD_KIND_SET, kind);
}

export function isWorkflowBootstrapRecord(
  event: PersistedLogRecord,
): event is WorkflowBootstrapObservation {
  return event.recordType === "observation" && isWorkflowBootstrapRecordKind(event.kind);
}

/**
 * Read-only audit projection of the workflow bootstrap lifecycle.
 *
 * Deliberately separate from `project()`: these records are non-authoritative, so
 * they never enter `ProjectedTask.evidence` and never reach the Gate Engine. The
 * event log stays the source of truth (`.justice/state.json` holds none of this),
 * and ordering is delegated to `orderEventsForProjection` so replays are stable.
 */
export function projectWorkflowBootstrapAudit(
  events: readonly PersistedLogRecord[],
): readonly WorkflowBootstrapAuditEntry[] {
  const entries: WorkflowBootstrapAuditEntry[] = [];
  for (const event of orderEventsForProjection(events)) {
    if (!isWorkflowBootstrapRecord(event)) continue;
    entries.push({
      kind: event.kind,
      timestamp: event.timestamp,
      ref: {
        agentId: event.agentId,
        sessionId: event.sessionId,
        writerId: event.writerId,
        sequence: event.sequence,
      },
      workflow: event.workflow,
    });
  }
  return entries;
}
