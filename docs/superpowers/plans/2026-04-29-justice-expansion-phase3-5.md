# Justice Expansion 実装計画 — Phase 3–5

> 本ファイルは `2026-04-29-justice-expansion-phase1-2.md` の続きです。

---

## Phase 3: Wisdom Metrics & Archive

### Task 1: WisdomStore 拡張 (updateMetrics / attachMetrics / onEvict)

**Branch:** `feature/phase3-task1_store-extensions` ← Base から派生 (独立)

**Files:**
- Modify: `src/core/wisdom-store.ts`
- Modify: `tests/core/wisdom-store.test.ts`

- [ ] **Step 1: WisdomStore 拡張のテストを作成**

```typescript
// tests/core/wisdom-store.test.ts に追加
describe("WisdomStore extensions", () => {
  it("updateMetrics replaces entry via copy-on-write", () => {
    const store = new WisdomStore();
    const entry = store.add({ taskId: "t1", category: "success_pattern", content: "test" });
    const updated = store.updateMetrics(entry.id, (e) => ({
      ...e,
      hitCount: (e.hitCount ?? 0) + 1,
      lastHitAt: "2026-04-29T00:00:00Z",
    }));
    expect(updated).toBeDefined();
    expect(updated!.hitCount).toBe(1);
    // Original entry object is not mutated
    expect(entry.hitCount).toBeUndefined();
  });

  it("updateMetrics returns undefined for missing entry", () => {
    const store = new WisdomStore();
    const result = store.updateMetrics("nonexistent", (e) => e);
    expect(result).toBeUndefined();
  });

  it("onEvict callback fires when capacity exceeded", () => {
    const store = new WisdomStore(2);
    const evicted: WisdomEntry[] = [];
    store.onEvict((e) => evicted.push(e));
    store.add({ taskId: "t1", category: "success_pattern", content: "a" });
    store.add({ taskId: "t2", category: "success_pattern", content: "b" });
    store.add({ taskId: "t3", category: "success_pattern", content: "c" });
    expect(evicted).toHaveLength(1);
    expect(evicted[0].content).toBe("a");
  });

  it("attachMetrics stores reference", () => {
    const store = new WisdomStore();
    // Just verify it doesn't throw
    expect(() => store.attachMetrics({} as any)).not.toThrow();
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `bun run test tests/core/wisdom-store.test.ts`
Expected: FAIL — updateMetrics / onEvict が未定義

- [ ] **Step 3: WisdomStore に updateMetrics / attachMetrics / onEvict を実装**

`src/core/wisdom-store.ts` に追加:

```typescript
private metrics?: WisdomMetrics;
private evictionListener?: (evicted: WisdomEntry) => void;

attachMetrics(metrics: WisdomMetrics): void {
  this.metrics = metrics;
}

onEvict(listener: (evicted: WisdomEntry) => void): void {
  this.evictionListener = listener;
}

updateMetrics(entryId: string, mutator: (entry: WisdomEntry) => WisdomEntry): WisdomEntry | undefined {
  const idx = this.entries.findIndex((e) => e.id === entryId);
  if (idx < 0) return undefined;
  const copy = { ...this.entries[idx] };
  const updated = mutator(copy);
  this.entries[idx] = updated;
  return updated;
}
```

`add()` メソッドの eviction 部分を修正して `evictionListener` を呼ぶ:

```typescript
if (this.entries.length > this._maxEntries) {
  const evicted = this.entries.shift()!;
  this.evictionListener?.(evicted);
}
```

- [ ] **Step 4: 全テスト通過確認 (Devcontainer)**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: ALL PASS

- [ ] **Step 5: コミット & Draft PR**

```bash
git commit -m "feat(wisdom-store): add updateMetrics/attachMetrics/onEvict"
git push -u origin feature/phase3-task1_store-extensions
gh pr create --base feature/phase3_wisdom-metrics-archive__base --title "feat(wisdom-store): メトリクス拡張" --draft
```

### Task 2: WisdomMetrics クラス

**Branch:** `feature/phase3-task2_wisdom-metrics` ← Task 1 から派生
**依存理由:** `WisdomStore.updateMetrics()` を使用

**Files:**
- Create: `src/core/wisdom-metrics.ts`
- Create: `tests/core/wisdom-metrics.test.ts`

- [ ] **Step 1: WisdomMetrics のテストを作成**

```typescript
// tests/core/wisdom-metrics.test.ts
import { describe, it, expect, vi } from "vitest";
import { WisdomMetrics } from "../../src/core/wisdom-metrics";
import { WisdomStore } from "../../src/core/wisdom-store";

