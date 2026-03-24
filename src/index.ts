// Justice Plugin — Entry Point
// The nervous system connecting Superpowers (brain) and oh-my-openagent (limbs)

export { PlanParser } from "./core/plan-parser";
export { TaskPackager } from "./core/task-packager";
export type { PackageOptions } from "./core/task-packager";
export { ErrorClassifier } from "./core/error-classifier";
export { CompactionProtector } from "./hooks/compaction-protector";

export type {
  PlanTask,
  PlanStep,
  PlanTaskStatus,
  DelegationRequest,
  DelegationContext,
  TaskFeedback,
  TaskFeedbackStatus,
  TestSummary,
  ErrorClass,
  TaskCategory,
  ProtectedContext,
  RetryPolicy,
} from "./core/types";

export { DEFAULT_RETRY_POLICY } from "./core/types";