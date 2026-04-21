# Justice Plugin — 仕様書

> **バージョン**: 0.1.0
> **ステータス**: プロダクションレディ (Phase 7 完了)
> **最終更新日**: 2026-04-21

## 1. 概要

Justice は、[Superpowers](https://github.com/oh-my-openagent/superpowers)（プロジェクト管理を行う頭脳）と [oh-my-openagent](https://github.com/oh-my-openagent)（実行を行うエンジン）を繋ぐ **「神経系」** として機能する OpenCode プラグインです。Markdown のプランファイルに表現された Superpowers の宣言的な意図を、oh-my-openagent のイベント駆動型 API 呼び出しに変換します。

### 1.1 解決すべき課題

Superpowers と oh-my-openagent を併用する場合、以下の2つの間に自動的な連携機能が存在しませんでした：

- **プランファイル** (`plan.md`) — Superpowers が保守するチェックボックス付きのタスクリストや設計ドキュメント
- **`task()` ツール** — oh-my-openagent が提供する、サブエージェントに作業を委譲するための仕組み

Justice は以下の手順でこのギャップを埋めます：

1. エージェントのメッセージから委譲の意図を検出する
2. 参照されたプランファイルを解析し、次に実行すべき未完了のタスクを見つける
3. 構造化されたコンテキストを `task()` の呼び出しに注入する
4. 実行結果を処理し、`plan.md` を更新する（チェックボックスのオンオフ、エラーの記録など）
5. 今後のタスク委譲を改善するために、タスク実行から得られた学習内容（Wisdom）を永続化する

### 1.2 コア原則

- **フック重視のアーキテクチャ (Hook-First)**: 全ての機能は OmO のライフサイクルフックとして実装されます
- **純粋なコアロジック (Pure Core Logic)**: ビジネスロジックは OmO に一切依存せず、完全に分離されておりテスト可能です
- **不変性 (Immutability)**: 全ての型は `readonly` です。状態の変更は明示的なインターフェースを通じてのみ行われます
- **フェイルオープン (Fail-Open)**: I/O のエラーによって実行がクラッシュすることはありません。プラグインはグレースフルに縮退します

---

## 2. アーキテクチャ

### 2.1 層モデル

```text
┌─────────────────────────────────────────────────────┐
│  Superpowers (頭脳)                                 │
│  plan.md  /  design.md  /  role-prompt.md           │
└──────────────────┬──────────────────────────────────┘
                   │ ファイルの参照
┌──────────────────▼──────────────────────────────────┐
│  Justice Plugin (神経系)                            │
│                                                     │
│  ┌─────────────── フック層 (Hook Layer) ──────┐     │
│  │  plan-bridge          (Message/PreToolUse) │     │
│  │  task-feedback        (PostToolUse)        │     │
│  │  compaction-protector (Event:compaction)   │     │
│  │  loop-handler         (Event:loop-detector)│     │
│  └────────────────────┬───────────────────────┘     │
│                       │ 委譲先
│  ┌─────────────── コアロジック層 (Core Logic) ┐     │
│  │  PlanParser   TriggerDetector  WisdomStore │     │
│  │  TaskPackager CategoryClassifier  ...      │     │
│  └────────────────────────────────────────────┘     │
└──────────────────┬──────────────────────────────────┘
                   │ HookEvent / HookResponse
┌──────────────────▼──────────────────────────────────┐
│  oh-my-openagent (実行エンジン)                     │
│  task()  /  background_output()  /  compaction      │
└─────────────────────────────────────────────────────┘
### 2.1 層モデル

...

### 2.2 責務の分割

| 層 | 責務 | I/Oの有無 | テストの容易性 |
|-------|---------------|-----|-------------|
| **フック層** | OmO イベントの捕捉、コアロジックの調整、セッション状態の管理 | あり (FileReader/FileWriter) | 統合テスト |
| **コアロジック層** | 純粋なビジネスロジック — 副作用なし | なし | ユニットテスト (目標 カバレッジ100%) |
| **ランタイム層** | 実際のファイルシステム実装 (`NodeFileSystem`) | あり | 一時ディレクトリを用いた統合テスト |

## 3. データモデル

### 3.1 プラン構造

```typescript
interface PlanTask {
  readonly id: string;           // "task-1", "task-2", ...
  readonly title: string;        // "パーサーモジュールの実装"
  readonly steps: PlanStep[];
  readonly status: PlanTaskStatus; // "pending" | "in_progress" | "completed" | "failed"
}

interface PlanStep {
  readonly id: string;           // "task-1-step-1"
  readonly description: string;
  readonly checked: boolean;
  readonly lineNumber: number;   // 1始まり、チェックボックス更新用
}
```

### 3.2 委譲リクエスト (Delegation Request)

```typescript
interface DelegationRequest {
  readonly category: TaskCategory;
  readonly prompt: string;
  readonly loadSkills: string[];
  readonly runInBackground: boolean;
  readonly context: DelegationContext;
}

interface DelegationContext {
  readonly planFilePath: string;
  readonly taskId: string;
  readonly referenceFiles: string[];
  readonly rolePrompt?: string;
  readonly previousLearnings?: string;  // WisdomStore から注入
}
```

### 3.3 タスクフィードバック (Task Feedback)

```typescript
interface TaskFeedback {
  readonly taskId: string;
  readonly status: TaskFeedbackStatus; // "success" | "failure" | "timeout" | "compaction_risk"
  readonly diff?: string;
  readonly testResults?: TestSummary;
  readonly unresolvedIssues?: string[];
  readonly retryCount: number;
  readonly errorClassification?: ErrorClass;
}

interface TestSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failureDetails?: string[];
}
```

### 3.4 エラー分類 (Error Classification)

```typescript
type ErrorClass =
  | "syntax_error"      // 第1層: リトライ可能 (最大 3回)
  | "type_error"        // 第1層: リトライ可能 (最大 3回)
  | "test_failure"      // 第2層: 即時エスカレーション
  | "design_error"      // 第2層: 即時エスカレーション
  | "timeout"           // 即時中断 + 分割指示
  | "loop_detected"     // 即時中断 + 分割指示
  | "provider_transient" // プロバイダの一時的エラー (Rate Limit等): 非リトライ（OmO側に委ねる）
  | "provider_config"   // プロバイダの設定エラー (API Key欠如等): 非リトライ（要ユーザー介入）
  | "unknown";
