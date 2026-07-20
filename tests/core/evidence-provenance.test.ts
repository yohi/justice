import { describe, expect, it } from "vitest";
import type { FullEvidenceRef } from "../../src/core/types";
import type { GateContext } from "../../src/core/v2/gate-context";
import type { GateRule } from "../../src/core/v2/gate-definition";
import { evaluate } from "../../src/core/v2/rule-evaluation-engine";
import type { ProjectedEvidence } from "../../src/core/v2/state-projection";

const CONTEXT: GateContext = {
  trigger: "task_complete",
  taskId: "task-1",
  agentId: "atlas",
  sessionId: "session-1",
  reviewScope: [],
};

function evidenceRef(evidenceId: string): FullEvidenceRef {
  return {
    kind: "full",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "writer-1",
    sequence: 1,
    evidenceId,
  };
}

function declaredEvidence(
  outcome: "pass" | "fail",
  declaredFrom: "message" | "task_summary",
): ProjectedEvidence {
  const evidenceId = `declared-${declaredFrom}-${outcome}`;
  return {
    evidence: {
      evidenceId,
      kind: "test",
      sourceClass: "declared_claim",
      provenance: "declared",
      declaredFrom,
      claim: { claimKind: "test", outcome },
    },
    ref: evidenceRef(evidenceId),
  };
}

function gate(
  onMissingEvidence: GateRule["onMissingEvidence"] = "warn",
  checkType: "evidence_outcome" | "evidence_present" = "evidence_outcome",
): GateRule {
  const check =
    checkType === "evidence_outcome"
      ? { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" }
      : { type: "evidence_present", evidenceKind: "test" };
  return {
    id: "required-tests",
    gateType: "task",
    trigger: { on: "task_complete" },
    check,
    onViolation: "fail",
    onMissingEvidence,
    enabled: true,
  };
}

describe("FF-007 / FF-008 evidence provenance", () => {
  it("declared message claim does not satisfy required-tests", () => {
    const result = evaluate([gate()], [declaredEvidence("pass", "message")], CONTEXT);
    expect(result.verdict).toBe("WARN");
  });

  it("declared task_summary claim does not satisfy required-tests", () => {
    const result = evaluate([gate()], [declaredEvidence("pass", "task_summary")], CONTEXT);
    expect(result.verdict).toBe("WARN");
  });

  it("even onMissingEvidence=pass is capped at WARN for declared-only evidence", () => {
    const result = evaluate([gate("pass")], [declaredEvidence("pass", "task_summary")], CONTEXT);
    expect(result.verdict).toBe("WARN");
  });

  it("onMissingEvidence=fail returns FAIL for declared-only evidence_outcome", () => {
    const result = evaluate([gate("fail")], [declaredEvidence("pass", "message")], CONTEXT);
    expect(result.verdict).toBe("FAIL");
  });

  it("declared-only evidence does not satisfy evidence_present", () => {
    const result = evaluate([gate("warn", "evidence_present")], [declaredEvidence("pass", "message")], CONTEXT);
    expect(result.verdict).toBe("WARN");
  });

  it("declared task_summary claim does not satisfy evidence_present", () => {
    const result = evaluate([gate("warn", "evidence_present")], [declaredEvidence("pass", "task_summary")], CONTEXT);
    expect(result.verdict).toBe("WARN");
  });

  it("onMissingEvidence=pass is capped at WARN for declared-only evidence_present", () => {
    const result = evaluate([gate("pass", "evidence_present")], [declaredEvidence("pass", "task_summary")], CONTEXT);
    expect(result.verdict).toBe("WARN");
  });

  it("onMissingEvidence=fail returns FAIL for declared-only evidence_present", () => {
    const result = evaluate([gate("fail", "evidence_present")], [declaredEvidence("pass", "message")], CONTEXT);
    expect(result.verdict).toBe("FAIL");
  });
});