describe("WisdomMetrics", () => {
  it("recordHit increments hitCount via copy-on-write", () => {
    const store = new WisdomStore();
    const entry = store.add({ taskId: "t1", category: "success_pattern", content: "x" });
    const metrics = new WisdomMetrics();
    const updated = metrics.recordHit(store, entry.id);
    expect(updated).toBeDefined();
    expect(updated!.hitCount).toBe(1);
    expect(updated!.firstSeenAt).toBeDefined();
  });

  it("recordHit sets firstSeenAt only on first call", () => {
    const store = new WisdomStore();
    const entry = store.add({ taskId: "t1", category: "success_pattern", content: "x" });
    const metrics = new WisdomMetrics();
    const first = metrics.recordHit(store, entry.id, new Date("2026-01-01"));
    const second = metrics.recordHit(store, entry.id, new Date("2026-02-01"));
    expect(second!.firstSeenAt).toBe(first!.firstSeenAt);
    expect(second!.hitCount).toBe(2);
  });

  it("recordHit returns undefined for missing entry", () => {
    const store = new WisdomStore();
    const metrics = new WisdomMetrics();
    expect(metrics.recordHit(store, "missing")).toBeUndefined();
  });

  it("onHit listener is called", () => {
    const store = new WisdomStore();
    const entry = store.add({ taskId: "t1", category: "success_pattern", content: "x" });
    const metrics = new WisdomMetrics();
    const listener = vi.fn();
    metrics.onHit(listener);
    metrics.recordHit(store, entry.id);
    expect(listener).toHaveBeenCalledWith(entry.id);
  });
});
```

- [ ] **Step 2: テスト失敗確認 → Step 3: 実装**

設計書 §6.1 に基づき `src/core/wisdom-metrics.ts` を実装。

- [ ] **Step 4: 全テスト通過確認 (Devcontainer) & コミット & Draft PR**

```bash
bun run test && bun run typecheck && bun run lint
git commit -m "feat(core): implement WisdomMetrics stateless service"
git push -u origin feature/phase3-task2_wisdom-metrics
gh pr create --base feature/phase3_wisdom-metrics-archive__base --title "feat(core): WisdomMetrics" --draft
```

### Task 3: WisdomArchive クラス

**Branch:** `feature/phase3-task3_wisdom-archive` ← Base から派生 (独立)
**独立理由:** `AtomicPersistence` は master にマージ済み。WisdomStore 変更に依存しない。

**Files:**
- Create: `src/core/wisdom-archive.ts`
- Create: `tests/core/wisdom-archive.test.ts`
- Create: `tests/core/wisdom-archive-concurrency.test.ts`

- [ ] **Step 1: WisdomArchive のテストを作成**

```typescript
// tests/core/wisdom-archive.test.ts
import { describe, it, expect } from "vitest";
import { WisdomArchive } from "../../src/core/wisdom-archive";
import type { WisdomEntry } from "../../src/core/types";

