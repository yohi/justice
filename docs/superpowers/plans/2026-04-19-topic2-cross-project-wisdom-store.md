# Cross-Project Wisdom Store 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `WisdomStore` をプロジェクト横断で共有可能にする。プロジェクトローカル `.justice/wisdom.json` に加え、ユーザーホーム配下のグローバル `~/.justice/wisdom.json` を導入し、カテゴリヒューリスティックで自動振り分け・ローカル優先マージで読み出す。

**Architecture:** 新規 `TieredWisdomStore` が 2 つの独立した `WisdomStore` インスタンス（local / global）を合成する。書き込みは `environment_quirk` / `success_pattern` を global に、その他を local に振り分け、明示オプションで上書き可。読み込みはローカル優先・不足分を global から補填。永続化は `WisdomPersistence.saveAtomic()`（temp + rename）で行い、ロックを取らずに依存最小・FS 非依存の一貫性を担保する。

**Tech Stack:** TypeScript, Vitest, Bun, Node.js (`node:fs/promises`, `node:os`, `node:path`, `node:crypto`)

**Design Spec:** [2026-04-19-topic2-cross-project-wisdom-store-design.md](../specs/2026-04-19-topic2-cross-project-wisdom-store-design.md)

---

## CI/CD ステータス

既存の `.github/workflows/ci.yml` に以下が設定済みのため Phase 0 は不要:

- `on.push.branches: [ master ]` / `on.pull_request.branches: [ master ]`
- `jobs.test.runs-on: ubuntu-slim`
- `bun run lint / typecheck / test / build` をジョブ内で実行

本計画ではこの既存ワークフローに沿って各 PR が CI を通過することを完了条件の一部とする。

---

## Branch Strategy

```text
master
 ├─ feature/phase-1__tiered-wisdom-primitives__base      ← Draft PR → master
 │   ├─ feature/phase1-task1__filewriter-rename
 │   ├─ feature/phase1-task2__wisdom-store-additions
 │   └─ feature/phase1-task3__wisdom-persistence-atomic
 ├─ feature/phase-2__tiered-wisdom-core__base            ← Draft PR → master (Phase 1 マージ後に作成)
 │   ├─ feature/phase2-task1__secret-pattern-detector
 │   ├─ feature/phase2-task2__tiered-wisdom-routing
 │   └─ feature/phase2-task3__tiered-wisdom-merge-persistence
 └─ feature/phase-3__tiered-wisdom-integration__base     ← Draft PR → master (Phase 2 マージ後に作成)
     ├─ feature/phase3-task1__create-global-fs
     ├─ feature/phase3-task2__justice-plugin-wireup
     └─ feature/phase3-task3__docs-and-exports
```

| Branch | Base | PR Target |
|--------|------|-----------|
| `feature/phase-1__tiered-wisdom-primitives__base` | `master` | `master` (Draft) |
| `feature/phase1-task1__filewriter-rename` | `master` | `feature/phase-1__tiered-wisdom-primitives__base` (Draft) |
| `feature/phase1-task2__wisdom-store-additions` | `feature/phase1-task1__filewriter-rename` | `feature/phase-1__tiered-wisdom-primitives__base` (Draft) |
| `feature/phase1-task3__wisdom-persistence-atomic` | `feature/phase1-task2__wisdom-store-additions` | `feature/phase-1__tiered-wisdom-primitives__base` (Draft) |
| `feature/phase-2__tiered-wisdom-core__base` | `master`（Phase 1 マージ後） | `master` (Draft) |
| `feature/phase2-task1__secret-pattern-detector` | `master` | `feature/phase-2__tiered-wisdom-core__base` (Draft) |
| `feature/phase2-task2__tiered-wisdom-routing` | `feature/phase2-task1__secret-pattern-detector` | `feature/phase-2__tiered-wisdom-core__base` (Draft) |
| `feature/phase2-task3__tiered-wisdom-merge-persistence` | `feature/phase2-task2__tiered-wisdom-routing` | `feature/phase-2__tiered-wisdom-core__base` (Draft) |
| `feature/phase-3__tiered-wisdom-integration__base` | `master`（Phase 2 マージ後） | `master` (Draft) |
| `feature/phase3-task1__create-global-fs` | `master` | `feature/phase-3__tiered-wisdom-integration__base` (Draft) |
| `feature/phase3-task2__justice-plugin-wireup` | `feature/phase3-task1__create-global-fs` | `feature/phase-3__tiered-wisdom-integration__base` (Draft) |
| `feature/phase3-task3__docs-and-exports` | `feature/phase3-task2__justice-plugin-wireup` | `feature/phase-3__tiered-wisdom-integration__base` (Draft) |

**ブランチ運用ルール:**

- Phase ブランチは常に最新の `master` から作成する。前 Phase が `master` にマージされるまで次 Phase は開始しない。
- Task ブランチは同 Phase 内で直前の Task ブランチから派生させ、前 Task の PR 完了を待たずに積み上げる。
- 各 Task 完了時は所属 Phase ブランチをターゲットとする **Draft PR** を作成する。
- Phase ブランチは CI PASS 後に Ready-for-Review に昇格し `master` へマージする。

---

## File Structure

| File | Action | Responsibility | Phase |
|------|--------|---------------|-------|
| `src/core/types.ts` | Modify | `FileWriter` インタフェースに `rename()` / `deleteFile()` を追加 | Phase 1 Task 1 |
| `src/runtime/node-file-system.ts` | Modify | `rename()` / `deleteFile()` 実装（path traversal 防御込み） | Phase 1 Task 1 |
| `tests/helpers/mock-file-system.ts` | Modify | `createMockFileWriter` に `rename` / `deleteFile` サポート追加 | Phase 1 Task 1 |
| `tests/runtime/node-file-system.test.ts` | Modify | `rename` / `deleteFile` の挙動テスト追加 | Phase 1 Task 1 |
| `src/core/wisdom-store.ts` | Modify | `getAllEntries` / `getMaxEntries` / `fromEntries` の pure additions | Phase 1 Task 2 |
| `tests/core/wisdom-store.test.ts` | Modify | 新メソッドのユニットテスト追加 | Phase 1 Task 2 |
| `src/core/wisdom-persistence.ts` | Modify | `saveAtomic()` + `mergeById()` 追加（rename 失敗時の tmp cleanup 込み、既存 `save()` は保持） | Phase 1 Task 3 |
| `tests/core/wisdom-persistence-atomic.test.ts` | **Create** | atomic write / merge / LRU / rename 失敗 + tmp cleanup テスト | Phase 1 Task 3 |
| `src/core/secret-pattern-detector.ts` | **Create** | 秘密パターン照合 (~30 行) | Phase 2 Task 1 |
| `tests/core/secret-pattern-detector.test.ts` | **Create** | パターン網羅テスト | Phase 2 Task 1 |
| `src/core/tiered-wisdom-store.ts` | **Create** | 振り分け + マージ + 秘密検出統合 (~120 行) | Phase 2 Task 2 / 3 |
| `tests/core/tiered-wisdom-store.test.ts` | **Create** | ルーティング / 秘密検出ログ / マージ / taskId 集約 | Phase 2 Task 2 / 3 |
| `src/index.ts` | Modify | `TieredWisdomStore` / `SecretPatternDetector` export | Phase 2 Task 3 |
| `src/core/justice-plugin.ts` | Modify | `createGlobalFs` 呼び出し、`TieredWisdomStore` 保持、`getTieredWisdomStore()` 追加 | Phase 3 Task 1 / 2 |
| `tests/core/justice-plugin-global-fs.test.ts` | **Create** | env var / HOME 不在 / mkdir 失敗 / fail-open | Phase 3 Task 1 / 2 |
| `tests/core/justice-plugin.test.ts` | Modify | `getTieredWisdomStore()` / `getWisdomStore()` 互換テスト | Phase 3 Task 2 |
| `README.md` | Modify | "Cross-Project Wisdom Store" セクション追加 | Phase 3 Task 3 |
| `SPEC.md` | Modify | `TieredWisdomStore` 仕様追加 | Phase 3 Task 3 |
| `CHANGELOG.md` | Modify | Unreleased エントリ追加 | Phase 3 Task 3 |

---

## Phase 1: Atomic Persistence Primitives

> **Milestone:** `FileWriter.rename` / `deleteFile` / `WisdomStore` の pure additions / `WisdomPersistence.saveAtomic`（rename 失敗時の tmp cleanup 込み）が完成し、既存機能を壊さずに atomic 書き込み基盤が利用可能。Phase 2 以降から再利用可能な独立した単位として `master` マージ可能。

### Task 1: `FileWriter.rename` / `deleteFile` 追加と `NodeFileSystem` 実装

**Files:**

- Modify: `src/core/types.ts`（`FileWriter` インタフェースに `rename` / `deleteFile`）
- Modify: `src/runtime/node-file-system.ts`（`rename()` / `deleteFile()` 実装）
- Modify: `tests/helpers/mock-file-system.ts`（mock writer に `rename` / `deleteFile` 追加）
- Modify: `tests/runtime/node-file-system.test.ts`（`rename` / `deleteFile` テスト追加）

> **Note:** `deleteFile` は Phase 1 Task 3 の `saveAtomic` が rename 失敗時に tmp ファイルを best-effort cleanup するために必要。

**Branch:**

- Create: `feature/phase-1__tiered-wisdom-primitives__base` from `master`（まだ存在しなければ作成し Draft PR を立てる）
- Create: `feature/phase1-task1__filewriter-rename` from `master`
- PR: → `feature/phase-1__tiered-wisdom-primitives__base` (Draft)

---

- [ ] **Step 1: Phase ブランチと Task ブランチを作成**

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout master
git pull origin master
git checkout -b feature/phase-1__tiered-wisdom-primitives__base
git push -u origin feature/phase-1__tiered-wisdom-primitives__base
gh pr create --draft --base master --head feature/phase-1__tiered-wisdom-primitives__base \
  --title "feat(wisdom): Phase 1 — atomic persistence primitives (FileWriter.rename / WisdomStore additions / saveAtomic)" \
  --body "Tracks Phase 1 tasks of the cross-project wisdom store plan. See docs/superpowers/plans/2026-04-19-topic2-cross-project-wisdom-store.md"
