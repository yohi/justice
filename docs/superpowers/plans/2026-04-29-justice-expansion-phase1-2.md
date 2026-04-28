# Justice Expansion 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Justice の Wisdom 永続化に楽観ロックを導入し、メトリクス・アーカイブ・テレメトリ・動的リトライ閾値を段階的に追加する。

**Architecture:** 汎用 `AtomicPersistence<T>` で version ベース楽観ロック + `fs.link()` atomic claim を実現。メトリクスは `WisdomEntry` に SSoT 統合。テレメトリは project-local イベントログ。動的リトライは `RetryPolicyCalculator` で算出。

**Tech Stack:** TypeScript, Bun, Vitest, Node.js `fs/promises`

**Design Spec:** `docs/superpowers/specs/2026-04-26-justice-expansion-design.md`

---

## Infrastructure

CI/CD (`.github/workflows/ci.yml`: master trigger, `ubuntu-slim`) と Devcontainer は既存。Phase 0 不要。

## 全 Task 共通: 検証手順

**Devcontainer 内**で以下を実行し全てグリーンであること:

```bash
bun run test && bun run typecheck && bun run lint
```

## Git Branch Strategy

```text
master
├── feature/phase1_type-foundation__base
│   ├── feature/phase1-task1_type-definitions    ← Base
│   └── feature/phase1-task2_mock-helpers         ← Task1
├── feature/phase2_atomic-persistence__base       (Phase1 マージ後)
│   ├── feature/phase2-task1_atomic-core          ← Base
│   ├── feature/phase2-task2_wisdom-wrapper       ← Task1
│   └── feature/phase2-task3_integration-test     ← Task2
├── feature/phase3_wisdom-metrics-archive__base   (Phase2 マージ後)
│   ├── feature/phase3-task1_store-extensions     ← Base
│   ├── feature/phase3-task2_wisdom-metrics       ← Task1
│   ├── feature/phase3-task3_wisdom-archive       ← Base (独立)
│   └── feature/phase3-task4_tiered-integration   ← Base (Task1-3 マージ後)
├── feature/phase4_telemetry__base                (Phase3 マージ後)
│   ├── feature/phase4-task1_telemetry-store      ← Base
│   └── feature/phase4-task2_status-command       ← Task1
└── feature/phase5_adaptive-retry__base           (Phase4 マージ後)
    ├── feature/phase5-task1_retry-calculator     ← Base
    └── feature/phase5-task2_loop-integration     ← Task1
```

---

## Phase 1: Type Foundation

### Task 1: 型定義の追加

**Branch:** `feature/phase1-task1_type-definitions` ← Base から派生 (独立)

**Files:**
- Modify: `src/core/types.ts`
- Modify: `tests/core/types.test.ts`

- [ ] **Step 1: 新型定義のコンパイルテストを追加**

`tests/core/types.test.ts` に追加:

