import type {
  FileReader,
  HookEvent,
  HookResponse,
  DelegationRequest,
  WisdomStoreInterface,
} from "../core/types";
import type { LoopDetectionHandler } from "./loop-handler";
import { TriggerDetector } from "../core/trigger-detector";
import { PlanBridgeCore } from "../core/plan-bridge-core";
import { PlanParser } from "../core/plan-parser";
import { ProgressReporter } from "../core/progress-reporter";
import { DependencyAnalyzer } from "../core/dependency-analyzer";

const PROCEED: HookResponse = { action: "proceed" };

export class PlanBridge {
  private readonly fileReader: FileReader;
  private readonly triggerDetector: TriggerDetector;
  private readonly core: PlanBridgeCore;
  private readonly parser: PlanParser;
  private readonly progressReporter: ProgressReporter;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly activePlanPaths: Map<string, string> = new Map();
  private readonly lastUserMessages: Map<string, string> = new Map();
  private readonly wisdomStore: WisdomStoreInterface | null;
  private readonly loopHandler: LoopDetectionHandler | null;

  constructor(
    fileReader: FileReader,
    loopHandlerOrWisdomStore?: LoopDetectionHandler | WisdomStoreInterface,
    wisdomStore?: WisdomStoreInterface,
  ) {
    this.fileReader = fileReader;
    this.triggerDetector = new TriggerDetector();
    this.core = new PlanBridgeCore();
    this.parser = new PlanParser();
    this.progressReporter = new ProgressReporter();
    this.dependencyAnalyzer = new DependencyAnalyzer();

    // detect legacy argument order: new PlanBridge(reader, wisdomStore)
    if (this.isWisdomStore(loopHandlerOrWisdomStore)) {
      this.loopHandler = null;
      this.wisdomStore = loopHandlerOrWisdomStore;
    } else {
      this.loopHandler = loopHandlerOrWisdomStore ?? null;
      this.wisdomStore = wisdomStore ?? null;
    }
  }

