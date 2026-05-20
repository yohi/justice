# Justice Invisible Advisor — 設計仕様書

- **作成日**: 2026-05-21
- **対象プラグイン**: `justice`（OpenCode plugin、hook-first architecture）
- **適用範囲**: `src/core/`, `src/hooks/`, `src/runtime/` の各レイヤ、ならびに対応テスト
- **方針**: 既存の hook-first・stateless・atomic-FS の原則を維持し、新規 npm 依存を追加せず、TypeScript の厳格な readonly 契約と Vitest テスト体系を遵守する

---

## 1. 背景と目的

`justice` は `oh-my-openagent (OmO)` と `superpowers` の間に常駐する不可視の参謀である。本リファクタリングでは、Subagent-Driven Development (SDD) を裏側から制御・誘導する以下の 3 つの Epic を実装する。

1. **Plan-to-Execution Bridge** — `writing-plans` 完了を検知し、Atlas（指揮官）が自ら実装に着手せず、計画書に従って次ステップを適切なエージェントに委譲するよう強くプロンプト注入する。
2. **Role-based Wisdom Store** — `wisdom.json` をペルソナ別ネスト構造に変更し、エージェント起動・交代時に該当ペルソナの Wisdom のみを自動注入する。
3. **SDD Native Error Handling** — Prometheus からの code-quality NG メッセージを検知してカウントし、閾値超過時に Hephaestus へ「アーキテクチャ視座引き上げ」プロンプトを注入する。また Sisyphus が `systematic-debugging` を完了した際は `LearningExtractor` をトリガし、Sisyphus 名前空間に Wisdom を保存する。

加えて、これらの hook 発火イベントをユーザーが視覚的に把握できるよう、トースト相当の通知機構を追加する。

---

## 2. アーキテクチャ全体俯瞰

### 2-1. モジュール構成（追加 / 変更）

```text
src/
├── core/
│   ├── types.ts                       [変更] WisdomEntry に persona: AgentId 追加 / v2 シリアル型追加
│   ├── wisdom-store.ts                [変更] Map<AgentId, WisdomEntry[]> 内部表現 + persona フィルタ対応
│   ├── wisdom-persistence.ts          [変更] v1/v2 マイグレーション、byAgent 形式の atomic 永続化
│   ├── tiered-wisdom-store.ts         [変更] getRelevant に persona フィルタ伝播、formatForInjection 拡張
│   ├── learning-extractor.ts          [変更] persona を WisdomEntryDraft に含める / context 引数追加
│   ├── persona-classifier.ts          [新規] category/errorClass → AgentId 推定 (デフォルト hephaestus)
│   ├── review-rejection-patterns.ts   [新規] Prometheus NG 検知パターン
│   ├── review-rejection-detector.ts   [新規] toolResult → 拒否シグナル抽出
│   ├── plan-completion-detector.ts    [新規] PreToolUse 捕捉 + PostToolUse パターンマッチ
│   ├── justice-notifier.ts            [新規] JusticeNotifier interface + NotificationVariant
│   └── justice-plugin.ts              [変更] notifier 注入 / PostToolUse 経路マージ
│
├── hooks/
│   ├── plan-bridge.ts                 [変更] handlePostToolUse 追加 / Atlas Guidance + Sisyphus Wisdom 経路
│   └── loop-handler.ts                [変更] recordReviewOutput / pivot 注入 / notifier 統合
│
├── runtime/
│   └── opencode-notifier.ts           [新規] client.app.log を利用した OpenCodeNotifier
│
├── runtime/opencode-adapter.ts        [変更] OpenCodeNotifier を JusticePlugin に注入
└── index.ts                           [変更] 新規エクスポート追加

tests/
├── core/
│   ├── persona-classifier.test.ts
│   ├── review-rejection-detector.test.ts
│   ├── plan-completion-detector.test.ts
│   ├── wisdom-persistence-migration.test.ts
│   ├── justice-notifier.test.ts
│   ├── wisdom-store.test.ts                  [更新]
│   ├── tiered-wisdom-store.test.ts           [更新]
│   └── learning-extractor.test.ts            [更新]
├── hooks/
│   ├── plan-bridge.test.ts                   [更新]
│   └── loop-handler.test.ts                  [更新]
├── runtime/
│   └── opencode-notifier.test.ts             [新規]
├── helpers/
│   ├── mock-notifier.ts                      [新規] createMockNotifier()
│   └── wisdom-draft-factory.ts               [新規] makeWisdomDraft({...})
└── integration/
    ├── atlas-orchestration-flow.test.ts      [新規]
    ├── role-based-wisdom-flow.test.ts        [新規]
    └── review-rejection-pivot-flow.test.ts   [新規]
```

