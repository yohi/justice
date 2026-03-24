# Phase 5: Wisdom Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** タスク実行から得られた学習（成功パターン・失敗ゴッチャ・設計判断）を
永続化し、後続タスクの初回成功率を向上させる "Wisdom" システムを構築する。

**Architecture:** Hook-first + Pure core logic 分離を継続。Phase 4 までの
TaskFeedbackHandler・PlanParser・ErrorClassifier を拡張し、学習の抽出→永続化→
注入のフルサイクルを実現する。`DelegationContext.previousLearnings` の活用基盤
となる。

**Tech Stack:** TypeScript, Vitest, bun

**Dependencies:** Phase 4 がマージ済み。126 テストすべてパス。

---

## 現在の実装状態

### ソースファイル構成 (14 ファイル)

```text
src/
├── core/
│   ├── types.ts              (244行) — 全型定義
│   ├── plan-parser.ts         (153行) — plan.md パース・チェックボックス操作
│   ├── task-packager.ts       (106行) — PlanTask → DelegationRequest 変換
│   ├── error-classifier.ts    (110行) — エラー分類・リトライ判定
│   ├── feedback-formatter.ts  (113行) — task()出力をTaskFeedbackに構造化
│   ├── plan-bridge-core.ts     (50行) — plan解析→委譲リクエスト生成
│   ├── trigger-detector.ts     (83行) — plan参照・委譲意図検出
│   ├── smart-retry-policy.ts   (94行) — 指数バックオフ+コンテキスト縮小
│   └── task-splitter.ts       (160行) — 失敗タスク自動分割
├── hooks/
│   ├── compaction-protector.ts (108行) — コンパクション保護
│   ├── plan-bridge.ts         (182行) — Message/PreToolUse フック
│   ├── task-feedback.ts       (286行) — PostToolUse フィードバック
│   └── loop-handler.ts        (102行) — loop-detector イベント統合
└── index.ts                    (34行) — エクスポート
```

### テスト構成 (16 ファイル / 126 テスト)

```text
tests/
├── core/         — 9 test files
├── hooks/        — 4 test files
├── helpers/      — mock-file-system.ts
├── integration/  — 3 test files (plan-bridge-flow, feedback-flow, advanced-error-flow)
└── fixtures/     — 3 markdown files
```

### Phase 5 で活用する既存インターフェース

| インターフェース | 場所 | Phase 5 での役割 |
|----------------|------|-----------------|
| `DelegationContext.previousLearnings` | `types.ts:34` | 学習データの注入先（既に定義済み） |
| `TaskFeedback.{status,errorClassification}` | `types.ts:38-46` | 学習データの抽出元 |
| `TaskPackager.buildPrompt()` | `task-packager.ts:41` | PREVIOUS LEARNINGS セクションへの注入（既に対応済み） |
| `PlanBridgeCore.buildDelegationFromPlan()` | `plan-bridge-core.ts:28` | learnings を DelegationRequest に含める |
| `CompactionProtector.createSnapshot()` | `compaction-protector.ts:51` | `accumulatedLearnings` のスナップショット保護 |

---

## Task 1: WisdomEntry 型定義 + WisdomStore インターフェース

**Files:**

- Modify: `src/core/types.ts`
- Create: `src/core/wisdom-store.ts`
- Create: `tests/core/wisdom-store.test.ts`

### Step 1: 型定義の追加

`src/core/types.ts` に以下の型を追加する:

```typescript
/** 学習エントリ */
export interface WisdomEntry {
  readonly id: string;
  readonly taskId: string;
  readonly category: WisdomCategory;
  readonly content: string;
  readonly errorClass?: ErrorClass;
  readonly timestamp: string;
}

export type WisdomCategory =
  | "success_pattern"     // 成功した実装パターン
  | "failure_gotcha"      // 失敗時の落とし穴
  | "design_decision"     // 重要な設計判断
  | "environment_quirk";  // 環境固有の注意事項
```

### Step 2: WisdomStore テスト作成

