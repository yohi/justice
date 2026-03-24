import type {
  FileReader,
  FileWriter,
  HookEvent,
  HookResponse,
  FeedbackAction,
} from "../core/types";
import { FeedbackFormatter } from "../core/feedback-formatter";
import { ErrorClassifier } from "../core/error-classifier";
import { PlanParser } from "../core/plan-parser";
import { SmartRetryPolicy } from "../core/smart-retry-policy";
import { TaskSplitter } from "../core/task-splitter";

const PROCEED: HookResponse = { action: "proceed" };

// Session lifecycle configuration
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 50;

interface SessionState {
  planPath: string;
  activeTaskId: string;
  referenceFiles: string[];
  retryCounts: Map<string, number>; // errorClass -> count
  lastAccess: number;
}

export class TaskFeedbackHandler {
  private readonly fileReader: FileReader;
  private readonly fileWriter: FileWriter;
  private readonly formatter: FeedbackFormatter;
  private readonly classifier: ErrorClassifier;
  private readonly parser: PlanParser;
  private readonly retryPolicy: SmartRetryPolicy;
  private readonly splitter: TaskSplitter;
  private readonly sessions: Map<string, SessionState> = new Map();

  constructor(fileReader: FileReader, fileWriter: FileWriter) {
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.formatter = new FeedbackFormatter();
    this.classifier = new ErrorClassifier();
    this.parser = new PlanParser();
    this.retryPolicy = new SmartRetryPolicy();
    this.splitter = new TaskSplitter();
  }

  /**
   * Register the active plan and task for a session.
   */
  setActivePlan(sessionId: string, planPath: string, taskId: string, referenceFiles: string[] = []): void {
    this.cleanupSessions();
    this.sessions.set(sessionId, {
      planPath,
      activeTaskId: taskId,
      referenceFiles,
      retryCounts: new Map(),
      lastAccess: Date.now(),
    });
  }

