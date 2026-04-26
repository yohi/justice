# Justice Expansion 設計書 (v2026.04.26)

## 0. メタ情報

| 項目 | 値 |
|------|----|
| 作成日 | 2026-04-26 |
| 対象バージョン | Justice v2026.03.25 拡張 |
| 想定ロール | Justice Core Maintainer (Senior Engineer) |
| 対象ブランチ | `master` を起点とする feature/justice-expansion-* |
| 関連スキル | `superpowers/brainstorming`（本書作成）→ `superpowers/writing-plans`（次工程） |

## 1. 目的とスコープ

Justice システムにおける **グローバル知見（Wisdom）の信頼性向上** と、**エージェントの自己診断・自己適応能力の強化** を目的とした拡張設計を定義する。

本設計のスコープは下記 4 Phase に限定する。

| Phase | 主題 |
|-------|------|
| Phase 1 | `WisdomPersistence` の楽観ロック（mtime ベース）と Fail-Open 退避 |
| Phase 2 | Wisdom メトリクス（hitCount）と LRU eviction 連動アーカイブ |
| Phase 3 | `TelemetryStore` 新設と `justice status --analytics --json` |
| Phase 4 | `LoopDetectionHandler` における動的 maxRetries 算出 |

## 2. 設計原則と制約

`AGENTS.md` の制約を厳守する。

1. **NO Business Logic in Hooks**: 純粋ロジックは `src/core/` に配置し、Hook 層は委譲のみ。
2. **NO Unsafe File System Operations**: ロックは Optimistic（mtime ベース）に限定し、Blocking lock を導入しない。書き込みは `temp + rename` の atomic write を堅持。
3. **NO State Mutation**: 全 type は `readonly` を維持。`hitCount` のような可変メタデータは `WisdomEntry` に直接持たせず、別レコードで関心を分離する。
4. **Fail-Open Policy**: 全ての新ハンドラは `try/catch` で例外を握り、メイン処理を継続する。`process.exit(0)` は呼ばない。
5. **Devcontainer Mandatory**: テスト・型検査・リンタの実行は `.devcontainer` 内で行う前提とし、絶対パスをコードに含めない。

## 3. アーキテクチャ概観

### 3.1 新規追加モジュール

```text
src/core/
├── wisdom-metrics.ts          ← Phase 2: hitCount/lastHitAt の管理（純粋ロジック）
├── wisdom-archive.ts          ← Phase 2: 重要度判定 + 永続化
├── telemetry-store.ts         ← Phase 3: failure_rate / wisdom_hit_rate / error_distribution
└── retry-policy-calculator.ts ← Phase 4: Base + Category + Volume の動的閾値算出
```

### 3.2 既存モジュールへの追加（破壊的変更なし）

| ファイル | 変更内容 |
|---------|---------|
| `src/core/types.ts` | `WisdomMetricsEntry` / `LockMetadata` / `TelemetrySnapshot` / `RetryThresholdContext` 等を追加。既存 type は据え置き。 |
| `src/core/wisdom-persistence.ts` | `saveAtomicWithLock(store, lockMeta?)` を追加。既存 `saveAtomic` は `@deprecated` で残置。 |
| `src/core/wisdom-store.ts` | `attachMetrics(metrics)` と `onEvict(listener)` を追加。`getRelevant()` 時に `WisdomMetrics.recordHit` を呼ぶ。 |
| `src/core/tiered-wisdom-store.ts` | LRU eviction フックで `WisdomArchive` に重要度判定を委譲。 |
| `src/core/status-command.ts` | `getStatusWithAnalytics()` と `formatAsJson()` を追加。`TelemetryStore` を依存注入。 |
| `src/hooks/loop-handler.ts` | `CategoryClassifier` と `RetryPolicyCalculator` を注入し `evaluateEscalation()` で動的閾値を参照。 |
| `src/core/justice-plugin.ts` | 新モジュールを wiring。`TelemetryStore` を全ハンドラに注入。 |

### 3.3 データ永続化レイアウト