### 2-2. イベントルーティング更新

```text
Message          → PlanBridge.handleMessage()                (変更なし)
PreToolUse       → PlanBridge.handlePreToolUse()              (拡張: PlanCompletionDetector に skills を記録)
PostToolUse      → 1) PlanBridge.handlePostToolUse()          (新規: writing-plans / systematic-debugging 完了検知)
                 → 2) TaskFeedbackHandler.handlePostToolUse() (既存)
                   ※直列実行 + mergePostToolUseResponses(a,b) で合成
Event:loop-*     → LoopDetectionHandler                       (拡張: review_rejection も評価)
Event:compaction → CompactionProtector                        (変更なし)
```

### 2-3. 不可侵原則の維持

- `src/core/` は OmO 非依存・純粋ロジック。
- すべての新規型は `readonly`。
- I/O は `FileReader` / `FileWriter` 抽象経由のみ。
- ロックは導入せず、`saveAtomic`（temp + rename）方式を維持。
- 新規 npm 依存はゼロ。

---

## 3. データ構造とマイグレーション

### 3-1. `WisdomEntry` 型の拡張

```ts
// src/core/types.ts
export interface WisdomEntry {
  readonly id: string;
  readonly taskId: string;
  readonly category: WisdomCategory;
  readonly content: string;
  readonly errorClass?: ErrorClass;
  readonly timestamp: string;
  readonly persona: AgentId;        // 新規必須フィールド
}

export type WisdomEntryDraft = Omit<WisdomEntry, "id" | "timestamp">;

export interface AddOptions {
  readonly scope?: WisdomScope;
  readonly persona?: AgentId;       // 明示指定で上書き可能
}
```

### 3-2. `wisdom.json` の永続化フォーマット v2

```jsonc
{
  "version": 2,
  "maxEntries": 100,
  "byAgent": {
    "Atlas":       [ /* WisdomEntry, persona: "atlas" */ ],
    "Hephaestus":  [ ],
    "Sisyphus":    [ ],
    "Prometheus":  [ ]
  }
}
```

- 内部 API は `AgentId` 小文字（`"atlas"` 等）を使用。
- シリアライズ境界で PascalCase ラベル（`AGENT_LABELS: Record<AgentId, string>`）に変換。
- `maxEntries` はペルソナ横断の合計上限。LRU eviction はペルソナ間で偏らないよう、最古エントリ保有 bucket から削除。

### 3-3. v1 → v2 マイグレーション

`WisdomPersistence.loadStrict()` 内で：

```text
1. JSON.parse 失敗 / 空文字列 → 空ストア (fail-open)
2. data.version === 2          → v2 として deserialize
3. data.entries が配列          → v1 とみなし、各 entry に対し:
   a. entry.persona が存在     → そのまま採用
   b. 未定義                   → PersonaClassifier.classify(entry)
4. 認識不能形式                  → throw (上位 load() が catch して空)
```

書き戻し時は常に v2 形式で `saveAtomic` 実行。明示バックアップは作成しない（git 管理に委ねる）。

### 3-4. `PersonaClassifier`

```ts
// src/core/persona-classifier.ts
// 入力: { category, errorClass }
// 出力: AgentId

// 優先順位:
// 1. errorClass === "design_error"                      → "atlas"
// 2. errorClass in {"loop_detected","timeout"}          → "sisyphus"
// 3. category === "design_decision"                     → "atlas"
// 4. category === "environment_quirk"                   → "sisyphus"
// 5. category === "success_pattern" | "failure_gotcha"  → "hephaestus"
// 6. それ以外                                            → "hephaestus" (DEFAULT_PERSONA)
```

