# Justice Plugin — 仕様書

> **バージョン**: 2.5.0
> **ステータス**: プロダクションレディ (v1: Phase 1-9 完了 / v2.0: Quality Control Plane 基盤 完了・L0 Advisory)
> **最終更新日**: 2026-07-28

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
└──────────────────────────────────────────────────────┘
```

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
  readonly agentId?: AgentId;           // AgentRouter による割り当て
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
  readonly persona: AgentId;        // 実行したペルソナ
}

type WisdomEntryDraft = Omit<WisdomEntry, "id" | "timestamp" | "persona"> & {
  readonly persona?: AgentId;       // Draft 段階では未確定可
};

interface AddOptions {
  readonly scope?: WisdomScope;
  readonly persona?: AgentId;       // 明示指定で上書き可能
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

### 4.0 イベントルーティング概要（`JusticePlugin.handleEvent()`）

すべての Hook イベントは `JusticePlugin.handleEvent()` を経由し、以下のとおりルーティングされる（v1 + v2 合流済み）。各ハンドリングの詳細は §4.1〜4.4（v1）と §15.2（v2 ObservationHandler）を参照。ただし OpenCode `command.execute.before`（`/justice-start`）のみ例外で、`JusticePlugin.handleEvent()` を経由せず `OpenCodeAdapter` が `PlanBridge.handleWorkflowStart()` を直接呼び出す（詳細は §4.1a）。

```text
Message          → PlanBridge.handleMessage() (user message) / ObservationHandler.handleMessage() (declared claim payload)
PreToolUse       → PlanBridge.handlePreToolUse()  (task のみ)
                 → ObservationHandler.handlePreToolUse()  (task 窓の callId 単位登録, D74)
                   * Merged using mergePreToolUseResponses() in JusticePlugin
PostToolUse      → PlanBridge.handlePostToolUse()  (Plan Completion, Prometheus Pivot)
                 → TaskFeedbackHandler.handlePostToolUse()  (Task Checkboxes, Wisdom extraction)
                 → ObservationHandler.handlePostToolUse()  (Observation Log append, Gate evaluation)
                   * Merged using mergePostToolUseResponses() in JusticePlugin
Event:compaction → CompactionProtector
Event:loop-*     → LoopDetectionHandler
Event:session.error → ObservationHandler.handleSessionError()  (all session.error: session_error record + ReflectionEvent seam)
                    → LoopDetectionHandler  (conditional fan-out only when message matches LOOP_ERROR_PATTERNS)

