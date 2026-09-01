import type {
  FileReader,
  HookEvent,
  HookResponse,
  WisdomStoreInterface,
  DelegationRequest,
  PlanTask,
  AgentId,
  SpCategory,
  TaskCategory,
  ImplementationArmRequest,
  ImplementationArmResult,
  WorkflowBootstrapPhase,
  WorkflowStartRequest,
} from "../core/types";
import { isLegacyMessagePayload } from "../core/types";
import { mergePostToolUseResponses } from "../core/hook-response-merger";
import type { LoopDetectionHandler } from "./loop-handler";
import type { ObservationHandler } from "./observation-handler";
import type { TelemetryStore } from "../core/telemetry-store";
import { normalizeSafeRelativePath, TriggerDetector } from "../core/trigger-detector";
import { PlanBridgeCore } from "../core/plan-bridge-core";
import { PlanParser } from "../core/plan-parser";
import { ProgressReporter } from "../core/progress-reporter";
import { DependencyAnalyzer } from "../core/dependency-analyzer";
import { PlanCompletionDetector, type PlanCompletionInput } from "../core/plan-completion-detector";
import { formatBanner } from "../core/justice-notifier";
import type { JusticeNotifier } from "../core/justice-notifier";
import { CategoryClassifier } from "../core/category-classifier";
import { LearningExtractor } from "../core/learning-extractor";
import {
  mergeTaskLoadSkills,
  normalizeTaskToolInput,
  resolveTaskIdFromToolInput,
  resolveSkillsFromToolInput,
} from "../core/task-packager";
import {
  assertNever,
  formatWorkflowDirective,
  resolveWorkflowDirective,
  type CanonicalWorkflowSkill,
  type WorkflowDirectiveStage,
} from "../core/workflow-directives";

const PROCEED: HookResponse = { action: "proceed" };

export function normalizeTaskToolInputWithCategory(
  toolInput: Readonly<Record<string, unknown>>,
  category: SpCategory | TaskCategory,
): Record<string, unknown> {
  const normalized = normalizeTaskToolInput(toolInput);
  if (normalized.category === undefined) {
    normalized.category = category;
  }
  return normalized;
}

/** Superpowers スキルのうち、ブートストラップの次手として案内するもの。 */
export type WorkflowNextSkill = "brainstorming" | "writing-plans";

/** セッション単位のワークフロー・ブートストラップ状態のスナップショット。 */
export interface WorkflowBootstrapState {
  readonly phase: WorkflowBootstrapPhase;
  readonly request: WorkflowStartRequest;
}

/**
 * `handleWorkflowStart` が返す構造化ガイダンス。
 * Justice は成果物を書き込まないため、次手の指示のみを返す。
 */
export interface WorkflowStartResult {
  readonly phase: WorkflowBootstrapPhase;
  readonly directiveStage: WorkflowDirectiveStage;
  readonly recommendedSkills: readonly CanonicalWorkflowSkill[];
  readonly goal: string;
  readonly nextSkill: WorkflowNextSkill | null;
  readonly activePlanPath: string | null;
  readonly guidance: string;
}

/** phase から「次に読み込むべきスキル」への写像 (plan_ready は追加スキル不要)。 */
const NEXT_SKILL_BY_PHASE: ReadonlyMap<WorkflowBootstrapPhase, WorkflowNextSkill> = new Map<
  WorkflowBootstrapPhase,
  WorkflowNextSkill
>([
  ["design_required", "brainstorming"],
  ["plan_required", "writing-plans"],
]);

/** ガイダンス末尾に添える、Justice が書き込みを行わないことの明示。 */
const NO_WRITE_NOTICE =
  "（Justice は設計・計画ファイルを書き込みません。作成は呼び出し側の責務です。）";

export class PlanBridge {
  private readonly fileReader: FileReader;
  private readonly triggerDetector: TriggerDetector;
  private readonly core: PlanBridgeCore;
  private readonly parser: PlanParser;
  private readonly progressReporter: ProgressReporter;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly completionDetector: PlanCompletionDetector;
  private readonly activePlanPaths: Map<string, string> = new Map();
  private readonly implementationArmedSessions: Map<string, { readonly planPath: string }> =
    new Map();
  private readonly lastUserMessages: Map<string, string> = new Map();
  private readonly workflowBootstraps: Map<string, WorkflowBootstrapState> = new Map();
  private readonly lastCompletionInputs: Map<
    string,
    Pick<PlanCompletionInput, "prompt" | "category" | "skillName"> & { readonly taskId?: string }
  > = new Map();
  private readonly wisdomStore: WisdomStoreInterface | null;
  private readonly loopHandler: LoopDetectionHandler | null;
  private readonly notifier: JusticeNotifier | null;
  private readonly categoryClassifier: CategoryClassifier;
  private readonly learningExtractor: LearningExtractor;
  private readonly telemetry?: TelemetryStore;
  private observationHandler: ObservationHandler | null = null;

