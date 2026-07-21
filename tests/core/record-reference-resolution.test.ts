import { describe, expect, it } from "vitest";
import { buildMessageRecord, buildToolExecutedRecord } from "../../src/core/v2/record-builder";
import type { FullEvidenceRef } from "../../src/core/types";
import { validateRecordSchema } from "../../src/runtime/validation";
import { extractDeclaredClaims } from "../../src/core/v2/declared-claim-extractor";
import type { DecisionRecord, RuleResult } from "../../src/core/v2/decision-model";

function baseEnvelope(): Record<string, unknown> {
  return {
    schemaVersion: 1 as const,
    timestamp: "2026-07-20T00:00:00.000Z",
    agentId: "atlas" as const,
    sessionId: "session-1",
    writerId: "writer-1",
    recordType: "observation" as const,
  };
}

function buildFullRef(evidenceId: string, sequence = 1): FullEvidenceRef {
  return {
    kind: "full",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "writer-1",
    sequence,
    evidenceId,
  };
}

describe("record sub-entity reference resolution (D70)", () => {
  it("buildMessageRecord preserves declared claim evidenceId in DeclaredClaimEvidence", () => {
    const messageID = "msg-1";
    const text = "tests passed";
    const claims = extractDeclaredClaims(messageID, text);
    expect(claims.length).toBeGreaterThan(0);
    const claim = claims.find((c) => c.claimKind === "test")!;

    const record = buildMessageRecord({
      envelope: baseEnvelope(),
      messageID,
      text,
      claims,
    });

    const evidence = record.evidence.find(
      (e) => e.sourceClass === "declared_claim" && e.evidenceId === claim.evidenceId,
    );
    expect(evidence).toBeDefined();
    expect(evidence?.declaredFrom).toBe("message");
    expect(validateRecordSchema.bind(null, { ...record, sequence: 1 })).not.toThrow();
  });

  it("buildToolExecutedRecord links summary claim evidenceId into Evidence", () => {
    const callId = "tool-1";
    const claims = extractDeclaredClaims(callId, "build passed");
    const claim = claims.find((c) => c.claimKind === "build")!;

    const record = buildToolExecutedRecord({
      envelope: baseEnvelope(),
      toolName: "bash",
      toolInput: { command: "bun run build" },
      toolOutput: { output: "build succeeded" },
      callId,
      summaryClaims: claims,
    });

    const declaredEvidence = record.evidence.filter(
      (e) => e.sourceClass === "declared_claim" && e.evidenceId === claim.evidenceId,
    );
    expect(declaredEvidence.length).toBe(1);
    expect(declaredEvidence[0]?.declaredFrom).toBe("task_summary");
  });

  it("DecisionRecord evidenceRefs resolve to valid FullEvidenceRef via validateRecordSchema", () => {
    const itemKey = "review-major-src-1";
    const ruleResult: RuleResult = {
      ruleId: "review-clean",
      verdict: "WARN",
      reason: "open review item",
      evidenceRefs: [buildFullRef(itemKey)],
    };
    const decision: DecisionRecord = {
      ...baseEnvelope(),
      recordType: "decision",
      sequence: 1,
      gateType: "task",
      verdict: "WARN",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      ruleResults: [ruleResult],
    };

    expect(validateRecordSchema.bind(null, decision)).not.toThrow();
  });

  it("validateRecordSchema rejects a DecisionRecord evidenceRef whose evidenceId is missing", () => {
    const badRef = {
      kind: "full",
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "writer-1",
      sequence: 1,
    } as unknown as FullEvidenceRef;
    const decision: DecisionRecord = {
      ...baseEnvelope(),
      recordType: "decision",
      sequence: 1,
      gateType: "task",
      verdict: "PASS",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      ruleResults: [
        {
          ruleId: "r1",
          verdict: "PASS",
          reason: "authoritative evidence passed",
          evidenceRefs: [badRef],
        },
      ],
    };

    expect(validateRecordSchema.bind(null, decision)).toThrow("Invalid decision evidenceRef");
  });

  it("validateRecordSchema rejects a DecisionRecord rule result without a reason", () => {
    const decision = {
      ...baseEnvelope(),
      recordType: "decision",
      sequence: 1,
      gateType: "task",
      verdict: "PASS",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      ruleResults: [{ ruleId: "r1", verdict: "PASS", evidenceRefs: [buildFullRef("test-1")] }],
    };

    expect(validateRecordSchema.bind(null, decision)).toThrow("Invalid decision ruleResult");
  });
});
