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

> **Split plan:** This file is part 05 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** Tool, message, skill, task-summary, session-error, and reflection observation handlers.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

## Phase 4: Observation Handler Implementation

**Base Branch:** `feature/phase4-v2-observation-handler__base`

**目的:** observation-handler を実装し、全ツール観測・message 観測・task サマリ・skill_invoked・session_error を Observation Log へ記録。本 Phase だけで v2.0 の主要な観測経路が完成する。

**判断:** Phase 4 は Phase 3 の routing / adapter と Phase 2 の log store を使用。Task 4.1 は tool 観測（log store + evidence engine）なので Phase 2 Base または Task 4.0 stub から。Task 4.2 は message 観測（Task 3.1 + 3.3）なので Task 3.3 から。Task 4.3 は task/skill 観測（Task 4.1）から。Task 4.4 は session_error（Task 4.1）から。Phase 4 内は順次積み上げが自然。

---

### Task 4.1: Tool Observation Handler & Task ID Correlation

**Files:**

- Modify: `src/hooks/observation-handler.ts` (Hook: skeleton only, no business logic)
- Modify: `src/hooks/plan-bridge.ts` (Implement stable taskId injection contract)
- Modify: `src/core/task-packager.ts` (Support taskId enrichment)
- Create: `src/core/v2/record-builder.ts` (Core: pure record builder functions)
- Test: `tests/hooks/observation-handler-tool.test.ts`
- Test: `tests/core/v2/record-builder.test.ts`

**Interfaces:**

- Consumes: `ObservationLogStore`, `extractEvidenceFromTool`, `record-builder.ts` pure functions.
- Produces:
  - `handlePostToolUse(payload)` → `ObservationRecord{kind:"tool_executed"}` append + gate trigger check + `HookResponse`.
  - `handlePreToolUse(payload)` → task window tracking (`activeTaskWindows: Map<callId, taskId>`).
  - All log append/evaluation paths are wrapped in `try/catch` and degrade to `{ action: "proceed" }` on failure (FF-006).
  - `appendTaskSummaryDeclaredEvidence(payload, taskId)` stubbed in this task and implemented in Task 4.3.
  - **Correlation Contract:** `PlanBridge`/`TaskPackager` (またはツール実行前インターセプタ) が `task` ツール実行前に args 内へ決定論的かつ安定した `taskId` を確実に注入する実装。
  - **Regression Test:** `tests/hooks/observation-handler-tool.test.ts` にて、実際に `taskId` が含まれる実ペイロードを用いて、correlation 解決とそれに基づくゲート判定が正確に行われることを担保するテストケースを追加。

- [ ] **Step 0: PlanBridge および TaskPackager にて taskId 注入処理を実装（D74）**
  - `src/hooks/plan-bridge.ts` または `src/core/task-packager.ts` を修正し、`task` ツールの実行前 (`PreToolUse` ハンドラやタスク構築処理) に、タスク引数 (`args`) に対し一意かつ決定論的に決定された `taskId` (例: `task-1` など) を自動注入するロジックを実装する。これにより、実行される `task` ツールの引数から安定して `taskId` が解決できる状態を作る。

- [ ] **Step 1: PreToolUse で task window を追跡（D74）**

