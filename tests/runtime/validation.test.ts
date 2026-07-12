import { describe, expect, it } from "vitest";
import { validateRecordSchema, validateShardSequences } from "../../src/runtime/validation";
import type { PersistedLogRecord } from "../../src/core/v2/observation-model";

function validBase(recordType: "observation" | "decision"): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sequence: 1,
    timestamp: "2026-07-11T12:00:00.000Z",
    agentId: "atlas",
    sessionId: "ses-1",
    writerId: "w-1",
    recordType,
  };
}

function validDecision(): Record<string, unknown> {
  return {
    ...validBase("decision"),
    gateType: "task",
    verdict: "PASS",
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults: [
      {
        ruleId: "r-1",
        verdict: "PASS",
        reason: "ok",
        evidenceRefs: [
          {
            kind: "full",
            agentId: "atlas",
            sessionId: "ses-1",
            writerId: "w-1",
            sequence: 1,
            evidenceId: "e-1",
          },
        ],
      },
    ],
  };
}

function validReviewObserved(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "review_observed",
    reviewScope: "code-review",
    items: [
      {
        itemKey: "i-1",
        evidenceId: "e-1",
        severity: "critical",
        summary: "bad",
        location: "file.ts:1",
        status: "open",
      },
    ],
  };
}

function validToolExecuted(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "tool_executed",
    toolName: "test",
    callId: "call-1",
    evidence: {
      evidenceId: "e-1",
      kind: "test",
      sourceClass: "tool_output",
      provenance: "observed",
      toolOutputClass: "command_exec",
      command: "bun test",
      rawOutput: "ok",
    },
  };
}

function validMessage(): Record<string, unknown> {
  return {
    ...validBase("observation"),
    kind: "message",
    messageID: "msg-1",
    role: "assistant",
    textHash: "h1",
    finalized: true,
    declaredClaims: [],
    evidence: [],
  };
}

