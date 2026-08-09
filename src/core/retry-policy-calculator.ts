import type { TaskCategory } from "./types";

export interface RetryThresholdContext {
  readonly category: TaskCategory;
  readonly stepCount: number;
}

export interface RetryThresholdResult {
  readonly base: number;
  readonly categoryModifier: number;
  readonly volumeModifier: number;
  readonly maxRetries: number;
}

const CATEGORY_MODIFIERS: Readonly<Record<TaskCategory, number>> = {
  quick: -1,
  ultrabrain: 2,
  deep: 0,
  "visual-engineering": 0,
  writing: 0,
  "unspecified-low": 0,
  "unspecified-high": 0,
};

export class RetryPolicyCalculator {
  static readonly BASE = 3;
  static readonly MIN_RETRIES = 1;
  static readonly VOLUME_THRESHOLD = 5;
  static readonly VOLUME_MODIFIER = 1;

  compute(context: RetryThresholdContext): RetryThresholdResult {
    const categoryModifier = CATEGORY_MODIFIERS[context.category] ?? 0;
    const volumeModifier =
      context.stepCount >= RetryPolicyCalculator.VOLUME_THRESHOLD
        ? RetryPolicyCalculator.VOLUME_MODIFIER
        : 0;
    const computed = RetryPolicyCalculator.BASE + categoryModifier + volumeModifier;
    return {
      base: RetryPolicyCalculator.BASE,
      categoryModifier,
      volumeModifier,
      maxRetries: Math.max(RetryPolicyCalculator.MIN_RETRIES, computed),
    };
  }
}
