import type {
  PlanTask,
  DelegationRequest,
  DelegationContext,
  TaskCategory,
  AgentId,
} from "./types";
import { CategoryClassifier } from "./category-classifier";
import { AgentRouter, type RoutingCategory } from "./agent-router";

export function resolveTaskIdFromToolInput(
  toolInput: Readonly<Record<string, unknown>>,
): string | undefined {
  const taskId = toolInput.taskId;
  return typeof taskId === "string" && taskId.startsWith("task-") ? taskId : undefined;
}

export function resolveTaskIdFromModifiedPayload(payload: unknown): string | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("args" in payload) ||
    typeof payload.args !== "object" ||
    payload.args === null
  ) {
    return undefined;
  }
  const taskId = "taskId" in payload.args ? payload.args.taskId : undefined;
  return typeof taskId === "string" && taskId.startsWith("task-") ? taskId : undefined;
}

export function enrichTaskToolInput(
  toolInput: Readonly<Record<string, unknown>>,
  taskId: string,
  options?: { readonly loadSkills?: readonly string[] },
): Record<string, unknown> {
  const existingTaskId = resolveTaskIdFromToolInput(toolInput);
  const existingSkills = resolveSkillsFromToolInput(toolInput);
  const mergedSkills = mergeSkillArrays(existingSkills, options?.loadSkills ?? []);

  const result: Record<string, unknown> = {
    ...toolInput,
    taskId: existingTaskId ?? taskId,
  };
  // skills/loadSkills は resolveSkillsFromToolInput で読み込み、統合済みなので元のフィールドは不要
  delete result.skills;
  delete result.loadSkills;

  if (mergedSkills.length > 0) {
    result.loadSkills = mergedSkills;
  }

  return result;
}

export function resolveSkillsFromToolInput(toolInput: Readonly<Record<string, unknown>>): string[] {
  const rawSkills = toolInput.skills;
  const rawLoadSkills = toolInput.loadSkills;
  const skills = Array.isArray(rawSkills)
    ? rawSkills.filter((v): v is string => typeof v === "string")
    : [];
  const loadSkills = Array.isArray(rawLoadSkills)
    ? rawLoadSkills.filter((v): v is string => typeof v === "string")
    : [];
  return mergeSkillArrays(skills, loadSkills);
}

export function mergeSkillArrays(...arrays: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const array of arrays) {
    for (const skill of array) {
      if (seen.has(skill)) continue;
      seen.add(skill);
      result.push(skill);
    }
  }
  return result;
}

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
    const skills = [...(options.loadSkills ?? this.defaultSkills)];

    const classifiedCategory = this.classifier.classify(task);
    const category: TaskCategory = options.category ?? classifiedCategory;

    const routingCategory: RoutingCategory = options.routingCategory ?? category;
    const routingResult = this.router.route(routingCategory, skills);
    let agentId: AgentId = routingResult.agentId;

    if (options.agentId) {
      if (
        routingResult.reason === "dominant_override" &&
        options.agentId !== routingResult.agentId
      ) {
        console.warn(
          `[JUSTICE] Dominant override (skill: ${routingResult.overrideSkill}) takes precedence over requested agentId: ${options.agentId} -> ${routingResult.agentId}`,
        );
        agentId = routingResult.agentId;
      } else {
        agentId = options.agentId;
      }
    }

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