```typescript
// src/hooks/observation-handler.ts
private readonly activeTaskWindows = new Map<string, string>();
private readonly sessionActiveTasks = new Map<string, Set<string>>();

private getActiveTaskIdForSession(sessionId: string): string | undefined {
  const tasks = this.sessionActiveTasks.get(sessionId);
  if (!tasks || tasks.size !== 1) return undefined; // FF-005/D74: Do not fallback if there are multiple concurrent active tasks to prevent cross-task contamination.
  return Array.from(tasks)[0];
}

private buildEnvelope(extra: { readonly taskId?: string; readonly agentId: ObservationAgentId; readonly sessionId: string; readonly recordType: "observation" | "decision" | "learning" }): CommonEnvelope {
  return {
    schemaVersion: 1,
    sequence: 0, // ObservationLogStore.append assigns the actual monotonic sequence
    timestamp: new Date().toISOString(),
    agentId: extra.agentId,
    sessionId: extra.sessionId,
    writerId: this.writerId,
    taskId: extra.taskId,
    recordType: extra.recordType,
  };
}

private extractTaskIdFromTaskArgs(args: unknown, sessionId: string): string | undefined {
  if (args && typeof args === "object" && "taskId" in args) {
    const value = (args as Record<string, unknown>).taskId;
    if (typeof value === "string" && value.startsWith("task-")) return value;
  }
  // D74: No active taskId fallback to prevent parallel task pollution. Must strictly resolve from callId.
  return undefined;
}

private activeTaskIdForSession(sessionId: string): string | undefined {
  // Integrates with existing session state managed by PlanBridge/TaskFeedbackHandler.
  return this.sessionStateProvider?.getActiveTaskId(sessionId);
}

private async resolveAgentId(sessionId: string): Promise<ObservationAgentId> {
  return this.sessionStateProvider?.getAgentId(sessionId) ?? "unknown";
}

async handlePreToolUse(event: PreToolUseEvent): Promise<HookResponse> {
  const payload = event.payload;
  if (payload.toolName === "task") {
    const taskId = this.extractTaskIdFromTaskArgs(payload.toolInput, event.sessionId);
    if (taskId) {
      if (!event.callId) {
        this.options.logger?.warn("PreToolUse task callId is missing. Skipping task window creation.", { taskId, sessionId: event.sessionId });
        return { action: "proceed" };
      }
      this.activeTaskWindows.set(event.callId, taskId);
      // D74: activeTaskWindows is the sole source of truth for correlation to prevent race conditions during concurrent tasks.
      // sessionStateProvider.setActiveTaskId is strictly for UI display/audit assistance, not for gate/evidence logic.
      this.sessionStateProvider?.setActiveTaskId(event.sessionId, taskId);
      if (!this.sessionActiveTasks.has(event.sessionId)) {
        this.sessionActiveTasks.set(event.sessionId, new Set());
      }
      this.sessionActiveTasks.get(event.sessionId)!.add(taskId);
    }
  }
  return { action: "proceed" };
}

// Fail-open stub declarations to prevent compilation errors before Phase 5/6 implementations
private async appendTaskSummaryDeclaredEvidence(event: PostToolUseEvent, taskId?: string): Promise<void> {
  // Stub: implemented in Task 4.3
}
private async appendReviewObservationsIfDetected(shardId: ShardId, taskId: string | undefined, sessionId: string, callId: string, toolName: string, toolResult: string | undefined, metadata?: { readonly isCompleteSnapshot?: boolean }): Promise<void> {
  // Stub: implemented in Task 6.3
}
private async evaluateGateIfTriggered(trigger: "task_complete" | "tool_observed", taskId: string | undefined, callId: string | undefined, agentId: string, sessionId: string): Promise<HookResponse> {
  // Stub: implemented in Task 5.4
  return { action: "proceed" };
}
```

- [ ] **Step 2: Core 純粋レコードビルダーを実装（src/core/v2/record-builder.ts）**
  - Hook 側に業務ロジックを残さない制約に従い、`ObservationRecord` や `Evidence` の構築、および redaction 処理を行う純粋関数を実装します。

```typescript
// src/core/v2/record-builder.ts
import { extractEvidenceFromTool } from "./evidence-engine.ts";
import { redactForPersistence, redactAbsolutePaths } from "./redaction.ts";
import type { CommonEnvelope, ObservationRecord, Evidence } from "./observation-model.ts";

export function buildToolExecutedRecord(
  envelope: CommonEnvelope,
  toolName: string,
  toolInput: unknown,
  toolOutput: { readonly output?: string; readonly metadata?: { readonly error?: boolean } },
  callId: string,
  summaryClaims?: readonly DeclaredClaim[]
): ObservationRecord {
  const evidence: Evidence[] = [];
  
  // (a) observed evidence from tool output
  const observed = extractEvidenceFromTool(toolName, toolInput as Record<string, unknown>, toolOutput, callId);
  if (observed) {
    let redactedEvidence: Evidence;
    if (observed.toolOutputClass === "command_exec") {
      redactedEvidence = {
        ...observed,
        command: redactForPersistence(redactAbsolutePaths(observed.command ?? "")),
        rawOutput: redactForPersistence(redactAbsolutePaths(observed.rawOutput ?? "")),
      };
    } else if (observed.toolOutputClass === "file_content") {
      redactedEvidence = {
        ...observed,
        command: observed.command ? redactForPersistence(redactAbsolutePaths(observed.command)) : undefined,
        rawOutputSnippet: observed.rawOutputSnippet
          ? redactForPersistence(redactAbsolutePaths(observed.rawOutputSnippet))
          : undefined,
      };
    } else {
      redactedEvidence = {
        ...observed,
        command: observed.command ? redactForPersistence(redactAbsolutePaths(observed.command)) : undefined,
      };
    }
    evidence.push(redactedEvidence);
  }

  // (b) declared evidence from task summary (D59)
  if (summaryClaims) {
    for (const c of summaryClaims) {
      evidence.push({
        evidenceId: c.evidenceId,
        kind: c.claimKind,
        sourceClass: "declared_claim",
        provenance: "declared",
        declaredFrom: "task_summary",
        claim: { claimKind: c.claimKind, outcome: c.outcome },
      });
    }
  }

  return {
    ...envelope,
    recordType: "observation",
    kind: "tool_executed",
    toolName,
    callId,
    evidence,
  };
}
```