```typescript
// tests/core/wisdom-store.test.ts
describe("WisdomStore", () => {
  describe("add", () => {
    it("should add a wisdom entry", () => { ... });
    it("should auto-generate id and timestamp", () => { ... });
  });

  describe("getByTaskId", () => {
    it("should return entries for a specific task", () => { ... });
    it("should return empty array for unknown task", () => { ... });
  });

  describe("getRelevant", () => {
    it("should return entries matching the given errorClass", () => { ... });
    it("should return all entries when no errorClass is specified", () => { ... });
    it("should limit results to maxEntries", () => { ... });
  });

  describe("formatForInjection", () => {
    it("should format entries as Markdown for prompt injection", () => { ... });
    it("should return empty string for no entries", () => { ... });
  });

  describe("serialize / deserialize", () => {
    it("should round-trip through JSON serialization", () => { ... });
    it("should handle empty store", () => { ... });
  });
});
```

### Step 3: WisdomStore 実装

```typescript
// src/core/wisdom-store.ts
export class WisdomStore {
  private readonly entries: WisdomEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries: number = 100) {
    this.maxEntries = maxEntries;
  }

  add(entry: Omit<WisdomEntry, "id" | "timestamp">): WisdomEntry { ... }
  getByTaskId(taskId: string): WisdomEntry[] { ... }
  getRelevant(options?: { errorClass?: ErrorClass; maxEntries?: number }): WisdomEntry[] { ... }
  formatForInjection(entries: WisdomEntry[]): string { ... }
  serialize(): string { ... }  // JSON 永続化用
  static deserialize(json: string): WisdomStore { ... }
}
```

### Step 4: 検証 + コミット

```bash
bun run typecheck && bun run lint && bun run test tests/core/wisdom-store.test.ts
git add src/core/types.ts src/core/wisdom-store.ts tests/core/wisdom-store.test.ts
git commit -m "feat(core): WisdomStore型定義とインメモリストアを追加"
```

---

## Task 2: LearningExtractor — タスク結果からの学習抽出

**Files:**

- Create: `src/core/learning-extractor.ts`
- Create: `tests/core/learning-extractor.test.ts`

### 設計

LearningExtractor は `TaskFeedback` を分析し、有用な学習エントリを生成する
純粋なコアロジッククラス。

### 抽出ルール

| 条件 | カテゴリ | 抽出内容 |
|------|---------|---------|
| `status === "success"` かつ testResults.passed > 0 | `success_pattern` | タスクID + テスト通過数 |
| `status === "failure"` かつ `errorClass === "test_failure"` | `failure_gotcha` | 失敗テストの詳細（failureDetails） |
| `status === "failure"` かつ `errorClass === "design_error"` | `design_decision` | エラー内容 + 必要な設計変更 |
| `status === "timeout"` | `environment_quirk` | タイムアウト発生のコンテキスト |
| retryCount >= 2 で最終的に成功 | `failure_gotcha` | 「N回リトライ後に解決」+ 最終的な解決策 |

### Step 1: テスト作成

```typescript
describe("LearningExtractor", () => {
  describe("extract", () => {
    it("should extract success_pattern from successful task with tests", () => { ... });
    it("should extract failure_gotcha from test failures", () => { ... });
    it("should extract design_decision from design errors", () => { ... });
    it("should extract environment_quirk from timeout", () => { ... });
    it("should mark high-retry successes as failure_gotcha", () => { ... });
    it("should return empty array for trivial success without tests", () => { ... });
  });
});
```

### Step 2: 実装

```typescript
export class LearningExtractor {
  extract(feedback: TaskFeedback, rawOutput?: string): Omit<WisdomEntry, "id" | "timestamp">[] {
    ...
  }
}
```

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run lint && bun run test tests/core/learning-extractor.test.ts
git commit -am "feat(core): LearningExtractorを追加 — TaskFeedbackからの学習抽出"
```

---

## Task 3: WisdomStore の FileSystem 永続化

**Files:**

- Create: `src/core/wisdom-persistence.ts`
- Create: `tests/core/wisdom-persistence.test.ts`

### 設計

WisdomPersistence は WisdomStore のデータを `.justice/wisdom.json` ファイルに
読み書きする I/O レイヤー。core の WisdomStore は純粋ロジックのまま維持する。

```typescript
export class WisdomPersistence {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly wisdomFilePath: string = ".justice/wisdom.json",
  ) {}

  /** ファイルからWisdomStoreを復元。ファイルが存在しない場合は空のStoreを返す */
  async load(): Promise<WisdomStore> { ... }

  /** WisdomStoreをファイルに永続化 */
  async save(store: WisdomStore): Promise<void> { ... }
}
```

### Step 1: テスト作成

```typescript
describe("WisdomPersistence", () => {
  it("should save and load wisdom entries", async () => { ... });
  it("should return empty WisdomStore when file does not exist", async () => { ... });
  it("should handle corrupted JSON gracefully", async () => { ... });
});
```

### Step 2: 実装

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run lint && bun run test tests/core/wisdom-persistence.test.ts
git commit -am "feat(core): WisdomPersistenceを追加 — 学習データのファイル永続化"
```

