import type {
  FileReader,
  FileWriter,
  HookEvent,
  HookResponse,
  PostToolUsePayload,
  FeedbackAction,
} from "../core/types";
import { FeedbackFormatter } from "../core/feedback-formatter";
import { ErrorClassifier } from "../core/error-classifier";
import { PlanParser } from "../core/plan-parser";

const PROCEED: HookResponse = { action: "proceed" };

interface SessionState {
  planPath: string;
  activeTaskId: string;
  retryCounts: Map<string, number>; // errorClass -> count
}

export class TaskFeedbackHandler {
  private readonly fileReader: FileReader;
  private readonly fileWriter: FileWriter;
  private readonly formatter: FeedbackFormatter;
  private readonly classifier: ErrorClassifier;
  private readonly parser: PlanParser;
  private readonly sessions: Map<string, SessionState> = new Map();

  constructor(fileReader: FileReader, fileWriter: FileWriter) {
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.formatter = new FeedbackFormatter();
    this.classifier = new ErrorClassifier();
    this.parser = new PlanParser();
  }

  /**
   * Register the active plan and task for a session.
   */
  setActivePlan(sessionId: string, planPath: string, taskId: string): void {
    this.sessions.set(sessionId, {
      planPath,
      activeTaskId: taskId,
      retryCounts: new Map(),
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

    const payload = event.payload as PostToolUsePayload;
    if (payload.toolName !== "task") return PROCEED;

    const session = this.sessions.get(event.sessionId);
    if (!session) return PROCEED;

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

    // Classify the error using the raw task logic or test failure details
    const errorClass = feedback.errorClassification
      ?? this.classifier.classify(rawResult);

    // Check retry eligibility
    const currentCount = session.retryCounts.get(errorClass) ?? 0;
    if (this.classifier.shouldRetry(errorClass, currentCount)) {
      session.retryCounts.set(errorClass, currentCount + 1);
      return {
        type: "retry",
        taskId: feedback.taskId,
        errorClass,
        retryCount: currentCount + 1,
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
        // Layer 1: proceed silently, OmO auto-fix handles it
        return PROCEED;
      case "escalate":
        return this.handleEscalation(action, session);
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
    } catch {
      // Fail-open on I/O errors
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
    try {
      const planContent = await this.fileReader.readFile(session.planPath);
      const updatedContent = this.parser.appendErrorNote(
        planContent,
        action.taskId,
        `${action.errorClass}: ${action.message}`,
      );
      await this.fileWriter.writeFile(session.planPath, updatedContent);
    } catch {
      // Fail-open on I/O errors
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
        "---",
      ].join("\n"),
    };
  }
}
