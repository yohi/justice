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
- すべての file I/O は `FileReader` / `FileWriter` 経由。テストでは mock を注入（`tests/helpers/mock-file-system.ts`）。`FileReader` は `readFile` / `fileExists` / `listFiles(prefix)` / `readFileStats` を提供する。（例外として、テストコードにおけるリポジトリの静的ファイル（ADR等）の存在確認やアーキテクチャ検証目的の読取に限り、Node.js の `fs` モジュールの直接使用を許可します）。
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

## Split Plan Index

The original single-file implementation plan has been split into reviewable execution units. Use the files below as the authoritative implementation plans for each scope.

| # | Plan | Scope |
|---|---|---|
| 01 | [Phase 0: Baseline and De-risk Spikes](./2026-06-26-justice-v2-foundation-01-phase0-spikes.md) | ADR preflight, devcontainer baseline, and Phase 0 empirical spikes. |
| 02 | [Phase 1: Core Event Model and Evidence Engine](./2026-06-26-justice-v2-foundation-02-event-model.md) | Core v2 types, redaction utilities, safe segment encoding, and Evidence extraction. |
| 03 | [Phase 2: Observation Log Store and State Projection](./2026-06-26-justice-v2-foundation-03-log-projection.md) | Shard layout, writer ID, write queue, log persistence, projection, cache integrity, and archive rotation. |
| 04 | [Phase 3: Message/Role Handling and Adapter Routing](./2026-06-26-justice-v2-foundation-04-message-adapter.md) | Message role buffering, OpenCode adapter routing, plugin response merging, and agent/session mapping. |
| 05 | [Phase 4: Observation Handler Implementation](./2026-06-26-justice-v2-foundation-05-observation-handler.md) | Tool, message, skill, task-summary, session-error, and reflection observation handlers. |
| 06 | [Phase 5: Rule Engine and Gate Definition](./2026-06-26-justice-v2-foundation-06-gates.md) | Gate schema, rule evaluation, default gates, gate loading, and DecisionRecord append. |
| 07 | [Phase 6: Review Aggregator](./2026-06-26-justice-v2-foundation-07-review-aggregator.md) | Review severity classification, scope-aware review aggregation, and review_observed generation. |
| 08 | [Phase 7: Justice Tools](./2026-06-26-justice-v2-foundation-08-justice-tools.md) | Read-only justice_status, justice_gate, and justice_review custom tools. |
| 09 | [Phase 8: Fitness Functions and NFR Tests](./2026-06-26-justice-v2-foundation-09-fitness-nfr.md) | Fitness function tests, NFR security/integrity tests, full regression, and CI finalization. |

## Review Convergence Policy

Use the split files as the review unit. Do not review this index as if it contained executable implementation steps.

- Review one split plan at a time.
- Treat Phase 0 empirical outputs and explicitly deferred v2.5+ work as out of scope for later split-plan blocker reviews.
- Track findings in an issue ledger with `addressed`, `deferred`, or `wontfix` status instead of reopening the full-plan review loop.
- Stop a split-plan review when Blocker/High findings are resolved or explicitly deferred by the owner.

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
       ├── feature/phase2-task2a-filesystem-extension        (Task 2.1 から派生)
       ├── feature/phase2-task2b-write-queue                 (Task 2.2a から派生)
       ├── feature/phase2-task2c-log-store                   (Task 2.2b から派生)
       ├── feature/phase2-task3-state-projection             (Task 2.2c から派生)
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

- [x] **Spec coverage:** 設計書 §10.3 の 8 ビルドステップを Phase 1〜7 に網羅。§9 の FF/NFR を Phase 8 に網羅。Phase 0 は §3 の 3 スパイク + devcontainer ベースラインを網羅。CODEOWNERS 追認 ADR 作成は Pre-Planning Preflight として本計画の executable 化条件となる。
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
