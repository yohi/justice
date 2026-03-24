import type { DelegationContext, ErrorClass, ContextReduction } from "./types";
import { DEFAULT_RETRY_POLICY } from "./types";

export interface RetryDecision {
  readonly shouldRetry: boolean;
  readonly delayMs: number;
  readonly contextReduction: ContextReduction;
  readonly retryCount: number;
}

export class SmartRetryPolicy {
  constructor(
    private readonly baseDelayMs: number = 1000,
    private readonly maxDelayMs: number = 30000,
    private readonly maxRetries: number = DEFAULT_RETRY_POLICY.maxRetries,
    private readonly retryableErrors: readonly ErrorClass[] = DEFAULT_RETRY_POLICY.retryableErrors,
  ) {}

  /**
   * Evaluates an error and returns a comprehensive retry decision
   * including delay and context shrinking strategies.
   */
  evaluate(
    errorClass: ErrorClass,
    currentRetry: number,
    context?: DelegationContext,
  ): RetryDecision {
    const shouldRetry = this.retryableErrors.includes(errorClass) && currentRetry < this.maxRetries;

    if (!shouldRetry) {
      return {
        shouldRetry: false,
        delayMs: 0,
        contextReduction: { strategy: "none" },
        retryCount: currentRetry,
      };
    }

    // Pass currentRetry + 1 to sub-methods to maintain 1-indexed logic for delay/reduction
    return {
      shouldRetry: true,
      delayMs: this.calculateDelay(currentRetry + 1),
      contextReduction: this.determineReduction(currentRetry + 1, context),
      retryCount: currentRetry,
    };
  }

  /**
   * Calculates exponential backoff delay with jitter.
   * delay = min(baseDelay * 2^retryCount + jitter, maxDelay)
   */
  calculateDelay(retryCount: number): number {
    const exponential = this.baseDelayMs * Math.pow(2, retryCount);
    // Jitter: random between 0 and 50% of base delay
    const jitter = Math.floor(Math.random() * (this.baseDelayMs * 0.5));
    const delayMs = exponential + jitter;

    return Math.min(delayMs, this.maxDelayMs);
  }

  /**
   * Determines how to shrink the context based on retry consecutive failures.
   */
  determineReduction(retryCount: number, context?: DelegationContext): ContextReduction {
    if (!context || retryCount <= 1) {
      return { strategy: "none" };
    }

    // Attempt simplify_prompt for retryCount >= 3 first (more specific)
    if (retryCount >= 3 && context.rolePrompt && context.rolePrompt.includes("MUST NOT DO")) {
      return {
        strategy: "simplify_prompt",
        removedItems: ["MUST NOT DO constraints"],
      };
    }

    // Attempt trim_reference_files strategy for retryCount >= 2
    if (retryCount >= 2 && context.referenceFiles && context.referenceFiles.length > 1) {
      const mid = Math.ceil(context.referenceFiles.length / 2);
      const removed = context.referenceFiles.slice(mid);
      return {
        strategy: "trim_reference_files",
        removedItems: removed,
      };
    }

    // Final fall through: try retryCount >= 3 logic even if retryCount is 2 (as per "vice versa" instruction)
    // and try retryCount >= 2 logic if retryCount is >= 3 but referenceFiles were empty.
    // (The above order already handles the priority)

    return { strategy: "none" };
  }
}
