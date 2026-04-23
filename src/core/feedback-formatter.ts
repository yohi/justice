import type { TaskFeedback, TaskFeedbackStatus, TestSummary } from "./types";

// Simpler non-nested regex to avoid ReDoS warnings
const TEST_RESULT_REGEX = /Tests?:?\s+(\d+)\s+passed/i;
const FAILED_COUNT_REGEX = /(\d+)\s+failed/i;
const SKIPPED_COUNT_REGEX = /(\d+)\s+skipped/i;

// Vitest-style: Tests  12 passed (12)
const VITEST_RESULT_REGEX = /Tests\s+(\d+)\s+passed\s+\(\d+\)/i;

const FAILURE_LINE_REGEX = /^FAIL\s+.+$/gm;

const TIMEOUT_KEYWORDS = [/timed?\s*out/i, /timeout/i];

const COMPACTION_RISK_KEYWORDS = [
  /context window.*?\d+%\s*full/i,
  /compaction may occur/i,
  /approaching.*?context.*?limit/i,
];

export class FeedbackFormatter {
  /**
   * Format raw task() output into structured TaskFeedback.
   */
  format(taskId: string, rawOutput: string, isError: boolean): TaskFeedback {
    const testResults = this.parseTestResults(rawOutput) ?? undefined;
    const status = this.determineStatus(rawOutput, isError, testResults);

    return {
      taskId,
      status,
      testResults,
      retryCount: 0,
    };
  }

  /**
   * Parse test results from raw output.
   * Supports multiple formats (generic, vitest-style).
   */
  parseTestResults(rawOutput: string): TestSummary | null {
    // Try generic format first
    const passedMatch = rawOutput.match(TEST_RESULT_REGEX);
    if (passedMatch && passedMatch[1] !== undefined) {
      const failedMatch = rawOutput.match(FAILED_COUNT_REGEX);
      const skippedMatch = rawOutput.match(SKIPPED_COUNT_REGEX);

      return {
        passed: parseInt(passedMatch[1], 10),
        failed: failedMatch && failedMatch[1] !== undefined ? parseInt(failedMatch[1], 10) : 0,
        skipped: skippedMatch && skippedMatch[1] !== undefined ? parseInt(skippedMatch[1], 10) : 0,
        failureDetails: this.extractFailureDetails(rawOutput),
      };
    }

    // Try vitest format
    const vitestMatch = rawOutput.match(VITEST_RESULT_REGEX);
    if (vitestMatch && vitestMatch[1] !== undefined) {
      return {
        passed: parseInt(vitestMatch[1], 10),
        failed: 0,
        skipped: 0,
        failureDetails: this.extractFailureDetails(rawOutput),
      };
    }

    // Check if there are failure lines even without a summary
    const failureDetails = this.extractFailureDetails(rawOutput);
    if (failureDetails.length > 0) {
      return {
        passed: 0,
        failed: failureDetails.length,
        skipped: 0,
        failureDetails,
      };
    }

    return null;
  }

  private determineStatus(
    rawOutput: string,
    isError: boolean,
    testResults: TestSummary | undefined,
  ): TaskFeedbackStatus {
    // Check timeout first
    if (TIMEOUT_KEYWORDS.some((kw) => kw.test(rawOutput))) {
      return "timeout";
    }

    // Check compaction risk
    if (COMPACTION_RISK_KEYWORDS.some((kw) => kw.test(rawOutput))) {
      return "compaction_risk";
    }

    // Check failure
    if (isError || (testResults && testResults.failed > 0)) {
      return "failure";
    }

    return "success";
  }

  private extractFailureDetails(rawOutput: string): string[] {
    const details: string[] = [];
    const matches = rawOutput.matchAll(FAILURE_LINE_REGEX);
    for (const match of matches) {
      details.push(match[0].trim());
    }
    return details;
  }
}
