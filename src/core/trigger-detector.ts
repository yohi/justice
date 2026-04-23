/* eslint-disable security/detect-unsafe-regex -- Trigger detection relies on fixed message-matching patterns. */
import * as path from "node:path";

export interface PlanReference {
  readonly planPath: string;
}

export interface TriggerAnalysis {
  readonly shouldTrigger: boolean;
  readonly planRef: PlanReference | null;
}

const PLAN_PATH_REGEX = /(?:^|\s|["'`])([\w./-]*plan[\w./-]*\.md)\b/i;

const DELEGATION_KEYWORDS: RegExp[] = [
  /\bdelegate\b/i,
  /\bnext\s+task\b/i,
  /\b(?:execute|run|start)\s+(?:the\s+)?(?:next\s+)?(?:incomplete\s+)?task/i,
  /次のタスク/,
  /タスクを(?:実行|委譲|開始)/,
];

export class TriggerDetector {
  /**
   * Detect a reference to a plan file (*.plan*.md or plan.md) in the message.
   * Normalizes the path and rejects absolute paths, path traversal (..), or backslashes.
   */
  detectPlanReference(message: string): PlanReference | null {
    const match = message.match(PLAN_PATH_REGEX);
    if (!match || match[1] === undefined) return null;

    const rawPath = match[1];

    // Reject absolute paths
    if (path.isAbsolute(rawPath)) return null;

    // Reject backslashes
    if (rawPath.includes("\\")) return null;

    // Reject path traversal segments (..) anywhere in the raw path
    if (rawPath.split("/").includes("..")) return null;

    // Normalize and check for path traversal (..) in normalized path
    const normalized = path.posix.normalize(rawPath);
    if (normalized.split("/").includes("..")) return null;

    // Additional check: reject if it still looks absolute after normalization (e.g. starts with /)
    if (normalized.startsWith("/")) return null;

    return { planPath: normalized };
  }

  /**
   * Detect delegation intent keywords in the message.
   */
  detectDelegationIntent(message: string): boolean {
    return DELEGATION_KEYWORDS.some((kw) => kw.test(message));
  }

  /**
   * Analyzes if the message should trigger delegation.
   * Returns a combined result of shouldTrigger and planRef.
   */
  analyzeTrigger(message: string): TriggerAnalysis {
    const planRef = this.detectPlanReference(message);
    const hasIntent = this.detectDelegationIntent(message);
    const shouldTrigger = planRef !== null && hasIntent;

    return {
      shouldTrigger,
      planRef: shouldTrigger ? planRef : null,
    };
  }

  /**
   * Combined check: should this message trigger plan-bridge?
   * Triggers if there is a plan reference AND delegation intent.
   * @deprecated Use analyzeTrigger() instead to avoid duplicate calls.
   */
  shouldTrigger(message: string): boolean {
    return this.analyzeTrigger(message).shouldTrigger;
  }
}
/* eslint-enable security/detect-unsafe-regex */
