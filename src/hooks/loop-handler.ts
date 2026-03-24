import type { FileReader, FileWriter, HookEvent, HookResponse } from "../core/types";
import { TaskSplitter } from "../core/task-splitter";
import { PlanParser } from "../core/plan-parser";

const PROCEED: HookResponse = { action: "proceed" };
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 50;

interface SessionState {
  planPath: string;
  activeTaskId: string;
  lastAccess: number;
}

export class LoopDetectionHandler {
  private readonly parser: PlanParser;
  private readonly sessions: Map<string, SessionState> = new Map();

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly splitter: TaskSplitter,
  ) {
    this.parser = new PlanParser();
  }

  setActivePlan(sessionId: string, planPath: string, taskId: string): void {
    this.cleanupSessions();
    this.sessions.set(sessionId, {
      planPath,
      activeTaskId: taskId,
      lastAccess: Date.now(),
    });
  }

  async handleEvent(event: HookEvent): Promise<HookResponse> {
    if (event.type !== "Event") return PROCEED;
    if (event.payload.eventType !== "loop-detector") return PROCEED;

    const session = this.sessions.get(event.sessionId);
    if (!session) return PROCEED;

    session.lastAccess = Date.now();

    try {
      const planContent = await this.fileReader.readFile(session.planPath);
      const tasks = this.parser.parse(planContent);
      const activeTask = tasks.find((t) => t.id === session.activeTaskId);

      if (activeTask) {
        // Append error note to plan.md
        const updatedPlan = this.parser.appendErrorNote(
          planContent,
          session.activeTaskId,
          `loop_detected: ${event.payload.message}`,
        );
        await this.fileWriter.writeFile(session.planPath, updatedPlan);

        // Generate split suggestion
        const suggestion = this.splitter.suggestSplit(activeTask, "loop_detected");
        const formattedSuggestion = this.splitter.formatAsPlanMarkdown(suggestion);

        return {
          action: "inject",
          injectedContext: [
            "---",
            "⚠️ **JUSTICE プロテクター**: 無限ループを検知しました（OmO loop-detector）",
            `**Task**: ${session.activeTaskId}`,
            `**Reason**: ${event.payload.message}`,
            "",
            formattedSuggestion,
            "---",
            "上記に従い、タスクを分割して再実行を計画してください。",
          ].join("\n"),
        };
      }
    } catch (err) {
      console.warn(`[JUSTICE] LoopDetectionHandler failed to handle event: ${err instanceof Error ? err.message : String(err)}`);
    }

    return PROCEED;
  }

  private cleanupSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccess > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      const sorted = [...this.sessions.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
      const toRemove = this.sessions.size - MAX_SESSIONS + 1;
      for (let i = 0; i < toRemove; i++) {
        const entry = sorted[i];
        if (entry) this.sessions.delete(entry[0]);
      }
    }
  }
}
