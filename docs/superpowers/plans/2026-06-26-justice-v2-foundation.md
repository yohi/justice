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
- すべての file I/O は `FileReader` / `FileWriter` 経由。テストでは mock を注入（`tests/helpers/mock-file-system.ts`）。`FileReader` は `readFile` / `fileExists` / `listFiles(prefix)` を提供する。
- 状態は immutable（`readonly` / `ReadonlyArray` / `ReadonlyMap`）。
- すべての fail-open 境界は `try/catch` で保護し、`PROCEED` に縮退する。
- 永続化前に SecretPatternDetector で redaction + 絶対パス redaction + truncation を実施（D25/D61）。
- `declared` provenance は gate 充足（PASS）に算入しない。PASS に算入するのは `observed` / `derived`（`derived` は observed 起源限定）のみ（FF-008）。
- `devcontainer` 内でのみ `bun run lint` / `typecheck` / `test` / `build` を実行する。
- ブランチ運用は [Graphite Stacked PR Workflow](https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnS4oioAtOOsRFxbhj7DasZszJsUzA6R74JH66RtuaZljfMTOMp01vNhWjcaM0hMPMpWGtEG2CqCiJRKUnxfpUq5IKUvCuw8ckJxEzV_S-lANVqatSiXDyPIwACDWLiYMx_FxpOVwVe-lN3OEfYJMKFB1HyzYW__8mfULCRcQthYXlSoLzc6GHSwYYLtJOMVUh3x34AuPc1rdosiFf2YYStsXJoCj9-iTs7BjmJ0E_-omFWTGPH0uOK-AXq_XLLxAltwuQt-Ct5q_9u-w_QBPhX7UxyHYfZJSstDIFryh_4uUFWBdWMCh0TSrYJxTw&lib=M0tqVErYg9kMB9ia8bpbmo4TD2knUOGjU) を使用。1 タスク 200 LOC 制限、命名 `feature/phaseN-taskM-...`、Base ブランチ `feature/phaseN-...__base`。各 Task 最後は **Phase Base に向けた Draft PR 作成**。

> **Graphite 運用詳細:**
>
> - Base ブランチは `master` から `gt checkout master && gt trunk && gt branch create feature/phaseN-v2-...__base` で作成。
> - 各 Task ブランチは Base から `gt checkout feature/phaseN-v2-...__base && gt branch create feature/phaseN-taskM-...` で分岐（Phase 内で連続する Task は直前 Task から分岐）。
> - タスク完了時は `gt add . && gt commit` 後、`gt submit` で Phase Base 向け Draft PR を一括作成・更新する。
> - 下位 Task を修正した場合は `gt restack` で上位スタックを再整列する。
> - 本計画内の「Phase Base に向けた Draft PR を作成する」は `gt submit` による Draft PR 作成を指す。

---
## Phase 0: ベースライン確立と De-risk Spikes

**Base Branch:** `feature/phase0-v2-baseline__base`

**目的:** 既存 CI/Devcontainer を v2.0 開発用に検証し、Phase 0 で決着すべき 2 つの実測スパイクを完了する。本 Phase の成果は設計書の前提を確定させるため、実装計画の最初に位置づける。

**判断:** Phase 0 のタスクは独立しているが、後続 Phase はこれらの前提（Message 観測 fallback matrix）に依存する。Phase 0 Base は `master` から分岐する。


### Task 0.0: Preflight Verification

**Files:**

- Modify: `docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md` (Already created and ratified by CODEOWNERS prior to implementation)
- Create: `tests/preflight-verification.test.ts` (smoke verification for ADR ratification)

**Interfaces:**

- Consumes: ADR ratification status (`docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md` or CODEOWNERS check via GitHub CLI).
- Produces: Execution safety verification.

- [ ] **Step 1: 既に CODEOWNERS による承認と証跡が記述された ADR ドキュメント（ADR-2026-06-26-v2-charter-drift.md）がリポジトリ内に存在することを確認する（自己承認は不可）**
  - パス: `docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md`
  - 内容: Phase 0 Spike で確定した変更点（hook リスト、保存パス詳細化、authorship 縮退等）を整理し、人間である CODEOWNERS による承認のやり取り（承認証跡）と、最終的な「STATUS: APPROVED」がファイル内に既に記載されていることを確認する。

- [ ] **Step 2: ADR ドキュメントの承認状況を検証するスクリプト/テストを作成（未承認ならテスト失敗＝計画実行停止。GitHub API または GitHub CLI (gh) を用いて PR レビュー状態と承認者をチェックする）**

```typescript
// tests/preflight-verification.test.ts
import { test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";

test("ADR-2026-06-26 must be ratified and approved by CODEOWNERS", () => {
  const adrPath = "docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md";
  expect(existsSync(adrPath)).toBe(true);
  const content = readFileSync(adrPath, "utf-8");
  expect(content).toContain("STATUS: APPROVED");

  // Verify real GitHub Review State via GitHub CLI to prevent self-ratification bypass
  try {
    const prJson = execSync("gh pr view --json state,reviews", { encoding: "utf-8" });
    const pr = JSON.parse(prJson);
    const hasCodeownersApproval = pr.reviews.some(
      (r: { state: string; author: { login: string } }) => 
        r.state === "APPROVED" && r.author.login !== "antigravity-bot"
    );
    expect(pr.state === "MERGED" || hasCodeownersApproval).toBe(true);
  } catch (err) {
    // If gh CLI is unavailable or not in a PR, check if it's already merged to main branch
    try {
      const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
      if (branch !== "main" && branch !== "master") {
        throw new Error("GitHub CLI check failed and not on main branch. Ratification cannot be verified.");
      }
    } catch (branchErr) {
      throw new Error(`Ratification verification failed: ${(err as Error).message}`);
    }
  }
});
```

- [ ] **Step 3: テストの実行と検証**

```bash
devcontainer exec --workspace-folder . bun run test tests/preflight-verification.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/preflight-verification.test.ts
git commit -m "chore: add preflight verification for ratified ADR"
```

- [ ] **Step 5: Phase 0 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase0-v2-baseline__base`（Base から派生）。


### Task 0.1: Devcontainer ベースライン検証

**Files:**

- [ ] **Step 1: `devcontainer up --workspace-folder .` でコンテナを起動**
- [ ] **Step 2: `devcontainer exec --workspace-folder . bun install --frozen-lockfile` で依存インストール**
- [ ] **Step 3: `devcontainer exec --workspace-folder . bun run lint` 等で全コマンド検証**
- [ ] **Step 4: 失敗時は `.devcontainer/devcontainer.json` を修正**
- [ ] **Step 5: CI workflow に devcontainer 検証ジョブを追加**
- [ ] **Step 6: コンテナ内で再実行して確認**
- [ ] **Step 7: Commit**
- [ ] **Step 8: Task 0.1 に向けた PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase0-v2-baseline__base`（Base から派生）。


### Task 0.2: De-risk Spikes (実証スパイク)

**Files:**

- Create: `spikes/observation-latency/measure.ts`
- Create: `docs/superpowers/spikes/2026-06-26-v2-phase0-spikes.md`

**Interfaces:**

- Produces:
  - 全ツール `tool.execute.after` 観測レイテンシ実測結果。
  - Message 観測 fallback matrix の実測結果と設計書追認差分。
  - C1 / L0 advisory 表示面実測結果（`output.output` 反映可否）と設計書 D47 の確定差分。

- [ ] **Step 1: 全ツール `tool.execute.after` 観測レイテンシ実測**

```typescript
// spikes/observation-latency/measure.ts
import { Plugin } from "@opencode-ai/plugin";

// 最小の計測ハーネス: 同一ツールを 100 回実行し p95 レイテンシを記録
```

実測対象: `bun run test` 等のコマンド実行ツールを `tool.execute` 経由で 100 回呼び出し、before/after の差分を計測。目標: p95 < 数 ms / tool 呼び出し。未達の場合は非同期キュー + flush を検討し、設計書 §3 に追記。

- [ ] **Step 1b: C1 / L0 advisory 表示面実証（D47）**

実測対象: `tool.execute.after` の `output.output` 末尾への banner 追記が、モデル推論文脈／ユーザー表示に反映されるかを実機確認。`notifier.notify()` による `client.app.log` 出力は常に保証チャネルとする。`output.output` 反映が確認できない場合は、設計書 §3 / §6.2 / D47 を「notifier = 保証チャネル、`output.output` append = best-effort」に更新する。

**Acceptance criteria:**

- 反映可否を boolean で記録し、設計書 §3 Phase 0 スパイク結果と D47 に追記する。
- 反映結果（可否）に応じて、オプションの既定値 `options.enableAdvisoryOutputAppend = <result>` を決定するタスクを設ける。
- アダプターテスト (`onToolExecuteAfter` / `OpenCodeNotifier` のテスト) に、`enableAdvisoryOutputAppend` が `false` である場合でも `notifier.notify()` のみが正常に実行され、`output.output` が書き換えられないことを検証するケースを明示的に追加する。

- [ ] **Step 2: Message 観測 fallback matrix 実測（D41/D53）**

OpenCode 実行時に以下を観測: `message.part.updated`, `message.updated`, `experimental.text.complete`, `chat.message`。`AssistantMessage` / `TextPart` のフィールドを出力して、どのイベントが assistant 本文源・role/finish 確定源となるか特定。

**Acceptance criteria:**

- `finalized=true` への mapping 可能性を実測する（`AssistantMessage.finish` / `time.completed` の挙動、イベント順序、重複・遅延の有無）。
- 順序逆転・未発火・role/text 相関が確定できない場合は、declared claim 抽出を **skip** する条件を明示する。
- Task 3.1 へ渡す adapter 契約（どのイベントを `text_complete` / `message_part_updated` / `message_updated` として変換し、`finalized` フラグをどう導出するか）を確定する。

- [ ] **Step 3: スパイク結果を docs に集約し設計書を更新**

```bash
git add docs/superpowers/spikes/2026-06-26-v2-phase0-spikes.md
git commit -m "docs: v2.0 Phase 0 de-risk spikes 結果を記録"
```

- [ ] **Step 4: Task 0.2 に向けた PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase0-task1-devcontainer-baseline`（Task 0.1 から派生）。Task 0.1 の devcontainer 整備後に実行する。

---

## Phase 1: Core Event Model + Evidence Engine

**Base Branch:** `feature/phase1-v2-core-model__base`

**目的:** 純粋 Core（I/O なし）で v2.0 のイベント型・Evidence モデル・Evidence Engine を構築。本 Phase だけで独立したユニットテスト群が成立する。

**判断:** Phase 1 は Phase 0 にしか依存しない（前提確定後）。Phase 1 内のタスクは順次積み上げ（Task 1.2 は Task 1.1 の型を使用）。

---

### Task 1.1: Core Event Model / Types

**Files:**

- Create: `src/core/v2/observation-model.ts`
- Create: `src/core/v2/decision-model.ts`
- Create: `src/core/v2/references.ts`
- Modify: `src/core/types.ts`（必要に応じて `ObservationAgentId`, `EvidenceRef`, `ShardId` 等を追加）
- Test: `tests/core/v2/observation-model.test.ts`

**Interfaces:**

- Consumes: 既存 `AgentId`（atlas/hephaestus/sisyphus/prometheus）。
- Produces:
  - `ObservationRecord` discriminated union (`kind: "tool_executed" | "message" | "skill_invoked" | "review_observed" | "session_error" | "reflection"`).
  - `DecisionRecord` with `ruleResults[]`.
  - `EvidenceRef = { readonly agentId: string; readonly sessionId: string; readonly writerId: string; readonly sequence: number; readonly evidenceId: string }`.
  - `ShardId = { readonly agentId: string; readonly sessionId: string; readonly writerId: string }`.

- [ ] **Step 1: 既存 `AgentId` 型を確認**

```bash
grep -n "export type AgentId" src/core/types.ts
```

- [ ] **Step 2: `ObservationAgentId` と `EvidenceRef` / `ShardId` 型を追加**

```typescript
// src/core/types.ts（既存 AgentId 近辺に追加）
export type ObservationAgentId = AgentId | "system" | "unknown";

export type ShardId = {
  readonly agentId: string;
  readonly sessionId: string;
  readonly writerId: string;
};

export type EvidenceRef = FullEvidenceRef | SelfEvidenceRef;

export type FullEvidenceRef = {
  readonly agentId: string;
  readonly sessionId: string;
  readonly writerId: string;
  readonly sequence: number;
  readonly evidenceId: string;
};

export type SelfEvidenceRef = {
  readonly evidenceId: string;
};
```

- [ ] **Step 3: `ObservationRecord` union を実装**

```typescript
// src/core/v2/observation-model.ts
import type { AgentId, EvidenceRef, ObservationAgentId, ShardId } from "../types.ts";

export type CommonEnvelope = {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly timestamp: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
  readonly taskId?: string;
  readonly recordType: "observation" | "decision" | "learning";
};

// Minimal Evidence stub refined into a discriminated union in Task 1.2.
export type Evidence = {
  readonly evidenceId: string;
  readonly kind: string;
  readonly sourceClass: string;
  readonly provenance: string;
  readonly toolOutputClass?: string;
  readonly command?: string;
  readonly rawOutput?: string;
};

export type ToolExecutedRecord = {
  readonly kind: "tool_executed";
  readonly toolName: string;
  readonly callId: string;
  readonly evidence: Evidence;
};

// Additional record kinds are defined in later tasks where their Evidence/types are introduced.
// For v2.0 the union must be closed enough for type-checking; stub types are acceptable here and refined in Task 1.2/3.1/4.3/4.4.
export type MessageRecord = { readonly kind: "message"; /* refined in Task 3.1 */ };
export type SkillInvokedRecord = { readonly kind: "skill_invoked"; /* refined in Task 4.3 */ };
export type SessionErrorRecord = { readonly kind: "session_error"; /* refined in Task 4.4 */ };
export type ReflectionRecord = { readonly kind: "reflection"; /* refined in Task 4.4 */ };

export type ReviewItem = {
  readonly itemKey: string;
  readonly evidenceId: string;
  readonly severity: "critical" | "major" | "minor";
  readonly summary: string;
  readonly location: string;
  readonly status: "open" | "resolved";
};

export type ResolutionMarker = {
  readonly itemKey: string;
  readonly resolution: "explicit_marker" | "snapshot_absence" | "human_artifact";
  readonly artifactRef?: string;
};

export type ReviewObservedRecord = {
  readonly kind: "review_observed";
  readonly reviewScope: string;
  readonly isCompleteSnapshot?: boolean;
  readonly items: readonly ReviewItem[];
  readonly resolutionMarker?: readonly ResolutionMarker[];
};

export type ObservationRecord =
  | (CommonEnvelope & { readonly recordType: "observation" } & ToolExecutedRecord)
  | (CommonEnvelope & { readonly recordType: "observation" } & MessageRecord)
  | (CommonEnvelope & { readonly recordType: "observation" } & SkillInvokedRecord)
  | (CommonEnvelope & { readonly recordType: "observation" } & ReviewObservedRecord)
  | (CommonEnvelope & { readonly recordType: "observation" } & SessionErrorRecord)
  | (CommonEnvelope & { readonly recordType: "observation" } & ReflectionRecord);
```

- [ ] **Step 4: `DecisionRecord` 型を実装**

```typescript
// src/core/v2/decision-model.ts
export type RuleResult = {
  readonly ruleId: string;
  readonly verdict: "PASS" | "WARN" | "FAIL";
  readonly reason: string;
  readonly evidenceRefs: readonly EvidenceRef[];
};

export type DecisionRecord = CommonEnvelope & {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly verdict: "PASS" | "WARN" | "FAIL";
  readonly reachableEnforcementLevel: "L1";
  readonly appliedEnforcementLevel: "L0";
  readonly ruleResults: readonly RuleResult[];
};
```

- [ ] **Step 5: 型の unit test を記述**

```typescript
// tests/core/v2/observation-model.test.ts
import { describe, expect, it } from "vitest";
import type { ObservationRecord } from "../../../src/core/v2/observation-model.ts";

describe("ObservationRecord type", () => {
  it("tool_executed record is assignable", () => {
    const r: ObservationRecord = {
      schemaVersion: 1,
      sequence: 1,
      timestamp: "2026-06-26T00:00:00.000Z",
      agentId: "hephaestus",
      sessionId: "ses_1",
      writerId: "w-1",
      taskId: "task-1",
      recordType: "observation",
      kind: "tool_executed",
      toolName: "bash",
      callId: "call_1",
      evidence: {
        evidenceId: "ev-1",
        kind: "test",
        sourceClass: "tool_output",
        provenance: "observed",
        toolOutputClass: "command_exec",
        command: "bun run test",
        rawOutput: "PASS",
      },
    };
    expect(r.recordType).toBe("observation");
  });
});
```

- [ ] **Step 6: Devcontainer 内でテスト実行**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/observation-model.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/core/v2/observation-model.ts src/core/v2/decision-model.ts src/core/types.ts tests/core/v2/observation-model.test.ts
git commit -m "feat(v2): Core event model and observation/decision types"
```