```

### 3.5 フックのイベント型 (Hook Event Types)

```typescript
type HookEvent = MessageEvent | PreToolUseEvent | PostToolUseEvent | EventEvent;

type HookResponse = ProceedResponse | SkipResponse | InjectResponse;

interface InjectResponse {
  readonly action: "inject";
  readonly injectedContext: string;
}
```

### 3.6 学習エントリ (Wisdom Entry)

```typescript
interface WisdomEntry {
  readonly id: string;
  readonly taskId: string;
  readonly category: WisdomCategory;
  readonly content: string;
  readonly errorClass?: ErrorClass;
  readonly timestamp: string;
}

type WisdomCategory =
  | "success_pattern"
  | "failure_gotcha"
  | "design_decision"
  | "environment_quirk";
```

### 3.7 コンパクション保護 (Compaction Protection)

```typescript
interface ProtectedContext {
  readonly planSnapshot: string;       // スナップショット時点での plan.md の全内容
  readonly currentTaskId: string;
  readonly currentStepId: string;
  readonly accumulatedLearnings: string;
  readonly timestamp: string;
}
```

---

## 4. フック仕様 (Hook Specifications)

### 4.1 `plan-bridge` — タスク委譲の連携

| プロパティ | 設定値 |
|----------|-------|
| OmO イベント | `Message`, `PreToolUse` |
| トリガー (Message) | エージェントのメッセージ内に `plan.md` の参照 *および* 委譲キーワードが含まれている場合 |
| トリガー (PreToolUse) | `task()` ツールが呼び出され、*かつ* アクティブなプランが登録されている場合 |

**Message イベントの流れ（フロー）:**

1. `TriggerDetector.analyzeTrigger(content)` — プランの参照と委譲の意図を検出する（`src/hooks/plan-bridge.ts` で実行）
2. `FileReader.fileExists(planPath)` — プランファイルが存在することを確認する
3. `FileReader.readFile(planPath)` — プランのコンテンツを読み込む
4. `DependencyAnalyzer.getParallelizable(tasks)` — 並行処理可能なタスクを特定する
5. `CategoryClassifier.classify(task)` — カテゴリを自動選択する
6. `ProgressReporter.generateReport(tasks)` — 進捗状況を算出する
7. `WisdomStore.getRelevant()` — 関連する学習内容（Wisdom）を取得する
8. 委譲コンテキストをすべて含んだ `inject`（注入）レスポンスを返す

**セッション状態:**

- `Map<sessionId, planPath>` — セッションごとに状態を分離（`PlanBridge.activePlanPaths`）
- ※ `PlanBridge` では TTL/LRU によるクリーンアップは実施されません。この管理責務は `TaskFeedbackHandler` または他のコンポーネントに委ねられます。

**委譲キーワード (英語/日本語対応):**

`delegate`, `next task`, `execute task`, `run task`, `start task`,
`次のタスク`, `タスクを実行`, `タスクを委譲`, `タスクを開始`

---

### 4.2 `task-feedback` — フィードバックループ

| プロパティ | 設定値 |
|----------|-------|
| OmO イベント | `PostToolUse` |
| トリガー | `toolName === "task"` であり、*かつ* アクティブなセッションが存在する場合 |

**セッション管理:**

- 有効期限 (TTL): 30分
- LRUによる最大保持数: 50セッション
- `TaskFeedbackHandler` が中心となってセッションのライフサイクルを管理します。

**フロー:**

1. `FeedbackFormatter.format(taskId, rawOutput, isError)` — 出力内容をパースする
2. `ErrorClassifier.classify(output)` — エラーの種類を分類する
3. 状況に基づいた分岐:

| 状況 | アクション |
|-----------|--------|
| 成功 (Success) | `plan.md` の該当全ステップに ✅ を付け、成功メッセージを注入し、学習内容を抽出する |
| 第1層エラー (文法/型エラー、リトライ上限未満) | 通知せずに進行（OmO が暗黙的に自動修正） |
| 第2層エラー (テスト失敗、設計エラー、リトライ制限オーバーなど) | `plan.md` にエラーの情報を追記し、エスカレーション指示及び systematic-debugging（体系的デバッグ）ガイダンスを注入する |
| タイムアウト | 分割指示と `TaskSplitter` 経由で生成されたタスク分割案をコンテキストに注入する |
| `compaction_risk` | そのまま進行する（CompactionProtector が Event フック経由で別に処理する） |

---

### 4.3 `compaction-protector` — コンパクションからの保護

| プロパティ | 設定値 |
|----------|-------|
| OmO イベント | `Event` (eventType: `"compaction"`) |

**フロー:**

1. `createSnapshot(planContent, currentTaskId, currentStepId, learnings)` — 状態をシリアライズ化
2. `formatForInjection(snapshot)` — Inject 可能な構造化された Markdown 形式にフォーマット
3. コンパクション後、切り捨てられたコンテキストを復元するために `inject` レスポンスを返す

**ProtectedContext** の内訳:

- `plan.md` の完全なスナップショット
- アクティブなタスク/ステップの ID
- `WisdomStore` から蓄積された学習内容

---

### 4.4 `loop-handler` — ループ検出と対応

| プロパティ | 設定値 |
|----------|-------|
| OmO イベント | `Event` (eventType: `"loop-detector"`) |

**フロー:**

1. セッションから現在アクティブなタスクを検出
2. `TaskSplitter.suggestSplit(task, "loop_detected")` — 分割の提案を生成
3. `PlanParser.appendErrorNote(content, taskId, note)` — エラー情報を `plan.md` に書き込む
4. `plan.md` と互換性のある Markdown 形式のタスク分割提案を含んだ `inject` （注入）レスポンスを返す

---

## 5. コアコンポーネント (Core Components)

### 5.1 `PlanParser`

`plan.md` の Markdown ファイルをパースし、型定義された `PlanTask[]` のリストへ変換します。

**機能一覧:**

- **`parse(content)`** — `### Task N: Title` のような見出しと `- [ ]` または `- [x]` 形式のチェックボックスを認識。
- **`updateCheckbox(content, lineNumber, checked)`** — 指定された行番号のチェックボックスを切り替える。
- **`appendErrorNote(content, taskId, note)`** — 該当タスク見出しの下に引用句 (blockquote) でエラー情報を挿入する。
- **`getNextIncompleteTask(tasks)`** — `status` が `"completed"` ではない最初のタスクを返す。