command.execute.before  → PlanBridge.handleWorkflowStart()  (`justice-start` コマンドのみ。handleEvent() 非経由の直接ディスパッチ。詳細は §4.1a)
```


### 4.1 `plan-bridge` — タスク委譲と参謀誘導の連携

| プロパティ | 設定値 |
|----------|-------|
| OmO イベント | `Message`, `PreToolUse`, `PostToolUse` |
| トリガー (Message) | エージェントのメッセージ内に `plan.md` の参照 *および* 委譲キーワードが含まれている場合 |
| トリガー (PreToolUse) | `task()` ツールが呼び出され、*かつ* アクティブなプランが登録されている場合 |
| トリガー (PostToolUse) | `task()` ツールが終了し、*かつ* 該当セッションで `writing-plans` / `systematic-debugging` スキルの完了、または Prometheus レビュー却下が検知された場合 |

**Message イベントの流れ（フロー）:**

1. `TriggerDetector.analyzeTrigger(content)` — プランの参照と委譲の意図を検出する（`src/hooks/plan-bridge.ts` で実行）
2. `FileReader.fileExists(planPath)` — プランファイルが存在することを確認する
3. `FileReader.readFile(planPath)` — プランのコンテンツを読み込む
4. `DependencyAnalyzer.getParallelizable(tasks)` — 並行処理可能なタスクを特定する
5. `CategoryClassifier.classify(task)` — カテゴリを自動選択する
6. `ProgressReporter.generateReport(tasks)` — 進捗状況を算出する
7. `WisdomStore.getRelevant({ persona: agentId ?? "hephaestus" })` — 関連する学習内容（Wisdom）を、セッション情報またはデフォルトのペルソナ（`"hephaestus"`）で絞り込んで取得する
8. 委譲コンテキストをすべて含んだ `inject`（注入）レスポンスを返す

**PreToolUse イベントの流れ（フロー）:**

1. `PlanCompletionDetector.recordPreToolUseInvocation(sessionId, toolName, toolInput)` — スキル（`writing-plans`, `systematic-debugging`）の起動保留と、`toolInput` に基づく実行ペルソナ（`AgentId`）の推定と記録を行う。
2. **ペルソナの特定と Wisdom 取得**:
   以下の優先順位で Wisdom 注入対象のペルソナを特定し、`tieredWisdomStore.getRelevant({ persona })` を呼び出す。
   *   **優先順位 1**: 委譲時に設定された `delegation.context.agentId` が**解決可能（resolvable）**であればそれを採用。
   *   **優先順位 2**: 未解決の場合、`PlanCompletionDetector.lastInvokedPersona(sessionId)`（`toolInput` から推定されるペルソナ）を採用。
   *   **優先順位 3**: いずれも未解決の場合は `"hephaestus"`（デフォルト）にフォールバックする。
3. **「解決可能（resolvable）」の判定基準（predicate）**:
   対象の値が非空文字列であり、かつ大文字小文字を無視した状態で `AgentId` リテラルユニオン（`"atlas" | "hephaestus" | "sisyphus" | "prometheus"`）のいずれかに含まれる場合に「解決可能」とみなす。`undefined`、`null`、空文字列、空白のみの文字列、`"unknown"` などのプレースホルダは**未解決**として扱う。
4. 取得された Wisdom をプロンプトの `PREVIOUS LEARNINGS` コンテキストとして注入する。

**PostToolUse イベントの流れ（フロー）:**

1. **評価実行**:
   `PlanCompletionDetector.evaluateSkillCompletion` を呼び出し、`writing-plans` と `systematic-debugging` スキルの完了判定、および直前のペルソナが `"prometheus"` であれば `LoopDetectionHandler.recordReviewOutput` を呼び出して却下状態を判定します。
2. **Atlas Guidance の注入 (writing-plans 完了)**:
   計画フェーズの完了を検知すると、`[ATLAS ORCHESTRATION DIRECTIVE]` プロンプトを生成し、自ら実装を進めずに次のタスクをエージェントに委譲するよう強く誘導します。`injectedContext` 先頭にバナー（🎯）を埋め込み、同時に `atlas_orchestration` 通知を送信します。

   **プロンプトテンプレート:**
   ```text
   ---
   [ATLAS ORCHESTRATION DIRECTIVE]

   **Plan completed**: <planPath>
   **Detection source**: <skill_marker | result_marker | result_path>

   ⚠️ **重要**: Atlas として、ここからは自ら実装に着手せず、計画書に従って委譲してください。

   **次のアクション**:
   > Step <task-id> "<title>" を `<recommended-agent>` に委譲してください。

   **推奨エージェント**: <hephaestus | sisyphus | prometheus>
   （根拠: <カテゴリ・スキル・スコアサマリ from AgentRouter>）

   **委譲用プロンプト**:
   <delegation.prompt>

   **並列実行候補**: <task-X, task-Y, ...>
   ---
   ```
   *※ `confidence: medium` で計画完了を検知した場合は、末尾に「（自動検知。意図と異なる場合は無視可）」の注記が自動で追加されます。*
3. **Sisyphus Wisdom の自動保存 (systematic-debugging 完了)**:
   デバッグスキルの完了を検知すると、`LearningExtractor` にて `persona: "sisyphus"` として Wisdom を抽出して保存し、件数をバナー（🔬）および `sisyphus_insight` 通知で報告します。
4. **Hephaestus への Pivot 注入 (Prometheus 連続却下)**:
   Prometheus 却下回数が閾値に達すると、`[ARCHITECTURE PIVOT REQUIRED]` プロンプトを生成し、通常の試行ループを絶ってアプローチの根本的な見直し（Hephaestus へのピボット）を指示します。警告バナー（🚧）と `architecture_pivot` 通知を送信します。

   **プロンプトテンプレート:**
   ```text
   ---
   **ARCHITECTURE PIVOT REQUIRED**

   Prometheus が直近 <N> 回のレビューで連続して却下を出しています（閾値: <maxRejections>）。
   このアプローチは手詰まりです。**通常の再試行ループを断ち、別の視座でアーキテクチャを再検討してください。**

   **検討すべき選択肢**:
   1. 採用ライブラリの変更（同等機能で軽量・成熟したもの）
   2. アプローチの簡略化（過剰な抽象化を削減）
   3. 機能スコープの縮小（YAGNI 適用）
   4. データ構造の根本的な見直し

   **直近の Prometheus 指摘抜粋**:
   - <excerpt 1>
   - <excerpt 2>
   - <excerpt 3>

   **次のアクション**:
   > Hephaestus は、この pivot 指示に従って **別の実装アプローチ** を提案し、再実装してください。
   > 同一の方針での修正は禁止です。
   ---
   ```

#### PostToolUse レスポンスの合成ルール (`mergePostToolUseResponses`)

複数の PostToolUse イベントによって生成された `HookResponse` は、以下の優先順位と合成ルールに従って単一のレスポンスにマージされます。

1. **`skip` アクションの優先**: いずれかのレスポンスに `action: "skip"` が含まれている場合、最優先で全体のアクションを `skip` とします。
2. **`proceed` 同士の合成**: 両方のレスポンスが `action: "proceed"` の場合、そのまま `proceed` を返します。
3. **`inject` と `proceed` の合成**: 一方が `action: "inject"` でもう一方が `proceed` の場合、`inject` 側のレスポンスを採用します。
4. **`inject` 同士の合成**: 両方が `action: "inject"` の場合、双方の `injectedContext` を `\n\n---\n\n` で連結して合成した `inject` レスポンスを生成します。

**セッション状態:**

- `Map<sessionId, planPath>` — セッションごとに状態を分離（`PlanBridge.activePlanPaths`）
- ※ `PlanBridge` では TTL/LRU によるクリーンアップは実施されません。この管理責務は `TaskFeedbackHandler` または他のコンポーネントに委ねられます。

**委譲キーワード (英語/日本語対応):**

`delegate`, `next task`, `execute task`, `run task`, `start task`,
`次のタスク`, `タスクを実行`, `タスクを委譲`, `タスクを開始`

---

### 4.1a `/justice-start` — ワークフロー・ブートストラップ (OpenCode コマンドフック)

| プロパティ | 設定値 |
|----------|-------|
| OpenCode フック | `command.execute.before`（`JusticePlugin.handleEvent()` を経由しない直接ディスパッチ） |
| トリガー | コマンド名が `justice-start`（先頭スラッシュの有無は許容、それ以外は完全一致）の場合のみ。他コマンドは初期化すら発生しない完全ノーオペ。 |
| クロスハーネス fallback | チャットメッセージ中の `Justice: start workflow`（行頭・完全一致・大文字小文字区別）を `parseWorkflowStartFallbackMarker()` でパース可能だが、**現状 `PlanBridge.handleMessage()` からは呼び出されておらず未接続**（将来のクロスハーネス統合のための予約形式）。 |

**フロー:**

1. `isJusticeStartCommand(input.command)`（`src/core/trigger-detector.ts`）でコマンド名を判定。`false` なら初期化も行わず即 return。
2. `parseWorkflowStartCommandArguments(input.arguments)` — 純粋パーサーが goal と `--design`/`--plan` の安全な相対パスを抽出する。未知のフラグ、値のないフラグ、重複フラグ、安全でないパス（絶対パス・バックスラッシュ・`..`）、goal 欠落はすべて `null` として扱われ、例外は投げない（生引数は非echo）。
3. `null` の場合は warn ログのみ出して return（fail-open）。パースに成功した場合のみ `ensureInitialized()` を実行する。
4. `PlanBridge.handleWorkflowStart(sessionId, request)` を呼び出す:
   a. `resolveBootstrapPhase(request)` — **design → plan → 実行可能の順にちょうど1つのフェーズを選択**。`designPath` が指定され読めない場合は、`planPath` が読めるかどうかに関わらず常に `"design_required"` が優先される。
   b. セッションごとの bootstrap 状態（phase・request）を保存する。`destroySession()` で削除される。
   c. `ObservationHandler` が設定されている場合のみ、`workflow_started` と `design_requested`/`plan_requested`/`plan_activated` のいずれか1件を `emitWorkflowStartedEvent()`/`emitWorkflowPhaseEvent()` 経由で `Promise.allSettled` により並行発火する（best-effort）。`ObservationHandler` が `null` の場合はイベント発火自体を行わずスキップする。`Promise.allSettled` の個別失敗（片方または両方）は通知のみに使われて握り潰され、ガイダンス生成（後述 5.）は audit イベントの成否に関わらず常に継続する（fail-open）。
   d. `phase === "plan_ready"` の場合のみ `setActivePlan()` でプランを活性化する。それ以外は `setActivePlan(null)` に加え完了入力のクリアを行う。
5. `result.guidance` が空でなければ、フェーズ別ガイダンス文字列を synthetic な `output.parts` テキストパートとして追記する。

**実行権限との関係:** `PlanBridge.handleWorkflowStart()` は `task()` を一切呼び出さない（自動でのサブエージェント委譲やスキル起動は行わない）。ガイダンス文字列の提示に留め、実際の `task()` 呼び出しは常にエージェント自身の後続アクションに委ねる — Justice はここでも「神経系」であり「手足」ではない。

**Gate との関係:** `workflow_started`/`design_requested`/`plan_requested`/`plan_activated` レコードは `evidence` フィールドを一切持たない audit-only レコードであり（§15.3）、`state-projection.ts` が `ProjectedState.tasks[].evidence` への投影対象から明示的に除外する。したがって Gate の PASS 判定にこれらのレコードが算入される経路は構造的に存在しない（FF-008 が自明に成立）。

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
| 成功 (Success) | `plan.md` の該当全ステップに ✅ を付け、成功メッセージを注入し、学習内容を抽出する（学習抽出時には、セッション情報から得られたペルソナ情報を `LearningExtractor.extract` に伝播して保存ペルソナを決定） |
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

### 4.4 `loop-handler` — ループ検出とレビュー却下の管理

| プロパティ | 設定値 |
|----------|-------|
| OmO イベント | `Event` (eventType: `"loop-detector"`), `PostToolUse` (間接呼び出し) |

**イベントフロー (eventType: loop-detector):**

1. セッションから現在アクティブなタスクおよび実行中のエージェントを検出
2. エージェントの失敗試行として記録を残し、試行履歴（Trial History）を更新（※試行履歴はインメモリでのみ管理され、セッション終了・再起動のタイミングでリセットされる）
3. `TaskSplitter.suggestSplit(task, "loop_detected")` — 分割の提案を生成
4. `PlanParser.appendErrorNote(content, taskId, note)` — エラー情報を `plan.md` に書き込む
5. エスカレーション判定: 失敗回数が `MAX_RETRIES_BEFORE_ESCALATION` (デフォルト 3) 以上の場合、`sisyphus` (デバッグ特化) への強制ルーティング（エスカレーション）を指示
6. `plan.md` と互換性のある Markdown 形式のタスク分割提案とエスカレーション情報を含んだ `inject` （注入）レスポンスを返す

**レビュー却下判定フロー (recordReviewOutput):**
1. `ReviewRejectionDetector` にて Prometheus の出力内に却下マーカーを検出します。
2. 検出時、該当セッション・タスクの `rejections` カウントをインクリメントし、指摘箇所（最大3件、各200文字以下）を抜粋（Excerpts）として蓄積。また、`recordTrial` にて `agent: "prometheus", result: "failure"` として失敗履歴に連動して記録します。
3. 連続却下数が `MAX_REVIEW_REJECTIONS_BEFORE_PIVOT` （環境変数、またはデフォルト3）以上の場合、`pivoted: true` で Hephaestus へのアーキテクチャ・ピボット指示を発火させます。
4. 却下マーカーが検出されない正常終了の場合、該当タスクの `rejections` と `rejectionExcerpts` の記録をクリア（リセット）します。
5. セッション破棄 (`removeSession`) 時には、関連する全ての却下カウンタ・履歴（`trials`, `reviewRejections`, `rejectionExcerpts`）を一括消去します。

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

`PlanTask` オブジェクトを、構造化されたプロンプトを含む `DelegationRequest` に変換します。内部的に `CategoryClassifier` と `AgentRouter` を呼び出し、タスクの性質に適したエージェントへのルーティングも担当します。

**生成されるプロンプトの構成:**

```text
**AGENT**: <agentId>
[役割のプロンプト (任意指定)]
## 実行タスク: <title>
## ステップ一覧: <ステップのリスト>
## コンテキスト: プラン: <path>, タスク ID: <id>
## 参照すべきファイル: <関連ファイルリスト>
## 過去の学習内容: <関連するWisdomのリスト>
```

※ `agentId` が未指定（`undefined`）の場合は、`**AGENT**: <agentId>` の行全体を省略する。

---

### 5.3 `TriggerDetector`

エージェントのテキストメッセージ内から、タスクを委譲したいという意図 (`delegation intent`) を検出します。

**`detectPlanReference(message)`** — `*.plan*.md` または `plan.md` のパターンに正規表現でマッチング。

**`detectDelegationIntent(message)`** — 委譲に必要なキーワード（英語・日本語）にマッチング。

**`shouldTrigger(message)`** — 上記の両方が `true` の場合のみ起動。

**`parseWorkflowStartCommandArguments(rawArguments)`** / **`isJusticeStartCommand(commandName)`** — `/justice-start` コマンドの引数文字列を `WorkflowStartRequest`（goal・安全な相対パスに正規化された `designPath`/`planPath`）へ変換する純粋パーサー。未知フラグ・重複フラグ・値なしフラグ・安全でないパス・goal 欠落はすべて `null` として扱う（例外を投げない）。

**`parseWorkflowStartFallbackMarker(message)`** — クロスハーネス向けの `Justice: start workflow` マーカー（行頭・完全一致）をパースする。現状 `PlanBridge.handleMessage()` からは未接続（予約形式、§4.1a 参照）。

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

これまで蓄積した学習のエントリを保存するインメモリ（オンメモリ）ストア。実行ペルソナ（`AgentId`）ごとの独立したバケット（`Map<AgentId, WisdomEntry[]>`）で学習内容を管理します。

**`add(entry, options?)`** — 新規追加時に `id` および `timestamp` は自動で生成されます。ペルソナは優先順位（`options.persona` ＞ `entry.persona` ＞ `PersonaClassifier` による自動分類）に従って確定されます。

**`getRelevant({ errorClass?, maxEntries?, persona? })`** — 指定されたペルソナ（`persona`）で絞り込み、エラーの種別でフィルタリングして、最新から指定件数を取得します。

**`formatForInjection(entries)`** — 取得したエントリ群を Markdown の `PREVIOUS LEARNINGS` セクション形式へフォーマットします。ペルソナが混在する場合は、自動的に `**[JUSTICE AI: Past Learnings for <Persona>]**` ヘッダによるペルソナ別のグループ化を行います。

**`serialize()` / `WisdomStore.deserialize(json)`** — ファイルの永続化向けに JSON 文字列への相互変換をサポートします。

**デフォルト制約:** 最大 100 件。エントリ数が上限を超過した際は、特定のペルソナバケットに偏らないよう、ストア全体で最も古いタイムスタンプを持つエントリが含まれるバケットから順に削除（LRU Eviction）します。

---

### 5.12 `LearningExtractor`

`TaskFeedback` の結果から `WisdomEntry` へと学習草案を抽出します。

**`extract(feedback, rawOutput?, context?)`** — フィードバックと生の実行出力から、学習のドラフト（`WisdomEntryDraft`）を抽出します。`context.persona` が指定されている場合はそのペルソナを優先し、未指定の場合は `PersonaClassifier` に基づいて自動的にペルソナを割り当てます。

**抽出に関するルール:**

| 状況判定 | 保存するカテゴリ | 抽出するコンテンツ内容 |
|-----------|----------|---------|
| taskが成功 + 全テストに通過 | `success_pattern` | 成功時のテストのカウント数 |
| taskが失敗 + test_failure が原因 | `failure_gotcha` | 失敗に関連する詳細出力 |
| taskが失敗 + design_error が原因 | `design_decision` | ロジック・出力された結果の重要スニペット |
| timeout による失敗 | `environment_quirk` | その時点のコンテキスト情報 |
| 実質リトライが2回以上発生した後での成功 | `failure_gotcha` | 「N回のリトライの末に成功した点」について |
| `systematic-debugging` 完了かつ `rawOutput` に根本原因マーカー（`Root cause:` / `根本原因:`）を含む成功 | `design_decision` | 根本原因の特定内容と修正アプローチの要約 |

**ペルソナの連携**:
`TaskFeedbackHandler.setActivePlan(plan, agentId?)` 経由でフック実行時のエージェント名（ペルソナ）がセッション内で追跡され、学習抽出時に自動的に `extract` メソッドの `context.persona` に伝播されて保存されます。

**サニタイズ（機密情報の除外処理）:** データベースや API キー、パスワード、トークンのようなセキュリティに関する情報が保存される前にそれらのパターンをマスクし、無効化します。

---

### 5.13 `WisdomPersistence`

`WisdomStore` 内の内容をローカルファイルの `.justice/wisdom.json` へ永続化（保存）および読み込みを行います。書き込み時には、I/O処理による破損を防ぐためテンポラリファイルへ書き込んでから置換するアトミック永続化（`saveAtomic`）を使用します。

**`load()`** — ファイルからの復元。ファイルが存在しない場合や内容が破損している場合は、空の `WisdomStore` を返して処理を続行します（Fail-Open設計）。

**`loadStrict()`** — より厳格な復元処理。JSON解析エラー時に例外をスローします。

**v1 → v2 自動マイグレーション:**
永続化ファイルが旧形式（`entries` 配列形式の v1）である場合、ロード時に自動検知され、各エントリに対して `PersonaClassifier` を使用してペルソナを推定・付与した上で、新形式（`byAgent` にペルソナ別に格納される v2）へ透過的にマイグレーションして展開します。

**`saveAtomic(store)`** — ストア内容をペルソナ別の PascalCase ラベル（`Atlas`, `Hephaestus`, `Sisyphus`, `Prometheus`）に整理し、常に v2 フォーマットでディスクにアトミックに書き込みます。

*   **マージ時の競合解決（`mergeById`）**: 書き込み前にディスク上のデータとメモリ上のデータをマージする際、同一 ID（`id`）を持つエントリが双方に存在する場合、タイムスタンプ（`timestamp`）がより新しい側の `persona` を優先して採用します。

**シリアライズ境界における大文字・小文字の変換規約:**
*   **メモリ・内部API上**: 常に小文字の `AgentId`（`"atlas"`, `"hephaestus"`, `"sisyphus"`, `"prometheus"`）を使用し、判定処理の不整合を防ぎます。
*   **シリアライズ（ディスク書き出し）境界**: 永続化ファイル `wisdom.json` のキー（`byAgent` フィールド）には、PascalCase のラベル（`"Atlas"`, `"Hephaestus"`, `"Sisyphus"`, `"Prometheus"`）に変換して出力します。
*   **デシリアライズ（ディスク読み込み）境界**: ファイルからロードした PascalCase のラベルを、小文字の `AgentId` に変換してストアに格納します。定義されていない未知のペルソナラベルが検出された場合は、fail-open 規約に基づき無視されます。

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
- `getRelevant({ errorClass?, maxEntries?, persona? })` — 指定されたペルソナ（`persona`）に紐づく知見を対象に、ローカル優先で取得し、不足分を global から補填して重複排除した結果を返します。デフォルト `maxEntries=10`。
- `getByTaskId(taskId)` — 両 store の該当エントリを連結。
- `formatForInjection(entries)` — `WisdomStore.formatForInjection` を委譲し、混在時のペルソナグループヘッダ出力をサポートします。
- `loadAll()` — 永続ストレージから両 store を復元する処理。
- `persistAll()` — `WisdomPersistence.saveAtomic` を用いて、両 store を並列かつ atomic に永続化する。

**振り分けマトリクス:**

| Category | Default scope |
|---|---|
| `environment_quirk` | global |
| `success_pattern` | global |
| `failure_gotcha` | local |
| `design_decision` | local |

**ローカル優先の読み込み挙動:** `localEntries.length >= maxEntries` なら global は参照されない。`WisdomStore.getRelevant` は配列末尾（新しいもの）から `slice(-limit)` する既存挙動を引き継ぎます。

---

### 5.17 `AgentRouter`

`CategoryClassifier` で判定されたカテゴリと、要求されるスキル (Skills) に基づき、タスクを最適なエージェント (`hephaestus`, `sisyphus`, `prometheus`, `atlas`) へルーティングします。

**ルーティング判定ロジック (`AgentRouter` での実行順序):**

1. **スコア計算 (Affinity × Context):**
   各スキルのベーススコア (`Affinity Matrix`) に、カテゴリに応じた倍率 (`Context Multiplier`) を乗算し、すべてのエージェントの合計スコア（スコアボード）を確定させます。
2. **Dominant Override (強制オーバーライド):**
   スコア計算の実行後、特定の重要スキル（`code-quality-reviewer`, `spec-reviewer`）が要求されているかを確認します。これらが含まれる場合、計算されたスコアに関わらず `prometheus` へのルーティングを強制します。これは、実装担当エージェントが自身のコードをレビューする「自己レビュー競合」を物理的に防止するための設計です。
3. **最高得点者の選定:**
   オーバーライドが発生しなかった場合、スコアボードの中で最も高い得点を持つエージェントを選択します。
4. **Fallback:**
   すべてのスコアが 0 または判定不能な場合、最終的にデフォルトエージェント (`hephaestus`) が選択されます。

---

### 5.18 `PersonaClassifier`

Wisdom のカテゴリとエラークラスから、実行ペルソナ（`AgentId`）を自動的に分類・決定します。

**優先順位判定ルール:**
1. `errorClass === "design_error"` の場合 → `"atlas"`
2. `errorClass` が `"loop_detected"` または `"timeout"` の場合 → `"sisyphus"`
3. `category === "design_decision"` の場合 → `"atlas"`
4. `category === "environment_quirk"` の場合 → `"sisyphus"`
5. `category` が `"success_pattern"` または `"failure_gotcha"` の場合 → `"hephaestus"`
6. それ以外の場合は、デフォルトとして `"hephaestus"` を返却。

---

### 5.19 `ReviewRejectionDetector`

Prometheus レビューコメント等から却下（Rejection）シグナルと関連する指摘内容を抽出します。

**主な機能:**
*   **`detect(text)`** — 指定された文字列内のレビュー却下メッセージを検出し、`ReviewRejectionSignal` （陽性判定、指摘抜粋配列、および300文字以下の要約）を生成して返します。
*   **却下パターン (`REVIEW_REJECTION_PATTERNS`)**:
    `reject`, `cannot approve`, `approval denied`, `requested changes`, `MUST FIX`, `BLOCKER`, `critical issue`, `❌`, `do not merge` などの表現、および日本語の「不承認」「却下」「要修正」「致命的」「ブロッカー」等のマーカーを正規表現で捕捉します。

---

### 5.20 `PlanCompletionDetector`

A+B ハイブリッド完了検知アプローチを実装し、セッション保留状態を用いて計画フェーズおよびデバッグタスクの完了を検出します。

**主な機能:**
*   **`recordPreToolUseInvocation(sessionId, toolName, toolInput)`** — `PreToolUse` にて `writing-plans` や `systematic-debugging` スキルの起動が検出された場合、セッションごとに保留フラグをメモリに登録します（TTL: 5分、最大50セッション）。また、`toolInput` から次に実行されるペルソナを推定・記録します。
*   **`evaluateSkillCompletion(sessionId, toolName, toolResult, isError, target)`** — 保留フラグに基づく `confidence: "high"`、または `toolResult` の成果物パス/マーカー（`## Architecture` + `## Implementation` または根本原因マーカー）一致による `confidence: "medium"` でタスクの完了を検出します。判定後、対象ターゲットの保留フラグのみを消去します（他ターゲットの保留状態には干渉しません）。`isError: true` の場合は完了とみなしません。
*   **`lastInvokedPersona(sessionId)`** — 最後に登録された推定ペルソナ（`AgentId`）を返します。
    *   **ペルソナの推定優先順位**:
        1. `toolInput.agent`（`atlas` / `hephaestus` / `sisyphus` / `prometheus` に大文字小文字無視で所属）
        2. `skills` / `loadSkills` 配列に `"code-quality-reviewer"` を含む場合 → `"prometheus"`
        3. `skills` / `loadSkills` 配列に `"systematic-debugging"` を含む場合 → `"sisyphus"`
        4. `skills` / `loadSkills` 配列に `"writing-plans"` / `"brainstorming"` を含む場合 → `"atlas"`
        5. `role` / `prompt` 文字列内に上記いずれかのスキル名を含む（部分一致）場合 → スキルに応じたペルソナ
        6. いずれにも該当しない場合は未登録（`undefined`）

