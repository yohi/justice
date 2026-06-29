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

> **Split plan:** This file is part 02 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** Core v2 types, redaction utilities, safe segment encoding, and Evidence extraction.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

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

export type PendingEnvelope = {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly writerId: string;
  readonly taskId?: string;
  readonly recordType: "observation" | "decision" | "learning";
};

export type PersistedEnvelope = PendingEnvelope & {
  readonly sequence: number;
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

// MessageRecord stub. Refined in Task 3.1 to include declaredClaims and finalized field.
export type MessageRecord = {
  readonly kind: "message";
  readonly messageID: string;
  readonly role: "assistant" | "user";
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

export type PendingObservationRecord =
  | (PendingEnvelope & { readonly recordType: "observation" } & ToolExecutedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & MessageRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & SkillInvokedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & ReviewObservedRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & SessionErrorRecord)
  | (PendingEnvelope & { readonly recordType: "observation" } & ReflectionRecord);

export type ObservationRecord = PendingObservationRecord & { readonly sequence: number };
export type PendingLogRecord = PendingObservationRecord | PendingDecisionRecord;
export type PersistedLogRecord = ObservationRecord | DecisionRecord;

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
    .replace(/(?:^|[\s=])((?:\/|~\/)[^\s"']+)/g, " [REDACTED_PATH]");
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

export type DecisionPayload = {
  readonly recordType: "decision";
  readonly gateType: "task";
  readonly verdict: "PASS" | "WARN" | "FAIL";
  readonly reachableEnforcementLevel: "L1";
  readonly appliedEnforcementLevel: "L0";
  readonly ruleResults: readonly RuleResult[];
};

export type PendingDecisionRecord = PendingEnvelope & DecisionPayload;
export type DecisionRecord = PersistedEnvelope & DecisionPayload;
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
    .replace(/(^|[\s=])((?:\/|~\/|[A-Za-z]:\\|\\\\)[^\s"']+)/g, "$1[REDACTED_PATH]")
    .replace(/(["'])(?:(?:\/|~\/|[A-Za-z]:\\|\\\\)[^"']+)\1/g, "$1[REDACTED_PATH]$1");
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

- Consumes: `ObservationRecord` envelope, `ToolOutput` from adapter (`{ title, output, metadata }`), `ObservationMessagePayload` union (Task 1.1), `ReviewRejectionSignal` from existing `review-rejection-detector.ts`.
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
  args: { readonly command?: string } | undefined
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
    // Unknown shell commands are classified conservatively from the command text alone.
    return "file_content";
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
  const toolOutputClass = classifyToolOutputClass(toolName, args);
  const observedId = callId; // Deterministic evidenceId from tool callId (FF-002/FF-003)
  const kind = toolName === "task" ? "generic" : mapToolNameToKind(toolName, args);
  return {
    evidenceId: observedId,
    kind,
    sourceClass: "tool_output",
    provenance: "observed",
    toolOutputClass,
    command: args?.command ? redactEvidenceCommand(args.command) : undefined,
    ...(toolOutputClass === "command_exec"
      ? { rawOutput: redactForPersistence(redactAbsolutePaths(rawOutput)) }
      : { rawOutputHash: hashString(rawOutput), rawOutputSnippet: redactForPersistence(redactAbsolutePaths(rawOutput.slice(0, 100))) }),
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
const CLAIM_PATTERNS: ReadonlyArray<readonly [DeclaredClaim["claimKind"], RegExp]> = [
  ["test", /tests? pass|passing|✅\s*tests?/i],
  ["build", /build(?:\s+pass(?:ed)?)?|✅\s*build/i],
  ["lint", /lint(?:\s+pass(?:ed)?)?|✅\s*lint/i],
  ["generic", /declared|summary|status/i],
];

export function extractDeclaredClaims(sourceId: string, text: string): DeclaredClaim[] {
  const claims: DeclaredClaim[] = [];
  for (const [claimKind, pattern] of CLAIM_PATTERNS) {
    if (!pattern.test(text)) continue;
    const outcome = PASS_PATTERNS.test(text) ? "pass" : FAIL_PATTERNS.test(text) ? "fail" : "unknown";
    claims.push({ evidenceId: `claim-${claims.length}`, claimKind, outcome });
  }
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
  expect(classifyToolOutputClass("bash", { command: "python -c \"print(open('file.txt').read())\"" }, 100)).toBe("file_content");
  expect(classifyToolOutputClass("bash", { command: "node -e \"console.log(require('fs').readFileSync('file.txt','utf8'))\"" }, 100)).toBe("file_content");
});

it("classifies stdin pipe filters like grep as command_exec", () => {
  expect(classifyToolOutputClass("bash", { command: "bun run test | grep failed" }, 100)).toBe("command_exec");
  expect(classifyToolOutputClass("bash", { command: "npm run lint | rg 'error'" }, 100)).toBe("command_exec");
});

it("extracts declared claims for build lint and generic summaries", () => {
  expect(extractDeclaredClaims("build passed ✅").map((c) => c.claimKind)).toContain("build");
  expect(extractDeclaredClaims("lint failed ❌").map((c) => c.claimKind)).toContain("lint");
  expect(extractDeclaredClaims("declared summary: all checks green").map((c) => c.claimKind)).toContain("generic");
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
