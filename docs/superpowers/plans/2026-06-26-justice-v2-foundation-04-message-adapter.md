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

> **Split plan:** This file is part 04 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** Message role buffering, OpenCode adapter routing, plugin response merging, and agent/session mapping.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

## Phase 3: Message / Role Handling + Adapter Routing

**Base Branch:** `feature/phase3-v2-message-adapter__base`

**目的:** Message 観測の role 相関、adapter 拡張、JusticePlugin の routing ガードを実装。本 Phase だけで message 系 declared evidence と adapter 配線が検証できる。

**判断:** Phase 3 は Phase 2 の log store を使用する。Task 3.1 は pure message バッファなので Base から、Task 3.2 は 3.1 の出力バッファを使用するため Task 3.1 から、Task 3.3 は 3.2 の拡張アダプタを使用するため Task 3.2 から派生。整理すると: 3.1 Base, 3.2 Task 3.1（直前）, 3.3 Task 3.2（直前）から派生。

---

### Task 3.1: MessageRoleBuffer + Declared Extraction

**Files:**

- Create: `src/runtime/message-role-buffer.ts` (Core 純粋性を維持するため、mutable なバッファは runtime 配下に配置する)
- Modify: `src/core/v2/declared-claim-extractor.ts`（finalized 後の抽出ロジックおよび純粋関数を定義）
- Test: `tests/runtime/message-role-buffer.test.ts`

**Interfaces:**

- Consumes: `ObservationMessagePayload` union (from Task 1.1), `extractDeclaredClaims`.
- Produces:
  - `MessageRoleBuffer` class (in `src/runtime/`) with `{sessionId, messageID}` key, `parts: Map<partID, {text, finalized}>`.
  - `extractFinalizedAssistantClaims(buffer, messageID, partID): DeclaredClaim[]` (implemented in `src/core/v2/declared-claim-extractor.ts` as a pure function).

- [x] **Step 1: Message payload union を確認（D71）**
  - Task 1.1 で前倒し実装した `src/core/v2/message-payload.ts` の `ObservationMessagePayload` をそのままインポートして利用できることを確認します。

- [x] **Step 1b: `observation-model.ts` の `MessageRecord` を詳細化（D71）**

Task 1.1 で stub とした `MessageRecord` を、Phase 0 spike で確定した adapter 契約に基づいて具体的なフィールドに拡張する。

```typescript
// src/core/v2/observation-model.ts
export type MessageRecord = {
  readonly kind: "message";
  readonly messageID: string;
  readonly partID?: string;
  readonly role: "assistant"; // fixed per D22
  readonly textHash: string; // required per D34
  readonly textSnippet?: string;
  readonly declaredClaims: readonly DeclaredClaim[]; // D70: 軽量な申告のリスト
  readonly evidence: readonly DeclaredClaimEvidence[]; // 1 claim = 1 Evidence per D59/D70
  readonly finalized: boolean;
};
```

- [x] **Step 2: MessageRoleBuffer を実装（D53/D65/D67）**
- [x] **Step 2a: MessageRoleBuffer の GC トリガを ObservationHandler に配線（D65）**

MessageRoleBuffer の動作仕様：
- 内部構造：
  `key` は `${sessionId}:${messageId}` の形式の文字列。
  各エントリは `{ role?: "assistant" | "user", parts: Map<string, { text: string, finalized: boolean }>, lastUpdatedAt: number, finalized: boolean }`。
- `update(sessionId, payload)`:
  - `key` が存在しない場合は新規作成。
  - `payload.kind` に応じて分岐処理を行う：
    - `"message_part_updated"`: `payload.partId` ごとに `parts` の `{ text: payload.text, finalized: false }` を上書き。
    - `"text_complete"`: `payload.partId` ごとに `parts` の `{ text: payload.text, finalized: true }` を上書き。
    - `"message_updated"`: `payload.role` が提供された場合はバッファの `role` に反映し、`payload.finalized` が `true` の場合はメッセージ全体の `finalized` フラグを `true` に設定する。
  - `lastUpdatedAt` を現在のタイムスタンプ（ミリ秒）に更新。
