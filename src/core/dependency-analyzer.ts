import type { PlanTask } from "./types";

// Simple non-nested regex to avoid ReDoS warnings
const DEPENDS_MARKER_REGEX = /\(depends:\s*([^)]+)\)/i;

/**
 * 依存関係の解決中に発生したエラー。
 */
export class DependencyResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyResolutionError";
  }
}

export class DependencyAnalyzer {
  /**
   * Extract explicit dependency declarations from step descriptions.
   * Format: (depends: task-1) or (depends: task-1, task-3)
   */
  extractDependencies(tasks: PlanTask[]): Map<string, string[]> {
    const deps = new Map<string, string[]>();
    // eslint-disable-next-line security/detect-non-literal-regexp
    const markerRegex = new RegExp(DEPENDS_MARKER_REGEX.source, "gi");

    for (const task of tasks) {
      const taskDeps = new Set<string>();
      for (const step of task.steps) {
        const matches = step.description.matchAll(markerRegex);
        for (const match of matches) {
          if (match[1]) {
            const rawIds = match[1].split(",");
            for (const rawId of rawIds) {
              const idMatch = rawId.trim().match(/task-[\d]+/i);
              if (idMatch) {
                taskDeps.add(idMatch[0].toLowerCase());
              }
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
    const unknownDepsReported = new Set<string>();

    // Detect circular dependencies
    const circularIds = this.detectCircular(deps, taskMap);

    return tasks.filter((task) => {
      if (task.status === "completed") return false;
      if (circularIds.has(task.id)) return false;

      const taskDeps = deps.get(task.id) ?? [];
      return taskDeps.every((depId) => {
        if (!taskMap.has(depId)) {
          if (!unknownDepsReported.has(depId)) {
            console.warn(`Warning: Task '${task.id}' depends on unknown task '${depId}'`);
            unknownDepsReported.add(depId);
          }
        }
        // Unknown dependencies will never be in completedIds, effectively blocking the task
        return completedIds.has(depId);
      });
    });
  }

  /**
   * Returns tasks in topological execution order.
   * Completed tasks come first, then by dependency depth.
   * Unknown dependencies will emit a warning and are ignored (processing continues).
   * Throws a DependencyResolutionError if circular dependencies are detected.
   */
  buildExecutionOrder(tasks: PlanTask[]): PlanTask[] {
    const deps = this.extractDependencies(tasks);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const circularIds = this.detectCircular(deps, taskMap);

    if (circularIds.size > 0) {
      throw new DependencyResolutionError(
        `Circular dependency detected involving tasks: ${[...circularIds].join(", ")}`,
      );
    }

    const visited = new Set<string>();
    const failedIds = new Set<string>();
    const result: PlanTask[] = [];
    const unknownDepsReported = new Set<string>();

    const visit = (id: string): boolean => {
      if (failedIds.has(id)) return false;
      if (visited.has(id)) return true;
      visited.add(id);

      let canExecute = true;
      const taskDeps = deps.get(id) ?? [];
      for (const depId of taskDeps) {
        if (taskMap.has(depId)) {
          if (!visit(depId)) {
            canExecute = false;
          }
        } else {
          if (!unknownDepsReported.has(depId)) {
            console.warn(`Warning: Task '${id}' depends on unknown task '${depId}'`);
            unknownDepsReported.add(depId);
          }
          canExecute = false;
        }
      }

      if (canExecute) {
        const task = taskMap.get(id);
        if (task) result.push(task);
        return true;
      } else {
        failedIds.add(id);
        return false;
      }
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  private detectCircular(deps: Map<string, string[]>, taskMap: Map<string, PlanTask>): Set<string> {
    const circularIds = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (id: string): string | null => {
      if (visiting.has(id)) {
        circularIds.add(id);
        return id; // cycle detected, returning root
      }
      if (visited.has(id)) return null;

      visiting.add(id);
      const taskDeps = deps.get(id) ?? [];
      for (const depId of taskDeps) {
        if (taskMap.has(depId)) {
          const cycleRoot = dfs(depId);
          if (cycleRoot !== null) {
            circularIds.add(id);
            if (id !== cycleRoot) {
              visiting.delete(id);
              return cycleRoot;
            }
          }
        }
      }
      visiting.delete(id);
      visited.add(id);
      return null;
    };

    for (const id of deps.keys()) {
      dfs(id);
    }

    return circularIds;
  }
}
