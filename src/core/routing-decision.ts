import type {
  ControllerAgent,
  ExecutionRole,
  RoutingDecision,
  RoutingReason,
  SpCategory,
  TaskCategory,
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
  controller: ControllerAgent,
  reason: RoutingReason,
): RoutingDecision {
  return { kind: "controller", controller, reason };
}

export function createWorkerRoutingDecision(
  executionRole: ExecutionRole,
  category: SpCategory | TaskCategory,
  reason: RoutingReason,
): Extract<RoutingDecision, { readonly kind: "worker" }> {
  if (
    reason !== "explicit_request" &&
    reason !== "compatibility_fallback" &&
    !isValidExecutionRoleCategoryPair(executionRole, category)
  ) {
    throw new Error(`Invalid routing pair: ${executionRole} cannot be routed to ${category}`);
  }
  return { kind: "worker", executionRole, category, reason };
}

export function createUnroutedRoutingDecision(reason: RoutingReason): RoutingDecision {
  return { kind: "unrouted", reason };
}

function isValidExecutionRoleCategoryPair(
  executionRole: ExecutionRole,
  category: SpCategory | TaskCategory,
): boolean {
  return VALID_EXECUTION_ROLE_CATEGORIES.get(executionRole)?.has(category) ?? false;
}
