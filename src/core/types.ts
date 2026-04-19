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
}

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
export type HookEvent = MessageEvent | PreToolUseEvent | PostToolUseEvent | EventEvent;

export interface MessageEvent {
  readonly type: "Message";
  readonly payload: MessagePayload;
  readonly sessionId: string;
}

export interface PreToolUseEvent {
  readonly type: "PreToolUse";
  readonly payload: PreToolUsePayload;
  readonly sessionId: string;
}

export interface PostToolUseEvent {
  readonly type: "PostToolUse";
  readonly payload: PostToolUsePayload;
  readonly sessionId: string;
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
}

export type HookEventType = HookEvent["type"];

/** Message イベントのペイロード */
export interface MessagePayload {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** PreToolUse イベントのペイロード */
export interface PreToolUsePayload {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
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
  readonly modifiedPayload?: unknown;
}

/** ファイルシステムアクセスの抽象化（テスト可能にするため） */
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
}

/** PostToolUse イベントのペイロード */
export interface PostToolUsePayload {
  readonly toolName: string;
  readonly toolResult: string;
  readonly error: boolean;
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
   * 指定されたパスのファイルを削除します。
   * ベストエフォートでのクリーンアップを意図しており、対象ファイルが存在しない場合（ENOENT）はエラーを投げずに
   * 正常終了（resolved success）として扱う必要があります。
   * 実装は path traversal を拒否し、権限エラー等の致命的なエラーは再送出しなければなりません。
   */
  deleteFile(path: string): Promise<void>;
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
  readonly category: WisdomCategory;
  readonly content: string;
  readonly errorClass?: ErrorClass;
  readonly timestamp: string;
}

export type WisdomCategory =
  | "success_pattern" // 成功した実装パターン
  | "failure_gotcha" // 失敗時の落とし穴
  | "design_decision" // 重要な設計判断
  | "environment_quirk"; // 環境固有の注意事項