**ステータス (`Status`) の算出ルール:**

| チェック済みのステップ数 | 判定されるステータス |
|--------------|--------|
| 全て未チェック (0) | `pending` (保留中) |
| 一部チェック済み | `in_progress` (進行中) |
| 全てチェック済み | `completed` (完了) |

---

### 5.2 `TaskPackager`

`PlanTask` オブジェクトを、構造化されたプロンプトを含む `DelegationRequest` に変換します。

**生成されるプロンプトの構成:**

```text
[役割のプロンプト (任意指定)]
## 実行タスク: <title>
## ステップ一覧: <ステップのリスト>
## コンテキスト: プラン: <path>, タスク ID: <id>
## 参照すべきファイル: <関連ファイルリスト>
## 過去の学習内容: <関連するWisdomのリスト>
```

---

### 5.3 `TriggerDetector`

エージェントのテキストメッセージ内から、タスクを委譲したいという意図 (`delegation intent`) を検出します。

**`detectPlanReference(message)`** — `*.plan*.md` または `plan.md` のパターンに正規表現でマッチング。

**`detectDelegationIntent(message)`** — 委譲に必要なキーワード（英語・日本語）にマッチング。

**`shouldTrigger(message)`** — 上記の両方が `true` の場合のみ起動。

---

### 5.4 `ErrorClassifier`

発生したエラーを分類し、自動的にリトライ可能かどうかを判定します。

**デフォルトのリトライ戦略・ポリシー:**

| エラー種別 | 最大リトライ回数 | 所属層 |
|-------|------------|-------|
| `syntax_error` | 3 | 第1層 (自動修正) |
| `type_error` | 3 | 第1層 (自動修正) |
| `test_failure` | 0 | 第2層 (即時エスカレーション) |
| `design_error` | 0 | 第2層 (即時エスカレーション) |
| `timeout` | 0 | 中断 (Abort) |
| `loop_detected` | 0 | 中断 (Abort) |
| `provider_transient` | 0 | プロバイダ層 (OmOに委ねる) |
| `provider_config` | 0 | プロバイダ層 (要介入) |

