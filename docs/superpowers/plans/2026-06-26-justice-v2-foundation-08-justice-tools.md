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
> **Scope:** 人間承認を明示的に取得する、唯一の `justice_review` custom tool。`justice_status`、`justice_gate`、または第 4 の Justice custom tool は導入しない。
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

## Phase 7: Approved Review Resolution Tool

**Base Branch:** `feature/phase7-v2-justice-tools__base`

**目的:** 唯一の `justice_review` custom tool で review summary を照会し、選択した open item の解決だけを人間承認後に記録する。本 Phase は public custom tool を追加しない。

**判断:** Phase 7 は Phase 6 の log store、projection、review aggregator を使用する。承認の trust boundary は `justice_review` 内の `ToolContext.ask` のみであり、Adapter は完全一致する `justice_review` の成功 metadata だけを型付き resolution artifact に昇格する。自由文、tool args、汎用 tool metadata から承認を導出しない。

---

### Superseded Task 7.1: No justice_status Tool

> **Current design:** `justice_status` is not a public Justice custom tool. This retained historical task is superseded by the single-tool contract stated above.

**Files:**

- Create: `src/runtime/justice-tools.ts`
- Modify: `src/runtime/opencode-adapter.ts`（tool hook 登録）
- Test: `tests/runtime/justice-status-tool.test.ts`

**Interfaces:**

- Consumes: `ObservationLogStore.readAll()`, `project`.
- Produces: `justice_status` tool output (projection summary, task statuses, review counts).

- [x] **Step 1: `justice_status` 実装**

> **Note:** 実装では `OpenCodeAdapter` を単一のエントリーポイントとして受け取り、内部で依存を解決する方式に簡略化されています（個別の `store` / `cache` 受け渡しから変更）。

```typescript
// src/runtime/justice-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { toSerializableProjectedState, project } from "../core/v2/state-projection.ts";
import type { OpenCodeAdapter } from "./opencode-adapter";

export function defineJusticeStatusTool(adapter: OpenCodeAdapter): ToolDefinition {
  return tool({
    description: "Justice の現在の投影状態を表示します",
    args: {},
    execute: async (_args, _context) => {
      try {
        await adapter.ensureInitialized();
        const justice = adapter.getJustice();
        if (justice === null) return JSON.stringify({ status: "ERROR", reason: "Justice not initialized" }, null, 2);

        const observationHandler = justice.getObservationHandler();
        const events = await observationHandler.getLogStore().readAll();
        const state = project(events, new Date().toISOString());
        await observationHandler
          .getProjectionCache()
          ?.write(state)
          .catch(() => {});
        return JSON.stringify(toSerializableProjectedState(state), null, 2);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ status: "ERROR", reason: message }, null, 2);
      }
    },
  });
}
```


- [x] **Step 2: adapter に tool 定義を返す `getRegisteredTools()` を実装し、opencode-plugin.ts 側から公開登録（D4）**

> **Note:** 実際の登録は `OpenCodeAdapter` のコンストラクタ内で `defineXxxTool(this)` として呼び出し、最終的な tool map に格納されます。

```typescript
// src/runtime/opencode-adapter.ts
// コンストラクタ内で初期化
this.registeredTools = new Map<string, ToolDefinition>([
  [defineJusticeStatusTool(this).name, defineJusticeStatusTool(this)],
  [defineJusticeGateTool(this).name, defineJusticeGateTool(this)],
  [defineJusticeReviewTool(this).name, defineJusticeReviewTool(this)],
]);

getRegisteredTools(): ReadonlyMap<string, ToolDefinition> {
  return this.registeredTools;
}
```
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

- [x] **Step 2b: justice_status resilience tests**

```typescript
// tests/runtime/justice-status-tool.test.ts
it("fails open and returns ERROR status if log store is corrupted", async () => {
  // 1. Setup store.readAll() to throw ObservationLogIntegrityError
  // 2. Call justice_status execute() and verify it returns JSON with status: "ERROR" and reason.
});

```

