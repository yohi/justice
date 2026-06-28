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
## Phase 0: ベースライン確立と De-risk Spikes

**Base Branch:** `feature/phase0-v2-baseline__base`

**目的:** 既存 CI/Devcontainer を v2.0 開発用に検証し、Phase 0 で決着すべき 3 つの実測スパイクを完了する。本 Phase の成果は設計書の前提を確定させるため、実装計画の最初に位置づける。

**判断:** Phase 0 のタスクは独立しているが、後続 Phase はこれらの前提（Message 観測 fallback matrix）に依存する。Phase 0 Base は `master` から分岐する。


### Task 0.0: Preflight Verification

**Prerequisites:**
- **[重要・手動前提作業]** 本実装計画の実行前に、ADRドキュメント `docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md` の作成および CODEOWNERS による承認取得（APPROVED）が完了している必要があります。これらは本実装計画のスコープ外で事前に実施される手動プロセスであり、Task 0.0 はその完了を静的に検証・追認する役割のみを持ちます。

**Files:**

- Create: `tests/preflight-verification.test.ts` (static verification for ADR existence and ratification status)

**Interfaces:**

- Consumes: ADR ratification status (`docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md`).
- Produces: Execution safety verification.

- [ ] **Step 1: ADR ドキュメント（ADR-2026-06-26-v2-charter-drift.md）がリポジトリ内に存在し、正しい内容であることを確認する**
  - パス: `docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md`
  - 内容: `Status: APPROVED` などの承認証跡が記載されていることをテストで検証する（将来の再実行時に破綻するのを防ぐため、単体テスト内に具体的な PR 番号や個人名をハードコードすることは避ける）。

- [ ] **Step 2: テストコード（tests/preflight-verification.test.ts）の実装**

```typescript
import { readFileSync, existsSync } from "fs";
import { expect, test } from "vitest";

test("preflight verification: ADR ratification check", () => {
  const adrPath = "docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md";
  expect(existsSync(adrPath)).toBe(true);
  const content = readFileSync(adrPath, "utf-8");
  expect(content).toMatch(/\*\s*\*\*Status:\*\*\s*APPROVED/);
  // Verify real approvers are documented instead of placeholder names (avoiding hardcoded names)
  expect(content).toMatch(/\*\s*\*\*Approvers:\*\*\s*`@[A-Za-z0-9_-]+`,\s*`@[A-Za-z0-9_-]+`/);
  expect(content).not.toContain("@owner-alice");
  expect(content).not.toContain("@owner-bob");
  // Verify essential ADR contents (Finding 3)
  expect(content).toContain("D44");
  expect(content).toContain("§4.5");
  expect(content).toContain("D5");
  expect(content).toContain("D54");
  expect(content).toContain("D63");
  expect(content).toContain("INV-004");
  expect(content).toContain("M4");
});
```

- [ ] **Step 2b: ADR 追認の手動 Preflight の確認**
  - ADRファイルの存在、`Status: APPROVED`、およびプレースホルダー置換等の静的チェックは CI ジョブ内（`preflight-verification.test.ts` を通じた通常テスト実行）で検証する。
  - PR がマージされているかどうかの動的ステータス確認は、マージ前の PR CI 自体を壊すのを防ぐため、開発者の手動 preflight または専用の post-merge ワークフローに分離し、通常の PR CI ワークフロー（`.github/workflows/ci.yml`）には追加しない。
  ```bash
  # 手動 preflight または専用ワークフローでの確認コマンド例
  gh pr view "$PR_NUMBER" --json reviewDecision,state -q '.state == "MERGED" and .reviewDecision == "APPROVED"'
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

**派生元:** `feature/phase0-task0-preflight`（Task 0.0 から派生）。


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
git add docs/superpowers/spikes/2026-06-26-v2-phase0-spikes.md docs/superpowers/specs/2026-06-16-justice-v2-foundation-design.md
git commit -m "docs: v2.0 Phase 0 de-risk spikes 結果を記録および設計書更新"
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
- Create: `src/core/v2/message-payload.ts` (ObservationMessagePayload union moved forward here to resolve Graphite dependencies)
- Create: `src/core/v2/references.ts`
- Create: `src/core/v2/hash.ts` (hashString utility definition)
- Modify: `src/core/types.ts`（必要に応じて `ObservationAgentId`, `EvidenceRef`, `ShardId` 等を追加）
- Test: `tests/core/v2/observation-model.test.ts`
- Test: `tests/core/v2/message-payload.test.ts`
- Test: `tests/core/v2/hash.test.ts`

**Interfaces:**

- Consumes: 既存 `AgentId`（atlas/hephaestus/sisyphus/prometheus）。
- Produces:
  - `ObservationRecord` discriminated union (`kind: "tool_executed" | "message" | "skill_invoked" | "review_observed" | "session_error" | "reflection"`).
  - `ObservationMessagePayload` union.
  - `DecisionRecord` with `ruleResults[]`.
  - `EvidenceRef = FullEvidenceRef | SelfEvidenceRef`.
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
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string; // validated via isSafeWriterId
};

export type EvidenceRef = FullEvidenceRef | SelfEvidenceRef;

export type FullEvidenceRef = {
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
  readonly sequence: number;
  readonly evidenceId: string;
};

export type SelfEvidenceRef = {
  readonly evidenceId: string;
};
```

- [ ] **Step 3: `ObservationMessagePayload` を `src/core/v2/message-payload.ts` に実装（前倒し定義・D71）**

```typescript
// src/core/v2/message-payload.ts
export type ObservationMessagePayload =
  | { readonly kind: "message_part_updated"; readonly sessionId: string; readonly messageID: string; readonly partID: string; readonly text: string }
  | { readonly kind: "message_updated"; readonly sessionId: string; readonly messageID: string; readonly role: "assistant" | "user"; readonly finalized: boolean }
  | { readonly kind: "text_complete"; readonly sessionId: string; readonly messageID: string; readonly partID: string; readonly text: string };
```

- [ ] **Step 3b: `ObservationRecord` union を実装**

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
  readonly evidence: Evidence | readonly Evidence[];
};

// MessageRecord stub. Refined in Task 3.1 to include declaredClaims and finalized field.
export type MessageRecord = {
  readonly kind: "message";
  readonly messageID: string;
  readonly role: "assistant";
  readonly textHash: string;
  readonly textSnippet?: string;
  readonly finalized: boolean;
};

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

- [ ] **Step 3c: `hashString` 決定論的ユーティリティの実装（ISS-006）**

```typescript
// src/core/v2/hash.ts
import { createHash } from "crypto";

/**
 * 与えられた文字列の SHA-256 ハッシュを計算し、プレフィックス "sha256:" を付与した文字列を返します。
 * 証拠保存時の決定論的なハッシュ生成に使用されます。
 */
export function hashString(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `sha256:${hash}`;
}
```

- [ ] **Step 4: `DecisionRecord` 型を実装**

```typescript
// src/core/v2/decision-model.ts
export type RuleResult = {
  readonly ruleId: string;
  readonly verdict: "PASS" | "WARN" | "FAIL";
  readonly reason?: string;
  readonly evidenceRefs: readonly FullEvidenceRef[];
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

### Task 1.2: Redaction Utilities + Secret Scanning for v2

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
  // Redact the entire token URL to prevent leaking userinfo (user:token) credentials (D61)
  return text.replace(/https?:\/\/[^@\s]+@[^\s"']+/g, "[REDACTED_TOKEN_URL]");
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

**派生元:** `Task 1.1`（直前 Task から派生）。

---

### Task 1.3: Evidence Engine + Source Classification

**Files:**

- Create: `src/core/v2/evidence-engine.ts`
- Create: `src/core/v2/tool-output-classifier.ts`
- Create: `src/core/v2/declared-claim-extractor.ts`
- Modify: `src/core/v2/observation-model.ts`（`Evidence` discriminated union 追加）
- Test: `tests/core/v2/evidence-engine.test.ts`
- Test: `tests/core/v2/tool-output-classifier.test.ts`
- Test: `tests/core/v2/declared-claim-extractor.test.ts`

**Interfaces:**

- Consumes: `ObservationRecord` envelope, `ToolOutput` from adapter (`{ title, output, metadata }`), `ObservationMessagePayload` union (Task 3.1), `ReviewRejectionSignal` from existing `review-rejection-detector.ts`.
- Produces:
  - `Evidence` discriminated union with `sourceClass: "tool_output" | "declared_claim"`.
  - `extractEvidenceFromTool(toolName, args, output, metadata, callId): Evidence` (returns observed + derived interpretation).
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
  readonly provenance: "observed" | "derived" | "unknown";
  readonly toolOutputClass: "command_exec";
  readonly command: string;
  readonly rawOutput: string;
  readonly interpretation?: Interpretation;
};

export type FileContentEvidence = {
  readonly evidenceId: string;
  readonly kind: "test" | "build" | "lint" | "command" | "generic";
  readonly sourceClass: "tool_output";
  readonly provenance: "observed" | "derived" | "unknown";
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
    // Split by shell delimiters that execute sequential commands (&&, ||, ;)
    // Do NOT split by pipe (|) here to prevent stdin filter utilities (like '| grep')
    // from misclassifying sequential execution as file content.
    const subCommands = command.split(/&&|\|\||;/);
    let hasFileContent = false;
    let hasCommandExec = false;

    for (const sub of subCommands) {
      // Analyze the leading command in the pipeline (before the first '|')
      const pipelineStart = sub.split("|")[0] ?? "";
      const subTokens = pipelineStart.trim().split(/\s+/).filter(Boolean);
      const firstToken = subTokens[0] ?? "";
      if (FILE_CONTENT_COMMANDS.has(firstToken)) {
        hasFileContent = true;
      }
      if (COMMAND_EXEC_COMMANDS.has(firstToken)) {
        hasCommandExec = true;
      }
    }

    if (hasFileContent) {
      return "file_content";
    }
    if (hasCommandExec) {
      return "command_exec";
    }

    const tokens = command.trim().split(/\s+/).filter(Boolean);
    // Fallback to file_content only if the command is unrecognized and the output is massive
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
  output: { readonly output?: string; readonly metadata?: { readonly error?: boolean } },
  callId: string // determinism: use callId as evidenceId (FIND-003)
): Evidence {
  const rawOutput = output.output ?? "";
  const toolOutputClass = classifyToolOutputClass(toolName, args, rawOutput.length);
  const observedId = callId; // Deterministic evidenceId from tool callId (FF-002/FF-003)
  const kind = toolName === "task" ? "generic" : mapToolNameToKind(toolName, args);
  return {
    evidenceId: observedId,
    kind,
    sourceClass: "tool_output",
    provenance: "observed",
    toolOutputClass,
    command: args?.command,
    ...(toolOutputClass === "command_exec"
      ? { rawOutput: redactForPersistence(redactAbsolutePaths(rawOutput)) }
      : { rawOutputHash: hashString(rawOutput), rawOutputSnippet: "" }),
    interpretation: {
      outcome: toolName === "task" ? "unknown" : deriveOutcome(output),
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
  expect(classifyToolOutputClass("bash", { command: "bun run lint && bun run test" }, 100)).toBe("command_exec");
  expect(classifyToolOutputClass("bash", { command: "bun run build; bun run typecheck" }, 100)).toBe("command_exec");
});

it("classifies file-content compound commands as file_content", () => {
  expect(classifyToolOutputClass("bash", { command: "cat file.txt | grep foo" }, 100)).toBe("file_content");
  expect(classifyToolOutputClass("bash", { command: "head -20 file.ts && tail -5 file.ts" }, 100)).toBe("file_content");
  expect(classifyToolOutputClass("bash", { command: "bun run test && cat docs/superpowers/plans/2026-06-26-justice-v2-foundation.md" }, 30000)).toBe("file_content");
});

it("classifies stdin pipe filters like grep as command_exec", () => {
  expect(classifyToolOutputClass("bash", { command: "bun run test | grep failed" }, 100)).toBe("command_exec");
  expect(classifyToolOutputClass("bash", { command: "npm run lint | rg 'error'" }, 100)).toBe("command_exec");
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

---

## Phase 2: Observation Log Store + State Projection

**Base Branch:** `feature/phase2-v2-log-projection__base`

**目的:** per-writer segment JSONL への atomic append + active/archive 読取マージ + 純粋 state projection を実装。本 Phase だけで event log I/O と replay 決定性が検証できる。

**判断:** Phase 2 は Phase 1 の型を使用（`ObservationRecord`, `DecisionRecord`, `EvidenceRef`）。したがって Phase 2 Base は Phase 1 の最終 Task ブランチ（`feature/phase1-task3-evidence-engine`）から分岐する（`gt checkout feature/phase1-task3-evidence-engine && gt branch create feature/phase2-v2-log-projection__base`）。Graphite stacking では Phase 2 Base を前 Phase 1 の最終 Task から派生させ、各 Task は Phase 2 Base から分岐する。Task 2.1 は独立した I/O 基盤（writerId, safe-segment）なので Base から、Task 2.2 は 2.1 のファイルレイアウトを使用するため Task 2.1 から、Task 2.3 は 2.2 の readAll 結果を使用するため Task 2.2 から、Task 2.4 は 2.2 の append 経路を使用するため Task 2.3 から。

---

### Task 2.1: Writer ID + Safe Segment Encoding + File Layout

**Files:**

- Create: `src/core/v2/shard-layout.ts`
- Create: `src/core/v2/writer-id-validation.ts`
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

- [ ] **Step 1: shard layout 関数と writer-id バリデーションを実装**

```typescript
// src/core/v2/writer-id-validation.ts
const WRITER_ID_RE = /^w-[A-Za-z0-9-]+$/;

