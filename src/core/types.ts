import type { ObservationMessagePayload } from "./v2/message-payload";
import type { WorkflowDirectiveStage } from "./workflow-directives";

/** plan.mdから抽出されたタスク */
export interface PlanTask {
  readonly id: string;
  readonly title: string;
  readonly steps: PlanStep[];
  readonly status: PlanTaskStatus;
}

export type PlanTaskStatus = "pending" | "in_progress" | "completed" | "failed";

/** plan.md内の個別ステップ */
export interface PlanStep {
  readonly id: string;
  readonly description: string;
  readonly checked: boolean;
  readonly lineNumber: number;
}

/** task()ツールに渡すパッケージ化されたリクエスト */
export interface DelegationRequest {
  readonly category: TaskCategory;
  readonly prompt: string;
  readonly loadSkills: string[];
  readonly runInBackground: boolean;
  readonly context: DelegationContext;
}

/** タスク委譲のコンテキスト情報 */
export interface DelegationContext {
  readonly planFilePath: string;
  readonly taskId: string;
  readonly referenceFiles: string[];
  readonly rolePrompt?: string;
  readonly previousLearnings?: string;
  readonly agentId?: AgentId;
}

/** workflow-start リクエストの起点 (明示コマンド or クロスハーネス用フォールバックマーカー) */
export type WorkflowStartSource = "command" | "fallback_marker";

/**
 * パース済みの workflow-start リクエスト。
 * goal は必須、design/plan は任意の「安全な相対パス」に正規化済み (未指定は null)。
 */
export interface WorkflowStartRequest {
  readonly source: WorkflowStartSource;
  readonly goal: string;
  readonly designPath: string | null;
  readonly planPath: string | null;
}

/** `/justice-implement` コマンドで生成される実装許可リクエスト */
export interface ImplementationArmRequest {
  readonly source: WorkflowStartSource;
  readonly planPath: string;
  readonly approved: boolean;
}

/** `/justice-implement` 実行結果 */
export interface ImplementationArmResult {
  readonly armed: boolean;
  readonly planPath: string | null;
  readonly directiveStage: WorkflowDirectiveStage;
  readonly guidance: string;
}

/**
 * ワークフロー・ブートストラップのフェーズ。
 * design → plan → 実行可能 の順に、ちょうど1つだけが選択される。
 */
export type WorkflowBootstrapPhase = "design_required" | "plan_required" | "plan_ready";

/** Oh My OpenAgent のエージェント識別子 */
export type AgentId = "hephaestus" | "sisyphus" | "prometheus" | "atlas";

export type ObservationAgentId = AgentId | "system" | "unknown";

export type ShardId = {
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string; // validated via isSafeWriterId
};

export type EvidenceRef = FullEvidenceRef | SelfEvidenceRef;

export type FullEvidenceRef = ShardId & {
  readonly kind: "full";
  readonly sequence: number;
  readonly evidenceId: string;
};

export type SelfEvidenceRef = {
  readonly kind: "self";
  readonly evidenceId: string;
};

/** task()完了後のフィードバック */
export interface TaskFeedback {
  readonly taskId: string;
  readonly status: TaskFeedbackStatus;
  readonly diff?: string;
  readonly testResults?: TestSummary;
  readonly unresolvedIssues?: string[];
  readonly retryCount: number;
  readonly errorClassification?: ErrorClass;
}

export type TaskFeedbackStatus = "success" | "failure" | "timeout" | "compaction_risk";

/** テスト結果サマリー */
export interface TestSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failureDetails?: string[];
}

/** エラー分類 */
export type ErrorClass =
  | "syntax_error"
  | "type_error"
  | "test_failure"
  | "design_error"
  | "timeout"
  | "loop_detected"
  | "provider_transient"
  | "provider_config"
  | "unknown";

/** task()に渡すカテゴリ（OmO準拠） */
export type TaskCategory =
  | "visual-engineering"
  | "ultrabrain"
  | "deep"
  | "quick"
  | "unspecified-low"
  | "unspecified-high"
  | "writing";

/** コンパクション時に保護すべき状態 */
export interface ProtectedContext {
  readonly planSnapshot: string;
  readonly currentTaskId: string;
  readonly currentStepId: string;
  readonly accumulatedLearnings: string;
  readonly timestamp: string;
  readonly activePlanPath: string | null;
}

