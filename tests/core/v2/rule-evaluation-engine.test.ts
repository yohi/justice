import { describe, expect, it } from "vitest";
import type { FullEvidenceRef } from "../../../src/core/types";
import type { GateContext } from "../../../src/core/v2/gate-context";
import type { GateCheck, GateRule } from "../../../src/core/v2/gate-definition";
import { evaluate } from "../../../src/core/v2/rule-evaluation-engine";
import type {
  ProjectedEvidence,
  ReviewSummaryItem,
  ScopeReviewSummary,
} from "../../../src/core/v2/state-projection";

type ToolEvidenceInput = {
  readonly evidenceId: string;
  readonly kind: "test" | "build" | "lint";
  readonly outcome: "pass" | "fail" | "unknown";
  readonly provenance?: "observed" | "derived" | "unknown";
};

type GateInput = {
  readonly id: string;
  readonly check: GateCheck;
  readonly trigger?: GateRule["trigger"]["on"];
  readonly onViolation?: GateRule["onViolation"];
  readonly onMissingEvidence?: GateRule["onMissingEvidence"];
};

const BASE_CONTEXT = {
  trigger: "task_complete",
  taskId: "task-1",
  agentId: "atlas",
  sessionId: "session-1",
  reviewScope: [],
} satisfies GateContext;

function evidenceRef(evidenceId: string, sequence = 1): FullEvidenceRef {
  return {
    kind: "full",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "writer-1",
    sequence,
    evidenceId,
  };
}

function toolEvidence(input: ToolEvidenceInput): ProjectedEvidence {
  return {
    evidence: {
      evidenceId: input.evidenceId,
      kind: input.kind,
      sourceClass: "tool_output",
      provenance: input.provenance ?? "observed",
      toolOutputClass: "command_exec",
      command: `bun run ${input.kind}`,
      rawOutput: input.outcome,
      interpretation: {
        outcome: input.outcome,
        basis: "parsed_output",
        provenance: "derived",
        derivedFrom: [{ kind: "self", evidenceId: input.evidenceId }],
      },
    },
    ref: evidenceRef(input.evidenceId),
  };
}

function gate(input: GateInput): GateRule {
  return {
    id: input.id,
    gateType: "task",
    trigger: { on: input.trigger ?? "task_complete" },
    check: input.check,
    onViolation: input.onViolation ?? "fail",
    onMissingEvidence: input.onMissingEvidence ?? "warn",
    enabled: true,
  };
}

function reviewItem(
  itemKey: string,
  severity: ReviewSummaryItem["severity"],
  sequence = 1,
): ReviewSummaryItem {
  return { itemKey, severity, ref: evidenceRef(`review-${itemKey}`, sequence) };
}

function scopeSummary(open: readonly ReviewSummaryItem[]): ScopeReviewSummary {
  return {
    critical: open.filter((item) => item.severity === "critical"),
    major: open.filter((item) => item.severity === "major"),
    minor: open.filter((item) => item.severity === "minor"),
    resolved: [],
    open,
  };
}

function evaluateReview(input: {
  readonly reviewScope: readonly string[];
  readonly byScope?: ReadonlyMap<string, ScopeReviewSummary>;
  readonly minimumSeverity?: "critical" | "major" | "minor";
  readonly onMissingEvidence?: GateRule["onMissingEvidence"];
}): ReturnType<typeof evaluate> {
  return evaluate(
    [
      gate({
        id: "review-items",
        check: {
          type: "review_open_items",
          minimumSeverity: input.minimumSeverity ?? "major",
        },
        onMissingEvidence: input.onMissingEvidence,
      }),
    ],
    [],
    {
      ...BASE_CONTEXT,
      reviewScope: input.reviewScope,
      reviewSummary: { byScope: input.byScope ?? new Map() },
    },
  );
}