```text
~/.justice/                        # global tier
├── wisdom.json                    # 既存
├── wisdom-archive.json            # 新規 (Phase 2 — global eviction 用)
├── wisdom-metrics.json            # 新規 (Phase 2 — global tier 用)
└── wisdom.conflict.json           # 新規 (Phase 1 fail-open。tier に依存しない退避ログ)

.justice/                          # project-local tier
├── wisdom.json                    # 既存
├── wisdom-archive.json            # 新規 (Phase 2 — local eviction 用)
├── wisdom-metrics.json            # 新規 (Phase 2 — local tier 用)
└── telemetry.json                 # 新規 (Phase 3 — プラン単位の集計のため project-local のみ)
```

`HOME` は `NodeFileSystem` レイヤーで解決し、ハードコードしない。

**配置設計の方針**:

- `wisdom-archive.json` / `wisdom-metrics.json`: 既存 `wisdom.json` と同じく **両 tier に併設**。`TieredWisdomStore` が tier ごとに別インスタンスを wiring する。
- `wisdom.conflict.json`: **global tier 1 箇所のみ**。複数プロジェクトをまたぐ catastrophic event をすべて単一ログに集約する目的。
- `telemetry.json`: **project-local のみ**。集計の対象が plan 単位（task の成功/失敗、wisdom 注入）であり、プロジェクトをまたぐ意味付けがないため。

## 4. 型定義の拡張（`src/core/types.ts`）

### 4.1 Phase 1: Optimistic Lock

```typescript
export interface LockMetadata {
  readonly mtimeMs: number;
  readonly path: string;
  readonly snapshotAt: number;
}

export interface ConflictRecord {
  readonly entries: readonly WisdomEntry[];
  readonly attemptedAt: string;
  readonly reason: "mtime_mismatch" | "rename_conflict";
  readonly retryCount: number;
}
```

### 4.2 Phase 2: Wisdom Metrics & Archive

```typescript
export interface WisdomMetricsEntry {
  readonly entryId: string;
  readonly hitCount: number;
  readonly lastHitAt: string | null;
  readonly firstSeenAt: string;
}

export interface ArchiveThresholds {
  readonly environmentQuirkMinHits: number;   // default: 3
}

export interface ArchivedWisdom {
  readonly entry: WisdomEntry;
  readonly metrics: WisdomMetricsEntry;
  readonly archivedAt: string;
  readonly archiveReason: "high_priority_category" | "hit_count_threshold";
}
```

### 4.3 Phase 3: Telemetry

```typescript
export interface TelemetrySnapshot {
  readonly windowSize: number;
  readonly failureRate: number;
  readonly wisdomHitRate: number;
  readonly errorDistribution: Readonly<Record<ErrorClass, number>>;
  readonly generatedAt: string;
}

export type TelemetryEvent =
  | { readonly type: "task_completed"; readonly taskId: string; readonly status: TaskFeedbackStatus; readonly errorClass?: ErrorClass; readonly timestamp: string; }
  | { readonly type: "wisdom_injected"; readonly entryIds: readonly string[]; readonly taskId: string; readonly timestamp: string; }
  | { readonly type: "wisdom_hit"; readonly entryId: string; readonly taskId?: string; readonly timestamp: string; };
```

### 4.4 Phase 4: Adaptive Retry

```typescript
export interface RetryThresholdContext {
  readonly category: TaskCategory;
  readonly stepCount: number;
}

export interface RetryThresholdResult {
  readonly base: number;
  readonly categoryModifier: number;
  readonly volumeModifier: number;
  readonly maxRetries: number;
}
```

### 4.5 `FileReader` インターフェース拡張

```typescript
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;       // 追加
}

export interface FileStat {
  readonly mtimeMs: number;
  readonly size: number;
}
```

`NodeFileSystem.stat()` は `node:fs/promises` の `stat` 呼び出しをラップする。Mock 側にも `stat` を追加。既存テストは `stat` を呼ばないため挙動への影響はない。

## 5. Phase 1: Optimistic Locking 詳細

### 5.1 API

```typescript
class WisdomPersistence {
  async loadWithLock(): Promise<{ store: WisdomStore; lockMeta: LockMetadata }>;

  async saveAtomicWithLock(
    store: WisdomStore,
    initialLockMeta?: LockMetadata,
  ): Promise<SaveResult>;
}

interface SaveResult {
  readonly status: "saved" | "conflict_diverted";
  readonly retries: number;
  readonly conflictPath?: string;
}
```

