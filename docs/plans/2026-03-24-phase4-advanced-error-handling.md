# Phase 4: Advanced Error Handling — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** OmO の loop-detector イベント統合、指数バックオフ付きスマートリトライ、
コンテキスト縮小リトライ、失敗タスクの自動分割指示生成を実装する。

**Architecture:** Hook-first + Pure core logic 分離を継続。Phase 3 までの
ErrorClassifier・TaskFeedbackHandler・CompactionProtector を拡張・連携する。

**Tech Stack:** TypeScript, Vitest, bun

**Dependencies:** Phase 3 がマージ済み。103 テストすべてパス（※ master に typecheck
警告 2 件あり: `PostToolUsePayload` 未使用 import / `_exhaustiveCheck` 未読取り —
Task 1 で修正）。

---

## 現在の実装状態

### ソースファイル構成 (10 ファイル)

```text
src/
├── core/
│   ├── types.ts              (209行) — 全型定義
│   ├── plan-parser.ts         (153行) — plan.md パース・チェックボックス操作
│   ├── task-packager.ts       (106行) — PlanTask → DelegationRequest 変換
│   ├── error-classifier.ts    (110行) — エラー分類・リトライ判定
│   ├── feedback-formatter.ts  (113行) — task()出力をTaskFeedbackに構造化
│   ├── plan-bridge-core.ts     (50行) — plan解析→委譲リクエスト生成
│   └── trigger-detector.ts     (83行) — plan参照・委譲意図検出
├── hooks/
│   ├── compaction-protector.ts (108行) — コンパクション保護
│   ├── plan-bridge.ts         (182行) — Message/PreToolUse フック
│   └── task-feedback.ts       (243行) — PostToolUse フィードバック
└── index.ts                    (25行) — エクスポート
```

### テスト構成 (16 ファイル / 103+ テスト)

```text
tests/
├── core/         — 7 test files (error-classifier, feedback-formatter, plan-bridge-core,
│                    plan-parser, task-packager, trigger-detector, types)
├── hooks/        — 3 test files (compaction-protector, plan-bridge, task-feedback)
├── helpers/      — mock-file-system.ts (共有モックファクトリ)
├── integration/  — 2 test files (plan-bridge-flow, feedback-flow)
└── fixtures/     — 3 markdown files
```

### Phase 3 レビュー指摘対応で改善された点

| 改善項目 | 変更内容 |
|---------|---------|
| セッション管理 | TTL (30分) + LRU キャップ (50) による自動 cleanup |
| リトライカウント追跡 | `executeAction` 内で retry count を increment に移動 |
| Exhaustive check | `default: never` パターンで FeedbackAction の網羅性を保証 |
| compaction_risk 分岐 | 専用ブランチを `determineAction` に追加 |
| エラーログ | fail-open 時に `console.warn` で構造化ログ出力 |
| テストヘルパー | `tests/helpers/mock-file-system.ts` に共通モックを抽出 |
| 統合テスト | `DEFAULT_RETRY_POLICY.maxRetries` を参照してマジックナンバー排除 |

### 未解決の typecheck 警告 (master)

```text
src/hooks/task-feedback.ts:6   — 'PostToolUsePayload' is declared but never used
src/hooks/task-feedback.ts:156 — '_exhaustiveCheck' is declared but never read
```

→ Task 1 の前処理として修正する。

---

## Task 1: 前処理 — typecheck 修正 + EventPayload 型の具象化

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/hooks/task-feedback.ts`
- Modify: `tests/core/types.test.ts`

### Step 1: typecheck 警告の修正

`src/hooks/task-feedback.ts` の未使用 import `PostToolUsePayload` を削除し、
`_exhaustiveCheck` を void キャストで消す:

```typescript
// Line 6: PostToolUsePayload import を削除
import type {
  FileReader,
  FileWriter,
  HookEvent,
  HookResponse,
  FeedbackAction,
} from "../core/types";

// Line 155-158: exhaustive check を void キャストに変更
default: {
  const _exhaustiveCheck: never = action;
  void _exhaustiveCheck;
  return PROCEED;
}
```

### Step 2: EventPayload 型の具象化

`EventEvent.payload` を `unknown` から具象的な Discriminated Union に変更:

```typescript
// src/core/types.ts