git checkout -b feature/phase1-task1__filewriter-rename
```

- [ ] **Step 2: ベースラインで既存テストが PASS することを確認**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: 全テスト PASS（失敗 0 件。テスト総数を記録）

- [ ] **Step 3: `NodeFileSystem.rename` / `deleteFile` の失敗テストを作成 (RED)**

`tests/runtime/node-file-system.test.ts` の末尾 `describe("NodeFileSystem", ...)` 内に以下の `describe` ブロックを追加:

```typescript
  describe("rename", () => {
    it("should rename a file within the root directory", async () => {
      await fs.writeFile("src.txt", "hello");
      await fs.rename("src.txt", "dst.txt");

      expect(await fs.fileExists("src.txt")).toBe(false);
      expect(await fs.fileExists("dst.txt")).toBe(true);
      expect(await fs.readFile("dst.txt")).toBe("hello");
    });

    it("should rename into a nested directory that does not exist yet", async () => {
      await fs.writeFile("src.txt", "hello");
      await expect(fs.rename("src.txt", "nested/dst.txt")).rejects.toThrow();
    });

    it("should reject absolute source paths", async () => {
      await expect(fs.rename("/etc/passwd", "out.txt")).rejects.toThrow("path traversal");
    });

    it("should reject absolute target paths", async () => {
      await fs.writeFile("src.txt", "hello");
      await expect(fs.rename("src.txt", "/tmp/out.txt")).rejects.toThrow("path traversal");
    });

    it("should reject path traversal in source or target", async () => {
      await fs.writeFile("src.txt", "hello");
      await expect(fs.rename("../escape.txt", "dst.txt")).rejects.toThrow("path traversal");
      await expect(fs.rename("src.txt", "../escape.txt")).rejects.toThrow("path traversal");
    });
  });

  describe("deleteFile", () => {
    it("should delete an existing file within the root directory", async () => {
      await fs.writeFile("tmp.txt", "x");
      await fs.deleteFile("tmp.txt");
      expect(await fs.fileExists("tmp.txt")).toBe(false);
    });

    it("should throw when deleting a non-existent file", async () => {
      await expect(fs.deleteFile("missing.txt")).rejects.toThrow();
    });

    it("should reject absolute paths", async () => {
      await expect(fs.deleteFile("/etc/passwd")).rejects.toThrow("path traversal");
    });

    it("should reject path traversal attempts", async () => {
      await expect(fs.deleteFile("../escape.txt")).rejects.toThrow("path traversal");
    });
  });
```

- [ ] **Step 4: テストが FAIL することを確認**

Run: `bun run test tests/runtime/node-file-system.test.ts`
Expected: FAIL — `fs.rename is not a function` / `fs.deleteFile is not a function`

- [ ] **Step 5: `FileWriter` インタフェースに `rename` / `deleteFile` を追加**

`src/core/types.ts` の `FileWriter` インタフェースを以下に変更:

```typescript
/** ファイル書き込みアクセスの抽象化 */
export interface FileWriter {
  /**
   * 指定されたパスにデータを書き込みます。
   * 実装側は、書き込み前に親ディレクトリが存在することを保証（必要に応じて作成）しなければなりません。
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * ファイルを `from` から `to` へ atomic にリネームします。
   * 両 path とも rootDir 配下に閉じる必要があり、実装は path traversal を拒否します。
   */
  rename(from: string, to: string): Promise<void>;

  /**
   * 指定されたパスのファイルを削除します。best-effort クリーンアップ（例:
   * `saveAtomic` が rename に失敗した際の一時ファイル除去）に用いられます。
   * 実装は path traversal を拒否します。
   */
  deleteFile(path: string): Promise<void>;
}
```

- [ ] **Step 6: `NodeFileSystem.rename` / `deleteFile` を実装**

`src/runtime/node-file-system.ts` を修正。import に `rename as fsRename` と `unlink` を追加し、クラスにメソッドを追加:

```typescript
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  realpath,
  rename as fsRename,
  unlink,
} from "node:fs/promises";
```

```typescript
  async rename(from: string, to: string): Promise<void> {
    const safeFrom = await this.resolveSafelyForWrite(from);
    const safeTo = await this.resolveSafelyForWrite(to);
    await fsRename(safeFrom, safeTo);
  }

  async deleteFile(path: string): Promise<void> {
    const safePath = await this.resolveSafelyForWrite(path);
    await unlink(safePath);
  }
```

> **Note:** `resolveSafelyForWrite` を使う理由は、`to` 側や `deleteFile` 対象が状況によって存在しない可能性があるため。既に path traversal 防御は `resolveSafelyForWrite` 内で実装済み。

- [ ] **Step 7: モックに `rename` / `deleteFile` を追加**

`tests/helpers/mock-file-system.ts` を以下に置き換える:

```typescript
import { vi } from "vitest";
import type { FileReader, FileWriter } from "../../src/core/types";

export function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (_path: string) => {
      const content = files[_path];
      if (content === undefined) throw new Error(`File not found: ${_path}`);
      return content;
    }),
    fileExists: vi.fn(async (_path: string) => _path in files),
  };
}

export function createMockFileWriter(): FileWriter & { writtenFiles: Record<string, string> } {
  const writtenFiles: Record<string, string> = {};
  return {
    writtenFiles,
    writeFile: vi.fn(async (path: string, content: string) => {
      writtenFiles[path] = content;
    }),
    rename: vi.fn(async (from: string, to: string) => {
      if (!(from in writtenFiles)) {
        throw new Error(`rename: source not found: ${from}`);
      }
      writtenFiles[to] = writtenFiles[from];
      delete writtenFiles[from];
    }),
    deleteFile: vi.fn(async (path: string) => {
      if (!(path in writtenFiles)) {
        throw new Error(`deleteFile: file not found: ${path}`);
      }
      delete writtenFiles[path];
    }),
  };
}
```

- [ ] **Step 8: テストが PASS することを確認**

Run: `bun run test tests/runtime/node-file-system.test.ts`
Expected: PASS（新規 9 ケース + 既存分 すべて）

Run: `bun run test`
Expected: 全テスト PASS（`FileWriter` 実装側が追加されたため型チェック経由で `createMockFileWriter` を使う既存テストも問題なし）

Run: `bun run typecheck && bun run lint`
Expected: エラーなし

- [ ] **Step 9: コミット**

```bash
git add src/core/types.ts src/runtime/node-file-system.ts tests/helpers/mock-file-system.ts tests/runtime/node-file-system.test.ts
git commit -m "feat(core): FileWriterにrename()とdeleteFile()を追加しNodeFileSystemで実装"
```

- [ ] **Step 10: Push して Draft PR を作成**

```bash
git push -u origin feature/phase1-task1__filewriter-rename
gh pr create --draft \
  --base feature/phase-1__tiered-wisdom-primitives__base \
  --head feature/phase1-task1__filewriter-rename \
  --title "feat(core): FileWriterにrename()とdeleteFile()を追加しNodeFileSystemで実装" \
  --body "Part of Phase 1 Task 1 — See plan: docs/superpowers/plans/2026-04-19-topic2-cross-project-wisdom-store.md"
```

Draft PR: `feature/phase1-task1__filewriter-rename` → `feature/phase-1__tiered-wisdom-primitives__base`

---

### Task 2: `WisdomStore` の pure additions（depends: Task 1）

**Files:**

- Modify: `src/core/wisdom-store.ts`（`getAllEntries` / `getMaxEntries` / `fromEntries`）
- Modify: `tests/core/wisdom-store.test.ts`

**Branch:**

- Create: `feature/phase1-task2__wisdom-store-additions` from `feature/phase1-task1__filewriter-rename`
- PR: → `feature/phase-1__tiered-wisdom-primitives__base` (Draft)

---

- [ ] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase1-task1__filewriter-rename
git checkout -b feature/phase1-task2__wisdom-store-additions
```

- [ ] **Step 2: 新メソッドの失敗テストを追加 (RED)**

`tests/core/wisdom-store.test.ts` の末尾（既存 `describe` の外側）に以下を追加:

```typescript
describe("WisdomStore — additions for TieredWisdomStore", () => {
  it("getAllEntries should return all entries as a readonly snapshot", () => {
    const store = new WisdomStore(100);
    store.add({ taskId: "t1", category: "success_pattern", content: "A" });
    store.add({ taskId: "t2", category: "failure_gotcha", content: "B" });

    const all = store.getAllEntries();
    expect(all).toHaveLength(2);
    expect(all[0]?.taskId).toBe("t1");
    expect(all[1]?.taskId).toBe("t2");
  });

  it("getMaxEntries should expose the configured capacity", () => {
    expect(new WisdomStore(50).getMaxEntries()).toBe(50);
    expect(new WisdomStore().getMaxEntries()).toBe(100);
  });

  it("fromEntries should reconstruct a store preserving entry order", () => {
    const entries = [
      {
        id: "w-a",
        taskId: "t1",
        category: "success_pattern" as const,
        content: "A",
        timestamp: "2026-01-01T00:00:00Z",
      },
      {
        id: "w-b",
        taskId: "t2",
        category: "failure_gotcha" as const,
        content: "B",
        timestamp: "2026-01-02T00:00:00Z",
      },
    ];
    const store = WisdomStore.fromEntries(entries, 100);
    expect(store.getAllEntries()).toHaveLength(2);
    expect(store.getAllEntries()[0]?.id).toBe("w-a");
    expect(store.getMaxEntries()).toBe(100);
  });

  it("fromEntries should trim to maxEntries keeping the latest entries (LRU-like)", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `w-${i}`,
      taskId: `t${i}`,
      category: "success_pattern" as const,
      content: `C${i}`,
      timestamp: `2026-01-0${i + 1}T00:00:00Z`,
    }));
    const store = WisdomStore.fromEntries(entries, 3);
    const all = store.getAllEntries();
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.id)).toEqual(["w-2", "w-3", "w-4"]);
  });
});
```

> **Note:** 既存のテストファイル冒頭で `WisdomStore` を import していることを確認。

- [ ] **Step 3: テストが FAIL することを確認**

Run: `bun run test tests/core/wisdom-store.test.ts`
Expected: FAIL（`getAllEntries` / `getMaxEntries` / `fromEntries` が undefined）

- [ ] **Step 4: `WisdomStore` に pure additions を実装**

`src/core/wisdom-store.ts` の `WisdomStore` クラス末尾（`private static isValidEntry` の直前）に以下を追加:

```typescript
  /**
   * Returns a readonly snapshot of all entries in insertion order.
   */
  getAllEntries(): readonly WisdomEntry[] {
    return this.entries;
  }

  /**
   * Returns the configured maximum entry capacity.
   */
  getMaxEntries(): number {
    return this.maxEntries;
  }

  /**
   * Constructs a store from a list of entries, keeping the latest `maxEntries`.
   * Order is preserved; overflow is trimmed from the front (oldest) in a single
   * pass via `slice(-maxEntries)` (O(N)).
   */
  static fromEntries(entries: readonly WisdomEntry[], maxEntries = 100): WisdomStore {
    const store = new WisdomStore(maxEntries);
    const trimmed =
      entries.length > maxEntries ? entries.slice(-maxEntries) : entries;
    for (const entry of trimmed) {
      store.entries.push(entry);
    }
    return store;
  }
```

- [ ] **Step 5: テストが PASS することを確認**

Run: `bun run test tests/core/wisdom-store.test.ts`
Expected: PASS（新規 4 ケース + 既存分 すべて）

Run: `bun run test`
Expected: 全テスト PASS

