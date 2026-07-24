// src/core/v2/reflection-event.ts
import path from "node:path";
import type { PendingEnvelope, PendingObservationRecord } from "./observation-model";
import { redactAbsolutePaths, redactForPersistence } from "./redaction";

export type ReflectionTrigger = "task_succeeded" | "task_error";

export type ReflectionIntent = "check_complete" | "append_error_note";

export type ReflectionPlanRef = {
  readonly path: string;
  readonly taskId: string;
};

export type ReflectionEventInput = {
  readonly trigger: ReflectionTrigger;
  readonly planRef: ReflectionPlanRef;
  readonly intent: ReflectionIntent;
  readonly note?: string;
};

function validatePlanPath(workspaceRoot: string | undefined, planPath: string): void {
  if (workspaceRoot === undefined || workspaceRoot.length === 0) {
    throw new Error("Invalid plan path: workspace root is not configured");
  }

  if (
    path.isAbsolute(planPath) ||
    planPath.startsWith("/") ||
    planPath.startsWith("\\") ||
    /^[A-Za-z]:/u.test(planPath)
  ) {
    throw new Error("Invalid plan path: Absolute path or traversal detected");
  }

  const resolvedPath = path.resolve(workspaceRoot, planPath);
  const relativePath = path.relative(workspaceRoot, resolvedPath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Invalid plan path: Absolute path or traversal detected");
  }
}

export function buildReflectionEvent(
  envelope: PendingEnvelope,
  input: ReflectionEventInput,
  workspaceRoot?: string,
): PendingObservationRecord {
  validatePlanPath(workspaceRoot, input.planRef.path);

  return {
    ...envelope,
    recordType: "observation",
    kind: "reflection",
    reflection: {
      trigger: input.trigger,
      planRef: input.planRef,
      intent: input.intent,
      note: input.note ? redactForPersistence(redactAbsolutePaths(input.note)) : undefined,
    },
  };
}