- `finalize(sessionId, messageId, partId?)`:
  - `partId` が指定された場合は、該当する `part` の `finalized` を `true` に設定。全 part が finalized かつ `message` 自体が finalized と判定された場合、または `partId` 未指定で呼び出された場合は、メッセージ全体を `finalized = true` とする。
- `extractAssistantClaims(sessionId, messageId, partId?)`:
  - バッファから該当メッセージを取得。`role !== "assistant"` の場合は空配列 `[]` を返す。
  - `partId` が指定されている場合はその part のテキストから、未指定の場合は全 part のテキストを partID 順に結合したテキストから、`tests pass` などの申告パターン（D70）を検出。
  - 戻り値：`DeclaredClaim[]` のリスト。各 claim は `{ evidenceId: string, claimKind: "test" | "build", outcome: "pass" | "fail" }` の形状。
  - 重複排除 (D67): 同一 `partId` が更新された場合、前回の抽出結果を破棄して最新のテキスト状態から再判定。確定 (finalized) 時に初めて永続化対象となる。
- `getFinalizedText(sessionId, messageId, partId?)` / `getFinalizedAssistantText(...)`:
  - メッセージ全体、または指定された part が `finalized === true` である場合のみ、テキストを結合して返す。role が assistant でない場合は `undefined`。
- `gc(maxAgeMs, maxEntries)`:
  - `Date.now() - lastUpdatedAt > maxAgeMs` となる古いエントリを削除。
  - エントリ数が `maxEntries` を超える場合、`lastUpdatedAt` が古い順にエントリを削除。

```typescript
// src/runtime/message-role-buffer.ts
export class MessageRoleBuffer {
  private readonly buffer = new Map<string, {
    role?: "assistant" | "user";
    readonly parts: Map<string, { text: string; finalized: boolean }>;
    lastUpdatedAt: number;
    finalized: boolean;
  }>();

  update(sessionId: string, payload: ObservationMessagePayload): void;
  finalize(sessionId: string, messageId: string, partId?: string): void;
  extractAssistantClaims(sessionId: string, messageId: string, partId?: string): DeclaredClaim[];
  getFinalizedText(sessionId: string, messageId: string, partId?: string): string | undefined;
  getFinalizedAssistantText(sessionId: string, messageId: string, partId?: string): string | undefined;
  gc(maxAgeMs: number, maxEntries: number): void;
}
```

- [x] **Step 2.5: MessageRoleBuffer の D67 確定・重複排除（dedup）および role フィルタリングのテスト実装**
- `tests/runtime/message-role-buffer.test.ts` にテストケースを追加し、同一 `(sessionId, messageId, partId)` でストリーミング中に一度「tests pass」と判定された後、同じ partId の更新テキストにより「tests fail」へと修正された場合、あるいはその逆において、最終確定（finalize/finish）時に古い claim が残らず最新の確定状態に基づく claim に正しく置換されること（重複排除）を担保する。
- さらに、role が未確定 / user の場合、または claims が空の場合における `extractAssistantClaims` は空配列を返し、assistant かつ finalized の場合の `getFinalizedAssistantText` は claims が空でも本文を返すことを明示的に検証する。

- [x] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/message-role-buffer.test.ts
```

- [x] **Step 4: Commit**

```bash
git add src/runtime/message-role-buffer.ts src/core/v2/declared-claim-extractor.ts src/core/v2/observation-model.ts tests/runtime/message-role-buffer.test.ts
git commit -m "feat(v2): message role buffer and finalized declared extraction"
```

- [x] **Step 5: Phase 3 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase3-v2-message-adapter__base`（Base から派生）。

---

### Task 3.2: Adapter Extension (Tool Filter Removal + Message Routing)

**Files:**

- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`

**Interfaces:**

- Consumes: `ObservationMessagePayload` from Task 1.1, `ObservationLogStore` from Phase 2, existing `HookEvent` types from `src/core/types.ts`, `allocateWriterId` from Task 2.1.
- Produces:
  - `ToolObservationPayload` type: `{ toolName: string; callId: string; toolInput?: Record<string, unknown>; toolResult?: string; metadata?: { readonly error?: boolean; readonly output?: string; readonly metadata?: Record<string, unknown> }; error?: boolean }`.
  - `onToolExecuteBefore/After` no longer filters `tool !== "task"` but explicitly excludes query tools matching `justice_*`; all other tools are converted to `ToolObservationPayload` and forwarded to `JusticePlugin.handleEvent` as `PreToolUse` / `PostToolUse` events to prevent query commands from altering the canonical Observation Log (D50).
  - `onMessage` / `onMessagePartUpdated` / `onTextComplete` hooks produce `ObservationMessagePayload` and forward to `JusticePlugin.handleEvent({ type: "Message" })` alongside the existing user-message path (handled in Task 3.3).
  - Triggers `AgentMapped` event forwarding when observing `agent` property in message parameters (`chat.params` / `chat.message`) (D48, FIND-001).
  - `onSessionError` forwards to `JusticePlugin.handleEvent({ type: "Event", event: "session.error" })`.
  - Captures `HookResponse` from `handleEvent` and applies `injectedContext` / notifier banner / best-effort `output.output` append in deterministic handler order (D47/D64).
  - Sets the default value of `options.enableAdvisoryOutputAppend` based on C1 spike results (Task 0.2 Step 1b). If C1 shows banner is not visible in user-facing context, it defaults to false; otherwise true (D47).
  - Step 1 implementation includes tests asserting that when `options.enableAdvisoryOutputAppend` is false, `notifier.notify()` executes normally while `output.output` remains unmodified (D47).
  - Bootstraps global unique `writerId` dynamically resolved during initialization and threads it through `JusticePluginOptions` into both `ObservationLogStore` and `ObservationHandler` to satisfy structural invariants (D55/D39/指摘3).

- [x] **Step 0: Define `ToolObservationPayload` and adapter conversion helpers, and update `src/core/types.ts` & `src/core/justice-plugin.ts` (ISS-002)**

Update `PostToolUsePayload` and `PreToolUsePayload` in `src/core/types.ts` to include the fields the adapter now forwards: `callId`, `toolInput` (Pre/Post), `toolResult`, and `metadata` (Post).
Also add `AgentMappedEvent` type to `src/core/types.ts` and include it in the `HookEvent` union type.
In `src/core/justice-plugin.ts` (`handleEvent`), add a fallback handling case for `"AgentMapped"` to proceed without error until its state mapping is fully implemented in Task 3.4. This keeps `observation-handler` type-safe and avoids compilation errors.
In `src/core/justice-plugin.ts` `JusticePluginOptions`, add an optional field `writerId?: string`.

- [x] **Step 0b: Runtime/bootstrap 初期化配線と `writerId` の割当（D55/D39/指摘3）**

`src/runtime/opencode-adapter.ts` の lazy-initialization フェーズにて以下を実装する：
```typescript
import { allocateWriterId } from "./writer-id.ts";

// Inside lazy initialization (#runInit):
const writerId = await allocateWriterId(localFs, { agentId: "system", sessionId: "system" });
const justice = new JusticePlugin(localFs, localFs, {
  logger: loggerAdapter,
  onError: (err) => { ... },
  globalFileSystem: globalFs ?? undefined,
  notifier,
  writerId, // Shared writerId for both ObservationLogStore and ObservationHandler
});
```
これにより、`ObservationLogStore` と `ObservationHandler` で同一の `writerId` が配線されることを保証する。テスト `tests/runtime/opencode-adapter-v2.test.ts` で起動時に同一の `writerId` が配線されることを確認する。

```typescript
// src/runtime/opencode-adapter.ts
type ToolObservationPayload = {
  readonly toolName: string;
  readonly callId: string;
  readonly toolInput?: Record<string, unknown>;
  readonly toolResult?: string;
  readonly metadata?: { readonly error?: boolean; readonly output?: string; readonly metadata?: Record<string, unknown> };
  readonly error?: boolean;
};

type ToolObservationInput = {
  readonly tool: string;
  readonly callID: string;
  readonly sessionID: string;
  readonly args: Record<string, unknown>;
};

