# Justice マルチエージェント・レビュー設計書 (v2026.04.28)

## 0. メタ情報

| 項目 | 値 |
|------|-----|
| 作成日 | 2026-04-28 |
| 対象バージョン | Justice v2026.03.25 拡張 |
| 想定ロール | Justice Core Maintainer (Senior Engineer) |
| 対象ブランチ | `master` を起点とする `feature/justice-review-*` |
| 関連スキル | `superpowers/brainstorming`（本書作成）→ `superpowers/writing-plans`（次工程） |
| 前提設計書 | `2026-04-26-justice-expansion-design.md`（Phase 1〜4） |

## 1. 目的とスコープ

タスク完了時に複数ペルソナのエージェントが自動で並列レビューを行い、最高精度モデル（prometheus）がその結果を統合・検証してフィードバックを返す **非同期レビューパイプライン** を実装する。

### スコープ内

- `ReviewPipeline` の 3 ステージ（Focus Analysis → Parallel Review → Defense & Consolidation）
- `PlanParser` の `(type: review)` メタデータ拡張
- `PlanBridge` のレビュータスク検出・ルーティング
- `OmoRuntimeAdapter` 抽象インターフェースと DI
- `ProgressReporter` のレビューフェーズ表示拡張
- `.justice/reviews/` への監査ログ永続化
- `WisdomStore` への学習フィードバック

### スコープ外

- `/review [path]` コマンドによる手動実行（将来 PR で対応）
- `OmoRuntimeAdapter` の本番 SDK 実装（PR5 で対応）

## 2. 設計原則と制約

`AGENTS.md` の制約に加え、以下を厳守する。

1. **Pure Core**: `src/core/review/` 配下は OmO 依存ゼロ。`OmoRuntimeAdapter` インターフェースへの依存のみ。
2. **Hook-First**: Hook 層（`PlanBridge`）は即座に `HookResponse` を返し、`ReviewPipeline` は fire-and-forget でバックグラウンド実行。
3. **Fail-Open**: パイプライン内の全例外は `try/catch` で握り、OmO のメインフローを阻害しない。
4. **Graceful Degradation**: `OmoRuntimeAdapter` 未注入時はレビュー機能全体がスキップ。個別ステージの失敗は部分結果で続行。
5. **SSoT**: レビュータスクは `plan.md` に明示的に記述。暗黙的な自動起動は行わない。
6. **readonly**: 全 type は `readonly` 修飾子を維持。
7. **Devcontainer**: テスト・型検査・リンタは `.devcontainer` 内で実行可能な設計。

## 3. アーキテクチャ概観

### 3.1 新規モジュール

```text
src/core/review/
├── review-types.ts             ← 型定義 + OmoRuntimeAdapter インターフェース
├── review-pipeline.ts          ← オーケストレータ（Step 1→2→3 制御フロー）
├── focus-analyzer.ts           ← Step 1: atlas によるペルソナ動的生成
├── parallel-reviewer.ts        ← Step 2: N 並列レビュー実行
├── defense-consolidator.ts     ← Step 3: prometheus による統合検証
└── review-audit-logger.ts      ← 監査ログ永続化
```

### 3.2 既存モジュール変更（破壊的変更なし）

| ファイル | 変更内容 |
|---------|---------|
| `src/core/types.ts` | `PlanTask` に `type?: PlanTaskType` を optional 追加 |
| `src/core/plan-parser.ts` | `(type: review)` メタデータのパース + `parseTaskMetadata()` 追加 |
| `src/core/plan-bridge-core.ts` | `detectReviewTask()` メソッド追加 |
| `src/hooks/plan-bridge.ts` | `ReviewPipeline` の DI 受け入れ + レビュールーティング |
| `src/core/justice-plugin.ts` | `omoAdapter` オプション追加 + ReviewPipeline 配線 |
| `src/core/progress-reporter.ts` | `formatReviewPhase()` / `formatReviewResult()` 追加 |

### 3.3 データ永続化レイアウト

