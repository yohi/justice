import { describe, expect, it } from "vitest";
import {
  formatWorkflowDirective,
  resolveWorkflowDirective,
} from "../../src/core/workflow-directives";

describe("resolveWorkflowDirective", () => {
  it.each([
    ["design_required", ["brainstorming"], "invoke_skill", "artifact_ready"],
    ["plan_required", ["writing-plans"], "invoke_skill", "artifact_ready"],
    ["plan_review_required", ["requesting-code-review"], "request_review", "artifact_ready"],
    ["review_remediation", ["receiving-code-review"], "invoke_skill", "artifact_ready"],
    ["review_clear", [], "await_human_approval", "external_unverified"],
    [
      "implementation",
      ["test-driven-development", "verification-before-completion"],
      "delegate_task",
      "external_unverified",
    ],
    ["implementation_unauthorized", [], "await_human_approval", "external_unverified"],
  ] as const)(
    "returns the full policy contract for %s",
    (stage, requiredSkills, nextAction, authority) => {
      // When
      const directive = resolveWorkflowDirective({ stage });

      // Then
      expect(directive.requiredSkills).toEqual(requiredSkills);
      expect(directive.nextAction).toBe(nextAction);
      expect(directive.authority).toBe(authority);
    },
  );
});

describe("formatWorkflowDirective", () => {
  it.each([
    ["design_required", "[JUSTICE: DESIGN REQUIRED]"],
    ["plan_required", "[JUSTICE: PLAN REQUIRED]"],
    ["plan_review_required", "[JUSTICE: PLAN REVIEW REQUIRED]"],
    ["review_remediation", "[JUSTICE: REVIEW REMEDIATION]"],
    ["review_clear", "[JUSTICE: REVIEW CLEAR]"],
    ["implementation", "[JUSTICE: IMPLEMENTATION]"],
    ["implementation_unauthorized", "[JUSTICE: IMPLEMENTATION UNAUTHORIZED]"],
  ] as const)("returns %s structural marker", (stage, marker) => {
    // Given
    const input = { stage };

    // When
    const directive = formatWorkflowDirective(input);

    expect(directive).toContain(marker);
  });

  it.each([
    ["plan_review_required", "requesting-code-review"],
    ["review_remediation", "receiving-code-review"],
  ] as const)("exposes %s as a required skill marker", (stage, requiredSkill) => {
    // When
    const directive = formatWorkflowDirective({ stage });

    // Then
    expect(directive).toContain(`[JUSTICE: REQUIRED SKILLS: ${requiredSkill}]`);
  });

  it("states that Justice cannot verify external approval or merge status for implementation", () => {
    // When
    const directive = formatWorkflowDirective({ stage: "implementation" });

    // Then
    expect(directive).toContain("Justiceは外部での承認やマージ状態を検証できません");
    expect(directive).toContain("外部の人間による承認・マージ完了の確認後にのみ継続");
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
