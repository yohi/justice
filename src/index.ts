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

// Phase 5 Exports
export { WisdomStore } from "./core/wisdom-store";
export { LearningExtractor } from "./core/learning-extractor";
export { WisdomPersistence } from "./core/wisdom-persistence";

// Phase 6 Exports
export { DependencyAnalyzer } from "./core/dependency-analyzer";
export { CategoryClassifier } from "./core/category-classifier";
export { ProgressReporter } from "./core/progress-reporter";

export type { BuildDelegationOptions } from "./core/plan-bridge-core";
export type { PlanReference, TriggerAnalysis } from "./core/trigger-detector";

// Phase 7 Exports
export { JusticePlugin } from "./core/justice-plugin";
export { StatusCommand, type PlanStatus } from "./core/status-command";
export { NodeFileSystem } from "./runtime/node-file-system";