/** OmO Event のペイロード Discriminated Union */
export type EventPayload =
  | LoopDetectorPayload
  | CompactionPayload
  | GenericEventPayload;

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
```

### Step 3: テスト追記

```typescript
// tests/core/types.test.ts — 追加分
describe("Phase 4 types", () => {
  it("should accept LoopDetectorPayload", () => {
    const payload: LoopDetectorPayload = {
      eventType: "loop-detector",
      sessionId: "s-1",
      message: "Same edit applied 3 times",
    };
    expect(payload.eventType).toBe("loop-detector");
  });

  it("should accept CompactionPayload", () => {
    const payload: CompactionPayload = {
      eventType: "compaction",
      sessionId: "s-2",
      reason: "context window limit reached",
    };
    expect(payload.eventType).toBe("compaction");
  });
});
```

### Step 4: 検証

```bash
bun run typecheck && bun run lint && bun run test
```

### Step 5: コミット

```bash
git commit -am "fix(types): typecheck警告修正 + EventPayload型を具象化"
```

---

## Task 2: TaskSplitter — 失敗タスクの自動分割指示生成

**Files:**

- Create: `src/core/task-splitter.ts`
- Create: `tests/core/task-splitter.test.ts`

### 設計

TaskSplitter は失敗・タイムアウトしたタスクを分析し、サブタスク分割案を生成する
純粋な core ロジッククラス。

```typescript
// src/core/task-splitter.ts
export interface SplitSuggestion {
  readonly originalTaskId: string;
  readonly suggestedSubTasks: SubTaskSuggestion[];
  readonly rationale: string;
}

