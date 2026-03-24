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
  | EventEvent;

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
  readonly payload: unknown; // 必要に応じて具体的な型を定義
  readonly sessionId: string;
}

export interface EventEvent {
  readonly type: "Event";
  readonly payload: unknown;
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
export type HookResponse =
  | ProceedResponse
  | SkipResponse
  | InjectResponse;

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
