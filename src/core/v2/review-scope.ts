import type { ProjectedState } from "./state-projection";

export function collectReviewScopes(state: ProjectedState, taskId: string): readonly string[] {
  return state.tasks.get(taskId)?.observedReviewScopes ?? [];
}

export function deriveReviewScope(ctx: {
  readonly taskId?: string;
  readonly sessionId: string;
  readonly callId?: string;
  readonly toolName?: string;
}): string {
  if (ctx.taskId) return ctx.taskId;
  return `${ctx.sessionId}:${ctx.callId ?? ctx.toolName ?? "unknown"}`;
}
