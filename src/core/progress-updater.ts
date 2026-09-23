import { PlanParser } from "./plan-parser";
import type { PlanTask } from "./types";
import type { TaskAcceptanceDecision } from "./v2/decision-model";

/**
 * Result of a plan progress update attempt. `content` is the (possibly
 * unchanged) plan markdown and `updated` reports whether any checkbox moved.
 */
export type ProgressUpdateResult = {
  readonly content: string;
  readonly updated: boolean;
};

/**
 * Advance a plan task's checkboxes only after a durable accepted
 * `TaskAcceptanceDecision` (Task 3.7). Worker success never implies acceptance:
 * a non-accepted verdict, a decision for a different task, or a zero-step task
 * leaves the content untouched. Already checked steps are preserved and no
 * other task is modified.
 */
export function updatePlanProgress(
  content: string,
  task: PlanTask,
  decision: TaskAcceptanceDecision,
): ProgressUpdateResult {
  if (decision.verdict !== "accepted" || decision.taskExecutionRef.taskId !== task.id)
    return { content, updated: false };
  if (task.steps.length === 0) return { content, updated: false };
  const parser = new PlanParser();
  const updated = task.steps.reduce(
    (current, step) =>
      step.checked ? current : parser.updateCheckbox(current, step.lineNumber, true),
    content,
  );
  return { content: updated, updated: updated !== content };
}
