import type { TaskFeedback, ErrorClass, WisdomEntry } from "./types";

type WisdomEntryDraft = Omit<WisdomEntry, "id" | "timestamp">;

export class LearningExtractor {
  /**
   * Analyzes a TaskFeedback result and extracts actionable wisdom entries.
   * Returns an empty array for non-actionable cases.
   */
  extract(feedback: TaskFeedback, rawOutput?: string): WisdomEntryDraft[] {
    const results: WisdomEntryDraft[] = [];

    switch (feedback.status) {
      case "success":
        results.push(...this.extractFromSuccess(feedback));
        break;
      case "failure":
        results.push(...this.extractFromFailure(feedback, rawOutput));
        break;
      case "timeout":
        results.push(...this.extractFromTimeout(feedback));
        break;
      case "compaction_risk":
        // No specific learning from compaction risk
        break;
      default:
        this.assertUnreachable(feedback.status);
    }

    return results;
  }

  private assertUnreachable(x: never): never {
    throw new Error(`Unexpected status encountered: ${JSON.stringify(x)}`);
  }

  private extractFromSuccess(feedback: TaskFeedback): WisdomEntryDraft[] {
    const results: WisdomEntryDraft[] = [];
    const hasTestResults = feedback.testResults && feedback.testResults.passed > 0;

    // Only extract pattern when tests actually ran
    if (hasTestResults) {
      results.push({
        taskId: feedback.taskId,
        category: "success_pattern",
        content: `Task completed with ${feedback.testResults!.passed} passing tests.`,
      });
    }

    // High-retry success: document the gotcha
    if (feedback.retryCount >= 2) {
      results.push({
        taskId: feedback.taskId,
        category: "failure_gotcha",
        content: `Task required ${feedback.retryCount} retries before succeeding. Verify implementation approach early.`,
      });
    }

    return results;
  }

  private extractFromFailure(feedback: TaskFeedback, rawOutput?: string): WisdomEntryDraft[] {
    const results: WisdomEntryDraft[] = [];
    const errorClass: ErrorClass = feedback.errorClassification ?? "unknown";

    if (errorClass === "unknown") {
      return results;
    }

    if (errorClass === "timeout") {
      results.push({
        taskId: feedback.taskId,
        category: "environment_quirk",
        errorClass,
        content: rawOutput
          ? `Task timed out — potentially too complex or resource-intensive:\n${rawOutput}`
          : `Task ${feedback.taskId} timed out during execution.`,
      });
    }

    if (errorClass === "loop_detected") {
      results.push({
        taskId: feedback.taskId,
        category: "failure_gotcha",
        errorClass,
        content: rawOutput
          ? `Loop detected during execution — implementation hit a repetitive pattern:\n${rawOutput}`
          : `Loop detected in ${feedback.taskId}.`,
      });
    }

    if (errorClass === "test_failure") {
      const details = feedback.testResults?.failureDetails ?? [];
      const detail = rawOutput ?? (details.length > 0 ? details.join("\n") : undefined);

      results.push({
        taskId: feedback.taskId,
        category: "failure_gotcha",
        errorClass,
        content: detail
          ? `Test failures encountered:\n${detail}`
          : `Test failures encountered in ${feedback.taskId}.`,
      });
    }

    if (errorClass === "design_error") {
      const detail = rawOutput ?? "";
      results.push({
        taskId: feedback.taskId,
        category: "design_decision",
        errorClass,
        content: detail
          ? `Design issue detected — requires architectural revision:\n${detail}`
          : `Design issue detected in ${feedback.taskId}.`,
      });
    }

    if (errorClass === "syntax_error" || errorClass === "type_error") {
      // These are retryable; only log if it's a final failure (escalation)
      results.push({
        taskId: feedback.taskId,
        category: "failure_gotcha",
        errorClass,
        content: `Final ${errorClass} after retry exhaustion in ${feedback.taskId}.`,
      });
    }

    return results;
  }

  private extractFromTimeout(feedback: TaskFeedback): WisdomEntryDraft[] {
    return [
      {
        taskId: feedback.taskId,
        category: "environment_quirk",
        errorClass: "timeout",
        content: `Task ${feedback.taskId} timed out. May be too complex for single delegation. Consider splitting into smaller subtasks.`,
      },
    ];
  }
}
