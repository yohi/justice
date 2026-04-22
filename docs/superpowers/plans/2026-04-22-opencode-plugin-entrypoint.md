# OpenCode Plugin Entrypoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@yohi/justice` を OpenCode が公式に読み込める単一パッケージ形式のプラグインとして配布できるようにするため、`@yohi/justice/opencode` サブパスエクスポートと `OpenCodePlugin` 関数・`OpenCodeAdapter` を追加する。既存の OmO カスタムフック経路は後方互換のまま維持する。

**Architecture:** Pure Core 層 (`src/core/*.ts`) は OpenCode SDK を import 禁止。新規 `src/runtime/opencode-adapter.ts` のみが OpenCode ↔ `HookEvent` の双方向変換を担い、`src/opencode-plugin.ts` が薄い配線エントリとして `Plugin` 型契約を満たす。全フック境界で try/catch により Fail-Open を保証し、`justice.initialize()` は初回フックアクセス時の lazy 起動とする。

**Tech Stack:** TypeScript 6.x / ESM / `bun` (package manager + runner) / `vitest` 4 (test) / `tsc` (typecheck + build) / `eslint` 10 + `typescript-eslint` 8 / `@opencode-ai/plugin` (devDep + peerDep, type only)

**Branching Strategy:** 本計画は `docs/superpowers/specs/2026-04-22-opencode-plugin-entrypoint-design.md` に基づき、2 Phase 構成。CI (`.github/workflows/ci.yml`) は既存で master トリガ + `ubuntu-slim` を利用済みのため Phase 0 は不要。

---

## Phase 構成と PR 戦略

| Phase | 目的 | Base ブランチ | Phase ブランチ | PR ターゲット |
|---|---|---|---|---|
| Phase 1 | Foundation (pure core module + lint guard + peer dep) | `master` | `feature/phase1__opencode-plugin__base` | `master` (Draft) |
| Phase 2 | OpenCode Plugin 本体 (Adapter + Entry + Tests + Docs + Packaging) | `master` | `feature/phase2__opencode-plugin__base` | `master` (Draft) |

**運用ルール:**

- 各 Phase ブランチは必ず `master` から派生する
- Phase 2 は Phase 1 の master マージ完了後にのみ開始する
- Phase 内の Task ブランチは直前 Task ブランチから派生（PR 完了待ちは不要）
- 各 Task 完了時に **所属 Phase ブランチをベースとする Draft PR** を必ず作成する

---

## Phase 1: Foundation (loop-error-patterns + lint guard)

**目的:** OpenCode Plugin 本体の導入前に、純粋な副作用フリーの基盤を先行マージする。具体的には (1) ループ検出用パターンモジュール (pure core) の追加、(2) Core 層の OpenCode SDK 依存漏れを防ぐ ESLint ガード、(3) `@opencode-ai/plugin` を devDependency + peerDependency に追加。

**Phase ブランチ作成:**

```bash
git checkout master
git pull origin master
git checkout -b feature/phase1__opencode-plugin__base
git push -u origin feature/phase1__opencode-plugin__base
gh pr create --draft --base master --head feature/phase1__opencode-plugin__base \
  --title "Phase 1: Foundation for OpenCode plugin entrypoint" \
  --body "draft — will be filled as tasks land"
```

### Task 1.1: `@opencode-ai/plugin` 依存追加

**Branch:** `feature/phase1-task1__add-opencode-plugin-dep` (from `feature/phase1__opencode-plugin__base`)

**Files:**
- Modify: `package.json`
- Modify: `bun.lock` (auto-generated)

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1__opencode-plugin__base
git checkout -b feature/phase1-task1__add-opencode-plugin-dep
```

- [ ] **Step 2: `@opencode-ai/plugin` の最新バージョンを調査**

```bash
bun info @opencode-ai/plugin version 2>&1 | tail -5
```

期待値: 正常に最新バージョン (例: `0.x.y`) が表示される。
失敗時 (パッケージ未発見): 設計仕様書 Section 12 (未決事項) に記載のとおり、公式ドキュメント `https://raw.githubusercontent.com/anomalyco/opencode/refs/heads/dev/packages/web/src/content/docs/ja/plugins.mdx` を再確認し、正式名を修正した上で再実行する。

- [ ] **Step 3: devDependency として追加**

```bash
bun add -D @opencode-ai/plugin
```

- [ ] **Step 4: peerDependency として追記**

`package.json` の `peerDependencies` セクションを以下に更新:

```json
"peerDependencies": {
  "typescript": "^6.0.2",
  "@opencode-ai/plugin": "*"
}
```

※ Step 2 で得たバージョンから caret range (`^X.Y.Z`) を後続タスクで置換。Phase 1 では最小侵襲で `*` を設定する。

- [ ] **Step 5: typecheck が通ることを確認**

Run: `bun run typecheck`
Expected: エラーなし (新ファイルはまだ追加されていないため既存コードが変わらず通る)

- [ ] **Step 6: コミット**

```bash
git add package.json bun.lock
git commit -m "build(deps): add @opencode-ai/plugin as dev+peer dependency"
```

- [ ] **Step 7: push + Draft PR 作成**

```bash
git push -u origin feature/phase1-task1__add-opencode-plugin-dep
gh pr create --draft \
  --base feature/phase1__opencode-plugin__base \
  --head feature/phase1-task1__add-opencode-plugin-dep \
  --title "Phase1 Task1: add @opencode-ai/plugin as dev+peer dependency" \
  --body "Adds the OpenCode Plugin SDK as a devDependency and peerDependency so later tasks can import types. No runtime impact."
```

---

### Task 1.2: `LoopErrorPatterns` モジュール追加 (TDD)

**Branch:** `feature/phase1-task2__loop-error-patterns` (from `feature/phase1-task1__add-opencode-plugin-dep`)

**Files:**
- Create: `src/core/loop-error-patterns.ts`
- Create: `tests/core/loop-error-patterns.test.ts`
- Modify: `src/index.ts` (add named export)

既存ファイル `src/core/provider-error-patterns.ts` と同一スタイル (Object.freeze された RegExp 配列 + 純粋関数) で実装する。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1-task1__add-opencode-plugin-dep
git checkout -b feature/phase1-task2__loop-error-patterns
```

- [ ] **Step 2: 失敗する単体テストを書く**

Create `tests/core/loop-error-patterns.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { LOOP_ERROR_PATTERNS, matchesLoopError } from "../../src/core/loop-error-patterns";