describe("evaluate", () => {
  it("evaluates all check types and aggregates the worst verdict", () => {
    const testEvidence = toolEvidence({ evidenceId: "test-pass", kind: "test", outcome: "pass" });
    const buildEvidence = toolEvidence({
      evidenceId: "build-observed",
      kind: "build",
      outcome: "unknown",
      provenance: "derived",
    });
    const review = reviewItem("major-1", "major");

    const result = evaluate(
      [
        gate({
          id: "tests-pass",
          check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
        }),
        gate({
          id: "build-present",
          check: { type: "evidence_present", evidenceKind: "build" },
        }),
        gate({
          id: "review-clear",
          check: { type: "review_open_items", minimumSeverity: "major" },
          onViolation: "warn",
        }),
      ],
      [testEvidence, buildEvidence],
      {
        ...BASE_CONTEXT,
        reviewScope: ["task-1"],
        reviewSummary: { byScope: new Map([["task-1", scopeSummary([review])]]) },
      },
    );

    expect(result.verdict).toBe("WARN");
    if (result.verdict === "SKIP") throw new Error("expected an evaluated task gate");
    expect(result).toMatchObject({
      gateType: "task",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
    });
    expect(result.ruleResults.map((rule) => rule.verdict)).toEqual(["PASS", "PASS", "WARN"]);
    expect(result.ruleResults[0]?.evidenceRefs).toEqual([testEvidence.ref]);
    expect(result.ruleResults[1]?.evidenceRefs).toEqual([buildEvidence.ref]);
    expect(result.ruleResults[2]?.evidenceRefs).toEqual([review.ref]);
  });

  it("skips evaluation when no active gate matches the trigger", () => {
    const result = evaluate(
      [
        gate({
          id: "tool-only",
          trigger: "tool_observed",
          check: { type: "evidence_present", evidenceKind: "test" },
        }),
      ],
      [],
      BASE_CONTEXT,
    );

    expect(result).toEqual({
      verdict: "SKIP",
      reason: "no matching active gates found for trigger: task_complete",
    });
  });

  it("skips task gate evaluation when taskId is undefined", () => {
    const result = evaluate(
      [gate({ id: "tests", check: { type: "evidence_present", evidenceKind: "test" } })],
      [],
      {
        trigger: "task_complete",
        agentId: "atlas",
        sessionId: "session-1",
        reviewScope: [],
      },
    );

    expect(result).toEqual({ verdict: "SKIP", reason: "no taskId provided" });
  });

  it("evaluates tool_observed after the caller resolves an active task", () => {
    const evidence = toolEvidence({ evidenceId: "test-observed", kind: "test", outcome: "pass" });
    const result = evaluate(
      [
        gate({
          id: "tool-test",
          trigger: "tool_observed",
          check: { type: "evidence_present", evidenceKind: "test" },
        }),
      ],
      [evidence],
      { ...BASE_CONTEXT, trigger: "tool_observed" },
    );

    expect(result.verdict).toBe("PASS");
  });
});

describe("review_open_items", () => {
  it("caps passing onMissingEvidence at WARN when reviewScope is empty", () => {
    expect(evaluateReview({ reviewScope: [], onMissingEvidence: "pass" }).verdict).toBe("WARN");
  });

  it("caps passing onMissingEvidence at WARN when reviewScope is unobserved", () => {
    expect(
      evaluateReview({ reviewScope: ["target"], onMissingEvidence: "pass" }).verdict,
    ).toBe("WARN");
  });

  it("passes when the matching observed scope has no open items regardless of onMissingEvidence", () => {
    const byScope = new Map([["target", scopeSummary([])]]);
    expect(
      evaluateReview({ reviewScope: ["target"], byScope, onMissingEvidence: "fail" }).verdict,
    ).toBe("PASS");
  });

  it("does not leak open items from scopes outside reviewScope", () => {
    const byScope = new Map([
      ["target", scopeSummary([])],
      ["other", scopeSummary([reviewItem("other-major", "major")])],
    ]);
    expect(evaluateReview({ reviewScope: ["target"], byScope }).verdict).toBe("PASS");
  });

  it("passes when matching open items are below minimumSeverity", () => {
    const byScope = new Map([["target", scopeSummary([reviewItem("target-major", "major")])]]);
    const result = evaluateReview({
      reviewScope: ["target"],
      byScope,
      minimumSeverity: "critical",
    });

    expect(result.verdict).toBe("PASS");
  });

  it("does not pass when one of multiple scopes is unobserved, even if observed scopes have no open items", () => {
    const byScope = new Map([["scope-a", scopeSummary([])]]);

    const result = evaluateReview({ reviewScope: ["scope-a", "scope-b"], byScope });

    expect(result.verdict).not.toBe("PASS");
    expect(result.verdict).toBe("WARN");
  });

  it("aggregates the worst verdict across multiple scopes: unobserved scope plus a violating scope", () => {
    const byScope = new Map([
      ["scope-a", scopeSummary([reviewItem("scope-a-major", "major")])],
    ]);

    const result = evaluateReview({ reviewScope: ["scope-a", "scope-b"], byScope });

    expect(result.verdict).toBe("FAIL");
    if (result.verdict === "SKIP") throw new Error("expected an evaluated task gate");
    expect(result.ruleResults[0]?.evidenceRefs).toEqual([evidenceRef("review-scope-a-major")]);
  });
});
