import type { AgentId, FileReader, FileWriter, HookEvent, HookResponse } from "../core/types";
import { TaskSplitter } from "../core/task-splitter";
import { PlanParser } from "../core/plan-parser";
import { ReviewRejectionDetector } from "../core/review-rejection-detector";

const PROCEED: HookResponse = { action: "proceed" };
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 50;

const ESCALATION_TARGET: AgentId = "sisyphus";
const PIVOT_TARGET: AgentId = "hephaestus";
const DEFAULT_MAX_RETRIES_BEFORE_ESCALATION = 3;
const DEFAULT_MAX_REJECTIONS_BEFORE_PIVOT = 3;

/**
 * `MAX_RETRIES_BEFORE_ESCALATION` 環境変数を読み取り、
 * NaN / 非正の値の場合はデフォルト値（3）にフォールバックする。
 */
function resolveMaxRetries(): number {
  const raw = process.env.MAX_RETRIES_BEFORE_ESCALATION ?? "3";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_MAX_RETRIES_BEFORE_ESCALATION;
  return parsed;
}

/**
 * `MAX_REVIEW_REJECTIONS_BEFORE_PIVOT` 環境変数を読み取り、
 * NaN / 非正の値の場合はデフォルト値（3）にフォールバックする。
 */
function resolveMaxRejections(): number {
  const raw = process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT ?? "3";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_MAX_REJECTIONS_BEFORE_PIVOT;
  return parsed;
}

interface SessionState {
  planPath: string;
  activeTaskId: string;
  currentAgent: AgentId;
  lastAccess: number;
}

/** 単一の試行（1 回のエージェント実行）の記録 */
export interface TrialRecord {
  readonly agent: AgentId;
  readonly result: "success" | "failure";
  readonly wisdom?: string;
  readonly timestamp: number;
}

export type EscalationReason = "max_retries_exceeded";

/** エスカレーション判定結果 */
export interface EscalationDecision {
  readonly escalated: boolean;
  readonly targetAgent: AgentId;
  readonly failures: number;
  readonly maxRetries: number;
  readonly reason?: EscalationReason;
  readonly historySummary: string;
}

export type PivotReason = "review_rejection_threshold";

export interface PivotDecision {
  readonly pivoted: boolean;
  readonly targetAgent: AgentId;
  readonly rejections: number;
  readonly maxRejections: number;
  readonly reason?: PivotReason;
  readonly recentExcerpts: readonly string[];
}

