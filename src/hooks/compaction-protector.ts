import type { ProtectedContext } from "../core/types";
import { PlanParser } from "../core/plan-parser";

interface SnapshotInput {
  planContent: string;
  currentTaskId: string;
  currentStepId: string;
  learnings: string;
}

export class CompactionProtector {
  private activePlanPath: string | null = null;
  private readonly parser: PlanParser;

  constructor() {
    this.parser = new PlanParser();
  }

  /**
   * Set the currently active plan file path.
   */
  setActivePlan(planPath: string): void {
    this.activePlanPath = planPath;
  }

  /**
   * Clear the active plan.
   */
  clearActivePlan(): void {
    this.activePlanPath = null;
  }

  /**
   * Check if there is an active plan that needs protection.
   */
  shouldProtect(): boolean {
    return this.activePlanPath !== null;
  }

  /**
   * Get the active plan path.
   */
  getActivePlanPath(): string | null {
    return this.activePlanPath;
  }

  /**
   * Create a snapshot of the current plan state for compaction protection.
   */
  createSnapshot(input: SnapshotInput): ProtectedContext {
    return {
      planSnapshot: input.planContent,
      currentTaskId: input.currentTaskId,
      currentStepId: input.currentStepId,
      accumulatedLearnings: input.learnings,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format a snapshot for injection into the post-compaction context.
   */
  formatForInjection(snapshot: ProtectedContext): string {
    const tasks = this.parser.parse(snapshot.planSnapshot);
    const completedCount = tasks.filter((t) => t.status === "completed").length;
    const totalCount = tasks.length;

    const sections: string[] = [
      "---",
      "[JUSTICE: Protected Context Restored]",
      "",
      `**Active Plan**: ${this.activePlanPath ?? "unknown"}`,
      `**Current Task**: ${snapshot.currentTaskId}`,
      `**Current Step**: ${snapshot.currentStepId}`,
      `**Progress**: ${completedCount}/${totalCount} tasks completed`,
      `**Timestamp**: ${snapshot.timestamp}`,
    ];

    if (snapshot.accumulatedLearnings) {
      sections.push("");
      sections.push("**Key Learnings**:");
      sections.push(snapshot.accumulatedLearnings);
    }

    sections.push("");
    sections.push("**Plan Snapshot**:");
    sections.push("```markdown");
    sections.push(snapshot.planSnapshot);
    sections.push("```");
    sections.push("---");

    return sections.join("\n");
  }
}