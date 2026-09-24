import type {
  ControllerRoutingDecision,
  ControllerWorkflow,
  ExecutionRole,
  RoutingDecision,
  RoutingReason,
  SpCategory,
  TaskCategory,
} from "./types";
import { WORKFLOW_DESIRED_CONTROLLERS } from "./workflow-router";

const VALID_EXECUTION_ROLE_CATEGORIES: ReadonlyMap<
  ExecutionRole,
  ReadonlySet<SpCategory | TaskCategory>
> = new Map<ExecutionRole, ReadonlySet<SpCategory | TaskCategory>>([
  ["mechanical", new Set(["sp-mechanical"])],
  ["implementation", new Set(["sp-implementation"])],
  ["integration", new Set(["sp-integration"])],
  ["review", new Set(["sp-review"])],
  ["final-review", new Set(["sp-final-review"])],
  ["deep", new Set(["sp-deep"])],
  ["architecture", new Set(["sp-architecture"])],
]);

/**
 * workflow から desired controller を解決する純粋ファクトリ。
 * 4つの controller workflow の exact マッピングのみを受理し、
 * 実行への適用（runtime applied）を意味するフィールドは持たない。
 */
export function createControllerRoutingDecision(
  workflow: ControllerWorkflow,
  reason: RoutingReason,
): ControllerRoutingDecision {
  const controller = WORKFLOW_DESIRED_CONTROLLERS.get(workflow);
  if (controller === undefined) {
    throw new Error(`Unknown controller workflow: ${workflow}`);
  }
  return { kind: "controller", workflow, controller, reason };
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
