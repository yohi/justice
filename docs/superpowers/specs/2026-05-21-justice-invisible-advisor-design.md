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

- **B 段階 (PreToolUse 捕捉)**: `toolInput.skills` / `toolInput.loadSkills` 配列にスキル名を含むか、`toolInput.role` / `toolInput.prompt` にスキル名文字列が含まれる場合、`(sessionId, SkillTarget)` の複合キーで保留登録（メモリ TTL 5 分、最大 50 セッション、`LoopDetectionHandler` と同水準）。
  - 例: 同一 task() で `loadSkills: ["writing-plans", "systematic-debugging"]` を同時指定した場合、`(sessionId, "writing-plans")` と `(sessionId, "systematic-debugging")` の **2 件を独立に登録**する。
- **A 段階 (PostToolUse 検証)**:
  - 引数 `target` に対応する保留フラグが立っていれば `confidence: high` 確定。
  - 保留フラグがなくとも、`toolResult` に以下が含まれれば `confidence: medium` で検出：
    - writing-plans: `docs/superpowers/specs/\d{4}-\d{2}-\d{2}-.*-design\.md` パスもしくは `## Architecture` + `## Implementation` 同時出現
    - systematic-debugging: `Root cause:` / `根本原因:` マーカー
- 検出後は **`(sessionId, target)` の保留のみを消去**（target スコープでの多重検出防止）。同一 sessionId の別 target 保留には影響しない。

#### `lastInvokedPersona` のスキル名・エージェント名 → ペルソナ対応

`recordPreToolUseInvocation` は `toolInput` を以下の優先順位で評価し、`(sessionId → AgentId)` のマップに保存する。TTL/最大件数は保留 Map と同水準（5 分・50 セッション）。

| 優先順位 | 入力フィールド | マッチ条件 | 対応 `AgentId` |
|---|---|---|---|
| 1 | `toolInput.agent` | 文字列値が `"atlas"` / `"hephaestus"` / `"sisyphus"` / `"prometheus"` のいずれか（大文字小文字無視） | その値そのまま |
| 2 | `toolInput.skills` / `toolInput.loadSkills` | 配列要素に `"code-quality-reviewer"` を含む | `"prometheus"` |
| 3 | `toolInput.skills` / `toolInput.loadSkills` | 配列要素に `"systematic-debugging"` を含む | `"sisyphus"` |
| 4 | `toolInput.skills` / `toolInput.loadSkills` | 配列要素に `"writing-plans"` / `"brainstorming"` を含む | `"atlas"` |
| 5 | `toolInput.role` / `toolInput.prompt` | 文字列内に上記スキル名のいずれかを含む（部分一致） | スキル名に応じて 2〜4 と同じ |
| 6 | 上記いずれにも該当しない | — | 記録しない（`lastInvokedPersona` は `undefined` を返す） |

複数該当時は優先順位の上位を採用。本対応表は **`PersonaClassifier` の category/errorClass ルールとは独立**であり、`lastInvokedPersona` 専用の推定経路として扱う。

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

### 7-1. 2 層通知設計（MVP）

OpenCode の `TuiToast` API はサーバーサイドフックから直接呼び出せないため、本 MVP では以下の 2 層を組み合わせて「トースト相当」の UX を実現する。`JusticeNotifier` 抽象は **この 2 層を統合するための最小限のインターフェース** として定義する。将来拡張への配慮（追加メソッド、TUI 連携用の余剰契約等）は持ち込まない。

#### Layer 1: `client.app.log` 経由のログ通知（即時可視化）
`OpenCodeAdapter` から渡される `log` 関数を `OpenCodeNotifier` 内部で利用し、`service: "justice"` の構造化メッセージを送信。`JusticeNotifier.notify()` がこのレイヤを担う。

#### Layer 2: `injectedContext` 先頭バナー（チャット上で必ず目視）
各 hook の `inject` レスポンスの先頭に Markdown バナーを必ず埋め込む。`JusticeNotifier.formatBanner()` がこのレイヤを担う。

