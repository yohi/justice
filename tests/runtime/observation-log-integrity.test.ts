import { describe, expect, it } from "vitest";
import {
  validateRecordSchema,
  validatePhysicalFileSequenceOrder,
  validateShardSequences,
} from "../../src/runtime/validation";
import type { PersistedLogRecord } from "../../src/core/v2/observation-model";

function baseRecord(kind: string, sequence: number): PersistedLogRecord {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-20T00:00:00.000Z",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-1",
    recordType: "observation",
    sequence,
    kind,
    ...(kind === "tool_executed"
      ? {
          toolName: "bash",
          callId: "c1",
          evidence: [
            {
              evidenceId: "c1",
              kind: "command",
              sourceClass: "tool_output",
              provenance: "observed",
              toolOutputClass: "command_exec",
              command: "echo hi",
              rawOutput: "hi",
            },
          ],
        }
      : kind === "message"
        ? {
            messageID: "m1",
            role: "assistant",
            textHash: "sha256:x",
            textSnippet: "hi",
            declaredClaims: [],
            evidence: [],
            finalized: true,
          }
        : kind === "skill_invoked"
          ? { skillName: "writing-plans", source: "skill_tool" }
          : kind === "review_observed"
            ? { reviewScope: "scope-1", items: [] }
            : kind === "session_error"
              ? { errorKind: "unknown", message: "error" }
              : kind === "reflection"
                ? {
                    reflection: {
                      trigger: "task_succeeded",
                      planRef: { path: "plan.md", taskId: "task-1" },
                      intent: "check_complete",
                    },
                  }
                : {}),
  } as unknown as PersistedLogRecord;
}

describe("observation log integrity", () => {
  it("validates record schema for all supported kinds", () => {
    for (const kind of ["tool_executed", "message", "skill_invoked", "review_observed", "session_error", "reflection"]) {
      expect(() => validateRecordSchema(baseRecord(kind, 1))).not.toThrow();
    }
  });

  it("throws for unknown observation kind", () => {
    expect(() => validateRecordSchema(baseRecord("unknown_kind", 1))).toThrow("unknown observation kind");
  });

  it("throws for missing common envelope fields", () => {
    const record = { ...baseRecord("tool_executed", 1), agentId: undefined };
    expect(() => validateRecordSchema(record)).toThrow();
  });

  it("throws for invalid tool_executed evidence", () => {
    const record = {
      ...baseRecord("tool_executed", 1),
      evidence: [{ evidenceId: "c1", kind: "test", sourceClass: "tool_output", provenance: "observed" }],
    };
    expect(() => validateRecordSchema(record)).toThrow();
  });

  it("throws for physical sequence inversion", () => {
    const records = [baseRecord("tool_executed", 2), baseRecord("tool_executed", 1)];
    expect(() => validatePhysicalFileSequenceOrder(records)).toThrow("Physical sequence order violation");
  });

  it("throws for duplicate sequences within a shard", () => {
    const records = [baseRecord("tool_executed", 1), baseRecord("tool_executed", 1)];
    expect(() => validateShardSequences(records)).toThrow("duplicate sequence detected");
  });

  it("throws for sequence gaps within a shard", () => {
    const records = [baseRecord("tool_executed", 2)];
    expect(() => validateShardSequences(records)).toThrow("gap detected");
  });
});
