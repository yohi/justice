import type { ErrorClass } from "./types";
import { DEFAULT_RETRY_POLICY } from "./types";

interface ClassificationRule {
  pattern: RegExp;
  errorClass: ErrorClass;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  { pattern: /SyntaxError/i, errorClass: "syntax_error" },
  { pattern: /parse error/i, errorClass: "syntax_error" },
  { pattern: /unexpected token/i, errorClass: "syntax_error" },
  { pattern: /TypeError/i, errorClass: "type_error" },
  { pattern: /error TS\d+/i, errorClass: "type_error" },
  { pattern: /type '.*?' is not assignable/i, errorClass: "type_error" },
  { pattern: /does not exist on type/i, errorClass: "type_error" },
  { pattern: /FAIL\s+tests?\//i, errorClass: "test_failure" },
  { pattern: /test failed/i, errorClass: "test_failure" },
  { pattern: /assertion error/i, errorClass: "test_failure" },
  { pattern: /Expected:.*?Received:/s, errorClass: "test_failure" },
  { pattern: /timed?\s*out/i, errorClass: "timeout" },
  { pattern: /timeout/i, errorClass: "timeout" },
  { pattern: /loop detected/i, errorClass: "loop_detected" },
  { pattern: /infinite loop/i, errorClass: "loop_detected" },
  { pattern: /same edit applied/i, errorClass: "loop_detected" },
  { pattern: /fundamentally incompatible/i, errorClass: "design_error" },
  { pattern: /cannot implement.*?interface/i, errorClass: "design_error" },
  { pattern: /architectural.*?mismatch/i, errorClass: "design_error" },
];

export class ErrorClassifier {
  private readonly maxRetries: number;
  private readonly retryableErrors: Set<ErrorClass>;

  constructor(
    maxRetries = DEFAULT_RETRY_POLICY.maxRetries,
    retryableErrors = DEFAULT_RETRY_POLICY.retryableErrors,
  ) {
    this.maxRetries = maxRetries;
    this.retryableErrors = new Set(retryableErrors);
  }

  /**
   * Classify an error message into an ErrorClass.
   */
  classify(errorOutput: string): ErrorClass {
    for (const rule of CLASSIFICATION_RULES) {
      if (rule.pattern.test(errorOutput)) {
        return rule.errorClass;
      }
    }
    return "unknown";
  }

  /**
   * Determine if a task should be retried based on error class and current retry count.
   */
  shouldRetry(errorClass: ErrorClass, currentRetryCount: number): boolean {
    if (!this.retryableErrors.has(errorClass)) return false;
    return currentRetryCount < this.maxRetries;
  }

  /**
   * Get the escalation message for a given error class.
   */
  getEscalationMessage(errorClass: ErrorClass): string {
    switch (errorClass) {
      case "test_failure":
        return (
          "Tests are failing. Please use the systematic-debugging skill to " +
          "analyze the test output and identify the root cause before attempting fixes."
        );
      case "design_error":
        return (
          "A fundamental design issue was detected. Please use the brainstorming skill " +
          "to revisit the design and propose an alternative approach."
        );
      case "timeout":
        return (
          "The task timed out. It may be too complex for a single delegation. " +
          "Please split the task into smaller, more focused steps and update plan.md."
        );
      case "loop_detected":
        return (
          "A loop was detected — the agent is repeating the same actions. " +
          "Please split the task into smaller steps or clarify the requirements in plan.md."
        );
      case "syntax_error":
      case "type_error":
        return (
          "Auto-fix retries exhausted. Please review the error output and " +
          "consider whether the approach needs to be revised."
        );
      case "unknown":
      default:
        return (
          "An unexpected error occurred. Please review the error output " +
          "and determine the appropriate next step."
        );
    }
  }
}