---

### 5.5 `FeedbackFormatter`

`task()` の生の実行結果を解析・抽出して、整理された `TaskFeedback` オブジェクトへ変換します。

**サポートされている出力のパターン:**

- `Tests: N passed, M failed, K skipped`
- `Tests  N passed (N)` (Vitest 独自のフォーマット)
- 失敗した際に表示される `FAIL tests/foo.test.ts` 行の検知
- タイムアウト発生時の文字列 (`timed out`, `timeout`) → 解析後のステータス: `timeout`
- トークン上限警告 (`context window * full`, `compaction may occur`) → 解析後のステータス: `compaction_risk`

---

### 5.6 `DependencyAnalyzer`

タスクステップの説明文内に宣言された依存関係を表すマーカーを解析します。

**依存ファイル（マーカー）の構文:** `(depends: task-1)`, `(depends: task-2, task-3)`

**`extractDependencies(tasks)`** — 宣言された依存関係を `Map<taskId, string[]>` 形式で返す。

**`getParallelizable(tasks)`** — 自身が未完了で、依存先が全て完了しており、かつ循環依存がないタスク一覧を取得する。

**`buildExecutionOrder(tasks)`** — タスク順序のトポロジカルソート（有向非巡回グラフ）を実施する。

---

### 5.7 `CategoryClassifier`

タスクの見出しや各ステップの説明文の中にあるキーワードから、OmO に必要なタスクカテゴリ (`TaskCategory`) を自動的に選択します。

| カテゴリ | 対象となる主なキーワード群 |
|----------|---------|
| `visual-engineering` | CSS, UI, UX, layout, animation, design, frontend, デザイン など |
| `ultrabrain` | architect, design pattern, refactor, restructure, 設計, アーキテクチャ など |
| `writing` | document, README, API doc, changelog, ドキュメント など |
| `quick` | fix typo, rename, bump version など (ステップ数が 1 以下のもの限定) |
| `deep` | デフォルト (上記キーワードどれにも一致しない場合) |

---

### 5.8 `ProgressReporter`

現行の `PlanTask[]` から進捗レポートを生成します。

**`generateReport(tasks)`** — 全体の進捗状況のパーセンテージ (`overallProgress`)、タスクごとのステータスを含む `ProgressReport` を返す。

**`formatAsMarkdown(report)`** — ステップ数表示と絵文字による接頭辞を付けた、包括的タスクリストを生成する。

**`formatAsCompact(report)`** — `[JUSTICE Progress: 50% | 1/3 tasks]` のように一行で表示できるコンパクトフォーマットを生成する。

---

### 5.9 `SmartRetryPolicy`

リトライ可能なエラーに対して、指数関数的なバックオフ処理とコンテキスト削済（プロンプト最小化）を段階的に実施するクラスです。

**バックオフの計算式:**

```text
delay = min(baseDelay × 2^retryCount + jitter, maxDelay)
jitter = random(0, baseDelay × 0.5)
```

**リトライ回数によるコンテキスト縮減戦略:**

| リトライ回数 | 戦略 (Strategy) |
|-------|----------|
| 1 回目 | なし（そのままリトライ） |
| 2 回目 | `trim_reference_files`（ファイル参照元リストを半分に削る） |
| 3 回目 | `simplify_prompt`（MUST NOT DO など禁止制約の条件を減らす） |

---

### 5.10 `TaskSplitter`

タスクが失敗またはタイムアウトした際に、より小さいサブタスクへと分割するための提案を自動生成します。

**分割を判定するロジック:**

| 条件 | 分割戦略の手法 |
|-----------|---------------|
| 4つ以上のステップあり | 2つのサブタスクに均等に分割する |
| `timeout` の場合 | 「実装 (Implementation)」 + 「テスト (Testing)」の2つのサブタスクに分離する |
| `design_error` の場合 | 「設計の見直し (Redesign)」 + 「再実装 (Re-implementation)」に分離する |
| `loop_detected` の場合 | すべてのステップを完全に独立した個別タスクへ分ける |

**出力内容:** `plan.md` の現状のフォーマット・互換性を維持した `## Task` 見出しおよび `- [ ]` のチェックボックスのリスト。

---

### 5.11 `WisdomStore`

これまで蓄積した学習のエントリを保存するインメモリ（オンメモリ）ストア。

**`add(entry)`** — 新規追加時に `id` および `timestamp` は自動で生成される。

**`getRelevant({ errorClass?, maxEntries? })`** — エラーの種別ごとにフィルタリングし、結果の最大数を制限して取得する。

**`formatForInjection(entries)`** — 取得したエントリ群を Markdown の `PREVIOUS LEARNINGS` (過去の学習内容) セクション形式へフォーマットする。

