import { describe, expect, it } from "vitest";
import {
  JUSTICE_REVIEW_HISTORY_COMMAND,
  isJusticeReviewHistoryCommand,
  parseJusticeReviewHistoryCommandArguments,
  renderReviewHistoryCommandGuidance,
} from "../../src/core/review-gate-history-command";
import type {
  HistoryFindingsDto,
  HistoryRoundsDto,
  HistorySummaryDto,
  ReviewHistoryQueryResult,
} from "../../src/core/review-gate/history";

describe("isJusticeReviewHistoryCommand", () => {
  it("matches with and without the leading slash", () => {
    expect(isJusticeReviewHistoryCommand("/justice-review-history")).toBe(true);
    expect(isJusticeReviewHistoryCommand("justice-review-history")).toBe(true);
    expect(isJusticeReviewHistoryCommand(" justice-review-history ")).toBe(true);
  });

  it("does not match other commands", () => {
    expect(isJusticeReviewHistoryCommand("justice-review-gate")).toBe(false);
    expect(isJusticeReviewHistoryCommand("justice-review")).toBe(false);
    expect(isJusticeReviewHistoryCommand(undefined)).toBe(false);
  });

  it("exposes the canonical command name", () => {
    expect(JUSTICE_REVIEW_HISTORY_COMMAND).toBe("justice-review-history");
  });
});

describe("parseJusticeReviewHistoryCommandArguments", () => {
  it("parses the scope form with the default summary view", () => {
    const parsed = parseJusticeReviewHistoryCommandArguments(
      "--design docs/design.md --plan docs/plan.md",
    );
    expect(parsed).toEqual({
      kind: "scope",
      designPath: "docs/design.md",
      planPath: "docs/plan.md",
      view: "summary",
      allGenerations: false,
    });
  });

  it("accepts OpenCode file-reference paths and strips the leading @", () => {
    const parsed = parseJusticeReviewHistoryCommandArguments(
      "--design @docs/design.md --plan @docs/plan.md",
    );
    expect(parsed).toEqual({
      kind: "scope",
      designPath: "docs/design.md",
      planPath: "docs/plan.md",
      view: "summary",
      allGenerations: false,
    });
  });

  it("parses the gate form", () => {
    const parsed = parseJusticeReviewHistoryCommandArguments("--gate gate-a1b2c3");
    expect(parsed).toEqual({ kind: "gate", gateId: "gate-a1b2c3", view: "summary" });
  });

  it.each(["summary", "rounds", "findings"] as const)(
    "accepts --view %s on both forms",
    (view) => {
      const scope = parseJusticeReviewHistoryCommandArguments(
        `--design docs/design.md --plan docs/plan.md --view ${view}`,
      );
      expect(scope).toMatchObject({ kind: "scope", view, allGenerations: false });

      const gate = parseJusticeReviewHistoryCommandArguments(
        `--gate gate-a --view ${view}`,
      );
      expect(gate).toMatchObject({ kind: "gate", gateId: "gate-a", view });
    },
  );

  it("parses --all-generations only on the scope form", () => {
    const parsed = parseJusticeReviewHistoryCommandArguments(
      "--design docs/design.md --plan docs/plan.md --all-generations --view rounds",
    );
    expect(parsed).toMatchObject({
      kind: "scope",
      allGenerations: true,
      view: "rounds",
    });
  });

  it.each([
    ["--gate and --design are mutually exclusive", "--gate gate-a --design docs/design.md --plan docs/plan.md"],
    ["--gate and --plan are mutually exclusive", "--gate gate-a --plan docs/plan.md"],
    ["--all-generations is not valid with --gate", "--gate gate-a --all-generations"],
    ["--view is an enum", "--gate gate-a --view enhanced"],
    ["a scope requires --plan as well", "--design docs/design.md"],
    ["a scope requires --design as well", "--plan docs/plan.md"],
    ["a flag needs its value", "--gate"],
    ["the same flag cannot repeat", "--gate gate-a --gate gate-b"],
    ["absolute paths are rejected", "--design /etc/passwd --plan docs/plan.md"],
    ["traversal paths are rejected", "--design docs/../etc/passwd --plan docs/plan.md"],
    ["backslash paths are rejected", "--design docs\\design.md --plan docs/plan.md"],
    ["unknown flags are rejected", "--gate gate-a --verbose"],
    ["empty input is rejected", ""],
    ["a bare view value is rejected", "--view summary"],
  ])("%s", (_name, input) => {
    expect(parseJusticeReviewHistoryCommandArguments(input)).toBeNull();
  });

  it("rejects a gate id that the durable store could never keep", () => {
    for (const gateId of ["aa/bb", "a\\b", "..", "/abs"]) {
      expect(parseJusticeReviewHistoryCommandArguments(`--gate ${gateId}`)).toBeNull();
    }
  });
});