- [x] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/justice-status-tool.test.ts
```

- [x] **Step 4: Commit**

```bash
git add package.json bun.lock src/runtime/justice-tools.ts src/runtime/opencode-adapter.ts tests/runtime/justice-status-tool.test.ts
git commit -m "feat(v2): justice_status read-only custom tool"
```

- [x] **Step 5: Phase 7 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase7-v2-justice-tools__base`（Base から派生）。

---

### Superseded Task 7.2: No justice_gate Tool

> **Current design:** `justice_gate` is not a public Justice custom tool. This retained historical task is superseded by the single-tool contract stated above.

**Files:**

- Modify: `src/runtime/justice-tools.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Test: `tests/runtime/justice-gate-tool.test.ts`

**Interfaces:**

- Consumes: `project`, `loadGates`, `evaluate`, `GateContext`.
- Produces: `justice_gate` tool output (current projection dry-run verdict, no DecisionRecord append — D50). Note: `justice_*` tools are explicitly excluded from Observation Log processing in the adapter.

- [x] **Step 1: `justice_gate` 実装（D50）**

> **Note:** 実装では `OpenCodeAdapter` を単一のエントリーポイントとして受け取り、`adapter.getJustice()` から `logStore` と `gateLoader` を取得します。`taskId` は optional に変更され、未指定時は empty gate 評価を行います。

```typescript
// src/runtime/justice-tools.ts
import { tool } from "@opencode-ai/plugin";
import { SessionStateProvider } from "../core/session-state-provider";
import { collectReviewScopes } from "../core/v2/review-scope";
import { evaluate } from "../core/v2/rule-evaluation-engine";
import { project } from "../core/v2/state-projection";
import type { OpenCodeAdapter } from "./opencode-adapter";

export function defineJusticeGateTool(adapter: OpenCodeAdapter): ToolDefinition {
  return tool({
    description: "現 event log から task_complete トリガーの gate を dry-run 評価します",
    args: { taskId: tool.schema.string().optional() },
    execute: async ({ taskId }, context) => {
      try {
        await adapter.ensureInitialized();
        const justice = adapter.getJustice();
        if (justice === null) return JSON.stringify({ status: "ERROR", reason: "Justice not initialized" }, null, 2);

        const scopedTaskId = taskId?.length ? taskId : undefined;
        if (scopedTaskId === undefined) {
          return JSON.stringify(
            evaluate([], [], {
              trigger: "task_complete",
              taskId: undefined,
              agentId: SessionStateProvider.resolveAgentId(context.agent),
              sessionId: context.sessionID,
              reviewScope: [],
            }),
            null,
            2,
          );
        }

        const observationHandler = justice.getObservationHandler();
        const gateLoader = observationHandler.getGateLoader();
        if (gateLoader === undefined) return JSON.stringify({ status: "ERROR", reason: "Gate loader not configured" }, null, 2);

        const events = await observationHandler.getLogStore().readAll();
        const state = project(events, new Date().toISOString());
        const gates = await gateLoader.load();
        const gateContext = {
          trigger: "task_complete" as const,
          taskId: scopedTaskId,
          agentId: SessionStateProvider.resolveAgentId(context.agent),
          sessionId: context.sessionID,
          reviewScope: collectReviewScopes(state, scopedTaskId),
          reviewSummary: state.reviewSummary,
        };
        const evidence = state.tasks.get(scopedTaskId)?.evidence ?? [];
        return JSON.stringify(evaluate(gates, evidence, gateContext), null, 2);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ status: "ERROR", reason: message }, null, 2);
      }
    },
  });
}
```


- [x] **Step 1.5: justice_gate resilience tests**

```typescript
// tests/runtime/justice-gate-tool.test.ts
it("fails open and returns ERROR status if log store is corrupted", async () => {
  // 1. Setup store.readAll() to throw ObservationLogIntegrityError
  // 2. Call justice_gate execute() and verify it returns JSON with status: "ERROR" and reason.
});
```

- [x] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/justice-gate-tool.test.ts
```

