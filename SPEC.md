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
│   │   ├── justice-plugin.ts         — これらを繋げるオーケストレーターとイベントの共有箇所
│   │   ├── persona-classifier.ts      — 実行ペルソナ（AgentId）分類器
│   │   ├── review-rejection-patterns.ts — レビュー却下の検出用正規表現パターン
│   │   ├── review-rejection-detector.ts — Prometheus 却下シグナルの検出・抽出
│   │   ├── plan-completion-detector.ts — A+Bハイブリッド完了検知によるスキル・計画完了検出
│   │   └── justice-notifier.ts         — トースト相当の通知処理のための最小限のインターフェース
│   ├── hooks/
│   │   ├── plan-bridge.ts            — Message/PreToolUse にバインドされるフック
│   │   ├── task-feedback.ts          — PostToolUse エラー処理等へのフィードバック
│   │   ├── compaction-protector.ts   — コンパクションから身を守って保持するフック
│   │   └── loop-handler.ts           — ループを検知するためのフック
│   ├── runtime/
│   │   ├── node-file-system.ts       — 実際の Bun.file ベースによるファイルの読み書き
│   │   ├── opencode-adapter.ts       — OpenCode hook ↔ Justice HookEvent adapter
│   │   └── opencode-notifier.ts      — client.app.log を使用したログ通知処理
│   ├── opencode-plugin.ts            — OpenCode Plugin entrypoint
│   └── index.ts                      — 上記の外部・公開APIの全エクスポート
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

| 解析層 | 対象となるファイル数 | サンプルテスト件数 |
|-------|-------|-------|
| コアロジック部 | 27 ファイル | 約 440 件 |
| フック・ハンドラ群 | 4 ファイル | 約 70 件 |
| ランタイム処理 | 2 ファイル | 17 件 |
| 実環境・結合検証 (統合テスト) | 19 ファイル | 約 36 件 |
| **合計総数** | **52 テストファイル** | **563 件** |

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
| Phase 8: 不可視の参謀 (Invisible Advisor) の実装 | ✅ 完了 |
| 拡張 CLI 用途のサポート (`justice init`, `justice status` など) | 🔲 計画中 |
| VSCode 拡張機能などへのアダプタ | 🔲 計画中 |
| Claude Code との連携における互換性の見直し | 🔲 計画中 |
| Custom Skill SDK の提供 | 🔲 計画中 |