function summaryPayload(): ReviewHistoryPayload {
  const dto: HistorySummaryDto = {
    dtoVersion: 1,
    reviewScopeId: "scope-1",
    gateId: "gate-a",
    status: "completed",
    phase: "plan",
    epochId: "epoch-2",
    epochStartedAt: "2026-10-08T00:00:02.000Z",
    epochReason: "orchestration_resumed",
    designClear: {
      epochId: "epoch-1",
      emittedAt: "2026-10-08T00:00:01.000Z",
      designProtocolFingerprint: "e".repeat(64),
    },
    blockers: { remediable: 1, upstream: 2, pendingRevalidation: 3 },
    remediationUsage: {
      design: { used: 2, remaining: 3 },
      plan: { used: 0, remaining: 3 },
    },
    lastTransition: {
      eventType: "PLAN_CLEAR",
      epochId: "epoch-2",
      emittedAt: "2026-10-08T00:00:05.000Z",
    },
    resumeCursor: { kind: "completed" },
    gateRevision: 7,
    headEventId: "h1",
    storage: null,
  };
  return { view: "summary", dto };
}

describe("renderReviewHistoryCommandGuidance", () => {
  it("renders a stable display block for a summary query", () => {
    const guidance = renderReviewHistoryCommandGuidance({
      kind: "display",
      payload: summaryPayload(),
    });

    expect(guidance).toContain("[JUSTICE: REVIEW HISTORY]");
    expect(guidance).toContain("gateId: gate-a");
    expect(guidance).toContain("status: completed");
    expect(guidance).toContain("phase: plan");
    expect(guidance).toContain("remediation: design 2/5 (3 remaining), plan 0/3 (3 remaining)");
    expect(guidance).toContain("resumeCursor: completed");
    expect(guidance).toContain("events: 7");
    // Raw events are never exposed.
    expect(guidance).not.toContain('"eventType"');
    expect(guidance).not.toContain("payload");
  });

  it("renders findings and rounds views deterministically", () => {
    const rounds: HistoryRoundsDto = {
      dtoVersion: 1,
      reviewScopeId: "scope-1",
      gateId: "gate-a",
      designRounds: [1, 2],
      planRounds: [1],
    };
    const findings: HistoryFindingsDto = {
      dtoVersion: 1,
      reviewScopeId: "scope-1",
      gateId: "gate-a",
      findings: [
        {
          lineageId: "lin-1",
          findingId: "finding-1",
          observedPhase: "design",
          ownerScope: "design",
          status: "remediated",
          remediationRound: { phase: "design", ordinal: 1 },
          reopenedBy: null,
          descriptionDigest: "f".repeat(64),
        },
      ],
    };

    const first = renderReviewHistoryCommandGuidance({
      kind: "display",
      payload: { view: "rounds", dto: rounds },
    });
    const second = renderReviewHistoryCommandGuidance({
      kind: "display",
      payload: { view: "findings", dto: findings },
    });

    expect(first).toContain("[JUSTICE: REVIEW HISTORY]");
    expect(first).toContain("design round 1");
    expect(first).toContain("plan round 1");
    expect(second).toContain("finding-1");
    expect(second).toContain("remediated");
    // Deterministic rendering
    expect(first).toBe(
      renderReviewHistoryCommandGuidance({ kind: "display", payload: { view: "rounds", dto: rounds } }),
    );
  });

  it("renders failure kinds without any partial DTO content", () => {
    for (const failure of [
      "not_found",
      "conflict",
      "unsupported_version",
      "unavailable",
    ] as const) {
      const result: ReviewHistoryQueryResult = {
        kind: "failure",
        failure,
        message: "review_history_reason_code",
      };
      const guidance = renderReviewHistoryCommandGuidance(result);
      expect(guidance).toContain("[JUSTICE: REVIEW HISTORY");
      expect(guidance).toContain("review_history_reason_code");
      expect(guidance).not.toContain("gateId:");
      expect(guidance).not.toContain("events:");
    }
  });
});
