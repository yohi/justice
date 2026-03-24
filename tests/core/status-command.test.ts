import { describe, it, expect, beforeEach } from "vitest";
import { StatusCommand } from "../../src/core/status-command";
import { createMockFileReader } from "../helpers/mock-file-system";
import type { FileReader } from "../../src/core/types";

describe("StatusCommand", () => {
  const planContent = [
    "## Task 1: Setup",
    "- [x] Init project",
    "- [x] Configure linter",
    "## Task 2: Implement core",
    "- [ ] Write parser (depends: task-1)",
    "- [ ] Write tests",
    "## Task 3: Write docs",
    "- [ ] Write README",
    "## Task 4: Integration",
    "- [ ] E2E tests (depends: task-2, task-3)",
  ].join("\n");

  let reader: FileReader;
  let command: StatusCommand;

  beforeEach(() => {
    reader = createMockFileReader({ "plan.md": planContent });
    command = new StatusCommand(reader);
  });

  describe("getStatus", () => {
    it("should return structured status with progress", async () => {
      const status = await command.getStatus("plan.md");

      expect(status.progress.overallProgress).toBe(33); // 2/6 steps
      expect(status.progress.completedTasks).toBe(1);
      expect(status.progress.totalTasks).toBe(4);
    });

    it("should include parallelizable tasks", async () => {
      const status = await command.getStatus("plan.md");

      expect(status.parallelizable.map((t) => t.id)).toContain("task-2");
      expect(status.parallelizable.map((t) => t.id)).toContain("task-3");
      expect(status.parallelizable.map((t) => t.id)).not.toContain("task-4");
    });

    it("should include execution order", async () => {
      const status = await command.getStatus("plan.md");

      const ids = status.executionOrder.map((t) => t.id);
      expect(ids.indexOf("task-1")).toBeLessThan(ids.indexOf("task-2"));
      expect(ids.indexOf("task-2")).toBeLessThan(ids.indexOf("task-4"));
    });
  });

  describe("formatAsMarkdown", () => {
    it("should produce comprehensive Markdown report", async () => {
      const status = await command.getStatus("plan.md");
      const md = command.formatAsMarkdown(status);

      expect(md).toContain("Progress");
      expect(md).toContain("33%");
      expect(md).toContain("Parallelizable");
      expect(md).toContain("Execution Order");
    });
  });
});
