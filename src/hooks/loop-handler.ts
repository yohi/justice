import type { AgentId, FileReader, FileWriter, HookEvent, HookResponse } from "../core/types";
import { TaskSplitter } from "../core/task-splitter";
import { PlanParser } from "../core/plan-parser";

const PROCEED: HookResponse = { action: "proceed" };
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 50;

const ESCALATION_TARGET: AgentId = "sisyphus";
const DEFAULT_MAX_RETRIES_BEFORE_ESCALATION = 3;

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

interface SessionState {
  planPath: string;
  activeTaskId: string;
  lastAccess: number;
}

/** 単一の試行（1 回のエージェント実行）の記録 */
export interface TrialRecord {
  readonly agent: AgentId;
  readonly result: "success" | "failure";
  readonly wisdom?: string;
  readonly timestamp: number;
}

export type EscalationReason = "max_retries_exceeded" | "loop_detected_and_retries_exceeded";

/** エスカレーション判定結果 */
export interface EscalationDecision {
  readonly escalated: boolean;
  readonly targetAgent: AgentId;
  readonly failures: number;
  readonly maxRetries: number;
  readonly reason?: EscalationReason;
  readonly historySummary: string;
}

export class LoopDetectionHandler {
  private readonly parser: PlanParser;
  private readonly sessions: Map<string, SessionState> = new Map();
  private readonly trials: Map<string, TrialRecord[]> = new Map();
  private readonly maxRetries: number;

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly splitter: TaskSplitter,
  ) {
    this.parser = new PlanParser();
    this.maxRetries = resolveMaxRetries();
  }

  setActivePlan(sessionId: string, planPath: string, taskId: string): void {
    this.cleanupSessions();
    this.sessions.set(sessionId, {
      planPath,
      activeTaskId: taskId,
      lastAccess: Date.now(),
    });
  }

  /**
   * 試行結果を記録する。失敗回数が `MAX_RETRIES_BEFORE_ESCALATION` を超えると
   * `evaluateEscalation` がエスカレーション指示を返すようになる。
   */
  recordTrial(taskId: string, record: Omit<TrialRecord, "timestamp">): void {
    const list = this.trials.get(taskId) ?? [];
    list.push({ ...record, timestamp: Date.now() });
    this.trials.set(taskId, list);
  }

  /**
   * 現時点でのエスカレーション判定を返す。
   * 失敗回数が閾値以上に達していれば、`sisyphus` へ強制ルーティングするよう示す。
   */
  evaluateEscalation(taskId: string, primaryAgent: AgentId): EscalationDecision {
    const records = this.trials.get(taskId) ?? [];
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
  getTrialHistory(taskId: string): readonly TrialRecord[] {
    return this.trials.get(taskId) ?? [];
  }

  /**
   * 直近で記録された試行から実行中のエージェントを推測する。
   * 履歴がない場合は、デフォルト実装担当である `hephaestus` を仮定する。
   */
  private inferLastAgent(taskId: string): AgentId {
    const records = this.trials.get(taskId);
    if (!records || records.length === 0) return "hephaestus";
    const last = records[records.length - 1];
    return last?.agent ?? "hephaestus";
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
        // ループ検知自体を 1 回の失敗試行として記録する。
        // どのエージェントが失敗中かは、最後に記録された試行から推測する。
        const lastAgent = this.inferLastAgent(session.activeTaskId);
        this.recordTrial(session.activeTaskId, {
          agent: lastAgent,
          result: "failure",
          wisdom: `loop_detected: ${event.payload.message}`,
        });

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

        // エスカレーション判定
        const escalation = this.evaluateEscalation(session.activeTaskId, lastAgent);
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
            `**Reason**: ${event.payload.message}`,
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
        `[JUSTICE] LoopDetectionHandler failed to handle event: ${err instanceof Error ? err.message : String(err)}`,
      );
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
        // eslint-disable-next-line security/detect-object-injection
        const entry = sorted[i];
        if (entry) this.sessions.delete(entry[0]);
      }
    }
  }
}