  /**
   * Type guard to detect if an object implements WisdomStoreInterface.
   */
  private isWisdomStore(obj: unknown): obj is WisdomStoreInterface {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "getRelevant" in obj &&
      typeof (obj as Record<string, unknown>).getRelevant === "function"
    );
  }

  /**
   * Set the currently active plan path for a specific session.
   * Validates the path using TriggerDetector to prevent path traversal.
   */
  setActivePlan(sessionId: string, planPath: string | null): void {
    if (!planPath) {
      this.activePlanPaths.delete(sessionId);
      return;
    }

    // Reuse TriggerDetector logic to ensure the path is safe
    const validatedRef = this.triggerDetector.detectPlanReference(planPath);
    if (validatedRef) {
      // Trust the validated and normalized path
      this.activePlanPaths.set(sessionId, validatedRef.planPath);
    } else {
      // If invalid, clear it to be safe
      this.activePlanPaths.delete(sessionId);
    }
  }

  /**
   * Get the current active plan path for a specific session.
   */
  getActivePlan(sessionId: string): string | null {
    return this.activePlanPaths.get(sessionId) ?? null;
  }

  /**
   * Handle Message event: detect plan references and delegation intent.
   */
  async handleMessage(event: HookEvent): Promise<HookResponse> {
    if (event.type !== "Message") return PROCEED;

    // Track last user message for TriggerDetector guard
    if (event.payload.role === "user") {
      this.lastUserMessages.set(event.sessionId, event.payload.content);
      return PROCEED;
    }

    const content = event.payload.content;
    const lastUserMessage = this.lastUserMessages.get(event.sessionId);

    const { shouldTrigger, planRef, fallbackTriggered } =
      this.triggerDetector.analyzeTrigger(content, { lastUserMessage });
    if (!shouldTrigger || !planRef) return PROCEED;

    // Fail-open ONLY on I/O error
    let planContent: string;
    try {
      const content = await this.readPlanFile(planRef.planPath);
      if (content === null) {
        // File missing: clear state and fail-open
        this.setActivePlan(event.sessionId, null);
        return PROCEED;
      }
      planContent = content;
    } catch {
      this.setActivePlan(event.sessionId, null);
      return PROCEED;
    }

    // Logic errors from core should propagate
    const previousLearnings = this.getRelevantLearnings();
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: planRef.planPath,
      referenceFiles: [],
      previousLearnings,
    });

    if (!delegation) {
      // All tasks completed
      this.setActivePlan(event.sessionId, null);
      return {
        action: "inject",
        injectedContext: `[JUSTICE: All tasks in ${planRef.planPath} are already completed. No further delegation needed.]`,
      };
    }

    // Set as active plan for PreToolUse context injection
    this.setActivePlan(event.sessionId, planRef.planPath);

    // Sync current task and agent to LoopDetectionHandler
    if (this.loopHandler) {
      this.loopHandler.setActivePlan(
        event.sessionId,
        planRef.planPath,
        delegation.context.taskId,
        delegation.context.agentId ?? "hephaestus",
      );
    }

    let injectedContext = this.buildInjectedContext(planContent, delegation);
    if (fallbackTriggered) {
      injectedContext =
        `[JUSTICE:FALLBACK] Delegation triggered by plan reference only (no explicit keyword match).\n` +
        `If this is not intended as task delegation, you may ignore this context.\n\n` +
        injectedContext;
    }

    return {
      action: "inject",
      injectedContext,
    };
  }

  /**
   * Handle PreToolUse event: inject plan context when task() is called.
   */
  async handlePreToolUse(event: HookEvent): Promise<HookResponse> {
    // Only intercept task() tool calls
    if (event.type !== "PreToolUse" || event.payload.toolName !== "task") return PROCEED;

    // Need an active plan to provide context for this session
    const activePlanPath = this.getActivePlan(event.sessionId);
    if (!activePlanPath) return PROCEED;

    // Fail-open ONLY on I/O error
    let planContent: string;
    try {
      const content = await this.readPlanFile(activePlanPath);
      if (content === null) {
        // File missing: clear state and fail-open
        this.setActivePlan(event.sessionId, null);
        return PROCEED;
      }
      planContent = content;
    } catch {
      this.setActivePlan(event.sessionId, null);
      return PROCEED;
    }

    // Logic errors from core should propagate
    const previousLearnings = this.getRelevantLearnings();
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: activePlanPath,
      referenceFiles: [],
      previousLearnings,
    });

    if (!delegation) {
      // Plan is now done
      this.setActivePlan(event.sessionId, null);
      return PROCEED;
    }

    // Sync current task and agent to LoopDetectionHandler
    if (this.loopHandler) {
      this.loopHandler.setActivePlan(
        event.sessionId,
        activePlanPath,
        delegation.context.taskId,
        delegation.context.agentId ?? "hephaestus",
      );
    }

    return {
      action: "inject",
      injectedContext: this.buildInjectedContext(planContent, delegation),
    };
  }

  /**
   * Internal helper to build injected context for task delegation.
   */
  private buildInjectedContext(planContent: string, delegation: DelegationRequest): string {
    const tasks = this.parser.parse(planContent);
    const report = this.progressReporter.generateReport(tasks);
    const parallelizable = this.dependencyAnalyzer.getParallelizable(tasks);
    const otherParallel = parallelizable.filter((t) => t.id !== delegation.context.taskId);

    let injectedContext = this.formatDelegationContext(delegation);
    injectedContext += `\n\n${this.progressReporter.formatAsMarkdown(report)}`;
    if (otherParallel.length > 0) {
      injectedContext += `\n\n**Parallel:** The following tasks can also be run in parallel: ${otherParallel.map((t) => t.id).join(", ")}`;
    }
    return injectedContext;
  }

  /**
   * Internal helper to read a plan file with I/O error handling.
   * Returns null if file not found.
   * Throws on other I/O errors (which will be caught by handlers to fail-open).
   */
  private async readPlanFile(planPath: string): Promise<string | null> {
    const exists = await this.fileReader.fileExists(planPath);
    if (!exists) {
      return null;
    }

    return await this.fileReader.readFile(planPath);
  }

  private formatDelegationContext(delegation: DelegationRequest): string {
    const sections: string[] = [
      "---",
      "[JUSTICE: Task Delegation Context]",
      "",
      `**Category**: ${delegation.category}`,
      `**Task ID**: ${delegation.context.taskId}`,
      `**Plan File**: ${delegation.context.planFilePath}`,
      `**Background**: ${delegation.runInBackground}`,
      "",
      "**Delegation Prompt**:",
      delegation.prompt,
      "---",
    ];

    return sections.join("\n");
  }

  /**
   * Returns formatted learnings from the WisdomStore for injection into delegation context.
   */
  private getRelevantLearnings(): string | undefined {
    if (!this.wisdomStore) return undefined;
    const entries = this.wisdomStore.getRelevant({ maxEntries: 5 });
    if (entries.length === 0) return undefined;
    return this.wisdomStore.formatForInjection(entries);
  }
}
