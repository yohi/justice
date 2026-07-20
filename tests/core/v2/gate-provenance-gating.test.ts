import { describe, expect, it } from "vitest";
import type { FullEvidenceRef } from "../../../src/core/types";
import type { GateContext } from "../../../src/core/v2/gate-context";
import type { GateCheck, GateRule } from "../../../src/core/v2/gate-definition";
import { evaluate } from "../../../src/core/v2/rule-evaluation-engine";
import type { ProjectedEvidence } from "../../../src/core/v2/state-projection";

const CONTEXT = {
  trigger: "task_complete",
  taskId: "task-1",
  agentId: "atlas",
  sessionId: "session-1",
  reviewScope: [],
} satisfies GateContext;

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

function declaredEvidence(outcome: "pass" | "fail"): ProjectedEvidence {
  const evidenceId = `declared-${outcome}`;
  return {
    evidence: {
      evidenceId,
      kind: "test",
      sourceClass: "declared_claim",
      provenance: "declared",
      declaredFrom: "task_summary",
      claim: { claimKind: "test", outcome },
    },
    ref: evidenceRef(evidenceId),
  };
}

function observedEvidence(outcome: "pass" | "fail" | "unknown"): ProjectedEvidence {
  const evidenceId = `observed-${outcome}`;
  return {
    evidence: {
      evidenceId,
      kind: "test",
      sourceClass: "tool_output",
      provenance: "observed",
      toolOutputClass: "command_exec",
      command: "bun run test",
      rawOutput: outcome,
      interpretation: {
        outcome,
        basis: "parsed_output",
        provenance: "derived",
        derivedFrom: [{ kind: "self", evidenceId }],
      },
    },
    ref: evidenceRef(evidenceId),
  };
}

function gate(
  id: string,
  check: GateCheck,
  policy: {
    readonly onViolation?: GateRule["onViolation"];
    readonly onMissingEvidence?: GateRule["onMissingEvidence"];
  } = {},
): GateRule {
  return {
    id,
    gateType: "task",
    trigger: { on: "task_complete" },
    check,
    onViolation: policy.onViolation ?? "fail",
    onMissingEvidence: policy.onMissingEvidence ?? "warn",
    enabled: true,
  };
}

describe("evaluate provenance gating", () => {
  it("uses onMissingEvidence for declared passing evidence_outcome", () => {
    const evidence = declaredEvidence("pass");
    const result = evaluate(
      [
        gate("declared-outcome", {
          type: "evidence_outcome",
          evidenceKind: "test",
          requireOutcome: "pass",
        }),
      ],
      [evidence],
      CONTEXT,
    );

    expect(result.verdict).toBe("WARN");
    if (result.verdict === "SKIP") throw new Error("expected an evaluated task gate");
    expect(result.ruleResults[0]?.evidenceRefs).toEqual([]);
  });

  it("uses onMissingEvidence rather than onViolation for declared failing evidence_outcome", () => {
    const result = evaluate(
      [
        gate("declared-failure", {
          type: "evidence_outcome",
          evidenceKind: "test",
          requireOutcome: "pass",
        }),
      ],
      [declaredEvidence("fail")],
      CONTEXT,
    );

    expect(result.verdict).toBe("WARN");
  });

  it("uses onMissingEvidence for declared evidence_present", () => {
    const result = evaluate(
      [gate("declared-present", { type: "evidence_present", evidenceKind: "test" })],
      [declaredEvidence("pass")],
      CONTEXT,
    );

    expect(result.verdict).toBe("WARN");
    if (result.verdict === "SKIP") throw new Error("expected an evaluated task gate");
    expect(result.ruleResults[0]?.evidenceRefs).toEqual([]);
  });

  it("caps passing onMissingEvidence at WARN for declared-only evidence_outcome", () => {
    const result = evaluate(
      [
        gate(
          "declared-outcome-pass-policy",
          { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
          { onMissingEvidence: "pass" },
        ),
      ],
      [declaredEvidence("pass")],
      CONTEXT,
    );

    expect(result.verdict).toBe("WARN");
  });

  it("caps passing onMissingEvidence at WARN for declared-only evidence_present", () => {
    const result = evaluate(
      [
        gate(
          "declared-present-pass-policy",
          { type: "evidence_present", evidenceKind: "test" },
          { onMissingEvidence: "pass" },
        ),
      ],
      [declaredEvidence("pass")],
      CONTEXT,
    );

    expect(result.verdict).toBe("WARN");
  });

  it("uses onMissingEvidence for authoritative evidence with an unknown outcome", () => {
    const evidence = observedEvidence("unknown");
    const result = evaluate(
      [
        gate(
          "authoritative-unknown-outcome",
          { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
          { onViolation: "fail", onMissingEvidence: "pass" },
        ),
      ],
      [evidence],
      CONTEXT,
    );

    expect(result.verdict).toBe("WARN");
    if (result.verdict === "SKIP") throw new Error("expected an evaluated task gate");
    expect(result.ruleResults[0]?.evidenceRefs).toEqual([evidence.ref]);
  });

  it("uses onViolation PASS for an authoritative mismatch instead of onMissingEvidence FAIL", () => {
    const result = evaluate(
      [
        gate(
          "authoritative-mismatch-pass-policy",
          { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
          { onViolation: "pass", onMissingEvidence: "fail" },
        ),
      ],
      [observedEvidence("fail")],
      CONTEXT,
    );

    expect(result.verdict).toBe("PASS");
  });

  it("passes when authoritative evidence matches despite a declared mismatch", () => {
    const result = evaluate(
      [
        gate("authoritative-pass-with-declared-mismatch", {
          type: "evidence_outcome",
          evidenceKind: "test",
          requireOutcome: "pass",
        }),
      ],
      [observedEvidence("pass"), declaredEvidence("fail")],
      CONTEXT,
    );

    expect(result.verdict).toBe("PASS");
  });

  it("uses onViolation when authoritative evidence has the wrong outcome", () => {
    const result = evaluate(
      [
        gate("authoritative-failure", {
          type: "evidence_outcome",
          evidenceKind: "test",
          requireOutcome: "pass",
        }),
      ],
      [observedEvidence("fail")],
      CONTEXT,
    );

    expect(result.verdict).toBe("FAIL");
    if (result.verdict === "SKIP") throw new Error("expected an evaluated task gate");
    expect(result.ruleResults[0]?.reason).toBe(
      "Some authoritative evidence did not meet required outcome 'pass'.",
    );
  });
});