export class LoopDetectionHandler {
  private readonly parser: PlanParser;
  private readonly sessions: Map<string, SessionState> = new Map();
  private readonly trials: Map<string, Map<string, TrialRecord[]>> = new Map();
  private readonly reviewRejections: Map<string, Map<string, number>> = new Map();
  private readonly rejectionExcerpts: Map<string, Map<string, string[]>> = new Map();
  private readonly detector: ReviewRejectionDetector;
  private readonly maxRetries: number;
  private readonly maxRejections: number;
  private onSessionRemoved?: (sessionId: string) => void;
  private observationHandler?: import("./observation-handler").ObservationHandler;

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly splitter: TaskSplitter,
  ) {
    this.parser = new PlanParser();
    this.detector = new ReviewRejectionDetector();
    this.maxRetries = resolveMaxRetries();
    this.maxRejections = resolveMaxRejections();
  }

  /**
   * Inject the ObservationHandler so loop/pivot outcomes can emit reflection events.
   */
  setObservationHandler(handler: import("./observation-handler").ObservationHandler): void {
    this.observationHandler = handler;
  }

  /**
   * Set a callback to be invoked when a session is removed (e.g., due to expiration).
   */
  setSessionRemovedCallback(callback: (sessionId: string) => void): void {
    this.onSessionRemoved = callback;
  }

  setActivePlan(sessionId: string, planPath: string, taskId: string, agentId: AgentId): void {
    this.cleanupSessions();
    this.sessions.set(sessionId, {
      planPath,
      activeTaskId: taskId,
      currentAgent: agentId,
      lastAccess: Date.now(),
    });
  }

  /**
   * 試行結果を記録する。
   */
  recordTrial(sessionId: string, taskId: string, record: Omit<TrialRecord, "timestamp">): void {
    let sessionTrials = this.trials.get(sessionId);
    if (!sessionTrials) {
      sessionTrials = new Map();
      this.trials.set(sessionId, sessionTrials);
    }

    const list = sessionTrials.get(taskId) ?? [];
    list.push({ ...record, timestamp: Date.now() });
    sessionTrials.set(taskId, list);
  }

  /**
   * レビュー出力から拒否回数を記録する。
   * 連続拒否ではない出力が来た場合はカウントをリセットする。
   * ReviewRejectionDetector を使用し、一致時は excerpts を追記・recordTrial 連動記録を行う。
   */
  recordReviewOutput(sessionId: string, taskId: string, output: string): PivotDecision {
    const signal = this.detector.detect(output);

    let sessionRejections = this.reviewRejections.get(sessionId);
    let sessionExcerpts = this.rejectionExcerpts.get(sessionId);
    if (!sessionRejections) {
      sessionRejections = new Map();
      this.reviewRejections.set(sessionId, sessionRejections);
    }
    if (!sessionExcerpts) {
      sessionExcerpts = new Map();
      this.rejectionExcerpts.set(sessionId, sessionExcerpts);
    }

    const current = sessionRejections.get(taskId) ?? 0;

    if (signal.matched) {
      const next = current + 1;
      sessionRejections.set(taskId, next);

      const existing = sessionExcerpts.get(taskId) ?? [];
      const merged = [...existing, ...signal.excerpts].slice(-50);
      sessionExcerpts.set(taskId, merged);

      this.recordTrial(sessionId, taskId, {
        agent: "prometheus",
        result: "failure",
        wisdom: `review_rejected: ${signal.summary}`,
      });

      const pivoted = next >= this.maxRejections;
      return {
        pivoted,
        targetAgent: PIVOT_TARGET,
        rejections: next,
        maxRejections: this.maxRejections,
        reason: pivoted ? "review_rejection_threshold" : undefined,
        recentExcerpts: merged.slice(-3),
      };
    }

    // Not matched: reset streak
    sessionRejections.set(taskId, 0);
    sessionExcerpts.set(taskId, []);

    return {
      pivoted: false,
      targetAgent: PIVOT_TARGET,
      rejections: 0,
      maxRejections: this.maxRejections,
      recentExcerpts: [],
    };
  }

  /**
   * 連続レビュー拒否の閾値に到達した場合、Hephaestus への pivot を返す。
   */
  evaluatePivot(sessionId: string, taskId: string): PivotDecision {
    const rejections = this.reviewRejections.get(sessionId)?.get(taskId) ?? 0;
    const excerpts = this.rejectionExcerpts.get(sessionId)?.get(taskId) ?? [];
    const pivoted = rejections >= this.maxRejections;

    return {
      pivoted,
      targetAgent: PIVOT_TARGET,
      rejections,
      maxRejections: this.maxRejections,
      reason: pivoted ? "review_rejection_threshold" : undefined,
      recentExcerpts: excerpts.slice(-3),
    };
  }

  /**
   * 現時点でのエスカレーション判定を返す。
   */
  evaluateEscalation(sessionId: string, taskId: string, primaryAgent: AgentId): EscalationDecision {
    const records = this.trials.get(sessionId)?.get(taskId) ?? [];
    const failures = records.filter((r) => r.result === "failure").length;
    const historySummary = this.formatTrialHistory(records);

    if (failures >= this.maxRetries) {
      return {
        escalated: true,
        targetAgent: ESCALATION_TARGET,
        failures,
        maxRetries: this.maxRetries,
        reason: "max_retries_exceeded",
        historySummary,
      };
    }

    return {
      escalated: false,
      targetAgent: primaryAgent,
      failures,
      maxRetries: this.maxRetries,
      historySummary,
    };
  }

  /**
   * テスト・診断用に内部で保持している試行履歴のスナップショットを返す。
   */
  getTrialHistory(sessionId: string, taskId: string): readonly TrialRecord[] {
    return this.trials.get(sessionId)?.get(taskId) ?? [];
  }

  /**
   * 直近で記録された試行から実行中のエージェントを推測する。
   * セッションの currentAgent が存在する場合はそれを最優先し、
   * 存在しない場合のみ履歴の最終エントリにフォールバックする。
   */
  private inferLastAgent(sessionId: string, taskId: string): AgentId {
    const session = this.sessions.get(sessionId);
    if (session?.currentAgent) return session.currentAgent;

    const records = this.trials.get(sessionId)?.get(taskId);
    const last = records?.at(-1);
    if (last) return last.agent;

    return "hephaestus";
  }

  private formatTrialHistory(records: readonly TrialRecord[]): string {
    if (records.length === 0) return "(no prior trials)";
    return records
      .map((r, i) => {
        const wisdom = r.wisdom ? `, wisdom=${r.wisdom}` : "";
        return `Trial ${i + 1}: agent=${r.agent}, result=${r.result}${wisdom}`;
      })
      .join("\n");
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
        const lastAgent = this.inferLastAgent(event.sessionId, session.activeTaskId);
        const reason = String(event.payload.message);
        this.recordTrial(event.sessionId, session.activeTaskId, {
          agent: lastAgent,
          result: "failure",
          wisdom: `loop_detected: ${reason}`,
        });

        // Append error note to plan.md
        const updatedPlan = this.parser.appendErrorNote(
          planContent,
          session.activeTaskId,
          `loop_detected: ${reason}`,
        );
        await this.fileWriter.writeFile(session.planPath, updatedPlan);

        // Emit reflection event only after successful plan update
        try {
          await this.observationHandler?.emitReflectionEvent({
            trigger: "task_error",
            planRef: { path: session.planPath, taskId: session.activeTaskId },
            intent: "append_error_note",
            note: `loop_detected: ${reason}`,
            sessionId: event.sessionId,
          });
        } catch (err) {
          console.warn(
            "[JUSTICE] Failed to emit loop ReflectionEvent: %s",
            err,
          );
        }

        // Generate split suggestion
        const suggestion = this.splitter.suggestSplit(activeTask, "loop_detected");
        const formattedSuggestion = this.splitter.formatAsPlanMarkdown(suggestion);

        // エスカレーション判定
        const escalation = this.evaluateEscalation(
          event.sessionId,
          session.activeTaskId,
          lastAgent,
        );
        const escalationBlock: string[] = escalation.escalated
          ? [
              "",
              "🚨 **ESCALATION TRIGGERED**",
              `Failures (${escalation.failures}) >= MAX_RETRIES_BEFORE_ESCALATION (${escalation.maxRetries}).`,
              `**Force-routing to**: \`${escalation.targetAgent}\` (debugging specialist)`,
              "",
              "**Trial History (Wisdom)**:",
              escalation.historySummary,
            ]
          : [];

        return {
          action: "inject",
          injectedContext: [
            "---",
            "⚠️ **JUSTICE プロテクター**: 無限ループを検知しました（OmO loop-detector）",
            `**Task**: ${session.activeTaskId}`,
            `**Reason**: ${reason}`,
            "",
            formattedSuggestion,
            ...escalationBlock,
            "---",
            "上記に従い、タスクを分割して再実行を計画してください。",
          ].join("\n"),
        };
      }
    } catch (err) {
      console.warn(
        "[JUSTICE] LoopDetectionHandler failed to handle event: %s",
        err instanceof Error ? err.message : String(err),
      );
    }

    return PROCEED;
  }

  private cleanupSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccess > SESSION_TTL_MS) {
        this.removeSession(id);
      }
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      const sorted = [...this.sessions.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
      const toRemoveCount = this.sessions.size - MAX_SESSIONS + 1;
      const targets = sorted.slice(0, toRemoveCount);

      for (const [id] of targets) {
        this.removeSession(id);
      }
    }
  }

  /**
   * Removes the session and its associated state. Public so that tests and
   * orchestrators can explicitly trigger the session-removed callback path.
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    // 階層型 Map により、sessionId をキーに一括削除可能（衝突リスクの排除と効率化）
    this.trials.delete(sessionId);
    this.reviewRejections.delete(sessionId);
    this.rejectionExcerpts.delete(sessionId);

    try {
      this.onSessionRemoved?.(sessionId);
    } catch (error) {
      console.error(
        `[LoopDetectionHandler] Error in onSessionRemoved callback for session ${sessionId}:`,
        error,
      );
    }
  }
}
