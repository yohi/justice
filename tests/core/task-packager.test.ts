import { describe, it, expect } from "vitest";
import { TaskPackager } from "../../src/core/task-packager";
import type { PlanTask, PlanStep } from "../../src/core/types";

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
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
      });

      expect(request.prompt).toContain("Write test");
      expect(request.prompt).toContain("Implement code");
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
});