- [ ] **Step 3: Hook からビルダーを呼び出して LogStore に append するように実装**

```typescript
// src/hooks/observation-handler.ts
async handlePostToolUse(event: PostToolUseEvent): Promise<HookResponse> {
  const payload = event.payload;
  const callId = event.callId;
  if (!callId) {
    this.options.logger?.warn("PostToolUse callId is missing. Proceeding without task window.", { toolName: payload.toolName, sessionId: event.sessionId });
    return { action: "proceed" };
  }
  let taskId: string | undefined;
  try {
    // D50: Skip internal justice plugin tools to prevent polluting observation log
    if (payload.toolName.startsWith("justice_")) {
      return { action: "proceed" };
    }

    // D74/ISS-005: Resolve taskId strictly from activeTaskWindows to prevent cross-task window pollution.
    // Fallback is omitted to strictly align with safety design.
    taskId = this.activeTaskWindows.get(callId);

    const agentId = await this.resolveAgentId(event.sessionId);
    const shardId = { agentId, sessionId: event.sessionId, writerId: this.writerId };
    const envelope = this.buildEnvelope({ taskId, agentId, sessionId: event.sessionId, recordType: "observation" });

    // 1. Tool execution observed append (業務ロジックは record-builder へ完全に委譲)
    // D59: task ツールの場合は、後続 of Task 4.3 で task summary から declared claims も抽出して同居させる
    const record = buildToolExecutedRecord(
      envelope,
      payload.toolName,
      payload.toolInput,
      { output: payload.toolResult, metadata: payload.metadata },
      callId
    );
    await this.logStore.append(shardId, record);

    // 3. Review observed append (if review rejection detected, implemented/activated in Task 6.3)
    await this.appendReviewObservationsIfDetected(shardId, taskId, event.sessionId, callId, payload.toolName, payload.toolResult, payload.metadata);

    // 4. Refresh projected state before evaluating gates (strict evaluation sequence: append -> project -> evaluate)
    const refreshedEvents = await this.logStore.readAll();
    const projectedState = project(refreshedEvents, new Date().toISOString());
    await this.projectionCache.write(projectedState).catch(() => {});

    // D74: taskId is undefined for non-task tools unless explicitly correlated.
    let response: HookResponse = { action: "proceed" };
    if (payload.toolName === "task" && taskId) {
      const taskGateResponse = await this.evaluateGateIfTriggered("task_complete", taskId, callId, agentId, event.sessionId);
      response = mergePostToolUseResponses(response, taskGateResponse);
    }
    const gateResponse = await this.evaluateGateIfTriggered("tool_observed", taskId, callId, agentId, event.sessionId);
    response = mergePostToolUseResponses(response, gateResponse);
    if (response.action === "inject" || response.action === "skip") {
      return response;
    }
  } catch (err) {
    this.options.logger?.warn("observation-handler: tool observation failed, degrading to PROCEED", err);
  } finally {
    if (payload.toolName === "task") {
      this.activeTaskWindows.delete(callId);
      if (taskId) {
        this.sessionActiveTasks.get(event.sessionId)?.delete(taskId);
      }
    }
  }
  return { action: "proceed" };
}
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-tool.test.ts tests/core/v2/record-builder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/v2/record-builder.ts src/hooks/observation-handler.ts tests/hooks/observation-handler-tool.test.ts tests/core/v2/record-builder.test.ts
git commit -m "feat(v2): extract record building logic from Hook to pure Core record-builder"
```

- [ ] **Step 5: Phase 4 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase4-v2-observation-handler__base`（Base から派生）。ただし実際には Phase 2/3 の実装が前提。Graphite stacking 上では Task 4.1 は Phase 4 Base から分岐し、Phase 4 Base 自体が Phase 3 Base から派生する想定。

---

### Task 4.2: Message Observation Handler

**Files:**

- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/hooks/observation-handler-message.test.ts`

**Interfaces:**

- Consumes: `MessageRoleBuffer`, `extractFinalizedAssistantClaims`, `redactForPersistence`.
- Produces: `handleMessage(payload)` → `ObservationRecord{kind:"message"}` with `declaredClaims` + `declared_claim` Evidence.

- [ ] **Step 1: `handleMessage` を実装（D53/D67）**
  - レコード構築およびスニペットの redaction 処理（ドメインロジック）は `src/core/v2/record-builder.ts` の純粋関数へ委譲します。

