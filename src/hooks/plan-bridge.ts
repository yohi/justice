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
   */
  setActivePlan(sessionId: string, planPath: string | null): void {
    const trimmed = planPath?.trim();
    if (trimmed) {
      this.activePlanPaths.set(sessionId, trimmed);
    } else {
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

    // Check if the plan file exists
    const exists = await this.fileReader.fileExists(planRef.planPath);
    if (!exists) return PROCEED;

    // Read the plan file with graceful error handling
    let planContent: string;
    try {
      planContent = await this.fileReader.readFile(planRef.planPath);
    } catch {
      return PROCEED; // Propagate nothing, let the conversation continue
    }

    // Build delegation request
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: planRef.planPath,
      referenceFiles: [],
    });

    if (!delegation) {
      // All tasks completed: clear active plan for this session
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
      injectedContext: this.formatDelegationContext(delegation),
    };
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

    const exists = await this.fileReader.fileExists(activePlanPath);
    if (!exists) return PROCEED;

    let planContent: string;
    try {
      planContent = await this.fileReader.readFile(activePlanPath);
    } catch {
      return PROCEED;
    }

    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: activePlanPath,
      referenceFiles: [],
    });

    if (!delegation) {
      // Cleanup if plan is now done
      this.setActivePlan(event.sessionId, null);
      return PROCEED;
    }

    return {
      action: "inject",
      injectedContext: this.formatDelegationContext(delegation),
    };
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