### 5.2 処理フロー

1. `lockMeta` を `initialLockMeta ?? stat(wisdomFilePath).mtimeMs` で確定。
2. `for retry in 0..3`:
    - 現在の `stat.mtimeMs` を取得。
    - `lockMeta.mtimeMs !== currentStat.mtimeMs` の場合:
        - ディスクから再ロード。
        - メモリ store と `mergeById` でマージ（既存 `mergeById` を再利用）。
        - `lockMeta = currentStat`。
        - 指数バックオフで sleep し continue。
    - 一致する場合:
        - tmp に書き込み → `rename` で commit。
        - rename 直前にも `stat` を取り直し、変化していないことを確認。
        - 成功時 `{ status: "saved", retries }` を返す。
3. リトライ上限到達時:
    - `divertToConflictFile(store.getAllEntries())` で `wisdom.conflict.json` に退避。
    - `console.warn` で警告。
    - `{ status: "conflict_diverted", retries: 3, conflictPath }` を返す。

### 5.3 指数バックオフ

| retry | base delay | jitter | min – max |
|-------|-----------|--------|-----------|
| 0     | 100ms     | 0–50ms | 100–150ms |
| 1     | 200ms     | 0–50ms | 200–250ms |
| 2     | 400ms     | 0–50ms | 400–450ms |

`Math.random()` で jitter を生成。テスト容易性のため `Math.random` をモック差し替え可能にする。

### 5.4 退避ファイル `wisdom.conflict.json`

```typescript
interface ConflictFileSchema {
  readonly version: 1;
  readonly conflicts: readonly ConflictRecord[];
}
```

- 既存ファイルを読み込み、`conflicts` に append、atomic rename。
- `divertToConflictFile()` 自体が例外を投げた場合も `try/catch` で握りつぶし `console.warn` のみ。
- メイン処理は継続する。

### 5.5 既存 `saveAtomic` の扱い

```typescript
/**
 * @deprecated Use saveAtomicWithLock() for new call sites.
 */
async saveAtomic(store: WisdomStore): Promise<void> { /* 既存 */ }
```

`JusticePlugin` 経由の呼び出し点のみ `saveAtomicWithLock` に切り替える。既存テストは無変更で通る。

## 6. Phase 2: Wisdom Metrics & Archive 詳細

### 6.1 `WisdomMetrics` クラス

```typescript
export class WisdomMetrics {
  private readonly metrics = new Map<string, WisdomMetricsEntry>();
  private hitListener?: (entryId: string) => void;

  recordHit(entryId: string, now: Date = new Date()): WisdomMetricsEntry {
    const existing = this.metrics.get(entryId);
    const next: WisdomMetricsEntry = existing
      ? { entryId, hitCount: existing.hitCount + 1, lastHitAt: now.toISOString(), firstSeenAt: existing.firstSeenAt }
      : { entryId, hitCount: 1, lastHitAt: now.toISOString(), firstSeenAt: now.toISOString() };
    this.metrics.set(entryId, next);
    this.hitListener?.(entryId);
    return next;
  }

  get(entryId: string): WisdomMetricsEntry | undefined { /* ... */ }
  getAll(): readonly WisdomMetricsEntry[] { /* ... */ }
  forget(entryId: string): void { /* ... */ }
  onHit(listener: (entryId: string) => void): void { this.hitListener = listener; }
  serialize(): string { /* ... */ }
  static deserialize(input: string | unknown): WisdomMetrics { /* ... */ }
}
```

`WisdomEntry` 型は **完全に未変更** のまま。`entryId` を外部キーとして連結する（Single Responsibility 維持）。

### 6.2 `WisdomStore` の更新フック

