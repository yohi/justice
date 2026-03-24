import { describe, it, expect } from "vitest";
import { PlanParser } from "../../src/core/plan-parser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

describe("PlanParser", () => {
  const parser = new PlanParser();

  describe("parse", () => {
    it("should parse a full plan.md into PlanTasks", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan.md"), "utf-8");
      const tasks = parser.parse(content);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].id).toBe("task-1");
      expect(tasks[0].title).toBe("Setup project structure");
      expect(tasks[0].steps).toHaveLength(3);
    });

    it("should correctly detect checked/unchecked steps", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan.md"), "utf-8");
      const tasks = parser.parse(content);

      // Task 1: 2 unchecked, 1 checked
      expect(tasks[0].steps[0].checked).toBe(false);
      expect(tasks[0].steps[1].checked).toBe(false);
      expect(tasks[0].steps[2].checked).toBe(true);
    });

    it("should derive task status from step completion", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan-partial.md"), "utf-8");
      const tasks = parser.parse(content);

      expect(tasks[0].status).toBe("completed"); // all checked
      expect(tasks[1].status).toBe("in_progress"); // some checked
      expect(tasks[2].status).toBe("pending"); // none checked
    });

    it("should record line numbers for each step", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan.md"), "utf-8");
      const tasks = parser.parse(content);

      // Each step should have a positive line number
      for (const task of tasks) {
        for (const step of task.steps) {
          expect(step.lineNumber).toBeGreaterThan(0);
        }
      }
    });

    it("should generate sequential step IDs", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan.md"), "utf-8");
      const tasks = parser.parse(content);

      expect(tasks[0].steps[0].id).toBe("task-1-step-1");
      expect(tasks[0].steps[1].id).toBe("task-1-step-2");
      expect(tasks[0].steps[2].id).toBe("task-1-step-3");
    });

    it("should handle empty content", () => {
      const tasks = parser.parse("");
      expect(tasks).toHaveLength(0);
    });

    it("should handle content with no tasks", () => {
      const tasks = parser.parse("# Just a title\n\nSome text without tasks.");
      expect(tasks).toHaveLength(0);
    });
  });

  describe("updateCheckbox", () => {
    it("should check an unchecked step", () => {
      const content = "- [ ] Step 1\n- [ ] Step 2\n";
      const updated = parser.updateCheckbox(content, 1, true);
      expect(updated).toBe("- [x] Step 1\n- [ ] Step 2\n");
    });

    it("should uncheck a checked step", () => {
      const content = "- [x] Step 1\n- [ ] Step 2\n";
      const updated = parser.updateCheckbox(content, 1, false);
      expect(updated).toBe("- [ ] Step 1\n- [ ] Step 2\n");
    });

    it("should not modify other lines", () => {
      const content = "# Title\n- [ ] Step 1\n- [x] Step 2\nSome text\n";
      const updated = parser.updateCheckbox(content, 2, true);
      expect(updated).toBe("# Title\n- [x] Step 1\n- [x] Step 2\nSome text\n");
    });

    it("should throw for invalid line number", () => {
      const content = "- [ ] Step 1\n";
      expect(() => parser.updateCheckbox(content, 0, true)).toThrow();
      expect(() => parser.updateCheckbox(content, 99, true)).toThrow();
    });

    it("should throw if line is not a checkbox", () => {
      const content = "# Title\n- [ ] Step 1\n";
      expect(() => parser.updateCheckbox(content, 1, true)).toThrow();
    });
  });

  describe("appendErrorNote", () => {
    it("should append an error note after a specific task heading", () => {
      const content = "### Task 1: Do something\n\n- [ ] Step 1\n\n### Task 2: Other\n";
      const updated = parser.appendErrorNote(content, "task-1", "Test failed: assertion error");
      expect(updated).toContain(
        "### Task 1: Do something\n\n> ⚠️ **Error**: Test failed: assertion error\n\n\n- [ ] Step 1",
      );
    });

    it("should throw an error for invalid taskId format", () => {
      const content = "### Task 1: Do something\n";
      expect(() => parser.appendErrorNote(content, "task-1-step-1", "Error")).toThrow(
        "Invalid taskId format",
      );
    });
  });

  describe("getNextIncompleteTask", () => {
    it("should return the first incomplete task", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan-partial.md"), "utf-8");
      const tasks = parser.parse(content);
      const next = parser.getNextIncompleteTask(tasks);
      expect(next).toBeDefined();
      expect(next!.id).toBe("task-2");
    });

    it("should return undefined when all tasks are complete", () => {
      const tasks = parser.parse("## Task 1: Done\n\n- [x] Step 1\n");
      const next = parser.getNextIncompleteTask(tasks);
      expect(next).toBeUndefined();
    });
  });

  describe("metadata and comments handling", () => {
    it("should ignore blockquote metadata lines and only parse tasks and checkboxes", () => {
      const content = `
# Plan
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> This is another metadata line

## Task 1: Setup
- [ ] Step 1
`;
      const tasks = parser.parse(content);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("task-1");
      expect(tasks[0].steps).toHaveLength(1);
      // Verify no metadata leaked into task title or step description
      expect(tasks[0].title).toBe("Setup");
      expect(tasks[0].steps[0].description).toBe("Step 1");
    });
  });
});
