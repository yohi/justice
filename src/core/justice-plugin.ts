import type { FileReader, FileWriter, HookEvent, HookResponse, EventEvent } from "./types";
import { PlanBridge } from "../hooks/plan-bridge";
import { TaskFeedbackHandler } from "../hooks/task-feedback";
import { CompactionProtector } from "../hooks/compaction-protector";
import { LoopDetectionHandler } from "../hooks/loop-handler";
import { TaskSplitter } from "./task-splitter";
import { WisdomStore } from "./wisdom-store";

const PROCEED: HookResponse = { action: "proceed" };

export class JusticePlugin {
  private readonly fileReader: FileReader;
  private readonly planBridge: PlanBridge;
  private readonly taskFeedback: TaskFeedbackHandler;
  private readonly compactionProtector: CompactionProtector;
  private readonly loopHandler: LoopDetectionHandler;
  private readonly wisdomStore: WisdomStore;

  constructor(fileReader: FileReader, fileWriter: FileWriter) {
    this.fileReader = fileReader;
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
          this.compactionProtector.setActivePlan(activePlan);
          try {
            const planContent = await this.fileReader.readFile(activePlan);
            
            // Note: Since JusticePlugin doesn't directly track currentTaskId/currentStepId
            // in a strict way outside of what's passed to tools, we use placeholders or 
            // extract them if they were part of the event payload.
            // For now, we provide the plan content to ensure the protector can snapshot it.
            const snapshot = this.compactionProtector.createSnapshot({
              planContent,
              currentTaskId: "unknown", // Ideal integration would pass these from state
              currentStepId: "unknown",
              learnings: event.payload.reason || "", // Provide compaction reason as context
            });
            
            const injectedContext = this.compactionProtector.formatForInjection(snapshot);
            return { action: "inject", injectedContext };
          } catch (error) {
            // Ignore file read errors and proceed
            console.warn(`Failed to create compaction snapshot for ${activePlan}:`, error);
          }
        }
        return PROCEED;
      }
      default:
        return PROCEED;
    }
  }
}