  /**
   * Clear the active plan for a session.
   */
  clearActivePlan(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Handle PostToolUse event: process task() results and update plan.md.
   */
  async handlePostToolUse(event: HookEvent): Promise<HookResponse> {
    if (event.type !== "PostToolUse") return PROCEED;

    const payload = event.payload;
    if (payload.toolName !== "task") return PROCEED;

    const session = this.sessions.get(event.sessionId);
    if (!session) return PROCEED;

    session.lastAccess = Date.now();

    // Format the raw output into structured feedback
    const feedback = this.formatter.format(
      session.activeTaskId,
      payload.toolResult,
      payload.error,
    );

    // Determine the action to take
    const action = this.determineAction(feedback, session, payload.toolResult);

    // Execute the action
    return this.executeAction(action, session);
  }

  private determineAction(
    feedback: ReturnType<FeedbackFormatter["format"]>,
    session: SessionState,
    rawResult: string,
  ): FeedbackAction {
    if (feedback.status === "success") {
      return { type: "success", taskId: feedback.taskId };
    }

    if (feedback.status === "timeout") {
      return {
        type: "escalate",
        taskId: feedback.taskId,
        errorClass: "timeout",
        message: this.classifier.getEscalationMessage("timeout"),
      };
    }

    if (feedback.status === "compaction_risk") {
      return {
        type: "escalate",
        taskId: feedback.taskId,
        errorClass: "unknown",
        message: this.classifier.getEscalationMessage("unknown"),
      };
    }

    // Classify the error using the raw task logic or test failure details
    const errorClass = feedback.errorClassification
      ?? this.classifier.classify(rawResult);

    // Check retry eligibility with SmartRetryPolicy
    const currentCount = session.retryCounts.get(errorClass) ?? 0;
    const decision = this.retryPolicy.evaluate(errorClass, currentCount, {
      taskId: session.activeTaskId,
      planFilePath: session.planPath,
      referenceFiles: session.referenceFiles,
    });

    if (decision.shouldRetry) {
      return {
        type: "retry",
        taskId: feedback.taskId,
        errorClass,
        retryCount: currentCount + 1,
        delayMs: decision.delayMs,
        contextReduction: decision.contextReduction,
      };
    }

    // Escalation
    return {
      type: "escalate",
      taskId: feedback.taskId,
      errorClass,
      message: this.classifier.getEscalationMessage(errorClass),
    };
  }

  private async executeAction(
    action: FeedbackAction,
    session: SessionState,
  ): Promise<HookResponse> {
    switch (action.type) {
      case "success":
        return this.handleSuccess(session);
      case "retry":
        // Increment retry count
        session.retryCounts.set(action.errorClass, action.retryCount);
        
        // Wait for exponential backoff delay if any
        if (action.delayMs > 0) {
          // NON-BLOCKING: Schedule the log message.
          // In a real environment, the actual tool retry would be managed by the orchestrator.
          setTimeout(() => {
            console.log(`[JUSTICE] Retry delay of ${action.delayMs}ms reached for task ${action.taskId}`);
          }, action.delayMs);
        }

        // Apply context reduction by injecting a message if requested
        if (action.contextReduction.strategy !== "none") {
          return {
            action: "inject",
            injectedContext: `⚠️ JUSTICE AI: リトライを実行します。コンテキスト縮小戦略を適用中 (\`${action.contextReduction.strategy}\`)。不要な制約を減らして再試行してください。`,
          };
        }
        
        // Layer 1: proceed silently, OmO auto-fix handles it
        return PROCEED;
      case "escalate":
        return this.handleEscalation(action, session);
      default: {
        const _exhaustiveCheck: never = action;
        void _exhaustiveCheck;
        return PROCEED;
      }
    }
  }

  private async handleSuccess(session: SessionState): Promise<HookResponse> {
    try {
      const planContent = await this.fileReader.readFile(session.planPath);
      const tasks = this.parser.parse(planContent);
      const task = tasks.find((t) => t.id === session.activeTaskId);

      if (task) {
        // Check all incomplete steps
        let updatedContent = planContent;
        for (const step of task.steps) {
          if (!step.checked) {
            updatedContent = this.parser.updateCheckbox(updatedContent, step.lineNumber, true);
          }
        }
        await this.fileWriter.writeFile(session.planPath, updatedContent);
      }
    } catch (err) {
      console.warn(`[JUSTICE] Failed to update plan.md after success: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    return {
      action: "inject",
      injectedContext: `[JUSTICE: Task ${session.activeTaskId} completed successfully. plan.md updated. ✅]`,
    };
  }

  private async handleEscalation(
    action: Extract<FeedbackAction, { type: "escalate" }>,
    session: SessionState,
  ): Promise<HookResponse> {
    let splitSuggestionContext = "";
    try {
      const planContent = await this.fileReader.readFile(session.planPath);
      
      const updatedContent = this.parser.appendErrorNote(
        planContent,
        action.taskId,
        `${action.errorClass}: ${action.message}`,
      );
      await this.fileWriter.writeFile(session.planPath, updatedContent);

      // Generate split suggestion
      const tasks = this.parser.parse(planContent);
      const activeTask = tasks.find((t) => t.id === action.taskId);
      if (activeTask) {
        const suggestion = this.splitter.suggestSplit(activeTask, action.errorClass);
        splitSuggestionContext = "\n\n" + this.splitter.formatAsPlanMarkdown(suggestion);
      }
      
    } catch (err) {
      console.warn(`[JUSTICE] Failed to append error note during escalation: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    return {
      action: "inject",
      injectedContext: [
        "---",
        "[JUSTICE: Task Escalation]",
        "",
        `**Task**: ${action.taskId}`,
        `**Error Class**: ${action.errorClass}`,
        `**Action Required**: ${action.message}`,
        splitSuggestionContext,
        "---",
      ].join("\n"),
    };
  }

  private cleanupSessions(): void {
    const now = Date.now();
    
    // TTL Cleanup
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccess > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }

    // Max Size Cleanup (LRU-ish)
    if (this.sessions.size >= MAX_SESSIONS) {
      const sortedSessions = [...this.sessions.entries()]
        .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
      
      const toRemove = this.sessions.size - MAX_SESSIONS + 1;
      for (let i = 0; i < toRemove; i++) {
        const entry = sortedSessions[i];
        if (entry) {
          this.sessions.delete(entry[0]);
        }
      }
    }
  }
}