```text
> 🎯 **JUSTICE NOTIFICATION** [Atlas Orchestration]
> Atlas が writing-plans を完了 — 次のステップは Hephaestus に委譲してください。

---
[詳細プロンプト本文...]
```

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

/**
 * MVP の 2 層通知（Layer 1: log, Layer 2: banner）を統合するための
 * 最小限のインターフェース。これ以上のメソッドは追加しない。
 */
export interface JusticeNotifier {
  notify(notification: JusticeNotification): void | Promise<void>;
  formatBanner(notification: Omit<JusticeNotification, "sessionId" | "taskId">): string;
}

/**
 * 通知不要な経路（既存テスト互換、CI 等）で使用するデフォルト実装。
 */
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
- `recordReviewOutput` は **NG 判定ロジックを 1 箇所に集約するメソッド**として設計する。内部では以下の副作用を伴う点に留意する（実装時に省略不可）：
  - `rejections` Map への excerpt 追記（§6-3 ステップ 3）
  - `recordTrial` への連動記録（§6-3 ステップ 4、`agent: "prometheus", result: "failure"`）
  - `removeSession` 時の `rejections` Map クリーンアップ（§6-3 末尾）

  ただし入力 `reviewerOutput` を変異させず、`PivotDecision` を毎回新規生成して返す点で **入出力は不変**である。
- `PlanCompletionDetector` のセッション保留 Map（`(sessionId, SkillTarget)` 複合キー、§4-1 参照）および `lastInvokedPersona` マップは LRU + TTL で確実に解放（メモリリーク防止）。

---

## 9. テスト戦略

本セクションでは、実装時の解釈ブレを排除するため、新規/更新テストごとに **入力値 / 期待出力 / カバーするエッジケース** を表で明示する。すべてのテストは Vitest + `tests/helpers/mock-file-system.ts` の既存パターンに沿い、I/O は注入されたモック経由でのみ行う。

### 9-1. `tests/core/persona-classifier.test.ts`（新規）

検証対象: `PersonaClassifier.classify(entry: { category, errorClass })`

| # | 入力 `category` | 入力 `errorClass` | 期待 出力 | カバー観点 |
|---|---|---|---|---|
| 1 | `"design_decision"` | `undefined` | `"atlas"` | 設計判断 → Atlas |
| 2 | `"design_decision"` | `"design_error"` | `"atlas"` | 優先順位 1 が優先（errorClass 一致でも崩れない） |
| 3 | `"failure_gotcha"` | `"design_error"` | `"atlas"` | 優先順位 1（errorClass）が category より上 |
| 4 | `"failure_gotcha"` | `"loop_detected"` | `"sisyphus"` | 優先順位 2: ループ検知 |
| 5 | `"environment_quirk"` | `"timeout"` | `"sisyphus"` | 優先順位 2（errorClass）が category 4 より上 |
| 6 | `"environment_quirk"` | `undefined` | `"sisyphus"` | 優先順位 4: 環境特異性 |
| 7 | `"success_pattern"` | `undefined` | `"hephaestus"` | 優先順位 5 |
| 8 | `"failure_gotcha"` | `undefined` | `"hephaestus"` | 優先順位 5 |
| 9 | `"success_pattern"` | `"syntax_error"` | `"hephaestus"` | 優先順位 5（category=success_pattern）が errorClass の非該当値より上位であることを確認 |
| 10 | `"success_pattern"` | `"unknown"` | `"hephaestus"` | 同上（errorClass=`"unknown"` は優先順位 1/2 に該当しない） |
| 11 | `"unknown_category" as WisdomCategory` | `undefined` | `"hephaestus"` | **真の DEFAULT_PERSONA（優先順位 6）**: 全カテゴリ・errorClass に該当しない場合のフォールバック |
| 12 | `"unknown_category" as WisdomCategory` | `"unknown_class"` | `"hephaestus"` | 同上、errorClass も非該当値の場合 |

