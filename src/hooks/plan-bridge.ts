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
  async handleMessage(
    event: HookEvent,
  ): Promise<HookResponse> {
    // Only react to assistant messages
    if (event.type !== "Message" || event.payload.role !== "assistant") return PROCEED;

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
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: planRef.planPath,
      referenceFiles: [],
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
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: activePlanPath,
      referenceFiles: [],
    });

    if (!delegation) {
      // Plan is now done
      this.setActivePlan(event.sessionId, null);
      return PROCEED;
    }

    return {
      action: "inject",
      injectedContext: this.formatDelegationContext(delegation),
    };
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
}