function toPreToolObservationPayload(
  input: ToolObservationInput,
  output: { readonly args: Record<string, unknown> }
): PreToolUseEvent {
  return {
    type: "PreToolUse",
    sessionId: input.sessionID,
    callId: input.callID,
    payload: { toolName: input.tool, callId: input.callID, toolInput: output.args },
  };
}

function toPostToolObservationPayload(
  input: ToolObservationInput,
  output: { output: string; readonly metadata?: Record<string, unknown> }
): PostToolUseEvent {
  return {
    type: "PostToolUse",
    sessionId: input.sessionID,
    callId: input.callID,
    payload: {
      toolName: input.tool,
      callId: input.callID,
      toolInput: input.args,
      toolResult: output.output,
      metadata: output.metadata,
    },
  };
}
```

- [x] **Step 1: 既存 adapter の tool フィルタを撤廃**

```typescript
// src/runtime/opencode-adapter.ts
onToolExecuteBefore: async (input, output) => {
  if (input.tool.startsWith("justice_")) return;
  const response = await this.plugin.handleEvent(toPreToolObservationPayload(input, output));
  if (response.action !== "inject") return;
  // apply modifiedPayload.args to output.args if present
  const modified = response.modifiedPayload as { args?: Record<string, unknown> } | undefined;
  if (!modified?.args) return;
  for (const [key, value] of Object.entries(modified.args)) {
    // eslint-disable-next-line security/detect-object-injection
    output.args[key] = value;
  }
},
onToolExecuteAfter: async (input, output) => {
  if (input.tool.startsWith("justice_")) return;
  const response = await this.plugin.handleEvent(toPostToolObservationPayload(input, output));
  // (1) guaranteed channel: notifier banner (fail-open try/catch)
  if (response.action === "inject" && (response as unknown as { readonly variant?: string }).variant === "gate_advisory") {
    try {
      await this.notifier.notify({
        level: "warning",
        variant: "justice_gate",
        title: "Task Gate",
        message: response.injectedContext,
        sessionId: input.sessionID,
        taskId: "unknown",
      });
    } catch (err: unknown) {
      this.logger.warn("notifier.notify failed", err);
    }
  }
  // (2) best-effort channel: append banner to output.output (gated by C1 spike result)
  if (this.options.enableAdvisoryOutputAppend && response.action === "inject" && (response as unknown as { readonly variant?: string }).variant === "gate_advisory" && response.injectedContext && typeof output.output === "string") {
    const banner = this.notifier.formatBanner({
      level: "warning",
      variant: "justice_gate",
      title: "Task Gate",
      message: response.injectedContext,
    });
    output.output = output.output + "\n\n" + banner;
  }
  return response;
},
```

- [x] **Step 2: message / session.error イベントを追加（既存 user message 経路は維持し、状態確定イベントを分離）**

```typescript
onMessagePartUpdated: async (event) => {
  await this.plugin.handleEvent({ type: "Message", sessionId: event.sessionId, payload: { kind: "message_part_updated", messageID: event.messageID, partID: event.partID, text: event.text } });
},
onMessageUpdated: async (event) => {
  // Translate and forward AgentMapped event if agent property is present (D48, FIND-001)
  const agentName = event.message.agent || event.properties?.info?.agent || event.properties?.params?.agent;
  if (agentName) {
    await this.plugin.handleEvent({
      type: "AgentMapped",
      payload: { sessionId: event.sessionId, agentName }
    });
  }

  // Translate to ObservationMessagePayload with kind "message_updated" to propagate role & finalized metadata (ISS-002)
  // Map finalized=true if finish indicator is present (e.g. AssistantMessage.finish / time.completed based on Phase 0 spike)
  const isFinalized = !!(event.message.finish || event.time?.completed || event.message.finalized);
  if (event.message.role === "assistant") {
    await this.plugin.handleEvent({
      type: "Message",
      sessionId: event.sessionId,
      payload: {
        kind: "message_updated",
        messageID: event.messageID,
        role: "assistant",
        finalized: isFinalized
      }
    });
  }
},
// ...
```

`onMessage`（`message.updated`）は既存の `{ role, content }` 形式の `MessageEvent` ではなく、メタデータ伝播のために `kind: "message_updated"` を含む `ObservationMessagePayload` として `JusticePlugin.handleEvent` に送出します。一方で、plan-bridge の委譲トリガーを維持するための `role`/`content` 形式の user message 経路は別途維持されます。

**型更新:** `src/core/types.ts` の `MessageEvent` payload を `{ role, content } | ObservationMessagePayload` の union に拡張し、`handleEvent` が型安全に分岐できるようにする。

- [x] **Step 3: PostToolUse 戻り値を adapter で適用（D47/D64）— Step 1 と統合済み**

(Step 1 の `onToolExecuteAfter` に統合。重複する独立ステップは削除。)


- [x] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/opencode-adapter-v2.test.ts
```