  constructor(
    fileReader: FileReader,
    loopHandlerOrWisdomStore?: LoopDetectionHandler | WisdomStoreInterface,
    wisdomStore?: WisdomStoreInterface,
    notifier?: JusticeNotifier,
    telemetry?: TelemetryStore,
  ) {
    this.fileReader = fileReader;
    this.triggerDetector = new TriggerDetector();
    this.core = new PlanBridgeCore();
    this.parser = new PlanParser();
    this.progressReporter = new ProgressReporter();
    this.dependencyAnalyzer = new DependencyAnalyzer();
    this.completionDetector = new PlanCompletionDetector();
    this.categoryClassifier = new CategoryClassifier();
    this.learningExtractor = new LearningExtractor();

    // detect legacy argument order: new PlanBridge(reader, wisdomStore)
    if (this.isWisdomStore(loopHandlerOrWisdomStore)) {
      this.loopHandler = null;
      this.wisdomStore = loopHandlerOrWisdomStore;
    } else {
      this.loopHandler = loopHandlerOrWisdomStore ?? null;
      this.wisdomStore = wisdomStore ?? null;
    }
    this.notifier = notifier ?? null;
    this.telemetry = telemetry;
  }

  /**
   * Inject the observation handler so `handleWorkflowStart` can emit the
   * workflow bootstrap audit records. Uses setter injection to preserve the
   * legacy constructor signature used by existing tests.
   */
  setObservationHandler(handler: ObservationHandler): void {
    this.observationHandler = handler;
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
      this.implementationArmedSessions.delete(sessionId);
      return;
    }

