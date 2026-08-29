import type { SpCategory, TaskCategory } from "./types";

export interface DelegationRequest {
  readonly category: SpCategory | TaskCategory;
  readonly taskId: string;
  readonly loadSkills: readonly string[];
  readonly prompt: string;
  readonly runInBackground: boolean;
  readonly context: {
    readonly taskId: string;
  };
}

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

export function resolveSkillsFromToolInput(
  toolInput: Readonly<Record<string, unknown>>,
): string[] {
  const values = [toolInput.skills, toolInput.loadSkills, toolInput.load_skills];
  return mergeSkillArrays(
    ...values.map((value) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
    ),
  );
}

export function mergeSkillArrays(...arrays: readonly (readonly string[])[]): string[] {
  return [...new Set(arrays.flat())];
}

export function mergeTaskLoadSkills(
  existing: readonly string[],
  required: readonly string[],
): readonly string[] {
  return mergeSkillArrays(existing, required);
}

export function enrichTaskToolInput(
  toolInput: Readonly<Record<string, unknown>>,
  taskId: string,
  options?: { readonly loadSkills?: readonly string[] },
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...toolInput,
    taskId: resolveTaskIdFromToolInput(toolInput) ?? taskId,
  };
  delete result.skills;
  delete result.loadSkills;
  delete result.load_skills;
  const loadSkills = mergeSkillArrays(resolveSkillsFromToolInput(toolInput), options?.loadSkills ?? []);
  if (loadSkills.length > 0) result.loadSkills = loadSkills;
  return result;
}

export interface PackageOptions {
  readonly taskId: string;
  readonly prompt: string;
  readonly loadSkills?: readonly string[];
  readonly runInBackground?: boolean;
  readonly contextTaskId?: string;
}

export class TaskPackager {
  package(
    category: SpCategory | TaskCategory,
    options: PackageOptions,
  ): DelegationRequest {
    return {
      category,
      taskId: options.taskId,
      loadSkills: [...(options.loadSkills ?? [])],
      prompt: options.prompt,
      runInBackground: options.runInBackground ?? false,
      context: {
        taskId: options.contextTaskId ?? options.taskId,
      },
    };
  }
}
