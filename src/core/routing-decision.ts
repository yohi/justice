import type {
  ControllerAgent,
  ControllerRoutingDecision,
  ControllerWorkflow,
  ExecutionRole,
  RoutingReason,
  SpCategory,
  TaskCategory,
  UnroutedRoutingDecision,
  WorkerRoutingDecision,
} from "./types";

const VALID_EXECUTION_ROLE_CATEGORIES: ReadonlyMap<
  ExecutionRole,
  ReadonlySet<SpCategory | TaskCategory>
> = new Map<ExecutionRole, ReadonlySet<SpCategory | TaskCategory>>([
  ["mechanical", new Set(["sp-mechanical"])],
  ["implementation", new Set(["sp-implementation"])],
  ["integration", new Set(["sp-integration"])],
  ["review", new Set(["sp-review"])],
  ["final-review", new Set(["sp-final-review"])],
  ["deep", new Set(["deep"])],
  ["architecture", new Set(["unspecified-high", "deep"])],
]);

export function createControllerRoutingDecision(
  workflow: ControllerWorkflow,
  controller: ControllerAgent,
  reason: RoutingReason,
): ControllerRoutingDecision {
  return { kind: "controller", workflow, controller, reason };
}

export function createWorkerRoutingDecision(
  executionRole: ExecutionRole,
  category: SpCategory | TaskCategory,
  reason: RoutingReason,
): WorkerRoutingDecision {
  if (
    reason !== "explicit_request" &&
    reason !== "compatibility_fallback" &&
    !isValidExecutionRoleCategoryPair(executionRole, category)
  ) {
    throw new Error(`Invalid routing pair: ${executionRole} cannot be routed to ${category}`);
  }
  return { kind: "worker", executionRole, category, reason };
}

export function createUnroutedRoutingDecision(
  reason: RoutingReason,
): UnroutedRoutingDecision {
  return { kind: "unrouted", reason };
}

function isValidExecutionRoleCategoryPair(
  executionRole: ExecutionRole,
  category: SpCategory | TaskCategory,
): boolean {
  return VALID_EXECUTION_ROLE_CATEGORIES.get(executionRole)?.has(category) ?? false;
}
