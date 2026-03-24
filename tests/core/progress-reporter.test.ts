import { describe, it, expect } from "vitest";
import { ProgressReporter } from "../../src/core/progress-reporter";
import type { PlanTask } from "../../src/core/types";

const makeTasks = (): PlanTask[] => [
  {
    id: "task-1",
    title: "Setup",
    status: "completed",
    steps: [
      { id: "s1", description: "Init", checked: true, lineNumber: 1 },
      { id: "s2", description: "Config", checked: true, lineNumber: 2 },
    ],
  },
  {
    id: "task-2",
    title: "Implement",
    status: "in_progress",
    steps: [
      { id: "s3", description: "Write tests", checked: true, lineNumber: 3 },
      { id: "s4", description: "Write code", checked: false, lineNumber: 4 },
    ],
  },
  {
    id: "task-3",
    title: "Deploy",
    status: "pending",
    steps: [
      { id: "s5", description: "Build", checked: false, lineNumber: 5 },
      { id: "s6", description: "Push", checked: false, lineNumber: 6 },
    ],
  },
];

describe("ProgressReporter", () => {
  const reporter = new ProgressReporter();

  describe("generateReport", () => {
    it("should calculate overall progress percentage", () => {
      const report = reporter.generateReport(makeTasks());
      // 3/6 steps completed = 50%
      expect(report.overallProgress).toBe(50);
    });

    it("should include per-task status", () => {
      const report = reporter.generateReport(makeTasks());
      expect(report.taskStatuses).toHaveLength(3);
      expect(report.taskStatuses[0]).toEqual({
        taskId: "task-1",
        title: "Setup",
        status: "completed",
        completedSteps: 2,
        totalSteps: 2,
      });
      expect(report.taskStatuses[1]).toEqual({
        taskId: "task-2",
        title: "Implement",
        status: "in_progress",
        completedSteps: 1,
        totalSteps: 2,
      });
    });

    it("should handle empty task list", () => {
      const report = reporter.generateReport([]);
      expect(report.overallProgress).toBe(100);
      expect(report.taskStatuses).toHaveLength(0);
    });
  });

  describe("formatAsMarkdown", () => {
    it("should produce readable Markdown with progress bar", () => {
      const report = reporter.generateReport(makeTasks());
      const md = reporter.formatAsMarkdown(report);

      expect(md).toContain("50%");
      expect(md).toContain("✅ Setup");
      expect(md).toContain("🔄 Implement");
      expect(md).toContain("⬜ Deploy");
    });
  });

  describe("formatAsCompact", () => {
    it("should produce a single-line summary", () => {
      const report = reporter.generateReport(makeTasks());
      const compact = reporter.formatAsCompact(report);

      expect(compact).toContain("50%");
      expect(compact).toContain("1/3");
    });
  });
});
