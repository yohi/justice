import { describe, expect, it } from "vitest";
import {
  classifyReviewGateToolUse,
  type ReviewGateLockSnapshot,
  type ReviewGateToolUse,
} from "../../src/core/review-gate-lock";

const clearLock: ReviewGateLockSnapshot = {
  parentSessionId: "parent-session",
  gateId: "gate-123",
  phase: "awaiting_implementation_authorization",
  designPath: "docs/specs/design.md",
  planPath: "docs/plans/plan.md",
  designDigest: "design-sha256",
  planDigest: "plan-sha256",
};

function reviewToolUse(
  toolName: string,
  overrides: Partial<ReviewGateToolUse> = {},
): ReviewGateToolUse {
  return {
    lockOwnerSessionId: "parent-session",
    toolName,
    isPendingReviewGateTask: false,
    queryOnly: false,
    changedPaths: [],
    ...overrides,
  };
}

describe("classifyReviewGateToolUse", () => {
  it("allows read-only inspection while awaiting implementation authorization", () => {
    const decision = classifyReviewGateToolUse(clearLock, reviewToolUse("read"));

    expect(decision).toEqual({ kind: "allow" });
  });

  it("allows only the exact pending Review Gate task while review is in progress", () => {
    const reviewingLock = { ...clearLock, phase: "reviewing" as const };
    const decision = classifyReviewGateToolUse(
      reviewingLock,
      reviewToolUse("task", { isPendingReviewGateTask: true }),
    );

    expect(decision).toEqual({ kind: "allow" });
  });

  it("denies generic task delegation while implementation is locked", () => {
    const decision = classifyReviewGateToolUse(clearLock, reviewToolUse("task"));

    expect(decision).toEqual({ kind: "deny", reason: "implementation_not_authorized" });
  });

  it("allows plan-only writes while findings are in remediation", () => {
    const remediationLock = { ...clearLock, phase: "remediation" as const };
    const decision = classifyReviewGateToolUse(
      remediationLock,
      reviewToolUse("edit", { changedPaths: ["docs/plans/plan.md"] }),
    );

    expect(decision).toEqual({ kind: "allow" });
  });

  it.each(["filesystem_edit_file", "filesystem_write_file"])(
    "allows %s for a reviewed plan during remediation",
    (toolName) => {
      const remediationLock = { ...clearLock, phase: "remediation" as const };
      const decision = classifyReviewGateToolUse(
        remediationLock,
        reviewToolUse(toolName, { changedPaths: ["docs/plans/plan.md"] }),
      );

      expect(decision).toEqual({ kind: "allow" });
    },
  );

  it("denies filesystem edit tools when they target a file outside the reviewed scope", () => {
    const remediationLock = { ...clearLock, phase: "remediation" as const };
    const decision = classifyReviewGateToolUse(
      remediationLock,
      reviewToolUse("filesystem_edit_file", { changedPaths: ["src/runtime/worker.ts"] }),
    );

    expect(decision).toEqual({ kind: "deny", reason: "review_scope_violation" });
  });

  it("denies remediation writes that escape the reviewed artifact scope", () => {
    const remediationLock = { ...clearLock, phase: "remediation" as const };
    const decision = classifyReviewGateToolUse(
      remediationLock,
      reviewToolUse("apply_patch", {
        changedPaths: ["docs/plans/plan.md", "src/runtime/worker.ts"],
      }),
    );

    expect(decision).toEqual({ kind: "deny", reason: "review_scope_violation" });
  });

  it("denies a remediation write when its target path cannot be resolved", () => {
    const remediationLock = { ...clearLock, phase: "remediation" as const };
    const decision = classifyReviewGateToolUse(remediationLock, {
      ...reviewToolUse("write"),
      changedPaths: null,
    });

    expect(decision).toEqual({ kind: "deny", reason: "review_scope_violation" });
  });

  it("denies Plan/Design edits after a clear review until implementation is armed", () => {
    const decision = classifyReviewGateToolUse(
      clearLock,
      reviewToolUse("write", { changedPaths: ["docs/plans/plan.md"] }),
    );

    expect(decision).toEqual({ kind: "deny", reason: "implementation_not_authorized" });
  });

  it("allows a review query but denies review resolution while locked", () => {
    expect(
      classifyReviewGateToolUse(
        clearLock,
        reviewToolUse("justice_review", { queryOnly: true }),
      ),
    ).toEqual({ kind: "allow" });
    expect(
      classifyReviewGateToolUse(
        clearLock,
        reviewToolUse("justice_review", { queryOnly: false }),
      ),
    ).toEqual({ kind: "deny", reason: "implementation_not_authorized" });
  });

  it.each(["bash", "mcp_unknown", "unrecognized_tool"])(
    "denies implementation-capable or unknown tool %s",
    (toolName) => {
      expect(classifyReviewGateToolUse(clearLock, reviewToolUse(toolName))).toEqual({
        kind: "deny",
        reason: "implementation_not_authorized",
      });
    },
  );

  it.each(["reviewing", "remediation", "awaiting_implementation_authorization"] as const)(
    "allows skill loading during %s",
    (phase) => {
      const lock: ReviewGateLockSnapshot = { ...clearLock, phase };
      expect(classifyReviewGateToolUse(lock, reviewToolUse("skill"))).toEqual({ kind: "allow" });
    },
  );

  it("denies implementation-capable calls when the lock owner is different or unknown", () => {
    const decision = classifyReviewGateToolUse(
      clearLock,
      reviewToolUse("bash", { lockOwnerSessionId: "unrelated-session" }),
    );

    expect(decision).toEqual({ kind: "deny", reason: "implementation_not_authorized" });
    expect(
      classifyReviewGateToolUse(
        clearLock,
        reviewToolUse("task", { lockOwnerSessionId: null }),
      ),
    ).toEqual({ kind: "deny", reason: "implementation_not_authorized" });
    expect(
      classifyReviewGateToolUse(
        clearLock,
        reviewToolUse("read", { lockOwnerSessionId: null }),
      ),
    ).toEqual({ kind: "allow" });
  });
});
