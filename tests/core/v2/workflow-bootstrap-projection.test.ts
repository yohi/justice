import { describe, expect, it } from "vitest";
import { project } from "../../../src/core/v2/state-projection";
import { projectWorkflowBootstrapAudit } from "../../../src/core/v2/workflow-bootstrap-projection";
import type {
  ObservationRecord,
  PersistedLogRecord,
  WorkflowBootstrapAudit,
  WorkflowBootstrapRecordKind,
} from "../../../src/core/v2/observation-model";

function audit(overrides: Partial<WorkflowBootstrapAudit> = {}): WorkflowBootstrapAudit {
  return {
    phase: "plan_ready",
    source: "command",
    goalHash: "sha256:goal",
    goalSnippet: "activate the workflow",
    ...overrides,
  };
}

function bootstrapRecord(
  kind: WorkflowBootstrapRecordKind,
  sequence: number,
  overrides: {
    readonly timestamp?: string;
    readonly writerId?: string;
    readonly taskId?: string;
    readonly workflow?: WorkflowBootstrapAudit;
  } = {},
): ObservationRecord {
  return {
    schemaVersion: 1,
    timestamp: overrides.timestamp ?? `2026-07-27T00:00:0${sequence}.000Z`,
    agentId: "atlas",
    sessionId: "session-1",
    writerId: overrides.writerId ?? "w-a",
    ...(overrides.taskId === undefined ? {} : { taskId: overrides.taskId }),
    recordType: "observation",
    sequence,
    kind,
    workflow: overrides.workflow ?? audit(),
  };
}

describe("projectWorkflowBootstrapAudit", () => {
  it("projects every bootstrap kind as a read-only audit entry", () => {
    const events: readonly PersistedLogRecord[] = [
      bootstrapRecord("workflow_started", 1, { workflow: audit({ phase: "design_required" }) }),
      bootstrapRecord("design_requested", 2, { workflow: audit({ phase: "design_required" }) }),
      bootstrapRecord("plan_requested", 3, { workflow: audit({ phase: "plan_required" }) }),
      bootstrapRecord("plan_activated", 4),
    ];

    const entries = projectWorkflowBootstrapAudit(events);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "workflow_started",
      "design_requested",
      "plan_requested",
      "plan_activated",
    ]);
    expect(entries[0]).toEqual({
      kind: "workflow_started",
      timestamp: "2026-07-27T00:00:01.000Z",
      ref: { agentId: "atlas", sessionId: "session-1", writerId: "w-a", sequence: 1 },
      workflow: audit({ phase: "design_required" }),
    });
  });

  it("preserves directiveStage as audit-only metadata separate from phase", () => {
    const events: readonly PersistedLogRecord[] = [
      bootstrapRecord("plan_activated", 1, {
        workflow: audit({
          phase: "plan_ready",
          directiveStage: "plan_review_required",
        }),
      }),
    ];

    const entries = projectWorkflowBootstrapAudit(events);
    const state = project(events, "2026-07-27T01:00:00.000Z");

    expect(entries[0]?.workflow.phase).toBe("plan_ready");
    expect(entries[0]?.workflow.directiveStage).toBe("plan_review_required");
    expect(state.tasks.size).toBe(0);
  });

  it("ignores every non-bootstrap record", () => {
    const events: readonly PersistedLogRecord[] = [
      {
        schemaVersion: 1,
        timestamp: "2026-07-27T00:00:01.000Z",
        agentId: "atlas",
        sessionId: "session-1",
        writerId: "w-a",
        taskId: "task-1",
        recordType: "observation",
        sequence: 1,
        kind: "review_observed",
        reviewScope: "task-1",
        items: [],
      },
      {
        schemaVersion: 1,
        timestamp: "2026-07-27T00:00:02.000Z",
        agentId: "atlas",
        sessionId: "session-1",
        writerId: "w-a",
        taskId: "task-1",
        recordType: "decision",
        sequence: 2,
        gateType: "task",
        verdict: "WARN",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        ruleResults: [],
      },
    ];

    expect(projectWorkflowBootstrapAudit(events)).toEqual([]);
  });

  it("is replay-deterministic regardless of input order", () => {
    const a = bootstrapRecord("workflow_started", 1, {
      writerId: "w-a",
      timestamp: "2026-07-27T00:00:01.000Z",
    });
    const b = bootstrapRecord("plan_requested", 1, {
      writerId: "w-b",
      timestamp: "2026-07-27T00:00:02.000Z",
    });
    const c = bootstrapRecord("plan_activated", 2, {
      writerId: "w-a",
      timestamp: "2026-07-27T00:00:03.000Z",
    });

    const ordered = projectWorkflowBootstrapAudit([a, b, c]);
    const shuffled = projectWorkflowBootstrapAudit([c, b, a]);

    expect(shuffled).toEqual(ordered);
    expect(ordered.map((entry) => entry.kind)).toEqual([
      "workflow_started",
      "plan_requested",
      "plan_activated",
    ]);
  });
});

describe("state projection isolation of workflow bootstrap records", () => {
  const kinds: readonly WorkflowBootstrapRecordKind[] = [
    "workflow_started",
    "design_requested",
    "plan_requested",
    "plan_activated",
  ];

  it("never opens a projected task window, even when the record carries a taskId", () => {
    const events = kinds.map((kind, index) =>
      bootstrapRecord(kind, index + 1, { taskId: "task-1" }),
    );

    const state = project(events, "2026-07-27T01:00:00.000Z");

    expect(state.tasks.size).toBe(0);
    expect(state.reviewSummary.open).toEqual([]);
  });

  it("never contributes evidence to an existing task", () => {
    const toolExecuted: PersistedLogRecord = {
      schemaVersion: 1,
      timestamp: "2026-07-27T00:00:00.000Z",
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "w-a",
      taskId: "task-1",
      recordType: "observation",
      sequence: 0,
      kind: "tool_executed",
      toolName: "bash",
      callId: "c1",
      evidence: [
        {
          evidenceId: "e1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "bun run test",
          rawOutput: "ok",
          interpretation: {
            outcome: "pass",
            basis: "parsed_output",
            provenance: "derived",
            derivedFrom: [{ kind: "self", evidenceId: "e1" }],
          },
        },
      ],
    };

    const withoutBootstrap = project([toolExecuted], "2026-07-27T01:00:00.000Z");
    const withBootstrap = project(
      [
        toolExecuted,
        ...kinds.map((kind, index) => bootstrapRecord(kind, index + 1, { taskId: "task-1" })),
      ],
      "2026-07-27T01:00:00.000Z",
    );

    expect(withBootstrap.tasks.get("task-1")?.evidence).toEqual(
      withoutBootstrap.tasks.get("task-1")?.evidence,
    );
    expect(withBootstrap.tasks.get("task-1")?.status).toBe(
      withoutBootstrap.tasks.get("task-1")?.status,
    );
    expect(withBootstrap.tasks.get("task-1")?.observedReviewScopes).toEqual(
      withoutBootstrap.tasks.get("task-1")?.observedReviewScopes,
    );
  });
});