Prometheus への振り分けはここでは推定しない。レビュー系の永続化を行う上位呼び出しが `persona: "prometheus"` を明示する設計とする。

---

## 4. Epic 1 — Plan-to-Execution Bridge

### 4-1. `PlanCompletionDetector`

```ts
// src/core/plan-completion-detector.ts
export interface PlanCompletionSignal {
  readonly source: "skill_marker" | "result_marker" | "result_path";
  readonly planFilePath?: string;
  readonly confidence: "high" | "medium";
}

export type SkillTarget = "writing-plans" | "systematic-debugging";

export class PlanCompletionDetector {
  /**
   * PreToolUse 時点で task() の skills 等から該当スキル起動を保留状態として記録
   */
  recordPreToolUseInvocation(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): void;

  /**
   * PostToolUse 時に保留 + 結果マッチを評価し、特定スキルの完了を返す
   */
  evaluateSkillCompletion(
    sessionId: string,
    toolName: string,
    toolResult: string,
    isError: boolean,
    target: SkillTarget,
  ): PlanCompletionSignal | null;

  /**
   * 直近の PreToolUse から推測されたペルソナを返す (Prometheus レビュー判定用)
   */
  lastInvokedPersona(sessionId: string): AgentId | undefined;
}
```

**検知ロジック（A + B ハイブリッド）**:

- **B 段階 (PreToolUse 捕捉)**: `toolInput.skills` / `toolInput.loadSkills` 配列にスキル名を含むか、`toolInput.role` / `toolInput.prompt` にスキル名文字列が含まれる場合、sessionId に紐付けて保留登録（メモリ TTL 5 分、最大 50 セッション、`LoopDetectionHandler` と同水準）。
- **A 段階 (PostToolUse 検証)**:
  - 保留フラグが立っていれば `confidence: high` 確定。
  - 保留フラグがなくとも、`toolResult` に以下が含まれれば `confidence: medium` で検出：
    - writing-plans: `docs/superpowers/specs/\d{4}-\d{2}-\d{2}-.*-design\.md` パスもしくは `## Architecture` + `## Implementation` 同時出現
    - systematic-debugging: `Root cause:` / `根本原因:` マーカー
- 検出後はセッション保留を消去（多重検出防止）。

### 4-2. `PlanBridge` の `handlePostToolUse`

```ts
async handlePostToolUse(event: HookEvent): Promise<HookResponse> {
  if (event.type !== "PostToolUse") return PROCEED;
  const { toolName, toolResult, error } = event.payload;

  // 1) writing-plans 完了 → Atlas Guidance Directive 注入
  const planSignal = this.completionDetector.evaluateSkillCompletion(
    event.sessionId, toolName, toolResult, error, "writing-plans",
  );
  if (planSignal) {
    return this.buildAtlasGuidanceResponse(event, planSignal);
  }

  // 2) systematic-debugging 完了 → Sisyphus Wisdom 保存
  const debugSignal = this.completionDetector.evaluateSkillCompletion(
    event.sessionId, toolName, toolResult, error, "systematic-debugging",
  );
  if (debugSignal) {
    return this.persistSisyphusInsight(event, debugSignal);
  }

  // 3) task() 結果が Prometheus 由来かを判定し、NG カウントへ
  if (toolName === "task" && this.loopHandler) {
    const persona = this.completionDetector.lastInvokedPersona(event.sessionId);
    if (persona === "prometheus") {
      const taskId = this.getActiveTaskIdForSession(event.sessionId);
      if (taskId) {
        const decision = this.loopHandler.recordReviewOutput(event.sessionId, taskId, toolResult);
        if (decision.pivoted) {
          return this.buildPivotInjectionResponse(event, decision);
        }
      }
    }
  }

  return PROCEED;
}
```

