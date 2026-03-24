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

// Phase 4 Exports
export { SmartRetryPolicy } from "./core/smart-retry-policy";
export { TaskSplitter } from "./core/task-splitter";
export { LoopDetectionHandler } from "./hooks/loop-handler";

export type { BuildDelegationOptions } from "./core/plan-bridge-core";
export type { PlanReference, TriggerAnalysis } from "./core/trigger-detector";

// Explicit public API exports for better discoverability
export type {
  PostToolUsePayload,
  LoopDetectorPayload,
  EventPayload,
  FileWriter,
  FeedbackAction,
  SuccessAction,
  RetryAction,
  EscalateAction,
} from "./core/types";