---

## Task 4: TaskFeedbackHandler への学習統合

**Files:**

- Modify: `src/hooks/task-feedback.ts`
- Modify: `tests/hooks/task-feedback.test.ts`
- Modify: `tests/integration/feedback-flow.test.ts`

### 変更内容

1. `TaskFeedbackHandler` に `WisdomStore` と `LearningExtractor` を追加
2. `handleSuccess` / `handleEscalation` の完了後に学習を抽出・蓄積
3. `SessionState` に `accumulatedLearnings` フィールドを追加

### 変更の流れ

```typescript
// task-feedback.ts に追加するフロー:
// 1. handleSuccess() 完了後:
//    - LearningExtractor.extract(feedback) で学習を抽出
//    - WisdomStore.add() で蓄積
//
// 2. handleEscalation() 完了後:
//    - LearningExtractor.extract(feedback) で失敗学習を抽出
//    - WisdomStore.add() で蓄積
//
// 3. inject メッセージに accumulatedLearnings を含める
```

### Step 1: テスト追加

```typescript
// tests/hooks/task-feedback.test.ts に追加
it("should accumulate learning from successful task", async () => { ... });
it("should accumulate learning from failed task", async () => { ... });
```

### Step 2: 実装

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run lint && bun run test
git commit -am "feat(hooks): TaskFeedbackHandlerに学習抽出・蓄積を統合"
```

---

## Task 5: PlanBridge への学習注入

**Files:**

- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/core/plan-bridge-core.ts`
- Modify: `tests/hooks/plan-bridge.test.ts`

### 変更内容

1. `PlanBridge` に `WisdomStore` を注入可能にする
2. `handleMessage` / `handlePreToolUse` で `DelegationContext.previousLearnings` に
   関連する学習データを注入
3. `PlanBridgeCore.buildDelegationFromPlan` の `options` に `previousLearnings` を渡す
4. `TaskPackager.buildPrompt` の `PREVIOUS LEARNINGS` セクションが自動的に出力される
   （既に実装済み — `task-packager.ts:97-101`）

### Step 1: テスト追加

```typescript
// tests/hooks/plan-bridge.test.ts に追加
it("should inject previousLearnings into delegation context when wisdom exists", async () => { ... });
it("should proceed normally when no wisdom exists", async () => { ... });
```

### Step 2: 実装

```typescript
// plan-bridge.ts の変更:
// constructor に WisdomStore を追加（optional, デフォルト null）
// handleMessage/handlePreToolUse で:
//   const learnings = this.wisdomStore?.formatForInjection(
//     this.wisdomStore.getRelevant({ maxEntries: 5 })
//   ) ?? undefined;
//   buildDelegationFromPlan(planContent, { ..., previousLearnings: learnings });
```

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run lint && bun run test
git commit -am "feat(hooks): PlanBridgeに学習データの注入を統合"
```

---

## Task 6: CompactionProtector の学習保護

**Files:**

- Modify: `src/hooks/compaction-protector.ts`
- Modify: `tests/hooks/compaction-protector.test.ts`

### 変更内容

1. `CompactionProtector` に `WisdomStore` を注入可能にする
2. `createSnapshot()` で `accumulatedLearnings` に `WisdomStore.formatForInjection()`
   の結果を含める（既に `ProtectedContext.accumulatedLearnings` フィールドは存在）
3. `formatForInjection()` で学習データが「Key Learnings」セクションに出力される
   （既に実装済み — `compaction-protector.ts:81-85`）

### Step 1: テスト追加

```typescript
it("should include wisdom entries in snapshot learnings", () => { ... });
it("should handle empty wisdom store gracefully", () => { ... });
```

### Step 2: 実装

### Step 3: 検証 + コミット

```bash
bun run typecheck && bun run lint && bun run test
git commit -am "feat(hooks): CompactionProtectorの学習保護を強化"
```

---

## Task 7: エクスポート更新 + インテグレーションテスト + 全体検証

**Files:**

- Modify: `src/index.ts`
- Create: `tests/integration/wisdom-flow.test.ts`

### Step 1: エクスポート更新

```typescript
// Phase 5 Exports
export { WisdomStore } from "./core/wisdom-store";
export { LearningExtractor } from "./core/learning-extractor";
export { WisdomPersistence } from "./core/wisdom-persistence";

