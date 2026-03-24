import type {
  FileReader,
  HookEvent,
  HookResponse,
  DelegationRequest,
} from "../core/types";
import { TriggerDetector } from "../core/trigger-detector";
import { PlanBridgeCore } from "../core/plan-bridge-core";

const PROCEED: HookResponse = { action: "proceed" };

export class PlanBridge {
  private readonly fileReader: FileReader;
  private readonly triggerDetector: TriggerDetector;
  private readonly core: PlanBridgeCore;
  private readonly activePlanPaths: Map<string, string> = new Map();

  constructor(fileReader: FileReader) {
    this.fileReader = fileReader;
    this.triggerDetector = new TriggerDetector();
    this.core = new PlanBridgeCore();
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
    if (validatedRef && validatedRef.planPath === planPath.trim()) {
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
  async handleMessage(
    event: HookEvent,
  ): Promise<HookResponse> {
    // Only react to assistant messages
    if (event.type !== "Message" || event.payload.role !== "assistant") return PROCEED;

    const content = event.payload.content;
    const { shouldTrigger, planRef } = this.triggerDetector.analyzeTrigger(content);
    if (!shouldTrigger || !planRef) return PROCEED;

    try {
      const delegation = await this.loadDelegationForPlan(event.sessionId, planRef.planPath);

      if (!delegation) {
        // All tasks completed (loadDelegationForPlan returns null on no incomplete tasks)
        return {
          action: "inject",
          injectedContext: `[JUSTICE: All tasks in ${planRef.planPath} are already completed. No further delegation needed.]`,
        };
      }

      // Set as active plan for PreToolUse context injection
      this.setActivePlan(event.sessionId, planRef.planPath);

      return {
        action: "inject",
        injectedContext: this.formatDelegationContext(delegation),
      };
    } catch (_error) {
      // Fail-open on I/O error as per requirement
      this.setActivePlan(event.sessionId, null);
      return PROCEED;
    }
  }

  /**
   * Handle PreToolUse event: inject plan context when task() is called.
   */
  async handlePreToolUse(
    event: HookEvent,
  ): Promise<HookResponse> {
    // Only intercept task() tool calls
    if (event.type !== "PreToolUse" || event.payload.toolName !== "task") return PROCEED;

    // Need an active plan to provide context for this session
    const activePlanPath = this.getActivePlan(event.sessionId);
    if (!activePlanPath) return PROCEED;

    try {
      const delegation = await this.loadDelegationForPlan(event.sessionId, activePlanPath);

      if (!delegation) {
        // Plan is now done: loadDelegationForPlan already cleared it
        return PROCEED;
      }

      return {
        action: "inject",
        injectedContext: this.formatDelegationContext(delegation),
      };
    } catch (_error) {
      this.setActivePlan(event.sessionId, null);
      return PROCEED;
    }
  }

  /**
   * Common logic to load and parse a plan file.
   * Throws on I/O error, returns null if no incomplete tasks are found.
   */
  private async loadDelegationForPlan(
    sessionId: string,
    planPath: string,
  ): Promise<DelegationRequest | null> {
    // fileExists and readFile may throw, which will be caught by handlers
    const exists = await this.fileReader.fileExists(planPath);
    if (!exists) {
      this.setActivePlan(sessionId, null);
      throw new Error(`Plan file not found: ${planPath}`);
    }

    const planContent = await this.fileReader.readFile(planPath);
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: planPath,
      referenceFiles: [],
    });

    if (!delegation) {
      this.setActivePlan(sessionId, null);
      return null;
    }

    return delegation;
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
}