```typescript
// src/core/v2/record-builder.ts に追加
export function buildMessageRecord(
  envelope: CommonEnvelope,
  messageID: string,
  partID: string | undefined,
  fullText: string,
  claims: readonly DeclaredClaim[]
): ObservationRecord {
  const evidence: DeclaredClaimEvidence[] = claims.map((c) => ({
    evidenceId: c.evidenceId,
    kind: c.claimKind,
    sourceClass: "declared_claim",
    provenance: "declared",
    declaredFrom: "message",
    claim: { claimKind: c.claimKind, outcome: c.outcome },
  }));
  return {
    ...envelope,
    recordType: "observation",
    kind: "message",
    messageID,
    partID,
    role: "assistant",
    textHash: hashString(fullText),
    textSnippet: redactForPersistence(redactAbsolutePaths(fullText)).slice(0, 200),
    declaredClaims: claims,
    evidence,
    finalized: true,
  };
}
```

```typescript
// src/hooks/observation-handler.ts
async handleMessage(payload: ObservationMessagePayload): Promise<HookResponse> {
  try {
    this.messageRoleBuffer.update(payload.sessionId, payload);
    if (payload.kind === "text_complete" || (payload.kind === "message_updated" && payload.finalized)) {
      const partID = payload.kind === "text_complete" ? payload.partID : undefined;
      this.messageRoleBuffer.finalize(payload.sessionId, payload.messageID, partID);
      const fullText = this.messageRoleBuffer.getFinalizedAssistantText(payload.sessionId, payload.messageID, partID);
      
      if (fullText !== undefined) {
        const claims = this.messageRoleBuffer.extractAssistantClaims(payload.sessionId, payload.messageID, partID);
        const agentId = await this.resolveAgentId(payload.sessionId);
        const shardId = { agentId, sessionId: payload.sessionId, writerId: this.writerId };
        const envelope = this.buildEnvelope({ agentId, sessionId: payload.sessionId, recordType: "observation" });

        const record = buildMessageRecord(envelope, payload.messageID, partID, fullText, claims);
        await this.logStore.append(shardId, record);
      }
    }
    return { action: "proceed" };
  } catch (err) {
    this.options.logger?.warn("observation-handler message failed", err);
    return { action: "proceed" };
  }
}
```

- [ ] **Step 2: テストコードの実装と実行（Devcontainer 内）**
  - `tests/hooks/observation-handler-message.test.ts` に、`logStore.append` の書き込み失敗（例外発生）時に、エラーログが記録されつつ全体がクラッシュせずに `{ action: "proceed" }` を返すという縮退動作（Fail-Open）を検証するテストを追加します。

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-message.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/observation-handler.ts tests/hooks/observation-handler-message.test.ts
git commit -m "feat(v2): message observation handler with declared claims and fail-open verification"
```

- [ ] **Step 4: Phase 4 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 4.1`（直前 Task から派生）。同じ observation-handler ファイルを編集するため。

---

### Task 4.3: Skill Invoked + Task Summary Declared Evidence

**Files:**

- Modify: `src/hooks/observation-handler.ts`
- Create: `src/core/v2/skill-invoked-detector.ts`
- Create: `src/core/v2/task-summary-claim-extractor.ts`
- Test: `tests/core/v2/skill-invoked-detector.test.ts`
- Test: `tests/core/v2/task-summary-claim-extractor.test.ts`
- Test: `tests/hooks/observation-handler-skill-task.test.ts`

**Interfaces:**

- Consumes: `toolName === "skill"` payload, `task` PostToolUse output (including `load_skills` argument).
- Produces:
  - `detectSkillInvoked(toolName, args): readonly { readonly skillName: string; readonly source: "skill_tool" | "task_load_skills"; readonly callId?: string }[]` (D10). Detects skills invoked via the `skill` tool and via `task` tool's `load_skills` argument.
  - `extractTaskSummaryClaims(sourceId, output): DeclaredClaim[]` (D29/D62).
  - `appendTaskSummaryDeclaredEvidence(payload, taskId)` in `observation-handler.ts`, wrapped in `try/catch` and degrading to `PROCEED` on failure.
  - `detectSkillInvoked(toolName, args): readonly { readonly skillName: string; readonly source: "skill_tool" | "task_load_skills"; readonly callId?: string }[]` (D10). Detects skills invoked via the `skill` tool and via `task` tool's `load_skills` argument.
  - `extractTaskSummaryClaims(sourceId, output): DeclaredClaim[]` (D29/D62).

- [ ] **Step 1: skill 検出器を実装**