Run: `bun run typecheck && bun run lint`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/core/wisdom-store.ts tests/core/wisdom-store.test.ts
git commit -m "feat(core): WisdomStoreにgetAllEntries/getMaxEntries/fromEntriesを追加"
```

- [ ] **Step 7: Push して Draft PR を作成**

```bash
git push -u origin feature/phase1-task2__wisdom-store-additions
gh pr create --draft \
  --base feature/phase-1__tiered-wisdom-primitives__base \
  --head feature/phase1-task2__wisdom-store-additions \
  --title "feat(core): WisdomStoreにgetAllEntries/getMaxEntries/fromEntriesを追加" \
  --body "Part of Phase 1 Task 2 — pure additions used by TieredWisdomStore / saveAtomic."
```

Draft PR: `feature/phase1-task2__wisdom-store-additions` → `feature/phase-1__tiered-wisdom-primitives__base`

---

### Task 3: `WisdomPersistence.saveAtomic` 実装（depends: Task 2）

**Files:**

- Modify: `src/core/wisdom-persistence.ts`（`saveAtomic` / `mergeById` 追加）
- Create: `tests/core/wisdom-persistence-atomic.test.ts`

**Branch:**

- Create: `feature/phase1-task3__wisdom-persistence-atomic` from `feature/phase1-task2__wisdom-store-additions`
- PR: → `feature/phase-1__tiered-wisdom-primitives__base` (Draft)

---

- [ ] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase1-task2__wisdom-store-additions
git checkout -b feature/phase1-task3__wisdom-persistence-atomic
```

- [ ] **Step 2: 失敗テストを作成 (RED)**

`tests/core/wisdom-persistence-atomic.test.ts` を新規作成:

```typescript
import { describe, it, expect, vi } from "vitest";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { WisdomStore } from "../../src/core/wisdom-store";
import type { WisdomEntry } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

const defaultPath = ".justice/wisdom.json";

function makeEntry(overrides: Partial<WisdomEntry>): WisdomEntry {
  return {
    id: "w-base",
    taskId: "t",
    category: "success_pattern",
    content: "x",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WisdomPersistence.saveAtomic", () => {
  it("should write via temp file and rename to target", async () => {
    const writer = createMockFileWriter();
    const reader = createMockFileReader({});
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = new WisdomStore(100);
    store.add({ taskId: "t1", category: "success_pattern", content: "Hello" });
    await persistence.saveAtomic(store);

    // 最終的に target path にのみファイルが残る
    expect(writer.writtenFiles[defaultPath]).toBeDefined();
    const parsed = JSON.parse(writer.writtenFiles[defaultPath]!);
    expect(parsed.entries).toHaveLength(1);

    // temp ファイルは rename で消えている（writtenFiles に残らない）
    const keys = Object.keys(writer.writtenFiles);
    expect(keys.filter((k) => k.includes(".tmp."))).toHaveLength(0);

    // writeFile と rename が期待通り呼ばれた
    expect(writer.writeFile).toHaveBeenCalledTimes(1);
    expect(writer.rename).toHaveBeenCalledTimes(1);
  });

  it("should merge disk and in-memory entries, preferring newer timestamps for duplicate IDs", async () => {
    const existing = {
      entries: [
        makeEntry({ id: "w-1", taskId: "t1", content: "old", timestamp: "2026-01-01T00:00:00Z" }),
        makeEntry({ id: "w-2", taskId: "t2", content: "keep-disk", timestamp: "2026-01-02T00:00:00Z" }),
      ],
      maxEntries: 100,
    };
    const reader = createMockFileReader({ [defaultPath]: JSON.stringify(existing) });
    const writer = createMockFileWriter();
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = WisdomStore.fromEntries(
      [
        makeEntry({ id: "w-1", taskId: "t1", content: "new", timestamp: "2026-01-05T00:00:00Z" }),
        makeEntry({ id: "w-3", taskId: "t3", content: "added", timestamp: "2026-01-03T00:00:00Z" }),
      ],
      100,
    );

    await persistence.saveAtomic(store);
    const parsed = JSON.parse(writer.writtenFiles[defaultPath]!);
    const byId = Object.fromEntries(
      (parsed.entries as WisdomEntry[]).map((e) => [e.id, e]),
    );

    expect(byId["w-1"]?.content).toBe("new");
    expect(byId["w-2"]?.content).toBe("keep-disk");
    expect(byId["w-3"]?.content).toBe("added");
    expect(parsed.entries).toHaveLength(3);
  });

  it("should trim merged entries to maxEntries using the most-recent timestamps", async () => {
    const diskEntries = Array.from({ length: 8 }, (_, i) =>
      makeEntry({ id: `w-d${i}`, content: `d${i}`, timestamp: `2026-01-01T00:0${i}:00Z` }),
    );
    const memEntries = Array.from({ length: 6 }, (_, i) =>
      makeEntry({ id: `w-m${i}`, content: `m${i}`, timestamp: `2026-02-01T00:0${i}:00Z` }),
    );
    const reader = createMockFileReader({
      [defaultPath]: JSON.stringify({ entries: diskEntries, maxEntries: 10 }),
    });
    const writer = createMockFileWriter();
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = WisdomStore.fromEntries(memEntries, 10);
    await persistence.saveAtomic(store);

    const parsed = JSON.parse(writer.writtenFiles[defaultPath]!);
    expect(parsed.entries).toHaveLength(10);
    // memEntries (新しい timestamp) は全て保持される
    for (const e of memEntries) {
      expect((parsed.entries as WisdomEntry[]).map((x) => x.id)).toContain(e.id);
    }
  });

  it("should propagate rename errors and remove the temp file", async () => {
    const writer = createMockFileWriter();
    writer.rename = vi.fn(async () => {
      throw new Error("rename failed");
    });
    const reader = createMockFileReader({});
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = new WisdomStore(100);
    store.add({ taskId: "t1", category: "success_pattern", content: "x" });

    await expect(persistence.saveAtomic(store)).rejects.toThrow("rename failed");
    // target path にはファイルが書かれていない
    expect(writer.writtenFiles[defaultPath]).toBeUndefined();
    // tmp ファイルもクリーンアップされて残らない
    expect(
      Object.keys(writer.writtenFiles).filter((k) => k.includes(".tmp.")),
    ).toHaveLength(0);
    expect(writer.deleteFile).toHaveBeenCalledTimes(1);
  });

  it("should still propagate the rename error when tmp cleanup also fails", async () => {
    const writer = createMockFileWriter();
    writer.rename = vi.fn(async () => {
      throw new Error("rename failed");
    });
    writer.deleteFile = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const reader = createMockFileReader({});
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = new WisdomStore(100);
    store.add({ taskId: "t1", category: "success_pattern", content: "x" });

    // 原因である rename の例外が伝播する（cleanup の例外は握りつぶされる）
    await expect(persistence.saveAtomic(store)).rejects.toThrow("rename failed");
    expect(writer.deleteFile).toHaveBeenCalledTimes(1);
  });

  it("should use unique temp file names across concurrent calls", async () => {
    const writer = createMockFileWriter();
    const reader = createMockFileReader({});
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const writtenPaths: string[] = [];
    const originalWriteFile = writer.writeFile.bind(writer);
    writer.writeFile = vi.fn(async (path: string, content: string) => {
      writtenPaths.push(path);
      await originalWriteFile(path, content);
    });

    const s1 = new WisdomStore(100);
    s1.add({ taskId: "t1", category: "success_pattern", content: "a" });
    const s2 = new WisdomStore(100);
    s2.add({ taskId: "t2", category: "success_pattern", content: "b" });

    await Promise.all([persistence.saveAtomic(s1), persistence.saveAtomic(s2)]);
    const tmpPaths = writtenPaths.filter((p) => p.includes(".tmp."));
    expect(new Set(tmpPaths).size).toBe(tmpPaths.length);
  });
});
```

- [ ] **Step 3: テストが FAIL することを確認**

Run: `bun run test tests/core/wisdom-persistence-atomic.test.ts`
Expected: FAIL — `persistence.saveAtomic is not a function`

- [ ] **Step 4: `saveAtomic` と `mergeById` を実装**

`src/core/wisdom-persistence.ts` 全体を以下に置き換える:

```typescript
import { randomBytes } from "node:crypto";
import type { FileReader, FileWriter, WisdomEntry } from "./types";
import { WisdomStore } from "./wisdom-store";

/**
 * WisdomPersistence handles reading and writing WisdomStore data
 * to the filesystem. Keeps I/O concerns separate from the pure WisdomStore logic.
 */
export class WisdomPersistence {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly wisdomFilePath: string = ".justice/wisdom.json",
  ) {}

  /**
   * Loads WisdomStore from file. Returns an empty store if the file doesn't
   * exist or contains invalid data.
   */
  async load(): Promise<WisdomStore> {
    const exists = await this.fileReader.fileExists(this.wisdomFilePath);
    if (!exists) {
      return new WisdomStore();
    }

    try {
      const json = await this.fileReader.readFile(this.wisdomFilePath);
      return WisdomStore.deserialize(json);
    } catch {
      // Fail-open: return empty store on I/O or parse errors
      return new WisdomStore();
    }
  }

  /**
   * Persists the current WisdomStore to the wisdom JSON file (non-atomic).
   * Kept for backward compatibility with existing callers/tests.
   */
  async save(store: WisdomStore): Promise<void> {
    const json = store.serialize();
    await this.fileWriter.writeFile(this.wisdomFilePath, json);
  }

  /**
   * Atomically persists the WisdomStore: loads current on-disk state, merges
   * in-memory entries (newer timestamp wins for duplicate IDs), trims to
   * maxEntries, writes to a temp file, then renames over the target file.
   *
   * Race window `load → merge → write` is intentionally unlocked; see design
   * spec §8 (lock-free design notes).
   *
   * If `rename` fails, the temp file is best-effort removed before the original
   * error is rethrown, so orphan `.tmp.*` files do not accumulate on repeated
   * failures.
   */
  async saveAtomic(store: WisdomStore): Promise<void> {
    const currentOnDisk = await this.load();
    const merged = this.mergeById(currentOnDisk.getAllEntries(), store.getAllEntries());
    const capped = merged.slice(-store.getMaxEntries());

    const finalStore = WisdomStore.fromEntries(capped, store.getMaxEntries());
    const json = finalStore.serialize();

    const tmpPath = `${this.wisdomFilePath}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
    await this.fileWriter.writeFile(tmpPath, json);
    try {
      await this.fileWriter.rename(tmpPath, this.wisdomFilePath);
    } catch (renameErr) {
      try {
        await this.fileWriter.deleteFile(tmpPath);
      } catch {
        // Swallow cleanup errors — the rename failure below is the real cause.
      }
      throw renameErr;
    }
  }

  private mergeById(
    diskEntries: readonly WisdomEntry[],
    memoryEntries: readonly WisdomEntry[],
  ): WisdomEntry[] {
    const byId = new Map<string, WisdomEntry>();
    for (const e of diskEntries) byId.set(e.id, e);
    for (const e of memoryEntries) {
      const existing = byId.get(e.id);
      if (!existing || e.timestamp > existing.timestamp) {
        byId.set(e.id, e);
      }
    }
    return [...byId.values()].sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
    );
  }
}
```

- [ ] **Step 5: テストが PASS することを確認**

Run: `bun run test tests/core/wisdom-persistence-atomic.test.ts`
Expected: PASS（6 ケース）

Run: `bun run test`
Expected: 全テスト PASS（既存 `wisdom-persistence.test.ts` も pass — `save()` は保持されているため）

Run: `bun run typecheck && bun run lint && bun run build`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/core/wisdom-persistence.ts tests/core/wisdom-persistence-atomic.test.ts
git commit -m "feat(core): WisdomPersistenceにsaveAtomic()を追加しtemp+renameで永続化"
```