describe("WisdomArchive", () => {
  describe("shouldArchive", () => {
    it("archives failure_gotcha unconditionally", () => {
      const archive = new WisdomArchive(/* mock AtomicPersistence */);
      const entry: WisdomEntry = { id: "w1", taskId: "t1", category: "failure_gotcha", content: "x", timestamp: "2026-01-01T00:00:00Z" };
      const result = archive.shouldArchive(entry);
      expect(result.archive).toBe(true);
      expect(result.reason).toBe("high_priority_category");
    });

    it("archives design_decision unconditionally", () => {
      const archive = new WisdomArchive(/* mock */);
      const entry: WisdomEntry = { id: "w2", taskId: "t1", category: "design_decision", content: "x", timestamp: "2026-01-01T00:00:00Z" };
      expect(archive.shouldArchive(entry).archive).toBe(true);
    });

    it("archives environment_quirk only if hitCount >= 3", () => {
      const archive = new WisdomArchive(/* mock */);
      const low: WisdomEntry = { id: "w3", taskId: "t1", category: "environment_quirk", content: "x", timestamp: "2026-01-01T00:00:00Z", hitCount: 2 };
      const high: WisdomEntry = { id: "w4", taskId: "t1", category: "environment_quirk", content: "x", timestamp: "2026-01-01T00:00:00Z", hitCount: 3 };
      expect(archive.shouldArchive(low).archive).toBe(false);
      expect(archive.shouldArchive(high).archive).toBe(true);
      expect(archive.shouldArchive(high).reason).toBe("hit_count_threshold");
    });

    it("does not archive success_pattern", () => {
      const archive = new WisdomArchive(/* mock */);
      const entry: WisdomEntry = { id: "w5", taskId: "t1", category: "success_pattern", content: "x", timestamp: "2026-01-01T00:00:00Z", hitCount: 100 };
      expect(archive.shouldArchive(entry).archive).toBe(false);
    });
  });
});
```

- [ ] **Step 2: テスト失敗確認 → Step 3: 実装**

設計書 §6.3 に基づき実装。`AtomicPersistence<readonly ArchivedWisdom[]>` に永続化委譲。

- [ ] **Step 4: 並行テスト追加** (`wisdom-archive-concurrency.test.ts`)

並行 `append` が `(entry.id, archivedAt)` で重複排除されつつ全件保存されることを検証。

- [ ] **Step 5: 全テスト通過確認 (Devcontainer) & コミット & Draft PR**

```bash
bun run test && bun run typecheck && bun run lint
git commit -m "feat(core): implement WisdomArchive with AtomicPersistence"
git push -u origin feature/phase3-task3_wisdom-archive
gh pr create --base feature/phase3_wisdom-metrics-archive__base --title "feat(core): WisdomArchive" --draft
```

### Task 4: TieredWisdomStore 統合 & JusticePlugin wiring

**Branch:** `feature/phase3-task4_tiered-integration` ← Base から派生 (Task 1-3 マージ後)
**独立理由:** Phase Base に Task 1-3 がマージ済みの状態で Base から派生

**Files:**
- Modify: `src/core/tiered-wisdom-store.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `tests/core/tiered-wisdom-store.test.ts`

- [ ] **Step 1: TieredWisdomStore eviction 連携テストを追加**