```typescript
class WisdomStore implements WisdomStoreInterface {
  private metrics?: WisdomMetrics;
  private evictionListener?: (evicted: WisdomEntry) => void;

  attachMetrics(metrics: WisdomMetrics): void { this.metrics = metrics; }
  onEvict(listener: (evicted: WisdomEntry) => void): void { this.evictionListener = listener; }

  getRelevant(options?): WisdomEntry[] {
    const results = /* 既存ロジック */;
    if (this.metrics) {
      const now = new Date();
      for (const entry of results) this.metrics.recordHit(entry.id, now);
    }
    return results;
  }

  add(entry, options?): WisdomEntry {
    const newEntry = /* 既存ロジック */;
    this.entries.push(newEntry);
    if (this.entries.length > this._maxEntries) {
      const evicted = this.entries.shift()!;
      this.evictionListener?.(evicted);
    }
    return newEntry;
  }
}
```

`WisdomEntry` 自体を mutate せず、副作用は `WisdomMetrics` のみに限定する。

### 6.3 `WisdomArchive` クラス

```typescript
export class WisdomArchive {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly archivePath: string = ".justice/wisdom-archive.json",
    private readonly thresholds: ArchiveThresholds = { environmentQuirkMinHits: 3 },
  ) {}

  shouldArchive(entry: WisdomEntry, metrics: WisdomMetricsEntry | undefined): {
    archive: boolean;
    reason?: ArchivedWisdom["archiveReason"];
  } {
    if (entry.category === "failure_gotcha" || entry.category === "design_decision") {
      return { archive: true, reason: "high_priority_category" };
    }
    if (entry.category === "environment_quirk") {
      const hits = metrics?.hitCount ?? 0;
      if (hits >= this.thresholds.environmentQuirkMinHits) {
        return { archive: true, reason: "hit_count_threshold" };
      }
    }
    return { archive: false };
  }

  async append(entry, metrics, reason): Promise<void> { /* load → push → atomic write */ }
  async loadAll(): Promise<readonly ArchivedWisdom[]> { /* ... */ }
}
```

### 6.4 `TieredWisdomStore` の eviction 連携

```typescript
class TieredWisdomStore {
  constructor(
    private readonly local: WisdomStore,
    private readonly global: WisdomStore,
    private readonly metrics: WisdomMetrics,
    private readonly archive: WisdomArchive,
  ) {
    local.attachMetrics(metrics);
    global.attachMetrics(metrics);
    local.onEvict((evicted) => this.handleEviction(evicted));
    global.onEvict((evicted) => this.handleEviction(evicted));
  }

  private async handleEviction(evicted: WisdomEntry): Promise<void> {
    const m = this.metrics.get(evicted.id);
    const decision = this.archive.shouldArchive(evicted, m);
    if (decision.archive && decision.reason) {
      try {
        await this.archive.append(evicted, m, decision.reason);
      } catch (err) {
        console.warn(`[JUSTICE] WisdomArchive.append failed: ${String(err)}`);
      }
    }
    this.metrics.forget(evicted.id);
  }
}
```

eviction は同期的だが、archive への書き込みは非同期 fire-and-forget。失敗は fail-open で warn のみ。

### 6.5 メトリクス・アーカイブの永続化

| ファイル | 永続化方式 | 楽観ロック |
|---------|-----------|----------|
| `wisdom-metrics.json` | atomic write (load → write tmp → rename) | 不要 |
| `wisdom-archive.json` | atomic write (append-style: load → push → write tmp → rename) | 不要 |

eviction 頻度は低く、複数プロセス同時更新の現実リスクが小さいため、Phase 1 と異なり楽観ロックは導入しない。

## 7. Phase 3: Telemetry 詳細

### 7.1 `TelemetryStore` クラス

```typescript
export class TelemetryStore {
  private events: TelemetryEvent[] = [];
  private readonly maxEvents: number;

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly telemetryPath: string = ".justice/telemetry.json",
    options: { maxEvents?: number } = {},
  ) {
    this.maxEvents = options.maxEvents ?? 500;
  }

  recordTaskCompleted(taskId: string, status: TaskFeedbackStatus, errorClass?: ErrorClass): void;
  recordWisdomInjection(entryIds: readonly string[], taskId: string): void;
  recordWisdomHit(entryId: string, taskId?: string): void;
  computeSnapshot(windowSize?: number): TelemetrySnapshot;
  async load(): Promise<void>;
  async save(): Promise<void>;
  private trimEvents(): void;
}
```

### 7.2 集計ロジックの定義

