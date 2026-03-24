import type { PlanTask, PlanTaskStatus } from "./types";

export interface TaskStatus {
  readonly taskId: string;
  readonly title: string;
  readonly status: PlanTaskStatus;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface ProgressReport {
  readonly overallProgress: number; // 0-100
  readonly taskStatuses: TaskStatus[];
  readonly completedTasks: number;
  readonly totalTasks: number;
}

export class ProgressReporter {
  /**
   * Generate a structured progress report from parsed plan tasks.
   */
  generateReport(tasks: PlanTask[]): ProgressReport {
    if (tasks.length === 0) {
      return {
        overallProgress: 100,
        taskStatuses: [],
        completedTasks: 0,
        totalTasks: 0,
      };
    }

    const taskStatuses: TaskStatus[] = tasks.map((task) => {
      const completedSteps = task.steps.filter((s) => s.checked).length;
      return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        completedSteps,
        totalSteps: task.steps.length,
      };
    });

    const totalSteps = taskStatuses.reduce((sum, t) => sum + t.totalSteps, 0);
    const completedSteps = taskStatuses.reduce((sum, t) => sum + t.completedSteps, 0);
    const completedTasks = tasks.filter((t) => t.status === "completed").length;

    return {
      overallProgress: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 100,
      taskStatuses,
      completedTasks,
      totalTasks: tasks.length,
    };
  }

  /**
   * Format a ProgressReport as readable Markdown.
   */
  formatAsMarkdown(report: ProgressReport): string {
    const lines: string[] = [];

    lines.push("## 📊 Progress Report");
    lines.push("");
    lines.push(
      `**Overall:** ${report.overallProgress}% (${report.completedTasks}/${report.totalTasks} tasks)`,
    );
    lines.push("");

    for (const task of report.taskStatuses) {
      const icon = this.statusIcon(task.status);
      const progress =
        task.totalSteps > 0 ? ` (${task.completedSteps}/${task.totalSteps} steps)` : "";
      lines.push(`- ${icon} ${task.title}${progress}`);
    }

    return lines.join("\n");
  }

  /**
   * Format a compact single-line summary.
   */
  formatAsCompact(report: ProgressReport): string {
    return `[JUSTICE Progress: ${report.overallProgress}% | ${report.completedTasks}/${report.totalTasks} tasks completed]`;
  }

  private statusIcon(status: PlanTaskStatus): string {
    switch (status) {
      case "completed":
        return "✅";
      case "in_progress":
        return "🔄";
      case "failed":
        return "❌";
      case "pending":
        return "⬜";
    }
  }
}
