export { ErrorClassifier } from "./core/error-classifier";
export { PlanParser } from "./core/plan-parser";
export { TaskPackager } from "./core/task-packager";
export * from "./core/types";

// Phase 2 Exports
export { TriggerDetector } from "./core/trigger-detector";
export { PlanBridgeCore } from "./core/plan-bridge-core";
export { PlanBridge } from "./hooks/plan-bridge";

// Phase 3 Exports
export { FeedbackFormatter } from "./core/feedback-formatter";
export { TaskFeedbackHandler } from "./hooks/task-feedback";

export type { BuildDelegationOptions } from "./core/plan-bridge-core";
export type { PlanReference, TriggerAnalysis } from "./core/trigger-detector";
export type {
  PostToolUsePayload,
  FileWriter,
  FeedbackAction,
  SuccessAction,
  RetryAction,
  EscalateAction,
} from "./core/types";