```typescript
// tests/core/tiered-wisdom-store.test.ts に追加
describe("eviction → archive integration", () => {
  it("evicted failure_gotcha is archived", async () => {
    const store = new WisdomStore(2);
    const mockAppend = vi.fn().mockResolvedValue(undefined);
    const archive = {
      shouldArchive: (e: WisdomEntry) => ({ archive: e.category === "failure_gotcha", reason: "high_priority_category" }),
      append: mockAppend,
    } as unknown as WisdomArchive;

    store.onEvict((evicted) => {
      if (archive.shouldArchive(evicted).archive) {
        void archive.append(evicted).catch(() => {});
      }
    });

    store.add({ taskId: "t1", category: "failure_gotcha", content: "a" });
    store.add({ taskId: "t2", category: "success_pattern", content: "b" });
    store.add({ taskId: "t3", category: "success_pattern", content: "c" });

    expect(mockAppend).toHaveBeenCalledTimes(1);
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({ category: "failure_gotcha" }));
  });

  it("evicted success_pattern is not archived", async () => {
    const store = new WisdomStore(2);
    const mockAppend = vi.fn().mockResolvedValue(undefined);
    const archive = {
      shouldArchive: () => ({ archive: false, reason: "none" }),
      append: mockAppend,
    } as unknown as WisdomArchive;

    store.onEvict((evicted) => {
      if (archive.shouldArchive(evicted).archive) {
        void archive.append(evicted).catch(() => {});
      }
    });

    store.add({ taskId: "t1", category: "success_pattern", content: "a" });
    store.add({ taskId: "t2", category: "success_pattern", content: "b" });
    store.add({ taskId: "t3", category: "success_pattern", content: "c" });

    expect(mockAppend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: TieredWisdomStore を修正**

設計書 §6.4 に基づき、コンストラクタで:
- `local.attachMetrics(metrics)` / `global.attachMetrics(metrics)`
- `local.onEvict(...)` / `global.onEvict(...)` → `handleEviction()` → `archive.shouldArchive()` → `void archive.append(...).catch(err => console.warn("archive.append failed", err))`

- [ ] **Step 3: JusticePlugin の wiring 更新**

`src/core/justice-plugin.ts` で `WisdomMetrics` / `WisdomArchive` / `AtomicPersistence` インスタンスを生成し `TieredWisdomStore` に注入。

- [ ] **Step 4: 全テスト通過確認 (Devcontainer) & コミット & Draft PR**

```bash
bun run test && bun run typecheck && bun run lint
git commit -m "feat(tiered): integrate WisdomMetrics + WisdomArchive into TieredWisdomStore"
git push -u origin feature/phase3-task4_tiered-integration
gh pr create --base feature/phase3_wisdom-metrics-archive__base --title "feat(tiered): メトリクス・アーカイブ統合" --draft
```

### Phase 3 完了

- [ ] **全 Task マージ後、master への Draft PR 作成**

```bash
gh pr create --base master --head feature/phase3_wisdom-metrics-archive__base --title "feat: Phase 3 — Wisdom Metrics & Archive" --draft
```

---

## Phase 4: Telemetry

### Task 1: TelemetryStore クラス

**Branch:** `feature/phase4-task1_telemetry-store` ← Base から派生 (独立)

**Files:**
- Create: `src/core/telemetry-store.ts`
- Create: `tests/core/telemetry-store.test.ts`

- [ ] **Step 1: TelemetryStore のテストを作成**

```typescript
// tests/core/telemetry-store.test.ts
import { describe, it, expect } from "vitest";
import { TelemetryStore } from "../../src/core/telemetry-store";
import { createMockFileSystem } from "../helpers/mock-file-system";

