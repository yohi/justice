import { describe, expect, it } from "vitest";
import type { FullEvidenceRef } from "../../src/core/types";
import type { DeclaredClaimEvidence } from "../../src/core/v2/observation-model";
import type { RuleResult } from "../../src/core/v2/decision-model";

function buildFullRef(evidenceId: string): FullEvidenceRef {
  return {
    kind: "full",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "writer-1",
    sequence: 1,
    evidenceId,
  };
}

describe("record sub-entity reference resolution (D70)", () => {
  it("message claim evidenceId matches declared_claim Evidence.evidenceId", () => {
    const claimEvidenceId = "claim-msg-1";
    const evidence: DeclaredClaimEvidence = {
      evidenceId: claimEvidenceId,
      kind: "test",
      sourceClass: "declared_claim",
      provenance: "declared",
      declaredFrom: "message",
      claim: { claimKind: "test", outcome: "pass" },
    };

    expect(evidence.evidenceId).toBe(claimEvidenceId);
  });

  it("review item evidenceId equals itemKey in DecisionRecord.evidenceRefs", () => {
    const itemKey = "review-major-src-1";
    const ruleResult: RuleResult = {
      ruleId: "review-clean",
      verdict: "WARN",
      reason: "open review item",
      evidenceRefs: [buildFullRef(itemKey)],
    };

    expect(ruleResult.evidenceRefs[0]?.evidenceId).toBe(itemKey);
  });
});
