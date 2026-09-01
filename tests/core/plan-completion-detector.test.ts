import { describe, expect, it, vi } from "vitest";
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
    expect(inferPersonaFromToolInput({ prompt: "please run systematic-debugging" })).toBe(
      "sisyphus",
    );
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

  it("tracks canonical load_skills during pre-tool completion detection", () => {
    const canonicalDetector = new PlanCompletionDetector();

    canonicalDetector.recordPreToolUseInvocation("s-canonical", "c-canonical", "task", {
      load_skills: ["writing-plans"],
    });

    expect(canonicalDetector.lastInvokedPersona("s-canonical")).toBe("atlas");
    expect(
      canonicalDetector.evaluateSkillCompletion(
        "s-canonical",
        "c-canonical",
        "task",
        "Completed the plan",
        false,
        "writing-plans",
      ),
    ).toEqual({ source: "skill_marker", confidence: "high" });
  });

  it("merges all skill aliases during pre-tool completion detection", () => {
    const aliasDetector = new PlanCompletionDetector();

    aliasDetector.recordPreToolUseInvocation("s-aliases", "c-aliases", "task", {
      skills: ["caller-skill"],
      loadSkills: ["caller-skill", "systematic-debugging"],
      load_skills: ["writing-plans", "writing-plans"],
    });

    expect(aliasDetector.lastInvokedPersona("s-aliases")).toBe("sisyphus");
    expect(
      aliasDetector.evaluateSkillCompletion(
        "s-aliases",
        "c-aliases",
        "task",
        "Completed the plan",
        false,
        "writing-plans",
      ),
    ).toEqual({ source: "skill_marker", confidence: "high" });
    expect(
      aliasDetector.evaluateSkillCompletion(
        "s-aliases",
        "c-aliases",
        "task",
        "Debugging completed",
        false,
        "systematic-debugging",
      ),
    ).toEqual({ source: "skill_marker", confidence: "high" });
  });

  it("does not consume a pending skill from another task call in the same session", () => {
    const scopedDetector = new PlanCompletionDetector();

    scopedDetector.recordPreToolUseInvocation("s-scoped", "c-writing", "task", {
      skills: ["writing-plans"],
    });
    scopedDetector.recordPreToolUseInvocation("s-scoped", "c-unrelated", "task", {});

    expect(
      scopedDetector.evaluateSkillCompletion(
        "s-scoped",
        "c-unrelated",
        "task",
        "Completed the plan",
        false,
        "writing-plans",
      ),
    ).toBeNull();
    expect(
      scopedDetector.evaluateSkillCompletion(
        "s-scoped",
        "c-writing",
        "task",
        "Completed the plan",
        false,
        "writing-plans",
      ),
    ).toEqual({ source: "skill_marker", confidence: "high" });
  });

  it("expires persona records after the retention window", () => {
    vi.useFakeTimers();
    try {
      const expiringDetector = new PlanCompletionDetector();
      expiringDetector.recordPreToolUseInvocation("s-expiring", "c-expiring", "task", {
        skills: ["writing-plans"],
      });

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(expiringDetector.lastInvokedPersona("s-expiring")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the oldest pending and persona records when the bounded maps overflow", () => {
    vi.useFakeTimers();
    try {
      const boundedDetector = new PlanCompletionDetector();
      for (let index = 0; index <= 50; index++) {
        boundedDetector.recordPreToolUseInvocation(`s-${index}`, `c-${index}`, "task", {
          skills: ["writing-plans"],
        });
      }

      expect(boundedDetector.lastInvokedPersona("s-0")).toBeUndefined();
      expect(boundedDetector.lastInvokedPersona("s-50")).toBe("atlas");
      expect(
        boundedDetector.evaluateSkillCompletion(
          "s-0",
          "c-0",
          "task",
          "",
          false,
          "writing-plans",
        ),
      ).toBeNull();
      expect(
        boundedDetector.evaluateSkillCompletion(
          "s-50",
          "c-50",
          "task",
          "",
          false,
          "writing-plans",
        ),
      ).toEqual({ source: "skill_marker", confidence: "high" });
    } finally {
      vi.useRealTimers();
    }
  });
});
