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

> **Split plan:** This file is part 01 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** ADR preflight, devcontainer baseline, and Phase 0 empirical spikes.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

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
  expect(content).toMatch(/\*\s*\*\*Approvers:\*\*\*\s*`@[A-Za-z0-9_-]+`/);
  const blockedPlaceholders = ["@owner-alice", "@owner-bob", "@alice", "@bob", "@example", "@codeowner"];
  for (const handle of blockedPlaceholders) {
    expect(content).not.toContain(handle);
  }
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
gt add docs/superpowers/spikes/2026-06-26-v2-phase0-spikes.md docs/superpowers/specs/2026-06-16-justice-v2-foundation-design.md
gt commit create -m "docs: v2.0 Phase 0 de-risk spikes 結果を記録および設計書更新"
```

- [ ] **Step 4: Task 0.2 に向けた PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase0-task1-devcontainer-baseline`（Task 0.1 から派生）。Task 0.1 の devcontainer 整備後に実行する。

---