```typescript
// src/core/v2/skill-invoked-detector.ts
export function detectSkillInvoked(toolName: string, args: unknown, callId?: string): readonly { readonly skillName: string; readonly source: "skill_tool" | "task_load_skills"; readonly callId?: string }[] {
  const result: { skillName: string; source: "skill_tool" | "task_load_skills"; callId?: string }[] = [];
  if (toolName === "skill" && args && typeof args === "object" && "name" in args) {
    const name = (args as Record<string, unknown>).name;
    if (typeof name === "string" && name.length > 0) {
      result.push({ skillName: name, source: "skill_tool", callId });
    }
  }
  if (toolName === "task" && args && typeof args === "object" && "load_skills" in args) {
    const loadSkills = (args as Record<string, unknown>).load_skills;
    if (Array.isArray(loadSkills)) {
      for (const skill of loadSkills) {
        if (typeof skill === "string") {
          result.push({ skillName: skill, source: "task_load_skills", callId });
        }
      }
    }
  }
  return result;
}
```

- [ ] **Step 1b: `observation-model.ts` の `SkillInvokedRecord` を詳細化（D10）**

Task 1.1 で stub とした `SkillInvokedRecord` を、skill 検出器の戻り値に合わせて拡張する。

```typescript
// src/core/v2/observation-model.ts
export type SkillInvokedRecord = {
  readonly kind: "skill_invoked";
  readonly skillName: string;
  readonly source: "skill_tool" | "task_load_skills";
  readonly callId?: string;
};
```

- [ ] **Step 2: task summary 抽出器を実装**

```typescript
// src/core/v2/task-summary-claim-extractor.ts
export function extractTaskSummaryClaims(sourceId: string, output: string): DeclaredClaim[] {
  // transcript 含有でも declared 扱い（D62）。PASS 非算入。
  return extractDeclaredClaims(sourceId, output).map((c) => ({ ...c, claimKind: c.claimKind }));
}
```

- [ ] **Step 3: observation-handler に skill_invoked 記録処理を追加**
  - `ObservationRecord` の構築処理は `src/core/v2/record-builder.ts` へ委譲し、Hook 側は純粋関数を呼び出すだけに抑えます。

```typescript
// src/core/v2/record-builder.ts に追加
export function buildSkillInvokedRecord(
  envelope: CommonEnvelope,
  skillName: string,
  source: "skill_tool" | "task_load_skills"
): ObservationRecord {
  return {
    ...envelope,
    recordType: "observation",
    kind: "skill_invoked",
    skillName,
    source,
  };
}

export function buildTaskSummaryRecord(
  envelope: CommonEnvelope,
  summaryText: string,
  summaryClaims: readonly DeclaredClaim[],
  callId: string
): ObservationRecord {
  const evidence: DeclaredClaimEvidence[] = summaryClaims.map((c) => ({
    evidenceId: c.evidenceId,
    kind: c.claimKind,
    sourceClass: "declared_claim",
    provenance: "declared",
    declaredFrom: "task_summary",
    claim: { claimKind: c.claimKind, outcome: c.outcome },
  }));
  return {
    ...envelope,
    recordType: "observation",
    kind: "tool_executed",
    toolName: "task",
    callId,
    evidence,
  };
}

```

（※実際の `skill_invoked` 観測と append 処理の配線コードは、後述の **Step 3b** にて `handlePostToolUse` の実装内に統合して記述します。）

- [ ] **Step 3b: `handlePostToolUse` での task summary declared claims 同居と配線（D59/D70/指摘4）**

`src/hooks/observation-handler.ts` の `handlePostToolUse` 内で `toolName === "task"` の場合に `extractTaskSummaryClaims` を使ってサマリーから declared claims を抽出し、`buildToolExecutedRecord` に渡して同居させるように修正・拡張する。