**`serialize()` / `WisdomStore.deserialize(json)`** — ファイルの永続化向けに JSON 文字列への相互変換をサポートする。

**デフォルト制約:** 最大 100 件 (100件超過時は古い順・LRUから破棄)。

---

### 5.12 `LearningExtractor`

`TaskFeedback` の結果から `WisdomEntry` へと学習草案を抽出します。

**抽出に関するルール:**

| 状況判定 | 保存するカテゴリ | 抽出するコンテンツ内容 |
|-----------|----------|---------|
| taskが成功 + 全テストに通過 | `success_pattern` | 成功時のテストのカウント数 |
| taskが失敗 + test_failure が原因 | `failure_gotcha` | 失敗に関連する詳細出力 |
| taskが失敗 + design_error が原因 | `design_decision` | ロジック・出力された結果の重要スニペット |
| timeout による失敗 | `environment_quirk` | その時点のコンテキスト情報 |
| 実質リトライが2回以上発生した後での成功 | `failure_gotcha` | 「N回のリトライの末に成功した点」について |

**サニタイズ（機密情報の除外処理）:** データベースや API キー、パスワード、トークンのようなセキュリティに関する情報が保存される前にそれらのパターンをマスクし、無効化します。

---

### 5.13 `WisdomPersistence`

`WisdomStore` 内の内容をローカルファイルの `.justice/wisdom.json` へ永続化（保存）および読み込みを行います。

**`load()`** — ファイルからの復元（ファイルが無かったり欠損していたりする場合は空の Store が返る）。

**`save(store)`** — 完全な JSON のシリアライズ化と書き込みの実施。

---

### 5.14 `StatusCommand`

プログラムを介してプランの進行状況・ステータスを知るための API を提供します。

**`getStatus(planPath)`** — 以下が含まれる `PlanStatus` 情報を生成して返却。

- `progress: ProgressReport`
- `parallelizable: PlanTask[]`
- `executionOrder: PlanTask[]`
- `categoryMap: Map<taskId, TaskCategory>`

**`formatAsMarkdown(status)`** — `progress` を含む各種情報や並行可能タスク、依存に合わせた実行順序などを、統合的なレポート形式（Markdown で成型）にして出力。

---

### 5.15 `JusticePlugin` — オーケストレーター (Orchestrator)

階層化された知見ストア（`TieredWisdomStore`）を用いて、4つのフックハンドラ（`plan-bridge`, `task-feedback`, `compaction-protector`, `loop-handler`）を統括し繋ぎ合わせる中核となるクラスです。プロジェクト固有のローカル知見とユーザー全体のグローバル知見をシームレスに扱い、Persistence（永続化）や秘密情報の検出・保護を管理します。

```typescript
const plugin = new JusticePlugin(fileReader, fileWriter);
const response = await plugin.handleEvent(event);
```

**イベントの流れ（ルーティング一覧）:**

| 発生するイベントタイプ | 発火するハンドラ | 内容 |
|-----------|---------|---|
| `Message` | `PlanBridge.handleMessage` | プランの解析と委譲（Delegation）の検出 |
| `PreToolUse` | `PlanBridge.handlePreToolUse` | プランの解析と委譲（Delegation）の検出 |
| `PostToolUse` | `TaskFeedbackHandler.handlePostToolUse` | 学習内容の抽出（Learning Extraction）と保存、エラー分類・リトライ判定 |
| `Event` (compaction) | `CompactionProtector` | コンテキスト圧縮時のプラン・学習内容の保護と再注入 |
| `Event` (loop-detector) | `LoopDetectionHandler` | 無限ループ検出時の中断とタスク再分割の提案 |

**知見の管理:** `JusticePlugin` は内部で `TieredWisdomStore` を保持し、各ハンドラに共有します。知見の書き込み時にはヒューリスティックまたは明示的なスコープ指定に基づいて適切なストア（Local/Global）へ振り分け、読み込み時にはローカル優先のマージ挙動を提供します。

---

### 5.16 `TieredWisdomStore` — Cross-Project Wisdom Composition

`TieredWisdomStore` は 2 つの独立した `WisdomStore` インスタンス
（project-local / user-global）を合成し、書き込みの振り分け・読み込みのマージ・秘密検出を提供する。

**Constructor:**

```typescript
new TieredWisdomStore({
  localStore: WisdomStore,
  globalStore: WisdomStore,
  localPersistence: WisdomPersistence,
  globalPersistence: WisdomPersistence,
  secretDetector?: SecretPatternDetector,
  globalDisplayPath?: string,
  logger?: { warn(msg: string, ...args: unknown[]): void },
})
```

**主な API:**