/** リトライポリシー */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly retryableErrors: readonly ErrorClass[];
}

/** デフォルトのリトライポリシー */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  retryableErrors: Object.freeze(["syntax_error", "type_error"]),
};

/** OmO Hook イベントの Discriminated Union */
export type HookEvent =
  | MessageEvent
  | PreToolUseEvent
  | PostToolUseEvent
  | EventEvent
  | AgentMappedEvent;

export interface MessageEvent {
  readonly type: "Message";
  readonly payload: MessagePayload | ObservationMessagePayload;
  readonly sessionId: string;
  readonly callId?: string;
}

/** エージェント割当イベント: message properties から検出した agent 名を伝播する (Task 3.4 で状態反映) */
export interface AgentMappedEvent {
  readonly type: "AgentMapped";
  readonly sessionId: string;
  readonly payload: {
    readonly sessionId: string;
    readonly agentName: string;
  };
}

/** MessagePayload 型ガード: PlanBridge 専用の legacy payload か判定する */
export function isLegacyMessagePayload(
  payload: LegacyPlanBridgeMessagePayload | ObservationMessagePayload,
): payload is LegacyPlanBridgeMessagePayload {
  return "role" in payload && "content" in payload;
}

export interface PreToolUseEvent {
  readonly type: "PreToolUse";
  readonly payload: PreToolUsePayload;
  readonly sessionId: string;
  readonly callId?: string;
}

export interface PostToolUseEvent {
  readonly type: "PostToolUse";
  readonly payload: PostToolUsePayload;
  readonly sessionId: string;
  readonly callId?: string;
}

/** OmO Event のペイロード Discriminated Union */
export type EventPayload = LoopDetectorPayload | CompactionPayload | GenericEventPayload;

/** OmO loop-detector イベントのペイロード */
export interface LoopDetectorPayload {
  readonly eventType: "loop-detector";
  readonly sessionId: string;
  readonly message: string;
  readonly detectedPattern?: string;
}

/** OmO compaction イベントのペイロード */
export interface CompactionPayload {
  readonly eventType: "compaction";
  readonly sessionId: string;
  readonly reason: string;
}

/** 汎用イベントペイロード (フォールバック) */
export interface GenericEventPayload {
  readonly eventType: string;
  readonly [key: string]: unknown;
}

export interface EventEvent {
  readonly type: "Event";
  readonly payload: EventPayload;
  readonly sessionId: string;
  readonly callId?: string;
}

export type HookEventType = HookEvent["type"];

/**
 * PlanBridge の plan 参照検出だけが使う、従来の role/content payload。
 * ObservationMessagePayload と混在させず、declared Evidence の本文源にはしない。
 */
export interface LegacyPlanBridgeMessagePayload {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** @deprecated 新規コードは LegacyPlanBridgeMessagePayload を明示して利用する。 */
export type MessagePayload = LegacyPlanBridgeMessagePayload;

/** PreToolUse イベントのペイロード */
export interface PreToolUsePayload {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly callId?: string;
}

/** フックのレスポンスの Discriminated Union */
export type HookResponse = ProceedResponse | SkipResponse | InjectResponse;

export interface ProceedResponse {
  readonly action: "proceed";
  readonly modifiedPayload?: never;
  readonly injectedContext?: string;
}

export interface SkipResponse {
  readonly action: "skip";
}

export interface InjectResponse {
  readonly action: "inject";
  readonly injectedContext: string;
  readonly normalInjectedContext?: string;
  readonly gateAdvisoryContext?: string;
  readonly modifiedPayload?: unknown;
  readonly variant?: "gate_advisory";
}

/** ファイルシステムアクセスの抽象化（テスト可能にするため） */
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  listFiles(prefix: string): Promise<readonly string[]>;
  readFileStats(path: string): Promise<{ readonly size: number; readonly mtimeMs: number } | null>;
}

/** PostToolUse イベントのペイロード */
export interface PostToolUsePayload {
  readonly toolName: string;
  readonly toolResult: string;
  readonly error: boolean;
  readonly callId?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly reviewResolutionArtifact?: ReviewResolutionArtifact;
  readonly reviewSnapshotArtifact?: ReviewSnapshotArtifact;
}

export interface ReviewResolutionArtifact {
  readonly authority: "human_approved";
  readonly reviewScope: string;
  readonly itemKeys: readonly string[];
  readonly artifactRef: string;
}

