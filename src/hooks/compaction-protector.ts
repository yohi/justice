import type { ProtectedContext } from "../core/types";
import { PlanParser } from "../core/plan-parser";
import { WisdomStore } from "../core/wisdom-store";

interface SnapshotInput {
  planContent: string;
  currentTaskId: string;
  currentStepId: string;
  learnings: string;
}

export class CompactionProtector {
  private activePlanPath: string | null = null;
  private readonly parser: PlanParser;
  private readonly wisdomStore: WisdomStore | null;

  constructor(wisdomStore?: WisdomStore) {
    this.parser = new PlanParser();
    this.wisdomStore = wisdomStore ?? null;
  }

  /**
   * Set the currently active plan file path.
   */
  setActivePlan(planPath: string): void {
    const normalized = planPath.trim();
    this.activePlanPath = normalized === "" ? null : normalized;
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
    // Merge WisdomStore learnings with any explicit input learnings
    const wisdomLearnings = this.wisdomStore
      ? this.wisdomStore.formatForInjection(
          this.wisdomStore.getRelevant({ maxEntries: 10 }),
        )
      : "";
    
    // Combine and deduplicate learnings blocks
    const learningBlocks = [input.learnings, wisdomLearnings]
      .filter((l) => l.trim() !== "")
      .flatMap((l) => l.split("\n\n"))
      .map((block) => block.trim())
      .filter((block) => block !== "");

    const uniqueBlocks: string[] = [];
    for (const block of learningBlocks) {
      if (!uniqueBlocks.includes(block)) {
        uniqueBlocks.push(block);
      }
    }

    const combinedLearnings = uniqueBlocks.join("\n\n");

    return {
      planSnapshot: input.planContent,
      currentTaskId: input.currentTaskId,
      currentStepId: input.currentStepId,
      accumulatedLearnings: combinedLearnings,
      timestamp: new Date().toISOString(),
      activePlanPath: this.activePlanPath,
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
      `**Active Plan**: ${snapshot.activePlanPath ?? "unknown"}`,
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

    // Find the longest sequence of backticks in the plan to determine a safe fence
    const backtickMatches = snapshot.planSnapshot.match(/`+/g) || [];
    let maxBackticks = 2; // minimum 3 backticks for fence, so we start with max 2 found
    for (const match of backtickMatches) {
      if (match.length > maxBackticks) {
        maxBackticks = match.length;
      }
    }
    const fence = "`".repeat(maxBackticks + 1);

    sections.push(`${fence}markdown`);
    sections.push(snapshot.planSnapshot);
    sections.push(fence);
    sections.push("---");

    return sections.join("\n");
  }
}