```typescript
// src/hooks/observation-handler.ts
async handlePostToolUse(event: PostToolUseEvent): Promise<HookResponse> {
  const payload = event.payload;
  const callId = event.callId;
  if (!callId) {
    this.options.logger?.warn("PostToolUse callId is missing. Proceeding without task window.", { toolName: payload.toolName, sessionId: event.sessionId });
    return { action: "proceed" };
  }
  let taskId: string | undefined;
  try {
    // D50: Skip internal justice plugin tools to prevent polluting observation log
    if (payload.toolName.startsWith("justice_")) {
      return { action: "proceed" };
    }
    // D74: No active taskId fallback to prevent parallel task pollution. Must strictly resolve from activeTaskWindows.
    taskId = this.activeTaskWindows.get(callId);

    const agentId = await this.resolveAgentId(event.sessionId);
    const shardId = { agentId, sessionId: event.sessionId, writerId: this.writerId };
    const envelope = this.buildEnvelope({ taskId, agentId, sessionId: event.sessionId, recordType: "observation" });

    // 1. Tool execution observed and declared evidence (cohabitated in a single tool_executed record)
    let summaryClaims: readonly DeclaredClaim[] | undefined;
    if (payload.toolName === "task") {
      try {
        const summaryText = payload.toolResult ?? "";
        summaryClaims = extractTaskSummaryClaims(callId, summaryText);
      } catch (err) {
        this.logger.warn("observation-handler: task summary declared claim extraction failed", err);
      }
    }

    const record = buildToolExecutedRecord(
      envelope,
      payload.toolName,
      payload.toolInput,
      { output: payload.toolResult, metadata: payload.metadata },
      callId,
      summaryClaims
    );
    await this.logStore.append(shardId, record);

    // 1.5. Skill execution observed and appended (fail-open, FR-002)
    try {
      const invokedSkills = detectSkillInvoked(payload.toolName, payload.toolInput);
      for (const skill of invokedSkills) {
        const skillRecord = buildSkillInvokedRecord(envelope, skill.skillName, skill.source);
        await this.logStore.append(shardId, skillRecord);
      }
    } catch (err) {
      this.logger.warn("observation-handler: skill_invoked observation failed", err);
    }

    // 2. Review observed append (if review rejection detected, implemented/activated in Task 6.3)
    await this.appendReviewObservationsIfDetected(shardId, taskId, event.sessionId, callId, payload.toolName, payload.toolResult, payload.metadata);

    // 3. Update projected state and evaluate gates (strict evaluation sequence: append -> project -> evaluate)
    const responses: HookResponse[] = [];
    if (payload.toolName === "task" && taskId) {
      this.activeTaskWindows.delete(callId);
      if (taskId) {
        this.sessionActiveTasks.get(event.sessionId)?.delete(taskId);
      }
      const taskGateResponse = await this.evaluateGateIfTriggered("task_complete", taskId, callId, agentId, event.sessionId);
      responses.push(taskGateResponse);
    }
    if (taskId) {
      const gateResponse = await this.evaluateGateIfTriggered("tool_observed", taskId, callId, agentId, event.sessionId);
      responses.push(gateResponse);
    }
    if (responses.length > 0) {
      return responses.reduce((acc, r) => mergePostToolUseResponses(acc, r));
    }
  } catch (err) {
    this.logger.warn("observation-handler: tool observation failed, degrading to PROCEED", err);
  } finally {
    if (payload.toolName === "task") {
      this.activeTaskWindows.delete(callId);
      if (taskId) {
        this.sessionActiveTasks.get(event.sessionId)?.delete(taskId);
      }
    }
  }
  return { action: "proceed" };
}
```
- [ ] **Step 3d: 順序保証検証用回帰テストの作成**
  - テストファイル `tests/hooks/gate-evaluation-order.test.ts` を追加し、`tool_executed` (declared claims 同居) append → `review_observed` append → project → `evaluateGateIfTriggered("task_complete")` の正確な実行順序関係が担保されていることを検証する。


- [ ] **Step 4b: task summary declared claim extraction fail-open テストを追加（S-1）**

```typescript
// tests/hooks/observation-handler-skill-task.test.ts
it("returns PROCEED when task summary extraction throws due to store append error", async () => {
  const mockLogStore = {
    append: vi.fn().mockRejectedValue(new Error("Disk write failure")),
    readAll: vi.fn().mockResolvedValue([]),
  } as unknown as ObservationLogStore;

  const mockFs = createMockFileReader();
  const handler = new ObservationHandler(mockLogStore, mockFs, {
    writerId: "w1",
    logger: console,
  });

  const event: PostToolUseEvent = {
    type: "PostToolUse",
    sessionId: "s1",
    callId: "c1",
    payload: {
      toolName: "task",
      callId: "c1",
      toolInput: { name: "task", args: { taskId: "task-1" } },
      toolResult: "tests pass",
      metadata: { error: false }
    }
  };

  const result = await handler.handlePostToolUse(event);
  expect(result.action).toBe("proceed");
});
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/skill-invoked-detector.test.ts tests/core/v2/task-summary-claim-extractor.test.ts tests/hooks/observation-handler-skill-task.test.ts tests/hooks/gate-evaluation-order.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/v2/observation-model.ts src/core/v2/skill-invoked-detector.ts src/core/v2/task-summary-claim-extractor.ts src/hooks/observation-handler.ts tests/core/v2/skill-invoked-detector.test.ts tests/core/v2/task-summary-claim-extractor.test.ts tests/hooks/observation-handler-skill-task.test.ts tests/hooks/gate-evaluation-order.test.ts
git commit -m "feat(v2): skill invoked detection and task summary declared claims"
```

