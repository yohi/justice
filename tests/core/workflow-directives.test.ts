import { describe, expect, it } from "vitest";
import { formatWorkflowDirective } from "../../src/core/workflow-directives";

describe("formatWorkflowDirective", () => {
  it.each([
    ["design_required", "[JUSTICE: DESIGN REQUIRED]"],
    ["plan_required", "[JUSTICE: PLAN REQUIRED]"],
    ["plan_review_required", "[JUSTICE: PLAN REVIEW REQUIRED]"],
    ["review_remediation", "[JUSTICE: REVIEW REMEDIATION]"],
    ["review_clear", "[JUSTICE: REVIEW CLEAR]"],
    ["implementation_unauthorized", "[JUSTICE: IMPLEMENTATION UNAUTHORIZED]"],
  ] as const)("returns %s structural marker", (stage, marker) => {
    // Given
    const input = { stage };

    // When
    const directive = formatWorkflowDirective(input);

    expect(directive).toContain(marker);
  });

  it("states that Justice cannot verify external approval or merge status for implementation", () => {
    // When
    const directive = formatWorkflowDirective({ stage: "implementation" });

    // Then
    expect(directive).toContain("Justiceは外部での承認やマージ状態を検証できません");
    expect(directive).toContain("外部で承認が確認できた場合にのみ");
  });

  it("warns that implementation tasks before human approval/merge are unauthorized", () => {
    // When
    const directive = formatWorkflowDirective({ stage: "implementation_unauthorized" });

    // Then
    expect(directive).toContain("[JUSTICE: IMPLEMENTATION UNAUTHORIZED]");
    expect(directive).toContain("まだ外部で人間による承認・マージが確認されていません");
    expect(directive).toContain("実行を物理的に停止することはできません");
    expect(directive).toContain("承認とマージが完了していることを確認してください");
    expect(directive).toContain("task() をキャンセル");
  });
  it("assertNever throws for an unexpected stage value", () => {
    // Given
    const invalidStage = "invalid_stage" as unknown as Parameters<
      typeof formatWorkflowDirective
    >[0]["stage"];

    // When / Then
    expect(() => formatWorkflowDirective({ stage: invalidStage })).toThrow(
      "Unsupported workflow directive stage: invalid_stage",
    );
  });
});
