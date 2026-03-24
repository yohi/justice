import { describe, it, expect, vi } from "vitest";
import { DependencyAnalyzer } from "../../src/core/dependency-analyzer";
import type { PlanTask } from "../../src/core/types";

const makeTasks = (): PlanTask[] => [
  {
    id: "task-1",
    title: "Setup project structure",
    steps: [
      { id: "task-1-step-1", description: "Create directory", checked: true, lineNumber: 5 },
      { id: "task-1-step-2", description: "Init config", checked: true, lineNumber: 6 },
    ],
    status: "completed",
  },
  {
    id: "task-2",
    title: "Implement core logic",
    steps: [
      {
        id: "task-2-step-1",
        description: "Write parser (depends: task-1)",
        checked: false,
        lineNumber: 10,
      },
      { id: "task-2-step-2", description: "Write tests", checked: false, lineNumber: 11 },
    ],
    status: "pending",
  },
  {
    id: "task-3",
    title: "Add documentation",
    steps: [{ id: "task-3-step-1", description: "Write README", checked: false, lineNumber: 15 }],
    status: "pending",
  },
  {
    id: "task-4",
    title: "Integration testing",
    steps: [
      {
        id: "task-4-step-1",
        description: "E2E tests (depends: task-2, task-3)",
        checked: false,
        lineNumber: 20,
      },
    ],
    status: "pending",
  },
];

describe("DependencyAnalyzer", () => {
  const analyzer = new DependencyAnalyzer();

  describe("extractDependencies", () => {
    it("should extract explicit depends: markers from step descriptions", () => {
      const tasks = makeTasks();
      const deps = analyzer.extractDependencies(tasks);

      expect(deps.get("task-2")).toEqual(["task-1"]);
      expect(deps.get("task-4")).toEqual(expect.arrayContaining(["task-2", "task-3"]));
      expect(deps.get("task-4")).toHaveLength(2);
    });

    it("should return empty array for tasks with no dependencies", () => {
      const tasks = makeTasks();
      const deps = analyzer.extractDependencies(tasks);

      expect(deps.get("task-1")).toEqual([]);
      expect(deps.get("task-3")).toEqual([]);
    });
  });

  describe("getParallelizable", () => {
    it("should identify independent tasks that can run in parallel", () => {
      const tasks = makeTasks();
      const parallel = analyzer.getParallelizable(tasks);

      // task-1 completed, task-2 depends on task-1 (completed) → ready
      // task-3 has no deps → ready
      // task-4 depends on task-2 and task-3 (both pending) → NOT ready
      expect(parallel.map((t) => t.id)).toContain("task-2");
      expect(parallel.map((t) => t.id)).toContain("task-3");
      expect(parallel.map((t) => t.id)).not.toContain("task-4");
    });

    it("should return empty array when all tasks are completed", () => {
      const tasks: PlanTask[] = [{ id: "task-1", title: "Done", steps: [], status: "completed" }];
      const parallel = analyzer.getParallelizable(tasks);
      expect(parallel).toHaveLength(0);
    });

    it("should detect circular dependencies and exclude those tasks", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "A",
          steps: [
            { id: "s1", description: "do A (depends: task-2)", checked: false, lineNumber: 1 },
          ],
          status: "pending",
        },
        {
          id: "task-2",
          title: "B",
          steps: [
            { id: "s2", description: "do B (depends: task-1)", checked: false, lineNumber: 2 },
          ],
          status: "pending",
        },
      ];
      const parallel = analyzer.getParallelizable(tasks);
      expect(parallel).toHaveLength(0);
    });
  });

  describe("buildExecutionOrder", () => {
    it("should return topological execution order", () => {
      const tasks = makeTasks();
      const order = analyzer.buildExecutionOrder(tasks);

      const indexOf = (id: string): number => order.findIndex((t) => t.id === id);
      expect(indexOf("task-1")).toBeLessThan(indexOf("task-2"));
      expect(indexOf("task-2")).toBeLessThan(indexOf("task-4"));
      expect(indexOf("task-3")).toBeLessThan(indexOf("task-4"));
    });

    it("should throw an Error if circular dependencies are detected", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "A",
          steps: [
            { id: "s1", description: "do A (depends: task-2)", checked: false, lineNumber: 1 },
          ],
          status: "pending",
        },
        {
          id: "task-2",
          title: "B",
          steps: [
            { id: "s2", description: "do B (depends: task-1)", checked: false, lineNumber: 2 },
          ],
          status: "pending",
        },
      ];
      expect(() => analyzer.buildExecutionOrder(tasks)).toThrow("Circular dependency detected");
    });

    it("should warn if a dependency is missing from the task map", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "A",
          steps: [
            { id: "s1", description: "do A (depends: task-999)", checked: false, lineNumber: 1 },
          ],
          status: "pending",
        },
      ];
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      analyzer.buildExecutionOrder(tasks);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Task 'task-1' depends on unknown task 'task-999'"),
      );
      warnSpy.mockRestore();
    });

    it("should warn in getParallelizable if a dependency is missing", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "A",
          steps: [
            { id: "s1", description: "do A (depends: task-999)", checked: false, lineNumber: 1 },
          ],
          status: "pending",
        },
      ];
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      analyzer.getParallelizable(tasks);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Task 'task-1' depends on unknown task 'task-999'"),
      );
      warnSpy.mockRestore();
    });
  });
});