describe("LOOP_ERROR_PATTERNS", () => {
  it("is a frozen array of RegExp", () => {
    expect(Array.isArray(LOOP_ERROR_PATTERNS)).toBe(true);
    expect(Object.isFrozen(LOOP_ERROR_PATTERNS)).toBe(true);
    for (const pattern of LOOP_ERROR_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

describe("matchesLoopError", () => {
  it("returns true for 'loop detected' (lowercase)", () => {
    expect(matchesLoopError("loop detected in agent run")).toBe(true);
  });

  it("returns true for 'Loop Detect' (mixed case)", () => {
    expect(matchesLoopError("Loop Detect: halting")).toBe(true);
  });

  it("returns true for 'infinite loop'", () => {
    expect(matchesLoopError("encountered an infinite loop")).toBe(true);
  });

  it("returns true for 'repetition limit'", () => {
    expect(matchesLoopError("repetition limit exceeded")).toBe(true);
  });

  it("returns true for 'repeated tool calls'", () => {
    expect(matchesLoopError("assistant made repeated tool calls")).toBe(true);
  });

  it("returns true for 'repeated attempts'", () => {
    expect(matchesLoopError("repeated attempts to reach the API")).toBe(true);
  });

  it("returns true for 'stuck in a loop'", () => {
    expect(matchesLoopError("agent is stuck in a loop")).toBe(true);
  });

  it("returns true for 'stuck in an loop' (article variation)", () => {
    expect(matchesLoopError("stuck in an loop")).toBe(true);
  });

  it("returns true for 'too many iterations'", () => {
    expect(matchesLoopError("too many iterations in planning")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(matchesLoopError("rate limit exceeded")).toBe(false);
    expect(matchesLoopError("timeout while calling provider")).toBe(false);
    expect(matchesLoopError("")).toBe(false);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `bun run test tests/core/loop-error-patterns.test.ts`
Expected: FAIL — "Cannot find module '../../src/core/loop-error-patterns'"

- [ ] **Step 4: 最小実装を書く**

Create `src/core/loop-error-patterns.ts`:

```typescript
// Declarative regex table for OpenCode `session.error` loop detection.
// Keep this module pure: no imports from @opencode-ai/plugin, no side effects.

export const LOOP_ERROR_PATTERNS: readonly RegExp[] = Object.freeze([
  /loop\s*detect/i,
  /infinite\s+loop/i,
  /repetition\s*limit/i,
  /\brepeated\b.*\b(calls?|attempts?)\b/i,
  /stuck\s*in\s*(an?\s+)?loop/i,
  /too\s*many\s*iterations/i,
]);

export function matchesLoopError(errorMessage: string): boolean {
  return LOOP_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `bun run test tests/core/loop-error-patterns.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: `src/index.ts` に named export を追加**

`src/index.ts` の末尾 (Phase 7 Exports ブロックの後) に以下を追記:

```typescript
// OpenCode adapter shared primitives
export {
  LOOP_ERROR_PATTERNS,
  matchesLoopError,
} from "./core/loop-error-patterns";
```

- [ ] **Step 7: フルテスト・typecheck・lint を実行**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 全て PASS (既存テスト全件 + 新規 10 件)

- [ ] **Step 8: コミット**

```bash
git add src/core/loop-error-patterns.ts tests/core/loop-error-patterns.test.ts src/index.ts
git commit -m "feat(core): add LoopErrorPatterns module for session.error detection"
```

- [ ] **Step 9: push + Draft PR 作成**

```bash
git push -u origin feature/phase1-task2__loop-error-patterns
gh pr create --draft \
  --base feature/phase1__opencode-plugin__base \
  --head feature/phase1-task2__loop-error-patterns \
  --title "Phase1 Task2: add LoopErrorPatterns pure-core module" \
  --body "Adds a declarative regex table used by the upcoming OpenCode session.error handler. Pure module, no runtime dependency on @opencode-ai/plugin."
```

---

### Task 1.3: ESLint `no-restricted-imports` で Core 層の SDK import を禁止

**Branch:** `feature/phase1-task3__eslint-core-guard` (from `feature/phase1-task2__loop-error-patterns`)

**Files:**
- Modify: `eslint.config.mjs`

Core/Hook 層の **全ファイル** で `@opencode-ai/plugin` の import を禁止し、`src/opencode-plugin.ts` と `src/runtime/opencode-adapter.ts` のみ例外とする。対象ファイルはまだ存在しないが、ルール定義は事前に入れておき、後続 Task でファイルを追加した際に自動で許可される構成にする。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1-task2__loop-error-patterns
git checkout -b feature/phase1-task3__eslint-core-guard
```

- [ ] **Step 2: ESLint 設定を書き換える**

`eslint.config.mjs` 全体を以下に置き換える:

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import securityPlugin from "eslint-plugin-security";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  securityPlugin.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": "warn",
    },
    linterOptions: {
      // Set to false to temporarily suppress warnings about unused disable directives,
      // particularly those guarding against 'security/detect-non-literal-fs-filename' false positives.
      // These directives should be cleaned up as codebase matures.
      reportUnusedDisableDirectives: false,
    },
  },
  // Core purity guard: forbid @opencode-ai/plugin imports except in the two designated bridge files.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/opencode-plugin.ts", "src/runtime/opencode-adapter.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@opencode-ai/plugin",
              message:
                "Core/Hook layer must stay pure. Import @opencode-ai/plugin only from src/opencode-plugin.ts or src/runtime/opencode-adapter.ts.",
            },
          ],
          patterns: [
            {
              group: ["@opencode-ai/plugin/*"],
              message:
                "Core/Hook layer must stay pure. Import @opencode-ai/plugin/* only from src/opencode-plugin.ts or src/runtime/opencode-adapter.ts.",
            },
          ],
        },
      ],
    },
  },
);
```

- [ ] **Step 3: lint が通ることを確認 (既存ファイルは SDK を import していない)**

Run: `bun run lint`
Expected: PASS (違反なし)

- [ ] **Step 4: ガードが機能することを手動検証**

一時的に `src/core/loop-error-patterns.ts` の先頭に以下の 1 行を追加:

```typescript
import type { Plugin } from "@opencode-ai/plugin";
```

Run: `bun run lint`
Expected: FAIL — "Core/Hook layer must stay pure. Import @opencode-ai/plugin only from src/opencode-plugin.ts or src/runtime/opencode-adapter.ts."

追加した 1 行を削除し、再度 `bun run lint` が PASS することを確認する。

- [ ] **Step 5: typecheck + full test**

Run: `bun run typecheck && bun run test`
Expected: 全て PASS

- [ ] **Step 6: コミット**

```bash
git add eslint.config.mjs
git commit -m "chore(lint): forbid @opencode-ai/plugin imports outside the designated bridge files"
```

- [ ] **Step 7: push + Draft PR 作成**

```bash
git push -u origin feature/phase1-task3__eslint-core-guard
gh pr create --draft \
  --base feature/phase1__opencode-plugin__base \
  --head feature/phase1-task3__eslint-core-guard \
  --title "Phase1 Task3: ESLint guard for pure core purity" \
  --body "Forbids @opencode-ai/plugin imports in src/** except src/opencode-plugin.ts and src/runtime/opencode-adapter.ts. Files don't yet exist but are pre-whitelisted."
```

---

### Phase 1 完了基準と master マージ

- Phase 1 の全 Task が本 Phase ブランチにマージされている (または Draft PR 群が全部 Ready for Review に昇格している)
- Phase ブランチ `feature/phase1__opencode-plugin__base` の CI が master 相当でグリーン
- Phase ブランチの Draft PR 本文を最終化し、Ready for Review に変更
- ユーザのレビュー承認後、Phase ブランチを `master` にマージ
- Phase 2 は master マージ完了後に開始

---

## Phase 2: OpenCode Plugin Entrypoint (Adapter + Entry + Tests + Docs)

**目的:** OpenCode Host が `@yohi/justice/opencode` サブパスから `OpenCodePlugin` を import して利用できるよう、Adapter・エントリ・package.json の exports/peerDep・テスト・ドキュメントを同一 Phase でまとめて導入する。

**Phase ブランチ作成 (Phase 1 が master にマージされた後):**

```bash
git checkout master
git pull origin master
git checkout -b feature/phase2__opencode-plugin__base
git push -u origin feature/phase2__opencode-plugin__base
gh pr create --draft --base master --head feature/phase2__opencode-plugin__base \
  --title "Phase 2: OpenCode plugin entrypoint (adapter + entry + docs)" \
  --body "draft — will be filled as tasks land"
```

### Task 2.1: `fakeInit` テストヘルパ + `OpenCodeAdapter` 骨組み (lazy init + no-op フォールバック)

**Branch:** `feature/phase2-task1__adapter-skeleton` (from `feature/phase2__opencode-plugin__base`)

**Files:**
- Create: `tests/helpers/fake-opencode-init.ts`
- Create: `src/runtime/opencode-adapter.ts`
- Create: `tests/runtime/opencode-adapter.test.ts`

設計仕様書 Section 5「初期化方針」および Section 4「ワークスペース解決」に沿って以下を実装する:

1. `fakeInit()` ヘルパ: `project` / `client` / `$` / `directory` / `worktree` を持つ OpenCode プラグイン init オブジェクトのスタブを返す
2. Adapter クラス: constructor で `worktree ?? directory` を解決し、いずれも無ければ no-op モードに縮退
3. Adapter: lazy `justice.initialize()` (`Promise<void>` を共有フィールドに保持して 2 度目以降は再利用)
4. Adapter: `log(level, message, ...args)` wrapper — `client.app.log` を safe-call

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2__opencode-plugin__base
git checkout -b feature/phase2-task1__adapter-skeleton
```

- [ ] **Step 2: `fakeInit` ヘルパの失敗テストを書く**

Create `tests/runtime/opencode-adapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";

describe("OpenCodeAdapter skeleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs successfully when worktree is provided", () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter).toBeInstanceOf(OpenCodeAdapter);
  });

  it("enters no-op mode when both worktree and directory are undefined", () => {
    const init = fakeInit({ worktree: undefined, directory: undefined });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.isNoOp()).toBe(true);
  });

  it("falls back to directory when worktree is undefined", () => {
    const init = fakeInit({ worktree: undefined, directory: "/tmp/fallback" });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.isNoOp()).toBe(false);
    expect(adapter.getWorkspaceRoot()).toBe("/tmp/fallback");
  });

  it("prefers worktree over directory when both are set", () => {
    const init = fakeInit({ worktree: "/tmp/wt", directory: "/tmp/dir" });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.getWorkspaceRoot()).toBe("/tmp/wt");
  });

  it("lazy-initializes justice only once across multiple hook entries", async () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    const initSpy = vi.spyOn(adapter as unknown as { __runInit: () => Promise<void> }, "__runInit");
    await adapter.ensureInitialized();
    await adapter.ensureInitialized();
    await adapter.ensureInitialized();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it("log wrapper invokes client.app.log and swallows thrown errors", async () => {
    const throwingLog = vi.fn().mockRejectedValue(new Error("log backend down"));
    const init = fakeInit({
      client: { app: { log: throwingLog } } as never,
      worktree: "/tmp/ws",
      directory: "/tmp/ws",
    });
    const adapter = new OpenCodeAdapter(init);
    await expect(adapter.log("error", "boom")).resolves.toBeUndefined();
    expect(throwingLog).toHaveBeenCalledTimes(1);
  });

  it("no-op adapter never calls justice.initialize", async () => {
    const init = fakeInit({ worktree: undefined, directory: undefined });
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    expect(adapter.isNoOp()).toBe(true);
  });
});
```

- [ ] **Step 3: `fakeInit` ヘルパを実装**

Create `tests/helpers/fake-opencode-init.ts`:

```typescript
import { vi } from "vitest";
import type { OpenCodePluginInit } from "../../src/runtime/opencode-adapter";

export function fakeInit(overrides: Partial<OpenCodePluginInit> = {}): OpenCodePluginInit {
  const base: OpenCodePluginInit = {
    project: { name: "test", root: "/tmp/test-workspace" } as never,
    client: { app: { log: vi.fn().mockResolvedValue(undefined) } } as never,
    $: vi.fn() as never,
    directory: "/tmp/test-workspace",
    worktree: "/tmp/test-workspace",
  };
  return { ...base, ...overrides };
}
```

- [ ] **Step 4: テストがビルドエラーになることを確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts 2>&1 | tail -20`
Expected: FAIL — adapter モジュール未定義

- [ ] **Step 5: Adapter 骨組みを実装**

Create `src/runtime/opencode-adapter.ts`:

```typescript
import { JusticePlugin, createGlobalFs } from "../core/justice-plugin";
import type { JusticePluginOptions } from "../core/justice-plugin";
import { NodeFileSystem } from "./node-file-system";

// Re-declare a minimal structural contract for the OpenCode plugin init
// so downstream test helpers can construct fakes without pulling the SDK.
// The real SDK type is imported only by src/opencode-plugin.ts at the edge.
export interface OpenCodePluginInit {
  readonly project: { readonly name?: string; readonly root?: string };
  readonly client: { readonly app: { log: (entry: OpenCodeLogEntry) => Promise<void> | void } };
  readonly $: (...args: unknown[]) => unknown;
  readonly directory?: string;
  readonly worktree?: string;
}

export interface OpenCodeLogEntry {
  readonly level: "info" | "warn" | "error";
  readonly service: string;
  readonly message: string;
  readonly extra?: Record<string, unknown>;
}

export class OpenCodeAdapter {
  readonly #init: OpenCodePluginInit;
  readonly #noOp: boolean;
  readonly #workspaceRoot: string | null;
  #justice: JusticePlugin | null = null;
  #initPromise: Promise<void> | null = null;

  constructor(init: OpenCodePluginInit) {
    this.#init = init;
    const root = init.worktree ?? init.directory ?? null;
    this.#workspaceRoot = root;
    this.#noOp = root === null;
  }

  isNoOp(): boolean {
    return this.#noOp;
  }

  getWorkspaceRoot(): string | null {
    return this.#workspaceRoot;
  }

  async log(
    level: "info" | "warn" | "error",
    message: string,
    ...args: unknown[]
  ): Promise<void> {
    try {
      await this.#init.client.app.log({
        level,
        service: "justice",
        message,
        extra: args.length > 0 ? { args } : undefined,
      });
    } catch {
      /* final defense line: never throw from the logging wrapper */
    }
  }

  async ensureInitialized(): Promise<void> {
    if (this.#noOp) return;
    if (this.#initPromise) {
      await this.#initPromise;
      return;
    }
    this.#initPromise = this.__runInit();
    await this.#initPromise;
  }

  getJustice(): JusticePlugin | null {
    return this.#justice;
  }

  // Exposed for test spies (prefixed with __ to signal internal use).
  async __runInit(): Promise<void> {
    try {
      const root = this.#workspaceRoot;
      if (root === null) return;
      const localFs = new NodeFileSystem(root);
      const loggerAdapter: NonNullable<JusticePluginOptions["logger"]> = {
        warn: (msg, ...extra) => {
          void this.log("warn", msg, ...extra);
        },
        error: (msg, ...extra) => {
          void this.log("error", msg, ...extra);
        },
      };
      const globalFs = await createGlobalFs(loggerAdapter);
      this.#justice = new JusticePlugin(localFs, localFs, {
        logger: loggerAdapter,
        onError: (err) => {
          void this.log("error", "[Justice] internal error", err);
        },
        globalFileSystem: globalFs ?? undefined,
      });
      await this.#justice.initialize();
      await this.log("info", "Justice initialized via opencode-adapter");
    } catch (err) {
      await this.log("error", "[Justice] lazy init failed", err);
      // Fail-open: leave #justice null; hook handlers will treat this as PROCEED.
    }
  }
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 全て PASS (ESLint は `src/runtime/opencode-adapter.ts` を例外対象として認識)

- [ ] **Step 8: コミット**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter.test.ts tests/helpers/fake-opencode-init.ts
git commit -m "feat(runtime): add OpenCodeAdapter skeleton with lazy init and no-op fallback"
```

- [ ] **Step 9: push + Draft PR**

```bash
git push -u origin feature/phase2-task1__adapter-skeleton
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task1__adapter-skeleton \
  --title "Phase2 Task1: OpenCodeAdapter skeleton (lazy init + no-op fallback)" \
  --body "Introduces the Adapter class boundary, fake init helper, and structural OpenCodePluginInit contract. Hook handlers land in later tasks."
```

---

### Task 2.2: `onMessageUpdated` 実装

**Branch:** `feature/phase2-task2__on-message-updated` (from `feature/phase2-task1__adapter-skeleton`)

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `tests/runtime/opencode-adapter.test.ts`

設計仕様書 Section 5 の `message.updated` 行に基づき、`role === "user"` かつ非空 `content` のときのみ `MessageEvent` を合成。合成できない場合は副作用なしで PROCEED。Fail-Open は全境界で必須。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2-task1__adapter-skeleton
git checkout -b feature/phase2-task2__on-message-updated
```

- [ ] **Step 2: 失敗する単体テストを追加**

`tests/runtime/opencode-adapter.test.ts` の末尾に以下を追加:

```typescript
describe("OpenCodeAdapter.onMessageUpdated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes user messages with content to JusticePlugin.handleEvent", async () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (!justice) throw new Error("justice should be initialized");
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    const output: { context: string[] } = { context: [] };
    await adapter.onMessageUpdated(
      {
        message: { role: "user", content: "plan.md の次のタスクを委譲して" },
        sessionID: "sess-1",
      } as never,
      output as never,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "Message",
      sessionId: "sess-1",
      payload: { role: "user", content: "plan.md の次のタスクを委譲して" },
    });
  });

  it("skips assistant messages", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onMessageUpdated(
      { message: { role: "assistant", content: "hello" }, sessionID: "s" } as never,
      { context: [] } as never,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips empty-content messages", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onMessageUpdated(
      { message: { role: "user", content: "" }, sessionID: "s" } as never,
      { context: [] } as never,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("pushes injected context into output.context on inject response", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "HINT",
    });
    const output: { context: string[] } = { context: [] };
    await adapter.onMessageUpdated(
      { message: { role: "user", content: "hi" }, sessionID: "s" } as never,
      output as never,
    );
    expect(output.context).toEqual(["HINT"]);
  });

  it("does not throw and leaves output untouched when justice throws (fail-open)", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockRejectedValue(new Error("boom"));
    const output: { context: string[] } = { context: [] };
    await expect(
      adapter.onMessageUpdated(
        { message: { role: "user", content: "hi" }, sessionID: "s" } as never,
        output as never,
      ),
    ).resolves.toBeUndefined();
    expect(output.context).toEqual([]);
  });

  it("no-op adapter returns without calling justice", async () => {
    const init = fakeInit({ worktree: undefined, directory: undefined });
    const adapter = new OpenCodeAdapter(init);
    const output: { context: string[] } = { context: [] };
    await expect(
      adapter.onMessageUpdated(
        { message: { role: "user", content: "hi" }, sessionID: "s" } as never,
        output as never,
      ),
    ).resolves.toBeUndefined();
    expect(output.context).toEqual([]);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts -t "onMessageUpdated"`
Expected: FAIL — `adapter.onMessageUpdated is not a function`

- [ ] **Step 4: `onMessageUpdated` を実装**

`src/runtime/opencode-adapter.ts` の末尾 (クラス閉じ `}` の直前) に以下を追加:

```typescript
  async onMessageUpdated(
    input: {
      readonly message: { readonly role: string; readonly content: string };
      readonly sessionID: string;
    },
    output: { context?: string[] },
  ): Promise<void> {
    if (this.#noOp) return;
    try {
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      const role = input.message?.role;
      const content = input.message?.content;
      if (role !== "user" || typeof content !== "string" || content.length === 0) return;

      const response = await justice.handleEvent({
        type: "Message",
        sessionId: input.sessionID,
        payload: { role: "user", content },
      });

      if (response.action === "inject") {
        if (!output.context) output.context = [];
        output.context.push(response.injectedContext);
      }
    } catch (err) {
      await this.log("error", "[Justice] onMessageUpdated failure", err);
    }
  }
```

必要に応じて `import type { HookResponse } from "../core/types";` は追加せず、返却は直接 `HookResponse` 型に依存させる。型整合のため `justice-plugin.ts` の既存 `handleEvent` 戻り値型 (`Promise<HookResponse>`) を `src/core/types.ts` からすでに import していることを利用する。

- [ ] **Step 5: テストが通ることを確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts`
Expected: 全 PASS (前 Task 分 7 + 今回 6 = 13 tests)

- [ ] **Step 6: typecheck + lint + full test**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 全て PASS

- [ ] **Step 7: コミット**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter.test.ts
git commit -m "feat(runtime): implement OpenCodeAdapter.onMessageUpdated"
```

- [ ] **Step 8: push + Draft PR**

```bash
git push -u origin feature/phase2-task2__on-message-updated
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task2__on-message-updated \
  --title "Phase2 Task2: OpenCodeAdapter.onMessageUpdated" \
  --body "Handles OpenCode message.updated payloads. Filters on role=user + non-empty content; inject responses push into output.context. Fail-open guarantee preserved."
```

---

### Task 2.3: `onToolExecuteBefore` 実装 (`inject` を `output.args.prompt` 前置)

**Branch:** `feature/phase2-task3__on-tool-execute-before` (from `feature/phase2-task2__on-message-updated`)

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `tests/runtime/opencode-adapter.test.ts`

設計仕様書 Section 5 フックマッピング表に基づき、`tool === "task"` の場合のみ `PreToolUseEvent` へ変換。`inject` レスポンスは `output.args.prompt` に **前置 (prepend)** する。非 `task` ツールは副作用なし。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2-task2__on-message-updated
git checkout -b feature/phase2-task3__on-tool-execute-before
```

- [ ] **Step 2: 失敗テストを追加**

`tests/runtime/opencode-adapter.test.ts` の末尾に以下を追加:

```typescript
describe("OpenCodeAdapter.onToolExecuteBefore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts task tool invocations into PreToolUseEvent", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteBefore(
      {
        tool: "task",
        args: { prompt: "do a thing" },
        sessionID: "s",
      } as never,
      { args: { prompt: "do a thing" } } as never,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "PreToolUse",
      sessionId: "s",
      payload: { toolName: "task", toolInput: { prompt: "do a thing" } },
    });
  });

  it("skips non-task tools", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onToolExecuteBefore(
      { tool: "bash", args: { command: "ls" }, sessionID: "s" } as never,
      { args: { command: "ls" } } as never,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("prepends injected context to output.args.prompt", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "[PLAN]",
    });

    const output = { args: { prompt: "original" } };
    await adapter.onToolExecuteBefore(
      { tool: "task", args: { prompt: "original" }, sessionID: "s" } as never,
      output as never,
    );
    expect(output.args.prompt.startsWith("[PLAN]")).toBe(true);
    expect(output.args.prompt.endsWith("original")).toBe(true);
  });

  it("merges non-prompt args from modifiedPayload when present", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "ctx",
      modifiedPayload: { args: { loadSkills: ["a", "b"] } },
    });

    const output = { args: { prompt: "p", loadSkills: [] as string[] } };
    await adapter.onToolExecuteBefore(
      { tool: "task", args: output.args, sessionID: "s" } as never,
      output as never,
    );
    expect(output.args.loadSkills).toEqual(["a", "b"]);
  });

  it("fails open when justice throws", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockRejectedValue(new Error("boom"));
    const output = { args: { prompt: "unchanged" } };
    await expect(
      adapter.onToolExecuteBefore(
        { tool: "task", args: output.args, sessionID: "s" } as never,
        output as never,
      ),
    ).resolves.toBeUndefined();
    expect(output.args.prompt).toBe("unchanged");
  });
});
```

- [ ] **Step 3: テスト失敗確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts -t "onToolExecuteBefore"`
Expected: FAIL — `adapter.onToolExecuteBefore is not a function`

- [ ] **Step 4: `onToolExecuteBefore` を実装**

`src/runtime/opencode-adapter.ts` のクラス末尾に追加:

```typescript
  async onToolExecuteBefore(
    input: {
      readonly tool: string;
      readonly args: Record<string, unknown>;
      readonly sessionID: string;
    },
    output: { args: Record<string, unknown> },
  ): Promise<void> {
    if (this.#noOp) return;
    try {
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;
      if (input.tool !== "task") return;

      const response = await justice.handleEvent({
        type: "PreToolUse",
        sessionId: input.sessionID,
        payload: { toolName: input.tool, toolInput: input.args },
      });

      if (response.action !== "inject") return;

      // Prepend injected context to the prompt, preserving the original content.
      const originalPrompt =
        typeof output.args.prompt === "string" ? output.args.prompt : "";
      output.args.prompt = `${response.injectedContext}\n\n${originalPrompt}`;

      // Merge any non-prompt args from modifiedPayload.
      const modified = response.modifiedPayload as
        | { args?: Record<string, unknown> }
        | undefined;
      if (modified?.args && typeof modified.args === "object") {
        for (const [key, value] of Object.entries(modified.args)) {
          if (key === "prompt") continue; // prompt already handled with prepend semantics
          output.args[key] = value;
        }
      }
    } catch (err) {
      await this.log("error", "[Justice] onToolExecuteBefore failure", err);
    }
  }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts`
Expected: 全 PASS

- [ ] **Step 6: typecheck + lint + full test**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter.test.ts
git commit -m "feat(runtime): implement OpenCodeAdapter.onToolExecuteBefore with prompt-prepend semantics"
```

- [ ] **Step 8: push + Draft PR**

```bash
git push -u origin feature/phase2-task3__on-tool-execute-before
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task3__on-tool-execute-before \
  --title "Phase2 Task3: OpenCodeAdapter.onToolExecuteBefore" \
  --body "Handles tool.execute.before for the 'task' tool, injecting plan context via prompt-prepend and merging non-prompt args. Non-task tools pass through."
```

---

### Task 2.4: `onToolExecuteAfter` 実装

**Branch:** `feature/phase2-task4__on-tool-execute-after` (from `feature/phase2-task3__on-tool-execute-before`)

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `tests/runtime/opencode-adapter.test.ts`

`task` ツール完了時のみ `PostToolUseEvent` へ変換。副作用のみ (wisdom 更新) で `output` は触らない。エラー結果 (成功でない) は `error: true` を立てて `JusticePlugin.handleEvent` に委譲。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2-task3__on-tool-execute-before
git checkout -b feature/phase2-task4__on-tool-execute-after
```

- [ ] **Step 2: 失敗テスト追加**

`tests/runtime/opencode-adapter.test.ts` の末尾に追加:

```typescript
describe("OpenCodeAdapter.onToolExecuteAfter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts task tool results into PostToolUseEvent with error=false on success", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteAfter(
      { tool: "task", result: "done", error: undefined, sessionID: "s" } as never,
      {} as never,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "PostToolUse",
      sessionId: "s",
      payload: { toolName: "task", toolResult: "done", error: false },
    });
  });

  it("sets error=true when input.error is truthy", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteAfter(
      {
        tool: "task",
        result: "stack trace...",
        error: new Error("boom"),
        sessionID: "s",
      } as never,
      {} as never,
    );
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "stack trace...", error: true },
    });
  });

  it("skips non-task tools", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onToolExecuteAfter(
      { tool: "bash", result: "ok", sessionID: "s" } as never,
      {} as never,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("fails open when justice throws", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockRejectedValue(new Error("boom"));

    await expect(
      adapter.onToolExecuteAfter(
        { tool: "task", result: "r", sessionID: "s" } as never,
        {} as never,
      ),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: テスト失敗確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts -t "onToolExecuteAfter"`
Expected: FAIL — `adapter.onToolExecuteAfter is not a function`

- [ ] **Step 4: 実装を追加**

`src/runtime/opencode-adapter.ts` のクラス末尾に追加:

```typescript
  async onToolExecuteAfter(
    input: {
      readonly tool: string;
      readonly result: unknown;
      readonly error?: unknown;
      readonly sessionID: string;
    },
    _output: Record<string, unknown>,
  ): Promise<void> {
    if (this.#noOp) return;
    try {
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;
      if (input.tool !== "task") return;

      const toolResult =
        typeof input.result === "string" ? input.result : JSON.stringify(input.result ?? "");

      await justice.handleEvent({
        type: "PostToolUse",
        sessionId: input.sessionID,
        payload: {
          toolName: input.tool,
          toolResult,
          error: Boolean(input.error),
        },
      });
    } catch (err) {
      await this.log("error", "[Justice] onToolExecuteAfter failure", err);
    }
  }
```

- [ ] **Step 5: テスト通過確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts`
Expected: 全 PASS

- [ ] **Step 6: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter.test.ts
git commit -m "feat(runtime): implement OpenCodeAdapter.onToolExecuteAfter (wisdom update side effect)"
```

- [ ] **Step 8: push + Draft PR**

```bash
git push -u origin feature/phase2-task4__on-tool-execute-after
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task4__on-tool-execute-after \
  --title "Phase2 Task4: OpenCodeAdapter.onToolExecuteAfter" \
  --body "Converts tool.execute.after events into PostToolUseEvent for the 'task' tool. Side-effect only (wisdom store)."
```

---

### Task 2.5: `onSessionCompacting` 実装

**Branch:** `feature/phase2-task5__on-session-compacting` (from `feature/phase2-task4__on-tool-execute-after`)

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `tests/runtime/opencode-adapter.test.ts`

`experimental.session.compacting` → `EventEvent<CompactionPayload>` 変換。`inject` レスポンス時にスナップショットを `output.context[]` へ push。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2-task4__on-tool-execute-after
git checkout -b feature/phase2-task5__on-session-compacting
```

- [ ] **Step 2: 失敗テスト追加**

`tests/runtime/opencode-adapter.test.ts` に追記:

```typescript
describe("OpenCodeAdapter.onSessionCompacting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts compaction inputs into EventEvent with eventType=compaction", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onSessionCompacting(
      { reason: "token budget", sessionID: "s" } as never,
      { context: [] } as never,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "Event",
      sessionId: "s",
      payload: { eventType: "compaction", sessionId: "s", reason: "token budget" },
    });
  });

  it("pushes snapshot to output.context on inject response", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "snapshot-body",
    });
    const output = { context: [] as string[] };
    await adapter.onSessionCompacting(
      { reason: "r", sessionID: "s" } as never,
      output as never,
    );
    expect(output.context).toEqual(["snapshot-body"]);
  });

  it("leaves context empty when handleEvent returns proceed", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
    const output = { context: [] as string[] };
    await adapter.onSessionCompacting(
      { reason: "r", sessionID: "s" } as never,
      output as never,
    );
    expect(output.context).toEqual([]);
  });

  it("fails open when justice throws", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockRejectedValue(new Error("boom"));
    const output = { context: [] as string[] };
    await expect(
      adapter.onSessionCompacting(
        { reason: "r", sessionID: "s" } as never,
        output as never,
      ),
    ).resolves.toBeUndefined();
    expect(output.context).toEqual([]);
  });
});
```

- [ ] **Step 3: テスト失敗確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts -t "onSessionCompacting"`
Expected: FAIL — `adapter.onSessionCompacting is not a function`

- [ ] **Step 4: 実装を追加**

`src/runtime/opencode-adapter.ts` のクラス末尾に追加:

```typescript
  async onSessionCompacting(
    input: { readonly reason?: string; readonly sessionID: string },
    output: { context?: string[] },
  ): Promise<void> {
    if (this.#noOp) return;
    try {
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      const response = await justice.handleEvent({
        type: "Event",
        sessionId: input.sessionID,
        payload: {
          eventType: "compaction",
          sessionId: input.sessionID,
          reason: input.reason ?? "",
        },
      });

      if (response.action === "inject") {
        if (!output.context) output.context = [];
        output.context.push(response.injectedContext);
      }
    } catch (err) {
      await this.log("error", "[Justice] onSessionCompacting failure", err);
    }
  }
```

- [ ] **Step 5: テスト通過確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts`
Expected: 全 PASS

- [ ] **Step 6: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter.test.ts
git commit -m "feat(runtime): implement OpenCodeAdapter.onSessionCompacting"
```

- [ ] **Step 8: push + Draft PR**

```bash
git push -u origin feature/phase2-task5__on-session-compacting
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task5__on-session-compacting \
  --title "Phase2 Task5: OpenCodeAdapter.onSessionCompacting" \
  --body "Bridges experimental.session.compacting to CompactionProtector, pushing plan snapshots into output.context."
```

---

### Task 2.6: `onSessionError` 実装 (loop-error-patterns 連携)

**Branch:** `feature/phase2-task6__on-session-error` (from `feature/phase2-task5__on-session-compacting`)

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `tests/runtime/opencode-adapter.test.ts`

`session.error` は `matchesLoopError` が true のときのみ `LoopDetectorPayload` を合成。非一致時はログも出さず即 return (仕様書 Section 5 フックマッピング表準拠)。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2-task5__on-session-compacting
git checkout -b feature/phase2-task6__on-session-error
```

- [ ] **Step 2: 失敗テスト追加**

`tests/runtime/opencode-adapter.test.ts` に追記:

```typescript
describe("OpenCodeAdapter.onSessionError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers LoopDetectionHandler via EventEvent on loop-matching messages", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onSessionError(
      { error: { message: "loop detected in planning" }, sessionID: "s" } as never,
      {} as never,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "Event",
      sessionId: "s",
      payload: {
        eventType: "loop-detector",
        sessionId: "s",
        message: "loop detected in planning",
      },
    });
  });

  it("ignores non-matching errors without calling justice or logging", async () => {
    const init = fakeInit();
    const logSpy = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const handleSpy = vi.spyOn(justice, "handleEvent");
    logSpy.mockClear(); // ignore init log

    await adapter.onSessionError(
      { error: { message: "timeout while calling provider" }, sessionID: "s" } as never,
      {} as never,
    );
    expect(handleSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("fails open when justice throws", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    vi.spyOn(justice, "handleEvent").mockRejectedValue(new Error("boom"));

    await expect(
      adapter.onSessionError(
        { error: { message: "loop detected" }, sessionID: "s" } as never,
        {} as never,
      ),
    ).resolves.toBeUndefined();
  });

  it("handles string-form error input", async () => {
    const init = fakeInit();
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice()!;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onSessionError(
      { error: "infinite loop", sessionID: "s" } as never,
      {} as never,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: テスト失敗確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts -t "onSessionError"`
Expected: FAIL — `adapter.onSessionError is not a function`

- [ ] **Step 4: 実装を追加**

`src/runtime/opencode-adapter.ts` の冒頭 import ブロックに追加:

```typescript
import { matchesLoopError } from "../core/loop-error-patterns";
```

クラス末尾に実装追加:

```typescript
  async onSessionError(
    input: { readonly error: unknown; readonly sessionID: string },
    _output: Record<string, unknown>,
  ): Promise<void> {
    if (this.#noOp) return;
    try {
      const message = this.#extractErrorMessage(input.error);
      if (!matchesLoopError(message)) return; // not a loop — silently pass through per spec

      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      await justice.handleEvent({
        type: "Event",
        sessionId: input.sessionID,
        payload: {
          eventType: "loop-detector",
          sessionId: input.sessionID,
          message,
        },
      });
    } catch (err) {
      await this.log("error", "[Justice] onSessionError failure", err);
    }
  }

  #extractErrorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      const msg = (error as { message?: unknown }).message;
      if (typeof msg === "string") return msg;
    }
    return "";
  }
```

- [ ] **Step 5: テスト通過確認**

Run: `bun run test tests/runtime/opencode-adapter.test.ts`
Expected: 全 PASS

- [ ] **Step 6: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter.test.ts
git commit -m "feat(runtime): implement OpenCodeAdapter.onSessionError with LoopErrorPatterns"
```

- [ ] **Step 8: push + Draft PR**

```bash
git push -u origin feature/phase2-task6__on-session-error
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task6__on-session-error \
  --title "Phase2 Task6: OpenCodeAdapter.onSessionError (loop detection)" \
  --body "Routes session.error to LoopDetectionHandler only when the error message matches LOOP_ERROR_PATTERNS. Non-matching errors silently pass through."
```

---

### Task 2.7: OpenCode Plugin エントリ (`src/opencode-plugin.ts`) + 統合テスト

**Branch:** `feature/phase2-task7__entry-and-integration` (from `feature/phase2-task6__on-session-error`)

**Files:**
- Create: `src/opencode-plugin.ts`
- Create: `tests/integration/opencode-plugin.test.ts`

設計仕様書 Section 3 の通り `OpenCodePlugin` という named export で、`Plugin` 型契約を満たす薄い配線ファイル。統合テストでは (1) 型契約 assignability, (2) lazy init 冪等性, (3) E2E シナリオ (messageUpdated → toolExecuteBefore → toolExecuteAfter), (4) compaction スナップショット injection を検証する。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2-task6__on-session-error
git checkout -b feature/phase2-task7__entry-and-integration
```

- [ ] **Step 2: エントリの失敗テスト (統合テスト) を書く**

Create `tests/integration/opencode-plugin.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plugin } from "@opencode-ai/plugin";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import { fakeInit } from "../helpers/fake-opencode-init";

describe("OpenCodePlugin (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is assignable to the OpenCode Plugin type", () => {
    const checked: Plugin = OpenCodePlugin;
    expect(typeof checked).toBe("function");
  });

  it("returns an object with the five required hook keys", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    const keys = Object.keys(handlers);
    expect(keys).toEqual(
      expect.arrayContaining([
        "message.updated",
        "tool.execute.before",
        "tool.execute.after",
        "experimental.session.compacting",
        "session.error",
      ]),
    );
  });

  it("invokes lazy init only once across multiple hook entries", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    // Trigger several hooks in parallel
    await Promise.all([
      (handlers as Record<string, (i: unknown, o: unknown) => Promise<void>>)[
        "message.updated"
      ]({ message: { role: "user", content: "hi" }, sessionID: "s" }, { context: [] }),
      (handlers as Record<string, (i: unknown, o: unknown) => Promise<void>>)[
        "tool.execute.before"
      ]({ tool: "task", args: { prompt: "p" }, sessionID: "s" }, { args: { prompt: "p" } }),
      (handlers as Record<string, (i: unknown, o: unknown) => Promise<void>>)[
        "tool.execute.after"
      ]({ tool: "task", result: "r", sessionID: "s" }, {}),
    ]);
    const logFn = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const initLogs = logFn.mock.calls.filter(
      ([entry]: [{ message: string }]) =>
        typeof entry?.message === "string" &&
        entry.message.includes("Justice initialized via opencode-adapter"),
    );
    expect(initLogs.length).toBe(1);
  });

  it("fails open during lazy init (broken workspace) and returns PROCEED for all hooks", async () => {
    // Force lazy init to fail by pointing at a path that cannot become a workspace.
    const init = fakeInit({ worktree: undefined, directory: undefined });
    const handlers = await OpenCodePlugin(init as never);
    const output = { context: [] as string[] };
    await (handlers as Record<string, (i: unknown, o: unknown) => Promise<void>>)[
      "message.updated"
    ]({ message: { role: "user", content: "hi" }, sessionID: "s" }, output);
    expect(output.context).toEqual([]);
  });
});
```

(E2E シナリオ - plan.md 更新 / wisdom 書き込み / compaction snapshot - は既存の integration テスト群 `tests/integration/plugin-orchestrator-flow.test.ts` 等でカバー済みのため、本ファイルでは "OpenCode 入口からコア到達" の検証に絞る。)

- [ ] **Step 3: テスト失敗確認**

Run: `bun run test tests/integration/opencode-plugin.test.ts`
Expected: FAIL — "Cannot find module '../../src/opencode-plugin'"

- [ ] **Step 4: エントリファイルを実装**

Create `src/opencode-plugin.ts`:

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { OpenCodeAdapter } from "./runtime/opencode-adapter";
import type { OpenCodePluginInit } from "./runtime/opencode-adapter";

/**
 * OpenCode plugin entrypoint for @yohi/justice.
 *
 * Consumers wire this in OpenCode like so:
 *   import { OpenCodePlugin } from "@yohi/justice/opencode";
 *   export default { plugins: [OpenCodePlugin] };
 *
 * The name OpenCodePlugin is chosen to avoid collision with the existing
 * JusticePlugin class exported from @yohi/justice (core orchestrator).
 */
export const OpenCodePlugin: Plugin = async (init) => {
  const adapter = new OpenCodeAdapter(init as unknown as OpenCodePluginInit);
  return {
    "message.updated": async (input, output) => {
      await adapter.onMessageUpdated(input as never, output as never);
    },
    "tool.execute.before": async (input, output) => {
      await adapter.onToolExecuteBefore(input as never, output as never);
    },
    "tool.execute.after": async (input, output) => {
      await adapter.onToolExecuteAfter(input as never, output as never);
    },
    "experimental.session.compacting": async (input, output) => {
      await adapter.onSessionCompacting(input as never, output as never);
    },
    "session.error": async (input, output) => {
      await adapter.onSessionError(input as never, output as never);
    },
  };
};
```

- [ ] **Step 5: テスト通過確認**

Run: `bun run test tests/integration/opencode-plugin.test.ts`
Expected: 全 PASS (4 tests)

- [ ] **Step 6: typecheck + lint + full test**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add src/opencode-plugin.ts tests/integration/opencode-plugin.test.ts
git commit -m "feat: add OpenCodePlugin entrypoint with five hook bindings"
```

- [ ] **Step 8: push + Draft PR**

```bash
git push -u origin feature/phase2-task7__entry-and-integration
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task7__entry-and-integration \
  --title "Phase2 Task7: OpenCodePlugin entrypoint + integration tests" \
  --body "Introduces the @yohi/justice/opencode subpath entry (once packaging lands in Task8). Integration tests assert Plugin-type assignability, the five required hook keys, and lazy-init idempotency."
```

---

### Task 2.8: Packaging — `package.json` exports / peerDep / version bump

**Branch:** `feature/phase2-task8__packaging` (from `feature/phase2-task7__entry-and-integration`)

**Files:**
- Modify: `package.json`

設計仕様書 Section 9 に従い以下を変更:

- `exports` に `"./opencode"` サブパスを追加
- `peerDependencies` に `@opencode-ai/plugin` を caret range で固定
- `version`: `1.1.0` → `1.2.0` (MINOR 後方互換)

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2-task7__entry-and-integration
git checkout -b feature/phase2-task8__packaging
```

- [ ] **Step 2: `@opencode-ai/plugin` の実バージョンを取得**

```bash
bun pm ls @opencode-ai/plugin 2>&1 | tail -5
```

出力から `@opencode-ai/plugin@X.Y.Z` 形式のバージョンをメモする (以下 `<PKG_VER>` と表記)。

- [ ] **Step 3: `package.json` を更新**

以下の 3 箇所を変更:

```json
{
  "name": "@yohi/justice",
  "version": "1.2.0",
  ...
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./runtime": {
      "import": "./dist/runtime/node-file-system.js",
      "types": "./dist/runtime/node-file-system.d.ts"
    },
    "./opencode": {
      "import": "./dist/opencode-plugin.js",
      "types": "./dist/opencode-plugin.d.ts"
    }
  },
  ...
  "peerDependencies": {
    "typescript": "^6.0.2",
    "@opencode-ai/plugin": "^<PKG_VER>"
  }
}
```

(Task 1.1 で一時的に `*` にしていた `@opencode-ai/plugin` peer range を、実測バージョンからの caret range に置換。)

- [ ] **Step 4: ビルドして `dist/opencode-plugin.{js,d.ts}` が生成されることを確認**

```bash
bun run build
ls dist/opencode-plugin.js dist/opencode-plugin.d.ts
```

Expected: 両ファイルが存在する。

- [ ] **Step 5: サブパス import がバンドル解決可能であることを確認**

```bash
bun run typecheck
node -e "import('./dist/opencode-plugin.js').then(m => console.log(Object.keys(m)))"
```

Expected: `[ 'OpenCodePlugin' ]` が表示される。

- [ ] **Step 6: full test**

Run: `bun run test`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add package.json
git commit -m "chore(release): add @yohi/justice/opencode subpath export and bump to 1.2.0"
```

- [ ] **Step 8: push + Draft PR**

```bash
git push -u origin feature/phase2-task8__packaging
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task8__packaging \
  --title "Phase2 Task8: packaging (exports, peerDep, version 1.2.0)" \
  --body "Adds the ./opencode subpath export, pins the @opencode-ai/plugin peer dependency to the resolved range, and bumps to 1.2.0 (MINOR, backwards-compatible)."
```

---

### Task 2.9: ドキュメント更新 (README.md + SPEC.md + CHANGELOG.md)

**Branch:** `feature/phase2-task9__docs` (from `feature/phase2-task8__packaging`)

**Files:**
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `CHANGELOG.md`

設計仕様書 Section 9「README.md / SPEC.md 更新箇所」に準じ、以下を実装する:

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2-task8__packaging
git checkout -b feature/phase2-task9__docs
```

- [ ] **Step 2: `README.md` の「インストール」節に OpenCode Plugin 方式を追記**

`README.md` のインストール見出しの直後に、以下のセクションを追加する:

```markdown
### パターン 1: OpenCode Plugin 経由 (推奨, v1.2.0〜)

`@yohi/justice/opencode` サブパスから `OpenCodePlugin` を import し、
OpenCode の `plugins` 配列に追加するだけで有効化できます。

```ts
import { OpenCodePlugin } from "@yohi/justice/opencode";
export default { plugins: [OpenCodePlugin] };
```

初期化 (wisdom のロード) は最初のフック呼び出し時に 1 度だけ遅延実行されます。
ワークスペースが判定できない場合 (`worktree` / `directory` が未設定)、
プラグインは何もせず OpenCode セッションは影響を受けません。

### パターン 2: OmO カスタムフック経由 (後方互換)

従来どおり `oh-my-opencode.jsonc` から `dist/hooks/*.js` を参照する構成を
そのまま維持できます。1.2.0 以降もシム経路は壊れません。両方式を同時に
設定しないでください — `client.app.log` に `Justice initialized via
{adapter|legacy-shim}` が 1 セッションで両方出た場合は設定を見直してください。
```

- [ ] **Step 3: `README.md` の「コアコンポーネント」表に OpenCodeAdapter を追加**

`README.md` 内の「コアコンポーネント」または「アーキテクチャ」節の表に以下の行を追加する (表列が異なる場合は既存フォーマットに合わせる):

```markdown
| `OpenCodeAdapter` | OpenCode `Plugin` ↔ `HookEvent` の双方向変換と Fail-Open 境界 | `src/runtime/opencode-adapter.ts` |
```

- [ ] **Step 4: `README.md` の「プロジェクト・ステータス」表に Phase 8 を追加**

該当表に以下を追記 (既存行の直後に):

```markdown
| Phase 8 | OpenCode Plugin 統合 (`@yohi/justice/opencode` エントリ) | ✅ 完了 (v1.2.0) |
```

- [ ] **Step 5: `SPEC.md` に「OpenCode Plugin」節を追加**

`SPEC.md` 末尾 (または該当する場所) に以下を追加:

```markdown
## OpenCode Plugin 統合 (v1.2.0)

`@yohi/justice/opencode` サブパスから named export される `OpenCodePlugin`
は、OpenCode の `Plugin` 型契約を満たす非同期関数です。本節では、フック
マッピング・Fail-Open テンプレート・ワークスペース解決を整理します。
実装詳細は `docs/superpowers/specs/2026-04-22-opencode-plugin-entrypoint-design.md`
を参照してください。

### フックマッピング

| OpenCode フック | Adapter メソッド | Justice イベント | output 射影 |
|---|---|---|---|
| `message.updated` | `onMessageUpdated` | `MessageEvent` | `inject` 時 `output.context[]` に push |
| `tool.execute.before` | `onToolExecuteBefore` | `PreToolUseEvent` (task のみ) | `inject` 時 `prompt` 前置 + 他 args 上書き |
| `tool.execute.after` | `onToolExecuteAfter` | `PostToolUseEvent` (task のみ) | 副作用のみ |
| `experimental.session.compacting` | `onSessionCompacting` | `EventEvent<CompactionPayload>` | `inject` 時 `output.context[]` push |
| `session.error` | `onSessionError` | `EventEvent<LoopDetectorPayload>` (loop パターン一致時のみ) | 副作用のみ |

### Fail-Open テンプレート

すべてのハンドラ境界で以下の構造を守ります:

```text
try {
  await adapter.ensureInitialized();
  const event = toHookEvent(input);
  const response = await justice.handleEvent(event);
  applyResponseTo(output, response);
} catch (err) {
  await adapter.log("error", "[Justice] ... failure", err);
  // output は未変更 — OpenCode セッションは継続
}
```

### ワークスペース解決

- `worktree ?? directory` を採用
- 両方 undefined の場合は Adapter が no-op モードへ縮退し、全フックが即 PROCEED を返す
- `createGlobalFs()` 失敗時は `NoOpPersistence` にフォールバック (既存動作)
```

- [ ] **Step 6: `CHANGELOG.md` に `Unreleased` → `1.2.0` セクションを追加**

`CHANGELOG.md` の先頭 `# Changelog` 見出し直後の `## Unreleased` を **1.2.0** にリネーム (またはすでに別の変更が Unreleased に残っている場合は両方を保持) し、以下を追加する:

```markdown
## [1.2.0](https://github.com/yohi/justice/compare/v1.1.0...v1.2.0) (2026-04-22)

### Features

- **opencode-plugin:** `@yohi/justice/opencode` サブパスから named export される `OpenCodePlugin` 関数を追加。OpenCode の `Plugin` 型契約を満たし、`message.updated` / `tool.execute.before` / `tool.execute.after` / `experimental.session.compacting` / `session.error` の 5 フックを Justice Core に配線する。
- **runtime:** `OpenCodeAdapter` を `src/runtime/opencode-adapter.ts` に追加。lazy `justice.initialize()`、Fail-Open 境界、`client.app.log` ラッパを担う。
- **core:** `LOOP_ERROR_PATTERNS` / `matchesLoopError` を `src/core/loop-error-patterns.ts` に追加 (pure module)。`session.error` のループ検出に使用。

### Chores

- `@opencode-ai/plugin` を devDependency + peerDependency に追加。
- ESLint `no-restricted-imports` で Core/Hook 層からの SDK import を禁止 (`src/opencode-plugin.ts` と `src/runtime/opencode-adapter.ts` を例外)。
- `package.json` の `exports` に `./opencode` サブパスを追加。

### 後方互換

- OmO カスタムフック経路 (`dist/hooks/*.js`) は**変更なし**で継続動作。`JusticePlugin` クラスの named export も維持。
- `JusticePlugin` クラスは `@yohi/justice` から、`OpenCodePlugin` 関数は `@yohi/justice/opencode` から別パスで export されるため名前衝突は発生しない。
```

- [ ] **Step 7: lint + typecheck + full test**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: 全 PASS

- [ ] **Step 8: コミット**

```bash
git add README.md SPEC.md CHANGELOG.md
git commit -m "docs: document OpenCode plugin entrypoint and 1.2.0 changelog"
```

- [ ] **Step 9: push + Draft PR**

```bash
git push -u origin feature/phase2-task9__docs
gh pr create --draft \
  --base feature/phase2__opencode-plugin__base \
  --head feature/phase2-task9__docs \
  --title "Phase2 Task9: docs for OpenCode plugin entrypoint (1.2.0)" \
  --body "README: install + core-components + status table. SPEC: OpenCode Plugin section with hook mapping, fail-open template, workspace resolution. CHANGELOG: 1.2.0 entry."
```

---

### Phase 2 完了基準と master マージ

- Phase 2 の全 Task (2.1 〜 2.9) が Phase ブランチにマージされている
- `bun run typecheck && bun run lint && bun run test && bun run build` が Phase ブランチの最新 HEAD でグリーン
- `dist/opencode-plugin.{js,d.ts}` および既存 `dist/hooks/*.js` が共に生成されていることをビルド成果物で確認
- Phase ブランチの Draft PR 本文 (実装サマリ + E2E 検証結果) を最終化し、Ready for Review に変更
- ユーザのレビュー承認後、`master` にマージ
- マージ後、仕様書 Section 10 に従い Devcontainer で最終検証 (`bun install && bun run typecheck && bun run lint && bun run test && bun run build`)

---

## Self-Review (計画の自己点検)

### 1. 仕様カバレッジ

| 設計仕様書の項 | カバーするタスク |
|---|---|
| §2 スコープ: `src/opencode-plugin.ts` 追加 | Task 2.7 |
| §2 スコープ: `src/runtime/opencode-adapter.ts` 追加 | Task 2.1 + 2.2〜2.6 |
| §2 スコープ: `src/core/loop-error-patterns.ts` 追加 | Task 1.2 |
| §2 スコープ: `package.json` exports/peerDep/devDep/version | Task 1.1 + Task 2.8 |
| §2 スコープ: Adapter 単体 + 統合テスト | Task 2.1〜2.7 (単体) + Task 2.7 (統合) |
| §2 スコープ: README.md / SPEC.md 追記 | Task 2.9 |
| §4 Pure Core 保全 (ESLint) | Task 1.3 |
| §5 フックマッピング表 | Task 2.2 (message.updated) / 2.3 (execute.before) / 2.4 (execute.after) / 2.5 (compacting) / 2.6 (session.error) |
| §5 初期化方針 (lazy + 冪等) | Task 2.1 + Task 2.7 統合テスト |
| §5 ワークスペース解決 + no-op 縮退 | Task 2.1 |
| §6 データフロー 3 シナリオ | Task 2.2〜2.5 単体 + Task 2.7 統合 |
| §7 ログラッパ + Fail-Open | Task 2.1 log wrapper + 各ハンドラタスクの fail-open テスト |
| §8 テスト戦略 4 層 | 各 Task 内で単体 + Task 2.7 で統合 |
| §9 パッケージング | Task 2.8 |
| §11 リスク: 二重初期化時の警告ログ | Task 2.1 で `Justice initialized via opencode-adapter` を出力 |
| §12 未決事項 (`@opencode-ai/plugin` のバージョン) | Task 1.1 Step 2 および Task 2.8 Step 2 で確定 |

### 2. プレースホルダスキャン

- 全 `<PKG_VER>` 参照は Task 1.1/2.8 の実行手順で実測値に置換される仕組みを含む (プレースホルダではなく手順の一部)
- 「TBD」「implement later」等の禁止ワードは含まない

### 3. 型整合

- `OpenCodePluginInit` / `OpenCodeLogEntry` の形状は Task 2.1 で確定し、以降のタスクは同一シグネチャを使用
- `matchesLoopError` シグネチャは Task 1.2 と Task 2.6 で一致
- `OpenCodeAdapter` の public メソッド名 (`onMessageUpdated` / `onToolExecuteBefore` / `onToolExecuteAfter` / `onSessionCompacting` / `onSessionError` / `ensureInitialized` / `log` / `isNoOp` / `getWorkspaceRoot` / `getJustice`) は全タスクで統一

---

**実装時の留意事項:**

- 各 Task は **前 Task のブランチから派生** し、前 Task の Draft PR マージを待たない (ブランチ運用ルール準拠)
- lint エラー (core → `@opencode-ai/plugin` への漏洩) は Task 1.3 のガードで早期検出される
- Task 2.8 の packaging 完了まで `@yohi/justice/opencode` 経由の import はローカル dist でのみ動作 — 統合テスト (Task 2.7) は `src/` からの直接 import で動作することを前提