```text
.justice/                              # project-local
├── wisdom.json                        # 既存
├── reviews/                           # 新規
│   ├── task-2-20260428T103000Z.json   # レビュー結果（全指摘 + 監査ログ）
│   └── task-5-20260428T150000Z.json
└── telemetry.json                     # Phase 3 拡張（既存設計書）
```

## 4. 型定義（`src/core/review/review-types.ts`）

### 4.1 OmoRuntimeAdapter

```typescript
/** OmO ランタイムへの抽象アクセスインターフェース。
 *  本番: SDK コールバック注入 / テスト: MockAdapter */
export interface OmoRuntimeAdapter {
  executeTask(request: AgentTaskRequest): Promise<AgentTaskResult>;
}

export interface AgentTaskRequest {
  readonly agentId: AgentId;
  readonly prompt: string;
  readonly category: TaskCategory;
  readonly sessionId: string;
  readonly timeoutMs?: number;
  readonly loadSkills?: readonly string[];
}

export interface AgentTaskResult {
  readonly status: "success" | "failure" | "timeout";
  readonly output: string;
  readonly durationMs: number;
  readonly error?: string;
}
```

### 4.2 レビューペルソナ（Step 1 出力）

```typescript
export interface ReviewPersona {
  readonly id: string;           // "persona-security-1"
  readonly name: string;         // "Security"
  readonly focus: string;        // "認証周りの脆弱性チェック"
}

export interface FocusAnalysisResult {
  readonly personas: readonly ReviewPersona[];
  readonly diffSummary: string;
  readonly analysisDurationMs: number;
}

export interface FocusAnalysisContext {
  readonly reviewTaskId: string;
  readonly targetTaskId: string;
  readonly targetTaskTitle: string;
  readonly planFilePath: string;
  readonly sessionId: string;
}
```

### 4.3 レビュー指摘（Step 2 出力）

```typescript
export interface ReviewFinding {
  readonly id: string;
  readonly personaId: string;
  readonly severity: "critical" | "warning" | "info";
  readonly filePath?: string;
  readonly lineRange?: { readonly start: number; readonly end: number };
  readonly description: string;
  readonly suggestion?: string;
}

export interface ReviewerResult {
  readonly personaId: string;
  readonly personaName: string;
  readonly status: "success" | "failure" | "timeout";
  readonly findings: readonly ReviewFinding[];
  readonly rawOutput: string;
  readonly durationMs: number;
  readonly retried: boolean;
}

export interface ParallelReviewContext {
  readonly reviewTaskId: string;
  readonly targetTaskId: string;
  readonly targetTaskTitle: string;
  readonly planFilePath: string;
  readonly sessionId: string;
}

export interface ParallelReviewResult {
  readonly results: readonly ReviewerResult[];
  readonly status: "all_success" | "partial" | "all_failed";
  readonly retriedPersonas: readonly string[];
}
```

### 4.4 統合検証結果（Step 3 出力）

```typescript
export interface ConsolidatedFinding {
  readonly id: string;
  readonly originalFindingId: string;
  readonly personaId: string;
  readonly verdict: "accepted" | "rejected";
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
  readonly description: string;
  readonly filePath?: string;
  readonly lineRange?: { readonly start: number; readonly end: number };
  readonly suggestion?: string;
  readonly rejectionReason?: string;
}

export interface ConsolidationContext {
  readonly reviewTaskId: string;
  readonly targetTaskId: string;
  readonly planFilePath: string;
  readonly sessionId: string;
  readonly personas: readonly ReviewPersona[];
}

export interface ConsolidationResult {
  readonly findings: readonly ConsolidatedFinding[];
  readonly durationMs: number;
}
```

### 4.5 パイプライン結果