    // Reuse TriggerDetector logic to ensure the path is safe
    const validatedRef = this.triggerDetector.detectPlanReference(planPath);
    if (validatedRef) {
      if (this.getActivePlan(sessionId) !== validatedRef.planPath) {
        this.implementationArmedSessions.delete(sessionId);
      }
      // Trust the validated and normalized path
      this.activePlanPaths.set(sessionId, validatedRef.planPath);
    } else {
      // If invalid, clear it to be safe
      this.activePlanPaths.delete(sessionId);
      this.implementationArmedSessions.delete(sessionId);
    }
  }

  /**
   * Get the current active plan path for a specific session.
   */
  getActivePlan(sessionId: string): string | null {
    return this.activePlanPaths.get(sessionId) ?? null;
  }

  /**
   * Clear all internal state for a specific session.
   */
  destroySession(sessionId: string): void {
    this.activePlanPaths.delete(sessionId);
    this.implementationArmedSessions.delete(sessionId);
    this.lastUserMessages.delete(sessionId);
    this.workflowBootstraps.delete(sessionId);
    this.clearSessionCompletionInputs(sessionId);
  }

  private clearSessionCompletionInputs(sessionId: string): void {
    this.implementationArmedSessions.delete(sessionId);
    for (const key of this.lastCompletionInputs.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.lastCompletionInputs.delete(key);
      }
    }
  }

  /**
   * Resolve a workflow-start request into exactly one bootstrap phase.
   *
   * Requested design/plan artifacts are inspected through the injected FileReader
   * only — Justice never creates or edits them. `plan_ready` is the only phase that
   * activates a plan; every other phase clears the session's plan context so a
   * following task() delegation cannot inherit a stale plan.
   */
  async handleWorkflowStart(
    sessionId: string,
    request: WorkflowStartRequest,
  ): Promise<WorkflowStartResult> {
    this.implementationArmedSessions.delete(sessionId);
    const phase = await this.resolveBootstrapPhase(request);
    const directiveStage = this.resolveBootstrapDirectiveStage(phase);
    this.workflowBootstraps.set(sessionId, { phase, request });
    await this.emitWorkflowBootstrapObservations(sessionId, request, phase, directiveStage);

    if (phase === "plan_ready") {
      // Set active plan so the following /justice-implement command can arm
      // against it. plan_ready itself does NOT arm the session (explicit
      // /justice-implement approval is required per the implementation-arm
      // invariant).
      this.setActivePlan(sessionId, request.planPath);
    } else {
      this.setActivePlan(sessionId, null);
      this.clearSessionCompletionInputs(sessionId);
    }
    const activePlanPath = this.getActivePlan(sessionId);
    const directive = resolveWorkflowDirective({
      stage: directiveStage,
      goal: request.goal,
      designPath: request.designPath,
      planPath: activePlanPath ?? request.planPath,
    });

    return {
      phase,
      directiveStage,
      recommendedSkills: directive.requiredSkills,
      goal: request.goal,
      nextSkill: NEXT_SKILL_BY_PHASE.get(phase) ?? null,
      activePlanPath,
      guidance: this.formatWorkflowGuidance(request, phase, activePlanPath),
    };
  }

  private resolveBootstrapDirectiveStage(phase: WorkflowBootstrapPhase): WorkflowDirectiveStage {
    switch (phase) {
      case "design_required":
        return "design_required";
      case "plan_required":
        return "plan_required";
      case "plan_ready":
        return "plan_review_required";
      default:
        return assertNever(phase);
    }
  }

  /**
   * Emit `workflow_started` plus the lifecycle phase transition observation.
   * Audit-only records: failures are logged and swallowed so bootstrap guidance
   * is never blocked by the observation log.
   */
  private async emitWorkflowBootstrapObservations(
    sessionId: string,
    request: WorkflowStartRequest,
    phase: WorkflowBootstrapPhase,
    directiveStage: WorkflowDirectiveStage,
  ): Promise<void> {
    const handler = this.observationHandler;
    if (handler === null) return;

    const results = await Promise.allSettled([
      handler.emitWorkflowStartedEvent({ request, phase, directiveStage, sessionId }),
      handler.emitWorkflowPhaseEvent({ request, phase, directiveStage, sessionId }),
    ]);

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length > 0) {
      this.safeNotify(
        sessionId,
        undefined,
        "warning",
        "escalation",
        "Workflow bootstrap observation failed",
        `Failed to emit workflow bootstrap observations: ${failures.map((f) => String(f.reason)).join(", ")}`,
      );
    }
  }

  /**
   * Get the current workflow bootstrap state for a specific session.
   */
  getWorkflowBootstrap(sessionId: string): WorkflowBootstrapState | null {
    return this.workflowBootstraps.get(sessionId) ?? null;
  }

  /**
   * Select exactly one phase: design gate first, then plan gate.
   * A requested artifact counts as satisfied only when it is actually readable.
   */
  private async resolveBootstrapPhase(
    request: WorkflowStartRequest,
  ): Promise<WorkflowBootstrapPhase> {
    if (request.designPath !== null && !(await this.isArtifactReadable(request.designPath))) {
      return "design_required";
    }

    const planPath = this.resolveActivatablePlanPath(request.planPath);
    if (planPath === null || !(await this.isArtifactReadable(planPath))) {
      return "plan_required";
    }

    return "plan_ready";
  }

  /**
   * Read-only probe for a requested artifact. Unsafe paths are never dereferenced,
   * and any I/O failure degrades to "not satisfied yet" instead of throwing (fail-open).
   */
  private async isArtifactReadable(artifactPath: string): Promise<boolean> {
    if (normalizeSafeRelativePath(artifactPath) === null) return false;

    try {
      return (await this.readPlanFile(artifactPath)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Normalize a requested plan path through the same TriggerDetector validation
   * that setActivePlan uses, so `plan_ready` always implies an activatable plan.
   */
  private resolveActivatablePlanPath(planPath: string | null): string | null {
    if (planPath === null) return null;
    return this.triggerDetector.detectPlanReference(planPath)?.planPath ?? null;
  }

  async handleImplementationArm(
    sessionId: string,
    request: ImplementationArmRequest,
  ): Promise<ImplementationArmResult> {
    const planPath = this.resolveActivatablePlanPath(request.planPath);
    if (planPath === null || !(await this.isArtifactReadable(planPath))) {
      return {
        armed: false,
        planPath: null,
        directiveStage: "implementation_arm_required",
        guidance: formatWorkflowDirective({ stage: "implementation_arm_required" }),
      };
    }

    const activePlanPath = this.getActivePlan(sessionId);
    if (activePlanPath !== null && activePlanPath !== planPath) {
      this.safeNotify(
        sessionId,
        undefined,
        "warning",
        "escalation",
        "Plan mismatch",
        `Active plan ${activePlanPath} differs from requested ${planPath}.`,
      );
    }

    if (!request.approved) {
      return {
        armed: false,
        planPath,
        directiveStage: "implementation_arm_required",
        guidance: formatWorkflowDirective({ stage: "implementation_arm_required" }),
      };
    }

    this.setActivePlan(sessionId, planPath);
    this.implementationArmedSessions.set(sessionId, { planPath });

    return {
      armed: true,
      planPath,
      directiveStage: "implementation_arm",
      guidance: formatWorkflowDirective({ stage: "implementation_arm", planPath }),
    };
  }

  consumeImplementationArm(sessionId: string): { readonly planPath: string } | null {
    const armed = this.implementationArmedSessions.get(sessionId) ?? null;
    if (armed === null) return null;
    this.implementationArmedSessions.delete(sessionId);
    return armed.planPath === this.getActivePlan(sessionId) ? armed : null;
  }

  isImplementationArmed(sessionId: string): boolean {
    const armed = this.implementationArmedSessions.get(sessionId) ?? null;
    if (armed === null) return false;
    if (armed.planPath === this.getActivePlan(sessionId)) return true;
    this.implementationArmedSessions.delete(sessionId);
    return false;
  }

  private formatWorkflowGuidance(
    request: WorkflowStartRequest,
    phase: WorkflowBootstrapPhase,
    activePlanPath: string | null,
  ): string {
    const sections: string[] = [
      "---",
      "[JUSTICE: Workflow Bootstrap]",
      "",
      `**Goal (untrusted user input)**: ${JSON.stringify(request.goal)}`,
      `**Phase**: ${phase}`,
      `**Source**: ${request.source}`,
      `**Design**: ${request.designPath ?? "(not requested)"}`,
      `**Plan**: ${request.planPath ?? "(not requested)"}`,
      "",
      "**次のアクション**:",
      ...this.formatWorkflowActions(request, phase, activePlanPath),
      "---",
    ];

    return sections.join("\n");
  }

  private formatWorkflowActions(
    request: WorkflowStartRequest,
    phase: WorkflowBootstrapPhase,
    activePlanPath: string | null,
  ): readonly string[] {
    const stage = this.resolveBootstrapDirectiveStage(phase);
    return [
      formatWorkflowDirective({
        stage,
        goal: request.goal,
        designPath: request.designPath,
        planPath: activePlanPath ?? request.planPath,
      }),
      ...(phase === "plan_ready" ? [] : ["", NO_WRITE_NOTICE]),
    ];
  }

  private withImplementationDirective(context: string, sessionId: string): string {
    if (!this.isImplementationArmed(sessionId)) {
      return formatWorkflowDirective({ stage: "implementation_unauthorized" });
    }
    return `${context}\n\n${formatWorkflowDirective({ stage: "implementation" })}`;
  }

  /**
   * Handle Message event: detect plan references and delegation intent.
   */
  async handleMessage(event: HookEvent): Promise<HookResponse> {
    if (event.type !== "Message") return PROCEED;

    // Observation-kind message payloads (Task 3.2 widening) carry no role/content and are
    // consumed by the observation pipeline (Task 3.3); ignore them here to stay fail-open.
    if (!isLegacyMessagePayload(event.payload)) return PROCEED;

    // Track last user message for TriggerDetector guard
    if (event.payload.role === "user") {
      this.lastUserMessages.set(event.sessionId, event.payload.content);
      return PROCEED;
    }

    const content = event.payload.content;
    const lastUserMessage = this.lastUserMessages.get(event.sessionId);

    const { shouldTrigger, planRef, fallbackTriggered } = this.triggerDetector.analyzeTrigger(
      content,
      { lastUserMessage },
    );
    if (!shouldTrigger || !planRef) return PROCEED;

    // Fail-open ONLY on I/O error
    let planContent: string;
    try {
      const content = await this.readPlanFile(planRef.planPath);
      if (content === null) {
        // File missing: clear state and fail-open
        this.setActivePlan(event.sessionId, null);
        for (const k of this.lastCompletionInputs.keys()) {
          if (k.startsWith(`${event.sessionId}:`)) this.lastCompletionInputs.delete(k);
        }
        return PROCEED;
      }
      planContent = content;
    } catch {
      this.setActivePlan(event.sessionId, null);
      this.clearSessionCompletionInputs(event.sessionId);
      return PROCEED;
    }

    const tasks = this.parser.parse(planContent);
    const nextTask = this.dependencyAnalyzer.getParallelizable(tasks)[0];
    if (!nextTask) {
      // All tasks completed
      this.setActivePlan(event.sessionId, null);
      this.clearSessionCompletionInputs(event.sessionId);
      return {
        action: "inject",
        injectedContext: `[JUSTICE: All tasks in ${planRef.planPath} are already completed. No further delegation needed.]`,
      };
    }

    const category = this.categoryClassifier.classify(nextTask);
    const initialResult = this.core.classifyAndBuildWorkerRequest(nextTask, {
      taskId: nextTask.id,
      prompt: this.buildTaskPrompt(nextTask),
      category,
      categorySource: category === "unspecified-low" ? "compatibility_fallback" : "classifier",
    });
    if (!initialResult) return PROCEED;

    const persona = this.resolveDelegationPersona(event.sessionId);
    const previousLearnings = this.getRelevantLearnings(
      persona,
      initialResult.request.context.taskId,
    );
    const delegation =
      this.core.classifyAndBuildWorkerRequest(nextTask, {
        taskId: nextTask.id,
        prompt: this.buildTaskPrompt(nextTask, previousLearnings),
        category,
        categorySource: category === "unspecified-low" ? "compatibility_fallback" : "classifier",
      })?.request ?? initialResult.request;

    // Set as active plan for PreToolUse context injection
    this.setActivePlan(event.sessionId, planRef.planPath);

    // Sync current task and agent to LoopDetectionHandler
    if (this.loopHandler) {
      this.loopHandler.setActivePlan(
        event.sessionId,
        planRef.planPath,
        delegation.context.taskId,
        persona,
      );
    }

    this.rememberCompletionInput(event.sessionId, event.callId, delegation);

    let injectedContext = this.withImplementationDirective(
      this.buildInjectedContext(planContent, planRef.planPath, delegation),
      event.sessionId,
    );
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
   * Also records skill invocation intent for A+B completion detection.
   */
  async handlePreToolUse(event: HookEvent): Promise<HookResponse> {
    // Only intercept task() tool calls
    if (event.type !== "PreToolUse" || event.payload.toolName !== "task") return PROCEED;

    // Need an active plan to provide context for this session
    const activePlanPath = this.getActivePlan(event.sessionId);
    if (!activePlanPath) return PROCEED;

    const armed = this.consumeImplementationArm(event.sessionId);
    if (armed === null) {
      return {
        action: "inject",
        injectedContext: formatWorkflowDirective({ stage: "implementation_unauthorized" }),
      };
    }

    this.completionDetector.recordPreToolUseInvocation(
      event.sessionId,
      event.callId,
      event.payload.toolName,
      event.payload.toolInput,
    );

    // Fail-open ONLY on I/O error
    let planContent: string;
    try {
      const content = await this.readPlanFile(activePlanPath);
      if (content === null) {
        // File missing: clear state and fail-open
        this.setActivePlan(event.sessionId, null);
        for (const k of this.lastCompletionInputs.keys()) {
          if (k.startsWith(`${event.sessionId}:`)) this.lastCompletionInputs.delete(k);
        }
        return PROCEED;
      }
      planContent = content;
    } catch {
      this.setActivePlan(event.sessionId, null);
      this.clearSessionCompletionInputs(event.sessionId);
      return PROCEED;
    }

    // toolInput からスキルを抽出 (skills または loadSkills)
    const toolInputSkills = resolveSkillsFromToolInput(event.payload.toolInput);
    const implementationDirective = resolveWorkflowDirective({ stage: "implementation" });
    const mergedLoadSkills = mergeTaskLoadSkills(
      toolInputSkills,
      implementationDirective.requiredSkills,
    );

    const initialResult = this.buildWorkerDelegation(
      planContent,
      typeof event.payload.toolInput.prompt === "string" ? event.payload.toolInput.prompt : "",
      mergedLoadSkills,
    );
    const initialDelegation = initialResult?.request;

    if (!initialDelegation) {
      // Plan is now done
      this.setActivePlan(event.sessionId, null);
      this.clearSessionCompletionInputs(event.sessionId);
      return PROCEED;
    }

    const persona = this.resolveDelegationPersona(event.sessionId);
    const previousLearnings = this.getRelevantLearnings(persona, initialDelegation.context.taskId);
    const delegation =
      this.buildWorkerDelegation(
        planContent,
        this.appendLearnings(
          typeof event.payload.toolInput.prompt === "string" ? event.payload.toolInput.prompt : "",
          previousLearnings,
        ),
        mergedLoadSkills,
      )?.request ?? initialDelegation;

    // Sync current task and agent to LoopDetectionHandler
    if (this.loopHandler) {
      this.loopHandler.setActivePlan(
        event.sessionId,
        activePlanPath,
        delegation.context.taskId,
        persona,
      );
    }

    this.rememberCompletionInput(event.sessionId, event.callId, delegation);

    const normalizedArgs = normalizeTaskToolInputWithCategory(
      event.payload.toolInput,
      delegation.category,
    );
    normalizedArgs.task_id =
      resolveTaskIdFromToolInput(event.payload.toolInput) ?? delegation.taskId;
    delete normalizedArgs.skills;
    delete normalizedArgs.loadSkills;
    delete normalizedArgs.load_skills;
    if (mergedLoadSkills.length > 0) {
      normalizedArgs.load_skills = [...mergedLoadSkills];
    }

    return {
      action: "inject",
      injectedContext: `${this.buildInjectedContext(planContent, activePlanPath, delegation)}\n\n${formatWorkflowDirective({ stage: "implementation" })}`,
      modifiedPayload: {
        args: normalizedArgs,
      },
    };
  }

  /**
   * Handle PostToolUse event: emit completion guidance for finished delegated work.
   * Evaluates A+B hybrid skill completion, Prometheus pivot, and legacy fallback.
   */
  async handlePostToolUse(event: HookEvent): Promise<HookResponse> {
    if (event.type !== "PostToolUse" || event.payload.toolName !== "task") return PROCEED;

    const sessionId = event.sessionId;
    const toolResult = event.payload.toolResult;
    const isError = event.payload.error;
    let response: HookResponse = PROCEED;

    const key = event.callId ? `${sessionId}:${event.callId}` : undefined;
    const completionInput = key ? this.lastCompletionInputs.get(key) : undefined;

    // A+B hybrid: evaluate skill completions
    const writingCompletion = this.completionDetector.evaluateSkillCompletion(
      sessionId,
      event.callId,
      event.payload.toolName,
      toolResult,
      isError,
      "writing-plans",
    );
    const debuggingCompletion = this.completionDetector.evaluateSkillCompletion(
      sessionId,
      event.callId,
      event.payload.toolName,
      toolResult,
      isError,
      "systematic-debugging",
    );

    if (writingCompletion) {
      const planPath = this.getActivePlan(sessionId) ?? "unknown";
      let nextTask: PlanTask | undefined;
      let taskId = "unknown";
      let taskTitle = "Next Step";
      let parallelTasks = "";
      let category: SpCategory | TaskCategory = "quick";
      let hasError = false;

      try {
        const content = await this.readPlanFile(planPath);
        if (content !== null) {
          const tasks = this.parser.parse(content);
          nextTask =
            tasks.find((t) => t.status === "in_progress") ??
            tasks.find((t) => t.status === "pending");
          if (nextTask) {
            taskId = nextTask.id;
            taskTitle = nextTask.title;
            category = this.categoryClassifier.classify(nextTask);

            const parallelizable = this.dependencyAnalyzer.getParallelizable(tasks);
            const otherParallel = parallelizable.filter((t) => t.id !== taskId);
            if (otherParallel.length > 0) {
              parallelTasks = `**並列実行候補**: ${otherParallel.map((t) => t.id).join(", ")}`;
            }
          }
        } else {
          hasError = true;
        }
      } catch {
        hasError = true;
      }

      if (!hasError) {
        if (nextTask) {
          const planPathPart = writingCompletion.planFilePath
            ? ` (${writingCompletion.planFilePath})`
            : "";
          const source = `Detection source: ${writingCompletion.source}${planPathPart}`;
          const mediumNote =
            writingCompletion.confidence === "medium"
              ? "\n> ⚠️ 自動検知。意図と異なる場合は無視可。\n"
              : "\n";

          const banner = this.formatNotificationBanner({
            variant: "atlas_orchestration",
            level: "info",
            title: "Atlas Orchestration",
            message: `Atlasがwriting-plansを完了しました。次のステップはカテゴリ ${category} で委譲してください。`,
          });

          const atlasGuidance = [
            "---",
            "[ATLAS ORCHESTRATION DIRECTIVE]",
            "",
            `**Plan completed**: ${planPath}`,
            `**${source}**`,
            "",
            "⚠️ 重要: Atlas として、ここからは自ら実装に着手せず、計画書に従って委譲してください。",
            "",
            "**次のアクション**:",
            `> Step ${taskId} "${taskTitle}" をカテゴリ \`${category}\` で委譲してください。`,
            "",
            `**推奨カテゴリ**: ${category}`,
            "（Worker Agent・model・provider は OMO のcategory設定に委譲します。）",
            mediumNote,
            parallelTasks,
            "",
            "---",
          ].join("\n");

          response = mergePostToolUseResponses([
            response,
            {
              action: "inject",
              injectedContext: `${banner}\n${atlasGuidance}`,
            },
          ]);

          this.safeNotify(
            sessionId,
            taskId,
            "info",
            "atlas_orchestration",
            "Atlas Orchestration",
            `Atlas が writing-plans を完了 — 次のステップはカテゴリ ${category} で委譲してください。`,
          );
        } else {
          const banner = this.formatNotificationBanner({
            variant: "atlas_orchestration",
            level: "success",
            title: "Atlas Orchestration",
            message: "計画内のすべてのタスクが完了しました！ 🎉",
          });
          const atlasGuidance = [
            "---",
            "[ATLAS ORCHESTRATION DIRECTIVE]",
            "",
            `**Plan completed**: ${planPath}`,
            "",
            "計画書のすべてのタスクがチェックされました。これ以上の委譲は不要です。",
            "---",
          ].join("\n");

          response = mergePostToolUseResponses([
            response,
            {
              action: "inject",
              injectedContext: `${banner}\n${atlasGuidance}`,
            },
          ]);

          this.safeNotify(
            sessionId,
            undefined,
            "success",
            "atlas_orchestration",
            "Atlas Orchestration",
            "計画内のすべてのタスクが完了しました。",
          );
        }
      }
    }

    if (debuggingCompletion) {
      let savedCount = 0;
      let breakdown = "";
      try {
        if (this.wisdomStore) {
          const activeTaskId =
            completionInput?.taskId ??
            (await this.getActiveTaskIdForSession(sessionId)) ??
            "unknown-debug";
          const drafts = this.learningExtractor.extract(
            {
              taskId: activeTaskId,
              status: "success",
              retryCount: 0,
            },
            toolResult,
            { persona: "sisyphus" },
          );
          for (const draft of drafts) {
            this.wisdomStore.add(draft, { persona: "sisyphus" });
            savedCount++;
          }
          const counts = drafts.reduce(
            (acc, d) => {
              acc[d.category] = (acc[d.category] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          );
          const details = Object.entries(counts)
            .map(([cat, count]) => `${cat}: ${count}`)
            .join(", ");
          if (details) {
            breakdown = `（内訳: ${details}）`;
          }
        }
      } catch {
        /* fail-open: continue even if wisdom save fails */
      }

      const banner = this.formatNotificationBanner({
        variant: "sisyphus_insight",
        level: "info",
        title: "Sisyphus Insight",
        message: `Sisyphusがsystematic-debuggingを完了しました。${savedCount} 件のWisdomを保存しました。`,
      });
      const breakdownText = breakdown ? ` ${breakdown}` : "";
      response = mergePostToolUseResponses([
        response,
        {
          action: "inject",
          injectedContext:
            `${banner}\n---\n## SISYPHUS INSIGHT DIRECTIVE\n\n` +
            `**Confidence**: ${debuggingCompletion.confidence}\n` +
            `**Action**: 根本原因特定と修正を完了。${savedCount} 件のWisdomをSisyphus名前空間に保存しました${breakdownText}。\n\n---`,
        },
      ]);
      this.safeNotify(
        sessionId,
        undefined,
        "info",
        "sisyphus_insight",
        "Sisyphus Insight",
        `Sisyphus が debugging を完了しました。${savedCount} 件のWisdomを保存しました。`,
      );
    }

    // Prometheus pivot flow
    const lastPersona = this.completionDetector.lastInvokedPersona(sessionId);
    if (lastPersona === "prometheus" && this.loopHandler && !isError) {
      const taskId =
        completionInput?.taskId ?? (await this.getActiveTaskIdForSession(sessionId)) ?? "unknown";

      const decision = this.loopHandler.recordReviewOutput(sessionId, taskId, toolResult);
      if (decision.pivoted) {
        const banner = this.formatNotificationBanner({
          variant: "architecture_pivot",
          level: "warning",
          title: "Architecture Pivot",
          message: `Prometheusレビュー却下が${decision.rejections}回連続しました。`,
        });

        const excerptBlock =
          decision.recentExcerpts.length > 0
            ? [
                "",
                "**直近の Prometheus 指摘抜粋**:",
                ...decision.recentExcerpts.map((ex) => `- ${ex}`),
              ]
            : [];

        const pivotBody = [
          "---",
          "**ARCHITECTURE PIVOT REQUIRED**",
          "",
          `Prometheus が直近 ${decision.rejections} 回のレビューで連続して却下を出しています（閾値: ${decision.maxRejections}）。`,
          "このアプローチは手詰まりです。**通常の再試行ループを断ち、別の視座でアーキテクチャを再検討してください。**",
          "",
          "**検討すべき選択肢**:",
          "1. 採用ライブラリの変更（同等機能で軽量・成熟したもの）",
          "2. アプローチの簡略化（過剰な抽象化を削減）",
          "3. 機能スコープの縮小（YAGNI 適用）",
          "4. データ構造の根本的な見直し",
          ...excerptBlock,
          "",
          "**次のアクション**:",
          "> Hephaestus は、この pivot 指示に従って **別の実装アプローチ** を提案し、再実装してください。",
          "> 同一の方針での修正は禁止です。",
          "---",
        ].join("\n");

        response = mergePostToolUseResponses([
          response,
          {
            action: "inject",
            injectedContext: `${banner}\n${pivotBody}`,
          },
        ]);
        this.safeNotify(
          sessionId,
          taskId,
          "warning",
          "architecture_pivot",
          "Architecture Pivot",
          `Prometheus レビュー却下が ${decision.rejections} 回連続 — Hephaestus にピボットします。`,
        );
      }
    }

    // Legacy fallback — always clear input to prevent stale data
    if (event.callId) {
      const key = `${sessionId}:${event.callId}`;
      const completionInput = this.lastCompletionInputs.get(key);
      this.lastCompletionInputs.delete(key);
      if (!writingCompletion && !debuggingCompletion && !isError && completionInput) {
        const legacyCompletion = this.completionDetector.detectCompletion({
          prompt: completionInput.prompt,
          category: completionInput.category,
          skillName: completionInput.skillName,
          completed: !isError, // NOSONAR: evaluated as falsy in this branch but kept for explicitness
          rawOutput: toolResult,
        });
        if (legacyCompletion) {
          response = mergePostToolUseResponses([
            response,
            {
              action: "inject",
              injectedContext: legacyCompletion.guidance,
            },
          ]);
        }
      }
    }

    return response;
  }

  /**
   * Get the active task ID for a session by reading the active plan.
   */
  private async getActiveTaskIdForSession(sessionId: string): Promise<string | undefined> {
    const activePlanPath = this.getActivePlan(sessionId);
    if (!activePlanPath) return undefined;
    try {
      const planContent = await this.readPlanFile(activePlanPath);
      if (planContent === null) return undefined;
      const tasks = this.parser.parse(planContent);
      const activeTask =
        tasks.find((t) => t.status === "in_progress") ?? tasks.find((t) => t.status === "pending");
      return activeTask?.id;
    } catch {
      return undefined;
    }
  }

  private buildTaskPrompt(task: PlanTask, previousLearnings?: string): string {
    const incompleteSteps = task.steps.filter((step) => !step.checked);
    const sections = [`**TASK**: ${task.title}`, "", "**STEPS**:"];

    if (incompleteSteps.length === 0) {
      sections.push("All steps are already completed.");
    } else {
      sections.push(...incompleteSteps.map((step) => `- ${step.description}`));
    }

    sections.push(
      "",
      `**EXPECTED OUTCOME**: All steps for "${task.title}" are completed and verified with passing tests.`,
      "",
      "**MUST NOT DO**:",
      "- Do not modify files outside the task scope",
      "- Do not skip tests",
    );

    if (previousLearnings) {
      sections.push("", "**PREVIOUS LEARNINGS**:", previousLearnings);
    }

    return sections.join("\n");
  }

  private buildWorkerDelegation(
    planContent: string,
    prompt: string,
    loadSkills: readonly string[] = [],
  ):
    | { readonly category: SpCategory | TaskCategory; readonly request: DelegationRequest }
    | undefined {
    const tasks = this.parser.parse(planContent);
    const nextTask = this.dependencyAnalyzer.getParallelizable(tasks)[0];
    if (nextTask === undefined) return undefined;

    const category = this.categoryClassifier.classify(nextTask);
    return this.core.classifyAndBuildWorkerRequest(nextTask, {
      taskId: nextTask.id,
      prompt,
      loadSkills,
      category,
      categorySource: category === "unspecified-low" ? "compatibility_fallback" : "classifier",
    });
  }

  private appendLearnings(prompt: string, learnings: string | undefined): string {
    return learnings === undefined ? prompt : `${prompt}\n\n${learnings}`;
  }

  private buildInjectedContext(
    planContent: string,
    planFilePath: string,
    delegation: DelegationRequest,
  ): string {
    const tasks = this.parser.parse(planContent);
    const report = this.progressReporter.generateReport(tasks);
    const parallelizable = this.dependencyAnalyzer.getParallelizable(tasks);
    const otherParallel = parallelizable.filter((t) => t.id !== delegation.context.taskId);

    let injectedContext = this.formatDelegationContext(delegation, planFilePath);
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

  private formatDelegationContext(delegation: DelegationRequest, planFilePath: string): string {
    const sections: string[] = [
      "---",
      "[JUSTICE: Task Delegation Context]",
      "",
      `**Category**: ${delegation.category}`,
      `**Task ID**: ${delegation.context.taskId}`,
      `**Plan File**: ${planFilePath}`,
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
  private getRelevantLearnings(persona?: AgentId, taskId?: string): string | undefined {
    if (!this.wisdomStore) return undefined;
    const entries = this.wisdomStore.getRelevant({ maxEntries: 5, persona });
    if (entries.length === 0) return undefined;
    if (taskId !== undefined) {
      this.telemetry?.recordWisdomInjection(
        entries.map((entry) => entry.id),
        taskId,
      );
      for (const entry of entries) this.wisdomStore.recordHit?.(entry.id, new Date(), taskId);
    }
    return this.wisdomStore.formatForInjection(entries);
  }

  private resolveDelegationPersona(sessionId: string): AgentId {
    return this.completionDetector.lastInvokedPersona(sessionId) ?? "hephaestus";
  }

  private rememberCompletionInput(
    sessionId: string,
    callId: string | undefined,
    delegation: DelegationRequest,
  ): void {
    if (!callId) return;
    const skillName = this.pickCompletionSkill(delegation.loadSkills);
    this.lastCompletionInputs.set(`${sessionId}:${callId}`, {
      prompt: delegation.prompt,
      category: this.toTaskCategory(delegation.category),
      skillName,
      taskId: delegation.context.taskId,
    });
  }

  private toTaskCategory(category: SpCategory | TaskCategory): TaskCategory {
    switch (category) {
      case "sp-mechanical":
      case "sp-implementation":
      case "sp-integration":
      case "sp-review":
      case "sp-final-review":
        return "unspecified-low";
      default:
        return category;
    }
  }

  private pickCompletionSkill(loadSkills: readonly string[]): string | undefined {
    if (loadSkills.includes("systematic-debugging")) {
      return "systematic-debugging";
    }

    if (loadSkills.includes("code-review")) {
      return "code-review";
    }

    return undefined;
  }

  private safeNotify(
    sessionId: string,
    taskId: string | undefined,
    level: "info" | "success" | "warning" | "error",
    variant:
      | "atlas_orchestration"
      | "architecture_pivot"
      | "sisyphus_insight"
      | "escalation"
      | "wisdom_saved"
      | "loop_detected",
    title: string,
    message: string,
  ): void {
    if (!this.notifier) return;
    try {
      void Promise.resolve(
        this.notifier.notify({ sessionId, taskId, level, variant, title, message }),
      ).catch(() => {
        /* fail-open */
      });
    } catch {
      /* fail-open */
    }
  }

  private formatNotificationBanner(notification: Parameters<typeof formatBanner>[0]): string {
    if (!this.notifier) return formatBanner(notification);
    try {
      return this.notifier.formatBanner(notification);
    } catch {
      return formatBanner(notification);
    }
  }
}
