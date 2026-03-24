import type {
  FileReader,
  HookEvent,
  HookResponse,
  MessagePayload,
  PreToolUsePayload,
  DelegationRequest,
} from "../core/types";
import { TriggerDetector } from "../core/trigger-detector";
import { PlanBridgeCore } from "../core/plan-bridge-core";

const PROCEED: HookResponse = { action: "proceed" };

export class PlanBridge {
  private readonly fileReader: FileReader;
  private readonly triggerDetector: TriggerDetector;
  private readonly core: PlanBridgeCore;
  private activePlanPath: string | null = null;

  constructor(fileReader: FileReader) {
    this.fileReader = fileReader;
    this.triggerDetector = new TriggerDetector();
    this.core = new PlanBridgeCore();
  }

  /**
   * Set the currently active plan path (for PreToolUse context injection).
   */
  setActivePlan(planPath: string): void {
    this.activePlanPath = planPath.trim() || null;
  }

  /**
   * Get the current active plan path.
   */
  getActivePlan(): string | null {
    return this.activePlanPath;
  }

  /**
   * Handle Message event: detect plan references and delegation intent.
   */
  async handleMessage(
    event: HookEvent<MessagePayload>,
  ): Promise<HookResponse> {
    // Only react to assistant messages
    if (event.payload.role !== "assistant") return PROCEED;

    const content = event.payload.content;
    if (!this.triggerDetector.shouldTrigger(content)) return PROCEED;

    const planRef = this.triggerDetector.detectPlanReference(content);
    if (!planRef) return PROCEED;

    // Check if the plan file exists
    const exists = await this.fileReader.fileExists(planRef.planPath);
    if (!exists) return PROCEED;

    // Read the plan file
    const planContent = await this.fileReader.readFile(planRef.planPath);

    // Set as active plan for PreToolUse context injection
    this.activePlanPath = planRef.planPath;

    // Build delegation request
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: planRef.planPath,
      referenceFiles: [],
    });

    if (!delegation) {
      return {
        action: "proceed",
        injectedContext: `All tasks in ${planRef.planPath} are completed. No delegation needed.`,
      };
    }

    return {
      action: "inject",
      injectedContext: this.formatDelegationContext(delegation),
    };
  }

  /**
   * Handle PreToolUse event: inject plan context when task() is called.
   */
  async handlePreToolUse(
    event: HookEvent<PreToolUsePayload>,
  ): Promise<HookResponse> {
    // Only intercept task() tool calls
    if (event.payload.toolName !== "task") return PROCEED;

    // Need an active plan to provide context
    if (!this.activePlanPath) return PROCEED;

    const exists = await this.fileReader.fileExists(this.activePlanPath);
    if (!exists) return PROCEED;

    const planContent = await this.fileReader.readFile(this.activePlanPath);
    const delegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: this.activePlanPath,
      referenceFiles: [],
    });

    if (!delegation) return PROCEED;

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