```typescript
export interface ReviewResult {
  readonly sessionId: string;
  readonly reviewTaskId: string;
  readonly targetTaskId: string;
  readonly personas: readonly ReviewPersona[];
  readonly reviewerResults: readonly ReviewerResult[];
  readonly consolidatedFindings: readonly ConsolidatedFinding[];
  readonly summary: ReviewSummary;
  readonly pipelineStatus: "completed" | "partial" | "aborted";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface ReviewSummary {
  readonly totalFindings: number;
  readonly acceptedFindings: number;
  readonly rejectedFindings: number;
  readonly highConfidence: number;
  readonly mediumConfidence: number;
  readonly lowConfidence: number;
}

export type ReviewPhase =
  | "focus_analysis"
  | "parallel_review"
  | "defense_consolidation"
  | "completed"
  | "aborted";

export interface ReviewPipelineConfig {
  readonly reviewTaskId: string;
  readonly targetTaskId: string;
  readonly targetTaskTitle: string;
  readonly planFilePath: string;
  readonly sessionId: string;
}
```

### 4.6 PlanTask 拡張

```typescript
// src/core/types.ts への追加
export type PlanTaskType = "review" | string;

// 既存 PlanTask への optional 拡張（後方互換）
export interface PlanTask {
  readonly id: string;
  readonly title: string;
  readonly steps: PlanStep[];
  readonly status: PlanTaskStatus;
  readonly type?: PlanTaskType;  // 新規
}
```

## 5. パイプラインステージ詳細

### 5.1 Step 1: FocusAnalyzer（観点抽出）

**担当エージェント**: `atlas`（軽量タスク）

**処理フロー**:

1. `buildAtlasPrompt()` で圧縮コンテキストを構築
   - plan.md のタスク文脈（対象タスクのタイトル・ステップ）
   - 「git diff --stat を自身で取得せよ」という自律指示
   - 出力形式指定（JSON 配列）
2. `OmoRuntimeAdapter.executeTask()` で atlas を起動
3. `parsePersonas()` で JSON 出力をパース → `ReviewPersona[]`

**フォールバック**: atlas の応答が不正 JSON / タイムアウトの場合、デフォルトペルソナ（`CodeQuality` + `Security`）を返す。パイプラインは中断しない。

**atlas 向けプロンプト構造**:

```text
あなたは変更分析の専門家です。
以下のタスクで行われた変更を分析し、最適なレビュー観点を提案してください。

【対象タスク】
- ID: {targetTaskId}
- タイトル: {targetTaskTitle}
- Plan: {planFilePath}

【手順】
1. git diff --stat で変更ファイル一覧を取得
2. 主要な変更ファイルの diff を確認
3. 変更のセマンティクスに基づき 2〜4 つのレビュアーペルソナを提案

【出力形式】JSON 配列:
[{ "name": "Security", "focus": "認証周りの脆弱性" }, ...]
```

### 5.2 Step 2: ParallelReviewer（並列レビュー実行）

**担当エージェント**: `hephaestus` または `sisyphus`（AgentRouter に委譲可能）

**処理フロー**:

1. 各ペルソナに対して `buildReviewerPrompt()` でプロンプトを動的生成
2. `Promise.allSettled()` で N 並列起動
3. 失敗（`status: "failure"` / `"timeout"`）したペルソナのみ `SmartRetryPolicy` 準拠で 1 回リトライ
4. `parseFindings()` で各レビュアーの出力を `ReviewFinding[]` にパース
5. 結果を `ParallelReviewResult` に集約

**制約注入**:

```text
あなたは「{persona.name}」の専門レビュアーです。
観点: {persona.focus}

【制約】
- あなたの専門領域（{persona.name}）以外の指摘は行わないでください
- 指摘は最大 5 件までに絞ってください
- 各指摘は以下の JSON 形式で出力してください
- 対象ファイルを実際に読み、変更の diff と照合してください

【出力形式】JSON 配列:
[{
  "severity": "critical|warning|info",
  "filePath": "src/...",
  "lineRange": { "start": 10, "end": 15 },
  "description": "...",
  "suggestion": "..."
}]
```

**エラー戦略（E2+E3 ハイブリッド）**:

- 個別失敗: 1 回リトライ → 失敗なら当該ペルソナを除外して続行
- 全員失敗: `status: "all_failed"` → パイプライン中断

### 5.3 Step 3: DefenseConsolidator（ディフェンスと集約）

**担当エージェント**: `prometheus`（最高精度モデル）

**処理フロー**:

1. 全ペルソナの指摘を `buildPrometheusPrompt()` で統合
2. `OmoRuntimeAdapter.executeTask()` で prometheus を起動
3. prometheus が OmO ツールで実ソースファイル・diff を自律的に照合
4. `parseConsolidation()` で判定結果をパース → `ConsolidatedFinding[]`

**検証コンテキスト（V3: フルコンテキスト）**: prometheus は OmO の `task()` 経由で起動されるため、ファイル読み取り・git 操作等のネイティブツールにフルアクセスできる。指摘事項 + diff + 該当ソースをすべて検証可能。

**prometheus 向けプロンプト構造**:

```text
あなたは最高精度のコードレビュー検証者です。
複数の専門レビュアーが以下の指摘を行いました。
各指摘を実際のソースコードと Git diff と照合し、妥当性を検証してください。

【全指摘事項】
{JSON形式の全findings}

【手順】
1. 各指摘の filePath を実際に読み込む
2. git diff で変更前後を確認
3. 指摘が妥当か判定し、信頼度（HIGH/MEDIUM/LOW）を付与
4. 却下する場合は理由を明記

【出力形式】JSON 配列:
[{
  "originalFindingId": "...",
  "verdict": "accepted|rejected",
  "confidence": "HIGH|MEDIUM|LOW",
  "rejectionReason": "..."  // rejected 時のみ
}]
```

**フォールバック**: prometheus がタイムアウト/パース失敗の場合、全指摘を信頼度 `MEDIUM` で一律採用する。

## 6. ReviewPipeline オーケストレータ

### 6.1 API

```typescript
export interface ReviewPipelineDeps {
  readonly focusAnalyzer: FocusAnalyzer;
  readonly parallelReviewer: ParallelReviewer;
  readonly defenseConsolidator: DefenseConsolidator;
  readonly auditLogger: ReviewAuditLogger;
  readonly onPhaseChange?: (phase: ReviewPhase, detail: string) => void;
}

export class ReviewPipeline {
  constructor(private readonly deps: ReviewPipelineDeps) {}
  async execute(config: ReviewPipelineConfig): Promise<ReviewResult>;
}
```

### 6.2 実行フロー

1. `onPhaseChange("focus_analysis", ...)` を発火
2. `FocusAnalyzer.analyze()` → ペルソナ取得（2〜4 件）
3. `onPhaseChange("parallel_review", "N名の専門家が並列レビュー中...")` を発火
4. `ParallelReviewer.executeAll()` → 並列レビュー
5. `all_failed` の場合 → `onPhaseChange("aborted", ...)` → plan.md エラーノート → 中断結果を返す
6. `onPhaseChange("defense_consolidation", ...)` を発火
7. `DefenseConsolidator.consolidate()` → 検証
8. `ReviewAuditLogger.log()` → 監査ログ永続化（全指摘＋却下理由）
9. plan.md に HIGH/MEDIUM の採用指摘を追記
10. WisdomStore に学習エントリを蓄積
11. `onPhaseChange("completed", ...)` を発火
12. `ReviewResult` を返す

### 6.3 Fail-Open 保証

```typescript
async execute(config: ReviewPipelineConfig): Promise<ReviewResult> {
  const startedAt = new Date();
  try {
    // Step 1〜3 + 後処理
  } catch (err) {
    console.warn(`[JUSTICE] ReviewPipeline unexpected error: ${String(err)}`);
    return this.buildAbortedResult(config, startedAt, String(err));
  }
}
```

パイプライン全体のキャッチオールにより、いかなる例外も外部に伝播しない。

## 7. Hook 統合

### 7.1 PlanParser 拡張

`(type: review)` を `(depends: task-N)` と同じ括弧記法でパースする。

```typescript
// src/core/plan-parser.ts
export class PlanParser {
  /**
   * タスクヘッダからメタデータを抽出する純粋関数。
   * 例: "レビュー (depends: task-1, type: review)"
   *   → { depends: ["task-1"], type: "review" }
   */
  parseTaskMetadata(header: string): TaskMetadata;
}

interface TaskMetadata {
  readonly depends?: readonly string[];
  readonly type?: PlanTaskType;
}
```