export function isSafeWriterId(id: string): boolean {
  return WRITER_ID_RE.test(id) && id !== "w-system";
}
```

```typescript
// src/core/v2/shard-layout.ts
import { encodeSafeSegment } from "./safe-segment.ts";
import type { ShardId } from "../types.ts";
import { isSafeWriterId } from "./writer-id-validation.ts";

export function toPhysicalPath(shardId: ShardId): string {
  if (!isSafeWriterId(shardId.writerId)) {
    throw new Error(`toPhysicalPath: unsafe writerId: ${shardId.writerId}`);
  }
  return `.justice/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.jsonl`;
}

export function toArchivePath(shardId: ShardId, timestamp: string): string {
  if (!isSafeWriterId(shardId.writerId)) {
    throw new Error(`toArchivePath: unsafe writerId: ${shardId.writerId}`);
  }
  return `.justice/archive/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.${timestamp}.jsonl`;
}
```

- [ ] **Step 2: writer ID 生成を実装（D55）**

```typescript
// src/runtime/writer-id.ts
import { randomUUID } from "crypto";
import type { FileReader } from "../core/types.ts";
import { toPhysicalPath } from "../core/v2/shard-layout.ts";
import { isSafeWriterId } from "../core/v2/writer-id-validation.ts";

export function generateWriterId(): string {
  return `w-${randomUUID()}`;
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
- [ ] **Step 0: Extend `FileReader` with `listFiles(prefix)` and `FileWriter` with `rename(from, to)`**

Add `listFiles(prefix: string): Promise<readonly string[]>` to `FileReader` and `rename(from: string, to: string): Promise<void>` to `FileWriter` in `src/core/types.ts`. Implement them in `src/runtime/node-file-system.ts` using `fs.readdir` with prefix filtering and `fs.rename` for atomic file moves, and in `tests/helpers/mock-file-system.ts`. This is required for `ObservationLogStore.readAll()` to enumerate `.justice/events/**` and `.justice/archive/events/**`, and for `createShardWriteQueue` to atomically save files without direct `fs` access in Core or tests.

```typescript
// src/core/types.ts
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  listFiles(prefix: string): Promise<readonly string[]>;
}

export interface FileWriter {
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}
```

```typescript
// src/runtime/node-file-system.ts
import { readdir, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

async listFiles(prefix: string): Promise<readonly string[]> {
  try {
    const safePrefix = await this.resolveSafely(prefix);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const entries = await readdir(safePrefix, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => relative(this.rootDir, join(e.parentPath, e.name)));
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return [];
    throw err;
  }
}

async rename(from: string, to: string): Promise<void> {
  const safeFrom = await this.resolveSafely(from);
  const safeTo = await this.resolveSafely(to);
  // Ensure the parent directory of the destination file exists before renaming
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dirname(safeTo), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await rename(safeFrom, safeTo);
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
  onError: (path: string, err: unknown) => void,
  onAppendComplete?: (path: string) => Promise<void>
): (path: string, record: object) => Promise<number> {
  const queues = new Map<string, QueueItem[]>();
  const sequences = new Map<string, number>();
  const runningPaths = new Set<string>();

  async function atomicAppend(path: string, content: string) {
    const tempPath = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await writer.writeFile(tempPath, content);
    await writer.rename(tempPath, path);
  }

  async function process(path: string) {
    if (runningPaths.has(path)) return;
    runningPaths.add(path);

    try {
      if (!sequences.has(path)) {
        const initSeq = await getInitialSequence(path).catch(() => 0);
        sequences.set(path, initSeq);
      }
      while (true) {
        const items = queues.get(path);
        if (!items || items.length === 0) {
          break;
        }

        const current = items.shift()!;
        try {
          const nextSeq = (sequences.get(path) ?? 0) + 1;
          const existing = await readExisting(path).catch(() => "");
          const line = `${JSON.stringify({ ...current.record, sequence: nextSeq })}\n`;
          await atomicAppend(path, existing + line);
          sequences.set(path, nextSeq);
          
          if (onAppendComplete) {
            await onAppendComplete(path).catch((err) => onError(path, err));
          }
          
          current.resolve(nextSeq);
        } catch (err) {
          current.reject(err);
          throw err;
        }
      }
    } catch (err) {
      onError(path, err);
      // Drain remaining items with rejection so callers are not left hanging.
      const items = queues.get(path) ?? [];
      while (items.length > 0) {
        items.shift()!.reject(err);
      }
    } finally {
      runningPaths.delete(path);
      // Race check: if a new item was enqueued after the loop check but before runningPaths.delete,
      // start processing again to prevent event loss.
      const items = queues.get(path);
      if (items && items.length > 0) {
        process(path);
      } else {
        queues.delete(path);
      }
    }
  }

  return (path, record) => new Promise((resolve, reject) => {
    if (!queues.has(path)) queues.set(path, []);
    queues.get(path)!.push({ record, resolve, reject });
    process(path);
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
    private readonly logger: { warn(message: string, err?: unknown): void; error(message: string, err?: unknown): void } = console
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
          // `listFiles` returns an empty array `[]` if the directory does not exist.
          // By removing the `fileExists` gate, we ensure sequence continuity across rotation segments even if the reader behavior differs.
          const archives = await this.fileReader.listFiles(archiveDir);
          for (const arch of archives) {
            const filename = arch.split("/").pop() ?? "";
            if (filename.startsWith(`${writerId}.`)) {
              await readMaxSeq(arch);
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
    
    // Sort paths deterministically to ensure physical file sequence progression across iterations (FIND-002/ISS-002)
    const sortPaths = (paths: readonly string[]) => [...paths].sort();
    const allPaths = [...sortPaths(archivePaths), ...sortPaths(activePaths)];
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
        // Throw an integrity error instead of silently isolating, because the event log is the single source of truth. (ISS-004)
        // Gate evaluations will capture this error and degrade to fail-open PROCEED.
        this.logger.error(`ObservationLogStore: Shard corrupted or unreadable at ${path}.`, err);
        throw new ObservationLogIntegrityError(`Shard corrupted at ${path}`, err);
      }
    }
    
    try {
      // Validate shard sequence monotonicity and duplicates per shard
      validateShardSequences(records);
    } catch (err) {
      this.logger.warn("ObservationLogStore: Shard sequence validation failed", err);
      throw err; // Propagate validation failure to trigger fail-open reconstruction of state.json
    }
    // Return records as read (unsorted); replay order and causal sorting is the sole responsibility of project()
    return records;
  }
}

export function validateRecordSchema(record: unknown): void {
  if (!record || typeof record !== "object") throw new Error("Invalid record: not an object");
  const r = record as Record<string, unknown>;
  if (typeof r.schemaVersion !== "number" || typeof r.sequence !== "number" || typeof r.timestamp !== "string" || !r.agentId || !r.sessionId || !r.writerId || !r.recordType) {
    throw new Error("Invalid record: missing common envelope fields");
  }
  
  // D72: strict evidence union validation helper
  const validateEvidence = (ev: unknown) => {
    if (!ev || typeof ev !== "object") throw new Error("Invalid evidence: not an object");
    const e = ev as Record<string, unknown>;
    if (typeof e.evidenceId !== "string") throw new Error("Invalid evidenceId");
    
    if (e.sourceClass === "tool_output") {
      if (!["command_exec", "file_content"].includes(e.toolOutputClass as string)) {
        throw new Error("Invalid toolOutputClass for tool_output");
      }
      if (e.toolOutputClass === "file_content" && e.rawOutput !== undefined) {
        throw new Error("rawOutput is forbidden for file_content toolOutputClass");
      }
    } else if (e.sourceClass === "declared_claim") {
      if (e.toolOutputClass !== undefined || e.rawOutput !== undefined || e.exitCode !== undefined || e.stdOut !== undefined || e.stdErr !== undefined) {
        throw new Error("Forbidden fields present in declared_claim evidence");
      }
    } else {
      throw new Error("Invalid sourceClass: must be tool_output or declared_claim");
    }
  };

  // Kind-specific validation
  if (r.recordType === "observation") {
    const kind = r.kind;
    if (kind === "tool_executed") {
      if (typeof r.toolName !== "string" || typeof r.callId !== "string" || !Array.isArray(r.evidence)) {
        throw new Error("Invalid tool_executed record");
      }
      r.evidence.forEach(validateEvidence);
    } else if (kind === "review_observed") {
      if (typeof r.reviewScope !== "string" || !Array.isArray(r.items)) {
        throw new Error("Invalid review_observed record");
      }
      r.items.forEach((item: unknown) => {
        if (!item || typeof item !== "object") throw new Error("Invalid review item: not an object");
        const i = item as Record<string, unknown>;
        if (typeof i.itemKey !== "string" || !["critical", "major", "minor"].includes(i.severity as string) || !["open", "resolved"].includes(i.status as string) || typeof i.summary !== "string" || typeof i.location !== "string") {
          throw new Error("Invalid review item fields");
        }
        if (r.evidence) {
          if (!Array.isArray(r.evidence)) throw new Error("review_observed evidence must be an array");
          const hasEvidence = r.evidence.some((ev: any) => ev.evidenceId === i.itemKey);
          if (!hasEvidence) throw new Error(`Missing evidence correlation for review item ${i.itemKey}`);
        }
      });
    } else if (kind === "message") {
      if (r.role !== "assistant" || !r.textHash || !Array.isArray(r.declaredClaims)) {
        throw new Error("Invalid message record");
      }
    } else if (kind === "skill_invoked") {
      if (typeof r.skillName !== "string" || typeof r.source !== "string") {
        throw new Error("Invalid skill_invoked record");
      }
    } else if (kind === "session_error") {
      if (typeof r.errorKind !== "string" || typeof r.message !== "string") {
        throw new Error("Invalid session_error record");
      }
    } else if (kind === "reflection") {
      if (!r.reflection || typeof r.reflection !== "object") {
        throw new Error("Invalid reflection record");
      }
    } else {
      throw new Error(`Invalid record: unknown observation kind: ${kind}`);
    }
  } else if (r.recordType === "decision") {
    if (r.gateType !== "task" || !Array.isArray(r.ruleResults)) {
      throw new Error("Invalid decision record");
    }
  } else {
    throw new Error(`Invalid record: unknown recordType: ${r.recordType}`);
  }
}


export function validateShardSequences(records: readonly (ObservationRecord | DecisionRecord)[]): void {
  const shardGroups = new Map<string, number[]>();
  for (const r of records) {
    const shardKey = `${r.agentId}:${r.sessionId}:${r.writerId}`;
    if (!shardGroups.has(shardKey)) {
      shardGroups.set(shardKey, []);
    }
    shardGroups.get(shardKey)!.push(r.sequence);
  }
  for (const [shardKey, seqs] of shardGroups.entries()) {
    // 1. Check for duplicate sequence numbers using a Set (independent of traversal order)
    const uniqueSeqs = new Set(seqs);
    if (uniqueSeqs.size !== seqs.length) {
      throw new Error(`Sequence integrity violation on ${shardKey}: duplicate sequence detected`);
    }
    // 2. Check for physical order monotonicity (D72/§9.4)
    for (let i = 1; i < seqs.length; i++) {
      if (seqs[i] < seqs[i - 1]) {
        throw new Error(`Sequence integrity violation on ${shardKey}: sequence inversion detected (non-monotonic)`);
      }
    }
  }
}
```

- [ ] **Step 3: `listFiles` mock 実装と列挙テストを追加**

```typescript
// tests/runtime/observation-log-queue.test.ts
it("readAll merges active and archive segments", async () => {
  const reader = createMockFileReader({
    ".justice/events/agent/session/w-1.jsonl": '{"schemaVersion":1,"sequence":2,"timestamp":"2026-06-26T00:00:00Z","agentId":"hephaestus","sessionId":"session","writerId":"w-1","recordType":"observation","kind":"tool_executed","toolName":"bash","callId":"call-2","evidence":{}}\n',
    ".justice/archive/events/agent/session/w-1.2026-06-26T00:00:00Z.jsonl": '{"schemaVersion":1,"sequence":1,"timestamp":"2026-06-26T00:00:00Z","agentId":"hephaestus","sessionId":"session","writerId":"w-1","recordType":"observation","kind":"tool_executed","toolName":"bash","callId":"call-1","evidence":{}}\n',
  });
  reader.listFiles = async (prefix) => Object.keys(reader.files).filter((p) => p.startsWith(prefix));
  const store = new ObservationLogStore(writer, reader, "w-1");
  const events = await store.readAll();
  expect(events).toHaveLength(2);
});
```

- [ ] **Step 3b: sequence recovery test (rotation, multiple archives, missing archive dir)**

```typescript
// tests/runtime/observation-log-queue.test.ts
it("resolves sequence correctly when archiveDir does not exist or has multiple segments", async () => {
  // 1. Setup mock file reader with no archive directory (listFiles returns [] for archiveDir)
  //    Verify that enqueue returns maxSeq starting at 0 (first sequence).
  // 2. Setup mock file reader with multiple archive segments (e.g. w-1.timestamp1.jsonl, w-1.timestamp2.jsonl)
  //    and active segments. Verify that enqueue reads all sequences and recovers the correct next sequence number.
});
```

- [ ] **Step 4: テストを実行（Devcontainer 内）****

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/observation-log-queue.test.ts tests/runtime/writer-id-collision.test.ts
```

- [ ] **Step 5: writer error 時の queue 復旧・reject テストを追加**

```typescript
// tests/runtime/observation-log-queue.test.ts
it("rejects the current item, pending items, and items added during failure", async () => {
  const writer = createMockFileWriter();
  let attempt = 0;
  // 書込処理を遅延させて、その間に並行 append を行えるようにする
  writer.writeFile = async () => {
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (attempt === 1) throw new Error("disk full");
  };
  const onError = vi.fn();
  const enqueue = createShardWriteQueue(writer, async () => "", async () => 0, onError);

  // 1件目を enqueue（これは失敗する）
  const p1 = enqueue(".justice/events/test.jsonl", { kind: "test", n: 1 });
  // 1件目の書き込み処理中に、2件目（pending）を enqueue
  const p2 = enqueue(".justice/events/test.jsonl", { kind: "test", n: 2 });

  // 1件目が失敗することを確認
  await expect(p1).rejects.toThrow("disk full");
  // 待機中だった2件目も、1件目の失敗によって reject されることを確認
  await expect(p2).rejects.toThrow("disk full");
  expect(onError).toHaveBeenCalled();

  // 失敗処理が完了してキューがリセットされた後の新たな append は成功することを確認
  const p3 = await enqueue(".justice/events/test.jsonl", { kind: "test", n: 3 });
  expect(p3).toBe(1);
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
    readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly byScope: ReadonlyMap<string, {
      readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
      readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
      readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
      readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
      readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    }>;
  };
};

export function toEvidenceArray(evidence: Evidence | readonly Evidence[] | undefined): readonly Evidence[] {
  if (!evidence) return [];
  return Array.isArray(evidence) ? evidence : [evidence];
}

export function project(
  events: readonly (ObservationRecord | DecisionRecord)[],
  rebuiltAt: string
): ProjectedState {
  // 1. Sort events: 2-stage merge (D27/D18/D39). Group by shardId, sort each by sequence, then k-way merge by timestamp -> shardId -> sequence
  const groups = new Map<string, (ObservationRecord | DecisionRecord)[]>();
  for (const event of events) {
    const shardKey = `${event.agentId}:${event.sessionId}:${event.writerId}`;
    if (!groups.has(shardKey)) groups.set(shardKey, []);
    groups.get(shardKey)!.push(event);
  }

  // Sort each shard stream by sequence
  const streams = Array.from(groups.values()).map(stream => 
    stream.sort((a, b) => a.sequence - b.sequence)
  );

  // K-way merge using timestamp -> shardId -> sequence
  const sorted: (ObservationRecord | DecisionRecord)[] = [];
  const indices = new Array(streams.length).fill(0);

  while (true) {
    let bestStreamIdx = -1;
    let bestVal: ObservationRecord | DecisionRecord | null = null;

    for (let i = 0; i < streams.length; i++) {
      if (indices[i] >= streams[i].length) continue;
      const val = streams[i][indices[i]];
      if (bestVal === null) {
        bestStreamIdx = i;
        bestVal = val;
      } else {
        const timeA = new Date(val.timestamp).getTime();
        const timeB = new Date(bestVal.timestamp).getTime();
        if (timeA !== timeB) {
          if (timeA < timeB) {
            bestStreamIdx = i;
            bestVal = val;
          }
        } else {
          const shardA = `${val.agentId}:${val.sessionId}:${val.writerId}`;
          const shardB = `${bestVal.agentId}:${bestVal.sessionId}:${bestVal.writerId}`;
          const shardComp = shardA.localeCompare(shardB);
          if (shardComp < 0) {
            bestStreamIdx = i;
            bestVal = val;
          } else if (shardComp === 0) {
            if (val.sequence < bestVal.sequence) {
              bestStreamIdx = i;
              bestVal = val;
            }
          }
        }
      }
    }

    if (bestStreamIdx === -1) break;
    sorted.push(bestVal!);
    indices[bestStreamIdx]++;
  }

  const maxSequenceByShard = new Map<string, number>();
  const tasks = new Map<string, { status: string; lastVerdict: string; evidence: ProjectedEvidence[]; observedReviewScopes: string[] }>();
  
  for (const event of sorted) {
    const shardKey = `${event.agentId}:${event.sessionId}:${event.writerId}`;
    const seq = event.sequence;
    const currentMax = maxSequenceByShard.get(shardKey) ?? -1;
    if (seq > currentMax) {
      maxSequenceByShard.set(shardKey, seq);
    }

    const ref = {
      agentId: event.agentId,
      sessionId: event.sessionId,
      writerId: event.writerId,
      sequence: event.sequence,
    };

    if (event.recordType === "observation") {
      const taskId = event.taskId;
      
      // Task evidence fold (D8/D20/D68)
      if (taskId) {
        if (!tasks.has(taskId)) {
          tasks.set(taskId, { status: "open", lastVerdict: "NONE", evidence: [], observedReviewScopes: [] });
        }
        const taskState = tasks.get(taskId)!;

        if (event.kind === "tool_executed" || event.kind === "message") {
          const recordWithEvidence = event as ToolExecutedRecord | MessageRecord;
          const evidenceList = toEvidenceArray(recordWithEvidence.evidence || []);
          for (const ev of evidenceList) {
            taskState.evidence.push({
              evidence: ev,
              ref: { ...ref, evidenceId: ev.evidenceId },
            });
          }
        } else if (event.kind === "review_observed") {
          if (event.reviewScope) {
            taskState.observedReviewScopes.push(event.reviewScope);
          }
        }
      }
    } else if (event.recordType === "decision") {
      const taskId = event.taskId;
      if (taskId) {
        if (!tasks.has(taskId)) {
          tasks.set(taskId, { status: "open", lastVerdict: "NONE", evidence: [], observedReviewScopes: [] });
        }
        const taskState = tasks.get(taskId)!;
        taskState.lastVerdict = event.verdict; // WARN/FAIL/PASS
        taskState.status = event.verdict; // Update status to match test expectations (PASS/FAIL/WARN)
      }
    }
  }

  // Review aggregator fold (D11/D32/D66/D57) - Stub for Phase 2 to prevent compilation errors. To be implemented in Task 6.2.
  const reviewSummary: ReviewSummary = {
    authority: "observed_review_output",
    critical: [],
    major: [],
    minor: [],
    resolved: [],
    open: [],
    byScope: new Map(),
  };

  return {
    schemaVersion: 1,
    rebuiltAt,
    integrity: {
      sourceHash: hashString(sorted.map((e) => JSON.stringify(e)).join("\n")),
      maxSequenceByShard,
    },
    tasks,
    reviewSummary,
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

export function fromSerializableProjectedState(obj: unknown): ProjectedState {
  const raw = obj as Record<string, any>;
  return {
    ...raw,
    integrity: {
      ...raw.integrity,
      maxSequenceByShard: new Map(Object.entries(raw.integrity.maxSequenceByShard)),
    },
    tasks: new Map(Object.entries(raw.tasks)),
    reviewSummary: {
      ...raw.reviewSummary,
      byScope: new Map(
        Object.entries(raw.reviewSummary.byScope).map(([k, v]: [string, unknown]) => [k, v])
      ),
    },
  } as unknown as ProjectedState;
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

`ObservationLogStore` / `observation-handler` は projection 再構築後に `StateProjectionCache.write(state)` を呼び出す。書込失敗は fail-open で無視する。また、起動時に `StateProjectionCache.read()` を呼び出し、得られたキャッシュの `integrity`（`sourceHash` および `maxSequenceByShard`）を、実際の `readAll()`結果から構築した `currentIntegrity`（実際のイベント群のハッシュおよび各 shard の最大シーケンス）と検証・比較する。キャッシュ不一致（欠損、破損、schema 不一致、`sourceHash` の乖離、あるいは `maxSequenceByShard` の不一致検知時）の場合はキャッシュを破棄し（`undefined` として扱い）、event log から再構築（rebuild）を行う。ただし、`sourceHash` 乖離による再構築は、通常のイベント追記に伴う自然なキャッシュの stale 状態であるため、WARN や corruption/tamper 警告を出さずに静かに再構築（silent rebuild）を行う。一方、`maxSequenceByShard` 不一致や構造破損・スキーマ不正検知時は警告（WARN）を出した上で再構築を行う。

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
import type { ObservationRecord, DecisionRecord } from "../../src/core/v2/observation-model.ts";

describe("FF-004 replay determinism and state validation", () => {
  it("same events produce same state and correctly map taskId, decision records, and reviews", () => {
    const events: (ObservationRecord | DecisionRecord)[] = [
      {
        schemaVersion: 1,
        sequence: 1,
        timestamp: "2026-06-28T12:00:00Z",
        agentId: "atlas",
        sessionId: "session-123",
        writerId: "w1",
        recordType: "observation",
        kind: "tool_executed",
        toolName: "task",
        callId: "c1",
        taskId: "task-1",
        evidence: [
          {
            evidenceId: "ev-1",
            kind: "test",
            sourceClass: "tool_output",
            toolOutputClass: "command_exec",
            interpretation: {
              outcome: "pass",
              provenance: "derived",
              basis: "parsed_output",
              derivedFrom: []
            }
          }
        ]
      },
      {
        schemaVersion: 1,
        sequence: 2,
        timestamp: "2026-06-28T12:01:00Z",
        agentId: "atlas",
        sessionId: "session-123",
        writerId: "w1",
        recordType: "decision",
        taskId: "task-1",
        verdict: "PASS",
        ruleResults: [
          {
            ruleId: "gate-1",
            verdict: "PASS",
            reason: "All tests passed",
            evidenceRefs: [{ agentId: "atlas", sessionId: "session-123", writerId: "w1", sequence: 1, evidenceId: "ev-1" }]
          }
        ]
      },
      {
        schemaVersion: 1,
        sequence: 1,
        timestamp: "2026-06-28T12:00:30Z",
        agentId: "prometheus",
        sessionId: "session-123",
        writerId: "w2",
        recordType: "observation",
        kind: "review_observed",
        reviewScope: "scope-1",
        items: [
          {
            itemKey: "item-1",
            severity: "major",
            status: "open",
            message: "Need style fix",
            location: "file.ts"
          }
        ]
      }
    ];

    const a = project(events, "2026-06-28T12:05:00Z");
    const b = project(events, "2026-06-28T12:05:00Z");
    
    // 決定論の検証
    expect(a).toEqual(b);

    // 判定状態・複数 shard の検証
    const taskInfo = a.tasks.get("task-1");
    expect(taskInfo).toBeDefined();
    expect(taskInfo?.status).toBe("PASS");
    expect(taskInfo?.evidence.length).toBe(1);
    
    // Review Item の検証
    const reviewData = a.reviewSummary.byScope.get("scope-1");
    expect(reviewData).toBeDefined();
    expect(reviewData?.open.some(x => x.itemKey === "item-1")).toBe(true);
  });
});
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/state-projection.test.ts tests/core/observation-log-replay.test.ts tests/runtime/state-projection-cache-read.test.ts tests/runtime/state-projection-cache.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/v2/state-projection.ts src/core/v2/integrity.ts src/runtime/state-projection-cache.ts tests/core/v2/state-projection.test.ts tests/core/observation-log-replay.test.ts tests/runtime/state-projection-cache-read.test.ts tests/runtime/state-projection-cache.test.ts
git commit -m "feat(v2): deterministic state projection, replay, and cache validation tests"
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

- [ ] **Step 3: rotation 後の sequence 連続性と直列化キューとの結合を実装（D23/D33）**

active+archive の最大 sequence を計算し、次回 append からその値+1 を使用。
`ObservationLogStore` は `createShardWriteQueue` の `onAppendComplete` 引数として `rotateIfNeeded` を渡し、書き込み完了直後かつ Promise が resolve される前に、同一直列化キュー内で rotation が判定・実行されることを保証する。

- [ ] **Step 4: rotation 統合テストの実装（tests/runtime/rotation-sequence-continuity.test.ts）**

以下のテストを追加して、append と rotation が並行せずに直列実行され、かつ rotation 跨ぎで sequence が決定論的に継続することを確認する。

```typescript
it("performs rotation inside the serialization queue after append and prevents race conditions", async () => {
  // append 中に rotation が同期的に実行され、同時に発生した他の append がキューで待機し、順序が保証されることを検証するテストケースを実装
});

it("succeeds rotation even when the archive parent directory does not exist initially", async () => {
  // 保存先であるアーカイブ用の親ディレクトリ（.justice/archive/events/...）がまだ存在しない場合でも、
  // rotation処理内で親ディレクトリが自動的かつ再帰的に作成され、移動（rename）が成功することを検証する
});
```

- [ ] **Step 5: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/rotation-sequence-continuity.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/runtime/node-file-system.ts tests/helpers/mock-file-system.ts src/runtime/observation-log-store.ts tests/runtime/rotation-sequence-continuity.test.ts
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

- Create: `src/runtime/message-role-buffer.ts` (Core 純粋性を維持するため、mutable なバッファは runtime 配下に配置する)
- Modify: `src/core/v2/declared-claim-extractor.ts`（finalized 後の抽出ロジックおよび純粋関数を定義）
- Test: `tests/runtime/message-role-buffer.test.ts`

**Interfaces:**

- Consumes: `ObservationMessagePayload` union (from Task 1.1), `extractDeclaredClaims`.
- Produces:
  - `MessageRoleBuffer` class (in `src/runtime/`) with `{sessionId, messageID}` key, `parts: Map<partID, {text, finalized}>`.
  - `extractFinalizedAssistantClaims(buffer, messageID, partID): DeclaredClaim[]` (implemented in `src/core/v2/declared-claim-extractor.ts` as a pure function).

- [ ] **Step 1: Message payload union を確認（D71）**
  - Task 1.1 で前倒し実装した `src/core/v2/message-payload.ts` の `ObservationMessagePayload` をそのままインポートして利用できることを確認します。

- [ ] **Step 1b: `observation-model.ts` の `MessageRecord` を詳細化（D71）**

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

- [ ] **Step 2: MessageRoleBuffer を実装（D53/D65/D67）**

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

- [ ] **Step 2.5: MessageRoleBuffer の D67 確定・重複排除（dedup）および role フィルタリングのテスト実装**
  - `tests/hooks/message-role-buffer.test.ts` にテストケースを追加し、同一 `(sessionId, messageId, partId)` でストリーミング中に一度「tests pass」と判定された後、同じ partId の更新テキストにより「tests fail」へと修正された場合、あるいはその逆において、最終確定（finalize/finish）時に古い claim が残らず最新の確定状態に基づく claim に正しく置換されること（重複排除）を担保する。
  - さらに、roleが未確定の場合、user roleの場合、あるいはclaimsが空の場合における `extractAssistantClaims` / `getFinalizedAssistantText` の挙動をテストで検証し、これらにおいて空配列または `undefined` が返されることを確認するテストを追加する。

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/message-role-buffer.test.ts tests/core/v2/message-payload.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/observation-model.ts src/core/v2/message-role-buffer.ts tests/hooks/message-role-buffer.test.ts
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
- Modify: `src/core/types.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts`

**Interfaces:**

- Consumes: `ObservationMessagePayload` from Task 1.1, `ObservationLogStore` from Phase 2, existing `HookEvent` types from `src/core/types.ts`, `allocateWriterId` from Task 2.1.
- Produces:
  - `ToolObservationPayload` type: `{ toolName: string; callId: string; args?: Record<string, unknown>; output?: { output?: string; metadata?: Record<string, unknown> }; error?: boolean }`.
  - `onToolExecuteBefore/After` no longer filters `tool !== "task"` but explicitly excludes query tools matching `justice_*`; all other tools are converted to `ToolObservationPayload` and forwarded to `JusticePlugin.handleEvent` as `PreToolUse` / `PostToolUse` events to prevent query commands from altering the canonical Observation Log (D50).
  - `onMessage` / `onMessagePartUpdated` / `onTextComplete` hooks produce `ObservationMessagePayload` and forward to `JusticePlugin.handleEvent({ type: "Message" })` alongside the existing user-message path (handled in Task 3.3).
  - Triggers `AgentMapped` event forwarding when observing `agent` property in message parameters (`chat.params` / `chat.message`) (D48, FIND-001).
  - `onSessionError` forwards to `JusticePlugin.handleEvent({ type: "Event", event: "session.error" })`.
  - Captures `HookResponse` from `handleEvent` and applies `injectedContext` / notifier banner / best-effort `output.output` append in deterministic handler order (D47/D64).
  - Sets the default value of `options.enableAdvisoryOutputAppend` based on C1 spike results (Task 0.2 Step 1b). If C1 shows banner is not visible in user-facing context, it defaults to false; otherwise true (D47).
  - Step 1 implementation includes tests asserting that when `options.enableAdvisoryOutputAppend` is false, `notifier.notify()` executes normally while `output.output` remains unmodified (D47).
  - Bootstraps global unique `writerId` dynamically resolved during initialization and injects it into both `ObservationLogStore` and `ObservationHandler` via `JusticePluginOptions` to satisfy structural invariants (D55/D39/指摘3).

- [ ] **Step 0: Define `ToolObservationPayload` and adapter conversion helpers, and update `src/core/types.ts` & `src/core/justice-plugin.ts` (ISS-002)**

Update `PostToolUsePayload` and `PreToolUsePayload` in `src/core/types.ts` to include the fields the adapter now forwards: `callId`, `toolInput` (Pre/Post), `toolResult`, and `metadata` (Post).
Also add `AgentMappedEvent` type to `src/core/types.ts` and include it in the `HookEvent` union type.
In `src/core/justice-plugin.ts` (`handleEvent`), add a fallback handling case for `"AgentMapped"` to proceed without error until its state mapping is fully implemented in Task 3.4. This keeps `observation-handler` type-safe and avoids compilation errors.
In `src/core/justice-plugin.ts` `JusticePluginOptions`, add an optional field `writerId?: string`.

- [ ] **Step 0b: Runtime/bootstrap 初期化配線と `writerId` の割当（D55/D39/指摘3）**

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
  writerId, // Inject the dynamically allocated writerId
});
```
これにより、`ObservationLogStore` と `ObservationHandler` で同一の `writerId` が配線されることを保証する。テスト `tests/runtime/opencode-adapter-v2.test.ts` で起動時に同一の `writerId` が配線されることを確認する。

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
      metadata: { error: output.metadata?.error === true },
    },
  };
}
```

- [ ] **Step 1: 既存 adapter の tool フィルタを撤廃**

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

- [ ] **Step 2: message / session.error イベントを追加（既存 user message 経路は維持し、状態確定イベントを分離）**

```typescript
onMessagePartUpdated: async (event) => {
  await this.plugin.handleEvent({ type: "Message", payload: { kind: "message_part_updated", sessionId: event.sessionId, messageID: event.messageID, partID: event.partID, text: event.text } });
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
  await this.plugin.handleEvent({
    type: "Message",
    payload: {
      kind: "message_updated",
      sessionId: event.sessionId,
      messageID: event.messageID,
      role: event.message.role,
      finalized: isFinalized
    }
  });
},
// ...
```

`onMessage`（`message.updated`）は既存の `{ role, content }` 形式の `MessageEvent` ではなく、メタデータ伝播のために `kind: "message_updated"` を含む `ObservationMessagePayload` として `JusticePlugin.handleEvent` に送出します。一方で、plan-bridge の委譲トリガーを維持するための `role`/`content` 形式の user message 経路は別途維持されます。

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
  - `Message`: routed selectively based on payload type: UserMessage is forwarded to `planBridge.handleMessage(event)` (existing delegation triggers), while helper observation payloads are forwarded to `observationHandler.handleMessage(payload)` (declared claim extraction).
  - `Event`: existing handlers unchanged.

- [ ] **Step 0: Add `mergePreToolUseResponses` and `mergePostToolUseResponses` helpers**

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
        // D64: modifiedPayload 衝突時はログを出して最初のものを使用
        console.warn("Conflict detected in post-tool-use modifiedPayload. Using the first one.");
      }
      return { ...result, modifiedPayload: modifieds[0].modifiedPayload };
    }
    return result;
  }
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
      const obs = await this.observationHandler.handleMessage(payload as ObservationMessagePayload).catch((err) => {
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

- [ ] **Step 2: observation-handler stub を作成（`ToolUsePayload` 以外も受け取れるよう拡張）**

```typescript
// src/hooks/observation-handler.ts
export class ObservationHandler {
  async handlePreToolUse(event: PreToolUseEvent): Promise<HookResponse> { return { action: "proceed" }; }
  async handlePostToolUse(event: PostToolUseEvent): Promise<HookResponse> { return { action: "proceed" }; }
  async handleMessage(event: MessageEvent): Promise<HookResponse> { return { action: "proceed" }; }
}
```

- [ ] **Step 2b: PostToolUse マージテスト（tests/core/v2/post-tool-use-merge.test.ts）の実装（D64）**

```typescript
// tests/core/v2/post-tool-use-merge.test.ts
import { describe, expect, it, vi } from "vitest";
import { mergePostToolUseResponses } from "../../../src/core/justice-plugin";

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

  it("should use the first modifiedPayload when conflicts occur and log warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const responses = [
      { action: "inject" as const, injectedContext: "A", modifiedPayload: { toolName: "task", modified: 1 } },
      { action: "inject" as const, injectedContext: "B", modifiedPayload: { toolName: "task", modified: 2 } }
    ];
    const result = mergePostToolUseResponses(responses);
    expect(result.action).toBe("inject");
    expect((result as unknown as { modifiedPayload: unknown }).modifiedPayload).toEqual({ toolName: "task", modified: 1 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Conflict detected"));
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/justice-plugin-routing.test.ts tests/core/v2/post-tool-use-merge.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/justice-plugin.ts src/hooks/observation-handler.ts tests/core/justice-plugin-routing.test.ts tests/core/v2/post-tool-use-merge.test.ts
git commit -m "feat(v2): JusticePlugin routing guard for all tools + observation handler + merge tests"
```

- [ ] **Step 5: Phase 3 Base に向けた Draft PR を作成する**

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
  - `sessionStateProvider.getActiveTaskId(sessionId): string | undefined`

- [ ] **Step 1: SessionStateProvider の実装（D48/D74）**
  - アダプター側で検知・抽出された `AgentMapped` ペイロードを受け取り、`sessionId` から `agentId` (ObservationAgentId) へのマッピングを構築・保持する。
  - OpenCode agent 名（自由文字列）から Justice `AgentId`（`atlas` / `hephaestus` / `sisyphus` / `prometheus`）への写像ロジックを実装し、マッピングできない場合は `unknown` とする。
  - セッションごとのアクティブな `taskId` の保存と取得（`setActiveTaskId(sessionId, taskId)` / `getActiveTaskId(sessionId)`）を実装する。

- [ ] **Step 2: routing イベントハンドラに AgentMapped イベント処理を追加**
  - `JusticePlugin.handleEvent` で `AgentMapped` イベント（ペイロード: `{ sessionId, agentName }`）を受信し、`SessionStateProvider` のマップを更新する。

- [ ] **Step 3: テストの実装（tests/core/agent-id-resolution.test.ts）**
  - `AgentMapped` イベントから `agentId` が正しく写像され、`SessionStateProvider` を経由して解決できることを検証する。
  - 不明なエージェントが `unknown` shard に落ちることを確認し、同時に wisdom namespace（4つのペルソナ）に `system` や `unknown` のデータが混入（汚染）しないことをテストで担保する。

- [ ] **Step 4: Commit & Submit**

```bash
git add src/core/justice-plugin.ts src/core/session-state-provider.ts tests/core/agent-id-resolution.test.ts
git commit -m "feat(v2): implement agentId resolution and session state mapping"
gt submit
```

**派生元:** `Task 3.3`

---

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
private async appendReviewObservationsIfDetected(shardId: ShardId, taskId: string | undefined, sessionId: string, callId: string, toolName: string, toolResult: string | undefined): Promise<void> {
  // Stub: implemented in Task 6.3
}
private async evaluateGateIfTriggered(trigger: "task_complete" | "tool_observed", taskId: string | undefined, agentId: string, sessionId: string): Promise<HookResponse> {
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
    await this.appendReviewObservationsIfDetected(shardId, taskId, event.sessionId, callId, payload.toolName, payload.toolResult);

    // 4. Update projected state and evaluate gates (strict evaluation sequence: append -> project -> evaluate)
    // D74: taskId is undefined for non-task tools unless explicitly correlated. If taskId is undefined, evaluation is skipped early.
    if (payload.toolName === "task" && taskId) {
      const taskGateResponse = await this.evaluateGateIfTriggered("task_complete", taskId, agentId, event.sessionId);
      if (taskGateResponse.action === "inject") {
        return taskGateResponse;
      }
    }
    if (taskId) {
      const gateResponse = await this.evaluateGateIfTriggered("tool_observed", taskId, agentId, event.sessionId);
      if (gateResponse.action === "inject") {
        return gateResponse;
      }
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
        if (claims.length > 0) { // Only log if claims exist, avoiding storing snippets for plain assistant messages (finding 6)
          const agentId = await this.resolveAgentId(payload.sessionId);
          const shardId = { agentId, sessionId: payload.sessionId, writerId: this.writerId };
          const envelope = this.buildEnvelope({ agentId, sessionId: payload.sessionId, recordType: "observation" });

          const record = buildMessageRecord(envelope, payload.messageID, partID, fullText, claims);
          await this.logStore.append(shardId, record);
        }
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
  - `detectSkillInvoked(toolName, args): { skillName, source }` (D10). Detects skills invoked via the `skill` tool and via `task` tool's `load_skills` argument.
  - `extractTaskSummaryClaims(output): DeclaredClaim[]` (D29/D62).
  - `appendTaskSummaryDeclaredEvidence(payload, taskId)` in `observation-handler.ts`, wrapped in `try/catch` and degrading to `PROCEED` on failure.
  - `detectSkillInvoked(toolName, args): { skillName, source }` (D10). Detects skills invoked via the `skill` tool and via `task` tool's `load_skills` argument.
  - `extractTaskSummaryClaims(output): DeclaredClaim[]` (D29/D62).

- [ ] **Step 1: skill 検出器を実装**

```typescript
// src/core/v2/skill-invoked-detector.ts
export function detectSkillInvoked(toolName: string, args: unknown, callId?: string): readonly { readonly skillName: string; readonly source: "skill_tool" | "task_load_skills"; readonly callId?: string }[] {
  const result: { skillName: string; source: "skill_tool" | "task_load_skills"; callId?: string }[] = [];
  if (toolName === "skill" && args && typeof args === "object" && "name" in args) {
    result.push({ skillName: args.name as string, source: "skill_tool", callId });
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
export function extractTaskSummaryClaims(output: string): DeclaredClaim[] {
  // transcript 含有でも declared 扱い（D62）。PASS 非算入。
  return extractDeclaredClaims(output).map((c) => ({ ...c, claimKind: c.claimKind }));
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
  try {
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
        summaryClaims = extractTaskSummaryClaims(summaryText);
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
    await this.appendReviewObservationsIfDetected(shardId, taskId, event.sessionId, callId, payload.toolName, payload.toolResult);

    // 3. Update projected state and evaluate gates (strict evaluation sequence: append -> project -> evaluate)
    if (payload.toolName === "task" && taskId) {
      this.activeTaskWindows.delete(callId);
      if (taskId) {
        this.sessionActiveTasks.get(event.sessionId)?.delete(taskId);
      }
      const taskGateResponse = await this.evaluateGateIfTriggered("task_complete", taskId, agentId, event.sessionId);
      if (taskGateResponse.action === "inject") {
        return taskGateResponse;
      }
    }
    if (taskId) {
      const gateResponse = await this.evaluateGateIfTriggered("tool_observed", taskId, agentId, event.sessionId);
      if (gateResponse.action === "inject") {
        return gateResponse;
      }
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

- [ ] **Step 1c: `observation-handler.ts` に `emitReflectionEvent` を実装**

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
- `planRef.path` が絶対パスであるか（`/` で始まる、あるいは Windows の `C:\` 等のドライブレターで始まる場合）またはディレクトリトラバーサル（`..` を含む場合）をバリデーターにより検証する。
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
  const isAbsolute = planRef.path.startsWith("/") || /^[a-zA-Z]:\\/.test(planRef.path);
  const hasTraversal = planRef.path.split(/[/\\]/).includes("..");
  if (isAbsolute || hasTraversal) {
    throw new Error(`Invalid plan path: Absolute path or traversal detected: ${planRef.path}`);
  }
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

- Consumes: `zod`（Task 5.1 にてプロジェクトへ追加し、スキーマ定義とバリデーションを一貫して zod で実装する）。
- Produces:
  - `GateRule` type with `id`, `gateType`, `trigger`, `check`, `onViolation`, `onMissingEvidence`, `enabled`.
  - `check.type ∈ { "evidence_outcome", "evidence_present", "review_open_items" }`.
  - `parseGateYaml(yaml: string): GateRule[]`.

- [ ] **Step 0: 依存パッケージ `yaml` および `zod` を追加**

```bash
bun add yaml zod
```

- [ ] **Step 1: `GateRule` 型と zod スキーマを定義**

```typescript
// src/core/v2/gate-definition.ts
import { z } from "zod";

export const GateCheckSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evidence_outcome"),
    evidenceKind: z.enum(["test", "build", "lint"]),
    requireOutcome: z.enum(["pass", "fail"]),
  }),
  z.object({
    type: z.literal("evidence_present"),
    evidenceKind: z.enum(["test", "build", "lint"]),
  }),
  z.object({
    type: z.literal("review_open_items"),
    minimumSeverity: z.enum(["critical", "major", "minor"]).default("major"),
  }),
]);

