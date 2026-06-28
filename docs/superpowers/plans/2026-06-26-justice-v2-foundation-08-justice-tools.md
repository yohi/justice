# Justice v2.0 Foundation 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Git workflow:** 本計画は Graphite Stacked PR Workflow に厳密に準拠します。1 タスク 200 LOC 制限、ブランチ命名 `feature/phaseN-v2-...__base` / `feature/phaseN-taskM-...`、各 Task 完了時は `gt submit` で Phase Base 向け Draft PR を作成・更新します。
> **Devcontainer 強制:** すべてのテスト・型検査・静的解析は **Devcontainer 内**で実行すること。ローカルホストでの実行は認めない。

**Goal:** Justice v2.0 Foundation 設計書（`docs/superpowers/specs/2026-06-16-justice-v2-foundation-design.md`）を実装し、既存 563 テストを壊さずに Quality Control Plane の基盤層を追加する。

**Architecture:** 加算シャドウ（dual）アプローチ。新 Observation Log + projection spine を既存 plan-bridge/task-feedback/wisdom と並走追加。Core は純粋関数・I/O 非依存。Hook は観測を捕捉し Core へ委譲。Runtime は per-writer segment JSONL への atomic append + readAll merge を担う。v2.0 は L0 advisory のみ（非ブロッキング）。

**Tech Stack:** TypeScript, Bun, Vitest, `@opencode-ai/plugin`, ESLint, Prettier, Devcontainer（`oven/bun:1`）, GitHub Actions (`ubuntu-slim`).

---

## Global Constraints

- 既存 563 テストは不変（回帰なし）。
- Core（`src/core/`）は `@opencode-ai/*` を import しない（FF-001）。
- すべての file I/O は `FileReader` / `FileWriter` 経由。テストでは mock を注入（`tests/helpers/mock-file-system.ts`）。`FileReader` は `readFile` / `fileExists` / `listFiles(prefix)` を提供する。（例外として、テストコードにおけるリポジトリの静的ファイル（ADR等）の存在確認やアーキテクチャ検証目的の読取に限り、Node.js の `fs` モジュールの直接使用を許可します）。
- 状態は immutable（`readonly` / `ReadonlyArray` / `ReadonlyMap`）。
- すべての fail-open 境界は `try/catch` で保護し、`PROCEED` に縮退する。
- 永続化前に SecretPatternDetector で redaction + 絶対パス redaction + truncation を実施（D25/D61）。
- `declared` provenance は gate 充足（PASS）に算入しない。PASS に算入するのは `observed` / `derived`（`derived` は observed 起源限定）のみ（FF-008）。
- `devcontainer` 内でのみ `bun run lint` / `typecheck` / `test` / `build` を実行する。
- ブランチ運用は [Graphite Stacked PR Workflow](https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnS4oioAtOOsRFxbhj7DasZszJsUzA6R74JH66RtuaZljfMTOMp01vNhWjcaM0hMPMpWGtEG2CqCiJRKUnxfpUq5IKUvCuw8ckJxEzV_S-lANVqatSiXDyPIwACDWLiYMx_FxpOVwVe-lN3OEfYJMKFB1HyzYW__8mfULCRcQthYXlSoLzc6GHSwYYLtJOMVUh3x34AuPc1rdosiFf2YYStsXJoCj9-iTs7BjmJ0E_-omFWTGPH0uOK-AXq_XLLxAltwuQt-Ct5q_9u-w_QBPhX7UxyHYfZJSstDIFryh_4uUFWBdWMCh0TSrYJxTw&lib=M0tqVErYg9kMB9ia8bpbmo4TD2knUOGjU) を使用。1 タスク 200 LOC 制限、命名 `feature/phaseN-taskM-...`、Base ブランチ `feature/phaseN-...__base`。各 Task 最後は **Phase Base に向けた Draft PR 作成**。