**後方互換**: `type` は optional。未指定タスクは `type: undefined`。既存テスト無変更で通過。

### 7.2 PlanBridgeCore 拡張

```typescript
// src/core/plan-bridge-core.ts
export interface ReviewTaskDetection {
  readonly reviewTaskId: string;
  readonly reviewTaskTitle: string;
  readonly targetTaskId: string;
  readonly targetTaskTitle: string;
  readonly planFilePath: string;
}

export class PlanBridgeCore {
  /**
   * 次の実行可能タスクがレビュータスクかどうかを判定。
   * type: "review" かつ依存元が完了済みのタスクを検出。
   * depends 先を resolveReviewTarget() でレビュー対象として解決。
   */
  detectReviewTask(
    planContent: string,
    planFilePath: string,
  ): ReviewTaskDetection | null;

  private resolveReviewTarget(
    reviewTask: PlanTask,
    allTasks: PlanTask[],
  ): string | null;
}
```

### 7.3 PlanBridge ルーティング

```typescript
// src/hooks/plan-bridge.ts
export class PlanBridge {
  private readonly reviewPipeline: ReviewPipeline | null;

  constructor(
    fileReader: FileReader,
    loopHandlerOrWisdomStore?: LoopDetectionHandler | WisdomStoreInterface,
    wisdomStore?: WisdomStoreInterface,
    reviewPipeline?: ReviewPipeline,  // 新規（optional、後方互換）
  ) { /* ... */ }

  /**
   * ルーティングロジック:
   *   1. core.detectReviewTask() を先に呼ぶ
   *   2. レビュータスク検出 → ReviewPipeline.execute() を fire-and-forget
   *      → 「レビュー開始」inject を返す → Hook は即座に制御を返す
   *   3. 通常タスク → 既存の buildDelegationFromPlan() 委譲
   */
}
```

**fire-and-forget パターン**:

```typescript
void this.reviewPipeline.execute(config).catch((err) => {
  console.warn(`[JUSTICE] ReviewPipeline failed: ${String(err)}`);
});

return {
  action: "inject",
  injectedContext: `[JUSTICE: レビューパイプラインを開始しました]`,
};
```

### 7.4 JusticePlugin 配線

```typescript
// src/core/justice-plugin.ts
export interface JusticePluginOptions {
  // 既存 ...
  readonly omoAdapter?: OmoRuntimeAdapter;  // 新規
}
```

`omoAdapter` 注入時のみ `ReviewPipeline` を組み立て、`PlanBridge` に注入。未注入時は `null`（既存機能に影響なし）。

## 8. UX / フィードバック

### 8.1 ProgressReporter 拡張

```typescript
// src/core/progress-reporter.ts への追加
export class ProgressReporter {
  formatReviewPhase(phase: ReviewPhase, detail: string): string {
    switch (phase) {
      case "focus_analysis":        return `🔍 変更内容を分析中... ${detail}`;
      case "parallel_review":       return `👥 ${detail}`;
      case "defense_consolidation": return `⚖️ Prometheus が検証中...`;
      case "completed":             return `✅ レビュー完了: ${detail}`;
      case "aborted":               return `❌ レビュー中断: ${detail}`;
    }
  }

  /**
   * 最終結果表示。信頼度 HIGH/MEDIUM の採用指摘のみ表示（ノイズ隠蔽）。
   */
  formatReviewResult(result: ReviewResult): string;
}
```

### 8.2 plan.md への結果追記

採用された HIGH/MEDIUM 指摘をレビュータスクのセクション末尾に追記。既存の `PlanParser.appendErrorNote()` パターンを再利用。

```markdown
## task-2: 認証モジュールのレビュー (depends: task-1, type: review)
- [x] Step 1: 自動レビュー実行
> **[JUSTICE Review]** 2 件の指摘:
>   - 🔴 SQL インジェクションの可能性 (src/auth/login.ts)
>   - 🟡 パスワードハッシュのソルト長が不十分 (src/auth/hash.ts)
```

## 9. 監査ログと学習ループ

### 9.1 ReviewAuditLogger

