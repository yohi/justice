import type {
  PlanTask,
  DelegationRequest,
  DelegationContext,
  TaskCategory,
  AgentId,
} from "./types";
import { CategoryClassifier } from "./category-classifier";
import { AgentRouter, type RoutingCategory } from "./agent-router";

export interface PackageOptions {
  planFilePath: string;
  referenceFiles: string[];
  rolePrompt?: string;
  previousLearnings?: string;
  runInBackground?: boolean;
  category?: TaskCategory;
  loadSkills?: string[];
  /** 明示的にエージェントを指定したい場合の上書き */
  agentId?: AgentId;
  /**
   * AgentRouter に渡すルーティング用カテゴリ。
   * 未指定時は `category` または `CategoryClassifier.classify(task)` の結果を流用する。
   */
  routingCategory?: RoutingCategory;
}

export interface TaskPackagerDependencies {
  classifier?: CategoryClassifier;
  router?: AgentRouter;
}

export class TaskPackager {
  private readonly defaultSkills: string[] = [];
  private readonly classifier: CategoryClassifier;
  private readonly router: AgentRouter;

  constructor(deps: TaskPackagerDependencies = {}) {
    this.classifier = deps.classifier ?? new CategoryClassifier();
    this.router = deps.router ?? new AgentRouter();
  }

  /**
   * Package a PlanTask into a DelegationRequest for OmO's task() tool.
   *
   * カテゴリ分類 → エージェントルーティング → ペイロード組み立ての順で
   * SOP (Superpowers) / Wisdom / Plan セグメントを統合する。
   */
  package(task: PlanTask, options: PackageOptions): DelegationRequest {
    const skills = options.loadSkills ?? this.defaultSkills;

    const classifiedCategory = this.classifier.classify(task);
    const category: TaskCategory = options.category ?? classifiedCategory;

    const routingCategory: RoutingCategory = options.routingCategory ?? category;
    const agentId: AgentId =
      options.agentId ?? this.router.determineOptimalAgent(routingCategory, skills);

    const context: DelegationContext = {
      planFilePath: options.planFilePath,
      taskId: task.id,
      referenceFiles: options.referenceFiles,
      rolePrompt: options.rolePrompt,
      previousLearnings: options.previousLearnings,
      agentId,
    };

    return {
      category,
      prompt: this.buildPrompt(task, options, agentId),
      loadSkills: skills,
      runInBackground: options.runInBackground ?? false,
      context,
    };
  }

  /**
   * Build a structured prompt following OmO's 7-element task prompt guide.
   *
   * `agentId` を渡すと、ヘッダに **AGENT** セクションを追加して
   * 受け側エージェントが自身の役割を即座に認識できるようにする。
   */
  buildPrompt(
    task: PlanTask,
    options: Pick<PackageOptions, "referenceFiles" | "rolePrompt" | "previousLearnings">,
    agentId?: AgentId,
  ): string {
    const sections: string[] = [];

    if (agentId) {
      sections.push(`**AGENT**: ${agentId}`);
      sections.push("");
    }

    if (options.rolePrompt) {
      sections.push(`**ROLE**: ${options.rolePrompt}`);
      sections.push("");
    }

    sections.push(`**TASK**: ${task.title}`);
    sections.push("");

    sections.push("**STEPS**:");
    const incompleteSteps = task.steps.filter((s) => !s.checked);
    if (incompleteSteps.length === 0) {
      sections.push("All steps are already completed.");
    } else {
      for (const step of incompleteSteps) {
        sections.push(`- ${step.description}`);
      }
    }
    sections.push("");

    sections.push(
      `**EXPECTED OUTCOME**: All steps for "${task.title}" are completed and verified with passing tests.`,
    );
    sections.push("");

    if (options.referenceFiles.length > 0) {
      sections.push("**CONTEXT**:");
      for (const file of options.referenceFiles) {
        sections.push(`- ${file}`);
      }
      sections.push("");
    }

    sections.push("**MUST DO**:");
    sections.push("- Follow TDD: write failing test first, then implement");
    sections.push("- Commit after each step");
    sections.push("");

    sections.push("**MUST NOT DO**:");
    sections.push("- Do not modify files outside the task scope");
    sections.push("- Do not skip tests");
    sections.push("");

    if (options.previousLearnings) {
      sections.push("**PREVIOUS LEARNINGS**:");
      sections.push(options.previousLearnings);
      sections.push("");
    }

    return sections.join("\n");
  }
}