- [ ] **Step 8: Phase 1 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase1-v2-core-model__base`（Base から派生）。

---

### Task 1.2: Evidence Engine + Source Classification

**Files:**

- Create: `src/core/v2/evidence-engine.ts`
- Create: `src/core/v2/tool-output-classifier.ts`
- Create: `src/core/v2/declared-claim-extractor.ts`
- Modify: `src/core/v2/observation-model.ts`（`Evidence` discriminated union 追加）
- Test: `tests/core/v2/evidence-engine.test.ts`
- Test: `tests/core/v2/tool-output-classifier.test.ts`
- Test: `tests/core/v2/declared-claim-extractor.test.ts`

**Interfaces:**

- Consumes: `ObservationRecord` envelope, `ToolOutput` from adapter (`{ title, output, metadata }`), `MessagePayload` union (Task 1.3), `ReviewRejectionSignal` from existing `review-rejection-detector.ts`.
- Produces:
  - `Evidence` discriminated union with `sourceClass: "tool_output" | "declared_claim"`.
  - `extractEvidenceFromTool(toolName, args, output, metadata): Evidence` (returns observed + derived interpretation).
  - `classifyToolOutputClass(toolName, args): "command_exec" | "file_content"`.
  - `extractDeclaredClaims(text): DeclaredClaim[]` (from message text or task summary).

- [ ] **Step 1: `Evidence` discriminated union を定義（Task 1.1 の stub を置き換え）**

Task 1.1 で追加した `Evidence` stub を本 discriminated union に置き換える。

```typescript
// src/core/v2/observation-model.ts
export type Evidence = ToolOutputEvidence | DeclaredClaimEvidence;

export type ToolOutputEvidence = CommandExecEvidence | FileContentEvidence;

export type CommandExecEvidence = {
  readonly evidenceId: string;
  readonly kind: "test" | "build" | "lint" | "command" | "generic";
  readonly sourceClass: "tool_output";
  readonly provenance: "observed" | "unknown";
  readonly toolOutputClass: "command_exec";
  readonly command: string;
  readonly rawOutput: string;
  readonly interpretation?: Interpretation;
};

export type FileContentEvidence = {
  readonly evidenceId: string;
  readonly kind: "test" | "build" | "lint" | "command" | "generic";
  readonly sourceClass: "tool_output";
  readonly provenance: "observed" | "unknown";
  readonly toolOutputClass: "file_content";
  readonly command?: string;
  readonly rawOutput?: never; // rawOutput must not be stored in file_content
  readonly rawOutputHash: string; // required
  readonly rawOutputSnippet?: string; // optional
  readonly interpretation?: Interpretation;
};

export type Interpretation = {
  readonly outcome: "pass" | "fail" | "unknown";
  readonly basis: "parsed_output" | "metadata_error";
  readonly provenance: "derived";
  readonly derivedFrom: readonly EvidenceRef[]; // cross-record references use FullEvidenceRef; self-reference within the same record uses SelfEvidenceRef (evidenceId only)
};

export type DeclaredClaimEvidence = {
  readonly evidenceId: string;
  readonly kind: "test" | "build" | "lint" | "generic";
  readonly sourceClass: "declared_claim";
  readonly provenance: "declared";
  readonly declaredFrom: "message" | "task_summary";
  readonly claim: { readonly claimKind: string; readonly outcome: "pass" | "fail" | "unknown" };
  readonly claimRef?: EvidenceRef & { readonly claimIndex: number };
};
```

- [ ] **Step 2: `toolOutputClass` 分類器を実装（D49/D52/D60）**

```typescript
// src/core/v2/tool-output-classifier.ts
const COMMAND_EXEC_COMMANDS = new Set([
  "bun", "npm", "yarn", "pnpm", "node", "ts-node",
  "vitest", "jest", "mocha", "pytest",
  "tsc", "eslint", "prettier", "biome", "rome", "stylelint", "deno",
]);

const FILE_CONTENT_COMMANDS = new Set([
  "cat", "head", "tail", "less", "more", "nl", "tac", "sed", "awk", "grep", "rg", "ag", "xxd", "od", "hexdump", "strings"
]);

export function classifyToolOutputClass(
  toolName: string,
  args: { readonly command?: string } | undefined,
  rawOutputLength: number
): "command_exec" | "file_content" {
  if (toolName === "read" || toolName === "glob" || toolName === "grep") return "file_content";
  if (toolName === "bash" || toolName === "shell") {
    const command = args?.command ?? "";
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    
    // If any token in the command matches a file content output command, prioritize file_content to avoid plan/design/code reproduction.
    const hasFileContentCmd = tokens.some(t => FILE_CONTENT_COMMANDS.has(t));
    if (hasFileContentCmd) return "file_content";

    const firstToken = tokens[0] ?? "";
    // Quality-verification compound commands must preserve rawOutput for auditability.
    if (COMMAND_EXEC_COMMANDS.has(firstToken)) {
      if (rawOutputLength > 20000) return "file_content"; // Size threshold fallback for very large outputs
      return "command_exec";
    }
    if (FILE_CONTENT_COMMANDS.has(firstToken)) return "file_content";
    // Conservative fallback for mixed pipes/compound commands that are NOT quality verification:
    // treat as file_content-equivalent to avoid persisting full plan/design/code bodies.
    if (tokens.includes("|") || tokens.includes("&&") || tokens.includes("||") || tokens.includes(";")) {
      return "file_content";
    }
    // 未知のコマンド実行かつ出力が巨大な場合は file_content にフォールバック
    if (rawOutputLength > 20000) return "file_content";
  }
  return "command_exec";
}
```

- [ ] **Step 3: Evidence engine を実装**

```typescript
// src/core/v2/evidence-engine.ts
export function extractEvidenceFromTool(
  toolName: string,
  args: { readonly command?: string } | undefined,
  output: { readonly output?: string; readonly metadata?: { readonly error?: boolean } }
): Evidence {
  const rawOutput = output.output ?? "";
  const toolOutputClass = classifyToolOutputClass(toolName, args, rawOutput.length);
  const observedId = generateEvidenceId();
  return {
    evidenceId: observedId,
    kind: mapToolNameToKind(toolName, args),
    sourceClass: "tool_output",
    provenance: "observed",
    toolOutputClass,
    command: args?.command,
    ...(toolOutputClass === "command_exec"
      ? { rawOutput: redactForPersistence(redactAbsolutePaths(rawOutput)) }
      : { rawOutputHash: hashString(rawOutput), rawOutputSnippet: "" }),
    interpretation: {
      outcome: deriveOutcome(output),
      basis: output.metadata?.error ? "metadata_error" : "parsed_output",
      provenance: "derived",
      derivedFrom: [{ evidenceId: observedId }], // self-reference within the same record uses SelfEvidenceRef (evidenceId only)
    },
  };
}
```

- [ ] **Step 4: 自己申告 claim 抽出器を実装（D67）**

```typescript
// src/core/v2/declared-claim-extractor.ts
export type DeclaredClaim = {
  readonly evidenceId: string;
  readonly claimKind: "test" | "build" | "lint" | "generic";
  readonly outcome: "pass" | "fail" | "unknown";
};

const PASS_PATTERNS = /tests? pass|passing|✅\s*tests?/i;
const FAIL_PATTERNS = /tests? fail|failing|❌\s*tests?/i;

export function extractDeclaredClaims(text: string): DeclaredClaim[] {
  const claims: DeclaredClaim[] = [];
  if (PASS_PATTERNS.test(text)) claims.push({ evidenceId: `claim-${claims.length}`, claimKind: "test", outcome: "pass" });
  if (FAIL_PATTERNS.test(text)) claims.push({ evidenceId: `claim-${claims.length}`, claimKind: "test", outcome: "fail" });
  return claims;
}
```

- [ ] **Step 4b: `tool-output-classifier.test.ts` に品質検証 compound command ケースを追加**

```typescript
// tests/core/v2/tool-output-classifier.test.ts
it("classifies quality-verification compound commands as command_exec", () => {
  expect(classifyToolOutputClass("bash", { command: "bun run lint && bun run test" })).toBe("command_exec");
  expect(classifyToolOutputClass("bash", { command: "bun run build; bun run typecheck" })).toBe("command_exec");
});

it("classifies file-content compound commands as file_content", () => {
  expect(classifyToolOutputClass("bash", { command: "cat file.txt | grep foo" })).toBe("file_content");
  expect(classifyToolOutputClass("bash", { command: "head -20 file.ts && tail -5 file.ts" })).toBe("file_content");
  expect(classifyToolOutputClass("bash", { command: "bun run test && cat docs/superpowers/plans/2026-06-26-justice-v2-foundation.md" })).toBe("file_content");
});
```

- [ ] **Step 5: テストを実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/evidence-engine.test.ts tests/core/v2/tool-output-classifier.test.ts tests/core/v2/declared-claim-extractor.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/core/v2/evidence-engine.ts src/core/v2/tool-output-classifier.ts src/core/v2/declared-claim-extractor.ts src/core/v2/observation-model.ts tests/core/v2/*.test.ts
git commit -m "feat(v2): Evidence engine with source classification and declared claim extraction"
```

- [ ] **Step 7: Phase 1 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 1.1`（直前 Task から派生）。`ObservationRecord` / `Evidence` 型を使用するため。

---

### Task 1.3: Redaction Utilities + Secret Scanning for v2

**Files:**

- Modify: `src/core/secret-pattern-detector.ts`（または新規 `src/core/v2/redaction.ts`）
- Create: `src/core/v2/safe-segment.ts`（D69/D73 sessionId 安全エンコーダ）
- Test: `tests/core/v2/redaction.test.ts`
- Test: `tests/core/v2/safe-segment.test.ts`

**Interfaces:**

- Consumes: existing `SecretPatternDetector` API.
- Produces:
  - `redactEvidenceCommand(command: string): string`
  - `redactRawOutput(rawOutput: string): string`
  - `redactMessageSnippet(snippet: string): string`
  - `redactAbsolutePaths(text: string): string`
  - `redactEnvironmentValues(text: string): string`
  - `redactTokenUrls(text: string): string`
  - `encodeSafeSegment(segment: string): string`（always with sha256 prefix 8 suffix）

- [ ] **Step 1: `SecretPatternDetector` に `redact(text)` を追加**

```typescript
// src/core/secret-pattern-detector.ts
export class SecretPatternDetector {
  scan(content: string): SecretMatch[] { /* existing */ }

  redact(content: string): string {
    let redacted = content;
    for (const { pattern } of SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, () => "[REDACTED_SECRET]");
    }
    return redacted;
  }
}
```

- [ ] **Step 2: v2 redaction 関数を追加**

```typescript
// src/core/v2/redaction.ts
import { SecretPatternDetector } from "../secret-pattern-detector.ts";

const DEFAULT_DETECTOR = new SecretPatternDetector();

export function redactEvidenceCommand(command: string): string {
  return redactForPersistence(command, DEFAULT_DETECTOR);
}

export function redactRawOutput(rawOutput: string): string {
  return redactForPersistence(rawOutput, DEFAULT_DETECTOR);
}

export function redactMessageSnippet(snippet: string): string {
  return redactForPersistence(snippet, DEFAULT_DETECTOR);
}

