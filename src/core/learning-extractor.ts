import type { AgentId, TaskFeedback, ErrorClass, WisdomEntryInput } from "./types";

type WisdomEntryDraft = WisdomEntryInput;

export interface LearningExtractionContext {
  readonly persona?: AgentId;
}

export class LearningExtractor {
  /**
   * Analyzes a TaskFeedback result and extracts actionable wisdom entries.
   * Returns an empty array for non-actionable cases.
   */
  extract(feedback: TaskFeedback, rawOutput?: string, context?: LearningExtractionContext): WisdomEntryDraft[] {
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

    return this.applyPersona(results, context?.persona);
  }

  private assertUnreachable(x: never): never {
    throw new Error(`Unexpected status encountered: ${JSON.stringify(x)}`);
  }

  private extractFromSuccess(
    feedback: TaskFeedback,
  ): WisdomEntryDraft[] {
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

  private extractFromFailure(
    feedback: TaskFeedback,
    rawOutput?: string,
  ): WisdomEntryDraft[] {
    const results: WisdomEntryDraft[] = [];
    const errorClass: ErrorClass = feedback.errorClassification ?? "unknown";
    const rootCauseEntry = rawOutput ? this.extractRootCause(feedback.taskId, rawOutput) : null;

    const sanitizedOutput = rawOutput ? this.sanitizeRawOutput(rawOutput) : undefined;

    if (rootCauseEntry) {
      results.push(rootCauseEntry);
    }

    if (errorClass === "unknown") {
      return results;
    }

    if (errorClass === "timeout") {
      results.push({
        taskId: feedback.taskId,
        category: "environment_quirk",
        errorClass,
        content: sanitizedOutput
          ? `Task timed out — potentially too complex or resource-intensive:\n${sanitizedOutput}`
          : `Task ${feedback.taskId} timed out during execution.`,
      });
    }

    if (errorClass === "loop_detected") {
      results.push({
        taskId: feedback.taskId,
        category: "failure_gotcha",
        errorClass,
        content: sanitizedOutput
          ? `Loop detected during execution — implementation hit a repetitive pattern:\n${sanitizedOutput}`
          : `Loop detected in ${feedback.taskId}.`,
      });
    }

    if (errorClass === "test_failure") {
      const details = feedback.testResults?.failureDetails ?? [];
      const detail = sanitizedOutput ?? (details.length > 0 ? details.join("\n") : undefined);

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
      const detail = sanitizedOutput ?? "";
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

  /**
   * Masks secrets and truncates long raw output to keep wisdom store lean and secure.
   */
  private sanitizeRawOutput(raw: string, maxLength = 500): string {
    // 1. Mask potential secrets (e.g., API keys, auth tokens, passwords)
    let sanitized = raw
      .replace(
        /(?:api[_-]?key|secret|password|token|auth|access[_-]?token)["']?\s*[:=]\s*["']?([A-Za-z0-9+/=._-]{8,})["']?/gi,
        (match, group) => {
          return match.replace(group, "****[MASKED]****");
        },
      )
      // eslint-disable-next-line security/detect-unsafe-regex
      .replace(/((?:https?:\/\/|git@)[^@:]+)(?::[^@]+)?@/gi, "$1:****[MASKED]****@");

    // 2. Truncate if exceeding maxLength
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + " ... (truncated)";
    }

    return sanitized;
  }

  private extractFromTimeout(
    feedback: TaskFeedback,
  ): WisdomEntryDraft[] {
    return [
      {
        taskId: feedback.taskId,
        category: "environment_quirk",
        errorClass: "timeout",
        content:
          `Task ${feedback.taskId} timed out. May be too complex for single delegation. Consider splitting into smaller subtasks.`,
      },
    ];
  }

  private extractRootCause(taskId: string, rawOutput: string): WisdomEntryDraft | null {
    const match = rawOutput.match(/Root cause:\s*(.+)/i);
    if (!match || match[1] === undefined) {
      return null;
    }

    return {
      taskId,
      category: "design_decision",
      content: `Root cause identified:\n${this.sanitizeRawOutput(match[1].trim())}`,
    };
  }

  private applyPersona(entries: WisdomEntryDraft[], persona?: AgentId): WisdomEntryDraft[] {
    if (!persona) {
      return entries;
    }

    return entries.map((entry) => ({
      ...entry,
      persona,
    }));
  }
}