- [x] **Step 5: Commit**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter-v2.test.ts
git commit -m "feat(v2): adapter forwards all tool and message events"
```

- [x] **Step 6: Phase 3 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase3-task1-message-role-buffer`（Task 3.1 から派生）。

---

### Task 3.3: JusticePlugin Routing Guard

**Files:**

- Modify: `src/core/justice-plugin.ts`
- Create: `src/hooks/observation-handler.ts`（最小の stub）
- Test: `tests/core/justice-plugin-routing.test.ts`
- Test: `tests/core/v2/post-tool-use-merge.test.ts`

**Interfaces:**

- Consumes: `PlanBridge.handleMessage`, `PlanBridge.handlePreToolUse`, `PlanBridge.handlePostToolUse`, `TaskFeedbackHandler.handlePostToolUse`, new `observation-handler`.
- Produces:
- `mergePreToolUseResponses(a, b)` and `mergeMessageResponses(a, b)` helpers.
- `mergePostToolUseResponses(responses)` helper.
- `handleEvent` routes:
  - `PreToolUse`: observation-handler + (if toolName === "task") plan-bridge, merged via `mergePreToolUseResponses`.
  - `PostToolUse`: observation-handler + (if toolName === "task") plan-bridge + task-feedback, merged via `mergePostToolUseResponses`.
  - `Message`: routed selectively based on payload type: UserMessage is forwarded to `planBridge.handleMessage(event)` (existing delegation triggers), while helper observation payloads are forwarded to `observationHandler.handleMessage(event.sessionId, payload)` (declared claim extraction).
  - `Event`: existing handlers unchanged.

- [x] **Step 0: Add `mergePreToolUseResponses` and `mergePostToolUseResponses` helpers**

```typescript
// src/core/justice-plugin.ts
function mergePreToolUseResponses(a: HookResponse, b: HookResponse): HookResponse {
  if (a.action === "skip" || b.action === "skip") return { action: "skip" };
  if (a.action === "inject" && b.action === "inject") {
    const contexts = [a.injectedContext, b.injectedContext].filter((c) => c !== "");
    const result: InjectResponse = { action: "inject", injectedContext: contexts.join("\n\n---\n\n") };
    if (
      (a as unknown as { readonly variant?: string }).variant === "gate_advisory" ||
      (b as unknown as { readonly variant?: string }).variant === "gate_advisory"
    ) {
      (result as unknown as { variant?: string }).variant = "gate_advisory";
    }
    if (a.modifiedPayload !== undefined && b.modifiedPayload !== undefined) {
      throw new Error("Conflict detected in pre-tool-use modifiedPayload");
    }
    if (a.modifiedPayload !== undefined) return { ...result, modifiedPayload: a.modifiedPayload };
    if (b.modifiedPayload !== undefined) return { ...result, modifiedPayload: b.modifiedPayload };
    return result;
  }
  if (a.action === "inject") return { ...a };
  if (b.action === "inject") return { ...b };
  return { action: "proceed" };
}

export function mergePostToolUseResponses(responses: HookResponse[]): HookResponse {
  if (responses.some((r) => r.action === "skip")) return { action: "skip" };
  const injects = responses.filter((r): r is InjectResponse => r.action === "inject");
  if (injects.length > 0) {
    const contexts = injects.map((i) => i.injectedContext).filter((c) => c !== "");
    const result: InjectResponse = { action: "inject", injectedContext: contexts.join("\n\n---\n\n") };
    const gateAdvisory = injects.find((i) => (i as unknown as { readonly variant?: string }).variant === "gate_advisory");
    if (gateAdvisory) {
      (result as unknown as { variant?: string }).variant = "gate_advisory";
    }
    const modifieds = injects.filter((i) => i.modifiedPayload !== undefined);
    if (modifieds.length > 0) {
      if (modifieds.length > 1) {
        throw new Error("Conflict detected in post-tool-use modifiedPayload");
      }
      return { ...result, modifiedPayload: modifieds[0].modifiedPayload };
    }
    return result;
  }
  return { action: "proceed" };
}
```

