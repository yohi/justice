import { describe, expect, it } from "vitest";
import { formatWorkflowDirective } from "../../src/core/workflow-directives";

describe("formatWorkflowDirective", () => {
  it.each([
    ["design_required", "[JUSTICE: DESIGN REQUIRED]"],
    ["plan_required", "[JUSTICE: PLAN REQUIRED]"],
    ["plan_review_required", "[JUSTICE: PLAN REVIEW REQUIRED]"],
    ["review_remediation", "[JUSTICE: REVIEW REMEDIATION]"],
    ["review_clear", "[JUSTICE: REVIEW CLEAR]"],
    ["implementation", "[JUSTICE: IMPLEMENTATION]"],
  ] as const)("returns %s structural marker", (stage, marker) => {
    // Given
    const input = { stage };

    // When
    const directive = formatWorkflowDirective(input);

    // Then
    expect(directive).toContain(marker);
  });
  it("assertNever throws for an unexpected stage value", () => {
    // Given
    const invalidStage = "invalid_stage" as unknown as Parameters<typeof formatWorkflowDirective>[0]["stage"];

    // When / Then
    expect(() => formatWorkflowDirective({ stage: invalidStage })).toThrow(
      "Unsupported workflow directive stage: invalid_stage",
    );
  });
});