export const GateRuleSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  gateType: z.literal("task"),
  trigger: z.object({
    on: z.enum(["task_complete", "tool_observed"]),
  }),
  check: GateCheckSchema,
  onViolation: z.enum(["pass", "warn", "fail"]),
  onMissingEvidence: z.enum(["pass", "warn", "fail"]),
  enabled: z.boolean().default(true),
});

export type GateCheck = z.infer<typeof GateCheckSchema>;
export type GateRule = z.infer<typeof GateRuleSchema>;
```

- [ ] **Step 2: YAML parser / validator を実装**

```typescript
// src/core/v2/gate-yaml-parser.ts
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { GateRuleSchema, type GateRule } from "./gate-definition.ts";

const GateConfigSchema = z.object({
  schemaVersion: z.literal(1),
  authority: z.literal("human_approved"),
  authorship: z.null().optional(),
  gates: z.array(GateRuleSchema),
});

export function parseGateYaml(content: string): readonly GateRule[] {
  const parsed = parseYaml(content);
  const validated = GateConfigSchema.parse(parsed);
  return validated.gates;
}
```
// (注: 設計通り Zod スキーマ `GateConfigSchema.parse(parsed)` によって一貫してバリデーションと型キャストを行うため、上記のような手動の normalize / validate 関数群は実装不要です。Zod に検証と型解決を委ねるように実装してください。)

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/gate-definition.test.ts tests/core/v2/gate-yaml-parser.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/core/v2/gate-definition.ts src/core/v2/gate-yaml-parser.ts tests/core/v2/gate-definition.test.ts tests/core/v2/gate-yaml-parser.test.ts
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
    readonly byScope: ReadonlyMap<string, {
      readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef }[];
      readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef }[];
      readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef }[];
      readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef }[];
      readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    }>;
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
  evidence: readonly ProjectedEvidence[],
  ctx: GateContext
): (Verdict & { readonly gateType: "task" }) | { readonly verdict: "SKIP"; readonly reason: string } {
  if (ctx.taskId === undefined) {
    return { verdict: "SKIP", reason: "no taskId provided" };
  }
  const activeGates = gates.filter((g) => g.enabled && g.trigger.on === ctx.trigger);
  if (activeGates.length === 0) {
    // 指摘2: 一致する有効なゲートが0件の場合はSKIPとし、DecisionRecordを永続化しない
    return { verdict: "SKIP", reason: `no matching active gates found for trigger: ${ctx.trigger}` };
  }
  const ruleResults = activeGates.map((g) => evaluateRule(g, evidence, ctx));
  const verdict = worstOf(ruleResults.map((r) => r.verdict));
  return { verdict, gateType: "task", reachableEnforcementLevel: "L1", appliedEnforcementLevel: "L0", ruleResults };
}

function evaluateRule(gate: GateRule, evidence: readonly ProjectedEvidence[], ctx: GateContext): RuleResult {
  const mapVerdict = (v: "pass" | "warn" | "fail"): "PASS" | "WARN" | "FAIL" => {
    return v.toUpperCase() as "PASS" | "WARN" | "FAIL";
  };

  const worstResult = (v1: "PASS" | "WARN" | "FAIL", v2: "PASS" | "WARN" | "FAIL") => {
    if (v1 === "FAIL" || v2 === "FAIL") return "FAIL";
    if (v1 === "WARN" || v2 === "WARN") return "WARN";
    return "PASS";
  };

  const check = gate.check;

  if (check.type === "evidence_present") {
    // observed / derived 起源の証跡のみ PASS 対象とする。declared 単体は onMissingEvidence or WARN (FF-008/FF-007)
    const matching = evidence.filter(e => e.evidence.kind === check.evidenceKind && (e.evidence.provenance === "observed" || e.evidence.provenance === "derived"));
    if (matching.length > 0) {
      return { ruleId: gate.id, verdict: "PASS", reason: `Authoritative evidence of kind '${check.evidenceKind}' is present.`, evidenceRefs: matching.map(e => e.ref) };
    }
    return {
      ruleId: gate.id,
      verdict: mapVerdict(gate.onMissingEvidence),
      reason: `Required evidence of kind '${check.evidenceKind}' is missing or has declared provenance only.`,
      evidenceRefs: []
    };
  }

  if (check.type === "evidence_outcome") {
    const matching = evidence.filter(e => e.evidence.kind === check.evidenceKind);
    if (matching.length === 0) {
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onMissingEvidence),
        reason: `Evidence of kind '${check.evidenceKind}' is missing.`,
        evidenceRefs: []
      };
    }
    
    // observed / derived 起源のみ PASS 可能 (FF-008/FF-007)
    // declared-only は onMissingEvidence、outcome 違反 (fail) は onViolation
    let hasAuthoritativePass = false;
    let ruleVerdict: "PASS" | "WARN" | "FAIL" = "PASS";
    const invalidRefs: EvidenceRef[] = [];
    const matchedRefs: EvidenceRef[] = [];
    for (const ev of matching) {
      matchedRefs.push(ev.ref);
      const isAuthoritative = ev.evidence.provenance === "observed" || ev.evidence.provenance === "derived";
      const outcome = ev.evidence.sourceClass === "tool_output"
        ? ev.evidence.interpretation?.outcome
        : ev.evidence.claim.outcome;
        
      const expectedOutcome = check.type === "evidence_outcome" ? check.requireOutcome : "pass";
      if (isAuthoritative && outcome === expectedOutcome) {
        hasAuthoritativePass = true;
      }
      
      if (isAuthoritative && outcome !== expectedOutcome) {
        ruleVerdict = worstResult(ruleVerdict, mapVerdict(gate.onViolation));
        invalidRefs.push(ev.ref);
      }
    }
    
    if (!hasAuthoritativePass && ruleVerdict === "PASS") {
      // declared-only: onMissingEvidence (FF-008)
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onMissingEvidence),
        reason: `No authoritative (observed/derived) passing evidence found for kind '${check.evidenceKind}'.`,
        evidenceRefs: matchedRefs
      };
    }

    return {
      ruleId: gate.id,
      verdict: ruleVerdict,
      reason: ruleVerdict !== "PASS" ? `Some evidence did not meet required outcome '${check.requireOutcome}' or was declared only.` : undefined,
      evidenceRefs: ruleVerdict !== "PASS" ? invalidRefs : matchedRefs
    };
  }

  if (check.type === "review_open_items") {
    if (ctx.reviewScope.length === 0) {
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onMissingEvidence),
        reason: `Review scope is empty. No review observed yet.`,
        evidenceRefs: []
      };
    }

    let anyObserved = false;
    const openItems: { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[] = [];
    for (const scope of ctx.reviewScope) {
      const scopeData = ctx.reviewSummary?.byScope?.get(scope);
      if (scopeData) {
        anyObserved = true;
        for (const item of scopeData.open) {
          // severity 閾値 (minimumSeverity) に基づくフィルタリング
          if (isSeverityAtLeast(item.severity, check.minimumSeverity)) {
            openItems.push(item);
          }
        }
      }
    }

    if (!anyObserved) {
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onMissingEvidence),
        reason: `No review observations found for scopes: ${ctx.reviewScope.join(", ")}.`,
        evidenceRefs: []
      };
    }

    if (openItems.length === 0) {
      return { ruleId: gate.id, verdict: "PASS", reason: "No open review items matching minimum severity found.", evidenceRefs: [] };
    }

    return {
      ruleId: gate.id,
      verdict: mapVerdict(gate.onViolation),
      reason: `Found ${openItems.length} open review items matching minimum severity '${check.minimumSeverity}'.`,
      evidenceRefs: openItems.map(i => i.ref)
    };
  }

  return { ruleId: gate.id, verdict: "FAIL", reason: `Unknown gate check type: ${(check as any).type}`, evidenceRefs: [] };
}

function isSeverityAtLeast(itemSeverity: "critical" | "major" | "minor", minSeverity: "critical" | "major" | "minor"): boolean {
  const levels = { "minor": 0, "major": 1, "critical": 2 };
  return levels[itemSeverity] >= levels[minSeverity];
}

function worstOf(verdicts: readonly ("PASS" | "WARN" | "FAIL")[]): "PASS" | "WARN" | "FAIL" {
  if (verdicts.includes("FAIL")) return "FAIL";
  if (verdicts.includes("WARN")) return "WARN";
  return "PASS";
}
```

