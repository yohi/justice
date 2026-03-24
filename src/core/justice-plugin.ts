import type { FileReader, FileWriter, HookEvent, HookResponse, EventEvent } from "./types";
import { PlanBridge } from "../hooks/plan-bridge";
import { TaskFeedbackHandler } from "../hooks/task-feedback";
import { CompactionProtector } from "../hooks/compaction-protector";
import { LoopDetectionHandler } from "../hooks/loop-handler";
import { TaskSplitter } from "./task-splitter";
import { WisdomStore } from "./wisdom-store";

const PROCEED: HookResponse = { action: "proceed" };

export interface JusticePluginOptions {
  readonly logger?: {
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
  };
  readonly onError?: (error: unknown) => void;
}

export class JusticePlugin {
  private readonly fileReader: FileReader;
  private readonly planBridge: PlanBridge;
  private readonly taskFeedback: TaskFeedbackHandler;
  private readonly compactionProtector: CompactionProtector;
  private readonly loopHandler: LoopDetectionHandler;
  private readonly wisdomStore: WisdomStore;
  private readonly options: JusticePluginOptions;

  constructor(fileReader: FileReader, fileWriter: FileWriter, options: JusticePluginOptions = {}) {
    this.fileReader = fileReader;
    this.options = options;
    this.wisdomStore = new WisdomStore();
    this.planBridge = new PlanBridge(fileReader, this.wisdomStore);
    this.taskFeedback = new TaskFeedbackHandler(fileReader, fileWriter, this.wisdomStore);
    this.compactionProtector = new CompactionProtector(this.wisdomStore);
    this.loopHandler = new LoopDetectionHandler(fileReader, fileWriter, new TaskSplitter());
  }

  /**
   * Route a HookEvent to the appropriate handler(s).
   */
  async handleEvent(event: HookEvent): Promise<HookResponse> {
    switch (event.type) {
      case "Message":
        return this.planBridge.handleMessage(event);
      case "PreToolUse":
        return this.planBridge.handlePreToolUse(event);
      case "PostToolUse":
        return this.taskFeedback.handlePostToolUse(event);
      case "Event":
        return this.handleEventType(event);
      default: {
        const _exhaustiveCheck: never = event;
        void _exhaustiveCheck;
        return PROCEED;
      }
    }
  }

  /**
   * Get the shared WisdomStore for persistence or inspection.
   */
  getWisdomStore(): WisdomStore {
    return this.wisdomStore;
  }

  /**
   * Get the PlanBridge instance for direct configuration (e.g., setActivePlan).
   */
  getPlanBridge(): PlanBridge {
    return this.planBridge;
  }

  /**
   * Get the TaskFeedbackHandler for direct configuration.
   */
  getTaskFeedback(): TaskFeedbackHandler {
    return this.taskFeedback;
  }

  /**
   * Get the CompactionProtector instance.
   */
  getCompactionProtector(): CompactionProtector {
    return this.compactionProtector;
  }

  /**
   * Get the LoopDetectionHandler instance.
   */
  getLoopHandler(): LoopDetectionHandler {
    return this.loopHandler;
  }

  /**
   * Route Event-type events based on eventType payload.
   */
  private async handleEventType(event: EventEvent): Promise<HookResponse> {
    switch (event.payload.eventType) {
      case "loop-detector":
        return this.loopHandler.handleEvent(event);
      case "compaction": {
        const activePlan = this.planBridge.getActivePlan(event.sessionId);
        if (activePlan) {
          try {
            const planContent = await this.fileReader.readFile(activePlan);

            // Note: Since JusticePlugin doesn't directly track currentTaskId/currentStepId
            // in a strict way outside of what's passed to tools, we use placeholders or
            // extract them if they were part of the event payload.
            // For now, we provide the plan content to ensure the protector can snapshot it.
            this.compactionProtector.setActivePlan(activePlan);
            const compactionPayload = event.payload as import("./types").CompactionPayload;
            const snapshot = this.compactionProtector.createSnapshot({
              planContent,
              currentTaskId: "unknown", // Ideal integration would pass these from state
              currentStepId: "unknown",
              learnings: compactionPayload.reason || "", // Provide compaction reason as context
            });

            const injectedContext = this.compactionProtector.formatForInjection(snapshot);
            return { action: "inject", injectedContext };
          } catch (error) {
            // Use provided logger or error handler if available
            // Wrap in individual try/catch to ensure we still return PROCEED
            if (this.options.logger) {
              try {
                this.options.logger.error(
                  `Failed to create compaction snapshot for ${activePlan}:`,
                  error,
                );
              } catch {
                // Ignore logger errors to avoid breaking the flow
              }
            }
            if (this.options.onError) {
              try {
                this.options.onError(error);
              } catch {
                // Ignore handler errors to avoid breaking the flow
              }
            }
          }
        } else {
          // Clear any stale state if no active plan is found
          this.compactionProtector.clearActivePlan();
        }
        return PROCEED;
      }
      default:
        return PROCEED;
    }
  }
}