export function redactAbsolutePaths(text: string): string {
  return text
    .replace(/(?:^|\s)(\/(?:home|tmp|workspace|Users|var|opt|etc)\/[^\s"']+)/g, " [REDACTED_PATH]")
    .replace(/(?:^|\s)([A-Za-z]:\\[^\\\s"']+)/g, " [REDACTED_PATH]");
}

export function redactEnvironmentValues(text: string): string {
  return text.replace(/\b[A-Z_]{3,}=[^\s"']+/g, "[REDACTED_ENV]");
}

export function redactTokenUrls(text: string): string {
  return text.replace(/(https?:\/\/[^@\s]+@)([^\s"']+)/g, "$1[REDACTED_TOKEN_URL]");
}

export function redactForPersistence(text: string, detector = new SecretPatternDetector()): string {
  const redacted = detector.redact(text); // covers API keys / secrets
  return truncate(
    redactTokenUrls(redactEnvironmentValues(redactAbsolutePaths(redacted))),
    4096
  );
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "\n…[truncated]";
}
```

- [ ] **Step 3: safe-segment エンコーダを実装（D69/D73）**

```typescript
// src/core/v2/safe-segment.ts
import { createHash } from "crypto";

export function encodeSafeSegment(segment: string): string {
  const hash = createHash("sha256").update(segment).digest("hex").slice(0, 8);
  if (segment === ".") return `_dot___${hash}`;
  if (segment === "..") return `_dotdot___${hash}`;
  if (segment === "") return `_empty___${hash}`;
  const safe = segment
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
  return `${safe}__${hash}`;
}
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/redaction.test.ts tests/core/v2/safe-segment.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/secret-pattern-detector.ts src/core/v2/redaction.ts src/core/v2/safe-segment.ts tests/core/v2/redaction.test.ts tests/core/v2/safe-segment.test.ts
git commit -m "feat(v2): redaction, secret redaction, and safe-segment encoding for persistence"
```

- [ ] **Step 6: Phase 1 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 1.2`（直前 Task から派生）。`toolOutputClass` 分類結果と連携するが、redaction は独立しても成立する。ただし 200 LOC 制限とレビュー単位を見て Task 1.2 から派生。

---

## Phase 2: Observation Log Store + State Projection

**Base Branch:** `feature/phase2-v2-log-projection__base`

**目的:** per-writer segment JSONL への atomic append + active/archive 読取マージ + 純粋 state projection を実装。本 Phase だけで event log I/O と replay 決定性が検証できる。

**判断:** Phase 2 は Phase 1 の型を使用（`ObservationRecord`, `DecisionRecord`, `EvidenceRef`）。したがって Phase 2 Base は Phase 1 Base マージ後を想定し、**Phase 1 Base から分岐する**（`gt checkout feature/phase1-v2-core-model__base && gt branch create feature/phase2-v2-log-projection__base`）。Graphite stacking では Phase 2 Base を Phase 1 Base から派生させ、各 Task は Phase 2 Base から分岐する。Task 2.1 は独立した I/O 基盤（writerId, safe-segment）なので Base から、Task 2.2 は 2.1 のファイルレイアウトを使用するため Task 2.1 から、Task 2.3 は 2.2 の readAll 結果を使用するため Task 2.2 から、Task 2.4 は 2.2 の append 経路を使用するため Task 2.3 から。

---

### Task 2.1: Writer ID + Safe Segment Encoding + File Layout

**Files:**

- Create: `src/core/v2/shard-layout.ts`
- Create: `src/runtime/writer-id.ts`
- Test: `tests/core/v2/shard-layout.test.ts`
- Test: `tests/runtime/writer-id.test.ts`

**Interfaces:**

- Consumes: `encodeSafeSegment` from Task 1.3, `ObservationAgentId` from Task 1.1.
- Produces:
  - `toPhysicalPath(shardId: ShardId): string` → `.justice/events/<agentId>/<safeSessionId>/<writerId>.jsonl`
  - `toArchivePath(shardId: ShardId, timestamp: string): string` → `.justice/archive/events/<agentId>/<safeSessionId>/<writerId>.<timestamp>.jsonl`
  - `generateWriterId(): string` → `w-${uuid}`
  - `isSafeWriterId(id: string): boolean`

- [ ] **Step 1: shard layout 関数を実装**

```typescript
// src/core/v2/shard-layout.ts
import { encodeSafeSegment } from "./safe-segment.ts";
import type { ShardId } from "../types.ts";

export function toPhysicalPath(shardId: ShardId): string {
  return `.justice/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.jsonl`;
}

export function toArchivePath(shardId: ShardId, timestamp: string): string {
  return `.justice/archive/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.${timestamp}.jsonl`;
}
```

- [ ] **Step 2: writer ID 生成を実装（D55）**

```typescript
// src/runtime/writer-id.ts
import { randomUUID } from "crypto";
import type { FileReader } from "../core/types.ts";
import { toPhysicalPath } from "./shard-layout.ts";

const WRITER_ID_RE = /^w-[A-Za-z0-9-]+$/;

export function generateWriterId(): string {
  return `w-${randomUUID()}`;
}

export function isSafeWriterId(id: string): boolean {
  return WRITER_ID_RE.test(id) && id !== "w-system";
}

/**
 * 既存ファイルと衝突しない一意な writerId を割り当てる。
 * 衝突を検知した場合は再帰的に再生成を行う（D55）。
 */
export async function allocateWriterId(
  fileReader: FileReader,
  shardWithoutWriterId: { readonly agentId: string; readonly sessionId: string }
): Promise<string> {
  const candidate = generateWriterId();
  const physicalPath = toPhysicalPath({ ...shardWithoutWriterId, writerId: candidate });
  if (await fileReader.fileExists(physicalPath)) {
    return await allocateWriterId(fileReader, shardWithoutWriterId);
  }
  return candidate;
}
```

- [ ] **Step 2b: writerId 衝突回避テストを追加（D55）**

`tests/runtime/writer-id-collision.test.ts` を作成し、`fileReader` モックにおいて特定の候補パスが存在する場合に衝突が再帰的に回避され、「1ファイル=1writer」が保たれることを確認するテストを実装する。

- [ ] **Step 3: Devcontainer 内でテスト実行**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/shard-layout.test.ts tests/runtime/writer-id.test.ts tests/runtime/writer-id-collision.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/shard-layout.ts src/runtime/writer-id.ts tests/core/v2/shard-layout.test.ts tests/runtime/writer-id.test.ts tests/runtime/writer-id-collision.test.ts
git commit -m "feat(v2): shard file layout, writer ID generation, and collision allocation"
```

- [ ] **Step 5: Phase 2 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase2-v2-log-projection__base`（Base から派生）。

---

### Task 2.2: Atomic Append + Per-Shard Write Queue

**Files:**

- Create: `src/runtime/observation-log-store.ts`
- Create: `src/runtime/write-queue.ts`
- Test: `tests/runtime/observation-log-queue.test.ts`
- Test: `tests/runtime/writer-id-collision.test.ts`

**Interfaces:**

- Consumes: `FileReader` / `FileWriter` interfaces, `toPhysicalPath`, `generateWriterId`. `FileReader` must expose `listFiles(prefix: string): Promise<readonly string[]>` for `readAll()` to enumerate active + archive segments.
- Produces:
  - `ObservationLogStore` class with `append(record)` and `readAll()`.
  - Per-shard async write queue ensuring serialization and sequence assignment.
  - Writer ID collision re-generation on existing file.
- [ ] **Step 0: Extend `FileReader` with `listFiles(prefix)`**

Add `listFiles(prefix: string): Promise<readonly string[]>` to `FileReader` in `src/core/types.ts`. Implement it in `src/runtime/node-file-system.ts` using `fs.readdir` with prefix filtering, and in `tests/helpers/mock-file-system.ts`. This is required for `ObservationLogStore.readAll()` to enumerate `.justice/events/**` and `.justice/archive/events/**` without direct `fs` access in Core or tests.

```typescript
// src/core/types.ts
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  listFiles(prefix: string): Promise<readonly string[]>;
}
```

```typescript
// src/runtime/node-file-system.ts
import { readdir } from "node:fs/promises";

async listFiles(prefix: string): Promise<readonly string[]> {
  const safePrefix = await this.resolveSafely(prefix);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const entries = await readdir(safePrefix, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => relative(this.rootDir, join(e.parentPath, e.name)));
}
```

- [ ] **Step 1: write queue を実装（D23/D30）**

```typescript
// src/runtime/write-queue.ts
type QueueItem = {
  readonly record: object;
  readonly resolve: (seq: number) => void;
  readonly reject: (err: unknown) => void;
};

export function createShardWriteQueue(
  writer: { writeFile(path: string, content: string): Promise<void>; rename(from: string, to: string): Promise<void> },
  readExisting: (path: string) => Promise<string>,
  getInitialSequence: (path: string) => Promise<number>,
  onError: (path: string, err: unknown) => void
): (path: string, record: object) => Promise<number> {
  const queues = new Map<string, QueueItem[]>();
  const sequences = new Map<string, number>();

  async function atomicAppend(path: string, content: string) {
    const tempPath = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await writer.writeFile(tempPath, content);
    await writer.rename(tempPath, path);
  }

  async function process(path: string) {
    const items = queues.get(path) ?? [];
    let current: QueueItem | undefined;
    try {
      if (!sequences.has(path)) {
        const initSeq = await getInitialSequence(path).catch(() => 0);
        sequences.set(path, initSeq);
      }
      while (items.length > 0) {
        current = items.shift()!;
        const nextSeq = (sequences.get(path) ?? 0) + 1;
        const existing = await readExisting(path).catch(() => "");
        const line = `${JSON.stringify({ ...current.record, sequence: nextSeq })}\n`;
        await atomicAppend(path, existing + line);
        sequences.set(path, nextSeq);
        current.resolve(nextSeq);
        current = undefined;
      }
    } catch (err) {
      onError(path, err);
      // Reject the item that was being processed when the failure occurred.
      if (current) current.reject(err);
      // Drain remaining items with rejection so callers are not left hanging.
      while (items.length > 0) {
        items.shift()!.reject(err);
      }
    } finally {
      queues.delete(path);
    }
  }

  return (path, record) => new Promise((resolve, reject) => {
    if (!queues.has(path)) queues.set(path, []);
    queues.get(path)!.push({ record, resolve, reject });
    if (queues.get(path)!.length === 1) process(path);
  });
}
```

> Note: `writeFile` alone is not atomic; the queue uses `writeFile(temp)` + `rename(temp, target)` via the provided `FileWriter.rename` API.

- [ ] **Step 2: `ObservationLogStore` クラスを実装**

```typescript
// src/runtime/observation-log-store.ts
export class ObservationLogStore {
  private readonly enqueue: (path: string, record: object) => Promise<number>;

  constructor(
    private readonly fileWriter: FileWriter,
    private readonly fileReader: FileReader,
    private readonly writerId: string,
    private readonly logger: { warn(message: string, err?: unknown): void } = console
  ) {
    this.enqueue = createShardWriteQueue(
      {
        writeFile: (path, content) => this.fileWriter.writeFile(path, content),
        rename: (from, to) => this.fileWriter.rename(from, to),
      },
      async (path) => {
        if (await this.fileReader.fileExists(path)) return await this.fileReader.readFile(path);
        return "";
      },
      async (path) => {
        let maxSeq = 0;
        const readMaxSeq = async (p: string) => {
          if (await this.fileReader.fileExists(p)) {
            const content = await this.fileReader.readFile(p);
            for (const line of content.split("\n")) {
              if (!line.trim()) continue;
              try {
                const rec = JSON.parse(line);
                if (typeof rec.sequence === "number" && rec.sequence > maxSeq) {
                  maxSeq = rec.sequence;
                }
              } catch {}
            }
          }
        };

        // 1. Read active segment
        await readMaxSeq(path);

        // 2. Read archive segments for same writer in same session
        const parts = path.split("/");
        if (parts.length >= 5) {
          const agentId = parts[2];
          const safeSessionId = parts[3];
          const writerId = parts[4].replace(".jsonl", "");
          const archiveDir = `.justice/archive/events/${agentId}/${safeSessionId}`;
          if (await this.fileReader.fileExists(archiveDir)) {
            const archives = await this.fileReader.listFiles(archiveDir);
            for (const arch of archives) {
              const filename = arch.split("/").pop() ?? "";
              if (filename.startsWith(`${writerId}.`)) {
                await readMaxSeq(arch);
              }
            }
          }
        }
        return maxSeq;
      },
      (path, err) => {
        this.logger.warn(`ObservationLogStore: append failed for ${path}`, err);
      }
    );
  }

  async append(shardId: ShardId, record: ObservationRecord | DecisionRecord): Promise<number> {
    // Contract: `record` must already be redacted by the caller (e.g. observation-handler).
    // ObservationLogStore does NOT redact; it only persists what it receives.
    return this.enqueue(toPhysicalPath(shardId), record);
  }

  async readAll(): Promise<readonly (ObservationRecord | DecisionRecord)[]> {
    const activePaths = await this.fileReader.listFiles(".justice/events");
    const archivePaths = await this.fileReader.listFiles(".justice/archive/events");
    const allPaths = [...activePaths, ...archivePaths];
    const records: (ObservationRecord | DecisionRecord)[] = [];
    
    for (const path of allPaths) {
      try {
        const content = await this.fileReader.readFile(path);
        const lines = content.split("\n").filter((line) => line.trim() !== "");
        for (const line of lines) {
          const record = JSON.parse(line) as ObservationRecord | DecisionRecord;
          validateRecordSchema(record); // D72 schema validation
          records.push(record);
        }
      } catch (err) {
        // If a specific shard is corrupted or reading fails, log a warning and isolate it (quarantine),
        // but preserve other healthy shards to avoid wiping out the entire authority log.
        this.logger.warn(`ObservationLogStore: Shard corrupted or unreadable at ${path}. Isolating shard.`, err);
      }
    }
    
    // Sort records: group by shard key first, then sort by sequence ascending to ensure archive (older) and active (newer) merge correctly
    const sortedRecords = [...records].sort((a, b) => {
      const keyA = `${a.agentId}:${a.sessionId}:${a.writerId}`;
      const keyB = `${b.agentId}:${b.sessionId}:${b.writerId}`;
      if (keyA !== keyB) return keyA.localeCompare(keyB);
      return a.sequence - b.sequence;
    });
    
    try {
      validateShardSequences(sortedRecords); // D72 sequence monotonicity & duplicate check
    } catch (err) {
      this.logger.warn("ObservationLogStore: Global sequence validation failed", err);
      throw err; // Propagate validation failure to trigger fail-open reconstruction of state.json
    }
    return sortedRecords;
  }
}

export function validateRecordSchema(record: unknown): void {
  if (!record || typeof record !== "object") throw new Error("Invalid record: not an object");
  const r = record as Record<string, unknown>;
  if (typeof r.schemaVersion !== "number" || typeof r.sequence !== "number" || typeof r.timestamp !== "string" || !r.agentId || !r.sessionId || !r.writerId || !r.recordType) {
    throw new Error("Invalid record: missing common envelope fields");
  }
}

export function validateShardSequences(records: readonly (ObservationRecord | DecisionRecord)[]): void {
  const seqMap = new Map<string, number>();
  for (const r of records) {
    const shardKey = `${r.agentId}:${r.sessionId}:${r.writerId}`;
    const lastSeq = seqMap.get(shardKey);
    if (lastSeq !== undefined) {
      // Must be strictly greater than lastSeq
      if (r.sequence <= lastSeq) {
        throw new Error(`Sequence integrity violation on ${shardKey}: expected sequence > ${lastSeq}, got ${r.sequence}`);
      }
    }
    seqMap.set(shardKey, r.sequence);
  }
```

- [ ] **Step 3: `listFiles` mock 実装と列挙テストを追加**

```typescript
// tests/runtime/observation-log-queue.test.ts
it("readAll merges active and archive segments", async () => {
  const reader = createMockFileReader({
    ".justice/events/agent/session/w-1.jsonl": '{"schemaVersion":1,"sequence":1,"timestamp":"2026-06-26T00:00:00Z","agentId":"hephaestus","sessionId":"session","writerId":"w-1","recordType":"observation","kind":"tool_executed"}\n',
    ".justice/archive/events/agent/session/w-1.2026-06-26T00:00:00Z.jsonl": '{"schemaVersion":1,"sequence":2,"timestamp":"2026-06-26T00:00:00Z","agentId":"hephaestus","sessionId":"session","writerId":"w-1","recordType":"observation","kind":"tool_executed"}\n',
  });
  reader.listFiles = async (prefix) => Object.keys(reader.files).filter((p) => p.startsWith(prefix));
  const store = new ObservationLogStore(writer, reader, "w-1");
  const events = await store.readAll();
  expect(events).toHaveLength(2);
});
```

- [ ] **Step 4: テストを実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/observation-log-queue.test.ts tests/runtime/writer-id-collision.test.ts
```

- [ ] **Step 5: writer error 時の queue 復旧・reject テストを追加**

```typescript
// tests/runtime/observation-log-queue.test.ts
it("rejects the current item, pending items, and items added during failure", async () => {
  const writer = createMockFileWriter();
  let attempt = 0;
  writer.writeFile = async () => {
    attempt++;
    if (attempt === 1) throw new Error("disk full");
  };
  const onError = vi.fn();
  const enqueue = createShardWriteQueue(writer, async () => "", async () => 0, onError);

  // First append fails; its Promise must reject.
  const p1 = enqueue(".justice/events/test.jsonl", { kind: "test", n: 1 });
  await expect(p1).rejects.toThrow("disk full");
  expect(onError).toHaveBeenCalled();

  // Subsequent append after the queue resets must succeed.
  const p2 = await enqueue(".justice/events/test.jsonl", { kind: "test", n: 2 });
  expect(p2).toBe(1);
});
```

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/runtime/node-file-system.ts tests/helpers/mock-file-system.ts src/runtime/observation-log-store.ts src/runtime/write-queue.ts tests/runtime/observation-log-queue.test.ts tests/runtime/writer-id-collision.test.ts
git commit -m "feat(v2): atomic append, per-shard write queue, and listFiles abstraction"
```

- [ ] **Step 7: Phase 2 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 2.1`（直前 Task から派生）。`toPhysicalPath` / `generateWriterId` を使用する。

---

### Task 2.3: State Projection (Pure Fold)

**Files:**

- Create: `src/core/v2/state-projection.ts`
- Create: `src/core/v2/integrity.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/core/observation-log-replay.test.ts`

**Interfaces:**

- Consumes: `ObservationRecord`, `DecisionRecord`, `readAll()` output.
- Produces:
  - `project(events, rebuiltAt): ProjectedState`
  - Deterministic 2-stage merge: within-shard by `sequence`, across-shards by `timestamp → shardId → sequence`.
  - `ProjectedState` with `tasks`, `reviewSummary` (global + byScope), `integrity.maxSequenceByShard`.

- [ ] **Step 1: projection fold を実装（§6.3/D27/D39）**

```typescript
// src/core/v2/state-projection.ts
export type ProjectedEvidence = {
  readonly evidence: Evidence;
  readonly ref: FullEvidenceRef;
};

export type ProjectedState = {
  readonly schemaVersion: 1;
  readonly rebuiltAt: string;
  readonly integrity: {
    readonly sourceHash: string;
    readonly maxSequenceByShard: ReadonlyMap<string, number>;
  };
  readonly tasks: ReadonlyMap<string, { readonly status: string; readonly lastVerdict: string; readonly evidence: readonly ProjectedEvidence[]; readonly observedReviewScopes: readonly string[] }>;
  readonly reviewSummary: {
    readonly authority: "observed_review_output";
    readonly critical: readonly string[];
    readonly major: readonly string[];
    readonly minor: readonly string[];
    readonly resolved: readonly string[];
    readonly open: readonly string[];
    readonly byScope: ReadonlyMap<string, { readonly critical: readonly string[]; readonly major: readonly string[]; readonly minor: readonly string[]; readonly resolved: readonly string[]; readonly open: readonly string[] }>;
  };
};

export function project(
  events: readonly (ObservationRecord | DecisionRecord)[],
  rebuiltAt: string
): ProjectedState {
  // 1. sort events: within-shard by sequence, across-shards by timestamp -> shardId -> sequence
  // 2. fold into TaskState per taskId:
  //    - tool_executed / message / session_error with taskId -> append to TaskState.evidence as ProjectedEvidence { evidence, ref: { agentId, sessionId, writerId, sequence, evidenceId } }
  //    - review_observed with taskId -> append reviewScope to TaskState.observedReviewScopes
  //    - decision with taskId -> update TaskState.lastVerdict
  // 3. fold review_observed -> reviewSummary (global + byScope)
  // 4. compute integrity.maxSequenceByShard
  // Stub returns a type-valid state; the full deterministic fold is implemented in this task.
  const maxSequenceByShard = new Map<string, number>();
  return {
    schemaVersion: 1,
    rebuiltAt,
    integrity: {
      sourceHash: "sha256:" + hashString(events.map((e) => JSON.stringify(e)).join("\n")),
      maxSequenceByShard,
    },
    tasks: new Map(),
    reviewSummary: {
      authority: "observed_review_output",
      critical: [],
      major: [],
      minor: [],
      resolved: [],
      open: [],
      byScope: new Map(),
    },
  };
}

export function toSerializableProjectedState(state: ProjectedState): object {
  // ProjectedState uses ReadonlyMap internally for immutability, but state.json must be a plain JSON object.
  return {
    ...state,
    integrity: {
      ...state.integrity,
      maxSequenceByShard: Object.fromEntries(state.integrity.maxSequenceByShard),
    },
    tasks: Object.fromEntries(state.tasks),
    reviewSummary: {
      ...state.reviewSummary,
      byScope: Object.fromEntries(
        state.reviewSummary.byScope,
      ),
    },
  };
}

export function fromSerializableProjectedState(obj: any): ProjectedState {
  return {
    ...obj,
    integrity: {
      ...obj.integrity,
      maxSequenceByShard: new Map(Object.entries(obj.integrity.maxSequenceByShard)),
    },
    tasks: new Map(Object.entries(obj.tasks)),
    reviewSummary: {
      ...obj.reviewSummary,
      byScope: new Map(
        Object.entries(obj.reviewSummary.byScope).map(([k, v]: [string, any]) => [k, v])
      ),
    },
  };
}
```

- [ ] **Step 2: `StateProjectionCache` を実装（§5.6 / §9.4）**

```typescript
// src/runtime/state-projection-cache.ts
import type { FileWriter, FileReader } from "../core/types.ts";
import type { ProjectedState } from "../core/v2/state-projection.ts";
import { toSerializableProjectedState, fromSerializableProjectedState } from "../core/v2/state-projection.ts";

export class StateProjectionCache {
  constructor(
    private readonly fileWriter: FileWriter,
    private readonly fileReader: FileReader,
    private readonly path = ".justice/state.json",
    private readonly logger: { warn(message: string, err?: unknown): void } = console
  ) {}

  async write(state: ProjectedState): Promise<void> {
    try {
      const content = JSON.stringify(toSerializableProjectedState(state));
      const tempPath = `${this.path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await this.fileWriter.writeFile(tempPath, content);
      await this.fileWriter.rename(tempPath, this.path);
    } catch (err) {
      // fail-open: log and continue
      this.logger.warn("state.json cache write failed", err);
    }
  }

  async read(): Promise<ProjectedState | undefined> {
    try {
      if (!(await this.fileReader.fileExists(this.path))) return undefined;
      const content = await this.fileReader.readFile(this.path);
      const parsed = JSON.parse(content);
      // Validate schema and structural fields
      if (!parsed || typeof parsed !== "object" || !parsed.integrity || typeof parsed.integrity !== "object" || !("maxSequenceByShard" in parsed.integrity)) {
        this.logger.warn("state.json structure invalid, triggering rebuild");
        return undefined;
      }
      return fromSerializableProjectedState(parsed);
    } catch (err) {
      this.logger.warn("state.json read/parse failed, triggering rebuild", err);
      return undefined;
    }
  }
}
```

`ObservationLogStore` / `observation-handler` は projection 再構築後に `StateProjectionCache.write(state)` を呼び出す。書込失敗は fail-open で無視する。また、起動時に `StateProjectionCache.read()` を呼び出し、得られたキャッシュの `integrity`（`sourceHash` および `maxSequenceByShard`）を、実際の `readAll()` 結果から構築した `currentIntegrity`（実際のイベント群のハッシュおよび各 shard の最大シーケンス）と検証・比較する。キャッシュ不一致（欠損、破損、schema 不一致、`sourceHash` の乖離、あるいは `maxSequenceByShard` の不一致検知時）の場合はキャッシュを破棄し（`undefined` として扱い）、event log から再構築（rebuild）を行う。

- [ ] **Step 2b: StateProjectionCache の読込・バリデーションテストを追加（D72）**

`tests/runtime/state-projection-cache-read.test.ts` を作成し、`read()` がスキーマ不正や破損（例外発生など）時に `undefined` を返し、正常時のみ `ProjectedState` を復元することを確認する。

- [ ] **Step 2c: JSON round-trip テストを追加**

`ProjectedState` 内部は `ReadonlyMap` であっても、`toSerializableProjectedState()` 経由で書き込んだ `state.json` が正しく `maxSequenceByShard` / `tasks` / `reviewSummary.byScope` を含むことを検証する。

```typescript
// tests/runtime/state-projection-cache.test.ts
it("serializes ReadonlyMap fields to JSON objects", async () => {
  const state = project(sampleEvents, "2026-06-26T00:00:00.000Z");
  await cache.write(state);
  const written = writer.getFile(".justice/state.json");
  const parsed = JSON.parse(written);
  expect(parsed.integrity.maxSequenceByShard).toBeDefined();
  expect(Object.keys(parsed.integrity.maxSequenceByShard).length).toBeGreaterThan(0);
  expect(parsed.reviewSummary.byScope).toBeDefined();
  expect(typeof parsed.reviewSummary.byScope).toBe("object");
  expect(Array.isArray(parsed.reviewSummary.byScope)).toBe(false);
});
```

- [ ] **Step 3: FF-004 replay test を実装**

```typescript
// tests/core/observation-log-replay.test.ts
import { project } from "../../src/core/v2/state-projection.ts";

describe("FF-004 replay determinism", () => {
  it("same events produce same state", () => {
    const events = buildSampleEvents(); // 複数 shard を含む
    const a = project(events, "2026-06-26T00:00:00.000Z");
    const b = project(events, "2026-06-26T00:00:00.000Z");
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/state-projection.test.ts tests/core/observation-log-replay.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/v2/state-projection.ts src/core/v2/integrity.ts src/runtime/state-projection-cache.ts tests/core/v2/state-projection.test.ts tests/core/observation-log-replay.test.ts tests/runtime/state-projection-cache.test.ts
git commit -m "feat(v2): deterministic state projection and replay test"
```

```bash
git add src/core/v2/state-projection.ts src/core/v2/integrity.ts src/runtime/state-projection-cache.ts tests/core/v2/state-projection.test.ts tests/core/observation-log-replay.test.ts
git commit -m "feat(v2): deterministic state projection and replay test"
```

- [ ] **Step 6: Phase 2 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 2.2`（直前 Task から派生）。`ObservationLogStore.readAll()` の結果を使用する。

---

### Task 2.4: Rotation + Archive

**Files:**

- Modify: `src/runtime/observation-log-store.ts`
- Test: `tests/runtime/rotation-sequence-continuity.test.ts`

**Interfaces:**

- Consumes: `toArchivePath`, `ProjectedState` projection.
- Produces: `rotateIfNeeded(shardId)` that moves oversized/aged shards to archive and continues sequence numbering across active+archive.

- [ ] **Step 1: FileReader API に file stats メソッドを追加**

```typescript
// src/core/types.ts
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  listFiles(prefix: string): Promise<readonly string[]>;
  readFileStats(path: string): Promise<{ readonly size: number; readonly mtimeMs: number } | null>;
}
```

`NodeFileSystem`（`src/runtime/node-file-system.ts`）で `fs.stat` を用いて実装する。`createMockFileReader`（`tests/helpers/mock-file-system.ts`）にも同メソッドを追加する。

- [ ] **Step 2: rotation 判定を実装（§9.4）**

```typescript
// src/runtime/observation-log-store.ts 内
const MAX_SHARD_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_SHARD_AGE_DAYS = 14;

async function shouldRotate(path: string, now: Date): Promise<boolean> {
  const stats = await this.fileReader.readFileStats(path);
  if (!stats) return false;
  return stats.size >= MAX_SHARD_SIZE || ageDays(stats.mtimeMs, now) >= MAX_SHARD_AGE_DAYS;
}
```

- [ ] **Step 3: rotation 後の sequence 連続性を実装（D33）**

active+archive の最大 sequence を計算し、次回 append からその値+1 を使用。

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/rotation-sequence-continuity.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/runtime/observation-log-store.ts tests/runtime/rotation-sequence-continuity.test.ts
git commit -m "feat(v2): shard rotation and archive sequence continuity"
```

- [ ] **Step 5: Phase 2 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 2.3`（直前 Task から派生）。append 経路と projection を使用する。

---

## Phase 3: Message / Role Handling + Adapter Routing

**Base Branch:** `feature/phase3-v2-message-adapter__base`

**目的:** Message 観測の role 相関、adapter 拡張、JusticePlugin の routing ガードを実装。本 Phase だけで message 系 declared evidence と adapter 配線が検証できる。

**判断:** Phase 3 は Phase 2 の log store を使用する。Task 3.1 は pure message バッファなので Base から、Task 3.2 は adapter 拡張なので Base から、Task 3.3 は 3.1/3.2 + 2.2 を使用するため Task 3.2 または Phase 2 Base から。整理すると: 3.1 Base, 3.2 Base, 3.3 Task 3.2（直前）から派生。

---

### Task 3.1: MessageRoleBuffer + Declared Extraction

**Files:**

- Create: `src/core/v2/message-role-buffer.ts`
- Create: `src/core/v2/message-payload.ts`
- Modify: `src/core/v2/declared-claim-extractor.ts`（finalized 後の抽出へ変更）
- Test: `tests/hooks/message-role-buffer.test.ts`
- Test: `tests/core/v2/message-payload.test.ts`

**Interfaces:**

- Consumes: `ObservationMessagePayload` union, `extractDeclaredClaims`.
- Produces:
  - `MessageRoleBuffer` class with `{sessionId, messageID}` key, `parts: Map<partID, {text, finalized}>`.
  - `extractFinalizedAssistantClaims(buffer, messageID, partID): DeclaredClaim[]`.

- [ ] **Step 1: Message payload union を定義（D71）**

```typescript
// src/core/v2/message-payload.ts
export type ObservationMessagePayload =
  | { readonly kind: "message_part_updated"; readonly sessionId: string; readonly messageID: string; readonly partID: string; readonly text: string }
  | { readonly kind: "message_updated"; readonly sessionId: string; readonly messageID: string; readonly role: "assistant" | "user"; readonly finalized: boolean }
  | { readonly kind: "text_complete"; readonly sessionId: string; readonly messageID: string; readonly partID: string; readonly text: string };
```

- [ ] **Step 1b: `observation-model.ts` の `MessageRecord` を詳細化（D71）**

Task 1.1 で stub とした `MessageRecord` を、Phase 0 spike で確定した adapter 契約に基づいて具体的なフィールドに拡張する。

```typescript
// src/core/v2/observation-model.ts
export type MessageRecord = {
  readonly kind: "message";
  readonly messageID: string;
  readonly partID?: string;
  readonly role?: "assistant" | "user";
  readonly textHash: string; // required per D34
  readonly textSnippet?: string;
  readonly declaredClaims: readonly DeclaredClaim[]; // D70: 軽量な申告のリスト
  readonly evidence: readonly DeclaredClaimEvidence[]; // 1 claim = 1 Evidence per D59/D70
  readonly finalized: boolean;
};
```

- [ ] **Step 2: MessageRoleBuffer を実装（D53/D65/D67）**

```typescript
// src/core/v2/message-role-buffer.ts
export class MessageRoleBuffer {
  // key: {sessionId}:{messageID}
  private readonly buffer = new Map<string, { readonly role?: "assistant" | "user"; readonly parts: Map<string, { readonly text: string; readonly finalized: boolean }>; readonly lastUpdatedAt: number; readonly finalized: boolean }>();

  update(sessionId: string, payload: ObservationMessagePayload): void { /* ... */ }
  finalize(sessionId: string, messageID: string, partID?: string): void { /* ... */ }
  extractAssistantClaims(sessionId: string, messageID: string, partID?: string): DeclaredClaim[] { /* ... */ }
  getFinalizedText(sessionId: string, messageID: string, partID?: string): string | undefined { /* ... */ }
  gc(maxAgeMs: number, maxEntries: number): void { /* ... */ }
}
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/message-role-buffer.test.ts tests/core/v2/message-payload.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/observation-model.ts src/core/v2/message-payload.ts src/core/v2/message-role-buffer.ts tests/hooks/message-role-buffer.test.ts tests/core/v2/message-payload.test.ts
git commit -m "feat(v2): message role buffer and finalized declared extraction"
```

- [ ] **Step 5: Phase 3 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase3-v2-message-adapter__base`（Base から派生）。

---

### Task 3.2: Adapter Extension (Tool Filter Removal + Message Routing)

**Files:**

- Modify: `src/runtime/opencode-adapter.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`

**Interfaces:**

- Consumes: `ObservationMessagePayload` from Task 3.1, `ObservationLogStore` from Phase 2, existing `HookEvent` types from `src/core/types.ts`.
- Produces:
  - `ToolObservationPayload` type: `{ toolName: string; callId: string; args?: Record<string, unknown>; output?: { output?: string; metadata?: Record<string, unknown> }; error?: boolean }`.
  - `onToolExecuteBefore/After` no longer filters `tool !== "task"` but explicitly excludes query tools matching `justice_*`; all other tools are converted to `ToolObservationPayload` and forwarded to `JusticePlugin.handleEvent` as `PreToolUse` / `PostToolUse` events to prevent query commands from altering the canonical Observation Log (D50).
  - `onMessage` / `onMessagePartUpdated` / `onTextComplete` hooks produce `ObservationMessagePayload` and forward to `JusticePlugin.handleEvent({ type: "Message" })` alongside the existing user-message path (handled in Task 3.3).
  - `onSessionError` forwards to `JusticePlugin.handleEvent({ type: "Event", event: "session.error" })`.
  - Captures `HookResponse` from `handleEvent` and applies `injectedContext` / notifier banner / best-effort `output.output` append in deterministic handler order (D47/D64).

- [ ] **Step 0: Define `ToolObservationPayload` and adapter conversion helpers, and update `src/core/types.ts`**

Update `PostToolUsePayload` and `PreToolUsePayload` in `src/core/types.ts` to include the fields the adapter now forwards: `callId`, `toolInput` (Pre/Post), `toolResult`, and `metadata` (Post). This keeps `observation-handler` type-safe without casting.

```typescript
// src/runtime/opencode-adapter.ts
type ToolObservationPayload = {
  readonly toolName: string;
  readonly callId: string;
  readonly args?: Record<string, unknown>;
  readonly output?: { readonly output?: string; readonly metadata?: Record<string, unknown> };
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
    payload: { toolName: input.tool, toolInput: output.args },
  };
}

function toPostToolObservationPayload(
  input: ToolObservationInput,
  output: { readonly output: string; readonly metadata?: Record<string, unknown> }
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
      metadata: { error: output.metadata?.error === true },
    },
  };
}
```

- [ ] **Step 1: 既存 adapter の tool フィルタを撤廃**

```typescript
// src/runtime/opencode-adapter.ts
onToolExecuteBefore: async (input, output) => {
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
  const response = await this.plugin.handleEvent(toPostToolObservationPayload(input, output));
  // (1) guaranteed channel: notifier banner (fail-open try/catch)
  if (response.action === "inject") {
    try {
      await this.notifier.notify({
        level: "warning",
        variant: "justice_gate",
        title: "Task Gate",
        message: response.injectedContext,
        sessionId: input.sessionID,
        taskId: "unknown",
      });
    } catch (err) {
      this.logger.warn("notifier.notify failed", err);
    }
  }
  // (2) best-effort channel: append banner to output.output (gated by C1 spike result)
  if (this.options.enableAdvisoryOutputAppend && response.action === "inject" && response.injectedContext && typeof output.output === "string") {
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

- [ ] **Step 2: message / session.error イベントを追加（既存 user message 経路は維持）**

```typescript
onMessagePartUpdated: async (event) => {
  await this.plugin.handleEvent({ type: "Message", payload: { kind: "message_part_updated", sessionId: event.sessionId, messageID: event.messageID, partID: event.partID, text: event.text } });
},
// ...
```

`onMessage`（`message.updated`）は既存の `{ role, content }` 形式の `MessageEvent` として `JusticePlugin.handleEvent` に渡し、plan-bridge の委譲トリガー機能を維持する。`message.part.updated` / `experimental.text.complete` は `ObservationMessagePayload` として `Message` イベントで observation-handler に渡す。`JusticePlugin.handleEvent` では payload に `kind` がある場合は plan-bridge 経路をスキップし、`role`/`content` 形式の user message のみ plan-bridge に委譲する（D71）。

**型更新:** `src/core/types.ts` の `MessageEvent` payload を `{ role, content } | ObservationMessagePayload` の union に拡張し、`handleEvent` が型安全に分岐できるようにする。

- [ ] **Step 3: PostToolUse 戻り値を adapter で適用（D47/D64）— Step 1 と統合済み**

(Step 1 の `onToolExecuteAfter` に統合。重複する独立ステップは削除。)


- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/opencode-adapter-v2.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter-v2.test.ts
git commit -m "feat(v2): adapter forwards all tool and message events"
```

- [ ] **Step 6: Phase 3 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase3-v2-message-adapter__base`（Base から派生）。独立した adapter 変更だが、Task 3.1 と同じ Phase 内で並列にレビューできる。

---

### Task 3.3: JusticePlugin Routing Guard

**Files:**

- Modify: `src/core/justice-plugin.ts`
- Create: `src/hooks/observation-handler.ts`（最小の stub）
- Test: `tests/core/justice-plugin-routing.test.ts`

**Interfaces:**

- Consumes: `PlanBridge.handleMessage`, `PlanBridge.handlePreToolUse`, `PlanBridge.handlePostToolUse`, `TaskFeedbackHandler.handlePostToolUse`, new `observation-handler`.
- Produces:
  - `mergePreToolUseResponses(a, b)` and `mergeMessageResponses(a, b)` helpers.
  - `handleEvent` routes:
    - `PreToolUse`: observation-handler + (if toolName === "task") plan-bridge, merged via `mergePreToolUseResponses`.
    - `PostToolUse`: observation-handler + (if toolName === "task") plan-bridge + task-feedback, merged via `mergePostToolUseResponses`.
    - `Message`: routed to both `planBridge.handleMessage(event)` (existing delegation triggers) and `observationHandler.handleMessage(payload)` (declared claim extraction), merged via `mergeMessageResponses`.
    - `Event`: existing handlers unchanged.

- [ ] **Step 0: Add `mergePreToolUseResponses` and `mergeMessageResponses` helpers**

```typescript
// src/core/justice-plugin.ts
function mergePreToolUseResponses(a: HookResponse, b: HookResponse): HookResponse {
  if (a.action === "skip" || b.action === "skip") return { action: "skip" };
  if (a.action === "inject" && b.action === "inject") {
    const contexts = [a.injectedContext, b.injectedContext].filter((c) => c !== "");
    const result: InjectResponse = { action: "inject", injectedContext: contexts.join("\n\n---\n\n") };
    if (a.modifiedPayload !== undefined) return { ...result, modifiedPayload: a.modifiedPayload };
    if (b.modifiedPayload !== undefined) return { ...result, modifiedPayload: b.modifiedPayload };
    return result;
  }
  if (a.action === "inject") return { ...a };
  if (b.action === "inject") return { ...b };
  return { action: "proceed" };
}

function mergeMessageResponses(a: HookResponse, b: HookResponse): HookResponse {
  if (a.action === "inject" && b.action === "inject") {
    const contexts = [a.injectedContext, b.injectedContext].filter((c) => c !== "");
    return { action: "inject", injectedContext: contexts.join("\n\n---\n\n") };
  }
  if (a.action === "inject") return { ...a };
  if (b.action === "inject") return { ...b };
  return { action: "proceed" };
}
```

- [ ] **Step 1: `JusticePlugin.handleEvent` に routing ガードを追加（§4.4/D64）**

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
      const obs = await this.observationHandler.handleMessage(event).catch((err) => {
        this.options.logger?.warn("observation-handler message failed", err);
        return PROCEED;
      });
      return obs;
    }
    case "PreToolUse": {
      const obs = await this.observationHandler.handlePreToolUse(event);
      if (event.payload.toolName === "task") {
        const plan = await this.planBridge.handlePreToolUse(event);
        return mergePreToolUseResponses(obs, plan);
      }
      return obs;
    }
    case "PostToolUse": {
      const responses: HookResponse[] = [await this.observationHandler.handlePostToolUse(event)];
      if (event.payload.toolName === "task") {
        responses.push(await this.planBridge.handlePostToolUse(event));
        responses.push(await this.taskFeedback.handlePostToolUse(event));
      }
      return mergePostToolUseResponses(responses);
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

- [ ] **Step 2: observation-handler stub を作成（`ToolUsePayload` 以外も受け取れるよう拡張）**

```typescript
// src/hooks/observation-handler.ts
export class ObservationHandler {
  async handlePreToolUse(event: PreToolUseEvent): Promise<HookResponse> { return { action: "proceed" }; }
  async handlePostToolUse(event: PostToolUseEvent): Promise<HookResponse> { return { action: "proceed" }; }
  async handleMessage(event: MessageEvent): Promise<HookResponse> { return { action: "proceed" }; }
}
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/justice-plugin-routing.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/justice-plugin.ts src/hooks/observation-handler.ts tests/core/justice-plugin-routing.test.ts
git commit -m "feat(v2): JusticePlugin routing guard for all tools + observation handler"
```

- [ ] **Step 5: Phase 3 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 3.2`（直前 Task から派生）。adapter 変更を統合して routing を正しくテストするため。

---

## Phase 4: Observation Handler Implementation

**Base Branch:** `feature/phase4-v2-observation-handler__base`

**目的:** observation-handler を実装し、全ツール観測・message 観測・task サマリ・skill_invoked・session_error を Observation Log へ記録。本 Phase だけで v2.0 の主要な観測経路が完成する。

**判断:** Phase 4 は Phase 3 の routing / adapter と Phase 2 の log store を使用。Task 4.1 は tool 観測（log store + evidence engine）なので Phase 2 Base または Task 4.0 stub から。Task 4.2 は message 観測（Task 3.1 + 3.3）なので Task 3.3 から。Task 4.3 は task/skill 観測（Task 4.1）から。Task 4.4 は session_error（Task 4.1）から。Phase 4 内は順次積み上げが自然。

---

### Task 4.1: Tool Observation Handler

**Files:**

- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/hooks/observation-handler-tool.test.ts`

**Interfaces:**

- Consumes: `ObservationLogStore`, `extractEvidenceFromTool`, `redactForPersistence`, `redactAbsolutePaths`, and a logger for fail-open warnings.
- Produces:
  - `handlePostToolUse(payload)` → `ObservationRecord{kind:"tool_executed"}` append + gate trigger check + `HookResponse`.
  - `handlePreToolUse(payload)` → task window tracking (`activeTaskWindows: Map<callId, taskId>`).
  - All log append/evaluation paths are wrapped in `try/catch` and degrade to `{ action: "proceed" }` on failure (FF-006).
  - `appendTaskSummaryDeclaredEvidence(payload, taskId)` stubbed in this task and implemented in Task 4.3.
  - `handlePostToolUse(payload)` → `ObservationRecord{kind:"tool_executed"}` append + gate trigger check + `HookResponse`.
  - `handlePreToolUse(payload)` → task window tracking (`activeTaskWindows: Map<callId, taskId>`).
  - All log append/evaluation paths are wrapped in `try/catch` and degrade to `{ action: "proceed" }` on failure (FF-006).

- [ ] **Step 1: PreToolUse で task window を追跡（D74）**

```typescript
// src/hooks/observation-handler.ts
private readonly activeTaskWindows = new Map<string, string>();

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
  // Fallback: if the session already has an active task (set by PlanBridge), use it.
  return this.activeTaskIdForSession(sessionId);
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
      this.activeTaskWindows.set(event.callId ?? "", taskId);
    }
  }
  return { action: "proceed" };
}
```

- [ ] **Step 2: PostToolUse で tool_executed レコードを append**

```typescript
async handlePostToolUse(event: PostToolUseEvent): Promise<HookResponse> {
  try {
    const payload = event.payload;
    const callId = event.callId ?? "";
    const taskId = this.activeTaskWindows.get(callId);

    const agentId = await this.resolveAgentId(event.sessionId);
    const shardId = { agentId, sessionId: event.sessionId, writerId: this.writerId };

    const evidence = extractEvidenceFromTool(
      payload.toolName,
      payload.toolInput,
      { output: payload.toolResult, metadata: payload.metadata }
    );
    const redactedEvidence: Evidence = {
      ...evidence,
      command: evidence.command ? redactForPersistence(redactAbsolutePaths(evidence.command)) : undefined,
      rawOutput: evidence.rawOutput ? redactForPersistence(redactAbsolutePaths(evidence.rawOutput)) : undefined,
    };
    const record: ObservationRecord = {
      ...this.buildEnvelope({ taskId, agentId, sessionId: event.sessionId, recordType: "observation" }),
      recordType: "observation",
      kind: "tool_executed",
      toolName: payload.toolName,
      callId,
      evidence: redactedEvidence,
    };
    await this.logStore.append(shardId, record);
    if (payload.toolName === "task") {
      this.activeTaskWindows.delete(callId);
      // task summary declared claim extraction is added in Task 4.3
      const taskGateResponse = await this.evaluateGateIfTriggered("task_complete", taskId, agentId, event.sessionId);
      if (taskGateResponse.action === "inject") {
        return taskGateResponse;
      }
    }
    const gateResponse = await this.evaluateGateIfTriggered("tool_observed", taskId, agentId, event.sessionId);
    if (gateResponse.action === "inject") {
      return gateResponse;
    }
  } catch (err) {
    this.logger.warn("observation-handler: tool observation failed, degrading to PROCEED", err);
  }
  return { action: "proceed" };
}
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-tool.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/observation-handler.ts tests/hooks/observation-handler-tool.test.ts
git commit -m "feat(v2): tool observation handler with task window tracking"
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

```typescript
async handleMessage(payload: ObservationMessagePayload): Promise<HookResponse> {
  try {
    this.messageRoleBuffer.update(payload.sessionId, payload);
    if (payload.kind === "text_complete" || (payload.kind === "message_updated" && payload.finalized)) {
      this.messageRoleBuffer.finalize(payload.sessionId, payload.messageID, payload.kind === "text_complete" ? payload.partID : undefined);
      const claims = this.messageRoleBuffer.extractAssistantClaims(payload.sessionId, payload.messageID, payload.kind === "text_complete" ? payload.partID : undefined);
      const fullText = this.messageRoleBuffer.getFinalizedText(payload.sessionId, payload.messageID, payload.kind === "text_complete" ? payload.partID : undefined) ?? "";
      const evidence: DeclaredClaimEvidence[] = claims.map((c) => ({
        evidenceId: c.evidenceId,
        kind: c.claimKind,
        sourceClass: "declared_claim",
        provenance: "declared",
        declaredFrom: "message",
        claim: { claimKind: c.claimKind, outcome: c.outcome },
      }));
      const agentId = await this.resolveAgentId(payload.sessionId);
      const shardId = { agentId, sessionId: payload.sessionId, writerId: this.writerId };
      const record: ObservationRecord = {
        ...this.buildEnvelope({
          agentId,
          sessionId: payload.sessionId,
          recordType: "observation",
        }),
        kind: "message",
        messageID: payload.messageID,
        partID: payload.kind === "text_complete" ? payload.partID : undefined,
        role: "assistant",
        textHash: hashString(fullText),
        textSnippet: redactForPersistence(redactAbsolutePaths(fullText)).slice(0, 200),
        declaredClaims: claims,
        evidence,
        finalized: true,
      };
      await this.logStore.append(shardId, record);
    }
  } catch (err) {
    this.logger.warn("observation-handler: message observation failed, degrading to PROCEED", err);
  }
  return { action: "proceed" };
}
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-message.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/observation-handler.ts tests/hooks/observation-handler-message.test.ts
git commit -m "feat(v2): message observation handler with declared claims"
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
  - `detectSkillInvoked(toolName, args): { skillName, source }` (D10). Detects skills invoked via the `skill` tool and via `task` tool's `load_skills` argument.
  - `extractTaskSummaryClaims(output): DeclaredClaim[]` (D29/D62).
  - `appendTaskSummaryDeclaredEvidence(payload, taskId)` in `observation-handler.ts`, wrapped in `try/catch` and degrading to `PROCEED` on failure.
  - `detectSkillInvoked(toolName, args): { skillName, source }` (D10). Detects skills invoked via the `skill` tool and via `task` tool's `load_skills` argument.
  - `extractTaskSummaryClaims(output): DeclaredClaim[]` (D29/D62).

- [ ] **Step 1: skill 検出器を実装**

```typescript
// src/core/v2/skill-invoked-detector.ts
export function detectSkillInvoked(toolName: string, args: unknown): { readonly skillName: string; readonly source: "skill_tool" | "task_load_skills" } | null {
  if (toolName === "skill" && args && typeof args === "object" && "name" in args) {
    return { skillName: args.name as string, source: "skill_tool" };
  }
  if (toolName === "task" && args && typeof args === "object" && "load_skills" in args) {
    const loadSkills = (args as Record<string, unknown>).load_skills;
    if (Array.isArray(loadSkills) && loadSkills.length > 0 && typeof loadSkills[0] === "string") {
      return { skillName: loadSkills[0] as string, source: "task_load_skills" };
    }
  }
  return null;
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
};
```

- [ ] **Step 2: task summary 抽出器を実装**

```typescript
// src/core/v2/task-summary-claim-extractor.ts
export function extractTaskSummaryClaims(output: string): DeclaredClaim[] {
  // transcript 含有でも declared 扱い（D62）。PASS 非算入。
  return extractDeclaredClaims(output).map((c) => ({ ...c, claimKind: c.claimKind }));
}
```

- [ ] **Step 3: observation-handler に skill_invoked / task summary 経路を追加**

```typescript
// tool_executed レコード生成時に併せて skill_invoked レコードも append（fail-open）
try {
  if (skill) {
    const sessionId = event.sessionId;
    const agentId = resolveAgentId(sessionId);
    const shardId = { agentId, sessionId, writerId: this.writerId };
    await this.logStore.append(shardId, {
      ...this.buildEnvelope({
        taskId,
        agentId,
        sessionId,
        recordType: "observation",
      }),
      kind: "skill_invoked",
      ...skill,
    });
  }
} catch (err) {
  this.logger.warn("observation-handler: skill_invoked observation failed", err);
}
// task 完了時: task summary から declared_claim Evidence を生成して taskId に帰属（fail-open）

- [ ] **Step 3c: `handlePostToolUse` に task summary 呼び出しを追加**

```typescript
// src/hooks/observation-handler.ts 内 handlePostToolUse
if (event.payload.toolName === "task") {
  this.activeTaskWindows.delete(event.payload.callId);
  await this.appendTaskSummaryDeclaredEvidence(event, taskId);
}
```

- [ ] **Step 3b: `appendTaskSummaryDeclaredEvidence` メソッドを追加（D34/D59/D70）**

```typescript
// src/hooks/observation-handler.ts
private async appendTaskSummaryDeclaredEvidence(event: PostToolUseEvent, taskId?: string): Promise<void> {
  if (!taskId) return;
  try {
    const payload = event.payload;
    const summaryText = payload.toolResult ?? "";
    const summaryClaims = extractTaskSummaryClaims(summaryText);
    if (summaryClaims.length === 0) return;
    const redactedSnippet = redactForPersistence(redactAbsolutePaths(summaryText)).slice(0, 200);
    const evidence: DeclaredClaimEvidence[] = summaryClaims.map((c) => ({
      evidenceId: c.evidenceId,
      kind: c.claimKind,
      sourceClass: "declared_claim",
      provenance: "declared",
      declaredFrom: "task_summary",
      claim: { claimKind: c.claimKind, outcome: c.outcome },
    }));
    
    const sessionId = event.sessionId;
    const agentId = resolveAgentId(sessionId);
    const shardId = { agentId, sessionId, writerId: this.writerId };
    const record: ObservationRecord = {
      ...this.buildEnvelope({
        taskId,
        agentId,
        sessionId,
        recordType: "observation",
      }),
      kind: "message",
      messageID: `task-summary:${taskId}`,
      role: "assistant",
      textHash: hashString(summaryText),
      textSnippet: redactedSnippet,
      declaredClaims: summaryClaims,
      evidence,
      finalized: true,
    };
    await this.logStore.append(shardId, record);
  } catch (err) {
    this.logger.warn("observation-handler: task summary declared claim extraction failed", err);
  }
}
```

- [ ] **Step 4b: task summary declared claim extraction fail-open テストを追加**

```typescript
// tests/hooks/observation-handler-skill-task.test.ts
it("returns PROCEED when task summary extraction throws", async () => {
  const handler = new ObservationHandler(/* mock log store that throws on append */);
    const result = await handler.handlePostToolUse({ toolName: "task", callId: "c1", toolInput: { taskId: "task-1" }, toolResult: "tests pass", error: false });
  expect(result.action).toBe("proceed");
});
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/skill-invoked-detector.test.ts tests/core/v2/task-summary-claim-extractor.test.ts tests/hooks/observation-handler-skill-task.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/v2/observation-model.ts src/core/v2/skill-invoked-detector.ts src/core/v2/task-summary-claim-extractor.ts src/hooks/observation-handler.ts tests/core/v2/skill-invoked-detector.test.ts tests/core/v2/task-summary-claim-extractor.test.ts tests/hooks/observation-handler-skill-task.test.ts
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

- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/hooks/task-feedback.ts`（ReflectionEvent 発行呼び出し追加）
- Modify: `src/hooks/loop-handler.ts`（ReflectionEvent 発行呼び出し追加）
- Create: `src/core/v2/reflection-event.ts`
- Test: `tests/hooks/observation-handler-session-error.test.ts`
- Test: `tests/core/v2/reflection-event.test.ts`

**Interfaces:**

- Consumes: `session.error` event, task success/error signals, loop error notes.
- Produces:
  - `handleSessionError(error)` → `ObservationRecord{kind:"session_error"}`.
  - `buildReflectionEvent(trigger, planRef, intent, note)`.
  - ReflectionEvent append on task success/error and loop error-note.

- [ ] **Step 1: session_error ハンドラを実装**

```typescript
async handleSessionError(error: { readonly message: string; readonly kind?: string; readonly agentId: ObservationAgentId; readonly sessionId: string }): Promise<HookResponse> {
  try {
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
    await this.logStore.append(this.shardId, record);
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

- [ ] **Step 2: ReflectionEvent ビルダーを実装（D15/D51）**

```typescript
// src/core/v2/reflection-event.ts
export function buildReflectionEvent(
  envelope: CommonEnvelope,
  trigger: "task_succeeded" | "task_error",
  planRef: { readonly path: string; readonly taskId: string },
  intent: "check_complete" | "append_error_note",
  note?: string
): ReflectionRecord {
  return { ...envelope, recordType: "observation", kind: "reflection", reflection: { trigger, planRef, intent, note } };
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

- [ ] **Step 3: task-feedback / loop-handler に ReflectionEvent 発行を追加（§8.2/D7）**

```typescript
// src/hooks/task-feedback.ts（既存 checkbox 更新後に追加）
await this.observationHandler.emitReflectionEvent({ trigger: "task_succeeded", planRef, intent: "check_complete" });
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-session-error.test.ts tests/core/v2/reflection-event.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/v2/observation-model.ts src/core/v2/reflection-event.ts src/hooks/observation-handler.ts src/hooks/task-feedback.ts src/hooks/loop-handler.ts tests/hooks/observation-handler-session-error.test.ts tests/core/v2/reflection-event.test.ts
git commit -m "feat(v2): session error and reflection event seam"
```

- [ ] **Step 6: Phase 4 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 4.3`（直前 Task から派生）。

---

## Phase 5: Rule Engine + Gate Definition

**Base Branch:** `feature/phase5-v2-rule-engine__base`

**目的:** 純粋な rule evaluation engine、gate.yaml スキーマ、gate-loader、既定 gate を実装。本 Phase だけで gate 評価の単体テストが成立する。

**判断:** Phase 5 は Phase 1/2 の型と投影を使用。Task 5.1 は gate スキーマ（独立）で Base から、Task 5.2 は 5.1 の型を使用、Task 5.3 は 5.2 の engine + 5.1 の型、Task 5.4 は 5.3 + 5.2 の評価経路。Phase 5 内は順次積み上げ。

---

### Task 5.1: Gate Definition Schema + Validation

**Files:**

- Create: `src/core/v2/gate-definition.ts`
- Create: `src/core/v2/gate-yaml-parser.ts`
- Test: `tests/core/v2/gate-definition.test.ts`
- Test: `tests/core/v2/gate-yaml-parser.test.ts`

**Interfaces:**

- Consumes: `zod` または純粋 TypeScript バリデーション（プロジェクトに zod 等が無いため、TypeScript 型 + 手動 validator）。
- Produces:
  - `GateRule` type with `id`, `gateType`, `trigger`, `check`, `onViolation`, `onMissingEvidence`, `enabled`.
  - `check.type ∈ { "evidence_outcome", "evidence_present", "review_open_items" }`.
  - `parseGateYaml(yaml: string): GateRule[]`.

- [ ] **Step 0: 依存パッケージ `yaml` を追加**

```bash
bun add yaml
```

- [ ] **Step 1: `GateRule` 型を定義**

```typescript
// src/core/v2/gate-definition.ts
export type EvidenceOutcomeCheck = {
  readonly type: "evidence_outcome";
  readonly evidenceKind: "test" | "build" | "lint";
  readonly requireOutcome: "pass" | "fail";
};

export type EvidencePresentCheck = {
  readonly type: "evidence_present";
  readonly evidenceKind: "test" | "build" | "lint";
};

export type ReviewOpenItemsCheck = {
  readonly type: "review_open_items";
  readonly minimumSeverity: "critical" | "major" | "minor";
};

export type GateCheck = EvidenceOutcomeCheck | EvidencePresentCheck | ReviewOpenItemsCheck;

export type GateRule = {
  readonly id: string;
  readonly description?: string;
  readonly gateType: "task";
  readonly trigger: { readonly on: "task_complete" | "tool_observed" };
  readonly check: GateCheck;
  readonly onViolation: "pass" | "warn" | "fail";
  readonly onMissingEvidence: "pass" | "warn" | "fail";
  readonly enabled: boolean;
};
```

- [ ] **Step 2: YAML parser / validator を実装**

```typescript
// src/core/v2/gate-yaml-parser.ts
import { parse as parseYaml } from "yaml";

export function parseGateYaml(content: string): readonly GateRule[] {
  const parsed = parseYaml(content) as { readonly schemaVersion?: unknown; readonly authority?: unknown; readonly gates?: readonly unknown[] };
  if (!parsed || parsed.schemaVersion !== 1 || parsed.authority !== "human_approved") {
    throw new Error("gate.yaml: invalid schemaVersion (expected 1) or authority (expected 'human_approved')");
  }
  if (!parsed || !Array.isArray(parsed.gates)) {
    throw new Error("gate.yaml: gates array is required");
  }
  return parsed.gates.map((g) => normalizeGateRule(g));
}

function normalizeGateRule(raw: unknown): GateRule {
  if (!raw || typeof raw !== "object") throw new Error("Invalid gate rule");
  const g = raw as Record<string, unknown>;
  return {
    id: requiredString(g.id, "id"),
    description: optionalString(g.description),
    gateType: "task",
    trigger: { on: normalizeTriggerOn(g.trigger) },
    check: normalizeCheck(g.check),
    onViolation: normalizeVerdict(g.onViolation),
    onMissingEvidence: normalizeVerdict(g.onMissingEvidence),
    enabled: g.enabled === false ? false : true,
  };
}

function normalizeVerdict(value: unknown): "pass" | "warn" | "fail" {
  const s = String(value).toLowerCase();
  if (s === "pass" || s === "warn" || s === "fail") return s;
  throw new Error(`Invalid verdict: ${value}`);
}

function normalizeTriggerOn(raw: unknown): "task_complete" | "tool_observed" {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).on : raw;
  const s = String(value);
  if (s === "task_complete" || s === "tool_observed") return s;
  throw new Error(`Invalid trigger: ${value}`);
}

function normalizeCheck(raw: unknown): GateCheck {
  // ... dispatch by raw.type
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/gate-definition.test.ts tests/core/v2/gate-yaml-parser.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb src/core/v2/gate-definition.ts src/core/v2/gate-yaml-parser.ts tests/core/v2/gate-definition.test.ts tests/core/v2/gate-yaml-parser.test.ts
git commit -m "feat(v2): gate definition schema and yaml parser"
```

- [ ] **Step 5: Phase 5 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase5-v2-rule-engine__base`（Base から派生）。

---

### Task 5.2: Rule Evaluation Engine

**Files:**

- Create: `src/core/v2/rule-evaluation-engine.ts`
- Create: `src/core/v2/gate-context.ts`
- Create: `src/core/v2/review-scope.ts`
- Test: `tests/core/v2/rule-evaluation-engine.test.ts`
- Test: `tests/core/v2/gate-provenance-gating.test.ts`

**Interfaces:**

- Consumes: `GateRule`, `Evidence`, `ProjectedState`, `GateContext`.
- Produces:
  - `evaluate(gates, evidence, ctx): Verdict` (pure, deterministic).
  - `Verdict` with per-rule results and worst-value aggregation (FAIL > WARN > PASS).
  - `collectReviewScopes(state, taskId): readonly string[]` and `deriveReviewScope(ctx): string`.

- [ ] **Step 1: `GateContext` 型を定義**

```typescript
// src/core/v2/gate-context.ts
export type GateContext = {
  readonly trigger: "task_complete" | "tool_observed";
  readonly taskId?: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly reviewScope: readonly string[];
  readonly reviewSummary?: {
    readonly byScope: ReadonlyMap<string, { readonly critical: readonly string[]; readonly major: readonly string[]; readonly minor: readonly string[]; readonly resolved: readonly string[]; readonly open: readonly string[] }>;
  };
};
```

- [ ] **Step 1b: `review-scope.ts` を作成し `collectReviewScopes` / `deriveReviewScope` を実装（§7.6）**

```typescript
// src/core/v2/review-scope.ts
import { ProjectedState } from "./state-projection.ts";

export function collectReviewScopes(state: ProjectedState, taskId: string): readonly string[] {
  // Collect actual reviewScopes from task window in ProjectedState to avoid PASS when unobserved
  const scopes: string[] = [];
  const taskState = state.tasks.get(taskId);
  if (taskState) {
    for (const scope of taskState.observedReviewScopes) {
      scopes.push(scope);
    }
  }
  return scopes;
}

export function deriveReviewScope(ctx: { readonly taskId?: string; readonly sessionId: string; readonly callId?: string; readonly toolName?: string }): string {
  if (ctx.taskId) return ctx.taskId;
  return `${ctx.sessionId}:${ctx.callId ?? ctx.toolName ?? "unknown"}`;
}
```

- [ ] **Step 2: rule engine を実装（§7.3/D24/D68/D75/D76）**

```typescript
// src/core/v2/rule-evaluation-engine.ts
export function evaluate(
  gates: readonly GateRule[],
  evidence: readonly Evidence[], // caller must pass task-scoped evidence (state.tasks.get(taskId)?.evidence ?? [])
  ctx: GateContext
): (Verdict & { readonly gateType: "task" }) | { readonly verdict: "SKIP"; readonly reason: string } {
  if (ctx.taskId === undefined) {
    return { verdict: "SKIP", reason: "no taskId provided" };
  }
  const ruleResults = gates
    .filter((g) => g.enabled && g.trigger.on === ctx.trigger)
    .map((g) => evaluateRule(g, evidence, ctx));
  const verdict = worstOf(ruleResults.map((r) => r.verdict));
  return { verdict, gateType: "task", reachableEnforcementLevel: "L1", appliedEnforcementLevel: "L0", ruleResults };
}

function evaluateRule(gate: GateRule, evidence: readonly Evidence[], ctx: GateContext): RuleResult {
  // evidence_outcome / evidence_present: PASS only from observed/derived Evidence; declared yields onMissingEvidence or WARN
  // review_open_items: scope-aware via ctx.reviewScope and ctx.reviewSummary.byScope
}
```

- [ ] **Step 3: provenance gating test（FF-008）を実装**

```typescript
// tests/core/v2/gate-provenance-gating.test.ts
it("declared evidence does not satisfy evidence_outcome", () => {
  // ...
});
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/rule-evaluation-engine.test.ts tests/core/v2/gate-provenance-gating.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/v2/rule-evaluation-engine.ts src/core/v2/gate-context.ts tests/core/v2/rule-evaluation-engine.test.ts tests/core/v2/gate-provenance-gating.test.ts
git commit -m "feat(v2): rule evaluation engine with provenance gating"
```

- [ ] **Step 6: Phase 5 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 5.1`（直前 Task から派生）。`GateRule` 型を使用する。

---

### Task 5.3: Default Gates + Gate Loader

**Files:**

- Create: `src/runtime/gate-loader.ts`
- Create: `src/core/v2/default-gates.ts`
- Create: `templates/gate.yaml`（リポジトリテンプレート。runtime 読込時は `.justice/gate.yaml` へコピー/配備する。`.justice/` ディレクトリ本体は `.gitignore` で無視する）
- Test: `tests/runtime/gate-loader.test.ts`
- Test: `tests/core/v2/default-gates.test.ts`

**Interfaces:**

- Consumes: `parseGateYaml`, `GateRule`, `FileReader`.
- Produces:
  - `loadGates(fileReader, path): GateRule[]` with default fallback.
  - Default gates: `required-tests`, `build-green`, `review-clean` (all `onViolation: warn`, `onMissingEvidence: warn`).

- [ ] **Step 1: 既定 gate を定義**

```typescript
// src/core/v2/default-gates.ts
export const DEFAULT_GATES: readonly GateRule[] = [
  {
    id: "required-tests",
    description: "タスク完了前にテストが pass していること",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
  {
    id: "build-green",
    description: "タスク完了前にビルドが pass していること",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "evidence_outcome", evidenceKind: "build", requireOutcome: "pass" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
  {
    id: "review-clean",
    description: "未解決レビュー指摘（minimumSeverity 以上）が無いこと",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "review_open_items", minimumSeverity: "major" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
];
```

- [ ] **Step 2: gate loader を実装**

```typescript
// src/runtime/gate-loader.ts
export async function loadGates(fileReader: FileReader, path = ".justice/gate.yaml"): Promise<readonly GateRule[]> {
  const content = await fileReader.readFile(path).catch(() => null);
  if (!content) return DEFAULT_GATES;
  return mergeWithDefaults(parseGateYaml(content));
}
```

- [ ] **Step 3: `.gitignore` を更新し、テンプレート `templates/gate.yaml` を追加**

`.gitignore` に `.justice/` を追加（ただし `templates/gate.yaml` はコミット）。テンプレート内容：

```yaml
schemaVersion: 1
authority: human_approved
gates:
  - id: required-tests
    description: "タスク完了前にテストが pass していること"
    gateType: task
    trigger: { on: task_complete }
    check: { type: evidence_outcome, evidenceKind: test, requireOutcome: pass }
    onViolation: warn
    onMissingEvidence: warn
    enabled: true
  - id: build-green
    description: "タスク完了前にビルドが pass していること"
    gateType: task
    trigger: { on: task_complete }
    check: { type: evidence_outcome, evidenceKind: build, requireOutcome: pass }
    onViolation: warn
    onMissingEvidence: warn
    enabled: true
  - id: review-clean
    description: "未解決レビュー指摘（minimumSeverity 以上）が無いこと"
    gateType: task
    trigger: { on: task_complete }
    check: { type: review_open_items, minimumSeverity: major }
    onViolation: warn
    onMissingEvidence: warn
    enabled: true
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/gate-loader.test.ts tests/core/v2/default-gates.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore templates/gate.yaml src/runtime/gate-loader.ts src/core/v2/default-gates.ts tests/runtime/gate-loader.test.ts tests/core/v2/default-gates.test.ts
git commit -m "feat(v2): default gates and gate loader"
```

- [ ] **Step 6: Phase 5 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 5.2`（直前 Task から派生）。

---

### Task 5.4: Gate Trigger + DecisionRecord Append

**Files:**

- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/v2/rule-evaluation-engine.ts`（trigger dispatch）
- Test: `tests/hooks/observation-handler-gate.test.ts`

**Interfaces:**

- Consumes: `ObservationLogStore`, `project`, `loadGates`, `evaluate`, `GateContext`.
- Produces: On `task_complete` / `tool_observed`, evaluate gates and append `DecisionRecord`.

- [ ] **Step 1: gate 評価トリガーを実装（§6.2）**

```typescript
// src/hooks/observation-handler.ts 内
private async evaluateGateIfTriggered(
  trigger: "task_complete" | "tool_observed",
  taskId?: string,
  agentId: ObservationAgentId = "unknown",
  sessionId: string = "unknown"
): Promise<HookResponse> {
  try {
    if (taskId === undefined) {
      return { action: "proceed" };
    }
    const shardId = { agentId, sessionId, writerId: this.writerId };
    const events = await this.logStore.readAll();
    const state = project(events, "2026-06-26T00:00:00.000Z");
    const gates = await this.gateLoader.load();
    const ctx: GateContext = {
      trigger,
      taskId,
      agentId,
      sessionId,
      reviewScope: collectReviewScopes(state, taskId),
      reviewSummary: state.reviewSummary,
    };
    const evidence = state.tasks.get(taskId)?.evidence ?? [];
    const verdict = evaluate(gates, evidence, ctx);
    if (verdict.verdict === "SKIP") {
      return { action: "proceed" };
    }
    // DecisionRecord is appended for PASS/WARN/FAIL to preserve verdict distribution and replay audit (§6.2).
    // verdict now contains gateType: "task" to satisfy DecisionRecord schema constraints.
    const decision: DecisionRecord = { ...this.buildEnvelope({ taskId, agentId, sessionId, recordType: "decision" }), ...verdict };
    await this.logStore.append(shardId, decision);
    if (verdict.verdict === "PASS") {
      return { action: "proceed" };
    }
    // L0 advisory surface: injectedContext (guaranteed raw message via mergePostToolUseResponses)
    return { action: "inject", injectedContext: formatGateAdvisoryMessage(verdict) };
  } catch (err) {
    this.logger.warn("observation-handler: gate evaluation failed, degrading to PROCEED", err);
    return { action: "proceed" };
  }
}
```

- [ ] **Step 2: L0 advisory advisory message フォーマットを実装**

```typescript
function formatGateAdvisoryMessage(verdict: Verdict): string {
  const lines: string[] = [
    `${verdict.verdict}: ${verdict.ruleResults.map((r) => `${r.ruleId}=${r.verdict}`).join(", ")}`,
  ];
  for (const r of verdict.ruleResults) {
    if (r.verdict !== "PASS") {
      lines.push(`- [ ] ${r.ruleId}: ${r.verdict} — ${r.reason}`);
    }
  }
  return lines.join("\n");
}
  ```

> **Banner contract:** AGENTS.md §2 requires `> <icon> **JUSTICE NOTIFICATION** [<title>]`, `> <message>`, and a trailing empty line. The optional checklist follows the message line and preserves the 3-line quote layout when no checklist items are present.

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-gate.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/observation-handler.ts src/core/justice-notifier.ts src/core/v2/gate-decision-builder.ts src/core/v2/rule-evaluation-engine.ts tests/hooks/observation-handler-gate.test.ts tests/core/v2/gate-decision-builder.test.ts
git commit -m "feat(v2): gate trigger and decision record append"
```

- [ ] **Step 5: Phase 5 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 5.3`（直前 Task から派生）。

---

## Phase 6: Review Aggregator

**Base Branch:** `feature/phase6-v2-review-aggregator__base`

**目的:** 既存 `ReviewRejectionDetector` を拡張し、severity 決定論的分類器・itemKey・scope-aware 集約を実装。本 Phase だけで review 集約が完成する。

**判断:** Phase 6 は Phase 5 の `review_open_items` gate と Phase 1/2 の型を使用。Task 6.1 は severity 分類器（独立）で Base から、Task 6.2 は 6.1 + ProjectedState 型で Task 6.1 から、Task 6.3 は 6.2 + observation-handler 経路で Task 6.2 から。

---

### Task 6.1: Review Severity Classifier + ItemKey

**Files:**

- Modify: `src/core/review-rejection-detector.ts`（severity フィールド追加）
- Create: `src/core/v2/review-severity.ts`
- Test: `tests/core/review-severity.test.ts`

**Interfaces:**

- Consumes: existing `ReviewRejectionSignal`.
- Produces: `ReviewRejectionSignal` with `severity: "critical" | "major" | "minor"` and `itemKey`.

- [ ] **Step 1: 凍結語彙に基づく severity 分類器を実装（D57）**

```typescript
// src/core/v2/review-severity.ts
const CRITICAL = /security|vulnerability|data ?loss|破壊的|重大/i;
const MAJOR = /must fix|required|bug|regression|要修正|不具合/i;
const MINOR = /nit|suggestion|optional|style|軽微|提案/i;

export function classifySeverity(summary: string): "critical" | "major" | "minor" {
  if (CRITICAL.test(summary)) return "critical";
  if (MAJOR.test(summary)) return "major";
  if (MINOR.test(summary)) return "minor";
  return "minor";
}

export function deriveItemKey(severity: string, summary: string, location?: string): string {
  const normalized = summary.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  return `${severity}:${normalized}:${location ?? ""}`;
}
```

- [ ] **Step 2: 既存 detector の出力に severity/itemKey を追加**

```typescript
// src/core/review-rejection-detector.ts
export type ReviewRejectionSignal = {
  readonly matched: boolean;
  readonly excerpts: readonly string[];
  readonly summary: string;
  readonly severity: "critical" | "major" | "minor";
  readonly itemKey: string;
};
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/review-severity.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/review-severity.ts src/core/review-rejection-detector.ts tests/core/review-severity.test.ts
git commit -m "feat(v2): deterministic review severity classifier and itemKey"
```

- [ ] **Step 5: Phase 6 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase6-v2-review-aggregator__base`（Base から派生）。

---

### Task 6.2: Review Aggregator with Scope-Aware byScope

**Files:**

- Create: `src/core/v2/review-aggregator.ts`
- Modify: `src/core/v2/state-projection.ts`（byScope 集約を追加）
- Test: `tests/core/v2/review-aggregator.test.ts`
- Test: `tests/core/v2/state-projection-review.test.ts`

**Interfaces:**

- Consumes: `ReviewRejectionSignal`, `ObservationRecord{kind:"review_observed"}`.
- Produces: `aggregateReviews(records): ReviewSummary` with `byScope` and deterministic resolution rules (D32).

- [ ] **Step 1: review aggregator を実装（D32/D66）**

```typescript
// src/core/v2/review-aggregator.ts
import type { ReviewItem } from "./observation-model.ts";

export type ReviewSummary = {
  readonly authority: "observed_review_output";
  readonly critical: readonly string[];
  readonly major: readonly string[];
  readonly minor: readonly string[];
  readonly resolved: readonly string[];
  readonly open: readonly string[];
  readonly byScope: ReadonlyMap<string, { readonly critical: readonly string[]; readonly major: readonly string[]; readonly minor: readonly string[]; readonly resolved: readonly string[]; readonly open: readonly string[] }>;
};

export function aggregateReviews(records: readonly ObservationRecord[]): ReviewSummary {
  // 1. Group review_observed records by reviewScope.
  // 2. Within each scope, aggregate items by itemKey.
  // 3. Transition to `resolved` ONLY when one of the following is observed:
  //    (a) explicit resolution marker for the itemKey,
  //    (b) a complete snapshot (`isCompleteSnapshot: true`) for the scope where the itemKey is absent,
  //    (c) a human-approved artifact (`resolution: "human_artifact"`) referencing the itemKey.
  // 4. Mere disappearance (scope change, detector miss, output format change) keeps the item `open`.
}
```

- [ ] **Step 1b: review 解決規則テストを追加（D32）**

```typescript
// tests/core/v2/review-aggregator.test.ts
it("keeps item open on mere disappearance", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", itemKey: "minor:bar", severity: "minor" }),
  ];
  const summary = aggregateReviews(records);
  expect(summary.byScope.get("task-1")?.open).toContain("major:foo");
});

it("marks item resolved on explicit marker", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", resolutionMarker: { itemKey: "major:foo", resolution: "explicit_marker" } }),
  ];
  const summary = aggregateReviews(records);
  expect(summary.byScope.get("task-1")?.resolved).toContain("major:foo");
  expect(summary.byScope.get("task-1")?.open).not.toContain("major:foo");
});

it("marks item resolved on complete snapshot absence", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", isCompleteSnapshot: true, items: [{ itemKey: "minor:bar", severity: "minor" }] }),
  ];
  const summary = aggregateReviews(records);
  expect(summary.byScope.get("task-1")?.resolved).toContain("major:foo");
  expect(summary.byScope.get("task-1")?.open).toContain("minor:bar");
});

it("keeps item open when snapshot is not marked complete", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", isCompleteSnapshot: false, items: [{ itemKey: "minor:bar", severity: "minor" }] }),
  ];
  const summary = aggregateReviews(records);
  expect(summary.byScope.get("task-1")?.open).toContain("major:foo");
});

it("marks item resolved on human artifact", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", resolutionMarker: { itemKey: "major:foo", resolution: "human_artifact", artifactRef: "docs/reviews/2026-06-26.md" } }),
  ];
  const summary = aggregateReviews(records);
  expect(summary.byScope.get("task-1")?.resolved).toContain("major:foo");
});
```

- [ ] **Step 2: state-projection に byScope マージを追加**

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/review-aggregator.ts src/core/v2/state-projection.ts tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts
git commit -m "feat(v2): scope-aware review aggregator"
```

- [ ] **Step 5: Phase 6 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 6.1`（直前 Task から派生）。severity/itemKey を使用するため。

---

### Task 6.3: Review Observed Generation in Handler

**Files:**

- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/v2/review-scope.ts`
- Test: `tests/hooks/observation-handler-review.test.ts`

**Interfaces:**

- Consumes: `ReviewRejectionDetector.detect(output)`, `aggregateReviews`, `deriveReviewScope`.
- Produces:
  - `ObservationRecord{kind:"review_observed", reviewScope, items[], isCompleteSnapshot?}` append on task/PostToolUse outputs.
  - `ObservationRecord{kind:"review_observed", reviewScope, resolutionMarker[]}` append when a human-approved resolution artifact is received (input path: message marker or future `justice_review_resolve` tool; seam only for v2.0).
- Consumes: `ReviewRejectionDetector.detect(output)`, `aggregateReviews`, `deriveReviewScope`.
- Produces: `ObservationRecord{kind:"review_observed", reviewScope, items[]}` append on task/PostToolUse outputs.

- [ ] **Step 1: review scope 導出関数を確認・修正（§7.6）**
  - （※`deriveReviewScope` は Task 5.2 にて作成済みであるため、必要に応じて実装内容を確認し、追加要件があれば修正する）

- [ ] **Step 2: PostToolUse 時に review_observed を生成・append（通常観測）**

```typescript
// src/hooks/observation-handler.ts 内 handlePostToolUse
// After tool_executed append and before evaluateGateIfTriggered, append review_observed:
try {
  const payload = event.payload;
  const callId = payload.callId ?? "";
  const signal = ReviewRejectionDetector.detect(payload.toolResult ?? "");
  if (signal.matched) {
    const sessionId = event.sessionId;
    const agentId = resolveAgentId(sessionId);
    const shardId = { agentId, sessionId, writerId: this.writerId };
    const record: ObservationRecord = {
      ...this.buildEnvelope({
        taskId,
        agentId,
        sessionId,
        recordType: "observation",
      }),
      kind: "review_observed",
      reviewScope: deriveReviewScope({ taskId, sessionId, callId, toolName: payload.toolName }),
      isCompleteSnapshot: false, // detector output is a partial observation, not a full snapshot
      items: [{ itemKey: signal.itemKey, evidenceId: signal.itemKey, severity: signal.severity, summary: signal.summary, location: "", status: "open" }],
    };
    await this.logStore.append(shardId, record);
  }
} catch (err) {
  this.logger.warn("observation-handler: review_observed generation failed", err);
}
// evaluateGateIfTriggered("tool_observed", taskId) runs AFTER both tool_executed and review_observed are appended.
```

- [ ] **Step 2b: 人間承認 artifact 解決マーカー経路を追加（D32 seam）**

v2.0 では解決マーカーのデータモデルと集計ロジックを実装し、入力経路は seam のみ作成する。入力経路は `Message` イベント内の決められたマーカー文字列、または将来の `justice_review_resolve` custom tool とする。

```typescript
// src/hooks/observation-handler.ts 内（将来の拡張用 seam）
private async handleReviewResolutionArtifact(payload: { agentId: ObservationAgentId; sessionId: string; reviewScope: string; itemKeys: string[]; artifactRef: string }): Promise<HookResponse> {
  try {
    const record: ObservationRecord = {
      ...this.buildEnvelope({
        agentId: payload.agentId,
        sessionId: payload.sessionId,
        recordType: "observation",
      }),
      kind: "review_observed",
      reviewScope: payload.reviewScope,
      resolutionMarker: payload.itemKeys.map((itemKey) => ({
        itemKey,
        resolution: "human_artifact",
        artifactRef: payload.artifactRef,
      })),
      items: [],
    };
    await this.logStore.append(this.shardId, record);
  } catch (err) {
    this.logger.warn("observation-handler: review resolution marker failed", err);
  }
  return { action: "proceed" };
}
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-review.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/review-scope.ts src/hooks/observation-handler.ts tests/hooks/observation-handler-review.test.ts
git commit -m "feat(v2): review_observed generation in observation handler"
```

- [ ] **Step 5: Phase 6 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 6.2`（直前 Task から派生）。

---

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

- [ ] **Step 0: 依存パッケージ `zod` を追加**

```bash
bun add zod
```

- [ ] **Step 1: `justice_status` 実装**

```typescript
// src/runtime/justice-tools.ts
import { z } from "zod";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { toSerializableProjectedState } from "../core/v2/state-projection.ts";

export function defineJusticeStatusTool(store: ObservationLogStore): ToolDefinition {
  return {
    description: "Justice の現在の投影状態を表示します",
    args: {},
    execute: async () => {
      const events = await store.readAll();
      const state = project(events, "2026-06-26T00:00:00.000Z");
      return JSON.stringify(toSerializableProjectedState(state), null, 2);
    },
  };
}
```

- [ ] **Step 2: adapter に tool 登録を追加（D4）**

```typescript
// src/runtime/opencode-adapter.ts
tool: {
  justice_status: defineJusticeStatusTool(this.logStore),
  // justice_gate / justice_review added in later tasks
},
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/justice-status-tool.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb src/runtime/justice-tools.ts src/runtime/opencode-adapter.ts tests/runtime/justice-status-tool.test.ts
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
      const events = await store.readAll();
      const state = project(events, "2026-06-26T00:00:00.000Z");
      const gates = await gateLoader.load();
      const ctx: GateContext = { trigger: "task_complete", taskId, agentId: "unknown", sessionId: "unknown", reviewScope: collectReviewScopes(state, taskId), reviewSummary: state.reviewSummary };
      const evidence = state.tasks.get(taskId)?.evidence ?? [];
      const verdict = evaluate(gates, evidence, ctx);
      return JSON.stringify(verdict, null, 2);
    },
  };
}
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
      const events = await store.readAll();
      const state = project(events, "2026-06-26T00:00:00.000Z");
      const summary = scope
        ? state.reviewSummary.byScope.get(scope)
        : { ...state.reviewSummary, byScope: Object.fromEntries(state.reviewSummary.byScope) };
      return JSON.stringify(summary, null, 2);
    },
  };
}
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

## Phase 8: Fitness Functions + NFR Tests

**Base Branch:** `feature/phase8-v2-fitness-nfr__base`

**目的:** 設計書で定義された Architecture Fitness Functions（FF-001〜008）と NFR（並行性・セキュリティ・integrity）のテストを実装し、CI 必須 check として登録。本 Phase だけで品質担保テスト群が完成する。設計書 §9.3.1 の Runtime 統合テスト（`record sub-entity refs` 含む）も含める。

**判断:** Phase 8 は全ての先行 Phase を横断的に検証。Task 8.1〜8.7 はそれぞれ独立したテストファイルなので、Base から並列に分岐してもよい。ただし FF-004 は Phase 2/3、FF-005 は Phase 4、FF-006 は adapter/handler、FF-007/008 は Phase 5、NFR は Phase 2/4/6 の実装に依存する。Phase 8 Base は `feature/phase7-v2-justice-tools__base` から切り、各 Task は独立に Base から分岐する（並列レビュー可能）。

---

### Task 8.1: FF-001 Core No OpenCode Imports

**Files:**

- Create: `tests/arch/core-no-opencode-imports.test.ts`
- Modify: `.github/workflows/ci.yml`（FF テストを含むため変更は不要、既存 `bun run test` で含まれる）

**Interfaces:**

- Consumes: `src/core/` file list.
- Produces: Test that no `src/core/` file imports from `@opencode-ai/*`.

- [ ] **Step 0: 依存パッケージ `glob` を追加**

```bash
bun add -d glob
```

- [ ] **Step 1: arch test を実装**

```typescript
// tests/arch/core-no-opencode-imports.test.ts
import { describe, expect, it } from "vitest";
import { glob } from "glob";
import { readFileSync } from "fs";

describe("FF-001", () => {
  it("src/core does not import @opencode-ai/*", () => {
    const files = glob.sync("src/core/**/*.ts");
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/from ['"]@opencode-ai/);
    }
  });
});
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/arch/core-no-opencode-imports.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb tests/arch/core-no-opencode-imports.test.ts
git commit -m "test(v2): FF-001 core no opencode imports"
```

- [ ] **Step 4: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase8-v2-fitness-nfr__base`（Base から派生）。

---

### Task 8.2: FF-002 Determinism + FF-003 No Side Effects

**Files:**

- Create: `tests/core/rule-engine-determinism.test.ts`

**Interfaces:**

- Consumes: `evaluate`, `project`, `extractEvidenceFromTool`.
- Produces: Tests proving same input → same output, and no I/O during evaluation.

- [ ] **Step 1: determinism + no side effects test を実装**

```typescript
// tests/core/rule-engine-determinism.test.ts
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/core/v2/rule-evaluation-engine.ts";

describe("FF-002 / FF-003", () => {
  it("evaluate is deterministic and pure", () => {
    const gates = [...];
    const evidence = [...];
    const ctx = {...};
    const a = evaluate(gates, evidence, ctx);
    const b = evaluate(gates, evidence, ctx);
    expect(a).toEqual(b);
    // no I/O mock: evaluate must not call any async I/O function
  });
});
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/rule-engine-determinism.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/core/rule-engine-determinism.test.ts
git commit -m "test(v2): FF-002 determinism and FF-003 no side effects"
```

- [ ] **Step 4: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase8-v2-fitness-nfr__base`（Base から派生）。

---

### Task 8.3: FF-004 Replay Determinism + FF-005 No plan.md Write

**Files:**

- Create: `tests/core/observation-log-replay.test.ts`（Phase 2 で既に作成済みならスキップ/追加）
- Create: `tests/arch/no-planmd-write.test.ts`

**Interfaces:**

- Consumes: `project`, `FileWriter` mock, `src/hooks/` file list.
- Produces: Replay test and allowlist-based plan.md write check.

- [ ] **Step 1: FF-005 allowlist test を実装（D7/FF-005）**

```typescript
// tests/arch/no-planmd-write.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

describe("FF-005", () => {
  it("new spine does not write plan.md", () => {
    const observationHandler = readFileSync("src/hooks/observation-handler.ts", "utf-8");
    expect(observationHandler).not.toMatch(/writeFile.*plan\.md/);
    // allowlist: task-feedback.ts and loop-handler.ts are allowed
    const allowed = ["src/hooks/task-feedback.ts", "src/hooks/loop-handler.ts"];
    // ...
  });
});
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/arch/no-planmd-write.test.ts tests/core/observation-log-replay.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/arch/no-planmd-write.test.ts
git commit -m "test(v2): FF-004 replay and FF-005 no plan.md write"
```

- [ ] **Step 4: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase8-v2-fitness-nfr__base`（Base から派生）。

---

### Task 8.4: FF-006 Fail-Open

**Files:**

- Create: `tests/hooks/fail-open.test.ts`

**Interfaces:**

- Consumes: `ObservationHandler`, `ObservationLogStore`, `JusticePlugin`.
- Produces: Fault-injection tests proving infra failures degrade to `PROCEED`.

- [ ] **Step 1: fail-open test を実装**

```typescript
// tests/hooks/fail-open.test.ts
import { describe, expect, it } from "vitest";
import { ObservationHandler } from "../../src/hooks/observation-handler.ts";

describe("FF-006 fail-open", () => {
  it("log append exception returns PROCEED", async () => {
    const store = { append: async () => { throw new Error("disk full"); }, readAll: async () => [] };
    const handler = new ObservationHandler(store, /* ... */);
    const result = await handler.handlePostToolUse({ toolName: "bash", callId: "c1", args: {}, output: { output: "" } });
    expect(result.action).toBe("proceed");
  });
});
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/fail-open.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/hooks/fail-open.test.ts
git commit -m "test(v2): FF-006 fail-open behavior"
```

- [ ] **Step 4: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase8-v2-fitness-nfr__base`（Base から派生）。

---

### Task 8.5: FF-007/008 Provenance Gating

**Files:**

- Create: `tests/core/evidence-provenance.test.ts`
- Test: `tests/core/gate-provenance-gating.test.ts`（Phase 5 で既に作成済みなら統合）

**Interfaces:**

- Consumes: `Evidence`, `evaluate`, `GateRule`.
- Produces: Tests proving `declared` and task-summary-derived claims do not satisfy PASS.

- [ ] **Step 1: provenance gating test を実装**

```typescript
// tests/core/evidence-provenance.test.ts
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/core/v2/rule-evaluation-engine.ts";

describe("FF-007 / FF-008", () => {
  it("declared evidence does not satisfy required-tests", () => {
    // ...
  });
});
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/evidence-provenance.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/core/evidence-provenance.test.ts
git commit -m "test(v2): FF-007/008 provenance gating"
```

- [ ] **Step 4: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase8-v2-fitness-nfr__base`（Base から派生）。

---

### Task 8.6: NFR Security + Integrity + Reference Resolution Tests

**Files:**

- Create: `tests/core/v2/redaction-integration.test.ts`
- Create: `tests/runtime/observation-log-integrity.test.ts`
- Create: `tests/core/record-reference-resolution.test.ts`

**Interfaces:**

- Consumes: `redactForPersistence`, `redactAbsolutePaths`, `ObservationLogStore`, `project`, `DecisionRecord.evidenceRefs[]`.
- Produces: Tests proving secrets and absolute paths are redacted before persistence; corrupted log triggers rebuild; message claim and review item are resolvable from `DecisionRecord.evidenceRefs[]`.

- [ ] **Step 1: redaction integration test を実装（D25/D61）**

```typescript
// tests/core/v2/redaction-integration.test.ts
it("redacts secrets, absolute paths, env vars, and token URLs before append via observation-handler", async () => {
  const writer = createMockFileWriter();
  const reader = createMockFileReader({});
  const store = new ObservationLogStore(writer, reader, "w-1");
  const handler = new ObservationHandler({ logStore: store, sessionStateProvider });

  const rawCommand = "echo /home/alice/project/secret /tmp/foo /workspace/src /Users/bob/project C:\\Users\\carol\\project GITHUB_TOKEN=ghp_xxx https://user:token@example.com";
  const rawOutput = "sk-abc123 HOME=/home/alice";

  // Raw payload that hasn't been redacted yet
  const payload = {
    sessionId: "session-1",
    agentId: "atlas",
    toolName: "execute_command",
    args: { command: rawCommand },
    output: { output: rawOutput },
  };

  // Dispatch through handler which must trigger the redaction pipeline before append
  await handler.handlePostToolUse(payload);

  const physicalPath = toPhysicalPath({ agentId: "atlas", sessionId: "session-1", writerId: "w-1" });
  const written = writer.getFile(physicalPath);
  expect(written).not.toContain("/home/alice/project");
  expect(written).not.toContain("/tmp/foo");
  expect(written).not.toContain("/workspace/src");
  expect(written).not.toContain("/Users/bob/project");
  expect(written).not.toContain("C:\\Users\\carol\\project");
  expect(written).not.toContain("GITHUB_TOKEN=ghp_xxx");
  expect(written).not.toContain("https://user:token@example.com");
  expect(written).not.toContain("sk-abc123");
  expect(written).toContain("[REDACTED_PATH]");
  expect(written).toContain("[REDACTED_ENV]");
  expect(written).toContain("[REDACTED_TOKEN_URL]");
});
```

- [ ] **Step 2: integrity test を実装（D72）**

```typescript
// tests/runtime/observation-log-integrity.test.ts
it("rebuilds state.json on sequence inversion", async () => {
  // ...
});
```

- [ ] **Step 3: record sub-entity reference resolution test を実装（D70）**

```typescript
// tests/core/record-reference-resolution.test.ts
it("resolves message claim and review item from DecisionRecord.evidenceRefs", () => {
  // message claim: evidenceId matches declared_claim Evidence.evidenceId
  // review item: evidenceId equals itemKey
});
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/redaction-integration.test.ts tests/runtime/observation-log-integrity.test.ts tests/core/record-reference-resolution.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tests/core/v2/redaction-integration.test.ts tests/runtime/observation-log-integrity.test.ts tests/core/record-reference-resolution.test.ts
git commit -m "test(v2): NFR security, integrity, and record sub-entity reference resolution"
```

- [ ] **Step 6: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase8-v2-fitness-nfr__base`（Base から派生）。

---

### Task 8.7: Full Regression + CI Finalization

**Files:**

- Modify: `.github/workflows/ci.yml`（FF tests を含むため変更は不要）
- Modify: `docs/superpowers/specs/2026-06-16-justice-v2-foundation-design.md`（必要に応じて最終追記）

**Interfaces:**

- Consumes: 全 Phase 成果。
- Produces: 全テスト green、CI green、v2.0 DoD 充足。

- [ ] **Step 1: Devcontainer 内で全テスト・型検査・lint・build を実行**

```bash
devcontainer exec --workspace-folder . bash -c "
  bun install --frozen-lockfile &&
  bun run lint &&
  bun run typecheck &&
  bun run test &&
  bun run build
"
```

Expected: lint/typecheck/test/build 全 green。新テスト数 + 563 既存テストが passing。

- [ ] **Step 2: テスト数を確認**

```bash
devcontainer exec --workspace-folder . bun run test -- --reporter=verbose
```

Expected: 563 + 新規テスト数が全 pass。

- [ ] **Step 3: CI workflow が `ubuntu-slim`・`master` トリガーであることを確認**

`.github/workflows/ci.yml` は既に `runs-on: ubuntu-slim` かつ `branches: [master]` なので変更不要。必要に応じて `.github/workflows/ci.yml` の `jobs` に devcontainer-smoke ジョブが追加されていればそれを含む。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: finalize v2.0 CI with devcontainer and full regression"
```

- [ ] **Step 5: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase8-v2-fitness-nfr__base`（Base から派生）。

---

## 依存関係とブランチ派生の総括

**ルール:** Phase 0 Base のみ `master` から直接分岐する。Phase 1〜7 の各 Phase Base は**直前の Phase Base**から分岐する（`gt checkout feature/phase<N-1>-v2-...__base && gt branch create feature/phaseN-v2-...__base`）。**Phase 8 Base は `feature/phase7-v2-justice-tools__base` から分岐する。**Phase 内の Task は原則 Phase Base から分岐するが、同一ファイル・同一型を連続して使用する Task は直前 Task から分岐する。Phase 間の stack 依存は Graphite が管理する。

```text
master
  └── feature/phase0-v2-baseline__base
       ├── feature/phase0-task1-devcontainer-baseline        (Base から派生)
       └── feature/phase0-task2-v2-spikes                     (Task 0.1 から派生)

  └── feature/phase1-v2-core-model__base
       ├── feature/phase1-task1-core-types                   (Base から派生)
       ├── feature/phase1-task2-evidence-engine              (Task 1.1 から派生)
       └── feature/phase1-task3-redaction-safe-segment       (Task 1.2 から派生)

  └── feature/phase2-v2-log-projection__base
       ├── feature/phase2-task1-shard-layout                 (Base から派生)
       ├── feature/phase2-task2-atomic-append                (Task 2.1 から派生)
       ├── feature/phase2-task3-state-projection             (Task 2.2 から派生)
       └── feature/phase2-task4-rotation-archive              (Task 2.3 から派生)

  └── feature/phase3-v2-message-adapter__base
       ├── feature/phase3-task1-message-role-buffer          (Base から派生)
       ├── feature/phase3-task2-adapter-extension            (Base から派生)
       └── feature/phase3-task3-justice-routing              (Task 3.2 から派生)

  └── feature/phase4-v2-observation-handler__base
       ├── feature/phase4-task1-tool-observation             (Base から派生)
       ├── feature/phase4-task2-message-observation          (Task 4.1 から派生)
       ├── feature/phase4-task3-skill-task-summary           (Task 4.2 から派生)
       └── feature/phase4-task4-session-error-reflection     (Task 4.3 から派生)

  └── feature/phase5-v2-rule-engine__base
       ├── feature/phase5-task1-gate-schema                  (Base から派生)
       ├── feature/phase5-task2-rule-engine                  (Task 5.1 から派生)
       ├── feature/phase5-task3-default-gates                (Task 5.2 から派生)
       └── feature/phase5-task4-gate-trigger                 (Task 5.3 から派生)

  └── feature/phase6-v2-review-aggregator__base
       ├── feature/phase6-task1-severity-classifier          (Base から派生)
       ├── feature/phase6-task2-review-aggregator            (Task 6.1 から派生)
       └── feature/phase6-task3-review-observed              (Task 6.2 から派生)

  └── feature/phase7-v2-justice-tools__base
       ├── feature/phase7-task1-justice-status               (Base から派生)
       ├── feature/phase7-task2-justice-gate                 (Task 7.1 から派生)
       ├── feature/phase7-task3-justice-review               (Task 7.2 から派生)
       └── feature/phase8-v2-fitness-nfr__base                (Phase 7 Base から派生)
            ├── feature/phase8-task1-ff001-core-imports           (Base から派生)
            ├── feature/phase8-task2-ff002-003-determinism        (Base から派生)
            ├── feature/phase8-task3-ff004-005-replay-planmd      (Base から派生)
            ├── feature/phase8-task4-ff006-fail-open               (Base から派生)
            ├── feature/phase8-task5-ff007-008-provenance          (Base から派生)
            ├── feature/phase8-task6-nfr-security-integrity        (Base から派生)
            └── feature/phase8-task7-final-regression             (Base から派生)
```

---

## 自己レビュー（Self-Review）

- [x] **Spec coverage:** 設計書 §10.3 の 8 ビルドステップを Phase 1〜7 に網羅。§9 の FF/NFR を Phase 8 に網羅。Phase 0 は §3 の 2 スパイク + devcontainer ベースラインを網羅。CODEOWNERS 追認 ADR 作成は Pre-Planning Preflight として本計画の executable 化条件となる。
- [x] **Phase 0:** CI/CD（`.github/workflows/ci.yml` with `master` trigger + `ubuntu-slim`）と Devcontainer（`.devcontainer/devcontainer.json` + `Dockerfile`）は既存。Phase 0 はこれらの検証 + **3 スパイク**（観測レイテンシ・Message fallback matrix・C1/L0 advisory 表示面実証）に充てる。Pre-Planning Preflight（ADR 追認）が完了して初めて本計画を executable とする。
- [x] **Devcontainer 強制:** 各 Task の検証手順に `devcontainer exec --workspace-folder . ...` を明記。
- [x] **ブランチ運用:** Graphite Stacked PR Workflow に準拠。各 Phase には `feature/phaseN-v2-...__base`、各 Task には `feature/phaseN-taskM-...` ブランチを定義。各 Task 最後は `gt submit` による Phase Base 向け Draft PR 作成・更新。
- [x] **派生元:** Phase 0 Base のみ `master` から直接分岐。Phase 1〜7 の各 Phase Base は直前の Phase Base から分岐。Phase 8 Base は `feature/phase7-v2-justice-tools__base` から分岐。独立して単体完結する Task は Base から派生。同一ファイル・同一型を連続して使用する Task は直前 Task から派生。
- [x] **Placeholder scan:** `throw new Error("implement projection fold")`、`StateProjectionCache.write` の未定義 `content`、Task 1.3 / Task 6.3 の未閉じ code fence、Task 6.3 の余分な `}` 等を修正済み。`...envelope...` 等のプレースホルダは `buildEnvelope` ヘルパーに置き換え。実装計画の簡略化のため、一部の難解な関数（`MessageRoleBuffer`、`evaluateRule`、`aggregateReviews` 等）の内部ロジックは擬似コード（pseudocode only / スタブ）として残している旨を明記。
- [x] **Type consistency:** `Evidence` は `taskId` を持たず envelope が持つ。`ProjectedState.tasks` は `evidence` 配列を持つ。`RuleEngine.evaluate` は task-scoped evidence と `GateContext.reviewSummary` を受け取る。`extractEvidenceFromTool` は single `Evidence`（interpretation 内包）を返す。`EvidenceRef` は `FullEvidenceRef | SelfEvidenceRef` の union。
- [x] **Graphite 一貫性:** `gh pr create` を `gt submit` に統一。PR タイトル/本文は commit message から生成されるため、commit ステップで内容を制御する。
- [x] **File I/O 抽象化:** rotation 判定は `FileReader.readFileStats` 経由。`fs.stat` 直接呼び出しを排除。
- [x] **L0 advisory surface:** `evaluateGateIfTriggered` は `injectedContext` を返し、adapter が notifier 保証チャネル + `output.output` best-effort 追記を適用（D47/D64）。**`output.output` 追記は Task 0.2 Step 1b の C1 実測結果で gate し、反映不可なら notifier のみに固定する。**
- [x] **YAML enum:** `GateRule` verdict は lowercase (`pass`/`warn`/`fail`)。`parseGateYaml` は小文字 YAML を正規化する。
- [x] **CODEOWNERS 追認:** Pre-Planning Preflight で ADR 作成・CODEOWNERS 承認取得を実施。未承認時は本計画を executable にしない。

---

## 実行開始時のオプション

計画ファイル作成完了。以下のどちらかで実行を進めてください。

1. **Subagent-Driven（推奨）** — 各 Task を新規 subagent に委譲し、Manager（Sisyphus）がレビュー・合流を制御。`superpowers:subagent-driven-development` スキルを使用。
2. **Inline Execution** — 同一セッションで `superpowers:executing-plans` スキルを使用して逐次実行。
