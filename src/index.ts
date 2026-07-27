export { ErrorClassifier } from "./core/error-classifier";
export { NoOpNotifier, formatBanner, iconFor } from "./core/justice-notifier";
export { PlanParser } from "./core/plan-parser";
export { DEFAULT_PERSONA, PersonaClassifier, classifyPersona } from "./core/persona-classifier";
export { ReviewRejectionDetector } from "./core/review-rejection-detector";
export { PlanCompletionDetector } from "./core/plan-completion-detector";
export {
  REVIEW_REJECTION_PATTERNS,
  matchesReviewRejection,
} from "./core/review-rejection-patterns";
export { TaskPackager } from "./core/task-packager";
export * from "./core/types";
export type { PersonaClassificationInput } from "./core/persona-classifier";
export type { ReviewRejectionSignal } from "./core/review-rejection-detector";
export type {
  CompletionResult,
  CompletionTrigger,
  PlanCompletionInput,
} from "./core/plan-completion-detector";
export type {
  JusticeNotification,
  JusticeNotifier,
  NotificationLevel,
  NotificationVariant,
} from "./core/justice-notifier";

// Phase 2 Exports
export { TriggerDetector } from "./core/trigger-detector";
export {
  JUSTICE_START_COMMAND,
  WORKFLOW_START_FALLBACK_MARKER,
  isJusticeStartCommand,
  normalizeSafeRelativePath,
  parseWorkflowStartCommandArguments,
  parseWorkflowStartFallbackMarker,
} from "./core/trigger-detector";
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
export {
  type WisdomEntry,
  type WisdomCategory,
  type WisdomScope,
  type WisdomStoreInterface,
} from "./core/types";
export { WisdomStore } from "./core/wisdom-store";
export { LearningExtractor } from "./core/learning-extractor";
export { WisdomPersistence } from "./core/wisdom-persistence";
export { SecretPatternDetector } from "./core/secret-pattern-detector";
export {
  TieredWisdomStore,
  type TieredWisdomStoreOptions,
  type TieredWisdomStoreLogger,
} from "./core/tiered-wisdom-store";
export type { AddOptions } from "./core/types";

// Phase 6 Exports
export { DependencyAnalyzer, DependencyResolutionError } from "./core/dependency-analyzer";
export { CategoryClassifier } from "./core/category-classifier";
export { ProgressReporter } from "./core/progress-reporter";

// Agent Routing
export {
  AgentRouter,
  AGENT_IDS,
  type RoutingCategory,
  type RoutingReason,
  type RoutingResult,
} from "./core/agent-router";
export type { AgentId } from "./core/types";

export type { BuildDelegationOptions } from "./core/plan-bridge-core";
export type { PlanReference, TriggerAnalysis } from "./core/trigger-detector";

// Phase 7 Exports
export { JusticePlugin, createGlobalFs, type JusticePluginOptions } from "./core/justice-plugin";
export { StatusCommand, type PlanStatus } from "./core/status-command";
export { NodeFileSystem } from "./runtime/node-file-system";
export { OpenCodeNotifier } from "./runtime/opencode-notifier";
export { LOOP_ERROR_PATTERNS, matchesLoopError } from "./core/loop-error-patterns";

// OpenCode Plugin Entry
export { OpenCodePlugin as default, OpenCodePlugin } from "./opencode-plugin";
export type { OpenCodeLogEntry } from "./runtime/opencode-adapter";