- [x] **Step 1: `JusticePlugin.handleEvent` に routing ガードを追加（§4.4/D64）**

```typescript
// src/core/justice-plugin.ts
async handleEvent(event: HookEvent): Promise<HookResponse> {
  switch (event.type) {
    case "Message": {
      const payload = event.payload;
      const isUserMessage = "role" in payload && "content" in payload;
      if (isUserMessage) {
        return await this.planBridge.handleMessage(event);
      }
      const obs = await this.observationHandler.handleMessage(event.sessionId, payload as ObservationMessagePayload).catch((err) => {
        this.options.logger?.warn("observation-handler message failed", err);
        return PROCEED;
      });
      return obs;
    }
    case "PreToolUse": {
      let planRes: HookResponse = PROCEED;
      if (event.payload.toolName === "task") {
        planRes = await this.planBridge.handlePreToolUse(event);
      }
      const obs = await this.observationHandler.handlePreToolUse(event);
      return mergePreToolUseResponses(obs, planRes);
    }
    case "PostToolUse": {
      const responses: HookResponse[] = [await this.observationHandler.handlePostToolUse(event)];
      if (event.payload.toolName === "task") {
        responses.push(await this.planBridge.handlePostToolUse(event));
        responses.push(await this.taskFeedback.handlePostToolUse(event));
      }
      return mergePostToolUseResponses(responses);
    }
    case "AgentMapped": {
      return PROCEED;
    }
    case "Event":
      return this.handleEventType(event);
    default: {
      const _exhaustiveCheck: never = event;
      void _exhaustiveCheck;
      return PROCEED;
    }
  }
}
```

- [x] **Step 2: observation-handler stub を作成（`ToolUsePayload` 以外も受け取れるよう拡張）**

```typescript
// src/hooks/observation-handler.ts
export class ObservationHandler {
  async handlePreToolUse(event: PreToolUseEvent): Promise<HookResponse> { return { action: "proceed" }; }
  async handlePostToolUse(event: PostToolUseEvent): Promise<HookResponse> { return { action: "proceed" }; }
  async handleMessage(sessionId: string, payload: ObservationMessagePayload): Promise<HookResponse> { return { action: "proceed" }; }
}
```

- [x] **Step 2b: PostToolUse マージテスト（tests/core/v2/post-tool-use-merge.test.ts）の実装（D64）**

```typescript
// tests/core/v2/post-tool-use-merge.test.ts
import { describe, expect, it, vi } from "vitest";
import { mergePostToolUseResponses, mergePreToolUseResponses } from "../../../src/core/justice-plugin";

describe("D64 - PostToolUse merge rules", () => {
  it("should prioritize skip action over inject and proceed", () => {
    const responses = [
      { action: "proceed" as const },
      { action: "skip" as const },
      { action: "inject" as const, injectedContext: "test" }
    ];
    expect(mergePostToolUseResponses(responses)).toEqual({ action: "skip" });
  });

  it("should concatenate injectedContext from multiple inject actions", () => {
    const responses = [
      { action: "inject" as const, injectedContext: "context A" },
      { action: "proceed" as const },
      { action: "inject" as const, injectedContext: "context B" }
    ];
    expect(mergePostToolUseResponses(responses)).toEqual({
      action: "inject",
      injectedContext: "context A\n\n---\n\ncontext B"
    });
  });

  it("should throw when modifiedPayload conflicts occur", () => {
    const responses = [
      { action: "inject" as const, injectedContext: "A", modifiedPayload: { toolName: "task", modified: 1 } },
      { action: "inject" as const, injectedContext: "B", modifiedPayload: { toolName: "task", modified: 2 } }
    ];
    expect(() => mergePreToolUseResponses(responses[0], responses[1])).toThrow(/modifiedPayload/);
  });
});
```

