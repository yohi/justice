import type {
  FileReader,
  HookEvent,
  HookResponse,
  DelegationRequest,
  WisdomStoreInterface,
  PlanTask,
  AgentId,
} from "../core/types";
import { mergePostToolUseResponses } from "../core/justice-plugin";
import type { LoopDetectionHandler } from "./loop-handler";
import { TriggerDetector } from "../core/trigger-detector";
import { PlanBridgeCore } from "../core/plan-bridge-core";
import { PlanParser } from "../core/plan-parser";
import { ProgressReporter } from "../core/progress-reporter";
import { DependencyAnalyzer } from "../core/dependency-analyzer";
import { PlanCompletionDetector, type PlanCompletionInput } from "../core/plan-completion-detector";
import { formatBanner } from "../core/justice-notifier";
import type { JusticeNotifier } from "../core/justice-notifier";
import { AgentRouter, type RoutingCategory } from "../core/agent-router";
import { CategoryClassifier } from "../core/category-classifier";
import { LearningExtractor } from "../core/learning-extractor";

const PROCEED: HookResponse = { action: "proceed" };

export class PlanBridge {
  private readonly fileReader: FileReader;
  private readonly triggerDetector: TriggerDetector;
  private readonly core: PlanBridgeCore;
  private readonly parser: PlanParser;
  private readonly progressReporter: ProgressReporter;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly completionDetector: PlanCompletionDetector;
  private readonly activePlanPaths: Map<string, string> = new Map();
  private readonly lastUserMessages: Map<string, string> = new Map();
  private readonly lastCompletionInputs: Map<
    string,
    Pick<PlanCompletionInput, "prompt" | "category" | "skillName"> & { readonly taskId?: string }
  > = new Map();
  private readonly wisdomStore: WisdomStoreInterface | null;
  private readonly loopHandler: LoopDetectionHandler | null;
  private readonly notifier: JusticeNotifier | null;
  private readonly agentRouter: AgentRouter;
  private readonly categoryClassifier: CategoryClassifier;
  private readonly learningExtractor: LearningExtractor;

