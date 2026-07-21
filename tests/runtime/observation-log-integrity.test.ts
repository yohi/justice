import { describe, expect, it } from "vitest";
import {
  validateRecordSchema,
  validatePhysicalFileSequenceOrder,
  validateShardSequences,
} from "../../src/runtime/validation";
import type { PersistedLogRecord, FullEvidenceRef } from "../../src/core/v2/observation-model";

function payloadForKind(kind: string): Record<string, unknown> {
  switch (kind) {
    case "tool_executed":
      return {
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
      };
    case "message":
      return {
        messageID: "m1",
        role: "assistant",
        textHash: "sha256:x",
        textSnippet: "hi",
        declaredClaims: [],
        evidence: [],
        finalized: true,
      };
    case "skill_invoked":
      return { skillName: "writing-plans", source: "skill_tool" };
    case "review_observed":
      return { reviewScope: "scope-1", items: [] };
    case "session_error":
      return { errorKind: "unknown", message: "error" };
    case "reflection":
      return {
        reflection: {
          trigger: "task_succeeded",
          planRef: { path: "plan.md", taskId: "task-1" },
          intent: "check_complete",
        },
      };
    default:
      return {};
  }
}

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
    ...payloadForKind(kind),
  } as unknown as PersistedLogRecord;
}

function baseFullRef(evidenceId: string, sequence = 1): FullEvidenceRef {
  return {
    kind: "full",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-1",
    sequence,
    evidenceId,
  };
}

function baseDecisionRecord(
  sequence: number,
  overrides: Partial<PersistedLogRecord> = {},
): PersistedLogRecord {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-20T00:00:00.000Z",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-1",
    recordType: "decision",
    sequence,
    gateType: "task",
    verdict: "PASS",
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults: [
      {
        ruleId: "required-tests",
        verdict: "PASS",
        reason: "test fixture",
        evidenceRefs: [baseFullRef("c1")],
      },
    ],
    ...overrides,
  } as unknown as PersistedLogRecord;
}

describe("observation log integrity", () => {
  it("validates record schema for all supported kinds", () => {
    for (const kind of [
      "tool_executed",
      "message",
      "skill_invoked",
      "review_observed",
      "session_error",
      "reflection",
    ]) {
      expect(() => validateRecordSchema(baseRecord(kind, 1))).not.toThrow();
    }
  });

  it("throws for unknown observation kind", () => {
    expect(() => validateRecordSchema(baseRecord("unknown_kind", 1))).toThrow(
      "unknown observation kind",
    );
  });

  it("throws for missing common envelope fields", () => {
    const record = { ...baseRecord("tool_executed", 1), agentId: undefined };
    expect(() => validateRecordSchema(record)).toThrow();
  });

  it("throws for invalid tool_executed evidence", () => {
    const record = {
      ...baseRecord("tool_executed", 1),
      evidence: [
        { evidenceId: "c1", kind: "test", sourceClass: "tool_output", provenance: "observed" },
      ],
    };
    expect(() => validateRecordSchema(record)).toThrow();
  });

  it("throws for physical sequence inversion", () => {
    const records = [baseRecord("tool_executed", 2), baseRecord("tool_executed", 1)];
    expect(() => validatePhysicalFileSequenceOrder(records)).toThrow(
      "Physical sequence order violation",
    );
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

describe("decision log integrity", () => {
  it("validates a complete decision record", () => {
    expect(() => validateRecordSchema(baseDecisionRecord(1))).not.toThrow();
  });

  it("throws for missing decision payload fields", () => {
    for (const key of [
      "gateType",
      "verdict",
      "reachableEnforcementLevel",
      "appliedEnforcementLevel",
      "ruleResults",
    ]) {
      const record = { ...baseDecisionRecord(1), [key]: undefined };
      expect(() => validateRecordSchema(record)).toThrow("Invalid decision record");
    }
  });

  it("throws for invalid verdict", () => {
    const record = baseDecisionRecord(1, { verdict: "UNKNOWN" });
    expect(() => validateRecordSchema(record)).toThrow("Invalid decision record");
  });

  it("throws for invalid ruleResult shape", () => {
    const record = baseDecisionRecord(1, {
      ruleResults: [{ ruleId: 123, verdict: "PASS", reason: "test fixture", evidenceRefs: [] }],
    });
    expect(() => validateRecordSchema(record)).toThrow("Invalid decision ruleResult");
  });

  it("throws for invalid evidenceRef in decision ruleResult", () => {
    const record = baseDecisionRecord(1, {
      ruleResults: [
        {
          ruleId: "required-tests",
          verdict: "PASS",
          reason: "test fixture",
          evidenceRefs: [{ evidenceId: "c1" }],
        },
      ],
    });
    expect(() => validateRecordSchema(record)).toThrow("Invalid decision evidenceRef");
  });

  it("throws for negative evidenceRef sequence", () => {
    const record = baseDecisionRecord(1, {
      ruleResults: [
        {
          ruleId: "required-tests",
          verdict: "PASS",
          reason: "test fixture",
          evidenceRefs: [baseFullRef("c1", -1)],
        },
      ],
    });
    expect(() => validateRecordSchema(record)).toThrow("Invalid decision evidenceRef");
  });

  it("throws for physical sequence inversion including decision records", () => {
    const records = [baseDecisionRecord(2), baseRecord("tool_executed", 1)];
    expect(() => validatePhysicalFileSequenceOrder(records)).toThrow(
      "Physical sequence order violation",
    );
  });

  it("detects duplicate sequences across mixed record types in the same shard", () => {
    const records = [baseDecisionRecord(1), baseRecord("tool_executed", 1)];
    expect(() => validateShardSequences(records)).toThrow("duplicate sequence detected");
  });
});
