import type { ObservationAgentId } from "../types";
import type { ScopeReviewSummary } from "./state-projection";

export type GateContext = {
  readonly trigger: "task_complete" | "tool_observed";
  readonly taskId?: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly reviewScope: readonly string[];
  readonly reviewSummary?: {
    readonly byScope: ReadonlyMap<string, ScopeReviewSummary>;
  };
};
