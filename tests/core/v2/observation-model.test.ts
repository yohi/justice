// tests/core/v2/observation-model.test.ts
import { describe, expect, it } from "vitest";
import type { ObservationRecord } from "../../../src/core/v2/observation-model";

describe("ObservationRecord type", () => {
  it("tool_executed record is assignable", () => {
    const r: ObservationRecord = {
      schemaVersion: 1,
      sequence: 1,
      timestamp: "2026-06-26T00:00:00.000Z",
      agentId: "hephaestus",
      sessionId: "ses_1",
      writerId: "w-1",
      taskId: "task-1",
      recordType: "observation",
      kind: "tool_executed",
      toolName: "bash",
      callId: "call_1",
      evidence: {
        evidenceId: "ev-1",
        kind: "test",
        sourceClass: "tool_output",
        provenance: "observed",
        toolOutputClass: "command_exec",
        command: "bun run test",
        rawOutput: "PASS",
      },
    };
    expect(r.recordType).toBe("observation");
  });

  it("message record is assignable", () => {
    const r: ObservationRecord = {
      schemaVersion: 1,
      sequence: 2,
      timestamp: "2026-06-26T00:00:00.000Z",
      agentId: "hephaestus",
      sessionId: "ses_1",
      writerId: "w-1",
      recordType: "observation",
      kind: "message",
      messageID: "msg-1",
      role: "assistant",
      textHash: "sha256:abc",
      finalized: true,
    };
    expect(r.kind).toBe("message");
  });

  it("review_observed record is assignable", () => {
    const r: ObservationRecord = {
      schemaVersion: 1,
      sequence: 3,
      timestamp: "2026-06-26T00:00:00.000Z",
      agentId: "hephaestus",
      sessionId: "ses_1",
      writerId: "w-1",
      recordType: "observation",
      kind: "review_observed",
      reviewScope: "task",
      items: [],
    };
    expect(r.kind).toBe("review_observed");
  });
});
