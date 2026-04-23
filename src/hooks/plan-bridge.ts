import type { FileReader, HookEvent, HookResponse, DelegationRequest, WisdomStoreInterface } from "../core/types";
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
  private readonly wisdomStore: WisdomStoreInterface | null;

  constructor(fileReader: FileReader, wisdomStore?: WisdomStoreInterface) {
    this.fileReader = fileReader;
    this.triggerDetector = new TriggerDetector();
    this.core = new PlanBridgeCore();
    this.parser = new PlanParser();
    this.progressReporter = new ProgressReporter();
    this.dependencyAnalyzer = new DependencyAnalyzer();
    this.wisdomStore = wisdomStore ?? null;
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
    // React to both assistant and user messages (different integrations use different roles)
    if (event.type !== "Message") {
      return PROCEED;
    }

    const content = event.payload.content;
    const { shouldTrigger, planRef } = this.triggerDetector.analyzeTrigger(content);
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

    return {
      action: "inject",
      injectedContext: this.buildInjectedContext(planContent, delegation),
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
