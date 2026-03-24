import type { PlanTask, DelegationRequest, DelegationContext, TaskCategory } from "./types";

export interface PackageOptions {
  planFilePath: string;
  referenceFiles: string[];
  rolePrompt?: string;
  previousLearnings?: string;
  runInBackground?: boolean;
  category?: TaskCategory;
  loadSkills?: string[];
}

export class TaskPackager {
  private readonly defaultCategory: TaskCategory = "deep";
  private readonly defaultSkills: string[] = [];

  /**
   * Package a PlanTask into a DelegationRequest for OmO's task() tool.
   */
  package(task: PlanTask, options: PackageOptions): DelegationRequest {
    const context: DelegationContext = {
      planFilePath: options.planFilePath,
      taskId: task.id,
      referenceFiles: options.referenceFiles,
      rolePrompt: options.rolePrompt,
      previousLearnings: options.previousLearnings,
    };

    return {
      category: options.category ?? this.defaultCategory,
      prompt: this.buildPrompt(task, options),
      loadSkills: options.loadSkills ?? this.defaultSkills,
      runInBackground: options.runInBackground ?? false,
      context,
    };
  }

  /**
   * Build a structured prompt following OmO's 7-element task prompt guide.
   */
  buildPrompt(
    task: PlanTask,
    options: Pick<PackageOptions, "referenceFiles" | "rolePrompt" | "previousLearnings">,
  ): string {
    const sections: string[] = [];

    // Role prompt (if provided)
    if (options.rolePrompt) {
      sections.push(`**ROLE**: ${options.rolePrompt}`);
      sections.push("");
    }

    // TASK
    sections.push(`**TASK**: ${task.title}`);
    sections.push("");

    // Steps
    sections.push("**STEPS**:");
    const incompleteSteps = task.steps.filter((s) => !s.checked);
    if (incompleteSteps.length === 0) {
      sections.push("すべてのステップが完了しました");
    } else {
      for (const step of incompleteSteps) {
        sections.push(`- ${step.description}`);
      }
    }
    sections.push("");

    // EXPECTED OUTCOME
    sections.push(
      `**EXPECTED OUTCOME**: All steps for "${task.title}" are completed and verified with passing tests.`,
    );
    sections.push("");

    // CONTEXT
    if (options.referenceFiles.length > 0) {
      sections.push("**CONTEXT**:");
      for (const file of options.referenceFiles) {
        sections.push(`- ${file}`);
      }
      sections.push("");
    }

    // MUST DO
    sections.push("**MUST DO**:");
    sections.push("- Follow TDD: write failing test first, then implement");
    sections.push("- Commit after each step");
    sections.push("");

    // MUST NOT DO
    sections.push("**MUST NOT DO**:");
    sections.push("- Do not modify files outside the task scope");
    sections.push("- Do not skip tests");
    sections.push("");

    // Previous learnings
    if (options.previousLearnings) {
      sections.push("**PREVIOUS LEARNINGS**:");
      sections.push(options.previousLearnings);
      sections.push("");
    }

    return sections.join("\n");
  }
}