- `add(entry, { scope? })` — category heuristic + 明示 scope で local/global 振り分け。global 昇格時に `SecretPatternDetector` でマッチした場合は、警告ログを出力し、**グローバルへの昇格をキャンセルしてプロジェクトローカルストアに保存します。** これにより、秘密情報がプロジェクトを跨いで漏洩することを防ぎます。環境変数や秘密情報の混入が疑われる場合は、内容を確認・修正した上で必要に応じて再登録してください。
- `getRelevant({ errorClass?, maxEntries? })` — ローカル優先、不足分を global から補填。デフォルト `maxEntries=10`。
- `getByTaskId(taskId)` — 両 store の該当エントリを連結。
- `formatForInjection(entries)` — `WisdomStore.formatForInjection` を委譲。
- `loadAll()` — 永続ストレージから両 store を復元する処理。
- `persistAll()` — `WisdomPersistence.saveAtomic` を用いて、両 store を並列かつ atomic に永続化する。

**振り分けマトリクス:**

| Category | Default scope |
|---|---|
| `environment_quirk` | global |
| `success_pattern` | global |
| `failure_gotcha` | local |
| `design_decision` | local |

**ローカル優先の読み込み挙動:** `localEntries.length >= maxEntries` なら global は参照されない。`WisdomStore.getRelevant` は配列末尾（新しいもの）から `slice(-limit)` する既存挙動を引き継ぐ。

---

## 6. ファイル I/O インターフェース (File I/O Interfaces)

すべてのファイル入出力（I/O）は、完全なユニットテストの可用性を持たせるために2つのインターフェースによって抽象化されています：

```typescript
interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
}

interface FileWriter {
  writeFile(path: string, content: string): Promise<void>;
}
```

**`NodeFileSystem`** クラスは、`Bun.file` や `node:fs/promises` を用いて、これら両方のインターフェースを実際に実装しています。

**セキュリティ:** すべての引数パスは、パストラバーサル攻撃を防ぐためにルートディレクトリに基づき正当性検証されます。
シンボリックリンクについても比較の前に `realpath` で厳密に解決します。

---

## 7. エラー時の処理 (Error Handling)

### 7.1 定められた3層エラー戦略

```text
タスク `task()` 実行内でエラーが発生
        │
        ▼
ErrorClassifier.classify() による分類チェック
        │
   ┌────┼───────────────┐
   │    │               │
第1層  第2層         プロバイダ層
(自動) (エスカレート) (基盤/設定)
   │    │               │
   ▼    ▼               ▼
OmOに  エラーを抽出し   provider_transient:
完全に  `plan.md` 等へ   OmOに委ねる
委ね   修復のための     provider_config:
自動修復 指示とガイダンス  要手動介入として
を見守る を追加する       報告する
```

第1層（`syntax_error`, `type_error`）、第2層（`test_failure`, `design_error`）、およびプロバイダ層（`provider_transient`, `provider_config`）の3層構造でエラーを管理します。

| カテゴリ | 対象エラー | ハンドリング・セマンティクス | リトライ / 中断 | エスカレーション |
| :--- | :--- | :--- | :--- | :--- |
| **第1層** | `syntax_error`, `type_error` | OmOによる自動修復を期待するパス。 | 自動リトライ（最大3回） | なし（暗黙的修復） |
| **第2層** | `test_failure`, `design_error` | ロジックや設計の問題。デバッグ指示を注入するパス。 | 即時中断 (Abort) | あり (`plan.md`への注入) |
| **プロバイダ層 (一時的)** | `provider_transient` | Rate Limitや一時的なAPIエラー。OmO側の基盤再試行に委ねるパス。 | 即時中断 (Abort) | なし (基盤層へ委譲) |
| **プロバイダ層 (致命的)** | `provider_config` | API Key欠如や無効なモデル設定。ユーザーの直接介入が必要なパス。 | 即時中断 (Abort) | ユーザーへ通知 |

表の定義とこのフローを一致させることで、各エラー発生時のハンドリングパスを明確化しています。

### 7.2 タイムアウト・およびループ検出時

この二つについては即時中断（Abort）し、強制的に `TaskSplitter` 経由による分割指示が生成されます:

> "Task was interrupted because it was too complex or entered an infinite loop.
> Split the task into smaller steps and update plan.md."
> （翻訳：指示されたタスクは複雑すぎるか、無限ループに陥ったため強制中断されました。この状況を解消するため、計画のステップを細分化し plan.md に反映してください）

### 7.3 Fail-Open の指針（フェイルオープン）

Hook 内で呼び出されるファイル入出力は `try/catch` 内でラップされ例外として捕捉されます。ログはデバッグ用途で出力されますが、このプラグイン自体の実行時エラーとしては OmO 側に伝播しません。プラグインは問題なく動作しているかのように必ず有効な `HookResponse` のどれかを返却し、安全に実行を後退させます。

---

## 8. OmO への統合 (OmO Integration)

### 8.1 インストール手順

通常の Node.js パッケージ（ライブラリ）としてインポート・インストール可能です:

```bash
bun add justice-plugin
```