> **Graphite 運用詳細:**
>
> - Base ブランチは、最初の Phase 0 は `master` から `gt checkout master && gt trunk && gt branch create feature/phase0-v2-baseline__base` で作成しますが、後続の Phase N+1 の Base ブランチは、前 Phase N の最終 Task ブランチ（前 Phase の全実装を含む状態）を起点として分岐させて作成します。これにより、次 Phase が前 Phase の実装成果を確実に含むようにします。
> - 各 Task ブランチは Phase Base から `gt checkout feature/phaseN-v2-...__base && gt branch create feature/phaseN-taskM-...` で分岐（Phase 内で連続する Task は直前 Task から分岐）。
> - タスク完了時は `gt add . && gt commit` 後、`gt submit` で Phase Base 向け Draft PR を一括作成・更新する。
> - 下位 Task を修正した場合は `gt restack` で上位スタックを再整列する。
> - 本計画内の「Phase Base に向けた Draft PR を作成する」は `gt submit` による Draft PR 作成を指す。

---

> **Split plan:** This file is part 08 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** Read-only justice_status, justice_gate, and justice_review custom tools.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

## Phase 7: Justice Tools

**Base Branch:** `feature/phase7-v2-justice-tools__base`

**目的:** `justice_status`, `justice_gate`, `justice_review` の read-only custom tool を実装。本 Phase だけで on-demand な照会機能が完成する。

**判断:** Phase 7 は Phase 2/3/5/6 の log store, projection, rule engine, review aggregator を使用。Task 7.1 は projection 読取（Phase 2）なので Base から、Task 7.2 は 7.1 + Phase 5 engine なので Task 7.1 から、Task 7.3 は 7.1 + Phase 6 aggregator なので Task 7.1 から。実際には Phase 7 Base は Phase 6 Base から派生し、Task 7.1 はその Base から分岐。Phase 7 内では 7.1 → 7.2 → 7.3 と積み上げる。

---

### Task 7.1: justice_status Tool

**Files:**

- Create: `src/runtime/justice-tools.ts`
- Modify: `src/runtime/opencode-adapter.ts`（tool hook 登録）
- Test: `tests/runtime/justice-status-tool.test.ts`

**Interfaces:**

- Consumes: `ObservationLogStore.readAll()`, `project`.
- Produces: `justice_status` tool output (projection summary, task statuses, review counts).

- [ ] **Step 1: `justice_status` 実装**

```typescript
// src/runtime/justice-tools.ts
import { z } from "zod";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { toSerializableProjectedState } from "../core/v2/state-projection.ts";

export function defineJusticeStatusTool(store: ObservationLogStore, cache: StateProjectionCache): ToolDefinition {
  return {
    description: "Justice の現在の投影状態を表示します",
    args: {},
    execute: async () => {
      try {
        const events = await store.readAll();
        const state = project(events, new Date().toISOString());
        await cache.write(state).catch(() => {});
        return JSON.stringify(toSerializableProjectedState(state), null, 2);
      } catch (err: any) {
        return JSON.stringify({ status: "ERROR", reason: err?.message ?? String(err) }, null, 2);
      }
    },
  };
}
```

- [ ] **Step 2: adapter に tool 定義を返す getTools() を実装し、opencode-plugin.ts 側から公開登録（D4）**

```typescript
// src/runtime/opencode-adapter.ts
getTools(): Record<string, ToolDefinition> {
  return {
    justice_status: defineJusticeStatusTool(this.logStore, this.projectionCache),
    // justice_gate / justice_review added in later tasks
  };
}

// src/opencode-plugin.ts (plugin return object)
return {
  tool: adapter.getTools(),
  event: async (input) => { ... },
  ...
};
```

- [ ] **Step 2b: justice_status resilience tests**

```typescript
// tests/runtime/justice-status-tool.test.ts
it("fails open and returns ERROR status if log store is corrupted", async () => {
  // 1. Setup store.readAll() to throw ObservationLogIntegrityError
  // 2. Call justice_status execute() and verify it returns JSON with status: "ERROR" and reason.
});

it("uses current ISO timestamp for rebuilding state during production runs", async () => {
  // 1. Mock global Date.prototype.toISOString to return a fixed mock clock.
  // 2. Verify that project is called with the mock date.
});
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/justice-status-tool.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/runtime/justice-tools.ts src/runtime/opencode-adapter.ts tests/runtime/justice-status-tool.test.ts
git commit -m "feat(v2): justice_status read-only custom tool"
```