describe("TelemetryStore", () => {
  it("records task completion events", () => {
    const fs = createMockFileSystem();
    const ts = new TelemetryStore(fs, fs);
    ts.recordTaskCompleted("t1", "success");
    ts.recordTaskCompleted("t2", "failure", "syntax_error");
    const snap = ts.computeSnapshot(10);
    expect(snap.failureRate).toBe(0.5);
  });

  it("computes wisdomHitRate within taskId scope", () => {
    const fs = createMockFileSystem();
    const ts = new TelemetryStore(fs, fs);
    ts.recordWisdomInjection(["w1", "w2"], "t1");
    ts.recordWisdomHit("w1", "t1");
    ts.recordTaskCompleted("t1", "success");
    const snap = ts.computeSnapshot(10);
    expect(snap.wisdomHitRate).toBeGreaterThan(0);
  });

  it("computes errorDistribution across all ErrorClass keys", () => {
    const fs = createMockFileSystem();
    const ts = new TelemetryStore(fs, fs);
    ts.recordTaskCompleted("t1", "failure", "syntax_error");
    ts.recordTaskCompleted("t2", "failure", "type_error");
    ts.recordTaskCompleted("t3", "success");
    const snap = ts.computeSnapshot(10);
    expect(snap.errorDistribution.syntax_error).toBeCloseTo(1/3, 2);
  });

  it("trims events when exceeding maxEvents", () => {
    const fs = createMockFileSystem();
    const ts = new TelemetryStore(fs, fs, ".justice/telemetry.json", { maxEvents: 5 });
    for (let i = 0; i < 10; i++) {
      ts.recordTaskCompleted(`t${i}`, "success");
    }
    const snap = ts.computeSnapshot(100);
    expect(snap.windowSize).toBeLessThanOrEqual(5);
  });

  it("save and load round-trip", async () => {
    const fs = createMockFileSystem();
    const ts = new TelemetryStore(fs, fs);
    ts.recordTaskCompleted("t1", "success");
    await ts.save();
    const ts2 = new TelemetryStore(fs, fs);
    await ts2.load();
    const snap = ts2.computeSnapshot(10);
    expect(snap.failureRate).toBe(0);
  });
});
```

- [ ] **Step 2: テスト失敗確認 → Step 3: 実装**

設計書 §7.1–7.2 に基づき実装。`save()` は `temp + rename` atomic write (best-effort、`AtomicPersistence` の楽観ロックは不使用)。

- [ ] **Step 4: 全テスト通過確認 (Devcontainer) & コミット & Draft PR**

```bash
bun run test && bun run typecheck && bun run lint
git commit -m "feat(core): implement TelemetryStore with event recording and snapshot computation"
git push -u origin feature/phase4-task1_telemetry-store
gh pr create --base feature/phase4_telemetry__base --title "feat(core): TelemetryStore" --draft
```

### Task 2: StatusCommand 拡張 & JusticePlugin wiring

**Branch:** `feature/phase4-task2_status-command` ← Task 1 から派生
**依存理由:** `TelemetryStore` を依存注入

**Files:**
- Modify: `src/core/status-command.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `tests/core/status-command.test.ts`

- [ ] **Step 1: StatusCommand 拡張テストを作成**

```typescript
// tests/core/status-command.test.ts に追加
describe("StatusCommand analytics", () => {
  it("getStatusWithAnalytics includes TelemetrySnapshot", async () => {
    const fs = createMockFileSystem();
    const telemetry = new TelemetryStore(fs, fs);
    telemetry.recordTaskCompleted("t1", "success");
    const cmd = new StatusCommand(fs, telemetry);
    const status = await cmd.getStatusWithAnalytics("plan.md");
    expect(status.analytics).toBeDefined();
    expect(status.analytics!.failureRate).toBe(0);
  });

  it("formatAsJson returns valid JSON with analytics", async () => {
    const fs = createMockFileSystem();
    const telemetry = new TelemetryStore(fs, fs);
    const cmd = new StatusCommand(fs, telemetry);
    const status = await cmd.getStatusWithAnalytics("plan.md");
    const json = cmd.formatAsJson(status);
    const parsed = JSON.parse(json);
    expect(parsed.analytics).toBeDefined();
    expect(parsed.planPath).toBe("plan.md");
  });

  it("formatAsJson works without telemetry (analytics=null)", async () => {
    const fs = createMockFileSystem();
    const cmd = new StatusCommand(fs);
    const status = await cmd.getStatusWithAnalytics("plan.md");
    const json = cmd.formatAsJson(status);
    expect(JSON.parse(json).analytics).toBeNull();
  });
});
```

- [ ] **Step 2: StatusCommand に getStatusWithAnalytics / formatAsJson を追加**

設計書 §7.3 に基づき実装。コンストラクタに optional `telemetry?: TelemetryStore` を追加。

- [ ] **Step 3: JusticePlugin wiring**

設計書 §7.4 に基づき `TelemetryStore` を `TaskFeedbackHandler` / `PlanBridge` に注入。`WisdomMetrics.onHit` → `telemetry.recordWisdomHit` の observer パターンを配線。