```typescript
import type {
  VersionedEnvelope, LockMetadata, ConflictRecord, SaveResult,
  RetryThresholdResult, WisdomEntry,
} from "../../src/core/types";

describe("Expansion type definitions", () => {
  it("VersionedEnvelope wraps data with version", () => {
    const e: VersionedEnvelope<string> = { version: 1, data: "test" };
    expect(e.version).toBe(1);
  });

  it("LockMetadata captures version and path", () => {
    const m: LockMetadata = { version: 3, path: "w.json", snapshotAt: Date.now() };
    expect(m.version).toBe(3);
  });

  it("ConflictRecord captures reason", () => {
    const r: ConflictRecord = { entries: [], attemptedAt: new Date().toISOString(), reason: "version_mismatch", retryCount: 2 };
    expect(r.reason).toBe("version_mismatch");
  });

  it("SaveResult has status", () => {
    const s: SaveResult = { status: "saved", retries: 0 };
    expect(s.status).toBe("saved");
  });

  it("WisdomEntry accepts optional metrics fields", () => {
    const w: WisdomEntry = { id: "w1", taskId: "t1", category: "success_pattern", content: "x", timestamp: "2026-01-01T00:00:00Z", hitCount: 5, lastHitAt: "2026-01-02T00:00:00Z", firstSeenAt: "2026-01-01T00:00:00Z" };
    expect(w.hitCount).toBe(5);
  });

  it("WisdomEntry works without optional metrics (backward compat)", () => {
    const w: WisdomEntry = { id: "w2", taskId: "t1", category: "failure_gotcha", content: "y", timestamp: "2026-01-01T00:00:00Z" };
    expect(w.hitCount).toBeUndefined();
  });

  it("RetryThresholdResult has maxRetries", () => {
    const r: RetryThresholdResult = { base: 3, categoryModifier: -1, volumeModifier: 0, maxRetries: 2 };
    expect(r.maxRetries).toBe(2);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `bun run test tests/core/types.test.ts`
Expected: FAIL — 新型が未定義

- [ ] **Step 3: types.ts に全型定義を追加**

`src/core/types.ts` 末尾に設計書 §4.1–4.4 の型を追加。`WisdomEntry` に `hitCount?` / `lastHitAt?` / `firstSeenAt?` を optional で追加。コード全文は設計書 §4 を参照。

- [ ] **Step 4: 全テスト通過確認 (Devcontainer)**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: ALL PASS

- [ ] **Step 5: コミット & Draft PR**

```bash
git commit -m "feat(types): add type definitions for justice expansion phases 1-4"
git push -u origin feature/phase1-task1_type-definitions
gh pr create --base feature/phase1_type-foundation__base --title "feat(types): 型定義追加" --draft
```

### Task 2: Mock FileSystem ヘルパー拡張

**Branch:** `feature/phase1-task2_mock-helpers` ← Task 1 から派生
**依存理由:** `VersionedEnvelope` 型を使用

**Files:**
- Modify: `tests/helpers/mock-file-system.ts`
- Create: `tests/helpers/mock-file-system.test.ts`

- [ ] **Step 1: MockFileSystem 拡張のテストを追加**

```typescript
// tests/helpers/mock-file-system.test.ts
import { describe, it, expect } from "vitest";
import { createMockFileSystem } from "./mock-file-system";

