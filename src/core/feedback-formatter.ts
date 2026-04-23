/* eslint-disable security/detect-unsafe-regex -- Formatter uses bounded output-summary regexes. */
import type { TaskFeedback, TaskFeedbackStatus, TestSummary } from "./types";

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
    // Try generic format: "Tests: 5 passed, 2 failed" or "Tests: 2 failed"
    if (/Tests?:/i.test(rawOutput)) {
      const passed = rawOutput.match(/(\d+)\s+passed/i);
      const failed = rawOutput.match(/(\d+)\s+failed/i);
      const skipped = rawOutput.match(/(\d+)\s+skipped/i);

      if (passed || failed || skipped) {
        const [, passedCount = "0"] = passed ?? [];
        const [, failedCount = "0"] = failed ?? [];
        const [, skippedCount = "0"] = skipped ?? [];

        return {
          passed: parseInt(passedCount, 10),
          failed: parseInt(failedCount, 10),
          skipped: parseInt(skippedCount, 10),
          failureDetails: this.extractFailureDetails(rawOutput),
        };
      }
    }

    // Try vitest format: "Tests  12 passed (12)"
    const vitestMatch = rawOutput.match(VITEST_RESULT_REGEX);
    if (vitestMatch) {
      const [, passedStr = "0"] = vitestMatch;
      return {
        passed: parseInt(passedStr, 10),
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
/* eslint-enable security/detect-unsafe-regex */