- [ ] **Step 4: 全テスト通過確認 (Devcontainer) & コミット & Draft PR**

```bash
bun run test && bun run typecheck && bun run lint
git commit -m "feat(status): add getStatusWithAnalytics/formatAsJson with TelemetryStore wiring"
git push -u origin feature/phase4-task2_status-command
gh pr create --base feature/phase4_telemetry__base --title "feat(status): StatusCommand + テレメトリ統合" --draft
```

### Phase 4 完了

- [ ] **全 Task マージ後、master への Draft PR 作成**

```bash
gh pr create --base master --head feature/phase4_telemetry__base --title "feat: Phase 4 — Telemetry" --draft
```

---

## Phase 5: Adaptive Retry

### Task 1: RetryPolicyCalculator クラス

**Branch:** `feature/phase5-task1_retry-calculator` ← Base から派生 (独立)

**Files:**
- Create: `src/core/retry-policy-calculator.ts`
- Create: `tests/core/retry-policy-calculator.test.ts`

- [ ] **Step 1: 計算テーブルのテストを作成**

```typescript
// tests/core/retry-policy-calculator.test.ts
import { describe, it, expect } from "vitest";
import { RetryPolicyCalculator } from "../../src/core/retry-policy-calculator";

describe("RetryPolicyCalculator", () => {
  const calc = new RetryPolicyCalculator();

  it.each([
    { category: "quick", stepCount: 2, expected: 2 },
    { category: "quick", stepCount: 5, expected: 3 },
    { category: "deep", stepCount: 3, expected: 3 },
    { category: "ultrabrain", stepCount: 7, expected: 6 },
    { category: "ultrabrain", stepCount: 1, expected: 5 },
    { category: "writing", stepCount: 3, expected: 3 },
    { category: "visual-engineering", stepCount: 10, expected: 4 },
  ] as const)("$category (steps=$stepCount) → maxRetries=$expected", ({ category, stepCount, expected }) => {
    const result = calc.compute({ category, stepCount });
    expect(result.maxRetries).toBe(expected);
    expect(result.base).toBe(3);
  });

  it("maxRetries is clamped to MIN_RETRIES=1", () => {
    // No current category goes below 1, but verify the clamp exists
    const result = calc.compute({ category: "quick", stepCount: 1 });
    expect(result.maxRetries).toBeGreaterThanOrEqual(1);
  });

  it("returns structured RetryThresholdResult", () => {
    const result = calc.compute({ category: "ultrabrain", stepCount: 7 });
    expect(result).toEqual({
      base: 3,
      categoryModifier: 2,
      volumeModifier: 1,
      maxRetries: 6,
    });
  });
});
```

- [ ] **Step 2: テスト失敗確認 → Step 3: 実装**

設計書 §8.1 のコードをそのまま実装。

- [ ] **Step 4: 全テスト通過確認 (Devcontainer) & コミット & Draft PR**

```bash
bun run test && bun run typecheck && bun run lint
git commit -m "feat(core): implement RetryPolicyCalculator with category/volume modifiers"
git push -u origin feature/phase5-task1_retry-calculator
gh pr create --base feature/phase5_adaptive-retry__base --title "feat(core): RetryPolicyCalculator" --draft
```

### Task 2: LoopDetectionHandler 統合

**Branch:** `feature/phase5-task2_loop-integration` ← Task 1 から派生
**依存理由:** `RetryPolicyCalculator` を注入