export interface ReviewSnapshotArtifact {
  readonly authority: "review_tool";
  readonly schemaVersion: 1;
  readonly complete: true;
}

/** ファイル書き込みアクセスの抽象化 */
export interface FileWriter {
  /**
   * 指定されたパスにデータを書き込みます。
   * 実装側は、書き込み前に親ディレクトリが存在することを保証（必要に応じて作成）なければなりません。
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * ファイルを `from` から `to` へ atomic にリネームします。
   * 両 path とも rootDir 配下に閉じる必要があり、実装は path traversal を拒否します。
   */
  rename(from: string, to: string): Promise<void>;

  /**
   * ディレクトリを作成します。
   * @param path 作成するディレクトリのパス
   * @param recursive true の場合、親ディレクトリも作成します（原子性は保証されません）。
   *                  false の場合、単一のディレクトリを作成し、既に存在する場合はエラーを投げます。
   *                  排他制御（ロック）の実装には recursive: false を使用します。
   */
  mkdir(path: string, recursive: boolean): Promise<void>;

  /**
   * ディレクトリを削除します。
   * 対象が存在しない場合はエラーを投げずに正常終了します。
   */
  rmdir(path: string): Promise<void>;

  /**
   * 指定されたパスのファイルを削除します。
   * ベストエフォートでのクリーンアップを意図しており、対象ファイルが存在しない場合（ENOENT）はエラーを投げずに
   * 正常終了（resolved success）として扱う必要があります。
   * 実装は path traversal を拒否し、権限エラー等の致命的なエラーは再送出しなければなりません。
   */
  deleteFile(path: string): Promise<void>;

  /**
   * Creates a hard link and fails atomically when the destination exists.
   * The existing-destination error must expose `code: "EEXIST"`.
   * Implementations must reject path traversal and rethrow other filesystem errors.
   */
  link?(from: string, to: string): Promise<void>;
}

/** コンテキスト削減戦略 */
export interface ContextReduction {
  readonly strategy: "none" | "trim_reference_files" | "simplify_prompt" | "reduce_steps";
  readonly removedItems?: string[];
}

/** フィードバックアクションの Discriminated Union */
export type FeedbackAction = SuccessAction | RetryAction | EscalateAction;

export interface SuccessAction {
  readonly type: "success";
  readonly taskId: string;
}

export interface RetryAction {
  readonly type: "retry";
  readonly taskId: string;
  readonly errorClass: ErrorClass;
  readonly retryCount: number;
  readonly delayMs: number;
  readonly contextReduction: ContextReduction;
}

export interface EscalateAction {
  readonly type: "escalate";
  readonly taskId: string;
  readonly errorClass: ErrorClass;
  readonly message: string;
}

/** 学習エントリ (Phase 5) */
export interface WisdomEntry {
  readonly id: string;
  readonly taskId: string;
  readonly persona: AgentId;
  readonly category: WisdomCategory;
  readonly content: string;
  readonly errorClass?: ErrorClass;
  readonly timestamp: string;
  readonly hitCount?: number;
  readonly lastHitAt?: string;
  readonly firstSeenAt?: string;
}

export type WisdomEntryInput = Omit<WisdomEntry, "id" | "timestamp" | "persona"> & {
  readonly persona?: AgentId;
};

export interface AddOptions {
  readonly scope?: WisdomScope;
  readonly persona?: AgentId;
}

export type WisdomCategory =
  | "success_pattern" // 成功した実装パターン
  | "failure_gotcha" // 失敗時の落とし穴
  | "design_decision" // 重要な設計判断
  | "environment_quirk"; // 環境固有の注意事項

/** Wisdom の適用範囲 */
export type WisdomScope = "local" | "global";

/**
 * WisdomStore のインターフェース。
 * ローカルストアと階層化ストアの両方で共通の操作を定義します。
 */
export interface WisdomStoreInterface {
  add(entry: WisdomEntryInput, options?: AddOptions): WisdomEntry;
  getByTaskId(taskId: string): readonly WisdomEntry[];
  getRelevant(options?: {
    errorClass?: ErrorClass;
    maxEntries?: number;
    persona?: AgentId;
  }): readonly WisdomEntry[];
  formatForInjection(entries: readonly WisdomEntry[]): string;
  recordHit?(entryId: string, now?: Date, taskId?: string): WisdomEntry | undefined;
}