### 8.2 設定ファイルへの記述構成 (`oh-my-opencode.jsonc`)

```jsonc
{
  "hooks": {
    "custom": [
      {
        "name": "justice-plan-bridge",
        "event": ["Message", "PreToolUse"],
        "source": "./node_modules/justice-plugin/dist/hooks/plan-bridge.js"
      },
      {
        "name": "justice-task-feedback",
        "event": ["PostToolUse"],
        "source": "./node_modules/justice-plugin/dist/hooks/task-feedback.js"
      },
      {
        "name": "justice-compaction-protector",
        "event": ["Event"],
        "source": "./node_modules/justice-plugin/dist/hooks/compaction-protector.js"
      },
      {
        "name": "justice-loop-handler",
        "event": ["Event"],
        "source": "./node_modules/justice-plugin/dist/hooks/loop-handler.js"
      }
    ]
  }
}
```

---

## 9. ディレクトリ構造 (Directory Structure)

```text
justice/
├── src/
│   ├── core/
│   │   ├── types.ts                  — すべての型の定義
│   │   ├── plan-parser.ts            — Markdownによるプランのパーサー
│   │   ├── task-packager.ts          — PlanTask から DelegationRequest の変換処理
│   │   ├── error-classifier.ts       — エラー分類およびリトライロジック
│   │   ├── feedback-formatter.ts     — task() の出力解析
│   │   ├── plan-bridge-core.ts       — プランと委譲を繋ぐ中核の純粋ロジック
│   │   ├── trigger-detector.ts       — 委譲キーワードの検出・識別
│   │   ├── smart-retry-policy.ts     — 指数バックオフおよびコンテキスト縮減処理
│   │   ├── task-splitter.ts          — タスクが失敗した際の分割提案生成
│   │   ├── wisdom-store.ts           — 学習内容のオンメモリ格納
│   │   ├── learning-extractor.ts     — フィードバックから学習内容を抽出する処理
│   │   ├── wisdom-persistence.ts     — WisdomStore のファイルI/O
│   │   ├── dependency-analyzer.ts    — タスク依存関係と先行処理等の解析
│   │   ├── category-classifier.ts    — タスクのカテゴリを自動判定する機能
│   │   ├── progress-reporter.ts      — 各タスク進捗からの集計レポート生成
│   │   ├── status-command.ts         — 命令からのステータス確認API
│   │   └── justice-plugin.ts         — これらを繋げるオーケストレーターとイベントの共有箇所
│   ├── hooks/
│   │   ├── plan-bridge.ts            — Message/PreToolUse にバインドされるフック
│   │   ├── task-feedback.ts          — PostToolUse エラー処理等へのフィードバック
│   │   ├── compaction-protector.ts   — コンパクションから身を守って保持するフック
│   │   └── loop-handler.ts           — ループを検知するためのフック
│   ├── runtime/
│   │   └── node-file-system.ts       — 実際の Bun.file ベースによるファイルの読み書き
│   └── index.ts                      — 上記の外部・公開APIの全エクスポート
├── tests/
│   ├── core/          — コア層に対する 22 のテスト用ファイル群
│   ├── hooks/         — フック層に対する 4 つのテスト・ファイル群
│   ├── integration/   — 全体を統合・通貫した機能テストを対象の 6 つのテスト
│   ├── runtime/       — ランタイムファイル書き出しの検証（1 テストファイル）
│   ├── helpers/
│   │   └── mock-file-system.ts       — インメモリベースのファイル操作モック
│   └── fixtures/
│       ├── sample-plan.md
│       ├── sample-plan-partial.md
│       └── sample-design.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── AGENTS.md
└── SPEC.md            — 本ファイル
```

---

## 10. テクノロジースタック (Tech Stack)

| ツール名 | バージョン | 主要目的 |
|------|---------|---------|
| TypeScript | 6.x | 言語と静的型推論 |
| Bun | 最新 (Latest) | ランタイム環境/パッケージマネージャ |
| Vitest | 4.x | 高速なテスト用フレームワーク |
| ESLint | 10.x | 静的コード解析 (Linting) |
| Prettier | 3.x | コードフォーマッタ |

**TypeScript 設定のハイライト:**

- `strict: true` (厳格モードでの型推論)
- `noUncheckedIndexedAccess: true` (未定義な配列等アクセスへの例外制限)
- `noUnusedLocals: true`, `noUnusedParameters: true` (未使用のものに対する警告)
- コンパイル・モジュールターゲット: `ES2022`, Module: `ESNext`

---

## 11. テストカバレッジ・状態 (Test Coverage)

### 11.1 テスト件数の内訳 (*Phase 7 完了時に基づく*)

| 解析層 | 対象となるファイル数 | サンプルテスト件数 |
|-------|-------|-------|
| コアロジック部 | 22 ファイル | 約 250 件 |
| フック・ハンドラ群 | 4 ファイル | 約 40 件 |
| ランタイム処理 | 1 ファイル | 9 件 |
| 実環境・結合検証 | 7 ファイル | 約 28 件 |
| **合計総数** | **34 テストファイル** | **327 件** |

