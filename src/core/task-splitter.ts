import type { PlanTask, ErrorClass } from "./types";

export interface SplitSuggestion {
  readonly originalTaskId: string;
  readonly suggestedSubTasks: SubTaskSuggestion[];
  readonly rationale: string;
}

export interface SubTaskSuggestion {
  readonly title: string;
  readonly steps: string[];
  readonly estimatedComplexity: "quick" | "deep";
}

export class TaskSplitter {
  /**
   * Suggests how to split a failed task based on its structure and the error type.
   */
  suggestSplit(task: PlanTask, errorClass: ErrorClass): SplitSuggestion {
    const uncompletedSteps = task.steps.filter((s) => !s.checked).map((s) => s.description);
    
    // If there's only 1 step left, we can't split it by steps easily,
    // so we return it as a single sub-task to focus deeply on it.
    if (uncompletedSteps.length <= 1) {
      return {
        originalTaskId: task.id,
        rationale: "Task has only 1 remaining step. Recommend focused deep analysis.",
        suggestedSubTasks: [
          {
            title: `Fix/Investigate ${task.title}`,
            steps: uncompletedSteps,
            estimatedComplexity: "deep",
          },
        ],
      };
    }

    if (errorClass === "loop_detected") {
      // Loop detected: break down into individual steps
      return {
        originalTaskId: task.id,
        rationale: "Loop detected. Breaking task down into individual atomic steps.",
        suggestedSubTasks: uncompletedSteps.map((step) => ({
          title: `Step: ${step}`,
          steps: [step],
          estimatedComplexity: "quick",
        })),
      };
    }

    if (errorClass === "timeout" || uncompletedSteps.some(s => /test|spec/i.test(s))) {
      // Split into Implementation and Testing
      const testSteps = uncompletedSteps.filter(s => /test|spec/i.test(s));
      const implSteps = uncompletedSteps.filter(s => !/test|spec/i.test(s));
      
      if (testSteps.length > 0 && implSteps.length > 0) {
        return {
          originalTaskId: task.id,
          rationale: "Timeout or test failures. Splitting into Implementation and Testing phases.",
          suggestedSubTasks: [
            {
              title: `${task.title} (実装 / Implementation)`,
              steps: implSteps,
              estimatedComplexity: "deep",
            },
            {
              title: `${task.title} (テスト / Testing)`,
              steps: testSteps,
              estimatedComplexity: "quick",
            },
          ],
        };
      }
    }

    // Default: split into roughly two halves if 4+ steps
    if (uncompletedSteps.length >= 4) {
      const mid = Math.ceil(uncompletedSteps.length / 2);
      return {
        originalTaskId: task.id,
        rationale: "Task is too large. Splitting into two smaller phases.",
        suggestedSubTasks: [
          {
            title: `${task.title} (Part 1)`,
            steps: uncompletedSteps.slice(0, mid),
            estimatedComplexity: "deep",
          },
          {
            title: `${task.title} (Part 2)`,
            steps: uncompletedSteps.slice(mid),
            estimatedComplexity: "deep",
          },
        ],
      };
    }

    // Fallback: just return the uncompleted steps as one task
    return {
      originalTaskId: task.id,
      rationale: "Task is relatively small. Consider step-by-step verification.",
      suggestedSubTasks: [
        {
          title: `Complete ${task.title}`,
          steps: uncompletedSteps,
          estimatedComplexity: "deep",
        },
      ],
    };
  }

  /**
   * Formats a SplitSuggestion into plan.md compatible Markdown.
   */
  formatAsPlanMarkdown(suggestion: SplitSuggestion): string {
    const lines: string[] = [];
    lines.push(`> **JUSTICE AI 提案**: ${suggestion.rationale}`);
    lines.push(`> 以下のように \`plan.md\` のタスク \`${suggestion.originalTaskId}\` を分割することを推奨します。`);
    lines.push("");

    let index = 1;
    for (const sub of suggestion.suggestedSubTasks) {
      lines.push(`## Task ${suggestion.originalTaskId}.${index}: ${sub.title}`);
      for (const step of sub.steps) {
        lines.push(`- [ ] ${step}`);
      }
      lines.push("");
      index++;
    }

    return lines.join("\n");
  }
}