  constructor(
    fileReader: FileReader,
    loopHandlerOrWisdomStore?: LoopDetectionHandler | WisdomStoreInterface,
    wisdomStore?: WisdomStoreInterface,
    notifier?: JusticeNotifier,
  ) {
    this.fileReader = fileReader;
    this.triggerDetector = new TriggerDetector();
    this.core = new PlanBridgeCore();
    this.parser = new PlanParser();
    this.progressReporter = new ProgressReporter();
    this.dependencyAnalyzer = new DependencyAnalyzer();
    this.completionDetector = new PlanCompletionDetector();
    this.agentRouter = new AgentRouter();
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
   * Clear all internal state for a specific session.
   */
  destroySession(sessionId: string): void {
    this.activePlanPaths.delete(sessionId);
    this.lastUserMessages.delete(sessionId);
    this.clearSessionCompletionInputs(sessionId);
  }

  private clearSessionCompletionInputs(sessionId: string): void {
    for (const key of this.lastCompletionInputs.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.lastCompletionInputs.delete(key);
      }
    }
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

    // 1) delegation を仮生成して推奨エージェントを決定
    const initialDelegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: planRef.planPath,
      referenceFiles: [],
    });

    if (!initialDelegation) {
      // All tasks completed
      this.setActivePlan(event.sessionId, null);
      this.clearSessionCompletionInputs(event.sessionId);
      return {
        action: "inject",
        injectedContext: `[JUSTICE: All tasks in ${planRef.planPath} are already completed. No further delegation needed.]`,
      };
    }

    // 2) 過去の知見を決定されたペルソナでロード
    const persona = initialDelegation.context.agentId ?? "hephaestus";
    const previousLearnings = this.getRelevantLearnings(persona);

    // 3) delegation を再構築
    const delegation =
      this.core.buildDelegationFromPlan(planContent, {
        planFilePath: planRef.planPath,
        referenceFiles: [],
        previousLearnings,
      }) ?? initialDelegation;

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

    this.rememberCompletionInput(event.sessionId, event.callId, delegation);

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
   * Also records skill invocation intent for A+B completion detection.
   */
  async handlePreToolUse(event: HookEvent): Promise<HookResponse> {
    // Only intercept task() tool calls
    if (event.type !== "PreToolUse" || event.payload.toolName !== "task") return PROCEED;

    // B phase: record skill invocation for A+B completion detection
    this.completionDetector.recordPreToolUseInvocation(
      event.sessionId,
      event.payload.toolName,
      event.payload.toolInput,
    );

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

    // 1) delegation を仮生成して推奨エージェントを決定
    const initialDelegation = this.core.buildDelegationFromPlan(planContent, {
      planFilePath: activePlanPath,
      referenceFiles: [],
    });

    if (!initialDelegation) {
      // Plan is now done
      this.setActivePlan(event.sessionId, null);
      this.clearSessionCompletionInputs(event.sessionId);
      return PROCEED;
    }

    // 2) ペルソナを解決
    let persona: AgentId = "hephaestus";
    if (this.isResolvableAgentId(initialDelegation.context.agentId)) {
      persona = initialDelegation.context.agentId.toLowerCase() as AgentId;
    } else {
      const lastPersona = this.completionDetector.lastInvokedPersona(event.sessionId);
      if (this.isResolvableAgentId(lastPersona)) {
        persona = lastPersona;
      }
    }

    const previousLearnings = this.getRelevantLearnings(persona);

    // 3) delegation を再構築
    const delegation =
      this.core.buildDelegationFromPlan(planContent, {
        planFilePath: activePlanPath,
        referenceFiles: [],
        previousLearnings,
      }) ?? initialDelegation;

    // Sync current task and agent to LoopDetectionHandler
    if (this.loopHandler) {
      this.loopHandler.setActivePlan(
        event.sessionId,
        activePlanPath,
        delegation.context.taskId,
        delegation.context.agentId ?? "hephaestus",
      );
    }

    this.rememberCompletionInput(event.sessionId, event.callId, delegation);

    return {
      action: "inject",
      injectedContext: this.buildInjectedContext(planContent, delegation),
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
      event.payload.toolName,
      toolResult,
      isError,
      "writing-plans",
    );
    const debuggingCompletion = this.completionDetector.evaluateSkillCompletion(
      sessionId,
      event.payload.toolName,
      toolResult,
      isError,
      "systematic-debugging",
    );

    if (writingCompletion) {
      const planPath = this.getActivePlan(sessionId) ?? "unknown";
      let nextTask: PlanTask | undefined;
      let recommendedAgent = "hephaestus";
      let taskId = "unknown";
      let taskTitle = "Next Step";
      let parallelTasks = "";
      let category: RoutingCategory = "quick";
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
            category = this.categoryClassifier.classify(nextTask) as RoutingCategory;

            const relevantSkills: string[] = [];
            const textToCheck = (
              nextTask.title +
              " " +
              nextTask.steps.map((s) => s.description).join(" ")
            ).toLowerCase();

            if (/(?:test|テスト)/i.test(textToCheck)) {
              relevantSkills.push("test-driven-development");
            }
            if (
              /(?:debug|デバッグ|fix|修正|resolve|解決|error|エラー|bug|バグ)/i.test(textToCheck)
            ) {
              relevantSkills.push("systematic-debugging");
            }
            if (/(?:review|レビュー|refactor|リファクタ|clean|整理)/i.test(textToCheck)) {
              relevantSkills.push("code-quality-reviewer");
            }
            if (/(?:spec|仕様|requirement|要件)/i.test(textToCheck)) {
              relevantSkills.push("spec-reviewer");
            }
            if (/(?:plan|計画|design|設計|brainstorm|アイデア)/i.test(textToCheck)) {
              relevantSkills.push("writing-plans");
            }
            if (
              /(?:implement|実装|create|作成|write|書く|add|追加|build|構築)/i.test(textToCheck)
            ) {
              relevantSkills.push("implementer-prompt");
            }

            const routeResult = this.agentRouter.route(category, relevantSkills);
            recommendedAgent = routeResult.agentId;
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
          const source = `Detection source: ${writingCompletion.source}${writingCompletion.planFilePath ? ` (${writingCompletion.planFilePath})` : ""}`;
          const mediumNote =
            writingCompletion.confidence === "medium"
              ? "\n> ⚠️ 自動検知。意図と異なる場合は無視可。\n"
              : "\n";

          const banner = formatBanner({
            variant: "atlas_orchestration",
            level: "info",
            title: "Atlas Orchestration",
            message: `Atlasがwriting-plansを完了しました。次のステップは ${recommendedAgent} に委譲してください。`,
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
            `> Step ${taskId} "${taskTitle}" を \`${recommendedAgent}\` に委譲してください。`,
            "",
            `**推奨エージェント**: ${recommendedAgent}`,
            `（根拠: ${category} カテゴリ・スキル推定）`,
            mediumNote,
            parallelTasks,
            "",
            "---",
          ].join("\n");

          response = mergePostToolUseResponses(response, {
            action: "inject",
            injectedContext: `${banner}\n${atlasGuidance}`,
          });

          this.safeNotify(
            sessionId,
            taskId,
            "info",
            "atlas_orchestration",
            "Atlas Orchestration",
            `Atlas が writing-plans を完了 — 次のステップは ${recommendedAgent} に委譲してください。`,
          );
        } else {
          const banner = formatBanner({
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

          response = mergePostToolUseResponses(response, {
            action: "inject",
            injectedContext: `${banner}\n${atlasGuidance}`,
          });

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
          const counts = drafts.reduce((acc, d) => {
            acc[d.category] = (acc[d.category] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const details = Object.entries(counts).map(([cat, count]) => `${cat}: ${count}`).join(", ");
          if (details) {
            breakdown = `（内訳: ${details}）`;
          }
        }
      } catch {
        /* fail-open: continue even if wisdom save fails */
      }

      const banner = formatBanner({
        variant: "sisyphus_insight",
        level: "info",
        title: "Sisyphus Insight",
        message: `Sisyphusがsystematic-debuggingを完了しました。${savedCount} 件のWisdomを保存しました。`,
      });
      const breakdownText = breakdown ? ` ${breakdown}` : "";
      response = mergePostToolUseResponses(response, {
        action: "inject",
        injectedContext:
          `${banner}\n---\n## SISYPHUS INSIGHT DIRECTIVE\n\n` +
          `**Confidence**: ${debuggingCompletion.confidence}\n` +
          `**Action**: 根本原因特定と修正を完了。${savedCount} 件のWisdomをSisyphus名前空間に保存しました${breakdownText}。\n\n---`,
      });
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
        completionInput?.taskId ??
        (await this.getActiveTaskIdForSession(sessionId)) ??
        "unknown";

      const decision = this.loopHandler.recordReviewOutput(sessionId, taskId, toolResult);
      if (decision.pivoted) {
        const banner = formatBanner({
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

        response = mergePostToolUseResponses(response, {
          action: "inject",
          injectedContext: `${banner}\n${pivotBody}`,
        });
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
          completed: true,
          rawOutput: toolResult,
        });
        if (legacyCompletion) {
          response = mergePostToolUseResponses(response, {
            action: "inject",
            injectedContext: legacyCompletion.guidance,
          });
        }
      }
    }
    if (!writingCompletion && !debuggingCompletion && !isError && event.callId) {
      const key = `${sessionId}:${event.callId}`;
      const completionInput = this.lastCompletionInputs.get(key);
      // Always clear the input to prevent stale data
      this.lastCompletionInputs.delete(key);
      if (completionInput) {
        const legacyCompletion = this.completionDetector.detectCompletion({
          prompt: completionInput.prompt,
          category: completionInput.category,
          skillName: completionInput.skillName,
          completed: !isError,
          rawOutput: toolResult,
        });
        if (legacyCompletion) {
          response = mergePostToolUseResponses(response, {
            action: "inject",
            injectedContext: legacyCompletion.guidance,
          });
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
        tasks.find((t) => t.status === "in_progress") ??
        tasks.find((t) => t.status === "pending");
      return activeTask?.id;
    } catch {
      return undefined;
    }
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
  private getRelevantLearnings(persona?: AgentId): string | undefined {
    if (!this.wisdomStore) return undefined;
    const entries = this.wisdomStore.getRelevant({ maxEntries: 5, persona });
    if (entries.length === 0) return undefined;
    return this.wisdomStore.formatForInjection(entries);
  }

  private isResolvableAgentId(agentId: unknown): agentId is AgentId {
    if (typeof agentId !== "string") return false;
    const lower = agentId.trim().toLowerCase();
    return ["atlas", "hephaestus", "sisyphus", "prometheus"].includes(lower);
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
      category: delegation.category,
      skillName,
      taskId: delegation.context.taskId,
    });
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
}
