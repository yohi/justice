import type { ObservationAgentId, TaskExecutionRef } from "../types";
type FinalizationAttemptId = string;
import type { ScopeReviewSummary } from "./state-projection";

export type GateContext =
  | {
      readonly scope: "task";
      readonly trigger: "task_complete" | "tool_observed";
      readonly taskExecutionRef: TaskExecutionRef;
      /** F-003: proven Task Review round of the current correlation. Never guessed. */
      readonly reviewRound: number;
      readonly agentId: ObservationAgentId;
      readonly sessionId: string;
      readonly writerId: string;
      readonly reviewScope: readonly string[];
      readonly reviewSummary?: { readonly byScope: ReadonlyMap<string, ScopeReviewSummary> };
    }
  | {
      readonly scope: "plan";
      readonly trigger: "final_review_complete";
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: number;
      readonly agentId: ObservationAgentId;
      readonly sessionId: string;
      readonly writerId: string;
      readonly reviewScope: readonly string[];
      readonly reviewSummary?: { readonly byScope: ReadonlyMap<string, ScopeReviewSummary> };
    };

/**
 * Non-persistable dry-run context (internal `justice_gate` diagnostic): the
 * review round is not proven there, so its output can never become a decision.
 */
export type GateDryRunContext = Omit<Extract<GateContext, { readonly scope: "task" }>, "reviewRound">;

export type GatePendingAttemptContext =
  | {
      readonly scope: "task";
      readonly trigger: "task_complete" | "tool_observed";
      readonly parentSessionId: string;
      readonly taskExecutionRef: TaskExecutionRef;
      readonly agentId: ObservationAgentId;
      readonly sessionId: string;
      readonly writerId: string;
    }
  | {
      readonly scope: "plan";
      readonly trigger: "final_review_complete";
      readonly parentSessionId: string;
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: number;
      readonly agentId: ObservationAgentId;
      readonly sessionId: string;
      readonly writerId: string;
    };
