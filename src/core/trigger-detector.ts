export interface PlanReference {
  readonly planPath: string;
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
   */
  detectPlanReference(message: string): PlanReference | null {
    const match = message.match(PLAN_PATH_REGEX);
    if (!match || match[1] === undefined) return null;
    return { planPath: match[1] };
  }

  /**
   * Detect delegation intent keywords in the message.
   */
  detectDelegationIntent(message: string): boolean {
    return DELEGATION_KEYWORDS.some((kw) => kw.test(message));
  }

  /**
   * Combined check: should this message trigger plan-bridge?
   * Triggers if there is a plan reference AND delegation intent.
   */
  shouldTrigger(message: string): boolean {
    const hasRef = this.detectPlanReference(message) !== null;
    const hasIntent = this.detectDelegationIntent(message);
    return hasRef && hasIntent;
  }
}
