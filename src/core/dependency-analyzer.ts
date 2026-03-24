import type { PlanTask } from "./types";

const DEPENDS_REGEX = /\(depends:\s*(task-[\d]+(?:\s*,\s*task-[\d]+)*)\)/i;

export class DependencyAnalyzer {
  /**
   * Extract explicit dependency declarations from step descriptions.
   * Format: (depends: task-1) or (depends: task-1, task-3)
   */
  extractDependencies(tasks: PlanTask[]): Map<string, string[]> {
    const deps = new Map<string, string[]>();

    for (const task of tasks) {
      const taskDeps = new Set<string>();
      for (const step of task.steps) {
        const matches = step.description.matchAll(new RegExp(DEPENDS_REGEX.source, "gi"));
        for (const match of matches) {
          if (match[1]) {
            const ids = match[1].split(",").map((s) => s.trim());
            for (const id of ids) {
              taskDeps.add(id);
            }
          }
        }
      }
      deps.set(task.id, [...taskDeps]);
    }

    return deps;
  }

  /**
   * Identify tasks that can run in parallel:
   * - Not yet completed
   * - All dependencies are completed
   * - Not part of a circular dependency
   */
  getParallelizable(tasks: PlanTask[]): PlanTask[] {
    const deps = this.extractDependencies(tasks);
    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // Detect circular dependencies
    const circularIds = this.detectCircular(deps, taskMap);

    return tasks.filter((task) => {
      if (task.status === "completed") return false;
      if (circularIds.has(task.id)) return false;

      const taskDeps = deps.get(task.id) ?? [];
      return taskDeps.every((depId) => completedIds.has(depId));
    });
  }

  /**
   * Returns tasks in topological execution order.
   * Completed tasks come first, then by dependency depth.
   * Throws an Error if circular dependencies are detected.
   */
  buildExecutionOrder(tasks: PlanTask[]): PlanTask[] {
    const deps = this.extractDependencies(tasks);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const circularIds = this.detectCircular(deps, taskMap);

    if (circularIds.size > 0) {
      throw new Error(
        `Circular dependency detected involving tasks: ${[...circularIds].join(", ")}`,
      );
    }

    const visited = new Set<string>();
    const result: PlanTask[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const taskDeps = deps.get(id) ?? [];
      for (const depId of taskDeps) {
        if (taskMap.has(depId)) {
          visit(depId);
        }
      }

      const task = taskMap.get(id);
      if (task) result.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  private detectCircular(
    deps: Map<string, string[]>,
    taskMap: Map<string, PlanTask>,
  ): Set<string> {
    const circularIds = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (id: string): boolean => {
      if (visiting.has(id)) return true; // cycle detected
      if (visited.has(id)) return false;

      visiting.add(id);
      const taskDeps = deps.get(id) ?? [];
      for (const depId of taskDeps) {
        if (taskMap.has(depId) && dfs(depId)) {
          circularIds.add(id);
          circularIds.add(depId);
          visiting.delete(id);
          return true;
        }
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };

    for (const id of deps.keys()) {
      dfs(id);
    }

    return circularIds;
  }
}