- [ ] **Step 2b: rule evaluation engine skip test（D68）を実装**

```typescript
// tests/core/v2/rule-evaluation-engine.test.ts
it("skips task gate evaluation when taskId is undefined (no active task window)", () => {
  // 1. Setup a GateContext with trigger: "tool_observed" and taskId: undefined
  // 2. Call evaluate() and verify that it returns { verdict: "SKIP", reason: "no taskId provided" }
  // 3. Ensure no DecisionRecord is generated or appended for this evaluation
});
```

- [ ] **Step 3: provenance gating test（FF-008）を実装**


```typescript
// tests/core/v2/gate-provenance-gating.test.ts
it("declared evidence does not satisfy evidence_outcome", () => {
  // ...
});
```

- [ ] **Step 3b: review_open_items gate semantics test（D76）を実装**

```typescript
// tests/core/v2/rule-evaluation-engine.test.ts
it("evaluates review_open_items correctly with scopes and severity thresholds", () => {
  // Test cases:
  // 1. reviewScope=[] (empty scope): expect onMissingEvidence verdict.
  // 2. reviewScope with matching scope but no open items: expect PASS.
  // 3. reviewScope with open items of other scopes: expect no leakage (PASS if matching scope is clear).
  // 4. reviewScope with matching scope open items but severity below minimumSeverity threshold: expect PASS/WARN based on threshold config.
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
- Create: `templates/gate.yaml`（リポジトリテンプレート。runtime 読込時は `.justice/gate.yaml` へコピー/配備する。`.justice/*` は無視するが、人間承認済みの正本 `.justice/gate.yaml` を置けるよう `.gitignore` で例外設定する）
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
export function mergeWithDefaults(customGates: readonly GateRule[]): readonly GateRule[] {
  const mergedMap = new Map<string, GateRule>();
  for (const gate of DEFAULT_GATES) {
    mergedMap.set(gate.id, gate);
  }
  for (const custom of customGates) {
    const existing = mergedMap.get(custom.id);
    if (existing) {
      // Override attributes or disable (D6/D57)
      mergedMap.set(custom.id, { ...existing, ...custom });
    } else {
      // Add new custom gates
      mergedMap.set(custom.id, custom);
    }
  }
  return Array.from(mergedMap.values()).filter(g => g.enabled !== false);
}

export async function loadGates(fileReader: FileReader, path = ".justice/gate.yaml"): Promise<readonly GateRule[]> {
  const content = await fileReader.readFile(path).catch(() => null);
  if (!content) return DEFAULT_GATES.filter(g => g.enabled !== false);
  return mergeWithDefaults(parseGateYaml(content));
}
```

- [ ] **Step 3: `.gitignore` を更新し、テンプレート `templates/gate.yaml` を追加（ISS-007）**

`.gitignore` に `.justice/*` を追加して配下の自動生成ファイルやログを無視しつつ、正本としての `.justice/gate.yaml` が追跡対象に含まれるよう例外設定（`!.justice/gate.yaml` および `!.justice/`）を追加。テンプレート内容：

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

- [ ] **Step 3b: `tests/runtime/gate-loader.test.ts` に同一 id override / 新規追加 / enabled:false 無効化のテストを追加（ISS-007）**
  - 次のケースをカバーする Vitest テストケースを作成する：
    1. デフォルト gate のプロパティ（例: `onViolation`）が custom gate で override されること。
    2. 新規の `id` を持つ gate が追加され、`DEFAULT_GATES` にないルールとして認識されること。
    3. `enabled: false` に設定された gate が `mergeWithDefaults` の結果から排除（無効化）されること。

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
    
    // To ensure strict D60-76 evaluation sequence, we must load all events including the newly appended record
    const events = await this.logStore.readAll();
    const state = project(events, new Date().toISOString());
    // Silent cache write in background to update status check cache
    await this.projectionCache.write(state).catch(() => {});

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
    const decision: DecisionRecord = { ...this.buildEnvelope({ taskId, agentId, sessionId, recordType: "decision" }), ...verdict };
    await this.logStore.append(shardId, decision);

    // Refresh state projection with the new decision and update cache
    // Always readAll() after append to ensure we get the assigned sequence numbers
    const refreshedEvents = await this.logStore.readAll();
    const newState = project(refreshedEvents, new Date().toISOString());
    await this.projectionCache.write(newState).catch(() => {});

    if (verdict.verdict === "PASS") {
      return { action: "proceed" };
    }
    return { action: "inject", injectedContext: formatGateAdvisoryMessage(verdict), variant: "gate_advisory" };
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
> **Emoji Avoidance Rule:** `AGENTS.md` の「チャット上の絵文字重複の禁止」ルールに基づき、`formatGateAdvisoryMessage` の出力および `DEFAULT_GATES` の定義・ルール評価など、通知メッセージのテキスト本体には装飾用絵文字（✅/❌/🎯など）を含めず、`PASS` / `FAIL` / `WARN` などのプレーンテキスト表記のみを使用するように徹底すること。

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-gate.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/observation-handler.ts src/core/justice-notifier.ts src/core/v2/rule-evaluation-engine.ts tests/hooks/observation-handler-gate.test.ts
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
  readonly authorship?: null;
  readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly byScope: ReadonlyMap<string, {
    readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  }>;
};

export function aggregateReviews(records: readonly ObservationRecord[]): ReviewSummary {
  const byScopeMap = new Map<string, {
    readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  }>();

  // レコードを順方向に走査して最新 of 指摘・解決マーク状態を決定論的にマージする
  for (const record of records) {
    if (record.kind !== "review_observed") continue;
    const scope = record.reviewScope;
    if (!byScopeMap.has(scope)) {
      byScopeMap.set(scope, { critical: [], major: [], minor: [], resolved: [], open: [] });
    }
    let state = byScopeMap.get(scope)!;
    const ref: FullEvidenceRef = {
      agentId: record.agentId,
      sessionId: record.sessionId,
      writerId: record.writerId,
      sequence: record.sequence, // FIX: assign sequence from record (finding 4)
      evidenceId: "" // assigned dynamically per item
    };

    // 1. 新規の指摘アイテム (items) をマージ
    if (record.items) {
      for (const item of record.items) {
        const itemRef = { ...ref, evidenceId: item.itemKey };
        const entry = { itemKey: item.itemKey, ref: itemRef, severity: item.severity };

        // 一旦、既存の open, resolved, critical, major, minor リストから同一 itemKey のエントリを除外する (latest-review-wins)
        state = {
          ...state,
          open: state.open.filter(x => x.itemKey !== item.itemKey),
          resolved: state.resolved.filter(x => x.itemKey !== item.itemKey),
          critical: state.critical.filter(x => x.itemKey !== item.itemKey),
          major: state.major.filter(x => x.itemKey !== item.itemKey),
          minor: state.minor.filter(x => x.itemKey !== item.itemKey),
        };

        // D32: Do NOT resolve review items based on status: "resolved" within the items array.
        // All review items are added to 'open' by default, and resolution is strictly processed via
        // isCompleteSnapshot removal or explicit resolutionMarker presence to avoid "disappearance without evidence".
        state = {
          ...state,
          open: [...state.open, entry],
          critical: item.severity === "critical" ? [...state.critical, entry] : state.critical,
          major: item.severity === "major" ? [...state.major, entry] : state.major,
          minor: item.severity === "minor" ? [...state.minor, entry] : state.minor
        };
      }

      // complete snapshot (isCompleteSnapshot: true) の場合、本レコードの items に含まれない open 指摘は resolved へ遷移 (D32)
      if (record.isCompleteSnapshot) {
        const currentKeys = new Set(record.items.map(i => i.itemKey));
        const toResolve = state.open.filter(o => !currentKeys.has(o.itemKey));
        state = {
          ...state,
          open: state.open.filter(o => currentKeys.has(o.itemKey)),
          resolved: [...state.resolved, ...toResolve],
          critical: state.critical.filter(o => currentKeys.has(o.itemKey)),
          major: state.major.filter(o => currentKeys.has(o.itemKey)),
          minor: state.minor.filter(o => currentKeys.has(o.itemKey))
        };
      }
    }

    // 2. 明示的な解決マーカー (resolutionMarker) を処理
    if (record.resolutionMarker) {
      const markerKeys = new Set(record.resolutionMarker.map(m => m.itemKey));
      const toResolve = state.open.filter(o => markerKeys.has(o.itemKey));
      if (toResolve.length > 0) {
        state = {
          ...state,
          open: state.open.filter(o => !markerKeys.has(o.itemKey)),
          resolved: [...state.resolved, ...toResolve],
          critical: state.critical.filter(o => !markerKeys.has(o.itemKey)),
          major: state.major.filter(o => !markerKeys.has(o.itemKey)),
          minor: state.minor.filter(o => !markerKeys.has(o.itemKey))
        };
      }
    }
    byScopeMap.set(scope, state);
  }

  // グローバルサマリーの集計
  const critical: { itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];
  const major: { itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];
  const minor: { itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];
  const resolved: { itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];
  const open: { itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];

  for (const [_, scopeData] of byScopeMap) {
    critical.push(...scopeData.critical);
    major.push(...scopeData.major);
    minor.push(...scopeData.minor);
    resolved.push(...scopeData.resolved);
    open.push(...scopeData.open);
  }

  return {
    authority: "observed_review_output",
    critical,
    major,
    minor,
    resolved,
    open,
    byScope: byScopeMap
  };
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
  const openItems = summary.byScope.get("task-1")?.open ?? [];
  expect(openItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
  expect(openItems.find(i => i.itemKey === "major:foo")?.ref.evidenceId).toBe("major:foo");
});

it("marks item resolved on explicit marker", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", resolutionMarker: { itemKey: "major:foo", resolution: "explicit_marker" } }),
  ];
  const summary = aggregateReviews(records);
  const resolvedItems = summary.byScope.get("task-1")?.resolved ?? [];
  const openItems = summary.byScope.get("task-1")?.open ?? [];
  expect(resolvedItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
  expect(resolvedItems.find(i => i.itemKey === "major:foo")?.ref.evidenceId).toBe("major:foo");
  expect(openItems.find(i => i.itemKey === "major:foo")).toBeUndefined();
});

it("marks item resolved on complete snapshot absence", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", isCompleteSnapshot: true, items: [{ itemKey: "minor:bar", severity: "minor" }] }),
  ];
  const summary = aggregateReviews(records);
  const resolvedItems = summary.byScope.get("task-1")?.resolved ?? [];
  const openItems = summary.byScope.get("task-1")?.open ?? [];
  expect(resolvedItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
  expect(openItems).toContainEqual(expect.objectContaining({ itemKey: "minor:bar" }));
  expect(openItems.find(i => i.itemKey === "minor:bar")?.ref.evidenceId).toBe("minor:bar");
});

it("keeps item open when snapshot is not marked complete", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", isCompleteSnapshot: false, items: [{ itemKey: "minor:bar", severity: "minor" }] }),
  ];
  const summary = aggregateReviews(records);
  const openItems = summary.byScope.get("task-1")?.open ?? [];
  expect(openItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
});

it("marks item resolved on human artifact", () => {
  const records = [
    reviewObserved({ scope: "task-1", itemKey: "major:foo", severity: "major" }),
    reviewObserved({ scope: "task-1", resolutionMarker: { itemKey: "major:foo", resolution: "human_artifact", artifactRef: "docs/reviews/2026-06-26.md" } }),
  ];
  const summary = aggregateReviews(records);
  const resolvedItems = summary.byScope.get("task-1")?.resolved ?? [];
  expect(resolvedItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
  expect(resolvedItems.find(i => i.itemKey === "major:foo")?.ref.evidenceId).toBe("major:foo");
});
```

- [ ] **Step 2: state-projection に byScope マージを追加し、Phase 2 の最小 stub を aggregateReviews(reviewObservedEvents) 連携へ差し替える**

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
- Modify: `src/core/review-rejection-detector.ts` (add detectMultiple method)
- Test: `tests/hooks/observation-handler-review.test.ts`
- Test: `tests/core/review-rejection-detector.test.ts`

**Interfaces:**

- Consumes: `ReviewRejectionDetector.detectMultiple(output)`, `aggregateReviews`, `deriveReviewScope`.
- Produces:
  - `ObservationRecord{kind:"review_observed", reviewScope, items[], isCompleteSnapshot?}` append on task/PostToolUse outputs (now supporting multiple review items parsed from output).
  - `ObservationRecord{kind:"review_observed", reviewScope, resolutionMarker[]}` append when a human-approved resolution artifact is received.

- [ ] **Step 1: review scope 導出関数を確認・修正（§7.6）**
  - （※`deriveReviewScope` は Task 5.2 にて作成済みであるため、必要に応じて実装内容を確認し、追加要件があれば修正する）

- [ ] **Step 1b: `ReviewRejectionDetector.detectMultiple(output)` を実装し、複数指摘の分解に対応する**
  - 単一のシグナル抽出から、レビュー出力内に含まれる複数の指摘事項（severity, summary, location 含む）を正規表現や構造解析により分解し、`ReviewItem[]` にパースするメソッドを `ReviewRejectionDetector`（`src/core/review-rejection-detector.ts`）に追加し、そのテストを `tests/core/review-rejection-detector.test.ts` に追加する。

- [ ] **Step 2: Core 純粋ビルダーに review_observed / resolution 構築関数を追加（src/core/v2/record-builder.ts）**

```typescript
// src/core/v2/record-builder.ts に追加
export function buildReviewObservedRecord(
  envelope: CommonEnvelope,
  reviewScope: string,
  items: readonly ReviewItem[],
  isCompleteSnapshot: boolean = false
): ObservationRecord {
  return {
    ...envelope,
    recordType: "observation",
    kind: "review_observed",
    reviewScope,
    isCompleteSnapshot,
    items,
  };
}

export function buildReviewResolutionRecord(
  envelope: CommonEnvelope,
  reviewScope: string,
  itemKeys: string[],
  artifactRef: string
): ObservationRecord {
  return {
    ...envelope,
    recordType: "observation",
    kind: "review_observed",
    reviewScope,
    resolutionMarker: itemKeys.map((itemKey) => ({
      itemKey,
      resolution: "human_artifact" as const,
      artifactRef,
    })),
    items: [],
  };
}
```

- [ ] **Step 2b: PostToolUse 時に review_observed を生成・append（通常観測）**
  - `ReviewRejectionDetector.detectMultiple` を用いて、見つかったすべての指摘アイテムを `items` に含めて記録します。レコード構築は `buildReviewObservedRecord`（純粋関数）に委譲します。

```typescript
// src/hooks/observation-handler.ts 内に `appendReviewObservationsIfDetected` メソッドを実装
private async appendReviewObservationsIfDetected(shardId: ShardId, taskId: string | undefined, sessionId: string, callId: string, toolName: string, toolResult: string | undefined): Promise<void> {
  try {
    const items = ReviewRejectionDetector.detectMultiple(toolResult ?? "");
    if (items.length > 0) {
      const reviewScope = deriveReviewScope({ taskId, sessionId, callId, toolName });
      const envelope = this.buildEnvelope({
        taskId,
        agentId: shardId.agentId,
        sessionId,
        recordType: "observation",
      });
      const record = buildReviewObservedRecord(envelope, reviewScope, items);
      await this.logStore.append(shardId, record);
    }
  } catch (err) {
    this.logger.warn("observation-handler: review_observed generation failed", err);
  }
}
```

- [ ] **Step 2c: 人間承認 artifact 解決マーカー経路を追加（D32 seam）**
  - レコード構築は `buildReviewResolutionRecord` に委譲します。

```typescript
// src/hooks/observation-handler.ts 内（将来の拡張用 seam）
private async handleReviewResolutionArtifact(payload: { agentId: ObservationAgentId; sessionId: string; reviewScope: string; itemKeys: string[]; artifactRef: string }): Promise<HookResponse> {
  try {
    const envelope = this.buildEnvelope({
      agentId: payload.agentId,
      sessionId: payload.sessionId,
      recordType: "observation",
    });
    const record = buildReviewResolutionRecord(envelope, payload.reviewScope, payload.itemKeys, payload.artifactRef);
    const shardId = { agentId: payload.agentId, sessionId: payload.sessionId, writerId: this.writerId };
    await this.logStore.append(shardId, record);
  } catch (err) {
    this.logger.warn("observation-handler: review resolution marker failed", err);
  }
  return { action: "proceed" };
}
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-review.test.ts tests/core/review-rejection-detector.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/review-scope.ts src/core/v2/record-builder.ts src/hooks/observation-handler.ts src/core/review-rejection-detector.ts tests/hooks/observation-handler-review.test.ts tests/core/review-rejection-detector.test.ts
git commit -m "feat(v2): review_observed generation using record-builder and multi-item detection"
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

## Phase 8: Fitness Functions + NFR Tests

**Base Branch:** `feature/phase8-v2-fitness-nfr__base`

**目的:** 設計書で定義された Architecture Fitness Functions（FF-001〜008）と NFR（並行性・セキュリティ・integrity）のテストを実装し、CI 必須 check として登録。本 Phase だけで品質担保テスト群が完成する。設計書 §9.3.1 の Runtime 統合テスト（`record sub-entity refs` 含む）も含める。

**判断:** Phase 8 は全ての先行 Phase を横断的に検証。各テストを蓄積した状態で最終回帰テスト（Task 8.7）を実行する必要があるため、Graphite Stacking の原則に従い、Task 8.1〜8.7 は前段の Task から順に派生させて積層（Stack）する。Phase 8 Base は `feature/phase7-task3-justice-review` から切り、Task 8.1 は Base から、Task 8.2 は 8.1 からという形で順次派生させる。

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
git add package.json bun.lock tests/arch/core-no-opencode-imports.test.ts
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

**派生元:** `Task 8.1`（直前 Task から派生）。

---

### Task 8.3: FF-005 No plan.md Write (FF-004 is verified in Task 2.3)

**Files:**

- Create: `tests/arch/no-planmd-write.test.ts`

**Interfaces:**

- Consumes: `FileWriter` mock, `src/hooks/` file list, historical `ObservationRecord` log structures.
- Produces:
  - Allowlist-based plan.md write check.

- [ ] **Step 1: FF-005 allowlist test を実装（D7/FF-005）**

```typescript
// tests/arch/no-planmd-write.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function getFiles(dir: string): string[] {
  const files: string[] = [];
  if (readdirSync === undefined) return files;
  const items = readdirSync(dir);
  for (const item of items) {
    const path = join(dir, item);
    if (statSync(path).isDirectory()) {
      files.push(...getFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("FF-005", () => {
  it("new spine does not call writeFile or write files in unauthorized hooks", () => {
    // allowlist: task-feedback.ts and loop-handler.ts are allowed to write plan.md
    const allowed = [
      "src/hooks/task-feedback.ts",
      "src/hooks/loop-handler.ts"
    ];
    const files = getFiles("src/hooks");
    for (const file of files) {
      if (allowed.some(a => file.replace(/\\/g, "/").endsWith(a))) continue;
      const content = readFileSync(file, "utf-8");
      
      // 変数経由（writeFile(planPath, ...) 等）も含め、allowlist 以外の hooks に 
      // FileWriter.writeFile の呼び出し（.writeFile(）が存在しないことを検証
      expect(content).not.toMatch(/\.writeFile\s*\(/);
    }
  });
});
```

- [ ] **Step 2: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/arch/no-planmd-write.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/arch/no-planmd-write.test.ts
git commit -m "test(v2): FF-005 no plan.md write"
```

- [ ] **Step 4: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 8.2`（直前 Task から派生）。

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

**派生元:** `Task 8.3`（直前 Task から派生）。

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

**派生元:** `Task 8.4`（直前 Task から派生）。

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
  expect(written).not.toContain("user:token");
  expect(written).not.toContain("https://user:token@");
  expect(written).not.toContain("sk-abc123");
  expect(written).toContain("[REDACTED_PATH]");
  expect(written).toContain("[REDACTED_ENV]");
  expect(written).toContain("[REDACTED_TOKEN_URL]");
});
```

- [ ] **Step 2: integrity test を実装（D72）**

```typescript
// tests/runtime/observation-log-integrity.test.ts
it("validates record schema for all kinds and throws error for invalid fields or unknown kinds", () => {
  // 1. Verify validateRecordSchema throws for missing common envelope
  // 2. Verify validateRecordSchema works for all valid kinds (tool_executed, review_observed, message, skill_invoked, session_error, reflection)
  // 3. Verify validateRecordSchema throws for unknown kinds or missing mandatory properties per kind
});
it("rebuilds state.json on sequence inversion (e.g. sequence 3, 2, 4 in physical order)", async () => {
  // 1. Write corrupted jsonl containing sequence inversion (non-monotonicity)
  // 2. Trigger projection rebuild and verify that state.json is rebuilt and WARN logged
});
it("rebuilds state.json on sequence duplicate", async () => {
  // 1. Write corrupted jsonl containing duplicate sequences
  // 2. Trigger projection rebuild and verify rebuild
});
it("rebuilds state.json on maxSequenceByShard discrepancy", async () => {
  // 1. Write state.json with maxSequenceByShard containing sequence 10 for a shard
  // 2. Write actual event log containing sequence 5 for that shard (discrepancy)
  // 3. Trigger projection read/rebuild and verify rebuild and WARN logged
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

**派生元:** `Task 8.5`（直前 Task から派生）。

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
# 変更がある場合のみ commit
git diff --quiet .github/workflows/ci.yml || {
  git add .github/workflows/ci.yml
  git commit -m "ci: finalize v2.0 CI with devcontainer and full regression"
}
```

- [ ] **Step 5: Phase 8 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 8.6`（直前 Task から派生）。

---

## 依存関係とブランチ派生の総括

**ルール:** Phase 0 Base のみ `master` から直接分岐する。後続の各 Phase N+1 Base は、前 Phase N のすべての実装を含む「最終 Task ブランチ」を起点として分岐させて作成します。これにより、上位の Phase Base が前 Phase の実装成果を継承することを保証します。Phase 内の Task は原則 Phase Base から分岐しますが、同一ファイル・同一型を連続して使用する Task は直前 Task から分岐します。Phase 間の stack 依存は Graphite が管理します。

```text
master
  └── feature/phase0-v2-baseline__base
       └── feature/phase0-task0-preflight                     (Base から派生)
            └── feature/phase0-task1-devcontainer-baseline    (Task 0.0 から派生)
                 └── feature/phase0-task2-v2-spikes           (Task 0.1 から派生)

  └── feature/phase1-v2-core-model__base                      (feature/phase0-task2-v2-spikes から派生)
       ├── feature/phase1-task1-core-types                   (Base から派生)
       ├── feature/phase1-task2-redaction-safe-segment       (Task 1.1 から派生)
       └── feature/phase1-task3-evidence-engine              (Task 1.2 から派生)

  └── feature/phase2-v2-log-projection__base                 (feature/phase1-task3-evidence-engine から派生)
       ├── feature/phase2-task1-shard-layout                 (Base から派生)
       ├── feature/phase2-task2-atomic-append                (Task 2.1 から派生)
       ├── feature/phase2-task3-state-projection             (Task 2.2 から派生)
       └── feature/phase2-task4-rotation-archive              (Task 2.3 から派生)

  └── feature/phase3-v2-message-adapter__base                (feature/phase2-task4-rotation-archive から派生)
       └── feature/phase3-task1-message-role-buffer          (Base から派生)
            └── feature/phase3-task2-adapter-extension        (Task 3.1 から派生)
                 └── feature/phase3-task3-routing-guard       (Task 3.2 から派生)
                      └── feature/phase3-task4-agent-id-resolution (Task 3.3 から派生)

  └── feature/phase4-v2-observation-handler__base            (feature/phase3-task4-agent-id-resolution から派生)
       ├── feature/phase4-task1-tool-observation             (Base から派生)
       ├── feature/phase4-task2-message-observation          (Task 4.1 から派生)
       ├── feature/phase4-task3-skill-task-summary           (Task 4.2 から派生)
       └── feature/phase4-task4-session-error-reflection     (Task 4.3 から派生)

  └── feature/phase5-v2-rule-engine__base                    (feature/phase4-task4-session-error-reflection から派生)
       ├── feature/phase5-task1-gate-schema                  (Base から派生)
       ├── feature/phase5-task2-rule-engine                  (Task 5.1 から派生)
       ├── feature/phase5-task3-default-gates                (Task 5.2 から派生)
       └── feature/phase5-task4-gate-trigger                 (Task 5.3 から派生)

  └── feature/phase6-v2-review-aggregator__base              (feature/phase5-task4-gate-trigger から派生)
       ├── feature/phase6-task1-severity-classifier          (Base から派生)
       ├── feature/phase6-task2-review-aggregator            (Task 6.1 から派生)
       └── feature/phase6-task3-review-observed              (Task 6.2 から派生)

  └── feature/phase7-v2-justice-tools__base                  (feature/phase6-task3-review-observed から派生)
       ├── feature/phase7-task1-justice-status               (Base から派生)
       ├── feature/phase7-task2-justice-gate                 (Task 7.1 から派生)
       └── feature/phase7-task3-justice-review               (Task 7.2 から派生)

  └── feature/phase8-v2-fitness-nfr__base                    (feature/phase7-task3-justice-review から派生)
       └── feature/phase8-task1-ff001-core-imports           (Base から派生)
            └── feature/phase8-task2-ff002-003-determinism        (Task 8.1 から派生)
                 └── feature/phase8-task3-ff004-005-replay-planmd      (Task 8.2 から派生)
                      └── feature/phase8-task4-ff006-fail-open               (Task 8.3 から派生)
                           └── feature/phase8-task5-ff007-008-provenance          (Task 8.4 から派生)
                                └── feature/phase8-task6-nfr-security-integrity        (Task 8.5 から派生)
                                     └── feature/phase8-task7-final-regression             (Task 8.6 から派生)
```

---

## 自己レビュー（Self-Review）

- [x] **Spec coverage:** 設計書 §10.3 の 8 ビルドステップを Phase 1〜7 に網羅。§9 の FF/NFR を Phase 8 に網羅。Phase 0 は §3 の 2 スパイク + devcontainer ベースラインを網羅。CODEOWNERS 追認 ADR 作成は Pre-Planning Preflight として本計画の executable 化条件となる。
- [x] **Phase 0:** CI/CD（`.github/workflows/ci.yml` with `master` trigger + `ubuntu-slim`）と Devcontainer（`.devcontainer/devcontainer.json` + `Dockerfile`）は既存。Phase 0 はこれらの検証 + **3 スパイク**（観測レイテンシ・Message fallback matrix・C1/L0 advisory 表示面実証）に充てる。Pre-Planning Preflight（ADR 追認）が完了して初めて本計画を executable とする。
- [x] **Devcontainer 強制:** 各 Task の検証手順に `devcontainer exec --workspace-folder . ...` を明記。
- [x] **ブランチ運用:** Graphite Stacked PR Workflow に準拠。各 Phase には `feature/phaseN-v2-...__base`、各 Task には `feature/phaseN-taskM-...` ブランチを定義。各 Task 最後は `gt submit` による Phase Base 向け Draft PR 作成・更新。
- [x] **派生元:** Phase 0 Base のみ `master` から直接分岐。Phase 1〜7 の各 Phase Base は直前の Phase の最終 Task ブランチから分岐。Phase 8 Base は `feature/phase7-task3-justice-review` から分岐。独立して単体完結する Task は Base から派生（ただし Phase 8 は、最終回帰テストにすべてのテストを蓄積するため順次積層）。同一ファイル・同一型を連続して使用する Task は直前 Task から派生。
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