---

### 5.21 `JusticeNotifier`

フックの各発火状況において、トースト相当の2層（injectedContext 先頭の Markdown バナー + client.app.log 経由のログ出力）の通知を統合して管理するための最小限のインターフェースです。

*   **`notify(notification)`** — 構造化された通知オブジェクトを受け取り、非同期でログ通知等を実行します。内部で全例外をキャッチして Fail-Open 契約を遵守します。
*   **`formatBanner(notification)`** — レスポンスの先頭に埋め込むための Markdown バナー文字列を生成します。
    *   **Markdown バナーフォーマット**: 生成されるバナーは、以下の通り3行構成の Markdown 引用ブロックとして成型されます。
        ```text
        > <icon> **JUSTICE NOTIFICATION** [<title>]
        > <message>
        [空行]
        ```

**通知の種類 (NotificationVariant):**
*   `atlas_orchestration` (🎯) — Atlas の計画作成完了および委譲指示
*   `architecture_pivot` (🚧) — Prometheus 却下回数超過時の Hephaestus ピボット指示
*   `sisyphus_insight` (🔬) — Sisyphus による systematic-debugging 完了と Wisdom 保存
*   `escalation` (🚨) — エラー過多時の Sisyphus 強制エスカレーション
*   `wisdom_saved` (💡) — 新しい Wisdom が学習ストアに保存された通知
*   `loop_detected` (🔁) — 無限ループ検知とタスク分割指示