エッジケース:
- `category` が `undefined` キャストされた場合 → `"hephaestus"` を返す（型強制で渡されることはないが防御的に確認、優先順位 6 経由）。

### 9-2. `tests/core/review-rejection-detector.test.ts`（新規）

検証対象: `ReviewRejectionDetector.detect(text: string): ReviewRejectionSignal`

| # | 入力 `text` | 期待 `matched` | 期待 `excerpts` 件数 | 期待 `summary` 長 | カバー観点 |
|---|---|---|---|---|---|
| 1 | `""`（空文字列） | `false` | `0` | `0` | 空入力で副作用なし |
| 2 | `"approved with minor nits"` | `false` | `0` | `0` | 偽陽性除外（approve は否定的でない） |
| 3 | `"REJECTED: missing error handling"` | `true` | `1` | `>0` 〜 `≤300` | 単一行マッチ |
| 4 | `"BLOCKER: race condition\nMUST FIX: nullable\ndo not merge"` | `true` | `3` | `≤300` | 複数行マッチ、上限 3 件 |
| 5 | 同上に4行目 `"❌ critical issue"` 追加 | `true` | `3`（4 件目は除外） | `≤300` | excerpt 上限 3 件で打ち切り |
| 6 | 1 行が 500 文字の `"MUST FIX: " + "x".repeat(500)` | `true` | `1`、長さ `200` | `≤300` | excerpt 1 件は ≤200 文字に切り詰め |
| 7 | `"不承認: アーキテクチャ要修正"` | `true` | `1` | `>0` | 日本語パターン |
| 8 | `"please reject this approach"` | `true` | `1` | `>0` | `\brejected?\b` の bare verb 一致（"reject" 単独） |
| 9 | `"approval denied due to security"` | `true` | `1` | `>0` | 連語パターン |
| 10 | `"DO NOT MERGE"`（全大文字） | `true` | `1` | `>0` | 大文字小文字を問わない |