- [ ] **Step 6: Phase 4 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 4.2`（直前 Task から派生）。

---

### Task 4.4: Session Error + ReflectionEvent Seam

**Files:**

- Modify: `src/core/justice-plugin.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/hooks/task-feedback.ts`（ReflectionEvent 発行呼び出し追加）
- Modify: `src/hooks/loop-handler.ts`（ReflectionEvent 発行呼び出し追加）
- Create: `src/core/v2/reflection-event.ts`
- Test: `tests/hooks/observation-handler-session-error.test.ts`
- Test: `tests/core/v2/reflection-event.test.ts`
- Test: `tests/core/justice-plugin-reflection.test.ts`

**Interfaces:**

- Consumes: `session.error` event, task success/error signals, loop error notes.
- Produces:
  - `handleSessionError(error)` → `ObservationRecord{kind:"session_error"}`.
  - `emitReflectionEvent(params)` → ReflectionEvent append to logStore.
  - `buildReflectionEvent(trigger, planRef, intent, note)`.
  - ReflectionEvent append on task success/error and loop error-note.

- [ ] **Step 1: session_error ハンドラを実装**

```typescript
async handleSessionError(error: { readonly message: string; readonly kind?: string; readonly agentId: ObservationAgentId; readonly sessionId: string }): Promise<HookResponse> {
  try {
    const shardId = { agentId: error.agentId, sessionId: error.sessionId, writerId: this.writerId };
    const record: ObservationRecord = {
      ...this.buildEnvelope({
        agentId: error.agentId,
        sessionId: error.sessionId,
        recordType: "observation",
      }),
      kind: "session_error",
      errorKind: error.kind ?? "unknown",
      message: redactForPersistence(redactAbsolutePaths(error.message)),
    };
    await this.logStore.append(shardId, record);
  } catch (err) {
    this.logger.warn("observation-handler: session error observation failed, degrading to PROCEED", err);
  }
  return { action: "proceed" };
}
```

- [ ] **Step 1b: `observation-model.ts` の `SessionErrorRecord` を詳細化**

Task 1.1 で stub とした `SessionErrorRecord` を、session_error ハンドラのフィールドに合わせて拡張する。

```typescript
// src/core/v2/observation-model.ts
export type SessionErrorRecord = {
  readonly kind: "session_error";
  readonly errorKind: string;
  readonly message: string;
};
```

- [ ] **Step 1c: `session.error` を observation-handler に配線する**
  - `src/core/justice-plugin.ts` / `src/runtime/opencode-adapter.ts` で `session.error` event を `observationHandler.handleSessionError(...)` へ routing する。
  - 実イベント経由で `session_error` が Observation Log に append されることを統合テストで検証する。

- [ ] **Step 1d: `observation-handler.ts` に `emitReflectionEvent` を実装**

```typescript
// src/hooks/observation-handler.ts
async emitReflectionEvent(params: {
  readonly trigger: "task_succeeded" | "task_error";
  readonly planRef: { readonly path: string; readonly taskId: string };
  readonly intent: "check_complete" | "append_error_note";
  readonly note?: string;
  readonly sessionId: string;
}): Promise<void> {
  try {
    const sessionId = params.sessionId;
    const agentId = await this.resolveAgentId(sessionId);
    const shardId = { agentId, sessionId, writerId: this.writerId };
    const envelope = this.buildEnvelope({ taskId: params.planRef.taskId, agentId, sessionId, recordType: "observation" });
    const record = buildReflectionEvent(envelope, params.trigger, params.planRef, params.intent, params.note);
    await this.logStore.append(shardId, record);
  } catch (err) {
    this.logger.warn("observation-handler: emitReflectionEvent failed, degrading gracefully", err);
  }
}
```

- [ ] **Step 2: ReflectionEvent ビルダーを実装（D15/D51/指摘5）**

`buildReflectionEvent` の動作仕様：
- `planRef.path` は workspace root に対して `path.resolve` した結果が root 配下に収まる場合のみ受け入れる。絶対パス、Windows のドライブレター、UNC、または `..` によるトラバーサルは拒否する。
- 検証に失敗した場合は、エラー（`Error: Invalid plan path: Absolute path or traversal detected`）を投げ、永続化をブロック（リダクション／例外送出）する。
- ワークスペース相対パス（例: `plan.md`）のみを正常パスとして受け入れる。

```typescript
// src/core/v2/reflection-event.ts
export function buildReflectionEvent(
  envelope: CommonEnvelope,
  trigger: "task_succeeded" | "task_error",
  planRef: { readonly path: string; readonly taskId: string },
  intent: "check_complete" | "append_error_note",
  note?: string
): ObservationRecord {
  const resolvedPath = path.resolve(workspaceRoot, planRef.path);
  const rel = path.relative(workspaceRoot, resolvedPath);
  if (
    path.isAbsolute(planRef.path) ||
    planRef.path.startsWith("/") ||
    planRef.path.startsWith("\\") ||
    /^[A-Za-z]:/u.test(planRef.path) ||
    rel.startsWith("..") ||
    path.isAbsolute(rel)
  ) {
    throw new Error("Invalid plan path: Absolute path or traversal detected");
  }
  return {
    ...envelope,
    recordType: "observation",
    kind: "reflection",
    reflection: {
      trigger,
      planRef,
      intent,
      note: note ? redactForPersistence(redactAbsolutePaths(note)) : undefined,
    },
  };
}
```

- [ ] **Step 2b: `observation-model.ts` の `ReflectionRecord` を詳細化（D15/D51）**

Task 1.1 で stub とした `ReflectionRecord` を、ReflectionEvent ビルダーの戻り値に合わせて拡張する。

```typescript
// src/core/v2/observation-model.ts
export type ReflectionRecord = {
  readonly kind: "reflection";
  readonly reflection: {
    readonly trigger: "task_succeeded" | "task_error";
    readonly planRef: { readonly path: string; readonly taskId: string };
    readonly intent: "check_complete" | "append_error_note";
    readonly note?: string;
  };
};
```

- [ ] **Step 3: task-feedback / loop-handler のコンストラクタ DI の追加と ReflectionEvent 発行の実装（§8.2/D7）**
  - テストのモック容易性を高めるため、`TaskFeedbackHandler` および `LoopDetectionHandler` はコンストラクタで `ObservationHandler` （またはその省略可能なインターフェース）の依存関係注入を受けるように実装する。
  - 注入されなかった場合のフォールバック（または NoOp 実装など）を用意し、テストコード等ではモックを容易に差し込めるようにする。

```typescript
// src/hooks/task-feedback.ts のコンストラクタおよびメンバ追加
export class TaskFeedbackHandler {
  private readonly observationHandler?: ObservationHandler;
  // ...
  constructor(
    fileReader: FileReader,
    fileWriter: FileWriter,
    wisdomStore?: WisdomStoreInterface,
    observationHandler?: ObservationHandler
  ) {
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.wisdomStore = wisdomStore ?? new WisdomStore();
    this.observationHandler = observationHandler; // DI 経由での注入
    // ...
  }
}