---

### 5.22 `OpenCodeNotifier`

`JusticeNotifier` を実装した runtime レイヤのクラスです。OpenCode から注入される `client.app.log` 関数をバインドし、`service: "justice"` 固定のログ出力を担当します。例外発生時はすべて握りつぶして Fail-Open を担保します。

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
        "event": ["Event"], // 内部で eventType === "compaction" をフィルタリング
        "source": "./node_modules/justice-plugin/dist/hooks/compaction-protector.js"
      },
      {
        "name": "justice-loop-handler",
        "event": ["Event"], // 内部で eventType === "loop-detector" をフィルタリング
        "source": "./node_modules/justice-plugin/dist/hooks/loop-handler.js"
      }
    ]
  }
}
```

---

## OpenCode Plugin 統合 (v1.2.0)

`@yohi/justice/opencode` から named export される `OpenCodePlugin` を介して、OpenCode の公式プラグインとして動作します。内部では `OpenCodeAdapter` が OpenCode のフックと Justice の `HookEvent` 間の変換を担います。

### 初期化フロー
- **Lazy Initialization**: 最初のフック呼び出し時に `JusticePlugin.initialize()` が一度だけ実行されます。
- **Fail-Open**: `worktree` や `directory` が取得できない環境では自動的に No-Op モードとなり、エラーをログ出力しつつセッションの進行を妨げません。

### フックとイベントのマッピング

| OpenCode フック | 変換後の Justice イベント | 補足 |
|:---|:---|:---|
| `tool.execute.before` | `PreToolUseEvent` | `tool === "task"` の場合のみ。プラン内容を prompt に注入。 |
| `tool.execute.after` | `PostToolUseEvent` | `tool === "task"` の場合のみ。実行結果とエラー状態を通知。 |
| `experimental.session.compacting` | `EventEvent` (compaction) | コンパクション時にプランのスナップショットを保護。 |
| `event` (message.updated) | `MessageEvent` | ユーザーメッセージから委譲の意図を検出。 |
| `event` (session.error) | `EventEvent` (loop-detector) | `LOOP_ERROR_PATTERNS` に一致するエラーのみ転送。 |
| `command.execute.before` | (変換なし・直接ディスパッチ) | `justice-start` コマンドのみ処理（§4.1a）。`PlanBridge.handleWorkflowStart()` を直接呼び出し `output.parts` へガイダンスを追記。他コマンドは完全ノーオペ。 |

### 追加ファイル
- `src/runtime/opencode-adapter.ts` — 変換ブリッジ本体
- `src/opencode-plugin.ts` — エントリポイント
- `src/core/loop-error-patterns.ts` — ループ検知用パターン定義

既存の OmO カスタムフック経路 (`dist/hooks/*.js`) は後方互換のため維持されます。

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
│   │   ├── trigger-detector.ts       — 委譲キーワードの検出・識別、`/justice-start` ワークフロー起動リクエストのパース
│   │   ├── smart-retry-policy.ts     — 指数バックオフおよびコンテキスト縮減処理
│   │   ├── task-splitter.ts          — タスクが失敗した際の分割提案生成
│   │   ├── wisdom-store.ts           — 学習内容のオンメモリ格納
│   │   ├── learning-extractor.ts     — フィードバックから学習内容を抽出する処理
│   │   ├── wisdom-persistence.ts     — WisdomStore のファイルI/O
│   │   ├── dependency-analyzer.ts    — タスク依存関係と先行処理等の解析
│   │   ├── category-classifier.ts    — タスクのカテゴリを自動判定する機能
│   │   ├── progress-reporter.ts      — 各タスク進捗からの集計レポート生成
│   │   ├── status-command.ts         — 命令からのステータス確認API
│   │   ├── justice-plugin.ts         — これらを繋げるオーケストレーターとイベントの共有箇所
│   │   ├── persona-classifier.ts      — 実行ペルソナ（AgentId）分類器
│   │   ├── review-rejection-patterns.ts — レビュー却下の検出用正規表現パターン
│   │   ├── review-rejection-detector.ts — Prometheus 却下シグナルの検出・抽出
│   │   ├── plan-completion-detector.ts — A+Bハイブリッド完了検知によるスキル・計画完了検出
│   │   ├── session-state-provider.ts   — sessionId→AgentId マッピングと callId 単位の task 窓管理 (v2)
│   │   ├── review-resolution-artifact.ts — justice_review resolve 入力の正規化・検証 (v2)
│   │   ├── review-snapshot-artifact.ts — code_review ツール経由の完全スナップショット契約 (v2)
│   │   ├── hook-response-merger.ts     — PostToolUse 複数レスポンスの合流規則 (v2)
│   │   ├── v2/                          — Quality Control Plane 内部モジュール群（§15、詳細後述）
│   │   │     observation-model.ts・decision-model.ts・gate-definition.ts・gate-yaml-parser.ts・default-gates.ts
│   │   │     gate-context.ts・rule-evaluation-engine.ts・evidence-engine.ts・tool-output-classifier.ts
│   │   │     declared-claim-extractor.ts・task-summary-claim-extractor.ts・skill-invoked-detector.ts
│   │   │     record-builder.ts・redaction.ts・persistence-redaction.ts・safe-segment.ts・shard-layout.ts
│   │   │     writer-id-validation.ts・observation-agent-id-validation.ts・state-projection.ts・integrity.ts
│   │   │     review-aggregator.ts・review-scope.ts・review-severity.ts・review-types.ts・reflection-event.ts
│   │   │     message-payload.ts・evidence-list.ts・hash.ts・references.ts・workflow-bootstrap-projection.ts
│   │   └── justice-notifier.ts         — トースト相当の通知処理のための最小限のインターフェース
│   ├── hooks/
│   │   ├── plan-bridge.ts            — Message/PreToolUse にバインドされるフック
│   │   ├── task-feedback.ts          — PostToolUse エラー処理等へのフィードバック
│   │   ├── compaction-protector.ts   — コンパクションから身を守って保持するフック
│   │   ├── loop-handler.ts           — ループを検知するためのフック
│   │   └── observation-handler.ts    — 全 tool/message 観測を Observation Log へ記録し Gate 評価を発火 (v2)
│   ├── runtime/
│   │   ├── node-file-system.ts       — 実際の Bun.file ベースによるファイルの読み書き
│   │   ├── opencode-adapter.ts       — OpenCode hook ↔ Justice HookEvent adapter
│   │   ├── opencode-notifier.ts      — client.app.log を使用したログ通知処理
│   │   ├── observation-log-store.ts  — per-writer segment JSONL への直列化 atomic append (v2)
│   │   ├── write-queue.ts            — shard 単位の非同期直列化 write queue (v2)
│   │   ├── validation.ts             — record schema / shard sequence 整合性検証 (v2)
│   │   ├── state-projection-cache.ts — `.justice/state.json` の書込・読込・stale 検証 (v2)
│   │   ├── gate-loader.ts            — `.justice/gate.yaml` の読込・既定 gate へのマージ (v2)
│   │   ├── justice-tools.ts          — `justice_review` 等のカスタムツール定義 (v2)
│   │   ├── message-role-buffer.ts    — assistant メッセージの role/finalize 相関バッファ (v2)
│   │   ├── writer-id.ts              — writerId の採番・衝突回避 (v2)
│   │   └── skill-invoked-record-validator.ts — skill_invoked レコードの schema 検証 (v2)
│   ├── opencode-plugin.ts            — OpenCode Plugin entrypoint
│   └── index.ts                      — 上記の外部・公開APIの全エクスポート（v2 内部モジュールは非公開）
├── tests/
│   ├── core/          — コア層に対するテスト用ファイル群
│   ├── hooks/         — フック層に対するテスト・ファイル群
│   ├── integration/   — 全体を統合・通貫した機能テスト
│   ├── runtime/       — ランタイム処理と adapter の検証
│   ├── helpers/
│   │   ├── mock-file-system.ts       — インメモリベースのファイル操作モック
│   │   ├── mock-notifier.ts          — テスト用通知モック
│   │   ├── wisdom-draft-factory.ts   — テスト用 Wisdom Draft 生成ファクトリ
│   │   └── fake-opencode-init.ts     — OpenCode Plugin init スタブ
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

### 10.1 環境変数仕様 (Environment Variables)

プラグインの動作閾値や永続化の挙動は、以下の環境変数でカスタマイズ可能です。

| 変数名 | デフォルト値 | 説明・用途 |
|---|---|---|
| `MAX_RETRIES_BEFORE_ESCALATION` | `3` | 単一タスクでの失敗回数がこの値以上になった場合、`sisyphus` (デバッグ特化) に強制エスカレーションします。非正値や NaN の場合は `3` にフォールバック。 |
| `MAX_REVIEW_REJECTIONS_BEFORE_PIVOT` | `3` | Prometheus からの連続却下回数がこの値以上になった場合、Hephaestus に対してアーキテクチャ・ピボット（別アプローチの提案）を要求します。非正値や NaN の場合は `3` にフォールバック。 |
| `JUSTICE_GLOBAL_WISDOM_PATH` | (未設定時は `~/.justice/wisdom.json`) | ユーザー全体のグローバル Wisdom ファイルの書き出し・読み込み先（絶対パス）。相対パスは無視され警告ログ出力のうえ local のみで稼働。 |

---

## 11. テストカバレッジ・状態 (Test Coverage)

### 11.1 テスト件数の内訳 (*Invisible Advisor 実装完了時に基づく*)

| 解析層 | 対象となるファイル数 | 概要 |
|-------|-------|-------|
| コアロジック部 (`src/core/` + `src/core/v2/`) | 69 ファイル | v1 純粋ロジック（PlanParser 等）＋ v2 Observation/Gate/Review 純粋関数群 |
| フック・ハンドラ群 (`src/hooks/`) | 12 ファイル | `observation-handler.ts`（v2）を含む全 Hook |
| ランタイム処理 (`src/runtime/`) | 20 ファイル | `observation-log-store`/`write-queue`/`gate-loader`/`justice-tools` 等（v2）を含む I/O 層 |
| アーキテクチャ制約検証 (`tests/arch/`) | 2 ファイル | FF-001（Core は `@opencode-ai/*` を import しない）等の静的検証 |
| 実環境・結合検証 (統合テスト) | 15 ファイル | フェーズ横断のエンドツーエンド検証 |
| **合計総数** | **119 テストファイル** | **1,339 件**（v1 Phase 1-9 + v2.0 Quality Control Plane 基盤） |

### 11.2 テスト戦略と方針

- **コアロジック層の検証**: 目標はカバレッジ100%。すべての関数やインスタンスはI/O抜きでモックによる実行検証がされています。
- **フック層における連携**: I/Oには `FileReader`・`FileWriter` モックオブジェクトを流し込んだ統合的なテストを実施。
- **実行・ランタイムベースのテスト**: 組み込みの `mkdtemp` を用いた一時ディレクトリの生成による実際のファイルアクセス。
- **全体における統合テスト**: フェーズで区切られた要件に対するエンドツーエンドでのライフサイクル。

---

## 12. 公開 API (Public API)

```typescript
// メインとなるオーケストレーターとハブ
export { JusticePlugin, createGlobalFs, type JusticePluginOptions } from "./core/justice-plugin";

// ステータス、および計画のレポーティングコマンド
export { StatusCommand, type PlanStatus } from "./core/status-command";

// 実際における利用環境からのランタイム
export { NodeFileSystem } from "./runtime/node-file-system";
export { OpenCodeNotifier } from "./runtime/opencode-notifier";
export type { OpenCodeLogEntry } from "./runtime/opencode-adapter";

// OpenCode plugin entrypoint
export { OpenCodePlugin as default, OpenCodePlugin } from "./opencode-plugin";

// （高度な手法での利用に向けた）全公開コアクラス
export { AgentRouter, AGENT_IDS, type RoutingCategory, type RoutingReason, type RoutingResult } from "./core/agent-router";
export { PlanParser } from "./core/plan-parser";
export { TaskPackager } from "./core/task-packager";
export { ErrorClassifier } from "./core/error-classifier";
export { FeedbackFormatter } from "./core/feedback-formatter";
export { TriggerDetector } from "./core/trigger-detector";
export {
  JUSTICE_START_COMMAND, WORKFLOW_START_FALLBACK_MARKER,
  isJusticeStartCommand, normalizeSafeRelativePath,
  parseWorkflowStartCommandArguments, parseWorkflowStartFallbackMarker,
} from "./core/trigger-detector";
export { DependencyAnalyzer, DependencyResolutionError } from "./core/dependency-analyzer";
export { CategoryClassifier } from "./core/category-classifier";
export { ProgressReporter } from "./core/progress-reporter";
export { SmartRetryPolicy } from "./core/smart-retry-policy";
export { TaskSplitter } from "./core/task-splitter";
export { WisdomStore } from "./core/wisdom-store";
export { LearningExtractor } from "./core/learning-extractor";
export { WisdomPersistence } from "./core/wisdom-persistence";
export { SecretPatternDetector } from "./core/secret-pattern-detector";
export { TieredWisdomStore, type TieredWisdomStoreOptions, type TieredWisdomStoreLogger } from "./core/tiered-wisdom-store";

// Invisible Advisor 新規コアクラス・通知関連
export { PersonaClassifier, classifyPersona, DEFAULT_PERSONA, type PersonaClassificationInput } from "./core/persona-classifier";
export { ReviewRejectionDetector, type ReviewRejectionSignal } from "./core/review-rejection-detector";
export { PlanCompletionDetector, type CompletionResult, type CompletionTrigger, type PlanCompletionInput } from "./core/plan-completion-detector";
export { NoOpNotifier, formatBanner, iconFor, type JusticeNotification, type JusticeNotifier, type NotificationLevel, type NotificationVariant } from "./core/justice-notifier";
export { REVIEW_REJECTION_PATTERNS, matchesReviewRejection } from "./core/review-rejection-patterns";

// 直接各機能ごとのフックを利用したい場合
export { PlanBridge } from "./hooks/plan-bridge";
export { TaskFeedbackHandler } from "./hooks/task-feedback";
export { CompactionProtector } from "./hooks/compaction-protector";
export { LoopDetectionHandler } from "./hooks/loop-handler";

// OpenCode shared primitives
export { LOOP_ERROR_PATTERNS, matchesLoopError } from "./core/loop-error-patterns";

// 実装に関する全ての型
export type {
  PlanTask, PlanStep, PlanTaskStatus,
  DelegationRequest, DelegationContext, AgentId,
  TaskFeedback, TaskFeedbackStatus, TestSummary,
  ErrorClass, TaskCategory,
  ProtectedContext, RetryPolicy,
  FeedbackAction,
  HookEvent, HookResponse,
  FileReader, FileWriter,
  WisdomEntry, WisdomCategory, WisdomScope, WisdomStoreInterface,
  EventPayload, LoopDetectorPayload, CompactionPayload,
  SplitSuggestion, SubTaskSuggestion,
  RetryDecision, ContextReduction,
  AddOptions, BuildDelegationOptions,
  PlanReference, TriggerAnalysis,
  WorkflowStartRequest, WorkflowStartSource, WorkflowBootstrapPhase,
} from "./core/types";
```

**v2.0 に関する注記:** `src/core/v2/` および `src/runtime/observation-log-store.ts` 等の Quality Control Plane 内部モジュールは、意図的に本パッケージの公開 API（`src/index.ts`）からエクスポートされません（D50）。これは内部 dry-run helper（`justice_status`/`justice_gate`）が canonical な Observation Log や Decision Record を変更しない contract を保つためであり、v2.0 のユーザー向け公開面は OpenCode カスタムツール `justice_review`（`OpenCodeAdapter.getTools()` 経由で登録）のみに限定されます。詳細は §15 を参照してください。

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
| Phase 8: 不可視の参謀 (Invisible Advisor) の実装 | ✅ 完了 |
| **v2.0: Quality Control Plane 基盤** (Observation Log / State Projection / Gate Engine / Review Aggregator / `justice_review` ツール、§15 参照) | 🟡 実装完了・ガバナンス未完了（L0 Advisory。§15.12 参照 — C1未実証・CODEOWNERS追認未取得） |
| v2.5: Handoff（サブエージェント実行結果の直接相関）/ Final Verifier / Acceptance Criteria 判定 | 🔲 計画中 |
| v2.5+: L1 deny（強制ブロック）等のエンフォースメント強化 / 物理 prune | 🔲 計画中 |
| 拡張 CLI 用途のサポート (`justice init`, `justice status` など) | 🔲 計画中 |
| VSCode 拡張機能などへのアダプタ | 🔲 計画中 |
| Claude Code との連携における互換性の見直し | 🔲 計画中 |
| Custom Skill SDK の提供 | 🔲 計画中 |

---

## 15. Justice v2.0 — Quality Control Plane（Observation & Gate Engine）

### 15.1 目的と設計原則

AI 開発では「タスクは完了と報告されたが機能は壊れている」（Task Success ≠ Feature Success）という失敗が頻発します。v2.0 はこれを検出するための **Quality Control Plane の基盤層**です。Justice が観測した事実（Evidence）と下した判定（Verdict）をイベントとして記録し、状態をそこから投影（projection）する「背骨」を、既存の v1 機能（plan-bridge / task-feedback / wisdom）を **一切変更せず加算**する形で追加しています（加算シャドウ・dual アーキテクチャ）。

- **L0 Advisory のみ**: v2.0 は強制（block）を行いません。Gate が `FAIL` を返してもツール実行やタスク完了そのものは妨げられず、警告・バナー・チェックリストの提示に留まります。判定権限（Verdict authority）は Justice が保持しますが、強制機構（Enforcement）の段階的強化は v2.5 以降に委ねられます。
- **Pure Core / Fail-Open / Immutable**: v1 と同じ設計原則を継承します。`src/core/v2/` は `@opencode-ai/*` を import しない純粋関数群であり、I/O 境界（`src/runtime/`）・Hook 境界（`src/hooks/observation-handler.ts`）はすべて `try/catch` で保護され、失敗時は `PROCEED` に縮退します。

### 15.2 アーキテクチャ概要

```text
OpenCode イベント (tool.execute.*, message.*, session.error)
        │
        ▼
OpenCodeAdapter (onToolExecuteBefore/After, onMessage*, onEvent)
        │  ToolObservationPayload / ObservationMessagePayload へ変換
        ▼
JusticePlugin.handleEvent()
        │  PostToolUse: [observationHandler, (task時)planBridge, (task時)taskFeedback] を
        │               mergePostToolUseResponses() で単一 HookResponse に合流
        ▼
ObservationHandler (src/hooks/observation-handler.ts)
        │  1. reviewResolutionArtifact があれば専用分岐のみ実行して PROCEED（通常観測をスキップ）
        │  2. SessionStateProvider.getActiveTaskId(callId) で taskId を解決（callId 単位の task 窓）
        │  3. record-builder.ts で ObservationRecord + Evidence を purely構築（redaction 含む）
        │  4. ObservationLogStore.append() で永続化（per-shard write queue → atomic append）
        │  5. skill_invoked / review_observed の検出・追記
        │  6. project(events) で ProjectedState を再構築 → StateProjectionCache へ書込
        │  7. evaluateGateIfTriggered("task_complete"|"tool_observed", ...) で Gate 評価
        ▼                                              ▲
DecisionRecord (WARN/FAIL 時)                    GateLoader (.justice/gate.yaml)
        │                                              │
        ▼                                        rule-evaluation-engine.evaluate()
advisory 送出:                                          │
  (保証) JusticeNotifier.notify() → client.app.log       │
  (best-effort) output.output 末尾追記（既定 false）      │
                                                          │
review_observed レコード群 ──► review-aggregator.aggregateReviews() ──► ReviewSummary (byScope)
                                                                              │
                                                                              ▼
                                                                    `justice_review` ツール（表示・解決）
```

### 15.3 データモデル

```typescript
// src/core/v2/observation-model.ts
type ObservationRecord = PendingEnvelope & { readonly sequence: number } & (
  | { kind: "tool_executed"; toolName: string; callId: string; evidence: Evidence[] }
  | { kind: "message"; messageID: string; partID?: string; role: "assistant";
      textHash: string; textSnippet?: string; declaredClaims: DeclaredClaim[]; evidence: DeclaredClaimEvidence[]; finalized: boolean }
  | { kind: "skill_invoked"; skillName: string; source: "skill_tool" | "task_load_skills"; callId?: string }
  | { kind: "review_observed"; reviewScope: string; isCompleteSnapshot?: boolean; items: ReviewItem[]; resolutionMarkers?: ResolutionMarker[] }
  | { kind: "session_error"; errorKind: string; message: string }
  | { kind: "reflection"; reflection: { trigger: "task_succeeded" | "task_error"; planRef: { path: string; taskId: string }; intent: string; note?: string } }
  // workflow bootstrap lifecycle（`/justice-start`）: 監査専用の非権威レコード。Evidence を一切持たないため
  // Gate の PASS 判定に算入され得ず（FF-008 が自明に成立）、`project()` は `ensureTask()` の前に skip する。
  // 読み取りは `workflow-bootstrap-projection.ts` の `projectWorkflowBootstrapAudit()` が別系統で提供する。
  | { kind: "workflow_started" | "design_requested" | "plan_requested" | "plan_activated";
      workflow: { phase: "design_required" | "plan_required" | "plan_ready"; source: "command" | "fallback_marker";
        goalHash: string; goalSnippet: string; designPath?: string; planPath?: string } }
);

// Evidence: 出自（sourceClass）で二分される discriminated union
type Evidence = ToolOutputEvidence | DeclaredClaimEvidence;
// ToolOutputEvidence: toolOutputClass "command_exec"（rawOutput 保存）| "file_content"（rawOutputHash + snippet のみ）
// DeclaredClaimEvidence: declaredFrom "message" | "task_summary"、claim: { claimKind, outcome }

// provenance の4値: "observed" | "derived" | "declared" | "unknown"
// Gate 充足（PASS）に算入できるのは observed / derived のみ。declared は WARN 材料に限定（FF-008）。

// DecisionRecord: gate 判定結果（per-rule 化）
type DecisionRecord = PersistedEnvelope & {
  readonly gateType: "task";
  readonly verdict: "PASS" | "WARN" | "FAIL";
  readonly reachableEnforcementLevel: "L1";
  readonly appliedEnforcementLevel: "L0"; // v2.0 は常に L0（advisory のみ）
  readonly ruleResults: readonly { ruleId: string; verdict: Verdict; reason?: string; evidenceRefs: EvidenceRef[] }[];
};

// レコード間参照: shard 横断でも一意な複合参照
type FullEvidenceRef = { kind: "full"; agentId: ObservationAgentId; sessionId: string; writerId: string; sequence: number; evidenceId: string };
type SelfEvidenceRef = { kind: "self"; evidenceId: string }; // 同一レコード内の自己参照（sequence 未確定でも参照可）
type EvidenceRef = FullEvidenceRef | SelfEvidenceRef;
```

### 15.4 Observation Log 永続化

- **物理レイアウト**: `.justice/events/<agentId>/<sessionId>/<writerId>.jsonl`。shard 鍵は `{agentId, sessionId, writerId}` で、**1 物理ファイル = 1 writer** を構造保証（`writerId = "w-" + crypto.randomUUID()`、Runtime が plugin インスタンス起動時に採番）。複数プロセスが同一ファイルへ並行 append する経路を排除する。
- **アーカイブ（rotation）**: shard サイズ 5MB 超過、または最古レコードの経過 14 日でアクティブ shard を `.justice/archive/events/<agentId>/<sessionId>/<writerId>.<timestamp>.jsonl` へ退避。sequence は active + archive 双方の最大値から継続採番される。**v2.0 は archive への移送のみで物理 prune（削除）は行わない**（総量上限の完全な充足は v2.5+ に委ねる）。
- **直列化**: 同一 shard への append は per-shard 非同期 write queue で直列化し、sequence 採番もキュー内で実施。各 append は一時ファイル書込 + rename による atomic 操作。
- **整合性検証**: `readAll()` はレコード schema 検証、shard 内 sequence の単調性・重複・物理行順改竄（sequence 降順の出現）を検査し、不正が検出された shard は fail-open で結果から除外する（部分的に壊れたデータを返すことはしない）。
- **投影キャッシュ**: `.justice/state.json` に `ProjectedState` を書込（`StateProjectionCache`）。`sourceHash` と `maxSequenceByShard` で event log との整合性を検証し、通常の追記に伴う自然な stale（`stale_append`）は警告なしで静かに再構築、構造破損・schema 不正・`maxSequenceByShard` 不一致時は警告のうえ再構築する。event log 自体が常に権威であり、`state.json` はキャッシュに過ぎない。

### 15.5 State Projection（決定論的 Fold）

`project(events, rebuiltAt): ProjectedState` は event log から状態を再構築する純粋関数。2 段階マージで決定論を保証する: **(1) shard 内は `sequence` 順**（append 順の因果関係を保持）→ **(2) shard 間は `timestamp` → `shardId` → `sequence` の全順序**。同一イベント集合は常に同一 `ProjectedState` を生成する（FF-004・replay 可能性）。`tasks: ReadonlyMap<taskId, {status, lastVerdict, evidence[], observedReviewScopes[]}>` と `reviewSummary`（グローバル集約 + `byScope: ReadonlyMap<scope, ScopeReviewSummary>`）を持つ。

### 15.6 Evidence 収集ポリシー（Redaction・Provenance）

- **toolOutputClass 分類**（`src/core/v2/tool-output-classifier.ts`）: `bash`/`shell` の `args.command` を解析し、テスト/ビルド/lint 等の合否観測系コマンドは `command_exec`（`rawOutput` を redact + truncation して保存）、`cat`/`head`/`grep` 等のファイル本文閲覧系コマンドは `file_content`（`rawOutput` を保存せず `rawOutputHash` 必須 + 最小 `rawOutputSnippet` のみ）に分類する。git サブコマンド判別・runner prefix（`uv run`/`npx` 等）の unwrap・インタプリタのインライン file-read 検出まで対応し、**判定不能な場合は常に安全側 `file_content` へフォールバック**する（plan/design/code 本文の全文複製を構造的に遮断）。
- **保存前 redaction**: `SecretPatternDetector`（API キー等）＋絶対パス＋環境変数値＋トークン付き URL（`user:token@...`）を、**構造的パスを先に適用してから** secret スキャンする順序で redact する（環境変数名が secret パターンに部分マッチして値が漏れる退行を防ぐため）。message 本文・session_error メッセージにも同様に適用する。
- **provenance と PASS 算入**: 自己申告（`declared`：message 由来 / task summary 由来）は Gate の PASS 判定に**絶対に算入しない**（FF-008）。task summary が transcript を含んでいても `declared` のまま扱う — 親セッションは子（サブエージェント）の実コマンドを直接観測していないため（サブエージェント結果の PASS 算入相関確立は v2.5 Handoff 以降）。

### 15.7 Gate Engine（品質ゲート）

- **設定**: `.justice/gate.yaml`（`GateLoader`）。存在しない、または解析・検証に失敗した場合は警告のうえ既定 gate（`DEFAULT_GATES`）へ fail-open フォールバックする。カスタム gate は既定 gate と同一 `id` で属性を上書き（無効化を含む）でき、新規 `id` は追加登録される。
- **既定 gate**（すべて `enabled: true`、`onViolation`/`onMissingEvidence` = `warn` = trust-first）:
  - `required-tests` — `evidence_outcome`（test, requireOutcome: pass）
  - `build-green` — `evidence_outcome`（build, requireOutcome: pass）
  - `review-clean` — `review_open_items`（minimumSeverity: major）
- **check 種別**: `evidence_present`（指定 kind の権威ある Evidence が存在するか）／`evidence_outcome`（指定 kind の権威ある Evidence が指定 outcome を満たすか）／`review_open_items`（当該 task の観測済み reviewScope に、指定 severity 以上の未解決指摘が無いか）。
- **trigger と task 窓**: `task_complete`（task 完了時）と `tool_observed`（task 窓内の全ツール観測時）の 2 トリガー。`ctx.taskId` が不在（task 窓外）の場合は gate 評価を **skip**（DecisionRecord 非生成）。task 窓は `SessionStateProvider` が `callId` 単位（PreToolUse で開き対応する PostToolUse で閉じる）で管理し、**セッション単位の単一 active taskId フォールバックは採用しない**（並行 task 実行時の窓混同を防止）。
- **advisory 送出**: 保証チャネルは `JusticeNotifier.notify()`（`client.app.log`）。`output.output` 末尾への banner 追記は best-effort（既定 `enableAdvisoryOutputAppend: false`）で、有効化時のみ実施する。

### 15.8 Review Aggregator と解決規則

- `review_observed` レコード（`reviewScope` 付き）を scope 別に集約し、severity（`critical`/`major`/`minor`）は凍結語彙の決定論的正規表現分類器（`review-severity.ts`）で導出する。`itemKey` は severity・ruleId・location ハッシュ・evidence ハッシュから決定的に合成される。
- **`open → resolved` の遷移が許される経路は次の 3 つのみ**（D32）。単なる指摘の消失（範囲差・検出漏れ・出力形式変化）では **`open` のまま据置**する:
  1. 明示的解決マーカー（`resolutionMarkers[]`）
  2. 同一 `reviewScope` の完全スナップショット（`isCompleteSnapshot: true`）における当該指摘の不在
  3. 人間承認済み artifact（`justice_review` の `resolve` 経由、後述）
- **scope-aware gate 評価**: `review_open_items` gate は `GateContext.reviewScope[]`（当該 task 窓内で観測した scope の集合）に一致する `byScope[scope].open` のみを参照し、他 task・他レビュー範囲の未解決指摘を verdict に混入させない。レビュー未観測（`reviewScope[]` が空）は `onMissingEvidence` へ、観測済みだが open が無い場合は `PASS` となる。

### 15.9 `justice_review` ツール

OpenCode に公開される **唯一のカスタムツール**です（`OpenCodeAdapter.getTools()` は `{ justice_review }` のみを返す）。内部 dry-run helper（`justice_status`/`justice_gate` 相当）は実装として存在するが、canonical な Observation Log・DecisionRecord・replay・KPI を変えないためツールとして登録されない（D50）。

- **表示（view）**: `{ scope? }`。`scope` 未指定時は全体のレビュー要約（`critical`/`major`/`minor`/`open`/`resolved` + `byScope`）、指定時は当該 scope の `ScopeReviewSummary` のみを返す。
- **解決（resolve）**: `{ scope, resolve: { itemKeys, artifactRef } }`。対象 item がすべて現在 `open` であることを検証したうえで、`requestApproval`（`context.ask` 経由の人間承認）を要求する。承認された場合のみ `ReviewResolutionArtifact { authority: "human_approved", reviewScope, itemKeys, artifactRef }` を `metadata` として返し、以後の observation で当該指摘が解決済みとして記録される。承認が得られなかった場合はエラーを返す。
- **trust boundary**: `OpenCodeAdapter.onToolExecuteAfter` は `TRUSTED_REVIEW_RESOLUTION_ARTIFACT_TOOLS = ["justice_review"]` と**完全一致するツール名**からの `metadata.reviewResolutionArtifact` のみを信頼して取り込む。他のツール（`justice_` プレフィックスの内部ツールを含む）からの偽装した artifact は一切受け付けない。

### 15.10 Fitness Functions（不変条件の抜粋）

| ID | 内容 |
|---|---|
| FF-001 | `src/core/`（および `src/core/v2/`）は `@opencode-ai/*` を import しない（`tests/arch/` で静的検証） |
| FF-002 | Evidence 抽出・toolOutputClass 分類・severity 分類等の判定はすべて純粋関数（外部状態や現在時刻に依存しない決定論） |
| FF-004 | 同一イベント集合の `project()` は常に同一 `ProjectedState` を生成する（replay 決定性） |
| FF-005 | 新 spine（Observation Log）は `plan.md` に書き込まない（既存の DEBT-001 allowlist を除く） |
| FF-006 | Observation Log の append/read/projection いずれの失敗も `PROCEED` に縮退する（fail-open） |
| FF-007 | evidenceId は `callId` 等から決定論的に導出され、同一実行から同一 evidenceId が再生成される |
| FF-008 | `declared` provenance は Gate の PASS 判定に算入しない（`observed`/`derived` のみ算入可） |

### 15.11 v2.0 のスコープ縮退（v2.5+ へ委譲）

以下は v2.0 では意図的に対象外（deferred）とされており、将来フェーズでの拡張対象です:

- **Handoff（FR-003）**: サブエージェント実行結果の `observed` 相関。v2.0 では task summary 経由の合否主張は transcript を含んでいても `declared` 据置（PASS 非算入）。
- **Final Verifier（FR-007）**: v2.5 以降。
- **Acceptance Criteria 判定（FR-005）**: `plan.md` 由来の feature 級基準は外部 SoT に属するため v2.5+（Feature Gate）で対応。
- **OmO agents awareness（FR-002 の一部）**: v2.0 は skill awareness（`skill_invoked` 観測）のみに対応。どの OmO agent が起動したかの把握は v2.5 Handoff へ。
- **Enforcement 強化（L1 deny 等）**: v2.0 は L0 Advisory のみ。強制ブロックは v2.5 以降で段階的に導入。
- **物理 prune / checkpoint**: v2.0 は archive への移送のみ。event log の物理削除は canonical snapshot/checkpoint 定義後（v2.5+）に解禁。
- **Artifact の authorship**: v2.0 の Artifact（`gate.yaml`/Review Summary）は `authority`（`human_approved` 等）のみを保持し、`authorship`（from→to）は持たない。Handoff（v2.5）導入時に拡張。
- **`exit_code` の直接観測不可（限界-2）**: `tool.execute.after` には `exit_code`/`stderr` フィールドが無いため、Evidence は独立の `exit_code` フィールドを持たず、出力テキストの解析または `metadata.error` から導出した `interpretation.outcome`（`provenance: derived`）で代替する。`stderr` は `rawOutput` に統合される。将来的な OpenCode API 拡張の要望として記録。
- **KPI-1/KPI-3 は v2.0 で未測定（限界-3）**: 憲章の KPI-1（設計乖離率）・KPI-3（Handoff 連続性）は v2.5+ のコンポーネント（Feature Gate/Handoff）に依存するため v2.0 では測定できない。v2.0 は「観測カバレッジ率」「Gate verdict 分布と provenance 分布」「replay 決定性（FF-004 pass）」を先行指標として代替する。

### 15.12 既知の未解決事項・ガバナンス状況（重要）

v2.0 の設計書は、実装着手前に満たすべき前提条件を明記していた。**事後検証の結果、これらの前提の一部は Phase 1 着手時点で未達のまま実装が進められたことが判明している**。ドキュメントの正直性のため、本状況をここに記録する:

- **C1（L0 advisory 表示面の実証）は依然「未実証（Not Verified）」**: `output.output` 末尾への banner 追記がモデル推論文脈／ユーザー表示に実際に反映されるかは、実機 OpenCode ホスト上での目視確認が必須だが、Phase 0 スパイク（`docs/superpowers/spikes/2026-06-26-v2-phase0-spikes.md`）はサンドボックス環境の制約により型定義解析（静的検証）に留まり、実機実証は完了していない。設計の保守的フォールバックに従い、`enableAdvisoryOutputAppend` は既定 `false` のまま維持されており、保証チャネルは `JusticeNotifier`（`client.app.log`）のみである。
- **CODEOWNERS 追認 ADR は「PENDING HUMAN CODEOWNERS RATIFICATION」のまま**: 設計書 D58/D63 は、Phase 0 由来の憲章訂正（hookリスト・保存パス・exit_code縮退・authorship非保持）を1本の ADR にまとめ人間の CODEOWNERS 追認を得ることを実装計画化の前提条件として定めていたが、`docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md` は現在も「PENDING HUMAN CODEOWNERS RATIFICATION」の状態である。出荷完了には人間による `APPROVED` レビューの証跡が必要である（具体的なレビュー履歴は ADR またはリリース記録を参照）。
- **Evidence write 経路（`write-queue.ts` の `atomicAppend()`）のレイテンシは目標未達のまま後続計画に未反映**: Phase 0 スパイク（`docs/superpowers/spikes/2026-06-26-v2-phase0-spikes.md` Step 1、実施日 2026-07-08）の実測（同一 shard への 100 回連続 append）で p95=142.1ms・p99=339.6ms を記録し、計画目標「p95 < 数 ms/tool 呼び出し」を大幅に上回り、未達となった。**この数値は Phase 0 時点（`write-queue.ts` に path 単位の `contents` インメモリキャッシュを導入する前）の実装に対する履歴値である**。当時の原因は append 毎にファイル全文をディスクから読込→追記→temp+rename する read-modify-write 方式だったこと（コード内コメントで「atomicity を throughput より優先する意図的な設計」と明記）。その後 `write-queue.ts` に `contents` キャッシュが追加され、2 回目以降の append ではディスクからの全文読込（`readExisting()`）はスキップされるようになったが、**append 毎に累積コンテンツ全文を temp ファイルへ書込み→rename する O(shard size) の書込みコストは現行実装でも変わらず残っている**。**現行経路（キャッシュ導入後）でのレイテンシは再計測されておらず、目標を達成しているかは未確認のままである**。`ObservationLogStore.append()` は fail-open のため機能停止には至らないが、高頻度ツール呼び出しセッションでは無視できない遅延になり得る。バッチ化・非同期 flush 化等の対応方針はスパイク文書に記録されているが、現時点でいずれの実装計画にも反映されていない。
- **設計書自身の勧告**: 上記3点の前提が満たされるまで、**v2.0 の対外的な「出荷完了」宣言は差し控えるべき**と設計書 §13 末尾に明記されている。本ドキュメント（README.md/SPEC.md）の「✅ 完了」表記はコード実装状況（L0 Advisory として機能する）を指すものであり、上記ガバナンス上の前提が正式に満たされたことを意味しない。
- **今後の対応**: (1) 実機 OpenCode 環境での C1 目視検証を実施し `enableAdvisoryOutputAppend` の既定値を確定する、(2) 当該 ADR に人間の CODEOWNERS `APPROVED` レビューを取得する、(3) `write-queue.ts` のレイテンシ課題（Phase 0 スパイク実測の履歴値 p95=142.1ms／`contents` キャッシュ導入後の現行経路は未再計測）について、現行経路での再計測を実施したうえでバッチ化/非同期 flush 化を実施するか許容可能と判断するかを設計レビューで確定し、決定を Phase 3 以降の実装計画に反映する。すべてが完了するまで、v2.0 を前提とした追加投資判断（v2.5 着手判断等）は本状況を踏まえて行うこと。