- [x] **Step 3: Commit**

```bash
git add src/runtime/justice-tools.ts src/runtime/opencode-adapter.ts tests/runtime/justice-gate-tool.test.ts
git commit -m "feat(v2): justice_gate dry-run tool"
```

- [x] **Step 4: Phase 7 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 7.1`（直前 Task から派生）。同じ `justice-tools.ts` / `opencode-adapter.ts` を編集するため。

---

### Task 7.3: Sole justice_review Tool

> **Current approval contract (supersedes the legacy read-only sketch below):**
>
> - `justice_review` is the sole public Justice custom tool; no fourth tool is added.
> - A resolution is emitted only after `ToolContext.ask` succeeds for `justice_review.resolve`. The request carries the selected currently-open `itemKeys`, `reviewScope`, and `artifactRef`.
> - Denial returns an informational `ERROR` result with no metadata. Approval produces the human-approved artifact, which flows through `tool.execute.after` to resolve only those selected open items.
> - `OpenCodeAdapter` trusts metadata only when the producing tool name is exactly `justice_review`; generic metadata remains untyped. The resolution path creates no `tool_executed` observation and leaves gate semantics unchanged.

**Files:**

- Modify: `src/runtime/justice-tools.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Test: `tests/runtime/justice-review-tool.test.ts`

**Interfaces:**

- Consumes: `project`, `ReviewSummary`.
- Produces: `justice_review` tool output (Review Summary Artifact rendering).

- [x] **Step 1: `justice_review` 実装**

> **Note:** 実装では `OpenCodeAdapter` を単一のエントリーポイントとして受け取り、さらに `resolve` パラメータ（承認付き解決フロー）が追加されています。解決フローでは `Effect.runPromise(context.ask(approval))` による人間承認を取得します。

```typescript
// src/runtime/justice-tools.ts
import { tool } from "@opencode-ai/plugin";
import { Effect } from "effect";
import { normalizeReviewResolutionArtifact } from "../core/review-resolution-artifact";
import { project } from "../core/v2/state-projection";
import type { OpenCodeAdapter } from "./opencode-adapter";

export function defineJusticeReviewTool(adapter: OpenCodeAdapter): ToolDefinition {
  return tool({
    description: "Review Summary Artifact を表示・解決します",
    args: {
      scope: tool.schema.string().optional(),
      resolve: tool.schema
        .object({
          itemKeys: tool.schema.array(tool.schema.string()),
          artifactRef: tool.schema.string(),
        })
        .optional(),
    },
    execute: async (args, context) => {
      try {
        await adapter.ensureInitialized();
        const justice = adapter.getJustice();
        if (justice === null) return JSON.stringify({ status: "ERROR", reason: "Justice not initialized" }, null, 2);

        const observationHandler = justice.getObservationHandler();
        // 実際の execute 処理は executeJusticeReviewTool に委譲
        return await executeJusticeReviewTool({
          logReader: observationHandler.getLogStore(),
          args,
          requestApproval: async (approval) => {
            await Effect.runPromise(context.ask(approval));
          },
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ status: "ERROR", reason: message }, null, 2);
      }
    },
  });
}
```


- [x] **Step 1.5: justice_review approval-boundary tests**

```typescript
// tests/runtime/justice-review-tool.test.ts
it("fails open and returns ERROR status if log store is corrupted", async () => {
  // 1. Setup store.readAll() to throw ObservationLogIntegrityError
  // 2. Call justice_review execute() and verify it returns JSON with status: "ERROR" and reason.
});
```

- [x] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/justice-review-tool.test.ts tests/integration/approved-review-resolution.test.ts
```

- [x] **Step 3: Commit**

```bash
git add src/runtime/justice-tools.ts src/runtime/opencode-adapter.ts tests/runtime/justice-review-tool.test.ts
git commit -m "feat(v2): justice_review tool"
```

- [x] **Step 4: Phase 7 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 7.2`（直前 Task から派生）。

---