describe("MockFileSystem extensions", () => {
  it("setRawContent updates file directly", async () => {
    const fs = createMockFileSystem();
    await fs.writeFile("test.json", '{"old":true}');
    fs.setRawContent("test.json", '{"new":true}');
    const content = await fs.readFile("test.json");
    expect(JSON.parse(content).new).toBe(true);
  });

  it("link fails with EEXIST if target exists", async () => {
    const fs = createMockFileSystem();
    await fs.writeFile("src.txt", "data");
    await fs.writeFile("dst.txt", "existing");
    await expect(fs.link("src.txt", "dst.txt")).rejects.toThrow("EEXIST");
  });

  it("link succeeds if target absent", async () => {
    const fs = createMockFileSystem();
    await fs.writeFile("src.txt", "data");
    await fs.link("src.txt", "new.txt");
    expect(await fs.readFile("new.txt")).toBe("data");
  });

  it("stat returns mtimeMs", async () => {
    const fs = createMockFileSystem();
    await fs.writeFile("f.txt", "data");
    const s = await fs.stat("f.txt");
    expect(s.mtimeMs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `bun run test tests/helpers/mock-file-system.test.ts`
Expected: FAIL

- [ ] **Step 3: MockFileSystem に link/stat/setRawContent/unlink を実装**

内部 `Map<string, { content: string; mtimeMs: number }>` に基づき、`link()` はターゲット既存時 EEXIST throw、`stat()` は mtimeMs 返却、`unlink()` はエントリ削除（不在時は無視）、`setRawContent()` は直接書き換え。

- [ ] **Step 4: 全テスト通過確認 (Devcontainer)**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: ALL PASS

- [ ] **Step 5: コミット & Draft PR**

```bash
git commit -m "test(helpers): extend MockFileSystem with link/stat/setRawContent"
git push -u origin feature/phase1-task2_mock-helpers
gh pr create --base feature/phase1_type-foundation__base --title "test(helpers): MockFileSystem 拡張" --draft
```

### Phase 1 完了

- [ ] **全 Task マージ後、master への Draft PR 作成**

```bash
gh pr create --base master --head feature/phase1_type-foundation__base --title "feat: Phase 1 — Type Foundation" --draft
```

---

## Phase 2: Atomic Persistence (楽観ロック)

### Task 1: AtomicPersistence\<T\> コア実装

**Branch:** `feature/phase2-task1_atomic-core` ← Base から派生 (独立)

**Files:**
- Create: `src/core/atomic-persistence.ts`
- Create: `tests/core/atomic-persistence.test.ts`

- [ ] **Step 1: AtomicPersistence の基本テスト (シングルライター成功) を作成**

```typescript
// tests/core/atomic-persistence.test.ts
import { describe, it, expect, vi } from "vitest";
import { AtomicPersistence } from "../../src/core/atomic-persistence";
import { createMockFileSystem } from "../helpers/mock-file-system";

function createStringPersistence(fs: ReturnType<typeof createMockFileSystem>, path = "test.json") {
  return new AtomicPersistence(fs, fs, fs, {
    filePath: path,
    serialize: (d: string) => d,
    deserialize: (r: string) => r,
    merge: (mine: string, theirs: string) => `${theirs}+${mine}`,
    conflictPath: `${path}.conflict.json`,
    emptyValue: () => "",
  });
}

describe("AtomicPersistence", () => {
  it("single writer succeeds with retries=0", async () => {
    const fs = createMockFileSystem();
    const ap = createStringPersistence(fs);
    const result = await ap.saveAtomicWithLock("hello");
    expect(result.status).toBe("saved");
    expect(result.retries).toBe(0);
  });

  it("loads empty value when file missing", async () => {
    const fs = createMockFileSystem();
    const ap = createStringPersistence(fs);
    const { data, lockMeta } = await ap.loadWithLock();
    expect(data).toBe("");
    expect(lockMeta.version).toBe(0);
  });

  it("reads legacy format as version=0", async () => {
    const fs = createMockFileSystem();
    await fs.writeFile("test.json", '"legacy-data"');
    const ap = createStringPersistence(fs);
    const { data, lockMeta } = await ap.loadWithLock();
    expect(lockMeta.version).toBe(0);
  });

  it("version increments on each save", async () => {
    const fs = createMockFileSystem();
    const ap = createStringPersistence(fs);
    await ap.saveAtomicWithLock("v1");
    const { lockMeta } = await ap.loadWithLock();
    expect(lockMeta.version).toBe(1);
    await ap.saveAtomicWithLock("v2");
    const { lockMeta: m2 } = await ap.loadWithLock();
    expect(m2.version).toBe(2);
  });

  it("diverts to conflict file after max retries", async () => {
    const fs = createMockFileSystem();
    const ap = createStringPersistence(fs);
    // Simulate external version advancing on every read (always stale)
    let externalVersion = 1;
    const origReadFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation(async (path: string) => {
      const raw = await origReadFile(path);
      // Inject ever-increasing version so claim always fails
      const envelope = JSON.parse(raw || '{"version":0,"data":""}');
      envelope.version = ++externalVersion;
      return JSON.stringify(envelope);
    });

    await ap.saveAtomicWithLock("initial");
    const result = await ap.saveAtomicWithLock("will-conflict");
    expect(result.status).toBe("conflict_diverted");
    // Conflict file should exist
    const conflictContent = await fs.readFile("test.json.conflict.json");
    expect(conflictContent).toBeDefined();
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `bun run test tests/core/atomic-persistence.test.ts`
Expected: FAIL — AtomicPersistence が未定義

- [ ] **Step 3: AtomicPersistence\<T\> を実装**

`src/core/atomic-persistence.ts` に設計書 §5.2 / §5.6 に基づき実装。主要ロジック:
- `loadWithLock()`: ファイル読込 → envelope 判定 (version/data 形式 or legacy) → `LockMetadata` 返却
- `saveAtomicWithLock()`: retry loop (max 3) → tmp 書込 → `fs.link()` で claim → version recheck → `fs.rename()` で publish
- Stale-claim 回復: claim の mtime が 10s 超なら unlink
- Fail-open 退避: `divertToConflictFile()`
- `link` / `stat` / `unlink` は注入された `FsOps` インターフェース経由で使用（テスタビリティ確保）

```typescript
import { randomUUID } from "node:crypto";
import type { FileReader, FileWriter, LockMetadata, SaveResult, VersionedEnvelope, ConflictFileSchema } from "./types";

/** Low-level FS operations required by AtomicPersistence (link/stat/unlink). */
export interface FsOps {
  readonly link: (existingPath: string, newPath: string) => Promise<void>;
  readonly stat: (path: string) => Promise<{ mtimeMs: number }>;
  readonly unlink: (path: string) => Promise<void>;
}

export interface AtomicPersistenceConfig<T> {
  readonly filePath: string;
  readonly serialize: (data: T) => string;
  readonly deserialize: (raw: string) => T;
  readonly merge: (mine: T, theirs: T) => T;
  readonly conflictPath: string;
  readonly emptyValue: () => T;
}

const MAX_RETRIES = 3;
const STALE_CLAIM_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 100;
const BACKOFF_JITTER_MS = 50;

export class AtomicPersistence<T> {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly fsOps: FsOps,
    private readonly config: AtomicPersistenceConfig<T>,
  ) {}

  async loadWithLock(): Promise<{ data: T; lockMeta: LockMetadata }> {
    // Implementation per design spec §5.2
  }

  async saveAtomicWithLock(data: T, initialLockMeta?: LockMetadata): Promise<SaveResult> {
    // Implementation per design spec §5.2 Steps 1-3
    // Use this.fsOps.link() / this.fsOps.stat() / this.fsOps.unlink()
  }
}
```

> **Note:** `NodeFileSystem` は `FsOps` を実装し、`node:fs/promises` の `link`/`stat`/`unlink` を委譲する。テスト時は `createMockFileSystem()` が `FsOps` を実装済み（Phase 1 Task 2）。

完全な実装コードは設計書 §5.2 のフローに従う。

- [ ] **Step 4: 全 11 シナリオのテストを追加**

設計書 §9.3 の全テストケース (1-11) を `atomic-persistence.test.ts` に追加。各テストは MockFileSystem の `setRawContent` / `link` モックを使い、並行シナリオを再現。

- [ ] **Step 5: 全テスト通過確認 (Devcontainer)**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: ALL PASS

- [ ] **Step 6: コミット & Draft PR**

```bash
git commit -m "feat(core): implement AtomicPersistence<T> with optimistic locking"
git push -u origin feature/phase2-task1_atomic-core
gh pr create --base feature/phase2_atomic-persistence__base --title "feat(core): AtomicPersistence<T>" --draft
```

### Task 2: WisdomPersistence thin wrapper 化

**Branch:** `feature/phase2-task2_wisdom-wrapper` ← Task 1 から派生
**依存理由:** `AtomicPersistence<T>` を内部で使用

**Files:**
- Modify: `src/core/wisdom-persistence.ts`
- Create: `tests/core/wisdom-persistence-concurrency.test.ts`

- [ ] **Step 1: loadWithLock / saveAtomicWithLock のテストを作成**

```typescript
// tests/core/wisdom-persistence-concurrency.test.ts
import { describe, it, expect } from "vitest";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { WisdomStore } from "../../src/core/wisdom-store";
import { createMockFileSystem } from "../helpers/mock-file-system";

describe("WisdomPersistence concurrency", () => {
  it("loadWithLock returns version=0 for new file", async () => {
    const fs = createMockFileSystem();
    const wp = new WisdomPersistence(fs, fs);
    const { store, lockMeta } = await wp.loadWithLock();
    expect(lockMeta.version).toBe(0);
    expect(store.getAllEntries()).toHaveLength(0);
  });

  it("saveAtomicWithLock increments version", async () => {
    const fs = createMockFileSystem();
    const wp = new WisdomPersistence(fs, fs);
    const store = new WisdomStore();
    store.add({ taskId: "t1", category: "success_pattern", content: "test" });
    const result = await wp.saveAtomicWithLock(store);
    expect(result.status).toBe("saved");
  });

  it("concurrent writes merge hitCount additively", async () => {
    const fs = createMockFileSystem();
    const wp = new WisdomPersistence(fs, fs);
    const store = new WisdomStore();
    const entry = store.add({ taskId: "t1", category: "success_pattern", content: "shared" });
    await wp.saveAtomicWithLock(store);

    // Writer A: reads, increments hitCount by 1
    const { store: storeA, lockMeta: metaA } = await wp.loadWithLock();
    const entryA = storeA.getAllEntries().find((e) => e.taskId === "t1")!;
    storeA.updateMetrics(entryA.id, (e) => ({ ...e, hitCount: (e.hitCount ?? 0) + 1, lastHitAt: "2026-01-01T00:00:00Z", firstSeenAt: "2026-01-01T00:00:00Z" }));

    // Writer B: reads same version, increments hitCount by 2
    const { store: storeB, lockMeta: metaB } = await wp.loadWithLock();
    const entryB = storeB.getAllEntries().find((e) => e.taskId === "t1")!;
    storeB.updateMetrics(entryB.id, (e) => ({ ...e, hitCount: (e.hitCount ?? 0) + 2, lastHitAt: "2026-02-01T00:00:00Z", firstSeenAt: "2026-01-01T00:00:00Z" }));

    // Both save — one will trigger merge
    await wp.saveAtomicWithLock(storeA, metaA);
    await wp.saveAtomicWithLock(storeB, metaB);

    const { store: final } = await wp.loadWithLock();
    const merged = final.getAllEntries().find((e) => e.taskId === "t1")!;
    expect(merged.hitCount).toBe(3); // 1 + 2 additively merged
    expect(merged.firstSeenAt).toBe("2026-01-01T00:00:00Z"); // earliest
    expect(merged.lastHitAt).toBe("2026-02-01T00:00:00Z"); // latest
  });

  it("existing saveAtomic still works (@deprecated)", async () => {
    const fs = createMockFileSystem();
    const wp = new WisdomPersistence(fs, fs);
    const store = new WisdomStore();
    store.add({ taskId: "t1", category: "failure_gotcha", content: "gotcha" });
    await wp.saveAtomic(store);
    const loaded = await wp.load();
    expect(loaded.getAllEntries()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `bun run test tests/core/wisdom-persistence-concurrency.test.ts`
Expected: FAIL — loadWithLock が未定義

- [ ] **Step 3: WisdomPersistence に loadWithLock / saveAtomicWithLock を追加**

`src/core/wisdom-persistence.ts` を修正:
- コンストラクタで `AtomicPersistence<WisdomStore>` インスタンスを生成
- `loadWithLock()` → `AtomicPersistence.loadWithLock()` に委譲
- `saveAtomicWithLock(store, lockMeta?)` → `AtomicPersistence.saveAtomicWithLock()` に委譲
- `mergeById` をメタデータ統合対応に拡張 (hitCount 加算, lastHitAt は新しい方, firstSeenAt は古い方)
- 既存 `saveAtomic` に `@deprecated` JSDoc を付与（実装は据え置き）

- [ ] **Step 4: 既存テスト + 新テスト通過確認 (Devcontainer)**

```bash
bun run test && bun run typecheck && bun run lint
```

Expected: ALL PASS (既存 `wisdom-persistence.test.ts` も無変更で通過)

- [ ] **Step 5: コミット & Draft PR**

```bash
git commit -m "feat(persistence): add loadWithLock/saveAtomicWithLock to WisdomPersistence"
git push -u origin feature/phase2-task2_wisdom-wrapper
gh pr create --base feature/phase2_atomic-persistence__base --title "feat(persistence): WisdomPersistence 楽観ロック対応" --draft
```

### Task 3: 統合テスト

**Branch:** `feature/phase2-task3_integration-test` ← Task 2 から派生
**依存理由:** WisdomPersistence の新 API が必要

**Files:**
- Create: `tests/integration/multi-process-wisdom.test.ts`

- [ ] **Step 1: 統合テストを作成**

```typescript
// tests/integration/multi-process-wisdom.test.ts
import { describe, it, expect } from "vitest";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { WisdomStore } from "../../src/core/wisdom-store";
import { createMockFileSystem } from "../helpers/mock-file-system";

describe("Multi-process wisdom integration", () => {
  it("3 concurrent writers all entries preserved via merge", async () => {
    const fs = createMockFileSystem();
    const wp1 = new WisdomPersistence(fs, fs);
    const wp2 = new WisdomPersistence(fs, fs);
    const wp3 = new WisdomPersistence(fs, fs);

    const s1 = new WisdomStore();
    s1.add({ taskId: "t1", category: "success_pattern", content: "from writer 1" });
    const s2 = new WisdomStore();
    s2.add({ taskId: "t2", category: "failure_gotcha", content: "from writer 2" });
    const s3 = new WisdomStore();
    s3.add({ taskId: "t3", category: "design_decision", content: "from writer 3" });

    await Promise.all([
      wp1.saveAtomicWithLock(s1),
      wp2.saveAtomicWithLock(s2),
      wp3.saveAtomicWithLock(s3),
    ]);

    const final = await wp1.load();
    const entries = final.getAllEntries();
    expect(entries.length).toBeGreaterThanOrEqual(3);

    // Verify each writer's entry is present with correct content
    const t1 = entries.find((e) => e.taskId === "t1" && e.content === "from writer 1");
    const t2 = entries.find((e) => e.taskId === "t2" && e.content === "from writer 2");
    const t3 = entries.find((e) => e.taskId === "t3" && e.content === "from writer 3");
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t3).toBeDefined();

    // Verify no duplicate entries per unique (taskId, category, content)
    const uniqueKeys = new Set(entries.map((e) => `${e.taskId}:${e.category}:${e.content}`));
    expect(uniqueKeys.size).toBe(entries.length);
  });

  it("existing wisdom-flow test still passes (AC-7)", async () => {
    // Backward compatibility: legacy saveAtomic + load round-trip
    const fs = createMockFileSystem();
    const wp = new WisdomPersistence(fs, fs);
    const store = new WisdomStore();
    store.add({ taskId: "t1", category: "failure_gotcha", content: "gotcha" });
    store.add({ taskId: "t2", category: "success_pattern", content: "pattern" });
    await wp.saveAtomic(store);
    const loaded = await wp.load();
    expect(loaded.getAllEntries()).toHaveLength(2);
    expect(loaded.getAllEntries().find((e) => e.taskId === "t1")?.content).toBe("gotcha");
    expect(loaded.getAllEntries().find((e) => e.taskId === "t2")?.content).toBe("pattern");
  });
});
```

- [ ] **Step 2: テスト通過確認 (Devcontainer)**

```bash
bun run test && bun run typecheck && bun run lint
```

Expected: ALL PASS

- [ ] **Step 3: コミット & Draft PR**

```bash
git commit -m "test(integration): add multi-process wisdom concurrency test"
git push -u origin feature/phase2-task3_integration-test
gh pr create --base feature/phase2_atomic-persistence__base --title "test(integration): 並行書き込み統合テスト" --draft
```

### Phase 2 完了

- [ ] **全 Task マージ後、master への Draft PR 作成**

```bash
gh pr create --base master --head feature/phase2_atomic-persistence__base --title "feat: Phase 2 — Atomic Persistence" --draft
```

---

*Phase 3–5 は別ファイルに続く: `2026-04-29-justice-expansion-phase3-5.md`*