| メトリクス | 計算式 |
|----------|--------|
| `failureRate` | 直近 N 件の `task_completed` のうち `status !== "success"` の割合 |
| `wisdomHitRate` | 直近 N 件の `wisdom_injected` イベント（`taskId` ごと）のうち、当該 `taskId` に対する `task_completed` までに `wisdom_hit` が記録された割合 |
| `errorDistribution` | 直近 N 件の `task_completed` の `errorClass` を集計し、`ErrorClass` 全 9 種で正規化 |

`wisdomHitRate` の判定窓は **同一 `taskId` 内で完結** させ、タスクをまたぐ判定は行わない（オーバーカウント防止）。

### 7.3 `StatusCommand` 拡張

```typescript
class StatusCommand {
  constructor(
    fileReader: FileReader,
    private readonly telemetry?: TelemetryStore,
  ) { /* ... */ }

  async getStatusWithAnalytics(planPath: string): Promise<PlanStatusWithAnalytics> {
    const status = await this.getStatus(planPath);
    const analytics = this.telemetry?.computeSnapshot(100);
    return { ...status, analytics };
  }

  formatAsJson(status: PlanStatusWithAnalytics): string {
    return JSON.stringify({
      planPath: status.planPath,
      progress: status.progress,
      tasks: status.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      analytics: status.analytics ?? null,
    }, null, 2);
  }
}
```

CLI レイヤーで `--analytics` と `--json` フラグを解釈し、`getStatusWithAnalytics()` と `formatAsJson()` の組み合わせで出力する。

### 7.4 配線（`JusticePlugin`）

| 呼び出し点 | 記録イベント |
|----------|------------|
| `TaskFeedbackHandler.handlePostToolUse()` | `recordTaskCompleted(taskId, status, errorClass)` |
| `PlanBridge.handlePreToolUse()` (wisdom 注入時) | `recordWisdomInjection(entryIds, taskId)` |
| `WisdomMetrics.onHit` 経由 | `recordWisdomHit(entryId)` |

`WisdomMetrics` から `TelemetryStore` への通知は **observer pattern** で疎結合に保つ。

```typescript
metrics.onHit((id) => telemetry.recordWisdomHit(id));
```

### 7.5 出力サンプル

```json
{
  "planPath": ".justice/plan.md",
  "progress": { "total": 10, "completed": 7, "percentage": 70 },
  "tasks": [{ "id": "task-1", "title": "...", "status": "completed" }],
  "analytics": {
    "windowSize": 100,
    "failureRate": 0.18,
    "wisdomHitRate": 0.62,
    "errorDistribution": {
      "syntax_error": 0.05, "type_error": 0.10, "test_failure": 0.40,
      "design_error": 0.15, "timeout": 0.05, "loop_detected": 0.10,
      "provider_transient": 0.05, "provider_config": 0.0, "unknown": 0.10
    },
    "generatedAt": "2026-04-26T..."
  }
}
```

## 8. Phase 4: Adaptive Retry 詳細

### 8.1 `RetryPolicyCalculator` クラス

```typescript
export class RetryPolicyCalculator {
  private static readonly BASE = 3;
  private static readonly MIN_RETRIES = 1;

  private static readonly CATEGORY_MODIFIERS: Readonly<Record<TaskCategory, number>> = Object.freeze({
    "quick": -1,
    "ultrabrain": +2,
    "deep": 0,
    "visual-engineering": 0,
    "writing": 0,
    "unspecified-low": 0,
    "unspecified-high": 0,
  });

  private static readonly VOLUME_THRESHOLD = 5;
  private static readonly VOLUME_MODIFIER = +1;

  compute(ctx: RetryThresholdContext): RetryThresholdResult {
    const base = RetryPolicyCalculator.BASE;
    const categoryModifier = RetryPolicyCalculator.CATEGORY_MODIFIERS[ctx.category] ?? 0;
    const volumeModifier =
      ctx.stepCount >= RetryPolicyCalculator.VOLUME_THRESHOLD
        ? RetryPolicyCalculator.VOLUME_MODIFIER
        : 0;

    const computed = base + categoryModifier + volumeModifier;
    const maxRetries = Math.max(RetryPolicyCalculator.MIN_RETRIES, computed);
    return { base, categoryModifier, volumeModifier, maxRetries };
  }
}
```

