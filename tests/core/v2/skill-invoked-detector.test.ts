import { describe, expect, it } from "vitest";
import { detectSkillInvoked } from "../../../src/core/v2/skill-invoked-detector";

describe("detectSkillInvoked", () => {
  it("detects a direct skill tool invocation with its callId", () => {
    const result = detectSkillInvoked("skill", { name: "test-driven-development" }, "call-1");

    expect(result).toEqual([
      {
        skillName: "test-driven-development",
        source: "skill_tool",
        callId: "call-1",
      },
    ]);
  });

  it("detects every non-empty string in a task load_skills argument", () => {
    const result = detectSkillInvoked(
      "task",
      { load_skills: ["programming", 42, "verification-before-completion", ""] },
      "call-2",
    );

    expect(result).toEqual([
      { skillName: "programming", source: "task_load_skills", callId: "call-2" },
      {
        skillName: "verification-before-completion",
        source: "task_load_skills",
        callId: "call-2",
      },
    ]);
  });

  it("returns no invocations for malformed or unrelated arguments", () => {
    expect(detectSkillInvoked("skill", { name: "" })).toEqual([]);
    expect(detectSkillInvoked("task", { load_skills: "programming" })).toEqual([]);
    expect(detectSkillInvoked("bash", { name: "programming" })).toEqual([]);
  });
});