- [ ] **Step 5: Phase 7 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase7-v2-justice-tools__base`（Base から派生）。

---

### Task 7.2: justice_gate Tool (Dry-Run)

**Files:**

- Modify: `src/runtime/justice-tools.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Test: `tests/runtime/justice-gate-tool.test.ts`

**Interfaces:**

- Consumes: `project`, `loadGates`, `evaluate`, `GateContext`.
- Produces: `justice_gate` tool output (current projection dry-run verdict, no DecisionRecord append — D50). Note: `justice_*` tools are explicitly excluded from Observation Log processing in the adapter.

- [ ] **Step 1: `justice_gate` 実装（D50）**

```typescript
export function defineJusticeGateTool(store: ObservationLogStore, gateLoader: GateLoader): ToolDefinition {
  return {
    description: "現 event log から gate を dry-run 評価します",
    args: { taskId: z.string() },
    execute: async ({ taskId }) => {
      if (typeof taskId !== "string" || taskId.length === 0) {
        return JSON.stringify({ status: "SKIP", ruleResults: [], reason: "no taskId provided" }, null, 2);
      }
      try {
        const events = await store.readAll();
        const state = project(events, new Date().toISOString());
        const gates = await gateLoader.load();
        const ctx: GateContext = { trigger: "task_complete", taskId, agentId: "unknown", sessionId: "unknown", reviewScope: collectReviewScopes(state, taskId), reviewSummary: state.reviewSummary };
        const evidence = state.tasks.get(taskId)?.evidence ?? [];
        const verdict = evaluate(gates, evidence, ctx);
        return JSON.stringify(verdict, null, 2);
      } catch (err: any) {
        return JSON.stringify({ status: "ERROR", reason: err?.message ?? String(err) }, null, 2);
      }
    },
  };
}
```

- [ ] **Step 1.5: justice_gate resilience tests**

```typescript
// tests/runtime/justice-gate-tool.test.ts
it("fails open and returns ERROR status if log store is corrupted", async () => {
  // 1. Setup store.readAll() to throw ObservationLogIntegrityError
  // 2. Call justice_gate execute() and verify it returns JSON with status: "ERROR" and reason.
});
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/justice-gate-tool.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/runtime/justice-tools.ts src/runtime/opencode-adapter.ts tests/runtime/justice-gate-tool.test.ts
git commit -m "feat(v2): justice_gate dry-run tool"
```

- [ ] **Step 4: Phase 7 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 7.1`（直前 Task から派生）。同じ `justice-tools.ts` / `opencode-adapter.ts` を編集するため。

---

### Task 7.3: justice_review Tool

**Files:**

- Modify: `src/runtime/justice-tools.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Test: `tests/runtime/justice-review-tool.test.ts`

**Interfaces:**

- Consumes: `project`, `ReviewSummary`.
- Produces: `justice_review` tool output (Review Summary Artifact rendering).

- [ ] **Step 1: `justice_review` 実装**

```typescript
export function defineJusticeReviewTool(store: ObservationLogStore): ToolDefinition {
  return {
    description: "Review Summary Artifact を表示します",
    args: { scope: z.string().optional() },
    execute: async ({ scope }) => {
      try {
        const events = await store.readAll();
        const state = project(events, new Date().toISOString());
        const summary = scope
          ? state.reviewSummary.byScope.get(scope)
          : { ...state.reviewSummary, byScope: Object.fromEntries(state.reviewSummary.byScope) };
        return JSON.stringify(summary, null, 2);
      } catch (err: any) {
        return JSON.stringify({ status: "ERROR", reason: err?.message ?? String(err) }, null, 2);
      }
    },
  };
}
```

- [ ] **Step 1.5: justice_review resilience tests**

```typescript
// tests/runtime/justice-review-tool.test.ts
it("fails open and returns ERROR status if log store is corrupted", async () => {
  // 1. Setup store.readAll() to throw ObservationLogIntegrityError
  // 2. Call justice_review execute() and verify it returns JSON with status: "ERROR" and reason.
});
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/justice-review-tool.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/runtime/justice-tools.ts src/runtime/opencode-adapter.ts tests/runtime/justice-review-tool.test.ts
git commit -m "feat(v2): justice_review tool"
```

- [ ] **Step 4: Phase 7 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 7.2`（直前 Task から派生）。

---
