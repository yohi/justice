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

> **Split plan:** This file is part 09 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** Fitness function tests, NFR security/integrity tests, full regression, and CI finalization.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

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
import { describe, expect, it, vi } from "vitest";
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
import { describe, expect, it, vi } from "vitest";
import { evaluate } from "../../src/core/v2/rule-evaluation-engine.ts";

describe("FF-002 / FF-003", () => {
  it("evaluate is deterministic and pure", async () => {
    // Inject mock/spy on node filesystems to assert no side-effects (FF-003)
    const fs = await import("node:fs/promises");
    const readSpy = vi.spyOn(fs, "readFile").mockImplementation(() => { throw new Error("I/O during pure function"); });
    const writeSpy = vi.spyOn(fs, "writeFile").mockImplementation(() => { throw new Error("I/O during pure function"); });

    try {
      const gates: any[] = [];
      const evidence: any[] = [];
      const ctx: any = {
        trigger: "task_complete",
        taskId: "task-1",
        agentId: "hephaestus",
        sessionId: "s-1",
        reviewScope: [],
        reviewSummary: { authority: "observed_review_output", critical: [], major: [], minor: [], resolved: [], open: [], byScope: new Map() }
      };

      const before = structuredClone({ gates, evidence, ctx });

      const a = evaluate(gates, evidence, ctx);
      const b = evaluate(gates, evidence, ctx);
      expect(a).toEqual(b);

      // Assert that evaluate has zero side effects / I/O dependency (INV-009)
      expect(readSpy).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(structuredClone({ gates, evidence, ctx })).toEqual(before);
    } finally {
      readSpy.mockRestore();
      writeSpy.mockRestore();
    }
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
import { createMockFileWriter } from "../helpers/mock-file-system";
import { TaskFeedbackHandler } from "../../src/hooks/task-feedback";

describe("FF-005", () => {
  it("writes plan.md only from the allowlisted hook paths", () => {
    const writer = createMockFileWriter();
    const handler = new TaskFeedbackHandler({ fileWriter: writer });
    void handler.updateCheckbox({ planPath: "plan.md", taskId: "task-1", checked: true });
    expect(writer.writeFile).toHaveBeenCalledWith("plan.md", expect.any(String));

    const deniedWriter = createMockFileWriter();
    const deniedHandler = new TaskFeedbackHandler({ fileWriter: deniedWriter });
    void deniedHandler.updateCheckbox({ planPath: "other-plan.md", taskId: "task-1", checked: true });
    expect(deniedWriter.writeFile).not.toHaveBeenCalled();
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

### Task 8.6a: NFR Security + Reference Resolution Tests

**Files:**

- Create: `tests/core/v2/redaction-integration.test.ts`
- Create: `tests/core/record-reference-resolution.test.ts`

**Interfaces:**

- Consumes: `redactForPersistence`, `redactAbsolutePaths`, `ObservationLogStore`, `project`, `DecisionRecord.evidenceRefs[]`, `loadGates`, `GateRule`.
- Produces: Tests proving secrets and absolute paths are redacted before persistence; `file_content` reads are stored as `rawOutputHash` + minimal snippet only; `gate.yaml` injection/schema validation rejects invalid payloads; corrupted log triggers rebuild; message claim and review item are resolvable from `DecisionRecord.evidenceRefs[]`.

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

### Task 8.6c: Gate Validation Tests

**Files:**

- Create: `tests/runtime/gate-yaml-injection.test.ts`

```typescript
// tests/runtime/gate-yaml-injection.test.ts
it("rejects injected or invalid gate.yaml payloads and keeps file_content reads hash-only", async () => {
  // 1. Load gates from templates/gate.yaml and .justice/gate.yaml through the gate loader
  // 2. Verify malformed or injected YAML is rejected by schema validation
  // 3. Verify read/grep/glob/bash file-content output is stored as rawOutputHash + minimal snippet only
});
```

### Task 8.6b: Runtime Integrity + Queue + Rotation Tests

**Files:**

- Create: `tests/runtime/observation-log-integrity.test.ts`
- Create: `tests/runtime/observation-log-queue.test.ts`
- Create: `tests/runtime/writer-id-collision.test.ts`
- Create: `tests/runtime/rotation-sequence-continuity.test.ts`

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
it("serializes same-shard append operations without losing events", async () => {
  // 1. Fire concurrent append operations into the same shard
  // 2. Verify the per-shard queue preserves ordering and no event is lost
});
it("reassigns writerId when a segment file already exists", async () => {
  // 1. Pre-create a colliding writer segment file
  // 2. Verify the runtime picks a fresh writerId and keeps a 1 file = 1 writer invariant
});
it("continues sequence numbers across rotation boundaries", async () => {
  // 1. Populate active and archive segments for the same shard
  // 2. Verify sequence resumes from the max across both segments
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

  - `tests/hooks/message-role-buffer.test.ts` は Task 3.1 の runtime buffer coverage で扱うため、この Phase 8 regression bundle からは外す。

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/redaction-integration.test.ts tests/runtime/observation-log-integrity.test.ts tests/core/record-reference-resolution.test.ts tests/runtime/observation-log-queue.test.ts tests/runtime/writer-id-collision.test.ts tests/runtime/rotation-sequence-continuity.test.ts tests/runtime/gate-yaml-injection.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tests/core/v2/redaction-integration.test.ts tests/runtime/observation-log-integrity.test.ts tests/core/record-reference-resolution.test.ts tests/runtime/observation-log-queue.test.ts tests/runtime/writer-id-collision.test.ts tests/runtime/rotation-sequence-continuity.test.ts tests/runtime/gate-yaml-injection.test.ts
git commit -m "test(v2): NFR security, integrity, reference resolution, and gate validation"
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