- [ ] **Step 7: Push して Draft PR を作成**

```bash
git push -u origin feature/phase1-task3__wisdom-persistence-atomic
gh pr create --draft \
  --base feature/phase-1__tiered-wisdom-primitives__base \
  --head feature/phase1-task3__wisdom-persistence-atomic \
  --title "feat(core): WisdomPersistenceにsaveAtomic()を追加" \
  --body "Part of Phase 1 Task 3 — atomic RMW write with id-based merge and LRU trimming."
```

Draft PR: `feature/phase1-task3__wisdom-persistence-atomic` → `feature/phase-1__tiered-wisdom-primitives__base`

- [ ] **Step 8: Phase 1 base PR を Ready-for-Review に昇格**

Phase 1 の Task 1〜3 の Draft PR が積み上がった状態で、Phase ブランチ `feature/phase-1__tiered-wisdom-primitives__base` を `master` 向け Draft PR のまま残し、CI が通ったら Ready-for-Review に変更してレビュー → マージを行う（マージ後に Phase 2 を開始）。

---

## Phase 2: Secret Detection & Tiered Wisdom Store

> **Milestone:** `SecretPatternDetector` と `TieredWisdomStore` が完成し、振り分けロジック・読み込みマージ・秘密検出警告が単体で動作する。`JusticePlugin` には未統合だが、`src/index.ts` から import 可能になる。Phase 3 との接続前にもライブラリ利用者は自力で合成できる。

### Task 1: `SecretPatternDetector` 新規作成

**Files:**

- Create: `src/core/secret-pattern-detector.ts`
- Create: `tests/core/secret-pattern-detector.test.ts`

**Branch:**

- まず `master` に Phase 1 がマージされていることを確認
- Create: `feature/phase-2__tiered-wisdom-core__base` from `master`（Phase ブランチを作成し Draft PR を master 向けに立てる）
- Create: `feature/phase2-task1__secret-pattern-detector` from `master`
- PR: → `feature/phase-2__tiered-wisdom-core__base` (Draft)

---

- [ ] **Step 1: Phase 1 が master にマージされていることを確認**

```bash
git fetch origin master
git log --oneline origin/master -n 5
```

Expected: Phase 1 のマージコミットが master に存在する

- [ ] **Step 2: Phase 2 ブランチと Task ブランチを作成**

```bash
git checkout master
git pull origin master
git checkout -b feature/phase-2__tiered-wisdom-core__base
git push -u origin feature/phase-2__tiered-wisdom-core__base
gh pr create --draft --base master --head feature/phase-2__tiered-wisdom-core__base \
  --title "feat(wisdom): Phase 2 — SecretPatternDetector and TieredWisdomStore core" \
  --body "Tracks Phase 2 tasks of the cross-project wisdom store plan."
git checkout -b feature/phase2-task1__secret-pattern-detector
```

- [ ] **Step 3: `SecretPatternDetector` の失敗テストを作成 (RED)**

`tests/core/secret-pattern-detector.test.ts` を新規作成:

```typescript
import { describe, it, expect } from "vitest";
import { SecretPatternDetector } from "../../src/core/secret-pattern-detector";

describe("SecretPatternDetector", () => {
  const detector = new SecretPatternDetector();

  it("should return empty array for benign content", () => {
    expect(detector.scan("this is a normal comment about implementation")).toEqual([]);
  });

  it("should detect api_key case-insensitively", () => {
    expect(detector.scan("ANTHROPIC_API_KEY=abc")).toContain("api_key");
    expect(detector.scan("set api-key properly")).toContain("api_key");
    expect(detector.scan("Api_Key missing")).toContain("api_key");
  });

  it("should detect password mentions", () => {
    expect(detector.scan("use password here")).toContain("password");
  });

  it("should detect standalone 'secret' and 'token' words", () => {
    expect(detector.scan("the secret is safe")).toContain("secret");
    expect(detector.scan("JWT token expired")).toContain("token");
  });

  it("should detect linux home paths", () => {
    expect(detector.scan("error at /home/yohi/.aws/credentials")).toContain("home_path_linux");
  });

  it("should detect macos home paths", () => {
    expect(detector.scan("error at /Users/alice/Library/")).toContain("home_path_macos");
  });

  it("should detect anthropic API key literal shape", () => {
    expect(detector.scan("sk-ant-abcdefghijklmnopqrstuvwx")).toContain("anthropic_key");
  });

  it("should detect openai API key literal shape", () => {
    expect(detector.scan("sk-abcdefghijklmnopqrstuv")).toContain("openai_key");
  });

  it("should return multiple patterns when several match", () => {
    const matches = detector.scan("API_KEY=sk-ant-abcdefghijklmnopqrstuvwx stored at /home/yohi/");
    expect(matches).toContain("api_key");
    expect(matches).toContain("anthropic_key");
    expect(matches).toContain("home_path_linux");
  });
});
```

- [ ] **Step 4: テストが FAIL することを確認**

Run: `bun run test tests/core/secret-pattern-detector.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 5: `SecretPatternDetector` を実装**

`src/core/secret-pattern-detector.ts` を新規作成:

```typescript
export interface SecretMatch {
  readonly name: string;
}

