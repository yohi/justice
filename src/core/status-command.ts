import type { FileReader, PlanTask } from "./types";
import { PlanParser } from "./plan-parser";
import { DependencyAnalyzer, DependencyResolutionError } from "./dependency-analyzer";
import { ProgressReporter, type ProgressReport } from "./progress-reporter";
import { CategoryClassifier } from "./category-classifier";

export interface PlanStatus {
  readonly planPath: string;
  readonly tasks: PlanTask[];
  readonly progress: ProgressReport;
  readonly parallelizable: PlanTask[];
  readonly executionOrder: PlanTask[];
  readonly executionOrderError?: string;
  readonly categoryMap: Map<string, string>;
}

export class StatusCommand {
  private readonly fileReader: FileReader;
  private readonly parser: PlanParser;
  private readonly analyzer: DependencyAnalyzer;
  private readonly reporter: ProgressReporter;
  private readonly classifier: CategoryClassifier;

  constructor(fileReader: FileReader) {
    this.fileReader = fileReader;
    this.parser = new PlanParser();
    this.analyzer = new DependencyAnalyzer();
    this.reporter = new ProgressReporter();
    this.classifier = new CategoryClassifier();
  }

  /**
   * Get comprehensive status for a plan file.
   */
  async getStatus(planPath: string): Promise<PlanStatus> {
    const content = await this.fileReader.readFile(planPath);
    const tasks = this.parser.parse(content);

    const progress = this.reporter.generateReport(tasks);
    const parallelizable = this.analyzer.getParallelizable(tasks);

    let executionOrder: PlanTask[] = [];
    let executionOrderError: string | undefined;
    try {
      executionOrder = this.analyzer.buildExecutionOrder(tasks);
    } catch (err) {
      if (err instanceof DependencyResolutionError) {
        executionOrderError = err.message;
        console.warn(`Could not build execution order for ${planPath}: ${executionOrderError}`);
      } else {
        throw err;
      }
    }

    const categoryMap = new Map<string, string>();
    for (const task of tasks) {
      categoryMap.set(task.id, this.classifier.classify(task));
    }

    return {
      planPath,
      tasks,
      progress,
      parallelizable,
      executionOrder,
      executionOrderError,
      categoryMap,
    };
  }

  /**
   * Format PlanStatus as comprehensive Markdown report.
   */
  formatAsMarkdown(status: PlanStatus): string {
    const lines: string[] = [];

    // Header
    lines.push(`# 📋 Justice Plan Status: ${status.planPath}`);
    lines.push("");

    // Progress
    lines.push(this.reporter.formatAsMarkdown(status.progress));
    lines.push("");

    // Parallelizable Tasks
    lines.push("## ⚡ Parallelizable Tasks");
    lines.push("");
    if (status.parallelizable.length === 0) {
      lines.push("No tasks can be run in parallel at this time.");
    } else {
      for (const task of status.parallelizable) {
        const cat = status.categoryMap.get(task.id) ?? "deep";
        lines.push(`- **${task.id}**: ${task.title} (category: ${cat})`);
      }
    }
    lines.push("");

    // Execution Order
    lines.push("## 📐 Execution Order");
    lines.push("");
    if (status.executionOrderError) {
      lines.push(`**Error determining execution order:** ${status.executionOrderError}`);
    } else if (status.executionOrder.length === 0) {
      lines.push("No tasks found.");
    } else {
      for (let i = 0; i < status.executionOrder.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const task = status.executionOrder[i]!;
        const icon = task.status === "completed" ? "✅" : "⬜";
        lines.push(`${i + 1}. ${icon} ${task.title}`);
      }
    }

    return lines.join("\n");
  }
}
