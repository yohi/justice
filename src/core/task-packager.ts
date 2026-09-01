import type { DelegationRequest, SpCategory, TaskCategory } from "./types";

export type { DelegationRequest } from "./types";

const FORBIDDEN_TASK_FIELDS: ReadonlySet<string> = new Set([
  "subagent_type",
  "agent",
  "model",
  "provider",
  "variant",
  "reasoning",
  "fallback_models",
]);

export function resolveTaskIdFromToolInput(
  toolInput: Readonly<Record<string, unknown>>,
): string | undefined {
  const taskId = toolInput.task_id ?? toolInput.taskId;
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
  const args = payload.args as Record<string, unknown>;
  const taskId = args.task_id ?? args.taskId;
  return typeof taskId === "string" && taskId.startsWith("task-") ? taskId : undefined;
}

export function resolveSkillsFromToolInput(toolInput: Readonly<Record<string, unknown>>): string[] {
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

export function normalizeTaskToolInput(
  toolInput: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const normalized = Object.fromEntries(
    Object.entries(toolInput).filter(([key]) => !FORBIDDEN_TASK_FIELDS.has(key)),
  );

  const taskId = typeof toolInput.task_id === "string" ? toolInput.task_id : toolInput.taskId;
  delete normalized.taskId;
  if (typeof taskId === "string") normalized.task_id = taskId;

  const hasLoadSkillsInput = ["skills", "loadSkills", "load_skills"].some(
    (key) => key in toolInput,
  );
  delete normalized.skills;
  delete normalized.loadSkills;
  delete normalized.load_skills;
  if (hasLoadSkillsInput) normalized.load_skills = resolveSkillsFromToolInput(toolInput);

  if ("run_in_background" in toolInput) {
    normalized.run_in_background = toolInput.run_in_background;
  } else if ("runInBackground" in toolInput) {
    normalized.run_in_background = toolInput.runInBackground;
  }
  delete normalized.runInBackground;

  return normalized;
}

/**
 * Normalizes a task tool payload without replacing the caller-owned args object.
 * The OpenCode hook contract observes this object after the hook returns.
 */
export function normalizeTaskToolInputInPlace(toolInput: Record<string, unknown>): void {
  const normalized = normalizeTaskToolInput(toolInput);

  for (const key of Object.keys(toolInput)) {
    if (!(key in normalized)) Reflect.deleteProperty(toolInput, key);
  }
  for (const [key, value] of Object.entries(normalized)) {
    Reflect.set(toolInput, key, value);
  }
}

export function enrichTaskToolInput(
  toolInput: Readonly<Record<string, unknown>>,
  taskId: string,
  options?: { readonly loadSkills?: readonly string[] },
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...normalizeTaskToolInput(toolInput),
    task_id: resolveTaskIdFromToolInput(toolInput) ?? taskId,
  };
  delete result.skills;
  delete result.loadSkills;
  delete result.load_skills;
  const loadSkills = mergeSkillArrays(
    resolveSkillsFromToolInput(toolInput),
    options?.loadSkills ?? [],
  );
  if (loadSkills.length > 0) result.load_skills = loadSkills;
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
  package(category: SpCategory | TaskCategory, options: PackageOptions): DelegationRequest {
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