// 既存 checkbox 更新後の箇所でReflectionEventを発行
if (this.observationHandler) {
  await this.observationHandler.emitReflectionEvent({
    trigger: "task_succeeded",
    planRef,
    intent: "check_complete",
    sessionId,
  });
}
```

```typescript
// src/hooks/loop-handler.ts のコンストラクタおよびメンバ追加
export class LoopDetectionHandler {
  private readonly observationHandler?: ObservationHandler;
  // ...
  constructor(
    fileReader: FileReader,
    fileWriter: FileWriter,
    splitter: TaskSplitter,
    observationHandler?: ObservationHandler
  ) {
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.observationHandler = observationHandler; // DI 経由での注入
    // ...
  }
}

// 既存のループエラー判定やエスカレーションのタイミングでReflectionEventを発行
if (this.observationHandler) {
  await this.observationHandler.emitReflectionEvent({
    trigger: "task_error",
    planRef,
    intent: "append_error_note",
    note: `Loop detected or max retries exceeded. Escalating/pivoting.`,
    sessionId,
  });
}
```

- [ ] **Step 3b: `JusticePlugin` への配線と統合テストの作成（D7）**
  - `src/core/justice-plugin.ts` で `ObservationHandler` をインスタンス化し、`TaskFeedbackHandler` と `LoopDetectionHandler` のコンストラクタへ渡すように修正する。
  - 新規統合テストファイル `tests/core/justice-plugin-reflection.test.ts` を作成し、実際の `JusticePlugin` インスタンスを通じて `TaskFeedback` 又は `LoopHandler` の動作契機で `ReflectionEvent` が正常に `ObservationLogStore` に発行・蓄積されることを検証する。

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-session-error.test.ts tests/core/v2/reflection-event.test.ts tests/core/justice-plugin-reflection.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/justice-plugin.ts src/core/v2/observation-model.ts src/core/v2/reflection-event.ts src/hooks/observation-handler.ts src/hooks/task-feedback.ts src/hooks/loop-handler.ts tests/hooks/observation-handler-session-error.test.ts tests/core/v2/reflection-event.test.ts tests/core/justice-plugin-reflection.test.ts
git commit -m "feat(v2): session error and reflection event seam with plugin wiring"
```

- [ ] **Step 6: Phase 4 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 4.3`（直前 Task から派生）。

---