### 4-3. Atlas Guidance プロンプト本体

```text
---
🎯 [JUSTICE: ATLAS ORCHESTRATION DIRECTIVE]

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

推奨エージェントは `AgentRouter.route()` を `CategoryClassifier` 推定カテゴリ + 関連スキルで呼び出して決定。`confidence: medium` の場合のみ「自動検知。意図と異なる場合は無視可」の注記を末尾に追加。

### 4-4. `mergePostToolUseResponses`

`src/core/justice-plugin.ts` 内に純粋関数として定義：

```ts
export function mergePostToolUseResponses(a: HookResponse, b: HookResponse): HookResponse {
  // 1) skip は最優先で保持
  if (a.action === "skip" || b.action === "skip") return { action: "skip" };
  // 2) 両方 proceed → proceed
  if (a.action === "proceed" && b.action === "proceed") return a;
  // 3) 片方が inject → そちらを採用
  if (a.action === "inject" && b.action === "proceed") return a;
  if (b.action === "inject" && a.action === "proceed") return b;
  // 4) 両方 inject → 連結
  return {
    action: "inject",
    injectedContext: `${a.injectedContext}\n\n---\n\n${b.injectedContext}`,
  };
}
```

単体テストを `tests/core/justice-plugin.test.ts` に追加。

---

## 5. Epic 2 — Role-based Wisdom Store

### 5-1. `WisdomStore` の内部表現

```ts
export class WisdomStore implements WisdomStoreInterface {
  private entriesByPersona: Map<AgentId, WisdomEntry[]> = new Map([
    ["atlas", []],
    ["hephaestus", []],
    ["sisyphus", []],
    ["prometheus", []],
  ]);
  private _maxEntries = 0;

  add(entry: WisdomEntryDraft, options?: AddOptions): WisdomEntry {
    const persona =
      options?.persona ??
      entry.persona ??
      PersonaClassifier.classify(entry);

    const newEntry: WisdomEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      ...entry,
      persona,
    };