`maxRetries` の最小値は 1 にクランプ。0 にすると escalation 判定が即時発火し、リトライ機構が機能しなくなるため。

### 8.2 計算例

| Category   | stepCount | Base | Cat | Vol | maxRetries |
|------------|-----------|------|-----|-----|------------|
| quick      | 2         | 3    | -1  | 0   | 2          |
| quick      | 5         | 3    | -1  | +1  | 3          |
| deep       | 3         | 3    | 0   | 0   | 3          |
| ultrabrain | 7         | 3    | +2  | +1  | 6          |
| ultrabrain | 1         | 3    | +2  | 0   | 5          |

### 8.3 `LoopDetectionHandler` への統合

```typescript
export class LoopDetectionHandler {
  constructor(
    fileReader: FileReader,
    fileWriter: FileWriter,
    splitter: TaskSplitter,
    private readonly classifier: CategoryClassifier,
    private readonly retryCalculator: RetryPolicyCalculator,
  ) { /* ... */ }

  evaluateEscalation(
    sessionId: string,
    taskId: string,
    primaryAgent: AgentId,
    activeTask?: PlanTask,
  ): EscalationDecision {
    const records = this.trials.get(sessionId)?.get(taskId) ?? [];
    const failures = records.filter((r) => r.result === "failure").length;

    let dynamicMaxRetries = this.maxRetries;
    let thresholdResult: RetryThresholdResult | undefined;
    if (activeTask) {
      const category = this.classifier.classify(activeTask) as TaskCategory;
      thresholdResult = this.retryCalculator.compute({
        category,
        stepCount: activeTask.steps.length,
      });
      dynamicMaxRetries = thresholdResult.maxRetries;
    }

    const historySummary = this.formatTrialHistory(records);

    if (failures >= dynamicMaxRetries) {
      return { escalated: true, targetAgent: ESCALATION_TARGET, failures, maxRetries: dynamicMaxRetries, reason: "max_retries_exceeded", historySummary, thresholdResult };
    }
    return { escalated: false, targetAgent: primaryAgent, failures, maxRetries: dynamicMaxRetries, historySummary, thresholdResult };
  }
}
```

### 8.4 `EscalationDecision` 型の補足

```typescript
export interface EscalationDecision {
  readonly escalated: boolean;
  readonly targetAgent: AgentId;
  readonly failures: number;
  readonly maxRetries: number;
  readonly reason?: EscalationReason;
  readonly historySummary: string;
  readonly thresholdResult?: RetryThresholdResult;   // 追加
}
```

`thresholdResult` を `historySummary` の冒頭に inject すれば、動的閾値の根拠がデバッグ時に一目で読める。

### 8.5 環境変数フォールバック

既存の `MAX_RETRIES_BEFORE_ESCALATION` 環境変数は **`activeTask === undefined` の場合のフォールバック値** として残す。これにより既存の `loop-handler.test.ts` の挙動は無変更で通る。

## 9. テスト戦略

### 9.1 新規テストファイル

```text
tests/core/
├── wisdom-metrics.test.ts                      ← 新規
├── wisdom-archive.test.ts                      ← 新規
├── telemetry-store.test.ts                     ← 新規
├── retry-policy-calculator.test.ts             ← 新規
└── wisdom-persistence-concurrency.test.ts      ← 新規（仕様書3-2 要請）

tests/integration/
└── multi-process-wisdom.test.ts                ← 新規 (Phase 1 統合)
```

### 9.2 既存テスト修正点

| テスト | 修正範囲 |
|--------|---------|
| `tests/core/wisdom-store.test.ts` | `attachMetrics` / `onEvict` の動作確認を追加 |
| `tests/core/tiered-wisdom-store.test.ts` | eviction → archive 連携を追加 |
| `tests/core/wisdom-persistence.test.ts` | `saveAtomic` の挙動は **無変更** で通ることを確認 |
| `tests/core/status-command.test.ts` | `formatAsJson()` の追加検証 |
| `tests/hooks/loop-handler.test.ts` | 動的 `maxRetries` のテストケース追加 |
| `tests/integration/wisdom-flow.test.ts` | **無変更** で通ることを確認（仕様書3-3 要請） |

