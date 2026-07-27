import { describe, expect, it } from "vitest";
import {
  buildWorkflowPhaseRecord,
  buildWorkflowStartedRecord,
} from "../../../src/core/v2/record-builder";
import { hashString } from "../../../src/core/v2/hash";
import { redactPendingLogRecord } from "../../../src/core/v2/persistence-redaction";
import { validateRecordSchema } from "../../../src/runtime/validation";
import type { PendingEnvelope } from "../../../src/core/v2/observation-model";
import type { WorkflowBootstrapPhase, WorkflowStartRequest } from "../../../src/core/types";

function createEnvelope(): PendingEnvelope {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-27T00:00:00.000Z",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-test",
    recordType: "observation",
  };
}

function createRequest(overrides: Partial<WorkflowStartRequest> = {}): WorkflowStartRequest {
  return {
    source: "command",
    goal: "ship the workflow activation feature",
    designPath: null,
    planPath: null,
    ...overrides,
  };
}

describe("buildWorkflowStartedRecord", () => {
  it("builds a single workflow_started observation record carrying the resolved phase", () => {
    const record = buildWorkflowStartedRecord({
      envelope: createEnvelope(),
      request: createRequest({ designPath: "docs/design.md", planPath: "docs/plan.md" }),
      phase: "plan_ready",
    });

    expect(record.recordType).toBe("observation");
    expect(record.kind).toBe("workflow_started");
    if (record.kind !== "workflow_started") throw new Error("expected workflow_started");
    expect(record.workflow).toEqual({
      phase: "plan_ready",
      source: "command",
      goalHash: hashString("ship the workflow activation feature"),
      goalSnippet: "ship the workflow activation feature",
      designPath: "docs/design.md",
      planPath: "docs/plan.md",
    });
  });

  it("omits designPath/planPath when the request carries none", () => {
    const record = buildWorkflowStartedRecord({
      envelope: createEnvelope(),
      request: createRequest(),
      phase: "design_required",
    });

    if (record.kind !== "workflow_started") throw new Error("expected workflow_started");
    expect(record.workflow).not.toHaveProperty("designPath");
    expect(record.workflow).not.toHaveProperty("planPath");
  });

  it("never persists the goal verbatim: hashes it and redacts the snippet", () => {
    const goal = "deploy with sk-ant-abcdefghijklmnopqrstuvwxyz012345 from /home/someone/secrets";
    const record = buildWorkflowStartedRecord({
      envelope: createEnvelope(),
      request: createRequest({ goal }),
      phase: "plan_required",
    });

    if (record.kind !== "workflow_started") throw new Error("expected workflow_started");
    expect(record.workflow.goalHash).toBe(hashString(goal));
    expect(record.workflow.goalSnippet).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz012345");
    expect(record.workflow.goalSnippet).not.toContain("/home/someone/secrets");
    expect(record.workflow.goalSnippet).toContain("[REDACTED_PATH]");
  });

  it("truncates the goal snippet to the message-snippet budget", () => {
    const goal = "g".repeat(500);
    const record = buildWorkflowStartedRecord({
      envelope: createEnvelope(),
      request: createRequest({ goal }),
      phase: "plan_required",
    });

    if (record.kind !== "workflow_started") throw new Error("expected workflow_started");
    expect(record.workflow.goalSnippet).toHaveLength(200);
  });

  it("carries no evidence field so it can never be counted toward a Gate PASS (FF-008)", () => {
    const record = buildWorkflowStartedRecord({
      envelope: createEnvelope(),
      request: createRequest(),
      phase: "plan_ready",
    });

    expect(record).not.toHaveProperty("evidence");
    expect(record).not.toHaveProperty("declaredClaims");
  });
});

describe("buildWorkflowPhaseRecord", () => {
  const cases: readonly (readonly [WorkflowBootstrapPhase, string])[] = [
    ["design_required", "design_requested"],
    ["plan_required", "plan_requested"],
    ["plan_ready", "plan_activated"],
  ];

  for (const [phase, expectedKind] of cases) {
    it(`maps phase ${phase} to exactly one ${expectedKind} record`, () => {
      const record = buildWorkflowPhaseRecord({
        envelope: createEnvelope(),
        request: createRequest(),
        phase,
      });

      expect(record.recordType).toBe("observation");
      expect(record.kind).toBe(expectedKind);
      expect(record).not.toHaveProperty("evidence");
    });
  }

  it("redacts absolute paths reaching the audit payload", () => {
    const record = buildWorkflowPhaseRecord({
      envelope: createEnvelope(),
      request: createRequest({
        designPath: "/home/someone/project/design.md",
        planPath: "/home/someone/project/plan.md",
      }),
      phase: "plan_ready",
    });

    if (record.kind !== "plan_activated") throw new Error("expected plan_activated");
    expect(record.workflow.designPath).toBe("[REDACTED_PATH]");
    expect(record.workflow.planPath).toBe("[REDACTED_PATH]");
  });
});

describe("workflow bootstrap records at the persistence boundary", () => {
  const phases: readonly WorkflowBootstrapPhase[] = [
    "design_required",
    "plan_required",
    "plan_ready",
  ];

  it("survives redactPendingLogRecord unchanged when already redacted (idempotent)", () => {
    for (const phase of phases) {
      const input = { envelope: createEnvelope(), request: createRequest(), phase };
      for (const record of [buildWorkflowStartedRecord(input), buildWorkflowPhaseRecord(input)]) {
        expect(redactPendingLogRecord(record)).toEqual(record);
      }
    }
  });

  it("redacts secrets injected directly into the record by a non-builder caller", () => {
    const record = buildWorkflowStartedRecord({
      envelope: createEnvelope(),
      request: createRequest(),
      phase: "plan_ready",
    });
    if (record.kind !== "workflow_started") throw new Error("expected workflow_started");

    const tampered = {
      ...record,
      workflow: {
        ...record.workflow,
        goalSnippet: "leak sk-ant-abcdefghijklmnopqrstuvwxyz012345",
        designPath: "/home/someone/design.md",
      },
    };

    const redacted = redactPendingLogRecord(tampered);
    if (redacted.recordType !== "observation" || redacted.kind !== "workflow_started") {
      throw new Error("expected workflow_started");
    }
    expect(redacted.workflow.goalSnippet).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz012345");
    expect(redacted.workflow.designPath).toBe("[REDACTED_PATH]");
  });

  it("passes the persisted schema validation for every bootstrap kind", () => {
    let sequence = 0;
    for (const phase of phases) {
      const input = { envelope: createEnvelope(), request: createRequest(), phase };
      for (const record of [buildWorkflowStartedRecord(input), buildWorkflowPhaseRecord(input)]) {
        sequence += 1;
        expect(() => validateRecordSchema({ ...record, sequence })).not.toThrow();
      }
    }
  });

  it("rejects a bootstrap record with a malformed audit payload", () => {
    const record = buildWorkflowStartedRecord({
      envelope: createEnvelope(),
      request: createRequest(),
      phase: "plan_ready",
    });
    if (record.kind !== "workflow_started") throw new Error("expected workflow_started");

    expect(() =>
      validateRecordSchema({
        ...record,
        sequence: 1,
        workflow: { ...record.workflow, phase: "not_a_phase" },
      }),
    ).toThrow("Invalid workflow bootstrap record");
    expect(() => validateRecordSchema({ ...record, sequence: 1, workflow: null })).toThrow(
      "Invalid workflow bootstrap record",
    );
  });
});