export interface SubTaskSuggestion {
  readonly title: string;
  readonly steps: string[];
  readonly estimatedComplexity: "quick" | "deep";
}
```

### 分割ロジック

1. **ステップ数ベース**: 4+ ステップ → 2 つのサブタスクに分割
2. **エラータイプベース**:
   - `timeout` → 「実装」と「テスト」に分割
   - `design_error` → 「設計見直し」と「再実装」に分割
   - `loop_detected` → 各ステップを個別タスクに展開
3. **フォーマット出力**: plan.md に追記可能な Markdown 形式の分割案を生成

### Step 1: テスト作成

```typescript
describe("TaskSplitter", () => {
  const splitter = new TaskSplitter();

  describe("suggestSplit", () => {
    it("should split a task with 4+ steps into two sub-tasks", () => {
      const task: PlanTask = {
        id: "task-1",
        title: "Implement feature",
        status: "failed",
        steps: [
          { id: "s1", description: "Setup", checked: false, lineNumber: 1 },
          { id: "s2", description: "Core logic", checked: false, lineNumber: 2 },
          { id: "s3", description: "Tests", checked: false, lineNumber: 3 },
          { id: "s4", description: "Integration", checked: false, lineNumber: 4 },
        ],
      };
      const suggestion = splitter.suggestSplit(task, "timeout");
      expect(suggestion.suggestedSubTasks.length).toBeGreaterThanOrEqual(2);
    });

    it("should split timeout errors into implementation and testing", () => {
      const task: PlanTask = {
        id: "task-2",
        title: "Build module",
        status: "failed",
        steps: [
          { id: "s1", description: "Write code", checked: false, lineNumber: 1 },
          { id: "s2", description: "Write tests", checked: false, lineNumber: 2 },
        ],
      };
      const suggestion = splitter.suggestSplit(task, "timeout");
      expect(suggestion.suggestedSubTasks.some(
        (st) => st.title.includes("実装") || st.title.includes("テスト"),
      )).toBe(true);
    });

    it("should format suggestion as plan.md compatible markdown", () => {
      const task: PlanTask = {
        id: "task-3",
        title: "Refactor",
        status: "failed",
        steps: [{ id: "s1", description: "Split", checked: false, lineNumber: 1 }],
      };
      const suggestion = splitter.suggestSplit(task, "loop_detected");
      const markdown = splitter.formatAsPlanMarkdown(suggestion);
      expect(markdown).toContain("## Task");
      expect(markdown).toContain("- [ ]");
    });

    it("should return single-task suggestion for simple tasks", () => {
      const task: PlanTask = {
        id: "task-4",
        title: "Fix bug",
        status: "failed",
        steps: [{ id: "s1", description: "Fix it", checked: false, lineNumber: 1 }],
      };
      const suggestion = splitter.suggestSplit(task, "syntax_error");
      expect(suggestion.suggestedSubTasks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
```

### Step 2: 実装

```typescript
export class TaskSplitter {
  suggestSplit(task: PlanTask, errorClass: ErrorClass): SplitSuggestion { ... }
  formatAsPlanMarkdown(suggestion: SplitSuggestion): string { ... }
}
```

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run test tests/core/task-splitter.test.ts
git commit -am "feat(core): TaskSplitterを追加 — 失敗タスクの自動分割指示生成"
```

---

## Task 3: SmartRetryPolicy — 指数バックオフとコンテキスト縮小

**Files:**

- Create: `src/core/smart-retry-policy.ts`
- Create: `tests/core/smart-retry-policy.test.ts`

### 設計

```typescript
export interface RetryDecision {
  readonly shouldRetry: boolean;
  readonly delayMs: number;
  readonly contextReduction: ContextReduction;
  readonly retryCount: number;
}

export interface ContextReduction {
  readonly strategy: "none" | "trim_reference_files" | "simplify_prompt" | "reduce_steps";
  readonly removedItems?: string[];
}

export class SmartRetryPolicy {
  constructor(
    private readonly baseDelayMs: number = 1000,
    private readonly maxDelayMs: number = 30000,
    private readonly maxRetries: number = DEFAULT_RETRY_POLICY.maxRetries,
    private readonly retryableErrors: readonly ErrorClass[] = DEFAULT_RETRY_POLICY.retryableErrors,
  ) {}

  /** 指数バックオフ付きリトライ判定 */
  evaluate(errorClass: ErrorClass, currentRetry: number, context?: DelegationContext): RetryDecision

  /** バックオフ遅延計算 (jitter 付き) */
  calculateDelay(retryCount: number): number

  /** コンテキスト縮小戦略の決定 */
  determineReduction(retryCount: number, context?: DelegationContext): ContextReduction
}
```

### バックオフ計算式

```text
delay = min(baseDelay * 2^retryCount + jitter, maxDelay)
jitter = random(0, baseDelay * 0.5)
```

### コンテキスト縮小戦略

| retryCount | 戦略 | 説明 |
|-----------|------|------|
| 1 | none | 初回リトライはそのまま |
| 2 | trim_reference_files | 参照ファイル数を半分に削減 |
| 3 | simplify_prompt | プロンプトから MUST NOT DO セクションを削減 |

### Step 1: テスト (8+ ケース)

- 指数バックオフの遅延が正しく増加するか
- maxDelay を超えないか
- コンテキスト縮小戦略が retryCount に応じて変化するか
- 非リトライ可能エラーで `shouldRetry: false` を返すか
- retryCount が maxRetries を超えた場合
- DelegationContext なしでも動作するか

### Step 2: 実装

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run test tests/core/smart-retry-policy.test.ts
git commit -am "feat(core): SmartRetryPolicyを追加 — 指数バックオフとコンテキスト縮小"
```

---

## Task 4: LoopDetectionHandler — OmO loop-detector イベント統合

**Files:**

- Create: `src/hooks/loop-handler.ts`
- Create: `tests/hooks/loop-handler.test.ts`

### 設計

```typescript
export class LoopDetectionHandler {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly splitter: TaskSplitter,
  ) {}

  /** Event (loop-detector) をハンドリング */
  async handleEvent(event: HookEvent): Promise<HookResponse>
}
```

### フロー

1. `event.type === "Event"` かつ `payload.eventType === "loop-detector"` を検出
2. アクティブなタスクを特定 (セッションから取得)
3. `TaskSplitter.suggestSplit()` で分割案を生成
4. `PlanParser.appendErrorNote()` でエラーノートを追記
5. 分割案を `inject` で返す

### Step 1: テスト (5+ ケース)

- loop-detector イベントで分割案が inject されるか
- 非 loop-detector イベントは proceed するか
- アクティブタスクがない場合は proceed するか
- plan.md にエラーノートが追記されるか
- 分割案が plan.md 互換の Markdown であるか

### Step 2: 実装

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run test tests/hooks/loop-handler.test.ts
git commit -am "feat(hooks): LoopDetectionHandlerを実装 — loop-detectorイベント統合"
```

---

## Task 5: TaskFeedbackHandler の SmartRetry 統合

**Files:**

- Modify: `src/hooks/task-feedback.ts`
- Modify: `tests/hooks/task-feedback.test.ts`

### 変更内容

1. `SmartRetryPolicy` を `TaskFeedbackHandler` のコンストラクタに追加
2. `determineAction` で `SmartRetryPolicy.evaluate()` を使用
3. リトライ時にバックオフ遅延を `inject` メッセージに含める
4. コンテキスト縮小情報を `inject` メッセージに含める
5. 失敗時に `TaskSplitter.suggestSplit()` → `formatAsPlanMarkdown()` を inject

### Step 1: 既存テストの更新 + 新テスト追加

- リトライ時にバックオフ遅延情報が含まれるか
- 2 回目以降のリトライでコンテキスト縮小が適用されるか
- エスカレーション時に分割案が inject されるか

### Step 2: 実装

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run lint && bun run test
git commit -am "feat(hooks): TaskFeedbackHandlerにSmartRetryとTaskSplitterを統合"
```

---

## Task 6: エクスポート更新 + インテグレーションテスト + 全体検証

**Files:**

- Modify: `src/index.ts`
- Create: `tests/integration/advanced-error-flow.test.ts`

### Step 1: エクスポート更新

```typescript
// Phase 4 Exports
export { TaskSplitter } from "./core/task-splitter";
export { SmartRetryPolicy } from "./core/smart-retry-policy";
export { LoopDetectionHandler } from "./hooks/loop-handler";

export type {
  SplitSuggestion,
  SubTaskSuggestion,
} from "./core/task-splitter";
export type {
  RetryDecision,
  ContextReduction,
} from "./core/smart-retry-policy";
export type {
  LoopDetectorPayload,
  CompactionPayload,
  EventPayload,
} from "./core/types";
```

### Step 2: インテグレーションテスト

```typescript
describe("Advanced Error Flow Integration", () => {
  it("should complete: loop-detected → split → plan update → inject", async () => { ... });
  it("should complete: retry exhaustion → smart backoff → escalate → split", async () => { ... });
  it("should complete: timeout → immediate escalate → split suggestion", async () => { ... });
});
```

### Step 3: 全体検証

```bash
bun run typecheck && bun run lint && bun run test
```

### Step 4: コミット

```bash
git commit -am "feat(index): Phase 4のエクスポートを追加 + インテグレーションテスト"
```

---

## Summary

| Task | Component | 新規ファイル | 変更ファイル |
|------|-----------|------------|------------|
| 1 | typecheck 修正 + EventPayload 具象化 | — | `types.ts`, `task-feedback.ts`, `types.test.ts` |
| 2 | TaskSplitter | `task-splitter.ts` + test | — |
| 3 | SmartRetryPolicy | `smart-retry-policy.ts` + test | — |
| 4 | LoopDetectionHandler | `loop-handler.ts` + test | — |
| 5 | TaskFeedbackHandler 統合 | — | `task-feedback.ts` + test |
| 6 | エクスポート + インテグレーション | `advanced-error-flow.test.ts` | `index.ts` |

**New files:** 4 source + 4 test + 1 integration
**Modified files:** 4 (`types.ts`, `task-feedback.ts`, `index.ts`, `types.test.ts`)
**Leveraged existing:** `ErrorClassifier`, `PlanParser`, `TaskFeedbackHandler`, `CompactionProtector`
**Estimated time:** ~90-120 minutes with TDD

## Design Decisions

1. **TaskSplitter を core に配置**: I/O 非依存の純粋ロジック。PlanTask + ErrorClass
   を受け取り、SplitSuggestion を返す。plan.md 互換の Markdown を生成可能。

2. **SmartRetryPolicy を ErrorClassifier とは別クラスに**: ErrorClassifier は
   「分類」に特化、SmartRetryPolicy は「リトライ戦略」に特化。単一責任の原則を維持。
   ErrorClassifier の `shouldRetry()` は引き続き内部で利用。

3. **LoopDetectionHandler を新規フックとして分離**: CompactionProtector は
   コンパクション保護に特化しており、loop-detector 処理とは責務が異なる。
   Phase 2 の PlanBridge と同様にセッション管理パターンを踏襲。

4. **EventPayload の具象化**: `unknown` → Discriminated Union で型安全性を向上。
   `eventType` フィールドで判別する。`GenericEventPayload` をフォールバックとして
   将来の拡張性を確保。

5. **コンテキスト縮小のグラデーション**: retryCount に応じて段階的に縮小する設計。
   初回リトライは変更なし → 参照ファイル削減 → プロンプト簡略化。学習効果を
   維持しながらコンテキストウィンドウの圧迫を回避。
