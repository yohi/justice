import { describe, expect, it } from "vitest";
import { GateRuleSchema } from "../../../src/core/v2/gate-definition";

describe("GateRuleSchema", () => {
  it("accepts a valid gate rule", () => {
    const result = GateRuleSchema.parse({
      id: "require-tests",
      description: "Require passing test evidence",
      gateType: "task",
      trigger: { on: "task_complete" },
      check: {
        type: "evidence_outcome",
        evidenceKind: "test",
        requireOutcome: "pass",
      },
      onViolation: "fail",
      onMissingEvidence: "warn",
      enabled: true,
    });

    expect(result.id).toBe("require-tests");
    expect(result.check).toEqual({
      type: "evidence_outcome",
      evidenceKind: "test",
      requireOutcome: "pass",
    });
  });

  it("rejects an unsupported check type", () => {
    const result = GateRuleSchema.safeParse({
      id: "unsupported-check",
      gateType: "task",
      trigger: { on: "task_complete" },
      check: { type: "unknown_check" },
      onViolation: "fail",
      onMissingEvidence: "warn",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a gate rule missing required fields", () => {
    const result = GateRuleSchema.safeParse({
      id: "missing-violation-action",
      gateType: "task",
      trigger: { on: "task_complete" },
      check: { type: "evidence_present", evidenceKind: "build" },
      onMissingEvidence: "warn",
    });

    expect(result.success).toBe(false);
  });

  it("applies enabled and minimum severity defaults", () => {
    const result = GateRuleSchema.parse({
      id: "review-items",
      gateType: "task",
      trigger: { on: "tool_observed" },
      check: { type: "review_open_items" },
      onViolation: "warn",
      onMissingEvidence: "pass",
    });

    expect(result.enabled).toBe(true);
    expect(result.check).toEqual({
      type: "review_open_items",
      minimumSeverity: "major",
    });
  });
});