    this.entriesByPersona.get(persona)!.push(newEntry);
    this.evictOldestIfOverflow();
    return newEntry;
  }

  getByTaskId(taskId: string): WisdomEntry[] {
    return this.getAllEntries().filter(e => e.taskId === taskId);
  }

  getRelevant(options?: {
    errorClass?: ErrorClass;
    maxEntries?: number;
    persona?: AgentId;
  }): WisdomEntry[] {
    const limit = options?.maxEntries ?? 10;
    const source = options?.persona
      ? (this.entriesByPersona.get(options.persona) ?? [])
      : this.getAllEntries();

    const filtered = options?.errorClass
      ? source.filter(e => e.errorClass === options.errorClass)
      : source;

    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  getAllEntries(): readonly WisdomEntry[] {
    return [...this.entriesByPersona.values()]
      .flat()
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  replaceEntries(entries: readonly WisdomEntry[]): void {
    // ペルソナ別に再分配（既存契約）
  }

  private evictOldestIfOverflow(): void {
    // 全 bucket の合計が maxEntries を超える限り、最古エントリ保有 bucket から shift
  }
}
```

### 5-2. `TieredWisdomStore` の persona 伝播

```ts
getRelevant(options?: {
  errorClass?: ErrorClass;
  maxEntries?: number;
  persona?: AgentId;
}): WisdomEntry[] {
  const local = this.localStore.getRelevant(options);
  if (local.length >= (options?.maxEntries ?? 10)) return local;

  const localIds = new Set(local.map(e => e.id));
  const remaining = (options?.maxEntries ?? 10) - local.length;
  const globalRaw = this.globalStore.getRelevant(options);
  const globalFiltered = globalRaw.filter(e => !localIds.has(e.id)).slice(-remaining);

  return [...local, ...globalFiltered];
}
```

`formatForInjection(entries)` は、ペルソナが混在する場合に限り、ペルソナ別グルーピングのヘッダ（`**[JUSTICE AI: Past Learnings for <Persona>]**`）を出力する。

### 5-3. `WisdomPersistence` の永続化

- `load()` は v1/v2 両対応（§3-3）。
- `saveAtomic()` は常に v2 形式で書き出し。
- `mergeById` 内で、disk と memory に同一 id がある場合は新しい timestamp 側の `persona` を採用。v1 entry はマイグレーション時に `PersonaClassifier` で persona を付与してからマージ。

### 5-4. ペルソナ別注入の連動ポイント

- `PlanBridge.handleMessage` → `delegation.context.agentId ?? "hephaestus"` を `getRelevantLearnings` 引数に渡す。
- `PlanBridge.handlePreToolUse` (task) → 同上。
- `PlanBridge.handlePostToolUse` (Atlas Guidance) → `getRelevantLearnings("atlas")`。
- `LoopDetectionHandler.setActivePlan` で `currentAgent` 変更を検知 → 必要に応じてペルソナ切替時の Wisdom 再注入トリガに利用。

### 5-5. `LearningExtractor` の persona 付与

```ts
extract(
  feedback: TaskFeedback,
  rawOutput?: string,
  context?: { persona?: AgentId },
): WisdomEntryDraft[] {
  // 各 draft に persona を付与:
  //   1. context.persona があればそれを使用
  //   2. なければ PersonaClassifier.classify({ category, errorClass })
}
```

`TaskFeedbackHandler.setActivePlan` のシグネチャに `agentId?: AgentId` を追加し、`session.currentAgent` として保持。`extract({ persona })` に伝播。

---

## 6. Epic 3 — SDD Native Error Handling

### 6-1. `review-rejection-patterns.ts`

```ts
export const REVIEW_REJECTION_PATTERNS: readonly RegExp[] = Object.freeze([
  /\brejected?\b/i,
  /\bcannot\s+approve\b/i,
  /\bapproval\s+denied\b/i,
  /\brequested\s+changes\b/i,
  /\bMUST\s+FIX\s*:/,
  /\bBLOCKER\s*:/,
  /\b(blocking|critical)\s+(issue|concern|problem)s?\b/i,
  /❌/u,
  /\bdo\s+not\s+merge\b/i,
  /(不承認|却下|要修正|致命的|ブロッカー)/u,
  /(請求された変更|レビュー却下)/u,
]);

export function matchesReviewRejection(text: string): boolean;
```

### 6-2. `ReviewRejectionDetector`

```ts
export interface ReviewRejectionSignal {
  readonly matched: boolean;
  readonly excerpts: readonly string[];  // 最大3件、各 ≤200 文字
  readonly summary: string;              // ≤300 文字
}

export class ReviewRejectionDetector {
  detect(text: string): ReviewRejectionSignal;
}
```

### 6-3. `LoopDetectionHandler` の拡張

#### 環境変数 / 定数

```ts
const PIVOT_TARGET: AgentId = "hephaestus";
const DEFAULT_MAX_REVIEW_REJECTIONS_BEFORE_PIVOT = 3;
// 環境変数: MAX_REVIEW_REJECTIONS_BEFORE_PIVOT
```

#### 新規 API

```ts
export type PivotReason = "review_rejection_threshold";

export interface PivotDecision {
  readonly pivoted: boolean;
  readonly targetAgent: AgentId;
  readonly rejections: number;
  readonly maxRejections: number;
  readonly reason?: PivotReason;
  readonly recentExcerpts: readonly string[];
}

recordReviewOutput(
  sessionId: string,
  taskId: string,
  reviewerOutput: string,
): PivotDecision;
```

内部処理:
1. `ReviewRejectionDetector.detect()` で抽出。
2. 一致なし → カウント据え置きで `pivoted: false` を返す。
3. 一致あり → `rejections` Map に excerpt を追記。
4. 既存 `recordTrial` に `agent: "prometheus", result: "failure", wisdom: "review_rejected: ..."` として連動記録（既存 escalation との整合性）。
5. カウントが閾値以上 → `pivoted: true`、`targetAgent: PIVOT_TARGET` で返却。

`removeSession` 時に `rejections` Map も併せて削除。

### 6-4. Pivot 注入プロンプト

```text
---
🚧 **JUSTICE: ARCHITECTURE PIVOT REQUIRED**

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

### 6-5. Sisyphus Wisdom 保存経路

`PlanBridge.handlePostToolUse` 内で `systematic-debugging` 完了を検知した場合:

```ts
const drafts = this.learningExtractor.extract(
  {
    taskId: this.getActiveTaskIdForSession(event.sessionId) ?? "unknown-debug",
    status: "success",
    retryCount: 0,
  } satisfies TaskFeedback,
  event.payload.toolResult,
  { persona: "sisyphus" },
);

for (const draft of drafts) {
  this.wisdomStore.add(draft, { persona: "sisyphus" });
}
```

`LearningExtractor.extractFromSuccess` 内に「`rawOutput` が根本原因マーカーを含む場合に `design_decision` カテゴリの draft を生成する」分岐を追加。マーカーパターンは `learning-extractor.ts` 内部の private 定数として保持。

---

## 7. ユーザー向けトースト通知

### 7-1. 3 層ハイブリッド通知設計

OpenCode の `TuiToast` API はサーバーサイドフックから直接呼び出せないため、以下 3 層を組み合わせて「トースト相当」の UX を実現する。

#### Layer 1: `client.app.log` 経由のログ通知（即時可視化）
`OpenCodeAdapter` から渡される `log` 関数を `OpenCodeNotifier` 内部で利用し、`service: "justice"` の構造化メッセージを送信。

#### Layer 2: `injectedContext` 先頭バナー（チャット上で必ず目視）
各 hook の `inject` レスポンスの先頭に Markdown バナーを必ず埋め込む。

```text
> 🎯 **JUSTICE NOTIFICATION** [Atlas Orchestration]
> Atlas が writing-plans を完了 — 次のステップは Hephaestus に委譲してください。

---
[詳細プロンプト本文...]
```

#### Layer 3: 将来拡張用の TUI ブリッジ（インターフェースのみ）
MVP では未実装。`JusticeNotifier` 抽象は TUI プラグイン側からの将来連携を見越して定義する。

### 7-2. `JusticeNotifier` インターフェース

```ts
// src/core/justice-notifier.ts
export type NotificationLevel = "info" | "success" | "warning" | "error";

export type NotificationVariant =
  | "atlas_orchestration"
  | "architecture_pivot"
  | "sisyphus_insight"
  | "escalation"
  | "wisdom_saved"
  | "loop_detected";

export interface JusticeNotification {
  readonly level: NotificationLevel;
  readonly variant: NotificationVariant;
  readonly title: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly taskId?: string;
}

export interface JusticeNotifier {
  notify(notification: JusticeNotification): void | Promise<void>;
  formatBanner(notification: Omit<JusticeNotification, "sessionId" | "taskId">): string;
}

export class NoOpNotifier implements JusticeNotifier {
  notify(): void { /* no-op */ }
  formatBanner(): string { return ""; }
}
```

### 7-3. アイコンマッピング

| Variant | Icon |
|---|---|
| `atlas_orchestration` | 🎯 |
| `architecture_pivot` | 🚧 |
| `sisyphus_insight` | 🔬 |
| `escalation` | 🚨 |
| `wisdom_saved` | 💡 |
| `loop_detected` | 🔁 |

### 7-4. `OpenCodeNotifier`

```ts
// src/runtime/opencode-notifier.ts
export class OpenCodeNotifier implements JusticeNotifier {
  constructor(private readonly log: (entry: OpenCodeLogEntry) => Promise<void> | void) {}

  async notify(n: JusticeNotification): Promise<void> {
    try {
      await this.log({
        level: n.level === "success" ? "info" : n.level === "warning" ? "warn" : n.level,
        service: "justice",
        message: `${this.iconFor(n.variant)} [${n.title}] ${n.message}`,
        extra: { variant: n.variant, sessionId: n.sessionId, taskId: n.taskId },
      });
    } catch {
      /* never throw from notifier */
    }
  }

  formatBanner(n: Omit<JusticeNotification, "sessionId" | "taskId">): string {
    const icon = this.iconFor(n.variant);
    return [
      `> ${icon} **JUSTICE NOTIFICATION** [${n.title}]`,
      `> ${n.message}`,
      "",
    ].join("\n");
  }
}
```

### 7-5. 注入経路

```ts
// JusticePluginOptions に notifier 追加
export interface JusticePluginOptions {
  readonly logger?: { error(...): void; warn(...): void; };
  readonly onError?: (error: unknown) => void;
  readonly globalFileSystem?: { ... };
  readonly notifier?: JusticeNotifier;        // 新規
}

// JusticePlugin コンストラクタ内
this.notifier = options.notifier ?? new NoOpNotifier();
// 各 hook へコンストラクタ引数で伝播
```

### 7-6. `OpenCodeAdapter` 統合

```ts
// runtime/opencode-adapter.ts (ensureInitialized 内)
const notifier = new OpenCodeNotifier(this.#init.client.app.log);
const justice = new JusticePlugin(localFs, localFs, {
  logger: loggerAdapter,
  onError: ...,
  globalFileSystem: globalFs ?? undefined,
  notifier,
});
```

---

## 8. エラーハンドリングと Fail-Open 原則

- すべての hook ハンドラは fail-open。新規 hook 経路も I/O は `try/catch` で包み、必ず `HookResponse` を返す。
- `JusticeNotifier.notify()` は内部で全例外を吸収し、再 throw しない（バナー文字列生成も同様）。
- `recordReviewOutput` は副作用フリーの判定純粋関数として記述し、内部状態書き込みは保留検知後にのみ実行する。
- `PlanCompletionDetector` のセッション保留 Map は LRU + TTL で確実に解放（メモリリーク防止）。

---

## 9. テスト戦略

### 9-1. 新規ユニットテスト

| ファイル | 主な検証内容 |
|---|---|
| `tests/core/persona-classifier.test.ts` | 各 category × errorClass の優先順位、デフォルトフォールバック |
| `tests/core/review-rejection-detector.test.ts` | 英日パターン網羅、excerpt 上限、空入力 |
| `tests/core/plan-completion-detector.test.ts` | PreToolUse 保留 + PostToolUse 判定、confidence 評価、TTL/最大件数 eviction |
| `tests/core/wisdom-persistence-migration.test.ts` | v1 → v2 マイグレーション、`PersonaClassifier` フォールバック、`saveAtomic` で v2 出力 |
| `tests/core/justice-notifier.test.ts` | `NoOpNotifier`/`formatBanner` の出力フォーマット、`notify` の例外吸収 |
| `tests/runtime/opencode-notifier.test.ts` | `client.app.log` 呼び出し検証、レベル変換 |

### 9-2. 更新ユニットテスト

- `tests/core/wisdom-store.test.ts` — Map ベース挙動、`persona` フィルタ、LRU eviction の挙動。
- `tests/core/tiered-wisdom-store.test.ts` — persona 伝播時の local + global マージ。
- `tests/core/learning-extractor.test.ts` — `persona` 付与、systematic-debugging 用の根本原因マーカー分岐。
- `tests/hooks/plan-bridge.test.ts` — `handlePostToolUse` の3経路（writing-plans / systematic-debugging / Prometheus review）。
- `tests/hooks/loop-handler.test.ts` — `recordReviewOutput` の pivot 判定、既存 `evaluateEscalation` との連動。

### 9-3. 統合テスト

- `tests/integration/atlas-orchestration-flow.test.ts` — Atlas が `writing-plans` を完了 → PostToolUse → Atlas Guidance 注入 → Hephaestus 委譲リクエスト確定までの一連の流れ。
- `tests/integration/role-based-wisdom-flow.test.ts` — Hephaestus 用の add → Atlas 委譲時には Atlas wisdom のみ注入されることを検証。
- `tests/integration/review-rejection-pivot-flow.test.ts` — Prometheus からの NG を 3 回受領後に pivot 注入されることを検証。

### 9-4. テストヘルパー

- `tests/helpers/mock-notifier.ts` — `createMockNotifier()` を提供。`notify` 呼び出し履歴を配列に保存。
- `tests/helpers/wisdom-draft-factory.ts` — `makeWisdomDraft({...})` を提供。`persona: "hephaestus"` をデフォルト値に持ち、既存テストの書き換え量を最小化。

---

## 10. 環境変数仕様

| 変数名 | デフォルト | 用途 |
|---|---|---|
| `MAX_RETRIES_BEFORE_ESCALATION` | `3` | （既存）失敗が連続した際に Sisyphus へ自動エスカレーションする閾値 |
| `MAX_REVIEW_REJECTIONS_BEFORE_PIVOT` | `3` | （新規）Prometheus 連続却下で Hephaestus pivot を発火する閾値 |
| `JUSTICE_GLOBAL_WISDOM_PATH` | （未設定時 `$HOME/.justice/wisdom.json`） | （既存）グローバル Wisdom 保存先 |

両閾値とも、`NaN` / 非正値ならデフォルトにフォールバック。

---

## 11. 後方互換性

- `WisdomEntry` への `persona` 必須化は型レベルの破壊変更となるが、`tests/helpers/wisdom-draft-factory.ts` で既存テストの書き換え量を最小化する。
- `WisdomStoreInterface` は `getRelevant({persona?})` 拡張を含むが、`persona` をオプショナルとすることで既存呼び出しは無変更で動作。
- `wisdom.json` の v1 形式は読み取り時のみ受け入れ、書き込みは常に v2 形式。一方向のマイグレーションのみサポート（ダウングレード時の情報損失は受容）。
- `JusticePluginOptions.notifier` はオプショナルかつ `NoOpNotifier` をデフォルトとするため、既存呼び出しコードは無変更で動作。

---

## 12. Devcontainer 検証手順

実装完了後、Devcontainer 環境内で以下を順に実行する。ローカルホストでの実行は禁止。

```bash
# Devcontainer 起動例 (VSCode Remote Containers または CLI)
# devcontainer up --workspace-folder .

# Devcontainer シェル内で:
bun install
bun run typecheck     # tsc --noEmit
bun run lint          # ESLint (eslint.config.mjs)
bun run test          # Vitest (新規テスト含む全件)
bun run build         # dist/ ビルド
```

検収基準:

- `bun run typecheck` がエラー 0 で完了する。
- `bun run lint` が警告 0 で完了する（既存設定下）。
- `bun run test` が **既存 201 件 + 新規/更新分** すべて pass。
- `dist/` 配下に `opencode-plugin.js` が正常に生成される。

---

## 13. 想定外スコープ（YAGNI 適用）

- `wisdom.json` の v2 → v1 ダウングレード機能は提供しない。
- TUI プラグインからの直接トースト表示は本イテレーションでは実装しない（インターフェースのみ整備）。
- `LearningExtractor` の根本原因マーカー抽出は Sisyphus 経路にのみ適用し、他ペルソナの success 経路は既存挙動を維持する。
- 新規 npm パッケージ追加なし。組み込みモジュール（`node:crypto`, `node:path`, `node:os`, `node:fs/promises`）と既存 `@opencode-ai/plugin` エコシステムのみ使用。

---

## 14. 受け入れ条件サマリ

1. Atlas が `writing-plans` を完了した直後、PostToolUse → Atlas Guidance Directive が注入される。
2. `wisdom.json` がペルソナ別 v2 形式で永続化され、Atlas 起動時には Atlas 名前空間の Wisdom のみが注入される。
3. Prometheus が連続 3 回 NG を出すと、Hephaestus 向け pivot プロンプトが注入される。
4. Sisyphus の `systematic-debugging` 完了時、根本原因が `Sisyphus` 名前空間に保存される。
5. すべての hook 発火時、トースト相当のバナーが `injectedContext` 先頭に表示され、`client.app.log` 経由でも通知される。
6. 既存 Vitest テストが破壊されず、新規テストを含めすべて pass する。
