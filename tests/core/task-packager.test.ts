import { describe, it, expect, vi } from "vitest";
import {
  enrichTaskToolInput,
  mergeTaskLoadSkills,
  TaskPackager,
} from "../../src/core/task-packager";
import type { PlanTask } from "../../src/core/types";

describe("TaskPackager", () => {
  const packager = new TaskPackager();

  const makeTask = (overrides?: Partial<PlanTask>): PlanTask => ({
    id: "task-1",
    title: "Implement feature",
    steps: [
      { id: "task-1-step-1", description: "Write test", checked: false, lineNumber: 5 },
      { id: "task-1-step-2", description: "Implement code", checked: false, lineNumber: 6 },
    ],
    status: "pending",
    ...overrides,
  });

  it("preserves caller skills while adding required implementation skills", () => {
    // When
    const skills = mergeTaskLoadSkills(["domain-skill"], ["test-driven-development"]);

    // Then
    expect(skills).toEqual(["domain-skill", "test-driven-development"]);
  });

  it("deduplicates task load skills while preserving first-seen order", () => {
    // When
    const skills = mergeTaskLoadSkills(
      ["domain-skill", "test-driven-development"],
      ["test-driven-development", "verification-before-completion"],
    );

    // Then
    expect(skills).toEqual([
      "domain-skill",
      "test-driven-development",
      "verification-before-completion",
    ]);
  });

  it("preserves an existing taskId while enriching task tool input", () => {
    const original = { prompt: "run", taskId: "task-existing" };

    const enriched = enrichTaskToolInput(original, "task-generated");

    expect(enriched).toEqual({ prompt: "run", taskId: "task-existing" });
    expect(original).toEqual({ prompt: "run", taskId: "task-existing" });
  });

  it("merges loadSkills into task tool input while preserving existing taskId", () => {
    const original = { prompt: "run", taskId: "task-existing", loadSkills: ["writing-plans"] };

    const enriched = enrichTaskToolInput(original, "task-generated", {
      loadSkills: ["writing-plans", "test-driven-development"],
    });

    expect(enriched).toEqual({
      prompt: "run",
      taskId: "task-existing",
      loadSkills: ["writing-plans", "test-driven-development"],
    });
    expect(original).toEqual({
      prompt: "run",
      taskId: "task-existing",
      loadSkills: ["writing-plans"],
    });
  });

  it("normalizes legacy load_skills into the canonical task skill field", () => {
    const original = {
      prompt: "run",
      load_skills: ["domain-skill", "test-driven-development"],
    };

    const enriched = enrichTaskToolInput(original, "task-generated", {
      loadSkills: ["test-driven-development", "verification-before-completion"],
    });

    expect(enriched).toEqual({
      prompt: "run",
      taskId: "task-generated",
      loadSkills: [
        "domain-skill",
        "test-driven-development",
        "verification-before-completion",
      ],
    });
    expect(original).toEqual({
      prompt: "run",
      load_skills: ["domain-skill", "test-driven-development"],
    });
  });

  it("deduplicates loadSkills when merging into task tool input", () => {
    const original = { prompt: "run", skills: ["writing-plans"] };

    const enriched = enrichTaskToolInput(original, "task-generated", {
      loadSkills: ["verification-before-completion", "test-driven-development"],
    });

    expect(enriched).toEqual({
      prompt: "run",
      taskId: "task-generated",
      loadSkills: ["writing-plans", "verification-before-completion", "test-driven-development"],
    });

    expect(enriched).toEqual({
      prompt: "run",
      taskId: "task-generated",
      loadSkills: ["writing-plans", "verification-before-completion", "test-driven-development"],
    });
  });

  describe("package", () => {
    it("should create a DelegationRequest from a PlanTask", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "docs/plans/plan.md",
        referenceFiles: ["src/main.ts"],
      });

      expect(request.category).toBe("deep");
      expect(request.context.taskId).toBe("task-1");
      expect(request.context.planFilePath).toBe("docs/plans/plan.md");
      expect(request.context.referenceFiles).toEqual(["src/main.ts"]);
      expect(request.runInBackground).toBe(false);
      expect(request.prompt).toContain("Implement feature");
    });

    it("should include role prompt when provided", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        rolePrompt: "You are an expert TypeScript engineer.",
      });

      expect(request.context.rolePrompt).toBe("You are an expert TypeScript engineer.");
      expect(request.prompt).toContain("You are an expert TypeScript engineer.");
    });

    it("should include previous learnings when provided", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        previousLearnings: "Use ESM imports consistently",
      });

      expect(request.context.previousLearnings).toBe("Use ESM imports consistently");
      expect(request.prompt).toContain("Use ESM imports consistently");
    });

    it("should include step descriptions in prompt", () => {
      const task = makeTask({
        steps: [
          { id: "task-1-step-1", description: "Write test", checked: false, lineNumber: 5 },
          { id: "task-1-step-2", description: "Implement code", checked: false, lineNumber: 6 },
          { id: "task-1-step-3", description: "Already done", checked: true, lineNumber: 7 },
        ],
      });
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
      });

      expect(request.prompt).toContain("Write test");
      expect(request.prompt).toContain("Implement code");
      expect(request.prompt).not.toContain("Already done");
    });

    it("should allow background execution override", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        runInBackground: true,
      });

      expect(request.runInBackground).toBe(true);
    });

    it("should allow category override", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        category: "quick",
      });

      expect(request.category).toBe("quick");
    });
  });

  describe("buildPrompt", () => {
    it("should generate a structured prompt with 7 elements", () => {
      const task = makeTask();
      const prompt = packager.buildPrompt(task, {
        referenceFiles: ["src/main.ts"],
      });

      // Should contain the key sections from OmO's task prompt guide
      expect(prompt).toContain("TASK");
      expect(prompt).toContain("EXPECTED OUTCOME");
      expect(prompt).toContain("CONTEXT");
    });
  });

  it("should warn and respect dominant override when explicit agentId conflicts", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        agentId: "atlas",
        routingCategory: "deep",
        loadSkills: ["implementer-prompt", "code-quality-reviewer"],
      });

      expect(request.context.agentId).toBe("prometheus");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Dominant override (skill: code-quality-reviewer)"),
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
