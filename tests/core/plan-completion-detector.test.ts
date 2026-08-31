import { describe, expect, it } from "vitest";
import {
  inferPersonaFromToolInput,
  PlanCompletionDetector,
} from "../../src/core/plan-completion-detector";

describe("inferPersonaFromToolInput", () => {
  it("infers review and debugging personas from skills", () => {
    expect(inferPersonaFromToolInput({ skills: ["code-quality-reviewer"] })).toBe("prometheus");
    expect(inferPersonaFromToolInput({ loadSkills: ["systematic-debugging"] })).toBe("sisyphus");
    expect(inferPersonaFromToolInput({ skills: ["writing-plans"] })).toBe("atlas");
  });

  it("infers personas from role or prompt text", () => {
    expect(inferPersonaFromToolInput({ role: "spec-reviewer" })).toBe("prometheus");
    expect(inferPersonaFromToolInput({ prompt: "please run systematic-debugging" })).toBe("sisyphus");
  });

  it("infers Atlas from brainstorming text", () => {
    expect(inferPersonaFromToolInput({ prompt: "please use brainstorming" })).toBe("atlas");
  });

  it("returns undefined for unrelated input", () => {
    expect(inferPersonaFromToolInput({ skills: ["implementer-prompt"] })).toBeUndefined();
  });
});

describe("PlanCompletionDetector", () => {
  const detector = new PlanCompletionDetector();

  it("returns Atlas guidance for completed writing work", () => {
    const result = detector.detectCompletion({
      prompt: "Write the README update",
      category: "writing",
      completed: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        persona: "atlas",
        trigger: "writing_category",
      }),
    );
    expect(result?.guidance).toContain("Atlas guidance");
  });

  it("returns Sisyphus insight for systematic-debugging completions", () => {
    const result = detector.detectCompletion({
      prompt: "Debug the failing test",
      category: "deep",
      skillName: "systematic-debugging",
      completed: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        persona: "sisyphus",
        trigger: "systematic_debugging_skill",
      }),
    );
    expect(result?.guidance).toContain("Sisyphus insight");
  });

  it("prioritizes systematic-debugging skill over writing category", () => {
    const result = detector.detectCompletion({
      prompt: "Debug and document findings",
      category: "writing",
      skillName: "systematic-debugging",
      completed: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        persona: "sisyphus",
        trigger: "systematic_debugging_skill",
      }),
    );
    expect(result?.guidance).toContain("Sisyphus insight");
  });

  it("returns Prometheus pivot when code review rejects the output", () => {
    const result = detector.detectCompletion({
      prompt: "Review the patch",
      category: "deep",
      skillName: "code-review",
      completed: true,
      rawOutput: "BLOCKER: missing tests\nMUST FIX: update the error handling",
    });

    expect(result).toEqual(
      expect.objectContaining({
        persona: "prometheus",
        trigger: "code_review_rejection",
      }),
    );
    expect(result?.guidance).toContain("Prometheus pivot");
    expect(result?.guidance).toContain("BLOCKER");
  });

  it("returns null when nothing matches", () => {
    expect(
      detector.detectCompletion({
        prompt: "Implement a feature",
        category: "deep",
        completed: true,
      }),
    ).toBeNull();
    expect(
      detector.detectCompletion({
        prompt: "Draft docs",
        category: "writing",
        completed: false,
      }),
    ).toBeNull();
  });
});