```typescript
// src/core/review/review-audit-logger.ts
export class ReviewAuditLogger {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
  ) {}

  /**
   * .justice/reviews/{reviewTaskId}-{timestamp}.json に永続化。
   * 全指摘（採用・却下の両方）+ 却下理由 + raw output + メタデータ。
   * temp + rename の atomic write。失敗時は console.warn で fail-open。
   */
  async log(result: ReviewResult): Promise<void>;
  async loadAll(): Promise<readonly ReviewResult[]>;
}
```

**スキーマ**:

```typescript
interface ReviewAuditFile {
  readonly version: 1;
  readonly result: ReviewResult;
}
```

### 9.2 WisdomStore 連携

レビュー結果から `WisdomEntry` を抽出して蓄積。

| 条件 | WisdomCategory | 内容 |
|------|---------------|------|
| HIGH 信頼度で採用された指摘 | `failure_gotcha` | 指摘内容を記録 |
| 全指摘が却下（クリーンなコード） | `success_pattern` | タスクがレビューを通過した記録 |

却下された指摘は WisdomStore には書き込まない（監査ログのみ）。

## 10. エラーハンドリング全体方針

| 障害シナリオ | 対応 | pipelineStatus |
|------------|------|---------------|
| atlas タイムアウト/パース失敗 | デフォルトペルソナで続行 | `partial` |
| 個別レビュアー失敗 | 1 回リトライ → 失敗なら除外して続行 | `partial` |
| 全レビュアー失敗 | パイプライン中断 + plan.md エラーノート | `aborted` |
| prometheus タイムアウト/パース失敗 | 全指摘を MEDIUM で一律採用 | `partial` |
| plan.md 書き込み失敗 | `console.warn` のみ | 続行 |
| 監査ログ書き込み失敗 | `console.warn` のみ | 続行 |
| `OmoRuntimeAdapter` 未注入 | レビュー機能全体スキップ | N/A |

## 11. テスト戦略

### 11.1 新規テストファイル

```text
tests/core/review/
├── focus-analyzer.test.ts
├── parallel-reviewer.test.ts
├── defense-consolidator.test.ts
├── review-pipeline.test.ts
├── review-audit-logger.test.ts
└── review-types.test.ts
tests/core/
├── plan-parser-metadata.test.ts
tests/hooks/
├── plan-bridge-review.test.ts
tests/integration/
├── review-pipeline-flow.test.ts
```

### 11.2 既存テスト修正点

| テスト | 修正範囲 |
|--------|---------|
| `plan-parser.test.ts` | `(type: review)` パースのケース追加 |
| `plan-bridge-core.test.ts` | `detectReviewTask()` テスト追加 |
| `plan-bridge.test.ts` | `reviewPipeline` 注入時のルーティング分岐追加 |
| `justice-plugin.test.ts` | `omoAdapter` 注入時の配線テスト追加 |
| `progress-reporter.test.ts` | `formatReviewPhase()` / `formatReviewResult()` 追加 |

### 11.3 Mock パターン

```typescript
// tests/helpers/mock-omo-adapter.ts（新規）
export function createMockOmoAdapter(
  responses?: Map<AgentId, AgentTaskResult>,
): OmoRuntimeAdapter;

export function createSequentialMockAdapter(
  sequence: AgentTaskResult[],
): OmoRuntimeAdapter;
```

### 11.4 主要テストシナリオ

**focus-analyzer.test.ts**: (1) 正常パース (2) 不正JSON→フォールバック (3) タイムアウト→フォールバック (4) プロンプト構築検証

**parallel-reviewer.test.ts**: (1) 全員成功 (2) 1名失敗+リトライ成功 (3) 1名失敗+リトライ失敗→partial (4) 全員失敗 (5) 制約注入検証

**review-pipeline.test.ts**: (1) 正常フロー (2) 全員失敗→中断 (3) prometheus失敗→MEDIUM一律採用 (4) フェーズ遷移順序 (5) fail-open保証

**plan-bridge-review.test.ts**: (1) type:review検出→fire-and-forget (2) pipeline null→通常委譲 (3) 通常タスクとレビュータスクの混在