エッジケース:
- `null` / `undefined` は型上渡らないため検証対象外。空文字列 (#1) でガードする。
- すべての RegExp パターン (`REVIEW_REJECTION_PATTERNS`) について、少なくとも 1 件の陽性テストが上表に対応している。

### 9-3. `tests/core/plan-completion-detector.test.ts`（新規）

検証対象: `PlanCompletionDetector` の `recordPreToolUseInvocation` / `evaluateSkillCompletion` / `lastInvokedPersona`

| # | シナリオ | 入力 | 期待 出力 / 状態 |
|---|---|---|---|
| 1 | PreToolUse で `loadSkills: ["writing-plans"]` を記録 → PostToolUse で `target: "writing-plans"` を評価 | toolName=`"task"`, toolResult=`"plan written"` | `{ source: "skill_marker", confidence: "high" }` |
| 2 | PreToolUse 未登録、PostToolUse で `toolResult` に `"docs/superpowers/specs/2026-05-21-foo-design.md"` を含む | target=`"writing-plans"` | `{ source: "result_path", confidence: "medium", planFilePath: "docs/superpowers/specs/2026-05-21-foo-design.md" }` |
| 3 | PreToolUse 未登録、PostToolUse `toolResult` が `"## Architecture\n...\n## Implementation"` を含む | target=`"writing-plans"` | `{ source: "result_marker", confidence: "medium" }` |
| 4 | PreToolUse 登録あり、PostToolUse は `isError: true` | target=`"writing-plans"` | `null`（エラー時は完了とみなさない） |
| 5 | PreToolUse 未登録、PostToolUse `toolResult` が完全な無関係文字列（`"hello world"`） | target=`"writing-plans"` | `null` |
| 6 | 同一 sessionId で 2 連続評価（保留消去確認） | 1 回目: high 検出 → 2 回目: 同 sessionId/同 toolResult | 1 回目 `high`、2 回目 `null`（保留消去済み、result マッチも無ければ） |
| 7 | TTL 境界: 記録から 5 分 + 1ms 経過 | `recordPreToolUseInvocation` → 5min+1ms 進行 → `evaluateSkillCompletion` | `null`（TTL 切れで保留破棄）。`Date.now` モック必須 |
| 8 | TTL 境界: 記録から 5 分ちょうど（境界内） | 同上 → 5min − 1ms 進行 | `{ confidence: "high" }`（境界内は維持） |
| 9 | 最大件数境界: 51 個の異なる sessionId を登録 | 1 個目の sessionId で `lastInvokedPersona` を呼ぶ | `undefined`（LRU で最古が evict されている） |
| 10 | `lastInvokedPersona`: `toolInput.skills: ["code-quality-reviewer"]` を記録 | 同一 sessionId | `"prometheus"` |
| 11 | `lastInvokedPersona`: `toolInput.agent: "sisyphus"` を記録 | 同一 sessionId | `"sisyphus"` |
| 12 | `lastInvokedPersona`: 何も記録されていない sessionId | — | `undefined` |
| 13 | 不正な `toolInput`（プロパティ欠落、型不一致） | `recordPreToolUseInvocation(sessionId, "task", { unknownKey: 123 })` | 例外を throw しない、保留も登録されない |
| 14 | `target: "systematic-debugging"` で `toolResult` が `"Root cause: ..."` を含む | target=`"systematic-debugging"` | `{ source: "result_marker", confidence: "medium" }` |
| 15 | `target: "systematic-debugging"` で `toolResult` が `"根本原因: ..."` を含む（日本語） | 同上 | `{ source: "result_marker", confidence: "medium" }` |

### 9-4. `tests/core/wisdom-persistence-migration.test.ts`（新規）

検証対象: `WisdomPersistence.load()` / `loadStrict()` / `saveAtomic()` の v1/v2 ハンドリング

| # | ディスク上の入力 | 期待挙動 |
|---|---|---|
| 1 | ファイル不在（ENOENT） | 空ストアを返す（既存挙動維持） |
| 2 | 空文字列 `""` | 空ストアを返す |
| 3 | `"{ not json"`（破損 JSON） | `load()` は空ストアを返す。`loadStrict()` は throw |
| 4 | v1 形式 `{ entries: [<persona無 entry>], maxEntries: 100 }` | 各 entry に `PersonaClassifier.classify()` で persona 付与した状態でロードされる |
| 5 | v1 形式の entry 全件（10 件）について、各 `category`/`errorClass` の組合せが §9-1 の出力どおりにバケットに振り分けられる | バケット件数の検証 |
| 6 | v2 形式 `{ version: 2, maxEntries: 100, byAgent: { Atlas: [...], ... } }` | `byAgent` の各キーが内部 `AgentId` 小文字に変換されてロード（ラベル `"Atlas"` → `"atlas"`） |
| 7 | v2 形式で `byAgent` に未知のキー `"Unknown"` が混入 | 未知キーは無視（fail-open）、既知キーのみロード |
| 8 | v2 形式で `entries` も併存（移行途中の不整合） | `version === 2` が優先され、`entries` は無視 |
| 9 | `saveAtomic(store)` を v1 ファイル上で実行 | temp + rename 後、ディスクは v2 形式（`version: 2`, `byAgent`）のみ |
| 10 | `saveAtomic` の `mergeById`: disk と memory に同一 `id` がある場合、新しい timestamp 側の `persona` が採用される | persona が disk: `"atlas"`、memory: `"hephaestus"`（新しい）→ 結果 `"hephaestus"` |
| 11 | 認識不能形式（配列でない、`entries`/`byAgent` どちらもない） | `loadStrict` は throw、`load` は空ストア |

### 9-5. `tests/core/justice-notifier.test.ts`（新規）

検証対象: `NoOpNotifier` および `formatBanner` の出力フォーマット

| # | 入力 | 期待出力 |
|---|---|---|
| 1 | `NoOpNotifier.notify(任意の通知)` | `undefined` を返す（throw しない、ログも出さない） |
| 2 | `NoOpNotifier.formatBanner(任意)` | `""`（空文字列） |
| 3 | `formatBanner({ variant: "atlas_orchestration", title: "Atlas", message: "委譲してください", level: "info" })` | 行 1: `"> 🎯 **JUSTICE NOTIFICATION** [Atlas]"`、行 2: `"> 委譲してください"`、行 3: `""` |
| 4 | `formatBanner({ variant: "architecture_pivot", title: "Pivot", message: "再検討", level: "warning" })` | 行 1 アイコン `🚧`、その他の行構造 #3 同等 |
| 5 | `formatBanner({ variant: "wisdom_saved", title: "Saved", message: "", level: "info" })` | message 空でも 3 行構成を維持（行 2 は `"> "`） |
| 6 | `JusticeNotifier.notify()` が同期 throw する実装に対し、上位コードから呼び出して例外が伝播しないこと | `notify()` の呼び出しは例外を再 throw しない設計のため、テストは「呼び出し側が try/catch 不要」を確認 |

### 9-6. `tests/runtime/opencode-notifier.test.ts`（新規）

検証対象: `OpenCodeNotifier.notify()` の `client.app.log` 呼び出し

| # | 入力 `notification.level` | 期待 `log` 引数 `level` | 期待 `service` | 期待 `message` 形式 |
|---|---|---|---|---|
| 1 | `"info"` | `"info"` | `"justice"` | `"<icon> [<title>] <message>"` |
| 2 | `"success"` | `"info"`（success → info マッピング） | `"justice"` | 同上 |
| 3 | `"warning"` | `"warn"`（warning → warn マッピング） | `"justice"` | 同上 |
| 4 | `"error"` | `"error"` | `"justice"` | 同上 |
| 5 | `log` 関数が throw する場合 | `notify()` 自身は throw しない（catch して握りつぶす） | — | — |
| 6 | `notification.sessionId` / `taskId` を渡した場合 | `extra: { variant, sessionId, taskId }` フィールドが含まれる | — | — |
| 7 | `notification.sessionId` / `taskId` が未指定 | `extra` 内の各フィールドは `undefined` | — | — |

### 9-7. `tests/core/wisdom-store.test.ts`（更新）

| # | シナリオ | 入力 | 期待出力 |
|---|---|---|---|
| 1 | `add(draft)` を 4 ペルソナそれぞれに 1 件ずつ | 各 draft に明示 `persona` | `getAllEntries()` 長さ = 4、タイムスタンプ昇順 |
| 2 | `add(draft, { persona: "atlas" })` で entry.persona と異なる persona を渡す | `entry.persona: "hephaestus"`, options: `"atlas"` | options が優先（`"atlas"` バケットに保存） |
| 3 | `add(draft)` で persona 未指定 | `category: "design_decision"` の draft | `PersonaClassifier` フォールバックで `"atlas"` |
| 4 | `getRelevant({ persona: "hephaestus" })` | hephaestus に 3 件、他に 2 件 | 3 件のみ返却、すべて `persona === "hephaestus"` |
| 5 | `getRelevant({ persona: "atlas", maxEntries: 1 })` | atlas に 5 件 | 最新 1 件のみ |
| 6 | `getRelevant({})`（persona 未指定） | 全 4 ペルソナに各 1 件 | 4 件返却、タイムスタンプ昇順 |
| 7 | LRU eviction 境界: `maxEntries: 3` で 4 件 add | 1→2→3→4 を異なるペルソナに追加 | 最古 1 件が evict され、合計 3 件 |
| 8 | LRU eviction が偏りなく動作: 全件 `"hephaestus"` に 4 件 add（`maxEntries: 3`） | — | `"hephaestus"` バケットが 3 件、ほか 0 件 |
| 9 | `replaceEntries([])` | — | 全バケットが空 |
| 10 | `replaceEntries([persona無 entry])` （マイグレーション経由相当）| persona 欠落 entry を受け取る | `PersonaClassifier` で振り分け |

### 9-8. `tests/core/tiered-wisdom-store.test.ts`（更新）

| # | シナリオ | 入力 | 期待出力 |
|---|---|---|---|
| 1 | local に hephaestus 3 件、global に hephaestus 2 件、`getRelevant({ persona: "hephaestus", maxEntries: 5 })` | — | local 3 + global 2 = 5 件、local 優先順 |
| 2 | local に atlas 1 件、global に atlas 3 件、`getRelevant({ persona: "atlas", maxEntries: 2 })` | — | local 1 + global 1（残り 1 件分のみ） |
| 3 | local 0 件、global hephaestus 5 件、`getRelevant({ persona: "atlas", maxEntries: 5 })` | — | 0 件（atlas に該当なし） |
| 4 | local と global で同一 id の entry がある場合 | 同一 id | local 優先で重複排除（`localIds` set による） |

### 9-9. `tests/core/learning-extractor.test.ts`（更新）

| # | シナリオ | 入力 | 期待出力 |
|---|---|---|---|
| 1 | `extract(feedback, raw)` で `context` 未指定 | `category` から推定 | 各 draft の `persona` が `PersonaClassifier` 結果と一致 |
| 2 | `extract(feedback, raw, { persona: "sisyphus" })` | context 明示 | 全 draft の `persona === "sisyphus"`（自動推定を上書き） |
| 3 | systematic-debugging 経路: `rawOutput` に `"Root cause: race condition"` を含む `status: "success"` | feedback.testResults なし | 少なくとも 1 件の draft、`category === "design_decision"` |
| 4 | systematic-debugging 経路: `rawOutput` に `"根本原因: ..."` を含む | 同上 | #3 と同等の出力 |
| 5 | systematic-debugging マーカーが無い `status: "success"` で `testResults.passed > 0` | 既存挙動 | 既存と同じ `success_pattern` draft が生成される（後方互換性） |

### 9-10. `tests/hooks/plan-bridge.test.ts`（更新）

| # | シナリオ | 入力 | 期待出力 |
|---|---|---|---|
| 1 | PostToolUse で writing-plans 完了検知（PreToolUse 保留あり） | `task` 完了、`toolResult` に planPath を含む | `action: "inject"`、`injectedContext` 先頭が Atlas Guidance バナー（🎯）、本文に「自ら実装に着手せず」を含む |
| 2 | PostToolUse で systematic-debugging 完了検知 | 同上で根本原因マーカーあり | `action: "inject"`、Sisyphus Wisdom 保存ログ込み、`wisdomStore` に追加されている |
| 3 | PostToolUse で `lastInvokedPersona === "prometheus"` かつ 3 回目の NG | recordReviewOutput で pivot 確定 | `action: "inject"`、pivot バナー（🚧）と Hephaestus 向け文言を含む |
| 4 | PostToolUse で上記いずれにも該当しない（通常の task 完了） | — | `action: "proceed"` |
| 5 | `wisdomStore` が null の状態で Sisyphus 経路を踏む | — | `action: "proceed"`（保存スキップ、エラーにしない） |

### 9-11. `tests/hooks/loop-handler.test.ts`（更新）

| # | シナリオ | 入力 | 期待 `PivotDecision` |
|---|---|---|---|
| 1 | NG を 1 回だけ | rejectionDetector で matched=true | `pivoted: false`、`rejections: 1`、`recentExcerpts.length: 1` |
| 2 | NG を 3 回連続（閾値ちょうど） | maxRejections=3 デフォルト | `pivoted: true`、`reason: "review_rejection_threshold"`、`targetAgent: "hephaestus"` |
| 3 | NG を 2 回（閾値直前） | — | `pivoted: false` |
| 4 | NG マッチしない出力 | matched=false | `pivoted: false`、`rejections: 据え置き`、`recentExcerpts: []` |
| 5 | 環境変数 `MAX_REVIEW_REJECTIONS_BEFORE_PIVOT=5` で 5 回目に pivot | — | `pivoted: true`（5 回目）、4 回目では `pivoted: false` |
| 6 | 環境変数が `"abc"`（NaN） | — | デフォルト 3 にフォールバック |
| 7 | 環境変数が `"0"` または `"-1"` | — | デフォルト 3 にフォールバック |
| 8 | NG カウント中の `recordTrial` 連動 | `recordReviewOutput` 後 | `getTrialHistory(sessionId, taskId)` に `agent: "prometheus", result: "failure", wisdom` が含まれる |
| 9 | `removeSession` 後の状態 | NG 3 回後にセッション削除 | `rejections` Map 該当エントリも削除されている |

### 9-12. 統合テスト

#### `tests/integration/atlas-orchestration-flow.test.ts`（新規）

シナリオ: 「Atlas が `writing-plans` 完了 → Atlas Guidance 注入 → 次の `task()` 呼び出しで Hephaestus 委譲リクエストが構築される」

検証ステップ:
1. PreToolUse: `task`, `toolInput: { skills: ["writing-plans"], prompt: "..." }` を発火 → `PlanCompletionDetector` 保留登録。
2. PostToolUse: `task`, `toolResult: "Plan written to docs/superpowers/specs/2026-05-21-foo-design.md\n## Architecture\n## Implementation"`, `error: false` → `inject` レスポンスに 🎯 バナーと推奨エージェント（mock plan に基づき `"hephaestus"`）を含む。
3. PreToolUse: 次の `task` を発火 → `previousLearnings` が atlas wisdom 由来であることを確認。

#### `tests/integration/role-based-wisdom-flow.test.ts`（新規）

シナリオ:
1. `wisdomStore.add({ persona: "hephaestus", ... })` で 3 件追加。
2. `wisdomStore.add({ persona: "atlas", ... })` で 2 件追加。
3. PlanBridge が `delegation.context.agentId: "atlas"` で task 委譲する局面を mock → `getRelevant({ persona: "atlas" })` で 2 件のみ取得され、injectedContext に hephaestus wisdom が含まれないことを assert。

#### `tests/integration/review-rejection-pivot-flow.test.ts`（新規）

シナリオ:
1. PreToolUse: `task`, `toolInput: { skills: ["code-quality-reviewer"] }` を 3 回発火（同一 sessionId/taskId）。
2. 各回 PostToolUse: `toolResult: "REJECTED: <理由>"` を発火。
3. 1 回目・2 回目は `proceed`、3 回目で `inject` レスポンスが返り、🚧 バナーと Hephaestus 向け pivot 文言を含む。
4. `loopHandler.getTrialHistory(sessionId, taskId)` に 3 件の prometheus failure record が記録されている。

### 9-13. テストヘルパー

- `tests/helpers/mock-notifier.ts` — `createMockNotifier(): { notifier: JusticeNotifier; calls: JusticeNotification[]; banners: string[]; }`。`notify` 呼び出しを `calls` 配列に push、`formatBanner` 呼び出しの返値を `banners` に追記。
- `tests/helpers/wisdom-draft-factory.ts` — `makeWisdomDraft(partial?: Partial<WisdomEntryDraft>): WisdomEntryDraft`。デフォルト `{ taskId: "task-1", category: "success_pattern", content: "test", persona: "hephaestus" }`。既存テストの書き換え量を最小化。

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
- `JusticeNotifier` は MVP 2 層（log + banner）のみを統合する最小契約。TUI 連携・カスタムチャネル等の追加メソッドは導入しない。
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