- [x] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/justice-plugin-routing.test.ts tests/core/v2/post-tool-use-merge.test.ts
```

- [x] **Step 4: Commit**

```bash
git add src/core/justice-plugin.ts src/hooks/observation-handler.ts tests/core/justice-plugin-routing.test.ts tests/core/v2/post-tool-use-merge.test.ts
git commit -m "feat(v2): JusticePlugin routing guard for all tools + observation handler + merge tests"
```

- [x] **Step 5: Phase 3 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 3.2`（直前 Task から派生）。adapter 変更を統合して routing を正しくテストするため。

---

### Task 3.4: Agent ID Resolution & Session State Mapping

**Files:**
- Modify: `src/core/justice-plugin.ts`
- Create: `src/core/session-state-provider.ts`
- Test: `tests/core/agent-id-resolution.test.ts`

**Interfaces:**
- Consumes: Normalized agent mapped event (`{ type: "AgentMapped", payload: { sessionId: string; agentName: string } }`) produced by the adapter (complying with FF-001).
- Produces:
  - `sessionStateProvider.getAgentId(sessionId): Promise<ObservationAgentId>`
  - `sessionStateProvider.getActiveTaskId(callId): string | undefined`
  - `sessionStateProvider.setActiveTaskWindow(callId: string, taskId: string): void`
  - `sessionStateProvider.closeActiveTaskWindow(callId: string): void`

- [x] **Step 1: SessionStateProvider の実装（D48/D74）**
  - アダプター側で検知・抽出された `AgentMapped` ペイロードを受け取り、`sessionId` から `agentId` (ObservationAgentId) へのマッピングを構築・保持する。
  - OpenCode agent 名（自由文字列）から Justice `AgentId`（`atlas` / `hephaestus` / `sisyphus` / `prometheus`）への写像ロジックを実装し、マッピングできない場合は `unknown` とする。
  - **spec §5.8/D74 準拠**: task 窓を `callId` キーで管理する。`activeTaskWindows: Map<string, string>`（キー=callId、値=taskId）を内部に持ち、`setActiveTaskWindow(callId, taskId)` で PreToolUse 時に窓を開き、`closeActiveTaskWindow(callId)` で対応する callId の PostToolUse 時に窓を閉じる。`getActiveTaskId(callId)` で callId に紐づく taskId を返す。セッション単位の単一 active taskId による上書き方式（`setActiveTaskId(sessionId, taskId)` / `getActiveTaskId(sessionId)`）は採用しない。

- [x] **Step 2: routing イベントハンドラに AgentMapped イベント処理を追加**
  - `JusticePlugin.handleEvent` で `AgentMapped` イベント（ペイロード: `{ sessionId, agentName }`）を受信し、`SessionStateProvider` のマップを更新する。

- [x] **Step 3: テストの実装（tests/core/agent-id-resolution.test.ts）**
  - `AgentMapped` イベントから `agentId` が正しく写像され、`SessionStateProvider` を経由して解決できることを検証する。
  - 不明なエージェントが `unknown` shard に落ちることを確認し、同時に wisdom namespace（4つのペルソナ）に `system` や `unknown` のデータが混入（汚染）しないことをテストで担保する。

- [x] **Step 4: Commit & Submit**

```bash
git add src/core/justice-plugin.ts src/core/session-state-provider.ts tests/core/agent-id-resolution.test.ts
git commit -m "feat(v2): implement agentId resolution and session state mapping"
gt submit
```

**派生元:** `Task 3.3`

---