**Files:**
- Modify: `src/hooks/loop-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Modify: `tests/hooks/loop-handler.test.ts`

- [ ] **Step 1: 動的 maxRetries のテストを追加**

```typescript
// tests/hooks/loop-handler.test.ts に追加
describe("dynamic maxRetries", () => {
  it("uses RetryPolicyCalculator when activeTask provided", () => {
    const handler = new LoopDetectionHandler(
      mockReader, mockWriter, new TaskSplitter(),
      new CategoryClassifier(), new RetryPolicyCalculator(),
    );
    handler.setActivePlan("s1", "plan.md", "task-1", "hephaestus");
    handler.recordTrial("s1", "task-1", { agent: "hephaestus", result: "failure" });

    const activeTask: PlanTask = {
      id: "task-1", title: "complex task", status: "in_progress",
      steps: Array.from({ length: 7 }, (_, i) => ({
        id: `step-${i}`, description: `step ${i}`, checked: false, lineNumber: i,
      })),
    };

    const decision = handler.evaluateEscalation("s1", "task-1", "hephaestus", activeTask);
    expect(decision.thresholdResult).toBeDefined();
    expect(decision.maxRetries).toBeGreaterThan(3); // category modifier applied
  });

  it("falls back to env var when activeTask is undefined", () => {
    const handler = new LoopDetectionHandler(
      mockReader, mockWriter, new TaskSplitter(),
      new CategoryClassifier(), new RetryPolicyCalculator(),
    );
    const decision = handler.evaluateEscalation("s1", "task-1", "hephaestus");
    expect(decision.maxRetries).toBe(3); // default
    expect(decision.thresholdResult).toBeUndefined();
  });
});
```

- [ ] **Step 2: LoopDetectionHandler のコンストラクタと evaluateEscalation を修正**

設計書 §8.3 に基づき:
- コンストラクタに `CategoryClassifier` と `RetryPolicyCalculator` を追加
- `evaluateEscalation` に `activeTask?: PlanTask` パラメータを追加
- `activeTask` がある場合は `classifier.classify()` → `calculator.compute()` で動的算出
- `EscalationDecision` に `thresholdResult?: RetryThresholdResult` を追加

- [ ] **Step 3: JusticePlugin wiring 更新**

```typescript
// justice-plugin.ts
this.loopHandler = new LoopDetectionHandler(
  fileReader, fileWriter, new TaskSplitter(),
  new CategoryClassifier(), new RetryPolicyCalculator(),
);
```

- [ ] **Step 4: 全テスト通過確認 (Devcontainer)**

```bash
bun run test && bun run typecheck && bun run lint
```

Expected: ALL PASS (既存 loop-handler テストも無変更で通過 — activeTask 未指定時は従来動作)

- [ ] **Step 5: コミット & Draft PR**

```bash
git commit -m "feat(loop-handler): integrate RetryPolicyCalculator for dynamic maxRetries"
git push -u origin feature/phase5-task2_loop-integration
gh pr create --base feature/phase5_adaptive-retry__base --title "feat(loop-handler): 動的リトライ閾値" --draft
```

### Phase 5 完了

- [ ] **全 Task マージ後、master への Draft PR 作成**

```bash
gh pr create --base master --head feature/phase5_adaptive-retry__base --title "feat: Phase 5 — Adaptive Retry" --draft
```

---

## Acceptance Criteria Traceability

| AC | Phase | Verification |
|----|-------|-------------|
| AC-1 | 2 | `atomic-persistence.test.ts` scenarios 1-11 + `wisdom-persistence-concurrency.test.ts` |
| AC-2 | 2 | `atomic-persistence.test.ts` scenarios 5, 8, 9 |
| AC-3 | 3 | `tiered-wisdom-store.test.ts` eviction integration |
| AC-4 | 3 | `wisdom-archive.test.ts` environment_quirk threshold |
| AC-5 | 4 | `status-command.test.ts` formatAsJson |
| AC-6 | 5 | `retry-policy-calculator.test.ts` + `loop-handler.test.ts` dynamic |
| AC-7 | 1-2 | 既存テスト無変更通過 (各 Phase の CI で確認) |
| AC-8 | 3 | `wisdom-metrics.test.ts` copy-on-write 検証 |
| AC-9 | 3 | ファイル構成確認 (`wisdom-metrics.json` が存在しないこと) |
