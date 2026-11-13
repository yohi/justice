import type { ReviewCorrelation, TaskExecutionRef } from "./types";

/**
 * Pure, dependency-free review correlation identity helpers. Lives in a neutral
 * module so both `acceptance-decision` and `v2/state-projection` can share one
 * definition without a value-level import cycle.
 */
export function samePlanFingerprint(
  left: { readonly algorithm: string; readonly value: string },
  right: { readonly algorithm: string; readonly value: string },
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

export function sameTask(left: TaskExecutionRef, right: TaskExecutionRef): boolean {
  return (
    left.authorizationId === right.authorizationId &&
    left.taskId === right.taskId &&
    left.attemptId === right.attemptId
  );
}

export function sameReviewCorrelation(left: ReviewCorrelation, right: ReviewCorrelation): boolean {
  if (left.reviewKind !== right.reviewKind) return false;
  if (left.reviewKind === "task-review" && right.reviewKind === "task-review")
    return (
      left.reviewRound === right.reviewRound &&
      sameTask(left.taskExecutionRef, right.taskExecutionRef)
    );
  if (left.reviewKind === "final-review" && right.reviewKind === "final-review")
    return (
      left.authorizationId === right.authorizationId &&
      left.planPath === right.planPath &&
      left.finalizationAttemptId === right.finalizationAttemptId &&
      left.finalReviewRound === right.finalReviewRound &&
      samePlanFingerprint(left.planFingerprint, right.planFingerprint)
    );
  return false;
}