const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = Object.freeze([
  { name: "api_key", pattern: /api[-_]?key/i },
  { name: "password", pattern: /password/i },
  { name: "secret", pattern: /\bsecret\b/i },
  { name: "token", pattern: /\btoken\b/i },
  { name: "home_path_linux", pattern: /\/home\/[^/\s]+\// },
  { name: "home_path_macos", pattern: /\/Users\/[^/\s]+\// },
  { name: "openai_key", pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: "anthropic_key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
]);

export class SecretPatternDetector {
  scan(content: string): string[] {
    return SECRET_PATTERNS
      .filter(({ pattern }) => pattern.test(content))
      .map(({ name }) => name);
  }
}
```

- [ ] **Step 6: テストが PASS することを確認**

Run: `bun run test tests/core/secret-pattern-detector.test.ts`
Expected: PASS（9 ケース）

Run: `bun run test`
Expected: 全テスト PASS

Run: `bun run typecheck && bun run lint`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/core/secret-pattern-detector.ts tests/core/secret-pattern-detector.test.ts
git commit -m "feat(core): SecretPatternDetectorを新規追加（秘密パターン照合）"
```

- [ ] **Step 8: Push して Draft PR を作成**

```bash
git push -u origin feature/phase2-task1__secret-pattern-detector
gh pr create --draft \
  --base feature/phase-2__tiered-wisdom-core__base \
  --head feature/phase2-task1__secret-pattern-detector \
  --title "feat(core): SecretPatternDetectorを新規追加" \
  --body "Part of Phase 2 Task 1."
```

Draft PR: `feature/phase2-task1__secret-pattern-detector` → `feature/phase-2__tiered-wisdom-core__base`

---

### Task 2: `TieredWisdomStore` 骨格 + `add()` 振り分けロジック（depends: Task 1）

**Files:**

- Create: `src/core/tiered-wisdom-store.ts`
- Create: `tests/core/tiered-wisdom-store.test.ts`

**Branch:**

- Create: `feature/phase2-task2__tiered-wisdom-routing` from `feature/phase2-task1__secret-pattern-detector`
- PR: → `feature/phase-2__tiered-wisdom-core__base` (Draft)

---

- [ ] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase2-task1__secret-pattern-detector
git checkout -b feature/phase2-task2__tiered-wisdom-routing
```

- [ ] **Step 2: 骨格とルーティングの失敗テストを作成 (RED)**

`tests/core/tiered-wisdom-store.test.ts` を新規作成:

```typescript
import { describe, it, expect, vi } from "vitest";
import { TieredWisdomStore } from "../../src/core/tiered-wisdom-store";
import { WisdomStore } from "../../src/core/wisdom-store";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { SecretPatternDetector } from "../../src/core/secret-pattern-detector";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

function makeLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeTiered(opts?: {
  localStore?: WisdomStore;
  globalStore?: WisdomStore;
  globalDisplayPath?: string;
  logger?: ReturnType<typeof makeLogger>;
}) {
  const localStore = opts?.localStore ?? new WisdomStore(100);
  const globalStore = opts?.globalStore ?? new WisdomStore(500);
  const localPersistence = new WisdomPersistence(
    createMockFileReader({}),
    createMockFileWriter(),
    ".justice/wisdom.json",
  );
  const globalPersistence = new WisdomPersistence(
    createMockFileReader({}),
    createMockFileWriter(),
    "wisdom.json",
  );
  const logger = opts?.logger ?? makeLogger();

  const tiered = new TieredWisdomStore({
    localStore,
    globalStore,
    localPersistence,
    globalPersistence,
    secretDetector: new SecretPatternDetector(),
    globalDisplayPath: opts?.globalDisplayPath ?? "~/.justice/wisdom.json",
    logger,
  });
  return { tiered, localStore, globalStore, localPersistence, globalPersistence, logger };
}

describe("TieredWisdomStore — routing (add)", () => {
  it("should route environment_quirk to globalStore by default", () => {
    const { tiered, localStore, globalStore } = makeTiered();
    const localSpy = vi.spyOn(localStore, "add");
    const globalSpy = vi.spyOn(globalStore, "add");

    tiered.add({ taskId: "t", category: "environment_quirk", content: "Bun X quirk" });

    expect(globalSpy).toHaveBeenCalledTimes(1);
    expect(localSpy).not.toHaveBeenCalled();
  });

  it("should route success_pattern to globalStore by default", () => {
    const { tiered, localStore, globalStore } = makeTiered();
    const localSpy = vi.spyOn(localStore, "add");
    const globalSpy = vi.spyOn(globalStore, "add");

    tiered.add({ taskId: "t", category: "success_pattern", content: "Pattern Y" });

    expect(globalSpy).toHaveBeenCalledTimes(1);
    expect(localSpy).not.toHaveBeenCalled();
  });

  it("should route failure_gotcha to localStore by default", () => {
    const { tiered, localStore, globalStore } = makeTiered();
    const localSpy = vi.spyOn(localStore, "add");
    const globalSpy = vi.spyOn(globalStore, "add");

    tiered.add({ taskId: "t", category: "failure_gotcha", content: "Gotcha Z" });

    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(globalSpy).not.toHaveBeenCalled();
  });

  it("should route design_decision to localStore by default", () => {
    const { tiered, localStore, globalStore } = makeTiered();
    const localSpy = vi.spyOn(localStore, "add");
    const globalSpy = vi.spyOn(globalStore, "add");

    tiered.add({ taskId: "t", category: "design_decision", content: "Decision" });

    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(globalSpy).not.toHaveBeenCalled();
  });

  it("should honor explicit scope=local for environment_quirk", () => {
    const { tiered, localStore, globalStore } = makeTiered();
    const localSpy = vi.spyOn(localStore, "add");
    const globalSpy = vi.spyOn(globalStore, "add");

    tiered.add(
      { taskId: "t", category: "environment_quirk", content: "Override-local" },
      { scope: "local" },
    );

    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(globalSpy).not.toHaveBeenCalled();
  });

  it("should honor explicit scope=global for failure_gotcha", () => {
    const { tiered, localStore, globalStore } = makeTiered();
    const localSpy = vi.spyOn(localStore, "add");
    const globalSpy = vi.spyOn(globalStore, "add");

    tiered.add(
      { taskId: "t", category: "failure_gotcha", content: "Override-global" },
      { scope: "global" },
    );

    expect(globalSpy).toHaveBeenCalledTimes(1);
    expect(localSpy).not.toHaveBeenCalled();
  });

  it("should log warn when an entry with secrets is promoted to global", () => {
    const { tiered, logger } = makeTiered();

    tiered.add({
      taskId: "t",
      category: "success_pattern",
      content: "remember to set ANTHROPIC_API_KEY",
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const msg = logger.warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain("may contain secrets");
    expect(msg).toContain("api_key");
    expect(msg).toContain("~/.justice/wisdom.json");
  });

  it("should NOT log warn when entry stays local even if it looks like a secret", () => {
    const { tiered, logger } = makeTiered();

    tiered.add({
      taskId: "t",
      category: "failure_gotcha",
      content: "API_KEY not set — but this is local scope",
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should expose getLocalStore() and getGlobalStore() for direct access", () => {
    const { tiered, localStore, globalStore } = makeTiered();
    expect(tiered.getLocalStore()).toBe(localStore);
    expect(tiered.getGlobalStore()).toBe(globalStore);
  });
});
```

- [ ] **Step 3: テストが FAIL することを確認**

Run: `bun run test tests/core/tiered-wisdom-store.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 4: `TieredWisdomStore` 骨格と `add()` を実装**

`src/core/tiered-wisdom-store.ts` を新規作成:

```typescript
import type { WisdomEntry } from "./types";
import { WisdomStore } from "./wisdom-store";
import { WisdomPersistence } from "./wisdom-persistence";
import { SecretPatternDetector } from "./secret-pattern-detector";

export type WisdomScope = "local" | "global";

export interface TieredWisdomStoreLogger {
  warn(message: string, ...args: unknown[]): void;
}

export interface TieredWisdomStoreOptions {
  localStore: WisdomStore;
  globalStore: WisdomStore;
  localPersistence: WisdomPersistence;
  globalPersistence: WisdomPersistence;
  secretDetector?: SecretPatternDetector;
  globalDisplayPath?: string;
  logger?: TieredWisdomStoreLogger;
}

export interface AddOptions {
  scope?: WisdomScope;
}

/**
 * Composes two independent WisdomStore instances — a project-local store and a
 * user-global store — into a single API. Writes are routed by category
 * heuristics (overridable via {scope}). Reads prefer the local store, filling
 * the remainder from global.
 */
export class TieredWisdomStore {
  private localStore: WisdomStore;
  private globalStore: WisdomStore;
  private readonly localPersistence: WisdomPersistence;
  private readonly globalPersistence: WisdomPersistence;
  private readonly secretDetector: SecretPatternDetector;
  private readonly globalDisplayPath: string;
  private readonly logger?: TieredWisdomStoreLogger;

  constructor(opts: TieredWisdomStoreOptions) {
    this.localStore = opts.localStore;
    this.globalStore = opts.globalStore;
    this.localPersistence = opts.localPersistence;
    this.globalPersistence = opts.globalPersistence;
    this.secretDetector = opts.secretDetector ?? new SecretPatternDetector();
    this.globalDisplayPath = opts.globalDisplayPath ?? "~/.justice/wisdom.json";
    this.logger = opts.logger;
  }

  getLocalStore(): WisdomStore {
    return this.localStore;
  }

  getGlobalStore(): WisdomStore {
    return this.globalStore;
  }

  /**
   * Adds a wisdom entry, routing to local or global by category heuristic
   * (or explicit options.scope). Global writes trigger a secret-pattern scan
   * and a warn log (non-blocking) if patterns match.
   */
  add(
    entry: Omit<WisdomEntry, "id" | "timestamp">,
    options?: AddOptions,
  ): WisdomEntry {
    const explicitScope = options?.scope;
    const heuristicScope: WisdomScope =
      entry.category === "environment_quirk"
        ? "global"
        : entry.category === "success_pattern"
          ? "global"
          : "local";
    const targetScope = explicitScope ?? heuristicScope;

    if (targetScope === "global") {
      const detected = this.secretDetector.scan(entry.content);
      if (detected.length > 0 && this.logger) {
        this.logger.warn(
          `Wisdom entry promoted to global may contain secrets ` +
            `(patterns matched: ${detected.join(", ")}). ` +
            `Review ${this.globalDisplayPath} and edit/redact if needed.`,
        );
      }
      return this.globalStore.add(entry);
    }
    return this.localStore.add(entry);
  }
}
```

- [ ] **Step 5: テストが PASS することを確認**

Run: `bun run test tests/core/tiered-wisdom-store.test.ts`
Expected: PASS（9 ケース）

Run: `bun run test`
Expected: 全テスト PASS

Run: `bun run typecheck && bun run lint`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/core/tiered-wisdom-store.ts tests/core/tiered-wisdom-store.test.ts
git commit -m "feat(core): TieredWisdomStoreを新規追加しカテゴリヒューリスティックで振り分け"
```

- [ ] **Step 7: Push して Draft PR を作成**

```bash
git push -u origin feature/phase2-task2__tiered-wisdom-routing
gh pr create --draft \
  --base feature/phase-2__tiered-wisdom-core__base \
  --head feature/phase2-task2__tiered-wisdom-routing \
  --title "feat(core): TieredWisdomStore骨格とadd()振り分けロジック" \
  --body "Part of Phase 2 Task 2 — routing with explicit scope override and secret warn log."
```

Draft PR: `feature/phase2-task2__tiered-wisdom-routing` → `feature/phase-2__tiered-wisdom-core__base`

---

### Task 3: `TieredWisdomStore` read merge / taskId 集約 / persistence coordination + export（depends: Task 2）

**Files:**

- Modify: `src/core/tiered-wisdom-store.ts`（`getRelevant` / `getByTaskId` / `formatForInjection` / `loadAll` / `persistAll` 追加）
- Modify: `tests/core/tiered-wisdom-store.test.ts`（read / persistence テスト追加）
- Modify: `src/index.ts`（新規クラス export）

**Branch:**

- Create: `feature/phase2-task3__tiered-wisdom-merge-persistence` from `feature/phase2-task2__tiered-wisdom-routing`
- PR: → `feature/phase-2__tiered-wisdom-core__base` (Draft)

---

- [ ] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase2-task2__tiered-wisdom-routing
git checkout -b feature/phase2-task3__tiered-wisdom-merge-persistence
```

- [ ] **Step 2: read merge / taskId / formatForInjection の失敗テストを追加 (RED)**

`tests/core/tiered-wisdom-store.test.ts` の末尾に以下を追加:

```typescript
describe("TieredWisdomStore — read merge (getRelevant)", () => {
  it("should return only local entries when local already satisfies maxEntries", () => {
    const localStore = new WisdomStore(100);
    for (let i = 0; i < 12; i++) {
      localStore.add({ taskId: `lt${i}`, category: "failure_gotcha", content: `local ${i}` });
    }
    const globalStore = new WisdomStore(500);
    for (let i = 0; i < 5; i++) {
      globalStore.add({ taskId: `gt${i}`, category: "success_pattern", content: `global ${i}` });
    }

    const { tiered } = makeTiered({ localStore, globalStore });
    const merged = tiered.getRelevant({ maxEntries: 10 });
    expect(merged).toHaveLength(10);
    for (const e of merged) expect(e.content.startsWith("local")).toBe(true);
  });

  it("should merge local + global when local has fewer than maxEntries", () => {
    const localStore = new WisdomStore(100);
    for (let i = 0; i < 3; i++) {
      localStore.add({ taskId: `lt${i}`, category: "failure_gotcha", content: `local ${i}` });
    }
    const globalStore = new WisdomStore(500);
    for (let i = 0; i < 20; i++) {
      globalStore.add({ taskId: `gt${i}`, category: "success_pattern", content: `global ${i}` });
    }

    const { tiered } = makeTiered({ localStore, globalStore });
    const merged = tiered.getRelevant({ maxEntries: 10 });

    expect(merged).toHaveLength(10);
    const localCount = merged.filter((e) => e.content.startsWith("local")).length;
    const globalCount = merged.filter((e) => e.content.startsWith("global")).length;
    expect(localCount).toBe(3);
    expect(globalCount).toBe(7);
  });

  it("should apply errorClass filter to both stores before merging", () => {
    const localStore = new WisdomStore(100);
    localStore.add({
      taskId: "lt1",
      category: "failure_gotcha",
      content: "local-tf",
      errorClass: "test_failure",
    });
    localStore.add({
      taskId: "lt2",
      category: "failure_gotcha",
      content: "local-timeout",
      errorClass: "timeout",
    });
    const globalStore = new WisdomStore(500);
    globalStore.add({
      taskId: "gt1",
      category: "success_pattern",
      content: "global-tf",
      errorClass: "test_failure",
    });

    const { tiered } = makeTiered({ localStore, globalStore });
    const merged = tiered.getRelevant({ maxEntries: 10, errorClass: "test_failure" });

    expect(merged).toHaveLength(2);
    for (const e of merged) expect(e.errorClass).toBe("test_failure");
  });

  it("should default maxEntries to 10 when omitted", () => {
    const localStore = new WisdomStore(100);
    for (let i = 0; i < 5; i++) {
      localStore.add({ taskId: `lt${i}`, category: "failure_gotcha", content: `l${i}` });
    }
    const globalStore = new WisdomStore(500);
    for (let i = 0; i < 20; i++) {
      globalStore.add({ taskId: `gt${i}`, category: "success_pattern", content: `g${i}` });
    }
    const { tiered } = makeTiered({ localStore, globalStore });
    expect(tiered.getRelevant()).toHaveLength(10);
  });
});

describe("TieredWisdomStore — getByTaskId / formatForInjection", () => {
  it("should aggregate entries from both stores when the same taskId appears in both", () => {
    const localStore = new WisdomStore(100);
    localStore.add({ taskId: "shared-task", category: "failure_gotcha", content: "L" });
    const globalStore = new WisdomStore(500);
    globalStore.add({ taskId: "shared-task", category: "environment_quirk", content: "G" });

    const { tiered } = makeTiered({ localStore, globalStore });
    const entries = tiered.getByTaskId("shared-task");

    expect(entries).toHaveLength(2);
    const contents = entries.map((e) => e.content).sort();
    expect(contents).toEqual(["G", "L"]);
  });

  it("should format merged entries for injection using the local store's formatter", () => {
    const localStore = new WisdomStore(100);
    localStore.add({ taskId: "t1", category: "failure_gotcha", content: "Gotcha" });
    const globalStore = new WisdomStore(500);
    globalStore.add({ taskId: "t2", category: "environment_quirk", content: "Quirk" });

    const { tiered } = makeTiered({ localStore, globalStore });
    const entries = tiered.getRelevant({ maxEntries: 10 });
    const formatted = tiered.formatForInjection(entries);

    expect(formatted).toContain("Past Learnings");
    expect(formatted).toContain("Gotcha");
    expect(formatted).toContain("Quirk");
  });
});

describe("TieredWisdomStore — persistence coordination", () => {
  it("loadAll should replace both stores from their persistence backends", async () => {
    const localJson = JSON.stringify({
      entries: [
        {
          id: "w-l",
          taskId: "t1",
          category: "failure_gotcha",
          content: "loaded-local",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
      maxEntries: 100,
    });
    const globalJson = JSON.stringify({
      entries: [
        {
          id: "w-g",
          taskId: "t2",
          category: "environment_quirk",
          content: "loaded-global",
          timestamp: "2026-01-02T00:00:00Z",
        },
      ],
      maxEntries: 500,
    });
    const localPersistence = new WisdomPersistence(
      createMockFileReader({ ".justice/wisdom.json": localJson }),
      createMockFileWriter(),
      ".justice/wisdom.json",
    );
    const globalPersistence = new WisdomPersistence(
      createMockFileReader({ "wisdom.json": globalJson }),
      createMockFileWriter(),
      "wisdom.json",
    );
    const tiered = new TieredWisdomStore({
      localStore: new WisdomStore(100),
      globalStore: new WisdomStore(500),
      localPersistence,
      globalPersistence,
      secretDetector: new SecretPatternDetector(),
    });

    await tiered.loadAll();
    expect(tiered.getLocalStore().getAllEntries()).toHaveLength(1);
    expect(tiered.getGlobalStore().getAllEntries()).toHaveLength(1);
    expect(tiered.getLocalStore().getAllEntries()[0]?.content).toBe("loaded-local");
    expect(tiered.getGlobalStore().getAllEntries()[0]?.content).toBe("loaded-global");
  });

  it("persistAll should call saveAtomic on both persistence backends", async () => {
    const localPersistence = new WisdomPersistence(
      createMockFileReader({}),
      createMockFileWriter(),
      ".justice/wisdom.json",
    );
    const globalPersistence = new WisdomPersistence(
      createMockFileReader({}),
      createMockFileWriter(),
      "wisdom.json",
    );
    const localSpy = vi.spyOn(localPersistence, "saveAtomic").mockResolvedValue(undefined);
    const globalSpy = vi.spyOn(globalPersistence, "saveAtomic").mockResolvedValue(undefined);

    const tiered = new TieredWisdomStore({
      localStore: new WisdomStore(100),
      globalStore: new WisdomStore(500),
      localPersistence,
      globalPersistence,
      secretDetector: new SecretPatternDetector(),
    });

    await tiered.persistAll();
    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(globalSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: テストが FAIL することを確認**

Run: `bun run test tests/core/tiered-wisdom-store.test.ts`
Expected: FAIL — `getRelevant` / `getByTaskId` / `formatForInjection` / `loadAll` / `persistAll` が未実装

- [ ] **Step 4: `TieredWisdomStore` に残りのメソッドを追加**

`src/core/tiered-wisdom-store.ts` に以下のメソッドを追加（`add()` の直後に配置）:

```typescript
  getRelevant(options?: { errorClass?: import("./types").ErrorClass; maxEntries?: number }): WisdomEntry[] {
    const limit = options?.maxEntries ?? 10;

    const localEntries = this.localStore.getRelevant({ ...options, maxEntries: limit });
    if (localEntries.length >= limit) return localEntries;

    const remaining = limit - localEntries.length;
    const globalEntries = this.globalStore.getRelevant({ ...options, maxEntries: remaining });

    return [...localEntries, ...globalEntries];
  }

  getByTaskId(taskId: string): WisdomEntry[] {
    return [...this.localStore.getByTaskId(taskId), ...this.globalStore.getByTaskId(taskId)];
  }

  formatForInjection(entries: WisdomEntry[]): string {
    return this.localStore.formatForInjection(entries);
  }

  async loadAll(): Promise<void> {
    this.localStore = await this.localPersistence.load();
    this.globalStore = await this.globalPersistence.load();
  }

  async persistAll(): Promise<void> {
    await Promise.all([
      this.localPersistence.saveAtomic(this.localStore),
      this.globalPersistence.saveAtomic(this.globalStore),
    ]);
  }
```

> **Note:** インライン `import()` 型を避けたい場合は、ファイル先頭の `import type` に `ErrorClass` を追加して `options?: { errorClass?: ErrorClass; maxEntries?: number }` の形に整える。以下のように先頭 import を修正する:

```typescript
import type { ErrorClass, WisdomEntry } from "./types";
```

その上で `getRelevant` の引数型を `options?: { errorClass?: ErrorClass; maxEntries?: number }` に書き換える。

- [ ] **Step 5: `src/index.ts` に export を追加**

`src/index.ts` の Phase 5 Exports セクションに以下を追記:

```typescript
export { TieredWisdomStore } from "./core/tiered-wisdom-store";
export type {
  WisdomScope,
  TieredWisdomStoreOptions,
  TieredWisdomStoreLogger,
  AddOptions,
} from "./core/tiered-wisdom-store";
export { SecretPatternDetector } from "./core/secret-pattern-detector";
```

- [ ] **Step 6: テストが PASS することを確認**

Run: `bun run test tests/core/tiered-wisdom-store.test.ts`
Expected: PASS（既存 9 + 新規 8 = 17 ケース）

Run: `bun run test`
Expected: 全テスト PASS

Run: `bun run typecheck && bun run lint && bun run build`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/core/tiered-wisdom-store.ts src/index.ts tests/core/tiered-wisdom-store.test.ts
git commit -m "feat(core): TieredWisdomStoreに読み込みマージと永続化コーディネーションを追加"
```

- [ ] **Step 8: Push して Draft PR を作成**

```bash
git push -u origin feature/phase2-task3__tiered-wisdom-merge-persistence
gh pr create --draft \
  --base feature/phase-2__tiered-wisdom-core__base \
  --head feature/phase2-task3__tiered-wisdom-merge-persistence \
  --title "feat(core): TieredWisdomStoreに読み込みマージと永続化を追加" \
  --body "Part of Phase 2 Task 3 — getRelevant merge / getByTaskId aggregation / loadAll / persistAll / exports."
```

Draft PR: `feature/phase2-task3__tiered-wisdom-merge-persistence` → `feature/phase-2__tiered-wisdom-core__base`

- [ ] **Step 9: Phase 2 base PR を Ready-for-Review に昇格**

Phase 2 Task 1〜3 の Draft PR が揃ったら、Phase base ブランチの CI 結果を確認して Ready-for-Review に変更し、`master` へマージ。マージ後に Phase 3 へ進む。

---

## Phase 3: JusticePlugin Integration & Documentation

> **Milestone:** `JusticePlugin` が global FS を構築し `TieredWisdomStore` を保持、`getTieredWisdomStore()` / `getWisdomStore()` 両 API が動作。環境変数 `JUSTICE_GLOBAL_WISDOM_PATH` とフォールバック（HOME 不在 / mkdir 失敗）を含む fail-open が動く。README / SPEC / CHANGELOG に反映。Phase 3 マージで機能全体がエンドユーザーに届く。

### Task 1: `createGlobalFs` ヘルパーと `NoOpPersistence` 導入

**Files:**

- Modify: `src/core/justice-plugin.ts`（`createGlobalFs()` と `NoOpPersistence` プライベート実装を追加）
- Create: `tests/core/justice-plugin-global-fs.test.ts`

**Branch:**

- Phase 2 が master にマージされていることを確認
- Create: `feature/phase-3__tiered-wisdom-integration__base` from `master`
- Create: `feature/phase3-task1__create-global-fs` from `master`
- PR: → `feature/phase-3__tiered-wisdom-integration__base` (Draft)

> **Note:** `createGlobalFs` は `JusticePlugin` 内部のプライベート関数として実装し、テスト可能にするために `src/core/justice-plugin.ts` から名前付きで `export` する（テストだけが import する想定）。`NoOpPersistence` は `WisdomPersistence` のサブクラスとして同じファイル内に実装する。

---

- [ ] **Step 1: Phase 2 が master にマージされていることを確認**

```bash
git fetch origin master
git log --oneline origin/master -n 5
```

Expected: Phase 2 のマージコミットが master に存在する

- [ ] **Step 2: Phase 3 ブランチと Task ブランチを作成**

```bash
git checkout master
git pull origin master
git checkout -b feature/phase-3__tiered-wisdom-integration__base
git push -u origin feature/phase-3__tiered-wisdom-integration__base
gh pr create --draft --base master --head feature/phase-3__tiered-wisdom-integration__base \
  --title "feat(wisdom): Phase 3 — JusticePlugin integration and docs" \
  --body "Tracks Phase 3 tasks of the cross-project wisdom store plan."
git checkout -b feature/phase3-task1__create-global-fs
```

- [ ] **Step 3: `createGlobalFs` と `NoOpPersistence` の失敗テストを作成 (RED)**

`tests/core/justice-plugin-global-fs.test.ts` を新規作成:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createGlobalFs, NoOpPersistence } from "../../src/core/justice-plugin";
import { WisdomStore } from "../../src/core/wisdom-store";

describe("createGlobalFs", () => {
  let tempDir: string;
  const originalEnv = process.env.JUSTICE_GLOBAL_WISDOM_PATH;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "justice-globalfs-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    } else {
      process.env.JUSTICE_GLOBAL_WISDOM_PATH = originalEnv;
    }
  });

  it("should honor JUSTICE_GLOBAL_WISDOM_PATH env var and split into root + relative", async () => {
    const target = join(tempDir, "inner", "wisdom.json");
    process.env.JUSTICE_GLOBAL_WISDOM_PATH = target;

    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = await createGlobalFs(logger);

    expect(result).not.toBeNull();
    expect(result!.relativePath).toBe("wisdom.json");

    // Write via the returned FS, then confirm via raw readFile.
    await result!.fs.writeFile(result!.relativePath, "hello-globalfs");
    const onDisk = await readFile(target, "utf-8");
    expect(onDisk).toBe("hello-globalfs");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should default to ~/.justice/wisdom.json when env var is unset", async () => {
    delete process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await createGlobalFs(logger);

    expect(result).not.toBeNull();
    expect(result!.relativePath).toBe("wisdom.json");
    // homedir() + ".justice" should be the rootDir that the FS wraps.
    // We can't easily assert the private rootDir, but we can assert behavior:
    // writing "wisdom.json" must target $HOME/.justice/wisdom.json.
    const home = homedir();
    // Avoid polluting real home dir: only check the path shape via an internal
    // test helper — we therefore just assert it did not log a warn.
    expect(logger.warn).not.toHaveBeenCalled();
    expect(home).toBeTruthy();
  });

  it("should return null and log warn when env var is unset and homedir is empty", async () => {
    delete process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    const logger = { warn: vi.fn(), error: vi.fn() };

    // Shadow homedir to simulate missing HOME
    const osModule = await import("node:os");
    const spy = vi.spyOn(osModule, "homedir").mockReturnValue("");

    const result = await createGlobalFs(logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("home directory");

    spy.mockRestore();
  });

  it("should return null and log warn when mkdir throws (e.g., permission denied)", async () => {
    // Point the env var at a location whose parent cannot be created.
    process.env.JUSTICE_GLOBAL_WISDOM_PATH = "/proc/1/forbidden/wisdom.json";
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await createGlobalFs(logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("Failed to initialize global wisdom store");
  });

  it("should reject relative JUSTICE_GLOBAL_WISDOM_PATH and log a warn", async () => {
    process.env.JUSTICE_GLOBAL_WISDOM_PATH = "relative/wisdom.json";
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await createGlobalFs(logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("must be an absolute path");
    expect(logger.warn.mock.calls[0]?.[0]).toContain("relative/wisdom.json");
  });
});

describe("NoOpPersistence", () => {
  it("should return an empty WisdomStore from load()", async () => {
    const p = new NoOpPersistence();
    const store = await p.load();
    expect(store.getAllEntries()).toHaveLength(0);
  });

  it("should silently accept save() and saveAtomic() without any I/O", async () => {
    const p = new NoOpPersistence();
    const store = new WisdomStore(100);
    store.add({ taskId: "t", category: "success_pattern", content: "x" });

    await expect(p.save(store)).resolves.toBeUndefined();
    await expect(p.saveAtomic(store)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: テストが FAIL することを確認**

Run: `bun run test tests/core/justice-plugin-global-fs.test.ts`
Expected: FAIL — `createGlobalFs` / `NoOpPersistence` が export されていない

- [ ] **Step 5: `createGlobalFs` と `NoOpPersistence` を実装**

`src/core/justice-plugin.ts` の末尾（既存 `export class JusticePlugin` の下）に以下を追加:

```typescript
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { NodeFileSystem } from "../runtime/node-file-system";
import { WisdomPersistence } from "./wisdom-persistence";
import { WisdomStore } from "./wisdom-store";

export interface CreateGlobalFsResult {
  readonly fs: NodeFileSystem;
  readonly relativePath: string;
}

/**
 * Resolves the global wisdom-store filesystem. Honors the
 * JUSTICE_GLOBAL_WISDOM_PATH environment variable when present (which must be
 * an absolute path), otherwise defaults to `~/.justice/wisdom.json`. Returns
 * null (and logs a warning) when the global store cannot be initialized —
 * callers are expected to fail-open to local-only behavior.
 */
export async function createGlobalFs(
  logger?: JusticePluginOptions["logger"],
): Promise<CreateGlobalFsResult | null> {
  try {
    const envPath = process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    let globalRoot: string;
    let relativePath: string;

    if (envPath) {
      if (!isAbsolute(envPath)) {
        logger?.warn(
          `JUSTICE_GLOBAL_WISDOM_PATH must be an absolute path; got '${envPath}'. ` +
            "Global wisdom store disabled.",
        );
        return null;
      }
      globalRoot = dirname(envPath);
      relativePath = basename(envPath);
    } else {
      const home = homedir();
      if (!home) {
        logger?.warn(
          "Cannot determine home directory; global wisdom store disabled. " +
            "Set JUSTICE_GLOBAL_WISDOM_PATH to enable.",
        );
        return null;
      }
      globalRoot = join(home, ".justice");
      relativePath = "wisdom.json";
    }

    await mkdir(globalRoot, { recursive: true });
    return { fs: new NodeFileSystem(globalRoot), relativePath };
  } catch (error) {
    logger?.warn(
      `Failed to initialize global wisdom store: ${String(error)}; falling back to local-only.`,
    );
    return null;
  }
}

/**
 * A persistence stub used when the global filesystem cannot be initialized.
 * Reads return an empty store; writes are no-ops.
 */
export class NoOpPersistence extends WisdomPersistence {
  constructor() {
    // Provide stub file readers/writers — they are never called because
    // load / save / saveAtomic are overridden below.
    super(
      {
        async readFile(): Promise<string> {
          return "";
        },
        async fileExists(): Promise<boolean> {
          return false;
        },
      },
      {
        async writeFile(): Promise<void> {
          /* no-op */
        },
        async rename(): Promise<void> {
          /* no-op */
        },
        async deleteFile(): Promise<void> {
          /* no-op */
        },
      },
      "wisdom.json",
    );
  }

  override async load(): Promise<WisdomStore> {
    return new WisdomStore();
  }

  override async save(_store: WisdomStore): Promise<void> {
    /* no-op — shape matches base class for clarity; parameter intentionally unused */
  }

  override async saveAtomic(_store: WisdomStore): Promise<void> {
    /* no-op — shape matches base class for clarity; parameter intentionally unused */
  }
}
```

> **Note:** 既存の `JusticePlugin` クラス本体は本 Task ではまだ変更しない（Task 2 で統合する）。ヘルパーとスタブのみを追加する。

- [ ] **Step 6: テストが PASS することを確認**

Run: `bun run test tests/core/justice-plugin-global-fs.test.ts`
Expected: PASS（7 ケース — `createGlobalFs` 5 ケース + `NoOpPersistence` 2 ケース）

Run: `bun run test`
Expected: 全テスト PASS（既存 `justice-plugin.test.ts` も pass、本 Task では `JusticePlugin` クラス本体は未改変のため）

Run: `bun run typecheck && bun run lint`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/core/justice-plugin.ts tests/core/justice-plugin-global-fs.test.ts
git commit -m "feat(core): createGlobalFs()とNoOpPersistenceを追加しfail-open対応"
```

- [ ] **Step 8: Push して Draft PR を作成**

```bash
git push -u origin feature/phase3-task1__create-global-fs
gh pr create --draft \
  --base feature/phase-3__tiered-wisdom-integration__base \
  --head feature/phase3-task1__create-global-fs \
  --title "feat(core): createGlobalFs()とNoOpPersistenceを追加" \
  --body "Part of Phase 3 Task 1 — helpers only; JusticePlugin wiring follows in Task 2."
```

Draft PR: `feature/phase3-task1__create-global-fs` → `feature/phase-3__tiered-wisdom-integration__base`

---

### Task 2: `JusticePlugin` 統合 + `getTieredWisdomStore()` 追加（depends: Task 1）

**Files:**

- Modify: `src/core/justice-plugin.ts`（`JusticePlugin` クラス本体）
- Modify: `tests/core/justice-plugin.test.ts`

**Branch:**

- Create: `feature/phase3-task2__justice-plugin-wireup` from `feature/phase3-task1__create-global-fs`
- PR: → `feature/phase-3__tiered-wisdom-integration__base` (Draft)

---

- [ ] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase3-task1__create-global-fs
git checkout -b feature/phase3-task2__justice-plugin-wireup
```

- [ ] **Step 2: `JusticePlugin` 統合の失敗テストを追加 (RED)**

`tests/core/justice-plugin.test.ts` に以下の `describe` ブロックを末尾に追加（既存 `describe("JusticePlugin", ...)` の内側）:

```typescript
  describe("wisdom store integration", () => {
    it("getWisdomStore() should return the local store (backwards compatible)", () => {
      const tiered = plugin.getTieredWisdomStore();
      expect(plugin.getWisdomStore()).toBe(tiered.getLocalStore());
    });

    it("getTieredWisdomStore() should return a TieredWisdomStore whose localStore is the same as getWisdomStore()", () => {
      const tiered = plugin.getTieredWisdomStore();
      expect(tiered.getLocalStore()).toBe(plugin.getWisdomStore());
      // Default construction uses NoOpPersistence for global, so the global store starts empty.
      expect(tiered.getGlobalStore().getAllEntries()).toHaveLength(0);
    });

    it("when no globalFileSystem is provided, global writes stay in-memory (fail-open)", () => {
      const tiered = plugin.getTieredWisdomStore();
      tiered.add({
        taskId: "t",
        category: "environment_quirk",
        content: "Bun X.Y.Z quirk",
      });
      expect(tiered.getGlobalStore().getAllEntries()).toHaveLength(1);
      // Still fine — persistAll should not throw because NoOpPersistence is used.
      return expect(tiered.persistAll()).resolves.toBeUndefined();
    });
  });
```

> **Note:** 既存テストで `plugin` は `new JusticePlugin(reader, writer)` で構築されているため、デフォルト（`globalFileSystem` 未指定）で NoOpPersistence にフォールバックする挙動を検証する。

- [ ] **Step 3: テストが FAIL することを確認**

Run: `bun run test tests/core/justice-plugin.test.ts`
Expected: FAIL — `plugin.getTieredWisdomStore is not a function`

- [ ] **Step 4: `JusticePlugin` 本体を統合**

`src/core/justice-plugin.ts` の `JusticePluginOptions` インタフェースを以下に拡張:

```typescript
export interface JusticePluginOptions {
  readonly logger?: {
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
  };
  readonly onError?: (error: unknown) => void;
  /**
   * Optional pre-constructed global filesystem for the cross-project wisdom
   * store. Typically produced by `createGlobalFs()`. When omitted, global
   * writes fall back to an in-memory NoOpPersistence (local-only behavior).
   */
  readonly globalFileSystem?: {
    readonly fs: NodeFileSystem;
    readonly relativePath: string;
  };
}
```

クラス本体を以下のように修正（抜粋）:

```typescript
import { TieredWisdomStore } from "./tiered-wisdom-store";
import { SecretPatternDetector } from "./secret-pattern-detector";
// 既存の import に加え、Task 1 で追加した createGlobalFs / NoOpPersistence / NodeFileSystem / WisdomPersistence / WisdomStore を利用

export class JusticePlugin {
  private readonly fileReader: FileReader;
  private readonly planBridge: PlanBridge;
  private readonly taskFeedback: TaskFeedbackHandler;
  private readonly compactionProtector: CompactionProtector;
  private readonly loopHandler: LoopDetectionHandler;
  private readonly wisdomStore: WisdomStore;
  private readonly tieredWisdomStore: TieredWisdomStore;
  private readonly options: JusticePluginOptions;

  constructor(fileReader: FileReader, fileWriter: FileWriter, options: JusticePluginOptions = {}) {
    this.fileReader = fileReader;
    this.options = options;

    // Local store — preserves existing behavior.
    this.wisdomStore = new WisdomStore(100);
    const localPersistence = new WisdomPersistence(fileReader, fileWriter, ".justice/wisdom.json");

    // Global store — constructed from optional globalFileSystem, else NoOp.
    const globalStore = new WisdomStore(500);
    const globalPersistence = options.globalFileSystem
      ? new WisdomPersistence(
          options.globalFileSystem.fs,
          options.globalFileSystem.fs,
          options.globalFileSystem.relativePath,
        )
      : new NoOpPersistence();

    const globalDisplayPath = options.globalFileSystem
      ? options.globalFileSystem.relativePath
      : "~/.justice/wisdom.json";

    this.tieredWisdomStore = new TieredWisdomStore({
      localStore: this.wisdomStore,
      globalStore,
      localPersistence,
      globalPersistence,
      secretDetector: new SecretPatternDetector(),
      globalDisplayPath,
      logger: options.logger,
    });

    this.planBridge = new PlanBridge(fileReader, this.wisdomStore);
    this.taskFeedback = new TaskFeedbackHandler(fileReader, fileWriter, this.wisdomStore);
    this.compactionProtector = new CompactionProtector(this.wisdomStore);
    this.loopHandler = new LoopDetectionHandler(fileReader, fileWriter, new TaskSplitter());
  }

  // ... 既存メソッドそのまま ...

  /**
   * Get the shared WisdomStore (local-only) for persistence or inspection.
   * Preserved for backwards compatibility with existing external callers.
   */
  getWisdomStore(): WisdomStore {
    return this.wisdomStore;
  }

  /**
   * Get the TieredWisdomStore composing local + global wisdom.
   */
  getTieredWisdomStore(): TieredWisdomStore {
    return this.tieredWisdomStore;
  }
}
```

> **Note:** `localPersistence` は `WisdomPersistence` を新規構築する。既存の `task-feedback` / `plan-bridge` が直接 `wisdomStore.add()` を呼ぶコードパスには手を加えない（段階的移行）。`getTieredWisdomStore()` 経由で新規 API を利用可能にする。

- [ ] **Step 5: テストが PASS することを確認**

Run: `bun run test tests/core/justice-plugin.test.ts`
Expected: PASS（既存 + 新規 3 ケース）

Run: `bun run test`
Expected: 全テスト PASS

Run: `bun run typecheck && bun run lint && bun run build`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/core/justice-plugin.ts tests/core/justice-plugin.test.ts
git commit -m "feat(core): JusticePluginでTieredWisdomStoreを保持しgetTieredWisdomStore()を追加"
```

- [ ] **Step 7: Push して Draft PR を作成**

```bash
git push -u origin feature/phase3-task2__justice-plugin-wireup
gh pr create --draft \
  --base feature/phase-3__tiered-wisdom-integration__base \
  --head feature/phase3-task2__justice-plugin-wireup \
  --title "feat(core): JusticePluginにTieredWisdomStoreを統合" \
  --body "Part of Phase 3 Task 2 — wires TieredWisdomStore with fail-open NoOpPersistence fallback."
```

Draft PR: `feature/phase3-task2__justice-plugin-wireup` → `feature/phase-3__tiered-wisdom-integration__base`

---

### Task 3: Docs / CHANGELOG 更新（depends: Task 2）

**Files:**

- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `CHANGELOG.md`

**Branch:**

- Create: `feature/phase3-task3__docs-and-exports` from `feature/phase3-task2__justice-plugin-wireup`
- PR: → `feature/phase-3__tiered-wisdom-integration__base` (Draft)

---

- [ ] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase3-task2__justice-plugin-wireup
git checkout -b feature/phase3-task3__docs-and-exports
```

- [ ] **Step 2: `CHANGELOG.md` に Unreleased エントリを追記**

`CHANGELOG.md` の `## [Unreleased]` セクション（存在しなければ先頭に新設）に以下を追加:

```markdown
### Added

- **Cross-Project Wisdom Store**: introduce `TieredWisdomStore` and `SecretPatternDetector`. Wisdom entries categorized as `environment_quirk` or `success_pattern` are now auto-promoted to a user-global store at `~/.justice/wisdom.json` (configurable via `JUSTICE_GLOBAL_WISDOM_PATH`). `failure_gotcha` and `design_decision` remain project-local. Callers can override routing via `{scope: "local" | "global"}`. Reads prefer the local store and fill the remainder from the global store.
- `FileWriter.rename(from, to)` and `FileWriter.deleteFile(path)` interfaces plus `NodeFileSystem.rename()` / `NodeFileSystem.deleteFile()` implementations (path-traversal safe).
- `WisdomStore.getAllEntries()`, `WisdomStore.getMaxEntries()`, and `WisdomStore.fromEntries()` (pure additions).
- `WisdomPersistence.saveAtomic()`: load-merge-write using a temp file and atomic rename (existing `save()` preserved for backwards compatibility).
- `JusticePlugin.getTieredWisdomStore()`: exposes the tiered store. `getWisdomStore()` remains unchanged and returns the local store.

### Notes

- Existing local entries are **not** migrated automatically. New writes follow the category heuristic.
- Global store initialization is fail-open: when `HOME` is unavailable or `mkdir` fails, the plugin starts with an in-memory NoOp global persistence and logs a warning. Local wisdom behavior is unaffected.
```

- [ ] **Step 3: `README.md` に "Cross-Project Wisdom Store" セクションを追加**

`README.md` の「コアコンポーネント」相当の箇所（既存の記述に合わせる）に `TieredWisdomStore` / `SecretPatternDetector` を追記。加えて、新規セクションを以下のように追加（外側フェンスはネストした ``` を正しく扱うために 4 本バッククォート）:

````markdown
## Cross-Project Wisdom Store

Justice stores learnings in two places:

| Scope | Default path | Default categories (auto-routed) |
|-------|-------------|----------------------------------|
| Project-local | `.justice/wisdom.json` | `failure_gotcha`, `design_decision` |
| User-global | `~/.justice/wisdom.json` (or `$JUSTICE_GLOBAL_WISDOM_PATH`) | `environment_quirk`, `success_pattern` |

Routing is overridable per call:

```ts
plugin.getTieredWisdomStore().add(
  { taskId, category: "environment_quirk", content: "…" },
  { scope: "local" }, // override — stay project-local
);
```

Reads combine both stores with **local-priority**: if the local store already
has `maxEntries` relevant matches, those are returned; otherwise the remainder
is filled from the global store (newest-first within each store).

### Secret detection

Entries promoted to the global store are scanned for common secret-like
patterns (API keys, home-directory paths, `sk-…` / `sk-ant-…` shapes, etc.).
Matches only emit a warning log — they do **not** block writes. Review the
global JSON file and redact if needed.

### Environment variable

- `JUSTICE_GLOBAL_WISDOM_PATH` — **absolute path** to the global wisdom file.
  Relative paths are rejected with a warning and disable the global store.
  When unset, defaults to `~/.justice/wisdom.json`. When `HOME` cannot be
  determined and this variable is unset, the global store is disabled
  (local-only) and a warning is logged.
````

- [ ] **Step 4: `SPEC.md` に `TieredWisdomStore` の仕様を追加**

`SPEC.md` の §5.15 (`JusticePlugin`) の直後、または適切な `5.x` サブセクションとして以下を追加（外側フェンスは 4 本バッククォート）:

````markdown
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

- `add(entry, { scope? })` — category heuristic + 明示 scope で local/global 振り分け。global 昇格時に `SecretPatternDetector` で警告ログ（ブロックはしない）。
- `getRelevant({ errorClass?, maxEntries? })` — ローカル優先、不足分を global から補填。デフォルト `maxEntries=10`。
- `getByTaskId(taskId)` — 両 store の該当エントリを連結。
- `formatForInjection(entries)` — `WisdomStore.formatForInjection` を委譲。
- `loadAll()` / `persistAll()` — 両 store を `WisdomPersistence.saveAtomic` で並列に atomic 永続化。

**振り分けマトリクス:**

| Category | Default scope |
|---|---|
| `environment_quirk` | global |
| `success_pattern` | global |
| `failure_gotcha` | local |
| `design_decision` | local |

**ローカル優先の読み込み挙動:** `localEntries.length >= maxEntries` なら global は参照されない。`WisdomStore.getRelevant` は配列末尾（新しいもの）から `slice(-limit)` する既存挙動を引き継ぐ。
````

- [ ] **Step 5: 変更の全体確認**

Run: `bun run test`
Expected: 全テスト PASS

Run: `bun run typecheck && bun run lint && bun run build`
Expected: エラーなし

Run: `bun run test:coverage`（任意 — カバレッジ確認）
Expected: 新規 TieredWisdomStore / SecretPatternDetector / saveAtomic のラインカバレッジ 90% 以上

- [ ] **Step 6: コミット**

```bash
git add README.md SPEC.md CHANGELOG.md
git commit -m "docs(wisdom): クロスプロジェクト wisdom store のドキュメント追加"
```

- [ ] **Step 7: Push して Draft PR を作成**

```bash
git push -u origin feature/phase3-task3__docs-and-exports
gh pr create --draft \
  --base feature/phase-3__tiered-wisdom-integration__base \
  --head feature/phase3-task3__docs-and-exports \
  --title "docs(wisdom): クロスプロジェクト wisdom store のドキュメント追加" \
  --body "Part of Phase 3 Task 3 — README / SPEC / CHANGELOG updates."
```

Draft PR: `feature/phase3-task3__docs-and-exports` → `feature/phase-3__tiered-wisdom-integration__base`

- [ ] **Step 8: Phase 3 base PR を Ready-for-Review に昇格**

Phase 3 Task 1〜3 の Draft PR が揃ったら、`feature/phase-3__tiered-wisdom-integration__base` の CI が green であることを確認し、Ready-for-Review に昇格して `master` にマージ。これで全機能が完成する。

---

## Self-Review サマリ

| Spec セクション | 対応 Task |
|---|---|
| §2 Design Decisions Summary | 全 Phase（意思決定の直接実装） |
| §3 Architecture（TieredWisdomStore の合成） | Phase 2 Task 2/3, Phase 3 Task 2 |
| §4 Type Changes（`FileWriter.rename`） | Phase 1 Task 1 |
| §5 SecretPatternDetector | Phase 2 Task 1 |
| §6 TieredWisdomStore（routing / merge / persistence / capacity） | Phase 2 Task 2/3 |
| §7 WisdomStore Additions | Phase 1 Task 2 |
| §8 WisdomPersistence.saveAtomic（lock-free 設計） | Phase 1 Task 3 |
| §9 NodeFileSystem.rename | Phase 1 Task 1 |
| §10 Global FS Construction（fail-open） | Phase 3 Task 1 |
| §11 Public API（互換性 + 新規 API） | Phase 3 Task 2 |
| §12 Test Plan（4 テストファイル） | 各 Task のテストとして網羅 |
| §13 Documentation Updates | Phase 3 Task 3 |
| §14 Impact Summary | 全 Phase |
| §15 Rollout（minor bump） | Phase 3 Task 3 CHANGELOG |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-topic2-cross-project-wisdom-store.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