### 9.3 競合テストの設計

`tests/core/wisdom-persistence-concurrency.test.ts`:

1. **シングルライター成功**: lockMeta 一致、1 回で書き込み成功 → `retries: 0`。
2. **シングル競合・1回リトライで成功**: `MockFileWriter` 共有、1 つ目が write 後 mtime を進めると 2 つ目はリトライで再同期 → `retries: 1`。
3. **3 並行プロセス**: `Promise.all` で同時書き込み → 全件マージされる。
4. **リトライ上限到達**: 常に mtime 不一致を返すモックモード → `wisdom.conflict.json` に退避され `status: "conflict_diverted"` を返す。
5. **`divertToConflictFile` 自身が失敗**: ENOSPC 等のモック → `console.warn` のみで例外伝播せず。

### 9.4 Mock FileSystem 拡張

`tests/helpers/mock-file-system.ts` に下記を追加。

```typescript
interface MockFileSystem extends FileReader, FileWriter {
  stat(path: string): Promise<{ mtimeMs: number; size: number }>;
  advanceMtime(path: string, deltaMs: number): void;
}

function createSharedMockFileSystem(): MockFileSystem;
function createConflictingMockFileSystem(): MockFileSystem;
```

### 9.5 Devcontainer 内テスト実行

```bash
bun install
bun run test
bun run typecheck
bun run lint
```

全てがグリーンになることを各 PR の完了条件とする。

## 10. 段階的 PR 分割計画

| PR | 範囲 | 完了条件 |
|----|------|----------|
| PR1 | 型定義 + `FileReader.stat` + `NodeFileSystem.stat` 実装 | 既存テスト全通過 |
| PR2 | Phase 1 楽観ロック + 競合テスト | concurrency tests + 既存 wisdom テスト通過 |
| PR3 | Phase 2 メトリクス + アーカイブ + Tiered 配線 | 新規 + 既存 wisdom 系テスト通過 |
| PR4 | Phase 3 テレメトリ + `formatAsJson` | 新規 telemetry テスト + status-command テスト通過 |
| PR5 | Phase 4 動的閾値 + LoopHandler 統合 | retry-policy-calculator テスト + 既存 loop-handler テスト通過 |

各 PR は独立してマージ可能。`bun run test && bun run typecheck && bun run lint` のグリーンを完了条件とする。

## 11. 受入基準（Acceptance Criteria）

| ID | 基準 |
|----|------|
| AC-1 | `wisdom.json` への並行書き込みでデータ欠損が発生しない（concurrency test 通過） |
| AC-2 | リトライ上限到達時に `wisdom.conflict.json` に退避され、メイン処理が `exit 0` ではなく **継続** する |
| AC-3 | LRU eviction された `failure_gotcha` / `design_decision` が `wisdom-archive.json` に必ず移される |
| AC-4 | `environment_quirk` は `hitCount >= 3` を満たした場合のみアーカイブされる |
| AC-5 | `justice status --analytics --json` が JSON.parse 可能で `failureRate` / `wisdomHitRate` / `errorDistribution` を含む |
| AC-6 | `LoopDetectionHandler` の `maxRetries` が category と stepCount から動的算出され、`thresholdResult` がデバッグ可能 |
| AC-7 | 既存 `tests/integration/wisdom-flow.test.ts` および `tests/core/wisdom-persistence.test.ts` が無変更で通過する |
| AC-8 | `WisdomEntry` を含む全 type が `readonly` のまま据え置かれている |

## 12. 用語集

| 用語 | 定義 |
|------|------|
| Optimistic Lock | ファイルの `mtime` を比較し、不一致時に再ロード→再試行する非ブロッキング同期手法 |
| Fail-Open | 障害発生時にメイン処理を継続させる方針（cf. Fail-Close） |
| LRU eviction | Least Recently Used 方式で、容量超過時に最古エントリを除外する |
| Wisdom | Justice における学習エントリ（成功パターン / 失敗の落とし穴 / 設計判断 / 環境固有事項） |
| Tier | Wisdom の保存階層（local: project-local、global: `~/.justice`） |
