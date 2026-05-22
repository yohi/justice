import type { AgentId, TaskCategory } from "./types";
import { ReviewRejectionDetector } from "./review-rejection-detector";

export interface PlanCompletionInput {
  readonly prompt: string;
  readonly category: TaskCategory;
  readonly skillName?: string;
  readonly completed: boolean;
  readonly rawOutput?: string;
}

export type CompletionTrigger =
  | "writing_category"
  | "systematic_debugging_skill"
  | "code_review_rejection";

export interface CompletionResult {
  readonly persona: AgentId;
  readonly trigger: CompletionTrigger;
  readonly guidance: string;
}

export class PlanCompletionDetector {
  private readonly reviewRejectionDetector = new ReviewRejectionDetector();

  detectCompletion(input: PlanCompletionInput): CompletionResult | null {
    if (!input.completed) {
      return null;
    }

    if (input.skillName === "systematic-debugging") {
      return {
        persona: "sisyphus",
        trigger: "systematic_debugging_skill",
        guidance:
          "Sisyphus insight: isolate the failure, reproduce it with the smallest possible case, and verify the fix with a focused test.",
      };
    }

    if (input.skillName === "code-review" && input.rawOutput) {
      const rejection = this.reviewRejectionDetector.detect(input.rawOutput);
      if (rejection.matched) {
        return {
          persona: "prometheus",
          trigger: "code_review_rejection",
          guidance:
            `Prometheus pivot: the review rejected the current approach. Rework the plan around the rejection signals and address these blockers first:\n${rejection.summary}`,
        };
      }
    }

    if (input.category === "writing") {
      return {
        persona: "atlas",
        trigger: "writing_category",
        guidance:
          "Atlas guidance: capture the completed work as documentation, a changelog entry, or a concise handoff note.",
      };
    }

    return null;
  }
}