### 11.5 Devcontainer 内テスト実行

```bash
bun run test                     # 全テスト
bun run test -- --filter review  # レビュー関連のみ
bun run typecheck                # 型チェック
bun run lint                     # リント
bun run format                   # フォーマット
# PR 完了条件:
bun run test && bun run typecheck && bun run lint
```

## 12. 段階的 PR 分割計画

| PR | 範囲 | 完了条件 |
|----|------|---------|
| PR1 | `review-types.ts` + `OmoRuntimeAdapter` + `PlanTask.type` 拡張 + `PlanParser` メタデータパース | 既存テスト全通過 + パーサーテスト |
| PR2 | `FocusAnalyzer` + `ParallelReviewer` + `DefenseConsolidator` + Mock adapter | 各ステージ単体テスト通過 |
| PR3 | `ReviewPipeline` + `ReviewAuditLogger` + 統合テスト | パイプライン統合テスト + fail-open テスト |
| PR4 | `PlanBridge` ルーティング + `JusticePlugin` 配線 + `ProgressReporter` 拡張 | Hook 統合テスト + 既存全テスト通過 |
| PR5 | `OpenCodeAdapter` への `OmoRuntimeAdapter` SDK 実装注入 | E2E 動作確認 |

各 PR は独立してマージ可能。`bun run test && bun run typecheck && bun run lint` のグリーンを完了条件。

## 13. 受入基準（Acceptance Criteria）

| ID | 基準 |
|----|------|
| AC-1 | `plan.md` に `(type: review, depends: task-N)` を記述すると、依存元タスク完了後にレビューパイプラインが自動発火する |
| AC-2 | atlas が変更のセマンティクスから 2〜4 つのペルソナを動的生成する |
| AC-3 | 各ペルソナが `Promise.allSettled()` で N 並列実行される |
| AC-4 | 失敗ペルソナは 1 回リトライされ、全員失敗時のみパイプラインが中断する |
| AC-5 | prometheus が全指摘を実コード・diff と照合し、採用/却下 + 信頼度を付与する |
| AC-6 | 信頼度 HIGH/MEDIUM の採用指摘のみが plan.md に追記・ターミナル表示される |
| AC-7 | 却下された指摘は `.justice/reviews/` に JSON で永続化され、却下理由が記録される |
| AC-8 | `OmoRuntimeAdapter` 未注入時、レビュー機能全体がスキップされ既存機能に影響しない |
| AC-9 | パイプライン内の全例外が `try/catch` で握られ、OmO メインフローを阻害しない |
| AC-10 | 既存テスト（plan-parser / plan-bridge / justice-plugin / progress-reporter 等）が無変更で通過する |
| AC-11 | 全新規テストが `.devcontainer` 内で `bun run test` で実行可能 |

## 14. 用語集

| 用語 | 定義 |
|------|------|
| ReviewPipeline | 3 ステージ（Focus Analysis → Parallel Review → Defense & Consolidation）の非同期レビューオーケストレータ |
| FocusAnalyzer | atlas を起動し、変更のセマンティクスから 2〜4 つのレビュアーペルソナを動的生成するステージ |
| ParallelReviewer | 各ペルソナをエージェントとして N 並列実行し、指摘事項を収集するステージ |
| DefenseConsolidator | prometheus を起動し、全指摘を実コード・diff と照合して採用/却下を判定するステージ |
| OmoRuntimeAdapter | OmO ランタイムの `task()` 相当を抽象化したインターフェース。Pure Core と OmO 実装の結合点 |
| ReviewPersona | レビュー観点を表す構造体（名前・専門領域・フォーカスポイント） |
| ConsolidatedFinding | prometheus による検証済みの最終指摘。verdict（採用/却下）と confidence（信頼度）を持つ |
| fire-and-forget | Hook が `HookResponse` を返した後、バックグラウンドで非同期に実行するパターン |
| Graceful Degradation | 部分的な障害時に可能な範囲で処理を続行する設計方針 |
| PlanTaskType | plan.md のタスクヘッダに `(type: review)` 等で付与されるメタデータ |