export type {
  WisdomEntry,
  WisdomCategory,
} from "./core/types";
```

### Step 2: インテグレーションテスト

```typescript
describe("Wisdom Flow Integration", () => {
  it("should complete: task success → learning extraction → wisdom store → next delegation includes learnings", async () => {
    // 1. TaskFeedbackHandler でタスク成功処理
    // 2. WisdomStore に学習が蓄積されることを確認
    // 3. PlanBridge で次のタスク委譲時に previousLearnings が含まれることを確認
  });

  it("should complete: task failure → gotcha extraction → subsequent delegation warns about gotcha", async () => {
    // 1. TaskFeedbackHandler でタスク失敗処理
    // 2. failure_gotcha が WisdomStore に蓄積されることを確認
    // 3. 次のタスク委譲の prompt に PREVIOUS LEARNINGS が含まれることを確認
  });

  it("should persist wisdom through compaction", async () => {
    // 1. WisdomStore に学習を蓄積
    // 2. CompactionProtector でスナップショットを作成
    // 3. accumulatedLearnings にフォーマットされた学習が含まれることを確認
  });
});
```

### Step 3: 全体検証

```bash
bun run typecheck && bun run lint && bun run test
```

### Step 4: コミット

```bash
git commit -am "feat(index): Phase 5のエクスポート追加 + Wisdomインテグレーションテスト"
```

---

## Summary

| Task | Component | 新規ファイル | 変更ファイル |
|------|-----------|------------|------------|
| 1 | WisdomStore 型 + インメモリストア | `wisdom-store.ts` + test | `types.ts` |
| 2 | LearningExtractor | `learning-extractor.ts` + test | — |
| 3 | WisdomPersistence | `wisdom-persistence.ts` + test | — |
| 4 | TaskFeedbackHandler 学習統合 | — | `task-feedback.ts` + test |
| 5 | PlanBridge 学習注入 | — | `plan-bridge.ts`, `plan-bridge-core.ts` + test |
| 6 | CompactionProtector 学習保護 | — | `compaction-protector.ts` + test |
| 7 | エクスポート + インテグレーション | `wisdom-flow.test.ts` | `index.ts` |

**New files:** 3 source + 3 test + 1 integration
**Modified files:** 6 (`types.ts`, `task-feedback.ts`, `plan-bridge.ts`, `plan-bridge-core.ts`, `compaction-protector.ts`, `index.ts`)
**Leveraged existing:** `DelegationContext.previousLearnings`, `TaskPackager.buildPrompt`, `CompactionProtector.accumulatedLearnings`, `ProtectedContext`
**Estimated time:** ~90-120 minutes with TDD

## Design Decisions

1. **WisdomStore を core に配置**: I/O 非依存の純粋ロジック。インメモリでの
   学習管理・検索・フォーマットを担当。永続化は WisdomPersistence に委譲。

2. **LearningExtractor を ErrorClassifier とは別クラスに**: ErrorClassifier は
   「分類」に特化、LearningExtractor は「学習の生成」に特化。
   TaskFeedback の解析結果から WisdomEntry を生成する。

3. **既存の `previousLearnings` パスを活用**: `DelegationContext.previousLearnings`
   と `TaskPackager.buildPrompt` の `PREVIOUS LEARNINGS` セクションは
   Phase 1 で既に定義済み。Phase 5 ではこのパスに実際のデータを流す。

4. **WisdomPersistence の分離**: FileSystem I/O を core から隔離し、
   テスト可能性を維持。`.justice/wisdom.json` にシンプルな JSON で永続化。

5. **CompactionProtector との統合**: 既に `accumulatedLearnings` フィールドと
   「Key Learnings」セクションの出力が実装されている。Phase 5 では
   WisdomStore のデータをこのフィールドに流すだけで統合が完了する。

6. **maxEntries による制限**: WisdomStore はエントリ数を制限し（デフォルト 100）、
   古いエントリを自動的に除去。コンテキストウィンドウへの影響を最小限に保つ。
