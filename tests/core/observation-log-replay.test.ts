// tests/core/observation-log-replay.test.ts
import { describe, expect, it } from "vitest";
import { project } from "../../src/core/v2/state-projection";
import type { ObservationRecord, DecisionRecord } from "../../src/core/v2/observation-model";

describe("FF-004 replay determinism and state validation", () => {
  it("same events produce same state and correctly map taskId, decision records, and reviews", () => {
    const events: (ObservationRecord | DecisionRecord)[] = [
      {
        schemaVersion: 1,
        sequence: 1,
        timestamp: "2026-06-28T12:00:00Z",
        agentId: "atlas",
        sessionId: "session-123",
        writerId: "w1",
        recordType: "observation",
        kind: "tool_executed",
        toolName: "task",
        callId: "c1",
        taskId: "task-1",
        evidence: {
          evidenceId: "ev-1",
          kind: "test",
          sourceClass: "tool_output",
          toolOutputClass: "command_exec",
          provenance: "observed",
          command: "bun run test",
          rawOutput: "1 passed",
          interpretation: {
            outcome: "pass",
            provenance: "derived",
            basis: "parsed_output",
            derivedFrom: [],
          },
        },
      },
      {
        schemaVersion: 1,
        sequence: 2,
        timestamp: "2026-06-28T12:01:00Z",
        agentId: "atlas",
        sessionId: "session-123",
        writerId: "w1",
        recordType: "decision",
        gateType: "task",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        verdict: "PASS",
        ruleResults: [
          {
            ruleId: "gate-1",
            verdict: "PASS",
            reason: "All tests passed",
            evidenceRefs: [
              { kind: "full", agentId: "atlas", sessionId: "session-123", writerId: "w1", sequence: 1, evidenceId: "ev-1" },
            ],
          },
        ],
      },
    ];

    const a = project(events, "2026-06-28T12:05:00Z");
    const b = project(events, "2026-06-28T12:05:00Z");

    // Determinism.
    expect(a).toEqual(b);
    expect(a.integrity.sourceHash).toBe(b.integrity.sourceHash);

    // Verdict/state and evidence mapping.
    const taskInfo = a.tasks.get("task-1");
    expect(taskInfo).toBeDefined();
    expect(taskInfo?.status).toBe("PASS");
    expect(taskInfo?.evidence.length).toBe(1);
    expect(taskInfo?.evidence[0]?.ref.evidenceId).toBe("ev-1");
  });
});