describe("validateRecordSchema", () => {
  it("accepts a valid tool_executed record", () => {
    expect(() => validateRecordSchema(validToolExecuted())).not.toThrow();
  });

  it("accepts a valid message record", () => {
    expect(() => validateRecordSchema(validMessage())).not.toThrow();
  });

  it("accepts a valid decision record", () => {
    expect(() => validateRecordSchema(validDecision())).not.toThrow();
  });

  it("rejects a non-object record", () => {
    expect(() => validateRecordSchema("not-object")).toThrow("Invalid record: not an object");
  });

  it("rejects unsupported schemaVersion", () => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), schemaVersion: 2 })).toThrow(
      "Invalid record: unsupported schemaVersion 2",
    );
  });

  it("rejects a negative sequence", () => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), sequence: -1 })).toThrow(
      "Invalid record: sequence must be a non-negative number",
    );
  });

  it("rejects a missing timestamp", () => {
    const executed = validToolExecuted();
    const rest = { ...executed };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timestamp, ...restWithoutTimestamp } = rest;
    expect(() => validateRecordSchema(restWithoutTimestamp)).toThrow(
      "Invalid record: timestamp must be a string",
    );
  });

  it("rejects invalid shard identifier fields", () => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), agentId: undefined })).toThrow(
      "Invalid record: missing or invalid shard identifier fields",
    );
  });

  it("rejects unknown recordType", () => {
    expect(() => validateRecordSchema({ ...validToolExecuted(), recordType: "learning" })).toThrow(
      "Invalid record: unknown recordType: learning",
    );
  });

  it("rejects invalid tool_executed evidence structure", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: { evidenceId: "e-1" },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects tool_output evidence with unsupported toolOutputClass", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "unsupported",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects evidence with unsupported sourceClass", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "unsupported",
          provenance: "observed",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects file_content evidence with non-string rawOutputHash", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "file_content",
          rawOutputHash: 123,
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects declared_claim evidence with non-claimed provenance", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
            claimRef: "not-object",
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a message record with mismatched claims and evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a message record with non-array claims", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: "not-array",
        evidence: [],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a message record with only-empty-but-mismatched lists", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a decision record with non-array ruleResults", () => {
    expect(() => validateRecordSchema({ ...validDecision(), ruleResults: "not-array" })).toThrow(
      "Invalid decision record",
    );
  });

  it("rejects a decision ruleResult with non-array evidenceRefs", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecision(),
        ruleResults: [
          {
            ruleId: "r-1",
            verdict: "PASS",
            evidenceRefs: "not-array",
          },
        ],
      }),
    ).toThrow("Invalid decision ruleResult");
  });

  it("rejects a decision evidenceRef with non-finite sequence", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecision(),
        ruleResults: [
          {
            ruleId: "r-1",
            verdict: "PASS",
            evidenceRefs: [
              {
                kind: "full",
                agentId: "atlas",
                sessionId: "ses-1",
                writerId: "w-1",
                sequence: Number.POSITIVE_INFINITY,
                evidenceId: "e-1",
              },
            ],
          },
        ],
      }),
    ).toThrow("Invalid decision evidenceRef");
  });
  it("accepts a message record with neither claims nor evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: undefined,
        evidence: undefined,
      }),
    ).not.toThrow();
  });

  it("rejects a decision evidenceRef with negative sequence", () => {
    expect(() =>
      validateRecordSchema({
        ...validDecision(),
        ruleResults: [
          {
            ruleId: "r-1",
            verdict: "PASS",
            evidenceRefs: [
              {
                kind: "full",
                agentId: "atlas",
                sessionId: "ses-1",
                writerId: "w-1",
                sequence: -1,
                evidenceId: "e-1",
              },
            ],
          },
        ],
      }),
    ).toThrow("Invalid decision evidenceRef");
  });

  it("rejects tool_output evidence with non-string kind", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: 123,
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "ok",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects tool_output evidence with non-string provenance", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: 123,
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "ok",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("rejects tool_output evidence with non-object interpretation", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "ok",
          interpretation: "not-object",
        },
      }),
    ).toThrow("Invalid tool_executed record");
  });

  it("accepts file_content evidence without optional fields", () => {
    expect(() =>
      validateRecordSchema({
        ...validToolExecuted(),
        evidence: {
          evidenceId: "e-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "file_content",
          rawOutputHash: "h1",
        },
      }),
    ).not.toThrow();
  });

  it("rejects declared_claim evidence with invalid kind", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "invalid",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects declared_claim evidence with wrong provenance", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "observed",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects declared_claim evidence with non-object claim", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: "not-object",
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects declared_claim evidence with invalid claim outcome", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "invalid" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects declared_claim evidence with invalid declaredFrom", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "invalid",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("accepts a valid message record with declared claims and evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a message record with non-matching evidenceId between claim and evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "different",
            kind: "test",
            sourceClass: "declared_claim",
            provenance: "declared",
            declaredFrom: "message",
            claim: { claimKind: "test", outcome: "pass" },
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("rejects a message record with non-declared_claim evidence", () => {
    expect(() =>
      validateRecordSchema({
        ...validMessage(),
        declaredClaims: [
          {
            evidenceId: "msg-1-test",
            claimKind: "test",
            outcome: "pass",
          },
        ],
        evidence: [
          {
            evidenceId: "msg-1-test",
            kind: "test",
            sourceClass: "tool_output",
            provenance: "observed",
            toolOutputClass: "command_exec",
            command: "bun test",
            rawOutput: "ok",
          },
        ],
      }),
    ).toThrow("Invalid message record");
  });

  it("accepts a valid review_observed record", () => {
    expect(() => validateRecordSchema(validReviewObserved())).not.toThrow();
  });

  it("rejects a review_observed record with non-array items", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        items: "not-array",
      }),
    ).toThrow("Invalid review_observed record");
  });

  it("rejects a review_observed item with invalid severity", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        items: [
          {
            itemKey: "i-1",
            evidenceId: "e-1",
            severity: "invalid",
            summary: "bad",
            location: "file.ts:1",
            status: "open",
          },
        ],
      }),
    ).toThrow("Invalid review_observed item");
  });

  it("rejects a review_observed item with invalid status", () => {
    expect(() =>
      validateRecordSchema({
        ...validReviewObserved(),
        items: [
          {
            itemKey: "i-1",
            evidenceId: "e-1",
            severity: "critical",
            summary: "bad",
            location: "file.ts:1",
            status: "invalid",
          },
        ],
      }),
    ).toThrow("Invalid review_observed item");
  });

  it("accepts skill_invoked record stub", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "skill_invoked",
      }),
    ).not.toThrow();
  });

  it("accepts session_error record stub", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "session_error",
      }),
    ).not.toThrow();
  });

  it("accepts reflection record stub", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "reflection",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown observation kind", () => {
    expect(() =>
      validateRecordSchema({
        ...validBase("observation"),
        kind: "unknown_kind",
      }),
    ).toThrow("Invalid record: unknown observation kind: unknown_kind");
  });
});

describe("validateShardSequences", () => {
  it("accepts a single valid shard sequence", () => {
    const records = [
      { ...validBase("observation"), kind: "skill_invoked" },
    ] as unknown as readonly PersistedLogRecord[];
    expect(() => validateShardSequences(records)).not.toThrow();
  });

  it("detects duplicate sequences in a shard", () => {
    const records = [
      { ...validBase("observation"), kind: "skill_invoked", sequence: 1 },
      { ...validBase("observation"), kind: "skill_invoked", sequence: 1 },
    ] as unknown as readonly PersistedLogRecord[];
    expect(() => validateShardSequences(records)).toThrow("duplicate sequence detected");
  });

  it("detects a missing sequence at the start of a shard", () => {
    const records = [
      { ...validBase("observation"), kind: "skill_invoked", sequence: 2 },
    ] as unknown as readonly PersistedLogRecord[];
    expect(() => validateShardSequences(records)).toThrow("missing sequence before 2");
  });

  it("detects a gap between sequences in a shard", () => {
    const records = [
      { ...validBase("observation"), kind: "skill_invoked", sequence: 1 },
      { ...validBase("observation"), kind: "skill_invoked", sequence: 3 },
    ] as unknown as readonly PersistedLogRecord[];
    expect(() => validateShardSequences(records)).toThrow("missing sequence between 1 and 3");
  });

  it("handles empty records", () => {
    expect(() => validateShardSequences([])).not.toThrow();
  });
});
