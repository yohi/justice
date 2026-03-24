import { describe, it, expect } from "vitest";
import { TaskSplitter } from "../../src/core/task-splitter";
import type { PlanTask } from "../../src/core/types";

describe("TaskSplitter", () => {
  const splitter = new TaskSplitter();

  describe("suggestSplit", () => {
    it("should split a task with 4+ steps into two sub-tasks", () => {
      const task: PlanTask = {
        id: "task-1",
        title: "Implement feature",
        status: "failed",
        steps: [
          { id: "s1", description: "Setup", checked: false, lineNumber: 1 },
          { id: "s2", description: "Core logic", checked: false, lineNumber: 2 },
          { id: "s3", description: "Tests", checked: false, lineNumber: 3 },
          { id: "s4", description: "Integration", checked: false, lineNumber: 4 },
        ],
      };
      const suggestion = splitter.suggestSplit(task, "timeout");
      expect(suggestion.suggestedSubTasks.length).toBeGreaterThanOrEqual(2);
      expect(suggestion.originalTaskId).toBe("task-1");
    });

    it("should split timeout errors into implementation and testing", () => {
      const task: PlanTask = {
        id: "task-2",
        title: "Build module",
        status: "failed",
        steps: [
          { id: "s1", description: "Write code", checked: false, lineNumber: 1 },
          { id: "s2", description: "Write tests", checked: false, lineNumber: 2 },
        ],
      };
      const suggestion = splitter.suggestSplit(task, "timeout");
      const hasImpl = suggestion.suggestedSubTasks.some((st) => st.title.includes("実装"));
      const hasTest = suggestion.suggestedSubTasks.some((st) => st.title.includes("テスト"));
      expect(hasImpl).toBe(true);
      expect(hasTest).toBe(true);
      expect(suggestion.suggestedSubTasks).toHaveLength(2);
    });

    it("should split loop_detected into individual steps", () => {
      const task: PlanTask = {
        id: "task-3",
        title: "Refactor",
        status: "failed",
        steps: [
          { id: "s1", description: "Part 1", checked: false, lineNumber: 1 },
          { id: "s2", description: "Part 2", checked: false, lineNumber: 2 },
        ],
      };
      const suggestion = splitter.suggestSplit(task, "loop_detected");
      expect(suggestion.suggestedSubTasks).toHaveLength(2);
      expect(suggestion.suggestedSubTasks[0]?.title).toContain("Part 1");
    });

    it("should return single-task suggestion for small tasks on simple errors", () => {
      const task: PlanTask = {
        id: "task-4",
        title: "Fix bug",
        status: "failed",
        steps: [{ id: "s1", description: "Fix it", checked: false, lineNumber: 1 }],
      };
      const suggestion = splitter.suggestSplit(task, "syntax_error");
      // Even if small, it suggests at least 1 subtask (or returns the original if no split makes sense)
      expect(suggestion.suggestedSubTasks.length).toBe(1);
    });
  });

  describe("formatAsPlanMarkdown", () => {
    it("should format suggestion as plan.md compatible markdown", () => {
      const task: PlanTask = {
        id: "task-5",
        title: "Format test",
        status: "failed",
        steps: [{ id: "s1", description: "Do something", checked: false, lineNumber: 1 }],
      };
      const suggestion = splitter.suggestSplit(task, "loop_detected");
      const markdown = splitter.formatAsPlanMarkdown(suggestion);
      
      expect(markdown).toContain("## Task");
      expect(markdown).toContain("- [ ]");
      expect(markdown).toContain("Do something");
    });
  });
});