### 11.2 テスト戦略と方針

- **コアロジック層の検証**: 目標はカバレッジ100%。すべての関数やインスタンスはI/O抜きでモックによる実行検証がされています。
- **フック層における連携**: I/Oには `FileReader`・`FileWriter` モックオブジェクトを流し込んだ統合的なテストを実施。
- **実行・ランタイムベースのテスト**: 組み込みの `mkdtemp` を用いた一時ディレクトリの生成による実際のファイルアクセス。
- **全体における統合テスト**: フェーズで区切られた要件に対するエンドツーエンドでのライフサイクル。

---

## 12. 公開 API (Public API)

```typescript
// メインとなるオーケストレーターとハブ
export { JusticePlugin, createGlobalFs, NoOpPersistence } from "./core/justice-plugin";

// ステータス、および計画のレポーティングコマンド
export { StatusCommand, type PlanStatus } from "./core/status-command";

// 実際における利用環境からのランタイム
export { NodeFileSystem } from "./runtime/node-file-system";

// （高度な手法での利用に向けた）全公開コアクラス
export { PlanParser } from "./core/plan-parser";
export { TaskPackager } from "./core/task-packager";
export { ErrorClassifier } from "./core/error-classifier";
export { FeedbackFormatter } from "./core/feedback-formatter";
export { TriggerDetector } from "./core/trigger-detector";
export { DependencyAnalyzer } from "./core/dependency-analyzer";
export { CategoryClassifier } from "./core/category-classifier";
export { ProgressReporter } from "./core/progress-reporter";
export { SmartRetryPolicy } from "./core/smart-retry-policy";
export { TaskSplitter } from "./core/task-splitter";
export { WisdomStore } from "./core/wisdom-store";
export { LearningExtractor } from "./core/learning-extractor";
export { WisdomPersistence } from "./core/wisdom-persistence";
export { TieredWisdomStore } from "./core/tiered-wisdom-store";
export { SecretPatternDetector } from "./core/secret-pattern-detector";

// 直接各機能ごとのフックを利用したい場合
export { PlanBridge } from "./hooks/plan-bridge";
export { TaskFeedbackHandler } from "./hooks/task-feedback";
export { CompactionProtector } from "./hooks/compaction-protector";
export { LoopDetectionHandler } from "./hooks/loop-handler";

// 実装に関する全ての型
export type {
  PlanTask, PlanStep, PlanTaskStatus,
  DelegationRequest, DelegationContext,
  TaskFeedback, TaskFeedbackStatus, TestSummary,
  ErrorClass, TaskCategory,
  ProtectedContext, RetryPolicy,
  FeedbackAction,
  HookEvent, HookResponse,
  FileReader, FileWriter,
  WisdomEntry, WisdomCategory,
  EventPayload, LoopDetectorPayload, CompactionPayload,
  SplitSuggestion, SubTaskSuggestion,
  RetryDecision, ContextReduction,
} from "./core/types";
```

---

## 13. 開発の流れ (Development Workflow)

開発における基本的なコマンド群を実行できます。

```bash
# 全ての利用ライブラリと依存のインストール
bun install

# すべてのテスト群を実行する
bun run test

# ファイルの監視モード (変更があるたびテスト再起)
bun run test:watch

# TypeScript 静的構文解析
bun run typecheck

# Linter（修正箇所の指摘）
bun run lint

# Prettier フォーマット（自動整形）
bun run format

# 生成・配備フォルダへのコンパイル (\dist 出力)
bun run build
```

---

## 14. 今後の予定 (Roadmap)

| 開発の機能内容 | ステータス |
|---------|--------|
| Phase 1: 開発基盤の確立 (Foundation) | ✅ 完了 |
| Phase 2: プランデータの連携と委譲 (Task Delegation Bridge) | ✅ 完了 |
| Phase 3: エラー判定と実行フィードバック (Feedback Loop) | ✅ 完了 |
| Phase 4: 高度な再試行とエラーハンドリング (Advanced Error Handling) | ✅ 完了 |
| Phase 5: 知恵としてのデータ蓄積 (Wisdom Integration) | ✅ 完了 |
| Phase 6: オーケストレーションによる並行協調の確立 (Multi-Agent Coordination) | ✅ 完了 |
| Phase 7: 実環境への統合オーケストレーター構築 (Plugin Orchestrator & Runtime) | ✅ 完了 |
| 拡張 CLI 用途のサポート (`justice init`, `justice status` など) | 🔲 計画中 |
| VSCode 拡張機能などへのアダプタ | 🔲 計画中 |
| Claude Code との連携における互換性の見直し | 🔲 計画中 |
| Custom Skill SDK の提供 | 🔲 計画中 |
